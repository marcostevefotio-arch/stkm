const crypto = require('node:crypto');
const { gzip,gunzip } = require('node:zlib');
const { promisify } = require('node:util');
const db = require('../config/database');
const { normalizeBackup,restoreBackupValue,sameBackupRow } = require('./backup-format');
const compress = promisify(gzip),decompress = promisify(gunzip);

const RETENTION_DAYS = 365;
const MAX_BYTES = 128 * 1024 * 1024;
const BACKUP_MODULES = [
    { key:'stock',label:'Stock et catalogue',tables:['products','stock_movements','stock_movement_corrections'] },
    { key:'procurement',label:'Approvisionnement',tables:['suppliers','purchase_orders','purchase_order_items'] },
    { key:'sales',label:'Ventes et facturation',tables:['sales_invoices','sales_invoice_prescriptions','sales_invoice_items','sales_payments','sales_returns','sales_return_items'] },
    { key:'cash',label:'Recettes et caisse',tables:['cash_sessions','cash_movements'] },
    { key:'patients',label:'Patients et assurances',tables:['patients','insurers','patient_medical_history','patient_insurance_coverages'] },
    { key:'administration',label:'Utilisateurs et paramètres',protected:true,tables:['organizations','users','account_email_claims','organization_settings'] },
    { key:'subscription',label:'Abonnements et paiements',protected:true,tables:['subscriptions','subscription_payments','platform_invoices','platform_partner_commissions'] },
    { key:'accounting',label:'Comptabilité et révisions',protected:true,tables:['accounting_books','accounting_entries','accounting_review_snapshots'] },
    { key:'support',label:'Assistance et réclamations',tables:['support_tickets','support_ticket_messages','support_ticket_feedback','platform_claims','platform_claim_notes'] },
    { key:'notifications',label:'Notifications',tables:['notifications','notification_reads'] },
    { key:'reports',label:'Audits et statistiques',protected:true,tables:['audit_logs','platform_audit_logs','tenant_traffic_daily','backup_records'] }
];
const TABLES = BACKUP_MODULES.flatMap(module => module.tables);
const CHILD_SCOPES = {
    account_email_claims:['users','user_id'],
    purchase_order_items:['purchase_orders','purchase_order_id'],
    sales_invoice_prescriptions:['sales_invoices','invoice_id'],
    sales_invoice_items:['sales_invoices','invoice_id'],
    sales_payments:['sales_invoices','invoice_id'],
    sales_returns:['sales_invoices','invoice_id'],
    sales_return_items:['sales_returns','return_id'],
    subscription_payments:['subscriptions','subscription_id'],
    notification_reads:['notifications','notification_id'],
    platform_claim_notes:['platform_claims','claim_id']
};
const fail = (message,status = 409) => Object.assign(new Error(message),{ status });
const identifier = name => {
    if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(name)) throw fail('Identifiant de schéma invalide.',500);
    return `\`${name}\``;
};
function scope(table,alias = 't') {
    if (table === 'organizations') return `${alias}.id=?`;
    const child = CHILD_SCOPES[table];
    if (child) {
        const [parent,column] = child;
        return `EXISTS(SELECT 1 FROM ${identifier(parent)} parent_${table} WHERE parent_${table}.id=${alias}.${identifier(column)} AND ${scope(parent,`parent_${table}`)})`;
    }
    return `${alias}.organization_id=?`;
}
const projection = (columns,alias = 't') => columns.map(column => {
    const name = `${alias}.${identifier(column.COLUMN_NAME)}`;
    if (column.DATA_TYPE === 'bigint') return `CAST(${name} AS CHAR) AS ${identifier(column.COLUMN_NAME)}`;
    if (column.DATA_TYPE === 'date') return `DATE_FORMAT(${name},'%Y-%m-%d') AS ${identifier(column.COLUMN_NAME)}`;
    if (['timestamp','datetime'].includes(column.DATA_TYPE)) return `DATE_FORMAT(${name},'%Y-%m-%d %H:%i:%s') AS ${identifier(column.COLUMN_NAME)}`;
    return name;
}).join(',');

async function schema(connection) {
    const placeholders = TABLES.map(() => '?').join(',');
    const [columns] = await connection.execute(
        `SELECT TABLE_NAME,COLUMN_NAME,COLUMN_KEY,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME,ORDINAL_POSITION`,TABLES
    );
    const metadata = new Map();
    for (const column of columns) {
        if (!metadata.has(column.TABLE_NAME)) metadata.set(column.TABLE_NAME,[]);
        metadata.get(column.TABLE_NAME).push(column);
    }
    for (const name of ['organizations','users','products','subscriptions']) if (!metadata.has(name)) throw fail(`Table ${name} absente ; sauvegarde bloquée.`,503);
    const [engines] = await connection.execute(`SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,TABLES);
    for (const name of metadata.keys()) if (!engines.some(table => table.TABLE_NAME === name && table.ENGINE === 'InnoDB')) throw fail(`La table ${name} doit utiliser InnoDB pour une sauvegarde cohérente.`,503);
    for (const [name,items] of metadata) if (!items.some(item => item.COLUMN_KEY === 'PRI')) throw fail(`Clé primaire absente dans ${name}.`,503);
    const [references] = await connection.execute(
        `SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) AND REFERENCED_TABLE_NAME IS NOT NULL`,TABLES
    );
    const ordered = [], visiting = new Set();
    const visit = table => {
        if (ordered.includes(table)) return;
        if (visiting.has(table)) throw fail(`Dépendance circulaire dans ${table}.`,503);
        visiting.add(table);
        for (const ref of references.filter(item => item.TABLE_NAME === table && item.REFERENCED_TABLE_NAME !== table)) if (metadata.has(ref.REFERENCED_TABLE_NAME)) visit(ref.REFERENCED_TABLE_NAME);
        visiting.delete(table); ordered.push(table);
    };
    for (const table of metadata.keys()) visit(table);
    return { metadata,references,ordered };
}

async function saveSnapshot(connection,organizationId,reason) {
    if (!['daily','manual','before_reset','before_restore'].includes(reason)) throw fail('Motif de sauvegarde invalide.',400);
    const { metadata,ordered } = await schema(connection), tables = {};
    let rowCount = 0, byteCount = 0;
    for (const table of ordered) {
        const columns = metadata.get(table), primary = columns.filter(column => column.COLUMN_KEY === 'PRI').map(column => `t.${identifier(column.COLUMN_NAME)}`).join(',');
        const [rows] = await connection.execute(`SELECT ${projection(columns)} FROM ${identifier(table)} t WHERE ${scope(table)} ORDER BY ${primary}`,[organizationId]);
        tables[table] = rows.map(normalizeBackup); rowCount += rows.length;
        byteCount += Buffer.byteLength(JSON.stringify(tables[table]));
        if (byteCount > MAX_BYTES) throw fail('La sauvegarde du client dépasse 128 Mo : aucune suppression ne sera effectuée.',413);
    }
    const output = Buffer.from(JSON.stringify({ format:'redams-full-tenant-backup',version:1,organization_id:String(organizationId),created_at:new Date().toISOString(),tables }));
    if (output.length > MAX_BYTES) throw fail('La sauvegarde du client dépasse 128 Mo.',413);
    const checksum = crypto.createHash('sha256').update(output).digest('hex');
    const [saved] = await connection.execute(
        'INSERT INTO tenant_backups(organization_id,reason,payload,checksum,uncompressed_size,row_count,expires_at) VALUES(?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 365 DAY))',
        [organizationId,reason,await compress(output),checksum,output.length,rowCount]
    );
    return { id:saved.insertId,reason,row_count:rowCount,uncompressed_size:output.length };
}

async function createTenantBackup({ organizationId,reason = 'manual',staffId,userId,connectionPool = db,connection:existingConnection }) {
    const connection = existingConnection || await connectionPool.getConnection();
    try {
        await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.beginTransaction();
        const [orgs] = await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE',[organizationId]);
        if (!orgs.length) throw fail('Établissement introuvable.',404);
        const backup = await saveSnapshot(connection,organizationId,reason);
        if (reason === 'daily') await connection.execute('INSERT INTO tenant_backup_status(organization_id,last_success_at,last_attempt_at,last_error) VALUES(?,NOW(),NOW(),NULL) ON DUPLICATE KEY UPDATE last_success_at=NOW(),last_attempt_at=NOW(),last_error=NULL',[organizationId]);
        if (staffId) await connection.execute('INSERT INTO platform_audit_logs(staff_id,organization_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',[staffId,organizationId,'TENANT_BACKUP_CREATED','backup',String(backup.id),JSON.stringify({ reason })]);
        else if (userId) await connection.execute('INSERT INTO audit_logs(organization_id,user_id,action,entity_type,details_json) VALUES(?,?,?,?,?)',[organizationId,userId,'TENANT_BACKUP_CREATED','backup',JSON.stringify({ backup_id:backup.id,reason })]);
        await connection.commit(); return backup;
    } catch (error) { await connection.rollback(); throw error; }
    finally { if (!existingConnection) connection.release(); }
}

async function listTenantBackups(connection,organizationId,{ limit = 25,offset = 0 } = {}) {
    const [items] = await connection.execute(
        'SELECT id,reason,uncompressed_size,row_count,created_at,expires_at FROM tenant_backups WHERE organization_id=? AND expires_at>NOW() ORDER BY id DESC LIMIT ? OFFSET ?',
        [organizationId,limit,offset]
    );
    const [[count]] = await connection.execute('SELECT COUNT(*) total FROM tenant_backups WHERE organization_id=? AND expires_at>NOW()',[organizationId]);
    const [status] = await connection.execute('SELECT last_success_at,last_attempt_at,last_error FROM tenant_backup_status WHERE organization_id=?',[organizationId]);
    return { items,total:Number(count.total),limit,offset,status:status[0] || null,retention_days:RETENTION_DAYS,modules:BACKUP_MODULES.map(({ tables,...module }) => module) };
}

async function loadSnapshot(connection,organizationId,backupId) {
    const [rows] = await connection.execute('SELECT payload,checksum,uncompressed_size FROM tenant_backups WHERE id=? AND organization_id=? AND expires_at>NOW()',[backupId,organizationId]);
    if (!rows.length) throw fail('Sauvegarde introuvable pour cet établissement.',404);
    const row = rows[0];
    if (!Buffer.isBuffer(row.payload) || Number(row.uncompressed_size) > MAX_BYTES) throw fail('Sauvegarde illisible ou trop volumineuse.',500);
    const output = await decompress(row.payload,{ maxOutputLength:MAX_BYTES });
    if (output.length !== Number(row.uncompressed_size) || crypto.createHash('sha256').update(output).digest('hex') !== row.checksum) throw fail('La signature de la sauvegarde est invalide. Restauration bloquée.',500);
    const payload = JSON.parse(output.toString('utf8'));
    if (payload.format !== 'redams-full-tenant-backup' || payload.version !== 1 || String(payload.organization_id) !== String(organizationId) ||
        !payload.tables || typeof payload.tables !== 'object' || Array.isArray(payload.tables) ||
        Object.entries(payload.tables).some(([table,rows]) => !TABLES.includes(table) || !Array.isArray(rows))) {
        throw fail('Sauvegarde invalide ou appartenant à un autre établissement.',403);
    }
    return restoreBackupValue(payload.tables);
}

async function mergeTenantBackup({ organizationId,backupId,modules,confirmation,staffId,userId,connectionPool = db }) {
    if (!Array.isArray(modules) || !modules.length || new Set(modules).size !== modules.length ||
        modules.some(key => !BACKUP_MODULES.some(module => module.key === key))) throw fail('Choisissez au moins un module à restaurer.',400);
    if (!staffId && modules.some(key => BACKUP_MODULES.find(module => module.key === key).protected)) throw fail('Utilisateurs, paramètres, abonnements, audits et comptabilité : restauration réservée au superadmin.',403);
    if (confirmation !== `RESTAURER ${organizationId}`) throw fail('Confirmation de restauration incorrecte.',400);
    const connection = await connectionPool.getConnection();
    try {
        await connection.beginTransaction();
        const [orgs] = await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE',[organizationId]);
        if (!orgs.length) throw fail('Établissement introuvable.',404);
        const tables = await loadSnapshot(connection,organizationId,backupId);
        const { metadata,references,ordered } = await schema(connection);
        const selected = new Set(BACKUP_MODULES.filter(module => modules.includes(module.key)).flatMap(module => module.tables));
        for (const table of selected) if (tables[table] && !metadata.has(table)) throw fail(`La table ${table} n’existe plus dans le schéma actuel.`,409);
        const securityBackup = await saveSnapshot(connection,organizationId,'before_restore');
        let inserted = 0,existing = 0;
        const restoredTables = {};
        for (const table of ordered.filter(name => selected.has(name))) {
            const rows = tables[table] || [], columns = metadata.get(table), allowed = new Set(columns.map(item => item.COLUMN_NAME));
            const primary = columns.filter(item => item.COLUMN_KEY === 'PRI').map(item => item.COLUMN_NAME);
            for (const row of rows) {
                if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(column => !allowed.has(column)) || primary.some(column => row[column] === null || row[column] === undefined)) throw fail(`Schéma incompatible dans ${table}.`,400);
                if (Object.hasOwn(row,'organization_id') && String(row.organization_id) !== String(organizationId)) throw fail('Données d’un autre établissement détectées.',403);
                const keyValues = primary.map(key => row[key]);
                const where = primary.map(column => `t.${identifier(column)}=?`).join(' AND ');
                const [found] = await connection.execute(`SELECT ${projection(columns)} FROM ${identifier(table)} t WHERE ${where} FOR UPDATE`,keyValues);
                if (found.length) {
                    const [owned] = await connection.execute(`SELECT 1 FROM ${identifier(table)} t WHERE ${where} AND ${scope(table)} LIMIT 1`,[...keyValues,organizationId]);
                    if (!owned.length) throw fail(`Conflit avec un autre établissement dans ${table}.`,403);
                    if (['organizations','organization_settings','users'].includes(table) || sameBackupRow(found[0],row,Object.keys(row))) { existing++; continue; }
                    throw fail(`Conflit dans ${table} : les données actuelles ont été modifiées. Aucune donnée n’a été fusionnée.`);
                }
                if (table === 'account_email_claims') {
                    const [matchingUsers] = await connection.execute('SELECT 1 FROM users WHERE id=? AND organization_id=? AND LOWER(email)=LOWER(?)',[row.user_id,organizationId,row.email]);
                    if (!matchingUsers.length) throw fail('L’adresse e-mail sauvegardée ne correspond plus au compte actuel. Fusion annulée.');
                }
                for (const ref of references.filter(item => item.TABLE_NAME === table)) {
                    const value = row[ref.COLUMN_NAME];
                    if (value === null || value === undefined) continue;
                    const parent = ref.REFERENCED_TABLE_NAME;
                    const externalAgent = table === 'support_tickets' && ref.COLUMN_NAME === 'assigned_agent_id' && parent === 'users';
                    const tenantParent = TABLES.includes(parent) && !externalAgent;
                    const tenantFilter = tenantParent ? ` AND ${scope(parent,'parent')}` : '';
                    const [valid] = await connection.execute(
                        `SELECT 1 FROM ${identifier(parent)} parent WHERE parent.${identifier(ref.REFERENCED_COLUMN_NAME)}=?${tenantFilter} LIMIT 1`,
                        tenantParent ? [value,organizationId] : [value]
                    );
                    if (!valid.length) throw fail(`${table} a des références à ${parent} absentes : restaurez également le module parent.`);
                }
                const names = Object.keys(row);
                try {
                    await connection.execute(`INSERT INTO ${identifier(table)}(${names.map(identifier).join(',')}) VALUES(${names.map(() => '?').join(',')})`,names.map(column => row[column]));
                } catch (error) {
                    if (error.code === 'ER_DUP_ENTRY') throw fail(`Conflit avec une valeur existante dans ${table} : fusion annulée.`);
                    throw error;
                }
                inserted++; restoredTables[table] = (restoredTables[table] || 0) + 1;
            }
        }
        if (selected.has('users')) await connection.execute('UPDATE users SET password_version=password_version+1 WHERE organization_id=?',[organizationId]);
        const details = JSON.stringify({ backup_id:backupId,security_backup_id:securityBackup.id,modules,inserted,existing });
        if (staffId) await connection.execute('INSERT INTO platform_audit_logs(staff_id,organization_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',[staffId,organizationId,'TENANT_BACKUP_MERGED','backup',String(backupId),details]);
        else await connection.execute('INSERT INTO audit_logs(organization_id,user_id,action,entity_type,details_json) VALUES(?,?,?,?,?)',[organizationId,userId,'BACKUP_MERGED','backup',details]);
        await connection.commit();
        return { message:'Sauvegarde fusionnée, sans remplacement des données actuelles.',inserted,already_present:existing,restored_tables:restoredTables,security_backup_id:securityBackup.id };
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
}

async function runDailyBackups({ connectionPool = db,createBackup = createTenantBackup,logError = console.error } = {}) {
    const connection = await connectionPool.getConnection();
    let locked = false;
    try {
        const [[lock]] = await connection.execute("SELECT GET_LOCK('redams_daily_tenant_backups',0) acquired");
        if (Number(lock.acquired) !== 1) return { skipped:true };
        locked = true;
        const [clients] = await connection.execute(
            `SELECT o.id FROM organizations o LEFT JOIN tenant_backup_status s ON s.organization_id=o.id
             WHERE s.last_success_at IS NULL OR s.last_success_at<=DATE_SUB(NOW(),INTERVAL 24 HOUR) ORDER BY o.id`
        );
        let completed = 0,failed = 0;
        for (const client of clients) {
            try {
                await createBackup({ organizationId:client.id,reason:'daily',connectionPool,connection });
                completed++;
            } catch (error) {
                failed++;
                logError(`Sauvegarde quotidienne du client ${client.id} échouée : ${error.message}`);
                await connection.execute('INSERT INTO tenant_backup_status(organization_id,last_attempt_at,last_error) VALUES(?,NOW(),?) ON DUPLICATE KEY UPDATE last_attempt_at=NOW(),last_error=VALUES(last_error)',[client.id,String(error.message).slice(0,1000)]);
            }
        }
        await connection.execute('DELETE FROM tenant_backups WHERE expires_at<=NOW() LIMIT 1000');
        return { completed,failed };
    } finally {
        try { if (locked) await connection.execute("SELECT RELEASE_LOCK('redams_daily_tenant_backups')"); }
        finally { connection.release(); }
    }
}

function startDailyBackups({ run = runDailyBackups,logError = console.error } = {}) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try { await run(); } catch (error) { logError(`Sauvegardes automatiques indisponibles : ${error.message}. Vérifiez la migration 2026111301_tenant_backups.`); }
        finally { running = false; }
    };
    tick();
    const timer = setInterval(tick,5 * 60 * 1000); timer.unref();
    return () => clearInterval(timer);
}

module.exports = { BACKUP_MODULES,RETENTION_DAYS,createTenantBackup,listTenantBackups,mergeTenantBackup,saveSnapshot,runDailyBackups,startDailyBackups };
