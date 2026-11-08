const router = require('express').Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/database');
const { getUsage } = require('../services/tenant-usage.service');
const { DEFAULT_PROGRAM, getProgram, recordPaidInvoiceCommission } = require('../services/partner-commission.service');
const databaseUpgrade = require('../services/database-upgrade.service');
const { MODULES, MODULE_KEYS } = require('../config/pricing');
const { DOCUMENTS: LEGAL_DOCUMENTS, loadLegalSettings, normalizeLegalSettings } = require('../config/legal-documents');
const { STAFF_ROLES, canWrite, portalSecret, generateApiToken, validateShifts, isOnDuty, normalizeTime } = require('../config/portal-access');

const validId = value => /^[1-9]\d{0,19}$/.test(String(value || ''));
const validEmail = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 190;
const validDate = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const workPeriods = new Set(['week', 'biweek', 'month', 'year']);
const dateString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function workPeriodRange(period, now = new Date()) {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    let start;
    if (period === 'week') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    } else if (period === 'biweek') {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13);
    } else if (period === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
        start = new Date(now.getFullYear(), 0, 1);
    }
    return { start: dateString(start), end: dateString(end) };
}
const paging = query => ({
    limit: Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100),
    offset: Math.min(Math.max(Number.parseInt(query.offset, 10) || 0, 0), 1000000)
});
const money = value => { const amount = Number(value); return Number.isFinite(amount) && amount >= 0 && amount <= 999999999 ? Math.round(amount * 100) / 100 : null; };
const referralCode = () => `RED${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const validChoiceList = value => Array.isArray(value) && value.length <= 30 && value.every(item => typeof item === 'string' && item.trim().length >= 2 && item.trim().length <= 80) && new Set(value.map(item => item.trim().toLowerCase())).size === value.length;

async function audit(req, action, entityType, entityId, organizationId, details) {
    await db.execute(
        'INSERT INTO platform_audit_logs(staff_id,organization_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
        [req.staff.id, organizationId || null, action, entityType, entityId === undefined ? null : String(entityId), JSON.stringify(details || {})]
    );
}

const requireWrite = area => (req, res, next) => (canWrite(req.staff.role, area) ? next() : res.status(403).json({ error: 'Permission insuffisante pour cette action.' }));
const requireAdmin = (req, res, next) => (req.staff.role === 'PLATFORM_ADMIN' ? next() : res.status(403).json({ error: 'Réservé aux administrateurs de la plateforme.' }));
const signToken = staff => jwt.sign({ sub: staff.id, typ: 'portal', pv: Number(staff.password_version || 0) }, portalSecret(), { expiresIn: '8h' });
const publicStaff = staff => ({ id: staff.id, full_name: staff.full_name, email: staff.email, role: staff.role, job_title: staff.job_title, phone: staff.phone, is_available: Boolean(staff.is_available) });

router.post('/login', async (req, res, next) => {
    const email = text(req.body?.email, 190).toLowerCase(), password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!validEmail(email) || !password || password.length > 128) return res.status(400).json({ error: 'Saisissez une adresse et un mot de passe valides.' });
    try {
        const [rows] = await db.execute('SELECT * FROM platform_staff WHERE email=? LIMIT 1', [email]);
        const staff = rows[0];
        const ok = staff ? await bcrypt.compare(password, staff.password_hash) : await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
        if (!staff || !ok || !staff.is_active) return res.status(401).json({ error: 'Identifiants incorrects ou compte désactivé.' });
        await db.execute('UPDATE platform_staff SET last_login_at=NOW() WHERE id=?', [staff.id]);
        req.staff = staff;
        await audit(req, 'PORTAL_LOGIN', 'staff', staff.id, null, {});
        res.json({ token: signToken(staff), staff: publicStaff(staff) });
    } catch (error) { next(error); }
});

router.use(async (req, res, next) => {
    const header = req.headers.authorization || '', token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentification requise.' });
    let payload;
    try { payload = jwt.verify(token, portalSecret()); } catch (error) { return res.status(401).json({ error: 'Session invalide ou expirée.' }); }
    if (payload.typ !== 'portal') return res.status(401).json({ error: 'Session invalide ou expirée.' });
    try {
        const [rows] = await db.execute('SELECT * FROM platform_staff WHERE id=? LIMIT 1', [payload.sub]);
        if (!rows.length || !rows[0].is_active) return res.status(401).json({ error: 'Compte inactif.' });
        if (Number(payload.pv || 0) !== Number(rows[0].password_version || 0)) return res.status(401).json({ error: 'Mot de passe modifié. Reconnectez-vous.' });
        req.staff = rows[0];
        next();
    } catch (error) { next(error); }
});

router.get('/me', (req, res) => res.json({ staff: publicStaff(req.staff), permissions: Object.fromEntries(['clients', 'invoices', 'claims', 'support', 'tokens', 'staff'].map(area => [area, canWrite(req.staff.role, area)])) }));

router.put('/me/password', async (req, res, next) => {
    const { current_password: current, new_password: next_ } = req.body || {};
    if (typeof current !== 'string' || typeof next_ !== 'string' || next_.length < 12 || next_.length > 128) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir 12 à 128 caractères.' });
    try {
        if (!(await bcrypt.compare(current, req.staff.password_hash))) return res.status(400).json({ error: 'Le mot de passe actuel est incorrect.' });
        await db.execute('UPDATE platform_staff SET password_hash=?,password_version=password_version+1 WHERE id=?', [await bcrypt.hash(next_, 12), req.staff.id]);
        await audit(req, 'PORTAL_PASSWORD_CHANGED', 'staff', req.staff.id, null, {});
        res.json({ message: 'Mot de passe modifié. Reconnectez-vous.' });
    } catch (error) { next(error); }
});

router.put('/me/availability', async (req, res, next) => {
    try {
        await db.execute('UPDATE platform_staff SET is_available=? WHERE id=?', [req.body?.is_available ? 1 : 0, req.staff.id]);
        res.json({ is_available: Boolean(req.body?.is_available) });
    } catch (error) { next(error); }
});

router.get('/admin/database/status', requireAdmin, async (req, res, next) => {
    try {
        const status = await databaseUpgrade.getStatus();
        res.json({ ...status, backups: await databaseUpgrade.listBackups() });
    } catch (error) { next(error); }
});

router.post('/admin/database/backup', requireAdmin, async (req, res, next) => {
    try {
        const backup = await databaseUpgrade.createDatabaseBackup();
        try { await audit(req, 'DATABASE_BACKUP_CREATED', 'database_backup', backup.filename, null, { size: backup.size }); }
        catch (error) { return res.status(500).json({ error: `Sauvegarde créée (${backup.filename}), mais son journal d’audit n’a pas pu être écrit: ${error.message}` }); }
        res.status(201).json({ backup, message: 'Sauvegarde complète vérifiée.' });
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        next(error);
    }
});

router.get('/admin/database/backups/:filename', requireAdmin, async (req, res, next) => {
    const filePath = databaseUpgrade.backupPath(req.params.filename);
    if (!filePath) return res.status(400).json({ error: 'Nom de sauvegarde invalide.' });
    try {
        const fs = require('node:fs/promises');
        const details = await fs.stat(filePath);
        if (!details.isFile()) return res.status(404).json({ error: 'Sauvegarde introuvable.' });
        res.type('application/sql').download(filePath, req.params.filename, error => {
            if (error && !res.headersSent) next(error);
        });
    } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).json({ error: 'Sauvegarde introuvable.' });
        next(error);
    }
});

router.post('/admin/database/migrations/:id/apply', requireAdmin, async (req, res, next) => {
    try {
        if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmez explicitement la migration après avoir vérifié son aperçu.' });
        await audit(req, 'DATABASE_MIGRATION_REQUESTED', 'database_migration', req.params.id, null, { migration_id: req.params.id });
        const result = await databaseUpgrade.runMigration({ migrationId: req.params.id, staffId: req.staff.id, reviewed: true });
        res.json(result);
    } catch (error) {
        if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
        next(error);
    }
});

router.get('/overview', async (req, res, next) => {
    try {
        const one = async (sql, values = []) => (await db.execute(sql, values))[0][0];
        const [clients, subscriptions, trials, tickets, claims, invoices, tokens, staffRows] = await Promise.all([
            one("SELECT COUNT(*) total,SUM(status='active') active,SUM(status='suspended') suspended FROM organizations"),
            db.execute("SELECT s.status,COUNT(*) total FROM subscriptions s WHERE s.id=(SELECT MAX(s2.id) FROM subscriptions s2 WHERE s2.organization_id=s.organization_id) GROUP BY s.status").then(([rows]) => rows),
            one("SELECT COUNT(*) total FROM subscriptions s WHERE s.id=(SELECT MAX(s2.id) FROM subscriptions s2 WHERE s2.organization_id=s.organization_id) AND s.current_period_end BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 7 DAY)"),
            one("SELECT SUM(status='open') open_count,SUM(status='in_progress') in_progress,SUM(status<>'closed' AND assigned_staff_id IS NULL AND assigned_agent_id IS NULL) unassigned FROM support_tickets"),
            one("SELECT SUM(status='open') open_count,SUM(status='in_progress') in_progress,SUM(status IN ('open','in_progress') AND priority='urgent') urgent FROM platform_claims"),
            one("SELECT SUM(status IN ('draft','sent')) pending_count,COALESCE(SUM(CASE WHEN status IN ('draft','sent') THEN total_amount END),0) pending_amount,SUM(status='sent' AND due_date<CURDATE()) overdue FROM platform_invoices"),
            one('SELECT COUNT(*) total FROM client_api_tokens WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())'),
            db.execute('SELECT s.id,s.full_name,s.role,s.is_available FROM platform_staff s WHERE s.is_active=TRUE').then(([rows]) => rows)
        ]);
        const [shifts] = await db.execute('SELECT staff_id,weekday,start_time,end_time FROM platform_staff_schedules');
        const onDuty = staffRows.filter(staff => isOnDuty(shifts.filter(shift => Number(shift.staff_id) === Number(staff.id)))).map(staff => ({ id: staff.id, full_name: staff.full_name, role: staff.role }));
        const n = value => Number(value || 0);
        res.json({
            clients: { total: n(clients.total), active: n(clients.active), suspended: n(clients.suspended) },
            subscriptions: Object.fromEntries(subscriptions.map(row => [row.status, n(row.total)])), expiring_soon: n(trials.total),
            tickets: { open: n(tickets.open_count), in_progress: n(tickets.in_progress), unassigned: n(tickets.unassigned) },
            claims: { open: n(claims.open_count), in_progress: n(claims.in_progress), urgent: n(claims.urgent) },
            invoices: { pending: n(invoices.pending_count), pending_amount: n(invoices.pending_amount), overdue: n(invoices.overdue) },
            tokens: n(tokens.total), staff_total: staffRows.length, on_duty: onDuty
        });
    } catch (error) { next(error); }
});

router.get('/clients', async (req, res, next) => {
    const { limit, offset } = paging(req.query), query = text(req.query.q, 120), status = text(req.query.status, 20);
    if (status && !['active', 'suspended', 'closed'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    const clauses = [], values = [];
    if (query) { clauses.push('(o.name LIKE ? OR o.slug LIKE ? OR o.email LIKE ? OR o.phone LIKE ?)'); values.push(...Array(4).fill(`%${query}%`)); }
    if (status) { clauses.push('o.status=?'); values.push(status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
        const [[count]] = await db.execute(`SELECT COUNT(*) total FROM organizations o ${where}`, values);
        const [items] = await db.execute(
            `SELECT o.id,o.name,o.slug,o.email,o.phone,o.status,o.created_at,s.id subscription_id,s.plan_id,s.status subscription_status,IF(tp.id IS NULL,p.name,CONCAT(p.name,' → ',tp.name)) plan_name,
                    DATE_FORMAT(s.current_period_end,'%Y-%m-%d') current_period_end,COALESCE(s.max_users,p.max_users) max_users,
                    (SELECT COUNT(*) FROM users u WHERE u.organization_id=o.id AND u.is_active=TRUE AND u.role<>'SUPER_ADMIN') active_users
             FROM organizations o
             LEFT JOIN subscriptions s ON s.id=(SELECT MAX(s2.id) FROM subscriptions s2 WHERE s2.organization_id=o.id)
             LEFT JOIN plans p ON p.id=s.plan_id LEFT JOIN plans tp ON tp.id=s.target_plan_id ${where} ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`,
            [...values, limit, offset]
        );
        res.json({ items, total: Number(count.total), limit, offset });
    } catch (error) { next(error); }
});

router.get('/clients/:id', async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
        const [orgs] = await db.execute('SELECT id,name,slug,email,phone,status,created_at FROM organizations WHERE id=? LIMIT 1', [req.params.id]);
        if (!orgs.length) return res.status(404).json({ error: 'Établissement introuvable.' });
        const [subscriptions] = await db.execute(
            `SELECT s.id,s.status,s.billing_interval,DATE_FORMAT(s.current_period_start,'%Y-%m-%d') current_period_start,DATE_FORMAT(s.current_period_end,'%Y-%m-%d') current_period_end,
                    s.plan_id,s.target_plan_id,p.name plan_name,tp.name target_plan_name,p.currency,COALESCE(s.max_users,p.max_users) max_users
                                 FROM subscriptions s JOIN plans p ON p.id=s.plan_id LEFT JOIN plans tp ON tp.id=s.target_plan_id WHERE s.organization_id=? ORDER BY s.id DESC LIMIT 1`, [req.params.id]);
        const [owners] = await db.execute("SELECT full_name,email,role FROM users WHERE organization_id=? AND role IN ('OWNER','ADMIN') AND is_active=TRUE ORDER BY id LIMIT 5", [req.params.id]);
        const [[users]] = await db.execute("SELECT COUNT(*) total FROM users WHERE organization_id=? AND is_active=TRUE AND role<>'SUPER_ADMIN'", [req.params.id]);
        const [tickets] = await db.execute('SELECT id,subject,status,created_at FROM support_tickets WHERE organization_id=? ORDER BY id DESC LIMIT 5', [req.params.id]);
        const [claims] = await db.execute('SELECT id,reference,subject,status,priority,created_at FROM platform_claims WHERE organization_id=? ORDER BY id DESC LIMIT 5', [req.params.id]);
        const [invoices] = await db.execute('SELECT id,invoice_number,total_amount,currency,status,due_date FROM platform_invoices WHERE organization_id=? ORDER BY id DESC LIMIT 5', [req.params.id]);
        res.json({ organization: orgs[0], subscription: subscriptions[0] || null, contacts: owners, active_users: Number(users.total), tickets, claims, invoices });
    } catch (error) { next(error); }
});

router.patch('/clients/:id/status', requireWrite('clients'), async (req, res, next) => {
    const status = req.body?.status;
    if (!validId(req.params.id) || !['active', 'suspended', 'closed'].includes(status)) return res.status(400).json({ error: 'Choisissez un statut valide.' });
    try {
        const [orgs] = await db.execute('SELECT status FROM organizations WHERE id=? LIMIT 1', [req.params.id]);
        if (!orgs.length) return res.status(404).json({ error: 'Établissement introuvable.' });
        await db.execute('UPDATE organizations SET status=? WHERE id=?', [status, req.params.id]);
        await audit(req, 'CLIENT_STATUS_CHANGED', 'organization', req.params.id, req.params.id, { from: orgs[0].status, to: status });
        res.json({ status, message: 'Statut mis à jour.' });
    } catch (error) { next(error); }
});

router.get('/plans', async (req, res, next) => {
    try {
        const [rows] = await db.execute('SELECT id,code,name,plan_type,monthly_price,annual_price,biennial_price,currency FROM plans WHERE is_active=TRUE ORDER BY monthly_price,id');
        res.json({ items: rows });
    } catch (error) { next(error); }
});

router.get('/admin/pricing', requireAdmin, async (req, res, next) => {
    try {
        const [items] = await db.execute(
            "SELECT id,code,name,plan_type,monthly_price,annual_price,biennial_price,currency,max_users,max_products,extra_user_price,included_modules,module_prices,is_active FROM plans WHERE plan_type<>'trial' ORDER BY monthly_price,id"
        );
        res.json({ items, modules: MODULES });
    } catch (error) { next(error); }
});

function modulePricingInput(rawModules, rawPrices) {
    if (!Array.isArray(rawModules) || !rawModules.length || rawModules.length > MODULE_KEYS.length ||
        rawModules.some(module => !MODULE_KEYS.includes(module)) || new Set(rawModules).size !== rawModules.length ||
        !rawPrices || typeof rawPrices !== 'object' || Array.isArray(rawPrices) ||
        Object.keys(rawPrices).some(module => !rawModules.includes(module))) return null;
    const modulePrices = {};
    for (const module of rawModules) {
        const terms = rawPrices[module];
        if (!terms || typeof terms !== 'object' || Array.isArray(terms)) return null;
        const validTerms = {};
        for (const interval of ['monthly', 'annual', 'biennial']) {
            const value = terms[interval];
            if (value === '' || value === null || value === undefined) continue;
            const amount = money(value);
            if (amount === null || amount <= 0) return null;
            validTerms[interval] = amount;
        }
        if (!Object.keys(validTerms).length) return null;
        modulePrices[module] = validTerms;
    }
    return { modules: rawModules, modulePrices };
}

function configurablePlanInput(body = {}) {
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
    const name = text(body.name, 100), currency = body.currency;
    const maxUsers = Number(body.max_users), maxProducts = Number(body.max_products);
    const extraUserPrice = money(body.extra_user_price);
    const rawModules = body.included_modules;
    const rawPrices = body.module_prices;
    if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(code) || name.length < 2 ||
        typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
        !Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 100000 ||
        !Number.isInteger(maxProducts) || maxProducts < 1 || maxProducts > 10000000 ||
        extraUserPrice === null ||
        typeof body.is_active !== 'boolean') return null;
    const pricing = modulePricingInput(rawModules, rawPrices);
    if (!pricing) return null;
    return { code, name, currency, maxUsers, maxProducts, extraUserPrice, ...pricing, isActive: body.is_active };
}

router.post('/admin/pricing', requireAdmin, async (req, res, next) => {
    const plan = configurablePlanInput(req.body || {});
    if (!plan) return res.status(400).json({ error: 'Vérifiez le code, le nom, les fonctionnalités tarifées, la devise et les quotas du forfait.' });
    let connection;
    try {
        connection = await db.getConnection(); await connection.beginTransaction();
        const [result] = await connection.execute(
            `INSERT INTO plans(code,name,plan_type,billing_interval,monthly_price,annual_price,biennial_price,
                               included_modules,module_prices,extra_user_price,currency,max_users,max_products,is_active)
             VALUES(?,?,'customized','monthly',0,NULL,NULL,?,?,?,?,?,?,?)`,
            [plan.code, plan.name, JSON.stringify(plan.modules), JSON.stringify(plan.modulePrices), plan.extraUserPrice, plan.currency, plan.maxUsers, plan.maxProducts, plan.isActive]
        );
        await connection.execute(
            'INSERT INTO platform_audit_logs(staff_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?)',
            [req.staff.id, 'PLAN_CREATED', 'plan', String(result.insertId), JSON.stringify({ code: plan.code, name: plan.name, modules: plan.modules, module_prices: plan.modulePrices })]
        );
        await connection.commit(); connection.release(); connection = null;
        res.status(201).json({ id: result.insertId, message: 'Forfait créé.' });
    } catch (error) {
        if (connection) { try { await connection.rollback(); } finally { connection.release(); } }
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ce code de forfait est déjà utilisé.' });
        next(error);
    }
});

router.patch('/admin/pricing/:id', requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant de forfait invalide.' });
    const body = req.body || {}, name = text(body.name, 100), currency = body.currency;
    const priceKeys = ['monthly_price', 'annual_price', 'biennial_price'];
    const prices = priceKeys.map(key => body[key] === '' || body[key] === null || body[key] === undefined ? null : money(body[key]));
    const maxUsers = Number(body.max_users), maxProducts = Number(body.max_products), extra = money(body.extra_user_price);
    const moduleConfigRequested = body.included_modules !== undefined || body.module_prices !== undefined;
    const moduleConfig = moduleConfigRequested ? modulePricingInput(body.included_modules, body.module_prices) : null;
    if (name.length < 2 || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency) ||
        prices.some((value, index) => value === null && priceKeys[index] === 'monthly_price' || body[priceKeys[index]] !== null && body[priceKeys[index]] !== undefined && body[priceKeys[index]] !== '' && value === null) ||
        !Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 100000 ||
        !Number.isInteger(maxProducts) || maxProducts < 1 || maxProducts > 10000000 ||
        extra === null || typeof body.is_active !== 'boolean' || (moduleConfigRequested && !moduleConfig)) return res.status(400).json({ error: 'Vérifiez les tarifs, fonctionnalités, devise, quotas et statut du forfait.' });
    try {
        const [plans] = await db.execute("SELECT id FROM plans WHERE id=? AND plan_type<>'trial'", [req.params.id]);
        if (!plans.length) return res.status(404).json({ error: 'Forfait modifiable introuvable.' });
        const [result] = await db.execute(
            'UPDATE plans SET name=?,plan_type=COALESCE(?,plan_type),monthly_price=?,annual_price=?,biennial_price=?,currency=?,max_users=?,max_products=?,extra_user_price=?,included_modules=COALESCE(?,included_modules),module_prices=COALESCE(?,module_prices),is_active=? WHERE id=?',
            [name, moduleConfig ? 'customized' : null, ...prices, currency, maxUsers, maxProducts, extra, moduleConfig ? JSON.stringify(moduleConfig.modules) : null, moduleConfig ? JSON.stringify(moduleConfig.modulePrices) : null, body.is_active, req.params.id]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Forfait introuvable.' });
        await audit(req, 'PLAN_PRICING_UPDATED', 'plan', req.params.id, null, { name, prices, currency, maxUsers, maxProducts, extra, ...(moduleConfig || {}), is_active: body.is_active });
        res.json({ message: 'Forfait mis à jour.' });
    } catch (error) { next(error); }
});

router.get('/admin/promotions', requireAdmin, async (req, res, next) => {
    try {
        const [items] = await db.execute(
            "SELECT pr.id,pr.code,pr.name,pr.plan_id,p.name plan_name,pr.discount_type,pr.discount_value,DATE_FORMAT(pr.starts_at,'%Y-%m-%d') starts_at,DATE_FORMAT(pr.ends_at,'%Y-%m-%d') ends_at,pr.new_users_only,pr.is_active FROM platform_promotions pr LEFT JOIN plans p ON p.id=pr.plan_id ORDER BY pr.created_at DESC,pr.id DESC"
        );
        res.json({ items });
    } catch (error) { next(error); }
});

function promotionInput(body) {
    const code = text(body.code, 60), name = text(body.name, 120), type = body.discount_type, value = money(body.discount_value);
    const starts = body.starts_at, ends = body.ends_at || null;
    const planId = body.plan_id === undefined || body.plan_id === null || body.plan_id === '' ? null : String(body.plan_id);
    if (!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(code) || name.length < 2 ||
        (planId !== null && !validId(planId)) ||
        !['percent', 'fixed'].includes(type) || value === null || value <= 0 ||
        (type === 'percent' && value > 100) || !validDate(starts) ||
        (ends !== null && (!validDate(ends) || ends < starts)) ||
        typeof body.new_users_only !== 'boolean' || typeof body.is_active !== 'boolean') return null;
    return { code, name, type, value, starts, ends, planId, newUsersOnly: body.new_users_only, isActive: body.is_active };
}

router.post('/admin/promotions', requireAdmin, async (req, res, next) => {
    const promo = promotionInput(req.body || {});
    if (!promo) return res.status(400).json({ error: 'Vérifiez le code, la réduction, les dates et les conditions de la promotion.' });
    try {
        if (promo.planId) {
            const [plans] = await db.execute("SELECT id FROM plans WHERE id=? AND plan_type<>'trial'", [promo.planId]);
            if (!plans.length) return res.status(400).json({ error: 'Le forfait choisi est introuvable ou ne peut pas recevoir de promotion.' });
        }
        const [result] = await db.execute(
            'INSERT INTO platform_promotions(code,name,plan_id,discount_type,discount_value,starts_at,ends_at,new_users_only,is_active) VALUES(?,?,?,?,?,?,?,?,?)',
            [promo.code, promo.name, promo.planId, promo.type, promo.value, promo.starts, promo.ends, promo.newUsersOnly, promo.isActive]
        );
        await audit(req, 'PROMOTION_CREATED', 'promotion', result.insertId, null, promo);
        res.status(201).json({ id: result.insertId, message: 'Promotion créée.' });
    } catch (error) { next(error); }
});

router.patch('/admin/promotions/:id', requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant de promotion invalide.' });
    const promo = promotionInput({ ...req.body, code: req.body?.code || 'EDITED' });
    if (!promo) return res.status(400).json({ error: 'Vérifiez le nom, la réduction, les dates et les conditions de la promotion.' });
    try {
        if (promo.planId) {
            const [plans] = await db.execute("SELECT id FROM plans WHERE id=? AND plan_type<>'trial'", [promo.planId]);
            if (!plans.length) return res.status(400).json({ error: 'Le forfait choisi est introuvable ou ne peut pas recevoir de promotion.' });
        }
        const [result] = await db.execute(
            'UPDATE platform_promotions SET name=?,plan_id=?,discount_type=?,discount_value=?,starts_at=?,ends_at=?,new_users_only=?,is_active=? WHERE id=?',
            [promo.name, promo.planId, promo.type, promo.value, promo.starts, promo.ends, promo.newUsersOnly, promo.isActive, req.params.id]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Promotion introuvable.' });
        await audit(req, 'PROMOTION_UPDATED', 'promotion', req.params.id, null, promo);
        res.json({ message: 'Promotion mise à jour.' });
    } catch (error) { next(error); }
});

router.get('/admin/settings', requireAdmin, async (req, res, next) => {
    try { res.json({ settings: await getProgram(db) }); }
    catch (error) { next(error); }
});

router.get('/admin/legal-documents', requireAdmin, async (req, res, next) => {
    try { res.json(await loadLegalSettings(db)); }
    catch (error) { next(error); }
});

router.put('/admin/legal-documents', requireAdmin, async (req, res, next) => {
    const body=req.body||{};
    const documents=body.documents;
    if(typeof body.show_public_links!=='boolean'||typeof body.show_authenticated_links!=='boolean'||
       !Array.isArray(documents)||documents.length!==LEGAL_DOCUMENTS.length||
       documents.some((document,index)=>document?.id!==LEGAL_DOCUMENTS[index].id||
        typeof document.title!=='string'||document.title.trim().length<2||document.title.trim().length>180||
        typeof document.content!=='string'||document.content.trim().length<20||document.content.length>60000)){
        return res.status(400).json({error:'Vérifiez les options d’affichage, les titres et le contenu des trois documents.'});
    }
    const settings=normalizeLegalSettings({
        show_public_links:body.show_public_links,
        show_authenticated_links:body.show_authenticated_links,
        documents:documents.map(document=>({id:document.id,title:document.title.trim(),content:document.content.trim()}))
    });
    try{
        await db.execute(
            `INSERT INTO platform_settings(setting_key,setting_value) VALUES('legal_documents',?)
             ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
            [JSON.stringify(settings)]
        );
        await audit(req,'LEGAL_DOCUMENTS_UPDATED','settings','legal_documents',null,{
            show_public_links:settings.show_public_links,
            show_authenticated_links:settings.show_authenticated_links,
            documents:settings.documents.map(({id,title,version})=>({id,title,version}))
        });
        res.json({...settings,message:'Documents et options d’affichage enregistrés.'});
    }catch(error){next(error);}
});

router.put('/admin/settings', requireAdmin, async (req, res, next) => {
    const body = req.body || {}, defaultRate = Number(body.default_commission_percent);
    if (!Number.isFinite(defaultRate) || defaultRate < 0 || defaultRate > 100 ||
        !validChoiceList(body.partner_types) || !validChoiceList(body.categories) ||
        !['weekly', 'monthly'].includes(body.payout_frequency) || !/^[A-Z]{3}$/.test(String(body.currency || ''))) {
        return res.status(400).json({ error: 'Vérifiez le taux, les types, les catégories, la fréquence et la devise.' });
    }
    const settings = {
        default_commission_percent: defaultRate,
        partner_types: body.partner_types.map(value => value.trim()),
        categories: body.categories.map(value => value.trim()),
        payout_frequency: body.payout_frequency,
        currency: body.currency
    };
    try {
        await db.execute(
            `INSERT INTO platform_settings(setting_key,setting_value) VALUES('partner_program',?)
             ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
            [JSON.stringify(settings)]
        );
        await audit(req, 'PARTNER_PROGRAM_SETTINGS_UPDATED', 'settings', 'partner_program', null, settings);
        res.json({ settings, message: 'Paramètres enregistrés.' });
    } catch (error) { next(error); }
});

router.get('/admin/partners', requireAdmin, async (req, res, next) => {
    try {
        const [items] = await db.execute(
            `SELECT p.id,p.name,p.email,p.phone,p.partner_type,p.category,p.referral_code,p.commission_percent,p.is_active,p.notes,p.created_at,
                    (SELECT COUNT(*) FROM organizations o WHERE o.partner_id=p.id) referrals,
                    COALESCE(c.pending_amount,0) pending_commissions,COALESCE(c.total_amount,0) total_commissions,
                    COALESCE(c.currency,'XAF') currency
             FROM platform_partners p
             LEFT JOIN (
                SELECT partner_id,SUM(CASE WHEN status='pending' THEN commission_amount ELSE 0 END) pending_amount,
                       SUM(commission_amount) total_amount,MAX(currency) currency
                FROM platform_partner_commissions GROUP BY partner_id
             ) c ON c.partner_id=p.id
             ORDER BY p.created_at DESC,p.id DESC`
        );
        const [commissions] = await db.execute(
            `SELECT c.id,c.partner_id,p.name partner_name,o.name organization_name,i.invoice_number,
                    c.invoice_amount,c.commission_percent,c.commission_amount,c.currency,c.status,c.created_at,c.paid_at
             FROM platform_partner_commissions c JOIN platform_partners p ON p.id=c.partner_id
             JOIN organizations o ON o.id=c.organization_id JOIN platform_invoices i ON i.id=c.invoice_id
             ORDER BY c.created_at DESC,c.id DESC LIMIT 200`
        );
        res.json({ items, commissions });
    } catch (error) { next(error); }
});

router.post('/admin/partners', requireAdmin, async (req, res, next) => {
    const body = req.body || {}, name = text(body.name, 180), email = text(body.email, 190).toLowerCase();
    const phone = text(body.phone, 50), partnerType = text(body.partner_type, 80), category = text(body.category, 80);
    const commission = body.commission_percent === '' || body.commission_percent === null || body.commission_percent === undefined ? null : Number(body.commission_percent);
    const notes = text(body.notes, 1000);
    if (name.length < 2 || (email && !validEmail(email)) || partnerType.length < 2 || category.length < 2 ||
        (commission !== null && (!Number.isFinite(commission) || commission < 0 || commission > 100))) return res.status(400).json({ error: 'Vérifiez le nom, le courriel, le type, la catégorie et le taux du partenaire.' });
    try {
        const program = await getProgram(db);
        if (!program.partner_types.includes(partnerType) || !program.categories.includes(category)) return res.status(400).json({ error: 'Choisissez un type et une catégorie configurés dans les paramètres partenaires.' });
        let code, result;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            code = referralCode();
            try {
                [result] = await db.execute(
                    'INSERT INTO platform_partners(name,email,phone,partner_type,category,referral_code,commission_percent,notes) VALUES(?,?,?,?,?,?,?,?)',
                    [name, email || null, phone || null, partnerType, category, code, commission, notes || null]
                );
                break;
            } catch (error) { if (error.code !== 'ER_DUP_ENTRY' || attempt === 3) throw error; }
        }
        await audit(req, 'PARTNER_CREATED', 'partner', result.insertId, null, { name, partner_type: partnerType, category, commission_percent: commission ?? program.default_commission_percent });
        res.status(201).json({ id: result.insertId, referral_code: code, message: 'Partenaire créé.' });
    } catch (error) { next(error); }
});

router.patch('/admin/partners/:id', requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant de partenaire invalide.' });
    const body = req.body || {}, name = text(body.name, 180), email = text(body.email, 190).toLowerCase();
    const partnerType = text(body.partner_type, 80), category = text(body.category, 80);
    const commission = body.commission_percent === '' || body.commission_percent === null ? null : Number(body.commission_percent);
    if (name.length < 2 || (email && !validEmail(email)) || partnerType.length < 2 || category.length < 2 ||
        (commission !== null && (!Number.isFinite(commission) || commission < 0 || commission > 100)) || typeof body.is_active !== 'boolean') {
        return res.status(400).json({ error: 'Vérifiez les informations, le taux et le statut du partenaire.' });
    }
    try {
        const program = await getProgram(db);
        if (!program.partner_types.includes(partnerType) || !program.categories.includes(category)) return res.status(400).json({ error: 'Choisissez un type et une catégorie configurés dans les paramètres partenaires.' });
        const [result] = await db.execute(
            'UPDATE platform_partners SET name=?,email=?,phone=?,partner_type=?,category=?,commission_percent=?,is_active=?,notes=? WHERE id=?',
            [name, email || null, text(body.phone, 50) || null, partnerType, category, commission, body.is_active, text(body.notes, 1000) || null, req.params.id]
        );
        if (!result.affectedRows) return res.status(404).json({ error: 'Partenaire introuvable.' });
        await audit(req, 'PARTNER_UPDATED', 'partner', req.params.id, null, { name, partner_type: partnerType, category, commission_percent: commission, is_active: body.is_active });
        res.json({ message: 'Partenaire mis à jour.' });
    } catch (error) { next(error); }
});

router.post('/admin/partners/:id/payout', requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant de partenaire invalide.' });
    const reference = text(req.body?.payment_reference, 190);
    if (!reference) return res.status(400).json({ error: 'Saisissez la référence du paiement manuel.' });
    let connection;
    try {
        const program = await getProgram(db), now = new Date();
        const periodEnd = dateString(now);
        const periodStartDate = program.payout_frequency === 'weekly'
            ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
            : new Date(now.getFullYear(), now.getMonth(), 1);
        const periodStart = dateString(periodStartDate);
        connection = await db.getConnection(); await connection.beginTransaction();
        const [partners] = await connection.execute('SELECT id FROM platform_partners WHERE id=? FOR UPDATE', [req.params.id]);
        if (!partners.length) { await connection.rollback(); connection.release(); connection = null; return res.status(404).json({ error: 'Partenaire introuvable.' }); }
        const [due] = await connection.execute(
            `SELECT id,currency FROM platform_partner_commissions
             WHERE partner_id=? AND status='pending' AND created_at>=? AND created_at<? ORDER BY id FOR UPDATE`,
            [req.params.id, `${periodStart} 00:00:00`, `${dateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))} 00:00:00`]
        );
        if (!due.length) { await connection.rollback(); connection.release(); connection = null; return res.status(409).json({ error: 'Aucune commission impayée pour cette période.' }); }
        const currencies = [...new Set(due.map(row => row.currency))];
        if (currencies.length !== 1) { await connection.rollback(); connection.release(); connection = null; return res.status(409).json({ error: 'Les commissions de plusieurs devises doivent être réglées séparément.' }); }
        const ids = due.map(row => Number(row.id)), placeholders = ids.map(() => '?').join(',');
        const [[totals]] = await connection.execute(`SELECT SUM(commission_amount) amount FROM platform_partner_commissions WHERE id IN (${placeholders})`, ids);
        const [payout] = await connection.execute(
            'INSERT INTO platform_partner_payouts(partner_id,amount,currency,commission_count,period_start,period_end,payment_reference,paid_by_staff_id) VALUES(?,?,?,?,?,?,?,?)',
            [req.params.id, totals.amount, currencies[0], ids.length, periodStart, periodEnd, reference, req.staff.id]
        );
        await connection.execute(`UPDATE platform_partner_commissions SET status='paid',payout_id=?,paid_at=NOW() WHERE id IN (${placeholders})`, [payout.insertId, ...ids]);
        await audit(req, 'PARTNER_PAYOUT_RECORDED', 'partner_payout', payout.insertId, null, { partner_id: req.params.id, amount: totals.amount, currency: currencies[0], commissions: ids.length, reference });
        await connection.commit(); connection.release(); connection = null;
        res.status(201).json({ id: payout.insertId, amount: totals.amount, currency: currencies[0], commission_count: ids.length, period_start: periodStart, period_end: periodEnd, message: 'Versement enregistré.' });
    } catch (error) { if (connection) { try { await connection.rollback(); } finally { connection.release(); } } next(error); }
});

const contentTypes = {
    faqs: {
        table: 'platform_faqs', label: 'FAQ', created: 'PLATFORM_FAQ_CREATED', updated: 'PLATFORM_FAQ_UPDATED',
        columns: 'id,question,answer,category,sort_order,is_active',
        parse(body) {
            const question = text(body.question, 255), answer = text(body.answer, 10000), category = text(body.category, 100);
            if (question.length < 5 || answer.length < 5 || category.length < 2) return null;
            return { fields: ['question', 'answer', 'category'], values: [question, answer, category], title: question };
        }
    },
    trainings: {
        table: 'platform_trainings', label: 'formation', created: 'PLATFORM_TRAINING_CREATED', updated: 'PLATFORM_TRAINING_UPDATED',
        columns: 'id,title,description,url,format,sort_order,is_active',
        parse(body) {
            const title = text(body.title, 180), description = text(body.description, 10000), url = text(body.url, 1000) || null;
            if (title.length < 2 || description.length < 5 || (url && !/^https?:\/\//i.test(url)) || !['article', 'video', 'link'].includes(body.format)) return null;
            return { fields: ['title', 'description', 'url', 'format'], values: [title, description, url, body.format], title };
        }
    }
};

for (const [path, config] of Object.entries(contentTypes)) {
    const parseContent = body => {
        const parsed = config.parse(body || {}), sortOrder = Number(body?.sort_order);
        if (!parsed || !Number.isInteger(sortOrder) || sortOrder < -100000 || sortOrder > 100000 || typeof body.is_active !== 'boolean') return null;
        return { ...parsed, fields: [...parsed.fields, 'sort_order', 'is_active'], values: [...parsed.values, sortOrder, body.is_active] };
    };
    router.get(`/admin/${path}`, requireAdmin, async (req, res, next) => {
        try { const [items] = await db.execute(`SELECT ${config.columns} FROM ${config.table} ORDER BY sort_order,id`); res.json({ items }); }
        catch (error) { next(error); }
    });
    router.post(`/admin/${path}`, requireAdmin, async (req, res, next) => {
        const content = parseContent(req.body);
        if (!content) return res.status(400).json({ error: `Vérifiez les champs de la ${config.label}.` });
        try {
            const [result] = await db.execute(`INSERT INTO ${config.table}(${content.fields.join(',')}) VALUES(${content.fields.map(() => '?').join(',')})`, content.values);
            await audit(req, config.created, config.table, result.insertId, null, { title: content.title });
            res.status(201).json({ id: result.insertId, message: 'Contenu créé.' });
        } catch (error) { next(error); }
    });
    router.patch(`/admin/${path}/:id`, requireAdmin, async (req, res, next) => {
        if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
        const content = parseContent(req.body);
        if (!content) return res.status(400).json({ error: `Vérifiez les champs de la ${config.label}.` });
        try {
            const [result] = await db.execute(`UPDATE ${config.table} SET ${content.fields.map(field => `${field}=?`).join(',')} WHERE id=?`, [...content.values, req.params.id]);
            if (!result.affectedRows) return res.status(404).json({ error: 'Contenu introuvable.' });
            await audit(req, config.updated, config.table, req.params.id, null, { title: content.title });
            res.json({ message: 'Contenu mis à jour.' });
        } catch (error) { next(error); }
    });
}

router.get('/admin/marketing-report', requireAdmin, async (req, res, next) => {
    const to = req.query.to === undefined ? dateString(new Date()) : req.query.to;
    const from = req.query.from === undefined ? dateString(new Date(Date.now() - 29 * 86400000)) : req.query.from;
    if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: 'La période du rapport marketing est invalide.' });
    const endExclusive = dateString(new Date(`${to}T00:00:00`));
    const end = new Date(`${endExclusive}T00:00:00`); end.setDate(end.getDate() + 1);
    const endTime = `${dateString(end)} 00:00:00`, fromTime = `${from} 00:00:00`;
    try {
        const [[signups], [conversions], [revenue], [promotions], [partners], [activities]] = await Promise.all([
            db.execute('SELECT COUNT(*) total FROM organizations WHERE created_at>=? AND created_at<?', [fromTime, endTime]).then(([rows]) => [rows[0]]),
            db.execute(`SELECT COUNT(DISTINCT s.organization_id) total FROM subscriptions s JOIN organizations o ON o.id=s.organization_id
                        WHERE o.created_at>=? AND o.created_at<? AND s.status='active'`, [fromTime, endTime]).then(([rows]) => [rows[0]]),
            db.execute("SELECT COUNT(*) invoices,COALESCE(SUM(total_amount),0) amount FROM platform_invoices WHERE status='paid' AND paid_at>=? AND paid_at<?", [fromTime, endTime]).then(([rows]) => [rows[0]]),
            db.execute(`SELECT p.code,p.name,COUNT(i.id) invoices,COALESCE(SUM(i.discount_amount),0) discount_amount
                        FROM platform_promotions p LEFT JOIN platform_invoices i ON i.promotion_id=p.id AND i.status='paid' AND i.paid_at>=? AND i.paid_at<?
                        GROUP BY p.id ORDER BY invoices DESC,p.name`, [fromTime, endTime]).then(([rows]) => [rows]),
            db.execute(`SELECT p.id,p.name,p.referral_code,
                               (SELECT COUNT(*) FROM organizations o WHERE o.partner_id=p.id AND o.created_at>=? AND o.created_at<?) referrals,
                               (SELECT COALESCE(SUM(c.commission_amount),0) FROM platform_partner_commissions c WHERE c.partner_id=p.id AND c.status='paid' AND c.created_at>=? AND c.created_at<?) paid_commissions,
                               (SELECT COALESCE(SUM(c.commission_amount),0) FROM platform_partner_commissions c WHERE c.partner_id=p.id AND c.status='pending' AND c.created_at>=? AND c.created_at<?) pending_commissions
                        FROM platform_partners p ORDER BY referrals DESC,p.name`, [fromTime, endTime, fromTime, endTime, fromTime, endTime]).then(([rows]) => [rows]),
            db.execute(`SELECT action,COUNT(*) total FROM platform_audit_logs WHERE created_at>=? AND created_at<?
                        GROUP BY action ORDER BY total DESC,action`, [fromTime, endTime]).then(([rows]) => [rows])
        ]);
        res.json({ from, to, signups: Number(signups.total), conversions: Number(conversions.total), paid_invoices: Number(revenue.invoices), paid_revenue: Number(revenue.amount), promotions, partners, activities });
    } catch (error) { next(error); }
});

router.patch('/clients/:id/subscription', requireWrite('clients'), async (req, res, next) => {
    const { plan_id: planId, status, period_start: periodStart, period_end: periodEnd } = req.body || {};
    if (!validId(req.params.id) || !validId(planId) || !['trialing', 'active', 'past_due', 'suspended', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Choisissez un forfait et un statut valides.' });
    if ((periodStart !== undefined || periodEnd !== undefined) && (!validDate(periodStart) || !validDate(periodEnd) || periodEnd < periodStart)) return res.status(400).json({ error: 'Les dates de période sont invalides.' });
    try {
        const [plans] = await db.execute('SELECT id FROM plans WHERE id=? AND is_active=TRUE', [planId]);
        if (!plans.length) return res.status(400).json({ error: 'Forfait introuvable ou inactif.' });
        const [orgs] = await db.execute('SELECT id FROM organizations WHERE id=?', [req.params.id]);
        if (!orgs.length) return res.status(404).json({ error: 'Établissement introuvable.' });
        const [subs] = await db.execute('SELECT id,plan_id,status FROM subscriptions WHERE organization_id=? ORDER BY id DESC LIMIT 1', [req.params.id]);
        if (!subs.length) {
            await db.execute("INSERT INTO subscriptions(organization_id,plan_id,status,billing_interval,current_period_start,current_period_end) VALUES(?,?,?,'monthly',COALESCE(?,CURDATE()),COALESCE(?,DATE_ADD(CURDATE(),INTERVAL 1 MONTH)))", [req.params.id, planId, status, periodStart || null, periodEnd || null]);
        } else {
            await db.execute('UPDATE subscriptions SET plan_id=?,target_plan_id=NULL,status=?,current_period_start=COALESCE(?,current_period_start),current_period_end=COALESCE(?,current_period_end) WHERE id=?', [planId, status, periodStart || null, periodEnd || null, subs[0].id]);
        }
        await audit(req, 'CLIENT_SUBSCRIPTION_CHANGED', 'subscription', subs[0]?.id || 'new', req.params.id, { from_plan_id: subs[0]?.plan_id, to_plan_id: planId, from_status: subs[0]?.status, to_status: status });
        res.json({ message: 'Abonnement mis à jour.' });
    } catch (error) { next(error); }
});

router.get('/invoices', async (req, res, next) => {
    const { limit, offset } = paging(req.query), status = text(req.query.status, 10), clauses = [], values = [];
    if (status && !['draft', 'sent', 'paid', 'void'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    if (status) { clauses.push('i.status=?'); values.push(status); }
    if (req.query.organization_id) { if (!validId(req.query.organization_id)) return res.status(400).json({ error: 'Établissement invalide.' }); clauses.push('i.organization_id=?'); values.push(req.query.organization_id); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
        const [[count]] = await db.execute(`SELECT COUNT(*) total FROM platform_invoices i ${where}`, values);
        const [items] = await db.execute(
            `SELECT i.id,i.invoice_number,i.organization_id,o.name organization_name,i.period_start,i.period_end,i.subtotal,i.discount_amount,i.total_amount,i.currency,i.status,i.due_date,i.paid_at,i.notes
             FROM platform_invoices i JOIN organizations o ON o.id=i.organization_id ${where} ORDER BY i.id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
        res.json({ items, total: Number(count.total), limit, offset });
    } catch (error) { next(error); }
});

router.post('/invoices', requireWrite('invoices'), async (req, res, next) => {
    const { organization_id: organizationId, period_start: periodStart, period_end: periodEnd, due_date: dueDate, notes } = req.body || {};
    const subtotal = money(req.body?.subtotal), discount = req.body?.discount_amount === undefined || req.body.discount_amount === '' ? 0 : money(req.body.discount_amount);
    if (!validId(organizationId) || !validDate(periodStart) || !validDate(periodEnd) || periodEnd < periodStart || !validDate(dueDate) || subtotal === null || discount === null || discount > subtotal) return res.status(400).json({ error: 'Vérifiez l’établissement, les dates, le montant et la remise.' });
    try {
        const [subs] = await db.execute('SELECT s.id,p.currency FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.organization_id=? ORDER BY s.id DESC LIMIT 1', [organizationId]);
        if (!subs.length) return res.status(404).json({ error: 'Aucun abonnement à facturer pour cet établissement.' });
        const total = Math.round((subtotal - discount) * 100) / 100, number = `RED-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const [result] = await db.execute(
            `INSERT INTO platform_invoices(invoice_number,organization_id,subscription_id,period_start,period_end,subtotal,discount_amount,total_amount,currency,status,due_date,notes,created_by,created_by_staff_id)
             VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?,NULL,?)`,
            [number, organizationId, subs[0].id, periodStart, periodEnd, subtotal, discount, total, subs[0].currency, dueDate, text(notes, 500) || null, req.staff.id]);
        await audit(req, 'INVOICE_CREATED', 'invoice', result.insertId, organizationId, { invoice_number: number, total });
        res.status(201).json({ id: result.insertId, invoice_number: number, total_amount: total, message: 'Facture créée en brouillon.' });
    } catch (error) { next(error); }
});

router.patch('/invoices/:id/status', requireWrite('invoices'), async (req, res, next) => {
    const status = req.body?.status;
    if (!validId(req.params.id) || !['draft', 'sent', 'paid', 'void'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    let connection;
    try {
        connection = await db.getConnection(); await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT id,status,organization_id,total_amount,currency FROM platform_invoices WHERE id=? FOR UPDATE', [req.params.id]);
        if (!rows.length) { await connection.rollback(); connection.release(); connection = null; return res.status(404).json({ error: 'Facture introuvable.' }); }
        const invoice = rows[0];
        if (['paid', 'void'].includes(invoice.status) && invoice.status !== status) { await connection.rollback(); connection.release(); connection = null; return res.status(409).json({ error: 'Une facture payée ou annulée ne peut plus changer de statut.' }); }
        await connection.execute('UPDATE platform_invoices SET status=?,paid_at=CASE WHEN ?=\'paid\' THEN COALESCE(paid_at,NOW()) ELSE paid_at END WHERE id=?', [status, status, req.params.id]);
        if (status === 'paid' && invoice.status !== 'paid') await recordPaidInvoiceCommission(connection, invoice);
        await connection.execute(
            'INSERT INTO platform_audit_logs(staff_id,organization_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
            [req.staff.id, invoice.organization_id, 'INVOICE_STATUS_CHANGED', 'invoice', String(req.params.id), JSON.stringify({ from: invoice.status, to: status })]
        );
        await connection.commit(); connection.release(); connection = null;
        res.json({ status, message: 'Statut de la facture mis à jour.' });
    } catch (error) { if (connection) { try { await connection.rollback(); } finally { connection.release(); } } next(error); }
});

const CLAIM_STATUS = ['open', 'in_progress', 'resolved', 'rejected'], CLAIM_PRIORITY = ['low', 'normal', 'high', 'urgent'], CLAIM_CATEGORY = ['billing', 'service', 'technical', 'other'];

router.get('/claims', async (req, res, next) => {
    const { limit, offset } = paging(req.query), status = text(req.query.status, 20), query = text(req.query.q, 120), clauses = [], values = [];
    if (status && !CLAIM_STATUS.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    if (status) { clauses.push('c.status=?'); values.push(status); }
    if (req.query.mine === '1') { clauses.push('c.assigned_staff_id=?'); values.push(req.staff.id); }
    if (query) { clauses.push('(c.subject LIKE ? OR c.reference LIKE ? OR o.name LIKE ?)'); values.push(...Array(3).fill(`%${query}%`)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
        const [[count]] = await db.execute(`SELECT COUNT(*) total FROM platform_claims c JOIN organizations o ON o.id=c.organization_id ${where}`, values);
        const [items] = await db.execute(
            `SELECT c.id,c.reference,c.organization_id,o.name organization_name,c.subject,c.category,c.priority,c.status,c.assigned_staff_id,s.full_name assigned_name,c.created_at,c.resolved_at
             FROM platform_claims c JOIN organizations o ON o.id=c.organization_id LEFT JOIN platform_staff s ON s.id=c.assigned_staff_id
             ${where} ORDER BY FIELD(c.status,'open','in_progress','resolved','rejected'),FIELD(c.priority,'urgent','high','normal','low'),c.id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
        res.json({ items, total: Number(count.total), limit, offset });
    } catch (error) { next(error); }
});

router.post('/claims', requireWrite('claims'), async (req, res, next) => {
    const { organization_id: organizationId } = req.body || {}, subject = text(req.body?.subject, 190), description = text(req.body?.description, 5000);
    const category = req.body?.category || 'other', priority = req.body?.priority || 'normal';
    if (!validId(organizationId) || subject.length < 4 || description.length < 10 || !CLAIM_CATEGORY.includes(category) || !CLAIM_PRIORITY.includes(priority)) return res.status(400).json({ error: 'Renseignez le client, un objet (4+ caractères) et une description (10+ caractères).' });
    try {
        const [orgs] = await db.execute('SELECT id FROM organizations WHERE id=?', [organizationId]);
        if (!orgs.length) return res.status(404).json({ error: 'Établissement introuvable.' });
        const reference = `REC-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const [result] = await db.execute('INSERT INTO platform_claims(reference,organization_id,subject,description,category,priority,created_by_staff_id) VALUES(?,?,?,?,?,?,?)', [reference, organizationId, subject, description, category, priority, req.staff.id]);
        await audit(req, 'CLAIM_CREATED', 'claim', result.insertId, organizationId, { reference });
        res.status(201).json({ id: result.insertId, reference, message: 'Réclamation enregistrée.' });
    } catch (error) { next(error); }
});

router.get('/claims/:id', async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
        const [claims] = await db.execute(
            `SELECT c.*,o.name organization_name,s.full_name assigned_name FROM platform_claims c JOIN organizations o ON o.id=c.organization_id
             LEFT JOIN platform_staff s ON s.id=c.assigned_staff_id WHERE c.id=? LIMIT 1`, [req.params.id]);
        if (!claims.length) return res.status(404).json({ error: 'Réclamation introuvable.' });
        const [notes] = await db.execute('SELECT n.id,n.note,n.created_at,s.full_name FROM platform_claim_notes n LEFT JOIN platform_staff s ON s.id=n.staff_id WHERE n.claim_id=? ORDER BY n.id', [req.params.id]);
        res.json({ claim: claims[0], notes });
    } catch (error) { next(error); }
});

router.patch('/claims/:id', requireWrite('claims'), async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const { status, priority, assigned_staff_id: assignee } = req.body || {}, resolution = req.body?.resolution === undefined ? undefined : text(req.body.resolution, 5000);
    if ((status !== undefined && !CLAIM_STATUS.includes(status)) || (priority !== undefined && !CLAIM_PRIORITY.includes(priority)) || (assignee !== undefined && assignee !== null && !validId(assignee))) return res.status(400).json({ error: 'Valeurs invalides.' });
    if (['resolved', 'rejected'].includes(status) && !(resolution && resolution.length >= 5)) return res.status(400).json({ error: 'Indiquez la résolution ou le motif (5+ caractères).' });
    try {
        const [rows] = await db.execute('SELECT id,organization_id,status FROM platform_claims WHERE id=? LIMIT 1', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Réclamation introuvable.' });
        if (assignee) { const [staff] = await db.execute('SELECT id FROM platform_staff WHERE id=? AND is_active=TRUE', [assignee]); if (!staff.length) return res.status(400).json({ error: 'Employé introuvable ou inactif.' }); }
        const sets = [], values = [];
        if (status !== undefined) { sets.push('status=?', "resolved_at=CASE WHEN ? IN ('resolved','rejected') THEN NOW() ELSE NULL END"); values.push(status, status); }
        if (priority !== undefined) { sets.push('priority=?'); values.push(priority); }
        if (assignee !== undefined) { sets.push('assigned_staff_id=?'); values.push(assignee); }
        if (resolution !== undefined) { sets.push('resolution=?'); values.push(resolution || null); }
        if (!sets.length) return res.status(400).json({ error: 'Aucune modification demandée.' });
        await db.execute(`UPDATE platform_claims SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id]);
        await audit(req, 'CLAIM_UPDATED', 'claim', req.params.id, rows[0].organization_id, { status, priority, assigned_staff_id: assignee });
        res.json({ message: 'Réclamation mise à jour.' });
    } catch (error) { next(error); }
});

router.post('/claims/:id/notes', requireWrite('claims'), async (req, res, next) => {
    const note = text(req.body?.note, 5000);
    if (!validId(req.params.id) || note.length < 2) return res.status(400).json({ error: 'Saisissez une note.' });
    try {
        const [rows] = await db.execute('SELECT id FROM platform_claims WHERE id=?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Réclamation introuvable.' });
        await db.execute('INSERT INTO platform_claim_notes(claim_id,staff_id,note) VALUES(?,?,?)', [req.params.id, req.staff.id, note]);
        res.status(201).json({ message: 'Note ajoutée.' });
    } catch (error) { next(error); }
});

router.get('/support', async (req, res, next) => {
    const { limit, offset } = paging(req.query), status = text(req.query.status, 20), query = text(req.query.q, 120), clauses = [], values = [];
    if (status && !['open', 'in_progress', 'closed'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    if (status) { clauses.push('t.status=?'); values.push(status); }
    if (req.query.mine === '1') { clauses.push('t.assigned_staff_id=?'); values.push(req.staff.id); }
    if (query) { clauses.push('(t.subject LIKE ? OR t.message LIKE ? OR o.name LIKE ?)'); values.push(...Array(3).fill(`%${query}%`)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
        const [[count]] = await db.execute(`SELECT COUNT(*) total FROM support_tickets t JOIN organizations o ON o.id=t.organization_id ${where}`, values);
        const [items] = await db.execute(
            `SELECT t.id,t.organization_id,o.name organization_name,t.subject,t.status,t.created_at,t.assigned_staff_id,s.full_name assigned_name,u.full_name requester_name,
                    (t.support_token IS NOT NULL) is_chat,(SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id=t.id) reply_count
             FROM support_tickets t JOIN organizations o ON o.id=t.organization_id JOIN users u ON u.id=t.user_id LEFT JOIN platform_staff s ON s.id=t.assigned_staff_id
             ${where} ORDER BY FIELD(t.status,'open','in_progress','closed'),t.id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
        res.json({ items, total: Number(count.total), limit, offset });
    } catch (error) { next(error); }
});

router.get('/support/:id', async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
        const [tickets] = await db.execute(
            `SELECT t.id,t.organization_id,t.user_id,o.name organization_name,t.subject,t.message,t.status,t.created_at,t.closed_at,
                    t.assigned_staff_id,t.assignment_type,t.assigned_staff_at,s.full_name assigned_name,u.full_name requester_name,u.email requester_email
             FROM support_tickets t JOIN organizations o ON o.id=t.organization_id JOIN users u ON u.id=t.user_id LEFT JOIN platform_staff s ON s.id=t.assigned_staff_id WHERE t.id=? LIMIT 1`, [req.params.id]);
        if (!tickets.length) return res.status(404).json({ error: 'Demande introuvable.' });
        const [messages] = await db.execute(
            `SELECT m.id,m.message,m.created_at,(m.staff_id IS NOT NULL) is_staff,COALESCE(ps.full_name,u.full_name) full_name
             FROM support_ticket_messages m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN platform_staff ps ON ps.id=m.staff_id WHERE m.ticket_id=? ORDER BY m.id`, [req.params.id]);
        const [feedback] = await db.execute('SELECT rating,comment,created_at FROM support_ticket_feedback WHERE ticket_id=? LIMIT 1', [req.params.id]);
        res.json({ ticket: tickets[0], messages, feedback: feedback[0] || null });
    } catch (error) { next(error); }
});

router.post('/support/:id/claim', requireWrite('support'), async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
        const [result] = await db.execute("UPDATE support_tickets SET assignment_type=IF(assigned_staff_id IS NULL,'voluntary',assignment_type),assigned_staff_at=IF(assigned_staff_id IS NULL,NOW(),assigned_staff_at),assigned_staff_id=?,status=IF(status='open','in_progress',status) WHERE id=? AND status<>'closed' AND (assigned_staff_id IS NULL OR assigned_staff_id=? OR ?)", [req.staff.id, req.params.id, req.staff.id, req.staff.role === 'PLATFORM_ADMIN' ? 1 : 0]);
        if (!result.affectedRows) return res.status(409).json({ error: 'Cette demande est clôturée, introuvable ou déjà prise en charge.' });
        res.json({ message: 'Demande prise en charge.' });
    } catch (error) { next(error); }
});

router.patch('/support/:id/assignment', requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const assignee = req.body?.assigned_staff_id;
    if (assignee !== null && !validId(assignee)) return res.status(400).json({ error: 'Employé invalide.' });
    try {
        const [tickets] = await db.execute('SELECT id,organization_id,status FROM support_tickets WHERE id=? LIMIT 1', [req.params.id]);
        if (!tickets.length) return res.status(404).json({ error: 'Demande introuvable.' });
        if (tickets[0].status === 'closed') return res.status(409).json({ error: 'Une demande clôturée ne peut pas être assignée.' });
        if (assignee !== null) {
            const [staff] = await db.execute('SELECT id FROM platform_staff WHERE id=? AND is_active=TRUE', [assignee]);
            if (!staff.length) return res.status(400).json({ error: 'Employé introuvable ou inactif.' });
        }
        const [result] = await db.execute(
            "UPDATE support_tickets SET assignment_type=?,assigned_staff_at=IF(? IS NULL,NULL,NOW()),assigned_staff_id=? WHERE id=? AND status<>'closed'",
            [assignee === null ? null : 'assigned', assignee, assignee, req.params.id]
        );
        if (!result.affectedRows) return res.status(409).json({ error: 'Cette demande a été clôturée avant son assignation.' });
        await audit(req, 'SUPPORT_TICKET_ASSIGNED', 'ticket', req.params.id, tickets[0].organization_id, { assigned_staff_id: assignee });
        res.json({ message: assignee === null ? 'Assignation retirée.' : 'Demande assignée.' });
    } catch (error) { next(error); }
});

router.post('/support/:id/messages', requireWrite('support'), async (req, res, next) => {
    const message = text(req.body?.message, 5000);
    if (!validId(req.params.id) || message.length < 1) return res.status(400).json({ error: 'Saisissez un message.' });
    try {
        const [tickets] = await db.execute('SELECT id,organization_id,status,assigned_staff_id FROM support_tickets WHERE id=? LIMIT 1', [req.params.id]);
        if (!tickets.length) return res.status(404).json({ error: 'Demande introuvable.' });
        const ticket = tickets[0];
        if (ticket.status === 'closed') return res.status(409).json({ error: 'Cette demande est clôturée.' });
        if (ticket.assigned_staff_id && Number(ticket.assigned_staff_id) !== Number(req.staff.id) && req.staff.role !== 'PLATFORM_ADMIN') return res.status(403).json({ error: 'Cette demande est prise en charge par un autre employé.' });
        await db.execute('INSERT INTO support_ticket_messages(organization_id,ticket_id,user_id,staff_id,message) VALUES(?,?,NULL,?,?)', [ticket.organization_id, ticket.id, req.staff.id, message]);
        await db.execute("UPDATE support_tickets SET assignment_type=IF(assigned_staff_id IS NULL,'voluntary',assignment_type),assigned_staff_at=IF(assigned_staff_id IS NULL,NOW(),assigned_staff_at),status='in_progress',assigned_staff_id=COALESCE(assigned_staff_id,?) WHERE id=?", [req.staff.id, ticket.id]);
        res.status(201).json({ message: 'Réponse envoyée.' });
    } catch (error) { next(error); }
});

router.patch('/support/:id/status', requireWrite('support'), async (req, res, next) => {
    const status = req.body?.status;
    if (!validId(req.params.id) || !['open', 'in_progress', 'closed'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    try {
        const [result] = await db.execute("UPDATE support_tickets SET status=?,closed_at=CASE WHEN ?='closed' THEN COALESCE(closed_at,NOW()) ELSE NULL END WHERE id=?", [status, status, req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Demande introuvable.' });
        await audit(req, 'SUPPORT_STATUS_CHANGED', 'ticket', req.params.id, null, { status });
        res.json({ status, message: 'Statut mis à jour.' });
    } catch (error) { next(error); }
});

router.get('/staff', async (req, res, next) => {
    try {
        const [items] = await db.execute('SELECT id,full_name,email,role,job_title,phone,is_active,is_available,last_login_at,created_at FROM platform_staff ORDER BY is_active DESC,full_name');
        res.json({ items });
    } catch (error) { next(error); }
});

router.post('/staff', requireAdmin, async (req, res, next) => {
    const fullName = text(req.body?.full_name, 180), email = text(req.body?.email, 190).toLowerCase(), role = req.body?.role || 'SUPPORT', password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (fullName.length < 2 || !validEmail(email) || !STAFF_ROLES.includes(role) || password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Nom, e-mail, rôle valides et mot de passe de 12 caractères minimum requis.' });
    try {
        const [result] = await db.execute('INSERT INTO platform_staff(full_name,email,password_hash,role,job_title,phone) VALUES(?,?,?,?,?,?)', [fullName, email, await bcrypt.hash(password, 12), role, text(req.body?.job_title, 120) || null, text(req.body?.phone, 40) || null]);
        await audit(req, 'STAFF_CREATED', 'staff', result.insertId, null, { email, role });
        res.status(201).json({ id: result.insertId, message: 'Employé créé.' });
    } catch (error) { next(error); }
});

router.patch('/staff/:id', requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const sets = [], values = [], body = req.body || {};
    if (body.full_name !== undefined) { const v = text(body.full_name, 180); if (v.length < 2) return res.status(400).json({ error: 'Nom invalide.' }); sets.push('full_name=?'); values.push(v); }
    if (body.role !== undefined) { if (!STAFF_ROLES.includes(body.role)) return res.status(400).json({ error: 'Rôle invalide.' }); sets.push('role=?'); values.push(body.role); }
    if (body.job_title !== undefined) { sets.push('job_title=?'); values.push(text(body.job_title, 120) || null); }
    if (body.phone !== undefined) { sets.push('phone=?'); values.push(text(body.phone, 40) || null); }
    if (body.is_active !== undefined) { sets.push('is_active=?'); values.push(body.is_active ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification demandée.' });
    if (Number(req.params.id) === Number(req.staff.id) && ((body.role !== undefined && body.role !== 'PLATFORM_ADMIN') || body.is_active === false)) return res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte.' });
    try {
        const [result] = await db.execute(`UPDATE platform_staff SET ${sets.join(',')} WHERE id=?`, [...values, req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Employé introuvable.' });
        await audit(req, 'STAFF_UPDATED', 'staff', req.params.id, null, { role: body.role, is_active: body.is_active });
        res.json({ message: 'Employé mis à jour.' });
    } catch (error) { next(error); }
});

router.post('/staff/:id/reset-password', requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
        const temporary = `${crypto.randomBytes(9).toString('base64url')}#7a`;
        const [result] = await db.execute('UPDATE platform_staff SET password_hash=?,password_version=password_version+1 WHERE id=?', [await bcrypt.hash(temporary, 12), req.params.id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Employé introuvable.' });
        await audit(req, 'STAFF_PASSWORD_RESET', 'staff', req.params.id, null, {});
        res.json({ temporary_password: temporary, message: 'Mot de passe réinitialisé. Communiquez-le à l’employé (affiché une seule fois).' });
    } catch (error) { next(error); }
});

router.get('/me/time-clock', async (req, res, next) => {
    try {
        const [sessions] = await db.execute(
            'SELECT id,clock_in FROM platform_staff_work_sessions WHERE staff_id=? AND clock_out IS NULL ORDER BY id DESC LIMIT 1',
            [req.staff.id]
        );
        res.json({ active: sessions[0] || null });
    } catch (error) { next(error); }
});

router.post('/me/time-clock/start', async (req, res, next) => {
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        const [staff] = await connection.execute('SELECT id FROM platform_staff WHERE id=? AND is_active=TRUE FOR UPDATE', [req.staff.id]);
        if (!staff.length) {
            await connection.rollback(); connection.release(); connection = null;
            return res.status(403).json({ error: 'Le compte employé est inactif.' });
        }
        const [active] = await connection.execute('SELECT id FROM platform_staff_work_sessions WHERE staff_id=? AND clock_out IS NULL LIMIT 1 FOR UPDATE', [req.staff.id]);
        if (active.length) {
            await connection.rollback(); connection.release(); connection = null;
            return res.status(409).json({ error: 'Votre journée de travail est déjà commencée.' });
        }
        const [result] = await connection.execute('INSERT INTO platform_staff_work_sessions(staff_id,clock_in) VALUES(?,NOW())', [req.staff.id]);
        const [sessions] = await connection.execute('SELECT id,clock_in FROM platform_staff_work_sessions WHERE id=?', [result.insertId]);
        await connection.commit(); connection.release(); connection = null;
        res.status(201).json({ active: sessions[0] });
    } catch (error) {
        if (connection) { try { await connection.rollback(); } finally { connection.release(); } }
        next(error);
    }
});

router.post('/me/time-clock/stop', async (req, res, next) => {
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();
        await connection.execute('SELECT id FROM platform_staff WHERE id=? FOR UPDATE', [req.staff.id]);
        const [active] = await connection.execute('SELECT id,clock_in FROM platform_staff_work_sessions WHERE staff_id=? AND clock_out IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE', [req.staff.id]);
        if (!active.length) {
            await connection.rollback(); connection.release(); connection = null;
            return res.status(409).json({ error: 'Aucun pointage en cours.' });
        }
        await connection.execute('UPDATE platform_staff_work_sessions SET clock_out=NOW() WHERE id=?', [active[0].id]);
        const [sessions] = await connection.execute('SELECT id,clock_in,clock_out FROM platform_staff_work_sessions WHERE id=?', [active[0].id]);
        await connection.commit(); connection.release(); connection = null;
        res.json({ session: sessions[0] });
    } catch (error) {
        if (connection) { try { await connection.rollback(); } finally { connection.release(); } }
        next(error);
    }
});

router.get('/work-history', async (req, res, next) => {
    const period = text(req.query.period, 10) || 'week';
    const staffId = req.query.staff_id === undefined || req.query.staff_id === '' ? null : req.query.staff_id;
    if (!workPeriods.has(period)) return res.status(400).json({ error: 'Période invalide.' });
    if (staffId !== null && !validId(staffId)) return res.status(400).json({ error: 'Identifiant employé invalide.' });
    if (staffId !== null && req.staff.role !== 'PLATFORM_ADMIN') return res.status(403).json({ error: 'Seuls les administrateurs peuvent consulter les dossiers des autres employés.' });
    const selectedStaff = staffId || (req.staff.role === 'PLATFORM_ADMIN' ? null : req.staff.id);
    const taskPage = paging({ limit: req.query.task_limit, offset: req.query.task_offset });
    const sessionPage = paging({ limit: req.query.session_limit, offset: req.query.session_offset });
    const { start, end } = workPeriodRange(period);
    const startTime = `${start} 00:00:00`, endTime = `${end} 00:00:00`;
    const endDate = new Date(endTime);
    endDate.setDate(endDate.getDate() - 1);
    try {
        const [[staffRows], [taskRows], [sessions], [sessionCountRows]] = await Promise.all([
            db.execute(
                `SELECT s.id staff_id,s.full_name,
                        COALESCE(w.worked_seconds,0) worked_seconds,
                        COALESCE(t.closed_tasks,0) closed_tasks,
                        COALESCE(t.assigned_tasks,0) assigned_tasks,
                        COALESCE(t.voluntary_tasks,0) voluntary_tasks,
                        COALESCE(t.unknown_source_tasks,0) unknown_source_tasks,
                        t.average_resolution_minutes,t.average_rating,COALESCE(t.rating_count,0) rating_count
                 FROM platform_staff s
                 LEFT JOIN (
                    SELECT staff_id,SUM(TIMESTAMPDIFF(SECOND,GREATEST(clock_in,?),LEAST(COALESCE(clock_out,NOW()),?))) worked_seconds
                    FROM platform_staff_work_sessions
                    WHERE clock_in<? AND (clock_out IS NULL OR clock_out>?)
                    GROUP BY staff_id
                 ) w ON w.staff_id=s.id
                 LEFT JOIN (
                    SELECT t.assigned_staff_id,COUNT(*) closed_tasks,
                           SUM(t.assignment_type='assigned') assigned_tasks,
                           SUM(t.assignment_type='voluntary') voluntary_tasks,
                           SUM(t.assignment_type IS NULL) unknown_source_tasks,
                           AVG(CASE WHEN t.assigned_staff_at IS NOT NULL AND t.closed_at>=t.assigned_staff_at
                               THEN TIMESTAMPDIFF(SECOND,t.assigned_staff_at,t.closed_at)/60 END) average_resolution_minutes,
                           AVG(f.rating) average_rating,COUNT(f.id) rating_count
                    FROM support_tickets t LEFT JOIN support_ticket_feedback f ON f.ticket_id=t.id
                    WHERE t.status='closed' AND t.closed_at>=? AND t.closed_at<?
                          AND t.assigned_staff_id IS NOT NULL
                    GROUP BY t.assigned_staff_id
                 ) t ON t.assigned_staff_id=s.id
                 WHERE (? IS NULL OR s.id=?) ORDER BY s.full_name`,
                [startTime, endTime, endTime, startTime, startTime, endTime, selectedStaff, selectedStaff]
            ),
            db.execute(
                `SELECT t.id ticket_id,t.assigned_staff_id staff_id,s.full_name staff_name,o.name organization_name,t.subject,
                        t.assignment_type,t.created_at,t.assigned_staff_at,t.closed_at,
                        CASE WHEN t.assigned_staff_at IS NOT NULL AND t.closed_at>=t.assigned_staff_at
                             THEN TIMESTAMPDIFF(SECOND,t.assigned_staff_at,t.closed_at)/60 END resolution_minutes,
                        f.rating,f.comment feedback_comment
                 FROM support_tickets t
                 JOIN platform_staff s ON s.id=t.assigned_staff_id
                 JOIN organizations o ON o.id=t.organization_id
                 LEFT JOIN support_ticket_feedback f ON f.ticket_id=t.id
                 WHERE t.status='closed' AND t.closed_at>=? AND t.closed_at<?
                       AND (? IS NULL OR t.assigned_staff_id=?)
                 ORDER BY t.closed_at DESC,t.id DESC LIMIT ? OFFSET ?`,
                [startTime, endTime, selectedStaff, selectedStaff, taskPage.limit, taskPage.offset]
            ),
            db.execute(
                `SELECT w.id,w.staff_id,s.full_name staff_name,w.clock_in,w.clock_out,
                        TIMESTAMPDIFF(SECOND,GREATEST(w.clock_in,?),LEAST(COALESCE(w.clock_out,NOW()),?)) worked_seconds
                 FROM platform_staff_work_sessions w JOIN platform_staff s ON s.id=w.staff_id
                 WHERE w.clock_in<? AND (w.clock_out IS NULL OR w.clock_out>?)
                       AND (? IS NULL OR w.staff_id=?)
                 ORDER BY w.clock_in DESC,w.id DESC LIMIT ? OFFSET ?`,
                [startTime, endTime, endTime, startTime, selectedStaff, selectedStaff, sessionPage.limit, sessionPage.offset]
            ),
            db.execute(
                `SELECT COUNT(*) total FROM platform_staff_work_sessions
                 WHERE clock_in<? AND (clock_out IS NULL OR clock_out>?)
                       AND (? IS NULL OR staff_id=?)`,
                [endTime, startTime, selectedStaff, selectedStaff]
            )
        ]);
        const tasksTotal = staffRows.reduce((total, row) => total + Number(row.closed_tasks || 0), 0);
        res.json({
            period, start, end: dateString(endDate),
            staff: staffRows.map(row => ({ ...row, worked_hours: Number((Number(row.worked_seconds) / 3600).toFixed(2)) })),
            tasks: taskRows, tasks_total: tasksTotal, tasks_limit: taskPage.limit, tasks_offset: taskPage.offset,
            sessions, sessions_total: Number(sessionCountRows[0].total), sessions_limit: sessionPage.limit, sessions_offset: sessionPage.offset
        });
    } catch (error) { next(error); }
});

router.get('/schedules', async (req, res, next) => {
    try {
        const [staff] = await db.execute('SELECT id,full_name,role,job_title,is_available FROM platform_staff WHERE is_active=TRUE ORDER BY full_name');
        const [shifts] = await db.execute("SELECT staff_id,weekday,TIME_FORMAT(start_time,'%H:%i') start_time,TIME_FORMAT(end_time,'%H:%i') end_time FROM platform_staff_schedules ORDER BY weekday,start_time");
        res.json({ items: staff.map(member => { const own = shifts.filter(shift => Number(shift.staff_id) === Number(member.id)); return { ...member, shifts: own, on_duty: isOnDuty(own) }; }) });
    } catch (error) { next(error); }
});

router.put('/staff/:id/schedule', requireAdmin, async (req, res, next) => {
    const shifts = req.body?.shifts, problem = validateShifts(shifts);
    if (!validId(req.params.id) || problem) return res.status(400).json({ error: problem || 'Identifiant invalide.' });
    let connection;
    try {
        const [staff] = await db.execute('SELECT id FROM platform_staff WHERE id=?', [req.params.id]);
        if (!staff.length) return res.status(404).json({ error: 'Employé introuvable.' });
        connection = await db.getConnection(); await connection.beginTransaction();
        await connection.execute('DELETE FROM platform_staff_schedules WHERE staff_id=?', [req.params.id]);
        for (const shift of shifts) await connection.execute('INSERT INTO platform_staff_schedules(staff_id,weekday,start_time,end_time) VALUES(?,?,?,?)', [req.params.id, shift.weekday, normalizeTime(shift.start_time), normalizeTime(shift.end_time)]);
        await connection.commit(); connection.release(); connection = null;
        await audit(req, 'STAFF_SCHEDULE_UPDATED', 'staff', req.params.id, null, { shifts: shifts.length });
        res.json({ message: 'Horaires enregistrés.' });
    } catch (error) { if (connection) { try { await connection.rollback(); } finally { connection.release(); } } next(error); }
});

router.get('/tokens', async (req, res, next) => {
    const { limit, offset } = paging(req.query), clauses = [], values = [];
    if (req.query.organization_id) { if (!validId(req.query.organization_id)) return res.status(400).json({ error: 'Établissement invalide.' }); clauses.push('t.organization_id=?'); values.push(req.query.organization_id); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    try {
        const [[count]] = await db.execute(`SELECT COUNT(*) total FROM client_api_tokens t ${where}`, values);
        const [items] = await db.execute(
            `SELECT t.id,t.organization_id,o.name organization_name,t.name,t.token_prefix,t.expires_at,t.revoked_at,t.last_used_at,t.created_at,s.full_name created_by,
                    CASE WHEN t.revoked_at IS NOT NULL THEN 'revoked' WHEN t.expires_at IS NOT NULL AND t.expires_at<=NOW() THEN 'expired' ELSE 'active' END state
             FROM client_api_tokens t JOIN organizations o ON o.id=t.organization_id LEFT JOIN platform_staff s ON s.id=t.created_by_staff_id ${where} ORDER BY t.id DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
        res.json({ items, total: Number(count.total), limit, offset });
    } catch (error) { next(error); }
});

router.post('/tokens', requireWrite('tokens'), async (req, res, next) => {
    const { organization_id: organizationId } = req.body || {}, name = text(req.body?.name, 120), expires = req.body?.expires_at;
    if (!validId(organizationId) || name.length < 2 || (expires && (!validDate(expires) || expires <= new Date().toISOString().slice(0, 10)))) return res.status(400).json({ error: 'Choisissez un client, un nom et une date d’expiration future (optionnelle).' });
    try {
        const [orgs] = await db.execute("SELECT id FROM organizations WHERE id=? AND status='active'", [organizationId]);
        if (!orgs.length) return res.status(404).json({ error: 'Établissement introuvable ou inactif.' });
        const { token, prefix, hash } = generateApiToken();
        const [result] = await db.execute('INSERT INTO client_api_tokens(organization_id,name,token_prefix,token_hash,expires_at,created_by_staff_id) VALUES(?,?,?,?,?,?)', [organizationId, name, prefix, hash, expires ? `${expires} 23:59:59` : null, req.staff.id]);
        await audit(req, 'API_TOKEN_CREATED', 'api_token', result.insertId, organizationId, { name, prefix });
        res.status(201).json({ id: result.insertId, token, message: 'Clé créée. Copiez-la maintenant : elle ne sera plus affichée.' });
    } catch (error) { next(error); }
});

router.post('/tokens/:id/revoke', requireWrite('tokens'), async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    try {
        const [rows] = await db.execute('SELECT organization_id FROM client_api_tokens WHERE id=? AND revoked_at IS NULL', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Clé introuvable ou déjà révoquée.' });
        await db.execute('UPDATE client_api_tokens SET revoked_at=NOW() WHERE id=?', [req.params.id]);
        await audit(req, 'API_TOKEN_REVOKED', 'api_token', req.params.id, rows[0].organization_id, {});
        res.json({ message: 'Clé révoquée.' });
    } catch (error) { next(error); }
});

const n = value => Number(value || 0);
const pct = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

router.get('/analytics/clients', async (req, res, next) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    try {
        const [orgs] = await db.execute('SELECT id,name,status FROM organizations ORDER BY name LIMIT 500');
        const [traffic] = await db.query(`SELECT organization_id,SUM(requests) requests,SUM(client_errors+server_errors) errors,SUM(server_errors) server_errors FROM tenant_traffic_daily WHERE day>DATE_SUB(CURDATE(),INTERVAL ${days} DAY) GROUP BY organization_id`);
        const [seen] = await db.query('SELECT organization_id,MAX(last_request_at) last_request_at FROM tenant_traffic_daily GROUP BY organization_id');
        const [sales] = await db.query(`SELECT organization_id,
            COALESCE(SUM(CASE WHEN created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) THEN total_amount END),0) current_amount,
            COALESCE(SUM(CASE WHEN created_at<DATE_SUB(NOW(),INTERVAL 30 DAY) THEN total_amount END),0) previous_amount
            FROM sales_invoices WHERE status<>'cancelled' AND created_at>=DATE_SUB(NOW(),INTERVAL 60 DAY) GROUP BY organization_id`);
        const [products] = await db.query('SELECT organization_id,COUNT(*) total FROM products WHERE is_active=TRUE GROUP BY organization_id');
        const usage = await getUsage(req.query.refresh === '1');
        const by = rows => new Map(rows.map(row => [Number(row.organization_id), row]));
        const trafficMap = by(traffic), seenMap = by(seen), salesMap = by(sales), productMap = by(products);
        const items = orgs.map(org => {
            const t = trafficMap.get(Number(org.id)), s = salesMap.get(Number(org.id)), u = usage.get(Number(org.id));
            return {
                id: org.id, name: org.name, status: org.status,
                requests: n(t?.requests), errors: n(t?.errors), server_errors: n(t?.server_errors),
                last_request_at: seenMap.get(Number(org.id))?.last_request_at || null,
                storage_bytes: n(u?.bytes), records: n(u?.rows), products: n(productMap.get(Number(org.id))?.total),
                sales_30d: n(s?.current_amount), sales_previous_30d: n(s?.previous_amount), sales_trend: pct(n(s?.current_amount), n(s?.previous_amount))
            };
        });
        const totals = items.reduce((sum, item) => ({ requests: sum.requests + item.requests, errors: sum.errors + item.errors, storage_bytes: sum.storage_bytes + item.storage_bytes, records: sum.records + item.records }), { requests: 0, errors: 0, storage_bytes: 0, records: 0 });
        res.json({ days, items, totals });
    } catch (error) { next(error); }
});

router.get('/analytics/clients/:id', async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'Identifiant invalide.' });
    const id = req.params.id;
    try {
        const [orgs] = await db.execute('SELECT id,name,status FROM organizations WHERE id=? LIMIT 1', [id]);
        if (!orgs.length) return res.status(404).json({ error: 'Établissement introuvable.' });
        const [traffic] = await db.execute(`SELECT DATE_FORMAT(day,'%Y-%m-%d') day,requests,client_errors+server_errors errors,response_bytes FROM tenant_traffic_daily WHERE organization_id=? AND day>DATE_SUB(CURDATE(),INTERVAL 30 DAY) ORDER BY day`, [id]);
        const [productRows] = await db.execute(
            `SELECT it.product_id,MAX(it.product_name) name,
                COALESCE(SUM(CASE WHEN i.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) THEN it.quantity-it.returned_quantity END),0) quantity_current,
                COALESCE(SUM(CASE WHEN i.created_at<DATE_SUB(NOW(),INTERVAL 30 DAY) THEN it.quantity-it.returned_quantity END),0) quantity_previous,
                COALESCE(SUM(CASE WHEN i.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) THEN it.line_total END),0) revenue_current
             FROM sales_invoice_items it JOIN sales_invoices i ON i.id=it.invoice_id
             WHERE i.organization_id=? AND i.status<>'cancelled' AND i.created_at>=DATE_SUB(NOW(),INTERVAL 60 DAY) GROUP BY it.product_id`, [id]);
        const trend = productRows.map(row => ({ product_id: row.product_id, name: row.name, quantity_current: n(row.quantity_current), quantity_previous: n(row.quantity_previous), revenue_current: n(row.revenue_current), change: pct(n(row.quantity_current), n(row.quantity_previous)) }));
        const [weekly] = await db.execute(
            `SELECT DATE_FORMAT(DATE_SUB(DATE(created_at),INTERVAL WEEKDAY(created_at) DAY),'%Y-%m-%d') week,COUNT(*) invoices,COALESCE(SUM(total_amount),0) revenue
             FROM sales_invoices WHERE organization_id=? AND status<>'cancelled' AND created_at>=DATE_SUB(CURDATE(),INTERVAL 12 WEEK) GROUP BY week ORDER BY week`, [id]);
        const [[stock]] = await db.execute(
            `SELECT COUNT(*) total,COALESCE(SUM(is_active AND quantity_on_hand<=0),0) out_of_stock,
                    COALESCE(SUM(is_active AND quantity_on_hand>0 AND quantity_on_hand<=reorder_level),0) low_stock FROM products WHERE organization_id=?`, [id]);
        const [movements] = await db.execute('SELECT movement_type,COUNT(*) total FROM stock_movements WHERE organization_id=? AND created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY movement_type', [id]);
        const [idle] = await db.execute(
            `SELECT p.name,p.quantity_on_hand FROM products p WHERE p.organization_id=? AND p.is_active=TRUE AND p.quantity_on_hand>0
             AND NOT EXISTS (SELECT 1 FROM sales_invoice_items it JOIN sales_invoices i ON i.id=it.invoice_id WHERE it.product_id=p.id AND i.status<>'cancelled' AND i.created_at>=DATE_SUB(NOW(),INTERVAL 30 DAY))
             ORDER BY p.quantity_on_hand DESC LIMIT 10`, [id]);
        const usage = (await getUsage()).get(Number(id)) || { rows: 0, bytes: 0, tables: {} };
        res.json({
            organization: orgs[0],
            traffic: traffic.map(row => ({ day: row.day, requests: n(row.requests), errors: n(row.errors), bytes: n(row.response_bytes) })),
            storage: { bytes: usage.bytes, records: usage.rows, tables: Object.entries(usage.tables).map(([name, value]) => ({ name, ...value })).sort((a, b) => b.bytes - a.bytes).slice(0, 10) },
            products: {
                top: [...trend].sort((a, b) => b.quantity_current - a.quantity_current).filter(row => row.quantity_current > 0).slice(0, 10),
                rising: trend.filter(row => row.quantity_current > row.quantity_previous).sort((a, b) => (b.quantity_current - b.quantity_previous) - (a.quantity_current - a.quantity_previous)).slice(0, 5),
                falling: trend.filter(row => row.quantity_previous > row.quantity_current).sort((a, b) => (b.quantity_previous - b.quantity_current) - (a.quantity_previous - a.quantity_current)).slice(0, 5),
                idle: idle.map(row => ({ name: row.name, quantity_on_hand: n(row.quantity_on_hand) })),
                total: n(stock.total), out_of_stock: n(stock.out_of_stock), low_stock: n(stock.low_stock),
                movements: Object.fromEntries(movements.map(row => [row.movement_type, n(row.total)]))
            },
            weekly_sales: weekly.map(row => ({ week: row.week, invoices: n(row.invoices), revenue: n(row.revenue) }))
        });
    } catch (error) { next(error); }
});

router.get('/audit', requireAdmin, async (req, res, next) => {
    const { limit, offset } = paging(req.query);
    try {
        const [[count]] = await db.execute('SELECT COUNT(*) total FROM platform_audit_logs');
        const [items] = await db.execute(
            `SELECT a.id,a.action,a.entity_type,a.entity_id,a.organization_id,a.details_json,a.created_at,s.full_name staff_name
             FROM platform_audit_logs a LEFT JOIN platform_staff s ON s.id=a.staff_id ORDER BY a.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
        res.json({ items, total: Number(count.total), limit, offset });
    } catch (error) { next(error); }
});

module.exports = router;
