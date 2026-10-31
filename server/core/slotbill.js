// カジノスロット使用料: the slots are Dtrade's (js/game/corp.js), and every month a player who spun in them is billed
// RULES.casino.monthly.amount $ by TWO STATE公式 (an account that only sends): a card in the chat with 支払う, to be
// paid within monthly.days days. One not paid by then is taken from the $ in hand, even if that leaves them below
// 0 (the only way the $ ever go below 0). The money is Dtrade's (server/core/corp.js).
//
// Nothing wakes the server for it, and a spin asks nothing more of it: the month a player spun in is kept in the
// spin's own row write (users.slot_month), a month's bills are made by the housekeeping after it ends (every 6
// hours) or by the player's first spin of the next month, and an unpaid one is taken by the housekeeping after it
// falls due (or when the player tries to pay it late).
import { RULES } from './rules.js';
import { ApiError, posInt } from './errors.js';
import { createOfficial } from './official.js';

export const BOT_NAME = 'TWO STATE公式';
const JST = 9 * 3600000;
// a moment's month in Japan time ('YYYY-MM'), and how it reads
export const monthOf = (ms) => { const d = new Date(ms + JST); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
const monthLabel = (m) => { const [y, mm] = m.split('-'); return `${y}年${Number(mm)}月`; };
const when = (ms) => { const d = new Date(ms + JST); return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

export function createSlotBills(ctx) {
  const { q, tx, getUser, balanceChanged, corp, fmt, clock = Date.now } = ctx;
  const M = RULES.casino.monthly;
  const bot = createOfficial({ ...ctx, npc: 'twostate', name: BOT_NAME });
  bot.id();

  // the bill for `month` (once: a second ask makes nothing)
  function issue(userId, month, now = clock()) {
    const u = getUser(userId);
    if (!u || u.npc) return null;
    const due = now + M.days * 86400000;
    const made = q('INSERT OR IGNORE INTO slot_bills (user_id, month, amount, created_at, due_at) VALUES (?, ?, ?, ?, ?)').run(userId, month, M.amount, now, due);
    if (!made.changes) return null;
    const text = `【カジノスロット使用料のご請求】\n\n${u.name}様\n\nカジノスロットは株式会社Dtradeが運営しています。${monthLabel(month)}のスロット使用料をご請求します。\n\n` +
      `ご請求額：$${fmt(M.amount)}\n支払期限：${when(due)}（${M.days}日以内）\n\n` +
      `期限までにお支払いがない場合は、手元資金から強制徴収します（手元資金がマイナスになる場合があります）。\n\n${BOT_NAME}より`;
    const { row } = bot.post(userId, { kind: 'bill', body: text, amount: M.amount, currency: 'dollars', pending: true, at: now });
    q('UPDATE slot_bills SET message_id = ? WHERE user_id = ? AND month = ?').run(row.id, userId, month);
    return row.id;
  }
  // every player who spun in a month that has ended and has no bill for it yet
  function issueAll(now = clock()) {
    const rows = q(`SELECT u.id, u.slot_month FROM users u WHERE u.npc = '' AND u.slot_month != '' AND u.slot_month < ?
                    AND NOT EXISTS (SELECT 1 FROM slot_bills b WHERE b.user_id = u.id AND b.month = u.slot_month)`).all(monthOf(now));
    let n = 0;
    for (const r of rows) if (tx(() => issue(r.id, r.slot_month, now))) n++;
    return n;
  }
  // a spin: its month, and (the first spin of a month) the last month's bill. In the spin's transaction.
  function spun(cur, now = clock()) {
    const month = monthOf(now);
    if (cur.slot_month && cur.slot_month < month) issue(cur.id, cur.slot_month, now);
    return month;
  }

  function settle(b, now, forced) {
    q('UPDATE slot_bills SET paid_at = ?, forced = ? WHERE id = ?').run(now, forced ? 1 : 0, b.id);
    if (b.message_id) q('UPDATE messages SET claimed_at = ? WHERE id = ?').run(now, b.message_id);
    q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(b.amount, b.user_id);
    corp.flow('dtrade', 'slotfee', b.amount);
  }
  // the bills past their day: taken from the $ in hand (below 0 if need be), and the player told
  function collect(now = clock(), userId = 0) {
    const due = userId
      ? q('SELECT * FROM slot_bills WHERE user_id = ? AND paid_at = 0 AND due_at <= ?').all(userId, now)
      : q('SELECT * FROM slot_bills WHERE paid_at = 0 AND due_at <= ?').all(now);
    for (const b of due) {
      tx(() => settle(b, now, true));
      const u = getUser(b.user_id);
      bot.say(b.user_id, `【強制徴収のお知らせ】\n\n${u.name}様\n\n${monthLabel(b.month)}のカジノスロット使用料 $${fmt(b.amount)} が支払期限までにお支払いいただけなかったため、手元資金から徴収しました。\n` +
        `現在の手元資金：${u.dollars < 0 ? '−' : ''}$${fmt(Math.abs(u.dollars))}\n\n${BOT_NAME}より`);
      balanceChanged(b.user_id);
    }
    return due.length;
  }
  // the player pays a bill (its card's 支払う): from the $ in hand, which must hold it
  function pay(u, messageId, now = clock()) {
    const b = q('SELECT * FROM slot_bills WHERE user_id = ? AND message_id = ?').get(u.id, messageId);
    if (!b) throw new ApiError(404, 'no_bill', 'この請求は見つかりません');
    if (!b.paid_at && b.due_at <= now) collect(now, u.id);
    const fresh = q('SELECT * FROM slot_bills WHERE id = ?').get(b.id);
    if (fresh.paid_at) return { paid: false, bill: dto(fresh) };
    tx(() => {
      const cur = getUser(u.id);
      if (cur.dollars < fresh.amount) throw new ApiError(409, 'insufficient', `$が足りません（期限を過ぎると手元資金から強制徴収されます）`);
      settle(fresh, now, false);
    });
    return { paid: true, bill: dto(q('SELECT * FROM slot_bills WHERE id = ?').get(b.id)) };
  }
  const dto = (b) => ({ month: b.month, amount: b.amount, due: b.due_at, paid: b.paid_at || 0, forced: !!b.forced, message: b.message_id });
  // a player's bills, newest first (the card shows its own; the game asks for the open ones)
  const mine = (userId) => q('SELECT * FROM slot_bills WHERE user_id = ? ORDER BY id DESC LIMIT 12').all(userId).map(dto);

  const routes = {
    'POST /api/slot-bill/pay': async (req, u) => {
      const body = await req.json();
      const r = pay(u, posInt(body.message, '請求'));
      return { ...r, me: ctx.meDto(balanceChanged(u.id)) };
    },
    'GET /api/slot-bill': (req, u) => ({ bills: mine(u.id) })
  };
  // the housekeeping: last month's bills made, the overdue ones taken
  function housekeep(now = clock()) { issueAll(now); collect(now); }

  return { bot, issue, issueAll, spun, collect, pay, mine, routes, housekeep, monthOf };
}
