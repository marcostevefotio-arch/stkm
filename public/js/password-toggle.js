(() => {
    function enhance(input) {
        if (input.dataset.passwordToggle || input.closest('.password-field')) return;
        input.dataset.passwordToggle = 'true';
        const wrap = document.createElement('div');
        wrap.className = 'password-field';
        input.replaceWith(wrap);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'password-toggle';
        wrap.append(input, button);
        const render = () => {
            const visible = input.type === 'text';
            button.textContent = visible ? 'Masquer' : 'Afficher';
            button.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
            button.setAttribute('aria-pressed', String(visible));
        };
        button.addEventListener('click', () => {
            const start = input.selectionStart, end = input.selectionEnd;
            input.type = input.type === 'password' ? 'text' : 'password';
            input.focus();
            try { input.setSelectionRange(start, end); } catch { /* sélection indisponible */ }
            render();
        });
        render();
    }
    const scan = () => document.querySelectorAll('input[type="password"]').forEach(enhance);
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; scan(); });
    }).observe(document.documentElement, { childList: true, subtree: true });
    scan();
})();
