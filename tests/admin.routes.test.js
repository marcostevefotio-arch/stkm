const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const adminRoutes=require('../src/routes/admin.routes');

async function listen(t,role='OWNER',userId=7,modules){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:userId,organization_id:42,role,subscription_modules:modules};next();});
 app.use('/api/admin',adminRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/admin`;
}

test('only owners and administrators can access tenant user management',async t=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;return [[],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'CASHIER'),response=await fetch(`${url}/users`);
 assert.equal(response.status,403);
 assert.equal(calls,0);
});

test('starter owners can manage users but cannot read the administration audit',async t=>{
 const originalExecute=db.execute;
 db.execute=async sql=>sql.includes('max_users')?[[{max_users:3,active_users:1}],[]]:[[],[]];
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'OWNER',7,'["stock","procurement","sales","cash"]');
 const [users,audit]=await Promise.all([fetch(`${url}/users`),fetch(`${url}/audit`)]);
 assert.equal(users.status,200);
 assert.deepEqual(await users.json(),{users:[],quota:{max_users:3,active_users:1}});
 assert.equal(audit.status,403);
});

test('user creation validates fields and prevents administrators from assigning privileged roles',async t=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be reached');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'ADMIN');
 const invalid=await fetch(`${url}/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:'Test',email:'bad',role:'VIEWER',password:'short'})});
 assert.equal(invalid.status,400);
 const privileged=await fetch(`${url}/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:'Test',email:'test@example.com',role:'OWNER',password:'LongEnough@123'})});
 assert.equal(privileged.status,403);
 assert.equal(calls,0);
});

test('owner can create a tenant user with an audit record and hashed password',async t=>{
 const originalGetConnection=db.getConnection;let insertedUser,auditValues,quotaSql,committed=false;
 const connection={
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   if(sql.includes('SELECT id FROM organizations'))return [[],[]];
   if(sql.includes('max_users')&&sql.includes('FROM subscriptions')){quotaSql=sql;return [[],[]];}
   if(sql.startsWith('INSERT INTO users')){insertedUser={sql,values};return [{insertId:15},[]];}
   if(sql.includes('INSERT INTO audit_logs')){auditValues=values;return [{affectedRows:1},[]];}
   throw Error(`Unexpected admin query: ${sql}`);
  },
 };
 db.getConnection=async()=>connection;
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'OWNER'),response=await fetch(`${url}/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:'Employé Test',email:'TEST@example.com',role:'STOREKEEPER',password:'Secure-Password-123'})});
 assert.equal(response.status,201);
 assert.equal((await response.json()).id,15);
 assert.equal(insertedUser.values[1],'Employé Test');
 assert.equal(insertedUser.values[2],'test@example.com');
 assert.notEqual(insertedUser.values[3],'Secure-Password-123');
 assert.equal(auditValues[2],'USER_CREATED');
 assert.match(quotaSql,/u\.role<>'SUPER_ADMIN'/);
 assert.deepEqual(JSON.parse(auditValues[5]),{full_name:'Employé Test',email:'test@example.com',role:'STOREKEEPER'});
 assert.equal(committed,true);
});

test('last active owner cannot be demoted or disabled',async t=>{
 const originalGetConnection=db.getConnection;let rolledBack=false,committed=false;
 const connection={
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{rolledBack=true;},
  release:()=>{},
  execute:async sql=>{
   if(sql.includes('FROM users WHERE id=?'))return [[{id:9,full_name:'Owner',email:'owner@example.com',role:'OWNER',is_active:1}],[]];
   if(sql.includes('COUNT(*) active_owners'))return [[{active_owners:1}],[]];
   return [[],[]];
  },
 };
 db.getConnection=async()=>connection;
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'OWNER',7),response=await fetch(`${url}/users/9`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:false})});
 assert.equal(response.status,409);
 assert.match((await response.json()).error,/unique propriétaire actif/i);
 assert.equal(rolledBack,true);
 assert.equal(committed,false);
});

test('administrator cannot edit another privileged account',async t=>{
 const originalGetConnection=db.getConnection;let rolledBack=false,updated=false;
 const connection={
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{rolledBack=true;},release:()=>{},
  execute:async sql=>{
   if(sql.includes('FROM users WHERE id=?'))return [[{id:9,full_name:'Admin',email:'admin@example.com',role:'ADMIN',is_active:1}],[]];
   if(sql.startsWith('UPDATE users'))updated=true;
   return [[],[]];
  },
 };
 db.getConnection=async()=>connection;
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'ADMIN',7),response=await fetch(`${url}/users/9`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({full_name:'Changement interdit'})});
 assert.equal(response.status,403);
 assert.equal(rolledBack,true);
 assert.equal(updated,false);
});

test('administrator password reset invalidates existing member sessions',async t=>{
 const originalGetConnection=db.getConnection;let update;
 const connection={
  beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release:()=>{},
  execute:async(sql,values)=>{
   if(sql.includes('SELECT id FROM organizations'))return [[],[]];
   if(sql.includes('FROM users WHERE id=?'))return [[{id:9,full_name:'Membre',email:'member@example.com',role:'VIEWER',is_active:1}],[]];
   if(sql.startsWith('UPDATE users')){update={sql,values};return [{affectedRows:1},[]];}
   if(sql.includes('INSERT INTO audit_logs'))return [{affectedRows:1},[]];
   throw Error(`Unexpected admin query: ${sql}`);
  },
 };
 db.getConnection=async()=>connection;
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'ADMIN'),response=await fetch(`${url}/users/9`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'Temporary-Password-123'})});
 assert.equal(response.status,200);
 assert.match(update.sql,/password_version=password_version\+1/);
 assert.notEqual(update.values[0],'Temporary-Password-123');
});

test('audit journal filters are tenant-scoped and paginated',async t=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  return sql.startsWith('SELECT COUNT(*)')?[[{total:1}],[]]:[[{id:3,user_id:7,action:'USER_CREATED',entity_type:'user',entity_id:'9',details_json:{role:'VIEWER'},created_at:'2026-11-04 10:00:00',user_name:'Admin'}],[]];
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'ADMIN'),response=await fetch(`${url}/audit?q=Admin&action=USER_CREATED&entity=user&from=2026-11-01&to=2026-11-04&limit=10&offset=0`);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.total,1);
 assert.equal(result.items[0].details_json.role,'VIEWER');
 assert.equal(queries.length,2);
 assert.ok(queries.every(query=>query.values.includes(42)));
 assert.ok(queries.every(query=>query.values.includes('%Admin%')||query.values.includes('USER_CREATED')));
 assert.match(queries[1].sql,/LIMIT \? OFFSET \?/);
});

test('audit date filters reject invalid ranges before database access',async t=>{
 const originalExecute=db.execute;let calls=0;
 db.execute=async()=>{calls+=1;return [[],[]];};
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'OWNER'),response=await fetch(`${url}/audit?from=2026-02-31`);
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/dates/i);
 assert.equal(calls,0);
});
