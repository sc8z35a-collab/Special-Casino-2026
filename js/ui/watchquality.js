/* 観戦 (watching a friend's spins): the picture's quality.

   Watching is not a video call: the friend's game sends what happened (the
   result of each spin, the wallet) over the live connection and this game
   plays it with its own reels and its own sound effects. So there is no
   picture or sound to compress, the delay is the delay of a message, and the
   cost is a few hundred bytes a spin (at most one a second: a friend's spins
   are capped at one a second by the server), far under 300 kbps. Sound effects
   are made here from what happened; nothing audible is ever sent.

   What can be chosen is how much this phone draws: 720P or 460P (the height
   the picture is drawn at; the friend's screen is then stretched to the
   window), and drawing at 24 frames a second at most. Both apply only while
   watching; the game goes back to its own full quality when one stops. */
(function (BR) {
  'use strict';

  var KEY = 'br-watch-quality';
  var HEIGHTS = { 720: 720, 460: 460 };
  var FPS = 24;
  var PERIOD = 1000 / FPS;
  var BASE = 1e9;      // ids this module hands out (so they cannot be mistaken for the browser's)
  var quality = 720, active = false;
  try { var saved = Number(localStorage.getItem(KEY)); if (HEIGHTS[saved]) quality = saved; } catch (e) { /* the default */ }

  /* ------------------------------------------------------------ 24 fps --- */
  // Every callback of one frame gets the same time stamp: they all run together. A frame is let
  // through when its turn comes (every 1/24 s, kept as a running schedule so a 60 Hz screen
  // averages 24 a second: 3 refreshes, then 2, then 3 …); the others are passed on to the next.
  var nativeRaf = window.requestAnimationFrame.bind(window);
  var nativeCaf = window.cancelAnimationFrame.bind(window);
  var seq = BASE, pending = {}, lastRun = -1e9, due = 0, installed = false;
  function install() {
    if (installed) return;
    installed = true;
    window.requestAnimationFrame = function (cb) {
      var id = ++seq;
      (function go() {
        pending[id] = nativeRaf(function (ts) {
          if (active && ts !== lastRun) {
            if (ts < due - 1) { go(); return; }
            due = due + PERIOD > ts - PERIOD ? due + PERIOD : ts + PERIOD;
          }
          lastRun = ts;
          delete pending[id];
          cb(ts);
        });
      })();
      return id;
    };
    window.cancelAnimationFrame = function (id) {
      if (id >= BASE) {
        if (pending[id] !== undefined) { nativeCaf(pending[id]); delete pending[id]; }
        return;
      }
      nativeCaf(id);
    };
  }

  function paint() {
    var b = document.getElementById('watch-quality-btn');
    if (!b) return;
    b.hidden = !active;
    var t = b.querySelector('span');
    if (t) t.textContent = quality + 'P';
    b.title = '観戦の画質（' + quality + 'P・24fps）。押すと切り替わります';
  }
  function relayout() { if (BR.app && BR.app.relayout) BR.app.relayout(); }

  function enter() {
    install();
    active = true;
    paint();
    relayout();
  }
  function exit() {
    if (!active) return;
    active = false;
    paint();
    relayout();
  }
  function toggle() {
    quality = quality === 720 ? 460 : 720;
    try { localStorage.setItem(KEY, String(quality)); } catch (e) { /* this time only */ }
    paint();
    if (active) relayout();
  }

  function wire() {
    var b = document.getElementById('watch-quality-btn');
    if (b) b.addEventListener('click', function () { if (BR.sfx) BR.sfx.play('click'); toggle(); });
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  BR.watchQuality = {
    enter: enter, exit: exit, toggle: toggle,
    quality: function () { return quality; },
    active: function () { return active; },
    fps: FPS,
    // the most a picture of this height (stage units) may be drawn with: pixels for each unit (none while not watching)
    resCap: function (stageHeight) { return active && stageHeight > 0 ? HEIGHTS[quality] / stageHeight : Infinity; }
  };
})(window.BR = window.BR || {});
