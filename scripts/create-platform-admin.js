require('dotenv').config();
const db=require('../src/config/database');
const bcrypt=require('bcryptjs');

async function createPlatformAdmin(){
 const organizationId=String(process.env.PLATFORM_ADMIN_ORGANIZATION_ID||'');
 const fullName=String(process.env.PLATFORM_ADMIN_NAME||'').trim();
 const email=String(process.env.PLATFORM_ADMIN_EMAIL||'').trim().toLowerCase();
 const password=process.env.PLATFORM_ADMIN_PASSWORD||'';
 if(!/^[1-9]\d{0,19}$/.test(organizationId))throw new Error('PLATFORM_ADMIN_ORGANIZATION_ID doit être un identifiant valide.');
 if(fullName.length<2||fullName.length>180)throw new Error('PLATFORM_ADMIN_NAME doit contenir 2 à 180 caractères.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>190)throw new Error('PLATFORM_ADMIN_EMAIL doit être une adresse valide.');
 if(password.length<12||password.length>128)throw new Error('PLATFORM_ADMIN_PASSWORD doit contenir 12 à 128 caractères.');

 const connection=await db.getConnection();
 try{
  await connection.beginTransaction();
  const [organizations]=await connection.execute("SELECT id FROM organizations WHERE id=? AND status='active' FOR UPDATE",[organizationId]);
  if(!organizations.length)throw new Error('L’établissement choisi est introuvable ou inactif.');
  const [users]=await connection.execute('SELECT id FROM users WHERE email=? LIMIT 1',[email]);
  if(users.length)throw new Error('Un compte avec cette adresse existe déjà.');
  const hash=await bcrypt.hash(password,12);
  await connection.execute(
   "INSERT INTO users(organization_id,full_name,email,password_hash,role) VALUES(?,?,?,?, 'SUPER_ADMIN')",
   [organizationId,fullName,email,hash]
  );
  await connection.commit();
  console.log('Compte SUPER_ADMIN créé.');
 }catch(error){
  await connection.rollback();
  throw error;
 }finally{
  connection.release();
 }
}

createPlatformAdmin().catch(async error=>{
 console.error(error.message||error);
 await db.end();
 process.exit(1);
}).then(async()=>{
 await db.end();
});
