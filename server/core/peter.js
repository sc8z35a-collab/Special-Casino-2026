// マイクソン (once ピーター), the money lender: an NPC account that is always online. When a
// player is nearly broke he offers a loan on his own (150万 at 2-5 %, and once
// that is spent too, 100万 at 10 %), he lends what players ask for in his chat
// ("300万貸して") and takes repayments. He lends one player RULES.lender.max
// in all, ever: repaying does not bring that back (debts.lent counts every
// loan). A loan asked for in the chat stops his own offers until everything
// is paid back, so the two never contradict each other. Interest is fixed when
// the money is lent: the debt grows by the amount plus that many percent, and
// stacks up until it is repaid. Every loan leaves a line "○○万円貸しました" in
// his chat. Money is in $ (he says 円).
import { ApiError } from './errors.js';
import { RULES } from './rules.js';
import { newRecoveryCode, sha256 } from './auth.js';

const L = RULES.lender;

// What he says on his own (RULES.lender.offers: the amounts). The voice
// recordings (sounds/peter-1.mp3, sounds/peter-2.mp3) say the first ones,
// 500万 and 600万: they are not played while the amounts differ (voice: false).
export const OFFER_LINES = [
  '返済時に利息2~5％付きで借りてかない？150万円貸すよ',
  'おや、もう使い切ってしまったのかい？ギャンブラーだね。じゃあ利息10パーセントで100万貸そう'
];

// the NPCs' names (and the lender's old one) are not for players
export const NAME = 'マイクソン';
const RESERVED = new Set(['マイクソン', 'まいくそん', 'mikeson', 'mikuson', 'ピーター', 'peter', 'ぴーたー', 'ジョンソン', 'じょんそん', 'johnson']);
export function reservedName(key) { return RESERVED.has(key); }

// 5150000 -> "515万円", 1279200 -> "127万9200円"
export function yen(n) {
  const man = Math.floor(n / 10000), rest = n % 10000;
  if (!man) return `${rest}円`;
  return rest ? `${man}万${rest}円` : `${man}万円`;
}

/* ------------------------------------------------------------ reading the chat */

const DIGIT = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const SMALL = { '十': 10, '百': 100, '千': 1000 };
const BIG = { '万': 1e4, '億': 1e8 };

// "300", "1.5億", "三百万", "千二百万", "1億5000万" -> a number
function jaNumber(s) {
  let total = 0, section = 0, num = null, digits = '';
  const flush = () => { if (digits) { num = Number(digits); digits = ''; } };
  for (const ch of s) {
    if (/[\d.]/.test(ch)) { digits += ch; continue; }
    flush();
    if (ch in DIGIT) num = (num ?? 0) * 10 + DIGIT[ch];
    else if (ch in SMALL) { section += (num ?? 1) * SMALL[ch]; num = null; }
    else if (ch in BIG) { total += (section + (num ?? 0)) * BIG[ch]; section = 0; num = null; }
  }
  flush();
  return total + section + (num ?? 0);
}

// The largest amount written in the text, in $ (null when there is none).
export function parseAmount(text) {
  const s = String(text || '').normalize('NFKC').replace(/[,，、\s]/g, '');
  let best = null;
  for (const m of s.matchAll(/[\d.〇零一二三四五六七八九十百千万億]+/g)) {
    if (!/[\d〇零一二三四五六七八九十百千]/.test(m[0])) continue;   // "万" of 万が一
    const n = Math.floor(jaNumber(m[0]));
    if (Number.isFinite(n) && n > 0 && (best === null || n > best)) best = n;
  }
  return best;
}

const REPAY = /返す|返済|返し|かえす|へんさい/;
const BORROW = /貸|借|かして|かりたい|かりる|融資|ローン|ちょうだい|頂戴|ください|下さい|くれ|ほしい|欲しい|頼む|たのむ|お願い|おねがい/;

const MONEY = /[万億円$]|ドル/;

export function readRequest(text) {
  const s = String(text || '').normalize('NFKC');
  const amount = parseAmount(s);
  if (REPAY.test(s)) return { intent: 'repay', amount };
  // "300万貸して", or just "300万"
  if (BORROW.test(s) || (amount !== null && MONEY.test(s))) return { intent: 'borrow', amount };
  return { intent: 'other', amount: null };
}

function randInt([lo, hi]) {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return lo + (r[0] % (hi - lo + 1));
}

/* ------------------------------------------------------------ the lender */

// ctx: { q, tx, getUser, insertMessage, msgDto, touchConversations, unreadTotal, live, balanceChanged, dmChannel, onBorrow }
export function createPeter(ctx) {
  const { q, tx, getUser, live } = ctx;
  let peterId = 0;

  // His account: created once, found again after a restore.
  function id() {
    const cached = peterId && getUser(peterId);
    if (cached && cached.npc === 'peter') return peterId;
    let row = q("SELECT id FROM users WHERE npc = 'peter' LIMIT 1").get();
    if (!row) {
      const now = Date.now();
      q(`INSERT INTO users (name, name_key, recovery_hash, avatar, tokens, dollars, coins, npc, created_at, last_seen)
         VALUES (?, ?, ?, 'peter', 0, 0, 0, 'peter', ?, ?)`)
        .run(NAME, 'npc:peter', sha256(newRecoveryCode() + ':peter'), now, now);
      row = q("SELECT id FROM users WHERE npc = 'peter' LIMIT 1").get();
    }
    peterId = row.id;
    // he was called ピーター before DEV6
    q('UPDATE users SET name = ? WHERE id = ? AND name <> ?').run(NAME, peterId, NAME);
    return peterId;
  }
  function me() { const p = getUser(id()); return { id: p.id, name: p.name, avatar: p.avatar, npc: 'peter' }; }

  function debt(userId) {
    return q('SELECT * FROM debts WHERE user_id = ?').get(userId)
      || { user_id: userId, principal: 0, owed: 0, stage: 0, offer: 0, chat: 0, lent: 0 };
  }
  function saveDebt(d) {
    q(`INSERT INTO debts (user_id, principal, owed, stage, offer, chat, lent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET principal = excluded.principal, owed = excluded.owed, stage = excluded.stage,
       offer = excluded.offer, chat = excluded.chat, lent = excluded.lent, updated_at = excluded.updated_at`)
      .run(d.user_id, d.principal, d.owed, d.stage, d.offer, d.chat, d.lent, Date.now());
  }
  // what he can still lend this player, ever
  const left = (d) => Math.max(0, L.max - d.lent);
  function debtDto(d) {
    return { principal: d.principal, owed: d.owed, offer: d.offer, stage: d.stage, chat: !!d.chat, max: L.max, lent: d.lent, available: left(d) };
  }

  // A message from Peter in his conversation with the player (unread for them).
  function say(userId, text, kind = 'text', amount = null) {
    const pid = id();
    const row = ctx.insertMessage({ channel: ctx.dmChannel(userId, pid), sender: getUser(pid), recipient: userId, kind, body: text, amount });
    ctx.touchConversations(userId, pid, row.id, userId);
    return row;
  }
  function deliver(userId, row) {
    const dto = ctx.msgDto(row);
    live.send(userId, 'msg', { ...dto, unread: ctx.unreadTotal(userId) });
    return dto;
  }

  // Lends `amount` $ at `rate` %: the money arrives, the debt grows.
  function lend(d, cur, amount, rate) {
    const owed = amount + Math.round(amount * rate / 100);
    d.principal += amount;
    d.owed += owed;
    d.lent += amount;
    q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(amount, cur.id);
    return owed;
  }
  // the line under every loan
  function lentLine(userId, amount) {
    const pid = id();
    const row = ctx.insertMessage({ channel: ctx.dmChannel(userId, pid), sender: null, recipient: userId, kind: 'system', body: `${yen(amount)}貸しました` });
    ctx.touchConversations(userId, pid, row.id, 0);
    return row;
  }

  function repayIn(d, cur, amount) {
    if (d.owed <= 0) throw new ApiError(409, 'no_debt', `${NAME}への借金はありません`);
    const pay = Math.min(amount, d.owed);
    if (cur.dollars < pay) throw new ApiError(409, 'insufficient', `$が足りません（返済には $${pay.toLocaleString('en-US')} 必要です）`);
    const principalPaid = pay === d.owed ? d.principal : Math.floor(d.principal * pay / d.owed);
    d.owed -= pay;
    d.principal -= principalPaid;
    // all paid back: a clean slate (his own offers can come again)
    if (d.owed === 0) Object.assign(d, { principal: 0, stage: 0, offer: 0, chat: 0 });
    q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(pay, cur.id);
    return pay;
  }

  // Nearly broke and no chat loan: he offers the next loan (once per offer).
  function check(userId) {
    const u = getUser(userId);
    if (!u || u.npc || u.banned) return;
    if (u.dollars + u.tokens * RULES.tokenPrice >= L.brokeBelow) return;
    const d = debt(userId);
    if (d.chat || d.offer || d.stage >= L.offers.length) return;
    const n = d.stage + 1;
    if (L.offers[n - 1].amount > left(d)) return;
    const row = tx(() => {
      d.offer = n;
      saveDebt(d);
      return say(userId, OFFER_LINES[n - 1], 'offer', n);
    });
    deliver(userId, row);
  }

  // 「借りる」 under one of his offers.
  function takeOffer(u, n) {
    let note, line;
    const reply = tx(() => {
      const cur = getUser(u.id);
      const d = debt(u.id);
      if (!d.offer || d.offer !== n) throw new ApiError(409, 'offer_gone', `その話はもう終わったよ（${NAME}）`);
      const o = L.offers[n - 1];
      if (o.amount > left(d)) throw new ApiError(409, 'limit', `${NAME}が貸せるのは累計${yen(L.max)}までです（あと${yen(left(d))}）`);
      const rate = randInt(o.rate);
      const owed = lend(d, cur, o.amount, rate);
      d.stage = n;
      d.offer = 0;
      saveDebt(d);
      note = { amount: o.amount, rate, owed };
      const row = say(u.id, `毎度あり！${yen(o.amount)}貸したよ。利息は${rate}%、返すときは${yen(owed)}だ。`);
      line = lentLine(u.id, o.amount);
      return row;
    });
    ctx.balanceChanged(u.id);
    const out = { ...note, reply: deliver(u.id, reply), lent: deliver(u.id, line), debt: debtDto(debt(u.id)) };
    if (ctx.onBorrow) ctx.onBorrow(u.id);
    return out;
  }

  function repay(u, amount) {
    let paid;
    const reply = tx(() => {
      const cur = getUser(u.id);
      const d = debt(u.id);
      paid = repayIn(d, cur, amount);
      saveDebt(d);
      return say(u.id, d.owed === 0
        ? `全額返済ありがとう！${yen(paid)}、確かに受け取ったよ。また困ったらいつでもおいで。`
        : `確かに${yen(paid)}受け取ったよ。残りは${yen(d.owed)}だ。`);
    });
    ctx.balanceChanged(u.id);
    return { paid, reply: deliver(u.id, reply), debt: debtDto(debt(u.id)) };
  }

  // The player wrote to him: the message is kept like any chat, he answers.
  function chat(u, text) {
    const pid = id();
    const mine = tx(() => {
      const row = ctx.insertMessage({ channel: ctx.dmChannel(u.id, pid), sender: u, recipient: pid, kind: 'text', body: text });
      ctx.touchConversations(u.id, pid, row.id, 0);
      return row;
    });
    const dto = ctx.msgDto(mine);
    live.send(u.id, 'msg', dto);
    const req = readRequest(text);
    let money = false, line = null;
    const reply = tx(() => {
      const cur = getUser(u.id);
      const d = debt(u.id);
      if (req.intent === 'repay') {
        if (d.owed <= 0) return say(u.id, '借金はないよ。借りたいときは「100万貸して」みたいに言ってくれ。');
        if (!req.amount) return say(u.id, `返すなら金額を言ってくれ（例:「100万返す」）。残りは${yen(d.owed)}だ。上の「返済」ボタンからでもいいよ。`);
        if (cur.dollars < Math.min(req.amount, d.owed)) return say(u.id, 'おいおい、手持ちが足りないじゃないか。');
        const paid = repayIn(d, cur, req.amount);
        saveDebt(d);
        money = true;
        return say(u.id, d.owed === 0
          ? `全額返済ありがとう！${yen(paid)}、確かに受け取ったよ。また困ったらいつでもおいで。`
          : `確かに${yen(paid)}受け取ったよ。残りは${yen(d.owed)}だ。`);
      }
      if (req.intent === 'borrow') {
        if (!req.amount) return say(u.id, 'いくら必要なんだい？「100万貸して」みたいに金額を言ってくれ。');
        const available = left(d);
        if (req.amount < L.minLoan) return say(u.id, `そんなはした金じゃ商売にならないね。${yen(L.minLoan)}からにしてくれ。`);
        if (available <= 0) return say(u.id, `悪いね、俺が貸すのは累計${yen(L.max)}までなんだ。もう貸せないよ。`);
        if (req.amount > available) return say(u.id, `そんなには貸せないね。俺が貸すのは累計${yen(L.max)}まで、あと${yen(available)}だよ。`);
        const rate = randInt(L.chatRate[d.principal > 0 ? 1 : 0]);
        const owed = lend(d, cur, req.amount, rate);
        // asked for himself: no more offers of his own until it is all repaid
        d.chat = 1;
        d.offer = 0;
        saveDebt(d);
        money = true;
        const row = say(u.id, `いいだろう、${yen(req.amount)}貸すよ。利息は${rate}%、返すときは${yen(owed)}だ。`);
        line = lentLine(u.id, req.amount);
        return row;
      }
      return say(u.id, `金の話なら聞くよ。借りたいなら「100万貸して」みたいに言ってくれ（累計${yen(L.max)}まで貸すよ）。`);
    });
    if (money) ctx.balanceChanged(u.id);
    const out = { message: dto, reply: deliver(u.id, reply), lent: line ? deliver(u.id, line) : null, debt: debtDto(debt(u.id)) };
    if (line && ctx.onBorrow) ctx.onBorrow(u.id);
    return out;
  }

  return {
    id,
    me,
    is: (userId) => userId === id(),
    check,
    takeOffer,
    repay,
    chat,
    state: (userId) => ({ peter: { ...me(), online: true }, debt: debtDto(debt(userId)) }),
    owed: (userId) => debt(userId).owed
  };
}
