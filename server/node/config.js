// Node host settings: the shared ones plus port, data directory and proxy handling.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configFrom } from '../core/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Repository root: holds index.html, css/, js/, fonts/, icons/, img/, sounds/, video/.
export const ROOT = path.resolve(here, '..', '..');

function flag(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  return /^(1|true|yes|on)$/i.test(raw);
}

export function loadConfig(overrides = {}) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isSafeInteger(port) || port < 0) throw new Error('PORT must be a port number');
  return configFrom(process.env, {
    port,
    host: process.env.HOST || '0.0.0.0',
    dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
    // Set when running behind Caddy/nginx/a PaaS router so X-Forwarded-For is used for the client IP.
    trustProxy: flag('TRUST_PROXY', false),
    // Optional header carrying the player's IP from a trusted edge, e.g. "cf-connecting-ip" behind Cloudflare.
    clientIpHeader: (process.env.CLIENT_IP_HEADER || '').trim().toLowerCase(),
    logRequests: flag('LOG_REQUESTS', true),
    ...overrides
  });
}
