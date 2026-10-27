/* Rasterises the vector art into canvases at device resolution, including
   motion-blurred variants used while the reels spin fast. */
(function (BR) {
  'use strict';

  var CELL_W = 192, CELL_H = 182;
  var cache = {};

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }
  function loadSVG(svg) { return loadImage(BR.svgURL(svg)); }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // Vertical motion blur by accumulating shifted copies (box kernel).
  function motionBlur(src, amount) {
    var pad = Math.ceil(amount);
    var c = makeCanvas(src.width, src.height + pad * 2);
    var ctx = c.getContext('2d');
    var n = Math.max(8, Math.min(28, Math.round(amount / 2)));
    // additive accumulation of 1/n weighted copies == exact box filter
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1 / n;
    for (var i = 0; i < n; i++) {
      var dy = pad + (i / (n - 1) - 0.5) * amount;
      ctx.drawImage(src, 0, dy);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    c.pad = pad;
    return c;
  }

  /* Builds every symbol at `pxPerUnit` device pixels per design px.
     Returns a promise of { sharp: {id: canvas}, blur1: {...}, blur2: {...}, glow: {...} } */
  function buildSymbols(pxPerUnit) {
    var key = 'sym@' + pxPerUnit.toFixed(3);
    if (cache[key]) return cache[key];
    var w = CELL_W * pxPerUnit, h = CELL_H * pxPerUnit;
    var ids = Object.keys(BR.SYMBOL_IMG);
    cache[key] = Promise.all(ids.map(function (id) {
      return loadImage(BR.SYMBOL_IMG[id]).then(function (img) {
        var c = makeCanvas(w, h), g = c.getContext('2d');
        // soft contact shadow on the cream reel, as in the reference
        g.shadowColor = 'rgba(70, 35, 5, 0.38)';
        g.shadowBlur = 5 * pxPerUnit;
        g.shadowOffsetY = 3 * pxPerUnit;
        g.drawImage(img, 0, 0, c.width, c.height);
        return [id, c];
      });
    })).then(function (pairs) {
      var out = { sharp: {}, blur1: {}, blur2: {}, w: w, h: h, unit: pxPerUnit };
      pairs.forEach(function (p) {
        out.sharp[p[0]] = p[1];

      });
      var pending = Object.keys(out.sharp);
      out.prepareBlur = function () {
        function one() {
          var id = pending.shift(); if (!id) return;
          out.blur1[id] = motionBlur(out.sharp[id], 26 * pxPerUnit);
          out.blur2[id] = motionBlur(out.sharp[id], 70 * pxPerUnit);
          if (pending.length) setTimeout(one, 0);
        }
        out.prepareBlur = function () {}; setTimeout(one, 0);
      };
      return out;
    });
    return cache[key];
  }

  /* A symbol's full 3D turn (BR.SYMBOL_TURN): { img, fw, fh, cols, frames }
     once its sheet is in, null until then (it starts loading on the first
     ask). A sheet nobody asked for in 20 s is let go (it is big). */
  var turns = {};
  function turn(id) {
    var t = turns[id];
    if (!t) {
      var src = BR.SYMBOL_TURN && BR.SYMBOL_TURN[id];
      if (!src) return null;
      t = turns[id] = { sheet: null, used: 0 };
      loadImage(src).then(function (img) {
        var S = BR.SYMBOL_TURN_SHEET;
        t.sheet = { img: img, cols: S.cols, frames: S.frames, fw: img.width / S.cols, fh: img.height / Math.ceil(S.frames / S.cols), pad: S.pad };
      }, function () { t.failed = true; });
    }
    t.used = Date.now();
    return t.sheet;
  }
  setInterval(function () {
    var now = Date.now();
    Object.keys(turns).forEach(function (k) { if (turns[k].sheet && now - turns[k].used > 20000) delete turns[k]; });
  }, 10000);
  // the reel window's panels (its 3D model's), once loaded
  var reelBack = null;
  function backImage() {
    if (!reelBack && BR.UI_IMG && BR.UI_IMG.reelBack) reelBack = loadImage(BR.UI_IMG.reelBack);
    return reelBack;
  }

  // Generic: render an svg string to a canvas of w x h device px.
  function rasterize(svg, w, h) {
    return loadSVG(svg).then(function (img) {
      var c = makeCanvas(w, h);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    });
  }

  BR.assets = { buildSymbols: buildSymbols, rasterize: rasterize, makeCanvas: makeCanvas, turn: turn, backImage: backImage, CELL_W: CELL_W, CELL_H: CELL_H };
})(window.BR = window.BR || {});
