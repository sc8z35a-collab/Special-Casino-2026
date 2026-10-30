// A player's data, gone: 90 days after the player went to the プレイヤーアーカイブ
// (a 永久BAN, or the account deleted), the housekeeping takes out what is
// theirs: the logins and devices, money and cars, friends, items and the
// rest, and what could find the person again (the password, the 引き継ぎコード,
// the address and device the account was made from). What was said stays,
// under the retention policy: the conversations (with friends, in groups, with Ice Smoker公式
// and the NPCs), the reports, the filter's catches and 意見, with the account
// left as a name only ("〇〇（削除済み）") that nobody can log in to or bring
// back; its name is free for a new player. Also kept: the payment records of
// 開発者支援 (Japan's tax law keeps sales records for 7 years) and the
// operators' log (it can never change). Cars they gave away stay with their
// owners, without the giver. What friends sent them that they never tapped
// (money, a car, items) goes back to the friend; what they sent and nobody
// tapped goes with them.

import { RECEIPTS } from './rules.js';

// [table, the columns that hold the player's id]: rows matching any go
export const PLAYER_ROWS = [
  ['sessions', ['user_id']],
  ['chat_filter_strikes', ['user_id']],
  ['ops_mfa', ['user_id']],
  ['diary_reads', ['user_id']],
  ['diary_reactions', ['user_id']],
  ['blocks', ['user_id', 'blocked_id']],
  ['spins', ['user_id']],
  ['spin_requests', ['user_id']],
  ['gacha_requests', ['user_id']],
  ['friends', ['user_id', 'friend_id']],
  ['friend_requests', ['from_id', 'to_id']],
  ['cars', ['owner_id']],
  ['watchers', ['watcher_id', 'target_id']],
  ['items', ['user_id']],
  ['debts', ['user_id']],
  ['chat_members', ['user_id']],
  ['battles', ['a_id', 'b_id']],
  ['watch_bets', ['watcher_id', 'host_id']],
  ['hub_members', ['user_id']],
  ['hub_invites', ['from_id', 'to_id']],
  ['devices', ['user_id']],
  ['trees', ['user_id']],
  ['tree_auctions', ['user_id']],
  ['npc_friends', ['user_id']],
  ['push_subs', ['user_id']],
  ['oauth_identities', ['user_id']],
  ['stock_holdings', ['user_id']],
  ['stock_accounts', ['user_id']],
  ['stock_orders', ['user_id']],
  ['medals', ['user_id']]
];
// Kept during account purge; retention.js applies their separate age limits.
export const KEPT_ROWS = ['messages', 'message_archive', 'transfer_archive', 'conversations', 'live_chats', 'transfers', 'feedback', 'reports', 'detections', 'bot_threads'];

const CURRENCIES = ['tokens', 'dollars'];

// What waited for their tap (messages.pending): back to the friend who sent
// it, the card saying so (state 'returned'; 'void' when from Ice Smoker公式 or
// an NPC). What they sent stays, for the friend to tap.
function settlePending(q, id, now) {
  let back = 0;
  for (const m of q('SELECT * FROM message_history WHERE recipient_id = ? AND pending = 1 AND claimed_at = 0').all(id)) {
    if (RECEIPTS.expired(m, now)) {
      // Deleting the recipient cannot turn an expired gift into a refund.
      if (m.kind === 'gift') q('DELETE FROM cars WHERE id = ? AND owner_id = 0').run(m.amount);
      q("UPDATE messages SET state = 'expired' WHERE id = ?").run(m.id);
      continue;
    }
    const s = q('SELECT id, npc FROM users WHERE id = ?').get(m.sender_id);
    // (from Ice Smoker公式 or an NPC: nothing to give back)
    const friend = s && !s.npc ? s.id : 0;
    let given = false;
    if (m.kind === 'gift') {
      if (friend) given = Number(q('UPDATE cars SET owner_id = ?, from_id = 0, acquired_at = ? WHERE id = ? AND owner_id = 0').run(friend, now, m.amount).changes) > 0;
      else q('DELETE FROM cars WHERE id = ? AND owner_id = 0').run(m.amount);
    } else if (friend && m.kind === 'transfer' && CURRENCIES.includes(m.currency)) {
      q(`UPDATE users SET ${m.currency} = ${m.currency} + ?, rev = rev + 1 WHERE id = ?`).run(m.amount, friend);
      given = true;
    } else if (friend && m.kind === 'item') {
      q('INSERT INTO items (user_id, item, count) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET count = items.count + excluded.count').run(friend, m.body, m.amount);
      given = true;
    }
    q('UPDATE messages SET claimed_at = ?, state = ? WHERE id = ?').run(now, given ? 'returned' : 'void', m.id);
    if (given) back++;
  }
  return back;
}

// Takes out one player's data (in one transaction); how many rows went, by table.
export function purgePlayer(q, tx, id, now = Date.now()) {
  return tx(() => {
    const gone = {};
    const back = settlePending(q, id, now);
    if (back) gone.returned = back;
    for (const [table, cols] of PLAYER_ROWS) {
      const n = Number(q(`DELETE FROM ${table} WHERE ${cols.map((c) => `${c} = ?`).join(' OR ')}`).run(...cols.map(() => id)).changes);
      if (n) gone[table] = n;
    }
    // (what they gave stays with its owner; a car they offered is no longer for sale)
    q('UPDATE cars SET from_id = 0 WHERE from_id = ?').run(id);
    q("UPDATE cars SET offer_id = 0 WHERE offer_id IN (SELECT id FROM messages WHERE kind = 'car_offer' AND (sender_id = ? OR recipient_id = ?))").run(id, id);
    q("UPDATE messages SET state = 'canceled' WHERE kind = 'car_offer' AND state = '' AND (sender_id = ? OR recipient_id = ?)").run(id, id);
    // the account: a name on what was said, and nothing else (no way in, never
    // back: a deleted account; ':' is in no player's name, so the keys are free)
    const u = q('SELECT name FROM users WHERE id = ?').get(id);
    if (u) {
      q(`UPDATE users SET name = ?, name_key = ?, recovery_hash = ?, recovery_enc = '', password_hash = '',
           tokens = 0, dollars = 0, coins = 0, avatars = '', quests = '', jobs = '', coop_group = 0, battle_id = 0, vip_until = 0, vip_exp = 0, vip_modes = '[]', vip_permanent_at = 0,
           created_ip = '', created_device = '', created_fp = '', client_agent = '', client_build = '',
           banned = 1, ban_kind = 'deleted', ban_until = 0, purge_at = 0, purged_at = ?, rev = rev + 1 WHERE id = ?`)
        .run(`${u.name}（削除済み）`, `gone:${id}`, `gone:${id}`, now, id);
      gone.users = 1;
    }
    return gone;
  });
}
