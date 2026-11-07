(function (root) {
    const salesRoles = ['OWNER', 'ADMIN', 'PHARMACIST', 'CASHIER'];
    const administrators = ['OWNER', 'ADMIN'];
    const roleFeatures = {
        OWNER: ['stock', 'procurement', 'sales', 'cash', 'patients', 'reports', 'administration', 'support'],
        ADMIN: ['stock', 'procurement', 'sales', 'cash', 'patients', 'reports', 'administration', 'support'],
        PHARMACIST: ['sales', 'cash', 'patients', 'support'],
        STOREKEEPER: ['stock', 'procurement', 'support'],
        CASHIER: ['sales', 'cash', 'support'],
        VIEWER: ['stock', 'procurement', 'reports', 'support'],
        ACCOUNTANT: ['reports']
    };
    const pageFeatures = { products: 'stock', movements: 'stock', alerts: 'stock', suppliers: 'procurement', purchases: 'procurement', pos: 'sales', invoices: 'sales', cash: 'cash', patients: 'patients', insurers: 'patients', reports: 'reports', audit: 'administration' };
    function hasFeature(user, feature) {
        if (user?.role === 'SUPER_ADMIN' || user?.subscription_modules == null) return true;
        let modules = user.subscription_modules;
        if (typeof modules === 'string') {
            try { modules = JSON.parse(modules); } catch { return false; }
        }
        return Array.isArray(modules) && modules.includes(feature);
    }
    const canAccessModule = (user, feature) => hasFeature(user, feature) && (user?.role === 'SUPER_ADMIN' || Boolean(roleFeatures[user?.role]?.includes(feature)));
    const isSeparate = settings => Number(settings?.separate_sale_payment) === 1;
    const canSell = (user, settings) => salesRoles.includes(user?.role) && hasFeature(user, 'sales') && (!isSeparate(settings) ? hasFeature(user, 'cash') : user.role !== 'CASHIER');
    const canCollect = (user, settings) => salesRoles.includes(user?.role) && hasFeature(user, 'cash') && (!isSeparate(settings) || user.role !== 'PHARMACIST');
    function canAccessPage(user, settings, page) {
        if (!roleFeatures[user?.role] && user?.role !== 'SUPER_ADMIN') return false;
        if (user?.role === 'ACCOUNTANT') return page === 'security' || (page.startsWith('accounting-') && hasFeature(user, 'reports'));
        if (page.startsWith('accounting-')) return administrators.includes(user?.role) && hasFeature(user, 'reports');
        if (pageFeatures[page] && !canAccessModule(user, pageFeatures[page])) return false;
        if (page === 'pos') return canSell(user, settings);
        if (page === 'cash') return canCollect(user, settings);
        if (page === 'invoices') return salesRoles.includes(user?.role);
        if (['patients', 'insurers', 'insurers/coverages'].includes(page)) return ['OWNER', 'ADMIN', 'PHARMACIST'].includes(user?.role) && hasFeature(user, 'patients');
        if (['settings', 'general', 'tax', 'workflow', 'backup', 'codes', 'search', 'users', 'audit', 'settings/patients'].includes(page)) return administrators.includes(user?.role);
        if (page === 'platform') return user?.role === 'SUPER_ADMIN';
        return ['dashboard', 'products', 'movements', 'alerts', 'suppliers', 'purchases', 'reports', 'security', 'help', 'global-search'].includes(page);
    }
    const policy = { hasFeature, canAccessModule, isSeparate, canSell, canCollect, canAccessPage };
    if (typeof module === 'object' && module.exports) module.exports = policy;
    else root.RedamsAccess = policy;
})(typeof window === 'object' ? window : globalThis);
