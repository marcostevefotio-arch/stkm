const r=require('express').Router(),db=require('../config/database'),{audit}=require('../services/audit.service'),{requireRole}=require('../middleware/auth'),patientCodes=require('../services/patient-code.service');
const genders=new Set(['F','M','OTHER','UNSPECIFIED']);
const historyStatuses=new Set(['ongoing','resolved','in_remission']);
const canAccessMedicalHistory=requireRole('OWNER','ADMIN','PHARMACIST');
const canManagePatients=requireRole('OWNER','ADMIN','PHARMACIST');
const lengths={phone:50,email:190,address:65535};
function validDate(value){
 if(value===undefined||value===null||value==='')return true;
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(`${value}T00:00:00.000Z`);
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
function validateContact(body){
 for(const [field,limit] of Object.entries(lengths)){
  const value=body[field];
  if(value!==undefined&&value!==null&&typeof value!=='string')return `Le champ ${field} doit être du texte.`;
  if(value!==undefined&&value!==null&&String(value).length>limit)return `Le champ ${field} dépasse la longueur autorisée.`;
 }
 if(body.email&& !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email)))return 'Le courriel est invalide.';
 return null;
}
function validateHistory(body,{partial=false}={}){
 if(!partial||Object.prototype.hasOwnProperty.call(body,'condition_name')){
  if(typeof body.condition_name!=='string'||!body.condition_name.trim()||body.condition_name.trim().length>190)return 'Le libellé de l’antécédent est obligatoire (190 caractères maximum).';
 }
 if(Object.prototype.hasOwnProperty.call(body,'condition_code')&&body.condition_code!==null&&body.condition_code!==''&&(typeof body.condition_code!=='string'||body.condition_code.length>80))return 'Le code clinique est limité à 80 caractères.';
 for(const field of ['start_date','end_date'])if(Object.prototype.hasOwnProperty.call(body,field)&&!validDate(body[field]))return `La date ${field==='start_date'?'de début':'de fin'} est invalide.`;
 if(body.start_date&&body.end_date&&body.start_date>body.end_date)return 'La date de fin doit être postérieure ou égale à la date de début.';
 if(Object.prototype.hasOwnProperty.call(body,'status')&&!historyStatuses.has(body.status))return 'Le statut de l’antécédent est invalide.';
 if(Object.prototype.hasOwnProperty.call(body,'notes')&&body.notes!==null&&body.notes!==''&&(typeof body.notes!=='string'||body.notes.length>65535))return 'Les notes sont trop longues.';
 return null;
}
function normalizeCondition(value){
 return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/g,' ').trim();
}
function historyMatches(current,previous){
 const currentName=normalizeCondition(current.condition_name);
 return previous.filter(record=>Number(record.id)!==Number(current.id)&&normalizeCondition(record.condition_name)===currentName);
}
async function findPatient(patientId,tenantId){
 const [rows]=await db.execute('SELECT id FROM patients WHERE id=? AND organization_id=?',[patientId,tenantId]);
 return rows[0]||null;
}

r.get('/',async(req,res,next)=>{
 try{
  const cashier=req.user.role==='CASHIER';
  if(!cashier&&!['OWNER','ADMIN','PHARMACIST'].includes(req.user.role))return res.status(403).json({error:'Permission insuffisante pour consulter les dossiers patients.'});
  const activeFilter=!cashier&&req.query.includeArchived==='1'?'':'AND is_active=1';
  const columns=cashier?'id,patient_code,full_name':'id,patient_code,full_name,birth_date,gender,phone,email,address,is_active,created_at';
  const [rows]=await db.execute(
   `SELECT ${columns}
    FROM patients WHERE organization_id=? ${activeFilter}
    ORDER BY full_name`,
   [req.tenantId]
  );
  res.json(rows);
 }catch(error){next(error);}
});

r.post('/',canManagePatients,async(req,res,next)=>{
 try{
  const body=req.body||{};
  if((body.patient_code!==undefined&&typeof body.patient_code!=='string')||(body.full_name!==undefined&&typeof body.full_name!=='string'))return res.status(400).json({error:'Le code patient et le nom complet doivent être du texte.'});
  const manualCode=String(body.patient_code||'').trim(),fullName=String(body.full_name||'').trim();
  if(!fullName)return res.status(400).json({error:'Le nom complet est obligatoire.'});
  if(manualCode.length>80||fullName.length>190)return res.status(400).json({error:'Le code ou le nom dépasse la longueur autorisée.'});
  if(!genders.has(body.gender||'UNSPECIFIED'))return res.status(400).json({error:'Le genre sélectionné est invalide.'});
  if(!validDate(body.birth_date))return res.status(400).json({error:'La date de naissance est invalide.'});
  const contactError=validateContact(body);if(contactError)return res.status(400).json({error:contactError});
  const codeSettings=await patientCodes.getCodeSettings(db,req.tenantId);
  if(codeSettings.mode==='manual'&&!manualCode)return res.status(400).json({error:'Le code patient est obligatoire.'});
  const insertSql='INSERT INTO patients(organization_id,patient_code,full_name,birth_date,gender,phone,email,address) VALUES(?,?,?,?,?,?,?,?)';
  const insertValues=code=>[req.tenantId,code,fullName,body.birth_date||null,body.gender||'UNSPECIFIED',body.phone||null,body.email||null,body.address||null];
  let result;
  if(codeSettings.mode==='auto'){
   const connection=await db.getConnection();
   try{
    await connection.beginTransaction();
    const code=await patientCodes.reserveCode(connection,req.tenantId);
    [result]=await connection.execute(insertSql,insertValues(code));
    await connection.commit();
   }catch(error){
    await connection.rollback();
    if(error.status)return res.status(error.status).json({error:error.message});
    throw error;
   }finally{connection.release();}
  }else{
   [result]=await db.execute(insertSql,insertValues(manualCode));
  }
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_CREATED',entityType:'patient',entityId:result.insertId});
  res.status(201).json({id:result.insertId,message:'Patient créé.'});
 }catch(error){next(error);}
});

r.put('/:id',canManagePatients,async(req,res,next)=>{
 try{
  const body=req.body||{},fields={patient_code:'patient_code',full_name:'full_name',birth_date:'birth_date',gender:'gender',phone:'phone',email:'email',address:'address'},sets=[],values=[];
  if(Object.prototype.hasOwnProperty.call(body,'patient_code')){
   if(typeof body.patient_code!=='string')return res.status(400).json({error:'Le code patient doit être du texte.'});
   const value=String(body.patient_code||'').trim();
   if(!value||value.length>80)return res.status(400).json({error:'Le code patient est obligatoire et limité à 80 caractères.'});
   sets.push('patient_code=?');values.push(value);
  }
  if(Object.prototype.hasOwnProperty.call(body,'full_name')){
   if(typeof body.full_name!=='string')return res.status(400).json({error:'Le nom complet doit être du texte.'});
   const value=String(body.full_name||'').trim();
   if(!value||value.length>190)return res.status(400).json({error:'Le nom complet est obligatoire et limité à 190 caractères.'});
   sets.push('full_name=?');values.push(value);
  }
  for(const field of ['birth_date','gender','phone','email','address']){
   if(!Object.prototype.hasOwnProperty.call(body,field))continue;
   if(field==='birth_date'&&!validDate(body[field]))return res.status(400).json({error:'La date de naissance est invalide.'});
   if(field==='gender'&&!genders.has(body[field]))return res.status(400).json({error:'Le genre sélectionné est invalide.'});
   sets.push(`${fields[field]}=?`);values.push(body[field]||null);
  }
  const contactError=validateContact(body);if(contactError)return res.status(400).json({error:contactError});
  if(!sets.length)return res.status(400).json({error:'Aucune modification à enregistrer.'});
  const [result]=await db.execute(
   `UPDATE patients SET ${sets.join(',')} WHERE id=? AND organization_id=? AND is_active=1`,
   [...values,req.params.id,req.tenantId]
  );
  if(!result.affectedRows){
   const [rows]=await db.execute('SELECT id FROM patients WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);
   if(!rows.length)return res.status(404).json({error:'Patient introuvable.'});
  }
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_UPDATED',entityType:'patient',entityId:req.params.id});
  res.json({message:'Patient modifié.'});
 }catch(error){next(error);}
});

r.delete('/:id',canManagePatients,async(req,res,next)=>{
 try{
  const [result]=await db.execute('UPDATE patients SET is_active=0 WHERE id=? AND organization_id=? AND is_active=1',[req.params.id,req.tenantId]);
  if(!result.affectedRows)return res.status(404).json({error:'Patient introuvable.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_ARCHIVED',entityType:'patient',entityId:req.params.id});
  res.json({message:'Patient archivé.'});
 }catch(error){next(error);}
});

r.post('/:id/restore',canManagePatients,async(req,res,next)=>{
 try{
  const [result]=await db.execute('UPDATE patients SET is_active=1 WHERE id=? AND organization_id=? AND is_active=0',[req.params.id,req.tenantId]);
  if(!result.affectedRows){
   const [rows]=await db.execute('SELECT id FROM patients WHERE id=? AND organization_id=? AND is_active=0',[req.params.id,req.tenantId]);
   if(!rows.length)return res.status(404).json({error:'Patient archivé introuvable.'});
  }
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_RESTORED',entityType:'patient',entityId:req.params.id});
  res.json({message:'Dossier patient réactivé.'});
 }catch(error){next(error);}
});

r.get('/:patientId/medical-history',canAccessMedicalHistory,async(req,res,next)=>{
 try{
  if(!await findPatient(req.params.patientId,req.tenantId))return res.status(404).json({error:'Patient introuvable.'});
  const [rows]=await db.execute(
   `SELECT id,condition_name,condition_code,start_date,end_date,status,notes,created_at,updated_at
    FROM patient_medical_history
    WHERE organization_id=? AND patient_id=? AND is_active=1
    ORDER BY COALESCE(start_date,DATE(created_at)),created_at,id`,
   [req.tenantId,req.params.patientId]
  );
  const annotated=rows.map((record,index)=>{
   const matches=historyMatches(record,rows.slice(0,index));
   const priorResolved=matches.filter(item=>item.status==='resolved'||item.status==='in_remission');
   return {...record,review_flag:priorResolved.length?'possible_recurrence':matches.length?'possible_duplicate':null,similar_records:matches.map(item=>({id:item.id,condition_name:item.condition_name,status:item.status,start_date:item.start_date,end_date:item.end_date}))};
  });
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_HISTORY_VIEWED',entityType:'patient',entityId:req.params.patientId});
  res.json(annotated);
 }catch(error){next(error);}
});

r.post('/:patientId/medical-history',canAccessMedicalHistory,async(req,res,next)=>{
 try{
  const body=req.body||{},validation=validateHistory(body);
  if(validation)return res.status(400).json({error:validation});
  if(!await findPatient(req.params.patientId,req.tenantId))return res.status(404).json({error:'Patient introuvable.'});
  const [previous]=await db.execute(
   'SELECT id,condition_name,status,start_date,end_date FROM patient_medical_history WHERE organization_id=? AND patient_id=? AND is_active=1',
   [req.tenantId,req.params.patientId]
  );
  const matches=historyMatches({condition_name:body.condition_name},previous);
  const priorResolved=matches.filter(item=>item.status==='resolved'||item.status==='in_remission');
  const reviewFlag=priorResolved.length?'possible_recurrence':matches.length?'possible_duplicate':null;
  const [result]=await db.execute(
   `INSERT INTO patient_medical_history(organization_id,patient_id,condition_name,condition_code,start_date,end_date,status,notes,recorded_by)
    VALUES(?,?,?,?,?,?,?,?,?)`,
   [req.tenantId,req.params.patientId,body.condition_name.trim(),body.condition_code||null,body.start_date||null,body.end_date||null,body.status||'ongoing',body.notes||null,req.user.id]
  );
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_HISTORY_CREATED',entityType:'patient_medical_history',entityId:result.insertId,details:{patientId:req.params.patientId,reviewFlag}});
  res.status(201).json({id:result.insertId,message:'Antécédent enregistré.',review_flag:reviewFlag,similar_records:matches.map(item=>({id:item.id,condition_name:item.condition_name,status:item.status,start_date:item.start_date,end_date:item.end_date}))});
 }catch(error){next(error);}
});

r.put('/:patientId/medical-history/:entryId',canAccessMedicalHistory,async(req,res,next)=>{
 try{
  const body=req.body||{},validation=validateHistory(body,{partial:true});
  if(validation)return res.status(400).json({error:validation});
  if(!await findPatient(req.params.patientId,req.tenantId))return res.status(404).json({error:'Patient introuvable.'});
  const [existingRows]=await db.execute(
   'SELECT start_date,end_date FROM patient_medical_history WHERE id=? AND patient_id=? AND organization_id=? AND is_active=1',
   [req.params.entryId,req.params.patientId,req.tenantId]
  );
  if(!existingRows.length)return res.status(404).json({error:'Antécédent introuvable.'});
  const startDate=Object.prototype.hasOwnProperty.call(body,'start_date')?body.start_date:existingRows[0].start_date&&String(existingRows[0].start_date).slice(0,10);
  const endDate=Object.prototype.hasOwnProperty.call(body,'end_date')?body.end_date:existingRows[0].end_date&&String(existingRows[0].end_date).slice(0,10);
  if(startDate&&endDate&&startDate>endDate)return res.status(400).json({error:'La date de fin doit être postérieure ou égale à la date de début.'});
  const fields={condition_name:'condition_name',condition_code:'condition_code',start_date:'start_date',end_date:'end_date',status:'status',notes:'notes'},sets=[],values=[];
  for(const field of Object.keys(fields))if(Object.prototype.hasOwnProperty.call(body,field)){
   const value=field==='condition_name'?body[field].trim():body[field]||null;
   sets.push(`${fields[field]}=?`);values.push(value);
  }
  if(!sets.length)return res.status(400).json({error:'Aucune modification à enregistrer.'});
  const [result]=await db.execute(
   `UPDATE patient_medical_history SET ${sets.join(',')}
    WHERE id=? AND patient_id=? AND organization_id=? AND is_active=1`,
   [...values,req.params.entryId,req.params.patientId,req.tenantId]
  );
  if(!result.affectedRows){
   const [rows]=await db.execute('SELECT id FROM patient_medical_history WHERE id=? AND patient_id=? AND organization_id=? AND is_active=1',[req.params.entryId,req.params.patientId,req.tenantId]);
   if(!rows.length)return res.status(404).json({error:'Antécédent introuvable.'});
  }
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_HISTORY_UPDATED',entityType:'patient_medical_history',entityId:req.params.entryId,details:{patientId:req.params.patientId}});
  res.json({message:'Antécédent modifié.'});
 }catch(error){next(error);}
});

r.delete('/:patientId/medical-history/:entryId',canAccessMedicalHistory,async(req,res,next)=>{
 try{
  const [result]=await db.execute(
   'UPDATE patient_medical_history SET is_active=0 WHERE id=? AND patient_id=? AND organization_id=? AND is_active=1',
   [req.params.entryId,req.params.patientId,req.tenantId]
  );
  if(!result.affectedRows)return res.status(404).json({error:'Antécédent introuvable.'});
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'PATIENT_HISTORY_ARCHIVED',entityType:'patient_medical_history',entityId:req.params.entryId,details:{patientId:req.params.patientId}});
  res.json({message:'Antécédent archivé.'});
 }catch(error){next(error);}
});

module.exports=r;
