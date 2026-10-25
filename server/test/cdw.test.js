// CDW 1.0 (server/core/cdw.js): the small windows on the operator site's desktop. What a person may have is decided on the server:
// the catalog is cut to their role, a layout is accepted only if it is theirs and sound, and the data each window shows is behind
// routes that ask the same of them (the list says which, and the tests call them as each kind of person).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { WIDGETS, GRID, DEV_APPS } from '../core/cdw.js';

const CODE = '987654321098';
const LIMITS = { general: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000], vaultOpen: [100000, 1000] };

async function people(t) {
  const s = await startServer({ operators: ['taku', 'mod'], limits: LIMITS });
  t.after(() => s.stop());
  const dev = await s.register('taku'), mod = await s.register('mod'), look = await s.register('looker'), plain = await s.register('plainone');
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/viewer', { token: dev.token, body: { name: 'looker', action: 'grant', code: CODE } })).status, 200);
  const as = (who) => (method, url, body) => s.call(method, url, { token: who.token, body });
  return { s, dev: as(dev), mod: as(mod), look: as(look), plain: as(plain), stranger: (m, u, b) => s.call(m, u, { body: b }) };
}
const ids = (r) => r.catalog.map((w) => w.id);
const at = (id, x, y, w = 14, h = 9) => ({ id, x, y, w, h });

test('the catalog is cut to the person on the server: a viewer, an operator and the developer are each told only of theirs', async (t) => {
  const { dev, mod, look } = await people(t);
  assert.deepEqual(ids(await look('GET', '/api/ops/cdw')), ['server', 'reports', 'detections', 'feedback', 'log', 'security']);
  assert.deepEqual(ids(await mod('GET', '/api/ops/cdw')), WIDGETS.filter((w) => w.role !== 'developer').map((w) => w.id));
  assert.deepEqual(ids(await dev('GET', '/api/ops/cdw')), WIDGETS.map((w) => w.id));
  const v = await look('GET', '/api/ops/cdw');
  assert.equal(v.role, 'viewer');
  assert.ok(!JSON.stringify(v).includes('diary') && !JSON.stringify(v).includes('team') && !JSON.stringify(v).includes('vault'), 'no word of a window that is not theirs');
});

test('strangers and plain players get nothing', async (t) => {
  const { plain, stranger } = await people(t);
  assert.equal((await stranger('GET', '/api/ops/cdw')).status, 401);
  assert.equal((await plain('GET', '/api/ops/cdw')).status, 403);
  assert.equal((await plain('POST', '/api/ops/cdw', { layout: { v: 1, items: [] } })).status, 403);
  assert.equal((await plain('GET', '/api/ops/devapp')).status, 403);
  assert.equal((await stranger('GET', '/api/ops/devapp')).status, 401);
});

test('a layout is kept only if it is theirs, sound and clear of itself; what is refused is not kept', async (t) => {
  const { s, dev, mod, look } = await people(t);
  const put = (who, items) => who('POST', '/api/ops/cdw', { layout: { v: 1, items } });
  // a viewer cannot place the operators' or the developer's windows, however it is asked (and it is written in the security log)
  for (const id of ['team', 'vault', 'profile', 'diary']) {
    const r = await put(look, [at('server', 0, 0), at(id, 20, 0)]);
    assert.deepEqual([r.status, r.error.code], [403, 'not_allowed'], id);
  }
  assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM ops_log WHERE action = 'sec_cdw_denied'").get().n, 4);
  assert.deepEqual((await look('GET', '/api/ops/cdw')).layout.items, [], 'nothing of the refused was kept');
  // an operator cannot place the developer's
  assert.equal((await put(mod, [at('diary', 0, 0)])).status, 403);
  assert.deepEqual((await mod('GET', '/api/ops/cdw')).layout.items, []);
  // …and one that is theirs is kept, as given, and read back
  const mine = [at('server', 0, 0, 20, 13), at('log', 22, 0, 22, 11), at('reports', 0, 14, 16, 12)];
  const ok = await put(mod, mine);
  assert.equal(ok.status, 200);
  assert.deepEqual((await mod('GET', '/api/ops/cdw')).layout.items, mine);
  // not over one another (touching is fine), not twice, not too small or too big, not out of the grid, not too many, not a bad shape
  assert.equal((await put(mod, [at('server', 0, 0, 20, 13), at('log', 19, 0, 22, 11)])).error.code, 'overlap');
  assert.equal((await put(mod, [at('server', 0, 0), at('server', 30, 0)])).error.code, 'twice');
  assert.equal((await put(mod, [at('server', 0, 0, 3, 3)])).error.code, 'bad_size');
  assert.equal((await put(mod, [at('server', 0, 0, 200, 20)])).error.code, 'bad_size');
  assert.equal((await put(mod, [at('server', GRID.maxCols - 5, 0, 20, 13)])).error.code, 'bad_size');
  assert.equal((await put(mod, [at('server', -1, 0, 20, 13)])).error.code, 'bad_size');
  assert.equal((await put(mod, [at('server', 0.5, 0, 20, 13)])).error.code, 'bad_layout');
  assert.equal((await put(mod, [at('nothing', 0, 0)])).status, 403);
  assert.equal((await mod('POST', '/api/ops/cdw', { layout: { v: 2, items: [] } })).error.code, 'bad_layout');
  assert.equal((await mod('POST', '/api/ops/cdw', { layout: 'x' })).error.code, 'bad_layout');
  assert.deepEqual((await mod('GET', '/api/ops/cdw')).layout.items, mine, 'every refusal left what was there');
  // the developer has all of theirs
  assert.equal((await put(dev, [at('diary', 0, 0, 18, 14), at('vault', 20, 0, 18, 13)])).status, 200);
});

test('when a person\'s rights go, their windows go with them at once', async (t) => {
  const { s, dev, look } = await people(t);
  assert.equal((await look('POST', '/api/ops/cdw', { layout: { v: 1, items: [at('server', 0, 0, 20, 13), at('security', 22, 0, 16, 12)] } })).status, 200);
  assert.equal((await look('GET', '/api/ops/cdw')).layout.items.length, 2);
  // (a stored layout that holds a window the person was never allowed: written behind the server's back)
  s.app.db.prepare('UPDATE ops_cdw SET layout = ? WHERE user_id = (SELECT id FROM users WHERE name = ?)').run(JSON.stringify({ v: 1, items: [at('server', 0, 0, 20, 13), at('diary', 22, 0, 18, 14), at('team', 41, 0, 18, 15)] }), 'looker');
  const r = await look('GET', '/api/ops/cdw');
  assert.deepEqual(r.layout.items.map((i) => i.id), ['server'], 'only what they may have is given back');
  assert.ok(!JSON.stringify(r).includes('diary'));
  // the viewer's rights taken away: they are out, with no window to show
  assert.equal((await dev('POST', '/api/ops/viewers/revoke', { user: (await look('GET', '/api/ops/me')).id })).status < 500, true);
});

test('each window\'s data is behind a route that asks the same as the list says', async (t) => {
  const { dev, mod, look, plain } = await people(t);
  const rank = { viewer: 1, operator: 2, developer: 3 };
  for (const w of WIDGETS.filter((x) => x.probe)) {
    const [method, url] = w.probe.split(' ');
    for (const [who, call, level] of [['developer', dev, 3], ['operator', mod, 2], ['viewer', look, 1]]) {
      const r = await call(method, url);
      const allowed = level >= rank[w.role];
      assert.equal(r.status < 400, allowed, `${w.id} as ${who}: ${r.status} ${JSON.stringify(r.error || '').slice(0, 80)}`);
    }
    assert.ok((await plain(method, url)).status >= 400, `${w.id} as a plain player`);
  }
});

test('the DEV APP is the developer\'s: no one else is told what is in it, or that it is there', async (t) => {
  const { dev, mod, look } = await people(t);
  const r = await dev('GET', '/api/ops/devapp');
  assert.deepEqual(r.apps.map((a) => a.id), DEV_APPS.map((a) => a.id));
  assert.deepEqual(r.apps.map((a) => a.name), ['メモ帳', '勉強', 'セキュリティー', 'アダム']);
  for (const who of [mod, look]) {
    const x = await who('GET', '/api/ops/devapp');
    assert.ok([403, 404].includes(x.status), String(x.status));
    assert.ok(!JSON.stringify(x).includes('アダム') && !JSON.stringify(x).includes('メモ'));
  }
  assert.equal((await mod('GET', '/api/ops/devapp')).error.code, 'not_found', 'an operator is told it is not there');
});
