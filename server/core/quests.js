// Quest progress of one player (definitions: js/game/quests.js). It lives as
// JSON in users.quests, so counting a spin adds nothing to the row the spin
// writes anyway:
//   { "<period>": { "k": <period index>, "m": { "<metric>": n },
//                   "c": [finished, not received yet], "d": [received] }, ... }
// A finished quest waits for the player to receive it (受け取る); a period
// whose index is not the current one has started over (what was not received
// by then is gone).
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
  if (!p || p.k !== k) p = state[period.id] = { k, m: {}, c: [], d: [] };
  if (!p.c) p.c = [];
  return p;
}
// the period as it is now, without changing anything
function current(state, period, now) {
  const { k } = QUESTS.range(period, now);
  const p = state[period.id];
  return p && p.k === k ? { m: p.m || {}, c: p.c || [], d: p.d || [] } : { m: {}, c: [], d: [] };
}

// Adds events ([[metric, amount], ...]) to every period and finishes what they
// reach (to be received by the player). Each finished quest counts once more as
// a "clear". Metrics nothing waits for any more are not counted (the JSON only
// changes when it matters). Returns { changed, done: [quest] }.
export function stepQuests(state, events, now = Date.now()) {
  const done = [];
  let changed = false;
  let queue = events.filter(([, n]) => n > 0);
  while (queue.length) {
    const next = [];
    for (const [metric, n] of queue) {
      for (const period of PERIODS) {
        const quests = BY[period.id][metric];
        if (!quests) continue;
        const p = slot(state, period, now);
        const open = quests.filter((q) => !p.c.includes(q.id) && !p.d.includes(q.id));
        if (!open.length) continue;
        p.m[metric] = (p.m[metric] || 0) + n;
        changed = true;
        for (const q of open) {
          if (p.m[metric] < q.goal) continue;
          p.c.push(q.id);
          done.push(q);
          next.push(['clear', 1]);
        }
      }
    }
    queue = next;
  }
  return { changed, done };
}

// 受け取る: the finished quests (`ids`, or all of them) of the current
// periods. Returns { claimed: [quest], dollars, tokens } (what to pay).
export function claimQuests(state, ids, now = Date.now()) {
  const claimed = [];
  let dollars = 0, tokens = 0;
  for (const period of PERIODS) {
    const p = state[period.id];
    if (!p || !p.c || !p.c.length || p.k !== QUESTS.range(period, now).k) continue;
    const take = p.c.filter((id) => !ids || ids.includes(id));
    for (const id of take) {
      const q = QUESTS.get(id);
      if (!q) continue;
      claimed.push(q);
      if (period.currency === 'tokens') tokens += q.reward; else dollars += q.reward;
    }
    p.c = p.c.filter((id) => !take.includes(id));
    p.d = (p.d || []).concat(take);
  }
  return { claimed, dollars, tokens };
}

// How many finished quests are waiting to be received.
export function questsReady(state, now = Date.now()) {
  return PERIODS.reduce((n, period) => n + current(state, period, now).c.length, 0);
}

// What the quest screen shows: per period its reset time and, per quest,
// the progress and its state: open, ready (受け取る) or received.
export function questView(state, now = Date.now()) {
  return PERIODS.map((period) => {
    const r = QUESTS.range(period, now);
    const p = current(state, period, now);
    return {
      id: period.id,
      start: r.start,
      end: r.end,
      quests: QUESTS.list.filter((q) => q.period === period.id).map((q) => {
        const st = p.d.includes(q.id) ? 'received' : p.c.includes(q.id) ? 'ready' : 'open';
        return { id: q.id, state: st, progress: st === 'open' ? Math.min(q.goal, p.m[q.metric] || 0) : q.goal };
      })
    };
  });
}
