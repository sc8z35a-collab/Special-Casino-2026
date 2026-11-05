// 社長のAI (server/core/npc-boss.js): a company whose 社長 is one of the 300 is told of its company as it is — its
// books, its share, its products, its development, every contract — and given all it may do, its meetings' proposals
// and its 社長's own (contracts asked down or ended, a new business, more lent, new customers); what it chooses the
// company does at once: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import * as boss from '../core/npc-boss.js';
import { NPC, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;

function country(n = 2000) {
  const key = Buffer.alloc(32, 21), ch = corpModel.chance(key), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / NPC.nation.population);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: { magita: 12000 }, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  return { w, W, ctx, days(k) { for (let d = 0; d < k; d++) { const day = Math.floor(m / 1440); for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx); const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch); npc.nextDay(W, day, out.ext, ctx); } } };
}
const rnd = { u: () => 0.5, int: () => 0, z: () => 0, weighted: () => 0, byte: () => 128 };

test('a 社長 of the 300 runs the company by its AI: told of it all, given all it may do', () => {
  const c = country();
  c.days(2);
  const { W, w, ctx } = c, o = W.orgs.carowner;
  W.P.flags[o.president] |= pop.FL.elite;
  assert.ok(boss.aiBoss(W, 'carowner'));
  assert.equal(boss.due(W, ctx, W.day) !== null, true);
  const text = boss.briefing(W, 'carowner', ctx, W.day);
  for (const k of ['業績', 'お金', '人：', '自社株', '契約・取引']) assert.ok(text.includes(k), k);
  const list = boss.options(W, 'carowner', ctx, W.day, rnd);
  const titles = list.map((x) => x.title);
  assert.ok(titles.some((t) => t.includes('仕入れ価格の引き下げ')));
  assert.ok(titles.some((t) => t.includes('新しい取引先')));
  assert.ok(titles.some((t) => t.includes('何もしない')));
  // (its choice done at once: the makers' prices to it asked down — a term of the next close —, a 社長決裁 minuted)
  const k = titles.findIndex((t) => t.includes('仕入れ価格の引き下げ')) + 1;
  const ops = W.corpOps.length;
  const done = boss.decide(W, 'carowner', list, `選択=${k} 理由=利幅を広げたい`, ctx, W.day, rnd);
  assert.deepEqual(done.chose, [titles[k - 1]]);
  assert.equal(done.why, '利幅を広げたい');
  assert.ok(W.corpOps.length > ops && W.corpOps.some((x) => x.kind === 'terms' && x.buyer === 'carowner'));
  assert.ok(W.meetings.some((x) => x.kind === 'boss' && x.company === 'carowner'));
  assert.equal(boss.due(W, ctx, W.day) === 'carowner', false, 'once a day');
  void w;
});

test('Tenesice\'s 社長 may lend more to a borrower; MY WAY\'s may ask a partner more or end its contract; a 社長 not of the 300 has no AI', () => {
  const c = country();
  c.days(3);
  const { W, ctx } = c;
  const plain = W.orgs.jinx.president;
  W.P.flags[plain] &= ~pop.FL.elite;
  assert.equal(boss.aiBoss(W, 'jinx'), false);
  W.lend = W.lend || {};
  W.lend.magita = W.lend.magita || { rate: 0.02, cap: 1e10, rank: 'A' };
  W.P.flags[W.orgs.tenesice.president] |= pop.FL.elite;
  const list = boss.options(W, 'tenesice', ctx, W.day, rnd);
  const k = list.findIndex((x) => x.kind === 'lend' && x.effect[0].company === 'magita');
  assert.ok(k >= 0);
  boss.decide(W, 'tenesice', list, `選択=${k + 1}`, ctx, W.day, rnd);
  const was = W.lend.magita, op = W.corpOps.filter((x) => x.kind === 'lend' && x.company === 'magita').pop();
  assert.ok(op && op.cap === Math.round(was.cap * 1.3) && op.rate === Math.max(0.001, was.rate - 0.002), JSON.stringify([op, was]));
  // (an answer it could not read: nothing done, its turn tomorrow)
  W.P.flags[W.orgs.dtrade.president] |= pop.FL.elite;
  const l2 = boss.options(W, 'dtrade', ctx, W.day, rnd);
  assert.equal(boss.decide(W, 'dtrade', l2, 'よくわからない', ctx, W.day, rnd), null);
});
