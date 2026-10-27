import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { answerOnSocket } from '../core/socketapi.js';
async function fixture(t) {
  let now = Date.now(); const s = await startServer({ operators: ['Staff'], clock: () => now }); t.after(() => s.stop());
  const a = await s.register('ControlA'), b = await s.register('ControlB'); await s.befriend(a, b);
  const state = () => s.app.db.prepare('SELECT chat_ban FROM users WHERE id=?').get(a.me.id).chat_ban;
  const post = body => s.call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, ...body } });
  return { s, a, b, state, post, advance: ms => { now += ms; } };
}

test('control-only DMs are rejected twice with recoverable warnings, then stopped on the third across HTTP/live', async t => {
  const f = await fixture(t), text = '\0accidental clipboard control';
  const first = await f.post({ text }); assert.equal(first.status, 400); assert.equal(first.error.stage, 1); assert.equal(f.state(), 0);
  assert.equal((await f.post({ text: 'ordinary message' })).status, 200);
  const wire = JSON.parse(await answerOnSocket(f.s.app.api, { ip: '127.0.0.1' }, { id: 1, m: 'POST', p: '/api/messages', h: { authorization: 'Bearer ' + f.a.token }, b: { to: f.b.me.id, text } }));
  assert.equal(wire.s, 400); assert.equal(wire.b.error.stage, 2); assert.equal(f.state(), 0);
  const third = await f.post({ text }); assert.equal(third.status, 400); assert.equal(third.error.warning, undefined); assert.ok(f.state() > 0);
  assert.equal((await f.post({ text: 'blocked now' })).error.code, 'chat_banned');
  assert.equal(f.s.app.db.prepare('SELECT count(*) AS n FROM messages WHERE sender_id=? AND recipient_id=?').get(f.a.me.id, f.b.me.id).n, 1);
  const log = f.s.app.db.prepare("SELECT detail FROM ops_log WHERE action='filter_block' AND actor_id=?").all(f.a.me.id);
  assert.ok(log.every(row => !row.detail.includes('accidental clipboard')));
});

test('the warning window expires; binary/attachment violations keep immediate enforcement', async t => {
  const f = await fixture(t);
  assert.equal((await f.post({ text: '\0' })).error.stage, 1);
  f.advance(600001);
  assert.equal((await f.post({ text: '\0' })).error.stage, 1);
  assert.equal((await f.post({ text: 'text', attachment: 'not allowed' })).status, 400);
  assert.ok(f.state() > 0);
});
