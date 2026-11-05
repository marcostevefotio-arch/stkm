(() => {
    const toggle = document.getElementById('nav-toggle'), sidebar = document.getElementById('main-sidebar');
    if (!toggle || !sidebar) return;
    const backdrop = document.createElement('div'); backdrop.className = 'nav-backdrop'; document.body.append(backdrop);
    const mobile = window.matchMedia('(max-width:900px)');
    const setOpen = open => {
        document.body.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    };
    toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('nav-open')));
    backdrop.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
    sidebar.addEventListener('click', event => { if (mobile.matches && event.target.closest('a[data-page], .plan button')) setOpen(false); });
    mobile.addEventListener('change', event => { if (!event.matches) setOpen(false); });
})();
