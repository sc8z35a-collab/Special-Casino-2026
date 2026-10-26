// The operator site's poll: the players' list asked for with `since` (it is answered with what changed, not the whole list again) and the
// poll in one request (GET /api/ops/tick: the tabs' numbers, DEV UNIT's, the payments', the team's and the list, each with a rev so that a part
// that is the same is answered so). server/core/ops.js, server/core/api.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';
import { GATED } from '../core/pk.js';

const CODE = '987654321098';
const BIG = [1e6, 1e4];

async function site(overrides = {}) {
  const s = await startServer({ operators: ['taku', 'mod1'], limits: { general: BIG, login: BIG }, ...overrides });
  const taku = await s.register('TAKU');
  const mod = await s.register('Mod1');
  return { s, taku, mod };
}
const players = (s, who, qs = '') => s.call('GET', '/api/ops/players' + (qs ? '?' + qs : ''), { token: who.token });
const tick = (s, who, qs = '') => s.call('GET', '/api/ops/tick' + (qs ? '?' + qs : ''), { token: who.token });
const names = (r) => r.players.map((p) => p.name).sort();

test('the players\' list with `since`: the whole of it the first time, then only what changed and who is gone', async () => {
  const { s, taku } = await site();
  try {
    const alice = await s.register('Alice');
    const bob = await s.register('Bob');
    const db = s.app.db;

    // without `since` it answers as it always did (the tabs' numbers with it)
    const plain = await players(s, taku);
    assert.equal(plain.status, 200);
    assert.deepEqual(names(plain), ['Alice', 'Bob', 'Mod1', 'TAKU']);
    for (const k of ['total', 'archived', 'online', 'waiting', 'reports', 'detections', 'feedback', 'vaultRequests', 'speed', 'now', 'favorites']) assert.ok(k in plain, k);
    for (const k of ['token', 'full', 'delta', 'gone']) assert.equal(k in plain, false, k);
    assert.equal(plain.total, 4);

    // the first time (nothing in hand): all of it, and a token for the next
    const first = await players(s, taku, 'since=');
    assert.equal(first.full, true);
    assert.deepEqual(names(first), ['Alice', 'Bob', 'Mod1', 'TAKU']);
    assert.match(first.token, /^[0-9a-z]+\.\d+$/);

    // nothing changed: an empty delta (and a token for the next)
    const quiet = await players(s, taku, 'since=' + first.token);
    assert.equal(quiet.delta, true);
    assert.deepEqual([quiet.players, quiet.gone], [[], []]);
    assert.notEqual(quiet.token, first.token);

    // one player's row changed: that player alone
    db.prepare('UPDATE users SET coins = coins + 5 WHERE id = ?').run(alice.me.id);
    const one = await players(s, taku, 'since=' + quiet.token);
    assert.deepEqual(names(one), ['Alice']);
    assert.equal(one.players[0].coins, plain.players.find((p) => p.name === 'Alice').coins + 5);
    assert.deepEqual(one.gone, []);

    // a new player is in it; one archived is gone
    const carol = await s.register('Carol');
    db.prepare("UPDATE users SET archived_at = 1, archive_reason = 'perma' WHERE id = ?").run(bob.me.id);
    const moved = await players(s, taku, 'since=' + one.token);
    assert.deepEqual(names(moved), ['Carol']);
    assert.deepEqual(moved.gone, [bob.me.id]);
    assert.equal(moved.players[0].id, carol.me.id);
    // (the figures are the whole list's)
    assert.equal(moved.total, 4);
    assert.equal(moved.archived, 1);

    // the token a page holds is good once: the same again is answered in full (and the page that held it is brought up to date)
    const again = await players(s, taku, 'since=' + one.token);
    assert.equal(again.full, true);
    assert.deepEqual(names(again), ['Alice', 'Carol', 'Mod1', 'TAKU']);
    // a token this server does not hold, or none: in full
    assert.equal((await players(s, taku, 'since=nonsense')).full, true);
    assert.equal((await players(s, taku, 'since=')).full, true);
  } finally {
    await s.stop();
  }
});

test('the players\' list with `since`: another search, another login and another operator each have their own', async () => {
  const { s, taku, mod } = await site();
  try {
    await s.register('Alice');
    await s.register('Alina');
    await s.register('Bob');
    const a = await players(s, taku, 'since=');
    // a search is another list: in full, and then its own changes
    const search = await players(s, taku, 'since=' + a.token + '&q=ali');
    assert.equal(search.full, true);
    assert.deepEqual(names(search), ['Alice', 'Alina']);
    const searchAgain = await players(s, taku, 'since=' + search.token + '&q=ali');
    assert.deepEqual([searchAgain.delta, searchAgain.players, searchAgain.gone], [true, [], []]);
    // (the search dropped: all of it again, not a delta against the search)
    const all = await players(s, taku, 'since=' + searchAgain.token);
    assert.equal(all.full, true);
    assert.equal(all.players.length, 5);

    // another login of the same operator holds another list: its token is no use to the first, and the first's no use to it
    const second = await s.call('POST', '/api/login', { body: { name: 'TAKU', password: PASSWORD } });
    assert.equal(second.status, 200);
    const mine = await players(s, taku, 'since=');
    const theirs = await players(s, second, 'since=');
    assert.equal(theirs.full, true);
    assert.equal((await players(s, second, 'since=' + theirs.token)).delta, true);
    assert.equal((await players(s, taku, 'since=' + mine.token)).delta, true);
    assert.equal((await players(s, taku, 'since=' + theirs.token)).full, true, 'the other login\'s token');

    // another operator
    const m = await players(s, mod, 'since=');
    assert.equal(m.full, true);
    assert.equal((await players(s, mod, 'since=' + m.token)).delta, true);
    assert.equal((await players(s, mod, 'since=' + mine.token)).full, true);
  } finally {
    await s.stop();
  }
});

test('the players\' list: lean=1 leaves out the tabs\' numbers (the poll brings them), and a player may not ask', async () => {
  const { s, taku } = await site();
  try {
    const p = await s.register('Alice');
    const lean = await players(s, taku, 'since=&lean=1');
    assert.equal(lean.full, true);
    for (const k of ['total', 'online', 'waiting', 'now', 'favorites']) assert.ok(k in lean, k);
    for (const k of ['archived', 'reports', 'detections', 'feedback', 'vaultRequests', 'speed']) assert.equal(k in lean, false, k);
    for (const path of ['/api/ops/players?since=', '/api/ops/tick']) {
      const r = await s.call('GET', path, { token: p.token });
      assert.equal(r.status, 403, path);
      assert.equal(r.error.code, 'not_operator', path);
    }
    assert.equal((await s.call('GET', '/api/ops/tick')).status, 401);
  } finally {
    await s.stop();
  }
});

test('the poll in one request: the tabs\' numbers, DEV UNIT, the payments (the developer\'s) and the team, each with a rev', async () => {
  const { s, taku, mod } = await site();
  try {
    const d = await tick(s, taku);
    assert.equal(d.status, 200, JSON.stringify(d).slice(0, 300));
    assert.equal(typeof d.now, 'number');
    // each part is its own route's answer
    const counts = await s.call('GET', '/api/ops/counts', { token: taku.token });
    for (const k of ['reports', 'detections', 'feedback', 'speed']) assert.deepEqual(d.counts[k], counts[k], k);
    assert.equal(d.counts.usage.tier, counts.usage.tier);
    assert.equal(d.counts.archived, 0);
    assert.equal(d.counts.vaultRequests, 0);
    const unread = await s.call('GET', '/api/ops/devunit/counts', { token: taku.token });
    assert.deepEqual([d.devunit.latest, d.devunit.unread], [unread.latest, unread.unread]);
    const team = await s.call('GET', '/api/ops/team', { token: taku.token });
    assert.deepEqual(d.team.operators.map((o) => o.id), team.operators.map((o) => o.id));
    assert.equal(d.team.me, taku.me.id);
    // (the developer's: the payments, whole the first time, with the number waiting)
    assert.deepEqual(Object.keys(d.pay).sort(), ['count', 'meters', 'now', 'orders', 'rev', 'setup', 'totals', 'waiting']);
    assert.equal(d.pay.count, 0);
    for (const k of ['counts', 'devunit', 'pay', 'team']) assert.match(d[k].rev, /^[0-9a-z]+$/, k);
    // no list unless it is asked for
    assert.equal('players' in d, false);

    // an operator who is not the developer has no payments
    const m = await tick(s, mod);
    assert.equal(m.status, 200);
    assert.equal('pay' in m, false);
    assert.deepEqual(['counts', 'devunit', 'team'].map((k) => k in m), [true, true, true]);
    assert.equal(m.team.me, mod.me.id);
  } finally {
    await s.stop();
  }
});

test('the poll: a part the page already has is answered `same`, and a part that changed comes whole with a new rev', async () => {
  const { s, taku, mod } = await site();
  try {
    const first = await tick(s, taku);
    const have = `c=${first.counts.rev}&d=${first.devunit.rev}&p=${first.pay.rev}&t=${first.team.rev}`;
    const next = await tick(s, taku, have);
    assert.deepEqual(next.counts, { same: true, rev: first.counts.rev });
    assert.deepEqual(next.devunit, { same: true, rev: first.devunit.rev });
    assert.deepEqual(next.pay, { same: true, rev: first.pay.rev, count: 0 });
    assert.deepEqual(next.team, { same: true, rev: first.team.rev });
    // (a reply that was not the rev of the part is not "the same")
    const wrong = await tick(s, taku, `c=${first.devunit.rev}&d=&p=x&t=`);
    for (const k of ['counts', 'devunit', 'pay', 'team']) assert.equal('same' in wrong[k], false, k);

    // a report comes in: the counts change (and only they)
    const alice = await s.register('Alice');
    const bob = await s.register('Bob');
    const sent = await s.call('POST', '/api/report', { token: alice.token, body: { user: bob.me.id, kind: 'abuse', text: '暴言を言われました', place: 'search' } });
    assert.equal(sent.status, 200, JSON.stringify(sent));
    const changed = await tick(s, taku, have);
    assert.equal(changed.counts.same, undefined);
    assert.equal(changed.counts.reports, 1);
    assert.notEqual(changed.counts.rev, first.counts.rev);
    assert.equal(changed.devunit.same, true);
    assert.equal(changed.pay.same, true);
    // and with the new rev it is the same again
    assert.equal((await tick(s, taku, `c=${changed.counts.rev}`)).counts.same, true);

    // a comment from another operator: DEV UNIT's unread changes
    const posted = await s.call('POST', '/api/ops/devunit/comments', { token: mod.token, body: { text: 'こんにちは' } });
    assert.equal(posted.status, 200);
    const comment = await tick(s, taku, have);
    assert.deepEqual([comment.devunit.unread, comment.devunit.latest], [1, 1]);
    assert.equal(comment.counts.same, undefined, 'the counts rev was not asked with this one: the have of before');
  } finally {
    await s.stop();
  }
});

test('the poll: what changes with every look is not part of a rev (the time, who is on the site and when they were last seen)', async () => {
  const { s, taku, mod } = await site();
  try {
    // both are on the site now (an operator's request is the site's sign of life)
    await tick(s, mod);
    const a = await tick(s, taku);
    await new Promise((r) => setTimeout(r, 20));
    await tick(s, mod);
    await new Promise((r) => setTimeout(r, 20));
    const b = await tick(s, taku, `t=${a.team.rev}&c=${a.counts.rev}`);
    const modRow = (r) => r.operators.find((o) => o.name === 'Mod1');
    assert.equal(modRow(a.team).site, true);
    assert.deepEqual(b.team, { same: true, rev: a.team.rev }, 'mod\'s "last seen" moved, and the page is told nothing');
    assert.equal(b.counts.same, true);
  } finally {
    await s.stop();
  }
});

test('the poll: the payments come whole only when asked (p=<rev>), the number waiting otherwise (p=-); the team is left out with t=-', async () => {
  const { s, taku } = await site();
  try {
    const light = await tick(s, taku, 'p=-&t=-');
    assert.deepEqual(light.pay, { count: 0 });
    assert.equal('team' in light, false);
    // a player waiting for the developer's words: the number is there without the payments' whole
    const buyer = await s.register('Buyer');
    const now = Date.now();
    s.app.db.prepare("INSERT INTO pay_orders (id, user_id, plan, qty, amount, coins, method, status, created_at, updated_at, paid_at, session_id) VALUES ('o1', ?, 'support3', 1, 30, 34, 'card', 'paid', ?, ?, ?, 'cs_1')")
      .run(buyer.me.id, now, now, now);
    const waiting = await tick(s, taku, 'p=-');
    assert.deepEqual(waiting.pay, { count: 1 });
    const whole = await tick(s, taku, '');
    assert.equal(whole.pay.count, 1);
    assert.equal(whole.pay.waiting.length, 1);
    assert.equal(whole.pay.waiting[0].player.id, buyer.me.id);
  } finally {
    await s.stop();
  }
});

test('the poll: the players\' list comes along only when asked (pl), as what changed, and with the tabs\' numbers only in the counts', async () => {
  const { s, taku } = await site();
  try {
    const alice = await s.register('Alice');
    const first = await tick(s, taku, 'pl=');
    assert.equal(first.players.full, true);
    assert.deepEqual(names(first.players), ['Alice', 'Mod1', 'TAKU']);
    for (const k of ['total', 'online', 'waiting', 'favorites']) assert.ok(k in first.players, k);
    for (const k of ['archived', 'reports', 'detections', 'feedback', 'vaultRequests', 'speed']) assert.equal(k in first.players, false, k);
    const quiet = await tick(s, taku, 'pl=' + first.players.token);
    assert.deepEqual([quiet.players.delta, quiet.players.players, quiet.players.gone], [true, [], []]);
    s.app.db.prepare('UPDATE users SET coins = coins + 1 WHERE id = ?').run(alice.me.id);
    const one = await tick(s, taku, 'pl=' + quiet.players.token);
    assert.deepEqual(names(one.players), ['Alice']);
    // a search goes along (another list: in full)
    const found = await tick(s, taku, 'pl=' + one.players.token + '&q=ali');
    assert.equal(found.players.full, true);
    assert.deepEqual(names(found.players), ['Alice']);
    // the tick and the list route share the page's token
    const route = await players(s, taku, 'since=' + found.players.token + '&q=ali');
    assert.equal(route.delta, true);
  } finally {
    await s.stop();
  }
});

test('the poll: a viewer\'s session is refused by the allowlist (it keeps its own counts), and the passkey gate covers it like any operator route', async () => {
  assert.ok(GATED.test('/api/ops/tick'));
  const { s, taku } = await site();
  try {
    assert.equal((await s.call('POST', '/api/ops/dev-code', { token: taku.token, body: { code: CODE } })).devCodeSet, true);
    const watcher = await s.register('Watcher');
    const g = await s.call('POST', '/api/ops/viewer', { token: taku.token, body: { name: 'Watcher', action: 'grant', code: CODE } });
    assert.deepEqual(g.viewers.map((v) => v.name), ['Watcher']);
    const login = await s.call('POST', '/api/ops/login', { body: { name: 'Watcher', password: PASSWORD }, headers: { 'X-Ops-Device': 'browser-vvvvvvvvvvvvvvvv' } });
    assert.deepEqual([login.status, login.viewer], [200, true]);
    const r = await s.call('GET', '/api/ops/tick', { token: login.token });
    assert.deepEqual([r.status, r.error.code], [403, 'viewer']);
    assert.equal((await s.call('GET', '/api/ops/counts', { token: login.token })).status, 200);
    assert.equal(watcher.me.name, 'Watcher');
  } finally {
    await s.stop();
  }
});

test('the サーバー tab: the five-minute history is sent again only from where the page has it (hs), whole or lean', async () => {
  const { s, taku } = await site();
  try {
    const get = (qs = '') => s.call('GET', '/api/ops/server' + (qs ? '?' + qs : ''), { token: taku.token });
    for (const lean of ['', 'lean=1&']) {
      const whole = await get(lean.replace(/&$/, ''));
      assert.equal(whole.status, 200);
      assert.equal(whole.rate.history.length, 300, lean + 'the whole of it');
      assert.equal(whole.rate.delta, undefined);
      const last = whole.rate.history[whole.rate.history.length - 1][0];
      // from the second before the newest: that one (it was still counting) and what came after
      const next = await get(lean + 'hs=' + (last - 1));
      assert.equal(next.rate.delta, true, lean + 'a delta');
      assert.ok(next.rate.history.length >= 1 && next.rate.history.length <= 5, String(next.rate.history.length));
      assert.ok(next.rate.history.every((x) => x[0] > last - 1));
      assert.equal(next.rate.history[0][0], last, 'the newest the page had comes again');
      // (the figures of the last seconds are the server\'s, not the history\'s)
      assert.ok('last10' in next.rate && 'last60' in next.rate);
      // a page that was away longer than the history is long gets all of it, in order
      const away = await get(lean + 'hs=' + (last - 1000));
      assert.equal(away.rate.history.length, 300);
      assert.equal(away.rate.delta, true);
      // nonsense asks for the whole of it
      for (const hs of ['x', '', 'NaN']) assert.equal((await get(lean + 'hs=' + hs)).rate.history.length, 300, `hs=${hs}`);
    }
    // the answer without the history is smaller by most of it
    const whole = JSON.stringify(await get()).length;
    const last = (await get()).rate.history.slice(-1)[0][0];
    const next = JSON.stringify(await get('hs=' + (last - 1))).length;
    assert.ok(next < whole * 0.5, `${next} of ${whole}`);
  } finally {
    await s.stop();
  }
});

test('GET /api/emergency?lean=1: the thresholds without the 緊急 entries (the サーバー tab draws only those), the developer\'s alone', async () => {
  const { s, taku, mod } = await site();
  try {
    const whole = await s.call('GET', '/api/emergency', { token: taku.token });
    assert.equal(whole.status, 200);
    assert.ok(Array.isArray(whole.entries));
    const lean = await s.call('GET', '/api/emergency?lean=1', { token: taku.token });
    assert.equal(lean.status, 200);
    assert.equal('entries' in lean, false);
    for (const k of ['stopped', 'floors', 'usual', 'factor', 'now']) assert.deepEqual(lean[k] === undefined, false, k);
    assert.deepEqual(lean.floors, whole.floors);
    assert.equal((await s.call('GET', '/api/emergency?lean=1', { token: mod.token })).error.code, 'not_developer');
  } finally {
    await s.stop();
  }
});

// the operator site's own live connection (server/node/live.js: attachOps)
async function opsListen(s, who) {
  const { ticket } = await s.call('POST', '/api/ops/live-ticket', { token: who.token });
  const events = [];
  let wake = null;
  const http = await import('node:http');
  const req = await new Promise((resolve, reject) => {
    const r = http.get(`${s.base}/api/stream?ops=${encodeURIComponent(ticket)}`, (res) => {
      if (res.statusCode !== 200) { reject(new Error('status ' + res.statusCode)); return; }
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
  const chats = () => events.filter((e) => e.name === 'opschat').map((e) => e.data);
  return { events, waitFor, chats, close: () => req.destroy() };
}
const settle = () => new Promise((r) => setTimeout(r, 150));

test('運営チャット: a message or a read is told to the others over the site\'s live connection (opschat), so the tab need not ask on a timer', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'], limits: { general: BIG, login: BIG } });
  const live = [];
  try {
    const taku = await s.register('TAKU'), m1 = await s.register('Mod1'), m2 = await s.register('Mod2');
    const [lt, l1, l2] = [await opsListen(s, taku), await opsListen(s, m1), await opsListen(s, m2)];
    live.push(lt, l1, l2);
    for (const l of live) await l.waitFor('hello');

    // to everyone: all the others are told, not the one who wrote
    const all = await s.call('POST', '/api/ops/team/messages', { token: m1.token, body: { to: 0, text: 'みなさんこんにちは' } });
    assert.equal(all.status, 200);
    assert.deepEqual(await lt.waitFor('opschat'), { with: 0 });
    assert.deepEqual(await l2.waitFor('opschat'), { with: 0 });
    await settle();
    assert.deepEqual(l1.chats(), []);

    // one to one: the one written to is told which conversation, nobody else
    const dm = await s.call('POST', '/api/ops/team/messages', { token: m1.token, body: { to: taku.me.id, text: 'ちょっといいですか' } });
    assert.equal(dm.status, 200);
    assert.deepEqual(await lt.waitFor('opschat', (d) => d.with === m1.me.id), { with: m1.me.id });
    await settle();
    assert.equal(l2.chats().length, 1, 'only the first, the all-chat\'s');
    assert.deepEqual(l1.chats(), []);

    // read further: the writer is told (their 既読 moves); read again to the same point: nothing more
    const read = (upTo) => s.call('POST', '/api/ops/team/read', { token: taku.token, body: { with: m1.me.id, upTo } });
    assert.equal((await read(dm.message.id)).status, 200);
    assert.deepEqual(await l1.waitFor('opschat'), { with: taku.me.id });
    assert.equal((await read(dm.message.id)).status, 200);
    await settle();
    assert.equal(l1.chats().length, 1, 'a read that moves nothing tells nothing');
    // the all-chat read: no one is told (it has no 既読)
    assert.equal((await s.call('POST', '/api/ops/team/read', { token: taku.token, body: { with: 0, upTo: all.message.id } })).status, 200);
    await settle();
    assert.equal(l1.chats().length, 1);
    assert.equal(l2.chats().length, 1);

    // (the unread number is the poll's: the team part carries it)
    const t = await tick(s, taku);
    assert.equal(t.team.all.unread, 0);
  } finally {
    for (const l of live) l.close();
    await s.stop();
  }
});

test('the lists a tab asks for again and again (reports, detections, feedback) answer `same` while the page has them', async () => {
  const { s, taku } = await site();
  try {
    const alice = await s.register('Alice');
    const bob = await s.register('Bob');
    const get = (path, rev) => s.call('GET', path + (rev ? (path.includes('?') ? '&' : '?') + 'rev=' + rev : ''), { token: taku.token });
    for (const [path, list] of [['/api/ops/reports?status=open', 'reports'], ['/api/ops/detections', 'detections'], ['/api/ops/feedback', 'feedback']]) {
      const first = await get(path);
      assert.equal(first.status, 200, path);
      assert.ok(Array.isArray(first[list]), path);
      assert.match(first.rev, /^[0-9a-z]+$/, path);
      assert.deepEqual(await get(path, first.rev).then((r) => [r.same, r.rev, list in r]), [true, first.rev, false], path);
      // (a rev of something else is not "the same")
      assert.equal((await get(path, 'nonsense'))[list].length, first[list].length, path);
    }
    // a report comes in: the reports change, the others do not
    const before = await get('/api/ops/reports?status=open');
    const det0 = await get('/api/ops/detections');
    const sent = await s.call('POST', '/api/report', { token: alice.token, body: { user: bob.me.id, kind: 'abuse', text: '暴言を言われました', place: 'search' } });
    assert.equal(sent.status, 200);
    const after = await get('/api/ops/reports?status=open', before.rev);
    assert.equal(after.same, undefined);
    assert.equal(after.reports.length, 1);
    assert.notEqual(after.rev, before.rev);
    assert.equal((await get('/api/ops/reports?status=open', after.rev)).same, true);
    assert.equal((await get('/api/ops/detections', det0.rev)).same, true);
    // the other list of the same route has its own rev
    const done = await get('/api/ops/reports?status=done');
    assert.notEqual(done.rev, after.rev);
    // handled: the open list changes again
    const handled = await s.call('POST', '/api/ops/report', { token: taku.token, body: { id: after.reports[0].id, action: 'reject' } });
    assert.equal(handled.status, 200, JSON.stringify(handled));
    const gone = await get('/api/ops/reports?status=open', after.rev);
    assert.equal(gone.same, undefined);
    assert.equal(gone.reports.length, 0);
  } finally {
    await s.stop();
  }
});

test('the poll: a part that fails for a reason of its own is left out and the rest still comes', async () => {
  const { s, taku } = await site();
  const log = console.error;
  const said = [];
  console.error = (...a) => said.push(a.join(' '));
  try {
    s.app.db.exec('DROP TABLE devunit_reads');
    const r = await tick(s, taku, 'pl=');
    assert.equal(r.status, 200, JSON.stringify(r).slice(0, 200));
    assert.equal('devunit' in r, false, 'DEV UNIT\'s part is left out');
    for (const k of ['counts', 'pay', 'team', 'players']) assert.ok(k in r, k + ' still comes');
    assert.ok(said.some((m) => m.includes('devunit left out')), 'and the server says so: ' + said.join(' | '));
  } finally {
    console.error = log;
    await s.stop();
  }
});

test('the players\' list: two pages of one login each keep their own list, and each gets only what changed for it', async () => {
  const { s, taku } = await site();
  try {
    const alice = await s.register('Alice');
    const a1 = await players(s, taku, 'since=');
    const b1 = await players(s, taku, 'since=');
    assert.equal(a1.full && b1.full, true);
    assert.notEqual(a1.token.split('.')[0], b1.token.split('.')[0], 'each page has its own');
    s.app.db.prepare('UPDATE users SET coins = coins + 3 WHERE id = ?').run(alice.me.id);
    // taken alternately, every answer is a delta (they were whole every time when the login had one list)
    const a2 = await players(s, taku, 'since=' + a1.token);
    const b2 = await players(s, taku, 'since=' + b1.token);
    assert.deepEqual([a2.delta, names(a2)], [true, ['Alice']]);
    assert.deepEqual([b2.delta, names(b2)], [true, ['Alice']]);
    const a3 = await players(s, taku, 'since=' + a2.token);
    const b3 = await players(s, taku, 'since=' + b2.token);
    assert.deepEqual([a3.delta, a3.players, b3.delta, b3.players], [true, [], true, []]);
    // a page's token is good once (a repeat is whole), and does not break the other page's
    const again = await players(s, taku, 'since=' + a2.token);
    assert.equal(again.full, true);
    assert.equal((await players(s, taku, 'since=' + b3.token)).delta, true);
    // many pages: the oldest are forgotten (answered whole), and the list does not grow without end
    for (let i = 0; i < 70; i++) await players(s, taku, 'since=');
    assert.equal((await players(s, taku, 'since=' + a3.token)).full, true, 'a page forgotten gets the whole list');
  } finally {
    await s.stop();
  }
});
