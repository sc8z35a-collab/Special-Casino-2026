// Dtrade's casino: the fee on a big bet's win, the bets lost, the exchange fee and TWO STATE公式's monthly slot
// charge (paid, or taken after its days even below $0): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';

const C = RULES.casino, P = RULES.tokenPrice;
// 2026-10-20 12:00 Japan time
const OCT = Date.UTC(2026, 9, 20, 3, 0, 0);

async function server(t, now) {
  const clock = { at: now };
  const s = await startServer({ clock: () => clock.at, operators: ['boss'], corpHistory: 0 });
  t.after(() => s.stop());
  return { s, clock };
}
const flows = (s) => s.app.db.prepare('SELECT day, data FROM corp_flows ORDER BY day').all().map((r) => JSON.parse(r.data));

test('a big bet\'s win pays Dtrade 6% of it; the bets the players lose are Dtrade\'s, counted in memory and written now and then', async (t) => {
  const { s } = await server(t, OCT);
  const p = await s.register('roller');
  s.setUser(p.me.id, { tokens: 10000000 });
  let tokens = 10000000, lost = 0, fees = 0, wins = 0;
  for (let i = 0; i < 80 && wins < 3; i++) {
    const bet = i % 2 ? C.bigBet : 1000;
    const r = await s.call('POST', '/api/spin', { token: p.token, body: { bet } });
    assert.equal(r.status, 200, JSON.stringify(r));
    const total = r.result.total || 0, fee = r.result.fee || 0, back = r.result.charm ? r.result.charm.back : 0;
    assert.equal(fee, bet >= C.bigBet && total > 0 ? Math.floor(total * C.winFee) : 0);
    if (fee) wins++;
    tokens = tokens - bet + total + back - fee;
    assert.equal(r.balance.tokens, tokens);
    lost += Math.max(0, bet - total - back) * P;
    fees += fee * P;
  }
  assert.ok(wins > 0, 'a big bet won at least once');
  // (nothing written per spin: the money waits in memory, and goes into the day's row when it is written)
  s.app.api.corp.flush();
  const d = flows(s).reduce((a, f) => ({ casino: a.casino + ((f.dtrade || {}).casino || 0), winfee: a.winfee + ((f.dtrade || {}).winfee || 0) }), { casino: 0, winfee: 0 });
  assert.deepEqual(d, { casino: lost, winfee: fees });
});

test('changing tokens back to $ costs Dtrade\'s $40K each time', async (t) => {
  const { s } = await server(t, OCT);
  const p = await s.register('changer');
  s.setUser(p.me.id, { tokens: 100000, dollars: 0 });
  assert.equal((await s.call('POST', '/api/sell', { token: p.token, body: { amount: C.exchangeFee / P } })).error.code, 'below_fee');
  const r = await s.call('POST', '/api/sell', { token: p.token, body: { amount: 10000 } });
  assert.deepEqual([r.me.tokens, r.me.dollars], [90000, 10000 * P - C.exchangeFee]);
  assert.equal(flows(s).at(-1).dtrade.exchange, C.exchangeFee);
});

test('TWO STATE公式 bills a month\'s slot use when it ends, the bill is paid from the card, and one left unpaid is taken after its days, below $0 if need be', async (t) => {
  const { s, clock } = await server(t, OCT);
  const payer = await s.register('payer'), late = await s.register('late'), idle = await s.register('idle');
  for (const u of [payer, late]) {
    s.setUser(u.me.id, { tokens: 10000 });
    assert.equal((await s.call('POST', '/api/spin', { token: u.token, body: { bet: 100 } })).status, 200);
  }
  const bills = s.app.api.slotBills;
  // (in October: nothing yet)
  bills.housekeep();
  assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM slot_bills').get().n, 0);
  // November 1st, 6:00 Japan time: the housekeeping bills October's players (not the one who did not spin)
  clock.at = Date.UTC(2026, 9, 31, 21, 0, 0);
  bills.housekeep();
  bills.housekeep();
  const rows = s.app.db.prepare('SELECT * FROM slot_bills ORDER BY user_id').all();
  assert.deepEqual(rows.map((b) => [b.user_id, b.month, b.amount]), [[payer.me.id, '2026-10', C.monthly.amount], [late.me.id, '2026-10', C.monthly.amount]]);
  assert.equal(rows[0].due_at, clock.at + C.monthly.days * 86400000);
  const card = s.app.db.prepare('SELECT * FROM messages WHERE id = ?').get(rows[0].message_id);
  assert.equal(card.kind, 'bill');
  assert.equal(s.app.db.prepare('SELECT name, npc FROM users WHERE id = ?').get(card.sender_id).name, 'TWO STATE公式');
  // the bot only sends
  assert.equal((await s.call('POST', '/api/messages', { token: payer.token, body: { to: card.sender_id, text: 'こんにちは' } })).error.code, 'send_only');
  // paid from the card (not with too little; once only)
  s.setUser(payer.me.id, { dollars: 500000 });
  assert.equal((await s.call('POST', '/api/slot-bill/pay', { token: payer.token, body: { message: rows[0].message_id } })).error.code, 'insufficient');
  s.setUser(payer.me.id, { dollars: 3000000 });
  let r = await s.call('POST', '/api/slot-bill/pay', { token: payer.token, body: { message: rows[0].message_id } });
  assert.equal(r.paid, true);
  assert.equal(r.me.dollars, 3000000 - C.monthly.amount);
  r = await s.call('POST', '/api/slot-bill/pay', { token: payer.token, body: { message: rows[0].message_id } });
  assert.equal(r.paid, false);
  assert.equal((await s.call('POST', '/api/slot-bill/pay', { token: late.token, body: { message: rows[0].message_id } })).error.code, 'no_bill');
  // the other one, unpaid past its days: taken, leaving the $ below 0
  s.setUser(late.me.id, { dollars: 250000 });
  clock.at += C.monthly.days * 86400000 + 1000;
  bills.housekeep();
  const taken = s.app.db.prepare('SELECT * FROM slot_bills WHERE user_id = ?').get(late.me.id);
  assert.deepEqual([taken.forced, taken.paid_at > 0], [1, true]);
  assert.equal((await s.call('GET', '/api/me', { token: late.token })).me.dollars, 250000 - C.monthly.amount);
  // the money is Dtrade's
  assert.equal(flows(s).reduce((n, f) => n + ((f.dtrade || {}).slotfee || 0), 0), 2 * C.monthly.amount);
  // a spin in December bills November at once (the first spin of a month)
  s.setUser(payer.me.id, { tokens: 10000 });
  clock.at = Date.UTC(2026, 10, 10, 3, 0, 0);
  assert.equal((await s.call('POST', '/api/spin', { token: payer.token, body: { bet: 100 } })).status, 200);
  clock.at = Date.UTC(2026, 11, 2, 3, 0, 0);
  assert.equal((await s.call('POST', '/api/spin', { token: payer.token, body: { bet: 100 } })).status, 200);
  assert.ok(s.app.db.prepare("SELECT 1 FROM slot_bills WHERE user_id = ? AND month = '2026-11'").get(payer.me.id));
  void idle;
});
