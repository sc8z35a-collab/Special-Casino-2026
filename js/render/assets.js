/* Rasterises the vector art into canvases at device resolution, including
   motion-blurred variants used while the reels spin fast. */
(function (BR) {
  'use strict';

  var CELL_W = 192, CELL_H = 182;
  var cache = {};

  function loadSVG(svg) { return BR.backdrop.loadImage(BR.svgURL(svg)); }

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
      return BR.backdrop.loadImage(BR.SYMBOL_IMG[id]).then(function (img) {
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
        out.blur1[p[0]] = motionBlur(p[1], 26 * pxPerUnit);
        out.blur2[p[0]] = motionBlur(p[1], 70 * pxPerUnit);
      });
      return out;
    });
    return cache[key];
  }

  // Generic: render an svg string to a canvas of w x h device px.
  function rasterize(svg, w, h) {
    return loadSVG(svg).then(function (img) {
      var c = makeCanvas(w, h);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    });
  }

  BR.assets = { buildSymbols: buildSymbols, rasterize: rasterize, makeCanvas: makeCanvas, CELL_W: CELL_W, CELL_H: CELL_H };
})(window.BR = window.BR || {});
