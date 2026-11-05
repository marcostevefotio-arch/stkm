const router=require('express').Router();
const db=require('../config/database');
const {randomBytes}=require('crypto');

const isAdministrator=req=>['OWNER','ADMIN'].includes(req.user?.role);
const validId=value=>/^[1-9]\d{0,19}$/.test(String(value||''));
const validStatuses=new Set(['open','in_progress','closed']);
const validChatToken=value=>/^[A-F0-9]{32}$/.test(String(value||''));
const isPlatformAgent=req=>req.user?.role==='SUPER_ADMIN';

async function writeAudit(connection,req,action,ticketId,details){
 await connection.execute(
  'INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',
  [req.tenantId,req.user.id,action,'support_ticket',String(ticketId),JSON.stringify(details)]
 );
}

function ticketVisibility(req){
 return isAdministrator(req)?'t.organization_id=?':'t.organization_id=? AND t.user_id=?';
}

function visibilityValues(req){
 return isAdministrator(req)?[req.tenantId]:[req.tenantId,req.user.id];
}

router.get('/faq',async(req,res,next)=>{
 try{
  const [items]=await db.execute('SELECT id,question,answer,category FROM platform_faqs WHERE is_active=TRUE ORDER BY sort_order,id');
  res.json(items);
 }catch(error){next(error);}
});

router.get('/trainings',async(req,res,next)=>{
 try{
  const [items]=await db.execute('SELECT id,title,description,url,format FROM platform_trainings WHERE is_active=TRUE ORDER BY sort_order,id');
  res.json(items);
 }catch(error){next(error);}
});

router.get('/',async(req,res,next)=>{
 try{
  const status=String(req.query.status||'').trim();
  if(status&&!validStatuses.has(status))return res.status(400).json({error:'Le statut demandé est invalide.'});
  const limit=Math.min(Math.max(Number.parseInt(req.query.limit,10)||25,1),100);
  const offset=Math.min(Math.max(Number.parseInt(req.query.offset,10)||0,0),1000000);
  const query=String(req.query.q||'').trim().slice(0,120),clauses=[ticketVisibility(req)],values=visibilityValues(req);
  if(status){clauses.push('t.status=?');values.push(status);}
  if(query){clauses.push('(t.subject LIKE ? OR t.message LIKE ? OR u.full_name LIKE ?)');const pattern=`%${query}%`;values.push(pattern,pattern,pattern);}
  const where=clauses.join(' AND ');
  const [[count]]=await db.execute(`SELECT COUNT(*) total FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE ${where}`,values);
  const [rows]=await db.execute(
   `SELECT t.id,t.user_id,t.subject,t.message,t.status,t.created_at,u.full_name requester_name,
           (SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id=t.id AND m.organization_id=t.organization_id) reply_count
    FROM support_tickets t JOIN users u ON u.id=t.user_id
    WHERE ${where} ORDER BY t.created_at DESC,t.id DESC LIMIT ? OFFSET ?`,
   [...values,limit,offset]
  );
  res.json({items:rows,total:Number(count.total),limit,offset});
 }catch(error){next(error);}
});

router.post('/',async(req,res,next)=>{
 const subject=typeof req.body?.subject==='string'?req.body.subject.trim():'';
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(subject.length<4||subject.length>190||message.length<10||message.length>5000)return res.status(400).json({error:'Le sujet doit contenir 4 à 190 caractères et la description 10 à 5 000 caractères.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [result]=await connection.execute(
   'INSERT INTO support_tickets(organization_id,user_id,subject,message,status) VALUES(?,?,?,? ,?)',
   [req.tenantId,req.user.id,subject,message,'open']
  );
  await writeAudit(connection,req,'SUPPORT_TICKET_CREATED',result.insertId,{subject});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({id:result.insertId,message:'Votre demande d’assistance a été créée.'});
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  next(error);
 }
});

router.get('/chat/current',async(req,res,next)=>{
 try{
  const [rows]=await db.execute(
   `SELECT support_token token,status,assigned_agent_id FROM support_tickets
    WHERE organization_id=? AND user_id=? AND support_token IS NOT NULL AND status<>'closed'
    ORDER BY created_at DESC,id DESC LIMIT 1`,
   [req.tenantId,req.user.id]
  );
  res.json(rows[0]||null);
 }catch(error){next(error);}
});

router.post('/chat',async(req,res,next)=>{
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(message.length<10||message.length>5000)return res.status(400).json({error:'Décrivez votre demande en 10 à 5 000 caractères.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [existing]=await connection.execute(
   `SELECT support_token token,status FROM support_tickets
    WHERE organization_id=? AND user_id=? AND support_token IS NOT NULL AND status<>'closed'
    ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
   [req.tenantId,req.user.id]
  );
  if(existing.length){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Vous avez déjà un chat ouvert.',token:existing[0].token,status:existing[0].status});}
  const [agents]=await connection.execute(
   `SELECT p.user_id FROM support_agent_presence p
    JOIN users u ON u.id=p.user_id AND u.role='SUPER_ADMIN' AND u.is_active=TRUE
    WHERE p.is_available=TRUE ORDER BY p.updated_at,p.user_id LIMIT 1 FOR UPDATE`,
   []
  );
  const assignedAgent=agents[0]?.user_id||null,token=randomBytes(16).toString('hex').toUpperCase();
  const [result]=await connection.execute(
   `INSERT INTO support_tickets(organization_id,user_id,subject,message,status,support_token,assigned_agent_id)
    VALUES(?,?, 'Chat assistance',?,'open',?,?)`,
   [req.tenantId,req.user.id,message,token,assignedAgent]
  );
  if(assignedAgent)await connection.execute('UPDATE support_agent_presence SET is_available=FALSE WHERE user_id=?',[assignedAgent]);
  await writeAudit(connection,req,'SUPPORT_CHAT_STARTED',result.insertId,{token,assigned_agent_id:assignedAgent});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({ticket_id:result.insertId,token,status:'open',assigned:Boolean(assignedAgent),message:'Chat ouvert. Conservez votre jeton pour retrouver la conversation.'});
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  next(error);
 }
});

router.get('/chat/:token',async(req,res,next)=>{
 const token=String(req.params.token||'').toUpperCase();
 if(!validChatToken(token))return res.status(400).json({error:'Jeton de chat invalide.'});
 try{
  const [tickets]=await db.execute(
   `SELECT t.id,t.support_token token,t.status,t.subject,t.created_at,
           t.organization_id,t.user_id,t.assigned_agent_id,
           a.full_name agent_name,o.name organization_name,u.full_name requester_name
    FROM support_tickets t LEFT JOIN users a ON a.id=t.assigned_agent_id
    JOIN organizations o ON o.id=t.organization_id JOIN users u ON u.id=t.user_id
    WHERE t.support_token=? AND ${isPlatformAgent(req)?'1=1':'t.organization_id=? AND t.user_id=?'} LIMIT 1`,
   isPlatformAgent(req)?[token]:[token,req.tenantId,req.user.id]
  );
  if(!tickets.length)return res.status(404).json({error:'Chat introuvable.'});
  const [messages]=await db.execute(
   `SELECT m.id,m.user_id,m.message,m.created_at,u.full_name,
           (u.role='SUPER_ADMIN') is_agent
    FROM support_ticket_messages m JOIN users u ON u.id=m.user_id
    WHERE m.ticket_id=? AND m.organization_id=? ORDER BY m.created_at,m.id`,
   [tickets[0].id,tickets[0].organization_id]
  );
  res.json({ticket:tickets[0],messages});
 }catch(error){next(error);}
});

router.post('/chat/:token/messages',async(req,res,next)=>{
 const token=String(req.params.token||'').toUpperCase();
 if(!validChatToken(token))return res.status(400).json({error:'Jeton de chat invalide.'});
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(message.length<1||message.length>5000)return res.status(400).json({error:'Le message doit contenir 1 à 5 000 caractères.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute(
   `SELECT id,organization_id,user_id,assigned_agent_id,status FROM support_tickets
    WHERE support_token=? AND ${isPlatformAgent(req)?'1=1':'organization_id=? AND user_id=?'} FOR UPDATE`,
   isPlatformAgent(req)?[token]:[token,req.tenantId,req.user.id]
  );
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Chat introuvable.'});}
  if(tickets[0].status==='closed'){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Ce chat est clôturé.'});}
  if(isPlatformAgent(req)&&Number(tickets[0].assigned_agent_id)!==Number(req.user.id)){await connection.rollback();connection.release();connection=null;return res.status(403).json({error:'Prenez en charge ce chat avant de répondre.'});}
  await connection.execute(
   'INSERT INTO support_ticket_messages(organization_id,ticket_id,user_id,message) VALUES(?,?,?,?)',
   [tickets[0].organization_id,tickets[0].id,req.user.id,message]
  );
  await connection.execute("UPDATE support_tickets SET status='in_progress' WHERE id=? AND organization_id=? AND status='open'",[tickets[0].id,tickets[0].organization_id]);
  if(!isPlatformAgent(req))await writeAudit(connection,req,'SUPPORT_CHAT_REPLIED',tickets[0].id,{});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({message:'Message envoyé.'});
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  next(error);
 }
});

router.get('/:id',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de demande invalide.'});
 try{
  const [tickets]=await db.execute(
   `SELECT t.id,t.user_id,t.subject,t.message,t.status,t.created_at,u.full_name requester_name
    FROM support_tickets t JOIN users u ON u.id=t.user_id
    WHERE t.id=? AND ${ticketVisibility(req)} LIMIT 1`,
   [req.params.id,...visibilityValues(req)]
  );
  if(!tickets.length)return res.status(404).json({error:'Demande introuvable.'});
  const [messages]=await db.execute(
   `SELECT m.id,m.user_id,m.message,m.created_at,u.full_name
    FROM support_ticket_messages m JOIN users u ON u.id=m.user_id
    WHERE m.ticket_id=? AND m.organization_id=? ORDER BY m.created_at,m.id`,
   [req.params.id,req.tenantId]
  );
  res.json({ticket:tickets[0],messages});
 }catch(error){next(error);}
});

router.post('/:id/messages',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de demande invalide.'});
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(message.length<2||message.length>5000)return res.status(400).json({error:'Le message doit contenir 2 à 5 000 caractères.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute(
   `SELECT t.id,t.status,t.subject FROM support_tickets t
    WHERE t.id=? AND ${ticketVisibility(req)} FOR UPDATE`,
   [req.params.id,...visibilityValues(req)]
  );
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Demande introuvable.'});}
  if(tickets[0].status==='closed'){await connection.rollback();connection.release();connection=null;return res.status(409).json({error:'Cette demande est clôturée. Contactez un administrateur pour la rouvrir.'});}
  const [result]=await connection.execute(
   'INSERT INTO support_ticket_messages(organization_id,ticket_id,user_id,message) VALUES(?,?,?,?)',
   [req.tenantId,req.params.id,req.user.id,message]
  );
  await connection.execute("UPDATE support_tickets SET status='in_progress' WHERE id=? AND organization_id=? AND status='open'",[req.params.id,req.tenantId]);
  await writeAudit(connection,req,'SUPPORT_TICKET_REPLIED',req.params.id,{message_id:result.insertId});
  await connection.commit();connection.release();connection=null;
  res.status(201).json({message:'Réponse ajoutée à la demande.'});
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  next(error);
 }
});

router.patch('/:id/status',async(req,res,next)=>{
 if(!validId(req.params.id))return res.status(400).json({error:'Identifiant de demande invalide.'});
 const status=req.body?.status;
 if(!validStatuses.has(status))return res.status(400).json({error:'Choisissez un statut valide.'});
 let connection;
 try{
  connection=await db.getConnection();await connection.beginTransaction();
  const [tickets]=await connection.execute(
   `SELECT t.id,t.status,t.subject FROM support_tickets t
    WHERE t.id=? AND ${ticketVisibility(req)} FOR UPDATE`,
   [req.params.id,...visibilityValues(req)]
  );
  if(!tickets.length){await connection.rollback();connection.release();connection=null;return res.status(404).json({error:'Demande introuvable.'});}
  if(!isAdministrator(req)&&!(Number(tickets[0].user_id)===Number(req.user.id)&&status==='closed')){
   await connection.rollback();connection.release();connection=null;return res.status(403).json({error:'Seuls les administrateurs peuvent modifier le statut de cette demande.'});
  }
  if(tickets[0].status===status){await connection.rollback();connection.release();connection=null;return res.json({message:'Le statut de la demande est inchangé.'});}
  await connection.execute('UPDATE support_tickets SET status=? WHERE id=? AND organization_id=?',[status,req.params.id,req.tenantId]);
  await writeAudit(connection,req,'SUPPORT_TICKET_STATUS_CHANGED',req.params.id,{from:tickets[0].status,to:status});
  await connection.commit();connection.release();connection=null;
  res.json({message:'Statut de la demande mis à jour.'});
 }catch(error){
  if(connection){try{await connection.rollback();}finally{connection.release();}}
  next(error);
 }
});

module.exports=router;
