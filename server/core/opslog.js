// The operators' log: everything done through the operator site or the
// official bot that reaches anyone outside (messages, money, bans, reports,
// passwords, 引き継ぎコード …) and every DEV release going live, with all
// that is known about it. It can only grow: the database refuses to change
// or delete its rows (triggers in db.js), the server has no way to, a
// restore from a backup or to an earlier time keeps every row (keep():
// admin.js, server/node/admin-cli.js), and each row carries the hash of the
// one before it, so a row changed or taken out behind the server's back
// shows in verify(). Outside the table, the host keeps the newest row's
// number and hash where SQL cannot reach (`anchor`: Cloudflare's own storage
// of the object, a file here), and every row's hash also goes to the host's
// logs (Workers Logs): a chain rebuilt from the start, or rows cut off its
// end, no longer match them.
// Each entry has a kind: プレイヤー (what players did), 運営 (what the
// operators did), セキュリティ, 保管庫 and 緊急. It follows from the action,
// so the hash covers it too.
import { sha256 } from './auth.js';

const GENESIS = 'TWO STATE ops log';

export const LOG_KINDS = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
const PLAYER = ['pay_order', 'pay_paid', 'pay_slip', 'pay_unpaid', 'pay_refund'];
const SECURITY = ['dev_code_fail', 'dev_code_set', 'dev_code_change', 'ops_grant', 'ops_revoke', 'ops_restore', 'viewer_grant', 'viewer_revoke', 'pay_bad_signature', 'pay_unknown',
  'pay_review', 'log_kept', 'account_delete', 'account_purge'];
export function kindOf(action) {
  const a = String(action || '');
  if (a.startsWith('vault_')) return 'vault';
  // the emergency stop and the lockdown (server/core/emergency.js)
  if (a.startsWith('emergency_') || a.startsWith('lockdown') || a === 'filter_block') return 'emergency';
  // the security shield's blocks and the security base's messages (/sec/)
  if (SECURITY.includes(a) || a.startsWith('shield_') || a.startsWith('sec_') || a.startsWith('admin:') || a.startsWith('backup_')) return 'security';
  if (PLAYER.includes(a) || a.startsWith('player_')) return 'player';
  return 'operator';
}
// the same in SQL (the actions are ours: no quotes in them)
const list = (a) => a.map((x) => `'${x}'`).join(', ');
const IS = {
  vault: "substr(action, 1, 6) = 'vault_'",
  emergency: "(substr(action, 1, 10) = 'emergency_' OR substr(action, 1, 8) = 'lockdown' OR action = 'filter_block')",
  security: `(action IN (${list(SECURITY)}) OR substr(action, 1, 7) = 'shield_' OR substr(action, 1, 4) = 'sec_' OR substr(action, 1, 6) = 'admin:' OR substr(action, 1, 7) = 'backup_')`,
  player: `(action IN (${list(PLAYER)}) OR substr(action, 1, 7) = 'player_')`
};
IS.operator = `NOT (${IS.vault} OR ${IS.emergency} OR ${IS.security} OR ${IS.player})`;
// プレイヤーアクティビティ (a view across the kinds, not a kind of its own):
// what happened to players' accounts — added, deleted, their data gone,
// punished or let go, their chat stopped or freed, their password or code
// reset, rights given or taken, and the admin commands on them
export const ACTIVITY = ['player_register', 'account_delete', 'account_purge', 'chat_unban', 'filter_block', 'device_ok', 'password', 'recovery',
  'ops_grant', 'ops_revoke', 'viewer_grant', 'viewer_revoke', 'admin:ban', 'admin:unban', 'admin:rename', 'admin:grant', 'admin:password', 'admin:recovery', 'admin:logout'];
IS.activity = `(action IN (${list(ACTIVITY)}) OR substr(action, 1, 4) = 'ban:')`;

// "2026/10/20 05:31:12.345 JST"
export function jst(ms) {
  const d = new Date(ms + 9 * 3600000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)} JST`;
}

const fields = (r) => JSON.stringify([r.id, r.at, r.actor_id, r.actor_name, r.action, r.target_id, r.target_name, r.summary, r.detail, r.prev_hash]);

// anchor: { put(row), get() -> Promise({ id, hash, at } | null) } from the host (or none);
// onAdd(row): told of each new entry once it is written (the Discord notices)
export function createOpsLog({ q, anchor = null, onAdd = null }) {
  // who did it from where: the request as far as it is known
  function requestInfo(req) {
    if (!req) return {};
    const h = (k) => String((req.header && req.header(k)) || '').slice(0, 300);
    return { ip: req.ip || '', userAgent: h('user-agent'), device: h('x-device').slice(0, 120), origin: h('origin'), referer: h('referer') };
  }

  // One entry: actor and target are user rows (or null: actorName, or システム), detail anything JSON.
  function add({ actor = null, actorName = '', action, target = null, summary, detail = {}, req = null }) {
    const at = Date.now();
    const last = q('SELECT id, hash FROM ops_log ORDER BY id DESC LIMIT 1').get();
    const row = {
      id: last ? last.id + 1 : 1,
      at,
      actor_id: actor ? actor.id : 0,
      actor_name: actor ? actor.name : actorName || 'システム',
      action,
      target_id: target ? target.id : 0,
      target_name: target ? target.name : '',
      summary,
      detail: JSON.stringify({ time: { ms: at, iso: new Date(at).toISOString(), jst: jst(at) }, request: requestInfo(req), ...detail }),
      prev_hash: last ? last.hash : sha256(GENESIS)
    };
    row.hash = sha256(fields(row));
    insert(row);
    if (onAdd) {
      try { onAdd(row); } catch (e) { console.error('ops log notice failed', e); }
    }
    return row;
  }
  function insert(r) {
    q(`INSERT INTO ops_log (id, at, actor_id, actor_name, action, target_id, target_name, summary, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.id, r.at, r.actor_id, r.actor_name, r.action, r.target_id, r.target_name, r.summary, r.detail, r.prev_hash, r.hash);
    // copies outside the table
    if (anchor) {
      try { anchor.put({ id: r.id, hash: r.hash, at: r.at }); } catch (e) { console.error('ops log anchor failed', e); }
    }
  }

  // Rows from elsewhere (a backup, or this log as it was before the database
  // went back in time): the ones this log has are skipped, the ones that
  // continue it are added as they were, and any others are kept whole inside
  // one new entry, so no row is ever lost and the chain stays whole.
  const COLS = ['id', 'at', 'actor_id', 'actor_name', 'action', 'target_id', 'target_name', 'summary', 'detail', 'prev_hash', 'hash'];
  function keep(rows, { why = '', actorName = '' } = {}) {
    const list = (Array.isArray(rows) ? rows : []).filter((r) => r && COLS.every((c) => c in r)).sort((a, b) => a.id - b.id);
    let added = 0;
    const kept = [];
    for (const r of list) {
      const have = q('SELECT hash FROM ops_log WHERE id = ?').get(r.id);
      if (have && have.hash === r.hash) continue;
      const last = q('SELECT id, hash FROM ops_log ORDER BY id DESC LIMIT 1').get();
      if (!have && r.id === (last ? last.id : 0) + 1 && r.prev_hash === (last ? last.hash : sha256(GENESIS)) && sha256(fields(r)) === r.hash) {
        insert(r);
        added++;
      } else {
        kept.push(r);
      }
    }
    if (kept.length) {
      add({
        actorName, action: 'log_kept',
        summary: `${why || '記録の復元'}：この記録とつながらない運営ログ ${kept.length}件（#${kept[0].id}〜#${kept[kept.length - 1].id}）を、消さずにこの記録の中に保存`,
        detail: { why, entries: kept }
      });
    }
    return { added, kept: kept.length };
  }
  const all = () => q('SELECT * FROM ops_log ORDER BY id').all();

  function dto(r) {
    let detail = {};
    try { detail = JSON.parse(r.detail); } catch { /* kept as text below */ }
    return {
      id: r.id, at: r.at, jst: jst(r.at), actor: { id: r.actor_id, name: r.actor_name }, action: r.action, kind: kindOf(r.action),
      target: r.target_id ? { id: r.target_id, name: r.target_name } : null, summary: r.summary, detail, raw: r.detail,
      prevHash: r.prev_hash, hash: r.hash
    };
  }

  // newest first; `find`: words in the summary, names or action; `kind`: one of LOG_KINDS
  function list({ before = 0, find = '', kind = '', limit = 200 } = {}) {
    // "#123": that line (a log line quoted in the 運営チャット)
    const one = /^#(\d{1,15})$/.exec(String(find || '').trim());
    if (one) {
      const r = q(`SELECT * FROM ops_log WHERE id = ? ${IS[kind] ? `AND ${IS[kind]}` : ''}`).get(Number(one[1]));
      return r ? [dto(r)] : [];
    }
    const like = '%' + String(find || '').slice(0, 60) + '%';
    const only = IS[kind] ? `AND ${IS[kind]}` : '';
    const rows = q(`SELECT * FROM ops_log WHERE id < ? ${only} AND (? = '%%' OR summary LIKE ? OR actor_name LIKE ? OR target_name LIKE ? OR action LIKE ?)
                    ORDER BY id DESC LIMIT ?`)
      .all(before > 0 ? before : Number.MAX_SAFE_INTEGER, like, like, like, like, like, Math.min(500, limit));
    return rows.map(dto);
  }
  // how many of each kind
  function counts() {
    const out = {};
    for (const k of [...Object.keys(LOG_KINDS), 'activity']) out[k] = q(`SELECT COUNT(*) AS n FROM ops_log WHERE ${IS[k]}`).get().n;
    return out;
  }

  // every row against the one before it and its own hash, and the newest
  // row against the copy kept outside the table
  async function verify() {
    let prev = sha256(GENESIS), n = 0, expectId = 1;
    const kept = anchor ? await anchor.get().catch(() => null) : null;
    let anchored = null;
    for (const r of q('SELECT * FROM ops_log ORDER BY id').all()) {
      if (r.id !== expectId) return { ok: false, count: n, brokenAt: r.id, reason: `${expectId}番の記録がありません` };
      if (r.prev_hash !== prev) return { ok: false, count: n, brokenAt: r.id, reason: 'ひとつ前の記録とつながっていません' };
      if (sha256(fields(r)) !== r.hash) return { ok: false, count: n, brokenAt: r.id, reason: '記録の内容が書き換えられています' };
      if (kept && r.id === kept.id) anchored = r.hash === kept.hash;
      prev = r.hash;
      n++;
      expectId++;
    }
    if (kept && anchored === null) return { ok: false, count: n, brokenAt: kept.id, reason: `${kept.id}番までの記録があったはずが、${n}番までしかありません（後ろが消されています）` };
    if (kept && !anchored) return { ok: false, count: n, brokenAt: kept.id, reason: '記録が最初から作り直されています（外に控えたハッシュと違います）' };
    return { ok: true, count: n, anchor: kept ? { id: kept.id, at: kept.at } : null };
  }

  return { add, list, counts, verify, dto, keep, all };
}
