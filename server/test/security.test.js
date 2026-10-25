// The operator site's security (DEV9): its login's waits, the log's kinds and
// the copy of its newest hash kept outside, the emergency stop, the
// プレイヤーアーカイブ with deleted accounts and the 90-day purge, the
// developer's encrypted backups, and the release each player's game runs.
// npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, newDevice } from './helpers.js';

const CODE = '987654321098';   // (a test code: the real one is never written anywhere)
const subtle = globalThis.crypto.subtle;
const b64 = (u8) => Buffer.from(u8).toString('base64');

// the developer (TAKU) with the developer code registered
async function developer(s) {
  const taku = await s.register('TAKU');
  const call = (method, url, body, headers) => s.call(method, url, { token: taku.token, body, headers });
  assert.equal((await call('POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
  return { taku, call };
}
const opsLogin = (s, name, password, device = 'browser-aaaaaaaaaaaaaaaa') => s.call('POST', '/api/ops/login', { body: { name, password }, headers: { 'X-Ops-Device': device } });

test('the operator site\'s login: two wrong tries on a name hold that ACCOUNT (any browser) 5 minutes, then 10, 20 …; the server counts the wait; a good one starts over', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'] });
  try {
    await s.register('Mod1');
    await s.register('Player1');
    const locks = (prefix) => s.app.db.prepare('SELECT * FROM ops_locks').all().filter((r) => r.key.startsWith(prefix));
    const wait = (name, device) => s.call('POST', '/api/ops/login-wait', { body: { name }, headers: { 'X-Ops-Device': device } });
    assert.equal((await opsLogin(s, 'Mod1', 'pass1234', 'home-browser-00000001')).name, 'Mod1');
    assert.equal((await wait('Mod1', 'other-browser-0000001')).left, 0, 'no wait yet');

    const first = await opsLogin(s, 'Mod1', 'wrong', 'other-browser-0000001');
    assert.equal(first.error.code, 'bad_login');
    assert.match(first.error.message, /5分間/);
    // the second wrong try, from ANOTHER browser, is the same account's: it waits 5 minutes
    const second = await opsLogin(s, 'Mod1', 'wrong', 'other-browser-0000002');
    assert.equal(second.status, 429);
    assert.equal(second.error.code, 'ops_locked');
    assert.equal(second.error.scope, 'account');
    assert.ok(Math.abs(second.error.until - (Date.now() + 5 * 60000)) < 5000, '5 minutes');
    assert.ok(second.error.left > 290000 && second.error.left <= 300000, 'the time left, from the server\'s own clock');
    // the right password waits too, whatever the browser; a name that is not locked does not
    assert.equal((await opsLogin(s, 'Mod1', 'pass1234', 'other-browser-0000003')).error.code, 'ops_locked');
    assert.equal((await opsLogin(s, 'Player1', 'pass1234', 'other-browser-0000003')).error.code, 'bad_login', 'a player is a wrong try on its own name');
    // the page asks the server (after a reload, in another tab): the same wait, in time left, for that name only
    const asked = await wait('mod1', 'other-browser-0000003');
    assert.equal(asked.scope, 'account');
    assert.ok(asked.left > 290000 && asked.left <= 300000);
    assert.equal((await wait('Somebody', 'other-browser-0000003')).left, 0);
    assert.equal(locks('acct:').length >= 1, true);

    // a browser the account has been logged in with is not held by what a stranger started
    assert.equal((await wait('Mod1', 'home-browser-00000001')).left, 0);

    // 5 minutes later: two more wrong ones, 10 minutes
    s.app.db.prepare('UPDATE ops_locks SET until = ?').run(Date.now() - 1000);
    assert.match((await opsLogin(s, 'Mod1', 'x', 'other-browser-0000004')).error.message, /10分間/);
    const third = await opsLogin(s, 'Mod1', 'y', 'other-browser-0000005');
    assert.ok(Math.abs(third.error.until - (Date.now() + 10 * 60000)) < 5000, '10 minutes');
    s.app.db.prepare('UPDATE ops_locks SET until = ?').run(Date.now() - 1000);
    await opsLogin(s, 'Mod1', 'x', 'other-browser-0000006');
    assert.ok(Math.abs((await opsLogin(s, 'Mod1', 'y', 'other-browser-0000007')).error.until - (Date.now() + 20 * 60000)) < 5000, '20 minutes');

    // a good login starts it over
    s.app.db.prepare('UPDATE ops_locks SET until = ?').run(Date.now() - 1000);
    assert.ok((await opsLogin(s, 'Mod1', 'pass1234', 'other-browser-0000008')).token);
    assert.equal(locks('acct:mod1').length, 0, 'the account starts over');
    assert.match((await opsLogin(s, 'Mod1', 'x', 'other-browser-0000008')).error.message, /5分間/);
  } finally {
    await s.stop();
  }
});

test('the log in kinds (プレイヤー・運営・セキュリティ・保管庫・緊急), and the copy of its newest hash outside the table', async () => {
  const s = await startServer({ operators: ['taku'] });
  try {
    const { call } = await developer(s);
    const p = await s.register('Kind1');
    await s.call('POST', '/api/password', { token: p.token, body: { current: 'pass1234', password: 'pass5678' } });
    await call('POST', '/api/ops/ban', { id: p.me.id, kind: 'suspend' });
    const kinds = async (kind) => (await call('GET', `/api/ops/log?kind=${kind}`)).entries.map((e) => e.action);
    assert.ok((await kinds('player')).includes('player_register') && (await kinds('player')).includes('player_password'));
    assert.ok((await kinds('operator')).includes('ban:suspend'));
    assert.ok((await kinds('security')).includes('dev_code_set'));
    assert.ok(!(await kinds('operator')).includes('player_register'));
    const all = await call('GET', '/api/ops/log');
    assert.ok(all.counts.player >= 3 && all.counts.security >= 1 && all.counts.emergency === 0);
    assert.ok(all.entries.every((e) => e.kind));

    const v = await call('GET', '/api/ops/log/verify');
    assert.equal(v.ok, true);
    assert.equal(v.anchor.id, all.entries[0].id, 'the newest hash is kept outside');
    // the table rebuilt, or its end cut off: the copy outside does not match
    const file = path.join(s.app.config.dataDir, 'ops-log.anchor.json');
    const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...kept, hash: 'f'.repeat(64) }));
    assert.match((await call('GET', '/api/ops/log/verify')).reason, /作り直されて/);
    fs.writeFileSync(file, JSON.stringify({ ...kept, id: kept.id + 5 }));
    assert.match((await call('GET', '/api/ops/log/verify')).reason, /消されています/);
  } finally {
    await s.stop();
  }
});

test('the emergency stop: far above the usual two minutes running, a 緊急 entry, everyone stopped but the developer, who starts it again with the code', async () => {
  let now = Date.now();
  const s = await startServer({ operators: ['taku', 'mod1'], clock: () => now, emergencyFloors: { requests: 8, bytes: 1e12, wsIn: 1e12, dbGrowth: 1e12, opsRequests: 1e12, opsBytes: 1e12 } });
  try {
    const { call } = await developer(s);
    const mod = await s.register('Mod1'), p = await s.register('Busy1');
    const burst = async (n) => { for (let i = 0; i < n; i++) await s.call('GET', '/api/me', { token: p.token }); };
    await burst(12);
    now += 60000;
    await burst(12);
    now += 60000;
    // the second minute over: stopped
    const r = await s.call('GET', '/api/me', { token: p.token });
    assert.equal(r.status, 503);
    assert.equal(r.error.code, 'maintenance');
    assert.equal(r.error.emergency, true);
    assert.equal((await s.call('GET', '/api/health')).status, 503);
    assert.equal((await s.call('GET', '/api/ops/players', { token: mod.token })).status, 503, 'other operators too');
    assert.equal((await opsLogin(s, 'Mod1', 'pass1234')).status, 503);

    // the developer comes in and sees why
    assert.ok((await opsLogin(s, 'TAKU', 'pass1234')).token);
    const e = await call('GET', '/api/emergency');
    assert.equal(e.stopped, true);
    assert.equal(e.entries[0].action, 'emergency_stop');
    assert.equal(e.entries[0].kind, 'emergency');
    const d = e.entries[0].detail;
    assert.equal(d.over[0].key, 'requests');
    assert.ok(d.busiest.accounts.some((a) => a.name === 'Busy1'));
    assert.ok(d.minutes.length >= 2);
    assert.equal((await call('GET', '/api/ops/players')).status, 503, 'only the emergency page');

    assert.equal((await call('POST', '/api/emergency/release', { code: '111111111111' })).error.code, 'dev_code');
    assert.equal((await call('POST', '/api/emergency/release', { code: CODE })).stopped, false);
    assert.equal((await s.call('GET', '/api/me', { token: p.token })).status, 200);
    // (half an hour of grace)
    await burst(12); now += 60000; await burst(12); now += 60000;
    assert.equal((await s.call('GET', '/api/me', { token: p.token })).status, 200);

    // by hand
    assert.equal((await s.call('POST', '/api/emergency/stop', { token: mod.token, body: { code: CODE } })).status, 403);
    assert.equal((await call('POST', '/api/emergency/stop', { code: CODE, reason: '点検' })).stopped, true);
    assert.equal((await s.call('GET', '/api/me', { token: p.token })).status, 503);
    // it lasts through a restart
    const log = (await call('GET', '/api/emergency')).entries.map((x) => x.action);
    assert.deepEqual(log.slice(0, 3), ['emergency_stop', 'emergency_release', 'emergency_stop']);
  } finally {
    await s.stop();
  }
});

test('プレイヤーアーカイブ: a 永久BAN goes there and comes back when lifted; a deleted account (the developer, with the code) never does, nor the same-device accounts; 90 days later their data goes but what was said stays', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'] });
  try {
    const { call } = await developer(s);
    const mod = await s.register('Mod1');
    const ops = (method, url, body) => s.call(method, url, { token: mod.token, body });
    const dev = newDevice();
    const bad = await s.register('Bad1', { device: dev }), sub = await s.register('Bad2', { device: dev });
    const other = await s.register('Other1');
    await s.befriend(bad, other);
    await s.call('POST', '/api/messages', { token: bad.token, body: { to: other.me.id, text: 'こんにちは' } });
    // money the deleted one never tapped goes back when the data goes
    s.app.db.prepare('UPDATE users SET dollars = 1000 WHERE id = ?').run(other.me.id);
    const sent = await s.call('POST', '/api/transfer', { token: other.token, body: { to: bad.me.id, amount: 300, currency: 'dollars' } });
    assert.equal(sent.status, 200, JSON.stringify(sent));

    // 永久BAN: to the archive and back
    await ops('POST', '/api/ops/ban', { id: other.me.id, kind: 'perma' });
    const names = async () => (await ops('GET', '/api/ops/players')).players.map((x) => x.name);
    assert.ok(!(await names()).includes('Other1'));
    const arch = await ops('GET', '/api/ops/archive');
    const o = arch.players.find((x) => x.name === 'Other1');
    assert.equal(o.archive.reason, 'perma');
    assert.ok(Math.abs(o.archive.purgeAt - (Date.now() + 90 * 86400000)) < 60000);
    await ops('POST', '/api/ops/ban', { id: other.me.id, kind: 'none' });
    assert.ok((await names()).includes('Other1'));
    assert.equal((await ops('GET', '/api/ops/archive')).players.length, 0);

    // deleting: the developer only, with the code
    assert.equal((await ops('POST', '/api/ops/delete-account', { id: bad.me.id, code: CODE })).status, 404, 'not for other operators');
    const preview = await call('GET', `/api/ops/delete-account?id=${bad.me.id}`);
    assert.deepEqual(preview.sameDevice.map((x) => x.name), ['Bad2']);
    assert.equal((await call('POST', '/api/ops/delete-account', { id: bad.me.id, code: '000000000000' })).error.code, 'dev_code');
    assert.equal((await call('POST', '/api/ops/delete-account', { id: mod.me.id, code: CODE })).error.code, 'operator');
    const del = await call('POST', '/api/ops/delete-account', { id: bad.me.id, code: CODE });
    assert.deepEqual(del.deleted.map((x) => x.name), ['Bad1', 'Bad2']);
    assert.equal((await s.call('GET', '/api/me', { token: bad.token })).status, 401, 'logged out');
    const back = await s.call('POST', '/api/login', { body: { name: 'Bad2', password: 'pass1234' } });
    assert.deepEqual([back.status, back.error.code], [403, 'deleted']);
    // never back: not even the developer
    assert.equal((await call('POST', '/api/ops/ban', { id: bad.me.id, kind: 'none' })).error.code, 'deleted');
    assert.equal((await call('POST', '/api/ops/password', { id: sub.me.id, password: 'abcd1234' })).error.code, 'deleted');
    const a2 = (await ops('GET', '/api/ops/archive')).players;
    assert.deepEqual(a2.map((x) => [x.name, x.archive.reason, x.withName]).sort(), [['Bad1', 'deleted', ''], ['Bad2', 'deleted', 'Bad1']]);
    assert.ok((await call('GET', '/api/ops/log?kind=security')).entries.some((e) => e.action === 'account_delete'));

    // 90 days later: their data goes, what was said stays (only a name on it)
    s.app.db.prepare('UPDATE users SET purge_at = ? WHERE archived_at > 0').run(Date.now() - 1);
    await s.app.api.housekeeping();
    const left = (t, col, id) => s.app.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).get(id).n;
    assert.equal(left('friends', 'user_id', bad.me.id) + left('devices', 'user_id', bad.me.id) + left('sessions', 'user_id', bad.me.id), 0);
    assert.equal(left('friends', 'friend_id', bad.me.id), 0, 'gone from the friend too');
    assert.equal(left('messages', 'sender_id', bad.me.id), 1, 'what they said stays');
    assert.equal(left('conversations', 'other_id', bad.me.id), 1, 'in the friend\'s chats too');
    const tomb = s.app.db.prepare('SELECT * FROM users WHERE id = ?').get(bad.me.id);
    assert.deepEqual([tomb.name, tomb.name_key, tomb.password_hash, tomb.created_ip, tomb.dollars, tomb.ban_kind, tomb.purge_at, tomb.purged_at > 0],
      ['Bad1（削除済み）', `gone:${bad.me.id}`, '', '', 0, 'deleted', 0, true]);
    assert.equal(left('users', 'id', other.me.id), 1, 'the others stay');
    const chat = await s.call('GET', `/api/messages?with=${bad.me.id}`, { token: other.token });
    assert.deepEqual(chat.messages.filter((m) => m.kind === 'text').map((m) => [m.text, m.from.name]), [['こんにちは', 'Bad1（削除済み）']]);
    assert.deepEqual(chat.messages.filter((m) => m.kind === 'transfer').map((m) => [m.amount, m.claimed, m.returned]), [[300, true, true]]);
    assert.equal(s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(other.me.id).dollars, 1000, 'back to the friend');
    assert.equal((await ops('GET', '/api/ops/archive')).players.length, 0, 'out of the archive');
    assert.equal((await s.call('POST', '/api/login', { body: { name: 'Bad1', password: 'pass1234' } })).status, 401, 'no way in');
    assert.equal((await call('POST', '/api/ops/ban', { id: bad.me.id, kind: 'none' })).error.code, 'deleted', 'never back');
    const again = await s.register('Bad1');
    assert.ok(again.me.id && again.me.id !== bad.me.id, 'the name is free again');
    const purged = (await call('GET', '/api/ops/log?kind=security')).entries.filter((e) => e.action === 'account_purge');
    assert.equal(purged.length, 2);
    assert.equal((await call('GET', '/api/ops/log/verify')).ok, true, 'the log stays whole');
  } finally {
    await s.stop();
  }
});

test('the developer\'s backups: only theirs, every step with the code, encrypted for their key, and opened with the code', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'] });
  try {
    const { call } = await developer(s);
    const mod = await s.register('Mod1');
    await s.register('Saved1');
    assert.equal((await s.call('POST', '/api/backup/open', { token: mod.token, body: { code: CODE } })).status, 404, 'not for other operators');
    assert.equal((await call('POST', '/api/backup/open', { code: '000000000000' })).error.code, 'dev_code');
    const { ticket } = await call('POST', '/api/backup/open', { code: CODE });
    const b = (method, url, body) => call(method, url, body, { 'X-Backup-Ticket': ticket });
    assert.equal((await call('GET', '/api/backup')).error.code, 'backup_locked');
    assert.equal((await b('GET', '/api/backup')).key, null);
    assert.equal((await b('POST', '/api/backup/run', { code: CODE })).error.code, 'no_key');

    // the key, as the operator site makes it: ECDH P-256, the private half locked with the code
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const pub = await subtle.exportKey('jwk', pair.publicKey);
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await subtle.importKey('raw', new TextEncoder().encode(CODE), 'PBKDF2', false, ['deriveKey']);
    const kek = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const locked = { salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, kek, pkcs8))), rounds: 600000 };
    assert.equal((await b('POST', '/api/backup/key', { code: CODE, public: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, locked })).ok, true);

    const made = (await b('POST', '/api/backup/run', { code: CODE })).backup;
    assert.equal(made.kind, 'manual');
    assert.ok(made.tables.users >= 3 && !('vault_files' in made.tables));
    // stored sealed: nothing readable in the database
    const raw = s.app.db.prepare('SELECT data FROM backup_parts').all().map((r) => r.data).join('');
    assert.ok(!Buffer.from(raw, 'base64').toString('latin1').includes('Saved1'));

    // opened: the key unlocked with the code, the backup with the key
    const got = await b('POST', '/api/backup/get', { code: CODE, id: made.id });
    const kek2 = await subtle.deriveKey({ name: 'PBKDF2', salt: Buffer.from(got.locked.salt, 'base64'), iterations: got.locked.rounds, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const priv = await subtle.importKey('pkcs8', await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(got.locked.iv, 'base64') }, kek2, Buffer.from(got.locked.data, 'base64')), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const epk = await subtle.importKey('jwk', got.envelope.epk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const hk = await subtle.importKey('raw', await subtle.deriveBits({ name: 'ECDH', public: epk }, priv, 256), 'HKDF', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('TWO STATE backup v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const gz = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(got.envelope.iv, 'base64') }, key, Buffer.from(got.data, 'base64'));
    const text = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const data = JSON.parse(text);
    assert.equal(data.format, 'two-state-casino');
    assert.ok(data.tables.users.some((u) => u.name === 'Saved1'));
    assert.ok(!('vault_files' in data.tables) && !('backups' in data.tables));

    // every 5 hours: the first one at once, then not again until it is time
    assert.equal((await b('POST', '/api/backup/settings', { code: CODE, every: '5h', keep: 10 })).settings.every, '5h');
    await s.app.api.backupDue();
    await s.app.api.backupDue();
    const list = (await b('GET', '/api/backup')).backups;
    assert.deepEqual(list.map((x) => x.kind).sort(), ['auto', 'manual']);
    assert.ok((await b('GET', '/api/backup')).next > Date.now() + 4 * 3600000);
    await b('POST', '/api/backup/delete', { code: CODE, id: made.id });
    assert.equal((await b('GET', '/api/backup')).backups.length, 1);
    const sec = (await call('GET', '/api/ops/log?kind=security')).entries.map((e) => e.action);
    for (const a of ['backup_key', 'backup_run', 'backup_get', 'backup_settings', 'backup_delete']) assert.ok(sec.includes(a), a);
  } finally {
    await s.stop();
  }
});

test('the release each player\'s game runs, for the operator site', async () => {
  const s = await startServer({ operators: ['taku'] });
  try {
    const { call } = await developer(s);
    const p = await s.register('Ver1');
    const newest = (await call('GET', `/api/ops/player?id=${p.me.id}`)).player.client.newest;
    await s.call('POST', '/api/release', { token: p.token, body: { release: newest - 1, build: 'abcdef123456' }, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' } });
    const c = (await call('GET', `/api/ops/player?id=${p.me.id}`)).player.client;
    assert.deepEqual([c.release, c.build, c.newest], [newest - 1, 'abcdef123456', newest]);
    assert.match(c.agent, /Android/);
  } finally {
    await s.stop();
  }
});

test('the developer reads the other operators\' one-to-one talks (nobody else can); the operators list says who is on and when', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2', 'mod3'] });
  try {
    const { call } = await developer(s);
    const m1 = await s.register('Mod1'), m2 = await s.register('Mod2');
    await s.register('Mod3');
    await s.call('POST', '/api/ops/team/messages', { token: m1.token, body: { to: m2.me.id, text: '内緒の相談' } });
    assert.equal((await s.call('GET', '/api/ops/team/pairs', { token: m2.token })).status, 404);
    const pairs = (await call('GET', '/api/ops/team/pairs')).pairs;
    assert.deepEqual(pairs.map((p) => [p.a.name, p.b.name, p.count, p.last.text]), [['Mod1', 'Mod2', 1, '内緒の相談']]);
    assert.deepEqual((await call('GET', `/api/ops/team/pair?a=${m1.me.id}&b=${m2.me.id}`)).messages.map((m) => m.text), ['内緒の相談']);

    await s.call('GET', '/api/ops/me', { token: m1.token });
    const ops = (await call('GET', '/api/ops/operators')).operators;
    const one = ops.find((o) => o.name === 'Mod1');
    assert.equal(one.site, true);
    assert.ok(one.seenAt > Date.now() - 60000);
    assert.equal(ops.find((o) => o.name === 'Mod3').site, false, 'never on the site');
  } finally {
    await s.stop();
  }
});

test('short messages on a vault file: kept for 1, 3, 7, 30 days or with no end, shown to an AI\'s link while they last', async () => {
  const s = await startServer({ operators: ['taku'] });
  try {
    const { call } = await developer(s);
    const open = await call('POST', '/api/vault/open', { code: CODE });
    const vault = (method, url, body) => call(method, url, body, { 'X-Vault-Ticket': open.ticket });
    const data = Buffer.from('a short text file');
    const { file } = await vault('POST', '/api/vault/files', { name: 'memo.txt', size: data.length, type: 'text/plain' });
    await vault('POST', '/api/vault/chunk', { id: file.id, n: 0, sha256: (await import('node:crypto')).createHash('sha256').update(data).digest('hex'), data: data.toString('base64') });
    assert.equal((await vault('POST', '/api/vault/notes', { id: file.id, text: '車のモデルに使って', days: 2 })).error.code, 'bad_days');
    await vault('POST', '/api/vault/notes', { id: file.id, text: '車のモデルに使って', days: 7 });
    const old = await vault('POST', '/api/vault/notes', { id: file.id, text: '古いメモ', days: 1 });
    assert.equal(old.file.notes.length, 2);
    s.app.db.prepare("UPDATE vault_notes SET until = ? WHERE body = '古いメモ'").run(Date.now() - 1000);
    const link = await vault('POST', '/api/vault/link', { id: '*', hours: 1, ai: true });
    const listed = (await s.call('GET', link.path)).files[0];
    assert.deepEqual(listed.notes.map((n) => n.text), ['車のモデルに使って'], 'an AI sees the ones that last');
    const mine = (await vault('GET', `/api/vault/file?id=${file.id}`)).file.notes;
    assert.equal(mine.length, 2, 'the developer sees the old one too (nothing goes on its own)');
    assert.equal((await vault('GET', '/api/vault/files')).files[0].noteCount, 2, 'the list counts them');
    await vault('POST', '/api/vault/notes/delete', { note: mine[1].id });
    assert.equal((await vault('GET', `/api/vault/file?id=${file.id}`)).file.notes.length, 1);
  } finally {
    await s.stop();
  }
});

test('the login\'s waits: a browser the account was logged in with is held only by its own wait; ten from one address wait the whole address', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'] });
  try {
    await s.register('TAKU');
    await s.register('Mod1');
    assert.ok((await opsLogin(s, 'TAKU', 'pass1234', 'developer-browser-01')).token);
    // strangers shut the account (two wrong tries, a different browser each)…
    await opsLogin(s, 'TAKU', 'x', 'attacker-browser-0001');
    assert.equal((await opsLogin(s, 'TAKU', 'y', 'attacker-browser-0002')).error.code, 'ops_locked');
    assert.equal((await opsLogin(s, 'TAKU', 'pass1234', 'attacker-browser-0003')).error.code, 'ops_locked');
    // …and the developer, in the browser the account has been logged in with, still gets in
    assert.ok((await opsLogin(s, 'TAKU', 'pass1234', 'developer-browser-01')).token);
    // that browser is held by its own wait when IT gets it wrong
    await opsLogin(s, 'TAKU', 'x', 'developer-browser-01');
    const held = await opsLogin(s, 'TAKU', 'y', 'developer-browser-01');
    assert.equal(held.error.code, 'ops_locked');
    assert.equal(held.error.scope, 'device');
    assert.equal((await opsLogin(s, 'TAKU', 'pass1234', 'developer-browser-01')).error.code, 'ops_locked');
    // new browser ids and new names do not get round the address: ten wrong in a row from it
    for (let i = 1; i <= 10; i++) await opsLogin(s, `ghost${i}`, 'x', `attacker-browser-1${String(i).padStart(3, '0')}`);
    const r = await opsLogin(s, 'Mod1', 'pass1234', 'mod-browser-000000001');
    assert.equal(r.error.code, 'ops_locked', 'the address waits');
    assert.equal(r.error.scope, 'address');
  } finally {
    await s.stop();
  }
});
