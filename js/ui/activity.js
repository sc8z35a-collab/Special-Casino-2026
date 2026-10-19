/* Activity for the time quests (js/game/quests.js): once a minute an open
   game tells the server how long ago its player last did something (a tap,
   a key, a voice into an open microphone: js/net/call.js) and whether a
   friend's voice comes through. The server counts the time in between while
   that was within 4 minutes; a page out of sight sends nothing. Over the
   WebSocket when there is one, else as a request. */
(function (BR) {
  'use strict';

  var EVERY = 60000;
  var IDLE = (BR.QUESTS && BR.QUESTS.idleMs) || 240000;
  var last = Date.now(), sending = false, soon = 0;
  var listeners = [];

  // Something done. Back after being idle: the server hears it in a moment
  // (in a hub that can switch everyone's benefits back on).
  function poke() {
    var was = Date.now() - last;
    last = Date.now();
    if (was < IDLE) return;
    listeners.forEach(function (fn) { try { fn(true); } catch (e) { /* ignore */ } });
    clearTimeout(soon);
    soon = setTimeout(beat, 800);
  }

  function beat() {
    var api = BR.api;
    if (!api.online || !api.hasToken() || document.hidden || !BR.live.isConnected()) return;
    var idle = Date.now() - last;
    var voice = !!(BR.call && BR.call.live && BR.call.live());
    if (BR.live.send({ op: 'beat', idle: idle, voice: voice ? 1 : 0 })) return;
    if (sending) return;
    sending = true;
    var done = function () { sending = false; };
    api.beat(idle, voice).then(done, done);
  }

  function init() {
    ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (ev) {
      document.addEventListener(ev, poke, { capture: true, passive: true });
    });
    setInterval(beat, EVERY);
    // back in sight: the clock starts again (the time away counts nothing)
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      poke();
      setTimeout(beat, 1500);
    });
    if (BR.api.online) BR.live.on('hello', function () { setTimeout(beat, 2000); });
  }

  BR.activity = {
    init: init,
    poke: poke,
    idle: function () { return Date.now() - last; },
    // active: something done within the last 4 minutes
    active: function () { return Date.now() - last < IDLE; },
    // fn(true) when the player is back after being idle
    onBack: function (fn) { listeners.push(fn); }
  };
})(window.BR = window.BR || {});
