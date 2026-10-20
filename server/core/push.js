// Phone notifications (Web Push): a message, a voice call or a 一緒に稼ぐ
// invitation for a player whose game is not open goes to their phone's
// notifications (with its sound and vibration: sw.js shows it). Browsers and
// the installed web app subscribe (js/net/push.js); the server keeps one key
// pair (VAPID, made once and kept in the database), encrypts each message for
// the phone (RFC 8291, aes128gcm) and signs it for the push service (RFC
// 8292). WebCrypto only, so it runs on Node and on Cloudflare alike.

const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

function b64u(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - t.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await subtle().importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle().sign('HMAC', k, data));
}
// HKDF with SHA-256 (at most 32 bytes out)
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);
}

// The payload, encrypted for one subscription (RFC 8291 / RFC 8188).
async function encrypt(sub, payload) {
  const ua = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const mine = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const minePub = new Uint8Array(await subtle().exportKey('raw', mine.publicKey));
  const uaKey = await subtle().importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, mine.privateKey, 256));
  const ikm = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), ua, minePub), 32);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // one record: the text, then the delimiter of the last record
  const data = concat(enc.encode(payload), new Uint8Array([2]));
  const body = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return concat(salt, rs, new Uint8Array([minePub.length]), minePub, body);
}

// q: statements; meta: { get(key), set(key, value) }; contact: who runs the
// server (a mailto: or https: address the push services may use); send: fetch
export function createPush({ q, meta, contact = '', send = (url, init) => fetch(url, init), defer = (p) => p }) {
  let keys = null;   // { publicKey (raw, b64u), privateKey (CryptoKey) }

  async function vapid() {
    if (keys) return keys;
    let stored = null;
    try { stored = JSON.parse(meta.get('push_vapid') || 'null'); } catch { stored = null; }
    if (!stored) {
      const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
      stored = { pub: b64u(await subtle().exportKey('raw', pair.publicKey)), jwk: await subtle().exportKey('jwk', pair.privateKey) };
      meta.set('push_vapid', JSON.stringify(stored));
      // two at once: the first one kept wins
      stored = JSON.parse(meta.get('push_vapid'));
    }
    const privateKey = await subtle().importKey('jwk', stored.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    keys = { publicKey: stored.pub, privateKey };
    return keys;
  }

  // the signed note for the push service of `endpoint` (12 hours)
  async function authHeader(endpoint) {
    const k = await vapid();
    const u = new URL(endpoint);
    const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const sub = contact || meta.get('push_origin') || 'mailto:support@two-state.invalid';
    const body = b64u(enc.encode(JSON.stringify({ aud: `${u.protocol}//${u.host}`, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
    const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, k.privateKey, enc.encode(`${head}.${body}`));
    return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.publicKey}`;
  }

  async function deliver(sub, payload, urgent) {
    const body = await encrypt(sub, payload);
    const res = await send(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await authHeader(sub.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: urgent ? '60' : '86400',
        Urgency: urgent ? 'high' : 'normal'
      },
      body
    });
    // gone (unsubscribed, or the browser data cleared): forgotten
    if (res.status === 404 || res.status === 410) q('DELETE FROM push_subs WHERE endpoint = ?').run(sub.endpoint);
    return res.status;
  }

  // n: { title, body, tag, url, kind: 'msg' | 'call' | 'invite' }
  function notify(userId, n) {
    const subs = q('SELECT * FROM push_subs WHERE user_id = ?').all(userId);
    if (!subs.length) return Promise.resolve(0);
    const payload = JSON.stringify({ ...n, at: Date.now() }).slice(0, 3000);
    const job = Promise.all(subs.map((s) => deliver(s, payload, n.kind === 'call').catch(() => 0)));
    return defer(job) || job;
  }

  return {
    publicKey: async () => (await vapid()).publicKey,
    subscribe(userId, sub, origin) {
      q(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
        .run(sub.endpoint, userId, sub.p256dh, sub.auth, Date.now());
      if (origin && /^https:\/\//.test(origin) && !meta.get('push_origin')) meta.set('push_origin', origin);
    },
    unsubscribe(userId, endpoint) { q('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?').run(endpoint, userId); },
    has: (userId) => !!q('SELECT 1 AS x FROM push_subs WHERE user_id = ? LIMIT 1').get(userId),
    notify,
    // for the tests: the payload a subscription would get
    encrypt
  };
}
