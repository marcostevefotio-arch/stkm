const router=require('express').Router();
const db=require('../config/database');
const {audit}=require('../services/audit.service');
const {requireRole}=require('../middleware/auth');
const allowCash=requireRole('OWNER','ADMIN','PHARMACIST','CASHIER');
const methods=new Set(['cash','mobile_money','bank_transfer','insurance','other']);
const amountIsValid=value=>((typeof value==='number'&&Number.isFinite(value))||(typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))))&&Number(value)>=0&&Number(value)<=999999999999&&Math.abs(Number(value)*100-Math.round(Number(value)*100))<1e-7;
const round=value=>Math.round((Number(value)+Number.EPSILON)*100)/100;
router.use(allowCash);

router.get('/',async(req,res,next)=>{
 try{
  const [sessions]=await db.execute(
   `SELECT id,opening_cash,expected_cash,closing_cash,variance,status,opened_at,closed_at
    FROM cash_sessions WHERE organization_id=? ORDER BY id DESC LIMIT 50`,
   [req.tenantId]
  );
  const current=sessions.find(session=>session.status==='open')||null;
  let summary=null;
  if(current){
   const [rows]=await db.execute(
    `SELECT payment_method,
      COALESCE(SUM(CASE WHEN movement_type IN ('sale','income') THEN amount WHEN movement_type IN ('expense','refund') THEN -amount ELSE 0 END),0) net_amount,
      COALESCE(SUM(CASE WHEN movement_type IN ('sale','income') THEN 1 ELSE 0 END),0) inflow_count,
      COALESCE(SUM(CASE WHEN movement_type IN ('expense','refund') THEN 1 ELSE 0 END),0) outflow_count
     FROM cash_movements WHERE session_id=? GROUP BY payment_method`,
    [current.id]
   );
   const cashNet=rows.filter(row=>row.payment_method==='cash').reduce((sum,row)=>sum+Number(row.net_amount),0);
   summary={expected_cash:round(Number(current.opening_cash)+cashNet),by_method:rows};
  }
  const [movements]=await db.execute(
   `SELECT m.id,m.session_id,m.movement_type,m.payment_method,m.amount,m.cash_received,m.cash_change,
     m.description,m.invoice_id,m.created_at,u.full_name user_name
    FROM cash_movements m JOIN users u ON u.id=m.recorded_by
    WHERE m.organization_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 200`,
   [req.tenantId]
  );
  res.json({current_session:current,summary,sessions,movements});
 }catch(error){next(error);}
});
router.post('/sessions',async(req,res,next)=>{
 const openingCash=req.body?.opening_cash;
 if(!amountIsValid(openingCash))return res.status(400).json({error:'Le fond de caisse initial doit être un montant positif ou nul.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  await connection.execute('SELECT id FROM organizations WHERE id=? FOR UPDATE',[req.tenantId]);
  const [open]=await connection.execute("SELECT id FROM cash_sessions WHERE organization_id=? AND status='open' LIMIT 1 FOR UPDATE",[req.tenantId]);
  if(open.length)throw Object.assign(Error('Une session de caisse est déjà ouverte.'),{status:409});
  const [created]=await connection.execute(
   'INSERT INTO cash_sessions(organization_id,opened_by,opening_cash) VALUES(?,?,?)',
   [req.tenantId,req.user.id,round(openingCash)]
  );
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'CASH_SESSION_OPENED',entityType:'cash_session',entityId:created.insertId,details:{openingCash:round(openingCash)}});
  res.status(201).json({id:created.insertId,message:'Session de caisse ouverte.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
});
router.post('/sessions/:id/close',async(req,res,next)=>{
 const closingCash=req.body?.closing_cash;
 if(!amountIsValid(closingCash))return res.status(400).json({error:'Le montant compté doit être un montant positif ou nul.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [sessions]=await connection.execute(
   "SELECT id,opening_cash FROM cash_sessions WHERE id=? AND organization_id=? AND status='open' FOR UPDATE",
   [req.params.id,req.tenantId]
  );
  if(!sessions.length)throw Object.assign(Error('Session ouverte introuvable.'),{status:404});
  const [[movements]]=await connection.execute(
   `SELECT COALESCE(SUM(CASE WHEN movement_type IN ('sale','income') THEN amount WHEN movement_type IN ('expense','refund') THEN -amount ELSE 0 END),0) net_cash
    FROM cash_movements WHERE session_id=? AND payment_method='cash'`,
   [req.params.id]
  );
  const expected=round(Number(sessions[0].opening_cash)+Number(movements.net_cash)),actual=round(closingCash),variance=round(actual-expected);
  await connection.execute(
   "UPDATE cash_sessions SET expected_cash=?,closing_cash=?,variance=?,status='closed',closed_by=?,closed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='open'",
   [expected,actual,variance,req.user.id,req.params.id,req.tenantId]
  );
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:'CASH_SESSION_CLOSED',entityType:'cash_session',entityId:req.params.id,details:{expectedCash:expected,closingCash:actual,variance}});
  res.json({message:'Session clôturée.',expected_cash:expected,closing_cash:actual,variance});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
});
router.post('/movements',async(req,res,next)=>{
 const body=req.body||{},type=body.movement_type,method=body.payment_method,amount=body.amount,description=typeof body.description==='string'?body.description.trim():'';
 if(!['income','expense'].includes(type)||!methods.has(method)||!amountIsValid(amount)||Number(amount)<=0||description.length<3||description.length>255)return res.status(400).json({error:'Type, mode, montant et motif valide requis.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [sessions]=await connection.execute("SELECT id FROM cash_sessions WHERE organization_id=? AND status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE",[req.tenantId]);
  if(!sessions.length)throw Object.assign(Error('Ouvrez une session de caisse avant d’enregistrer un mouvement.'),{status:409});
  const [created]=await connection.execute(
   `INSERT INTO cash_movements(organization_id,session_id,movement_type,payment_method,amount,cash_received,description,recorded_by)
    VALUES(?,?,?,?,?,?,?,?)`,
   [req.tenantId,sessions[0].id,type,method,round(amount),method==='cash'?round(amount):0,description,req.user.id]
  );
  await connection.commit();connection.release();connection=null;
  await audit({tenantId:req.tenantId,userId:req.user.id,action:type==='income'?'CASH_INCOME_RECORDED':'CASH_EXPENSE_RECORDED',entityType:'cash_movement',entityId:created.insertId,details:{method,amount:round(amount),description}});
  res.status(201).json({id:created.insertId,message:type==='income'?'Recette enregistrée.':'Dépense enregistrée.'});
 }catch(error){if(connection){await connection.rollback();connection.release();}if(error.status)return res.status(error.status).json({error:error.message});next(error);}
});
module.exports=router;
