// Quest progress of one player (definitions: js/game/quests.js). It lives as
// JSON in users.quests, so counting a spin adds nothing to the row the spin
// writes anyway:
//   { "<period>": { "k": <period index>, "m": { "<metric>": n },
//                   "c": [finished, not received yet], "d": [received] }, ... }
// A period may also have "b": { "<quest id>": "pro" | "ultra" }, drawn
// once when that STEP finishes. Older finished steps without it are normal.
// "tickets" is root-level inventory; each period's "v" is its manual reset
// revision in the current natural cycle (never a new five-hour/day window).
// A finished quest waits for the player to receive it (受け取る); a period
// whose index is not the current one has started over (what was not received
// by then is gone; 特別 never starts over). Every quest pays $.
import { QUESTS, LEVEL } from './rules.js';
import { randomInt } from 'node:crypto';
import { ApiError } from './errors.js';

const PERIODS = QUESTS.periods;
const MAX = new Set(QUESTS.maxMetrics);
const BONUS = QUESTS.bonuses;
const drawBonus = () => randomInt(BONUS.rolls);

function rewardFor(q, bonus) {
  const mode = bonus === 'pro' || bonus === 'ultra' ? bonus : 'normal';
  const rule = BONUS[mode];
  return { id: q.id, mode, multiplier: rule ? rule.multiplier : 1,
    dollars: q.reward * (rule ? rule.multiplier : 1), coins: rule ? rule.coins : 0 };
}
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

// Tickets live outside the period slots, so natural/manual resets never
// erase inventory. Level rewards use actual XP increases without retroactive
// gifts; qualifying VIP packs can also add tickets to this same inventory.
export function questTickets(state) {
  const tickets = state.tickets || {};
  const count = period => Number.isSafeInteger(tickets[period]) && tickets[period] > 0 ? tickets[period] : 0;
  return { '5h': count('5h'), day: count('day') };
}

export function grantLevelTickets(state, beforeXp, afterXp) {
  const before = LEVEL.of(beforeXp), after = LEVEL.of(afterXp);
  const gained = { '5h': Math.max(0, after - before), day: Math.max(0, Math.floor(after / 5) - Math.floor(before / 5)) };
  if (gained['5h']) {
    const tickets = questTickets(state);
    state.tickets = { '5h': tickets['5h'] + gained['5h'], day: tickets.day + gained.day };
  }
  return gained;
}

// The caller commits this together with consuming the ticket. A cycle start
// and manual revision prevent a retried/double-clicked request spending twice.
export function resetQuestPeriod(state, period, expected, now = Date.now()) {
  if (period !== '5h' && period !== 'day') throw new ApiError(400, 'quest_period', 'リセットできるのは5時間・デイリークエストです');
  const range = QUESTS.range(period, now);
  const p = state[period];
  const active = p && p.k === range.k;
  const version = active ? p.v || 0 : 0;
  if (!expected || expected.start !== range.start || expected.version !== version) {
    throw new ApiError(409, 'quests_changed', 'クエストが更新されました。確認し直してからお使いください');
  }
  const tickets = questTickets(state);
  if (!tickets[period]) throw new ApiError(409, 'quest_ticket', 'リセットチケットがありません');
  if (active && p.c && p.c.length) throw new ApiError(409, 'quests_pending', '先にこの期間の報酬をすべて受け取ってください');
  if (!active || (!Object.values(p.m || {}).some(n => n > 0) && !(p.d && p.d.length))) {
    throw new ApiError(409, 'quests_empty', 'まだ進捗がないため、リセットする必要はありません');
  }
  tickets[period]--;
  state.tickets = tickets;
  state[period] = { k: range.k, m: {}, c: [], d: [], v: version + 1 };
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
  return p && p.k === k ? { m: p.m || {}, c: p.c || [], d: p.d || [], b: p.b || {}, v: p.v || 0 } : { m: {}, c: [], d: [], b: {}, v: 0 };
}

// Adds events ([[metric, amount], ...]) to every period and finishes what they
// reach (to be received by the player). Each finished quest counts once more as
// a "clear" (a 特別 one also as an "sclear"). A metric like "combo" keeps its
// biggest value instead of adding up. Metrics nothing waits for any more (or
// a quest that is off this week) are not counted: the JSON only changes when
// it matters. `boost`: { <period>: times } counts faster in those periods
// (5時間 in a hub). Returns { changed, done: [quest] }.
export function stepQuests(state, events, now = Date.now(), boost = null, rollBonus = drawBonus) {
  const done = [];
  let changed = false;
  let queue = events.filter(([, n]) => n > 0);
  while (queue.length) {
    const next = [];
    for (const [metric, n] of queue) {
      for (const period of PERIODS) {
        const quests = BY[period.id][metric];
        if (!quests) continue;
        const { k } = QUESTS.range(period, now);
        const p = slot(state, period, now);
        const open = quests.filter((q) => QUESTS.active(q, k) && !p.c.includes(q.id) && !p.d.includes(q.id));
        if (!open.length) continue;
        const was = p.m[metric] || 0;
        const times = boost && boost[period.id] && !MAX.has(metric) && metric !== 'clear' ? boost[period.id] : 1;
        const v = MAX.has(metric) ? Math.max(was, n) : Math.round((was + n * times) * 1000) / 1000;
        if (v === was) continue;
        p.m[metric] = v;
        changed = true;
        for (const q of open) {
          if (v < q.goal) continue;
          const roll = rollBonus();
          const mode = roll < BONUS.ultra.rolls ? 'ultra' : roll < BONUS.ultra.rolls + BONUS.pro.rolls ? 'pro' : null;
          if (mode) (p.b || (p.b = {}))[q.id] = mode;
          p.c.push(q.id);
          done.push(q);
          next.push(['clear', 1]);
          if (period.forever) next.push(['sclear', 1]);
        }
      }
    }
    queue = next;
  }
  return { changed, done };
}

// 受け取る: the finished quests (`ids`, or all of them) of the current
// periods. Pay the STEP's saved result without drawing again. Returns its
// actual dollars, royal coins and individual rewards (including bulk claims).
export function claimQuests(state, ids, now = Date.now()) {
  const claimed = [];
  const rewards = [];
  let dollars = 0, coins = 0;
  for (const period of PERIODS) {
    const p = state[period.id];
    if (!p || !p.c || !p.c.length || p.k !== QUESTS.range(period, now).k) continue;
    const take = p.c.filter((id) => !ids || ids.includes(id));
    for (const id of take) {
      const q = QUESTS.get(id);
      if (!q) continue;
      const reward = rewardFor(q, p.b && p.b[id]);
      claimed.push(q);
      rewards.push(reward);
      dollars += reward.dollars;
      coins += reward.coins;
    }
    p.c = p.c.filter((id) => !take.includes(id));
    p.d = (p.d || []).concat(take);
  }
  return { claimed, dollars, coins, rewards };
}

// How many finished quests are waiting to be received.
export function questsReady(state, now = Date.now()) {
  return PERIODS.reduce((n, period) => n + current(state, period, now).c.length, 0);
}

// What the quest screen shows: per period its reset time (end 0: never) and,
// per quest that is on, the progress and its state: open, ready (受け取る)
// or received.
export function questView(state, now = Date.now()) {
  return PERIODS.map((period) => {
    const r = QUESTS.range(period, now);
    const p = current(state, period, now);
    return {
      id: period.id,
      start: r.start,
      end: r.end,
      resetVersion: p.v,
      quests: QUESTS.list.filter((q) => q.period === period.id && QUESTS.active(q, r.k)).map((q) => {
        const st = p.d.includes(q.id) ? 'received' : p.c.includes(q.id) ? 'ready' : 'open';
        // (a boosted count can be part way to the next one)
        return { id: q.id, state: st, progress: st === 'open' ? Math.min(q.goal, Math.floor((p.m[q.metric] || 0) + 1e-9)) : q.goal,
          ...(st !== 'open' && p.b[q.id] ? { reward: rewardFor(q, p.b[q.id]) } : {}) };
      })
    };
  });
}
