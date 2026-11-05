// 人の部屋 (docs/npc-rooms-plan.md 3・4章): a room keeps the minds (npc-brain.js) of its share of the people — 2,000 in a
// full country — while the main room keeps their bodies, their money and the economy (npc-rooms.js host). Standalone:
// the Cloudflare room (server/cloudflare/npc-room.js, a Worker of its own) and the host itself (`local`) run it alike.
// - open (17:00): its minds read back from its storage (a first evening: made), each new life among its people given a
//   new mind, the hours since its last close caught up (the minds' days: nothing happens to a mind while its room
//   sleeps but the night's rest);
// - tick (each minute): its people's bodies as they are and what happened to them perceived; their thinking on a
//   ten-second rhythm (a sixth of them at each tenth of the minute, every one each minute); what each now means to do,
//   for those whose mind changed;
// - close (22:00): the night's reflection (each decision reckoned, what was learnt kept, their rules), their profiles
//   for the main room, the minds kept; the room's memory let go — it sleeps, costing nothing, until the next 17:00.
import * as brain from './npc-brain.js';

export function createRoom({ id, n, store }) {
  let B = null, day = -1;
  const P = brain.P_, K = brain.K;
  return {
    get isOpen() { return !!B; },
    open({ day: d, gens, traits }) {
      const rows = store.get();
      B = rows ? brain.unpack(brain.alloc(n), rows) : brain.alloc(n);
      let fresh = 0;
      for (let s = 0; s < n; s++) if (!B.born[s] || B.gen[s] !== gens[s]) { brain.reset(B, s, gens[s], d, traits.subarray(s * brain.TRAITS, (s + 1) * brain.TRAITS)); fresh++; }
      day = d;
      return { room: id, n, fresh, bytes: brain.BYTES * n };
    },
    // `body`: Float32Array n × K; `events`: [[slot, kind, power, x]]; `g`: the times; returns the intents
    // [[slot, gen, plan, plan, act, k, pct, amt, v0, v1, v2, v3]]
    tick({ minute, body, events, g, futures = 4096 }) {
      if (!B) return { closed: true, intents: [] };
      const by = new Map();
      for (const e of events || []) { const s = e[0]; if (!by.has(s)) by.set(s, []); by.get(s).push([e[1], e[2], e[3]]); }
      const out = [];
      for (let sub = 0; sub < 6; sub++) {
        for (let s = sub; s < n; s += 6) {
          const p = body.subarray(s * K, (s + 1) * K);
          if (!p[P.gen] && !p[P.age]) continue;
          if (B.gen[s] !== p[P.gen]) brain.reset(B, s, p[P.gen], g.day, null);
          brain.perceive(B, s, p, by.get(s), g);
          const x = brain.think(B, s, p, g, minute * 6 + sub, futures);
          if (!x) continue;
          const a = x.act;
          out.push([s, p[P.gen], x.plans[0] || 0, x.plans[1] || 0, a ? a.code : 0, a && a.k !== undefined ? a.k : -1, a && a.pct ? a.pct : 0, a && a.amt ? a.amt : 0, ...x.view]);
        }
      }
      day = g.day;
      return { intents: out };
    },
    close({ day: d, body }) {
      if (!B) return { profiles: [] };
      const profiles = [];
      let reckoned = 0;
      for (let s = 0; s < n; s++) {
        const p = body ? body.subarray(s * K, (s + 1) * K) : null;
        if (p && (p[P.gen] || p[P.age])) reckoned += brain.reflect(B, s, p, d);
        profiles.push([s, B.gen[s], brain.profile(B, s)]);
      }
      store.put(brain.packRows(B));
      B = null;
      day = d;
      return { profiles, reckoned };
    }
  };
}
// a room's storage in memory (the tests'), as a host or a Durable Object keeps it (rows of up to a million bytes)
export function memoryStore() {
  let rows = null;
  return { get: () => rows, put: (it) => { rows = Array.from(it, (r) => r.slice()); }, rows: () => rows };
}
