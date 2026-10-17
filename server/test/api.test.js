// API tests: node --test server/test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../server.js';
import { evaluate, RULES } from '../rules.js';

let app, base, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-test-'));
  app = createApp({
    dataDir, logRequests: false, registrationsPerIp: 0, registerPerMinute: 100000,
    limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000] }
  });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token, body, ip } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json();
  return { status: res.status, ...json };
}

let seq = 0;
async function register(name) {
  const r = await call('POST', '/api/register', { body: { name: name || `ユーザー${++seq}` } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r;
}

function setUser(id, fields) {
  const cols = Object.keys(fields);
  app.db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
}

test('health is public', async () => {
  const r = await call('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
});

test('registration validates names', async () => {
  for (const [name, code] of [['a', 'name_length'], ['あいうえおかきくけこさしす', 'name_length'], ['bad name', 'name_chars'],
    ['<script>', 'name_chars'], ['😀😀', 'name_chars'], ['___', 'name_chars'], ['Admin', 'name_reserved'], ['運営さん', 'name_reserved']]) {
    const r = await call('POST', '/api/register', { body: { name } });
    assert.equal(r.status, 400, name);
    assert.equal(r.error.code, code, name);
  }
  const ok = await register('Taro_01');
  assert.match(ok.recoveryCode, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  assert.equal(ok.me.name, 'Taro_01');
  assert.equal(ok.me.tokens, RULES.start.tokens);
  assert.equal(ok.me.dollars, RULES.start.dollars);
  const dup = await call('POST', '/api/register', { body: { name: 'taro_01' } });
  assert.equal(dup.status, 409);
  // full-width letters are normalised (NFKC) before the uniqueness check
  const dup2 = await call('POST', '/api/register', { body: { name: 'ＴＡＲＯ＿０１' } });
  assert.equal(dup2.status, 409);
});

test('auth: token required, recovery code logs in on another device', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', { token: 'x'.repeat(43) })).status, 401);
  const u = await register();
  const me = await call('GET', '/api/me', { token: u.token });
  assert.equal(me.status, 200);
  assert.equal(me.me.id, u.me.id);
  const messy = u.recoveryCode.toLowerCase().replace(/-/g, ' ');
  const login = await call('POST', '/api/login', { body: { code: messy } });
  assert.equal(login.status, 200);
  assert.notEqual(login.token, u.token);
  assert.equal((await call('GET', '/api/me', { token: login.token })).me.id, u.me.id);
  assert.equal((await call('POST', '/api/login', { body: { code: '0000-0000-0000-0000' } })).status, 404);
  // a new recovery code replaces the old one
  const rc = await call('POST', '/api/recovery', { token: u.token });
  assert.equal((await call('POST', '/api/login', { body: { code: u.recoveryCode } })).status, 404);
  assert.equal((await call('POST', '/api/login', { body: { code: rc.recoveryCode } })).status, 200);
  // logout invalidates only that session
  assert.equal((await call('POST', '/api/logout', { token: login.token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token: login.token })).status, 401);
  assert.equal((await call('GET', '/api/me', { token: u.token })).status, 200);
});

test('shop: buy, sell, limits and the daily gift', async () => {
  const u = await register();
  const price = RULES.tokenPrice;
  let r = await call('POST', '/api/buy', { token: u.token, body: { amount: 1000 } });
  assert.equal(r.status, 200);
  assert.equal(r.me.tokens, u.me.tokens + 1000);
  assert.equal(r.me.dollars, u.me.dollars - 1000 * price);
  assert.equal(r.me.boughtToday, 1000);
  assert.ok(r.me.rev > u.me.rev);
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: Math.floor(r.me.dollars / price) + 1 } })).status, 409);
  for (const bad of [0, -5, 1.5, '10', 'abc', null]) {
    const res = await call('POST', '/api/buy', { token: u.token, body: { amount: bad } });
    assert.equal(res.status, bad === '10' ? 200 : 400, String(bad));
  }
  // daily purchase limit
  setUser(u.me.id, { dollars: 10 ** 12 });
  const today = (await call('GET', '/api/me', { token: u.token })).me;
  const left = RULES.dailyLimit - today.boughtToday;
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: left + 1 } })).status, 409);
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: left } })).status, 200);
  assert.equal((await call('POST', '/api/buy', { token: u.token, body: { amount: 1 } })).status, 409);
  // sell
  const before = (await call('GET', '/api/me', { token: u.token })).me;
  assert.equal((await call('POST', '/api/sell', { token: u.token, body: { amount: before.tokens + 1 } })).status, 409);
  r = await call('POST', '/api/sell', { token: u.token, body: { amount: 500 } });
  assert.equal(r.me.tokens, before.tokens - 500);
  assert.equal(r.me.dollars, before.dollars + 500 * price);
  // daily gift once per UTC day
  r = await call('POST', '/api/daily', { token: u.token });
  assert.equal(r.status, 200);
  assert.equal(r.me.tokens, before.tokens - 500 + RULES.dailyFree);
  assert.equal(r.me.dailyReady, false);
  assert.equal((await call('POST', '/api/daily', { token: u.token })).status, 409);
});

test('spins are settled on the server and add up', async () => {
  const u = await register();
  assert.equal((await call('POST', '/api/spin', { token: u.token, body: { bet: 100 } })).status, 409, 'no tokens yet');
  assert.equal((await call('POST', '/api/spin', { token: u.token, body: { bet: 150 } })).status, 400, 'bet not on the ladder');
  setUser(u.me.id, { tokens: 1000000 });
  let tokens = 1000000, won = 0, biggest = 0, rev = 0;
  for (let i = 0; i < 150; i++) {
    const bet = RULES.bets[i % 4];
    const r = await call('POST', '/api/spin', { token: u.token, body: { bet } });
    assert.equal(r.status, 200, JSON.stringify(r));
    const res = r.result;
    assert.equal(res.grid.length, 5);
    res.grid.forEach((col, k) => { assert.equal(col.length, 3); assert.equal(col[1], res.line[k]); });
    const check = evaluate(res.line, bet);
    assert.equal(res.total, check.total);
    assert.equal(res.tier, check.tier);
    tokens = tokens - bet + res.total;
    won += res.total;
    biggest = Math.max(biggest, res.total);
    assert.equal(r.balance.tokens, tokens);
    assert.ok(r.balance.rev > rev);
    rev = r.balance.rev;
  }
  const me = (await call('GET', '/api/me', { token: u.token })).me;
  assert.equal(me.tokens, tokens);
  assert.equal(me.totalWon, won);
  assert.equal(me.biggestWin, biggest);
  assert.equal(me.spins, 150);
  assert.equal(me.dayWon, won);
});

test('leaderboard orders by winnings and reports my rank', async () => {
  const a = await register('ボードA');
  const b = await register('ボードB');
  setUser(a.me.id, { total_won: 9000000000, biggest_win: 5, won_day: '', day_won: 0 });
  setUser(b.me.id, { total_won: 8000000000, biggest_win: 7000000000 });
  const total = await call('GET', '/api/board?type=total', { token: b.token });
  assert.equal(total.rows[0].id, a.me.id);
  assert.equal(total.rows[1].id, b.me.id);
  assert.deepEqual(total.me, { rank: 2, value: 8000000000 });
  const big = await call('GET', '/api/board?type=biggest', { token: a.token });
  assert.equal(big.rows[0].id, b.me.id);
  const today = await call('GET', '/api/board?type=today', { token: a.token });
  assert.equal(today.me.rank, null);
  assert.equal((await call('GET', '/api/board?type=nope', { token: a.token })).status, 400);
  const prof = await call('GET', `/api/user?id=${b.me.id}`, { token: a.token });
  assert.equal(prof.user.name, 'ボードB');
  assert.equal(prof.user.rank, 2);
  assert.equal(prof.self, false);
});

test('direct messages, unread counts and blocking', async () => {
  const a = await register();
  const b = await register();
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: a.me.id, text: 'hi' } })).status, 400);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: 999999, text: 'hi' } })).status, 404);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: '   ' } })).status, 400);
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'あ'.repeat(301) } })).status, 400);
  const xss = '<img src=x onerror=alert(1)>‮こんにちは\u0007';
  const sent = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: xss } });
  assert.equal(sent.status, 200);
  assert.equal(sent.message.text, '<img src=x onerror=alert(1)>こんにちは', 'stored as plain text, controls stripped');
  let conv = await call('GET', '/api/conversations', { token: b.token });
  assert.equal(conv.unread, 1);
  assert.equal(conv.conversations[0].user.id, a.me.id);
  assert.equal(conv.conversations[0].last.mine, false);
  await call('POST', '/api/messages', { token: b.token, body: { to: a.me.id, text: 'やあ' } });
  const thread = await call('GET', `/api/messages?with=${a.me.id}`, { token: b.token });
  assert.deepEqual(thread.messages.map((m) => m.from.id), [a.me.id, b.me.id]);
  assert.equal((await call('POST', '/api/read', { token: b.token, body: { with: a.me.id } })).unread, 0);
  // B blocks A: A can no longer message or pay B
  await call('POST', '/api/block', { token: b.token, body: { user: a.me.id, blocked: true } });
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'まだ？' } })).status, 403);
  setUser(a.me.id, { tokens: 1000 });
  assert.equal((await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 10, currency: 'tokens' } })).status, 403);
  assert.equal((await call('GET', `/api/user?id=${a.me.id}`, { token: b.token })).blocked, true);
  await call('POST', '/api/block', { token: b.token, body: { user: a.me.id, blocked: false } });
  assert.equal((await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'ok?' } })).status, 200);
});

test('lobby chat and its rate limit', async () => {
  const a = await register();
  const r = await call('POST', '/api/messages', { token: a.token, body: { to: 'lobby', text: 'みなさんこんにちは' } });
  assert.equal(r.status, 200);
  const list = await call('GET', '/api/messages', { token: a.token });
  assert.equal(list.channel, 'lobby');
  assert.ok(list.messages.some((m) => m.id === r.message.id));
  let limited = false;
  for (let i = 0; i < 8; i++) {
    const x = await call('POST', '/api/messages', { token: a.token, body: { to: 'lobby', text: `連投${i}` } });
    if (x.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'lobby flood is rate limited');
});

test('transfers move money atomically and land in the chat', async () => {
  const a = await register();
  const b = await register();
  setUser(a.me.id, { tokens: 5000, dollars: 100 });
  const bad = [
    [{ to: a.me.id, amount: 1, currency: 'tokens' }, 400],
    [{ to: b.me.id, amount: 1, currency: 'coins' }, 400],
    [{ to: b.me.id, amount: 0, currency: 'tokens' }, 400],
    [{ to: b.me.id, amount: 5001, currency: 'tokens' }, 409],
    [{ to: b.me.id, amount: 101, currency: 'dollars' }, 409],
    [{ to: 424242, amount: 1, currency: 'tokens' }, 404]
  ];
  for (const [body, status] of bad) assert.equal((await call('POST', '/api/transfer', { token: a.token, body })).status, status, JSON.stringify(body));
  const bBefore = (await call('GET', '/api/me', { token: b.token })).me;
  const r = await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 1234, currency: 'tokens' } });
  assert.equal(r.status, 200);
  assert.equal(r.balance.tokens, 5000 - 1234);
  assert.equal(r.message.kind, 'transfer');
  assert.equal(r.message.amount, 1234);
  const bAfter = (await call('GET', '/api/me', { token: b.token })).me;
  assert.equal(bAfter.tokens, bBefore.tokens + 1234);
  assert.ok(bAfter.rev > bBefore.rev);
  // winnings are what the board counts, received money is not
  assert.equal(bAfter.totalWon, bBefore.totalWon);
  const conv = await call('GET', '/api/conversations', { token: b.token });
  assert.equal(conv.conversations[0].last.kind, 'transfer');
  const d = await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 100, currency: 'dollars' } });
  assert.equal(d.balance.dollars, 0);
});

test('banned players are locked out', async () => {
  const u = await register();
  setUser(u.me.id, { banned: 1 });
  assert.equal((await call('GET', '/api/me', { token: u.token })).status, 403);
  assert.equal((await call('POST', '/api/login', { body: { code: u.recoveryCode } })).status, 403);
});

// Reads server-sent events until `want` events of the given names arrived.
function openStream(ticket, onEvent) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/stream?ticket=${encodeURIComponent(ticket)}`, (res) => {
      if (res.statusCode !== 200) { reject(new Error('status ' + res.statusCode)); res.resume(); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block);
          const data = /^data: (.+)$/m.exec(block);
          if (ev && data) onEvent(ev[1], JSON.parse(data[1]));
        }
      });
      resolve(req);
    });
    req.on('error', reject);
  });
}

test('live stream: one-time tickets, messages and transfers are pushed', async () => {
  const a = await register();
  const b = await register();
  setUser(a.me.id, { tokens: 100 });
  const { ticket } = await call('POST', '/api/stream-ticket', { token: b.token });
  const events = [];
  let wake;
  const req = await openStream(ticket, (name, data) => { events.push([name, data]); if (wake) wake(); });
  const waitFor = (name) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + name)), 3000);
    const check = () => {
      const hit = events.find((e) => e[0] === name && !e.used);
      if (hit) { hit.used = true; clearTimeout(t); wake = null; resolve(hit[1]); } else wake = check;
    };
    check();
  });
  const hello = await waitFor('hello');
  assert.equal(hello.me.id, b.me.id);
  // tickets work once
  await assert.rejects(openStream(ticket, () => {}));
  await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'ライブ' } });
  const msg = await waitFor('msg');
  assert.equal(msg.text, 'ライブ');
  assert.equal(msg.unread, 1);
  await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 60, currency: 'tokens' } });
  const bal = await waitFor('balance');
  assert.equal(bal.tokens, RULES.start.tokens + 60);
  req.destroy();
});
