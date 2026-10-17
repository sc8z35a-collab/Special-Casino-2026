/* Live updates from the server (Server-Sent Events). The stream URL carries a
   one-time ticket, so a dropped connection is reopened with a fresh ticket
   instead of EventSource's built-in retry. */
(function (BR) {
  'use strict';

  var EVENTS = ['hello', 'msg', 'balance', 'presence', 'board'];
  var es = null, want = false, connected = false, timer = 0, backoff = 1000, opening = false;
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

  function open() {
    if (!want || opening || !BR.api.hasToken() || !window.EventSource) return;
    opening = true;
    clearTimeout(timer);
    BR.api.ticket().then(function (r) {
      opening = false;
      if (!want) return;
      if (es) es.close();
      es = new EventSource('/api/stream?ticket=' + encodeURIComponent(r.ticket));
      EVENTS.forEach(function (name) {
        es.addEventListener(name, function (e) {
          var data;
          try { data = JSON.parse(e.data); } catch (x) { return; }
          if (name === 'hello') { backoff = 1000; setConnected(true); }
          emit(name, data);
        });
      });
      es.onerror = function () {
        if (es) es.close();
        es = null;
        setConnected(false);
        schedule();
      };
    }).catch(function (err) {
      opening = false;
      setConnected(false);
      if (err && (err.status === 401 || err.status === 403)) return;
      schedule();
    });
  }

  function reconnectNow() {
    if (!want || es || opening) return;
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
      if (es) es.close();
      es = null;
      setConnected(false);
    },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    isConnected: function () { return connected; }
  };
})(window.BR = window.BR || {});
