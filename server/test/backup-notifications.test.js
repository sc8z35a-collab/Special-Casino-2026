import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { createAdmin } from '../core/admin.js';

test('a full database backup with notification keys restores every account and endpoint without rejecting p256dh',async t=>{
  const s=await startServer();t.after(()=>s.stop());const p=await s.register('RestorePush'),q=sql=>s.app.db.prepare(sql);
  q('INSERT INTO push_subs VALUES(?,?,?,?,?)').run('https://fcm.googleapis.com/fcm/send/restore',p.me.id,'p256dh-test-key','auth-test-key',Date.now());
  const admin=createAdmin(s.app.db), backup=admin.export(), before=q('SELECT * FROM push_subs').all();
  assert.doesNotThrow(()=>admin.import(backup,{replace:true}));
  assert.deepEqual(q('SELECT * FROM push_subs').all(),before);
  assert.equal((await s.call('GET','/api/me',{token:p.token})).me.id,p.me.id);
});

test('backup column validation still rejects injected SQL and rolls back all earlier table changes',async t=>{
  const s=await startServer();t.after(()=>s.stop());const p=await s.register('SafeRestore'),q=sql=>s.app.db.prepare(sql),admin=createAdmin(s.app.db);
  const backup=admin.export(), before=q('SELECT * FROM users WHERE id=?').get(p.me.id);
  backup.tables.users.find(u=>u.id===p.me.id).dollars=0;
  backup.tables.push_subs.push({endpoint:'injected',user_id:p.me.id,auth:'test',created_at:1,'p256dh); DROP TABLE users; --':'test'});
  assert.throws(()=>admin.import(backup,{replace:true}),/列名/);
  assert.deepEqual(q('SELECT * FROM users WHERE id=?').get(p.me.id),before);
});
