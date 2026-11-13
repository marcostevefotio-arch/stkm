const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../src/config/database');
const { portalSecret } = require('../src/config/portal-access');
const portal = require('../src/routes/portal.routes');
const { resetTrialData,RESET_MODULES } = require('../src/services/trial-reset.service');
const { getSubscriptionReceipt } = require('../src/services/subscription-receipt.service');

process.env.JWT_SECRET = 'subscription-management-test';
const app = require('../src/app');
const cashBody = { plan_id:2,billing_interval:'monthly',period_start:'2026-11-12',period_end:'2026-12-12',amount:'25000',max_users:5,confirm:true };
const modules = ['stock','stock_movements','procurement','sales','cash'];

async function serve(t, target) {
    const server = target.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}
function portalApp() {
    const target = express(); target.use(express.json()); target.use('/api/portal',portal);
    target.use((error,req,res,next) => res.status(500).json({ error:error.message }));
    return target;
}
function staffMock(t, role = 'PLATFORM_ADMIN') {
    const original = db.execute;
    db.execute = async sql => {
        assert.match(sql,/FROM platform_staff WHERE id/);
        return [[{ id:7,full_name:'Superadmin',role,is_active:1,password_version:0 }],[]];
    };
    t.after(() => { db.execute = original; });
    return { Authorization:`Bearer ${jwt.sign({ sub:7,typ:'portal',pv:0 },portalSecret())}`,'Content-Type':'application/json' };
}
function cashConnection(t, { duplicate = false, failAt, planType = 'ultimate', userCount = 2, organization = true } = {}) {
    const original = db.getConnection, queries = [], state = { committed:false,rolledBack:false,released:false };
    db.getConnection = async () => ({
        beginTransaction:async () => {},
        commit:async () => { state.committed = true; },
        rollback:async () => { state.rolledBack = true; },
        release:() => { state.released = true; },
        execute:async (sql,values = []) => {
            queries.push({ sql,values });
            assert.equal((sql.match(/\?/g) || []).length,values.length,sql);
            if (failAt && sql.includes(failAt)) throw Error('transaction failure');
            if (sql.startsWith('SELECT id,status,name,address FROM organizations')) return [organization ? [{ id:9,status:'active',name:'Client',address:'Adresse client' }] : [],[]];
            if (sql.includes('FROM plans WHERE id')) return [[{ id:2,name:'Ultimate',plan_type:planType,currency:'XAF',max_users:5,included_modules:'["stock","sales"]' }],[]];
            if (sql.startsWith('SELECT COUNT(*)')) return [[{ total:userCount }],[]];
            if (sql.startsWith('SELECT id FROM platform_invoices')) return [duplicate ? [{ id:40 }] : [],[]];
            if (sql.startsWith('SELECT id,status FROM subscriptions')) return [[{ id:10,status:'trialing' }],[]];
            if (sql.startsWith('SELECT partner_id')) return [[{ partner_id:3 }],[]];
            if (sql.startsWith('SELECT id FROM platform_partner_commissions')) return [[],[]];
            if (sql.startsWith('SELECT id,commission_percent')) return [[{ id:3,commission_percent:10 }],[]];
            if (sql.includes("setting_key='partner_program'")) return [[],[]];
            if (sql.startsWith('INSERT INTO subscriptions')) return [{ insertId:11 },[]];
            if (sql.startsWith('INSERT INTO platform_invoices')) return [{ insertId:41 },[]];
            return [{ affectedRows:1 },[]];
        }
    });
    t.after(() => { db.getConnection = original; });
    return { queries,state };
}

test('cash activation atomically saves a new active subscription, paid receipt, payment, commission and audit', async t => {
    const headers = staffMock(t), { queries,state } = cashConnection(t);
    const url = await serve(t,portalApp());
    const response = await fetch(`${url}/api/portal/clients/9/subscription/cash`,{ method:'POST',headers,body:JSON.stringify(cashBody) });
    const data = await response.json(); assert.equal(response.status,201,JSON.stringify(data));
    assert.equal(data.id,11); assert.equal(data.invoice_id,41); assert.match(data.invoice_number,/^RED-\d+-[A-F0-9]{8}$/);
    assert.deepEqual(state,{ committed:true,rolledBack:false,released:true });
    const subscription = queries.find(q => q.sql.startsWith('INSERT INTO subscriptions'));
    assert.deepEqual(subscription.values.slice(0,5),['9',2,'monthly',25000,5]);
    assert.ok(JSON.parse(subscription.values[5]).includes('reports'));
    assert.deepEqual(subscription.values.slice(6),[cashBody.period_start,cashBody.period_end]);
    const invoice = queries.find(q => q.sql.startsWith('INSERT INTO platform_invoices'));
    assert.equal(invoice.values[2],11); assert.equal(invoice.values.at(-1),7); assert.match(invoice.sql,/'paid'/);
    assert.deepEqual(JSON.parse(invoice.values[9]).subscription_receipt,{ version:1,plan_name:'Ultimate',organization_name:'Client',organization_address:'Adresse client',recorded_by:'Superadmin',billing_interval:'monthly' });
    assert.deepEqual(queries.find(q => q.sql.startsWith('INSERT INTO subscription_payments')).values,[11,25000,'XAF',data.invoice_number]);
    assert.deepEqual(queries.find(q => q.sql.startsWith('INSERT INTO platform_partner_commissions')).values,[3,'9',41,25000,10,2500,'XAF']);
    assert.ok(queries.find(q => q.sql.startsWith('INSERT INTO platform_audit_logs')));
});

test('cash and trial-reset write endpoints are superadmin-only, including BILLING staff', async t => {
    const headers = staffMock(t,'BILLING'), url = await serve(t,portalApp());
    for (const endpoint of ['subscription/cash','trial-reset']) {
        const response = await fetch(`${url}/api/portal/clients/9/${endpoint}`,{ method:'POST',headers,body:JSON.stringify(cashBody) });
        assert.equal(response.status,403);
    }
    assert.equal((await fetch(`${url}/api/portal/clients/9/trial-reset`,{ headers })).status,403);
    assert.equal((await fetch(`${url}/api/portal/clients/9/backups`,{ headers })).status,403);
    assert.equal((await fetch(`${url}/api/portal/clients/9/backups/71/restore`,{ method:'POST',headers,body:JSON.stringify({ modules:['subscription'],confirmation:'RESTAURER 9' }) })).status,403);
});

test('cash validation rejects absent amounts, bad dates, unsupported periods, trial plans and missing confirmation', async t => {
    const headers = staffMock(t), { queries } = cashConnection(t), url = await serve(t,portalApp());
    for (const invalid of [
        { amount:null },{ amount:'' },{ amount:' ' },{ amount:0 },{ amount:-1 },{ amount:'NaN' },{ amount:1000000000 },
        { amount:{} },{ amount:true },{ period_start:'2026-02-30' },{ period_end:cashBody.period_start },
        { billing_interval:'weekly' },{ max_users:1.5 },{ max_users:null },{ confirm:false },{ plan_id:'no' }
    ]) {
        const response = await fetch(`${url}/api/portal/clients/9/subscription/cash`,{ method:'POST',headers,body:JSON.stringify({ ...cashBody,...invalid }) });
        assert.equal(response.status,400,JSON.stringify(invalid));
    }
    assert.equal(queries.length,0);
});

test('same paid period cannot be charged twice', async t => {
    const headers = staffMock(t), { queries,state } = cashConnection(t,{ duplicate:true }), url = await serve(t,portalApp());
    const response = await fetch(`${url}/api/portal/clients/9/subscription/cash`,{ method:'POST',headers,body:JSON.stringify(cashBody) });
    assert.equal(response.status,409); assert.ok(state.rolledBack); assert.ok(state.released);
    assert.equal(queries.some(q => /^(INSERT|UPDATE)/.test(q.sql)),false);
});

test('commission or audit failures roll back the entire cash activation', async t => {
    for (const failAt of ['INSERT INTO platform_partner_commissions','INSERT INTO platform_audit_logs']) {
        await t.test(failAt,async child => {
            const headers = staffMock(child), { state } = cashConnection(child,{ failAt }), url = await serve(child,portalApp());
            const response = await fetch(`${url}/api/portal/clients/9/subscription/cash`,{ method:'POST',headers,body:JSON.stringify(cashBody) });
            assert.equal(response.status,500); assert.deepEqual(state,{ committed:false,rolledBack:true,released:true });
        });
    }
});

test('customized activation validates selected modules and user limits', async t => {
    const headers = staffMock(t), { queries,state } = cashConnection(t,{ planType:'customized' }), url = await serve(t,portalApp());
    for (const selected_modules of [[],['support'],['stock','stock']]) {
        const response = await fetch(`${url}/api/portal/clients/9/subscription/cash`,{ method:'POST',headers,body:JSON.stringify({ ...cashBody,selected_modules }) });
        assert.equal(response.status,400);
    }
    const low = await fetch(`${url}/api/portal/clients/9/subscription/cash`,{ method:'POST',headers,body:JSON.stringify({ ...cashBody,max_users:1,selected_modules:['stock'] }) });
    assert.equal(low.status,409);
    const valid = await fetch(`${url}/api/portal/clients/9/subscription/cash`,{ method:'POST',headers,body:JSON.stringify({ ...cashBody,selected_modules:['stock'] }) });
    assert.equal(valid.status,201,JSON.stringify(await valid.json())); assert.ok(state.committed);
    assert.equal(queries.find(q => q.sql.startsWith('INSERT INTO subscriptions')).values[5],'["stock"]');
});

function resetFixture({ status = 'trialing',unexpired = 1,paid = false,failAt,backupError,backupSize = 123,referenced = false } = {}) {
    const events = [], state = { committed:false,rolledBack:false,released:false,backups:0 };
    const connectionPool = { getConnection:async () => ({
        beginTransaction:async () => {},
        commit:async () => { state.committed = true; },
        rollback:async () => { state.rolledBack = true; },
        release:() => { state.released = true; },
        execute:async (sql,values) => {
            events.push({ sql,values });
            if (failAt && sql.includes(failAt)) throw Error('delete failure');
            if (sql.startsWith('SELECT id FROM organizations')) return [[{ id:9 }],[]];
            if (sql.startsWith('SELECT id,status')) return [[{ id:10,status,unexpired }],[]];
            if (sql.startsWith('SELECT sp.id')) return [paid ? [{ id:20 }] : [],[]];
            if (sql.startsWith('SELECT id FROM platform_invoices')) return [[],[]];
            if (sql.startsWith('SELECT 1 FROM')) return [referenced ? [{ present:1 }] : [],[]];
            return [{ affectedRows:2 },[]];
        }
    }) };
    const backup = async (connection,organizationId,reason) => {
        assert.equal(organizationId,'9'); assert.equal(reason,'before_reset');
        state.backups++; events.push({ sql:'BACKUP' }); if (backupError) throw Error('backup failed');
        return { id:71,uncompressed_size:backupSize };
    };
    return { connectionPool,backup,events,state };
}
const resetOptions = fixture => ({ organizationId:'9',staffId:7,modules,confirmation:'REINITIALISER 9',...fixture });

test('trial reset validates selections and confirmation before acquiring a connection', async () => {
    const connectionPool = { getConnection:async () => assert.fail('No connection should be acquired') };
    for (const invalid of [{ modules:[] },{ modules:['unknown'] },{ modules:[...modules,'sales'] },{ confirmation:'yes' }]) {
        await assert.rejects(resetTrialData({ ...resetOptions({ connectionPool }),...invalid }),{ status:400 });
    }
    assert.deepEqual(RESET_MODULES.map(item => item.key),[...modules,'patients']);
});

test('trial reset is denied for active, expired or previously paying clients, without backup or deletion', async () => {
    for (const settings of [{ status:'active' },{ status:'cancelled' },{ unexpired:0 },{ paid:true }]) {
        const fixture = resetFixture(settings);
        await assert.rejects(resetTrialData(resetOptions(fixture)),{ status:409 });
        assert.equal(fixture.state.backups,0); assert.ok(fixture.state.rolledBack); assert.ok(fixture.state.released);
        assert.equal(fixture.events.some(q => q.sql.startsWith('DELETE')),false);
    }
});

test('backup failure or an empty backup prevents all deletion', async () => {
    for (const settings of [{ backupError:true },{ backupSize:0 }]) {
        const fixture = resetFixture(settings);
        await assert.rejects(resetTrialData(resetOptions(fixture)));
        assert.equal(fixture.events.some(q => q.sql.startsWith('DELETE')),false);
        assert.ok(fixture.state.rolledBack); assert.equal(fixture.state.committed,false);
    }
});

test('trial reset deletes only selected tenant operational data in FK-safe order and preserves patients/settings/billing', async () => {
    const fixture = resetFixture(), result = await resetTrialData(resetOptions(fixture));
    assert.deepEqual(fixture.state,{ committed:true,rolledBack:false,released:true,backups:1 });
    assert.equal(result.backup_id,71);
    const deletions = fixture.events.filter(q => q.sql.startsWith('DELETE'));
    for (const q of deletions) {
        assert.match(q.sql,/organization_id=\?/); assert.deepEqual(q.values,['9']);
        assert.doesNotMatch(q.sql,/(patients|insurers|organization_settings|platform_invoices|subscriptions|users|accounting|audit_logs)/);
    }
    const index = table => fixture.events.findIndex(q => new RegExp(`DELETE (FROM ${table}|\\w+ FROM ${table})\\b`).test(q.sql));
    assert.ok(index('sales_return_items') < index('sales_returns'));
    assert.ok(index('sales_invoice_items') < index('sales_invoices'));
    assert.ok(index('stock_movement_corrections') < index('stock_movements'));
    assert.ok(index('stock_movements') < index('products'));
    assert.ok(fixture.events.findIndex(q => q.sql === 'BACKUP') < index('cash_movements'));
    assert.ok(fixture.events.some(q => q.sql.startsWith('UPDATE users SET password_version')));
    assert.ok(fixture.events.some(q => q.sql.startsWith('INSERT INTO platform_audit_logs')));
});

test('optional patients reset removes linked coverages before patients and insurers', async () => {
    const fixture = resetFixture();
    const result = await resetTrialData({ ...resetOptions(fixture),modules:[...modules,'patients'] });
    assert.equal(result.deleted.patients,2); assert.equal(result.deleted.insurers,2);
    const sql = fixture.events.map(q => q.sql);
    assert.ok(sql.indexOf('DELETE FROM patient_insurance_coverages WHERE organization_id=?') < sql.indexOf('DELETE FROM patients WHERE organization_id=?'));
});

test('each trial reset module can be selected independently without deleting the others', async () => {
    const expected = {
        stock:['products'],
        stock_movements:['stock_movement_corrections','stock_movements'],
        procurement:['purchase_order_items','purchase_orders','suppliers'],
        sales:['sales_return_items','sales_returns','sales_payments','sales_invoice_prescriptions','sales_invoice_items','sales_invoices'],
        cash:['cash_movements','cash_sessions'],
        patients:['patient_medical_history','patient_insurance_coverages','patients','insurers']
    };
    for (const module of RESET_MODULES) {
        const fixture = resetFixture(), result = await resetTrialData({ ...resetOptions(fixture),modules:[module.key] });
        assert.deepEqual(Object.keys(result.deleted),expected[module.key]);
        assert.ok(fixture.state.committed); assert.equal(fixture.state.backups,1);
        assert.equal(fixture.events.some(event => /UPDATE products/.test(event.sql)),false);
    }
});

test('remaining child references block a parent reset before backup or deletion', async () => {
    for (const selected of [['stock'],['patients'],['sales']]) {
        const fixture = resetFixture({ referenced:true });
        await assert.rejects(resetTrialData({ ...resetOptions(fixture),modules:selected }),/a des références de/);
        assert.equal(fixture.state.backups,0); assert.ok(fixture.state.rolledBack);
        assert.equal(fixture.events.some(event => event.sql.startsWith('DELETE')),false);
    }
});

test('catalogue reset requires selecting referenced stock movements but movements can be reset while keeping products', async () => {
    const blocked = resetFixture({ referenced:true });
    await assert.rejects(resetTrialData({ ...resetOptions(blocked),modules:['stock'] }),/Mouvements de stock a des références de Catalogue produits/);
    assert.equal(blocked.state.backups,0);
    assert.equal(blocked.events.some(event => event.sql.startsWith('DELETE')),false);

    const allowed = resetFixture({ referenced:true });
    const result = await resetTrialData({ ...resetOptions(allowed),modules:['stock_movements'] });
    assert.deepEqual(result.modules,['stock_movements']);
    assert.deepEqual(Object.keys(result.deleted),['stock_movement_corrections','stock_movements']);
    assert.equal(allowed.events.some(event => /(?:DELETE FROM|UPDATE) products/.test(event.sql)),false);
    assert.ok(allowed.state.committed);
});

test('reference notes name the module parents instead of requiring every module to be reset', () => {
    assert.deepEqual(RESET_MODULES.find(module => module.key === 'stock').dependencies,[]);
    assert.deepEqual(RESET_MODULES.find(module => module.key === 'stock_movements').dependencies,['stock']);
    assert.deepEqual(RESET_MODULES.find(module => module.key === 'procurement').dependencies,['stock']);
    assert.deepEqual(RESET_MODULES.find(module => module.key === 'sales').dependencies,['stock','patients']);
    assert.deepEqual(RESET_MODULES.find(module => module.key === 'cash').dependencies,['sales']);
});
test('delete or audit errors roll back reset and release the connection', async () => {
    for (const failAt of ['DELETE FROM products','INSERT INTO platform_audit_logs']) {
        const fixture = resetFixture({ failAt });
        await assert.rejects(resetTrialData(resetOptions(fixture)),/delete failure/);
        assert.ok(fixture.state.rolledBack); assert.ok(fixture.state.released); assert.equal(fixture.state.committed,false);
    }
});

test('receipt query links paid invoice to its saved payment and applies the tenant boundary', async () => {
    let query,params;
    const connection = { execute:async (sql,values) => { query = sql; params = values; return [[{ invoice_number:'RED-1',payment_method:'cash' }],[]]; } };
    const receipt = await getSubscriptionReceipt(connection,'41',9);
    assert.equal(receipt.payment_method,'cash'); assert.deepEqual(params,['41',9]);
    assert.match(query,/i.organization_id=\?/); assert.match(query,/sp.provider_reference=i.invoice_number/);
    assert.match(query,/i.status='paid'/);
});

test('receipt preserves the original plan and client details after later subscription edits', async () => {
    const connection = { execute:async () => [[{ plan_name:'New plan',organization_name:'New name',receipt_details:JSON.stringify({ version:1,plan_name:'Original plan',organization_name:'Original client',organization_address:'Original address',recorded_by:'Agent' }) }],[]] };
    const receipt = await getSubscriptionReceipt(connection,41,9);
    assert.equal(receipt.plan_name,'Original plan'); assert.equal(receipt.organization_name,'Original client');
    assert.equal(receipt.organization_address,'Original address'); assert.equal(receipt.receipt_details,undefined);
});
test('client cannot obtain another organization’s receipt or use a non-admin account', async t => {
    const original = db.execute; let role = 'OWNER', receiptQueries = 0;
    db.execute = async (sql,values) => {
        if (sql.includes('FROM users u JOIN organizations')) return [[{ id:1,organization_id:9,is_active:1,password_version:0,role,organization_status:'active' }],[]];
        if (sql.includes('FROM platform_invoices i')) { receiptQueries++; assert.deepEqual(values,['41',9]); assert.match(sql,/i.organization_id=\?/); return [[],[]]; }
        throw Error(`Unexpected query: ${sql}`);
    };
    t.after(() => { db.execute = original; });
    const url = await serve(t,app), headers = { Authorization:`Bearer ${jwt.sign({ sub:1,pv:0 },process.env.JWT_SECRET)}` };
    const request = () => fetch(`${url}/api/subscription/invoices/41/receipt`,{ headers });
    assert.equal((await request()).status,404);
    role = 'CASHIER'; assert.equal((await request()).status,403); assert.equal(receiptQueries,1);
});

test('client subscription and billing APIs expose the active plan, calendar dates and saved receipt', async t => {
    const original = db.execute;
    db.execute = async (sql,values) => {
        if (sql.includes('FROM users u JOIN organizations')) return [[{ id:1,organization_id:9,is_active:1,password_version:0,role:'OWNER',organization_status:'active' }],[]];
        assert.deepEqual(values,[9]);
        assert.match(sql,/DATE_FORMAT\(/);
        if (sql.includes('FROM subscriptions s JOIN plans')) return [[{ status:'active',plan_name:'Ultimate',current_period_start:'2026-11-12',current_period_end:'2026-12-12',max_users:5 }],[]];
        if (sql.includes('FROM platform_invoices i')) return [[{ id:41,invoice_number:'RED-TEST',has_receipt:1,status:'paid' }],[]];
        throw Error(`Unexpected query: ${sql}`);
    };
    t.after(() => { db.execute = original; });
    const url = await serve(t,app), headers = { Authorization:`Bearer ${jwt.sign({ sub:1,pv:0 },process.env.JWT_SECRET)}` };
    const subscription = await fetch(`${url}/api/subscription`,{ headers });
    assert.equal(subscription.status,200);
    assert.deepEqual(await subscription.json(),{ status:'active',plan_name:'Ultimate',current_period_start:'2026-11-12',current_period_end:'2026-12-12',max_users:5 });
    const invoices = await fetch(`${url}/api/subscription/invoices`,{ headers });
    assert.equal(invoices.status,200); assert.equal((await invoices.json())[0].has_receipt,1);
});

test('client UI displays both subscription dates and loads the shared receipt renderer', () => {
    const source = fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
    assert.match(source,/Date d’abonnement<\/dt><dd>\$\{esc\(fmtDate\(sub.current_period_start\)\)\}/);
    assert.match(source,/Date de fin<\/dt><dd>\$\{esc\(fmtDate\(sub.current_period_end\)\)\}/);
    assert.match(source,/window.showSubscriptionReceipt\(await api\(`/);
    for (const name of ['index','staff']) assert.match(fs.readFileSync(path.join(__dirname,`../public/${name}.html`),'utf8'),/src="\/js\/subscription-receipt.js"/);
});

test('subscription receipt preserves calendar dates, escapes content and cleans print styles after success or error', t => {
    const previousTimezone = process.env.TZ; process.env.TZ = 'America/New_York';
    t.after(() => { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone; });
    let afterprint;
    const styles = [], elements = {}, classes = new Set();
    const document = {
        querySelector:() => null,
        createElement:tag => {
            const element = { tag,remove(){ this.removed = true; },querySelector:selector => elements[selector] };
            if (tag === 'style') styles.push(element);
            return element;
        },
        head:{ appendChild(){} },
        body:{ appendChild(element){ elements.overlay = element; },classList:{ add:value => classes.add(value),remove:value => classes.delete(value) } }
    };
    for (const selector of ['[data-close]','[data-print]','[role="alert"]']) elements[selector] = {};
    elements.select = { value:'landscape' };
    const window = {
        addEventListener:(event,callback) => { assert.equal(event,'afterprint'); afterprint = callback; },
        removeEventListener:() => {},
        print:() => {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/js/subscription-receipt.js'),'utf8'),{ window,document });
    window.showSubscriptionReceipt({ invoice_number:'RED-1',organization_name:'<script>alert(1)</script>',plan_name:'Ultimate',payment_method:'cash',total_amount:25000,currency:'XAF',period_start:'2026-11-12',period_end:'2026-12-12' });
    assert.ok(elements.overlay.innerHTML.includes('&lt;script&gt;')); assert.ok(elements.overlay.innerHTML.includes('Espèces'));
    assert.ok(elements.overlay.innerHTML.includes('12/11/2026 au 12/12/2026'));
    elements['[data-print]'].onclick();
    const printStyle = styles.at(-1);
    assert.match(printStyle.textContent,/size:A4 landscape;margin:10mm 10mm 15mm/);
    assert.match(printStyle.textContent,/body.subscription-receipt-printing>\*:not\(.subscription-receipt-overlay\)\{display:none!important\}/);
    assert.ok(classes.has('subscription-receipt-printing'));
    afterprint(); assert.equal(classes.size,0); assert.ok(printStyle.removed);
    window.print = () => { throw Error('Printer unavailable'); };
    elements['[data-print]'].onclick(); assert.equal(classes.size,0);
    assert.equal(elements['[role="alert"]'].textContent,'Printer unavailable');
    elements['[data-close]'].onclick(); assert.ok(elements.overlay.removed); assert.ok(styles[0].removed);
});
