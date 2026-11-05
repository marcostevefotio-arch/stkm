(() => {
    const MARK = 'required-mark';
    const isRequiredControl = control => control.required && !['checkbox', 'radio', 'hidden'].includes(control.type);
    function mark(label) {
        if (label.querySelector(`:scope > .${MARK}, :scope > * > .${MARK}`)) return;
        const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        let host = [...label.children].find(child => !child.matches('input,select,textarea,small') && child.textContent.trim());
        if (textNode) {
            host = document.createElement('span');
            textNode.replaceWith(host);
            host.append(textNode);
        }
        if (!host) return;
        const star = document.createElement('span');
        star.className = MARK; star.textContent = ' *'; star.setAttribute('aria-hidden', 'true');
        host.append(star);
    }
    function scan(root = document) {
        root.querySelectorAll('input[required],select[required],textarea[required]').forEach(control => {
            if (!isRequiredControl(control)) return;
            const label = control.closest('label') || (control.id ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`) : null);
            if (label) mark(label);
        });
    }
    let queued = false;
    new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; scan(); });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['required'] });
    scan();
})();
