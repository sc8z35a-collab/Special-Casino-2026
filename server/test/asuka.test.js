// アスカ国: founded once with its money printed that day, never again; its people, its state, ATSUKA Vision and its
// bank a day at a time; ヴェルノア's companies' branches there as far as it pays them; every $ between the two
// countries from someone to someone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as asuka from '../core/asuka.js';
import { NPC, CORP, RULES, ASUKA } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;
function country(n = 1500) {
  const key = Buffer.alloc(32, 5), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  return {
    w, W, ch, ctx,
    days(k) {
      const outs = [];
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        npc.ledgerDay(W, w, day);
        outs.push(out);
      }
      return outs;
    }
  };
}

test('アスカ国 is founded with the country: its people by ヴェルノア\'s size, its money printed once and given out to the dollar', () => {
  const c = country(1500), a = c.W.asuka, A = c.W.AP, sc = 1500 / NPC.nation.population;
  assert.equal(A.n, Math.round(ASUKA.rules.population * sc));
  assert.equal(a.total, Math.round(ASUKA.rules.founding.total * sc));
  // (every dollar of it somewhere: its people, the treasury, ATSUKA Vision, the bank, the fund, the pensions, the trade)
  assert.equal(asuka.moneyOf(c.W), a.total);
  assert.ok(Math.abs(a.atsuka.cash - a.total * 0.15) <= 1 && Math.abs(a.bank.own - a.total * 0.07) <= 1);
  let people = 0;
  for (let i = 0; i < A.n; i++) people += A.cash[i];
  assert.ok(people > a.total * 0.59 && people <= a.total * 0.6 + 1);
  // (posts filled: the state's and the local trade's)
  const v = asuka.view(c.W);
  assert.equal(v.jobs.atsuka, Math.round(ASUKA.rules.jobs.atsuka * sc));
  assert.ok(v.jobs.trade > 0 && v.jobs.retired > 0);
});

test('two months of two countries: every $ between them from someone to someone, both ways; ヴェルノア\'s imports アスカ\'s sales, its exports what アスカ set aside to buy', () => {
  const c = country(2000), { W } = c;
  const outs = c.days(62);
  const L = W.ledger;
  assert.ok(L.days.every((x) => x.moved === 0), JSON.stringify(L.days.filter((x) => x.moved !== 0).slice(0, 5)));
  assert.equal(L.drift, 0);
  const a = W.asuka;
  assert.ok(a.sum.fromVernoa > 0 && a.sum.toVernoa > 0, JSON.stringify(a.sum));
  assert.ok(a.atsuka.rev.materials > 0, 'imports: ATSUKA Vision\'s');
  const exports = outs.reduce((n, o) => n + (o.ext.exports || 0), 0);
  assert.ok(exports > 0 && exports <= a.atsuka.procured, `${exports} ${a.atsuka.procured}`);
  // (its people lived: deaths and new lives, the new ones' money the treasury's)
  assert.ok(a.hist.length >= 2);
  assert.ok(a.hist.some((h) => (h.out.pension || 0) > 0));
});

test('ヴェルノア\'s companies open branches where アスカ\'s people would buy, its people work there, the sales are theirs and the taxes アスカ\'s', () => {
  const c = country(2000), { W, w } = c;
  const outs = c.days(95);
  const B = w.asukaB || {};
  const open = Object.entries(B).filter(([, cats]) => Object.values(cats).some((n) => n > 0)).map(([co]) => co);
  assert.ok(open.length >= 3, JSON.stringify(B));
  // (their people: アスカ's)
  const v = asuka.view(W);
  assert.ok(v.jobs.branch > 0);
  // (the sales on their books, the taxes on their branches' profit paid to アスカ at a month's end)
  const sold = Object.values(w.co).filter((s) => s.asuka && s.asuka.last && s.asuka.last.sales > 0);
  assert.ok(sold.length >= 3, sold.map((s) => s.id).join(','));
  assert.ok(outs.some((o) => o.ext.asuka && o.ext.asuka.tax > 0));
  assert.ok(W.asuka.hist.some((h) => (h.in.branchTax || 0) > 0));
  // (the makers sold to the dealers for アスカ: their sale)
  assert.ok(['magita', 'yosida'].some((id) => Object.keys(w.co[id].per.y).includes('r:asukaB2B')));
  assert.equal(W.ledger.drift, 0);
});

test('its people kept as blobs and read back the same; a country that lived before it founds it at its next day, the ledger told', () => {
  const c = country(800), { W, w } = c;
  c.days(3);
  const A = W.AP, B = asuka.unpack(asuka.alloc(A.n), asuka.pack(A));
  for (const k of ['birth', 'job', 'cash', 'debt', 'taste', 'pay']) assert.deepEqual(Array.from(B[k]), Array.from(A[k]), k);
  // (a country saved before アスカ国: founded with the next day, its money counted as founded)
  // (its ledger as it was then: counting only ヴェルノア)
  delete W.asuka; delete W.AP;
  const was = W.ledger.founded || 0;
  W.ledger.base = npc.moneyOf(W, w) - was; W.ledger.drift = 0;
  c.days(1);
  assert.ok(W.asuka && W.AP);
  assert.equal(W.ledger.founded - was, W.asuka.total);
  assert.equal(W.ledger.drift, 0);
});
