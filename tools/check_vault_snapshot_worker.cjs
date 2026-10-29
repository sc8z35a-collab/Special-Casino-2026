// Real local R2/SQLite Durable Object recovery check; never connects to production.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { startWorker } = require('./worker-fixture.cjs');
(async () => {
  const s = await startWorker({ vars: { OPERATORS: 'taku,helper' } });
  try {
    const call = async (method, path, body, token, ticket) => {
      const headers = { 'Content-Type': 'application/json', 'X-Device': crypto.randomBytes(16).toString('hex') };
      if (token) headers.Authorization = 'Bearer ' + token;
      if (ticket) headers['X-Vault-Ticket'] = ticket;
      const res = await fetch(s.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json(); assert.equal(res.status, 200, path + ': ' + JSON.stringify(data)); return data;
    };
    const dev = await call('POST', '/api/register', { name: 'taku', password: 'pass1234', avatar: 'traveler-green' });
    const token = dev.token, code = '987654321098';
    await call('POST', '/api/ops/dev-code', { code }, token);
    const { ticket } = await call('POST', '/api/vault/open', { code }, token);
    const mod = await call('POST', '/api/register', { name: 'helper', password: 'pass1234', avatar: 'traveler-green' });
    const list = await call('GET', '/api/ops/players', undefined, mod.token);
    assert.equal(list.players.find(p => p.id === dev.me.id).code, '');
    for (const action of ['password', 'recovery']) {
      const result = await fetch(s.base + '/api/ops/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + mod.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dev.me.id, password: 'must-not-change' }) });
      assert.equal(result.status, 403); assert.equal((await result.json()).error.code, 'staff_credentials');
    }
    const bytes = Buffer.from('recover the real R2 object'), hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const { file } = await call('POST', '/api/vault/files', { name: 'snapshot.txt', size: bytes.length, type: 'text/plain' }, token, ticket);
    const raw = async (data, expected) => {
      const res = await fetch(s.base + `/api/vault/piece?id=${file.id}&n=0`, { method: 'POST', body: data, headers: {
        Authorization: 'Bearer ' + token, 'X-Vault-Ticket': ticket, 'Content-Type': 'application/octet-stream',
        'Content-Length': String(data.length), 'X-Piece-Sha256': crypto.createHash('sha256').update(data).digest('hex')
      } });
      const reply = await res.json(); assert.equal(res.status, expected, JSON.stringify(reply)); return reply;
    };
    await raw(Buffer.alloc(bytes.length, 1), 200);
    await call('POST', '/api/vault/restart', { id: file.id }, token, ticket);
    await raw(bytes, 200); await raw(bytes, 200);
    assert.equal((await raw(Buffer.alloc(bytes.length, 2), 409)).error.code, 'piece_conflict');
    // The JSON fallback and the direct stream share the same immutable piece.
    await call('POST', '/api/vault/chunk', { id: file.id, n: 0, data: bytes.toString('base64'), sha256: hash }, token, ticket);
    await call('POST', '/api/vault/finish', { id: file.id }, token, ticket);
    assert.equal((await raw(Buffer.alloc(bytes.length, 3), 409)).error.code, 'done');
    const back = await call('GET', `/api/vault/chunk?id=${file.id}&n=0`, undefined, token, ticket);
    assert.equal(back.sha256, hash); assert.deepEqual(Buffer.from(back.data, 'base64'), bytes);
    async function run(path, body) {
      let result = await call('POST', path, body, token, ticket);
      for (let i = 0; result.job && i < 20; i++) result = await call('POST', '/api/vault/snapshots/run', {}, token, ticket);
      assert.equal(result.job, null); assert.equal(result.error, ''); return result;
    }
    const saved = await run('/api/vault/snapshots/run', {});
    assert.equal(saved.snapshots[0].files, 1); assert.equal(saved.snapshots[0].check, 'full');
    await call('POST', '/api/vault/delete', { id: file.id }, token, ticket);
    const verified = await run('/api/vault/snapshots/verify', { id: saved.snapshots[0].id });
    assert.equal(verified.snapshots[0].check, 'full'); assert.equal(verified.snapshots[0].bytes, bytes.length);
    console.log('PASS real workerd: staff credentials isolated; immutable R2 raw/JSON retries, restart generations and completed files; snapshot restores deleted generation bytes/metadata without modifying the live vault');
  } finally { await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
