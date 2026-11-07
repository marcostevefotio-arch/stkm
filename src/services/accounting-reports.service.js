const accountTypes = new Set(['asset', 'liability', 'equity', 'income', 'expense']);
const flowTypes = new Set(['operating', 'investing', 'financing']);
const taxTypes = new Set(['payable', 'recoverable']);
const maximumAmount = 999999999999999999n;

function validDate(value) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const date = new Date(`${value}T00:00:00.000Z`);
 return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cents(value) {
 if (typeof value !== 'string' || !/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) throw new RangeError('Montant comptable invalide.');
 const [whole, fraction = ''] = value.split('.');
 const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
 if (result > maximumAmount) throw new RangeError('Montant comptable hors limites.');
 return result;
}

function amount(value) {
 const sign = value < 0n ? '-' : '';
 const absolute = value < 0n ? -value : value;
 return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

function prepare({ openingDate, completeThrough, accounts, entries }) {
 if (!validDate(openingDate) || !validDate(completeThrough) || openingDate > completeThrough) throw new RangeError('Dates de couverture comptable invalides.');
 if (!Array.isArray(accounts) || !accounts.length || !Array.isArray(entries)) throw new TypeError('Comptes ou écritures invalides.');
 const byId = new Map(), codes = new Set();
 for (const account of accounts) {
  if (!account || typeof account.id !== 'string' || !account.id.trim() || byId.has(account.id) ||
      typeof account.code !== 'string' || !account.code.trim() || codes.has(account.code) ||
      typeof account.name !== 'string' || !account.name.trim() || !accountTypes.has(account.type) ||
      typeof account.cash !== 'boolean' || (account.cash && account.type !== 'asset') ||
      (account.tax !== null && account.tax !== undefined && !taxTypes.has(account.tax)) ||
      (account.tax === 'payable' && account.type !== 'liability') ||
      (account.tax === 'recoverable' && account.type !== 'asset') || (account.cash && account.tax)) throw new RangeError('Compte comptable invalide ou dupliqué.');
  byId.set(account.id, account); codes.add(account.code);
 }
 const ids = new Set(), posted = [];
 for (const entry of entries) {
  if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id) ||
      !['draft', 'posted'].includes(entry.status)) throw new RangeError('Écriture comptable invalide ou dupliquée.');
  ids.add(entry.id);
  if (entry.status === 'draft') continue;
  if (!validDate(entry.date) || entry.date < openingDate || entry.date > completeThrough ||
      !['opening', 'normal'].includes(entry.kind) ||
      typeof entry.description !== 'string' || !entry.description.trim() ||
      !Array.isArray(entry.lines) || entry.lines.length < 2) throw new RangeError('Écriture comptable invalide.');
  if (entry.kind === 'opening' && entry.date !== openingDate) throw new RangeError('Une écriture d’ouverture doit être datée du début de couverture.');
  let debit = 0n, credit = 0n;
  const lines = entry.lines.map(line => {
   const account = line && byId.get(line.accountId);
   if (!account) throw new RangeError('Compte d’écriture inconnu.');
   const d = cents(line.debit), c = cents(line.credit);
   if ((d === 0n) === (c === 0n)) throw new RangeError('Chaque ligne doit avoir un débit ou un crédit strictement positif.');
   if (entry.kind === 'opening' && ['income', 'expense'].includes(account.type)) throw new RangeError('Les soldes d’ouverture ne peuvent pas utiliser de comptes de résultat.');
   if (entry.kind === 'normal' && account.cash) {
    if (!flowTypes.has(line.flow)) throw new RangeError('La catégorie de flux de trésorerie est obligatoire.');
   } else if (line.flow !== null && line.flow !== undefined) throw new RangeError('Catégorie de flux inattendue.');
   debit += d; credit += c;
   return { account, debit: d, credit: c, flow: line.flow || null };
  });
  if (debit !== credit) throw new RangeError('Écriture non équilibrée.');
  posted.push({ ...entry, lines });
 }
 posted.sort((a, b) => {
  const dateOrder = a.date.localeCompare(b.date);
  const kindOrder = a.kind === b.kind ? 0 : a.kind === 'opening' ? -1 : 1;
  if (dateOrder || kindOrder) return dateOrder || kindOrder;
  if (/^[1-9]\d*$/.test(a.id) && /^[1-9]\d*$/.test(b.id)) return BigInt(a.id) < BigInt(b.id) ? -1 : 1;
  return a.id.localeCompare(b.id);
 });
 return { openingDate, completeThrough, accounts, posted };
}

function reports(data, from, to) {
 const book = prepare(data);
 if (!validDate(from) || !validDate(to) || from > to || from < book.openingDate || to > book.completeThrough) throw new RangeError('La période dépasse la couverture comptable déclarée.');
 const balances = new Map(book.accounts.map(account => [account.id, 0n]));
 const period = new Map(book.accounts.map(account => [account.id, { debit: 0n, credit: 0n }]));
 const flows = { operating: 0n, investing: 0n, financing: 0n };
 const flowDetails = Object.fromEntries([...flowTypes].map(type => [type, { receipts: 0n, payments: 0n, movements: [] }]));
 const tax = { payable: 0n, recoverable: 0n };
 const taxLines = new Map(book.accounts.filter(account => account.tax).map(account => [account.id, { debit: 0n, credit: 0n, movements: [] }]));
 const journal = [], ledger = [];
 const ledgerLines = new Map(book.accounts.map(account => [account.id, []]));
 let openingCash = 0n, closingCash = 0n, journalDebit = 0n, journalCredit = 0n;
 for (const entry of book.posted) {
  if (entry.date > to) break;
  const inPeriod = entry.date >= from;
  const cashLines = entry.lines.filter(line => line.account.cash);
  const possibleInternalTransfer = cashLines.some(line => line.debit > 0n) && cashLines.some(line => line.credit > 0n);
  const journalLines = [];
  for (const line of entry.lines) {
   const delta = line.debit - line.credit;
   balances.set(line.account.id, balances.get(line.account.id) + delta);
   if (line.account.cash) {
    closingCash += delta;
    if (entry.date < from || (entry.kind === 'opening' && entry.date === from)) openingCash += delta;
    else if (inPeriod) {
     flows[line.flow] += delta;
     const detail = flowDetails[line.flow];
     detail.receipts += line.debit;
     detail.payments += line.credit;
     detail.movements.push({ entryId: entry.id, date: entry.date, description: entry.description,
      accountId: line.account.id, code: line.account.code, name: line.account.name,
      receipt: amount(line.debit), payment: amount(line.credit), possibleInternalTransfer });
    }
   }
   if (inPeriod) {
    journalDebit += line.debit; journalCredit += line.credit;
    const sums = period.get(line.account.id); sums.debit += line.debit; sums.credit += line.credit;
    if (entry.kind !== 'opening' && line.account.tax === 'payable') tax.payable -= delta;
    if (entry.kind !== 'opening' && line.account.tax === 'recoverable') tax.recoverable += delta;
    if (entry.kind !== 'opening' && line.account.tax) {
     const detail = taxLines.get(line.account.id);
     detail.debit += line.debit; detail.credit += line.credit;
     detail.movements.push({ entryId: entry.id, date: entry.date, description: entry.description,
      debit: amount(line.debit), credit: amount(line.credit) });
    }
    const rendered = { accountId: line.account.id, code: line.account.code, name: line.account.name, debit: amount(line.debit), credit: amount(line.credit) };
    journalLines.push(rendered);
    const movement = { entryId: entry.id, date: entry.date, kind: entry.kind, description: entry.description, ...rendered, balance: amount(balances.get(line.account.id)) };
    ledger.push(movement);
    ledgerLines.get(line.account.id).push(movement);
   }
  }
  if (inPeriod) journal.push({ id: entry.id, date: entry.date, kind: entry.kind, description: entry.description, lines: journalLines });
 }
 const result = { income: 0n, expense: 0n };
 const balanceSheet = { asset: 0n, liability: 0n, equity: 0n, accumulatedResult: 0n };
 const accounts = book.accounts.map(account => {
  const balance = balances.get(account.id), sums = period.get(account.id);
  if (account.type === 'income') { result.income += sums.credit - sums.debit; balanceSheet.accumulatedResult -= balance; }
  else if (account.type === 'expense') { result.expense += sums.debit - sums.credit; balanceSheet.accumulatedResult -= balance; }
  else balanceSheet[account.type] += account.type === 'asset' ? balance : -balance;
  return { id: account.id, code: account.code, name: account.name, type: account.type, balance: amount(balance), debit: amount(sums.debit), credit: amount(sums.credit) };
 });
 const incomeDetails = accounts
  .filter(account => account.type === 'income' || account.type === 'expense')
  .map(account => {
   const sums = period.get(account.id);
   return {
    id: account.id, code: account.code, name: account.name, type: account.type,
    debit: account.debit, credit: account.credit,
    net: amount(account.type === 'income' ? sums.credit - sums.debit : sums.debit - sums.credit)
   };
  })
  .sort((left, right) => left.code.localeCompare(right.code, 'fr', { numeric: true }));
 const balanceDetails = book.accounts
  .filter(account => ['asset', 'liability', 'equity'].includes(account.type))
  .map(account => ({
   id: account.id, code: account.code, name: account.name, type: account.type,
   net: amount(account.type === 'asset' ? balances.get(account.id) : -balances.get(account.id))
  }))
  .sort((left, right) => left.code.localeCompare(right.code, 'fr', { numeric: true }));
 const ledgerAccounts = book.accounts.map(account => {
  const balance = balances.get(account.id), sums = period.get(account.id);
  return {
   id: account.id, code: account.code, name: account.name, type: account.type,
   openingBalance: amount(balance - sums.debit + sums.credit),
   debit: amount(sums.debit), credit: amount(sums.credit),
   closingBalance: amount(balance), movements: ledgerLines.get(account.id)
  };
 }).sort((left, right) => left.code.localeCompare(right.code, 'fr', { numeric: true }));
 const taxDetails = book.accounts.filter(account => account.tax).map(account => {
  const detail = taxLines.get(account.id);
  return {
   id: account.id, code: account.code, name: account.name, category: account.tax,
   debit: amount(detail.debit), credit: amount(detail.credit),
   netMovement: amount(account.tax === 'payable' ? detail.credit - detail.debit : detail.debit - detail.credit),
   movements: detail.movements
  };
 }).sort((left, right) => left.code.localeCompare(right.code, 'fr', { numeric: true }));
 if (balanceSheet.asset !== balanceSheet.liability + balanceSheet.equity + balanceSheet.accumulatedResult ||
     closingCash !== openingCash + flows.operating + flows.investing + flows.financing) throw new Error('Incohérence comptable détectée.');
 return {
  coverage: { from: book.openingDate, through: book.completeThrough, reportFrom: from, reportTo: to },
  journal, journalTotals: { debit: amount(journalDebit), credit: amount(journalCredit) }, ledger, ledgerAccounts, accounts, incomeDetails, balanceDetails,
  incomeStatement: { income: amount(result.income), expense: amount(result.expense), net: amount(result.income - result.expense) },
  balanceSheet: Object.fromEntries(Object.entries(balanceSheet).map(([key, value]) => [key, amount(value)])),
  cashFlow: { opening: amount(openingCash), ...Object.fromEntries(Object.entries(flows).map(([key, value]) => [key, amount(value)])), closing: amount(closingCash) },
  cashFlowDetails: Object.fromEntries(Object.entries(flowDetails).map(([key, value]) => [key, {
   receipts: amount(value.receipts), payments: amount(value.payments), net: amount(flows[key]), movements: value.movements
  }])),
  tax: { payable: amount(tax.payable), recoverable: amount(tax.recoverable), net: amount(tax.payable - tax.recoverable) }, taxDetails
 };
}

module.exports = { reports };
