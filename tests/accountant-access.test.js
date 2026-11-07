const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const { authenticate } = require('../src/middleware/auth');
const accounting = require('../src/routes/accounting.routes');
const admin = require('../src/routes/admin.routes');

test('authenticated accountant is restricted to their tenant accounting and own account', async t => {
 const oldSecret = process.env.JWT_SECRET, oldFlag = process.env.ACCOUNTING_EXPERIMENTAL_ENABLED, execute = db.execute;
 process.env.JWT_SECRET = 'test-secret-accountant'; process.env.ACCOUNTING_EXPERIMENTAL_ENABLED = 'true';
 const calls = [];
 db.execute = async (sql, values) => {
  calls.push({ sql, values });
  if (sql.includes('FROM users u JOIN organizations')) return [[{ id: 8, organization_id: 42, role: 'ACCOUNTANT', is_active: 1, password_version: 0, organization_status: 'active', subscription_modules: null }]];
  if (sql.includes('FROM organization_settings')) return [[{ currency: 'XAF' }]];
  if (sql.includes('FROM accounting_books')) return [[]];
  throw Error(`Unexpected query: ${sql}`);
 };
 t.after(() => {
  db.execute = execute;
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
  if (oldFlag === undefined) delete process.env.ACCOUNTING_EXPERIMENTAL_ENABLED; else process.env.ACCOUNTING_EXPERIMENTAL_ENABLED = oldFlag;
 });
 const app = express(); app.use(express.json());
 app.use('/api', authenticate);
 app.get('/api/auth/me', (req, res) => res.json({ role: req.user.role }));
 app.put('/api/auth/password', (req, res) => res.sendStatus(204));
 app.use('/api/accounting', accounting);
 app.use('/api/admin', admin);
 app.all('/api/:resource', (req, res) => res.sendStatus(204));
 const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => server.close(resolve)));
 const base = `http://127.0.0.1:${server.address().port}`, headers = { Authorization: `Bearer ${jwt.sign({ sub: 8 }, process.env.JWT_SECRET)}` };
 assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 200);
 assert.equal((await fetch(`${base}/api/auth/password`, { headers, method: 'PUT' })).status, 204);
 assert.equal((await fetch(`${base}/api/accounting/book?organization_id=99`, { headers })).status, 200);
 assert.deepEqual(calls.find(call => call.sql.includes('FROM accounting_books')).values, [42]);
 const context = await fetch(`${base}/api/accounting/context`, { headers });
 assert.deepEqual(await context.json(), { currency: 'XAF' });
 assert.deepEqual(calls.find(call => call.sql.includes('FROM organization_settings')).values, [42]);
 for (const path of ['/api/products', '/api/sales', '/api/settings', '/api/reports', '/api/admin/users', '/api/accounting-extra', '/api/auth/password']) {
  assert.equal((await fetch(`${base}${path}`, { headers })).status, 403, path);
 }
});

test('accountant account cannot be created before its migration', async t => {
 const getConnection = db.getConnection;
 let wroteUser = false, rolledBack = false;
 db.getConnection = async () => ({
  beginTransaction: async () => {}, rollback: async () => { rolledBack = true; }, commit: async () => {}, release() {},
  execute: async sql => {
   if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_TYPE: "enum('OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','SUPER_ADMIN')" }]];
   if (sql.includes('INSERT INTO users')) wroteUser = true;
   return [[]];
  }
 });
 t.after(() => { db.getConnection = getConnection; });
 const app = express(); app.use(express.json());
 app.use((req, res, next) => { req.user = { id: 7, role: 'ADMIN' }; req.tenantId = 42; next(); });
 app.use('/api/admin', admin);
 const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => server.close(resolve)));
 const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ full_name: 'Expert', email: 'expert@example.com', role: 'ACCOUNTANT', password: 'secure-password-123' })
 });
 assert.equal(response.status, 409);
 assert.match((await response.json()).error, /2026110604/);
 assert.equal(rolledBack, true); assert.equal(wroteUser, false);
});

test('administrator creates an accountant only for their own tenant and audits the assignment', async t => {
 const getConnection = db.getConnection;
 const calls = [];
 db.getConnection = async () => ({
  beginTransaction: async () => calls.push('begin'), rollback: async () => calls.push('rollback'),
  commit: async () => calls.push('commit'), release() {},
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_TYPE: "enum('OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','SUPER_ADMIN','ACCOUNTANT')" }]];
   if (sql.includes('FROM subscriptions')) return [[{ max_users: 5, active_users: 2 }]];
   if (sql.startsWith('INSERT INTO users')) return [{ insertId: 12 }];
   return [[]];
  }
 });
 t.after(() => { db.getConnection = getConnection; });
 const app = express(); app.use(express.json());
 app.use((req, res, next) => { req.user = { id: 7, role: 'ADMIN' }; req.tenantId = 42; next(); });
 app.use('/api/admin', admin);
 const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => server.close(resolve)));
 const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/users`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ full_name: 'Expert', email: 'expert@example.com', role: 'ACCOUNTANT', password: 'secure-password-123' })
 });
 assert.equal(response.status, 201);
 const insert = calls.find(call => call.sql && call.sql.startsWith('INSERT INTO users'));
 assert.equal(insert.values[0], 42);
 assert.equal(insert.values[4], 'ACCOUNTANT');
 const audit = calls.find(call => call.sql && call.sql.includes('INSERT INTO audit_logs'));
 assert.equal(audit.values[0], 42);
 assert.equal(JSON.parse(audit.values[5]).role, 'ACCOUNTANT');
 assert.ok(calls.includes('commit')); assert.ok(!calls.includes('rollback'));
});
