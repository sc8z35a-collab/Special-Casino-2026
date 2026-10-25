/* Optional check of the passkey on the real Worker runtime (workerd), not on Node.
   Start the Worker with the same settings the check is given:

     npx wrangler dev --local --port 8799 --ip 127.0.0.1 \
       --var GATE_KEY:<32 characters or more> --var DISCORD_GUILD_ID:111111111111111111 \
       --var DISCORD_STAFF_ROLE_IDS:222222222222222222 --var DISCORD_APP_PUBLIC_KEY:<64 hex>

     WORKER_URL=http://127.0.0.1:8799 CHECK_GATE_KEY=<the same GATE_KEY> \
       CHECK_ED_PRIVATE_KEY_FILE=<a PEM of the private key of that DISCORD_APP_PUBLIC_KEY> \
       node tools/check_worker.cjs

   For LINE as well, start the Worker with --var LINE_CHANNEL_SECRET:<32 hex>
   --var LINE_CHANNEL_ACCESS_TOKEN:<20 characters or more> --var LINE_STAFF_USER_IDS:U<32 hex>
   --var LINE_API:http://127.0.0.1:8798, and give the check CHECK_LINE_SECRET and
   CHECK_LINE_STAFF (the same values) and CHECK_LINE_PORT=8798 (it runs a stand-in for LINE there).

   It uses an account named taku (the developer) and leaves its data in the local
   state of wrangler (.wrangler/). It checks what only a real Worker can tell:
   P-256 keys and signatures, Ed25519 signatures (the Discord bot), a vault
   piece sent with its own pass straight into R2, a link's comment read no
   further than 2 KB, and the patrol's look over the object's own SQL. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(__dirname, '..');
const BASE = (process.env.WORKER_URL || 'http://127.0.0.1:8799').replace(/\/+$/, '');
const KEY = process.env.CHECK_GATE_KEY || '';
const PEM = process.env.CHECK_ED_PRIVATE_KEY_FILE ? fs.readFileSync(process.env.CHECK_ED_PRIVATE_KEY_FILE, 'utf8') : '';
const GUILD = '111111111111111111', ROLE = '222222222222222222';
const http = require('node:http');
const LINE_SECRET = process.env.CHECK_LINE_SECRET || '', LINE_STAFF = process.env.CHECK_LINE_STAFF || '', LINE_PORT = Number(process.env.CHECK_LINE_PORT || 8798);

(async () => {
  assert.ok(KEY.length >= 32, 'CHECK_GATE_KEY (the Worker\'s GATE_KEY) is needed');
  const { passkeyFor } = await import(REPO + '/server/core/pk.js');
  const { jstDay } = await import(REPO + '/server/core/opsentry.js');
  const call = async (method, url, { token, body, headers = {}, raw } = {}) => {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers: h, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch { json = { text }; }
    return { ...json, status: res.status };
  };
  const device = crypto.randomBytes(16).toString('hex');
  let r = await call('POST', '/api/register', { body: { name: 'taku', password: 'pass1234', avatar: 'traveler-green' }, headers: { 'X-Device': device } });
  if (r.status !== 200) {
    r = await call('POST', '/api/ops/login', { body: { name: 'taku', password: 'pass1234' }, headers: { 'X-Ops-Device': crypto.randomBytes(16).toString('base64url') } });
  } else {
    r = await call('POST', '/api/ops/login', { body: { name: 'taku', password: 'pass1234' }, headers: { 'X-Ops-Device': crypto.randomBytes(16).toString('base64url') } });
  }
  assert.equal(r.status, 200, 'login: ' + JSON.stringify(r));
  const token = r.token;
  console.log('logged in on the Worker');

  // the passkey is asked for: nothing of the operator site answers yet
  assert.equal((await call('GET', '/api/ops/me', { token })).error.code, 'pk_required');
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  const code = passkeyFor(KEY, jstDay(Date.now()), 0);
  const open = await call('POST', '/api/pk/open', { token, body: { passkey: code, pub } });
  assert.equal(open.status, 200, 'open: ' + JSON.stringify(open));
  const sign = async (method, p, { ts = Date.now(), nonce = crypto.randomBytes(16).toString('base64url') } = {}) => {
    const text = `v1\n${method}\n${p.split('?')[0]}\n${ts}\n${nonce}\n${open.gid}`;
    const sig = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Buffer.from(text))).toString('base64url');
    return `${open.gid}.${ts}.${nonce}.${sig}`;
  };
  const signed = async (method, p, body, headers = {}) => call(method, p, { token, body, headers: { 'X-Gate': await sign(method, p), ...headers } });
  const me = await signed('GET', '/api/ops/me');
  assert.equal(me.status, 200, 'signed: ' + JSON.stringify(me));
  const once = await sign('GET', '/api/ops/counts');
  assert.equal((await call('GET', '/api/ops/counts', { token, headers: { 'X-Gate': once } })).status, 200);
  assert.equal((await call('GET', '/api/ops/counts', { token, headers: { 'X-Gate': once } })).error.code, 'pk_required', 'a header is good once');
  console.log('P-256 gate: signed requests pass, a copy does not');

  // the Discord bot: an Ed25519 signature checked by the Worker
  if (PEM) {
    const priv = crypto.createPrivateKey(PEM);
    const ask = (body, o = {}) => {
      const t = String(o.ts || Math.floor(Date.now() / 1000));
      const sig = crypto.sign(null, Buffer.from(t + JSON.stringify(body)), priv).toString('hex');
      return call('POST', '/api/discord/interactions', { body, headers: { 'X-Signature-Ed25519': o.sig || sig, 'X-Signature-Timestamp': t } });
    };
    assert.deepEqual(await ask({ type: 1 }), { type: 1, status: 200 });
    const cmd = { type: 2, guild_id: GUILD, member: { roles: [ROLE], user: { id: '333', username: 'taku' } }, data: { name: 'passkey' } };
    const reply = await ask(cmd);
    assert.equal(reply.data.flags, 64);
    assert.ok(reply.data.content.includes(code), 'the passkey is in the answer');
    assert.equal((await ask({ ...cmd, guild_id: '999999999999999999' })).data.content.includes(code), false);
    assert.equal((await ask(cmd, { sig: '0'.repeat(128) })).status, 401);
    console.log('Ed25519 (Discord): signed calls are answered, forged ones refused');
  } else {
    console.log('(no CHECK_ED_PRIVATE_KEY_FILE: the Discord part is skipped)');
  }

  // LINE: a call signed with the channel secret over the body as it came, answered
  // with a reply (to a stand-in for LINE)
  if (LINE_SECRET && LINE_STAFF) {
    const got = [];
    const fake = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { got.push({ url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
    });
    await new Promise((r) => fake.listen(LINE_PORT, '127.0.0.1', r));
    try {
      const body = JSON.stringify({ destination: 'U' + 'd'.repeat(32), events: [{ type: 'message', webhookEventId: crypto.randomBytes(8).toString('hex'), replyToken: 'worker-check', source: { type: 'user', userId: LINE_STAFF }, message: { type: 'text', id: '1', text: 'パスキー' } }] });
      const sig = crypto.createHmac('sha256', LINE_SECRET).update(body).digest('base64');
      const ok = await call('POST', '/api/line/webhook', { raw: body, headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sig } });
      assert.equal(ok.status, 200, 'webhook: ' + JSON.stringify(ok));
      const forged = await call('POST', '/api/line/webhook', { raw: body, headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sig.slice(0, -4) + 'AAAA' } });
      assert.equal(forged.status, 401);
      for (let i = 0; i < 50 && !got.length; i++) await new Promise((r) => setTimeout(r, 100));
      assert.ok(got.length, 'the Worker answered LINE with a reply');
      assert.equal(got[0].url, '/v2/bot/message/reply');
      assert.equal(got[0].body.replyToken, 'worker-check');
      assert.ok(got[0].body.messages[0].text.includes(code), 'with today\'s passkey');
      console.log('LINE: a signed call is answered with the passkey, a forged one refused');
    } finally { await new Promise((r) => fake.close(r)); }
  } else {
    console.log('(no CHECK_LINE_SECRET / CHECK_LINE_STAFF: the LINE part is skipped)');
  }

  // a vault piece with the file's own pass: no login, straight into R2
  const CODE = '987654321098';
  const dev = await signed('POST', '/api/ops/dev-code', { code: CODE });
  if (dev.status !== 200) {
    // (already set by an earlier run)
  }
  const opened = await signed('POST', '/api/vault/open', { code: CODE });
  assert.equal(opened.status, 200, 'vault open: ' + JSON.stringify(opened).slice(0, 200));
  const data = crypto.randomBytes(3000);
  const made = await signed('POST', '/api/vault/files', { name: `check-${Date.now()}.bin`, size: data.length }, { 'X-Vault-Ticket': opened.ticket });
  assert.equal(made.status, 200, 'file: ' + JSON.stringify(made).slice(0, 200));
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const piece = await fetch(`${BASE}/api/vault/piece?id=${made.file.id}&n=0`, { method: 'POST', body: data, headers: { 'Content-Type': 'application/octet-stream', 'X-Piece-SHA256': sha, 'X-Vault-Upload': made.upload } });
  const pj = await piece.json();
  assert.equal(piece.status, 200, 'piece with its pass alone: ' + JSON.stringify(pj));
  const done = await call('POST', '/api/vault/finish', { body: { id: made.file.id }, headers: { 'X-Vault-Upload': made.upload } });
  assert.equal(done.done, true, 'finish: ' + JSON.stringify(done).slice(0, 200));
  assert.equal((await fetch(`${BASE}/api/vault/piece?id=${made.file.id}&n=0`, { method: 'POST', body: data, headers: { 'Content-Type': 'application/octet-stream', 'X-Piece-SHA256': sha } })).status, 401, 'no pass, no login: refused');
  console.log('vault piece: sent with its pass alone, through the Worker into R2');

  // a link\'s comment: read no further than 2 KB
  const link = await signed('POST', '/api/vault/link', { id: made.file.id, hours: 1, ai: true }, { 'X-Vault-Ticket': opened.ticket });
  assert.equal(link.status, 200, 'link: ' + JSON.stringify(link).slice(0, 200));
  const small = await call('POST', '/api/vault/ai', { body: { t: link.token, f: made.file.id, comment: '確認です' } });
  assert.equal(small.ok, true, JSON.stringify(small));
  const big = await call('POST', '/api/vault/ai', { raw: JSON.stringify({ t: link.token, f: made.file.id, comment: 'x', pad: 'y'.repeat(3000) }), headers: { 'Content-Type': 'application/json' } });
  assert.deepEqual([big.status, big.error && big.error.code], [413, 'too_large']);
  console.log('link comment: 150 characters in, 3 KB refused before the object');
  // the patrol: the server looks over itself (JSON functions, the log's triggers and its pages, on the object's own SQL)
  const look = await signed('POST', '/api/ops/patrol/run', {});
  assert.equal(look.status, 200, 'patrol: ' + JSON.stringify(look).slice(0, 300));
  assert.deepEqual(look.patrol.checks.map((c) => c.id), ['log', 'rights', 'accounts', 'settings']);
  assert.deepEqual(look.patrol.findings, [], 'nothing wrong: ' + JSON.stringify(look.patrol.findings));
  console.log('patrol: the server looked over itself on the Worker, nothing wrong');
  console.log('WORKER OK');
})().catch((e) => { console.error(e); process.exit(1); });
