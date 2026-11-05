const r=require('express').Router();
const db=require('../config/database');
const QR=require('qrcode');
const fs=require('fs/promises');
const path=require('path');
const {randomUUID}=require('crypto');
const patientCode=require('../services/patient-code.service');

const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const logoDirectory=path.join(__dirname,'../../public/uploads/logos');
const backupTables=[
 {name:'organization_settings',sql:'SELECT * FROM organization_settings WHERE organization_id=?'},
 {name:'notifications',sql:'SELECT * FROM notifications WHERE organization_id=?'},
 {name:'notification_reads',sql:'SELECT nr.* FROM notification_reads nr JOIN notifications n ON n.id=nr.notification_id WHERE n.organization_id=?'},
 {name:'products',sql:'SELECT * FROM products WHERE organization_id=?'},
 {name:'suppliers',sql:'SELECT * FROM suppliers WHERE organization_id=?'},
 {name:'patients',sql:'SELECT * FROM patients WHERE organization_id=?'},
 {name:'insurers',sql:'SELECT * FROM insurers WHERE organization_id=?'},
 {name:'purchase_orders',sql:'SELECT * FROM purchase_orders WHERE organization_id=?'},
 {name:'purchase_order_items',sql:'SELECT i.* FROM purchase_order_items i JOIN purchase_orders o ON o.id=i.purchase_order_id WHERE o.organization_id=?'},
 {name:'patient_medical_history',sql:'SELECT * FROM patient_medical_history WHERE organization_id=?'},
 {name:'patient_insurance_coverages',sql:'SELECT * FROM patient_insurance_coverages WHERE organization_id=?'},
 {name:'stock_movements',sql:'SELECT * FROM stock_movements WHERE organization_id=?'},
 {name:'sales_invoices',sql:'SELECT * FROM sales_invoices WHERE organization_id=?'},
 {name:'sales_invoice_prescriptions',sql:'SELECT p.* FROM sales_invoice_prescriptions p JOIN sales_invoices i ON i.id=p.invoice_id WHERE i.organization_id=?'},
 {name:'sales_invoice_items',sql:'SELECT i.* FROM sales_invoice_items i JOIN sales_invoices s ON s.id=i.invoice_id WHERE s.organization_id=?'},
 {name:'sales_payments',sql:'SELECT p.* FROM sales_payments p JOIN sales_invoices i ON i.id=p.invoice_id WHERE i.organization_id=?'},
 {name:'cash_sessions',sql:'SELECT * FROM cash_sessions WHERE organization_id=?'},
 {name:'cash_movements',sql:'SELECT * FROM cash_movements WHERE organization_id=?'},
 {name:'sales_returns',sql:'SELECT r.* FROM sales_returns r JOIN sales_invoices i ON i.id=r.invoice_id WHERE i.organization_id=?'},
 {name:'sales_return_items',sql:'SELECT ri.* FROM sales_return_items ri JOIN sales_returns r ON r.id=ri.return_id JOIN sales_invoices i ON i.id=r.invoice_id WHERE i.organization_id=?'},
 {name:'audit_logs',sql:'SELECT * FROM audit_logs WHERE organization_id=?'},
 {name:'support_tickets',sql:'SELECT * FROM support_tickets WHERE organization_id=?'},
 {name:'support_ticket_messages',sql:'SELECT * FROM support_ticket_messages WHERE organization_id=?'}
];
const searchIndexes={
 products:['uq_product_sku_tenant','idx_product_tenant_name','idx_product_barcode'],
 stock_movements:['idx_moves_tenant_date'],
 suppliers:['idx_suppliers_tenant_name'],
 purchase_orders:['idx_purchase_tenant_date','idx_purchase_tenant_status'],
 patients:['uq_patient_code_tenant','idx_patients_tenant_name'],
 insurers:['idx_insurers_tenant_name'],
 sales_invoices:['uq_sales_invoice_number','idx_sales_invoice_tenant_date','idx_sales_invoice_patient','idx_sales_invoice_status']
};
const backupReferences={
 notifications:{created_by:'users',recipient_user_id:'users'},
 notification_reads:{notification_id:'notifications',user_id:'users'},
 purchase_orders:{supplier_id:'suppliers',created_by:'users'},
 purchase_order_items:{purchase_order_id:'purchase_orders',product_id:'products'},
 patient_medical_history:{patient_id:'patients',recorded_by:'users'},
 patient_insurance_coverages:{patient_id:'patients',insurer_id:'insurers'},
 stock_movements:{product_id:'products',user_id:'users'},
 sales_invoices:{patient_id:'patients',created_by:'users'},
 sales_invoice_prescriptions:{invoice_id:'sales_invoices',captured_by:'users'},
 sales_invoice_items:{invoice_id:'sales_invoices',product_id:'products'},
 sales_payments:{invoice_id:'sales_invoices',insurer_id:'insurers',recorded_by:'users'},
 cash_sessions:{opened_by:'users',closed_by:'users'},
 cash_movements:{session_id:'cash_sessions',invoice_id:'sales_invoices',recorded_by:'users'},
 sales_returns:{invoice_id:'sales_invoices',insurer_id:'insurers',recorded_by:'users'},
 sales_return_items:{return_id:'sales_returns',invoice_item_id:'sales_invoice_items'},
 audit_logs:{user_id:'users'},
 support_tickets:{user_id:'users'},
 support_ticket_messages:{ticket_id:'support_tickets',user_id:'users'}
};
const isAdministrator=req=>['OWNER','ADMIN'].includes(req.user?.role);
const normalizeBackup=value=>{
 if(Buffer.isBuffer(value))return {$binary:value.toString('base64')};
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value))return value.map(normalizeBackup);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,normalizeBackup(item)]));
 return value;
};
const restoreBackupValue=value=>{
 if(Array.isArray(value))return value.map(restoreBackupValue);
 if(value&&typeof value==='object'){
  const keys=Object.keys(value);
  if(keys.length===1&&keys[0]==='$binary'){
   if(typeof value.$binary!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$binary))throw Object.assign(Error('Le fichier de sauvegarde contient une pièce binaire invalide.'),{status:400});
   return Buffer.from(value.$binary,'base64');
  }
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,restoreBackupValue(item)]));
 }
 return value;
};
const canonicalValue=value=>{
 if(Buffer.isBuffer(value))return `binary:${value.toString('base64')}`;
 if(value instanceof Date)return value.toISOString();
 if(typeof value==='string'&&/^[\[{]/.test(value)){
  try{return JSON.stringify(JSON.parse(value));}catch{}
 }
 if(value&&typeof value==='object')return JSON.stringify(value);
 return value;
};
const sameBackupRow=(left,right,columns)=>columns.every(column=>canonicalValue(left[column])===canonicalValue(right[column]));
const logoTypes={
 'image/png':{extension:'png',matches:buffer=>buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))},
 'image/jpeg':{extension:'jpg',matches:buffer=>buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff},
 'image/gif':{extension:'gif',matches:buffer=>buffer.subarray(0,3).toString('ascii')==='GIF'},
 'image/webp':{extension:'webp',matches:buffer=>buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP'}
};

r.get('/',async(req,res,next)=>{
 try{
  const [settings]=await db.execute(
   `SELECT s.display_name,s.logo_url,s.primary_color,s.secondary_color,s.locale,s.currency,s.timezone,s.date_format,s.sales_tax_rate,s.qr_format,s.barcode_format,   s.default_label_format,s.patient_code_mode,s.patient_code_format,
    o.name company_name,o.address company_address,o.phone company_phone,o.slogan company_slogan,o.email company_email
    FROM organizations o LEFT JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=?`,
   [req.tenantId]
  );
  res.json(settings[0]||{});
 }catch(error){next(error);}
});

r.get('/backup',async(req,res,next)=>{
 let connection;
 try{
  if(!isAdministrator(req))return res.status(403).json({error:'Seuls les propriétaires et administrateurs peuvent créer une sauvegarde.'});
  connection=await db.getConnection();
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.beginTransaction();
  const tables={};
  let total=0;
  for(const spec of backupTables){
   const [rows]=await connection.execute(spec.sql,[req.tenantId]);
   total+=rows.length;
   if(total>10000){await connection.rollback();connection.release();connection=null;return res.status(413).json({error:'La sauvegarde dépasse la limite de 10 000 enregistrements.'});}
   tables[spec.name]=rows.map(normalizeBackup);
  }
  const [[organization]]=await connection.execute('SELECT name,address,phone,slogan,email FROM organizations WHERE id=?',[req.tenantId]);
  const payload={format:'redams-tenant-backup',version:1,organization_id:req.tenantId,created_at:new Date().toISOString(),organization:normalizeBackup(organization),tables};
  const output=JSON.stringify(payload);
  if(Buffer.byteLength(output,'utf8')>25*1024*1024){await connection.rollback();connection.release();connection=null;return res.status(413).json({error:'La sauvegarde dépasse la limite de 25 Mo.'});}
  await connection.commit();connection.release();connection=null;
  res.set('Content-Type','application/json; charset=utf-8');
  res.set('Content-Disposition',`attachment; filename="redams-backup-${req.tenantId}-${new Date().toISOString().slice(0,10)}.json"`);
  res.send(output);
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  next(error);
 }
});

r.post('/backup',async(req,res,next)=>{
 if(!isAdministrator(req))return res.status(403).json({error:'Seuls les propriétaires et administrateurs peuvent restaurer une sauvegarde.'});
 const payload=req.body;
 if(!payload||payload.format!=='redams-tenant-backup'||payload.version!==1||Number(payload.organization_id)!==Number(req.tenantId)||!payload.tables||typeof payload.tables!=='object'||Array.isArray(payload.tables))return res.status(400).json({error:'Fichier invalide ou appartenant à un autre établissement.'});
 const allowedTables=new Set(backupTables.map(table=>table.name));
 if(Object.keys(payload.tables).some(table=>!allowedTables.has(table)))return res.status(400).json({error:'La sauvegarde contient une table non autorisée.'});
 let connection;
 try{
  const tables=restoreBackupValue(payload.tables),total=Object.values(tables).reduce((count,rows)=>count+(Array.isArray(rows)?rows.length:10001),0);
  if(total>10000)return res.status(400).json({error:'La sauvegarde dépasse la limite de 10 000 enregistrements.'});
  connection=await db.getConnection();await connection.beginTransaction();
  const primaryKeys=new Map(),tableColumns=new Map();
  for(const spec of backupTables){
   const [metadata]=await connection.execute(
    'SELECT COLUMN_NAME,COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',
    [spec.name]
   );
   const columns=metadata.map(column=>column.COLUMN_NAME),primary=metadata.filter(column=>column.COLUMN_KEY==='PRI').map(column=>column.COLUMN_NAME);
   if(!columns.length||!primary.length)throw Error(`La table de sauvegarde ${spec.name} n’est pas disponible.`);
   tableColumns.set(spec.name,new Set(columns));primaryKeys.set(spec.name,primary);
   if(tables[spec.name]!==undefined&&!Array.isArray(tables[spec.name]))throw Object.assign(Error(`Les données de la table ${spec.name} sont invalides.`),{status:400});
   for(const row of tables[spec.name]||[]){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(column=>!columns.includes(column)))throw Object.assign(Error(`Une ligne de la table ${spec.name} contient des champs inconnus.`),{status:400});
    if(Object.hasOwn(row,'organization_id')&&Number(row.organization_id)!==Number(req.tenantId))throw Object.assign(Error('La sauvegarde contient des données d’un autre établissement.'),{status:403});
    if(primary.some(column=>row[column]===null||row[column]===undefined))throw Object.assign(Error(`Une clé primaire est manquante dans ${spec.name}.`),{status:400});
   }
  }

  const idTables=['users','products','suppliers','purchase_orders','patients','insurers','sales_invoices','cash_sessions','notifications','support_tickets'];
  const validIds=new Map(idTables.map(table=>[table,new Set()]));
  for(const table of idTables){
   const [rows]=await connection.execute(`SELECT id FROM \`${table}\` WHERE organization_id=?`,[req.tenantId]);
   for(const row of rows)validIds.get(table).add(String(row.id));
  }
  for(const [table,sql] of [
   ['sales_invoice_items','SELECT item.id FROM sales_invoice_items item JOIN sales_invoices invoice ON invoice.id=item.invoice_id WHERE invoice.organization_id=?'],
   ['sales_returns','SELECT ret.id FROM sales_returns ret JOIN sales_invoices invoice ON invoice.id=ret.invoice_id WHERE invoice.organization_id=?']
  ]){
   const [rows]=await connection.execute(sql,[req.tenantId]);validIds.set(table,new Set(rows.map(row=>String(row.id))));
  }
  for(const [table,rows] of Object.entries(tables)){
   const primary=primaryKeys.get(table);
   if(primary.length===1&&validIds.has(table))for(const row of rows||[])validIds.get(table).add(String(row[primary[0]]));
  }
  for(const [table,refs] of Object.entries(backupReferences))for(const row of tables[table]||[]){
   for(const [column,parent] of Object.entries(refs)){
    const value=row[column];
    if(value===null||value===undefined)continue;
    if(!validIds.has(parent)||!validIds.get(parent).has(String(value)))throw Object.assign(Error(`Une référence de ${table} pointe vers un élément absent de cet établissement.`),{status:400});
   }
  }

  let inserted=0,existing=0;
  for(const spec of backupTables){
   const table=spec.name,columns=tableColumns.get(table),primary=primaryKeys.get(table);
   for(const row of tables[table]||[]){
    const names=Object.keys(row);
    if(!names.length)throw Object.assign(Error(`Une ligne de ${table} est vide.`),{status:400});
    const where=primary.map(column=>`\`${column}\`=?`).join(' AND ');
    const [found]=await connection.execute(`SELECT * FROM \`${table}\` WHERE ${where} FOR UPDATE`,primary.map(column=>row[column]));
    if(found.length){
     if(table==='organization_settings'||sameBackupRow(found[0],row,names)){existing+=1;continue;}
     throw Object.assign(Error(`Conflit de données dans ${table} (identifiant ${primary.map(column=>row[column]).join('/')}). Aucune donnée n’a été importée.`),{status:409});
    }
    const insert=`INSERT INTO \`${table}\`(${names.map(column=>`\`${column}\``).join(',')}) VALUES(${names.map(()=>'?').join(',')})`;
    try{await connection.execute(insert,names.map(column=>row[column]));inserted+=1;}
    catch(error){
     if(error.code==='ER_DUP_ENTRY')throw Object.assign(Error(`Conflit avec une valeur déjà présente dans ${table}. Aucune donnée n’a été importée.`),{status:409});
     throw error;
    }
   }
  }
  await connection.execute(
   'INSERT INTO audit_logs(organization_id,user_id,action,entity_type,details_json) VALUES(?,?,?,?,?)',
   [req.tenantId,req.user.id,'BACKUP_MERGED','backup',JSON.stringify({inserted,already_present:existing})]
  );
  await connection.commit();connection.release();connection=null;
  res.json({message:'Restauration fusionnée terminée.',inserted,already_present:existing});
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  if(error.status)return res.status(error.status).json({error:error.message});
  if(['ER_NO_REFERENCED_ROW_2','ER_DATA_TOO_LONG','ER_BAD_NULL_ERROR','ER_TRUNCATED_WRONG_VALUE','WARN_DATA_OUT_OF_RANGE'].includes(error.code))return res.status(400).json({error:'La sauvegarde contient une valeur ou une référence incompatible avec le schéma actuel.'});
  next(error);
 }
});

r.get('/search-index',async(req,res,next)=>{
 try{
  if(!isAdministrator(req))return res.status(403).json({error:'Seuls les propriétaires et administrateurs peuvent consulter les index.'});
  const tableNames=Object.keys(searchIndexes),placeholders=tableNames.map(()=>'?').join(',');
  const [rows]=await db.execute(
   `SELECT TABLE_NAME,INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,
   tableNames
  );
  const present=new Map(tableNames.map(table=>[table,new Set()]));
  for(const row of rows)present.get(row.TABLE_NAME)?.add(row.INDEX_NAME);
  res.json(Object.entries(searchIndexes).map(([table,indexes])=>({table,indexes:indexes.map(name=>({name,available:present.get(table)?.has(name)||false}))})));
 }catch(error){next(error);}
});

r.post('/search-index/analyze',async(req,res,next)=>{
 try{
  if(!isAdministrator(req))return res.status(403).json({error:'Seuls les propriétaires et administrateurs peuvent analyser les index.'});
  const results=[];
  for(const table of Object.keys(searchIndexes)){
   const [rows]=await db.query(`ANALYZE TABLE \`${table}\``);
   results.push({table,status:rows[0]?.Msg_text||'Analysé'});
  }
  res.json({message:'Statistiques des index actualisées.',results});
 }catch(error){next(error);}
});

r.put('/company',async(req,res,next)=>{
 try{
  if(!isAdministrator(req))return res.status(403).json({error:'Seuls les propriétaires et administrateurs peuvent modifier les informations de l’entreprise.'});
  const body=req.body||{};
  const company={
   name:typeof body.name==='string'?body.name.trim():'',
   address:typeof body.address==='string'?body.address.trim():'',
   phone:typeof body.phone==='string'?body.phone.trim():'',
   slogan:typeof body.slogan==='string'?body.slogan.trim():'',
   email:typeof body.email==='string'?body.email.trim().toLowerCase():''
  };
  if(!company.name||company.name.length>180)return res.status(400).json({error:'Le nom de l’entreprise est requis et ne doit pas dépasser 180 caractères.'});
  if(company.address.length>65535||company.phone.length>50||company.slogan.length>255||company.email.length>190)return res.status(400).json({error:'Une des informations de l’entreprise dépasse la longueur autorisée.'});
  if(company.email&&!emailPattern.test(company.email))return res.status(400).json({error:'L’adresse e-mail de l’entreprise est invalide.'});
  await db.execute('UPDATE organizations SET name=?,address=?,phone=?,slogan=?,email=? WHERE id=?',[company.name,company.address||null,company.phone||null,company.slogan||null,company.email||null,req.tenantId]);
  res.json({message:'Informations de l’entreprise enregistrées.'});
 }catch(error){next(error);}
});

r.post('/logo',async(req,res,next)=>{
 let savedPath;
 try{
  if(!isAdministrator(req))return res.status(403).json({error:'Seuls les propriétaires et administrateurs peuvent modifier le logo.'});
  const match=typeof req.body?.data_url==='string'&&req.body.data_url.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)return res.status(400).json({error:'Choisissez une image PNG, JPEG, GIF ou WebP valide.'});
  const mime=match[1],image=Buffer.from(match[2],'base64'),type=logoTypes[mime];
  if(!image.length||image.length>2*1024*1024)return res.status(400).json({error:'Le logo doit peser au maximum 2 Mo.'});
  if(!type.matches(image))return res.status(400).json({error:'Le contenu du fichier ne correspond pas à son format d’image.'});
  await fs.mkdir(logoDirectory,{recursive:true});
  const filename=`organization-${req.tenantId}-${randomUUID()}.${type.extension}`;
  savedPath=path.join(logoDirectory,filename);
  await fs.writeFile(savedPath,image,{flag:'wx'});
  const logoUrl=`/uploads/logos/${filename}`;
  await db.execute(
   'INSERT INTO organization_settings(organization_id,logo_url) VALUES(?,?) ON DUPLICATE KEY UPDATE logo_url=VALUES(logo_url)',
   [req.tenantId,logoUrl]
  );
  res.json({message:'Logo enregistré.',logo_url:logoUrl});
 }catch(error){
  if(savedPath){
   try{await fs.unlink(savedPath);}
   catch(cleanupError){console.error('Impossible de supprimer le fichier logo temporaire.',cleanupError);}
  }
  next(error);
 }
});

r.put('/',async(req,res,next)=>{
 try{
  if(!isAdministrator(req))return res.status(403).json({error:'Seuls les propriétaires et administrateurs peuvent modifier les paramètres.'});
  const allowed=['display_name','primary_color','secondary_color','locale','currency','timezone','date_format','sales_tax_rate','qr_format','barcode_format','default_label_format','patient_code_mode','patient_code_format'];
  const d=Object.fromEntries(Object.entries(req.body||{}).filter(([key])=>allowed.includes(key)));
  if(Object.hasOwn(d,'default_label_format')&&!['barcode','qr'].includes(d.default_label_format))return res.status(400).json({error:'Le format d’étiquette par défaut doit être code-barres ou QR.'});
  if(Object.hasOwn(d,'patient_code_mode')&&!patientCode.MODES.has(d.patient_code_mode))return res.status(400).json({error:'Le mode de saisie du code patient est invalide.'});
  if(Object.hasOwn(d,'patient_code_format')){
   d.patient_code_format=typeof d.patient_code_format==='string'?d.patient_code_format.trim():d.patient_code_format;
   const formatError=patientCode.validateFormat(d.patient_code_format);
   if(formatError)return res.status(400).json({error:formatError});
  }
  if(Object.prototype.hasOwnProperty.call(d,'sales_tax_rate')){
   const raw=d.sales_tax_rate,rate=Number(raw);
   if((typeof raw!=='number'&&typeof raw!=='string')||(typeof raw==='string'&&!raw.trim())||!Number.isFinite(rate)||rate<0||rate>100||Math.abs(rate*100-Math.round(rate*100))>1e-7)return res.status(400).json({error:'Le taux de taxe doit être compris entre 0 et 100 %, avec deux décimales maximum.'});
   d.sales_tax_rate=rate;
  }
  const keys=Object.keys(d);
  if(!keys.length)return res.status(400).json({error:'Aucun paramètre reconnu.'});
  await db.execute(
   `INSERT INTO organization_settings(organization_id,${keys.join(',')}) VALUES(?,${keys.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${keys.map(key=>`${key}=VALUES(${key})`).join(',')}`,
   [req.tenantId,...Object.values(d)]
  );
  res.json({message:'Paramètres enregistrés.'});
 }catch(error){next(error);}
});

r.get('/qr/:text',async(req,res,next)=>{
 try{res.type('png').send(await QR.toBuffer(String(req.params.text).slice(0,500),{width:300,margin:2}));}
 catch(error){next(error);}
});

module.exports=r;
