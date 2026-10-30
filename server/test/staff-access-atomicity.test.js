import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

for(const kind of ['operator','viewer'])for(const action of ['grant','revoke'])test(`${kind} ${action} keeps permissions, pins and sessions unchanged when its audit cannot be saved`,async t=>{
  const s=await startServer({operators:['taku']});t.after(()=>s.stop());t.mock.method(console,'error',()=>{});
  const dev=await s.register('taku'),p=await s.register('AtomicStaff'),code='987654321098';
  assert.equal((await s.call('POST','/api/ops/dev-code',{token:dev.token,body:{code}})).status,200);
  const change=(what,how)=>s.call('POST','/api/ops/'+what,{token:dev.token,body:{name:p.me.name,action:how,code}});
  if(action==='revoke')assert.equal((await change(kind,'grant')).status,200);
  if(kind==='operator'&&action==='grant')assert.equal((await change('viewer','grant')).status,200);
  // A real view-only token has already been issued; a failed promotion/revoke
  // must not consume it or leave an account silently promoted.
  if(action==='revoke'||kind==='operator'&&action==='grant') {
    const login=await s.call('POST','/api/ops/login',{body:{name:p.me.name,password:'pass1234'}});assert.equal(login.status,200,JSON.stringify(login));
    if(kind==='viewer'||action==='grant')assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND scope='view'").get(p.me.id).n,1);
  }
  const state=()=>({access:s.app.db.prepare('SELECT * FROM ops_access ORDER BY name_key').all(),
    viewers:s.app.db.prepare('SELECT * FROM ops_viewers ORDER BY user_id').all(),pins:s.app.db.prepare('SELECT * FROM staff_pins ORDER BY name_key').all(),
    sessions:s.app.db.prepare('SELECT token_hash,user_id,scope,ended FROM sessions WHERE user_id=? ORDER BY token_hash').all(p.me.id)});
  const before=state(),events=[],send=s.app.live.send;s.app.live.send=function(...args){events.push(args);return send.apply(this,args);};
  const logged=(kind==='operator'?'ops_':'viewer_')+action;
  s.app.db.exec(`CREATE TRIGGER fail_staff_access_audit BEFORE INSERT ON ops_log WHEN NEW.action='${logged}' BEGIN SELECT RAISE(ABORT,'simulated staff audit failure'); END`);
  const failed=await change(kind,action);assert.equal(failed.status,500);assert.deepEqual(state(),before);
  assert.equal(events.some(([id,event])=>id===p.me.id&&['kick','viewer'].includes(event)),false);
  s.app.db.exec('DROP TRIGGER fail_staff_access_audit');assert.equal((await change(kind,action)).status,200);
  assert.equal((await change(kind,action)).status,409);
});
