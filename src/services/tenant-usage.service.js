const db = require('../config/database');

const EXCLUDED = /^(platform_|client_api_tokens$|tenant_traffic_daily$|subscriptions$)/;
const CACHE_MS = 120000;
let cache = null;

async function tenantTables() {
    const [rows] = await db.execute(
        `SELECT c.TABLE_NAME table_name,COALESCE(t.AVG_ROW_LENGTH,0) avg_row_length
         FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
         WHERE c.TABLE_SCHEMA=DATABASE() AND c.COLUMN_NAME='organization_id' AND t.TABLE_TYPE='BASE TABLE'`
    );
    return rows.filter(row => !EXCLUDED.test(row.table_name) && /^[A-Za-z0-9_]+$/.test(row.table_name));
}

// Estimation : lignes × taille moyenne de ligne, avec la taille exacte des ordonnances numérisées.
async function computeUsage() {
    const byOrg = new Map();
    const add = (organizationId, table, rows, bytes) => {
        const entry = byOrg.get(Number(organizationId)) || { rows: 0, bytes: 0, tables: {} };
        entry.rows += rows; entry.bytes += bytes;
        entry.tables[table] = { rows, bytes };
        byOrg.set(Number(organizationId), entry);
    };
    for (const table of await tenantTables()) {
        const [rows] = await db.query(`SELECT organization_id,COUNT(*) total FROM \`${table.table_name}\` GROUP BY organization_id`);
        for (const row of rows) add(row.organization_id, table.table_name, Number(row.total), Number(row.total) * Number(table.avg_row_length));
    }
    const [items] = await db.query(
        `SELECT i.organization_id,COUNT(*) total FROM sales_invoice_items it JOIN sales_invoices i ON i.id=it.invoice_id GROUP BY i.organization_id`
    );
    const [[itemsMeta]] = await db.query("SELECT COALESCE(AVG_ROW_LENGTH,0) avg_row_length FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_invoice_items'").then(([rows]) => [rows]);
    for (const row of items) add(row.organization_id, 'sales_invoice_items', Number(row.total), Number(row.total) * Number(itemsMeta?.avg_row_length || 0));
    const [files] = await db.query(
        `SELECT i.organization_id,COUNT(*) total,COALESCE(SUM(LENGTH(p.image_data)),0) bytes
         FROM sales_invoice_prescriptions p JOIN sales_invoices i ON i.id=p.invoice_id GROUP BY i.organization_id`
    );
    for (const row of files) add(row.organization_id, 'sales_invoice_prescriptions', Number(row.total), Number(row.bytes));
    return byOrg;
}

async function getUsage(force) {
    if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
    const data = await computeUsage();
    cache = { at: Date.now(), data };
    return data;
}

module.exports = { getUsage };
