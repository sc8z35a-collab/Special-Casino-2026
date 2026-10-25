// "Only the developer" is the server's rule, not the page's: every feature behind a developer-only tab or button is asked of the
// caller by its own route, whatever the page shows. This test calls each of them as an operator, a 閲覧者 and a plain player, with the
// page out of the picture, and requires a refusal; the developer's safe reads are required to work (so the refusal is about the person,
// not about a broken route). Add a developer-only route to the list when one is made. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const CODE = '987654321098';
const LIMITS = { general: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000], login: [100000, 1000] };

// [method, path, body]: what the developer's tabs and buttons call
const DEV_ONLY = [
  ['GET', '/api/ops/diary'], ['GET', '/api/ops/diary/image?post=1'], ['POST', '/api/ops/diary', { title: 'a', text: 'b' }], ['POST', '/api/ops/diary/visibility', { post: 1 }],
  ['POST', '/api/ops/diary/delete', { post: 1 }], ['GET', '/api/ops/diary/comments?post=1'],
  ['GET', '/api/ops/pay'], ['POST', '/api/ops/pay/reply', { order: 'x', text: 'y' }],
  ['POST', '/api/backup/open', {}], ['GET', '/api/backup'],
  ['GET', '/api/emergency'], ['POST', '/api/emergency/stop', {}], ['POST', '/api/emergency/release', {}],
  ['POST', '/api/ops/speed', { speed: 'high' }], ['POST', '/api/ops/operator', { name: 'x', action: 'grant', code: CODE }],
  ['POST', '/api/ops/viewer', { name: 'x', action: 'grant', code: CODE }], ['POST', '/api/ops/dev-code', { code: '111122223333' }],
  ['GET', '/api/ops/entries'], ['GET', '/api/ops/team/pairs'], ['GET', '/api/ops/team/pair?a=1&b=2'],
  ['GET', '/api/ops/delete-account'], ['POST', '/api/ops/delete-account', { id: 1, code: CODE }],
  ['POST', '/api/ops/patrol/run', {}], ['POST', '/api/ops/stele/run', {}], ['GET', '/api/ops/log/archive'],
  ['GET', '/api/ops/devapp'], ['GET', '/api/ops/cdw/dev-only-nothing']
];
// the reads that are safe to make as the developer (they must work)
const DEV_READS = ['/api/ops/diary', '/api/ops/pay', '/api/ops/entries', '/api/ops/devapp', '/api/ops/team/pairs', '/api/ops/log/archive'];

test('every developer-only feature refuses an operator, a 閲覧者 and a player on the server; the developer gets in', async (t) => {
  const s = await startServer({ operators: ['taku', 'mod'], limits: LIMITS });
  t.after(() => s.stop());
  const dev = await s.register('taku'), mod = await s.register('mod'), look = await s.register('looker'), plain = await s.register('plainone');
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/viewer', { token: dev.token, body: { name: 'looker', action: 'grant', code: CODE } })).status, 200);
  const view = await s.call('POST', '/api/ops/login', { body: { name: 'looker', password: 'pass1234' }, headers: { 'X-Ops-Device': 'browser-vvvvvvvvvvvvvvvv' } });
  assert.equal(view.viewer, true);

  const refused = (r) => [401, 403, 404].includes(r.status);
  for (const [method, path, body] of DEV_ONLY) {
    for (const [who, token] of [['an operator', mod.token], ['a game session of a 閲覧者', look.token], ['a look-only session', view.token], ['a player', plain.token], ['nobody', undefined]]) {
      const r = await s.call(method, path, { token, body });
      assert.ok(refused(r), `${method} ${path} as ${who}: ${r.status} ${JSON.stringify(r).slice(0, 140)}`);
      // (and not a single field of what it would show)
      assert.ok(!('posts' in r) && !('orders' in r) && !('entries' in r && who !== 'nobody' && path.includes('entries')), `${method} ${path} as ${who} showed something`);
    }
  }
  for (const path of DEV_READS) {
    const r = await s.call('GET', path, { token: dev.token });
    assert.ok(r.status === 200, `GET ${path} as the developer: ${r.status} ${JSON.stringify(r).slice(0, 140)}`);
  }
});
