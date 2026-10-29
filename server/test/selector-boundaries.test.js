import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const SPECIAL = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
async function fixture(t) {
  const s = await startServer({ operators: ['taku'] }); t.after(() => s.stop());
  const dev = await s.register('taku'), player = await s.register('SelectorUser');
  return { s, dev, player };
}
test('tree markets reject inherited object names without making auctions or changing balances', async t => {
  const { s, player } = await fixture(t);
  for (const market of SPECIAL) {
    const r = await s.call('POST', '/api/tree/auction/start', { token: player.token, body: { market } });
    assert.equal(r.status, 400, market); assert.equal(r.error.code, 'bad_market');
  }
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM tree_auctions').get().n, 0);
  assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id=?').get(player.me.id).dollars, player.me.dollars);
});
test('ban kinds reject inherited object names without imposing a malformed account restriction', async t => {
  const { s, dev, player } = await fixture(t);
  for (const kind of SPECIAL) {
    const r = await s.call('POST', '/api/ops/ban', { token: dev.token, body: { id: player.me.id, kind } });
    assert.equal(r.status, 400, kind); assert.equal(r.error.code, 'bad_kind');
  }
  assert.equal(s.app.db.prepare('SELECT banned FROM users WHERE id=?').get(player.me.id).banned, 0);
});
test('vault speed cannot be poisoned with inherited object names', async t => {
  const { s, dev } = await fixture(t);
  for (const speed of SPECIAL) {
    const r = await s.call('POST', '/api/vault/speed', { token: dev.token, body: { speed } });
    assert.equal(r.status, 400, speed); assert.equal(r.error.code, 'bad_speed');
  }
  assert.equal(s.app.db.prepare("SELECT value FROM meta WHERE key='vault_speed'").get(), undefined);
  assert.equal((await s.call('POST', '/api/vault/speed', { token: dev.token, body: { speed: 'normal' } })).status, 200);
});
test('backup schedules cannot be poisoned with inherited object names', async t => {
  const { s, dev } = await fixture(t), code = '987654321098';
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code } })).status, 200);
  const opened = await s.call('POST', '/api/backup/open', { token: dev.token, body: { code } });
  for (const every of SPECIAL) {
    const r = await s.call('POST', '/api/backup/settings', { token: dev.token, body: { every, keep: 10, code }, headers: { 'X-Backup-Ticket': opened.ticket } });
    assert.equal(r.status, 400, every); assert.equal(r.error.code, 'bad_every');
  }
  assert.equal(s.app.db.prepare("SELECT value FROM meta WHERE key='backup_settings'").get(), undefined);
});
test('OAuth provider selection rejects inherited names and retains valid links', async t => {
  const { s, player } = await fixture(t);
  s.app.db.prepare("INSERT INTO oauth_identities(provider,subject,user_id,label,linked_at) VALUES('google','original-subject',?,'',?)").run(player.me.id, Date.now());
  for (const provider of SPECIAL) {
    const r = await s.call('POST', '/api/oauth/unlink', { token: player.token, body: { provider } });
    assert.equal(r.status, 400, provider); assert.equal(r.error.code, 'bad_provider');
  }
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id=?').get(player.me.id).n, 1);
});

test('invalid stored vault speed falls back to a usable default', async t => {
  const { s, dev } = await fixture(t);
  const set = s.app.db.prepare("INSERT INTO meta(key,value) VALUES('vault_speed',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const value of [...SPECIAL, 'unknown']) {
    set.run(value);
    const r = await s.call('GET', '/api/vault/files', { token: dev.token });
    assert.equal(r.status, 200); assert.equal(r.speed.id, 'max');
    assert.ok(Number.isFinite(r.chunk) && r.chunk > 0);
  }
});

test('invalid stored backup schedules recover to manual mode and a valid retention count', async t => {
  const { s, dev } = await fixture(t), code = '987654321098';
  await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code } });
  const opened = await s.call('POST', '/api/backup/open', { token: dev.token, body: { code } });
  const set = s.app.db.prepare("INSERT INTO meta(key,value) VALUES('backup_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  for (const value of [...SPECIAL.map(every => ({ every, keep: -1 })), null, [], 'bad', { every: '24h', keep: '100' }]) {
    set.run(JSON.stringify(value));
    const r = await s.call('GET', '/api/backup', { token: dev.token, headers: { 'X-Backup-Ticket': opened.ticket } });
    assert.equal(r.status, 200); assert.equal(r.settings.keep, 30);
    assert.equal(r.settings.every, value?.every === '24h' ? '24h' : 'off');
    assert.equal(r.next, 0);
  }
});
