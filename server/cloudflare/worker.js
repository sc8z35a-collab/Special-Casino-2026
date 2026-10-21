// Cloudflare Worker entry: /api/* goes to the one Casino Durable Object.
// Everything else (the page included) is served by Workers Static Assets
// without running the Worker: that is free and unlimited, so the game still
// opens when the free plan's daily requests are used up, and then shows the
// maintenance notice (the API answers 429/503 until 00:00 UTC). The page's
// headers are in _headers.
import { Casino } from './casino.js';
import { maintenanceBody, isQuotaError } from '../core/quota.js';
import { screenChat, BLOCKED } from '../core/attach.js';

export { Casino };

// The same name forever: it is the address of the database with every player in it.
const DATABASE = 'main';
const MAX_BODY = 9 * 1024 * 1024;
// a piece of a vault file (base64 inside JSON): with R2 on Workers Paid a
// piece is 8 MiB, about 11.2 MB as sent, and at most 16 MiB (VAULT_PIECE_MB);
// the route itself checks the exact size (server/core/vault.js)
const VAULT_PIECE_BODY = 23 * 1024 * 1024;
// what the object is told about a request the automatic filter stopped
const PASS = ['authorization', 'user-agent', 'x-device', 'origin', 'referer', 'cf-connecting-ip'];

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
      // bodies are small; reading them here lets the object answer early (e.g. 403) cleanly
      const most = request.method === 'POST' && url.pathname === '/api/vault/chunk' ? VAULT_PIECE_BODY : MAX_BODY;
      if (Number(request.headers.get('content-length') || 0) > most) {
        return Response.json({ error: { code: 'too_large', message: '送信できません。大きすぎます。' } }, { status: 413 });
      }
      const bytes = await request.arrayBuffer();
      // the automatic filter: a chat message that is not just text never
      // reaches the object, only a note of it (server/core/attach.js)
      const note = await screenChat(`${request.method} ${url.pathname}`, request.headers.get('content-type'), new Uint8Array(bytes));
      if (note) {
        const headers = new Headers({ 'content-type': 'application/json' });
        for (const k of PASS) if (request.headers.has(k)) headers.set(k, request.headers.get(k));
        await casino.fetch(new Request(new URL('/internal/filter', url), { method: 'POST', headers, body: JSON.stringify(note) }));
        return Response.json({ error: BLOCKED }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
      }
      return await casino.fetch(new Request(request, { body: bytes }));
    } catch (e) {
      // the object could not be reached (its daily quota, or a restart)
      console.error('casino unavailable', e && e.message);
      return failure(e);
    }
  }
};
