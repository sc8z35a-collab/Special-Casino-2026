/* One visible-page clock for display updates, independent of server deadlines. */
(function (BR) {
  'use strict';
  var tasks = new Map(), serial = 0, timer = 0;
  function schedule() {
    clearTimeout(timer); timer = 0;
    if (document.hidden || !tasks.size) return;
    var next = Infinity; tasks.forEach(function (t) { next = Math.min(next, t.at); });
    timer = setTimeout(tick, Math.max(0, next - Date.now()));
  }
  function tick() {
    var now = Date.now();
    tasks.forEach(function (t) { if (t.at <= now) { t.at = now + t.delay; try { t.fn(); } catch (e) { console.error(e); } } });
    schedule();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); else schedule(); });
  BR.clock = {
    every: function (fn, delay) { var id = ++serial; tasks.set(id, { fn: fn, delay: delay || 1000, at: Date.now() + (delay || 1000) }); schedule(); return id; },
    drop: function (id) { tasks.delete(id); schedule(); }
  };
})(window.BR = window.BR || {});
