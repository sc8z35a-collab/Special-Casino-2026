// 社長のAI (docs/npc-rooms-plan.md 7章): a company whose 社長 is one of the 300 (npc-elite.js) is run by its 社長's own
// AI. Once a day while the people are about (the host asks: server/core/npc.js bossThink) it is told of its company as
// it is that moment — its books (the month's and the year's sales and profit, its money and debt, how many months its
// money lasts), its share price and worth, its people, its products and how each sells, what it develops (its labs,
// its titles, テネシスリサーチ), its new businesses, and every contract it has (MY WAY's character contract and how
// it pays, its terms with the makers, Tenesice's lending terms to it, its loans, its branches abroad, MY WAY's with all
// its partners, Tenesice's with all its borrowers) — and given everything the company may do: what its meetings would
// propose (npc-org.js proposals: its budgets, its people, its prices, its loans and Tenesice's fund, its dividends,
// テネシスリサーチ, MY WAY's contract), and beyond them its 社長's own: a contract's price asked down or up, a contract
// ended or signed again, a new business of any it may start, the makers' prices to a dealer asked down (or up, by a
// maker), more lent to a borrower (Tenesice), new customers looked for. It chooses up to two by the company's good and
// its own character, with its reason; the company does them at once (npc-org.js apply) and tells of it (a 社長決裁, the
// news). The AI only chooses: the companies' books do the rest.
import { NPC, CORP } from './rules.js';
import { FL, NT, T, nameOf, ageOf } from './npc-pop.js';
import { proposals, apply } from './npc-org.js';
import { LISTED_IDS } from './npc-market.js';

const yen = (x) => CORP.fmt.money(Math.round(x || 0));
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const state = (W) => W.bossAi || (W.bossAi = { next: {}, last: {}, asked: 0, done: 0 });

/* ---------------------------------------------------------------- whose --- */
// the companies whose 社長 thinks with AI, and whose turn it is (once a day each)
export function aiBoss(W, id) { const o = W.orgs && W.orgs[id]; return !!o && o.president >= 0 && !!(W.P.flags[o.president] & FL.elite); }
export function due(W, ctx, day) {
  const S = state(W);
  for (const id of NPC.companies) {
    const s = ctx && ctx.corp && ctx.corp.co[id];
    if (!s || s.dead || !aiBoss(W, id) || (S.next[id] !== undefined && S.next[id] > day)) continue;
    return id;
  }
  return null;
}

/* ---------------------------------------------------------------- what it is told --- */
const plOf = (per) => CORP.plOf(Object.fromEntries(Object.entries(per || {}).filter(([k]) => !/^cf:/.test(k))));
// the company now, all of it, in short
export function briefing(W, id, ctx, day) {
  const s = ctx.corp.co[id], p = CORP.company(id), o = W.orgs[id], P = W.P;
  const m = plOf(s.per.m), y = plOf(s.per.y);
  const monthly = Math.max(1, (s.n * s.unit + s.budget.place + s.budget.rd + (s.budget.ads || 0) + (s.budget.other || 0)) / 12);
  const cash = (s.bal.cash || 0) + (s.bal.bonds || 0), debt = (s.loans || []).reduce((n, l) => n + l.amt, 0);
  const lines = [];
  const boss = o.president, tr = (t) => P.tr[boss * NT + t] / 255;
  lines.push(`会社：${p.full || p.name}（${p.kind}）。あなたは社長の${nameOf(P, boss).name}（${ageOf(P, boss, day)}歳・野心${Math.round(tr(T.ambition) * 100)}・慎重さ${Math.round((1 - tr(T.risk)) * 100)}）。`);
  lines.push(`業績：今月 売上${yen(m.sales)}・営業利益${yen(m.op)}／今年度 売上${yen(y.sales)}・営業利益${yen(y.op)}・純利益${yen(y.net)}。`);
  lines.push(`お金：手元資金${yen(cash)}（費用の${(cash / monthly).toFixed(1)}か月分）・借入${yen(debt)}・利益剰余金${yen(s.bal.retained)}。`);
  lines.push(`人：社員${s.n}人（目標${s.target || s.n}人）・平均年収${yen(s.pay)}・士気${Math.round((s.morale || 0) * 100)}%。`);
  if (p.listed && LISTED_IDS.includes(id) && ctx.stockPrice) lines.push(`自社株：株価${yen(ctx.stockPrice(id))}${ctx.fair && ctx.fair[id] ? `・理論株価${yen(ctx.fair[id])}` : ''}・配当性向×${(s.payoutMult || 1).toFixed(2)}。`);
  else if (p.listed && ctx.stockPrice) { const px = ctx.stockPrice(id); if (px) lines.push(`自社株：株価${yen(px)}。`); }
  // its products and how each sells this month
  const streams = (p.streams || []).map((x) => [x.name, -((s.per.m || {})['r:' + x.id] || 0)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (streams.length) lines.push(`事業・製品（今月の売上）：${streams.map(([n, v]) => `${n} ${yen(v)}`).join('／')}。`);
  // what it develops
  const dev = [];
  for (const l of o.labs || []) if (!l.ok) dev.push(`研究所「${l.name}」（完成予定まで${Math.max(0, l.due - day)}日）`);
  for (const x of s.projects || []) if (x.due > day) dev.push(`「${x.name || x.title || '新作'}」（発売まで${x.due - day}日）`);
  const R = ctx.corp.research;
  if (R && R.on && ['magita', 'yosida', 'wazima'].includes(id)) dev.push(R.out && R.out[id] ? 'テネシスリサーチ（脱退中）' : 'テネシスリサーチに参加中');
  if (dev.length) lines.push(`開発：${dev.join('／')}。`);
  const ven = (o.ventures || []).filter((v) => v.stage !== 'closed');
  if (ven.length) lines.push(`新事業：${ven.map((v) => `「${v.name}」顧客${v.customers}人・今月損益${yen((v.month.rev || 0) - (v.month.cost || 0))}`).join('／')}。`);
  // its contracts
  const con = [];
  const mw = ctx.corp.co.myway, c = mw && mw.ip && mw.ip.contracts[id];
  if (c) con.push(`MY WAYとのキャラクター契約：${c.on ? `年${yen(c.fee)}・規模×${(c.scale || 1).toFixed(2)}${c.last && c.last.on ? `・先月のコラボ利益${yen(c.last.margin)}` : ''}` : '停止中'}`);
  if (id === 'myway' && mw && mw.ip) for (const [k, x] of Object.entries(mw.ip.contracts)) con.push(`${(CORP.company(k) || {}).name || k}との契約：${x.on ? `年${yen(x.fee)}・規模×${(x.scale || 1).toFixed(2)}` : '停止中'}`);
  if (W.terms && W.terms[id]) con.push(`メーカーからの仕入れ価格：基準の×${W.terms[id].toFixed(3)}`);
  if (W.lend && W.lend[id]) con.push(`テネシスの融資条件：金利${pct(W.lend[id].rate)}・融資枠${yen(W.lend[id].cap)}・ランク${W.lend[id].rank}`);
  for (const l of (s.loans || []).slice(0, 4)) con.push(`借入${yen(l.amt)}（年${pct(l.rate || 0)}${l.fund ? '・テネシスファンド' : ''}）`);
  if (id === 'tenesice' && W.lend) con.push(`融資先：${Object.entries(W.lend).map(([k, x]) => `${(CORP.company(k) || {}).name || k} 金利${pct(x.rate)}・枠${yen(x.cap)}`).join('／')}`);
  const br = W.asuka && W.asuka.branches && W.asuka.branches[id];
  if (br) con.push(`アスカ国の支店：${Object.entries(br).filter(([, n]) => n > 0).map(([k, n]) => `${k}${n}か所`).join('・') || 'なし'}`);
  if (con.length) lines.push(`契約・取引：${con.join('／')}。`);
  return lines.join('\n');
}

/* ---------------------------------------------------------------- what it may do --- */
// its meetings' proposals and its 社長's own (each: { title, effect })
export function options(W, id, ctx, day, r) {
  const o = W.orgs[id], s = ctx.corp.co[id], list = proposals(W, o, s, day, r, ctx).map((x) => ({ title: x.title, kind: x.kind, effect: x.effect }));
  const add = (title, kind, effect) => { if (!list.some((x) => x.title === title)) list.push({ title, kind, effect }); };
  const mw = ctx.corp.co.myway, c = mw && mw.ip && !mw.dead && mw.ip.contracts[id];
  if (c) {
    if (c.on) {
      add('MY WAYとの契約料の値下げ交渉（−10%）', 'license', [{ kind: 'license', action: 'fee', mult: 0.9 }]);
      add('MY WAYとの契約を破棄する', 'license', [{ kind: 'license', action: 'cancel', why: '社長の判断' }]);
    } else add('MY WAYと契約を結び直す', 'license', [{ kind: 'license', action: 'sign', why: '社長の判断' }]);
  }
  if (id === 'myway' && mw && mw.ip) for (const [k, x] of Object.entries(mw.ip.contracts)) {
    const n = (CORP.company(k) || {}).name || k;
    if (x.on) { add(`${n}との契約料の値上げ交渉（+5%）`, 'license', [{ kind: 'license', action: 'fee', mult: 1.05, company: k }]); add(`${n}との契約を破棄する`, 'license', [{ kind: 'license', action: 'cancel', why: 'MY WAYの社長の判断', company: k }]); }
  }
  if (id === 'carowner' || id === 'jinx') add('メーカーに仕入れ価格の引き下げを交渉（−3%）', 'terms', [{ kind: 'terms', buyer: id, mult: 0.97 }]);
  if (id === 'magita' || id === 'yosida') add('カーオーナーへの卸値の引き上げを交渉（+3%）', 'terms', [{ kind: 'terms', buyer: 'carowner', mult: 1.03 }]);
  if (id === 'tenesice' && W.lend) for (const [k, x] of Object.entries(W.lend)) {
    const ck = ctx.corp.co[k];
    if (!ck || ck.dead) continue;
    add(`${(CORP.company(k) || {}).name || k}への追加融資（融資枠+30%・金利−0.2%）`, 'lend', [{ kind: 'lend', company: k, rate: Math.max(0.001, x.rate - 0.002), cap: Math.round(x.cap * 1.3), rank: x.rank }]);
  }
  for (const v of (NPC.ventures[id] || [])) if (!(W.orgs[id].ventures || []).some((x) => x.type === v.id && x.stage !== 'closed')) add(`新事業「${v.name}」を始める`, 'venture', [{ kind: 'venture', action: 'start', type: v.id }]);
  add('新しい取引先・顧客を開拓する（営業の強化・広告+10%）', 'sales', [{ kind: 'appeal', key: 'all', add: 0.05, days: 90 }, { kind: 'budget', key: 'ads', mult: 1.1 }]);
  add('人員を増やす（採用目標+5%）', 'grow', [{ kind: 'target', mult: 1.05 }]);
  add('経費を見直す（その他経費−5%）', 'cut', [{ kind: 'budget', key: 'other', mult: 0.95 }]);
  add('何もしない（様子を見る）', 'none', []);
  return list.slice(0, 24);
}

/* ---------------------------------------------------------------- the AI's question and its answer --- */
export function prompt(W, id, ctx, day, list) {
  const system = 'あなたは架空の国「ヴェルノア共和国」の会社の社長です。実在の企業・人物・市場は扱いません。会社の今の状況をすべて読み、会社の長期的な成長と従業員のため、そしてあなた自身の性格に沿って、今日の社長決裁を決めてください。答えは「選択=番号,番号 理由=40字以内」の1行だけ。番号は2つまで（1つでもよい）。/no_think';
  const user = `${briefing(W, id, ctx, day)}\n\n今日できること：\n${list.map((x, k) => `${k + 1}. ${x.title}`).join('\n')}\n\n形式：選択=番号,番号 理由=…`;
  return { system, user, max: 120 };
}
export function parse(text, n) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const m = t.match(/選択\s*[=＝:：]\s*([0-9,，、\s]+)/);
  const picks = [...new Set((m ? m[1] : (t.match(/\d+/) || [''])[0]).split(/[,，、\s]+/).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= n))].slice(0, 2);
  const why = ((t.match(/理由\s*[=＝:：]\s*(.+)$/m) || [])[1] || '').trim().slice(0, 60);
  return { picks, why };
}
// what it chose, done at once by the company: its effects, a 社長決裁 in its minutes, the news; its next turn tomorrow
export function decide(W, id, list, text, ctx, day, r) {
  const S = state(W), o = W.orgs[id], { picks, why } = parse(text, list.length);
  S.next[id] = day + 1;
  S.asked++;
  if (!picks.length) return null;
  const chosen = picks.map((k) => list[k - 1]).filter((x) => x.kind !== 'none');
  // (an effect naming another company — MY WAY's contract with a partner, Tenesice's lending to a borrower — is that
  // company's op: npc-org.js apply keeps its name)
  for (const x of chosen) for (const e of x.effect) apply(W, o, e, day, r, ctx);
  const boss = o.president, name = W.card(boss, day).name;
  const titles = chosen.map((x) => x.title);
  W.meetings.push({ id: ++o.seq, company: id, day, room: '社長室', title: titles.length ? `社長決裁：${titles.join('／')}` : '社長決裁：様子を見る', kind: 'boss', by: boss,
    attendees: [{ i: boss, role: '社長', name }], lines: [{ i: boss, role: '社長', stance: 'for', name, text: why || '会社の状況を見て決めた。' }], yes: 1, no: 0, veto: null, pass: true, ai: true });
  if (titles.length) W.news.push({ day, kind: 'company', district: -1, text: `${o.name}：社長決裁で${titles.join('・')}を決定`, data: { company: id, boss: true } });
  S.last[id] = { day, gen: W.P.gen[boss], chose: titles, why };
  S.done++;
  return S.last[id];
}
export const lastOf = (W, id) => (W.bossAi && W.bossAi.last[id]) || null;
