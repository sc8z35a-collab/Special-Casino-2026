// 少数精鋭集団アルファ (js/game/npc.js NPC.alpha): the 90 of 選ばれし300人 (ヴェルノア's part of them: the market is its
// own) with the most, made members for a month — never more, never fewer, never out of it by their own will, never
// dissolved; one gone (a death, a move abroad) replaced at once by the next with the most —, its 10 at the top talking it
// over each day and all 90 following: at most two companies, at most two trades a day together, every day, up to $5B a
// day between them (each by what they have). Its orders are the market's own (server/core/npc-market.js): they trade
// against the people's, and what they leave over moves the price — once, the minute they go in. What it makes or loses
// is each member's, by what each put in (the shares bought are their own). It does nothing but invest: its members live
// their days as before, nobody treats them otherwise.
//
// The talk: by the AI (Workers AI, server/core/npc.js alphaTalk: 15〜25 messages in the three ways of thinking) when
// there is one and it is done before the first order goes in; else this module's own, from the same numbers. Each
// day kept once all its orders are filled (or at the market's close, what was left cancelled): 70 days of it.
import { NPC, CORP } from './rules.js';
import { FL, LISTED, ageOf, nameOf } from './npc-pop.js';
import { LISTED_IDS } from './npc-market.js';
import { wealthOf } from './npc-welfare.js';
import { hash32 } from './npc-rand.js';

const A = NPC.alpha, FROM = CORP.dayAt(...A.from), STYLE = A.styles;
const NAMES = { riru: 'RIRU', ice: 'ICE', magita: 'MAGITA', tenesice: 'テネシス' };
const nameOfCo = (id) => NAMES[id] || id;
const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const money = (n) => CORP.fmt.money(Math.round(n));

/* ------------------------------------------------------------ its members --- */
// how many: 90 of a full country, its share of them at a country's size — never fewer than the 10 who talk
const sizeOf = (W) => Math.max(A.top, Math.round(A.n * (W.scale || W.P.n / NPC.nation.population)));
const pricesOf = (ctx) => LISTED_IDS.map((id) => (ctx && ctx.stockPrice ? ctx.stockPrice(id) || 0 : 0));
// the month's 90: 選ばれし300人's with the most (and, in a country too small to have enough of them, the next with the most)
function choose(W, day, ctx, keep = []) {
  const P = W.P, px = pricesOf(ctx), want = sizeOf(W), elite = [], rest = [];
  for (let i = 0; i < P.n; i++) {
    if (ageOf(P, i, day) < NPC.life.adult || keep.includes(i)) continue;
    (P.flags[i] & FL.elite ? elite : rest).push([i, wealthOf(W, i, px)]);
  }
  const by = (a, b) => b[1] - a[1] || a[0] - b[0];
  elite.sort(by); rest.sort(by);
  return elite.concat(rest).slice(0, Math.max(0, want - keep.length)).map((x) => x[0]);
}
// a new month (and its first day, 2026-11-05): its members chosen again; those who leave keep what they bought
function newTerm(W, day, ctx) {
  const P = W.P, G = W.alpha;
  for (let i = 0; i < P.n; i++) P.flags[i] &= ~FL.alpha;
  const members = choose(W, day, ctx);
  for (const i of members) P.flags[i] |= FL.alpha;
  const left = Object.keys(G.pos).map(Number).filter((i) => !members.includes(i));
  for (const i of left) { delete G.pos[i]; delete G.cost[i]; }
  const px = pricesOf(ctx);
  G.members = members.map((i) => ({ i, gen: P.gen[i], name: nameOf(P, i).name, from: day, wealth: Math.round(wealthOf(W, i, px)) }));
  G.term = { since: day, key: CORP.monthKey(day), n: members.length, left: left.length };
  G.terms = (G.terms || []).concat([{ since: day, n: members.length, names: G.members.slice(0, A.top).map((m) => m.name) }]).slice(-6);
  W.news.push({ day, kind: 'alpha', district: -1, text: `少数精鋭集団アルファ：${CORP.ymd(day).m}月の定員${members.length}名が決定（資産上位の選ばれし者から）`, data: { n: members.length } });
}
// one gone (a death: the place taken by a newborn; a move abroad): the next with the most in their place, at once
function keepFull(W, day, ctx) {
  const P = W.P, G = W.alpha;
  const gone = G.members.filter((m) => P.gen[m.i] !== m.gen || ageOf(P, m.i, day) < NPC.life.adult);
  if (!gone.length) return;
  for (const m of gone) { P.flags[m.i] &= ~FL.alpha; delete G.pos[m.i]; delete G.cost[m.i]; }
  const stay = G.members.filter((m) => !gone.includes(m));
  const add = choose(W, day, ctx, stay.map((m) => m.i)), px = pricesOf(ctx);
  for (const i of add) { P.flags[i] |= FL.alpha; stay.push({ i, gen: P.gen[i], name: nameOf(P, i).name, from: day, wealth: Math.round(wealthOf(W, i, px)) }); }
  G.members = stay;
}

/* ------------------------------------------------------------ the numbers --- */
// what the 10 look at: each company's price now and of late, its worth, its dividend, how much it moves, the group's
// holding of it and how that stands
function board(W, ctx) {
  const G = W.alpha, corp = ctx && ctx.corp, px = pricesOf(ctx);
  return LISTED_IDS.map((id, k) => {
    const h = G.px[id] || [], p = px[k] || 0, at = (n) => (h.length > n ? h[h.length - 1 - n] : h[0] || p);
    const r1 = at(1) ? p / at(1) - 1 : 0, r5 = at(5) ? p / at(5) - 1 : 0, r20 = at(20) ? p / at(20) - 1 : 0;
    let v = 0;
    for (let j = Math.max(1, h.length - 20); j < h.length; j++) { const x = Math.log(h[j] / h[j - 1]); v += x * x; }
    const vol = h.length > 2 ? Math.sqrt(v / Math.min(20, h.length - 1)) : 0.02;
    const s = corp && corp.co[id], fair = (ctx && ctx.fair && ctx.fair[id]) || (s && s.mkt && s.mkt.fair) || p;
    const dps = (s && s.div && s.div.dps) || 0;
    let held = 0, cost = 0;
    for (const [i, pos] of Object.entries(G.pos)) { held += pos[k]; cost += pos[k] * ((G.cost[i] && G.cost[i][k]) || p); }
    return { id, k, name: nameOfCo(id), price: p, r1, r5, r20, vol, fair, value: fair > 0 && p > 0 ? Math.log(fair / p) : 0, yield: p > 0 ? dps / p : 0, held, heldValue: held * p, gain: cost > 0 ? held * p / cost - 1 : 0 };
  });
}
// each way of thinking's view of a company (higher: the more it wants it)
function scoreOf(style, b) {
  if (style === 'value') return 0.8 * b.value + 10 * b.yield - 0.5 * Math.max(0, b.r20);
  if (style === 'swing') return -3 * b.r5 + 1.2 * b.r1 + 2 * b.vol - (b.gain > 0.05 ? 0.4 : 0);
  return -8 * b.vol + 0.4 * b.value + 5 * b.yield + (b.id === 'tenesice' ? 0.12 : b.id === 'magita' ? 0.08 : 0);
}
// the 10: those of the members with the most now, each in one of the three ways (in turn, from the one with the most)
function talkers(W, ctx) {
  const P = W.P, px = pricesOf(ctx);
  return W.alpha.members.map((m) => ({ ...m, wealth: wealthOf(W, m.i, px) })).sort((a, b) => b.wealth - a.wealth || a.i - b.i).slice(0, A.top)
    .map((m, r) => ({ i: m.i, name: m.name, rank: r + 1, style: STYLE[r % STYLE.length].id, styleName: STYLE[r % STYLE.length].name, wealth: Math.round(m.wealth), age: ageOf(P, m.i, W.day) }));
}
// the plan the numbers come to: each of the 10 for the company their way likes best (the richer the louder), the
// winners; what is held and has done well (or turned against them) sold; never more than two companies, two trades
export function planOf(W, B, T) {
  const votes = {}, by = {};
  for (const t of T) {
    const best = B.map((b) => [b.id, scoreOf(t.style, b)]).sort((a, b) => b[1] - a[1]);
    const w = 1 + (A.top - t.rank) * 0.1;
    votes[best[0][0]] = (votes[best[0][0]] || 0) + w;
    by[t.style] = (by[t.style] || 0) + w;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const lead = Object.entries(by).sort((a, b) => b[1] - a[1])[0][0];
  const trades = [];
  // (a holding that did well, or that the room has turned against: sold — the swing camp takes profits sooner)
  const sell = B.filter((b) => b.held > 0 && (b.gain >= (lead === 'swing' ? 0.03 : 0.06) || b.gain <= -0.08 || !votes[b.id])).sort((a, b) => b.heldValue - a.heldValue)[0];
  const first = ranked[0][0], second = ranked[1] && ranked[1][1] >= ranked[0][1] * 0.6 ? ranked[1][0] : null;
  if (sell && sell.id !== first) {
    trades.push({ company: sell.id, side: 'sell', share: sell.gain >= 0.1 || sell.gain <= -0.08 ? 100 : 50 });
    trades.push({ company: first, side: 'buy', share: 100 });
  } else if (lead === 'swing' && !second && B.find((b) => b.id === first).vol > 0.012) {
    // (デイトレード: in in the morning, out in the afternoon)
    trades.push({ company: first, side: 'buy', share: 100 }, { company: first, side: 'sell', share: 100, same: true });
  } else if (second) {
    const s1 = Math.round(100 * ranked[0][1] / (ranked[0][1] + ranked[1][1]) / 10) * 10;
    trades.push({ company: first, side: 'buy', share: s1 }, { company: second, side: 'buy', share: 100 - s1 });
  } else trades.push({ company: first, side: 'buy', share: 100 });
  return { trades, lead, votes: Object.fromEntries(ranked.map(([k, v]) => [k, Math.round(v * 100) / 100])), strategy: strategyOf(trades) };
}
function strategyOf(trades) {
  if (trades.length === 2 && trades[1].same) return 'デイトレード';
  if (trades.some((t) => t.side === 'sell')) return '入れ替え型トレード';
  return trades.length === 2 ? '2社への分散投資（スイング）' : '1社への集中投資（スイング）';
}
// a plan from the AI's last word (結論: 買い magita 60, 売り ice 100): read, and taken only as the rules allow
export function readPlan(text, B) {
  const ids = LISTED_IDS, trades = [];
  const re = /(買い|売り)\s*[:：]?\s*([A-Za-zァ-ヶー]+)\s*[:：]?\s*(\d{1,3})\s*%?/g;
  let m;
  while ((m = re.exec(String(text || ''))) && trades.length < A.trades) {
    const word = m[2].toLowerCase(), id = ids.find((x) => x === word || nameOfCo(x).toLowerCase() === word);
    if (!id) continue;
    const side = m[1] === '買い' ? 'buy' : 'sell', share = Math.max(10, Math.min(100, Number(m[3]) || 0));
    const b = B.find((x) => x.id === id);
    if (side === 'sell' && !(b && b.held > 0) && !trades.some((t) => t.company === id && t.side === 'buy')) continue;
    trades.push({ company: id, side, share, ...(trades.some((t) => t.company === id) ? { same: true } : {}) });
  }
  const companies = new Set(trades.map((t) => t.company));
  if (!trades.length || companies.size > A.companies || !trades.some((t) => t.side === 'buy') && !trades.some((t) => t.side === 'sell')) return null;
  // (the buys' shares of the day's money together never beyond all of it)
  const buys = trades.filter((t) => t.side === 'buy'), sum = buys.reduce((n, t) => n + t.share, 0);
  if (sum > 100) for (const t of buys) t.share = Math.round(t.share * 100 / sum);
  return { trades, strategy: strategyOf(trades) };
}

/* ------------------------------------------------------------ the talk --- */
// its own words, from the same numbers (no AI here, or the AI late): 15〜25 messages, the three ways in turn
function talkOf(W, day, B, T, plan) {
  const n = A.msgs[0] + (hash32(day, 77) % (A.msgs[1] - A.msgs[0] + 1));
  const msgs = [], best = (style) => B.map((b) => [b, scoreOf(style, b)]).sort((a, b) => b[1] - a[1]);
  const line = (t, k) => {
    const [top, second] = best(t.style), b = top[0], o = second[0];
    const v = [
      () => t.style === 'value' ? `${b.name}は理論株価${money(b.fair)}に対して今${money(b.price)}。配当利回り${(b.yield * 100).toFixed(1)}%なら、今週はここを厚くしたい。`
        : t.style === 'swing' ? `${b.name}は5日で${pct(b.r5)}、前日比${pct(b.r1)}。この振れ幅（日に${(b.vol * 100).toFixed(1)}%）ならリバウンドを取りにいける。`
          : `${b.name}は値動きが日に${(b.vol * 100).toFixed(1)}%と落ち着いている。国の土台になる会社に資金を置くのが一番堅い。`,
      () => `${o.name}も悪くないが、${t.style === 'value' ? '割安さ' : t.style === 'swing' ? '反発の余地' : '安定感'}では${b.name}に一歩譲ると思う。`,
      () => b.held > 0 ? `うちの${b.name}の持ち分は${money(b.heldValue)}、含み${pct(b.gain)}。${b.gain > 0.05 ? '一度利益を確定してもいい水準だ。' : 'まだ伸ばせる。'}` : `${b.name}はまだ持っていない。今日の5Bの枠をどう配るかだ。`,
      () => `20日で見ると${b.name}は${pct(b.r20)}。${b.r20 < 0 ? '下げた分だけ戻りもある。' : '勢いが続くうちに乗りたい。'}`,
      () => `${o.name}は${pct(o.r5)}。${t.style === 'swing' ? '短期なら面白いが、2社までのルールなら優先度は下がる。' : '今日は見送りでいい。'}`
    ];
    return v[(k + t.rank) % v.length]();
  };
  const lead = T[0], cap = money(A.cap * (W.scale || 1));
  msgs.push({ i: lead.i, name: lead.name, style: lead.style, text: `今日の議題です。重点的に投資する企業を決めましょう。最大2社・売買は全員で2回まで、今日の枠は${cap}です。私は${best(lead.style)[0][0].name}が気になっています。` });
  for (let k = 1; k < n - 1; k++) { const t = T[k % T.length]; msgs.push({ i: t.i, name: t.name, style: t.style, text: line(t, k) }); }
  const words = plan.trades.map((t) => `${t.side === 'buy' ? '買い' : '売り'} ${nameOfCo(t.company)} ${t.share}%`).join('、');
  msgs.push({ i: lead.i, name: lead.name, style: lead.style, text: `まとめます。今日は${plan.strategy}。結論：${words}。全員この配分で注文を出してください。`, last: true });
  return msgs;
}

/* ------------------------------------------------------------ the day --- */
// The new day `day` (npc-model.js nextDay): founded on 2026-11-05; each month's 90; the day's meeting set up (its plan
// from the numbers; the AI asked to talk it over, when there is one)
export function day(W, day, ctx, aiOn = false) {
  if (day < FROM) return;
  const G = W.alpha || (W.alpha = { founded: day, members: [], pos: {}, cost: {}, put: {}, got: {}, px: {}, hist: [], out: [], seq: 0, sum: { days: 0, bought: 0, sold: 0, realized: 0, fees: 0 } });
  // (the closes of late, for the talk: a month of them)
  const px = pricesOf(ctx);
  LISTED_IDS.forEach((id, k) => { if (px[k] > 0) { const h = G.px[id] || (G.px[id] = []); h.push(px[k]); if (h.length > 31) h.shift(); } });
  if (!G.term || G.term.key !== CORP.monthKey(day)) newTerm(W, day, ctx);
  else keepFull(W, day, ctx);
  // yesterday's, not yet kept: what was left of it out of the book, kept now (the market closed on it)
  if (G.today && !G.today.kept) { cancel(W, G.today); closeDay(W, G.today.day, 'close'); }
  // (a member's own trades are their own: what the group holds of theirs never beyond what they hold)
  for (const [i, pos] of Object.entries(G.pos)) for (let k = 0; k < LISTED; k++) pos[k] = Math.max(0, Math.min(pos[k], W.P.sh[Number(i) * LISTED + k]));
  const B = board(W, ctx), T = talkers(W, ctx), plan = planOf(W, B, T);
  G.today = {
    day, plan, mine: plan, board: B.map((b) => ({ id: b.id, name: b.name, price: b.price, r1: round4(b.r1), r5: round4(b.r5), r20: round4(b.r20), vol: round4(b.vol), fair: Math.round(b.fair), yield: round4(b.yield), held: b.held, gain: round4(b.gain) })),
    talkers: T, talk: { status: aiOn ? 'pending' : 'own', target: A.msgs[0] + (hash32(day, 77) % (A.msgs[1] - A.msgs[0] + 1)), msgs: aiOn ? [] : talkOf(W, day, B, T, plan), ai: false },
    orders: [], placed: 0, kept: false
  };
}
const round4 = (x) => Math.round(x * 10000) / 10000;
// the AI's talk done (npc.js): its words and its plan, if it came before the first order went in and reads as the rules allow
export function heard(W, day, msgs, text) {
  const G = W.alpha, t = G && G.today;
  if (!t || t.day !== day || t.placed || t.talk.status === 'done' || t.talk.status === 'timeout') return false;
  const B = t.board.map((b) => ({ ...b, heldValue: b.held * b.price }));
  const plan = readPlan(text, B);
  t.talk.msgs = msgs;
  t.talk.ai = true;
  t.talk.status = 'done';
  if (plan) t.plan = { ...plan, lead: t.mine.lead, votes: t.mine.votes, by: 'ai' };
  else t.talk.unread = true;
  return true;
}

/* ------------------------------------------------------------ its orders --- */
// The minute `m` (npc-model.js tick, before the market's matching; `t` its minute of the day in JST): the day's trades
// in at their minutes; the first one in ends the talk (the AI's late: its own words and plan stand)
export function tick(W, m, t, ctx) {
  const G = W.alpha, d = G && G.today;
  if (!d || d.kept || Math.floor(m / 1440) !== d.day) return;
  const due = A.at.filter((x) => t >= x).length;
  if (due > d.placed && d.placed < d.plan.trades.length) {
    if (d.talk.status === 'pending' || d.talk.status === 'talking') {
      const B = d.board.map((b) => ({ ...b, heldValue: b.held * b.price, value: b.fair > 0 && b.price > 0 ? Math.log(b.fair / b.price) : 0 }));
      d.talk.aiPart = d.talk.msgs.length;
      d.talk.msgs = d.talk.msgs.concat(talkOf(W, d.day, B, d.talkers, d.plan).slice(d.talk.msgs.length));
      d.talk.status = 'timeout';
    }
    for (; d.placed < Math.min(due, d.plan.trades.length); d.placed++) place(W, m, d, d.plan.trades[d.placed], ctx);
  }
  if (t >= A.close && !d.kept) { cancel(W, d); closeDay(W, d.day, 'close'); }
}
// one trade in: a buy split among the 90 by what each has (the day's $5B together, each within their cash), a sale of
// each one's part of the holding; each at a limit a little past the price (the price's move by it: the market's)
function place(W, m, d, tr, ctx) {
  const G = W.alpha, P = W.P, k = LISTED_IDS.indexOf(tr.company), price = ctx && ctx.stockPrice ? ctx.stockPrice(tr.company) : 0;
  const o = { n: d.orders.length, company: tr.company, side: tr.side, share: tr.share, at: m, price, value: 0, shares: 0, filled: 0, paid: 0, left: 0, status: 'open', by: {} };
  d.orders.push(o);
  if (k < 0 || !price) { o.status = 'skipped'; return; }
  const book = W.marketState.book[tr.company];
  if (tr.side === 'buy') {
    const cap = A.cap * (W.scale || 1), want = cap * tr.share / 100 - d.orders.filter((x) => x.side === 'buy' && x !== o).reduce((n, x) => n + x.value, 0);
    const limit = Math.round(price * (1 + A.slip)), px = pricesOf(ctx);
    // (each by what they have, within 90% of their cash: what one cannot put in, the others by the same rule)
    let left = Math.max(0, want);
    const share = new Map();
    let pool = G.members.map((x) => [x.i, Math.max(0, wealthOf(W, x.i, px))]).filter((x) => x[1] > 0 && P.cash[x[0]] > 0);
    for (let round = 0; round < 4 && left > 1 && pool.length; round++) {
      const total = pool.reduce((n, x) => n + x[1], 0), next = [];
      let used = 0;
      for (const [i, w] of pool) {
        const room = Math.max(0, P.cash[i] * 0.9 - (share.get(i) || 0));
        const g = Math.min(room, left * w / total);
        if (g > 0) { share.set(i, (share.get(i) || 0) + g); used += g; }
        if (room - g > 1) next.push([i, w]);
      }
      left -= used;
      pool = next;
    }
    for (const [i, v] of share) {
      const n = Math.floor(v / (limit * 1.02));
      if (n <= 0) continue;
      const id = ++G.seq;
      book.buy.push([i, n, limit, 'A', id, m]);
      o.by[i] = [n, n, id];
      o.shares += n; o.value += n * price;
    }
  } else {
    const limit = Math.max(1, Math.round(price * (1 - A.slip)));
    for (const [i, pos] of Object.entries(G.pos)) {
      const n = Math.floor(pos[k] * tr.share / 100);
      if (n <= 0) continue;
      const id = ++G.seq;
      book.sell.push([Number(i), n, limit, 'A', id, m]);
      o.by[i] = [n, n, id];
      o.shares += n; o.value += n * price;
    }
  }
  o.left = o.shares;
  if (!o.shares) o.status = 'none';
}
// the market's fills of its orders this minute (npc-market.js: [k, i, n, price, side, id]); each member's holding and
// what it cost them, what a sale made; and the day kept once all of it is in
export function filled(W, m) {
  const G = W.alpha, d = G && G.today, ms = W.marketState;
  if (!d || !ms || !ms.alphaFills || !ms.alphaFills.length) return;
  const fee = (W.fees && W.fees.tradeFee !== undefined ? W.fees.tradeFee : 0.018);
  for (const [k, i, n, price, side, id] of ms.alphaFills.splice(0)) {
    const o = d.orders.find((x) => x.by[i] && x.by[i][2] === id);
    if (!o) continue;
    o.by[i][1] -= n; o.left -= n; o.filled += n; o.paid += n * price;
    const pos = G.pos[i] || (G.pos[i] = [0, 0, 0, 0]), cost = G.cost[i] || (G.cost[i] = [0, 0, 0, 0]);
    if (side === 'buy') {
      cost[k] = Math.round(((cost[k] || price) * pos[k] + price * n) / Math.max(1, pos[k] + n));
      pos[k] += n;
      G.put[i] = (G.put[i] || 0) + n * price;
      G.sum.bought += n * price;
    } else {
      const c = cost[k] || price, gain = (price - c) * n;
      pos[k] = Math.max(0, pos[k] - n);
      G.got[i] = (G.got[i] || 0) + gain;
      G.sum.realized += gain;
      G.sum.sold += n * price;
    }
    G.sum.fees += Math.ceil(n * price * fee);
    if (o.left <= 0) o.status = 'filled';
  }
  // (all of today's in and filled: kept this minute)
  if (d.placed >= d.plan.trades.length && d.orders.every((o) => o.status !== 'open')) closeDay(W, d.day, 'filled', m);
}
// what is left of its orders at the close: out of the book
function cancel(W, d) {
  const ids = new Set();
  for (const o of d.orders) if (o.status === 'open') { for (const x of Object.values(o.by)) if (x[1] > 0) ids.add(x[2]); o.status = o.filled ? 'partial' : 'cancelled'; }
  if (!ids.size) return;
  for (const id of LISTED_IDS) {
    const b = W.marketState.book[id];
    b.buy = b.buy.filter((o) => !(o[3] === 'A' && ids.has(o[4])));
    b.sell = b.sell.filter((o) => !(o[3] === 'A' && ids.has(o[4])));
  }
}
// an order the market dropped (its price ran past its limit): what was left of it, cancelled
export function swept(W) {
  const G = W.alpha, d = G && G.today;
  if (!d || d.kept) return;
  const live = new Set();
  for (const id of LISTED_IDS) { const b = W.marketState.book[id]; for (const o of b.buy) if (o[3] === 'A') live.add(o[4]); for (const o of b.sell) if (o[3] === 'A') live.add(o[4]); }
  for (const o of d.orders) {
    if (o.status !== 'open') continue;
    for (const x of Object.values(o.by)) if (x[1] > 0 && !live.has(x[2])) { o.left -= x[1]; x[1] = 0; o.past = true; }
    if (o.left <= 0) o.status = o.filled >= o.shares ? 'filled' : o.filled ? 'partial' : 'cancelled';
  }
}
// the day kept: what was said, what was decided, what was filled, how the 90 stand
function closeDay(W, day, why, m = null) {
  const G = W.alpha, d = G.today;
  if (!d || d.day !== day || d.kept) return;
  d.kept = true;
  const P = W.P, px = d.board.map((b) => b.price);
  let held = 0, cost = 0;
  const members = G.members.map((x) => {
    const pos = G.pos[x.i] || [0, 0, 0, 0], c = G.cost[x.i] || [0, 0, 0, 0];
    const value = pos.reduce((n, s, k) => n + s * (px[k] || 0), 0), paid = pos.reduce((n, s, k) => n + s * (c[k] || 0), 0);
    held += value; cost += paid;
    return { i: x.i, name: x.name, put: Math.round(G.put[x.i] || 0), value: Math.round(value), open: Math.round(value - paid), realized: Math.round(G.got[x.i] || 0) };
  });
  G.sum.days++;
  const rec = {
    day, key: CORP.dateLabel(day), why, at: m, members: members.length, top: d.talkers.map((t) => ({ i: t.i, name: t.name, style: t.style, styleName: t.styleName, rank: t.rank })),
    talk: { msgs: d.talk.msgs, ai: d.talk.ai, status: d.talk.status, aiPart: d.talk.aiPart || 0, unread: !!d.talk.unread }, plan: d.plan, board: d.board,
    orders: d.orders.map((o) => ({ company: o.company, side: o.side, share: o.share, at: o.at, price: o.price, shares: o.shares, filled: o.filled, value: Math.round(o.value), paid: Math.round(o.paid), status: o.status, past: !!o.past, members: Object.keys(o.by).length })),
    held: Math.round(held), open: Math.round(held - cost), realized: Math.round(G.sum.realized), bought: Math.round(G.sum.bought), sold: Math.round(G.sum.sold),
    standing: members.sort((a, b) => b.put - a.put).slice(0, 90)
  };
  void P;
  G.hist.push({ day, key: rec.key, why, strategy: d.plan.strategy, trades: d.plan.trades, ai: d.talk.ai, msgs: d.talk.msgs.length, orders: rec.orders.map((o) => ({ company: o.company, side: o.side, filled: o.filled, shares: o.shares, status: o.status, paid: o.paid })), held: rec.held, open: rec.open, realized: rec.realized });
  if (G.hist.length > A.keep) G.hist.splice(0, G.hist.length - A.keep);
  // (to the server's own table and R2: npc.js)
  G.out.push(rec);
  if (G.out.length > 5) G.out.splice(0, G.out.length - 5);
}

/* ------------------------------------------------------------ 運営 --- */
export function view(W, ctx) {
  const G = W.alpha;
  if (!G) return { started: false, from: FROM, rules: A };
  const px = pricesOf(ctx), P = W.P;
  const members = G.members.map((x) => {
    const pos = G.pos[x.i] || [0, 0, 0, 0], c = G.cost[x.i] || [0, 0, 0, 0];
    const value = pos.reduce((n, s, k) => n + s * (px[k] || 0), 0), paid = pos.reduce((n, s, k) => n + s * (c[k] || 0), 0);
    return { i: x.i, name: x.name, from: x.from, wealth: Math.round(wealthOf(W, x.i, px)), cash: Math.round(P.cash[x.i]), put: Math.round(G.put[x.i] || 0), value: Math.round(value), open: Math.round(value - paid), realized: Math.round(G.got[x.i] || 0), pos: LISTED_IDS.map((id, k) => pos[k]) };
  }).sort((a, b) => b.wealth - a.wealth);
  const d = G.today;
  return {
    started: true, founded: G.founded, term: G.term, terms: G.terms, rules: A, companies: LISTED_IDS.map((id) => ({ id, name: nameOfCo(id) })), sum: G.sum, members,
    today: d ? { day: d.day, key: CORP.dateLabel(d.day), plan: d.plan, board: d.board, talkers: d.talkers, talk: d.talk, orders: d.orders.map((o) => ({ ...o, by: undefined, members: Object.keys(o.by).length })), placed: d.placed, kept: d.kept } : null,
    hist: G.hist.slice().reverse()
  };
}
// what the AI needs for one message (npc.js alphaTalk): who speaks, the numbers, what was said
export function talkJob(W) {
  const d = W.alpha && W.alpha.today;
  if (!d || d.kept || d.placed || !['pending', 'talking'].includes(d.talk.status)) return null;
  const k = d.talk.msgs.length, T = d.talkers;
  return { day: d.day, k, target: d.talk.target, last: k >= d.talk.target - 1, who: k >= d.talk.target - 1 ? T[0] : T[k % T.length], talkers: T, board: d.board, msgs: d.talk.msgs, mine: d.mine };
}
export const isOn = (W) => !!(W.alpha && W.alpha.today);
export const FOUNDED = FROM;
