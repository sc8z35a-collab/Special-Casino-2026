// Runtime configuration, read once from environment variables.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Repository root: holds index.html, css/, js/, fonts/, icons/.
export const ROOT = path.resolve(here, '..');

function int(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer (got "${raw}")`);
  return n;
}

function flag(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  return /^(1|true|yes|on)$/i.test(raw);
}

export function loadConfig(overrides = {}) {
  const cfg = {
    port: int('PORT', 8080),
    host: process.env.HOST || '0.0.0.0',
    dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
    // Set when running behind Caddy/nginx/a PaaS router so X-Forwarded-For is used for the client IP.
    trustProxy: flag('TRUST_PROXY', false),
    // Optional header carrying the player's IP from a trusted edge, e.g. "cf-connecting-ip" behind Cloudflare.
    clientIpHeader: (process.env.CLIENT_IP_HEADER || '').trim().toLowerCase(),
    // "open" lets anyone create an account, "closed" only allows existing players to log in.
    registration: (process.env.REGISTRATION || 'open').toLowerCase(),
    // Starting balances of a new player (defaults come from js/game/config.js).
    startTokens: process.env.START_TOKENS,
    startDollars: process.env.START_DOLLARS,
    startCoins: process.env.START_COINS,
    // Largest single transfer.
    maxTransferTokens: int('MAX_TRANSFER_TOKENS', 10000000),
    maxTransferDollars: int('MAX_TRANSFER_DOLLARS', 100000000),
    // Accounts that may be created from one IP address per 24 hours (0 = unlimited).
    // Mobile carriers put many players behind one address, so keep this generous.
    registrationsPerIp: int('REGISTRATIONS_PER_IP', 30),
    // Sign-up attempts per IP address per minute.
    registerPerMinute: int('REGISTER_PER_MINUTE', 10),
    logRequests: flag('LOG_REQUESTS', true),
    ...overrides
  };
  for (const k of ['startTokens', 'startDollars', 'startCoins']) {
    if (cfg[k] === undefined || cfg[k] === '' || cfg[k] === null) { cfg[k] = undefined; continue; }
    const n = Number(cfg[k]);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${k} must be a non-negative integer`);
    cfg[k] = n;
  }
  if (!['open', 'closed'].includes(cfg.registration)) throw new Error('REGISTRATION must be "open" or "closed"');
  return cfg;
}
