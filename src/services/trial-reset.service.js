const db = require('../config/database');
const { saveSnapshot } = require('./tenant-backup.service');

const RESET_MODULES = [
    { key:'stock', label:'Catalogue produits', dependencies:[] },
    { key:'stock_movements', label:'Mouvements de stock', dependencies:['stock'] },
    { key:'procurement', label:'Approvisionnement et fournisseurs', dependencies:['stock'] },
    { key:'sales', label:'Ventes, factures et ordonnances', dependencies:['stock','patients'] },
    { key:'cash', label:'Caisse et mouvements', dependencies:['sales'] },
    { key:'patients', label:'Patients et assurances', dependencies:[] }
];
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const REFERENCES = [
    { parent:'stock',child:'stock_movements',sql:'SELECT 1 FROM stock_movements WHERE organization_id=? LIMIT 1' },
    { parent:'stock',child:'procurement',sql:'SELECT 1 FROM purchase_order_items item JOIN purchase_orders p ON p.id=item.purchase_order_id WHERE p.organization_id=? LIMIT 1' },
    { parent:'stock',child:'sales',sql:'SELECT 1 FROM sales_invoice_items item JOIN sales_invoices i ON i.id=item.invoice_id WHERE i.organization_id=? LIMIT 1' },
    { parent:'patients',child:'sales',sql:`SELECT 1 FROM sales_invoices i WHERE i.organization_id=? AND
        (i.patient_id IS NOT NULL OR EXISTS(SELECT 1 FROM sales_payments p WHERE p.invoice_id=i.id AND p.insurer_id IS NOT NULL)
         OR EXISTS(SELECT 1 FROM sales_returns r WHERE r.invoice_id=i.id AND r.insurer_id IS NOT NULL)) LIMIT 1` },
    { parent:'sales',child:'cash',sql:'SELECT 1 FROM cash_movements WHERE organization_id=? AND invoice_id IS NOT NULL LIMIT 1' }
];

async function resetTrialData({ organizationId,staffId,modules,confirmation,connectionPool = db,backup = saveSnapshot }) {
    if (!Array.isArray(modules) || !modules.length || new Set(modules).size !== modules.length ||
        modules.some(key => !RESET_MODULES.some(module => module.key === key))) {
        throw fail('Sélectionnez au moins un module valide.', 400);
    }
    if (confirmation !== `REINITIALISER ${organizationId}`) throw fail('Saisissez la confirmation exacte avant de supprimer les données.', 400);
    const connection = await connectionPool.getConnection();
    try {
        await connection.beginTransaction();
        const [orgs] = await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE', [organizationId]);
        if (!orgs.length) throw fail('Établissement introuvable.', 404);
        const [subscriptions] = await connection.execute('SELECT id,status,current_period_end>CURDATE() unexpired FROM subscriptions WHERE organization_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [organizationId]);
        if (subscriptions[0]?.status !== 'trialing' || !subscriptions[0].unexpired) throw fail('La réinitialisation est réservée aux clients encore en période d’essai.');
        const [payments] = await connection.execute(
            `SELECT sp.id FROM subscription_payments sp JOIN subscriptions s ON s.id=sp.subscription_id
             WHERE s.organization_id=? AND sp.payment_status='paid' LIMIT 1`, [organizationId]
        );
        const [invoices] = await connection.execute("SELECT id FROM platform_invoices WHERE organization_id=? AND status='paid' LIMIT 1", [organizationId]);
        if (payments.length || invoices.length) throw fail('Ce client a déjà payé un abonnement : réinitialisation des données d’essai refusée.');
        for (const ref of REFERENCES) {
            if (!modules.includes(ref.parent) || modules.includes(ref.child)) continue;
            const [rows] = await connection.execute(ref.sql,[organizationId]);
            if (rows.length) {
                const parent = RESET_MODULES.find(module => module.key === ref.parent).label;
                const child = RESET_MODULES.find(module => module.key === ref.child).label;
                throw fail(`${child} a des références de ${parent}. Sélectionnez également ${child}, ou conservez ${parent}. Aucune donnée n’a été supprimée.`);
            }
        }
        const backupInfo = await backup(connection,organizationId,'before_reset');
        if (!backupInfo?.id || !Number.isFinite(Number(backupInfo.uncompressed_size)) || Number(backupInfo.uncompressed_size) <= 0) throw fail('La sauvegarde n’a pas pu être vérifiée : suppression annulée.', 503);
        const deleted = {};
        const remove = async (key,sql) => {
            const [result] = await connection.execute(sql, [organizationId]);
            deleted[key] = Number(result.affectedRows);
        };
        if (modules.includes('cash')) {
            await remove('cash_movements','DELETE FROM cash_movements WHERE organization_id=?');
            await remove('cash_sessions','DELETE FROM cash_sessions WHERE organization_id=?');
        }
        if (modules.includes('sales')) {
            await remove('sales_return_items','DELETE ri FROM sales_return_items ri JOIN sales_returns r ON r.id=ri.return_id JOIN sales_invoices i ON i.id=r.invoice_id WHERE i.organization_id=?');
            await remove('sales_returns','DELETE r FROM sales_returns r JOIN sales_invoices i ON i.id=r.invoice_id WHERE i.organization_id=?');
            await remove('sales_payments','DELETE p FROM sales_payments p JOIN sales_invoices i ON i.id=p.invoice_id WHERE i.organization_id=?');
            await remove('sales_invoice_prescriptions','DELETE p FROM sales_invoice_prescriptions p JOIN sales_invoices i ON i.id=p.invoice_id WHERE i.organization_id=?');
            await remove('sales_invoice_items','DELETE si FROM sales_invoice_items si JOIN sales_invoices i ON i.id=si.invoice_id WHERE i.organization_id=?');
            await remove('sales_invoices','DELETE FROM sales_invoices WHERE organization_id=?');
        }
        if (modules.includes('procurement')) {
            await remove('purchase_order_items','DELETE pi FROM purchase_order_items pi JOIN purchase_orders p ON p.id=pi.purchase_order_id WHERE p.organization_id=?');
            await remove('purchase_orders','DELETE FROM purchase_orders WHERE organization_id=?');
            await remove('suppliers','DELETE FROM suppliers WHERE organization_id=?');
        }
        if (modules.includes('stock_movements')) {
            await remove('stock_movement_corrections','DELETE FROM stock_movement_corrections WHERE organization_id=?');
            await remove('stock_movements','DELETE FROM stock_movements WHERE organization_id=?');
        }
        if (modules.includes('stock')) {
            await remove('products','DELETE FROM products WHERE organization_id=?');
        }
        if (modules.includes('patients')) {
            await remove('patient_medical_history','DELETE FROM patient_medical_history WHERE organization_id=?');
            await remove('patient_insurance_coverages','DELETE FROM patient_insurance_coverages WHERE organization_id=?');
            await remove('patients','DELETE FROM patients WHERE organization_id=?');
            await remove('insurers','DELETE FROM insurers WHERE organization_id=?');
        }
        await connection.execute('UPDATE users SET password_version=password_version+1 WHERE organization_id=?', [organizationId]);
        await connection.execute(
            'INSERT INTO platform_audit_logs(staff_id,organization_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
            [staffId,organizationId,'TRIAL_DATA_RESET','organization',String(organizationId),JSON.stringify({ modules,deleted,backup_id:backupInfo.id })]
        );
        await connection.commit();
        return { message:'Données d’essai réinitialisées. Les utilisateurs doivent se reconnecter.', modules,deleted,backup_id:backupInfo.id };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally { connection.release(); }
}

module.exports = { resetTrialData,RESET_MODULES };
