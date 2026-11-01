// MY WAY, the character IP company: its numbers, its partners' fees and what they sell of its characters, its
// people's measures and the partners' contracts (given up, signed again, their fees talked over), Tenesice's 15% and the
// ranks (C at 10%), and its failure (倒産: what it has pays its people, its bills and the bank, the bank loses the rest,
// its people are let go, its shares are struck off); its people in the country (their pay by its own ladder, its
// executives by their titles) and the people's purchases of its collaborations: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import * as model from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as org from '../core/npc-org.js';
import { CORP, NPC, RULES, STOCKS } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const launch = Math.floor(START / 86400000);
const MIN = 60000;
const M = CORP.myway;
const books = (s) => {
  let a = 0, le = 0;
  for (const [k, v] of Object.entries(s.bal)) { const kind = CORP.account(k)[1]; if (kind === 'a') a += v; else le += v; }
  return [a, le];
};
// a world with the country living on it (`n` people, or none), and its days
function world({ years = 0, n = 0, seed = 41 } = {}) {
  const key = Buffer.alloc(32, seed), ch = model.chance(key);
  const { world: w } = model.boot(key, launch, { years, prices: { riru: 12000, ice: 30000 } });
  let W = null, ctx = null, m = Math.floor(START / MIN);
  if (n) {
    W = npc.boot(key, START, w, { n });
    model.startCirculation(w, launch, n / 50000);
    const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000 };
    ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  }
  let d = launch;
  return {
    w, W, ch, ctx,
    // the next `k` days; `ops`: decisions of the companies' people for the first of them (with no country: as if it had them)
    days(k, ops = []) {
      const outs = [];
      for (let x = 0; x < k; x++, d++) {
        let flows = {};
        if (W) {
          for (; m < (d + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
          flows = { npc: npc.flowsFor(W, d) };
          if (x === 0 && ops.length) flows.npc.ops.push(...ops);
        } else if (x === 0 && ops.length) {
          if (!w.circ) model.startCirculation(w, d, 0.02);
          flows = { npc: { co: {}, bank: { deposits: 0, loans: 0, credit: 0, nii: 0, fees: 0, rate: 0.002 }, charges: [], staff: {}, raises: {}, terms: {}, lend: {}, ops } };
        }
        const out = model.closeDay(w, d, flows, ch);
        if (W) npc.nextDay(W, d, out.ext, ctx);
        outs.push(out);
      }
      return outs;
    },
    day: () => d
  };
}

test('the rules: MY WAY as given — 1,250 people at $16.3M a head, $45B of sales from seven partners and its showroom, 56% paid out, listed; ranks to C at 10%', () => {
  const p = CORP.company('myway');
  assert.deepEqual([p.staff, p.cost, p.place.amount, p.rd.amount, p.sales, p.op, p.capital, p.retained, p.payout, p.listed],
    [1250, 16300000, 325000000, 900000000, 45000000000, 23400000000, 2000000000, 25200000000, 0.56, true]);
  // (its operating profit is its sales less its people and its two costs: 52%)
  assert.equal(p.sales - p.staff * p.cost - p.place.amount - p.rd.amount, p.op);
  const fees = Object.values(M.partners).reduce((n, x) => n + x.fee, 0);
  assert.equal(fees + M.direct, p.sales);
  assert.deepEqual(Object.keys(M.partners).sort(), ['carowner', 'dtrade', 'ice', 'jinx', 'magita', 'riru', 'tenesice']);
  assert.equal(M.partners.jinx.fee, 15000000000);
  assert.equal(M.partners.magita.fee + M.partners.carowner.fee, 10000000000);
  // every partner earns on it at full pull, and loses on it well below
  for (const id of Object.keys(M.partners)) assert.ok(CORP.breakeven(id) < 1 && CORP.breakeven(id) > 0.4, id);
  assert.deepEqual([M.loanRate, M.idea, M.hype], [0.15, 500000, [0.2, 0.35]]);
  assert.deepEqual(CORP.ranks.C.rate, [0.1, 0.1]);
  assert.ok(CORP.ranks.B.rate[0] > CORP.ranks.A.rate[1] && CORP.ranks.B.rate[1] < CORP.ranks.C.rate[0]);
  assert.ok(STOCKS.companies.some((c) => c.id === 'myway'));
  // its pay ladder: the 社長 $650M and the CEO $450M against an average of $13M; its officers named
  assert.ok(Math.abs(NPC.rankPay('myway', 5) * p.salary - 650000000) < 5000000);
  assert.ok(Math.abs(NPC.rankPay('myway', 6) * p.salary - 450000000) < 5000000);
  assert.equal(NPC.rankPay('magita', 6), NPC.ranks[6].pay);
  assert.deepEqual(NPC.officers.myway.slice(0, 3).map((x) => x.slice(0, 3)), ['CCO', 'CFO', 'COO']);
  assert.ok(NPC.companies.includes('myway') && NPC.districts[3].hq.includes('myway'));
});

test('its books at the start: about $45B of sales and $23.4B of operating profit a year, $25.2B retained; its partners pay their fees and sell its characters', () => {
  const { w } = world({ years: 1 });
  const s = w.co.myway, y = s.hist.filter((h) => h.kind === 'y').slice(-1)[0];
  assert.ok(Math.abs(y.sales / 45e9 - 1) < 0.03, `${y.sales}`);
  assert.ok(Math.abs(y.op / 23.4e9 - 1) < 0.08, `${y.op}`);
  assert.ok(Math.abs(y.net / 16.38e9 - 1) < 0.08, `${y.net}`);
  assert.equal(s.bal.retained, 25200000000);
  assert.equal(s.bal.capital, 2000000000);
  // (its guidance pays out 56% of what it expects)
  assert.ok(Math.abs(s.div.total / Math.max(1, s.guide.net) - 0.56) < 0.01);
  for (const [id, c] of Object.entries(s.ip.contracts)) {
    assert.ok(c.on && c.fee === M.partners[id].fee, id);
    const t = w.co[id];
    // the partner's year: its fee a cost, what it sold of the characters a sale
    const yr = t.hist.filter((h) => h.kind === 'y').slice(-1)[0];
    assert.ok(yr, id);
  }
  // a partner's statements carry the fee and the collaboration
  const jinx = w.co.jinx;
  assert.ok((jinx.per.y.sLicense || 0) > 0 && (jinx.per.y['r:myway'] || 0) > (jinx.per.y.sLicense || 0));
  for (const s2 of Object.values(w.co)) { const [a, le] = books(s2); assert.equal(a, le, s2.id); }
});

test('its people\'s measures and its partners\' decisions: a new character, the copies fought, a campaign, the care cut (never the pay), the fees talked over, a contract given up and signed again', () => {
  const x = world();
  const s = x.w.co.myway, ip = s.ip;
  ip.heat = 0.6; ip.brand = 0.5; ip.fakes = 0.5;
  const unit = s.unit, pay = s.pay;
  let outs = x.days(1, [{ company: 'myway', kind: 'ip', action: 'legal' }, { company: 'myway', kind: 'ip', action: 'pr' }, { company: 'myway', kind: 'ip', action: 'care' },
    { company: 'myway', kind: 'ip', action: 'newchar' }, { company: 'myway', kind: 'ip', action: 'fee', partner: 'jinx', mult: 1.5 }]);
  assert.ok(ip.fakes <= 0.25 + 1e-9, `${ip.fakes}`);
  assert.ok(ip.brand > 0.5);
  assert.ok(ip.heat >= 0.6 - 0.01);
  assert.equal(s.pay, pay);
  assert.ok(s.unit < unit && s.unit - s.pay >= (CORP.company('myway').cost - CORP.company('myway').salary) * M.care.floor - 1);
  // (a fee moves at most 8% a time)
  assert.equal(ip.contracts.jinx.fee, Math.round(M.partners.jinx.fee * 1.08 / 1e6) * 1e6);
  assert.ok(s.per.y.sMeasure >= M.legal.cost + M.pr.cost + M.newChar.cost);
  // a partner gives it up: no more fees; MY WAY's shares fall, the partner's dip
  const fee = (id) => x.w.co[id].per.d.sLicense || 0;
  outs = x.days(1, [{ company: 'magita', kind: 'license', action: 'cancel', why: '採算割れのため' }]);
  assert.equal(ip.contracts.magita.on, false);
  assert.equal(fee('magita'), 0);
  assert.ok(fee('carowner') > 0);
  assert.ok(outs[0].news.some((n) => n.company === 'myway' && n.kind === 'license' && /MAGITA/.test(n.text)));
  assert.ok(outs[0].jumps.some((j) => j.company === 'myway' && j.jump < 0));
  // MY WAY offers it lower, it signs again: its shares jump 20〜35% (投資熱)
  outs = x.days(1, [{ company: 'myway', kind: 'ip', action: 'win', partner: 'magita' }]);
  assert.equal(ip.contracts.magita.fee, Math.round(M.partners.magita.fee * (1 - M.win.off) / 1e6) * 1e6);
  outs = x.days(1, [{ company: 'magita', kind: 'license', action: 'sign', why: 'テスト' }]);
  assert.equal(ip.contracts.magita.on, true);
  const jump = outs[0].jumps.find((j) => j.company === 'magita');
  assert.ok(jump && jump.jump >= Math.log(1.2) - 1e-9 && jump.jump <= Math.log(1.35) + 1e-9, JSON.stringify(jump));
  x.days(1);
  assert.ok(fee('magita') > 0);
  // a partner's shares are worth more while its contract runs
  const t = x.w.co.magita, p = CORP.company('magita');
  const on = model.fairValue(t, p, x.w);
  ip.contracts.magita.on = false;
  assert.ok(model.fairValue(t, p, x.w) < on);
  ip.contracts.magita.on = true;
  for (const s2 of Object.values(x.w.co)) { const [a, le] = books(s2); assert.equal(a, le, s2.id); }
});

test('with nobody to decide, a partner losing on its contract two months running gives it up; MY WAY borrows at 15%, no more than half its equity', () => {
  const x = world();
  const s = x.w.co.myway, ip = s.ip;
  // the characters gone cold: every partner loses on them
  ip.heat = 0.1; ip.brand = 0.4;
  // (and nothing new comes of its research: it is cut)
  s.budget.rd = 0;
  const outs = x.days(75);
  ip.heat = Math.min(ip.heat, 0.1);
  assert.ok(Object.values(ip.contracts).every((c) => !c.on), JSON.stringify(Object.values(ip.contracts).map((c) => c.on)));
  assert.ok(outs.some((o) => o.news.some((n) => n.kind === 'license' && /打ち切り/.test(n.text))));
  // its loans, when it borrows, at 15%
  for (const l of s.loans) assert.equal(l.rate, M.loanRate);
});

test('倒産: out of money with nothing more to borrow it fails — its people paid, the bank repaid what can be and losing the rest, its contracts ended, its shares struck off; the books balance', () => {
  const x = world();
  const s = x.w.co.myway, ip = s.ip, bank = x.w.co.tenesice;
  for (const c of Object.values(ip.contracts)) c.on = false;
  ip.heat = 0.05;
  // (its money gone and its equity with it, a loan still owed: nothing more Tenesice will lend)
  const take = (s.bal.cash || 0) + (s.bal.bonds || 0) - 1000000;
  s.bal.bonds = 0;
  s.bal.cash = 1000000;
  s.bal.retained -= take;
  s.loans.push({ id: 'Lx', amt: 2000000000, rate: M.loanRate, from: x.day(), until: x.day() + 1000 });
  s.bal.cash += 2000000000;
  s.bal.loan = (s.bal.loan || 0) + 2000000000;
  // (the bank holds it as a loan, and the money as a deposit)
  bank.bal.lent += 2000000000; bank.bal.cash -= 2000000000;
  bank.inGame = null;
  const credit = bank.per.y.sCredit || 0;
  let dead = null, outs = [];
  for (let k = 0; k < 70 && !s.dead; k++) outs.push(...x.days(1));
  dead = s.dead;
  assert.ok(dead, 'it failed');
  assert.ok(CORP.isMonthEnd(dead.day));
  assert.equal(s.n, 0);
  assert.equal(s.loans.length, 0);
  assert.ok(Object.values(ip.contracts).every((c) => !c.on));
  assert.deepEqual([s.div.dps, s.div.total], [0, 0]);
  assert.ok(dead.loss > 0 && dead.debt >= 2000000000);
  // the bank lost what it was not repaid
  assert.ok((bank.per.y.sCredit || 0) - credit >= dead.loss);
  const last = outs[outs.length - 1];
  assert.ok(last.bankrupt && last.bankrupt.includes('myway'));
  assert.ok(last.news.some((n) => n.company === 'myway' && n.kind === 'bankrupt'));
  assert.ok(last.jumps.some((j) => j.company === 'myway' && j.jump <= -3));
  for (const s2 of Object.values(x.w.co)) { const [a, le] = books(s2); assert.equal(a, le, s2.id); }
  // from then on: nothing; its share's centre at $1
  const cash = s.bal.cash, after = x.days(3);
  assert.equal(s.bal.cash, cash);
  const anchor = after[2].anchors.find((a) => a.company === 'myway');
  assert.deepEqual([anchor.e0, anchor.e1, anchor.dps], [0, 0, 0]);
  assert.ok(after.every((o) => o.days.find((r) => r.company === 'myway').sales === 0));
});

test('its people in the country: hired by its skills, paid by its own ladder (the 社長 above the CEO, far above the rest), its executives named; the people buy its collaborations; failed, they are let go', () => {
  const x = world({ n: 3000 });
  const { W, w } = x, P = W.P;
  const staff = W.staffOf('myway');
  assert.ok(staff.length > 20, `${staff.length}`);
  const o = W.orgs.myway, avg = staff.reduce((n, i) => n + P.salary[i], 0) / staff.length;
  assert.ok(o.president >= 0 && o.ceo >= 0);
  assert.ok(P.salary[o.president] > P.salary[o.ceo], 'the 社長 is paid more than the CEO');
  const rank0 = staff.filter((i) => P.rank[i] === 0).map((i) => P.salary[i]).sort((a, b) => a - b);
  assert.ok(P.salary[o.president] > 30 * rank0[Math.floor(rank0.length / 2)], `${P.salary[o.president]} ${avg}`);
  const titles = org.posts(W, o.officers[0]).join();
  assert.ok(/CCO/.test(titles), titles);
  assert.ok(o.depts.some((d) => d.roles.some(([k]) => k === 'negotiator')) && o.depts.some((d) => d.kind === 'review'));
  // a few days: the people buy its characters at its partners and its showroom
  x.days(4);
  assert.ok((w.co.jinx.per.y['r:myway'] || 0) > 0);
  assert.ok((w.co.myway.per.y['r:direct'] || 0) > 0);
  assert.ok(Object.values(w.co.myway.ip.contracts).every((c) => c.m.fee > 0 || c.last));
  // failed: all of them out of work, the benefit theirs
  const was = W.staffOf('myway').slice();
  const gone = npc.failed(W, 'myway', W.day);
  assert.equal(gone, was.length);
  assert.equal(W.staffOf('myway').length, 0);
  assert.ok(was.every((i) => P.job[i] === NPC.job.none && P.jobless[i] > 0));
  assert.ok(W.news.some((n) => /倒産/.test(n.text)));
});

test('the server: MY WAY is on the market, and once struck off its orders are refused and those waiting go', async (t) => {
  let now = Date.UTC(2026, 10, 2, 20, 0, 0) + 123;
  const s = await startServer({ clock: () => now, corpHistory: 0, limits: { stock: [100000, 1000], general: [100000, 1000], login: [100000, 1000] } });
  t.after(() => s.stop());
  const p = await s.register('Fan');
  s.setUser(p.me.id, { dollars: 100000000 });
  let r = await s.call('GET', '/api/stocks', { token: p.token });
  const q = r.market.find((x) => x.id === 'myway');
  assert.ok(q && q.price > 0);
  assert.ok(r.corp.myway && r.corp.myway.ip && r.corp.myway.ip.partners === 7);
  assert.equal(r.corp.jinx, undefined);
  assert.equal(r.corp.magita.collab, true);
  r = await s.call('POST', '/api/stocks/order', { token: p.token, body: { key: 'mw-key-1aaaaaa', company: 'myway', side: 'buy', type: 'market', shares: 10 } });
  assert.equal(r.status, 200, JSON.stringify(r));
  const lim = await s.call('POST', '/api/stocks/order', { token: p.token, body: { key: 'mw-key-2aaaaaa', company: 'myway', side: 'buy', type: 'limit', shares: 5, price: q.price - 300 } });
  assert.equal(lim.order.status, 'open');
  // (it fails)
  const corp = s.app.api.corp, w = corp.world();
  w.co.myway.dead = { day: w.day, why: 'テスト', debt: 0, repaid: 0, loss: 0, staff: 1250 };
  s.app.db.prepare('UPDATE corp_state SET data = ? WHERE id = ?').run(JSON.stringify(w.co.myway), 'myway');
  r = await s.call('POST', '/api/stocks/order', { token: p.token, body: { key: 'mw-key-3aaaaaa', company: 'myway', side: 'sell', type: 'market', shares: 1 } });
  assert.equal(r.error.code, 'delisted');
  now += 2000;
  r = await s.call('GET', '/api/stocks', { token: p.token });
  assert.ok(r.corp.myway.delisted);
  const o = s.app.db.prepare('SELECT status, reason FROM stock_orders WHERE id = ?').get(lim.order.id);
  assert.deepEqual([o.status, o.reason], ['canceled', 'delisted']);
});

test('倒産 in a living country: its people let go by the country the day after, and every $ still goes from someone to someone', () => {
  const x = world({ n: 800 });
  const { W, w } = x, s = w.co.myway;
  const money = () => {
    const P = W.P;
    let m = 0;
    for (let i = 0; i < P.n; i++) m += P.cash[i] - P.debt[i] + P.tokens[i];
    m += W.nation.cash - W.nation.bank + W.nation.fund.cash + W.districts.reduce((a, d) => a + d.cash, 0) + W.sector.cash;
    for (const id of NPC.companies) {
      const c = w.co[id];
      if (id === 'tenesice') m += (c.bal.cash || 0) + (c.bal.lent || 0) + (c.bal.bonds || 0) - (c.bal.deposits || 0);
      else m += (c.bal.cash || 0) - c.loans.reduce((a, l) => a + l.amt, 0);
    }
    return m + npc.econ.pending(W) + W.sum.imports - (W.sum.exports || 0) + W.sum.toPlayers - W.sum.fromPlayers;
  };
  // (its money and what it is owed gone, its equity with them: nothing Tenesice will lend)
  s.ip.heat = 0.05; s.ip.brand = 0.3;
  const take = (s.bal.cash || 0) + (s.bal.bonds || 0) - 1000000;
  s.bal.bonds = 0; s.bal.cash = 1000000; s.bal.retained -= take;
  for (const t of Object.values(w.co)) { const n = (t.owe && t.owe.myway) || 0; if (n) { t.owe.myway = 0; t.bal.ap -= n; t.bal.retained += n; } }
  s.bal.retained -= (s.bal.ar || 0) + (s.bal.ppe || 0); s.bal.ar = 0; s.bal.ppe = 0; s.recv = 0;
  w.co.tenesice.inGame = null;
  const staff = W.staffOf('myway').length, before = money();
  assert.ok(staff > 0);
  for (let k = 0; k < 40 && !s.dead; k++) x.days(1);
  assert.ok(s.dead, 'it failed');
  assert.equal(W.staffOf('myway').length, 0);
  assert.ok(W.orgs.myway.dead);
  // (and after it: what the country still sends it, the local businesses take)
  x.days(8);
  assert.ok(Math.abs(money() - before) < 800 * 50, `${money() - before}`);
  assert.ok(W.news.some((n) => n.data && n.data.company === 'myway' && /倒産/.test(n.text)));
});
