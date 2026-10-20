// The developer's vault: big files (3D models and the like, up to a few GB)
// kept on the game's own server for the developer, to fetch from anywhere.
// Only the developer's account opens it, and only with the developer code
// (server/core/devcode.js: the same counted and logged tries) for a signed
// ticket good for 30 minutes. A file comes in pieces (1 MiB, or bigger with
// a bucket: VAULT_PIECE_MB), each checked against its SHA-256 as it arrives
// (a broken upload carries on where it stopped); it is whole once every piece
// is in, and its fingerprint is the SHA-256 of its pieces' hashes in order.
// A 3D model gets, from the operator site (ops/vault3d.js, made in the
// developer's browser), a small picture of it from four sides, what is in
// it, and a light copy (a file of its own whose `parent` is the model).
// Files sit in folders the developer makes (folders in folders too). The
// developer can also make a read-only link for one file, or for the whole
// vault (good for 1 to 72 hours, stopped at any time; only the hash of its
// secret is kept) to fetch it somewhere else. A link made for an AI also
// labels each file the AI takes, takes the AI's own labels (what it did with
// a file), and once the AI has put a file in the game, moves it to 実装済み:
// out of every link at once, so used and unused material never mix, but kept
// (the developer can bring it back). Nothing in the vault is ever deleted on
// its own: only the developer deletes, one file at a time.
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
const ID_RE = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TOKEN_RE = /^[\w-]{43}$/;
// a model's picture (a WebP or JPEG data URL) and what is in it (JSON)
const PREVIEW_MAX = 600 * 1024;
const PREVIEW_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const INFO_MAX = 8 * 1024;
// a link to every file
const ALL = '*';
// folders: how deep, how many; files moved at once; pieces moved into the bucket at once
const FOLDER_DEPTH = 8;
const FOLDERS_MAX = 500;
const MOVE_MAX = 500;
const TO_BUCKET = 16;
// labels kept on a file
const LABELS_MAX = 30;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const mb = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(n < 10737418240 ? 1 : 0)}GB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`);

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

// blobs (from the host, or null): put(key, bytes, sha256), get(key) ->
// { bytes, sha256 } | null, list(prefix) -> [{ key, sha256 }], del(keys)
export function createVault({ q, tx, config, secret, opsLog, isDeveloper, devCode, blobs = null }) {
  const KEY = crypto.createHash('sha256').update(`${secret}:vault-ticket`).digest();
  const size = SIZES[blobs ? 'bucket' : config.plan === 'paid' ? 'paid' : 'db'];
  const maxBytes = (config.vaultMaxMb ?? size.all) * 1048576, fileBytes = (config.vaultFileMb ?? size.file) * 1048576;
  // a piece: 8 MiB in a bucket on Workers Paid (a request may work for 30 s), else 1 MiB
  const pieceBytes = Math.min(size.piece, Math.max(1, config.vaultPieceMb ?? (blobs && config.plan === 'paid' ? 8 : 1))) * CHUNK;
  // a piece as base64 inside JSON
  const pieceBody = Math.ceil(size.piece * CHUNK * 4 / 3) + 64 * 1024;
  // [a minute, burst]: tries to open it, pieces and lists (the developer), fetching with a link (an address)
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
  // the developer, with an unexpired ticket of their own
  function need(req, u) {
    if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '保管庫は開発者のアカウントだけが使えます');
    const m = /^(\d{1,15})\.(\d{13})\.([\w-]{43})$/.exec(String(req.header('x-vault-ticket') || ''));
    let ok = false;
    if (m && Number(m[1]) === u.id && Number(m[2]) > Date.now()) {
      const got = Buffer.from(m[3], 'base64url'), want = sign(`${m[1]}.${m[2]}`);
      ok = got.length === want.length && crypto.timingSafeEqual(got, want);
    }
    // (403, not 401: the site stays logged in, only the vault closes)
    if (!ok) throw new ApiError(403, 'vault_locked', '保管庫が閉じています。開発者コードを入力して開いてください');
    rate(limits.work, u.id);
  }

  const fileRow = (id) => (ID_RE.test(String(id || '')) ? q('SELECT * FROM vault_files WHERE id = ?').get(String(id)) : null);
  function theFile(id) {
    const f = fileRow(id);
    if (!f) throw new ApiError(404, 'no_file', 'ファイルが見つかりません');
    return f;
  }
  const used = () => q('SELECT COALESCE(SUM(size), 0) AS n FROM vault_files').get().n;
  // pieces still in the database (moving into the bucket)
  const inDb = () => (blobs ? q('SELECT COUNT(*) AS n FROM vault_chunks').get().n : 0);
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
  function fileDto(f, now = Date.now()) {
    return {
      id: f.id, name: f.name, type: f.type, note: f.note, size: f.size, chunks: f.chunks, piece: f.piece, received: f.received, done: !!f.done_at,
      sha256: f.sha256, createdAt: f.created_at, doneAt: f.done_at, parent: f.parent || '', folder: f.folder || '', info: infoOf(f), preview: !!f.preview,
      labels: labelsOf(f), implementedAt: f.implemented_at, links: linksOf(f.id, now)
    };
  }
  // what a link shows of a file (no notes, no links)
  function pullDto(f) {
    const light = q("SELECT * FROM vault_files WHERE parent = ? AND done_at > 0 ORDER BY created_at DESC LIMIT 1").get(f.id);
    return {
      id: f.id, name: f.name, type: f.type, size: f.size, chunks: f.chunks, chunk: f.piece, sha256: f.sha256, folder: f.folder || '', sentAt: f.created_at, doneAt: f.done_at,
      labels: labelsOf(f), info: infoOf(f), preview: !!f.preview,
      light: light ? { id: light.id, name: light.name, size: light.size, chunks: light.chunks, chunk: light.piece, sha256: light.sha256 } : null
    };
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
    if (done) opsLog.add({ actor: u, action: 'vault_upload', req, summary: `保管庫に「${f.name}」（${mb(f.size)}）を保存`, detail: { file: f.id, name: f.name, size: f.size, chunks: f.chunks, sha256: sum } });
    return sum;
  }

  // a file and its light copy leave the vault (and the bucket)
  async function remove(f) {
    const files = [f, ...q('SELECT * FROM vault_files WHERE parent = ?').all(f.id)];
    tx(() => {
      for (const x of files) {
        q('DELETE FROM vault_chunks WHERE file_id = ?').run(x.id);
        q('DELETE FROM vault_links WHERE file_id = ?').run(x.id);
        q('DELETE FROM vault_files WHERE id = ?').run(x.id);
      }
    });
    // (in the bucket: every piece it could have)
    if (blobs) await blobs.del(files.flatMap((x) => Array.from({ length: x.chunks }, (_, n) => pieceKey(x.id, n))));
  }
  // the vault in figures (the operator site's サーバー tab)
  function summary() {
    const n = q("SELECT COUNT(*) AS files, COALESCE(SUM(CASE WHEN implemented_at > 0 THEN 1 ELSE 0 END), 0) AS implemented FROM vault_files WHERE parent = ''").get();
    return {
      store: blobs ? 'bucket' : 'db', used: used(), maxBytes, fileBytes, piece: pieceBytes, files: n.files, implemented: n.implemented,
      folders: q('SELECT COUNT(*) AS n FROM vault_folders').get().n, inDb: inDb()
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
  function theFolder(id) {
    const d = folderRow(id);
    if (!d) throw new ApiError(404, 'no_folder', 'フォルダが見つかりません');
    return d;
  }
  // '' (the top of the vault) or a folder that is there
  const placeOf = (id) => (id ? theFolder(id).id : '');
  const folderDto = (d) => ({ id: d.id, name: d.name, parent: d.parent, createdAt: d.created_at });
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
  function nameTaken(parent, name, except = '') {
    return !!q('SELECT 1 AS x FROM vault_folders WHERE parent = ? AND name = ? AND id != ?').get(parent, name, except);
  }

  const routes = {
    // the developer code opens it for 30 minutes
    'POST /api/vault/open': async (req, u) => {
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '保管庫は開発者のアカウントだけが使えます');
      rate(limits.open, u.id);
      const body = await req.json();
      await devCode.check(body.code, req, u);
      opsLog.add({ actor: u, action: 'vault_open', req, summary: '開発者が保管庫を開いた（開発者コードで）', detail: {} });
      return { ticket: ticketFor(u), until: Date.now() + TICKET_MS, chunk: pieceBytes, maxBytes, fileBytes, used: used(), hours: LINK_HOURS, store: blobs ? 'bucket' : 'db' };
    },

    'GET /api/vault/files': (req, u) => {
      need(req, u);
      const now = Date.now();
      return {
        files: q('SELECT * FROM vault_files ORDER BY created_at DESC').all().map((f) => fileDto(f, now)),
        folders: q('SELECT * FROM vault_folders ORDER BY name').all().map(folderDto),
        used: used(), maxBytes, fileBytes, chunk: pieceBytes, store: blobs ? 'bucket' : 'db', inDb: inDb(), all: linksOf(ALL, now), now
      };
    },

    // a 3D model's picture and what is in it (made on the operator site)
    'POST /api/vault/meta': async (req, u) => {
      need(req, u);
      const body = await req.json(PREVIEW_MAX + INFO_MAX + 4096);
      const f = theFile(body.id);
      const preview = String(body.preview || '');
      if (preview && (preview.length > PREVIEW_MAX || !PREVIEW_RE.test(preview))) throw new ApiError(400, 'bad_preview', 'プレビュー画像の形式が正しくありません');
      const info = body.info && typeof body.info === 'object' && !Array.isArray(body.info) ? JSON.stringify(body.info) : '';
      if (info.length > INFO_MAX) throw new ApiError(400, 'bad_info', 'モデルの情報が大きすぎます');
      q('UPDATE vault_files SET preview = ?, info = ? WHERE id = ?').run(preview, info, f.id);
      return { file: fileDto(fileRow(f.id)) };
    },

    'GET /api/vault/preview': (req, u) => {
      need(req, u);
      const f = theFile(req.query.get('id'));
      return { id: f.id, preview: f.preview || null };
    },

    // a new file: its name, size, type and folder; the pieces follow
    'POST /api/vault/files': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const size = Number(body.size);
      if (!Number.isSafeInteger(size) || size < 1) throw new ApiError(400, 'bad_size', 'ファイルの大きさが正しくありません');
      if (size > fileBytes) throw new ApiError(413, 'too_large', `1つのファイルは${mb(fileBytes)}までです`);
      const name = cleanName(body.name);
      const type = /^[\w.+-]{1,60}\/[\w.+-]{1,60}$/.test(String(body.type || '')) ? String(body.type) : '';
      const note = Array.from(String(body.note ?? '').trim()).slice(0, 500).join('');
      // a model's light copy (in the model's folder)
      const parent = body.parent ? theFile(body.parent) : null;
      if (parent && parent.parent) throw new ApiError(400, 'bad_parent', '軽量版の軽量版は作れません');
      const folder = parent ? parent.folder : placeOf(body.folder);
      const id = crypto.randomBytes(16).toString('hex');
      tx(() => {
        if (used() + size > maxBytes) throw new ApiError(413, 'vault_full', `保管庫がいっぱいです（${mb(used())} / ${mb(maxBytes)}）。いらないファイルを削除してください`);
        q('INSERT INTO vault_files (id, name, type, note, size, chunks, piece, created_by, created_at, parent, folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, name, type, note, size, Math.ceil(size / pieceBytes), pieceBytes, u.id, Date.now(), parent ? parent.id : '', folder);
      });
      return { file: fileDto(fileRow(id)) };
    },

    // what an unfinished upload still needs
    'GET /api/vault/missing': async (req, u) => {
      need(req, u);
      const f = theFile(req.query.get('id'));
      const have = await piecesOf(f);
      if (!f.done_at && have.size !== f.received) q('UPDATE vault_files SET received = ? WHERE id = ?').run(have.size, f.id);
      return { file: fileDto(fileRow(f.id)), missing: gaps(f, have) };
    },

    // one piece (base64, with its SHA-256)
    'POST /api/vault/chunk': async (req, u) => {
      need(req, u);
      const body = await req.json(pieceBody);
      const f = theFile(body.id);
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
        if (!fileRow(f.id)) { await blobs.del([pieceKey(f.id, n)]); throw new ApiError(404, 'no_file', 'ファイルが見つかりません'); }
        return { n, stored: true, chunks: f.chunks };
      }
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
      const f = theFile(body.id);
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
      const f = theFile(req.query.get('id'));
      return piece(f, pieceNo(f, req.query.get('n')));
    },

    // (with its light copy)
    'POST /api/vault/delete': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(body.id);
      await remove(f);
      opsLog.add({ actor: u, action: 'vault_delete', req, summary: `保管庫の「${f.name}」（${mb(f.size)}）を削除`, detail: { file: f.id, name: f.name, size: f.size, sha256: f.sha256 } });
      return { ok: true, used: used() };
    },

    // back from 実装済み (the links see it again)
    'POST /api/vault/restore': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(body.id);
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

    // a folder in the top of the vault or in another folder
    'POST /api/vault/folders': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const name = folderName(body.name);
      const parent = placeOf(body.parent);
      if (depthOf(parent) >= FOLDER_DEPTH) throw new ApiError(400, 'too_deep', `フォルダは${FOLDER_DEPTH}階層までです`);
      if (q('SELECT COUNT(*) AS n FROM vault_folders').get().n >= FOLDERS_MAX) throw new ApiError(409, 'too_many', `フォルダは${FOLDERS_MAX}個までです`);
      if (nameTaken(parent, name)) throw new ApiError(409, 'exists', `「${name}」はもうあります`);
      const id = crypto.randomBytes(16).toString('hex');
      q('INSERT INTO vault_folders (id, name, parent, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(id, name, parent, u.id, Date.now());
      opsLog.add({ actor: u, action: 'vault_folder', req, summary: `保管庫にフォルダ「${pathOf(id)}」を作成`, detail: { folder: id, name, parent } });
      return { folder: folderDto(folderRow(id)) };
    },

    // a new name, or a new place (never inside itself)
    'POST /api/vault/folders/update': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const d = theFolder(body.id);
      const name = body.name === undefined ? d.name : folderName(body.name);
      const parent = body.parent === undefined ? d.parent : placeOf(body.parent);
      for (let p = parent, i = 0; p && i <= FOLDERS_MAX; p = (folderRow(p) || { parent: '' }).parent, i++) {
        if (p === d.id) throw new ApiError(400, 'inside', 'フォルダをそれ自身の中には移せません');
      }
      if (depthOf(parent) + heightOf(d.id) > FOLDER_DEPTH) throw new ApiError(400, 'too_deep', `フォルダは${FOLDER_DEPTH}階層までです`);
      if (nameTaken(parent, name, d.id)) throw new ApiError(409, 'exists', `「${name}」はもうあります`);
      const before = pathOf(d.id);
      q('UPDATE vault_folders SET name = ?, parent = ? WHERE id = ?').run(name, parent, d.id);
      opsLog.add({ actor: u, action: 'vault_folder', req, summary: `保管庫のフォルダ「${before}」を「${pathOf(d.id)}」に変更`, detail: { folder: d.id, name, parent } });
      return { folder: folderDto(folderRow(d.id)) };
    },

    // a folder goes; what was in it moves up to where it was
    'POST /api/vault/folders/delete': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const d = theFolder(body.id);
      const path = pathOf(d.id);
      tx(() => {
        q('UPDATE vault_files SET folder = ? WHERE folder = ?').run(d.parent, d.id);
        q('UPDATE vault_folders SET parent = ? WHERE parent = ?').run(d.parent, d.id);
        q('DELETE FROM vault_folders WHERE id = ?').run(d.id);
      });
      opsLog.add({ actor: u, action: 'vault_folder', req, summary: `保管庫のフォルダ「${path}」を削除（中身はひとつ上へ）`, detail: { folder: d.id, parent: d.parent } });
      return { ok: true };
    },

    // files (with their light copies) into a folder ('' the top)
    'POST /api/vault/move': async (req, u) => {
      need(req, u);
      const body = await req.json(64 * 1024);
      const folder = placeOf(body.folder);
      const ids = [...new Set(Array.isArray(body.ids) ? body.ids.map(String) : [])].slice(0, MOVE_MAX);
      const files = ids.map(fileRow).filter((f) => f && !f.parent);
      if (!files.length) throw new ApiError(400, 'no_files', '移すファイルを選んでください');
      tx(() => { for (const f of files) q('UPDATE vault_files SET folder = ? WHERE id = ? OR parent = ?').run(folder, f.id, f.id); });
      opsLog.add({ actor: u, action: 'vault_move', req, summary: `保管庫の${files.length}件を「${pathOf(folder)}」へ移動`, detail: { folder, files: files.slice(0, 50).map((f) => f.name) } });
      return { moved: files.length };
    },

    // a read-only link to one whole file (`id`) or to the whole vault (id
    // '*'), good for `hours`; the secret is shown once
    'POST /api/vault/link': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const all = body.id === ALL;
      const f = all ? null : theFile(body.id);
      if (f && !f.done_at) throw new ApiError(409, 'not_done', 'アップロードが終わってからリンクを作れます');
      const hours = Number(body.hours);
      if (!LINK_HOURS.includes(hours)) throw new ApiError(400, 'bad_hours', `有効期間は ${LINK_HOURS.join(' / ')} 時間から選んでください`);
      const ai = body.ai === true;
      const token = crypto.randomBytes(32).toString('base64url');
      const until = Date.now() + hours * 3600000;
      q('INSERT INTO vault_links (token_hash, file_id, until, created_by, created_at, ai) VALUES (?, ?, ?, ?, ?, ?)').run(sha(token), all ? ALL : f.id, until, u.id, Date.now(), ai ? 1 : 0);
      const what = all ? '保管庫全体' : `保管庫の「${f.name}」`;
      opsLog.add({ actor: u, action: 'vault_link', req, summary: `${what}の${ai ? 'AI用' : '読み取り専用'}リンクを作成（${hours}時間有効）`, detail: { file: all ? ALL : f.id, name: all ? '' : f.name, hours, until, ai } });
      return { token, until, ai, path: `/api/vault/pull?t=${token}` };
    },

    // every link of a file (or of the whole vault: id '*') stops working at once
    'POST /api/vault/link/stop': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const all = body.id === ALL;
      const f = all ? null : theFile(body.id);
      const n = Number(q('UPDATE vault_links SET revoked = 1 WHERE file_id = ? AND revoked = 0 AND until > ?').run(all ? ALL : f.id, Date.now()).changes);
      opsLog.add({ actor: u, action: 'vault_link_stop', req, summary: `${all ? '保管庫全体' : `保管庫の「${f.name}」`}のリンクを停止（${n}件）`, detail: { file: all ? ALL : f.id, stopped: n } });
      return { ok: true, stopped: n };
    },

    // With a link (no login). A file's link: the file (with its picture and
    // light copy); a vault link: every file and folder (`f`: one of the
    // files). `n`: piece n of it, `preview=1`: its picture. Files in 実装済み
    // are not there. Any problem (wrong, stopped, expired) looks the same
    // from outside. An AI's link labels a file as taken (once an hour).
    'GET /api/vault/pull': async (req) => {
      rate(limits.pull, req.ip || '-');
      const l = linkOf(req.query.get('t'));
      const all = l.file_id === ALL;
      const top = all ? null : fileRow(l.file_id);
      if (!all && (!top || !top.done_at || top.implemented_at)) throw gone();
      // the file asked for: the link's own, its light copy, or (a vault link) any
      const want = req.query.get('f');
      let f = top;
      if (want) {
        const x = fileRow(want);
        f = x && x.done_at && !x.implemented_at && (all || x.id === top.id || x.parent === top.id) ? x : null;
        if (!f) throw new ApiError(404, 'no_file', 'ファイルが見つかりません');
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
        ...(l.ai ? { label: 'POST /api/vault/ai { t, f, text }', implemented: 'POST /api/vault/ai { t, f, text: where it went, implemented: true } (the file leaves the links; it stays in the vault)' } : {})
      };
      if (f) return { ...pullDto(f), until: l.until, ai: !!l.ai, how };
      return {
        vault: true, until: l.until, ai: !!l.ai,
        folders: q('SELECT * FROM vault_folders ORDER BY name').all().map(folderDto),
        files: q("SELECT * FROM vault_files WHERE done_at > 0 AND parent = '' AND implemented_at = 0 ORDER BY created_at DESC").all().map(pullDto), how
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
      if (!f || !f.done_at || f.implemented_at || f.parent || !(l.file_id === ALL || l.file_id === f.id)) throw new ApiError(404, 'no_file', 'ファイルが見つかりません');
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
    }
  };

  return { routes, summary, public: ['GET /api/vault/pull', 'POST /api/vault/ai'] };
}
