// The API over a live connection (Cloudflare's WebSocket: server/cloudflare/casino.js). A request the page would send over HTTP goes as one
// message on the connection it already has, and the answer comes back on it: no request of its own (no Worker in between, no headers, no
// round trip to open), and Cloudflare bills a message to the object as 1/20 of a request.
//   page → { op: 'api', id, m: 'GET' | 'POST', p: '/api/spin?x=1', h: { authorization, … }, b: { … } }
//   page ← { re: id, s: 200, b: { … } }        s: 0 — not over this connection: the page asks over HTTP (nothing was done)
// It is answered by the same api.handle() as HTTP: the login (the message carries the page's own Authorization, checked as every request is),
// the passkey's signature (X-Gate), the viewer's allowlist, the rate limits, the shield and the emergency stop are those of HTTP. The address
// and the browser are those the connection was opened from. Chat bodies pass the same automatic filter before reaching the handlers.
// What only the HTTP host does stays on HTTP: the logins and what sets them up, the vault's files and its writes, the
// extensions' scripts, the security base's sealed channel and what other servers call; a body over BODY_MAX goes over HTTP too (js/net/wire.js).
import '../../js/net/transport-policy.js';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';
import { CHAT_ROUTES, screenChat, blockedBody } from './attach.js';

// the headers the page itself sends with a request (the rest are the connection's: the browser, where it came from)
const FROM_PAGE = new Set(['authorization', 'x-device', 'x-ops-device', 'x-gate', 'x-vault-ticket']);
export const BODY_MAX = 16 * 1024;

export const overSocket = globalThis.BR.overSocket;

// What the connection was opened from, kept with it (a few hundred bytes: Cloudflare keeps 2 KB with a socket): the address, the browser,
// and the game's device (?device=, js/net/live.js), which its requests on the connection then need not carry each.
export function connectionOf(request, url) {
  const h = (k, n) => String(request.headers.get(k) || '').slice(0, n);
  return { ip: h('cf-connecting-ip', 64), host: url.host, scheme: url.protocol, ua: h('user-agent', 300), origin: h('origin', 160), lang: h('accept-language', 80),
    device: String(url.searchParams.get('device') || '').slice(0, 120) };
}

// the answer to one message, as the text to send back; null for a message that is not a request
export async function answerOnSocket(api, conn, m) {
  if (!Number.isSafeInteger(m.id) || m.id < 0) return null;
  const back = (s, text = 'null') => `{"re":${m.id},"s":${s},"b":${text}}`;
  const method = m.m;
  let url;
  try { url = new URL(String(m.p || ''), 'http://socket'); } catch { return back(0); }
  if (url.origin !== 'http://socket' || !overSocket(method, url.pathname)) return back(0);
  const sent = m.h && typeof m.h === 'object' ? m.h : {};
  const own = { 'user-agent': conn.ua, origin: conn.origin, 'accept-language': conn.lang, host: conn.host };
  const req = {
    method, path: url.pathname, query: url.searchParams, host: conn.host || '', ip: conn.ip || '',
    meta: { scheme: conn.scheme || 'https:', live: true },
    header(name) {
      const k = String(name).toLowerCase();
      if (k === 'x-device' && typeof sent[k] !== 'string') return conn.device || null;
      if (FROM_PAGE.has(k)) return typeof sent[k] === 'string' ? sent[k] : null;
      if (k === 'content-type') return method === 'POST' ? 'application/json' : null;
      return own[k] || null;
    },
    async json(limit = BODY_MAX) {
      const body = m.b === undefined ? {} : m.b;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad_json', 'リクエストの形式が正しくありません');
      if (Buffer.byteLength(JSON.stringify(body)) > limit) throw new ApiError(413, 'too_large', '送信できません。大きすぎます。');
      return body;
    },
    async bytes() { throw new ApiError(415, 'content_type', 'この送信は接続の上ではできません'); }
  };
  const failed = '{"error":{"code":"internal","message":"サーバーでエラーが発生しました。少し待ってからもう一度お試しください"}}';
  let out;
  try {
    const route = method + ' ' + url.pathname;
    if (CHAT_ROUTES[route]) {
      const bytes = Buffer.from(JSON.stringify(m.b === undefined ? {} : m.b));
      // Oversized chat goes to the HTTP path, which can accept its larger text-only body.
      if (bytes.length > BODY_MAX) return back(0);
      const note = await screenChat(route, 'application/json', bytes);
      if (note) { const decision = api.filtered(req, note); out = { status: 400, body: blockedBody(decision) }; }
    }
    if (!out) out = await api.handle(req);
  } catch (e) { console.error('socket api', e); return back(500, failed); }
  // (a script or a file is not sent on the connection: asked again over HTTP)
  if (out.raw) return method === 'GET' ? back(0) : back(500, failed);
  const text = JSON.stringify(out.body);
  api.sent(Buffer.byteLength(text), req.path);
  return back(out.status, text);
}
