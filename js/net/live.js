/* Live updates from the server: a WebSocket on Cloudflare, Server-Sent Events
   on the Node server (the page says which in <meta name="br-mode" data-live>).
   The connection URL carries a one-time ticket, so a dropped connection is
   reopened with a fresh ticket. */
(function (BR) {
  'use strict';

  var EVENTS = ['hello', 'msg', 'read', 'typing', 'balance', 'presence', 'friend', 'call', 'watch', 'homechat', 'tip', 'items', 'quest',
    'battle', 'coop', 'present', 'hub', 'bigwin', 'kick', 'pay', 'support', 'card', 'retract', 'chatban', 'viewer', 'diary', 'view', 'tree', 'stock', 'medal'];
  var conn = null, want = false, connected = false, timer = 0, backoff = 1000, opening = null, pinger = null, generation = 0;
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

  function dropped(epoch) {
    if (epoch !== generation || !want) return;
    if (conn) conn.close();
    conn = null;
    if (pinger) pinger.stop();
    setConnected(false);
    schedule();
  }

  function openSse(ticket, epoch) {
    var es = new EventSource('/api/stream?ticket=' + encodeURIComponent(ticket) + held());
    var closed = false;
    EVENTS.forEach(function (name) {
      es.addEventListener(name, function (e) {
        if (closed || epoch !== generation || !want) return;
        var data;
        try { data = JSON.parse(e.data); } catch (x) { return; }
        deliver(name, data);
      });
    });
    es.onerror = function () { if (!closed) dropped(epoch); };
    return { close: function () { closed = true; es.onerror = null; es.close(); } };
  }

  function openWs(ticket, epoch) {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    // (the device rides with the connection, not with each request on it: server/core/socketapi.js)
    var ws = new WebSocket(proto + location.host + '/api/live?ticket=' + encodeURIComponent(ticket) + held() + (BR.device ? '&device=' + encodeURIComponent(BR.device.header()) : ''));
    var closed = false, heartbeat = null;
    function send(text) {
      if (closed || epoch !== generation || !want || ws.readyState !== 1) return false;
      try { ws.send(text); if (heartbeat) heartbeat.sent(); return true; } catch (e) { return false; }
    }
    // the API's requests on this connection (js/net/wire.js)
    var wire = BR.wire(send);
    ws.onmessage = function (e) {
      if (closed || epoch !== generation || !want) return;
      if (heartbeat) heartbeat.received(e.data);
      if (e.data === 'pong') return;
      var m;
      try { m = JSON.parse(e.data); } catch (x) { return; }
      if (wire.reply(m)) return;
      if (m && m.event) deliver(m.event, m.data);
    };
    ws.onclose = function () { wire.drop(); if (!closed && epoch === generation) { if (heartbeat) heartbeat.failed(); dropped(epoch); } };
    ws.onerror = function () { /* onclose follows */ };
    // keeps mobile networks and proxies from dropping a connection that has been quiet for a while (anything sent or received does that
    // too); answered by Cloudflare without waking the server
    if (pinger) pinger.stop();
    heartbeat = pinger = BR.keepAlive(send, function () {
      if (closed || epoch !== generation || !want) return;
      closed = true; wire.drop();
      try { ws.close(4000, 'Keepalive timed out'); } catch (e) {}
      dropped(epoch);
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
    if (!want || opening || (conn && connected) || !BR.api.hasToken()) return;
    var ws = BR.api.liveMode === 'ws';
    if (ws ? !window.WebSocket : !window.EventSource) return;
    var epoch = ++generation, job = {};
    opening = job;
    clearTimeout(timer);
    BR.api.ticket().then(function (r) {
      if (!want || generation !== epoch || opening !== job) return;
      opening = null;
      if (conn) conn.close();
      conn = ws ? openWs(r.ticket, epoch) : openSse(r.ticket, epoch);
    }).catch(function (err) {
      if (!want || generation !== epoch || opening !== job) return;
      opening = null;
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
      generation++;
      opening = null;
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
