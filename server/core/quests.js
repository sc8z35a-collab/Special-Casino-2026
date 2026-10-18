// Quest progress of one player (definitions: js/game/quests.js). It lives as
// JSON in users.quests, so counting a spin adds nothing to the row the spin
// writes anyway:
//   { "<period>": { "k": <period index>, "m": { "<metric>": n }, "d": ["<quest id>", ...] }, ... }
// A period whose index is not the current one has started over.
import { QUESTS } from './rules.js';

const PERIODS = QUESTS.periods;
// period -> metric -> its quests
const BY = {};
for (const p of PERIODS) BY[p.id] = {};
for (const q of QUESTS.list) (BY[q.period][q.metric] = BY[q.period][q.metric] || []).push(q);

export function readQuests(json) {
  try {
    const s = JSON.parse(json || '{}');
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}

function slot(state, period, now) {
  const { k } = QUESTS.range(period, now);
  let p = state[period.id];
  if (!p || p.k !== k) p = state[period.id] = { k, m: {}, d: [] };
  return p;
}

// Adds events ([[metric, amount], ...]) to every period and finishes what they
// reach. Each finished quest counts once more as a "clear". Metrics nothing
// waits for any more are not counted (the JSON only changes when it matters).
// Returns { changed, done: [quest], dollars, tokens } (rewards to pay).
export function stepQuests(state, events, now = Date.now()) {
  const done = [];
  let dollars = 0, tokens = 0, changed = false;
  let queue = events.filter(([, n]) => n > 0);
  while (queue.length) {
    const next = [];
    for (const [metric, n] of queue) {
      for (const period of PERIODS) {
        const quests = BY[period.id][metric];
        if (!quests) continue;
        const p = slot(state, period, now);
        const open = quests.filter((q) => !p.d.includes(q.id));
        if (!open.length) continue;
        p.m[metric] = (p.m[metric] || 0) + n;
        changed = true;
        for (const q of open) {
          if (p.m[metric] < q.goal) continue;
          p.d.push(q.id);
          done.push(q);
          if (period.currency === 'tokens') tokens += q.reward; else dollars += q.reward;
          next.push(['clear', 1]);
        }
      }
    }
    queue = next;
  }
  return { changed, done, dollars, tokens };
}

// What the quest screen shows: per period its reset time and, per quest,
// the progress and whether it is done.
export function questView(state, now = Date.now()) {
  return PERIODS.map((period) => {
    const r = QUESTS.range(period, now);
    const p = state[period.id] && state[period.id].k === r.k ? state[period.id] : { m: {}, d: [] };
    return {
      id: period.id,
      start: r.start,
      end: r.end,
      quests: QUESTS.list.filter((q) => q.period === period.id).map((q) => {
        const isDone = p.d.includes(q.id);
        return { id: q.id, done: isDone, progress: isDone ? q.goal : Math.min(q.goal, p.m[q.metric] || 0) };
      })
    };
  });
}
