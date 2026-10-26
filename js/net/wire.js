/* API requests over a live WebSocket (server/core/socketapi.js), for the game (js/net/live.js, js/net/api.js) and the operator site (ops/ops.js).
   While the connection is up, a request goes as one message on it and its answer comes back on it, instead of a request of its own; the
   server answers it exactly as over HTTP. What the server keeps for HTTP (the same rule below) and big bodies go over HTTP.
     var w = BR.wire(send)        send(text) → true when it went out
     w.call(method, path, headers, body) → null (ask over HTTP) or a promise of { status, body } / null (the server said: over HTTP)
                                           rejected with { network: true } when the connection went before the answer came
     w.reply(message)             an answer that came on the connection ({ re, s, b }): true when it was one
     w.drop()                     the connection went: what waits is rejected (a GET is asked again over HTTP by the caller) */
(function (BR) {
  'use strict';

  var HTTP_ONLY = /^\/api\/(?:login|register|logout|recovery|password|ban$|oauth\/|pk\/|ops\/login|ops\/profile\/|ops\/ext\/|sec\/|pay\/|discord\/|line\/|admin$|internal\/|stream|ops\/live-ticket|vault\/(?:piece|chunk))/;
  // the chat routes, read by the host's automatic filter before the server (server/core/attach.js), and the vault's writes
  var POST_HTTP = /^\/api\/(?:diary\/comments|messages|home\/chat|hub\/say|official\/feedback|report|report\/message|vault\/.*)$/;
  var BODY_MAX = 16 * 1024, WAIT_MS = 20000;
  var LOWER = { Authorization: 'authorization', 'X-Device': 'x-device', 'X-Ops-Device': 'x-ops-device', 'X-Gate': 'x-gate', 'X-Vault-Ticket': 'x-vault-ticket' };

  BR.wire = function (send) {
    var seq = 0, waiting = {};
    function settle(id, fn) { var w = waiting[id]; if (!w) return; delete waiting[id]; clearTimeout(w.timer); fn(w); }
    return {
      call: function (method, path, headers, body) {
        var route = String(path).split('?')[0];
        if ((method !== 'GET' && method !== 'POST') || HTTP_ONLY.test(route) || (method === 'POST' && POST_HTTP.test(route))) return null;
        var h = {};
        Object.keys(headers || {}).forEach(function (k) { var n = LOWER[k] || k.toLowerCase(); if (n !== 'content-type') h[n] = headers[k]; });
        var text = JSON.stringify({ op: 'api', id: ++seq, m: method, p: path, h: h, b: method === 'POST' ? body || {} : undefined });
        if (text.length > BODY_MAX + 2048) return null;
        var id = seq;
        return new Promise(function (resolve, reject) {
          waiting[id] = { resolve: resolve, reject: reject, timer: setTimeout(function () { settle(id, function (w) { w.reject({ network: true }); }); }, WAIT_MS) };
          if (!send(text)) settle(id, function (w) { w.resolve(null); });
        });
      },
      reply: function (m) {
        if (!m || m.re === undefined) return false;
        settle(m.re, function (w) { w.resolve(m.s ? { status: m.s, body: m.b || {} } : null); });
        return true;
      },
      drop: function () { Object.keys(waiting).forEach(function (id) { settle(id, function (w) { w.reject({ network: true }); }); }); }
    };
  };
})(window.BR = window.BR || {});
