// ログイン with Google / Discord: a new player can sign up with one of them, and a player who is already in can link one to their account from
// the profile (then log in with it). Authorization code + PKCE + state (+ a nonce for Google's id token); the only thing kept of a provider is
// the identity's own stable id (Google's `sub`, Discord's user id) and, to tell the two apart on the profile, Discord's public user name. No
// e-mail address is asked for, none is kept, and the provider's tokens are used once and thrown away.
//
// How a sign-in runs (it works the same in a browser tab and in the app, where Google refuses to run in the app's own web view, so the app
// hands the address to the phone's browser: js/ui/oauth.js):
//   1. POST /api/oauth/start (or /link-start when logged in) -> { url, flow }. The page keeps `flow` (a secret; only its hash is stored here)
//      and goes to `url`, the provider's own page.
//   2. The provider sends the browser to GET /api/oauth/callback?code&state. The state ties it to the flow (single use, 15 minutes); the code
//      is exchanged here for the identity; the flow becomes `done`. The browser is sent back to the game (or, from the app's browser, shown
//      "go back to the app"). Nothing a page could use is in that address.
//   3. The page that holds `flow` asks POST /api/oauth/poll (from the same device: X-Device): wait / failed / the account's login / a new
//      player (then POST /api/oauth/register with the name and icon: the same checks as any sign-up, a device makes
//      `accountsPerDevice` accounts at most) / ready to link (then POST /api/oauth/link while logged in).
// An identity belongs to one account, an account has one identity per provider, and an account can leave a provider again (it keeps its
// 引き継ぎコード, so it is never locked out).
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';
import { newToken, sha256, cleanName } from './auth.js';
import { Raw } from './raw.js';

const FLOW_MS = 15 * 60 * 1000;
const PER_ADDRESS = 40;           // flows under way from one address
export const PROVIDERS = {
  google: { name: 'Google' },
  discord: { name: 'Discord' }
};
const NAMES = Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, v.name]));
const plain = (t, n) => Array.from(String(t || '')).filter((c) => c >= ' ' && c !== '\u007f').slice(0, n).join('').trim();
const escapeHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createOauth({
  q, tx, config, getUser, createSession, meDto, opsLog, rate, limit, deviceOf, seenOn, liftExpired, banState, signUp, deleted,
  fetcher = (...a) => globalThis.fetch(...a), clock = Date.now
}) {
  const creds = {
    google: { id: config.googleClientId, secret: config.googleClientSecret },
    discord: { id: config.discordClientId, secret: config.discordClientSecret }
  };
  const on = (p) => !!(creds[p] && creds[p].id && creds[p].secret);
  const enabled = () => Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, on(p)]));

  // the address the provider sends the browser back to (it must be one of those entered in the provider's console)
  function baseOf(req) {
    if (config.publicUrl) return config.publicUrl;
    const host = String(req.host || '');
    return (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http://' : 'https://') + host;
  }
  const redirectUri = (req) => baseOf(req) + '/api/oauth/callback';

  const flowOf = (secret) => (typeof secret === 'string' && /^[\w-]{20,100}$/.test(secret)
    ? q('SELECT * FROM oauth_flows WHERE id = ?').get(sha256(secret)) : null);
  const gone = () => new ApiError(404, 'oauth_gone', 'ログインの手続きが見つからないか、時間切れです。もう一度はじめからお試しください');
  const dead = (f, now) => !f || f.expires_at < now;
  // only the page of the device that began it may go on with it
  function sameDevice(req, f) {
    const dev = deviceOf(req);
    if (!dev.id) throw new ApiError(400, 'update', 'アプリを最新にしてからもう一度お試しください');
    if (dev.id !== f.device) throw new ApiError(403, 'oauth_device', 'このログインは、はじめた端末でしか終えられません。もう一度はじめからお試しください');
  }
  const drop = (f) => q('DELETE FROM oauth_flows WHERE id = ?').run(f.id);

  function authorizeUrl(req, provider, f, state, challenge) {
    const c = creds[provider];
    const p = new URLSearchParams({
      client_id: c.id, redirect_uri: redirectUri(req), response_type: 'code', state,
      code_challenge: challenge, code_challenge_method: 'S256'
    });
    if (provider === 'google') {
      p.set('scope', 'openid');
      p.set('nonce', f.nonce);
      p.set('prompt', 'select_account');
      p.set('hl', 'ja');
      return `${config.googleAuthUrl}?${p}`;
    }
    p.set('scope', 'identify');
    return `${config.discordAuthUrl}?${p}`;
  }

  // the identity of whoever just agreed at the provider
  async function ask(url, init) {
    let res;
    try { res = await fetcher(url, { ...init, signal: AbortSignal.timeout(10000) }); } catch { throw new Error('provider unreachable'); }
    let json = {};
    try { json = await res.json(); } catch { /* an error page */ }
    if (!res.ok) throw new Error(`provider answered ${res.status}`);
    return json;
  }
  const form = (o) => ({
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(o).toString()
  });
  async function identify(req, f, code) {
    const c = creds[f.provider];
    const body = { code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri(req), grant_type: 'authorization_code', code_verifier: f.verifier };
    if (f.provider === 'google') {
      const t = await ask(config.googleTokenUrl, form(body));
      // (straight from Google's token address over TLS, so the token's own signature need not be checked: OpenID Connect Core 3.1.3.7)
      const parts = String(t.id_token || '').split('.');
      if (parts.length !== 3) throw new Error('no id token');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const aud = [].concat(claims.aud || []);
      if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss)) throw new Error('wrong issuer');
      if (!aud.includes(c.id)) throw new Error('wrong audience');
      if (!(Number(claims.exp) * 1000 > clock() - 60000)) throw new Error('expired');
      if (!f.nonce || claims.nonce !== f.nonce) throw new Error('wrong nonce');
      if (typeof claims.sub !== 'string' || !/^[\w.-]{1,64}$/.test(claims.sub)) throw new Error('no subject');
      return { subject: claims.sub, label: '' };
    }
    const t = await ask(config.discordTokenUrl, form(body));
    if (!t.access_token || String(t.token_type || '').toLowerCase() !== 'bearer') throw new Error('no access token');
    const me = await ask(config.discordUserUrl, { headers: { Authorization: `Bearer ${t.access_token}`, Accept: 'application/json' } });
    if (typeof me.id !== 'string' || !/^\d{5,25}$/.test(me.id)) throw new Error('no user id');
    return { subject: me.id, label: plain(me.global_name || me.username, 32) };
  }

  // what the browser sees at the end of the provider's round trip
  function page(req, f, message) {
    const base = baseOf(req);
    if (f && f.mode === 'same') return new Raw('', { status: 302, type: 'text/plain; charset=utf-8', headers: { Location: `${base}/?oauth=1`, 'Referrer-Policy': 'no-referrer' } });
    const text = message || 'ログインの手続きが終わりました。このページを閉じて、ゲームに戻ってください。';
    return new Raw(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
      + `<meta name="robots" content="noindex"><title>Two state Casino RP</title></head><body><h1>Two state Casino RP</h1><p>${escapeHtml(text)}</p></body></html>`,
    { type: 'text/html; charset=utf-8', headers: { 'Referrer-Policy': 'no-referrer' } });
  }

  const routes = {
    // which of them this server offers (the buttons show only those)
    'GET /api/oauth/providers': (req) => {
      rate(limit.nameCheck, req.ip);
      return enabled();
    },

    // the page of someone not logged in, or (`link`) of a player who is
    'POST /api/oauth/start': (req) => begin(req, null),
    'POST /api/oauth/link-start': (req, u) => begin(req, u),

    // the provider's answer: the identity is read here and kept with the flow (the address carries nothing the page could use)
    'GET /api/oauth/callback': async (req) => {
      const now = clock();
      let f = null;
      try {
        rate(limit.oauth, req.ip, '操作が多すぎます。少し待ってからお試しください');
        const state = String(req.query.get('state') || '');
        f = /^[\w-]{20,100}$/.test(state) ? q('SELECT * FROM oauth_flows WHERE state_hash = ?').get(sha256(state)) : null;
        // (once: a second answer with the same state finds the flow taken)
        if (dead(f, now) || !Number(q("UPDATE oauth_flows SET status = 'busy' WHERE id = ? AND status = 'wait'").run(f.id).changes)) {
          return page(req, null, 'このログインの手続きは、すでに終わったか時間切れです。ゲームに戻って、もう一度お試しください。');
        }
        const code = String(req.query.get('code') || '');
        if (req.query.get('error') || !code || code.length > 2048) {
          q("UPDATE oauth_flows SET status = 'failed', error = ? WHERE id = ?").run('ログインがキャンセルされました', f.id);
          return page(req, f, 'ログインがキャンセルされました。ゲームに戻って、もう一度お試しください。');
        }
        let who;
        try { who = await identify(req, f, code); } catch (e) {
          q("UPDATE oauth_flows SET status = 'failed', error = ? WHERE id = ?").run(`${NAMES[f.provider]}のログインを確かめられませんでした。もう一度お試しください`, f.id);
          return page(req, f, `${NAMES[f.provider]}のログインを確かめられませんでした。ゲームに戻って、もう一度お試しください。`);
        }
        q("UPDATE oauth_flows SET status = 'done', subject = ?, label = ? WHERE id = ?").run(who.subject, who.label, f.id);
        return page(req, f);
      } catch (e) {
        if (f) q("UPDATE oauth_flows SET status = 'failed', error = ? WHERE id = ? AND status != 'done'").run('ログインを終えられませんでした。もう一度お試しください', f.id);
        return page(req, f, e instanceof ApiError ? e.message : 'ログインを終えられませんでした。ゲームに戻って、もう一度お試しください。');
      }
    },

    // the page that began it asks how it went (from the same device)
    'POST /api/oauth/poll': async (req) => {
      rate(limit.oauthPoll, req.ip, '確認が多すぎます。少し待ってください');
      const body = await req.json();
      const f = flowOf(body.flow);
      const now = clock();
      if (dead(f, now)) { if (f) drop(f); throw gone(); }
      sameDevice(req, f);
      if (f.status === 'wait' || f.status === 'busy') return { step: 'wait' };
      if (f.status === 'failed') { drop(f); return { step: 'failed', message: f.error || 'ログインできませんでした' }; }
      // done: a player linking one more way in is ready to link; the rest log in, or are new
      if (f.purpose === 'link') return { step: 'ready', purpose: 'link', provider: f.provider, label: f.label };
      let idn = q('SELECT * FROM oauth_identities WHERE provider = ? AND subject = ?').get(f.provider, f.subject);
      let u = idn ? getUser(idn.user_id) : null;
      if (idn && !u) { q('DELETE FROM oauth_identities WHERE provider = ? AND subject = ?').run(f.provider, f.subject); idn = null; }
      if (!u) {
        q("UPDATE oauth_flows SET status = 'signup' WHERE id = ?").run(f.id);
        return { step: 'signup', provider: f.provider, label: f.label };
      }
      // a deleted account never comes back; a banned one (or one on a device with a ban) is logged in to the locked title screen only
      if (u.ban_kind === 'deleted') { drop(f); throw new ApiError(403, 'deleted', deleted); }
      u = liftExpired(u);
      const ban = banState(u);
      drop(f);
      opsLog.add({ actor: u, action: 'player_login', req, summary: `${u.name}さんがログイン（${NAMES[f.provider]}${ban ? '・処分中' : ''}）`, detail: { by: f.provider, ban: ban ? ban.code : '' } });
      if (ban) return { step: 'login', token: createSession(u.id), ban };
      seenOn(u.id, req);
      return { step: 'login', token: createSession(u.id), me: meDto(u) };
    },

    // a new player: the same checks as any sign-up (a device makes `accountsPerDevice` accounts at most), the identity theirs from the first moment
    'POST /api/oauth/register': async (req) => {
      if (config.registration !== 'open') throw new ApiError(403, 'closed', '現在、新規登録は受け付けていません');
      rate(limit.register, req.ip, '登録の試行が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      const f = flowOf(body.flow);
      if (dead(f, clock())) { if (f) drop(f); throw gone(); }
      sameDevice(req, f);
      if (f.purpose !== 'login' || f.status !== 'signup') throw new ApiError(409, 'oauth_state', 'このログインでは新しく登録できません。もう一度はじめからお試しください');
      const { name, key } = cleanName(body.name);
      const r = await signUp(req, {
        name, key, avatar: body.avatar, how: NAMES[f.provider],
        inside: (id) => {
          try {
            q('INSERT INTO oauth_identities (provider, subject, user_id, label, linked_at) VALUES (?, ?, ?, ?, ?)').run(f.provider, f.subject, id, f.label, clock());
          } catch (e) {
            if (/UNIQUE|PRIMARY/i.test(String(e && e.message))) throw new ApiError(409, 'oauth_taken', `この${NAMES[f.provider]}アカウントは、すでに別のプレイヤーに使われています`);
            throw e;
          }
          drop(f);
        }
      });
      return r;
    },

    // a player logged in adds one (the flow was begun by them, from this device)
    'POST /api/oauth/link': async (req, u) => {
      rate(limit.oauth, u.id, '操作が多すぎます。少し待ってからお試しください');
      const body = await req.json();
      const f = flowOf(body.flow);
      if (dead(f, clock())) { if (f) drop(f); throw gone(); }
      sameDevice(req, f);
      if (f.purpose !== 'link' || f.user_id !== u.id) throw new ApiError(403, 'oauth_state', 'このログインは、ほかのアカウントのものです');
      if (f.status !== 'done') throw new ApiError(409, 'oauth_wait', 'ログインがまだ終わっていません');
      const have = q('SELECT user_id FROM oauth_identities WHERE provider = ? AND subject = ?').get(f.provider, f.subject);
      if (have && have.user_id !== u.id) {
        drop(f);
        throw new ApiError(409, 'oauth_taken', `この${NAMES[f.provider]}アカウントは、すでに別のプレイヤーに連携されています`);
      }
      if (!have) {
        try {
          tx(() => {
            q('INSERT INTO oauth_identities (provider, subject, user_id, label, linked_at) VALUES (?, ?, ?, ?, ?)').run(f.provider, f.subject, u.id, f.label, clock());
            drop(f);
          });
        } catch (e) {
          if (/UNIQUE|PRIMARY/i.test(String(e && e.message))) throw new ApiError(409, 'oauth_have', `このアカウントには、すでに別の${NAMES[f.provider]}アカウントが連携されています。先に連携を解除してください`);
          throw e;
        }
        opsLog.add({ actor: u, action: 'player_oauth_link', req, summary: `${u.name}さんが${NAMES[f.provider]}を連携`, detail: { provider: f.provider } });
      } else drop(f);
      return { provider: f.provider, label: f.label };
    },

    'POST /api/oauth/unlink': async (req, u) => {
      rate(limit.oauth, u.id, '操作が多すぎます。少し待ってからお試しください');
      const body = await req.json();
      const p = String(body.provider || '');
      if (!Object.hasOwn(PROVIDERS, p)) throw new ApiError(400, 'bad_provider', '連携を解除する先を選んでください');
      const r = q('DELETE FROM oauth_identities WHERE provider = ? AND user_id = ?').run(p, u.id);
      if (Number(r.changes)) opsLog.add({ actor: u, action: 'player_oauth_unlink', req, summary: `${u.name}さんが${NAMES[p]}の連携を解除`, detail: { provider: p } });
      return { ok: true };
    },

    // the profile: which ones are linked, and which this server offers
    'GET /api/oauth/links': (req, u) => ({
      providers: enabled(),
      links: q('SELECT provider, label, linked_at FROM oauth_identities WHERE user_id = ? ORDER BY provider').all(u.id)
        .map((r) => ({ provider: r.provider, label: r.label, linkedAt: r.linked_at }))
    })
  };

  function begin(req, u) {
    rate(limit.oauth, req.ip, '操作が多すぎます。少し待ってからお試しください');
    return req.json().then((body) => {
      const provider = String(body.provider || '');
      if (!Object.hasOwn(PROVIDERS, provider) || !on(provider)) throw new ApiError(400, 'oauth_off', 'この方法でのログインは、いまは使えません');
      const dev = deviceOf(req);
      if (!dev.id) throw new ApiError(400, 'update', 'アプリを最新にしてからもう一度お試しください');
      if (u && q('SELECT 1 AS x FROM oauth_identities WHERE user_id = ? AND provider = ?').get(u.id, provider)) {
        throw new ApiError(409, 'oauth_have', `すでに${NAMES[provider]}を連携しています。先に連携を解除してください`);
      }
      const now = clock();
      q('DELETE FROM oauth_flows WHERE expires_at < ?').run(now);
      if (q('SELECT COUNT(*) AS n FROM oauth_flows WHERE ip = ?').get(req.ip).n >= PER_ADDRESS) throw new ApiError(429, 'rate_limited', '操作が多すぎます。少し待ってからお試しください');
      const secret = newToken(), state = newToken();
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const f = { nonce: crypto.randomBytes(16).toString('base64url') };
      q(`INSERT INTO oauth_flows (id, state_hash, provider, purpose, user_id, verifier, nonce, device, ip, mode, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sha256(secret), sha256(state), provider, u ? 'link' : 'login', u ? u.id : 0, verifier, f.nonce, dev.id, req.ip, body.external === true ? 'external' : 'same', now, now + FLOW_MS);
      return { url: authorizeUrl(req, provider, f, state, challenge), flow: secret, expiresIn: FLOW_MS / 1000 };
    });
  }

  return { routes, enabled, public: ['GET /api/oauth/providers', 'POST /api/oauth/start', 'GET /api/oauth/callback', 'POST /api/oauth/poll', 'POST /api/oauth/register'] };
}
