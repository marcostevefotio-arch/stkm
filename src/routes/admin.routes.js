const router=require('express').Router();
const db=require('../config/database');
const bcrypt=require('bcryptjs');
const {requireRole}=require('../middleware/auth');
const {requireFeature}=require('../middleware/plan-access');

const canAdminister=requireRole('OWNER','ADMIN');
const roles=new Set(['OWNER','ADMIN','PHARMACIST','STOREKEEPER','CASHIER','VIEWER','ACCOUNTANT']);
const privilegedRoles=new Set(['OWNER','ADMIN']);
const idPattern=/^[1-9]\d{0,19}$/;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const passwordValid=value=>typeof value==='string'&&value.length>=12&&value.length<=128;

async function accountantRoleAvailable(connection){
 const [columns]=await connection.execute("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='role'");
 return columns.length===1&&String(columns[0].COLUMN_TYPE).toLowerCase()==="enum('owner','admin','pharmacist','storekeeper','cashier','viewer','super_admin','accountant')";
}

function validDate(value){
 if(!datePattern.test(value))return false;
 const date=new Date(`${value}T00:00:00.000Z`);
 return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;
}

async function writeAudit(connection,{tenantId,userId,action,entityId,details}){
 await connection.execute(
  'INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
  [tenantId,userId,action,'user',String(entityId),JSON.stringify(details)]
 );
}

router.get('/users',canAdminister,async(req,res,next)=>{
 try{
  const [users]=await db.execute(
   `SELECT id,full_name,email,role,is_active,created_at
    FROM users WHERE organization_id=? AND role<>'SUPER_ADMIN'
    ORDER BY is_active DESC,full_name,id`,
   [req.tenantId]
  );
  const [[quota]]=await db.execute(
   `SELECT COALESCE(s.max_users,p.max_users) max_users,
           (SELECT COUNT(*) FROM users u WHERE u.organization_id=s.organization_id AND u.is_active=TRUE AND u.role<>'SUPER_ADMIN') active_users
    FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.organization_id=? ORDER BY s.id DESC LIMIT 1`,
   [req.tenantId]
  );
  res.json({users,quota:quota?{max_users:Number(quota.max_users),active_users:Number(quota.active_users)}:null});
 }catch(error){next(error);}
});

router.post('/users',canAdminister,async(req,res,next)=>{
 const fullName=String(req.body?.full_name||'').trim();
 const email=String(req.body?.email||'').trim().toLowerCase();
 const role=String(req.body?.role||'');
 const password=req.body?.password;
 if(!fullName||fullName.length>180||!emailPattern.test(email)||email.length>190||!roles.has(role)||!passwordValid(password)){
  return res.status(400).json({error:'Nom, adresse e-mail, rôle autorisé et mot de passe d’au moins 12 caractères requis.'});
 }
 if(privilegedRoles.has(role)&&req.user.role!=='OWNER')return res.status(403).json({error:'Seul un propriétaire peut créer un compte propriétaire ou administrateur.'});
 let connection;
 try{
  connection=await db.getConnection();
  await connection.beginTransaction();
  await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE',[req.tenantId]);
  if(role==='ACCOUNTANT'&&!await accountantRoleAvailable(connection)){
   await connection.rollback();
   return res.status(409).json({error:'Le rôle expert-comptable nécessite la migration 2026110604_accountant_role.'});
  }
  const [[subscription]]=await connection.execute(
   `SELECT COALESCE(s.max_users,p.max_users) max_users,(SELECT COUNT(*) FROM users u WHERE u.organization_id=s.organization_id AND u.is_active=TRUE AND u.role<>'SUPER_ADMIN') active_users
    FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.organization_id=? ORDER BY s.id DESC LIMIT 1`,
   [req.tenantId]
  );
  if(subscription&&Number(subscription.active_users)>=Number(subscription.max_users)){
   await connection.rollback();
   return res.status(409).json({error:`La limite de ${subscription.max_users} comptes actifs de votre abonnement est atteinte.`});
  }
  const [result]=await connection.execute(
   'INSERT INTO users(organization_id,full_name,email,password_hash,role,is_active) VALUES(?,?,?,?,?,TRUE)',
   [req.tenantId,fullName,email,await bcrypt.hash(password,12),role]
  );
  await writeAudit(connection,{tenantId:req.tenantId,userId:req.user.id,action:'USER_CREATED',entityId:result.insertId,details:{full_name:fullName,email,role}});
  await connection.commit();
  res.status(201).json({id:result.insertId,message:'Compte utilisateur créé.'});
 }catch(error){
  await connection.rollback();
  if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Un compte utilise déjà cette adresse e-mail.'});
  next(error);
 }finally{connection?.release();}
});

router.patch('/users/:id',canAdminister,async(req,res,next)=>{
 const id=String(req.params.id),body=req.body||{};
 if(!idPattern.test(id))return res.status(400).json({error:'Identifiant utilisateur invalide.'});
 const hasName=Object.hasOwn(body,'full_name'),hasEmail=Object.hasOwn(body,'email'),hasRole=Object.hasOwn(body,'role'),hasActive=Object.hasOwn(body,'is_active'),hasPassword=Object.hasOwn(body,'password');
 if(!hasName&&!hasEmail&&!hasRole&&!hasActive&&!hasPassword)return res.status(400).json({error:'Aucune modification à enregistrer.'});
 const fullName=hasName?String(body.full_name||'').trim():undefined;
 const email=hasEmail?String(body.email||'').trim().toLowerCase():undefined;
 const role=hasRole?String(body.role||''):undefined;
 if(hasName&&(!fullName||fullName.length>180))return res.status(400).json({error:'Le nom doit contenir entre 1 et 180 caractères.'});
 if(hasEmail&&(!emailPattern.test(email)||email.length>190))return res.status(400).json({error:'L’adresse e-mail est invalide.'});
 if(hasRole&&!roles.has(role))return res.status(400).json({error:'Le rôle sélectionné est invalide.'});
 if(hasActive&&typeof body.is_active!=='boolean')return res.status(400).json({error:'Le statut du compte est invalide.'});
 if(hasPassword&&!passwordValid(body.password))return res.status(400).json({error:'Le nouveau mot de passe doit contenir au moins 12 caractères.'});
 let connection;
 try{
  connection=await db.getConnection();
  await connection.beginTransaction();
  await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE',[req.tenantId]);
  const [found]=await connection.execute(
   'SELECT id,full_name,email,role,is_active FROM users WHERE id=? AND organization_id=? AND role<>\'SUPER_ADMIN\' FOR UPDATE',
   [id,req.tenantId]
  );
  if(!found.length){await connection.rollback();return res.status(404).json({error:'Utilisateur introuvable dans cet établissement.'});}
  const current=found[0],nextRole=hasRole?role:current.role,nextActive=hasActive?body.is_active:Boolean(current.is_active);
  if(hasRole&&nextRole==='ACCOUNTANT'&&!await accountantRoleAvailable(connection)){
   await connection.rollback();
   return res.status(409).json({error:'Le rôle expert-comptable nécessite la migration 2026110604_accountant_role.'});
  }
  if(Number(current.id)===Number(req.user.id)&&(nextRole!==current.role||!nextActive)){
   await connection.rollback();
   return res.status(409).json({error:'Vous ne pouvez pas modifier votre propre rôle ni désactiver votre compte.'});
  }
  if(privilegedRoles.has(current.role)&&req.user.role!=='OWNER'&&Number(current.id)!==Number(req.user.id)){
   await connection.rollback();
   return res.status(403).json({error:'Un administrateur ne peut pas modifier le compte d’un propriétaire ou d’un autre administrateur.'});
  }
  if(hasRole&&nextRole!==current.role&&privilegedRoles.has(nextRole)&&req.user.role!=='OWNER'){
   await connection.rollback();
   return res.status(403).json({error:'Seul un propriétaire peut attribuer les rôles propriétaire ou administrateur.'});
  }
  if(privilegedRoles.has(current.role)&&(!nextActive||!privilegedRoles.has(nextRole))){
   const [[owners]]=await connection.execute(
    "SELECT COUNT(*) active_owners FROM users WHERE organization_id=? AND role='OWNER' AND is_active=TRUE",
    [req.tenantId]
   );
   if(current.role==='OWNER'&&Number(owners.active_owners)<=1){
    await connection.rollback();
    return res.status(409).json({error:'L’unique propriétaire actif ne peut pas être désactivé ou rétrogradé. Attribuez d’abord ce rôle à un autre compte.'});
   }
  }
  if(!current.is_active&&nextActive){
   const [[subscription]]=await connection.execute(
    `SELECT COALESCE(s.max_users,p.max_users) max_users,(SELECT COUNT(*) FROM users u WHERE u.organization_id=s.organization_id AND u.is_active=TRUE AND u.role<>'SUPER_ADMIN') active_users
     FROM subscriptions s JOIN plans p ON p.id=s.plan_id
     WHERE s.organization_id=? ORDER BY s.id DESC LIMIT 1`,
    [req.tenantId]
   );
   if(subscription&&Number(subscription.active_users)>=Number(subscription.max_users)){
    await connection.rollback();
    return res.status(409).json({error:`La limite de ${subscription.max_users} comptes actifs de votre abonnement est atteinte.`});
   }
  }
  const fields=[],values=[];
  if(hasName){fields.push('full_name=?');values.push(fullName);}
  if(hasEmail){fields.push('email=?');values.push(email);}
  if(hasRole){fields.push('role=?');values.push(role);}
  if(hasActive){fields.push('is_active=?');values.push(body.is_active);}
  if(hasPassword){fields.push('password_hash=?','password_version=password_version+1');values.push(await bcrypt.hash(body.password,12));}
  if(fields.length){
   await connection.execute(`UPDATE users SET ${fields.join(',')} WHERE id=? AND organization_id=?`,[...values,id,req.tenantId]);
   await writeAudit(connection,{tenantId:req.tenantId,userId:req.user.id,action:'USER_UPDATED',entityId:id,details:{
    ...(hasName?{full_name:fullName}:{}),...(hasEmail?{email}:{}),...(hasRole?{role}:{}),
    ...(hasActive?{is_active:body.is_active}:{}),...(hasPassword?{password_reset:true}:{})
   }});
  }
  await connection.commit();
  res.json({message:'Compte utilisateur mis à jour.'});
 }catch(error){
  await connection.rollback();
  if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Un compte utilise déjà cette adresse e-mail.'});
  next(error);
 }finally{connection?.release();}
});

router.get('/audit',canAdminister,requireFeature('administration'),async(req,res,next)=>{
 const limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||25,1),100);
 const offset=Math.min(Math.max(Number.parseInt(req.query.offset,10)||0,0),1000000);
 const query=String(req.query.q||'').trim().slice(0,120),action=String(req.query.action||'').trim().slice(0,100),entity=String(req.query.entity||'').trim().slice(0,80),from=String(req.query.from||''),to=String(req.query.to||'');
 if((from&&!validDate(from))||(to&&!validDate(to)))return res.status(400).json({error:'Les dates de filtre sont invalides.'});
 if(from&&to&&from>to)return res.status(400).json({error:'La date de début doit précéder la date de fin.'});
 try{
  const clauses=['a.organization_id=?'],values=[req.tenantId];
  if(query){clauses.push('(u.full_name LIKE ? OR a.action LIKE ? OR a.entity_type LIKE ? OR a.entity_id LIKE ? OR CAST(a.details_json AS CHAR) LIKE ?)');const pattern=`%${query}%`;values.push(pattern,pattern,pattern,pattern,pattern);}
  if(action){clauses.push('a.action=?');values.push(action);}
  if(entity){clauses.push('a.entity_type=?');values.push(entity);}
  if(from){clauses.push('a.created_at>=?');values.push(`${from} 00:00:00`);}
  if(to){clauses.push('a.created_at<DATE_ADD(?,INTERVAL 1 DAY)');values.push(to);}
  const where=clauses.join(' AND ');
  const [[count]]=await db.execute(`SELECT COUNT(*) total FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${where}`,values);
  const [rows]=await db.execute(
   `SELECT a.id,a.user_id,a.action,a.entity_type,a.entity_id,a.details_json,a.created_at,
           COALESCE(u.full_name,'Utilisateur supprimé') user_name
    FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
    WHERE ${where} ORDER BY a.created_at DESC,a.id DESC LIMIT ? OFFSET ?`,
   [...values,limit,offset]
  );
  res.json({items:rows.map(row=>({...row,details_json:typeof row.details_json==='string'?JSON.parse(row.details_json):row.details_json})),total:Number(count.total),limit,offset});
 }catch(error){next(error);}
});

module.exports=router;
