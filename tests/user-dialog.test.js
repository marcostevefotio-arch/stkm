const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
const dialogSource=source.slice(source.indexOf('    function userDialog('),source.indexOf('    async function renderAudit('));

for(const editing of [false,true])test(`${editing?'editing':'creating'} a user refreshes the existing panel and preserves the selected role`,async()=>{
 const panel={innerHTML:'Users'},error={textContent:''},requests=[],messages=[];
 let removed=false,refreshes=0;
 const form={
  elements:{
   full_name:{value:'Test user',focus:()=>{}},
   email:{value:'test@example.invalid'},
   role:{value:'CASHIER'},
   password:{value:'test-password-123'},
   is_active:{value:'true',disabled:false}
  },
  querySelector:()=>error
 };
 const modal={querySelector:selector=>selector==='form'?form:{},addEventListener:()=>{},remove:()=>{removed=true;}};
 const context={
  state:{role:'OWNER',userId:1},
  adminRoleLabels:{OWNER:'Owner',ADMIN:'Admin',CASHIER:'Cashier'},
  esc:String,
  document:{createElement:()=>modal,body:{append:()=>{}}},
  api:async(url,options)=>{requests.push({url,...options});return {message:'Saved'};},
  toast:(message)=>messages.push(message)
 };
 vm.createContext(context);
 vm.runInContext(dialogSource,context);
 context.userDialog(panel,editing?{id:7,role:'CASHIER',is_active:true}:null,async target=>{
  assert.equal(target,panel);
  target.innerHTML='Refreshed users';
  refreshes++;
 });
 await form.onsubmit({preventDefault:()=>{}});
 assert.equal(requests.length,1);
 assert.equal(requests[0].method,editing?'PATCH':'POST');
 assert.equal(requests[0].url,editing?'/api/admin/users/7':'/api/admin/users');
 assert.equal(JSON.parse(requests[0].body).role,'CASHIER');
 assert.equal(refreshes,1);assert.equal(panel.innerHTML,'Refreshed users');
 assert.equal(removed,true);assert.equal(error.textContent,'');
 assert.deepEqual(messages,['Saved']);
});
