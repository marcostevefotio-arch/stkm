const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const db = require('../src/config/database');
const routes = require('../src/routes/accounting.routes');
const accounts = [
 { id: 'cash', code: '571', name: 'Caisse', type: 'asset', cash: true },
 { id: 'sales', code: '701', name: 'Ventes', type: 'income', cash: false }
];
const lines = [
 { accountId: 'cash', debit: '100.00', credit: '0', flow: 'operating' },
 { accountId: 'sales', debit: '0', credit: '100.00', flow: null }
];

async function setup(t, role = 'ADMIN') {
 const previousFlag = process.env.ACCOUNTING_EXPERIMENTAL_ENABLED;
 process.env.ACCOUNTING_EXPERIMENTAL_ENABLED = 'true';
 t.after(() => {
  if (previousFlag === undefined) delete process.env.ACCOUNTING_EXPERIMENTAL_ENABLED;
  else process.env.ACCOUNTING_EXPERIMENTAL_ENABLED = previousFlag;
 });
 const app = express(); app.use(express.json());
 app.use((req, res, next) => { req.tenantId = 42; req.user = { id: 7, role }; next(); });
 app.use('/accounting', routes);
 app.use((error, req, res, next) => res.status(500).json({ error: error.message }));
 const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
 t.after(() => new Promise(resolve => server.close(resolve)));
 return `http://127.0.0.1:${server.address().port}/accounting`;
}

test('experimental accounting is disabled by default', async t => {
 const url = await setup(t);
 delete process.env.ACCOUNTING_EXPERIMENTAL_ENABLED;
 const response = await fetch(`${url}/book`);
 assert.equal(response.status, 503);
 assert.match((await response.json()).error, /désactivé/);
 assert.equal((await fetch(`${url}/cash-flow?from=2026-01-01&to=2026-01-31`)).status, 503);
 assert.equal((await fetch(`${url}/tax?from=2026-01-01&to=2026-01-31`)).status, 503);
});

test('accounting routes deny non-admin roles before database access', async t => {
 const original = db.execute; let called = false;
 db.execute = async () => { called = true; throw Error('unexpected'); };
 t.after(() => { db.execute = original; });
 const url = await setup(t, 'VIEWER');
 const response = await fetch(`${url}/book`);
 assert.equal(response.status, 403); assert.equal(called, false);
 assert.equal((await fetch(`${url}/cash-flow?from=2026-01-01&to=2026-01-31`)).status, 403);
 assert.equal((await fetch(`${url}/tax?from=2026-01-01&to=2026-01-31`)).status, 403);
});

test('invalid books and dates are rejected before database access', async t => {
 const original = db.getConnection; let called = false;
 db.getConnection = async () => { called = true; throw Error('unexpected'); };
 t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/book`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openingDate: '2026-02-31', accounts }) });
 assert.equal(response.status, 400); assert.equal(called, false);
});

test('adding an account locks the tenant book, preserves existing accounts and audits atomically', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   return [{ affectedRows: 1 }];
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const account = { id: 'tax', code: '443', name: 'Taxe', type: 'liability', cash: false, tax: 'payable' };
 const response = await fetch(`${url}/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
 assert.equal(response.status, 201); assert.deepEqual((await response.json()).account, account);
 const read = calls.find(call => call.sql && call.sql.includes('FROM accounting_books'));
 assert.match(read.sql, /organization_id=\? FOR UPDATE/); assert.deepEqual(read.values, [42]);
 const update = calls.find(call => call.sql && call.sql.startsWith('UPDATE accounting_books'));
 assert.deepEqual(JSON.parse(update.values[0]), [...accounts, account]); assert.equal(update.values[1], 42);
 const audit = calls.find(call => call.sql && call.sql.includes('INSERT INTO audit_logs'));
 assert.equal(audit.values[2], 'ACCOUNTING_ACCOUNT_CREATED');
 assert.deepEqual(JSON.parse(audit.values[5]), { account });
 assert.ok(calls.includes('commit')); assert.ok(!calls.includes('rollback')); assert.ok(calls.includes('release'));
});

test('adding invalid, duplicate, or excessive accounts never writes and audit failures roll back', async t => {
 const original = db.getConnection, calls = []; let current = null, auditFails = false;
 const connection = {
  beginTransaction: async () => {}, commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => {},
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [current ? [current] : []];
   if (sql.includes('INSERT INTO audit_logs') && auditFails) throw Error('Audit unavailable');
   return [{ affectedRows: 1 }];
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const post = account => fetch(`${url}/accounts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account }) });
 const account = { id: 'tax', code: '443', name: 'Taxe', type: 'liability', cash: false, tax: 'payable' };
 assert.equal((await post({ ...account, unexpected: 1 })).status, 400);
 assert.equal(calls.length, 0);
 assert.equal((await post(account)).status, 409);
 current = { opening_date: '2026-01-01', accounts };
 assert.equal((await post({ ...account, id: 'cash' })).status, 400);
 assert.equal((await post({ ...account, code: '571' })).status, 400);
 assert.equal((await post({ ...account, type: 'asset' })).status, 400);
 current.accounts = Array.from({ length: 500 }, (_, index) => ({ id: `a${index}`, code: `${index}`, name: 'Compte', type: 'asset', cash: false }));
 assert.equal((await post(account)).status, 400);
 assert.ok(!calls.some(call => call.sql && call.sql.startsWith('UPDATE accounting_books')));
 current.accounts = accounts; auditFails = true;
 const failed = await post(account);
 assert.equal(failed.status, 500);
 assert.ok(calls.some(call => call.sql && call.sql.startsWith('UPDATE accounting_books')));
 assert.equal(calls.filter(item => item === 'rollback').length, 6);
 assert.ok(!calls.includes('commit'));
});

test('posting validates balance and rolls back an invalid draft', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries') && sql.includes('FOR UPDATE')) return [[{ id: 12, entry_date: '2026-01-02', kind: 'normal', status: 'draft', description: 'Vente', lines: [lines[0], { ...lines[1], credit: '99.00' }] }]];
   if (sql.includes('FROM accounting_entries')) return [[]];
   throw Error('No mutation expected');
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/entries/12/post`, { method: 'POST' });
 assert.equal(response.status, 400); assert.match((await response.json()).error, /équilibrée/);
 assert.ok(calls.includes('rollback')); assert.ok(!calls.includes('commit'));
 assert.deepEqual(calls.find(call => call.sql && call.sql.includes('FOR UPDATE') && call.sql.includes('accounting_entries')).values, [42, '12']);
});

test('posting a draft and audit commit together', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries') && sql.includes('FOR UPDATE')) return [[{ id: 12, entry_date: '2026-01-02', kind: 'normal', status: 'draft', description: 'Vente', lines }]];
   if (sql.includes('FROM accounting_entries')) return [[]];
   return [{ affectedRows: 1 }];
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/entries/12/post`, { method: 'POST' });
 assert.equal(response.status, 200); assert.ok(calls.includes('commit')); assert.ok(!calls.includes('rollback'));
 const postedAudit = calls.find(call => call.sql && call.sql.includes('INSERT INTO audit_logs'));
 assert.deepEqual(JSON.parse(postedAudit.values[5]), { id: '12', date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Vente', lines });
 assert.deepEqual(calls.find(call => call.sql && call.sql.startsWith('UPDATE accounting_entries')).values, [42, '12']);
});

test('income statement reads only this tenant in a single transaction', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries')) return [[{ id: 12, entry_date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Vente', lines }]];
   throw Error('unexpected query');
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/income-statement?from=2026-01-01&to=2026-01-31`);
 assert.equal(response.status, 200);
 const body = await response.json(); assert.equal(body.totals.net, '100.00');
 assert.match(body.warning, /exhaustivité/);
 assert.deepEqual(calls.find(call => call.sql && call.sql.includes('FROM accounting_entries')).values, [42, '2026-01-31']);
 assert.ok(calls.includes('commit'));
});

test('balance sheet uses the requested as-of date and the authenticated tenant', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries')) return [[{ id: 12, entry_date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Vente', lines }]];
   throw Error('unexpected query');
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/balance-sheet?date=2026-02-31`)).status, 400);
 assert.equal(calls.length, 0);
 const response = await fetch(`${url}/balance-sheet?date=2026-01-31`);
 assert.equal(response.status, 200);
 const body = await response.json();
 assert.equal(body.date, '2026-01-31');
 assert.equal(body.totals.asset, '100.00');
 assert.equal(body.totals.accumulatedResult, '100.00');
 assert.deepEqual(body.accounts.map(item => [item.code, item.net]), [['571', '100.00']]);
 assert.match(body.warning, /exhaustivité/);
 const query = calls.find(call => call.sql && call.sql.includes('FROM accounting_entries'));
 assert.match(query.sql, /organization_id=\? AND status='posted' AND entry_date<=\?/);
 assert.deepEqual(query.values, [42, '2026-01-31']);
 assert.ok(calls.includes('commit'));
});

test('balance sheet rejects dates before opening and rolls back', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => {}, commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => {},
  execute: async sql => sql.includes('FROM accounting_books') ? [[{ opening_date: '2026-01-01', accounts }]] : [[]]
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/balance-sheet?date=2025-12-31`);
 assert.equal(response.status, 400);
 assert.ok(calls.includes('rollback')); assert.ok(!calls.includes('commit'));
});

test('journal validates periods and returns only tenant posted entries within inclusive dates', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries')) return [[
    { id: 1, entry_date: '2026-01-01', kind: 'normal', status: 'posted', description: 'Avant', lines },
    { id: 2, entry_date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Début', lines },
    { id: 10, entry_date: '2026-01-03', kind: 'normal', status: 'posted', description: 'Fin', lines }
   ]];
   throw Error('unexpected query');
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/journal?from=2026-02-31&to=2026-03-01`)).status, 400);
 assert.equal((await fetch(`${url}/journal?from=2026-01-03&to=2026-01-02`)).status, 400);
 assert.equal(calls.length, 0);
 const response = await fetch(`${url}/journal?from=2026-01-02&to=2026-01-03`);
 assert.equal(response.status, 200);
 const result = await response.json();
 assert.deepEqual(result.entries.map(entry => entry.id), ['2', '10']);
 assert.deepEqual(result.totals, { debit: '200.00', credit: '200.00' });
 assert.match(result.warning, /brouillons sont exclus/);
 const query = calls.find(call => call.sql && call.sql.includes('FROM accounting_entries'));
 assert.match(query.sql, /organization_id=\? AND status='posted' AND entry_date<=\?/);
 assert.deepEqual(query.values, [42, '2026-01-03']);
 assert.ok(calls.includes('commit'));
});

test('journal denies unavailable book and dates before opening', async t => {
 const original = db.getConnection, calls = []; let exists = false;
 const connection = {
  beginTransaction: async () => {}, commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => {},
  execute: async sql => sql.includes('FROM accounting_books') ? [exists ? [{ opening_date: '2026-01-01', accounts }] : []] : [[]]
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/journal?from=2026-01-01&to=2026-01-02`)).status, 409);
 exists = true;
 assert.equal((await fetch(`${url}/journal?from=2025-12-31&to=2026-01-02`)).status, 400);
 assert.equal(calls.filter(item => item === 'rollback').length, 2);
 assert.ok(!calls.includes('commit'));
});

test('ledger filters an existing tenant account and retains previous balance', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries')) return [[
    { id: 1, entry_date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Avant', lines },
    { id: 2, entry_date: '2026-02-01', kind: 'normal', status: 'posted', description: 'Pendant', lines }
   ]];
   throw Error('unexpected query');
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/ledger?from=2026-02-31&to=2026-03-01`)).status, 400);
 assert.equal((await fetch(`${url}/ledger?from=2026-02-01&to=2026-02-28&accountId=a&accountId=b`)).status, 400);
 assert.equal(calls.length, 0);
 const response = await fetch(`${url}/ledger?from=2026-02-01&to=2026-02-28&accountId=cash`);
 assert.equal(response.status, 200);
 const result = await response.json();
 assert.equal(result.accounts.length, 1);
 assert.equal(result.accounts[0].openingBalance, '100.00');
 assert.equal(result.accounts[0].closingBalance, '200.00');
 assert.deepEqual(result.accounts[0].movements.map(item => item.entryId), ['2']);
 assert.match(result.warning, /brouillons sont exclus/);
 const query = calls.find(call => call.sql && call.sql.includes('FROM accounting_entries'));
 assert.match(query.sql, /organization_id=\? AND status='posted' AND entry_date<=\?/);
 assert.deepEqual(query.values, [42, '2026-02-28']);
 assert.ok(calls.includes('commit'));
});

test('ledger rejects nonexistent book, foreign account and dates before opening', async t => {
 const original = db.getConnection, calls = []; let exists = false;
 const connection = {
  beginTransaction: async () => {}, commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => {},
  execute: async sql => sql.includes('FROM accounting_books') ? [exists ? [{ opening_date: '2026-01-01', accounts }] : []] : [[]]
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/ledger?from=2026-01-01&to=2026-02-01`)).status, 409);
 exists = true;
 assert.equal((await fetch(`${url}/ledger?from=2026-01-01&to=2026-02-01&accountId=foreign`)).status, 404);
 assert.equal((await fetch(`${url}/ledger?from=2025-12-31&to=2026-02-01`)).status, 400);
 assert.equal(calls.filter(item => item === 'rollback').length, 3);
 assert.ok(!calls.includes('commit'));
});

test('tax report returns tenant movements and does not claim a tax liability', async t => {
 const original = db.getConnection, calls = [];
 const taxAccount = { id: 'tax', code: '443', name: 'Taxe', type: 'liability', cash: false, tax: 'payable' };
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts: [...accounts, taxAccount] }]];
   if (sql.includes('FROM accounting_entries')) return [[{ id: 2, entry_date: '2026-02-01', kind: 'normal', status: 'posted', description: 'Vente', lines: [
    { ...lines[0], debit: '110.00' }, lines[1], { accountId: 'tax', debit: '0', credit: '10.00', flow: null }
   ] }]];
   throw Error('unexpected query');
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 for (const query of ['from=2026-02-31&to=2026-03-01', 'from=2026-03-01&to=2026-02-01', 'from=2026-01-01&from=2026-01-02&to=2026-02-01']) {
  assert.equal((await fetch(`${url}/tax?${query}`)).status, 400);
 }
 assert.equal(calls.length, 0);
 const response = await fetch(`${url}/tax?from=2026-02-01&to=2026-02-28`);
 assert.equal(response.status, 200);
 const result = await response.json();
 assert.equal(result.accounts.length, 1);
 assert.equal(result.accounts[0].netMovement, '10.00');
 assert.equal(result.accounts[0].movements[0].entryId, '2');
 assert.equal(result.totals, undefined);
 assert.match(result.warning, /ne calcule ni la TVA à déclarer/);
 assert.match(result.warning, /catégorie sans compte configuré est indisponible/);
 const query = calls.find(call => call.sql && call.sql.includes('FROM accounting_entries'));
 assert.match(query.sql, /organization_id=\? AND status='posted' AND entry_date<=\?/);
 assert.deepEqual(query.values, [42, '2026-02-28']);
 assert.ok(calls.includes('commit')); assert.ok(calls.includes('release'));
});

test('tax report rejects missing configuration, out-of-coverage dates and invalid entries', async t => {
 const original = db.getConnection, calls = []; let current = null, invalid = false;
 const taxAccount = { id: 'tax', code: '443', name: 'Taxe', type: 'liability', cash: false, tax: 'payable' };
 const connection = {
  beginTransaction: async () => {}, commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async sql => sql.includes('FROM accounting_books') ? [current ? [current] : []] : [invalid ? [
   { id: 1, entry_date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Invalide', lines: [lines[0], { ...lines[1], credit: '99.00' }] }
  ] : []]
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/tax?from=2026-01-01&to=2026-01-31`)).status, 409);
 current = { opening_date: '2026-01-01', accounts };
 const missing = await fetch(`${url}/tax?from=2026-01-01&to=2026-01-31`);
 assert.equal(missing.status, 409); assert.match((await missing.json()).error, /Aucun compte de taxe/);
 current.accounts = [...accounts, taxAccount];
 assert.equal((await fetch(`${url}/tax?from=2025-12-31&to=2026-01-31`)).status, 400);
 invalid = true;
 const response = await fetch(`${url}/tax?from=2026-01-01&to=2026-01-31`);
 assert.equal(response.status, 400); assert.match((await response.json()).error, /non équilibrée/);
 assert.equal(calls.filter(item => item === 'rollback').length, 4);
 assert.equal(calls.filter(item => item === 'release').length, 4);
 assert.ok(!calls.includes('commit'));
});

test('cash flow returns classified movements from the authenticated tenant in a transaction', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries')) return [[
    { id: 1, entry_date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Avant', lines },
    { id: 2, entry_date: '2026-02-01', kind: 'normal', status: 'posted', description: 'Pendant', lines }
   ]];
   throw Error('unexpected query');
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/cash-flow?from=2026-02-31&to=2026-03-01`)).status, 400);
 assert.equal((await fetch(`${url}/cash-flow?from=2026-02-01&to=2026-01-01`)).status, 400);
 assert.equal((await fetch(`${url}/cash-flow?from=2026-02-01&from=2026-02-02&to=2026-03-01`)).status, 400);
 assert.equal(calls.length, 0);
 const response = await fetch(`${url}/cash-flow?from=2026-02-01&to=2026-02-28`);
 assert.equal(response.status, 200);
 const result = await response.json();
 assert.deepEqual(result.totals, { opening: '100.00', operating: '100.00', investing: '0.00', financing: '0.00', closing: '200.00' });
 assert.equal(result.categories.operating.movements[0].entryId, '2');
 assert.match(result.warning, /virements internes/);
 const query = calls.find(call => call.sql && call.sql.includes('FROM accounting_entries'));
 assert.match(query.sql, /organization_id=\? AND status='posted' AND entry_date<=\?/);
 assert.deepEqual(query.values, [42, '2026-02-28']);
 assert.ok(calls.includes('commit'));
});

test('cash flow rejects missing book, missing cash accounts and periods before opening', async t => {
 const original = db.getConnection, calls = []; let current = null;
 const connection = {
  beginTransaction: async () => {}, commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => {},
  execute: async sql => sql.includes('FROM accounting_books') ? [current ? [current] : []] : [[]]
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 assert.equal((await fetch(`${url}/cash-flow?from=2026-01-01&to=2026-02-01`)).status, 409);
 current = { opening_date: '2026-01-01', accounts: [accounts[1]] };
 const noCash = await fetch(`${url}/cash-flow?from=2026-01-01&to=2026-02-01`);
 assert.equal(noCash.status, 409); assert.match((await noCash.json()).error, /Aucun compte de trésorerie/);
 current.accounts = accounts;
 assert.equal((await fetch(`${url}/cash-flow?from=2025-12-31&to=2026-02-01`)).status, 400);
 assert.equal(calls.filter(item => item === 'rollback').length, 3);
 assert.ok(!calls.includes('commit'));
});

test('cash flow fails instead of returning totals for an invalid posted entry', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => {}, commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async sql => sql.includes('FROM accounting_books')
   ? [[{ opening_date: '2026-01-01', accounts }]]
   : [[{ id: 1, entry_date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Invalide', lines: [lines[0], { ...lines[1], credit: '99.00' }] }]]
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/cash-flow?from=2026-01-01&to=2026-01-31`);
 assert.equal(response.status, 400); assert.match((await response.json()).error, /non équilibrée/);
 assert.ok(calls.includes('rollback')); assert.ok(!calls.includes('commit')); assert.ok(calls.includes('release'));
});

test('draft creation records the entry in the same audit transaction', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   return [{ insertId: 12 }];
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/entries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-01-02', kind: 'normal', description: ' Vente ', lines }) });
 assert.equal(response.status, 201);
 const audit = calls.find(call => call.sql && call.sql.includes('INSERT INTO audit_logs'));
 assert.deepEqual(JSON.parse(audit.values[5]), { date: '2026-01-02', kind: 'normal', description: 'Vente', lines });
 assert.ok(calls.includes('commit')); assert.ok(!calls.includes('rollback'));
});

test('a draft can be corrected transactionally and validated entries are immutable', async t => {
 const original = db.getConnection, calls = []; let status = 'draft';
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async (sql, values) => {
   calls.push({ sql, values });
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries') && sql.includes('FOR UPDATE')) return [[{ id: 12, entry_date: '2026-01-02', kind: 'normal', status, description: 'Avant correction', lines }]];
   return [{ affectedRows: 1 }];
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const update = () => fetch(`${url}/entries/12`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-01-02', kind: 'normal', description: 'Corrigée', lines }) });
 assert.equal((await update()).status, 200);
 const query = calls.find(call => call.sql && call.sql.startsWith('UPDATE accounting_entries'));
 assert.deepEqual(query.values.slice(-2), [42, '12']);
 const updateAudit = calls.find(call => call.sql && call.sql.includes('INSERT INTO audit_logs'));
 const details = JSON.parse(updateAudit.values[5]);
 assert.equal(details.before.description, 'Avant correction');
 assert.equal(details.after.description, 'Corrigée');
 assert.deepEqual(details.before.lines, lines);
 assert.deepEqual(details.after.lines, lines);
 status = 'posted'; calls.length = 0;
 assert.equal((await update()).status, 409);
 assert.ok(calls.includes('rollback'));
 assert.ok(!calls.some(call => call.sql && call.sql.startsWith('UPDATE accounting_entries')));
});

test('rejects malformed or unknown draft accounts before writing', async t => {
 const original = db.getConnection; let writes = 0;
 const connection = {
  beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
  execute: async sql => {
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   writes++; return [{ insertId: 1 }];
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const post = inputLines => fetch(`${url}/entries`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-01-02', kind: 'normal', description: 'Vente', lines: inputLines }) });
 assert.equal((await post([null, lines[1]])).status, 400);
 assert.equal((await post([{ ...lines[0], accountId: 'other' }, lines[1]])).status, 400);
 assert.equal(writes, 0);
});

test('draft edit rolls back when audit logging fails', async t => {
 const original = db.getConnection, calls = [];
 const connection = {
  beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'),
  rollback: async () => calls.push('rollback'), release: () => calls.push('release'),
  execute: async sql => {
   if (sql.includes('FROM accounting_books')) return [[{ opening_date: '2026-01-01', accounts }]];
   if (sql.includes('FROM accounting_entries') && sql.includes('FOR UPDATE')) return [[{ id: 12, entry_date: '2026-01-02', kind: 'normal', status: 'draft', description: 'Avant correction', lines }]];
   if (sql.includes('INSERT INTO audit_logs')) throw Error('Audit unavailable');
   return [{ affectedRows: 1 }];
  }
 };
 db.getConnection = async () => connection; t.after(() => { db.getConnection = original; });
 const url = await setup(t);
 const response = await fetch(`${url}/entries/12`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date: '2026-01-02', kind: 'normal', description: 'Corrigée', lines }) });
 assert.equal(response.status, 500);
 assert.ok(calls.includes('rollback')); assert.ok(!calls.includes('commit'));
});
