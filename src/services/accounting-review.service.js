const crypto = require('node:crypto');
const { reports } = require('./accounting-reports.service');

const warning = 'Document expérimental non officiel, limité aux écritures comptables validées. Les ventes et achats du portail ne sont pas importés automatiquement ; les brouillons, les opérations absentes et les justificatifs ne sont pas vérifiés. Les périodes ne sont pas clôturées.';

function snapshot({ book, entries, from, to, currency }) {
 if (!currency) throw new RangeError('Devise de l’établissement non configurée.');
 const result = reports({ ...book, completeThrough: to, entries }, from, to);
 const period = { from, to, openingDate: book.openingDate, warning };
 const balanceWarning = `${warning} Le bilan n’est pas une présentation réglementaire SYSCOHADA ; le résultat cumulé n’est pas clôturé.`;
 const cashWarning = `${warning} Les catégories sont saisies manuellement ; les virements internes ne sont pas éliminés.`;
 const taxWarning = `${warning} Ce rapport ne calcule aucun montant de TVA à déclarer ou à payer. Les mouvements peuvent inclure règlements, transferts et corrections ; une catégorie sans compte est indisponible, pas nécessairement nulle.`;
 return {
  schema: 1, currency, book, entries,
  reports: {
   income: { ...period, accounts: result.incomeDetails, totals: result.incomeStatement },
   balance: { date: to, openingDate: book.openingDate, warning: balanceWarning, accounts: result.balanceDetails, totals: result.balanceSheet },
   journal: { ...period, entries: result.journal, totals: result.journalTotals },
   ledger: { ...period, accounts: result.ledgerAccounts },
   cashflow: book.accounts.some(account => account.cash)
    ? { ...period, warning: cashWarning, totals: result.cashFlow, categories: result.cashFlowDetails }
    : null,
   tax: book.accounts.some(account => account.tax)
    ? { ...period, warning: taxWarning, accounts: result.taxDetails }
    : null
  }
 };
}

function encode(value) {
 const content = JSON.stringify(value);
 return { content, hash: crypto.createHash('sha256').update(content, 'utf8').digest('hex') };
}

module.exports = { snapshot, encode };
