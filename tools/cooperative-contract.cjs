// Deterministic real HTTP rollback/retry contract, shared with local workerd.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
exports.cooperativeContract = async function (base, admin) {
  const {RULES}=await import('../server/core/rules.js');
  async function call(method,path,actor,body) {
    const headers={'Content-Type':'application/json','X-Device':crypto.randomBytes(16).toString('hex')};
    if(actor)headers.Authorization='Bearer '+actor.token;if(path==='/api/admin')headers['X-Admin-Token']=admin;
    const r=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return {...await r.json(),status:r.status};
  }
  const register=name=>call('POST','/api/register',null,{name,password:'pass1234',avatar:'traveler-green'});
  const a=await register('CoopBuyer'),b=await register('CoopOwner');assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal((await call('POST','/api/friends/request',a,{user:b.me.id})).status,200);
  assert.equal((await call('POST','/api/friends/respond',b,{user:a.me.id,accept:true})).status,200);
  assert.equal((await call('POST','/api/watch',a,{user:b.me.id,on:true})).status,200);
  async function backup(){const r=await call('POST','/api/admin',null,{cmd:'export',args:[]});assert.equal(r.status,200);return r.result;}
  async function restore(data){const r=await call('POST','/api/admin',null,{cmd:'import',args:[data,true]});assert.equal(r.status,200);}
  const data=await backup(),now=Date.now();
  Object.assign(data.tables.users.find(u=>u.id===a.me.id),{tokens:100000,dollars:Number.MAX_SAFE_INTEGER,quests:'{}',
    vip_exp:RULES.vip.levels[1]-RULES.vip.exp.quest,vip_until:now+86400000,jobs:JSON.stringify([{id:'garage',since:now-3600000}])});
  await restore(data);
  const state=d=>({users:d.tables.users.filter(u=>[a.me.id,b.me.id].includes(u.id)).map(({id,tokens,dollars,rev,quests,jobs,vip_exp,vip_until})=>({id,tokens,dollars,rev,quests,jobs,vip_exp,vip_until})),bets:d.tables.watch_bets});
  const before=state(await backup()),body={side:'hit',stake:RULES.watchBet.stakes[0]},trace=[];
  const failed=await call('POST','/api/watch/bet',a,body);assert.deepEqual([failed.status,failed.error?.code],[409,'balance_limit']);
  trace.push({label:'watch bet rejects quest VIP wages above the balance limit',status:failed.status,error:failed.error.code});
  const after=await backup();assert.deepEqual(state(after),before);trace.push({label:'failed watch bet preserves stake, bet slot, wages and progress',data:true});
  after.tables.users.find(u=>u.id===a.me.id).dollars=1000000;await restore(after);
  const retry=await call('POST','/api/watch/bet',a,body);assert.equal(retry.status,200);assert.equal(retry.balance.tokens,100000-body.stake);
  const settled=state(await backup());assert.equal(settled.bets.length,1);trace.push({label:'repaired watch bet settles once',status:retry.status,data:true});
  const repeated=await call('POST','/api/watch/bet',a,body);assert.deepEqual([repeated.status,repeated.error?.code],[409,'bet_open']);assert.deepEqual(state(await backup()),settled);
  trace.push({label:'an open watch bet cannot spend the stake twice',status:repeated.status,error:repeated.error.code});return trace;
};
