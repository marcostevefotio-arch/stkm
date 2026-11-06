const router=require('express').Router();
const db=require('../config/database');
const {requireRole}=require('../middleware/auth');
const bcrypt=require('bcryptjs');
const {randomBytes}=require('crypto');
const {ALL_MODULES,MODULE_KEYS,PRICE_COLUMNS,getPlanModules,parseJson}=require('../config/pricing');
const {recordPaidInvoiceCommission}=require('../services/partner-commission.service');

router.use(requireRole('SUPER_ADMIN'));

function validId(value){return /^[1-9]\d{0,19}$/.test(String(value||''));}
function validStatus(value){return ['open','in_progress','closed'].includes(value);}
function positiveMoney(value){if(typeof value==='string'&&!value.trim())return false;const amount=Number(value);return Number.isFinite(amount)&&amount>=0&&amount<=999999999;}
function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(`${value}T00:00:00Z`);return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;}
function validEmail(value){return typeof value==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)&&value.length<=190;}
async function writeEntityAudit(connection,req,organizationId,action,entityType,entityId,details){
 await connection.execute(
  'INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
  [organizationId,req.user.id,action,entityType,String(entityId),JSON.stringify(details)]
 );
}
async function writePlatformAudit(connection,req,organizationId,action,entityId,details){
 await writeEntityAudit(connection,req,organizationId,action,'organization',entityId,details);
}
async function auditedMutation(req,organizationId,action,entityType,details,mutate){
 const connection=await db.getConnection();
 try{
  await connection.beginTransaction();
  const entityId=await mutate(connection);
  if(entityId===null){await connection.rollback();return null;}
  await writeEntityAudit(connection,req,organizationId,action,entityType,entityId,details);
  await connection.commit();
  return entityId;
 }catch(error){
  try{await connection.rollback();}catch(rollbackError){error.rollbackError=rollbackError;}
  throw error;
 }finally{connection.release();}
}
async function writeAudit(connection,req,organizationId,action,ticketId,details){
 await connection.execute(
  'INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
  [organizationId,req.user.id,action,'support_ticket',String(ticketId),JSON.stringify(details)]
 );
}

router.get('/overview',async(req,res,next)=>{
 try{
  const [[tenants]]=await db.execute('SELECT COUNT(*) total FROM organizations');
  const [[active]]=await db.execute("SELECT COUNT(*) total FROM subscriptions WHERE status='active'");
  const [[trials]]=await db.execute("SELECT COUNT(*) total FROM subscriptions WHERE status='trialing'");
  const [[openChats]]=await db.execute("SELECT COUNT(*) total FROM support_tickets WHERE support_token IS NOT NULL AND status<>'closed'");
  const [[waitingChats]]=await db.execute("SELECT COUNT(*) total FROM support_tickets WHERE support_token IS NOT NULL AND status<>'closed' AND assigned_agent_id IS NULL");
  res.json({tenants:Number(tenants.total),activeSubscriptions:Number(active.total),trialSubscriptions:Number(trials.total),openChats:Number(openChats.total),waitingChats:Number(waitingChats.total)});
 }catch(error){next(error);}
});

router.get('/organizations',async(req,res,next)=>{
 const query=String(req.query.q||'').trim().slice(0,120),limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||25,1),100),offset=Math.min(Math.max(Number.parseInt(req.query.offset,10)||0,0),1000000);
 try{
  const where=query?'WHERE o.name LIKE ? OR o.slug LIKE ? OR o.email LIKE ? OR o.phone LIKE ?':'';
  const values=query?Array(4).fill(`%${query}%`):[];
  const [[count]]=await db.execute(`SELECT COUNT(*) total FROM organizations o ${where}`,values);
  const [items]=await db.execute(
   `SELECT o.id,o.name,o.slug,o.email,o.phone,o.status,o.created_at,
           s.id subscription_id,s.plan_id,s.status subscription_status,p.name plan_name,
           DATE_FORMAT(s.current_period_start,'%Y-%m-%d') current_period_start,
           DATE_FORMAT(s.current_period_end,'%Y-%m-%d') current_period_end,
           COALESCE(s.max_users,p.max_users) max_users,
           (SELECT COUNT(*) FROM users u WHERE u.organization_id=o.id AND u.is_active=TRUE AND u.role<>'SUPER_ADMIN') active_users
    FROM organizations o
    LEFT JOIN subscriptions s ON s.id=(SELECT MAX(s2.id) FROM subscriptions s2 WHERE s2.organization_id=o.id)
    LEFT JOIN plans p ON p.id=s.plan_id
    ${where} ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`,
   [...values,limit,offset]
  );
  res.json({items,total:Number(count.total),limit,offset});
 }catch(error){next(error);}
});

router.patch('/organizations/:id/status',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant d’établissement invalide.'});
 const status=req.body?.status;
 if(!['active','suspended','closed'].includes(status))return res.status(400).json({error:'Choisissez un statut d’établissement valide.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [organizations]=await connection.execute('SELECT id,status FROM organizations WHERE id=? FOR UPDATE',[req.params.id]);
  if(!organizations.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Établissement introuvable.'});}
  const previous=organizations[0].status;
  if(previous!==status){
   await connection.execute('UPDATE organizations SET status=? WHERE id=?',[status,req.params.id]);
   await writePlatformAudit(connection,req,req.params.id,'PLATFORM_ORGANIZATION_STATUS_CHANGED',req.params.id,{from:previous,to:status});
  }
  await connection.commit();connection.release();connection=null;
  res.json({status,message:'Statut de l’établissement mis à jour.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.patch('/organizations/:id/subscription',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant d’établissement invalide.'});
 const {plan_id:planId,status,period_start:periodStart,period_end:periodEnd}=req.body||{};
 const subscriptionStatuses=['trialing','active','past_due','suspended','cancelled'];
 if(!validId(planId)||!subscriptionStatuses.includes(status))return res.status(400).json({error:'Choisissez un forfait et un statut d’abonnement valides.'});
 if((periodStart!==undefined||periodEnd!==undefined)&&(!validDate(periodStart)||!validDate(periodEnd)||periodEnd<periodStart))return res.status(400).json({error:'Les dates de période d’abonnement sont invalides.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [organizations]=await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE',[req.params.id]);
  if(!organizations.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Établissement introuvable.'});}
  const [subscriptions]=await connection.execute('SELECT id,plan_id,status,current_period_start,current_period_end FROM subscriptions WHERE organization_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[req.params.id]);
  const [plans]=await connection.execute('SELECT id FROM plans WHERE id=? AND is_active=TRUE',[planId]);
  if(!plans.length){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Ce forfait est introuvable ou inactif.'});}
  if(!subscriptions.length){
   const [result]=await connection.execute(
    `INSERT INTO subscriptions(organization_id,plan_id,status,billing_interval,current_period_start,current_period_end)
     VALUES(?,? ,?,'monthly',COALESCE(?,CURDATE()),COALESCE(?,DATE_ADD(CURDATE(),INTERVAL 1 MONTH)))`,
    [req.params.id,planId,status,periodStart||null,periodEnd||null]
   );
   await writePlatformAudit(connection,req,req.params.id,'PLATFORM_SUBSCRIPTION_CREATED',result.insertId,{plan_id:planId,status,period_start:periodStart||null,period_end:periodEnd||null});
  }else{
   const previous=subscriptions[0],nextStart=periodStart||previous.current_period_start,nextEnd=periodEnd||previous.current_period_end;
   if(Number(previous.plan_id)!==Number(planId)||previous.status!==status||String(previous.current_period_start).slice(0,10)!==String(nextStart).slice(0,10)||String(previous.current_period_end).slice(0,10)!==String(nextEnd).slice(0,10)){
    await connection.execute('UPDATE subscriptions SET plan_id=?,target_plan_id=NULL,status=?,current_period_start=?,current_period_end=? WHERE id=?',[planId,status,nextStart,nextEnd,previous.id]);
    await writePlatformAudit(connection,req,req.params.id,'PLATFORM_SUBSCRIPTION_CHANGED',previous.id,{from_plan_id:previous.plan_id,to_plan_id:planId,from_status:previous.status,to_status:status,from_period_start:previous.current_period_start,from_period_end:previous.current_period_end,to_period_start:nextStart,to_period_end:nextEnd});
   }
  }
  await connection.commit();connection.release();connection=null;
  res.json({message:'Abonnement mis à jour.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.get('/plans',async(req,res,next)=>{
 try{
  const [items]=await db.execute('SELECT id,name,plan_type,monthly_price,annual_price,biennial_price,currency,max_users,max_products,extra_user_price,included_modules,module_prices FROM plans WHERE is_active=TRUE ORDER BY monthly_price,id');
  res.json(items);
 }catch(error){next(error);}
});

router.get('/pricing',async(req,res,next)=>{
 try{
  const [items]=await db.execute('SELECT id,code,name,plan_type,billing_interval,monthly_price,annual_price,biennial_price,currency,max_users,max_products,extra_user_price,included_modules,module_prices,is_active FROM plans ORDER BY monthly_price,id');
  res.json(items);
 }catch(error){next(error);}
});

function planInput(body={},creating=false){
 const legacy=creating&&!body.plan_type;
 const type=legacy?'ultimate':String(body.plan_type||'');
 const name=typeof body.name==='string'?body.name.trim():'';
 const currency=body.currency;
 const maxUsers=Number(body.max_users??(type==='starter'?3:type==='ultimate'?5:1));
 const maxProducts=Number(body.max_products??10000000);
 const isActive=creating?(body.is_active===undefined?true:body.is_active):body.is_active;
 const prices={};
 for(const [interval,column] of Object.entries(PRICE_COLUMNS)){
  const value=body[column]===undefined&&legacy&&interval!=='monthly'?null:body[column];
  prices[interval]=value===null||value===''||value===undefined?null:Number(value);
 }
 if(legacy)prices.monthly=Number(body.monthly_price);
 const extraUserPrice=body.extra_user_price===undefined
  ?(type==='starter'||type==='ultimate'?5000:0):Number(body.extra_user_price);
 const rawModules=Array.isArray(body.included_modules)?body.included_modules:[];
 const includedModules=type==='starter'?['stock','procurement','sales','cash']
  :type==='ultimate'?ALL_MODULES:[...new Set(rawModules.filter(module=>MODULE_KEYS.includes(module)))];
 let modulePrices=body.module_prices;
 if(typeof modulePrices==='string'){
  try{modulePrices=JSON.parse(modulePrices);}catch{return {error:'Les tarifs des fonctionnalités sont invalides.'};}
 }
 if(!modulePrices||typeof modulePrices!=='object'||Array.isArray(modulePrices))modulePrices={};
 const normalizedPrices={};
 for(const [module,termPrices] of Object.entries(modulePrices)){
  if(!MODULE_KEYS.includes(module)||!termPrices||typeof termPrices!=='object'||Array.isArray(termPrices))return {error:'Une fonctionnalité ou son tarif est invalide.'};
  normalizedPrices[module]={};
  for(const interval of Object.keys(PRICE_COLUMNS)){
   const value=termPrices[interval];
   if(value===null||value===''||value===undefined)continue;
   if(!positiveMoney(value))return {error:'Un tarif de fonctionnalité est invalide.'};
   normalizedPrices[module][interval]=Number(value);
  }
 }
 const validName=name.length>=2&&name.length<=100;
 const validPrices=Object.values(prices).every(value=>value===null||Number.isFinite(value)&&value>=0&&value<=999999999);
 const validModulePrices=Object.entries(normalizedPrices).every(([module,terms])=>includedModules.includes(module)&&Object.keys(terms).length>0);
 const anyPrice=type==='customized'
  ?Object.entries(normalizedPrices).some(([module,terms])=>includedModules.includes(module)&&Object.keys(terms).length>0)
  :Object.values(prices).some(value=>value!==null&&value>0);
 if(!['starter','ultimate','customized'].includes(type)||!validName||typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)||
    !Number.isInteger(maxUsers)||maxUsers<1||maxUsers>100000||!Number.isInteger(maxProducts)||maxProducts<1||maxProducts>10000000||
    typeof extraUserPrice!=='number'||!Number.isFinite(extraUserPrice)||extraUserPrice<0||extraUserPrice>999999999||
    !validPrices||!validModulePrices||typeof isActive!=='boolean'||(type==='starter'&&Object.values(prices).some(value=>value===null||value<=0))||
    (type==='customized'&&includedModules.length===0)||(isActive&&!anyPrice)){
  return {error:'Vérifiez le type, le nom, les prix de chaque période, les fonctionnalités, la devise et les quotas du forfait.'};
 }
 return {type,name,currency,maxUsers,maxProducts,isActive,prices,extraUserPrice,includedModules,modulePrices:normalizedPrices};
}

router.post('/pricing',async(req,res,next)=>{
 const body=req.body||{},code=body.code;
 if(typeof code!=='string'||!/^[a-z0-9][a-z0-9-]{1,59}$/.test(code))return res.status(400).json({error:'Le code du forfait doit contenir uniquement des lettres minuscules, chiffres et tirets.'});
 const input=planInput(body,true);
 if(input.error)return res.status(400).json({error:input.error});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [result]=await connection.execute(
   `INSERT INTO plans(code,name,plan_type,billing_interval,monthly_price,annual_price,biennial_price,included_modules,module_prices,extra_user_price,currency,max_users,max_products,is_active)
    VALUES(?,? ,?,'monthly',?,?,?,?,?,?,?,?,?,?)`,
   [code,input.name,input.type,input.prices.monthly,input.prices.annual,input.prices.biennial,JSON.stringify(input.includedModules),JSON.stringify(input.modulePrices),input.extraUserPrice,input.currency,input.maxUsers,input.maxProducts,input.isActive]
  );
  await writeEntityAudit(connection,req,req.tenantId,'PLATFORM_PLAN_CREATED','platform_plan',result.insertId,{code,...input});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({id:result.insertId,message:'Forfait créé.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.patch('/pricing/:id',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de forfait invalide.'});
 const input=planInput(req.body||{});
 if(input.error)return res.status(400).json({error:input.error});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [plans]=await connection.execute('SELECT * FROM plans WHERE id=? FOR UPDATE',[req.params.id]);
  if(!plans.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Forfait introuvable.'});}
  const previous=plans[0];
  await connection.execute(
   'UPDATE plans SET name=?,plan_type=?,monthly_price=?,annual_price=?,biennial_price=?,included_modules=?,module_prices=?,extra_user_price=?,currency=?,max_users=?,max_products=?,is_active=? WHERE id=?',
   [input.name,input.type,input.prices.monthly,input.prices.annual,input.prices.biennial,JSON.stringify(input.includedModules),JSON.stringify(input.modulePrices),input.extraUserPrice,input.currency,input.maxUsers,input.maxProducts,input.isActive,req.params.id]
  );
  await writeEntityAudit(connection,req,req.tenantId,'PLATFORM_PLAN_UPDATED','platform_plan',req.params.id,{from:previous,to:input});
  await connection.commit();connection.release();connection=null;
  res.json({message:'Forfait mis à jour.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.get('/promotions',async(req,res,next)=>{
 try{
  const [items]=await db.execute("SELECT pr.id,pr.code,pr.name,pr.plan_id,p.name plan_name,pr.discount_type,pr.discount_value,DATE_FORMAT(pr.starts_at,'%Y-%m-%d') starts_at,DATE_FORMAT(pr.ends_at,'%Y-%m-%d') ends_at,pr.new_users_only,pr.is_active FROM platform_promotions pr LEFT JOIN plans p ON p.id=pr.plan_id ORDER BY pr.created_at DESC,pr.id DESC");
  res.json(items);
 }catch(error){next(error);}
});

router.post('/promotions',async(req,res,next)=>{
 const {code,name,discount_type:type,discount_value:value,starts_at:startsAt,ends_at:endsAt,new_users_only:newUsersOnly=false,is_active:isActive}=req.body||{};
 const rawPlanId=req.body?.plan_id,planId=rawPlanId===undefined||rawPlanId===null||rawPlanId===''?null:String(rawPlanId);
 if(typeof code!=='string'||!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(code)||typeof name!=='string'||name.trim().length<2||name.trim().length>120||(planId!==null&&!validId(planId))||!['percent','fixed'].includes(type)||!positiveMoney(value)||Number(value)<=0||(type==='percent'&&Number(value)>100)||!validDate(startsAt)||(endsAt!=null&&endsAt!==''&&!validDate(endsAt))||(endsAt&&endsAt<startsAt)||typeof newUsersOnly!=='boolean'||typeof isActive!=='boolean')return res.status(400).json({error:'Vérifiez le code, le forfait, le type, la valeur et les dates de la promotion.'});
 try{
  if(planId){const [plans]=await db.execute("SELECT id FROM plans WHERE id=? AND plan_type<>'trial'",[planId]);if(!plans.length)return res.status(400).json({error:'Le forfait ciblé est introuvable ou ne peut pas recevoir de promotion.'});}
  const details={code,name:name.trim(),plan_id:planId,discount_type:type,discount_value:value,starts_at:startsAt,ends_at:endsAt||null,new_users_only:newUsersOnly,is_active:isActive};
  const id=await auditedMutation(req,req.tenantId,'PLATFORM_PROMOTION_CREATED','platform_promotion',details,async connection=>{
   const [result]=await connection.execute('INSERT INTO platform_promotions(code,name,plan_id,discount_type,discount_value,starts_at,ends_at,new_users_only,is_active) VALUES(?,?,?,?,?,?,?,?,?)',[code,name.trim(),planId,type,value,startsAt,endsAt||null,newUsersOnly,isActive]);
   return result.insertId;
  });
  res.status(201).json({id,message:'Promotion créée.'});
 }catch(error){next(error);}
});

router.patch('/promotions/:id',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de promotion invalide.'});
 const {name,discount_type:type,discount_value:value,starts_at:startsAt,ends_at:endsAt,new_users_only:newUsersOnly=false,is_active:isActive}=req.body||{};
 const rawPlanId=req.body?.plan_id,planId=rawPlanId===undefined||rawPlanId===null||rawPlanId===''?null:String(rawPlanId);
 if(typeof name!=='string'||name.trim().length<2||name.trim().length>120||(rawPlanId!==undefined&&planId!==null&&!validId(planId))||!['percent','fixed'].includes(type)||!positiveMoney(value)||Number(value)<=0||(type==='percent'&&Number(value)>100)||!validDate(startsAt)||(endsAt!=null&&endsAt!==''&&!validDate(endsAt))||(endsAt&&endsAt<startsAt)||typeof newUsersOnly!=='boolean'||typeof isActive!=='boolean')return res.status(400).json({error:'Vérifiez les données de la promotion.'});
 try{
  if(rawPlanId!==undefined&&planId){const [plans]=await db.execute("SELECT id FROM plans WHERE id=? AND plan_type<>'trial'",[planId]);if(!plans.length)return res.status(400).json({error:'Le forfait ciblé est introuvable ou ne peut pas recevoir de promotion.'});}
  const details={name:name.trim(),plan_id:rawPlanId===undefined?undefined:planId,discount_type:type,discount_value:value,starts_at:startsAt,ends_at:endsAt||null,new_users_only:newUsersOnly,is_active:isActive};
  const id=await auditedMutation(req,req.tenantId,'PLATFORM_PROMOTION_UPDATED','platform_promotion',details,async connection=>{
   const [existing]=await connection.execute('SELECT id,plan_id FROM platform_promotions WHERE id=? FOR UPDATE',[req.params.id]);
   if(!existing.length)return null;
   const nextPlanId=rawPlanId===undefined?(existing[0].plan_id===null?null:String(existing[0].plan_id)):planId;
   details.plan_id=nextPlanId;
   await connection.execute('UPDATE platform_promotions SET name=?,plan_id=?,discount_type=?,discount_value=?,starts_at=?,ends_at=?,new_users_only=?,is_active=? WHERE id=?',[name.trim(),nextPlanId,type,value,startsAt,endsAt||null,newUsersOnly,isActive,req.params.id]);
   return req.params.id;
  });
  if(!id)return res.status(404).json({error:'Promotion introuvable.'});
  res.json({message:'Promotion mise à jour.'});
 }catch(error){next(error);}
});

router.get('/invoices',async(req,res,next)=>{
 const limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||25,1),100),offset=Math.min(Math.max(Number.parseInt(req.query.offset,10)||0,0),1000000);
 const status=String(req.query.status||'').trim();
 if(status&&!['draft','sent','paid','void'].includes(status))return res.status(400).json({error:'Statut de facture invalide.'});
 try{
  const where=status?'WHERE i.status=?':'',values=status?[status]:[];
  const [[count]]=await db.execute(`SELECT COUNT(*) total FROM platform_invoices i ${where}`,values);
  const [items]=await db.execute(
   `SELECT i.id,i.invoice_number,i.organization_id,i.subscription_id,i.promotion_id,
           DATE_FORMAT(i.period_start,'%Y-%m-%d') period_start,DATE_FORMAT(i.period_end,'%Y-%m-%d') period_end,
           i.subtotal,i.discount_amount,i.total_amount,i.currency,i.status,DATE_FORMAT(i.due_date,'%Y-%m-%d') due_date,i.paid_at,i.created_at,
           o.name organization_name
    FROM platform_invoices i JOIN organizations o ON o.id=i.organization_id ${where}
    ORDER BY i.created_at DESC,i.id DESC LIMIT ? OFFSET ?`,
   [...values,limit,offset]
  );
  res.json({items,total:Number(count.total),limit,offset});
 }catch(error){next(error);}
});

router.post('/invoices',async(req,res,next)=>{
 const {organization_id:organizationId,due_date:dueDate,period_start:periodStart,period_end:periodEnd,promotion_id:promotionId,notes}=req.body||{};
 if(!validId(organizationId)||!validDate(dueDate)||!validDate(periodStart)||!validDate(periodEnd)||periodEnd<periodStart||(promotionId&&!validId(promotionId))||(notes!==undefined&&(typeof notes!=='string'||notes.length>500)))return res.status(400).json({error:'Vérifiez l’établissement, les dates et les notes de la facture.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [subscriptions]=await connection.execute(
   `SELECT s.id,s.plan_id,s.contract_amount,s.billing_interval,s.max_users,s.selected_modules,
           p.plan_type,p.monthly_price,p.annual_price,p.biennial_price,p.extra_user_price,p.max_users plan_max_users,
           p.included_modules,p.module_prices,p.currency
    FROM subscriptions s JOIN plans p ON p.id=s.plan_id
    WHERE s.organization_id=? ORDER BY s.id DESC LIMIT 1 FOR UPDATE`,
   [organizationId]
  );
  if(!subscriptions.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Aucun abonnement à facturer pour cet établissement.'});}
  const subscription=subscriptions[0];
  let subtotal;
  try{
   subtotal=subscription.contract_amount!==null&&subscription.contract_amount!==undefined
    ?Number(subscription.contract_amount)
    :getTermPrice(subscription,subscription.billing_interval||'monthly',parseJson(subscription.selected_modules,getPlanModules(subscription)),Number(subscription.max_users||subscription.plan_max_users||1));
  }catch(error){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:`Impossible de calculer le tarif de l’abonnement : ${error.message}`});}
  if(!Number.isFinite(subtotal)||subtotal<0)return res.status(400).json({error:'Le montant de l’abonnement est invalide.'});
  let promotion=null,discount=0;
  if(promotionId){
   const [promotions]=await connection.execute('SELECT id,plan_id,discount_type,discount_value,new_users_only FROM platform_promotions WHERE id=? AND is_active=TRUE AND starts_at<=CURDATE() AND (ends_at IS NULL OR ends_at>=CURDATE()) FOR UPDATE',[promotionId]);
   if(!promotions.length){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Cette promotion est inactive ou hors période.'});}
   if(promotions[0].plan_id!==null&&String(promotions[0].plan_id)!==String(subscription.plan_id)){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Cette promotion ne s’applique pas au forfait de cet établissement.'});}
   if(promotions[0].new_users_only){
    const [[priorInvoices]]=await connection.execute('SELECT COUNT(*) total FROM platform_invoices WHERE organization_id=?',[organizationId]);
    if(Number(priorInvoices.total)>0){await connection.rollback();connection.release();connection=null;return res.status(400).json({error:'Cette promotion est réservée aux nouveaux clients sans facture antérieure.'});}
   }
   promotion=promotions[0];discount=promotion.discount_type==='percent'?subtotal*Number(promotion.discount_value)/100:Number(promotion.discount_value);discount=Math.min(subtotal,Math.round(discount*100)/100);
  }
  const total=Math.max(0,subtotal-discount),invoiceNumber=`RED-${Date.now()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  const [result]=await connection.execute(
   `INSERT INTO platform_invoices(invoice_number,organization_id,subscription_id,promotion_id,period_start,period_end,subtotal,discount_amount,total_amount,currency,status,due_date,notes,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`,
   [invoiceNumber,organizationId,subscription.id,promotion?.id||null,periodStart,periodEnd,subtotal,discount,total,subscription.currency,dueDate,notes?.trim()||null,req.user.id]
  );
  await writeEntityAudit(connection,req,organizationId,'PLATFORM_INVOICE_CREATED','platform_invoice',result.insertId,{invoice_number:invoiceNumber,total_amount:total,currency:subscription.currency});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({id:result.insertId,invoice_number:invoiceNumber,total_amount:total,currency:subscription.currency,message:'Facture créée en brouillon.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.patch('/invoices/:id/status',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de facture invalide.'});
 const status=req.body?.status;
 if(!['sent','paid','void'].includes(status))return res.status(400).json({error:'Choisissez un statut valide pour la facture.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [invoices]=await connection.execute('SELECT id,organization_id,subscription_id,invoice_number,total_amount,currency,status FROM platform_invoices WHERE id=? FOR UPDATE',[req.params.id]);
  if(!invoices.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Facture introuvable.'});}
  const invoice=invoices[0];
  if(invoice.status==='paid'||invoice.status==='void'||(status==='paid'&&invoice.status==='draft')){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Cette transition de statut de facture n’est pas autorisée.'});}
  if(invoice.status!==status){
   await connection.execute('UPDATE platform_invoices SET status=?,paid_at=? WHERE id=?',[status,status==='paid'?new Date():null,invoice.id]);
   if(status==='paid'){
    await connection.execute(
     "INSERT INTO subscription_payments(subscription_id,amount,currency,payment_status,provider,provider_reference,paid_at) VALUES(?,?,?,'paid','manual',?,CURRENT_TIMESTAMP)",
     [invoice.subscription_id,invoice.total_amount,invoice.currency,invoice.invoice_number]
    );
    await recordPaidInvoiceCommission(connection,invoice);
   }
   await writeEntityAudit(connection,req,invoice.organization_id,'PLATFORM_INVOICE_STATUS_CHANGED','platform_invoice',invoice.id,{from:invoice.status,to:status});
  }
  await connection.commit();connection.release();connection=null;
  res.json({message:'Statut de la facture mis à jour.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.get('/agents',async(req,res,next)=>{
 try{
  const [items]=await db.execute(
   `SELECT u.id,u.organization_id,o.name organization_name,u.full_name,u.email,u.is_active,COALESCE(p.is_available,FALSE) is_available,
           p.updated_at,
           (SELECT COUNT(*) FROM support_tickets t WHERE t.assigned_agent_id=u.id AND t.support_token IS NOT NULL AND t.status<>'closed') active_chats
    FROM users u JOIN organizations o ON o.id=u.organization_id LEFT JOIN support_agent_presence p ON p.user_id=u.id
    WHERE u.role='SUPER_ADMIN' ORDER BY u.is_active DESC,u.full_name`
  );
  res.json(items);
 }catch(error){next(error);}
});

router.post('/agents',async(req,res,next)=>{
 const fullName=typeof req.body?.full_name==='string'?req.body.full_name.trim():'';
 const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'';
 const password=typeof req.body?.password==='string'?req.body.password:'';
 if(fullName.length<2||fullName.length>180||!validEmail(email)||password.length<12||password.length>128)return res.status(400).json({error:'Saisissez un nom, une adresse valide et un mot de passe de 12 à 128 caractères.'});
 try{
  const hash=await bcrypt.hash(password,12);
  const id=await auditedMutation(req,req.tenantId,'PLATFORM_AGENT_CREATED','platform_agent',{email,full_name:fullName},async connection=>{
   const [existing]=await connection.execute('SELECT id FROM users WHERE email=? LIMIT 1 FOR UPDATE',[email]);
   if(existing.length)return null;
   const [result]=await connection.execute("INSERT INTO users(organization_id,full_name,email,password_hash,role,is_active) VALUES(?,?,?,?, 'SUPER_ADMIN',TRUE)",[req.tenantId,fullName,email,hash]);
   return result.insertId;
  });
  if(!id)return res.status(409).json({error:'Cette adresse est déjà utilisée par un compte de la plateforme ou d’un établissement.'});
  res.status(201).json({id,message:'Compte de l’équipe créé.'});
 }catch(error){next(error);}
});

router.patch('/agents/:id/active',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant d’agent invalide.'});
 if(typeof req.body?.active!=='boolean')return res.status(400).json({error:'Indiquez un état de compte valide.'});
 if(Number(req.params.id)===Number(req.user.id)&&!req.body.active)return res.status(400).json({error:'Vous ne pouvez pas désactiver votre propre compte.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  await connection.execute("SELECT id FROM users WHERE role='SUPER_ADMIN' FOR UPDATE");
  const [agents]=await connection.execute("SELECT id,organization_id,is_active FROM users WHERE id=? AND role='SUPER_ADMIN' FOR UPDATE",[req.params.id]);
  if(!agents.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Agent introuvable dans votre équipe.'});}
  if(agents[0].is_active&&!req.body.active){
   const [[activeCount]]=await connection.execute("SELECT COUNT(*) total FROM users WHERE role='SUPER_ADMIN' AND is_active=TRUE");
   if(Number(activeCount.total)<=1){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Le dernier compte actif de l’équipe ne peut pas être désactivé.'});}
  }
  await connection.execute('UPDATE users SET is_active=? WHERE id=?',[req.body.active,req.params.id]);
  if(!req.body.active)await connection.execute('UPDATE support_agent_presence SET is_available=FALSE WHERE user_id=?',[req.params.id]);
  await writeEntityAudit(connection,req,agents[0].organization_id,'PLATFORM_AGENT_STATUS_CHANGED','platform_agent',req.params.id,{from:Boolean(agents[0].is_active),to:req.body.active});
  await connection.commit();connection.release();connection=null;
  res.json({message:req.body.active?'Compte de l’équipe activé.':'Compte de l’équipe désactivé.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.put('/agents/presence',async(req,res,next)=>{
 if(typeof req.body?.available!=='boolean')return res.status(400).json({error:'Indiquez une disponibilité valide.'});
 try{
  await db.execute(
   `INSERT INTO support_agent_presence(user_id,is_available) VALUES(?,?)
    ON DUPLICATE KEY UPDATE is_available=VALUES(is_available)`,
   [req.user.id,req.body.available]
  );
  res.json({available:req.body.available,message:req.body.available?'Vous êtes disponible pour les demandes.':'Votre disponibilité a été désactivée.'});
 }catch(error){next(error);}
});

router.get('/support',async(req,res,next)=>{
 const status=String(req.query.status||'').trim(),query=String(req.query.q||'').trim().slice(0,120);
 if(status&&!validStatus(status))return res.status(400).json({error:'Le statut demandé est invalide.'});
 const limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||25,1),100),offset=Math.min(Math.max(Number.parseInt(req.query.offset,10)||0,0),1000000);
 const clauses=['t.support_token IS NOT NULL'],values=[];
 if(status){clauses.push('t.status=?');values.push(status);}
 if(query){clauses.push('(t.support_token LIKE ? OR t.subject LIKE ? OR t.message LIKE ? OR o.name LIKE ? OR u.full_name LIKE ?)');const pattern=`%${query}%`;values.push(pattern,pattern,pattern,pattern,pattern);}
 const where=clauses.join(' AND ');
 try{
  const [[count]]=await db.execute(`SELECT COUNT(*) total FROM support_tickets t JOIN organizations o ON o.id=t.organization_id JOIN users u ON u.id=t.user_id WHERE ${where}`,values);
  const [items]=await db.execute(
   `SELECT t.id,t.support_token token,t.organization_id,t.user_id,t.subject,t.message,t.status,t.created_at,
           t.assigned_agent_id,o.name organization_name,u.full_name requester_name,a.full_name agent_name,
           (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id=t.id AND m.organization_id=t.organization_id) reply_count
    FROM support_tickets t JOIN organizations o ON o.id=t.organization_id
    JOIN users u ON u.id=t.user_id LEFT JOIN users a ON a.id=t.assigned_agent_id
    WHERE ${where} ORDER BY (t.assigned_agent_id IS NULL) DESC,t.created_at ASC,t.id ASC LIMIT ? OFFSET ?`,
   [...values,limit,offset]
  );
  res.json({items,total:Number(count.total),limit,offset});
 }catch(error){next(error);}
});

router.get('/support/:id',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de chat invalide.'});
 try{
  const [tickets]=await db.execute(
   `SELECT t.id,t.support_token token,t.organization_id,t.user_id,t.subject,t.message,t.status,t.created_at,t.assigned_agent_id,
           o.name organization_name,u.full_name requester_name,a.full_name agent_name
    FROM support_tickets t JOIN organizations o ON o.id=t.organization_id
    JOIN users u ON u.id=t.user_id LEFT JOIN users a ON a.id=t.assigned_agent_id
    WHERE t.id=? AND t.support_token IS NOT NULL LIMIT 1`,
   [req.params.id]
  );
  if(!tickets.length)return res.status(404).json({error:'Chat introuvable.'});
  const [messages]=await db.execute(
   `SELECT m.id,m.user_id,m.message,m.created_at,COALESCE(u.full_name,ps.full_name,'Support REDAMS') full_name,(u.role='SUPER_ADMIN' OR m.staff_id IS NOT NULL) is_agent
    FROM support_ticket_messages m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN platform_staff ps ON ps.id=m.staff_id
    WHERE m.ticket_id=? AND m.organization_id=? ORDER BY m.created_at,m.id`,
   [tickets[0].id,tickets[0].organization_id]
  );
  res.json({ticket:tickets[0],messages});
 }catch(error){next(error);}
});

router.post('/support/:id/claim',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de chat invalide.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute(
   'SELECT id,organization_id,assigned_agent_id,status FROM support_tickets WHERE id=? AND support_token IS NOT NULL FOR UPDATE',
   [req.params.id]
  );
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Chat introuvable.'});}
  if(tickets[0].status==='closed'){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Ce chat est clôturé.'});}
  if(tickets[0].assigned_agent_id&&Number(tickets[0].assigned_agent_id)!==Number(req.user.id)){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Ce chat est déjà pris en charge par un autre agent.'});}
  await connection.execute("UPDATE support_tickets SET assigned_agent_id=?,status='in_progress' WHERE id=?",[req.user.id,req.params.id]);
  await connection.execute(
   `INSERT INTO support_agent_presence(user_id,is_available) VALUES(?,FALSE)
    ON DUPLICATE KEY UPDATE is_available=FALSE`,
   [req.user.id]
  );
  await writeAudit(connection,req,tickets[0].organization_id,'SUPPORT_CHAT_CLAIMED',req.params.id,{agent_id:req.user.id});
  await connection.commit();connection.release();connection=null;
  res.json({message:'Chat pris en charge.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.post('/support/:id/messages',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de chat invalide.'});
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(message.length<1||message.length>5000)return res.status(400).json({error:'Le message doit contenir 1 à 5 000 caractères.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute(
   'SELECT id,organization_id,assigned_agent_id,status FROM support_tickets WHERE id=? AND support_token IS NOT NULL FOR UPDATE',
   [req.params.id]
  );
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Chat introuvable.'});}
  if(Number(tickets[0].assigned_agent_id)!==Number(req.user.id)){await connection.rollback();connection.release();connection=null;return res.status(403).json({error:'Prenez en charge ce chat avant de répondre.'});}
  if(tickets[0].status==='closed'){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Ce chat est clôturé.'});}
  const [result]=await connection.execute(
   'INSERT INTO support_ticket_messages(organization_id,ticket_id,user_id,message) VALUES(?,?,?,?)',
   [tickets[0].organization_id,tickets[0].id,req.user.id,message]
  );
  await connection.execute("UPDATE support_tickets SET status='in_progress' WHERE id=?",[tickets[0].id]);
  await writeAudit(connection,req,tickets[0].organization_id,'SUPPORT_CHAT_REPLIED',tickets[0].id,{message_id:result.insertId});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({message:'Réponse envoyée.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.patch('/support/:id/status',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de chat invalide.'});
 const status=req.body?.status;
 if(!validStatus(status))return res.status(400).json({error:'Choisissez un statut valide.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute(
   'SELECT id,organization_id,status FROM support_tickets WHERE id=? AND support_token IS NOT NULL FOR UPDATE',
   [req.params.id]
  );
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Chat introuvable.'});}
  if(tickets[0].status!==status){
   await connection.execute('UPDATE support_tickets SET status=? WHERE id=?',[status,tickets[0].id]);
   await writeAudit(connection,req,tickets[0].organization_id,'SUPPORT_CHAT_STATUS_CHANGED',tickets[0].id,{from:tickets[0].status,to:status});
  }
  await connection.commit();connection.release();connection=null;
  res.json({message:'Statut du chat mis à jour.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.get('/support-requests',async(req,res,next)=>{
 const limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||25,1),100),offset=Math.min(Math.max(Number.parseInt(req.query.offset,10)||0,0),1000000);
 const status=String(req.query.status||'').trim(),query=String(req.query.q||'').trim().slice(0,120);
 if(status&&!validStatus(status))return res.status(400).json({error:'Le statut demandé est invalide.'});
 const clauses=['t.support_token IS NULL'],values=[];
 if(status){clauses.push('t.status=?');values.push(status);}
 if(query){clauses.push('(t.subject LIKE ? OR t.message LIKE ? OR o.name LIKE ? OR u.full_name LIKE ?)');const pattern=`%${query}%`;values.push(pattern,pattern,pattern,pattern);}
 const where=clauses.join(' AND ');
 try{
  const [[count]]=await db.execute(`SELECT COUNT(*) total FROM support_tickets t JOIN organizations o ON o.id=t.organization_id JOIN users u ON u.id=t.user_id WHERE ${where}`,values);
  const [items]=await db.execute(
   `SELECT t.id,t.organization_id,t.user_id,t.subject,t.message,t.status,t.created_at,t.assigned_agent_id,
           o.name organization_name,u.full_name requester_name,a.full_name agent_name,
           (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id=t.id AND m.organization_id=t.organization_id) reply_count
    FROM support_tickets t JOIN organizations o ON o.id=t.organization_id JOIN users u ON u.id=t.user_id
    LEFT JOIN users a ON a.id=t.assigned_agent_id WHERE ${where}
    ORDER BY t.created_at ASC,t.id ASC LIMIT ? OFFSET ?`,
   [...values,limit,offset]
  );
  res.json({items,total:Number(count.total),limit,offset});
 }catch(error){next(error);}
});

router.get('/support-requests/:id',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de demande invalide.'});
 try{
  const [tickets]=await db.execute(
   `SELECT t.id,t.organization_id,t.user_id,t.subject,t.message,t.status,t.created_at,t.assigned_agent_id,
           o.name organization_name,u.full_name requester_name,a.full_name agent_name
    FROM support_tickets t JOIN organizations o ON o.id=t.organization_id JOIN users u ON u.id=t.user_id
    LEFT JOIN users a ON a.id=t.assigned_agent_id WHERE t.id=? AND t.support_token IS NULL LIMIT 1`,
   [req.params.id]
  );
  if(!tickets.length)return res.status(404).json({error:'Demande introuvable.'});
  const [messages]=await db.execute(
   `SELECT m.id,m.user_id,m.message,m.created_at,COALESCE(u.full_name,ps.full_name,'Support REDAMS') full_name,(u.role='SUPER_ADMIN' OR m.staff_id IS NOT NULL) is_agent
    FROM support_ticket_messages m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN platform_staff ps ON ps.id=m.staff_id
    WHERE m.ticket_id=? AND m.organization_id=? ORDER BY m.created_at,m.id`,
   [tickets[0].id,tickets[0].organization_id]
  );
  res.json({ticket:tickets[0],messages});
 }catch(error){next(error);}
});

router.post('/support-requests/:id/messages',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de demande invalide.'});
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(message.length<1||message.length>5000)return res.status(400).json({error:'Le message doit contenir 1 à 5 000 caractères.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute('SELECT id,organization_id,status FROM support_tickets WHERE id=? AND support_token IS NULL FOR UPDATE',[req.params.id]);
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Demande introuvable.'});}
  const ticket=tickets[0];
  if(ticket.status==='closed'){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Cette demande est clôturée.'});}
  const [result]=await connection.execute('INSERT INTO support_ticket_messages(organization_id,ticket_id,user_id,message) VALUES(?,?,?,?)',[ticket.organization_id,ticket.id,req.user.id,message]);
  await connection.execute("UPDATE support_tickets SET status='in_progress',assigned_agent_id=? WHERE id=?",[req.user.id,ticket.id]);
  await writeEntityAudit(connection,req,ticket.organization_id,'PLATFORM_SUPPORT_REPLIED','support_ticket',ticket.id,{message_id:result.insertId});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({message:'Réponse envoyée.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.patch('/support-requests/:id/status',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de demande invalide.'});
 const status=req.body?.status;
 if(!validStatus(status))return res.status(400).json({error:'Choisissez un statut valide.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute('SELECT id,organization_id,status FROM support_tickets WHERE id=? AND support_token IS NULL FOR UPDATE',[req.params.id]);
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Demande introuvable.'});}
  const ticket=tickets[0];
  if(ticket.status!==status){
   await connection.execute('UPDATE support_tickets SET status=? WHERE id=?',[status,ticket.id]);
   await writeEntityAudit(connection,req,ticket.organization_id,'PLATFORM_SUPPORT_STATUS_CHANGED','support_ticket',ticket.id,{from:ticket.status,to:status});
  }
  await connection.commit();connection.release();connection=null;
  res.json({message:'Statut de la demande mis à jour.'});
 }catch(error){if(connection){try{await connection.rollback();}finally{connection.release();}}next(error);}
});

router.get('/faqs',async(req,res,next)=>{
 try{
  const [items]=await db.execute('SELECT id,question,answer,category,sort_order,is_active FROM platform_faqs ORDER BY sort_order,id');
  res.json(items);
 }catch(error){next(error);}
});

router.post('/faqs',async(req,res,next)=>{
 const {question,answer,category,sort_order:sortOrder,is_active:isActive}=req.body||{};
 if(typeof question!=='string'||question.trim().length<5||question.trim().length>255||typeof answer!=='string'||answer.trim().length<5||answer.length>10000||typeof category!=='string'||category.trim().length<2||category.trim().length>100||!Number.isInteger(Number(sortOrder))||typeof isActive!=='boolean')return res.status(400).json({error:'Vérifiez la question, la réponse, la catégorie et le rang.'});
 try{
  const id=await auditedMutation(req,req.tenantId,'PLATFORM_FAQ_CREATED','platform_faq',{question:question.trim()},async connection=>{
   const [result]=await connection.execute('INSERT INTO platform_faqs(question,answer,category,sort_order,is_active) VALUES(?,?,?,?,?)',[question.trim(),answer.trim(),category.trim(),Number(sortOrder),isActive]);
   return result.insertId;
  });
  res.status(201).json({id,message:'FAQ créée.'});
 }catch(error){next(error);}
});

router.patch('/faqs/:id',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de FAQ invalide.'});
 const {question,answer,category,sort_order:sortOrder,is_active:isActive}=req.body||{};
 if(typeof question!=='string'||question.trim().length<5||question.trim().length>255||typeof answer!=='string'||answer.trim().length<5||answer.length>10000||typeof category!=='string'||category.trim().length<2||category.trim().length>100||!Number.isInteger(Number(sortOrder))||typeof isActive!=='boolean')return res.status(400).json({error:'Vérifiez les données de la FAQ.'});
 try{
  const id=await auditedMutation(req,req.tenantId,'PLATFORM_FAQ_UPDATED','platform_faq',{question:question.trim()},async connection=>{
   const [existing]=await connection.execute('SELECT id FROM platform_faqs WHERE id=? FOR UPDATE',[req.params.id]);
   if(!existing.length)return null;
   await connection.execute('UPDATE platform_faqs SET question=?,answer=?,category=?,sort_order=?,is_active=? WHERE id=?',[question.trim(),answer.trim(),category.trim(),Number(sortOrder),isActive,req.params.id]);
   return req.params.id;
  });
  if(!id)return res.status(404).json({error:'FAQ introuvable.'});
  res.json({message:'FAQ mise à jour.'});
 }catch(error){next(error);}
});

router.get('/trainings',async(req,res,next)=>{
 try{
  const [items]=await db.execute('SELECT id,title,description,url,format,is_active,sort_order FROM platform_trainings ORDER BY sort_order,id');
  res.json(items);
 }catch(error){next(error);}
});

router.post('/trainings',async(req,res,next)=>{
 const {title,description,url,format,is_active:isActive,sort_order:sortOrder}=req.body||{};
 const safeUrl=url==null||url===''?null:String(url).trim();
 if(typeof title!=='string'||title.trim().length<2||title.trim().length>180||typeof description!=='string'||description.trim().length<5||description.length>10000||(safeUrl&&(!/^https?:\/\//i.test(safeUrl)||safeUrl.length>1000))||!['article','video','link'].includes(format)||typeof isActive!=='boolean'||!Number.isInteger(Number(sortOrder)))return res.status(400).json({error:'Vérifiez le titre, la description, le format et le lien de la formation.'});
 try{
  const id=await auditedMutation(req,req.tenantId,'PLATFORM_TRAINING_CREATED','platform_training',{title:title.trim()},async connection=>{
   const [result]=await connection.execute('INSERT INTO platform_trainings(title,description,url,format,is_active,sort_order) VALUES(?,?,?,?,?,?)',[title.trim(),description.trim(),safeUrl,format,isActive,Number(sortOrder)]);
   return result.insertId;
  });
  res.status(201).json({id,message:'Ressource de formation créée.'});
 }catch(error){next(error);}
});

router.patch('/trainings/:id',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de ressource invalide.'});
 const {title,description,url,format,is_active:isActive,sort_order:sortOrder}=req.body||{};
 const safeUrl=url==null||url===''?null:String(url).trim();
 if(typeof title!=='string'||title.trim().length<2||title.trim().length>180||typeof description!=='string'||description.trim().length<5||description.length>10000||(safeUrl&&(!/^https?:\/\//i.test(safeUrl)||safeUrl.length>1000))||!['article','video','link'].includes(format)||typeof isActive!=='boolean'||!Number.isInteger(Number(sortOrder)))return res.status(400).json({error:'Vérifiez les données de la formation.'});
 try{
  const id=await auditedMutation(req,req.tenantId,'PLATFORM_TRAINING_UPDATED','platform_training',{title:title.trim()},async connection=>{
   const [existing]=await connection.execute('SELECT id FROM platform_trainings WHERE id=? FOR UPDATE',[req.params.id]);
   if(!existing.length)return null;
   await connection.execute('UPDATE platform_trainings SET title=?,description=?,url=?,format=?,is_active=?,sort_order=? WHERE id=?',[title.trim(),description.trim(),safeUrl,format,isActive,Number(sortOrder),req.params.id]);
   return req.params.id;
  });
  if(!id)return res.status(404).json({error:'Ressource de formation introuvable.'});
  res.json({message:'Ressource de formation mise à jour.'});
 }catch(error){next(error);}
});

module.exports=router;
