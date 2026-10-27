// パスキー認証 on the server (server/core/pk.js, server/core/discordbot.js): today's
// six digits open a gate for one page; a wrong one keeps the account out for
// an hour; the page signs what it sends; a login alone is good for nothing;
// the Discord bot gives the passkey to the staff role only; and the
// background upload sends its own pass, not a login. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { startServer, PASSWORD } from './helpers.js';
import { secureClient } from './secure.js';
import { passkeyFor, GATED, GATE_MS, LOCK_MS } from '../core/pk.js';
import { jstDay } from '../core/opsentry.js';
import { totp } from '../core/opsmfa.js';

const KEY = 'pk-test-key-0123456789abcdef0123456789';
// 12:00 on 2026/10/25, Japan time
const NOW0 = Date.UTC(2026, 9, 25, 3, 0, 0);
const LIMITS = { general: [100000, 1000], login: [100000, 1000], vaultWork: [100000, 1000], vaultPull: [100000, 1000], vaultOpen: [100000, 1000], vaultNote: [100000, 1000] };
const CODE = '987654321098';
const GUILD = '111111111111111111', ROLE = '222222222222222222';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const today = (ms, epoch = 0) => passkeyFor(KEY, jstDay(ms), epoch);

// a server whose clock the test moves; the staff and their pages
async function setup(extra = {}) {
  const box = { now: NOW0 };
  const s = await startServer({ operators: ['taku', 'mod'], gateKey: KEY, clock: () => box.now, limits: LIMITS, ...extra });
  s.box = box;
  return s;
}
// logged in to the operator site (a name and a password), no gate yet
async function staff(s, name) {
  const reg = await s.register(name);
  const r = await s.call('POST', '/api/ops/login', { body: { name, password: PASSWORD } });
  assert.equal(r.status, 200, JSON.stringify(r));
  return { name, id: reg.me.id, token: r.token, page: null };
}
// a page's own key pair, as ops/pk.js makes it
async function pageKey() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const j = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { kp, pub: { kty: j.kty, crv: j.crv, x: j.x, y: j.y }, gid: '' };
}
async function header(page, method, path, { ts, nonce = crypto.randomBytes(16).toString('base64url'), gid = page.gid, now } = {}) {
  const t = ts ?? now;
  const text = `v1\n${method}\n${path.split('?')[0]}\n${t}\n${nonce}\n${gid}`;
  const sig = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, page.kp.privateKey, Buffer.from(text))).toString('base64url');
  return `${gid}.${t}.${nonce}.${sig}`;
}
async function openGate(s, who, code = today(s.box.now)) {
  who.page = await pageKey();
  const r = await s.call('POST', '/api/pk/open', { token: who.token, body: { passkey: code, pub: who.page.pub } });
  if (r.gid) who.page.gid = r.gid;
  return r;
}
// a call signed by the page (`o.header`: another, or null for none)
async function sc(s, who, method, path, body, o = {}) {
  const h = { ...(o.headers || {}) };
  const g = o.header === undefined ? await header(who.page, method, path, { now: s.box.now, ...o }) : o.header;
  if (g) h['X-Gate'] = g;
  return s.call(method, path, { token: o.token || who.token, body, headers: h });
}
const logged = (s, action) => s.app.db.prepare('SELECT * FROM ops_log WHERE action = ?').all(action);

test('without GATE_KEY nothing is asked: the operator site works as it did, the bot says it is not set up', async () => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  try {
    const reg = await s.register('taku');
    const login = await s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD } });
    assert.equal((await s.call('GET', '/api/ops/me', { token: login.token })).status, 200);
    assert.equal((await s.call('GET', '/api/pk/state', { token: login.token })).active, false);
    const open = await s.call('POST', '/api/pk/open', { token: login.token, body: { passkey: '123456', pub: {} } });
    assert.deepEqual([open.status, open.error.code], [409, 'pk_off']);
    assert.equal((await s.call('POST', '/api/discord/interactions', { body: { type: 1 } })).error.code, 'bad_signature');
    assert.ok(reg.me.id);
  } finally { await s.stop(); }
});

test('the right six digits open a gate for one page; only what that page signs, once, just now, gets through', async () => {
  const s = await setup();
  try {
    const taku = await staff(s, 'taku');
    // logged in, yet nothing of the operator site, the security base, the vault, the backups or the emergency routes answers
    for (const p of ['/api/ops/me', '/api/sec/me', '/api/vault/spaces', '/api/backup', '/api/emergency']) {
      assert.equal((await s.call('GET', p, { token: taku.token })).error.code, 'pk_required', p);
    }
    assert.equal((await s.call('GET', '/api/me', { token: taku.token })).status, 200, 'the game is not asked');
    const st = await s.call('GET', '/api/pk/state', { token: taku.token });
    assert.deepEqual([st.active, st.day, st.role, st.locked], [true, '2026-10-25', 'developer', 0]);

    // a slip of the fingers (not six digits) is not a try
    taku.page = await pageKey();
    for (const slip of ['', '12345', '1234567', 'abcdef']) {
      const r = await s.call('POST', '/api/pk/open', { token: taku.token, body: { passkey: slip, pub: taku.page.pub } });
      assert.deepEqual([r.status, r.error.code], [400, 'pk_format'], slip);
    }
    const bad = await s.call('POST', '/api/pk/open', { token: taku.token, body: { passkey: today(NOW0), pub: { kty: 'EC', crv: 'P-256', x: 'a', y: 'b' } } });
    assert.equal(bad.error.code, 'pk_key');
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM pk_locks').get().n, 0, 'none of them counted');

    // the right ones (spaces and a dash are allowed in what is typed)
    const code = today(NOW0);
    const open = await s.call('POST', '/api/pk/open', { token: taku.token, body: { passkey: `${code.slice(0, 3)} ${code.slice(3)}`, pub: taku.page.pub } });
    assert.equal(open.status, 200, JSON.stringify(open));
    assert.match(open.gid, /^[0-9a-f]{32}$/);
    assert.deepEqual([open.until, open.day, open.role], [NOW0 + GATE_MS, '2026-10-25', 'developer']);
    taku.page.gid = open.gid;
    const me = await sc(s, taku, 'GET', '/api/ops/me');
    assert.equal(me.status, 200);
    assert.equal(me.entered, true, 'the passkey is the day\'s ログイン');
    assert.equal(s.app.db.prepare('SELECT how FROM ops_entries').get().how, 'passkey');

    // what a stolen login or a copied header cannot do
    const once = await header(taku.page, 'GET', '/api/ops/counts', { now: s.box.now });
    assert.equal((await s.call('GET', '/api/ops/counts', { token: taku.token, headers: { 'X-Gate': once } })).status, 200);
    assert.equal((await s.call('GET', '/api/ops/counts', { token: taku.token, headers: { 'X-Gate': once } })).error.code, 'pk_required', 'a header is good once');
    const other = await header(taku.page, 'GET', '/api/ops/me', { now: s.box.now });
    assert.equal((await s.call('GET', '/api/ops/counts', { token: taku.token, headers: { 'X-Gate': other } })).error.code, 'pk_required', 'signed for another path');
    const post = await header(taku.page, 'POST', '/api/ops/counts', { now: s.box.now });
    assert.equal((await s.call('GET', '/api/ops/counts', { token: taku.token, headers: { 'X-Gate': post } })).error.code, 'pk_required', 'signed for another method');
    const stale = await sc(s, taku, 'GET', '/api/ops/counts', undefined, { ts: s.box.now - 61000 });
    assert.equal(stale.error.code, 'pk_clock');
    const future = await sc(s, taku, 'GET', '/api/ops/counts', undefined, { ts: s.box.now + 61000 });
    assert.equal(future.error.code, 'pk_clock');
    const stranger = await pageKey();
    stranger.gid = taku.page.gid;
    assert.equal((await sc(s, { ...taku, page: stranger }, 'GET', '/api/ops/counts')).error.code, 'pk_required', 'another key');
    assert.equal((await sc(s, taku, 'GET', '/api/ops/counts', undefined, { header: 'junk' })).error.code, 'pk_required');
    assert.equal((await sc(s, taku, 'GET', '/api/ops/counts', undefined, { header: null })).error.code, 'pk_required');
    // …nor the gate of another login of the same person
    const second = await s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD } });
    assert.equal((await sc(s, { ...taku, token: second.token }, 'GET', '/api/ops/counts')).error.code, 'pk_required', 'a gate belongs to its login');

    // an hour: the gate ends (and the passkey is asked again, with a new key)
    s.box.now = open.until + 1;
    assert.equal((await sc(s, taku, 'GET', '/api/ops/counts')).error.code, 'pk_expired');
    assert.equal((await sc(s, taku, 'GET', '/api/ops/counts')).error.code, 'pk_required', 'gone for good');
    const again = await openGate(s, taku);
    assert.equal(again.status, 200);
    assert.equal((await sc(s, taku, 'GET', '/api/ops/counts')).status, 200);

    // the page is done: its gate closes
    assert.equal((await sc(s, taku, 'POST', '/api/pk/close', {}, { header: null })).closed, 1);
    assert.equal((await sc(s, taku, 'GET', '/api/ops/counts')).error.code, 'pk_required');
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM pk_gates').get().n, 0);
  } finally { await s.stop(); }
});

test('a wrong passkey, once: logged, told on Discord\'s side, and an hour before the next try — which is not even looked at', async () => {
  const s = await setup();
  try {
    const taku = await staff(s, 'taku'), mod = await staff(s, 'mod');
    const player = await s.register('Player1');
    const right = today(NOW0);
    const wrong = right === '918273' ? '918274' : '918273';
    taku.page = await pageKey();
    assert.equal((await s.call('POST', '/api/pk/open', { token: player.token, body: { passkey: right, pub: taku.page.pub } })).error.code, 'not_operator');

    const r = await s.call('POST', '/api/pk/open', { token: taku.token, body: { passkey: wrong, pub: taku.page.pub } });
    assert.deepEqual([r.status, r.error.code, r.error.until], [403, 'pk_wrong', NOW0 + LOCK_MS]);
    const rows = logged(s, 'pk_fail');
    assert.equal(rows.length, 1);
    assert.ok(rows[0].summary.includes('taku') && rows[0].summary.includes('開発者') && !rows[0].summary.includes(wrong) && !rows[0].detail.includes(wrong), 'the number tried is not kept');
    assert.equal(s.app.api.pk.lockOf(taku.id).until, NOW0 + LOCK_MS);
    assert.equal((await s.call('GET', '/api/pk/state', { token: taku.token })).locked, NOW0 + LOCK_MS);

    // the right one during the hour: refused without being looked at
    s.box.now += 30 * 60000;
    const during = await s.call('POST', '/api/pk/open', { token: taku.token, body: { passkey: right, pub: taku.page.pub } });
    assert.deepEqual([during.status, during.error.code, during.error.until], [429, 'pk_locked', NOW0 + LOCK_MS]);
    assert.equal(s.app.db.prepare('SELECT wrong FROM pk_locks WHERE user_id = ?').get(taku.id).wrong, 1, 'not tried, so not counted again');
    // someone else is not held up by it; to the operators it is a line of the security log
    assert.equal((await openGate(s, mod)).status, 200);
    const security = await sc(s, mod, 'GET', '/api/ops/log?kind=security');
    assert.ok(security.entries.some((e) => e.action === 'pk_fail' && e.kind === 'security'));
    // the hour is up
    s.box.now = NOW0 + LOCK_MS + 1;
    assert.equal((await openGate(s, taku)).status, 200);
    assert.equal((await sc(s, taku, 'GET', '/api/ops/me')).status, 200);
    // the developer lets another account try again at once
    assert.equal(s.app.api.pk.unlock(taku.id), true);
  } finally { await s.stop(); }
});

test('a new passkey every day at 0:00 Japan time (yesterday\'s still taken for 3 minutes), and the incident epoch changes them all', async () => {
  const s = await setup();
  try {
    const taku = await staff(s, 'taku'), mod = await staff(s, 'mod');
    assert.notEqual(today(NOW0), today(NOW0 + 86400000));
    // 0:01 on the 26th: yesterday's and today's both
    s.box.now = Date.UTC(2026, 9, 25, 15, 1, 0);
    assert.equal((await openGate(s, taku, passkeyFor(KEY, '2026-10-25', 0))).status, 200);
    assert.equal((await openGate(s, mod, passkeyFor(KEY, '2026-10-26', 0))).status, 200);
    // 0:05: only today's (and the one who tries yesterday's waits an hour)
    s.box.now = Date.UTC(2026, 9, 25, 15, 5, 0);
    assert.equal((await openGate(s, taku, passkeyFor(KEY, '2026-10-25', 0))).error.code, 'pk_wrong');
    s.box.now += LOCK_MS + 1;
    assert.equal((await openGate(s, taku, passkeyFor(KEY, '2026-10-26', 0))).status, 200);
    // the epoch: every gate ends at once, every passkey changes
    assert.equal((await openGate(s, mod, passkeyFor(KEY, '2026-10-26', 0))).status, 200);
    assert.equal((await sc(s, mod, 'GET', '/api/ops/me')).status, 200);
    assert.ok(s.app.db.prepare('SELECT COUNT(*) AS n FROM pk_gates').get().n >= 2);
    assert.equal(s.app.api.pk.bump(), 1);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM pk_gates').get().n, 0);
    assert.equal((await sc(s, mod, 'GET', '/api/ops/me')).error.code, 'pk_required');
    assert.equal((await openGate(s, mod, passkeyFor(KEY, '2026-10-26', 0))).error.code, 'pk_wrong', 'the old passkey is nothing now');
    s.box.now += LOCK_MS + 1;
    assert.equal((await openGate(s, mod, passkeyFor(KEY, jstDay(s.box.now), 1))).status, 200);
    assert.equal(s.app.api.pk.epoch(), 1);
  } finally { await s.stop(); }
});

test('an operator-site login lasts a day, 8 hours without a request; the game\'s login is not touched', async () => {
  const s = await setup();
  try {
    const taku = await staff(s, 'taku');
    const game = await s.register('Gamer');
    const row = () => s.app.db.prepare('SELECT * FROM sessions WHERE ops = 1').get();
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE ops = 1').get().n, 1);
    assert.equal((await s.call('GET', '/api/pk/state', { token: taku.token })).status, 200);
    s.app.db.prepare('UPDATE sessions SET last_used = last_used - ? WHERE ops = 1').run(9 * 3600000);
    const idle = await s.call('GET', '/api/pk/state', { token: taku.token });
    assert.deepEqual([idle.status, idle.error.code], [401, 'auth']);
    assert.equal(row(), undefined, 'gone');
    const t2 = (await s.call('POST', '/api/ops/login', { body: { name: 'taku', password: PASSWORD } })).token;
    assert.equal((await s.call('GET', '/api/pk/state', { token: t2 })).status, 200);
    s.app.db.prepare('UPDATE sessions SET created_at = created_at - ?, last_used = last_used WHERE ops = 1').run(25 * 3600000);
    assert.equal((await s.call('GET', '/api/pk/state', { token: t2 })).error.code, 'auth');
    s.app.db.prepare('UPDATE sessions SET created_at = created_at - ?, last_used = last_used - ?').run(30 * 3600000, 30 * 3600000);
    assert.equal((await s.call('GET', '/api/me', { token: game.token })).status, 200, 'a game login is as long as ever');
  } finally { await s.stop(); }
});

test('the background upload sends its own pass, no login: good for that one file, ended by the epoch, not by a login of someone else', async () => {
  const s = await setup();
  try {
    const taku = await staff(s, 'taku');
    assert.equal((await openGate(s, taku)).status, 200);
    assert.equal((await sc(s, taku, 'POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
    const ticket = (await sc(s, taku, 'POST', '/api/vault/open', { code: CODE })).ticket;
    const put = (id, pass, part, extra = {}) => fetch(`${s.base}/api/vault/piece?id=${id}&n=0`, {
      method: 'POST', body: part, headers: { 'Content-Type': 'application/octet-stream', 'X-Piece-SHA256': sha(part), ...(pass ? { 'X-Vault-Upload': pass } : {}), ...extra }
    }).then(async (r) => ({ ...(await r.json()), status: r.status }));
    const make = (name, size) => sc(s, taku, 'POST', '/api/vault/files', { name, size }, { headers: { 'X-Vault-Ticket': ticket } });
    const a = await make('a.bin', 5), b = await make('b.bin', 5);
    assert.ok(a.upload && b.upload);
    const part = Buffer.from('hello');
    // no login at all, no ticket: the pass alone
    assert.equal((await put(a.file.id, null, part)).error.code, 'auth', 'nothing: no');
    assert.equal((await put(b.file.id, a.upload, part)).error.code, 'vault_locked', 'another file\'s pass');
    const done = await put(a.file.id, a.upload, part);
    assert.deepEqual([done.status, done.done], [200, true], JSON.stringify(done));
    assert.equal((await s.call('POST', '/api/vault/finish', { body: { id: a.file.id }, headers: { 'X-Vault-Upload': a.upload } })).done, true);
    // a login that comes with it is that login's: without its gate it is asked for
    assert.equal((await put(b.file.id, b.upload, part, { Authorization: `Bearer ${taku.token}` })).error.code, 'pk_required');
    // the passes ended by the epoch (the incident mode)
    s.app.api.pk.bump();
    assert.equal((await put(b.file.id, b.upload, part)).error.code, 'auth');
    // a pass of someone who is no longer staff is nothing
    const mod = await staff(s, 'mod');
    assert.equal((await openGate(s, mod, today(s.box.now, 1))).status, 200);
    const own = await sc(s, mod, 'POST', '/api/vault/files', { space: `u:${mod.id}`, name: 'own.bin', size: 5 });
    assert.equal((await put(own.file.id, own.upload, part)).status, 200);
    const own2 = await sc(s, mod, 'POST', '/api/vault/files', { space: `u:${mod.id}`, name: 'own2.bin', size: 5 });
    s.app.db.prepare("INSERT INTO ops_access (name_key, granted, at, by_id) VALUES ('mod', 0, ?, ?)").run(s.box.now, taku.id);
    const gone = await put(own2.file.id, own2.upload, part);
    assert.equal(gone.status, 403, JSON.stringify(gone));
  } finally { await s.stop(); }
});

// the Discord application's own key
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const APP_KEY = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const command = (roles, guild = GUILD, name = 'passkey') => ({ type: 2, id: '1', guild_id: guild, member: { roles, user: { id: '333', username: 'taku', global_name: 'Taku' } }, data: { name } });
const interaction = (s, body, { ts, sig } = {}) => {
  const t = String(ts ?? Math.floor(s.box.now / 1000));
  const signature = sig ?? crypto.sign(null, Buffer.from(t + JSON.stringify(body)), privateKey).toString('hex');
  return s.call('POST', '/api/discord/interactions', { body, headers: { 'X-Signature-Ed25519': signature, 'X-Signature-Timestamp': t } });
};

test('Discord: /passkey answers the staff role alone, to them only, from a signed call of the right server; nothing is kept in a channel', async () => {
  const s = await setup({ discordAppKey: APP_KEY, discordGuild: GUILD, discordStaffRoles: [ROLE] });
  try {
    assert.deepEqual(await interaction(s, { type: 1 }), { type: 1, status: 200 });
    const code = today(NOW0);
    const ok = await interaction(s, command(['5', ROLE]));
    assert.equal(ok.type, 4);
    assert.equal(ok.data.flags, 64, 'shown to the person who asked, nobody else');
    assert.deepEqual(ok.data.allowed_mentions, { parse: [] });
    assert.ok(ok.data.content.includes(code) && ok.data.content.includes('2026/10/25'));
    // the wrong server, no role, no role list, another command: no number
    for (const body of [command(['5', ROLE], '999999999999999999'), command(['5']), command([]), { ...command([ROLE]), member: undefined }, { ...command([ROLE]), guild_id: undefined }]) {
      const r = await interaction(s, body);
      assert.equal(r.type, 4);
      assert.ok(!r.data.content.includes(code), 'no number');
    }
    assert.ok(!(await interaction(s, command([ROLE], GUILD, 'other'))).data.content.includes(code));
    // not signed by Discord: refused (a body changed after signing, an old call, another key, no headers)
    const body = command([ROLE]);
    const signedFor = (b, t) => crypto.sign(null, Buffer.from(String(t) + JSON.stringify(b)), privateKey).toString('hex');
    const t = Math.floor(s.box.now / 1000);
    assert.equal((await interaction(s, { ...body, data: { name: 'passkey', x: 1 } }, { sig: signedFor(body, t) })).error.code, 'bad_signature');
    assert.equal((await interaction(s, body, { ts: t - 301, sig: signedFor(body, t - 301) })).error.code, 'bad_signature');
    const forger = crypto.generateKeyPairSync('ed25519').privateKey;
    assert.equal((await interaction(s, body, { sig: crypto.sign(null, Buffer.from(String(t) + JSON.stringify(body)), forger).toString('hex') })).status, 401);
    assert.equal((await s.call('POST', '/api/discord/interactions', { body })).status, 401);
    // the number follows the epoch; one line in the log for each person every ten minutes
    s.app.api.pk.bump();
    assert.ok((await interaction(s, command([ROLE]))).data.content.includes(today(NOW0, 1)));
    assert.equal(logged(s, 'pk_issue').length, 1);
    // (six an minute for each person at most)
    let last;
    for (let i = 0; i < 8; i++) last = await interaction(s, command([ROLE]));
    assert.ok(last.data.content.includes('少し待って'));
  } finally { await s.stop(); }
});

test('during a lockdown the staff still reach the passkey, the bot and the security base; the rest of the operator site is shut', async () => {
  const s = await setup({ discordAppKey: APP_KEY, discordGuild: GUILD, discordStaffRoles: [ROLE] });
  try {
    const taku = await staff(s, 'taku'), mod = await staff(s, 'mod');
    await openGate(s, taku);
    // (the security base is spoken to through its sealed channel, which the page's gate signs)
    const base = secureClient(s, taku.token, { sign: async (m, p) => ({ 'X-Gate': await header(taku.page, m, p, { now: s.box.now }) }) });
    assert.equal((await base.call('POST', '/api/sec/lockdown', { reason: 'test' })).locked, true);
    // a breach: nothing old is trusted — the open page's gate has ended and the day's passkey is another
    assert.equal((await base.call('GET', '/api/sec/me')).error.code, 'pk_required');
    assert.equal((await openGate(s, mod, today(s.box.now))).error.code, 'pk_wrong', 'the old passkey no longer opens');
    // the new passkey, then the security base — and the operator site stays shut
    s.box.now += 3600000 + 1; // (the wrong try above kept that account out for an hour: the clock moves on)
    assert.equal((await s.call('GET', '/api/pk/state', { token: taku.token })).status, 200);
    assert.equal((await openGate(s, taku, today(s.box.now, 1))).status, 200);
    assert.equal((await base.call('GET', '/api/sec/me')).status, 200, 'a new gate, a new channel (the page opens it by itself)');
    assert.equal((await sc(s, taku, 'GET', '/api/ops/me')).status, 503);
    assert.equal((await interaction(s, command([ROLE]))).data.content.includes(today(s.box.now, 1)), true, 'the bot answers with the new one: it reads and writes nothing');
    assert.equal((await base.call('POST', '/api/sec/release', {})).locked, false);
    // lifting it ends the staff\'s logins: they log in again
    assert.equal((await s.call('GET', '/api/pk/state', { token: mod.token })).error.code, 'ended');
  } finally { await s.stop(); }
});

test('Discord out of reach: the developer alone, with the authenticator\'s code, opens the gate (3 a day, logged); a wrong code is a wrong passkey', async () => {
  const s = await setup();
  try {
    const taku = await staff(s, 'taku'), mod = await staff(s, 'mod');
    await openGate(s, taku);
    const pub = (await pageKey()).pub;
    // no authenticator set up: no way round
    const none = await s.call('POST', '/api/pk/breakglass', { token: taku.token, body: { pub } });
    assert.deepEqual([none.status, none.error.code], [409, 'mfa_unset']);
    // set it up (the operator site's profile)
    const begin = await sc(s, taku, 'POST', '/api/ops/profile/mfa/begin', { password: PASSWORD });
    const step = () => Math.floor(s.box.now / 30000);
    const enabled = await sc(s, taku, 'POST', '/api/ops/profile/mfa/enable', { password: PASSWORD, mode: 2, otp: totp(begin.secret, step()) });
    assert.equal(enabled.mfa.mode, 2);
    const login = async (name) => {
      s.box.now += 30000;
      const r = await s.call('POST', '/api/ops/login', { body: { name, password: PASSWORD, otp: totp(begin.secret, step()) } });
      assert.equal(r.status, 200, JSON.stringify(r));
      return r.token;
    };
    // an operator is not the developer
    assert.equal((await s.call('POST', '/api/pk/breakglass', { token: mod.token, body: { pub, otp: '123456' } })).error.code, 'not_developer');
    // the developer: a wrong code is a wrong passkey (an hour)
    let token = await login('taku');
    const page = await pageKey();
    const wrong = await s.call('POST', '/api/pk/breakglass', { token, body: { pub: page.pub, otp: '000000' } });
    assert.ok(['pk_wrong', 'mfa_invalid'].includes(wrong.error.code), JSON.stringify(wrong));
    // a new login after the hour; this time the right code
    s.box.now += LOCK_MS + 1;
    token = await login('taku');
    const nothing = await s.call('POST', '/api/pk/breakglass', { token, body: { pub: page.pub } });
    assert.equal(nothing.error.code, 'mfa_required', 'nothing given is not a try');
    s.box.now += 30000;
    const open = await s.call('POST', '/api/pk/breakglass', { token, body: { pub: page.pub, otp: totp(begin.secret, step()) } });
    assert.equal(open.status, 200, JSON.stringify(open));
    page.gid = open.gid;
    assert.equal((await sc(s, { token, page }, 'GET', '/api/ops/me')).status, 200);
    assert.equal(logged(s, 'pk_breakglass').length, 1);
    // three a day
    for (let i = 0; i < 2; i++) {
      token = await login('taku');
      s.box.now += 30000;
      assert.equal((await s.call('POST', '/api/pk/breakglass', { token, body: { pub: page.pub, otp: totp(begin.secret, step()) } })).status, 200);
    }
    token = await login('taku');
    s.box.now += 30000;
    const fourth = await s.call('POST', '/api/pk/breakglass', { token, body: { pub: page.pub, otp: totp(begin.secret, step()) } });
    assert.deepEqual([fourth.status, fourth.error.code], [429, 'pk_breakglass_limit']);
  } finally { await s.stop(); }
});

test('a 閲覧者 opens the gate too, and still only looks', async () => {
  const s = await setup();
  try {
    const viewer = await s.register('Viewer1');
    s.app.db.prepare('INSERT INTO ops_viewers (user_id, granted, at, by_id) VALUES (?, 1, ?, 1)').run(viewer.me.id, NOW0);
    const login = await s.call('POST', '/api/ops/login', { body: { name: 'Viewer1', password: PASSWORD } });
    assert.equal(login.viewer, true);
    const v = { token: login.token, page: null };
    assert.equal((await s.call('GET', '/api/ops/me', { token: v.token })).error.code, 'pk_required');
    assert.equal((await s.call('GET', '/api/pk/state', { token: v.token })).role, 'viewer');
    assert.equal((await openGate(s, v)).status, 200);
    assert.equal((await sc(s, v, 'GET', '/api/ops/me')).status, 200);
    assert.equal((await sc(s, v, 'GET', '/api/ops/players')).error.code, 'viewer');
  } finally { await s.stop(); }
});

test('the registration script sends /passkey to the right server with the bot\'s token, and says plainly what is missing', async () => {
  const { register, commandBody, API } = await import('../../tools/discord-register.mjs');
  const sent = [];
  const fetcher = async (url, init) => { sent.push({ url, init }); return { ok: true, json: async () => commandBody() }; };
  const list = await register({ appId: '12345678', guildId: '87654321', token: 'tok', fetcher });
  assert.deepEqual(list.map((c) => c.name), ['passkey']);
  assert.equal(sent[0].url, `${API}/applications/12345678/guilds/87654321/commands`);
  assert.equal(sent[0].init.method, 'PUT');
  assert.equal(sent[0].init.headers.Authorization, 'Bot tok');
  const body = JSON.parse(sent[0].init.body);
  assert.deepEqual([body.length, body[0].name, body[0].type, body[0].dm_permission], [1, 'passkey', 1, false]);
  await assert.rejects(register({ appId: 'x', guildId: '87654321', token: 'tok', fetcher }), /DISCORD_APP_ID/);
  await assert.rejects(register({ appId: '12345678', guildId: '', token: 'tok', fetcher }), /DISCORD_GUILD_ID/);
  await assert.rejects(register({ appId: '12345678', guildId: '87654321', token: '', fetcher }), /DISCORD_BOT_TOKEN/);
  await assert.rejects(register({ appId: '12345678', guildId: '87654321', token: 'tok', fetcher: async () => ({ ok: false, status: 401, text: async () => 'no' }) }), /401/);
});

test('both sites load one shared signing client, guarding exactly the server routes', () => {
  const a = fs.readFileSync(new URL('../../js/net/gate.js', import.meta.url), 'utf8');
  const scripts = ['ops', 'sec'].map((site) => {
    const html = fs.readFileSync(new URL('../../' + site + '/index.html', import.meta.url), 'utf8');
    const src = /src="([^"]*gate\.js[^\"]*)"/.exec(html)[1];
    return new URL(src, 'https://casino.test/' + site + '/').pathname;
  });
  assert.deepEqual(scripts, ['/js/net/gate.js', '/js/net/gate.js']);
  assert.equal(/var GATED = \/(.+)\/;/.exec(a)[1], GATED.source);
});

test('the shared signing client keeps each document key and gate isolated in memory', async () => {
  const vm = await import('node:vm');
  function page() {
    const events = {}, context = { crypto: crypto.webcrypto, TextEncoder, Uint8Array, btoa: (text) => Buffer.from(text, 'binary').toString('base64'),
      addEventListener: (name, fn) => { events[name] = fn; } };
    context.window = context;
    vm.runInNewContext(fs.readFileSync(new URL('../../js/net/gate.js', import.meta.url), 'utf8'), context);
    return { api: context.OpsPk, events };
  }
  const a = page(), b = page();
  const [ka, kb] = await Promise.all([a.api.publicKey(), b.api.publicKey()]);
  assert.notEqual(ka.x, kb.x);
  a.api.open('gate-a', Date.now() + 60000); b.api.open('gate-b', Date.now() + 60000);
  a.events.pagehide();
  assert.equal(a.api.active(), false); assert.equal(b.api.active(), true);
  assert.equal(await a.api.header('GET', '/api/ops/me'), null);
  assert.match(await b.api.header('GET', '/api/sec/state'), /^gate-b\./);
});
