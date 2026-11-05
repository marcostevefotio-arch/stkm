const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const db=require('../src/config/database');
const authRoutes=require('../src/routes/auth.routes');
const {authenticate}=require('../src/middleware/auth');

async function listen(t){
 const app=express();app.use(express.json());app.use('/api/auth',authRoutes);
 app.get('/api/support/status',authenticate,(req,res)=>res.json({ok:true}));
 app.get('/api/subscription',authenticate,(req,res)=>res.json({status:'trialing'}));
 app.get('/api/tenant-protected',authenticate,(req,res)=>res.json({ok:true}));
 app.use((error,req,res,next)=>res.status(500).json({error:'Erreur interne du serveur.'}));
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/auth`;
}

test('changing a password verifies the current one and revokes older sessions',async t=>{
 const originalExecute=db.execute,oldSecret=process.env.JWT_SECRET;
 process.env.JWT_SECRET='password-test-secret';
 let passwordHash=await bcrypt.hash('CurrentPass123!',4),passwordVersion=0,updates=0;
 db.execute=async(sql,values)=>{
  if(sql.includes('password_hash')&&sql.startsWith('SELECT u.id'))return [[{id:7,organization_id:42,full_name:'Test User',email:'test@example.com',password_hash:passwordHash,password_version:passwordVersion,role:'OWNER',is_active:1,organization_name:'Test Org',organization_status:'active'}],[]];
  if(sql.includes('FROM users')&&sql.includes('organization_name'))return [[{id:7,organization_id:42,full_name:'Test User',email:'test@example.com',role:'OWNER',is_active:1,password_version:passwordVersion,organization_name:'Test Org',organization_status:'active'}],[]];
  if(sql==='SELECT password_hash FROM users WHERE id=? AND organization_id=? AND is_active=TRUE')return [[{password_hash:passwordHash}],[]];
  if(sql.startsWith('UPDATE users SET password_hash=')){passwordHash=values[0];passwordVersion+=1;updates+=1;return [{affectedRows:1},[]];}
  throw Error(`Unexpected query: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;});
 const url=await listen(t);
 const login=await fetch(`${url}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',password:'CurrentPass123!'})});
 assert.equal(login.status,200);
 const {token}=await login.json();
 const invalid=await fetch(`${url}/password`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({current_password:'incorrect-password',new_password:'NewSecurePass123!'})});
 assert.equal(invalid.status,400);
 assert.equal(updates,0);
 const changed=await fetch(`${url}/password`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({current_password:'CurrentPass123!',new_password:'NewSecurePass123!'})});
 assert.equal(changed.status,200);
 assert.equal(updates,1);
 const oldSession=await fetch(`${url}/me`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(oldSession.status,401);
});

test('login tokens include the account password version',async t=>{
 const oldSecret=process.env.JWT_SECRET,originalExecute=db.execute;
 process.env.JWT_SECRET='password-test-secret';
 const passwordHash=await bcrypt.hash('CurrentPass123!',4);
 db.execute=async()=>[[{id:9,organization_id:42,full_name:'Test User',email:'test@example.com',password_hash:passwordHash,password_version:3,role:'OWNER',is_active:1,organization_name:'Test Org',organization_status:'active'}],[]];
 t.after(()=>{db.execute=originalExecute;if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;});
 const url=await listen(t);
 const response=await fetch(`${url}/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@example.com',password:'CurrentPass123!'})});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(jwt.verify(body.token,process.env.JWT_SECRET).pv,3);
 assert.equal(Object.hasOwn(body.user,'password_version'),false);
});

test('authentication blocks suspended tenants and forwards database failures',async t=>{
 const originalExecute=db.execute,oldSecret=process.env.JWT_SECRET;
 process.env.JWT_SECRET='auth-status-test-secret';
 const token=jwt.sign({sub:9,pv:0},process.env.JWT_SECRET);
 t.after(()=>{db.execute=originalExecute;if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;});
 const url=await listen(t);
 db.execute=async()=>{throw Error('Database unavailable');};
 const failed=await fetch(`${url}/me`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(failed.status,500);
 assert.deepEqual(await failed.json(),{error:'Erreur interne du serveur.'});
 db.execute=async()=>[[{id:9,organization_id:42,full_name:'Test User',email:'test@example.com',role:'OWNER',is_active:1,password_version:0,organization_name:'Test Org',organization_status:'suspended'}],[]];
 const suspended=await fetch(`${url}/me`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(suspended.status,403);
 assert.equal((await suspended.json()).error,'L’établissement est suspendu ou fermé. Contactez l’assistance REDAMS.');
 db.execute=async()=>[[{id:9,organization_id:42,full_name:'Platform User',email:'platform@example.com',role:'SUPER_ADMIN',is_active:1,password_version:0,organization_name:'Test Org',organization_status:'suspended'}],[]];
 const platformAdmin=await fetch(`${url}/me`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(platformAdmin.status,200);
});

test('expired trial blocks tenant APIs while preserving subscription and support access',async t=>{
 const originalExecute=db.execute,oldSecret=process.env.JWT_SECRET;
 process.env.JWT_SECRET='trial-expiry-test-secret';
 const token=jwt.sign({sub:9,pv:0},process.env.JWT_SECRET);
 t.after(()=>{db.execute=originalExecute;if(oldSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=oldSecret;});
 db.execute=async()=>[[{id:9,organization_id:42,full_name:'Trial User',email:'trial@example.com',role:'OWNER',is_active:1,password_version:0,organization_name:'Trial Org',organization_status:'active',trial_expired:1}],[]];
 const url=await listen(t);
 const expired=await fetch(`${url.replace('/api/auth','')}/api/tenant-protected`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(expired.status,403);
 assert.match((await expired.json()).error,/essai gratuit de 7 jours est terminé/);
 const support=await fetch(`${url.replace('/api/auth','')}/api/support/status`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(support.status,200);
 const subscription=await fetch(`${url.replace('/api/auth','')}/api/subscription`,{headers:{Authorization:`Bearer ${token}`}});
 assert.equal(subscription.status,200);
});
