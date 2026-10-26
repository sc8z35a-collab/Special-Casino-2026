/* The slot machine's own show, called from js/main.js: a flash of light
   across the reels and a burst off the SPIN button at the start, sparks and
   light where each reel lands, the リーチ banner with sparks and lightning
   off the reel that slows down, and coins jumping out of the winning
   symbols; the curtains that open on it from the title screen and the
   symbols that catch the light while nothing happens. The bulbs round the
   reels are still (they never light up) and the machine itself never
   moves. Every part has its switch in 演出設定 (js/core/effects.js). Drawn
   with js/render/juice.js and css/juice.css. */
(function (BR) {
  'use strict';

  var U = BR.util, J;
  var $ = U.$;
  var VIEW_W = 1006, VIEW_H = 554;
  var COL_PITCH = 202.67, COL_C0 = 98, ROW_PITCH = 186, CELL_H = 182;

  var sweep = null;
  var antic = { timer: 0, reels: [], count: 0, queued: [] };

  // 演出設定: is this part of the show on?
  function fxOn(k) { return !BR.fx || BR.fx.on(k); }

  function init() {
    J = BR.juice;
    var reels = $('#reels');
    sweep = document.createElement('div');
    sweep.className = 'reel-sweep';
    reels.appendChild(sweep);
    // coming in from the title screen, the curtains open and the machine powers up
    BR.screens.onChange(function (name, prev) {
      if (name !== 'slot' || prev !== 'start' || !J || !fxOn('curtain')) return;
      curtains();
      setTimeout(powerOn, 520);
    });
    setTimeout(glints, 4000);
  }

  // Red velvet curtains over the whole stage gather to the sides, their hems
  // swinging behind, and the valance goes up; the buttons pop in as they are
  // uncovered (css/juice.css). No sound: the casino opens quietly.
  function curtains() {
    var stage = $('#stage');
    var c = document.createElement('div');
    c.className = 'curtain';
    c.setAttribute('aria-hidden', 'true');
    ['cl', 'cr', 'cv'].forEach(function (k) {
      var i = document.createElement('i');
      i.className = k;
      c.appendChild(i);
    });
    stage.appendChild(c);
    stage.classList.add('jc-curtain');
    setTimeout(function () { stage.classList.remove('jc-curtain'); }, 1500);
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 1700);
  }

  // While nothing happens, now and then a symbol catches the light (the
  // shiny ones more often).
  var SHINE = { seven: 3, statue: 3, bar: 2, diamond: 3, star: 2, gold: 2, revolver: 1 };
  function glints() {
    setTimeout(glints, U.rand(1700, 3300));
    var g = BR.game, reels = BR.app && BR.app.reels;
    if (!J || !fxOn('glint') || document.hidden || !reels || !g || g.busy() || BR.screens.current() !== 'slot' ||
      document.querySelector('#stage > .modal:not([hidden])')) return;
    var grid = reels.getGrid(), spots = [];
    for (var c = 0; c < 5; c++) for (var r = 0; r < 3; r++) for (var k = 0; k < (SHINE[grid[c][r]] || 1); k++) spots.push([c, r]);
    var at = spots[Math.floor(Math.random() * spots.length)], p = cell(at[0], at[1]);
    J.glint(p.x + U.rand(-46, 46), p.y + U.rand(-56, 30), U.rand(52, 105), U.rand(0.45, 0.9));
  }

  // light sweeps the reels, sparks fly off the frame's corners
  function powerOn() {
    if (!J || BR.screens.current() !== 'slot' || (BR.game && BR.game.busy())) return;
    sweepReels();
    var b = reelBox();
    [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(function (p, k) {
      J.sparks(p[0], p[1], { n: 10, speed: 520, life: 0.7, g: 400, delay: 0.1 + k * 0.08 });
      J.stars(p[0], p[1], { n: 2, r: 30, size: 80, delay: 0.1 + k * 0.08 });
    });
  }
  function sweepReels() {
    if (!sweep) return;
    sweep.classList.remove('go');
    void sweep.offsetWidth;
    sweep.classList.add('go');
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
    if (!J || !fxOn('spin')) return;
    var b = J.at('#btn-spin');
    J.ring(b.x, b.y, { r0: 70, r1: 230, dur: 0.5, w: 12 });
    J.ring(b.x, b.y, { r0: 60, r1: 320, dur: 0.7, w: 5, delay: 0.06, color: 'white' });
    J.sparks(b.x, b.y, { n: 22, speed: 900, life: 0.7, g: 300, jx: 60, jy: 60 });
    J.bloom(b.x, b.y, { size: 420, dur: 0.45, a: 0.7 });
    sweepReels();
  }

  // reel i comes to rest (the machine does not move: only light and sparks)
  function land(i) {
    if (!J) return;
    // landed before its リーチ moment came: that moment is gone
    var qi = antic.queued.indexOf(i);
    if (qi >= 0) antic.queued.splice(qi, 1);
    var last = i === 4;
    var top = cell(i, 0), bot = cell(i, 2);
    var y0 = top.y - CELL_H / 2, y1 = bot.y + CELL_H / 2;
    if (fxOn('spin')) {
      J.sparks(top.x, y1 - 6, { n: last ? 16 : 9, speed: 480, dir: -Math.PI / 2, spread: 1.2, life: 0.55, g: 900, jx: 70, color: 'gold' });
      J.sparks(top.x, y0 + 6, { n: last ? 10 : 6, speed: 380, dir: Math.PI / 2, spread: 1.1, life: 0.45, g: -200, jx: 70, color: 'white' });
      J.bloom(top.x, y1, { size: 260, sy: 0.35, dur: 0.35, a: 0.7 });
      J.bloom(top.x, y0, { size: 220, sy: 0.35, dur: 0.3, a: 0.5 });
    }
    reveal(i);
    if (antic.reels.indexOf(i) >= 0) {
      // (switched off in the meantime: the moment just ends)
      if (fxOn('reach')) anticLanded(i, top.x, y0, y1);
      antic.reels.splice(antic.reels.indexOf(i), 1);
      if (!antic.reels.length) {
        var next = antic.queued.shift();
        stopAntic();
        if (next !== undefined) setTimeout(function () { startAntic(next); }, 260);
      }
    }
  }

  /* What the reel that just landed adds to the pay line: a 7, a BAR or the
     statue landing gets its own burst; a symbol that now pays (or pays
     more) lights up in all its places with a bell a step higher for every
     one of a kind, and stays framed until the win is shown. */
  var PREMIUM = { seven: 'red', bar: 'green', statue: 'white' };
  function reveal(i) {
    var res = BR.game && BR.game.result;
    if (!res || !res.line || !BR.app || !BR.app.reels || !fxOn('line')) return;
    var line = res.line, s = line[i], pays = BR.CONFIG.pays;
    var p = cell(i, 1);
    if (PREMIUM[s]) {
      if (s === 'statue') {
        // a pillar of light comes down on her
        J.bloom(p.x, p.y, { size: 420, sy: 2.2, dur: 0.8, a: 0.9 });
        J.stars(p.x, p.y, { n: 6, r: 110, size: 90, life: 1.1 });
        J.sparks(p.x, p.y - 60, { n: 14, speed: 260, dir: Math.PI / 2, spread: 0.4, life: 0.9, g: 200, color: 'white', jx: 60 });
      } else {
        J.ring(p.x, p.y, { r0: 30, r1: 150, dur: 0.45, w: 8, color: PREMIUM[s] });
        J.sparks(p.x, p.y, { n: 14, speed: 520, life: 0.6, g: 500, color: s === 'seven' ? 'fire' : 'green' });
      }
      BR.sfx.play('premium', s);
    }
    var cols = [];
    for (var j = 0; j <= i; j++) if (line[j] === s) cols.push(j);
    if (!pays[s] || !pays[s][cols.length]) return;
    // every symbol paying so far stays framed
    var framed = [];
    Object.keys(pays).forEach(function (sym) {
      var c = [];
      for (var k = 0; k <= i; k++) if (line[k] === sym) c.push(k);
      if (pays[sym][c.length]) framed = framed.concat(c);
    });
    BR.app.reels.preview(framed);
    cols.forEach(function (c, k) {
      var q = cell(c, 1);
      J.ring(q.x, q.y, { r0: 40, r1: 130 + cols.length * 20, dur: 0.45, w: 6 + cols.length, delay: k * 0.04 });
      J.sparks(q.x, q.y, { n: 6 + cols.length * 2, speed: 420, life: 0.55, g: 400, delay: k * 0.04 });
    });
    BR.sfx.play('match', cols.length);
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
  // the slowed reel x (its top y0, its bottom y1) has landed
  function anticLanded(i, x, y0, y1) {
    var mid = (y0 + y1) / 2;
    if (awaited(i)) {
      // what it was waiting for: the reel explodes in fire
      J.ring(x, mid, { r0: 40, r1: 420, dur: 0.6, w: 14, sy: 1.4, color: 'fire' });
      J.ring(x, mid, { r0: 30, r1: 700, dur: 0.8, w: 6, sy: 1.1, color: 'white', delay: 0.06 });
      J.sparks(x, mid, { n: 46, speed: 1100, life: 0.9, g: 600, jx: 80, jy: 200, color: 'fire' });
      J.bloom(x, mid, { size: 640, sy: 1.3, dur: 0.6 });
      J.flash('#ffd27a', 0.42, 320);
    } else {
      // it did not come: the fire goes out in smoke
      J.ring(x, mid, { r0: 40, r1: 260, dur: 0.45, w: 8, sy: 1.4, color: 'fire' });
      J.smoke(x, y0 + 40, y1, { n: 16 });
      BR.sfx.play('miss');
    }
  }
  function anticipate(i) {
    if (!J || !fxOn('reach')) return;
    // the reel before is still on its way: this one's moment comes after it lands
    if (antic.reels.length) { antic.queued.push(i); return; }
    startAntic(i);
  }
  function startAntic(i) {
    antic.count++;
    if (antic.reels.indexOf(i) < 0) antic.reels.push(i);
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
      if (!fxOn('reach')) return;
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
    antic.queued = [];
    var r = $('#reels');
    if (r) r.classList.remove('antic');
  }

  // every reel has stopped
  function stopped() {
    stopAntic();
    antic.count = 0;
  }

  /* ------------------------------------------------------------ wins --- */
  // A win on the pay line: light bursts out of the winning symbols, lightning
  // links them and the WIN box lights up. Returns the middle of the winning
  // symbols (where the coins for the wallet start from).
  function win(res, cols) {
    if (!J) return null;
    var big = res.tier >= 2, burst = fxOn('symbols');
    var sx = 0, sy = 0;
    cols.forEach(function (c, k) {
      var p = cell(c, 1);
      sx += p.x; sy += p.y;
      if (!burst) return;
      var d = k * 0.06;
      J.ring(p.x, p.y, { r0: 30, r1: 170, dur: 0.5, w: 9, delay: d });
      J.bloom(p.x, p.y, { size: 320, dur: 0.6, delay: d });
      J.sparks(p.x, p.y, { n: big ? 20 : 14, speed: 720, life: 0.8, g: 700, delay: d });
      J.stars(p.x, p.y, { n: 3, r: 80, size: 70, delay: d });
      if (!big) J.coins(p.x, p.y - 20, { n: 4, pic: 'chip', speed: 760, size: 44, life: 1.1, delay: d });
    });
    var mid = cols.length ? { x: sx / cols.length, y: sy / cols.length } : reelBox();
    // lightning links the winning symbols, twice
    var linked = fxOn('line') ? cols.slice().sort(function (a, b) { return a - b; }) : [];
    for (var k = 1; k < linked.length; k++) {
      var a = cell(linked[k - 1], 1), b = cell(linked[k], 1);
      J.bolt(a.x, a.y, b.x, b.y, { amp: 26, segs: 9, dur: 0.38, w: 3, color: 'gold', delay: 0.12 + k * 0.06 });
      J.bolt(a.x, a.y, b.x, b.y, { amp: 20, segs: 9, dur: 0.3, w: 2, color: 'white', delay: 0.7 + k * 0.06 });
    }
    if (!big && fxOn('combo')) {
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
    cell: cell
  };
})(window.BR = window.BR || {});
