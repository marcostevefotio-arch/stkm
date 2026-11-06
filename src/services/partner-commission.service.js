const DEFAULT_PROGRAM = {
    default_commission_percent: 10,
    partner_types: ['Revendeur', 'Apporteur d’affaires'],
    categories: ['Logiciel', 'Santé'],
    payout_frequency: 'monthly',
    currency: 'XAF'
};

function parseProgram(value) {
    if (typeof value !== 'string') return value && typeof value === 'object' ? value : DEFAULT_PROGRAM;
    try { return JSON.parse(value); } catch { return DEFAULT_PROGRAM; }
}

async function getProgram(connection) {
    const [rows] = await connection.execute("SELECT setting_value FROM platform_settings WHERE setting_key='partner_program' LIMIT 1");
    return { ...DEFAULT_PROGRAM, ...parseProgram(rows[0]?.setting_value) };
}

async function recordPaidInvoiceCommission(connection, invoice) {
    const [organizations] = await connection.execute('SELECT partner_id FROM organizations WHERE id=? FOR UPDATE', [invoice.organization_id]);
    const partnerId = organizations[0]?.partner_id;
    if (!partnerId || Number(invoice.total_amount) <= 0) return false;
    const [existing] = await connection.execute('SELECT id FROM platform_partner_commissions WHERE invoice_id=? LIMIT 1', [invoice.id]);
    if (existing.length) return false;
    const [partners] = await connection.execute('SELECT id,commission_percent FROM platform_partners WHERE id=? FOR UPDATE', [partnerId]);
    if (!partners.length) return false;
    const program = await getProgram(connection);
    const commissionPercent = Number(partners[0].commission_percent ?? program.default_commission_percent);
    if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) throw new Error('Le taux de commission du partenaire est invalide.');
    const amount = Math.round(Number(invoice.total_amount) * commissionPercent) / 100;
    if (amount <= 0) return false;
    await connection.execute(
        `INSERT INTO platform_partner_commissions
         (partner_id,organization_id,invoice_id,invoice_amount,commission_percent,commission_amount,currency)
         VALUES(?,?,?,?,?,?,?)`,
        [partnerId, invoice.organization_id, invoice.id, invoice.total_amount, commissionPercent, amount, invoice.currency]
    );
    return true;
}

module.exports = { DEFAULT_PROGRAM, getProgram, parseProgram, recordPaidInvoiceCommission };
