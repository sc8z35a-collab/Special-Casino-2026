/* The fire, in 3D: the vault's 3D row of flames (横長炎上), rendered and set
   moving (waves rising through it, its tongues stretching and shrinking:
   tools/art/art_3d.py), 24 frames that loop (img/ui/fire.webp, 4 x 6
   frames). The FEVER's flames along the bottom of the screen and the 7's
   flames when it wins draw from it, a row of them side by side (overlapping,
   every other one turned round, each at its own point of the loop); until it
   is in (or offline in the one-file game), the drawn flames stay. */
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

  // flames in the box x, y (the top), w x h; `tile`: the width of one row of flames (more side by side to fill it)
  function draw(g, x, y, w, h, t, tile) {
    var s = sheet();
    if (!s) return false;
    var fw = s.width / COLS, fh = s.height / (FRAMES / COLS);
    tile = Math.min(tile || w, w);
    // overlapping by a quarter, their ends (where the flames thin out) under the next one's
    var n = Math.max(1, Math.ceil((w - tile) / (tile * 0.75)) + 1), step = n > 1 ? (w - tile) / (n - 1) : 0;
    for (var i = 0; i < n; i++) {
      var f = (frameAt(t) + i * 7) % FRAMES, px = x + i * step;
      var sx = (f % COLS) * fw, sy = Math.floor(f / COLS) * fh;
      if (i % 2) {
        g.save();
        g.translate(px + tile, y);
        g.scale(-1, 1);
        g.drawImage(s, sx, sy, fw, fh, 0, 0, tile, h);
        g.restore();
      } else g.drawImage(s, sx, sy, fw, fh, px, y, tile, h);
    }
    return true;
  }

  /* The FEVER's flames along the bottom of `host` (a canvas of its own, two
     rows out of step for depth, put before `before` so what comes after it
     stays in front; `mark` gets .three once they burn, for the drawn ones to
     go); stop() takes it away. */
  function row(host, height, before, mark) {
    var c = document.createElement('canvas');
    c.className = 'fv-fire';
    host.insertBefore(c, before || null);
    mark = mark || host;
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
      if (last < 0) mark.classList.add('three');
      last = f;
      if (c.width !== Math.round(host.clientWidth)) size();
      g.clearRect(0, 0, c.width, c.height);
      // behind: smaller, dimmer, a beat later; in front: the full flames
      g.globalAlpha = 0.75;
      draw(g, -120, c.height * 0.3, c.width + 240, c.height * 0.7, t + 0.47, 420);
      g.globalAlpha = 1;
      draw(g, -60, 0, c.width + 120, c.height, t, 640);
    }
    raf = requestAnimationFrame(tick);
    return {
      node: c,
      stop: function () { cancelAnimationFrame(raf); if (c.parentNode) c.parentNode.removeChild(c); }
    };
  }

  BR.fire3d = { sheet: sheet, draw: draw, row: row };
})(window.BR = window.BR || {});
