const test = require('node:test');
const assert = require('node:assert/strict');
const { reports } = require('../src/services/accounting-reports.service');

const line = (accountId, debit, credit, flow = null) => ({ accountId, debit, credit, flow });
function book() {
 return {
  openingDate: '2026-01-01', completeThrough: '2026-12-31',
  accounts: [
   { id: 'cash', code: '571', name: 'Caisse', type: 'asset', cash: true },
   { id: 'equity', code: '101', name: 'Capital', type: 'equity', cash: false },
   { id: 'sales', code: '701', name: 'Ventes', type: 'income', cash: false },
   { id: 'expense', code: '601', name: 'Achats', type: 'expense', cash: false },
   { id: 'tax-out', code: '443', name: 'Taxe collectée', type: 'liability', cash: false, tax: 'payable' },
   { id: 'tax-in', code: '445', name: 'Taxe déductible', type: 'asset', cash: false, tax: 'recoverable' }
  ],
  entries: [
   { id: 'opening', date: '2026-01-01', kind: 'opening', status: 'posted', description: 'Ouverture', lines: [line('cash', '100.00', '0'), line('equity', '0', '100.00')] },
   { id: 'sale', date: '2026-01-02', kind: 'normal', status: 'posted', description: 'Vente', lines: [line('cash', '120', '0', 'operating'), line('sales', '0', '100'), line('tax-out', '0', '20')] },
   { id: 'purchase', date: '2026-02-01', kind: 'normal', status: 'posted', description: 'Achat', lines: [line('expense', '50', '0'), line('tax-in', '10', '0'), line('cash', '0', '60', 'operating')] },
   { id: 'draft', date: '2026-02-02', kind: 'normal', status: 'draft', description: 'Brouillon', lines: [line('cash', '10', '0', 'operating'), line('sales', '0', '10')] }
  ]
 };
}

test('six reports use balanced posted entries and exclude drafts', () => {
 const result = reports(book(), '2026-01-01', '2026-02-28');
 assert.equal(result.journal.length, 3);
 assert.equal(result.ledger.length, 8);
 assert.deepEqual(result.incomeStatement, { income: '100.00', expense: '50.00', net: '50.00' });
 assert.deepEqual(result.balanceSheet, { asset: '170.00', liability: '20.00', equity: '100.00', accumulatedResult: '50.00' });
 assert.deepEqual(result.cashFlow, { opening: '100.00', operating: '60.00', investing: '0.00', financing: '0.00', closing: '160.00' });
 assert.deepEqual(result.tax, { payable: '20.00', recoverable: '10.00', net: '10.00' });
});

test('custom periods retain prior balances but only include current activity', () => {
 const result = reports(book(), '2026-02-01', '2026-02-28');
 assert.equal(result.cashFlow.opening, '220.00');
 assert.equal(result.cashFlow.closing, '160.00');
 assert.equal(result.incomeStatement.net, '-50.00');
 assert.equal(result.balanceSheet.accumulatedResult, '50.00');
 assert.deepEqual(result.tax, { payable: '0.00', recoverable: '10.00', net: '-10.00' });
 assert.equal(result.ledger.find(row => row.accountId === 'cash').balance, '160.00');
});

test('tax details include only period posted movements, not opening balances', () => {
 const data = book();
 data.entries = [
  { id: '1', date: '2026-01-01', kind: 'opening', status: 'posted', description: 'Ouverture', lines: [line('cash', '100', '0'), line('tax-out', '0', '10'), line('equity', '0', '90')] },
  { id: '2', date: '2026-01-01', kind: 'normal', status: 'posted', description: 'Taxe', lines: [line('cash', '90071992547409.93', '0', 'operating'), line('tax-out', '0', '90071992547409.93')] },
  { id: '3', date: '2026-01-31', kind: 'normal', status: 'posted', description: 'Règlement', lines: [line('tax-out', '5', '0'), line('cash', '0', '5', 'operating')] },
  { id: '4', date: '2026-01-31', kind: 'normal', status: 'posted', description: 'Ajustement', lines: [line('expense', '7', '0'), line('tax-in', '0', '7')] },
  { id: '5', date: '2026-01-31', kind: 'normal', status: 'draft', description: 'Brouillon', lines: [line('tax-out', '3', '0'), line('cash', '0', '3', 'operating')] },
  { id: '6', date: '2026-02-01', kind: 'normal', status: 'posted', description: 'Après', lines: [line('tax-out', '1', '0'), line('cash', '0', '1', 'operating')] }
 ];
 const result = reports(data, '2026-01-01', '2026-01-31');
 assert.deepEqual(result.taxDetails, [
  { id: 'tax-out', code: '443', name: 'Taxe collectée', category: 'payable', debit: '5.00', credit: '90071992547409.93', netMovement: '90071992547404.93',
   movements: [{ entryId: '2', date: '2026-01-01', description: 'Taxe', debit: '0.00', credit: '90071992547409.93' }, { entryId: '3', date: '2026-01-31', description: 'Règlement', debit: '5.00', credit: '0.00' }] },
  { id: 'tax-in', code: '445', name: 'Taxe déductible', category: 'recoverable', debit: '0.00', credit: '7.00', netMovement: '-7.00',
   movements: [{ entryId: '4', date: '2026-01-31', description: 'Ajustement', debit: '0.00', credit: '7.00' }] }
 ]);
 assert.equal(result.tax.payable, result.taxDetails[0].netMovement);
 assert.equal(result.tax.recoverable, result.taxDetails[1].netMovement);
 const empty = reports(data, '2026-02-02', '2026-02-02');
 assert.ok(empty.taxDetails.every(account => account.netMovement === '0.00' && account.movements.length === 0));
});

test('cash flow details reconcile opening, classified movements and closing exactly', () => {
 const data = book();
 data.accounts.push({ id: 'bank', code: '521', name: 'Banque', type: 'asset', cash: true });
 data.entries.push(
  { id: 'investment', date: '2026-02-02', kind: 'normal', status: 'posted', description: 'Investissement', lines: [line('expense', '0.03', '0'), line('cash', '0', '0.03', 'investing')] },
  { id: 'financing', date: '2026-02-03', kind: 'normal', status: 'posted', description: 'Financement', lines: [line('bank', '90071992547409.93', '0', 'financing'), line('equity', '0', '90071992547409.93')] },
  { id: 'transfer', date: '2026-02-04', kind: 'normal', status: 'posted', description: 'Virement', lines: [line('cash', '5', '0', 'operating'), line('bank', '0', '5', 'financing')] }
 );
 const result = reports(data, '2026-02-01', '2026-02-28');
 assert.deepEqual(result.cashFlow, { opening: '220.00', operating: '-55.00', investing: '-0.03', financing: '90071992547404.93', closing: '90071992547569.90' });
 assert.equal(result.cashFlowDetails.operating.receipts, '5.00');
 assert.equal(result.cashFlowDetails.operating.payments, '60.00');
 assert.equal(result.cashFlowDetails.financing.net, '90071992547404.93');
 assert.equal(result.cashFlowDetails.operating.movements[1].possibleInternalTransfer, true);
 assert.equal(result.cashFlowDetails.financing.movements[1].possibleInternalTransfer, true);
 assert.equal(result.cashFlowDetails.investing.movements[0].possibleInternalTransfer, false);
 assert.equal(result.cashFlowDetails.operating.movements.some(item => item.entryId === 'draft'), false);
 const firstDay = reports(data, '2026-01-01', '2026-01-01');
 assert.equal(firstDay.cashFlow.opening, '100.00');
 assert.equal(firstDay.cashFlowDetails.operating.movements.length, 0);
 const empty = reports(data, '2026-02-05', '2026-02-05');
 assert.equal(empty.cashFlow.opening, empty.cashFlow.closing);
 assert.deepEqual(empty.cashFlowDetails.operating.movements, []);
});

test('ledger groups each account with opening balance, period totals and running balances', () => {
 const result = reports(book(), '2026-02-01', '2026-02-28');
 const cash = result.ledgerAccounts.find(account => account.id === 'cash');
 assert.equal(cash.openingBalance, '220.00');
 assert.equal(cash.debit, '0.00');
 assert.equal(cash.credit, '60.00');
 assert.equal(cash.closingBalance, '160.00');
 assert.deepEqual(cash.movements.map(movement => [movement.entryId, movement.balance]), [['purchase', '160.00']]);
 const capital = result.ledgerAccounts.find(account => account.id === 'equity');
 assert.equal(capital.openingBalance, '-100.00');
 assert.equal(capital.closingBalance, '-100.00');
 assert.deepEqual(capital.movements, []);
 const opening = reports(book(), '2026-01-01', '2026-01-01').ledgerAccounts.find(account => account.id === 'cash');
 assert.equal(opening.openingBalance, '0.00');
 assert.equal(opening.movements[0].kind, 'opening');
 assert.equal(opening.closingBalance, '100.00');
});

test('ledger uses exact amounts beyond floating point range and preserves same-day order', () => {
 const data = book();
 const make = (id, value) => ({ id, date: '2026-02-01', kind: 'normal', status: 'posted', description: id, lines: [line('cash', value, '0', 'operating'), line('sales', '0', value)] });
 data.entries = [data.entries[0], make('10', '0.02'), make('2', '90071992547409.93'), { ...make('11', '100'), status: 'draft' }];
 const cash = reports(data, '2026-02-01', '2026-02-01').ledgerAccounts.find(account => account.id === 'cash');
 assert.equal(cash.openingBalance, '100.00');
 assert.equal(cash.debit, '90071992547409.95');
 assert.deepEqual(cash.movements.map(movement => [movement.entryId, movement.balance]), [['2', '90071992547509.93'], ['10', '90071992547509.95']]);
 assert.equal(cash.closingBalance, '90071992547509.95');
});

test('journal preserves full lines, exact totals and numeric id ordering within dates', () => {
 const data = book();
 const make = id => ({ id, date: '2026-02-01', kind: 'normal', status: 'posted', description: `Écriture ${id}`, lines: [line('cash', '90071992547409.93', '0', 'operating'), line('sales', '0', '90071992547409.93')] });
 data.entries = [data.entries[0], make('10'), make('2'), { ...make('11'), status: 'draft' }];
 const result = reports(data, '2026-02-01', '2026-02-01');
 assert.deepEqual(result.journal.map(entry => entry.id), ['2', '10']);
 assert.deepEqual(result.journal[0].lines[0], { accountId: 'cash', code: '571', name: 'Caisse', debit: '90071992547409.93', credit: '0.00' });
 assert.deepEqual(result.journalTotals, { debit: '180143985094819.86', credit: '180143985094819.86' });
 const empty = reports(data, '2026-02-02', '2026-02-02');
 assert.deepEqual(empty.journal, []);
 assert.deepEqual(empty.journalTotals, { debit: '0.00', credit: '0.00' });
});

test('balance details show net balances by type including opposite-sign balances', () => {
 const data = book();
 data.entries.push({ id: 'overdraft', date: '2026-03-01', kind: 'normal', status: 'posted', description: 'Dépense', lines: [line('expense', '200', '0'), line('cash', '0', '200', 'operating')] });
 const result = reports(data, '2026-01-01', '2026-03-01');
 assert.deepEqual(result.balanceDetails, [
  { id: 'equity', code: '101', name: 'Capital', type: 'equity', net: '100.00' },
  { id: 'tax-out', code: '443', name: 'Taxe collectée', type: 'liability', net: '20.00' },
  { id: 'tax-in', code: '445', name: 'Taxe déductible', type: 'asset', net: '10.00' },
  { id: 'cash', code: '571', name: 'Caisse', type: 'asset', net: '-40.00' }
 ]);
 assert.deepEqual(result.balanceSheet, { asset: '-30.00', liability: '20.00', equity: '100.00', accumulatedResult: '-150.00' });
});

test('income statement details show period activity and preserve negative corrections', () => {
 const data = book();
 data.entries.push({ id: 'correction', date: '2026-02-05', kind: 'normal', status: 'posted', description: 'Correction de vente', lines: [line('sales', '25', '0'), line('cash', '0', '25', 'operating')] });
 const result = reports(data, '2026-02-01', '2026-02-28');
 assert.deepEqual(result.incomeDetails, [
  { id: 'expense', code: '601', name: 'Achats', type: 'expense', debit: '50.00', credit: '0.00', net: '50.00' },
  { id: 'sales', code: '701', name: 'Ventes', type: 'income', debit: '25.00', credit: '0.00', net: '-25.00' }
 ]);
 assert.deepEqual(result.incomeStatement, { income: '-25.00', expense: '50.00', net: '-75.00' });
});

test('invalid entries, missing classifications and coverage are rejected', () => {
 const unbalanced = book(); unbalanced.entries[1].lines[0].debit = '119.99';
 assert.throws(() => reports(unbalanced, '2026-01-01', '2026-02-01'), /non équilibrée/);
 const missingFlow = book(); missingFlow.entries[1].lines[0].flow = null;
 assert.throws(() => reports(missingFlow, '2026-01-01', '2026-02-01'), /catégorie/i);
 const invalid = book(); invalid.entries[1].lines[0].debit = '120.001';
 assert.throws(() => reports(invalid, '2026-01-01', '2026-02-01'), /montant/i);
 assert.throws(() => reports(book(), '2025-12-31', '2026-02-01'), /couverture/i);
});

test('decimal calculations remain exact beyond the safe integer range', () => {
 const data = book();
 data.entries = [{ id: 'open', date: '2026-01-01', kind: 'opening', status: 'posted', description: 'Ouverture', lines: [line('cash', '90071992547409.93', '0'), line('equity', '0', '90071992547409.93')] }];
 const result = reports(data, '2026-01-01', '2026-01-01');
 assert.equal(result.balanceSheet.asset, '90071992547409.93');
 assert.equal(result.cashFlow.opening, '90071992547409.93');
});

test('opening precedes same-day operations and does not inflate tax activity', () => {
 const data = book();
 data.entries = [
  { id: 'z-opening', date: '2026-01-01', kind: 'opening', status: 'posted', description: 'Ouverture', lines: [line('cash', '100', '0'), line('equity', '0', '90'), line('tax-out', '0', '10')] },
  { id: 'a-sale', date: '2026-01-01', kind: 'normal', status: 'posted', description: 'Vente', lines: [line('cash', '12', '0', 'operating'), line('sales', '0', '10'), line('tax-out', '0', '2')] }
 ];
 const result = reports(data, '2026-01-01', '2026-01-01');
 assert.deepEqual(result.journal.map(entry => entry.id), ['z-opening', 'a-sale']);
 assert.deepEqual(result.ledger.filter(row => row.accountId === 'cash').map(row => row.balance), ['100.00', '112.00']);
 assert.equal(result.tax.payable, '2.00');
 assert.equal(result.balanceSheet.liability, '12.00');
});

test('rejects duplicate accounts, unknown accounts and malformed lines', () => {
 const duplicate = book(); duplicate.accounts.push({ ...duplicate.accounts[0], id: 'other' });
 assert.throws(() => reports(duplicate, '2026-01-01', '2026-02-01'), /compte/i);
 const unknown = book(); unknown.entries[1].lines[0].accountId = 'unknown';
 assert.throws(() => reports(unknown, '2026-01-01', '2026-02-01'), /inconnu/i);
 const both = book(); both.entries[1].lines[0].credit = '1';
 assert.throws(() => reports(both, '2026-01-01', '2026-02-01'), /ligne/i);
 const inappropriateFlow = book(); inappropriateFlow.entries[1].lines[1].flow = 'operating';
 assert.throws(() => reports(inappropriateFlow, '2026-01-01', '2026-02-01'), /flux/i);
 const missingCoverage = book(); delete missingCoverage.completeThrough;
 assert.throws(() => reports(missingCoverage, '2026-01-01', '2026-02-01'), /couverture/i);
});

test('unfinished drafts never alter or prevent reports; posted invalid entries still fail', () => {
 const data = book();
 data.entries[3].description = '';
 data.entries[3].lines = [line('unknown', '100', '0')];
 const result = reports(data, '2026-01-01', '2026-02-28');
 assert.equal(result.incomeStatement.net, '50.00');
 assert.equal(result.journal.some(entry => entry.id === 'draft'), false);
 data.entries[3].status = 'posted';
 assert.throws(() => reports(data, '2026-01-01', '2026-02-28'), /écriture comptable invalide/i);
});
