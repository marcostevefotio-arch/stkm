(() => {
    const form = document.getElementById('signupForm'), planSelect = document.getElementById('planId');
    const intervalSelect = document.getElementById('billingInterval'), userLimit = document.getElementById('userLimit');
    const userLimitHint = document.getElementById('userLimitHint'), modulePicker = document.getElementById('modulePicker');
    const moduleOptions = document.getElementById('moduleOptions'), promotionSelect = document.getElementById('promotionId');
    const cart = document.getElementById('signupCart'), errorBox = document.getElementById('signupError'), submit = document.getElementById('signupSubmit');
    const intervals = [['monthly', 'Mensuel'], ['annual', 'Annuel'], ['biennial', '2 ans']];
    const fixedModules = {
        starter: ['stock', 'procurement', 'sales', 'cash'],
        ultimate: ['stock', 'procurement', 'sales', 'patients', 'cash', 'reports', 'administration', 'support']
    };
    const safeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const formatPrice = (value, currency) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(value))} ${currency}`;
    const parseList = value => {
        if (Array.isArray(value)) return value;
        if (typeof value !== 'string') return [];
        try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
        catch { return []; }
    };
    const parseObject = value => {
        if (value && typeof value === 'object') return value;
        if (typeof value !== 'string') return {};
        try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; }
        catch { return {}; }
    };
    const query = new URLSearchParams(location.search);
    let legalSettings;
    let requestedPromotion = query.get('promotion');
    const partnerCodeField = document.getElementById('partnerCode');
    partnerCodeField.value = (query.get('ref') || '').toUpperCase();
    let catalog;
    const currentPlan = () => catalog?.plans.find(plan => String(plan.id) === planSelect.value);
    const applicablePromotions = () => (catalog?.promotions || []).filter(promo => promo.plan_id === null || promo.plan_id === undefined || String(promo.plan_id) === planSelect.value);
    const currentPromotion = () => applicablePromotions().find(promo => String(promo.id) === promotionSelect.value);
    function updatePromotionOptions(preferred = null) {
        const applicable = applicablePromotions();
        const selected = preferred || promotionSelect.value;
        const selectedPromo = applicable.find(promo => String(promo.id) === selected);
        promotionSelect.innerHTML = '<option value="">Aucune promotion</option>' + applicable.map(promo => {
            const target = promo.plan_id ? currentPlan()?.name || 'Forfait ciblé' : 'Tous les forfaits';
            return `<option value="${safeText(promo.id)}">${safeText(promo.code)} · ${safeText(promo.name)} (${safeText(target)})</option>`;
        }).join('');
        promotionSelect.value = selectedPromo ? String(selectedPromo.id) : '';
    }
    const selectedModules = () => [...moduleOptions.querySelectorAll('input[name="selected_module"]:checked')].map(input => input.value);
    const termAmount = (plan, interval, modules, users) => {
        const prices = parseObject(plan.module_prices);
        let total;
        if (plan.plan_type === 'customized') {
            if (!modules.length || modules.some(module => prices[module]?.[interval] === null || prices[module]?.[interval] === undefined || !Number.isFinite(Number(prices[module][interval])))) return null;
            total = modules.reduce((sum, module) => sum + Number(prices[module][interval]), 0) + Number(plan.extra_user_price) * users;
        } else {
            const price = plan[`${interval}_price`];
            if (price === null || price === undefined || !Number.isFinite(Number(price))) return null;
            total = Number(price) + Number(plan.extra_user_price) * Math.max(0, users - Number(plan.max_users));
        }
        return Number.isFinite(total) ? total : null;
    };
    const availableIntervals = (plan, modules, users) => intervals.filter(([interval]) => termAmount(plan, interval, modules, users) !== null);
    const intervalLabel = interval => intervals.find(([key]) => key === interval)?.[1] || interval;

    function renderModules(plan, initial = false) {
        const custom = plan?.plan_type === 'customized';
        modulePicker.hidden = !custom;
        if (!custom) { moduleOptions.replaceChildren(); return; }
        const prices = parseObject(plan.module_prices), available = Object.entries(prices).filter(([, values]) =>
            intervals.some(([interval]) => values?.[interval] !== null && values?.[interval] !== undefined && Number.isFinite(Number(values[interval]))));
        const previouslySelected = new Set(initial ? [] : selectedModules());
        const defaultInterval = intervals.find(([interval]) => available.some(([, values]) => values?.[interval] !== null && values?.[interval] !== undefined))?.[0];
        const defaultModules = new Set(available.filter(([, values]) => values?.[defaultInterval] !== null && values?.[defaultInterval] !== undefined).map(([module]) => module));
        const hasPrice = value => value !== null && value !== undefined && Number.isFinite(Number(value));
        const rows = available.map(([code, pricesByTerm]) => {
            const selected = initial ? defaultModules.has(code) : previouslySelected.has(code);
            const cells = intervals.map(([interval]) => hasPrice(pricesByTerm?.[interval])
                ? `<td>${formatPrice(pricesByTerm[interval], plan.currency)}</td>` : '<td class="module-na">—</td>').join('');
            return `<tr><th scope="row"><label><input type="checkbox" name="selected_module" value="${safeText(code)}"${selected ? ' checked' : ''}><span>${safeText(catalog.modules?.[code] || code)}</span></label></th>${cells}</tr>`;
        }).join('');
        moduleOptions.innerHTML = `<table class="module-table"><thead><tr><th scope="col">Fonctionnalité</th><th scope="col">Mois</th><th scope="col">1 an</th><th scope="col">2 ans</th></tr></thead><tbody>${rows}</tbody></table>`;
        moduleOptions.querySelectorAll('input').forEach(input => input.addEventListener('change', updateIntervals));
    }

    function updateIntervals(preferred = null) {
        const plan = currentPlan();
        if (!plan) return;
        const modules = plan.plan_type === 'customized' ? selectedModules() : fixedModules[plan.plan_type] || [];
        const users = Number(userLimit.value);
        const available = availableIntervals(plan, modules, users);
        intervalSelect.innerHTML = available.map(([interval, label]) => `<option value="${interval}">${label}</option>`).join('');
        intervalSelect.disabled = available.length === 0;
        const requested = preferred || intervalSelect.value || query.get('billing_interval');
        if (available.some(([interval]) => interval === requested)) intervalSelect.value = requested;
        userLimit.disabled = false;
        userLimit.min = '1';
        userLimit.max = String(plan.plan_type === 'customized' ? 100000 : Number(plan.max_users) + 10000);
        userLimitHint.textContent = plan.plan_type === 'customized'
            ? `Tarif par utilisateur : ${formatPrice(plan.extra_user_price, plan.currency)}.`
            : `${plan.max_users} utilisateurs inclus; chaque utilisateur supplémentaire coûte ${formatPrice(plan.extra_user_price, plan.currency)}.`;
        if (!available.length) {
            errorBox.textContent = plan.plan_type === 'customized'
                ? 'Sélectionnez des fonctionnalités tarifées pour une même période.'
                : 'Aucune période tarifée n’est disponible pour ce forfait.';
        } else if (errorBox.textContent.startsWith('Sélectionnez des fonctionnalités') || errorBox.textContent.startsWith('Aucune période tarifée')) {
            errorBox.textContent = '';
        }
        renderCart();
    }

    function renderCart() {
        const plan = currentPlan(), promo = currentPromotion();
        if (!plan) { cart.innerHTML = '<p>Aucune offre disponible. <a href="/">Retour au portail</a>.</p>'; submit.disabled = true; return; }
        const modules = plan.plan_type === 'customized' ? selectedModules() : fixedModules[plan.plan_type] || [];
        const users = Number(userLimit.value), interval = intervalSelect.value;
        const subtotal = interval ? termAmount(plan, interval, modules, users) : null;
        if (subtotal === null) {
            cart.innerHTML = `<p>${plan.plan_type === 'customized' && !modules.length ? 'Sélectionnez au moins une fonctionnalité pour calculer le tarif.' : 'Cette période n’est pas encore tarifée pour la sélection.'}</p>`;
            submit.disabled = true;
            return;
        }
        const rawDiscount = promo ? (promo.discount_type === 'percent' ? subtotal * Number(promo.discount_value) / 100 : Number(promo.discount_value)) : 0;
        const discount = Math.min(subtotal, rawDiscount), total = Math.max(0, subtotal - discount);
        const moduleLines = plan.plan_type === 'customized' ? modules.map(module => `<div class="cart-line"><span>${safeText(catalog.modules?.[module] || module)}</span><b>${formatPrice(parseObject(plan.module_prices)[module][interval], plan.currency)}</b></div>`).join('') : '';
        const extraUsers = plan.plan_type === 'customized' ? users : Math.max(0, users - Number(plan.max_users));
        const userLine = extraUsers ? `<div class="cart-line"><span>${extraUsers} utilisateur(s) supplémentaire(s)</span><b>${formatPrice(Number(plan.extra_user_price) * extraUsers, plan.currency)}</b></div>` : '';
        cart.innerHTML = `<div class="cart-plan"><span class="cart-icon">▤</span><div><b>${safeText(plan.name)}</b><small>Facturation ${intervalLabel(interval).toLowerCase()} après l’essai de 7 jours</small></div></div>${moduleLines}${userLine}<div class="cart-line"><span>Tarif ${intervalLabel(interval).toLowerCase()}</span><b>${formatPrice(subtotal, plan.currency)}</b></div>${promo ? `<div class="cart-line cart-discount"><span>Promotion ${safeText(promo.code)}</span><b>− ${formatPrice(discount, plan.currency)}</b></div>` : ''}<div class="cart-line cart-total"><span>Total après l’essai</span><b>${formatPrice(total, plan.currency)} / ${intervalLabel(interval).toLowerCase()}</b></div><div class="cart-quotas"><span>✓ ${users} compte(s) utilisateur(s)</span><span>✓ Jusqu’à ${new Intl.NumberFormat('fr-FR').format(Number(plan.max_products))} produits</span></div>`;
        submit.disabled = false;
    }

    function selectPlan(preferredInterval) {
        const plan = currentPlan();
        if (!plan) return;
        updatePromotionOptions(requestedPromotion);
        requestedPromotion = null;
        const defaultUsers = plan.plan_type === 'customized' ? 1 : Number(plan.max_users);
        userLimit.value = String(defaultUsers);
        renderModules(plan, true);
        updateIntervals(preferredInterval || query.get('billing_interval'));
    }

    async function boot() {
        document.getElementById('currentYear').textContent = String(new Date().getFullYear());
        try {
            const [catalogResponse, legalResponse] = await Promise.all([
                fetch('/api/public/catalog', { headers: { Accept: 'application/json' } }),
                fetch('/api/public/legal-documents', { headers: { Accept: 'application/json' } })
            ]);
            let data, legal;
            try { data = await catalogResponse.json(); } catch { throw Error('Le catalogue reçu est illisible. Actualisez la page.'); }
            try { legal = await legalResponse.json(); } catch { throw Error('Les documents légaux reçus sont illisibles. Actualisez la page.'); }
            if (!catalogResponse.ok) throw Error(data.error || 'Impossible de charger les offres.');
            if (!legalResponse.ok) throw Error(legal.error || 'Impossible de charger les documents légaux.');
            catalog = data;
            legalSettings = legal;
            if (!catalog.plans.length) throw Error('Aucun forfait n’est ouvert à la souscription pour le moment.');
            planSelect.innerHTML = catalog.plans.map(plan => `<option value="${safeText(plan.id)}">${safeText(plan.name)}${plan.plan_type === 'customized' ? ' · à la carte' : ''}</option>`).join('');
            if (query.has('plan') && catalog.plans.some(plan => String(plan.id) === query.get('plan'))) planSelect.value = query.get('plan');
            selectPlan(query.get('billing_interval'));
        } catch (error) {
            errorBox.textContent = error.message;
            submit.disabled = true;
            cart.innerHTML = `<p role="alert">${safeText(error.message)} <a href="/">Consulter le portail</a>.</p>`;
        }
    }

    planSelect.addEventListener('change', () => selectPlan(null));
    intervalSelect.addEventListener('change', renderCart);
    userLimit.addEventListener('input', () => updateIntervals(intervalSelect.value));
    promotionSelect.addEventListener('change', renderCart);
    form.addEventListener('input', () => { if (!errorBox.textContent.startsWith('Sélectionnez des fonctionnalités') && !errorBox.textContent.startsWith('Aucune période tarifée')) errorBox.textContent = ''; });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!catalog || !form.reportValidity()) return;
        const modules = currentPlan()?.plan_type === 'customized' ? selectedModules() : undefined;
        if (currentPlan()?.plan_type === 'customized' && modules.length === 0) {
            errorBox.textContent = 'Sélectionnez au moins une fonctionnalité Customized.';
            return;
        }
        const values = Object.fromEntries(new FormData(form));
        values.accept_terms = form.elements.accept_terms.checked;
        values.accept_legal_documents = form.elements.accept_legal_documents.checked;
        values.legal_document_versions = Object.fromEntries(legalSettings.documents.map(document => [document.id, document.version]));
        values.promotion_id = values.promotion_id || null;
        if (modules) values.selected_modules = modules;
        submit.disabled = true;
        submit.innerHTML = 'Création sécurisée en cours…';
        try {
            const response = await fetch('/api/public/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(values) });
            let result;
            try { result = await response.json(); } catch { throw Error('Le serveur a renvoyé une réponse illisible. Réessayez ou contactez REDAMS.'); }
            if (!response.ok) throw Error(result.error || 'La création de votre espace a échoué.');
            sessionStorage.setItem('redams_token', result.token);
            sessionStorage.setItem('redams_signup_welcome', result.message);
            location.assign('/app');
        } catch (error) {
            errorBox.textContent = error.message;
            submit.disabled = false;
            submit.innerHTML = 'Créer mon espace gratuitement <span>→</span>';
            errorBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    });

    boot();
})();
