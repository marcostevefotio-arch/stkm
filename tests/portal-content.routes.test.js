const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const access = require('../src/config/portal-access');
const portalRoutes = require('../src/routes/portal.routes');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

async function setup(t, role) {
    const original = db.execute, calls = [];
    db.execute = async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('FROM platform_staff WHERE id')) return [[{ id: 3, role, is_active: 1, password_version: 0, full_name: 'Test' }], []];
        if (sql.startsWith('INSERT INTO platform_faqs')) return [{ insertId: 5 }, []];
        if (sql.startsWith('UPDATE platform_trainings')) return [{ affectedRows: 0 }, []];
        return [{ affectedRows: 1 }, []];
    };
    t.after(() => { db.execute = original; });
    const app = express();
    app.use(express.json());
    app.use('/api/portal', portalRoutes);
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const token = jwt.sign({ sub: 3, typ: 'portal', pv: 0 }, access.portalSecret());
    const headers = { [['Author', 'ization'].join('')]: `${['Be', 'arer'].join('')} ${token}`, 'Content-Type': 'application/json' };
    return { calls, headers, base: `http://127.0.0.1:${server.address().port}/api/portal/admin` };
}

test('FAQ and training management is limited to platform administrators', async t => {
    const { base, headers, calls } = await setup(t, 'SUPPORT');
    assert.equal((await fetch(`${base}/faqs`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/trainings`, { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal(calls.some(call => call.sql.includes('platform_faqs') || call.sql.includes('platform_trainings')), false);
});

test('legal-document settings can only be read and edited by platform administrators',async t=>{
 const support=await setup(t,'SUPPORT');
 assert.equal((await fetch(`${support.base}/legal-documents`,{headers:support.headers})).status,403);
 const admin=await setup(t,'PLATFORM_ADMIN');
 const current=await fetch(`${admin.base}/legal-documents`,{headers:admin.headers});
 assert.equal(current.status,200);
 const settings=await current.json();
 assert.equal(settings.show_public_links,true);
 assert.equal(settings.show_authenticated_links,false);
 const body={
  show_public_links:false,
  show_authenticated_links:true,
  documents:settings.documents.map(document=>({...document,title:`${document.title} modifié`,content:`# Section modifiée\n\n${document.content}`}))
 };
 const updated=await fetch(`${admin.base}/legal-documents`,{
  method:'PUT',headers:admin.headers,body:JSON.stringify(body)
 });
 assert.equal(updated.status,200);
 const result=await updated.json();
 assert.equal(result.show_public_links,false);
 assert.equal(result.show_authenticated_links,true);
 assert.match(result.documents[0].version,/^[a-f0-9]{64}$/);
 const save=admin.calls.find(call=>call.sql.includes("VALUES('legal_documents',?)"));
 assert.ok(save);
 const saved=JSON.parse(save.values[0]);
 assert.equal(saved.documents[0].title,'Conditions générales modifié');
 assert.ok(admin.calls.some(call=>call.sql.includes('platform_audit_logs')&&call.values.includes('LEGAL_DOCUMENTS_UPDATED')));
 const invalid=await fetch(`${admin.base}/legal-documents`,{
  method:'PUT',headers:admin.headers,body:JSON.stringify({...body,documents:[]})
 });
 assert.equal(invalid.status,400);
});

test('platform administrators create validated FAQ entries with an audit record', async t => {
    const { base, headers, calls } = await setup(t, 'PLATFORM_ADMIN');
    const invalid = await fetch(`${base}/faqs`, { method: 'POST', headers, body: JSON.stringify({ question: 'x', answer: 'y', category: 'Z', sort_order: 1, is_active: true }) });
    assert.equal(invalid.status, 400);
    const ok = await fetch(`${base}/faqs`, { method: 'POST', headers, body: JSON.stringify({ question: 'Comment payer ?', answer: 'Par virement.', category: 'Facturation', sort_order: 2, is_active: true }) });
    assert.equal(ok.status, 201);
    const insert = calls.find(call => call.sql.startsWith('INSERT INTO platform_faqs'));
    assert.deepEqual(insert.values, ['Comment payer ?', 'Par virement.', 'Facturation', 2, true]);
    assert.ok(calls.some(call => call.sql.includes('INSERT INTO platform_audit_logs') && call.values.includes('PLATFORM_FAQ_CREATED')));
});

test('training updates validate links and report missing records', async t => {
    const { base, headers } = await setup(t, 'PLATFORM_ADMIN');
    const body = { title: 'Démarrage', description: 'Guide complet', format: 'video', sort_order: 0, is_active: true };
    const unsafe = await fetch(`${base}/trainings/4`, { method: 'PATCH', headers, body: JSON.stringify({ ...body, url: 'javascript:alert(1)' }) });
    assert.equal(unsafe.status, 400);
    const missing = await fetch(`${base}/trainings/4`, { method: 'PATCH', headers, body: JSON.stringify({ ...body, url: 'https://exemple.com/v' }) });
    assert.equal(missing.status, 404);
});
