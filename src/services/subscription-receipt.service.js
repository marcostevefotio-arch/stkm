async function getSubscriptionReceipt(connection, invoiceId, organizationId) {
    const values = [invoiceId];
    const tenantFilter = organizationId === undefined ? '' : ' AND i.organization_id=?';
    if (organizationId !== undefined) values.push(organizationId);
    const [rows] = await connection.execute(
        `SELECT i.id,i.invoice_number,DATE_FORMAT(i.period_start,'%Y-%m-%d') period_start,
                DATE_FORMAT(i.period_end,'%Y-%m-%d') period_end,i.total_amount,i.currency,i.paid_at,
                o.name organization_name,o.address organization_address,p.name plan_name,s.billing_interval,
                sp.provider payment_method,ps.full_name recorded_by,
                JSON_EXTRACT(IF(JSON_VALID(i.notes),i.notes,'{}'),'$.subscription_receipt') receipt_details
         FROM platform_invoices i JOIN organizations o ON o.id=i.organization_id
         JOIN subscriptions s ON s.id=i.subscription_id JOIN plans p ON p.id=s.plan_id
         JOIN subscription_payments sp ON sp.subscription_id=i.subscription_id AND sp.provider_reference=i.invoice_number AND sp.payment_status='paid'
         LEFT JOIN platform_staff ps ON ps.id=i.created_by_staff_id
         WHERE i.id=? AND i.status='paid'${tenantFilter} ORDER BY sp.id DESC LIMIT 1`, values
    );
    if (!rows.length) return null;
    const { receipt_details:raw,...receipt } = rows[0];
    const details = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (details?.version === 1) {
        for (const key of ['plan_name','organization_name','organization_address','recorded_by','billing_interval']) {
            if (typeof details[key] === 'string' || details[key] === null) receipt[key] = details[key];
        }
    }
    return receipt;
}

module.exports = { getSubscriptionReceipt };
