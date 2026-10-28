// Software retention policy for game chat/virtual-currency transfers. Payment
// orders, operator/security logs and unresolved player assets are outside it.
export const RETENTION = Object.freeze({ messageHotDays: 90, messageDays: 365, transferHotDays: 365, transferDays: 1095, batch: 500 });
const DAY = 86400000;
// A conversation's last preview, unread messages, moderation references and
// unsettled cards must stay writable in the hot table regardless of age.
const SAFE = `m.held = 0 AND (m.pending = 0 OR m.claimed_at > 0)
  AND (m.kind NOT IN ('present', 'car_sold') OR m.claimed_at > 0)
  AND (m.kind != 'car_offer' OR m.state != '')
  AND m.kind IN ('text', 'system', 'transfer', 'gift', 'item', 'present', 'car_sold', 'car_offer')
  AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.last_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.user_id = m.recipient_id AND c.other_id = m.sender_id AND c.read_id < m.id)
  AND NOT EXISTS (SELECT 1 FROM chat_groups g WHERE g.last_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM chat_members r WHERE r.group_id = CAST(substr(m.channel, 7) AS INTEGER) AND m.channel = 'group:' || r.group_id AND r.read_id < m.id)
  AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.message_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM detections d WHERE d.message_id = m.id)`;

export function createRetention({ q, tx, clock = Date.now }) {
  let next = 0;
  return { nextDue: () => next, sweep({ force = false } = {}) {
    const now = clock();
    if (!force && now < next) return { skipped: true };
    const result = tx(() => {
      const result = {};
      for (const [hot, cold, hotDays, days, safe] of [
        ['messages', 'message_archive', RETENTION.messageHotDays, RETENTION.messageDays, SAFE],
        ['transfers', 'transfer_archive', RETENTION.transferHotDays, RETENTION.transferDays, '1']
      ]) {
        const ids = q(`SELECT m.id FROM ${hot} m WHERE m.created_at < ? AND ${safe} ORDER BY m.created_at LIMIT ?`).all(now - hotDays * DAY, RETENTION.batch);
        // Each batch moves atomically; a failure leaves all original records intact.
        if (ids.length) {
          const selected = JSON.stringify(ids.map(r => r.id));
          q(`INSERT INTO ${cold} SELECT * FROM ${hot} WHERE id IN (SELECT value FROM json_each(?))`).run(selected);
          q(`DELETE FROM ${hot} WHERE id IN (SELECT value FROM json_each(?))`).run(selected);
        }
        const old = q(`SELECT m.id FROM ${cold} m WHERE m.created_at < ? AND ${safe} ORDER BY m.created_at LIMIT ?`).all(now - days * DAY, RETENTION.batch);
        if (old.length) q(`DELETE FROM ${cold} WHERE id IN (SELECT value FROM json_each(?))`).run(JSON.stringify(old.map(r => r.id)));
        result[hot] = { archived: ids.length, deleted: old.length };
      }
      return result;
    });
    // A backlog drains in bounded batches; ordinary sweeps run at most hourly.
    next = now + (Object.values(result).some(r => r.archived === RETENTION.batch || r.deleted === RETENTION.batch) ? 60000 : 3600000);
    return result;
  } };
}
