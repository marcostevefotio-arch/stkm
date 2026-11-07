window.RedamsAccounting = (() => {
    const typeLabels = { asset: 'Actif', liability: 'Passif', equity: 'Capitaux propres', income: 'Produit', expense: 'Charge' };
    const flowLabels = { operating: 'Exploitation', investing: 'Investissement', financing: 'Financement' };
    const types = Object.entries(typeLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    const flows = Object.entries(flowLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
    const current = () => location.hash === '#accounting-results';

    const exportColumns = [
        ['section', 'Section'], ['date', 'Date'], ['entryId', 'Identifiant écriture'], ['kind', 'Type écriture'],
        ['description', 'Description'], ['accountId', 'Identifiant compte'], ['code', 'Code compte'],
        ['name', 'Libellé compte'], ['category', 'Catégorie'], ['debit', 'Débit'], ['credit', 'Crédit'],
        ['opening', 'Solde initial'], ['closing', 'Solde final'], ['net', 'Montant net'],
        ['receipt', 'Entrée'], ['payment', 'Sortie'], ['transfer', 'Virement interne possible']
    ];
    const exportTextColumns = new Set(['date', 'entryId', 'accountId', 'code', 'debit', 'credit', 'opening', 'closing', 'net', 'receipt', 'payment']);
    const exportNames = { income: 'etat-resultats', balance: 'bilan', journal: 'journal', ledger: 'grand-livre', cashflow: 'flux-tresorerie', tax: 'taxes' };

    function buildExport(type, data, currency, selection = '') {
        if (!Object.hasOwn(exportNames, type)) throw new Error('Rapport comptable inconnu.');
        const rows = [
            { section: 'Rapport', description: exportNames[type] },
            { section: 'Date ouverture', date: data.openingDate },
            ...(data.date ? [{ section: 'Date du bilan', date: data.date }] : [
                { section: 'Début période', date: data.from }, { section: 'Fin période', date: data.to }
            ]),
            { section: 'Devise', description: currency },
            { section: 'Périmètre', description: 'Uniquement les écritures comptables validées ; les opérations absentes et les brouillons sont exclus. Les ventes et achats du portail ne sont pas importés automatiquement.' },
            { section: 'Avertissement', description: data.warning }
        ];
        if (type === 'ledger') rows.push({ section: 'Filtre compte', description: selection || 'Tous les comptes' });
        const accountFields = account => ({ accountId: account.id, code: account.code, name: account.name });
        const totals = (label, values) => Object.entries(values).forEach(([name, value]) => rows.push({ section: label, description: name, net: value }));
        if (type === 'income') {
            data.accounts.forEach(account => rows.push({ section: 'Compte', ...accountFields(account), category: typeLabels[account.type], debit: account.debit, credit: account.credit, net: account.net }));
            totals('Total', { Produits: data.totals.income, Charges: data.totals.expense, Résultat: data.totals.net });
        } else if (type === 'balance') {
            data.accounts.forEach(account => rows.push({ section: 'Compte', ...accountFields(account), category: typeLabels[account.type], net: account.net }));
            totals('Total', { Actif: data.totals.asset, Passif: data.totals.liability, 'Capitaux propres': data.totals.equity, 'Résultat cumulé non clôturé': data.totals.accumulatedResult });
        } else if (type === 'journal') {
            data.entries.forEach(entry => entry.lines.forEach(line => rows.push({ section: 'Ligne', date: entry.date, entryId: entry.id, kind: entry.kind === 'opening' ? 'Ouverture' : 'Courante', description: entry.description, accountId: line.accountId, code: line.code, name: line.name, debit: line.debit, credit: line.credit })));
            rows.push({ section: 'Total', debit: data.totals.debit, credit: data.totals.credit });
        } else if (type === 'ledger') {
            data.accounts.forEach(account => {
                rows.push({ section: 'Compte', ...accountFields(account), category: typeLabels[account.type], opening: account.openingBalance, debit: account.debit, credit: account.credit, closing: account.closingBalance });
                account.movements.forEach(movement => rows.push({ section: 'Mouvement', ...accountFields(account), date: movement.date, entryId: movement.entryId, kind: movement.kind === 'opening' ? 'Ouverture' : 'Courante', description: movement.description, debit: movement.debit, credit: movement.credit, closing: movement.balance }));
            });
        } else if (type === 'cashflow') {
            rows.push({ section: 'Trésorerie', opening: data.totals.opening, closing: data.totals.closing });
            Object.entries(flowLabels).forEach(([key, label]) => {
                const category = data.categories[key];
                rows.push({ section: 'Catégorie', category: label, receipt: category.receipts, payment: category.payments, net: category.net });
                category.movements.forEach(movement => rows.push({ section: 'Mouvement', category: label, date: movement.date, entryId: movement.entryId, description: movement.description, accountId: movement.accountId, code: movement.code, name: movement.name, receipt: movement.receipt, payment: movement.payment, transfer: movement.possibleInternalTransfer ? 'Oui' : 'Non' }));
            });
        } else {
            data.accounts.forEach(account => {
                const category = account.category === 'payable' ? 'Taxe collectée' : 'Taxe déductible';
                rows.push({ section: 'Compte', ...accountFields(account), category, debit: account.debit, credit: account.credit, net: account.netMovement });
                account.movements.forEach(movement => rows.push({ section: 'Mouvement', ...accountFields(account), category, date: movement.date, entryId: movement.entryId, description: movement.description, debit: movement.debit, credit: movement.credit }));
            });
        }
        function escape(value, forceText = false) {
            let text = String(value ?? '');
            if (text && (forceText || /^[\s\u0000-\u001f]*[=+\-@]/.test(text))) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        }
        const header = exportColumns.map(([, label]) => escape(label)).join(';');
        const content = rows.map(row => exportColumns.map(([key]) => escape(row[key], exportTextColumns.has(key))).join(';'));
        const period = data.date || `${data.from}-${data.to}`;
        return { filename: `comptabilite-${exportNames[type]}-${period}.csv`, content: `\uFEFF${[header, ...content].join('\r\n')}\r\n` };
    }

    function attachExport(output, type, data, currency, form, selection = '') {
        const changed = () => {
            output.replaceChildren();
            form.querySelector('.error').textContent = 'Les paramètres ont changé. Recalculez le rapport avant de l’exporter.';
        };
        form.oninput = changed;
        form.onchange = changed;
        if ((type === 'balance' && form.elements.date.value !== data.date) ||
            (type !== 'balance' && (form.elements.from.value !== data.from || form.elements.to.value !== data.to)) ||
            (type === 'ledger' && form.elements.accountId.value !== selection)) {
            changed();
            return;
        }
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'table-action'; button.textContent = 'Exporter CSV pour l’expert-comptable';
        button.onclick = () => {
            try {
                const file = buildExport(type, data, currency, selection);
                const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8' }));
                try {
                    const link = document.createElement('a'); link.href = url; link.download = file.filename; link.click();
                } finally { URL.revokeObjectURL(url); }
            } catch (error) { form.querySelector('.error').textContent = `Export impossible : ${error.message}`; }
        };
        output.prepend(button);
    }

    async function render(root, api, esc, currency) {
        root.innerHTML = '<section class="panel"><h3>État des résultats · expérimental</h3><p>Chargement…</p></section>';
        let book, entries;
        try {
            book = await api('/api/accounting/book');
            if (book) entries = await api('/api/accounting/entries');
        } catch (error) {
            if (current()) root.innerHTML = `<section class="panel"><h3>État des résultats · expérimental</h3><p class="error" role="alert">${esc(error.message)}</p><p>Cette fonctionnalité est désactivée par défaut et réservée aux essais isolés.</p></section>`;
            return;
        }
        if (!current()) return;
        const warning = '<p class="accounting-warning">Expérimental : réservée aux essais isolés. Les ventes et achats ne sont pas importés automatiquement, les périodes ne sont pas clôturables et l’exhaustivité n’est pas vérifiée. Ne pas utiliser pour des états financiers ou déclarations officielles.</p>';
        if (!book) {
            root.innerHTML = `<section class="panel"><h3>Créer un dossier comptable expérimental</h3>${warning}<p>Les comptes pourront être ajoutés après création, mais pas modifiés ni supprimés. Faites vérifier leur classification. Ce formulaire ne fournit pas de plan SYSCOHADA préconfiguré.</p><form data-book-form><label>Date d’ouverture<input type="date" name="openingDate" required></label><div data-accounts></div><button type="button" class="table-action" data-add-account>＋ Ajouter un compte</button><button class="btn" type="submit">Créer le dossier</button><p class="error" role="alert"></p></form></section>`;
            const form = root.querySelector('[data-book-form]'), container = form.querySelector('[data-accounts]');
            function addAccount() {
                if (container.children.length >= 500) { form.querySelector('.error').textContent = 'Maximum 500 comptes.'; return; }
                const row = document.createElement('fieldset');
                row.className = 'accounting-row';
                row.innerHTML = `<legend>Compte</legend><div class="accounting-grid"><label>Code<input name="code" maxlength="40" required></label><label>Libellé<input name="name" maxlength="190" required></label><label>Type<select name="type">${types}</select></label><label>Taxe<select name="tax"><option value="">Aucune</option><option value="payable">Collectée (passif)</option><option value="recoverable">Déductible (actif)</option></select></label></div><label class="inline-check"><input name="cash" type="checkbox">Compte de trésorerie (actif)</label><button type="button" class="table-action danger" data-remove>Retirer</button>`;
                row.querySelector('[data-remove]').onclick = () => row.remove();
                container.append(row);
            }
            addAccount();
            form.querySelector('[data-add-account]').onclick = addAccount;
            form.onsubmit = async event => {
                event.preventDefault();
                const error = form.querySelector('.error');
                const accounts = [...container.children].map(row => {
                    const code = row.querySelector('[name=code]').value.trim();
                    return { id: code, code, name: row.querySelector('[name=name]').value.trim(), type: row.querySelector('[name=type]').value, cash: row.querySelector('[name=cash]').checked, tax: row.querySelector('[name=tax]').value || null };
                });
                if (!accounts.length) { error.textContent = 'Ajoutez au moins un compte.'; return; }
                if (!confirm('Les comptes créés ne pourront pas être modifiés ni supprimés. Confirmer la création du dossier expérimental ?')) return;
                const submit = form.querySelector('[type=submit]'); submit.disabled = true; error.textContent = '';
                try {
                    await api('/api/accounting/book', { method: 'POST', body: JSON.stringify({ openingDate: form.elements.openingDate.value, accounts }) });
                    if (current()) await render(root, api, esc, currency);
                } catch (reason) { error.textContent = reason.message; }
                finally { submit.disabled = false; }
            };
            return;
        }
        const accountOptions = book.accounts.map(account => `<option value="${esc(account.id)}">${esc(account.code)} · ${esc(account.name)}</option>`).join('');
        const accountsById = new Map(book.accounts.map(account => [account.id, account]));
        const today = new Date();
        const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const defaultTo = todayText < book.openingDate ? book.openingDate : todayText;
        root.innerHTML = `<section class="panel"><h3>État des résultats · expérimental</h3>${warning}<p>Ouverture : ${esc(book.openingDate)}. Les comptes existants ne peuvent être ni modifiés ni supprimés.</p><details><summary>Voir et compléter le plan de comptes (${book.accounts.length})</summary><ul>${book.accounts.map(account => `<li>${esc(account.code)} · ${esc(account.name)} — ${esc(typeLabels[account.type])}${account.cash ? ' · trésorerie' : ''}${account.tax ? ` · taxe ${account.tax === 'payable' ? 'collectée' : 'déductible'}` : ''}</li>`).join('')}</ul><form data-add-account-form><h4>Ajouter un compte</h4><div class="accounting-grid"><label>Code<input name="code" maxlength="40" required></label><label>Libellé<input name="name" maxlength="190" required></label><label>Type<select name="type">${types}</select></label><label>Taxe<select name="tax"><option value="">Aucune</option><option value="payable">Collectée (passif)</option><option value="recoverable">Déductible (actif)</option></select></label></div><label class="inline-check"><input name="cash" type="checkbox">Compte de trésorerie (actif)</label><button class="btn" type="submit">Ajouter le compte</button><p class="error" role="alert"></p></form></details><form data-report-form><div class="accounting-grid"><label>Du<input type="date" name="from" min="${esc(book.openingDate)}" value="${esc(book.openingDate)}" required></label><label>Au<input type="date" name="to" min="${esc(book.openingDate)}" value="${esc(defaultTo)}" required></label></div><button class="btn">Calculer</button><p class="error" role="alert"></p></form><div data-report aria-live="polite"></div></section>
            <section class="panel"><h3>Écritures manuelles</h3><p>Les brouillons sont exclus du rapport. Vérifiez les lignes avant validation : une écriture validée est immuable et ne peut être corrigée que par une nouvelle écriture.</p><form data-entry-form><h4 data-form-title>Nouveau brouillon</h4><div class="accounting-grid"><label>Date<input type="date" name="date" min="${esc(book.openingDate)}" value="${esc(defaultTo)}" required></label><label>Type<select name="kind"><option value="normal">Écriture courante</option><option value="opening">Solde d’ouverture</option></select></label></div><label>Libellé<input name="description" maxlength="500" required></label><div data-lines></div><button type="button" class="table-action" data-add-line>＋ Ajouter une ligne</button><button class="btn" type="submit">Enregistrer le brouillon</button><button type="button" class="table-action" data-cancel-edit hidden>Annuler la modification</button><p class="error" role="alert"></p></form><h4>Dernières écritures (500 maximum)</h4><div data-entries></div></section>`;
        const accountForm = root.querySelector('[data-add-account-form]');
        accountForm.onsubmit = async event => {
            event.preventDefault();
            if (!confirm('Ce compte ne pourra ni être modifié ni supprimé. L’actualisation effacera toute saisie non enregistrée sur cette page. Continuer ?')) return;
            const error = accountForm.querySelector('.error'), submit = accountForm.querySelector('button');
            const code = accountForm.elements.code.value.trim();
            const account = { id: code, code, name: accountForm.elements.name.value.trim(), type: accountForm.elements.type.value, cash: accountForm.elements.cash.checked, tax: accountForm.elements.tax.value || null };
            submit.disabled = true; error.textContent = '';
            try {
                await api('/api/accounting/accounts', { method: 'POST', body: JSON.stringify({ account }) });
                if (current()) await render(root, api, esc, currency);
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
        const form = root.querySelector('[data-entry-form]'), lineContainer = form.querySelector('[data-lines]');
        let editing = null;
        function addLine(line = null) {
            if (lineContainer.children.length >= 100) { form.querySelector('.error').textContent = 'Maximum 100 lignes.'; return; }
            const row = document.createElement('fieldset'); row.className = 'accounting-row';
            row.innerHTML = `<legend>Ligne</legend><div class="accounting-grid"><label>Compte<select name="accountId" required>${accountOptions}</select></label><label>Débit<input name="debit" type="number" min="0" max="9999999999999999.99" step="0.01" value="0" required></label><label>Crédit<input name="credit" type="number" min="0" max="9999999999999999.99" step="0.01" value="0" required></label><label data-flow-label>Flux de trésorerie<select name="flow"><option value="">Non applicable</option>${flows}</select></label></div><button type="button" class="table-action danger" data-remove>Retirer</button>`;
            if (line) {
                row.querySelector('[name=accountId]').value = line.accountId || '';
                row.querySelector('[name=debit]').value = line.debit ?? '';
                row.querySelector('[name=credit]').value = line.credit ?? '';
                row.querySelector('[name=flow]').value = line.flow || '';
            }
            const updateFlow = () => {
                const needsFlow = form.elements.kind.value === 'normal' && accountsById.get(row.querySelector('[name=accountId]').value)?.cash;
                const select = row.querySelector('[name=flow]');
                row.querySelector('[data-flow-label]').hidden = !needsFlow;
                select.required = Boolean(needsFlow);
                if (!needsFlow) select.value = '';
            };
            row.querySelector('[name=accountId]').onchange = updateFlow;
            row.querySelector('[data-remove]').onclick = () => row.remove();
            row.updateFlow = updateFlow; lineContainer.append(row); updateFlow();
        }
        function resetForm() {
            editing = null; form.reset(); form.elements.date.value = defaultTo;
            lineContainer.replaceChildren(); addLine(); addLine();
            form.querySelector('[data-form-title]').textContent = 'Nouveau brouillon';
            form.querySelector('[data-cancel-edit]').hidden = true; form.querySelector('.error').textContent = '';
        }
        form.elements.kind.onchange = () => [...lineContainer.children].forEach(row => row.updateFlow());
        form.querySelector('[data-add-line]').onclick = () => addLine();
        form.querySelector('[data-cancel-edit]').onclick = resetForm;
        resetForm();
        const entriesRoot = root.querySelector('[data-entries]');
        entriesRoot.innerHTML = entries.length ? entries.map(entry => `<details class="accounting-entry"><summary>${esc(entry.date)} · ${esc(entry.description)} — ${entry.status === 'posted' ? 'Validée' : 'Brouillon'}</summary><p>${entry.kind === 'opening' ? 'Solde d’ouverture' : 'Écriture courante'}</p><ul>${entry.lines.map(line => line && typeof line === 'object' ? `<li>${esc(accountsById.get(line.accountId)?.code || line.accountId)} · Débit ${esc(line.debit)} · Crédit ${esc(line.credit)}${line.flow ? ` · ${esc(flowLabels[line.flow] || line.flow)}` : ''}</li>` : '<li>Ligne invalide : modifiez le brouillon.</li>').join('')}</ul>${entry.status === 'draft' ? `<button type="button" class="table-action" data-edit="${esc(entry.id)}">Modifier</button><button type="button" class="table-action" data-post="${esc(entry.id)}">Valider</button>` : ''}</details>`).join('') : '<p>Aucune écriture enregistrée.</p>';
        entriesRoot.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => {
            const entry = entries.find(item => item.id === button.dataset.edit);
            editing = entry.id; form.elements.date.value = entry.date; form.elements.kind.value = entry.kind; form.elements.description.value = entry.description;
            lineContainer.replaceChildren(); entry.lines.forEach(line => addLine(line && typeof line === 'object' ? line : {}));
            form.querySelector('[data-form-title]').textContent = `Modifier le brouillon ${entry.id}`;
            form.querySelector('[data-cancel-edit]').hidden = false; form.querySelector('.error').textContent = ''; form.scrollIntoView({ block: 'start' });
        });
        entriesRoot.querySelectorAll('[data-post]').forEach(button => button.onclick = async () => {
            if (!confirm('Valider définitivement cette écriture ? Vérifiez ses comptes, montants et justificatifs.')) return;
            button.disabled = true;
            try { await api(`/api/accounting/entries/${encodeURIComponent(button.dataset.post)}/post`, { method: 'POST' }); if (current()) await render(root, api, esc, currency); }
            catch (reason) { form.querySelector('.error').textContent = reason.message; form.querySelector('.error').scrollIntoView({ block: 'center' }); }
            finally { button.disabled = false; }
        });
        form.onsubmit = async event => {
            event.preventDefault(); const error = form.querySelector('.error');
            const lines = [...lineContainer.children].map(row => ({ accountId: row.querySelector('[name=accountId]').value, debit: row.querySelector('[name=debit]').value, credit: row.querySelector('[name=credit]').value, flow: row.querySelector('[name=flow]').value || null }));
            if (lines.length < 2) { error.textContent = 'Ajoutez au moins deux lignes.'; return; }
            const submit = form.querySelector('[type=submit]'); submit.disabled = true; error.textContent = '';
            try {
                await api(editing ? `/api/accounting/entries/${encodeURIComponent(editing)}` : '/api/accounting/entries', { method: editing ? 'PUT' : 'POST', body: JSON.stringify({ date: form.elements.date.value, kind: form.elements.kind.value, description: form.elements.description.value, lines }) });
                if (current()) await render(root, api, esc, currency);
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
        const reportForm = root.querySelector('[data-report-form]');
        reportForm.onsubmit = async event => {
            event.preventDefault(); const error = reportForm.querySelector('.error'), output = root.querySelector('[data-report]');
            const submit = reportForm.querySelector('button'); submit.disabled = true; error.textContent = ''; output.replaceChildren();
            try {
                const params = new URLSearchParams({ from: reportForm.elements.from.value, to: reportForm.elements.to.value });
                const data = await api(`/api/accounting/income-statement?${params}`);
                if (!current()) return;
                output.innerHTML = `<p class="accounting-warning">${esc(data.warning)}</p><div class="tablewrap"><table><thead><tr><th>Compte</th><th>Type</th><th>Débit</th><th>Crédit</th><th>Montant net</th></tr></thead><tbody>${data.accounts.map(account => `<tr><td>${esc(account.code)} · ${esc(account.name)}</td><td>${esc(typeLabels[account.type])}</td><td>${esc(account.debit)}</td><td>${esc(account.credit)}</td><td>${esc(account.net)}</td></tr>`).join('')}</tbody></table></div><p>Produits : <b>${esc(data.totals.income)}</b> · Charges : <b>${esc(data.totals.expense)}</b> · Résultat : <b>${esc(data.totals.net)}</b> ${esc(currency)}</p>`;
                attachExport(output, 'income', data, currency, reportForm, '');
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
    }

    render.balance = async function (root, api, esc, currency) {
        const isCurrent = () => location.hash === '#accounting-balance';
        root.innerHTML = '<section class="panel"><h3>Bilan comptable · expérimental</h3><p>Chargement…</p></section>';
        let book;
        try { book = await api('/api/accounting/book'); }
        catch (error) {
            if (isCurrent()) root.innerHTML = `<section class="panel"><h3>Bilan comptable · expérimental</h3><p class="error" role="alert">${esc(error.message)}</p><p>Cette fonctionnalité est désactivée par défaut et réservée aux essais isolés.</p></section>`;
            return;
        }
        if (!isCurrent()) return;
        if (!book) {
            root.innerHTML = '<section class="panel"><h3>Bilan comptable · expérimental</h3><p>Créez d’abord un dossier comptable depuis l’état des résultats, puis saisissez les soldes d’ouverture et les écritures nécessaires.</p><a href="#accounting-results" data-accounting-results>Ouvrir l’état des résultats</a></section>';
            root.querySelector('[data-accounting-results]').onclick = event => {
                event.preventDefault();
                document.querySelector('[data-page="accounting-results"]').click();
            };
            return;
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const date = today < book.openingDate ? book.openingDate : today;
        root.innerHTML = `<section class="panel"><h3>Bilan comptable · expérimental</h3><p class="accounting-warning">Réservé aux essais isolés. Les soldes d’ouverture et l’exhaustivité des écritures ne sont pas vérifiés ; les ventes et achats ne sont pas importés automatiquement. Ce bilan n’est pas un état financier officiel.</p><p>Comptes et écritures validées depuis le ${esc(book.openingDate)}. Un solde négatif indique un solde opposé au sens habituel du type de compte. Le résultat cumulé provient des comptes de produits et charges non clôturés.</p><form data-balance-form><label>Date du bilan<input type="date" name="date" min="${esc(book.openingDate)}" value="${esc(date)}" required></label><button class="btn">Calculer</button><p class="error" role="alert"></p></form><div data-balance-report aria-live="polite"></div></section>`;
        const form = root.querySelector('[data-balance-form]');
        form.onsubmit = async event => {
            event.preventDefault();
            const error = form.querySelector('.error'), output = root.querySelector('[data-balance-report]'), submit = form.querySelector('button');
            submit.disabled = true; error.textContent = ''; output.replaceChildren();
            try {
                const data = await api(`/api/accounting/balance-sheet?${new URLSearchParams({ date: form.elements.date.value })}`);
                if (!isCurrent()) return;
                const rows = data.accounts.map(account => `<tr><td data-label="Compte">${esc(account.code)} · ${esc(account.name)}</td><td data-label="Catégorie">${esc(typeLabels[account.type])}</td><td data-label="Solde net">${esc(account.net)}</td></tr>`).join('');
                output.innerHTML = `<p class="accounting-warning">${esc(data.warning)}</p><h4>Bilan au ${esc(data.date)}</h4><div class="tablewrap"><table><thead><tr><th>Compte</th><th>Catégorie</th><th>Solde net (${esc(currency)})</th></tr></thead><tbody>${rows || '<tr><td colspan="3">Aucun compte de bilan.</td></tr>'}</tbody></table></div><p>Actif : <b>${esc(data.totals.asset)}</b> · Passif : <b>${esc(data.totals.liability)}</b> · Capitaux propres : <b>${esc(data.totals.equity)}</b> · Résultat cumulé non clôturé : <b>${esc(data.totals.accumulatedResult)}</b> ${esc(currency)}</p>`;
                attachExport(output, 'balance', data, currency, form, '');
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
    };
    render.journal = async function (root, api, esc, currency) {
        const isCurrent = () => location.hash === '#accounting-journal';
        root.innerHTML = '<section class="panel"><h3>Journal comptable · expérimental</h3><p>Chargement…</p></section>';
        let book;
        try { book = await api('/api/accounting/book'); }
        catch (error) {
            if (isCurrent()) root.innerHTML = `<section class="panel"><h3>Journal comptable · expérimental</h3><p class="error" role="alert">${esc(error.message)}</p></section>`;
            return;
        }
        if (!isCurrent()) return;
        if (!book) {
            root.innerHTML = '<section class="panel"><h3>Journal comptable · expérimental</h3><p>Créez d’abord un dossier comptable depuis l’état des résultats, puis saisissez et validez les écritures nécessaires.</p><a href="#accounting-results" data-accounting-results>Ouvrir l’état des résultats</a></section>';
            root.querySelector('[data-accounting-results]').onclick = event => {
                event.preventDefault();
                document.querySelector('[data-page="accounting-results"]').click();
            };
            return;
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const to = today < book.openingDate ? book.openingDate : today;
        root.innerHTML = `<section class="panel"><h3>Journal comptable · expérimental</h3><p class="accounting-warning">Réservé aux essais isolés : seules les écritures validées sont affichées. Les ventes et achats ne sont pas importés automatiquement, les justificatifs et l’exhaustivité ne sont pas vérifiés et les périodes ne peuvent pas être clôturées. Ce journal n’est pas officiel.</p><p>Les écritures manuelles et les brouillons sont gérés depuis l’état des résultats. Date d’ouverture : ${esc(book.openingDate)}.</p><form data-journal-form><div class="accounting-grid"><label>Du<input type="date" name="from" min="${esc(book.openingDate)}" value="${esc(book.openingDate)}" required></label><label>Au<input type="date" name="to" min="${esc(book.openingDate)}" value="${esc(to)}" required></label></div><button class="btn">Afficher le journal</button><p class="error" role="alert"></p></form><div data-journal-report aria-live="polite"></div></section>`;
        const form = root.querySelector('[data-journal-form]');
        form.onsubmit = async event => {
            event.preventDefault();
            const error = form.querySelector('.error'), output = root.querySelector('[data-journal-report]'), submit = form.querySelector('button');
            submit.disabled = true; error.textContent = ''; output.replaceChildren();
            try {
                const params = new URLSearchParams({ from: form.elements.from.value, to: form.elements.to.value });
                const data = await api(`/api/accounting/journal?${params}`);
                if (!isCurrent()) return;
                const items = data.entries.map(entry => `<section class="accounting-entry"><h4>${esc(entry.date)} · Écriture ${esc(entry.id)} · ${entry.kind === 'opening' ? 'Ouverture' : 'Courante'}</h4><p>${esc(entry.description)}</p><div class="tablewrap"><table><thead><tr><th>Compte</th><th>Débit (${esc(currency)})</th><th>Crédit (${esc(currency)})</th></tr></thead><tbody>${entry.lines.map(line => `<tr><td data-label="Compte">${esc(line.code)} · ${esc(line.name)}</td><td data-label="Débit">${esc(line.debit)}</td><td data-label="Crédit">${esc(line.credit)}</td></tr>`).join('')}</tbody></table></div></section>`).join('');
                output.innerHTML = `<p class="accounting-warning">${esc(data.warning)}</p><h4>Du ${esc(data.from)} au ${esc(data.to)}</h4>${items || '<p>Aucune écriture validée pour cette période.</p>'}<p>Total débit : <b>${esc(data.totals.debit)}</b> · Total crédit : <b>${esc(data.totals.credit)}</b> ${esc(currency)}</p>`;
                attachExport(output, 'journal', data, currency, form, '');
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
    };
    render.ledger = async function (root, api, esc, currency) {
        const isCurrent = () => location.hash === '#accounting-ledger';
        root.innerHTML = '<section class="panel"><h3>Grand livre général · expérimental</h3><p>Chargement…</p></section>';
        let book;
        try { book = await api('/api/accounting/book'); }
        catch (error) {
            if (isCurrent()) root.innerHTML = `<section class="panel"><h3>Grand livre général · expérimental</h3><p class="error" role="alert">${esc(error.message)}</p></section>`;
            return;
        }
        if (!isCurrent()) return;
        if (!book) {
            root.innerHTML = '<section class="panel"><h3>Grand livre général · expérimental</h3><p>Créez d’abord un dossier comptable depuis l’état des résultats, puis saisissez et validez les écritures nécessaires.</p><a href="#accounting-results" data-accounting-results>Ouvrir l’état des résultats</a></section>';
            root.querySelector('[data-accounting-results]').onclick = event => {
                event.preventDefault();
                document.querySelector('[data-page="accounting-results"]').click();
            };
            return;
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const to = today < book.openingDate ? book.openingDate : today;
        const options = book.accounts.map(account => `<option value="${esc(account.id)}">${esc(account.code)} · ${esc(account.name)}</option>`).join('');
        root.innerHTML = `<section class="panel"><h3>Grand livre général · expérimental</h3><p class="accounting-warning">Réservé aux essais isolés : seules les écritures validées sont affichées. Les ventes et achats ne sont pas importés automatiquement, les justificatifs et l’exhaustivité ne sont pas vérifiés et les périodes ne peuvent pas être clôturées. Ce grand livre n’est pas officiel.</p><p>Les soldes indiquent le débit moins le crédit : un montant négatif est créditeur. Le solde initial est calculé avant le premier jour choisi ; les écritures d’ouverture à cette date apparaissent dans les mouvements.</p><form data-ledger-form><div class="accounting-grid"><label>Du<input type="date" name="from" min="${esc(book.openingDate)}" value="${esc(book.openingDate)}" required></label><label>Au<input type="date" name="to" min="${esc(book.openingDate)}" value="${esc(to)}" required></label><label>Compte<select name="accountId"><option value="">Tous les comptes</option>${options}</select></label></div><button class="btn">Afficher le grand livre</button><p class="error" role="alert"></p></form><div data-ledger-report aria-live="polite"></div></section>`;
        const form = root.querySelector('[data-ledger-form]');
        form.onsubmit = async event => {
            event.preventDefault();
            const error = form.querySelector('.error'), output = root.querySelector('[data-ledger-report]'), submit = form.querySelector('button');
            submit.disabled = true; error.textContent = ''; output.replaceChildren();
            try {
                const params = new URLSearchParams({ from: form.elements.from.value, to: form.elements.to.value });
                if (form.elements.accountId.value) params.set('accountId', form.elements.accountId.value);
                const data = await api(`/api/accounting/ledger?${params}`);
                if (!isCurrent()) return;
                const items = data.accounts.map(account => {
                    const rows = account.movements.map(movement => `<tr><td data-label="Date">${esc(movement.date)}</td><td data-label="Écriture">${esc(movement.entryId)} · ${movement.kind === 'opening' ? 'Ouverture' : 'Courante'} · ${esc(movement.description)}</td><td data-label="Débit">${esc(movement.debit)}</td><td data-label="Crédit">${esc(movement.credit)}</td><td data-label="Solde">${esc(movement.balance)}</td></tr>`).join('');
                    return `<section class="accounting-entry"><h4>${esc(account.code)} · ${esc(account.name)}</h4><p>Solde initial : <b>${esc(account.openingBalance)}</b> ${esc(currency)}</p><div class="tablewrap"><table><thead><tr><th>Date</th><th>Écriture</th><th>Débit</th><th>Crédit</th><th>Solde</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Aucun mouvement sur cette période.</td></tr>'}</tbody></table></div><p>Total débit : <b>${esc(account.debit)}</b> · Total crédit : <b>${esc(account.credit)}</b> · Solde final : <b>${esc(account.closingBalance)}</b> ${esc(currency)}</p></section>`;
                }).join('');
                output.innerHTML = `<p class="accounting-warning">${esc(data.warning)}</p><h4>Du ${esc(data.from)} au ${esc(data.to)}</h4>${items || '<p>Aucun compte à afficher.</p>'}`;
                attachExport(output, 'ledger', data, currency, form, params.get('accountId') || '');
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
    };
    render.cashflow = async function (root, api, esc, currency) {
        const isCurrent = () => location.hash === '#accounting-cashflow';
        root.innerHTML = '<section class="panel"><h3>Flux de trésorerie · expérimental</h3><p>Chargement…</p></section>';
        let book;
        try { book = await api('/api/accounting/book'); }
        catch (error) {
            if (isCurrent()) root.innerHTML = `<section class="panel"><h3>Flux de trésorerie · expérimental</h3><p class="error" role="alert">${esc(error.message)}</p></section>`;
            return;
        }
        if (!isCurrent()) return;
        if (!book) {
            root.innerHTML = '<section class="panel"><h3>Flux de trésorerie · expérimental</h3><p>Créez d’abord un dossier comptable depuis l’état des résultats, puis saisissez et validez les écritures nécessaires.</p><a href="#accounting-results" data-accounting-results>Ouvrir l’état des résultats</a></section>';
            root.querySelector('[data-accounting-results]').onclick = event => {
                event.preventDefault();
                document.querySelector('[data-page="accounting-results"]').click();
            };
            return;
        }
        if (!book.accounts.some(account => account.cash)) {
            root.innerHTML = '<section class="panel"><h3>Flux de trésorerie · expérimental</h3><p class="error" role="alert">Aucun compte de trésorerie n’est configuré. Ajoutez-en un depuis l’état des résultats après vérification.</p><a href="#accounting-results" data-accounting-results>Ouvrir l’état des résultats</a></section>';
            root.querySelector('[data-accounting-results]').onclick = event => {
                event.preventDefault();
                document.querySelector('[data-page="accounting-results"]').click();
            };
            return;
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const to = today < book.openingDate ? book.openingDate : today;
        root.innerHTML = `<section class="panel"><h3>Flux de trésorerie · expérimental</h3><p class="accounting-warning">Réservé aux essais isolés : ce rapport n’est pas officiel. Les ventes et achats ne sont pas importés ; l’exhaustivité et les soldes d’ouverture ne sont pas vérifiés. Les catégories sont saisies manuellement et les virements internes ne sont pas éliminés.</p><p>La trésorerie initiale inclut les écritures d’ouverture du premier jour sélectionné ; seules les écritures courantes validées alimentent les flux de la période. Les montants négatifs représentent une sortie nette ou un solde créditeur.</p><form data-cashflow-form><div class="accounting-grid"><label>Du<input type="date" name="from" min="${esc(book.openingDate)}" value="${esc(book.openingDate)}" required></label><label>Au<input type="date" name="to" min="${esc(book.openingDate)}" value="${esc(to)}" required></label></div><button class="btn">Afficher les flux</button><p class="error" role="alert"></p></form><div data-cashflow-report aria-live="polite"></div></section>`;
        const form = root.querySelector('[data-cashflow-form]');
        form.onsubmit = async event => {
            event.preventDefault();
            const error = form.querySelector('.error'), output = root.querySelector('[data-cashflow-report]'), submit = form.querySelector('button');
            submit.disabled = true; error.textContent = ''; output.replaceChildren();
            try {
                const params = new URLSearchParams({ from: form.elements.from.value, to: form.elements.to.value });
                const data = await api(`/api/accounting/cash-flow?${params}`);
                if (!isCurrent()) return;
                const sections = Object.entries(flowLabels).map(([key, label]) => {
                    const category = data.categories[key];
                    const rows = category.movements.map(movement => `<tr><td data-label="Date">${esc(movement.date)}</td><td data-label="Écriture">${esc(movement.entryId)} · ${esc(movement.description)}${movement.possibleInternalTransfer ? ' · Virement interne possible à vérifier' : ''}</td><td data-label="Compte">${esc(movement.code)} · ${esc(movement.name)}</td><td data-label="Entrée">${esc(movement.receipt)}</td><td data-label="Sortie">${esc(movement.payment)}</td></tr>`).join('');
                    return `<section class="accounting-entry"><h4>${esc(label)}</h4><p>Entrées brutes : <b>${esc(category.receipts)}</b> · Sorties brutes : <b>${esc(category.payments)}</b> · Flux net : <b>${esc(category.net)}</b> ${esc(currency)}</p><div class="tablewrap"><table><thead><tr><th>Date</th><th>Écriture</th><th>Compte</th><th>Entrée</th><th>Sortie</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Aucun mouvement sur cette période.</td></tr>'}</tbody></table></div></section>`;
                }).join('');
                output.innerHTML = `<p class="accounting-warning">${esc(data.warning)}</p><h4>Du ${esc(data.from)} au ${esc(data.to)}</h4><p>Trésorerie initiale : <b>${esc(data.totals.opening)}</b> · Trésorerie finale : <b>${esc(data.totals.closing)}</b> ${esc(currency)}</p>${sections}`;
                attachExport(output, 'cashflow', data, currency, form, '');
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
    };
    render.tax = async function (root, api, esc, currency) {
        const isCurrent = () => location.hash === '#accounting-tax';
        root.innerHTML = '<section class="panel"><h3>Rapport de taxes · expérimental</h3><p>Chargement…</p></section>';
        let book;
        try { book = await api('/api/accounting/book'); }
        catch (error) {
            if (isCurrent()) root.innerHTML = `<section class="panel"><h3>Rapport de taxes · expérimental</h3><p class="error" role="alert">${esc(error.message)}</p></section>`;
            return;
        }
        if (!isCurrent()) return;
        if (!book) {
            root.innerHTML = '<section class="panel"><h3>Rapport de taxes · expérimental</h3><p>Créez d’abord un dossier comptable depuis l’état des résultats, puis saisissez et validez les écritures nécessaires.</p><a href="#accounting-results" data-accounting-results>Ouvrir l’état des résultats</a></section>';
            root.querySelector('[data-accounting-results]').onclick = event => {
                event.preventDefault();
                document.querySelector('[data-page="accounting-results"]').click();
            };
            return;
        }
        if (!book.accounts.some(account => account.tax === 'payable' || account.tax === 'recoverable')) {
            root.innerHTML = '<section class="panel"><h3>Rapport de taxes · expérimental</h3><p class="error" role="alert">Aucun compte de taxe n’est configuré. Ajoutez-en un depuis l’état des résultats après vérification.</p><a href="#accounting-results" data-accounting-results>Ouvrir l’état des résultats</a></section>';
            root.querySelector('[data-accounting-results]').onclick = event => {
                event.preventDefault();
                document.querySelector('[data-page="accounting-results"]').click();
            };
            return;
        }
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const to = today < book.openingDate ? book.openingDate : today;
        root.innerHTML = `<section class="panel"><h3>Rapport de taxes · expérimental</h3><p class="accounting-warning">Réservé aux essais isolés : ce rapport ne constitue pas une déclaration fiscale et ne calcule aucun montant à payer. Les taux, bases et justificatifs ne sont pas vérifiés, les ventes et achats ne sont pas importés et l’exhaustivité n’est pas contrôlée.</p><p>Seules les écritures courantes validées sont incluses. Les mouvements peuvent comprendre des règlements, transferts ou corrections : ils ne représentent pas nécessairement les taxes collectées ou déductibles de la période. Pour les comptes classés collectés, la variation est crédit moins débit ; pour les comptes classés déductibles, débit moins crédit.</p><form data-tax-form><div class="accounting-grid"><label>Du<input type="date" name="from" min="${esc(book.openingDate)}" value="${esc(book.openingDate)}" required></label><label>Au<input type="date" name="to" min="${esc(book.openingDate)}" value="${esc(to)}" required></label></div><button class="btn">Afficher les mouvements</button><p class="error" role="alert"></p></form><div data-tax-report aria-live="polite"></div></section>`;
        const form = root.querySelector('[data-tax-form]');
        form.onsubmit = async event => {
            event.preventDefault();
            const error = form.querySelector('.error'), output = root.querySelector('[data-tax-report]'), submit = form.querySelector('button');
            submit.disabled = true; error.textContent = ''; output.replaceChildren();
            try {
                const params = new URLSearchParams({ from: form.elements.from.value, to: form.elements.to.value });
                const data = await api(`/api/accounting/tax?${params}`);
                if (!isCurrent()) return;
                const groups = [['payable', 'Comptes classés taxe collectée'], ['recoverable', 'Comptes classés taxe déductible']].map(([category, label]) => {
                    const accounts = data.accounts.filter(account => account.category === category);
                    const items = accounts.map(account => {
                        const rows = account.movements.map(movement => `<tr><td data-label="Date">${esc(movement.date)}</td><td data-label="Écriture">${esc(movement.entryId)} · ${esc(movement.description)}</td><td data-label="Débit">${esc(movement.debit)}</td><td data-label="Crédit">${esc(movement.credit)}</td></tr>`).join('');
                        return `<section class="accounting-entry"><h5>${esc(account.code)} · ${esc(account.name)}</h5><p>Débit : <b>${esc(account.debit)}</b> · Crédit : <b>${esc(account.credit)}</b> · Variation nette : <b>${esc(account.netMovement)}</b> ${esc(currency)}</p><div class="tablewrap"><table><thead><tr><th>Date</th><th>Écriture</th><th>Débit</th><th>Crédit</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Aucun mouvement sur cette période.</td></tr>'}</tbody></table></div></section>`;
                    }).join('');
                    return `<section><h4>${esc(label)}</h4>${items || '<p class="accounting-warning">Aucun compte configuré pour cette catégorie : les données correspondantes sont indisponibles, pas nécessairement nulles.</p>'}</section>`;
                }).join('');
                output.innerHTML = `<p class="accounting-warning">${esc(data.warning)}</p><h4>Du ${esc(data.from)} au ${esc(data.to)}</h4>${groups}`;
                attachExport(output, 'tax', data, currency, form, '');
            } catch (reason) { error.textContent = reason.message; }
            finally { submit.disabled = false; }
        };
    };
    render.review = async function (root, api, esc, currency, role) {
        const isCurrent = () => location.hash === '#accounting-review';
        root.innerHTML = '<section class="panel"><h3>Révision comptable · expérimental</h3><p>Chargement…</p></section>';
        try {
            const book = await api('/api/accounting/book');
            if (!isCurrent()) return;
            if (!book) {
                root.innerHTML = '<section class="panel"><h3>Révision comptable</h3><p>Créez d’abord le dossier comptable depuis l’état des résultats.</p></section>';
                return;
            }
            const versions = await api('/api/accounting/reviews');
            if (!isCurrent()) return;
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const to = today < book.openingDate ? book.openingDate : today;
            root.innerHTML = `<section class="panel"><h3>Révision comptable · expérimental</h3><p class="accounting-warning">Une version finale est une photographie validée dans l’application, non un état officiel, une clôture, une certification ou un dépôt. Seules les écritures comptables validées sont incluses ; les ventes et achats du portail ne sont pas importés automatiquement. La sauvegarde JSON ne contient pas ces versions.</p><p>Pour corriger : saisissez et validez des écritures d’ajustement, puis générez et examinez un nouveau préliminaire. Une modification ultérieure ne change pas une version figée.</p><form data-review-create><div class="accounting-grid"><label>Du<input type="date" name="from" min="${esc(book.openingDate)}" value="${esc(book.openingDate)}" required></label><label>Au<input type="date" name="to" min="${esc(book.openingDate)}" value="${esc(to)}" required></label></div><button class="btn">Figer un préliminaire</button><p class="error" role="alert"></p></form><h4>Versions récentes (100 maximum)</h4><div data-review-list>${versions.length ? versions.map(item => `<p><button class="table-action" type="button" data-review-id="${esc(item.id)}">${item.status === 'final' ? 'Final' : 'Préliminaire'} #${esc(item.id)} · ${esc(item.period_from)} au ${esc(item.period_to)}</button> · ${esc(item.full_name)}${item.has_final ? ' · finalisé' : ''}</p>`).join('') : '<p>Aucune version.</p>'}</div><div data-review-detail aria-live="polite"></div></section>`;
            const form = root.querySelector('[data-review-create]');
            form.onsubmit = async event => {
                event.preventDefault();
                const error = form.querySelector('.error'), submit = form.querySelector('button');
                submit.disabled = true; error.textContent = '';
                try {
                    await api('/api/accounting/reviews', { method: 'POST', body: JSON.stringify({ from: form.elements.from.value, to: form.elements.to.value }) });
                    if (isCurrent()) await render.review(root, api, esc, currency, role);
                } catch (reason) { error.textContent = reason.message; }
                finally { submit.disabled = false; }
            };
            const detail = root.querySelector('[data-review-detail]');
            root.querySelector('[data-review-list]').onclick = async event => {
                const button = event.target.closest('[data-review-id]');
                if (!button) return;
                detail.textContent = 'Chargement…';
                try {
                    const version = await api(`/api/accounting/reviews/${encodeURIComponent(button.dataset.reviewId)}`);
                    if (!isCurrent()) return;
                    const data = version.snapshot, labels = { income: 'État des résultats', balance: 'Bilan', journal: 'Journal', ledger: 'Grand livre', cashflow: 'Flux de trésorerie', tax: 'Taxes' };
                    detail.innerHTML = `<section class="accounting-entry"><h4>${version.status === 'final' ? 'Version finale' : 'Version préliminaire'} #${esc(version.id)}</h4><p>Empreinte SHA-256 : <code>${esc(version.hash)}</code> · Créée le ${esc(version.createdAt)} · Compte #${esc(version.createdBy)}${version.preliminaryId ? ` · Préliminaire #${esc(version.preliminaryId)}` : ''}</p><p class="accounting-warning">Version expérimentale non officielle. Les rapports reflètent uniquement les données figées à leur création.</p>${Object.entries(labels).map(([key, label]) => data.reports[key] ? `<p><button type="button" class="table-action" data-review-export="${key}">Exporter ${esc(label)} en CSV</button></p><details><summary>Examiner ${esc(label)}</summary><pre>${esc(JSON.stringify(data.reports[key], null, 2))}</pre></details>` : `<p>${esc(label)} : indisponible (aucun compte configuré).</p>`).join('')}<details><summary>Examiner le plan et les écritures figées</summary><pre>${esc(JSON.stringify({ book: data.book, entries: data.entries }, null, 2))}</pre></details>${role === 'ACCOUNTANT' && version.status === 'preliminary' ? '<button type="button" class="btn" data-review-finalize>Valider cette version comme finale</button>' : ''}<p class="error" role="alert"></p></section>`;
                    const error = detail.querySelector('.error');
                    detail.querySelectorAll('[data-review-export]').forEach(exportButton => {
                        exportButton.onclick = () => {
                            try {
                                const report = data.reports[exportButton.dataset.reviewExport];
                                const label = `${version.status === 'final' ? 'Final' : 'Préliminaire'} #${version.id} ; SHA-256 ${version.hash} ; ${report.warning}`;
                                const file = buildExport(exportButton.dataset.reviewExport, { ...report, warning: label }, data.currency);
                                const url = URL.createObjectURL(new Blob([file.content], { type: 'text/csv;charset=utf-8' }));
                                try {
                                    const link = document.createElement('a'); link.href = url; link.download = `${version.status}-${version.id}-${file.filename}`; link.click();
                                } finally { URL.revokeObjectURL(url); }
                            } catch (reason) { error.textContent = `Export impossible : ${reason.message}`; }
                        };
                    });
                    const finalize = detail.querySelector('[data-review-finalize]');
                    if (finalize) finalize.onclick = async () => {
                        if (!confirm('Confirmez-vous avoir examiné cette version et ses limites ? La version finale sera figée mais ne sera ni certifiée, ni déposée, ni automatiquement officielle.')) return;
                        finalize.disabled = true; error.textContent = '';
                        try {
                            await api(`/api/accounting/reviews/${encodeURIComponent(version.id)}/finalize`, { method: 'POST', body: JSON.stringify({ hash: version.hash, confirmed: true }) });
                            if (isCurrent()) await render.review(root, api, esc, currency, role);
                        } catch (reason) { error.textContent = reason.message; }
                        finally { finalize.disabled = false; }
                    };
                } catch (error) { detail.textContent = `Révision inaccessible : ${error.message}`; }
            };
        } catch (error) {
            if (isCurrent()) root.innerHTML = `<section class="panel"><h3>Révision comptable · expérimental</h3><p class="error" role="alert">${esc(error.message)}</p><p>La migration des révisions doit être prévisualisée puis appliquée après sauvegarde.</p></section>`;
        }
    };
    render.buildExport = buildExport;
    return render;
})();
