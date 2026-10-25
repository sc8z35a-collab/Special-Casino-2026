/* Optional check of the 石碑 (server/core/stele.js) on the real Worker runtime (workerd), with its own local R2 and Durable Object:
     node tools/check_stele_worker.cjs
   It starts `wrangler dev --local` on port 8798 with disposable data, makes the developer's account, carves the operators' log into the
   bucket (a file that can only be created), reads it back and looks it over, and then asks again (nothing is written over). It stops the
   Worker it started. Needs the repository's node_modules. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const REPO = path.resolve(__dirname, '..');
const PORT = 8798, BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'stele-worker-'));
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
    const ran = await call('POST', '/api/ops/stele/run', { token, body: {} });
    assert.equal(ran.status, 200, JSON.stringify(ran));
    assert.equal(ran.stele.on, true, 'the Worker has a place for the copies');
    assert.ok(ran.stele.sealed >= 1 && ran.stele.pending === 0, JSON.stringify(ran.stele));
    assert.equal(ran.ran.ok, true, JSON.stringify(ran));
    console.log(`PASS the log was carved into the bucket (#1〜#${ran.stele.sealed}), read back and looked over`);
    // again: nothing new is written, and nothing is written over
    const more = await call('POST', '/api/ops/stele/run', { token, body: {} });
    assert.equal(more.ran.ok, true);
    assert.ok(more.stele.sealed >= ran.stele.sealed);
    assert.equal((await call('GET', '/api/ops/stele', { token })).stele.check.ok, true);
    const arch = await call('GET', '/api/ops/log/archive?after=0&limit=5', { token });
    assert.ok(arch.rows.length >= 1 && arch.cols.length === 11);
    console.log('PASS asked again: still whole, and the developer\'s copy of the rows comes');
    console.log('STELE ON THE WORKER OK');
  } finally { stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
