/* Effects for every moment of the game outside the big win overlay
   (js/render/fx.js): one canvas over the whole stage for particles (sparks,
   twinkling stars, chips and coins, confetti, glass shards), shock rings,
   light blooms and lightning, plus flashes, camera shakes, floating labels,
   banners and coins that fly into the wallet. Positions are design px of the
   stage; at(node) finds an element there whatever the scale, also on the
   turned (portrait) stage. The canvas only runs while something is on it,
   and every tap on a button answers with a small burst of light. What the
   player switched off in 演出設定 (js/core/effects.js) is left out here:
   particles, coins, flashes, shakes, bumps and celebrations each have their
   switch; whatever waits for a flight (a count, a callback) still runs. */
(function (BR) {
  'use strict';

  var U = BR.util, E = U.ease;
  var $ = U.$;
  var TAU = Math.PI * 2;
  // looks only: no need for the CSPRNG here
  function rr(a, b) { return a + (b - a) * Math.random(); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  // 演出設定: is this kind of effect on?
  function fxOn(k) { return !BR.fx || BR.fx.on(k); }

  var stage = null, cv = null, g = null, flashEl = null;
  var W = 2000, H = 924, pres = 1;
  var parts = [], rings = [], blooms = [], bolts = [];
  var running = false, last = 0;
  var img = {};
  var MAX = 700;
  var calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  // a phone that cannot keep up (frames well under 40 a second while effects
  // run) gets lighter effects for the rest of the session: half the
  // particles, no trails, and css/juice.css drops the heaviest extras
  var low = false, slowFor = 0, frameAvg = 16.7;

  // [core, edge] of each colour, as "r,g,b"
  var COL = {
    gold: ['255,248,215', '255,176,40'],
    white: ['255,255,255', '255,226,150'],
    red: ['255,225,205', '255,64,48'],
    green: ['226,255,236', '60,226,124'],
    blue: ['226,244,255', '70,165,255'],
    purple: ['242,228,255', '176,104,255'],
    pink: ['255,226,242', '255,86,170'],
    fire: ['255,240,190', '255,98,24']
  };
  var RAINBOW = ['red', 'gold', 'green', 'blue', 'purple', 'pink'];
  var CONFETTI = ['#ffe27a', '#ff5e5e', '#6ee682', '#5ec8ff', '#d68bff', '#ffffff', '#ffb84d', '#ff7ac8'];
  function col(c) { return c === 'rainbow' ? COL[pick(RAINBOW)] : COL[c] || COL.gold; }

  // kinds of particle
  var SPARK = 0, STAR = 1, PIC = 2, CONF = 3, SHARD = 4, SMOKE = 5;

  /* ------------------------------------------------------------ sprites --- */
  function sprite(size, draw) {
    var c = BR.assets.makeCanvas(size, size);
    draw(c.getContext('2d'), size / 2);
    return c;
  }
  function buildSprites() {
    img.glow = sprite(64, function (x, r) {
      var gr = x.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, 'rgba(255,255,245,1)');
      gr.addColorStop(0.22, 'rgba(255,232,150,0.85)');
      gr.addColorStop(0.55, 'rgba(255,160,40,0.28)');
      gr.addColorStop(1, 'rgba(255,120,0,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 2 * r, 2 * r);
    });
    // four-point star with a soft core
    img.star = sprite(128, function (x, r) {
      x.translate(r, r);
      var gr = x.createRadialGradient(0, 0, 0, 0, 0, r * 0.42);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.35, 'rgba(255,244,200,0.6)');
      gr.addColorStop(1, 'rgba(255,200,80,0)');
      x.fillStyle = gr;
      x.fillRect(-r, -r, 2 * r, 2 * r);
      x.globalCompositeOperation = 'lighter';
      for (var k = 0; k < 4; k++) {
        x.save();
        x.rotate(k * Math.PI / 2);
        var lg = x.createLinearGradient(0, 0, r, 0);
        lg.addColorStop(0, 'rgba(255,255,255,1)');
        lg.addColorStop(1, 'rgba(255,220,140,0)');
        x.fillStyle = lg;
        x.beginPath();
        x.moveTo(0, -r * 0.07);
        x.quadraticCurveTo(r * 0.3, 0, r, 0);
        x.quadraticCurveTo(r * 0.3, 0, 0, r * 0.07);
        x.fill();
        x.restore();
      }
    });
    // a soft grey puff (painted over, not added: smoke darkens)
    img.smoke = sprite(64, function (x, r) {
      var gr = x.createRadialGradient(r, r, 0, r, r, r);
      gr.addColorStop(0, 'rgba(150,138,132,0.55)');
      gr.addColorStop(0.5, 'rgba(130,120,115,0.24)');
      gr.addColorStop(1, 'rgba(120,110,105,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, 2 * r, 2 * r);
    });
    var art = BR.UI_IMG || {};
    ['chip', 'dollar', 'coin'].forEach(function (k) {
      if (!art[k]) return;
      var im = new Image();
      im.src = art[k];
      img[k] = im;
    });
  }

  /* ------------------------------------------------------------ setup --- */
  function init() {
    stage = $('#stage');
    cv = document.createElement('canvas');
    cv.className = 'jc-canvas';
    cv.setAttribute('aria-hidden', 'true');
    stage.appendChild(cv);
    g = cv.getContext('2d');
    flashEl = document.createElement('div');
    flashEl.className = 'jc-flash';
    stage.appendChild(flashEl);
    buildSprites();
    // every tap on a button in the stage answers with light
    document.addEventListener('pointerdown', onPress, true);
  }

  function resize(w, h, res) {
    W = w; H = h;
    // glows and sparks stay soft anyway: fewer pixels to fill on every frame
    pres = Math.min(res || 1, 0.8);
    if (!cv) return;
    cv.width = Math.round(W * pres);
    cv.height = Math.round(H * pres);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    if (running) draw();
  }

  /* ------------------------------------------------------------ positions --- */
  // a point on the screen -> design px of the stage (also when it is turned)
  function toStage(cx, cy) {
    var v = BR.app && BR.app.view;
    var sr = stage.getBoundingClientRect();
    var s = (v && v.s) || 1;
    if (v && v.portrait) return { x: (cy - sr.top) / s, y: (sr.right - cx) / s };
    return { x: (cx - sr.left) / s, y: (cy - sr.top) / s };
  }
  // the centre of an element (or a point given as {x, y}) in stage px
  function at(n, dx, dy) {
    if (!n) return { x: W / 2, y: H / 2 };
    if (typeof n === 'string') n = $(n);
    if (!n) return { x: W / 2, y: H / 2 };
    if (typeof n.x === 'number' && !n.getBoundingClientRect) return { x: n.x + (dx || 0), y: n.y + (dy || 0) };
    var r = n.getBoundingClientRect();
    var p = toStage(r.left + r.width / 2, r.top + r.height / 2);
    p.x += dx || 0; p.y += dy || 0;
    return p;
  }
  // the size of an element in stage px
  function sizeOf(n) {
    if (typeof n === 'string') n = $(n);
    if (!n || !n.getBoundingClientRect) return { w: 0, h: 0 };
    var r = n.getBoundingClientRect(), v = BR.app && BR.app.view, s = (v && v.s) || 1;
    return v && v.portrait ? { w: r.height / s, h: r.width / s } : { w: r.width / s, h: r.height / s };
  }
  function visible(n) {
    if (typeof n === 'string') n = $(n);
    if (!n || !n.getBoundingClientRect) return false;
    var r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  /* ------------------------------------------------------------ the loop --- */
  function wake() {
    if (running || !cv) return;
    running = true;
    last = U.now();
    requestAnimationFrame(frame);
  }
  function frame() {
    var now = U.now();
    watchSpeed(now - last);
    var dt = U.clamp((now - last) / 1000, 0, 0.05);
    last = now;
    try { step(dt); draw(); } catch (e) {
      if (window.console) console.warn(e);
      parts = []; rings = []; blooms = []; bolts = [];
    }
    if (parts.length || rings.length || blooms.length || bolts.length) requestAnimationFrame(frame);
    else {
      running = false;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.width, cv.height);
    }
  }

  function watchSpeed(ms) {
    if (low || ms <= 0 || ms > 250 || document.hidden) return;
    frameAvg += (ms - frameAvg) * 0.08;
    slowFor = frameAvg > 27 ? slowFor + ms : Math.max(0, slowFor - ms * 0.5);
    if (slowFor > 2500) {
      low = true;
      MAX = 360;
      document.documentElement.classList.add('jc-low');
    }
  }

  function step(dt) {
    var keep = [], arrived = [], born = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.delay > 0) { p.delay -= dt; keep.push(p); continue; }
      p.age += dt;
      if (p.age >= p.life) { if (p.arrive) arrived.push(p); continue; }
      if (p.path) {
        var t = p.ease(p.age / p.life), u = 1 - t, q = p.path;
        var nx = u * u * q[0] + 2 * u * t * q[2] + t * t * q[4];
        var ny = u * u * q[1] + 2 * u * t * q[3] + t * t * q[5];
        p.vx = (nx - p.x) / Math.max(dt, 1e-4); p.vy = (ny - p.y) / Math.max(dt, 1e-4);
        p.x = nx; p.y = ny;
        // a glittering trail behind each coin on its way
        if (p.trail && !calm && !low) {
          p.tAcc = (p.tAcc || 0) + dt;
          if (p.tAcc > 0.045) {
            p.tAcc = 0;
            born.push({ k: SPARK, x: p.x + rr(-6, 6), y: p.y + rr(-6, 6), vx: rr(-60, 60), vy: rr(-40, 60), life: rr(0.25, 0.45), size: rr(1.6, 3), g: 240, drag: 2, c: COL[p.trail], streak: 0.03, age: 0, delay: 0, rot: 0, vr: 0, flip: 0, vf: 0, a: 0.9, fin: 0.1, ph: 0 });
          }
        }
      } else {
        var d = Math.exp(-p.drag * dt);
        p.vx *= d;
        p.vy = p.vy * d + p.g * dt;
        if (p.wob) p.vx += Math.sin(p.age * p.wob + p.ph) * 520 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      p.rot += p.vr * dt;
      p.flip += p.vf * dt;
      keep.push(p);
    }
    parts = born.length && keep.length < MAX ? keep.concat(born.slice(0, MAX - keep.length)) : keep;
    rings = rings.filter(function (r) { r.t += dt; return r.t < r.dur; });
    blooms = blooms.filter(function (b) { b.t += dt; return b.t < b.dur; });
    bolts = bolts.filter(function (b) {
      b.t += dt;
      b.re -= dt;
      if (b.re <= 0) { b.pts = jag(b); b.re = 0.05; }
      return b.t < b.dur;
    });
    arrived.forEach(function (p) { p.arrive(p); });
  }

  function draw() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.setTransform(pres, 0, 0, pres, 0, 0);
    var i, p, a;
    // light blooms and shock rings (additive)
    g.globalCompositeOperation = 'lighter';
    for (i = 0; i < blooms.length; i++) {
      var b = blooms[i];
      if (b.t < 0) continue;
      var bp = b.t / b.dur;
      a = (bp < 0.18 ? bp / 0.18 : 1 - (bp - 0.18) / 0.82) * b.a;
      var bs = b.size * (0.6 + 0.4 * E.outCubic(bp));
      g.globalAlpha = Math.max(0, a);
      g.drawImage(img.glow, b.x - bs / 2, b.y - bs * b.sy / 2, bs, bs * b.sy);
    }
    g.globalAlpha = 1;
    for (i = 0; i < rings.length; i++) {
      var R = rings[i];
      if (R.t < 0) continue;
      var rp = R.t / R.dur;
      var rad = R.r0 + (R.r1 - R.r0) * E.outCubic(rp);
      a = Math.pow(1 - rp, 1.6);
      g.save();
      g.translate(R.x, R.y);
      g.scale(1, R.sy);
      g.beginPath();
      g.arc(0, 0, Math.max(1, rad), 0, TAU);
      g.lineWidth = Math.max(0.5, R.w * (1 - rp * 0.7));
      g.strokeStyle = 'rgba(' + R.c[1] + ',' + (0.85 * a) + ')';
      g.stroke();
      g.lineWidth = Math.max(0.5, R.w * 0.38 * (1 - rp * 0.7));
      g.strokeStyle = 'rgba(' + R.c[0] + ',' + a + ')';
      g.stroke();
      g.restore();
    }
    // lightning
    for (i = 0; i < bolts.length; i++) {
      var B = bolts[i];
      var bl = B.t / B.dur;
      a = (bl < 0.1 ? 1 : 1 - (bl - 0.1) / 0.9) * (0.65 + 0.35 * Math.random());
      g.lineJoin = 'round';
      g.lineCap = 'round';
      [[B.w * 3.2, B.c[1], 0.35], [B.w, B.c[1], 0.9], [B.w * 0.4, B.c[0], 1]].forEach(function (L) {
        g.beginPath();
        g.moveTo(B.pts[0], B.pts[1]);
        for (var k = 2; k < B.pts.length; k += 2) g.lineTo(B.pts[k], B.pts[k + 1]);
        g.lineWidth = L[0];
        g.strokeStyle = 'rgba(' + L[1] + ',' + (a * L[2]) + ')';
        g.stroke();
      });
    }
    // solid things: chips and coins, confetti, shards
    g.globalCompositeOperation = 'source-over';
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (p.delay > 0 || p.k === SPARK || p.k === STAR) continue;
      a = fade(p);
      if (a <= 0.01) continue;
      g.globalAlpha = a;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      if (p.k === PIC) {
        var pic = img[p.pic];
        var fx = Math.cos(p.flip);
        g.scale(Math.max(0.06, Math.abs(fx)), 1);
        if (pic && pic.complete && pic.naturalWidth) g.drawImage(pic, -p.size / 2, -p.size / 2, p.size, p.size);
        else { g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(0, 0, p.size / 2, 0, TAU); g.fill(); }
      } else if (p.k === CONF) {
        var fy = Math.cos(p.flip);
        g.scale(1, fy);
        g.fillStyle = p.color;
        g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        if (fy < 0) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6); }
      } else if (p.k === SMOKE) {
        var sz = p.size * (0.5 + p.age / p.life);
        g.drawImage(img.smoke, -sz / 2, -sz / 2, sz, sz);
      } else if (p.k === SHARD) {
        // glass: clear with a bright edge and a glint that flickers as it turns
        var sh = p.shape;
        g.beginPath();
        g.moveTo(sh[0], sh[1]);
        g.lineTo(sh[2], sh[3]);
        g.lineTo(sh[4], sh[5]);
        g.closePath();
        g.fillStyle = 'rgba(225,242,255,0.3)';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.stroke();
        g.lineWidth = 1.4;
        g.strokeStyle = 'rgba(255,255,255,' + (0.35 + 0.65 * Math.abs(Math.sin(p.age * 14 + p.ph))) + ')';
        g.beginPath();
        g.moveTo(sh[0] * 0.55, sh[1] * 0.55);
        g.lineTo(sh[2] * 0.25, sh[3] * 0.25);
        g.stroke();
      }
      g.restore();
    }
    g.globalAlpha = 1;
    // light: sparks, stars, dots (additive)
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (p.delay > 0) continue;
      if (p.k === SPARK) {
        a = fade(p);
        if (a <= 0.01) continue;
        var tx = p.x - p.vx * p.streak, ty = p.y - p.vy * p.streak;
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(p.x, p.y);
        g.strokeStyle = 'rgba(' + p.c[1] + ',' + (a * 0.9) + ')';
        g.lineWidth = p.size;
        g.stroke();
        g.strokeStyle = 'rgba(' + p.c[0] + ',' + a + ')';
        g.lineWidth = p.size * 0.42;
        g.stroke();
        if (p.size > 3) {
          var gz = p.size * 5.5;
          g.globalAlpha = a * 0.45;
          g.drawImage(img.glow, p.x - gz / 2, p.y - gz / 2, gz, gz);
          g.globalAlpha = 1;
        }
      } else if (p.k === STAR) {
        a = fade(p) * (p.tw ? 0.55 + 0.45 * Math.sin(p.age * p.tw + p.ph) : 1);
        if (a <= 0.01) continue;
        var ss = p.size * (p.grow ? Math.sin(Math.min(1, p.age / p.life) * Math.PI) : 1);
        g.globalAlpha = a;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.drawImage(img.star, -ss / 2, -ss / 2, ss, ss);
        g.restore();
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  // in quickly, out slowly (things on their way somewhere stay until they get there)
  function fade(p) {
    var lp = p.age / p.life;
    if (p.path) return (lp < p.fin ? lp / p.fin : 1) * p.a;
    var a = lp < p.fin ? lp / p.fin : 1 - (lp - p.fin) / (1 - p.fin);
    return Math.max(0, Math.min(1, a)) * p.a;
  }

  // (chips and coins are 演出設定's coins, everything else its particles)
  function add(p) {
    if (parts.length >= MAX || !fxOn(p.k === PIC ? 'coins' : 'particles')) return null;
    p.age = 0;
    p.delay = p.delay || 0;
    p.rot = p.rot || 0; p.vr = p.vr || 0;
    p.flip = p.flip || 0; p.vf = p.vf || 0;
    p.drag = p.drag === undefined ? 1 : p.drag;
    p.g = p.g || 0;
    p.a = p.a === undefined ? 1 : p.a;
    p.fin = p.fin || 0.08;
    p.ph = p.ph || rr(0, TAU);
    parts.push(p);
    wake();
    return p;
  }
  function n(k) { return Math.max(1, Math.round(k * (calm ? 0.35 : low ? 0.5 : 1))); }

  /* ------------------------------------------------------------ building blocks --- */
  // sparks flying out of a point: o = { n, speed, colors, size, life, g, up, spread, delay }
  function sparks(x, y, o) {
    o = o || {};
    var cnt = n(o.n || 18), sp = o.speed || 700;
    for (var i = 0; i < cnt; i++) {
      var ang = o.dir === undefined ? rr(0, TAU) : o.dir + rr(-1, 1) * (o.spread || 0.6);
      var v = rr(0.3, 1) * sp;
      add({
        k: SPARK, x: x + rr(-1, 1) * (o.jx || 6), y: y + rr(-1, 1) * (o.jy || 6),
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * (o.flat || 1) - (o.up || 0),
        life: rr(0.45, 1) * (o.life || 0.9), size: rr(2, 5) * (o.size || 1),
        g: o.g === undefined ? 520 : o.g, drag: o.drag === undefined ? 1.8 : o.drag,
        c: col(o.color || 'gold'), streak: o.streak || 0.035, delay: (o.delay || 0) + rr(0, o.stagger || 0.05)
      });
    }
  }
  // twinkling stars: o = { n, r (radius around the point), size, life, color }
  function stars(x, y, o) {
    o = o || {};
    var cnt = n(o.n || 8);
    for (var i = 0; i < cnt; i++) {
      var ang = rr(0, TAU), d = rr(0.2, 1) * (o.r || 80);
      add({
        k: STAR, x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d * (o.flat || 1),
        vx: Math.cos(ang) * (o.speed || 60), vy: Math.sin(ang) * (o.speed || 60) - (o.up || 0),
        life: rr(0.5, 1) * (o.life || 0.9), size: rr(0.5, 1) * (o.size || 70),
        drag: 1.2, g: o.g || 0, vr: rr(-2, 2), grow: true, tw: rr(10, 18), delay: (o.delay || 0) + rr(0, o.stagger || 0.25)
      });
    }
  }
  // chips / coins: o = { n, pic: 'chip'|'dollar'|'coin', speed, size, life, up, g, dir, spread }
  function coins(x, y, o) {
    o = o || {};
    var cnt = n(o.n || 10);
    for (var i = 0; i < cnt; i++) {
      var ang = o.dir === undefined ? rr(-Math.PI * 0.95, -Math.PI * 0.05) : o.dir + rr(-1, 1) * (o.spread || 0.5);
      var v = rr(0.45, 1) * (o.speed || 900);
      add({
        k: PIC, pic: o.pic || 'chip', x: x + rr(-1, 1) * (o.jx || 20), y: y + rr(-1, 1) * (o.jy || 10),
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - (o.up || 0),
        life: rr(0.7, 1) * (o.life || 1.6), size: rr(0.7, 1.15) * (o.size || 54),
        g: o.g === undefined ? 1700 : o.g, drag: 0.6, vr: rr(-4, 4), flip: rr(0, TAU), vf: rr(7, 15),
        fin: 0.02, delay: (o.delay || 0) + rr(0, o.stagger || 0.08)
      });
    }
  }
  // confetti: o = { n, speed, dir, spread, life, size }
  function confetti(x, y, o) {
    o = o || {};
    var cnt = n(o.n || 30);
    for (var i = 0; i < cnt; i++) {
      var ang = o.dir === undefined ? rr(-Math.PI * 0.92, -Math.PI * 0.08) : o.dir + rr(-1, 1) * (o.spread || 0.6);
      var v = rr(0.35, 1) * (o.speed || 1100);
      add({
        k: CONF, x: x + rr(-1, 1) * (o.jx || 10), y: y + rr(-1, 1) * (o.jy || 10),
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
        life: rr(0.7, 1) * (o.life || 2.4), size: rr(14, 26) * (o.size || 1),
        g: o.g === undefined ? 900 : o.g, drag: 2.4, wob: rr(3, 6), vr: rr(-6, 6), flip: rr(0, TAU), vf: rr(6, 14),
        color: pick(CONFETTI), fin: 0.02, delay: (o.delay || 0) + rr(0, o.stagger || 0.06)
      });
    }
  }
  // smoke rising from a line (x, y0..y1): a fire going out
  function smoke(x, y0, y1, o) {
    o = o || {};
    var cnt = n(o.n || 14);
    for (var i = 0; i < cnt; i++) {
      add({
        k: SMOKE, x: x + rr(-1, 1) * (o.jx || 70), y: rr(y0, y1),
        vx: rr(-40, 40), vy: -rr(80, 220), life: rr(0.8, 1.4), size: rr(70, 130) * (o.size || 1),
        g: -60, drag: 1.2, vr: rr(-1, 1), a: o.a === undefined ? 0.75 : o.a, fin: 0.15, delay: rr(0, 0.15)
      });
    }
  }

  // the screen breaks like glass: triangles flying out of a point
  function shards(x, y, o) {
    o = o || {};
    var cnt = n(o.n || 26);
    for (var i = 0; i < cnt; i++) {
      var ang = rr(0, TAU), v = rr(400, 1500) * (o.speed || 1), s = rr(14, 46) * (o.size || 1);
      add({
        k: SHARD, x: x + Math.cos(ang) * rr(0, 120), y: y + Math.sin(ang) * rr(0, 70),
        vx: Math.cos(ang) * v, vy: Math.sin(ang) * v * 0.7 - 200,
        shape: [rr(-1, 1) * s, -s, s, rr(-0.4, 1) * s, -s, rr(0, 1) * s],
        life: rr(0.7, 1.3), g: 1500, drag: 0.8, vr: rr(-9, 9), a: 0.95, fin: 0.01
      });
    }
  }
  function ring(x, y, o) {
    o = o || {};
    if (!fxOn('particles')) return;
    rings.push({ x: x, y: y, r0: o.r0 || 8, r1: o.r1 || 140, t: -(o.delay || 0), dur: o.dur || 0.5, w: o.w || 9, c: col(o.color || 'gold'), sy: o.sy || 1 });
    wake();
  }
  function bloom(x, y, o) {
    o = o || {};
    if (!fxOn('particles')) return;
    blooms.push({ x: x, y: y, size: o.size || 300, t: -(o.delay || 0), dur: o.dur || 0.6, a: o.a === undefined ? 0.9 : o.a, sy: o.sy || 1 });
    wake();
  }
  // a jagged line between two points
  function jag(b) {
    var pts = [b.x0, b.y0], segs = b.segs;
    var dx = b.x1 - b.x0, dy = b.y1 - b.y0, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len;
    for (var i = 1; i < segs; i++) {
      var t = i / segs, off = rr(-1, 1) * b.amp * Math.sin(t * Math.PI);
      pts.push(b.x0 + dx * t + nx * off, b.y0 + dy * t + ny * off);
    }
    pts.push(b.x1, b.y1);
    return pts;
  }
  function bolt(x0, y0, x1, y1, o) {
    o = o || {};
    if (calm || !fxOn('particles')) return;
    var b = { x0: x0, y0: y0, x1: x1, y1: y1, segs: o.segs || 12, amp: o.amp || 40, t: -(o.delay || 0), dur: o.dur || 0.35, w: o.w || 4, c: col(o.color || 'blue'), re: 0 };
    b.pts = jag(b);
    bolts.push(b);
    wake();
  }

  // a flash of the whole stage
  function flash(color, strength, ms) {
    if (!flashEl || !flashEl.animate || !fxOn('flash')) return;
    flashEl.style.background = color || '#fff6dc';
    flashEl.animate([{ opacity: Math.min(1, (strength || 0.6) * (calm ? 0.4 : 1)) }, { opacity: 0 }], { duration: ms || 380, easing: 'ease-out' });
  }
  // a camera shake of one element (the active screen by default); never
  // while the reels turn (a reward coming in meanwhile): the machine stays
  // still when it spins
  function shake(node, px, ms) {
    if (calm || !fxOn('shake') || (BR.game && BR.game.spinning)) return;
    if (typeof node === 'string') node = $(node);
    node = node || $('.screen.active');
    if (!node || !node.animate) return;
    var k = [], steps = 9;
    for (var i = 0; i < steps; i++) {
      var f = px * (1 - i / steps);
      k.push({ transform: 'translate(' + rr(-f, f).toFixed(1) + 'px,' + rr(-f, f).toFixed(1) + 'px)' });
    }
    k.push({ transform: 'translate(0,0)' });
    node.animate(k, { duration: ms || 360, easing: 'linear' });
  }

  // a bump of one element (a box that just got something)
  function bump(node, s) {
    if (typeof node === 'string') node = $(node);
    if (!node || !node.animate || !fxOn('pops')) return;
    s = s || 1.18;
    node.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(' + s + ')', offset: 0.3 },
      { transform: 'scale(' + (1 - (s - 1) * 0.3) + ')', offset: 0.62 },
      { transform: 'scale(1)' }
    ], { duration: 420, easing: 'ease-out' });
  }

  // words floating up from a point: cls = 'gain' | 'big' | 'level' ...
  function text(x, y, str, cls, ms) {
    var t = document.createElement('div');
    t.className = 'jc-text' + (cls ? ' ' + cls : '');
    t.textContent = str;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
    stage.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, ms || 1500);
    return t;
  }
  // a big banner across the stage: cls = 'chance' | 'hot' | 'level' ...
  function banner(str, cls, ms, sub) {
    var b = document.createElement('div');
    b.className = 'jc-banner' + (cls ? ' ' + cls : '');
    var inner = document.createElement('div');
    inner.className = 'jc-banner-in';
    var main = document.createElement('b');
    main.textContent = str;
    inner.appendChild(main);
    if (sub) {
      var s = document.createElement('span');
      s.textContent = sub;
      inner.appendChild(s);
    }
    b.appendChild(inner);
    b.style.setProperty('--ms', (ms || 1400) + 'ms');
    stage.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, (ms || 1400) + 60);
    return b;
  }

  /* Coins that fly from a point to another (the wallet, the WIN box) along a
     curve, popping out first; o = { n, pic, size, dur, spread, stagger,
     hit(i) for each arrival, done() after the last } */
  function fly(from, to, o) {
    o = o || {};
    var a = at(from), b = at(to);
    var cnt = n(o.n || 10), dur = o.dur || 0.9, spread = o.spread === undefined ? 40 : o.spread;
    var landed = 0, added = 0;
    for (var i = 0; i < cnt; i++) {
      var sx = a.x + rr(-1, 1) * spread, sy = a.y + rr(-1, 1) * spread * 0.6;
      var out = rr(0, TAU), reach = rr(90, 260) * (o.pop || 1);
      var cx = sx + Math.cos(out) * reach, cy = Math.min(sy, b.y) - rr(60, 240) + Math.sin(out) * reach * 0.4;
      if (add({
        k: PIC, pic: o.pic || 'chip', x: sx, y: sy, vx: 0, vy: 0,
        path: [sx, sy, cx, cy, b.x, b.y], ease: easeFly, trail: o.trail === undefined ? 'gold' : o.trail,
        life: dur * rr(0.85, 1.15), size: rr(0.8, 1.1) * (o.size || 46),
        flip: rr(0, TAU), vf: rr(9, 16), fin: 0.05, a: 1,
        delay: i * (o.stagger === undefined ? 0.035 : o.stagger) + rr(0, 0.05),
        arrive: function (p) {
          landed++;
          sparks(p.x, p.y, { n: 3, speed: 380, life: 0.45, g: 300, size: 0.8 });
          if (o.hit) o.hit(landed);
          if (landed === added && o.done) o.done();
        }
      })) added++;
    }
    // nothing could be shown (too much on the screen already): just the end of it
    if (!added) setTimeout(function () { if (o.hit) o.hit(1); if (o.done) o.done(); }, 0);
    return added;
  }
  // a pop out, then faster and faster into the target
  function easeFly(t) { return t < 0.18 ? 0.6 * E.outQuad(t / 0.18) * 0.18 : 0.108 + (1 - 0.108) * E.inQuad((t - 0.18) / 0.82); }

  // coins / confetti falling from the top of the stage for a while
  function rain(o) {
    o = o || {};
    var dur = o.dur || 1.6, rate = (o.rate || 40) * (calm ? 0.35 : 1), kind = o.kind || 'coin';
    var count = Math.round(dur * rate);
    for (var i = 0; i < count; i++) {
      var x = rr(-40, W + 40), delay = (o.delay || 0) + i / rate;
      if (kind === 'confetti') {
        add({ k: CONF, x: x, y: -30, vx: rr(-80, 80), vy: rr(150, 420), life: rr(2.4, 3.6), size: rr(14, 26), g: 260, drag: 1.4, wob: rr(3, 6), vr: rr(-6, 6), flip: rr(0, TAU), vf: rr(6, 14), color: pick(CONFETTI), fin: 0.02, delay: delay });
      } else {
        add({ k: PIC, pic: o.pic || 'chip', x: x, y: -60, vx: rr(-120, 120), vy: rr(250, 650), life: rr(1.4, 2.2), size: rr(34, 62), g: 1300, drag: 0.4, vr: rr(-4, 4), flip: rr(0, TAU), vf: rr(6, 13), fin: 0.02, delay: delay });
      }
    }
  }

  /* ------------------------------------------------------------ moments --- */
  // a tap: a ring and a few sparks where the finger is
  function tap(x, y, big) {
    ring(x, y, { r0: 6, r1: big ? 120 : 70, dur: big ? 0.5 : 0.38, w: big ? 8 : 5, color: 'white' });
    sparks(x, y, { n: big ? 14 : 6, speed: big ? 640 : 380, life: 0.5, g: 200, size: big ? 1 : 0.7 });
  }
  var PRESS = 'button, .tab, [role="button"], .fr-row, .conv-row, .q-row, .bonus-day';
  var lastPress = null;
  function onPress(e) {
    if (!stage || e.button > 0 || !fxOn('pops')) return;
    var b = e.target && e.target.closest && e.target.closest(PRESS);
    if (!b || b.disabled || !stage.contains(b)) return;
    var p = toStage(e.clientX, e.clientY);
    lastPress = { el: b, at: U.now() };
    tap(p.x, p.y, b.classList.contains('act-btn') || b.classList.contains('pill') || b.classList.contains('spin-btn'));
  }

  // Where something good (a purchase, a reward) happened: `where` if it is on
  // the screen, else the button pressed a moment ago, else the notice
  // showing, else the middle.
  function rewardPoint(where) {
    if (typeof where === 'string') where = $(where);
    if (where && (!where.getBoundingClientRect || visible(where))) return at(where);
    if (lastPress && U.now() - lastPress.at < 6000 && visible(lastPress.el)) return at(lastPress.el);
    var t = $('#toast');
    if (t && t.classList.contains('show')) return at(t);
    return { x: W / 2, y: H * 0.45 };
  }
  // a purchase, a reward: a celebration there, and money coming in flies from there
  function reward(where, level) {
    if (!stage) return;
    var p = rewardPoint(where);
    source(p);
    celebrate(p, level || 2);
  }

  // something good happened at a point (a purchase, a reward)
  function celebrate(where, level) {
    if (!fxOn('celebrate')) return;
    var p = at(where);
    level = level || 1;
    ring(p.x, p.y, { r0: 10, r1: 160 + level * 80, dur: 0.6, w: 10 + level * 2 });
    if (level >= 2) ring(p.x, p.y, { r0: 10, r1: 260 + level * 90, dur: 0.8, w: 6, delay: 0.1, color: 'white' });
    bloom(p.x, p.y, { size: 260 + level * 140, dur: 0.7 });
    sparks(p.x, p.y, { n: 16 + level * 12, speed: 650 + level * 200, life: 1, g: 600 });
    stars(p.x, p.y, { n: 4 + level * 3, r: 90 + level * 50, size: 60 + level * 14 });
    if (level >= 2) confetti(p.x, p.y, { n: 18 + level * 14, speed: 900 + level * 150 });
    if (level >= 3) { flash('#fff3c4', 0.35); shake(null, 8, 380); }
  }

  /* Money coming in: coins burst out where it came from and fly one after
     another into the wallet (ちゃりちゃり…), the icon jumps at every coin,
     the count starts when the first one gets there and the last ones land
     on the pile with a sparkle and "+amount". k = 'tokens' | 'dollars' |
     'coins'; `from`: where it came from (an element or a point; else what
     source() was told in the last moments, else the middle of the screen).
     With a dialog open the wallet comes up over its backdrop to take the
     coins. Returns the ms until the first coin arrives (0: no flight). */
  var pending = null, clinkAt = 0, frontTimer = 0;
  function source(where) { pending = where ? { at: where, until: U.now() + 2500 } : null; }
  function freshSource() {
    var s = pending && U.now() < pending.until ? pending.at : null;
    if (s && typeof s === 'string') s = $(s);
    if (s && s.getBoundingClientRect && !visible(s)) s = null;
    return s;
  }
  var FIRST = 800;   // ms from the start of a flight to the first coin home
  var gainAt = {};
  // money a dialog will show coming in later (the thank-you money): when it
  // reaches the wallet before that, it comes in without a flight of its own
  var holds = [];
  function hold(k, amount, ms) { holds.push({ k: k, amount: amount, until: U.now() + (ms || 20000) }); }
  function held(k, amount) {
    var now = U.now();
    holds = holds.filter(function (h) { return h.until > now; });
    for (var i = 0; i < holds.length; i++) {
      if (holds[i].k === k && holds[i].amount === amount) { holds.splice(i, 1); return true; }
    }
    return false;
  }
  function gain(k, amount, from) {
    var item = $('.wallet .w-' + k);
    if (!stage || !item || !visible(item) || !(amount > 0)) return 0;
    var now = U.now();
    // many updates in a row (a count, a re-sync): one flight
    if (gainAt[k] && now - gainAt[k] < 300) return 0;
    if (held(k, amount)) return 0;
    // coins switched off (演出設定): the wallet just counts
    if (!fxOn('coins')) return 0;
    gainAt[k] = now;
    var src = from || freshSource();
    if (src) { flyIn(k, amount, src); return FIRST; }
    // nothing has said where it came from yet: a moment for the notice that will
    setTimeout(function () { if (!held(k, amount)) flyIn(k, amount, freshSource()); }, 160);
    return 160 + FIRST;
  }
  // the flight only, to show money the wallet already has (shown once: a
  // flight that has just started for the same money stands)
  // o = { n, size }: more and bigger coins (a big win pouring out)
  function payout(k, amount, from, o) {
    var item = $('.wallet .w-' + k);
    if (!stage || !item || !visible(item) || !(amount > 0) || !fxOn('coins')) return;
    if (gainAt[k] && U.now() - gainAt[k] < 400) return;
    gainAt[k] = U.now();
    flyIn(k, amount, from, o);
  }
  function flyIn(k, amount, src, o) {
    o = o || {};
    var item = $('.wallet .w-' + k);
    if (!item) return;
    var icon = item.querySelector('.ic'), num = item.querySelector('span');
    var pic = k === 'tokens' ? 'chip' : k === 'dollars' ? 'dollar' : 'coin';
    var a = src ? at(src) : { x: W / 2, y: H * 0.46 };
    // over a dialog, or on the title screen where it is hidden: the wallet
    // comes up to meet the coins
    var wallet = $('.wallet');
    if (wallet && (getComputedStyle(wallet).visibility === 'hidden' || document.querySelector('#stage > .modal:not([hidden])'))) {
      wallet.classList.add('jc-front');
      clearTimeout(frontTimer);
      frontTimer = setTimeout(function () { wallet.classList.remove('jc-front'); }, 2800);
    }
    // where it comes from lights up and throws the coins out
    bloom(a.x, a.y, { size: 360, dur: 0.6, a: 0.75 });
    ring(a.x, a.y, { r0: 10, r1: 150, dur: 0.45, w: 7 });
    sparks(a.x, a.y, { n: 14, speed: 620, life: 0.7, g: 500 });
    var cnt = o.n || Math.max(6, Math.min(24, Math.round(4 + Math.log10(amount + 1) * 2.2)));
    fly(a, icon, {
      n: cnt, pic: pic, size: o.size || 50, dur: 0.95, spread: o.n ? 90 : 30, stagger: o.n ? 0.03 : 0.045, pop: o.n ? 1.6 : 1.1,
      hit: function (i) {
        var t = U.now();
        if (t - clinkAt > 28) { clinkAt = t; if (BR.sfx) BR.sfx.play('coinIn', Math.min(1, i / cnt)); }
        bump(icon, 1.28);
        if (i === 1 && num) {
          num.classList.remove('jc-gain');
          void num.offsetWidth;
          num.classList.add('jc-gain');
        }
      },
      done: function () {
        var p = at(icon);
        ring(p.x, p.y, { r0: 6, r1: 110, dur: 0.5, w: 8 });
        ring(p.x, p.y, { r0: 6, r1: 170, dur: 0.7, w: 4, delay: 0.08, color: 'white' });
        sparks(p.x, p.y, { n: 18, speed: 600, life: 0.8, g: 420 });
        stars(p.x, p.y, { n: 5, r: 60, size: 64 });
        bloom(p.x, p.y, { size: 240, dur: 0.5, a: 0.8 });
        if (BR.sfx) BR.sfx.play('coinPile', cnt);
        var c = at(item);
        text(c.x + 18, c.y + 52, '+' + U.fmt(amount), 'gain ' + k, 1700);
      }
    });
  }

  BR.juice = {
    init: init, resize: resize, at: at, size: sizeOf, visible: visible, toStage: toStage,
    sparks: sparks, stars: stars, coins: coins, confetti: confetti, shards: shards, smoke: smoke,
    ring: ring, bloom: bloom, bolt: bolt, flash: flash, shake: shake, bump: bump,
    text: text, banner: banner, fly: fly, rain: rain,
    tap: tap, celebrate: celebrate, gain: gain, source: source, payout: payout, reward: reward, hold: hold,
    calm: function () { return calm; },
    low: function () { return low; },
    W: function () { return W; }, H: function () { return H; }
  };
})(window.BR = window.BR || {});
