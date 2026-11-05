// MIZUKAWA Motors株式会社 (js/game/corp.js MIZUKAWA, server/core/corp-mizukawa.js): アスカ国籍, founded on 2026-11-05 out of
// アスカ国's treasury; its people アスカ国's by role at its pay index; its cars and engines at MIZUKAWA GARAGE alone, each
// worked out the day it comes out, as many as it makes; its research never lost (50/30/20); its technology's fees;
// HIGA MASTER; MY WAY's contract till 2027-01-01; WAZIMA and the four of MAGITA's economy bought — every $ kept: npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as asuka from '../core/asuka.js';
import * as local from '../core/npc-local.js';
import { NPC, CORP, RULES, GACHA } from '../core/rules.js';
import { startServer } from './helpers.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), MIN = 60000, DAY = 86400000;
const FOUNDED = CORP.dayAt(2026, 11, 5), R = CORP.mizukawa;
function country(n = 800, seed = 23) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key), launch = Math.floor(START / DAY);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const ctx = { corp: w, stockPrice: () => 10000, carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  const c = {
    w, W, ch, ctx, worst: 0,
    days(k) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        const L = npc.ledgerDay(W, w, day);
        c.worst = Math.max(c.worst, Math.abs(L.days[L.days.length - 1].moved));
      }
    }
  };
  return c;
}

test('the rules as given: the 15th company, アスカ国籍, unlisted, founded 2026-11-05 on $38B; its 2,300 people by role and pay; its models, their prices and what one of each leaves; its research 50/30/20; the line technology\'s 70%', () => {
  const p = CORP.company('mizukawa');
  assert.equal(CORP.companies.length, 15);
  assert.equal(CORP.companies[14].id, 'mizukawa');
  assert.deepEqual([p.full, p.nation, p.listed, p.founded, p.retained], ['MIZUKAWA Motors株式会社', 'asuka', false, [2026, 11, 5], 38000000000]);
  // (研究開発員 1,500 at $4M a month, 営業 350 at $2M, システム 150 at $3M, 製造ライン管理 200 at $3M, 経営陣 100 at $4M: the
  // floor its pay index starts from, all of it moved by what it earns)
  assert.deepEqual(R.roles.map((r) => [r.id, r.n, r.pay]), [['rd', 1500, 4000000], ['sales', 350, 2000000], ['systems', 150, 3000000], ['line', 200, 3000000], ['exec', 100, 4000000]]);
  assert.equal(R.roles.reduce((n, r) => n + r.n, 0), 2300);
  assert.ok(R.pay.min < 1 && R.pay.max >= 3 && R.staff.min < 1 && R.staff.max > 1);
  // its models at MIZUKAWA GARAGE — the dearest of the carmakers' —, sold by it alone at their list prices
  const price = Object.fromEntries([...RULES.cars, ...RULES.shop].filter((c) => c.seller === 'mizukawa').map((c) => [c.id, c.price]));
  assert.deepEqual(price, {
    'mizukawa-river-w': 25000000, 'mizukawa-river-w-feat': 38000000, 'mizukawa-river-w2': 30000000, 'mizukawa-super-u': 19000000,
    'mizukawa-h1': 45000000, 'mizukawa-h1-super': 67000000, 'mizukawa-super-u2': 22000000, 'mizukawa-nature-1': 13000000,
    'mizukawa-river-w3': 27000000, 'mizukawa-enjin2': 12000000, 'mizukawa-enjin3': 16000000, 'mizukawa-flow': 10000000
  });
  // (the three on sale: their cost, research and $100K a unit's 販売手数料 as given — $11.9M, $33.9M, $2.4M a unit)
  const net = (kind, id) => { const pr = CORP.products[kind][id]; return price[id] - pr.cost - pr.research - R.fee; };
  assert.deepEqual([net('cars', 'mizukawa-river-w'), net('cars', 'mizukawa-river-w-feat'), net('items', 'mizukawa-enjin2')], [11900000, 33900000, 2400000]);
  assert.deepEqual([CORP.products.cars['mizukawa-river-w'].limit, CORP.products.cars['mizukawa-river-w-feat'].limit, CORP.products.items['mizukawa-enjin2'].limit], [20000, 1000, 20000]);
  assert.deepEqual(CORP.products.cars['mizukawa-river-w-feat'].collab, { with: 'myway', share: 0.5 });
  // (its research never lost: half its researchers' pay and bonus, three tenths orders to others, two tenths its
  // technology's worth)
  assert.deepEqual([R.research.pay, R.research.orders, R.research.asset], [0.5, 0.3, 0.2]);
  assert.deepEqual([R.line.share, R.higa.cut, R.higa.cost, R.release.bonus, R.wazima.premium], [0.7, 0.3, 5000000000, 1.2, 0.25]);
  assert.deepEqual(R.myway.until, [2027, 1, 1]);
  // the cars it sells are no prize of the gacha, and never on a sale
  assert.ok(![...GACHA.cars, ...GACHA.pool].some((c) => price[c.id]));
  // (the people of both countries spend on cars three and a half times what they did)
  assert.equal(NPC.life.carSpend, 3.5);
});

test('its first month: founded at 2026-11-05 9:00 with アスカ国\'s $38B; its people アスカ国\'s by role at their pay; the models out on their days, worked out then; the line technology\'s fees; its research spent 50/30/20; MY WAY\'s contract; every $ kept', () => {
  // (a country of 1,600: MAGITA's people — 2,800 of a full country — enough in it to make its dealer's cars the first month)
  const c = country(1600), { w, W } = c;
  c.days(2);
  assert.equal(w.co.mizukawa, undefined);
  c.days(1);
  const s = w.co.mizukawa, M = s.mz, sc = w.circ.scale;
  assert.ok(s && M.founded + 1 === FOUNDED);
  // (its 利益剰余金 out of アスカ国's treasury, once)
  assert.ok(Math.abs(s.bal.retained - R.seed * sc) < R.seed * sc * 0.05, String(s.bal.retained));
  assert.ok(Math.abs(W.asuka.month.out.mizukawaSeed - Math.round(R.seed * sc)) <= 1, JSON.stringify(W.asuka.month.out));
  // the three on sale from its first day, as given
  assert.deepEqual(Object.keys(M.products).sort(), ['mizukawa-enjin2', 'mizukawa-river-w', 'mizukawa-river-w-feat']);
  assert.deepEqual([M.products['mizukawa-river-w'].net, M.products['mizukawa-river-w-feat'].net, M.products['mizukawa-enjin2'].net], [11900000, 33900000, 2400000]);
  // MY WAY's contract till 2027-01-01, its own wish
  const k = w.co.myway.ip.contracts.mizukawa;
  assert.ok(k && k.on && k.until === CORP.dayAt(2027, 1, 1));
  c.days(2);
  // its people: アスカ国's (ATSUKA's posts, those out of work, the local trade's), by role, at the role's pay × its index
  const A = W.AP, J = asuka.JOB, byRole = R.roles.map(() => 0), asc = W.asuka.scale;
  for (let i = 0; i < A.n; i++) if (A.job[i] === J.mizukawa) {
    byRole[A.emp[i]]++;
    const role = R.roles[A.emp[i]];
    assert.ok(Math.abs(A.pay[i] - role.pay * 12 * M.payIdx) <= 12, `${A.pay[i]} ${role.id}`);
  }
  R.roles.forEach((r, j) => assert.ok(Math.abs(byRole[j] - Math.max(1, Math.round(r.n * asc * M.staffIdx))) <= 1, `${r.id} ${byRole[j]}`));
  assert.equal(s.n, byRole.reduce((a, b) => a + b, 0));
  // (RIVER W II out on 11/10, SUPER U, H1 and H1 SUPER on 11/30: each worked out on its day — its cost its base × the
  // price index, its research its price × its rate)
  c.days(26);
  assert.equal(CORP.ymd(W.day).m, 12);
  for (const id of ['mizukawa-river-w2', 'mizukawa-super-u', 'mizukawa-h1', 'mizukawa-h1-super']) {
    const x = M.products[id], pr = CORP.products.cars[id];
    assert.ok(x, id);
    assert.ok(x.index >= R.release.index[0] && x.index <= R.release.index[1]);
    assert.equal(x.cost, Math.round(pr.base * x.index / 1000) * 1000, id);
    assert.equal(x.research, Math.round(x.price * pr.rate / 1000) * 1000, id);
    assert.equal(x.net, x.price - x.cost - x.research - R.fee);
  }
  // (SUPER U: the least a unit of them)
  const nets = Object.entries(M.products).filter(([, x]) => x.kind === 'cars').map(([id, x]) => [id, x.net]).sort((a, b) => a[1] - b[1]);
  assert.equal(nets[0][0], 'mizukawa-super-u');
  // the line technology's fees from MAGITA (its share of its dealer's, its exports' and its gacha's)
  assert.ok((s.per.y['r:linetech'] || 0) > 0 && (w.co.magita.per.y.sTech || 0) > 0);
  // its month: its research spent — half its researchers', three tenths orders to others, two tenths kept as its worth
  const sp = M.spent, all = sp.pay + sp.orders + sp.asset;
  assert.ok(all > 0, JSON.stringify(sp));
  assert.ok(Math.abs(sp.pay / all - 0.5) < 0.01 && Math.abs(sp.orders / all - 0.3) < 0.01 && Math.abs(sp.asset / all - 0.2) < 0.01, JSON.stringify(sp));
  assert.ok(M.asset > 0 && M.hist.length >= 1);
  // (its pay index moved by what it earned, within its bounds)
  assert.ok(M.payIdx >= R.pay.min && M.payIdx <= R.pay.max);
  // what it sold: to the players and the people of ヴェルノア (its stock, as many as it makes) and of アスカ国
  const sold = Object.values(M.sold).reduce((a, b) => a + b, 0);
  assert.ok(sold > 0 || (M.asuka || 0) > 0, JSON.stringify({ sold: M.sold, asuka: M.asuka }));
  for (const [id, n] of Object.entries(M.sold)) assert.ok(n <= Math.ceil((CORP.products.cars[id] || CORP.products.items[id]).limit * sc) + 1, id);
  for (const x of Object.values(w.co)) { const b = corpModel.equityOf(x); assert.ok(Number.isFinite(b), x.id); }
  assert.equal(c.worst, 0);
});

test('a model out after HIGA MASTER: its cost seven tenths; once WAZIMA is its, its research ÷1.2', () => {
  const key = Buffer.alloc(32, 41), ch = corpModel.chance(key), launch = Math.floor(START / DAY);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  for (let d = launch; d < FOUNDED; d++) corpModel.closeDay(w, d, {}, ch);
  const s = w.co.mizukawa, M = s.mz, d = FOUNDED;
  assert.ok(s && !M.higa.done);
  const pr = CORP.products.cars['mizukawa-super-u2'];
  const before = corpModel.mizukawaRelease(w, 'cars', 'mizukawa-super-u2', d, true);
  assert.equal(before.cost, Math.round(pr.base * before.index / 1000) * 1000);
  M.higa.done = d;
  const higa = corpModel.mizukawaRelease(w, 'cars', 'mizukawa-super-u2', d, true);
  assert.equal(higa.cost, Math.round(pr.base * higa.index * 0.7 / 1000) * 1000);
  assert.equal(higa.research, Math.round(22000000 * pr.rate / 1000) * 1000);
  M.wazima = { day: d, price: 0 };
  const faster = corpModel.mizukawaRelease(w, 'cars', 'mizukawa-super-u2', d, true);
  assert.equal(faster.research, Math.round(22000000 * pr.rate / 1.2 / 1000) * 1000);
});

test('WAZIMA bought of MAGITA at its worth and a quarter more (Tenesice lending what its cash does not cover), its month settled with MAGITA first; the four of MAGITA\'s economy at their worth and a share more', () => {
  const key = Buffer.alloc(32, 43), ch = corpModel.chance(key), launch = Math.floor(START / DAY);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  let bought = null;
  for (let d = launch; d < launch + 200 && !bought; d++) {
    const mg = w.co.magita.bal.cash;
    const out = corpModel.closeDay(w, d, {}, ch);
    for (const s of Object.values(w.co)) assert.equal(corpModel.assetsOf(s), corpModel.liabilitiesOf(s) + corpModel.equityOf(s), `${s.id} on ${d}`);
    if (w.co.mizukawa && w.co.mizukawa.mz.wazima) {
      bought = { d, out, mg };
      // (today its month MAGITA's still; MIZUKAWA's from tomorrow)
      assert.equal(w.co.wazima.owner, 'mizukawa');
      assert.equal(w.co.wazima.toParent.to, 'magita');
    }
  }
  assert.ok(bought, 'bought within 200 days');
  const s = w.co.mizukawa, M = s.mz;
  assert.ok(M.wazima.day - M.founded >= R.wazima.after && CORP.isMonthEnd(M.wazima.day));
  // (MAGITA's gain on it, its 特別利益; what MIZUKAWA's cash did not cover, Tenesice's loan)
  assert.equal(w.co.magita.per.y.xSubsidiary, M.wazima.price);
  assert.ok(M.wazima.price > corpModel.fairValue(w.co.wazima, CORP.company('wazima'), w) * 1.1);
  assert.ok(s.loans.every((l) => l.amt > 0 && l.from === M.wazima.day));
  assert.ok(bought.out.news.some((n) => n.company === 'mizukawa' && /WAZIMAをMAGITAから/.test(n.text)));
  // the four: their worth seen on the people's side, bought a month on
  w.localsSeen = R.locals.firms.map((id) => ({ id, name: id, equity: 1000000, dead: null }));
  for (let d = bought.d + 1; d < bought.d + 70 && !M.locals; d++) corpModel.closeDay(w, d, {}, ch);
  assert.ok(M.locals && M.locals.bought.length === 4, JSON.stringify(M.locals));
  for (const x of M.locals.bought) assert.ok(x.price >= 1000000 * (1 + R.locals.premium[0]) - 1 && x.price <= 1000000 * (1 + R.locals.premium[1]) + 1);
  assert.ok(s.goodwill.some((g) => g.feature === 'local:mgmaterial'));
  assert.ok(Array.isArray(w.mzLocalsBuy) && w.mzLocalsBuy.length === 4);
});

test('the four taken into it on the people\'s side: their owner paid, their people let go, their debts settled — every $ kept', () => {
  const c = country(700, 29), { w, W } = c;
  c.days(1);
  const id = R.locals.firms[0], f = W.locals.firms[id];
  assert.ok(f && !f.dead);
  const before = npc.moneyOf(W, w);
  // (what MIZUKAWA paid, out of its cash — the same day its books' —)
  const price = 5000000;
  corpModel.post(w.co.carowner, [['cash', -price], ['eOther', price]], 'expenses');
  local.closeIntoMizukawa(W, [{ id, price }], W.day + 1);
  assert.ok(f.dead && f.mizukawa && f.dead.price === price);
  assert.equal(npc.moneyOf(W, w), before);
  // (a firm absorbed is no longer one to rebuild)
  assert.equal(f.staff, 0);
});

let srv;
after(() => srv && srv.stop());
test('a player at MIZUKAWA GARAGE: before its day not yet on sale; from it, at its list price on no sale, MIZUKAWA\'s sale, one fewer in its stock', async () => {
  let now = Date.UTC(2026, 10, 3, 2, 0, 0);
  srv = await startServer({ clock: () => now, operators: ['boss'], corpHistory: 0, npc: true, npcPopulation: 400 });
  const p = await srv.register('MzBuyer');
  srv.setUser(p.me.id, { dollars: 2000000000, garage_extra: 9 });
  const look = () => srv.call('GET', '/api/stocks', { token: p.token });
  await look();
  await srv.app.api.npcWake();
  const early = await srv.call('POST', '/api/cars/buy', { token: p.token, body: { model: 'mizukawa-river-w' } });
  assert.equal(early.status, 409);
  assert.equal(early.error.code, 'not_yet');
  for (let d = 0; d < 3; d++) { now += DAY; await look(); await srv.app.api.npcWake(); }
  const g = await srv.call('GET', '/api/cars', { token: p.token });
  const left = srv.app.api.npc.carStock().cars['mizukawa-river-w'];
  assert.ok(left > 0, String(left));
  const r = await srv.call('POST', '/api/cars/buy', { token: p.token, body: { model: 'mizukawa-river-w', price: 25000000 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.paid, 25000000);
  assert.equal(srv.app.api.npc.carStock().cars['mizukawa-river-w'], left - 1);
  assert.ok(g.catalog.some((c) => c.id === 'mizukawa-river-w'));
  // (its engine at the Shop: its list price, from MIZUKAWA GARAGE)
  const e = await srv.call('POST', '/api/shop/buy', { token: p.token, body: { id: 'mizukawa-enjin2', count: 1 } });
  assert.equal(e.status, 200, JSON.stringify(e));
});
