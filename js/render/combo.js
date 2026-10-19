/* Small wins and winning streaks on the slot screen. A plain WIN gets a light
   touch (the win floats up out of the WIN box with a few sparkles, no
   overlay); wins in a row show a COMBO badge at the top-left corner of the
   reels that gets louder the longer the streak lasts:
     2      gold
     3-4    bigger, glowing, pulsing
     5-7    rainbow, and the reels glow
     8+     the biggest, shaking, with confetti
   Every step of a streak lands with rings, sparks and stars round the badge
   (js/render/juice.js), louder the longer it goes.
   Spins of a watched friend count the same way (a separate streak). A BIG WIN
   has its own overlay: its badge waits until that is over. */
(function (BR) {
  'use strict';

  var U = BR.util;
  var $ = U.$;

  var streak = 0;
  var watchingNow = false;   // whose spins the streak counts
  var badgeNode = null, badgeTimer = 0, glow = null, glowTimer = 0;
  var COLORS = ['#ffe27a', '#ff6b6b', '#6ee682', '#5ec8ff', '#d68bff', '#ffffff', '#ffb84d'];

  function screen() { return $('#screen-slot'); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  // a node that removes itself after `ms`
  function add(node, ms) {
    screen().appendChild(node);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, ms);
    return node;
  }
  function level(n) { return n >= 8 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : 1; }

  /* ------------------------------------------------------------ a small win --- */
  function smallWin(res) {
    var f = el('div', 'cb-float');
    f.appendChild(el('i', 'ic ic-chip'));
    f.appendChild(el('span', '', '+' + U.fmt(res.total)));
    add(f, 1400);
    // sparkles around the top of the WIN box
    for (var i = 0; i < 9; i++) {
      var s = el('i', 'cb-spark');
      var a = (i / 9) * Math.PI * 2 + Math.random() * 0.5;
      var r = 70 + Math.random() * 90;
      s.style.setProperty('--dx', Math.round(Math.cos(a) * r * 1.6) + 'px');
      s.style.setProperty('--dy', Math.round(Math.sin(a) * r - 40) + 'px');
      s.style.setProperty('--d', Math.round(Math.random() * 120) + 'ms');
      s.style.setProperty('--s', (0.6 + Math.random() * 0.7).toFixed(2));
      add(s, 1100);
    }
  }

  /* ------------------------------------------------------------ the streak --- */
  function badge(n, sound) {
    var lv = level(n);
    clearTimeout(badgeTimer);
    if (badgeNode && badgeNode.parentNode) badgeNode.parentNode.removeChild(badgeNode);
    var b = el('div', 'cb-badge lv' + lv);
    var inner = el('div', 'cb-inner');
    inner.appendChild(el('b', 'cb-n', String(n)));
    inner.appendChild(el('span', 'cb-word', 'COMBO!'));
    b.appendChild(inner);
    screen().appendChild(b);
    badgeNode = b;
    badgeTimer = setTimeout(function () {
      if (b.parentNode) b.parentNode.removeChild(b);
      if (badgeNode === b) badgeNode = null;
    }, 2600);
    burst(b, lv);
    if (lv >= 3) glowReels(lv);
    if (lv >= 4) confetti(b);
    if (sound) BR.sfx.play(lv >= 4 ? 'purchase' : lv >= 3 ? 'notify' : 'betUp');
  }

  // the badge lands: rings, sparks and stars, more of everything the higher it goes
  function burst(b, lv) {
    var J = BR.juice;
    if (!J) return;
    var p = J.at(b), color = lv >= 3 ? 'rainbow' : 'gold';
    J.ring(p.x, p.y, { r0: 20, r1: 120 + lv * 50, dur: 0.5, w: 6 + lv * 2, color: lv >= 3 ? 'pink' : 'gold' });
    if (lv >= 2) J.ring(p.x, p.y, { r0: 20, r1: 200 + lv * 70, dur: 0.7, w: 4, delay: 0.08, color: lv >= 3 ? 'blue' : 'white' });
    J.sparks(p.x, p.y, { n: 8 + lv * 8, speed: 500 + lv * 160, life: 0.8, g: 500, color: color });
    J.stars(p.x, p.y, { n: lv + 1, r: 70 + lv * 20, size: 60 + lv * 10 });
    J.bloom(p.x, p.y, { size: 200 + lv * 90, dur: 0.5 });
    if (lv >= 3) J.flash(lv >= 4 ? '#fff0c0' : '#ffe9b0', lv >= 4 ? 0.3 : 0.18, 300);
    if (lv >= 4) J.shake(null, 9, 420);
  }

  function glowReels(lv) {
    if (!glow) {
      glow = el('div', 'cb-glow');
      screen().appendChild(glow);
    }
    glow.classList.remove('on', 'big');
    void glow.offsetWidth;
    glow.classList.add('on');
    if (lv >= 4) glow.classList.add('big');
    clearTimeout(glowTimer);
    glowTimer = setTimeout(function () { glow.classList.remove('on', 'big'); }, 2600);
  }

  function confetti(b) {
    var J = BR.juice;
    if (J) {
      var p = J.at(b);
      J.confetti(p.x, p.y, { n: 60, speed: 1300, dir: -Math.PI * 0.35, spread: 0.9 });
      J.confetti(J.W() / 2, J.H() * 0.55, { n: 40, speed: 1500, dir: -Math.PI / 2, spread: 1.2, delay: 0.1 });
      return;
    }
    for (var i = 0; i < 22; i++) {
      var c = el('i', 'cb-confetti');
      var a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
      var r = 120 + Math.random() * 220;
      c.style.setProperty('--dx', Math.round(Math.cos(a) * r) + 'px');
      c.style.setProperty('--dy', Math.round(Math.sin(a) * r * 0.6 + 160 + Math.random() * 120) + 'px');
      c.style.setProperty('--r', Math.round(Math.random() * 720 - 360) + 'deg');
      c.style.setProperty('--d', Math.round(Math.random() * 160) + 'ms');
      c.style.background = COLORS[i % COLORS.length];
      add(c, 1700);
    }
  }

  // after a BIG WIN overlay (it starts right after the reels stop)
  function afterOverlay(fn) {
    var tries = 0;
    (function wait() {
      if (++tries > 70) return;
      if (BR.game && BR.game.presenting) { setTimeout(wait, 200); return; }
      fn();
    })();
  }

  /* ------------------------------------------------------------ api --- */
  // every finished spin (mine, or the friend's I am watching)
  function spun(res, watching) {
    if (!res) return;
    watching = !!watching;
    if (watching !== watchingNow) { watchingNow = watching; streak = 0; }
    if (!(res.total > 0)) { streak = 0; return; }
    var n = ++streak;
    if (res.tier <= 1) {
      smallWin(res);
      if (n >= 2) badge(n, true);
      return;
    }
    if (n >= 2) setTimeout(function () { afterOverlay(function () { if (streak === n) badge(n, false); }); }, 120);
  }

  function reset() {
    streak = 0;
    clearTimeout(badgeTimer);
    if (badgeNode && badgeNode.parentNode) badgeNode.parentNode.removeChild(badgeNode);
    badgeNode = null;
    if (glow) glow.classList.remove('on', 'big');
  }

  BR.combo = {
    init: function () {},
    spun: spun,
    reset: reset,
    streak: function () { return streak; }
  };
})(window.BR = window.BR || {});
