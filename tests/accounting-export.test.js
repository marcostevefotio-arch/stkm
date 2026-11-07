const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { reports } = require('../src/services/accounting-reports.service');

const source = fs.readFileSync(require.resolve('../public/js/accounting.js'), 'utf8');
const accounts = [
 { id: 'cash', code: '001', name: '=Caisse;"test"\nSuite', type: 'asset', cash: true },
 { id: 'capital', code: '101', name: 'Capital', type: 'equity', cash: false },
 { id: 'sales', code: '701', name: 'Ventes', type: 'income', cash: false },
 { id: 'tax', code: '443', name: 'Taxe', type: 'liability', cash: false, tax: 'payable' }
];
const entries = [
 { id: '1', date: '2026-01-01', kind: 'opening', status: 'posted', description: 'Ouverture', lines: [
  { accountId: 'cash', debit: '90071992547409.93', credit: '0' },
  { accountId: 'capital', debit: '0', credit: '90071992547409.93' }
 ] },
 { id: '2', date: '2026-01-02', kind: 'normal', status: 'posted', description: ' =FORMULE', lines: [
  { accountId: 'cash', debit: '12', credit: '0', flow: 'operating' },
  { accountId: 'sales', debit: '0', credit: '10' },
  { accountId: 'tax', debit: '0', credit: '2' }
 ] }
];
const result = reports({ openingDate: '2026-01-01', completeThrough: '2026-01-31', accounts, entries }, '2026-01-01', '2026-01-31');
const common = { openingDate: '2026-01-01', from: '2026-01-01', to: '2026-01-31', warning: 'Attention : non officiel.' };
const fixtures = {
 income: { ...common, accounts: result.incomeDetails, totals: result.incomeStatement },
 balance: { openingDate: common.openingDate, date: common.to, warning: common.warning, accounts: result.balanceDetails, totals: result.balanceSheet },
 journal: { ...common, entries: result.journal, totals: result.journalTotals },
 ledger: { ...common, accounts: result.ledgerAccounts },
 cashflow: { ...common, categories: result.cashFlowDetails, totals: result.cashFlow },
 tax: { ...common, accounts: result.taxDetails }
};

function parseCsv(csv) {
 const rows = [], row = [];
 let cell = '', quoted = false;
 for (let i = 1; i < csv.length; i++) {
  const c = csv[i];
  if (quoted) {
   if (c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
   else if (c === '"') quoted = false;
   else cell += c;
  } else if (c === '"') quoted = true;
  else if (c === ';') { row.push(cell); cell = ''; }
  else if (c === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row.splice(0)); cell = ''; i++; }
  else cell += c;
 }
 assert.equal(quoted, false);
 const header = rows.shift();
 return rows.map(values => Object.fromEntries(header.map((key, index) => [key, values[index]])));
}

function load(context = {}) {
 const sandbox = { window: {}, ...context };
 vm.runInNewContext(source, sandbox);
 return sandbox.window.RedamsAccounting;
}

test('all six CSV exports contain metadata, warning, exact details and totals', () => {
 const build = load().buildExport;
 for (const [type, data] of Object.entries(fixtures)) {
  const file = build(type, data, 'XAF', type === 'ledger' ? 'cash' : '');
  assert.match(file.filename, /^comptabilite-.*\.csv$/);
  assert.equal(file.content[0], '\uFEFF');
  const rows = parseCsv(file.content);
  assert.ok(rows.some(row => row.Section === 'Avertissement' && row.Description === common.warning), type);
  assert.ok(rows.some(row => row.Section === 'Périmètre' && row.Description.includes('pas importés automatiquement')), type);
  assert.ok(rows.some(row => row.Section === 'Devise' && row.Description === 'XAF'), type);
  assert.ok(rows.some(row => row.Section === 'Date ouverture' && row.Date === "'2026-01-01"), type);
  assert.ok(rows.some(row => row.Section === (type === 'balance' ? 'Date du bilan' : 'Fin période') && row.Date === "'2026-01-31"), type);
 }
 let rows = parseCsv(build('income', fixtures.income, 'XAF').content);
 assert.ok(rows.some(row => row.Section === 'Compte' && row['Code compte'] === "'701" && row.Crédit === "'10.00"));
 assert.ok(rows.some(row => row.Description === 'Résultat' && row['Montant net'] === "'10.00"));
 rows = parseCsv(build('balance', fixtures.balance, 'XAF').content);
 assert.ok(rows.some(row => row['Code compte'] === "'001" && row['Montant net'] === "'90071992547421.93"));
 assert.ok(rows.some(row => row.Description === 'Résultat cumulé non clôturé' && row['Montant net'] === "'10.00"));
 rows = parseCsv(build('journal', fixtures.journal, 'XAF').content);
 assert.equal(rows.filter(row => row.Section === 'Ligne').length, 5);
 assert.ok(rows.some(row => row.Description === "' =FORMULE" && row['Identifiant écriture'] === "'2"));
 assert.ok(rows.some(row => row['Libellé compte'] === '\'=Caisse;"test"\nSuite'));
 assert.ok(rows.some(row => row.Section === 'Total' && row.Débit === "'90071992547421.93"));
 rows = parseCsv(build('ledger', fixtures.ledger, 'XAF', 'cash').content);
 assert.ok(rows.some(row => row.Section === 'Filtre compte' && row.Description === 'cash'));
 assert.ok(rows.some(row => row.Section === 'Mouvement' && row['Solde final'] === "'90071992547421.93"));
 rows = parseCsv(build('cashflow', fixtures.cashflow, 'XAF').content);
 assert.ok(rows.some(row => row.Section === 'Catégorie' && row.Catégorie === 'Exploitation' && row.Entrée === "'12.00"));
 assert.ok(rows.some(row => row.Section === 'Mouvement' && row['Virement interne possible'] === 'Non'));
 rows = parseCsv(build('tax', fixtures.tax, 'XAF').content);
 assert.ok(rows.some(row => row.Section === 'Compte' && row.Catégorie === 'Taxe collectée' && row['Montant net'] === "'2.00"));
 assert.ok(rows.some(row => row.Section === 'Mouvement' && row['Identifiant écriture'] === "'2"));
 assert.throws(() => build('unknown', {}, 'XAF'), /inconnu/);
});

test('negative values and potentially dangerous spreadsheet text remain text', () => {
 const build = load().buildExport;
 const data = { ...fixtures.income, accounts: [{ id: '@id', code: '0001', name: '\t+attaque', type: 'expense', debit: '0.00', credit: '3.50', net: '-3.50' }], totals: { income: '0.00', expense: '-3.50', net: '3.50' } };
 const rows = parseCsv(build('income', data, 'XAF').content);
 const row = rows.find(item => item.Section === 'Compte');
 assert.equal(row['Identifiant compte'], "'@id");
 assert.equal(row['Code compte'], "'0001");
 assert.equal(row['Libellé compte'], "'\t+attaque");
 assert.equal(row['Montant net'], "'-3.50");
});

test('empty tax categories remain unavailable rather than becoming zero totals', () => {
 const rows = parseCsv(load().buildExport('tax', { ...common, accounts: [], warning: 'Catégories indisponibles, pas nécessairement nulles.' }, 'XAF').content);
 assert.ok(rows.some(row => row.Description.includes('indisponibles')));
 assert.equal(rows.some(row => row.Section === 'Compte'), false);
});

test('all report pages download the displayed result and invalidate changed filters', async () => {
 class Element {
  constructor() { this.nodes = new Map(); this.children = []; this.value = ''; this.textContent = ''; }
  querySelector(selector) {
   if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
   return this.nodes.get(selector);
  }
  querySelectorAll() { return []; }
  append(child) { this.children.push(child); }
  prepend(child) { this.children.unshift(child); }
  replaceChildren() { this.children = []; this.innerHTML = ''; }
  reset() {}
  click() { if (this.onclick) this.onclick(); }
 }
 const pages = [
  ['income', 'results', 'data-report-form', 'data-report'],
  ['balance', 'balance', 'data-balance-form', 'data-balance-report'],
  ['journal', 'journal', 'data-journal-form', 'data-journal-report'],
  ['ledger', 'ledger', 'data-ledger-form', 'data-ledger-report'],
  ['cashflow', 'cashflow', 'data-cashflow-form', 'data-cashflow-report'],
  ['tax', 'tax', 'data-tax-form', 'data-tax-report']
 ];
 for (const [type, page, formSelector, outputSelector] of pages) {
  let downloaded, savedBlob;
  const document = { createElement(tag) {
   const element = new Element();
   if (tag === 'a') element.click = () => { downloaded = element.download; };
   return element;
  } };
  const url = { createObjectURL(blob) { savedBlob = blob; return 'blob:test'; }, revokeObjectURL() {} };
  const render = load({ document, location: { hash: `#accounting-${page}` }, URL: url, URLSearchParams, Blob });
  const root = new Element();
  const form = root.querySelector(`[${formSelector}]`);
  form.elements = {
   from: { value: common.from }, to: { value: common.to }, date: { value: common.to },
   accountId: { value: '' }, kind: { value: 'normal' }
  };
  const entryForm = root.querySelector('[data-entry-form]');
  entryForm.elements = { kind: { value: 'normal' }, date: { value: common.to } };
  const api = async path => path === '/api/accounting/book' ? { openingDate: common.openingDate, accounts } :
   path === '/api/accounting/entries' ? [] : fixtures[type];
  await (type === 'income' ? render : render[type])(root, api, String, 'XAF');
  await form.onsubmit({ preventDefault() {} });
  const output = root.querySelector(`[${outputSelector}]`);
  assert.equal(output.children.length, 1, type);
  assert.match(output.children[0].textContent, /Exporter CSV/);
  output.children[0].click();
  assert.match(downloaded, /^comptabilite-.*\.csv$/, type);
  assert.ok((await savedBlob.text()).includes('Attention : non officiel.'), type);
  form.elements[type === 'balance' ? 'date' : 'from'].value = '2026-01-03';
  form.oninput();
  assert.equal(output.children.length, 0, type);
  assert.match(form.querySelector('.error').textContent, /Recalculez/);
 }
});

test('a report returned after its filters change cannot be exported', async () => {
 const error = { textContent: '' }, submit = { disabled: false };
 const form = {
  elements: { from: { value: common.from }, to: { value: common.to }, accountId: { value: 'cash' } },
  querySelector(selector) { return selector === '.error' ? error : submit; }
 };
 const output = { children: [], replaceChildren() { this.children = []; this.innerHTML = ''; }, prepend(button) { this.children.push(button); } };
 const root = { innerHTML: '', querySelector(selector) { return selector === '[data-ledger-form]' ? form : output; } };
 let resolveReport;
 const api = path => path === '/api/accounting/book' ? Promise.resolve({ openingDate: common.openingDate, accounts }) :
  new Promise(resolve => { resolveReport = resolve; });
 const document = { createElement() { return {}; } };
 const render = load({ document, location: { hash: '#accounting-ledger' }, URLSearchParams });
 await render.ledger(root, api, String, 'XAF');
 const pending = form.onsubmit({ preventDefault() {} });
 form.elements.accountId.value = 'capital';
 resolveReport({ ...fixtures.ledger, accounts: fixtures.ledger.accounts.filter(account => account.id === 'cash') });
 await pending;
 assert.equal(output.children.length, 0);
 assert.equal(output.innerHTML, '');
 assert.match(error.textContent, /Recalculez/);
 assert.equal(submit.disabled, false);
});

test('expert reviews the frozen snapshot, exports and confirms the displayed hash', async () => {
 const calls = [], downloads = [];
 const version = {
  id: '12', status: 'preliminary', preliminaryId: null, hash: 'a'.repeat(64),
  createdAt: '2026-11-06', createdBy: '7',
  snapshot: { currency: 'XAF', book: { accounts: [] }, entries: [], reports: { ...fixtures } }
 };
 const error = { textContent: '' }, finalize = { disabled: false };
 const exportButton = { dataset: { reviewExport: 'journal' } };
 const detail = {
  innerHTML: '', textContent: '',
  querySelector(selector) { return selector === '.error' ? error : selector === '[data-review-finalize]' ? finalize : null; },
  querySelectorAll() { return [exportButton]; }
 };
 const list = {};
 const form = {
  elements: { from: { value: common.from }, to: { value: common.to } },
  querySelector(selector) { return selector === '.error' ? error : { disabled: false }; }
 };
 const root = {
  innerHTML: '',
  querySelector(selector) {
   return { '[data-review-create]': form, '[data-review-list]': list, '[data-review-detail]': detail }[selector];
  }
 };
 const api = async (path, options) => {
  calls.push({ path, options });
  if (path === '/api/accounting/book') return { openingDate: common.openingDate };
  if (path === '/api/accounting/reviews' && !options) return [{ id: '12', status: 'preliminary', period_from: common.from, period_to: common.to, full_name: 'Expert', has_final: false }];
  if (path === '/api/accounting/reviews/12') return version;
  if (path === '/api/accounting/reviews/12/finalize') return { id: '13' };
  throw Error(`Unexpected request: ${path}`);
 };
 const document = { createElement() { return { click() { downloads.push(this.download); } }; } };
 const render = load({
  document, location: { hash: '#accounting-review' }, confirm: () => true,
  URL: { createObjectURL() { return 'blob:test'; }, revokeObjectURL() {} }, Blob
 });
 await render.review(root, api, String, 'XAF', 'ACCOUNTANT');
 await list.onclick({ target: { closest() { return { dataset: { reviewId: '12' } }; } } });
 assert.match(detail.innerHTML, /Version préliminaire/);
 assert.match(detail.innerHTML, /Valider cette version/);
 exportButton.onclick();
 assert.match(downloads[0], /^preliminary-12-comptabilite-journal/);
 await finalize.onclick();
 const request = calls.find(call => call.path.endsWith('/finalize'));
 assert.deepEqual(JSON.parse(request.options.body), { hash: version.hash, confirmed: true });
 assert.equal(error.textContent, '');
});
