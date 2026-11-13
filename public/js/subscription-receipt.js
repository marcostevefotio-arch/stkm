(() => {
    'use strict';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    const date = value => value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value).toLocaleDateString('fr-FR') : '—';
    window.showSubscriptionReceipt = receipt => {
        document.querySelector('.subscription-receipt-overlay [data-close]')?.click();
        const overlay = document.createElement('div');
        overlay.className = 'subscription-receipt-overlay';
        overlay.innerHTML = `<section class="subscription-receipt-sheet"><div class="subscription-receipt-controls"><button type="button" data-close>Fermer</button><label>Orientation <select><option value="portrait">Portrait</option><option value="landscape">Paysage</option></select></label><button type="button" data-print>Imprimer / PDF</button></div><h2>REDAMS</h2><h3>Reçu de paiement d’abonnement</h3><p><b>N° ${esc(receipt.invoice_number)}</b> · ${esc(receipt.paid_at ? new Date(receipt.paid_at).toLocaleString('fr-FR') : '—')}</p><p><b>Client :</b> ${esc(receipt.organization_name)}</p>${receipt.organization_address ? `<p>${esc(receipt.organization_address)}</p>` : ''}<p><b>Forfait :</b> ${esc(receipt.plan_name)}</p><p><b>Période :</b> ${esc(date(receipt.period_start))} au ${esc(date(receipt.period_end))}</p><p><b>Montant payé :</b> ${esc(Number(receipt.total_amount).toLocaleString('fr-FR'))} ${esc(receipt.currency)}</p><p><b>Mode de paiement :</b> ${receipt.payment_method === 'cash' ? 'Espèces' : esc(receipt.payment_method)}</p><p><b>Statut :</b> Payé</p>${receipt.recorded_by ? `<p><b>Enregistré par :</b> ${esc(receipt.recorded_by)}</p>` : ''}<p class="subscription-receipt-error" role="alert"></p></section>`;
        const style = document.createElement('style');
        style.textContent = '.subscription-receipt-overlay{position:fixed;inset:0;z-index:10000;overflow:auto;padding:24px;background:#0008;color:#111;font:14px Arial,sans-serif}.subscription-receipt-sheet{max-width:800px;margin:auto;padding:24px;background:white}.subscription-receipt-sheet p{margin:6px 0}.subscription-receipt-controls{display:flex;gap:12px;align-items:center;margin-bottom:16px}.subscription-receipt-controls label{margin:0;display:flex;gap:6px}.subscription-receipt-error{color:#b91c1c}';
        document.head.appendChild(style); document.body.appendChild(overlay);
        let printStyle;
        const cleanup = () => {
            document.body.classList.remove('subscription-receipt-printing');
            printStyle?.remove(); printStyle = null;
            window.removeEventListener('afterprint', cleanup);
        };
        overlay.querySelector('[data-close]').onclick = () => { cleanup(); overlay.remove(); style.remove(); };
        overlay.querySelector('[data-print]').onclick = () => {
            cleanup();
            printStyle = document.createElement('style');
            const orientation = overlay.querySelector('select').value === 'landscape' ? 'landscape' : 'portrait';
            printStyle.textContent = `@media print{@page{size:A4 ${orientation};margin:10mm 10mm 15mm}body.subscription-receipt-printing>*:not(.subscription-receipt-overlay){display:none!important}body.subscription-receipt-printing .subscription-receipt-overlay{position:static;display:block!important;overflow:visible;padding:0;background:white}body.subscription-receipt-printing .subscription-receipt-sheet{max-width:none;margin:0;padding:0;box-shadow:none}body.subscription-receipt-printing .subscription-receipt-controls,body.subscription-receipt-printing .subscription-receipt-error{display:none!important}}`;
            document.head.appendChild(printStyle);
            document.body.classList.add('subscription-receipt-printing');
            window.addEventListener('afterprint', cleanup);
            try { window.print(); }
            catch (error) { cleanup(); overlay.querySelector('[role="alert"]').textContent = error.message; }
        };
    };
})();
