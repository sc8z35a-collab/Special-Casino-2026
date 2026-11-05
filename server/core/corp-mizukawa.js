// MIZUKAWA Motors株式会社 on the companies' side (js/game/corp.js MIZUKAWA and its products): アスカ国籍 — its founding
// out of アスカ国's treasury, its people アスカ国's (paid through it: server/core/asuka.js), its land, its 管理費, its
// materials, its orders and its taxes アスカ国's —, its cars and engines sold at MIZUKAWA GARAGE alone, each worked out
// the day it comes out, as many as it makes; its research pool (never lost: its researchers' pay, its orders to
// others, its technology's worth), its technology's fees (the production lines of MAGITA and WAZIMA, YOSHIDA's cars),
// HIGA MASTER, its pay and its people with what it earns, MY WAY's contract, its plans to buy WAZIMA and the four of
// MAGITA's economy. The books' helpers are corp-model's (`H`, handed over as corp-hachi.js's are).
import { CORP, NPC, ASUKA, RULES } from './rules.js';

const R = CORP.mizukawa, YEAR = 365, MONTH = 30.44;
export const FOUNDED = CORP.dayAt(...R.founded);
const HIGA_DUE = CORP.dayAt(...R.higa.due), HIGA_START = CORP.dayAt(...R.higa.start), MYWAY_UNTIL = CORP.dayAt(...R.myway.until);
const PRODUCTS = () => [...Object.entries(CORP.products.cars).map(([id, pr]) => ['cars', id, pr]), ...Object.entries(CORP.products.items).map(([id, pr]) => ['items', id, pr])].filter(([, , pr]) => pr.seller === 'mizukawa');
const listOf = (kind) => (kind === 'cars' ? RULES.cars : RULES.shop);
const priceOf = (kind, id) => { const c = listOf(kind).find((x) => x.id === id); return c ? c.price : 0; };
// what アスカ国 gets of it today (its land, 管理費, orders, taxes, pay beyond, the seed): to asuka.js through corp-model
const xOf = (w) => w.mzX || (w.mzX = { seed: 0, land: 0, admin: 0, orders: 0, yamato: 0, bonus: 0, social: 0, tax: 0, medTax: 0, vernoa: 0 });
export const isOpen = (w) => !!(w.co.mizukawa && !w.co.mizukawa.dead);
// its people's pay a year now (the roles' at the index), and their number by role
export const payOf = (s, role) => Math.round(role.pay * 12 * ((s.mz && s.mz.payIdx) || 1));
export const wantOf = (s, role, scale) => Math.max(role.n >= 100 ? 1 : 0, Math.round(role.n * scale * ((s.mz && s.mz.staffIdx) || 1)));

/* ------------------------------------------------------------ the founding --- */
// The day it is founded (once): its books fresh, its 利益剰余金 アスカ国's treasury's ($38B at this world's size), the
// models on sale that day out, HIGA MASTER under way (begun before it), MY WAY's contract till 2027-01-01.
export function found(H, w, d, out, ch) {
  const p = H.PROFILES.get('mizukawa');
  if (!p || w.co.mizukawa || d + 1 < FOUNDED) return null;
  const sc = scaleOf(w), seed = Math.round(R.seed * sc);
  const s = H.newCompany(p, d, d, seed, ch);
  s.bal = { capital: 0, reserve: 0, retained: seed, ppe: 0, cash: seed };
  s.recv = 0;
  s.n = 0; s.target = 0; s.payAll = true;
  s.mz = {
    founded: d, payIdx: 1, staffIdx: 1, line: R.line.share, asset: 0, pool: 0, spent: { pay: 0, orders: 0, asset: 0 },
    products: {}, sold: {}, higa: { done: d >= HIGA_DUE ? d : 0, spent: 0, cost: Math.round(R.higa.cost * sc) },
    m: blankMonth(), last: null, hist: [], staff: 0, byRole: {}, wazima: null, locals: null, red: 0, license: { magita: 0, wazima: 0, yosida: 0 }
  };
  w.co.mizukawa = s;
  // (its shares: its value at its price, held by no market — アスカ国's own)
  s.sh.issued = Math.max(1000, Math.round(seed / p.price));
  s.sh.out = s.sh.issued;
  s.mkt = { e: Math.log(p.price), fair: p.price };
  s.div = { dps: 0, daily: 0, total: 0 };
  xOf(w).seed += seed;
  for (const [kind, id, pr] of PRODUCTS()) if (CORP.mizukawaOut(id, d + 1)) release(H, w, s, kind, id, pr, d, null);
  // MY WAY's contract (its first collaboration car), its ties
  w.ties = w.ties || {};
  for (const t of H.ties()) if (w.ties[t.key] === undefined) w.ties[t.key] = t.start;
  const mw = w.co.myway, x = CORP.myway.partners.mizukawa;
  if (mw && !mw.dead && mw.ip && x && !mw.ip.contracts.mizukawa) {
    mw.ip.contracts.mizukawa = { ...H.newContract(x, d), until: MYWAY_UNTIL, term: 0, ends: true };
    H.news(out, mw, H.PROFILES.get('myway'), d + 1, 4 * 3600, 'license', `MIZUKAWAとキャラクター契約（初のコラボ特別仕様車 River W Feat.・2027年1月1日まで）`, { partner: 'mizukawa' }, 0.005, true);
  }
  H.news(out, s, p, d + 1, 1 * 3600, 'found', `MIZUKAWA Motors（アスカ国籍・世界3位の自動車メーカー）が事業を開始。利益剰余金${CORP.fmt.money(seed)}はアスカ国の国庫から。MIZUKAWA GARAGEでRiver W・River W Feat.・SUPER 炎神 IIを販売`, { seed }, 0, true);
  return s;
}
const blankMonth = () => ({ units: 0, sales: 0, cost: 0, research: 0, fees: 0, license: 0, facilities: 0, pay: 0, byModel: {} });
// the world's size against the full one (its people are アスカ国's: アスカ国's own scale, else the companies')
const scaleOf = (w) => (w.circ && w.circ.scale) || 1;

/* ------------------------------------------------------------- a release --- */
// A model out today: its cost a unit — its base × the economy's price index (アルタス's, within 0.8〜1.2) × HIGA (0.7
// once HIGA MASTER is done) — and its research a unit — its price × its rate ÷ the research bonus (1.2 with WAZIMA its)
// —, the ones on sale at its founding as given. Its stock: as many as it makes, at this world's size.
export function release(H, w, s, kind, id, pr, d, out) {
  const M = s.mz;
  if (M.products[id]) return M.products[id];
  const price = priceOf(kind, id), [lo, hi] = R.release.index;
  const idx = Math.max(lo, Math.min(hi, w.altasPrice || 1)), higa = M.higa.done ? 1 - R.higa.cut : 1, bonus = M.wazima ? R.release.bonus : 1;
  const cost = pr.base ? Math.round(pr.base * idx * higa / 1000) * 1000 : pr.cost;
  const research = pr.rate ? Math.round(price * pr.rate / bonus / 1000) * 1000 : pr.research;
  const x = { kind, price, cost, research, day: d, net: price - cost - research - R.fee, limit: pr.limit, index: Math.round(idx * 1000) / 1000, higa: !!M.higa.done };
  M.products[id] = x;
  if (out) H.news(out, s, H.PROFILES.get('mizukawa'), d + 1, 2 * 3600, 'product', `${nameOf(kind, id)}を発売（${CORP.fmt.money(price)}・限定${CORP.fmt.group(pr.limit)}${kind === 'cars' ? '台' : '個'}）：原価${CORP.fmt.money(cost)}・研究費${CORP.fmt.money(research)}・1${kind === 'cars' ? '台' : '個'}の純利益${CORP.fmt.money(x.net)}`, { id, price, cost, research }, 0, true);
  return x;
}
const nameOf = (kind, id) => { const c = listOf(kind).find((x) => x.id === id); return c ? c.name : id; };
// what one of its units costs to make now (HIGA MASTER done since: 0.7 of what it was worked out at)
const unitCost = (M, x) => Math.round(x.cost * (M.higa.done && !x.higa ? 1 - R.higa.cut : 1));

/* ------------------------------------------------------------------ a sale --- */
// Its units sold (corp-model sellProducts, its own: the people's of both countries, the players'): the price its,
// their materials アスカ国's (アルタス), its 販売手数料, their research into its pool; River W Feat.'s profit half MY WAY's.
export function sold(H, w, s, code, kind, id, n, paid, cash, who) {
  if (!(n > 0)) return;
  if (cash) H.post(s, [['cash', paid], ['r:' + code, -paid]], 'receipts');
  else { H.post(s, [['ar', paid], ['r:' + code, -paid]]); s.recv += paid; }
  s.mz.m.sales += paid;
  // (ヴェルノア's people's: what アスカ国 sold ヴェルノア — its GDP's exports, ヴェルノア's imports)
  if (w.ext && who === 'npc') xOf(w).vernoa += paid;
  make(H, w, s, kind, id, n, paid, who === 'players' || (cash && !who) ? 'players' : 'npc');
}
// n units made and gone (`paid` what they brought): their cost, fee and research; the counts
function make(H, w, s, kind, id, n, paid, who) {
  const M = s.mz, x = M.products[id] || release(H, w, s, kind, id, CORP.products[kind][id], w.day + 1, null);
  if (!(n > 0)) return;
  const cost = Math.round(n * unitCost(M, x)), fee = Math.round(n * R.fee), research = Math.round(n * x.research);
  H.post(s, [['c:materials', cost], ['sSelling', fee], ['ap', -(cost + fee)]]);
  s.owe['*'] = (s.owe['*'] || 0) + cost;
  s.exp += fee;
  const by = s.expBy || (s.expBy = {});
  by.selling = (by.selling || 0) + fee;
  M.pool += research;
  M.m.units += n; M.m.cost += cost; M.m.research += research; M.m.fees += fee;
  const b = M.m.byModel[id] || (M.m.byModel[id] = { n: 0, sales: 0 });
  b.n += n; b.sales += paid;
  const row = s.sold[id] || (s.sold[id] = { npc: 0, players: 0, sales: 0, margin: 0 });
  row[who] += n;
  row.sales += paid;
  row.margin += paid - cost - fee - research;
  M.sold[id] = (M.sold[id] || 0) + n;
  const pr = CORP.products[kind][id];
  if (pr && pr.collab) {
    const profit = paid - cost - fee - research;
    H.collabShare(w, s, pr.collab, profit, n);
    M.collabDay = (M.collabDay || 0) + Math.max(0, profit) * (1 - pr.collab.share);
  }
}
// What アスカ国's people spent at MIZUKAWA GARAGE there (its category: server/core/asuka.js): units of the models out,
// as many as its money buys (by how each is wanted), the part of a unit kept for the next day's
export function asukaSold(H, w, s, n) {
  const M = s.mz;
  if (!M || !(n > 0)) return;
  const out = Object.entries(M.products).filter(([id, x]) => x.price > 0 && (!M.left || M.left[id] === undefined || M.left[id] > 0));
  H.post(s, [['cash', n], ['r:cars', -n]], 'receipts');
  M.m.sales += n;
  M.asuka = (M.asuka || 0) + n;
  if (!out.length) return;
  const wts = out.map(([id]) => { const pr = CORP.products.cars[id] || CORP.products.items[id]; return (pr && pr.npc) || 1; }), tw = wts.reduce((a, b) => a + b, 0);
  const frac = M.frac || (M.frac = {});
  out.forEach(([id, x], k) => {
    const v = n * wts[k] / tw;
    frac[id] = (frac[id] || 0) + v / x.price;
    const units = Math.floor(frac[id]);
    frac[id] -= units;
    if (units > 0) { make(H, w, s, x.kind, id, units, units * x.price, 'npc'); (M.asukaUnits || (M.asukaUnits = {}))[id] = ((M.asukaUnits || {})[id] || 0) + units; }
  });
}

/* ---------------------------------------------------------------- its days --- */
// A day: the models whose day it is out; its plants' and head office's land and 管理費 (アスカ国's); HIGA MASTER's
// research (its half year's money, a day of it); its technology's fees of MAGITA, WAZIMA and YOSHIDA; MY WAY's
// contract ending on its day.
export function day(H, w, s, p, d, out) {
  const M = s.mz;
  if (!M) return;
  // (HIGA MASTER done today: before the day's models come out — they are made on it)
  if (!M.higa.done && d + 1 >= HIGA_DUE) {
    M.higa.done = d;
    H.news(out, s, p, d + 1, 3 * 3600, 'lab', `${R.higa.name}の開発に成功：製造原価を${Math.round(R.higa.cut * 100)}%低減（以降の生産すべて）`, { ok: true }, 0, true);
  }
  // (each out from the close that begins its day: 9:00 Japan time on it)
  for (const [kind, id, pr] of PRODUCTS()) if (!M.products[id] && CORP.mizukawaOut(id, d + 1)) release(H, w, s, kind, id, pr, d, out);
  // (its land and 管理費: a day of its month, at this world's size — the land's rent アスカ国's treasury's, the rest its
  // local trade's work)
  // (WAZIMA's research, once WAZIMA is its, cuts its plants' and its lines' upkeep as it did MAGITA's: its `save`)
  const sc = scaleOf(w), month = R.facilities.month * sc * 12 / YEAR * ((s.save && s.save.place) || 1);
  const land = H.take(s, 'mzLand', month * R.facilities.land), admin = H.take(s, 'mzAdmin', month * (1 - R.facilities.land));
  if (land + admin > 0) {
    H.post(s, [['sPlace', land + admin], ['cash', -(land + admin)]], 'expenses');
    const by = s.expBy || (s.expBy = {});
    by.place = (by.place || 0) + land + admin;
    M.m.facilities += land + admin;
    if (w.ext) { const X = xOf(w); X.land += land; X.admin += admin; }
  }
  // HIGA MASTER: what is left of its money, a day of what is left of its time; done on its day (always)
  if (!M.higa.done) {
    const daysLeft = Math.max(1, HIGA_DUE - d), left = Math.max(0, M.higa.cost * (HIGA_DUE - Math.max(HIGA_START, M.founded)) / Math.max(1, HIGA_DUE - HIGA_START) - M.higa.spent);
    const n = Math.round(left / daysLeft);
    if (n > 0) { M.higa.spent += n; M.pool += n; }
  }
  // its technology's fees: of what MAGITA and WAZIMA make on their lines (each holder its share), of YOSHIDA's cars
  license(H, w, s, d);
  // MY WAY's contract: over on its day (the Feat. cars left go on sharing)
  const mw = w.co.myway, c = mw && mw.ip && mw.ip.contracts.mizukawa;
  if (c && c.on && d + 1 >= (c.until || MYWAY_UNTIL)) {
    c.on = false; c.until = d;
    H.news(out, mw, H.PROFILES.get('myway'), d + 1, 4 * 3600, 'license', 'MIZUKAWAとのキャラクター契約が終了（River W Feat.の在庫分の利益配分は継続）', { partner: 'mizukawa' }, -0.002, true);
  }
}
// The fees of a day, by what each paid for its lines and cars of late (their sales a day: `pr`), × its technology's
// worth: on their books an expense (技術提供料), on MIZUKAWA's its sale, owed and paid as their other bills are
function license(H, w, s, d) {
  const M = s.mz, L = R.line, lift = 1 + M.asset / L.lift, share = M.wazima ? 1 : M.line;
  const day = (c, keys) => keys.reduce((n, k) => n + Math.max(0, (c.pr && c.pr[k]) || 0), 0);
  const pay = (from, n, code) => {
    const c = w.co[from];
    if (!c || c.dead || !(n > 0)) return 0;
    n = Math.round(n);
    H.post(c, [['sTech', n], ['ap', -n]]);
    c.owe.mizukawa = (c.owe.mizukawa || 0) + n;
    H.post(s, [['ar', n], ['r:' + code, -n]]);
    M.m.license += n;
    if (w.ext) xOf(w).vernoa += n;
    M.license[from] = (M.license[from] || 0) + n;
    return n;
  };
  const mg = w.co.magita, wz = w.co.wazima, ys = w.co.yosida;
  if (mg && !mg.dead) pay('magita', day(mg, ['dealer', 'export', 'gacha']) * L.rate * share * lift, 'linetech');
  // (WAZIMA pays for the share of its lines that is not its own — none once it is MIZUKAWA's)
  if (wz && !wz.dead && !M.wazima) pay('wazima', day(wz, ['export']) * L.rate * share * lift, 'linetech');
  if (ys && !ys.dead) pay('yosida', day(ys, ['dealer', 'export']) * L.cartech * lift, 'cartech');
  void d;
}

/* -------------------------------------------------------------- its month --- */
// At a month's end: its research — the pool its units sold put by, HIGA's, and more than it made besides (収益以上, as
// far as its cushion holds) —, half its researchers' (their pay's bonus), three tenths orders to YAMATO, WAZIMA's
// engineers and アスカ国, two tenths its technology's worth (kept); its pay index towards what it earns (稼ぐほど上がる),
// its people's number with its business; its share of the world's lines; its plans to buy.
export function month(H, w, s, p, d, out) {
  const M = s.mz;
  if (!M || s.dead) return;
  const pl = CORP.plOf(s.per.m), cost = monthly(s, w);
  // (アスカ国籍: its month's profit taxed there — the 法人税 and the 医療税 on it, six tenths of that HACHI's)
  const pre = Math.round(pl.pretax || 0);
  if (pre > 0) {
    const tax = Math.round(pre * ASUKA.rules.tax.corporate), med = Math.round(pre * (w.medRateA ?? NPC.knob.medicalTax.start) / 100);
    if (tax > 0) { H.post(s, [['tAsuka', tax], ['cash', -tax]], 'taxes'); xOf(w).tax += tax; }
    if (med > 0) { H.post(s, [['tMedical', med], ['cash', -med]], 'taxes'); xOf(w).medTax += med; }
  }
  const cash = s.bal.cash || 0;
  // (収益以上: what it made this month, and a fifth more, into research — as far as its cushion stays)
  const extra = Math.max(0, Math.min(Math.round(Math.max(0, pl.op) * R.research.extra), Math.round(cash - cost * R.research.cushion - M.pool)));
  const pool = Math.max(0, Math.min(M.pool + extra, Math.max(0, cash - cost)));
  M.pool = 0;
  if (pool > 0) {
    const pay = Math.round(pool * R.research.pay), orders = Math.round(pool * R.research.orders), asset = pool - pay - orders;
    const spent = pay + orders;
    H.post(s, [['sRd', spent], ['cash', -spent]], 'expenses');
    M.spent.pay += pay; M.spent.orders += orders; M.spent.asset += asset;
    M.asset += asset;
    const X = xOf(w), T = R.research.ordersTo;
    X.bonus += pay;
    const toWz = w.co.wazima && !w.co.wazima.dead ? Math.round(orders * T.wazima) : 0;
    if (toWz) w.b2bCash.push({ to: 'wazima', stream: 'mzorder', n: toWz, from: s.id, cost: Math.round(toWz * 0.6) });
    X.yamato += Math.round(orders * T.yamato);
    X.orders += orders - toWz - Math.round(orders * T.yamato);
    M.m.researchSpent = spent; M.m.asset = asset; M.m.bonus = pay;
  }
  // its share of the world's lines: a little more a month, the more its technology is worth
  if (!M.wazima) M.line = Math.min(R.line.max, M.line + R.line.grow + R.line.perAsset * M.asset / R.line.assetUnit / 12);
  // its pay: 稼ぐほど上がる — its people's at most `share` of what its sales leave after their making and its fees
  // (what it earned, over about three months: one good month or a slow one does not move it alone)
  const earn0 = (pl.sales || 0) - (M.m.cost || 0) - (M.m.fees || 0);
  const earn = M.earnAvg === undefined ? earn0 : M.earnAvg * 2 / 3 + earn0 / 3;
  M.earnAvg = earn;
  const base = baseMonth(s, w);
  const want = base > 0 ? Math.max(R.pay.min, Math.min(R.pay.max, (earn * R.pay.share) / base)) : 1;
  const was = M.payIdx;
  M.payIdx = Math.round(Math.max(R.pay.min, Math.min(R.pay.max, was + Math.max(-R.pay.step, Math.min(R.pay.step, want - was)))) * 1000) / 1000;
  // its people: more a quarter while it makes money and has the cash, fewer after two months in the red short of money
  M.red = pl.op < 0 ? M.red + 1 : 0;
  const runway = cash / Math.max(1, cost);
  if (CORP.isQuarterEnd(d) && pl.op > 0 && runway > R.research.cushion) M.staffIdx = Math.min(R.staff.max, M.staffIdx * (1 + R.staff.grow));
  else if (M.red >= 2 && runway < R.staff.runway) M.staffIdx = Math.max(R.staff.min, M.staffIdx * (1 - R.staff.cut));
  M.last = { day: d, key: CORP.monthKey(d), sales: Math.round(pl.sales), op: Math.round(pl.op), units: M.m.units, research: M.m.research, researchSpent: M.m.researchSpent || 0, asset: M.m.asset || 0, bonus: M.m.bonus || 0, license: M.m.license, facilities: M.m.facilities, payIdx: M.payIdx, was, staffIdx: Math.round(M.staffIdx * 1000) / 1000, staff: M.staff, line: Math.round(M.line * 1000) / 1000, byModel: M.m.byModel };
  M.hist.push(M.last);
  if (M.hist.length > 24) M.hist.shift();
  if (Math.abs(M.payIdx - was) >= 0.01) H.news(out, s, p, d + 1, 3 * 3600, 'staff', `社員の給与水準を${M.payIdx > was ? '引き上げ' : '引き下げ'}（基準の×${M.payIdx.toFixed(2)}：${M.payIdx > was ? '稼ぎに応じて' : '業績の悪化で'}）`, { payIdx: M.payIdx }, 0, false);
  M.m = blankMonth();
  plans(H, w, s, p, d, out);
}
// what a month costs it: its people (at their pay now, with what each costs beyond), its land and 管理費
function monthly(s, w) {
  return Math.round(baseMonth(s, w) * s.mz.payIdx * R.burden + R.facilities.month * scaleOf(w));
}
// its people's pay a month at the start's (at their number now)
function baseMonth(s, w) {
  const sc = scaleOf(w);
  return R.roles.reduce((n, r) => n + wantOf(s, r, sc) * r.pay, 0);
}
export const monthlyOf = (s, w) => monthly(s, w);

/* ---------------------------------------------------------------- its plans --- */
// WAZIMA: bought of MAGITA at what it is worth and a quarter more, once its cash holds that and three months of its
// costs (a month after its founding at the earliest): WAZIMA its, its research the faster. The four of MAGITA's
// economy after it, at what their businesses are worth and a share more as the talks go: taken into it.
function plans(H, w, s, p, d, out) {
  const M = s.mz, cost = monthly(s, w), cash = s.bal.cash || 0;
  const wz = w.co.wazima;
  if (!M.wazima && wz && !wz.dead && (wz.owner || 'magita') === 'magita' && !wz.ownerNext && d - M.founded >= R.wazima.after) {
    const value = Math.round(H.fairValue(wz, H.PROFILES.get('wazima'), w) * (1 + R.wazima.premium));
    // (what its cash and its cushion do not cover, Tenesice lends — as far as a year of its sales)
    const yearSales = M.hist.slice(-3).reduce((n, h) => n + h.sales, 0) / Math.max(1, Math.min(3, M.hist.length)) * 12;
    const short = Math.max(0, value + cost * R.wazima.cushion - cash), line = Math.max(0, yearSales * R.wazima.loan - s.loans.reduce((n, l) => n + l.amt, 0));
    const lent = short > 0 && short <= line ? H.lendable(w, s, Math.ceil(short / H.M.unit) * H.M.unit) : 0;
    if (value > 0 && cash + lent >= value + cost * R.wazima.cushion) {
      if (lent > 0) {
        const rate = H.rateFor(w, s);
        s.loans.push({ id: 'L' + (++s.seq), amt: lent, rate, from: d, until: d + 5 * YEAR });
        H.post(s, [['cash', lent], ['loan', -lent]], 'borrow');
        w.mon['mizukawa:borrowed'] = (w.mon['mizukawa:borrowed'] || 0) + lent;
        H.news(out, s, p, d + 1, 2 * 3600, 'loan', `WAZIMAの買収資金としてテネシスから${CORP.fmt.money(lent)}を借入（年${(rate * 100).toFixed(2)}%）`, { amt: lent, rate }, 0, true);
      }
      const mg = w.co.magita;
      H.post(s, [['affil', value], ['cash', -value]], 'acquire');
      if (mg && !mg.dead) {
        H.post(mg, [['cash', value], ['xSubsidiary', -value]], 'receipts');
        // (the line technology: WAZIMA's share MIZUKAWA's now — the world's all its)
      }
      // (its month — this one — settled with MAGITA first: MIZUKAWA's from tomorrow, corp-model.js's close)
      wz.ownerNext = 'mizukawa';
      M.wazima = { day: d, price: value };
      H.news(out, s, p, d + 1, 2 * 3600, 'acquire', `WAZIMAをMAGITAから${CORP.fmt.money(value)}（企業価値の${Math.round(R.wazima.premium * 100)}%増し）で買収：WAZIMAの利益・社員・設備・事業がMIZUKAWAに。研究速度は${R.release.bonus}倍`, { price: value }, 0, true);
      if (mg && !mg.dead) H.news(out, mg, H.PROFILES.get('magita'), d + 1, 2 * 3600, 'acquire', `子会社WAZIMAをMIZUKAWAに${CORP.fmt.money(value)}で売却`, { price: value }, -0.01, true);
      return;
    }
  }
  if (M.wazima && !M.locals && d - M.wazima.day >= R.locals.after) {
    // (the talks: each one's worth as its books stand — its equity —, and a share more the better MIZUKAWA and MAGITA
    // get on and the more it earns; bought as far as its cash holds three months of its costs besides)
    const seen = w.localsSeen || [], tie = H.tieOf(w, 'mizukawa', 'magita'), [lo, hi] = R.locals.premium;
    let room = Math.max(0, cash - cost * R.wazima.cushion);
    const list = [];
    for (const id of R.locals.firms) {
      const f = seen.find((x) => x.id === id);
      if (!f || f.dead || !(f.equity > 0)) continue;
      const premium = lo + (hi - lo) * Math.max(0, Math.min(1, tie / 100));
      const price = Math.round(f.equity * (1 + premium));
      if (price > room) continue;
      room -= price;
      list.push({ id, name: f.name, price, premium: Math.round(premium * 1000) / 1000 });
    }
    if (!list.length) return;
    let paid = 0;
    for (const x of list) {
      H.post(s, [['goodwill', x.price], ['cash', -x.price]], 'acquire');
      (s.goodwill || (s.goodwill = [])).push({ feature: 'local:' + x.id, price: x.price, left: x.price, month: Math.round(x.price / (5 * 12)) });
      paid += x.price;
    }
    // (to the people's side: closed into it, their owners paid — server/core/npc-local.js closeIntoMizukawa)
    w.mzLocalsBuy = list;
    M.locals = { day: d, bought: list, paid };
    H.news(out, s, p, d + 1, 2 * 3600, 'acquire', `旧MAGITA経済圏の${list.map((x) => x.name).join('・')}の事業を計${CORP.fmt.money(paid)}で取得し、MIZUKAWAに吸収（社員と技術は引き継がず）`, { paid }, 0, true);
  }
}
/* ------------------------------------------------------------ its people --- */
// アスカ国's account of its people (server/core/asuka.js flowsFor `mizukawa`: their number, by role, their pay a year):
// a day of their pay and what each costs it beyond, the researchers' bonus at the month's end (the pool's half)
export function payDay(H, w, s, A, X) {
  const M = s.mz, ma = A && A.mizukawa;
  if (!M || !ma) return;
  M.staff = ma.staff || 0; M.byRole = ma.byRole || {};
  s.n = M.staff;
  const pay = Math.round((ma.pay || 0) / YEAR), social = Math.round(pay * (R.burden - 1));
  if (pay + social > 0) {
    H.post(s, [['sSalary', pay], ['sWelfare', social], ['cash', -(pay + social)]], 'payroll');
    X.pay.mizukawa = (X.pay.mizukawa || 0) + pay;
    // (today's, with today's money to アスカ国: never left for tomorrow's)
    const mx = X.mizukawa || (X.mizukawa = { seed: 0, land: 0, admin: 0, orders: 0, yamato: 0, bonus: 0, social: 0, tax: 0, medTax: 0, vernoa: 0 });
    mx.social += social;
    M.m.pay += pay + social;
  }
  if (ma.staff > 0) s.unit = Math.round((ma.pay || 0) / ma.staff * R.burden);
}
// What the people's side is told of it each day (corp-model `ext.mizukawaInfo`): open, and its models out with their
// price — the people's side keeps their stock (as Car Owner's: server/core/npc-model.js)
export function info(w) {
  const s = w.co.mizukawa;
  if (!s || s.dead || !s.mz) return null;
  const buy = w.mzLocalsBuy || null;
  w.mzLocalsBuy = null;
  return { open: true, buy, out: Object.fromEntries(Object.entries(s.mz.products).map(([id, x]) => [id, { kind: x.kind, price: x.price, limit: x.limit }])), payIdx: s.mz.payIdx, staffIdx: s.mz.staffIdx, line: s.mz.wazima ? 1 : s.mz.line };
}
// what corp-model hands アスカ国 of it today, then forgets
export function takeX(w) { const x = w.mzX; w.mzX = null; return x; }
// For 運営's 企業: its models, its pool, its technology, its people, its plans
export function view(s) {
  const M = s && s.mz;
  if (!M) return null;
  return { founded: M.founded, payIdx: M.payIdx, staffIdx: Math.round(M.staffIdx * 1000) / 1000, staff: M.staff, byRole: M.byRole, line: M.wazima ? 1 : Math.round(M.line * 1000) / 1000, asset: Math.round(M.asset), pool: Math.round(M.pool), spent: M.spent,
    products: M.products, sold: M.sold, left: M.left || {}, higa: { done: M.higa.done, spent: Math.round(M.higa.spent), cost: M.higa.cost, due: HIGA_DUE }, license: M.license, last: M.last, hist: M.hist.slice(-12), wazima: M.wazima, locals: M.locals, asuka: Math.round(M.asuka || 0), rules: R };
}
void NPC; void ASUKA; void MONTH;
