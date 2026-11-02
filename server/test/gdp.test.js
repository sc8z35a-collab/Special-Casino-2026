// The two countries' GDP (server/core/npc-gdp.js): by what was spent on what each made — C + G + I + X − M, a day at
// a time —, what one bought of the other the other's exports, real at the prices of the beginning; the day, the month
// and the year read from it. It only counts: the money ledger never moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import { NPC, RULES, CORP } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000;

test('GDP of each country, a day at a time: C + G + I + X − M, the one\'s imports the other\'s exports, real by the price index; the month and the year from the days', () => {
  const key = Buffer.alloc(32, 21), ch = corpModel.chance(key), launch = Math.floor(START / 86400000), n = 1500;
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  for (let d = 0; d < 45; d++) {
    const day = Math.floor(m / 1440);
    for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
    const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
    npc.nextDay(W, day, out.ext, ctx);
    npc.ledgerDay(W, w, day);
  }
  // (kept small: a day's numbers in a row)
  const days = W.gdp.days.map((r) => {
    const o = (a) => { const x = { c: a[0], g: a[1], i: a[2], x: a[3], m: a[4], defl: a[5] / 10000 }; x.nominal = x.c + x.g + x.i + x.x - x.m; x.real = Math.round(x.nominal / x.defl); return x; };
    return { day: r.day, v: o(r.v), a: o(r.a) };
  });
  // (the first day only begins the count)
  assert.equal(days.length, 44);
  for (const r of days) {
    for (const c of [r.v, r.a]) assert.ok(c.c >= 0 && c.g >= 0 && c.i >= 0 && c.x >= 0, JSON.stringify(c));
    // (what ヴェルノア bought of アスカ国 is what アスカ国 sold it, to the dollar)
    assert.equal(r.v.m, r.a.x, `day ${r.day}`);
  }
  // after the first month (the companies begin), each country makes more than nothing every day of a month
  const t = CORP.ymd(days[days.length - 1].day);
  const month = days.filter((r) => { const x = CORP.ymd(r.day); return x.y === t.y && x.m === t.m; });
  assert.ok(month.length >= 10 && month.reduce((a, r) => a + r.v.real, 0) > 0 && month.every((r) => r.a.real > 0));
  // the view: the day, the month and the year are the days' sums; the pace a year's of the last 30
  const v = npc.gdpView(W);
  for (const [c, k] of [['vernoa', 'v'], ['asuka', 'a']]) {
    const g = v[c];
    assert.equal(g.day.day, days[days.length - 1].day);
    assert.equal(g.month.nominal, month.reduce((a, r) => a + r[k].nominal, 0));
    assert.equal(g.year.days + (g.lastYear ? g.lastYear.days : 0), days.length);
    assert.equal(g.day.nominal, g.day.c + g.day.g + g.day.i + g.day.x - g.day.m);
    assert.equal(g.year.nominal + (g.lastYear ? g.lastYear.nominal : 0), days.reduce((a, r) => a + r[k].nominal, 0));
    assert.equal(g.last365.nominal, days.reduce((a, r) => a + r[k].nominal, 0));
    assert.equal(g.pace.real, Math.round(days.slice(-30).reduce((a, r) => a + r[k].real, 0) / 30 * 365));
    assert.equal(g.series.length, 44);
    assert.ok(g.head > 0 && g.people > 0);
  }
  assert.equal(W.ledger.drift, 0);
});
