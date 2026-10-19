// The operators' log: everything done through the operator site or the
// official bot that reaches anyone outside (messages, money, bans, reports,
// passwords, 引き継ぎコード …) and every DEV release going live, with all
// that is known about it. It can only grow: the database refuses to change
// or delete its rows (triggers in db.js), the server has no way to, a
// restore only adds missing rows (admin.js), and each row carries the hash
// of the one before it, so a row changed or taken out behind the server's
// back shows in verify().
import { sha256 } from './auth.js';

const GENESIS = 'TWO STATE ops log';

// "2026/10/20 05:31:12.345 JST"
export function jst(ms) {
  const d = new Date(ms + 9 * 3600000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)} JST`;
}

const fields = (r) => JSON.stringify([r.id, r.at, r.actor_id, r.actor_name, r.action, r.target_id, r.target_name, r.summary, r.detail, r.prev_hash]);

export function createOpsLog({ q }) {
  // who did it from where: the request as far as it is known
  function requestInfo(req) {
    if (!req) return {};
    const h = (k) => String((req.header && req.header(k)) || '').slice(0, 300);
    return { ip: req.ip || '', userAgent: h('user-agent'), device: h('x-device').slice(0, 120), origin: h('origin'), referer: h('referer') };
  }

  // One entry: actor and target are user rows (or null), detail anything JSON.
  function add({ actor = null, action, target = null, summary, detail = {}, req = null }) {
    const at = Date.now();
    const last = q('SELECT id, hash FROM ops_log ORDER BY id DESC LIMIT 1').get();
    const row = {
      id: last ? last.id + 1 : 1,
      at,
      actor_id: actor ? actor.id : 0,
      actor_name: actor ? actor.name : 'システム',
      action,
      target_id: target ? target.id : 0,
      target_name: target ? target.name : '',
      summary,
      detail: JSON.stringify({ time: { ms: at, iso: new Date(at).toISOString(), jst: jst(at) }, request: requestInfo(req), ...detail }),
      prev_hash: last ? last.hash : sha256(GENESIS)
    };
    row.hash = sha256(fields(row));
    q(`INSERT INTO ops_log (id, at, actor_id, actor_name, action, target_id, target_name, summary, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.at, row.actor_id, row.actor_name, row.action, row.target_id, row.target_name, row.summary, row.detail, row.prev_hash, row.hash);
    return row;
  }

  function dto(r) {
    let detail = {};
    try { detail = JSON.parse(r.detail); } catch { /* kept as text below */ }
    return {
      id: r.id, at: r.at, jst: jst(r.at), actor: { id: r.actor_id, name: r.actor_name }, action: r.action,
      target: r.target_id ? { id: r.target_id, name: r.target_name } : null, summary: r.summary, detail, raw: r.detail,
      prevHash: r.prev_hash, hash: r.hash
    };
  }

  // newest first; `find`: words in the summary, names or action
  function list({ before = 0, find = '', limit = 200 } = {}) {
    const like = '%' + String(find || '').slice(0, 60) + '%';
    const rows = q(`SELECT * FROM ops_log WHERE id < ? AND (? = '%%' OR summary LIKE ? OR actor_name LIKE ? OR target_name LIKE ? OR action LIKE ?)
                    ORDER BY id DESC LIMIT ?`)
      .all(before > 0 ? before : Number.MAX_SAFE_INTEGER, like, like, like, like, like, Math.min(500, limit));
    return rows.map(dto);
  }

  // every row against the one before it and its own hash
  function verify() {
    let prev = sha256(GENESIS), n = 0, expectId = 1;
    for (const r of q('SELECT * FROM ops_log ORDER BY id').all()) {
      if (r.id !== expectId) return { ok: false, count: n, brokenAt: r.id, reason: `${expectId}番の記録がありません` };
      if (r.prev_hash !== prev) return { ok: false, count: n, brokenAt: r.id, reason: 'ひとつ前の記録とつながっていません' };
      if (sha256(fields(r)) !== r.hash) return { ok: false, count: n, brokenAt: r.id, reason: '記録の内容が書き換えられています' };
      prev = r.hash;
      n++;
      expectId++;
    }
    return { ok: true, count: n };
  }

  return { add, list, verify, dto };
}
