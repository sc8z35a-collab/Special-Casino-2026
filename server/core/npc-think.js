// The AI's turns on the host (server/core/npc.js writeAi): 選ばれし300人's choices (npc-elite.js) and the AI 社長's
// decisions (npc-boss.js). One runner for both: a turn's question asked of the AI as far as the day's AI money allows by
// now (paced through the people's hours: a share of it as they go, NPC.elite.pace minutes ahead, all of it by their
// end — none before they begin), its answer made the world's in one transaction with the world as it is then.
import { NPC } from './rules.js';
import * as elite from './npc-elite.js';
import * as boss from './npc-boss.js';
import { seeded } from './npc-rand.js';

export function createThinker({ ai, get, tx, save, ctx, hours }) {
  // what the AI may still spend now
  function room(now, w) {
    const h = hours(now, w), t = NPC.jst(now).min;
    const share = t < h[0] ? 0 : Math.min(1, (t - h[0] + NPC.elite.pace) / Math.max(1, h[1] - h[0]));
    return ai.cap * share - ai.used(now).neurons;
  }
  // up to `most` turns: `next(w, step)` the turn ({ model, kind, ref, p }; null: none due), `done(w, turn, said)` its
  // answer (null: none — no room, nothing said) made the world's; stops at the first unanswered
  async function turns(now, most, next, done) {
    let n = 0;
    for (let step = 0; step < most; step++) {
      const w = get(), left = w ? room(now, w) : 0;
      const turn = left > 0 ? next(w, step) : null;
      if (!turn) break;
      const said = await ai.ask(turn.model, turn.kind, turn.ref, turn.p.system, turn.p.user, turn.p.max, now, left);
      const w2 = get();
      if (!w2) break;
      tx(() => { done(w2, turn, said); save('hot'); });
      if (!said) break;
      n++;
    }
    return n;
  }
  return {
    room,
    // 選ばれし300人: a batch of one tier a call (the 10, the 90, the rest), six a wake; their turns as often as the day's
    // money allows; what they chose done by the engine with the day's prices and a draw of the minute's
    elite: (now) => turns(now, 6, (w, step) => {
      if (step === 0) { const h = hours(now, w); elite.speed(w, ai.cap, h[1] - h[0]); }
      const job = elite.due(w, w.minute);
      if (!job) return null;
      const board = job.tier !== 'elite' && w.alpha && w.alpha.today ? w.alpha.today.board : null;
      return { ...job, gens: job.list.map((i) => w.P.gen[i]), model: NPC.elite.model, kind: 'elite', ref: `${w.day}:${job.tier}:${job.list[0]}`, p: elite.prompt(w, job.tier, job.list, w.day, board) };
    }, (w, x, said) => {
      if (said) elite.apply(w, x.tier, x.list, said, w.day, w.minute, x.model, x.gens, { ctx: ctx(), r: seeded(w.key, `elite:${w.minute}:${x.list[0]}`) });
      else elite.later(w, x.list, w.minute, 10);
    }),
    // the AI 社長: a company a call, two a wake, once a day each, of the stronger model (no answer: its turn tomorrow —
    // its meetings decide without it today)
    boss: (now) => turns(now, 2, (w) => {
      const c = ctx(), id = boss.due(w, c, w.day);
      if (!id) return null;
      const list = boss.options(w, id, c, w.day, seeded(w.key, `boss:${w.day}:${id}`));
      return { id, list, model: NPC.elite.topModel, kind: 'boss', ref: `${w.day}:${id}`, p: boss.prompt(w, id, c, w.day, list) };
    }, (w, x, said) => boss.decide(w, x.id, x.list, said || '', ctx(), w.day, seeded(w.key, `boss!:${w.day}:${x.id}`)))
  };
}
