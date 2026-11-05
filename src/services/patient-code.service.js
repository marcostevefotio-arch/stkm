const DEFAULT_FORMAT='PAT-{SEQ:5}';
const MODES=new Set(['auto','manual']);
const TOKEN=/\{(YYYY|YY|MM|DD|SEQ(?::(\d{1,2}))?)\}/g;

function validateFormat(format){
 if(typeof format!=='string'||!format.trim())return 'Le format du code patient est obligatoire.';
 if(format.length>60)return 'Le format du code patient est limité à 60 caractères.';
 const sequences=[...format.matchAll(/\{SEQ(?::(\d{1,2}))?\}/g)];
 if(sequences.length!==1)return 'Le format doit contenir exactement un compteur {SEQ} ou {SEQ:n}.';
 const width=sequences[0][1];
 if(width!==undefined&&(Number(width)<1||Number(width)>12))return 'La longueur du compteur doit être comprise entre 1 et 12.';
 const literals=format.replace(TOKEN,'');
 if(/[{}]/.test(literals)||!/^[A-Za-z0-9\-_/. ]*$/.test(literals))return 'Le format accepte lettres, chiffres, - _ / . espace et les variables {YYYY} {YY} {MM} {DD} {SEQ:n}.';
 return null;
}

function renderCode(format,sequence,date=new Date()){
 const year=String(date.getFullYear()),pad=value=>String(value).padStart(2,'0');
 return format.replace(TOKEN,(match,name,width)=>{
  if(name==='YYYY')return year;
  if(name==='YY')return year.slice(2);
  if(name==='MM')return pad(date.getMonth()+1);
  if(name==='DD')return pad(date.getDate());
  return String(sequence).padStart(Number(width||5),'0');
 }).trim();
}

async function getCodeSettings(executor,tenantId){
 const [rows]=await executor.execute('SELECT patient_code_mode,patient_code_format FROM organization_settings WHERE organization_id=?',[tenantId]);
 const row=Array.isArray(rows)?rows[0]:null;
 return {mode:MODES.has(row?.patient_code_mode)?row.patient_code_mode:'manual',format:row?.patient_code_format||DEFAULT_FORMAT};
}

async function reserveCode(connection,tenantId){
 await connection.execute('INSERT IGNORE INTO organization_settings(organization_id) VALUES(?)',[tenantId]);
 const [rows]=await connection.execute('SELECT patient_code_format,patient_code_sequence FROM organization_settings WHERE organization_id=? FOR UPDATE',[tenantId]);
 const format=rows[0]?.patient_code_format||DEFAULT_FORMAT;
 let sequence=Number(rows[0]?.patient_code_sequence||0);
 for(let attempt=0;attempt<1000;attempt+=1){
  sequence+=1;
  const code=renderCode(format,sequence);
  if(code.length>80)throw Object.assign(new Error('Le code patient généré dépasse 80 caractères. Raccourcissez le format.'),{status:400});
  const [existing]=await connection.execute('SELECT id FROM patients WHERE organization_id=? AND patient_code=?',[tenantId,code]);
  if(!existing.length){
   await connection.execute('UPDATE organization_settings SET patient_code_sequence=? WHERE organization_id=?',[sequence,tenantId]);
   return code;
  }
 }
 throw Object.assign(new Error('Impossible de générer un code patient disponible. Modifiez le format.'),{status:409});
}

module.exports={DEFAULT_FORMAT,MODES,validateFormat,renderCode,getCodeSettings,reserveCode};
