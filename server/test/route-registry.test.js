import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteRegistry } from '../core/route-registry.js';
import { startServer } from './helpers.js';

test('startup lists every conflicting owner, including duplicate entries in a single definition', () => {
  const r = createRouteRegistry(), f = () => 1;
  r.add('core', [['GET /api/one', f], ['GET /api/one', f], ['POST /api/two', f]]);
  r.add('module', { 'GET /api/one': f, 'POST /api/two': f });
  assert.equal(r.report().duplicates.length, 3);
  assert.throws(() => r.assertUnique(), /GET \/api\/one: core -> core[\s\S]*GET \/api\/one: core -> module[\s\S]*POST \/api\/two: core -> module/);
  assert.throws(() => r.replace('wrapper', 'GET /api/missing', f), /missing/);
});

test('the real server has unique routes, and explicit wrappers preserve the established routes', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const report = s.app.api.routeReport();
  assert.deepEqual(report.duplicates, []);
  assert.deepEqual(report.routes.map(r => r.key).sort(), s.app.api.routeKeys().sort());
  assert.ok(report.routes.length > 250);
  for (const key of ['GET /api/ops/me', 'GET /api/ops/players', 'GET /api/ops/counts', 'GET /api/ops/reports'])
    assert.ok(report.replacements.some(r => r.key === key), key);
});
