// The staff routes (operator site, security HOME, vault, backups, emergency, passkey)
// are asked for every way a stranger or a plain player could ask. A route that
// forgets its own check — a new one, most likely — answers 200 or 400 here
// instead of a refusal, and this fails before it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const STAFF = /^\/api\/(?:ops|sec|vault|backup|emergency|admin|discord|line|pk)\b/;
// the staff routes that are open on purpose, with what a stranger / a plain player is told
const OPEN = new Map([
  ['POST /api/ops/login', [401, 429]],          // the login itself (two wrong tries wait)
  ['POST /api/admin', [403]],                   // ADMIN_TOKEN
  ['POST /api/discord/interactions', [401]],    // signed by Discord
  ['POST /api/line/webhook', [401]],            // signed by LINE
  ['GET /api/vault/pull', [404]],               // a link's own secret
  ['POST /api/vault/ai', [404]],
  ['POST /api/vault/piece', [401, 404, 415]],   // an upload's own pass
  ['POST /api/pk/open', [401, 409]],            // (the passkey: asked after the login, off until GATE_KEY)
  ['POST /api/pk/breakglass', [401, 409]],
  ['POST /api/pk/close', [200, 401]]            // closing one's own gate
]);
const REFUSED = [401, 403, 404];

const split = (key) => [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];

test('every staff route refuses a stranger and a plain player, but the few that are open on purpose', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const player = await s.register('Plainone');
  const keys = s.app.api.routeKeys().filter((k) => STAFF.test(split(k)[1]));
  assert.ok(keys.length > 100, `staff routes found: ${keys.length}`);
  for (const key of OPEN.keys()) assert.ok(keys.includes(key) || key === 'POST /api/admin', `${key} is listed as open but is not a route any more`);

  const wrong = [];
  for (const key of keys) {
    const [method, path] = split(key);
    for (const who of [{ token: undefined, label: 'a stranger' }, { token: player.token, label: 'a plain player' }]) {
      const r = await s.call(method, path, { token: who.token, body: method === 'GET' ? undefined : {} });
      const ok = OPEN.has(key) ? OPEN.get(key).includes(r.status) : REFUSED.includes(r.status);
      if (!ok) wrong.push(`${key} told ${who.label} ${r.status} ${r.error ? r.error.code : ''}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('a login that has ended is refused by every staff route', async (t) => {
  const s = await startServer();
  t.after(() => s.stop());
  const player = await s.register('Leaver');
  assert.equal((await s.call('POST', '/api/logout', { token: player.token, body: {} })).status, 200);
  const keys = s.app.api.routeKeys().filter((k) => STAFF.test(split(k)[1]) && !OPEN.has(k));
  const wrong = [];
  for (const key of keys) {
    const [method, path] = split(key);
    const r = await s.call(method, path, { token: player.token, body: method === 'GET' ? undefined : {} });
    if (!REFUSED.includes(r.status)) wrong.push(`${key} ${r.status}`);
  }
  assert.deepEqual(wrong, []);
});
