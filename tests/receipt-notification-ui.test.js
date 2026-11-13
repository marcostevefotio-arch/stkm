const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const JsBarcode=require('jsbarcode');
const {BitArray,Code128Reader}=require('@zxing/library');
const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');

test('direct settings role-merger links render the actual configuration tab',()=>{
 const calls=[],elements={};
 const context={
  state:{role:'ADMIN',modules:null},location:{hash:''},titles:{},accountingPages:{},
  closeOpenModals:()=>{},canAccessPage:page=>page==='roles',toast:()=>assert.fail('Role settings must be accessible to admin'),
  document:{querySelectorAll:()=>[]},$:selector=>elements[selector]||= {},
  settings:(root,tab)=>calls.push(tab)
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('    function go('),source.indexOf('    const adminRoleLabels')),context);
 context.go('settings/roles');
 assert.deepEqual(calls,['roles']);
 assert.equal(context.location.hash,'settings/roles');
});

test('receipt identity uses the company and safe logo, with an actually decodable invoice barcode',()=>{
 const content={prepend:element=>{content.identity=element;},append:element=>{content.barcode=element;}};
 let encoded,barcodeOptions;
 const context={
  state:{settings:{company_name:'Company & Sons',display_name:'Branch',company_address:'Address',company_phone:'123',logo_url:'/uploads/logos/test.png'},profile:{organization_name:'Fallback'}},
  safeLogoUrl:value=>value,esc:value=>String(value).replace(/&/g,'&amp;'),
  document:{createElement:()=>({}),createElementNS:()=>({classList:{add:()=>{}},setAttribute:()=>{}})},
  window:{JsBarcode:(target,value,options)=>{barcodeOptions=options;encoded={};JsBarcode(encoded,value,options);}}
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('    function addReceiptIdentity('),source.indexOf('    async function paymentForm(')),context);
 const number='FAC-20261107-000001';
 context.addReceiptIdentity(content,number);
 assert.match(content.identity.innerHTML,/Company &amp; Sons/);
 assert.match(content.identity.innerHTML,/uploads\/logos\/test.png/);
 assert.match(content.identity.innerHTML,/Company &amp; Sons<\/h2><p>Address<\/p>/);
 assert.ok(content.barcode);
 assert.equal(barcodeOptions.width,1.5);
 assert.equal(barcodeOptions.height,40);
 const bits='0'.repeat(12)+encoded.encodings.map(encoding=>encoding.data).join('')+'0'.repeat(12);
 const row=new BitArray(bits.length);
 for(let index=0;index<bits.length;index++)if(bits[index]==='1')row.set(index);
 assert.equal(new Code128Reader().decodeRow(0,row).getText(),number);
 context.window.JsBarcode=null;
 assert.throws(()=>context.addReceiptIdentity(content,number),/indisponible/);
});

test('receipt print layout removes preceding app content and fits receipt metadata on one row',()=>{
 const styles=fs.readFileSync(path.join(__dirname,'../public/css/layout.css'),'utf8');
 const printStyles=styles.slice(styles.indexOf('body.receipt-printing .shell'),styles.indexOf('.search-group{'));
 assert.match(printStyles,/body\.receipt-printing \.shell,body\.receipt-printing #toast\{display:none!important\}/);
 assert.match(printStyles,/\.receipt-meta\{display:flex/);
 assert.match(printStyles,/\.modal\{[^}]*margin:0!important/);
 assert.match(printStyles,/\.receipt-print-controls[^}]*display:none!important/);
 assert.doesNotMatch(printStyles,/@page receipt-page/);
});

test('receipt printing applies the chosen orientation and exact margins, then restores page settings',async()=>{
 for(const orientation of ['portrait','landscape']){
  const listeners={},classes=new Set(),styles=[],errors=[];
  let printed=0;
  const context={
   document:{
    createElement:()=>({remove(){this.removed=true;}}),
    head:{append:style=>styles.push(style)},
    body:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}}
   },
   window:{
    addEventListener:(name,callback)=>{listeners[name]=callback;},
    removeEventListener:name=>{delete listeners[name];},
    print:()=>{printed++;}
   },
   toast:message=>errors.push(message)
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('    async function printReceipt('),source.indexOf('    function addReceiptIdentity(')),context);
  await context.printReceipt({querySelector:selector=>selector==='[data-print-orientation]'?{value:orientation}:null});
  assert.equal(printed,1);
  assert.equal(styles[0].textContent,`@media print { @page { size: A4 ${orientation}; margin: 0 5mm 15mm; } }`);
  assert.ok(classes.has('receipt-printing'));
  listeners.afterprint();
  assert.ok(styles[0].removed);
  assert.equal(classes.size,0);
  assert.equal(errors.length,0);
 }
});

test('notification sound beeps once per new notification, not historical pages or read updates',async()=>{
 const starts=[],messages=[],listeners={};
 const button={setAttribute:()=>{}};
 const audio={
  state:'running',currentTime:0,destination:{},resume:async()=>{},
  createOscillator:()=>({frequency:{},connect:()=>{},start:value=>starts.push(value),stop:()=>{},disconnect:()=>{}}),
  createGain:()=>({gain:{setValueAtTime:()=>{},linearRampToValueAtTime:()=>{}},connect:()=>{},disconnect:()=>{}})
 };
 const context={
  state:{role:'CASHIER'},window:{AudioContext:function(){return audio;}},
  document:{createElement:()=>button,addEventListener:(name,handler)=>{listeners[name]=handler;}},
  $:()=>({prepend:()=>{}}),toast:message=>messages.push(message)
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('    let notificationWatermark'),source.indexOf('    async function refreshNotifications(')),context);
 await context.unlockNotificationSound();
 context.signalNewNotifications([{id:'9007199254740993'}]);
 assert.equal(starts.length,0);
 context.signalNewNotifications([{id:'9007199254740995'},{id:'9007199254740994'},{id:'9007199254740993'}]);
 assert.equal(starts.length,2);
 context.signalNewNotifications([{id:'9007199254740995',read_at:'now'}]);
 context.signalNewNotifications([{id:'1'}]);
 assert.equal(starts.length,2);
 await button.onclick();
 context.signalNewNotifications([{id:'9007199254740996'}]);
 assert.equal(starts.length,2);
 await button.onclick();
 context.signalNewNotifications([{id:'9007199254740997'}]);
 assert.equal(starts.length,3);
 audio.state='suspended';
 context.signalNewNotifications([{id:'9007199254740998'}]);
 assert.equal(messages.length,1);
});
