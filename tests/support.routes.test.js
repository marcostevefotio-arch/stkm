const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const db=require('../src/config/database');
const supportRoutes=require('../src/routes/support.routes');

async function listen(t,role='CASHIER',userId=7){
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.tenantId=42;req.user={id:userId,organization_id:42,role};next();});
 app.use('/api/support',supportRoutes);
 const server=app.listen(0);
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 await new Promise(resolve=>server.once('listening',resolve));
 return `http://127.0.0.1:${server.address().port}/api/support`;
}

test('members only receive their own support tickets, scoped to their organization',async t=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  if(sql.startsWith('SELECT COUNT(*)'))return [[{total:1}],[]];
  return [[{id:5,user_id:7,subject:'Test demande',message:'Un problème est survenu.',status:'open',created_at:'2026-11-04 10:00:00',requester_name:'Membre',reply_count:0}],[]];
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'CASHIER',7),response=await fetch(url);
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.items[0].id,5);
 assert.match(queries[0].sql,/t\.organization_id=\? AND t\.user_id=\?/);
 assert.deepEqual(queries[0].values,[42,7]);
 assert.ok(queries.every(query=>query.values.includes(42)));
});

test('members cannot read another member ticket or its conversation',async t=>{
 const originalExecute=db.execute;let messageQueries=0;
 db.execute=async(sql,values)=>{
  assert.ok(values.includes(42));
  if(sql.includes('FROM support_tickets t JOIN users'))return [[],[]];
  if(sql.includes('FROM support_ticket_messages'))messageQueries+=1;
  throw Error('A hidden ticket must not load its messages.');
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'CASHIER',7),response=await fetch(`${url}/15`);
 assert.equal(response.status,404);
 assert.equal(messageQueries,0);
});

test('tenant administrator can see every ticket from their establishment only',async t=>{
 const originalExecute=db.execute;let selected;
 db.execute=async(sql,values)=>{
  if(sql.startsWith('SELECT COUNT(*)'))return [[{total:2}],[]];
  selected={sql,values};return [[],[]];
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'ADMIN'),response=await fetch(url);
 assert.equal(response.status,200);
 assert.match(selected.sql,/t\.organization_id=\?/);
 assert.doesNotMatch(selected.sql,/t\.user_id=\?/);
 assert.ok(selected.values.includes(42));
 assert.equal(selected.values.includes(7),false);
});

test('support ticket creation validates input and writes an audit record atomically',async t=>{
 const originalGetConnection=db.getConnection;
 let ticketValues,auditValues,committed=false,rolledBack=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{rolledBack=true;},
  release:()=>{},
  execute:async(sql,values)=>{
   if(sql.startsWith('INSERT INTO support_tickets')){ticketValues=values;return [{insertId:17},[]];}
   if(sql.includes('INSERT INTO audit_logs')){auditValues=values;return [{affectedRows:1},[]];}
   throw Error(`Unexpected SQL: ${sql}`);
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t);
 const invalid=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:'Bug',message:'Court'})});
 assert.equal(invalid.status,400);
 assert.equal(ticketValues,undefined);
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:'Échec de paiement',message:'La vente affiche une erreur lors du paiement.'})});
 assert.equal(response.status,201);
 assert.equal((await response.json()).id,17);
 assert.deepEqual(ticketValues,[42,7,'Échec de paiement','La vente affiche une erreur lors du paiement.','open']);
 assert.equal(auditValues[2],'SUPPORT_TICKET_CREATED');
 assert.equal(committed,true);
 assert.equal(rolledBack,false);
});

test('direct support chat creates a secure token and assigns an available platform agent',async t=>{
 const originalGetConnection=db.getConnection;let ticketValues,auditValues,committed=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{committed=true;},
  rollback:async()=>{},
  release:()=>{},
  execute:async(sql,values)=>{
   if(sql.includes('SELECT support_token token,status FROM support_tickets'))return [[],[]];
   if(sql.includes('FROM support_agent_presence'))return [[{user_id:91}],[]];
   if(sql.startsWith('INSERT INTO support_tickets')){ticketValues=values;return [{insertId:18},[]];}
   if(sql.startsWith('INSERT INTO audit_logs')){auditValues=values;return [{affectedRows:1},[]];}
   return [{affectedRows:1},[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t),response=await fetch(`${url}/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Je ne parviens pas à finaliser une vente.'})});
 assert.equal(response.status,201);
 const result=await response.json();
 assert.match(result.token,/^[A-F0-9]{32}$/);
 assert.equal(result.assigned,true);
 assert.deepEqual(ticketValues.slice(0,3),[42,7,'Je ne parviens pas à finaliser une vente.']);
 assert.equal(ticketValues[3],result.token);
 assert.equal(ticketValues[4],91);
 assert.equal(auditValues[2],'SUPPORT_CHAT_STARTED');
 assert.equal(committed,true);
});

test('direct support chat lookup is restricted by tenant, requester and token',async t=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  if(sql.includes('FROM support_tickets t LEFT JOIN users'))return [[{id:18,token:'A'.repeat(32),status:'open',organization_id:42,subject:'Chat assistance',created_at:'2026-11-04 10:00:00',agent_name:'Agent'}],[]];
  if(sql.includes('FROM support_ticket_messages'))return [[{id:1,user_id:7,message:'Bonjour',full_name:'Membre',is_agent:0}],[]];
  throw Error(`Unexpected SQL: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t),invalid=await fetch(`${url}/chat/short`);
 assert.equal(invalid.status,400);
 const response=await fetch(`${url}/chat/${'A'.repeat(32)}`);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.messages[0].message,'Bonjour');
 assert.deepEqual(queries[0].values,['A'.repeat(32),42,7]);
 assert.deepEqual(queries[1].values,[18,42]);
});

test('platform agents read chat messages using the ticket tenant, not their own tenant',async t=>{
 const originalExecute=db.execute,queries=[];
 db.execute=async(sql,values)=>{
  queries.push({sql,values});
  if(sql.includes('FROM support_tickets t LEFT JOIN users'))return [[{id:18,token:'B'.repeat(32),status:'open',organization_id:77,user_id:5,assigned_agent_id:90,subject:'Chat assistance',created_at:'2026-11-04 10:00:00',agent_name:'Agent'}],[]];
  if(sql.includes('FROM support_ticket_messages'))return [[{id:2,user_id:90,message:'Réponse',full_name:'Agent',is_agent:1}],[]];
  throw Error(`Unexpected SQL: ${sql}`);
 };
 t.after(()=>{db.execute=originalExecute;});
 const url=await listen(t,'SUPER_ADMIN',90),response=await fetch(`${url}/chat/${'B'.repeat(32)}`);
 assert.equal(response.status,200);
 assert.deepEqual(queries[0].values,['B'.repeat(32)]);
 assert.deepEqual(queries[1].values,[18,77]);
});

test('members cannot update another user ticket and cannot choose an invalid status',async t=>{
 const originalGetConnection=db.getConnection;let calls=0;
 db.getConnection=async()=>{calls+=1;throw Error('Database should not be reached');};
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'CASHIER',7);
 const invalidStatus=await fetch(`${url}/15/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'deleted'})});
 assert.equal(invalidStatus.status,400);
 const invalidId=await fetch(`${url}/0/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Réponse valide'})});
 assert.equal(invalidId.status,400);
 assert.equal(calls,0);
});

test('closed tickets cannot receive new replies',async t=>{
 const originalGetConnection=db.getConnection;let rolledBack=false,inserted=false;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{},
  rollback:async()=>{rolledBack=true;},
  release:()=>{released=true;},
  execute:async sql=>{
   if(sql.includes('SELECT t.id,t.status,t.subject'))return [[{id:5,status:'closed',subject:'Ticket'}],[]];
   if(sql.startsWith('INSERT INTO support_ticket_messages'))inserted=true;
   return [[],[]];
  }
 });
 let released=false;
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t),response=await fetch(`${url}/5/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Une réponse de suivi.'})});
 assert.equal(response.status,409);
 assert.equal(rolledBack,true);
 assert.equal(inserted,false);
 assert.equal(released,true);
});

test('attempting to close another member ticket releases the database transaction',async t=>{
 const originalGetConnection=db.getConnection;let released=false,updates=0;
 db.getConnection=async()=>({
  beginTransaction:async()=>{},
  commit:async()=>{},
  rollback:async()=>{},
  release:()=>{released=true;},
  execute:async sql=>{
   if(sql.includes('SELECT t.id,t.status,t.subject'))return [[],[]];
   if(sql.startsWith('UPDATE support_tickets'))updates+=1;
   return [[],[]];
  }
 });
 t.after(()=>{db.getConnection=originalGetConnection;});
 const url=await listen(t,'CASHIER',7),response=await fetch(`${url}/15/status`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'closed'})});
 assert.equal(response.status,404);
 assert.equal(released,true);
 assert.equal(updates,0);
});
