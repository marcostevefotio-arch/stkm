(() => {
    window.renderLegalDocumentContent = (container, content) => {
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
})();
