// 選ばれし300人のAI (server/core/npc-elite.js, server/core/npc-ai.js): only the 300 (and the 90 and the 10 among
// them) think with AI — told as they are, choosing today's plans and the 90's and the 10's view of the companies by
// their character — as far as the day's AI money goes (the free Neurons of the UTC day and the yen beyond): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as corpModel from '../core/corp-model.js';
import * as npc from '../core/npc-model.js';
import * as pop from '../core/npc-pop.js';
import * as elite from '../core/npc-elite.js';
import { eliteWant } from '../core/npc-heart.js';
import { createAi, dailyCap, neuronsOf, aiYen } from '../core/npc-ai.js';
import { NPC } from '../core/rules.js';

const START = Date.UTC(2026, 10, 2, 2, 0, 0);
const EL = NPC.elite;

function country(n = 2000) {
  const key = Buffer.alloc(32, 5), launch = Math.floor(START / 86400000);
  const { world: w } = corpModel.boot(key, launch, { years: 0, prices: { riru: 12000, ice: 30000 } });
  return npc.boot(key, START, w, { n });
}
// a memory of npc_ai rows (the database's, for createAi)
function memoryDb() {
  const rows = [];
  return (sql) => ({
    get: (from) => { const r = rows.filter((x) => x.at >= from); return { n: r.reduce((a, x) => a + x.neurons, 0), c: r.length }; },
    run: (at, kind, ref, text, neurons) => rows.push({ at, kind, ref, text, neurons }),
    rows
  });
}

test('the 300: 300 of a country of 10,000 (fewer in a smaller one), the citizens none; the tiers the 10, the 90, the rest', () => {
  assert.equal(eliteWant(10000), 300);
  assert.equal(eliteWant(50000), 300);
  assert.equal(eliteWant(2000), 60);
  const W = country(2000), P = W.P;
  let n = 0;
  for (let i = 0; i < P.n; i++) if (P.flags[i] & pop.FL.elite) n++;
  assert.equal(n, 60);
  const plain = Array.from({ length: P.n }, (_, i) => i).find((i) => !(P.flags[i] & (pop.FL.elite | pop.FL.alpha)));
  assert.equal(elite.tierOf(W, plain), null);
  const job = elite.due(W, W.minute);
  assert.ok(job && job.list.length <= EL.batch && job.list.every((i) => P.flags[i] & (pop.FL.elite | pop.FL.alpha)));
});

test('what the AI is told: who they are by their character and life, all the plans they may make; the 90 their view of the companies too', () => {
  const W = country(2000), P = W.P;
  const i = Array.from({ length: P.n }, (_, k) => k).find((k) => P.flags[k] & pop.FL.elite);
  const line = elite.describe(W, i, W.day);
  assert.match(line, /歳/);
  assert.match(line, /性格：/);
  const p = elite.prompt(W, 'elite', [i], W.day);
  for (const name of ['ご褒美', '節約', '投資', '地元で買う']) assert.ok(p.user.includes(name));
  assert.ok(!p.user.includes('見通し='));
  const q = elite.prompt(W, 'alpha', [i], W.day);
  assert.ok(q.user.includes('見通し=') && q.user.includes('tenesice'));
});

test('what it says made theirs: plans and views by the line, a line it got wrong left to the engine and asked again soon', () => {
  const W = country(2000), P = W.P, m = W.minute;
  const list = Array.from({ length: P.n }, (_, k) => k).filter((k) => P.flags[k] & pop.FL.elite).slice(0, 3);
  const said = '<think>考え中</think>1 予定=2,6 見通し=riru:+2,ice:-1,magita:0,tenesice:+1 理由=ストレスを買い物で発散\n2. 予定=８ 理由=株で増やす\nよく分かりません';
  const n = elite.apply(W, 'alpha', list, said, W.day, m);
  assert.equal(n, 2);
  assert.deepEqual([P.plan[list[0] * 2], P.plan[list[0] * 2 + 1]], [2, 6]);
  assert.equal(P.outlook[list[0] * pop.LISTED], 120);
  assert.equal(P.outlook[list[0] * pop.LISTED + 1], -60);
  assert.equal(P.plan[list[1] * 2], 8);
  assert.equal(W.eliteAi.next[list[0]], m + EL.every.alpha);
  assert.equal(W.eliteAi.next[list[2]], m + 5);
  assert.equal(elite.viewOf(W, list[0]).why, 'ストレスを買い物で発散');
  // (their turns the oftener the more AI money there is: never oftener than the fastest share)
  assert.equal(elite.speed(W, 1e9, 660), EL.fastest);
  assert.equal(elite.speed(W, 1, 660), 1);
  // (a 300 of the rest: no view of the companies taken from it)
  const before = P.outlook[list[2] * pop.LISTED];
  elite.apply(W, 'elite', [list[2]], '1 予定=4 見通し=riru:+2 理由=休む', W.day, m);
  assert.equal(P.outlook[list[2] * pop.LISTED], before);
  // (someone gone since: not theirs)
  P.gen[list[2]]++;
  assert.equal(elite.apply(W, 'elite', [list[2]], '1 予定=5 理由=会う', W.day, m, EL.model, [P.gen[list[2]] - 1]), 0);
});

test('the AI money: the free Neurons of the UTC day and the yen beyond, by each model\'s rates; nothing more is asked once spent', async () => {
  assert.equal(dailyCap(10000, 0), 9800);
  assert.ok(dailyCap(10000, 100) > 11000 && dailyCap(10000, 100) < 12500);
  // (all that is left of the most the country may add once its people's rooms are paid: none of them yet, all of it)
  assert.equal(aiYen(0), EL.cap);
  assert.equal(aiYen(15), Math.max(0, EL.cap - 15 * EL.roomYen));
  assert.equal(aiYen(20), 0);
  assert.ok(neuronsOf(EL.model, 1e6, 0) === EL.rates[EL.model][0]);
  const q = memoryDb();
  let calls = 0;
  const binding = { run: async () => { calls++; return { response: '1 予定=1 理由=ご褒美' }; } };
  const now = Date.UTC(2026, 10, 2, 5, 0, 0);
  const ai = createAi({ binding, q, clock: () => now, daily: 10000, yen: 0 });
  assert.equal(ai.cap, 9800);
  const text = await ai.ask(EL.model, 'elite', 'x', 'system', 'user', 50, now);
  assert.equal(text, '1 予定=1 理由=ご褒美');
  assert.equal(calls, 1);
  // (a room too small for the call: not asked)
  assert.equal(await ai.ask(EL.model, 'elite', 'x', 'system', 'user', 50, now, 0.001), null);
  assert.equal(calls, 1);
  // (the day starts again at 00:00 UTC)
  assert.ok(ai.used(now).neurons > 0);
  assert.equal(ai.used(Date.UTC(2026, 10, 3, 0, 0, 1)).neurons, 0);
});
