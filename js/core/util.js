/* Small helpers shared by every module. */
(function (BR) {
  'use strict';

  var util = {};

  // "5008159" -> "5 008 159" (thin grouping like the reference UI)
  util.fmt = function (n) {
    n = Math.floor(Math.max(0, n));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };
  // multiplier text: 1.5 -> "1.5", 10 -> "10"
  util.fmtMult = function (m) {
    return (Math.round(m * 10) / 10).toString();
  };

  util.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  util.lerp = function (a, b, t) { return a + (b - a) * t; };
  util.now = function () { return performance.now(); };

  util.ease = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return t * (2 - t); },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; },
    outCubic: function (t) { var u = 1 - t; return 1 - u * u * u; },
    inCubic: function (t) { return t * t * t; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outQuart: function (t) { var u = 1 - t; return 1 - u * u * u * u; },
    outQuint: function (t) { var u = 1 - t; return 1 - u * u * u * u * u; },
    outExpo: function (t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); },
    outBack: function (t, s) { s = s === undefined ? 1.70158 : s; var u = t - 1; return u * u * ((s + 1) * u + s) + 1; },
    outElastic: function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
    },
    inBack: function (t) { var s = 1.70158; return t * t * ((s + 1) * t - s); }
  };

  // Unbiased random float in [0,1) from the platform CSPRNG.
  var buf = new Uint32Array(64), bufPos = 64;
  util.random = function () {
    if (bufPos >= buf.length) {
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
      else for (var i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 4294967296);
      bufPos = 0;
    }
    return buf[bufPos++] / 4294967296;
  };
  util.rand = function (a, b) { return a + (b - a) * util.random(); };
  util.randInt = function (a, b) { return a + Math.floor(util.random() * (b - a + 1)); };
  util.pick = function (arr) { return arr[Math.floor(util.random() * arr.length)]; };

  // Seconds until the next 00:00 UTC.
  util.secondsToUtcMidnight = function () {
    var d = new Date();
    var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return Math.max(0, Math.floor((next - d.getTime()) / 1000));
  };
  util.utcDay = function () {
    var d = new Date();
    return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
  };

  util.$ = function (sel, root) { return (root || document).querySelector(sel); };
  util.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // requestAnimationFrame driven tween; returns a cancel function.
  util.tween = function (dur, fn, done) {
    var t0 = util.now(), raf = 0, dead = false;
    function step() {
      if (dead) return;
      var t = Math.min(1, (util.now() - t0) / dur);
      fn(t);
      if (t < 1) raf = requestAnimationFrame(step);
      else if (done) done();
    }
    raf = requestAnimationFrame(step);
    return function () { dead = true; cancelAnimationFrame(raf); };
  };

  util.wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  BR.util = util;
})(window.BR = window.BR || {});
