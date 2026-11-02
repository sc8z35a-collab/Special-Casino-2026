// アルタス: ATSUKA Vision's state resource enterprise, the only one — every company's raw materials, energy and food
// bought of it, as much as is bought and never a fixed sale; on their books a line of its own; its prices set as a
// monopoly sets them; half its profit the treasury's. No $ made or lost by any of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as asuka from '../core/asuka.js';
import { NPC, CORP, RULES, ASUKA, LOCAL } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;
function country(n = 1500) {
  const key = Buffer.alloc(32, 7), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  const books = {};
  return {
    w, W, books,
    days(k) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        npc.ledgerDay(W, w, day);
        // (each company's day on its books)
        for (const s of Object.values(w.co)) {
          const b = books[s.id] || (books[s.id] = {});
          for (const [k, v] of Object.entries(s.per.d)) if (!k.startsWith('cf:')) b[k] = (b[k] || 0) + v;
        }
      }
    }
  };
}
const ALTAS_LINES = ['c:altas', 'c:materials', 'sAltas', 'c:asukaAltas'];

test('アルタス sells to every one of the thirteen, the local companies, the small shops and アスカ\'s own trade — what they bought, on their books, its sales to the dollar', () => {
  const c = country(2000), { W, w, books } = c;
  c.days(40);
  const L = W.asuka.altas;
  assert.ok(L && L.last, 'a month closed');
  const by = L.last.by;
  // (its customers: all thirteen, and the local companies, and the shops, and アスカ's trade)
  const missing = Object.keys(w.co).filter((id) => !(by['co:' + id] > 0));
  assert.deepEqual(missing, [], JSON.stringify(by));
  const locals = Object.keys(by).filter((k) => k.startsWith('local:'));
  assert.ok(locals.length >= LOCAL.firms.length * 0.75, `${locals.length} local companies`);
  assert.ok(by.shops > 0 && by['asuka:trade'] > 0, JSON.stringify(by));
  // (its month's sales: the sum of what each bought)
  assert.equal(Object.values(by).reduce((a, b) => a + b, 0), L.last.rev);
  // (on the companies' books: a line of their own — the makers' materials, the others' resources)
  for (const id of ['magita', 'yosida', 'wazima']) assert.ok(books[id]['c:materials'] > 0, id);
  for (const id of ['jinx', 'carowner', 'daizin']) assert.ok(books[id]['c:altas'] > 0, id);
  assert.ok(Object.values(books).filter((b) => b.sAltas > 0).length >= 10, 'the buildings\' energy');
  // (and the local companies' too)
  const lo = Object.values(W.locals.firms).filter((f) => f.last && f.last.altas > 0);
  assert.ok(lo.length >= LOCAL.firms.length * 0.75, `${lo.length}`);
  // (its people: the biggest employer of the country's)
  const v = asuka.view(W);
  assert.ok(v.altas.staff > v.jobs.atsuka * 0.5 && v.altas.staff > v.jobs.trade * 0.5, JSON.stringify([v.altas.staff, v.jobs]));
  assert.ok(v.altas.customers.length > 20 && v.altas.customers[0].n >= v.altas.customers[1].n);
  assert.equal(W.ledger.drift, 0);
});

test('アルタス\'s prices: what the companies pay follows them, and the ledger never moves', () => {
  const c = country(1500), { W, w, books } = c;
  c.days(5);
  const before = (co) => ALTAS_LINES.reduce((n, k) => n + (books[co][k] || 0), 0);
  const was = Object.fromEntries(Object.keys(w.co).map((id) => [id, before(id)]));
  // (a monopoly's price, doubled)
  W.asuka.altas.price = 2;
  c.days(5);
  const now = Object.fromEntries(Object.keys(w.co).map((id) => [id, before(id) - was[id]]));
  // (YOSIDA's materials — its seeds, its trees, its cars — cost twice as much a day as at the founding's prices)
  assert.ok(now.yosida > was.yosida * 1.4, `${was.yosida} → ${now.yosida}`);
  assert.equal(W.ledger.drift, 0);
  assert.ok(W.ledger.days.every((d) => d.moved === 0));
});

test('アルタス sets its prices as a monopoly: up while what is bought holds up and its customers make money, down when they lose it; half its profit the treasury\'s, no $ made', () => {
  const c = country(800), { W } = c;
  c.days(2);
  const L = W.asuka.altas, P = ASUKA.altas.price;
  const total = () => asuka.moneyOf(W);
  // (bought as much as the month before, its customers in profit: a step up)
  L.price = 1; L.last = { rev: 1000000000 };
  L.m = { rev: 1000000000, pay: 200000000, equip: 100000000, health: 5000000000, by: { 'co:magita': 1000000000 } };
  const t0 = total(), tr0 = W.asuka.treasury;
  asuka.altasMonth(W, 100);
  assert.equal(L.price, Math.round((1 + P.up) * 1000) / 1000);
  assert.equal(L.last.profit, 700000000);
  assert.equal(W.asuka.treasury - tr0, Math.floor(700000000 * ASUKA.altas.dividend));
  assert.equal(total(), t0);
  // (less bought than the month before: the rise not repeated)
  const p1 = L.price;
  L.m = { rev: 500000000, pay: 200000000, equip: 0, health: 5000000000, by: {} };
  asuka.altasMonth(W, 130);
  assert.equal(L.price, p1);
  // (its customers lost money: a step down, never below its floor)
  L.m = { rev: 500000000, pay: 200000000, equip: 0, health: -1, by: {} };
  asuka.altasMonth(W, 160);
  assert.ok(L.price < p1 && L.price >= P.min);
  // (a month at a loss: nothing to the treasury)
  const tr1 = W.asuka.treasury;
  L.m = { rev: 100, pay: 200000000, equip: 0, health: 1, by: {} };
  asuka.altasMonth(W, 190);
  assert.equal(W.asuka.treasury, tr1);
  assert.ok(W.asuka.news.some((n) => /アルタスが資源価格を引き上げ/.test(n.text)) && W.asuka.news.some((n) => /引き下げ/.test(n.text)));
});
