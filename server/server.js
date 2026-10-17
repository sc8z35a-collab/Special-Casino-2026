// BLOCKBUSTER REELS online server: serves the game and its API from one process.
//
//   node --disable-warning=ExperimentalWarning server/server.js
//
// Configuration comes from environment variables (see server/config.js).
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig, ROOT } from './config.js';
import { openDb } from './db.js';
import { Live } from './live.js';
import { createApi } from './api.js';
import { createStatic } from './static.js';
import { SECURITY_HEADERS } from './http.js';

export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDb(config.dataDir);
  const live = new Live();
  const api = createApi({ db, live, config });
  // The page switches to online mode when it sees this marker.
  const serveStatic = createStatic(ROOT, {
    transformHtml: (html) => html.replace('<meta name="br-mode" content="local">', '<meta name="br-mode" content="online">')
  });

  const server = http.createServer((req, res) => {
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
      api.handle(req, res, url);
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
