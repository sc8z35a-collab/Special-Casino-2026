// Public LINE feed. SQLite is the outbox and the claim ledger; LINE never
// performs a game action. Each recipient/request has its own durable retry UUID.
import crypto from 'node:crypto';
import { ApiError } from './errors.js';
import { RELEASE } from './rules.js';
import catalog from './line-wallpapers.json' with { type: 'json' };

const DAY = 86400000, JST = 9 * 3600000, RETRY_LIFE = 23 * 3600000, SEND_CONCURRENCY = 4;
const ID = /^[UCR][0-9a-f]{32}$/;
const random = () => crypto.randomInt(0, 0x100000000) / 0x100000000;
export function feedPeriods(at, hour = 9) {
  const d = new Date(at + JST);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - JST;
  const week = day - ((d.getUTCDay() + 6) % 7) * DAY;
  return { day, week, dailyAt: day + hour * 3600000, weeklyAt: week + hour * 3600000 };
}

export function createLineFeed({ q, tx, kv, config, getUser, meDto, balanceChanged, version = '',
  clock = Date.now, rand = random, photos = catalog, fetcher = (...a) => globalThis.fetch(...a), reschedule = () => {} }) {
  const enabled = !!config.lineFeedEnabled;
  const on = enabled && !!config.lineChannelSecret && String(config.lineAccessToken || '').length >= 20;
  const hour = config.lineFeedHour ?? 9;
  let site = '', running = null;
  const origin = (url) => { try { const u = new URL(url); return u.protocol === 'https:' && !u.username && !u.password ? u.origin : ''; } catch { return ''; } };
  site = origin(config.publicUrl) || origin(kv.get('line_feed_origin'));
  const uniquePhotos = [...new Map(photos.map((p) => [p.id, p])).values()];
  const wake = () => reschedule(clock() + 60000);

  function event(e) {
    if (!on) return;
    const src = e.source || {};
    const id = src.type === 'group' ? src.groupId : src.type === 'room' ? src.roomId : src.userId;
    if (!ID.test(id || '') || !['follow', 'join', 'message', 'unfollow', 'leave'].includes(e.type)) return;
    const at = Math.min(clock(), Number(e.timestamp) || clock());
    const active = e.type === 'unfollow' || e.type === 'leave' ? 0 : 1;
    // Ordinary messages bootstrap already existing chats, silently. They cannot
    // reactivate a chat after leave/unfollow, or change any game state.
    const changed = e.type === 'message'
      ? q('INSERT OR IGNORE INTO line_feed_targets (id, active, changed_at) VALUES (?, 1, ?)').run(id, at)
      : q(`INSERT INTO line_feed_targets (id, active, changed_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET active = excluded.active, changed_at = excluded.changed_at
      WHERE excluded.changed_at > line_feed_targets.changed_at`).run(id, active, at);
    // Messages in an already registered chat need no new alarm or storage write by the host.
    if (changed.changes) wake();
  }

  function job(id, kind, slot, messages, expiresAt, at) {
    q('INSERT OR IGNORE INTO line_feed_jobs (id, kind, slot, messages, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, kind, String(slot), JSON.stringify(messages), at, expiresAt);
  }
  function prepare(at) {
    const p = feedPeriods(at, hour);
    tx(() => {
      for (const id of config.lineFeedTo || []) q('INSERT OR IGNORE INTO line_feed_targets (id, active, changed_at) VALUES (?, 1, ?)').run(id, at);
      if (!q('SELECT 1 FROM line_feed_targets WHERE active = 1 LIMIT 1').get()) return;
      if (at >= p.dailyAt && uniquePhotos.length && !q('SELECT id FROM line_feed_jobs WHERE id = ?').get('photo:' + p.day)) {
        let bag = kv.get('line_feed_cycle') || { used: [], last: '', cycle: 1 };
        let left = uniquePhotos.filter((x) => !bag.used.includes(x.id));
        if (!left.length) { bag = { used: [], last: bag.last, cycle: bag.cycle + 1 }; left = uniquePhotos; }
        if (left.length > 1) left = left.filter((x) => x.id !== bag.last);
        const photo = left[Math.floor(rand() * left.length)];
        bag.used.push(photo.id); bag.last = photo.id;
        kv.set('line_feed_cycle', bag);
        job('photo:' + p.day, 'photo', p.day, [
          { type: 'text', text: '今日の一枚' },
          { type: 'image', originalContentUrl: site + photo.original, previewImageUrl: site + photo.preview }
        ], p.day + DAY, at);
      }
      if (at >= p.weeklyAt) {
        for (const kind of ['casino', 'royal']) {
          const id = kind + ':' + p.week;
          if (q('SELECT id FROM line_feed_jobs WHERE id = ?').get(id)) continue;
          const amount = kind === 'casino' ? (rand() < 0.1 ? 20000 : 500 + Math.floor(rand() * 9501)) : 2 + Math.floor(rand() * 5);
          const token = crypto.randomBytes(24).toString('base64url');
          const end = p.weeklyAt + 7 * DAY;
          q('INSERT INTO line_feed_rewards (token_hash, week, kind, amount, expires_at) VALUES (?, ?, ?, ?, ?)')
            .run(crypto.createHash('sha256').update(token).digest('hex'), p.week, kind, amount, end);
          const text = `${kind === 'casino' ? 'カジノコイン' : 'ロイヤルコイン'} ${amount.toLocaleString('en-US')}枚`;
          job(id, 'reward', p.week, [{ type: 'flex', altText: text, contents: {
            type: 'bubble', size: 'kilo', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text, wrap: true }],
              action: { type: 'uri', label: '受け取る', uri: site + '/#line-gift=' + token } }
          } }], end, at);
        }
      }
      // The deployment UUID (not a request time) identifies an update. The
      // initial deployment is a baseline, not an invented update notice.
      const previous = kv.get('line_feed_version');
      if (version && previous !== version) {
        if (previous) job('release:' + version, 'release', version,
          [{ type: 'text', text: `DEV${RELEASE}のバージョン${version}にアップデートされました。` }], at + DAY, at);
        kv.set('line_feed_version', version);
      }
      const missing = q(`SELECT j.id AS job, t.id AS target FROM line_feed_jobs j CROSS JOIN line_feed_targets t
        WHERE j.expires_at > ? AND t.active = 1 AND NOT EXISTS
        (SELECT 1 FROM line_feed_deliveries d WHERE d.job_id = j.id AND d.target_id = t.id)`).all(at);
      for (const m of missing) q(`INSERT OR IGNORE INTO line_feed_deliveries (job_id, target_id, retry_key, next_at)
        VALUES (?, ?, ?, ?)`).run(m.job, m.target, crypto.randomUUID(), at);
      q("UPDATE line_feed_deliveries SET state = 'expired' WHERE state = 'pending' AND (job_id IN (SELECT id FROM line_feed_jobs WHERE expires_at <= ?) OR (first_at > 0 AND first_at <= ?))").run(at, at - RETRY_LIFE);
      // One month of transport diagnostics; the reward/claim ledger remains.
      q('DELETE FROM line_feed_deliveries WHERE job_id IN (SELECT id FROM line_feed_jobs WHERE expires_at < ?)').run(at - 30 * DAY);
      q('DELETE FROM line_feed_jobs WHERE expires_at < ?').run(at - 30 * DAY);
    });
  }

  async function deliver() {
    if (!on || !site) return;
    const at = clock();
    prepare(at);
    const pending = q(`SELECT d.*, j.messages FROM line_feed_deliveries d JOIN line_feed_jobs j ON j.id = d.job_id
      JOIN line_feed_targets t ON t.id = d.target_id
      WHERE d.state = 'pending' AND d.next_at <= ? AND j.expires_at > ? AND t.active = 1
      ORDER BY j.created_at, d.job_id, d.target_id LIMIT 50`).all(at, at);
    const messages = new Map();
    async function send(d) {
      const first = d.first_at || clock();
      if (clock() - first >= RETRY_LIFE) return;
      const lease = q(`UPDATE line_feed_deliveries SET first_at = ?, attempts = attempts + 1, next_at = ?
        WHERE job_id = ? AND target_id = ? AND state = 'pending' AND next_at <= ?`)
        .run(first, clock() + 120000, d.job_id, d.target_id, clock());
      if (!lease.changes) return;
      let status = 0, accepted = false;
      try {
        if (!messages.has(d.job_id)) messages.set(d.job_id, JSON.parse(d.messages));
        const res = await fetcher((config.lineApi || 'https://api.line.me') + '/v2/bot/message/push', {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.lineAccessToken}`, 'X-Line-Retry-Key': d.retry_key },
          body: JSON.stringify({ to: d.target_id, messages: messages.get(d.job_id) })
        });
        status = res.status;
        accepted = res.ok || (status === 409 && !!res.headers.get('x-line-accepted-request-id'));
        if (res.body) await res.body.cancel();
      } catch { /* ambiguous result: the same UUID is reused, never a fresh send */ }
      const terminal = status >= 400 && status < 500 && ![408, 409, 429].includes(status);
      const delay = status === 429 ? 3600000 : Math.min(3600000, 60000 * 2 ** Math.min(d.attempts, 6));
      q('UPDATE line_feed_deliveries SET state = ?, next_at = ?, status = ? WHERE job_id = ? AND target_id = ?')
        .run(accepted ? 'sent' : terminal ? 'failed' : 'pending', clock() + delay, status, d.job_id, d.target_id);
    }
    // Four leased sends at most: a slow destination does not hold up all others,
    // and a large recipient list cannot create an unbounded burst of requests.
    let index = 0;
    async function worker() { while (index < pending.length) await send(pending[index++]); }
    await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, pending.length) }, worker));
  }
  function tick() {
    if (!running) running = deliver().finally(() => { running = null; });
    return running;
  }
  function nextDue(at = clock()) {
    if (!on || !site) return at + 6 * 3600000;
    const p = feedPeriods(at, hour);
    if (!(config.lineFeedTo || []).length && !q('SELECT 1 FROM line_feed_targets WHERE active = 1 LIMIT 1').get()) return p.dailyAt > at ? p.dailyAt : p.dailyAt + DAY;
    const today = q('SELECT id FROM line_feed_jobs WHERE id = ?').get('photo:' + p.day);
    let next = !today ? Math.max(at + 60000, p.dailyAt) : p.dailyAt + DAY;
    if (version && kv.get('line_feed_version') !== version) next = Math.min(next, at + 60000);
    const r = q(`SELECT MIN(d.next_at) AS at FROM line_feed_deliveries d JOIN line_feed_targets t ON t.id = d.target_id
      WHERE d.state = 'pending' AND t.active = 1`).get();
    if (r?.at != null) next = Math.min(next, Math.max(at + 60000, r.at));
    return next;
  }
  function reward(token) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(String(token || ''))) throw new ApiError(404, 'no_reward', '配布が見つかりません');
    const r = q('SELECT * FROM line_feed_rewards WHERE token_hash = ?').get(crypto.createHash('sha256').update(token).digest('hex'));
    if (!r) throw new ApiError(404, 'no_reward', '配布が見つかりません');
    return r;
  }
  const dto = (r, u) => ({ kind: r.kind, amount: r.amount, expiresAt: r.expires_at,
    claimed: !!q('SELECT 1 FROM line_feed_claims WHERE user_id = ? AND week = ? AND kind = ?').get(u.id, r.week, r.kind), expired: clock() >= r.expires_at });
  return {
    enabled, event, tick, nextDue,
    host(value) { if (!on || site) return; const v = origin(value); if (v) { site = v; kv.set('line_feed_origin', site); wake(); } },
    routes: {
      'POST /api/line/reward': async (req, u) => dto(reward((await req.json()).token), u),
      'POST /api/line/reward/claim': async (req, u) => {
        const r = reward((await req.json()).token);
        const claimed = tx(() => {
          const cur = getUser(u.id);
          if (cur.npc) throw new ApiError(403, 'not_allowed', '受け取れません');
          if (dto(r, u).claimed) return false;
          if (clock() >= r.expires_at) throw new ApiError(410, 'expired', '受け取り期限が過ぎました');
          q('INSERT INTO line_feed_claims (user_id, week, kind, amount, claimed_at) VALUES (?, ?, ?, ?, ?)').run(u.id, r.week, r.kind, r.amount, clock());
          const column = r.kind === 'casino' ? 'tokens' : 'coins';
          q(`UPDATE users SET ${column} = ${column} + ?, rev = rev + 1 WHERE id = ?`).run(r.amount, u.id);
          return true;
        });
        return { ...dto(r, u), received: claimed, me: meDto(balanceChanged(u.id)) };
      }
    }
  };
}
