const router=require('express').Router(),db=require('../config/database'),{requireRole}=require('../middleware/auth');
const canSend=requireRole('OWNER','ADMIN');

router.get('/',async(req,res,next)=>{try{
 const offset=Math.min(Math.max(Number.parseInt(req.query.offset,10)||0,0),1000000);
 const [rows]=await db.execute(`SELECT n.id,n.title,n.message,n.audience,n.created_at,u.full_name sender_name,nr.read_at
 FROM notifications n JOIN users u ON u.id=n.created_by
 LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=?
 WHERE n.organization_id=? AND (n.audience='organization' OR n.recipient_user_id=?)
 ORDER BY n.created_at DESC,n.id DESC LIMIT 50 OFFSET ?`,[req.user.id,req.tenantId,req.user.id,offset]);
 const [[counts]]=await db.execute(`SELECT COUNT(*) total,COALESCE(SUM(nr.notification_id IS NULL),0) unread
 FROM notifications n LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=?
 WHERE n.organization_id=? AND (n.audience='organization' OR n.recipient_user_id=?)`,[req.user.id,req.tenantId,req.user.id]);
 const total=Number(counts.total),unreadCount=Number(counts.unread);
 res.json({items:rows,total,unreadCount,hasMore:offset+rows.length<total});
}catch(e){next(e);}});

router.get('/recipients',canSend,async(req,res,next)=>{try{
 const [rows]=await db.execute('SELECT id,full_name,email FROM users WHERE organization_id=? AND is_active=TRUE ORDER BY full_name',[req.tenantId]);
 res.json(rows);
}catch(e){next(e);}});

router.post('/',canSend,async(req,res,next)=>{try{
 const title=String(req.body?.title||'').trim(),message=String(req.body?.message||'').trim(),audience=req.body?.audience;
 if(!title||title.length>180||!message||!['organization','user'].includes(audience))return res.status(400).json({error:'Titre, message et destinataire valides requis.'});
 let recipientId=null;
 if(audience==='user'){
  recipientId=String(req.body?.recipientUserId||'');
  if(!/^\d+$/.test(recipientId))return res.status(400).json({error:'Destinataire invalide.'});
  const [recipients]=await db.execute('SELECT id FROM users WHERE id=? AND organization_id=? AND is_active=TRUE LIMIT 1',[recipientId,req.tenantId]);
  if(!recipients.length)return res.status(400).json({error:'Destinataire introuvable dans cet établissement.'});
 }
 const [result]=await db.execute('INSERT INTO notifications(organization_id,title,message,audience,recipient_user_id,created_by) VALUES(?,?,?,?,?,?)',[req.tenantId,title,message,audience,recipientId,req.user.id]);
 res.status(201).json({id:result.insertId});
}catch(e){next(e);}});

router.post('/:id/read',async(req,res,next)=>{try{
 const id=String(req.params.id);
 if(!/^\d+$/.test(id))return res.status(400).json({error:'Notification invalide.'});
 const [rows]=await db.execute(`SELECT id FROM notifications WHERE id=? AND organization_id=?
 AND (audience='organization' OR recipient_user_id=?) LIMIT 1`,[id,req.tenantId,req.user.id]);
 if(!rows.length)return res.status(404).json({error:'Notification introuvable.'});
 await db.execute('INSERT INTO notification_reads(notification_id,user_id) VALUES(?,?) ON DUPLICATE KEY UPDATE read_at=COALESCE(read_at,CURRENT_TIMESTAMP)',[id,req.user.id]);
 res.json({read:true});
}catch(e){next(e);}});

module.exports=router;
