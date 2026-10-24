/* The seal on the operators' screen view (server/core/opswatch.js). The
   player's game and the operator's page each make a fresh ECDH P-256 key for
   one watch and swap only the public halves through the server; both then
   derive the same AES-256-GCM key with HKDF-SHA256 (bound to the watch's id
   and to both public keys). A frame is sealed with a counter that only goes
   up (its IV is the key generation and the counter, so none repeats) and with
   the watch id, generation and counter as authenticated data, so a frame
   cannot be replayed, reordered into another watch or altered. The server
   only ever carries the sealed bytes.
   Used by js/net/watchfeed.js (the player's game) and ops/ops.js (the
   operator's page); the server's tests use it too. */
(function (BR) {
  'use strict';

  var subtle = (window.crypto && window.crypto.subtle) || null;
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var CURVE = { name: 'ECDH', namedCurve: 'P-256' };
  var LABEL = 'two-state watch v1';

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

  // a new pair for one watch: { pair, pub } (pub: the public half, base64url, 65 bytes raw)
  function newPair() {
    return subtle.generateKey(CURVE, false, ['deriveBits']).then(function (pair) {
      return subtle.exportKey('raw', pair.publicKey).then(function (raw) { return { pair: pair, pub: b64(raw) }; });
    });
  }

  // the AES key both sides arrive at: ours (a pair from newPair), the other's public half, the watch id
  function deriveKey(mine, theirPub, operatorPub, playerPub, sid) {
    return subtle.importKey('raw', unb64(theirPub), CURVE, false, []).then(function (peer) {
      return subtle.deriveBits({ name: 'ECDH', public: peer }, mine.pair.privateKey, 256);
    }).then(function (bits) {
      return subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    }).then(function (base) {
      return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(sid), info: enc.encode(LABEL + '|' + operatorPub + '|' + playerPub) },
        base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }

  // 12 bytes: the key generation, then the counter (never repeats under one key)
  function iv(e, n) {
    var b = new Uint8Array(12), dv = new DataView(b.buffer);
    dv.setUint32(0, e >>> 0);
    dv.setUint32(8, n >>> 0);
    return b;
  }
  function aad(sid, e, n) { return enc.encode(sid + '|' + e + '|' + n); }

  function seal(key, sid, e, n, obj) {
    return subtle.encrypt({ name: 'AES-GCM', iv: iv(e, n), additionalData: aad(sid, e, n) }, key, enc.encode(JSON.stringify(obj))).then(b64);
  }
  // resolves the parsed object; rejects on anything that is not exactly what was sealed
  function open(key, sid, e, n, d) {
    return subtle.decrypt({ name: 'AES-GCM', iv: iv(e, n), additionalData: aad(sid, e, n) }, key, unb64(d)).then(function (buf) {
      return JSON.parse(dec.decode(buf));
    });
  }

  BR.watchCrypto = { available: !!subtle, newPair: newPair, deriveKey: deriveKey, seal: seal, open: open, b64: b64, unb64: unb64 };
})(window.BR = window.BR || {});
