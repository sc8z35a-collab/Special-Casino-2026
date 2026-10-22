/* Small wins and winning streaks on the slot screen. A plain WIN gets a light
   touch (the win floats up out of the WIN box with a few sparkles, no
   overlay); wins in a row show a COMBO badge at the top-left corner of the
   reels that gets louder the longer the streak lasts:
     2      gold
     3-4    bigger, glowing, pulsing
     5-7    rainbow, and the reels glow
     8+     the biggest, shaking, with confetti
   From the fifth win in a row every win pays double (the server pays it;
   the badge says 報酬×2).
   Every step of a streak lands with rings, sparks and stars round the badge
   (js/render/juice.js), louder the longer it goes. Five in a row and the
   screen catches FEVER: its edges burn, flames lick up from the bottom,
   embers rise, a FEVER sign hangs off the top-right corner of the reels and
   the marquee runs in fire colours; every win in a FEVER throws more fire,
   and the first spin without a win puts it out in smoke.
   COMBO and FEVER are 3D lettering (COMBO from its models, gold and then
   rainbow; FEVER made in three.js), and the fire is a 3D volume of flames
   (js/render/fire3d.js), drawn flames until it is in.
   Spins of a watched friend count the same way (a separate streak). In a
   hub (友達と稼ぐ, js/ui/hub.js) the combo is everyone's: the server counts
   it, a miss or two do not end it, and the others' wins show on it too. A
   BIG WIN has its own overlay: its badge waits until that is over. */
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
    if (BR.fx && !BR.fx.on('combo')) return;
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
    if (BR.fx && !BR.fx.on('combo')) return;
    var lv = level(n);
    clearTimeout(badgeTimer);
    if (badgeNode && badgeNode.parentNode) badgeNode.parentNode.removeChild(badgeNode);
    var b = el('div', 'cb-badge lv' + lv);
    var inner = el('div', 'cb-inner');
    inner.appendChild(el('b', 'cb-n', String(n)));
    var word = el('i', 'cb-word3d');
    word.setAttribute('aria-label', 'COMBO');
    inner.appendChild(word);
    if (n >= BR.CONFIG.comboDouble) inner.appendChild(el('span', 'cb-x2', '報酬×2'));
    b.appendChild(inner);
    screen().appendChild(b);
    badgeNode = b;
    badgeTimer = setTimeout(function () {
      if (b.parentNode) b.parentNode.removeChild(b);
      if (badgeNode === b) badgeNode = null;
    }, 2600);
    burst(b, lv);
    if (lv >= 3) glowReels(lv);
    // (the FEVER's fire on its way: ready by the fifth)
    if (n >= 3 && BR.fire3d) BR.fire3d.sheet();
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

  /* ------------------------------------------------------------ FEVER --- */
  var FEVER_AT = 5;
  var fever = null;   // { nodes, sign, timer, tick }

  function feverOn() {
    // switched off in 演出設定: the streak goes on without the show
    if (fever || (BR.fx && !BR.fx.on('fever'))) return;
    var J = BR.juice;
    var edge = el('div', 'fv-edge'), glowing = el('div', 'fv-reels'), sign = el('div', 'fv-sign');
    var word = el('div', 'fv-word three');
    var letters = el('i', 'fv-word3d');
    letters.setAttribute('aria-label', 'FEVER');
    word.appendChild(letters);
    sign.appendChild(word);
    [edge, glowing, sign].forEach(function (n) { screen().appendChild(n); });
    // the flames along the bottom: the 3D fire (the drawn tongues while it loads)
    var fire = BR.fire3d ? BR.fire3d.row(edge, 230) : null;
    screen().classList.add('fever');
    fever = { nodes: [edge, glowing, sign], sign: sign, fire: fire, timer: setInterval(embers, 140), tick: 0 };
    BR.sfx.fever(true);
    BR.sfx.play('fever');
    if (!J) return;
    var W = J.W(), H = J.H(), r = J.at('#reels');
    var bn = J.banner('FEVER!!', 'fever', 1800), bt = bn && bn.querySelector('b');
    if (bt) { bt.classList.add('jc-3d'); bt.setAttribute('aria-label', 'FEVER!!'); bt.textContent = ''; }
    J.flash('#ff7a2a', 0.38, 420);
    J.shake(null, 12, 520);
    J.ring(r.x, r.y, { r0: 200, r1: 1100, dur: 0.8, w: 18, sy: 0.55, color: 'fire' });
    J.ring(r.x, r.y, { r0: 150, r1: 1400, dur: 1, w: 8, sy: 0.5, color: 'pink', delay: 0.1 });
    // fire bursts up from the whole bottom edge and both sides
    for (var i = 0; i < 6; i++) J.sparks(W * (i + 0.5) / 6, H, { n: 14, speed: 1500, dir: -Math.PI / 2, spread: 0.35, life: 1.2, g: 500, color: 'fire', jx: 120, delay: i * 0.04 });
    J.sparks(0, H * 0.7, { n: 20, speed: 1300, dir: -Math.PI * 0.3, spread: 0.3, life: 1, g: 600, color: 'fire' });
    J.sparks(W, H * 0.7, { n: 20, speed: 1300, dir: -Math.PI * 0.7, spread: 0.3, life: 1, g: 600, color: 'fire' });
    var s = J.at(sign);
    J.stars(s.x, s.y, { n: 6, r: 120, size: 90, delay: 0.35 });
    J.sparks(s.x, s.y, { n: 24, speed: 700, life: 0.8, g: 400, color: 'fire', delay: 0.35 });
  }

  // embers rising from the bottom of the screen, now and then a flame up a side
  function embers() {
    var J = BR.juice;
    if (!J || !fever || J.calm() || document.hidden || BR.screens.current() !== 'slot' ||
      document.querySelector('#stage > .modal:not([hidden])')) return;
    var k = ++fever.tick;
    if (J.low() && k % 2) return;
    var W = J.W(), H = J.H();
    J.sparks(U.rand(0, W), H + 6, { n: 2, speed: 240, dir: -Math.PI / 2, spread: 0.4, life: 1.8, g: -240, drag: 0.7, color: 'fire', size: 0.9, stagger: 0.12 });
    if (k % 7 === 0) {
      var left = k % 14 === 0;
      J.sparks(left ? 10 : W - 10, U.rand(H * 0.35, H), { n: 4, speed: 320, dir: left ? -Math.PI * 0.4 : -Math.PI * 0.6, spread: 0.3, life: 1.1, g: -320, color: 'fire' });
    }
  }

  // a win in a FEVER: fire rolls round the reels and up from the bottom
  function feverWin() {
    var J = BR.juice;
    if (!fever) return;
    BR.sfx.play('feverWin');
    var sign = fever.sign;
    sign.classList.remove('hit');
    void sign.offsetWidth;
    sign.classList.add('hit');
    if (!J) return;
    var W = J.W(), H = J.H(), r = J.at('#reels'), s = J.at(sign);
    J.ring(r.x, r.y, { r0: 280, r1: 900, dur: 0.7, w: 14, sy: 0.6, color: 'fire' });
    for (var i = 0; i < 4; i++) J.sparks(W * (i + 0.5) / 4, H, { n: 10, speed: 1200, dir: -Math.PI / 2, spread: 0.4, life: 1, g: 500, color: 'fire', jx: 160 });
    J.sparks(s.x, s.y, { n: 16, speed: 600, life: 0.7, g: 400, color: 'fire' });
    J.ring(s.x, s.y, { r0: 30, r1: 200, dur: 0.5, w: 8, color: 'fire' });
  }

  // the streak is over: the fire goes out in smoke (quiet: just gone)
  function feverOff(quiet) {
    if (!fever) return;
    var f = fever, J = BR.juice;
    fever = null;
    clearInterval(f.timer);
    screen().classList.remove('fever');
    BR.sfx.fever(false);
    var s = J && J.at(f.sign);
    f.nodes.forEach(function (n) { n.classList.add('out'); });
    setTimeout(function () {
      if (f.fire) f.fire.stop();
      f.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    }, 900);
    if (quiet || !J || BR.screens.current() !== 'slot') return;
    BR.sfx.play('feverEnd');
    var W = J.W(), H = J.H();
    for (var i = 0; i < 5; i++) J.smoke(W * (i + 0.5) / 5, H - 110, H, { n: 4, jx: 160 });
    J.smoke(s.x, s.y - 30, s.y + 30, { n: 6, jx: 110 });
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
    if (watching !== watchingNow) { watchingNow = watching; streak = 0; feverOff(true); }
    // in a hub the server counts the combo everyone shares (it lives through a miss or two)
    var shared = !!res.hub && !watching;
    if (!(res.total > 0)) {
      streak = shared ? res.hub.combo : 0;
      if (!streak) feverOff();
      return;
    }
    // (the server says which combo the win made: the count survives a reload)
    streak = shared ? res.hub.combo : res.combo > 0 ? res.combo : streak + 1;
    var n = streak;
    if (res.tier <= 1) {
      smallWin(res);
      if (n >= 2) badge(n, true);
      streakFire(n);
      return;
    }
    setTimeout(function () {
      afterOverlay(function () {
        if (streak !== n) return;
        if (n >= 2) badge(n, false);
        streakFire(n);
      });
    }, 120);
  }
  // the fifth win in a row lights the FEVER (after its badge), every win after that feeds it
  function streakFire(n) {
    if (n < FEVER_AT) return;
    setTimeout(function () {
      if (streak !== n) return;
      if (fever) feverWin(); else feverOn();
    }, 380);
  }

  // Someone else in my hub spun (js/ui/hub.js): the combo they made, and
  // their win on the badge (and the FEVER) like one of mine.
  function shared(n, win) {
    if (watchingNow) return;
    streak = n;
    if (!n) { feverOff(); return; }
    if (!win) return;
    if (n >= 2) badge(n, true);
    streakFire(n);
  }

  function reset() {
    streak = 0;
    clearTimeout(badgeTimer);
    if (badgeNode && badgeNode.parentNode) badgeNode.parentNode.removeChild(badgeNode);
    badgeNode = null;
    if (glow) glow.classList.remove('on', 'big');
    feverOff(true);
  }

  BR.combo = {
    init: function () {},
    spun: spun,
    shared: shared,
    reset: reset,
    streak: function () { return streak; },
    fever: function () { return !!fever; }
  };
})(window.BR = window.BR || {});
