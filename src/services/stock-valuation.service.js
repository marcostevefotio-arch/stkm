// Quantities use three decimal places, costs use four, and calculations use integers.
function scaled(value, places, max) {
 const text=String(value);
 const match=/^(\d+)(?:\.(\d+))?$/.exec(text);
 if(!match||((match[2]||'').length>places))throw new RangeError('Valeur décimale invalide.');
 const result=BigInt(match[1])*10n**BigInt(places)+BigInt((match[2]||'').padEnd(places,'0')||'0');
 if(result>max)throw new RangeError('Valeur décimale hors limites.');
 return result;
}

function averageCost(currentQuantity,currentCost,receivedQuantity,receivedCost) {
 const maxQuantity=99999999999999n, maxCost=999999999999999999n;
 const existing=scaled(currentQuantity,3,maxQuantity),received=scaled(receivedQuantity,3,maxQuantity);
 if(received===0n||existing+received>maxQuantity)throw new RangeError('Quantité reçue invalide.');
 const incoming=scaled(receivedCost,4,maxCost);
 if(existing>0n&&(currentCost===null||currentCost===undefined))return null;
 const previous=existing===0n?0n:scaled(currentCost,4,maxCost);
 const total=existing+received;
 const result=(existing*previous+received*incoming+total/2n)/total;
 return `${result/10000n}.${String(result%10000n).padStart(4,'0')}`;
}

module.exports={averageCost};
