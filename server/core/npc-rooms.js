// 人の部屋の本体側 (docs/npc-rooms-plan.md 3〜5章): the main room's side of the people's rooms (npc-room.js). Each
// person's body — their money, work, home, feelings — stays here with the economy; their mind lives in a room, 2,000 to
// a room in a full country: ヴェルノア's in five, アスカ国's in ten. While the people are about the host tells each room,
// a minute at a time, how its people are and what happened to them, and does what their minds mean to do as the engine
// does anyone's (npc-elite.js act: their money and credit checked; the 300's own AI first — what it chose today is
// theirs). The rooms are opened at the people's hours' start and closed at their end (their profiles kept here for the
// hours between), what they cost watched: never more of the month than NPC.elite.cap allows — if it would be, they close
// earlier. No money ever crosses to a room: the money ledger never sees them.
import { NPC } from './rules.js';
import * as brain from './npc-brain.js';
import { createRoom } from './npc-room.js';
import { NN, LISTED, FL, E, E2, ageOf, memoryAt, MEMS as BODY_MEMS } from './npc-pop.js';
import * as asuka from './asuka.js';
import { act } from './npc-elite.js';
import { LISTED_IDS } from './npc-market.js';

export const ROOMS = { vernoa: 5, asuka: 10 };
export const COUNT = ROOMS.vernoa + ROOMS.asuka;
const K = brain.K, P_ = brain.P_;
// person i's room and their place in it (ヴェルノア's by i mod 5, アスカ国's by i mod 10: a slot keeps its person)
export const placeOf = (country, i) => (country === 'v' ? [i % ROOMS.vernoa, Math.floor(i / ROOMS.vernoa)] : [ROOMS.vernoa + (i % ROOMS.asuka), Math.floor(i / ROOMS.asuka)]);
export const personOf = (r, s) => (r < ROOMS.vernoa ? ['v', s * ROOMS.vernoa + r] : ['a', s * ROOMS.asuka + (r - ROOMS.vernoa)]);
export function sizeOf(W, r) {
  if (r < ROOMS.vernoa) return Math.max(0, Math.ceil((W.P.n - r) / ROOMS.vernoa));
  const n = W.AP ? W.AP.n : 0, k = r - ROOMS.vernoa;
  return Math.max(0, Math.ceil((n - k) / ROOMS.asuka));
}
const hash8 = (a, b, c) => { let h = (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 40503) ^ Math.imul(c + 3, 2246822519)) >>> 0; h = Math.imul(h ^ (h >>> 13), 2246822519) >>> 0; return h & 0xff; };

/* ---------------------------------------------------------------- what a room is told --- */
// each of a room's people's character (at its opening): ヴェルノア's their own, アスカ国's (who have none kept) one of
// their own by their place and life
function traitsOf(W, r, n) {
  const out = new Uint8Array(n * brain.TRAITS);
  for (let s = 0; s < n; s++) {
    const [c, i] = personOf(r, s);
    if (c === 'v') { if (i < W.P.n) out.set(W.P.tr.subarray(i * brain.TRAITS, (i + 1) * brain.TRAITS), s * brain.TRAITS); }
    else if (W.AP && i < W.AP.n) for (let k = 0; k < brain.TRAITS; k++) out[s * brain.TRAITS + k] = hash8(i, W.AP.gen[i], k);
  }
  return out;
}
const gensOf = (W, r, n) => { const g = new Uint16Array(n); for (let s = 0; s < n; s++) { const [c, i] = personOf(r, s); g[s] = c === 'v' ? (i < W.P.n ? W.P.gen[i] : 0) : (W.AP && i < W.AP.n ? W.AP.gen[i] : 0); } return g; };
// their bodies as they are now (money in 10,000s)
function bodyOf(W, r, n, day, px) {
  const b = new Float32Array(n * K), P = W.P, A = W.AP;
  for (let s = 0; s < n; s++) {
    const [c, i] = personOf(r, s), o = s * K;
    if (c === 'v') {
      if (i >= P.n) continue;
      let held = 0;
      for (let k = 0; k < LISTED; k++) held += P.sh[i * LISTED + k] * (px[k] || 0);
      b[o + P_.gen] = P.gen[i]; b[o + P_.age] = ageOf(P, i, day); b[o + P_.job] = P.job[i]; b[o + P_.salary] = P.salary[i] / 1e4;
      b[o + P_.cash] = P.cash[i] / 1e4; b[o + P_.debt] = P.debt[i] / 1e4; b[o + P_.net] = (P.cash[i] + held - P.debt[i]) / 1e4;
      b[o + P_.car] = P.car[i] ? 1 : 0; b[o + P_.home] = P.home[i]; b[o + P_.mood] = P.emo[i * 5 + E.mood]; b[o + P_.stress] = P.emo[i * 5 + E.stress];
      if (P.emo2) { b[o + P_.tired] = P.emo2[i * 3 + E2.tired]; b[o + P_.esteem] = P.emo2[i * 3 + E2.esteem]; }
      for (let k = 0; k < NN; k++) b[o + P_.needs + k] = P.need[i * NN + k];
      b[o + P_.rank] = P.rank[i]; b[o + P_.flags] = (P.flags[i] & FL.elite ? 1 : 0) | (P.flags[i] & FL.alpha ? 2 : 0);
    } else {
      if (!A || i >= A.n) continue;
      b[o + P_.gen] = A.gen[i]; b[o + P_.age] = asuka.ageOf(A, i, day); b[o + P_.job] = A.job[i]; b[o + P_.salary] = A.pay[i] / 1e4;
      b[o + P_.cash] = A.cash[i] / 1e4; b[o + P_.debt] = A.debt[i] / 1e4; b[o + P_.net] = (A.cash[i] - A.debt[i]) / 1e4;
      b[o + P_.mood] = 150; b[o + P_.stress] = 60; b[o + P_.esteem] = 128;
      for (let k = 0; k < NN; k++) b[o + P_.needs + k] = 160;
    }
  }
  return b;
}
// what happened to ヴェルノア's people of a room since the last minute: their body's memories made since
function eventsOf(W, r, n, seen) {
  const P = W.P, out = [];
  if (r >= ROOMS.vernoa) return out;
  for (let s = 0; s < n; s++) {
    const i = s * ROOMS.vernoa + r;
    if (i >= P.n) break;
    const was = seen[i], now = P.memAt[i];
    if (was === now) continue;
    for (let k = was; k !== now; k = (k + 1) % BODY_MEMS) { const x = memoryAt(P, i, k); if (x) out.push([s, x.kind, x.power, 0]); }
    seen[i] = now;
  }
  return out;
}
// the times: the day, a day off or not, the prices' level, the four companies' prices and each one's move a day of late
function timesOf(W, now, ctx) {
  const m = W.marketState, px = LISTED_IDS.map((id) => (ctx && ctx.stockPrice ? ctx.stockPrice(id) : 0) || 0);
  const moves = LISTED_IDS.map((id, k) => { const h = m && m.hist[id]; return h && h.length && px[k] ? (px[k] / h[0] - 1) / Math.max(1, h.length / 2) : 0; });
  return { g: { day: W.day, off: NPC.jst(now).off, cpi: W.cpi || 1, moves }, px };
}

/* ---------------------------------------------------------------- what they meant, done --- */
// the 300's own AI first: what it chose today stands
const aiToday = (W, i) => { const x = W.eliteAi && W.eliteAi.last[i]; return !!x && x.gen === W.P.gen[i] && x.day === W.day; };
const ACT_OF = (code, k, pct, amt) => [null, { code: 'job' }, { code: 'car' }, { code: 'buy', id: LISTED_IDS[k], pct }, { code: 'sell', id: LISTED_IDS[k], pct }, { code: 'borrow', yen: amt * 1e4 }, { code: 'repay', yen: amt * 1e4 }][code] || null;
export function apply(W, r, intents, run) {
  const P = W.P, A = W.AP;
  let n = 0;
  for (const x of intents) {
    const [c, i] = personOf(r, x[0]);
    if (c === 'v') {
      if (i >= P.n || P.gen[i] !== x[1] || aiToday(W, i)) continue;
      if (x[2]) { P.plan[i * 2] = x[2]; P.plan[i * 2 + 1] = x[3]; }
      for (let k = 0; k < LISTED; k++) P.outlook[i * LISTED + k] = Math.max(-127, Math.min(127, Math.round(x[8 + k] * 40)));
      const a = x[4] ? ACT_OF(x[4], x[5], x[6], x[7]) : null;
      if (a && run) act(W, i, a, W.day, run);
      n++;
    } else if (A && i < A.n && A.gen[i] === x[1] && A.ethos) {
      // (アスカ国's: what they mean to spend — a plan to save holds back, a treat or an outing spends — through their 消費観)
      const up = x[2] === 1 || x[2] === 2 || x[2] === 7, down = x[2] === 6;
      if (up || down) A.ethos[i] = Math.max(128, Math.min(217, A.ethos[i] + (up ? 4 : -4)));
      n++;
    }
  }
  return n;
}

/* ---------------------------------------------------------------- the host --- */
// `transport`: how the rooms are reached — { call(r, method, msg) } —; `get`/`tx`/`save`/`ctx` the host's; `profiles(rows)`
// keeps their profiles. The state of the rooms (open or not, what they cost) is kept with the world (W.rooms).
export function createHost({ transport, get, tx, save, ctx, profiles, hours, seeded }) {
  const seen = { day: -1, mem: null };
  const stateOf = (W) => W.rooms || (W.rooms = { open: false, day: -1, since: 0, month: '', seconds: 0, days: 0, shorten: 0, fresh: 0, last: null });
  // what the rooms have cost of the month and will (their hours a room — 128MB each — beyond what the month includes, at
  // the price per GB-second): the yen
  const yenOf = (seconds) => Math.max(0, seconds * COUNT * 0.125 + NPC.elite.mainGBs - NPC.elite.included) * NPC.elite.gbPrice * NPC.elite.usd;
  async function step(now) {
    const W = get();
    if (!W || !W.life2) return 0;
    const R = stateOf(W), h = hours(now, W), t = NPC.jst(now).min, end = h[1] - (R.shorten || 0);
    const about = t >= h[0] && t < end;
    if (about && !R.open) return open(now);
    if (R.open && !about) return close(now);
    if (R.open) return tick(now);
    return 0;
  }
  async function open(now) {
    const W = get(), msgs = [];
    for (let r = 0; r < COUNT; r++) { const n = sizeOf(W, r); msgs.push({ room: r, n, day: W.day, gens: gensOf(W, r, n), traits: traitsOf(W, r, n) }); }
    const got = await Promise.all(msgs.map((m, r) => (m.n ? transport.call(r, 'open', m) : null)));
    tx(() => {
      const W2 = get(), R = stateOf(W2), month = monthOf(now);
      if (R.month !== month) { R.month = month; R.seconds = 0; R.days = 0; }
      R.open = true; R.since = now; R.day = W2.day; R.fresh = got.reduce((a, x) => a + ((x && x.fresh) || 0), 0);
      seen.mem = null;
      save('hot');
    });
    return msgs.length;
  }
  async function tick(now) {
    const W = get(), c = ctx(), { g, px } = timesOf(W, now, c), minute = Math.floor(now / 60000);
    if (!seen.mem || seen.mem.length !== W.P.n) seen.mem = Uint8Array.from(W.P.memAt);
    const calls = [];
    for (let r = 0; r < COUNT; r++) {
      const n = sizeOf(W, r);
      if (!n) { calls.push(null); continue; }
      calls.push(transport.call(r, 'tick', { minute, body: bodyOf(W, r, n, W.day, px), events: eventsOf(W, r, n, seen.mem), g }));
    }
    const got = await Promise.all(calls);
    let n = 0;
    tx(() => {
      const W2 = get(), run = { ctx: ctx(), r: seeded(W2.key, `rooms:${minute}`) };
      got.forEach((x, r) => { if (x && x.intents) n += apply(W2, r, x.intents, run); });
      stateOf(W2).last = { at: now, intents: n };
      save('hot');
    });
    return n;
  }
  async function close(now) {
    const W = get(), c = ctx(), { px } = timesOf(W, now, c);
    const got = await Promise.all(Array.from({ length: COUNT }, (_, r) => { const n = sizeOf(W, r); return n ? transport.call(r, 'close', { day: W.day, body: bodyOf(W, r, n, W.day, px) }) : null; }));
    const rows = [];
    got.forEach((x, r) => { for (const [s, gen, p] of (x && x.profiles) || []) { const [cn, i] = personOf(r, s); rows.push([`${cn}:${i}:${gen}`, p]); } });
    tx(() => {
      const W2 = get(), R = stateOf(W2);
      R.seconds += Math.max(0, (now - R.since) / 1000); R.days++; R.open = false;
      // (the month's cost as it is going: past what is allowed, tomorrow's evening ends ten minutes sooner — never later
      // than the people's hours)
      const days = new Date(now).getUTCDate(), month = R.seconds / Math.max(1, days) * 31;
      R.projected = Math.round(yenOf(month));
      R.shorten = R.projected > NPC.elite.cap ? Math.min(240, (R.shorten || 0) + 10) : Math.max(0, (R.shorten || 0) - 5);
      profiles(rows, W2.day);
      save('hot');
    });
    return rows.length;
  }
  const monthOf = (now) => new Date(now).toISOString().slice(0, 7);
  return { step, open, tick, close, stateOf, yenOf };
}

/* ---------------------------------------------------------------- the transports --- */
// the rooms in this host (the Node server's, the tests'): each a room of its own with its storage (`store(r)`)
export function localTransport(store) {
  const rooms = [];
  return {
    rooms,
    async call(r, method, msg) {
      if (method === 'open') rooms[r] = createRoom({ id: r, n: msg.n, store: store(r) });
      const room = rooms[r];
      if (!room) return method === 'tick' ? { closed: true, intents: [] } : null;
      return room[method](msg);
    }
  };
}
// the rooms as Cloudflare's Durable Objects, each in a Worker of its own (`stubs()`: the room objects, by their number —
// server/cloudflare/npc-room.js): their methods called over RPC
export function remoteTransport(stubs) {
  return { async call(r, method, msg) { const s = stubs()[r]; if (!s) return null; return s[method](msg); } };
}
// a room's minds kept in the host's own database (`q`: its statements)
export function dbStore(q, r) {
  return {
    get: () => { const rows = q('SELECT data FROM npc_room_blob WHERE room = ? ORDER BY part').all(r).map((x) => x.data); return rows.length ? rows : null; },
    put: (it) => { let k = 0; for (const row of it) { q('INSERT INTO npc_room_blob (room, part, data) VALUES (?, ?, ?) ON CONFLICT(room, part) DO UPDATE SET data = excluded.data').run(r, k++, row); } q('DELETE FROM npc_room_blob WHERE room = ? AND part >= ?').run(r, k); }
  };
}
