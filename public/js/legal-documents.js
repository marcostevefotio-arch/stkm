(() => {
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
                    window.renderLegalDocumentContent(container, documentData.content);
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
