// 運営's 日次収支レポート: the 45 companies' last days in brief — the thirteen's day rows, the 32 local companies' own
// (what each sold, its costs, its people's pay for the day, what that left), a line each; operators and viewers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { LOCAL } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0), DAY = 86400000;

test('the operator site: the 45 companies\' daily report — the thirteen and the 32 local companies, each day\'s sales, costs and result, a line each', async (t) => {
  let now = START;
  const s = await startServer({ clock: () => now, operators: ['boss'], corpHistory: 0, npc: true, npcPopulation: 500 });
  t.after(() => s.stop());
  const boss = await s.register('boss'), p = await s.register('Looker');
  const look = () => s.call('GET', '/api/stocks', { token: p.token });
  assert.ok([401, 403].includes((await s.call('GET', '/api/ops/corp/report', { token: p.token })).status));
  await look();
  await s.app.api.npcWake();
  for (let d = 0; d < 4; d++) { now += DAY; await look(); await s.app.api.npcWake(); }
  const r = await s.call('GET', '/api/ops/corp/report', { token: boss.token });
  assert.equal(r.status, 200);
  assert.equal(r.started, true);
  assert.equal(r.companies.length + r.locals.length, 13 + LOCAL.firms.length);
  assert.equal(r.companies.length + r.locals.length, 45);
  // the thirteen: each day's row (sales, what it cost, the result), the last day closed the newest
  for (const c of r.companies) {
    assert.ok(c.days.length >= 3, `${c.id}: ${c.days.length} days`);
    const d = c.days[c.days.length - 1];
    assert.equal(d.day, r.day);
    assert.equal(d.sales - d.cost, d.op);
    assert.ok(typeof c.line === 'string' && c.line.length > 0);
  }
  // the 32: what they sold, their costs and the day's pay, what that left
  // (some are paid by the thirteen at the month's end only — the local bank's interest, a lease —: no sales most days)
  let selling = 0;
  for (const f of r.locals) {
    if (f.dead) continue;
    assert.ok(f.days.length >= 3, `${f.id}: ${f.days.length} days`);
    for (const d of f.days) assert.equal(d.sales - d.cost - d.pay, d.op);
    assert.ok(f.days.every((d) => !d.staff || d.pay > 0), f.id);
    if (f.days.some((d) => d.sales > 0)) selling++;
  }
  assert.ok(selling >= r.locals.length / 4, `${selling}`);
  // アスカ国 now, for its page every few seconds: what its people are doing, by district, the day's money
  assert.ok([401, 403].includes((await s.call('GET', '/api/ops/npc/asuka', { token: p.token })).status));
  const a = await s.call('GET', '/api/ops/npc/asuka', { token: boss.token });
  assert.equal(a.status, 200);
  assert.equal(a.live.all.reduce((x, y) => x + y, 0), s.app.api.npc.world().AP.n);
  assert.equal(a.live.districts.reduce((x, d) => x + d.acts.reduce((p2, q) => p2 + q, 0), 0), s.app.api.npc.world().AP.n);
  assert.ok(a.live.last && a.live.last.living > 0 && a.live.money.all > 0);
  // (unchanged until the next close: { same: true } for the same rev)
  const again = await s.call('GET', '/api/ops/corp/report?rev=' + encodeURIComponent(r.rev), { token: boss.token });
  assert.equal(again.same, true);
});
