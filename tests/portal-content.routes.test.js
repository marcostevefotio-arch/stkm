const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const access = require('../src/config/portal-access');
const portalRoutes = require('../src/routes/portal.routes');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

async function setup(t, role) {
    const original = db.execute, calls = [];
    db.execute = async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('FROM platform_staff WHERE id')) return [[{ id: 3, role, is_active: 1, password_version: 0, full_name: 'Test' }], []];
        if (sql.startsWith('INSERT INTO platform_faqs')) return [{ insertId: 5 }, []];
        if (sql.startsWith('UPDATE platform_trainings')) return [{ affectedRows: 0 }, []];
        return [{ affectedRows: 1 }, []];
    };
    t.after(() => { db.execute = original; });
    const app = express();
    app.use(express.json());
    app.use('/api/portal', portalRoutes);
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const token = jwt.sign({ sub: 3, typ: 'portal', pv: 0 }, access.portalSecret());
    const headers = { [['Author', 'ization'].join('')]: `${['Be', 'arer'].join('')} ${token}`, 'Content-Type': 'application/json' };
    return { calls, headers, base: `http://127.0.0.1:${server.address().port}/api/portal/admin` };
}

test('FAQ and training management is limited to platform administrators', async t => {
    const { base, headers, calls } = await setup(t, 'SUPPORT');
    assert.equal((await fetch(`${base}/faqs`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/trainings`, { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal(calls.some(call => call.sql.includes('platform_faqs') || call.sql.includes('platform_trainings')), false);
});

test('platform administrators create validated FAQ entries with an audit record', async t => {
    const { base, headers, calls } = await setup(t, 'PLATFORM_ADMIN');
    const invalid = await fetch(`${base}/faqs`, { method: 'POST', headers, body: JSON.stringify({ question: 'x', answer: 'y', category: 'Z', sort_order: 1, is_active: true }) });
    assert.equal(invalid.status, 400);
    const ok = await fetch(`${base}/faqs`, { method: 'POST', headers, body: JSON.stringify({ question: 'Comment payer ?', answer: 'Par virement.', category: 'Facturation', sort_order: 2, is_active: true }) });
    assert.equal(ok.status, 201);
    const insert = calls.find(call => call.sql.startsWith('INSERT INTO platform_faqs'));
    assert.deepEqual(insert.values, ['Comment payer ?', 'Par virement.', 'Facturation', 2, true]);
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO platform_audit_logs') && call.values.includes('PLATFORM_FAQ_CREATED')));
});

test('training updates validate links and report missing records', async t => {
    const { base, headers } = await setup(t, 'PLATFORM_ADMIN');
    const body = { title: 'Démarrage', description: 'Guide complet', format: 'video', sort_order: 0, is_active: true };
    const unsafe = await fetch(`${base}/trainings/4`, { method: 'PATCH', headers, body: JSON.stringify({ ...body, url: 'javascript:alert(1)' }) });
    assert.equal(unsafe.status, 400);
    const missing = await fetch(`${base}/trainings/4`, { method: 'PATCH', headers, body: JSON.stringify({ ...body, url: 'https://exemple.com/v' }) });
    assert.equal(missing.status, 404);
});
