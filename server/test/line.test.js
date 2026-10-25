// LINE (server/core/line.js): the same notices as Discord's, spent carefully
// against the month's allowance; and the bot that gives the staff today's
// passkey in a talk of its own, signed by LINE. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startServer, PASSWORD } from './helpers.js';
import { createLine } from '../core/line.js';
import { createNotifier, describe } from '../core/notify.js';
import { passkeyFor } from '../core/pk.js';
import { jstDay } from '../core/opsentry.js';
import { jst } from '../core/opslog.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const TOKEN = 'line-test-token-' + 'x'.repeat(40);
const STAFF = 'U' + 'a'.repeat(32), OTHER = 'U' + 'b'.repeat(32), GROUP = 'C' + 'c'.repeat(32);
const KEY = 'line-test-gate-key-0123456789abcdef0123';
const sign = (body, secret = SECRET) => crypto.createHmac('sha256', secret).update(body).digest('base64');

// LINE, as far as the bot uses it: it keeps what it is sent
async function fakeLine(answer = () => ({ status: 200, body: {} })) {
  const got = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const entry = { url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') };
      got.push(entry);
      const r = answer(entry);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { got, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  return fn();
};

function channel(extra = {}) {
  const sent = [], troubles = [];
  const store = new Map();
  let now = Date.UTC(2026, 9, 25, 3, 0, 0);
  const clock = { now: () => now, set: (t) => { now = t; }, add: (t) => { now += t; } };
  const line = createLine({
    token: TOKEN, to: [STAFF], limit: 10, jst, publicUrl: 'https://blockbuster-reels.example.workers.dev', clock: clock.now,
    kv: { get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), set: (k, v) => store.set(k, JSON.stringify(v)) },
    fetcher: async (url, init) => {
      const entry = { url, headers: init.headers, body: JSON.parse(init.body) };
      sent.push(entry);
      return (extra.answer ? extra.answer(entry) : { ok: true, status: 200, json: async () => ({}) });
    },
    onTrouble: (t) => troubles.push(t), ...extra.options
  });
  return { line, sent, troubles, store, clock };
}
const ok = { ok: true, status: 200, json: async () => ({}) };
const text = (entry) => entry.body.messages.map((m) => m.text).join('\n');

test('LINE notices: only the chosen entries, a danger at once with both links, the others wait and go together', async () => {
  const { line, sent, clock } = channel();
  assert.equal(line.on, true);
  assert.equal(createLine({ token: TOKEN, to: [], jst }).on, false, 'nobody to tell');
  assert.equal(createLine({ token: '', to: [STAFF], jst }).on, false, 'no token');
  assert.equal(createLine({ token: TOKEN, to: ['not-an-id'], jst }).on, false, 'only LINE IDs');
  // an entry that does not go out, one that does, a danger
  line.log({ action: 'open', summary: 'TAKUが運営サイトを開いた', at: clock.now() });
  line.log({ action: 'player_report', summary: '@everyone *さん*を通報', at: clock.now() });
  assert.equal(sent.length, 0, 'the others wait');
  line.log({ action: 'emergency_stop', summary: 'サーバーを緊急停止', detail: { usage: { over: [{ what: 'リクエスト', value: 50000, times: 20 }] } }, at: clock.now() });
  assert.equal(await line.flush(), true);
  assert.equal(sent.length, 1, 'one message: the danger with the one that waited');
  const msg = sent[0];
  assert.equal(msg.url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(msg.headers.Authorization, `Bearer ${TOKEN}`);
  assert.match(msg.headers['X-Line-Retry-Key'], /^[0-9a-f-]{36}$/);
  assert.equal(msg.body.to, STAFF);
  const t = text(msg);
  assert.match(t, /🚨 【危険】サーバーを緊急停止/);
  assert.match(t, /リクエスト：50,000／分（ふだんの20倍）/);
  assert.match(t, /🚩 @everyone \*さん\*を通報/, 'no escaping: LINE shows the text as it is');
  assert.doesNotMatch(t, /運営サイトを開いた/);
  line.host('blockbuster-reels.example.workers.dev');
  assert.match(t, /運営サイト https:\/\/blockbuster-reels\.example\.workers\.dev\/ops\//);
  assert.match(t, /セキュリティHOME https:\/\/blockbuster-reels\.example\.workers\.dev\/sec\//);
  assert.equal(line.status().used, 1);
  // the others alone: a few minutes, then the housekeeping sends them as one
  line.say('🛡️', 'ブロック 1');
  line.say('🛡️', 'ブロック 2');
  assert.equal(await line.tick(), null, 'not yet');
  clock.add(11 * 60000);
  assert.equal(await line.tick(), true);
  assert.equal(sent.length, 2);
  assert.match(text(sent[1]), /ブロック 1[\s\S]*ブロック 2/);
  assert.doesNotMatch(text(sent[1]), /セキュリティHOME/, 'a plain notice links the operator site only');
  assert.equal(line.status().used, 2);
});

test('LINE keeps to the month\'s allowance: the others only to 60%, a danger to the end, what was not sent is counted, said once on the other place', async () => {
  const { line, sent, troubles, clock } = channel();       // 10 a month
  for (let i = 0; i < 8; i++) { line.say('📝', `メモ${i}`); await line.flush(); }
  assert.equal(sent.length, 6, 'six of ten for the others');
  assert.equal(line.status().used, 6);
  assert.equal(troubles.length, 1);
  assert.match(troubles[0], /6割/);
  // a danger still goes, with how many were not sent
  line.danger('🚨', '攻撃を検知');
  assert.equal(await line.flush(), true);
  assert.match(text(sent.at(-1)), /ほかに2件。LINE の送信枠のため送っていません/);
  assert.equal(line.status().used, 7);
  for (let i = 0; i < 3; i++) { line.danger('🚨', `危険${i}`); await line.flush(); }
  assert.equal(line.status().used, 10);
  line.danger('🚨', '十一通目');
  assert.equal(await line.flush(), false);
  assert.equal(sent.length, 10);
  assert.equal(troubles.length, 2);
  assert.match(troubles[1], /使い切りました/);
  line.danger('🚨', 'もう一度');
  await line.flush();
  assert.equal(troubles.length, 2, 'said once a month');
  // a new month: it starts again
  clock.set(Date.UTC(2026, 10, 1, 3, 0, 0));
  assert.equal(line.status().used, 0);
  line.danger('🚨', '十一月');
  assert.equal(await line.flush(), true);
  assert.equal(line.status().month, '2026-11');
});

test('LINE: what LINE says is told apart — the monthly limit marks the month used up, a retry already taken is sent, others are tried again later', async () => {
  let n = 0;
  const { line, sent } = channel({
    answer: () => {
      n++;
      if (n === 1) return { ok: false, status: 409, json: async () => ({ message: 'The retry key is already accepted' }) };
      if (n === 2) return { ok: false, status: 400, json: async () => ({ message: 'Bad request' }) };
      return { ok: false, status: 429, json: async () => ({ message: 'You have reached your monthly limit.' }) };
    }
  });
  line.danger('🚨', 'a'); assert.equal(await line.flush(), true, '409: LINE has it');
  line.danger('🚨', 'b'); assert.equal(await line.flush(), false);
  assert.equal(line.status().exhausted, false, 'a bad request is not the limit');
  line.danger('🚨', 'c'); assert.equal(await line.flush(), false);
  assert.equal(line.status().exhausted, true);
  line.danger('🚨', 'd'); assert.equal(await line.flush(), false);
  assert.equal(sent.length, 3, 'nothing is sent once the month is used up');
});

test('LINE: a long text goes in messages of 5000 characters at most (5 at most), and a reply is free', async () => {
  const { line, sent } = channel();
  line.danger('🚨', 'x');
  const long = Array.from({ length: 40 }, (_, i) => `・${'あ'.repeat(190)}${i}`);
  line.danger('🚨', 'y', long);
  await line.flush();
  const m = sent[0].body.messages;
  assert.ok(m.length >= 1 && m.length <= 5 && m.every((x) => x.type === 'text' && Array.from(x.text).length <= 5000));
  const before = line.status().used;
  assert.equal(await line.reply('reply-token-1', 'こんにちは'), true);
  assert.equal(sent.at(-1).url, 'https://api.line.me/v2/bot/message/reply');
  assert.deepEqual(sent.at(-1).body, { replyToken: 'reply-token-1', messages: [{ type: 'text', text: 'こんにちは' }] });
  assert.equal(line.status().used, before, 'a reply does not count');
  assert.equal(await line.reply('', 'x'), false);
});

test('LINE: the count and the notices waiting are kept in the database, so a restart forgets neither', async () => {
  const a = channel();
  a.line.danger('🚨', '一通目'); await a.line.flush();
  a.line.say('📝', '待っている');
  const again = createLine({
    token: TOKEN, to: [STAFF], limit: 10, jst, clock: a.clock.now, fetcher: async () => ok,
    kv: { get: (k) => (a.store.has(k) ? JSON.parse(a.store.get(k)) : null), set: (k, v) => a.store.set(k, JSON.stringify(v)) }
  });
  assert.equal(again.status().used, 1);
  a.clock.add(11 * 60000);
  assert.equal(await again.tick(), true, 'the one that waited goes after the restart');
});

test('the notices\' places as one: the same call to each, and what each said', async () => {
  const calls = [];
  const mk = (name, on, flushed) => ({ name, on, log: (r) => calls.push([name, 'log', r.action]), say: (m, t) => { calls.push([name, 'say', t]); return on; }, danger: (m, t) => { calls.push([name, 'danger', t]); return on; }, host: (h) => calls.push([name, 'host', h]), flush: async () => flushed });
  const n = createNotifier([mk('discord', true, true), mk('line', false, null)]);
  assert.equal(n.on, true);
  n.log({ action: 'x' }); n.say('a', 'b'); n.host('h');
  assert.deepEqual(calls.map((c) => c[0] + c[1]), ['discordlog', 'linelog', 'discordsay', 'linesay', 'discordhost', 'linehost']);
  assert.equal(await n.flush(), true, 'null (not set up) is not a failure');
  assert.deepEqual(await n.flushEach(), { discord: true, line: null });
  assert.equal(await createNotifier([mk('d', true, true), mk('l', true, false)]).flush(), false);
  assert.equal(await createNotifier([mk('d', false, null)]).flush(), null);
  assert.equal(createNotifier([mk('d', false, null)]).on, false);
  assert.equal(describe({ action: 'open' }), null);
  assert.equal(describe({ action: 'lockdown', summary: 's', at: 1, detail: { reason: 'r' } }).danger, true);
});

// the bot on a real server, with LINE in its place
async function botServer(extra = {}) {
  const line = await fakeLine();
  const s = await startServer({
    operators: ['taku'], lineChannelSecret: SECRET, lineAccessToken: TOKEN, lineStaffUserIds: [STAFF], lineApi: line.url, gateKey: KEY, ...extra
  });
  const post = (body, { secret = SECRET, headers = {} } = {}) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return fetch(`${s.base}/api/line/webhook`, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sign(raw, secret), ...headers } })
      .then(async (r) => ({ ...(await r.json()), status: r.status }));
  };
  const event = (text, source = { type: 'user', userId: STAFF }, extra = {}) => ({
    destination: 'U' + 'd'.repeat(32), events: [{ type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: crypto.randomBytes(8).toString('hex'), deliveryContext: { isRedelivery: false }, replyToken: 'rt-' + crypto.randomBytes(4).toString('hex'), source, message: { type: 'text', id: '1', text }, ...extra }]
  });
  const replies = () => line.got.filter((g) => g.url === '/v2/bot/message/reply');
  const stop = async () => { await s.stop(); await line.close(); };
  return { s, line, post, event, replies, stop };
}

test('the LINE bot: signed calls only (LINE\'s own check of the address passes), the staff get today\'s passkey in a talk of two and nobody else', async () => {
  const b = await botServer();
  try {
    const code = passkeyFor(KEY, jstDay(Date.now()), 0);
    // LINE\'s own check of the address: a signed call with no events
    assert.deepEqual(await b.post({ destination: 'U' + 'd'.repeat(32), events: [] }), { status: 200 });
    // not signed by LINE: refused (no header, another secret, a body changed after signing)
    assert.equal((await b.post(b.event('パスキー'), { secret: 'f'.repeat(32) })).status, 401);
    const raw = JSON.stringify(b.event('パスキー'));
    assert.equal((await fetch(`${b.s.base}/api/line/webhook`, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json' } })).status, 401);
    assert.equal((await fetch(`${b.s.base}/api/line/webhook`, { method: 'POST', body: raw + ' ', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sign(raw) } })).status, 401);
    assert.equal((await b.post('not json')).status, 400, 'signed, but not JSON');
    assert.equal(b.replies().length, 0, 'nothing answered a call that was not LINE\'s');

    // the staff, in their own talk with the bot
    assert.equal((await b.post(b.event('パスキー'))).status, 200);
    const r = await until(() => b.replies()[0]);
    assert.equal(r.headers.authorization, `Bearer ${TOKEN}`);
    assert.match(r.body.replyToken, /^rt-/);
    assert.match(r.body.messages[0].text, new RegExp(`パスキー：${code}`));
    assert.match(r.body.messages[0].text, /23:59/);
    assert.equal(b.line.got.filter((g) => g.url.includes('/push')).length, 0, 'a reply, never a push: it costs nothing');
    assert.equal(b.s.app.api.line.status().used, 0);
    // (the log says who asked, not the number)
    const rows = b.s.app.db.prepare("SELECT * FROM ops_log WHERE action = 'pk_issue'").all();
    assert.equal(rows.length, 1);
    assert.ok(!rows[0].detail.includes(code) && !rows[0].summary.includes(code));

    // other ways of writing it, and the id
    for (const t of ['/passkey', 'passkey', 'ぱすきー', ' PASSKEY ']) {
      const before = b.replies().length;
      await b.post(b.event(t));
      await until(() => b.replies().length > before);
      assert.match(b.replies().at(-1).body.messages[0].text, new RegExp(code), t);
    }
    // someone who is not on the staff list: no number
    await b.post(b.event('パスキー', { type: 'user', userId: OTHER }));
    await until(() => b.replies().length > 5);
    assert.match(b.replies().at(-1).body.messages[0].text, /運営の方だけ/);
    // a group or a room: no number, whoever writes it
    await b.post(b.event('パスキー', { type: 'group', groupId: GROUP, userId: STAFF }));
    await until(() => b.replies().length > 6);
    assert.match(b.replies().at(-1).body.messages[0].text, /1対1/);
    assert.ok(b.replies().slice(0, 5).every((x) => x.body.messages[0].text.includes(code)), 'the five before were the staff\'s');
    assert.doesNotMatch(b.replies().at(-1).body.messages[0].text, new RegExp(code));
    assert.doesNotMatch(b.replies().at(-2).body.messages[0].text, new RegExp(code));

    // "ID": anyone is told their own, which is how the lists are filled in
    await b.post(b.event('ＩＤ', { type: 'user', userId: OTHER }));
    await until(() => b.replies().length > 7);
    assert.match(b.replies().at(-1).body.messages[0].text, new RegExp(`あなたのID：${OTHER}`));
    await b.post(b.event('id', { type: 'group', groupId: GROUP, userId: OTHER }));
    await until(() => b.replies().length > 8);
    assert.match(b.replies().at(-1).body.messages[0].text, new RegExp(`このグループのID：${GROUP}[\\s\\S]*あなたのID：${OTHER}`));
    // anything else in a talk of two: how to use it; in a group: quiet
    await b.post(b.event('こんにちは', { type: 'user', userId: OTHER }));
    await until(() => b.replies().length > 9);
    assert.match(b.replies().at(-1).body.messages[0].text, /「パスキー」と送ると/);
    const n = b.replies().length;
    await b.post(b.event('こんにちは', { type: 'group', groupId: GROUP, userId: OTHER }));
    await b.post({ events: [{ type: 'follow', replyToken: 'rt-follow', source: { type: 'user', userId: OTHER }, webhookEventId: 'f1' }] });
    await until(() => b.replies().length > n);
    assert.equal(b.replies().length, n + 1, 'the group was not answered; the friend added was');
    assert.match(b.replies().at(-1).body.messages[0].text, /友だち追加ありがとうございます/);

    // an event LINE sends again is answered once
    const again = b.event('パスキー');
    const m = b.replies().length;
    await b.post(again); await b.post(again);
    await until(() => b.replies().length > m);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(b.replies().length, m + 1);
  } finally { await b.stop(); }
});

test('the LINE bot: before the passkey is set up it says so, and a person is not asked too often', async () => {
  const b = await botServer({ gateKey: '' });
  try {
    await b.post(b.event('パスキー'));
    await until(() => b.replies()[0]);
    assert.match(b.replies()[0].body.messages[0].text, /まだサーバーで設定されていません/);
  } finally { await b.stop(); }
  const c = await botServer();
  try {
    for (let i = 0; i < 8; i++) await c.post(c.event('パスキー'));
    await until(() => c.replies().length >= 8);
    const texts = c.replies().map((x) => x.body.messages[0].text);
    assert.equal(texts.filter((t) => t.includes('パスキー：')).length, 6);
    assert.ok(texts.some((t) => t.includes('少し待って')));
  } finally { await c.stop(); }
});

test('LINE on a real server: the server tab shows the allowance, the test button reaches LINE, a wrong passkey is a danger sent at once, and the bot answers during a lockdown', async () => {
  const b = await botServer({ limits: { general: [100000, 1000], login: [100000, 1000] }, publicUrl: 'https://blockbuster-reels.example.workers.dev' });
  try {
    await b.s.register('taku');
    const login = await b.s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD } });
    const token = login.token;
    // the operator site\'s calls are signed once the passkey is in (the pieces of that are in pk.test.js)
    const page = async () => {
      const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      const j = await crypto.subtle.exportKey('jwk', kp.publicKey);
      return { kp, pub: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, gid: '' };
    };
    const header = async (p, method, path) => {
      const ts = Date.now(), nonce = crypto.randomBytes(16).toString('base64url');
      const sig = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, p.kp.privateKey, Buffer.from(`v1\n${method}\n${path}\n${ts}\n${nonce}\n${p.gid}`))).toString('base64url');
      return `${p.gid}.${ts}.${nonce}.${sig}`;
    };
    const p1 = await page();
    const right = passkeyFor(KEY, jstDay(Date.now()), 0);
    p1.gid = (await b.s.call('POST', '/api/pk/open', { token, body: { passkey: right, pub: p1.pub } })).gid;
    const signed = async (method, path, body) => b.s.call(method, path, { token, body, headers: { 'X-Gate': await header(p1, method, path) } });
    const pushes = () => b.line.got.filter((g) => g.url === '/v2/bot/message/push');

    // the server tab: LINE is on, nothing used yet
    const tab = await signed('GET', '/api/ops/server');
    assert.deepEqual([tab.line.on, tab.line.bot, tab.line.limit, tab.line.used, tab.line.to], [true, true, 200, 0, 1]);
    assert.equal(tab.discord.on, false);
    // the test button: to LINE (Discord is not set up: it is not a failure)
    const test = await signed('POST', '/api/ops/discord/test', {});
    assert.deepEqual([test.ok, test.discord, test.line], [true, null, true]);
    assert.match(pushes()[0].body.messages[0].text, /🔔 テスト通知です/);
    assert.equal((await signed('GET', '/api/ops/server')).line.used, 1);

    // a wrong passkey (another page): a danger, sent at once, to the one person
    const p2 = await page();
    const wrong = right === '123456' ? '654321' : '123456';
    assert.equal((await b.s.call('POST', '/api/pk/open', { token, body: { passkey: wrong, pub: p2.pub } })).error.code, 'pk_wrong');
    const danger = await until(() => pushes()[1], 6000);
    assert.ok(danger, 'it goes out at once');
    assert.equal(danger.body.to, STAFF);
    assert.match(danger.body.messages[0].text, /🔑 【危険】taku（開発者）のパスキーの入力が違っていた/);
    assert.match(danger.body.messages[0].text, /セキュリティHOME/);
    assert.equal((await signed('GET', '/api/ops/server')).line.used, 2);

    // a lockdown: told as a danger, and the bot still answers (the staff need the passkey to reach the security base)
    assert.equal((await signed('POST', '/api/sec/lockdown', { reason: 'test' })).locked, true);
    const lock = await until(() => pushes().find((x) => /🔒 【危険】/.test(x.body.messages[0].text)), 6000);
    assert.ok(lock, 'the lockdown is told');
    const before = b.replies().length;
    assert.equal((await b.post(b.event('パスキー'))).status, 200);
    const r = await until(() => b.replies()[before]);
    // (a lockdown changes the day's passkey: the one the bot gives now is the new one)
    const fresh = b.s.app.api.pk.today().code;
    assert.notEqual(fresh, right);
    assert.ok(r && r.body.messages[0].text.includes(fresh), 'the bot answers during the lockdown');
    // …and the operator site itself is shut
    assert.equal((await b.s.call('GET', '/api/ops/me', { token, headers: { 'X-Gate': await header(p1, 'GET', '/api/ops/me') } })).status, 503);
  } finally { await b.stop(); }
});
