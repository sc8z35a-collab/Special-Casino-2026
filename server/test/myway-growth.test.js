// MY WAY from 2026-11-03 (js/game/corp.js MYWAY, server/core/corp-model.js ipCatchUp, ipTalks, mywayGrow; the local
// companies' and the countries' contracts: server/core/npc-ipdeals.js), its collaboration cars (collabShare), and the
// six companies' hours of 本当のリアルタイム稼ぎ (server/core/corp.js hourTick): every $ from someone to someone: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as deals from '../core/npc-ipdeals.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NPC, RULES, CORP } from '../core/rules.js';
import { openDb } from '../node/sqlite.js';
import { statements } from '../core/db.js';
import { createTransactions } from '../core/transactions.js';
import { createCorp } from '../core/corp.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const MIN = 60000;

function country(n = 800, seed = 9) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000, myway: 50000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  let worst = 0;
  return {
    w, W, ctx, ch, prices,
    days(k, each = () => {}) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const out = corpModel.closeDay(w, day, { npc: npc.flowsFor(W, day) }, ch);
        each(day, out);
        npc.nextDay(W, day, out.ext, ctx);
        const L = npc.ledgerDay(W, w, day);
        worst = Math.max(worst, Math.abs(L.days[L.days.length - 1].moved));
      }
    },
    get worst() { return worst; }
  };
}

test('the rules: every other one of the thirteen MY WAY\'s partner, Tenesice\'s alone a 超大型 contract (and up to four times its size), the daily talk', () => {
  const M = CORP.myway, ids = CORP.companies.map((c) => c.id).filter((id) => id !== 'myway');
  assert.deepEqual(Object.keys(M.partners).sort(), ids.sort());
  const biggest = Object.entries(M.partners).sort((a, b) => b[1].fee - a[1].fee)[0][0];
  assert.equal(biggest, 'tenesice');
  assert.deepEqual(CORP.scaleRange('tenesice'), M.scale.huge);
  assert.deepEqual(CORP.scaleRange('jinx'), M.scale.range);
  assert.ok(M.scale.huge[1] > M.scale.range[1]);
  // (a talk: nothing most days; a partner earning far beyond its fee takes a bigger contract, one losing a smaller one
  // or a cut)
  const c = { fee: 1e9, base: 1e9, scale: 1 };
  assert.deepEqual(CORP.mywayTalk(c, { share: 2, pull: 1.1, u: [0.99, 0, 0] }), { fee: 1, scale: 1, said: '' });
  assert.equal(CORP.mywayTalk(c, { share: 2, pull: 1.1, u: [0, 0, 0] }).scale, M.scale.step);
  assert.ok(CORP.mywayTalk(c, { share: 0.5, pull: 1, u: [0, 0.9, 0.5] }).fee > 1);
  const down = CORP.mywayTalk(c, { share: -0.3, pull: 1, u: [0, 0.1, 0.5] });
  assert.ok(down.scale < 1 || down.fee < 1);
});

test('a month of it: the thirteen all its partners from 2026-11-03, Tenesice\'s contract the 超大型 one; its talks every day; beyond its equity\'s aim into its economy and YAMATO; the local companies\' and the countries\' contracts paid; every $ kept', () => {
  const c = country(800);
  const { w, W } = c;
  const s = w.co.myway;
  assert.equal(Object.keys(s.ip.contracts).length, 7);
  c.days(33);
  const ip = s.ip;
  // (the twelve, and HACHI's five years from its founding on 2026-11-04)
  assert.equal(Object.keys(ip.contracts).length, 13);
  assert.ok(ip.contracts.hachi && ip.contracts.hachi.from === CORP.dayAt(2026, 11, 4) && ip.contracts.hachi.term === 5 && ip.contracts.hachi.until === ip.contracts.hachi.from + 5 * 365);
  assert.ok(ip.contracts.tenesice.huge && ip.contracts.tenesice.base === CORP.myway.partners.tenesice.fee);
  for (const id of ['yosida', 'wazima', 'daizin', 'citywork', 'speedeed']) assert.ok(ip.contracts[id].from >= CORP.dayAt(2026, 11, 3), id);
  // its 交渉係 talked with every partner each day
  assert.ok(ip.talks && ip.talks.n > 0);
  // what it put into its economy: the local companies, research, its people, 株式会社YAMATO — and YAMATO took it
  const g = s.grow;
  assert.ok(g && g.spent > 0 && g.by.sphere > 0 && g.by.rd > 0 && g.by.people > 0 && g.yamato > 0, JSON.stringify(g));
  assert.ok(g.hist.every((h) => h.aim >= CORP.myway.grow.equity[0] * w.circ.scale - 1 && h.aim <= CORP.myway.grow.equity[1] * w.circ.scale + 1));
  const Y = W.asuka.yamato;
  const fromMyway = Y.hist.reduce((n, h) => n + (h.by.myway || 0), 0) + (Y.m.rev.myway || 0);
  assert.ok(fromMyway > 0, 'YAMATO was given it');
  // the local companies' and the countries' contracts: their fees to MY WAY's books
  const v = deals.view(W);
  assert.ok(v && v.on > 0 && v.list.some((k) => k.kind === 'local'), JSON.stringify(v && v.list.map((k) => k.key)));
  const y = s.per.y;
  assert.ok((y['r:ipLocal'] || 0) > 0 || (y['r:ipNation'] || 0) > 0 || (y['r:ipAsuka'] || 0) > 0, 'the fees came');
  for (const x of Object.values(w.co)) { const b = corpModel.equityOf(x); assert.ok(Number.isFinite(b), x.id); }
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('a partner takes its contract a size up or down (its people\'s decision): its fee and what it sells with it, within its range', () => {
  const c = country(600);
  const { w } = c;
  c.days(3);
  // (a decision of a partner's 会議室, as its people's side passes it to the companies: npc-org.js partnerProposals)
  const decide = (company, mult) => corpModel.closeDay(w, w.day + 1, { npc: { ...npc.flowsFor(c.W, w.day + 1), ops: [{ company, kind: 'license', action: 'scale', mult, why: 'テスト' }] } }, c.ch);
  const k = w.co.myway.ip.contracts.jinx, fee = corpModel.contractFee(k), size = k.scale;
  decide('jinx', CORP.myway.scale.step);
  assert.ok(Math.abs(k.scale - Math.min(CORP.myway.scale.range[1], size * CORP.myway.scale.step)) < 1e-3, String(k.scale));
  assert.ok(corpModel.contractFee(k) > fee);
  for (let i = 0; i < 6; i++) decide('jinx', CORP.myway.scale.step);
  assert.equal(k.scale, CORP.myway.scale.range[1]);
  decide('jinx', 1 / CORP.myway.scale.step);
  assert.ok(k.scale < CORP.myway.scale.range[1]);
  // (Tenesice's 超大型 one goes up to four times; the others no more than twice)
  const t = w.co.myway.ip.contracts.tenesice;
  for (let i = 0; i < 10; i++) decide('tenesice', CORP.myway.scale.step);
  assert.equal(t.scale, CORP.myway.scale.huge[1]);
});

test('a collaboration car sold to the dealer: the maker\'s profit on it shared with MY WAY (MAGITA 4:6, YOSIDA 3:7)', () => {
  const key = Buffer.alloc(32, 7), ch = corpModel.chance(key);
  const launch = CORP.dayAt(2026, 11, 3);
  const { world: w } = corpModel.boot(key, launch, { years: 0 });
  const before = { mw: w.co.myway.per.y['r:collabCars'] || 0 };
  for (let d = launch; d < launch + 40; d++) corpModel.closeDay(w, d, {}, ch);
  const got = (w.co.myway.per.y['r:collabCars'] || 0) - before.mw;
  assert.ok(got > 0, 'MY WAY was paid its share');
  const by = w.co.myway.collabCars;
  for (const [maker, share] of [['magita', 0.6], ['yosida', 0.7]]) {
    const k = by[maker];
    assert.ok(k && k.n > 0, maker);
    assert.ok(Math.abs(k.share / k.profit - share) < 0.01, `${maker} ${k.share / k.profit}`);
  }
  // (the dealer's own on them: −$6M, −$5M, −$7M a MAGITA one, $1.5M a YOSHIDA S6 WAY)
  const P = CORP.products.cars, net = (id) => RULES.cars.find((c) => c.id === id).price - P[id].buy - P[id].excl;
  assert.deepEqual(['magita-speed-r-feat', 'magita-k120-feat', 'magita-dr1-feat', 'yoshida-s6-way'].map(net), [-6000000, -5000000, -7000000, 1500000]);
});

test('the six companies\' hours of 本当のリアルタイム稼ぎ: a row an hour, the players\' money in it, the companies\' trade and costs at an hour of the last day closed', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corp-hours-'));
  const db = openDb(dir);
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const { run: tx, afterCommit } = createTransactions(db);
  const T0 = Date.UTC(2026, 10, 3, 1, 0, 0);
  let now = T0;
  const corp = createCorp({ q: statements(db), tx, afterCommit, secret: 'hours', history: 0, clock: () => now });
  tx(() => { corp.ensure(Math.floor(T0 / 1000) - 86400 * 2); while (corp.closesAt() <= Math.floor(now / 1000)) corp.close(); });
  corp.hourTick(now);
  now += 3600000;
  tx(() => corp.flow('myway', 'icons', 500000));
  corp.hourTick(now);
  now += 3 * 3600000;
  corp.hourTick(now);
  const h = corp.hoursOf('myway', now);
  assert.ok(h && h.hours.length >= 4, JSON.stringify(h && h.hours));
  const real = h.hours.filter((x) => !x.first);
  assert.equal(real[0].players, 500000);
  assert.ok(real.slice(1).every((x) => x.slept && x.players === 0));
  assert.ok(real.every((x) => x.earned === x.direct + x.trade + x.other - x.cost));
  assert.equal(corp.hoursOf('jinx', now), null);
  for (const id of ['myway', 'ice', 'riru', 'magita', 'yosida', 'tenesice']) assert.ok(corp.hoursOf(id, now).hours.length >= 4, id);
});

test('a studio\'s day expected before the first close of a living country (its money of late not there yet): the hours of ICE SMOKER and RIRU are kept too', () => {
  const key = Buffer.alloc(32, 8);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  corpModel.startCirculation(w, launch, 0.02);
  for (const id of ['ice', 'riru']) {
    const s = w.co[id];
    delete s.pr;
    assert.doesNotThrow(() => corpModel.expectDay(w, s, corpModel.PROFILES.get(id), launch), id);
  }
});
