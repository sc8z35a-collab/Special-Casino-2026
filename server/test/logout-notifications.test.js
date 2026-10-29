import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
async function fixture(t) {
  const s=await startServer();t.after(()=>s.stop());const a=await s.register('LogoutOwner'),b=await s.register('LogoutNext');
  const second=await s.call('POST','/api/login',{body:{name:a.me.name,password:'pass1234'}}),q=sql=>s.app.db.prepare(sql);
  for(const [ep,id] of [['phone',a.me.id],['other-phone',a.me.id],['foreign-phone',b.me.id]])q('INSERT INTO push_subs VALUES(?,?,?,?,?)').run(ep,id,'test-key','test-auth',Date.now());
  return {s,a,b,second,q};
}
test('logout atomically detaches the specified phone while preserving other devices and sessions',async t=>{
  const {s,a,b,second,q}=await fixture(t);
  assert.equal((await s.call('POST','/api/logout',{token:a.token,body:{endpoint:'phone'}})).status,200);
  assert.equal(q('SELECT * FROM push_subs WHERE endpoint=?').get('phone'),undefined);
  assert.equal(q('SELECT COUNT(*) AS n FROM push_subs').get().n,2);
  assert.equal((await s.call('GET','/api/me',{token:a.token})).status,401);
  assert.equal((await s.call('GET','/api/me',{token:second.token})).status,200);
  assert.equal((await s.call('GET','/api/me',{token:b.token})).status,200);
});
test('a failed phone detach cannot end the session or remove another account notification device',async t=>{
  const {s,a,q}=await fixture(t);t.mock.method(console,'error',()=>{});
  s.app.db.exec("CREATE TRIGGER fail_logout_detach BEFORE DELETE ON push_subs BEGIN SELECT RAISE(ABORT,'simulated logout detach failure'); END");
  assert.equal((await s.call('POST','/api/logout',{token:a.token,body:{endpoint:'phone'}})).status,500);
  assert.equal((await s.call('GET','/api/me',{token:a.token})).status,200);assert.ok(q('SELECT * FROM push_subs WHERE endpoint=?').get('phone'));
  s.app.db.exec('DROP TRIGGER fail_logout_detach');
  assert.equal((await s.call('POST','/api/logout',{token:a.token,body:{endpoint:'foreign-phone'}})).status,200);
  assert.ok(q('SELECT * FROM push_subs WHERE endpoint=?').get('foreign-phone'));
});
