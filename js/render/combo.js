/* Small wins and winning streaks on the slot screen. A plain WIN gets a light
   touch (the win floats up out of the WIN box with a few sparkles, no
   overlay); wins in a row show a COMBO badge at the top-left corner of the
   reels that gets louder the longer the streak lasts:
     2      gold
     3-4    bigger, glowing, pulsing
     5-7    rainbow, and the reels glow
     8+     the biggest, shaking, with confetti
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
    if (lv >= 3) glowReels(lv);
    if (lv >= 4) confetti();
    if (sound) BR.sfx.play(lv >= 4 ? 'purchase' : lv >= 3 ? 'notify' : 'betUp');
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

  function confetti() {
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
