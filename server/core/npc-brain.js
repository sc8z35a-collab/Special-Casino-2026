// 人の頭 (docs/npc-rooms-plan.md 5・6章): a person's mind as a people's room keeps it — some 34KB each — beside their
// body in the main room (npc-pop.js: their money, work, home, feelings, the engine's ~600 bytes). It holds what the body
// cannot: 3,000 memories, what each thing they may do has brought them in each kind of moment (learnt), their last 300
// decisions with what they expected and what came of them, their beliefs of the times, those they know best, their
// goals, and the rules they made for themselves from their own mistakes. It is told what happened to them (a percept a
// minute: npc-rooms.js) and answers with what they mean to do (an intent): today's plans, one big thing at once, their
// view of the companies — chosen by looking ahead over many futures as they see them, by their character. At night it
// reflects: each decision whose results are in is checked against what it expected, and what was learnt is kept. It
// never touches money: the engine does what it decides, as for anyone. Standalone (no rules imported): a room loads it
// alone.

/* ---------------------------------------------------------------- the layout --- */
export const MEMS = 3000;            // memories a person keeps (8 bytes each)
export const DECS = 300;             // decisions kept with their reckoning
export const ACTS = 16;              // 0..9 the plans (npc-heart.js PLAN), 10.. the big things (ACT below)
export const SITS = 8;               // the kinds of moment: short of money / stressed / a day off (3 bits)
export const BELIEFS = 16;           // income growth, prices, job risk, the four companies' returns, …
export const MODELS = 30;            // those they know best (by what happened between them)
export const TRAITS = 18;            // as the body's (npc-pop.js T)
export const HIST = 60;              // a day's net worth, cash and mood, the last 60 days
export const RULES = 8;              // their own rules (a weakness found, the action it stops)
export const K = 24;                 // a percept's numbers a person (P_ below)
// a percept's fields: the body as it is (money in 10,000s)
export const P_ = { gen: 0, age: 1, job: 2, salary: 3, cash: 4, debt: 5, net: 6, car: 7, home: 8, mood: 9, stress: 10, tired: 11, esteem: 12, needs: 13, rank: 22, flags: 23 };
// the big things (npc-elite.js ACTIONS, done by the engine)
export const ACT = { none: 0, job: 1, car: 2, buy: 3, sell: 4, borrow: 5, repay: 6 };
const BIG = 10;                      // the first big thing's place among ACTS
const T = { open: 0, consc: 1, extra: 2, agree: 3, neuro: 4, risk: 5, impulse: 6, thrift: 7, vanity: 8, gamble: 9, patience: 10, learn: 11, loyalty: 12, car: 13, game: 14, news: 15, justice: 16, ambition: 17 };
const COLS = [
  ['gen', Uint16Array, 1], ['born', Int32Array, 1], ['tr', Uint8Array, TRAITS], ['memAt', Uint16Array, 1], ['mem', Uint32Array, MEMS * 2],
  ['val', Float32Array, ACTS * SITS], ['cnt', Uint16Array, ACTS * SITS], ['decAt', Uint16Array, 1], ['dec', Float32Array, DECS * 6],
  ['bel', Float32Array, BELIEFS], ['mod', Int32Array, MODELS * 2], ['goal', Uint8Array, 8], ['hist', Float32Array, HIST * 3], ['histAt', Uint8Array, 1],
  ['rule', Uint8Array, RULES * 2], ['next', Int32Array, 1], ['last', Int32Array, 1], ['big', Int32Array, 1], ['lastNet', Float32Array, 1]
];
export const BYTES = COLS.reduce((n, [, A, w]) => n + A.BYTES_PER_ELEMENT * w, 0);
export function alloc(n) { const B = { n }; for (const [name, A, w] of COLS) B[name] = new A(n * w); return B; }
// a stream of their bytes a row at a time, and back (as the people's are: npc-pop.js packRows)
const ROW = 1000000;
export function* packRows(B) {
  let row = new Uint8Array(ROW), at = 0;
  for (const [name] of COLS) {
    const a = B[name], u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let k = 0; k < u.length;) { const n = Math.min(ROW - at, u.length - k); row.set(u.subarray(k, k + n), at); at += n; k += n; if (at === ROW) { yield row; row = new Uint8Array(ROW); at = 0; } }
  }
  if (at > 0) yield row.slice(0, at);
}
// (`rows`: any iterable of them — a storage's cursor too —, read one at a time: never all of them at once beside the minds)
export function unpack(B, rows) {
  const it = rows[Symbol.iterator]();
  let u = null, off = 0;
  for (const [name] of COLS) {
    const a = B[name], dst = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let at = 0; at < dst.length;) {
      if (!u || off >= u.length) { const x = it.next(); if (x.done) throw new Error('brain: the rows are shorter than the minds'); u = x.value instanceof Uint8Array ? x.value : new Uint8Array(x.value); off = 0; continue; }
      const n = Math.min(dst.length - at, u.length - off);
      dst.set(u.subarray(off, off + n), at); at += n; off += n;
    }
  }
  return B;
}

/* ---------------------------------------------------------------- a life's mind --- */
// a new life in slot `s` (gen: theirs): nothing remembered, nothing learnt but a little of their character's leaning
export function reset(B, s, gen, day, traits) {
  for (const [name, , w] of COLS) B[name].fill(0, s * w, s * w + w);
  B.gen[s] = gen; B.born[s] = day;
  if (traits) B.tr.set(traits, s * TRAITS);
  const tr = (t) => B.tr[s * TRAITS + t] / 255;
  // (their leanings before they learn: the careful towards saving, the bold towards the market, the vain towards treats)
  for (let x = 0; x < SITS; x++) {
    const v = (a) => s * ACTS * SITS + a * SITS + x;
    B.val[v(6)] = 0.1 * tr(T.thrift) + (x & 1 ? 0.1 : 0);
    B.val[v(8)] = 0.1 * tr(T.risk) - (x & 1 ? 0.1 : 0);
    B.val[v(1)] = 0.1 * tr(T.vanity);
    B.val[v(5)] = 0.1 * tr(T.extra);
    B.val[v(4)] = (x & 2 ? 0.1 : 0);
  }
  B.goal[s * 8] = tr(T.ambition) > 0.6 ? 1 : tr(T.thrift) > 0.6 ? 2 : tr(T.extra) > 0.6 ? 3 : 4;
}
// a memory: [day, kind, power] and a number (money, or who)
export function remember(B, s, day, kind, power, x = 0) {
  const k = B.memAt[s] % MEMS, at = (s * MEMS + k) * 2;
  B.mem[at] = ((day & 0xffff) << 16) | ((kind & 0xff) << 8) | (power & 0xff);
  B.mem[at + 1] = x >>> 0;
  B.memAt[s] = (k + 1) % MEMS;
}
export function memories(B, s, n = 10) {
  const out = [];
  for (let x = 1; x <= Math.min(n, MEMS); x++) {
    const k = (B.memAt[s] - x + MEMS) % MEMS, v = B.mem[(s * MEMS + k) * 2];
    if (!v) break;
    out.push({ day: v >>> 16, kind: (v >> 8) & 0xff, power: v & 0xff, x: B.mem[(s * MEMS + k) * 2 + 1] | 0 });
  }
  return out;
}
// the kind of moment (3 bits): short of money, stressed, a day off
export const sitOf = (p, off) => (p[P_.cash] < Math.max(30, p[P_.salary] / 12) ? 1 : 0) | (p[P_.stress] > 150 ? 2 : 0) | (off ? 4 : 0);

/* ---------------------------------------------------------------- perceiving --- */
// what happened: their body now (`p`, K numbers) and the minute's events of theirs ([kind, power, x]); the times
// (`g`: the day, the four companies' prices, the prices' level)
export function perceive(B, s, p, events, g) {
  for (const [kind, power, x] of events || []) {
    remember(B, s, g.day, kind, power, x);
    // (someone close in it: the one they know of most, by how much happened between them)
    if (x > 0 && (kind === 6 || kind === 7 || kind === 29)) know(B, s, x, kind === 6 ? 3 : 1);
  }
  // the day's line of their life: net worth, cash, mood (once a day)
  if (B.last[s] !== g.day) {
    const h = B.histAt[s] % HIST, at = (s * HIST + h) * 3;
    B.hist[at] = p[P_.net]; B.hist[at + 1] = p[P_.cash]; B.hist[at + 2] = p[P_.mood];
    B.histAt[s] = (h + 1) % HIST;
    // (what they expect of the times: their pay's growth, the prices', the market's by each company — each a little
    // towards what they see)
    const b = s * BELIEFS, was = B.lastNet[s];
    if (was) B.bel[b] += ((p[P_.net] - was) / Math.max(10, Math.abs(was)) - B.bel[b]) * 0.05;
    B.lastNet[s] = p[P_.net];
    if (g.cpi) B.bel[b + 1] += ((g.cpi - 1) - B.bel[b + 1]) * 0.05;
    (g.moves || []).forEach((r, k) => { B.bel[b + 4 + k] += (r - B.bel[b + 4 + k]) * (0.03 + 0.07 * B.tr[s * TRAITS + T.news] / 255); });
    B.last[s] = g.day;
  }
}
function know(B, s, who, w) {
  const at = s * MODELS * 2;
  let slot = -1, low = Infinity, lowAt = 0;
  for (let k = 0; k < MODELS; k++) { if (B.mod[at + k * 2] === who) { slot = k; break; } if (B.mod[at + k * 2 + 1] < low) { low = B.mod[at + k * 2 + 1]; lowAt = k; } }
  if (slot < 0) { slot = lowAt; B.mod[at + slot * 2] = who; B.mod[at + slot * 2 + 1] = 0; }
  B.mod[at + slot * 2 + 1] += w;
}

/* ---------------------------------------------------------------- thinking --- */
const PLANS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
// a hash's draw in [0, 1) (no shared random: a room's own, the same for the same person, minute and look)
const draw = (s, m, k) => { let h = (Math.imul(s + 1, 2654435761) ^ Math.imul(m + 1, 40503) ^ Math.imul(k + 7, 2246822519)) >>> 0; h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0; return (h >>> 0) / 4294967296; };
// What they mean to do now (null: nothing new): today's plans by what each has brought them in such a moment and what
// they lack, their character and their own rules; a big thing when looking ahead over `futures` of the months to come
// (as they see them) one is clearly better than doing nothing — at most one a day; their view of the companies.
export function think(B, s, p, g, m, futures = 256) {
  const tr = (t) => B.tr[s * TRAITS + t] / 255, sit = sitOf(p, g.off), vbase = s * ACTS * SITS;
  const val = (a) => B.val[vbase + a * SITS + sit];
  const lack = (k) => 1 - p[P_.needs + k] / 255;
  // the plans: what they lack (fun, thrill, status, security, …), what it brought before, their own rules
  const want = [0, lack(0) * 0.6 + lack(2) * 0.4 * tr(T.vanity), lack(0) * 0.3 + (sit & 2 ? 0.4 * tr(T.impulse) : 0), lack(4) * 0.5 * tr(T.car), lack(6) + p[P_.tired] / 255,
    lack(5) * (0.4 + tr(T.extra)), lack(3) * (0.5 + tr(T.thrift)) + (sit & 1 ? 0.5 : 0), lack(0) * 0.5 * (g.off ? 1.4 : 0.6), tr(T.risk) * tr(T.news) * 0.6 * (1 + B.bel[s * BELIEFS + 4]), 0.15 * tr(T.justice)];
  const temp = 0.15 + 0.35 * tr(T.impulse);
  const scored = PLANS.map((a) => [a, want[a] + val(a) - ruled(B, s, a, sit) + temp * (draw(s, m, a) - 0.5)]).sort((x, y) => y[1] - x[1]);
  const plans = scored.filter((x) => x[1] > 0.2).slice(0, 2).map((x) => x[0]);
  // a big thing (once a day at most): each looked ahead over the futures they see, against doing nothing
  let act = null;
  if (B.big[s] !== g.day) {
    const best = ahead(B, s, p, g, m, futures);
    if (best) { act = best; B.big[s] = g.day; }
  }
  // their view of each company: what its price has done of late, as far as they follow the news, and what it brought them
  const view = [0, 1, 2, 3].map((k) => Math.max(-2, Math.min(2, Math.round((B.bel[s * BELIEFS + 4 + k] * 30 + val(8) * 2) * (0.5 + tr(T.news))))));
  const changed = act || plans.join() !== String(B.goal[s * 8 + 4] || '') + ',' + String(B.goal[s * 8 + 5] || '');
  B.goal[s * 8 + 4] = plans[0] || 0; B.goal[s * 8 + 5] = plans[1] || 0;
  // (what was decided, kept to be reckoned with at night: the action, the moment, what it was expected to bring, the
  // net worth and mood it began from, the day)
  for (const a of act ? [BIG + act.code] : plans.slice(0, 1)) note(B, s, a, sit, act ? act.gain : val(a), p, g.day);
  return changed ? { plans, act, view } : null;
}
// the big things looked ahead: the months to come as they see them (their pay's growth and its spread, the market's
// moves by their beliefs), each option's net worth a year on, weighed by their care for risk; the best if clearly
// better than doing nothing and its own value of late not against it
function ahead(B, s, p, g, m, futures) {
  const tr = (t) => B.tr[s * TRAITS + t] / 255, b = s * BELIEFS, sit = sitOf(p, g.off);
  const cash = p[P_.cash], debt = p[P_.debt], pay = p[P_.salary] / 12, net = p[P_.net];
  const care = 0.5 + 1.5 * (1 - tr(T.risk));
  const opts = [{ code: ACT.none }];
  if (p[P_.job] === 0 || (p[P_.stress] > 170 && tr(T.ambition) > 0.4)) opts.push({ code: ACT.job, gain0: pay * 3 });
  if (!p[P_.car] && cash > 300 && tr(T.car) > 0.5) opts.push({ code: ACT.car, cost: Math.min(cash * 0.6, 600), joy: 0.4 * tr(T.car) });
  for (let k = 0; k < 4; k++) { const mu = B.bel[b + 4 + k]; if (cash > 100 && mu > 0.005) opts.push({ code: ACT.buy, k, pct: Math.round(10 + 30 * tr(T.risk)), mu }); if (mu < -0.01) opts.push({ code: ACT.sell, k, pct: Math.round(30 + 50 * (1 - tr(T.patience))), mu }); }
  if (debt > 0 && cash > debt * 0.3) opts.push({ code: ACT.repay, amt: Math.round(Math.min(debt, cash * 0.3)) });
  if (cash < pay && debt < pay * 6) opts.push({ code: ACT.borrow, amt: Math.round(Math.max(30, pay)) });
  if (opts.length === 1) return null;
  const grow = B.bel[b], sd = 0.05 + 0.1 * (1 - tr(T.consc));
  const n = Math.max(16, Math.min(futures, 4096));
  let bestScore = -Infinity, best = null, base = 0;
  for (const o of opts) {
    let sum = 0, sq = 0;
    for (let f = 0; f < n; f++) {
      const z = (draw(s, m + f, o.code * 31 + (o.k || 0)) - 0.5) * 2 * sd;
      let w = net + pay * 12 * (1 + grow + z) * 0.1;
      if (o.code === ACT.job) w += o.gain0 * (0.5 + draw(s, m, f) );
      if (o.code === ACT.car) w -= o.cost * 0.3;
      if (o.code === ACT.buy) w += cash * o.pct / 100 * (o.mu * 12 + z * 3);
      if (o.code === ACT.sell) w -= cash * 0.01 * o.mu * 12;
      if (o.code === ACT.repay) w += o.amt * 0.1;
      if (o.code === ACT.borrow) w += (sit & 1 ? pay * 0.5 : -pay * 0.2) - o.amt * 0.15;
      sum += w; sq += w * w;
    }
    const mean = sum / n, spread = Math.sqrt(Math.max(0, sq / n - mean * mean));
    const score = (mean - net) / Math.max(10, Math.abs(net) * 0.05 + pay) - care * spread / Math.max(10, Math.abs(net) + pay * 12) + (o.joy || 0) + (o.code ? B.val[s * ACTS * SITS + (BIG + o.code) * SITS + sit] : 0) - (o.code ? ruled(B, s, BIG + o.code, sit) : 0);
    if (o.code === ACT.none) base = score;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (!best || best.code === ACT.none || bestScore - base < 0.15 + 0.3 * tr(T.patience)) return null;
  return { code: best.code, k: best.k, pct: best.pct, amt: best.amt, gain: Math.round((bestScore - base) * 100) / 100 };
}
function note(B, s, a, sit, expect, p, day) {
  const k = B.decAt[s] % DECS, at = (s * DECS + k) * 6;
  B.dec[at] = day; B.dec[at + 1] = a; B.dec[at + 2] = sit; B.dec[at + 3] = expect; B.dec[at + 4] = p[P_.net]; B.dec[at + 5] = p[P_.mood];
  B.decAt[s] = (k + 1) % DECS;
}
// a rule of their own against an action in such a moment (a penalty: 0 none)
function ruled(B, s, a, sit) {
  for (let k = 0; k < RULES; k++) { const at = (s * RULES + k) * 2; if (B.rule[at] === a + 1 && (B.rule[at + 1] & sit) === B.rule[at + 1]) return 0.6; }
  return 0;
}

/* ---------------------------------------------------------------- the night --- */
// Reflection (21:45): each decision of the last days whose results are in, its reckoning — what it came to (their net
// worth and mood since) against what it was expected to bring —, what each action brings in such a moment learnt
// (the faster the keener to learn), and a rule made of what keeps going wrong (an action that keeps costing them in a
// moment of a kind: they keep from it then). Returns how many were reckoned.
export function reflect(B, s, p, day) {
  const lr = 0.05 + 0.2 * B.tr[s * TRAITS + T.learn] / 255;
  let n = 0;
  for (let k = 0; k < DECS; k++) {
    const at = (s * DECS + k) * 6, d = B.dec[at];
    if (!d || day - d < 1 || day - d > 7 || B.dec[at + 3] === -999) continue;
    const a = B.dec[at + 1], sit = B.dec[at + 2];
    const scale = Math.max(10, Math.abs(B.dec[at + 4]) * 0.02 + p[P_.salary] / 12);
    const got = (p[P_.net] - B.dec[at + 4]) / scale * 0.5 + (p[P_.mood] - B.dec[at + 5]) / 255;
    const v = s * ACTS * SITS + a * SITS + sit;
    B.val[v] += (Math.max(-1, Math.min(1, got)) - B.val[v]) * lr;
    B.cnt[v] = Math.min(65535, B.cnt[v] + 1);
    B.dec[at + 3] = -999;
    n++;
    // (a weakness found: three times or more and it keeps costing — a rule against it in such a moment)
    if (B.cnt[v] >= 3 && B.val[v] < -0.25) addRule(B, s, a, sit);
  }
  return n;
}
function addRule(B, s, a, sit) {
  let free = -1;
  for (let k = 0; k < RULES; k++) { const at = (s * RULES + k) * 2; if (B.rule[at] === a + 1 && B.rule[at + 1] === sit) return; if (!B.rule[at] && free < 0) free = k; }
  const k = free >= 0 ? free : (s + a) % RULES, at = (s * RULES + k) * 2;
  B.rule[at] = a + 1; B.rule[at + 1] = sit;
}

/* ---------------------------------------------------------------- the profile --- */
const ACT_NAMES = ['', 'ご褒美', '買い物', '車を見る', '休む', '友だち', '節約', 'お出かけ', '投資', '地元で買う', '何もしない', '転職を考える', '車を買う', '株を買う', '株を売る', 'お金を借りる', '借金を返す'];
const SIT_NAMES = (x) => [x & 1 ? 'お金がないとき' : '', x & 2 ? 'ストレスがたまったとき' : '', x & 4 ? '休みの日' : ''].filter(Boolean).join('・') || 'ふだん';
const GOALS = ['', '出世して成功する', 'お金を貯めて安心する', '人とのつながりを大切にする', '自分らしく楽しく暮らす'];
// what their mind shows of itself (the operators' and the 街ライブ's profile): their goal, what they have learnt works
// and does not, their own rules, their last decisions and how they came out, how much they remember
export function profile(B, s) {
  const vbase = s * ACTS * SITS, learnt = [];
  for (let a = 1; a < ACTS; a++) for (let x = 0; x < SITS; x++) { const v = B.val[vbase + a * SITS + x], c = B.cnt[vbase + a * SITS + x]; if (c >= 2) learnt.push([a, x, v]); }
  learnt.sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]));
  const rules = [];
  for (let k = 0; k < RULES; k++) { const at = (s * RULES + k) * 2; if (B.rule[at]) rules.push(`${SIT_NAMES(B.rule[at + 1])}は「${ACT_NAMES[B.rule[at]] || ''}」をしない`); }
  const decs = [];
  for (let x = 1; x <= 5; x++) { const k = (B.decAt[s] - x + DECS) % DECS, at = (s * DECS + k) * 6; if (!B.dec[at]) break; decs.push({ day: B.dec[at], what: ACT_NAMES[B.dec[at + 1]] || '', when: SIT_NAMES(B.dec[at + 2]), done: B.dec[at + 3] === -999 }); }
  let mem = 0;
  for (let k = 0; k < MEMS; k++) if (B.mem[(s * MEMS + k) * 2]) mem++;
  return {
    goal: GOALS[B.goal[s * 8]] || '', memories: mem,
    learnt: learnt.slice(0, 5).map(([a, x, v]) => `${SIT_NAMES(x)}の「${ACT_NAMES[a]}」は${v > 0 ? '良い' : '良くない'}`),
    rules, decisions: decs
  };
}
