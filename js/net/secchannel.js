/* The page's side of the secure channel (server/core/seccomm.js), used by the security HOME (/sec/) and by the operator site's lock
   (ops/secure.js); the server's tests use it too.

   open():  makes a key for this one channel (ECDH P-256, kept in the page, never readable), trades only public halves with the server,
            derives the keys (HKDF-SHA256), and CHECKS what the server signed: its identity key (kept the first time, compared every time
            after: a different one is refused), the address it saw (it must be this page's own), whether it saw the connection
            encrypted, that the time agrees, and that it holds the same keys.
   call():  one request through the channel: a number that only goes up, a tag over the method, path, number and sealed body, the
            body sealed (AES-256-GCM); the answer is opened with the other key. A channel the server has ended is opened again by
            itself, once, and the request goes again.
   info():  what the checks found. `secure` is true only if every one of them holds (https, a secure context, not framed by another
            site, an identity that is the one kept, the server's own words that it saw TLS, the same address, a clock that agrees):
            the lock is shown on that, and on nothing less.
   Nothing is stored but the server's identity fingerprint (to compare next time). */
(function (BR) {
  'use strict';

  var subtle = (window.crypto && window.crypto.subtle) || null;
  var enc = new TextEncoder(), dec = new TextDecoder();
  var ECDH = { name: 'ECDH', namedCurve: 'P-256' }, ECDSA = { name: 'ECDSA', namedCurve: 'P-256' };
  var LABEL = 'two-state sec channel v1';
  var SKEW_MS = 120000;

  function b64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function join(a, b) { var o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; }
  // the same as the server's: which way, then the number
  function iv(dir, n) {
    var b = new Uint8Array(12), dv = new DataView(b.buffer);
    dv.setUint32(0, dir); dv.setUint32(4, Math.floor(n / 4294967296)); dv.setUint32(8, n >>> 0);
    return b;
  }
  // "abcd-ef01-…": the same five groups the server shows
  function fingerprint(spki) {
    return subtle.digest('SHA-256', spki).then(function (d) {
      var hex = Array.prototype.map.call(new Uint8Array(d), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
      return hex.slice(0, 20).replace(/(.{4})(?=.)/g, '$1-');
    });
  }
  function canonical(path) {
    var u = new URL(path, 'http://x.invalid'), qs = u.searchParams.toString();
    return u.pathname + (qs ? '?' + qs : '');
  }
  function lacks(code, message) { var e = new Error(message); e.code = code; e.status = 0; e.message = message; return e; }

  // what the page itself knows of where it is (the tests give their own)
  function realEnv() {
    var framed = false;
    try { framed = window.top !== window && window.top.location.origin !== window.location.origin; } catch (e) { framed = true; }
    return { protocol: location.protocol, host: location.host, origin: location.origin, secureContext: !!window.isSecureContext, framed: framed };
  }
  function pinStore(origin) {
    var k = 'two-state-sec/identity/' + origin;
    return {
      get: function () { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
      set: function (v) { try { localStorage.setItem(k, v); } catch (e) { /* kept for this page only */ } }
    };
  }

  // request(method, path, body, headers) → the answer's JSON, or throws { status, code, message } (the page's own, with its login)
  function create(opts) {
    var request = opts.request;
    var env = opts.env || realEnv();
    var pins = opts.pins || pinStore(env.origin);
    var now = opts.now || Date.now;
    var ch = null, opening = null, seq = 0, found = null, listeners = [];

    function changed() { listeners.forEach(function (f) { try { f(found); } catch (e) { /* a listener's own trouble */ } }); }

    function open() {
      if (opening) return opening;
      opening = run().then(function (v) { opening = null; return v; }, function (e) { opening = null; ch = null; found = { secure: false, problems: [e.code || 'failed'], error: e.code || 'failed', at: now() }; changed(); throw e; });
      return opening;
    }
    function run() {
      if (!subtle) return Promise.reject(lacks('no_crypto', 'このブラウザではセキュア通信を使えません'));
      var mine, nonce = crypto.getRandomValues(new Uint8Array(24)), pub = '', nonceText = b64(nonce), reply, keys;
      return subtle.generateKey(ECDH, false, ['deriveBits']).then(function (pair) {
        mine = pair;
        return subtle.exportKey('raw', pair.publicKey);
      }).then(function (raw) {
        pub = b64(raw);
        return request('POST', '/api/sec/channel', { pub: pub, nonce: nonceText });
      }).then(function (r) {
        reply = r;
        return subtle.importKey('raw', unb64(r.spub), ECDH, false, []);
      }).then(function (peer) {
        return subtle.deriveBits({ name: 'ECDH', public: peer }, mine.privateKey, 256);
      }).then(function (bits) {
        return subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
      }).then(function (base) {
        return subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: join(nonce, unb64(reply.snonce)), info: enc.encode(LABEL + '|' + reply.id) }, base, 96 * 8);
      }).then(function (okm) {
        okm = new Uint8Array(okm);
        return Promise.all([
          subtle.importKey('raw', okm.slice(0, 32), 'AES-GCM', false, ['encrypt']),
          subtle.importKey('raw', okm.slice(32, 64), 'AES-GCM', false, ['decrypt']),
          subtle.importKey('raw', okm.slice(64, 96), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
        ]);
      }).then(function (k) {
        keys = k;
        // what the server signed, rebuilt from what this page knows: its own key and nonce, and what the server says it saw
        var transcript = JSON.stringify([LABEL, reply.id, reply.host, reply.origin, reply.uid, pub, reply.spub, nonceText, reply.snonce, reply.issuedAt, reply.expiresAt, reply.tls, reply.http]);
        return Promise.all([
          subtle.importKey('spki', unb64(reply.identity), ECDSA, false, ['verify']).then(function (key) {
            return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(reply.sig), enc.encode(transcript));
          }),
          subtle.verify('HMAC', keys[2], unb64(reply.confirm), enc.encode('server|' + transcript)),
          fingerprint(unb64(reply.identity))
        ]).then(function (res) { return { signed: res[0], confirmed: res[1], fp: res[2], transcript: transcript }; });
      }).then(function (v) {
        if (!v.signed || !v.confirmed) throw lacks('bad_server', 'サーバーの署名を確かめられませんでした。このアドレスは本物でない可能性があります');
        // the identity this page kept the first time, against the one offered now
        var kept = pins.get(), pin = 'same';
        if (!kept) { pins.set(reply.identity); pin = 'new'; }
        else if (kept !== reply.identity) { var e = lacks('identity_changed', 'サーバーの身元が前回と違います。接続を止めました'); e.fp = v.fp; e.offered = reply.identity; throw e; }
        var problems = [], t = now();
        if (env.protocol !== 'https:') problems.push('protocol');
        if (!env.secureContext) problems.push('context');
        if (env.framed) problems.push('framed');
        if (!reply.tls) problems.push('server-tls');
        if (reply.host !== env.host) problems.push('host');
        if (reply.origin !== env.origin) problems.push('origin');
        if (Math.abs(reply.issuedAt - t) > SKEW_MS) problems.push('clock');
        if (opts.uid && reply.uid !== opts.uid) problems.push('person');
        ch = { id: reply.id, seal: keys[0], open: keys[1], mac: keys[2], expiresAt: reply.expiresAt };
        seq = 0;
        found = { secure: problems.length === 0, problems: problems, pin: pin, fp: v.fp, tls: reply.tls, http: reply.http, host: reply.host, origin: reply.origin, uid: reply.uid, skew: t - reply.issuedAt, expiresAt: reply.expiresAt, at: t };
        changed();
        return found;
      });
    }

    function sealed(c, method, path, body, n) {
      var pq = canonical(path), text = '', payload;
      var done = function (cipher) {
        return subtle.sign('HMAC', c.mac, enc.encode(method + '\n' + pq + '\n' + n + '\n' + cipher)).then(function (tag) { return { payload: cipher ? { c: cipher } : undefined, tag: b64(tag) }; });
      };
      if (method === 'GET') return done('');
      return subtle.encrypt({ name: 'AES-GCM', iv: iv(0, n), additionalData: enc.encode(c.id + '|req|' + method + '|' + pq + '|' + n) }, c.seal, enc.encode(JSON.stringify(body || {}))).then(function (buf) { text = b64(buf); return done(text); });
    }
    function call(method, path, body, again) {
      return (ch ? Promise.resolve() : open()).then(function () {
        var c = ch, n = ++seq;
        return sealed(c, method, path, body, n).then(function (s) {
          return request(method, path, s.payload, { 'X-Sec-Channel': c.id, 'X-Sec-Seq': String(n), 'X-Sec-Tag': s.tag }).then(function (r) {
            if (!r || typeof r.c !== 'string' || r.s !== n) throw lacks('channel_bad', 'セキュア通信の答えが正しくありません');
            return subtle.decrypt({ name: 'AES-GCM', iv: iv(1, n), additionalData: enc.encode(c.id + '|res|' + n) }, c.open, unb64(r.c));
          }).then(function (buf) { return JSON.parse(dec.decode(buf)); }, function (err) {
            // the server ended this channel (a restart, a quiet quarter hour), or the passkey gate it was tied to has changed: open another, once
            if (!again && err && (err.code === 'channel_lost' || err.code === 'channel_required' || err.code === 'channel_bad')) { if (ch === c) ch = null; return call(method, path, body, true); }
            throw err;
          });
        });
      });
    }
    return {
      open: open, call: call,
      info: function () { return found; },
      // the server's identity is trusted anew (the developer confirmed it changed on purpose)
      trust: function (spki) { pins.set(spki); },
      onChange: function (f) { listeners.push(f); },
      close: function () {
        var c = ch;
        if (!c) return Promise.resolve();
        return call('POST', '/api/sec/channel/close', {}).catch(function () { /* the server forgets it by itself */ }).then(function () { ch = null; });
      },
      drop: function () { ch = null; found = null; }
    };
  }

  BR.secChannel = { available: !!subtle, create: create, fingerprint: fingerprint, b64: b64, unb64: unb64 };
})(window.BR = window.BR || {});
