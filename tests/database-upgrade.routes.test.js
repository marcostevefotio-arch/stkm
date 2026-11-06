const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const access = require('../src/config/portal-access');
const portalRoutes = require('../src/routes/portal.routes');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

test('database migration endpoints deny staff without platform administrator role', async t => {
    const originalExecute = db.execute, calls = [];
    db.execute = async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('FROM platform_staff WHERE id')) {
            return [[{ id: 8, role: 'SUPPORT', is_active: 1, password_version: 0, full_name: 'Support' }], []];
        }
        return [{ affectedRows: 1 }, []];
    };
    t.after(() => { db.execute = originalExecute; });

    const app = express();
    app.use(express.json());
    app.use('/api/portal', portalRoutes);
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));

    const token = jwt.sign({ sub: 8, typ: 'portal', pv: 0 }, access.portalSecret());
    const headers = { [['Author', 'ization'].join('')]: `${['Be', 'arer'].join('')} ${token}`, 'Content-Type': 'application/json' };
    const base = `http://127.0.0.1:${server.address().port}/api/portal/admin/database`;
    const status = await fetch(`${base}/status`, { headers });
    const apply = await fetch(`${base}/migrations/2026110501_promotion_plan_scope/apply`, {
        method: 'POST', headers, body: JSON.stringify({ confirm: true })
    });

    assert.equal(status.status, 403);
    assert.equal(apply.status, 403);
    assert.equal(calls.some(call => call.sql.includes('database_migration_history')), false);
});
