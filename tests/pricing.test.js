const test=require('node:test');
const assert=require('node:assert/strict');
const {ALL_MODULES,DEFAULT_PLANS,getTermPrice}=require('../src/config/pricing');

test('default Starter and Ultimate plans expose all three configured prices',()=>{
 const starter=DEFAULT_PLANS.find(plan=>plan.code==='starter');
 const ultimate=DEFAULT_PLANS.find(plan=>plan.code==='ultimate');
 assert.deepEqual([starter.monthly_price,starter.annual_price,starter.biennial_price],[15000,150000,280000]);
 assert.deepEqual([ultimate.monthly_price,ultimate.annual_price,ultimate.biennial_price],[25000,350000,600000]);
 assert.equal(ultimate.is_active,true);
});

test('Customized has a price for every module and billing interval',()=>{
 const customized=DEFAULT_PLANS.find(plan=>plan.code==='customized');
 assert.equal(customized.is_active,true);
 assert.deepEqual(customized.included_modules,ALL_MODULES);
 for(const module of ALL_MODULES){
  assert.deepEqual(Object.keys(customized.module_prices[module]),['monthly','annual','biennial']);
 }
 assert.deepEqual(customized.module_prices.stock,{monthly:12000,annual:120000,biennial:240000});
 assert.deepEqual(customized.module_prices.procurement,{monthly:10000,annual:120000,biennial:240000});
 assert.equal(getTermPrice(customized,'monthly',['stock','procurement'],1),22000);
 assert.equal(getTermPrice(customized,'annual',['stock','procurement'],1),240000);
 assert.equal(getTermPrice(customized,'biennial',['stock','procurement'],1),480000);
});
