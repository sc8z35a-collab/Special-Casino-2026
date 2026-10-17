// Cloudflare Worker entry: static game files come from Workers Static Assets
// (free and unlimited), /api/* goes to the one Casino Durable Object, and the
// start page is switched into online mode.
import { Casino } from './casino.js';

export { Casino };

// The same name forever: it is the address of the database with every player in it.
const DATABASE = 'main';
const MAX_BODY = 9 * 1024 * 1024;

function pageHeaders(url, base) {
  const h = new Headers(base);
  h.delete('content-length');
  h.delete('etag');
  h.set('Content-Type', 'text/html; charset=utf-8');
  h.set('Cache-Control', 'no-cache');
  h.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' wss://${url.host}`,
    "manifest-src 'self'",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; '));
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
  return h;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const casino = env.CASINO.get(env.CASINO.idFromName(DATABASE));
      if (request.method === 'GET' || request.method === 'HEAD') return casino.fetch(request);
      // bodies are small; reading them here lets the object answer early (e.g. 403) cleanly
      if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
        return Response.json({ error: { code: 'too_large', message: 'リクエストが大きすぎます' } }, { status: 413 });
      }
      return casino.fetch(new Request(request, { body: await request.arrayBuffer() }));
    }
    const res = await env.ASSETS.fetch(request);
    const type = res.headers.get('content-type') || '';
    if (res.status !== 200 || !type.includes('text/html')) return res;
    const html = (await res.text())
      .replace('<meta name="br-mode" content="local">', '<meta name="br-mode" content="online" data-live="ws">');
    return new Response(html, { status: 200, headers: pageHeaders(url, res.headers) });
  }
};
