import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { statements } from '../core/db.js';
import { createDevCode } from '../core/devcode.js';
import { hashPassword, verifyPassword } from '../core/auth.js';

test('parallel developer-code guesses retain every strike and enforce the address limit', async t => {
  const s = await startServer(); t.after(() => s.stop()); const q = statements(s.app.db), entries = [];
  q("INSERT INTO meta(key,value) VALUES('dev_code',?)").run(await hashPassword('12345678'));
  const code = createDevCode({ q, opsLog: { add: entry => entries.push(entry) } });
  const results = await Promise.allSettled(Array.from({ length: 12 }, () => code.check('87654321', { ip: '192.0.2.1' })));
  assert.equal(results.filter(r => r.reason?.code === 'dev_code').length, 5);
  assert.equal(results.filter(r => r.reason?.code === 'dev_code_locked').length, 7);
  assert.equal(JSON.parse(q("SELECT value FROM meta WHERE key='dev_code_fails'").get().value).n, 5);
  assert.equal(entries.length, 5);
});

test('parallel first-time code registrations cannot silently overwrite each other', async t => {
  const s = await startServer(); t.after(() => s.stop()); const q = statements(s.app.db);
  const code = createDevCode({ q, opsLog: { add() {} } });
  const values = ['12345678', '87654321'];
  const results = await Promise.allSettled(values.map(value => code.register(value, '', { ip: '192.0.2.1' }, null)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'dev_code_changed');
  const winner = values[results.findIndex(r => r.status === 'fulfilled')];
  assert.equal(await verifyPassword(winner, q("SELECT value FROM meta WHERE key='dev_code'").get().value), true);
});
