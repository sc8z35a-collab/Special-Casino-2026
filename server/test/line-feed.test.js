import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';
import { createLineFeed, feedPeriods } from '../core/line-feed.js';
import { configFrom } from '../core/config.js';
import catalog from '../core/line-wallpapers.json' with { type: 'json' };

const SECRET = '0123456789abcdef0123456789abcdef', TOKEN = 'feed-test-token-' + 'x'.repeat(40);
const USER = 'U' + 'a'.repeat(32), GROUP = 'C' + 'b'.repeat(32), ROOM = 'R' + 'c'.repeat(32);
const MONDAY = Date.parse('2026-10-26T00:00:00Z'), DAY = 86400000;
const fakePhotos = [1, 2, 3].map((i) => ({ id: String(i), original: `/p${i}.jpg`, preview: `/s${i}.jpg` }));
const request = (body) => ({ json: async () => body });

async function fixture(options = {}) {
  const s = await startServer();
  const db = s.app.db, q = (sql) => db.prepare(sql);
  let now = MONDAY;
  const sent = [];
  const kv = { get(k) { const r = q('SELECT value FROM meta WHERE key = ?').get(k); return r ? JSON.parse(r.value) : null; },
    set(k, v) { q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v)); } };
  const params = { q, tx: (fn) => db.tx(fn), kv,
    config: configFrom({}, { lineFeedEnabled: true, lineChannelSecret: SECRET, lineAccessToken: TOKEN, publicUrl: 'https://game.test' }),
    clock: () => now, photos: fakePhotos, rand: () => 0.5, version: 'version-1',
    getUser: (id) => q('SELECT * FROM users WHERE id = ?').get(id), meDto: (u) => u,
    balanceChanged: (id) => q('SELECT * FROM users WHERE id = ?').get(id),
    fetcher: async (url, init) => { sent.push({ url, body: JSON.parse(init.body), key: init.headers['X-Line-Retry-Key'] }); return new Response('{}'); }, ...options };
  let feed = createLineFeed(params);
  return { s, q, kv, params, sent, get feed() { return feed; },
    set(t) { now = t; }, add(t) { now += t; }, restart(extra = {}) { feed = createLineFeed({ ...params, ...extra }); return feed; }, stop: s.stop };
}
const photoCalls = (f) => f.sent.filter((r) => r.body.messages.some((m) => m.type === 'image'));

test('LINE feed: JST daily/weekly boundaries and configuration are explicit', () => {
  const p = feedPeriods(MONDAY - 1);
  assert.equal(p.day, Date.parse('2026-10-25T15:00:00Z'));
  assert.equal(p.dailyAt, MONDAY);
  assert.equal(p.weeklyAt, MONDAY);
  assert.throws(() => configFrom({ LINE_FEED_HOUR_JST: '24' }));
  assert.throws(() => configFrom({ LINE_FEED_TO: 'not-a-line-id' }));
});

test('LINE feed: one photo per JST date/chat, all photos per cycle, restart and simultaneous ticks cannot duplicate', async () => {
  const f = await fixture();
  try {
    for (const source of [{ type: 'user', userId: USER }, { type: 'group', groupId: GROUP }, { type: 'room', roomId: ROOM }]) f.feed.event({ type: 'join', source, timestamp: MONDAY });
    const seen = [];
    for (let day = 0; day < 4; day++) {
      f.set(MONDAY + day * DAY); f.restart();
      await Promise.all([f.feed.tick(), f.feed.tick(), f.feed.tick()]);
      const calls = photoCalls(f).slice(day * 3);
      assert.equal(calls.length, 3);
      assert.equal(new Set(calls.map((r) => r.key)).size, 3, 'retry keys belong to a destination');
      assert.deepEqual(new Set(calls.map((r) => r.body.to)), new Set([USER, GROUP, ROOM]));
      assert.equal(calls[0].body.messages[0].text, '今日の一枚');
      seen.push(calls[0].body.messages[1].originalContentUrl);
      await f.feed.tick(); assert.equal(photoCalls(f).length, (day + 1) * 3);
    }
    assert.equal(new Set(seen.slice(0, 3)).size, 3);
    assert.notEqual(seen[2], seen[3], 'no immediate repeat across cycles');
  } finally { await f.stop(); }
});

test('LINE feed: ambiguous push retries use persisted UUID, confirmed 409 completes it; no retry past 23 hours', async () => {
  const accepted = new Set(), calls = [];
  const f = await fixture({ photos: [], fetcher: async (url, init) => {
    const key = init.headers['X-Line-Retry-Key']; calls.push(key);
    if (!accepted.has(key)) { accepted.add(key); throw new Error('reply lost after acceptance'); }
    return new Response('{}', { status: 409, headers: { 'x-line-accepted-request-id': 'accepted' } });
  } });
  try {
    f.feed.event({ type: 'follow', source: { type: 'user', userId: USER } });
    await f.feed.tick(); assert.equal(calls.length, 2);
    f.add(120000); f.restart(); await f.feed.tick();
    assert.equal(calls.length, 4); assert.deepEqual(calls.slice(0, 2), calls.slice(2));
    assert.equal(f.q("SELECT COUNT(*) AS n FROM line_feed_deliveries WHERE state = 'sent'").get().n, 2);
    f.q("UPDATE line_feed_deliveries SET state = 'pending', next_at = 0").run();
    f.add(DAY); f.restart(); await f.feed.tick();
    assert.equal(calls.length, 4, 'do not create a new retry key when LINE retention has ended');
  } finally { await f.stop(); }
});

test('LINE feed: before 9 there is no photo/reward; leave and old/redelivered events cannot re-subscribe a chat', async () => {
  const f = await fixture();
  try {
    f.set(MONDAY - 60000); f.feed.event({ type: 'join', timestamp: MONDAY - 120000, source: { type: 'group', groupId: GROUP } });
    await f.feed.tick(); assert.equal(f.sent.length, 0); assert.equal(f.feed.nextDue(), MONDAY);
    f.set(MONDAY + 1000); f.feed.event({ type: 'leave', timestamp: MONDAY, source: { type: 'group', groupId: GROUP } });
    f.feed.event({ type: 'join', timestamp: MONDAY - 120000, source: { type: 'group', groupId: GROUP } });
    f.feed.event({ type: 'message', timestamp: MONDAY + 1000, source: { type: 'group', groupId: GROUP } });
    await f.feed.tick(); assert.equal(f.sent.length, 0);
    f.feed.event({ type: 'join', timestamp: MONDAY + 1000, source: { type: 'group', groupId: GROUP } });
    await f.feed.tick(); assert.equal(photoCalls(f).length, 1);
  } finally { await f.stop(); }
});

test('LINE feed: registered chat messages and redelivered events do not schedule unnecessary alarms', async () => {
  let wakes = 0;
  const f = await fixture({ reschedule: () => { wakes++; } });
  try {
    const source = { type: 'group', groupId: GROUP };
    const join = { type: 'join', timestamp: MONDAY, source };
    f.feed.event(join); assert.equal(wakes, 1);
    for (let i = 0; i < 100; i++) f.feed.event({ type: 'message', source });
    f.feed.event(join);
    assert.equal(wakes, 1);
    f.add(1000); f.feed.event({ type: 'leave', source }); assert.equal(wakes, 2);
    f.feed.event({ type: 'message', source }); assert.equal(wakes, 2);
    await f.feed.tick(); assert.equal(f.sent.length, 0);
  } finally { await f.stop(); }
});

test('LINE feed: bounded parallel sends keep unique leases and retry only a rate-limited destination with its original key', async () => {
  let active = 0, peak = 0;
  const calls = [];
  const f = await fixture({ fetcher: async (url, init) => {
    active++; peak = Math.max(peak, active);
    const call = { key: init.headers['X-Line-Retry-Key'], body: JSON.parse(init.body) }; calls.push(call);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return new Response('{}', { status: calls.indexOf(call) === 0 ? 429 : 200 });
  } });
  try {
    for (let i = 0; i < 8; i++) f.feed.event({ type: 'follow', source: { type: 'user', userId: 'U' + i.toString(16).padStart(32, '0') } });
    const tick = f.feed.tick(); assert.equal(f.feed.tick(), tick);
    await tick;
    assert.equal(calls.length, 24); assert.equal(peak, 4);
    assert.equal(new Set(calls.map((r) => r.key)).size, 24);
    assert.equal(f.q("SELECT COUNT(*) AS n FROM line_feed_deliveries WHERE state = 'sent'").get().n, 23);
    f.add(3600001); await f.feed.tick();
    assert.equal(calls.length, 25); assert.equal(calls[24].key, calls[0].key);
    assert.deepEqual(calls[24].body, calls[0].body);
    assert.equal(f.q("SELECT COUNT(*) AS n FROM line_feed_deliveries WHERE state = 'sent'").get().n, 24);
  } finally { await f.stop(); }
});

test('LINE weekly rewards: 10% jackpot boundary, normal and royal endpoints, amounts persist through restart', async () => {
  for (const [draws, casino, royal] of [[[0.099999, 0], 20000, 2], [[0.1, 0, 0.999999], 500, 6], [[0.99, 0.999999, 0.4], 10000, 4]]) {
    let i = 0; const f = await fixture({ photos: [], rand: () => draws[i++] });
    try {
      f.feed.event({ type: 'follow', source: { type: 'user', userId: USER } });
      await f.feed.tick();
      assert.equal(f.q("SELECT amount FROM line_feed_rewards WHERE kind = 'casino'").get().amount, casino);
      assert.equal(f.q("SELECT amount FROM line_feed_rewards WHERE kind = 'royal'").get().amount, royal);
      f.restart({ rand: () => { throw new Error('must not redraw'); } }); await f.feed.tick();
      assert.equal(f.q('SELECT COUNT(*) AS n FROM line_feed_rewards').get().n, 2);
    } finally { await f.stop(); }
  }
});

test('LINE group reward: separate kinds, one claim per account/week across all chats, concurrent taps and expiry', async () => {
  const f = await fixture();
  try {
    const a = await f.s.register('配布A'), b = await f.s.register('配布B');
    f.feed.event({ type: 'join', source: { type: 'group', groupId: GROUP } }); await f.feed.tick();
    const gift = f.sent.find((r) => r.body.messages[0].type === 'flex').body.messages[0];
    const token = new URL(gift.contents.body.action.uri).hash.split('=')[1];
    const u = { id: a.me.id }, get = f.feed.routes['POST /api/line/reward'], claim = f.feed.routes['POST /api/line/reward/claim'];
    const before = await get(request({ token }), u);
    assert.equal(before.claimed, false);
    const claims = await Promise.all([claim(request({ token }), u), claim(request({ token }), u)]);
    assert.equal(claims.filter((r) => r.received).length, 1);
    const column = before.kind === 'casino' ? 'tokens' : 'coins';
    assert.equal(f.q(`SELECT ${column} AS n FROM users WHERE id = ?`).get(u.id).n, a.me[column] + before.amount);
    assert.equal((await claim(request({ token }), { id: b.me.id })).received, true, 'group link is usable by each signed-in player');
    f.restart(); assert.equal((await f.feed.routes['POST /api/line/reward/claim'](request({ token }), u)).received, false);
    f.add(7 * DAY); const c = await f.s.register('配布C');
    await assert.rejects(claim(request({ token }), { id: c.me.id }), (e) => e.status === 410);
  } finally { await f.stop(); }
});

test('LINE update: one exact sentence per deployment/version and recipient, including after restart', async () => {
  const f = await fixture();
  try {
    f.feed.event({ type: 'follow', source: { type: 'user', userId: USER } }); await f.feed.tick();
    f.restart({ version: 'version-2' }); await f.feed.tick();
    const update = f.sent.filter((r) => r.body.messages[0].text?.includes('アップデート'));
    assert.equal(update.length, 1);
    assert.deepEqual(update[0].body.messages, [{ type: 'text', text: 'S2 DEV1のバージョンversion-2にアップデートされました。' }]);
    f.restart({ version: 'version-2' }); await f.feed.tick();
    assert.equal(f.sent.filter((r) => r.body.messages[0].text?.includes('アップデート')).length, 1);
  } finally { await f.stop(); }
});

test('LINE public webhook authenticates raw bytes and does not answer commands, even for staff', async () => {
  const s = await startServer({ lineFeedEnabled: true, lineChannelSecret: SECRET, lineAccessToken: TOKEN, lineStaffUserIds: [USER] });
  try {
    const raw = JSON.stringify({ events: [{ type: 'message', source: { type: 'group', groupId: GROUP }, message: { type: 'text', text: 'パスキー' } }] });
    const send = (signature) => fetch(s.base + '/api/line/webhook', { method: 'POST', body: raw, headers: { 'X-Line-Signature': signature } });
    assert.equal((await send('invalid')).status, 401);
    assert.equal((await send(crypto.createHmac('sha256', SECRET).update(raw).digest('base64'))).status, 200);
    assert.equal(s.app.db.prepare('SELECT active FROM line_feed_targets WHERE id = ?').get(GROUP).active, 1);
    assert.equal((await s.call('POST', '/api/line/reward/claim', { body: { token: 'x'.repeat(32) } })).status, 401);
    const p = await s.register('認証確認');
    assert.equal((await s.call('POST', '/api/line/reward/claim', { token: p.token, body: { token: 'x'.repeat(32) } })).status, 404);
  } finally { await s.stop(); }
});

test('LINE images cover the wallpaper app and retain original dimensions, JPEG/preview size limits and source hashes', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const wallpapers = JSON.parse(fs.readFileSync(path.join(root, 'ops/assets/wallpapers.json')));
  assert.deepEqual(new Set(catalog.map((r) => r.source)), new Set(['wallpaper-desktop.webp', 'wallpaper-reserve.webp', ...wallpapers.map((r) => 'wallpapers/' + r.file)]));
  for (const p of catalog) {
    const source = fs.readFileSync(path.join(root, 'ops/assets', p.source));
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), p.sha256, 'regenerate with tools/build_line_wallpapers.py');
    for (const [key, max] of [['original', 10 * 1024 * 1024], ['preview', 1024 * 1024]]) {
      const bytes = fs.readFileSync(path.join(root, p[key]));
      assert.ok(path.basename(p[key]).startsWith(crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24)), 'immutable URL must identify encoded bytes');
      assert.equal(bytes.readUInt16BE(0), 0xffd8); assert.ok(bytes.length <= max);
      let i = 2, size;
      while (i < bytes.length) {
        const marker = bytes.readUInt16BE(i), length = bytes.readUInt16BE(i + 2);
        if ([0xffc0, 0xffc1, 0xffc2].includes(marker)) { size = { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }; break; }
        i += length + 2;
      }
      assert.ok(size);
      if (key === 'original') assert.deepEqual(size, { width: p.width, height: p.height });
      else assert.ok(size.width <= 320 && size.height <= 320);
    }
  }
});
