/* The fire, in 3D: a row of flames rendered as a volume (ray-marched 3D
   turbulence rising through it: tools/3d/render-fire.html), 24 frames that
   loop, each tiling sideways (img/ui/fire.webp, 4 x 6 frames). The FEVER's
   flames along the bottom of the screen and the 7's flames when it wins draw
   from it; until it is in (or offline in the one-file game), the drawn
   flames stay. */
(function (BR) {
  'use strict';

  var COLS = 4, FRAMES = 24, FPS = 24;
  var img = null, loading = false;

  // the sheet, once in (it starts loading on the first ask)
  function sheet() {
    if (!img && !loading && BR.UI_IMG && BR.UI_IMG.fire) {
      loading = true;
      var im = new Image();
      im.onload = function () { img = im; };
      im.onerror = function () { loading = false; };
      im.src = BR.UI_IMG.fire;
    }
    return img;
  }
  // the frame at `t` seconds
  function frameAt(t) { return Math.floor(t * FPS) % FRAMES; }

  // flames in the box x, y (the top), w x h; `tile`: one frame's width (they repeat sideways)
  function draw(g, x, y, w, h, t, tile) {
    var s = sheet();
    if (!s) return false;
    var f = frameAt(t), fw = s.width / COLS, fh = s.height / (FRAMES / COLS);
    var sx = (f % COLS) * fw, sy = Math.floor(f / COLS) * fh;
    tile = tile || w;
    for (var px = x; px < x + w; px += tile) {
      var cw = Math.min(tile, x + w - px);
      g.drawImage(s, sx, sy, fw * cw / tile, fh, px, y, cw, h);
    }
    return true;
  }

  /* The FEVER's flames along the bottom of `host` (a canvas of its own, two
     rows out of step for depth; `host` gets .three once they burn, for the
     drawn ones to go); stop() takes it away. */
  function row(host, height) {
    var c = document.createElement('canvas');
    c.className = 'fv-fire';
    host.appendChild(c);
    var g = c.getContext('2d'), raf = 0, last = -1, t0 = performance.now();
    function size() {
      c.width = Math.max(1, Math.round(host.clientWidth));
      c.height = Math.round(height);
    }
    size();
    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      var t = (now - t0) / 1000, f = Math.floor(t * FPS);
      if (f === last || !sheet()) return;
      if (last < 0) host.classList.add('three');
      last = f;
      if (c.width !== Math.round(host.clientWidth)) size();
      g.clearRect(0, 0, c.width, c.height);
      // behind: smaller, dimmer, a beat later; in front: the full flames
      g.globalAlpha = 0.7;
      draw(g, -90, c.height * 0.28, c.width + 180, c.height * 0.72, t + 0.47, 300);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
      draw(g, -40, 0, c.width + 80, c.height, t, 420);
      g.globalCompositeOperation = 'source-over';
    }
    raf = requestAnimationFrame(tick);
    return {
      node: c,
      stop: function () { cancelAnimationFrame(raf); if (c.parentNode) c.parentNode.removeChild(c); }
    };
  }

  BR.fire3d = { sheet: sheet, draw: draw, row: row };
})(window.BR = window.BR || {});
