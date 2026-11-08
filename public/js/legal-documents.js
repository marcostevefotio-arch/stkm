(() => {
    const renderContent = (container, content) => {
        container.replaceChildren();
        const blocks = String(content || '').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean);
        for (const block of blocks) {
            const lines = block.split(/\r?\n/);
            if (lines[0].startsWith('# ')) {
                const heading = document.createElement('h2');
                heading.textContent = lines.shift().slice(2);
                container.append(heading);
            }
            if (lines.length && lines.every(line => line.startsWith('- '))) {
                const list = document.createElement('ul');
                lines.forEach(line => {
                    const item = document.createElement('li');
                    item.textContent = line.slice(2);
                    list.append(item);
                });
                container.append(list);
            } else if (lines.length) {
                const paragraph = document.createElement('p');
                paragraph.textContent = lines.join('\n');
                container.append(paragraph);
            }
        }
    };

    fetch('/api/public/legal-documents', { headers: { Accept: 'application/json' } })
        .then(async response => {
            const settings = await response.json();
            if (!response.ok) throw Error(settings.error || 'Impossible de charger les documents légaux.');
            document.querySelectorAll('[data-public-legal-links]').forEach(nav => {
                nav.hidden = !settings.show_public_links;
            });
            for (const documentData of settings.documents) {
                document.querySelectorAll(`[data-legal-link="${documentData.id}"]`).forEach(link => {
                    link.textContent = documentData.title;
                });
                document.querySelectorAll(`[data-legal-content="${documentData.id}"]`).forEach(container => {
                    renderContent(container, documentData.content);
                });
                document.querySelectorAll(`[data-legal-title="${documentData.id}"]`).forEach(heading => {
                    heading.textContent = documentData.title;
                });
                document.querySelectorAll(`[data-legal-version="${documentData.id}"]`).forEach(version => {
                    version.textContent = documentData.version.slice(0, 12);
                });
                if (document.body.dataset.legalDocument === documentData.id) {
                    document.title = `${documentData.title} — REDAMS-STK`;
                }
            }
        })
        .catch(error => console.error('Chargement des documents légaux impossible.', error));
})();
