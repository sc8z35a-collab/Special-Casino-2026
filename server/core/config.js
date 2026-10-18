// Settings from environment variables (process.env on Node, the Worker's env
// on Cloudflare). Everything has a working default.

function int(env, name, def) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer (got "${raw}")`);
  return n;
}

function flag(env, name, def) {
  const raw = env[name];
  if (raw === undefined || raw === null || raw === '') return def;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

function str(env, name, def = '') {
  const raw = env[name];
  return raw === undefined || raw === null ? def : String(raw).trim();
}

export function configFrom(env = {}, overrides = {}) {
  const cfg = {
    // "open" lets anyone create an account, "closed" only allows existing players to log in.
    registration: str(env, 'REGISTRATION', 'open').toLowerCase(),
    // Starting balances of a new player (defaults come from js/game/config.js).
    startTokens: int(env, 'START_TOKENS', undefined),
    startDollars: int(env, 'START_DOLLARS', undefined),
    startCoins: int(env, 'START_COINS', undefined),
    // Largest single transfer.
    maxTransferTokens: int(env, 'MAX_TRANSFER_TOKENS', 10000000),
    maxTransferDollars: int(env, 'MAX_TRANSFER_DOLLARS', 100000000),
    // Accounts that may be created from one IP address per 24 hours (0 = unlimited).
    // Mobile carriers put many players behind one address, so keep this generous.
    registrationsPerIp: int(env, 'REGISTRATIONS_PER_IP', 30),
    // Sign-up attempts per IP address per minute.
    registerPerMinute: int(env, 'REGISTER_PER_MINUTE', 10),
    // Keep one row per spin (audit trail). Off on Cloudflare to save free-tier writes.
    logSpins: flag(env, 'LOG_SPINS', true),
    // Enables POST /api/admin with "X-Admin-Token: <value>" (at least 24 characters).
    adminToken: str(env, 'ADMIN_TOKEN'),
    // Voice chat: STUN servers (comma separated) and an optional TURN server.
    stunUrls: str(env, 'STUN_URLS', 'stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302').split(',').map((s) => s.trim()).filter(Boolean),
    turnUrls: str(env, 'TURN_URLS').split(',').map((s) => s.trim()).filter(Boolean),
    turnUsername: str(env, 'TURN_USERNAME'),
    turnCredential: str(env, 'TURN_CREDENTIAL'),
    // Cloudflare Realtime TURN (free up to 1 000 GB a month): key id + API token
    cfTurnKeyId: str(env, 'CF_TURN_KEY_ID'),
    cfTurnToken: str(env, 'CF_TURN_API_TOKEN'),
    // The daily login bonus (js/game/config.js); off only for tests that count tokens exactly.
    loginBonus: flag(env, 'LOGIN_BONUS', true),
    // Daily caps (per UTC day, 0 = none): past one, players see the maintenance
    // notice until 00:00 UTC. Cloudflare's own free-plan limits do that by themselves.
    dailyRequestLimit: int(env, 'DAILY_REQUEST_LIMIT', 0),
    dailyMbLimit: int(env, 'DAILY_MB_LIMIT', 0),
    limits: {},
    ...overrides
  };
  if (!['open', 'closed'].includes(cfg.registration)) throw new Error('REGISTRATION must be "open" or "closed"');
  if (cfg.adminToken && cfg.adminToken.length < 24) throw new Error('ADMIN_TOKEN must be at least 24 characters');
  return cfg;
}
