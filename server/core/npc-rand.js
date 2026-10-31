// The NPCs' chances (server/core/npc-model.js): a small fast generator (sfc32) seeded, for each minute or each day,
// by an HMAC of the server's key and what it is for. The same key, the same minute and the same people always give
// the same draws, in the same order; nobody without the key can tell what comes next.
import crypto from 'node:crypto';

export function seeded(key, label) {
  const h = crypto.createHmac('sha256', key).update(String(label)).digest();
  let a = h.readUInt32BE(0), b = h.readUInt32BE(4), c = h.readUInt32BE(8), d = h.readUInt32BE(12), spare = null;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  const r = {
    u: next,
    // a whole number in [0, n)
    int: (n) => Math.floor(next() * n),
    // a standard normal
    z() {
      if (spare !== null) { const v = spare; spare = null; return v; }
      const m = Math.sqrt(-2 * Math.log(1 - next())), t = 2 * Math.PI * next();
      spare = m * Math.sin(t);
      return m * Math.cos(t);
    },
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    // by weights (an array of numbers ≥ 0): the index drawn
    weighted(ws) {
      let total = 0;
      for (const w of ws) total += w;
      let x = next() * total;
      for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x < 0) return i; }
      return ws.length - 1;
    },
    // how many of a Poisson count with mean `m` (small m: by multiplying; large: normal)
    poisson(m) {
      if (m <= 0) return 0;
      if (m > 30) return Math.max(0, Math.round(m + Math.sqrt(m) * r.z()));
      const l = Math.exp(-m);
      let k = 0, p = 1;
      do { k++; p *= next(); } while (p > l);
      return k - 1;
    },
    // a byte-sized trait: mean 128, spread `sd`, within 0..255
    byte(mean = 128, sd = 40) { return Math.max(0, Math.min(255, Math.round(mean + sd * r.z()))); }
  };
  return r;
}

// a person's own stable number (for the jitter of a dot, a shift, a day off): the same every time
export function hash32(n, salt = 0) {
  let x = (n ^ (salt * 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}
