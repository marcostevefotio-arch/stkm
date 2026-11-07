const r=require('express').Router(),db=require('../config/database'),{audit}=require('../services/audit.service'),{requireRole}=require('../middleware/auth');
const canAccessPatientCoverage=requireRole('OWNER','ADMIN','PHARMACIST');
const canReadInsurers=requireRole('OWNER','ADMIN','PHARMACIST');
const canManageInsurers=requireRole('OWNER','ADMIN');
const {requireModuleAccess}=require('../middleware/module-access');
r.use(requireModuleAccess('patients'));
const fields={name:'name',contact_name:'contact_name',email:'email',phone:'phone',address:'address',notes:'notes'};
const coverageStatuses=new Set(['active','inactive']);
const insurerLengths={contact_name:180,email:190,phone:50,address:65535,notes:65535};
function validDate(value){
 if(value===undefined||value===null||value==='')return true;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(`${value}T00:00:00.000Z`);
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function validateCoverage(body,{partial=false}={}){
 for(const field of ['patient_id','insurer_id'])if(!partial||Object.prototype.hasOwnProperty.call(body,field)){
  if(!Number.isSafeInteger(Number(body[field]))||Number(body[field])<=0)return 'Le patient et l’assureur sont obligatoires.';
 }
 if(!partial||Object.prototype.hasOwnProperty.call(body,'policy_number')){
  if(typeof body.policy_number!=='string'||!body.policy_number.trim()||body.policy_number.trim().length>120)return 'Le numéro de contrat est obligatoire (120 caractères maximum).';
 }
 for(const field of ['member_number'])if(Object.prototype.hasOwnProperty.call(body,field)&&body[field]!==null&&body[field]!==''&&(typeof body[field]!=='string'||body[field].length>120))return 'Le numéro d’adhérent est limité à 120 caractères.';
 for(const field of ['start_date','end_date'])if(Object.prototype.hasOwnProperty.call(body,field)&&!validDate(body[field]))return 'Une date de couverture est invalide.';
 if(body.start_date&&body.end_date&&body.start_date>body.end_date)return 'La fin de couverture doit être postérieure ou égale au début.';
 if(Object.prototype.hasOwnProperty.call(body,'coverage_percent')&&body.coverage_percent!==null&&body.coverage_percent!==''){
  const percent=Number(body.coverage_percent);
  if(!Number.isFinite(percent)||percent<0||percent>100)return 'Le taux de couverture doit être compris entre 0 et 100.';
 }
 if(Object.prototype.hasOwnProperty.call(body,'status')&&!coverageStatuses.has(body.status))return 'Le statut du contrat est invalide.';
 if(Object.prototype.hasOwnProperty.call(body,'notes')&&body.notes!==null&&body.notes!==''&&(typeof body.notes!=='string'||body.notes.length>65535))return 'Les notes sont trop longues.';
 return null;
}
function validateInsurer(body){
 for(const [field,limit] of Object.entries(insurerLengths)){
  const value=body[field];
  if(value!==undefined&&value!==null&&(typeof value!=='string'||value.length>limit))return `Le champ ${field} est invalide ou trop long.`;
 }
 if(body.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))return 'Le courriel de l’assureur est invalide.';
 return null;
}
async function validateCoverageRelations(connection,tenantId,patientId,insurerId,{allowArchivedInsurer=false,allowArchivedPatient=false}={}){
 const [[patientRows],[insurerRows]]=await Promise.all([
  connection.execute(`SELECT id FROM patients WHERE id=? AND organization_id=? ${allowArchivedPatient?'':'AND is_active=1'}`,[patientId,tenantId]),
  connection.execute(`SELECT id FROM insurers WHERE id=? AND organization_id=? ${allowArchivedInsurer?'':'AND is_active=1'}`,[insurerId,tenantId]),
 ]);
 return patientRows.length>0&&insurerRows.length>0;
}

r.get('/',canReadInsurers,async(req,res,next)=>{
 try{
  const includeArchived=req.query.includeArchived==='1',archiveFilter=includeArchived?'':'AND i.is_active=1';
  const [rows]=await db.execute(
    `SELECT i.id,i.name,i.contact_name,i.email,i.phone,i.address,i.notes,i.is_active,i.created_at,
            COUNT(DISTINCT c.id) coverage_count
     FROM insurers i LEFT JOIN patient_insurance_coverages c
       ON c.insurer_id=i.id AND c.organization_id=i.organization_id
     WHERE i.organization_id=? ${archiveFilter}
     GROUP BY i.id ORDER BY i.name`,
    [req.tenantId]
   );
  res.json(rows);
 }catch(error){next(error);}
});

r.post('/',canManageInsurers,async(req,res,next)=>{
 try{
  const body=req.body||{};
  if(Object.prototype.hasOwnProperty.call(body,'name')&&typeof body.name!=='string')return res.status(400).json({error:'Le nom de l’assureur doit être du texte.'});
  const name=String(body.name||'').trim(),validation=validateInsurer(body);
  if(!name||name.length>190)return res.status(400).json({error:'Le nom de l’assureur est obligatoire (190 caractères maximum).'});
  if(validation)return res.status(400).json({error:validation});
  const [result]=await db.execute(
   'INSERT INTO insurers(organization_id,name,contact_name,email,phone,address,notes) VALUES(?,?,?,?,?,?,?)',
   [req.tenantId,name,body.contact_name||null,body.email||null,body.phone||null,body.address||null,body.notes||null]
  );
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'INSURER_CREATED',entityType:'insurer',entityId:result.insertId});
  res.status(201).json({id:result.insertId,message:'Assureur créé.'});
 }catch(error){next(error);}
});

r.put('/:id',canManageInsurers,async(req,res,next)=>{
 try{
  const body=req.body||{},sets=[],values=[];
  if(Object.prototype.hasOwnProperty.call(body,'name')){
   if(typeof body.name!=='string')return res.status(400).json({error:'Le nom de l’assureur doit être du texte.'});
   const name=String(body.name||'').trim();
   if(!name||name.length>190)return res.status(400).json({error:'Le nom de l’assureur est obligatoire (190 caractères maximum).'});
   sets.push('name=?');values.push(name);
  }
  for(const field of ['contact_name','email','phone','address','notes'])if(Object.prototype.hasOwnProperty.call(body,field)){
   const value=body[field];
   if(value!==null&&value!==undefined&&typeof value!=='string')return res.status(400).json({error:`Le champ ${field} doit être du texte.`});
   sets.push(`${fields[field]}=?`);values.push(value||null);
  }
  const validation=validateInsurer(body);if(validation)return res.status(400).json({error:validation});
  if(!sets.length)return res.status(400).json({error:'Aucune modification à enregistrer.'});
  const [result]=await db.execute(`UPDATE insurers SET ${sets.join(',')} WHERE id=? AND organization_id=? AND is_active=1`,[...values,req.params.id,req.tenantId]);
  if(!result.affectedRows){
   const [rows]=await db.execute('SELECT id FROM insurers WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);
   if(!rows.length)return res.status(404).json({error:'Assureur introuvable.'});
  }
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'INSURER_UPDATED',entityType:'insurer',entityId:req.params.id});
  res.json({message:'Assureur modifié.'});
 }catch(error){next(error);}
});

r.delete('/:id',canManageInsurers,async(req,res,next)=>{
 try{
  const [result]=await db.execute('UPDATE insurers SET is_active=0 WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);
  if(!result.affectedRows)return res.status(404).json({error:'Assureur introuvable.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'INSURER_ARCHIVED',entityType:'insurer',entityId:req.params.id});
  res.json({message:'Assureur archivé.'});
 }catch(error){next(error);}
});

r.get('/coverages',canAccessPatientCoverage,async(req,res,next)=>{
 try{
  const includeInactive=req.query.includeInactive==='1',statusFilter=includeInactive?'':"AND c.status='active'";
  const [rows]=await db.execute(
   `SELECT c.id,c.patient_id,c.insurer_id,c.policy_number,c.member_number,c.start_date,c.end_date,
           c.coverage_percent,c.notes,c.status,c.created_at,p.patient_code,p.full_name patient_name,p.is_active patient_active,
           i.name insurer_name,i.is_active insurer_active
    FROM patient_insurance_coverages c
    JOIN patients p ON p.id=c.patient_id AND p.organization_id=c.organization_id
    JOIN insurers i ON i.id=c.insurer_id AND i.organization_id=c.organization_id
    WHERE c.organization_id=? ${statusFilter}
    ORDER BY p.full_name,c.start_date DESC,c.id DESC`,
   [req.tenantId]
  );
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_COVERAGES_VIEWED',entityType:'insurance_coverage'});
  res.json(rows);
 }catch(error){next(error);}
});

r.post('/coverages',canAccessPatientCoverage,async(req,res,next)=>{
 const body=req.body||{},validation=validateCoverage(body);
 if(validation)return res.status(400).json({error:validation});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const valid=await validateCoverageRelations(connection,req.tenantId,Number(body.patient_id),Number(body.insurer_id));
  if(!valid){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Patient ou assureur introuvable.'});}
  const [result]=await connection.execute(
   `INSERT INTO patient_insurance_coverages(organization_id,patient_id,insurer_id,policy_number,member_number,start_date,end_date,coverage_percent,notes)
    VALUES(?,?,?,?,?,?,?,?,?)`,
   [req.tenantId,Number(body.patient_id),Number(body.insurer_id),body.policy_number.trim(),body.member_number||null,body.start_date||null,body.end_date||null,body.coverage_percent===''||body.coverage_percent===undefined?null:body.coverage_percent,body.notes||null]
  );
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_COVERAGE_CREATED',entityType:'insurance_coverage',entityId:result.insertId});
  res.status(201).json({id:result.insertId,message:'Couverture enregistrée.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}next(error);}
});

r.put('/coverages/:id',canAccessPatientCoverage,async(req,res,next)=>{
 const body=req.body||{},validation=validateCoverage(body,{partial:true});
 if(validation)return res.status(400).json({error:validation});
 try{
  const [existingRows]=await db.execute(
   `SELECT id,patient_id,insurer_id,start_date,end_date
    FROM patient_insurance_coverages WHERE id=? AND organization_id=? AND status='active'`,
   [req.params.id,req.tenantId]
  );
  if(!existingRows.length)return res.status(404).json({error:'Couverture introuvable.'});
  const existing=existingRows[0],patientId=body.patient_id===undefined?Number(existing.patient_id):Number(body.patient_id),insurerId=body.insurer_id===undefined?Number(existing.insurer_id):Number(body.insurer_id);
  const merged={start_date:body.start_date===undefined?String(existing.start_date||'').slice(0,10):body.start_date,end_date:body.end_date===undefined?String(existing.end_date||'').slice(0,10):body.end_date};
  if(merged.start_date&&merged.end_date&&merged.start_date>merged.end_date)return res.status(400).json({error:'La fin de couverture doit être postérieure ou égale au début.'});
  if(Object.prototype.hasOwnProperty.call(body,'patient_id')||Object.prototype.hasOwnProperty.call(body,'insurer_id')){
   const connection=await db.getConnection();
   try{if(!await validateCoverageRelations(connection,req.tenantId,patientId,insurerId,{allowArchivedInsurer:insurerId===Number(existing.insurer_id),allowArchivedPatient:patientId===Number(existing.patient_id)}))return res.status(404).json({error:'Patient ou assureur introuvable.'});}
   finally{connection.release();}
  }
  const fields={patient_id:'patient_id',insurer_id:'insurer_id',policy_number:'policy_number',member_number:'member_number',start_date:'start_date',end_date:'end_date',coverage_percent:'coverage_percent',notes:'notes'};
  const sets=[],values=[];
  for(const field of Object.keys(fields))if(Object.prototype.hasOwnProperty.call(body,field)){
   const value=field==='policy_number'?body[field].trim():field==='coverage_percent'&&(body[field]===''||body[field]===null)?null:body[field]||null;
   sets.push(`${fields[field]}=?`);values.push(value);
  }
  if(!sets.length)return res.status(400).json({error:'Aucune modification à enregistrer.'});
  const [result]=await db.execute(`UPDATE patient_insurance_coverages SET ${sets.join(',')} WHERE id=? AND organization_id=? AND status='active'`,[...values,req.params.id,req.tenantId]);
  if(!result.affectedRows){
   const [rows]=await db.execute("SELECT id FROM patient_insurance_coverages WHERE id=? AND organization_id=? AND status='active'",[req.params.id,req.tenantId]);
   if(!rows.length)return res.status(404).json({error:'Couverture introuvable.'});
  }
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_COVERAGE_UPDATED',entityType:'insurance_coverage',entityId:req.params.id});
  res.json({message:'Couverture modifiée.'});
 }catch(error){next(error);}
});

r.delete('/coverages/:id',canAccessPatientCoverage,async(req,res,next)=>{
 try{
  const [result]=await db.execute("UPDATE patient_insurance_coverages SET status='inactive' WHERE id=? AND organization_id=? AND status='active'",[req.params.id,req.tenantId]);
  if(!result.affectedRows)return res.status(404).json({error:'Couverture introuvable.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_COVERAGE_ARCHIVED',entityType:'insurance_coverage',entityId:req.params.id});
  res.json({message:'Couverture archivée.'});
 }catch(error){next(error);}
});

module.exports=r;
