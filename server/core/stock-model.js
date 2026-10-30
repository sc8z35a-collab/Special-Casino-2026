// The share prices' path (投資, server/core/stocks.js): one step a second for
// each company, from a key only the server holds. Nothing here is stored or
// random: the same key and the same second always give the same step, so the
// path is the same whenever it is worked out, and nobody without the key can
// work out a second before it comes.
//
// A second's step moves the log price x (log of price / base) by m·σ·z: z a
// standard normal (HMAC-SHA256 of the second's number, Box–Muller), σ the
// company's daily volatility over √86400, and m how stormy the market is. m
// changes once a minute: its log is an Ornstein–Uhlenbeck process (half-life
// 2 hours) whose mean makes E[m²] = 1, so a day's moves average σ, calm hours
// and wild ones by turns. Inside the company's band (|x| ≤ band) x is a
// martingale: the chart says nothing of what comes next. Outside it, a pull
// back (half-life 5 days) keeps the prices in range for years.
import crypto from 'node:crypto';

export const DAY = 86400;
const VOL_SD = 0.35;                          // the spread of log m
export const VOL_MEAN = -VOL_SD * VOL_SD;     // E[m²] = 1
const VOL_KEEP = Math.pow(0.5, 1 / 120);      // a minute's step: half-life 2 hours
const VOL_SHOCK = VOL_SD * Math.sqrt(1 - VOL_KEEP * VOL_KEEP);
const PULL = Math.LN2 / (5 * DAY);            // a second's pull back outside the band: half-life 5 days

// Standard normals by index (n ≥ 0), eight from each HMAC block.
export function normals(key, label) {
  let block = -1;
  const out = new Float64Array(8);
  return (n) => {
    const b = Math.floor(n / 8);
    if (b !== block) {
      const h = crypto.createHmac('sha256', key).update(label + ':' + b).digest();
      for (let i = 0; i < 4; i++) {
        const r = Math.sqrt(-2 * Math.log((h.readUInt32BE(8 * i) + 1) / 4294967296));
        const a = 2 * Math.PI * h.readUInt32BE(8 * i + 4) / 4294967296;
        out[2 * i] = r * Math.cos(a);
        out[2 * i + 1] = r * Math.sin(a);
      }
      block = b;
    }
    return out[n - b * 8];
  };
}

// Standard normals in order, from a small fast generator (sfc32) seeded by the
// key: for the made-up past only, which is all shown on the charts (nothing to
// keep secret there, and 30 days of it come at once when the market opens).
function quickNormals(key, label) {
  const h = crypto.createHmac('sha256', key).update(label).digest();
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
  return () => {
    if (spare !== null) { const z = spare; spare = null; return z; }
    const r = Math.sqrt(-2 * Math.log(1 - next())), a2 = 2 * Math.PI * next();
    spare = r * Math.sin(a2);
    return r * Math.cos(a2);
  };
}

// One company's path: step(s, n) moves s = { x, v } from second n - 1 to
// second n (the stormy-ness v first, at the start of each minute).
export function pathOf(key, c) {
  const z = normals(key, c.id + ':p'), w = normals(key, c.id + ':v');
  const sigma = c.vol / Math.sqrt(DAY);
  return {
    step(s, n) {
      if ((n - 1) % 60 === 0) s.v = VOL_MEAN + VOL_KEEP * (s.v - VOL_MEAN) + VOL_SHOCK * w((n - 1) / 60);
      const out = s.x > c.band ? s.x - c.band : s.x < -c.band ? s.x + c.band : 0;
      s.x += Math.exp(s.v) * sigma * z(n) - PULL * out;
    },
    price: (x) => Math.max(1, Math.round(c.base * Math.exp(x)))
  };
}

// The month before the market opened (`launch`, seconds, a minute's start), so
// its charts are not empty on the first day: the same kind of path at 10-second
// steps, tied (a Brownian bridge) to the opening price, the base, at its end.
// Minute candles { at, o, h, l, c }, oldest first.
export function history(key, c, launch, days = 30) {
  const minutes = days * 1440, steps = minutes * 6;
  const z = quickNormals(key, c.id + ':h:' + launch), w = quickNormals(key, c.id + ':hv:' + launch);
  const sd10 = c.vol / Math.sqrt(DAY) * Math.sqrt(10);
  const xs = new Float64Array(steps + 1);
  xs[0] = 0.5 * c.vol * Math.sqrt(days) * z();
  let v = VOL_MEAN;
  for (let k = 0; k < minutes; k++) {
    v = VOL_MEAN + VOL_KEEP * (v - VOL_MEAN) + VOL_SHOCK * w();
    const sd = Math.exp(v) * sd10;
    for (let j = 1; j <= 6; j++) xs[6 * k + j] = xs[6 * k + j - 1] + sd * z();
  }
  const gap = xs[steps];
  for (let i = 0; i <= steps; i++) xs[i] -= gap * i / steps;
  const price = (x) => Math.max(1, Math.round(c.base * Math.exp(x)));
  const out = [];
  for (let k = 0; k < minutes; k++) {
    let h = -Infinity, l = Infinity;
    for (let j = 0; j <= 6; j++) {
      const p = price(xs[6 * k + j]);
      if (p > h) h = p;
      if (p < l) l = p;
    }
    out.push({ at: launch - (minutes - k) * 60, o: price(xs[6 * k]), h, l, c: price(xs[6 * k + 6]) });
  }
  return out;
}
