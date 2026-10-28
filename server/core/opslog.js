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
import { pageLimit } from './errors.js';

const GENESIS = 'TWO STATE ops log';

export const LOG_KINDS = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
const PLAYER = ['pay_order', 'pay_paid', 'pay_slip', 'pay_unpaid', 'pay_refund'];
const SECURITY = ['login_fail', 'login_lock', 'login_burst', 'patrol_alert', 'patrol_notice', 'patrol_clear', 'staff_name_reused', 'dev_code_fail', 'dev_code_set', 'dev_code_change', 'ops_grant', 'ops_revoke', 'ops_restore', 'viewer_grant', 'viewer_revoke', 'pay_bad_signature', 'pay_unknown',
  'pay_review', 'log_kept', 'account_delete', 'account_purge'];
export function kindOf(action) {
  const a = String(action || '');
  if (a.startsWith('vault_')) return 'vault';
  // the emergency stop and the lockdown (server/core/emergency.js)
  if (a.startsWith('emergency_') || a.startsWith('lockdown') || a === 'filter_block') return 'emergency';
  // the security shield's blocks and the security base's messages (/sec/)
  if (SECURITY.includes(a) || a.startsWith('shield_') || a.startsWith('sec_') || a.startsWith('admin:') || a.startsWith('backup_') || a.startsWith('watch_') || a.startsWith('pk_')) return 'security';
  if (PLAYER.includes(a) || a.startsWith('player_')) return 'player';
  return 'operator';
}
// the same in SQL (the actions are ours: no quotes in them)
const list = (a) => a.map((x) => `'${x}'`).join(', ');
const IS = {
  vault: "substr(action, 1, 6) = 'vault_'",
  // (a name that begins so, written as a range of names: the same rows, and the index on the action can be used)
  emergency: "((action >= 'emergency_' AND action < 'emergency`') OR (action >= 'lockdown' AND action < 'lockdowo') OR action = 'filter_block')",
  security: `(action IN (${list(SECURITY)}) OR substr(action, 1, 7) = 'shield_' OR substr(action, 1, 4) = 'sec_' OR substr(action, 1, 6) = 'admin:' OR substr(action, 1, 7) = 'backup_' OR substr(action, 1, 6) = 'watch_' OR substr(action, 1, 3) = 'pk_')`,
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
// a row's own hash, and where the chain starts: for whoever holds a copy of the rows outside the table (server/core/stele.js)
export const rowHash = (r) => sha256(fields(r));
export const GENESIS_HASH = sha256(GENESIS);

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
    try {
      q(`INSERT INTO ops_log (id, at, actor_id, actor_name, action, target_id, target_name, summary, detail, prev_hash, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(r.id, r.at, r.actor_id, r.actor_name, r.action, r.target_id, r.target_name, r.summary, r.detail, r.prev_hash, r.hash);
    } catch (e) {
      // The row could not be written (a full or damaged database). It is told to the host's own record first (a file that can only
      // be added to; Workers Logs), whole, so it is not lost with the failure; then the failure goes on (the action it belongs to
      // does not happen when it is inside the same transaction, and it is raised either way).
      try { if (anchor && anchor.spill) anchor.spill(r); } catch { /* the failure below is the one that matters */ }
      console.error(`[ops-log:spill] ${JSON.stringify(r)}`);
      throw e;
    }
    // copies outside the table
    if (anchor) {
      try { anchor.put({ id: r.id, hash: r.hash, at: r.at }); } catch (e) { console.error('ops log anchor failed', e); }
      // (a host that keeps every row whole where the database cannot reach: server/node/stele-files.js)
      if (anchor.mirror) { try { anchor.mirror(r); } catch (e) { console.error('ops log mirror failed', e); } }
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

  // A line for a list: no detail, no hashes (they are fetched, one line at a time, when a line is
  // opened). A vault line carries where it was (`place`), so the list can still lead to it.
  function lean(r) {
    const out = { id: r.id, at: r.at, jst: jst(r.at), actor: { id: r.actor_id, name: r.actor_name }, action: r.action, kind: kindOf(r.action), target: r.target_id ? { id: r.target_id, name: r.target_name } : null, summary: r.summary };
    if (r.action.startsWith('vault_')) {
      try { const d = JSON.parse(r.detail); out.place = { space: typeof d.space === 'string' ? d.space : '', folder: typeof d.folder === 'string' ? d.folder : '' }; } catch { out.place = { space: '', folder: '' }; }
    }
    return out;
  }
  // newest first; `find`: words in the summary, names or action; `kind`: one of LOG_KINDS; `slim`: lines for a list
  // `since`: only the lines after that number (what a page that has the older ones asks for), from the account
  function list({ before = 0, since = 0, find = '', kind = '', limit = 200, slim = false } = {}) {
    limit = pageLimit(limit, 200, 500);
    const shape = slim ? lean : dto;
    // "#123": that line (a log line quoted in the 運営チャット)
    const one = /^#(\d{1,15})$/.exec(String(find || '').trim());
    if (one) {
      const r = q(`SELECT * FROM ops_log WHERE id = ? ${IS[kind] ? `AND ${IS[kind]}` : ''}`).get(Number(one[1]));
      return r ? [shape(r)] : [];
    }
    // the first page of a kind, with nothing searched for: the account has it
    if (!String(find || '') && !(before > 0) && limit <= RING) {
      const lines = newest(IS[kind] ? kind : '');
      return (since > 0 ? lines.filter((r) => r.id > since) : lines).slice(0, Math.max(0, limit)).map(shape);
    }
    const like = '%' + String(find || '').slice(0, 60) + '%';
    const only = IS[kind] ? `AND ${IS[kind]}` : '';
    const rows = q(`SELECT * FROM ops_log WHERE id < ? ${only} AND (? = '%%' OR summary LIKE ? OR actor_name LIKE ? OR target_name LIKE ? OR action LIKE ?)
                    ORDER BY id DESC LIMIT ?`)
      .all(before > 0 ? before : Number.MAX_SAFE_INTEGER, like, like, like, like, like, Math.min(500, limit));
    return rows.map(shape);
  }
  /* ---- a running account of the log ----
     The log only ever grows (nothing in it is changed or removed), and it is long: counting it, or looking through it for the newest line of a
     rare kind, reads every row, again each time the page asks (it asks every few seconds), and the whole game waits meanwhile. So the account
     is kept: how many rows of each kind, about how big, and the newest lines of each kind; each time it is asked it reads only the rows that
     were added since the last time (the newest row's number and hash say whether anything else happened to the table, and then it starts again). */
  const RING = 200, REBUILD_MS = 24 * 3600000, FAR = 5000, KINDS = [...Object.keys(LOG_KINDS), 'activity'];
  const isActivity = (a) => ACTIVITY.includes(a) || a.startsWith('ban:');
  const classes = (a) => (isActivity(a) ? [kindOf(a), 'activity'] : [kindOf(a)]);
  let ledger = null;
  const SUMS = 'COUNT(*) AS n, COALESCE(SUM(length(detail) + length(summary) + 160), 0) AS b';
  function look() {
    const now = Date.now();
    const tail = q('SELECT id, hash FROM ops_log ORDER BY id DESC LIMIT 1').get() || { id: 0, hash: '' };
    if (ledger && (now - ledger.at > REBUILD_MS || tail.id < ledger.upTo || tail.id - ledger.upTo > FAR || (tail.id === ledger.upTo && tail.hash !== ledger.hash))) ledger = null;
    if (ledger && tail.id === ledger.upTo) return ledger;
    if (!ledger) {
      ledger = { at: now, upTo: tail.id, hash: tail.hash, rows: 0, bytes: 0, counts: Object.fromEntries(KINDS.map((k) => [k, 0])), recent: {} };
      for (const r of q(`SELECT action, ${SUMS} FROM ops_log WHERE id <= ? GROUP BY action`).all(tail.id)) {
        ledger.rows += r.n; ledger.bytes += r.b;
        for (const k of classes(r.action)) ledger.counts[k] += r.n;
      }
      return ledger;
    }
    // only what came after
    for (const r of q(`SELECT action, ${SUMS} FROM ops_log WHERE id > ? AND id <= ? GROUP BY action`).all(ledger.upTo, tail.id)) {
      ledger.rows += r.n; ledger.bytes += r.b;
      for (const k of classes(r.action)) ledger.counts[k] += r.n;
    }
    if (Object.keys(ledger.recent).length) {
      for (const r of q('SELECT * FROM ops_log WHERE id > ? AND id <= ? ORDER BY id').all(ledger.upTo, tail.id)) {
        for (const k of ['', ...classes(r.action)]) {
          const lines = ledger.recent[k];
          if (lines) { lines.unshift(r); if (lines.length > RING) lines.pop(); }
        }
      }
    }
    ledger.upTo = tail.id; ledger.hash = tail.hash;
    return ledger;
  }
  // the newest lines of a kind ('' for all), from the account: the first look at a kind reads the table once
  function newest(kind) {
    const L = look();
    if (!L.recent[kind]) L.recent[kind] = q(`SELECT * FROM ops_log ${IS[kind] ? `WHERE ${IS[kind]}` : ''} ORDER BY id DESC LIMIT ?`).all(RING);
    return L.recent[kind];
  }

  // some lines in full, by number (at most 100): the line that was opened, or the lines of a report
  function many(ids) {
    const want = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))].slice(0, 100);
    if (!want.length) return [];
    return q(`SELECT * FROM ops_log WHERE id IN (${want.map(() => '?').join(',')}) ORDER BY id DESC`).all(...want).map(dto);
  }
  // how many of each kind, and how big the log is (from the account)
  const counts = () => ({ ...look().counts });
  const size = () => { const L = look(); return { rows: L.rows, bytes: L.bytes }; };
  // the same by reading every row (for the tests: the account must equal it)
  function scan() {
    const out = {};
    for (const k of KINDS) out[k] = q(`SELECT COUNT(*) AS n FROM ops_log WHERE ${IS[k]}`).get().n;
    const t = q(`SELECT ${SUMS} FROM ops_log`).get();
    return { counts: out, rows: t.n, bytes: t.b };
  }

  // every row against the one before it and its own hash, and the newest
  // row against the copy kept outside the table. `from`: { id, hash } of a row
  // looked over before (the patrol's checkpoint): only the rows after it are read,
  // in pages (the log may be long), after the row itself is seen to be unchanged.
  // The result carries `last` ({ id, hash }) to start the next look from.
  async function verify(from = null) {
    let prev = sha256(GENESIS), n = 0, expectId = 1;
    const kept = anchor ? await anchor.get().catch(() => null) : null;
    if (from && from.id > 0) {
      const row = q('SELECT hash FROM ops_log WHERE id = ?').get(from.id);
      if (!row || row.hash !== from.hash) return { ok: false, count: 0, brokenAt: from.id, reason: '前に確かめた記録が、書き換えられたか、なくなっています' };
      prev = from.hash;
      n = from.id;
      expectId = from.id + 1;
    }
    let last = from && from.id > 0 ? { id: from.id, hash: from.hash } : null;
    for (let after = expectId - 1; ;) {
      const page = q('SELECT * FROM ops_log WHERE id > ? ORDER BY id LIMIT 1000').all(after);
      if (!page.length) break;
      for (const r of page) {
        if (r.id !== expectId) return { ok: false, count: n, brokenAt: r.id, reason: `${expectId}番の記録がありません` };
        if (r.prev_hash !== prev) return { ok: false, count: n, brokenAt: r.id, reason: 'ひとつ前の記録とつながっていません' };
        if (sha256(fields(r)) !== r.hash) return { ok: false, count: n, brokenAt: r.id, reason: '記録の内容が書き換えられています' };
        prev = r.hash;
        n++;
        expectId++;
        last = { id: r.id, hash: r.hash };
      }
      after = page[page.length - 1].id;
    }
    if (kept) {
      const row = q('SELECT hash FROM ops_log WHERE id = ?').get(kept.id);
      if (!row) return { ok: false, count: n, brokenAt: kept.id, reason: `${kept.id}番までの記録があったはずが、${n}番までしかありません（後ろが消されています）` };
      if (row.hash !== kept.hash) return { ok: false, count: n, brokenAt: kept.id, reason: '記録が最初から作り直されています（外に控えたハッシュと違います）' };
    }
    return { ok: true, count: n, last, anchor: kept ? { id: kept.id, at: kept.at } : null };
  }

  return { add, list, many, counts, size, scan, verify, dto, keep, all };
}
