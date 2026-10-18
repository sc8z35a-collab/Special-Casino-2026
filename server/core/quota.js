// Daily limits. On the free plans, when a day's quota (requests, database
// writes, ...) is used up, the host refuses requests until 00:00 UTC; the game
// then shows "サーバーのメンテナンス中です。（日付）には復旧予定です。" instead
// of errors. Hosts without such limits can set soft caps of their own
// (DAILY_REQUEST_LIMIT requests, DAILY_MB_LIMIT megabytes sent per UTC day).
import { utcDay, nextUtcMidnight } from './rules.js';

// how the platform words "today's quota is used up"
const QUOTA_ERROR = /exceeded|quota|daily limit|free tier|limit reached/i;

export function isQuotaError(e) {
  return !!e && QUOTA_ERROR.test(String(e.message || e));
}

// The answer to every request until the quota resets.
export function maintenanceBody(now = Date.now()) {
  return { error: { code: 'maintenance', message: 'サーバーのメンテナンス中です。明日には復旧予定です。', until: nextUtcMidnight(now) } };
}

// Counts requests and bytes sent per UTC day. Off (and free) unless a cap
// is set; the counts are saved at most once a minute, so a restart loses
// at most a minute of them.
export function createQuota(db, { requests = 0, megabytes = 0 } = {}) {
  const on = requests > 0 || megabytes > 0;
  let day = utcDay(), reqs = 0, bytes = 0, dirty = 0, savedAt = Date.now();
  if (on) {
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = 'quota'").get();
      const v = row ? JSON.parse(row.value) : null;
      if (v && v.day === day) { reqs = Number(v.requests) || 0; bytes = Number(v.bytes) || 0; }
    } catch { /* start counting from zero */ }
  }

  function roll() {
    const d = utcDay();
    if (d !== day) { day = d; reqs = 0; bytes = 0; dirty++; }
  }
  function save(force) {
    if (!on || !dirty || (!force && Date.now() - savedAt < 60000)) return;
    try {
      db.prepare("INSERT INTO meta (key, value) VALUES ('quota', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify({ day, requests: reqs, bytes }));
      dirty = 0;
      savedAt = Date.now();
    } catch { /* try again later */ }
  }

  return {
    on,
    over() {
      if (!on) return false;
      roll();
      return (requests > 0 && reqs >= requests) || (megabytes > 0 && bytes >= megabytes * 1048576);
    },
    // one request answered with `size` bytes
    request(size) {
      if (!on) return;
      roll();
      reqs++;
      bytes += size;
      dirty++;
      save(false);
    },
    // bytes pushed over live connections
    sent(size) {
      if (!on) return;
      roll();
      bytes += size;
      dirty++;
    },
    flush: () => save(true),
    state() {
      roll();
      return { day, requests: reqs, megabytes: Math.round(bytes / 10485.76) / 100, limits: { requests, megabytes }, resetsAt: new Date(nextUtcMidnight()).toISOString() };
    }
  };
}
