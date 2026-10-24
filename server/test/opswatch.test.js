// The operators' screen view (server/core/opswatch.js, js/net/watchcrypto.js):
// state only and sealed end to end, nothing until 見る, one way, at most 30
// minutes, the 300 kbps ceiling, every watch in the log, and every emergency
// ends them all. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from './helpers.js';

// the same code the browsers run
globalThis.window = globalThis;
await import('../../js/net/watchcrypto.js');
const WC = globalThis.BR.watchCrypto;

const LIMITS = { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000] };

// the operator site's own live connection (an operator's ticket): events by name
async function openOps(s, op) {
  const { ticket } = await s.call('POST', '/api/ops/live-ticket', { token: op.token, body: {} });
  const events = [];
  let wake = null;
  const req = await new Promise((resolve, reject) => {
    const r = http.get(`${s.base}/api/stream?ops=${encodeURIComponent(ticket)}`, (res) => {
      if (res.statusCode !== 200) { reject(new Error('status ' + res.statusCode)); res.resume(); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block), data = /^data: (.+)$/m.exec(block);
          if (ev && data) { events.push({ name: ev[1], data: JSON.parse(data[1]) }); if (wake) wake(); }
        }
      });
      resolve(r);
    });
    r.on('error', reject);
  });
  function waitFor(name, pred = () => true, ms = 3000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { wake = null; reject(new Error('timeout waiting for ' + name)); }, ms);
      const check = () => {
        const hit = events.find((e) => !e.used && e.name === name && pred(e.data));
        if (hit) { hit.used = true; clearTimeout(t); wake = null; resolve(hit.data); } else wake = check;
      };
      check();
    });
  }
  return { events, waitFor, close: () => req.destroy() };
}

// both ends of one watch, the way the two pages do it
async function begin(s, op, opsLive, player, playerLive, extra = {}) {
  const mine = await WC.newPair();
  const r = await s.call('POST', '/api/ops/watch/start', { token: op.token, body: { player: player.me.id, quality: 360, fps: 10, pub: mine.pub, ...extra } });
  assert.equal(r.status, 200, JSON.stringify(r));
  const view = await playerLive.waitFor('view', (d) => d.on && d.sid === r.sid);
  assert.equal(view.pub, mine.pub, 'the player gets the operator\'s public key');
  const theirs = await WC.newPair();
  const hello = await s.call('POST', '/api/watch/hello', { token: player.token, body: { sid: r.sid, pub: theirs.pub } });
  assert.equal(hello.status, 200, JSON.stringify(hello));
  const got = await opsLive.waitFor('watchhello', (d) => d.sid === r.sid);
  assert.equal(got.pub, theirs.pub);
  const key = await WC.deriveKey(mine, got.pub, mine.pub, theirs.pub, r.sid);
  const pkey = await WC.deriveKey(theirs, view.pub, mine.pub, theirs.pub, r.sid);
  let n = 0;
  const send = async (state, as = player) => {
    const d = await WC.seal(pkey, r.sid, hello.e, n, state);
    const out = await s.call('POST', '/api/watch/frame', { token: as.token, body: { sid: r.sid, e: hello.e, n, d } });
    n++;
    return { out, d };
  };
  return { sid: r.sid, e: hello.e, key, pkey, send, start: r, seq: () => n, setSeq: (v) => { n = v; } };
}

test('a watch: sealed state from the player to the operator, nothing else, and every step in the log', async () => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  try {
    const taku = await s.register('TAKU');
    const p = await s.register('見られる人');
    const other = await s.register('ほかの人');
    const pl = await s.listen(p);
    const ol = await openOps(s, taku);

    // nothing is sent to the player's game before 見る
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(pl.events.filter((e) => e.name === 'view').length, 0);

    const w = await begin(s, taku, ol, p, pl);
    assert.equal(w.start.quality, 360);
    assert.equal(w.start.fps, 10);
    assert.equal(w.start.limits.bytesPerSec, 37500);

    // a frame goes through and only the operator can open it
    const state = { v: 1, s: 'slot', t: [1200, 5000000, 74], b: 100, r: [0, 0, 0, 0, 0], g: [[0, 1, 2], [3, 4, 5], [6, 0, 1], [2, 3, 4], [5, 6, 0]], w: 0, x: 0, c: 0, sp: 0 };
    const f = await w.send(state);
    assert.deepEqual(f.out.ok, true);
    const ev = await ol.waitFor('watchframe', (d) => d.sid === w.sid);
    assert.equal(ev.d, f.d, 'the server hands on the sealed bytes as they are');
    assert.deepEqual(await WC.open(w.key, w.sid, ev.e, ev.n, ev.d), state);
    assert.ok(!JSON.stringify(ev).includes('1200'), 'no readable state on the wire');

    // replaying it, or sending it again with an old counter, gets nowhere
    const before = ol.events.filter((e) => e.name === 'watchframe').length;
    const again = await s.call('POST', '/api/watch/frame', { token: p.token, body: { sid: w.sid, e: w.e, n: ev.n, d: ev.d } });
    assert.equal(again.ok, false);
    // another player, with the right watch id, is not accepted
    const forged = await s.call('POST', '/api/watch/frame', { token: other.token, body: { sid: w.sid, e: w.e, n: 99, d: ev.d } });
    assert.equal(forged.ok, false);
    assert.equal((await s.call('POST', '/api/watch/hello', { token: other.token, body: { sid: w.sid, pub: (await WC.newPair()).pub } })).status, 404);
    // a frame that is not sealed text, or too big, is refused before it goes on
    assert.equal((await s.call('POST', '/api/watch/frame', { token: p.token, body: { sid: w.sid, e: w.e, n: 50, d: '<script>alert(1)</script>' } })).ok, false);
    assert.equal((await s.call('POST', '/api/watch/frame', { token: p.token, body: { sid: w.sid, e: w.e, n: 51, d: 'A'.repeat(6001) } })).ok, false);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(ol.events.filter((e) => e.name === 'watchframe').length, before, 'none of those reached the operator');

    // a frame altered on the way does not open
    const sealed = await WC.seal(w.pkey, w.sid, w.e, 7, state);
    const flipped = sealed.slice(0, 10) + (sealed[10] === 'A' ? 'B' : 'A') + sealed.slice(11);
    await assert.rejects(WC.open(w.key, w.sid, w.e, 7, flipped));
    // …nor one opened as if it belonged to another counter or watch
    await assert.rejects(WC.open(w.key, w.sid, w.e, 8, sealed));
    await assert.rejects(WC.open(w.key, 'x'.repeat(22), w.e, 7, sealed));

    // while it runs the operator is told what it costs: at once for the first frame, then a second at a time
    const first = await ol.waitFor('watchstat', (d) => d.sid === w.sid);
    assert.ok(first.bytes > 0 && first.perSec > 0 && first.frames >= 1, JSON.stringify(first));
    await new Promise((r) => setTimeout(r, 1050));
    await w.send(state);
    const stat = await ol.waitFor('watchstat', (d) => d.sid === w.sid && d.frames >= 2);
    assert.ok(stat.bytes > first.bytes && stat.perSec > 0, JSON.stringify(stat));
    assert.ok(stat.total >= stat.bytes);

    // it goes one way only: the operator's page can ask the player's game for nothing but a display setting
    const allowed = new Set(['sid', 'on', 'q', 'fps', 'pub']);
    for (const e of pl.events.filter((x) => x.name === 'view')) for (const k of Object.keys(e.data)) assert.ok(allowed.has(k), 'view carries ' + k);
    const q2 = await s.call('POST', '/api/ops/watch/quality', { token: taku.token, body: { sid: w.sid, quality: 240, fps: 20 } });
    assert.deepEqual([q2.quality, q2.fps], [240, 20]);
    const upd = await pl.waitFor('view', (d) => d.on && d.sid === w.sid && d.q === 240);
    assert.equal(upd.fps, 20);
    assert.equal(upd.pub, undefined, 'a quality change carries no key');

    // stopping: the player's game is told to stop, the record is complete
    const stopped = await s.call('POST', '/api/ops/watch/stop', { token: taku.token, body: { sid: w.sid } });
    assert.equal(stopped.stopped, true);
    await pl.waitFor('view', (d) => d.sid === w.sid && d.on === false);
    await ol.waitFor('watchend', (d) => d.sid === w.sid && d.reason === 'operator');
    assert.equal((await s.call('POST', '/api/watch/frame', { token: p.token, body: { sid: w.sid, e: w.e, n: 100, d: ev.d } })).ok, false, 'no frame after the end');

    const row = s.app.db.prepare('SELECT * FROM ops_watch_log').get();
    assert.equal(row.op_id, taku.me.id);
    assert.equal(row.player_id, p.me.id);
    assert.ok(row.ended_at >= row.started_at && row.bytes > 0 && row.frames >= 2);
    assert.equal(row.reason, 'operator');
    const usage = s.app.db.prepare('SELECT * FROM ops_watch_usage WHERE op_id = ?').get(taku.me.id);
    assert.equal(usage.bytes, row.bytes);
    assert.equal(usage.watches, 1);

    // the operators' log: who, whom, and the whole of it (in the security kind)
    const log = (await s.call('GET', '/api/ops/log?kind=security', { token: taku.token })).entries.filter((e) => e.action.startsWith('watch_'));
    assert.deepEqual(log.map((e) => e.action).sort(), ['watch_end', 'watch_start']);
    const end = log.find((e) => e.action === 'watch_end');
    assert.match(end.summary, /TAKUが見られる人さんの画面を/);
    assert.equal(end.detail.operator.name, 'TAKU');
    assert.equal(end.detail.player.name, '見られる人');
    assert.equal(end.detail.bytes, row.bytes);
    assert.equal(end.detail.operatorTotals.bytes, row.bytes);
    assert.equal(end.detail.quality, '240P・20fps');
    assert.equal(end.detail.forced, false);
    const hist = await s.call('GET', '/api/ops/watch/log', { token: taku.token });
    assert.equal(hist.watches[0].operator, 'TAKU');
    assert.equal(hist.watches[0].player, '見られる人');
    assert.equal(hist.watches[0].bytes, row.bytes);

    // the totals carry over to the next watch
    const st = await s.call('GET', '/api/ops/watch/state', { token: taku.token });
    assert.equal(st.session, null);
    assert.equal(st.totals.bytes, row.bytes);
    pl.close();
    ol.close();
  } finally {
    await s.stop();
  }
});

test('a watch is refused for the wrong player, the wrong settings, the wrong person', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2', 'mod3'], limits: LIMITS });
  try {
    const taku = await s.register('TAKU');
    const mod1 = await s.register('mod1');
    const mod2 = await s.register('mod2');
    const p = await s.register('ふつう');
    const p2 = await s.register('ふつう2');
    const p3 = await s.register('ふつう3');
    const p4 = await s.register('ふつう4');
    const pub = (await WC.newPair()).pub;
    const start = (op, body) => s.call('POST', '/api/ops/watch/start', { token: op.token, body: { quality: 360, fps: 10, pub, ...body } });

    // a player is no operator
    assert.equal((await start(p, { player: p2.me.id })).error.code, 'not_operator');
    // …a viewer-only session does not get this either
    // the player must be online
    assert.equal((await start(mod1, { player: p.me.id })).error.code, 'offline');
    const pl = await s.listen(p), pl2 = await s.listen(p2), pl3 = await s.listen(p3), pl4 = await s.listen(p4);
    const ol = await openOps(s, mod1);
    const ol2 = await openOps(s, mod2);
    const olT = await openOps(s, taku);
    assert.equal((await start(mod1, { player: p.me.id, quality: 720 })).error.code, 'bad_quality');
    assert.equal((await start(mod1, { player: p.me.id, fps: 60 })).error.code, 'bad_fps');
    assert.equal((await start(mod1, { player: p.me.id, pub: 'nope' })).error.code, 'bad_key');
    assert.equal((await start(mod1, { player: mod1.me.id })).error.code, 'self');
    assert.equal((await start(mod1, { player: 999999 })).error.code, 'not_found');
    // the developer is not for an operator to watch
    await s.listen(taku);
    assert.equal((await start(mod1, { player: taku.me.id })).error.code, 'developer');

    // one watch at a time for a player, one for an operator (the new one replaces the old)
    const a = await start(mod1, { player: p.me.id });
    assert.equal(a.status, 200, JSON.stringify(a));
    assert.equal((await start(mod2, { player: p.me.id })).error.code, 'busy');
    const b = await start(mod1, { player: p2.me.id });
    assert.equal(b.status, 200);
    await ol.waitFor('watchend', (d) => d.sid === a.sid && d.reason === 'replaced');
    await pl.waitFor('view', (d) => d.sid === a.sid && d.on === false);
    // …three at once at most
    assert.equal((await start(mod2, { player: p3.me.id })).status, 200);
    assert.equal((await start(taku, { player: p4.me.id })).status, 200);
    const fifth = await s.register('ふつう5');
    await s.listen(fifth);
    const mod3 = await s.register('mod3');
    await openOps(s, mod3);
    assert.equal((await start(mod3, { player: fifth.me.id })).error.code, 'too_many');
    // somebody else's watch cannot be steered, stopped or messaged
    assert.equal((await s.call('POST', '/api/ops/watch/stop', { token: mod2.token, body: { sid: b.sid } })).error.code, 'not_watching');
    assert.equal((await s.call('POST', '/api/ops/watch/quality', { token: mod2.token, body: { sid: b.sid, quality: 240 } })).error.code, 'not_watching');
    assert.equal((await s.call('POST', '/api/ops/watch/message', { token: mod2.token, body: { sid: b.sid, preset: 'thanks' } })).error.code, 'not_watching');
    [pl, pl2, pl3, pl4, ol, ol2, olT].forEach((l) => l.close());
  } finally {
    await s.stop();
  }
});

test('the 300 kbps ceiling: frames over it are dropped, not sent', async () => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  try {
    const taku = await s.register('TAKU');
    const p = await s.register('帯域の人');
    const pl = await s.listen(p), ol = await openOps(s, taku);
    const w = await begin(s, taku, ol, p, pl);
    // ~3 KB frames, far faster than 37,500 bytes a second
    const big = { v: 1, s: 'slot', pad: 'x'.repeat(2000) };
    let sent = 0, dropped = 0;
    for (let i = 0; i < 60; i++) {
      const { out } = await w.send(big);
      if (out.dropped) dropped++; else if (out.ok) sent++;
    }
    assert.ok(dropped > 20, `dropped ${dropped}`);
    // the burst allowed is two seconds of the ceiling
    assert.ok(sent * 2800 <= 37500 * 2 + 2800 * 2, `sent ${sent} frames`);
    const row = s.app.db.prepare('SELECT COUNT(*) AS n FROM ops_watch_log').get();
    assert.equal(row.n, 1);
    await s.call('POST', '/api/ops/watch/stop', { token: taku.token, body: { sid: w.sid } });
    const end = (await s.call('GET', '/api/ops/log?kind=security', { token: taku.token })).entries.find((e) => e.action === 'watch_end');
    assert.equal(end.detail.droppedFrames, dropped);
    assert.ok(end.detail.bytes <= 37500 * 3, `bytes ${end.detail.bytes}`);
    pl.close();
    ol.close();
  } finally {
    await s.stop();
  }
});

test('a watch lasts 30 minutes at most', async () => {
  let now = Date.now();
  const s = await startServer({ operators: ['taku'], limits: LIMITS, clock: () => now });
  try {
    const taku = await s.register('TAKU');
    const p = await s.register('長い人');
    const pl = await s.listen(p), ol = await openOps(s, taku);
    const w = await begin(s, taku, ol, p, pl);
    assert.equal((await w.send({ v: 1 })).out.ok, true);
    now += 29 * 60000;
    assert.equal((await w.send({ v: 1 })).out.ok, true, 'still going at 29 minutes');
    now += 61000;
    // the next frame finds the time up
    assert.equal((await w.send({ v: 1 })).out.ok, false);
    const ended = await ol.waitFor('watchend', (d) => d.sid === w.sid);
    assert.equal(ended.reason, 'max');
    assert.match(ended.text, /最大の監視時間/);
    await pl.waitFor('view', (d) => d.sid === w.sid && d.on === false);
    const end = (await s.call('GET', '/api/ops/log?kind=security', { token: taku.token })).entries.find((e) => e.action === 'watch_end');
    assert.equal(end.detail.reason, 'max');
    assert.ok(end.detail.ms <= 30 * 60000);
    pl.close();
    ol.close();
  } finally {
    await s.stop();
  }
});

test('an emergency ends every watch at once, reports it to Discord and leaves it in the log', async () => {
  const sent = [];
  const s = await startServer({
    operators: ['taku'], limits: LIMITS, publicUrl: 'https://game.example.test',
    discordWebhook: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789'
  });
  try {
    // (Discord's answer is faked: the message is only looked at)
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, o) => {
      if (String(url).startsWith('https://discord.com/')) { sent.push(JSON.parse(o.body)); return { ok: true }; }
      return realFetch(url, o);
    };
    try {
      const taku = await s.register('TAKU');
      const p = await s.register('巻き込まれる人');
      const pl = await s.listen(p), ol = await openOps(s, taku);
      const w = await begin(s, taku, ol, p, pl);
      assert.equal((await w.send({ v: 1 })).out.ok, true);

      // the lockdown (an operator raises it from the security base)
      assert.equal((await s.call('POST', '/api/sec/lockdown', { token: taku.token, body: { reason: '点検' } })).locked, true);
      const ended = await ol.waitFor('watchend', (d) => d.sid === w.sid);
      assert.equal(ended.reason, 'lockdown');
      await pl.waitFor('view', (d) => d.sid === w.sid && d.on === false);
      assert.equal(s.app.db.prepare('SELECT reason FROM ops_watch_log').get().reason, 'lockdown');

      // …the log says it was forced, and Discord gets it as a danger with both links
      const login = await s.call('POST', '/api/ops/login', { body: { name: 'TAKU', password: 'pass1234' }, headers: { 'X-Ops-Device': 'browser-aaaaaaaaaaaaaaaa' } });
      const entries = (await s.call('GET', '/api/sec/log', { token: login.token })).entries;
      const forced = entries.find((e) => e.action === 'watch_force_end');
      assert.ok(forced, entries.map((e) => e.action).join(','));
      assert.equal(forced.detail.forced, true);
      assert.equal(forced.detail.reason, 'lockdown');
      await new Promise((r) => setTimeout(r, 2300));
      const text = sent.map((m) => m.content).join('\n');
      assert.match(text, /【危険】画面を見る機能を緊急事案で強制終了しました/);
      assert.match(text, /見ていた人：TAKU/);
      assert.match(text, /見られていたプレイヤー：巻き込まれる人/);
      assert.match(text, /\/ops\/>/);
      assert.match(text, /\/sec\/>/);
      // after the lockdown, no new watch
      pl.close();
      ol.close();
    } finally {
      globalThis.fetch = realFetch;
    }
  } finally {
    await s.stop();
  }
});

test('a watch also ends when the player is punished, the operator loses the rights, or the server restarts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-watch-'));
  try {
    const s = await startServer({ operators: ['taku', 'mod1'], limits: LIMITS, dataDir: dir });
    const taku = await s.register('TAKU');
    const mod1 = await s.register('mod1');
    const p = await s.register('処分される人');
    const p2 = await s.register('権限が消える側');
    const pl = await s.listen(p), pl2 = await s.listen(p2);
    const ol = await openOps(s, taku), ol1 = await openOps(s, mod1);
    const a = await begin(s, taku, ol, p, pl);
    // a ban ends it at the next look (within a couple of seconds)
    assert.equal((await s.call('POST', '/api/ops/ban', { token: taku.token, body: { id: p.me.id, kind: 'suspend' } })).status, 200);
    assert.equal((await ol.waitFor('watchend', (d) => d.sid === a.sid, 6000)).reason, 'player_gone');

    // an operator whose rights are taken away
    const b = await begin(s, mod1, ol1, p2, pl2);
    s.app.db.prepare("INSERT INTO ops_access (name_key, granted, by_id, at) VALUES ('mod1', 0, 1, 1) ON CONFLICT(name_key) DO UPDATE SET granted = 0").run();
    assert.equal((await ol1.waitFor('watchend', (d) => d.sid === b.sid, 6000)).reason, 'rights');
    s.app.db.prepare("UPDATE ops_access SET granted = 1 WHERE name_key = 'mod1'").run();
    const forced = (await s.call('GET', '/api/ops/log?kind=security', { token: taku.token })).entries.filter((e) => e.action === 'watch_force_end');
    assert.equal(forced.length, 1, 'losing the rights is a forced end');
    assert.equal(forced[0].detail.reason, 'rights');

    // a watch still open when the server goes away is closed, and written down, at the next start
    const c = await begin(s, mod1, ol1, p2, pl2);
    const open = s.app.db.prepare('SELECT * FROM ops_watch_log ORDER BY id DESC LIMIT 1').get();
    assert.equal(open.ended_at, 0);
    await c.send({ v: 1 });
    pl.close(); pl2.close(); ol.close(); ol1.close();
    await s.stop();

    const s2 = await startServer({ operators: ['taku', 'mod1'], limits: LIMITS, dataDir: dir });
    try {
      const row = s2.app.db.prepare('SELECT * FROM ops_watch_log WHERE id = ?').get(open.id);
      assert.ok(row.ended_at > 0, 'closed');
      assert.equal(row.reason, 'restart');
      assert.ok(row.ms <= 30 * 60000);
      const entries = s2.app.db.prepare("SELECT action, summary FROM ops_log WHERE action LIKE 'watch_%' ORDER BY id").all();
      assert.ok(entries.some((e) => e.action === 'watch_end' && /再起動/.test(e.summary)), JSON.stringify(entries));
      assert.equal(s2.app.db.prepare('SELECT COUNT(*) AS n FROM ops_watch_log WHERE ended_at = 0').get().n, 0);
    } finally {
      await s2.stop();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('while watching: a short message from Ice Smoker公式, and ★ favourites', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'], limits: LIMITS });
  try {
    const taku = await s.register('TAKU');
    const mod1 = await s.register('mod1');
    const p = await s.register('メッセージの人');
    const pl = await s.listen(p), ol = await openOps(s, mod1);
    const w = await begin(s, mod1, ol, p, pl);
    const msg = (body, op = mod1) => s.call('POST', '/api/ops/watch/message', { token: op.token, body: { sid: w.sid, ...body } });
    const last = () => s.app.db.prepare('SELECT body FROM messages WHERE recipient_id = ? ORDER BY id DESC LIMIT 1').get(p.me.id);

    assert.equal((await msg({ preset: 'cheat' })).sent, true);
    assert.match(last().body, /^【運営からのお知らせ】\n\nメッセージの人様\n\n不正行為の疑いがあるため/);
    assert.match(last().body, /Ice Smoker公式より$/);
    assert.equal((await msg({ text: '少しお話を聞かせてください' })).sent, true);
    assert.match(last().body, /少しお話を聞かせてください/);
    assert.equal((await msg({ preset: 'nope' })).error.code, 'bad_preset');
    assert.equal((await msg({ text: '' })).error.code, 'empty');
    assert.equal((await msg({ text: 'あ'.repeat(201) })).error.code, 'too_long');
    // another operator cannot use this watch
    assert.equal((await msg({ preset: 'thanks' }, taku)).error.code, 'not_watching');
    // it is in the log, tied to the watch
    const sent = (await s.call('GET', '/api/ops/log', { token: taku.token })).entries.filter((e) => e.action === 'bot_message');
    assert.equal(sent.length, 2);
    assert.ok(sent.every((e) => e.detail.watchId > 0 && /画面確認中/.test(e.summary)));
    // what the player's game was sent: nothing to show for it besides the chat message itself
    assert.equal(pl.events.filter((e) => e.name === 'view' && e.data.text).length, 0);

    // ★: each operator's own
    const fav = (op, body) => s.call('POST', '/api/ops/favorite', { token: op.token, body });
    assert.deepEqual((await fav(mod1, { player: p.me.id, on: true })).favorites, [p.me.id]);
    assert.deepEqual((await s.call('GET', '/api/ops/players', { token: mod1.token })).favorites, [p.me.id]);
    assert.deepEqual((await s.call('GET', '/api/ops/players', { token: taku.token })).favorites, [], 'not shared');
    assert.deepEqual((await fav(mod1, { player: p.me.id, on: false })).favorites, []);
    assert.equal((await fav(mod1, { player: 987654 })).error.code, 'not_found');
    assert.equal((await fav(p, { player: p.me.id })).error.code, 'not_operator');
    pl.close();
    ol.close();
  } finally {
    await s.stop();
  }
});
