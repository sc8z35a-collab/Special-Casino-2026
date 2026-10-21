// The vault: big files (3D models and the like, up to a few GB) kept on the
// game's own server, to fetch from anywhere. Two kinds, in one store with one
// room for all of them (VAULT_MAX_MB):
//  - the developer's own (開発者専用保管庫): only the developer's account
//    opens it, and only with the developer code (server/core/devcode.js: the
//    same counted and logged tries) for a signed ticket good for 30 minutes;
//  - the vaults operators share (共有保管庫), one for every two operators
//    ('p:<a>:<b>', their account ids, a < b). Private: the two of them use it
//    from the operator site (their login is enough), and the developer, with
//    their vault open, looks into the others' too (no changes). What one
//    operator keeps there (the files they sent, in all their shared vaults)
//    is 1GB at most (VAULT_FREE_MB) until they ask the developer for more; an
//    approval always comes with the limit the developer sets.
// A file comes in pieces (1 MiB, or bigger with a bucket: VAULT_PIECE_MB),
// each checked against its SHA-256 as it arrives (a broken upload carries on
// where it stopped); it is whole once every piece is in, and its fingerprint
// is the SHA-256 of its pieces' hashes in order.
// A 3D model gets, from the operator site (ops/vault3d.js, made in the
// browser), a small picture of it from four sides, what is in it, and a light
// copy (a file of its own whose `parent` is the model).
// Files sit in folders (folders in folders too), each vault its own; files
// and folders move or go several at once (the ones checked on the site). The
// developer can also make a read-only link for one file of their vault, or for
// the whole of it (good for 1 to 72 hours, stopped at any time; only the hash
// of its secret is kept) to fetch it somewhere else; no link ever reaches a
// shared vault. A link made for an AI also labels each file the AI takes,
// takes the AI's own labels (what it did with a file), and once the AI has put
// a file in the game, moves it to 実装済み: out of every link at once, so used
// and unused material never mix, but kept (the developer can bring it back).
// Nothing in a vault is ever deleted on its own: only the people who use it
// delete.
// Short messages on a file last a day, 3, 7, 30 or with no end; an AI's link
// shows them while they last (an old one stays on the operator site, marked
// as over).
// Every operator reads the log: it names the developer's files, but of a
// shared vault (for the two of them and the developer) only how much.
//
// Where the pieces are: in an R2 bucket when the host has one (Cloudflare:
// the binding VAULT in wrangler.jsonc; 50GB by default), else in the database
// (1GB, 3GB on Workers Paid). In the bucket a piece is `vault/<file id>/<n>` with its SHA-256 kept
// beside it, so no database row is written per piece (the free plan's daily
// row writes stay with the players), and the operator site asks for the file
// to be finished once every piece is sent. Pieces kept in the database before
// the bucket came move into it while the vault is open (POST
// /api/vault/to-bucket, a few at a time).
//
// Files are data only: they leave as base64 inside JSON, never as a page,
// and the server never opens or runs them. They are not part of the backups
// (they are big, and the developer has the originals).
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';
import { Limiter } from './ratelimit.js';

export const CHUNK = 1024 * 1024;
const TICKET_MS = 30 * 60000;
export const LINK_HOURS = [1, 6, 24, 72];
// all files together and one file (MB), and the biggest piece (MiB): with a
// bucket, and in the database (a database value holds 2 MB at most) on
// Workers Paid and on the free plan
const SIZES = { bucket: { all: 51200, file: 2000, piece: 16 }, paid: { all: 3072, file: 2000, piece: 1 }, db: { all: 1024, file: 300, piece: 1 } };
// what one operator keeps in the shared vaults without the developer's approval (MB)
const FREE_MB = 1024;
const ID_RE = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TOKEN_RE = /^[\w-]{43}$/;
// a shared vault: its two operators' account ids, the smaller first
const SPACE_RE = /^p:(\d{1,15}):(\d{1,15})$/;
// a model's picture (a WebP or JPEG data URL) and what is in it (JSON)
const PREVIEW_MAX = 600 * 1024;
const PREVIEW_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const INFO_MAX = 8 * 1024;
// a link to every file (of the developer's vault)
const ALL = '*';
// folders: how deep, how many in one vault; files and folders moved or
// deleted at once; pieces moved into the bucket at once
const FOLDER_DEPTH = 8;
const FOLDERS_MAX = 500;
const MOVE_MAX = 500;
const TO_BUCKET = 16;
// labels kept on a file; a short message: how long it lasts (days, 0: no end), its length, how many on a file
const LABELS_MAX = 30;
export const NOTE_DAYS = [1, 3, 7, 30, 0];
const NOTE_MAX = 500;
const NOTES_MAX = 50;
// why an operator asks for more room (characters)
const REASON_MAX = 500;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// 1GB, 1.5GB, 12MB, 300KB (nothing: 0MB)
const mb = (n) => (!n ? '0MB' : n >= 1073741824 ? `${(n / 1073741824).toFixed(n < 10737418240 ? 1 : 0)}GB`
  : n >= 1048576 ? `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`).replace(/\.0(?=[GM]B$)/, '');
// a few names for the log (the rest counted)
const some = (names) => names.slice(0, 5).join('、') + (names.length > 5 ? `ほか${names.length - 5}件` : '');

// a file name to show and to save as: no folders, no control characters
function cleanName(raw) {
  const s = Array.from(String(raw ?? '').split(/[/\\]/).pop().normalize('NFC')
    .replace(CONTROL, '')
    .replace(/[/\\]/g, '_').replace(/^\.+/, '').trim()).slice(0, 200).join('');
  return s || 'file';
}

// a folder's name: one line, no slashes
function folderName(raw) {
  const s = Array.from(String(raw ?? '').normalize('NFC').replace(CONTROL, '').replace(/[/\\]/g, '_').trim()).slice(0, 60).join('');
  if (!s || /^\.+$/.test(s)) throw new ApiError(400, 'bad_name', 'フォルダの名前を入れてください');
  return s;
}

// the ids a request names (each once, so many at most)
const idsOf = (raw) => [...new Set(Array.isArray(raw) ? raw.map(String) : [])].slice(0, MOVE_MAX);

// blobs (from the host, or null): put(key, bytes, sha256), get(key) ->
// { bytes, sha256 } | null, list(prefix) -> [{ key, sha256 }], del(keys);
// ops: the operator site (who the operators are); onDb(bytes): pieces
// written into the database (the emergency stop does not count them)
export function createVault({ q, tx, config, secret, opsLog, isDeveloper, devCode, ops, getUser, blobs = null, onDb = () => {} }) {
  const KEY = crypto.createHash('sha256').update(`${secret}:vault-ticket`).digest();
  const size = SIZES[blobs ? 'bucket' : config.plan === 'paid' ? 'paid' : 'db'];
  const maxBytes = (config.vaultMaxMb ?? size.all) * 1048576, fileBytes = (config.vaultFileMb ?? size.file) * 1048576;
  const freeBytes = (config.vaultFreeMb ?? FREE_MB) * 1048576;
  // a piece: 8 MiB in a bucket on Workers Paid (a request may work for 30 s), else 1 MiB
  const pieceBytes = Math.min(size.piece, Math.max(1, config.vaultPieceMb ?? (blobs && config.plan === 'paid' ? 8 : 1))) * CHUNK;
  // a piece as base64 inside JSON
  const pieceBody = Math.ceil(size.piece * CHUNK * 4 / 3) + 64 * 1024;
  // [a minute, burst]: tries to open it, pieces and lists (each operator), fetching with a link (an address)
  const L = { vaultOpen: [10, 5], vaultWork: [1200, 300], vaultPull: [600, 200], ...config.limits };
  const limits = { open: new Limiter(...L.vaultOpen), work: new Limiter(...L.vaultWork), pull: new Limiter(...L.vaultPull) };
  function rate(l, key) {
    if (!l.take(String(key))) throw new ApiError(429, 'rate_limited', '操作が速すぎます。少し待ってください');
  }

  const sign = (body) => crypto.createHmac('sha256', KEY).update(body).digest();
  function ticketFor(u) {
    const body = `${u.id}.${Date.now() + TICKET_MS}`;
    return `${body}.${sign(body).toString('base64url')}`;
  }
  // the developer's own ticket, unexpired
  function ticketOk(req, u) {
    const m = /^(\d{1,15})\.(\d{13})\.([\w-]{43})$/.exec(String(req.header('x-vault-ticket') || ''));
    if (!m || Number(m[1]) !== u.id || Number(m[2]) <= Date.now()) return false;
    const got = Buffer.from(m[3], 'base64url'), want = sign(`${m[1]}.${m[2]}`);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  // an operator; the developer with their ticket (403, not 401: the site
  // stays logged in, only the vault closes)
  function need(req, u) {
    ops.need(u);
    if (isDeveloper(u) && !ticketOk(req, u)) throw new ApiError(403, 'vault_locked', '保管庫が閉じています。開発者コードを入力して開いてください');
    rate(limits.work, u.id);
  }
  const developerOnly = (u, what) => {
    if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', `${what}は開発者だけができます`);
  };

  /* -------------------------------------------------------------- vaults --- */
  // the two operators of a shared vault (null: the developer's own, or no vault)
  function membersOf(space) {
    const m = SPACE_RE.exec(String(space || ''));
    return m && Number(m[1]) < Number(m[2]) ? [Number(m[1]), Number(m[2])] : null;
  }
  const pairOf = (a, b) => (a < b ? `p:${a}:${b}` : `p:${b}:${a}`);
  const otherOf = (m, id) => (m[0] === id ? m[1] : m[0]);
  const operatorId = (id) => { const p = getUser(id); return !!p && ops.isOperator(p); };
  // Who sees a vault: the developer every one (their own, and each shared
  // one); an operator the shared ones they are in. To anyone else it is not there.
  function sees(u, space) {
    const m = membersOf(space);
    if (isDeveloper(u)) return !space || !!m;
    return !!m && m.includes(u.id);
  }
  // `u` sees the vault (else `missing()`), and as `how` says changes what is
  // in it ('change') or puts a new file in ('add'): only in their own (the
  // developer's vault, a shared one they are in), the developer only looks
  // into the others'. A new file needs the other one to be an operator still.
  function check(u, space, how, missing) {
    if (!sees(u, space)) throw missing();
    const m = membersOf(space);
    if (!how || !m) return;
    if (!m.includes(u.id)) throw new ApiError(403, 'read_only', 'ほかの運営者どうしの共有保管庫は見るだけです（変更はできません）');
    if (how === 'add' && !operatorId(otherOf(m, u.id))) throw new ApiError(409, 'partner_gone', '相手が運営者ではなくなったため、新しいファイルは入れられません（見る・整理・削除はできます）');
  }
  const noFile = () => new ApiError(404, 'no_file', 'ファイルが見つかりません');
  const noFolder = () => new ApiError(404, 'no_folder', 'フォルダが見つかりません');
  // the vault a request names: '' (the developer's own) or a shared one
  function spaceFor(u, raw, how = '') {
    const space = String(raw ?? '');
    if (space && !membersOf(space)) throw new ApiError(400, 'bad_space', '保管庫の指定が正しくありません');
    check(u, space, how, () => (space ? new ApiError(404, 'no_space', 'この共有保管庫は見られません')
      : new ApiError(403, 'not_developer', '開発者専用保管庫は開発者のアカウントだけが使えます')));
    return space;
  }
  // several things at once come from one vault
  function oneVault(rows) {
    if (rows.some((x) => x.space !== rows[0].space)) throw new ApiError(400, 'mixed', '別々の保管庫のものは一度に扱えません');
    return rows[0].space;
  }
  // where, for the log: 保管庫 (the developer's) or the shared one of two operators
  function whereName(space) {
    const m = membersOf(space);
    return m ? `共有保管庫（${m.map((id) => (getUser(id) || { name: '?' }).name).join('⇄')}）` : '保管庫';
  }
  // a file in the log: its name in the developer's vault, only its size in a shared one
  const what = (f) => (f.space ? `ファイル（${mb(f.size)}）` : `「${f.name}」（${mb(f.size)}）`);
  const fileNote = (f) => ({ file: f.id, ...(f.space ? { space: f.space } : { name: f.name }), size: f.size });

  const fileRow = (id) => (ID_RE.test(String(id || '')) ? q('SELECT * FROM vault_files WHERE id = ?').get(String(id)) : null);
  // a file `u` sees (and may change or add to, as `how` says); any other is not there
  function theFile(u, id, how = '') {
    const f = fileRow(id);
    if (!f) throw noFile();
    check(u, f.space, how, noFile);
    return f;
  }
  // all the files together: the developer's vault and the shared ones are one room
  const used = () => q('SELECT COALESCE(SUM(size), 0) AS n FROM vault_files').get().n;
  // what one operator keeps in the shared vaults (the files they sent), and
  // what they may: 1GB, or the limit the developer set approving more
  const keeps = (id) => q("SELECT COALESCE(SUM(size), 0) AS n FROM vault_files WHERE created_by = ? AND space != ''").get(id).n;
  const quotaOf = (id) => q('SELECT * FROM vault_quotas WHERE user_id = ?').get(id);
  const limitOf = (id) => (quotaOf(id) || { bytes: freeBytes }).bytes;
  // pieces still in the database (moving into the bucket)
  const inDb = () => (blobs ? q('SELECT COUNT(*) AS n FROM vault_chunks').get().n : 0);
  function who(id) {
    const p = getUser(id);
    return p ? { id: p.id, name: p.name, avatar: p.avatar } : { id, name: '?', avatar: '' };
  }
  function infoOf(f) {
    try { return f.info ? JSON.parse(f.info) : null; } catch { return null; }
  }
  // what an AI did with a file: [{ at, kind: download | ai | implemented | restore, text }]
  function labelsOf(f) {
    try { const a = f.labels ? JSON.parse(f.labels) : []; return Array.isArray(a) ? a : []; } catch { return []; }
  }
  function addLabel(f, kind, text) {
    const list = labelsOf(fileRow(f.id) || f).concat({ at: Date.now(), kind, text: String(text || '') }).slice(-LABELS_MAX);
    q('UPDATE vault_files SET labels = ? WHERE id = ?').run(JSON.stringify(list), f.id);
  }
  function linksOf(fileId, now) {
    const links = q('SELECT until, uses, revoked, created_at FROM vault_links WHERE file_id = ? ORDER BY created_at DESC').all(fileId);
    const live = links.filter((l) => !l.revoked && l.until > now);
    return { live: live.length, until: live.reduce((m, l) => Math.max(m, l.until), 0), uses: links.reduce((s, l) => s + l.uses, 0) };
  }
  const notesOf = (f) => q('SELECT * FROM vault_notes WHERE file_id = ? ORDER BY id').all(f.id).map((n) => ({ id: n.id, text: n.body, at: n.created_at, until: n.until, by: who(n.by_id) }));
  const live = (n, now) => !n.until || n.until > now;
  function fileDto(f, now = Date.now()) {
    return {
      id: f.id, name: f.name, type: f.type, note: f.note, size: f.size, chunks: f.chunks, piece: f.piece, received: f.received, done: !!f.done_at,
      sha256: f.sha256, createdAt: f.created_at, doneAt: f.done_at, parent: f.parent || '', folder: f.folder || '', info: infoOf(f), preview: !!f.preview,
      labels: labelsOf(f), implementedAt: f.implemented_at, links: linksOf(f.id, now), notes: notesOf(f), space: f.space, by: who(f.created_by)
    };
  }
  // what a link shows of a file (no notes' writers, no links)
  function pullDto(f) {
    const light = q("SELECT * FROM vault_files WHERE parent = ? AND done_at > 0 ORDER BY created_at DESC LIMIT 1").get(f.id);
    return {
      id: f.id, name: f.name, type: f.type, size: f.size, chunks: f.chunks, chunk: f.piece, sha256: f.sha256, folder: f.folder || '', sentAt: f.created_at, doneAt: f.done_at,
      labels: labelsOf(f), info: infoOf(f), preview: !!f.preview, notes: notesOf(f).filter((n) => live(n, Date.now())).map(({ text, at, until }) => ({ text, at, until })),
      light: light ? { id: light.id, name: light.name, size: light.size, chunks: light.chunks, chunk: light.piece, sha256: light.sha256 } : null
    };
  }
  // a vault as the site shows it: whose, and what `u` may do in it
  function spaceDto(u, space) {
    const m = membersOf(space);
    if (!m) return { id: '', shared: false, mine: true, write: true, add: true, members: [] };
    const mine = m.includes(u.id);
    return { id: space, shared: true, mine, write: mine, add: mine && operatorId(otherOf(m, u.id)), members: m.map((id) => ({ ...who(id), operator: operatorId(id), developer: isDeveloper(getUser(id)) })) };
  }

  /* -------------------------------------------------------------- pieces --- */
  const pieceKey = (fileId, n) => `vault/${fileId}/${n}`;
  // every piece of a file that is in: n -> its SHA-256 (the database's, then the bucket's)
  async function piecesOf(f) {
    const have = new Map(q('SELECT n, sha256 FROM vault_chunks WHERE file_id = ?').all(f.id).map((r) => [r.n, r.sha256]));
    if (blobs) {
      for (const o of await blobs.list(`vault/${f.id}/`)) {
        const n = Number(o.key.slice(o.key.lastIndexOf('/') + 1));
        if (Number.isInteger(n) && n >= 0 && n < f.chunks && HEX64.test(o.sha256 || '') && !have.has(n)) have.set(n, o.sha256);
      }
    }
    return have;
  }
  // the piece numbers not in yet, as ranges [[from, to], …]
  function gaps(f, have) {
    const out = [];
    for (let n = 0; n < f.chunks; n++) {
      if (have.has(n)) continue;
      const last = out[out.length - 1];
      if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
    }
    return out;
  }
  async function piece(f, n) {
    const c = q('SELECT n, sha256, data FROM vault_chunks WHERE file_id = ? AND n = ?').get(f.id, n);
    if (c) return { n: c.n, sha256: c.sha256, data: c.data };
    const b = blobs ? await blobs.get(pieceKey(f.id, n)) : null;
    if (!b) throw new ApiError(404, 'no_piece', 'この部分はまだありません');
    return { n, sha256: b.sha256, data: Buffer.from(b.bytes).toString('base64') };
  }
  function pieceNo(f, raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n >= f.chunks) throw new ApiError(400, 'bad_piece', '部分の番号が正しくありません');
    return n;
  }
  // every piece in: the file's fingerprint, and it is whole
  function finish(f, digests, req, u) {
    const sum = sha(Buffer.concat(digests.map((d) => Buffer.from(d, 'hex'))));
    const done = Number(q('UPDATE vault_files SET received = ?, sha256 = ?, done_at = ? WHERE id = ? AND done_at = 0').run(f.chunks, sum, Date.now(), f.id).changes);
    if (done) opsLog.add({ actor: u, action: 'vault_upload', req, summary: `${whereName(f.space)}に${what(f)}を保存`, detail: { ...fileNote(f), chunks: f.chunks, sha256: sum } });
    return sum;
  }

  // files and their light copies leave the vault (and the bucket)
  async function remove(files) {
    const all = [...new Map(files.flatMap((f) => [f, ...q('SELECT * FROM vault_files WHERE parent = ?').all(f.id)]).map((x) => [x.id, x])).values()];
    tx(() => {
      for (const x of all) {
        q('DELETE FROM vault_chunks WHERE file_id = ?').run(x.id);
        q('DELETE FROM vault_links WHERE file_id = ?').run(x.id);
        q('DELETE FROM vault_notes WHERE file_id = ?').run(x.id);
        q('DELETE FROM vault_files WHERE id = ?').run(x.id);
      }
    });
    // (in the bucket: every piece it could have)
    if (blobs) await blobs.del(all.flatMap((x) => Array.from({ length: x.chunks }, (_, n) => pieceKey(x.id, n))));
  }
  // the vaults in figures (the operator site's サーバー tab: every operator, so no names)
  function summary() {
    const n = q("SELECT COUNT(*) AS files, COALESCE(SUM(CASE WHEN implemented_at > 0 THEN 1 ELSE 0 END), 0) AS implemented FROM vault_files WHERE parent = '' AND space = ''").get();
    const s = q("SELECT COUNT(CASE WHEN parent = '' THEN 1 END) AS files, COALESCE(SUM(size), 0) AS bytes, COUNT(DISTINCT space) AS vaults FROM vault_files WHERE space != ''").get();
    return {
      store: blobs ? 'bucket' : 'db', used: used(), maxBytes, fileBytes, piece: pieceBytes, files: n.files, implemented: n.implemented,
      folders: q("SELECT COUNT(*) AS n FROM vault_folders WHERE space = ''").get().n, inDb: inDb(),
      shared: { files: s.files, bytes: s.bytes, vaults: s.vaults, free: freeBytes, requests: q("SELECT COUNT(*) AS n FROM vault_requests WHERE status = 'open'").get().n }
    };
  }
  // a live link (any problem with it looks the same from outside)
  const gone = () => new ApiError(404, 'no_link', 'リンクが無効か、有効期限が切れています');
  function linkOf(token) {
    const l = TOKEN_RE.test(String(token || '')) ? q('SELECT * FROM vault_links WHERE token_hash = ?').get(sha(String(token))) : null;
    if (!l || l.revoked || l.until <= Date.now()) throw gone();
    return l;
  }

  /* ------------------------------------------------------------- folders --- */
  const folderRow = (id) => (ID_RE.test(String(id || '')) ? q('SELECT * FROM vault_folders WHERE id = ?').get(String(id)) : null);
  function theFolder(u, id, how = '') {
    const d = folderRow(id);
    if (!d) throw noFolder();
    check(u, d.space, how, noFolder);
    return d;
  }
  // '' (the top of the vault) or a folder in it
  function placeIn(space, id) {
    if (!id) return '';
    const d = folderRow(id);
    if (!d || d.space !== space) throw noFolder();
    return d.id;
  }
  const folderDto = (d) => ({ id: d.id, name: d.name, parent: d.parent, createdAt: d.created_at, space: d.space });
  // "車/新車" (for the log)
  function pathOf(id) {
    const names = [];
    for (let d = folderRow(id); d && names.length <= FOLDER_DEPTH; d = folderRow(d.parent)) names.unshift(d.name);
    return names.join('/') || '保管庫';
  }
  function depthOf(id) {
    let n = 0;
    for (let d = folderRow(id); d && n <= FOLDER_DEPTH; d = folderRow(d.parent)) n++;
    return n;
  }
  // levels below a folder (itself counts 1)
  function heightOf(id, seen = 0) {
    if (seen > FOLDER_DEPTH) return seen;
    return 1 + q('SELECT id FROM vault_folders WHERE parent = ?').all(id).reduce((m, d) => Math.max(m, heightOf(d.id, seen + 1)), 0);
  }
  function nameTaken(space, parent, name, except = '') {
    return !!q('SELECT 1 AS x FROM vault_folders WHERE space = ? AND parent = ? AND name = ? AND id != ?').get(space, parent, name, except);
  }
  // a folder may go to `parent`: never inside itself, never too deep
  function canGo(d, parent) {
    for (let p = parent, i = 0; p && i <= FOLDERS_MAX; p = (folderRow(p) || { parent: '' }).parent, i++) {
      if (p === d.id) throw new ApiError(400, 'inside', 'フォルダをそれ自身の中には移せません');
    }
    if (depthOf(parent) + heightOf(d.id) > FOLDER_DEPTH) throw new ApiError(400, 'too_deep', `フォルダは${FOLDER_DEPTH}階層までです`);
  }

  /* ----------------------------------------- room in the shared vaults --- */
  const openOf = (id) => q("SELECT * FROM vault_requests WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(id);
  function requestDto(r) {
    return r ? { id: r.id, user: who(r.user_id), bytes: r.bytes, reason: r.reason, status: r.status, at: r.created_at, by: r.handled_by ? who(r.handled_by) : null, handledAt: r.handled_at, limit: r.limit_bytes } : null;
  }
  // one's own room there, and where their request stands (the developer has no limit: 0)
  function room(u) {
    if (isDeveloper(u)) return { used: keeps(u.id), limit: 0, free: freeBytes };
    const r = quotaOf(u.id);
    const last = q("SELECT * FROM vault_requests WHERE user_id = ? AND status IN ('approved', 'declined') ORDER BY id DESC LIMIT 1").get(u.id);
    return {
      used: keeps(u.id), limit: r ? r.bytes : freeBytes, free: freeBytes, approved: r ? { bytes: r.bytes, at: r.at, by: who(r.by_id) } : null,
      request: requestDto(openOf(u.id)), last: requestDto(last)
    };
  }
  // past 1GB only with the developer's approval, and then up to the limit they set
  function roomFor(u, bytes) {
    const mine = keeps(u.id), limit = limitOf(u.id);
    if (mine + bytes <= limit) return;
    if (limit > freeBytes) throw new ApiError(413, 'over_limit', `開発者が決めた上限（${mb(limit)}）を超えます（今 ${mb(mine)}）。いらないファイルを削除するか、もっと大きな容量を申請してください`);
    throw new ApiError(413, 'need_approval', `1人${mb(freeBytes)}を超えて保存するには、開発者の承認が必要です（今 ${mb(mine)} / ${mb(freeBytes)}）。「容量を申請」から申請してください`);
  }
  // a limit the developer sets: more than everyone's 1GB, at most the whole vault
  function limitParam(raw) {
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= freeBytes || n > maxBytes) throw new ApiError(400, 'need_limit', `上限を決めてください（${mb(freeBytes)}より大きく、${mb(maxBytes)}まで）`);
    return n;
  }
  function setLimit(id, bytes, by, at) {
    q('INSERT INTO vault_quotas (user_id, bytes, by_id, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET bytes = excluded.bytes, by_id = excluded.by_id, at = excluded.at')
      .run(id, bytes, by.id, at);
  }
  // each operator's use and limit (the developer's look)
  function people() {
    const ids = new Set(ops.operatorList().filter((o) => o.operator && o.id).map((o) => o.id));
    for (const r of q("SELECT DISTINCT created_by AS id FROM vault_files WHERE space != ''").all()) ids.add(r.id);
    for (const r of q('SELECT user_id AS id FROM vault_quotas').all()) ids.add(r.id);
    for (const r of q("SELECT DISTINCT user_id AS id FROM vault_requests WHERE status = 'open'").all()) ids.add(r.id);
    return [...ids].map(getUser).filter((p) => p && !isDeveloper(p)).map((p) => {
      const r = quotaOf(p.id);
      return {
        ...who(p.id), operator: ops.isOperator(p), used: keeps(p.id), limit: r ? r.bytes : freeBytes,
        approved: r ? { bytes: r.bytes, at: r.at, by: who(r.by_id) } : null, request: requestDto(openOf(p.id))
      };
    }).sort((a, b) => (b.operator - a.operator) || (b.used - a.used) || a.name.localeCompare(b.name));
  }
  // The vaults `u` sees, with what is in each: the shared ones with every
  // operator (and with one who no longer is, while something is in it). The
  // developer: their own too, the others' (to look into: the ones with
  // something in them), everyone's use and limit, and the open requests.
  function spaces(u) {
    const have = new Map();
    for (const r of q("SELECT space, COUNT(CASE WHEN parent = '' THEN 1 END) AS files, COALESCE(SUM(size), 0) AS bytes, MAX(created_at) AS last FROM vault_files GROUP BY space").all()) {
      have.set(r.space, { files: r.files, bytes: r.bytes, folders: 0, last: r.last });
    }
    for (const r of q('SELECT space, COUNT(*) AS n, MAX(created_at) AS last FROM vault_folders GROUP BY space').all()) {
      const s = have.get(r.space) || { files: 0, bytes: 0, folders: 0, last: 0 };
      have.set(r.space, { ...s, folders: r.n, last: Math.max(s.last, r.last) });
    }
    const box = (space) => have.get(space) || { files: 0, bytes: 0, folders: 0, last: 0 };
    const partners = new Set(ops.operatorList().filter((o) => o.operator && o.id && o.id !== u.id).map((o) => o.id));
    for (const space of have.keys()) {
      const m = membersOf(space);
      if (m && m.includes(u.id)) partners.add(otherOf(m, u.id));
    }
    const mine = [...partners].map((id) => {
      const p = getUser(id);
      return { id: pairOf(u.id, id), with: { ...who(id), operator: !!p && ops.isOperator(p), developer: !!p && isDeveloper(p) }, ...box(pairOf(u.id, id)) };
    }).sort((a, b) => (b.with.operator - a.with.operator) || (b.with.developer - a.with.developer) || a.with.name.localeCompare(b.with.name));
    const out = {
      me: room(u), spaces: mine,
      pool: { used: used(), maxBytes, fileBytes, chunk: pieceBytes, store: blobs ? 'bucket' : 'db', free: freeBytes }
    };
    if (!isDeveloper(u)) return out;
    return {
      ...out, own: box(''), inDb: inDb(), hours: LINK_HOURS,
      others: [...have.keys()].filter((s) => { const m = membersOf(s); return m && !m.includes(u.id); })
        .map((s) => ({ id: s, members: membersOf(s).map((id) => ({ ...who(id), operator: operatorId(id) })), ...box(s) }))
        .sort((a, b) => b.last - a.last),
      people: people(),
      requests: q("SELECT * FROM vault_requests WHERE status = 'open' ORDER BY id").all().map(requestDto)
    };
  }

  const routes = {
    // the developer code opens the developer's vault for 30 minutes (and for
    // them, a look into the ones the operators share)
    'POST /api/vault/open': async (req, u) => {
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '開発者専用保管庫は開発者のアカウントだけが使えます');
      rate(limits.open, u.id);
      const body = await req.json();
      await devCode.check(body.code, req, u);
      opsLog.add({ actor: u, action: 'vault_open', req, summary: '開発者が保管庫を開いた（開発者コードで）', detail: {} });
      return { ticket: ticketFor(u), until: Date.now() + TICKET_MS, chunk: pieceBytes, maxBytes, fileBytes, used: used(), hours: LINK_HOURS, store: blobs ? 'bucket' : 'db', free: freeBytes };
    },

    // the vaults one sees, one's room in the shared ones (and the developer's look at everyone's)
    'GET /api/vault/spaces': (req, u) => {
      need(req, u);
      return spaces(u);
    },

    // one vault's files and folders (`space`: a shared one; none: the developer's own)
    'GET /api/vault/files': (req, u) => {
      need(req, u);
      const space = spaceFor(u, req.query.get('space'));
      const now = Date.now();
      return {
        space: spaceDto(u, space),
        files: q('SELECT * FROM vault_files WHERE space = ? ORDER BY created_at DESC').all(space).map((f) => fileDto(f, now)),
        folders: q('SELECT * FROM vault_folders WHERE space = ? ORDER BY name').all(space).map(folderDto),
        used: used(), maxBytes, fileBytes, chunk: pieceBytes, store: blobs ? 'bucket' : 'db', inDb: isDeveloper(u) ? inDb() : 0,
        all: space ? null : linksOf(ALL, now), me: room(u), now
      };
    },

    // a 3D model's picture and what is in it (made on the operator site)
    'POST /api/vault/meta': async (req, u) => {
      need(req, u);
      const body = await req.json(PREVIEW_MAX + INFO_MAX + 4096);
      const f = theFile(u, body.id, 'change');
      const preview = String(body.preview || '');
      if (preview && (preview.length > PREVIEW_MAX || !PREVIEW_RE.test(preview))) throw new ApiError(400, 'bad_preview', 'プレビュー画像の形式が正しくありません');
      const info = body.info && typeof body.info === 'object' && !Array.isArray(body.info) ? JSON.stringify(body.info) : '';
      if (info.length > INFO_MAX) throw new ApiError(400, 'bad_info', 'モデルの情報が大きすぎます');
      q('UPDATE vault_files SET preview = ?, info = ? WHERE id = ?').run(preview, info, f.id);
      return { file: fileDto(fileRow(f.id)) };
    },

    'GET /api/vault/preview': (req, u) => {
      need(req, u);
      const f = theFile(u, req.query.get('id'));
      return { id: f.id, preview: f.preview || null };
    },

    // a new file: its name, size, type, vault and folder; the pieces follow
    'POST /api/vault/files': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const size = Number(body.size);
      if (!Number.isSafeInteger(size) || size < 1) throw new ApiError(400, 'bad_size', 'ファイルの大きさが正しくありません');
      if (size > fileBytes) throw new ApiError(413, 'too_large', `1つのファイルは${mb(fileBytes)}までです`);
      const name = cleanName(body.name);
      const type = /^[\w.+-]{1,60}\/[\w.+-]{1,60}$/.test(String(body.type || '')) ? String(body.type) : '';
      const note = Array.from(String(body.note ?? '').trim()).slice(0, 500).join('');
      // a model's light copy (in the model's vault and folder)
      const parent = body.parent ? theFile(u, body.parent, 'add') : null;
      if (parent && parent.parent) throw new ApiError(400, 'bad_parent', '軽量版の軽量版は作れません');
      const space = parent ? parent.space : spaceFor(u, body.space, 'add');
      const folder = parent ? parent.folder : placeIn(space, body.folder);
      const id = crypto.randomBytes(16).toString('hex');
      tx(() => {
        const all = used();
        if (all + size > maxBytes) throw new ApiError(413, 'vault_full', `保管庫がいっぱいです（${mb(all)} / ${mb(maxBytes)}）。いらないファイルを削除してください`);
        // an operator's own room in the shared vaults (the developer has no limit)
        if (space && !isDeveloper(u)) roomFor(u, size);
        q('INSERT INTO vault_files (id, name, type, note, size, chunks, piece, created_by, created_at, parent, folder, space) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, name, type, note, size, Math.ceil(size / pieceBytes), pieceBytes, u.id, Date.now(), parent ? parent.id : '', folder, space);
      });
      return { file: fileDto(fileRow(id)) };
    },

    // what an unfinished upload still needs
    'GET /api/vault/missing': async (req, u) => {
      need(req, u);
      const f = theFile(u, req.query.get('id'), 'change');
      const have = await piecesOf(f);
      if (!f.done_at && have.size !== f.received) q('UPDATE vault_files SET received = ? WHERE id = ?').run(have.size, f.id);
      return { file: fileDto(fileRow(f.id)), missing: gaps(f, have) };
    },

    // one piece (base64, with its SHA-256)
    'POST /api/vault/chunk': async (req, u) => {
      need(req, u);
      const body = await req.json(pieceBody);
      const f = theFile(u, body.id, 'change');
      if (f.done_at) throw new ApiError(409, 'done', 'このファイルはもうそろっています');
      const n = pieceNo(f, body.n);
      const want = String(body.sha256 || '').toLowerCase();
      const data = String(body.data || '');
      if (!HEX64.test(want) || !B64.test(data)) throw new ApiError(400, 'bad_piece', '部分の形式が正しくありません');
      const bytes = Buffer.from(data, 'base64');
      const expect = n === f.chunks - 1 ? f.size - n * f.piece : f.piece;
      if (bytes.length !== expect) throw new ApiError(400, 'bad_piece', '部分の大きさが正しくありません');
      if (sha(bytes) !== want) throw new ApiError(400, 'bad_hash', '部分が途中で壊れています（ハッシュが一致しません）。もう一度送ってください');
      if (blobs) {
        // into the bucket (nothing written to the database: POST /api/vault/finish once all are sent)
        await blobs.put(pieceKey(f.id, n), bytes, want);
        if (!fileRow(f.id)) { await blobs.del([pieceKey(f.id, n)]); throw noFile(); }
        return { n, stored: true, chunks: f.chunks };
      }
      onDb(data.length);
      const out = tx(() => {
        q('INSERT INTO vault_chunks (file_id, n, sha256, data) VALUES (?, ?, ?, ?) ON CONFLICT(file_id, n) DO UPDATE SET sha256 = excluded.sha256, data = excluded.data')
          .run(f.id, n, want, bytes.toString('base64'));
        const received = q('SELECT COUNT(*) AS n FROM vault_chunks WHERE file_id = ?').get(f.id).n;
        if (received < f.chunks) {
          q('UPDATE vault_files SET received = ? WHERE id = ?').run(received, f.id);
          return { received, sum: '' };
        }
        return { received, sum: finish(f, q('SELECT sha256 FROM vault_chunks WHERE file_id = ? ORDER BY n').all(f.id).map((r) => r.sha256), req, u) };
      });
      return { received: out.received, chunks: f.chunks, done: !!out.sum, sha256: out.sum };
    },

    // every piece sent: the file is whole once all of them are in (what is
    // still missing otherwise)
    'POST /api/vault/finish': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(u, body.id, 'change');
      if (f.done_at) return { file: fileDto(f), done: true, sha256: f.sha256, missing: [] };
      const have = await piecesOf(f);
      if (have.size < f.chunks) {
        if (have.size !== f.received) q('UPDATE vault_files SET received = ? WHERE id = ?').run(have.size, f.id);
        return { file: fileDto(fileRow(f.id)), done: false, sha256: '', missing: gaps(f, have) };
      }
      const sum = finish(f, Array.from({ length: f.chunks }, (_, n) => have.get(n)), req, u);
      return { file: fileDto(fileRow(f.id)), done: true, sha256: sum, missing: [] };
    },

    // one piece back (the site puts the file together and checks every hash)
    'GET /api/vault/chunk': async (req, u) => {
      need(req, u);
      const f = theFile(u, req.query.get('id'));
      return piece(f, pieceNo(f, req.query.get('n')));
    },

    // files (each with its light copy) out of the vault for good: `id`, or
    // `ids` (the ones checked; any already gone are passed over)
    'POST /api/vault/delete': async (req, u) => {
      need(req, u);
      const body = await req.json(64 * 1024);
      const found = (body.ids === undefined ? [String(body.id ?? '')] : idsOf(body.ids)).map(fileRow).filter(Boolean);
      for (const f of found) check(u, f.space, 'change', noFile);
      // (a light copy checked with its model goes with the model)
      const ids = new Set(found.map((f) => f.id));
      const files = found.filter((f) => !ids.has(f.parent));
      if (!files.length) throw noFile();
      const space = oneVault(files);
      await remove(files);
      const bytes = files.reduce((s, f) => s + f.size, 0);
      opsLog.add(files.length === 1
        ? { actor: u, action: 'vault_delete', req, summary: `${whereName(space)}の${what(files[0])}を削除`, detail: { ...fileNote(files[0]), sha256: files[0].sha256 } }
        : {
          actor: u, action: 'vault_delete', req,
          summary: space ? `${whereName(space)}のファイル${files.length}件（${mb(bytes)}）を削除` : `保管庫の${files.length}件（${mb(bytes)}）を削除：${some(files.map((f) => `「${f.name}」`))}`,
          detail: { space, files: files.map((f) => ({ ...fileNote(f), sha256: f.sha256 })) }
        });
      return { ok: true, deleted: files.length, used: used() };
    },

    // a short message on a file (days: how long it lasts, 0 no end)
    'POST /api/vault/notes': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(u, body.id, 'change');
      const text = Array.from(String(body.text ?? '').replace(CONTROL, ' ').trim()).slice(0, NOTE_MAX).join('');
      if (!text) throw new ApiError(400, 'empty', 'メッセージを書いてください');
      const days = Number(body.days);
      if (!NOTE_DAYS.includes(days)) throw new ApiError(400, 'bad_days', `期間は ${NOTE_DAYS.map((d) => (d ? d + '日' : '期限なし')).join('・')} から選んでください`);
      if (q('SELECT COUNT(*) AS n FROM vault_notes WHERE file_id = ?').get(f.id).n >= NOTES_MAX) throw new ApiError(409, 'too_many', `1つのファイルにメッセージは${NOTES_MAX}件までです`);
      const now = Date.now();
      q('INSERT INTO vault_notes (file_id, by_id, body, created_at, until) VALUES (?, ?, ?, ?, ?)').run(f.id, u.id, text, now, days ? now + days * 86400000 : 0);
      const long = days ? days + '日間' : '期限なし';
      opsLog.add(f.space
        ? { actor: u, action: 'vault_note', req, summary: `${whereName(f.space)}のファイルにメッセージ（${long}）`, detail: { file: f.id, space: f.space, days } }
        : { actor: u, action: 'vault_note', req, summary: `保管庫の「${f.name}」にメッセージ（${long}）：${text}`, detail: { file: f.id, name: f.name, text, days } });
      return { file: fileDto(fileRow(f.id)) };
    },
    'POST /api/vault/notes/delete': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const noNote = () => new ApiError(404, 'no_note', 'メッセージが見つかりません');
      const n = q('SELECT * FROM vault_notes WHERE id = ?').get(Number(body.note) || 0);
      const f = n && fileRow(n.file_id);
      if (!f) throw noNote();
      check(u, f.space, 'change', noNote);
      q('DELETE FROM vault_notes WHERE id = ?').run(n.id);
      opsLog.add(f.space
        ? { actor: u, action: 'vault_note_delete', req, summary: `${whereName(f.space)}のファイルのメッセージを削除`, detail: { file: f.id, space: f.space } }
        : { actor: u, action: 'vault_note_delete', req, summary: `保管庫の「${f.name}」のメッセージを削除：${n.body}`, detail: { file: n.file_id, text: n.body } });
      return { file: fileDto(fileRow(f.id)) };
    },

    // back from 実装済み (the links see it again)
    'POST /api/vault/restore': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(u, body.id, 'change');
      if (f.space) throw new ApiError(400, 'not_here', '実装済みがあるのは開発者専用保管庫だけです');
      if (!f.implemented_at) return { file: fileDto(f) };
      tx(() => {
        q('UPDATE vault_files SET implemented_at = 0 WHERE id = ? OR parent = ?').run(f.id, f.id);
        addLabel(f, 'restore', '開発者が実装済みから戻しました');
      });
      opsLog.add({ actor: u, action: 'vault_restore', req, summary: `保管庫の「${f.name}」を実装済みから戻した`, detail: { file: f.id, name: f.name } });
      return { file: fileDto(fileRow(f.id)) };
    },

    // pieces kept in the database before the bucket came move into it, a few
    // at a time (the operator site asks again while some are left)
    'POST /api/vault/to-bucket': async (req, u) => {
      need(req, u);
      developerOnly(u, 'R2 への移動');
      if (!blobs) return { moved: 0, left: 0 };
      const rows = q('SELECT file_id, n, sha256, data FROM vault_chunks LIMIT ?').all(TO_BUCKET);
      for (const r of rows) {
        await blobs.put(pieceKey(r.file_id, r.n), Buffer.from(r.data, 'base64'), r.sha256);
        q('DELETE FROM vault_chunks WHERE file_id = ? AND n = ?').run(r.file_id, r.n);
      }
      const left = inDb();
      if (rows.length && !left) opsLog.add({ actor: u, action: 'vault_bucket', req, summary: '保管庫のファイルをすべてR2に移した', detail: {} });
      return { moved: rows.length, left };
    },

    // a folder at the top of a vault (`space`) or in another folder
    'POST /api/vault/folders': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const name = folderName(body.name);
      const up = body.parent ? theFolder(u, body.parent, 'change') : null;
      const space = up ? up.space : spaceFor(u, body.space, 'change');
      const parent = up ? up.id : '';
      if (depthOf(parent) >= FOLDER_DEPTH) throw new ApiError(400, 'too_deep', `フォルダは${FOLDER_DEPTH}階層までです`);
      if (q('SELECT COUNT(*) AS n FROM vault_folders WHERE space = ?').get(space).n >= FOLDERS_MAX) throw new ApiError(409, 'too_many', `フォルダは${FOLDERS_MAX}個までです`);
      if (nameTaken(space, parent, name)) throw new ApiError(409, 'exists', `「${name}」はもうあります`);
      const id = crypto.randomBytes(16).toString('hex');
      q('INSERT INTO vault_folders (id, name, parent, created_by, created_at, space) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, parent, u.id, Date.now(), space);
      opsLog.add(space
        ? { actor: u, action: 'vault_folder', req, summary: `${whereName(space)}にフォルダを作成`, detail: { folder: id, parent, space } }
        : { actor: u, action: 'vault_folder', req, summary: `保管庫にフォルダ「${pathOf(id)}」を作成`, detail: { folder: id, name, parent } });
      return { folder: folderDto(folderRow(id)) };
    },

    // a new name, or a new place in its vault (never inside itself)
    'POST /api/vault/folders/update': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const d = theFolder(u, body.id, 'change');
      const name = body.name === undefined ? d.name : folderName(body.name);
      const parent = body.parent === undefined ? d.parent : placeIn(d.space, body.parent);
      canGo(d, parent);
      if (nameTaken(d.space, parent, name, d.id)) throw new ApiError(409, 'exists', `「${name}」はもうあります`);
      const before = pathOf(d.id);
      q('UPDATE vault_folders SET name = ?, parent = ? WHERE id = ?').run(name, parent, d.id);
      opsLog.add(d.space
        ? { actor: u, action: 'vault_folder', req, summary: `${whereName(d.space)}のフォルダを${parent === d.parent ? '名前変更' : '移動'}`, detail: { folder: d.id, parent, space: d.space } }
        : { actor: u, action: 'vault_folder', req, summary: `保管庫のフォルダ「${before}」を「${pathOf(d.id)}」に変更`, detail: { folder: d.id, name, parent } });
      return { folder: folderDto(folderRow(d.id)) };
    },

    // folders go (`id`, or `ids`: the ones checked); what was in each moves
    // up to where it was
    'POST /api/vault/folders/delete': async (req, u) => {
      need(req, u);
      const body = await req.json(64 * 1024);
      const dirs = (body.ids === undefined ? [String(body.id ?? '')] : idsOf(body.ids)).map(folderRow).filter(Boolean);
      for (const d of dirs) check(u, d.space, 'change', noFolder);
      if (!dirs.length) throw noFolder();
      const space = oneVault(dirs);
      const paths = dirs.map((d) => pathOf(d.id));
      tx(() => {
        for (const x of dirs) {
          // (where it is now: a folder above it may have gone first)
          const d = folderRow(x.id);
          q('UPDATE vault_files SET folder = ? WHERE folder = ?').run(d.parent, d.id);
          q('UPDATE vault_folders SET parent = ? WHERE parent = ?').run(d.parent, d.id);
          q('DELETE FROM vault_folders WHERE id = ?').run(d.id);
        }
      });
      const many = dirs.length > 1;
      opsLog.add({
        actor: u, action: 'vault_folder', req,
        summary: space ? `${whereName(space)}のフォルダ${many ? dirs.length + '個' : ''}を削除（中身はひとつ上へ）`
          : many ? `保管庫のフォルダ${dirs.length}個を削除（中身はひとつ上へ）：${some(paths.map((p) => `「${p}」`))}` : `保管庫のフォルダ「${paths[0]}」を削除（中身はひとつ上へ）`,
        detail: many ? { space, folders: dirs.map((d) => ({ folder: d.id, parent: d.parent })) } : { folder: dirs[0].id, parent: dirs[0].parent, ...(space ? { space } : {}) }
      });
      return { ok: true, deleted: dirs.length };
    },

    // files (with their light copies, `ids`) and folders (`folders`) into a
    // folder of their vault ('' the top)
    'POST /api/vault/move': async (req, u) => {
      need(req, u);
      const body = await req.json(64 * 1024);
      const files = idsOf(body.ids).map(fileRow).filter((f) => f && !f.parent);
      const dirs = idsOf(body.folders).map(folderRow).filter(Boolean);
      for (const f of files) check(u, f.space, 'change', noFile);
      for (const d of dirs) check(u, d.space, 'change', noFolder);
      if (!files.length && !dirs.length) throw new ApiError(400, 'no_files', '移すものを選んでください');
      const space = oneVault([...files, ...dirs]);
      const folder = placeIn(space, body.folder);
      // (two folders of one name never end up side by side)
      const names = new Set();
      for (const d of dirs) {
        canGo(d, folder);
        if (names.has(d.name) || nameTaken(space, folder, d.name, d.id)) throw new ApiError(409, 'exists', `移動先にはもう「${d.name}」があります`);
        names.add(d.name);
      }
      tx(() => {
        for (const f of files) q('UPDATE vault_files SET folder = ? WHERE id = ? OR parent = ?').run(folder, f.id, f.id);
        for (const d of dirs) q('UPDATE vault_folders SET parent = ? WHERE id = ?').run(folder, d.id);
      });
      const n = files.length + dirs.length;
      opsLog.add(space
        ? { actor: u, action: 'vault_move', req, summary: `${whereName(space)}で${n}件を移動`, detail: { space, folder, files: files.map((f) => f.id), folders: dirs.map((d) => d.id) } }
        : { actor: u, action: 'vault_move', req, summary: `保管庫の${n}件を「${pathOf(folder)}」へ移動`, detail: { folder, files: files.slice(0, 50).map((f) => f.name), folders: dirs.slice(0, 50).map((d) => d.name) } });
      return { moved: n };
    },

    // a read-only link to one whole file (`id`) or to the whole vault (id
    // '*'), good for `hours`; the secret is shown once. The developer's
    // vault only: a shared one is never reached from outside.
    'POST /api/vault/link': async (req, u) => {
      need(req, u);
      developerOnly(u, 'リンクを作るの');
      const body = await req.json();
      const all = body.id === ALL;
      const f = all ? null : theFile(u, body.id);
      if (f && f.space) throw new ApiError(400, 'not_here', '共有保管庫のファイルにはリンクを作れません（共有保管庫は非公開です）');
      if (f && !f.done_at) throw new ApiError(409, 'not_done', 'アップロードが終わってからリンクを作れます');
      const hours = Number(body.hours);
      if (!LINK_HOURS.includes(hours)) throw new ApiError(400, 'bad_hours', `有効期間は ${LINK_HOURS.join(' / ')} 時間から選んでください`);
      const ai = body.ai === true;
      const token = crypto.randomBytes(32).toString('base64url');
      const until = Date.now() + hours * 3600000;
      q('INSERT INTO vault_links (token_hash, file_id, until, created_by, created_at, ai) VALUES (?, ?, ?, ?, ?, ?)').run(sha(token), all ? ALL : f.id, until, u.id, Date.now(), ai ? 1 : 0);
      const where = all ? '保管庫全体' : `保管庫の「${f.name}」`;
      opsLog.add({ actor: u, action: 'vault_link', req, summary: `${where}の${ai ? 'AI用' : '読み取り専用'}リンクを作成（${hours}時間有効）`, detail: { file: all ? ALL : f.id, name: all ? '' : f.name, hours, until, ai } });
      return { token, until, ai, path: `/api/vault/pull?t=${token}` };
    },

    // every link of a file (or of the whole vault: id '*') stops working at once
    'POST /api/vault/link/stop': async (req, u) => {
      need(req, u);
      developerOnly(u, 'リンクの停止');
      const body = await req.json();
      const all = body.id === ALL;
      const f = all ? null : theFile(u, body.id);
      if (f && f.space) throw new ApiError(400, 'not_here', '共有保管庫のファイルにはリンクがありません');
      const n = Number(q('UPDATE vault_links SET revoked = 1 WHERE file_id = ? AND revoked = 0 AND until > ?').run(all ? ALL : f.id, Date.now()).changes);
      opsLog.add({ actor: u, action: 'vault_link_stop', req, summary: `${all ? '保管庫全体' : `保管庫の「${f.name}」`}のリンクを停止（${n}件）`, detail: { file: all ? ALL : f.id, stopped: n } });
      return { ok: true, stopped: n };
    },

    // With a link (no login). A file's link: the file (with its picture and
    // light copy); a vault link: every file and folder of the developer's
    // vault (`f`: one of the files). `n`: piece n of it, `preview=1`: its
    // picture. Files in 実装済み are not there, nor anything of a shared
    // vault. Any problem (wrong, stopped, expired) looks the same from
    // outside. An AI's link labels a file as taken (once an hour).
    'GET /api/vault/pull': async (req) => {
      rate(limits.pull, req.ip || '-');
      const l = linkOf(req.query.get('t'));
      const all = l.file_id === ALL;
      const top = all ? null : fileRow(l.file_id);
      if (!all && (!top || top.space || !top.done_at || top.implemented_at)) throw gone();
      // the file asked for: the link's own, its light copy, or (a vault link) any
      const want = req.query.get('f');
      let f = top;
      if (want) {
        const x = fileRow(want);
        f = x && !x.space && x.done_at && !x.implemented_at && (all || x.id === top.id || x.parent === top.id) ? x : null;
        if (!f) throw noFile();
      }
      const n = req.query.get('n');
      if (f && l.ai && (n === '0' || n === null || n === '') && !req.query.get('preview')) {
        const model = f.parent ? fileRow(f.parent) : f;
        const recent = labelsOf(model).some((x) => x.kind === 'download' && x.at > Date.now() - 3600000);
        if (model && !recent) addLabel(model, 'download', f.parent ? 'AIが軽量版をダウンロード' : 'AIがダウンロード');
      }
      if (f && n !== null && n !== '') return piece(f, pieceNo(f, n));
      if (f && req.query.get('preview')) return { id: f.id, preview: f.preview || null };
      q('UPDATE vault_links SET uses = uses + 1 WHERE token_hash = ?').run(l.token_hash);
      opsLog.add({ actorName: 'リンク', action: 'vault_pull', req, summary: f ? `保管庫の「${f.name}」がリンクから取得された` : '保管庫全体の一覧がリンクから取得された', detail: { file: f ? f.id : ALL, name: f ? f.name : '', uses: l.uses + 1, until: l.until } });
      const how = {
        pieces: '&n=<piece> (base64, with its sha256; `chunk` bytes each)', picture: '&preview=1', file: '&f=<file id>', sha256: "the file's sha256 is the SHA-256 of all piece digests in order",
        notes: "notes: the developer's short messages on a file (read them before working on it)",
        ...(l.ai ? { label: 'POST /api/vault/ai { t, f, text }', implemented: 'POST /api/vault/ai { t, f, text: where it went, implemented: true } (the file leaves the links; it stays in the vault)' } : {})
      };
      if (f) return { ...pullDto(f), until: l.until, ai: !!l.ai, how };
      return {
        vault: true, until: l.until, ai: !!l.ai,
        folders: q("SELECT * FROM vault_folders WHERE space = '' ORDER BY name").all().map(folderDto).map(({ space, ...d }) => d),
        files: q("SELECT * FROM vault_files WHERE space = '' AND done_at > 0 AND parent = '' AND implemented_at = 0 ORDER BY created_at DESC").all().map(pullDto), how
      };
    },

    // An AI with a link made for it (no login): its label on a file it works
    // on (text), or the file is in the game now (implemented, text: where it
    // went): the file moves to 実装済み, out of every link at once (it stays
    // in the vault).
    'POST /api/vault/ai': async (req) => {
      rate(limits.pull, req.ip || '-');
      const body = await req.json();
      const l = linkOf(body.t);
      if (!l.ai) throw gone();
      const f = fileRow(body.f);
      if (!f || f.space || !f.done_at || f.implemented_at || f.parent || !(l.file_id === ALL || l.file_id === f.id)) throw noFile();
      const text = Array.from(String(body.text ?? '').replace(CONTROL, ' ').trim()).slice(0, 200).join('');
      if (!text) throw new ApiError(400, 'empty', body.implemented ? 'どこに入れたかを書いてください' : 'ラベルの内容を書いてください');
      if (body.implemented === true) {
        tx(() => {
          addLabel(f, 'implemented', text);
          q('UPDATE vault_files SET implemented_at = ? WHERE id = ? OR parent = ?').run(Date.now(), f.id, f.id);
        });
        opsLog.add({ actorName: 'AI', action: 'vault_ai_done', req, summary: `AIが保管庫の「${f.name}」をゲームに入れた（実装済みへ）：${text}`, detail: { file: f.id, name: f.name, text } });
        return { ok: true, implemented: true };
      }
      addLabel(f, 'ai', text);
      opsLog.add({ actorName: 'AI', action: 'vault_ai_label', req, summary: `AIが保管庫の「${f.name}」にラベル：${text}`, detail: { file: f.id, name: f.name, text } });
      return { ok: true, labels: labelsOf(fileRow(f.id)) };
    },

    /* --------------------------------------- room in the shared vaults --- */

    // An operator asks the developer to keep more than 1GB there: the limit
    // they would like (bytes) and why. One open request each (a new one
    // takes its place).
    'POST /api/vault/quota/request': async (req, u) => {
      need(req, u);
      if (isDeveloper(u)) throw new ApiError(400, 'developer', '開発者には上限がありません');
      const body = await req.json();
      const bytes = Number(body.bytes);
      const mine = keeps(u.id), limit = limitOf(u.id);
      if (!Number.isSafeInteger(bytes) || bytes <= limit || bytes > maxBytes) throw new ApiError(400, 'bad_bytes', `希望の容量は、今の上限（${mb(limit)}）より大きく${mb(maxBytes)}までで選んでください`);
      const reason = Array.from(String(body.reason ?? '').replace(CONTROL, ' ').trim()).slice(0, REASON_MAX).join('');
      const open = openOf(u.id), now = Date.now();
      if (open) q('UPDATE vault_requests SET bytes = ?, reason = ?, created_at = ? WHERE id = ?').run(bytes, reason, now, open.id);
      else q('INSERT INTO vault_requests (user_id, bytes, reason, created_at) VALUES (?, ?, ?, ?)').run(u.id, bytes, reason, now);
      opsLog.add({ actor: u, action: 'vault_quota_request', req, summary: `${u.name}が共有保管庫の容量を申請（使用 ${mb(mine)} / 上限 ${mb(limit)} → 希望 ${mb(bytes)}）`, detail: { used: mine, limit, bytes, reason } });
      return { me: room(u) };
    },
    'POST /api/vault/quota/cancel': async (req, u) => {
      need(req, u);
      await req.json();
      const open = openOf(u.id);
      if (!open) throw new ApiError(404, 'no_request', '申請中のものはありません');
      q("UPDATE vault_requests SET status = 'canceled', handled_by = ?, handled_at = ? WHERE id = ?").run(u.id, Date.now(), open.id);
      opsLog.add({ actor: u, action: 'vault_quota_cancel', req, summary: `${u.name}が共有保管庫の容量の申請（${mb(open.bytes)}）を取り下げた`, detail: { request: open.id, bytes: open.bytes } });
      return { me: room(u) };
    },

    // The developer answers a request: approved always with the limit they
    // set (more than 1GB; it may be less than was asked), or declined.
    'POST /api/vault/quota/decide': async (req, u) => {
      need(req, u);
      developerOnly(u, '容量の承認');
      const body = await req.json();
      const r = q('SELECT * FROM vault_requests WHERE id = ?').get(Number(body.id) || 0);
      if (!r) throw new ApiError(404, 'no_request', '申請が見つかりません');
      if (r.status !== 'open') throw new ApiError(409, 'done', 'この申請はもう処理されています');
      const p = getUser(r.user_id), name = p ? p.name : '?', now = Date.now();
      if (body.approve === true) {
        const limit = limitParam(body.limit);
        tx(() => {
          setLimit(r.user_id, limit, u, now);
          q("UPDATE vault_requests SET status = 'approved', handled_by = ?, handled_at = ?, limit_bytes = ? WHERE id = ?").run(u.id, now, limit, r.id);
        });
        opsLog.add({ actor: u, action: 'vault_quota_approve', target: p, req, summary: `${name}さんの共有保管庫の容量の申請を承認（上限 ${mb(limit)}・希望 ${mb(r.bytes)}）`, detail: { request: r.id, bytes: r.bytes, limit, used: keeps(r.user_id) } });
      } else if (body.approve === false) {
        q("UPDATE vault_requests SET status = 'declined', handled_by = ?, handled_at = ? WHERE id = ?").run(u.id, now, r.id);
        opsLog.add({ actor: u, action: 'vault_quota_decline', target: p, req, summary: `${name}さんの共有保管庫の容量の申請を見送り（希望 ${mb(r.bytes)}）`, detail: { request: r.id, bytes: r.bytes } });
      } else {
        throw new ApiError(400, 'bad_action', '承認するか見送るかを選んでください');
      }
      return spaces(u);
    },

    // the developer sets one operator's limit (more than 1GB), or takes it
    // back to the 1GB everyone has (`limit` 0)
    'POST /api/vault/quota/set': async (req, u) => {
      need(req, u);
      developerOnly(u, '上限の設定');
      const body = await req.json();
      const p = getUser(Number(body.user) || 0);
      if (!p || p.npc || isDeveloper(p)) throw new ApiError(404, 'not_found', 'その運営者は見つかりません');
      const before = limitOf(p.id), back = Number(body.limit) === 0;
      const limit = back ? freeBytes : limitParam(body.limit);
      if (back) q('DELETE FROM vault_quotas WHERE user_id = ?').run(p.id);
      else setLimit(p.id, limit, u, Date.now());
      opsLog.add({
        actor: u, action: 'vault_quota_set', target: p, req,
        summary: back ? `${p.name}さんの共有保管庫の上限を標準（${mb(freeBytes)}）に戻した` : `${p.name}さんの共有保管庫の上限を${mb(before)}から${mb(limit)}に変更`,
        detail: { before, limit, used: keeps(p.id) }
      });
      return spaces(u);
    }
  };

  return { routes, summary, public: ['GET /api/vault/pull', 'POST /api/vault/ai'] };
}
