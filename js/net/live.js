/* Live updates from the server: a WebSocket on Cloudflare, Server-Sent Events
   on the Node server (the page says which in <meta name="br-mode" data-live>).
   The connection URL carries a one-time ticket, so a dropped connection is
   reopened with a fresh ticket. */
(function (BR) {
  'use strict';

  var EVENTS = ['hello', 'msg', 'read', 'typing', 'balance', 'presence', 'friend', 'call', 'watch', 'homechat', 'tip', 'items', 'quest',
    'battle', 'coop', 'present', 'hub', 'bigwin', 'kick', 'pay', 'support', 'card', 'retract', 'chatban', 'viewer', 'diary', 'view'];
  var conn = null, want = false, connected = false, timer = 0, backoff = 1000, opening = false, pinger = null;
  var handlers = {};

  function emit(ev, arg) { (handlers[ev] || []).forEach(function (f) { try { f(arg); } catch (e) { if (window.console) console.warn(e); } }); }

  function setConnected(v) {
    if (connected === v) return;
    connected = v;
    emit('status', v);
  }

  function schedule() {
    if (!want) return;
    clearTimeout(timer);
    timer = setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, 30000);
  }

  // what the page holds of the hello (js/net/api.js): those parts come as 0 and are made whole before anyone hears it
  function held() { return '&held=' + BR.api.heldParam(); }
  function deliver(name, data) {
    if (EVENTS.indexOf(name) < 0) return;
    if (name === 'hello') { backoff = 1000; setConnected(true); data = BR.api.fromHeld(data); }
    emit(name, data);
  }

  function dropped() {
    if (conn) conn.close();
    conn = null;
    if (pinger) pinger.stop();
    setConnected(false);
    schedule();
  }

  function openSse(ticket) {
    var es = new EventSource('/api/stream?ticket=' + encodeURIComponent(ticket) + held());
    EVENTS.forEach(function (name) {
      es.addEventListener(name, function (e) {
        var data;
        try { data = JSON.parse(e.data); } catch (x) { return; }
        deliver(name, data);
      });
    });
    es.onerror = dropped;
    return { close: function () { es.onerror = null; es.close(); } };
  }

  function openWs(ticket) {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    // (the device rides with the connection, not with each request on it: server/core/socketapi.js)
    var ws = new WebSocket(proto + location.host + '/api/live?ticket=' + encodeURIComponent(ticket) + held() + (BR.device ? '&device=' + encodeURIComponent(BR.device.header()) : ''));
    var closed = false, heartbeat = null;
    function send(text) {
      if (ws.readyState !== 1) return false;
      try { ws.send(text); if (heartbeat) heartbeat.sent(); return true; } catch (e) { return false; }
    }
    // the API's requests on this connection (js/net/wire.js)
    var wire = BR.wire(send);
    ws.onmessage = function (e) {
      if (heartbeat) heartbeat.received(e.data);
      if (e.data === 'pong') return;
      var m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (wire.reply(m)) return;
      if (m && m.event) deliver(m.event, m.data);
    };
    ws.onclose = function () { wire.drop(); if (!closed) { if (heartbeat) heartbeat.failed(); dropped(); } };
    ws.onerror = function () { /* onclose follows */ };
    // keeps mobile networks and proxies from dropping a connection that has been quiet for a while (anything sent or received does that
    // too); answered by Cloudflare without waking the server
    if (pinger) pinger.stop();
    heartbeat = pinger = BR.keepAlive(send, function () {
      if (closed) return;
      closed = true; wire.drop();
      try { ws.close(4000, 'Keepalive timed out'); } catch (e) {}
      dropped();
    });
    return {
      // a message to the server (only on the WebSocket)
      send: send,
      call: wire.call,
      close: function () {
        closed = true;
        if (heartbeat) heartbeat.stop();
        wire.drop();
        try { ws.close(1000); } catch (e) { /* already closed */ }
      }
    };
  }

  function open() {
    if (!want || opening || !BR.api.hasToken()) return;
    var ws = BR.api.liveMode === 'ws';
    if (ws ? !window.WebSocket : !window.EventSource) return;
    opening = true;
    clearTimeout(timer);
    BR.api.ticket().then(function (r) {
      opening = false;
      if (!want) return;
      if (conn) conn.close();
      conn = ws ? openWs(r.ticket) : openSse(r.ticket);
    }).catch(function (err) {
      opening = false;
      setConnected(false);
      if (err && (err.status === 401 || err.status === 403)) return;
      schedule();
    });
  }

  function reconnectNow() {
    if (!want || opening) return;
    if (conn && connected) return;
    if (conn) { conn.close(); conn = null; }
    backoff = 1000;
    open();
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) reconnectNow(); });
  window.addEventListener('online', reconnectNow);

  BR.live = {
    connect: function () { want = true; backoff = 1000; open(); },
    close: function () {
      want = false;
      clearTimeout(timer);
      if (conn) conn.close();
      conn = null;
      setConnected(false);
    },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    isConnected: function () { return connected; },
    // sends `obj` over the WebSocket; false when there is none (SSE, offline)
    send: function (obj) { return !!(conn && connected && conn.send && conn.send(JSON.stringify(obj))); },
    // an API request on the WebSocket (js/net/wire.js); null when there is none
    call: function (method, path, headers, body) { return conn && connected && conn.call ? conn.call(method, path, headers, body) : null; }
  };
})(window.BR = window.BR || {});
