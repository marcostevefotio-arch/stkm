const test=require('node:test');
const assert=require('node:assert/strict');
const {averageCost}=require('../src/services/stock-valuation.service');

test('weighted average retains exact decimal arithmetic and rounds to four places',()=>{
 assert.equal(averageCost('10.000','5.0000','5.000','8.0000'),'6.0000');
 assert.equal(averageCost('1.000','1.0000','2.000','2.0000'),'1.6667');
 assert.equal(averageCost('0.000',null,'0.001','123.4500'),'123.4500');
 assert.equal(averageCost('1.000',null,'1.000','2.0000'),null);
});

test('weighted average rejects invalid or overflowing quantities and costs',()=>{
 for(const args of [
  ['1','1','0','2'],['1','1','0.0001','2'],['1','-1','1','2'],
  ['99999999999.999','1','0.001','2'],['0',null,'1','1.00001']
 ])assert.throws(()=>averageCost(...args),RangeError);
});
