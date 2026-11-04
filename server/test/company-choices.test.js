// The companies' own say on their money and their contracts (server/core/npc-org.js moneyProposals, mywayProposals,
// partnerProposals; server/core/corp-model.js decided): テネシスファンド applied to (and turned down without the need),
// loans paid back early or borrowed to grow on, the dividends' share, テネシスリサーチ left and joined again, MY WAY's
// pace and its gift to YAMATO, a partner's fee asked down; the meeting's choice by what each is worth, and the AI
// 経営アドバイザー's word weighed at the next: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import { NPC, RULES, CORP } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const MIN = 60000;

function country(n = 700, seed = 5) {
  const key = Buffer.alloc(32, seed), ch = corpModel.chance(key);
  const launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  const W = npc.boot(key, START, w, { n });
  corpModel.startCirculation(w, launch, n / 50000);
  const prices = { riru: 12000, ice: 30000, magita: 18000, tenesice: 60000, myway: 50000 };
  const ctx = { corp: w, stockPrice: (id) => prices[id], carPrice: (id) => (RULES.cars.find((c) => c.id === id) || {}).price, fair: {}, lastMonth: () => null };
  let m = Math.floor(START / MIN);
  let worst = 0;
  const x = {
    w, W, ctx, ch,
    // (a day closed with `ops`: decisions of the companies' 会議室 as the people's side passes them on)
    days(k, ops = null) {
      for (let d = 0; d < k; d++) {
        const day = Math.floor(m / 1440);
        for (; m < (day + 1) * 1440; m++) if (NPC.activeAt(m * MIN, W.first)) npc.tick(W, m, ctx);
        const flows = npc.flowsFor(W, day);
        if (ops && d === 0) flows.ops = [...(flows.ops || []), ...ops];
        const out = corpModel.closeDay(w, day, { npc: flows }, ch);
        npc.nextDay(W, day, out.ext, ctx);
        const L = npc.ledgerDay(W, w, day);
        worst = Math.max(worst, Math.abs(L.days[L.days.length - 1].moved));
        x.last = out;
      }
    },
    get worst() { return worst; }
  };
  return x;
}

test('テネシスファンド by a company\'s own application: turned down with money to spare, lent when it is short; at the month\'s end by itself only in an emergency', () => {
  const c = country();
  const { w } = c;
  c.days(3);
  const s = w.co.jinx, fundLoans = () => s.loans.filter((l) => l.fund).length;
  c.days(1, [{ company: 'jinx', kind: 'fund', action: 'apply' }]);
  assert.equal(fundLoans(), 0);
  assert.ok(w.fund.refused >= 1);
  // (its money gone to Tenesice's and its bonds to MAGITA's: the books balanced, every $ where it was)
  const b = s.bal.bonds || 0;
  if (b) { corpModel.post(s, [['bonds', -b], ['retained', b]]); corpModel.post(w.co.magita, [['bonds', b], ['retained', -b]]); }
  const x = Math.max(0, (s.bal.cash || 0) - 1e6);
  corpModel.post(s, [['cash', -x], ['retained', x]], 'expenses');
  corpModel.post(w.co.tenesice, [['cash', x], ['retained', -x]], 'receipts');
  c.days(1, [{ company: 'jinx', kind: 'fund', action: 'apply' }]);
  assert.equal(fundLoans(), 1, JSON.stringify(w.fund));
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('its loans, its dividends, テネシスリサーチ, MY WAY\'s pace and a partner\'s fee: each its own decision, every $ kept', () => {
  const c = country();
  const { w } = c;
  c.days(3);
  // borrowed to grow on, then paid back early
  const s = w.co.carowner, debt = () => s.loans.reduce((n, l) => n + l.amt, 0), d0 = debt();
  c.days(1, [{ company: 'carowner', kind: 'loan', action: 'borrow', months: 3 }]);
  assert.ok(debt() > d0, 'borrowed');
  // (paid back: what it has beyond the months of its costs it keeps — here, with its money doubled for it by Tenesice's)
  const d1 = debt(), x = d1 * 3;
  corpModel.post(w.co.tenesice, [['cash', -x], ['retained', x]], 'expenses');
  corpModel.post(s, [['cash', x], ['retained', -x]], 'receipts');
  c.days(1, [{ company: 'carowner', kind: 'loan', action: 'repay', share: 1 }]);
  assert.ok(debt() < d1, `${debt()} ${d1}`);
  // the dividends' share: a tenth more of what it pays out, whatever the times
  const p = CORP.company('ice');
  w.co.ice.payoutMult = undefined;
  const base = corpModel.payoutOf(p, { ...w, co: {} });
  c.days(1, [{ company: 'ice', kind: 'payout', mult: 1.1 }]);
  assert.equal(w.co.ice.payoutMult, 1.1);
  assert.ok(Math.abs(corpModel.payoutOf(p, { ...w, co: {} }) * 1.1 - corpModel.payoutOf(p, w)) < 1e-9 || corpModel.payoutOf(p, w) === 0.95, String(base));
  // テネシスリサーチ left: no fee, no loan, nothing faster; and joined again
  c.days(1, [{ company: 'wazima', kind: 'research', action: 'leave' }]);
  assert.equal(corpModel.researchMember(w, 'wazima'), false);
  const fees = w.research.fees;
  c.days(1);
  const perDay = Math.round(CORP.myway && 10e6 * w.circ.scale);
  assert.ok(w.research.fees - fees <= 2 * perDay + 1, 'only the other two paid');
  c.days(1, [{ company: 'wazima', kind: 'research', action: 'join' }]);
  assert.equal(corpModel.researchMember(w, 'wazima'), true);
  // MY WAY's pace (its equity's aim) and its gift to YAMATO
  // (from wherever its own meetings had it — and with any of theirs the same day)
  const aim0 = w.co.myway.growAim || 1;
  c.days(1, [{ company: 'myway', kind: 'myway', action: 'aim', mult: 0.8 }, { company: 'myway', kind: 'myway', action: 'yamato', n: 1e6 }]);
  assert.ok(w.co.myway.growAim <= Math.round(Math.max(0.25, aim0 * 0.8) * 100) / 100 && w.co.myway.growAim >= 0.25, `${aim0} → ${w.co.myway.growAim}`);
  // a partner's fee asked down: within MY WAY's band
  const k = w.co.myway.ip.contracts.dtrade, f0 = k.fee;
  c.days(1, [{ company: 'dtrade', kind: 'license', action: 'fee', mult: 0.95 }]);
  assert.ok(k.fee < f0 && k.fee >= k.base * CORP.myway.talks.floor);
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});

test('the meetings choose among what is on the table by what each is worth, and the AI 経営アドバイザー\'s choice is weighed at the next', () => {
  const c = country(900, 6);
  const { W } = c;
  // (the AI here: always the first of the choices it was given)
  const asked = [];
  W.aiAdvice = (company, day) => { asked.push([company, day]); return '1'; };
  c.days(40);
  assert.ok(Object.keys(W.aiAsked || {}).length > 0, 'its choices asked of the AI');
  assert.ok(asked.length > 0, 'its answer read');
  const advised = W.meetings.filter((m) => m.lines.some((l) => l.role === 'AI経営アドバイザー'));
  assert.ok(advised.length > 0, 'the AI\'s word in a meeting');
  // (the jobs for the host's AI: a company's state and its choices, numbered)
  assert.ok(W.ai.some((j) => j.kind === 'decide' && j.options.length >= 2 && j.state));
  // (and every kind of decision there is now on the tables: the money and the contracts among them)
  const kinds = new Set(W.meetings.map((m) => m.kind));
  assert.ok(kinds.size >= 5, [...kinds].join(','));
});

test('MY WAY\'s loans of its bubble (borrowed to grow on, by its plan) are not paid back early by a meeting\'s decision; another loan is', () => {
  const c = country(700, 7);
  const { w } = c;
  c.days(3);
  const s = w.co.myway;
  const x = 4e9;
  corpModel.post(w.co.tenesice, [['cash', -x], ['retained', x]], 'expenses');
  corpModel.post(s, [['cash', x], ['retained', -x]], 'receipts');
  // (borrowed of Tenesice as any loan is: corp-model.js decided 'borrow')
  for (const [id, bubble] of [['Lb', true], ['Lo', false]]) {
    s.loans.push({ id, amt: 1e9, rate: 0.02, from: w.day, until: w.day + 3650, ...(bubble ? { bubble } : {}) });
    corpModel.post(s, [['cash', 1e9], ['loan', -1e9]], 'borrow');
    w.mon['myway:borrowed'] = (w.mon['myway:borrowed'] || 0) + 1e9;
  }
  c.days(1, [{ company: 'myway', kind: 'loan', action: 'repay', share: 1 }]);
  const b = s.loans.find((l) => l.id === 'Lb'), o = s.loans.find((l) => l.id === 'Lo');
  assert.ok(b && b.amt === 1e9, 'its bubble\'s loan kept');
  assert.ok(!o || o.amt < 1e9, 'the other paid back');
  assert.ok(c.worst <= 1000, `ledger ${c.worst}`);
});
