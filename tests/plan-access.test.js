const test=require('node:test');
const assert=require('node:assert/strict');
const {requireFeature}=require('../src/middleware/plan-access');

function invoke(guard,user){
 let nextCalled=false,statusCode=200,body;
 const response={status(code){statusCode=code;return this;},json(value){body=value;return this;}};
 guard({user},response,()=>{nextCalled=true;});
 return {nextCalled,statusCode,body};
}

test('starter can access included modules but not administration features',()=>{
 const user={role:'OWNER',subscription_modules:'["stock","procurement","sales","cash"]'};
 assert.equal(invoke(requireFeature('stock'),user).nextCalled,true);
 const denied=invoke(requireFeature('administration'),user);
 assert.equal(denied.nextCalled,false);
 assert.equal(denied.statusCode,403);
 assert.match(denied.body.error,/n’est pas comprise/);
});

test('invalid feature data fails closed while subscriptions without a module list remain unrestricted',()=>{
 assert.equal(invoke(requireFeature('reports'),{subscription_modules:'invalid'}).statusCode,403);
 assert.equal(invoke(requireFeature('reports'),{subscription_modules:null}).nextCalled,true);
});
