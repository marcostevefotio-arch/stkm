(() => {
    const token = sessionStorage.getItem('redams_token'); if (!token) { location.replace('/'); return; } const $ = s => document.querySelector(s), H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, state = { products: [], settings: {}, modules: null, legalSettings: null };
    async function api(url, opt = {}) { let r; try { r = await fetch(url, { ...opt, headers: { ...H, ...opt.headers } }); } catch (error) { if (error.name === 'AbortError') throw Error('La requête a expiré. Réessayez dans quelques instants.'); if (error instanceof TypeError) throw Error('Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.'); throw Error('Une erreur inattendue a interrompu la requête. Réessayez.'); } if (r.status === 401) { sessionStorage.removeItem('redams_token'); location.replace('/'); throw Error('Session invalide ou expirée.'); } let d; try { d = (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.blob(); } catch (error) { throw Error('Le serveur a renvoyé une réponse illisible. Réessayez ou contactez votre administrateur.'); } if (!r.ok) { const failure = Error(d.error || 'La requête n’a pas pu aboutir.'); failure.status = r.status; throw failure; } return d; }
    function toast(t, type) { const message = String(t), normalized = message.toLocaleLowerCase('fr'); const kind = type || (/à vérifier|a vérifier|vérifiez|vérification professionnelle|signalement|récurrence|récidive|aucun produit actif|une commande doit contenir|une vente doit contenir/.test(normalized) ? 'warning' : /erreur|échec|echec|impossible|invalide|non autoris|inconnu|introuvable|indisponible|refus|échoué|failed|invalid|forbidden|expired|requis|requise|obligatoire|doit|doivent|aucun|aucune|n'est pas|n’est pas|sélectionnez|ajoutez|caisse est fermée|insuffisant|manquant/.test(normalized) ? 'error' : 'success'); const element = $('#toast'); element.textContent = message; element.classList.remove('toast-success', 'toast-warning', 'toast-error'); element.classList.add(`toast-${kind}`, 'show'); setTimeout(() => element.classList.remove('show'), 2400); }
    function updateSidebarClock() { const now = new Date(); $('#sidebar-date').textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(now); $('#sidebar-time').textContent = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' }).format(now); }
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function parseModuleList(value) {
        if (value === null || value === undefined) return null;
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string') return [];
        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
        catch { return []; }
    }
    const canAccessPage = page => window.RedamsAccess.canAccessPage(state.profile, state.settings, page);
    function refreshAccess() {
        if (state.profile) {
            state.profile.merge_pharmacist_storekeeper = state.settings.merge_pharmacist_storekeeper;
            state.canAccessPatientRecords = window.RedamsAccess.hasRole(state.profile, 'OWNER', 'ADMIN', 'PHARMACIST');
            state.canOperateSales = window.RedamsAccess.hasRole(state.profile, 'OWNER', 'ADMIN', 'PHARMACIST', 'CASHIER');
            $('#user').textContent = state.profile.full_name + ' · ' + (window.RedamsAccess.roleLabel(state.profile) || state.profile.role);
        }
        document.querySelectorAll('.sidebar [data-page]').forEach(link => { link.hidden = !canAccessPage(link.dataset.page); });
        document.querySelectorAll('.sidebar nav details').forEach(group => {
            group.hidden = ![...group.querySelectorAll('[data-page]')].some(link => !link.hidden);
        });
        document.querySelectorAll('[data-go]').forEach(button => { button.hidden = !canAccessPage(button.dataset.go); });
        $('#global-search-form').hidden = !['stock', 'procurement', 'patients'].some(feature => window.RedamsAccess.canAccessModule(state.profile, feature));
        document.querySelector('.sidebar nav').hidden = false;
    }
    function dateInputValue(value) {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        const text = String(value), matched = text.match(/^(\d{4}-\d{2}-\d{2})/);
        if (matched) return matched[1];
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
    function safeLogoUrl(url) {
        if (typeof url !== 'string' || !url.trim()) return '';
        try { const logoUrl = new URL(url, location.origin); return logoUrl.origin === location.origin || logoUrl.protocol === 'https:' ? logoUrl.href : ''; }
        catch { return ''; }
    }
    function updateTenantLogo(url) {
        const image = $('#tenant-logo'), fallback = $('#tenant-logo-fallback');
        const safeUrl = safeLogoUrl(url);
        if (!safeUrl) { image.hidden = true; fallback.hidden = false; return; }
        image.onerror = () => { image.hidden = true; fallback.hidden = false; };
        image.src = safeUrl; image.hidden = false; fallback.hidden = true;
    }
    updateSidebarClock(); setInterval(updateSidebarClock, 1000);
    async function boot() {
        try {
            const me = await api('/api/auth/me');
            $('#tenant').textContent = me.user.organization_name; $('#user').textContent = me.user.full_name + ' · ' + me.user.role;
            if (me.user.role === 'ACCOUNTANT') {
                state.role = me.user.role; state.userId = Number(me.user.id); state.profile = me.user;
                state.modules = parseModuleList(me.user.subscription_modules);
                state.canAdminister = false; state.canAccounting = true;
                document.querySelectorAll('.sidebar nav > a, .sidebar nav > details').forEach(item => { item.hidden = !item.hasAttribute('data-accounting-nav'); });
                document.querySelector('[data-accounting-nav]').hidden = false;
                const securityLink = document.createElement('a');
                securityLink.dataset.page = 'security'; securityLink.textContent = 'Changer mon mot de passe';
                document.querySelector('.sidebar nav').append(securityLink);
                refreshAccess();
                $('#global-search-form').hidden = true;
                document.querySelector('.alert-wrap').hidden = true;
                document.querySelector('.notification-wrap').hidden = true;
                document.querySelector('[data-user-action="profile"]').hidden = true;
                document.querySelectorAll('[data-admin-only]').forEach(item => { item.hidden = true; });
                $('#plan').textContent = 'Accès comptable'; $('#period').textContent = '';
                try {
                    state.settings = await api('/api/accounting/context');
                    const hash = location.hash.slice(1);
                    go(hash === 'settings/security' ? 'security' : Object.hasOwn(accountingPages, hash) ? hash : 'accounting-results');
                } catch (error) {
                    $('#content').innerHTML = `<section class="panel"><p class="error" role="alert">${esc(error.message)}</p></section>`;
                }
                return;
            }
            const [settingsData, subscription] = await Promise.all([api('/api/settings'), api('/api/subscription')]);
            state.settings = settingsData;
            try { state.legalSettings = await api('/api/public/legal-documents'); }
            catch (error) { console.error('Chargement des préférences des documents légaux impossible.', error); }
            if (settingsData.primary_color) document.documentElement.style.setProperty('--primary', settingsData.primary_color);
            if (settingsData.secondary_color) document.documentElement.style.setProperty('--accent', settingsData.secondary_color);
            updateTenantLogo(settingsData.logo_url);
            $('#plan').textContent = subscription ? subscription.plan_name + (subscription.target_plan_name ? ' → ' + subscription.target_plan_name : '') + ' · ' + subscription.status : 'Aucun abonnement';
            $('#period').textContent = subscription ? 'Échéance : ' + new Date(subscription.current_period_end).toLocaleDateString('fr-FR') : '';
            $('#date').textContent = new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' });
            const role = me.user.role;
            state.role = role; state.userId = Number(me.user.id);
            state.modules = parseModuleList(me.user.subscription_modules);
            state.canAdminister = ['OWNER', 'ADMIN'].includes(role);
            state.canAccounting = state.canAdminister;
            document.querySelector('[data-accounting-nav]').hidden = !state.canAdminister || (state.modules !== null && !state.modules.includes('reports'));
            state.profile = me.user;
            document.querySelectorAll('[data-admin-only]').forEach(item => { item.hidden = !['OWNER', 'ADMIN', 'SUPER_ADMIN'].includes(role); });
            loadAlerts();
            state.canSendNotifications = state.canAdminister;
            if (!state.canAdminister) {
                const securityLink = document.createElement('a');
                securityLink.dataset.page = 'security'; securityLink.textContent = 'Changer mon mot de passe';
                document.querySelector('.sidebar nav').append(securityLink);
            }
            refreshAccess();
            $('#notification-compose').hidden = !state.canSendNotifications;
            const hash = location.hash.slice(1);
            if (hash) go(hash); else go('dashboard');
            await refreshNotifications();
        } catch (error) { toast(error.message, 'error'); }
    }
    const dashboardTemplate = $('#content').innerHTML;
    const accountingPages = {
        'accounting-results': 'État des résultats',
        'accounting-balance': 'Bilan comptable',
        'accounting-journal': 'Journal comptable',
        'accounting-ledger': 'Grand livre général',
        'accounting-cashflow': 'Tableau de flux de trésorerie',
        'accounting-tax': 'Rapport de taxes',
        'accounting-review': 'Révision comptable'
    };
    let accountingLoader;
    function loadAccounting() {
        if (!accountingLoader) accountingLoader = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/js/accounting.js';
            script.onload = () => resolve(window.RedamsAccounting);
            script.onerror = () => { accountingLoader = null; script.remove(); reject(Error('Impossible de charger le module comptable.')); };
            document.head.append(script);
        });
        return accountingLoader;
    }
    async function dashboard() {
        const root = $('#content');
        if (!canAccessPage('products')) {
            root.innerHTML = `<div class="panel"><h3>Bienvenue, ${esc(state.profile.full_name)}</h3><p>Accédez aux modules autorisés pour votre rôle.</p><div class="quick">${[['pos', 'Nouvelle vente'], ['invoices', 'Factures & reçus'], ['cash', 'Recettes & caisse'], ['patients', 'Dossiers patients'], ['help', 'Assistance']].filter(([page]) => canAccessPage(page)).map(([page, label]) => `<button type="button" data-go="${page}">${label}</button>`).join('')}</div></div>`;
            state.products = [];
            return;
        }
        if (!root.querySelector('#productsCount')) root.innerHTML = dashboardTemplate;
        refreshAccess();
        $('#date').textContent = new Date().toLocaleDateString('fr-FR', { dateStyle: 'long' });
        const d = await api('/api/dashboard');
        if (!root.isConnected || !root.querySelector('#productsCount')) return;
        $('#productsCount').textContent = d.stock_available === false ? '—' : d.products;
        $('#unitsCount').textContent = d.stock_available === false ? '—' : d.stockUnits;
        $('#lowCount').textContent = d.stock_available === false ? '—' : d.lowStock;
        $('#movesCount').textContent = d.stock_available === false ? '—' : d.movementsToday;
        if (d.stock_available === false) {
            state.products = [];
            $('#lowList').textContent = 'La gestion de stock n’est pas incluse dans votre forfait.';
            return;
        }
        state.products = await api('/api/products');
        if (!root.querySelector('#lowList')) return;
        const low = state.products.filter(p => +p.quantity_on_hand <= +p.reorder_level);
        $('#lowList').innerHTML = low.length ? low.slice(0, 6).map(p => `<div class="row"><span><b>${esc(p.name)}</b><small>${esc(p.sku)} · Seuil ${p.reorder_level}</small></span><strong>${p.quantity_on_hand} ${esc(p.unit)}</strong></div>`).join('') : 'Aucune alerte de stock.';
    }
    const titles = { dashboard: 'Tableau de bord', products: 'Catalogue produits', movements: 'Mouvements de stock', alerts: 'Alertes de stock', settings: 'Paramètres généraux & identité', suppliers: 'Fournisseurs', purchases: 'Commandes & réceptions', patients: 'Dossiers patients', insurers: 'Assurances', pos: 'Point de vente', invoices: 'Factures & reçus', cash: 'Recettes & caisse', reports: 'Rapports & analyses', users: 'Utilisateurs & rôles', audit: "Journal d'activité", backup: 'Sauvegarde & restauration', security: 'Sécurité & mot de passe', codes: 'QR & codes-barres', search: 'Index de recherche', help: 'Assistance', platform: 'Administration SaaS' };
    function mountDataTable(container, { rows, columns, searchText, filters = [], emptyMessage = 'Aucun résultat.', pageSize = 10 }) {
        let page = 0, sortIndex = 0, sortDirection = 1, query = '';
        const filterValues = filters.map(() => '');
        const search = document.createElement('input'); search.type = 'search'; search.className = 'table-search'; search.placeholder = searchText; search.setAttribute('aria-label', searchText);
        const controls = document.createElement('div'); controls.className = 'table-controls'; controls.append(search);
        filters.forEach((filter, index) => { const select = document.createElement('select'); select.setAttribute('aria-label', filter.label); select.innerHTML = `<option value="">${esc(filter.label)} : Tous</option>${filter.options.map(option => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('')}`; select.addEventListener('change', () => { filterValues[index] = select.value; page = 0; render(); }); controls.append(select); });
        const pageSizeSelect = document.createElement('select'); pageSizeSelect.setAttribute('aria-label', 'Lignes par page'); pageSizeSelect.innerHTML = '<option value="10">10 lignes</option><option value="25">25 lignes</option><option value="50">50 lignes</option>'; pageSizeSelect.value = String(pageSize); pageSizeSelect.addEventListener('change', () => { pageSize = Number(pageSizeSelect.value); page = 0; render(); }); controls.append(pageSizeSelect);
        const wrap = document.createElement('div'); wrap.className = 'tablewrap'; const table = document.createElement('table'); table.className = 'responsive-table'; const head = document.createElement('thead'), body = document.createElement('tbody'); const headerRow = document.createElement('tr');
        columns.forEach((column, index) => { const th = document.createElement('th'); if (column.sortValue) { const button = document.createElement('button'); button.type = 'button'; button.className = 'table-sort'; button.textContent = column.label; button.addEventListener('click', () => { if (sortIndex === index) sortDirection *= -1; else { sortIndex = index; sortDirection = 1; } render(); }); th.append(button); } else th.textContent = column.label; headerRow.append(th); });
        head.append(headerRow); table.append(head, body); wrap.append(table);
        const footer = document.createElement('div'); footer.className = 'table-footer'; const status = document.createElement('span'), previous = document.createElement('button'), next = document.createElement('button'); previous.type = next.type = 'button'; previous.className = next.className = 'table-page'; previous.textContent = 'Précédent'; next.textContent = 'Suivant'; previous.addEventListener('click', () => { page = Math.max(0, page - 1); render(); }); next.addEventListener('click', () => { page += 1; render(); }); footer.append(status, previous, next);
        container.replaceChildren(controls, wrap, footer); search.addEventListener('input', () => { query = search.value.trim().toLocaleLowerCase('fr'); page = 0; render(); });
        function render() {
            const filtered = rows.filter(row => row.searchText.toLocaleLowerCase('fr').includes(query) && filters.every((filter, index) => !filterValues[index] || String(filter.value(row)) === filterValues[index]));
            if (columns[sortIndex]?.sortValue) filtered.sort((a, b) => { const left = columns[sortIndex].sortValue(a), right = columns[sortIndex].sortValue(b); return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), 'fr', { numeric: true, sensitivity: 'base' })) * sortDirection; });
            const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pageCount - 1);
            const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
            body.innerHTML = visible.length ? visible.map(row => `<tr>${columns.map(column => `<td data-label="${esc(column.label)}"><div class="cell-content">${column.render(row)}</div></td>`).join('')}</tr>`).join('') : `<tr><td class="table-empty" colspan="${columns.length}">${esc(emptyMessage)}</td></tr>`;
            status.textContent = filtered.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, filtered.length)} sur ${filtered.length}` : emptyMessage;
            previous.disabled = page === 0; next.disabled = (page + 1) * pageSize >= filtered.length;
        }
        render();
    }
    function closeOpenModals() {
        state.closingModals = true;
        try {
            document.querySelectorAll('.overlay').forEach(overlay => {
                overlay.querySelector('.close')?.click();
                overlay.remove();
            });
        } finally { state.closingModals = false; }
    }
    function go(page, query = '') {
        closeOpenModals();
        const settingsPage = page.startsWith('settings/');
        const accessPage = page.startsWith('global-search') ? 'global-search' : settingsPage && page !== 'settings/patients' ? page.slice('settings/'.length) : page;
        const legalDocumentsAccess = settingsPage && accessPage === 'legal-documents' && state.legalSettings?.show_authenticated_links;
        if (!canAccessPage(accessPage) && !legalDocumentsAccess) {
            toast('Vous n’avez pas accès à ce module.', 'error');
            page = state.role === 'ACCOUNTANT' ? 'accounting-results' : 'dashboard';
        } else if (settingsPage) {
            page = page.slice('settings/'.length);
        }
        if (state.role === 'ACCOUNTANT' && page !== 'security' && !Object.hasOwn(accountingPages, page)) {
            toast('Ce compte est limité à la comptabilité.', 'error');
            return;
        }
        if (Object.hasOwn(accountingPages, page)) {
            if (state.modules !== null && !state.modules.includes('reports')) { toast('Cette fonctionnalité n’est pas comprise dans votre forfait.', 'error'); page = 'dashboard'; }
            else if (!state.canAccounting) { toast('Accès réservé aux administrateurs et experts comptables de l’établissement.', 'error'); page = 'dashboard'; }
            else {
                document.querySelectorAll('[data-page]').forEach(link => { const active = link.dataset.page === page; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
                document.querySelector('[data-accounting-nav]').open = true;
                $('#title').textContent = accountingPages[page];
                location.hash = page;
                if (['accounting-results', 'accounting-balance', 'accounting-journal', 'accounting-ledger', 'accounting-cashflow', 'accounting-tax', 'accounting-review'].includes(page)) {
                    $('#content').innerHTML = '<section class="panel"><p>Chargement…</p></section>';
                    loadAccounting().then(render => { if (location.hash === `#${page}`) return (page === 'accounting-balance' ? render.balance : page === 'accounting-journal' ? render.journal : page === 'accounting-ledger' ? render.ledger : page === 'accounting-cashflow' ? render.cashflow : page === 'accounting-tax' ? render.tax : page === 'accounting-review' ? render.review : render)($('#content'), api, esc, state.settings.currency || 'XAF', state.role); })
                        .catch(error => { if (location.hash === `#${page}`) $('#content').innerHTML = `<section class="panel"><p class="error" role="alert">${esc(error.message)}</p></section>`; });
                    return;
                }
                $('#content').innerHTML = `<section class="panel"><h3>${esc(accountingPages[page])}</h3><p>Ce sous-module comptable n’est pas encore disponible. Aucun état financier ou fiscal ne peut être produit pour le moment.</p><p>La mise en place nécessite notamment un plan de comptes, des écritures équilibrées, des soldes d’ouverture et la clôture des périodes.</p></section>`;
                return;
            }
        }
        const pageFeatures = { products: 'stock', movements: 'stock', alerts: 'stock', codes: 'stock', suppliers: 'procurement', purchases: 'procurement', pos: 'sales', invoices: 'sales', cash: 'cash', patients: 'patients', insurers: 'patients', reports: 'reports', audit: 'administration' };
        if (state.modules && pageFeatures[page] && !state.modules.includes(pageFeatures[page])) {
            toast('Cette fonctionnalité n’est pas comprise dans votre forfait.', 'error');
            page = 'dashboard';
        }
        if (page === 'platform') {
            $('#title').textContent = titles.platform;
            location.hash = page;
            $('#content').innerHTML = '<div class="panel"><h3>Administration déplacée</h3><p>L’administration de la plateforme est désormais disponible uniquement dans le <a href="/portal">portail employé</a>, avec un compte administrateur de la plateforme.</p></div>';
            return;
        }
        if (page.startsWith('global-search')) {
            const searchTerm = page.includes('?') ? new URLSearchParams(page.split('?').slice(1).join('?')).get('q') || '' : query;
            document.querySelectorAll('[data-page]').forEach(link => { link.classList.remove('active'); link.removeAttribute('aria-current'); });
            $('#title').textContent = 'Recherche générale'; $('#global-search-input').value = searchTerm; location.hash = searchTerm ? `global-search?q=${encodeURIComponent(searchTerm)}` : 'global-search'; searchPage($('#content'), searchTerm); return;
        }
        const settingsTabs = ['settings', 'tax', 'workflow', 'roles', 'backup', 'security', 'codes', 'search', 'legal-documents'];
        if (settingsTabs.includes(page) || (settingsPage && page === 'patients')) { const activeTab = page === 'settings' ? 'general' : page; document.querySelectorAll('[data-page]').forEach(a => { const active = a.dataset.page === 'settings' || (page === 'security' && a.dataset.page === 'security'); a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); $('#title').textContent = 'Paramètres'; location.hash = page === 'settings' ? 'settings' : `settings/${page}`; settings($('#content'), activeTab); return; }
        if (page === 'insurers' || page.startsWith('insurers/')) {
            const activeTab = page === 'insurers/coverages' ? 'coverages' : 'organizations';
            document.querySelectorAll('[data-page]').forEach(a => { const active = a.dataset.page === 'insurers'; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
            document.querySelectorAll('.sidebar nav details').forEach(group => { if (group.querySelector('[data-page="insurers"]')) group.open = true; });
            $('#title').textContent = titles.insurers; location.hash = activeTab === 'organizations' ? 'insurers' : 'insurers/coverages'; insurers($('#content'), activeTab); return;
        }
        document.querySelectorAll('[data-page]').forEach(a => { const active = a.dataset.page === page; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
        document.querySelectorAll('.sidebar nav details').forEach(group => { if (group.querySelector(`[data-page="${page}"]`)) group.open = true; });
        $('#title').textContent = titles[page] || page; location.hash = page; const root = $('#content'); if (page === 'dashboard') dashboard(); else if (page === 'products') products(root); else if (page === 'movements') movements(root); else if (page === 'alerts') alerts(root); else if (page === 'suppliers') suppliers(root); else if (page === 'purchases') purchases(root); else if (page === 'patients') patients(root); else if (page === 'insurers') insurers(root); else if (page === 'pos') salesPOS(root); else if (page === 'invoices') salesInvoices(root); else if (page === 'cash') cashRegister(root); else if (page === 'reports') reports(root); else if (page === 'users' || page === 'audit') adminModule(root, page); else if (page === 'help') support(root); else if (page === 'platform') platformModule(root); else placeholder(root, page);
    }
    const adminRoleLabels = { OWNER: 'Propriétaire', ADMIN: 'Administrateur', PHARMACIST: 'Pharmacien', STOREKEEPER: 'Gestionnaire de stock', CASHIER: 'Caissier', VIEWER: 'Consultation seule', ACCOUNTANT: 'Expert-comptable' };
    const displayRole = role => window.RedamsAccess.roleLabel({ role, merge_pharmacist_storekeeper: state.settings.merge_pharmacist_storekeeper }) || adminRoleLabels[role] || role;
    async function adminModule(root, activeTab = 'users') {
        if (!state.canAdminister) { root.innerHTML = '<div class="panel"><h3>Accès réservé</h3><p class="error">Cette section est accessible aux propriétaires et administrateurs de l’établissement.</p></div>'; return; }
        root.innerHTML = `<div class="settings-page"><div class="settings-tabs" role="tablist" aria-label="Administration"><button type="button" class="settings-tab${activeTab === 'users' ? ' active' : ''}" id="admin-tab-users" role="tab" aria-selected="${activeTab === 'users'}" aria-controls="admin-panel-users" data-admin-tab="users">Utilisateurs & rôles</button><button type="button" class="settings-tab${activeTab === 'profiles' ? ' active' : ''}" id="admin-tab-profiles" role="tab" aria-selected="${activeTab === 'profiles'}" aria-controls="admin-panel-profiles" data-admin-tab="profiles">Profils d’accès</button><button type="button" class="settings-tab${activeTab === 'audit' ? ' active' : ''}" id="admin-tab-audit" role="tab" aria-selected="${activeTab === 'audit'}" aria-controls="admin-panel-audit" data-admin-tab="audit">Journal d’activité</button></div><section id="admin-panel-${activeTab}" role="tabpanel" aria-labelledby="admin-tab-${activeTab}"></section></div>`;
        if (state.modules && !state.modules.includes('administration')) {
            root.querySelector('[data-admin-tab="audit"]')?.remove();
            if (activeTab === 'audit') return adminModule(root, 'users');
        }
        const panel = root.querySelector(`#admin-panel-${activeTab}`);
        root.querySelectorAll('[data-admin-tab]').forEach(button => button.onclick = () => {
            const tab = button.dataset.adminTab;
            root.querySelectorAll('[data-admin-tab]').forEach(item => { const selected = item === button; item.classList.toggle('active', selected); item.setAttribute('aria-selected', String(selected)); });
            const activePage = tab === 'profiles' ? 'users' : tab;
            document.querySelectorAll('[data-page="users"],[data-page="audit"]').forEach(link => { const selected = link.dataset.page === activePage; link.classList.toggle('active', selected); if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current', 'page'); });
            $('#title').textContent = titles[activePage];
            location.hash = activePage; adminModule(root, tab);
        });
        if (activeTab === 'audit') { await renderAudit(panel); return; }
        if (activeTab === 'profiles') { renderAccessProfiles(panel); return; }
        await renderUsers(panel);
    }
    function renderAccessProfiles(panel) {
        const merged = Number(state.settings.merge_pharmacist_storekeeper) === 1;
        const profiles = [['OWNER', 'Propriétaire — accès complet et gestion des administrateurs.'], ['ADMIN', 'Administrateur — gestion opérationnelle et des comptes non privilégiés.'], ['PHARMACIST', merged ? 'Ventes, patients, stocks et approvisionnements. Caisse uniquement en un temps, sans encaissement des ventes préparées.' : 'Pharmacien — ventes, patients et antécédents médicaux.'], ['STOREKEEPER', 'Gestionnaire de stock — produits, mouvements et approvisionnements.'], ['CASHIER', 'Caissier — ventes et opérations de caisse.'], ['VIEWER', 'Consultation seule — aucune opération métier autorisée.'], ['ACCOUNTANT', 'Expert-comptable — accès à la comptabilité de cet établissement et à son mot de passe. Les rapports restent expérimentaux.']].filter(([role]) => !merged || role !== 'STOREKEEPER');
        panel.innerHTML = `<div class="panel admin-role-guide"><h3>Profils d’accès</h3><div class="admin-role-grid">${profiles.map(([role, description]) => `<article><b>${displayRole(role)}</b><p>${description}</p></article>`).join('')}</div><p class="admin-security-note">Un compte propriétaire ou administrateur ne peut être modifié que par un propriétaire. Le dernier propriétaire actif ne peut pas être désactivé. Les comptes sont désactivés et conservés dans le journal, jamais supprimés. ${merged ? 'Les rôles d’origine Pharmacien et Gestionnaire de stock sont conservés ; leurs droits sont actuellement fusionnés.' : ''}</p></div>`;
    }
    async function renderUsers(panel) {
        panel.innerHTML = '<div class="panel"><p class="notification-empty">Chargement des utilisateurs…</p></div>';
        try {
            const data = await api('/api/admin/users'); if (!panel.isConnected) return;
            const users = data.users, canManagePrivileged = state.role === 'OWNER', quota = data.quota;
            panel.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Utilisateurs & rôles</h3><p>Gérez les accès des membres de cet établissement. Les changements de rôle prennent effet à leur prochaine requête.</p>${quota ? `<p class="admin-quota">Comptes actifs : <b>${quota.active_users}</b> / ${quota.max_users} selon l’abonnement.</p>` : ''}</div><button class="btn" type="button" data-add-user>＋ Nouvel utilisateur</button></div><div data-users-table></div></div>`;
            const table = panel.querySelector('[data-users-table]');
            mountDataTable(table, {
                rows: users.map(user => ({ ...user, searchText: `${user.full_name} ${user.email} ${displayRole(user.role)} ${adminRoleLabels[user.role] || user.role} ${user.is_active ? 'actif' : 'désactivé'}` })), searchText: 'Rechercher par nom, e-mail ou rôle…', filters: [{ label: 'Rôle d’origine', options: [...new Set(users.map(user => user.role))].map(role => ({ value: role, label: adminRoleLabels[role] || role })), value: user => user.role }, { label: 'Statut', options: [{ value: 'active', label: 'Actif' }, { value: 'inactive', label: 'Désactivé' }], value: user => user.is_active ? 'active' : 'inactive' }], columns: [
                    { label: 'Utilisateur', sortValue: user => user.full_name, render: user => `<b>${esc(user.full_name)}</b><small>${esc(user.email)}</small>` },
                    { label: 'Rôle', sortValue: user => displayRole(user.role), render: user => `<span class="admin-role-badge role-${user.role.toLowerCase()}">${esc(displayRole(user.role))}</span>` },
                    { label: 'Statut', sortValue: user => Number(user.is_active), render: user => user.is_active ? '<span class="report-badge success">Actif</span>' : '<span class="report-badge danger">Désactivé</span>' },
                    { label: 'Créé le', sortValue: user => user.created_at, render: user => esc(new Date(user.created_at).toLocaleDateString('fr-FR')) },
                    { label: 'Actions', render: user => `<button type="button" class="table-action" data-edit-user="${esc(user.id)}" ${adminRoleLabels[user.role] && ['OWNER', 'ADMIN'].includes(user.role) && !canManagePrivileged ? 'disabled title="Réservé au propriétaire"' : ''}>Modifier</button>${Number(user.id) !== state.userId ? `<button type="button" class="table-action${user.is_active ? ' danger' : ''}" data-toggle-user="${esc(user.id)}" ${['OWNER', 'ADMIN'].includes(user.role) && !canManagePrivileged ? 'disabled title="Réservé au propriétaire"' : ''}>${user.is_active ? 'Désactiver' : 'Réactiver'}</button>` : '<small>Compte courant</small>'}` }
                ]
            });
            panel.querySelector('[data-add-user]').onclick = () => userDialog(panel, null, renderUsers);
            table.onclick = async event => {
                const editButton = event.target.closest('[data-edit-user]');
                if (editButton && table.contains(editButton)) { userDialog(panel, users.find(user => String(user.id) === editButton.dataset.editUser), renderUsers); return; }
                const button = event.target.closest('[data-toggle-user]');
                if (!button || !table.contains(button)) return;
                const user = users.find(item => String(item.id) === button.dataset.toggleUser); if (!user) return;
                const isActive = !Boolean(user.is_active);
                if (!window.confirm(`${isActive ? 'Réactiver' : 'Désactiver'} le compte de ${user.full_name} ?`)) return;
                try { const result = await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }); toast(result.message); await renderUsers(panel); }
                catch (error) { toast(error.message, 'error'); }
            };
        } catch (error) { if (panel.isConnected) { toast(error.message, 'error'); panel.innerHTML = `<div class="panel"><h3>Impossible de charger les utilisateurs</h3><p class="error" role="alert">${esc(error.message)}</p><button class="btn" type="button" data-retry-users>Réessayer</button></div>`; panel.querySelector('[data-retry-users]').onclick = () => renderUsers(panel); } }
    }
    function userDialog(panel, user, refresh) {
        const owner = state.role === 'OWNER', editablePrivileged = owner || !user || !['OWNER', 'ADMIN'].includes(user.role);
        const roleOptions = Object.entries(adminRoleLabels).filter(([role]) => role !== 'OWNER' && role !== 'ADMIN' || owner).map(([role, label]) => [role, displayRole(role) === label ? label : `${displayRole(role)} (origine : ${label})`]);
        const modal = document.createElement('div'); modal.className = 'overlay admin-user-overlay';
        modal.innerHTML = `<form class="modal admin-user-modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${user ? 'Modifier un utilisateur' : 'Créer un utilisateur'}</h3><p>Les mots de passe doivent contenir au moins 12 caractères. ${user ? 'Laissez le champ vide pour conserver le mot de passe actuel.' : 'Communiquez le mot de passe initial au membre de manière sécurisée.'}</p><label>Nom complet<input name="full_name" value="${esc(user?.full_name || '')}" maxlength="180" required></label><label>Adresse e-mail<input name="email" type="email" value="${esc(user?.email || '')}" maxlength="190" required></label><label>Rôle<select name="role" ${user && !editablePrivileged ? 'disabled' : ''}>${roleOptions.map(([role, label]) => `<option value="${role}" ${user?.role === role ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${user ? `<label>État du compte<select name="is_active" ${Number(user.id) === state.userId || !editablePrivileged ? 'disabled' : ''}><option value="true" ${user.is_active ? 'selected' : ''}>Actif</option><option value="false" ${!user.is_active ? 'selected' : ''}>Désactivé</option></select></label>` : ''}<label>${user ? 'Nouveau mot de passe (facultatif)' : 'Mot de passe initial'}<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" ${user ? '' : 'required'}></label><p class="error" role="alert"></p><div class="admin-modal-actions"><button type="button" class="table-action" data-cancel-user>Annuler</button><button class="btn">${user ? 'Enregistrer les modifications' : 'Créer le compte'}</button></div></form>`;
        document.body.append(modal);
        const form = modal.querySelector('form'), close = () => modal.remove();
        modal.querySelector('.close').onclick = close; modal.querySelector('[data-cancel-user]').onclick = close; modal.addEventListener('click', event => { if (event.target === modal) close(); });
        form.onsubmit = async event => {
            event.preventDefault(); const error = form.querySelector('.error'); error.textContent = '';
            const body = { full_name: form.elements.full_name.value, email: form.elements.email.value, role: form.elements.role.value };
            if (user) { if (form.elements.is_active && !form.elements.is_active.disabled) body.is_active = form.elements.is_active.value === 'true'; }
            const password = form.elements.password.value; if (password) body.password = password;
            try {
                const result = user ? await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify(body) }) : await api('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
                close(); toast(result.message); await refresh(panel);
            } catch (reason) { error.textContent = reason.message; toast(reason.message, 'error'); }
        };
        form.elements.full_name.focus();
    }
    async function renderAudit(panel, filters = {}, offset = 0) {
        panel.innerHTML = '<div class="panel"><p class="notification-empty">Chargement du journal d’activité…</p></div>';
        const limit = 25, params = new URLSearchParams({ limit: String(limit), offset: String(offset), ...filters });
        try {
            const data = await api(`/api/admin/audit?${params}`); if (!panel.isConnected) return;
            const detailsText = value => { if (!value) return '—'; try { return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2); } catch { return String(value); } };
            panel.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Journal d’activité</h3><p>Historique en lecture seule des opérations réalisées dans cet établissement.</p></div></div><form class="admin-audit-filters"><label>Recherche<input name="q" value="${esc(filters.q || '')}" placeholder="Utilisateur, action, objet…"></label><label>Action exacte<input name="action" value="${esc(filters.action || '')}" placeholder="Ex. USER_UPDATED"></label><label>Type d’objet exact<input name="entity" value="${esc(filters.entity || '')}" placeholder="Ex. user, product"></label><label>Du<input name="from" type="date" value="${esc(filters.from || '')}"></label><label>Au<input name="to" type="date" value="${esc(filters.to || '')}"></label><button class="btn">Filtrer</button><button class="table-action" type="button" data-clear-audit>Effacer</button></form><div class="tablewrap"><table><thead><tr><th>Date / heure</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détails</th></tr></thead><tbody>${data.items.length ? data.items.map(item => `<tr><td>${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</td><td>${esc(item.user_name)}</td><td><span class="admin-audit-action">${esc(item.action.replaceAll('_', ' '))}</span></td><td>${esc(item.entity_type)}${item.entity_id ? ` · ${esc(item.entity_id)}` : ''}</td><td><details class="admin-audit-details"><summary>Consulter</summary><pre>${esc(detailsText(item.details_json))}</pre></details></td></tr>`).join('') : '<tr><td class="table-empty" colspan="5">Aucune activité trouvée pour ces filtres.</td></tr>'}</tbody></table></div><div class="table-footer"><span>${data.total ? `${offset + 1}–${Math.min(offset + limit, data.total)} sur ${data.total}` : 'Aucune activité'}</span><button class="table-page" type="button" data-audit-prev ${offset === 0 ? 'disabled' : ''}>Précédent</button><button class="table-page" type="button" data-audit-next ${offset + limit >= data.total ? 'disabled' : ''}>Suivant</button></div><p class="admin-security-note">Le journal est consultable mais ne peut pas être modifié depuis l’interface.</p></div>`;
            const form = panel.querySelector('.admin-audit-filters');
            form.onsubmit = event => { event.preventDefault(); const next = Object.fromEntries(new FormData(form)); Object.keys(next).forEach(key => { if (!next[key]) delete next[key]; }); renderAudit(panel, next, 0); };
            panel.querySelector('[data-clear-audit]').onclick = () => renderAudit(panel, {}, 0);
            panel.querySelector('[data-audit-prev]').onclick = () => renderAudit(panel, filters, Math.max(0, offset - limit));
            panel.querySelector('[data-audit-next]').onclick = () => renderAudit(panel, filters, offset + limit);
        } catch (error) { if (panel.isConnected) { toast(error.message, 'error'); panel.innerHTML = `<div class="panel"><h3>Impossible de charger le journal</h3><p class="error" role="alert">${esc(error.message)}</p><button class="btn" type="button" data-retry-audit>Réessayer</button></div>`; panel.querySelector('[data-retry-audit]').onclick = () => renderAudit(panel, filters, offset); } }
    }
    const supportStatusLabels = { open: 'Ouverte', in_progress: 'En cours', closed: 'Clôturée' };
    const platformSections = [['overview', 'Vue générale'], ['pricing', 'Tarifs & promotions'], ['billing', 'Facturation'], ['support', 'Assistance'], ['knowledge', 'FAQ'], ['training', 'Formations'], ['team', 'Équipe SaaS']];
    const pricingModules = { stock: 'Gestion des stocks', procurement: 'Approvisionnement', sales: 'Ventes & facturation', patients: 'Patients & assurances', cash: 'Recettes & caisse', reports: 'Rapports & analyses', administration: 'Administration', support: 'Assistance & formation' };
    const pricingIntervals = [['monthly', 'Mensuel'], ['annual', 'Annuel'], ['biennial', '2 ans']];
    function planEditor(plan = null) {
        const type = plan?.plan_type || 'starter', modules = Array.isArray(plan?.included_modules) ? plan.included_modules : typeof plan?.included_modules === 'string' ? JSON.parse(plan.included_modules || '[]') : [];
        const prices = typeof plan?.module_prices === 'string' ? JSON.parse(plan.module_prices || '{}') : plan?.module_prices || {};
        const field = (label, name, value, attrs = '') => `<label>${label}<input name="${name}" type="number" min="0" step="0.01" value="${esc(value ?? '')}" ${attrs}></label>`;
        return `<div class="platform-plan-editor"><div class="platform-plan-fields">
            <label>Code du forfait<input name="code" maxlength="60" pattern="[a-z0-9][a-z0-9-]{1,59}" value="${esc(plan?.code || '')}" ${plan ? 'readonly' : 'required'}></label>
            <label>Nom<input name="name" maxlength="100" value="${esc(plan?.name || '')}" required></label>
            <label>Type de forfait<select name="plan_type" data-plan-type>${[['starter','Starter'],['ultimate','Ultimate'],['customized','Customized · à la carte']].map(([value,label]) => `<option value="${value}"${type === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
            ${field('Prix mensuel', 'monthly_price', plan?.monthly_price ?? (type === 'starter' ? 15000 : ''), type === 'starter' ? 'required' : '')}
            ${field('Prix annuel', 'annual_price', plan?.annual_price ?? (type === 'starter' ? 150000 : ''))}
            ${field('Prix 2 ans', 'biennial_price', plan?.biennial_price ?? (type === 'starter' ? 280000 : ''))}
            <label>Devise<input name="currency" maxlength="3" pattern="[A-Z]{3}" value="${esc(plan?.currency || 'XAF')}" required></label>
            ${field('Utilisateurs inclus', 'max_users', plan?.max_users ?? (type === 'starter' ? 3 : type === 'ultimate' ? 5 : 1), 'required')}
            ${field('Supplément par utilisateur', 'extra_user_price', plan?.extra_user_price ?? (type === 'customized' ? 0 : 5000), 'required')}
            ${field('Limite de produits', 'max_products', plan?.max_products ?? 10000000, 'required')}
            <label class="inline-check"><input name="is_active" type="checkbox"${plan?.is_active || !plan ? ' checked' : ''}> Publié sur le portail</label>
            </div><div class="platform-plan-fixed-modules" data-fixed-modules><b>Fonctionnalités comprises</b><p data-plan-module-summary></p></div>
            <fieldset class="platform-module-prices" data-module-prices><legend>Fonctionnalités et tarifs — Customized</legend>${Object.entries(pricingModules).map(([code,label]) => {
                const terms = prices[code] || {};
                const checked = modules.includes(code) || Object.keys(terms).length > 0;
                return `<div class="platform-module-price-row"><label class="platform-module-check"><input type="checkbox" name="module_${code}" value="${code}"${checked ? ' checked' : ''}> ${label}</label>${pricingIntervals.map(([interval,term]) => field(term,`price_${code}_${interval}`,terms[interval])).join('')}</div>`;
            }).join('')}</fieldset>
            <button type="submit" class="btn">${plan ? 'Enregistrer ce forfait' : 'Créer le forfait'}</button><p class="error" data-plan-error role="alert"></p></div>`;
    }
    function configurePlanEditor(form) {
        const type = form.querySelector('[data-plan-type]')?.value;
        const custom = type === 'customized';
        form.querySelector('[data-module-prices]').hidden = !custom;
        form.querySelector('[data-fixed-modules]').hidden = custom;
        pricingIntervals.forEach(([interval]) => {
            form.elements[`${interval}_price`].required = type === 'starter';
        });
        const summary = form.querySelector('[data-plan-module-summary]');
        if (summary) summary.textContent = type === 'starter'
            ? 'Stocks, approvisionnement, ventes et caisse. Jusqu’à 3 utilisateurs inclus; +5 000 XAF par utilisateur supplémentaire.'
            : 'Toutes les fonctionnalités. Jusqu’à 5 utilisateurs inclus; +5 000 XAF par utilisateur supplémentaire.';
        form.querySelector('[name="max_users"]').value = form.dataset.edited === 'true'
            ? form.querySelector('[name="max_users"]').value
            : String(type === 'starter' ? 3 : type === 'ultimate' ? 5 : 1);
        form.querySelector('[name="extra_user_price"]').value = form.dataset.edited === 'true'
            ? form.querySelector('[name="extra_user_price"]').value
            : String(type === 'customized' ? 0 : 5000);
    }
    function planFormPayload(form) {
        const values = Object.fromEntries(new FormData(form));
        values.is_active = form.elements.is_active.checked;
        values.included_modules = [];
        values.module_prices = {};
        if (values.plan_type === 'customized') {
            for (const [module, label] of Object.entries(pricingModules)) {
                if (!form.elements[`module_${module}`].checked) continue;
                values.included_modules.push(module);
                values.module_prices[module] = Object.fromEntries(pricingIntervals
                    .map(([interval]) => [interval, form.elements[`price_${module}_${interval}`].value])
                    .filter(([, value]) => value !== ''));
            }
        }
        return values;
    }
    async function renderPlatformPricing(root, options, plans, promotions) {
        root.innerHTML = `${platformTabsMarkup('pricing')}<div class="platform-page"><section class="panel"><div class="panel-head"><div><h3>Forfaits et tarification</h3><p>Starter : 15 000 XAF/mois, 150 000 XAF/an ou 280 000 XAF/2 ans; 3 utilisateurs inclus, puis 5 000 XAF par utilisateur ajouté. Ultimate inclut toutes les fonctionnalités; les prix se configurent ici. Customized facture les fonctionnalités sélectionnées individuellement.</p></div></div><form data-plan-create class="platform-edit-form">${planEditor()}</form><div class="platform-plan-list">${plans.map(plan => `<form data-plan-edit="${esc(plan.id)}" data-edited="true" class="platform-edit-form platform-plan-card"><div class="panel-head"><div><h3>${esc(plan.name)}</h3><small>${esc(plan.code)} · ${plan.is_active ? 'Publié' : 'Brouillon'}</small></div></div>${planEditor(plan)}</form>`).join('') || '<p class="table-empty">Aucun forfait. Créez Starter, Ultimate ou Customized ci-dessus.</p>'}</div></section><section class="panel"><div class="panel-head"><div><h3>Promotions</h3><p>Créez les promotions publiées sur le portail et appliquez-les aux souscriptions ou aux factures.</p></div></div><form data-promotion-create class="platform-edit-form"><label>Code<input name="code" maxlength="60" pattern="[A-Z0-9][A-Z0-9_-]{1,59}" required></label><label>Nom<input name="name" maxlength="120" required></label><label>Type<select name="discount_type"><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label><label>Valeur<input name="discount_value" type="number" min="0.01" step="0.01" required></label><label>Début<input name="starts_at" type="date" required></label><label>Fin (facultative)<input name="ends_at" type="date"></label><label><input name="is_active" type="checkbox" checked> Publiée sur le portail</label><button class="btn">Créer la promotion</button></form><div class="tablewrap"><table><thead><tr><th>Code / nom</th><th>Réduction</th><th>Période</th><th>État</th><th>Action</th></tr></thead><tbody>${promotions.map(promo => `<tr><td><b>${esc(promo.code)}</b><input data-promo-name="${esc(promo.id)}" value="${esc(promo.name)}"></td><td><select data-promo-type="${esc(promo.id)}"><option value="percent"${promo.discount_type === 'percent' ? ' selected' : ''}>%</option><option value="fixed"${promo.discount_type === 'fixed' ? ' selected' : ''}>Montant</option></select><input type="number" min="0.01" step="0.01" data-promo-value="${esc(promo.id)}" value="${esc(promo.discount_value)}"></td><td><input type="date" data-promo-start="${esc(promo.id)}" value="${esc(String(promo.starts_at).slice(0,10))}"><input type="date" data-promo-end="${esc(promo.ends_at ? String(promo.ends_at).slice(0,10) : '')}"></td><td><label><input type="checkbox" data-promo-active="${esc(promo.id)}"${promo.is_active ? ' checked' : ''}> Publiée</label></td><td><button type="button" class="table-action" data-promo-save="${esc(promo.id)}">Enregistrer</button></td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">Aucune promotion.</td></tr>'}</tbody></table></div></section></div>`;
        const promotionForm = root.querySelector('[data-promotion-create]');
        const planLabel = document.createElement('label');
        planLabel.textContent = 'Forfait concerné';
        const planSelect = document.createElement('select');
        planSelect.name = 'plan_id';
        planSelect.innerHTML = '<option value="">Tous les forfaits</option>' + plans.filter(plan => plan.plan_type !== 'trial').map(plan => `<option value="${esc(plan.id)}">${esc(plan.name)}</option>`).join('');
        planLabel.append(planSelect);
        promotionForm.insertBefore(planLabel, promotionForm.querySelector('[name="discount_type"]').closest('label'));
        const promotionTable = root.querySelector('[data-promo-save]')?.closest('table');
        if (promotionTable) {
            const header = document.createElement('th');
            header.textContent = 'Forfait';
            promotionTable.tHead.rows[0].insertBefore(header, promotionTable.tHead.rows[0].cells[1]);
            for (const promo of promotions) {
                const button = root.querySelector(`[data-promo-save="${promo.id}"]`);
                if (!button) continue;
                const cell = document.createElement('td'), select = document.createElement('select');
                select.dataset.promoPlan = String(promo.id);
                select.setAttribute('aria-label', `Forfait de la promotion ${promo.code}`);
                select.innerHTML = '<option value="">Tous les forfaits</option>' + plans.filter(plan => plan.plan_type !== 'trial').map(plan => `<option value="${esc(plan.id)}"${String(promo.plan_id || '') === String(plan.id) ? ' selected' : ''}>${esc(plan.name)}</option>`).join('');
                cell.append(select);
                button.closest('tr').insertBefore(cell, button.closest('tr').cells[1]);
            }
        }
        bindPlatformTabs(root, options);
        root.querySelectorAll('[data-plan-type]').forEach(select => {
            configurePlanEditor(select.form);
            select.addEventListener('change', () => configurePlanEditor(select.form));
        });
        root.querySelectorAll('[data-plan-create],[data-plan-edit]').forEach(form => form.addEventListener('submit', async event => {
            event.preventDefault();
            const values = planFormPayload(form), editing = Boolean(form.dataset.planEdit);
            try {
                await api(editing ? `/api/platform/pricing/${encodeURIComponent(form.dataset.planEdit)}` : '/api/platform/pricing', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(values) });
                toast(editing ? 'Forfait mis à jour.' : 'Forfait créé.');
                platformManagement(root, 'pricing', options);
            } catch (error) {
                form.querySelector('[data-plan-error]').textContent = error.message;
                toast(error.message, 'error');
            }
        }));
        root.querySelector('[data-promotion-create]').onsubmit = async event => {
            event.preventDefault();
            const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
            values.is_active = form.elements.is_active.checked;
            values.plan_id = values.plan_id || null;
            try {
                await api('/api/platform/promotions', { method: 'POST', body: JSON.stringify(values) });
                toast('Promotion créée.');
                platformManagement(root, 'pricing', options);
            } catch (error) { toast(error.message, 'error'); }
        };
        root.onclick = async event => {
            const button = event.target.closest('[data-promo-save]');
            if (!button) return;
            const id = button.dataset.promoSave;
            try {
                await api(`/api/platform/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: root.querySelector(`[data-promo-name="${id}"]`).value, plan_id: root.querySelector(`[data-promo-plan="${id}"]`).value || null, discount_type: root.querySelector(`[data-promo-type="${id}"]`).value, discount_value: root.querySelector(`[data-promo-value="${id}"]`).value, starts_at: root.querySelector(`[data-promo-start="${id}"]`).value, ends_at: root.querySelector(`[data-promo-end="${id}"]`).value || null, is_active: root.querySelector(`[data-promo-active="${id}"]`).checked }) });
                toast('Promotion mise à jour.');
                platformManagement(root, 'pricing', options);
            } catch (error) { toast(error.message, 'error'); }
        };
    }
    function platformTabsMarkup(active) {
        return `<div class="settings-tabs platform-tabs" role="tablist" aria-label="Administration SaaS">${platformSections.map(([id, label]) => `<button type="button" class="settings-tab${active === id ? ' active' : ''}" role="tab" aria-selected="${active === id}" data-platform-section="${id}">${label}</button>`).join('')}</div>`;
    }
    function bindPlatformTabs(root, options) {
        root.querySelectorAll('[data-platform-section]').forEach(button => button.onclick = () => {
            const section = button.dataset.platformSection;
            if (section === 'overview') platformModule(root, { ...options, section: 'overview' });
            else platformManagement(root, section, options);
        });
    }
    async function platformModule(root, options = {}) {
        if (options.section && options.section !== 'overview') return platformManagement(root, options.section, options);
        const chatOffset = options.chatOffset || 0, organizationOffset = options.organizationOffset || 0;
        const query = options.query || '', status = options.status || '', organizationQuery = options.organizationQuery || '';
        root.innerHTML = '<div class="panel"><p class="notification-empty">Chargement de la plateforme SaaS…</p></div>';
        try {
            const params = new URLSearchParams({ limit: '25', offset: String(chatOffset) });
            if (query) params.set('q', query);
            if (status) params.set('status', status);
            const organizationParams = new URLSearchParams({ limit: '25', offset: String(organizationOffset) });
            if (organizationQuery) organizationParams.set('q', organizationQuery);
            const [overview, agents, chats, organizations, plans] = await Promise.all([
                api('/api/platform/overview'), api('/api/platform/agents'),
                api(`/api/platform/support?${params}`), api(`/api/platform/organizations?${organizationParams}`),
                api('/api/platform/plans')
            ]);
            if (!root.isConnected) return;
            const ownAgent = agents.find(agent => Number(agent.id) === state.userId);
            root.innerHTML = `${platformTabsMarkup('overview')}<div class="platform-page"><section class="report-kpis"><article class="report-kpi green"><small>Établissements</small><b>${esc(overview.tenants)}</b><span>Comptes hébergés</span></article><article class="report-kpi blue"><small>Abonnements actifs</small><b>${esc(overview.activeSubscriptions)}</b><span>Abonnements en cours</span></article><article class="report-kpi purple"><small>Essais</small><b>${esc(overview.trialSubscriptions)}</b><span>Périodes d’essai</span></article><article class="report-kpi orange"><small>Chats en attente</small><b>${esc(overview.waitingChats)}</b><span>${esc(overview.openChats)} chats ouverts au total</span></article></section>
                <section class="panel platform-presence"><div><small>ASSISTANCE REDAMS</small><h3>Disponibilité des agents</h3><p>${ownAgent ? `Connecté en tant que ${esc(ownAgent.full_name)} · ${Number(ownAgent.active_chats)} chat(s) actif(s)` : 'Votre compte administrateur peut prendre en charge les demandes.'}</p></div><button type="button" class="btn${ownAgent?.is_available ? ' platform-unavailable' : ''}" data-platform-presence>${ownAgent?.is_available ? 'Passer indisponible' : 'Me rendre disponible'}</button></section>
                <section class="panel"><div class="panel-head"><div><h3>Agents de la plateforme</h3><p>La disponibilité active l’affectation automatique des nouveaux chats.</p></div></div><div class="tablewrap"><table><thead><tr><th>Agent</th><th>État</th><th>Chats actifs</th><th>Compte</th></tr></thead><tbody>${agents.length ? agents.map(agent => `<tr><td><b>${esc(agent.full_name)}</b><small>${esc(agent.email)}</small></td><td><span class="support-status ${agent.is_available ? 'status-available' : 'status-unavailable'}">${agent.is_available ? 'Disponible' : 'Indisponible'}</span></td><td>${esc(agent.active_chats)}</td><td>${agent.is_active ? 'Actif' : 'Désactivé'}</td></tr>`).join('') : '<tr><td colspan="4" class="table-empty">Aucun agent SUPER_ADMIN.</td></tr>'}</tbody></table></div></section>
                <section class="panel"><div class="panel-head"><div><h3>File des chats</h3><p>Les demandes sans agent apparaissent en tête de file.</p></div></div><form data-platform-chat-filters class="platform-filters"><label>Recherche<input name="q" value="${esc(query)}" placeholder="Jeton, établissement, membre…"></label><label>Statut<select name="status"><option value="">Tous les statuts</option>${Object.entries(supportStatusLabels).map(([key,label]) => `<option value="${key}"${status === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button class="btn">Filtrer</button></form><div data-platform-chats></div><div class="table-footer"><span>${chats.total ? `${chatOffset + 1}–${Math.min(chatOffset + chats.limit, chats.total)} sur ${chats.total}` : 'Aucun chat'}</span><button type="button" class="table-page" data-chat-prev${chatOffset === 0 ? ' disabled' : ''}>Précédent</button><button type="button" class="table-page" data-chat-next${chatOffset + chats.limit >= chats.total ? ' disabled' : ''}>Suivant</button></div></section>
                <section class="panel"><div class="panel-head"><div><h3>Établissements</h3><p>Vue globale des comptes et de leurs abonnements.</p></div></div><form data-platform-org-filters class="platform-filters"><label>Recherche établissement<input name="q" value="${esc(organizationQuery)}" placeholder="Nom, identifiant, courriel…"></label><button class="btn">Rechercher</button></form><div data-platform-organizations></div><div class="table-footer"><span>${organizations.total ? `${organizationOffset + 1}–${Math.min(organizationOffset + organizations.limit, organizations.total)} sur ${organizations.total}` : 'Aucun établissement'}</span><button type="button" class="table-page" data-org-prev${organizationOffset === 0 ? ' disabled' : ''}>Précédent</button><button type="button" class="table-page" data-org-next${organizationOffset + organizations.limit >= organizations.total ? ' disabled' : ''}>Suivant</button></div></section></div>`;
            bindPlatformTabs(root, options);
            const chatTable = root.querySelector('[data-platform-chats]');
            mountDataTable(chatTable, { rows: chats.items.map(item => ({ ...item, searchText: `${item.token} ${item.organization_name} ${item.requester_name} ${item.message} ${item.agent_name || ''}` })), searchText: 'Filtrer les résultats de cette page…', emptyMessage: 'Aucun chat dans cette file.', columns: [
                { label: 'Jeton / date', sortValue: item => item.token, render: item => `<b>${esc(item.token)}</b><small>${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</small>` },
                { label: 'Établissement', sortValue: item => item.organization_name, render: item => esc(item.organization_name) },
                { label: 'Demandeur', sortValue: item => item.requester_name, render: item => esc(item.requester_name) },
                { label: 'Statut', sortValue: item => item.status, render: item => `<span class="support-status status-${esc(item.status)}">${esc(item.assigned_agent_id ? item.agent_name || 'Assigné' : 'En attente')}</span>` },
                { label: 'Échanges', sortValue: item => Number(item.reply_count), render: item => esc(item.reply_count) },
                { label: 'Action', render: item => `<button type="button" class="table-action" data-platform-chat="${esc(item.id)}">Ouvrir</button>` }
            ] });
            chatTable.onclick = event => {
                const button = event.target.closest('[data-platform-chat]');
                if (button && chatTable.contains(button)) platformChatDialog(button.dataset.platformChat);
            };
            const organizationTable = root.querySelector('[data-platform-organizations]');
            mountDataTable(organizationTable, { rows: organizations.items.map(item => ({ ...item, searchText: `${item.name} ${item.slug} ${item.email || ''} ${item.phone || ''}` })), searchText: 'Filtrer les établissements de cette page…', emptyMessage: 'Aucun établissement trouvé.', columns: [
                { label: 'Établissement', sortValue: item => item.name, render: item => `<b>${esc(item.name)}</b><small>${esc(item.slug)}</small>` },
                { label: 'Contact', sortValue: item => item.email || '', render: item => `${esc(item.email || '—')}<small>${esc(item.phone || '')}</small>` },
                { label: 'Statut', sortValue: item => item.status, render: item => `<span class="support-status status-${esc(item.status)}">${esc(item.status)}</span>` },
                { label: 'Abonnement', sortValue: item => item.plan_name || '', render: item => `${esc(item.plan_name || 'Aucun')}<small>${esc(item.subscription_status || '—')}</small>` },
                { label: 'Utilisateurs actifs', sortValue: item => Number(item.active_users), render: item => esc(item.active_users) },
                { label: 'Gestion', render: item => `<div class="platform-org-actions"><label>Établissement<select data-org-status="${esc(item.id)}"><option value="active"${item.status === 'active' ? ' selected' : ''}>Actif</option><option value="suspended"${item.status === 'suspended' ? ' selected' : ''}>Suspendu</option><option value="closed"${item.status === 'closed' ? ' selected' : ''}>Fermé</option></select></label><button type="button" class="table-action" data-save-org-status="${esc(item.id)}">Appliquer</button><label>Forfait<select data-subscription-plan="${esc(item.id)}">${plans.map(plan => `<option value="${esc(plan.id)}"${Number(item.plan_id) === Number(plan.id) ? ' selected' : ''}>${esc(plan.name)} · ${esc(plan.monthly_price)} ${esc(plan.currency)}</option>`).join('')}</select></label><label>Abonnement<select data-subscription-status="${esc(item.id)}">${['trialing','active','past_due','suspended','cancelled'].map(value => `<option value="${value}"${(item.subscription_status || 'trialing') === value ? ' selected' : ''}>${value}</option>`).join('')}</select></label><label>Début<input type="date" data-subscription-start="${esc(item.id)}" value="${esc(String(item.current_period_start || new Date().toISOString()).slice(0,10))}"></label><label>Fin<input type="date" data-subscription-end="${esc(item.current_period_end || new Date(Date.now()+30*86400000).toISOString()).slice(0,10)}"></label><button type="button" class="table-action" data-save-subscription="${esc(item.id)}">${item.subscription_id ? 'Enregistrer' : 'Créer abonnement'}</button></div>` }
            ] });
            organizationTable.onclick = async event => {
                const statusButton = event.target.closest('[data-save-org-status]');
                const subscriptionButton = event.target.closest('[data-save-subscription]');
                try {
                    if (statusButton && organizationTable.contains(statusButton)) {
                        const organizationId = statusButton.dataset.saveOrgStatus;
                        const status = organizationTable.querySelector(`[data-org-status="${organizationId}"]`).value;
                        await api(`/api/platform/organizations/${encodeURIComponent(organizationId)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
                        toast('Statut de l’établissement mis à jour.');
                        platformModule(root, options);
                    } else if (subscriptionButton && organizationTable.contains(subscriptionButton)) {
                        const organizationId = subscriptionButton.dataset.saveSubscription;
                        const plan_id = organizationTable.querySelector(`[data-subscription-plan="${organizationId}"]`).value;
                        const subStatus = organizationTable.querySelector(`[data-subscription-status="${organizationId}"]`).value;
                        const period_start = organizationTable.querySelector(`[data-subscription-start="${organizationId}"]`).value;
                        const period_end = organizationTable.querySelector(`[data-subscription-end="${organizationId}"]`).value;
                        await api(`/api/platform/organizations/${encodeURIComponent(organizationId)}/subscription`, { method: 'PATCH', body: JSON.stringify({ plan_id, status: subStatus, period_start, period_end }) });
                        toast('Abonnement mis à jour.');
                        platformModule(root, options);
                    }
                } catch (error) { toast(error.message, 'error'); }
            };
            root.querySelector('[data-platform-presence]').onclick = async event => {
                const button = event.currentTarget; button.disabled = true;
                try {
                    await api('/api/platform/agents/presence', { method: 'PUT', body: JSON.stringify({ available: !Boolean(ownAgent?.is_available) }) });
                    toast(ownAgent?.is_available ? 'Disponibilité désactivée.' : 'Vous êtes disponible pour les demandes.');
                    await platformModule(root, options);
                } catch (error) { toast(error.message, 'error'); button.disabled = false; }
            };
            root.querySelector('[data-platform-chat-filters]').onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); platformModule(root, { ...options, query: values.q.trim(), status: values.status, chatOffset: 0 }); };
            root.querySelector('[data-platform-org-filters]').onsubmit = event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); platformModule(root, { ...options, organizationQuery: values.q.trim(), organizationOffset: 0 }); };
            root.querySelector('[data-chat-prev]').onclick = () => platformModule(root, { ...options, chatOffset: Math.max(0, chatOffset - chats.limit) });
            root.querySelector('[data-chat-next]').onclick = () => platformModule(root, { ...options, chatOffset: chatOffset + chats.limit });
            root.querySelector('[data-org-prev]').onclick = () => platformModule(root, { ...options, organizationOffset: Math.max(0, organizationOffset - organizations.limit) });
            root.querySelector('[data-org-next]').onclick = () => platformModule(root, { ...options, organizationOffset: organizationOffset + organizations.limit });
        } catch (error) {
            if (root.isConnected) { toast(error.message, 'error'); root.innerHTML = `<div class="panel"><h3>Administration SaaS indisponible</h3><p class="error" role="alert">${esc(error.message)}</p><button class="btn" type="button" data-platform-retry>Réessayer</button></div>`; root.querySelector('[data-platform-retry]').onclick = () => platformModule(root, options); }
        }
    }
    async function platformManagement(root, section, options = {}) {
        root.innerHTML = `${platformTabsMarkup(section)}<div class="panel"><p class="notification-empty">Chargement…</p></div>`;
        try {
            if (section === 'pricing') {
                const [plans, promotions] = await Promise.all([api('/api/platform/pricing'), api('/api/platform/promotions')]);
                if (!root.isConnected) return;
                root.innerHTML = `${platformTabsMarkup(section)}<div class="platform-page"><section class="panel"><div class="panel-head"><div><h3>Forfaits et tarification</h3><p>Créez les offres publiées sur le portail. Chaque forfait inclut toutes les fonctionnalités; seuls les quotas varient.</p></div></div><form data-plan-create class="platform-edit-form"><label>Code<input name="code" maxlength="60" pattern="[a-z0-9][a-z0-9-]{1,59}" required></label><label>Nom<input name="name" maxlength="100" required></label><label>Prix mensuel<input name="monthly_price" type="number" min="0" step="0.01" required></label><label>Devise<input name="currency" value="XAF" pattern="[A-Z]{3}" maxlength="3" required></label><label>Utilisateurs max<input name="max_users" type="number" min="1" required></label><label>Produits max<input name="max_products" type="number" min="1" required></label><button class="btn">Créer le forfait</button></form><div class="tablewrap"><table><thead><tr><th>Offre</th><th>Prix/devise</th><th>Quotas</th><th>État</th><th>Action</th></tr></thead><tbody>${plans.map(plan => `<tr><td><b>${esc(plan.name)}</b><small>${esc(plan.code)}</small></td><td><input aria-label="Prix ${esc(plan.name)}" type="number" min="0" step="0.01" data-plan-price="${esc(plan.id)}" value="${esc(plan.monthly_price)}"><input aria-label="Devise ${esc(plan.name)}" maxlength="3" data-plan-currency="${esc(plan.id)}" value="${esc(plan.currency)}"></td><td><label>Comptes<input type="number" min="1" data-plan-users="${esc(plan.id)}" value="${esc(plan.max_users)}"></label><label>Produits<input type="number" min="1" data-plan-products="${esc(plan.id)}" value="${esc(plan.max_products)}"></label></td><td><label><input type="checkbox" data-plan-active="${esc(plan.id)}"${plan.is_active ? ' checked' : ''}> Actif</label></td><td><input aria-label="Nom ${esc(plan.name)}" data-plan-name="${esc(plan.id)}" value="${esc(plan.name)}"><button type="button" class="table-action" data-plan-save="${esc(plan.id)}">Enregistrer</button></td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">Aucun forfait configuré.</td></tr>'}</tbody></table></div></section><section class="panel"><div class="panel-head"><div><h3>Promotions</h3><p>Créez les promotions publiées sur le portail et appliquez-les aux souscriptions ou aux factures.</p></div></div><form data-promotion-create class="platform-edit-form"><label>Code<input name="code" maxlength="60" pattern="[A-Z0-9][A-Z0-9_-]{1,59}" required></label><label>Nom<input name="name" maxlength="120" required></label><label>Type<select name="discount_type"><option value="percent">Pourcentage</option><option value="fixed">Montant fixe</option></select></label><label>Valeur<input name="discount_value" type="number" min="0.01" step="0.01" required></label><label>Début<input name="starts_at" type="date" required></label><label>Fin (facultative)<input name="ends_at" type="date"></label><label><input name="is_active" type="checkbox" checked> Active</label><button class="btn">Créer la promotion</button></form><div class="tablewrap"><table><thead><tr><th>Code / nom</th><th>Réduction</th><th>Période</th><th>État</th><th>Action</th></tr></thead><tbody>${promotions.map(promo => `<tr><td><b>${esc(promo.code)}</b><input data-promo-name="${esc(promo.id)}" value="${esc(promo.name)}"></td><td><select data-promo-type="${esc(promo.id)}"><option value="percent"${promo.discount_type === 'percent' ? ' selected' : ''}>%</option><option value="fixed"${promo.discount_type === 'fixed' ? ' selected' : ''}>Montant</option></select><input type="number" min="0.01" step="0.01" data-promo-value="${esc(promo.id)}" value="${esc(promo.discount_value)}"></td><td><input type="date" data-promo-start="${esc(promo.id)}" value="${esc(String(promo.starts_at).slice(0,10))}"><input type="date" data-promo-end="${esc(promo.id)}" value="${promo.ends_at ? esc(String(promo.ends_at).slice(0,10)) : ''}"></td><td><label><input type="checkbox" data-promo-active="${esc(promo.id)}"${promo.is_active ? ' checked' : ''}> Active</label></td><td><button type="button" class="table-action" data-promo-save="${esc(promo.id)}">Enregistrer</button></td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">Aucune promotion.</td></tr>'}</tbody></table></div></section></div>`;
                bindPlatformTabs(root, options);
                root.querySelector('[data-plan-create]').onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, values = Object.fromEntries(new FormData(form));
                    try { await api('/api/platform/pricing', { method: 'POST', body: JSON.stringify(values) }); toast('Forfait créé.'); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
                root.querySelector('[data-promotion-create]').onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, values = Object.fromEntries(new FormData(form)); values.is_active = form.elements.is_active.checked;
                    try { await api('/api/platform/promotions', { method: 'POST', body: JSON.stringify(values) }); toast('Promotion créée.'); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
                root.onclick = async event => {
                    const planButton = event.target.closest('[data-plan-save]'), promoButton = event.target.closest('[data-promo-save]');
                    try {
                        if (planButton) {
                            const id = planButton.dataset.planSave;
                            await api(`/api/platform/pricing/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: root.querySelector(`[data-plan-name="${id}"]`).value, monthly_price: root.querySelector(`[data-plan-price="${id}"]`).value, currency: root.querySelector(`[data-plan-currency="${id}"]`).value, max_users: root.querySelector(`[data-plan-users="${id}"]`).value, max_products: root.querySelector(`[data-plan-products="${id}"]`).value, is_active: root.querySelector(`[data-plan-active="${id}"]`).checked }) });
                            toast('Forfait mis à jour.'); platformManagement(root, section, options);
                        } else if (promoButton) {
                            const id = promoButton.dataset.promoSave;
                            await api(`/api/platform/promotions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name: root.querySelector(`[data-promo-name="${id}"]`).value, discount_type: root.querySelector(`[data-promo-type="${id}"]`).value, discount_value: root.querySelector(`[data-promo-value="${id}"]`).value, starts_at: root.querySelector(`[data-promo-start="${id}"]`).value, ends_at: root.querySelector(`[data-promo-end="${id}"]`).value || null, is_active: root.querySelector(`[data-promo-active="${id}"]`).checked }) });
                            toast('Promotion mise à jour.'); platformManagement(root, section, options);
                        }
                    } catch (error) { toast(error.message, 'error'); }
                };
                await renderPlatformPricing(root, options, plans, promotions);
            } else if (section === 'billing') {
                const [invoices, organizations, promotions] = await Promise.all([api('/api/platform/invoices?limit=100'), api('/api/platform/organizations?limit=100'), api('/api/platform/promotions')]);
                if (!root.isConnected) return;
                const today = new Date(), dateValue = value => value.toISOString().slice(0,10), end = new Date(today); end.setMonth(end.getMonth()+1);
                root.innerHTML = `${platformTabsMarkup(section)}<div class="platform-page"><section class="panel"><div class="panel-head"><div><h3>Émettre une facture</h3><p>Facturation manuelle des abonnements; aucun paiement bancaire n’est traité par cette interface.</p></div></div><form data-invoice-create class="platform-edit-form"><label>Établissement<select name="organization_id" required>${organizations.items.map(org => `<option value="${esc(org.id)}">${esc(org.name)} · ${esc(org.plan_name || 'sans forfait')} (${esc(org.subscription_status || 'sans abonnement')})</option>`).join('')}</select></label><label>Période début<input name="period_start" type="date" value="${dateValue(today)}" required></label><label>Période fin<input name="period_end" type="date" value="${dateValue(end)}" required></label><label>Échéance<input name="due_date" type="date" value="${dateValue(end)}" required></label><label>Promotion<select name="promotion_id"><option value="">Aucune</option>${promotions.filter(item => item.is_active).map(item => `<option value="${esc(item.id)}">${esc(item.code)} · ${esc(item.discount_value)} ${item.discount_type === 'percent' ? '%' : 'montant'}</option>`).join('')}</select></label><label>Note<input name="notes" maxlength="500"></label><button class="btn"${organizations.items.length ? '' : ' disabled'}>Créer le brouillon de facture</button></form></section><section class="panel"><div class="panel-head"><div><h3>Factures d’abonnement</h3><p>Les paiements marqués comme reçus sont ajoutés au registre des paiements manuels.</p></div></div><div class="tablewrap"><table><thead><tr><th>Numéro / date</th><th>Établissement</th><th>Période</th><th>Total</th><th>Échéance</th><th>État / action</th></tr></thead><tbody>${invoices.items.map(item => `<tr><td><b>${esc(item.invoice_number)}</b><small>${esc(new Date(item.created_at).toLocaleDateString('fr-FR'))}</small></td><td>${esc(item.organization_name)}</td><td>${esc(String(item.period_start).slice(0,10))} – ${esc(String(item.period_end).slice(0,10))}</td><td>${esc(item.total_amount)} ${esc(item.currency)}${Number(item.discount_amount) ? `<small>Réduction : ${esc(item.discount_amount)}</small>` : ''}</td><td>${esc(String(item.due_date).slice(0,10))}</td><td><span class="support-status status-${esc(item.status)}">${esc(item.status)}</span>${item.status === 'draft' ? `<button type="button" class="table-action" data-invoice-status="${esc(item.id)}" data-next-status="sent">Émettre</button>` : item.status === 'sent' ? `<button type="button" class="table-action" data-invoice-status="${esc(item.id)}" data-next-status="paid">Paiement reçu</button>` : ''}${['draft','sent'].includes(item.status) ? `<button type="button" class="table-action" data-invoice-status="${esc(item.id)}" data-next-status="void">Annuler</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="table-empty">Aucune facture émise.</td></tr>'}</tbody></table></div></section></div>`;
                bindPlatformTabs(root, options);
                root.querySelector('[data-invoice-create]').onsubmit = async event => {
                    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
                    try { const result = await api('/api/platform/invoices', { method: 'POST', body: JSON.stringify(values) }); toast(`Facture ${result.invoice_number} créée.`); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
                root.onclick = async event => {
                    const button = event.target.closest('[data-invoice-status]'); if (!button) return;
                    try { await api(`/api/platform/invoices/${encodeURIComponent(button.dataset.invoiceStatus)}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.nextStatus }) }); toast('Statut de la facture mis à jour.'); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
            } else if (section === 'support') {
                const requests = await api('/api/platform/support-requests?limit=100');
                if (!root.isConnected) return;
                root.innerHTML = `${platformTabsMarkup(section)}<section class="panel"><div class="panel-head"><div><h3>Demandes techniques des entreprises</h3><p>Suivi des demandes classiques en plus des chats de la vue générale.</p></div></div><div class="tablewrap"><table><thead><tr><th>Date</th><th>Établissement / membre</th><th>Demande</th><th>État</th><th>Action</th></tr></thead><tbody>${requests.items.map(item => `<tr><td>${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</td><td><b>${esc(item.organization_name)}</b><small>${esc(item.requester_name)}</small></td><td><b>${esc(item.subject)}</b><small>${esc(item.message)}</small></td><td><span class="support-status status-${esc(item.status)}">${esc(supportStatusLabels[item.status])}</span></td><td><button type="button" class="table-action" data-platform-request="${esc(item.id)}">Traiter</button></td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">Aucune demande technique.</td></tr>'}</tbody></table></div></section>`;
                bindPlatformTabs(root, options);
                root.onclick = event => { const button = event.target.closest('[data-platform-request]'); if (button) platformRequestDialog(button.dataset.platformRequest, () => platformManagement(root, section, options)); };
            } else if (section === 'knowledge' || section === 'training') {
                const isFaq = section === 'knowledge', items = await api(isFaq ? '/api/platform/faqs' : '/api/platform/trainings');
                if (!root.isConnected) return;
                const rowMarkup = items.map(item => isFaq
                    ? `<tr><td><input data-content-title="${esc(item.id)}" value="${esc(item.question)}" aria-label="Question"></td><td><textarea data-content-description="${esc(item.id)}" rows="3" aria-label="Réponse">${esc(item.answer)}</textarea></td><td><input data-content-category="${esc(item.id)}" value="${esc(item.category)}" aria-label="Catégorie"><input type="number" data-content-order="${esc(item.id)}" value="${esc(item.sort_order)}" aria-label="Ordre"></td><td><label><input type="checkbox" data-content-active="${esc(item.id)}"${item.is_active ? ' checked' : ''}> Publiée</label></td><td><button class="table-action" type="button" data-content-save="${esc(item.id)}">Enregistrer</button></td></tr>`
                    : `<tr><td><input data-content-title="${esc(item.id)}" value="${esc(item.title)}" aria-label="Titre"><select data-content-format="${esc(item.id)}"><option value="article"${item.format === 'article' ? ' selected' : ''}>Article</option><option value="video"${item.format === 'video' ? ' selected' : ''}>Vidéo</option><option value="link"${item.format === 'link' ? ' selected' : ''}>Lien</option></select><input data-content-url="${esc(item.id)}" value="${esc(item.url || '')}" placeholder="https://…" aria-label="Lien"></td><td><textarea data-content-description="${esc(item.id)}" rows="3" aria-label="Description">${esc(item.description)}</textarea></td><td><input type="number" data-content-order="${esc(item.id)}" value="${esc(item.sort_order)}" aria-label="Ordre"></td><td><label><input type="checkbox" data-content-active="${esc(item.id)}"${item.is_active ? ' checked' : ''}> Publiée</label></td><td><button class="table-action" type="button" data-content-save="${esc(item.id)}">Enregistrer</button></td></tr>`).join('');
                root.innerHTML = `${platformTabsMarkup(section)}<div class="platform-page"><section class="panel"><div class="panel-head"><div><h3>${isFaq ? 'FAQ visible dans Assistance' : 'Ressources de formation'}</h3><p>${isFaq ? 'Les réponses publiées sont affichées aux utilisateurs des entreprises.' : 'Articles, vidéos et liens de formation partagés dans Assistance.'}</p></div></div><form data-content-create class="platform-edit-form">${isFaq ? '<label>Question<input name="question" maxlength="255" required></label><label>Réponse<textarea name="answer" maxlength="10000" required></textarea></label><label>Catégorie<input name="category" value="Général" maxlength="100" required></label>' : '<label>Titre<input name="title" maxlength="180" required></label><label>Description<textarea name="description" maxlength="10000" required></textarea></label><label>Format<select name="format"><option value="article">Article</option><option value="video">Vidéo</option><option value="link">Lien</option></select></label><label>Lien facultatif<input name="url" type="url" maxlength="1000" placeholder="https://…"></label>'}<label>Ordre<input name="sort_order" type="number" value="0" required></label><label><input name="is_active" type="checkbox" checked> Publier</label><button class="btn">${isFaq ? 'Ajouter la FAQ' : 'Ajouter la ressource'}</button></form><div class="tablewrap"><table><thead><tr>${isFaq ? '<th>Question</th><th>Réponse</th><th>Catégorie / ordre</th>' : '<th>Ressource</th><th>Description</th><th>Ordre</th>'}<th>Publication</th><th>Action</th></tr></thead><tbody>${rowMarkup || `<tr><td colspan="5" class="table-empty">Aucun contenu ${isFaq ? 'FAQ' : 'de formation'}.</td></tr>`}</tbody></table></div></section></div>`;
                bindPlatformTabs(root, options);
                root.querySelector('[data-content-create]').onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, values = Object.fromEntries(new FormData(form)); values.is_active = form.elements.is_active.checked;
                    try { await api(isFaq ? '/api/platform/faqs' : '/api/platform/trainings', { method: 'POST', body: JSON.stringify(values) }); toast(isFaq ? 'FAQ créée.' : 'Formation créée.'); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
                root.onclick = async event => {
                    const button = event.target.closest('[data-content-save]'); if (!button) return;
                    const id = button.dataset.contentSave, values = { is_active: root.querySelector(`[data-content-active="${id}"]`).checked, sort_order: root.querySelector(`[data-content-order="${id}"]`).value };
                    if (isFaq) Object.assign(values, { question: root.querySelector(`[data-content-title="${id}"]`).value, answer: root.querySelector(`[data-content-description="${id}"]`).value, category: root.querySelector(`[data-content-category="${id}"]`).value });
                    else Object.assign(values, { title: root.querySelector(`[data-content-title="${id}"]`).value, description: root.querySelector(`[data-content-description="${id}"]`).value, format: root.querySelector(`[data-content-format="${id}"]`).value, url: root.querySelector(`[data-content-url="${id}"]`).value });
                    try { await api(`/api/platform/${isFaq ? 'faqs' : 'trainings'}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(values) }); toast('Contenu mis à jour.'); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
            } else if (section === 'team') {
                const agents = await api('/api/platform/agents');
                if (!root.isConnected) return;
                root.innerHTML = `${platformTabsMarkup(section)}<div class="platform-page"><section class="panel"><div class="panel-head"><div><h3>Équipe d’administration REDAMS</h3><p>Ces comptes seuls ont accès à l’espace SaaS; les rôles des établissements ne peuvent pas l’ouvrir.</p></div></div><form data-agent-create class="platform-edit-form"><label>Nom complet<input name="full_name" maxlength="180" required></label><label>Courriel professionnel<input name="email" type="email" maxlength="190" required></label><label>Mot de passe temporaire<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="btn">Créer un compte d’équipe</button></form><div class="tablewrap"><table><thead><tr><th>Membre / établissement</th><th>Présence</th><th>Chats actifs</th><th>Compte</th><th>Action</th></tr></thead><tbody>${agents.map(agent => `<tr><td><b>${esc(agent.full_name)}</b><small>${esc(agent.email)} · ${esc(agent.organization_name)}</small></td><td><span class="support-status ${agent.is_available ? 'status-available' : 'status-unavailable'}">${agent.is_available ? 'Disponible' : 'Indisponible'}</span></td><td>${esc(agent.active_chats)}</td><td>${agent.is_active ? 'Actif' : 'Désactivé'}</td><td><button type="button" class="table-action" data-agent-active="${esc(agent.id)}" data-active="${agent.is_active ? 'false' : 'true'}"${Number(agent.id) === state.userId ? ' disabled title="Vous ne pouvez pas désactiver votre propre compte."' : ''}>${agent.is_active ? 'Désactiver' : 'Activer'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="table-empty">Aucun membre.</td></tr>'}</tbody></table></div></section></div>`;
                bindPlatformTabs(root, options);
                root.querySelector('[data-agent-create]').onsubmit = async event => {
                    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
                    try { await api('/api/platform/agents', { method: 'POST', body: JSON.stringify(values) }); toast('Compte d’équipe créé.'); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
                root.onclick = async event => {
                    const button = event.target.closest('[data-agent-active]'); if (!button) return;
                    try { await api(`/api/platform/agents/${encodeURIComponent(button.dataset.agentActive)}/active`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active === 'true' }) }); toast('État du compte mis à jour.'); platformManagement(root, section, options); }
                    catch (error) { toast(error.message, 'error'); }
                };
            } else {
                root.innerHTML = `${platformTabsMarkup('overview')}<section class="panel"><p class="error" role="alert">Cette section SaaS n’existe pas.</p></section>`;
                bindPlatformTabs(root, options);
            }
        } catch (error) {
            if (root.isConnected) { toast(error.message, 'error'); root.innerHTML = `${platformTabsMarkup(section)}<div class="panel"><h3>Section SaaS indisponible</h3><p class="error" role="alert">${esc(error.message)}</p><button class="btn" type="button" data-platform-retry>Réessayer</button></div>`; bindPlatformTabs(root, options); root.querySelector('[data-platform-retry]').onclick = () => platformManagement(root, section, options); }
        }
    }

    async function platformRequestDialog(ticketId, onUpdated) {
        const overlay = document.createElement('div'); overlay.className = 'overlay support-ticket-overlay';
        overlay.innerHTML = '<section class="modal support-ticket-modal platform-chat-modal" role="dialog" aria-modal="true" aria-label="Demande technique"><button type="button" class="close" aria-label="Fermer">×</button><p class="notification-empty">Chargement de la demande…</p></section>';
        document.body.append(overlay);
        const modal = overlay.querySelector('.modal'), close = () => overlay.remove();
        overlay.querySelector('.close').onclick = close;
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        const draw = data => {
            const ticket = data.ticket;
            modal.innerHTML = `<button type="button" class="close" aria-label="Fermer">×</button><small>ASSISTANCE TECHNIQUE</small><h3>${esc(ticket.subject)}</h3><p>${esc(ticket.organization_name)} · ${esc(ticket.requester_name)}</p><span class="support-status status-${esc(ticket.status)}">${esc(supportStatusLabels[ticket.status])}</span><article class="support-message"><b>Demande initiale</b><p>${esc(ticket.message)}</p></article><div class="support-thread">${data.messages.map(item => `<article class="support-message${item.is_agent ? ' agent-message' : ''}"><b>${esc(item.full_name)} · ${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</b><p>${esc(item.message)}</p></article>`).join('') || '<p class="notification-empty">Aucun échange supplémentaire.</p>'}</div><p class="error" role="alert" data-request-error></p>${ticket.status === 'closed' ? '' : '<form data-request-reply class="support-reply-form"><label>Répondre<textarea name="message" rows="3" maxlength="5000" required></textarea></label><button class="btn">Envoyer</button></form>'}<form data-request-status class="support-status-form"><label>Statut<select name="status">${Object.entries(supportStatusLabels).map(([value,label]) => `<option value="${value}"${ticket.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button class="table-action">Mettre à jour</button></form>`;
            modal.querySelector('.close').onclick = close;
            const thread = modal.querySelector('.support-thread'); thread.scrollTop = thread.scrollHeight;
            const reply = modal.querySelector('[data-request-reply]');
            if (reply) reply.onsubmit = async event => {
                event.preventDefault(); const form = event.currentTarget;
                try { await api(`/api/platform/support-requests/${encodeURIComponent(ticketId)}/messages`, { method: 'POST', body: JSON.stringify({ message: form.elements.message.value }) }); toast('Réponse envoyée.'); close(); onUpdated(); }
                catch (error) { modal.querySelector('[data-request-error]').textContent = error.message; }
            };
            modal.querySelector('[data-request-status]').onsubmit = async event => {
                event.preventDefault(); const form = event.currentTarget;
                try { await api(`/api/platform/support-requests/${encodeURIComponent(ticketId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: form.elements.status.value }) }); toast('Statut mis à jour.'); close(); onUpdated(); }
                catch (error) { modal.querySelector('[data-request-error]').textContent = error.message; }
            };
        };
        try { draw(await api(`/api/platform/support-requests/${encodeURIComponent(ticketId)}`)); }
        catch (error) { modal.innerHTML = `<button type="button" class="close" aria-label="Fermer">×</button><p class="error" role="alert">${esc(error.message)}</p>`; modal.querySelector('.close').onclick = close; }
    }

    async function platformChatDialog(ticketId) {
        const overlay = document.createElement('div'); overlay.className = 'overlay support-ticket-overlay';
        overlay.innerHTML = '<section class="modal support-ticket-modal platform-chat-modal" role="dialog" aria-modal="true" aria-label="Conversation avec le demandeur"><button type="button" class="close" aria-label="Fermer">×</button><p class="notification-empty">Chargement de la conversation…</p></section>';
        document.body.append(overlay);
        const modal = overlay.querySelector('.modal'); let timer;
        const close = () => { if (timer) clearInterval(timer); overlay.remove(); };
        overlay.querySelector('.close').onclick = close;
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
        const draw = data => {
            const ticket = data.ticket, mine = Number(ticket.assigned_agent_id) === state.userId, closed = ticket.status === 'closed';
            modal.innerHTML = `<button type="button" class="close" aria-label="Fermer">×</button><small>JETON ${esc(ticket.token)}</small><h3>${esc(ticket.organization_name)} · ${esc(ticket.requester_name)}</h3><div class="support-ticket-meta"><span>${esc(new Date(ticket.created_at).toLocaleString('fr-FR'))}</span><span class="support-status status-${esc(ticket.status)}">${esc(supportStatusLabels[ticket.status] || ticket.status)}</span><span>${ticket.agent_name ? `Agent : ${esc(ticket.agent_name)}` : 'En attente d’un agent'}</span></div><article class="support-message"><b>${esc(ticket.requester_name)} · Demande initiale</b><p>${esc(ticket.message)}</p></article><div class="support-thread platform-chat-thread">${data.messages.map(item => `<article class="support-message${item.is_agent ? ' agent-message' : ''}"><b>${esc(item.full_name)} · ${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</b><p>${esc(item.message)}</p></article>`).join('') || '<p class="notification-empty">Aucun message supplémentaire.</p>'}</div><p class="error" role="alert" data-platform-chat-error></p>${!ticket.assigned_agent_id && !closed ? '<button type="button" class="btn" data-platform-claim>Prendre en charge</button>' : ''}${mine && !closed ? '<form data-platform-reply class="support-reply-form"><label>Répondre au demandeur<textarea name="message" rows="3" maxlength="5000" required></textarea></label><button class="btn">Envoyer</button></form>' : ticket.assigned_agent_id && !mine ? `<p class="notification-empty">Ce chat est pris en charge par ${esc(ticket.agent_name || 'un autre agent')}.</p>` : ''}<form data-platform-status class="support-status-form"><label>Statut<select name="status">${Object.entries(supportStatusLabels).map(([value,label]) => `<option value="${value}"${ticket.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button class="table-action">Mettre à jour</button></form>`;
            modal.querySelector('.close').onclick = close;
            const thread = modal.querySelector('.platform-chat-thread'); thread.scrollTop = thread.scrollHeight;
            const claim = modal.querySelector('[data-platform-claim]');
            if (claim) claim.onclick = async () => {
                claim.disabled = true;
                try { await api(`/api/platform/support/${encodeURIComponent(ticketId)}/claim`, { method: 'POST' }); toast('Chat pris en charge.'); await refresh(); }
                catch (error) { const field = modal.querySelector('[data-platform-chat-error]'); if (field) field.textContent = error.message; }
            };
            const reply = modal.querySelector('[data-platform-reply]');
            if (reply) reply.onsubmit = async event => {
                event.preventDefault(); const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true;
                try { await api(`/api/platform/support/${encodeURIComponent(ticketId)}/messages`, { method: 'POST', body: JSON.stringify({ message: form.elements.message.value }) }); form.reset(); toast('Réponse envoyée.'); await refresh(); }
                catch (error) { const field = modal.querySelector('[data-platform-chat-error]'); if (field) field.textContent = error.message; }
                finally { if (button.isConnected) button.disabled = false; }
            };
            const statusForm = modal.querySelector('[data-platform-status]');
            statusForm.onsubmit = async event => {
                event.preventDefault(); const form = event.currentTarget;
                try { await api(`/api/platform/support/${encodeURIComponent(ticketId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: form.elements.status.value }) }); toast('Statut du chat mis à jour.'); await refresh(); }
                catch (error) { const field = modal.querySelector('[data-platform-chat-error]'); if (field) field.textContent = error.message; }
            };
        };
        const refresh = async (preserveDraft = false) => {
            try {
                const previous = modal.querySelector('[data-platform-reply] textarea');
                const draft = preserveDraft && previous ? previous.value : '', focused = preserveDraft && previous === document.activeElement;
                const cursor = focused ? previous.selectionStart : null;
                const data = await api(`/api/platform/support/${encodeURIComponent(ticketId)}`);
                if (overlay.isConnected) {
                    draw(data);
                    const next = modal.querySelector('[data-platform-reply] textarea');
                    if (next && previous) { next.value = draft; if (focused) { next.focus(); next.setSelectionRange(cursor, cursor); } }
                }
            }
            catch (error) { if (overlay.isConnected) { const field = modal.querySelector('[data-platform-chat-error]'); if (field) field.textContent = error.message; else toast(error.message, 'error'); } }
        };
        await refresh();
        timer = setInterval(() => { if (!overlay.isConnected) { clearInterval(timer); return; } refresh(true); }, 4000);
    }
    function support(root, activeTab = 'faq') {
        const tabs = [['faq', 'FAQ'], ['training', 'Formations'], ['tickets', 'Mes demandes'], ['live-chat', 'Chat en direct']];
        root.innerHTML = `<div class="settings-page"><div class="settings-tabs" role="tablist" aria-label="Assistance">${tabs.map(([id, label]) => `<button type="button" class="settings-tab${activeTab === id ? ' active' : ''}" id="support-tab-${id}" role="tab" aria-selected="${activeTab === id}" aria-controls="support-panel-${id}" data-support-tab="${id}">${label}</button>`).join('')}</div><section id="support-panel-${activeTab}" role="tabpanel" aria-labelledby="support-tab-${activeTab}"></section></div>`;
        root.querySelectorAll('[data-support-tab]').forEach(button => button.onclick = () => { const tab = button.dataset.supportTab; support(root, tab); location.hash = 'help'; });
        const panel = root.querySelector(`#support-panel-${activeTab}`);
        if (activeTab === 'faq') renderSupportFaq(panel);
        else if (activeTab === 'training') renderSupportTrainings(panel);
        else if (activeTab === 'tickets') renderSupportTickets(panel);
        else renderSupportLiveChat(panel);
    }
    async function renderSupportFaq(panel) {
        panel.innerHTML = '<section class="panel"><p class="notification-empty">Chargement des questions fréquentes…</p></section>';
        try {
            const entries = await api('/api/support/faq');
            if (!panel.isConnected) return;
            panel.innerHTML = `<section class="panel"><small>GUIDES RAPIDES</small><h3>Questions fréquentes</h3><p>Consultez ces réponses, ou ouvrez une demande pour signaler un problème.</p><div class="support-faq">${entries.map(item => `<details><summary>${esc(item.question)}${item.category ? ` <small>· ${esc(item.category)}</small>` : ''}</summary><p>${esc(item.answer)}</p></details>`).join('') || '<p class="notification-empty">Aucune réponse publiée pour le moment.</p>'}</div><button class="btn" type="button" data-open-support-tickets>＋ Créer une demande</button></section>`;
            panel.querySelector('[data-open-support-tickets]').onclick = () => { support(panel.closest('.settings-page').parentElement, 'tickets'); location.hash = 'help'; };
        } catch (error) {
            if (panel.isConnected) { panel.innerHTML = `<section class="panel"><h3>FAQ indisponible</h3><p class="error" role="alert">${esc(error.message)}</p><button class="btn" type="button" data-retry-faq>Réessayer</button></section>`; panel.querySelector('[data-retry-faq]').onclick = () => renderSupportFaq(panel); }
        }
    }
    async function renderSupportTrainings(panel) {
        panel.innerHTML = '<section class="panel"><p class="notification-empty">Chargement des formations…</p></section>';
        try {
            const items = await api('/api/support/trainings');
            if (!panel.isConnected) return;
            panel.innerHTML = `<section class="panel"><small>RESSOURCES REDAMS</small><h3>Formations et guides</h3><div class="support-training-list">${items.map(item => `<article class="support-training-card"><div><span class="support-status status-in_progress">${esc(item.format)}</span><h4>${esc(item.title)}</h4><p>${esc(item.description)}</p></div>${item.url ? `<a class="table-action" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Ouvrir la ressource</a>` : ''}</article>`).join('') || '<p class="notification-empty">Aucune formation publiée pour le moment.</p>'}</div></section>`;
        } catch (error) {
            if (panel.isConnected) { panel.innerHTML = `<section class="panel"><h3>Formations indisponibles</h3><p class="error" role="alert">${esc(error.message)}</p><button class="btn" type="button" data-retry-training>Réessayer</button></section>`; panel.querySelector('[data-retry-training]').onclick = () => renderSupportTrainings(panel); }
        }
    }
    async function renderSupportLiveChat(panel) {
        let token = '', pollTimer;
        const stopPolling = () => { if (pollTimer) clearInterval(pollTimer); pollTimer = null; };
        const showEntry = message => {
            panel.innerHTML = `<section class="panel"><div class="panel-head"><div><small>ASSISTANCE REDAMS</small><h3>Chat avec un agent</h3><p>Votre demande reçoit un jeton de suivi. Si aucun agent n’est disponible, elle reste en attente.</p></div></div><form data-chat-start class="support-create-form"><label>Décrivez votre besoin<textarea name="message" rows="4" minlength="10" maxlength="5000" required placeholder="Expliquez votre demande sans inclure de données médicales sensibles."></textarea></label><p class="error" role="alert"></p><button class="btn">Ouvrir un chat</button></form><form data-chat-token-form class="support-token-form"><label>Retrouver un chat avec son jeton<input name="token" maxlength="32" minlength="32" required autocomplete="off" placeholder="32 caractères"></label><button class="table-action">Retrouver</button></form>${message ? `<p class="error" role="alert">${esc(message)}</p>` : ''}</section>`;
            panel.querySelector('[data-chat-start]').onsubmit = async event => {
                event.preventDefault();
                const form = event.currentTarget, error = form.querySelector('.error');
                error.textContent = '';
                try {
                    const created = await api('/api/support/chat', { method: 'POST', body: JSON.stringify({ message: form.elements.message.value }) });
                    const chatToken = created.token || created.error?.token;
                    if (!chatToken) throw Error(created.message || 'Le chat n’a pas pu être démarré.');
                    sessionStorage.setItem('redams_support_chat_token', chatToken);
                    toast(created.message || 'Chat ouvert.');
                    await loadChat(chatToken);
                } catch (reason) { error.textContent = reason.message; }
            };
            panel.querySelector('[data-chat-token-form]').onsubmit = async event => {
                event.preventDefault();
                const entered = event.currentTarget.elements.token.value.trim().toUpperCase();
                await loadChat(entered);
            };
        };
        const loadChat = async (chatToken, background = false) => {
            token = chatToken;
            try {
                const data = await api(`/api/support/chat/${encodeURIComponent(token)}`);
                if (!panel.isConnected) { stopPolling(); return; }
                sessionStorage.setItem('redams_support_chat_token', token);
                const previousReply = panel.querySelector('[data-live-chat-reply] textarea');
                const draft = background && previousReply ? previousReply.value : '', focused = background && previousReply === document.activeElement;
                const cursor = focused ? previousReply.selectionStart : null;
                const ticket = data.ticket, closed = ticket.status === 'closed';
                panel.innerHTML = `<section class="panel support-live-chat"><div class="panel-head"><div><small>CHAT SÉCURISÉ · JETON ${esc(ticket.token)}</small><h3>${esc(ticket.organization_name || 'Conversation avec REDAMS')}</h3><p>${ticket.agent_name ? `Agent : ${esc(ticket.agent_name)}` : 'En attente d’un agent disponible'} · <span class="support-status status-${esc(ticket.status)}">${esc(supportStatusLabels[ticket.status] || ticket.status)}</span></p></div>${closed ? '<span class="support-status status-closed">Clôturé</span>' : ''}</div><div class="support-thread" data-live-chat-messages>${data.messages.map(item => `<article class="support-message${item.is_agent ? ' agent-message' : ''}"><b>${esc(item.full_name)} · ${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</b><p>${esc(item.message)}</p></article>`).join('') || '<p class="notification-empty">La conversation commence ici.</p>'}</div><p class="error" role="alert" data-live-chat-error></p>${closed ? '<p class="notification-empty">Ce chat est clôturé. Ouvrez un nouveau chat pour contacter l’assistance.</p>' : `<form data-live-chat-reply class="support-reply-form"><label>Votre message<textarea name="message" rows="3" maxlength="5000" required></textarea></label><button class="btn">Envoyer</button></form>`}<div class="support-chat-actions"><button type="button" class="table-action" data-live-chat-refresh>Actualiser</button>${closed ? '<button type="button" class="table-action" data-live-chat-new>Nouveau chat</button>' : '<button type="button" class="table-action" data-live-chat-close>Clôturer le chat</button>'}</div></section>`;
                const thread = panel.querySelector('[data-live-chat-messages]');
                const initial = document.createElement('article'), initialTitle = document.createElement('b'), initialMessage = document.createElement('p');
                initial.className = 'support-message'; initialTitle.textContent = `Vous · Demande initiale · ${new Date(ticket.created_at).toLocaleString('fr-FR')}`; initialMessage.textContent = ticket.message; initial.append(initialTitle, initialMessage); thread.prepend(initial);
                thread.scrollTop = thread.scrollHeight;
                const replyForm = panel.querySelector('[data-live-chat-reply]');
                if (replyForm) {
                    if (previousReply) { replyForm.elements.message.value = draft; if (focused) { replyForm.elements.message.focus(); replyForm.elements.message.setSelectionRange(cursor, cursor); } }
                    replyForm.onsubmit = async event => {
                    event.preventDefault();
                    const form = event.currentTarget, message = form.elements.message.value;
                    form.querySelector('button').disabled = true;
                    try {
                        await api(`/api/support/chat/${encodeURIComponent(token)}/messages`, { method: 'POST', body: JSON.stringify({ message }) });
                        form.reset(); toast('Message envoyé.'); await loadChat(token, true);
                    } catch (reason) { const error = panel.querySelector('[data-live-chat-error]'); if (error) error.textContent = reason.message; }
                    finally { if (form.isConnected) form.querySelector('button').disabled = false; }
                    };
                }
                panel.querySelector('[data-live-chat-refresh]').onclick = () => loadChat(token);
                const closeButton = panel.querySelector('[data-live-chat-close]');
                if (closeButton) closeButton.onclick = async () => {
                    try { await api(`/api/support/${encodeURIComponent(ticket.id)}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) }); toast('Chat clôturé.'); await loadChat(token); }
                    catch (reason) { const error = panel.querySelector('[data-live-chat-error]'); if (error) error.textContent = reason.message; }
                };
                const newButton = panel.querySelector('[data-live-chat-new]');
                if (newButton) newButton.onclick = () => { stopPolling(); sessionStorage.removeItem('redams_support_chat_token'); showEntry(''); };
                if (!pollTimer) pollTimer = setInterval(() => {
                    if (!panel.isConnected) { stopPolling(); return; }
                    loadChat(token, true);
                }, 4000);
            } catch (reason) {
                if (panel.isConnected) {
                    if (background) { const error = panel.querySelector('[data-live-chat-error]'); if (error) error.textContent = reason.message; }
                    else showEntry(reason.message);
                }
                if (!background) toast(reason.message, 'error');
            }
        };
        panel.innerHTML = '<div class="panel"><p class="notification-empty">Chargement du chat…</p></div>';
        const remembered = sessionStorage.getItem('redams_support_chat_token');
        if (remembered) { await loadChat(remembered); return; }
        try {
            const current = await api('/api/support/chat/current');
            if (!panel.isConnected) return;
            if (current?.token) { sessionStorage.setItem('redams_support_chat_token', current.token); await loadChat(current.token); }
            else showEntry('');
        } catch (error) { if (panel.isConnected) showEntry(error.message); toast(error.message, 'error'); }
    }
    async function renderSupportTickets(panel, offset = 0) {
        panel.innerHTML = '<div class="panel"><p class="notification-empty">Chargement des demandes…</p></div>';
        try {
            const limit = 50, result = await api(`/api/support?limit=${limit}&offset=${offset}`); if (!panel.isConnected) return;
            panel.innerHTML = `<section class="panel"><div class="panel-head"><div><small>ASSISTANCE DE L’ÉTABLISSEMENT</small><h3>Créer une demande</h3><p>Les demandes sont visibles par vous et les propriétaires ou administrateurs de votre établissement.</p></div></div><form class="support-create-form"><label>Sujet<input name="subject" maxlength="190" minlength="4" required placeholder="Ex. Problème à l’enregistrement d’une vente"></label><label>Description<textarea name="message" rows="4" minlength="10" maxlength="5000" required placeholder="Décrivez les étapes et le message d’erreur éventuel. N’incluez pas de données médicales sensibles."></textarea></label><p class="error" role="alert"></p><button class="btn">Envoyer la demande</button></form></section><section class="panel"><div class="panel-head"><div><h3>${state.canAdminister ? 'Demandes de l’établissement' : 'Mes demandes'}</h3><p>${state.canAdminister ? 'Consultez et mettez à jour les demandes soumises par les membres.' : 'Suivez les réponses et le statut de vos demandes.'}</p></div></div><div data-support-table></div></section>`;
            const form = panel.querySelector('.support-create-form');
            form.onsubmit = async event => {
                event.preventDefault(); const error = form.querySelector('.error'); error.textContent = '';
                try {
                    const created = await api('/api/support', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) });
                    toast('Demande d’assistance créée.'); await supportTicketDialog(panel, created.id, () => renderSupportTickets(panel)); await renderSupportTickets(panel);
                } catch (reason) { error.textContent = reason.message; }
            };
            const rows = result.items.map(ticket => ({ ...ticket, searchText: `${ticket.subject} ${ticket.message} ${ticket.requester_name} ${supportStatusLabels[ticket.status] || ticket.status}` }));
            const table = panel.querySelector('[data-support-table]');
            mountDataTable(table, { rows, searchText: 'Rechercher par sujet ou membre…', filters: [{ label: 'Statut', options: Object.entries(supportStatusLabels).map(([value, label]) => ({ value, label })), value: ticket => ticket.status }], emptyMessage: 'Aucune demande trouvée.', columns: [
                { label: 'Sujet', sortValue: ticket => ticket.subject, render: ticket => `<b>${esc(ticket.subject)}</b><small>Créée le ${esc(new Date(ticket.created_at).toLocaleDateString('fr-FR'))}</small>` },
                ...(state.canAdminister ? [{ label: 'Membre', sortValue: ticket => ticket.requester_name, render: ticket => esc(ticket.requester_name) }] : []),
                { label: 'Statut', sortValue: ticket => ticket.status, render: ticket => `<span class="support-status status-${esc(ticket.status)}">${esc(supportStatusLabels[ticket.status] || ticket.status)}</span>` },
                { label: 'Échanges', sortValue: ticket => Number(ticket.reply_count), render: ticket => esc(ticket.reply_count) },
                { label: 'Action', render: ticket => `<button class="table-action" type="button" data-support-open="${esc(ticket.id)}">Voir la demande</button>` }
            ] });
            table.onclick = event => {
                const button = event.target.closest('[data-support-open]');
                if (button && table.contains(button)) supportTicketDialog(panel, button.dataset.supportOpen, () => renderSupportTickets(panel));
            };
            const navigation = document.createElement('div'); navigation.className = 'table-footer';
            navigation.innerHTML = `<span>${result.total ? `${offset + 1}–${Math.min(offset + limit, result.total)} sur ${result.total}` : 'Aucune demande'}</span><button class="table-page" type="button" data-support-prev${offset === 0 ? ' disabled' : ''}>Précédent</button><button class="table-page" type="button" data-support-next${offset + limit >= result.total ? ' disabled' : ''}>Suivant</button>`;
            panel.querySelector('[data-support-table]').append(navigation);
            navigation.querySelector('[data-support-prev]').onclick = () => renderSupportTickets(panel, Math.max(0, offset - limit));
            navigation.querySelector('[data-support-next]').onclick = () => renderSupportTickets(panel, offset + limit);
        } catch (reason) {
            if (panel.isConnected) { toast(reason.message, 'error'); panel.innerHTML = `<div class="panel"><h3>Impossible de charger les demandes</h3><p class="error" role="alert">${esc(reason.message)}</p><button class="btn" type="button" data-support-retry>Réessayer</button></div>`; panel.querySelector('[data-support-retry]').onclick = () => renderSupportTickets(panel); }
        }
    }
    async function supportTicketDialog(panel, ticketId, onClose) {
        const overlay = document.createElement('div'); overlay.className = 'overlay support-ticket-overlay';
        overlay.innerHTML = '<section class="modal support-ticket-modal" role="dialog" aria-modal="true" aria-labelledby="support-ticket-heading"><button type="button" class="close" aria-label="Fermer">×</button><p class="notification-empty">Chargement de la demande…</p></section>';
        document.body.append(overlay);
        const modal = overlay.querySelector('.modal'), close = () => { overlay.remove(); if (panel.isConnected) onClose(); };
        overlay.querySelector('.close').onclick = close;
        overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        overlay.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
        const load = async () => {
            try {
                const data = await api(`/api/support/${encodeURIComponent(ticketId)}`);
                if (!overlay.isConnected) return;
                const ticket = data.ticket, closed = ticket.status === 'closed';
                const feedbackMarkup = data.feedback
                    ? `<section class="support-client-feedback"><b>Évaluation client : ${esc(data.feedback.rating)}/5</b>${data.feedback.comment ? `<p>${esc(data.feedback.comment)}</p>` : ''}</section>`
                    : Number(ticket.user_id) === state.userId && closed
                        ? '<form data-support-feedback class="support-reply-form"><h4>Évaluer cette demande</h4><label>Votre note<select name="rating" required><option value="">Choisir une note</option><option value="5">5 — Excellent</option><option value="4">4 — Très bien</option><option value="3">3 — Bien</option><option value="2">2 — À améliorer</option><option value="1">1 — Insatisfait</option></select></label><label>Commentaire (facultatif)<textarea name="comment" rows="3" maxlength="1000"></textarea></label><p class="error" role="alert"></p><button class="btn">Envoyer mon avis</button></form>'
                        : '';
                modal.innerHTML = `<button type="button" class="close" aria-label="Fermer">×</button><h3 id="support-ticket-heading">${esc(ticket.subject)}</h3><div class="support-ticket-meta"><span>${esc(ticket.requester_name)}</span><span>${esc(new Date(ticket.created_at).toLocaleString('fr-FR'))}</span><span class="support-status status-${esc(ticket.status)}">${esc(supportStatusLabels[ticket.status] || ticket.status)}</span></div><article class="support-message"><b>${esc(ticket.requester_name)} · Demande initiale</b><p>${esc(ticket.message)}</p></article><div class="support-thread">${data.messages.map(message => `<article class="support-message"><b>${esc(message.full_name)} · ${esc(new Date(message.created_at).toLocaleString('fr-FR'))}</b><p>${esc(message.message)}</p></article>`).join('') || '<p class="notification-empty">Aucun échange supplémentaire.</p>'}</div>${feedbackMarkup}${state.canAdminister ? `<form data-support-status-form class="support-status-form"><label>Statut<select name="status">${Object.entries(supportStatusLabels).map(([value, label]) => `<option value="${value}"${ticket.status === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><p class="error" role="alert"></p><button class="table-action">Mettre à jour le statut</button></form>` : Number(ticket.user_id) === state.userId && !closed ? '<button type="button" class="table-action" data-support-close-ticket>Clôturer ma demande</button>' : ''}${closed ? '<p class="notification-empty">Cette demande est clôturée. Contactez un administrateur pour la rouvrir.</p>' : `<form data-support-reply-form class="support-reply-form"><label>Ajouter une réponse<textarea name="message" rows="3" maxlength="5000" minlength="2" required></textarea></label><p class="error" role="alert"></p><button class="btn">Envoyer la réponse</button></form>`}`;
                modal.querySelector('.close').onclick = close;
                const statusForm = modal.querySelector('[data-support-status-form]');
                if (statusForm) statusForm.onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, error = form.querySelector('.error'); error.textContent = '';
                    try { await api(`/api/support/${encodeURIComponent(ticketId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: form.elements.status.value }) }); toast('Statut de la demande mis à jour.'); await load(); }
                    catch (reason) { error.textContent = reason.message; }
                };
                const closeButton = modal.querySelector('[data-support-close-ticket]');
                if (closeButton) closeButton.onclick = async () => {
                    try { await api(`/api/support/${encodeURIComponent(ticketId)}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) }); toast('Demande clôturée.'); await load(); }
                    catch (reason) { toast(reason.message, 'error'); }
                };
                const feedbackForm = modal.querySelector('[data-support-feedback]');
                if (feedbackForm) feedbackForm.onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, error = form.querySelector('.error'); error.textContent = '';
                    try { await api(`/api/support/${encodeURIComponent(ticketId)}/feedback`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); toast('Merci pour votre évaluation.'); await load(); }
                    catch (reason) { error.textContent = reason.message; }
                };
                const replyForm = modal.querySelector('[data-support-reply-form]');
                if (replyForm) replyForm.onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, error = form.querySelector('.error'); error.textContent = '';
                    try { await api(`/api/support/${encodeURIComponent(ticketId)}/messages`, { method: 'POST', body: JSON.stringify({ message: form.elements.message.value }) }); toast('Réponse ajoutée.'); await load(); }
                    catch (reason) { error.textContent = reason.message; }
                };
            } catch (reason) {
                if (overlay.isConnected) { modal.innerHTML = `<button type="button" class="close" aria-label="Fermer">×</button><h3>Demande indisponible</h3><p class="error" role="alert">${esc(reason.message)}</p>`; modal.querySelector('.close').onclick = close; }
            }
        };
        await load();
    }
    function placeholder(root, p) { const desc = { pos: 'Panier de vente et lecture code-barres.', invoices: 'Factures, reçus, paiements et remboursements.', reports: 'Indicateurs et rapports détaillés.', users: 'Gestion des utilisateurs et de leurs rôles.', audit: 'Journal en lecture seule des opérations de l’établissement.' }; root.innerHTML = `<div class="panel"><small>MODULE</small><h3>${titles[p]}</h3><p>${desc[p] || 'Extension prévue dans la feuille de route.'}</p></div>`; }
    const reportNumber = value => { const number = Number(value); return Number.isFinite(number) ? number : 0; };
    const reportMoney = value => `${reportNumber(value).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${esc(state.settings.currency || 'XAF')}`;
    function reportChart(container, { title, series, format = value => String(value) }) {
        const width = 760, height = 260, padding = { top: 24, right: 20, bottom: 42, left: 76 }, plotWidth = width - padding.left - padding.right, plotHeight = height - padding.top - padding.bottom;
        const allPoints = series.flatMap(item => item.values), lastIndex = Math.max(0, ...allPoints.map((point, index) => point.x ?? index)), maximum = Math.max(1, ...allPoints.map(point => reportNumber(point.value))), yAt = value => padding.top + plotHeight - reportNumber(value) / maximum * plotHeight, xAt = index => padding.left + (lastIndex < 1 ? plotWidth / 2 : index * plotWidth / lastIndex);
        const colors = ['#168a62', '#f1a340', '#6375d6', '#e36b5d'], grid = Array.from({ length: 5 }, (_, index) => { const value = maximum * index / 4, y = yAt(value); return `<g class="report-grid-line"><line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/><text x="${padding.left - 10}" y="${y + 4}" text-anchor="end">${esc(format(value))}</text></g>`; }).join('');
        const axisPoints = new Map(); allPoints.forEach((point, index) => axisPoints.set(point.x ?? index, point.label)); const axis = [...axisPoints.entries()].sort((a, b) => a[0] - b[0]), interval = Math.max(1, Math.ceil(axis.length / 7)), labels = axis.map(([index, label], position) => position % interval === 0 || position === axis.length - 1 ? `<text class="report-axis-label" x="${xAt(index)}" y="${height - 12}" text-anchor="middle">${esc(label)}</text>` : '').join('');
        const paths = series.map((item, seriesIndex) => { const color = colors[seriesIndex % colors.length], pointsWithIndex = item.values.map((point, index) => ({ point, index: point.x ?? index })), path = pointsWithIndex.map(({ point, index }, position) => `${position ? 'L' : 'M'} ${xAt(index)} ${yAt(point.value)}`).join(' '), points = pointsWithIndex.map(({ point, index }) => `<circle class="report-chart-point" cx="${xAt(index)}" cy="${yAt(point.value)}" r="3.5" fill="${color}"><title>${esc(point.label)} · ${esc(item.name)} : ${esc(format(point.value))}</title></circle>`).join(''); return `<g><path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${points}</g>`; }).join('');
        const legend = series.map((item, index) => `<span><i style="--legend-color:${colors[index % colors.length]}"></i>${esc(item.name)}</span>`).join('');
        container.innerHTML = `<div class="report-chart-head"><h3>${esc(title)}</h3><div class="report-chart-legend">${legend}</div></div><div class="report-chart-scroll"><svg class="report-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${grid}${labels}${paths}</svg></div>`;
    }
    async function reports(root, days = 30) {
        root.innerHTML = '<div class="panel"><p class="notification-empty">Chargement des rapports…</p></div>';
        try {
            const data = await api(`/api/reports?days=${days}`);
            if (!root.isConnected) return;
            const dateKey = value => typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10), today = new Date();
            const salesMap = new Map(data.sales.map(row => [dateKey(row.report_date), row])), refundMap = new Map(data.returns.map(row => [dateKey(row.report_date), row]));
            const allDays = Array.from({ length: days * 2 }, (_, index) => {
                const day = new Date(today); day.setDate(today.getDate() - (days * 2 - 1 - index));
                const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, sale = salesMap.get(key) || {}, refund = refundMap.get(key) || {};
                return { date: key, label: day.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }), gross: reportNumber(sale.gross_revenue), refund: reportNumber(refund.refunds), net: reportNumber(sale.gross_revenue) - reportNumber(refund.refunds), invoices: reportNumber(sale.invoice_count) };
            });
            const previous = allDays.slice(0, days), current = allDays.slice(days), sum = (rows, key) => rows.reduce((total, row) => total + reportNumber(row[key]), 0);
            const revenue = sum(current, 'net'), previousRevenue = sum(previous, 'net'), gross = sum(current, 'gross'), refunds = sum(current, 'refund'), invoiceCount = sum(current, 'invoices');
            const comparison = (value, baseline) => baseline ? (value - baseline) / Math.abs(baseline) * 100 : null, compareLabel = value => value === null ? 'Aucune période comparable' : `${value >= 0 ? '+' : ''}${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % vs période précédente`;
            const stock = data.products.map(item => ({ ...item, quantity: reportNumber(item.quantity_on_hand), reorder: reportNumber(item.reorder_level), sold: reportNumber(item.units_sold), price: reportNumber(item.sale_price), netRevenue: reportNumber(item.net_revenue) }));
            const low = stock.filter(item => item.quantity <= item.reorder), out = stock.filter(item => item.quantity <= 0), unitsSold = stock.reduce((total, item) => total + item.sold, 0), dailyUnits = unitsSold / days;
            const inventoryValue = stock.reduce((total, item) => total + item.quantity * item.price, 0), bestSellers = stock.filter(item => item.sold > 0).sort((a, b) => b.sold - a.sold);
            const categories = data.categories.map(item => ({ ...item, units: reportNumber(item.units_sold), netRevenue: reportNumber(item.net_revenue) })), categoryRevenue = categories.reduce((total, item) => total + item.netRevenue, 0);
            const topFiveShare = categoryRevenue ? categories.slice(0, 5).reduce((total, item) => total + item.netRevenue, 0) / categoryRevenue * 100 : 0;
            const orderCount = data.purchases.reduce((total, item) => total + reportNumber(item.order_count), 0), orderValue = data.purchases.reduce((total, item) => total + reportNumber(item.ordered_value), 0);
            const movementSeries = ['IN', 'OUT', 'ADJUSTMENT'].map(type => ({ name: { IN: 'Entrées', OUT: 'Sorties', ADJUSTMENT: 'Ajustements' }[type], values: current.map(day => ({ label: day.label, value: data.movements.filter(item => dateKey(item.report_date) === day.date && item.movement_type === type).reduce((total, item) => total + reportNumber(item.quantity), 0) })) }));
            const forecast = Array.from({ length: 14 }, (_, index) => ({ day: index + 1, revenue: revenue / days, stock: stock.reduce((total, item) => total + Math.max(0, item.quantity - (item.sold / days) * (index + 1)), 0) }));
            const labels = [['overview', 'Synthèse'], ['sales', 'Ventes'], ['stock', 'Stocks'], ['market', 'Tendances internes'], ['forecast', 'Prévisions']];
            root.innerHTML = `<div class="report-page"><div class="report-toolbar"><div><h3>Tableau de pilotage</h3><p>Analyses calculées à partir des données enregistrées dans REDAMS-STK.</p></div><div class="report-actions"><label>Période<select data-report-days>${[7, 30, 90, 365].map(value => `<option value="${value}"${value === days ? ' selected' : ''}>${value} jours</option>`).join('')}</select></label><button class="table-action" type="button" data-report-export>Exporter CSV</button></div></div><p class="report-data-note">Les tendances de marché décrivent uniquement votre activité interne. Les ventes globales incluent les taxes; les comparaisons par produit et catégorie sont estimées hors taxes. Les prévisions reposent sur la moyenne de la période choisie, sans données externes ni saisonnalité.</p><div class="settings-tabs report-tabs" role="tablist" aria-label="Rapports et analyses">${labels.map(([id, label], index) => `<button type="button" class="settings-tab${index === 0 ? ' active' : ''}" role="tab" aria-selected="${index === 0}" aria-controls="report-panel-${id}" data-report-tab="${id}">${label}</button>`).join('')}</div>
  <section class="report-panel" role="tabpanel" id="report-panel-overview"><div class="report-kpis"><article class="report-kpi green"><small>Ventes nettes</small><b>${reportMoney(revenue)}</b><span>${compareLabel(comparison(revenue, previousRevenue))}</span></article><article class="report-kpi blue"><small>Factures émises</small><b>${invoiceCount}</b><span>${compareLabel(comparison(invoiceCount, sum(previous, 'invoices')))}</span></article><article class="report-kpi orange"><small>Articles vendus</small><b>${unitsSold.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</b><span>sur ${days} jours</span></article><article class="report-kpi red"><small>Références à réapprovisionner</small><b>${low.length}</b><span>${out.length} en rupture de stock</span></article></div><div class="report-grid"><article class="report-card" data-overview-chart></article><article class="report-card report-callouts"><h3>À surveiller</h3><p>${low.length ? `${low.length} référence(s) au seuil ou en dessous.` : 'Aucun produit au seuil de réapprovisionnement.'}</p><p>${refunds ? `Remboursements : ${reportMoney(refunds)}.` : 'Aucun remboursement sur la période.'}</p><p>${orderCount ? `${orderCount} commande(s), ${reportMoney(orderValue)} de valeur commandée.` : 'Aucune commande sur la période.'}</p></article></div></section>
  <section class="report-panel" role="tabpanel" id="report-panel-sales" hidden><div class="report-kpis"><article class="report-kpi green"><small>Ventes brutes</small><b>${reportMoney(gross)}</b><span>${days} jours</span></article><article class="report-kpi red"><small>Remboursements</small><b>${reportMoney(refunds)}</b><span>déduits des ventes nettes</span></article><article class="report-kpi blue"><small>Panier moyen</small><b>${reportMoney(invoiceCount ? gross / invoiceCount : 0)}</b><span>par facture émise</span></article><article class="report-kpi purple"><small>Évolution nette</small><b>${comparison(revenue, previousRevenue) === null ? '—' : `${comparison(revenue, previousRevenue) >= 0 ? '+' : ''}${comparison(revenue, previousRevenue).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`}</b><span>vs période précédente</span></article></div><article class="report-card" data-sales-chart></article><article class="report-card"><h3>Meilleurs produits par quantité vendue</h3><div data-report-products></div></article></section>
  <section class="report-panel" role="tabpanel" id="report-panel-stock" hidden><div class="report-kpis"><article class="report-kpi blue"><small>Valeur au prix catalogue</small><b>${reportMoney(inventoryValue)}</b><span>stock actif estimé</span></article><article class="report-kpi orange"><small>Stock faible</small><b>${low.length}</b><span>au seuil ou en dessous</span></article><article class="report-kpi red"><small>Ruptures</small><b>${out.length}</b><span>références sans stock</span></article><article class="report-kpi green"><small>Unités vendues</small><b>${unitsSold.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</b><span>en ${days} jours</span></article></div><article class="report-card" data-stock-chart></article><article class="report-card"><h3>Couverture et risques de rupture</h3><p class="report-note">La couverture suppose une consommation quotidienne constante calculée sur les ${days} jours sélectionnés.</p><div data-report-stock></div></article></section>
  <section class="report-panel" role="tabpanel" id="report-panel-market" hidden><div class="report-kpis"><article class="report-kpi purple"><small>Catégorie principale</small><b>${esc(categories[0]?.category || '—')}</b><span>${reportMoney(categories[0]?.netRevenue || 0)} HT estimés</span></article><article class="report-kpi blue"><small>Part du top 5 catégories</small><b>${topFiveShare.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %</b><span>concentration des ventes internes</span></article><article class="report-kpi green"><small>Revenu moyen quotidien</small><b>${reportMoney(revenue / days)}</b><span>ventes nettes TTC</span></article><article class="report-kpi orange"><small>Commandes d’achat</small><b>${orderCount}</b><span>${reportMoney(orderValue)} valeur commandée</span></article></div><div class="report-grid"><article class="report-card" data-category-chart></article><article class="report-card"><h3>Analyse interne</h3><p>${bestSellers[0] ? `Produit le plus vendu : <b>${esc(bestSellers[0].name)}</b> (${bestSellers[0].sold.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${esc(bestSellers[0].unit)}).` : 'Aucune vente de produit sur la période.'}</p><p class="report-note">Les ventes par catégorie sont estimées hors taxes. Ces indicateurs n’estiment pas les parts de marché externes et ne mesurent pas la demande des concurrents.</p></article></div><article class="report-card"><h3>Ventes HT estimées par catégorie</h3><div data-report-categories></div></article></section>
  <section class="report-panel" role="tabpanel" id="report-panel-forecast" hidden><div class="report-kpis"><article class="report-kpi blue"><small>Revenu quotidien de référence</small><b>${reportMoney(revenue / days)}</b><span>moyenne nette historique</span></article><article class="report-kpi green"><small>Demande quotidienne moyenne</small><b>${dailyUnits.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</b><span>unités nettes vendues</span></article><article class="report-kpi red"><small>Ruptures imminentes</small><b>${stock.filter(item => { const rate = item.sold / days; return item.quantity <= item.reorder || (rate > 0 && (item.quantity - item.reorder) / rate <= 14); }).length}</b><span>au seuil ou seuil estimé sous 14 jours</span></article><article class="report-kpi orange"><small>Stock projeté à 14 jours</small><b>${forecast[13].stock.toLocaleString('fr-FR', { maximumFractionDigits: 3 })}</b><span>unités estimées restantes</span></article></div><article class="report-card" data-forecast-chart></article><p class="report-data-note">Scénario de référence non garanti : prolonge la moyenne quotidienne observée. Il ignore les ruptures fournisseurs, promotions, saisonnalité et changements de prix.</p><article class="report-card"><h3>Couverture prévisionnelle des produits</h3><div data-report-forecast></div></article></section></div>`;
            root.querySelector('[data-report-days]').onchange = event => reports(root, Number(event.target.value));
            root.querySelectorAll('[data-report-tab]').forEach(button => button.onclick = () => { const id = button.dataset.reportTab; root.querySelectorAll('[data-report-tab]').forEach(tab => { const selected = tab === button; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); }); root.querySelectorAll('.report-panel').forEach(panel => { panel.hidden = panel.id !== `report-panel-${id}`; }); });
            const csvEscape = value => `"${String(value ?? '').replace(/"/g, '""')}"`, csv = [['Type', 'Date / produit', 'Catégorie / statut', 'Montant / quantité']];
            current.forEach(day => csv.push(['Ventes', day.date, 'Brut', day.gross], ['Remboursements', day.date, 'Retours', day.refund]));
            stock.forEach(item => csv.push(['Stock', item.name, item.category, `Stock=${item.quantity}; Ventes=${item.sold}; Prix=${item.price}`]));
            root.querySelector('[data-report-export]').onclick = () => { const url = URL.createObjectURL(new Blob([`\uFEFF${csv.map(row => row.map(csvEscape).join(';')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = `rapports-redams-${days}-jours.csv`; link.click(); URL.revokeObjectURL(url); };
            reportChart(root.querySelector('[data-overview-chart]'), { title: 'Évolution des ventes nettes', series: [{ name: 'Période précédente', values: previous.map(day => ({ label: day.label, value: day.net })) }, { name: 'Période sélectionnée', values: current.map(day => ({ label: day.label, value: day.net })) }], format: reportMoney });
            reportChart(root.querySelector('[data-sales-chart]'), { title: 'Ventes brutes et remboursements', series: [{ name: 'Ventes brutes', values: current.map(day => ({ label: day.label, value: day.gross })) }, { name: 'Remboursements', values: current.map(day => ({ label: day.label, value: day.refund })) }], format: reportMoney });
            reportChart(root.querySelector('[data-stock-chart]'), { title: 'Mouvements de stock par type', series: movementSeries, format: value => value.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) });
            reportChart(root.querySelector('[data-category-chart]'), { title: 'Ventes HT estimées par catégorie', series: [{ name: 'Ventes HT', values: categories.slice(0, 8).map(item => ({ label: item.category, value: item.netRevenue })) }], format: reportMoney });
            const observed14 = [...previous.slice(-Math.max(0, 14 - current.length)), ...current].slice(-14);
            reportChart(root.querySelector('[data-forecast-chart]'), { title: 'Projection du revenu quotidien', series: [{ name: 'Ventes observées', values: observed14.map((day, index) => ({ x: index, label: day.label, value: day.net })) }, { name: 'Projection moyenne', values: [{ x: 13, label: 'Aujourd’hui', value: observed14[observed14.length - 1]?.net || 0 }, ...forecast.map(item => ({ x: 13 + item.day, label: `J+${item.day}`, value: item.revenue }))] }], format: reportMoney });
            mountDataTable(root.querySelector('[data-report-products]'), {
                rows: bestSellers.map(item => ({ ...item, searchText: `${item.name} ${item.sku} ${item.category}` })), searchText: 'Rechercher par produit ou catégorie…', columns: [
                    { label: 'Produit', sortValue: item => item.name, render: item => `<b>${esc(item.name)}</b><small>${esc(item.sku)} · ${esc(item.category || 'Sans catégorie')}</small>` },
                    { label: 'Quantité nette', sortValue: item => item.sold, render: item => `${item.sold.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${esc(item.unit)}` },
                    { label: 'Ventes estimées HT', sortValue: item => item.netRevenue, render: item => reportMoney(item.netRevenue) }
                ]
            });
            mountDataTable(root.querySelector('[data-report-categories]'), {
                rows: categories.map(item => ({ ...item, searchText: item.category })), searchText: 'Rechercher une catégorie…', columns: [
                    { label: 'Catégorie', sortValue: item => item.category, render: item => esc(item.category) },
                    { label: 'Unités nettes', sortValue: item => item.units, render: item => item.units.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) },
                    { label: 'Ventes estimées HT', sortValue: item => item.netRevenue, render: item => reportMoney(item.netRevenue) },
                    { label: 'Factures', sortValue: item => reportNumber(item.invoice_count), render: item => esc(item.invoice_count) }
                ]
            });
            const stockRisk = stock.map(item => ({ ...item, daysCover: item.sold ? item.quantity / (item.sold / days) : null, daysToReorder: item.sold && item.quantity > item.reorder ? (item.quantity - item.reorder) / (item.sold / days) : null })).sort((a, b) => (a.daysToReorder ?? Infinity) - (b.daysToReorder ?? Infinity));
            mountDataTable(root.querySelector('[data-report-stock]'), {
                rows: stockRisk.map(item => ({ ...item, searchText: `${item.name} ${item.sku} ${item.category}` })), searchText: 'Rechercher par produit…', filters: [{ label: 'Risque', options: [{ value: 'low', label: 'Sous le seuil' }, { value: 'soon', label: 'Seuil sous 14 jours' }, { value: 'ok', label: 'Couverture supérieure à 14 jours' }], value: item => item.quantity <= item.reorder ? 'low' : item.daysToReorder !== null && item.daysToReorder <= 14 ? 'soon' : 'ok' }], columns: [
                    { label: 'Produit', sortValue: item => item.name, render: item => `<b>${esc(item.name)}</b><small>${esc(item.sku)}</small>` },
                    { label: 'Stock / seuil', sortValue: item => item.quantity - item.reorder, render: item => `${item.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} / ${item.reorder.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${esc(item.unit)}` },
                    { label: 'Vendu', sortValue: item => item.sold, render: item => item.sold.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) },
                    { label: 'Couverture estimée', sortValue: item => item.daysCover ?? Infinity, render: item => item.daysCover === null ? 'Données insuffisantes' : `${item.daysCover.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} jours` },
                    { label: 'Alerte', render: item => item.quantity <= item.reorder ? '<span class="report-badge danger">À réapprovisionner</span>' : item.daysToReorder !== null && item.daysToReorder <= 14 ? `<span class="report-badge warning">Seuil estimé dans ${item.daysToReorder.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j</span>` : '<span class="report-badge success">Couverture correcte</span>' }
                ]
            });
            mountDataTable(root.querySelector('[data-report-forecast]'), {
                rows: stockRisk.map(item => ({ ...item, projected: Math.max(0, item.quantity - item.sold / days * 14), searchText: `${item.name} ${item.sku}` })), searchText: 'Rechercher par produit…', filters: [{ label: 'Projection', options: [{ value: 'below', label: 'Sous le seuil en 14 jours' }, { value: 'above', label: 'Au-dessus du seuil en 14 jours' }], value: item => item.projected <= item.reorder ? 'below' : 'above' }], columns: [
                    { label: 'Produit', sortValue: item => item.name, render: item => `<b>${esc(item.name)}</b><small>${esc(item.sku)}</small>` },
                    { label: 'Stock actuel', sortValue: item => item.quantity, render: item => `${item.quantity.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${esc(item.unit)}` },
                    { label: 'Stock estimé à 14 j', sortValue: item => item.projected, render: item => `${item.projected.toLocaleString('fr-FR', { maximumFractionDigits: 3 })} ${esc(item.unit)}` },
                    { label: 'Seuil', sortValue: item => item.reorder, render: item => item.reorder.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) },
                    { label: 'Projection', render: item => item.projected <= item.reorder ? '<span class="report-badge danger">Action à évaluer</span>' : '<span class="report-badge success">Au-dessus du seuil</span>' }
                ]
            });
        } catch (error) { if (root.isConnected) { const message = error.status === 400 ? 'La période demandée n’est pas prise en charge. Choisissez 7, 30, 90 ou 365 jours.' : error.status >= 500 ? 'Le service de rapports est temporairement indisponible. Vos données restent intactes; réessayez dans quelques instants.' : error.message === 'Failed to fetch' || error.message.startsWith('Connexion au serveur') ? 'Impossible de joindre le service de rapports. Vérifiez votre connexion puis réessayez.' : 'Impossible de charger les rapports pour le moment. Réessayez ou contactez votre administrateur.'; toast(message, 'error'); root.innerHTML = `<div class="panel report-error-panel"><h3>Rapports temporairement indisponibles</h3><p class="error" role="alert">${esc(message)}</p><button class="btn" type="button" data-retry-reports>Réessayer</button></div>`; root.querySelector('[data-retry-reports]').onclick = () => reports(root, days); } }
    }
    const patientGenders = { F: 'Femme', M: 'Homme', OTHER: 'Autre', UNSPECIFIED: 'Non renseigné' };
    async function patients(root) {
        try {
            const rows = await api('/api/patients?includeArchived=1');
            root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Dossiers patients</h3><p>Coordonnées du patient et accès contrôlé aux antécédents.</p></div><button class="btn" id="add-patient">＋ Nouveau patient</button></div><div data-patients-table></div></div>`;
            mountDataTable(root.querySelector('[data-patients-table]'), {
                rows: rows.map(patient => ({ ...patient, searchText: [patient.patient_code, patient.full_name, patient.phone, patient.email].join(' ') })), searchText: 'Rechercher par code, nom, téléphone ou courriel…', filters: [{ label: 'Statut', options: [{ value: 'active', label: 'Actif' }, { value: 'archived', label: 'Archivé' }], value: patient => patient.is_active ? 'active' : 'archived' }, { label: 'Genre', options: Object.entries(patientGenders).map(([value, label]) => ({ value, label })), value: patient => patient.gender }], columns: [
                    { label: 'Code patient', sortValue: patient => patient.patient_code, render: patient => `<b>${esc(patient.patient_code)}</b>` },
                    { label: 'Nom complet', sortValue: patient => patient.full_name, render: patient => esc(patient.full_name) },
                    { label: 'Naissance', sortValue: patient => patient.birth_date ? new Date(`${String(patient.birth_date).slice(0, 10)}T00:00:00`).getTime() : 0, render: patient => patient.birth_date ? esc(new Date(`${String(patient.birth_date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR')) : '—' },
                    { label: 'Genre', sortValue: patient => patientGenders[patient.gender] || patientGenders.UNSPECIFIED, render: patient => esc(patientGenders[patient.gender] || patientGenders.UNSPECIFIED) },
                    { label: 'Coordonnées', sortValue: patient => patient.phone || patient.email || '', render: patient => `${esc(patient.phone || '—')}<small>${esc(patient.email || '')}</small>` },
                    { label: 'Statut', sortValue: patient => patient.is_active ? 'Actif' : 'Archivé', render: patient => `<span class="tag">${patient.is_active ? 'Actif' : 'Archivé'}</span>` },
                    { label: 'Actions', render: patient => `<button class="table-action" type="button" data-view-patient="${esc(patient.id)}">Consulter</button>${state.canAccessPatientRecords ? `<button class="table-action" type="button" data-medical-history="${esc(patient.id)}">Antécédents</button>` : ''}${patient.is_active ? `<button class="table-action" type="button" data-edit-patient="${esc(patient.id)}">Modifier</button><button class="table-action danger" type="button" data-archive-patient="${esc(patient.id)}">Archiver</button>` : `<button class="table-action" type="button" data-restore-patient="${esc(patient.id)}">Réactiver</button>`}` }
                ]
            });
            $('#add-patient').onclick = () => patientForm(root);
            root.querySelectorAll('[data-view-patient]').forEach(button => button.onclick = () => patientRecord(root, rows.find(patient => String(patient.id) === button.dataset.viewPatient)));
            root.querySelectorAll('[data-medical-history]').forEach(button => button.onclick = () => medicalHistory(root, rows.find(patient => String(patient.id) === button.dataset.medicalHistory)));
            root.querySelectorAll('[data-edit-patient]').forEach(button => button.onclick = () => patientForm(root, rows.find(patient => String(patient.id) === button.dataset.editPatient)));
            root.querySelectorAll('[data-archive-patient]').forEach(button => button.onclick = async () => { const patient = rows.find(item => String(item.id) === button.dataset.archivePatient); if (!patient || !confirm(`Archiver le dossier de ${patient.full_name} ?`)) return; try { await api(`/api/patients/${encodeURIComponent(patient.id)}`, { method: 'DELETE' }); toast('Dossier patient archivé.'); await patients(root); } catch (error) { toast(error.message); } });
            root.querySelectorAll('[data-restore-patient]').forEach(button => button.onclick = async () => { const patient = rows.find(item => String(item.id) === button.dataset.restorePatient); if (!patient || !confirm(`Réactiver le dossier de ${patient.full_name} ?`)) return; try { await api(`/api/patients/${encodeURIComponent(patient.id)}/restore`, { method: 'POST' }); toast('Dossier patient réactivé.'); await patients(root); } catch (error) { toast(error.message); } });
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    async function patientRecord(root, patient) {
        if (!patient) return;
        const modal = document.createElement('div'); modal.className = 'overlay patient-record-overlay';
        const fmt = value => value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—';
        const canHistory = Boolean(state.canAccessPatientRecords);
        modal.innerHTML = `<section class="patient-record" role="dialog" aria-modal="true" aria-label="Dossier de ${esc(patient.full_name)}"><header class="patient-record-head"><div><small>${esc(patient.patient_code)}</small><h2>${esc(patient.full_name)}</h2></div><div class="patient-record-actions">${patient.is_active ? '<button class="table-action" type="button" data-record-edit>Modifier</button>' : ''}${canHistory ? '<button class="table-action" type="button" data-record-history>Gérer les antécédents</button>' : ''}<button class="btn" type="button" data-record-close>Fermer</button></div></header><div class="patient-record-body"><section class="panel"><h3>Identité & coordonnées</h3><dl class="patient-record-grid"><div><dt>Code patient</dt><dd>${esc(patient.patient_code)}</dd></div><div><dt>Nom complet</dt><dd>${esc(patient.full_name)}</dd></div><div><dt>Date de naissance</dt><dd>${esc(fmt(patient.birth_date))}</dd></div><div><dt>Genre</dt><dd>${esc(patientGenders[patient.gender] || patientGenders.UNSPECIFIED)}</dd></div><div><dt>Téléphone</dt><dd>${esc(patient.phone || '—')}</dd></div><div><dt>Courriel</dt><dd>${esc(patient.email || '—')}</dd></div><div><dt>Adresse</dt><dd>${esc(patient.address || '—')}</dd></div><div><dt>Statut</dt><dd>${patient.is_active ? 'Actif' : 'Archivé'}</dd></div></dl></section>${canHistory ? '<section class="panel"><h3>Antécédents</h3><div data-record-history-list><p class="notification-empty">Chargement…</p></div></section>' : ''}</div></section>`;
        document.body.append(modal);
        const close = () => modal.remove(); modal.querySelector('[data-record-close]').onclick = close;
        modal.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
        modal.querySelector('[data-record-edit]')?.addEventListener('click', () => { close(); patientForm(root, patient); });
        modal.querySelector('[data-record-history]')?.addEventListener('click', () => { close(); medicalHistory(root, patient); });
        modal.querySelector('[data-record-close]').focus();
        if (!canHistory) return;
        const list = modal.querySelector('[data-record-history-list]');
        try {
            const records = await api(`/api/patients/${encodeURIComponent(patient.id)}/medical-history`);
            list.innerHTML = records.length ? records.map(record => `<article class="medical-history-item${record.review_flag ? ' needs-review' : ''}"><h4>${esc(record.condition_name)}${record.condition_code ? ` <small>· ${esc(record.condition_code)}</small>` : ''}</h4><small>${esc(fmt(record.start_date))} – ${esc(fmt(record.end_date))} · ${esc(historyStatuses[record.status] || record.status)}</small>${record.notes ? `<p>${esc(record.notes)}</p>` : ''}</article>`).join('') : '<p class="notification-empty">Aucun antécédent enregistré.</p>';
        } catch (error) { if (list.isConnected) list.innerHTML = `<p class="error">${esc(error.message)}</p>`; }
    }
    async function patientForm(root, patient = null) {
        const editing = Boolean(patient), modal = document.createElement('div'); modal.className = 'overlay';
        let autoCode = false;
        if (!editing) { try { autoCode = (await api('/api/settings')).patient_code_mode === 'auto'; } catch { autoCode = false; } }
        const codeField = autoCode ? '<label>Code patient<input value="" placeholder="Généré automatiquement" disabled></label>' : `<label>Code patient<input name="patient_code" maxlength="80" required value="${esc(patient?.patient_code || '')}"></label>`;
        modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${editing ? 'Modifier le dossier' : 'Nouveau patient'}</h3>${codeField}<label>Nom complet<input name="full_name" maxlength="190" required value="${esc(patient?.full_name || '')}"></label><div class="two"><label>Date de naissance<input name="birth_date" type="date" value="${esc(patient?.birth_date ? String(patient.birth_date).slice(0, 10) : '')}"></label><label>Genre<select name="gender">${Object.entries(patientGenders).map(([value, label]) => `<option value="${value}" ${patient?.gender === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="two"><label>Téléphone<input name="phone" maxlength="50" value="${esc(patient?.phone || '')}"></label><label>Courriel<input name="email" type="email" maxlength="190" value="${esc(patient?.email || '')}"></label></div><label>Adresse<textarea name="address" rows="2">${esc(patient?.address || '')}</textarea></label><p class="notification-empty">Les antécédents disposent d’un accès séparé réservé aux rôles autorisés.</p><button class="btn">${editing ? 'Enregistrer les modifications' : 'Créer le dossier'}</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api(editing ? `/api/patients/${encodeURIComponent(patient.id)}` : '/api/patients', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); modal.remove(); toast(editing ? 'Dossier modifié.' : 'Dossier patient créé.'); await patients(root); } catch (reason) { error.textContent = reason.message; } };
    }
    const historyStatuses = { ongoing: 'En cours', resolved: 'Résolu', in_remission: 'En rémission' };
    async function medicalHistory(root, patient) {
        if (!patient) return;
        try {
            let rows = await api(`/api/patients/${encodeURIComponent(patient.id)}/medical-history`);
            const modal = document.createElement('div'); modal.className = 'overlay';
            modal.innerHTML = `<section class="modal medical-history-modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Antécédents · ${esc(patient.full_name)}</h3><p class="notification-empty">Correspondances = contrôle indicatif du libellé et du statut. Elles ne constituent ni un diagnostic ni une confirmation de récidive ; faites-les vérifier par un professionnel.</p><button class="btn" type="button" data-add-history>＋ Nouvel antécédent</button><div class="medical-history-list"></div></section>`;
            document.body.append(modal); const list = modal.querySelector('.medical-history-list');
            const render = records => { list.innerHTML = records.length ? records.map(record => `<article class="medical-history-item${record.review_flag ? ' needs-review' : ''}"><div class="panel-head"><div><h4>${esc(record.condition_name)}${record.condition_code ? ` <small>· ${esc(record.condition_code)}</small>` : ''}</h4><small>${esc(record.start_date ? new Date(`${String(record.start_date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : 'Date inconnue')} – ${esc(record.end_date ? new Date(`${String(record.end_date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR') : '—')} · ${esc(historyStatuses[record.status] || record.status)}</small></div><div><button class="table-action" type="button" data-edit-history="${esc(record.id)}">Modifier</button><button class="table-action danger" type="button" data-archive-history="${esc(record.id)}">Archiver</button></div></div>${record.review_flag ? `<p class="recurrence-notice"><b>${record.review_flag === 'possible_recurrence' ? 'Récurrence possible à vérifier' : 'Libellé similaire déjà présent'}</b> · Vérification humaine requise. ${record.similar_records.map(match => `${esc(match.condition_name)} (${esc(historyStatuses[match.status] || match.status)}, ${esc(match.start_date ? String(match.start_date).slice(0, 10) : 'date inconnue')})`).join(' ; ')}</p>` : ''}${record.notes ? `<p>${esc(record.notes)}</p>` : ''}</article>`).join('') : '<p class="notification-empty">Aucun antécédent enregistré.</p>'; };
            render(rows);
            const refresh = async () => { rows = await api(`/api/patients/${encodeURIComponent(patient.id)}/medical-history`); render(rows); return rows; };
            const close = () => modal.remove(); modal.querySelector('.close').onclick = close; modal.addEventListener('click', event => { if (event.target === modal) close(); });
            const reopen = () => medicalHistory(root, patient);
            modal.querySelector('[data-add-history]').onclick = () => { modal.remove(); medicalHistoryForm(patient, null, reopen, reopen); };
            list.addEventListener('click', async event => {
                const edit = event.target.closest('[data-edit-history]');
                if (edit) { const records = await refresh(); modal.remove(); medicalHistoryForm(patient, records.find(record => String(record.id) === edit.dataset.editHistory), reopen, reopen); return; }
                const archive = event.target.closest('[data-archive-history]');
                if (archive) { const record = rows.find(item => String(item.id) === archive.dataset.archiveHistory); if (!record || !confirm(`Archiver l’antécédent « ${record.condition_name} » ?`)) return; try { await api(`/api/patients/${encodeURIComponent(patient.id)}/medical-history/${encodeURIComponent(record.id)}`, { method: 'DELETE' }); toast('Antécédent archivé.'); await refresh(); } catch (error) { toast(error.message); } }
            });
        } catch (error) { toast(error.message); }
    }
    function medicalHistoryForm(patient, record, onSaved, onCancel) {
        const editing = Boolean(record), modal = document.createElement('div'); modal.className = 'overlay medical-history-form-overlay';
        modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${editing ? 'Modifier l’antécédent' : 'Nouvel antécédent'}</h3><label>Affection ou libellé documenté<input name="condition_name" maxlength="190" required value="${esc(record?.condition_name || '')}"></label><label>Code clinique (facultatif)<input name="condition_code" maxlength="80" value="${esc(record?.condition_code || '')}"></label><div class="two"><label>Date de début<input name="start_date" type="date" value="${esc(record?.start_date ? String(record.start_date).slice(0, 10) : '')}"></label><label>Date de fin<input name="end_date" type="date" value="${esc(record?.end_date ? String(record.end_date).slice(0, 10) : '')}"></label></div><label>Statut<select name="status">${Object.entries(historyStatuses).map(([value, label]) => `<option value="${value}" ${record?.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Notes de suivi<textarea name="notes" rows="3">${esc(record?.notes || '')}</textarea></label><p class="notification-empty">Toute correspondance est un signal à vérifier par un professionnel, pas un diagnostic automatisé.</p><button class="btn">${editing ? 'Enregistrer' : 'Ajouter l’antécédent'}</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); const cancel = () => { modal.remove(); if (!state.closingModals && onCancel) onCancel(); }; modal.querySelector('.close').onclick = cancel; modal.addEventListener('click', event => { if (event.target === modal) cancel(); });
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { const result = await api(editing ? `/api/patients/${encodeURIComponent(patient.id)}/medical-history/${encodeURIComponent(record.id)}` : `/api/patients/${encodeURIComponent(patient.id)}/medical-history`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); modal.remove(); if (result.review_flag) toast(result.review_flag === 'possible_recurrence' ? 'Correspondance avec un antécédent résolu : vérification professionnelle requise.' : 'Libellé déjà présent : vérifiez le dossier.'); else toast(editing ? 'Antécédent modifié.' : 'Antécédent enregistré.'); await onSaved(); } catch (reason) { error.textContent = reason.message; } };
    }
    const coverageStatusLabel = coverage => coverage.status === 'inactive' ? 'Archivée' : coverage.end_date && String(coverage.end_date).slice(0, 10) < new Date().toISOString().slice(0, 10) ? 'Expirée' : 'Active';
    async function insurers(root, activeTab = (location.hash.slice(1) === 'insurers/coverages' ? 'coverages' : 'organizations')) {
        try {
            const providers = await api('/api/insurers'), canAccessCoverages = Boolean(state.canAccessPatientRecords), coverages = canAccessCoverages ? await api('/api/insurers/coverages') : [];
            if (!canAccessCoverages) activeTab = 'organizations';
            const tabs = [['organizations', 'Organismes assureurs'], ...(canAccessCoverages ? [['coverages', 'Couvertures patients']] : [])];
            root.innerHTML = `<div class="settings-page"><div class="settings-tabs" role="tablist" aria-label="Sections des assurances">${tabs.map(([id, label]) => `<button type="button" class="settings-tab${activeTab === id ? ' active' : ''}" role="tab" aria-selected="${activeTab === id}" aria-controls="insurers-panel-${id}" id="insurers-tab-${id}" data-insurers-tab="${id}">${label}</button>`).join('')}</div><section class="panel" role="tabpanel" id="insurers-panel-organizations" aria-labelledby="insurers-tab-organizations"${activeTab === 'organizations' ? '' : ' hidden'}><div class="panel-head"><div><h3>Organismes assureurs</h3><p>Répertoire des assureurs et contacts.</p></div><button class="btn" id="add-insurer">＋ Nouvel assureur</button></div><div data-insurers-table></div></section>${canAccessCoverages ? `<section class="panel" role="tabpanel" id="insurers-panel-coverages" aria-labelledby="insurers-tab-coverages"${activeTab === 'coverages' ? '' : ' hidden'}><div class="panel-head"><div><h3>Couvertures patients</h3><p>Contrats rattachés aux patients ; données visibles aux rôles autorisés.</p></div><button class="btn" id="add-coverage">＋ Rattacher une couverture</button></div><div data-coverages-table></div></section>` : ''}</div>`;
            root.querySelectorAll('[data-insurers-tab]').forEach(button => button.addEventListener('click', () => {
                const selectedTab = button.dataset.insurersTab;
                root.querySelectorAll('[data-insurers-tab]').forEach(tab => { const selected = tab === button; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); });
                tabs.forEach(([id]) => { root.querySelector(`#insurers-panel-${id}`).hidden = id !== selectedTab; });
                location.hash = selectedTab === 'organizations' ? 'insurers' : 'insurers/coverages';
            }));
            mountDataTable(root.querySelector('[data-insurers-table]'), {
                rows: providers.map(provider => ({ ...provider, searchText: [provider.name, provider.contact_name, provider.email, provider.phone].join(' ') })), searchText: 'Rechercher par assureur, contact, courriel ou téléphone…', columns: [
                    { label: 'Organisme', sortValue: provider => provider.name, render: provider => `<b>${esc(provider.name)}</b><small>${esc(provider.contact_name || 'Contact non renseigné')}</small>` },
                    { label: 'Coordonnées', sortValue: provider => provider.email || provider.phone || '', render: provider => `${esc(provider.email || '—')}<small>${esc(provider.phone || '')}</small>` },
                    { label: 'Contrats', sortValue: provider => Number(provider.coverage_count), render: provider => esc(provider.coverage_count) },
                    { label: 'Actions', render: provider => `<button class="table-action" type="button" data-edit-insurer="${esc(provider.id)}">Modifier</button><button class="table-action danger" type="button" data-archive-insurer="${esc(provider.id)}">Archiver</button>` }
                ]
            });
            const coverageRows = coverages.map(coverage => ({ ...coverage, displayStatus: coverageStatusLabel(coverage), searchText: [coverage.patient_code, coverage.patient_name, coverage.insurer_name, coverage.policy_number, coverage.member_number, coverage.start_date, coverage.end_date].join(' ') }));
            if (canAccessCoverages) mountDataTable(root.querySelector('[data-coverages-table]'), {
                rows: coverageRows, searchText: 'Rechercher par patient, assureur ou numéro de contrat…', filters: [{ label: 'Statut', options: [...new Set(coverageRows.map(coverage => coverage.displayStatus))].map(status => ({ value: status, label: status })), value: coverage => coverage.displayStatus }], columns: [
                    { label: 'Patient', sortValue: coverage => coverage.patient_name, render: coverage => `<b>${esc(coverage.patient_name)}</b><small>${esc(coverage.patient_code)}</small>` },
                    { label: 'Assureur', sortValue: coverage => coverage.insurer_name, render: coverage => `${esc(coverage.insurer_name)}${coverage.insurer_active ? '' : ' <small>(archivé)</small>'}` },
                    { label: 'Contrat / adhérent', sortValue: coverage => coverage.policy_number, render: coverage => `${esc(coverage.policy_number)}<small>${esc(coverage.member_number || '—')}</small>` },
                    { label: 'Période', sortValue: coverage => coverage.start_date || '', render: coverage => `${coverage.start_date ? esc(new Date(`${String(coverage.start_date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR')) : '—'} → ${coverage.end_date ? esc(new Date(`${String(coverage.end_date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR')) : '—'}` },
                    { label: 'Taux', sortValue: coverage => Number(coverage.coverage_percent || 0), render: coverage => coverage.coverage_percent === null ? '—' : `${esc(coverage.coverage_percent)} %` },
                    { label: 'Statut', sortValue: coverage => coverage.displayStatus, render: coverage => `<span class="tag">${esc(coverage.displayStatus)}</span>` },
                    { label: 'Actions', render: coverage => coverage.status === 'active' ? `${coverage.patient_active ? `<button class="table-action" type="button" data-edit-coverage="${esc(coverage.id)}">Modifier</button>` : ''}<button class="table-action danger" type="button" data-archive-coverage="${esc(coverage.id)}">Archiver</button>` : '—' }
                ]
            });
            $('#add-insurer').onclick = () => insurerForm(root);
            if (canAccessCoverages) $('#add-coverage').onclick = () => coverageForm(root);
            root.querySelectorAll('[data-edit-insurer]').forEach(button => button.onclick = () => insurerForm(root, providers.find(provider => String(provider.id) === button.dataset.editInsurer)));
            root.querySelectorAll('[data-archive-insurer]').forEach(button => button.onclick = async () => { const provider = providers.find(item => String(item.id) === button.dataset.archiveInsurer); if (!provider || !confirm(`Archiver « ${provider.name} » ? Les couvertures existantes seront conservées.`)) return; try { await api(`/api/insurers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' }); toast('Assureur archivé.'); await insurers(root); } catch (error) { toast(error.message); } });
            if (canAccessCoverages) {
                root.querySelectorAll('[data-edit-coverage]').forEach(button => button.onclick = () => coverageForm(root, coverageRows.find(coverage => String(coverage.id) === button.dataset.editCoverage)));
                root.querySelectorAll('[data-archive-coverage]').forEach(button => button.onclick = async () => { const coverage = coverageRows.find(item => String(item.id) === button.dataset.archiveCoverage); if (!coverage || !confirm(`Archiver le contrat ${coverage.policy_number} de ${coverage.patient_name} ?`)) return; try { await api(`/api/insurers/coverages/${encodeURIComponent(coverage.id)}`, { method: 'DELETE' }); toast('Couverture archivée.'); await insurers(root); } catch (error) { toast(error.message); } });
            }
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    function insurerForm(root, provider = null) {
        const editing = Boolean(provider), modal = document.createElement('div'); modal.className = 'overlay';
        modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${editing ? 'Modifier l’assureur' : 'Nouvel assureur'}</h3><label>Nom<input name="name" maxlength="190" required value="${esc(provider?.name || '')}"></label><label>Contact<input name="contact_name" maxlength="180" value="${esc(provider?.contact_name || '')}"></label><div class="two"><label>Courriel<input name="email" type="email" maxlength="190" value="${esc(provider?.email || '')}"></label><label>Téléphone<input name="phone" maxlength="50" value="${esc(provider?.phone || '')}"></label></div><label>Adresse<textarea name="address" rows="2">${esc(provider?.address || '')}</textarea></label><label>Notes<textarea name="notes" rows="2">${esc(provider?.notes || '')}</textarea></label><button class="btn">${editing ? 'Enregistrer' : 'Créer l’assureur'}</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api(editing ? `/api/insurers/${encodeURIComponent(provider.id)}` : '/api/insurers', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); modal.remove(); toast(editing ? 'Assureur modifié.' : 'Assureur créé.'); await insurers(root); } catch (reason) { error.textContent = reason.message; } };
    }
    async function coverageForm(root, coverage = null) {
        try {
            const [patientsList, insurersList] = await Promise.all([api(coverage ? '/api/patients?includeArchived=1' : '/api/patients'), api('/api/insurers?includeArchived=1')]);
            const availableInsurers = insurersList.filter(insurer => insurer.is_active || String(insurer.id) === String(coverage?.insurer_id));
            if (!patientsList.length) throw Error('Créez un dossier patient avant de rattacher une couverture.');
            if (!availableInsurers.length) throw Error('Créez un assureur avant de rattacher une couverture.');
            const modal = document.createElement('div'); modal.className = 'overlay';
            modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${coverage ? 'Modifier la couverture' : 'Rattacher une couverture'}</h3><label>Patient<select name="patient_id" required>${patientsList.map(patient => `<option value="${esc(patient.id)}" ${String(patient.id) === String(coverage?.patient_id) ? 'selected' : ''} ${!patient.is_active && String(patient.id) !== String(coverage?.patient_id) ? 'disabled' : ''}>${esc(patient.patient_code)} · ${esc(patient.full_name)}${patient.is_active ? '' : ' (archivé)'}</option>`).join('')}</select></label><label>Organisme assureur<select name="insurer_id" required>${availableInsurers.map(insurer => `<option value="${esc(insurer.id)}" ${String(insurer.id) === String(coverage?.insurer_id) ? 'selected' : ''}>${esc(insurer.name)}${insurer.is_active ? '' : ' (archivé)'}</option>`).join('')}</select></label><div class="two"><label>Numéro de contrat<input name="policy_number" maxlength="120" required value="${esc(coverage?.policy_number || '')}"></label><label>Numéro d’adhérent<input name="member_number" maxlength="120" value="${esc(coverage?.member_number || '')}"></label></div><div class="two"><label>Début de couverture<input name="start_date" type="date" value="${esc(coverage?.start_date ? String(coverage.start_date).slice(0, 10) : '')}"></label><label>Fin de couverture<input name="end_date" type="date" value="${esc(coverage?.end_date ? String(coverage.end_date).slice(0, 10) : '')}"></label></div><label>Taux de couverture (%)<input name="coverage_percent" type="number" min="0" max="100" step="0.01" value="${esc(coverage?.coverage_percent ?? '')}"></label><label>Notes<textarea name="notes" rows="2">${esc(coverage?.notes || '')}</textarea></label><button class="btn">${coverage ? 'Enregistrer' : 'Rattacher le contrat'}</button><p class="error" role="alert"></p></form>`;
            document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
            form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api(coverage ? `/api/insurers/coverages/${encodeURIComponent(coverage.id)}` : '/api/insurers/coverages', { method: coverage ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); modal.remove(); toast(coverage ? 'Couverture modifiée.' : 'Couverture rattachée.'); await insurers(root); } catch (reason) { error.textContent = reason.message; } };
        } catch (error) { toast(error.message); }
    }
    async function suppliers(root) {
        try {
            const rows = await api('/api/suppliers');
            root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Fournisseurs</h3><p>Contacts et historique de commandes. L’archivage conserve les commandes existantes.</p></div><button class="btn" id="add-supplier">＋ Nouveau fournisseur</button></div><div data-suppliers-table></div></div>`;
            mountDataTable(root.querySelector('[data-suppliers-table]'), {
                rows: rows.map(supplier => ({ ...supplier, searchText: [supplier.name, supplier.contact_name, supplier.email, supplier.phone, supplier.address].join(' ') })), searchText: 'Rechercher par fournisseur, contact, courriel ou téléphone…', columns: [
                    { label: 'Fournisseur', sortValue: supplier => supplier.name, render: supplier => `<b>${esc(supplier.name)}</b><small>${esc(supplier.contact_name || 'Contact non renseigné')}</small>` },
                    { label: 'Coordonnées', sortValue: supplier => supplier.email || supplier.phone || '', render: supplier => `${esc(supplier.email || '—')}<small>${esc(supplier.phone || '')}</small>` },
                    { label: 'Adresse', render: supplier => esc(supplier.address || '—') },
                    { label: 'Commandes', sortValue: supplier => Number(supplier.purchase_count), render: supplier => esc(supplier.purchase_count) },
                    { label: 'Actions', render: supplier => `<button class="table-action" type="button" data-edit-supplier="${esc(supplier.id)}">Modifier</button><button class="table-action danger" type="button" data-archive-supplier="${esc(supplier.id)}">Archiver</button>` }
                ]
            });
            $('#add-supplier').onclick = () => supplierForm(root);
            root.querySelectorAll('[data-edit-supplier]').forEach(button => button.onclick = () => supplierForm(root, rows.find(supplier => String(supplier.id) === button.dataset.editSupplier)));
            root.querySelectorAll('[data-archive-supplier]').forEach(button => button.onclick = async () => { const supplier = rows.find(item => String(item.id) === button.dataset.archiveSupplier); if (!supplier || !confirm(`Archiver « ${supplier.name} » ? Les commandes existantes resteront accessibles.`)) return; try { await api(`/api/suppliers/${encodeURIComponent(supplier.id)}`, { method: 'DELETE' }); toast('Fournisseur archivé.'); await suppliers(root); } catch (error) { toast(error.message); } });
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    function supplierForm(root, supplier = null) {
        const editing = Boolean(supplier), modal = document.createElement('div'); modal.className = 'overlay';
        modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${editing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}</h3><label>Nom<input name="name" maxlength="190" required value="${esc(supplier?.name || '')}"></label><label>Personne à contacter<input name="contact_name" maxlength="180" value="${esc(supplier?.contact_name || '')}"></label><div class="two"><label>Courriel<input name="email" type="email" maxlength="190" value="${esc(supplier?.email || '')}"></label><label>Téléphone<input name="phone" maxlength="50" value="${esc(supplier?.phone || '')}"></label></div><label>Adresse<textarea name="address" rows="2">${esc(supplier?.address || '')}</textarea></label><label>Notes<textarea name="notes" rows="3">${esc(supplier?.notes || '')}</textarea></label><button class="btn">${editing ? 'Enregistrer les modifications' : 'Créer le fournisseur'}</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api(editing ? `/api/suppliers/${encodeURIComponent(supplier.id)}` : '/api/suppliers', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); modal.remove(); toast(editing ? 'Fournisseur modifié.' : 'Fournisseur créé.'); await suppliers(root); } catch (reason) { error.textContent = reason.message; } };
    }
    const purchaseStatuses = { draft: 'Brouillon', ordered: 'Commandée', partially_received: 'Partiellement reçue', received: 'Réceptionnée', cancelled: 'Annulée' };
    async function purchases(root) {
        try {
            const rows = await api('/api/purchases');
            root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Commandes & réceptions</h3><p>Suivez les commandes et réceptionnez les quantités pour mettre le stock à jour.</p></div><button class="btn" id="add-purchase">＋ Nouvelle commande</button></div><div data-purchases-table></div></div>`;
            mountDataTable(root.querySelector('[data-purchases-table]'), {
                rows: rows.map(order => ({ ...order, searchText: [order.reference, `CMD-${order.id}`, order.supplier_name, order.status, order.expected_date, order.notes].join(' ') })), searchText: 'Rechercher par numéro, fournisseur ou statut…', filters: [{ label: 'Statut', options: Object.entries(purchaseStatuses).map(([value, label]) => ({ value, label })), value: order => order.status }], columns: [
                    { label: 'Commande', sortValue: order => order.reference || order.id, render: order => `<b>${esc(order.reference || `CMD-${order.id}`)}</b><small>${esc(new Date(order.created_at).toLocaleDateString('fr-FR'))}</small>` },
                    { label: 'Fournisseur', sortValue: order => order.supplier_name, render: order => esc(order.supplier_name) },
                    { label: 'Échéance', sortValue: order => order.expected_date || '', render: order => order.expected_date ? esc(new Date(`${order.expected_date}T00:00:00`).toLocaleDateString('fr-FR')) : '—' },
                    { label: 'Articles', sortValue: order => Number(order.item_count), render: order => `${esc(order.item_count)} · ${esc(order.quantity_received)}/${esc(order.quantity_ordered)} reçus` },
                    { label: 'Montant estimé', sortValue: order => Number(order.total_amount), render: order => `${Number(order.total_amount).toLocaleString('fr-FR')} ${esc(state.settings.currency || 'XAF')}` },
                    { label: 'Statut', sortValue: order => purchaseStatuses[order.status] || order.status, render: order => `<span class="tag">${esc(purchaseStatuses[order.status] || order.status)}</span>` },
                    { label: 'Actions', render: order => `<button class="table-action" type="button" data-view-purchase="${esc(order.id)}">Détails</button>${order.status === 'draft' ? `<button class="table-action" type="button" data-edit-purchase="${esc(order.id)}">Modifier</button><button class="table-action" type="button" data-order-purchase="${esc(order.id)}">Confirmer</button>` : ''}${['ordered', 'partially_received'].includes(order.status) ? `<button class="table-action" type="button" data-receive-purchase="${esc(order.id)}">Réceptionner</button>` : ''}${['draft', 'ordered'].includes(order.status) ? `<button class="table-action danger" type="button" data-cancel-purchase="${esc(order.id)}">Annuler</button>` : ''}` }
                ]
            });
            $('#add-purchase').onclick = () => purchaseForm(root);
            root.querySelectorAll('[data-view-purchase]').forEach(button => button.onclick = () => purchaseDetails(root, button.dataset.viewPurchase));
            root.querySelectorAll('[data-edit-purchase]').forEach(button => button.onclick = () => purchaseForm(root, button.dataset.editPurchase));
            root.querySelectorAll('[data-order-purchase]').forEach(button => button.onclick = async () => { if (!confirm('Confirmer cette commande fournisseur ?')) return; try { await api(`/api/purchases/${encodeURIComponent(button.dataset.orderPurchase)}/order`, { method: 'POST' }); toast('Commande confirmée.'); await purchases(root); } catch (error) { toast(error.message); } });
            root.querySelectorAll('[data-receive-purchase]').forEach(button => button.onclick = () => receivePurchase(root, button.dataset.receivePurchase));
            root.querySelectorAll('[data-cancel-purchase]').forEach(button => button.onclick = async () => { if (!confirm('Annuler cette commande ? Cette action est irréversible.')) return; try { await api(`/api/purchases/${encodeURIComponent(button.dataset.cancelPurchase)}/cancel`, { method: 'POST' }); toast('Commande annulée.'); await purchases(root); } catch (error) { toast(error.message); } });
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    async function purchaseForm(root, orderId = null) {
        let modal;
        try {
            const [suppliersList, productsList, order] = await Promise.all([api(orderId ? '/api/suppliers?includeArchived=1' : '/api/suppliers'), api('/api/products'), orderId ? api(`/api/purchases/${encodeURIComponent(orderId)}`) : Promise.resolve(null)]);
            if (!suppliersList.length) throw Error('Créez un fournisseur avant de saisir une commande.');
            if (!productsList.length) throw Error('Ajoutez au moins un produit actif au catalogue.');
            if (order && order.status !== 'draft') throw Error('Seuls les brouillons peuvent être modifiés.');
            modal = document.createElement('div'); modal.className = 'overlay';
            modal.innerHTML = `<form class="modal purchase-modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${order ? 'Modifier le brouillon' : 'Nouvelle commande fournisseur'}</h3><label>Fournisseur<select name="supplier_id" required>${suppliersList.map(supplier => `<option value="${esc(supplier.id)}" ${String(supplier.id) === String(order?.supplier_id) ? 'selected' : ''}>${esc(supplier.name)}${supplier.is_active ? '' : ' (archivé)'}</option>`).join('')}</select></label><div class="two"><label>Référence fournisseur<input name="reference" maxlength="120" value="${esc(order?.reference || '')}"></label><label>Livraison prévue<input name="expected_date" type="date" value="${esc(order?.expected_date ? String(order.expected_date).slice(0, 10) : '')}"></label></div><div class="panel-head purchase-items-head"><h4>Articles commandés</h4><button type="button" class="table-action" data-add-purchase-item>＋ Ajouter un article</button></div><div class="purchase-items"></div><label>Notes<textarea name="notes" rows="2">${esc(order?.notes || '')}</textarea></label><button class="btn">${order ? 'Enregistrer le brouillon' : 'Créer le brouillon'}</button><p class="error" role="alert"></p></form>`;
            document.body.append(modal); const form = modal.querySelector('form'), itemContainer = form.querySelector('.purchase-items');
            function addItem(item = null) {
                const row = document.createElement('div'); row.className = 'purchase-item-row';
                row.innerHTML = `<label>Produit<select data-product required>${productsList.map(product => `<option value="${esc(product.id)}" ${String(product.id) === String(item?.product_id) ? 'selected' : ''}>${esc(product.name)} (${esc(product.sku)})</option>`).join('')}</select></label><label>Quantité<input data-quantity type="number" min="0.001" step="0.001" required value="${esc(item?.quantity_ordered ?? 1)}"></label><label>Coût unitaire<input data-cost type="number" min="0" step="0.01" required value="${esc(item?.unit_cost ?? 0)}"></label><button type="button" class="table-action danger" data-remove-item aria-label="Supprimer l’article">×</button>`;
                row.querySelector('[data-remove-item]').onclick = () => { if (itemContainer.children.length === 1) { toast('Une commande doit contenir au moins un article.'); return; } row.remove(); }; itemContainer.append(row);
            }
            (order?.items || [null]).forEach(addItem); form.querySelector('[data-add-purchase-item]').onclick = () => addItem();
            modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
            form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; const items = [...itemContainer.children].map(row => ({ product_id: row.querySelector('[data-product]').value, quantity_ordered: row.querySelector('[data-quantity]').value, unit_cost: row.querySelector('[data-cost]').value })); const data = { ...Object.fromEntries(new FormData(form)), items }; try { await api(order ? `/api/purchases/${encodeURIComponent(order.id)}` : '/api/purchases', { method: order ? 'PUT' : 'POST', body: JSON.stringify(data) }); modal.remove(); toast(order ? 'Brouillon modifié.' : 'Brouillon de commande créé.'); await purchases(root); } catch (reason) { error.textContent = reason.message; } };
        } catch (error) { if (modal) modal.remove(); toast(error.message); }
    }
    async function purchaseDetails(root, orderId) {
        try {
            const order = await api(`/api/purchases/${encodeURIComponent(orderId)}`), modal = document.createElement('div'); modal.className = 'overlay';
            modal.innerHTML = `<section class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${esc(order.reference || `CMD-${order.id}`)}</h3><p><b>${esc(order.supplier_name)}</b> · ${esc(purchaseStatuses[order.status] || order.status)}</p><p>Livraison prévue : ${order.expected_date ? esc(new Date(`${String(order.expected_date).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR')) : '—'}</p><div class="tablewrap"><table><thead><tr><th>SKU</th><th>Produit</th><th>Commandé</th><th>Reçu</th><th>Coût unitaire</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${esc(item.sku)}</td><td>${esc(item.product_name)}</td><td>${esc(item.quantity_ordered)} ${esc(item.unit)}</td><td>${esc(item.quantity_received)} ${esc(item.unit)}</td><td>${esc(item.unit_cost)} ${esc(state.settings.currency || 'XAF')}</td></tr>`).join('')}</tbody></table></div>${order.notes ? `<p>${esc(order.notes)}</p>` : ''}</section>`;
            document.body.append(modal); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
        } catch (error) { toast(error.message); }
    }
    async function receivePurchase(root, orderId) {
        try {
            const order = await api(`/api/purchases/${encodeURIComponent(orderId)}`), remaining = order.items.filter(item => Number(item.quantity_ordered) > Number(item.quantity_received));
            if (!remaining.length) throw Error('Cette commande ne contient plus de quantité à réceptionner.');
            const modal = document.createElement('div'); modal.className = 'overlay';
            modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Réceptionner ${esc(order.reference || `CMD-${order.id}`)}</h3><p>Les quantités réceptionnées seront ajoutées au stock et inscrites au journal des mouvements.</p>${remaining.map(item => `<label>${esc(item.product_name)} · reste ${esc(Number(item.quantity_ordered) - Number(item.quantity_received))} ${esc(item.unit)}<input type="number" min="0" max="${esc(Number(item.quantity_ordered) - Number(item.quantity_received))}" step="0.001" data-receive-item="${esc(item.id)}" value="${esc(Number(item.quantity_ordered) - Number(item.quantity_received))}"></label>`).join('')}<button class="btn">Enregistrer la réception</button><p class="error" role="alert"></p></form>`;
            document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
            form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'), items = [...form.querySelectorAll('[data-receive-item]')].filter(input => Number(input.value) > 0).map(input => ({ item_id: input.dataset.receiveItem, quantity: input.value })); error.textContent = ''; if (!items.length) { error.textContent = 'Saisissez au moins une quantité à réceptionner.'; return; } try { const result = await api(`/api/purchases/${encodeURIComponent(order.id)}/receive`, { method: 'POST', body: JSON.stringify({ items }) }); modal.remove(); toast(result.message); await purchases(root); } catch (reason) { error.textContent = reason.message; } };
        } catch (error) { toast(error.message); }
    }
    async function products(root) {
        try {
            state.products = await api('/api/products'); root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Catalogue des produits</h3><p>Stock géré par mouvements · estimations HT aux prix actuels, hors frais et non comptables.</p></div><div><button class="table-action" type="button" data-product-labels>Codes produits · Imprimer en lot</button><button class="btn" id="add">＋ Nouveau produit</button></div></div><div data-products-table></div></div>`;
            const categories = [...new Set(state.products.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
            mountDataTable(root.querySelector('[data-products-table]'), {
                rows: state.products.map(product => ({ ...product, searchText: [product.sku, product.name, product.category, product.barcode, product.unit].join(' ') })), searchText: 'Rechercher par nom, SKU, catégorie ou code-barres…', filters: [{ label: 'Catégorie', options: categories.map(category => ({ value: category, label: category })), value: product => product.category || '' }, { label: 'Stock', options: [{ value: 'low', label: 'Sous le seuil' }, { value: 'available', label: 'Stock disponible' }], value: product => Number(product.quantity_on_hand) <= Number(product.reorder_level) ? 'low' : 'available' }], columns: [
                    { label: 'SKU', sortValue: product => product.sku, render: product => esc(product.sku) },
                    { label: 'Produit', sortValue: product => product.name, render: product => `<b>${esc(product.name)}</b><small>${esc(product.unit)} · ${product.prescription_required ? 'Ordonnance obligatoire' : 'Sans ordonnance requise'}${product.max_customer_quantity ? ` · seuil ${esc(product.max_customer_quantity)}` : ''}${product.minimum_purchase_interval_hours ? ` · intervalle ${esc(product.minimum_purchase_interval_hours)} h` : ''}</small>` },
                    { label: 'Catégorie', sortValue: product => product.category || '', render: product => esc(product.category || '—') },
                    { label: 'Stock', sortValue: product => Number(product.quantity_on_hand), render: product => `${esc(product.quantity_on_hand)} ${esc(product.unit)}` },
                    { label: 'Seuil', sortValue: product => Number(product.reorder_level), render: product => esc(product.reorder_level) },
                    { label: 'Coût moyen HT', sortValue: product => product.purchase_cost === null ? -1 : Number(product.purchase_cost), render: product => product.purchase_cost === null ? 'Inconnu' : `${esc(product.purchase_cost)} ${esc(state.settings.currency || 'XAF')}` },
                    { label: 'Prix de vente HT', sortValue: product => Number(product.sale_price), render: product => `${esc(product.sale_price)} ${esc(state.settings.currency || 'XAF')}` },
                    { label: 'Écart unitaire estimé', sortValue: product => product.purchase_cost === null ? -Infinity : Number(product.sale_price) - Number(product.purchase_cost), render: product => product.purchase_cost === null ? 'Inconnu' : `${(Number(product.sale_price) - Number(product.purchase_cost)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${esc(state.settings.currency || 'XAF')}` },
                    { label: 'Ventes potentielles du stock', sortValue: product => Number(product.sale_price) * Number(product.quantity_on_hand), render: product => formatMoney(Number(product.sale_price) * Number(product.quantity_on_hand)) },
                    { label: 'Marge stock estimée', sortValue: product => product.purchase_cost === null ? -Infinity : (Number(product.sale_price) - Number(product.purchase_cost)) * Number(product.quantity_on_hand), render: product => product.purchase_cost === null ? 'Inconnu' : formatMoney((Number(product.sale_price) - Number(product.purchase_cost)) * Number(product.quantity_on_hand)) },
                    { label: 'Actions', render: product => `<button class="table-action" type="button" data-product-label="${esc(product.id)}">Codes</button><button class="table-action" type="button" data-edit-product="${esc(product.id)}">Modifier</button><button class="table-action danger" type="button" data-archive-product="${esc(product.id)}">Archiver</button>` }
                ]
            });
            $('#add').onclick = () => productForm(root);
            root.querySelector('[data-product-labels]').onclick = () => productLabels(root, state.products);
            if (root.dataset.productLabelHandler !== 'attached') {
                root.dataset.productLabelHandler = 'attached';
                root.addEventListener('click', event => { const button = event.target.closest('[data-product-label]'); if (button && root.contains(button)) productLabels(root, state.products, [button.dataset.productLabel]); });
            }
            root.querySelectorAll('[data-edit-product]').forEach(button => button.onclick = () => productForm(root, state.products.find(product => String(product.id) === button.dataset.editProduct)));
            root.querySelectorAll('[data-archive-product]').forEach(button => button.onclick = async () => { const product = state.products.find(item => String(item.id) === button.dataset.archiveProduct); if (!product || !confirm(`Archiver « ${product.name} » ? Le journal des mouvements sera conservé.`)) return; try { await api(`/api/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' }); toast('Produit archivé.'); await products(root); } catch (error) { toast(error.message); } });
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    async function productLabels(root, productList, initialIds = null) {
        if (!productList.length) { toast('Aucun produit actif à imprimer.'); return; }
        const modal = document.createElement('div'); modal.className = 'overlay product-label-overlay';
        const selectedIds = initialIds ? new Set(initialIds.map(String)) : new Set(productList.map(product => String(product.id)));
        modal.innerHTML = `<section class="modal product-label-modal" role="dialog" aria-modal="true" aria-labelledby="product-label-title"><button type="button" class="close" aria-label="Fermer">×</button><div data-label-chooser><h3 id="product-label-title">Codes produits à imprimer</h3><p>Générez un code-barres ou un QR code. Les produits sans code reçoivent un identifiant unique enregistré dans leur fiche et reconnu au point de vente.</p><div class="two label-options"><label>Format<select data-label-format><option value="barcode"${(state.settings.default_label_format || 'barcode') === 'barcode' ? ' selected' : ''}>Code-barres (Code 128)</option><option value="qr"${state.settings.default_label_format === 'qr' ? ' selected' : ''}>QR code</option></select></label><label>Filtrer les produits<input type="search" data-label-search placeholder="Nom, SKU ou code-barres…"></label></div><label class="inline-check label-select-all"><input type="checkbox" data-label-select-all> Sélectionner tous les produits</label><div class="product-label-selection" data-label-selection></div><p class="notification-empty" data-label-count></p><p class="error" data-label-error role="alert"></p><button class="btn" type="button" data-generate-labels>Générer les codes</button></div><div data-label-preview hidden><div class="panel-head"><div><h3>Aperçu des étiquettes</h3><p data-label-preview-count></p></div></div><div id="product-label-print" class="product-label-grid"></div><div class="receipt-actions"><button class="btn" type="button" data-print-labels>Imprimer</button><button class="table-action" type="button" data-label-back>Retour à la sélection</button></div></div></section>`;
        document.body.append(modal);
        const selection = modal.querySelector('[data-label-selection]'), count = modal.querySelector('[data-label-count]'), selectAll = modal.querySelector('[data-label-select-all]'), search = modal.querySelector('[data-label-search]'), error = modal.querySelector('[data-label-error]');
        let saved = false;
        selection.innerHTML = productList.map(product => `<label class="product-label-option" data-label-option data-search="${esc(`${product.name} ${product.sku} ${product.barcode || ''}`.toLocaleLowerCase('fr'))}"><input type="checkbox" data-label-product value="${esc(product.id)}" ${selectedIds.has(String(product.id)) ? 'checked' : ''}><span><b>${esc(product.name)}</b><small>${esc(product.sku)} · ${esc(product.barcode || 'Code attribué à la génération')}</small></span></label>`).join('');
        function updateSelection() {
            const checked = selection.querySelectorAll('[data-label-product]:checked').length, total = selection.querySelectorAll('[data-label-product]').length;
            count.textContent = `${checked} produit${checked === 1 ? '' : 's'} sélectionné${checked === 1 ? '' : 's'}.`;
            selectAll.checked = checked === total; selectAll.indeterminate = checked > 0 && checked < total;
            error.textContent = '';
        }
        selection.onchange = updateSelection;
        selectAll.onchange = () => { selection.querySelectorAll('[data-label-product]').forEach(input => { input.checked = selectAll.checked; }); updateSelection(); };
        search.oninput = () => { const query = search.value.trim().toLocaleLowerCase('fr'); selection.querySelectorAll('[data-label-option]').forEach(option => { option.hidden = !option.dataset.search.includes(query); }); };
        const close = () => { document.body.classList.remove('printing-product-labels'); modal.remove(); if (saved && root.isConnected) products(root); };
        modal.querySelector('.close').onclick = close; modal.addEventListener('click', event => { if (event.target === modal) close(); }); modal.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
        updateSelection();
        modal.querySelector('[data-generate-labels]').onclick = async () => {
            const ids = [...selection.querySelectorAll('[data-label-product]:checked')].map(input => input.value), format = modal.querySelector('[data-label-format]').value;
            error.textContent = '';
            if (!ids.length) { error.textContent = 'Sélectionnez au moins un produit.'; return; }
            const button = modal.querySelector('[data-generate-labels]'); button.disabled = true; button.textContent = 'Génération…';
            try {
                if (format === 'barcode' && !window.JsBarcode) throw Error('Le générateur de codes-barres est indisponible. Rechargez la page puis réessayez.');
                const result = await api('/api/products/labels', { method: 'POST', body: JSON.stringify({ ids, format }) });
                result.labels.forEach(label => { const product = state.products.find(item => String(item.id) === String(label.id)); if (product) product.barcode = label.barcode; });
                saved = true;
                const grid = modal.querySelector('#product-label-print'); grid.replaceChildren();
                for (const label of result.labels) {
                    const card = document.createElement('article'); card.className = 'product-label-card';
                    const name = document.createElement('b'); name.textContent = label.name;
                    const code = document.createElement('small'); code.textContent = `${label.sku} · ${label.barcode}`;
                    card.append(name);
                    if (result.format === 'qr') { const image = document.createElement('img'); image.src = label.qr_data; image.alt = `QR code ${label.barcode}`; card.append(image); }
                    else { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); window.JsBarcode(svg, label.barcode, { format: 'CODE128', displayValue: true, fontSize: 12, height: 42, margin: 4 }); card.append(svg); }
                    card.append(code); grid.append(card);
                }
                modal.querySelector('[data-label-preview-count]').textContent = `${result.labels.length} étiquette${result.labels.length === 1 ? '' : 's'} · ${format === 'qr' ? 'QR code' : 'Code-barres Code 128'}`;
                modal.querySelector('[data-label-chooser]').hidden = true; modal.querySelector('[data-label-preview]').hidden = false;
            } catch (reason) { error.textContent = reason.message; }
            finally { button.disabled = false; button.textContent = 'Générer les codes'; }
        };
        modal.querySelector('[data-print-labels]').onclick = () => { document.body.classList.add('printing-product-labels'); window.addEventListener('afterprint', () => document.body.classList.remove('printing-product-labels'), { once: true }); window.print(); };
        modal.querySelector('[data-label-back]').onclick = () => { modal.querySelector('[data-label-preview]').hidden = true; modal.querySelector('[data-label-chooser]').hidden = false; };
    }
    function productForm(root, product = null) {
        const editing = Boolean(product), modal = document.createElement('div'); modal.className = 'overlay';
        modal.innerHTML = `<form class="modal product-form"><button type="button" class="close" aria-label="Fermer">×</button><h3>${editing ? 'Modifier le produit' : 'Nouveau produit'}</h3>
            <fieldset><legend>Identification</legend><div class="product-form-grid">
                <label>SKU<input name="sku" maxlength="80" required value="${esc(product?.sku || '')}"></label>
                <label>Nom du produit<input name="name" maxlength="190" required value="${esc(product?.name || '')}"></label>
                <label>Catégorie<input name="category" maxlength="120" value="${esc(product?.category || '')}"></label>
                <label>Code-barres<input name="barcode" maxlength="120" value="${esc(product?.barcode || '')}"></label>
            </div></fieldset>
            <fieldset><legend>Stock</legend><div class="product-form-grid">
                <label>Unité<input name="unit" maxlength="40" required value="${esc(product?.unit || 'unité')}"></label>
                ${editing ? `<label>Stock actuel<input value="${esc(product.quantity_on_hand)}" disabled><small>Modifiable par les mouvements de stock.</small></label>` : '<label>Stock initial<input name="quantity_on_hand" type="number" min="0" step="0.001" value="0" required></label>'}
                <label>Seuil d’alerte<input name="reorder_level" type="number" min="0" step="0.001" value="${esc(product?.reorder_level ?? 0)}" required></label>
            </div></fieldset>
            <fieldset><legend>Prix et marge estimée</legend><p class="product-form-help">Saisissez les prix hors taxe par unité. La différence donne une marge indicative, avant autres frais.</p><div class="product-form-grid">
                <label>Prix d’achat moyen HT<input name="purchase_cost" type="number" min="0" max="99999999999999.9999" step="0.0001" value="${esc(product?.purchase_cost ?? '')}" placeholder="Inconnu"><small>Coût moyen du stock actuel. Laissez vide si vous ne le connaissez pas.</small></label>
                <label>Prix de vente HT<input name="sale_price" type="number" min="0" step="0.01" value="${esc(product?.sale_price ?? 0)}" required></label>
            </div><p class="product-form-help">Ce n’est pas nécessairement le prix du dernier achat. Les réceptions recalculent la moyenne lorsque les coûts nécessaires sont connus ; une entrée sans coût peut la rendre inconnue.</p></fieldset>
            <fieldset><legend>Règles de vente</legend><label class="inline-check"><input name="prescription_required" type="checkbox" value="true" ${product?.prescription_required ? 'checked' : ''}> Ordonnance obligatoire</label><div class="product-form-grid">
                <label>Quantité patient à vérifier<input name="max_customer_quantity" type="number" min="0.001" step="0.001" value="${esc(product?.max_customer_quantity ?? '')}" placeholder="Aucun seuil"></label>
                <label>Intervalle minimal à vérifier (heures)<input name="minimum_purchase_interval_hours" type="number" min="1" max="8760" step="1" value="${esc(product?.minimum_purchase_interval_hours ?? '')}" placeholder="Aucun intervalle"></label>
            </div><p class="product-form-help">Ces seuils produisent un signalement à vérifier, sans blocage ni diagnostic automatique.</p></fieldset>
            <button class="btn">${editing ? 'Enregistrer les modifications' : 'Créer le produit'}</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'), data = Object.fromEntries(new FormData(form)); data.prescription_required = form.elements.prescription_required.checked; if (editing) { if (data.purchase_cost === String(product.purchase_cost ?? '')) delete data.purchase_cost; else data.expected_purchase_cost = product.purchase_cost; } error.textContent = ''; try { await api(editing ? `/api/products/${encodeURIComponent(product.id)}` : '/api/products', { method: editing ? 'PUT' : 'POST', body: JSON.stringify(data) }); modal.remove(); toast(editing ? 'Produit modifié.' : 'Produit créé.'); await products(root); } catch (reason) { error.textContent = reason.message; } };
    }
    async function movements(root) {
        try {
            const [rows, productsList] = await Promise.all([api('/api/stock/movements'), api('/api/products')]); state.products = productsList; root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Journal des mouvements</h3><p>Entrées, sorties et ajustements · toute correction passe par une validation et reste tracée (mention « Modifié »).</p></div><button class="btn" id="new" ${productsList.length ? '' : 'disabled'}>＋ Nouveau mouvement</button></div><div data-movements-table></div></div>`;
            mountDataTable(root.querySelector('[data-movements-table]'), {
                rows: rows.map(movement => ({ ...movement, searchText: [movement.product_name, movement.sku, movement.movement_type, movement.reference, movement.notes].join(' ') })), searchText: 'Rechercher par produit, SKU, type, référence ou note…', filters: [{ label: 'Type', options: [{ value: 'IN', label: 'Entrée' }, { value: 'OUT', label: 'Sortie' }, { value: 'ADJUSTMENT', label: 'Ajustement' }], value: movement => movement.movement_type }], columns: [
                    { label: 'Date', sortValue: movement => new Date(movement.created_at).getTime(), render: movement => esc(new Date(movement.created_at).toLocaleString('fr-FR')) },
                    { label: 'Produit', sortValue: movement => movement.product_name, render: movement => `<b>${esc(movement.product_name)}</b><small>${esc(movement.sku)}</small>` },
                    { label: 'Type', sortValue: movement => movement.movement_type, render: movement => esc({ IN: 'Entrée', OUT: 'Sortie', ADJUSTMENT: 'Ajustement' }[movement.movement_type] || movement.movement_type) },
                    { label: 'Quantité', sortValue: movement => Number(movement.quantity), render: movement => esc(movement.quantity) },
                    { label: 'Référence / note', sortValue: movement => movement.reference || '', render: movement => `${esc(movement.reference || '—')}${movement.notes ? `<small>${esc(movement.notes)}</small>` : ''}` },
                    { label: 'Modification', render: movement => `${movement.correction_id ? `<span class="tag">Modifié</span><small>Par ${esc(movement.modified_by_name || '—')} · validé par ${esc(movement.validated_by_name || '—')}</small><small>${esc(movement.corrected_at ? new Date(movement.corrected_at).toLocaleString('fr-FR') : '')} · avant : ${esc(movement.corrected_from)}${movement.correction_reason ? ` · ${esc(movement.correction_reason)}` : ''}</small>` : ''}${movement.pending_id ? `<span class="tag">En attente de validation</span><small>Demandé par ${esc(movement.pending_by_name || '—')} : quantité ${esc(movement.pending_quantity)} · ${esc(movement.pending_reason)}</small>` : ''}` },
                    { label: 'Actions', render: movement => movement.pending_id ? (state.canAdminister || state.role === 'SUPER_ADMIN' ? `${Number(movement.pending_by_id) !== state.userId || state.role === 'SUPER_ADMIN' ? `<button class="table-action" type="button" data-approve-correction="${esc(movement.pending_id)}">Valider</button>` : ''}<button class="table-action danger" type="button" data-reject-correction="${esc(movement.pending_id)}">Rejeter</button>` : '') : (movement.correctable && window.RedamsAccess.hasRole(state.profile, 'OWNER', 'ADMIN', 'STOREKEEPER', 'SUPER_ADMIN') ? `<button class="table-action" type="button" data-correct-movement="${esc(movement.id)}">Corriger</button>` : '') }
                ]
            });
            if (productsList.length) $('#new').onclick = () => movementForm(root);
            root.onclick = async event => {
                const correct = event.target.closest('[data-correct-movement]'), approve = event.target.closest('[data-approve-correction]'), reject = event.target.closest('[data-reject-correction]');
                if (correct) { movementCorrectionForm(root, rows.find(movement => String(movement.id) === correct.dataset.correctMovement)); return; }
                if (approve) { if (!confirm('Valider et appliquer cette correction ? Le stock sera ajusté en conséquence.')) return; try { await api(`/api/stock/corrections/${encodeURIComponent(approve.dataset.approveCorrection)}/approve`, { method: 'POST', body: '{}' }); toast('Correction validée.'); await movements(root); } catch (reason) { toast(reason.message); } return; }
                if (reject) { const note = prompt('Motif du rejet (facultatif) :'); if (note === null) return; try { await api(`/api/stock/corrections/${encodeURIComponent(reject.dataset.rejectCorrection)}/reject`, { method: 'POST', body: JSON.stringify({ note }) }); toast('Correction rejetée.'); await movements(root); } catch (reason) { toast(reason.message); } }
            };
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    function movementCorrectionForm(root, movement) {
        if (!movement) return;
        const modal = document.createElement('div'), adjustment = movement.movement_type === 'ADJUSTMENT'; modal.className = 'overlay';
        modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Corriger le mouvement</h3><p class="notification-empty">${esc(movement.product_name)} (${esc(movement.sku)}). La correction sera appliquée après validation par un autre administrateur ou propriétaire, et le mouvement portera la mention « Modifié ».</p><label>Quantité<input name="quantity" type="number" min="0.001" step="0.001" required value="${esc(movement.quantity)}" ${adjustment ? 'readonly' : ''}></label><label>Référence<input name="reference" maxlength="120" value="${esc(movement.reference || '')}"></label><label>Note<textarea name="notes" rows="3">${esc(movement.notes || '')}</textarea></label><label>Motif de la correction<textarea name="reason" rows="2" maxlength="500" required></textarea></label><button class="btn">Soumettre pour validation</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api(`/api/stock/movements/${encodeURIComponent(movement.id)}/corrections`, { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); modal.remove(); toast('Correction soumise pour validation.'); await movements(root); } catch (reason) { error.textContent = reason.message; } };
    }
    function movementForm(root) { const modal = document.createElement('div'); modal.className = 'overlay'; modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Nouveau mouvement</h3><label>Produit<select name="product_id" required>${state.products.map(product => `<option value="${esc(product.id)}">${esc(product.name)} (${esc(product.sku)}) — stock ${esc(product.quantity_on_hand)} ${esc(product.unit)}</option>`).join('')}</select></label><label>Type de mouvement<select name="movement_type"><option value="IN">Entrée</option><option value="OUT">Sortie</option><option value="ADJUSTMENT">Ajustement (stock final)</option></select></label><label>Quantité<input name="quantity" type="number" min="0.001" step="0.001" required><small data-quantity-help>Ajoute cette quantité au stock.</small></label><label>Référence<input name="reference" maxlength="120"></label><label>Note<textarea name="notes" rows="3"></textarea></label><button class="btn">Enregistrer le mouvement</button><p class="error" role="alert"></p></form>`; document.body.append(modal); const form = modal.querySelector('form'), type = form.elements.movement_type; modal.querySelector('.close').onclick = () => modal.remove(); modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); }); type.onchange = () => { form.querySelector('[data-quantity-help]').textContent = type.value === 'ADJUSTMENT' ? 'Indique le stock final à appliquer.' : type.value === 'IN' ? 'Ajoute cette quantité au stock.' : 'Retire cette quantité du stock.'; }; form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api('/api/stock/movements', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(form))) }); modal.remove(); toast('Mouvement enregistré.'); await movements(root); } catch (reason) { error.textContent = reason.message; } }; }
    async function alerts(root) {
        try {
            state.products = await api('/api/products'); const rows = state.products.filter(product => Number(product.quantity_on_hand) <= Number(product.reorder_level)).map(product => ({ ...product, shortage: Math.max(0, Number(product.reorder_level) - Number(product.quantity_on_hand)), searchText: [product.sku, product.name, product.category, product.barcode].join(' ') })); root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Alertes de stock</h3><p>Produits au seuil ou en dessous · données mises à jour à l’ouverture.</p></div></div><div data-alerts-table></div></div>`;
            mountDataTable(root.querySelector('[data-alerts-table]'), {
                rows, searchText: 'Rechercher par produit, SKU ou catégorie…', filters: [{ label: 'Catégorie', options: [...new Set(rows.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')).map(category => ({ value: category, label: category })), value: product => product.category || '' }], emptyMessage: 'Aucun produit ne correspond aux filtres.', columns: [
                    { label: 'SKU', sortValue: product => product.sku, render: product => esc(product.sku) },
                    { label: 'Produit', sortValue: product => product.name, render: product => `<b>${esc(product.name)}</b><small>${esc(product.category || 'Sans catégorie')}</small>` },
                    { label: 'Stock actuel', sortValue: product => Number(product.quantity_on_hand), render: product => `<span class="danger">${esc(product.quantity_on_hand)}</span> ${esc(product.unit)}` },
                    { label: 'Seuil', sortValue: product => Number(product.reorder_level), render: product => `${esc(product.reorder_level)} ${esc(product.unit)}` },
                    { label: 'Manquant', sortValue: product => product.shortage, render: product => `${esc(product.shortage)} ${esc(product.unit)}` }
                ]
            });
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    async function searchPage(root, query) {
        root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Recherche dans les modules</h3><p>Correspondances dans le catalogue, les stocks, les fournisseurs et les commandes d’approvisionnement.</p></div></div><div id="global-search-results" aria-live="polite"></div></div>`;
        const results = $('#global-search-results'); if (query.trim().length < 2) { results.innerHTML = '<p class="notification-empty">Saisissez au moins 2 caractères dans la recherche en haut de page.</p>'; return; }
        results.innerHTML = '<p class="notification-empty">Recherche en cours…</p>';
        try {
            const data = await api(`/api/search?q=${encodeURIComponent(query.trim())}`); if (!results.isConnected) return;
            const groups = [['products', 'Catalogue produits', data.products, product => `<tr><td>${esc(product.sku)}</td><td><b>${esc(product.name)}</b><small>${esc(product.category || 'Sans catégorie')}</small></td><td>${esc(product.quantity_on_hand)} ${esc(product.unit)}</td><td>${esc(product.sale_price)} ${esc(state.settings.currency || 'XAF')}</td></tr>`, ['SKU', 'Produit', 'Stock', 'Prix']],
            ['movements', 'Mouvements de stock', data.movements, movement => `<tr><td>${esc(new Date(movement.created_at).toLocaleString('fr-FR'))}</td><td><b>${esc(movement.product_name)}</b><small>${esc(movement.sku)}</small></td><td>${esc({ IN: 'Entrée', OUT: 'Sortie', ADJUSTMENT: 'Ajustement' }[movement.movement_type] || movement.movement_type)}</td><td>${esc(movement.reference || '—')}</td></tr>`, ['Date', 'Produit', 'Type', 'Référence']],
            ['alerts', 'Alertes de stock', data.alerts, product => `<tr><td>${esc(product.sku)}</td><td>${esc(product.name)}</td><td class="danger">${esc(product.quantity_on_hand)} ${esc(product.unit)}</td><td>${esc(product.reorder_level)} ${esc(product.unit)}</td></tr>`, ['SKU', 'Produit', 'Stock', 'Seuil']],
            ['suppliers', 'Fournisseurs', data.suppliers, supplier => `<tr><td><b>${esc(supplier.name)}</b></td><td>${esc(supplier.contact_name || '—')}</td><td>${esc(supplier.email || '—')}</td><td>${esc(supplier.phone || '—')}</td></tr>`, ['Fournisseur', 'Contact', 'Courriel', 'Téléphone']],
            ['purchases', 'Commandes & réceptions', data.purchases, order => `<tr><td>${esc(order.reference || `CMD-${order.id}`)}</td><td>${esc(order.supplier_name)}</td><td>${esc(purchaseStatuses[order.status] || order.status)}</td><td>${esc(order.product_names || `${order.item_count} article(s)`)}</td></tr>`, ['Commande', 'Fournisseur', 'Statut', 'Articles']],
            ['patients', 'Dossiers patients', data.patients, patient => `<tr><td>${esc(patient.patient_code)}</td><td>${esc(patient.full_name)}</td><td>${esc(patientGenders[patient.gender] || patientGenders.UNSPECIFIED)}</td><td>${esc(patient.phone || '—')}</td></tr>`, ['Code patient', 'Nom', 'Genre', 'Téléphone']],
            ['insurers', 'Organismes assureurs', data.insurers, insurer => `<tr><td>${esc(insurer.name)}</td><td>${esc(insurer.contact_name || '—')}</td><td>${esc(insurer.email || '—')}</td><td>${esc(insurer.phone || '—')}</td></tr>`, ['Organisme', 'Contact', 'Courriel', 'Téléphone']]];
            const total = groups.reduce((sum, [, , items]) => sum + items.length, 0);
            results.innerHTML = total ? groups.filter(([, , items]) => items.length).map(([id, label, items, row, headers], index) => `<details class="search-group"${index === 0 ? ' open' : ''}><summary>${esc(label)} <span class="tag">${items.length}</span></summary><div class="tablewrap"><table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${items.map(row).join('')}</tbody></table></div></details>`).join('') : '<p class="notification-empty">Aucune correspondance trouvée dans les modules.</p>';
        } catch (error) { if (results.isConnected) results.innerHTML = `<p class="error">${esc(error.message)}</p>`; }
    }
    const paymentLabels = { cash: 'Espèces', mobile_money: 'Paiement mobile', bank_transfer: 'Virement bancaire', insurance: 'Assurance', other: 'Autre' };
    const invoiceStatusLabels = { issued: 'À payer', partially_paid: 'Partiellement payée', paid: 'Payée', partially_returned: 'Partiellement retournée', returned: 'Retournée', cancelled: 'Annulée' };
    const formatMoney = value => `${Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${esc(state.settings.currency || 'XAF')}`;
    async function salesPOS(root) {
        try {
            const hasPatientsModule = !state.modules || state.modules.includes('patients');
            const settings = await api('/api/settings');
            state.settings = { ...state.settings, ...settings };
            const separate = Boolean(Number(settings.separate_sale_payment));
            refreshAccess();
            if (!canAccessPage('pos')) throw Error('Le circuit a changé : vous n’avez plus accès à la saisie des ventes.');
            const [productsList, patientsList, cashState, insurersList] = await Promise.all([api('/api/sales/products'), hasPatientsModule ? api('/api/sales/patients') : [], separate ? null : api('/api/cash'), hasPatientsModule ? api('/api/sales/insurers') : []]);
            const patientSalesEnabled = hasPatientsModule && patientsList.length > 0;
            state.products = productsList;
            root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Nouvelle vente</h3><p>Le stock est déduit à l’émission du reçu. Les prix catalogue sont hors taxe (${esc(state.settings.sales_tax_rate || 0)} % configuré).</p></div><button class="table-action" type="button" data-go="cash">Recettes & caisse</button></div>${separate ? `<p class="tag">Vente en attente : un autre utilisateur doit encaisser en caisse.</p>` : cashState.current_session ? `<p class="tag">Caisse ouverte · fond initial ${formatMoney(cashState.current_session.opening_cash)} · espèces attendues ${formatMoney(cashState.summary.expected_cash)}</p>` : `<p class="error" role="alert">Vente impossible : la caisse est fermée. Ouvrez une session de caisse avant d’enregistrer la vente. <button class="table-action" type="button" data-go="cash">Ouvrir la caisse</button></p>`}<form id="sale-form" novalidate><div class="sale-customer">${patientSalesEnabled ? '<label>Type de client<select name="customer_type"><option value="external">Client externe (non patient du centre)</option><option value="patient">Patient du centre de santé</option></select></label>' : '<input type="hidden" name="customer_type" value="external">'}<label data-patient-field hidden>Patient<select name="patient_id"><option value="">Sélectionner un patient…</option>${patientsList.map(patient => `<option value="${esc(patient.id)}">${esc(patient.patient_code)} · ${esc(patient.full_name)}</option>`).join('')}</select><small>Requis pour contrôler les achats rapprochés et utiliser une assurance.</small></label><label data-external-field>Nom du client (facultatif)<input name="customer_name" maxlength="190" autocomplete="off" placeholder="Client de passage"></label><label data-external-field>Téléphone (facultatif)<input name="customer_phone" maxlength="50" autocomplete="off"></label></div><div class="sale-workflow-grid"><section class="sale-workflow-section"><div class="panel-head purchase-items-head"><h4>Articles</h4><div><button type="button" class="table-action" data-open-scanner>▣ Scanner un code</button><button type="button" class="table-action" data-add-sale-item>＋ Ajouter un produit</button></div></div><div class="sale-items"></div><div class="prescription-upload" data-prescription-upload hidden><h4>Ordonnance obligatoire</h4><p>Joignez une photo nette de l’ordonnance. Elle sera sauvegardée avec la facture (JPEG, PNG ou WebP, 500 Ko maximum).</p><label>Capturer ou choisir l’image<input data-prescription-image type="file" accept="image/*" capture="environment"></label><p data-prescription-status class="notification-empty" aria-live="polite"></p></div></section><section class="sale-workflow-section sale-payment-section" ${separate ? 'hidden' : ''}><div class="panel-head purchase-items-head"><h4>Modes d’encaissement</h4><button type="button" class="table-action" data-add-tender>＋ Ajouter un mode</button></div><div class="sale-tenders"></div></section></div><div class="sale-total" aria-live="polite"></div><label>Notes<textarea name="notes" rows="2" maxlength="2000"></textarea></label><p class="notification-empty">Les alertes de quantité ou d’intervalle sont des signaux à vérifier par un professionnel ; elles ne constituent pas un diagnostic ni un blocage automatique.</p><button class="btn">${separate ? 'Enregistrer la vente à encaisser' : 'Enregistrer la vente et générer le reçu'}</button><p class="error" role="alert"></p></form></div>`;
            refreshAccess();
            const form = root.querySelector('#sale-form'), itemsBox = form.querySelector('.sale-items'), tendersBox = form.querySelector('.sale-tenders');
            const prescriptionInput = form.querySelector('[data-prescription-image]'), prescriptionPanel = form.querySelector('[data-prescription-upload]'), prescriptionStatus = form.querySelector('[data-prescription-status]');
            let prescriptionImage = null, prescriptionProcessing = false, prescriptionVersion = 0, scannerModal = null, scannerReader = null, scannerControls = null, scannerObserver = null, scannerGeneration = 0, scannerAudioContext = null;
            async function compressPrescription(file) {
                if (!file.type.startsWith('image/')) throw Error('Sélectionnez une image de l’ordonnance.');
                if (typeof createImageBitmap !== 'function') throw Error('Ce navigateur ne peut pas traiter cette image. Utilisez un navigateur récent ou choisissez une image JPEG.');
                const image = await createImageBitmap(file), scale = Math.min(1, 1280 / Math.max(image.width, image.height)), canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
                const context = canvas.getContext('2d'); if (!context) { image.close(); throw Error('Impossible de préparer l’image de l’ordonnance.'); }
                context.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
                for (const quality of [.82, .7, .58, .45, .32]) {
                    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                    if (blob && blob.size <= 500 * 1024) {
                        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('Impossible de lire la photo de l’ordonnance.')); reader.readAsDataURL(blob); });
                        return { mime_type: 'image/jpeg', data: String(dataUrl).split(',')[1] };
                    }
                }
                throw Error('L’image est trop volumineuse. Reprenez une photo plus rapprochée (500 Ko maximum).');
            }
            function hasRequiredPrescription() {
                return [...itemsBox.children].some(row => productsList.find(item => String(item.id) === row.querySelector('[data-product]').value)?.prescription_required);
            }
            function updatePrescriptionPanel() {
                const required = hasRequiredPrescription(); prescriptionPanel.hidden = !required; prescriptionInput.disabled = !required;
                if (!required) { prescriptionVersion += 1; prescriptionProcessing = false; prescriptionImage = null; prescriptionInput.value = ''; prescriptionStatus.textContent = ''; }
            }
            function addScannedProduct(rawCode) {
                const code = String(rawCode || '').trim();
                if (!code) return '';
                const product = productsList.find(item => String(item.barcode || '').trim().toLowerCase() === code.toLowerCase() || String(item.sku || '').trim().toLowerCase() === code.toLowerCase());
                if (!product) return `Aucun produit ne correspond au code « ${code} ». Vérifiez le code-barres ou le QR dans le catalogue.`;
                const rows = [...itemsBox.children], existing = rows.find(row => row.querySelector('[data-product]').value === String(product.id));
                if (existing) {
                    existing.querySelector('[data-quantity]').value = (Number(existing.querySelector('[data-quantity]').value) + 1).toString();
                    updateSaleTotal();
                } else {
                    const emptyRow = rows.find(row => !row.querySelector('[data-product]').value);
                    if (emptyRow) {
                        const select = emptyRow.querySelector('[data-product]');
                        select.value = String(product.id);
                        select.dispatchEvent(new Event('change'));
                    } else addSaleItem(product);
                }
                return `${product.name} ajouté au panier.`;
            }
            function playScannerBeep() {
                const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
                if (!AudioContextConstructor) return;
                if (!scannerAudioContext) scannerAudioContext = new AudioContextConstructor();
                const context = scannerAudioContext;
                const play = () => {
                    const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
                    oscillator.frequency.value = 880; gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
                    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.13);
                };
                if (context.state === 'suspended') context.resume().then(play).catch(error => console.error('Impossible d’activer le bip du scanner.', error));
                else play();
            }
            function updateScannerCartCount() {
                const cartCount = scannerModal?.querySelector('[data-scanner-cart-count]');
                if (!cartCount) return;
                let itemCount = 0, referenceCount = 0;
                for (const row of itemsBox.children) {
                    if (!row.querySelector('[data-product]').value) continue;
                    const quantity = Number(row.querySelector('[data-quantity]').value || 0);
                    if (Number.isFinite(quantity) && quantity > 0) { itemCount += quantity; referenceCount += 1; }
                }
                cartCount.textContent = `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(itemCount)} article${itemCount === 1 ? '' : 's'} dans le panier · ${referenceCount} référence${referenceCount === 1 ? '' : 's'}`;
            }
            function closeScanner() {
                const controls = scannerControls, reader = scannerReader, video = scannerModal?.querySelector('[data-scanner-video]');
                scannerGeneration += 1;
                scannerControls = null; scannerReader = null;
                scannerObserver?.disconnect(); scannerObserver = null;
                scannerModal?.remove(); scannerModal = null;
                video?.srcObject?.getTracks().forEach(track => track.stop());
                try { controls?.stop(); } catch (error) { console.error('Impossible d’arrêter proprement le lecteur de codes.', error); }
                try { reader?.reset(); } catch (error) { console.error('Impossible de réinitialiser le lecteur de codes.', error); }
            }
            function openScanner() {
                if (scannerModal) return;
                scannerModal = document.createElement('div'); scannerModal.className = 'overlay scanner-overlay';
                scannerModal.innerHTML = `<section class="modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title"><button type="button" class="close" aria-label="Fermer">×</button><h3 id="scanner-title">Scanner des produits</h3><p>Scannez les articles les uns après les autres. La fenêtre reste ouverte jusqu’à sa fermeture.</p><p class="scanner-cart-count" data-scanner-cart-count aria-live="polite">0 article dans le panier · 0 référence</p><label>Code-barres ou code QR<input data-scan-code type="text" autocomplete="off" placeholder="Scannez ici puis appuyez sur Entrée"></label><video data-scanner-video playsinline muted hidden></video><button class="btn" type="button" data-start-camera>Activer la caméra</button><p class="notification-empty" data-scanner-status role="status" aria-live="polite">La caméra doit être autorisée par le navigateur. Un navigateur ancien ou sans caméra peut utiliser la douchette.</p></section>`;
                document.body.append(scannerModal);
                updateScannerCartCount();
                const input = scannerModal.querySelector('[data-scan-code]'), status = scannerModal.querySelector('[data-scanner-status]'), video = scannerModal.querySelector('[data-scanner-video]');
                const closeButton = scannerModal.querySelector('.close');
                let lastCameraCode = '', cameraResetTimer = null;
                closeButton.onclick = closeScanner; scannerModal.addEventListener('click', event => { if (event.target === scannerModal) closeScanner(); });
                scannerModal.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); closeScanner(); } };
                input.onkeydown = event => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault(); const result = addScannedProduct(input.value);
                    input.value = ''; input.focus();
                    if (!result) return;
                    status.textContent = result.startsWith('Aucun produit') ? result : `${result} Continuez à scanner ou fermez cette fenêtre.`;
                    if (!result.startsWith('Aucun produit')) { playScannerBeep(); toast(result); }
                };
                scannerModal.querySelector('[data-start-camera]').onclick = async () => {
                    const generation = ++scannerGeneration;
                    const ZXing = window.ZXingBrowser;
                    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { status.textContent = 'La caméra nécessite HTTPS (ou localhost) et l’autorisation du navigateur.'; return; }
                    if (!ZXing?.BrowserMultiFormatReader) { status.textContent = 'Le module de lecture caméra est indisponible. Rechargez la page ou utilisez la douchette.'; return; }
                    const button = scannerModal.querySelector('[data-start-camera]'); button.disabled = true; status.textContent = 'Demande d’accès à la caméra…';
                    try {
                        const reader = new ZXing.BrowserMultiFormatReader(); scannerReader = reader; video.hidden = false;
                        const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (result, scanError, controls) => {
                            if (result && scannerModal) {
                                const code = result.getText();
                                if (code !== lastCameraCode) {
                                    lastCameraCode = code;
                                    const message = addScannedProduct(code);
                                    status.textContent = message.startsWith('Aucun produit') ? message : `${message} Présentez l’article suivant.`;
                                    if (!message.startsWith('Aucun produit')) { playScannerBeep(); toast(message); }
                                }
                                clearTimeout(cameraResetTimer);
                                cameraResetTimer = setTimeout(() => { lastCameraCode = ''; }, 900);
                            }
                        });
                        if (!scannerModal || generation !== scannerGeneration) { controls.stop(); reader.reset(); return; }
                        scannerControls = controls; status.textContent = 'Caméra active. Présentez le code-barres ou le QR devant l’objectif.';
                    } catch (error) { if (scannerModal && generation === scannerGeneration) status.textContent = error.name === 'NotAllowedError' ? 'Autorisez l’accès à la caméra dans le navigateur, puis réessayez.' : `Caméra indisponible : ${error.message}`; if (generation === scannerGeneration) { scannerReader?.reset(); scannerReader = null; } }
                    finally { if (scannerModal) button.disabled = Boolean(scannerReader && scannerControls); }
                };
                scannerObserver = new MutationObserver(() => { if (!root.isConnected || !form.isConnected) closeScanner(); });
                scannerObserver.observe(document.body, { childList: true, subtree: true });
                input.focus();
            }
            function addTender(amount = '') {
                const row = document.createElement('div'); row.className = 'sale-tender-row';
                row.innerHTML = `<div class="two"><label>Mode<select data-method>${Object.entries(paymentLabels).filter(([value]) => value !== 'insurance' || patientSalesEnabled).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Montant<input data-amount type="number" min="0" step="0.01" value="${esc(amount)}" placeholder="Laisser à 0 pour crédit"></label></div><div class="two"><label data-cash-field hidden>Espèces reçues<input data-cash-received type="number" min="0" step="0.01"></label><label data-insurer-field hidden>Assureur<select data-insurer><option value="">Sélectionner un patient et un contrat</option>${insurersList.map(insurer => `<option value="${esc(insurer.id)}">${esc(insurer.name)}</option>`).join('')}</select></label></div><label>Référence (facultatif)<input data-reference maxlength="190"></label><button class="table-action danger" type="button" data-remove-tender>Retirer ce mode</button>`;
                row.querySelector('[data-remove-tender]').onclick = () => { row.remove(); updateSaleTotal(); };
                row.querySelector('[data-method]').onchange = () => { const cash = row.querySelector('[data-method]').value === 'cash'; row.querySelector('[data-cash-field]').hidden = !cash; row.querySelector('[data-cash-received]').required = cash; row.querySelector('[data-cash-received]').disabled = !cash; row.querySelector('[data-insurer-field]').hidden = row.querySelector('[data-method]').value !== 'insurance'; };
                row.querySelector('[data-method]').dispatchEvent(new Event('change')); row.querySelector('[data-amount]').oninput = updateSaleTotal; tendersBox.append(row);
            }
            async function loadPatientInsurers() {
                const patientId = form.elements.patient_id.value;
                let coverages = [];
                if (patientId) coverages = await api(`/api/sales/patients/${encodeURIComponent(patientId)}/insurers`);
                tendersBox.querySelectorAll('[data-insurer]').forEach(select => { select.innerHTML = `<option value="">Sélectionner un assureur actif du patient</option>${coverages.map(coverage => `<option value="${esc(coverage.insurer_id)}">${esc(coverage.insurer_name)}</option>`).join('')}`; });
            }
            function addSaleItem(product = null) {
                if (!productsList.length) throw Error('Ajoutez un produit actif au catalogue avant une vente.');
                const row = document.createElement('div'); row.className = 'purchase-item-row sale-item-row';
                row.innerHTML = `<label>Produit<select data-product required><option value="" ${product ? '' : 'selected'} disabled>Choisir un produit…</option>${productsList.map(item => `<option value="${esc(item.id)}" ${String(item.id) === String(product?.id) ? 'selected' : ''}>${esc(item.name)} · ${esc(item.sku)} (${esc(item.quantity_on_hand)} ${esc(item.unit)})</option>`).join('')}</select><small data-price></small><span class="tag" data-prescription-note></span></label><label>Quantité<input data-quantity type="number" min="0.001" step="0.001" value="1" required ${product ? '' : 'disabled'}></label><label data-prescription-field hidden>Ordonnance présentée<input data-prescription type="checkbox" value="true"></label><button type="button" class="table-action danger" data-remove-item aria-label="Retirer le produit">×</button>`;
                const updateRow = () => {
                    const item = productsList.find(entry => String(entry.id) === row.querySelector('[data-product]').value), quantity = row.querySelector('[data-quantity]');
                    quantity.disabled = !item;
                    row.querySelector('[data-price]').textContent = item ? `${formatMoney(item.sale_price)} HT · ${esc(item.quantity_on_hand)} ${esc(item.unit)} en stock` : '';
                    row.querySelector('[data-prescription-note]').textContent = item ? (item.prescription_required ? 'Ordonnance obligatoire' : 'Ordonnance non requise') : '';
                    row.querySelector('[data-prescription-field]').hidden = !item?.prescription_required;
                    row.querySelector('[data-prescription]').required = Boolean(item?.prescription_required);
                    if (!item) row.querySelector('[data-prescription]').checked = false;
                    updatePrescriptionPanel(); updateSaleTotal();
                };
                row.querySelector('[data-product]').onchange = updateRow; row.querySelector('[data-quantity]').oninput = updateSaleTotal;
                row.querySelector('[data-remove-item]').onclick = () => { if (itemsBox.children.length === 1) { toast('Une vente doit contenir au moins un article.'); return; } row.remove(); updatePrescriptionPanel(); updateSaleTotal(); };
                itemsBox.append(row); updateRow();
            }
            function updateSaleTotal() {
                let subtotal = 0, tax = 0;
                for (const row of itemsBox.children) { const product = productsList.find(item => String(item.id) === row.querySelector('[data-product]').value); if (product) { const quantity = Number(row.querySelector('[data-quantity]').value || 0); const line = Math.round((quantity * Number(product.sale_price) + Number.EPSILON) * 100) / 100; subtotal += line; tax += Math.round((line * Number(state.settings.sales_tax_rate || 0) / 100 + Number.EPSILON) * 100) / 100; } }
                subtotal = Math.round((subtotal + Number.EPSILON) * 100) / 100;
                tax = Math.round((tax + Number.EPSILON) * 100) / 100; const total = subtotal + tax;
                root.querySelector('.sale-total').innerHTML = `<div class="row"><span>Sous-total HT</span><strong>${formatMoney(subtotal)}</strong></div><div class="row"><span>Taxe (${esc(state.settings.sales_tax_rate || 0)} %)</span><strong>${formatMoney(tax)}</strong></div><div class="row"><b>Total TTC</b><strong>${formatMoney(total)}</strong></div>`;
                if (tendersBox.children.length === 1) tendersBox.querySelector('[data-amount]').value = total.toFixed(2);
                updateScannerCartCount();
            }
            form.querySelector('[data-add-sale-item]').onclick = () => { try { addSaleItem(); } catch (error) { toast(error.message); } };
            form.querySelector('[data-open-scanner]').onclick = openScanner;
            prescriptionInput.onchange = async () => {
                const version = ++prescriptionVersion; prescriptionImage = null; const file = prescriptionInput.files?.[0]; if (!file) { prescriptionProcessing = false; prescriptionStatus.textContent = ''; return; }
                prescriptionProcessing = true; prescriptionStatus.textContent = 'Préparation de la photo…';
                try { const image = await compressPrescription(file); if (version === prescriptionVersion) { prescriptionImage = image; prescriptionStatus.textContent = 'Photo de l’ordonnance prête à être enregistrée avec la facture.'; } }
                catch (error) { if (version === prescriptionVersion) { prescriptionInput.value = ''; prescriptionStatus.textContent = error.message; } }
                finally { if (version === prescriptionVersion) prescriptionProcessing = false; }
            };
            form.querySelector('[data-add-tender]').onclick = () => { addTender(); loadPatientInsurers().catch(error => toast(error.message)); };
            form.elements.patient_id.onchange = () => loadPatientInsurers().catch(error => toast(error.message));
            const customerType = form.elements.customer_type;
            const syncCustomerType = () => {
                const patient = customerType.value === 'patient';
                form.querySelector('[data-patient-field]').hidden = !patient;
                form.querySelectorAll('[data-external-field]').forEach(field => { field.hidden = patient; });
                form.elements.patient_id.required = patient;
                if (!patient) form.elements.patient_id.value = '';
                loadPatientInsurers().catch(error => toast(error.message));
            };
            customerType.onchange = syncCustomerType;
            addSaleItem(); if (!separate) addTender(); syncCustomerType();
            form.onsubmit = async event => {
                event.preventDefault(); const error = form.querySelector('.error'); error.textContent = '';
                if (!separate && !cashState.current_session) { error.textContent = 'Vente impossible : la caisse est fermée. Ouvrez une session de caisse puis réessayez.'; return; }
                if (prescriptionProcessing) { error.textContent = 'Patientez pendant la préparation de la photo de l’ordonnance.'; return; }
                if ([...itemsBox.children].some(row => !row.querySelector('[data-product]').value)) { error.textContent = 'Sélectionnez un produit pour chaque ligne avant d’enregistrer la vente.'; itemsBox.querySelector('[data-product]:invalid')?.focus(); return; }
                const items = [...itemsBox.children].map(row => ({ product_id: row.querySelector('[data-product]').value, quantity: row.querySelector('[data-quantity]').value, prescription_provided: row.querySelector('[data-prescription]').checked }));
                if (items.some(item => { const product = productsList.find(entry => String(entry.id) === item.product_id); return product?.prescription_required && !item.prescription_provided; })) { error.textContent = 'Confirmez la présentation de l’ordonnance pour chaque produit concerné.'; return; }
                if (hasRequiredPrescription() && !prescriptionImage) { error.textContent = 'Capturez ou joignez la photo de l’ordonnance requise avant d’enregistrer la vente.'; prescriptionStatus.textContent = 'Une ordonnance doit être jointe à cette vente.'; return; }
                for (const row of tendersBox.children) {
                    if (row.querySelector('[data-method]').value !== 'cash') continue;
                    const received = row.querySelector('[data-cash-received]');
                    if (!received.value.trim()) { error.textContent = 'Le montant reçu en espèces est obligatoire.'; received.focus(); return; }
                    if (!received.checkValidity() || Number(received.value) < Number(row.querySelector('[data-amount]').value || 0)) { error.textContent = 'Le montant reçu en espèces doit couvrir le montant encaissé.'; received.focus(); return; }
                }
                const payments = [...tendersBox.children].map(row => ({ method: row.querySelector('[data-method]').value, amount: Number(row.querySelector('[data-amount]').value || 0), cash_received: row.querySelector('[data-method]').value === 'cash' ? Number(row.querySelector('[data-cash-received]').value) : undefined, insurer_id: row.querySelector('[data-insurer]').value || undefined, reference: row.querySelector('[data-reference]').value || undefined })).filter(payment => payment.amount > 0);
                const isPatient = form.elements.customer_type.value === 'patient';
                if (isPatient && !form.elements.patient_id.value) { error.textContent = 'Sélectionnez le patient ou choisissez « Client externe ».'; form.elements.patient_id.focus(); return; }
                const customerName = form.elements.customer_name.value.trim(), customerPhone = form.elements.customer_phone.value.trim();
                const notes = [!isPatient && customerPhone ? `Téléphone client : ${customerPhone}` : '', form.elements.notes.value.trim()].filter(Boolean).join('\n');
                const payload = { patient_id: isPatient ? form.elements.patient_id.value : null, ...(!isPatient && customerName ? { patient_name: customerName } : {}), items, payments, notes, ...(prescriptionImage ? { prescription_image: prescriptionImage } : {}) };
                const submit = form.querySelector('button.btn'); submit.disabled = true;
                try {
                    const result = await api('/api/sales', { method: 'POST', body: JSON.stringify(payload) });
                    modalMessage(result.review_flags);
                    toast(`Vente ${result.invoice_number} · ${invoiceStatusLabels[result.status] || result.status} · ${formatMoney(result.total_amount)}.`);
                    await salesInvoices(root); await saleReceipt(root, result.id);
                } catch (reason) { error.textContent = reason.message; }
                finally { submit.disabled = false; }
            };
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    function modalMessage(flags) { if (flags?.length) toast(`À vérifier : ${flags.map(flag => flag.product_name).join(', ')}. Le signalement n'est pas un diagnostic.`); }
    async function salesInvoices(root) {
        try {
            const rows = await api('/api/sales');
            root.innerHTML = `<div class="panel"><div class="panel-head"><div><h3>Factures & reçus</h3><p>Reçus numérotés, paiements, retours et corrections traçables.</p></div><button class="btn" type="button" data-go="pos">＋ Nouvelle vente</button></div><div data-invoices-table></div></div>`;
            mountDataTable(root.querySelector('[data-invoices-table]'), {
                rows: rows.map(invoice => ({ ...invoice, displayStatus: invoiceStatusLabels[invoice.status] || invoice.status, searchText: [invoice.invoice_number, invoice.patient_name, invoice.status].join(' ') })), searchText: 'Rechercher par numéro de reçu ou patient…', filters: [{ label: 'Statut', options: [...new Set(rows.map(invoice => invoice.status))].map(status => ({ value: status, label: invoiceStatusLabels[status] || status })), value: invoice => invoice.status }], columns: [
                    { label: 'Reçu', sortValue: invoice => invoice.invoice_number, render: invoice => `<b>${esc(invoice.invoice_number)}</b><small>${esc(new Date(invoice.created_at).toLocaleString('fr-FR'))}</small>` },
                    { label: 'Patient / client', sortValue: invoice => invoice.patient_name || '', render: invoice => esc(invoice.patient_name || 'Client non enregistré') },
                    { label: 'Total TTC', sortValue: invoice => Number(invoice.total_amount), render: invoice => formatMoney(invoice.total_amount) },
                    { label: 'Encaissé', sortValue: invoice => Number(invoice.paid_amount) - Number(invoice.refunded_amount), render: invoice => formatMoney(Number(invoice.paid_amount) - Number(invoice.refunded_amount)) },
                    { label: 'État', sortValue: invoice => invoiceStatusLabels[invoice.status] || invoice.status, render: invoice => `<span class="tag">${esc(invoiceStatusLabels[invoice.status] || invoice.status)}</span>${invoice.review_flags ? '<small>À vérifier</small>' : ''}` },
                    { label: 'Actions', render: invoice => `<button class="table-action" type="button" data-view-invoice="${esc(invoice.id)}">Reçu / détails</button>` }
                ]
            });
            refreshAccess();
            root.querySelectorAll('[data-view-invoice]').forEach(button => button.onclick = () => saleReceipt(root, button.dataset.viewInvoice));
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    async function saleReceipt(root, invoiceId) {
        try {
            const invoice = await api(`/api/sales/${encodeURIComponent(invoiceId)}`), modal = document.createElement('div'); modal.className = 'overlay'; modal.id = 'receipt-modal';
            let flags = invoice.review_flags || []; if (typeof flags === 'string') flags = JSON.parse(flags);
            const paid = Number(invoice.paid_amount || 0), refunded = Number(invoice.refunded_amount || 0), returnedValue = Number(invoice.returned_value), balance = Math.max(0, Number(invoice.total_amount) - returnedValue - paid + refunded);
            const itemRows = invoice.items.map(item => `<tr><td>${esc(item.product_name)}<small>${esc(item.sku)}</small></td><td>${esc(item.quantity)} ${esc(item.unit)}</td><td>${formatMoney(item.unit_price)}</td><td>${formatMoney(item.line_total)}</td><td><span class="tag">${item.prescription_required ? 'Ordonnance requise' : 'Sans ordonnance requise'}${item.prescription_required && item.prescription_provided ? ' · présentée' : ''}</span></td><td>${esc(item.returned_quantity)}</td></tr>`).join('');
            const paymentRows = invoice.payments.map(payment => `<div class="row"><span>${esc(paymentLabels[payment.payment_method] || payment.payment_method)}${payment.insurer_name ? ` · ${esc(payment.insurer_name)}` : ''}${payment.reference ? ` · réf. ${esc(payment.reference)}` : ''}<small>${esc(new Date(payment.created_at).toLocaleString('fr-FR'))}${payment.payment_method === 'cash' ? ` · reçu ${formatMoney(payment.cash_received)}, rendu ${formatMoney(payment.cash_change)}` : ''}</small></span><strong>${formatMoney(payment.amount)}</strong></div>`).join('');
            const returnRows = invoice.returns.map(record => `<div class="row"><span>${esc(record.return_number)} · ${esc(paymentLabels[record.refund_method] || record.refund_method)}${record.insurer_name ? ` · ${esc(record.insurer_name)}` : ''}<small>${esc(record.reason)} · ${esc(new Date(record.created_at).toLocaleString('fr-FR'))}</small></span><strong>− ${formatMoney(record.refund_amount)}</strong></div>`).join('');
            const flagsHtml = flags.length ? `<div class="review-flags"><b>Achat à vérifier par un professionnel</b>${flags.map(flag => `<p>${esc(flag.product_name)} — ${esc(flag.message)}</p>`).join('')}<small>Signalement indicatif, non diagnostique et sans blocage automatique.</small></div>` : '';
            modal.innerHTML = `<section class="modal receipt-content"><button type="button" class="close" aria-label="Fermer">×</button><div class="panel-head"><div><small>REÇU DE VENTE</small><div class="receipt-meta"><h3>${esc(invoice.invoice_number)}</h3><p>${esc(new Date(invoice.created_at).toLocaleString('fr-FR'))}</p><p>Client : <b>${esc(invoice.patient_name || 'Client non enregistré')}</b></p><p>Statut : <b>${esc(invoiceStatusLabels[invoice.status] || invoice.status)}</b></p></div></div><button type="button" class="table-action" data-print>Imprimer</button></div>${flagsHtml}<div class="tablewrap"><table><thead><tr><th>Produit</th><th>Qté</th><th>PU HT</th><th>Total TTC</th><th>Ordonnance</th><th>Retour</th></tr></thead><tbody>${itemRows}</tbody></table></div><div class="row"><span>Sous-total HT</span><strong>${formatMoney(invoice.subtotal)}</strong></div><div class="row"><span>Taxe (${esc(invoice.tax_rate)} %)</span><strong>${formatMoney(invoice.tax_amount)}</strong></div><div class="row"><b>Total TTC</b><strong>${formatMoney(invoice.total_amount)}</strong></div><h4>Paiements</h4>${paymentRows || '<p class="notification-empty">Aucun paiement enregistré.</p>'}${returnRows ? `<h4>Retours / remboursements</h4>${returnRows}` : ''}${invoice.has_prescription ? '<button type="button" class="table-action" data-view-prescription>Consulter l’ordonnance jointe</button><div data-prescription-preview></div>' : ''}<div class="row"><b>Solde à payer</b><strong>${formatMoney(balance)}</strong></div>${invoice.separate_cashier && balance > 0 && !['cancelled', 'returned'].includes(invoice.status) ? `<p class="notification-empty">Encaissement en caisse par un autre utilisateur.</p>` : ''}<div class="receipt-actions">${invoice.status !== 'cancelled' && invoice.status !== 'returned' && balance > 0 && !invoice.separate_cashier ? '<button type="button" class="btn" data-pay-balance>Enregistrer un paiement</button>' : ''}${invoice.status !== 'cancelled' && invoice.status !== 'returned' ? '<button type="button" class="table-action" data-return-items>Retour / remboursement</button>' : ''}${invoice.status === 'issued' ? '<button type="button" class="table-action danger" data-cancel-invoice>Annuler la facture</button>' : ''}</div></section>`;
            const canPay = canAccessPage('cash') && (!invoice.separate_cashier || (window.RedamsAccess.canCollect(state.profile, { separate_sale_payment: 1 }) && Number(invoice.created_by) !== state.userId));
            addReceiptIdentity(modal.querySelector('.receipt-content'), invoice.invoice_number);
            const paymentButton = modal.querySelector('[data-pay-balance]');
            if (paymentButton) paymentButton.hidden = !canPay;
            const returnButton = modal.querySelector('[data-return-items]');
            if (returnButton) returnButton.hidden = !canAccessPage('cash');
            const prescriptionButton = modal.querySelector('[data-view-prescription]');
            if (prescriptionButton) prescriptionButton.hidden = !state.canAccessPatientRecords;
            document.body.append(modal); let prescriptionUrl = null;
            const closeReceipt = () => { if (prescriptionUrl) URL.revokeObjectURL(prescriptionUrl); modal.remove(); };
            modal.querySelector('.close').onclick = closeReceipt; modal.addEventListener('click', event => { if (event.target === modal) closeReceipt(); });
            modal.querySelector('[data-view-prescription]')?.addEventListener('click', async () => { try { const image = await api(`/api/sales/${encodeURIComponent(invoice.id)}/prescription`); if (prescriptionUrl) URL.revokeObjectURL(prescriptionUrl); prescriptionUrl = URL.createObjectURL(image); const preview = document.createElement('img'); preview.src = prescriptionUrl; preview.alt = 'Ordonnance jointe à la facture'; modal.querySelector('[data-prescription-preview]').replaceChildren(preview); } catch (error) { toast(error.message); } });
            const printButton = modal.querySelector('[data-print]');
            const printControls = document.createElement('div');
            printControls.className = 'receipt-print-controls';
            printControls.innerHTML = '<label>Orientation<select data-print-orientation><option value="portrait">Portrait</option><option value="landscape">Paysage</option></select></label>';
            printButton.before(printControls);
            printControls.append(printButton);
            printButton.onclick = () => printReceipt(modal);
            modal.querySelector('[data-pay-balance]')?.addEventListener('click', () => { closeReceipt(); paymentForm(root, invoice, balance); });
            modal.querySelector('[data-return-items]')?.addEventListener('click', () => { closeReceipt(); returnForm(root, invoice); });
            modal.querySelector('[data-cancel-invoice]')?.addEventListener('click', async () => { const reason = prompt('Motif d’annulation (obligatoire) :'); if (reason === null) return; try { await api(`/api/sales/${encodeURIComponent(invoice.id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }); toast('Facture annulée, stock réintégré.'); closeReceipt(); await salesInvoices(root); } catch (error) { toast(error.message); } });
        } catch (error) { toast(error.message); }
    }
    async function printReceipt(modal) {
        const pageStyle = document.createElement('style');
        const cleanup = () => {
            document.body.classList.remove('receipt-printing');
            pageStyle.remove();
            window.removeEventListener('afterprint', cleanup);
        };
        try {
            const logo = modal.querySelector('.receipt-identity img');
            if (logo) await logo.decode();
            const orientation = modal.querySelector('[data-print-orientation]').value === 'landscape' ? 'landscape' : 'portrait';
            pageStyle.textContent = `@media print { @page { size: A4 ${orientation}; margin: 0 5mm 15mm; } }`;
            document.head.append(pageStyle);
            document.body.classList.add('receipt-printing');
            window.addEventListener('afterprint', cleanup, { once: true });
            window.print();
        } catch (error) {
            cleanup();
            toast(`Impression impossible : ${error.message}`, 'error');
        }
    }
    function addReceiptIdentity(content, invoiceNumber) {
        if (!window.JsBarcode) throw Error('Le générateur de codes-barres est indisponible. Rechargez la page puis réessayez.');
        const identity = document.createElement('div');
        identity.className = 'receipt-identity';
        const logo = safeLogoUrl(state.settings.logo_url);
        identity.innerHTML = `${logo ? `<img src="${esc(logo)}" alt="Logo de l’entreprise">` : ''}<div><h2>${esc(state.settings.company_name || state.profile.organization_name)}</h2><p>${esc(state.settings.company_address || '')}</p>${state.settings.display_name && state.settings.display_name !== state.settings.company_name ? `<p>${esc(state.settings.display_name)}</p>` : ''}<p>${esc([state.settings.company_phone, state.settings.company_email].filter(Boolean).join(' · '))}</p></div>`;
        const barcode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        barcode.classList.add('receipt-barcode');
        barcode.setAttribute('role', 'img'); barcode.setAttribute('aria-label', `Code-barres de la facture ${invoiceNumber}`);
        window.JsBarcode(barcode, invoiceNumber, { format: 'CODE128', displayValue: true, width: 1.5, height: 40, margin: 6, fontSize: 11, background: '#ffffff', lineColor: '#000000' });
        content.prepend(identity);
        content.append(barcode);
    }
    async function paymentForm(root, invoice, balance, cashPage = null) {
        let coverages = [];
        try { if (invoice.patient_id) coverages = await api(`/api/sales/patients/${encodeURIComponent(invoice.patient_id)}/insurers`); } catch (error) { toast(error.message); return; }
        const modal = document.createElement('div'); modal.className = 'overlay';
        modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Enregistrer un paiement</h3><p>Solde disponible : ${formatMoney(balance)}</p><label>Mode de paiement<select name="method">${Object.entries(paymentLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Montant<input name="amount" type="number" min="0.01" max="${esc(balance)}" step="0.01" value="${esc(balance)}" required></label><label data-cash-field hidden>Espèces reçues<input name="cash_received" type="number" min="0" step="0.01"></label><label data-insurer-field hidden>Assureur<select name="insurer_id"><option value="">Choisir un assureur actif du patient</option>${coverages.map(item => `<option value="${esc(item.insurer_id)}">${esc(item.insurer_name)}</option>`).join('')}</select></label><label>Référence<input name="reference" maxlength="190"></label><button class="btn">Enregistrer le paiement</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove();
        form.elements.method.onchange = () => { const cash = form.elements.method.value === 'cash'; form.querySelector('[data-cash-field]').hidden = !cash; form.elements.cash_received.required = cash; form.elements.cash_received.disabled = !cash; form.querySelector('[data-insurer-field]').hidden = form.elements.method.value !== 'insurance'; }; form.elements.method.dispatchEvent(new Event('change'));
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; if (!form.reportValidity()) return; const submit = form.querySelector('[type=submit],button.btn'); submit.disabled = true; const payment = { method: form.elements.method.value, amount: form.elements.amount.value, reference: form.elements.reference.value || undefined }; if (payment.method === 'cash') payment.cash_received = form.elements.cash_received.value; if (payment.method === 'insurance') payment.insurer_id = form.elements.insurer_id.value; try { const result = await api(`/api/sales/${encodeURIComponent(invoice.id)}/payments`, { method: 'POST', body: JSON.stringify({ payments: [payment] }) }); modal.remove(); toast(`Paiement enregistré · ${invoiceStatusLabels[result.status] || result.status}.`); if (cashPage !== null) await cashRegister(root, cashPage); else { await salesInvoices(root); await saleReceipt(root, invoice.id); } } catch (reason) { error.textContent = reason.message; } finally { submit.disabled = false; } };
    }
    function returnForm(root, invoice) {
        const modal = document.createElement('div'); modal.className = 'overlay';
        const insurers = [...new Map(invoice.payments.filter(payment => payment.payment_method === 'insurance' && payment.insurer_id).map(payment => [String(payment.insurer_id), payment])).values()];
        modal.innerHTML = `<form class="modal purchase-modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Retour et remboursement</h3><p>Renseignez la quantité retournée. Le montant est calculé à partir du reçu original.</p><div class="return-lines">${invoice.items.filter(item => Number(item.returned_quantity) < Number(item.quantity)).map(item => `<div class="purchase-item-row"><label>${esc(item.product_name)}<small>Restant : ${esc(Number(item.quantity) - Number(item.returned_quantity))} ${esc(item.unit)}</small><input type="hidden" data-item-id value="${esc(item.id)}"></label><label>Quantité<input data-return-quantity type="number" min="0" max="${esc(Number(item.quantity) - Number(item.returned_quantity))}" step="0.001" value="0"></label><label class="inline-check"><input data-restock type="checkbox" checked> Réintégrer au stock</label></div>`).join('')}</div><label>Mode de remboursement<select name="refund_method">${Object.entries(paymentLabels).filter(([value]) => value !== 'insurance' || insurers.length).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>${insurers.length ? `<label data-return-insurer hidden>Assureur<select name="insurer_id"><option value="">Choisir l’assureur</option>${insurers.map(payment => `<option value="${esc(payment.insurer_id)}">${esc(payment.insurer_name)}</option>`).join('')}</select></label>` : ''}<label>Motif du retour<textarea name="reason" minlength="3" maxlength="500" required></textarea></label><button class="btn">Enregistrer le retour et remboursement</button><p class="error" role="alert"></p></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove();
        form.elements.refund_method.onchange = () => { const field = form.querySelector('[data-return-insurer]'); if (field) field.hidden = form.elements.refund_method.value !== 'insurance'; };
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; const items = [...form.querySelectorAll('[data-item-id]')].map(field => ({ item_id: field.value, quantity: field.closest('.purchase-item-row').querySelector('[data-return-quantity]').value, restocked: field.closest('.purchase-item-row').querySelector('[data-restock]').checked })).filter(item => Number(item.quantity) > 0), body = { items, refund_method: form.elements.refund_method.value, reason: form.elements.reason.value }; if (body.refund_method === 'insurance') body.insurer_id = form.elements.insurer_id.value; try { const result = await api(`/api/sales/${encodeURIComponent(invoice.id)}/returns`, { method: 'POST', body: JSON.stringify(body) }); modal.remove(); toast(`Retour ${result.return_number} · ${formatMoney(result.refund_amount)} remboursé.`); await saleReceipt(root, invoice.id); await salesInvoices(root); } catch (reason) { error.textContent = reason.message; } };
    }
    function normalizeInvoiceCode(raw) {
        const match = String(raw || '').toUpperCase().replace(/\s+/g, '').match(/FAC-\d{8}-\d{6,20}/);
        return match ? match[0] : '';
    }
    function openSaleScanner(root, onCode) {
        if (document.querySelector('.sale-scanner-overlay')) return null;
        const modal = document.createElement('div'); modal.className = 'overlay scanner-overlay sale-scanner-overlay';
        modal.innerHTML = `<section class="modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="sale-scanner-title"><button type="button" class="close" aria-label="Fermer">×</button><h3 id="sale-scanner-title">Scanner la vente</h3><p>Présentez le code-barres du reçu ou de la facture devant la caméra, ou scannez-le avec le lecteur branché.</p><label>Numéro de facture<input data-sale-scan-code type="text" autocomplete="off" maxlength="60" placeholder="Scannez ici ou saisissez FAC-… puis Entrée"></label><video data-sale-scanner-video playsinline muted hidden></video><button class="btn" type="button" data-sale-start-camera>Activer la caméra</button><p class="notification-empty" data-sale-scanner-status role="status" aria-live="polite">Lecteur de code-barres prêt. La caméra nécessite l’autorisation du navigateur.</p></section>`;
        document.body.append(modal);
        const input = modal.querySelector('[data-sale-scan-code]'), status = modal.querySelector('[data-sale-scanner-status]'), video = modal.querySelector('[data-sale-scanner-video]'), cameraButton = modal.querySelector('[data-sale-start-camera]');
        let reader = null, controls = null, generation = 0, busy = false, closed = false;
        const stopCamera = () => {
            generation += 1;
            const currentControls = controls, currentReader = reader;
            controls = null; reader = null;
            video.srcObject?.getTracks?.().forEach(track => track.stop());
            video.srcObject = null; video.hidden = true;
            try { currentControls?.stop(); } catch (error) { console.error('Impossible d’arrêter la caméra.', error); }
            try { currentReader?.reset?.(); } catch (error) { console.error('Impossible de réinitialiser le lecteur.', error); }
            if (!closed) cameraButton.disabled = false;
        };
        const close = () => {
            if (closed) return;
            closed = true; stopCamera(); observer.disconnect(); modal.remove();
        };
        const submit = async raw => {
            if (busy || closed) return;
            const code = normalizeInvoiceCode(raw);
            if (!code) { status.textContent = 'Code non reconnu : scannez le code-barres d’un reçu ou d’une facture (FAC-…).'; input.select(); return; }
            busy = true; stopCamera(); input.value = code; status.textContent = `Recherche de la facture ${code}…`;
            try { await onCode(code); close(); }
            catch (error) { if (!closed) { status.textContent = error.message || 'Facture introuvable.'; input.focus(); input.select(); } }
            finally { busy = false; }
        };
        const observer = new MutationObserver(() => { if (!root.isConnected || !modal.isConnected) close(); });
        observer.observe(document.body, { childList: true, subtree: true });
        modal.querySelector('.close').onclick = close;
        modal.addEventListener('click', event => { if (event.target === modal) close(); });
        modal.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); submit(input.value); } };
        cameraButton.onclick = async () => {
            const current = ++generation, ZXing = window.ZXingBrowser;
            if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { status.textContent = 'La caméra nécessite HTTPS et un navigateur compatible. Utilisez le lecteur de code-barres.'; input.focus(); return; }
            if (!ZXing?.BrowserMultiFormatReader) { status.textContent = 'Le module de lecture caméra est indisponible. Rechargez la page ou utilisez le lecteur de code-barres.'; input.focus(); return; }
            cameraButton.disabled = true; status.textContent = 'Demande d’accès à la caméra…';
            try {
                const instance = new ZXing.BrowserMultiFormatReader(); reader = instance; video.hidden = false;
                const started = await instance.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, result => {
                    if (result && !closed && !busy && current === generation) submit(result.getText());
                });
                if (closed || current !== generation) { started.stop(); instance.reset?.(); return; }
                controls = started; status.textContent = 'Caméra active. Présentez le code-barres du reçu devant l’objectif.';
            } catch (error) {
                if (closed || current !== generation) return;
                const message = error.name === 'NotAllowedError' ? 'Accès à la caméra refusé. Autorisez-le dans le navigateur ou utilisez le lecteur de code-barres.' : error.name === 'NotFoundError' ? 'Aucune caméra détectée. Utilisez le lecteur de code-barres.' : `Caméra indisponible : ${error.message}`;
                stopCamera(); status.textContent = message; input.focus();
            }
        };
        input.focus();
        return { close, submit };
    }
    async function cashRegister(root, pendingPage = 0) {
        try {
            const data = await api('/api/cash'), session = data.current_session;
            const pending = state.modules === null || state.modules.includes('sales') ? await api(`/api/sales/pending?offset=${pendingPage * 100}`) : [];
            root.innerHTML = `${session ? `<div class="stats cash-stats"><article><small>Fond de caisse</small><b>${formatMoney(session.opening_cash)}</b></article><article><small>Espèces attendues</small><b>${formatMoney(data.summary.expected_cash)}</b></article><article><small>Session ouverte depuis</small><b>${esc(new Date(session.opened_at).toLocaleTimeString('fr-FR'))}</b></article><article><small>État</small><b>Ouverte</b></article></div>` : `<div class="panel"><div class="panel-head"><div><h3>Aucune session ouverte</h3><p>Ouvrez une session avec le fond de caisse compté avant d’encaisser.</p></div><button class="btn" type="button" data-open-cash>＋ Ouvrir la caisse</button></div></div>`}<div class="settings-page"><div class="settings-tabs" role="tablist" aria-label="Sections des recettes et de la caisse"><button type="button" class="settings-tab active" role="tab" aria-selected="true" aria-controls="cash-panel-summary" id="cash-tab-summary" data-cash-tab="summary">Recettes & caisse</button><button type="button" class="settings-tab" role="tab" aria-selected="false" aria-controls="cash-panel-sessions" id="cash-tab-sessions" data-cash-tab="sessions">Sessions récentes</button><button type="button" class="settings-tab" role="tab" aria-selected="false" aria-controls="cash-panel-movements" id="cash-tab-movements" data-cash-tab="movements">Mouvements récents</button></div><section class="panel" role="tabpanel" id="cash-panel-summary" aria-labelledby="cash-tab-summary"><div class="panel-head"><div><h3>Recettes & caisse</h3><p>Recettes, ventes, dépenses, remboursements et rapprochement par mode.</p></div>${session ? '<div><button class="table-action" type="button" data-cash-entry="income">＋ Recette</button><button class="table-action" type="button" data-cash-entry="expense">− Dépense</button><button class="btn" type="button" data-close-cash>Clôturer la session</button></div>' : ''}</div>${session ? `<div class="cash-methods">${data.summary.by_method.map(row => `<div class="row"><span>${esc(paymentLabels[row.payment_method] || row.payment_method)}<small>${esc(row.inflow_count)} entrée(s) · ${esc(row.outflow_count)} sortie(s)</small></span><strong>${formatMoney(row.net_amount)}</strong></div>`).join('') || '<p class="notification-empty">Aucun mouvement enregistré dans cette session.</p>'}</div>` : ''}</section><section class="panel" role="tabpanel" id="cash-panel-sessions" aria-labelledby="cash-tab-sessions" hidden><div class="panel-head"><div><h3>Sessions récentes</h3><p>Historique des ouvertures, clôtures et écarts de caisse.</p></div></div><div data-cash-sessions></div></section><section class="panel" role="tabpanel" id="cash-panel-movements" aria-labelledby="cash-tab-movements" hidden><div class="panel-head"><div><h3>Mouvements récents</h3><p>Historique des recettes, ventes, dépenses et remboursements.</p></div></div><p class="notification-empty">Les écritures sont immuables pour assurer la traçabilité.</p><div data-cash-movements></div></section></div>`;
            const pendingPanel = document.createElement('section');
            pendingPanel.className = 'panel';
            pendingPanel.innerHTML = `<div class="panel-head"><div><h3>Ventes à encaisser</h3><p>Ventes préparées par un autre utilisateur ; les paiements partiels restent visibles jusqu’au règlement du solde.</p></div></div><div data-pending-sales></div><div class="table-footer"><button class="table-action" type="button" data-pending-prev ${pendingPage === 0 ? 'disabled' : ''}>Précédent</button><span>Page ${pendingPage + 1}</span><button class="table-action" type="button" data-pending-next ${pending.length <= 100 ? 'disabled' : ''}>Suivant</button></div>`;
            root.prepend(pendingPanel);
            if (state.modules === null || state.modules.includes('sales')) {
                const openInvoice = async rawNumber => {
                    const number = normalizeInvoiceCode(rawNumber);
                    if (!number) throw new Error('Code non reconnu : scannez le code-barres d’un reçu ou d’une facture (FAC-…).');
                    const found = await api(`/api/sales/by-number/${encodeURIComponent(number)}`);
                    const invoice = await api(`/api/sales/${encodeURIComponent(found.id)}`);
                    const balance = Math.max(0, Number(invoice.total_amount) - Number(invoice.returned_value) - Number(invoice.paid_amount) + Number(invoice.refunded_amount));
                    const collectable = session && balance > 0 && !['cancelled', 'returned'].includes(invoice.status) && (!invoice.separate_cashier || (window.RedamsAccess.canCollect(state.profile, { separate_sale_payment: 1 }) && Number(invoice.created_by) !== state.userId));
                    if (collectable) await paymentForm(root, invoice, balance, pendingPage);
                    else await saleReceipt(root, found.id);
                };
                const head = pendingPanel.querySelector('.panel-head');
                const scanButton = document.createElement('button');
                scanButton.type = 'button'; scanButton.className = 'btn'; scanButton.dataset.scanSale = ''; scanButton.textContent = '▦ Scanner la vente';
                head.append(scanButton);
                scanButton.onclick = () => openSaleScanner(root, openInvoice);
                const scanForm = document.createElement('form');
                scanForm.innerHTML = `<label>Scanner ou saisir le numéro de facture<input name="invoice_number" autocomplete="off" placeholder="FAC-…" required maxlength="33"></label><button class="table-action">Ouvrir la facture</button><p class="error" role="alert"></p>`;
                pendingPanel.querySelector('[data-pending-sales]').before(scanForm);
                scanForm.onsubmit = async event => {
                    event.preventDefault();
                    const error = scanForm.querySelector('.error'), button = scanForm.querySelector('button');
                    error.textContent = ''; button.disabled = true;
                    try { await openInvoice(scanForm.elements.invoice_number.value); }
                    catch (reason) { error.textContent = reason.message; }
                    finally { button.disabled = false; }
                };
            }
            mountDataTable(pendingPanel.querySelector('[data-pending-sales]'), {
                rows: pending.slice(0, 100).map(item => ({ ...item, searchText: [item.invoice_number, item.patient_name, item.seller_name, item.status, ...(Array.isArray(item.items) ? item.items.map(product => product.product_name) : [])].join(' ') })),
                searchText: 'Rechercher par facture, client ou vendeur…',
                columns: [
                    { label: 'Facture', render: item => `<b>${esc(item.invoice_number)}</b><small>${esc(new Date(item.created_at).toLocaleString('fr-FR'))}</small>` },
                    { label: 'Produits à encaisser', render: item => (Array.isArray(item.items) ? item.items : []).map(product => `<div>${esc(product.product_name)}<small>${esc(Number(product.quantity).toLocaleString('fr-FR'))} ${esc(product.unit)}</small></div>`).join('') || '—' },
                    { label: 'Client', render: item => esc(item.patient_name || 'Client non enregistré') },
                    { label: 'Vendeur', render: item => esc(item.seller_name) },
                    { label: 'Statut', render: item => esc(invoiceStatusLabels[item.status] || item.status) },
                    { label: 'Solde', render: item => formatMoney(Number(item.total_amount) - Number(item.returned_value) - Number(item.paid_amount) + Number(item.refunded_amount)) },
                    { label: 'Action', render: item => `<button class="table-action" type="button" data-collect="${esc(item.id)}" ${session ? '' : 'disabled title="Ouvrez une caisse"'}>Encaisser</button>` }
                ]
            });
            pendingPanel.querySelector('[data-pending-prev]').onclick = () => cashRegister(root, pendingPage - 1);
            pendingPanel.querySelector('[data-pending-next]').onclick = () => cashRegister(root, pendingPage + 1);
            pendingPanel.onclick = async event => {
                const button = event.target.closest('[data-collect]');
                if (!button) return;
                button.disabled = true;
                try {
                    const invoice = await api(`/api/sales/${encodeURIComponent(button.dataset.collect)}`);
                    const returned = Number(invoice.returned_value);
                    const balance = Math.max(0, Number(invoice.total_amount) - returned - Number(invoice.paid_amount || 0) + Number(invoice.refunded_amount || 0));
                    if (balance <= 0 || ['cancelled', 'returned'].includes(invoice.status)) { await cashRegister(root, pendingPage); toast('Cette vente n’a plus de solde à encaisser.', 'warning'); return; }
                    await paymentForm(root, invoice, balance, pendingPage);
                } catch (error) { toast(error.message, 'error'); }
                finally { button.disabled = false; }
            };
            root.querySelectorAll('[data-cash-tab]').forEach(button => button.addEventListener('click', () => {
                const selectedTab = button.dataset.cashTab;
                root.querySelectorAll('[data-cash-tab]').forEach(tab => { const selected = tab === button; tab.classList.toggle('active', selected); tab.setAttribute('aria-selected', String(selected)); });
                root.querySelector('#cash-panel-summary').hidden = selectedTab !== 'summary';
                root.querySelector('#cash-panel-sessions').hidden = selectedTab !== 'sessions';
                root.querySelector('#cash-panel-movements').hidden = selectedTab !== 'movements';
            }));
            root.querySelector('[data-open-cash]')?.addEventListener('click', () => cashSessionForm(root));
            root.querySelector('[data-close-cash]')?.addEventListener('click', () => cashCloseForm(root, session, data.summary.expected_cash));
            root.querySelectorAll('[data-cash-entry]').forEach(button => button.onclick = () => cashMovementForm(root, button.dataset.cashEntry));
            mountDataTable(root.querySelector('[data-cash-sessions]'), {
                rows: data.sessions.map(item => ({ ...item, searchText: [item.status, item.opened_at, item.closed_at].join(' ') })), searchText: 'Rechercher par état ou date de session…', columns: [
                    { label: 'Ouverture', sortValue: item => item.opened_at, render: item => esc(new Date(item.opened_at).toLocaleString('fr-FR')) },
                    { label: 'État', sortValue: item => item.status, render: item => item.status === 'open' ? '<span class="tag">Ouverte</span>' : 'Clôturée' },
                    { label: 'Fond', sortValue: item => Number(item.opening_cash), render: item => formatMoney(item.opening_cash) },
                    { label: 'Attendu / compté', sortValue: item => Number(item.expected_cash || 0), render: item => item.status === 'closed' ? `${formatMoney(item.expected_cash)} / ${formatMoney(item.closing_cash)}` : 'En cours' },
                    { label: 'Écart', sortValue: item => Number(item.variance || 0), render: item => item.status === 'closed' ? formatMoney(item.variance) : '—' }
                ]
            });
            mountDataTable(root.querySelector('[data-cash-movements]'), {
                rows: data.movements.map(item => ({ ...item, searchText: [item.description, item.movement_type, item.payment_method, item.user_name, item.invoice_id].join(' ') })), searchText: 'Rechercher par motif, type, mode ou utilisateur…', filters: [{ label: 'Type', options: [...new Set(data.movements.map(item => item.movement_type))].map(type => ({ value: type, label: cashMovementLabels[type] || type })), value: item => item.movement_type }, { label: 'Mode', options: [...new Set(data.movements.map(item => item.payment_method))].map(method => ({ value: method, label: paymentLabels[method] || method })), value: item => item.payment_method }], columns: [
                    { label: 'Date', sortValue: item => item.created_at, render: item => esc(new Date(item.created_at).toLocaleString('fr-FR')) },
                    { label: 'Opération', sortValue: item => cashMovementLabels[item.movement_type] || item.movement_type, render: item => `<b>${esc(cashMovementLabels[item.movement_type] || item.movement_type)}</b><small>${esc(item.description)}</small>` },
                    { label: 'Mode', sortValue: item => paymentLabels[item.payment_method], render: item => esc(paymentLabels[item.payment_method] || item.payment_method) },
                    { label: 'Montant', sortValue: item => Number(item.amount), render: item => `${['expense', 'refund'].includes(item.movement_type) ? '− ' : ''}${formatMoney(item.amount)}` },
                    { label: 'Enregistré par', sortValue: item => item.user_name, render: item => esc(item.user_name) }
                ]
            });
        } catch (error) { root.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
    }
    const cashMovementLabels = { sale: 'Vente', income: 'Recette diverse', expense: 'Dépense', refund: 'Remboursement' };
    function cashSessionForm(root) {
        const modal = document.createElement('div'); modal.className = 'overlay'; modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Ouvrir une session de caisse</h3><label>Fond de caisse initial<input name="opening_cash" type="number" min="0" step="0.01" value="0" required></label><p class="error" role="alert"></p><button class="btn">Ouvrir la session</button></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove();
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api('/api/cash/sessions', { method: 'POST', body: JSON.stringify({ opening_cash: form.elements.opening_cash.value }) }); modal.remove(); toast('Session de caisse ouverte.'); await cashRegister(root); } catch (reason) { error.textContent = reason.message; } };
    }
    function cashCloseForm(root, session, expected) {
        const modal = document.createElement('div'); modal.className = 'overlay'; modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>Clôturer la session</h3><p>Espèces attendues : <b>${formatMoney(expected)}</b></p><label>Espèces réellement comptées<input name="closing_cash" type="number" min="0" step="0.01" required></label><p class="notification-empty">L’écart sera enregistré. Cette clôture est définitive.</p><p class="error" role="alert"></p><button class="btn">Clôturer et enregistrer l’écart</button></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove();
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { const result = await api(`/api/cash/sessions/${encodeURIComponent(session.id)}/close`, { method: 'POST', body: JSON.stringify({ closing_cash: form.elements.closing_cash.value }) }); modal.remove(); toast(`Caisse clôturée · écart ${formatMoney(result.variance)}.`); await cashRegister(root); } catch (reason) { error.textContent = reason.message; } };
    }
    function cashMovementForm(root, type) {
        const modal = document.createElement('div'); modal.className = 'overlay'; modal.innerHTML = `<form class="modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${type === 'income' ? 'Enregistrer une recette' : 'Enregistrer une dépense'}</h3><label>Libellé / motif<input name="description" maxlength="255" required minlength="3"></label><label>Mode<select name="payment_method">${Object.entries(paymentLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Montant<input name="amount" type="number" min="0.01" step="0.01" required></label><p class="notification-empty">Ces écritures sont distinctes des encaissements et remboursements de ventes.</p><p class="error" role="alert"></p><button class="btn">Enregistrer</button></form>`;
        document.body.append(modal); const form = modal.querySelector('form'); modal.querySelector('.close').onclick = () => modal.remove();
        form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; const body = { movement_type: type, payment_method: form.elements.payment_method.value, amount: form.elements.amount.value, description: form.elements.description.value }; try { await api('/api/cash/movements', { method: 'POST', body: JSON.stringify(body) }); modal.remove(); toast(type === 'income' ? 'Recette enregistrée.' : 'Dépense enregistrée.'); await cashRegister(root); } catch (reason) { error.textContent = reason.message; } };
    }
    async function settings(root, activeTab = 'general') {
        const tabs = [['general', 'Généraux & identité'], ['workflow', 'Circuit de vente'], ['roles', 'Fusion des rôles'], ['tax', 'Fiscalité & reçus'], ['patients', 'Dossiers patients'], ['backup', 'Sauvegarde & restauration'], ['security', 'Sécurité & mot de passe'], ['codes', 'QR & codes-barres'], ['search', 'Index de recherche'], ...(state.legalSettings?.show_authenticated_links ? [['legal-documents', 'Documents légaux']] : [])].filter(([id]) => state.canAdminister || id === 'security' || id === 'legal-documents');
        if (!tabs.some(([id]) => id === activeTab)) activeTab = 'general';
        if (!state.canAdminister && activeTab !== 'security' && activeTab !== 'legal-documents') { root.innerHTML = '<div class="panel"><h3>Accès réservé</h3><p class="error" role="alert">Les paramètres de l’établissement sont réservés aux propriétaires et administrateurs.</p></div>'; return; }
        root.innerHTML = `<div class="settings-page"><div class="settings-tabs" role="tablist" aria-label="Sections des paramètres">${tabs.map(([id, label]) => `<button type="button" class="settings-tab${activeTab === id ? ' active' : ''}" role="tab" aria-selected="${activeTab === id}" data-settings-tab="${id}">${label}</button>`).join('')}</div><div id="settings-panel" role="tabpanel"></div></div>`;
        const panel = $('#settings-panel');
        root.querySelectorAll('[data-settings-tab]').forEach(button => button.addEventListener('click', () => { settings(root, button.dataset.settingsTab); location.hash = button.dataset.settingsTab === 'general' ? 'settings' : `settings/${button.dataset.settingsTab}`; }));
        if (activeTab === 'general') {
            try {
                const s = await api('/api/settings'); if (!panel.isConnected) return;
                const savedLogoUrl = safeLogoUrl(s.logo_url);
                panel.innerHTML = `<section class="panel settings company-settings"><small>IDENTITÉ DE L’ÉTABLISSEMENT</small><h3>Informations de l’entreprise</h3><form id="company-settings"><div class="two"><label>Nom de l’entreprise<input name="name" maxlength="180" value="${esc(s.company_name || '')}" required></label><label>Téléphone<input name="phone" maxlength="50" type="tel" value="${esc(s.company_phone || '')}"></label></div><div class="two"><label>Adresse e-mail<input name="email" maxlength="190" type="email" value="${esc(s.company_email || '')}"></label><label>Slogan<input name="slogan" maxlength="255" value="${esc(s.company_slogan || '')}"></label></div><label>Adresse<textarea name="address" rows="3" maxlength="65535">${esc(s.company_address || '')}</textarea></label><p class="error" role="alert"></p><button class="btn">Enregistrer les informations</button></form></section><div class="branding-grid"><section class="panel logo-card"><div><small>LOGO DE L’ÉTABLISSEMENT</small><h3>Logo</h3><p>Choisissez une image PNG, JPEG, GIF ou WebP de 2 Mo maximum.</p></div><div class="logo-preview-card" data-logo-preview>${savedLogoUrl ? `<img src="${esc(savedLogoUrl)}" alt="Logo enregistré">` : '<span>Aucun logo enregistré</span>'}</div><form id="logo-upload"><label class="logo-file-label">Fichier du logo<input name="logo_file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required></label><p class="error" role="alert"></p><button class="btn">Enregistrer le logo</button></form></section><section class="panel settings"><small>PERSONNALISATION</small><h3>Affichage & préférences</h3><form id="settings"><label>Nom affiché dans l’application<input name="display_name" value="${esc(s.display_name || '')}"></label><div class="two"><label>Couleur principale<input name="primary_color" type="color" value="${s.primary_color || '#145C4B'}"></label><label>Couleur secondaire<input name="secondary_color" type="color" value="${s.secondary_color || '#D7A84B'}"></label></div><div class="two"><label>Langue<select name="locale"><option value="fr" ${s.locale === 'fr' ? 'selected' : ''}>Français</option><option value="en" ${s.locale === 'en' ? 'selected' : ''}>English</option></select></label><label>Devise<input name="currency" maxlength="3" value="${esc(s.currency || 'XAF')}"></label></div><div class="two"><label>Fuseau horaire<input name="timezone" value="${esc(s.timezone || 'Africa/Douala')}"></label><label>Format de date<input name="date_format" value="${esc(s.date_format || 'DD/MM/YYYY')}"></label></div><button class="btn">Enregistrer</button><p class="error" role="alert"></p></form></section></div>`;
                const companyForm = $('#company-settings');
                companyForm.onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, error = form.querySelector('.error'); error.textContent = '';
                    try {
                        const company = Object.fromEntries(new FormData(form));
                        await api('/api/settings/company', { method: 'PUT', body: JSON.stringify(company) });
                        state.settings = { ...state.settings, company_name: company.name, company_address: company.address, company_phone: company.phone, company_slogan: company.slogan, company_email: company.email };
                        $('#tenant').textContent = company.name; toast('Informations de l’entreprise enregistrées.');
                    } catch (reason) { error.textContent = reason.message; }
                };
                const logoForm = $('#logo-upload'), logoFile = logoForm.elements.logo_file, logoPreview = panel.querySelector('[data-logo-preview]');
                let previewObjectUrl = '';
                logoFile.onchange = () => {
                    const file = logoFile.files[0]; if (!file) return;
                    if (file.size > 2 * 1024 * 1024) { logoFile.value = ''; logoForm.querySelector('.error').textContent = 'Le logo doit peser au maximum 2 Mo.'; return; }
                    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) { logoFile.value = ''; logoForm.querySelector('.error').textContent = 'Choisissez une image PNG, JPEG, GIF ou WebP.'; return; }
                    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
                    previewObjectUrl = URL.createObjectURL(file);
                    const image = document.createElement('img'); image.alt = 'Aperçu du logo à enregistrer'; image.src = previewObjectUrl; logoPreview.replaceChildren(image);
                };
                logoForm.onsubmit = async event => {
                    event.preventDefault(); const form = event.currentTarget, error = form.querySelector('.error'), file = logoFile.files[0]; error.textContent = '';
                    if (!file) { error.textContent = 'Choisissez un fichier logo.'; return; }
                    try {
                        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(Error('Lecture du logo impossible.')); reader.onerror = () => reject(Error('Lecture du logo impossible.')); reader.readAsDataURL(file); });
                        const result = await api('/api/settings/logo', { method: 'POST', body: JSON.stringify({ data_url: dataUrl }) });
                        state.settings = { ...state.settings, logo_url: result.logo_url }; updateTenantLogo(result.logo_url);
                        const image = document.createElement('img'); image.src = safeLogoUrl(result.logo_url); image.alt = 'Logo enregistré'; logoPreview.replaceChildren(image);
                        if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = ''; }
                        logoFile.value = ''; toast(result.message);
                    } catch (reason) { error.textContent = reason.message; }
                };
                $('#settings').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget, d = Object.fromEntries(new FormData(form)), error = form.querySelector('.error'); error.textContent = ''; try { await api('/api/settings', { method: 'PUT', body: JSON.stringify(d) }); state.settings = { ...state.settings, ...d }; if (d.primary_color) document.documentElement.style.setProperty('--primary', d.primary_color); if (d.secondary_color) document.documentElement.style.setProperty('--accent', d.secondary_color); toast('Paramètres enregistrés.'); } catch (reason) { error.textContent = reason.message; } };
            } catch (e) { if (panel.isConnected) panel.innerHTML = `<div class="panel"><p class="error">${esc(e.message)}</p></div>`; }
            return;
        }
        if (activeTab === 'legal-documents') {
            if (!state.legalSettings?.show_authenticated_links) {
                panel.innerHTML = '<section class="panel"><h3>Documents légaux</h3><p>La consultation des documents dans l’espace connecté est désactivée par l’administrateur de la plateforme.</p></section>';
                return;
            }
            panel.innerHTML = `<section class="panel settings"><small>DOCUMENTS DE LA PLATEFORME</small><h3>Documents légaux</h3><p>Consultez les documents applicables au service REDAMS-STK.</p><ul>${state.legalSettings.documents.map(document => `<li><a href="${esc(document.route)}" target="_blank" rel="noopener">${esc(document.title)}</a></li>`).join('')}</ul></section>`;
            return;
        }
        if (activeTab === 'patients') {
            try {
                const s = await api('/api/settings'); if (!panel.isConnected) return;
                panel.innerHTML = `<section class="panel settings"><small>DOSSIERS PATIENTS</small><h3>Code patient</h3><form id="patient-code-settings"><div class="two"><label>Mode de saisie<select name="patient_code_mode"><option value="manual" ${s.patient_code_mode !== 'auto' ? 'selected' : ''}>Manuel</option><option value="auto" ${s.patient_code_mode === 'auto' ? 'selected' : ''}>Automatique</option></select></label><label>Format<input name="patient_code_format" maxlength="60" required value="${esc(s.patient_code_format || 'PAT-{SEQ:5}')}"></label></div><p class="notification-empty">Variables : {YYYY} année, {YY} année sur 2 chiffres, {MM} mois, {DD} jour, {SEQ:n} compteur sur n chiffres (obligatoire, une seule fois). Exemple : PAT-{YY}-{SEQ:4} → PAT-26-0001. En mode automatique, le code est généré à la création du patient.</p><button class="btn">Enregistrer</button><p class="error" role="alert"></p></form></section>`;
                $('#patient-code-settings').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget, d = Object.fromEntries(new FormData(form)), error = form.querySelector('.error'); error.textContent = ''; try { await api('/api/settings', { method: 'PUT', body: JSON.stringify(d) }); state.settings = { ...state.settings, ...d }; toast('Configuration du code patient enregistrée.'); } catch (reason) { error.textContent = reason.message; } };
            } catch (e) { if (panel.isConnected) panel.innerHTML = `<div class="panel"><p class="error">${esc(e.message)}</p></div>`; }
            return;
        }
        if (activeTab === 'tax') {
            try {
                const s = await api('/api/settings'); if (!panel.isConnected) return;
                panel.innerHTML = `<div class="panel settings"><small>PARAMÈTRES DES VENTES</small><h3>Fiscalité & reçus</h3><p>Le prix catalogue est hors taxe. Ce taux est appliqué aux nouvelles ventes et figé sur chaque reçu émis.</p><form id="sales-tax-settings"><label>Taux de taxe (%)<input name="sales_tax_rate" type="number" min="0" max="100" step="0.01" value="${esc(s.sales_tax_rate ?? 0)}" required></label><button class="btn">Enregistrer le taux</button><p class="error" role="alert"></p></form></div>`;
                $('#sales-tax-settings').onsubmit = async event => { event.preventDefault(); const form = event.currentTarget, error = form.querySelector('.error'); error.textContent = ''; try { await api('/api/settings', { method: 'PUT', body: JSON.stringify({ sales_tax_rate: form.elements.sales_tax_rate.value }) }); state.settings = { ...state.settings, sales_tax_rate: form.elements.sales_tax_rate.value }; toast('Taux de taxe enregistré.'); } catch (reason) { error.textContent = reason.message; } };
            } catch (error) { if (panel.isConnected) panel.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
            return;
        }
        if (activeTab === 'roles') {
            try {
                const s = await api('/api/settings'); if (!panel.isConnected) return;
                panel.innerHTML = `<section class="panel settings"><h3>Fusion pharmacien / gestionnaire de stock</h3><p>Lorsqu’elle est activée, tous les pharmaciens et gestionnaires de stock partagent les droits des deux rôles, dans les limites du forfait. En deux temps, ces utilisateurs saisissent les ventes mais n’encaissent pas. Les rôles enregistrés ne changent pas : désactiver la fusion rétablit les droits d’origine.</p><form><label><input type="checkbox" name="merged" ${Number(s.merge_pharmacist_storekeeper) ? 'checked' : ''}> Fusionner les droits</label><button class="btn">Enregistrer</button><p class="error" role="alert"></p></form></section>`;
                panel.querySelector('form').onsubmit = async event => {
                    event.preventDefault();
                    const form = event.currentTarget, button = form.querySelector('button'), error = form.querySelector('.error');
                    button.disabled = true; error.textContent = '';
                    try {
                        const result = await api('/api/settings/role-merger', { method: 'PUT', body: JSON.stringify({ merge_pharmacist_storekeeper: form.elements.merged.checked }) });
                        state.settings.merge_pharmacist_storekeeper = result.merge_pharmacist_storekeeper;
                        refreshAccess(); toast(result.message);
                    } catch (reason) { error.textContent = reason.message; }
                    finally { button.disabled = false; }
                };
            } catch (error) { if (panel.isConnected) panel.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
            return;
        }
        if (activeTab === 'workflow') {
            try {
                const s = await api('/api/settings'); if (!panel.isConnected) return;
                const workflow = document.createElement('section');
                workflow.className = 'panel settings';
                workflow.innerHTML = `<h3>Circuit de vente</h3><p><b>Un temps :</b> le pharmacien ou le caissier saisit et encaisse la vente, avec une caisse ouverte.</p><p><b>Deux temps :</b> le pharmacien saisit sans paiement, puis dirige le client vers la caisse. Le caissier retrouve la facture dans « Ventes à encaisser » et enregistre le paiement. Les administrateurs gardent leurs accès, mais personne ne peut encaisser sa propre vente préparée.</p><p>Le stock est déduit à la saisie. Les ventes existantes conservent leur règle initiale. Les accès des rôles suivent le mode actuel.</p><form><label>Mode de vente<select name="mode"><option value="single" ${!Number(s.separate_sale_payment) ? 'selected' : ''}>Un temps : saisie et encaissement</option><option value="separate" ${Number(s.separate_sale_payment) ? 'selected' : ''}>Deux temps : pharmacien puis caisse</option></select></label><p class="error" role="alert"></p><button class="btn">Enregistrer le circuit</button></form>`;
                panel.append(workflow);
                workflow.querySelector('form').onsubmit = async event => {
                    event.preventDefault();
                    const form = event.currentTarget, error = form.querySelector('.error'), submit = form.querySelector('button');
                    submit.disabled = true; error.textContent = '';
                    try {
                        const result = await api('/api/settings/sale-workflow', { method: 'PUT', body: JSON.stringify({ separate_sale_payment: form.elements.mode.value === 'separate' }) });
                        state.settings.separate_sale_payment = result.separate_sale_payment;
                        refreshAccess();
                        toast(result.message);
                    } catch (reason) { error.textContent = reason.message; }
                    finally { submit.disabled = false; }
                };
            } catch (error) { if (panel.isConnected) panel.innerHTML = `<div class="panel"><p class="error">${esc(error.message)}</p></div>`; }
            return;
        }
        if (activeTab === 'backup') {
            panel.innerHTML = `<section class="panel"><small>PROTECTION DES DONNÉES</small><h3>Sauvegarde de l’établissement</h3><p>Le fichier comprend les données métier de cet établissement et les ordonnances enregistrées. Il ne contient pas les comptes utilisateurs, les abonnements ni les fichiers logo : conservez les comptes et sauvegardez séparément le dossier <code>public/uploads/logos</code>.</p><p class="accounting-warning">Attention : cette sauvegarde JSON ne contient ni le dossier ni les écritures comptables, ni les versions de révision. Prévoyez également une sauvegarde complète de la base, conservée et testée séparément.</p><div class="backup-actions"><button class="btn" type="button" data-backup-download>Télécharger une sauvegarde JSON</button><label class="backup-file-label">Fichier de sauvegarde à fusionner<input type="file" data-backup-file accept="application/json,.json"></label><button class="table-action" type="button" data-backup-restore disabled>Fusionner la sauvegarde</button></div><p class="notification-empty">La restauration ajoute uniquement les enregistrements manquants de ce même établissement. Les données existantes et les paramètres de l’entreprise ne sont jamais remplacés. En cas de conflit, toute l’opération est annulée. Les sauvegardes contiennent des données personnelles : stockez-les en lieu sûr.</p><p class="error" data-backup-error role="alert"></p></section>`;
            const downloadButton = panel.querySelector('[data-backup-download]');
            const fileInput = panel.querySelector('[data-backup-file]');
            const restoreButton = panel.querySelector('[data-backup-restore]');
            const error = panel.querySelector('[data-backup-error]');
            let backupFile = null;
            downloadButton.onclick = async () => {
                error.textContent = ''; downloadButton.disabled = true; downloadButton.textContent = 'Préparation…';
                try {
                    const backup = await api('/api/settings/backup');
                    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                    const link = document.createElement('a'), objectUrl = URL.createObjectURL(blob);
                    link.href = objectUrl; link.download = `redams-backup-${backup.organization_id}-${backup.created_at.slice(0, 10)}.json`;
                    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl); toast('Sauvegarde téléchargée.');
                } catch (reason) { error.textContent = reason.message; }
                finally { downloadButton.disabled = false; downloadButton.textContent = 'Télécharger une sauvegarde JSON'; }
            };
            fileInput.onchange = () => {
                backupFile = fileInput.files[0] || null; error.textContent = '';
                if (backupFile && backupFile.size > 25 * 1024 * 1024) { backupFile = null; fileInput.value = ''; error.textContent = 'Le fichier de sauvegarde dépasse la limite de 25 Mo.'; }
                restoreButton.disabled = !backupFile;
            };
            restoreButton.onclick = async () => {
                if (!backupFile || !window.confirm('La sauvegarde sera fusionnée avec les données actuelles. Les éléments existants ne seront pas remplacés. Continuer ?')) return;
                error.textContent = ''; restoreButton.disabled = true; restoreButton.textContent = 'Fusion…';
                try {
                    const backup = JSON.parse(await backupFile.text());
                    const result = await api('/api/settings/backup', { method: 'POST', body: JSON.stringify(backup) });
                    toast(`${result.message} ${result.inserted} ajouté(s), ${result.already_present} déjà présent(s).`);
                    fileInput.value = ''; backupFile = null;
                } catch (reason) { error.textContent = reason instanceof SyntaxError ? 'Le fichier sélectionné ne contient pas un JSON valide.' : reason.message; }
                finally { restoreButton.disabled = !backupFile; restoreButton.textContent = 'Fusionner la sauvegarde'; }
            };
            return;
        }
        if (activeTab === 'security') {
            panel.innerHTML = `<section class="panel settings"><small>SÉCURITÉ DU COMPTE</small><h3>Changer mon mot de passe</h3><p>Le mot de passe actuel est vérifié. Après le changement, toutes les sessions de ce compte devront se reconnecter.</p><form id="own-password-form"><label>Mot de passe actuel<input name="current_password" type="password" autocomplete="current-password" required></label><div class="two"><label>Nouveau mot de passe (12 caractères minimum)<input name="new_password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><label>Confirmer le nouveau mot de passe<input name="confirm_password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label></div><p class="error" role="alert"></p><button class="btn">Changer mon mot de passe</button></form></section>${state.canAdminister ? `<section class="panel settings"><small>GESTION DES COMPTES</small><h3>Réinitialiser le mot de passe d’un membre</h3><p>Cette action est réservée aux administrateurs et propriétaires; le membre devra se reconnecter.</p><form id="member-password-form"><label>Membre<select name="user_id" required><option value="">Chargement des comptes…</option></select></label><label>Nouveau mot de passe temporaire (12 caractères minimum)<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><p class="error" role="alert"></p><button class="btn">Réinitialiser le mot de passe</button></form></section>` : ''}`;
            const ownForm = panel.querySelector('#own-password-form');
            ownForm.onsubmit = async event => {
                event.preventDefault(); const form = event.currentTarget, error = form.querySelector('.error'); error.textContent = '';
                if (form.elements.new_password.value !== form.elements.confirm_password.value) { error.textContent = 'La confirmation ne correspond pas au nouveau mot de passe.'; return; }
                try {
                    await api('/api/auth/password', { method: 'PUT', body: JSON.stringify({ current_password: form.elements.current_password.value, new_password: form.elements.new_password.value }) });
                    toast('Mot de passe modifié. Reconnectez-vous.'); sessionStorage.removeItem('redams_token'); setTimeout(() => location.replace('/'), 900);
                } catch (reason) { error.textContent = reason.message; }
            };
            if (state.canAdminister) {
                const form = panel.querySelector('#member-password-form'), select = form.elements.user_id;
                try {
                    const data = await api('/api/admin/users');
                    if (!panel.isConnected) return;
                    const members = data.users.filter(user => Number(user.id) !== state.userId);
                    select.innerHTML = members.length ? `<option value="">Choisir un membre</option>${members.map(user => `<option value="${esc(user.id)}">${esc(user.full_name)} · ${esc(user.email)}</option>`).join('')}` : '<option value="">Aucun autre membre</option>';
                    form.onsubmit = async event => {
                        event.preventDefault(); const error = form.querySelector('.error'); error.textContent = '';
                        try {
                            const result = await api(`/api/admin/users/${encodeURIComponent(select.value)}`, { method: 'PATCH', body: JSON.stringify({ password: form.elements.password.value }) });
                            form.reset(); toast(result.message);
                        } catch (reason) { error.textContent = reason.message; }
                    };
                } catch (reason) { form.querySelector('.error').textContent = reason.message; }
            }
            return;
        }
        if (activeTab === 'codes') {
            try {
                const s = await api('/api/settings'); if (!panel.isConnected) return;
                panel.innerHTML = `<section class="panel settings"><small>ÉTIQUETTES PRODUITS</small><h3>QR & codes-barres</h3><p>Le format QR utilise le standard QR Code. Les codes-barres utilisent Code 128. Choisissez le format présélectionné dans la fenêtre d’impression du catalogue.</p><form id="label-format-settings"><label>Format d’étiquette par défaut<select name="default_label_format"><option value="barcode"${(s.default_label_format || 'barcode') === 'barcode' ? ' selected' : ''}>Code-barres (Code 128)</option><option value="qr"${s.default_label_format === 'qr' ? ' selected' : ''}>QR code</option></select></label><p class="error" role="alert"></p><button class="btn">Enregistrer la préférence</button></form><p class="notification-empty">La préférence sera appliquée aux prochaines impressions. Le format reste modifiable à chaque génération, individuellement ou en lot.</p></section>`;
                const form = panel.querySelector('#label-format-settings');
                form.onsubmit = async event => {
                    event.preventDefault(); const error = form.querySelector('.error'); error.textContent = '';
                    try {
                        const value = form.elements.default_label_format.value;
                        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ default_label_format: value }) });
                        state.settings = { ...state.settings, default_label_format: value }; toast('Préférence d’étiquette enregistrée.');
                    } catch (reason) { error.textContent = reason.message; }
                };
            } catch (reason) { if (panel.isConnected) panel.innerHTML = `<div class="panel"><p class="error" role="alert">${esc(reason.message)}</p></div>`; }
            return;
        }
        if (activeTab === 'search') {
            panel.innerHTML = `<section class="panel"><small>MAINTENANCE DE LA RECHERCHE</small><h3>Index de recherche</h3><p>Vérifiez les index MySQL utilisés pour filtrer les produits, patients, fournisseurs, achats et ventes. L’analyse actualise les statistiques des tables partagées par tous les établissements; elle ne modifie pas les données.</p><div data-search-index-status><p class="notification-empty">Vérification des index…</p></div><p class="error" data-search-index-error role="alert"></p><button class="btn" type="button" data-analyze-indexes>Actualiser les statistiques</button></section>`;
            const status = panel.querySelector('[data-search-index-status]'), error = panel.querySelector('[data-search-index-error]'), analyzeButton = panel.querySelector('[data-analyze-indexes]');
            const loadIndexes = async () => {
                try {
                    const indexes = await api('/api/settings/search-index');
                    status.innerHTML = indexes.map(group => `<article class="index-status"><b>${esc(group.table)}</b><span>${group.indexes.filter(index => index.available).length} / ${group.indexes.length} index présents</span>${group.indexes.map(index => `<small>${esc(index.name)} · ${index.available ? 'Disponible' : 'Absent'}</small>`).join('')}</article>`).join('');
                } catch (reason) { error.textContent = reason.message; status.replaceChildren(); }
            };
            analyzeButton.onclick = async () => {
                error.textContent = ''; analyzeButton.disabled = true; analyzeButton.textContent = 'Analyse…';
                try { const result = await api('/api/settings/search-index/analyze', { method: 'POST', body: '{}' }); toast(result.message); await loadIndexes(); }
                catch (reason) { error.textContent = reason.message; }
                finally { analyzeButton.disabled = false; analyzeButton.textContent = 'Actualiser les statistiques'; }
            };
            await loadIndexes(); return;
        }
        panel.innerHTML = `<div class="panel"><p class="error">Cette section de paramètres est inconnue.</p></div>`;
    }
    function renderNotifications(rows, unreadCount, hasMore) { const list = $('#notifications-list'), badge = $('#notification-count'); badge.hidden = Number(unreadCount) === 0; badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount); list.innerHTML = rows.length ? rows.map(row => `<article class="notification-item${row.read_at ? '' : ' unread'}"><h4>${esc(row.title)}</h4><p>${esc(row.message)}</p><div class="notification-meta">${row.audience === 'organization' ? 'Générale' : 'Privée'} · ${esc(row.sender_name)} · ${new Date(row.created_at).toLocaleString('fr-FR')}</div>${row.read_at ? '' : `<button type="button" class="notification-read" data-notification-read="${esc(row.id)}">Marquer comme lue</button>`}</article>`).join('') : '<p class="notification-empty">Aucune notification reçue.</p>'; $('#notification-load-more').hidden = !hasMore; }
    let notificationWatermark = null, notificationContext = null, notificationAudioStarting = false, notificationSoundEnabled = true;
    const soundButton = document.createElement('button');
    soundButton.type = 'button'; soundButton.className = 'table-action';
    soundButton.textContent = 'Activer le son des notifications';
    $('#notifications-panel').prepend(soundButton);
    async function unlockNotificationSound() {
        if (!notificationSoundEnabled || notificationAudioStarting || !state.role || state.role === 'ACCOUNTANT') return;
        notificationAudioStarting = true;
        try {
            if (!window.AudioContext) throw Error('Les notifications sonores ne sont pas prises en charge par ce navigateur.');
            notificationContext ||= new window.AudioContext();
            if (notificationContext.state !== 'running') await notificationContext.resume();
            if (notificationContext.state !== 'running') throw Error('Le navigateur bloque le son. Cliquez sur « Activer le son des notifications ».');
            soundButton.textContent = 'Désactiver le son des notifications'; soundButton.setAttribute('aria-pressed', 'true');
        } catch (error) { notificationSoundEnabled = false; soundButton.textContent = 'Réessayer d’activer le son'; toast(error.message, 'warning'); }
        finally { notificationAudioStarting = false; }
    }
    soundButton.onclick = async () => {
        if (notificationSoundEnabled && notificationContext?.state === 'running') {
            notificationSoundEnabled = false; soundButton.textContent = 'Activer le son des notifications'; soundButton.setAttribute('aria-pressed', 'false');
        } else { notificationSoundEnabled = true; await unlockNotificationSound(); }
    };
    const startNotificationAudio = () => {
        if (!notificationContext && notificationSoundEnabled) unlockNotificationSound();
    };
    document.addEventListener('pointerdown', startNotificationAudio);
    document.addEventListener('keydown', startNotificationAudio);
    function signalNewNotifications(items) {
        const ids = items.map(item => BigInt(item.id));
        const latest = ids.reduce((maximum, id) => id > maximum ? id : maximum, notificationWatermark ?? 0n);
        const count = notificationWatermark === null ? 0 : ids.filter(id => id > notificationWatermark).length;
        notificationWatermark = latest;
        if (!count || !notificationSoundEnabled) return;
        if (!notificationContext || notificationContext.state !== 'running') {
            toast('Nouvelle notification reçue. Activez le son dans le panneau des notifications pour entendre le bip.', 'warning'); return;
        }
        try {
            for (let index = 0; index < count; index++) {
                const oscillator = notificationContext.createOscillator(), gain = notificationContext.createGain();
                const start = notificationContext.currentTime + index * 0.3;
                oscillator.frequency.value = 880;
                gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.15, start + 0.01); gain.gain.linearRampToValueAtTime(0, start + 0.18);
                oscillator.connect(gain); gain.connect(notificationContext.destination);
                oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
                oscillator.start(start); oscillator.stop(start + 0.2);
            }
        } catch (error) { toast(`Signal sonore impossible : ${error.message}`, 'warning'); }
    }
    async function refreshNotifications(reset = true) {
        if (state.notificationRequest) return state.notificationRequest;
        const offset = reset ? 0 : state.notificationsOffset;
        state.notificationRequest = (async () => {
            const result = await api(`/api/notifications?offset=${offset}`);
            if (reset) { signalNewNotifications(result.items); state.notifications = []; }
            state.notifications.push(...result.items); state.notificationsOffset = offset + result.items.length;
            renderNotifications(state.notifications, result.unreadCount, result.hasMore);
        })();
        try { await state.notificationRequest; }
        finally { state.notificationRequest = null; }
    }
    async function loadNotificationRecipients() { const recipients = await api('/api/notifications/recipients'); $('#notification-recipient-field select').innerHTML = recipients.map(user => `<option value="${esc(user.id)}">${esc(user.full_name)} · ${esc(user.email)}</option>`).join(''); }
    document.addEventListener('click', async e => { const a = e.target.closest('[data-page],[data-go]'); if (a) { e.preventDefault(); go(a.dataset.page || a.dataset.go); return; } const read = e.target.closest('[data-notification-read]'); if (read) { try { await api(`/api/notifications/${encodeURIComponent(read.dataset.notificationRead)}/read`, { method: 'POST' }); await refreshNotifications(); } catch (error) { toast(error.message); } return; } });
    $('#global-search-form').onsubmit = event => { event.preventDefault(); go('global-search', $('#global-search-input').value); };
    $('#notifications-button').onclick = async () => { const panel = $('#notifications-panel'), open = panel.hidden; panel.hidden = !open; $('#notifications-button').setAttribute('aria-expanded', String(open)); if (open) { try { await refreshNotifications(); if (state.canSendNotifications) await loadNotificationRecipients(); } catch (e) { $('#notifications-list').innerHTML = `<p class="notification-empty">${esc(e.message)}</p>`; } } };
    $('#notification-close').onclick = () => { $('#notifications-panel').hidden = true; $('#notifications-button').setAttribute('aria-expanded', 'false'); };
    $('#notification-compose').onclick = () => { $('#notification-form').hidden = !$('#notification-form').hidden; };
    $('#notification-form [name="audience"]').onchange = e => { $('#notification-recipient-field').hidden = e.target.value !== 'user'; };
    $('#notification-form').onsubmit = async e => { e.preventDefault(); const form = e.currentTarget, error = form.querySelector('.error'), data = Object.fromEntries(new FormData(form)); error.textContent = ''; try { await api('/api/notifications', { method: 'POST', body: JSON.stringify(data) }); form.reset(); $('#notification-recipient-field').hidden = true; form.hidden = true; toast('Notification envoyée.'); await refreshNotifications(); } catch (x) { error.textContent = x.message; } };
    $('#notification-load-more').onclick = async () => { try { await refreshNotifications(false); } catch (e) { toast(e.message); } };
    document.addEventListener('click', e => { if (!e.target.closest('.notification-wrap')) { $('#notifications-panel').hidden = true; $('#notifications-button').setAttribute('aria-expanded', 'false'); } });
    const logout = () => { sessionStorage.removeItem('redams_token'); location.href = '/'; };
    const alertIcons = { danger: '⛔', warning: '⚠️', info: 'ℹ️' };
    async function loadAlerts() {
        try {
            const data = await api('/api/alerts'), count = $('#alert-count');
            count.textContent = data.total > 99 ? '99+' : data.total; count.hidden = !data.total;
            const alerts = data.alerts.filter(item => canAccessPage(item.page));
            count.textContent = alerts.length > 99 ? '99+' : alerts.length; count.hidden = !alerts.length;
            $('#alerts-list').innerHTML = alerts.length ? alerts.map(item => `<button type="button" class="alert-item alert-${esc(item.severity)}" data-alert-page="${esc(item.page)}"><span aria-hidden="true">${alertIcons[item.severity] || 'ℹ️'}</span><span><b>${esc(item.title)}</b><small>${esc(item.message)}</small></span></button>`).join('') : '<p class="notification-empty">Aucune alerte pour le moment.</p>';
        } catch (error) { $('#alerts-list').innerHTML = `<p class="notification-empty">${esc(error.message)}</p>`; }
    }
    const setAlertsOpen = open => { $('#alerts-panel').hidden = !open; $('#alerts-button').setAttribute('aria-expanded', String(open)); if (open) { $('#notifications-panel').hidden = true; loadAlerts(); } };
    const setUserMenuOpen = open => { $('#user-dropdown').hidden = !open; $('#user-button').setAttribute('aria-expanded', String(open)); };
    function infoModal(title, body) {
        closeOpenModals();
        const overlay = document.createElement('div'); overlay.className = 'overlay';
        overlay.innerHTML = `<div class="modal info-modal"><button type="button" class="close" aria-label="Fermer">×</button><h3>${esc(title)}</h3>${body}</div>`;
        document.body.append(overlay); const close = () => overlay.remove();
        overlay.querySelector('.close').onclick = close; overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
        return overlay;
    }
    const fmtDate = value => value ? new Date(value).toLocaleDateString(window.i18n?.lang === 'en' ? 'en-GB' : 'fr-FR') : '—';
    function showProfile() {
        const user = state.profile || {};
        infoModal('Mon profil', `<dl class="profile-list"><dt>Nom</dt><dd>${esc(user.full_name)}</dd><dt>Courriel</dt><dd>${esc(user.email)}</dd><dt>Rôle</dt><dd>${esc(window.RedamsAccess.roleLabel(user) || user.role)}</dd><dt>Établissement</dt><dd>${esc(user.organization_name)}</dd></dl><p class="notification-empty">Pour changer votre mot de passe, ouvrez Paramètres › Sécurité & mot de passe.</p>`);
    }
    async function showSubscription() {
        const overlay = infoModal('Mon abonnement', '<p class="notification-empty">Chargement…</p>'), box = overlay.querySelector('.modal');
        try {
            const [sub, catalog] = await Promise.all([api('/api/subscription'), api('/api/public/catalog').catch(() => ({ plans: [] }))]);
            if (!sub) { box.insertAdjacentHTML('beforeend', '<p>Aucun abonnement actif.</p>'); box.querySelector('.notification-empty').remove(); return; }
            const plans = (catalog.plans || []).filter(plan => plan.name !== sub.plan_name);
            box.innerHTML = `<button type="button" class="close" aria-label="Fermer">×</button><h3>Mon abonnement</h3><dl class="profile-list"><dt>Forfait</dt><dd>${esc(sub.plan_name)}${sub.target_plan_name ? ` (forfait choisi : ${esc(sub.target_plan_name)})` : ''}</dd><dt>Statut</dt><dd>${esc(sub.status)}</dd><dt>Échéance</dt><dd>${esc(fmtDate(sub.current_period_end))}</dd><dt>Utilisateurs maximum</dt><dd>${esc(sub.max_users ?? '—')}</dd></dl>${plans.length ? `<h4>Changer de forfait</h4><form id="upgrade-form" class="upgrade-form"><label>Forfait souhaité<select name="plan">${plans.map(plan => `<option value="${esc(plan.name)}">${esc(plan.name)} — ${formatMoney(plan.monthly_price)}/mois</option>`).join('')}</select></label><p class="error" role="alert"></p><button class="btn">Demander un upgrade</button></form>` : ''}`;
            box.querySelector('.close').onclick = () => overlay.remove();
            const form = box.querySelector('#upgrade-form');
            if (form) form.onsubmit = async event => { event.preventDefault(); const error = form.querySelector('.error'); error.textContent = ''; try { await api('/api/support', { method: 'POST', body: JSON.stringify({ subject: `Demande de changement de forfait : ${form.elements.plan.value}`, message: `Je souhaite passer du forfait ${sub.plan_name} au forfait ${form.elements.plan.value}.` }) }); overlay.remove(); toast('Demande envoyée à l’assistance.'); } catch (reason) { error.textContent = reason.message; } };
        } catch (error) { box.insertAdjacentHTML('beforeend', `<p class="error">${esc(error.message)}</p>`); }
    }
    async function showBilling() {
        const overlay = infoModal('Facturation', '<p class="notification-empty">Chargement…</p>'), box = overlay.querySelector('.modal');
        try {
            const data = await api('/api/subscription/invoices'), rows = Array.isArray(data) ? data : data.invoices || [];
            box.querySelector('.notification-empty').outerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>Facture</th><th>Période</th><th>Montant</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.invoice_number)}</td><td>${esc(fmtDate(row.period_start))} → ${esc(fmtDate(row.period_end))}</td><td>${esc(Number(row.total_amount).toLocaleString('fr-FR'))} ${esc(row.currency || '')}</td><td>${esc(row.status)}</td><td>${esc(fmtDate(row.due_date))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="notification-empty">Aucune facture.</p>';
        } catch (error) { box.querySelector('.notification-empty').outerHTML = `<p class="error">${esc(error.message)}</p>`; }
    }
    $('#alerts-button').onclick = () => setAlertsOpen($('#alerts-panel').hidden);
    $('#alerts-close').onclick = () => setAlertsOpen(false);
    $('#alerts-list').onclick = event => { const item = event.target.closest('[data-alert-page]'); if (!item) return; setAlertsOpen(false); go(item.dataset.alertPage); };
    $('#user-button').onclick = () => setUserMenuOpen($('#user-dropdown').hidden);
    $('#user-dropdown').onclick = event => {
        const button = event.target.closest('[data-user-action]'); if (!button) return;
        setUserMenuOpen(false);
        ({ profile: showProfile, subscription: showSubscription, billing: showBilling, logout })[button.dataset.userAction]();
    };
    document.addEventListener('click', event => {
        if (!event.target.closest('.alert-wrap')) setAlertsOpen(false);
        if (!event.target.closest('.user-menu')) setUserMenuOpen(false);
    });
    $('#notifications-button').addEventListener('click', () => { if (!$('#notifications-panel').hidden) setAlertsOpen(false); });
    setInterval(() => { if (state.role && !document.hidden) loadAlerts(); }, 60000);
    let notificationPollError = false;
    setInterval(async () => {
        if (!state.role || state.role === 'ACCOUNTANT' || state.notificationRequest) return;
        try { await refreshNotifications(); notificationPollError = false; }
        catch (error) { if (!notificationPollError) toast(`Notifications indisponibles : ${error.message}`, 'error'); notificationPollError = true; }
    }, 10000);
    $('#logout').onclick = logout; boot();
})();
