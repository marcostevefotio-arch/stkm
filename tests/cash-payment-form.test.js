const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/js/app.js'),'utf8');
const paymentSource=source.slice(source.indexOf('    async function paymentForm('),source.indexOf('    function returnForm('));

test('payment form requires cash received only for cash and never substitutes the payment amount',async()=>{
 const error={textContent:''},cashField={},insurerField={},submit={},requests=[];
 const method={value:'cash',dispatchEvent(){this.onchange();}};
 const form={
  elements:{method,amount:{value:'10'},cash_received:{value:''},insurer_id:{value:''},reference:{value:''}},
  querySelector:selector=>selector==='.error'?error:selector==='[data-cash-field]'?cashField:selector==='[data-insurer-field]'?insurerField:submit,
  reportValidity(){return !this.elements.cash_received.required||this.elements.cash_received.value!=='';}
 };
 const modal={querySelector:selector=>selector==='form'?form:{},remove:()=>{}};
 const context={
  document:{createElement:()=>modal,body:{append:()=>{}}},
  paymentLabels:{cash:'Cash',mobile_money:'Mobile'},formatMoney:String,esc:String,Event,
  api:async(url,options)=>{requests.push(JSON.parse(options.body));return {status:'paid'};},
  toast:()=>{},invoiceStatusLabels:{paid:'Paid'},cashRegister:async()=>{},salesInvoices:async()=>{},saleReceipt:async()=>{}
 };
 vm.createContext(context);vm.runInContext(paymentSource,context);
 await context.paymentForm({}, {id:15},10,0);
 assert.equal(form.elements.cash_received.required,true);
 assert.equal(form.elements.cash_received.disabled,false);
 await form.onsubmit({preventDefault:()=>{}});
 assert.equal(requests.length,0);
 form.elements.cash_received.value='20';
 await form.onsubmit({preventDefault:()=>{}});
 assert.equal(requests[0].payments[0].cash_received,'20');
 method.value='mobile_money';method.onchange();
 assert.equal(form.elements.cash_received.required,false);
 assert.equal(form.elements.cash_received.disabled,true);
 assert.equal(cashField.hidden,true);
 await form.onsubmit({preventDefault:()=>{}});
 assert.equal(Object.hasOwn(requests[1].payments[0],'cash_received'),false);
});
