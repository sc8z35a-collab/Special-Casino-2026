// Accounts on a device, bans and the operator site (/ops/): npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD, newDevice } from './helpers.js';
import { createAdmin } from '../core/admin.js';
import { sealText, openText, keyFrom } from '../core/auth.js';

let s, call, register, setUser;
let taku;

before(async () => {
  s = await startServer();
  ({ call, register, setUser } = s);
  taku = await register('TAKU');
});

after(() => s.stop());

const ops = (method, url, body) => call(method, url, { token: taku.token, body });
const me = (p) => call('GET', '/api/me', { token: p.token });
const login = (name, password = PASSWORD, device = newDevice()) => call('POST', '/api/login', { body: { name, password }, headers: { 'X-Device': device } });

test('a device makes two accounts; the third is told to use a 引き継ぎコード', async () => {
  const dev = newDevice('ab'.repeat(16));
  await register('Dev1', { device: dev });
  await register('Dev2', { device: dev });
  const r = await call('POST', '/api/register', { body: { name: 'Dev3', password: PASSWORD }, headers: { 'X-Device': dev } });
  assert.equal(r.status, 403);
  assert.equal(r.error.code, 'device_limit');
  assert.match(r.error.message, /引き継ぎコード/);
  // the same phone with its storage wiped: a new id, the same fingerprint from the same address
  const wiped = newDevice('ab'.repeat(16));
  assert.equal((await call('POST', '/api/register', { body: { name: 'Dev3', password: PASSWORD }, headers: { 'X-Device': wiped } })).error.code, 'device_limit');
  // an old game without a device id is asked to update
  assert.equal((await call('POST', '/api/register', { body: { name: 'Dev3', password: PASSWORD }, headers: { 'X-Device': '' } })).error.code, 'update');
  // logging in to one of them still works
  assert.equal((await login('Dev1', PASSWORD, dev)).status, 200);
});

test('the operator site: only the operators; everyone with money, 引き継ぎコード, never a password', async () => {
  const p = await register('OpsPlayer');
  setUser(p.me.id, { dollars: 1234567 });
  assert.equal((await call('GET', '/api/ops/players', { token: p.token })).error.code, 'not_operator');
  assert.equal((await me(taku)).me.operator, true);
  assert.equal((await me(p)).me.operator, false);
  const list = await ops('GET', '/api/ops/players');
  assert.equal(list.status, 200);
  const row = list.players.find((x) => x.id === p.me.id);
  assert.equal(row.dollars, 1234567);
  assert.equal(row.code, p.recoveryCode, 'the 引き継ぎコード made at sign-up');
  assert.equal(row.hasPassword, true);
  assert.ok(!JSON.stringify(list).includes(PASSWORD), 'no password anywhere');
  assert.ok(!('password' in row) && !('password_hash' in row));
  // the code is kept sealed in the database, not as it is
  const enc = s.app.db.prepare('SELECT recovery_enc FROM users WHERE id = ?').get(p.me.id).recovery_enc;
  assert.ok(enc && !enc.includes(p.recoveryCode));
  // looking for a name
  const found = await ops('GET', '/api/ops/players?q=opspl');
  assert.deepEqual(found.players.map((x) => x.id), [p.me.id]);
  // the details: login days in a row, the devices
  const d = await ops('GET', `/api/ops/player?id=${p.me.id}`);
  assert.equal(d.player.name, 'OpsPlayer');
  assert.ok(d.player.devices.length >= 1);
  assert.equal(typeof d.player.dayBest, 'number');
  assert.equal(typeof d.player.playMs, 'number');
  // a new code and a new password for someone who lost theirs
  const rc = await ops('POST', '/api/ops/recovery', { id: p.me.id });
  assert.equal(rc.player.code, rc.code);
  assert.equal((await call('POST', '/api/login', { body: { code: p.recoveryCode }, headers: { 'X-Device': newDevice() } })).status, 404, 'the old code stops working');
  assert.equal((await call('POST', '/api/login', { body: { code: rc.code }, headers: { 'X-Device': newDevice() } })).status, 200);
  assert.equal((await ops('POST', '/api/ops/password', { id: p.me.id, password: 'newpass99' })).status, 200);
  assert.equal((await login('OpsPlayer', 'newpass99')).status, 200);
  assert.equal((await login('OpsPlayer', PASSWORD)).status, 401);
});

test('bans: アクセス禁止 a week, BAN 30 days, 永久BAN until lifted; operators cannot be banned', async () => {
  const p = await register('Banned1');
  let r = await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'suspend' });
  assert.equal(r.player.ban.kind, 'suspend');
  assert.ok(Math.abs(r.player.ban.until - (Date.now() + 7 * 86400000)) < 60000);
  // the game stops (the login stays, for the locked title screen to ask with)
  r = await me(p);
  assert.deepEqual([r.status, r.error.code, r.error.kind], [403, 'banned', 'suspend']);
  assert.match(r.error.message, /アクセス禁止/);
  r = await login('Banned1');
  assert.deepEqual([r.ban.code, r.ban.kind, r.me], ['banned', 'suspend', undefined]);
  // a week later it has run out
  setUser(p.me.id, { ban_until: Date.now() - 1000 });
  assert.ok((await login('Banned1')).me);
  // BAN: 30 days; 永久BAN: no end; both lifted whenever the operator likes
  r = await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'ban' });
  assert.ok(Math.abs(r.player.ban.until - (Date.now() + 30 * 86400000)) < 60000);
  r = await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'perma' });
  assert.deepEqual([r.player.ban.kind, r.player.ban.until], ['perma', 0]);
  assert.match((await login('Banned1')).ban.message, /永久BAN/);
  r = await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'none' });
  assert.equal(r.player.ban, null);
  assert.ok((await login('Banned1')).me);
  // the operator's own accounts
  assert.equal((await ops('POST', '/api/ops/ban', { id: taku.me.id, kind: 'perma' })).error.code, 'operator');
  assert.equal((await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'forever' })).error.code, 'bad_kind');
});

test('a BAN or 永久BAN shuts out the other accounts on the device, every time; the operator can let one play', async () => {
  const dev = newDevice();
  const main = await register('Main1', { device: dev });
  const alt = await register('Alt1', { device: dev });
  const other = await register('Elsewhere1');
  // アクセス禁止 does not reach the device
  await ops('POST', '/api/ops/ban', { id: main.me.id, kind: 'suspend' });
  assert.equal((await me(alt)).status, 200);
  await ops('POST', '/api/ops/ban', { id: main.me.id, kind: 'ban' });
  let r = await me(alt);
  assert.equal(r.status, 403);
  assert.equal(r.error.code, 'device_banned');
  assert.equal((await me(other)).status, 200, 'another device');
  // no new accounts on that device either
  assert.equal((await call('POST', '/api/register', { body: { name: 'Alt2', password: PASSWORD }, headers: { 'X-Device': dev } })).error.code, 'device_banned');
  // let this one play (until the next BAN)
  const list = await ops('GET', '/api/ops/players');
  assert.equal(list.players.find((x) => x.id === alt.me.id).deviceBlocked, true);
  await ops('POST', '/api/ops/device-ok', { id: alt.me.id });
  assert.equal((await me(alt)).status, 200);
  await new Promise((res) => setTimeout(res, 5));
  await ops('POST', '/api/ops/ban', { id: main.me.id, kind: 'perma' });
  assert.equal((await me(alt)).error.code, 'device_banned', 'a new BAN counts again');
  // lifted: everyone on the device plays again
  await ops('POST', '/api/ops/ban', { id: main.me.id, kind: 'none' });
  assert.equal((await me(alt)).status, 200);
  // an account used on the device later (logged in there) is reached too
  const third = await register('Visitor1');
  assert.equal((await login('Visitor1', PASSWORD, dev)).status, 200);
  await ops('POST', '/api/ops/ban', { id: main.me.id, kind: 'ban' });
  assert.equal((await me(third)).error.code, 'device_banned');
  await ops('POST', '/api/ops/ban', { id: main.me.id, kind: 'none' });
});

test('admin: a new password from the command line; codes made there can be read on the site', async () => {
  const p = await register('CliPass');
  // (admin-cli.js seals with the server's own secret, as the server does)
  const key = keyFrom(s.app.db.prepare("SELECT value FROM meta WHERE key = 'ticket_secret'").get().value, 'recovery-codes');
  const admin = createAdmin(s.app.db, { seal: (code) => sealText(key, code) });
  assert.equal((await admin.password('CliPass', 'fromcli77')).name, 'CliPass');
  assert.equal((await login('CliPass', 'fromcli77')).status, 200);
  await assert.rejects(admin.password('CliPass', 'x'), /4文字以上/);
  const out = admin.recovery('CliPass');
  const enc = s.app.db.prepare('SELECT recovery_enc FROM users WHERE id = ?').get(p.me.id).recovery_enc;
  assert.equal(openText(key, enc), out.recoveryCode);
  const row = (await ops('GET', '/api/ops/players')).players.find((x) => x.id === p.me.id);
  assert.equal(row.code, out.recoveryCode);
  // over HTTP with ADMIN_TOKEN as well (Cloudflare has no shell)
  assert.equal((await call('POST', '/api/admin', { body: { cmd: 'password', args: ['CliPass', 'overhttp1'] } })).status, 403);
});
