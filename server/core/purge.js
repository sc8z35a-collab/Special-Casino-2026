// A player's data, gone for good: 90 days after the player went to the
// プレイヤーアーカイブ (a 永久BAN, or the account deleted), the housekeeping
// takes out everything that is theirs: the account, its logins and devices,
// money and car records, chats (what they sent, and their one-to-one
// conversations), friends, items, reports and the rest. Two things stay, by
// law and by design: the payment records of 開発者支援 (Japan's tax law keeps
// sales records for 7 years) and the operators' log (it can never change).
// Cars they gave away stay with their owners, without the giver. What friends
// sent them that they never tapped (money, a car, items) goes back to the
// friend; what they sent and nobody tapped goes with them.

// [table, the columns that hold the player's id]: rows matching any go
export const PLAYER_ROWS = [
  ['sessions', ['user_id']],
  ['messages', ['sender_id', 'recipient_id']],
  ['conversations', ['user_id', 'other_id']],
  ['transfers', ['from_id', 'to_id']],
  ['blocks', ['user_id', 'blocked_id']],
  ['spins', ['user_id']],
  ['friends', ['user_id', 'friend_id']],
  ['friend_requests', ['from_id', 'to_id']],
  ['cars', ['owner_id']],
  ['watchers', ['watcher_id', 'target_id']],
  ['items', ['user_id']],
  ['debts', ['user_id']],
  ['chat_members', ['user_id']],
  ['feedback', ['user_id']],
  ['battles', ['a_id', 'b_id']],
  ['watch_bets', ['watcher_id', 'host_id']],
  ['hub_members', ['user_id']],
  ['hub_invites', ['from_id', 'to_id']],
  ['devices', ['user_id']],
  ['trees', ['user_id']],
  ['tree_auctions', ['user_id']],
  ['npc_friends', ['user_id']],
  ['reports', ['reporter_id', 'target_id']],
  ['detections', ['sender_id', 'recipient_id']],
  ['bot_threads', ['user_id']],
  ['push_subs', ['user_id']]
];

const CURRENCIES = ['tokens', 'dollars'];

// What waited for a tap (messages.pending), before the messages go.
function settlePending(q, id) {
  let back = 0;
  for (const m of q('SELECT * FROM messages WHERE recipient_id = ? AND pending = 1 AND claimed_at = 0').all(id)) {
    const s = q('SELECT id, npc FROM users WHERE id = ?').get(m.sender_id);
    // (from Ice Smoker公式 or an NPC: nothing to give back)
    const friend = s && !s.npc ? s.id : 0;
    if (m.kind === 'gift') {
      if (friend) q('UPDATE cars SET owner_id = ?, from_id = 0, acquired_at = ? WHERE id = ? AND owner_id = 0').run(friend, Date.now(), m.amount);
      else q('DELETE FROM cars WHERE id = ? AND owner_id = 0').run(m.amount);
    } else if (!friend) {
      continue;
    } else if (m.kind === 'transfer' && CURRENCIES.includes(m.currency)) {
      q(`UPDATE users SET ${m.currency} = ${m.currency} + ?, rev = rev + 1 WHERE id = ?`).run(m.amount, friend);
    } else if (m.kind === 'item') {
      q('INSERT INTO items (user_id, item, count) VALUES (?, ?, ?) ON CONFLICT(user_id, item) DO UPDATE SET count = items.count + excluded.count').run(friend, m.body, m.amount);
    }
    back++;
  }
  // a car they gave that nobody took
  for (const m of q("SELECT amount FROM messages WHERE sender_id = ? AND kind = 'gift' AND pending = 1 AND claimed_at = 0").all(id)) {
    q('DELETE FROM cars WHERE id = ? AND owner_id = 0').run(m.amount);
  }
  return back;
}

// Takes out one player's data (in one transaction); how many rows went, by table.
export function purgePlayer(q, tx, id) {
  return tx(() => {
    const gone = {};
    const back = settlePending(q, id);
    if (back) gone.returned = back;
    for (const [table, cols] of PLAYER_ROWS) {
      const n = Number(q(`DELETE FROM ${table} WHERE ${cols.map((c) => `${c} = ?`).join(' OR ')}`).run(...cols.map(() => id)).changes);
      if (n) gone[table] = n;
    }
    // (what they gave stays with its owner)
    q('UPDATE cars SET from_id = 0 WHERE from_id = ?').run(id);
    gone.users = Number(q('DELETE FROM users WHERE id = ?').run(id).changes);
    return gone;
  });
}
