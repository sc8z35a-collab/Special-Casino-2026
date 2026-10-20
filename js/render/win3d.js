/* The 3D win titles: WIN, BIG WIN, SUPER BIG WIN and ULTRA BIG WIN (77777
   only), turning as they show, in place of the drawn titles of the win
   presentation (js/render/fx.js) and over the reels for a plain WIN.
   three.js (js/vendor/three-win.js) and the models (img/3d/*.glb, made small
   with glTF-Transform: meshopt geometry, WebP textures) load in the
   background once the game is up, online only. Until they are there — or
   without WebGL, or with 3Dの当たり文字 off in 演出設定 — the drawn titles
   play as before.
   The canvas covers the stage (2000×924 design px) and the camera sees the
   stage plane at z = 0 one to one, so a title is placed in design px like the
   drawn ones were. They turn round and round, slowly while they face the
   player and quickly past their back, so they are easy to read. */
(function (BR) {
  'use strict';

  var SRC = 'js/vendor/three-win.js';
  // (ULTRA BIG WIN: its model is still to come; until then 77777 shows SUPER BIG WIN)
  var FILES = { win: 'img/3d/win.glb', big: 'img/3d/big.glb', super: 'img/3d/super.glb', ultra: '' };
  // each model's width on the stage (design px)
  var WIDTH = { win: 600, big: 1000, super: 840, ultra: 900 };
  var FOV = 26;
  var W = 2000, H = 924;

  var T = null;                        // three.js (window.BR3D)
  var state = 'idle';                  // idle | loading | ready | off
  var renderer = null, scene = null, camera = null, canvas = null;
  var models = {};                     // kind -> THREE.Group (centred, unit scale)
  var shown = null;                    // the kind on show
  var pres = 1;
  var pop = null;                      // a plain WIN over the reels: { t0, raf }
  // a phone too slow for it (the game's own low mode, or slow frames while a
  // title turned) gets the drawn titles from then on
  var SLOW = 'blockbuster-reels/3d-slow';
  var slow = false, lastDraw = 0, frameAvg = 0, slowFor = 0;
  try { slow = localStorage.getItem(SLOW) === '1'; } catch (e) { /* no storage */ }
  function tooSlow() { return slow || document.documentElement.classList.contains('jc-low'); }
  function watchSpeed() {
    var now = performance.now(), ms = now - lastDraw;
    lastDraw = now;
    if (slow || ms <= 0 || ms > 250 || document.hidden) return;
    frameAvg += (ms - frameAvg) * 0.1;
    slowFor = frameAvg > 40 ? slowFor + ms : Math.max(0, slowFor - ms * 0.5);
    if (slowFor > 2000) {
      slow = true;
      try { localStorage.setItem(SLOW, '1'); } catch (e) { /* this visit only */ }
    }
  }

  function online() { return !!(BR.api && BR.api.online); }
  function wanted() { return !BR.fx || BR.fx.on('model3d'); }
  function webgl() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }

  function script(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('3D: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function setup() {
    canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas win3d';
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(1);
    size();
    scene = new T.Scene();
    var pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    pm.dispose();
    var key = new T.DirectionalLight(0xfff2d6, 2.4);
    key.position.set(-0.6, 0.9, 1.2);
    scene.add(key);
    // the camera sees the stage plane (z = 0) one design px to one unit
    camera = new T.PerspectiveCamera(FOV, W / H, 10, 20000);
    camera.position.set(0, 0, (H / 2) / Math.tan(FOV * Math.PI / 360));
    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      state = 'off';
      hide();
    });
  }
  function size() {
    if (!renderer) return;
    renderer.setSize(Math.round(W * pres), Math.round(H * pres), false);
  }

  function load(kind) {
    return new Promise(function (resolve) {
      var loader = new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder);
      loader.load(FILES[kind], function (g) {
        var inner = g.scene;
        var box = new T.Box3().setFromObject(inner), c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
        inner.position.set(-c.x, -c.y, -c.z);
        var holder = new T.Group();
        holder.add(inner);
        holder.userData.width = s.x || 1;
        holder.visible = false;
        scene.add(holder);
        models[kind] = holder;
        resolve(true);
      }, undefined, function () { resolve(false); });
    });
  }

  // three.js and the models, in the background (once)
  var loading = null;
  function preload() {
    if (loading || state === 'off') return loading;
    if (!online() || !wanted() || !webgl()) return null;
    state = 'loading';
    loading = script(SRC).then(function () {
      T = window.BR3D;
      if (!T) throw new Error('3D: three.js');
      setup();
      // one after the other: the game goes on meanwhile
      return ['big', 'super', 'win', 'ultra'].filter(function (k) { return FILES[k]; }).reduce(function (p, k) {
        return p.then(function () { return load(k); });
      }, Promise.resolve());
    }).then(function () {
      if (!models.big) throw new Error('3D: models');
      // shaders and textures ready now, not at the first win
      Object.keys(models).forEach(function (k) { models[k].visible = true; });
      renderer.compile(scene, camera);
      Object.keys(models).forEach(function (k) { models[k].visible = false; });
      state = 'ready';
    }).catch(function (e) {
      state = 'off';
      if (window.console) console.warn(e);
    });
    return loading;
  }

  // the model for a kind (ULTRA until its model is there: SUPER)
  function pick(kind) {
    if (kind === 'ultra' && !models.ultra) kind = 'super';
    return models[kind] ? kind : null;
  }
  function usable(kind) { return state === 'ready' && wanted() && !tooSlow() && !!pick(kind); }

  function mount(parent, before) {
    if (canvas.parentNode !== parent || (before && canvas.nextSibling !== before)) parent.insertBefore(canvas, before || null);
    canvas.style.display = 'block';
  }
  function show(kind) {
    kind = pick(kind);
    lastDraw = 0;
    Object.keys(models).forEach(function (k) { models[k].visible = k === kind; });
    shown = kind;
    return kind;
  }
  function hide() {
    if (canvas) { canvas.style.display = 'none'; canvas.style.opacity = '0'; }
    shown = null;
  }

  // o: { x, y (design px), scale, sx, sy, alpha, ry, rx }
  function draw(o) {
    var m = shown && models[shown];
    if (!m) return;
    var k = WIDTH[shown] / m.userData.width * (o.scale || 1);
    m.position.set(o.x - W / 2, H / 2 - o.y, 0);
    m.scale.set(k * (o.sx || 1), k * (o.sy || 1), k);
    m.rotation.set(o.rx || 0, o.ry || 0, 0);
    canvas.style.opacity = String(Math.max(0, Math.min(1, o.alpha === undefined ? 1 : o.alpha)));
    renderer.render(scene, camera);
    watchSpeed();
  }

  // The turn: `t` seconds since it started, landing facing the player at
  // `land` after a fast spin in, then round and round every `period` s
  // (slow at the front, quick past the back).
  function turn(t, land, period) {
    if (t < land) {
      var p = Math.max(0, t / land);
      return -Math.PI * 3 * Math.pow(1 - p, 3);
    }
    var u = (t - land) / (period || 3.6);
    return Math.PI * 2 * u - 0.85 * Math.sin(Math.PI * 2 * u);
  }

  /* ------------------------------------------------------------ a plain WIN over the reels --- */
  function popWin() {
    if (!usable('win')) return false;
    stopPop();
    var host = document.getElementById('screen-slot');
    if (!host) return false;
    mount(host);
    canvas.classList.add('win3d-pop');
    show('win');
    pop = { t0: performance.now(), raf: 0 };
    var DUR = 1.6;
    var step = function () {
      if (!pop) return;
      var t = (performance.now() - pop.t0) / 1000;
      if (t >= DUR) { stopPop(); return; }
      var inP = Math.min(1, t / 0.35), out = Math.max(0, (t - (DUR - 0.3)) / 0.3);
      var scale = (0.4 + 0.6 * (1 - Math.pow(1 - inP, 3))) * (1 + 0.15 * out);
      draw({ x: W / 2, y: H / 2 - 205, scale: scale, alpha: Math.min(1, inP * 2) * (1 - out), ry: turn(t, 0.45, 2.4), rx: 0.06 * Math.sin(t * 2) });
      pop.raf = requestAnimationFrame(step);
    };
    step();
    return true;
  }
  function stopPop() {
    if (!pop) return;
    cancelAnimationFrame(pop.raf);
    pop = null;
    if (canvas) canvas.classList.remove('win3d-pop');
    hide();
  }

  BR.win3d = {
    preload: preload,
    usable: usable,
    // the win presentation: the canvas in its layer (before `before`), a model on show
    begin: function (parent, before, kind) {
      if (!usable(kind)) return null;
      stopPop();
      mount(parent, before);
      return show(kind);
    },
    swap: function (kind) { return shown ? show(kind) : null; },
    draw: draw,
    end: hide,
    turn: turn,
    popWin: popWin,
    stopPop: stopPop,
    resize: function (res) {
      var p = Math.min(res || 1, 1);
      if (Math.abs(p - pres) < 0.01) return;
      pres = p;
      size();
    }
  };
})(window.BR = window.BR || {});
