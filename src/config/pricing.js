const MODULES={
 stock:'Gestion des stocks',
 procurement:'Approvisionnement',
 sales:'Ventes & facturation',
 patients:'Patients & assurances',
 cash:'Recettes & caisse',
 reports:'Rapports & analyses',
 administration:'Administration',
 support:'Assistance & formation',
};
const MODULE_KEYS=Object.keys(MODULES);
const INTERVALS=['monthly','annual','biennial'];
const INTERVAL_DAYS={monthly:30,annual:365,biennial:730};
const PRICE_COLUMNS={monthly:'monthly_price',annual:'annual_price',biennial:'biennial_price'};
const STARTER_MODULES=['stock','procurement','sales','cash'];
const ALL_MODULES=[...MODULE_KEYS];
const CUSTOMIZED_MODULE_PRICES=Object.fromEntries(MODULE_KEYS.map(module=>[
 module,
 module==='stock'
  ?{monthly:12000,annual:120000,biennial:240000}
  :{monthly:10000,annual:120000,biennial:240000},
]));
const DEFAULT_PLANS=[
 {code:'starter',name:'Starter',plan_type:'starter',monthly_price:15000,annual_price:150000,biennial_price:280000,extra_user_price:5000,currency:'XAF',max_users:3,max_products:10000000,included_modules:STARTER_MODULES,is_active:true},
 {code:'ultimate',name:'Ultimate',plan_type:'ultimate',monthly_price:25000,annual_price:350000,biennial_price:600000,extra_user_price:5000,currency:'XAF',max_users:5,max_products:10000000,included_modules:ALL_MODULES,is_active:true},
 {code:'customized',name:'Customized',plan_type:'customized',monthly_price:0,annual_price:null,biennial_price:null,extra_user_price:0,currency:'XAF',max_users:1,max_products:10000000,included_modules:ALL_MODULES,module_prices:CUSTOMIZED_MODULE_PRICES,is_active:true},
 {code:'trial',name:'Essai',plan_type:'trial',monthly_price:0,annual_price:0,biennial_price:0,extra_user_price:0,currency:'XAF',max_users:5,max_products:10000000,included_modules:ALL_MODULES,is_active:true},
];

function parseJson(value,fallback){
 if(value===null||value===undefined)return fallback;
 if(typeof value==='string'){
  try{return JSON.parse(value);}catch{return fallback;}
 }
 return value;
}

function getPlanModules(plan){
 if(plan.plan_type==='starter')return STARTER_MODULES;
 if(plan.plan_type==='ultimate'||plan.plan_type==='trial')return ALL_MODULES;
 const modules=parseJson(plan.included_modules,[]);
 return Array.isArray(modules)?modules.filter(module=>MODULE_KEYS.includes(module)):[];
}

function getTermPrice(plan,interval,selectedModules=getPlanModules(plan),userLimit=Number(plan.max_users)){
 if(!Object.hasOwn(PRICE_COLUMNS,interval))throw new Error('Période de facturation invalide.');
 const baseUsers=Number(plan.max_users),requestedUsers=Number(userLimit);
 if(!Number.isInteger(requestedUsers)||requestedUsers<1)throw new Error('Nombre d’utilisateurs invalide.');
 let amount;
 if(plan.plan_type==='customized'){
  const prices=parseJson(plan.module_prices,{});
  if(!Array.isArray(selectedModules)||selectedModules.length===0)throw new Error('Sélectionnez au moins une fonctionnalité.');
  amount=selectedModules.reduce((total,module)=>{
   if(!MODULE_KEYS.includes(module)||!Number.isFinite(Number(prices?.[module]?.[interval])))throw new Error('Un tarif de fonctionnalité est indisponible pour cette période.');
   return total+Number(prices[module][interval]);
  },0)+Number(plan.extra_user_price)*requestedUsers;
 }else{
  const value=plan[PRICE_COLUMNS[interval]];
  if(value===null||value===undefined||!Number.isFinite(Number(value)))throw new Error('Ce forfait n’est pas encore tarifé pour cette période.');
  if(requestedUsers>baseUsers+10000)throw new Error('Le nombre d’utilisateurs dépasse la limite autorisée.');
  amount=Number(value)+Number(plan.extra_user_price)*Math.max(0,requestedUsers-baseUsers);
 }
 if(!Number.isFinite(amount)||amount<0||amount>999999999)throw new Error('Le montant du forfait est invalide.');
 return Math.round(amount*100)/100;
}

module.exports={ALL_MODULES,CUSTOMIZED_MODULE_PRICES,DEFAULT_PLANS,INTERVAL_DAYS,INTERVALS,MODULES,MODULE_KEYS,PRICE_COLUMNS,STARTER_MODULES,getPlanModules,getTermPrice,parseJson};
