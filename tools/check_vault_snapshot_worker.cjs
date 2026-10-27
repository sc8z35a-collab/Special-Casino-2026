// Real local R2/SQLite Durable Object recovery check; never connects to production.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { startWorker } = require('./worker-fixture.cjs');
(async () => {
  const s = await startWorker();
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
    const bytes = Buffer.from('recover the real R2 object'), hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const { file } = await call('POST', '/api/vault/files', { name: 'snapshot.txt', size: bytes.length, type: 'text/plain' }, token, ticket);
    await call('POST', '/api/vault/chunk', { id: file.id, n: 0, data: bytes.toString('base64'), sha256: hash }, token, ticket);
    await call('POST', '/api/vault/finish', { id: file.id }, token, ticket);
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
    console.log('PASS real workerd: private R2 snapshot restores and verifies deleted source bytes/metadata without modifying the live vault');
  } finally { await s.stop(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
