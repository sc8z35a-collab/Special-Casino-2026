/* 5x3 reel window rendered on a canvas: spin physics (kick, acceleration,
   motion blur, staggered stops with overshoot), anticipation and win
   highlighting.  Units are design px; `res` maps them to device px. */
(function (BR) {
  'use strict';

  var U = BR.util;
  var VIEW_W = 1006, VIEW_H = 554;
  // column centres / separators measured from the reference screen
  var COL_W = 192, COL_PITCH = 202.67, COL_C0 = 98, CELL_VIS = 183;
  var CELL_H = 182, ROW_PITCH = 186;
  var VMAX = 4600;            // px/s at full speed (~25 symbols per second)
  var STOP_S = 0.85;          // overshoot parameter of the stop curve

  function colC(i) { return COL_C0 + i * COL_PITCH; }
  function colX(i) { return colC(i) - COL_W / 2; }

  // outBack-style stop curve and its derivative at 0
  function stopCurve(u) { var x = u - 1; return 1 + (STOP_S + 1) * x * x * x + STOP_S * x * x; }
  var STOP_SLOPE = STOP_S + 3;
  var STOP_LAND = 1 - STOP_S / (STOP_S + 1);   // u where the target is first reached

  function Reel(i, owner) {
    this.i = i;
    this.owner = owner;
    this.buf = [];
    for (var k = 0; k < 5; k++) this.buf.push(BR.engine.drawSymbol());
    this.off = 0;
    this.v = 0;
    this.phase = 'idle';
    this.queue = [];
    this.t = 0;
    this.plan = null;
    this.anticipate = false;
  }

  Reel.prototype.next = function () {
    return this.queue.length ? this.queue.shift() : BR.engine.drawSymbol();
  };

  Reel.prototype.advance = function (d) {
    this.off += d;
    while (this.off >= ROW_PITCH) {
      this.off -= ROW_PITCH;
      this.buf.pop();
      this.buf.unshift(this.next());
    }
  };

  Reel.prototype.start = function (delay) {
    this.phase = 'wait';
    this.t = -delay;
    this.v = 0;
    this.queue = [];
    this.plan = null;
    this.landed = false;
    this.anticipate = false;
  };

  Reel.prototype.requestStop = function (col, quick) {
    if (this.phase === 'stop' || this.phase === 'idle') return;
    if (this.phase === 'wait' || this.phase === 'kick') { this.pendingStop = { col: col, quick: quick }; return; }
    this.queue = [col[2], col[1], col[0], BR.engine.drawSymbol()];
    var D = (ROW_PITCH - this.off) + 3 * ROW_PITCH;
    var v = Math.max(this.v, 1200);
    this.plan = { D: D, T: D * STOP_SLOPE / v, t: 0, done: 0 };
    this.phase = 'stop';
  };

  Reel.prototype.update = function (dt) {
    var p = this.phase;
    if (p === 'idle') return false;
    this.t += dt;
    if (p === 'wait') {
      if (this.t >= 0) { this.phase = 'kick'; this.t = 0; this.kickBase = this.off; }
      return true;
    }
    if (p === 'kick') {
      // small upward wind-up before the reel takes off
      var K = 0.13;
      var u = Math.min(1, this.t / K);
      var target = -13 * Math.sin(Math.PI * u);
      this.off = this.kickBase + target;
      if (u >= 1) {
        this.off = this.kickBase;
        this.phase = 'accel';
        this.t = 0;
        this.v = 320;
        if (this.pendingStop && this.pendingStop.quick) { /* keep accelerating briefly */ }
      }
      return true;
    }
    if (p === 'accel' || p === 'run' || p === 'slow') {
      var vmax = this.anticipate ? VMAX * 0.62 : VMAX;
      if (p === 'accel') {
        var a = Math.min(1, this.t / 0.26);
        this.v = 320 + (vmax - 320) * a * a;
        if (a >= 1) { this.phase = 'run'; }
      } else {
        // ease towards the (possibly reduced) target speed
        this.v += (vmax - this.v) * Math.min(1, dt * 5);
      }
      this.advance(this.v * dt);
      if (this.pendingStop && this.phase === 'run') {
        var ps = this.pendingStop; this.pendingStop = null;
        this.requestStop(ps.col, ps.quick);
      }
      return true;
    }
    if (p === 'stop') {
      var pl = this.plan;
      pl.t += dt;
      var uu = Math.min(1, pl.t / pl.T);
      var pos = pl.D * stopCurve(uu);
      var delta = pos - pl.done;
      pl.done = pos;
      if (delta >= 0) this.advance(delta);
      else this.off += delta;            // settling back after the overshoot
      this.v = Math.abs(delta) / Math.max(dt, 1e-4);
      if (!this.landed && uu >= STOP_LAND) {
        this.landed = true;
        this.owner.emit('land', this.i);
      }
      if (uu >= 1) {
        // float safety: finish any wrap that rounding left pending
        while (this.queue.length) { this.buf.pop(); this.buf.unshift(this.queue.shift()); }
        this.off = 0;
        this.v = 0;
        this.anticipate = false;
        this.phase = 'idle';
        this.owner.onReelStopped(this.i);
      }
      return true;
    }
    return false;
  };

  function Reels(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.res = 1;
    this.sprites = null;
    this.handlers = {};
    this.reels = [];
    for (var i = 0; i < 5; i++) this.reels.push(new Reel(i, this));
    this.hl = null;
    this.antic = [];
    this.dirty = true;
    this.running = false;
    this.last = 0;
    this.dim = 0;
    var self = this;
    this._loop = function (t) { self.frame(t); };
  }

  Reels.prototype.on = function (ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); };
  Reels.prototype.emit = function (ev, arg) { (this.handlers[ev] || []).forEach(function (f) { f(arg); }); };

  // Set the visible grid without animation (grid[reel][row]).
  Reels.prototype.setGrid = function (grid) {
    this.reels.forEach(function (r, i) {
      r.buf = [BR.engine.drawSymbol(), grid[i][0], grid[i][1], grid[i][2], BR.engine.drawSymbol()];
      r.off = 0;
    });
    this.invalidate();
  };

  // The visible grid (grid[reel][row]) while the reels stand still.
  Reels.prototype.getGrid = function () {
    return this.reels.map(function (r) { return [r.buf[1], r.buf[2], r.buf[3]]; });
  };

  Reels.prototype.resize = function (res) {
    var self = this;
    this.res = res;
    this.canvas.width = Math.round(VIEW_W * res);
    this.canvas.height = Math.round(VIEW_H * res);
    this.back = this.renderBack(res);
    this.front = this.renderFront(res);
    this.glow = this.renderGlow(res);
    return BR.assets.buildSymbols(res).then(function (sp) {
      if (self.res !== res) return;
      self.sprites = sp;
      self.invalidate();
    });
  };

  // Cream cells (static background of the window): every column is a
  // cylinder - warm peach at the edges, pale cream in the middle.
  Reels.prototype.renderBack = function (res) {
    var c = BR.assets.makeCanvas(VIEW_W * res, VIEW_H * res), g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, 0, 0);
    g.fillStyle = '#e8c49a';
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    var stops = [[0, '#e3c09a'], [0.035, '#f4d4ad'], [0.08, '#f9dbb9'], [0.125, '#fae0bf'], [0.17, '#fae2c6'],
      [0.215, '#f8e4cb'], [0.26, '#f7e5d1'], [0.31, '#f5e5d5'], [0.36, '#f4e8da'], [0.4, '#f5e8df'], [0.6, '#f5e8df'],
      [0.645, '#f5e8d8'], [0.69, '#f6e4d6'], [0.735, '#f7e2cf'], [0.78, '#fbe3c9'], [0.825, '#fbe1c6'],
      [0.87, '#f9dfbe'], [0.915, '#fadcba'], [0.96, '#f5d5ae'], [1, '#e3c09a']];
    for (var i = 0; i < 5; i++) {
      var x = colC(i) - CELL_VIS / 2;
      var h = g.createLinearGradient(x, 0, x + CELL_VIS, 0);
      stops.forEach(function (s) { h.addColorStop(s[0], s[1]); });
      g.fillStyle = h;
      g.fillRect(x, 0, CELL_VIS, VIEW_H);
    }
    return c;
  };

  // Separators, frame shadows and row seams drawn over the symbols.
  Reels.prototype.renderFront = function (res) {
    var c = BR.assets.makeCanvas(VIEW_W * res, VIEW_H * res), g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, 0, 0);
    var v = g.createLinearGradient(0, 0, 0, 14);
    v.addColorStop(0, 'rgba(70,40,15,0.42)');
    v.addColorStop(0.5, 'rgba(70,40,15,0.12)');
    v.addColorStop(1, 'rgba(70,40,15,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, VIEW_W, 14);
    v = g.createLinearGradient(0, VIEW_H - 16, 0, VIEW_H);
    v.addColorStop(0, 'rgba(70,40,15,0)');
    v.addColorStop(1, 'rgba(70,40,15,0.3)');
    g.fillStyle = v;
    g.fillRect(0, VIEW_H - 16, VIEW_W, 16);
    // row seams
    for (var r = 1; r < 3; r++) {
      var y = r * ROW_PITCH - 4;
      g.fillStyle = 'rgba(95,75,62,0.33)';
      g.fillRect(0, y, VIEW_W, 2);
      g.fillStyle = 'rgba(95,75,62,0.06)';
      g.fillRect(0, y + 2, VIEW_W, 2);
    }
    // gold column separators (profile sampled from the reference)
    var prof = [[-9.5, '#d7b58f'], [-8.5, '#a27e5a'], [-7.5, '#b79568'], [-6.5, '#cba66f'], [-5.5, '#d4ad72'], [-4.5, '#ddb480'],
      [-3.5, '#d9ad7e'], [-2.5, '#8f6439'], [-1.5, '#7b5121'], [-0.5, '#754c18'], [0.5, '#744b15'], [1.5, '#81582a'],
      [2.5, '#ad8456'], [3.5, '#deb985'], [4.5, '#dab580'], [5.5, '#ceaa76'], [6.5, '#c39f6f'], [7.5, '#b48f65'],
      [8.5, '#ba946d'], [9.5, '#e2c092']];
    for (var i = 0; i < 4; i++) {
      var cx = colC(i) + COL_PITCH / 2;
      var s = g.createLinearGradient(cx - 10, 0, cx + 10, 0);
      prof.forEach(function (p) { s.addColorStop((p[0] + 10) / 20, p[1]); });
      g.fillStyle = s;
      g.fillRect(cx - 10, 0, 20, VIEW_H);
    }
    return c;
  };

  // Soft golden glow sprite used behind winning symbols.
  Reels.prototype.renderGlow = function (res) {
    var s = 220, c = BR.assets.makeCanvas(s * res, s * res), g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, 0, 0);
    var r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,240,170,0.95)');
    r.addColorStop(0.35, 'rgba(255,200,80,0.6)');
    r.addColorStop(0.7, 'rgba(255,150,30,0.18)');
    r.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
    return c;
  };

  Reels.prototype.invalidate = function () {
    this.dirty = true;
    this.kick();
  };

  Reels.prototype.kick = function () {
    if (!this.running) {
      this.running = true;
      this.last = U.now();
      requestAnimationFrame(this._loop);
    }
  };

  Reels.prototype.isSpinning = function () {
    return this.reels.some(function (r) { return r.phase !== 'idle'; });
  };

  /* Start all reels.  Stops are scheduled by the caller via stopAll(). */
  Reels.prototype.spin = function () {
    this.clearHighlight();
    this.reels.forEach(function (r, i) { r.start(i * 0.045); });
    this.kick();
  };

  /* Schedule the stops for `grid` (grid[reel][row]).  `antic` = indices of
     reels that get the slow suspense treatment before stopping. */
  Reels.prototype.scheduleStops = function (grid, opts) {
    var self = this;
    opts = opts || {};
    var base = opts.base === undefined ? 0.95 : opts.base;
    var gap = opts.gap === undefined ? 0.23 : opts.gap;
    var antic = opts.antic || [];
    var extra = 0;
    this.pendingGrid = grid;
    this.stopTimers = [];
    this.reels.forEach(function (r, i) {
      if (antic.indexOf(i) >= 0) {
        var aStart = base + i * gap + extra;
        self.stopTimers.push(setTimeout(function () {
          r.anticipate = true;
          if (self.antic.indexOf(i) < 0) self.antic.push(i);
          self.emit('anticipate', i);
          self.kick();
        }, Math.max(0, aStart * 1000 - 120)));
        extra += 1.3;
      }
      var at = base + i * gap + extra;
      self.stopTimers.push(setTimeout(function () {
        r.requestStop(grid[i], false);
        self.emit('stopping', i);
      }, at * 1000));
    });
  };

  // Slam stop: everything that is still spinning stops right away.
  Reels.prototype.quickStop = function () {
    var self = this, grid = this.pendingGrid;
    if (!grid) return;
    (this.stopTimers || []).forEach(clearTimeout);
    this.stopTimers = [];
    var k = 0;
    this.reels.forEach(function (r, i) {
      if (r.phase !== 'stop' && r.phase !== 'idle') {
        r.anticipate = false;
        var delay = k++ * 0.06;
        self.stopTimers.push(setTimeout(function () { r.requestStop(grid[i], true); self.emit('stopping', i); }, delay * 1000));
      }
    });
    this.antic = [];
  };

  Reels.prototype.onReelStopped = function (i) {
    var k = this.antic.indexOf(i);
    if (k >= 0) this.antic.splice(k, 1);
    this.emit('stopped', i);
    if (!this.isSpinning()) {
      this.pendingGrid = null;
      this.emit('allstopped');
    }
  };

  Reels.prototype.setHighlight = function (cols, opts) {
    this.hl = { cols: cols, t0: U.now(), opts: opts || {} };
    this.invalidate();
  };
  Reels.prototype.clearHighlight = function () {
    this.hl = null;
    this.antic = [];
    this.invalidate();
  };

  Reels.prototype.frame = function () {
    // performance.now() rather than the rAF timestamp: the latter can be
    // older than times recorded by event handlers in the same frame.
    var now = U.now();
    var dt = U.clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    var moving = false;
    for (var i = 0; i < 5; i++) if (this.reels[i].update(dt)) moving = true;
    var more = moving || this.hl || this.antic.length;
    if (more) requestAnimationFrame(this._loop);
    else this.running = false;
    if (more || this.dirty) {
      this.dirty = false;
      try { this.draw(now); } catch (e) { if (window.console) console.warn(e); }
    }
  };

  Reels.prototype.draw = function (now) {
    var g = this.ctx, res = this.res, sp = this.sprites;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.back) g.drawImage(this.back, 0, 0);
    if (!sp) return;
    var hl = this.hl;
    var ht = hl ? Math.max(0, (now - hl.t0) / 1000) : 0;

    // pay line beam behind the symbols
    if (hl && hl.cols.length) {
      var a = Math.min(1, ht / 0.35);
      var y = (ROW_PITCH + CELL_H / 2) * res;
      g.save();
      g.globalCompositeOperation = 'lighter';
      var grd = g.createLinearGradient(0, y - 14 * res, 0, y + 14 * res);
      grd.addColorStop(0, 'rgba(255,190,60,0)');
      grd.addColorStop(0.5, 'rgba(255,220,120,' + (0.75 * a) + ')');
      grd.addColorStop(1, 'rgba(255,190,60,0)');
      g.fillStyle = grd;
      g.fillRect(0, y - 14 * res, VIEW_W * res * a, 28 * res);
      g.restore();
    }

    for (var i = 0; i < 5; i++) {
      var r = this.reels[i];
      var x = colX(i) * res;
      g.save();
      g.beginPath();
      g.rect(x, 0, COL_W * res, VIEW_H * res);
      g.clip();
      var v = r.v;
      var set = v > 3200 ? sp.blur2 : v > 1300 ? sp.blur1 : sp.sharp;
      var blurA = v > 1300 && v <= 3200 ? U.clamp((v - 1300) / 900, 0, 1) : 1;
      for (var k = 0; k < 5; k++) {
        var yy = ((k - 1) * ROW_PITCH + r.off);
        if (yy > VIEW_H || yy + CELL_H < 0) continue;
        var sym = r.buf[k];
        var row = k - 1;
        var win = hl && r.phase === 'idle' && row === 1 && hl.cols.indexOf(i) >= 0;
        if (win) {
          var pulse = 0.5 + 0.5 * Math.sin(ht * Math.PI * 2 * 1.3 - Math.PI / 2);
          var ga = Math.min(1, ht / 0.25) * (0.55 + 0.35 * pulse);
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = ga;
          var gs = 250 * res;
          g.drawImage(this.glow, x + (COL_W * res - gs) / 2, (yy + CELL_H / 2) * res - gs / 2, gs, gs);
          g.restore();
          var sc = 1 + 0.07 * pulse * Math.min(1, ht / 0.25);
          var cx = x + COL_W * res / 2, cy = (yy + CELL_H / 2) * res;
          g.drawImage(sp.sharp[sym], cx - COL_W * res * sc / 2, cy - CELL_H * res * sc / 2, COL_W * res * sc, CELL_H * res * sc);
          continue;
        }
        if (set === sp.sharp) {
          g.drawImage(sp.sharp[sym], Math.round(x), Math.round(yy * res));
        } else {
          var bimg = set[sym];
          if (blurA < 1) {
            g.globalAlpha = 1 - blurA;
            g.drawImage(sp.sharp[sym], x, yy * res);
            g.globalAlpha = blurA;
          }
          g.drawImage(bimg, x, yy * res - bimg.pad);
          g.globalAlpha = 1;
        }
      }
      // dim the non-winning cells while a win is shown
      if (hl && r.phase === 'idle') {
        var da = Math.min(1, ht / 0.3) * 0.42;
        g.fillStyle = 'rgba(35,8,0,' + da + ')';
        for (var rr = 0; rr < 3; rr++) {
          if (rr === 1 && hl.cols.indexOf(i) >= 0) continue;
          g.fillRect(x, rr * ROW_PITCH * res, COL_W * res, CELL_H * res);
        }
      }
      // anticipation: pulsing light around the reel that is still spinning
      if (this.antic.indexOf(i) >= 0 && r.phase !== 'idle') {
        var ap = 0.5 + 0.5 * Math.sin(now / 1000 * Math.PI * 4);
        g.globalCompositeOperation = 'lighter';
        var ag = g.createLinearGradient(x, 0, x + COL_W * res, 0);
        ag.addColorStop(0, 'rgba(255,170,40,' + (0.55 + 0.3 * ap) + ')');
        ag.addColorStop(0.18, 'rgba(255,170,40,0)');
        ag.addColorStop(0.82, 'rgba(255,170,40,0)');
        ag.addColorStop(1, 'rgba(255,170,40,' + (0.55 + 0.3 * ap) + ')');
        g.fillStyle = ag;
        g.fillRect(x, 0, COL_W * res, VIEW_H * res);
        g.globalCompositeOperation = 'source-over';
      }
      g.restore();
    }

    if (this.front) g.drawImage(this.front, 0, 0);

    // animated gold frames around winning cells
    if (hl && hl.cols.length) {
      var fa = Math.min(1, ht / 0.2);
      g.save();
      g.setTransform(res, 0, 0, res, 0, 0);
      for (var j = 0; j < hl.cols.length; j++) {
        var ci = hl.cols[j];
        if (this.reels[ci].phase !== 'idle') continue;
        var fx = colC(ci) - CELL_VIS / 2 + 3, fy = ROW_PITCH + 3, fw = CELL_VIS - 6, fh = CELL_H - 6;
        g.globalAlpha = fa;
        g.lineWidth = 5;
        var sweep = U.clamp((ht * 0.9 + j * 0.12) % 1, 0, 1);
        var fg = g.createLinearGradient(fx, fy, fx + fw, fy + fh);
        fg.addColorStop(0, '#b37a22');
        fg.addColorStop(Math.max(0, sweep - 0.15), '#e9b84f');
        fg.addColorStop(sweep, '#fffbe0');
        fg.addColorStop(Math.min(1, sweep + 0.15), '#e9b84f');
        fg.addColorStop(1, '#b37a22');
        g.strokeStyle = fg;
        g.shadowColor = 'rgba(255,200,60,0.9)';
        g.shadowBlur = 14 * res;
        roundRect(g, fx, fy, fw, fh, 10);
        g.stroke();
        g.shadowBlur = 0;
        g.lineWidth = 1.5;
        g.strokeStyle = 'rgba(255,255,240,0.8)';
        roundRect(g, fx + 3.5, fy + 3.5, fw - 7, fh - 7, 7);
        g.stroke();
      }
      g.restore();
    }
  };

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  // Centre of a cell in design px relative to the reel canvas.
  Reels.cellCenter = function (col, row) {
    return { x: colC(col), y: row * ROW_PITCH + CELL_H / 2 };
  };
  Reels.VIEW_W = VIEW_W;
  Reels.VIEW_H = VIEW_H;

  BR.Reels = Reels;
})(window.BR = window.BR || {});
