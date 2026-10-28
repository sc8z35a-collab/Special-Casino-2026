import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { statements } from '../core/db.js';
import { createSecComm } from '../core/seccomm.js';

test('concurrent first secure-channel connections share one persisted server identity', async t => {
  const s = await startServer(); t.after(() => s.stop()); const q = statements(s.app.db);
  const comm = createSecComm({ q, secret: 'disposable-identity-test', opsLog: { add() {} }, roleOf: () => 'operator' });
  const identities = await Promise.all(Array.from({ length: 12 }, () => comm.identity()));
  assert.equal(new Set(identities.map(i => i.spki)).size, 1);
  const restarted = createSecComm({ q, secret: 'disposable-identity-test', opsLog: { add() {} }, roleOf: () => 'operator' });
  assert.equal((await restarted.identity()).spki, identities[0].spki);
});

test('separate instances racing to create an identity return the same winning key', async t => {
  const s = await startServer(); t.after(() => s.stop()); const q = statements(s.app.db);
  const instances = Array.from({ length: 8 }, () => createSecComm({ q, secret: 'shared-identity-test', opsLog: { add() {} }, roleOf: () => 'operator' }));
  const identities = await Promise.all(instances.map(c => c.identity()));
  assert.equal(new Set(identities.map(i => i.spki)).size, 1);
  assert.equal(q('SELECT pub FROM sec_identity WHERE id=1').get().pub, identities[0].spki);
});
