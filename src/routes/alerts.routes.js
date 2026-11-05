const router=require('express').Router(),db=require('../config/database'),{parseJson}=require('../config/pricing');

const has=(req,feature)=>{
 if(req.user?.role==='SUPER_ADMIN')return true;
 const raw=req.user?.subscription_modules;
 if(raw===null||raw===undefined)return true;
 const modules=parseJson(raw,null);
 return Array.isArray(modules)&&modules.includes(feature);
};
const rank={danger:0,warning:1,info:2};

router.get('/',async(req,res,next)=>{
 try{
  const role=req.user.role,tenant=req.tenantId,alerts=[];
  const canStock=has(req,'stock')&&['OWNER','ADMIN','STOREKEEPER','PHARMACIST','SUPER_ADMIN'].includes(role);
  const canCash=has(req,'cash')&&['OWNER','ADMIN','CASHIER','PHARMACIST','SUPER_ADMIN'].includes(role);
  const canPatients=has(req,'patients')&&['OWNER','ADMIN','PHARMACIST','SUPER_ADMIN'].includes(role);

  if(canStock){
   const [rows]=await db.execute('SELECT name,quantity_on_hand,reorder_level,unit FROM products WHERE organization_id=? AND is_active=1 AND quantity_on_hand<=reorder_level ORDER BY quantity_on_hand,name LIMIT 200',[tenant]);
   const out=rows.filter(row=>Number(row.quantity_on_hand)<=0),low=rows.filter(row=>Number(row.quantity_on_hand)>0);
   const names=list=>list.slice(0,3).map(row=>row.name).join(', ')+(list.length>3?`… (+${list.length-3})`:'');
   if(out.length)alerts.push({id:'stock-out',type:'stock',severity:'danger',title:`${out.length} produit(s) en rupture de stock`,message:names(out),page:'alerts',count:out.length});
   if(low.length)alerts.push({id:'stock-low',type:'stock',severity:'warning',title:`${low.length} produit(s) sous le seuil de réapprovisionnement`,message:names(low),page:'alerts',count:low.length});
  }

  if(canCash){
   const [open]=await db.execute("SELECT id,opened_at FROM cash_sessions WHERE organization_id=? AND status='open' AND opened_at<NOW()-INTERVAL 24 HOUR ORDER BY opened_at LIMIT 5",[tenant]);
   for(const session of open)alerts.push({id:`cash-open-${session.id}`,type:'cash',severity:'warning',title:'Session de caisse ouverte depuis plus de 24 h',message:`Ouverte le ${new Date(session.opened_at).toLocaleString('fr-FR')}. Pensez à la clôturer.`,page:'cash',created_at:session.opened_at});
   const [gaps]=await db.execute("SELECT id,variance,closed_at FROM cash_sessions WHERE organization_id=? AND status='closed' AND variance IS NOT NULL AND variance<>0 AND closed_at>=NOW()-INTERVAL 7 DAY ORDER BY closed_at DESC LIMIT 5",[tenant]);
   for(const session of gaps)alerts.push({id:`cash-gap-${session.id}`,type:'cash',severity:'danger',title:`Écart de caisse de ${Number(session.variance)>0?'+':''}${Number(session.variance)}`,message:`Session n° ${session.id} clôturée le ${new Date(session.closed_at).toLocaleString('fr-FR')}.`,page:'cash',created_at:session.closed_at});
  }

  if(canPatients){
   const [rows]=await db.execute(
    `SELECT h.id,h.condition_name,h.created_at,p.full_name,p.patient_code
     FROM patient_medical_history h
     JOIN patients p ON p.id=h.patient_id AND p.organization_id=h.organization_id
     WHERE h.organization_id=? AND h.is_active=1 AND h.created_at>=NOW()-INTERVAL 30 DAY
       AND EXISTS(SELECT 1 FROM patient_medical_history o WHERE o.organization_id=h.organization_id AND o.patient_id=h.patient_id AND o.is_active=1 AND o.id<h.id AND o.condition_name=h.condition_name AND o.status IN ('resolved','in_remission'))
     ORDER BY h.created_at DESC LIMIT 10`,[tenant]);
   for(const row of rows)alerts.push({id:`recurrence-${row.id}`,type:'patient',severity:'warning',title:'Récidive possible à vérifier',message:`${row.full_name} (${row.patient_code}) : ${row.condition_name}. Vérification professionnelle requise.`,page:'patients',created_at:row.created_at});
  }

  const [tickets]=await db.execute(
   `SELECT t.id,t.subject,t.status,
           (SELECT MAX(m.created_at) FROM support_ticket_messages m WHERE m.ticket_id=t.id AND m.organization_id=t.organization_id AND m.user_id<>t.user_id) last_reply
    FROM support_tickets t
    WHERE t.organization_id=? AND t.user_id=? AND t.status<>'closed'
    HAVING last_reply IS NOT NULL AND last_reply>=NOW()-INTERVAL 7 DAY
    ORDER BY last_reply DESC LIMIT 5`,[tenant,req.user.id]);
  for(const ticket of tickets)alerts.push({id:`support-${ticket.id}`,type:'support',severity:'info',title:'Réponse de l’assistance',message:ticket.subject,page:'help',created_at:ticket.last_reply});

  alerts.sort((a,b)=>rank[a.severity]-rank[b.severity]);
  res.json({total:alerts.length,alerts});
 }catch(error){next(error);}
});

module.exports=router;
