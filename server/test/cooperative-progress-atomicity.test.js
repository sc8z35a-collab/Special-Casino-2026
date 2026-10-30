import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from './helpers.js';
import {RULES} from '../core/rules.js';

async function fixture(t) {
  const now=Date.now();t.mock.method(Date,'now',()=>now);t.mock.method(console,'error',()=>{});
  const s=await startServer({quests:true});t.after(()=>s.stop());
  const a=await s.register('CoopMember'),b=await s.register('CoopHost');await s.befriend(a,b);
  const host=await s.listen(b),guest=await s.listen(a);t.after(()=>{host.close();guest.close();});
  return {s,a,b,now};
}
function state(s) {
  const read=sql=>s.app.db.prepare(sql).all();
  return {users:read('SELECT id,tokens,dollars,coins,rev,quests,jobs,vip_exp,vip_until FROM users ORDER BY id'),
    bets:read('SELECT * FROM watch_bets ORDER BY id'),hubs:read('SELECT * FROM hubs ORDER BY id'),members:read('SELECT * FROM hub_members ORDER BY user_id'),
    invites:read('SELECT * FROM hub_invites ORDER BY from_id,to_id')};
}
function failProgress(s,id){s.app.db.exec(`CREATE TRIGGER fail_coop_progress BEFORE UPDATE OF quests ON users WHEN NEW.id=${id} AND NEW.quests != OLD.quests BEGIN SELECT RAISE(ABORT,'simulated cooperative progress save failure'); END`);}
test('a failed watch-bet quest save cannot consume tokens, open a bet or notify the host',async t=>{
  const {s,a,b}=await fixture(t);assert.equal((await s.call('POST','/api/watch',{token:a.token,body:{user:b.me.id,on:true}})).status,200);
  s.setUser(a.me.id,{quests:'{}',tokens:100000});const before=state(s),events=[],send=s.app.live.send;s.app.live.send=function(...args){events.push(args);return send.apply(this,args);};
  failProgress(s,a.me.id);const body={stake:RULES.watchBet.stakes[0],side:'hit'},call=()=>s.call('POST','/api/watch/bet',{token:a.token,body});
  const failed=await call();assert.equal(failed.status,500,JSON.stringify(failed));assert.deepEqual(state(s),before);assert.equal(events.some(([,name])=>['balance','watch','quest'].includes(name)),false);
  s.app.db.exec('DROP TRIGGER fail_coop_progress');const retry=await call();assert.equal(retry.status,200);assert.equal(retry.balance.tokens,before.users.find(p=>p.id===a.me.id).tokens-body.stake);
  assert.equal((await call()).error.code,'bet_open');assert.equal(state(s).bets.length,1);
});
for(const failedPlayer of ['joiner','host'])test(`hub creation keeps its invitation and both memberships when ${failedPlayer} progress cannot be saved`,async t=>{
  const {s,a,b}=await fixture(t);assert.equal((await s.call('POST','/api/hub/invite',{token:b.token,body:{to:a.me.id}})).status,200);
  for(const p of [a,b])s.setUser(p.me.id,{quests:'{}'});
  const before=state(s),events=[],send=s.app.live.send;s.app.live.send=function(...args){events.push(args);return send.apply(this,args);};
  failProgress(s,failedPlayer==='joiner'?a.me.id:b.me.id);const call=()=>s.call('POST','/api/hub/join',{token:a.token,body:{from:b.me.id}});
  assert.equal((await call()).status,500);assert.deepEqual(state(s),before);assert.equal(events.some(([,name])=>['hub','quest','balance'].includes(name)),false);
  s.app.db.exec('DROP TRIGGER fail_coop_progress');const retry=await call();assert.equal(retry.status,200);assert.equal(state(s).members.length,2);assert.equal(state(s).invites.length,0);
  assert.equal((await call()).error.code,'no_invite');
});
