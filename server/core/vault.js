// The developer's vault: big files (3D models and the like, up to hundreds of
// MB) kept on the game's own server for the developer, to fetch from anywhere.
// Only the developer's account opens it, and only with the developer code
// (server/core/devcode.js: the same counted and logged tries) for a signed
// ticket good for 30 minutes. A file comes in 1 MiB pieces, each checked
// against its SHA-256 as it arrives (a broken upload carries on where it
// stopped); it is whole once every piece is in, and its fingerprint is the
// SHA-256 of its pieces' hashes in order. The developer can also make a
// read-only link for one file (good for 1 to 72 hours, stopped at any time;
// only the hash of its secret is kept) to fetch it somewhere else.
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
const ID_RE = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const TOKEN_RE = /^[\w-]{43}$/;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const mb = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`;

// a file name to show and to save as: no folders, no control characters
function cleanName(raw) {
  const s = Array.from(String(raw ?? '').split(/[/\\]/).pop().normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[/\\]/g, '_').replace(/^\.+/, '').trim()).slice(0, 200).join('');
  return s || 'file';
}

export function createVault({ q, tx, config, secret, opsLog, isDeveloper, devCode }) {
  const KEY = crypto.createHash('sha256').update(`${secret}:vault-ticket`).digest();
  const maxBytes = config.vaultMaxMb * 1048576, fileBytes = config.vaultFileMb * 1048576;
  // [a minute, burst]: tries to open it, pieces and lists (the developer), fetching with a link (an address)
  const L = { vaultOpen: [10, 5], vaultWork: [1200, 300], vaultPull: [600, 200], ...config.limits };
  const limits = { open: new Limiter(...L.vaultOpen), work: new Limiter(...L.vaultWork), pull: new Limiter(...L.vaultPull) };
  function rate(l, key) {
    if (!l.take(String(key))) throw new ApiError(429, 'rate_limited', '操作が速すぎます。少し待ってからもう一度お試しください');
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
  function fileDto(f, now = Date.now()) {
    const links = q('SELECT until, uses, revoked, created_at FROM vault_links WHERE file_id = ? ORDER BY created_at DESC').all(f.id);
    const live = links.filter((l) => !l.revoked && l.until > now);
    return {
      id: f.id, name: f.name, type: f.type, note: f.note, size: f.size, chunks: f.chunks, received: f.received, done: !!f.done_at,
      sha256: f.sha256, createdAt: f.created_at, doneAt: f.done_at,
      links: { live: live.length, until: live.reduce((m, l) => Math.max(m, l.until), 0), uses: links.reduce((s, l) => s + l.uses, 0) }
    };
  }
  // the piece numbers not in yet, as ranges [[from, to], …]
  function missing(f) {
    const have = new Set(q('SELECT n FROM vault_chunks WHERE file_id = ?').all(f.id).map((r) => r.n));
    const out = [];
    for (let n = 0; n < f.chunks; n++) {
      if (have.has(n)) continue;
      const last = out[out.length - 1];
      if (last && last[1] === n - 1) last[1] = n; else out.push([n, n]);
    }
    return out;
  }
  function piece(f, n) {
    const c = q('SELECT n, sha256, data FROM vault_chunks WHERE file_id = ? AND n = ?').get(f.id, n);
    if (!c) throw new ApiError(404, 'no_piece', 'この部分はまだありません');
    return { n: c.n, sha256: c.sha256, data: c.data };
  }
  function pieceNo(f, raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n >= f.chunks) throw new ApiError(400, 'bad_piece', '部分の番号が正しくありません');
    return n;
  }

  const routes = {
    // the developer code opens it for 30 minutes
    'POST /api/vault/open': async (req, u) => {
      if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '保管庫は開発者のアカウントだけが使えます');
      rate(limits.open, u.id);
      const body = await req.json();
      await devCode.check(body.code, req, u);
      opsLog.add({ actor: u, action: 'vault_open', req, summary: '開発者が保管庫を開いた（開発者コードで）', detail: {} });
      return { ticket: ticketFor(u), until: Date.now() + TICKET_MS, chunk: CHUNK, maxBytes, fileBytes, used: used(), hours: LINK_HOURS };
    },

    'GET /api/vault/files': (req, u) => {
      need(req, u);
      const now = Date.now();
      return { files: q('SELECT * FROM vault_files ORDER BY created_at DESC').all().map((f) => fileDto(f, now)), used: used(), maxBytes, fileBytes, chunk: CHUNK, now };
    },

    // a new file: its name, size and type; the pieces follow
    'POST /api/vault/files': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const size = Number(body.size);
      if (!Number.isSafeInteger(size) || size < 1) throw new ApiError(400, 'bad_size', 'ファイルの大きさが正しくありません');
      if (size > fileBytes) throw new ApiError(413, 'too_large', `1つのファイルは${mb(fileBytes)}までです`);
      const name = cleanName(body.name);
      const type = /^[\w.+-]{1,60}\/[\w.+-]{1,60}$/.test(String(body.type || '')) ? String(body.type) : '';
      const note = Array.from(String(body.note ?? '').trim()).slice(0, 500).join('');
      const id = crypto.randomBytes(16).toString('hex');
      tx(() => {
        if (used() + size > maxBytes) throw new ApiError(413, 'vault_full', `保管庫がいっぱいです（${mb(used())} / ${mb(maxBytes)}）。いらないファイルを削除してください`);
        q('INSERT INTO vault_files (id, name, type, note, size, chunks, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(id, name, type, note, size, Math.ceil(size / CHUNK), u.id, Date.now());
      });
      return { file: fileDto(fileRow(id)) };
    },

    // what an unfinished upload still needs
    'GET /api/vault/missing': (req, u) => {
      need(req, u);
      const f = theFile(req.query.get('id'));
      return { file: fileDto(f), missing: missing(f) };
    },

    // one piece (base64 of at most 1 MiB, with its SHA-256)
    'POST /api/vault/chunk': async (req, u) => {
      need(req, u);
      const body = await req.json(2 * 1024 * 1024);
      const f = theFile(body.id);
      if (f.done_at) throw new ApiError(409, 'done', 'このファイルはもうそろっています');
      const n = pieceNo(f, body.n);
      const want = String(body.sha256 || '').toLowerCase();
      const data = String(body.data || '');
      if (!HEX64.test(want) || !B64.test(data)) throw new ApiError(400, 'bad_piece', '部分の形式が正しくありません');
      const bytes = Buffer.from(data, 'base64');
      const expect = n === f.chunks - 1 ? f.size - n * CHUNK : CHUNK;
      if (bytes.length !== expect) throw new ApiError(400, 'bad_piece', '部分の大きさが正しくありません');
      if (sha(bytes) !== want) throw new ApiError(400, 'bad_hash', '部分が途中で壊れています（ハッシュが一致しません）。もう一度送ってください');
      const out = tx(() => {
        q('INSERT INTO vault_chunks (file_id, n, sha256, data) VALUES (?, ?, ?, ?) ON CONFLICT(file_id, n) DO UPDATE SET sha256 = excluded.sha256, data = excluded.data')
          .run(f.id, n, want, bytes.toString('base64'));
        const received = q('SELECT COUNT(*) AS n FROM vault_chunks WHERE file_id = ?').get(f.id).n;
        let sum = '';
        if (received === f.chunks) {
          const all = Buffer.concat(q('SELECT sha256 FROM vault_chunks WHERE file_id = ? ORDER BY n').all(f.id).map((r) => Buffer.from(r.sha256, 'hex')));
          sum = sha(all);
          q('UPDATE vault_files SET received = ?, sha256 = ?, done_at = ? WHERE id = ? AND done_at = 0').run(received, sum, Date.now(), f.id);
        } else {
          q('UPDATE vault_files SET received = ? WHERE id = ?').run(received, f.id);
        }
        return { received, sum };
      });
      if (out.sum) opsLog.add({ actor: u, action: 'vault_upload', req, summary: `保管庫に「${f.name}」（${mb(f.size)}）を保存`, detail: { file: f.id, name: f.name, size: f.size, chunks: f.chunks, sha256: out.sum } });
      return { received: out.received, chunks: f.chunks, done: !!out.sum, sha256: out.sum };
    },

    // one piece back (the site puts the file together and checks every hash)
    'GET /api/vault/chunk': (req, u) => {
      need(req, u);
      const f = theFile(req.query.get('id'));
      return piece(f, pieceNo(f, req.query.get('n')));
    },

    'POST /api/vault/delete': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(body.id);
      tx(() => {
        q('DELETE FROM vault_chunks WHERE file_id = ?').run(f.id);
        q('DELETE FROM vault_links WHERE file_id = ?').run(f.id);
        q('DELETE FROM vault_files WHERE id = ?').run(f.id);
      });
      opsLog.add({ actor: u, action: 'vault_delete', req, summary: `保管庫の「${f.name}」（${mb(f.size)}）を削除`, detail: { file: f.id, name: f.name, size: f.size, sha256: f.sha256 } });
      return { ok: true, used: used() };
    },

    // a read-only link to one whole file, good for `hours`; the secret is shown once
    'POST /api/vault/link': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(body.id);
      if (!f.done_at) throw new ApiError(409, 'not_done', 'アップロードが終わってからリンクを作れます');
      const hours = Number(body.hours);
      if (!LINK_HOURS.includes(hours)) throw new ApiError(400, 'bad_hours', `有効期間は ${LINK_HOURS.join(' / ')} 時間から選んでください`);
      const token = crypto.randomBytes(32).toString('base64url');
      const until = Date.now() + hours * 3600000;
      q('INSERT INTO vault_links (token_hash, file_id, until, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(sha(token), f.id, until, u.id, Date.now());
      opsLog.add({ actor: u, action: 'vault_link', req, summary: `保管庫の「${f.name}」の読み取り専用リンクを作成（${hours}時間有効）`, detail: { file: f.id, name: f.name, hours, until } });
      return { token, until, path: `/api/vault/pull?t=${token}` };
    },

    // every link of a file stops working at once
    'POST /api/vault/link/stop': async (req, u) => {
      need(req, u);
      const body = await req.json();
      const f = theFile(body.id);
      const n = Number(q('UPDATE vault_links SET revoked = 1 WHERE file_id = ? AND revoked = 0 AND until > ?').run(f.id, Date.now()).changes);
      opsLog.add({ actor: u, action: 'vault_link_stop', req, summary: `保管庫の「${f.name}」のリンクを停止（${n}件）`, detail: { file: f.id, stopped: n } });
      return { ok: true, stopped: n };
    },

    // With a link (no login): the file's details, or piece `n` of it. Any
    // problem (wrong, stopped, expired) looks the same from outside.
    'GET /api/vault/pull': (req) => {
      rate(limits.pull, req.ip || '-');
      const token = String(req.query.get('t') || '');
      const now = Date.now();
      const l = TOKEN_RE.test(token) ? q('SELECT * FROM vault_links WHERE token_hash = ?').get(sha(token)) : null;
      const f = l && !l.revoked && l.until > now ? fileRow(l.file_id) : null;
      if (!f || !f.done_at) throw new ApiError(404, 'no_link', 'リンクが無効か、有効期限が切れています');
      const n = req.query.get('n');
      if (n !== null && n !== '') return piece(f, pieceNo(f, n));
      q('UPDATE vault_links SET uses = uses + 1 WHERE token_hash = ?').run(l.token_hash);
      opsLog.add({ actorName: 'リンク', action: 'vault_pull', req, summary: `保管庫の「${f.name}」がリンクから取得された`, detail: { file: f.id, name: f.name, uses: l.uses + 1, until: l.until } });
      return { name: f.name, type: f.type, size: f.size, chunks: f.chunks, chunk: CHUNK, sha256: f.sha256, until: l.until, hashes: 'sha256 of each piece; the file\'s sha256 is the SHA-256 of all piece digests in order' };
    }
  };

  return { routes, public: ['GET /api/vault/pull'] };
}
