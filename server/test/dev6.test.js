// DEV6 on the server: the age check, presents, the silent block, the chat
// filter, 通報 and the official bot, and the operators' log. npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { screen } from '../core/filter.js';
import { AUTO_TEXT, WAIT_MS } from '../core/official.js';

let s, call, register, setUser, befriend;
let taku;

before(async () => {
  s = await startServer({ limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000] } });
  ({ call, register, setUser, befriend } = s);
  taku = await register('TAKU');
});
after(() => s.stop());

const db = () => s.app.db;
const ops = (method, url, body) => call(method, url, { token: taku.token, body });
const dollars = (id) => db().prepare('SELECT dollars FROM users WHERE id = ?').get(id).dollars;
const chat = async (p, withId) => (await call('GET', `/api/messages?with=${withId}`, { token: p.token })).messages;
// ジョンソン's first gift comes with the first spend: taken before counting money
async function friends(a, b) {
  await befriend(a, b);
  await call('GET', '/api/johnson', { token: a.token });
  await call('GET', '/api/johnson', { token: b.token });
}

test('the chat filter: the words go, everyday sentences stay', () => {
  for (const t of ['楽しいしね', 'ゴミ箱に捨てた', 'このゴミは捨てておいて', 'シネマに行こう', '田中くんに会った', 'フェラーリに乗りたい', 'びっちりやった',
    '活きもいい魚', 'いまんところ順調', 'ヒエログリフ', 'カステラ食べた', '手を抜いて休んだ', 'クソ強い', 'ばかみたいに当たった', 'sexy dance', 'ちんちん電車']) {
    assert.deepEqual(screen(t).words, [], t);
  }
  assert.equal(screen('死ねよカス').masked, '***よ***');
  assert.equal(screen('お前ゴミだな').masked, 'お前***');
  assert.equal(screen('セックスしよう').masked, '***しよう');
});

test('18歳以上？ answered once', async () => {
  const a = await register('Age1');
  assert.equal((await call('GET', '/api/me', { token: a.token })).me.age, null);
  assert.equal((await call('POST', '/api/age', { token: a.token, body: { adult: true } })).me.age, true);
  assert.equal((await call('POST', '/api/age', { token: a.token, body: { adult: false } })).me.age, true);
  const p = (await ops('GET', `/api/ops/player?id=${a.me.id}`)).player;
  assert.equal(p.age, true);
  assert.ok(p.ageAt > 0);
});

test('presents: paid when sent, worth their price once to the friend', async () => {
  const a = await register('Gift1'), b = await register('Gift2');
  await friends(a, b);
  const a0 = dollars(a.me.id), b0 = dollars(b.me.id);
  const r = await call('POST', '/api/present', { token: a.token, body: { to: b.me.id, id: 'snowman' } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(dollars(a.me.id), a0 - 100000);
  assert.equal(r.message.kind, 'present');
  assert.equal(r.message.claimed, false);
  assert.equal((await call('POST', '/api/present/claim', { token: a.token, body: { message: r.message.id } })).status, 404);
  const c = await call('POST', '/api/present/claim', { token: b.token, body: { message: r.message.id } });
  assert.equal(c.paid, 100000);
  assert.equal(dollars(b.me.id), b0 + 100000);
  assert.equal((await call('POST', '/api/present/claim', { token: b.token, body: { message: r.message.id } })).error.code, 'claimed');
});

test('a silent block: the blocked player notices nothing, the blocker gets it all on unblocking', async () => {
  const a = await register('Blk1'), b = await register('Blk2');
  await friends(a, b);
  assert.equal((await call('POST', '/api/block', { token: b.token, body: { user: a.me.id, blocked: true } })).blocked, true);
  // a can still write, pay and give
  const m = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'まだ届く？' } });
  assert.equal(m.status, 200, JSON.stringify(m));
  const b0 = dollars(b.me.id);
  assert.equal((await call('POST', '/api/transfer', { token: a.token, body: { to: b.me.id, amount: 1000, currency: 'dollars' } })).status, 200);
  assert.equal((await call('POST', '/api/present', { token: a.token, body: { to: b.me.id, id: 'cookie' } })).status, 200);
  assert.equal((await chat(a, b.me.id)).filter((x) => x.kind !== 'system').length >= 3, true);
  // b sees and gets nothing
  assert.equal((await chat(b, a.me.id)).some((x) => x.text === 'まだ届く？'), false);
  assert.equal(dollars(b.me.id), b0);
  // unblocked: everything as it would have come
  const u = await call('POST', '/api/block', { token: b.token, body: { user: a.me.id, blocked: false } });
  assert.equal(u.released, 3);
  const list = await chat(b, a.me.id);
  assert.ok(list.some((x) => x.text === 'まだ届く？'));
  assert.ok(list.some((x) => x.kind === 'present' && !x.claimed));
  assert.equal(dollars(b.me.id), b0 + 1000);
});

test('the filter on a chat: *** for the friend, the original and a 検知 for the operators', async () => {
  const a = await register('Rude1'), b = await register('Rude2');
  await befriend(a, b);
  const r = await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: 'お前ゴミだな、死ね' } });
  assert.equal(r.message.text, 'お前***、***');
  const d = (await ops('GET', `/api/ops/detections?id=${a.me.id}`)).detections;
  assert.equal(d.length, 1);
  assert.equal(d[0].original, 'お前ゴミだな、死ね');
  assert.equal(d[0].recipient.name, 'Rude2');
  const row = (await ops('GET', '/api/ops/players')).players.find((p) => p.id === a.me.id);
  assert.equal(row.detections, 1);
  await ops('POST', '/api/ops/detections/review', { player: a.me.id });
  assert.equal((await ops('GET', '/api/ops/players')).players.find((p) => p.id === a.me.id).detections, 0);
});

test('通報 → accepted: the official bot pays the reporter and thanks them', async () => {
  const a = await register('Rep1'), b = await register('Rep2');
  await call('GET', '/api/johnson', { token: a.token });
  const bot = (await call('GET', '/api/me', { token: a.token })).official;
  assert.equal(bot.name, 'Ice Smoker公式');
  // no friendship needed; the bot cannot be reported or blocked
  const r = await call('POST', '/api/report', { token: a.token, body: { user: b.me.id, kind: 'abuse', text: '暴言を言われました', place: 'search' } });
  assert.equal(r.message, '今後このようなトラブルがないよう気を付けます。');
  assert.equal((await call('POST', '/api/report', { token: a.token, body: { user: bot.id, kind: 'spam', text: 'x' } })).error.code, 'npc');
  assert.equal((await call('POST', '/api/block', { token: a.token, body: { user: bot.id, blocked: true } })).error.code, 'npc');
  const list = (await ops('GET', '/api/ops/reports')).reports;
  const rep = list.find((x) => x.reporter.id === a.me.id);
  assert.equal(rep.target.name, 'Rep2');
  assert.equal(rep.context.target.name, 'Rep2');
  const a0 = dollars(a.me.id);
  assert.equal((await ops('POST', '/api/ops/report', { id: rep.id, action: 'accept', reward: 600000 })).report.status, 'accepted');
  assert.equal(dollars(a.me.id), a0 + 600000);
  const msgs = await chat(a, bot.id);
  assert.ok(msgs.some((m) => m.kind === 'transfer' && m.amount === 600000));
  assert.match(msgs[msgs.length - 1].text, /受理されました/);
  assert.equal((await ops('POST', '/api/ops/report', { id: rep.id, action: 'accept', reward: 600000 })).error.code, 'done');
});

test('the official bot: 返信待ち, the operators answer and send money, 2 days without an answer', async () => {
  const a = await register('Bot1');
  await call('GET', '/api/johnson', { token: a.token });
  const bot = (await call('GET', '/api/me', { token: a.token })).official;
  await call('POST', '/api/official/feedback', { token: a.token, body: { kind: 'bug', text: 'ボタンが押せません' } });
  assert.equal((await ops('GET', '/api/ops/players')).players.find((p) => p.id === a.me.id).waiting, true);
  assert.equal((await ops('GET', '/api/ops/feedback')).feedback[0].kind, 'bug');
  // opened on the operator site: read
  const c = await ops('GET', `/api/ops/chat?id=${a.me.id}`);
  assert.match(c.messages[0].text, /【報告】/);
  const sent = await ops('POST', '/api/ops/chat', { id: a.me.id, subject: 'お問い合わせの件', body: 'ご報告ありがとうございます。' });
  assert.match(sent.message.text, /Bot1様/);
  assert.match(sent.message.text, /Ice Smoker公式より$/);
  assert.equal(sent.player.waiting, false);
  const a0 = dollars(a.me.id);
  assert.equal((await ops('POST', '/api/ops/money', { id: a.me.id, amount: 10000001 })).error.code, 'bad_amount');
  await ops('POST', '/api/ops/money', { id: a.me.id, amount: 2500000, note: 'お詫びです' });
  assert.equal(dollars(a.me.id), a0 + 2500000);
  // waiting more than two days: read and answered on its own, once
  await call('POST', '/api/messages', { token: a.token, body: { to: bot.id, text: 'まだですか？' } });
  db().prepare('UPDATE bot_threads SET waiting_since = waiting_since - ? WHERE user_id = ?').run(WAIT_MS + 1000, a.me.id);
  s.app.api.housekeeping();
  s.app.api.housekeeping();
  const msgs = await chat(a, bot.id);
  assert.equal(msgs.filter((m) => m.text === AUTO_TEXT).length, 1);
});

test('the operators\' log: everything done, chained, and never deleted', async () => {
  const entries = (await ops('GET', '/api/ops/log')).entries;
  for (const a of ['release', 'report_accept', 'bot_message', 'money', 'bot_auto_reply', 'detections_reviewed']) assert.ok(entries.some((e) => e.action === a), a);
  const money = entries.find((e) => e.action === 'money');
  assert.equal(money.actor.name, 'TAKU');
  assert.equal(money.detail.amount, 2500000);
  assert.ok(money.detail.time.jst.endsWith('JST'));
  assert.equal((await ops('GET', '/api/ops/log/verify')).ok, true);
  assert.throws(() => db().prepare('DELETE FROM ops_log').run(), /cannot be deleted/);
  assert.throws(() => db().prepare("UPDATE ops_log SET summary = 'x'").run(), /cannot be changed/);
  // a player is no operator
  const a = await register('NoOps');
  assert.equal((await call('GET', '/api/ops/log', { token: a.token })).status, 403);
});

test('phone notifications: a message for a player away from the game goes to their push service, encrypted and signed', async () => {
  const { webcrypto, hkdfSync } = await import('node:crypto');
  const subtle = webcrypto.subtle;
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const a = await register('Push1'), b = await register('Push2');
  await friends(a, b);
  const key = (await call('GET', '/api/push/key', { token: b.token })).key;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  // the phone's keys
  const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  const keys = { p256dh: b64u(uaPub), auth: b64u(auth) };
  assert.equal((await call('POST', '/api/push/subscribe', { token: b.token, body: { endpoint: 'https://127.0.0.1/steal', keys } })).error.code, 'bad_subscription');
  const endpoint = 'https://fcm.googleapis.com/fcm/send/test-' + Date.now();
  assert.equal((await call('POST', '/api/push/subscribe', { token: b.token, body: { endpoint, keys } })).ok, true);
  // what the server sends to the push service
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = (url, init) => {
    if (String(url) === endpoint) { sent = init; return Promise.resolve(new Response(null, { status: 201 })); }
    return realFetch(url, init);
  };
  try {
    await call('POST', '/api/messages', { token: a.token, body: { to: b.me.id, text: '今から稼ごう！' } });
    for (let i = 0; i < 50 && !sent; i++) await new Promise((r) => setTimeout(r, 20));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(sent, 'nothing was sent to the push service');
  assert.equal(sent.headers['Content-Encoding'], 'aes128gcm');
  // signed with the server's key (RFC 8292)
  const [, t, k] = sent.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, key);
  const [h, p, sig] = t.split('.');
  const pub = await subtle.importKey('raw', Buffer.from(key, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, Buffer.from(sig, 'base64url'), Buffer.from(`${h}.${p}`)));
  assert.equal(JSON.parse(Buffer.from(p, 'base64url')).aud, 'https://fcm.googleapis.com');
  // and readable by the phone only (RFC 8291)
  const body = new Uint8Array(sent.body);
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = new Uint8Array(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = new Uint8Array(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = new Uint8Array(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aes, ct));
  assert.equal(plain[plain.length - 1], 2);
  const note = JSON.parse(Buffer.from(plain.slice(0, -1)).toString('utf8'));
  assert.deepEqual([note.kind, note.title, note.body, note.open], ['msg', 'Push1', '今から稼ごう！', `dm:${a.me.id}`]);
});

test('the operators\' log survives a restore: rows that do not fit are kept inside a new entry', async () => {
  const { createOpsLog } = await import('../core/opslog.js');
  const { statements } = await import('../core/db.js');
  const log = createOpsLog({ q: statements(db()) });
  const before = log.all();
  // as if the database went back in time: the last rows "missing", others in their place
  const lost = before.slice(-2);
  const r = log.keep(lost.map((x) => ({ ...x, hash: x.hash.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) })), { why: 'テスト' });
  assert.deepEqual(r, { added: 0, kept: 2 });
  const last = log.all().at(-1);
  assert.equal(last.action, 'log_kept');
  assert.equal(JSON.parse(last.detail).entries.length, 2);
  assert.equal(log.verify().ok, true);
});
