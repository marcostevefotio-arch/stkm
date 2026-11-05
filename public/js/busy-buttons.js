(() => {
    const originalFetch = window.fetch.bind(window);
    const active = new Set();
    let pending = 0, settleTimer = null;

    function release(entry) {
        active.delete(entry);
        clearTimeout(entry.idleTimer);
        const { button } = entry;
        if (!button.isConnected) return;
        button.disabled = entry.wasDisabled;
        button.classList.remove('is-busy');
        button.removeAttribute('aria-busy');
        if (entry.spinner) entry.spinner.remove();
    }

    function settle() {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            if (pending === 0) [...active].filter(entry => entry.started).forEach(release);
        }, 150);
    }

    window.fetch = (...args) => {
        pending += 1;
        active.forEach(entry => { entry.started = true; clearTimeout(entry.idleTimer); });
        const done = () => { pending = Math.max(0, pending - 1); settle(); };
        const request = originalFetch(...args);
        request.then(done, done);
        return request;
    };

    document.addEventListener('submit', event => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement) || form.id === 'signupForm' || form.noValidate === false && !form.checkValidity()) return;
        const button = event.submitter || form.querySelector('button[type="submit"], button:not([type])');
        if (!button || button.disabled) return;
        const spinner = document.createElement('span');
        spinner.className = 'btn-spinner'; spinner.setAttribute('aria-hidden', 'true');
        const entry = { button, spinner, wasDisabled: button.disabled, started: pending > 0 };
        button.prepend(spinner);
        button.classList.add('is-busy'); button.setAttribute('aria-busy', 'true');
        button.disabled = true;
        active.add(entry);
        // Sans requête réseau (validation locale), le bouton est réactivé rapidement.
        entry.idleTimer = setTimeout(() => { if (!entry.started) release(entry); }, 700);
    }, true);
})();
