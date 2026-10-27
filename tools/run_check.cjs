const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const rules = require('./checks.json');
const { startWorker, freePort } = require('./worker-fixture.cjs');
if (process.argv[2] === '--node') {
  for (const [name, entry] of Object.entries(rules)) if (entry.runner === 'node') {
    const result = spawnSync(process.execPath, [path.join(__dirname, name), ...(entry.args || [])], { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}
const file = process.argv[2], rule = rules[file];
if (!rule) throw new Error('Unknown registered check');
(async () => {
  let worker;
  try {
    const env = { ...process.env };
    if (rule.runner === 'fixture') {
      const pair = crypto.generateKeyPairSync('ed25519'), gate = crypto.randomBytes(32).toString('hex');
      const lineSecret = crypto.randomBytes(16).toString('hex'), staff = 'U' + '1'.repeat(32), linePort = await freePort();
      const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
      // This legacy gate compatibility check exercises the command bot; the current read-only feed is covered by server/test/line-feed.test.js.
      worker = await startWorker({ vars: { GATE_KEY: gate, LINE_FEED_ENABLED: 'false', DISCORD_GUILD_ID: '111111111111111111', DISCORD_STAFF_ROLE_IDS: '222222222222222222', DISCORD_APP_PUBLIC_KEY: publicKey,
        LINE_CHANNEL_SECRET: lineSecret, LINE_CHANNEL_ACCESS_TOKEN: 'disposable-local-line-token', LINE_STAFF_USER_IDS: staff, LINE_API: 'http://127.0.0.1:' + linePort } });
      const keyFile = path.join(worker.directory, 'discord-fixture.pem'); fs.writeFileSync(keyFile, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
      Object.assign(env, { WORKER_URL: worker.base, CHECK_GATE_KEY: gate, CHECK_ED_PRIVATE_KEY_FILE: keyFile, CHECK_LINE_SECRET: lineSecret, CHECK_LINE_STAFF: staff, CHECK_LINE_PORT: String(linePort) });
    }
    const child = spawn(process.execPath, [path.join(__dirname, file), ...(rule.args || [])], { stdio: 'inherit', env, cwd: path.resolve(__dirname, '..') });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => resolve(code ?? 1)); });
    process.exitCode = code;
  } finally { if (worker) await worker.stop(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
