// The security HOME and its secure channel (server/core/sec.js, server/core/seccomm.js, js/net/secchannel.js): everything the base
// says goes through a sealed channel the server insists on; the server proves who it is; and who may see which panel is the server's
// to say — the developer's panels answer no one else, whatever the page shows. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';
import { secureClient, memoryPins, SC } from './secure.js';
import { PANELS, SEC_KEYS } from '../core/sec.js';

const CODE = '987654321098';
const LIMITS = { general: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000], login: [100000, 1000] };

async function people(t, extra = {}) {
  const s = await startServer({ operators: ['taku', 'mod'], limits: LIMITS, ...extra });
  t.after(() => s.stop());
  const dev = await s.register('taku'), mod = await s.register('mod'), look = await s.register('looker'), plain = await s.register('plainone');
  assert.equal((await s.call('POST', '/api/ops/dev-code', { token: dev.token, body: { code: CODE } })).status, 200);
  assert.equal((await s.call('POST', '/api/ops/viewer', { token: dev.token, body: { name: 'looker', action: 'grant', code: CODE } })).status, 200);
  const sealed = (who) => secureClient(s, who.token, { uid: who.me ? who.me.id : 0 });
  return { s, dev, mod, look, plain, D: sealed(dev), M: { ...sealed(mod), token: mod.token }, V: sealed(look), P: sealed(plain) };
}
const ids = (r) => r.panels.map((p) => p.id);

test('nothing on the base answers a request that did not come through a channel; a channel works for the login that opened it', async (t) => {
  const { s, dev, mod, D, M } = await people(t);
  // plain: refused before the route runs (and the same for a read as for a write)
  for (const [m, p, b] of [['GET', '/api/sec/me'], ['GET', '/api/sec/status'], ['GET', '/api/sec/log'], ['POST', '/api/sec/lockdown', { reason: 'x' }], ['GET', '/api/sec/messages']]) {
    const r = await s.call(m, p, { token: dev.token, body: b });
    assert.deepEqual([r.status, r.error.code], [403, 'channel_required'], `${m} ${p}`);
  }
  const me = await D.call('GET', '/api/sec/me');
  assert.equal(me.status, 200);
  assert.deepEqual([me.name, me.role, me.developer], ['taku', 'developer', true]);
  // a sealed answer is not readable by anyone on the way: what travels is only the sealed text
  const raw = await s.call('GET', '/api/sec/me', { token: dev.token, headers: { 'X-Sec-Channel': 'nope', 'X-Sec-Seq': '1', 'X-Sec-Tag': 'x' } });
  assert.equal(raw.error.code, 'channel_lost');
  // another login cannot use this channel (its id and keys are of the first)
  const id = D.chan.info();
  assert.ok(id.fp && /^[0-9a-f]{4}(-[0-9a-f]{4}){4}$/.test(id.fp));
  let headers = null;
  const real = secureClient(s, dev.token).request;
  const spy = SC.create({ request: async (m, p, b, h) => { headers = h; return real(m, p, b, h); }, pins: memoryPins(), env: { protocol: 'http:', host: new URL(s.base).host, origin: s.base, secureContext: true, framed: false } });
  await spy.call('GET', '/api/sec/me');
  const stolen = await s.call('GET', '/api/sec/me', { token: mod.token, headers: { ...headers, 'X-Sec-Seq': '50' } });
  assert.deepEqual([stolen.status, stolen.error.code], [403, 'channel_bad']);
  assert.equal((await M.call('GET', '/api/sec/status')).status, 200, "the operator's own channel is theirs");
});

test('a request that was repeated, touched or sent on another login is turned away and written to the log', async (t) => {
  const { s, dev, mod, D } = await people(t);
  assert.equal((await D.call('GET', '/api/sec/me')).status, 200);
  // a client that remembers the last sealed request it sent
  const env = { protocol: 'http:', host: new URL(s.base).host, origin: s.base, secureContext: true, framed: false };
  const remember = (who) => {
    const real = secureClient(s, who.token).request, mem = { last: null };
    return { mem, chan: SC.create({ request: async (m, p, b, h) => { mem.last = { m, p, b, h }; return real(m, p, b, h); }, pins: memoryPins(), env }) };
  };
  const { mem, chan: c2 } = remember(dev);
  assert.equal((await c2.call('GET', '/api/sec/me')).name, 'taku');
  const last = mem.last;
  const again = await s.call('GET', last.p, { token: dev.token, headers: last.h });
  assert.deepEqual([again.status, again.error.code], [403, 'channel_replay'], 'the same request twice');
  // a request whose path was changed (the tag no longer matches)
  const moved = await s.call('GET', '/api/sec/status', { token: dev.token, headers: { ...last.h, 'X-Sec-Seq': '9' } });
  assert.deepEqual([moved.status, moved.error.code], [403, 'channel_bad']);
  // another login with the first one's headers
  const other = await s.call('GET', last.p, { token: mod.token, headers: { ...last.h, 'X-Sec-Seq': '10' } });
  assert.deepEqual([other.status, other.error.code], [403, 'channel_bad']);
  const entries = s.app.db.prepare("SELECT summary, detail FROM ops_log WHERE action = 'sec_channel_denied'").all();
  assert.ok(entries.length >= 2, 'the refusals are in the log');
  const whys = entries.map((e) => JSON.parse(e.detail).why);
  assert.ok(whys.includes('repeat') && whys.includes('wrong-owner'), whys.join(','));
  // …and a body that was touched is not opened
  const w = remember(dev);
  await w.chan.call('POST', '/api/sec/messages', { text: 'こんにちは' });
  const sent = w.mem.last;
  const cut = { ...sent.b, c: sent.b.c.slice(0, -4) + 'AAAA' };
  const bad = await s.call('POST', '/api/sec/messages', { token: dev.token, body: cut, headers: { ...sent.h, 'X-Sec-Seq': '99' } });
  assert.equal(bad.status, 403);
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM sec_messages').get().n, 1, 'and nothing was written');
});

test('requests may overtake one another: parallel calls all arrive, each exactly once', async (t) => {
  const { D } = await people(t);
  const rs = await Promise.all(Array.from({ length: 24 }, (_, i) => D.call('GET', i % 3 ? '/api/sec/me' : '/api/sec/status')));
  assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.filter((r) => r.status !== 200)));
});

test('the server proves who it is: the signature, the address it saw, the identity kept, and a changed identity is refused', async (t) => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  t.after(() => s.stop());
  const dev = await s.register('taku');
  const url = new URL(s.base);
  const env = { protocol: 'http:', host: url.host, origin: s.base, secureContext: true, framed: false };
  const pins = memoryPins();
  const A = secureClient(s, dev.token, { pins });
  const first = await A.chan.open();
  assert.equal(first.pin, 'new');
  // over plain http the lock is not shown: the server saw no TLS, and the page is not https
  assert.equal(first.secure, false);
  assert.ok(first.problems.includes('protocol') && first.problems.includes('server-tls'));
  // …but in a page that is https behind a proxy that says so, with the same address, everything holds
  const B = secureClient(s, dev.token, { pins, env: { ...env, protocol: 'https:' }, extra: { 'X-Forwarded-Proto': 'https' } });
  const second = await B.chan.open();
  assert.equal(second.pin, 'same');
  assert.deepEqual(second.problems, []);
  assert.equal(second.secure, true);
  assert.equal(second.fp, first.fp);
  assert.equal((await B.call('GET', '/api/sec/me')).name, 'taku');
  // a copy of the page at another address: the server saw another host than the page believes it is at
  const C = secureClient(s, dev.token, { pins, env: { ...env, protocol: 'https:', host: 'copy.example', origin: 'https://copy.example' }, extra: { 'X-Forwarded-Proto': 'https' } });
  const third = await C.chan.open();
  assert.ok(third.problems.includes('host') && third.problems.includes('origin') && !third.secure);
  // a page framed by another site
  const F = secureClient(s, dev.token, { pins, env: { ...env, protocol: 'https:', framed: true }, extra: { 'X-Forwarded-Proto': 'https' } });
  assert.ok((await F.chan.open()).problems.includes('framed'));
  // a request that says it comes from another address than the one it is sent to is refused outright
  const lie = await s.call('POST', '/api/sec/channel', { token: dev.token, body: { pub: 'x', nonce: 'y' }, headers: { Origin: 'https://evil.example' } });
  assert.deepEqual([lie.status, lie.error.code], [403, 'bad_origin']);
  // something between the page and the server changed what was signed: the signature does not hold
  const T = secureClient(s, dev.token, { pins: memoryPins() });
  const real = T.request;
  const tampered = SC.create({ request: async (m, p, b, h) => { const r = await real(m, p, b, h); return p === '/api/sec/channel' ? { ...r, host: 'elsewhere' } : r; }, pins: memoryPins(), env });
  await assert.rejects(tampered.open(), (e) => e.code === 'bad_server');
  // the same server after a restart is the same identity; a different one is refused
  const firstFp = first.fp;
  const stored = s.app.db.prepare('SELECT pub FROM sec_identity').get();
  assert.ok(stored.pub);
  s.app.db.prepare('UPDATE sec_identity SET pub = ?').run(stored.pub);
  const U = secureClient(s, dev.token, { pins: { get: () => 'someone-else', set() {} } });
  await assert.rejects(U.chan.open(), (e) => e.code === 'identity_changed' && e.fp === firstFp);
});

test('the identity is kept in the database (its private half sealed) and is the same after a restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-sec-'));
  try {
    const s1 = await startServer({ operators: ['taku'], limits: LIMITS, dataDir });
    const dev1 = await s1.register('taku');
    const a = await secureClient(s1, dev1.token).chan.open();
    const row = s1.app.db.prepare('SELECT * FROM sec_identity').get();
    assert.ok(row && row.priv && !row.priv.includes('MIG'), 'the private half is not stored in the clear');
    await s1.stop();
    const s2 = await startServer({ operators: ['taku'], limits: LIMITS, dataDir });
    try {
      const login = await s2.call('POST', '/api/login', { body: { name: 'taku', password: 'pass1234' } });
      const pins = memoryPins();
      pins.set(row.pub);
      const b = await secureClient(s2, login.token, { pins }).chan.open();
      assert.equal(b.fp, a.fp, 'the same identity: the page that kept it still trusts it');
      assert.equal(b.pin, 'same');
    } finally { await s2.stop(); }
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('who sees which panel is the server\'s: each person is told only theirs, and a route that is not theirs says what a missing one says', async (t) => {
  const { s, plain, D, M, V, P } = await people(t);
  const dev = await D.call('GET', '/api/sec/me'), op = await M.call('GET', '/api/sec/me'), vw = await V.call('GET', '/api/sec/me');
  assert.deepEqual(ids(dev), PANELS.map((p) => p.id));
  assert.deepEqual(ids(op), PANELS.filter((p) => p.role !== 'developer').map((p) => p.id));
  assert.deepEqual(ids(vw), PANELS.filter((p) => p.role === 'viewer').map((p) => p.id));
  assert.ok(!JSON.stringify(vw).includes('chat') && !JSON.stringify(vw).includes('lockdown') && !JSON.stringify(vw).includes('dev-'), 'no word of a panel that is not theirs');
  assert.ok(!JSON.stringify(op).includes('dev-'), "no word of the developer's");
  // a plain player cannot even open a channel
  const pl = await s.call('POST', '/api/sec/channel', { token: (await s.register('someone')).token, body: { pub: 'x', nonce: 'y' } });
  assert.equal(pl.status, 403);
  assert.equal((await P.call('GET', '/api/sec/me')).status, 403);

  // the developer's panels: the developer's alone
  const missing = await s.call('GET', '/api/sec/dev/nothing-here', { token: (await s.register('x2')).token });
  for (const key of SEC_KEYS.developer) {
    const [method, path] = key.split(' ');
    for (const who of [M, V]) {
      const r = await who.call(method, path, method === 'POST' ? {} : undefined);
      assert.equal(r.status, 404, `${key}`);
      assert.equal(r.error.code, 'not_found');
      assert.equal(r.error.message, missing.error.message, 'the very words a route that is not there gives');
    }
    // a player (who cannot open a channel at all) is told the same no
    const pl2 = await s.call(method, path, { token: plain.token, body: method === 'POST' ? {} : undefined });
    assert.deepEqual([pl2.status, pl2.error.code, pl2.error.message], [404, 'not_found', missing.error.message], `${key} as a player`);
    // not even a word of the channel to a person who is not the developer: without one, the same no
    const bare = await s.call(method, path, { token: M.token, body: method === 'POST' ? {} : undefined });
    assert.equal(bare.status, 404, `${key} without a channel`);
    const r = await D.call(method, path, method === 'POST' ? (path.endsWith('/close') ? { id: 'zzzz' } : {}) : undefined);
    assert.equal(r.status, 200, `the developer: ${key} ${JSON.stringify(r).slice(0, 120)}`);
  }
  // the operators' routes are not a viewer's (a 閲覧者 is looking, nothing more)
  for (const key of SEC_KEYS.operator) {
    const [method, path] = key.split(' ');
    const r = await V.call(method, path, method === 'POST' ? { text: 'x', reason: 'x' } : undefined);
    assert.equal(r.status, 403, key);
    assert.equal((await P.call(method, path)).status, 403);
  }
  // …and the viewer's reads are bare: no request, no details
  const log = await V.call('GET', '/api/sec/log');
  assert.ok(log.entries.length && log.entries.every((e) => e.detail === undefined));
  assert.ok((await V.call('GET', '/api/sec/status')).security.every((e) => e.detail === undefined));
  // the developer sees all of an entry
  assert.ok((await D.call('GET', '/api/sec/log')).entries.some((e) => e.detail !== undefined));
  // a viewer whose rights were taken away is out at once
  assert.equal((await s.call('POST', '/api/ops/viewer', { token: (await s.call('POST', '/api/login', { body: { name: 'taku', password: 'pass1234' } })).token, body: { name: 'looker', action: 'revoke', code: CODE } })).status, 200);
  assert.equal((await V.call('GET', '/api/sec/status')).status, 403);
});

test("the developer sees every open channel (never its keys) and can end one; the person it was ended for opens another by themselves", async (t) => {
  const { D, M, s } = await people(t);
  await M.call('GET', '/api/sec/me');
  const list = await D.call('GET', '/api/sec/dev/channels');
  assert.equal(list.status, 200);
  assert.ok(list.channels.length >= 2 && list.identity.fp);
  assert.ok(!JSON.stringify(list).match(/kmac|kc2s|ks2c|spki.*priv|privateKey/));
  const mine = list.channels.find((c) => c.user.name === 'mod');
  assert.equal(mine.user.role, 'operator');
  const before = M.chan.info().at;
  const closed = await D.call('POST', '/api/sec/dev/channels/close', { id: mine.id });
  assert.equal(closed.closed, 1);
  await new Promise((r) => setTimeout(r, 5));
  const again = await M.call('GET', '/api/sec/me');
  assert.equal(again.status, 200, 'the page opened another channel by itself and asked again');
  assert.ok(M.chan.info().at >= before);
  assert.ok(s.app.db.prepare("SELECT 1 AS x FROM ops_log WHERE action = 'sec_channel_closed'").get());
});

test('the threats the log shows, the posture the server states, and the log through the channel', async (t) => {
  const { s, D, V } = await people(t);
  // a wrong password is a threat to the operator site
  for (let i = 0; i < 3; i++) await s.call('POST', '/api/ops/login', { body: { name: 'mod', password: 'wrong-' + i } });
  const th = await V.call('GET', '/api/sec/threats');
  assert.equal(th.status, 200);
  assert.ok(th.signals.find((x) => x.id === 'login').n24h >= 1, JSON.stringify(th.signals));
  assert.equal(th.hours.length, 24);
  assert.ok(['safe', 'watch', 'elevated', 'high'].includes(th.level));
  assert.ok(th.recent.every((e) => e.detail === undefined), "a viewer's lines are bare");
  const po = await D.call('GET', '/api/sec/posture');
  assert.equal(po.status, 200);
  assert.ok(po.items.find((x) => x.id === 'channel').ok);
  assert.equal(po.items.find((x) => x.id === 'tls').ok, false, 'a test server is not on TLS and says so');
  assert.equal(po.identity.fp, D.chan.info().fp, "the identity the page kept is the one the server states");
  const st = await D.call('GET', '/api/sec/status');
  assert.ok(st.server && st.server.live && st.level && st.site);
  assert.equal((await D.call('GET', '/api/sec/verify')).ok, true);
  // lists are lines only (a line's detail comes when it is opened), and what is new is asked for by number
  const slim = await D.call('GET', '/api/sec/log?slim=1');
  assert.ok(slim.entries.length > 3 && slim.entries.every((e) => e.detail === undefined && e.raw === undefined && e.hash === undefined), 'a slim list has the lines only');
  assert.ok(st.security.length && st.security.every((e) => e.detail === undefined && e.raw === undefined), 'the status carries lines only');
  const top = slim.entries[0].id;
  assert.deepEqual((await D.call('GET', `/api/sec/log?slim=1&since=${top}`)).entries, [], 'nothing is newer than the newest');
  await s.call('POST', '/api/ops/login', { body: { name: 'mod', password: 'wrong-again' } });
  assert.deepEqual((await D.call('GET', `/api/sec/log?slim=1&since=${top}`)).entries.map((e) => e.id), [top + 1], 'only the new line comes');
  const whole = await D.call('GET', `/api/sec/log/entries?ids=${top}`);
  assert.ok(whole.entries[0].detail && whole.entries[0].hash && whole.entries[0].detail.request, 'an operator opens a line to its whole');
  const whole2 = await V.call('GET', `/api/sec/log/entries?ids=${top}`);
  assert.equal(whole2.entries[0].id, top);
  assert.ok(whole2.entries[0].detail === undefined && whole2.entries[0].raw === undefined, "a viewer's whole line has no request and no detail");
  // the operators' channel: sealed in the database, plain only through the channel
  assert.equal((await D.call('POST', '/api/sec/messages', { text: '点検します' })).status, 200);
  assert.equal((await D.call('GET', '/api/sec/messages')).messages.at(-1).text, '点検します');
  assert.ok(!JSON.stringify(s.app.db.prepare('SELECT body FROM sec_messages').all()).includes('点検'));
});

test('the lockdown can be raised and lifted through the channel, and the base keeps working during it', async (t) => {
  const { s, mod, D, M } = await people(t);
  assert.equal((await M.call('POST', '/api/sec/lockdown', { reason: '点検' })).locked, true);
  // everything else is shut, the base is not: a new channel opens and answers
  const fresh = secureClient(s, mod.token);
  assert.equal((await fresh.chan.open()).pin, 'new');
  assert.equal((await fresh.call('GET', '/api/sec/status')).emergency.level, 'lockdown');
  assert.equal((await s.call('GET', '/api/ops/me', { token: mod.token })).status, 503, 'the operator site is shut');
  assert.equal((await D.call('GET', '/api/sec/status')).emergency.level, 'lockdown');
  assert.equal((await D.call('GET', '/api/sec/dev/channels')).status, 200);
  assert.equal((await M.call('POST', '/api/sec/release', {})).locked, false);
});
