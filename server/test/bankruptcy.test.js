// 破産 in a living country: a top company files, its trustee sells the game's business it ran to the highest bidder
// (or, none of the thirteen bidding, to a local company with Tenesice's money), pays out and closes it; a local company
// fails and its bank takes the loss; and every $ still goes from someone to someone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as localModel from '../core/npc-local.js';
import { NPC, CORP, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000, BK = CORP.bankruptcy;
function country(n = 1500) {
  const key = Buffer.alloc(32, 3), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  return {
    w, W,
    days(k) {
      const outs = [];
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        outs.push(out);
      }
      return outs;
    },
    // all the money there is, by who holds it (a local company's loan from Tenesice a debt like the people's)
    money() {
      const P = W.P;
      let x = 0;
      for (let i = 0; i < P.n; i++) x += P.cash[i] - P.debt[i] + P.tokens[i];
      x += W.nation.cash - W.nation.bank + W.nation.fund.cash + W.districts.reduce((a, d) => a + d.cash, 0) + W.sector.cash;
      if (W.locals) for (const c of Object.values(W.locals.firms)) x -= c.debt || 0;
      for (const id of NPC.companies) {
        const s = w.co[id];
        if (id === 'tenesice') x += (s.bal.cash || 0) + (s.bal.lent || 0) + (s.bal.bonds || 0) - (s.bal.deposits || 0);
        else x += (s.bal.cash || 0) - s.loans.reduce((a, l) => a + l.amt, 0);
      }
      return x + npc.econ.pending(W) + W.abroad.cash - W.sum.endowed + W.sum.toPlayers - W.sum.fromPlayers;
    }
  };
}
// (a company's money and its equity gone, a loan beyond anything Tenesice will lend it)
function sink(w, id) {
  const s = w.co[id];
  const gone = (s.bal.cash || 0) + (s.bal.bonds || 0), loan = Math.max(5e9, corpModel.equityOf(s) - gone + 2e9);
  s.bal.cash = 0; s.bal.bonds = 0; s.bal.retained -= gone + loan;
  // (below water five months already: the sixth month's end is its last)
  s.under = BK.insolvent - 1;
  s.loans.push({ id: 'Lsink', amt: loan, rate: 0.03, from: w.day, until: w.day + 1000 });
  s.bal.loan = (s.bal.loan || 0) + loan;
  // (Tenesice holds it as a loan it made)
  w.co.tenesice.bal.lent += loan; w.co.tenesice.bal.cash -= loan;
}
const untilFiled = (c, id) => { for (let k = 0; k < 70 && !c.w.co[id].bk; k++) c.days(1); return c.w.co[id].bk; };

test('a top company files at a month\'s end, its people let go, its shares stopped; its trustee sells its VIP business to the highest bidder, who books it from then on', () => {
  const c = country(), { w, W } = c;
  c.days(3);
  sink(w, 'daizin');
  const before = c.money(), staff = W.staffOf('daizin').length;
  assert.ok(staff > 0);
  const bk = untilFiled(c, 'daizin');
  assert.ok(bk, 'filed');
  assert.ok(CORP.isMonthEnd(bk.filed));
  assert.equal(corpModel.operatorOf(w, 'vip'), null);
  c.days(2);
  assert.equal(W.staffOf('daizin').length, 0);
  assert.ok(W.orgs.daizin.dead);
  // the court, the auction
  c.days(BK.auction - 2);
  const o = w.ops.vip;
  assert.ok(o.by && o.by !== 'daizin', `sold: ${JSON.stringify(o)}`);
  assert.equal(w.co.daizin.bk.sold[0].feature, 'vip');
  // (its new runner books the people's VIP from then on; the trustee's money from the sale in its estate)
  c.days(10);
  const runner = w.co[o.by] || null;
  if (runner) assert.ok(Object.keys(runner.per.m).some((k) => k === 'r:op:vip'), Object.keys(runner.per.m).join(','));
  assert.ok(runner.goodwill && runner.goodwill.length === 1);
  // payout and the end
  c.days(BK.distribute - BK.auction);
  assert.equal(w.co.daizin.bk.stage, 'distributed');
  assert.ok(w.co.daizin.bk.rate >= 0 && w.co.daizin.bk.rate <= 1);
  assert.ok(Math.abs(c.money() - before) < 1500 * 100, `${c.money() - before}`);
});

test('none of the thirteen bidding, a local company buys the business with Tenesice\'s money, runs it and pays its loan; a local company that fails leaves its bank the loss and its business to another', () => {
  const c = country(), { w, W } = c;
  c.days(3);
  sink(w, 'daizin');
  untilFiled(c, 'daizin');
  const filed = w.co.daizin.bk.filed;
  // (on the auction's day nobody among the thirteen above water)
  while (w.day + 1 < filed + BK.auction) c.days(1);
  // (a debt as large as any, for one day, and its books still balanced)
  const keep = [];
  for (const s of Object.values(w.co)) if (!s.dead) { const x = corpModel.equityOf(s) + 1e9; s.bal.ap += x; s.bal.retained -= x; keep.push([s, x]); }
  c.days(1);
  for (const [s, x] of keep) { s.bal.ap -= x; s.bal.retained += x; }
  const o = w.ops.vip;
  assert.match(o.by || '', /^local:/);
  const firm = o.by.slice(6), lc = W.locals.firms[firm];
  c.days(2);
  assert.ok(lc.debt > 0 && lc.loans.length === 1);
  assert.equal(W.locals.ops.vip, firm);
  const before = c.money();
  // (it runs it: the people's VIP its sales; at the month's end it pays Tenesice)
  c.days(35);
  assert.ok(Object.keys((lc.last || lc.m).by).includes('op:vip') || Object.keys(lc.m.by).includes('op:vip'));
  assert.ok(lc.debt < lc.loans[0].n);
  assert.ok(Math.abs(c.money() - before) < 1500 * 100, `${c.money() - before}`);
  // (the operators' 地方企業 app: all 32, the one that runs it among them, each its pace of late — the thirteen pay at
  // the month's end, so not its last day's)
  const det = localModel.detail(W), mine = det.firms.find((x) => x.id === firm);
  assert.equal(det.firms.length, 32);
  assert.deepEqual(mine.runs.map((x) => x.id), ['vip']);
  assert.ok(mine.debt > 0 && mine.loans.length === 1);
  assert.ok(det.firms.filter((x) => x.pace > 0).length >= 24, det.firms.map((x) => x.pace).join(','));
  for (const x of det.firms) assert.ok(x.capital > 0 && x.capital <= x.spec.capital);
  // a local company fails: its bank takes the loss, another of its economy its business
  const f = CORP.feature('vip') && 'crown', fc = W.locals.firms[f];
  fc.retained = -1e12; fc.cash = -1e10;
  const bank = W.locals.firms.chiikibank, bankCash = bank.cash;
  for (let k = 0; k < 120 && !fc.bk; k++) c.days(1);
  assert.ok(fc.bk && fc.dead);
  c.days(2);
  assert.equal(localModel.view(W).firms.find((x) => x.id === f).staff, 0);
  c.days(BK.distribute);
  assert.equal(fc.bk.stage, 'distributed');
  assert.ok(bank.cash < bankCash, 'its bank took the loss');
  assert.ok(fc.bk.to && W.locals.firms[fc.bk.to].extra.includes(f));
});
