// MAGITA Garage: every player's garage is MAGITA's (js/game/corp.js MAGITA.garage), and each month every player pays
// its contract fee — the fee a place this month (MAGITA sets it at each month's end by how it is doing: $100,000, or
// $110,000〜$200,000 while it does badly; server/core/corp-model.js garageFee) times the places of their garage —
// taken at once from the $ in hand (強制徴収: even below 0). The money is MAGITA's (server/core/corp.js). A message
// from MAGITA Garage (an account that only sends) tells them, and the garage screen shows the last months.
//
// A month is the companies' month (from 9:00 Japan time on its 1st), and its fee is the one MAGITA set when the month
// before closed: a month's bills wait until it has. Nobody pays for the month their account began in. Nothing wakes
// the server for it: the housekeeping (every 6 hours) takes everyone's, and a look at one's garage one's own.
import { RULES, CORP } from './rules.js';
import { createOfficial } from './official.js';

export const BOT_NAME = 'MAGITA Garage';
const DAY_MS = 86400000;
// the companies' month of a moment ('YYYY-MM'), and how it reads
export const monthOf = (ms) => CORP.monthKey(CORP.dayOf(ms));
const monthLabel = (m) => { const [y, mm] = m.split('-'); return `${y}年${Number(mm)}月`; };

export function createGarageBills(ctx) {
  const { q, tx, getUser, balanceChanged, corp, fmt, clock = Date.now } = ctx;
  const bot = createOfficial({ ...ctx, npc: 'magita', name: BOT_NAME });
  bot.id();
  const slotsOf = (u) => RULES.garage.slots + (u.garage_extra || 0);
  const startOf = (now) => CORP.monthStart(CORP.dayOf(now)) * DAY_MS;
  // (the month before has closed into the companies' world, so this month's fee is set)
  const ready = (now) => corp.garageReady(CORP.monthStart(CORP.dayOf(now)));

  // this month's fee taken from one player (once a month); what was taken, or null
  function charge(userId, now = clock()) {
    if (!ready(now)) return null;
    const month = monthOf(now), start = startOf(now);
    const r = tx(() => {
      const u = getUser(userId);
      if (!u || u.npc || u.created_at >= start) return null;
      const fee = corp.garageFee(), slots = slotsOf(u), amount = fee * slots;
      const made = q('INSERT OR IGNORE INTO garage_bills (user_id, month, slots, fee, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, month, slots, fee, amount, now);
      if (!made.changes) return null;
      q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(amount, userId);
      corp.flow('magita', 'garagefee', amount);
      return { month, fee, slots, amount };
    });
    if (!r) return null;
    const u = getUser(userId);
    const raised = r.fee > CORP.magita.garage.base ? `（MAGITAの経営状況により通常の$${fmt(CORP.magita.garage.base)}から値上げ中）` : '';
    bot.say(userId, `【MAGITA Garage 契約料のお知らせ】\n\n${u.name}様\n\nお客様のガレージはMAGITA Garageが管理しています。${monthLabel(r.month)}の契約料を手元資金から徴収しました。\n\n` +
      `ガレージ ${r.slots}台分 × $${fmt(r.fee)}${raised}\n徴収額：$${fmt(r.amount)}\n現在の手元資金：${u.dollars < 0 ? '−' : ''}$${fmt(Math.abs(u.dollars))}\n\n` +
      `契約料は毎月1日に、その時のガレージの台数分を自動で徴収します。\n\n${BOT_NAME}より`);
    balanceChanged(userId);
    return r;
  }
  // everyone who has not paid this month yet
  function chargeAll(now = clock()) {
    if (!ready(now)) return 0;
    const rows = q(`SELECT u.id FROM users u WHERE u.npc = '' AND u.created_at < ?
                    AND NOT EXISTS (SELECT 1 FROM garage_bills b WHERE b.user_id = u.id AND b.month = ?)`).all(startOf(now), monthOf(now));
    let n = 0;
    for (const r of rows) if (charge(r.id, now)) n++;
    return n;
  }
  // a player's last months, and this month's fee (what the next month's will be is MAGITA's to say at the month's end)
  function mine(userId, now = clock()) {
    const u = getUser(userId);
    return {
      fee: corp.garageFee(), base: CORP.magita.garage.base, slots: u ? slotsOf(u) : RULES.garage.slots, rentCut: CORP.magita.garage.rentCut,
      next: (CORP.monthEnd(CORP.dayOf(now)) + 1) * DAY_MS,
      bills: q('SELECT month, slots, fee, amount, created_at AS at FROM garage_bills WHERE user_id = ? ORDER BY id DESC LIMIT 6').all(userId)
    };
  }
  const housekeep = (now = clock()) => chargeAll(now);
  return { bot, charge, chargeAll, mine, housekeep, monthOf };
}
