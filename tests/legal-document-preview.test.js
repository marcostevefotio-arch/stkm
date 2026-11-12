const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const readScript = name => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', name), 'utf8');
const rendererSource = readScript('legal-document-renderer.js');
const staffSource = readScript('staff.js');

function element(tagName) {
  return {
    tagName,
    children: [],
    textContent: '',
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
  };
}

test('legal renderer formats headings, paragraphs and lists without executing HTML', () => {
  const context = { window: {}, document: { createElement: element } };
  vm.runInNewContext(rendererSource, context);
  const container = element('article');
  container.append(element('old'));
  context.window.renderLegalDocumentContent(container, '# Section\r\nFirst line\r\nSecond line\n\n- One\n- Two\n\n<script>alert(1)</script>');
  assert.deepEqual(container.children.map(child => child.tagName), ['h2', 'p', 'ul', 'p']);
  assert.equal(container.children[0].textContent, 'Section');
  assert.equal(container.children[1].textContent, 'First line\nSecond line');
  assert.deepEqual(container.children[2].children.map(child => child.textContent), ['One', 'Two']);
  assert.equal(container.children[3].textContent, '<script>alert(1)</script>');
  context.window.renderLegalDocumentContent(container, '');
  assert.equal(container.children.length, 0);
});

test('each legal preview uses unsaved fields without saving, and submit targets the save button', async () => {
  const ids = ['conditions-generales', 'politique-confidentialite', 'accord-traitement-donnees'];
  const settings = {
    show_public_links: true,
    show_authenticated_links: false,
    documents: ids.map(id => ({ id, title: 'Saved title', content: 'Saved content', version: '1234567890123456' })),
  };
  const buttons = ids.map(id => ({ dataset: { legalPreview: id } }));
  const saveButton = {};
  const errorTarget = {};
  const form = {
    elements: { show_public_links: { checked: true }, show_authenticated_links: { checked: false } },
    querySelectorAll(selector) { assert.equal(selector, '[data-legal-preview]'); return buttons; },
    querySelector(selector) {
      if (selector === 'button[type="submit"]') return saveButton;
      if (selector === '.sp-error') return errorTarget;
      assert.fail(`Unexpected selector: ${selector}`);
    },
  };
  ids.forEach(id => {
    form.elements[`title_${id}`] = { value: `Edited ${id}` };
    form.elements[`content_${id}`] = { value: `# Draft ${id}\n\n<img src=x onerror=alert(1)>` };
  });
  const panel = {
    innerHTML: '',
    querySelector(selector) { assert.equal(selector, '[data-legal-form]'); return form; },
  };
  const previews = [];
  const saves = [];
  let prevented = false;
  const context = {
    panel, window: {}, document: { createElement: element },
    api: async route => { assert.equal(route, '/admin/legal-documents'); return settings; },
    esc: value => String(value),
    modal: (title, html) => {
      const preview = { title, html, article: element('article'), focused: false };
      previews.push(preview);
      return {
        body: { querySelector: () => preview.article },
        overlay: { querySelector: () => ({ focus: () => { preview.focused = true; } }) },
      };
    },
    run: (button, action, error) => {
      assert.equal(button, saveButton);
      assert.equal(error, errorTarget);
      return action();
    },
    send: async (method, route, body) => { saves.push({ method, route, body }); },
    toast: () => {},
    load: async key => { assert.equal(key, 'legal'); },
  };
  vm.createContext(context);
  vm.runInContext(rendererSource, context);
  const start = staffSource.indexOf("                    const settings = await api('/admin/legal-documents');");
  const end = staffSource.indexOf("                } else if (key === 'database')", start);
  assert.ok(start >= 0 && end > start);
  await vm.runInContext(`(async () => {${staffSource.slice(start, end)}})()`, context);
  for (const id of ids) {
    assert.ok(panel.innerHTML.includes(`type="button" class="sp-btn secondary" data-legal-preview="${id}"`));
  }
  buttons.forEach(button => button.onclick());
  assert.equal(saves.length, 0);
  previews.forEach((preview, index) => {
    assert.equal(preview.title, `Edited ${ids[index]}`);
    assert.equal(preview.article.children[0].textContent, `Draft ${ids[index]}`);
    assert.equal(preview.article.children[1].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(preview.focused, true);
  });
  form.elements[`title_${ids[0]}`].value = 'Latest edit';
  buttons[0].onclick();
  assert.equal(previews[3].title, 'Latest edit');
  await form.onsubmit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].method, 'PUT');
  assert.equal(saves[0].route, '/admin/legal-documents');
  assert.equal(saves[0].body.documents[0].title, 'Latest edit');
});
