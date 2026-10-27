// Disposable local workerd host. No deploy, real account, remote R2 or production API.
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
exports.freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
exports.startWorker = async function ({ vars = {}, config = path.join(root, 'wrangler.jsonc') } = {}) {
  const port = await exports.freePort(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-contract-'));
  const child = spawn(path.join(root, 'node_modules/.bin/wrangler'), ['dev', '--config', config, '--local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', directory,
    ...Object.entries({ REGISTRATIONS_PER_IP: 0, ACCOUNTS_PER_DEVICE: 0, ...vars }).flatMap(([key, value]) => ['--var', key + ':' + value])],
  { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  let log = '', failed;
  child.stdout.on('data', (data) => { log += data; }); child.stderr.on('data', (data) => { log += data; }); child.on('error', (error) => { failed = error; });
  async function stop() {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    for (let i = 0; i < 20 && child.exitCode === null && child.signalCode === null; i++) await new Promise((resolve) => setTimeout(resolve, 100));
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
  try {
    for (let i = 0; i < 360 && !/Ready on/.test(log); i++) {
      if (failed) throw failed;
      if (child.exitCode !== null) throw new Error('workerd exited: ' + log.slice(-3000));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!/Ready on/.test(log)) throw new Error('workerd startup timed out: ' + log.slice(-3000));
    return { base: 'http://127.0.0.1:' + port, directory, stop };
  } catch (error) { await stop(); throw error; }
};
