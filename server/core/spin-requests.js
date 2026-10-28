import { ApiError } from './errors.js';
export const SPIN_RETRY_MS = 86400000;
const CLOCK_SKEW_MS = 600000;
// The timestamp rejects expired keys after their stored responses have been pruned.
export function createSpinRequests({ q, tx, clock = Date.now, table = 'spin_requests', code = 'spin', label = 'スピン', fingerprint: fingerprintOf = body => JSON.stringify([Number(body.bet), body.idle ?? null]), replay = (id, result) => result }) {
  if (!['spin_requests', 'gacha_requests'].includes(table)) throw new Error('unknown receipt table');
  return {
    run(userId, body, settle) {
      if (body.key === undefined) return settle(); // compatibility with already-installed clients
      const key = String(body.key), match = /^(\d{13})-[a-f0-9]{32}$/.exec(key), now = clock();
      if (!match || Number(match[1]) > now + CLOCK_SKEW_MS) throw new ApiError(400, code + '_key', label + 'の受付番号が正しくありません');
      if (now - Number(match[1]) >= SPIN_RETRY_MS) throw new ApiError(409, code + '_expired', 'この' + label + 'の再送期限が切れています');
      const fingerprint = fingerprintOf(body);
      return tx(() => {
        const old = q(`SELECT fingerprint, response FROM ${table} WHERE user_id = ? AND key = ?`).get(userId, key);
        if (old) {
          if (old.fingerprint !== fingerprint) throw new ApiError(409, code + '_conflict', '同じ受付番号で内容を変更できません');
          return replay(userId, JSON.parse(old.response));
        }
        const result = settle();
        q(`INSERT INTO ${table} (user_id, key, fingerprint, response, created_at) VALUES (?, ?, ?, ?, ?)`).run(userId, key, fingerprint, JSON.stringify(result), now);
        return result;
      });
    },
    // A client's clock may be ahead. Never delete a receipt while that key can still be accepted.
    prune() { return q(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE created_at < ? LIMIT 5000)`).run(clock() - SPIN_RETRY_MS - CLOCK_SKEW_MS); }
  };
}
