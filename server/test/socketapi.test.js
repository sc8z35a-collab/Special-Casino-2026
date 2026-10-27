// The API over a live connection (server/core/socketapi.js; Cloudflare's WebSocket carries it, server/cloudflare/casino.js): a request on the
// connection is answered by the same api.handle() as over HTTP, with the same login, refusals and limits, and what is kept for HTTP is
// answered "over HTTP" without being done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { answerOnSocket, overSocket } from '../core/socketapi.js';
import crypto from 'node:crypto';

const CONN = { ip: '203.0.113.7', host: 'casino.test', scheme: 'https:', ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', origin: 'https://casino.test', lang: 'ja', device: 'a'.repeat(32) };
let seq = 0;
// one message on the connection, its answer read back as the page reads it
async function ask(s, m, conn = CONN) {
  const text = await answerOnSocket(s.app.api, conn, { op: 'api', id: ++seq, ...m });
  if (text === null) return null;
  const r = JSON.parse(text);
  assert.equal(r.re, seq, 'the answer names its request');
  return r;
}
const bearer = (u) => ({ authorization: 'Bearer ' + u.token });

test('gacha uses the optimized connection: 3/9/30 slots settle once at the quoted price, with the same HTTP balance', async () => {
  const s = await startServer();
  try {
    const a = await s.register('GachaSocket');
    s.setUser(a.me.id, { dollars: 2000000000, garage_extra: 100 });
    assert.equal((await ask(s, { m: 'POST', p: '/api/gacha/spin', b: { kind: 'rare', count: 1 } })).s, 401);
    const state = await ask(s, { m: 'GET', p: '/api/gacha', h: bearer(a) });
    assert.equal(state.s, 200);
    const http = await s.call('GET', '/api/gacha', { token: a.token });
    assert.deepEqual(state.b.prices, http.prices);
    let money = 2000000000;
    for (const [kind, count, priceKey] of [['rare', 1, 'single'], ['legendary', 3, 'three'], ['secret', 10, 'ten']]) {
      const price = state.b.prices[kind][priceKey];
      const wrong = await ask(s, { m: 'POST', p: '/api/gacha/spin', h: bearer(a), b: { kind, count, price: price - 1 } });
      assert.equal(wrong.s, 409); assert.equal(wrong.b.error.code, 'price_changed');
      assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(a.me.id).dollars, money);
      const r = await ask(s, { m: 'POST', p: '/api/gacha/spin', h: bearer(a), b: { kind, count, price } });
      assert.equal(r.s, 200, JSON.stringify(r.b));
      assert.equal(r.b.pulls.flatMap((p) => p.rewards).length, count * 3);
      money -= price;
      assert.equal(r.b.me.dollars, money);
      assert.equal((await s.call('GET', '/api/me', { token: a.token })).me.dollars, money);
    }
  } finally { await s.stop(); }
});

test('LINE gifts stay on HTTP: a socket fallback cannot claim; repeated HTTP claims pay once per account', async () => {
  const s = await startServer();
  try {
    const a = await s.register('LineGift');
    const token = crypto.randomBytes(24).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    s.app.db.prepare('INSERT INTO line_feed_rewards (token_hash, week, kind, amount, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(hash, Date.now(), 'casino', 20000, Date.now() + 86400000);
    for (const p of ['/api/line/reward', '/api/line/reward/claim']) {
      const r = await ask(s, { m: 'POST', p, h: bearer(a), b: { token } });
      assert.equal(r.s, 0);
    }
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM line_feed_claims').get().n, 0);
    assert.equal((await s.call('POST', '/api/line/reward', { body: { token } })).status, 401);
    const preview = await s.call('POST', '/api/line/reward', { token: a.token, body: { token } });
    assert.equal(preview.claimed, false);
    const first = await s.call('POST', '/api/line/reward/claim', { token: a.token, body: { token } });
    const again = await s.call('POST', '/api/line/reward/claim', { token: a.token, body: { token } });
    assert.equal(first.received, true); assert.equal(again.received, false);
    assert.equal(first.me.tokens, a.me.tokens + 20000); assert.equal(again.me.tokens, first.me.tokens);
  } finally { await s.stop(); }
});

test('a spin on the connection is a spin: the same answer as over HTTP, the same balance after', async () => {
  const s = await startServer();
  try {
    const a = await s.register('Alice');
    s.setUser(a.me.id, { tokens: 1e6 });
    const before = (await s.call('GET', '/api/me', { token: a.token })).me;
    const r = await ask(s, { m: 'POST', p: '/api/spin', h: bearer(a), b: { bet: 100 } });
    assert.equal(r.s, 200);
    const http = await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } });
    assert.deepEqual(Object.keys(r.b).sort(), Object.keys(http).filter((k) => k !== 'status').sort(), 'the same answer');
    const after = (await s.call('GET', '/api/me', { token: a.token })).me;
    // (as the game makes it whole: what is none is not sent)
    const mine = globalThis.BR.engine.whole(r.b.result);
    assert.equal(after.tokens, before.tokens - 200 + mine.total + http.result.total + (mine.charm ? mine.charm.back : 0) + (http.result.charm ? http.result.charm.back : 0));
    // a look, with its query
    const u = await ask(s, { m: 'GET', p: '/api/user?id=' + a.me.id, h: bearer(a) });
    assert.deepEqual([u.s, u.b.user.name], [200, 'Alice']);
  } finally { await s.stop(); }
});

test('the login is checked on every message as on every request: none, a wrong one, one that was ended', async () => {
  const s = await startServer();
  try {
    const a = await s.register('Alice');
    assert.deepEqual([(await ask(s, { m: 'GET', p: '/api/me' })).s, (await s.call('GET', '/api/me')).status], [401, 401]);
    assert.equal((await ask(s, { m: 'GET', p: '/api/me', h: { authorization: 'Bearer ' + 'x'.repeat(43) } })).s, 401);
    assert.equal((await ask(s, { m: 'GET', p: '/api/me', h: bearer(a) })).s, 200);
    await s.call('POST', '/api/logout', { token: a.token, body: {} });
    const gone = await ask(s, { m: 'GET', p: '/api/me', h: bearer(a) });
    assert.equal(gone.s, 401, 'a logged-out login is refused on the connection at once');
  } finally { await s.stop(); }
});

test('chat is delivered on the connection while logins and vault writes still return an HTTP fallback without side effects', async () => {
  const s = await startServer();
  try {
    const a = await s.register('Alice');
    const b = await s.register('Bob');
    await s.befriend(a, b);
    const n = () => s.app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND recipient_id = ?').get(a.me.id, b.me.id).n;
    const had = n();
    const r = await ask(s, { m: 'POST', p: '/api/messages', h: bearer(a), b: { to: b.me.id, text: 'やあ' } });
    assert.deepEqual([r.s, n(), r.b.message.text], [200, had + 1, 'やあ'], 'one message is delivered on the connection');
    for (const [m, p] of [['POST', '/api/login'], ['POST', '/api/register'], ['POST', '/api/logout'], ['POST', '/api/ops/login'], ['POST', '/api/vault/upload'], ['GET', '/api/vault/piece'], ['GET', '/api/ops/ext/x.js'], ['POST', '/api/stream-ticket'], ['PUT', '/api/me'], ['DELETE', '/api/me'], ['GET', '/elsewhere'], ['GET', 'https://evil.test/api/me']]) {
      assert.equal((await ask(s, { m, p, h: bearer(a), b: {} })).s, 0, `${m} ${p}`);
      assert.equal(overSocket(m, p.split('?')[0]), false, `${m} ${p}`);
    }
    assert.equal((await s.call('POST', '/api/logout', { token: a.token, body: {} })).status, 200, 'the logout above was not done');
    for (const [m, p] of [['POST', '/api/spin'], ['POST', '/api/read'], ['POST', '/api/report'], ['GET', '/api/quests'], ['GET', '/api/ops/tick'], ['GET', '/api/vault/spaces'], ['POST', '/api/ops/cdw']]) assert.equal(overSocket(m, p), true, `${m} ${p}`);
  } finally { await s.stop(); }
});

test('a body is what HTTP would take: an object, within the route\'s limit; a message that is not a request gets no answer', async () => {
  const s = await startServer();
  try {
    const a = await s.register('Alice');
    for (const b of [[1, 2], 'text', 7]) assert.equal((await ask(s, { m: 'POST', p: '/api/spin', h: bearer(a), b })).s, 400);
    assert.equal((await ask(s, { m: 'POST', p: '/api/spin', h: bearer(a), b: { bet: 100, pad: 'x'.repeat(17000) } })).s, 413);
    for (const id of [-1, 1.5, 'x', null, undefined]) assert.equal(await answerOnSocket(s.app.api, CONN, { op: 'api', id, m: 'GET', p: '/api/me', h: bearer(a) }), null);
  } finally { await s.stop(); }
});

test('the same refusals and limits: the rate limit (one count for both ways), the shield (the browser the connection came from), an operator\'s route', async () => {
  const s = await startServer({ operators: ['taku', 'mod'], limits: { spin: [1, 2], general: [100000, 1000], login: [100000, 1000] } });
  try {
    const a = await s.register('Alice');
    s.setUser(a.me.id, { tokens: 1e6 });
    // the rate limit of spins is the HTTP one
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await ask(s, { m: 'POST', p: '/api/spin', h: bearer(a), b: { bet: 100 } })).s);
    assert.deepEqual(statuses, [200, 200, 429, 429]);
    assert.equal((await s.call('POST', '/api/spin', { token: a.token, body: { bet: 100 } })).status, 429, 'one count for both ways');
    // a scanner's browser
    assert.equal((await ask(s, { m: 'GET', p: '/api/me', h: bearer(a) }, { ...CONN, ip: '198.51.100.9', ua: 'sqlmap/1.7' })).s, 403);
    // an attack in the query
    assert.equal((await ask(s, { m: 'GET', p: "/api/user?id=1' union select password from users--", h: bearer(a) }, { ...CONN, ip: '198.51.100.10' })).s, 403);
    // an operator's request without the operator's rights
    assert.equal((await ask(s, { m: 'GET', p: '/api/ops/tick', h: bearer(a) })).s, 403);
  } finally { await s.stop(); }
});

test('an operator\'s request on the connection is answered as over HTTP (and counted as one in the server\'s figures)', async () => {
  const s = await startServer({ operators: ['taku', 'mod'] });
  try {
    await s.register('taku');
    const mod = await s.register('mod');
    const before = (await s.call('GET', '/api/ops/server?lean=1', { token: mod.token })).today.requests;
    const r = await ask(s, { m: 'GET', p: '/api/ops/tick?c=&d=&t=', h: bearer(mod) });
    assert.equal(r.s, 200);
    assert.ok(r.b.counts && r.b.devunit && r.b.team);
    const http = await s.call('GET', '/api/ops/tick?c=&d=&t=', { token: mod.token });
    assert.deepEqual(Object.keys(r.b).sort(), Object.keys(http).filter((k) => k !== 'status').sort());
    const after = (await s.call('GET', '/api/ops/server?lean=1', { token: mod.token })).today.requests;
    assert.ok(after - before >= 3, 'the request on the connection is a request in the figures');
  } finally { await s.stop(); }
});

test('what a request on the connection does not carry is the connection\'s: the address, the browser, the device; the page\'s own headers are its', async () => {
  let seen = null;
  const api = { handle: async (req) => { seen = req; return { status: 200, body: { ok: true } }; }, sent() {} };
  const r = JSON.parse(await answerOnSocket(api, CONN, { op: 'api', id: 1, m: 'GET', p: '/api/me?x=1', h: { authorization: 'Bearer t', cookie: 'no' } }));
  assert.deepEqual([r.s, r.b], [200, { ok: true }]);
  assert.deepEqual([seen.ip, seen.header('user-agent'), seen.header('x-device'), seen.header('authorization'), seen.query.get('x')], [CONN.ip, CONN.ua, CONN.device, 'Bearer t', '1']);
  assert.equal(seen.header('cookie'), null, 'nothing else the page put in');
  await answerOnSocket(api, CONN, { op: 'api', id: 2, m: 'GET', p: '/api/me', h: { 'x-device': 'b'.repeat(32) } });
  assert.equal(seen.header('x-device'), 'b'.repeat(32), 'one the page sends is its');
});

test('chat on the connection rejects the same non-text payloads as HTTP, records only metadata and stops further chat', async () => {
  const s = await startServer();
  try {
    const b = await s.register('Recipient');
    const bad = [
      { text: 'words', file: 'not allowed' },
      { text: 'data:application/octet-stream;base64,' + 'AbCd0123456789'.repeat(20) },
      { text: '\u0000private-file' },
      { text: { attachment: true } }
    ];
    for (let i = 0; i < bad.length; i++) {
      const socket = await s.register('Socket' + i), http = await s.register('Http' + i);
      await s.befriend(socket, b); await s.befriend(http, b);
      const body = { to: b.me.id, ...bad[i] };
      const r = await ask(s, { m: 'POST', p: '/api/messages', h: bearer(socket), b: body });
      const h = await s.call('POST', '/api/messages', { token: http.token, body });
      assert.equal(r.s, 400); assert.equal(h.status, 400); assert.deepEqual(r.b.error, h.error);
      if (r.b.error.warning) {
        assert.equal(r.b.error.stage, 1);
        assert.equal(s.app.db.prepare('SELECT chat_ban FROM users WHERE id = ?').get(socket.me.id).chat_ban, 0);
        for (const stage of [2, 3]) {
          const again = await ask(s, { m: 'POST', p: '/api/messages', h: bearer(socket), b: body });
          const againHttp = await s.call('POST', '/api/messages', { token: http.token, body });
          assert.deepEqual(again.b.error, againHttp.error);
          if (stage === 2) assert.equal(again.b.error.stage, 2);
        }
      }
      assert.ok(s.app.db.prepare('SELECT chat_ban FROM users WHERE id = ?').get(socket.me.id).chat_ban > 0);
      assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND recipient_id = ?').get(socket.me.id, b.me.id).n, 0);
      const stopped = await ask(s, { m: 'POST', p: '/api/messages', h: bearer(socket), b: { to: b.me.id, text: 'ordinary text' } });
      assert.equal(stopped.s, 403); assert.equal(stopped.b.error.code, 'chat_banned');
      const log = s.app.db.prepare("SELECT detail FROM ops_log WHERE action = 'filter_block' AND actor_id = ? ORDER BY id DESC LIMIT 1").get(socket.me.id);
      assert.ok(log); assert.ok(!log.detail.includes('private-file')); assert.ok(!log.detail.includes('AbCd0123456789'));
    }
  } finally { await s.stop(); }
});

test('chat keeps authentication and friendship checks, and oversized UTF-8 messages fall back without sending or banning', async () => {
  const s = await startServer();
  try {
    const a = await s.register('Sender'), b = await s.register('Receiver');
    assert.equal((await ask(s, { m: 'POST', p: '/api/messages', b: { to: b.me.id, text: 'hello' } })).s, 401);
    const stranger = await ask(s, { m: 'POST', p: '/api/messages', h: bearer(a), b: { to: b.me.id, text: 'hello' } });
    assert.equal(stranger.s, 403);
    await s.befriend(a, b);
    const large = await ask(s, { m: 'POST', p: '/api/messages', h: bearer(a), b: { to: b.me.id, text: 'あ'.repeat(6000) } });
    assert.equal(large.s, 0);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND recipient_id = ?').get(a.me.id, b.me.id).n, 0);
    assert.equal(s.app.db.prepare('SELECT chat_ban FROM users WHERE id = ?').get(a.me.id).chat_ban, 0);
    assert.equal((await ask(s, { m: 'POST', p: '/api/messages', h: bearer(a), b: { to: b.me.id, text: '正しいメッセージ' } })).s, 200);
  } finally { await s.stop(); }
});

test('the browser wire permits every filtered chat route and keeps vault writes and authentication on HTTP', async () => {
  const vm = await import('node:vm'), fs = await import('node:fs');
  const { CHAT_ROUTES } = await import('../core/attach.js');
  const context = { window: {}, setTimeout, clearTimeout };
  for (const file of ['transport-policy.js', 'wire.js']) vm.runInNewContext(fs.readFileSync(new URL('../../js/net/' + file, import.meta.url), 'utf8'), context);
  const sent = [], wire = context.window.BR.wire((text) => { sent.push(JSON.parse(text)); return true; });
  for (const route of Object.keys(CHAT_ROUTES)) {
    const [method, path] = route.split(' '), pending = wire.call(method, path, {}, { text: 'words' });
    assert.ok(pending && typeof pending.then === 'function', route);
    wire.reply({ re: sent.at(-1).id, s: 200, b: { ok: true } }); assert.equal((await pending).status, 200);
  }
  for (const path of ['/api/login', '/api/line/claim', '/api/vault/upload']) assert.equal(wire.call('POST', path, {}, {}), null);
});
