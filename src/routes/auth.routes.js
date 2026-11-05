const router=require('express').Router(),db=require('../config/database'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),{authenticate}=require('../middleware/auth');
router.post('/login',async(req,res,next)=>{try{
 const {email,password}=req.body||{};if(!email||!password)return res.status(400).json({error:'Email et mot de passe requis.'});
 const [r]=await db.execute(`SELECT u.id,u.organization_id,u.full_name,u.email,u.password_hash,u.password_version,u.role,u.is_active,o.name organization_name,o.status organization_status FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.email=? LIMIT 1`,[String(email).trim().toLowerCase()]);
 if(!r.length||!r[0].is_active||!(await bcrypt.compare(password,r[0].password_hash)))return res.status(401).json({error:'Identifiants incorrects.'});
 const u=r[0];if(u.role!=='SUPER_ADMIN'&&u.organization_status!=='active')return res.status(403).json({error:'L’établissement est suspendu ou fermé. Contactez l’assistance REDAMS.'});
 const token=jwt.sign({sub:u.id,pv:Number(u.password_version||0)},process.env.JWT_SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});delete u.password_hash;delete u.password_version;res.json({token,user:u});
 }catch(e){next(e);}});
router.put('/password',authenticate,async(req,res,next)=>{
 try{
  const currentPassword=req.body?.current_password,newPassword=req.body?.new_password;
  if(typeof currentPassword!=='string'||typeof newPassword!=='string'||newPassword.length<12||newPassword.length>128)return res.status(400).json({error:'Saisissez le mot de passe actuel et un nouveau mot de passe de 12 à 128 caractères.'});
  const [rows]=await db.execute('SELECT password_hash FROM users WHERE id=? AND organization_id=? AND is_active=TRUE',[req.user.id,req.tenantId]);
  if(!rows.length||!await bcrypt.compare(currentPassword,rows[0].password_hash))return res.status(400).json({error:'Le mot de passe actuel est incorrect.'});
  if(currentPassword===newPassword)return res.status(400).json({error:'Le nouveau mot de passe doit être différent du mot de passe actuel.'});
  await db.execute('UPDATE users SET password_hash=?,password_version=password_version+1 WHERE id=? AND organization_id=?',[await bcrypt.hash(newPassword,12),req.user.id,req.tenantId]);
  res.json({message:'Mot de passe modifié. Reconnectez-vous.'});
 }catch(error){next(error);}
});
router.get('/me',authenticate,(req,res)=>res.json({user:req.user,tenantId:req.tenantId}));
module.exports=router;
