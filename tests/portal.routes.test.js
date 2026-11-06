const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../src/config/database');
const access = require('../src/config/portal-access');
const portalRoutes = require('../src/routes/portal.routes');
const { authenticateApiToken } = require('../src/middleware/api-token');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

async function listen(t, router, mount = '/api/portal') {
    const app = express(); app.use(express.json()); app.use(mount, router);
    const server = app.listen(0); t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}${mount}`;
}
const staffToken = (id = 1, pv = 0) => jwt.sign({ sub: id, typ: 'portal', pv }, access.portalSecret());
const staffRow = (role = 'PLATFORM_ADMIN', id = 1) => ({ id, full_name: 'Agent', email: 'a@x.io', role, is_active: 1, password_version: 0, password_hash: 'x' });
function mockDb(t, handler) { const original = db.execute; db.execute = async (sql, values) => handler(sql, values); t.after(() => { db.execute = original; }); }

test('API tokens are hashed, prefixed and verifiable', () => {
    const { token, prefix, hash } = access.generateApiToken();
    assert.match(token, /^rsk_[a-f0-9]{48}$/);
    assert.equal(prefix, token.slice(0, 12));
    assert.equal(hash, access.hashToken(token));
    assert.notEqual(hash, token);
});

test('schedule validation rejects bad times, overlaps and bad days', () => {
    assert.equal(access.validateShifts([{ weekday: 1, start_time: '08:00', end_time: '12:00' }, { weekday: 1, start_time: '13:00', end_time: '17:00' }]), null);
    assert.ok(access.validateShifts([{ weekday: 1, start_time: '12:00', end_time: '08:00' }]));
    assert.ok(access.validateShifts([{ weekday: 8, start_time: '08:00', end_time: '09:00' }]));
    assert.ok(access.validateShifts([{ weekday: 2, start_time: '08:00', end_time: '12:00' }, { weekday: 2, start_time: '11:00', end_time: '13:00' }]));
    assert.ok(access.validateShifts('nope'));
});

test('on-duty detection follows weekday and time window', () => {
    const monday10 = new Date(2026, 10, 2, 10, 0), monday17 = new Date(2026, 10, 2, 17, 0);
    const shifts = [{ weekday: 1, start_time: '08:00:00', end_time: '17:00:00' }];
    assert.equal(access.isOnDuty(shifts, monday10), true);
    assert.equal(access.isOnDuty(shifts, monday17), false);
    assert.equal(access.isOnDuty(shifts, new Date(2026, 10, 3, 10, 0)), false);
});

test('portal rejects missing, tenant and wrongly signed tokens', async t => {
    let queries = 0; mockDb(t, async () => { queries += 1; return [[], []]; });
    const url = await listen(t, portalRoutes);
    assert.equal((await fetch(`${url}/me`)).status, 401);
    const tenantToken = jwt.sign({ sub: 1, pv: 0 }, process.env.JWT_SECRET);
    assert.equal((await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${tenantToken}` } })).status, 401);
    const wrongType = jwt.sign({ sub: 1, typ: 'user', pv: 0 }, access.portalSecret());
    assert.equal((await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${wrongType}` } })).status, 401);
    assert.equal(queries, 0);
});

test('portal login checks credentials and issues a portal token', async t => {
    const hash = await bcrypt.hash('Correct-Horse-9', 4);
    mockDb(t, async sql => {
        if (sql.startsWith('SELECT * FROM platform_staff WHERE email')) return [[{ ...staffRow(), password_hash: hash }], []];
        return [{}, []];
    });
    const url = await listen(t, portalRoutes);
    const post = body => fetch(`${url}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ email: 'a@x.io', password: 'wrong' })).status, 401);
    const ok = await post({ email: 'a@x.io', password: 'Correct-Horse-9' });
    assert.equal(ok.status, 200);
    const data = await ok.json();
    assert.equal(jwt.verify(data.token, access.portalSecret()).typ, 'portal');
    assert.equal(data.staff.password_hash, undefined);
});

test('read-only staff cannot change clients, tokens or staff', async t => {
    let writes = 0;
    mockDb(t, async sql => { if (/^(UPDATE|INSERT|DELETE)/i.test(sql)) writes += 1; return [sql.includes('FROM platform_staff WHERE id') ? [staffRow('VIEWER')] : [], []]; });
    const url = await listen(t, portalRoutes), headers = { Authorization: `Bearer ${staffToken()}`, 'Content-Type': 'application/json' };
    const attempts = [['PATCH', '/clients/5/status', { status: 'suspended' }], ['POST', '/tokens', { organization_id: 5, name: 'Intégration' }], ['POST', '/staff', { full_name: 'X Y', email: 'x@y.io', password: 'Aaaaaaaaaaaa1!' }], ['POST', '/claims', { organization_id: 5, subject: 'Sujet', description: 'Description longue' }]];
    for (const [method, path, body] of attempts) assert.equal((await fetch(`${url}${path}`, { method, headers, body: JSON.stringify(body) })).status, 403, path);
    assert.equal(writes, 0);
});

test('support staff can reply to a ticket as staff without touching users', async t => {
    const inserts = [];
    mockDb(t, async (sql, values) => {
        if (sql.includes('FROM platform_staff WHERE id')) return [[staffRow('SUPPORT', 7)], []];
        if (sql.startsWith('SELECT id,organization_id,status,assigned_staff_id FROM support_tickets')) return [[{ id: 3, organization_id: 9, status: 'open', assigned_staff_id: null }], []];
        if (sql.startsWith('INSERT INTO support_ticket_messages')) inserts.push(values);
        return [{}, []];
    });

    const url = await listen(t, portalRoutes);
    const response = await fetch(`${url}/support/3/messages`, { method: 'POST', headers: { Authorization: `Bearer ${staffToken(7)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Bonjour' }) });
    assert.equal(response.status, 201);
    assert.deepEqual(inserts[0], [9, 3, 7, 'Bonjour']);
});

test('marking an invoice paid records its partner commission in the same transaction', async t => {
    const originalGetConnection = db.getConnection;
    let committed = false, rolledBack = false, commissionValues;
    db.getConnection = async () => ({
        beginTransaction: async () => {},
        commit: async () => { committed = true; },
        rollback: async () => { rolledBack = true; },
        release: () => {},
        execute: async (sql, values) => {
            if (sql.startsWith('SELECT id,status,organization_id,total_amount,currency FROM platform_invoices')) return [[{ id: 22, status: 'sent', organization_id: 9, total_amount: '123.45', currency: 'XAF' }], []];
            if (sql.startsWith('SELECT partner_id FROM organizations')) return [[{ partner_id: 5 }], []];
            if (sql.startsWith('SELECT id FROM platform_partner_commissions')) return [[], []];
            if (sql.startsWith('SELECT id,commission_percent FROM platform_partners')) return [[{ id: 5, commission_percent: '10.00' }], []];
            if (sql.includes("setting_key='partner_program'")) return [[{ setting_value: JSON.stringify({ default_commission_percent: 8 }) }], []];
            if (sql.startsWith('INSERT INTO platform_partner_commissions')) { commissionValues = values; return [{ insertId: 31 }, []]; }
            return [{ affectedRows: 1 }, []];
        }
    });
    t.after(() => { db.getConnection = originalGetConnection; });
    mockDb(t, async sql => sql.includes('FROM platform_staff WHERE id') ? [[staffRow('PLATFORM_ADMIN')], []] : [[], []]);
    const url = await listen(t, portalRoutes);
    const response = await fetch(`${url}/invoices/22/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${staffToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' })
    });
    assert.equal(response.status, 200);
    assert.equal(committed, true);
    assert.equal(rolledBack, false);
    assert.deepEqual(commissionValues, [5, 9, 22, '123.45', 10, 12.35, 'XAF']);
});

test('platform administrators can create configurable plans with selected modules and prices', async t => {
    const originalGetConnection = db.getConnection, statements = [];
    let committed = false;
    db.getConnection = async () => ({
        beginTransaction: async () => {},
        commit: async () => { committed = true; },
        rollback: async () => {},
        release: () => {},
        execute: async (sql, values) => {
            statements.push({ sql, values });
            if (sql.startsWith('INSERT INTO plans')) return [{ insertId: 44 }, []];
            return [{ affectedRows: 1 }, []];
        }
    });
    t.after(() => { db.getConnection = originalGetConnection; });
    mockDb(t, async sql => sql.includes('FROM platform_staff WHERE id') ? [[staffRow('PLATFORM_ADMIN')], []] : [[], []]);
    const url = await listen(t, portalRoutes);
    const headers = { Authorization: `Bearer ${staffToken()}`, 'Content-Type': 'application/json' };
    const invalid = await fetch(`${url}/admin/pricing`, {
        method: 'POST', headers,
        body: JSON.stringify({ code: 'clinic-custom', name: 'Clinique personnalisée', currency: 'XAF', max_users: 5, max_products: 10000, extra_user_price: 0, included_modules: ['stock'], module_prices: { stock: { monthly: 0 } }, is_active: true })
    });
    assert.equal(invalid.status, 400);
    const response = await fetch(`${url}/admin/pricing`, {
        method: 'POST', headers,
        body: JSON.stringify({
            code: 'clinic-custom', name: 'Clinique personnalisée', currency: 'XAF',
            max_users: 5, max_products: 10000, extra_user_price: 1000,
            included_modules: ['stock', 'sales'],
            module_prices: { stock: { monthly: 12000, annual: 120000 }, sales: { monthly: 8000 } },
            is_active: true
        })
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 44, message: 'Forfait créé.' });
    const insert = statements.find(item => item.sql.startsWith('INSERT INTO plans'));
    assert.deepEqual(insert.values, ['clinic-custom', 'Clinique personnalisée', '["stock","sales"]', '{"stock":{"monthly":12000,"annual":120000},"sales":{"monthly":8000}}', 1000, 'XAF', 5, 10000, true]);
    assert.equal(committed, true);
});

test('promotions can target one existing subscription plan', async t => {
    const statements = [];
    mockDb(t, async (sql, values) => {
        statements.push({ sql, values });
        if (sql.includes('FROM platform_staff WHERE id')) return [[staffRow('PLATFORM_ADMIN')], []];
        if (sql.startsWith("SELECT id FROM plans WHERE id=? AND plan_type<>'trial'")) return [[{ id: 8 }], []];
        if (sql.startsWith('INSERT INTO platform_promotions')) return [{ insertId: 12 }, []];
        return [{ affectedRows: 1 }, []];
    });
    const url = await listen(t, portalRoutes);
    const response = await fetch(`${url}/admin/promotions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code: 'PLAN8', name: 'Promotion forfait 8', plan_id: '8',
            discount_type: 'percent', discount_value: 15, starts_at: '2026-11-05',
            ends_at: null, new_users_only: false, is_active: true
        })
    });
    assert.equal(response.status, 201);
    const insert = statements.find(item => item.sql.startsWith('INSERT INTO platform_promotions'));
    assert.deepEqual(insert.values, ['PLAN8', 'Promotion forfait 8', '8', 'percent', 15, '2026-11-05', null, false, true]);
});

test('employees can only have one active work-clock session', async t => {
    const originalGetConnection = db.getConnection;
    let active = false, committed = 0, rolledBack = 0;
    db.getConnection = async () => ({
        beginTransaction: async () => {},
        commit: async () => { committed += 1; },
        rollback: async () => { rolledBack += 1; },
        release: () => {},
        execute: async sql => {
            if (sql.includes('FROM platform_staff WHERE id=?')) return [[{ id: 7 }], []];
            if (sql.includes('FROM platform_staff_work_sessions WHERE staff_id=?')) return [active ? [{ id: 11 }] : [], []];
            if (sql.startsWith('INSERT INTO platform_staff_work_sessions')) { active = true; return [{ insertId: 11 }, []]; }
            if (sql.includes('FROM platform_staff_work_sessions WHERE id=?')) return [[{ id: 11, clock_in: '2026-11-05 09:00:00' }], []];
            throw Error(`Unexpected SQL: ${sql}`);
        }
    });
    t.after(() => { db.getConnection = originalGetConnection; });
    mockDb(t, async sql => sql.includes('FROM platform_staff WHERE id') ? [[staffRow('SUPPORT', 7)], []] : [[], []]);
    const url = await listen(t, portalRoutes), headers = { Authorization: `Bearer ${staffToken(7)}` };
    const first = await fetch(`${url}/me/time-clock/start`, { method: 'POST', headers });
    assert.equal(first.status, 201);
    assert.equal((await first.json()).active.id, 11);
    const duplicate = await fetch(`${url}/me/time-clock/start`, { method: 'POST', headers });
    assert.equal(duplicate.status, 409);
    assert.equal(committed, 1);
    assert.equal(rolledBack, 1);
});

test('work history periods are validated and non-admins only query their own records', async t => {
    const queries = [];
    mockDb(t, async (sql, values) => {
        queries.push({ sql, values });
        if (sql.includes('FROM platform_staff WHERE id')) return [[staffRow('SUPPORT', 7)], []];
        if (sql.startsWith('SELECT COUNT(*) total FROM platform_staff_work_sessions')) return [[{ total: 0 }], []];
        return [[], []];
    });
    const url = await listen(t, portalRoutes), headers = { Authorization: `Bearer ${staffToken(7)}` };
    assert.equal((await fetch(`${url}/work-history?period=invalid`, { headers })).status, 400);
    assert.equal((await fetch(`${url}/work-history?period=month&staff_id=8`, { headers })).status, 403);
    const response = await fetch(`${url}/work-history?period=biweek`, { headers });
    assert.equal(response.status, 200);
    const history = await response.json();
    assert.equal(history.period, 'biweek');
    assert.match(history.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(history.end, /^\d{4}-\d{2}-\d{2}$/);
    const historyQueries = queries.filter(query => query.sql.includes('platform_staff_work_sessions') || query.sql.includes('FROM support_tickets t'));
    assert.equal(historyQueries.length, 4);
    assert.ok(historyQueries.every(query => query.values.some(value => Number(value) === 7)));
});

test('administrators can record a mandatory support-ticket assignment', async t => {
    const calls = [];
    mockDb(t, async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('FROM platform_staff WHERE id')) return [[staffRow()], []];
        if (sql.includes('SELECT id,organization_id,status FROM support_tickets')) return [[{ id: 3, organization_id: 9, status: 'in_progress' }], []];
        if (sql.includes('SELECT id FROM platform_staff WHERE id=? AND is_active=TRUE')) return [[{ id: 8 }], []];
        return [{ affectedRows: 1 }, []];
    });
    const url = await listen(t, portalRoutes);
    const response = await fetch(`${url}/support/3/assignment`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${staffToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_staff_id: '8' })
    });
    assert.equal(response.status, 200);
    const update = calls.find(call => call.sql.startsWith('UPDATE support_tickets'));
    assert.deepEqual(update.values, ['assigned', '8', '8', '3']);
    const audit = calls.find(call => call.sql.includes('INSERT INTO platform_audit_logs'));
    assert.equal(audit.values[2], 'SUPPORT_TICKET_ASSIGNED');
});

test('api token middleware only accepts active, unexpired, unrevoked keys', async t => {
    const { token, hash } = access.generateApiToken();
    let seenHash = null;
    mockDb(t, async (sql, values) => {
        if (sql.includes('FROM client_api_tokens')) { seenHash = values[0]; return [seenHash === hash ? [{ id: 1, organization_id: 4, organization_name: 'Clinique', organization_status: 'active' }] : [], []]; }
        return [{}, []];
    });
    const router = express.Router(); router.get('/me', authenticateApiToken, (req, res) => res.json({ org: req.tenantId }));
    const url = await listen(t, router, '/api/v1');
    assert.equal((await fetch(`${url}/me`)).status, 401);
    assert.equal((await fetch(`${url}/me`, { headers: { Authorization: 'Bearer rsk_' + 'a'.repeat(48) } })).status, 401);
    const ok = await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).org, 4);
    assert.equal(seenHash, hash);
});

test('traffic meter batches tenant requests and flushes one upsert per day', async t => {
    const traffic = require('../src/middleware/traffic');
    const calls = [];
    mockDb(t, async (sql, values) => { calls.push({ sql, values }); return [{}]; });
    traffic.record(7, 200, 100); traffic.record(7, 404, 50); traffic.record(7, 500, 0);
    await traffic.flush();
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /tenant_traffic_daily/);
    assert.deepEqual([calls[0].values[0], ...calls[0].values.slice(2)], [7, 3, 1, 1, 150]);
    await traffic.flush();
    assert.equal(calls.length, 1);
});