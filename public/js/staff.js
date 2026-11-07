(() => {
    const TOKEN_KEY = 'redams_portal_token';
    const $ = selector => document.querySelector(selector);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const state = { staff: null, permissions: {}, page: 'dashboard' };
    const money = (value, currency) => `${Number(value || 0).toLocaleString('fr-FR')} ${esc(currency || '')}`.trim();
    const date = value => (value ? new Date(value).toLocaleDateString('fr-FR') : '—');
    const dateTime = value => (value ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
    const day = value => (value ? String(value).slice(0, 10) : '');
    const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
    const bytes = value => { const units = ['o', 'Ko', 'Mo', 'Go']; let size = Number(value || 0), unit = 0; while (size >= 1024 && unit < 3) { size /= 1024; unit += 1; } return `${size.toLocaleString('fr-FR', { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`; };
    const labels = {
        active: ['Actif', 'ok'], suspended: ['Suspendu', 'bad'], closed: ['Fermé', 'bad'], trialing: ['Essai', 'warn'], past_due: ['Impayé', 'warn'], cancelled: ['Annulé', 'bad'],
        open: ['Ouvert', 'warn'], in_progress: ['En cours', ''], resolved: ['Résolu', 'ok'], rejected: ['Rejeté', 'bad'],
        draft: ['Brouillon', ''], sent: ['Envoyée', 'warn'], paid: ['Payée', 'ok'], pending: ['En attente', 'warn'], void: ['Annulée', 'bad'],
        low: ['Basse', ''], normal: ['Normale', ''], high: ['Haute', 'warn'], urgent: ['Urgente', 'bad'],
        billing: ['Facturation', ''], service: ['Service', ''], technical: ['Technique', ''], other: ['Autre', ''],
        revoked: ['Révoquée', 'bad'], expired: ['Expirée', 'warn'],
        assigned: ['Assignée', 'warn'], voluntary: ['Volontaire', 'ok'],
        PLATFORM_ADMIN: ['Administrateur', 'ok'], SUPPORT: ['Support', ''], BILLING: ['Facturation', ''], VIEWER: ['Lecture seule', '']
    };
    const tag = value => { const [text, kind] = labels[value] || [value, '']; return `<span class="sp-tag ${kind}">${esc(text)}</span>`; };

    function toast(message, error) {
        const element = $('#sp-toast'); element.textContent = message; element.classList.toggle('error', Boolean(error)); element.classList.add('show');
        clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 3200);
    }

    async function api(path, options = {}) {
        const token = sessionStorage.getItem(TOKEN_KEY);
        let response;
        try { response = await fetch(`/api/portal${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } }); }
        catch (error) { throw Error('Connexion au serveur impossible.'); }
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && token) { sessionStorage.removeItem(TOKEN_KEY); showLogin(); throw Error(data.error || 'Session expirée.'); }
        if (!response.ok) throw Error(data.error || 'La requête a échoué.');
        return data;
    }
    const send = (method, path, body) => api(path, { method, body: JSON.stringify(body || {}) });
    async function download(path, filename) {
        const token = sessionStorage.getItem(TOKEN_KEY);
        const response = await fetch(`/api/portal${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw Error(data.error || 'Le téléchargement a échoué.');
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // Désactive le bouton pendant l'opération et affiche les erreurs dans le formulaire.
    async function run(button, action, errorTarget) {
        if (button) { button.disabled = true; button.dataset.label = button.textContent; button.textContent = 'Traitement…'; }
        try { await action(); }
        catch (error) { if (errorTarget) errorTarget.textContent = error.message; else toast(error.message, true); }
        finally { if (button?.isConnected) { button.disabled = false; button.textContent = button.dataset.label; } }
    }

    function modal(title, html, narrow) {
        const overlay = document.createElement('div'); overlay.className = 'sp-overlay';
        overlay.innerHTML = `<div class="sp-modal${narrow ? ' narrow' : ''}" role="dialog" aria-modal="true"><button class="sp-close" type="button" aria-label="Fermer">×</button><h3>${esc(title)}</h3><div class="sp-modal-body">${html}</div></div>`;
        document.body.append(overlay);
        const close = () => overlay.remove();
        overlay.querySelector('.sp-close').onclick = close;
        overlay.addEventListener('mousedown', event => { if (event.target === overlay) close(); });
        return { overlay, body: overlay.querySelector('.sp-modal-body'), close };
    }

    function pager(container, state2, reload) {
        const from = state2.total ? state2.offset + 1 : 0, to = Math.min(state2.offset + state2.limit, state2.total);
        container.innerHTML = `<span>${from}–${to} sur ${state2.total}</span><button class="sp-btn secondary small" data-prev ${state2.offset ? '' : 'disabled'}>Précédent</button><button class="sp-btn secondary small" data-next ${to < state2.total ? '' : 'disabled'}>Suivant</button>`;
        container.querySelector('[data-prev]').onclick = () => { state2.offset = Math.max(0, state2.offset - state2.limit); reload(); };
        container.querySelector('[data-next]').onclick = () => { state2.offset += state2.limit; reload(); };
    }

    // Page liste générique : barre d'outils, tableau, pagination.
    function listPage(root, config) {
        const paging = { offset: 0, limit: 15, total: 0 }, filters = {};
        root.innerHTML = `<div class="sp-panel"><div class="sp-toolbar">${config.toolbar || ''}<span class="grow"></span>${config.action || ''}</div><div class="sp-table-wrap"><table><thead><tr>${config.columns.map(column => `<th>${esc(column)}</th>`).join('')}</tr></thead><tbody></tbody></table></div><div class="sp-pager"></div></div>`;
        const body = root.querySelector('tbody');
        async function load() {
            const params = new URLSearchParams({ limit: paging.limit, offset: paging.offset });
            root.querySelectorAll('[data-filter]').forEach(input => { if (input.value) params.set(input.dataset.filter, input.value); });
            try {
                const data = await api(`${config.path}?${params}`);
                paging.total = data.total ?? data.items.length;
                body.innerHTML = data.items.length ? data.items.map(config.row).join('') : `<tr><td colspan="${config.columns.length}" class="sp-muted">Aucun résultat.</td></tr>`;
                pager(root.querySelector('.sp-pager'), paging, load);
                config.items = data.items;
            } catch (error) { body.innerHTML = `<tr><td colspan="${config.columns.length}" class="sp-error">${esc(error.message)}</td></tr>`; }
        }
        let timer;
        root.querySelectorAll('[data-filter]').forEach(input => input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => { clearTimeout(timer); timer = setTimeout(() => { paging.offset = 0; load(); }, 250); }));
        body.addEventListener('click', event => { const row = event.target.closest('[data-id]'); if (row && !event.target.closest('button,a,select,input')) config.open?.(row.dataset.id, load); });
        config.bind?.(root, load);
        load();
        return load;
    }

    const pages = {
        async dashboard(root) {
            const d = await api('/overview');
            const card = (title, value, note) => `<div class="sp-card"><small>${esc(title)}</small><b>${esc(value)}</b><span>${esc(note || '')}</span></div>`;
            root.innerHTML = `<div class="sp-cards">${card('Clients', d.clients.total, `${d.clients.active} actifs · ${d.clients.suspended} suspendus`)}${card('Abonnements arrivant à échéance', d.expiring_soon, 'dans les 7 prochains jours')}${card('Tickets support', d.tickets.open + d.tickets.in_progress, `${d.tickets.unassigned} non assignés`)}${card('Réclamations', d.claims.open + d.claims.in_progress, `${d.claims.urgent} urgentes`)}${card('Factures en attente', d.invoices.pending, `${money(d.invoices.pending_amount)} · ${d.invoices.overdue} en retard`)}${card('Clés API actives', d.tokens, '')}</div>
            <div class="sp-panel"><h3>Abonnements par statut</h3><p>${Object.entries(d.subscriptions).map(([status, total]) => `${tag(status)} ${total}`).join(' &nbsp; ') || '<span class="sp-muted">Aucun abonnement.</span>'}</p></div>
            <div class="sp-panel"><h3>En service maintenant (${d.on_duty.length}/${d.staff_total})</h3>${d.on_duty.length ? d.on_duty.map(person => `<p>${esc(person.full_name)} ${tag(person.role)}</p>`).join('') : '<p class="sp-muted">Personne n’est planifié à cette heure.</p>'}</div>`;
        },

        clients(root) {
            listPage(root, {
                path: '/clients', columns: ['Établissement', 'Forfait', 'Abonnement', 'Échéance', 'Utilisateurs', 'Statut'],
                toolbar: '<input data-filter="q" placeholder="Rechercher un client…" aria-label="Rechercher"><select data-filter="status" aria-label="Statut"><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="suspended">Suspendus</option><option value="closed">Fermés</option></select>',
                row: c => `<tr class="clickable" data-id="${esc(c.id)}"><td><b>${esc(c.name)}</b><small>${esc(c.email || '')}</small></td><td>${esc(c.plan_name || '—')}</td><td>${c.subscription_status ? tag(c.subscription_status) : '—'}</td><td>${esc(c.current_period_end || '—')}</td><td>${esc(c.active_users)}${c.max_users ? ` / ${esc(c.max_users)}` : ''}</td><td>${tag(c.status)}</td></tr>`,
                open: (id, reload) => clientDetail(id, reload)
            });
        },

        async analytics(root) {
            root.innerHTML = '<div class="sp-toolbar"><input data-q placeholder="Rechercher un client…" aria-label="Rechercher"><select data-days aria-label="Période"><option value="7">7 derniers jours</option><option value="30" selected>30 derniers jours</option><option value="90">90 derniers jours</option></select><span class="grow"></span><button class="sp-btn secondary" data-refresh>Actualiser le stockage</button></div><div data-body><p class="sp-muted">Chargement…</p></div>';
            const body = root.querySelector('[data-body]'), daysSelect = root.querySelector('[data-days]'), search = root.querySelector('[data-q]');
            let data = null;
            const arrow = value => (value === null ? '<span class="sp-muted">—</span>' : `<span class="sp-trend ${value > 0 ? 'up' : value < 0 ? 'down' : ''}">${value > 0 ? '▲' : value < 0 ? '▼' : '='} ${Math.abs(value)} %</span>`);
            const draw = () => {
                const q = search.value.trim().toLowerCase(), items = data.items.filter(item => item.name.toLowerCase().includes(q));
                const card = (title, value, note) => `<div class="sp-card"><small>${esc(title)}</small><b>${esc(value)}</b><span>${esc(note || '')}</span></div>`;
                body.innerHTML = `<div class="sp-cards">${card('Requêtes', data.totals.requests.toLocaleString('fr-FR'), `${data.days} derniers jours`)}${card('Erreurs', data.totals.errors.toLocaleString('fr-FR'), 'réponses 4xx et 5xx')}${card('Données stockées', bytes(data.totals.storage_bytes), `${data.totals.records.toLocaleString('fr-FR')} enregistrements (estimation)`)}</div>
                <div class="sp-panel"><div class="sp-table-wrap"><table><thead><tr><th>Client</th><th>Requêtes</th><th>Erreurs</th><th>Dernière activité</th><th>Stockage</th><th>Produits</th><th>Ventes 30 j</th><th>Tendance</th></tr></thead><tbody>${items.map(i => `<tr class="clickable" data-id="${esc(i.id)}"><td><b>${esc(i.name)}</b> ${i.status === 'active' ? '' : tag(i.status)}</td><td>${i.requests.toLocaleString('fr-FR')}</td><td>${i.errors ? `${i.errors.toLocaleString('fr-FR')}${i.server_errors ? ` <small>(${i.server_errors} serveur)</small>` : ''}` : '0'}</td><td>${esc(dateTime(i.last_request_at))}</td><td>${bytes(i.storage_bytes)}<small>${i.records.toLocaleString('fr-FR')} enreg.</small></td><td>${i.products}</td><td>${money(i.sales_30d)}</td><td>${arrow(i.sales_trend)}</td></tr>`).join('') || '<tr><td colspan="8" class="sp-muted">Aucun client.</td></tr>'}</tbody></table></div></div>
                <p class="sp-muted">Le trafic compte les requêtes de l’application de chaque client depuis l’activation de la mesure. Le stockage est estimé à partir du nombre de lignes de chaque table.</p>`;
            };
            const load = async refresh => { data = await api(`/analytics/clients?days=${daysSelect.value}${refresh ? '&refresh=1' : ''}`); draw(); };
            daysSelect.onchange = () => run(null, () => load());
            search.oninput = () => data && draw();
            root.querySelector('[data-refresh]').onclick = event => run(event.currentTarget, () => load(true));
            body.addEventListener('click', event => { const row = event.target.closest('[data-id]'); if (row) analyticsDetail(row.dataset.id); });
            await load();
        },

        invoices(root) {
            listPage(root, {
                path: '/invoices', columns: ['Facture', 'Client', 'Période', 'Montant', 'Échéance', 'Statut'],
                toolbar: '<select data-filter="status" aria-label="Statut"><option value="">Tous les statuts</option><option value="draft">Brouillons</option><option value="sent">Envoyées</option><option value="paid">Payées</option><option value="void">Annulées</option></select>',
                action: state.permissions.invoices ? '<button class="sp-btn" data-new>＋ Nouvelle facture</button>' : '',
                row: i => `<tr data-id="${esc(i.id)}"><td><b>${esc(i.invoice_number)}</b></td><td>${esc(i.organization_name)}</td><td>${date(i.period_start)} → ${date(i.period_end)}</td><td>${money(i.total_amount, i.currency)}${Number(i.discount_amount) ? `<small>remise ${money(i.discount_amount)}</small>` : ''}</td><td>${date(i.due_date)}</td><td>${tag(i.status)}${state.permissions.invoices && !['paid', 'void'].includes(i.status) ? ` <select data-invoice="${esc(i.id)}" aria-label="Changer le statut"><option value="">Changer…</option>${['draft', 'sent', 'paid', 'void'].filter(s => s !== i.status).map(s => `<option value="${s}">${esc(labels[s][0])}</option>`).join('')}</select>` : ''}</td></tr>`,
                bind(rootEl, load) {
                    rootEl.querySelector('[data-new]')?.addEventListener('click', () => invoiceForm(load));
                    rootEl.addEventListener('change', async event => { const select = event.target.closest('[data-invoice]'); if (!select || !select.value) return; try { await send('PATCH', `/invoices/${select.dataset.invoice}/status`, { status: select.value }); toast('Statut mis à jour.'); load(); } catch (error) { toast(error.message, true); load(); } });
                }
            });
        },

        claims(root) {
            listPage(root, {
                path: '/claims', columns: ['Référence', 'Client', 'Objet', 'Priorité', 'Assigné à', 'Statut'],
                toolbar: '<input data-filter="q" placeholder="Rechercher…" aria-label="Rechercher"><select data-filter="status" aria-label="Statut"><option value="">Tous les statuts</option><option value="open">Ouvertes</option><option value="in_progress">En cours</option><option value="resolved">Résolues</option><option value="rejected">Rejetées</option></select><select data-filter="mine" aria-label="Portée"><option value="">Toutes</option><option value="1">Mes réclamations</option></select>',
                action: state.permissions.claims ? '<button class="sp-btn" data-new>＋ Nouvelle réclamation</button>' : '',
                row: c => `<tr class="clickable" data-id="${esc(c.id)}"><td><b>${esc(c.reference)}</b><small>${esc(dateTime(c.created_at))}</small></td><td>${esc(c.organization_name)}</td><td>${esc(c.subject)}<small>${esc(labels[c.category]?.[0] || '')}</small></td><td>${tag(c.priority)}</td><td>${esc(c.assigned_name || '—')}</td><td>${tag(c.status)}</td></tr>`,
                open: (id, reload) => claimDetail(id, reload),
                bind: (rootEl, load) => rootEl.querySelector('[data-new]')?.addEventListener('click', () => claimForm(load))
            });
        },

        support(root) {
            listPage(root, {
                path: '/support', columns: ['#', 'Client', 'Objet', 'Demandeur', 'Pris en charge par', 'Statut'],
                toolbar: '<input data-filter="q" placeholder="Rechercher…" aria-label="Rechercher"><select data-filter="status" aria-label="Statut"><option value="">Tous les statuts</option><option value="open">Ouverts</option><option value="in_progress">En cours</option><option value="closed">Clôturés</option></select><select data-filter="mine" aria-label="Portée"><option value="">Tous</option><option value="1">Mes tickets</option></select>',
                row: t => `<tr class="clickable" data-id="${esc(t.id)}"><td>${esc(t.id)}</td><td>${esc(t.organization_name)}</td><td>${esc(t.subject)}${t.is_chat ? ' <span class="sp-tag">Chat</span>' : ''}<small>${esc(dateTime(t.created_at))} · ${esc(t.reply_count)} message(s)</small></td><td>${esc(t.requester_name)}</td><td>${esc(t.assigned_name || '—')}</td><td>${tag(t.status)}</td></tr>`,
                open: (id, reload) => ticketDetail(id, reload)
            });
        },

        staff(root) {
            listPage(root, {
                path: '/staff', columns: ['Employé', 'Rôle', 'Fonction', 'Dernière connexion', 'Statut', ...(state.permissions.staff ? ['Actions'] : [])],
                action: state.permissions.staff ? '<button class="sp-btn" data-new>＋ Nouvel employé</button>' : '',
                row: s => `<tr data-id="${esc(s.id)}"><td><b>${esc(s.full_name)}</b><small>${esc(s.email)}</small></td><td>${tag(s.role)}</td><td>${esc(s.job_title || '—')}<small>${esc(s.phone || '')}</small></td><td>${esc(dateTime(s.last_login_at))}</td><td>${s.is_active ? tag('active') : '<span class="sp-tag bad">Désactivé</span>'}</td>${state.permissions.staff ? `<td><button class="sp-btn secondary small" data-edit="${esc(s.id)}">Modifier</button> <button class="sp-btn secondary small" data-reset="${esc(s.id)}">Mot de passe</button></td>` : ''}</tr>`,
                bind(rootEl, load) {
                    rootEl.querySelector('[data-new]')?.addEventListener('click', () => staffForm(null, load));
                    rootEl.addEventListener('click', async event => {
                        const edit = event.target.closest('[data-edit]'), reset = event.target.closest('[data-reset]');
                        if (edit) { const data = await api('/staff'); staffForm(data.items.find(item => String(item.id) === edit.dataset.edit), load); }
                        if (reset && confirm('Générer un nouveau mot de passe temporaire pour cet employé ?')) run(reset, async () => { const data = await send('POST', `/staff/${reset.dataset.reset}/reset-password`); const m = modal('Mot de passe temporaire', `<p>${esc(data.message)}</p><code class="sp-token">${esc(data.temporary_password)}</code>`, true); m.overlay.querySelector('.sp-close').focus(); });
                    });
                }
            });
        },

        async schedules(root) {
            const data = await api('/schedules');
            const taskPaging = { offset: 0, limit: 25, total: 0 }, sessionPaging = { offset: 0, limit: 25, total: 0 };
            root.innerHTML = `<div class="sp-tabs" role="tablist" aria-label="Sections des horaires de travail">
                <button type="button" class="sp-tab active" id="sp-schedule-tab-schedule" role="tab" aria-selected="true" aria-controls="sp-schedule-panel-schedule" tabindex="0" data-work-tab="schedule">Horaires planifiés</button>
                <button type="button" class="sp-tab" id="sp-schedule-tab-summary" role="tab" aria-selected="false" aria-controls="sp-schedule-panel-summary" tabindex="-1" data-work-tab="summary">Synthèse</button>
                <button type="button" class="sp-tab" id="sp-schedule-tab-tasks" role="tab" aria-selected="false" aria-controls="sp-schedule-panel-tasks" tabindex="-1" data-work-tab="tasks">Tâches effectuées</button>
                <button type="button" class="sp-tab" id="sp-schedule-tab-attendance" role="tab" aria-selected="false" aria-controls="sp-schedule-panel-attendance" tabindex="-1" data-work-tab="attendance">Pointages</button>
            </div>
            <section class="sp-tab-panel sp-panel" id="sp-schedule-panel-schedule" role="tabpanel" aria-labelledby="sp-schedule-tab-schedule" data-work-panel="schedule"><p class="sp-muted">Horaires hebdomadaires planifiés. Les heures réellement effectuées sont calculées séparément à partir des pointages.</p><div class="sp-table-wrap"><div class="sp-sched"><div class="head">Employé</div>${DAYS.map(name => `<div class="head">${name}</div>`).join('')}${data.items.map(member => `<div><b>${esc(member.full_name)}</b><br>${member.on_duty ? '<span class="sp-tag ok">En service</span>' : '<span class="sp-tag">Hors service</span>'}${state.permissions.staff ? `<br><button class="sp-link" data-sched="${esc(member.id)}">Modifier</button>` : ''}</div>${DAYS.map((_, index) => `<div>${member.shifts.filter(shift => Number(shift.weekday) === index + 1).map(shift => `${esc(shift.start_time)}–${esc(shift.end_time)}`).join('<br>') || '<span class="sp-muted">—</span>'}</div>`).join('')}`).join('')}</div></div></section>
            <div class="sp-toolbar sp-history-filters" hidden><label>Période<select data-history-period><option value="week">Cette semaine</option><option value="biweek">14 derniers jours</option><option value="month">Ce mois</option><option value="year">Cette année</option></select></label>${state.permissions.staff ? `<label>Employé<select data-history-staff><option value="">Toute l’équipe</option>${data.items.map(member => `<option value="${esc(member.id)}">${esc(member.full_name)}</option>`).join('')}</select></label>` : ''}<span class="sp-muted" data-history-range></span></div>
            <section class="sp-tab-panel sp-panel" id="sp-schedule-panel-summary" role="tabpanel" aria-labelledby="sp-schedule-tab-summary" data-work-panel="summary" hidden><p class="sp-muted">Les pointages commencent aujourd’hui; aucune heure antérieure ne peut être reconstituée.</p><div data-work-summary><p class="sp-muted">Chargement de l’historique…</p></div></section>
            <section class="sp-tab-panel sp-panel" id="sp-schedule-panel-tasks" role="tabpanel" aria-labelledby="sp-schedule-tab-tasks" data-work-panel="tasks" hidden><p class="sp-muted">Tickets de support clôturés; les anciennes assignations sans date ne peuvent pas être reconstituées.</p><div data-work-tasks><p class="sp-muted">Chargement de l’historique…</p></div></section>
            <section class="sp-tab-panel sp-panel" id="sp-schedule-panel-attendance" role="tabpanel" aria-labelledby="sp-schedule-tab-attendance" data-work-panel="attendance" hidden><p class="sp-muted">Heures réellement pointées; elles ne représentent pas les horaires prévus.</p><div class="sp-clock"><span data-clock-state>Chargement du pointage…</span><button class="sp-btn" data-clock-action disabled>Chargement…</button></div><div data-work-sessions><p class="sp-muted">Chargement des pointages…</p></div></section>`;
            const selectTab = selected => {
                root.querySelectorAll('[data-work-tab]').forEach(button => {
                    const active = button.dataset.workTab === selected;
                    button.classList.toggle('active', active);
                    button.setAttribute('aria-selected', String(active));
                    button.tabIndex = active ? 0 : -1;
                });
                root.querySelectorAll('[data-work-panel]').forEach(panel => { panel.hidden = panel.dataset.workPanel !== selected; });
                root.querySelector('.sp-history-filters').hidden = selected === 'schedule';
            };
            root.querySelector('[role="tablist"]').addEventListener('click', event => {
                const button = event.target.closest('[data-work-tab]');
                if (button) selectTab(button.dataset.workTab);
            });
            root.querySelector('[role="tablist"]').addEventListener('keydown', event => {
                const tabs = [...root.querySelectorAll('[data-work-tab]')], index = tabs.indexOf(event.target.closest('[data-work-tab]'));
                if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                selectTab(tabs[next].dataset.workTab);
                tabs[next].focus();
            });
            root.querySelectorAll('[data-sched]').forEach(button => button.onclick = () => scheduleForm(data.items.find(item => String(item.id) === button.dataset.sched), () => go('schedules')));
            const clockButton = root.querySelector('[data-clock-action]'), clockState = root.querySelector('[data-clock-state]');
            async function refreshClock() {
                const { active } = await api('/me/time-clock');
                clockButton.disabled = false;
                clockButton.dataset.active = active ? '1' : '0';
                clockButton.textContent = active ? 'Terminer ma journée' : 'Commencer ma journée';
                clockButton.dataset.label = clockButton.textContent;
                clockState.textContent = active ? `Pointage commencé à ${dateTime(active.clock_in)}.` : 'Aucun pointage en cours.';
            }
            clockButton.onclick = () => run(clockButton, async () => {
                const starting = clockButton.dataset.active !== '1';
                await send('POST', `/me/time-clock/${starting ? 'start' : 'stop'}`);
                await refreshClock();
                await loadHistory();
                toast(starting ? 'Journée de travail commencée.' : 'Pointage enregistré.');
            });
            const resetHistory = () => { taskPaging.offset = 0; sessionPaging.offset = 0; loadHistory(); };
            root.querySelector('[data-history-period]').onchange = resetHistory;
            root.querySelector('[data-history-staff]')?.addEventListener('change', resetHistory);
            async function loadHistory() {
                const params = new URLSearchParams({ period: root.querySelector('[data-history-period]').value });
                const staff = root.querySelector('[data-history-staff]')?.value;
                if (staff) params.set('staff_id', staff);
                params.set('task_limit', taskPaging.limit); params.set('task_offset', taskPaging.offset);
                params.set('session_limit', sessionPaging.limit); params.set('session_offset', sessionPaging.offset);
                root.querySelectorAll('[data-work-summary],[data-work-tasks],[data-work-sessions]').forEach(area => { area.innerHTML = '<p class="sp-muted">Chargement de l’historique…</p>'; });
                try {
                    const history = await api(`/work-history?${params}`);
                    const hours = value => `${Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`;
                    const resolution = value => value == null ? '—' : `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} min`;
                    root.querySelector('[data-history-range]').textContent = `Du ${date(history.start)} au ${date(history.end)} · tâches et heures pointées`;
                    const totalHours = history.staff.reduce((sum, member) => sum + Number(member.worked_hours || 0), 0);
                    const totalTasks = history.staff.reduce((sum, member) => sum + Number(member.closed_tasks || 0), 0);
                    root.querySelector('[data-work-summary]').innerHTML = `<div class="sp-cards">${card('Heures pointées', hours(totalHours), 'cumul de la période')}${card('Tâches terminées', totalTasks, 'tickets de support clôturés')}</div>
                    <div class="sp-table-wrap"><table><thead><tr><th>Employé</th><th>Heures pointées</th><th>Tâches terminées</th><th>Assignées</th><th>Volontaires</th><th>Traitement moyen</th><th>Note client moyenne</th></tr></thead><tbody>${history.staff.map(member => `<tr><td>${esc(member.full_name)}</td><td>${hours(member.worked_hours)}</td><td>${esc(member.closed_tasks)}</td><td>${esc(member.assigned_tasks)}</td><td>${esc(member.voluntary_tasks)}</td><td>${resolution(member.average_resolution_minutes)}</td><td>${member.average_rating == null ? '—' : `${Number(member.average_rating).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5 (${esc(member.rating_count)} avis)`}</td></tr>`).join('') || '<tr><td colspan="7" class="sp-muted">Aucun employé sur cette période.</td></tr>'}</tbody></table></div>`;
                    const taskArea = root.querySelector('[data-work-tasks]');
                    taskArea.innerHTML = `<div class="sp-table-wrap"><table><thead><tr><th>Employé</th><th>Client · tâche</th><th>Origine</th><th>Clôture</th><th>Traitement</th><th>Avis client</th></tr></thead><tbody>${history.tasks.map(task => `<tr><td>${esc(task.staff_name)}</td><td>${esc(task.organization_name)}<small>${esc(task.subject)}</small></td><td>${task.assignment_type ? tag(task.assignment_type) : '<span class="sp-tag">Non renseignée</span>'}</td><td>${esc(dateTime(task.closed_at))}</td><td>${resolution(task.resolution_minutes)}</td><td>${task.rating == null ? '—' : `${esc(task.rating)}/5${task.feedback_comment ? `<small>${esc(task.feedback_comment)}</small>` : ''}`}</td></tr>`).join('') || '<tr><td colspan="6" class="sp-muted">Aucune tâche clôturée sur cette période.</td></tr>'}</tbody></table></div><div class="sp-pager" data-task-pager></div>`;
                    const sessionArea = root.querySelector('[data-work-sessions]');
                    sessionArea.innerHTML = `<div class="sp-table-wrap"><table><thead><tr><th>Employé</th><th>Début</th><th>Fin</th><th>Durée</th></tr></thead><tbody>${history.sessions.map(session => `<tr><td>${esc(session.staff_name)}</td><td>${esc(dateTime(session.clock_in))}</td><td>${esc(session.clock_out ? dateTime(session.clock_out) : 'En cours')}</td><td>${hours(Number(session.worked_seconds) / 3600)}</td></tr>`).join('') || '<tr><td colspan="4" class="sp-muted">Aucun pointage enregistré sur cette période.</td></tr>'}</tbody></table></div><div class="sp-pager" data-session-pager></div>`;
                    taskPaging.total = history.tasks_total; taskPaging.offset = history.tasks_offset; taskPaging.limit = history.tasks_limit;
                    sessionPaging.total = history.sessions_total; sessionPaging.offset = history.sessions_offset; sessionPaging.limit = history.sessions_limit;
                    pager(taskArea.querySelector('[data-task-pager]'), taskPaging, loadHistory);
                    pager(sessionArea.querySelector('[data-session-pager]'), sessionPaging, loadHistory);
                } catch (error) { root.querySelectorAll('[data-work-summary],[data-work-tasks],[data-work-sessions]').forEach(area => { area.innerHTML = `<p class="sp-error">${esc(error.message)}</p>`; }); }
            }
            const card = (title, value, note) => `<div class="sp-card"><small>${esc(title)}</small><b>${esc(value)}</b><span>${esc(note || '')}</span></div>`;
            await Promise.all([refreshClock(), loadHistory()]);
        },

        tokens(root) {
            listPage(root, {
                path: '/tokens', columns: ['Client', 'Nom', 'Clé', 'Expiration', 'Dernier usage', 'État', ...(state.permissions.tokens ? ['Actions'] : [])],
                action: state.permissions.tokens ? '<button class="sp-btn" data-new>＋ Nouvelle clé API</button>' : '',
                row: t => `<tr data-id="${esc(t.id)}"><td>${esc(t.organization_name)}</td><td>${esc(t.name)}<small>par ${esc(t.created_by || '—')}</small></td><td><code>${esc(t.token_prefix)}…</code></td><td>${esc(date(t.expires_at))}</td><td>${esc(dateTime(t.last_used_at))}</td><td>${tag(t.state)}</td>${state.permissions.tokens ? `<td>${t.state === 'revoked' ? '' : `<button class="sp-btn danger small" data-revoke="${esc(t.id)}">Révoquer</button>`}</td>` : ''}</tr>`,
                bind(rootEl, load) {
                    rootEl.querySelector('[data-new]')?.addEventListener('click', () => tokenForm(load));
                    rootEl.addEventListener('click', event => { const button = event.target.closest('[data-revoke]'); if (button && confirm('Révoquer cette clé ? Les intégrations qui l’utilisent cesseront de fonctionner.')) run(button, async () => { await send('POST', `/tokens/${button.dataset.revoke}/revoke`); toast('Clé révoquée.'); load(); }); });
                }
            });
        },

        audit(root) {
            listPage(root, {
                path: '/audit', columns: ['Date', 'Employé', 'Action', 'Entité', 'Détails'],
                row: a => `<tr><td>${esc(dateTime(a.created_at))}</td><td>${esc(a.staff_name || '—')}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.entity_type)} ${esc(a.entity_id || '')}</td><td><small>${esc(typeof a.details_json === 'string' ? a.details_json : JSON.stringify(a.details_json || {}))}</small></td></tr>`
            });
        },

        async admin(root) {
            const tabs = [
                ['pricing', 'Tarifs et promotions'],
                ['partners', 'Partenaires'],
                ['settings', 'Paramètres'],
                ['report', 'Rapport marketing'],
                ['faqs', 'FAQ'],
                ['trainings', 'Formations'],
                ['database', 'Base de données']
            ];
            root.innerHTML = `<div class="sp-tabs" role="tablist" aria-label="Administration de la plateforme">${tabs.map(([key, title], index) => `<button type="button" class="sp-tab${index ? '' : ' active'}" role="tab" aria-selected="${index ? 'false' : 'true'}" data-admin-tab="${key}">${title}</button>`).join('')}</div><div class="sp-admin-panel"></div>`;
            const panel = root.querySelector('.sp-admin-panel');
            let activePricingTab = 'plans';
            const load = async key => {
                panel.innerHTML = '<p class="sp-muted">Chargement…</p>';
                if (key === 'pricing') {
                    const [plans, promotions] = await Promise.all([api('/admin/pricing'), api('/admin/promotions')]);
                    panel.innerHTML = `<div class="sp-tabs sp-tabs-right" role="tablist" aria-label="Sections des tarifs et promotions">
                            <button type="button" id="sp-pricing-tab-plans" class="sp-tab${activePricingTab === 'plans' ? ' active' : ''}" role="tab" aria-selected="${activePricingTab === 'plans'}" aria-controls="sp-pricing-panel-plans" tabindex="${activePricingTab === 'plans' ? '0' : '-1'}" data-pricing-tab="plans">Forfaits</button>
                            <button type="button" id="sp-pricing-tab-promotions" class="sp-tab${activePricingTab === 'promotions' ? ' active' : ''}" role="tab" aria-selected="${activePricingTab === 'promotions'}" aria-controls="sp-pricing-panel-promotions" tabindex="${activePricingTab === 'promotions' ? '0' : '-1'}" data-pricing-tab="promotions">Promotions</button>
                        </div>
                        <section id="sp-pricing-panel-plans" class="sp-tab-panel" role="tabpanel" aria-labelledby="sp-pricing-tab-plans"${activePricingTab === 'plans' ? '' : ' hidden'}>
                            <div class="sp-panel"><div class="sp-toolbar"><h3>Forfaits</h3><span class="grow"></span><button type="button" class="sp-btn" data-plan-add>＋ Ajouter un forfait</button></div><p class="sp-muted">Comptabilité expérimentale : accès rattaché à « Rapports & analyses », sans tarif distinct. Elle nécessite aussi l’activation du socle et un accès administrateur de l’établissement. Ses rapports ne sont pas officiels.</p><div class="sp-toolbar"><input type="search" data-plan-search placeholder="Rechercher un forfait…" aria-label="Rechercher un forfait"><select data-plan-status aria-label="Filtrer par statut"><option value="">Tous les statuts</option><option value="active">Actifs</option><option value="inactive">Désactivés</option></select><span class="grow"></span><button type="button" class="sp-btn secondary" data-plan-export>Exporter CSV</button></div><div class="sp-table-wrap"><table><thead><tr><th>Forfait</th><th>Fonctionnalités assignées</th><th>Mensuel</th><th>Annuel</th><th>2 ans</th><th>Utilisateurs</th><th>Produits</th><th>État</th><th>Action</th></tr></thead><tbody data-plan-rows></tbody></table></div></div>
                        </section>
                        <section id="sp-pricing-panel-promotions" class="sp-tab-panel" role="tabpanel" aria-labelledby="sp-pricing-tab-promotions"${activePricingTab === 'promotions' ? '' : ' hidden'}>
                            <div class="sp-panel"><h3>Promotions</h3><form data-promotion><div class="sp-grid2"><label>Code<input name="code" minlength="2" maxlength="60" pattern="[A-Z0-9][A-Z0-9_-]+" required></label><label>Nom<input name="name" minlength="2" maxlength="120" required></label><label>Forfait concerné<select name="plan_id"><option value="">Tous les forfaits</option>${plans.items.map(plan => `<option value="${esc(plan.id)}">${esc(plan.name)}</option>`).join('')}</select></label><label>Type<select name="discount_type"><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label><label>Valeur<input name="discount_value" type="number" min="0.01" step="0.01" required></label><label>Début<input name="starts_at" type="date" required></label><label>Fin (facultative)<input name="ends_at" type="date"></label></div><label><input type="checkbox" name="new_users_only"> Nouveaux clients uniquement</label><label><input type="checkbox" name="is_active" checked> Active</label><p class="sp-error"></p><button class="sp-btn">Créer la promotion</button></form><div class="sp-table-wrap"><table><thead><tr><th>Code</th><th>Forfait</th><th>Réduction</th><th>Période</th><th>Condition</th><th>État</th><th></th></tr></thead><tbody>${promotions.items.map(promo => `<tr><td><b>${esc(promo.code)}</b><small>${esc(promo.name)}</small></td><td>${esc(promo.plan_name || 'Tous les forfaits')}</td><td>${promo.discount_type === 'percent' ? `${esc(promo.discount_value)} %` : money(promo.discount_value)}</td><td>${date(promo.starts_at)} – ${date(promo.ends_at)}</td><td>${promo.new_users_only ? 'Nouveaux clients' : 'Tous'}</td><td>${promo.is_active ? tag('active') : tag('suspended')}</td><td><button class="sp-btn secondary small" data-promo-toggle="${esc(promo.id)}" data-active="${promo.is_active ? '1' : '0'}"> ${promo.is_active ? 'Désactiver' : 'Activer'} </button></td></tr>`).join('') || '<tr><td colspan="7" class="sp-muted">Aucune promotion.</td></tr>'}</tbody></table></div></div>
                        </section>`;
                    const pricingTabs = [...panel.querySelectorAll('[data-pricing-tab]')];
                    const selectPricingTab = selected => {
                        activePricingTab = selected;
                        pricingTabs.forEach(tab => {
                            const active = tab.dataset.pricingTab === selected;
                            tab.classList.toggle('active', active);
                            tab.setAttribute('aria-selected', String(active));
                            tab.tabIndex = active ? 0 : -1;
                            panel.querySelector(`#sp-pricing-panel-${tab.dataset.pricingTab}`).hidden = !active;
                        });
                    };
                    pricingTabs.forEach((tab, index) => {
                        tab.onclick = () => selectPricingTab(tab.dataset.pricingTab);
                        tab.onkeydown = event => {
                            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                            event.preventDefault();
                            const next = event.key === 'Home' ? 0 : event.key === 'End' ? pricingTabs.length - 1
                                : (index + (event.key === 'ArrowRight' ? 1 : pricingTabs.length - 1)) % pricingTabs.length;
                            pricingTabs[next].focus();
                            selectPricingTab(pricingTabs[next].dataset.pricingTab);
                        };
                    });
                    const planSearch = panel.querySelector('[data-plan-search]'), planStatus = panel.querySelector('[data-plan-status]');
                    const planRows = panel.querySelector('[data-plan-rows]');
                    const moduleLabels = plans.modules || {};
                    const accountingDetails = 'Comptabilité expérimentale : état des résultats, bilan, journal, grand livre, flux de trésorerie et rapport de taxes. Non officielle et sans tarif distinct.';
                    const parsePlanValue = (value, fallback) => {
                        if (typeof value !== 'string') return value ?? fallback;
                        try { return JSON.parse(value); } catch { return fallback; }
                    };
                    const planModules = plan => {
                        if (!plan) return [];
                        const configured = parsePlanValue(plan.included_modules, []);
                        if (plan.plan_type === 'starter') return ['stock', 'procurement', 'sales', 'cash'];
                        if (plan.plan_type === 'ultimate') return Object.keys(moduleLabels);
                        return Array.isArray(configured) ? configured : [];
                    };
                    const modulePricingEditor = plan => {
                        const selected = new Set(planModules(plan));
                        const prices = parsePlanValue(plan ? plan.module_prices : null, {});
                        const editable = !plan || plan.plan_type === 'customized';
                        return `<div class="sp-plan-features"><h4>Fonctionnalités et tarifs par période</h4>${plan && !editable ? '<label><input type="checkbox" data-enable-custom-features> Configurer une sélection personnalisée de fonctionnalités</label>' : ''}<p class="sp-muted">Cochez les fonctionnalités incluses et renseignez au moins un tarif (mensuel, annuel ou 2 ans) pour chacune.</p><div class="sp-toolbar"><input type="search" data-feature-search placeholder="Rechercher une fonctionnalité…" aria-label="Rechercher une fonctionnalité"></div><div class="sp-table-wrap"><table class="sp-feature-table"><thead><tr><th>Fonctionnalité</th><th>Mensuel</th><th>Annuel</th><th>2 ans</th></tr></thead><tbody>${Object.entries(moduleLabels).map(([key, label]) => {
                            const terms = prices?.[key] || {};
                            const checked = selected.has(key);
                            return `<tr data-feature="${esc(key)}" data-feature-label="${esc(`${key} ${label} ${key === 'reports' ? accountingDetails : ''}`.toLocaleLowerCase())}"><th scope="row"><label><input type="checkbox" name="feature_module" value="${esc(key)}"${checked ? ' checked' : ''}${editable ? '' : ' disabled'}> ${esc(label)}</label>${key === 'reports' ? `<small class="sp-muted">${esc(accountingDetails)}</small>` : ''}</th>${[['monthly', 'Mensuel'], ['annual', 'Annuel'], ['biennial', '2 ans']].map(([term, title]) => `<td><label class="sp-feature-price"><span class="sp-sr-only">${esc(label)} · ${title}</span><input type="number" min="0.01" step="0.01" aria-label="${esc(`${label} · ${title}`)}" data-feature-term="${term}" value="${terms[term] ?? ''}"${checked && editable ? '' : ' disabled'}></label></td>`).join('')}</tr>`;
                        }).join('')}<tr data-feature-empty hidden><td colspan="4" class="sp-muted">Aucune fonctionnalité trouvée.</td></tr></tbody></table></div></div>`;
                    };
                    const bindModulePricingEditor = form => {
                        const editor = form.querySelector('.sp-plan-features');
                        const enabled = () => !editor.querySelector('[data-enable-custom-features]') || editor.querySelector('[data-enable-custom-features]').checked;
                        const sync = () => editor.querySelectorAll('[data-feature]').forEach(card => {
                            const checkbox = card.querySelector('[name="feature_module"]');
                            if (editor.querySelector('[data-enable-custom-features]')) checkbox.disabled = !enabled();
                            card.querySelectorAll('[data-feature-term]').forEach(input => { input.disabled = !enabled() || !checkbox.checked; });
                        });
                        form.querySelectorAll('[data-feature]').forEach(card => {
                            const checkbox = card.querySelector('[name="feature_module"]');
                            checkbox.onchange = sync;
                        });
                        const search = editor.querySelector('[data-feature-search]');
                        search.oninput = () => {
                            const query = search.value.trim().toLocaleLowerCase();
                            const rows = [...editor.querySelectorAll('tr[data-feature]')];
                            let visible = 0;
                            rows.forEach(row => {
                                const matches = !query || row.dataset.featureLabel.includes(query);
                                row.hidden = !matches;
                                if (matches) visible += 1;
                            });
                            editor.querySelector('[data-feature-empty]').hidden = visible > 0;
                        };
                        editor.querySelector('[data-enable-custom-features]')?.addEventListener('change', sync);
                    };
                    const collectModulePricing = form => {
                        const enableCustom = form.querySelector('[data-enable-custom-features]');
                        if (enableCustom && !enableCustom.checked) return null;
                        const modules = [], modulePrices = {};
                        form.querySelectorAll('[data-feature]').forEach(card => {
                            const checkbox = card.querySelector('[name="feature_module"]');
                            if (!checkbox.checked) return;
                            modules.push(checkbox.value);
                            modulePrices[checkbox.value] = Object.fromEntries([...card.querySelectorAll('[data-feature-term]')].map(input => [input.dataset.featureTerm, input.value === '' ? null : Number(input.value)]));
                        });
                        return { included_modules: modules, module_prices: modulePrices };
                    };
                    const filteredPlans = () => plans.items.filter(plan => {
                        const query = planSearch.value.trim().toLocaleLowerCase();
                        const matchesQuery = !query || `${plan.name} ${plan.code}`.toLocaleLowerCase().includes(query);
                        const matchesStatus = !planStatus.value || (planStatus.value === 'active' ? Boolean(plan.is_active) : !plan.is_active);
                        return matchesQuery && matchesStatus;
                    });
                    const planTermAmount = (plan, term, column) => {
                        if (plan.plan_type !== 'customized') return plan[column] == null ? null : Number(plan[column]);
                        const modules = planModules(plan), prices = parsePlanValue(plan.module_prices, {});
                        if (!modules.length || modules.some(module => prices?.[module]?.[term] === null || prices?.[module]?.[term] === undefined || !Number.isFinite(Number(prices[module][term])))) return null;
                        return modules.reduce((total, module) => total + Number(prices[module][term]), 0);
                    };
                    const displayedPlanPrice = (plan, term, column) => {
                        const amount = planTermAmount(plan, term, column);
                        return amount === null ? '—' : money(amount, plan.currency);
                    };
                    const drawPlans = () => {
                        const rows = filteredPlans();
                        planRows.innerHTML = rows.length ? rows.map(plan => `<tr><td><b>${esc(plan.name)}</b><small>${esc(plan.code)} · ${esc(plan.plan_type)}</small></td><td>${planModules(plan).map(module => `${esc(moduleLabels[module] || module)}${module === 'reports' ? ' <small>Comptabilité expérimentale liée</small>' : ''}`).join(', ') || '—'}</td><td>${displayedPlanPrice(plan, 'monthly', 'monthly_price')}</td><td>${displayedPlanPrice(plan, 'annual', 'annual_price')}</td><td>${displayedPlanPrice(plan, 'biennial', 'biennial_price')}</td><td>${Number(plan.max_users).toLocaleString('fr-FR')}</td><td>${Number(plan.max_products).toLocaleString('fr-FR')}</td><td>${plan.is_active ? tag('active') : tag('suspended')}</td><td><button type="button" class="sp-btn secondary small" data-edit-plan="${esc(plan.id)}">Modifier</button></td></tr>`).join('') : '<tr><td colspan="9" class="sp-muted">Aucun forfait ne correspond aux critères.</td></tr>';
                    };
                    planSearch.oninput = drawPlans;
                    planStatus.onchange = drawPlans;
                    drawPlans();
                    panel.querySelector('[data-plan-add]').onclick = () => {
                        const m = modal('Ajouter un forfait', `<form data-create-plan><div class="sp-grid2"><label>Code du forfait<input name="code" maxlength="60" pattern="[a-z0-9][a-z0-9-]{1,59}" placeholder="ex. clinique-plus" required></label><label>Nom du forfait<input name="name" maxlength="100" required></label><label>Devise<input name="currency" maxlength="3" pattern="[A-Z]{3}" value="XAF" required></label><label>Utilisateurs inclus<input name="max_users" type="number" min="1" max="100000" value="5" required></label><label>Produits maximum<input name="max_products" type="number" min="1" max="10000000" value="10000000" required></label><label>Prix par utilisateur supplémentaire<input name="extra_user_price" type="number" min="0" step="0.01" value="0" required></label></div>${modulePricingEditor(null)}<label><input type="checkbox" name="is_active" checked> Forfait actif et visible à la souscription</label><p class="sp-error"></p><button class="sp-btn">Créer le forfait</button></form>`);
                        const form = m.body.querySelector('[data-create-plan]');
                        bindModulePricingEditor(form);
                        form.onsubmit = event => {
                            event.preventDefault();
                            const body = Object.fromEntries(new FormData(form));
                            const moduleConfig = collectModulePricing(form);
                            if (moduleConfig) Object.assign(body, moduleConfig);
                            body.max_users = Number(body.max_users); body.max_products = Number(body.max_products);
                            body.extra_user_price = Number(body.extra_user_price); body.is_active = form.elements.is_active.checked;
                            run(form.querySelector('button'), async () => {
                                await send('POST', '/admin/pricing', body);
                                m.close(); toast('Forfait créé.');
                                await load('pricing');
                            }, form.querySelector('.sp-error'));
                        };
                    };
                    planRows.onclick = event => {
                        const button = event.target.closest('[data-edit-plan]');
                        if (!button) return;
                        const plan = plans.items.find(item => String(item.id) === button.dataset.editPlan);
                        const m = modal(`Modifier le forfait · ${plan.name}`, `<form data-edit-plan-form><label>Nom<input name="name" maxlength="100" value="${esc(plan.name)}" required></label><div class="sp-grid2">${[['monthly_price', 'Prix mensuel'], ['annual_price', 'Prix annuel'], ['biennial_price', 'Prix sur 2 ans']].map(([field, title]) => `<label>${title}<input type="number" name="${field}" min="0" step="0.01" value="${plan[field] ?? ''}"${field === 'monthly_price' ? ' required' : ''}></label>`).join('')}</div><label>Devise<input name="currency" maxlength="3" pattern="[A-Z]{3}" value="${esc(plan.currency)}" required></label><div class="sp-grid2"><label>Utilisateurs inclus<input type="number" name="max_users" min="1" max="100000" value="${esc(plan.max_users)}" required></label><label>Produits maximum<input type="number" name="max_products" min="1" max="10000000" value="${esc(plan.max_products)}" required></label></div><label>Prix utilisateur supplémentaire<input type="number" name="extra_user_price" min="0" step="0.01" value="${esc(plan.extra_user_price ?? 0)}" required></label>${modulePricingEditor(plan)}<p class="sp-muted">La modification des fonctionnalités convertira ce forfait en offre personnalisable.</p><label><input type="checkbox" name="is_active"${plan.is_active ? ' checked' : ''}> Forfait actif</label><p class="sp-error"></p><button class="sp-btn">Enregistrer</button></form>`);
                        const form = m.body.querySelector('[data-edit-plan-form]');
                        bindModulePricingEditor(form);
                        form.onsubmit = event => {
                            event.preventDefault();
                            const body = Object.fromEntries(new FormData(form));
                            ['monthly_price', 'annual_price', 'biennial_price'].forEach(field => { body[field] = body[field] === '' ? null : Number(body[field]); });
                            body.max_users = Number(body.max_users); body.max_products = Number(body.max_products);
                            body.extra_user_price = Number(body.extra_user_price); body.is_active = form.elements.is_active.checked;
                            const moduleConfig = collectModulePricing(form);
                            if (moduleConfig) Object.assign(body, moduleConfig);
                            run(form.querySelector('button'), async () => {
                                await send('PATCH', `/admin/pricing/${plan.id}`, body);
                                m.close(); toast('Forfait mis à jour.');
                                await load('pricing');
                            }, form.querySelector('.sp-error'));
                        };
                    };
                    panel.querySelector('[data-plan-export]').onclick = () => {
                        const columns = ['Nom', 'Code', 'Type', 'Fonctionnalités', 'Mensuel', 'Annuel', '2 ans', 'Devise', 'Utilisateurs maximum', 'Produits maximum', 'Prix utilisateur supplémentaire', 'Actif'];
                        const rows = [columns, ...filteredPlans().map(plan => [plan.name, plan.code, plan.plan_type, planModules(plan).map(module => moduleLabels[module] || module).join(', '), planTermAmount(plan, 'monthly', 'monthly_price') ?? '', planTermAmount(plan, 'annual', 'annual_price') ?? '', planTermAmount(plan, 'biennial', 'biennial_price') ?? '', plan.currency, plan.max_users, plan.max_products, plan.extra_user_price ?? '', plan.is_active ? 'Oui' : 'Non'])];
                        const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
                        link.download = 'liste-forfaits.csv'; link.click(); URL.revokeObjectURL(link.href);
                    };
                    const promotionForm = panel.querySelector('[data-promotion]');
                    promotionForm.onsubmit = event => {
                        event.preventDefault(); const body = Object.fromEntries(new FormData(promotionForm));
                        body.code = body.code.toUpperCase(); body.discount_value = Number(body.discount_value);
                        body.plan_id = body.plan_id || null;
                        body.new_users_only = promotionForm.elements.new_users_only.checked; body.is_active = promotionForm.elements.is_active.checked;
                        if (!body.ends_at) body.ends_at = null;
                        run(promotionForm.querySelector('button'), async () => { await send('POST', '/admin/promotions', body); toast('Promotion créée.'); await load('pricing'); }, promotionForm.querySelector('.sp-error'));
                    };
                    panel.querySelectorAll('[data-promo-toggle]').forEach(button => button.onclick = () => {
                        const promo = promotions.items.find(item => String(item.id) === button.dataset.promoToggle);
                        run(button, async () => { await send('PATCH', `/admin/promotions/${promo.id}`, { name: promo.name, plan_id: promo.plan_id || null, discount_type: promo.discount_type, discount_value: Number(promo.discount_value), starts_at: promo.starts_at, ends_at: promo.ends_at || null, new_users_only: Boolean(promo.new_users_only), is_active: button.dataset.active !== '1' }); toast('Promotion mise à jour.'); await load('pricing'); });
                    });
                } else if (key === 'database') {
                    const data = await api('/admin/database/status');
                    const statusText = { applied: 'Appliquée', pending: 'À appliquer', blocked: 'Bloquée', checksum_mismatch: 'Signature différente', schema_drift: 'Schéma divergent' };
                    panel.innerHTML = `<div class="sp-panel"><div class="sp-toolbar"><div><h3>Mises à jour de la base</h3><p class="sp-muted">Seules les migrations versionnées livrées avec l’application sont exécutables ici. Aucun SQL libre n’est accepté.</p></div><span class="grow"></span><button type="button" class="sp-btn secondary" data-db-refresh>Actualiser</button><button type="button" class="sp-btn" data-db-backup>Créer une sauvegarde maintenant</button></div><p class="sp-muted">Avant chaque migration, une sauvegarde SQL complète est créée avec mysqldump et vérifiée. Les changements de schéma MySQL ne sont pas toujours annulables automatiquement.</p><div class="sp-table-wrap"><table><thead><tr><th>Migration</th><th>État</th><th>Aperçu des changements</th><th>Dernière tentative</th><th>Action</th></tr></thead><tbody>${data.items.map(item => `<tr><td><b>${esc(item.id)}</b><small>${esc(item.description)}</small></td><td>${tag(item.status === 'applied' ? 'active' : item.status === 'pending' ? 'pending' : 'suspended')}<small>${esc(statusText[item.status] || item.status)}</small>${item.reason ? `<small class="sp-error">${esc(item.reason)}</small>` : ''}</td><td>${item.steps.length ? item.steps.map(step => `<small>• ${esc(step.description)}</small>`).join('') : '<small>Aucun changement de schéma requis.</small>'}</td><td>${item.last_run ? `<small>${esc(item.last_run.status)} · ${dateTime(item.last_run.started_at)}</small>${item.last_run.error_message ? `<small class="sp-error">${esc(item.last_run.error_message)}</small>` : ''}` : '—'}</td><td>${item.status === 'pending' ? `<button type="button" class="sp-btn small" data-db-migrate="${esc(item.id)}">Vérifier et appliquer</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="sp-muted">Aucune migration disponible.</td></tr>'}</tbody></table></div></div><div class="sp-panel"><h3>Sauvegardes de la base</h3><div class="sp-table-wrap"><table><thead><tr><th>Fichier</th><th>Créée le</th><th>Taille</th><th></th></tr></thead><tbody>${data.backups.map(file => `<tr><td><code>${esc(file.filename)}</code></td><td>${dateTime(file.created_at)}</td><td>${bytes(file.size)}</td><td><button type="button" class="sp-btn secondary small" data-db-download="${esc(file.filename)}">Télécharger</button></td></tr>`).join('') || '<tr><td colspan="4" class="sp-muted">Aucune sauvegarde disponible.</td></tr>'}</tbody></table></div></div><div class="sp-panel"><h3>Journal des exécutions</h3><div class="sp-table-wrap"><table><thead><tr><th>Migration</th><th>État</th><th>Administrateur</th><th>Sauvegarde</th><th>Début</th><th>Fin</th><th>Détail</th></tr></thead><tbody>${data.runs.map(run => `<tr><td>${esc(run.migration_id)}</td><td>${esc(run.status)}</td><td>${esc(run.full_name || '—')}</td><td>${run.backup_filename ? esc(run.backup_filename) : '—'}</td><td>${dateTime(run.started_at)}</td><td>${dateTime(run.completed_at)}</td><td>${esc(run.error_message || '—')}</td></tr>`).join('') || '<tr><td colspan="7" class="sp-muted">Aucune exécution enregistrée.</td></tr>'}</tbody></table></div></div>`;
                    panel.querySelector('[data-db-refresh]').onclick = () => load('database').catch(error => toast(error.message, true));
                    panel.querySelector('[data-db-backup]').onclick = event => run(event.currentTarget, async () => {
                        const result = await send('POST', '/admin/database/backup');
                        toast(`Sauvegarde créée · ${bytes(result.backup.size)}`);
                        await load('database');
                    });
                    panel.querySelectorAll('[data-db-migrate]').forEach(button => button.onclick = () => {
                        const migration = data.items.find(item => item.id === button.dataset.dbMigrate);
                        const changes = migration.steps.map(step => `• ${step.description}`).join('\n') || 'Aucun changement de schéma requis.';
                        if (!confirm(`Migration : ${migration.id}\n\n${changes}\n\nUne sauvegarde complète sera créée avant l’application. Les DDL MySQL peuvent ne pas être annulables. Confirmer l’opération ?`)) return;
                        run(button, async () => {
                            const result = await send('POST', `/admin/database/migrations/${encodeURIComponent(migration.id)}/apply`, { confirm: true });
                            toast(`${result.message} Sauvegarde : ${result.backup.filename}`);
                            await load('database');
                        });
                    });
                    panel.querySelectorAll('[data-db-download]').forEach(button => button.onclick = () => run(button, async () => {
                        await download(`/admin/database/backups/${encodeURIComponent(button.dataset.dbDownload)}`, button.dataset.dbDownload);
                    }));
                } else if (key === 'faqs' || key === 'trainings') {
                    const isFaq = key === 'faqs', { items } = await api(`/admin/${key}`);
                    const field = (name, label, value, attrs = '') => `<label>${label}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
                    const area = (name, label, value) => `<label>${label}<textarea name="${name}" maxlength="10000" rows="3" required>${esc(value ?? '')}</textarea></label>`;
                    const formatSelect = value => `<label>Format<select name="format">${[['article', 'Article'], ['video', 'Vidéo'], ['link', 'Lien']].map(([id, label]) => `<option value="${id}"${value === id ? ' selected' : ''}>${label}</option>`).join('')}</select></label>`;
                    const fields = (item = {}) => (isFaq
                        ? `${field('question', 'Question', item.question, 'minlength="5" maxlength="255" required')}${area('answer', 'Réponse', item.answer)}${field('category', 'Catégorie', item.category || 'Général', 'minlength="2" maxlength="100" required')}`
                        : `${field('title', 'Titre', item.title, 'minlength="2" maxlength="180" required')}${area('description', 'Description', item.description)}${formatSelect(item.format)}${field('url', 'Lien (facultatif)', item.url, 'type="url" maxlength="1000" placeholder="https://…"')}`)
                        + `${field('sort_order', 'Ordre', item.sort_order ?? 0, 'type="number" step="1" required')}<label><input type="checkbox" name="is_active"${item.is_active === 0 || item.is_active === false ? '' : ' checked'}> Publié</label>`;
                    panel.innerHTML = `<div class="sp-panel"><div class="sp-toolbar"><h3>${isFaq ? 'FAQ affichée dans Assistance' : 'Ressources de formation'}</h3><span class="grow"></span><button type="button" class="sp-btn" data-content-add>＋ Ajouter</button></div><div class="sp-toolbar"><input type="search" data-content-search placeholder="Rechercher…" aria-label="Rechercher"></div><div class="sp-table-wrap"><table><thead><tr><th>${isFaq ? 'Question' : 'Titre'}</th><th>${isFaq ? 'Catégorie' : 'Format'}</th><th>Ordre</th><th>État</th><th>Action</th></tr></thead><tbody data-content-rows></tbody></table></div></div>`;
                    const rows = panel.querySelector('[data-content-rows]'), search = panel.querySelector('[data-content-search]');
                    const draw = () => {
                        const term = search.value.trim().toLowerCase();
                        const visible = items.filter(item => !term || JSON.stringify(item).toLowerCase().includes(term));
                        rows.innerHTML = visible.map(item => `<tr><td><b>${esc(isFaq ? item.question : item.title)}</b></td><td>${esc(isFaq ? item.category : item.format)}</td><td>${esc(item.sort_order)}</td><td>${item.is_active ? tag('active') : tag('suspended')}</td><td><button type="button" class="sp-btn secondary small" data-content-edit="${esc(item.id)}">Modifier</button></td></tr>`).join('') || '<tr><td colspan="5" class="sp-muted">Aucun contenu.</td></tr>';
                    };
                    const open = item => {
                        const m = modal(item ? 'Modifier' : 'Ajouter', `<form data-content-form>${fields(item || {})}<p class="sp-error"></p><button class="sp-btn">Enregistrer</button></form>`);
                        const form = m.body.querySelector('form');
                        form.onsubmit = event => {
                            event.preventDefault();
                            const body = Object.fromEntries(new FormData(form));
                            body.sort_order = Number(body.sort_order); body.is_active = form.elements.is_active.checked;
                            run(form.querySelector('button'), async () => {
                                await send(item ? 'PATCH' : 'POST', `/admin/${key}${item ? `/${item.id}` : ''}`, body);
                                m.close(); toast('Contenu enregistré.'); await load(key);
                            }, form.querySelector('.sp-error'));
                        };
                    };
                    search.oninput = draw; draw();
                    panel.querySelector('[data-content-add]').onclick = () => open(null);
                    rows.onclick = event => { const button = event.target.closest('[data-content-edit]'); if (button) open(items.find(item => String(item.id) === button.dataset.contentEdit)); };
                } else if (key === 'partners') {
                    const [data, config] = await Promise.all([api('/admin/partners'), api('/admin/settings')]);
                    const settings = config.settings;
                    panel.innerHTML = `<div class="sp-panel"><h3>Ajouter un partenaire</h3><form data-partner><div class="sp-grid2"><label>Nom<input name="name" maxlength="180" required></label><label>Courriel<input name="email" type="email" maxlength="190"></label><label>Téléphone<input name="phone" maxlength="50"></label><label>Type<select name="partner_type">${settings.partner_types.map(item => `<option>${esc(item)}</option>`).join('')}</select></label><label>Catégorie<select name="category">${settings.categories.map(item => `<option>${esc(item)}</option>`).join('')}</select></label><label>Taux personnalisé (%)<input name="commission_percent" type="number" min="0" max="100" step="0.01" placeholder="Défaut : ${esc(settings.default_commission_percent)}"></label></div><label>Notes<textarea name="notes" maxlength="1000"></textarea></label><p class="sp-error"></p><button class="sp-btn">Créer et générer un code</button></form></div><div class="sp-panel"><h3>Partenaires et commissions</h3><div class="sp-table-wrap"><table><thead><tr><th>Partenaire</th><th>Référencements</th><th>Code</th><th>Commissions</th><th>État</th><th>Actions</th></tr></thead><tbody>${data.items.map(partner => `<tr><td><b>${esc(partner.name)}</b><small>${esc(partner.partner_type)} · ${esc(partner.category)} · ${esc(partner.commission_percent ?? settings.default_commission_percent)} %</small></td><td>${esc(partner.referrals)}</td><td><code>${esc(partner.referral_code)}</code><small><a href="/inscription?ref=${encodeURIComponent(partner.referral_code)}" target="_blank" rel="noopener">Lien d’inscription</a></small></td><td>${money(partner.pending_commissions, partner.currency)} impayé<small>${money(partner.total_commissions, partner.currency)} au total</small></td><td>${partner.is_active ? tag('active') : tag('suspended')}</td><td><button class="sp-btn secondary small" data-partner-edit="${esc(partner.id)}">Modifier</button> <button class="sp-btn secondary small" data-payout="${esc(partner.id)}">Enregistrer paiement</button></td></tr>`).join('') || '<tr><td colspan="6" class="sp-muted">Aucun partenaire.</td></tr>'}</tbody></table></div></div>`;
                    panel.insertAdjacentHTML('beforeend', `<div class="sp-panel"><h3>Commissions récentes</h3><div class="sp-table-wrap"><table><thead><tr><th>Partenaire</th><th>Client référé</th><th>Facture</th><th>Commission</th><th>État</th><th>Date</th></tr></thead><tbody>${data.commissions.map(item => `<tr><td>${esc(item.partner_name)}</td><td>${esc(item.organization_name)}</td><td>${esc(item.invoice_number)}</td><td>${money(item.commission_amount, item.currency)} (${esc(item.commission_percent)} %)</td><td>${tag(item.status)}</td><td>${date(item.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="sp-muted">Aucune commission enregistrée.</td></tr>'}</tbody></table></div></div>`);
                    const form = panel.querySelector('[data-partner]');
                    form.onsubmit = event => {
                        event.preventDefault(); const body = Object.fromEntries(new FormData(form));
                        if (body.commission_percent === '') body.commission_percent = null; else body.commission_percent = Number(body.commission_percent);
                        run(form.querySelector('button'), async () => { const result = await send('POST', '/admin/partners', body); toast(`Partenaire créé · code ${result.referral_code}`); await load('partners'); }, form.querySelector('.sp-error'));
                    };
                    panel.querySelectorAll('[data-payout]').forEach(button => button.onclick = () => {
                        const reference = prompt('Référence du paiement manuel :');
                        if (!reference) return;
                        run(button, async () => { const result = await send('POST', `/admin/partners/${button.dataset.payout}/payout`, { payment_reference: reference }); toast(`Paiement enregistré : ${money(result.amount, result.currency)}.`); await load('partners'); });
                    });
                    panel.querySelectorAll('[data-partner-edit]').forEach(button => button.onclick = () => {
                        const partner = data.items.find(item => String(item.id) === button.dataset.partnerEdit);
                        const m = modal('Modifier le partenaire', `<form><label>Nom<input name="name" value="${esc(partner.name)}" required></label><label>Courriel<input name="email" type="email" value="${esc(partner.email || '')}"></label><label>Téléphone<input name="phone" value="${esc(partner.phone || '')}"></label><label>Type<select name="partner_type">${settings.partner_types.map(item => `<option${item === partner.partner_type ? ' selected' : ''}>${esc(item)}</option>`).join('')}</select></label><label>Catégorie<select name="category">${settings.categories.map(item => `<option${item === partner.category ? ' selected' : ''}>${esc(item)}</option>`).join('')}</select></label><label>Taux personnalisé (%)<input name="commission_percent" type="number" min="0" max="100" step="0.01" value="${esc(partner.commission_percent ?? '')}"></label><label>Notes<textarea name="notes">${esc(partner.notes || '')}</textarea></label><label><input name="is_active" type="checkbox"${partner.is_active ? ' checked' : ''}> Partenaire actif</label><p class="sp-error"></p><button class="sp-btn">Enregistrer</button></form>`);
                        const editForm = m.body.querySelector('form');
                        editForm.onsubmit = event => { event.preventDefault(); const body = Object.fromEntries(new FormData(editForm)); body.is_active = editForm.elements.is_active.checked; body.commission_percent = body.commission_percent === '' ? null : Number(body.commission_percent); run(editForm.querySelector('button'), async () => { await send('PATCH', `/admin/partners/${partner.id}`, body); m.close(); toast('Partenaire mis à jour.'); await load('partners'); }, editForm.querySelector('.sp-error')); };
                    });
                } else if (key === 'settings') {
                    const { settings } = await api('/admin/settings');
                    panel.innerHTML = `<form class="sp-panel" data-settings><h3>Paramètres du programme partenaires</h3><label>Commission par défaut (%)<input name="default_commission_percent" type="number" min="0" max="100" step="0.01" value="${esc(settings.default_commission_percent)}" required></label><label>Types de partenaires (séparés par des virgules)<input name="partner_types" value="${esc(settings.partner_types.join(', '))}" required></label><label>Catégories (séparées par des virgules)<input name="categories" value="${esc(settings.categories.join(', '))}" required></label><label>Fréquence de versement<select name="payout_frequency"><option value="weekly"${settings.payout_frequency === 'weekly' ? ' selected' : ''}>Hebdomadaire</option><option value="monthly"${settings.payout_frequency === 'monthly' ? ' selected' : ''}>Mensuelle</option></select></label><label>Devise<input name="currency" pattern="[A-Z]{3}" value="${esc(settings.currency)}" required></label><p class="sp-error"></p><button class="sp-btn">Enregistrer les paramètres</button></form>`;
                    const form = panel.querySelector('[data-settings]');
                    form.onsubmit = event => { event.preventDefault(); const body = Object.fromEntries(new FormData(form)); body.default_commission_percent = Number(body.default_commission_percent); body.partner_types = body.partner_types.split(',').map(item => item.trim()).filter(Boolean); body.categories = body.categories.split(',').map(item => item.trim()).filter(Boolean); run(form.querySelector('button'), async () => { await send('PUT', '/admin/settings', body); toast('Paramètres enregistrés.'); }, form.querySelector('.sp-error')); };
                } else {
                    const today = new Date(), prior = new Date(today); prior.setDate(prior.getDate() - 29);
                    const iso = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
                    panel.innerHTML = `<div class="sp-panel"><h3>Rapport marketing</h3><form data-report><div class="sp-grid2"><label>Du<input name="from" type="date" value="${iso(prior)}" required></label><label>Au<input name="to" type="date" value="${iso(today)}" required></label></div><p class="sp-error" role="alert"></p><button type="submit" class="sp-btn">Générer le rapport</button> <button type="button" class="sp-btn secondary" data-export disabled>Exporter CSV</button></form></div><div data-report-result></div>`;
                    const reportForm = panel.querySelector('[data-report]'), result = panel.querySelector('[data-report-result]'), exportButton = panel.querySelector('[data-export]');
                    let report;
                    const renderReport = data => {
                        report = data; exportButton.disabled = false;
                        const card = (title, value) => `<div class="sp-card"><small>${title}</small><b>${value}</b></div>`;
                        result.innerHTML = `<div class="sp-cards">${card('Nouveaux clients', Number(data.signups).toLocaleString('fr-FR'))}${card('Conversions en abonnés actifs', Number(data.conversions).toLocaleString('fr-FR'))}${card('Factures payées', Number(data.paid_invoices).toLocaleString('fr-FR'))}${card('Revenu encaissé', money(data.paid_revenue))}</div><div class="sp-grid2"><div class="sp-panel"><h3>Promotions</h3><table><thead><tr><th>Code</th><th>Factures</th><th>Remises</th></tr></thead><tbody>${data.promotions.map(item => `<tr><td>${esc(item.code)} · ${esc(item.name)}</td><td>${esc(item.invoices)}</td><td>${money(item.discount_amount)}</td></tr>`).join('') || '<tr><td colspan="3">Aucune promotion.</td></tr>'}</tbody></table></div><div class="sp-panel"><h3>Partenaires</h3><table><thead><tr><th>Partenaire</th><th>Référencements</th><th>Commissions</th></tr></thead><tbody>${data.partners.map(item => `<tr><td>${esc(item.name)}<small>${esc(item.referral_code)}</small></td><td>${esc(item.referrals)}</td><td>${money(item.pending_commissions)} en attente<small>${money(item.paid_commissions)} payées</small></td></tr>`).join('') || '<tr><td colspan="3">Aucune donnée.</td></tr>'}</tbody></table></div></div><div class="sp-panel"><h3>Activités de la plateforme</h3><div class="sp-table-wrap"><table><thead><tr><th>Action</th><th>Nombre</th></tr></thead><tbody>${data.activities.map(item => `<tr><td>${esc(item.action)}</td><td>${Number(item.total).toLocaleString('fr-FR')}</td></tr>`).join('') || '<tr><td colspan="2">Aucune activité enregistrée.</td></tr>'}</tbody></table></div></div>`;
                    };
                    reportForm.onsubmit = event => { event.preventDefault(); reportForm.querySelector('.sp-error').textContent = ''; run(reportForm.querySelector('button[type="submit"],button:not([type])'), async () => { const params = new URLSearchParams(new FormData(reportForm)); renderReport(await api(`/admin/marketing-report?${params}`)); }, reportForm.querySelector('.sp-error')); };
                    exportButton.onclick = () => {
                        if (!report) return;
                        const rows = [['Indicateur', 'Valeur'], ['Du', report.from], ['Au', report.to], ['Nouveaux clients', report.signups], ['Conversions actives', report.conversions], ['Factures payées', report.paid_invoices], ['Revenu encaissé', report.paid_revenue], [], ['Promotion', 'Factures', 'Remises'], ...report.promotions.map(item => [item.code, item.invoices, item.discount_amount]), [], ['Partenaire', 'Code', 'Référencements', 'Commissions en attente', 'Commissions payées'], ...report.partners.map(item => [item.name, item.referral_code, item.referrals, item.pending_commissions, item.paid_commissions]), [], ['Activité', 'Nombre'], ...report.activities.map(item => [item.action, item.total])];
                        const csv = rows.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
                        const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })); link.download = `rapport-marketing-${report.from}-${report.to}.csv`; link.click(); URL.revokeObjectURL(link.href);
                    };
                    reportForm.requestSubmit();
                }
            };
            root.querySelector('[role="tablist"]').addEventListener('click', event => {
                const button = event.target.closest('[data-admin-tab]'); if (!button) return;
                root.querySelectorAll('[data-admin-tab]').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
                load(button.dataset.adminTab).catch(error => { panel.innerHTML = `<p class="sp-error">${esc(error.message)}</p>`; });
            });
            await load('pricing');
        }
    };

    const NAV = [['dashboard', 'Tableau de bord'], ['clients', 'Clients & abonnements'], ['analytics', 'Trafic & données'], ['invoices', 'Facturation'], ['claims', 'Réclamations'], ['support', 'Support technique'], ['staff', 'Employés'], ['schedules', 'Horaires de travail'], ['tokens', 'Clés API clients'], ['audit', 'Journal d’activité', 'admin'], ['admin', 'Administration commerciale', 'admin']];

    async function go(page) {
        const entry = NAV.find(item => item[0] === page) || NAV[0];
        state.page = entry[0]; $('#sp-title').textContent = entry[1];
        document.querySelectorAll('#sp-nav button').forEach(button => button.classList.toggle('active', button.dataset.page === entry[0]));
        closeMenu();
        const previous = $('#sp-content'), root = previous.cloneNode(false); previous.replaceWith(root); root.innerHTML = '<p class="sp-muted">Chargement…</p>';
        try { await pages[entry[0]](root); } catch (error) { root.innerHTML = `<p class="sp-error">${esc(error.message)}</p>`; }
        if (location.hash !== `#${entry[0]}`) history.replaceState(null, '', `#${entry[0]}`);
    }

    async function analyticsDetail(id) {
        const m = modal('Trafic, données et tendances', '<p class="sp-muted">Chargement…</p>');
        try {
            const d = await api(`/analytics/clients/${id}`);
            const bars = (rows, value, label, cls) => { const max = Math.max(1, ...rows.map(value)); return rows.length ? `<div class="sp-bars ${cls || ''}">${rows.map(row => `<i style="height:${Math.max(3, Math.round(value(row) / max * 100))}%" title="${esc(label(row))}"></i>`).join('')}</div>` : '<p class="sp-muted">Aucune donnée.</p>'; };
            const arrow = value => (value === null ? 'nouveau' : `<span class="sp-trend ${value > 0 ? 'up' : 'down'}">${value > 0 ? '▲' : '▼'} ${Math.abs(value)} %</span>`);
            const productTable = (rows, empty) => `<table><thead><tr><th>Produit</th><th>30 j</th><th>30 j préc.</th><th>Évolution</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.quantity_current}</td><td>${r.quantity_previous}</td><td>${arrow(r.change)}</td></tr>`).join('') || `<tr><td colspan="4" class="sp-muted">${empty}</td></tr>`}</tbody></table>`;
            const p = d.products, requests = d.traffic.reduce((sum, row) => sum + row.requests, 0);
            m.body.innerHTML = `<h4>${esc(d.organization.name)}</h4>
            <div class="sp-panel"><h3>Trafic (30 jours) · ${requests.toLocaleString('fr-FR')} requêtes</h3>${bars(d.traffic, r => r.requests, r => `${r.day} : ${r.requests} requêtes, ${r.errors} erreurs`)}</div>
            <div class="sp-panel"><h3>Données stockées · ${bytes(d.storage.bytes)} (${d.storage.records.toLocaleString('fr-FR')} enregistrements)</h3><table><thead><tr><th>Table</th><th>Enregistrements</th><th>Taille estimée</th></tr></thead><tbody>${d.storage.tables.map(t => `<tr><td><code>${esc(t.name)}</code></td><td>${t.rows.toLocaleString('fr-FR')}</td><td>${bytes(t.bytes)}</td></tr>`).join('') || '<tr><td colspan="3" class="sp-muted">Aucune donnée.</td></tr>'}</tbody></table></div>
            <div class="sp-panel"><h3>Ventes par semaine (12 semaines)</h3>${bars(d.weekly_sales, r => r.revenue, r => `Semaine du ${r.week} : ${money(r.revenue)} (${r.invoices} factures)`, 'green')}</div>
            <div class="sp-panel"><h3>Produits les plus vendus (quantités, 30 derniers jours)</h3>${productTable(p.top, 'Aucune vente sur la période.')}</div>
            <div class="sp-grid2"><div class="sp-panel"><h3>En hausse</h3>${productTable(p.rising, 'Aucun produit en hausse.')}</div><div class="sp-panel"><h3>En baisse</h3>${productTable(p.falling, 'Aucun produit en baisse.')}</div></div>
            <div class="sp-panel"><h3>Catalogue et stock</h3><p>${p.total} produits · ${p.out_of_stock} en rupture · ${p.low_stock} sous le seuil · Mouvements 30 j : ${esc(['IN', 'OUT', 'ADJUSTMENT'].map(k => `${{ IN: 'entrées', OUT: 'sorties', ADJUSTMENT: 'ajustements' }[k]} ${p.movements[k] || 0}`).join(' · '))}</p><h3>Sans vente depuis 30 jours (stock restant)</h3><table><tbody>${p.idle.map(r => `<tr><td>${esc(r.name)}</td><td>${r.quantity_on_hand}</td></tr>`).join('') || '<tr><td class="sp-muted">Aucun produit dormant.</td></tr>'}</tbody></table></div>`;
        } catch (error) { m.body.innerHTML = `<p class="sp-error">${esc(error.message)}</p>`; }
    }

    async function clientDetail(id, reload) {
        const m = modal('Détail du client', '<p class="sp-muted">Chargement…</p>');
        try {
            const [data, plans] = await Promise.all([api(`/clients/${id}`), state.permissions.clients ? api('/plans') : { items: [] }]);
            const o = data.organization, s = data.subscription, can = state.permissions.clients;
            m.body.innerHTML = `<dl class="sp-kv"><dt>Nom</dt><dd>${esc(o.name)} ${tag(o.status)}</dd><dt>Contact</dt><dd>${esc(o.email || '—')} · ${esc(o.phone || '—')}</dd><dt>Inscrit le</dt><dd>${date(o.created_at)}</dd><dt>Utilisateurs actifs</dt><dd>${esc(data.active_users)}${s?.max_users ? ` / ${esc(s.max_users)}` : ''}</dd><dt>Responsables</dt><dd>${data.contacts.map(c => `${esc(c.full_name)} (${esc(c.email)})`).join('<br>') || '—'}</dd></dl>
            <div class="sp-panel"><h3>Abonnement</h3>${can ? `<form id="sub-form"><div class="sp-grid2"><label>Forfait<select name="plan_id">${(s && !plans.items.some(p => Number(p.id) === Number(s.plan_id)) ? [{ id: s.plan_id, name: `${s.plan_name} (inactif)` }, ...plans.items] : plans.items).map(p => `<option value="${esc(p.id)}" ${s && Number(s.plan_id) === Number(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><label>Statut<select name="status">${['trialing', 'active', 'past_due', 'suspended', 'cancelled'].map(v => `<option value="${v}" ${s?.status === v ? 'selected' : ''}>${esc(labels[v][0])}</option>`).join('')}</select></label><label>Début de période<input type="date" name="period_start" value="${esc(s?.current_period_start || day(new Date().toISOString()))}"></label><label>Fin de période<input type="date" name="period_end" value="${esc(s?.current_period_end || '')}" required></label></div><p class="sp-error"></p><button class="sp-btn">Enregistrer l’abonnement</button></form>` : `<p>${s ? `${esc(s.plan_name)}${s.target_plan_name ? ` → ${esc(s.target_plan_name)}` : ''} ${tag(s.status)} jusqu’au ${esc(s.current_period_end)}` : 'Aucun abonnement.'}</p>`}</div>
            ${can ? `<div class="sp-actions">${['active', 'suspended', 'closed'].filter(v => v !== o.status).map(v => `<button class="sp-btn ${v === 'active' ? '' : 'danger'} small" data-status="${v}">${v === 'active' ? 'Réactiver le compte' : v === 'suspended' ? 'Suspendre le compte' : 'Fermer le compte'}</button>`).join('')}</div>` : ''}
            <div class="sp-panel"><h3>Dernières activités</h3><p><b>Tickets :</b> ${data.tickets.map(t => `#${esc(t.id)} ${esc(t.subject)} ${tag(t.status)}`).join(' · ') || '—'}</p><p><b>Réclamations :</b> ${data.claims.map(c => `${esc(c.reference)} ${tag(c.status)}`).join(' · ') || '—'}</p><p><b>Factures :</b> ${data.invoices.map(i => `${esc(i.invoice_number)} ${tag(i.status)}`).join(' · ') || '—'}</p></div>`;
            const form = m.body.querySelector('#sub-form');
            if (form) form.onsubmit = event => { event.preventDefault(); run(form.querySelector('button'), async () => { await send('PATCH', `/clients/${id}/subscription`, Object.fromEntries(new FormData(form))); toast('Abonnement mis à jour.'); m.close(); reload(); }, form.querySelector('.sp-error')); };
            m.body.querySelectorAll('[data-status]').forEach(button => button.onclick = () => { if (confirm('Confirmer le changement de statut du compte ?')) run(button, async () => { await send('PATCH', `/clients/${id}/status`, { status: button.dataset.status }); toast('Statut mis à jour.'); m.close(); reload(); }); });
        } catch (error) { m.body.innerHTML = `<p class="sp-error">${esc(error.message)}</p>`; }
    }

    async function clientOptions() {
        const data = await api('/clients?limit=100');
        return data.items.map(client => `<option value="${esc(client.id)}">${esc(client.name)}</option>`).join('');
    }

    async function invoiceForm(reload) {
        const m = modal('Nouvelle facture', '<p class="sp-muted">Chargement…</p>');
        const today = day(new Date().toISOString());
        m.body.innerHTML = `<form><label>Client<select name="organization_id" required>${await clientOptions()}</select></label><div class="sp-grid2"><label>Début de période<input type="date" name="period_start" value="${today}" required></label><label>Fin de période<input type="date" name="period_end" required></label><label>Montant<input type="number" name="subtotal" min="0" step="0.01" required></label><label>Remise<input type="number" name="discount_amount" min="0" step="0.01" value="0"></label><label>Échéance<input type="date" name="due_date" required></label></div><label>Notes<textarea name="notes" rows="2" maxlength="500"></textarea></label><p class="sp-error"></p><button class="sp-btn">Créer la facture</button></form>`;
        const form = m.body.querySelector('form');
        form.onsubmit = event => { event.preventDefault(); run(form.querySelector('button'), async () => { await send('POST', '/invoices', Object.fromEntries(new FormData(form))); toast('Facture créée.'); m.close(); reload(); }, form.querySelector('.sp-error')); };
    }

    async function claimForm(reload) {
        const m = modal('Nouvelle réclamation', '<p class="sp-muted">Chargement…</p>');
        m.body.innerHTML = `<form><label>Client<select name="organization_id" required>${await clientOptions()}</select></label><label>Objet<input name="subject" minlength="4" maxlength="190" required></label><div class="sp-grid2"><label>Catégorie<select name="category">${['billing', 'service', 'technical', 'other'].map(v => `<option value="${v}">${esc(labels[v][0])}</option>`).join('')}</select></label><label>Priorité<select name="priority">${['low', 'normal', 'high', 'urgent'].map(v => `<option value="${v}" ${v === 'normal' ? 'selected' : ''}>${esc(labels[v][0])}</option>`).join('')}</select></label></div><label>Description<textarea name="description" rows="5" minlength="10" maxlength="5000" required></textarea></label><p class="sp-error"></p><button class="sp-btn">Enregistrer</button></form>`;
        const form = m.body.querySelector('form');
        form.onsubmit = event => { event.preventDefault(); run(form.querySelector('button'), async () => { await send('POST', '/claims', Object.fromEntries(new FormData(form))); toast('Réclamation enregistrée.'); m.close(); reload(); }, form.querySelector('.sp-error')); };
    }

    async function claimDetail(id, reload) {
        const m = modal('Réclamation', '<p class="sp-muted">Chargement…</p>');
        try {
            const [data, staff] = await Promise.all([api(`/claims/${id}`), api('/staff')]);
            const c = data.claim, can = state.permissions.claims;
            m.body.innerHTML = `<dl class="sp-kv"><dt>Référence</dt><dd>${esc(c.reference)}</dd><dt>Client</dt><dd>${esc(c.organization_name)}</dd><dt>Objet</dt><dd>${esc(c.subject)}</dd><dt>Catégorie</dt><dd>${tag(c.category)}</dd><dt>Description</dt><dd>${esc(c.description).replace(/\n/g, '<br>')}</dd>${c.resolution ? `<dt>Résolution</dt><dd>${esc(c.resolution).replace(/\n/g, '<br>')}</dd>` : ''}</dl>
            ${can ? `<form id="claim-form"><div class="sp-grid2"><label>Statut<select name="status">${['open', 'in_progress', 'resolved', 'rejected'].map(v => `<option value="${v}" ${c.status === v ? 'selected' : ''}>${esc(labels[v][0])}</option>`).join('')}</select></label><label>Priorité<select name="priority">${['low', 'normal', 'high', 'urgent'].map(v => `<option value="${v}" ${c.priority === v ? 'selected' : ''}>${esc(labels[v][0])}</option>`).join('')}</select></label><label>Assignée à<select name="assigned_staff_id"><option value="">— Personne —</option>${staff.items.filter(s => s.is_active).map(s => `<option value="${esc(s.id)}" ${Number(c.assigned_staff_id) === Number(s.id) ? 'selected' : ''}>${esc(s.full_name)}</option>`).join('')}</select></label></div><label>Résolution / motif (obligatoire pour résoudre ou rejeter)<textarea name="resolution" rows="3" maxlength="5000">${esc(c.resolution || '')}</textarea></label><p class="sp-error"></p><button class="sp-btn">Mettre à jour</button></form>` : ''}
            <div class="sp-panel"><h3>Notes internes</h3><div class="sp-thread">${data.notes.map(n => `<div class="sp-msg"><small>${esc(n.full_name || 'Employé supprimé')} · ${esc(dateTime(n.created_at))}</small>${esc(n.note)}</div>`).join('') || '<span class="sp-muted">Aucune note.</span>'}</div>${can ? '<form id="note-form"><textarea name="note" rows="2" maxlength="5000" placeholder="Ajouter une note interne…" required></textarea><p class="sp-error"></p><button class="sp-btn secondary small">Ajouter la note</button></form>' : ''}</div>`;
            const form = m.body.querySelector('#claim-form');
            if (form) form.onsubmit = event => { event.preventDefault(); const body = Object.fromEntries(new FormData(form)); body.assigned_staff_id = body.assigned_staff_id || null; run(form.querySelector('button'), async () => { await send('PATCH', `/claims/${id}`, body); toast('Réclamation mise à jour.'); m.close(); reload(); }, form.querySelector('.sp-error')); };
            const noteForm = m.body.querySelector('#note-form');
            if (noteForm) noteForm.onsubmit = event => { event.preventDefault(); run(noteForm.querySelector('button'), async () => { await send('POST', `/claims/${id}/notes`, Object.fromEntries(new FormData(noteForm))); m.close(); claimDetail(id, reload); }, noteForm.querySelector('.sp-error')); };
        } catch (error) { m.body.innerHTML = `<p class="sp-error">${esc(error.message)}</p>`; }
    }

    async function ticketDetail(id, reload) {
        const m = modal('Demande de support', '<p class="sp-muted">Chargement…</p>');
        const refresh = () => { m.close(); ticketDetail(id, reload); reload(); };
        try {
            const can = state.permissions.support, admin = state.staff.role === 'PLATFORM_ADMIN';
            const [data, staff] = await Promise.all([api(`/support/${id}`), admin ? api('/staff') : { items: [] }]);
            const t = data.ticket;
            m.body.innerHTML = `<dl class="sp-kv"><dt>Client</dt><dd>${esc(t.organization_name)}</dd><dt>Demandeur</dt><dd>${esc(t.requester_name)} (${esc(t.requester_email)})</dd><dt>Objet</dt><dd>${esc(t.subject)} ${tag(t.status)}</dd><dt>Pris en charge par</dt><dd>${esc(t.assigned_name || '—')} ${t.assignment_type ? tag(t.assignment_type) : '<span class="sp-tag">Origine inconnue</span>'}</dd><dt>Durée de traitement</dt><dd>${t.assigned_staff_at && t.closed_at ? resolutionMinutes(new Date(t.closed_at) - new Date(t.assigned_staff_at)) : '—'}</dd></dl>
            <div class="sp-thread"><div class="sp-msg"><small>${esc(t.requester_name)} · ${esc(dateTime(t.created_at))}</small>${esc(t.message).replace(/\n/g, '<br>')}</div>${data.messages.map(msg => `<div class="sp-msg ${msg.is_staff ? 'staff' : ''}"><small>${esc(msg.full_name)} · ${esc(dateTime(msg.created_at))}</small>${esc(msg.message).replace(/\n/g, '<br>')}</div>`).join('')}</div>
            ${data.feedback ? `<div class="sp-panel"><h3>Avis du client · ${esc(data.feedback.rating)}/5</h3>${data.feedback.comment ? `<p>${esc(data.feedback.comment)}</p>` : '<p class="sp-muted">Aucun commentaire.</p>'}</div>` : ''}
            ${admin && t.status !== 'closed' ? `<form id="support-assign-form" class="sp-panel"><h3>Assignation obligatoire</h3><label>Employé<select name="assigned_staff_id"><option value="">— Retirer l’assignation —</option>${staff.items.filter(member => member.is_active).map(member => `<option value="${esc(member.id)}" ${Number(t.assigned_staff_id) === Number(member.id) ? 'selected' : ''}>${esc(member.full_name)}</option>`).join('')}</select></label><p class="sp-error"></p><button class="sp-btn secondary small">Enregistrer l’assignation</button></form>` : ''}
            ${can && t.status !== 'closed' ? `<form id="reply-form"><textarea name="message" rows="3" maxlength="5000" placeholder="Votre réponse…" required></textarea><p class="sp-error"></p><div class="sp-actions"><button class="sp-btn">Répondre</button>${!t.assigned_staff_id || Number(t.assigned_staff_id) !== Number(state.staff.id) ? '<button type="button" class="sp-btn secondary" data-claim>Prendre en charge</button>' : ''}<button type="button" class="sp-btn secondary" data-close>Clôturer</button></div></form>` : ''}
            ${can && t.status === 'closed' ? '<div class="sp-actions"><button class="sp-btn secondary" data-reopen>Rouvrir</button></div>' : ''}`;
            const assignmentForm = m.body.querySelector('#support-assign-form');
            if (assignmentForm) assignmentForm.onsubmit = event => {
                event.preventDefault();
                const body = Object.fromEntries(new FormData(assignmentForm)); body.assigned_staff_id = body.assigned_staff_id || null;
                run(assignmentForm.querySelector('button'), async () => { await send('PATCH', `/support/${id}/assignment`, body); toast('Assignation mise à jour.'); refresh(); }, assignmentForm.querySelector('.sp-error'));
            };
            const form = m.body.querySelector('#reply-form');
            if (form) {
                form.onsubmit = event => { event.preventDefault(); run(form.querySelector('button:not([type=button])'), async () => { await send('POST', `/support/${id}/messages`, Object.fromEntries(new FormData(form))); toast('Réponse envoyée.'); refresh(); }, form.querySelector('.sp-error')); };
                form.querySelector('[data-claim]')?.addEventListener('click', event => run(event.currentTarget, async () => { await send('POST', `/support/${id}/claim`); toast('Demande prise en charge.'); refresh(); }, form.querySelector('.sp-error')));
                form.querySelector('[data-close]').onclick = event => run(event.currentTarget, async () => { await send('PATCH', `/support/${id}/status`, { status: 'closed' }); toast('Demande clôturée.'); refresh(); }, form.querySelector('.sp-error'));
            }
            m.body.querySelector('[data-reopen]')?.addEventListener('click', event => run(event.currentTarget, async () => { await send('PATCH', `/support/${id}/status`, { status: 'in_progress' }); refresh(); }));
            const thread = m.body.querySelector('.sp-thread'); thread.scrollTop = thread.scrollHeight;
        } catch (error) { m.body.innerHTML = `<p class="sp-error">${esc(error.message)}</p>`; }
    }

    const resolutionMinutes = milliseconds => {
        const minutes = Math.max(0, Math.round(milliseconds / 60000));
        return `${minutes.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} min`;
    };

    function staffForm(member, reload) {
        const m = modal(member ? 'Modifier l’employé' : 'Nouvel employé', `<form><label>Nom complet<input name="full_name" maxlength="180" required value="${esc(member?.full_name || '')}"></label>${member ? '' : '<label>Adresse e-mail<input type="email" name="email" required></label><label>Mot de passe (12 caractères minimum)<input type="password" name="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>'}<div class="sp-grid2"><label>Rôle<select name="role">${['PLATFORM_ADMIN', 'SUPPORT', 'BILLING', 'VIEWER'].map(v => `<option value="${v}" ${(member?.role || 'SUPPORT') === v ? 'selected' : ''}>${esc(labels[v][0])}</option>`).join('')}</select></label><label>Fonction<input name="job_title" maxlength="120" value="${esc(member?.job_title || '')}"></label><label>Téléphone<input name="phone" maxlength="40" value="${esc(member?.phone || '')}"></label>${member ? `<label>Compte<select name="is_active"><option value="1" ${member.is_active ? 'selected' : ''}>Actif</option><option value="0" ${member.is_active ? '' : 'selected'}>Désactivé</option></select></label>` : ''}</div><p class="sp-error"></p><button class="sp-btn">Enregistrer</button></form>`, true);
        const form = m.body.querySelector('form');
        form.onsubmit = event => {
            event.preventDefault(); const body = Object.fromEntries(new FormData(form)); if (member) body.is_active = body.is_active === '1';
            run(form.querySelector('button'), async () => { await (member ? send('PATCH', `/staff/${member.id}`, body) : send('POST', '/staff', body)); toast('Employé enregistré.'); m.close(); reload(); }, form.querySelector('.sp-error'));
        };
    }

    function scheduleForm(member, reload) {
        const rows = member.shifts.length ? member.shifts.map(shift => ({ ...shift })) : [{ weekday: 1, start_time: '08:00', end_time: '17:00' }];
        const m = modal(`Horaires · ${member.full_name}`, '');
        const draw = () => {
            m.body.innerHTML = `<form>${rows.map((row, index) => `<div class="sp-shift-row"><label>Jour<select data-k="weekday" data-i="${index}">${DAYS.map((name, d) => `<option value="${d + 1}" ${Number(row.weekday) === d + 1 ? 'selected' : ''}>${name}</option>`).join('')}</select></label><label>Début<input type="time" data-k="start_time" data-i="${index}" value="${esc(row.start_time)}" required></label><label>Fin<input type="time" data-k="end_time" data-i="${index}" value="${esc(row.end_time)}" required></label><button type="button" class="sp-btn secondary small" data-del="${index}" aria-label="Supprimer la plage">✕</button></div>`).join('') || '<p class="sp-muted">Aucune plage : l’employé est toujours hors service.</p>'}<div class="sp-actions"><button type="button" class="sp-btn secondary" data-add>＋ Ajouter une plage</button></div><p class="sp-error"></p><button class="sp-btn">Enregistrer les horaires</button></form>`;
            const form = m.body.querySelector('form');
            form.querySelectorAll('[data-k]').forEach(input => input.onchange = () => { rows[input.dataset.i][input.dataset.k] = input.dataset.k === 'weekday' ? Number(input.value) : input.value; });
            form.querySelectorAll('[data-del]').forEach(button => button.onclick = () => { rows.splice(Number(button.dataset.del), 1); draw(); });
            form.querySelector('[data-add]').onclick = () => { rows.push({ weekday: 1, start_time: '08:00', end_time: '17:00' }); draw(); };
            form.onsubmit = event => { event.preventDefault(); run(form.querySelector('button[type=submit],button:not([type])'), async () => { await send('PUT', `/staff/${member.id}/schedule`, { shifts: rows.map(row => ({ weekday: Number(row.weekday), start_time: row.start_time, end_time: row.end_time })) }); toast('Horaires enregistrés.'); m.close(); reload(); }, form.querySelector('.sp-error')); };
        };
        draw();
    }

    async function tokenForm(reload) {
        const m = modal('Nouvelle clé API', '<p class="sp-muted">Chargement…</p>', true);
        m.body.innerHTML = `<form><label>Client<select name="organization_id" required>${await clientOptions()}</select></label><label>Nom de la clé<input name="name" minlength="2" maxlength="120" placeholder="Ex. Intégration comptabilité" required></label><label>Expiration (optionnelle)<input type="date" name="expires_at"></label><p class="sp-error"></p><button class="sp-btn">Générer la clé</button></form>`;
        const form = m.body.querySelector('form');
        form.onsubmit = event => {
            event.preventDefault(); const body = Object.fromEntries(new FormData(form)); if (!body.expires_at) delete body.expires_at;
            run(form.querySelector('button'), async () => { const data = await send('POST', '/tokens', body); m.body.innerHTML = `<p>${esc(data.message)}</p><code class="sp-token">${esc(data.token)}</code><div class="sp-actions"><button class="sp-btn" data-copy>Copier</button><button class="sp-btn secondary" data-done>Terminé</button></div>`; m.body.querySelector('[data-copy]').onclick = () => navigator.clipboard?.writeText(data.token).then(() => toast('Clé copiée.')); m.body.querySelector('[data-done]').onclick = () => { m.close(); reload(); }; }, form.querySelector('.sp-error'));
        };
    }

    function passwordForm() {
        const m = modal('Changer mon mot de passe', '<form><label>Mot de passe actuel<input type="password" name="current_password" autocomplete="current-password" required></label><label>Nouveau mot de passe (12 caractères minimum)<input type="password" name="new_password" minlength="12" maxlength="128" autocomplete="new-password" required></label><p class="sp-error"></p><button class="sp-btn">Modifier</button></form>', true);
        const form = m.body.querySelector('form');
        form.onsubmit = event => { event.preventDefault(); run(form.querySelector('button'), async () => { await send('PUT', '/me/password', Object.fromEntries(new FormData(form))); sessionStorage.removeItem(TOKEN_KEY); m.close(); showLogin(); toast('Mot de passe modifié. Reconnectez-vous.'); }, form.querySelector('.sp-error')); };
    }

    const openMenu = () => { $('#sp-sidebar').classList.add('open'); $('#sp-backdrop').hidden = false; };
    const closeMenu = () => { $('#sp-sidebar').classList.remove('open'); $('#sp-backdrop').hidden = true; };

    function showLogin() { $('#app-view').hidden = true; $('#login-view').hidden = false; }

    async function showApp() {
        const me = await api('/me');
        state.staff = me.staff; state.permissions = me.permissions;
        $('#sp-who').textContent = `${me.staff.full_name} · ${labels[me.staff.role]?.[0] || me.staff.role}`;
        $('#sp-available').checked = me.staff.is_available;
        $('#sp-nav').innerHTML = NAV.filter(item => item[2] !== 'admin' || me.staff.role === 'PLATFORM_ADMIN').map(([page, title]) => `<button type="button" data-page="${page}">${esc(title)}</button>`).join('');
        $('#login-view').hidden = true; $('#app-view').hidden = false;
        go(location.hash.slice(1) || 'dashboard');
    }

    $('#login-form').onsubmit = event => {
        event.preventDefault();
        const form = event.currentTarget, error = $('#login-error'); error.textContent = '';
        run(form.querySelector('button'), async () => { const data = await send('POST', '/login', Object.fromEntries(new FormData(form))); sessionStorage.setItem(TOKEN_KEY, data.token); form.reset(); await showApp(); }, error);
    };
    $('#sp-nav').onclick = event => { const button = event.target.closest('[data-page]'); if (button) go(button.dataset.page); };
    $('#sp-menu').onclick = openMenu; $('#sp-backdrop').onclick = closeMenu;
    $('#sp-logout').onclick = () => { sessionStorage.removeItem(TOKEN_KEY); showLogin(); };
    $('#sp-password').onclick = passwordForm;
    $('#sp-available').onchange = event => send('PUT', '/me/availability', { is_available: event.target.checked }).catch(error => { toast(error.message, true); event.target.checked = !event.target.checked; });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { const overlay = document.querySelector('.sp-overlay:last-of-type'); if (overlay) overlay.remove(); else closeMenu(); } });

    if (sessionStorage.getItem(TOKEN_KEY)) showApp().catch(() => showLogin()); else showLogin();
})();
