(() => {
    const KEY = 'redams_lang';
    let lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'fr';
    document.documentElement.lang = lang;

    const dictionary = {
        '▦ Tableau de bord': '▦ Dashboard', 'Tableau de bord': 'Dashboard',
        'Gestion des stocks': 'Stock management', 'Catalogue produits': 'Product catalog', 'Mouvements': 'Movements', 'Mouvements de stock': 'Stock movements', 'Alertes de stock': 'Stock alerts',
        'Approvisionnement': 'Procurement', 'Fournisseurs': 'Suppliers', 'Commandes & réceptions': 'Orders & receipts',
        'Patients': 'Patients', 'Dossiers patients': 'Patient records', 'Assurances': 'Insurance',
        'Ventes & facturation': 'Sales & billing', 'Point de vente': 'Point of sale', 'Factures & reçus': 'Invoices & receipts', 'Recettes & caisse': 'Revenue & cash',
        'Rapports & analyses': 'Reports & analytics', 'Administration': 'Administration', 'Utilisateurs & rôles': 'Users & roles', "Journal d'activité": 'Activity log',
        'Paramètres': 'Settings', 'Paramètres généraux & identité': 'General settings & identity', 'Assistance': 'Support',
        'ABONNEMENT': 'SUBSCRIPTION', 'Chargement…': 'Loading…', 'Déconnexion': 'Log out', 'Déconnexion ↗': 'Log out ↗',
        'Mon établissement': 'My facility', 'Administrateur': 'Administrator',
        'Rechercher dans les modules…': 'Search modules…', 'Recherche générale': 'Global search', 'Lancer la recherche': 'Run search',
        'Notifications': 'Notifications', 'Alertes système': 'System alerts', 'Fermer': 'Close', 'Ouvrir le menu': 'Open menu', 'Fermer le menu': 'Close menu',
        'Charger plus': 'Load more', '＋ Nouvelle notification': '＋ New notification', 'Envoyer une notification': 'Send a notification', 'Titre': 'Title', 'Message': 'Message', 'Envoyer': 'Send',
        'Mon profil': 'My profile', 'Langue': 'Language', 'Abonnement': 'Subscription', 'Facturation': 'Billing',
        "VUE D'ENSEMBLE": 'OVERVIEW', 'Produits actifs': 'Active products', 'Unités en stock': 'Units in stock', 'Mouvements du jour': "Today's movements",
        'Accès rapides': 'Quick access', '＋ Ajouter un produit': '＋ Add a product', '⇄ Mouvement de stock': '⇄ Stock movement', "⚙ Personnaliser l'établissement": '⚙ Customize the facility',
        'Produits à surveiller': 'Products to watch', 'Aucun résultat.': 'No results.',
        'Précédent': 'Previous', 'Suivant': 'Next', 'Actions': 'Actions', 'Modifier': 'Edit', 'Archiver': 'Archive', 'Réactiver': 'Reactivate', 'Consulter': 'View', 'Corriger': 'Correct', 'Valider': 'Approve', 'Rejeter': 'Reject',
        'Enregistrer': 'Save', 'Annuler': 'Cancel', 'Statut': 'Status', 'Actif': 'Active', 'Archivé': 'Archived', 'Date': 'Date', 'Produit': 'Product', 'Type': 'Type', 'Quantité': 'Quantity',
        'Entrée': 'In', 'Sortie': 'Out', 'Ajustement': 'Adjustment', 'Nom complet': 'Full name', 'Code patient': 'Patient code', 'Genre': 'Gender', 'Téléphone': 'Phone', 'Courriel': 'Email', 'Adresse': 'Address',
        '10 lignes': '10 rows', '25 lignes': '25 rows', '50 lignes': '50 rows',
        '＋ Nouveau patient': '＋ New patient', '＋ Nouveau mouvement': '＋ New movement', 'Journal des mouvements': 'Movement log',
        'Généraux & identité': 'General & identity', 'Fiscalité & reçus': 'Tax & receipts', 'Sauvegarde & restauration': 'Backup & restore', 'Sécurité & mot de passe': 'Security & password', 'QR & codes-barres': 'QR & barcodes', 'Index de recherche': 'Search index',
        'Informations de l’entreprise': 'Company information', 'Mon abonnement': 'My subscription', 'Mes factures d’abonnement': 'My subscription invoices',
        'Informations personnelles': 'Personal information', 'Nom': 'Name', 'Rôle': 'Role', 'Établissement': 'Facility', 'Changer le mot de passe': 'Change password',
        'Forfait': 'Plan', 'Période': 'Billing period', 'Échéance': 'Due date', 'Prix mensuel': 'Monthly price',
        'Aucune alerte pour le moment.': 'No alerts at the moment.', 'Aucune facture.': 'No invoices.',
        'Voir': 'View', 'Total': 'Total', 'Facture': 'Invoice', 'Montant': 'Amount', 'Envoyer la demande': 'Send request',
        'Alertes': 'Alerts', 'Connexion': 'Sign in', 'Se connecter': 'Sign in', 'Mot de passe': 'Password'
    };
    const patterns = [
        [/^(\d+) produit\(s\) en rupture de stock$/, n => `${n} product(s) out of stock`],
        [/^(\d+) produit\(s\) sous le seuil de réapprovisionnement$/, n => `${n} product(s) below reorder level`],
        [/^Session de caisse ouverte depuis plus de 24 h$/, () => 'Cash session open for more than 24 h'],
        [/^Écart de caisse de (.+)$/, v => `Cash variance of ${v}`],
        [/^Récidive possible à vérifier$/, () => 'Possible recurrence to review'],
        [/^Réponse de l’assistance$/, () => 'Support reply'],
        [/^Bonjour, bienvenue 👋$/, () => 'Hello, welcome 👋'],
        [/^La situation de ton établissement aujourd'hui\.$/, () => "Your facility's situation today."],
        [/^Pensez à la clôturer\.$/, () => 'Remember to close it.']
    ];
    const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
    const translate = text => {
        const trimmed = text.trim(); if (!trimmed) return null;
        if (Object.hasOwn(dictionary, trimmed)) return text.replace(trimmed, dictionary[trimmed]);
        for (const [pattern, build] of patterns) { const match = trimmed.match(pattern); if (match) return text.replace(trimmed, build(...match.slice(1))); }
        return null;
    };
    const translated = new WeakMap();
    const translateNode = node => {
        if (translated.get(node) === node.nodeValue) return;
        const out = translate(node.nodeValue);
        if (out !== null && out !== node.nodeValue) { node.nodeValue = out; translated.set(node, out); }
    };
    const attrs = ['placeholder', 'aria-label', 'title'];
    const translateAttrs = element => attrs.forEach(name => { const value = element.getAttribute?.(name); if (!value) return; const out = translate(value); if (out !== null && out !== value) element.setAttribute(name, out); });
    const apply = root => {
        if (lang !== 'en' || !root) return;
        if (root.nodeType === Node.TEXT_NODE) { if (!SKIP.has(root.parentElement?.tagName)) translateNode(root); return; }
        if (root.nodeType !== Node.ELEMENT_NODE) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!SKIP.has(node.parentElement?.tagName)) translateNode(node);
        translateAttrs(root); root.querySelectorAll('[placeholder],[aria-label],[title]').forEach(translateAttrs);
    };
    const markActive = () => document.querySelectorAll('[data-lang]').forEach(button => { const active = button.dataset.lang === lang; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    const start = () => {
        markActive(); apply(document.body);
        if (lang === 'en') new MutationObserver(mutations => mutations.forEach(mutation => {
            if (mutation.type === 'characterData') apply(mutation.target);
            else mutation.addedNodes.forEach(apply);
        })).observe(document.body, { childList: true, subtree: true, characterData: true });
        document.addEventListener('click', event => {
            const button = event.target.closest('[data-lang]'); if (!button || button.dataset.lang === lang) return;
            localStorage.setItem(KEY, button.dataset.lang); location.reload();
        });
    };
    window.i18n = { get lang() { return lang; }, t: text => (lang === 'en' ? translate(text) ?? text : text) };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
