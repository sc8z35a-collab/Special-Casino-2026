// Cloudflare Worker entry: /api/* goes to the one Casino Durable Object.
// Everything else (the page included) is served by Workers Static Assets
// without running the Worker: that is free and unlimited, so the game still
// opens when the free plan's daily requests are used up, and then shows the
// maintenance notice (the API answers 429/503 until 00:00 UTC). The page's
// headers are in _headers.
import { Casino } from './casino.js';
import { maintenanceBody, isQuotaError } from '../core/quota.js';

export { Casino };

// The same name forever: it is the address of the database with every player in it.
const DATABASE = 'main';
const MAX_BODY = 9 * 1024 * 1024;

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
      if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
        return Response.json({ error: { code: 'too_large', message: 'リクエストが大きすぎます' } }, { status: 413 });
      }
      return await casino.fetch(new Request(request, { body: await request.arrayBuffer() }));
    } catch (e) {
      // the object could not be reached (its daily quota, or a restart)
      console.error('casino unavailable', e && e.message);
      return failure(e);
    }
  }
};
