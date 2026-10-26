// ログイン with Google / Discord (server/core/oauth.js), against a stand-in for the two providers on this machine.
// Run with node --test server/test/oauth.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startServer, newDevice } from './helpers.js';

const GOOGLE_ID = 'google-client-id.apps.test', DISCORD_ID = '1234567890123';
let provider, providerBase, s;
const codes = new Map();            // code -> what the provider will say about it
let tamper = '';                    // 'nonce' | 'aud' | 'sig' for the next Google token

// (the usual relaxed limits of the tests, and the ones of the sign-in: 20 a minute for an address are too few for a test that signs in all the time)
const BIG = [100000, 1000];
const LIMITS = { spin: BIG, shop: BIG, general: BIG, login: BIG, friend: BIG, transfer: BIG, oauth: BIG, oauthPoll: BIG };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

before(async () => {
  provider = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (status, json) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      const form = Object.fromEntries(new URLSearchParams(body));
      if (req.url === '/google/token') {
        const c = codes.get(form.code);
        const ok = c && form.client_id === GOOGLE_ID && form.client_secret === 'google-secret' && form.grant_type === 'authorization_code'
          && crypto.createHash('sha256').update(form.code_verifier || '').digest('base64url') === c.challenge && form.redirect_uri === c.redirect;
        if (!ok) return send(400, { error: 'invalid_grant' });
        codes.delete(form.code);
        const claims = { iss: 'https://accounts.google.com', aud: tamper === 'aud' ? 'someone-else' : GOOGLE_ID, sub: c.sub, exp: Math.floor(Date.now() / 1000) + 3600, nonce: tamper === 'nonce' ? 'other' : c.nonce };
        tamper = '';
        return send(200, { access_token: 'g-access', id_token: `${b64({ alg: 'RS256' })}.${b64(claims)}.sig` });
      }
      if (req.url === '/discord/token') {
        const c = codes.get(form.code);
        const ok = c && form.client_id === DISCORD_ID && form.client_secret === 'discord-secret' && crypto.createHash('sha256').update(form.code_verifier || '').digest('base64url') === c.challenge;
        if (!ok) return send(400, { error: 'invalid_grant' });
        codes.delete(form.code);
        return send(200, { access_token: 'd-' + c.sub, token_type: 'Bearer' });
      }
      if (req.url === '/discord/user') {
        const m = /^Bearer d-(\d+)$/.exec(req.headers.authorization || '');
        return m ? send(200, { id: m[1], username: 'nakano_d', global_name: 'ナカノ' }) : send(401, { message: '401: Unauthorized' });
      }
      send(404, {});
    });
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  providerBase = `http://127.0.0.1:${provider.address().port}`;
  s = await startServer({
    limits: LIMITS,
    googleClientId: GOOGLE_ID, googleClientSecret: 'google-secret', discordClientId: DISCORD_ID, discordClientSecret: 'discord-secret',
    googleAuthUrl: providerBase + '/google/auth', googleTokenUrl: providerBase + '/google/token',
    discordAuthUrl: providerBase + '/discord/auth', discordTokenUrl: providerBase + '/discord/token', discordUserUrl: providerBase + '/discord/user'
  });
});
after(async () => { await s.stop(); provider.close(); });

const dev = (id = newDevice()) => ({ 'X-Device': id });

// what the browser does: go to the provider's page, agree, come back to the game's callback
async function agree(url, sub, { redirect = 'manual', state } = {}) {
  const u = new URL(url);
  const code = crypto.randomBytes(12).toString('hex');
  codes.set(code, { sub, challenge: u.searchParams.get('code_challenge'), nonce: u.searchParams.get('nonce'), redirect: u.searchParams.get('redirect_uri') });
  const back = new URL(u.searchParams.get('redirect_uri'));
  back.searchParams.set('code', code);
  back.searchParams.set('state', state || u.searchParams.get('state'));
  return fetch(back, { redirect });
}
async function begin(providerName, { token, headers = dev(), external = false } = {}) {
  const r = await s.call('POST', token ? '/api/oauth/link-start' : '/api/oauth/start', { token, body: { provider: providerName, external }, headers });
  assert.equal(r.status, 200, JSON.stringify(r));
  return r;
}
const poll = (flow, headers) => s.call('POST', '/api/oauth/poll', { body: { flow }, headers });
// the whole round trip for someone not logged in
async function signIn(providerName, sub, headers = dev()) {
  const { url, flow } = await begin(providerName, { headers });
  const back = await agree(url, sub);
  assert.equal(back.status, 302);
  return { flow, headers, poll: () => poll(flow, headers) };
}

test('a server without client ids offers nothing; with them, both', async () => {
  assert.deepEqual(await s.call('GET', '/api/oauth/providers'), { google: true, discord: true, status: 200 });
  const bare = await startServer({ limits: LIMITS });
  try {
    assert.deepEqual(await bare.call('GET', '/api/oauth/providers'), { google: false, discord: false, status: 200 });
    const r = await bare.call('POST', '/api/oauth/start', { body: { provider: 'google' }, headers: dev() });
    assert.equal(r.status, 400); assert.equal(r.error.code, 'oauth_off');
  } finally { await bare.stop(); }
});

test('the provider\'s address carries the state, a PKCE challenge and (Google) a nonce, and asks for as little as possible', async () => {
  const g = new URL((await begin('google')).url);
  assert.equal(g.origin + g.pathname, providerBase + '/google/auth');
  assert.equal(g.searchParams.get('client_id'), GOOGLE_ID);
  assert.equal(g.searchParams.get('scope'), 'openid');
  assert.equal(g.searchParams.get('code_challenge_method'), 'S256');
  assert.match(g.searchParams.get('state'), /^[\w-]{40,}$/);
  assert.ok(g.searchParams.get('nonce'));
  assert.equal(g.searchParams.get('redirect_uri'), new URL('/api/oauth/callback', s.base).href);
  const d = new URL((await begin('discord')).url);
  assert.equal(d.searchParams.get('scope'), 'identify');
  assert.equal(d.searchParams.get('code_challenge_method'), 'S256');
});

test('a new player signs up with Google: name and icon, no password, a 引き継ぎコード; the same Google account logs in later, from another device too', async () => {
  const device = newDevice();
  const a = await signIn('google', 'g-sub-1', dev(device));
  const wait = await a.poll();
  assert.equal(wait.step, 'signup'); assert.equal(wait.provider, 'google');
  // the same checks as any sign-up: a name that is taken, then a free one
  await s.register('すでにある名前');
  const taken = await s.call('POST', '/api/oauth/register', { body: { flow: a.flow, name: 'すでにある名前', avatar: 'traveler-green' }, headers: a.headers });
  assert.equal(taken.status, 409); assert.equal(taken.error.code, 'name_taken');
  const made = await s.call('POST', '/api/oauth/register', { body: { flow: a.flow, name: 'グーグルさん', avatar: 'traveler-green' }, headers: a.headers });
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.ok(made.token); assert.match(made.recoveryCode, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
  assert.equal(made.me.name, 'グーグルさん'); assert.equal(made.me.hasPassword, false);
  // the flow is used up
  assert.equal((await poll(a.flow, a.headers)).status, 404);
  // another phone: the same Google account logs in to that account
  const b = await signIn('google', 'g-sub-1');
  const back = await b.poll();
  assert.equal(back.step, 'login'); assert.equal(back.me.name, 'グーグルさん'); assert.ok(back.token);
  const me = await s.call('GET', '/api/me', { token: back.token });
  assert.equal(me.status, 200);
  // and the recovery code still works
  assert.equal((await s.call('POST', '/api/login', { body: { code: made.recoveryCode } })).status, 200);
});

test('the one account a device keeps: a Discord sign-up on a device that is full is refused, and a password sign-up after an OAuth one too', async () => {
  const strict = await startServer({
    limits: LIMITS, accountsPerDevice: 1, googleClientId: GOOGLE_ID, googleClientSecret: 'google-secret', discordClientId: DISCORD_ID, discordClientSecret: 'discord-secret',
    googleAuthUrl: providerBase + '/google/auth', googleTokenUrl: providerBase + '/google/token',
    discordAuthUrl: providerBase + '/discord/auth', discordTokenUrl: providerBase + '/discord/token', discordUserUrl: providerBase + '/discord/user'
  });
  const bak = s; s = strict;
  try {
    const device = newDevice();
    const one = await signIn('discord', '555000111222', dev(device));
    assert.equal((await one.poll()).step, 'signup');
    const made = await strict.call('POST', '/api/oauth/register', { body: { flow: one.flow, name: 'ディスコさん', avatar: 'traveler-green' }, headers: dev(device) });
    assert.equal(made.status, 200, JSON.stringify(made));
    // a second identity on the same device
    const two = await signIn('google', 'g-other', dev(device));
    assert.equal((await two.poll()).step, 'signup');
    const refused = await strict.call('POST', '/api/oauth/register', { body: { flow: two.flow, name: 'ふたつめ', avatar: 'traveler-green' }, headers: dev(device) });
    assert.equal(refused.status, 403); assert.equal(refused.error.code, 'device_limit');
    // nor with a name and a password
    const pw = await strict.call('POST', '/api/register', { body: { name: 'みっつめ', password: 'pass1234', avatar: 'traveler-green' }, headers: dev(device) });
    assert.equal(pw.status, 403); assert.equal(pw.error.code, 'device_limit');
    // a new device is fine
    const other = await signIn('google', 'g-other', dev());
    assert.equal((await other.poll()).step, 'signup');
    const ok = await strict.call('POST', '/api/oauth/register', { body: { flow: other.flow, name: 'べつの端末', avatar: 'traveler-green' }, headers: other.headers });
    assert.equal(ok.status, 200, JSON.stringify(ok));
    // the other way round: a password account fills the device, then Discord is refused
    const d2 = newDevice();
    await strict.register('パスワードさん', { device: d2 });
    const late = await signIn('discord', '555000111999', dev(d2));
    assert.equal((await late.poll()).step, 'signup');
    const no = await strict.call('POST', '/api/oauth/register', { body: { flow: late.flow, name: 'おくれて', avatar: 'traveler-green' }, headers: dev(d2) });
    assert.equal(no.status, 403); assert.equal(no.error.code, 'device_limit');
  } finally { s = bak; await strict.stop(); }
});

test('a player links Discord from the profile, logs in with it, and can leave it again; one Discord account belongs to one player', async () => {
  const p = await s.register('れんけいさん');
  assert.deepEqual((await s.call('GET', '/api/oauth/links', { token: p.token })).links, []);
  const { url, flow } = await begin('discord', { token: p.token });
  assert.equal((await agree(url, '777000111222')).status, 302);
  const ready = await poll(flow, dev());
  assert.equal(ready.status, 403, 'another device cannot finish it'); assert.equal(ready.error.code, 'oauth_device');
  assert.equal((await s.call('POST', '/api/oauth/link', { token: p.token, body: { flow }, headers: dev() })).status, 403);
  // (the page that began it: the device it sent)
  const device = newDevice();
  const mine = await begin('discord', { token: p.token, headers: dev(device) });
  await agree(mine.url, '777000111222');
  assert.equal((await poll(mine.flow, dev(device))).step, 'ready');
  const linked = await s.call('POST', '/api/oauth/link', { token: p.token, body: { flow: mine.flow }, headers: dev(device) });
  assert.equal(linked.status, 200, JSON.stringify(linked)); assert.equal(linked.label, 'ナカノ');
  const links = await s.call('GET', '/api/oauth/links', { token: p.token });
  assert.deepEqual(links.links.map((l) => [l.provider, l.label]), [['discord', 'ナカノ']]);
  // the same Discord account on another player: refused
  const q2 = await s.register('べつのひと');
  const dev2 = newDevice();
  const theirs = await begin('discord', { token: q2.token, headers: dev(dev2) });
  await agree(theirs.url, '777000111222');
  const clash = await s.call('POST', '/api/oauth/link', { token: q2.token, body: { flow: theirs.flow }, headers: dev(dev2) });
  assert.equal(clash.status, 409); assert.equal(clash.error.code, 'oauth_taken');
  // and one more Discord on the same player
  const again = await s.call('POST', '/api/oauth/link-start', { token: p.token, body: { provider: 'discord' }, headers: dev(device) });
  assert.equal(again.status, 409); assert.equal(again.error.code, 'oauth_have');
  // logging in with it
  const login = await signIn('discord', '777000111222');
  const r = await login.poll();
  assert.equal(r.step, 'login'); assert.equal(r.me.name, 'れんけいさん');
  // leaving it: the Discord account is a stranger again
  assert.equal((await s.call('POST', '/api/oauth/unlink', { token: p.token, body: { provider: 'discord' } })).status, 200);
  assert.deepEqual((await s.call('GET', '/api/oauth/links', { token: p.token })).links, []);
  const after = await signIn('discord', '777000111222');
  assert.equal((await after.poll()).step, 'signup');
});

test('a flow belongs to its own device and its own player, and is used once', async () => {
  const device = newDevice();
  const { url, flow } = await begin('google', { headers: dev(device) });
  const state = new URL(url).searchParams.get('state');
  // a state that was never given out, or the same one twice
  assert.equal((await fetch(new URL('/api/oauth/callback?code=abc&state=' + 'x'.repeat(43), s.base))).status, 200);
  assert.equal((await agree(url, 'g-sub-once')).status, 302);
  const second = await agree(url, 'g-sub-other', { redirect: 'follow' });
  assert.match(await second.text(), /すでに終わったか時間切れ/);
  // the poll: only from the device, and only with the secret
  assert.equal((await poll(flow, dev())).status, 403);
  assert.equal((await poll(flow, {})).status, 400);
  assert.equal((await poll('z'.repeat(43), dev(device))).status, 404);
  assert.equal((await s.call('POST', '/api/oauth/register', { body: { flow, name: 'ろぐいん', avatar: 'traveler-green' }, headers: dev(device) })).status, 409);
  assert.equal((await poll(flow, dev(device))).step, 'signup');
  // (the flow did not carry the first identity over to the second answer)
  const made = await s.call('POST', '/api/oauth/register', { body: { flow, name: 'いちどだけ', avatar: 'traveler-green' }, headers: dev(device) });
  assert.equal(made.status, 200, JSON.stringify(made));
  const back = await signIn('google', 'g-sub-once');
  assert.equal((await back.poll()).me.name, 'いちどだけ');
  void state;
  // a flow that ran out
  const old = await begin('google', { headers: dev(device) });
  s.app.db.prepare('UPDATE oauth_flows SET expires_at = ? WHERE id = ?').run(Date.now() - 1, crypto.createHash('sha256').update(old.flow).digest('hex'));
  assert.equal((await poll(old.flow, dev(device))).status, 404);
  // a link flow cannot make a new player, and a login flow cannot link
  const p = await s.register('かぎのひと');
  const dv = newDevice();
  const lk = await begin('google', { token: p.token, headers: dev(dv) });
  await agree(lk.url, 'g-sub-link');
  assert.equal((await s.call('POST', '/api/oauth/register', { body: { flow: lk.flow, name: 'なれない', avatar: 'traveler-green' }, headers: dev(dv) })).status, 409);
  const other = await s.register('よそのひと');
  assert.equal((await s.call('POST', '/api/oauth/link', { token: other.token, body: { flow: lk.flow }, headers: dev(dv) })).status, 403);
});

test('an answer that is not what the provider promised is refused: another audience, another nonce, a code that was never given', async () => {
  for (const bad of ['aud', 'nonce']) {
    const device = newDevice();
    const { url, flow } = await begin('google', { headers: dev(device) });
    tamper = bad;
    await agree(url, 'g-sub-' + bad);
    const r = await poll(flow, dev(device));
    assert.equal(r.step, 'failed'); assert.ok(r.message, bad); assert.equal(r.token, undefined);
  }
  const device = newDevice();
  const { url, flow } = await begin('discord', { headers: dev(device) });
  const u = new URL(url);
  const back = new URL(u.searchParams.get('redirect_uri'));
  back.searchParams.set('code', 'never-given'); back.searchParams.set('state', u.searchParams.get('state'));
  await fetch(back, { redirect: 'manual' });
  assert.equal((await poll(flow, dev(device))).step, 'failed');
  // the player said no at the provider
  const no = await begin('google', { headers: dev(device) });
  const nu = new URL(no.url);
  const nb = new URL(nu.searchParams.get('redirect_uri'));
  nb.searchParams.set('error', 'access_denied'); nb.searchParams.set('state', nu.searchParams.get('state'));
  await fetch(nb, { redirect: 'manual' });
  assert.match((await poll(no.flow, dev(device))).message, /キャンセル/);
});

test('from the app\'s browser the end of the round trip is a page that says to go back, not a redirect', async () => {
  const device = newDevice();
  const { url, flow } = await begin('google', { headers: dev(device), external: true });
  const back = await agree(url, 'g-sub-ext');
  assert.equal(back.status, 200);
  assert.match(back.headers.get('content-type'), /text\/html/);
  const html = await back.text();
  assert.match(html, /ゲームに戻って/);
  assert.ok(!html.includes('<script') && !html.includes(new URL(url).searchParams.get('state')));
  assert.equal((await poll(flow, dev(device))).step, 'signup');
});

test('a banned player who signs in with Google gets the locked title screen, as with a password; a deleted one is turned away', async () => {
  const p = await s.register('ばんされた');
  const device = newDevice();
  const link = await begin('google', { token: p.token, headers: dev(device) });
  await agree(link.url, 'g-sub-banned');
  assert.equal((await s.call('POST', '/api/oauth/link', { token: p.token, body: { flow: link.flow }, headers: dev(device) })).status, 200);
  s.setUser(p.me.id, { banned: 1, ban_kind: 'perma', ban_at: Date.now(), ban_until: 0 });
  const a = await signIn('google', 'g-sub-banned');
  const r = await a.poll();
  assert.equal(r.step, 'login'); assert.ok(r.ban && r.token); assert.equal(r.me, undefined);
  const gone = await s.register('けされた');
  const d2 = newDevice();
  const l2 = await begin('discord', { token: gone.token, headers: dev(d2) });
  await agree(l2.url, '888000111222');
  assert.equal((await s.call('POST', '/api/oauth/link', { token: gone.token, body: { flow: l2.flow }, headers: dev(d2) })).status, 200);
  s.setUser(gone.me.id, { banned: 1, ban_kind: 'deleted', ban_at: Date.now(), ban_until: 0 });
  const b = await signIn('discord', '888000111222');
  const rb = await b.poll();
  assert.equal(rb.status, 403); assert.equal(rb.error.code, 'deleted');
});

test('closed registration also closes the sign-up with Google; nothing of the provider but its own id is kept', async () => {
  const device = newDevice();
  const a = await signIn('google', 'g-sub-kept', dev(device));
  assert.equal((await a.poll()).step, 'signup');
  const made = await s.call('POST', '/api/oauth/register', { body: { flow: a.flow, name: 'きおく', avatar: 'traveler-green' }, headers: dev(device) });
  assert.equal(made.status, 200);
  const rows = s.app.db.prepare('SELECT * FROM oauth_identities').all();
  const row = rows.find((r) => r.subject === 'g-sub-kept');
  assert.deepEqual(Object.keys(row).sort(), ['label', 'linked_at', 'provider', 'subject', 'user_id']);
  assert.equal(row.label, '');
  const flows = s.app.db.prepare('SELECT * FROM oauth_flows WHERE id = ?').all(crypto.createHash('sha256').update(a.flow).digest('hex'));
  assert.equal(flows.length, 0, 'the flow is gone once used');
  const closed = await startServer({ limits: LIMITS, registration: 'closed', googleClientId: GOOGLE_ID, googleClientSecret: 'x' });
  try {
    const r = await closed.call('POST', '/api/oauth/register', { body: { flow: 'f'.repeat(43), name: 'だめ', avatar: 'traveler-green' }, headers: dev() });
    assert.equal(r.status, 403); assert.equal(r.error.code, 'closed');
  } finally { await closed.stop(); }
});
