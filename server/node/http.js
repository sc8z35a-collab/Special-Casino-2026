// HTTP plumbing for the Node host: headers, JSON bodies, client address.
import { Buffer } from 'node:buffer';
import { ApiError } from '../core/errors.js';

export const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    // (wasm-unsafe-eval: the 3D models' geometry decoder is WebAssembly)
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // (blob: the 3D models' textures are read from the model file in the page)
    "connect-src 'self' blob: data:",
    "manifest-src 'self'",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // the microphone is used for voice chat with friends
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=(), payment=()'
};

export function sendJson(res, status, body, headers) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(data);
  return data.length;
}

// Reads a JSON body (at most `limit` bytes).
export function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(type)) {
      reject(new ApiError(415, 'content_type', 'Content-Type は application/json にしてください'));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, 'too_large', '送信できません。大きすぎます。'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > limit) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const body = text ? JSON.parse(text) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
        resolve(body);
      } catch {
        reject(new ApiError(400, 'bad_json', 'リクエストの形式が正しくありません'));
      }
    });
    req.on('error', reject);
  });
}

// Reads the body exactly as it came, whatever its type (at most `limit`
// bytes): a payment company's signed notice is checked byte for byte.
export function readBytes(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new ApiError(413, 'too_large', '送信できません。大きすぎます。'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (size <= limit) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Private, loopback, link-local and carrier-grade NAT ranges: proxies, never players.
const INTERNAL = /^(?:::ffff:)?(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|^(?:::1|f[cd][0-9a-f]{2}:|fe80:)/i;

// The player's address. `ipHeader` names a header set by a trusted edge
// (e.g. cf-connecting-ip). Behind a proxy, X-Forwarded-For entries are
// appended hop by hop, so anything a client sends itself sits to the left:
// the rightmost public address is the one our proxy actually saw.
export function clientIp(req, trustProxy, ipHeader) {
  if (ipHeader) {
    const v = String(req.headers[ipHeader] || '').trim();
    if (v) return v;
  }
  if (trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) if (!INTERNAL.test(hops[i])) return hops[i];
    if (hops.length) return hops[0];
  }
  return req.socket.remoteAddress || '';
}

// The host-independent request the core API understands.
export function coreRequest(req, url, ip) {
  return {
    method: req.method,
    path: url.pathname,
    query: url.searchParams,
    ip,
    header: (name) => req.headers[name.toLowerCase()] ?? null,
    json: (limit) => readJson(req, limit),
    bytes: (limit) => readBytes(req, limit)
  };
}
