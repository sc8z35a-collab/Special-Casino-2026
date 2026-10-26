// The API over a live connection (server/core/socketapi.js; Cloudflare's WebSocket carries it, server/cloudflare/casino.js): a request on the
// connection is answered by the same api.handle() as over HTTP, with the same login, refusals and limits, and what is kept for HTTP is
// answered "over HTTP" without being done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { answerOnSocket, overSocket } from '../core/socketapi.js';

const CONN = { ip: '203.0.113.7', host: 'casino.test', scheme: 'https:', ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', origin: 'https://casino.test', lang: 'ja' };
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
    assert.equal(after.tokens, before.tokens - 200 + r.b.result.total + http.result.total + (r.b.result.charm ? r.b.result.charm.back : 0) + (http.result.charm ? http.result.charm.back : 0));
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

test('what is kept for HTTP is answered "over HTTP" and not done: the chat routes (the filter reads them first), the logins, the vault\'s writes', async () => {
  const s = await startServer();
  try {
    const a = await s.register('Alice');
    const b = await s.register('Bob');
    await s.befriend(a, b);
    const n = () => s.app.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND recipient_id = ?').get(a.me.id, b.me.id).n;
    const had = n();
    const r = await ask(s, { m: 'POST', p: '/api/messages', h: bearer(a), b: { to: b.me.id, text: 'やあ' } });
    assert.deepEqual([r.s, n()], [0, had], 'a chat message is not sent on the connection');
    for (const [m, p] of [['POST', '/api/login'], ['POST', '/api/register'], ['POST', '/api/logout'], ['POST', '/api/ops/login'], ['POST', '/api/vault/upload'], ['GET', '/api/vault/piece'], ['GET', '/api/ops/ext/x.js'], ['POST', '/api/stream-ticket'], ['POST', '/api/report'], ['PUT', '/api/me'], ['DELETE', '/api/me'], ['GET', '/elsewhere'], ['GET', 'https://evil.test/api/me']]) {
      assert.equal((await ask(s, { m, p, h: bearer(a), b: {} })).s, 0, `${m} ${p}`);
      assert.equal(overSocket(m, p.split('?')[0]), false, `${m} ${p}`);
    }
    assert.equal((await s.call('POST', '/api/logout', { token: a.token, body: {} })).status, 200, 'the logout above was not done');
    for (const [m, p] of [['POST', '/api/spin'], ['POST', '/api/read'], ['GET', '/api/quests'], ['GET', '/api/ops/tick'], ['GET', '/api/vault/spaces'], ['POST', '/api/ops/cdw']]) assert.equal(overSocket(m, p), true, `${m} ${p}`);
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
