/* Run the same deterministic contract against Node and real local workerd. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startWorker } = require('./worker-fixture.cjs');
const { configFrom } = require('../server/core/config.js');

(async () => {
  const { startServer } = await import('../server/test/helpers.js');
  const admin = crypto.randomBytes(24).toString('hex');
  const vars = { START_TOKENS: 10000, START_DOLLARS: 1000000, START_COINS: 100, LOGIN_BONUS: false, QUESTS: false, NPC_GIFTS: false, MILESTONES: false,
    REGISTRATIONS_PER_IP: 0, ACCOUNTS_PER_DEVICE: 0, ADMIN_TOKEN: admin };
  const node = await startServer(configFrom(vars));
  let worker;
  try {
    worker = await startWorker({ vars });
    async function contract(base) {
      const trace = [];
      async function call(method, path, actor = null, body, extra = {}) {
        const headers = { ...extra }; if (actor) headers.Authorization = 'Bearer ' + actor.token;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const result = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        assert.match(result.headers.get('content-type'), /^application\/json/);
        const json = await result.json();
        return { status: result.status, ...json };
      }
      function record(label, reply, data = null) { trace.push({ label, status: reply.status, error: reply.error?.code || '', data }); }
      const register = (name, device) => call('POST', '/api/register', null, { name, password: 'pass1234', avatar: 'traveler-green' }, { 'X-Device': device.repeat(32) });
      const a = await register('ParityA', 'a'), b = await register('ParityB', 'b');
      assert.equal(a.status, 200, JSON.stringify(a)); assert.equal(b.status, 200, JSON.stringify(b));
      const wallet = (r) => Object.fromEntries(['tokens', 'dollars', 'coins', 'spins', 'totalWon', 'totalBet'].map((key) => [key, r.me[key]]));
      record('registered wallet', a, wallet(a));
      record('authentication required', await call('GET', '/api/me'));
      record('unknown route', await call('GET', '/api/no-such-contract-route', a));
      record('bad login', await call('POST', '/api/login', null, { name: 'ParityA', password: 'wrong-password' }));
      const login = await call('POST', '/api/login', null, { name: 'ParityA', password: 'pass1234' });
      assert.equal(login.status, 200); record('password login', login, wallet(login));
      for (const actor of [a, b]) assert.equal((await call('POST', '/api/age', actor, { adult: true })).status, 200);
      const bought = await call('POST', '/api/buy', a, { amount: 3 }); assert.equal(bought.status, 200); record('buy', bought, wallet(bought));
      const sold = await call('POST', '/api/sell', a, { amount: 2 }); assert.equal(sold.status, 200); record('sell', sold, wallet(sold));
      record('negative amount', await call('POST', '/api/buy', a, { amount: -1 }));
      record('insufficient balance', await call('POST', '/api/buy', a, { amount: 100000000 }));
      record('operator permissions', await call('GET', '/api/ops/me', a));
      const request = await call('POST', '/api/friends/request', a, { user: b.me.id }); assert.equal(request.status, 200); record('friend request', request, request.friendship);
      const accept = await call('POST', '/api/friends/respond', b, { user: a.me.id, accept: true }); assert.equal(accept.status, 200); record('friend acceptance', accept, accept.friendship);
      const text = 'こんにちは 世界', sent = await call('POST', '/api/messages', a, { to: b.me.id, text });
      assert.equal(sent.status, 200); assert.equal(sent.message.text, text); record('Unicode message', sent, { text: sent.message.text, kind: sent.message.kind });
      const received = await call('GET', '/api/messages?with=' + a.me.id, b);
      assert.equal(received.messages.filter((message) => message.text === text).length, 1); record('delivered once', received, true);
      const retract = await call('POST', '/api/messages/retract', a, { message: sent.message.id }); assert.equal(retract.status, 200); record('retract', retract);
      const after = await call('GET', '/api/messages?with=' + a.me.id, b);
      assert.equal(after.messages.find((message) => message.id === sent.message.id).text, ''); record('retracted text hidden', after, true);
      for (let stage = 1; stage <= 2; stage++) {
        const warned = await call('POST', '/api/messages', a, { to: b.me.id, text: String.fromCharCode(0) });
        if (warned.error?.stage !== stage) console.error('filter contract', base, warned);
        assert.equal(warned.status, 400); assert.equal(warned.error.stage, stage); assert.equal(warned.error.warning, true);
        record('control DM warning ' + stage, warned, { stage: warned.error.stage, warning: warned.error.warning });
      }
      const allowed = await call('POST', '/api/messages', a, { to: b.me.id, text: 'ordinary message after warnings' });
      assert.equal(allowed.status, 200); record('warnings retain ordinary chat', allowed);
      const filtered = await call('POST', '/api/messages', a, { to: b.me.id, text: 'data:application/octet-stream;base64,' + 'AbCd0123456789'.repeat(20) });
      assert.equal(filtered.status, 400); assert.equal(filtered.error.code, 'filtered'); record('attachment filter', filtered);
      const stopped = await call('POST', '/api/messages', a, { to: b.me.id, text: 'ordinary words' });
      assert.equal(stopped.status, 403); assert.equal(stopped.error.code, 'chat_banned'); record('chat ban after filter', stopped);
      const exported = await call('POST', '/api/admin', null, { cmd: 'export', args: [] }, { 'X-Admin-Token': admin });
      assert.equal(exported.status, 200);
      record('schema and backup tables', exported, { schema: exported.result.schema, tables: Object.keys(exported.result.tables).sort() });
      const logout = await call('POST', '/api/logout', b, {}); assert.equal(logout.status, 200); record('logout', logout);
      const revoked = await call('GET', '/api/me', b); assert.equal(revoked.status, 401); record('revoked session', revoked);
      return trace;
    }
    const expected = await contract(node.base), actual = await contract(worker.base);
    assert.deepEqual(actual, expected, 'Node and Workers must preserve the same contract');
    console.log('PASS runtime parity: ' + expected.length + ' contracts; balances, auth, permissions, Unicode chat, filtering, backup schema and session revocation');
    // Real hibernating WebSockets must be bound to one session, including
    // unused tickets. A second device of the same account remains connected.
    async function call(path, body, token) {
      const res = await fetch(worker.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device': crypto.randomBytes(16).toString('hex'), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
      const r = await res.json(); assert.equal(res.status, 200, path + ': ' + JSON.stringify(r)); return r;
    }
    function open(ticket, operator = false) {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(worker.base.replace(/^http/, 'ws') + '/api/live?' + (operator ? 'ops=' : 'ticket=') + encodeURIComponent(ticket));
        ws.addEventListener('message', () => {});
        ws.addEventListener('open', () => resolve(ws), { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
    }
    for (const [name, operator] of [['RevokeWS', false], ['taku', true]]) {
      const p = await call('/api/register', { name, password: 'pass1234', avatar: 'traveler-green' });
      const second = await call('/api/login', { name, password: 'pass1234' });
      const path = operator ? '/api/ops/live-ticket' : '/api/stream-ticket';
      const a = await open((await call(path, {}, p.token)).ticket, operator);
      const b = await open((await call(path, {}, second.token)).ticket, operator);
      try {
        const unused = (await call(path, {}, p.token)).ticket;
        await call('/api/logout', {}, p.token);
        // Miniflare/undici can keep the closing handshake pending. The close
        // frame must already have made the connection unusable for messages.
        const until = Date.now() + 5000;
        while (a.readyState === WebSocket.OPEN && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
        assert.notEqual(a.readyState, WebSocket.OPEN, 'revoked WebSocket must stop accepting messages');
        assert.equal(b.readyState, WebSocket.OPEN, 'another session stays live');
        await assert.rejects(open(unused, operator), 'a logged-out session cannot spend an unused ticket');
      } finally { a.close(); b.close(); }
    }
    console.log('PASS real workerd WebSocket logout: player/operator streams and unused tickets revoked, other devices preserved');
  } finally { if (worker) await worker.stop(); await node.stop(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
