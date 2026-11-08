const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');

function element(){
 return {value:'',hidden:false,disabled:false,textContent:'',srcObject:null,focus(){},select(){},listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}};
}
function setup({secure=true,zxing,media=true}={}){
 const parts={input:element(),status:element(),video:element(),camera:element(),close:element()};
 const modal={...element(),isConnected:true,removed:false,remove(){this.removed=true;this.isConnected=false;},querySelector(selector){
  return {'[data-sale-scan-code]':parts.input,'[data-sale-scanner-status]':parts.status,'[data-sale-scanner-video]':parts.video,'[data-sale-start-camera]':parts.camera,'.close':parts.close}[selector];
 }};
 let observer;
 const context={
  console,
  document:{querySelector:()=>null,createElement:()=>modal,body:{append(){}}},
  window:{isSecureContext:secure,ZXingBrowser:zxing},
  navigator:{mediaDevices:media?{getUserMedia(){}}:undefined},
  MutationObserver:class{constructor(fn){observer=this;this.fn=fn;}observe(){}disconnect(){this.disconnected=true;}}
 };
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('    function normalizeInvoiceCode('),source.indexOf('    async function cashRegister(')),context);
 return {context,parts,modal,get observer(){return observer;}};
}

test('invoice codes from readers are normalized and foreign codes are rejected',()=>{
 const {context}=setup();
 assert.equal(context.normalizeInvoiceCode(' fac-20261107-000123\r\n'),'FAC-20261107-000123');
 assert.equal(context.normalizeInvoiceCode('https://x/?n=FAC-20261107-000123'),'FAC-20261107-000123');
 assert.equal(context.normalizeInvoiceCode('3400930000000'),'');
});

test('the USB reader input opens the scanned sale and closes the modal',async()=>{
 const {context,parts,modal}=setup();
 const calls=[];
 context.openSaleScanner({isConnected:true},async code=>{calls.push(code);});
 parts.input.value='FAC-20261107-000042';
 parts.input.onkeydown({key:'Enter',preventDefault(){}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['FAC-20261107-000042']);
 assert.equal(modal.removed,true);
});

test('invalid codes and lookup errors keep the modal open with a message',async()=>{
 const {context,parts,modal}=setup();
 const scanner=context.openSaleScanner({isConnected:true},async()=>{throw new Error('Facture introuvable.');});
 await scanner.submit('3400930000000');
 assert.match(parts.status.textContent,/Code non reconnu/);
 await scanner.submit('FAC-20261107-000001');
 assert.equal(parts.status.textContent,'Facture introuvable.');
 assert.equal(modal.removed,false);
});

test('camera decoding submits once and stops the video stream',async()=>{
 let callback,stopped=0,trackStopped=0;
 class BrowserMultiFormatReader{async decodeFromConstraints(constraints,video,fn){assert.equal(constraints.video.facingMode.ideal,'environment');callback=fn;video.srcObject={getTracks:()=>[{stop:()=>{trackStopped+=1;}}]};return {stop:()=>{stopped+=1;}};}reset(){}}
 const {context,parts,modal}=setup({zxing:{BrowserMultiFormatReader}});
 const calls=[];
 context.openSaleScanner({isConnected:true},async code=>{calls.push(code);});
 await parts.camera.onclick();
 assert.match(parts.status.textContent,/Caméra active/);
 callback({getText:()=>'FAC-20261107-000007'});
 callback({getText:()=>'FAC-20261107-000007'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['FAC-20261107-000007']);
 assert.equal(stopped,1);
 assert.equal(trackStopped,1);
 assert.equal(modal.removed,true);
});

test('camera permission, HTTPS and missing library fall back to the reader',async()=>{
 class Denied{async decodeFromConstraints(){const error=new Error('denied');error.name='NotAllowedError';throw error;}reset(){}}
 let scanner=setup({zxing:{BrowserMultiFormatReader:Denied}});
 scanner.context.openSaleScanner({isConnected:true},async()=>{});
 await scanner.parts.camera.onclick();
 assert.match(scanner.parts.status.textContent,/refusé/);
 assert.equal(scanner.parts.camera.disabled,false);
 scanner=setup({secure:false});
 scanner.context.openSaleScanner({isConnected:true},async()=>{});
 await scanner.parts.camera.onclick();
 assert.match(scanner.parts.status.textContent,/HTTPS/);
 scanner=setup();
 scanner.context.openSaleScanner({isConnected:true},async()=>{});
 await scanner.parts.camera.onclick();
 assert.match(scanner.parts.status.textContent,/indisponible/);
});

test('leaving the cash page closes the scanner',()=>{
 const scanner=setup();
 const root={isConnected:true};
 scanner.context.openSaleScanner(root,async()=>{});
 root.isConnected=false;
 scanner.observer.fn();
 assert.equal(scanner.modal.removed,true);
 assert.equal(scanner.observer.disconnected,true);
});

test('an overlay removed externally still releases the camera',()=>{
 const scanner=setup();
 scanner.context.openSaleScanner({isConnected:true},async()=>{});
 scanner.modal.isConnected=false;
 scanner.observer.fn();
 assert.equal(scanner.observer.disconnected,true);
});
