// Cloudflare Worker entry: /api/* goes to the one Casino Durable Object.
// Everything else (the page included) is served by Workers Static Assets
// without running the Worker: that is free and unlimited, so the game still
// opens when the free plan's daily requests are used up, and then shows the
// maintenance notice (the API answers 429/503 until 00:00 UTC). The page's
// headers are in _headers.
import { Casino } from './casino.js';
import { maintenanceBody, isQuotaError } from '../core/quota.js';
import { screenChat, blockedBody } from '../core/attach.js';
import { LINK_BODY_MAX } from '../core/vault.js';

export { Casino };

// The same name forever: it is the address of the database with every player in it.
const DATABASE = 'main';
const MAX_BODY = 9 * 1024 * 1024;
// a piece of a vault file (base64 inside JSON): with R2 on Workers Paid a
// piece is 8 MiB, about 11.2 MB as sent, and at most 16 MiB (VAULT_PIECE_MB);
// the route itself checks the exact size (server/core/vault.js)
const VAULT_PIECE_BODY = 23 * 1024 * 1024;
// a vault piece sent as it is (POST /api/vault/piece): at most this big (the
// object says the exact size)
const VAULT_PIECE_MAX = 16 * 1024 * 1024;
// what the object is told about a request the automatic filter stopped
const PASS = ['authorization', 'user-agent', 'x-device', 'origin', 'referer', 'cf-connecting-ip'];
// …and what it needs to say whether a vault piece may go
const ASK = [...PASS, 'x-vault-ticket', 'x-vault-upload'];

const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const answer = (status, error) => Response.json({ error }, { status, headers: NO_STORE });

// A piece of a vault file, straight into R2: the object (the whole game, one
// at a time) is only asked whether it may go and where — a few bytes — and
// the piece streams from the operator site into the bucket, which checks its
// SHA-256 itself. So big uploads never fill the object's memory (that
// stopped the whole site) nor keep the game waiting.
async function vaultPiece(request, env, casino, url) {
  const size = Number(request.headers.get('content-length') || -1);
  const sha = String(request.headers.get('x-piece-sha256') || '').toLowerCase();
  if (!/^application\/octet-stream\b/i.test(String(request.headers.get('content-type') || ''))) return answer(415, { code: 'content_type', message: '送る部分の形式が正しくありません。ページを読み込み直してください' });
  if (!(size > 0)) return answer(411, { code: 'length_required', message: '送る部分の大きさがわかりませんでした。ページを読み込み直してください' });
  if (size > VAULT_PIECE_MAX) return answer(413, { code: 'too_large', message: '送信できません。大きすぎます。' });
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const k of ASK) if (request.headers.has(k)) headers.set(k, request.headers.get(k));
  const ask = (path, body) => casino.fetch(new Request(new URL(path + url.search, url), { method: 'POST', headers, body: JSON.stringify(body) }));
  const permit = await ask('/api/vault/permit', { size, sha256: sha });
  if (!permit.ok) return permit;
  const p = await permit.json();
  // (no bucket: the object takes it itself)
  if (!p.key) return casino.fetch(new Request(request));
  try {
    const written = await env.VAULT.put(p.key, request.body, { sha256: sha, customMetadata: { sha256: sha }, onlyIf: { etagDoesNotMatch: '*' } });
    if (written === null) {
      const existing = await env.VAULT.head(p.key);
      if (existing?.customMetadata?.sha256 !== sha || existing.size !== size)
        return answer(409, { code: 'piece_conflict', message: 'この部分には別のデータが届いています。「最初からやり直す」で送り直してください' });
    }
  } catch (e) {
    const broken = /digest|checksum|sha-?256|integrity|length/i.test(String(e && e.message));
    return broken
      ? answer(400, { code: 'bad_hash', message: '送った部分が途中で壊れていました（ハッシュが一致しません）。自動でもう一度送ります' })
      : answer(503, { code: 'unavailable', message: '保存先（R2）が混み合っています。自動でもう一度送ります' });
  }
  // still there? (deleted meanwhile: the piece goes again)
  const still = await ask('/api/vault/stored', { generation: p.generation });
  if (!still.ok) {
    // A permission change or a transient error must not delete a piece that a
    // completed file may reference. Only the object can prove it is obsolete.
    const error = await still.clone().json().catch(() => null);
    if (error?.error?.discard) await env.VAULT.delete(p.key);
    return still;
  }
  return Response.json({ n: p.n, stored: true }, { headers: NO_STORE });
}

// A body of `max` bytes at most, or null: read no further than that (a request
// with no length cannot make the Worker hold more), and before the object
// hears of it. For what anyone with a link may send (no login).
async function readAtMost(request, max) {
  if (Number(request.headers.get('content-length') || 0) > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return out;
}

function failure(e) {
  const body = isQuotaError(e)
    ? maintenanceBody()
    : { error: { code: 'unavailable', message: 'サーバーに接続できませんでした。少し待ってからもう一度お試しください' } };
  return Response.json(body, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const casino = env.CASINO.get(env.CASINO.idFromName(DATABASE));
    try {
      if (request.method === 'GET' || request.method === 'HEAD') return await casino.fetch(request);
      if (request.method === 'POST' && url.pathname === '/api/vault/piece' && env.VAULT) return await vaultPiece(request, env, casino, url);
      // a comment through a link: a few hundred bytes; more is turned away here
      if (request.method === 'POST' && url.pathname === '/api/vault/ai') {
        const small = await readAtMost(request, LINK_BODY_MAX);
        if (!small) return answer(413, { code: 'too_large', message: '送信できません。大きすぎます。' });
        return await casino.fetch(new Request(request, { body: small }));
      }
      // bodies are small; reading them here lets the object answer early (e.g. 403) cleanly
      const most = request.method === 'POST' && url.pathname === '/api/vault/chunk' ? VAULT_PIECE_BODY : MAX_BODY;
      if (Number(request.headers.get('content-length') || 0) > most) {
        return Response.json({ error: { code: 'too_large', message: '送信できません。大きすぎます。' } }, { status: 413 });
      }
      const bytes = await readAtMost(request, most);
      if (!bytes) return answer(413, { code: 'too_large', message: '送信できません。大きすぎます。' });
      // the automatic filter: a chat message that is not just text never
      // reaches the object, only a note of it (server/core/attach.js)
      const note = await screenChat(`${request.method} ${url.pathname}`, request.headers.get('content-type'), bytes);
      if (note) {
        const headers = new Headers({ 'content-type': 'application/json' });
        for (const k of PASS) if (request.headers.has(k)) headers.set(k, request.headers.get(k));
        const result = await casino.fetch(new Request(new URL('/internal/filter', url), { method: 'POST', headers, body: JSON.stringify(note) }));
        const decision = await result.json();
        return Response.json(blockedBody(decision), { status: 400, headers: { 'Cache-Control': 'no-store' } });
      }
      return await casino.fetch(new Request(request, { body: bytes }));
    } catch (e) {
      // the object could not be reached (its daily quota, or a restart)
      console.error('casino unavailable', e && e.message);
      return failure(e);
    }
  }
};
