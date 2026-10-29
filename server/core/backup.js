// Backups of everything but the vault (every player, their money, chats,
// the logs …: server/core/admin.js export), for the developer only.
// Every 5 hours, 12 hours, a day, or only by hand; the newest automatic ones
// are kept (10, 30, 100 or all), the ones made by hand until deleted.
// Each is compressed and encrypted for the developer's key: an ECDH P-256
// key pair made in the developer's browser, whose private half the server
// keeps only locked with the developer code (PBKDF2, 600,000 rounds, then
// AES-GCM). So the server makes them on its own, but nobody can open one
// without the developer code: the developer's browser unlocks the key,
// opens the backup and saves it as a file (ops/ops.js). Nothing here works
// for anyone but the developer's account, and nothing without the developer
// code (the list after it, for 15 minutes); every step is logged
// (セキュリティ). They are kept in the R2 bucket when there is one, else in
// the database.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';

const subtle = globalThis.crypto.subtle;
const TICKET_MS = 15 * 60000;
export const EVERY = { off: 0, '5h': 5 * 3600000, '12h': 12 * 3600000, '24h': 24 * 3600000 };
export const KEEP = [10, 30, 100, 0];
const PART = 1536 * 1024;
const INFO = new TextEncoder().encode('TWO STATE backup v1');
const ID_RE = /^[0-9a-f]{32}$/;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function gzip(text) {
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
// the bytes, for the developer's public key: { epk, iv, data }
async function seal(publicJwk, bytes) {
  const pub = await subtle.importKey('jwk', publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: INFO }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.randomBytes(12);
  const data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const epk = await subtle.exportKey('jwk', eph.publicKey);
  return { epk: { kty: epk.kty, crv: epk.crv, x: epk.x, y: epk.y }, iv: Buffer.from(iv).toString('base64'), data };
}
function publicKey(raw) {
  const k = raw && typeof raw === 'object' ? raw : {};
  const b64u = /^[A-Za-z0-9_-]{43}$/;
  if (k.kty !== 'EC' || k.crv !== 'P-256' || !b64u.test(String(k.x)) || !b64u.test(String(k.y))) throw new ApiError(400, 'bad_key', '鍵の形式が正しくありません');
  return { kty: 'EC', crv: 'P-256', x: k.x, y: k.y };
}
function lockedKey(raw) {
  const w = raw && typeof raw === 'object' ? raw : {};
  const b64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const valid = (value, min, max) => {
    if (typeof value !== 'string' || value.length > max * 2 || !b64.test(value)) return false;
    const bytes = Buffer.from(value, 'base64');
    return bytes.length >= min && bytes.length <= max && bytes.toString('base64') === value;
  };
  const rounds = Number(w.rounds);
  if (!valid(w.salt, 16, 64) || !valid(w.iv, 12, 12) || !valid(w.data, 16, 3072) ||
      !Number.isSafeInteger(rounds) || rounds < 600000 || rounds > 0xffffffff) {
    throw new ApiError(400, 'bad_key', '鍵の形式が正しくありません');
  }
  return { salt: w.salt, iv: w.iv, data: w.data, rounds };
}

// exportAll() -> { tables, … }; blobs: the vault's bucket (or null); onChange(): the schedule changed
export function createBackup({ q, tx, opsLog, devCode, isDeveloper, exportAll, blobs = null, secret, onChange = () => {} }) {
  const KEY = crypto.createHash('sha256').update(`${secret}:backup-ticket`).digest();
  const meta = (k, fallback) => { try { const r = q('SELECT value FROM meta WHERE key = ?').get(k); return r ? JSON.parse(r.value) : fallback; } catch { return fallback; } };
  const setMeta = (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
  function settings() {
    const s = meta('backup_settings', null);
    return { every: Object.hasOwn(EVERY, s?.every) ? s.every : 'off', keep: KEEP.includes(s?.keep) ? s.keep : 30 };
  }
  const keyOf = () => meta('backup_key', null);
  let running = 0, automatic = null;

  const sign = (body) => crypto.createHmac('sha256', KEY).update(body).digest('base64url');
  function ticketFor(u) {
    const body = `${u.id}.${Date.now() + TICKET_MS}`;
    return `${body}.${sign(body)}`;
  }
  function needDeveloper(u) {
    if (!isDeveloper(u)) throw new ApiError(404, 'not_found', 'APIが見つかりません');
  }
  function needTicket(req, u) {
    needDeveloper(u);
    const m = /^(\d{1,15})\.(\d{13})\.([\w-]{43})$/.exec(String(req.header('x-backup-ticket') || ''));
    const ok = m && Number(m[1]) === u.id && Number(m[2]) > Date.now() && crypto.timingSafeEqual(Buffer.from(m[3]), Buffer.from(sign(`${m[1]}.${m[2]}`)));
    if (!ok) throw new ApiError(403, 'backup_locked', 'バックアップが閉じています。開発者コードを入力して開いてください');
  }
  // the developer, with the developer code again (whatever changes or opens a backup)
  async function needCode(req, u, body) {
    needTicket(req, u);
    await devCode.check(body.code, req, u);
  }

  const row = (id) => (ID_RE.test(String(id || '')) ? q('SELECT * FROM backups WHERE id = ?').get(String(id)) : null);
  const dto = (b) => ({ id: b.id, at: b.at, kind: b.kind, size: b.size, sealed: b.sealed, sha256: b.sha256, store: b.store, tables: JSON.parse(b.counts || '{}') });
  const lastAuto = () => (q("SELECT at FROM backups WHERE kind = 'auto' ORDER BY at DESC LIMIT 1").get() || { at: 0 }).at;
  // (one that failed is tried again in half an hour)
  let failedAt = 0;
  function nextDue() {
    const s = settings();
    if (!EVERY[s.every] || !keyOf()) return 0;
    return Math.max(Date.now(), lastAuto() + EVERY[s.every], failedAt + 30 * 60000);
  }

  async function put(id, bytes) {
    if (blobs) { await blobs.put(`backups/${id}`, bytes, sha(bytes)); return { store: 'bucket', parts: 0 }; }
    const b64 = Buffer.from(bytes).toString('base64');
    let n = 0;
    for (let i = 0; i < b64.length; i += PART, n++) q('INSERT INTO backup_parts (backup_id, n, data) VALUES (?, ?, ?)').run(id, n, b64.slice(i, i + PART));
    return { store: 'db', parts: n };
  }
  async function get(b) {
    if (b.store === 'bucket') {
      const o = blobs ? await blobs.get(`backups/${b.id}`) : null;
      if (!o) throw new ApiError(404, 'gone', 'バックアップのデータが見つかりません');
      return Buffer.from(o.bytes);
    }
    return Buffer.from(q('SELECT data FROM backup_parts WHERE backup_id = ? ORDER BY n').all(b.id).map((p) => p.data).join(''), 'base64');
  }
  async function remove(b) {
    if (b.store === 'bucket' && blobs) await blobs.del([`backups/${b.id}`]);
    tx(() => {
      q('DELETE FROM backup_parts WHERE backup_id = ?').run(b.id);
      q('DELETE FROM backups WHERE id = ?').run(b.id);
    });
  }

  // one backup now ('auto' or 'manual')
  async function run(kind, by = null, req = null) {
    running++;
    try { return await makeBackup(kind, by, req); }
    finally { running--; }
  }
  function runAutomatic() {
    if (!automatic) automatic = run('auto').finally(() => { automatic = null; });
    return automatic;
  }
  async function makeBackup(kind, by, req) {
    const key = keyOf();
    if (!key) throw new ApiError(409, 'no_key', '先にバックアップの鍵を作ってください');
    const started = Date.now();
    const data = exportAll();
    const counts = Object.fromEntries(Object.entries(data.tables).map(([t, rows]) => [t, rows.length]));
    const plain = await gzip(JSON.stringify(data));
    const s = await seal(key.public, plain);
    const id = crypto.randomBytes(16).toString('hex');
    const envelope = { format: 'two-state-backup', v: 1, id, at: started, epk: s.epk, iv: s.iv, schema: data.schema };
    let where;
    try {
      where = await put(id, s.data);
      q(`INSERT INTO backups (id, at, kind, size, sealed, sha256, store, parts, envelope, counts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, started, kind, plain.length, s.data.length, sha(s.data), where.store, where.parts, JSON.stringify(envelope), JSON.stringify(counts));
    } catch (error) {
      // Never leave unreachable parts consuming the space needed for the next attempt.
      try {
        q('DELETE FROM backup_parts WHERE backup_id = ?').run(id);
        if (blobs) await blobs.del([`backups/${id}`]);
      } catch (cleanup) { console.error('backup cleanup failed', cleanup?.message); }
      throw error;
    }
    // the oldest automatic ones beyond the number kept
    const removed = [];
    const keep = settings().keep;
    if (kind === 'auto' && keep > 0) {
      for (const old of q("SELECT * FROM backups WHERE kind = 'auto' ORDER BY at DESC LIMIT -1 OFFSET ?").all(keep)) { await remove(old); removed.push(old.id); }
    }
    const players = counts.users || 0;
    opsLog.add({
      actor: by, actorName: 'システム', action: 'backup_run', req,
      summary: `バックアップを作成（${kind === 'auto' ? `自動・${settings().every.replace('h', '時間')}ごと` : '手動'}・プレイヤー ${players}人・${(s.data.length / 1048576).toFixed(2)}MB・暗号化済み）`,
      detail: { id, kind, at: started, ms: Date.now() - started, size: plain.length, sealed: s.data.length, sha256: sha(s.data), store: where.store, tables: counts, removedOld: removed }
    });
    return dto(row(id));
  }

  const routes = {
    // the developer code opens the list for 15 minutes
    'POST /api/backup/open': async (req, u) => {
      needDeveloper(u);
      const body = await req.json();
      await devCode.check(body.code, req, u);
      return { ticket: ticketFor(u), until: Date.now() + TICKET_MS };
    },
    'GET /api/backup': (req, u) => {
      needTicket(req, u);
      const k = keyOf();
      return {
        settings: settings(), every: Object.keys(EVERY), keepChoices: KEEP, key: k ? { at: k.at } : null, store: blobs ? 'bucket' : 'db',
        next: nextDue(), backups: q('SELECT * FROM backups ORDER BY at DESC LIMIT 500').all().map(dto), now: Date.now()
      };
    },
    // the developer's key: made in their browser, the private half locked with the developer code
    'POST /api/backup/key': async (req, u) => {
      const body = await req.json(16 * 1024);
      await needCode(req, u, body);
      const pub = publicKey(body.public), locked = lockedKey(body.locked);
      try { await subtle.importKey('jwk', pub, { name: 'ECDH', namedCurve: 'P-256' }, false, []); }
      catch { throw new ApiError(400, 'bad_key', '鍵の形式が正しくありません'); }
      req.revalidate?.(); needTicket(req, u);
      const previous = keyOf(), had = !!previous;
      const replacing = had && JSON.stringify(previous.public) !== JSON.stringify(pub);
      if (replacing && running) throw new ApiError(409, 'backup_busy', 'バックアップの作成中は鍵を変更できません');
      if (replacing && q('SELECT 1 FROM backups LIMIT 1').get()) throw new ApiError(409, 'backup_key_in_use', '保存済みバックアップに必要な鍵です。鍵の再作成はできません');
      setMeta('backup_key', { public: pub, locked, at: Date.now() });
      onChange();
      opsLog.add({ actor: u, action: 'backup_key', req, summary: had ? 'バックアップの鍵を作り直した（これからのバックアップは新しい鍵で暗号化）' : 'バックアップの鍵を作成', detail: { replaced: had, rewrapped: !!body.rewrap } });
      return { ok: true };
    },
    // the locked key (to open a backup, or to lock it again with a new developer code)
    'POST /api/backup/locked-key': async (req, u) => {
      const body = await req.json();
      await needCode(req, u, body);
      const k = keyOf();
      if (!k) throw new ApiError(409, 'no_key', 'バックアップの鍵がありません');
      return { public: k.public, locked: k.locked };
    },
    'POST /api/backup/settings': async (req, u) => {
      const body = await req.json();
      await needCode(req, u, body);
      const every = String(body.every || '');
      const keep = Number(body.keep);
      if (!Object.hasOwn(EVERY, every)) throw new ApiError(400, 'bad_every', '頻度を選んでください');
      if (!KEEP.includes(keep)) throw new ApiError(400, 'bad_keep', '残す数を選んでください');
      const before = settings();
      setMeta('backup_settings', { every, keep });
      onChange();
      opsLog.add({ actor: u, action: 'backup_settings', req, summary: `バックアップの設定を変更（${every === 'off' ? '手動のみ' : every.replace('h', '時間') + 'ごと'}・自動のものを${keep ? keep + '個' : 'すべて'}残す）`, detail: { before, after: { every, keep } } });
      return { settings: settings(), next: nextDue() };
    },
    'POST /api/backup/run': async (req, u) => {
      const body = await req.json();
      await needCode(req, u, body);
      return { backup: await run('manual', u, req) };
    },
    // one backup, still encrypted (the developer's browser opens it)
    'POST /api/backup/get': async (req, u) => {
      const body = await req.json();
      await needCode(req, u, body);
      const b = row(body.id);
      if (!b) throw new ApiError(404, 'not_found', 'バックアップが見つかりません');
      const bytes = await get(b);
      if (sha(bytes) !== b.sha256) throw new ApiError(500, 'broken', 'バックアップのデータが壊れています（ハッシュが一致しません）');
      const k = keyOf();
      opsLog.add({ actor: u, action: 'backup_get', req, summary: `${new Date(b.at).toISOString().slice(0, 16).replace('T', ' ')}（UTC）のバックアップを開発者がダウンロード`, detail: { id: b.id, at: b.at, kind: b.kind, sha256: b.sha256 } });
      return { envelope: JSON.parse(b.envelope), data: bytes.toString('base64'), locked: k ? k.locked : null };
    },
    'POST /api/backup/delete': async (req, u) => {
      const body = await req.json();
      await needCode(req, u, body);
      const b = row(body.id);
      if (!b) throw new ApiError(404, 'not_found', 'バックアップが見つかりません');
      await remove(b);
      opsLog.add({ actor: u, action: 'backup_delete', req, summary: `バックアップ（${b.kind === 'auto' ? '自動' : '手動'}・${new Date(b.at).toISOString().slice(0, 16).replace('T', ' ')} UTC）を削除`, detail: { id: b.id, at: b.at, sha256: b.sha256 } });
      return { ok: true };
    }
  };

  return {
    routes,
    nextDue,
    hasKey: () => !!keyOf(),
    // the lockdown protects the data: one encrypted backup now, if there is a
    // key (nothing leaves the server — it is sealed for the developer's key
    // and kept in the bucket or the database). Best-effort.
    async lockdownBackup() {
      if (!keyOf()) return null;
      try { return await runAutomatic(); } catch (e) {
        opsLog.add({ actorName: 'システム', action: 'backup_failed', summary: `ロックダウン時のバックアップに失敗：${String((e && e.message) || e).slice(0, 200)}`, detail: { error: String((e && e.stack) || e).slice(0, 2000) } });
        return null;
      }
    },
    // the automatic one, when it is time (from the housekeeping)
    async due() {
      const at = nextDue();
      if (!at || at > Date.now()) return null;
      try { return await runAutomatic(); } catch (e) {
        failedAt = Date.now();
        opsLog.add({ actorName: 'システム', action: 'backup_failed', summary: `自動バックアップに失敗しました：${String((e && e.message) || e).slice(0, 200)}`, detail: { error: String((e && e.stack) || e).slice(0, 2000) } });
        return null;
      }
    }
  };
}
