// 選ばれし300人のAI (NPC.elite, docs/npc-rooms-plan.md): the only people who think with AI — the 300 (FL.elite:
// npc-heart.js chooseElite), the 90 of アルファ among them (FL.alpha: npc-alpha.js), and its 10 at its meetings among
// those (its talk: server/core/npc.js alphaTalk, of the stronger model). The citizens think with the engine alone.
// Each in their turn (the 10 most often, then the 90, then the rest) is told to the AI as they are — their character,
// how they live, what they feel and lack, what life has taught them, their money and what they hold — with all they may
// do today (the plans of npc-heart.js; the 90 and the 10 their view of each listed company too), and the AI chooses for
// them as their character would: today's two plans and why, and the 90's and the 10's view of the companies, by which
// they buy and sell (npc-market.js). The AI only chooses: the engine does it all, and never moves money for it
// (docs/ai-economy-plan.md 0.2). The host asks (server/core/npc.js writeAi) as far as the day's AI money goes.
import { NPC } from './rules.js';
import { T, N, E, E2, NT, NN, LS, NL, FL, LISTED, ageOf, HOME } from './npc-pop.js';
import { PLAN_NAMES } from './npc-heart.js';
import { LISTED_IDS } from './npc-market.js';
import { thinkJob, thinkCar } from './npc-mind.js';
import { borrowFor, quickCap } from './npc-econ.js';

const EL = NPC.elite;
const TIERS = ['top', 'alpha', 'elite'];
const TIER_NAMES = { top: 'アルファの会議の10人', alpha: 'アルファの90人', elite: '選ばれし300人' };
const state = (W) => W.eliteAi || (W.eliteAi = { next: {}, last: {}, asked: 0, answered: 0, days: {} });

/* ---------------------------------------------------------------- who --- */
// the 300 by tier, made once a day (the 300 are chosen a month at a time, アルファ's members and its 10 each day) and
// kept off the saved world (W._roster): a turn's look is through them, never through everyone. One gone since (a new
// life in their place, without the mark) is passed over until it is made again.
function roster(W) {
  const day = W.day, d = W.alpha && W.alpha.today, key = `${day}:${d ? d.day : -1}:${W.P.n}`;
  if (W._roster && W._roster.key === key) return W._roster;
  const P = W.P, ten = new Set(d && d.talkers ? d.talkers.map((t) => t.i) : ((W.alpha && W.alpha.members) || []).slice().sort((a, b) => (b.wealth || 0) - (a.wealth || 0)).slice(0, NPC.alpha.top).map((m) => m.i));
  const R = { key, ten, top: [], alpha: [], elite: [] };
  for (let i = 0; i < P.n; i++) { const f = P.flags[i]; if (f & FL.alpha) R[ten.has(i) ? 'top' : 'alpha'].push(i); else if (f & FL.elite) R.elite.push(i); }
  return (W._roster = R);
}
// a person's tier (null: a citizen, without AI)
export function tierOf(W, i) {
  const f = W.P.flags[i];
  if (f & FL.alpha) return roster(W).ten.has(i) ? 'top' : 'alpha';
  return f & FL.elite ? 'elite' : null;
}
// those whose turn it is at minute `m`: the highest tier first, `EL.batch` of one tier at most (the longest waiting)
export function due(W, m) {
  const P = W.P, S = state(W), R = roster(W);
  for (const t of TIERS) {
    const mark = t === 'elite' ? FL.elite : FL.alpha, list = [];
    for (const i of R[t]) if (P.flags[i] & mark && !(S.next[i] > m)) list.push(i);
    if (list.length) return { tier: t, list: list.sort((a, b) => (S.next[a] ?? -1) - (S.next[b] ?? -1)).slice(0, EL.batch) };
  }
  return null;
}
// how often their turns come: as often as the day's AI money (`cap` Neurons) allows over the people's `minutes` of the
// day — the longest NPC.elite.every, the shortest a `fastest` share of it (S.f: that share)
export function speed(W, cap, minutes) {
  const S = state(W), R = roster(W);
  const need = TIERS.reduce((a, t) => a + R[t].length * Math.max(1, minutes) / EL.every[t] * EL.perChoice, 0);
  S.f = Math.max(EL.fastest, Math.min(1, need > 0 ? need / Math.max(1, cap) : 1));
  return S.f;
}
const everyOf = (W, tier) => Math.max(1, Math.round(EL.every[tier] * ((W.eliteAi && W.eliteAi.f) || 1)));
// asked and not answered (or not to be asked again so soon): their next turn a little later
export function later(W, list, m, minutes = 5) { const S = state(W); for (const i of list) S.next[i] = m + minutes; }

/* ---------------------------------------------------------------- what the AI is told --- */
const TRAIT_WORDS = [
  [T.open, '好奇心が強い', '保守的'], [T.consc, '几帳面', '大ざっぱ'], [T.extra, '社交的', '内向的'], [T.agree, '協調的', '我が強い'],
  [T.neuro, '心配性', '動じない'], [T.risk, '冒険好き', '慎重'], [T.impulse, '衝動的', '我慢強い'], [T.thrift, '倹約家', '浪費家'],
  [T.vanity, '見栄っ張り', '見栄を張らない'], [T.gamble, 'ギャンブル好き', 'ギャンブル嫌い'], [T.patience, '気が長い', '気が短い'],
  [T.learn, '学び好き', '勉強嫌い'], [T.loyalty, '義理堅い', '移り気'], [T.car, '車好き', '車に無関心'], [T.game, 'ゲーム好き', 'ゲームに無関心'],
  [T.news, 'ニュースをよく見る', 'ニュースを見ない'], [T.justice, '正義感が強い', '損得で動く'], [T.ambition, '野心家', '欲がない']
];
const NEED_WORDS = { [N.fun]: '楽しみ', [N.thrill]: 'スリル', [N.status]: '見栄・地位', [N.security]: '安心', [N.move]: '移動', [N.social]: '人づきあい', [N.rest]: '休息', [N.achieve]: '達成感', [N.fair]: '公平さ' };
const LESSON_WORDS = { [LS.gamble]: ['賭けは割に合う', '賭けで痛い目を見た'], [LS.debt]: ['借金は役に立つ', '借金はこわい'], [LS.job]: ['仕事は報われる', '仕事は報われない'], [LS.market]: ['株はもうかる', '株で損をした'], [LS.spend]: ['使えば満たされる', '使っても満たされない'], [LS.luxury]: ['ぜいたくは価値がある', 'ぜいたくはむなしい'], [LS.save]: ['貯金は大事', '貯金しても仕方ない'], [LS.friends]: ['友は頼れる', '人は当てにならない'] };
const yen = (x) => (Math.abs(x) >= 1e8 ? `${Math.round(x / 1e7) / 10}億` : Math.abs(x) >= 1e4 ? `${Math.round(x / 1e4)}万` : `${Math.round(x)}`);
// one person as the AI is told of them (a line, short)
export function describe(W, i, day) {
  const P = W.P, tr = (t) => P.tr[i * NT + t];
  const traits = TRAIT_WORDS.map(([t, hi, lo]) => [Math.abs(tr(t) - 128), tr(t) >= 128 ? hi : lo]).sort((a, b) => b[0] - a[0]).slice(0, 5).filter((x) => x[0] > 30).map((x) => x[1]);
  const emo = [];
  if (P.emo[i * 5 + E.stress] > 170) emo.push('ストレスが強い');
  if (P.emo[i * 5 + E.anxiety] > 170) emo.push('不安');
  if (P.emo[i * 5 + E.anger] > 170) emo.push('怒っている');
  if (P.emo[i * 5 + E.happy] > 190) emo.push('幸せ');
  if (P.emo2) { if (P.emo2[i * 3 + E2.tired] > 170) emo.push('疲れている'); if (P.emo2[i * 3 + E2.esteem] < 80) emo.push('自信がない'); if (P.emo2[i * 3 + E2.license] > 170) emo.push('自分にご褒美をあげたい'); }
  const lack = [];
  for (let k = 0; k < NN; k++) if (P.need[i * NN + k] < 90) lack.push(NEED_WORDS[k]);
  const lessons = [];
  if (P.lesson) for (let k = 0; k < NL; k++) { const v = P.lesson[i * NL + k]; if (Math.abs(v) > 50) lessons.push(LESSON_WORDS[k][v > 0 ? 0 : 1]); }
  const held = LISTED_IDS.map((id, k) => [id, P.sh[i * LISTED + k]]).filter((x) => x[1] > 0).map(([id, n]) => `${id}${n}株`);
  const job = NPC.jobNames[P.job[i]] || '';
  const home = P.home[i] === HOME.own ? '持ち家' : P.home[i] === HOME.rent ? '賃貸' : P.home[i] === HOME.family ? '実家' : P.home[i] === HOME.stay ? '居候' : '路上';
  const fam = P.hh[i] >= 0 ? `${P.spouse[i] >= 0 ? '既婚' : '独身'}` : '独身';
  // (short: the AI reads them by their number — every token of it is the 300's AI money)
  return `${ageOf(P, i, day)}歳・${job}${P.rank[i] >= 3 ? '(役職)' : ''}・年収${yen(P.salary[i])}・現金${yen(P.cash[i])}${P.debt[i] > 0 ? `・借金${yen(P.debt[i])}` : ''}・${fam}・${home}${P.car[i] ? '・車あり' : ''}`
    + `｜性格:${traits.join(',') || 'ふつう'}｜気分:${emo.join(',') || '平静'}｜不足:${lack.join(',') || 'なし'}`
    + `${lessons.length ? `｜教訓:${lessons.join(',')}` : ''}${held.length ? `｜株:${held.join(',')}` : ''}`;
}
// the AI's instructions and the batch's question
export function prompt(W, tier, list, day, board = null) {
  const plans = PLAN_NAMES.map((n, k) => (k ? `${k}=${n}` : null)).filter(Boolean).join('、');
  const view = tier !== 'elite';
  const system = 'あなたは架空の国「ヴェルノア共和国」の住民の頭の中を考える係です。実在の人物・企業・市場は扱いません。'
    + '各住民の性格・気持ち・お金・人生の教訓に忠実に、その人が本当に選びそうな選択をしてください（賢い人は先のことまで考え、衝動的な人は目先に流されます）。'
    + '答えは住民1人につき1行だけ、指定の形式で書き、説明や前置きは書かないでください。/no_think';
  const lines = list.map((i, k) => `${k + 1}. ${describe(W, i, day)}`);
  const co = board ? `\n株価の様子：${board.map((b) => `${b.id} 株価${Math.round(b.price)}・20日${(b.r20 * 100).toFixed(1)}%・配当利回り${(b.yield * 100).toFixed(1)}%`).join('／')}` : '';
  const fmt = view ? '番号 予定=数字,数字 見通し=riru:+1,ice:0,magita:-1,tenesice:+2 行動=none 理由=20字以内' : '番号 予定=数字,数字 行動=none 理由=20字以内';
  const acts = `行動（今すぐ行う大きなことを1つ。なければnone）：${ACTIONS.map((a) => `${a.code}＝${a.name}`).join('、')}`;
  const user = `${TIER_NAMES[tier]}の${list.length}人の、今日の予定と行動を決めてください。\n予定の候補：${plans}（2つまで。1つだけでもよい）\n${acts}${view ? `\n見通し：上場企業（${LISTED_IDS.join('・')}）を今後買いたいか売りたいか、−2（売りたい）〜+2（買いたい）で` : ''}${co}\n\n${lines.join('\n')}\n\n形式（${list.length}行）：${fmt}`;
  return { system, user, max: 40 + list.length * (view ? 72 : 48) };
}

/* ---------------------------------------------------------------- what they may do --- */
// the big things one of the 300 may do at once, by the AI's choice — the engine checks each and does it as it does for
// anyone (never more than one may: their money, their credit, the market's day): look for other work (npc-mind.js
// thinkJob), think a car through to the end (thinkCar), buy shares with a share of one's cash or sell a share of one's
// holding (the market's book, at about its price), borrow of Tenesice (its quick loan, as far as it lends) or pay back
// what one owes
export const ACTIONS = [
  { code: 'job', name: '転職先を探す' }, { code: 'car', name: '車を買うか決める' },
  { code: 'buy:銘柄:%', name: '現金の%で株を買う（例 buy:magita:20）' }, { code: 'sell:銘柄:%', name: '持ち株の%を売る（例 sell:ice:50）' },
  { code: 'borrow:万円', name: 'テネシスから借りる（例 borrow:300）' }, { code: 'repay:万円', name: '借金を返す（例 repay:100）' }
];
export function actionOf(line) {
  const m = String(line).match(/行動\s*[=＝:：]\s*([a-z]+)(?:\s*[:：]\s*([a-z0-9]+))?(?:\s*[:：]\s*(\d+))?/);
  if (!m || m[1] === 'none') return null;
  const [, code, a, b] = m;
  if (code === 'job' || code === 'car') return { code };
  if ((code === 'buy' || code === 'sell') && LISTED_IDS.includes(a) && b) return { code, id: a, pct: Math.max(1, Math.min(code === 'buy' ? 50 : 100, Number(b))) };
  if ((code === 'borrow' || code === 'repay') && a && /^\d+$/.test(a)) return { code, yen: Number(a) * 10000 };
  return null;
}
// doing it (`run`: { ctx, r } — the day's prices and a draw); what was done (null: nothing could be)
export function act(W, i, x, day, run) {
  const P = W.P, { ctx, r } = run, m = W.marketState;
  if (x.code === 'job') return thinkJob(W, i, day, r, ctx) ? { did: 'job' } : { did: 'job', none: true };
  if (x.code === 'car') { const before = P.car[i]; thinkCar(W, i, day, r, ctx); return { did: 'car', bought: P.car[i] !== before }; }
  if (x.code === 'buy' || x.code === 'sell') {
    const k = LISTED_IDS.indexOf(x.id), price = ctx && ctx.stockPrice ? ctx.stockPrice(x.id) : 0;
    if (k < 0 || !price || !m || P.trades[i] >= NPC.life.tradesDay) return null;
    if (x.code === 'buy') {
      const limit = Math.round(price * 1.003), shares = Math.floor(Math.max(0, P.cash[i]) * x.pct / 100 / (limit * 1.02));
      if (shares <= 0) return null;
      m.book[x.id].buy.push([i, shares, limit]); P.buyDay[i] += shares * limit; P.trades[i]++;
      return { did: 'buy', id: x.id, shares };
    }
    const held = P.sh[i * LISTED + k], shares = Math.min(held, Math.max(1, Math.floor(held * x.pct / 100)));
    if (held <= 0) return null;
    m.book[x.id].sell.push([i, shares, Math.max(1, Math.round(price * 0.997))]); P.trades[i]++;
    return { did: 'sell', id: x.id, shares };
  }
  if (x.code === 'borrow') { const got = borrowFor(W, i, Math.min(x.yen, quickCap(P, i))); return got > 0 ? { did: 'borrow', yen: got } : null; }
  if (x.code === 'repay') {
    const back = Math.min(x.yen, P.debt[i], Math.max(0, P.cash[i]));
    if (back <= 0) return null;
    P.cash[i] -= back; P.debt[i] -= back; W.sum.repaid += back;
    if (P.debt[i] <= 0) { P.debt[i] = 0; P.dkind[i] = 0; }
    return { did: 'repay', yen: back };
  }
  return null;
}

/* ---------------------------------------------------------------- what it said --- */
// its answer, a line a person: their plans, their view of the companies (the 90 and the 10), why
export function parse(text, n) {
  const out = new Array(n).fill(null);
  const clean = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  for (const raw of clean.split('\n')) {
    const line = raw.trim().replace(/^[-*・]\s*/, '');
    const m = line.match(/^(\d+)[.．:：、\s]/);
    if (!m) continue;
    const k = Number(m[1]) - 1;
    if (k < 0 || k >= n || out[k]) continue;
    const pm = line.match(/予定\s*[=＝:：]\s*([0-9０-９,，、\s]+)/);
    const plans = pm ? pm[1].replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).split(/[,，、\s]+/).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x < PLAN_NAMES.length).slice(0, 2) : [];
    const view = {};
    const vm = line.match(/見通し\s*[=＝:：]\s*([^\s]+)/);
    if (vm) for (const part of vm[1].split(/[,，、]/)) { const x = part.match(/([a-z]+)\s*[:：]?\s*([+＋\-−]?\d)/); if (x && LISTED_IDS.includes(x[1])) view[x[1]] = Math.max(-2, Math.min(2, Number(x[2].replace('＋', '+').replace('−', '-')))); }
    const why = ((line.match(/理由\s*[=＝:：]\s*(.+)$/) || [])[1] || '').trim().slice(0, 40);
    const act = actionOf(line);
    if (plans.length || Object.keys(view).length || act) out[k] = { plans, view, why, act };
  }
  return out;
}
// what the AI chose, made theirs: today's plans (npc-heart.js planPull carries them out), the 90's and the 10's view
// of the companies (npc-market.js orders by it); their next turn by their tier. Returns how many it answered for.
export function apply(W, tier, list, text, day, m, model = EL.model, gens = null, run = null) {
  const P = W.P, S = state(W), got = parse(text, list.length);
  let n = 0;
  list.forEach((i, k) => {
    // (someone gone since they were asked of: a new life in their place, not theirs to take)
    if (gens && P.gen[i] !== gens[k]) return;
    const x = got[k];
    S.next[i] = m + (x ? everyOf(W, tier) : 5);
    if (!x) return;
    if (x.plans.length) { P.plan[i * 2] = x.plans[0]; P.plan[i * 2 + 1] = x.plans[1] || 0; }
    if (tier !== 'elite') for (const [id, v] of Object.entries(x.view)) P.outlook[i * LISTED + LISTED_IDS.indexOf(id)] = Math.round(v * 60);
    const did = x.act && run ? act(W, i, x.act, day, run) : null;
    S.last[i] = { day, m, gen: P.gen[i], tier, plans: x.plans, view: x.view, why: x.why, model, act: did };
    if (tier === 'top' || n % 10 === 0) W.reasons.push({ i, day, kind: 'ai', tier, plans: x.plans.map((p) => PLAN_NAMES[p]), view: x.view, why: x.why });
    n++;
  });
  S.asked += list.length;
  S.answered += n;
  const dd = S.days[day] || (S.days[day] = { asked: 0, answered: 0 });
  dd.asked += list.length; dd.answered += n;
  for (const k of Object.keys(S.days)) if (Number(k) < day - 7) delete S.days[k];
  return n;
}
// for 運営: a person's AI's last choice, and the tiers' counts
export function viewOf(W, i) { const x = W.eliteAi && W.eliteAi.last[i]; return x && x.gen === W.P.gen[i] ? { ...x, plans: x.plans.map((p) => PLAN_NAMES[p]), tier: TIER_NAMES[x.tier], act: x.act || null } : null; }
export function summary(W) {
  const R = roster(W), n = { top: R.top.length, alpha: R.alpha.length, elite: R.elite.length };
  const S = W.eliteAi || { asked: 0, answered: 0, days: {} };
  return { tiers: n, asked: S.asked, answered: S.answered, days: S.days, model: EL.model, topModel: EL.topModel, every: Object.fromEntries(TIERS.map((t) => [t, everyOf(W, t)])) };
}
