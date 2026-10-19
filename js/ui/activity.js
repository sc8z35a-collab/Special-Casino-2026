/* Activity for the time quests (js/game/quests.js): once a minute an open
   game tells the server how long ago its player last did something (a tap,
   a key, a voice into an open microphone: js/net/call.js) and whether a
   friend's voice comes through. The server counts the time in between while
   that was within 4 minutes; a page out of sight sends nothing. Over the
   WebSocket when there is one, else as a request. */
(function (BR) {
  'use strict';

  var EVERY = 60000;
  var last = Date.now(), sending = false;

  function poke() { last = Date.now(); }

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

  BR.activity = { init: init, poke: poke, idle: function () { return Date.now() - last; } };
})(window.BR = window.BR || {});
