// 最貧困層 (both countries), 給付型経済成長 (ヴェルノア) and 少数精鋭集団アルファ (js/game/npc.js NPC.poorest, gift, alpha;
// server/core/npc-welfare.js, npc-alpha.js): the state's money to its poorest each month (3,000 in a dangerous bust),
// the year's $5M to the poorest 40% and their week of wanting three times as much; the 90 who invest together — chosen
// each month, never more, never fewer —, their talk (by the AI, or in the model's own words), their orders in the
// people's market, their holdings each by what they put in, their days kept here and in R2 — every $ kept: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as welfare from '../core/npc-welfare.js';
import * as alpha from '../core/npc-alpha.js';
import * as econ from '../core/npc-econ.js';
import { FL, ageOf, LISTED } from '../core/npc-pop.js';
import { NPC, CORP, RULES } from '../core/rules.js';
import { startServer } from './helpers.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000, DAY = 86400000;
const FROM = CORP.dayAt(2026, 11, 5);
const PX = { riru: 12000, ice: 30000, magita: 9000, tenesice: 20000 };
function country(n = 700, seed = 31) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key), launch = Math.floor(START / DAY);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: (id) => PX[id] || 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  const c = {
    w, W, ch, ctx, worst: 0,
    days(k, each) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        const L = npc.ledgerDay(W, w, day);
        c.worst = Math.max(c.worst, Math.abs(L.days[L.days.length - 1].moved));
        if (each) each(day + 1);
      }
    }
  };
  return c;
}
const px = [PX.riru, PX.ice, PX.magita, PX.tenesice];

test('the rules as given: the poorest 1,000 at $5M a month ($5B; 3,000 and $15B in a dangerous bust) in both countries from 2026-11-05; the year\'s $5M to the poorest 40% and three times the wish to buy for a week; アルファ\'s 90, its 10 who talk in the three ways, 15〜25 messages, two companies and two trades at most, $5B a day, 70 days kept', () => {
  const R = NPC.poorest, G = NPC.gift, A = NPC.alpha;
  assert.deepEqual([R.from, R.n, R.pay, R.n * R.pay, R.crisis.n, R.crisis.n * R.pay], [[2026, 11, 5], 1000, 5000000, 5e9, 3000, 15e9]);
  assert.deepEqual([G.share, G.pay, G.days, G.boost], [0.4, 5000000, 7, 3]);
  assert.deepEqual([A.from, A.n, A.top, A.msgs, A.companies, A.trades, A.cap, A.keep], [[2026, 11, 5], 90, 10, [15, 25], 2, 2, 5e9, 70]);
  assert.deepEqual(A.styles.map((s) => s.name), ['配当・ファンダメンタル重視派', '値動き・リバウンド狙い派', 'インフラ・安定重視派']);
  // (the AI's conclusion read as the rules allow: two companies at most, a sale only of what is held, the buys' shares
  // of the day's money never beyond all of it)
  const B = [{ id: 'magita', held: 100 }, { id: 'ice', held: 0 }, { id: 'riru', held: 0 }, { id: 'tenesice', held: 0 }];
  assert.deepEqual(alpha.readPlan('いろいろ話したが…\n結論：買い magita 60、買い テネシス 40', B).trades, [{ company: 'magita', side: 'buy', share: 60 }, { company: 'tenesice', side: 'buy', share: 40 }]);
  assert.deepEqual(alpha.readPlan('結論：売り MAGITA 100、買い ice 100', B).trades, [{ company: 'magita', side: 'sell', share: 100 }, { company: 'ice', side: 'buy', share: 100 }]);
  assert.equal(alpha.readPlan('結論：売り ice 50', B), null);
  assert.equal(alpha.readPlan('今日は様子見', B), null);
  assert.deepEqual(alpha.readPlan('結論：買い ice 80、買い riru 80、買い magita 10', B).trades.map((t) => t.share), [50, 50]);
});

test('a month of it: the poorest of both countries chosen on 2026-11-05 and again on 12-01, each paid $5M; the year\'s gift on 12-01 and its week; アルファ\'s members, its meetings, its orders filled in the people\'s market, its holdings each by what they put in — every $ kept', () => {
  const c = country(700), { w, W } = c;
  c.days(2);
  assert.equal(W.poorest, undefined);
  assert.equal(W.alpha, undefined);
  let first = null;
  c.days(1, (day) => {
    if (day !== FROM) return;
    // the poorest of ヴェルノア's adults: their share of the 1,000 at this size, each $5M from the treasury
    const P = W.P, sc = W.scale, want = Math.max(1, Math.round(1000 * sc)), v = W.poorest;
    assert.equal(v.day, FROM);
    assert.equal(v.n, want);
    assert.equal(v.paid, want * 5000000);
    assert.equal(W.nation.month.out.poorest, want * 5000000);
    let flagged = 0, worstIn = -Infinity, bestOut = Infinity;
    for (let i = 0; i < P.n; i++) {
      if (ageOf(P, i, FROM) < 18) continue;
      const x = welfare.wealthOf(W, i, px);
      if (P.flags[i] & FL.poorest) { flagged++; worstIn = Math.max(worstIn, x - 5000000); } else bestOut = Math.min(bestOut, x);
    }
    assert.equal(flagged, want);
    // (none left out had less than the richest of them)
    assert.ok(worstIn <= bestOut + 1, `${worstIn} ${bestOut}`);
    // アスカ国's the same, from its treasury
    const a = W.asuka.poorest;
    assert.ok(a && a.n === Math.max(1, Math.round(1000 * W.asuka.scale)) && a.paid === a.n * 5000000 && W.asuka.month.out.poorest >= a.paid);
    // アルファ: founded today, its members (選ばれし300人 first, by what they have), its first meeting set
    const G = W.alpha;
    assert.ok(G && G.founded === FROM);
    assert.equal(G.members.length, Math.max(10, Math.round(90 * sc)));
    for (const m of G.members) assert.ok(P.flags[m.i] & FL.alpha);
    let all = 0;
    for (let i = 0; i < P.n; i++) if (P.flags[i] & FL.alpha) all++;
    assert.equal(all, G.members.length);
    const d = G.today;
    assert.ok(d.day === FROM && d.talkers.length === 10 && d.plan.trades.length >= 1 && d.plan.trades.length <= 2 && new Set(d.plan.trades.map((t) => t.company)).size <= 2);
    assert.deepEqual([...new Set(d.talkers.map((t) => t.style))].sort(), ['infra', 'swing', 'value']);
    // (no AI here: its own words, 15〜25 of them, the one with the most last with the conclusion)
    assert.ok(d.talk.msgs.length >= 15 && d.talk.msgs.length <= 25 && d.talk.msgs[d.talk.msgs.length - 1].last && d.talk.msgs[d.talk.msgs.length - 1].i === d.talkers[0].i);
    first = { want };
  });
  assert.ok(first);
  // its first day's orders, filled: each member's holding by what they put in (by what each had)
  c.days(1);
  const G = W.alpha, rec = G.hist[0];
  assert.ok(rec && rec.day === FROM, JSON.stringify(G.hist));
  assert.ok(rec.orders.length >= 1 && rec.orders.every((o) => ['filled', 'partial', 'cancelled', 'none'].includes(o.status)));
  assert.ok(G.sum.bought > 0 && G.sum.bought <= NPC.alpha.cap * W.scale * 1.05, String(G.sum.bought));
  const put = Object.values(G.put).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(put - G.sum.bought) <= 1);
  for (const [i, pos] of Object.entries(G.pos)) for (let k = 0; k < LISTED; k++) assert.ok(pos[k] <= W.P.sh[Number(i) * LISTED + k]);
  // (the one who put in the most holds the most: the gain and the loss the larger)
  const ranked = Object.entries(G.put).sort((a, b) => b[1] - a[1]);
  const value = (i) => G.pos[i].reduce((n, s, k) => n + s * px[k], 0);
  assert.ok(value(ranked[0][0]) >= value(ranked[ranked.length - 1][0]));
  // a few more days: a meeting each day, every day an order
  c.days(5);
  assert.ok(G.hist.length >= 6 && G.hist.every((h) => h.orders.length >= 1));
  // to 12-01: the month's poorest again (some the same), the year's gift, アルファ's new month
  let gift = null;
  c.days(24, (day) => {
    if (CORP.ymd(day).m !== 12 || CORP.ymd(day).d !== 1) return;
    assert.equal(W.poorest.day, day);
    assert.ok(W.poorest.again >= 0 && W.poorest.hist.length >= 2);
    const g = W.gift, P = W.P;
    let adults = 0, got = 0;
    for (let i = 0; i < P.n; i++) { if (ageOf(P, i, day) >= 18) adults++; if (P.flags[i] & FL.gift) got++; }
    assert.ok(g && g.day === day && g.n === Math.round(adults * 0.4) && got === g.n && g.paid === g.n * 5000000, JSON.stringify(g));
    assert.ok(W.nation.month.out.gift === g.paid);
    // (one of them three times as keen this week: what is not a need three times over)
    const i = [...Array(P.n).keys()].find((k) => P.flags[k] & FL.gift);
    assert.equal(econ.keenOf(W, i, day), 3);
    const before = P.cash[i];
    econ.buy(W, i, day, 'jinx', 'goods', 1000, false);
    assert.equal(before - P.cash[i], 3000 + Math.round(3000 * (W.nation.knobs.consumptionTax || 0) / 100));
    assert.equal(econ.keenOf(W, i, day + 7), 1);
    assert.equal(G.term.since, day);
    gift = g;
  });
  assert.ok(gift);
  // (its week over: nobody three times as keen)
  c.days(7);
  let keen = 0;
  for (let i = 0; i < W.P.n; i++) if (W.P.flags[i] & FL.gift) keen++;
  assert.equal(keen, 0);
  assert.equal(c.worst, 0);
});

test('a dangerous bust: 3,000 of a full country and $15B', () => {
  const c = country(600, 33), { W } = c;
  c.days(3);
  W.macro.mood = -0.7;
  const day = CORP.dayAt(2026, 12, 1);
  welfare.day(W, day, c.ctx);
  assert.ok(W.poorest.crisis && W.poorest.n === Math.max(1, Math.round(3000 * W.scale)) && W.poorest.budget === W.poorest.n * 5000000);
  assert.ok(W.asuka.poorest.crisis && W.asuka.poorest.n === Math.max(1, Math.round(3000 * W.asuka.scale)));
});

test('the operator site\'s アルファ app: its talk by the AI (15〜25 messages, its conclusion the plan), its days kept on the server and in R2 (read back from R2 too); operators only', async (t) => {
  // (the AI's stand-in: a line for each of the 10, the last its conclusion; and a number for the companies' adviser)
  const said = [];
  const ai = {
    async run(model, { messages }) {
      const u = messages[messages.length - 1].content;
      said.push(u);
      if (/最終結論/.test(u)) return { response: 'みなさんの意見をまとめます。今日はMAGITAとICEに分けます。\n結論：買い magita 70、買い ice 30' };
      if (/番号だけ/.test(messages[0].content)) return { response: '1' };
      return { response: 'MAGITAは理論株価より安い。今日はここを厚めにいきたい。' };
    }
  };
  const bucket = new Map();
  const blobs = { async put(key, bytes, sha) { bucket.set(key, { bytes, sha256: sha }); return true; }, async get(key) { return bucket.get(key) || null; }, async head(key) { const o = bucket.get(key); return o ? { size: o.bytes.length, sha256: o.sha256 } : null; }, async list(prefix) { return [...bucket.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, sha256: bucket.get(key).sha256 })); }, async del(keys) { keys.forEach((k) => bucket.delete(k)); } };
  let now = Date.UTC(2026, 10, 3, 2, 0, 0);
  const s = await startServer({ clock: () => now, operators: ['boss'], corpHistory: 0, npc: true, npcPopulation: 500, ai, blobs });
  t.after(() => s.stop());
  const boss = await s.register('boss'), p = await s.register('Looker');
  const look = () => s.call('GET', '/api/stocks', { token: p.token });
  await look(); await s.app.api.npcWake();
  // to 2026-11-05 9:10 (日本時間): its first meeting set at the 9:00 close, the AI talking
  now = Date.UTC(2026, 10, 4, 2, 0, 0); await look(); await s.app.api.npcWake();
  now = Date.UTC(2026, 10, 5, 0, 10, 0); await look();
  for (let k = 0; k < 9; k++) await s.app.api.npcWake();
  let r = await s.call('GET', '/api/ops/npc/alpha', { token: boss.token });
  assert.equal(r.status, 200);
  assert.ok(r.started && r.ai && r.r2);
  const d = r.today;
  assert.equal(d.talk.status, 'done', JSON.stringify(d.talk.status));
  assert.ok(d.talk.ai && d.talk.msgs.length === d.talk.target && d.talk.target >= 15 && d.talk.target <= 25);
  assert.ok(d.talk.msgs.every((m) => m.ai) && d.talk.msgs[d.talk.msgs.length - 1].last);
  assert.deepEqual(d.plan.trades, [{ company: 'magita', side: 'buy', share: 70 }, { company: 'ice', side: 'buy', share: 30 }]);
  assert.equal(d.plan.by, 'ai');
  // (what the AI was told: the numbers, the 10 and their ways, what was said before)
  assert.ok(said.some((u) => /配当利回り/.test(u) && /値動き・リバウンド狙い派/.test(u)));
  // the orders at 9:30 and 13:30 as it concluded; the day kept once all are filled (or at the close); then in R2
  now = Date.UTC(2026, 10, 5, 7, 0, 0); await look(); await s.app.api.npcWake();
  now = Date.UTC(2026, 10, 6, 1, 0, 0); await look(); await s.app.api.npcWake(); await s.app.api.npcWake();
  r = await s.call('GET', '/api/ops/npc/alpha', { token: boss.token });
  const h = r.hist.find((x) => x.day === FROM);
  assert.ok(h && h.ai && h.orders.map((o) => o.company).join() === 'magita,ice', JSON.stringify(h));
  assert.ok(r.kept.some((k) => k.day === FROM && k.r2));
  assert.ok(bucket.has(`npc-alpha/${FROM}.json`));
  const full = await s.call('GET', `/api/ops/npc/alpha?day=${FROM}`, { token: boss.token });
  assert.ok(full.day && full.day.talk.msgs.length >= 15 && full.day.orders.length === 2 && full.day.standing.length === r.members.length);
  // (gone from the server's own table: read back from R2)
  s.app.db.prepare('DELETE FROM npc_alpha WHERE day = ?').run(FROM);
  const back = await s.call('GET', `/api/ops/npc/alpha?day=${FROM}`, { token: boss.token });
  assert.deepEqual(back.day.orders, full.day.orders);
  // (a player: no)
  assert.ok([401, 403].includes((await s.call('GET', '/api/ops/npc/alpha', { token: p.token })).status));
});
