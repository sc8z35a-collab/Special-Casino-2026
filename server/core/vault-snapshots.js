// Incremental private R2 archives. Jobs resume after a restart; verification never writes the live vault.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';

const DAY = 86400000, MINUTE = 60000, PREFIX = 'vault-snapshots/', MAX_MANIFEST = 16 * 1024 * 1024;
const TABLES = { vault_files: 'id', vault_folders: 'id', vault_notes: 'id', vault_quotas: 'user_id', vault_requests: 'id' };
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const rowHash = (row) => digest(JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]])));
const objectKey = (sha) => PREFIX + 'objects/' + sha;
const manifestKey = (id) => PREFIX + 'manifests/' + id;
const stageKey = (id) => PREFIX + 'staging/' + id;
const validHash = (sha) => /^[0-9a-f]{64}$/.test(sha);

async function encode(root) {
  const text = JSON.stringify(root);
  if (Buffer.byteLength(text) > MAX_MANIFEST) throw new Error('snapshot metadata exceeds the manifest budget');
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function decode(bytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(), parts = [];
  let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.length;
    if (size > MAX_MANIFEST) { await reader.cancel(); throw new Error('snapshot metadata is too large'); }
    parts.push(Buffer.from(part.value));
  }
  const root = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (root.format !== 'vault-snapshot-v1') throw new Error('unsupported snapshot format');
  return root;
}

export function createVaultSnapshots({ q, tx, blobs, authorize, clock = Date.now, enabled = true, every = DAY, keep = 7, batch = 32, onChange = () => {}, log = () => {} }) {
  const active = !!blobs && typeof blobs.list === 'function' && enabled, owner = crypto.randomBytes(12).toString('hex');
  let busy = false;
  function read() {
    const row = q("SELECT value FROM meta WHERE key = 'vault_snapshots'").get();
    return row ? JSON.parse(row.value) : { next: clock() + MINUTE, lastFull: 0, history: [], job: null, error: '' };
  }
  function write(value) {
    q("INSERT INTO meta(key,value) VALUES('vault_snapshots',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(value));
  }
  if (active && !q("SELECT 1 AS yes FROM meta WHERE key='vault_snapshots'").get()) write(read());
  function status() {
    const s = read(), job = s.job;
    return { enabled: active, every, keep, nextAt: active ? (job ? job.next : s.next) : 0, error: s.error,
      job: job ? { id: job.id, mode: job.mode, phase: job.phase, cursor: job.cursor, copied: job.copied, reused: job.reused } : null,
      snapshots: s.history };
  }
  const nextDue = () => active ? status().nextAt : 0;
  function saveJob(job) {
    tx(() => {
      const s = read();
      if (!s.job || s.job.id !== job.id || s.job.owner !== owner) throw new Error('snapshot lease changed');
      job.lease = clock() + 2 * MINUTE; job.next = clock() + MINUTE; s.job = job; write(s);
    });
  }
  async function getManifest(key, hash) {
    const object = await blobs.get(key);
    if (!object || digest(object.bytes) !== hash) throw new Error('snapshot manifest is missing or damaged');
    return { root: await decode(object.bytes), bytes: object.bytes };
  }
  async function checked(ref) {
    const object = await blobs.get(objectKey(ref.sha));
    if (!object || object.bytes.length !== ref.size || digest(object.bytes) !== ref.sha) {
      const error = new Error('snapshot object is missing or damaged'); error.badHash = ref.sha; throw error;
    }
    return object.bytes;
  }
  function references(root) { return root.objects; }
  function structure(root) {
    const files = root.tables.vault_files.map((entry) => entry.row), folders = root.tables.vault_folders.map((entry) => entry.row);
    const byFile = new Map(files.map((file) => [file.id, file])), byFolder = new Map(folders.map((folder) => [folder.id, folder]));
    const byPieces = new Map();
    for (const part of root.pieces) { if (!byPieces.has(part.file)) byPieces.set(part.file, []); byPieces.get(part.file).push(part); }
    for (const folder of folders) {
      const seen = new Set([folder.id]); let parent = folder.parent;
      while (parent) { if (seen.has(parent) || !byFolder.has(parent)) throw new Error('snapshot folder tree is incomplete'); seen.add(parent); parent = byFolder.get(parent).parent; }
    }
    for (const file of files) {
      if (file.folder && !byFolder.has(file.folder)) throw new Error('snapshot file folder is missing');
      if (file.parent && !byFile.has(file.parent)) throw new Error('snapshot parent file is missing');
      const seen = new Set([file.id]); let parent = file.parent;
      while (parent) { if (seen.has(parent) || !byFile.has(parent)) throw new Error('snapshot file tree is incomplete'); seen.add(parent); parent = byFile.get(parent).parent; }
      if (file.inside && !byFile.has(file.inside)) throw new Error('snapshot containing file is missing');
      const parts = (byPieces.get(file.id) || []).sort((a, b) => a.n - b.n);
      if (parts.length !== file.chunks || parts.some((part, i) => part.n !== i) || parts.reduce((n, part) => n + part.size, 0) !== file.size) throw new Error('snapshot file pieces are incomplete');
      if (digest(Buffer.concat(parts.map((part) => Buffer.from(part.sha, 'hex')))) !== file.sha256) throw new Error('snapshot file fingerprint does not match');
    }
    for (const entry of root.tables.vault_notes) if (!byFile.has(entry.row.file_id)) throw new Error('snapshot note file is missing');
    return { files: files.length, folders: folders.length, bytes: files.reduce((n, file) => n + file.size, 0) };
  }
  async function capture(job) {
    // Large text fields are content-addressed too; only small descriptors stay in memory/the manifest.
    const root = tx(() => {
      const root = { format: 'vault-snapshot-v1', at: clock(), tables: {}, objects: [], pieces: [] };
      for (const [table, key] of Object.entries(TABLES)) {
        root.tables[table] = [];
        const where = table === 'vault_files' ? ' WHERE done_at > 0' : table === 'vault_notes' ? ' WHERE file_id IN (SELECT id FROM vault_files WHERE done_at > 0)' : '';
        for (const id of q(`SELECT ${key} AS id FROM ${table}${where} ORDER BY ${key}`).all()) {
          const row = q(`SELECT * FROM ${table} WHERE ${key} = ?`).get(id.id), hash = rowHash(row), text = {};
          for (const [field, value] of Object.entries(row)) if (typeof value === 'string' && value.length > 512) {
            const bytes = Buffer.from(value); text[field] = { sha: digest(bytes), size: bytes.length }; delete row[field];
            root.objects.push({ ...text[field], source: { kind: 'field', table, key, id: id.id, field } });
          }
          root.tables[table].push({ row, text, hash });
        }
      }
      return root;
    });
    const bucket = new Map((await blobs.list('vault/')).map((object) => [object.key, object.sha256]));
    for (const entry of root.tables.vault_files) {
      const file = entry.row, dbParts = new Map(q('SELECT n,sha256 FROM vault_chunks WHERE file_id=?').all(file.id).map((part) => [part.n, part.sha256]));
      // A file may have finished just after the bucket listing.
      if (Array.from({ length: file.chunks }, (_, n) => n).some((n) => !dbParts.has(n) && !bucket.has(`vault/${file.id}/${n}`))) {
        for (const object of await blobs.list(`vault/${file.id}/`)) bucket.set(object.key, object.sha256);
      }
      for (let n = 0; n < file.chunks; n++) {
        const sha = dbParts.get(n) || bucket.get(`vault/${file.id}/${n}`), size = Math.min(file.piece, file.size - n * file.piece);
        if (!validHash(sha)) throw new Error('snapshot source piece is missing');
        root.pieces.push({ file: file.id, n, sha, size });
        root.objects.push({ sha, size, source: { kind: dbParts.has(n) ? 'db' : 'bucket', file: file.id, n } });
      }
    }
    structure(root);
    const unique = new Map();
    for (const ref of root.objects) {
      if (unique.has(ref.sha) && unique.get(ref.sha).size !== ref.size) throw new Error('snapshot object size conflict');
      if (!unique.has(ref.sha)) unique.set(ref.sha, ref);
    }
    root.objects = [...unique.values()];
    const bytes = await encode(root); job.hash = digest(bytes); job.at = root.at;
    await blobs.put(stageKey(job.id), bytes, job.hash);
    job.phase = 'copy'; job.cursor = 0; saveJob(job);
    return { root, bytes };
  }
  async function sourceBytes(ref) {
    const source = ref.source;
    if (source.kind === 'bucket') return (await blobs.get(`vault/${source.file}/${source.n}`))?.bytes;
    if (source.kind === 'db') { const row = q('SELECT data FROM vault_chunks WHERE file_id=? AND n=?').get(source.file, source.n); return row ? Buffer.from(row.data, 'base64') : null; }
    if (source.kind === 'field' && Object.hasOwn(TABLES, source.table) && TABLES[source.table] === source.key && /^[a-z_]{1,40}$/.test(source.field)) {
      const row = q(`SELECT ${source.field} AS value FROM ${source.table} WHERE ${source.key}=?`).get(source.id);
      return row && typeof row.value === 'string' ? Buffer.from(row.value) : null;
    }
    throw new Error('invalid snapshot source');
  }
  async function restoreRow(entry) {
    const row = { ...entry.row };
    for (const [field, ref] of Object.entries(entry.text)) row[field] = new TextDecoder('utf-8', { fatal: true }).decode(await checked(ref));
    if (rowHash(row) !== entry.hash) throw new Error('restored snapshot record does not match');
    return row;
  }
  async function collect(history, job) {
    const live = new Set(), manifests = new Set(history.map((entry) => manifestKey(entry.id)));
    // Abort collection if any retained manifest is unreadable; never guess which data is expendable.
    for (const entry of history) for (const ref of references((await getManifest(manifestKey(entry.id), entry.hash)).root)) live.add(objectKey(ref.sha));
    const objects = await blobs.list(PREFIX);
    const stale = objects.filter((object) => object.key.startsWith(PREFIX + 'objects/') ? !live.has(object.key) : object.key.startsWith(PREFIX + 'manifests/') ? !manifests.has(object.key) : object.key.startsWith(PREFIX + 'staging/')).map((object) => object.key);
    for (let i = 0; i < stale.length; i += 512) { saveJob(job); await blobs.del(stale.slice(i, i + 512)); }
  }
  async function tick({ force = false, verify = '' } = {}) {
    if (!active || busy) return status();
    busy = true; let job;
    try {
      job = tx(() => {
        const s = read(), now = clock();
        if (s.job && s.job.owner !== owner && s.job.lease > now) return null;
        if (!s.job) {
          if (verify) {
            const entry = s.history.find((entry) => entry.id === verify);
            if (!entry) throw new ApiError(404, 'not_found', 'スナップショットが見つかりません');
            s.job = { id: entry.id, hash: entry.hash, at: entry.at, mode: 'verify', phase: 'data', full: true, cursor: 0, copied: 0, reused: 0 };
          } else {
            if (!force && s.next > now) return null;
            s.job = { id: crypto.randomBytes(16).toString('hex'), mode: 'snapshot', phase: 'capture', full: !s.lastFull || now - s.lastFull >= 7 * DAY, cursor: 0, copied: 0, reused: 0 };
          }
        }
        s.job.owner = owner; s.job.lease = now + 2 * MINUTE; s.job.next = now + MINUTE; s.error = ''; write(s); return s.job;
      });
      if (!job) return status();
      const archive = job.phase === 'capture' ? await capture(job) : await getManifest(job.mode === 'verify' || job.phase === 'collect' ? manifestKey(job.id) : stageKey(job.id), job.hash);
      const root = archive.root, refs = references(root), records = Object.values(root.tables).flat();
      let budget = batch;
      if (job.phase === 'copy') {
        while (job.cursor < refs.length && budget-- > 0) {
          const ref = refs[job.cursor], key = objectKey(ref.sha);
          const have = blobs.head ? await blobs.head(key) : await blobs.get(key);
          if (have?.sha256 === ref.sha && !(read().badObjects || []).includes(ref.sha)) job.reused++;
          else {
            const bytes = await sourceBytes(ref);
            if (!bytes || bytes.length !== ref.size || digest(bytes) !== ref.sha) throw new Error('snapshot source changed or is damaged');
            await blobs.put(key, bytes, ref.sha); await checked(ref); job.copied++;
          }
          job.cursor++; saveJob(job);
        }
        if (job.cursor === refs.length) { job.phase = job.full ? 'data' : 'restore'; job.cursor = 0; saveJob(job); }
      }
      if (job.phase === 'data') {
        while (job.cursor < refs.length && budget-- > 0) { await checked(refs[job.cursor++]); saveJob(job); }
        if (job.cursor === refs.length) { job.phase = 'restore'; job.cursor = 0; saveJob(job); }
      }
      if (job.phase === 'restore') {
        while (job.cursor < records.length && budget-- > 0) { await restoreRow(records[job.cursor++]); saveJob(job); }
        if (job.cursor === records.length) {
          const proof = structure(root), now = clock();
          if (job.mode === 'snapshot') { await blobs.put(manifestKey(job.id), archive.bytes, job.hash); await getManifest(manifestKey(job.id), job.hash); }
          tx(() => {
            const s = read(); if (!s.job || s.job.id !== job.id || s.job.owner !== owner) throw new Error('snapshot lease changed');
            const result = { id: job.id, hash: job.hash, at: job.at, ...proof, objects: refs.length, checkedAt: now, check: job.full ? 'full' : 'incremental' };
            s.history = job.mode === 'verify' ? s.history.map((entry) => entry.id === job.id ? result : entry) : [result, ...s.history.filter((entry) => entry.id !== job.id)].slice(0, keep);
            if (job.full) s.lastFull = now;
            const verified = new Set(refs.map((ref) => ref.sha)); s.badObjects = (s.badObjects || []).filter((sha) => !verified.has(sha));
            s.next = job.mode === 'verify' ? s.next : now + every; job.phase = 'collect'; job.cursor = 0; s.job = job; s.error = ''; write(s);
          });
          log({ id: job.id, mode: job.mode, ...proof, check: job.full ? 'full' : 'incremental' });
        }
      }
      if (job.phase === 'collect') {
        if (job.mode === 'snapshot') await collect(read().history, job);
        tx(() => { const s = read(); if (s.job?.id === job.id && s.job.owner === owner) { s.job = null; write(s); } });
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      tx(() => {
        const s = read();
        if (job && s.job?.id === job.id && s.job.owner === owner) {
          s.job = null; s.error = String(error.message || error).slice(0, 200); s.next = clock() + 3600000;
          if (error.badHash) { s.badObjects = [...new Set([...(s.badObjects || []), error.badHash])]; s.lastFull = 0; }
          if (job.mode === 'verify') s.history = s.history.map((entry) => entry.id === job.id ? { ...entry, check: 'failed', checkedAt: clock() } : entry);
          write(s);
        }
      });
      console.error('vault snapshot failed', error);
    } finally { busy = false; onChange(); }
    return status();
  }
  function need(req, user) { authorize(req, user); if (!active) throw new ApiError(503, 'not_configured', 'R2スナップショットは設定されていません'); }
  return { status, nextDue, tick, routes: {
    'GET /api/vault/snapshots': (req, user) => { authorize(req, user); return status(); },
    'POST /api/vault/snapshots/run': async (req, user) => { need(req, user); await req.json(); return tick({ force: true }); },
    'POST /api/vault/snapshots/verify': async (req, user) => { need(req, user); const body = await req.json(); if (read().job) throw new ApiError(409, 'busy', 'スナップショット処理中です'); return tick({ verify: String(body.id || '') }); }
  } };
}
