const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const settingsRoutes=require('../src/routes/settings.routes');
const fs=require('node:fs/promises');
const path=require('node:path');

async function listen(t,role='ADMIN'){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:7,role};next();});
 app.use('/api/settings',settingsRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/settings`;
}

test('sales tax settings reject rates outside 0-100 before database access',async(t)=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;throw Error('Database should not be called');};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t);
 const response=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sales_tax_rate:100.01})});
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/0 et 100/);
 assert.equal(calls,0);
});

test('company profile validates and saves the separate organization fields',async(t)=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{queries.push({sql,values});return [{affectedRows:1},[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t);
 const response=await fetch(`${url}/company`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Clinique Test',address:'Rue du Centre',phone:'+237 600 000 000',slogan:'Votre santé avant tout',email:'contact@example.com'})});
 assert.equal(response.status,200);
 assert.match(queries[0].sql,/UPDATE organizations SET name=\?,address=\?,phone=\?,slogan=\?,email=\? WHERE id=\?/);
 assert.deepEqual(queries[0].values,['Clinique Test','Rue du Centre','+237 600 000 000','Votre santé avant tout','contact@example.com',42]);
});

test('company profile rejects invalid email and prevents viewers from editing',async(t)=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;return [{affectedRows:1},[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t);
 const invalidEmail=await fetch(`${url}/company`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Clinique Test',email:'adresse-invalide'})});
 assert.equal(invalidEmail.status,400);
 assert.match((await invalidEmail.json()).error,/e-mail/);
 const viewerUrl=await listen(t,'VIEWER');
 const forbidden=await fetch(`${viewerUrl}/company`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Clinique Test'})});
 assert.equal(forbidden.status,403);
 assert.equal(calls,0);
});

test('logo upload rejects a file whose bytes do not match its image type',async(t)=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;return [{affectedRows:1},[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t);
 const response=await fetch(`${url}/logo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_url:'data:image/png;base64,dGVzdA=='})});
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/ne correspond pas/);
 assert.equal(calls,0);
});

test('logo upload saves the file and its tenant-scoped URL',async(t)=>{
 const originalExecute=db.execute;let savedLogoUrl;
 db.execute=async(sql,values)=>{savedLogoUrl=values[1];return [{affectedRows:1},[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t),pngHeader=Buffer.from([137,80,78,71,13,10,26,10]);
 const response=await fetch(`${url}/logo`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_url:`data:image/png;base64,${pngHeader.toString('base64')}`})});
 const result=await response.json();
 assert.equal(response.status,200);
 assert.match(result.logo_url,/^\/uploads\/logos\/organization-42-[\da-f-]+\.png$/);
 assert.equal(savedLogoUrl,result.logo_url);
 const savedPath=path.join(__dirname,'..','public','uploads','logos',path.basename(result.logo_url));
 t.after(async()=>{await fs.unlink(savedPath);});
 assert.deepEqual(await fs.readFile(savedPath),pngHeader);
});

test('label preference only accepts QR or Code 128 and is persisted',async(t)=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{queries.push({sql,values});return [{affectedRows:1},[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t);
 const invalid=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({default_label_format:'unknown'})});
 assert.equal(invalid.status,400);
 const valid=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({default_label_format:'qr'})});
 assert.equal(valid.status,200);
 assert.match(queries[0].sql,/default_label_format/);
 assert.deepEqual(queries[0].values,[42,'qr']);
});

test('backup and index tools deny non-admin roles and reject cross-tenant restores',async(t)=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;throw Error('Database should not be reached');};
 t.after(()=>{db.execute=originalExecute;});
 const viewerUrl=await listen(t,'VIEWER');
 const deniedBackup=await fetch(`${viewerUrl}/backup`);
 assert.equal(deniedBackup.status,403);
 const deniedIndexes=await fetch(`${viewerUrl}/search-index`);
 assert.equal(deniedIndexes.status,403);
 const adminUrl=await listen(t);
 const crossTenant=await fetch(`${adminUrl}/backup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:'redams-tenant-backup',version:1,organization_id:99,tables:{}})});
 assert.equal(crossTenant.status,400);
 assert.equal(calls,0);
});

test('tenant backup merge inserts a missing record in one transaction',async t=>{
 const originalGetConnection=db.getConnection;
 let inserted=0,committed=false,rolledBack=false;
 const primaryByTable={organization_settings:['organization_id'],notification_reads:['notification_id','user_id'],sales_invoice_prescriptions:['invoice_id']};
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{rolledBack=true;},
  release:()=>{},
  execute:async(sql,values)=>{
   if(sql.includes('information_schema.COLUMNS')){
    const table=values[0],primary=primaryByTable[table]||['id'];
    const columns=table==='products'?['id','organization_id','sku','name']:table==='organization_settings'?['organization_id','display_name']:primary;
    return [columns.map(name=>({COLUMN_NAME:name,COLUMN_KEY:primary.includes(name)?'PRI':''})),[]];
   }
   if(sql.startsWith('SELECT id FROM')||sql.includes('SELECT item.id FROM')||sql.includes('SELECT ret.id FROM'))return [[],[]];
   if(sql.startsWith('SELECT * FROM'))return [[],[]];
   if(sql.startsWith('INSERT INTO `products`')){inserted+=1;return [{affectedRows:1},[]];}
   if(sql.startsWith('INSERT INTO audit_logs'))return [{affectedRows:1},[]];
   throw Error(`Unexpected SQL: ${sql}`);
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const response=await fetch(`${url}/backup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:'redams-tenant-backup',version:1,organization_id:42,tables:{products:[{id:101,organization_id:42,sku:'TEST-101',name:'Produit test'}]}})});
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{message:'Restauration fusionnée terminée.',inserted:1,already_present:0});
 assert.equal(inserted,1);
 assert.equal(committed,true);
 assert.equal(rolledBack,false);
});

test('tenant backup merge rejects references outside the tenant and rolls back',async t=>{
 const originalGetConnection=db.getConnection;
 let inserted=0,rolledBack=false;
 const primaryByTable={organization_settings:['organization_id'],notification_reads:['notification_id','user_id'],sales_invoice_prescriptions:['invoice_id']};
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{},
  rollback:async()=>{rolledBack=true;},
  release:()=>{},
  execute:async(sql,values)=>{
   if(sql.includes('information_schema.COLUMNS')){
    const table=values[0],primary=primaryByTable[table]||['id'];
    const columns=table==='stock_movements'?['id','organization_id','product_id','user_id']:primary;
    return [columns.map(name=>({COLUMN_NAME:name,COLUMN_KEY:primary.includes(name)?'PRI':''})),[]];
   }
   if(sql.startsWith('SELECT id FROM')||sql.includes('SELECT item.id FROM')||sql.includes('SELECT ret.id FROM'))return [[],[]];
   if(sql.startsWith('SELECT * FROM'))return [[],[]];
   if(sql.startsWith('INSERT INTO')){inserted+=1;return [{affectedRows:1},[]];}
   throw Error(`Unexpected SQL: ${sql}`);
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const response=await fetch(`${url}/backup`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:'redams-tenant-backup',version:1,organization_id:42,tables:{stock_movements:[{id:4,organization_id:42,product_id:999,user_id:888}]}})});
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/référence/);
 assert.equal(inserted,0);
 assert.equal(rolledBack,true);
});

test('tenant backup export is consistent and serializes prescription images',async t=>{
 const originalGetConnection=db.getConnection;
 let snapshotStarted=false,committed=false;
 db.getConnection=async()=>({
  query:async sql=>{if(sql==='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')snapshotStarted=true;return [[],[]];},
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   if(sql.includes('SELECT name,address,phone,slogan,email FROM organizations'))return [[{name:'Clinique Test',address:'Adresse',phone:null,slogan:null,email:null}],[]];
   if(sql.includes('sales_invoice_prescriptions'))return [[{invoice_id:17,mime_type:'image/png',image_data:Buffer.from('prescription')}],[]];
   return [[],[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t),response=await fetch(`${url}/backup`);
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-disposition'),/attachment; filename="redams-backup-42-/);
 const backup=await response.json();
 assert.equal(backup.organization_id,42);
 assert.match(backup.warnings[0],/ne contient pas les dossiers ni les écritures comptables/);
 assert.equal(backup.tables.accounting_books,undefined);
 assert.equal(backup.tables.accounting_entries,undefined);
 assert.equal(backup.organization.name,'Clinique Test');
 assert.deepEqual(backup.tables.sales_invoice_prescriptions[0].image_data,{$binary:Buffer.from('prescription').toString('base64')});
 assert.equal(snapshotStarted,true);
 assert.equal(committed,true);
});

test('index status reports missing indexes and refreshes the database statistics',async t=>{
 const originalExecute=db.execute,originalQuery=db.query;let analyzed=[];
 db.execute=async(sql,values)=>{
  assert.match(sql,/information_schema\.STATISTICS/);
  assert.ok(values.includes('products'));
  return [[{TABLE_NAME:'products',INDEX_NAME:'idx_product_barcode'}],[]];
 };
 db.query=async sql=>{analyzed.push(sql);return [[{Msg_text:'OK'}],[]];};
 t.after(()=>{db.execute=originalExecute;db.query=originalQuery;});
 const url=await listen(t);
 const response=await fetch(`${url}/search-index`);
 assert.equal(response.status,200);
 const indexes=await response.json();
 const productIndexes=indexes.find(group=>group.table==='products');
 assert.equal(productIndexes.indexes.find(index=>index.name==='idx_product_barcode').available,true);
 assert.equal(productIndexes.indexes.find(index=>index.name==='idx_product_tenant_name').available,false);
 const analyze=await fetch(`${url}/search-index/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
 assert.equal(analyze.status,200);
 assert.ok(analyzed.length>=6);
 assert.ok(analyzed.every(sql=>/^ANALYZE TABLE `[\w]+`$/.test(sql)));
});
