/* Optional check of the secure channel (server/core/seccomm.js, js/net/secchannel.js) on the real Worker runtime (workerd), with its own
   local Durable Object:
     node tools/check_sec_worker.cjs
   It starts `wrangler dev --local` on port 8799 with disposable data, makes the developer's account, opens a channel with the page's own
   client code, and checks that the Worker's WebCrypto (ECDH, HKDF, AES-GCM, HMAC, ECDSA) gives what the browser's does: the signature
   the page checks, a sealed read and write, a refused repeat, and that the developer's panels answer no one else. It stops the Worker it
   started. Needs the repository's node_modules. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const REPO = path.resolve(__dirname, '..');
const PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  // the page's own client code, run here
  globalThis.window = globalThis;
  vm.runInThisContext(fs.readFileSync(path.join(REPO, 'js/net/secchannel.js'), 'utf8'));
  const SC = globalThis.BR.secChannel;

  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-worker-'));
  const child = spawn(path.join(REPO, 'node_modules/.bin/wrangler'), ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state], { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const stop = () => { try { process.kill(-child.pid); } catch { /* gone */ } fs.rmSync(state, { recursive: true, force: true }); };
  try {
    for (let i = 0; i < 90 && !/Ready on/.test(log); i++) await new Promise((r) => setTimeout(r, 1000));
    assert.match(log, /Ready on/, 'the Worker did not start:\n' + log.slice(-600));
    const call = async (method, url, { token, body, headers = {} } = {}) => {
      const h = { ...headers };
      if (token) h.Authorization = `Bearer ${token}`;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      return { ...(await res.json().catch(() => ({}))), status: res.status };
    };
    const device = crypto.randomBytes(16).toString('hex');
    let r = await call('POST', '/api/register', { body: { name: 'taku', password: 'pass1234', avatar: 'traveler-green' }, headers: { 'X-Device': device } });
    assert.equal(r.status, 200, JSON.stringify(r));
    r = await call('POST', '/api/ops/login', { body: { name: 'taku', password: 'pass1234' }, headers: { 'X-Ops-Device': crypto.randomBytes(16).toString('base64url') } });
    assert.equal(r.status, 200, JSON.stringify(r));
    const token = r.token;

    let pin = '';
    const request = async (method, url, body, headers = {}) => {
      const out = await call(method, url, { token, body, headers: method === 'GET' ? headers : { ...headers, Origin: BASE } });
      if (out.status >= 400) throw { status: out.status, code: out.error && out.error.code, message: out.error && out.error.message };
      return out;
    };
    const chan = SC.create({ request, pins: { get: () => pin, set: (v) => { pin = v; } }, env: { protocol: 'http:', host: `127.0.0.1:${PORT}`, origin: BASE, secureContext: true, framed: false } });
    const info = await chan.open();
    assert.ok(info.fp && info.pin === 'new', JSON.stringify(info));
    console.log(`PASS the Worker's signature checks out in the page's own code (identity ${info.fp})`);
    const me = await chan.call('GET', '/api/sec/me');
    assert.equal(me.name, 'taku');
    assert.ok(me.panels.some((p) => p.id === 'dev-channels'));
    const status = await chan.call('GET', '/api/sec/status');
    assert.ok(status.level && status.server);
    await chan.call('POST', '/api/sec/messages', { text: 'worker' });
    assert.equal((await chan.call('GET', '/api/sec/messages')).messages.at(-1).text, 'worker');
    console.log('PASS sealed reads and writes on the Worker');
    // a plain request is turned away
    const plain = await call('GET', '/api/sec/me', { token });
    assert.equal(plain.error && plain.error.code, 'channel_required');
    // a repeat is turned away
    let seen = null;
    const spy = SC.create({ request: async (m, u, b, h) => { seen = { m, u, h }; return request(m, u, b, h); }, pins: { get: () => pin, set() {} }, env: { protocol: 'http:', host: `127.0.0.1:${PORT}`, origin: BASE, secureContext: true, framed: false } });
    await spy.call('GET', '/api/sec/me');
    const again = await call('GET', seen.u, { token, headers: seen.h });
    assert.equal(again.error && again.error.code, 'channel_replay');
    console.log('PASS a plain request and a repeated one are refused');
    // the developer's panels, for the developer; and for no one else
    assert.equal((await chan.call('GET', '/api/sec/dev/channels')).channels.length >= 2, true);
    const other = await call('POST', '/api/register', { body: { name: 'someone', password: 'pass1234', avatar: 'traveler-green' }, headers: { 'X-Device': crypto.randomBytes(16).toString('hex') } });
    const nothing = await call('GET', '/api/sec/dev/channels', { token: other.token });
    assert.equal(nothing.status, 404);
    console.log('SEC CHANNEL ON THE WORKER OK');
  } finally { stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
