import { ApiError } from './errors.js';
import { nameKey, hashPassword, verifyPassword } from './auth.js';
const WINDOW = 15 * 60000, TRIES = 5;
let standIn;
export function createGameLogin({ q, tx, clock = Date.now }) {
  const held = row => row && row.until > clock();
  const locked = row => new ApiError(429, 'account_locked', 'ログインの試行が多すぎます。15分後にもう一度お試しください', { until: row.until });
  const rowFor = key => q('SELECT * FROM game_login_locks WHERE name_key = ?').get(key);
  function clear(name) { q('DELETE FROM game_login_locks WHERE name_key = ?').run(nameKey(name)); }
  return {
    clear,
    async verify(name, password) {
      const key = nameKey(name);
      let row = rowFor(key);
      if (held(row)) throw locked(row);
      const u = q('SELECT * FROM users WHERE name_key = ?').get(key);
      const hash = u?.password_hash || await (standIn ||= hashPassword('nobody owns this login stand-in'));
      const ok = await verifyPassword(password, hash);
      return tx(() => {
        row = rowFor(key);
        if (held(row)) throw locked(row);
        const current = u && q('SELECT * FROM users WHERE id = ?').get(u.id);
        if (ok && u?.password_hash && current?.password_hash === hash && current.name_key === key) {
          clear(key); return current;
        }
        const now = clock(), fresh = !row || now - row.started >= WINDOW;
        const failures = (fresh ? 0 : row.failures) + 1, until = failures >= TRIES ? now + WINDOW : 0;
        q(`INSERT INTO game_login_locks (name_key, failures, started, until) VALUES (?, ?, ?, ?)
          ON CONFLICT(name_key) DO UPDATE SET failures = excluded.failures, started = excluded.started, until = excluded.until`)
          .run(key, failures, fresh ? now : row.started, until);
        // Return the error: throwing here would roll back the persistent strike.
        return until ? locked({ until }) : new ApiError(401, u && !u.password_hash ? 'no_password' : 'bad_login',
          u && !u.password_hash ? 'このアカウントはパスワードが未設定です。引き継ぎコードでログインしてください' : 'ユーザー名かパスワードが違います');
      });
    },
    prune() { q('DELETE FROM game_login_locks WHERE started < ? AND until <= ?').run(clock() - 86400000, clock()); }
  };
}
