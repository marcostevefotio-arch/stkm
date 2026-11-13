const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync,gunzipSync } = require('node:zlib');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTenantBackup,mergeTenantBackup,runDailyBackups,listTenantBackups,RETENTION_DAYS,BACKUP_MODULES } = require('../src/services/tenant-backup.service');
const { RESET_MODULES } = require('../src/services/trial-reset.service');

const definition = {
    organizations:[['id','PRI'],['name'],['status']],
    users:[['id','PRI'],['organization_id'],['full_name'],['password_hash'],['password_version']],
    products:[['id','PRI'],['organization_id'],['name'],['quantity_on_hand']],
    subscriptions:[['id','PRI'],['organization_id'],['plan_id'],['status']],
    sales_invoices:[['id','PRI'],['organization_id'],['patient_id'],['created_by']],
    sales_invoice_items:[['id','PRI'],['invoice_id'],['product_id']],
    accounting_books:[['organization_id','PRI'],['created_by'],['accounts','', 'json']],
    accounting_entries:[['id','PRI'],['organization_id'],['created_by'],['entry_date','', 'date'],['status'],['lines','', 'json']]
};
const references = [
    ['users','organization_id','organizations','id'],
    ['products','organization_id','organizations','id'],
    ['subscriptions','organization_id','organizations','id'],
    ['subscriptions','plan_id','plans','id'],
    ['sales_invoices','organization_id','organizations','id'],
    ['sales_invoices','created_by','users','id'],
    ['sales_invoice_items','invoice_id','sales_invoices','id'],
    ['sales_invoice_items','product_id','products','id'],
    ['accounting_books','organization_id','organizations','id'],
    ['accounting_books','created_by','users','id'],
    ['accounting_entries','organization_id','accounting_books','organization_id'],
    ['accounting_entries','created_by','users','id']
].map(([TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME]) => ({ TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME }));
const baseTables = () => ({
    organizations:[{ id:9,name:'Client',status:'active' }],
    users:[{ id:1,organization_id:9,full_name:'Owner',password_hash:'test-hash',password_version:0 }],
    products:[{ id:2,organization_id:9,name:'Produit',quantity_on_hand:'10.000' }],
    subscriptions:[{ id:3,organization_id:9,plan_id:4,status:'trialing' }],
    sales_invoices:[{ id:5,organization_id:9,patient_id:null,created_by:1 }],
    sales_invoice_items:[{ id:6,invoice_id:5,product_id:2 }],
    accounting_books:[{ organization_id:9,created_by:1,accounts:'[]' }],
    accounting_entries:[{ id:7,organization_id:9,created_by:1,entry_date:'2026-11-13',status:'posted',lines:'[]' }]
});
function packed(tables) {
    const output = Buffer.from(JSON.stringify({ format:'redams-full-tenant-backup',version:1,organization_id:'9',tables }));
    return { payload:gzipSync(output),checksum:crypto.createHash('sha256').update(output).digest('hex'),uncompressed_size:output.length };
}
function fixture({ tables = baseTables(),snapshot = packed(baseTables()),failAt,owned = true,available = true,engine = 'InnoDB' } = {}) {
    const events = [], state = { commit:false,rollback:false,released:false }, backups = [];
    const metadata = Object.entries(definition).flatMap(([TABLE_NAME,columns]) => columns.map(([COLUMN_NAME,COLUMN_KEY = '',DATA_TYPE]) => ({ TABLE_NAME,COLUMN_NAME,COLUMN_KEY,DATA_TYPE:DATA_TYPE || (COLUMN_NAME === 'id' || COLUMN_NAME.endsWith('_id') ? 'bigint' : 'varchar') })));
    const connection = {
        query:async sql => events.push({ sql }),
        beginTransaction:async () => events.push({ sql:'BEGIN' }),
        commit:async () => { state.commit = true; events.push({ sql:'COMMIT' }); },
        rollback:async () => { state.rollback = true; events.push({ sql:'ROLLBACK' }); },
        release:() => { state.released = true; },
        execute:async (sql,values = []) => {
            events.push({ sql,values });
            assert.equal((sql.match(/\?/g) || []).length,values.length,sql);
            if (failAt && sql.includes(failAt)) throw Error('forced failure');
            if (sql.startsWith('SELECT id FROM organizations')) return [[{ id:9 }],[]];
            if (sql.includes('information_schema.COLUMNS')) return [available ? metadata : [],[]];
            if (sql.includes('information_schema.TABLES')) return [Object.keys(definition).map(TABLE_NAME => ({ TABLE_NAME,ENGINE:engine })),[]];
            if (sql.includes('information_schema.KEY_COLUMN_USAGE')) return [references,[]];
            if (sql.startsWith('SELECT payload')) { assert.deepEqual(values,[71,'9']); return [snapshot ? [snapshot] : [],[]]; }
            if (sql.startsWith('INSERT INTO tenant_backups')) { backups.push(values); return [{ insertId:80 },[]]; }
            if (sql.startsWith('INSERT INTO platform_audit_logs') || sql.startsWith('INSERT INTO audit_logs') || sql.startsWith('INSERT INTO tenant_backup_status')) return [{ affectedRows:1 },[]];
            if (sql.startsWith('UPDATE users SET')) return [{ affectedRows:1 },[]];
            const select = sql.match(/FROM `(\w+)` (t|parent) WHERE/);
            if (select) {
                const table = select[1],rows = tables[table] || [];
                if (select[2] === 'parent') {
                    const column = sql.match(/parent.`(\w+)`=\?/)[1];
                    const exists = rows.some(row => String(row[column]) === String(values[0])) || table === 'plans';
                    return [exists ? [{ found:1 }] : [],[]];
                }
                if (sql.startsWith('SELECT 1')) return [owned ? [{ found:1 }] : [],[]];
                if (sql.includes('FOR UPDATE')) {
                    const primary = definition[table].filter(item => item[1] === 'PRI').map(item => item[0]);
                    return [rows.filter(row => primary.every((column,index) => String(row[column]) === String(values[index]))),[]];
                }
                assert.deepEqual(values,['9']);
                return [rows,[]];
            }
            const insert = sql.match(/^INSERT INTO `(\w+)`\(([^)]+)\)/);
            if (insert) {
                const names = insert[2].split(',').map(name => name.replace(/`/g,''));
                (tables[insert[1]] ||= []).push(Object.fromEntries(names.map((name,index) => [name,values[index]])));
                return [{ affectedRows:1 },[]];
            }
            throw Error(`Unexpected query: ${sql}`);
        }
    };
    return { connectionPool:{ getConnection:async () => connection },connection,events,state,backups,tables };
}

test('full tenant snapshot is compressed, checksummed and stored in MySQL for 365 days without backing up itself', async () => {
    const f = fixture(), result = await createTenantBackup({ organizationId:'9',staffId:1,connectionPool:f.connectionPool });
    assert.equal(result.id,80); assert.ok(f.state.commit); assert.ok(f.state.released);
    const values = f.backups[0], output = gunzipSync(values[2]), payload = JSON.parse(output);
    assert.equal(crypto.createHash('sha256').update(output).digest('hex'),values[3]);
    assert.equal(output.length,values[4]); assert.equal(payload.organization_id,'9');
    for (const table of ['users','subscriptions','accounting_entries','products','sales_invoice_items']) assert.ok(payload.tables[table]);
    assert.equal(payload.tables.tenant_backups,undefined); assert.equal(payload.tables.platform_staff,undefined);
    assert.ok(f.events.some(event => /CAST\(t.`id` AS CHAR\)/.test(event.sql)));
    assert.ok(f.events.some(event => /FROM `accounting_entries` t.*ORDER BY t.`id`/.test(event.sql)));
    assert.ok(f.events.some(event => /INTERVAL 365 DAY/.test(event.sql)));
    assert.ok(f.events.some(event => event.sql.startsWith('INSERT INTO platform_audit_logs')));
    assert.equal(RETENTION_DAYS,365);
});

test('daily snapshot and success timestamp commit atomically', async () => {
    const f = fixture();
    await createTenantBackup({ organizationId:'9',reason:'daily',connectionPool:f.connectionPool });
    assert.ok(f.events.findIndex(event => event.sql.startsWith('INSERT INTO tenant_backup_status')) < f.events.findIndex(event => event.sql === 'COMMIT'));
});

test('daily snapshots can reuse the lock connection with a one-connection database pool', async () => {
    const f = fixture();
    await createTenantBackup({ organizationId:'9',reason:'daily',connection:f.connection,
        connectionPool:{ getConnection:async () => assert.fail('Do not acquire a second connection while holding the backup lock') }
    });
    assert.ok(f.state.commit); assert.equal(f.state.released,false);
});
test('snapshot failure rolls back and releases the connection instead of declaring success', async () => {
    const f = fixture({ failAt:'INSERT INTO tenant_backups' });
    await assert.rejects(createTenantBackup({ organizationId:'9',connectionPool:f.connectionPool }),/forced failure/);
    assert.ok(f.state.rollback); assert.ok(f.state.released); assert.equal(f.state.commit,false);
});

test('non-transactional tables block snapshots and no partial backup is recorded', async () => {
    const f = fixture({ engine:'MyISAM' });
    await assert.rejects(createTenantBackup({ organizationId:'9',connectionPool:f.connectionPool }),/InnoDB/);
    assert.equal(f.backups.length,0); assert.ok(f.state.rollback);
});
test('restore can merge deleted sales without overwriting preserved product quantities or users', async () => {
    const tables = baseTables(); tables.sales_invoices = []; tables.sales_invoice_items = [];
    tables.users[0].password_version = 2;
    const f = fixture({ tables });
    const result = await mergeTenantBackup({ organizationId:'9',backupId:71,modules:['sales'],confirmation:'RESTAURER 9',staffId:7,connectionPool:f.connectionPool });
    assert.equal(result.inserted,2); assert.equal(result.security_backup_id,80);
    assert.equal(tables.products[0].quantity_on_hand,'10.000'); assert.equal(tables.users[0].password_version,2);
    assert.ok(f.state.commit);
    assert.ok(f.events.findIndex(event => event.sql.startsWith('INSERT INTO tenant_backups')) < f.events.findIndex(event => event.sql.startsWith('INSERT INTO `sales_invoices`')));
    assert.ok(f.events.findIndex(event => event.sql.startsWith('INSERT INTO `sales_invoices`')) < f.events.findIndex(event => event.sql.startsWith('INSERT INTO `sales_invoice_items`')));
});

test('superadmin can restore missing users, subscriptions and accounting data in FK order', async () => {
    const tables = baseTables();
    for (const name of ['users','subscriptions','accounting_books','accounting_entries']) tables[name] = [];
    const f = fixture({ tables });
    const result = await mergeTenantBackup({ organizationId:'9',backupId:71,modules:['administration','subscription','accounting'],confirmation:'RESTAURER 9',staffId:7,connectionPool:f.connectionPool });
    assert.equal(result.inserted,4); assert.equal(tables.accounting_entries[0].status,'posted');
    const inserts = f.events.filter(event => event.sql.startsWith('INSERT INTO `')).map(event => event.sql);
    assert.ok(inserts[0].startsWith('INSERT INTO `users`'));
    assert.ok(inserts.findIndex(sql => sql.startsWith('INSERT INTO `accounting_books`')) < inserts.findIndex(sql => sql.startsWith('INSERT INTO `accounting_entries`')));
});

test('existing users keep their current passwords and roles during full merge', async () => {
    const tables = baseTables(); tables.users[0].password_hash = 'new-test-hash'; tables.users[0].password_version = 2;
    const f = fixture({ tables });
    const result = await mergeTenantBackup({ organizationId:'9',backupId:71,modules:['administration'],confirmation:'RESTAURER 9',staffId:7,connectionPool:f.connectionPool });
    assert.equal(result.inserted,0); assert.equal(tables.users[0].password_hash,'new-test-hash');
    assert.equal(f.events.some(event => event.sql.startsWith('INSERT INTO `users`')),false);
});

test('tenant owners cannot restore subscriptions, users, accounting or audits, even by tampering with the module list', async () => {
    const connectionPool = { getConnection:async () => assert.fail('Authorization must precede database work') };
    for (const module of BACKUP_MODULES.filter(module => module.protected)) {
        await assert.rejects(mergeTenantBackup({ organizationId:'9',backupId:71,modules:[module.key],confirmation:'RESTAURER 9',userId:1,connectionPool }),{ status:403 });
    }
});

test('corruption, missing backup or modified current data block restoration atomically', async () => {
    for (const settings of [{ snapshot:null },{ snapshot:{ ...packed(baseTables()),checksum:'a'.repeat(64) } },{ tables:{ ...baseTables(),products:[{ id:2,organization_id:9,name:'Updated',quantity_on_hand:'10.000' }] } }]) {
        const f = fixture(settings);
        await assert.rejects(mergeTenantBackup({ organizationId:'9',backupId:71,modules:['stock'],confirmation:'RESTAURER 9',staffId:7,connectionPool:f.connectionPool }));
        assert.ok(f.state.rollback); assert.ok(f.state.released); assert.equal(f.state.commit,false);
    }
});

test('missing unselected parents and cross-tenant conflicts are reported rather than silently restored', async () => {
    const tables = baseTables(); tables.products = []; tables.sales_invoice_items = [];
    const f = fixture({ tables });
    await assert.rejects(mergeTenantBackup({ organizationId:'9',backupId:71,modules:['sales'],confirmation:'RESTAURER 9',staffId:7,connectionPool:f.connectionPool }),/restaurez également le module parent/);
    assert.ok(f.state.rollback);
    const other = fixture({ owned:false });
    await assert.rejects(mergeTenantBackup({ organizationId:'9',backupId:71,modules:['stock'],confirmation:'RESTAURER 9',staffId:7,connectionPool:other.connectionPool }),{ status:403 });
});

test('daily backup runner catches up after downtime, isolates client failures and releases distributed lock', async () => {
    const events = [], saved = [], errors = [];
    const connection = {
        execute:async (sql,values) => {
            events.push({ sql,values });
            if (sql.includes('GET_LOCK')) return [[{ acquired:1 }],[]];
            if (sql.startsWith('SELECT o.id')) { assert.match(sql,/INTERVAL 24 HOUR/); return [[{ id:9 },{ id:10 },{ id:11 }],[]]; }
            return [{},[]];
        },
        release:() => events.push({ sql:'RELEASE_CONNECTION' })
    };
    const result = await runDailyBackups({
        connectionPool:{ getConnection:async () => connection },
        createBackup:async options => { assert.equal(options.reason,'daily'); if (options.organizationId === 10) throw Error('disk quota'); saved.push(options.organizationId); },
        logError:message => errors.push(message)
    });
    assert.deepEqual(result,{ completed:2,failed:1 }); assert.deepEqual(saved,[9,11]); assert.match(errors[0],/client 10/);
    const failure = events.find(event => event.sql.startsWith('INSERT INTO tenant_backup_status'));
    assert.deepEqual(failure.values,[10,'disk quota']);
    assert.ok(events.some(event => event.sql.includes('expires_at<=NOW()')));
    assert.ok(events.some(event => event.sql.includes('RELEASE_LOCK')));
    assert.equal(events.at(-1).sql,'RELEASE_CONNECTION');
});

test('another process holding the daily backup lock prevents duplicate daily runs', async () => {
    let released = false;
    const result = await runDailyBackups({ connectionPool:{ getConnection:async () => ({
        execute:async sql => { assert.match(sql,/GET_LOCK/); return [[{ acquired:0 }],[]]; },
        release:() => { released = true; }
    }) },createBackup:async () => assert.fail('Concurrent run must not create a backup') });
    assert.deepEqual(result,{ skipped:true }); assert.ok(released);
});

test('backup listings are tenant-scoped, paginated and never expose passwords or binary payload', async () => {
    const connection = { execute:async (sql,values) => {
        assert.equal(values[0],9); assert.doesNotMatch(sql,/SELECT.*\bpayload\b/);
        if (sql.startsWith('SELECT COUNT')) return [[{ total:400 }],[]];
        if (sql.startsWith('SELECT last_success')) return [[{ last_error:'Previous failure' }],[]];
        assert.deepEqual(values,[9,25,25]); return [[{ id:71,reason:'daily' }],[]];
    } };
    const result = await listTenantBackups(connection,9,{ offset:25 });
    assert.equal(result.total,400); assert.equal(result.retention_days,365);
    assert.equal(result.status.last_error,'Previous failure'); assert.equal(result.modules.find(module => module.key === 'accounting').protected,true);
});

test('backup restore separates product catalogue from stock movements without changing saved table names', () => {
    assert.deepEqual(BACKUP_MODULES.find(module => module.key === 'stock').tables,['products']);
    assert.deepEqual(BACKUP_MODULES.find(module => module.key === 'stock_movements').tables,['stock_movements','stock_movement_corrections']);
});

test('trial reset UI checks every module by default, shows parent notes and submits only checked modules', async () => {
    const source = fs.readFileSync(path.join(__dirname,'../public/js/staff.js'),'utf8');
    let selected = ['cash'], body, html;
    const form = {
        elements:{ confirmation:{ value:'REINITIALISER 9' } },
        querySelector:() => ({}),
        querySelectorAll:selector => { assert.equal(selector,'input[name="modules"]:checked'); return selected.map(value => ({ value })); }
    };
    const m = { body:{ set innerHTML(value){ html = value; },querySelector:() => form },close(){} };
    const context = {
        api:async () => ({ eligible:true,modules:RESET_MODULES }),
        modal:() => m,esc:String,
        run:async (button,action) => action(),send:async (method,url,value) => { body = value; return { message:'Reset' }; },toast:() => {}
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('    async function trialResetForm('),source.indexOf('    async function clientOptions(')),context);
    await context.trialResetForm('9','Client',() => {});
    assert.equal((html.match(/name="modules"[^>]+checked/g) || []).length,6);
    assert.ok(html.includes('a des reference de Catalogue produits, Patients et assurances'));
    assert.ok(html.includes('value="stock_movements" checked>Mouvements de stock'));
    assert.ok(html.includes('a des reference de Ventes, factures et ordonnances'));
    await form.onsubmit({ preventDefault(){} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual([...body.modules],['cash']);
    selected = [];
    await assert.rejects(form.onsubmit({ preventDefault(){} }) || Promise.resolve());
});
