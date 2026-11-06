const jwt=require('jsonwebtoken'),db=require('../config/database');
async function authenticate(req,res,next){
 const h=req.headers.authorization||'', token=h.startsWith('Bearer ')?h.slice(7):null;
 if(!token)return res.status(401).json({error:'Authentification requise.'});
 let p;
 try{p=jwt.verify(token,process.env.JWT_SECRET);}
 catch(error){return res.status(401).json({error:'Session invalide ou expirée.'});}
 try{
  const [r]=await db.execute(
   `SELECT u.id,u.organization_id,u.full_name,u.email,u.role,u.is_active,u.password_version,
           o.name organization_name,o.status organization_status
           ,p.plan_type subscription_plan_type,
           CASE WHEN s.status='trialing' AND s.current_period_end>CURDATE() THEN NULL
                WHEN p.plan_type='customized' THEN s.selected_modules ELSE p.included_modules END subscription_modules,
           s.max_users subscription_max_users
    FROM users u JOIN organizations o ON o.id=u.organization_id
    LEFT JOIN subscriptions s ON s.id=(SELECT MAX(s2.id) FROM subscriptions s2 WHERE s2.organization_id=u.organization_id)
    LEFT JOIN plans p ON p.id=IF(s.status='trialing' AND s.current_period_end>CURDATE(),s.plan_id,COALESCE(s.target_plan_id,s.plan_id))
    WHERE u.id=? LIMIT 1`,
   [p.sub]
  );
  if(!r.length||!r[0].is_active)return res.status(401).json({error:'Compte inactif.'});
  if(r[0].role!=='SUPER_ADMIN'&&r[0].organization_status&&r[0].organization_status!=='active')return res.status(403).json({error:'L’établissement est suspendu ou fermé. Contactez l’assistance REDAMS.'});
  if(Number(p.pv||0)!==Number(r[0].password_version||0))return res.status(401).json({error:'Mot de passe modifié. Reconnectez-vous.'});
  req.user=r[0];req.tenantId=Number(r[0].organization_id);next();
 }catch(error){next(error);}
}
const requireRole=(...roles)=>(req,res,next)=>roles.includes(req.user?.role)?next():res.status(403).json({error:'Permission insuffisante.'});
module.exports={authenticate,requireRole};
