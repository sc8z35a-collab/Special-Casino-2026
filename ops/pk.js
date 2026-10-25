/* The passkey, this page's side (server/core/pk.js).
   When the page needs it, it makes a key pair of its own and keeps it in its
   memory only: not in the browser's storage, and the private half cannot be
   read out of the key object. Once the right passkey is in, the server holds
   the public half; from then on every request to the operator site, the
   security base, the vault, the backups and the emergency routes is signed
   with the private half. So a login token taken from this browser is good for
   nothing, and a page that is closed, reloaded or left has lost its key: the
   passkey is asked again. The same file is ops/pk.js and sec/pk.js (the
   security base keeps to itself); a test keeps the two equal. */
var OpsPk = (function () {
  'use strict';
  var pair = null, made = null, gid = '', until = 0;
  // what a gate guards (server/core/pk.js: GATED; a test keeps the two equal)
  var GATED = /^\/api\/(?:ops\/|sec\/|vault\/|backup(?:\/|$)|emergency(?:\/|$))/;

  function b64u(buf) {
    var a = new Uint8Array(buf), s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  // this page's key pair (made the first time it is needed, and kept as long as the page is)
  function begin() {
    if (!made) {
      made = crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']).then(function (p) { pair = p; return p; });
    }
    return made;
  }
  // the public half, as the server takes it
  function publicKey() {
    return begin().then(function (p) { return crypto.subtle.exportKey('jwk', p.publicKey); }).then(function (j) {
      return { kty: j.kty, crv: j.crv, x: j.x, y: j.y };
    });
  }
  // The header for a request: the gate, the time, a number used once, and the
  // signature over the method and the path — or null (no gate open, or a route
  // no gate guards)
  function header(method, path) {
    var p = String(path).split('?')[0];
    if (!pair || !gid || !GATED.test(p)) return Promise.resolve(null);
    var ts = Date.now(), raw = new Uint8Array(16);
    crypto.getRandomValues(raw);
    var nonce = b64u(raw);
    var text = 'v1\n' + method + '\n' + p + '\n' + ts + '\n' + nonce + '\n' + gid;
    return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(text)).then(function (sig) {
      return gid + '.' + ts + '.' + nonce + '.' + b64u(sig);
    });
  }
  // the page is left, reloaded or put away: the key and the gate are forgotten
  // (a page restored from the back/forward cache comes back without them)
  function forget() { pair = null; made = null; gid = ''; until = 0; }
  window.addEventListener('pagehide', forget);

  return {
    begin: begin,
    publicKey: publicKey,
    header: header,
    // the server opened a gate for this page / it is closed
    open: function (id, end) { gid = id; until = end; },
    close: function () { gid = ''; until = 0; },
    forget: forget,
    until: function () { return until; },
    active: function () { return !!(pair && gid); }
  };
})();
