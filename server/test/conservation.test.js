// お金の大原則: money is made only when a country is founded; nothing a player gets or pays is made or lost; a bank
// lends only its own money, and failing, the country puts money in or takes it over; a company spends what it sells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import { NPC, CORP, RULES } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;
function country(n = 1500) {
  const key = Buffer.alloc(32, 3), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  const c = {
    w, W, ch, ctx,
    // the next day closed, with `extra` flows of the players' (its money ledger counted after it)
    days(k, extra = null) {
      const outs = [];
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day), ...(extra || {}) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        npc.ledgerDay(W, w, day);
        outs.push(out);
      }
      return outs;
    },
    money: () => npc.moneyOf(W, w)
  };
  return c;
}
const untilMonthEnd = (c) => { while (!CORP.isMonthEnd(c.w.day + 1)) c.days(1); };

test('the money ledger never moves: two months of a country and its companies, every $ from someone to someone', () => {
  const c = country(2000);
  c.days(62);
  const L = c.W.ledger;
  assert.equal(L.days.length, 60);
  // (a dollar's rounding at most, any day)
  assert.ok(L.days.every((x) => x.moved === 0), JSON.stringify(L.days.filter((x) => x.moved !== 0).slice(0, 8)));
  assert.equal(L.drift, 0);
});

test('a player\'s start is the treasury\'s, the fertilizer beyond YOSIDA\'s share the treasury\'s fund, an icon MY WAY\'s sale', () => {
  const c = country(800), { W, w } = c;
  c.days(2);
  const before = c.money(), nation = W.nation.cash, myway = w.co.myway.bal.cash;
  const start = RULES.start.dollars + RULES.start.tokens * RULES.tokenPrice;
  const [out] = c.days(1, { '@state': { start }, '@stateIn': { fertilizer: 600000 }, yosida: { fertilizer: 400000 }, myway: { icons: 2500000 } });
  assert.equal(out.ext.state.by.playerStart, start);
  assert.equal(out.ext.stateIn.treeFund, 600000);
  assert.ok(W.nation.month.out.playerStart >= start && W.nation.month.in.treeFund >= 600000);
  assert.ok(w.co.myway.per.m['r:icons'] === 2500000);
  assert.ok(w.co.myway.bal.cash > myway - 1e9);
  // (the players' money in and out of the country counted: the ledger did not move)
  assert.ok(Math.abs(c.money() - before) <= 5, `${c.money() - before}`);
  void nation;
});

test('a bank lends only its own money: an account below zero is lent out of it, and what it has left is all anyone can borrow', () => {
  const c = country(800), { W, w } = c;
  c.days(2);
  const [a] = c.days(1);
  const free = a.ext.bankFree;
  assert.ok(free > 0);
  assert.equal(W.bankRoom, free);
  // (the country spends beyond its money: what it is short of is lent to it, out of the bank's own)
  W.nation.cash -= 5e9; W.sector.cash += 5e9;
  const [b] = c.days(1);
  assert.ok(b.ext.bankFree <= free - 4e9, `${free} → ${b.ext.bankFree}`);
});

test('a bank that has lent more than its own money: the country puts in what it lacks if it can, else it fails and the country takes it over — no money made either way', () => {
  for (const rich of [true, false]) {
    const c = country(800), { W, w } = c, s = w.co.tenesice;
    c.days(2);
    untilMonthEnd(c);
    // (its own money lent out and lost: its cash below its deposits, its equity with it)
    const free = (s.bal.cash || 0) - (s.bal.deposits || 0), gone = free + 2e10;
    s.bal.cash -= gone; s.bal.retained -= gone;
    W.sector.cash += gone;
    // (a treasury that could spare it, or one that could not)
    if (rich) { W.nation.cash += 5e12; W.sector.cash -= 5e12; } else { W.sector.cash += W.nation.cash; W.nation.cash = 0; }
    const before = c.money(), nation = W.nation.cash;
    c.days(1);
    if (rich) {
      assert.ok(s.aid && s.aid.length === 1, 'aid');
      assert.ok(!s.reorg);
      assert.ok((s.bal.cash || 0) > 0);
      // (the treasury's money, for the shares the country holds now: the ledger below says it came out of it)
      assert.equal(W.nation.stakes.tenesice, s.aid[0].n);
      void nation;
    } else {
      assert.ok(s.reorg, 'taken over');
      assert.equal(s.div.dps, 0);
      assert.ok(s.target < s.reorg.staff);
      assert.ok(!s.dead);
    }
    assert.ok(Math.abs(c.money() - before) <= 5, `${rich}: ${c.money() - before}`);
  }
});

test('a company that stops selling spends less, month by month: its budgets follow its sales down', () => {
  const c = country(800), { w } = c, s = w.co.jinx;
  c.days(2);
  const start = ['place', 'rd', 'ads', 'other'].reduce((a, k) => a + (s.budget[k] || 0), 0);
  // (nobody buys from it: its sales gone)
  const p = CORP.company('jinx');
  const keep = p.op;
  for (let k = 0; k < 4; k++) {
    untilMonthEnd(c);
    for (const x of Object.keys(s.per.m)) if (/^r:/.test(x)) s.per.m[x] = 0;
    c.days(1);
  }
  const now = ['place', 'rd', 'ads', 'other'].reduce((a, k) => a + (s.budget[k] || 0), 0);
  assert.ok(now < start * 0.85, `${start} → ${now}`);
  assert.ok(now >= start * 0.05 * 0.9);
  void keep;
});
