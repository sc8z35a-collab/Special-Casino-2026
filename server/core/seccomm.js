// The secure channel of the security HOME (/sec/) and of the operator site's secure lock: a sealed transport laid over the
// ordinary one (TLS). Everything the base says and hears goes through it; the server turns away what does not.
//
//   - Opening (POST /api/sec/channel): the page and the server each make a key for this one channel (ECDH P-256) and trade only the
//     public halves; both derive the same keys with HKDF-SHA256. The server ties the channel to the person, their login and the
//     passkey gate in force (a request from any other is turned away), so a login token taken from a browser is no use without the
//     keys, and the keys cannot be taken out of the page.
//   - The server proves who it is: it signs what was traded (the page's key, its own, both nonces, the host and the origin it saw,
//     whether and how the connection to it was encrypted, the time) with an identity key of its own (ECDSA P-256, made once, kept
//     sealed in the database). The page keeps the fingerprint the first time and checks it every time after; a proxy that decrypts
//     TLS, or a copy of the site on another address, cannot make that signature, and one that merely relays shows the address it
//     was asked from, which the page compares with its own. Only a page that has checked all of it shows the lock.
//   - Each request after: a number that only goes up (a window of the latest ones: parallel requests may overtake one another, a
//     repeat is refused), a tag over the method, the path, the number and the sealed body, and the body itself sealed (AES-256-GCM,
//     with the channel, method, path and number as what it must match). The answer is sealed with the other key.
//   - The keys live in the server's memory only. A restart, a person logging out, or 15 minutes without a request (6 hours at the
//     most) ends a channel; the page opens another by itself.
// The developer sees every open channel (not its keys) and can end any; an operator sees nothing of the others'.
import crypto from 'node:crypto';
import { ApiError } from './errors.js';
import { sealText, openText, keyFrom } from './auth.js';

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(String(s), 'base64url'));
const LABEL = 'two-state sec channel v1';
const IDLE_MS = 15 * 60000, MAX_MS = 6 * 3600000, PER_USER = 4, TOTAL = 200, WINDOW = 256, AHEAD = 5000, BODY_MAX = 96 * 1024;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };

const iv = (dir, n) => { const b = new Uint8Array(12), dv = new DataView(b.buffer); dv.setUint32(0, dir); dv.setUint32(4, Math.floor(n / 4294967296)); dv.setUint32(8, n >>> 0); return b; };
const join = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
// "abcd-ef01-…": five groups of the identity key's SHA-256, to be read out and compared
const fingerprint = (spki) => crypto.createHash('sha256').update(spki).digest('hex').slice(0, 20).replace(/(.{4})(?=.)/g, '$1-');

// what this host saw of the connection that brought the request: whether it was encrypted and how
export function transportOf(req) {
  const m = req.meta || {}, cf = m.cf || {}, sock = m.socket || {};
  const proxied = /^https$/i.test(String(req.header('x-forwarded-proto') || '').split(',')[0].trim());
  // (the edge's own word for the version; or, on the edge, that the address it was reached at is https; or a proxy that says so)
  const tls = cf.tlsVersion || sock.tls || (m.scheme === 'https:' ? 'https' : '') || (proxied ? 'proxy' : '');
  const http = cf.httpProtocol || (sock.http ? `HTTP/${sock.http}` : '');
  return { tls: String(tls).slice(0, 24), http: String(http).slice(0, 24) };
}

export function createSecComm({ q, secret, opsLog, roleOf, clock = Date.now }) {
  const KEY = keyFrom(secret, 'sec-identity');
  const channels = new Map();
  const denied = new Map();
  let ident = null;

  // the server's identity: made the first time, then read back (its private half sealed with the server's own secret)
  async function identity() {
    if (ident) return ident;
    const row = q('SELECT pub, priv FROM sec_identity WHERE id = 1').get();
    if (row) {
      const raw = openText(KEY, row.priv);
      if (raw) {
        const priv = await subtle().importKey('pkcs8', unb64u(raw), ECDSA, false, ['sign']);
        ident = { spki: row.pub, priv, fp: fingerprint(unb64u(row.pub)), at: row.created_at };
        return ident;
      }
    }
    const pair = await subtle().generateKey(ECDSA, true, ['sign', 'verify']);
    const spki = b64u(await subtle().exportKey('spki', pair.publicKey));
    const pkcs8 = b64u(await subtle().exportKey('pkcs8', pair.privateKey));
    const now = clock();
    q('INSERT INTO sec_identity (id, pub, priv, created_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET pub = excluded.pub, priv = excluded.priv, created_at = excluded.created_at').run(spki, sealText(KEY, pkcs8), now);
    ident = { spki, priv: await subtle().importKey('pkcs8', unb64u(pkcs8), ECDSA, false, ['sign']), fp: fingerprint(unb64u(spki)), at: now };
    return ident;
  }

  // what is refused is written to the log (not more than a line a half minute for the same person and reason)
  function deny(u, req, why, id = '') {
    const k = `${u ? u.id : 0}:${why}`, now = clock();
    if (now - (denied.get(k) || 0) >= 30000) {
      denied.set(k, now);
      if (denied.size > 400) for (const [x, at] of denied) if (now - at > 60000) denied.delete(x);
      try { opsLog.add({ actor: u || null, actorName: u ? undefined : '不明', action: 'sec_channel_denied', req, summary: `${u ? u.name : '不明'}のセキュア通信で、正しくない要求を断りました（${why}）`, detail: { why, channel: String(id).slice(0, 8) } }); } catch { /* the refusal stands without the line */ }
    }
  }
  function sweep(now = clock()) {
    for (const [id, c] of channels) if (c.expiresAt <= now || c.hardExpiry <= now) channels.delete(id);
  }
  const pathOf = (req) => { const qs = req.query ? req.query.toString() : ''; return req.path + (qs ? `?${qs}` : ''); };

  async function open(req, u) {
    const body = await req.json(2048);
    const origin = String(req.header('origin') || '');
    // a page that was loaded from another address than the one it asks: the address of a copy, or of a proxy in front
    if (origin) {
      let oh = '';
      try { oh = new URL(origin).host; } catch { /* below */ }
      if (!oh || (req.host && oh !== req.host)) { deny(u, req, 'address'); throw new ApiError(403, 'bad_origin', 'このページのアドレスが正しくありません。正しいアドレスから開き直してください'); }
    }
    let peer, cNonce;
    try {
      const raw = unb64u(body.pub);
      if (raw.length !== 65 || raw[0] !== 4) throw new Error('shape');
      peer = await subtle().importKey('raw', raw, ECDH, false, []);
      cNonce = unb64u(body.nonce);
      if (cNonce.length < 16 || cNonce.length > 64) throw new Error('nonce');
    } catch { deny(u, req, 'shape'); throw new ApiError(400, 'bad_channel', 'セキュア通信の開始が正しくありません'); }
    const now = clock();
    sweep(now);
    // (the ones this person has, the oldest first: a fifth ends the first)
    const mine = [...channels.values()].filter((c) => c.uid === u.id).sort((a, b) => a.openedAt - b.openedAt);
    while (mine.length >= PER_USER) channels.delete(mine.shift().id);
    if (channels.size >= TOTAL) channels.delete([...channels.values()].sort((a, b) => a.last - b.last)[0].id);

    const id = b64u(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    const mineKey = await subtle().generateKey(ECDH, false, ['deriveBits']);
    const spub = new Uint8Array(await subtle().exportKey('raw', mineKey.publicKey));
    const sNonce = globalThis.crypto.getRandomValues(new Uint8Array(24));
    const bits = await subtle().deriveBits({ name: 'ECDH', public: peer }, mineKey.privateKey, 256);
    const base = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveBits']);
    const tokHash = u.tokenHash || '';
    const gate = String(req.gateId || '');
    const okm = new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: join(cNonce, sNonce), info: enc.encode(`${LABEL}|${id}`) }, base, 96 * 8));
    const kc2s = await subtle().importKey('raw', okm.slice(0, 32), 'AES-GCM', false, ['decrypt']);
    const ks2c = await subtle().importKey('raw', okm.slice(32, 64), 'AES-GCM', false, ['encrypt']);
    const kmac = await subtle().importKey('raw', okm.slice(64, 96), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

    const who = await identity();
    const transport = transportOf(req);
    const issuedAt = now, expiresAt = now + IDLE_MS;
    const host = String(req.host || ''), spubText = b64u(spub);
    // what the server signs: everything the page needs to be sure it is talking to the one it meant to, at the address it meant, now
    const transcript = JSON.stringify([LABEL, id, host, origin, u.id, String(body.pub), spubText, String(body.nonce), b64u(sNonce), issuedAt, expiresAt, transport.tls, transport.http]);
    const sig = b64u(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, who.priv, enc.encode(transcript)));
    const confirm = b64u(await subtle().sign('HMAC', kmac, enc.encode(`server|${transcript}`)));
    channels.set(id, {
      id, uid: u.id, name: u.name, role: roleOf(u), tokHash, gate, kc2s, ks2c, kmac, openedAt: now, last: now, expiresAt, hardExpiry: now + MAX_MS,
      max: 0, floor: 0, seen: new Set(), count: 0, ip: req.ip || '', ua: String(req.header('user-agent') || '').slice(0, 160), tls: transport.tls, http: transport.http
    });
    return { v: 1, id, uid: u.id, spub: spubText, snonce: b64u(sNonce), issuedAt, expiresAt, host, origin, tls: transport.tls, http: transport.http, identity: who.spki, fp: who.fp, sig, confirm };
  }

  // A request that comes through a channel: who it is for, the number, the tag and the body are all as they must be, or it is
  // refused before the route knows of it. Resolves { ch, seq, body } (body: the sealed body, opened, or null for a read).
  async function enter(req, u) {
    const id = String(req.header('x-sec-channel') || ''), seqText = String(req.header('x-sec-seq') || ''), tag = String(req.header('x-sec-tag') || '');
    if (!id || !seqText || !tag) throw new ApiError(403, 'channel_required', 'セキュア通信が確立されていません。ページを読み込み直してください');
    const now = clock();
    const ch = channels.get(id);
    if (!ch || ch.expiresAt <= now || ch.hardExpiry <= now) { channels.delete(id); throw new ApiError(403, 'channel_lost', 'セキュア通信をもう一度つなぎます'); }
    if (ch.uid !== u.id || ch.tokHash !== (u.tokenHash || '') || (ch.gate && ch.gate !== String(req.gateId || ''))) {
      deny(u, req, 'wrong-owner', id);
      throw new ApiError(403, 'channel_bad', 'セキュア通信を確かめられませんでした。ページを読み込み直してください');
    }
    const seq = Number(seqText);
    if (!Number.isSafeInteger(seq) || seq <= 0 || seq > ch.max + AHEAD) { deny(u, req, 'number', id); throw new ApiError(403, 'channel_bad', 'セキュア通信を確かめられませんでした。ページを読み込み直してください'); }
    if (seq <= ch.floor || ch.seen.has(seq)) { deny(u, req, 'repeat', id); throw new ApiError(403, 'channel_replay', '同じ要求がもう一度送られました。ページを読み込み直してください'); }
    let sealed = '';
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await req.json(BODY_MAX);
      sealed = typeof raw.c === 'string' ? raw.c : '';
      if (!sealed) { deny(u, req, 'no-body', id); throw new ApiError(400, 'channel_bad', 'セキュア通信の本文がありません'); }
    }
    const pq = pathOf(req);
    let ok = false;
    try { ok = await subtle().verify('HMAC', ch.kmac, unb64u(tag), enc.encode(`${req.method}\n${pq}\n${seq}\n${sealed}`)); } catch { ok = false; }
    if (!ok) { deny(u, req, 'tag', id); throw new ApiError(403, 'channel_bad', 'セキュア通信を確かめられませんでした。ページを読み込み直してください'); }
    let opened = null;
    if (sealed) {
      try {
        const plain = await subtle().decrypt({ name: 'AES-GCM', iv: iv(0, seq), additionalData: enc.encode(`${ch.id}|req|${req.method}|${pq}|${seq}`) }, ch.kc2s, unb64u(sealed));
        opened = JSON.parse(Buffer.from(plain).toString('utf8'));
        if (!opened || typeof opened !== 'object' || Array.isArray(opened)) throw new Error('shape');
      } catch { deny(u, req, 'seal', id); throw new ApiError(400, 'channel_bad', 'セキュア通信の本文を開けませんでした'); }
    }
    // (only now is the number used up)
    ch.seen.add(seq); ch.max = Math.max(ch.max, seq);
    if (ch.seen.size > WINDOW * 2) { ch.floor = Math.max(ch.floor, ch.max - WINDOW); for (const n of ch.seen) if (n <= ch.floor) ch.seen.delete(n); }
    ch.last = now; ch.count++; ch.expiresAt = Math.min(ch.hardExpiry, now + IDLE_MS);
    return { ch, seq, body: opened };
  }
  async function seal(ctx, obj) {
    const plain = enc.encode(JSON.stringify(obj === undefined ? {} : obj));
    const c = await subtle().encrypt({ name: 'AES-GCM', iv: iv(1, ctx.seq), additionalData: enc.encode(`${ctx.ch.id}|res|${ctx.seq}`) }, ctx.ch.ks2c, plain);
    return { c: b64u(c), s: ctx.seq };
  }

  const covers = (key) => /^(GET|POST) \/api\/sec\//.test(key) && key !== 'POST /api/sec/channel';
  const brief = (c, now = clock()) => ({ id: c.id.slice(0, 8), user: { id: c.uid, name: c.name, role: c.role }, openedAt: c.openedAt, last: c.last, left: Math.max(0, c.expiresAt - now), requests: c.count, ip: c.ip, userAgent: c.ua, tls: c.tls, http: c.http });

  return {
    covers, enter, seal, identity,
    routes: {
      'POST /api/sec/channel': async (req, u) => open(req, u)
    },
    // the developer's view of what is open (never the keys), and ending one
    list: () => { sweep(); return [...channels.values()].sort((a, b) => b.last - a.last).map((c) => brief(c)); },
    close(shortId) {
      let n = 0;
      for (const [id, c] of channels) if (id.slice(0, 8) === String(shortId)) { channels.delete(id); n++; }
      return n;
    },
    closeFor(userId) { let n = 0; for (const [id, c] of channels) if (c.uid === userId) { channels.delete(id); n++; } return n; },
    closeAll() { const n = channels.size; channels.clear(); return n; },
    count: () => { sweep(); return channels.size; }
  };
}
