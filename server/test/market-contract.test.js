import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { marketContract } from '../../tools/market-contract.cjs';

test('the real HTTP market contract preserves a failed VIP wage purchase and retries exactly once', async t => {
  const admin = 'market-test-admin-' + 'a'.repeat(24), s = await startServer({ adminToken: admin, quests: true });
  t.after(() => s.stop());
  const trace = await marketContract(s.base, admin);
  assert.equal(trace.length, 4);
});
