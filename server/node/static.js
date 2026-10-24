// Serves the game files. Only whitelisted paths are reachable (never server/,
// tools/, data/ or .git), text files are gzip-compressed once and cached.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { SECURITY_HEADERS } from './http.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive'
};
const TEXT = new Set(['.html', '.css', '.js', '.json', '.webmanifest', '.svg', '.txt']);
// (ops/: the operator site, /ops/ — what it shows needs an operator's login;
// sec/: the security base, /sec/ — likewise; law.html: 特定商取引法に基づく表記, for anyone)
const ALLOWED = /^\/(?:index\.html|law\.html|exit\.html|manifest\.webmanifest|sw\.js|version\.json|(?:css|js|fonts|icons|img|sounds|video|download|ops|sec)\/[A-Za-z0-9._\/-]+)$/;

export function createStatic(root, { transformHtml } = {}) {
  const cache = new Map();   // path -> { mtime, size, body, gz, etag }

  function load(rel) {
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) return null;
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    const hit = cache.get(rel);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit;
    const ext = path.extname(file).toLowerCase();
    let body = fs.readFileSync(file);
    if (ext === '.html' && transformHtml) body = Buffer.from(transformHtml(body.toString('utf8')));
    const entry = {
      mtime: st.mtimeMs,
      size: st.size,
      type: TYPES[ext] || 'application/octet-stream',
      body,
      gz: TEXT.has(ext) && body.length > 512 ? zlib.gzipSync(body, { level: 9 }) : null,
      etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"',
      // art is fresh for an hour (then refreshed in the background); code is revalidated on every load
      cacheControl: /^\/(fonts|icons|img|sounds|video)\//.test(rel) ? 'public, max-age=3600, stale-while-revalidate=86400' : 'no-cache'
    };
    cache.set(rel, entry);
    return entry;
  }

  return function serve(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel = pathname === '/' ? '/index.html'
      : pathname === '/ops' || pathname === '/ops/' ? '/ops/index.html'
      : pathname === '/sec' || pathname === '/sec/' ? '/sec/index.html'
      : pathname === '/law' ? '/law.html' : pathname;
    try { rel = decodeURIComponent(rel); } catch { return false; }
    if (!ALLOWED.test(rel) || rel.includes('..')) return false;
    const entry = load(rel);
    if (!entry) return false;
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': entry.type,
      'Cache-Control': entry.cacheControl,
      'ETag': entry.etag,
      'Vary': 'Accept-Encoding'
    };
    // Only security HOME may be embedded, by a page on this same origin.
    if (rel === '/sec/index.html') headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace("frame-ancestors 'none'", "frame-ancestors 'self'");
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
    // byte ranges: Safari will not play a video without them
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && !entry.gz) {
      const size = entry.body.length;
      let a = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
      let b = range[1] === '' || range[2] === '' ? size - 1 : Number(range[2]);
      a = Math.max(0, a);
      b = Math.min(size - 1, b);
      if (a > b || a >= size) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` });
        res.end();
        return true;
      }
      res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 });
      res.end(req.method === 'HEAD' ? undefined : entry.body.subarray(a, b + 1));
      return true;
    }
    if (!entry.gz) headers['Accept-Ranges'] = 'bytes';
    if (rel.endsWith('.apk')) headers['Content-Disposition'] = `attachment; filename="${path.basename(rel)}"`;
    if (rel === '/version.json') headers['Cache-Control'] = 'no-store';
    let body = entry.body;
    if (entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      body = entry.gz;
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  };
}
