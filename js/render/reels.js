/* 5x3 reel window rendered on a canvas: spin physics (kick, acceleration,
   motion blur, staggered stops with overshoot), anticipation and win
   highlighting.  Units are design px; `res` maps them to device px. */
(function (BR) {
  'use strict';

  var U = BR.util;
  function lite() { return !!(BR.fx && BR.fx.lite()); }
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
    this.flash = 0;
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
    // the light of the landing fades out after the reel has stopped too
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.2);
    if (p === 'idle') return false;
    this.t += dt;
    if (p === 'wait') {
      if (this.t >= 0) { this.phase = 'kick'; this.t = 0; this.kickBase = this.off; }
      return true;
    }
    if (p === 'kick') {
      // an upward wind-up before the reel takes off (anticipation)
      var K = 0.15;
      var u = Math.min(1, this.t / K);
      var target = -22 * Math.sin(Math.PI * u);
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
        this.flash = 1;
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
    this.pre = null;     // matches so far while the reels still turn: { cols, t0 }
    this.antic = [];
    this.dirty = true;
    this.running = false;
    this.last = 0;
    this.dim = 0;
    var self = this;
    this._loop = function (t) { self.frame(t); };
    var wasLite = lite();
    if (BR.fx) BR.fx.onChange(function () {
      if (wasLite !== lite()) { wasLite = lite(); self.resize(self.requestedRes || 1); }
      else self.invalidate();
    });
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
    this.requestedRes = res;
    if (lite()) res = Math.min(res, 0.8);
    this.res = res;
    this.canvas.width = Math.round(VIEW_W * res);
    this.canvas.height = Math.round(VIEW_H * res);
    this.back = this.renderBack(res);
    // the panels of the reel window's 3D model, once loaded (until then the drawn ones)
    var back = BR.assets.backImage();
    if (back) back.then(function (img) {
      if (self.res !== res) return;
      var c = BR.assets.makeCanvas(VIEW_W * res, VIEW_H * res);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      self.back = c;
      self.invalidate();
    }, function () {});
    this.front = this.renderFront(res);
    this.glow = this.renderGlow(res);
    this.rays = this.renderRays(res);
    this.streaks = this.renderStreaks(res);
    this.flare = this.renderFlare(res);
    return BR.assets.buildSymbols(res).then(function (sp) {
      if (self.res !== res) return;
      self.sprites = sp;
      self.invalidate();
    });
  };

  // Cream cells (static background of the window): every column is a
  // cylinder - warm peach at the edges, pale cream in the middle. (Shown
  // until the 3D model's panels are in: img/ui/reel-back.webp.)
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

  // Frame shadows over the symbols (the gold bars between the reels and the
  // row seams are the reel window's 3D model's: img/ui/reel-frame.webp over
  // the canvas, img/ui/reel-back.webp under the symbols).
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

  // Light rays turning behind a winning symbol.
  Reels.prototype.renderRays = function (res) {
    var s = 300, c = BR.assets.makeCanvas(s * res, s * res), g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, s / 2 * res, s / 2 * res);
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * Math.PI * 2, w = 0.09 + (i % 3) * 0.03;
      var gr = g.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      gr.addColorStop(0, 'rgba(255,250,215,0.85)');
      gr.addColorStop(0.45, 'rgba(255,205,90,0.35)');
      gr.addColorStop(1, 'rgba(255,160,30,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, s / 2, a - w, a + w);
      g.closePath();
      g.fill();
    }
    return c;
  };

  // A four-point star for the glints on winning symbols.
  Reels.prototype.renderFlare = function (res) {
    var s = 120, r = s / 2, c = BR.assets.makeCanvas(s * res, s * res), g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, r * res, r * res);
    var gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.4);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,245,210,0.5)');
    gr.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = gr;
    g.fillRect(-r, -r, s, s);
    for (var k = 0; k < 4; k++) {
      g.save();
      g.rotate(k * Math.PI / 2);
      var lg = g.createLinearGradient(0, 0, r, 0);
      lg.addColorStop(0, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,230,160,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(0, -r * 0.06);
      g.quadraticCurveTo(r * 0.3, 0, r, 0);
      g.quadraticCurveTo(r * 0.3, 0, 0, r * 0.06);
      g.fill();
      g.restore();
    }
    return c;
  };

  /* Each symbol wins in its own way, drawn round the punching symbol in
     device px (`back`: the layer behind it, else the one in front): the 7
     burns, a pillar of light comes down on the statue, the diamond throws
     rainbow glints, sparks circle the star, a gleam passes over the BAR,
     the gold bar and the coin glint at their edges. Times run from
     the moment the win is shown, a little apart from one reel to the next. */
  Reels.prototype.winFx = function (g, sym, cx, cy, ht, res, i, back) {
    var t = ht + i * 0.15, x0 = cx - COL_W * res / 2, base = cy + CELL_H * res / 2;
    g.save();
    if (back) {
      if (sym === 'seven') {
        // the 3D fire (js/render/fire3d.js) up from the bottom of the cell; the drawn flames until it is in
        var fh = CELL_H * 0.78 * res;
        if (!BR.fire3d || !BR.fire3d.draw(g, x0 - 8 * res, base - fh, COL_W * res + 16 * res, fh, t + i * 0.31)) {
          flames(g, x0, COL_W * res, base, res, t, i + 9, 0.6, ['rgba(255,220,110,0.9)', 'rgba(255,120,30,0.75)', 'rgba(230,40,0,0.4)', 'rgba(180,10,0,0)']);
        }
      } else if (sym === 'statue') {
        g.globalCompositeOperation = 'lighter';
        var pg = g.createLinearGradient(0, 0, 0, base);
        pg.addColorStop(0, 'rgba(255,250,225,0.8)');
        pg.addColorStop(0.7, 'rgba(255,232,165,0.28)');
        pg.addColorStop(1, 'rgba(255,220,140,0)');
        g.fillStyle = pg;
        var pw = (74 + 20 * Math.sin(t * 3)) * res;
        g.fillRect(cx - pw / 2, 0, pw, base);
      }
    } else {
      g.globalCompositeOperation = 'lighter';
      if (sym === 'diamond') {
        var spots = [[-38, -26, 0], [34, -8, 2.1], [4, 34, 4.2]];
        for (var k = 0; k < spots.length; k++) {
          var p = spots[k], a = Math.max(0, Math.sin(t * 5.5 + p[2]));
          if (a < 0.05) continue;
          var px = cx + p[0] * res, py = cy + p[1] * res;
          g.globalAlpha = a * 0.7;
          g.fillStyle = 'hsla(' + Math.round((t * 120 + p[2] * 60) % 360) + ',100%,70%,0.8)';
          g.beginPath();
          g.arc(px, py, 16 * res * a, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = a;
          var fs = 70 * res * a;
          g.drawImage(this.flare, px - fs / 2, py - fs / 2, fs, fs);
        }
      } else if (sym === 'star') {
        for (var m = 0; m < 2; m++) {
          var ang = t * 3 + m * Math.PI, ss = 46 * res;
          g.globalAlpha = 0.9;
          g.drawImage(this.flare, cx + Math.cos(ang) * 82 * res - ss / 2, cy + Math.sin(ang) * 72 * res - ss / 2, ss, ss);
        }
      } else if (sym === 'bar') {
        var sw = ((t * 0.8) % 1.4) - 0.2;
        var gx = x0 + sw * COL_W * res;
        var lg = g.createLinearGradient(gx - 42 * res, 0, gx + 42 * res, 0);
        lg.addColorStop(0, 'rgba(255,255,230,0)');
        lg.addColorStop(0.5, 'rgba(255,255,230,0.55)');
        lg.addColorStop(1, 'rgba(255,255,230,0)');
        g.fillStyle = lg;
        g.fillRect(x0, cy - CELL_H * res / 2, COL_W * res, CELL_H * res);
      } else if (sym === 'gold') {
        var gp = (t * 1.25) % 1, corner = Math.floor(t * 1.25) % 2 ? [42, -30] : [-46, 18];
        var gz = 90 * res * Math.sin(gp * Math.PI);
        g.drawImage(this.flare, cx + corner[0] * res - gz / 2, cy + corner[1] * res - gz / 2, gz, gz);
      } else if (sym === 'revolver') {
        var ca = t * 2.4, cz = (42 + 18 * Math.sin(t * 4)) * res;
        g.globalAlpha = .8;
        g.drawImage(this.flare, cx + Math.cos(ca) * 44 * res - cz / 2,
          cy + Math.sin(ca) * 34 * res - cz / 2, cz, cz);
      }
    }
    g.restore();
  };
  // a winning symbol's 3D turn (degrees, 0: facing the front as in the reel):
  // once right round as it lands (one reel after another), then again every 2.8 s
  var TURN_S = 0.85, TURN_EVERY = 2.8;
  function turnAngle(ht, i) {
    var t = ht - 0.12 - 0.09 * i;
    if (t < 0) return 0;
    var p = t % TURN_EVERY;
    return p < TURN_S ? 360 * U.ease.inOutCubic(p / TURN_S) % 360 : 0;
  }
  // The supplied star and coin rock gently between win pulses.
  function winTurn(sym, ht, i) {
    var t = ht + i * 0.15;
    if (sym === 'star') return Math.sin(t * 2.6) * 0.22;
    if (sym === 'revolver') return Math.sin(t * 2.1) * 0.08;

    return 0;
  }

  // Streaks of light racing down a reel at full speed.
  Reels.prototype.renderStreaks = function (res) {
    var w = COL_W, h = VIEW_H, c = BR.assets.makeCanvas(w * res, h * res), g = c.getContext('2d');
    g.setTransform(res, 0, 0, res, 0, 0);
    var xs = [0.18, 0.37, 0.55, 0.71, 0.86];
    xs.forEach(function (fx, i) {
      var y0 = (i * 137) % h, len = 120 + (i * 53) % 140;
      for (var k = -1; k <= 1; k++) {
        var y = y0 + k * h;
        var gr = g.createLinearGradient(0, y, 0, y + len);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(0.7, 'rgba(255,250,230,0.55)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(w * fx - 1.5, y, 3, len);
      }
    });
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
    if (this.sprites && this.sprites.prepareBlur) this.sprites.prepareBlur();
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
    this.pre = null;
    this.invalidate();
  };
  Reels.prototype.clearHighlight = function () {
    this.hl = null;
    this.pre = null;
    this.antic = [];
    this.invalidate();
  };
  // Frames the symbols on the pay line that already pay while other reels
  // still turn (js/render/slotfx.js), until the win itself is shown.
  Reels.prototype.preview = function (cols) {
    this.pre = cols && cols.length ? { cols: cols.slice(), t0: U.now() } : null;
    this.invalidate();
  };

  Reels.prototype.frame = function () {
    // performance.now() rather than the rAF timestamp: the latter can be
    // older than times recorded by event handlers in the same frame.
    var now = U.now();
    var dt = U.clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    var moving = false, lit = false;
    for (var i = 0; i < 5; i++) {
      if (this.reels[i].update(dt)) moving = true;
      if (this.reels[i].flash > 0) lit = true;
    }
    var more = moving || lit || this.hl || this.pre || this.antic.length;
    if (more) requestAnimationFrame(this._loop);
    else this.running = false;
    if ((more || this.dirty) && (!lite() || !more || this.dirty || now - (this.drawAt || 0) >= 1000 / 30)) {
      this.drawAt = now;
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
    // 演出設定 (js/core/effects.js): the light on the line, the symbols' dance
    var fx = BR.fx, lineOn = !fx || fx.on('line'), symOn = !fx || fx.on('symbols'), landOn = !fx || fx.on('spin');

    // pay line beam behind the symbols, with a light running along it
    if (hl && hl.cols.length && lineOn) {
      var a = Math.min(1, ht / 0.35);
      var y = (ROW_PITCH + CELL_H / 2) * res;
      var bw = (20 + 6 * Math.sin(ht * 9)) * res;
      g.save();
      g.globalCompositeOperation = 'lighter';
      var grd = g.createLinearGradient(0, y - bw, 0, y + bw);
      grd.addColorStop(0, 'rgba(255,190,60,0)');
      grd.addColorStop(0.5, 'rgba(255,230,140,' + (0.9 * a) + ')');
      grd.addColorStop(1, 'rgba(255,190,60,0)');
      g.fillStyle = grd;
      g.fillRect(0, y - bw, VIEW_W * res * a, bw * 2);
      var run = ((ht * 0.85) % 1) * (VIEW_W + 400) - 200;
      var rg = g.createRadialGradient(run * res, y, 0, run * res, y, 150 * res);
      rg.addColorStop(0, 'rgba(255,255,240,' + (0.95 * a) + ')');
      rg.addColorStop(0.3, 'rgba(255,220,120,' + (0.45 * a) + ')');
      rg.addColorStop(1, 'rgba(255,170,40,0)');
      g.fillStyle = rg;
      g.fillRect((run - 150) * res, y - 40 * res, 300 * res, 80 * res);
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
        if (win && !symOn) {
          // switched off: the winning symbol only lights up
          var sx = x + COL_W * res / 2, sy = (yy + CELL_H / 2) * res, ss = 250 * res;
          g.save();
          g.globalCompositeOperation = 'lighter';
          g.globalAlpha = Math.min(1, ht / 0.25) * 0.7;
          g.drawImage(this.glow, sx - ss / 2, sy - ss / 2, ss, ss);
          g.restore();
          g.drawImage(sp.sharp[sym], Math.round(x), Math.round(yy * res));
          continue;
        }
        if (win) {
          var pulse = 0.5 + 0.5 * Math.sin(ht * Math.PI * 2 * 1.3 - Math.PI / 2);
          var ga = Math.min(1, ht / 0.25) * (0.6 + 0.4 * pulse);
          var cx = x + COL_W * res / 2, cy = (yy + CELL_H / 2) * res;
          g.save();
          g.globalCompositeOperation = 'lighter';
          // turning rays and a warm glow behind the symbol
          g.globalAlpha = ga * 0.8;
          var rs = (230 + 30 * pulse) * res;
          g.translate(cx, cy);
          g.rotate(ht * 0.9 + i * 0.7);
          g.drawImage(this.rays, -rs / 2, -rs / 2, rs, rs);
          g.setTransform(1, 0, 0, 1, 0, 0);
          g.globalAlpha = ga;
          var gs = 270 * res;
          g.drawImage(this.glow, cx - gs / 2, cy - gs / 2, gs, gs);
          g.restore();
          if (this.flare && !lite()) this.winFx(g, sym, cx, cy, ht, res, i, true);
          // the symbol punches in, then keeps beating
          var pin = Math.min(1, ht / 0.32);
          var punch = pin < 1 ? 1.25 - 0.25 * U.ease.outBack(pin, 2.4) : 1;
          var sc = punch * (1 + 0.1 * pulse * pin);
          // the 3D model turns right round as it wins, and again now and then
          var tn = !lite() && BR.assets.turn(sym), deg = turnAngle(ht, i);
          var wob = (Math.sin(ht * 7.5 + i) * 0.035 + (tn && deg ? 0 : winTurn(sym, ht, i))) * pin;
          g.save();
          g.translate(cx, cy);
          g.rotate(wob);
          if (tn && deg) {
            var f = Math.round(deg / (360 / tn.frames)) % tn.frames;
            var dw = COL_W * tn.pad * res * sc, dh = CELL_H * tn.pad * res * sc;
            g.drawImage(tn.img, (f % tn.cols) * tn.fw, Math.floor(f / tn.cols) * tn.fh, tn.fw, tn.fh, -dw / 2, -dh / 2, dw, dh);
          } else g.drawImage(sp.sharp[sym], -COL_W * res * sc / 2, -CELL_H * res * sc / 2, COL_W * res * sc, CELL_H * res * sc);
          // a white flash on the way in
          if (pin < 1) {
            g.globalCompositeOperation = 'lighter';
            g.globalAlpha = (1 - pin) * 0.75;
            var fs = 240 * res;
            g.drawImage(this.glow, -fs / 2, -fs / 2, fs, fs);
          }
          g.restore();
          if (this.flare && !lite()) this.winFx(g, sym, cx, cy, ht, res, i, false);
          continue;
        }
        if (set === sp.sharp && r.flash > 0.02 && landOn) {
          // the symbols squash as the reel hits home, then spring back
          var since = 1 - r.flash, give = Math.exp(-5 * since) * Math.cos(since * 13);
          var sqx = 1 + 0.05 * give, sqy = 1 - 0.08 * give;
          var qx = x + COL_W * res / 2, qy = (yy + CELL_H / 2) * res;
          g.drawImage(sp.sharp[sym], qx - COL_W * res * sqx / 2, qy - CELL_H * res * sqy / 2, COL_W * res * sqx, CELL_H * res * sqy);
        } else if (set === sp.sharp) {
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
      // streaks of light while a reel races
      if (r.v > 2600 && this.streaks) {
        var sa = U.clamp((r.v - 2600) / 1600, 0, 1) * 0.55;
        var sky = ((now / 1000) * 2600 + i * 211) % VIEW_H;
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = sa;
        g.drawImage(this.streaks, x, (sky - VIEW_H) * res);
        g.drawImage(this.streaks, x, sky * res);
        g.restore();
      }
      // a flash where a reel lands: light from the top and the bottom edge
      if (r.flash > 0) {
        var lf = r.flash * r.flash;
        g.save();
        g.globalCompositeOperation = 'lighter';
        var lg = g.createLinearGradient(0, 0, 0, VIEW_H * res);
        lg.addColorStop(0, 'rgba(255,240,190,' + (0.8 * lf) + ')');
        lg.addColorStop(0.22, 'rgba(255,220,140,' + (0.18 * lf) + ')');
        lg.addColorStop(0.5, 'rgba(255,230,160,' + (0.1 * lf) + ')');
        lg.addColorStop(0.78, 'rgba(255,220,140,' + (0.18 * lf) + ')');
        lg.addColorStop(1, 'rgba(255,240,190,' + (0.8 * lf) + ')');
        g.fillStyle = lg;
        g.fillRect(x, 0, COL_W * res, VIEW_H * res);
        g.restore();
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
      // anticipation: the reel still spinning burns, the ones stopped go dark
      if (this.antic.length && r.phase === 'idle' && this.antic.indexOf(i) < 0) {
        g.fillStyle = 'rgba(25,4,0,0.38)';
        g.fillRect(x, 0, COL_W * res, VIEW_H * res);
      }
      if (this.antic.indexOf(i) >= 0 && r.phase !== 'idle') {
        var ts = now / 1000;
        var ap = 0.5 + 0.5 * Math.sin(ts * Math.PI * 6);
        // the reel turns orange-red (painted over: a bright reel cannot be made
        // red by adding light), then flames lick up from the bottom
        var tint = g.createLinearGradient(0, 0, 0, VIEW_H * res);
        tint.addColorStop(0, 'rgba(255,130,40,' + (0.16 + 0.1 * ap) + ')');
        tint.addColorStop(0.55, 'rgba(255,80,20,' + (0.2 + 0.1 * ap) + ')');
        tint.addColorStop(1, 'rgba(220,30,0,' + (0.42 + 0.14 * ap) + ')');
        g.fillStyle = tint;
        g.fillRect(x, 0, COL_W * res, VIEW_H * res);
        flames(g, x, COL_W * res, VIEW_H * res, res, ts, i, 1, ['rgba(255,210,90,0.95)', 'rgba(255,110,20,0.85)', 'rgba(230,40,0,0.5)', 'rgba(180,10,0,0)']);
        flames(g, x, COL_W * res, VIEW_H * res, res, ts * 1.35 + 3, i + 5, 0.55, ['rgba(255,255,230,0.95)', 'rgba(255,230,120,0.85)', 'rgba(255,160,40,0.5)', 'rgba(255,120,20,0)']);
        // and the edges burn bright
        g.globalCompositeOperation = 'lighter';
        var ag = g.createLinearGradient(x, 0, x + COL_W * res, 0);
        ag.addColorStop(0, 'rgba(255,150,40,' + (0.7 + 0.3 * ap) + ')');
        ag.addColorStop(0.16, 'rgba(255,90,20,0)');
        ag.addColorStop(0.84, 'rgba(255,90,20,0)');
        ag.addColorStop(1, 'rgba(255,150,40,' + (0.7 + 0.3 * ap) + ')');
        g.fillStyle = ag;
        g.fillRect(x, 0, COL_W * res, VIEW_H * res);
        g.globalCompositeOperation = 'source-over';
      }
      g.restore();
    }

    if (this.front) g.drawImage(this.front, 0, 0);

    // matches so far (other reels still turning): thin gold frames that breathe
    if (this.pre && !hl) {
      var pt = (now - this.pre.t0) / 1000;
      g.save();
      g.setTransform(res, 0, 0, res, 0, 0);
      g.lineWidth = 4;
      g.strokeStyle = '#ffeaa6';
      g.shadowColor = 'rgba(255,210,80,1)';
      g.shadowBlur = 16 * res;
      for (var pi = 0; pi < this.pre.cols.length; pi++) {
        var pc = this.pre.cols[pi];
        if (this.reels[pc].phase !== 'idle') continue;
        g.globalAlpha = Math.min(1, pt / 0.15) * (0.72 + 0.28 * Math.sin(pt * 9 + pc));
        roundRect(g, colC(pc) - CELL_VIS / 2 + 4, ROW_PITCH + 4, CELL_VIS - 8, CELL_H - 8, 10);
        g.stroke();
      }
      g.restore();
    }

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
        g.lineWidth = 6 + 2 * Math.sin(ht * 8 + j);
        var sweep = U.clamp((ht * 1.2 + j * 0.12) % 1, 0, 1);
        var fg = g.createLinearGradient(fx, fy, fx + fw, fy + fh);
        fg.addColorStop(0, '#b37a22');
        fg.addColorStop(Math.max(0, sweep - 0.15), '#e9b84f');
        fg.addColorStop(sweep, '#fffbe0');
        fg.addColorStop(Math.min(1, sweep + 0.15), '#e9b84f');
        fg.addColorStop(1, '#b37a22');
        g.strokeStyle = fg;
        g.shadowColor = 'rgba(255,210,80,1)';
        g.shadowBlur = (18 + 8 * Math.sin(ht * 8 + j)) * res;
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

  // Flame tongues along the bottom of a reel: valleys and peaks that rise
  // and fall, joined by smooth curves; `k` scales their height, `cols` are
  // the colours from the bottom up.
  function flames(g, x, w, h, res, ts, seed, k, cols) {
    var n = 7, pts = [];
    for (var j = 0; j <= n * 2; j++) {
      var peak = j % 2 === 1;
      var hh = peak
        ? (120 + 60 * Math.sin(ts * 7.3 + j * 1.9 + seed) + 35 * Math.sin(ts * 17.1 + j * 0.7)) * k
        : (26 + 16 * Math.sin(ts * 11 + j + seed)) * k;
      pts.push([x + w * j / (n * 2), h - hh * res]);
    }
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(pts[0][0], pts[0][1]);
    for (var m = 1; m < pts.length - 1; m++) {
      var mx = (pts[m][0] + pts[m + 1][0]) / 2, my = (pts[m][1] + pts[m + 1][1]) / 2;
      g.quadraticCurveTo(pts[m][0], pts[m][1], mx, my);
    }
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    g.lineTo(x + w, h);
    g.closePath();
    var fg = g.createLinearGradient(0, h, 0, h - 210 * k * res);
    fg.addColorStop(0, cols[0]);
    fg.addColorStop(0.35, cols[1]);
    fg.addColorStop(0.7, cols[2]);
    fg.addColorStop(1, cols[3]);
    g.fillStyle = fg;
    g.fill();
  }

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
