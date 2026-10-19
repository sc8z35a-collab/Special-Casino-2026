/* Win presentation layer: WIN / BIG WIN / SUPER BIG WIN.
   Everything is drawn on one canvas above the stage with pre-rendered
   sprites (titles, chips, rays, glints) so it stays smooth on phones.
   The big wins hit like the real thing: a turning sunburst and two stage
   beams behind the rays, a moment of stillness (hit-stop) when the title
   lands, a camera kick, three shock rings, a heartbeat that keeps pulsing
   the title, and for SUPER the screen breaking like glass, lightning,
   rainbow rays and confetti (the shards, bolts and confetti are drawn by
   js/render/juice.js on top). */
(function (BR) {
  'use strict';

  var U = BR.util, E = U.ease;
  var TAU = Math.PI * 2;

  /* ------------------------------------------------------------ sprites --- */

  function canvas(w, h) { return BR.assets.makeCanvas(w, h); }

  // soft round glow (white core -> warm gold -> transparent)
  function glowSprite(size, inner, outer) {
    var c = canvas(size, size), g = c.getContext('2d'), r = size / 2;
    var gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, inner || 'rgba(255,255,240,1)');
    gr.addColorStop(0.25, 'rgba(255,230,140,0.85)');
    gr.addColorStop(0.55, outer || 'rgba(255,160,40,0.3)');
    gr.addColorStop(1, 'rgba(255,120,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  // 4-point star flare used for glints
  function flareSprite(size) {
    var c = canvas(size, size), g = c.getContext('2d'), r = size / 2;
    g.translate(r, r);
    var gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.45);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.3, 'rgba(255,245,200,0.6)');
    gr.addColorStop(1, 'rgba(255,200,80,0)');
    g.fillStyle = gr;
    g.fillRect(-r, -r, size, size);
    g.globalCompositeOperation = 'lighter';
    for (var k = 0; k < 2; k++) {
      g.save();
      g.rotate(k * Math.PI / 2);
      var lg = g.createLinearGradient(-r, 0, r, 0);
      lg.addColorStop(0, 'rgba(255,230,150,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,1)');
      lg.addColorStop(1, 'rgba(255,230,150,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(-r, 0);
      g.quadraticCurveTo(0, -r * 0.035, r, 0);
      g.quadraticCurveTo(0, r * 0.035, -r, 0);
      g.fill();
      g.restore();
    }
    for (var j = 0; j < 2; j++) {
      g.save();
      g.rotate(Math.PI / 4 + j * Math.PI / 2);
      var lg2 = g.createLinearGradient(-r * 0.5, 0, r * 0.5, 0);
      lg2.addColorStop(0, 'rgba(255,230,150,0)');
      lg2.addColorStop(0.5, 'rgba(255,250,220,0.7)');
      lg2.addColorStop(1, 'rgba(255,230,150,0)');
      g.fillStyle = lg2;
      g.fillRect(-r * 0.5, -0.8, r, 1.6);
      g.restore();
    }
    return c;
  }

  // light rays texture (additive); `rainbow`: every ray its own colour
  function raySprite(size, count, seed, rainbow) {
    var c = canvas(size, size), g = c.getContext('2d'), r = size / 2;
    g.translate(r, r);
    var rnd = seed;
    function rand() { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; }
    for (var i = 0; i < count; i++) {
      var a = i / count * TAU + rand() * 0.12;
      var w = 0.025 + rand() * 0.06;
      var len = r * (0.65 + rand() * 0.35);
      var gr = g.createRadialGradient(0, 0, 0, 0, 0, len);
      var al = 0.35 + rand() * 0.5;
      if (rainbow) {
        var hue = Math.round(i / count * 360);
        gr.addColorStop(0, 'hsla(' + hue + ',100%,92%,' + al + ')');
        gr.addColorStop(0.35, 'hsla(' + hue + ',100%,62%,' + (al * 0.6) + ')');
        gr.addColorStop(1, 'hsla(' + hue + ',100%,50%,0)');
      } else {
        gr.addColorStop(0, 'rgba(255,250,215,' + al + ')');
        gr.addColorStop(0.35, 'rgba(255,215,120,' + (al * 0.55) + ')');
        gr.addColorStop(1, 'rgba(255,170,50,0)');
      }
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, len, a - w, a + w);
      g.closePath();
      g.fill();
    }
    return c;
  }

  // sunburst: wedges of warm light fading out from the middle (drawn small,
  // shown large: a soft background does not need the pixels)
  function sunSprite(size, wedges) {
    var c = canvas(size, size), g = c.getContext('2d'), r = size / 2;
    g.translate(r, r);
    for (var i = 0; i < wedges; i++) {
      var a0 = i / wedges * TAU, a1 = (i + 0.5) / wedges * TAU;
      var gr = g.createRadialGradient(0, 0, r * 0.05, 0, 0, r);
      gr.addColorStop(0, 'rgba(255,236,170,0.9)');
      gr.addColorStop(0.35, 'rgba(255,190,70,0.45)');
      gr.addColorStop(1, 'rgba(255,140,30,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, r, a0, a1);
      g.closePath();
      g.fill();
    }
    return c;
  }

  // a stage beam: light widening upwards from a point, fading out (drawn
  // once: a clip on a moving layer would be cut out again on every frame)
  function beamSprite(w, h) {
    var c = canvas(w, h), g = c.getContext('2d');
    var gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, 'rgba(255,244,200,0.85)');
    gr.addColorStop(0.4, 'rgba(255,224,150,0.32)');
    gr.addColorStop(0.88, 'rgba(255,200,100,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(w * 0.46, h);
    g.lineTo(w * 0.54, h);
    g.lineTo(w, 0);
    g.lineTo(0, 0);
    g.closePath();
    g.fill();
    return c;
  }

  /* 3D extruded title: red (or gold) face, gold/dark/cream rims and a
     perspective extrusion towards a vanishing point below the text. */
  function titleSprite(text, opt, res) {
    var em = opt.em;
    var font = opt.weight + ' ' + em + 'px MontserratX, Montserrat, "Arial Black", sans-serif';
    var meas = canvas(4, 4).getContext('2d');
    meas.font = font;
    if ('letterSpacing' in meas) meas.letterSpacing = (opt.spacing || 0) + 'px';
    var tw = meas.measureText(text).width;
    var sx = Math.min(1, opt.maxW / tw);
    var cap = em * 0.7;
    var pad = em * 0.32 + opt.depth * 1.2;
    var W = tw * sx + pad * 2, H = cap + pad * 2;
    var c = canvas(W * res, H * res), g = c.getContext('2d');
    g.scale(res, res);
    g.font = font;
    if ('letterSpacing' in g) g.letterSpacing = (opt.spacing || 0) + 'px';
    g.textBaseline = 'alphabetic';
    g.textAlign = 'center';
    g.lineJoin = 'round';
    var cx = W / 2, base = pad + cap;
    var vpY = base + opt.vp;
    // draw in a frame scaled by `scale` towards the vanishing point (cx, vpY)
    function at(scale, fn) {
      g.save();
      g.translate(cx, vpY);
      g.scale(scale * sx, scale);
      g.translate(0, -vpY);
      fn();
      g.restore();
    }
    // extrusion layers, back to front
    var layers = opt.depth;
    for (var i = layers; i >= 1; i--) {
      var s = 1 - i * opt.step;
      at(s, function () {
        g.fillStyle = i === layers ? opt.backEdge : (i % 2 ? opt.side : opt.side2);
        if (i === layers) {
          g.lineWidth = em * 0.06;
          g.strokeStyle = opt.backEdge;
          g.strokeText(text, 0, base);
        }
        g.fillText(text, 0, base);
      });
    }
    // dark contact shadow between extrusion and face
    at(1 - opt.step * 1.5, function () {
      g.lineWidth = em * 0.16;
      g.strokeStyle = 'rgba(40,5,0,0.55)';
      g.strokeText(text, 0, base);
    });
    var top = base - cap, bot = base;
    function vgrad(stops) {
      var gr = g.createLinearGradient(0, top - em * 0.1, 0, bot + em * 0.1);
      stops.forEach(function (st) { gr.addColorStop(st[0], st[1]); });
      return gr;
    }
    at(1, function () {
      g.lineWidth = em * 0.145;
      g.strokeStyle = vgrad(opt.rim);
      g.strokeText(text, 0, base);
      g.lineWidth = em * 0.07;
      g.strokeStyle = opt.rimDark;
      g.strokeText(text, 0, base);
      g.lineWidth = em * 0.042;
      g.strokeStyle = vgrad(opt.rimInner);
      g.strokeText(text, 0, base);
      g.fillStyle = vgrad(opt.face);
      g.fillText(text, 0, base);
    });
    // glossy upper half + bevel highlight on the face only
    var face = canvas(W * res, H * res), fg = face.getContext('2d');
    fg.scale(res, res);
    fg.font = font;
    if ('letterSpacing' in fg) fg.letterSpacing = (opt.spacing || 0) + 'px';
    fg.textAlign = 'center';
    fg.save();
    fg.translate(cx, vpY); fg.scale(sx, 1); fg.translate(0, -vpY);
    fg.fillStyle = '#fff';
    fg.fillText(text, 0, base);
    fg.restore();
    fg.globalCompositeOperation = 'source-in';
    var gl = fg.createLinearGradient(0, top, 0, bot);
    gl.addColorStop(0, 'rgba(255,255,255,0.26)');
    gl.addColorStop(0.42, 'rgba(255,255,255,0.08)');
    gl.addColorStop(0.47, 'rgba(255,255,255,0)');
    gl.addColorStop(1, 'rgba(0,0,0,0.12)');
    fg.fillStyle = gl;
    fg.fillRect(0, 0, W, H);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(face, 0, 0);
    // mask of the whole title for light sweeps
    var mask = canvas(W * res, H * res), mg = mask.getContext('2d');
    mg.drawImage(c, 0, 0);
    return { img: c, mask: mask, w: W, h: H, cap: cap, cy: pad + cap / 2 };
  }

  var STYLE_RED = {
    weight: 900, spacing: -2, depth: 26, step: 0.0042, vp: 420,
    side: '#7b1015', side2: '#6e0d12', backEdge: '#d4a24a',
    rim: [[0, '#fffbe0'], [0.18, '#ffe7a0'], [0.4, '#e2ac4c'], [0.55, '#fff0b8'], [0.75, '#d49b3e'], [1, '#8f5a18']],
    rimDark: '#4a1a02',
    rimInner: [[0, '#fff8d8'], [0.5, '#f7d88a'], [1, '#c9933c']],
    face: [[0, '#ff6b3e'], [0.32, '#f2462b'], [0.68, '#d3281f'], [1, '#9c1418']]
  };
  var STYLE_GOLD = {
    weight: 900, spacing: 4, depth: 20, step: 0.0048, vp: 380,
    side: '#6b3a08', side2: '#5e3206', backEdge: '#f0c060',
    rim: [[0, '#fff6d6'], [0.25, '#ffe9a6'], [0.5, '#c88a2c'], [0.62, '#fff2bf'], [0.85, '#c88a2c'], [1, '#7a4a10']],
    rimDark: '#3a1600',
    rimInner: [[0, '#fff'], [1, '#ffe7a0']],
    face: [[0, '#fff7c2'], [0.3, '#ffd968'], [0.6, '#f0a92a'], [1, '#c4701a']]
  };

  // dark amount panel with the double gold frame and concave corners
  function panelSprite(w, h, res) {
    var pad = 24;
    var c = canvas((w + pad * 2) * res, (h + pad * 2) * res), g = c.getContext('2d');
    g.scale(res, res);
    g.translate(pad, pad);
    function notch(x, y, ww, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.lineTo(x + ww - r, y);
      g.arc(x + ww, y, r, Math.PI, Math.PI / 2, true);
      g.lineTo(x + ww, y + hh - r);
      g.arc(x + ww, y + hh, r, -Math.PI / 2, Math.PI, true);
      g.lineTo(x + r, y + hh);
      g.arc(x, y + hh, r, 0, -Math.PI / 2, true);
      g.lineTo(x, y + r);
      g.arc(x, y, r, Math.PI / 2, 0, true);
      g.closePath();
    }
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 18;
    g.shadowOffsetY = 6;
    var gold = g.createLinearGradient(0, 0, 0, h);
    gold.addColorStop(0, '#fff3b8');
    gold.addColorStop(0.12, '#f5c94c');
    gold.addColorStop(0.5, '#d9a021');
    gold.addColorStop(0.88, '#f2c440');
    gold.addColorStop(1, '#9a6512');
    notch(0, 0, w, h, 24);
    g.fillStyle = gold;
    g.fill();
    g.shadowColor = 'transparent';
    // bevel lines
    g.lineWidth = 1.4;
    g.strokeStyle = 'rgba(255,250,215,0.9)';
    notch(3, 3, w - 6, h - 6, 21);
    g.stroke();
    g.strokeStyle = 'rgba(120,70,0,0.7)';
    notch(9, 9, w - 18, h - 18, 16);
    g.stroke();
    var inner = g.createLinearGradient(0, 14, 0, h - 14);
    inner.addColorStop(0, '#ffe58a');
    inner.addColorStop(0.5, '#e0a92a');
    inner.addColorStop(1, '#fff0b0');
    notch(13, 13, w - 26, h - 26, 13);
    g.fillStyle = inner;
    g.fill();
    var dark = g.createLinearGradient(0, 17, 0, h - 17);
    dark.addColorStop(0, '#2a2420');
    dark.addColorStop(0.5, '#1a1614');
    dark.addColorStop(1, '#100d0c');
    notch(17, 17, w - 34, h - 34, 10);
    g.fillStyle = dark;
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2;
    g.stroke();
    var gl = g.createLinearGradient(0, 17, 0, h * 0.55);
    gl.addColorStop(0, 'rgba(255,255,255,0.08)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    notch(19, 19, w - 38, h * 0.45, 8);
    g.fill();
    return { img: c, w: w + pad * 2, h: h + pad * 2 };
  }

  /* ------------------------------------------------------------ chips --- */

  // Draw a 3D casino chip.  n = unit normal (nx, ny, nz), psi = spin of the face.
  function drawChip(g, face, x, y, r, nx, ny, nz, psi, alpha) {
    var phi = Math.atan2(ny, nx);
    var cz = Math.abs(nz);
    var sinT = Math.sqrt(Math.max(0, 1 - nz * nz));
    var th = r * 0.16 * sinT;                // projected rim thickness
    var dir = nz >= 0 ? 1 : -1;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    g.rotate(phi);
    // rim: back ellipse + band + stripes (the back face is offset along the
    // projected normal, away from the visible face)
    var ox = -th * dir;
    g.fillStyle = '#8e1a14';
    g.beginPath();
    g.ellipse(ox, 0, Math.max(0.5, r * cz), r, 0, 0, TAU);
    g.fill();
    g.fillRect(Math.min(0, ox), -r, Math.abs(ox), 2 * r);
    if (th > 0.6) {
      g.fillStyle = '#efe9e6';
      var sgn = ox > 0 ? 1 : -1;
      for (var k = 0; k < 8; k++) {
        var a = psi + k * Math.PI / 4 + Math.PI / 8;
        var ca = Math.cos(a), sa = Math.sin(a);
        if (ca * sgn < 0.08) continue;         // only the half of the rim that shows
        var px = r * cz * ca, py = r * sa;
        var hw = r * 0.11 * Math.abs(ca) + 0.4;
        g.beginPath();
        g.moveTo(px, py - hw);
        g.lineTo(px + ox, py - hw);
        g.lineTo(px + ox, py + hw);
        g.lineTo(px, py + hw);
        g.fill();
      }
    }
    // face
    g.save();
    g.scale(Math.max(0.02, cz), 1);
    g.rotate(psi);
    g.drawImage(face, -r, -r, 2 * r, 2 * r);
    g.restore();
    // shading: darker when edge-on, sparkle when facing the light
    var shade = (1 - cz) * 0.38;
    if (shade > 0.02) {
      g.fillStyle = 'rgba(30,0,0,' + shade + ')';
      g.beginPath();
      g.ellipse(0, 0, Math.max(0.5, r * cz), r, 0, 0, TAU);
      g.fill();
    }
    var spec = Math.max(0, nz * 0.6 + nx * -0.3 + ny * -0.5);
    if (spec > 0.75) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,255,255,' + ((spec - 0.75) * 1.6) + ')';
      g.beginPath();
      g.ellipse(0, 0, Math.max(0.5, r * cz), r, 0, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function Chip(o) {
    this.x = o.x; this.y = o.y;
    this.vx = o.vx; this.vy = o.vy;
    this.r = o.r;
    this.g = o.g === undefined ? 1100 : o.g;
    this.drag = o.drag === undefined ? 0.35 : o.drag;
    // tumbling: normal described by theta (tilt) and phi (azimuth)
    this.th = U.rand(0, Math.PI);
    this.ph = U.rand(0, TAU);
    this.vth = U.rand(-7, 7);
    this.vph = U.rand(-3, 3);
    this.psi = U.rand(0, TAU);
    this.vpsi = U.rand(-6, 6);
    this.age = 0;
    this.life = o.life || 4;
    this.delay = o.delay || 0;
    this.front = o.front !== undefined ? o.front : U.random() < 0.6;
    this.fadeIn = o.fadeIn || 0;
  }
  Chip.prototype.update = function (dt) {
    if (this.delay > 0) { this.delay -= dt; return true; }
    this.age += dt;
    var d = Math.exp(-this.drag * dt);
    this.vx *= d; this.vy = this.vy * d + this.g * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.th += this.vth * dt; this.ph += this.vph * dt; this.psi += this.vpsi * dt;
    return this.age < this.life && this.y < 1400;
  };
  Chip.prototype.draw = function (g, face, fade) {
    if (this.delay > 0) return;
    var st = Math.sin(this.th);
    var nx = st * Math.cos(this.ph), ny = st * Math.sin(this.ph), nz = Math.cos(this.th);
    var a = fade;
    if (this.fadeIn) a *= Math.min(1, this.age / this.fadeIn);
    if (this.age > this.life - 0.4) a *= Math.max(0, (this.life - this.age) / 0.4);
    if (a <= 0.01) return;
    drawChip(g, face, this.x, this.y, this.r, nx, ny, nz, this.psi, a);
  };

  /* ------------------------------------------------------------ sparks --- */

  function Spark(o) {
    this.x = o.x; this.y = o.y; this.vx = o.vx; this.vy = o.vy;
    this.life = o.life; this.age = 0; this.size = o.size;
    this.g = o.g === undefined ? 260 : o.g;
    this.drag = o.drag === undefined ? 1.2 : o.drag;
    this.hue = o.hue || 0;
    this.streak = o.streak === undefined ? 0.035 : o.streak;
    this.delay = o.delay || 0;
  }
  Spark.prototype.update = function (dt) {
    if (this.delay > 0) { this.delay -= dt; return true; }
    this.age += dt;
    var d = Math.exp(-this.drag * dt);
    this.vx *= d; this.vy = this.vy * d + this.g * dt;
    this.x += this.vx * dt; this.y += this.vy * dt;
    return this.age < this.life;
  };

  /* ------------------------------------------------------------ FX --- */

  /* ------------------------------------------------------------ FX --- */
  /* Layer stack (back to front): dim, burst (rays/glow/rings), back particle
     canvas, titles, amount panel, front particle canvas, flash.  The large
     layers are DOM elements animated with transforms/opacity so the GPU
     composites them; only chips, sparks and glints are drawn per frame. */

  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function FX(root, hit) {
    this.root = root;
    this.hit = hit;
    this.W = 2000; this.H = 924; this.res = 1; this.pres = 1;
    this.active = null;
    this.sprites = null;
    this.dim = el('div', 'fx-dim', root);
    // two stage beams sweeping up from the bottom corners
    this.beams = [el('div', 'fx-beam l', root), el('div', 'fx-beam r', root)];
    this.burst = el('div', 'fx-burst', root);
    // a sunburst: wedges of gold light turning behind everything
    this.sun = el('div', 'fx-sun', this.burst);
    this.back = el('canvas', 'fx-canvas', root);
    this.titles = el('div', 'fx-group', root);
    this.panelWrap = el('div', 'fx-group', root);
    this.front = el('canvas', 'fx-canvas', root);
    this.flash = el('div', 'fx-flash', root);
    this.gb = this.back.getContext('2d');
    this.gf = this.front.getContext('2d');
    this.glow = el('div', 'fx-glow', this.burst);
    this.streak = el('div', 'fx-streak', this.burst);
    this.rings = [el('div', 'fx-ring', this.burst), el('div', 'fx-ring', this.burst), el('div', 'fx-ring', this.burst)];
    this.titleM = el('div', 'fx-title', this.titles);
    this.titleS = el('div', 'fx-title', this.titles);
    this.panel = el('div', 'fx-panel', this.panelWrap);
    this.amount = el('div', 'fx-amount', this.panel);
    var self = this;
    this._loop = function () { self.frame(); };
    hit.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); self.skip(); });
    root.style.display = 'none';
  }

  FX.prototype.resize = function (W, H, res) {
    var changed = Math.abs(Math.min(res, 1.3) - this.res) > 0.01;
    this.W = W; this.H = H;
    this.res = Math.min(res, 1.3);
    this.pres = Math.min(res, 1);          // particle canvases
    [this.back, this.front].forEach(function (c) {
      c.width = Math.round(W * this.pres);
      c.height = Math.round(H * this.pres);
    }, this);
    if (changed || !this.sprites) {
      this.sprites = null;
      this.spritePromise = null;
      var self = this;
      clearTimeout(this.prebuild);
      // build sprites in the background so the first win does not hitch
      this.prebuild = setTimeout(function () { if (!self.active) self.ensureSprites(); }, 900);
    }
  };

  FX.prototype.ensureSprites = function () {
    if (this.sprites) return Promise.resolve(this.sprites);
    if (this.spritePromise) return this.spritePromise;
    var self = this, res = this.res;
    var fontLoad = document.fonts && document.fonts.load
      ? Promise.all([document.fonts.load('900 100px MontserratX'), document.fonts.load('800 80px Exo2')]).catch(function () {})
      : Promise.resolve();
    this.spritePromise = fontLoad.then(function () {
      return BR.assets.rasterize(BR.chipSVG('fxc'), Math.round(130 * Math.max(1, self.pres)), Math.round(130 * Math.max(1, self.pres)));
    }).then(function (chipFace) {
      var sp = {
        chip: chipFace,
        glow: glowSprite(48),
        flare: flareSprite(Math.round(200 * self.pres)),
        rays: raySprite(1024, 30, 7),
        rays2: raySprite(1024, 18, 99),
        raysR: raySprite(1024, 24, 31, true),
        sun: sunSprite(512, 18),
        beam: beamSprite(128, 360),
        bigWin: titleSprite('BIG WIN', Object.assign({ em: 232, maxW: 870 }, STYLE_RED), res),
        win: titleSprite('WIN', Object.assign({ em: 200, maxW: 700 }, STYLE_RED), res),
        superT: titleSprite('SUPER', Object.assign({ em: 150, maxW: 700 }, STYLE_GOLD), res),
        panel: panelSprite(766, 156, res),
        panelS: panelSprite(560, 124, res)
      };
      // low-res masks for the CSS light sweep
      ['bigWin', 'win', 'superT'].forEach(function (k) {
        var t = sp[k], m = canvas(t.w * 0.5, t.h * 0.5);
        m.getContext('2d').drawImage(t.mask, 0, 0, m.width, m.height);
        t.maskURL = m.toDataURL('image/png');
      });
      self.installSprites(sp);
      self.sprites = sp;
      self.spritePromise = null;
      return sp;
    });
    return this.spritePromise;
  };

  FX.prototype.installSprites = function (sp) {
    var b = this.burst;
    $$('.fx-rays', b).forEach(function (n) { n.remove(); });
    sp.rays.className = 'fx-rays';
    sp.rays2.className = 'fx-rays';
    sp.raysR.className = 'fx-rays';
    b.insertBefore(sp.rays2, this.glow);
    b.insertBefore(sp.rays, sp.rays2);
    b.insertBefore(sp.raysR, this.glow);
    this.raysA = sp.rays;
    this.raysB = sp.rays2;
    this.raysR = sp.raysR;
    this.sun.innerHTML = '';
    sp.sun.className = 'fx-sun-img';
    this.sun.appendChild(sp.sun);
    this.beams.forEach(function (bm, i) {
      bm.innerHTML = '';
      var c = i ? canvas(sp.beam.width, sp.beam.height) : sp.beam;
      if (i) c.getContext('2d').drawImage(sp.beam, 0, 0);
      c.className = 'fx-beam-img';
      bm.appendChild(c);
    });
  };

  function $$(sel, root) { return Array.prototype.slice.call(root.querySelectorAll(sel)); }

  // Put a title sprite into its DOM slot.
  FX.prototype.mountTitle = function (slot, sp) {
    if (slot.sp === sp) return;
    slot.sp = sp;
    slot.innerHTML = '';
    sp.img.className = 'fx-title-img';
    sp.img.style.width = sp.w + 'px';
    sp.img.style.height = sp.h + 'px';
    slot.appendChild(sp.img);
    var sw = el('div', 'fx-sweep', slot);
    sw.style.width = sp.w + 'px';
    sw.style.height = sp.h + 'px';
    var mask = 'url("' + sp.maskURL + '")';
    sw.style.webkitMaskImage = mask;
    sw.style.maskImage = mask;
    slot.sweepEl = sw;
    slot.style.width = sp.w + 'px';
    slot.style.height = sp.h + 'px';
    slot.style.marginLeft = (-sp.w / 2) + 'px';
    slot.style.marginTop = (-sp.cy) + 'px';
    slot.style.transformOrigin = (sp.w / 2) + 'px ' + sp.cy + 'px';
  };

  FX.prototype.mountPanel = function (sp) {
    var p = this.panel;
    if (p.sp === sp) return;
    p.sp = sp;
    $$('canvas', p).forEach(function (n) { n.remove(); });
    sp.img.className = 'fx-panel-img';
    sp.img.style.width = sp.w + 'px';
    sp.img.style.height = sp.h + 'px';
    p.insertBefore(sp.img, this.amount);
    p.style.width = sp.w + 'px';
    p.style.height = sp.h + 'px';
    p.style.marginLeft = (-sp.w / 2) + 'px';
    p.style.marginTop = (-sp.h / 2) + 'px';
  };

  // Start a presentation; resolves when it has fully faded out.
  FX.prototype.play = function (o) {
    var self = this;
    if (this.active) this.finishNow();
    return this.ensureSprites().then(function (sp) {
      return new Promise(function (resolve) {
        var tier = o.tier;
        var countDur = tier >= 3 ? 6.4 : tier === 2 ? 3.6 : 1.0;
        var hold = tier >= 3 ? 2.0 : tier === 2 ? 1.6 : 0.75;
        self.active = {
          o: o, tier: tier, t: 0, resolve: resolve,
          countStart: tier === 1 ? 0.18 : 0.6,
          countDur: countDur, hold: hold,
          shown: -1, outT: -1,
          upgraded: tier < 3 ? 1 : 0,   // SUPER starts as BIG WIN and upgrades mid-count
          chips: [], sparks: [], glints: [], ringFx: [],
          nextFountain: 0, nextFirework: 1.2, lastTick: 0, shake: 0,
          sweep: -1, nextSweep: 0.8,
          // hit-stop: seconds the clock stands still; a camera kick; the title's heartbeat
          freeze: 0, kick: 0, kickT: -1, landed: false, beat: 1.05, beatT: -1, nextBolt: 0, tickPop: -1
        };
        self.mountTitle(self.titleM, tier === 1 ? sp.win : sp.bigWin);
        self.mountTitle(self.titleS, sp.superT);
        self.mountPanel(tier === 1 ? sp.panelS : sp.panel);
        self.amount.style.fontSize = (tier === 1 ? 70 : 88) + 'px';
        self.amount.textContent = '0';
        self.root.classList.toggle('small', tier === 1);
        setStyle(self.root, 'transform', '');
        self.root.style.display = 'block';
        self.hit.classList.add('on');
        self.entry();
        self.last = U.now();
        self.frame();
      });
    });
  };

  FX.prototype.layout = function () {
    var a = this.active, cx = this.W / 2, cy = this.H / 2;
    if (a.tier === 1) return { title: { x: cx + 2, y: cy - 205 }, panel: { x: cx + 2, y: cy + 160 }, burst: { x: cx, y: cy - 190 }, line: cy - 39 };
    var sup = a.tier >= 3 && a.upgraded;
    return {
      title: { x: cx + 2, y: cy - 82 + (sup ? 30 : 0) },
      superT: { x: cx + 2, y: cy - 236 },
      panel: { x: cx + 2, y: cy + 136 + (sup ? 12 : 0) },
      burst: { x: cx, y: cy - 75 }
    };
  };

  FX.prototype.entry = function () {
    var a = this.active, L = this.layout();
    BR.sfx.play(a.tier === 1 ? 'win' : 'bigWin');
    this.burstSparks(L.burst.x, L.burst.y, a.tier === 1 ? 26 : 90, a.tier === 1 ? 520 : 1000, 0.1);
    if (a.tier >= 2) {
      this.explodeChips(L.burst.x, L.burst.y, 26, 0.12);
      a.shake = 0.35;
    } else {
      this.explodeChips(L.burst.x, L.burst.y + 30, 8, 0.15, 0.6);
    }
  };

  // The title hits the screen: everything stands still for a moment, then
  // the shock goes out (rings, sparks, a flash, the camera kicks back).
  FX.prototype.slam = function () {
    var a = this.active, L = this.layout(), J = BR.juice;
    a.landed = a.t;
    a.freeze = a.tier >= 2 ? 0.09 : 0.04;
    a.kickT = a.t;
    a.kick = a.tier >= 2 ? 0.07 : 0.03;
    if (a.tier < 2) return;
    a.ringFx.push({ t: 0, dur: 0.75, r0: 60, r1: 950 });
    a.ringFx.push({ t: -0.1, dur: 0.85, r0: 50, r1: 1350 });
    a.ringFx.push({ t: -0.22, dur: 0.95, r0: 40, r1: 1750 });
    a.shake = 0.6;
    this.burstSparks(L.title.x, L.title.y + 40, 70, 1300, 0);
    this.explodeChips(L.title.x, L.title.y + 60, 14, 0.02);
    if (J) {
      J.flash('#fff2c8', 0.5, 420);
      J.shake('#screen-slot', 14, 480);
      J.stars(L.title.x, L.title.y, { n: 8, r: 420, flat: 0.35, size: 120, life: 1 });
    }
  };

  // the title's heartbeat: a pulse, a ring and a spray of light
  FX.prototype.beat = function () {
    var a = this.active, L = this.layout(), J = BR.juice;
    a.beatT = a.t;
    var sup = a.tier >= 3 && a.upgraded;
    a.ringFx.push({ t: 0, dur: 0.7, r0: 200, r1: sup ? 1300 : 1000 });
    this.burstSparks(L.title.x, L.title.y, sup ? 34 : 20, sup ? 900 : 700, 0);
    if (J) J.stars(L.title.x, L.title.y, { n: sup ? 5 : 3, r: 380, flat: 0.3, size: 90 });
  };

  FX.prototype.explodeChips = function (x, y, n, delay, scale) {
    var a = this.active;
    scale = scale || 1;
    for (var i = 0; i < n; i++) {
      var ang = U.rand(-Math.PI * 0.95, -Math.PI * 0.05) + (U.random() < 0.25 ? Math.PI * U.rand(0.8, 1.2) : 0);
      var sp = U.rand(700, 1500) * scale;
      a.chips.push(new Chip({
        x: x + U.rand(-120, 120) * scale, y: y + U.rand(-30, 30),
        vx: Math.cos(ang) * sp * 1.25, vy: Math.sin(ang) * sp - U.rand(100, 400) * scale,
        r: U.rand(30, 60) * (0.7 + scale * 0.3), g: 1250, drag: 0.5, life: U.rand(2.4, 3.6),
        delay: delay + U.rand(0, 0.12), front: U.random() < 0.55
      }));
    }
  };

  FX.prototype.burstSparks = function (x, y, n, speed, delay) {
    var a = this.active;
    for (var i = 0; i < n; i++) {
      var ang = U.rand(0, TAU);
      var sp = U.rand(0.25, 1) * speed;
      a.sparks.push(new Spark({
        x: x + U.rand(-60, 60), y: y + U.rand(-20, 20),
        vx: Math.cos(ang) * sp * 1.35, vy: Math.sin(ang) * sp * 0.85,
        life: U.rand(0.7, 1.9), size: U.rand(2, 5.5), g: 240, drag: 1.4,
        hue: U.random() < 0.3 ? 1 : 0, delay: (delay || 0) + U.rand(0, 0.08)
      }));
    }
  };

  FX.prototype.firework = function () {
    var a = this.active;
    var x = U.rand(this.W * 0.18, this.W * 0.82), y = U.rand(this.H * 0.12, this.H * 0.45);
    var n = 40, col = U.randInt(0, 2);
    for (var i = 0; i < n; i++) {
      var ang = i / n * TAU + U.rand(-0.05, 0.05);
      var sp = U.rand(300, 430);
      a.sparks.push(new Spark({ x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: U.rand(1.0, 1.5), size: 3.4, g: 180, drag: 1.6, hue: 2 + col, streak: 0.05 }));
    }
    a.glints.push({ x: x, y: y, t: 0, dur: 0.5, s: 1.2 });
    BR.sfx.play('firework');
  };

  FX.prototype.skip = function () {
    var a = this.active;
    if (!a || a.outT >= 0) return;
    if (BR.juice) BR.juice.flash('#fff6dc', 0.22, 220);
    if (a.t - a.countStart < a.countDur) {
      // jump the counter to the end
      a.countStart = a.t - a.countDur;
      if (a.tier >= 3 && !a.upgraded) this.upgrade();
      if (!a.landed) this.slam();
      a.holdEnd = a.t + Math.min(0.9, a.hold);
    } else {
      a.outT = a.t;
    }
  };

  FX.prototype.finishNow = function () {
    var a = this.active;
    if (!a) return;
    this.active = null;
    this.hit.classList.remove('on');
    this.root.style.display = 'none';
    setStyle(this.root, 'transform', '');
    this.gb.setTransform(1, 0, 0, 1, 0, 0);
    this.gb.clearRect(0, 0, this.back.width, this.back.height);
    this.gf.setTransform(1, 0, 0, 1, 0, 0);
    this.gf.clearRect(0, 0, this.front.width, this.front.height);
    if (a.o.onCount) a.o.onCount(a.o.amount);
    a.resolve();
  };

  // SUPER comes flying in on top of BIG WIN ...
  FX.prototype.upgrade = function () {
    var a = this.active;
    a.upgraded = a.t;
    var L = this.layout();
    this.burstSparks(L.burst.x, L.burst.y - 80, 40, 900, 0);
    BR.sfx.play('superWin');
  };

  // ... and hits: the screen breaks like glass
  FX.prototype.superSlam = function () {
    var a = this.active, J = BR.juice;
    a.superLanded = a.t;
    var L = this.layout();
    a.ringFx.push({ t: 0, dur: 0.9, r0: 80, r1: 1300 });
    a.ringFx.push({ t: -0.1, dur: 1.0, r0: 60, r1: 1900 });
    a.ringFx.push({ t: -0.2, dur: 1.1, r0: 40, r1: 2400 });
    this.burstSparks(L.burst.x, L.burst.y - 80, 170, 1400, 0);
    this.explodeChips(L.burst.x, L.burst.y - 40, 36, 0);
    a.flash = a.t;
    a.shake = 0.8;
    a.freeze = 0.13;
    a.kickT = a.t;
    a.kick = 0.1;
    a.beat = a.t + 0.8;
    BR.sfx.play('impact');
    if (J) {
      // the screen breaks like glass where SUPER comes through, lightning everywhere
      var p = L.superT;
      J.flash('#ffffff', 0.9, 560);
      J.shards(p.x, p.y, { n: 40, speed: 1.25, size: 1.2 });
      for (var i = 0; i < 7; i++) {
        var ang = -Math.PI / 2 + (i - 3) * 0.5 + U.rand(-0.15, 0.15);
        J.bolt(p.x, p.y, p.x + Math.cos(ang) * 1000, p.y + Math.sin(ang) * 520 + 300, { amp: 70, segs: 14, dur: 0.45, w: 5, color: i % 2 ? 'blue' : 'white', delay: i * 0.025 });
      }
      J.shake('#screen-slot', 24, 760);
      J.confetti(this.W * 0.5, this.H * 0.45, { n: 70, speed: 1700, dir: -Math.PI / 2, spread: 1.4 });
      J.rain({ kind: 'confetti', dur: 4.5, rate: 22, delay: 0.5 });
    }
  };

  FX.prototype.frame = function () {
    var a = this.active;
    if (!a) return;
    var now = U.now();
    var dt = U.clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    try { this.step(a, dt); } catch (e) {
      if (window.console) console.warn(e);
      this.finishNow();
    }
  };

  FX.prototype.step = function (a, dt) {
    // hit-stop: the clock stands still for a moment (the picture stays on)
    if (a.freeze > 0) { a.freeze -= dt; dt = 0; }
    a.t += dt;
    var t = a.t;
    var J = BR.juice;
    var ct = t - a.countStart;
    var amount = a.o.amount;

    // counter
    var p = U.clamp(ct / a.countDur, 0, 1);
    var eased = a.tier === 1 ? E.outQuad(p) : 1 - Math.pow(1 - p, 1.7);
    var val = p >= 1 ? amount : Math.floor(amount * eased);
    if (val !== a.shown) {
      a.shown = val;
      this.amount.textContent = U.fmt(val);
      if (a.o.onCount) a.o.onCount(val);
      if (t - a.lastTick > (a.tier === 1 ? 0.06 : 0.075) && p > 0 && p < 1) { a.lastTick = t; a.tickPop = t; BR.sfx.play('tick', p); }
    }
    // the title lands, SUPER lands, the heartbeat goes on
    if (!a.landed && t >= (a.tier === 1 ? 0.5 : 0.36)) this.slam();
    if (a.tier >= 3 && !a.upgraded && p >= 0.36) this.upgrade();
    if (a.tier >= 3 && a.upgraded && !a.superLanded && t - a.upgraded >= 0.2) this.superSlam();
    if (a.tier >= 2 && a.landed && a.outT < 0 && t >= a.beat) { this.beat(); a.beat = t + 0.95; }
    // lightning round SUPER
    if (J && a.superLanded && a.outT < 0 && t >= a.nextBolt) {
      var Lb = this.layout(), side = U.random() < 0.5 ? -1 : 1;
      J.bolt(Lb.superT.x + side * U.rand(150, 330), Lb.superT.y + U.rand(-40, 40), Lb.superT.x + side * U.rand(600, 1000), U.rand(-20, this.H * 0.75), { amp: 55, segs: 12, dur: 0.3, w: 4, color: U.random() < 0.5 ? 'blue' : 'gold' });
      a.nextBolt = t + U.rand(0.35, 0.8);
    }
    if (p >= 1 && !a.countDone) {
      a.countDone = t;
      if (!a.holdEnd) a.holdEnd = t + a.hold;
      var L0 = this.layout(), k = a.tier === 1 ? 0.7 : 1;
      this.burstSparks(L0.panel.x, L0.panel.y, a.tier === 1 ? 24 : 60, a.tier === 1 ? 500 : 800, 0);
      a.glints.push({ x: L0.panel.x - 300 * k, y: L0.panel.y - 50, t: 0, dur: 0.7, s: 1 });
      a.glints.push({ x: L0.panel.x + 320 * k, y: L0.panel.y + 46, t: -0.12, dur: 0.7, s: 0.8 });
      BR.sfx.play('countEnd', a.tier);
      if (a.tier >= 2 && J) {
        // confetti cannons from both bottom corners, the camera kicks
        J.confetti(30, this.H - 10, { n: a.tier >= 3 ? 70 : 45, speed: 2100, dir: -Math.PI * 0.3, spread: 0.28 });
        J.confetti(this.W - 30, this.H - 10, { n: a.tier >= 3 ? 70 : 45, speed: 2100, dir: -Math.PI * 0.7, spread: 0.28 });
        J.ring(L0.panel.x, L0.panel.y, { r0: 100, r1: 700, dur: 0.6, w: 12, sy: 0.45 });
        J.flash('#fff6d8', 0.32, 360);
        J.shake('#screen-slot', 10, 380);
        a.kickT = t;
        a.kick = 0.045;
      }
    }
    if (a.countDone && a.outT < 0 && t >= a.holdEnd) a.outT = t;
    var outDur = a.tier === 1 ? 0.35 : 0.5;
    var out = a.outT >= 0 ? U.clamp((t - a.outT) / outDur, 0, 1) : 0;
    if (out >= 1) { this.finishNow(); return; }

    // continuous emitters
    if (a.tier >= 2 && a.outT < 0 && t > 0.6) {
      if (t >= a.nextFountain) {
        var Lf = this.layout();
        var fromLeft = U.random() < 0.5;
        var big = a.tier >= 3 && a.upgraded;
        a.chips.push(new Chip({
          x: fromLeft ? -60 : this.W + 60, y: U.rand(this.H * 0.45, this.H * 0.95),
          vx: (fromLeft ? 1 : -1) * U.rand(500, 900), vy: -U.rand(700, 1100),
          r: U.rand(32, 58), g: 1150, drag: 0.3, life: 3.2, front: U.random() < 0.7
        }));
        if (big) {
          a.chips.push(new Chip({ x: U.rand(0, this.W), y: -80, vx: U.rand(-80, 80), vy: U.rand(150, 380), r: U.rand(22, 40), g: 600, drag: 0.4, life: 3.5, front: U.random() < 0.5 }));
          this.burstSparks(Lf.burst.x + U.rand(-400, 400), Lf.burst.y + U.rand(-120, 60), 4, 420, 0);
        }
        a.nextFountain = t + (big ? 0.09 : 0.18);
      }
      if (a.tier >= 3 && a.upgraded && t >= a.nextFirework) { this.firework(); a.nextFirework = t + U.rand(0.5, 0.95); }
    }
    // orange ember streaks shooting out of the burst
    if (a.tier >= 2 && a.outT < 0) {
      var Le = this.layout(), rate = a.tier >= 3 && a.upgraded ? 70 : 42;
      a.emberAcc = (a.emberAcc || 0) + rate * dt;
      while (a.emberAcc >= 1) {
        a.emberAcc -= 1;
        var ea = U.rand(0, TAU), es = U.rand(500, 1150);
        a.sparks.push(new Spark({
          x: Le.burst.x + Math.cos(ea) * U.rand(40, 260), y: Le.burst.y + Math.sin(ea) * U.rand(20, 110),
          vx: Math.cos(ea) * es * 1.3, vy: Math.sin(ea) * es * 0.75,
          life: U.rand(0.6, 1.3), size: U.rand(2.2, 4.2), g: 120, drag: 0.9, hue: 2, streak: 0.055
        }));
      }
    }
    // ambient embers rising
    if (a.outT < 0 && U.random() < (a.tier === 1 ? 0.25 : 0.8)) {
      a.sparks.push(new Spark({ x: U.rand(this.W * 0.2, this.W * 0.8), y: this.H * U.rand(0.55, 0.9), vx: U.rand(-40, 40), vy: -U.rand(80, 260), life: U.rand(1.2, 2.4), size: U.rand(1.6, 3.4), g: -30, drag: 0.4, streak: 0.02 }));
    }

    a.chips = a.chips.filter(function (c) { return c.update(dt); });
    a.sparks = a.sparks.filter(function (s) { return s.update(dt); });
    if (a.sparks.length > 360) a.sparks.splice(0, a.sparks.length - 360);
    if (a.chips.length > 90) a.chips.splice(0, a.chips.length - 90);
    a.glints = a.glints.filter(function (gl) { gl.t += dt; return gl.t < gl.dur; });
    a.ringFx = a.ringFx.filter(function (r) { r.t += dt; return r.t < r.dur; });
    if (a.shake > 0) a.shake = Math.max(0, a.shake - dt);
    // periodic light sweep over the titles
    if (a.sweep < 0 && t >= a.nextSweep) { a.sweep = 0; a.nextSweep = t + 2.2; }
    if (a.sweep >= 0) { a.sweep += dt / 0.8; if (a.sweep > 1) a.sweep = -1; }

    requestAnimationFrame(this._loop);
    this.render(out);
  };

  function setStyle(node, key, val) {
    var c = node._c || (node._c = {});
    if (c[key] !== val) { c[key] = val; node.style[key] = val; }
  }
  function f3(v) { return Math.round(v * 1000) / 1000; }

  FX.prototype.render = function (out) {
    var a = this.active, sp = this.sprites, t = a.t;
    var L = this.layout();
    var fade = 1 - E.inQuad(out);
    var big = a.tier >= 2;
    var sup = a.tier >= 3 && a.upgraded;

    // dim (the small WIN keeps the pay line visible through a CSS mask)
    var dim = (big ? 0.84 : 0.5) * E.outCubic(U.clamp(t / 0.3, 0, 1)) * fade;
    setStyle(this.dim, 'opacity', f3(dim));
    if (!big) {
      var m = 'linear-gradient(to bottom, #000 0, #000 ' + (L.line - 125) + 'px, transparent ' + (L.line - 75) + 'px, transparent ' + (L.line + 75) + 'px, #000 ' + (L.line + 125) + 'px, #000 100%)';
      setStyle(this.dim, 'webkitMaskImage', m);
      setStyle(this.dim, 'maskImage', m);
    } else {
      setStyle(this.dim, 'webkitMaskImage', 'none');
      setStyle(this.dim, 'maskImage', 'none');
    }

    // the camera kicks back when something hits
    var kick = 0;
    if (a.kickT >= 0) { var kp = (t - a.kickT) / 0.42; if (kp < 1) kick = a.kick * (1 - kp) * (1 - kp); }
    setStyle(this.root, 'transform', kick > 0.0005 ? 'scale(' + (1 + kick).toFixed(4) + ')' : '');

    // camera shake for the burst/title/panel groups
    var shx = 0, shy = 0;
    if (a.shake > 0) { var k = a.shake * a.shake * 26; shx = U.rand(-k, k); shy = U.rand(-k, k); }
    var shake = 'translate(' + shx.toFixed(1) + 'px,' + shy.toFixed(1) + 'px)';
    setStyle(this.titles, 'transform', shake);
    setStyle(this.panelWrap, 'transform', shake);

    // light burst: two counter-rotating ray sheets + soft glow + shock rings
    var bIn = E.outCubic(U.clamp((t - 0.05) / 0.6, 0, 1));
    var bScale = (big ? 1 : 0.62) * (0.3 + 0.7 * bIn) * (1 + 0.025 * Math.sin(t * 2.2)) * (sup ? 1.18 : 1);
    setStyle(this.burst, 'transform', 'translate(' + (L.burst.x + shx).toFixed(1) + 'px,' + (L.burst.y + shy).toFixed(1) + 'px)');
    var ra = 0.42 * bIn * fade * (sup ? 1.3 : 1);
    var rs = 1800 * bScale / 1024;
    setStyle(this.raysA, 'opacity', f3(Math.min(1, ra)));
    setStyle(this.raysA, 'transform', 'scale(1.25,0.82) rotate(' + (t * 0.12).toFixed(4) + 'rad) scale(' + rs.toFixed(4) + ')');
    setStyle(this.raysB, 'opacity', f3(Math.min(1, ra * 0.7)));
    setStyle(this.raysB, 'transform', 'scale(1.25,0.82) rotate(' + (-t * 0.08 + 0.4).toFixed(4) + 'rad) scale(' + (rs * 0.9).toFixed(4) + ')');
    // SUPER: rainbow rays turning the other way
    var rb = sup && a.superLanded ? U.clamp((t - a.superLanded) / 0.5, 0, 1) : 0;
    setStyle(this.raysR, 'opacity', f3(0.6 * rb * fade));
    setStyle(this.raysR, 'transform', 'scale(1.25,0.82) rotate(' + (-t * 0.18 + 1).toFixed(4) + 'rad) scale(' + (rs * 1.12).toFixed(4) + ')');
    // the sunburst behind it all
    var sunA = (big ? 0.5 : 0.22) * bIn * fade * (sup ? 1.3 : 1) * (0.85 + 0.15 * Math.sin(t * 3.2));
    var sunS = (big ? 2.7 : 1.6) * (0.45 + 0.55 * bIn) * (sup ? 1.15 : 1);
    setStyle(this.sun, 'opacity', f3(Math.min(1, sunA)));
    setStyle(this.sun, 'transform', 'scale(' + sunS.toFixed(4) + ',' + (sunS * 0.72).toFixed(4) + ') rotate(' + (t * (sup ? 0.45 : 0.2)).toFixed(4) + 'rad)');
    // stage beams sweeping from the bottom corners
    for (var bi = 0; bi < this.beams.length; bi++) {
      var side = bi ? -1 : 1;
      var ang = side * (18 + 15 * Math.sin(t * (sup ? 1.9 : 1.25) + bi * 1.7));
      setStyle(this.beams[bi], 'opacity', f3((big ? 0.55 : 0) * bIn * fade * (sup ? 1.3 : 1)));
      setStyle(this.beams[bi], 'transform', 'rotate(' + ang.toFixed(2) + 'deg)');
    }
    var gs = (big ? 1150 : 700) * (0.4 + 0.6 * bIn) * (sup ? 1.2 : 1) / 512;
    setStyle(this.glow, 'opacity', f3((big ? 0.95 : 0.7) * bIn * fade));
    setStyle(this.glow, 'transform', 'scale(' + (gs * 1.45).toFixed(4) + ',' + (gs * 0.62).toFixed(4) + ')');
    // horizontal lens-flare streak through the title
    var stA = (big ? 0.95 : 0.6) * bIn * fade * (0.85 + 0.15 * Math.sin(t * 5.3));
    setStyle(this.streak, 'opacity', f3(stA));
    setStyle(this.streak, 'transform', 'translateY(' + (L.title.y - L.burst.y) + 'px) scale(' + ((big ? 1 : 0.6) * (0.5 + 0.5 * bIn)).toFixed(4) + ',1)');
    for (var ri = 0; ri < this.rings.length; ri++) {
      var R = a.ringFx[ri], node = this.rings[ri];
      if (!R || R.t < 0) { setStyle(node, 'opacity', '0'); continue; }
      var rp = R.t / R.dur;
      var rad = R.r0 + (R.r1 - R.r0) * E.outCubic(rp);
      setStyle(node, 'opacity', f3(0.9 * (1 - rp) * (1 - rp) * fade));
      setStyle(node, 'transform', 'scale(' + (rad / 256).toFixed(4) + ',' + (rad * 0.58 / 256).toFixed(4) + ')');
    }

    // titles: they fall in faster and faster, hit, squash and spring back,
    // then keep beating
    var breathe = 1 + 0.012 * Math.sin(t * 3.1);
    var outScale = 1 + 0.18 * E.inQuad(out);
    var pulse = a.beatT >= 0 ? 1 + 0.085 * Math.sin(Math.min(1, (t - a.beatT) / 0.28) * Math.PI) : 1;
    var ts, ta, sq = [1, 1];
    if (big) {
      var tl = t - 0.1;
      ts = fallIn(tl, 0.26, 3.4);
      sq = squash(tl - 0.26, 0.55, 0.22);
      ta = E.outQuad(U.clamp(tl / 0.14, 0, 1));
    } else {
      var tIn = U.clamp((t - 0.12) / 0.55, 0, 1);
      ts = tIn < 1 ? 2.3 - 1.3 * E.outBack(tIn, 1.9) : 1;
      ta = E.outQuad(U.clamp(tIn * 3, 0, 1));
    }
    this.placeTitle(this.titleM, L.title, ts * breathe * outScale * pulse, ta * fade, sq[0], sq[1]);
    if (sup) {
      var ul = t - a.upgraded;
      var usq = squash(ul - 0.2, 0.5, 0.26);
      this.placeTitle(this.titleS, L.superT, fallIn(ul, 0.2, 3.6) * breathe * outScale * pulse, E.outQuad(U.clamp(ul / 0.12, 0, 1)) * fade, usq[0], usq[1]);
    } else {
      setStyle(this.titleS, 'opacity', '0');
    }

    // panel + amount
    var pIn = U.clamp((t - (a.tier === 1 ? 0.1 : 0.4)) / 0.42, 0, 1);
    var pScale = (0.55 + 0.45 * E.outBack(pIn, 1.6)) * (1 - 0.06 * E.inQuad(out));
    var pop = a.countDone ? 1 + 0.26 * Math.max(0, 1 - (t - a.countDone) / 0.35) * Math.sin(Math.min(1, (t - a.countDone) / 0.35) * Math.PI) : 1;
    if (!a.countDone && a.tickPop >= 0) pop *= 1 + 0.045 * Math.max(0, 1 - (t - a.tickPop) / 0.1);
    setStyle(this.panel, 'opacity', f3(E.outQuad(pIn) * fade));
    setStyle(this.panel, 'transform', 'translate(' + L.panel.x + 'px,' + L.panel.y + 'px) scale(' + pScale.toFixed(4) + ')');
    setStyle(this.amount, 'transform', 'scale(' + pop.toFixed(4) + ')');

    // flash
    var fl = Math.max(0, 1 - (t - 0.08) / 0.32);
    if (a.flash) fl = Math.max(fl, 1 - (t - a.flash) / 0.4);
    setStyle(this.flash, 'opacity', f3(U.clamp(fl, 0, 1) * (big ? 0.55 : 0.3)));

    // particles
    var pr = this.pres;
    var gb = this.gb, gf = this.gf;
    gb.setTransform(1, 0, 0, 1, 0, 0);
    gb.clearRect(0, 0, this.back.width, this.back.height);
    gf.setTransform(1, 0, 0, 1, 0, 0);
    gf.clearRect(0, 0, this.front.width, this.front.height);
    gb.setTransform(pr, 0, 0, pr, 0, 0);
    gf.setTransform(pr, 0, 0, pr, 0, 0);
    this.drawChips(gb, false, fade);
    this.drawSparks(gb, fade, true);
    this.drawChips(gf, true, fade);
    this.drawSparks(gf, fade, false);
    gf.globalCompositeOperation = 'lighter';
    for (var gi = 0; gi < a.glints.length; gi++) {
      var gl = a.glints[gi];
      if (gl.t < 0) continue;
      var gp = gl.t / gl.dur;
      var gsz = 220 * gl.s * Math.sin(gp * Math.PI);
      gf.save();
      gf.translate(gl.x, gl.y);
      gf.rotate(gp * 0.8);
      gf.globalAlpha = fade;
      gf.drawImage(sp.flare, -gsz / 2, -gsz / 2, gsz, gsz);
      gf.restore();
    }
    // cycling glints on the title edges
    if (t > 0.7 && out === 0) {
      var cyc = (t * 0.9) % 1;
      var pts = a.tier === 1 ? [[-150, -60], [140, 40]] : [[-400, -70], [-40, -95], [300, -80], [420, 60]];
      var q = pts[Math.floor(t * 0.9) % pts.length];
      var s2 = 150 * Math.sin(cyc * Math.PI);
      gf.globalAlpha = 0.9;
      gf.drawImage(sp.flare, L.title.x + q[0] - s2 / 2, L.title.y + q[1] - s2 / 2, s2, s2);
    }
    gf.globalAlpha = 1;
    gf.globalCompositeOperation = 'source-over';
  };

  // falling towards the screen: from `from` times its size down to 1 in `dur` s, accelerating
  function fallIn(t, dur, from) {
    var u = U.clamp(t / dur, 0, 1);
    return from - (from - 1) * u * u;
  }
  // after a hit: wider and flatter, springing back to shape ([sx, sy])
  function squash(t, dur, amt) {
    if (t < 0 || t >= dur) return [1, 1];
    var v = t / dur, k = Math.exp(-4.5 * v) * Math.cos(v * 15);
    return [1 + amt * k, 1 - amt * k];
  }

  FX.prototype.placeTitle = function (slot, pos, scale, alpha, sx, sy) {
    var a = this.active;
    setStyle(slot, 'opacity', f3(alpha));
    setStyle(slot, 'transform', 'translate(' + pos.x + 'px,' + pos.y + 'px) scale(' + (scale * (sx || 1)).toFixed(4) + ',' + (scale * (sy || 1)).toFixed(4) + ')');
    var sw = slot.sweepEl;
    if (!sw) return;
    if (a.sweep >= 0) {
      setStyle(sw, 'opacity', '1');
      setStyle(sw, 'backgroundPosition', (90 - a.sweep * 80).toFixed(1) + '% 0');
    } else {
      setStyle(sw, 'opacity', '0');
    }
  };

  FX.prototype.drawChips = function (g, front, fade) {
    var a = this.active, face = this.sprites.chip;
    for (var i = 0; i < a.chips.length; i++) {
      var c = a.chips[i];
      if (c.front === front) c.draw(g, face, fade);
    }
  };

  var HUES = [
    ['rgba(255,236,170,', 'rgba(255,170,50,'],
    ['rgba(255,255,230,', 'rgba(255,210,120,'],
    ['rgba(255,220,120,', 'rgba(255,80,40,'],
    ['rgba(220,255,240,', 'rgba(60,220,140,'],
    ['rgba(230,220,255,', 'rgba(170,110,255,']
  ];

  FX.prototype.drawSparks = function (g, fade, back) {
    var a = this.active, glow = this.sprites.glow;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (var i = back ? 0 : 1; i < a.sparks.length; i += 2) {
      var s = a.sparks[i];
      if (s.delay > 0) continue;
      var lp = s.age / s.life;
      var al = (lp < 0.1 ? lp / 0.1 : 1 - (lp - 0.1) / 0.9) * fade;
      if (al <= 0.01) continue;
      var col = HUES[s.hue] || HUES[0];
      var tx = s.x - s.vx * s.streak, ty = s.y - s.vy * s.streak;
      g.strokeStyle = col[1] + (al * 0.9) + ')';
      g.lineWidth = s.size;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(s.x, s.y);
      g.stroke();
      g.strokeStyle = col[0] + al + ')';
      g.lineWidth = s.size * 0.45;
      g.stroke();
      if (s.size > 3) {
        var gz = s.size * 5;
        g.globalAlpha = al * 0.5;
        g.drawImage(glow, s.x - gz / 2, s.y - gz / 2, gz, gz);
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = 'source-over';
  };

  BR.FX = FX;
  BR.fxSprites = { titleSprite: titleSprite, STYLE_RED: STYLE_RED, STYLE_GOLD: STYLE_GOLD, panelSprite: panelSprite, drawChip: drawChip };
})(window.BR = window.BR || {});
