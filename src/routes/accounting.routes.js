const router = require('express').Router();
const db = require('../config/database');
const { requireRole } = require('../middleware/auth');
const { reports } = require('../services/accounting-reports.service');
const review = require('../services/accounting-review.service');

router.use(requireRole('OWNER', 'ADMIN', 'ACCOUNTANT'));
router.use((req, res, next) => {
 if (process.env.ACCOUNTING_EXPERIMENTAL_ENABLED !== 'true') return res.status(503).json({ error: 'Le socle comptable expérimental est désactivé.' });
 next();
});
const validDate = value => {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const date = new Date(`${value}T00:00:00.000Z`);
 return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const json = value => typeof value === 'string' ? JSON.parse(value) : value;
const validId = value => /^[1-9]\d{0,19}$/.test(String(value || ''));
const validDraftLines = lines => Array.isArray(lines) && lines.length >= 2 && lines.length <= 100 && lines.every(line =>
 line && typeof line.accountId === 'string' && line.accountId.length > 0 && line.accountId.length <= 80 &&
 ['debit','credit'].every(field => typeof line[field] === 'string' && /^\d{1,16}(?:\.\d{1,2})?$/.test(line[field])) &&
 (line.flow === null || line.flow === undefined || ['operating','investing','financing'].includes(line.flow))
);
const entryFromRow = row => ({
 id: String(row.id), date: row.entry_date, kind: row.kind, status: row.status,
 description: row.description, lines: json(row.lines)
});

async function audit(connection, req, action, entityId, details = null) {
 await connection.execute(
  'INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
  [req.tenantId, req.user.id, action, 'accounting', entityId, details === null ? null : JSON.stringify(details)]
 );
}
async function book(connection, tenantId, lock = false) {
 const [rows] = await connection.execute(
  `SELECT DATE_FORMAT(opening_date,'%Y-%m-%d') opening_date,accounts FROM accounting_books WHERE organization_id=?${lock ? ' FOR UPDATE' : ''}`,
  [tenantId]
 );
 return rows[0] ? { openingDate: rows[0].opening_date, accounts: json(rows[0].accounts) } : null;
}
async function entries(connection, tenantId, through) {
 const [rows] = await connection.execute(
  `SELECT id,DATE_FORMAT(entry_date,'%Y-%m-%d') entry_date,kind,status,description,\`lines\`
   FROM accounting_entries WHERE organization_id=? AND status='posted' AND entry_date<=? ORDER BY entry_date,id`,
  [tenantId, through]
 );
 return rows.map(entryFromRow);
}
async function reviewSnapshot(connection, tenantId, current, from, to) {
 const [settings] = await connection.execute('SELECT currency FROM organization_settings WHERE organization_id=? FOR UPDATE', [tenantId]);
 if (!settings.length || !settings[0].currency) throw new RangeError('Devise de l’établissement non configurée.');
 const posted = await entries(connection, tenantId, to);
 return review.encode(review.snapshot({ book: current, entries: posted, from, to, currency: settings[0].currency }));
}
function validationError(error, res, next) {
 if (error instanceof RangeError || error instanceof TypeError) return res.status(400).json({ error: error.message });
 return next(error);
}
function validateAccounts(openingDate, accounts) {
 if (!Array.isArray(accounts) || accounts.length > 500) throw new RangeError('Liste de comptes invalide ou supérieure à 500 comptes.');
 reports({ openingDate, completeThrough: openingDate, accounts, entries: [] }, openingDate, openingDate);
 if (accounts.some(account => account.id.length > 80 || account.code.length > 40 || account.name.length > 190)) throw new RangeError('Identifiant, code ou libellé de compte trop long.');
}

router.get('/reviews', async (req, res, next) => {
 try {
  const [rows] = await db.execute(
   `SELECT r.id,r.status,r.preliminary_id,DATE_FORMAT(r.period_from,'%Y-%m-%d') period_from,
    DATE_FORMAT(r.period_to,'%Y-%m-%d') period_to,r.snapshot_hash,r.created_at,u.full_name,
    EXISTS(SELECT 1 FROM accounting_review_snapshots f WHERE f.preliminary_id=r.id AND f.organization_id=r.organization_id) has_final
    FROM accounting_review_snapshots r JOIN users u ON u.id=r.created_by
    WHERE r.organization_id=? ORDER BY r.id DESC LIMIT 100`, [req.tenantId]
  );
  res.json(rows.map(row => ({ ...row, id: String(row.id), preliminary_id: row.preliminary_id === null ? null : String(row.preliminary_id), has_final: Boolean(row.has_final) })));
 } catch (error) { next(error); }
});

router.get('/reviews/:id', async (req, res, next) => {
 if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant de révision invalide.' });
 try {
  const [rows] = await db.execute(
   `SELECT id,status,preliminary_id,snapshot_text,snapshot_hash,created_at,created_by
    FROM accounting_review_snapshots WHERE organization_id=? AND id=?`, [req.tenantId, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Révision introuvable.' });
  const row = rows[0], content = row.snapshot_text;
  const hash = require('node:crypto').createHash('sha256').update(content, 'utf8').digest('hex');
  if (hash !== row.snapshot_hash) throw new Error('Intégrité de la révision comptable compromise.');
  res.json({ id: String(row.id), status: row.status, preliminaryId: row.preliminary_id === null ? null : String(row.preliminary_id), hash, createdAt: row.created_at, createdBy: String(row.created_by), snapshot: JSON.parse(content) });
 } catch (error) { next(error); }
});

router.post('/reviews', async (req, res, next) => {
 const { from, to } = req.body || {};
 if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: 'Période invalide.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId, true);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable.' }); }
  const version = await reviewSnapshot(connection, req.tenantId, current, from, to);
  const [result] = await connection.execute(
   `INSERT INTO accounting_review_snapshots(organization_id,status,period_from,period_to,snapshot_text,snapshot_hash,created_by)
    VALUES(?,'preliminary',?,?,?,?,?)`, [req.tenantId, from, to, version.content, version.hash, req.user.id]
  );
  await audit(connection, req, 'ACCOUNTING_REVIEW_PRELIMINARY_CREATED', result.insertId, { from, to, hash: version.hash });
  await connection.commit();
  res.status(201).json({ id: String(result.insertId), hash: version.hash, status: 'preliminary' });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.post('/reviews/:id/finalize', requireRole('ACCOUNTANT'), async (req, res, next) => {
 const { hash, confirmed } = req.body || {};
 if (!validId(req.params.id) || !/^[a-f0-9]{64}$/.test(String(hash || '')) || confirmed !== true) return res.status(400).json({ error: 'Révision, empreinte et confirmation explicite requises.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId, true);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Dossier comptable introuvable.' }); }
  const [rows] = await connection.execute(
   `SELECT status,DATE_FORMAT(period_from,'%Y-%m-%d') period_from,DATE_FORMAT(period_to,'%Y-%m-%d') period_to,
    snapshot_text,snapshot_hash FROM accounting_review_snapshots WHERE organization_id=? AND id=? FOR UPDATE`,
   [req.tenantId, req.params.id]
  );
  if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Révision introuvable.' }); }
  const preliminary = rows[0];
  if (preliminary.status !== 'preliminary') { await connection.rollback(); return res.status(409).json({ error: 'Seule une version préliminaire peut être finalisée.' }); }
  const originalHash = require('node:crypto').createHash('sha256').update(preliminary.snapshot_text, 'utf8').digest('hex');
  if (originalHash !== preliminary.snapshot_hash) throw new Error('Intégrité de la révision comptable compromise.');
  if (hash !== originalHash) { await connection.rollback(); return res.status(409).json({ error: 'L’empreinte de la version examinée ne correspond pas.' }); }
  const latest = await reviewSnapshot(connection, req.tenantId, current, preliminary.period_from, preliminary.period_to);
  if (latest.hash !== originalHash) { await connection.rollback(); return res.status(409).json({ error: 'Les données comptables ont changé : générez et examinez un nouveau préliminaire.' }); }
  const [result] = await connection.execute(
   `INSERT INTO accounting_review_snapshots(organization_id,preliminary_id,status,period_from,period_to,snapshot_text,snapshot_hash,created_by)
    VALUES(?,?,'final',?,?,?,?,?)`,
   [req.tenantId, req.params.id, preliminary.period_from, preliminary.period_to, preliminary.snapshot_text, originalHash, req.user.id]
  );
  await audit(connection, req, 'ACCOUNTING_REVIEW_FINALIZED', result.insertId, { preliminaryId: req.params.id, hash: originalHash });
  await connection.commit();
  res.status(201).json({ id: String(result.insertId), status: 'final', preliminaryId: req.params.id, hash: originalHash });
 } catch (error) {
  if (connection) await connection.rollback();
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Cette version préliminaire a déjà été finalisée.' });
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/book', async (req, res, next) => {
 try { res.json(await book(db, req.tenantId)); } catch (error) { next(error); }
});

router.get('/context', async (req, res, next) => {
 try {
  const [rows] = await db.execute('SELECT currency FROM organization_settings WHERE organization_id=?', [req.tenantId]);
  if (!rows.length || !rows[0].currency) return res.status(409).json({ error: 'Devise de l’établissement non configurée.' });
  res.json({ currency: rows[0].currency });
 } catch (error) { next(error); }
});

router.post('/book', async (req, res, next) => {
 const { openingDate, accounts } = req.body || {};
 if (!validDate(openingDate) || !Array.isArray(accounts) || accounts.length > 500) return res.status(400).json({ error: 'Date ou liste de comptes invalide.' });
 try {
  validateAccounts(openingDate, accounts);
 } catch (error) { return validationError(error, res, next); }
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  await connection.execute('INSERT INTO accounting_books(organization_id,opening_date,accounts,created_by) VALUES(?,?,?,?)', [req.tenantId, openingDate, JSON.stringify(accounts), req.user.id]);
  await audit(connection, req, 'ACCOUNTING_BOOK_CREATED', req.tenantId);
  await connection.commit();
  res.status(201).json({ message: 'Dossier comptable créé. Vérifiez les soldes d’ouverture et les écritures avant de consulter les rapports.' });
 } catch (error) {
  if (connection) await connection.rollback();
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Un dossier comptable existe déjà pour cet établissement.' });
  next(error);
 } finally { if (connection) connection.release(); }
});

router.post('/accounts', async (req, res, next) => {
 const account = req.body && req.body.account;
 if (!account || typeof account !== 'object' || Array.isArray(account) ||
     typeof account.id !== 'string' || typeof account.code !== 'string' || typeof account.name !== 'string' ||
     account.id !== account.id.trim() || account.code !== account.code.trim() || account.name !== account.name.trim() ||
     Object.keys(account).some(key => !['id', 'code', 'name', 'type', 'cash', 'tax'].includes(key))) {
  return res.status(400).json({ error: 'Compte comptable invalide.' });
 }
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId, true);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable.' }); }
  const updated = [...current.accounts, account];
  validateAccounts(current.openingDate, updated);
  await connection.execute('UPDATE accounting_books SET accounts=? WHERE organization_id=?', [JSON.stringify(updated), req.tenantId]);
  await audit(connection, req, 'ACCOUNTING_ACCOUNT_CREATED', req.tenantId, { account });
  await connection.commit();
  res.status(201).json({ account });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/entries', async (req, res, next) => {
 try {
  const [rows] = await db.execute(
   `SELECT id,DATE_FORMAT(entry_date,'%Y-%m-%d') entry_date,kind,status,description,\`lines\`,created_at
    FROM accounting_entries WHERE organization_id=? ORDER BY entry_date DESC,id DESC LIMIT 500`, [req.tenantId]
  );
  res.json(rows.map(entryFromRow));
 } catch (error) { next(error); }
});

router.post('/entries', async (req, res, next) => {
 const { date, kind, description, lines } = req.body || {};
 if (!validDate(date) || !['opening','normal'].includes(kind) || typeof description !== 'string' || !description.trim() || description.length > 500 || !validDraftLines(lines)) {
  return res.status(400).json({ error: 'Date, libellé ou lignes du brouillon invalides.' });
 }
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId, true);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable.' }); }
  if (lines.some(line => !current.accounts.some(account => account.id === line.accountId))) {
   await connection.rollback(); return res.status(400).json({ error: 'Un compte du brouillon est inconnu.' });
  }
  if (date < current.openingDate || (kind === 'opening' && date !== current.openingDate)) {
   await connection.rollback(); return res.status(400).json({ error: 'La date est incompatible avec l’ouverture comptable.' });
  }
  const [result] = await connection.execute(
   "INSERT INTO accounting_entries(organization_id,entry_date,kind,status,description,`lines`,created_by) VALUES(?,?,?,'draft',?,?,?)",
   [req.tenantId, date, kind, description.trim(), JSON.stringify(lines), req.user.id]
  );
  await audit(connection, req, 'ACCOUNTING_DRAFT_CREATED', result.insertId, {
   date, kind, description: description.trim(), lines
  });
  await connection.commit();
  res.status(201).json({ id: String(result.insertId), status: 'draft' });
 } catch (error) {
  if (connection) await connection.rollback();
  next(error);
 } finally { if (connection) connection.release(); }
});

router.put('/entries/:id', async (req, res, next) => {
 const { date, kind, description, lines } = req.body || {};
 if (!validId(req.params.id) || !validDate(date) || !['opening','normal'].includes(kind) || typeof description !== 'string' || !description.trim() || description.length > 500 || !validDraftLines(lines)) {
  return res.status(400).json({ error: 'Identifiant, date, libellé ou lignes du brouillon invalides.' });
 }
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId, true);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable.' }); }
  const [rows] = await connection.execute(
   "SELECT id,DATE_FORMAT(entry_date,'%Y-%m-%d') entry_date,kind,status,description,`lines` FROM accounting_entries WHERE organization_id=? AND id=? FOR UPDATE",
   [req.tenantId, req.params.id]
  );
  if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Écriture introuvable.' }); }
  if (rows[0].status !== 'draft') { await connection.rollback(); return res.status(409).json({ error: 'Une écriture validée ne peut pas être modifiée.' }); }
  if (lines.some(line => !current.accounts.some(account => account.id === line.accountId))) {
   await connection.rollback(); return res.status(400).json({ error: 'Un compte du brouillon est inconnu.' });
  }
  if (date < current.openingDate || (kind === 'opening' && date !== current.openingDate)) {
   await connection.rollback(); return res.status(400).json({ error: 'La date est incompatible avec l’ouverture comptable.' });
  }
  await connection.execute(
   "UPDATE accounting_entries SET entry_date=?,kind=?,description=?,`lines`=? WHERE organization_id=? AND id=? AND status='draft'",
   [date, kind, description.trim(), JSON.stringify(lines), req.tenantId, req.params.id]
  );
  await audit(connection, req, 'ACCOUNTING_DRAFT_UPDATED', req.params.id, {
   before: entryFromRow(rows[0]), after: { id: req.params.id, date, kind, status: 'draft', description: description.trim(), lines }
  });
  await connection.commit();
  res.json({ id: req.params.id, status: 'draft' });
 } catch (error) {
  if (connection) await connection.rollback();
  next(error);
 } finally { if (connection) connection.release(); }
});

router.post('/entries/:id/post', async (req, res, next) => {
 if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant d’écriture invalide.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId, true);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Dossier comptable introuvable.' }); }
  const [rows] = await connection.execute(
   `SELECT id,DATE_FORMAT(entry_date,'%Y-%m-%d') entry_date,kind,status,description,\`lines\`
    FROM accounting_entries WHERE organization_id=? AND id=? FOR UPDATE`, [req.tenantId, req.params.id]
  );
  if (!rows.length) { await connection.rollback(); return res.status(404).json({ error: 'Écriture introuvable.' }); }
  if (rows[0].status !== 'draft') { await connection.rollback(); return res.status(409).json({ error: 'Cette écriture est déjà validée.' }); }
  const candidate = { ...entryFromRow(rows[0]), status: 'posted' };
  const posted = await entries(connection, req.tenantId, candidate.date);
  reports({ ...current, completeThrough: candidate.date, entries: [...posted, candidate] }, current.openingDate, candidate.date);
  await connection.execute("UPDATE accounting_entries SET status='posted' WHERE organization_id=? AND id=? AND status='draft'", [req.tenantId, req.params.id]);
  await audit(connection, req, 'ACCOUNTING_ENTRY_POSTED', req.params.id, candidate);
  await connection.commit();
  res.json({ message: 'Écriture validée.' });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/income-statement', async (req, res, next) => {
 const { from, to } = req.query;
 if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: 'Période invalide.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable.' }); }
  const posted = await entries(connection, req.tenantId, to);
  const result = reports({ ...current, completeThrough: to, entries: posted }, from, to);
  await connection.commit();
  res.json({ from, to, openingDate: current.openingDate, accounts: result.incomeDetails, totals: result.incomeStatement,
   warning: 'Rapport limité aux écritures validées ; l’exhaustivité, les soldes d’ouverture et la conformité doivent être vérifiés. Les opérations commerciales ne sont pas importées automatiquement.' });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/balance-sheet', async (req, res, next) => {
 const { date } = req.query;
 if (!validDate(date)) return res.status(400).json({ error: 'Date de bilan invalide.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable depuis l’état des résultats.' }); }
  const posted = await entries(connection, req.tenantId, date);
  const result = reports({ ...current, completeThrough: date, entries: posted }, current.openingDate, date);
  await connection.commit();
  res.json({
   date, openingDate: current.openingDate, accounts: result.balanceDetails, totals: result.balanceSheet,
   warning: 'Bilan expérimental limité aux écritures validées depuis la date d’ouverture. Les soldes d’ouverture et l’exhaustivité ne sont pas vérifiés ; les opérations commerciales ne sont pas importées automatiquement. Ce bilan n’est pas un état financier officiel.'
  });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/journal', async (req, res, next) => {
 const { from, to } = req.query;
 if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: 'Période invalide.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable depuis l’état des résultats.' }); }
  const posted = await entries(connection, req.tenantId, to);
  const result = reports({ ...current, completeThrough: to, entries: posted }, from, to);
  await connection.commit();
  res.json({
   from, to, openingDate: current.openingDate, entries: result.journal, totals: result.journalTotals,
   warning: 'Journal expérimental limité aux écritures validées ; les brouillons sont exclus. L’exhaustivité, les soldes d’ouverture et les justificatifs ne sont pas vérifiés. Les ventes et achats ne sont pas importés automatiquement ; les périodes ne sont pas clôturables.'
  });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/ledger', async (req, res, next) => {
 const { from, to, accountId } = req.query;
 if (!validDate(from) || !validDate(to) || from > to || (accountId !== undefined && (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 80))) {
  return res.status(400).json({ error: 'Période ou compte invalide.' });
 }
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable depuis l’état des résultats.' }); }
  if (accountId !== undefined && !current.accounts.some(account => account.id === accountId)) {
   await connection.rollback(); return res.status(404).json({ error: 'Compte comptable introuvable.' });
  }
  const posted = await entries(connection, req.tenantId, to);
  const result = reports({ ...current, completeThrough: to, entries: posted }, from, to);
  await connection.commit();
  res.json({
   from, to, openingDate: current.openingDate,
   accounts: accountId === undefined ? result.ledgerAccounts : result.ledgerAccounts.filter(account => account.id === accountId),
   warning: 'Grand livre expérimental limité aux écritures validées ; les brouillons sont exclus. Les soldes d’ouverture, l’exhaustivité et les justificatifs ne sont pas vérifiés. Les opérations commerciales ne sont pas importées automatiquement et les périodes ne sont pas clôturables.'
  });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/tax', async (req, res, next) => {
 const { from, to } = req.query;
 if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: 'Période invalide.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable depuis l’état des résultats.' }); }
  if (!current.accounts.some(account => account.tax === 'payable' || account.tax === 'recoverable')) {
   await connection.rollback(); return res.status(409).json({ error: 'Aucun compte de taxe n’est configuré dans le dossier comptable.' });
  }
  const posted = await entries(connection, req.tenantId, to);
  const result = reports({ ...current, completeThrough: to, entries: posted }, from, to);
  await connection.commit();
  res.json({
   from, to, openingDate: current.openingDate, accounts: result.taxDetails,
   warning: 'Rapport expérimental non officiel : il ne calcule ni la TVA à déclarer ni un montant à payer. Les mouvements peuvent inclure règlements, transferts et corrections. Les taux, bases, justificatifs et règles fiscales ne sont pas vérifiés ; les ventes et achats ne sont pas importés automatiquement. Les brouillons et les écritures d’ouverture sont exclus ; l’exhaustivité n’est pas vérifiée. Une catégorie sans compte configuré est indisponible, pas nécessairement nulle.'
  });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

router.get('/cash-flow', async (req, res, next) => {
 const { from, to } = req.query;
 if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: 'Période invalide.' });
 let connection;
 try {
  connection = await db.getConnection(); await connection.beginTransaction();
  const current = await book(connection, req.tenantId);
  if (!current) { await connection.rollback(); return res.status(409).json({ error: 'Créez d’abord le dossier comptable depuis l’état des résultats.' }); }
  if (!current.accounts.some(account => account.cash)) {
   await connection.rollback(); return res.status(409).json({ error: 'Aucun compte de trésorerie n’est configuré dans le dossier comptable.' });
  }
  const posted = await entries(connection, req.tenantId, to);
  const result = reports({ ...current, completeThrough: to, entries: posted }, from, to);
  await connection.commit();
  res.json({
   from, to, openingDate: current.openingDate, totals: result.cashFlow, categories: result.cashFlowDetails,
   warning: 'Rapport expérimental non officiel, limité aux écritures validées ; les brouillons sont exclus. Les soldes d’ouverture et l’exhaustivité ne sont pas vérifiés ; les opérations commerciales ne sont pas importées automatiquement. Les catégories sont saisies manuellement. Les virements internes ne sont pas éliminés et peuvent fausser les flux bruts et par catégorie.'
  });
 } catch (error) {
  if (connection) await connection.rollback();
  validationError(error, res, next);
 } finally { if (connection) connection.release(); }
});

module.exports = router;
