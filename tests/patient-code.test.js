const test=require('node:test');
const assert=require('node:assert/strict');
const {validateFormat,renderCode,reserveCode}=require('../src/services/patient-code.service');

test('patient code format validation and rendering',()=>{
 assert.equal(validateFormat('PAT-{SEQ:5}'),null);
 assert.ok(validateFormat('PAT'));
 assert.ok(validateFormat('{SEQ}-{SEQ}'));
 assert.ok(validateFormat('PAT<{SEQ}>'));
 assert.equal(renderCode('PAT-{YY}{MM}-{SEQ:4}',7,new Date(2026,2,5)),'PAT-2603-0007');
});

test('reserveCode skips existing codes and stores the sequence',async()=>{
 const updates=[];
 const connection={execute:async(sql,values)=>{
  if(sql.startsWith('SELECT patient_code_format'))return [[{patient_code_format:'P-{SEQ:3}',patient_code_sequence:0}]];
  if(sql.startsWith('SELECT id FROM patients'))return [values[1]==='P-001'?[{id:1}]:[]];
  if(sql.startsWith('UPDATE'))updates.push(values);
  return [{}];
 }};
 assert.equal(await reserveCode(connection,5),'P-002');
 assert.deepEqual(updates,[[2,5]]);
});
