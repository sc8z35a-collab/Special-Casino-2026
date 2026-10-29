import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, newDevice } from './helpers.js';

async function fixture(t, provider) {
  const s = await startServer({ googleClientId: 'test-google-id', googleClientSecret: 'test-google-secret',
    discordClientId: 'test-discord-id', discordClientSecret: 'test-discord-secret' }); t.after(() => s.stop());
  t.mock.method(console, 'error', () => {});
  const p = await s.register('OAuthAtomic'), q = sql => s.app.db.prepare(sql), headers = { 'X-Device': newDevice() };
  // The existing oauth.test.js covers the provider round trip. Here the
  // disposable flow is positioned immediately after successful identification.
  async function flow(link) {
    const started = await s.call('POST', link ? '/api/oauth/link-start' : '/api/oauth/start', { token: link ? p.token : undefined, headers, body: { provider } });
    assert.equal(started.status, 200);
    const id = crypto.createHash('sha256').update(started.flow).digest('hex');
    q("UPDATE oauth_flows SET status='done',subject='atomic-subject',label='Atomic provider' WHERE id=?").run(id);
    return { id, secret: started.flow };
  }
  function fail(table, when = '1') {
    s.app.db.exec(`CREATE TRIGGER fail_oauth_write BEFORE INSERT ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT,'simulated identity storage failure'); END`);
    return () => s.app.db.exec('DROP TRIGGER fail_oauth_write');
  }
  return { s, p, q, headers, flow, fail };
}

for (const provider of ['google', 'discord']) {
  test(`${provider} linking preserves its flow and identity ownership when the audit cannot be written`, async t => {
    const { s, p, q, headers, flow, fail } = await fixture(t, provider), f = await flow(true);
    const before = q('SELECT * FROM oauth_flows WHERE id=?').get(f.id), repair = fail('ops_log', "NEW.action='player_oauth_link'");
    const link = () => s.call('POST', '/api/oauth/link', { token: p.token, headers, body: { flow: f.secret } });
    assert.equal((await link()).status, 500);
    assert.equal(q('SELECT * FROM oauth_identities WHERE user_id=?').get(p.me.id), undefined);
    assert.deepEqual(q('SELECT * FROM oauth_flows WHERE id=?').get(f.id), before);
    repair(); assert.equal((await link()).status, 200);
    assert.equal(q('SELECT COUNT(*) AS n FROM oauth_identities WHERE user_id=?').get(p.me.id).n, 1);
    assert.equal(q('SELECT * FROM oauth_flows WHERE id=?').get(f.id), undefined);
    assert.equal(q("SELECT COUNT(*) AS n FROM ops_log WHERE action='player_oauth_link'").get().n, 1);
  });

  test(`${provider} unlinking cannot remove a login method when its audit fails`, async t => {
    const { s, p, q, fail } = await fixture(t, provider);
    q('INSERT INTO oauth_identities(provider,subject,user_id,label,linked_at) VALUES(?,?,?,?,?)').run(provider, 'atomic-subject', p.me.id, 'Identity', Date.now());
    const before = q('SELECT * FROM oauth_identities WHERE user_id=?').get(p.me.id), repair = fail('ops_log', "NEW.action='player_oauth_unlink'");
    const unlink = () => s.call('POST', '/api/oauth/unlink', { token: p.token, body: { provider } });
    assert.equal((await unlink()).status, 500); assert.deepEqual(q('SELECT * FROM oauth_identities WHERE user_id=?').get(p.me.id), before);
    repair(); assert.equal((await unlink()).status, 200); assert.equal((await unlink()).status, 200);
    assert.equal(q('SELECT * FROM oauth_identities WHERE user_id=?').get(p.me.id), undefined);
    assert.equal(q("SELECT COUNT(*) AS n FROM ops_log WHERE action='player_oauth_unlink'").get().n, 1);
  });

  for (const failure of ['audit', 'session']) test(`${provider} login can reuse its verified flow after a ${failure} save failure`, async t => {
    const { s, p, q, headers, flow, fail } = await fixture(t, provider);
    q('INSERT INTO oauth_identities(provider,subject,user_id,label,linked_at) VALUES(?,?,?,?,?)').run(provider, 'atomic-subject', p.me.id, 'Identity', Date.now());
    const f = await flow(false), before = q('SELECT * FROM oauth_flows WHERE id=?').get(f.id);
    const sessions = q('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(p.me.id).n;
    const logCount = () => q("SELECT COUNT(*) AS n FROM ops_log WHERE action='player_login' AND actor_id=?").get(p.me.id).n, logs = logCount();
    const repair = failure === 'audit' ? fail('ops_log', "NEW.action='player_login'") : fail('sessions');
    const poll = () => s.call('POST', '/api/oauth/poll', { headers, body: { flow: f.secret } });
    assert.equal((await poll()).status, 500);
    assert.deepEqual(q('SELECT * FROM oauth_flows WHERE id=?').get(f.id), before);
    assert.equal(q('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(p.me.id).n, sessions); assert.equal(logCount(), logs);
    repair(); const r = await poll(); assert.equal(r.status, 200); assert.equal(r.step, 'login'); assert.equal(r.me.id, p.me.id);
    assert.equal((await s.call('GET', '/api/me', { token: r.token })).status, 200);
    assert.equal((await poll()).status, 404); assert.equal(logCount(), logs + 1);
    assert.equal(q('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(p.me.id).n, sessions + 1);
  });
}
