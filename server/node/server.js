// BLOCKBUSTER REELS on Node: the game files, the API and live updates (SSE)
// from one process, data in SQLite. (The free hosted version runs the same
// core on Cloudflare: see server/cloudflare/.)
//
//   node --disable-warning=ExperimentalWarning server/node/server.js
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ROOT } from './config.js';
import { openDb } from './sqlite.js';
import { Live } from './live.js';
import { createStatic } from './static.js';
import { SECURITY_HEADERS, sendJson, clientIp, coreRequest, bufferedRequest, readBytes } from './http.js';
import { createApi } from '../core/api.js';
import { CHAT_ROUTES, screenChat, BLOCKED } from '../core/attach.js';
import { metaValue } from '../core/db.js';

// This machine for the operator site's サーバー tab: the database's size,
// the live connections, memory, load and disk; the operators' log's newest
// hash in a file of its own; the emergency stop (every live connection closes).
function machine(dataDir, live, trail) {
  const size = (f) => { try { return fs.statSync(path.join(dataDir, f)).size; } catch { return 0; } };
  const anchorFile = path.join(dataDir, 'ops-log.anchor.json');
  return {
    name: 'node',
    anchor: {
      put(row) {
        fs.writeFileSync(anchorFile, JSON.stringify(row));
        if (trail) console.log(`[ops-log] #${row.id} ${row.hash}`);
      },
      get: async () => { try { return JSON.parse(fs.readFileSync(anchorFile, 'utf8')); } catch { return null; } }
    },
    stop: () => live.drop(),
    dbBytes: () => size('blockbuster.db') + size('blockbuster.db-wal'),
    sockets: () => [...live.clients.values()].reduce((n, set) => n + set.size, 0),
    extra() {
      const m = process.memoryUsage();
      let disk = null;
      try { const d = fs.statfsSync(dataDir); disk = { free: d.bavail * d.bsize, size: d.blocks * d.bsize }; } catch { /* not told */ }
      return { rss: m.rss, heap: m.heapUsed, load: os.loadavg(), cpus: os.cpus().length, memTotal: os.totalmem(), memFree: os.freemem(), uptime: Math.round(process.uptime()), node: process.version, disk };
    }
  };
}

// `blobs`: a bucket for the developer's vault (the tests' stand-in for R2; none here)
export function createApp({ blobs = null, ...overrides } = {}) {
  const config = loadConfig(overrides);
  const db = openDb(config.dataDir);
  const live = new Live();
  const secret = metaValue(db, 'ticket_secret', () => crypto.randomBytes(32).toString('base64url'));
  const api = createApi({ db, live, config, secret, blobs, host: machine(config.dataDir, live, config.logRequests) });
  live.onPresence = (userId, online) => api.presence(userId, online);
  // The page is online with WebSocket live updates (Cloudflare); here they come as SSE.
  const serveStatic = createStatic(ROOT, {
    transformHtml: (html) => html.replace('<meta name="br-mode" content="online" data-live="ws">', '<meta name="br-mode" content="online" data-live="sse">')
  });
  const hk = setInterval(() => api.housekeeping(), 3600000);
  hk.unref();
  // (the developer's automatic backup, when it is due)
  const bk = setInterval(() => api.backupDue(), 5 * 60000);
  bk.unref();

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (config.logRequests && url.pathname !== '/api/stream') {
        res.on('finish', () => console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`));
      }
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        if (api.stopped()) { sendJson(res, 503, api.stoppedBody()); return; }
        const userId = api.consumeTicket(url.searchParams.get('ticket'));
        if (!userId) { sendJson(res, 401, { error: { code: 'ticket', message: '接続の有効期限が切れました' } }); return; }
        live.attach(req, res, userId, () => api.hello(userId));
        return;
      }
      const ip = clientIp(req, config.trustProxy, config.clientIpHeader);
      let core = coreRequest(req, url, ip);
      // the automatic filter: a chat message that is not just text never
      // reaches the API, only a note of it (server/core/attach.js)
      const route = `${req.method} ${url.pathname}`;
      if (CHAT_ROUTES[route]) {
        let bytes;
        try { bytes = await readBytes(req, 9 * 1024 * 1024); } catch (e) { sendJson(res, e.status || 400, { error: { code: e.code || 'bad_request', message: e.message } }); return; }
        const note = await screenChat(route, req.headers['content-type'], bytes);
        if (note) {
          api.filtered(core, note);
          sendJson(res, 400, { error: BLOCKED });
          return;
        }
        core = bufferedRequest(req, url, ip, bytes);
      }
      const out = await api.handle(core);
      api.sent(sendJson(res, out.status, out.body), url.pathname);
      return;
    }
    if (serveStatic(req, res, url.pathname)) return;
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  function close() {
    return new Promise((resolve) => {
      clearInterval(hk);
      clearInterval(bk);
      live.close();
      api.close();
      server.close(() => {
        try { db.close(); } catch { /* already closed */ }
        resolve();
      });
      server.closeAllConnections?.();
    });
  }

  return { server, db, live, api, config, close };
}

// Started directly (not imported by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = createApp();
  app.server.listen(app.config.port, app.config.host, () => {
    console.log(`BLOCKBUSTER REELS server: http://${app.config.host === '0.0.0.0' ? 'localhost' : app.config.host}:${app.config.port}`);
    console.log(`data directory: ${app.config.dataDir}`);
  });
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`${sig} received, shutting down`);
    app.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
