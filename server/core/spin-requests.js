import { ApiError } from './errors.js';
export const SPIN_RETRY_MS = 86400000;
// The timestamp rejects expired keys after their stored responses have been pruned.
export function createSpinRequests({ q, tx, clock = Date.now }) {
  return {
    run(userId, body, settle) {
      if (body.key === undefined) return settle(); // compatibility with already-installed clients
      const key = String(body.key), match = /^(\d{13})-[a-f0-9]{32}$/.exec(key), now = clock();
      if (!match || Number(match[1]) > now + 600000) throw new ApiError(400, 'spin_key', 'スピンの受付番号が正しくありません');
      if (now - Number(match[1]) >= SPIN_RETRY_MS) throw new ApiError(409, 'spin_expired', 'このスピンの再送期限が切れています');
      const fingerprint = JSON.stringify([Number(body.bet), body.idle ?? null]);
      return tx(() => {
        const old = q('SELECT fingerprint, response FROM spin_requests WHERE user_id = ? AND key = ?').get(userId, key);
        if (old) {
          if (old.fingerprint !== fingerprint) throw new ApiError(409, 'spin_conflict', '同じ受付番号で内容を変更できません');
          return JSON.parse(old.response);
        }
        const result = settle();
        q('INSERT INTO spin_requests (user_id, key, fingerprint, response, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, key, fingerprint, JSON.stringify(result), now);
        return result;
      });
    },
    prune() { return q('DELETE FROM spin_requests WHERE rowid IN (SELECT rowid FROM spin_requests WHERE created_at < ? LIMIT 5000)').run(clock() - SPIN_RETRY_MS); }
  };
}
