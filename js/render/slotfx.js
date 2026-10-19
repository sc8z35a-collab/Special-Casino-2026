/* The slot machine's own show, called from js/main.js: marquee lights round
   the reels (a slow wave when idle, a chase while the reels turn, racing red
   in a リーチ, flashing on a win), a flash of light across the reels and a
   burst off the SPIN button at the start, dust, light and a jolt where each
   reel lands, the リーチ banner with sparks and lightning off the reel that
   slows down, and coins jumping out of the winning symbols. Drawn with
   js/render/juice.js and css/juice.css. */
(function (BR) {
  'use strict';

  var U = BR.util, J;
  var $ = U.$;
  var VIEW_W = 1006, VIEW_H = 554;
  var COL_PITCH = 202.67, COL_C0 = 98, ROW_PITCH = 186, CELL_H = 182;

  var mq = null, mode = '', modeTimer = 0, sweep = null;
  var antic = { timer: 0, reels: [], count: 0 };
  var lastActive = 0, attract = false;

  function init() {
    J = BR.juice;
    var reels = $('#reels');
    buildMarquee(reels);
    sweep = document.createElement('div');
    sweep.className = 'reel-sweep';
    reels.appendChild(sweep);
    twinkles(reels);
    setMode('idle');
    // left alone for a while, the machine calls for a spin
    lastActive = U.now();
    document.addEventListener('pointerdown', wake, true);
    setInterval(checkIdle, 1000);
  }

  /* ------------------------------------------------------------ while nothing happens --- */
  // little stars twinkling on the gold corners of the reels and the frame
  function twinkles(reels) {
    var spots = [[0, 0], [1044, 0], [1044, 586], [0, 586], [522, -6], [522, 592]];
    spots.forEach(function (p, i) {
      var t = document.createElement('i');
      t.className = 'tw';
      t.style.left = p[0] + 'px';
      t.style.top = p[1] + 'px';
      t.style.animationDelay = (-i * 1.7) + 's';
      reels.appendChild(t);
    });
  }
  function wake() {
    lastActive = U.now();
    if (attract) setAttract(false);
  }
  function checkIdle() {
    var g = BR.game;
    var can = BR.screens && BR.screens.current() === 'slot' && g && !g.busy() && !g.auto && !g.watch && !document.hidden &&
      !document.querySelector('#stage > .modal:not([hidden])');
    if (!can) { lastActive = U.now(); if (attract) setAttract(false); return; }
    if (!attract && U.now() - lastActive > 15000) setAttract(true);
  }
  function setAttract(on) {
    attract = on;
    var b = $('#btn-spin');
    if (b) b.classList.toggle('attract', on);
    if (on && mode === 'idle') setMode('attract');
    else if (!on && mode === 'attract') setMode('idle');
  }

  /* ------------------------------------------------------------ marquee --- */
  // bulbs every ~40 px on a rounded rectangle 20 px outside the reel frame,
  // numbered clockwise from the top-left corner
  function buildMarquee(reels) {
    mq = document.createElement('div');
    mq.className = 'mq';
    mq.setAttribute('aria-hidden', 'true');
    var x0 = -20, y0 = -20, x1 = 1064, y1 = 606, r = 34, step = 40;
    var pts = [];
    var segs = [
      [x0 + r, y0, x1 - r, y0], [x1, y0 + r, x1, y1 - r], [x1 - r, y1, x0 + r, y1], [x0, y1 - r, x0, y0 + r]
    ];
    var corners = [[x1 - r, y0 + r, -Math.PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, Math.PI / 2], [x0 + r, y0 + r, Math.PI]];
    segs.forEach(function (s, k) {
      var len = Math.hypot(s[2] - s[0], s[3] - s[1]), n = Math.max(1, Math.round(len / step));
      for (var i = 0; i < n; i++) pts.push([s[0] + (s[2] - s[0]) * i / n, s[1] + (s[3] - s[1]) * i / n]);
      var c = corners[k];
      for (var j = 0; j < 2; j++) {
        var a = c[2] + (j + 0.5) * Math.PI / 4;
        pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
      }
    });
    var n = pts.length;
    mq.style.setProperty('--n', String(n));
    pts.forEach(function (p, i) {
      var b = document.createElement('i');
      b.style.left = p[0].toFixed(1) + 'px';
      b.style.top = p[1].toFixed(1) + 'px';
      // counted backwards: the chase runs clockwise
      b.style.setProperty('--i', String(n - i));
      mq.appendChild(b);
    });
    reels.insertBefore(mq, reels.firstChild);
  }

  // idle | spin | antic | win | big
  function setMode(m, ms) {
    clearTimeout(modeTimer);
    if (mq && m !== mode) {
      mq.className = 'mq ' + m;
      mode = m;
    }
    if (ms) modeTimer = setTimeout(function () { setMode('idle'); }, ms);
  }

  /* ------------------------------------------------------------ positions --- */
  // a cell of the reels in stage px (row 0..2)
  function cell(col, row) {
    var c = J.at('#reel-canvas');
    return { x: c.x - VIEW_W / 2 + COL_C0 + col * COL_PITCH, y: c.y - VIEW_H / 2 + row * ROW_PITCH + CELL_H / 2 };
  }
  function reelBox() {
    var c = J.at('#reel-canvas');
    return { x: c.x - VIEW_W / 2, y: c.y - VIEW_H / 2, w: VIEW_W, h: VIEW_H, cx: c.x, cy: c.y };
  }

  /* ------------------------------------------------------------ the spin --- */
  function spinStart() {
    if (!J) return;
    wake();
    setMode('spin');
    var b = J.at('#btn-spin');
    J.ring(b.x, b.y, { r0: 70, r1: 230, dur: 0.5, w: 12 });
    J.ring(b.x, b.y, { r0: 60, r1: 320, dur: 0.7, w: 5, delay: 0.06, color: 'white' });
    J.sparks(b.x, b.y, { n: 22, speed: 900, life: 0.7, g: 300, jx: 60, jy: 60 });
    J.bloom(b.x, b.y, { size: 420, dur: 0.45, a: 0.7 });
    if (sweep) {
      sweep.classList.remove('go');
      void sweep.offsetWidth;
      sweep.classList.add('go');
    }
  }

  // reel i comes to rest
  function land(i) {
    if (!J) return;
    var last = i === 4;
    var top = cell(i, 0), bot = cell(i, 2);
    var y0 = top.y - CELL_H / 2, y1 = bot.y + CELL_H / 2;
    J.sparks(top.x, y1 - 6, { n: last ? 16 : 9, speed: 480, dir: -Math.PI / 2, spread: 1.2, life: 0.55, g: 900, jx: 70, color: 'gold' });
    J.sparks(top.x, y0 + 6, { n: last ? 10 : 6, speed: 380, dir: Math.PI / 2, spread: 1.1, life: 0.45, g: -200, jx: 70, color: 'white' });
    J.bloom(top.x, y1, { size: 260, sy: 0.35, dur: 0.35, a: 0.7 });
    J.bloom(top.x, y0, { size: 220, sy: 0.35, dur: 0.3, a: 0.5 });
    // the machine takes the weight of each reel: a thud downwards
    J.kick('#reels', 0, last ? 9 : 5, last ? 300 : 220);
    if (antic.reels.indexOf(i) >= 0) {
      var mid = (y0 + y1) / 2;
      if (awaited(i)) {
        // what it was waiting for: the reel explodes in fire
        J.ring(top.x, mid, { r0: 40, r1: 420, dur: 0.6, w: 14, sy: 1.4, color: 'fire' });
        J.ring(top.x, mid, { r0: 30, r1: 700, dur: 0.8, w: 6, sy: 1.1, color: 'white', delay: 0.06 });
        J.sparks(top.x, mid, { n: 46, speed: 1100, life: 0.9, g: 600, jx: 80, jy: 200, color: 'fire' });
        J.bloom(top.x, mid, { size: 640, sy: 1.3, dur: 0.6 });
        J.flash('#ffd27a', 0.42, 320);
        J.shake('#reels', 12, 420);
      } else {
        // it did not come: the fire goes out in smoke
        J.ring(top.x, mid, { r0: 40, r1: 260, dur: 0.45, w: 8, sy: 1.4, color: 'fire' });
        J.smoke(top.x, y0 + 40, y1, { n: 16 });
        BR.sfx.play('miss');
      }
      antic.reels.splice(antic.reels.indexOf(i), 1);
      if (!antic.reels.length) stopAntic();
    }
  }

  // Did reel i bring what its リーチ waited for (one more of a symbol making
  // the pay line worth 20x or more)?
  function awaited(i) {
    var res = BR.game && BR.game.result;
    if (!res || !res.line) return false;
    var counts = {};
    for (var j = 0; j < i; j++) counts[res.line[j]] = (counts[res.line[j]] || 0) + 1;
    var pays = BR.CONFIG.pays[res.line[i]];
    return !!pays && (pays[(counts[res.line[i]] || 0) + 1] || 0) >= 20;
  }

  /* ------------------------------------------------------------ リーチ --- */
  function anticipate(i) {
    if (!J) return;
    antic.count++;
    if (antic.reels.indexOf(i) < 0) antic.reels.push(i);
    setMode('antic');
    $('#reels').classList.add('antic');
    var first = antic.count === 1;
    J.banner(first ? 'チャンス！' : '激アツ！！', first ? 'chance' : 'hot', 1250);
    BR.sfx.play('chance');
    var box = reelBox();
    J.flash(first ? '#ffb347' : '#ff5a3a', first ? 0.22 : 0.32, 300);
    J.ring(box.cx, box.cy, { r0: 80, r1: 700, dur: 0.6, w: 10, sy: 0.6, color: first ? 'fire' : 'red' });
    clearInterval(antic.timer);
    var tick = 0;
    antic.timer = setInterval(function () {
      tick++;
      antic.reels.forEach(function (k) {
        var t = cell(k, 0), b = cell(k, 2);
        var x = t.x, y0 = t.y - CELL_H / 2, y1 = b.y + CELL_H / 2;
        var side = tick % 2 ? -1 : 1;
        J.sparks(x + side * 96, U.rand(y0, y1), { n: 3, speed: 260, dir: -Math.PI / 2, spread: 0.5, life: 0.7, g: -500, color: 'fire', size: 1.1 });
        J.sparks(x + U.rand(-80, 80), y1, { n: 2, speed: 300, dir: -Math.PI / 2, spread: 0.3, life: 0.8, g: -700, color: 'fire' });
        if (tick % 5 === 0) {
          var yy = U.rand(y0 + 40, y1 - 40);
          J.bolt(x - 100, U.rand(y0, y1), x + 100, yy, { amp: 34, dur: 0.22, w: 3, color: tick % 10 ? 'gold' : 'blue' });
        }
      });
    }, 70);
  }
  function stopAntic() {
    clearInterval(antic.timer);
    antic.timer = 0;
    antic.reels = [];
    var r = $('#reels');
    if (r) r.classList.remove('antic');
  }

  // every reel has stopped
  function stopped(win) {
    stopAntic();
    antic.count = 0;
    if (!win) setMode('idle');
  }

  /* ------------------------------------------------------------ wins --- */
  // A win on the pay line: the marquee flashes, coins jump out of the winning
  // symbols and the WIN box lights up. Returns the middle of the winning
  // symbols (where the coins for the wallet start from).
  function win(res, cols) {
    if (!J) return null;
    var big = res.tier >= 2;
    setMode(big ? 'big' : 'win', big ? 9000 : 2600);
    var sx = 0, sy = 0;
    cols.forEach(function (c, k) {
      var p = cell(c, 1);
      sx += p.x; sy += p.y;
      var d = k * 0.06;
      J.ring(p.x, p.y, { r0: 30, r1: 170, dur: 0.5, w: 9, delay: d });
      J.bloom(p.x, p.y, { size: 320, dur: 0.6, delay: d });
      J.sparks(p.x, p.y, { n: big ? 20 : 14, speed: 720, life: 0.8, g: 700, delay: d });
      J.stars(p.x, p.y, { n: 3, r: 80, size: 70, delay: d });
      if (!big) J.coins(p.x, p.y - 20, { n: 4, pic: 'chip', speed: 760, size: 44, life: 1.1, delay: d });
    });
    var mid = cols.length ? { x: sx / cols.length, y: sy / cols.length } : reelBox();
    if (!big) {
      var w = J.at('.win-box');
      J.ring(w.x, w.y, { r0: 30, r1: 300, dur: 0.55, w: 8, sy: 0.4, delay: 0.15 });
      J.sparks(w.x, w.y - 20, { n: 16, speed: 620, dir: -Math.PI / 2, spread: 1.1, life: 0.8, g: 700, delay: 0.15, jx: 160 });
      J.bump('.win-box', 1.12);
    }
    return mid;
  }

  BR.slotfx = {
    init: init,
    spinStart: spinStart,
    land: land,
    anticipate: anticipate,
    stopped: stopped,
    win: win,
    setMode: setMode,
    cell: cell
  };
})(window.BR = window.BR || {});
