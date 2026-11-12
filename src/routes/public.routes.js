const router=require('express').Router();
const db=require('../config/database');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {randomBytes}=require('crypto');
const {MODULES,MODULE_KEYS,getPlanModules,getTermPrice,parseJson}=require('../config/pricing');
const {DOCUMENTS:LEGAL_DOCUMENTS,loadLegalSettings}=require('../config/legal-documents');

const TRIAL_DAYS=7;
const validId=value=>/^[1-9]\d{0,19}$/.test(String(value||''));
const validEmail=value=>typeof value==='string'&&value.length<=190&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(`${value}T00:00:00Z`);
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
};
const logoTypes=new Set(['image/png','image/jpeg','image/gif','image/webp']);
function createSlug(value){
 const base=String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,75)||'entreprise';
 return `${base}-${randomBytes(5).toString('hex')}`;
}

router.get('/logos/:organizationId/:filename',async(req,res,next)=>{
 const organizationId=String(req.params.organizationId),filename=String(req.params.filename);
 if(!validId(organizationId)||!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\.(?:png|jpg|gif|webp)$/i.test(filename)){
  return res.status(404).json({error:'Logo introuvable.'});
 }
 try{
  const logoUrl=`/api/public/logos/${organizationId}/${filename}`;
  const [rows]=await db.execute(
   'SELECT logo_mime_type,logo_data FROM organization_settings WHERE organization_id=? AND logo_url=? LIMIT 1',
   [organizationId,logoUrl]
  );
  if(!rows.length||!logoTypes.has(rows[0].logo_mime_type)||!Buffer.isBuffer(rows[0].logo_data))return res.status(404).json({error:'Logo introuvable.'});
  res.set('Content-Type',rows[0].logo_mime_type).set('Cache-Control','public, max-age=3600').set('X-Content-Type-Options','nosniff').send(rows[0].logo_data);
 }catch(error){next(error);}
});

router.get('/legal-documents',async(req,res,next)=>{
 try{
  const settings=await loadLegalSettings(db);
  res.set('Cache-Control','no-store');
  res.json(settings);
 }catch(error){next(error);}
});

router.get('/catalog',async(req,res,next)=>{
 try{
  const [plans]=await db.execute(
   `SELECT id,code,name,plan_type,monthly_price,annual_price,biennial_price,currency,max_users,max_products,
           extra_user_price,included_modules,module_prices,is_active
    FROM plans
    WHERE is_active=TRUE OR code IN ('starter','ultimate','customized')
    ORDER BY FIELD(plan_type,'starter','ultimate','customized'),monthly_price,id`
  );
  const [promotions]=await db.execute(
   `SELECT id,code,name,plan_id,discount_type,discount_value,new_users_only,DATE_FORMAT(starts_at,'%Y-%m-%d') starts_at,
           DATE_FORMAT(ends_at,'%Y-%m-%d') ends_at
    FROM platform_promotions
    WHERE is_active=TRUE AND starts_at<=CURDATE() AND (ends_at IS NULL OR ends_at>=CURDATE())
    ORDER BY created_at DESC,id DESC`
  );
  const [faqs]=await db.execute(
   'SELECT question,answer,category FROM platform_faqs WHERE is_active=TRUE ORDER BY sort_order,id LIMIT 12'
  );
  const publicPlans=plans.map(plan=>{
   try{
    getPlanModules(plan);
    let hasPrice;
    if(plan.plan_type==='customized'){
     const prices=parseJson(plan.module_prices,{});
     hasPrice=MODULE_KEYS.some(module=>Object.values(prices?.[module]||{}).some(price=>price!==null&&price!==undefined&&Number.isFinite(Number(price))&&Number(price)>0));
    }else{
     hasPrice=['monthly_price','annual_price','biennial_price'].some(column=>plan[column]!==null&&plan[column]!==undefined&&Number.isFinite(Number(plan[column]))&&Number(plan[column])>0);
    }
    const isDefaultPlan=['starter','ultimate','customized'].includes(plan.code);
    if((!Boolean(Number(plan.is_active))||!hasPrice)&&!isDefaultPlan)return null;
    return {...plan,is_active:Boolean(Number(plan.is_active)),is_purchasable:Boolean(Number(plan.is_active))&&hasPrice};
   }catch{return null;}
  });
  const visiblePlans=publicPlans.filter(Boolean);
  res.set('Cache-Control','public, max-age=60');
  res.json({plans:visiblePlans,promotions,faqs,trialDays:TRIAL_DAYS,modules:MODULES});
 }catch(error){next(error);}
});

router.post('/register',async(req,res,next)=>{
 const body=req.body||{};
 const organizationName=typeof body.organization_name==='string'?body.organization_name.trim():'';
 const organizationEmail=typeof body.organization_email==='string'?body.organization_email.trim().toLowerCase():'';
 const ownerName=typeof body.owner_full_name==='string'?body.owner_full_name.trim():'';
 const ownerEmail=typeof body.owner_email==='string'?body.owner_email.trim().toLowerCase():'';
 const password=typeof body.password==='string'?body.password:'';
 const address=typeof body.address==='string'?body.address.trim():'';
 const phone=typeof body.phone==='string'?body.phone.trim():'';
 const slogan=typeof body.slogan==='string'?body.slogan.trim():'';
 const planId=String(body.plan_id||'');
 const promotionId=body.promotion_id?String(body.promotion_id):null;
 const partnerCode=typeof body.partner_code==='string'?body.partner_code.trim().toUpperCase():'';
 const interval=String(body.billing_interval||'monthly');
 const selectedModules=body.selected_modules;
 const legalVersions=body.legal_document_versions;
 const userLimit=body.user_limit===undefined||body.user_limit===''?null:Number(body.user_limit);
 if(organizationName.length<2||organizationName.length>180||!validEmail(organizationEmail)||
    ownerName.length<2||ownerName.length>180||!validEmail(ownerEmail)||
    password.length<12||password.length>128||address.length>2000||phone.length>50||slogan.length>255||
    !validId(planId)||(promotionId&&!validId(promotionId))||
    (partnerCode&&!/^[A-Z0-9]{6,24}$/.test(partnerCode))||
    !['monthly','annual','biennial'].includes(interval)||
    (userLimit!==null&&(!Number.isInteger(userLimit)||userLimit<1||userLimit>100000))||
    (selectedModules!==undefined&&(!Array.isArray(selectedModules)||selectedModules.some(module=>!MODULE_KEYS.includes(module))||new Set(selectedModules).size!==selectedModules.length))||
    body.accept_terms!==true||body.accept_legal_documents!==true||
    !legalVersions||typeof legalVersions!=='object'||Array.isArray(legalVersions)||
    Object.keys(legalVersions).length!==LEGAL_DOCUMENTS.length||
    LEGAL_DOCUMENTS.some(document=>typeof legalVersions[document.id]!=='string'||!/^[a-f0-9]{64}$/.test(legalVersions[document.id]))){
  return res.status(400).json({error:'Vérifiez les informations de l’entreprise, du propriétaire, le forfait, le mot de passe (12 caractères minimum) et l’acceptation des conditions.'});
 }
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const legalSettings=await loadLegalSettings(connection);
  if(LEGAL_DOCUMENTS.some(document=>legalVersions[document.id]!==legalSettings.documents.find(item=>item.id===document.id)?.version)){
   await connection.rollback();connection.release();connection=null;
   return res.status(409).json({error:'Les documents légaux ont été mis à jour. Actualisez cette page, consultez-les puis confirmez à nouveau votre acceptation.'});
  }
  await connection.execute('INSERT INTO account_email_claims(email,user_id) VALUES(?,NULL)',[ownerEmail]);
  const [existingUsers]=await connection.execute('SELECT id FROM users WHERE email=? LIMIT 1 FOR UPDATE',[ownerEmail]);
  if(existingUsers.length){
   await connection.rollback();connection.release();connection=null;
   return res.status(409).json({error:'Cette adresse de connexion est déjà utilisée. Connectez-vous ou utilisez une autre adresse.'});
  }
  const [plans]=await connection.execute(
   `SELECT id,plan_type,monthly_price,annual_price,biennial_price,extra_user_price,currency,max_users,max_products,
           included_modules,module_prices
    FROM plans WHERE id=? AND is_active=TRUE FOR UPDATE`,
   [planId]
  );
  if(!plans.length){
   await connection.rollback();connection.release();connection=null;
   return res.status(400).json({error:'Ce forfait n’est plus disponible. Actualisez le catalogue puis réessayez.'});
  }
  const selectedPlan=plans[0],maxUsers=userLimit??Number(selectedPlan.max_users);
  const modules=selectedPlan.plan_type==='customized'?selectedModules:getPlanModules(selectedPlan);
  let contractAmount;
  try{
   contractAmount=getTermPrice(selectedPlan,interval,modules,maxUsers);
  }catch(error){
   await connection.rollback();connection.release();connection=null;
   return res.status(400).json({error:error.message});
  }
  let validPromotionId=null;
  if(promotionId){
   const [promotions]=await connection.execute(
    'SELECT id,plan_id,discount_type,discount_value,new_users_only FROM platform_promotions WHERE id=? AND is_active=TRUE AND starts_at<=CURDATE() AND (ends_at IS NULL OR ends_at>=CURDATE()) FOR UPDATE',
    [promotionId]
   );
   if(!promotions.length){
    await connection.rollback();connection.release();connection=null;
    return res.status(400).json({error:'Cette promotion a expiré ou n’est plus disponible. Actualisez le panier.'});
   }
   if(promotions[0].plan_id !== null && String(promotions[0].plan_id) !== String(planId)){
    await connection.rollback();connection.release();connection=null;
    return res.status(400).json({error:'Cette promotion ne s’applique pas au forfait sélectionné.'});
   }
   validPromotionId=promotions[0].id;
   const rawDiscount=promotions[0].discount_type==='percent'
    ?contractAmount*Number(promotions[0].discount_value)/100:Number(promotions[0].discount_value);
   contractAmount=Math.max(0,Math.round((contractAmount-Math.min(contractAmount,rawDiscount))*100)/100);
  }
  let partnerId=null;
  if(partnerCode){
   const [partners]=await connection.execute('SELECT id FROM platform_partners WHERE referral_code=? AND is_active=TRUE FOR UPDATE',[partnerCode]);
   if(!partners.length){
    await connection.rollback();connection.release();connection=null;
    return res.status(400).json({error:'Ce code partenaire est invalide ou inactif.'});
   }
   partnerId=partners[0].id;
  }
  const slug=createSlug(organizationName),passwordHash=await bcrypt.hash(password,12);
  const [organization]=await connection.execute(
   "INSERT INTO organizations(name,address,phone,slogan,email,slug,status) VALUES(?,?,?,?,?,?,'active')",
   [organizationName,address||null,phone||null,slogan||null,organizationEmail,slug]
  );
  const organizationId=organization.insertId;
  if(partnerId)await connection.execute('UPDATE organizations SET partner_id=? WHERE id=?',[partnerId,organizationId]);
  const [user]=await connection.execute(
   "INSERT INTO users(organization_id,full_name,email,password_hash,role,is_active) VALUES(?,?,?,?, 'OWNER',TRUE)",
   [organizationId,ownerName,ownerEmail,passwordHash]
  );
  await connection.execute('UPDATE account_email_claims SET user_id=? WHERE email=?',[user.insertId,ownerEmail]);
  await connection.execute('INSERT INTO organization_settings(organization_id,display_name) VALUES(?,?)',[organizationId,organizationName]);
  const [trialPlans]=await connection.execute("SELECT id FROM plans WHERE code='trial' AND is_active=TRUE LIMIT 1");
  await connection.execute(
   `INSERT INTO subscriptions(organization_id,plan_id,target_plan_id,promotion_id,status,billing_interval,contract_amount,max_users,selected_modules,current_period_start,current_period_end)
    VALUES(?,?,?,?,'trialing',?,?,?, ?,CURDATE(),DATE_ADD(CURDATE(),INTERVAL ${TRIAL_DAYS} DAY))`,
   [organizationId,trialPlans[0]?.id||planId,planId,validPromotionId,interval,contractAmount,maxUsers,JSON.stringify(modules)]
  );
  await connection.execute(
   'INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
   [organizationId,user.insertId,'TENANT_SIGNUP_COMPLETED','subscription',String(planId),JSON.stringify({plan_id:planId,promotion_id:validPromotionId,trial_days:TRIAL_DAYS,billing_interval:interval,contract_amount:contractAmount,max_users:maxUsers,selected_modules:modules,legal_documents:{versions:legalVersions,accepted_at:new Date().toISOString()}})]
  );
  const [users]=await connection.execute(
   `SELECT u.id,u.organization_id,u.full_name,u.email,u.role,o.name organization_name,o.status organization_status,u.password_version
    FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.id=?`,
   [user.insertId]
  );
  await connection.commit();connection.release();connection=null;
  const account=users[0];
  const token=jwt.sign({sub:account.id,pv:Number(account.password_version||0)},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});
  delete account.password_version;
  res.status(201).json({token,user:account,trialDays:TRIAL_DAYS,message:`Votre espace entreprise est créé. Votre période d’essai de ${TRIAL_DAYS} jours commence maintenant.`});
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  if(error.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Cette adresse de connexion est déjà utilisée. Connectez-vous ou utilisez une autre adresse.'});
  next(error);
 }
});

module.exports=router;
