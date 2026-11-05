(() => {
    const intervals = [['monthly', '1 mois'], ['annual', '1 an'], ['biennial', '2 ans']];
    const fixedModules = {
        starter: ['stock', 'procurement', 'sales', 'cash'],
        ultimate: ['stock', 'procurement', 'sales', 'patients', 'cash', 'reports', 'administration', 'support']
    };
    const formatPrice = (value, currency) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(value))} ${currency}`;
    const safeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
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
    const validPrice = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0;
    const availableIntervals = plan => plan.plan_type === 'customized'
        ? intervals.filter(([interval]) => Object.values(parseObject(plan.module_prices)).some(prices => validPrice(prices?.[interval])))
        : intervals.filter(([interval]) => validPrice(plan[`${interval}_price`]));

    function renderPlanCard(plan, index, catalog) {
        const modules = plan.plan_type === 'customized' ? parseList(plan.included_modules) : fixedModules[plan.plan_type] || [];
        const moduleNames = modules.map(code => catalog.modules?.[code] || code);
        const prices = parseObject(plan.module_prices);
        const terms = availableIntervals(plan);
        const defaultInterval = terms.some(([interval]) => interval === 'monthly') ? 'monthly' : terms[0]?.[0];
        const termOptions = terms.length
            ? terms.map(([interval, label]) => `<option value="${interval}"${interval === defaultInterval ? ' selected' : ''}>${label}</option>`).join('')
            : '<option value="">Tarifs en cours de configuration</option>';
        const moduleList = plan.plan_type === 'customized'
            ? `<ul class="pricing-module-prices" data-module-prices><li class="pricing-module-note">${terms.length ? 'Les tarifs des fonctionnalités s’affichent selon la durée choisie.' : 'Tarifs des fonctionnalités en cours de configuration.'}</li></ul>`
            : `<ul>${moduleNames.map(name => `<li>${safeText(name)}</li>`).join('')}<li>Jusqu’à ${new Intl.NumberFormat('fr-FR').format(Number(plan.max_products))} produits</li><li>7 jours d’essai gratuit avec accès complet</li><li>Assistance et mises à jour</li></ul>`;
        const pricingControl = `<div class="pricing-choice"><label for="term-${safeText(plan.id)}">Durée de l’abonnement</label><select id="term-${safeText(plan.id)}" data-pricing-term${terms.length ? '' : ' disabled'}>${termOptions}</select><div class="pricing-selected-price" data-selected-price aria-live="polite"></div></div>`;
        const promotionInfo = catalog.promotions.length
            ? `<div class="promo-badge"><b>Promotions disponibles</b><span>${catalog.promotions.map(promo => `${safeText(promo.code)} · ${promo.discount_type === 'percent' ? `${safeText(promo.discount_value)} %` : formatPrice(promo.discount_value, plan.currency)}`).join(' · ')}</span></div>`
            : '';
        return `<article class="pricing-card${index === 1 ? ' featured' : ''}" data-plan-card data-plan-id="${safeText(plan.id)}" data-plan-type="${safeText(plan.plan_type)}" data-plan-active="${plan.is_purchasable ? 'true' : 'false'}">${index === 1 ? '<span class="pricing-ribbon">POPULAIRE</span>' : ''}<h3>${safeText(plan.name)}</h3><p>${plan.plan_type === 'customized' ? 'Composez votre offre en choisissant les fonctionnalités et le nombre d’utilisateurs.' : 'Une offre adaptée à votre équipe et à votre activité.'}</p>${pricingControl}<span class="price-caption">${plan.plan_type === 'customized' ? `Nombre d’utilisateurs au choix · ${formatPrice(plan.extra_user_price, plan.currency)} / utilisateur` : `${safeText(plan.max_users)} utilisateurs inclus · +${formatPrice(plan.extra_user_price, plan.currency)} par utilisateur supplémentaire`}</span>${moduleList}${promotionInfo}<a class="portal-button full pricing-choose" data-pricing-link href="/inscription?plan=${encodeURIComponent(plan.id)}">Choisir cette offre <span>→</span></a></article>`;
    }

    function updatePlanCard(card, plan, promotions, modules) {
        const interval = card.querySelector('[data-pricing-term]').value;
        const label = intervals.find(([key]) => key === interval)?.[1] || interval;
        const output = card.querySelector('[data-selected-price]');
        const link = card.querySelector('[data-pricing-link]');
        if (!interval) {
            output.innerHTML = '<span>Prix</span><strong>Tarifs en cours de configuration</strong>';
            link.textContent = 'Bientôt disponible';
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
            return;
        }
        const params = new URLSearchParams({ plan: String(plan.id), billing_interval: interval });
        if (plan.plan_type === 'customized') {
            const rows = Object.entries(parseObject(plan.module_prices))
                .filter(([, values]) => validPrice(values?.[interval]))
                .map(([module, values]) => `<li><span>${safeText(modules?.[module] || module)}</span><b>${formatPrice(values[interval], plan.currency)}</b></li>`);
            card.querySelector('[data-module-prices]').innerHTML = `${rows.join('')}<li class="pricing-module-note">Tarif par utilisateur : ${formatPrice(plan.extra_user_price, plan.currency)}</li><li class="pricing-module-note">7 jours d’essai gratuit avec accès complet</li>`;
            output.innerHTML = `<span>Tarifs des fonctionnalités · ${safeText(label)}</span><strong>À la carte</strong>`;
        } else {
            const base = Number(plan[`${interval}_price`]);
            const best = promotions.reduce((current, promo) => {
                const discount = Math.min(base, promo.discount_type === 'percent' ? base * Number(promo.discount_value) / 100 : Number(promo.discount_value));
                return discount > current.discount ? { promo, discount } : current;
            }, { promo: null, discount: 0 });
            const total = Math.max(0, base - best.discount);
            output.innerHTML = `<span>Tarif pour ${safeText(label)}</span><strong>${best.promo ? `<del>${formatPrice(base, plan.currency)}</del><b>${formatPrice(total, plan.currency)}</b>` : formatPrice(base, plan.currency)}</strong>${best.promo ? `<small>${safeText(best.promo.code)} · réduction de ${formatPrice(best.discount, plan.currency)}</small>` : ''}`;
            if (best.promo) params.set('promotion', String(best.promo.id));
        }
        if (card.dataset.planActive === 'true') {
            link.href = `/inscription?${params}`;
            link.removeAttribute('aria-disabled');
        } else {
            link.textContent = 'Bientôt disponible';
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
        }
    }

    async function loadPortal() {
        document.getElementById('currentYear').textContent = String(new Date().getFullYear());
        const pricing = document.getElementById('portalPricing'), faq = document.getElementById('portalFaq');
        try {
            const response = await fetch('/api/public/catalog', { headers: { Accept: 'application/json' } });
            let catalog;
            try { catalog = await response.json(); } catch { throw Error('Le catalogue reçu est illisible. Réessayez plus tard.'); }
            if (!response.ok) throw Error(catalog.error || 'Impossible de charger les forfaits.');
            pricing.innerHTML = catalog.plans.length
                ? catalog.plans.map((plan, index) => renderPlanCard(plan, index, catalog)).join('')
                : '<p class="pricing-loading">Aucun forfait disponible pour le moment. Contactez l’équipe REDAMS pour être accompagné.</p>';
            catalog.plans.forEach(plan => {
                const card = [...pricing.querySelectorAll('[data-plan-card]')].find(item => item.dataset.planId === String(plan.id));
                if (!card) return;
                updatePlanCard(card, plan, catalog.promotions, catalog.modules);
                card.querySelector('[data-pricing-term]').addEventListener('change', () => updatePlanCard(card, plan, catalog.promotions, catalog.modules));
            });
            faq.innerHTML = catalog.faqs.length ? catalog.faqs.map(item => `<details><summary>${safeText(item.question)}</summary><p>${safeText(item.answer)}</p></details>`).join('') : '<p class="pricing-loading">La FAQ sera bientôt disponible.</p>';
        } catch (error) {
            pricing.innerHTML = `<p class="pricing-loading" role="alert">${safeText(error.message)} <button type="button" id="retryCatalog">Réessayer</button></p>`;
            faq.innerHTML = '';
            document.getElementById('retryCatalog')?.addEventListener('click', loadPortal, { once: true });
        }
    }

    loadPortal();
})();
