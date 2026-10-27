/* Adaptive WebSocket probes: traffic substitutes for pings. Stable replies
   extend idle intervals; a missing reply reconnects instead of hanging. */
(function (BR) {
  'use strict';
  var learned = 55000;
  BR.keepAlive = function (send, lost) {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    var delay = Math.min(25000, learned), activity = Date.now(), received = activity, pending = 0, stopped = false, timer = 0;
    function limit() { return Math.min(learned, connection && connection.saveData ? 55000 : 45000); }
    function arm() {
      clearTimeout(timer);
      if (stopped) return;
      var due = pending ? pending + 10000 : Math.min(activity + delay, received + 60000);
      timer = setTimeout(check, Math.max(1, due - Date.now()));
    }
    function check() {
      if (stopped) return;
      var now = Date.now();
      if (pending && now - pending >= 10000) { failed(); lost(); return; }
      if (!pending && (now - activity >= delay || now - received >= 60000)) {
        pending = now;
        if (!send('ping')) { failed(); lost(); return; }
      }
      arm();
    }
    function awake() {
      if (stopped) return;
      if (!document.hidden && Date.now() - received >= 10000) { activity = 0; check(); }
    }
    function changed() { learned = 55000; delay = 25000; if (!pending) activity = 0; check(); }
    function failed() {
      var idle = Date.now() - activity;
      if (pending) learned = Math.max(15000, Math.min(learned, delay * 0.7));
      else if (idle >= 20000) learned = Math.max(15000, Math.min(learned, idle - 5000));
      stop();
    }
    function stop() {
      if (stopped) return; stopped = true; clearTimeout(timer);
      document.removeEventListener('visibilitychange', awake); window.removeEventListener('online', changed);
      if (connection && connection.removeEventListener) connection.removeEventListener('change', changed);
    }
    document.addEventListener('visibilitychange', awake); window.addEventListener('online', changed);
    if (connection && connection.addEventListener) connection.addEventListener('change', changed);
    arm();
    return {
      sent: function () { activity = Date.now(); },
      received: function (text) {
        var now = Date.now(); activity = received = now;
        if (pending) {
          if (text === 'pong') delay = now - pending > 1500 ? 20000 : Math.min(limit(), delay + 5000);
          pending = 0; arm();
        }
      },
      failed: failed,
      stop: stop
    };
  };
})(window.BR = window.BR || {});
