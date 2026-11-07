const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const express = require('express');
const db = require('../src/config/database');
const routes = require('../src/routes/accounting.routes');

test('MySQL accepts accounting schema and entry operations on connection-local temporary tables', {
 skip: process.env.ACCOUNTING_MYSQL_INTEGRATION !== 'true'
}, async t => {
 const connection = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
  charset: 'utf8mb4'
 });
 t.after(async () => { await connection.end(); });
 const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
 for (const table of ['accounting_books', 'accounting_entries']) {
  const statement = schema.split(/;\s*(?:\r?\n|$)/).map(value => value.trim())
   .find(value => value.startsWith(`CREATE TABLE IF NOT EXISTS ${table} (`));
  assert.ok(statement, `Missing ${table} schema`);
  const temporary = statement.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE')
   .replace(/^\s*FOREIGN KEY[^\r\n]*\r?\n/gm, '').replace(/,\s*\) ENGINE/, '\n) ENGINE');
  await connection.query(temporary);
 }
 const reviewSchema = fs.readFileSync(path.join(__dirname, '../database/accounting-review.sql'), 'utf8');
 await connection.query(reviewSchema.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMPORARY TABLE')
  .replace(/^\s*FOREIGN KEY[^\r\n]*\r?\n/gm, '').replace(/,\s*\) ENGINE/, '\n) ENGINE'));
 await connection.query('CREATE TEMPORARY TABLE organization_settings (organization_id BIGINT UNSIGNED PRIMARY KEY, currency CHAR(3) NOT NULL) ENGINE=InnoDB');
 await connection.query('CREATE TEMPORARY TABLE users (id BIGINT UNSIGNED PRIMARY KEY, full_name VARCHAR(180) NOT NULL) ENGINE=InnoDB');
 await connection.execute('INSERT INTO organization_settings VALUES(?,?)', [42, 'XAF']);
 await connection.execute('INSERT INTO users VALUES(?,?)', [7, 'Expert']);
 await connection.query(`CREATE TEMPORARY TABLE audit_logs (
  organization_id BIGINT UNSIGNED, user_id BIGINT UNSIGNED, action VARCHAR(100),
  entity_type VARCHAR(100), entity_id BIGINT UNSIGNED, details_json JSON NULL
 ) ENGINE=InnoDB`);
 const accounts = [
  { id: 'cash', code: '571', name: 'Caisse', type: 'asset', cash: true },
  { id: 'sales', code: '701', name: 'Ventes', type: 'income', cash: false }
 ];
 await connection.execute('INSERT INTO accounting_books(organization_id,opening_date,accounts,created_by) VALUES(?,?,?,?)',
  [42, '2026-01-01', JSON.stringify(accounts), 7]);
 const originalGetConnection = db.getConnection, originalExecute = db.execute;
 const previousFlag = process.env.ACCOUNTING_EXPERIMENTAL_ENABLED;
 let failAudit = false;
 db.getConnection = async () => ({
  beginTransaction: () => connection.beginTransaction(), commit: () => connection.commit(),
  rollback: () => connection.rollback(), release: () => {},
  execute: (...args) => {
   if (failAudit && args[0].includes('INSERT INTO audit_logs')) throw new Error('Audit unavailable');
   return connection.execute(...args);
  }
 });
 db.execute = (...args) => connection.execute(...args);
 process.env.ACCOUNTING_EXPERIMENTAL_ENABLED = 'true';
 t.after(() => {
  db.getConnection = originalGetConnection; db.execute = originalExecute;
  if (previousFlag === undefined) delete process.env.ACCOUNTING_EXPERIMENTAL_ENABLED;
  else process.env.ACCOUNTING_EXPERIMENTAL_ENABLED = previousFlag;
 });
 const app = express(); app.use(express.json());
 let role = 'ADMIN', tenantId = 42;
 app.use((req, res, next) => { req.tenantId = tenantId; req.user = { id: 7, role }; next(); });
 app.use('/accounting', routes);
 app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
 const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => server.close(resolve)));
 const url = `http://127.0.0.1:${server.address().port}/accounting`;
 const lines = [
  { accountId: 'cash', debit: '10.00', credit: '0', flow: 'operating' },
  { accountId: 'sales', debit: '0', credit: '10.00', flow: null }
 ];
 const payload = { date: '2026-01-02', kind: 'normal', description: 'Vente', lines };
 const headers = { 'content-type': 'application/json' };
 let response = await fetch(`${url}/entries`, { method: 'POST', headers, body: JSON.stringify(payload) });
 assert.equal(response.status, 201, await response.text());
 response = await fetch(`${url}/entries/1`, { method: 'PUT', headers, body: JSON.stringify({ ...payload, description: 'Vente corrigée' }) });
 assert.equal(response.status, 200, await response.text());
 response = await fetch(`${url}/entries`);
 assert.equal(response.status, 200);
 assert.equal((await response.json())[0].description, 'Vente corrigée');
 response = await fetch(`${url}/entries/1/post`, { method: 'POST' });
 assert.equal(response.status, 200, await response.text());
 response = await fetch(`${url}/income-statement?from=2026-01-01&to=2026-01-31`);
 assert.equal(response.status, 200);
 assert.equal((await response.json()).totals.net, '10.00');
 response = await fetch(`${url}/reviews`, { method: 'POST', headers, body: JSON.stringify({ from: '2026-01-01', to: '2026-01-31' }) });
 assert.equal(response.status, 201);
 const preliminary = await response.json();
 response = await fetch(`${url}/reviews/${preliminary.id}`);
 assert.equal(response.status, 200);
 const frozen = await response.json();
 assert.equal(frozen.snapshot.reports.income.totals.net, '10.00');
 assert.equal(frozen.snapshot.reports.tax, null);
 response = await fetch(`${url}/reviews/${preliminary.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: preliminary.hash, confirmed: true }) });
 assert.equal(response.status, 403);
 role = 'ACCOUNTANT';
 response = await fetch(`${url}/reviews/${preliminary.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: preliminary.hash, confirmed: false }) });
 assert.equal(response.status, 400);
 response = await fetch(`${url}/reviews/${preliminary.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: '0'.repeat(64), confirmed: true }) });
 assert.equal(response.status, 409);
 failAudit = true;
 response = await fetch(`${url}/reviews/${preliminary.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: preliminary.hash, confirmed: true }) });
 assert.equal(response.status, 500);
 const [afterRollback] = await connection.execute("SELECT COUNT(*) count FROM accounting_review_snapshots WHERE status='final'");
 assert.equal(Number(afterRollback[0].count), 0);
 failAudit = false;
 response = await fetch(`${url}/reviews/${preliminary.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: preliminary.hash, confirmed: true }) });
 assert.equal(response.status, 201);
 const final = await response.json();
 response = await fetch(`${url}/reviews/${final.id}`);
 assert.equal(response.status, 200);
 assert.deepEqual((await response.json()).snapshot, frozen.snapshot);
 response = await fetch(`${url}/reviews/${preliminary.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: preliminary.hash, confirmed: true }) });
 assert.equal(response.status, 409);
 response = await fetch(`${url}/reviews`, { method: 'POST', headers, body: JSON.stringify({ from: '2026-01-01', to: '2026-01-31' }) });
 const stale = await response.json();
 response = await fetch(`${url}/entries`, { method: 'POST', headers, body: JSON.stringify({ ...payload, description: 'Ajustement' }) });
 const adjustment = await response.json();
 assert.equal((await fetch(`${url}/entries/${adjustment.id}/post`, { method: 'POST' })).status, 200);
 response = await fetch(`${url}/reviews/${stale.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: stale.hash, confirmed: true }) });
 assert.equal(response.status, 409);
 assert.match((await response.json()).error, /ont changé/);
 response = await fetch(`${url}/reviews/${final.id}`);
 assert.deepEqual((await response.json()).snapshot, frozen.snapshot);
 await connection.execute('UPDATE accounting_review_snapshots SET snapshot_text=? WHERE id=?', ['{}', stale.id]);
 assert.equal((await fetch(`${url}/reviews/${stale.id}`)).status, 500);
 response = await fetch(`${url}/reviews/${stale.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: stale.hash, confirmed: true }) });
 assert.equal(response.status, 500);
 tenantId = 99;
 assert.equal((await fetch(`${url}/reviews/${final.id}`)).status, 404);
 assert.equal((await fetch(`${url}/reviews/${final.id}/finalize`, { method: 'POST', headers, body: JSON.stringify({ hash: final.hash, confirmed: true }) })).status, 409);
});
