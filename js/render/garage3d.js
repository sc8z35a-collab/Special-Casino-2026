/* Bright white car viewer. Only the selected car is downloaded; no studio or
   garage scenery. Car Owner orbits freely; garage previews stay fixed. */
(function (BR) {
  'use strict';
  var T, g, library, host = null, mode = '', serial = 0, raf = 0;
  var cars = {}, used = 0, CACHE = 3;
  var SHOW_DISTANCE = 4.8;   // Car Owner opens this close (the garage previews: about 7.6)
  function supported() {
    if (!(BR.api && BR.api.online)) return false;
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }
  function has(id) {
    return BR.CONFIG.cars.some(function (c) { return c.id === id && !!c.model; });
  }
  function build() {
    var canvas = document.createElement('canvas');
    canvas.className = 'g3d-canvas';
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'low-power' });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    var camera = new T.PerspectiveCamera(42, 16 / 9, 0.05, 40);
    var scene = new T.Scene();
    scene.background = new T.Color(0xffffff);
    var pm = new T.PMREMGenerator(renderer);
    var environment = new T.RoomEnvironment();
    var env = pm.fromScene(environment, 0.04);
    scene.environment = env.texture;
    scene.environmentIntensity = 1.3;
    environment.dispose(); pm.dispose();
    scene.add(new T.HemisphereLight(0xffffff, 0xc4ccd4, 2.2));
    [[4, 7, 5, 2.5], [-5, 4, -3, 1.8]].forEach(function (p) {
      var light = new T.DirectionalLight(0xffffff, p[3]);
      light.position.set(p[0], p[1], p[2]); scene.add(light);
    });
    var controls = new T.OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.autoRotate = false;
    controls.minDistance = 3.2; controls.maxDistance = 9;
    controls.minPolarAngle = Math.PI * .12; controls.maxPolarAngle = Math.PI * .48;
    controls.minAzimuthAngle = -Infinity; controls.maxAzimuthAngle = Infinity;
    g = { canvas: canvas, renderer: renderer, camera: camera, controls: controls,
      world: { scene: scene, car: null, carId: '' } };
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stopDrawing(); });
  }
  function lib() {
    if (!library) library = BR.three().then(function (t) {
      T = t; if (!g) build();
    }).catch(function (e) { library = null; throw e; });
    return library;
  }
  function loadCar(id, progress) {
    if (!cars[id]) {
      var entry = cars[id] = { used: ++used, model: null };
      entry.promise = new Promise(function (resolve, reject) {
        new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder).load('img/3d/cars/' + id + '.glb', function (r) {
          var obj = r.scene, box = new T.Box3().setFromObject(obj);
          obj.scale.multiplyScalar(4.6 / box.getSize(new T.Vector3()).x);
          box.setFromObject(obj);
          var center = box.getCenter(new T.Vector3());
          obj.position.x -= center.x; obj.position.z -= center.z; obj.position.y -= box.min.y;
          var holder = new T.Group(); holder.add(obj); holder.rotation.y = .55;
          entry.model = holder; resolve(holder);
        }, function (e) { if (progress && e.total) progress(e.loaded / e.total); }, function (e) {
          delete cars[id]; reject(e);
        });
      });
    }
    cars[id].used = ++used;
    return cars[id].promise;
  }
  function trim() {
    var ids = Object.keys(cars).filter(function (id) { return cars[id].model; });
    ids.sort(function (a, b) { return cars[a].used - cars[b].used; });
    while (ids.length > CACHE) {
      var id = ids.shift();
      if (g.world.carId === id) { ids.push(id); continue; }
      var geometries = new Set(), materials = new Set(), textures = new Set();
      cars[id].model.traverse(function (o) {
        if (!o.isMesh) return;
        geometries.add(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
          if (!m) return; materials.add(m);
          Object.keys(m).forEach(function (k) { if (m[k] && m[k].isTexture) textures.add(m[k]); });
        });
      });
      geometries.forEach(function (o) { o.dispose(); });
      materials.forEach(function (o) { o.dispose(); });
      textures.forEach(function (o) { o.dispose(); if (o.image && o.image.close) o.image.close(); });
      delete cars[id];
    }
  }
  function size() {
    if (!host || !g) return;
    var r = host.getBoundingClientRect(), w = host.clientWidth || r.width, h = host.clientHeight || r.height;
    if (!w || !h) return;
    var scale = Math.max(r.width, r.height) / Math.max(w, h);
    g.renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * scale, 1.5));
    g.renderer.setSize(w, h, false);
    g.camera.aspect = w / h;
    g.camera.fov = w >= h ? 42 : Math.min(75, 2 * Math.atan(Math.tan(42 * Math.PI / 360) / (w / h)) * 180 / Math.PI);
    g.camera.updateProjectionMatrix();
    draw();
  }
  function draw() { if (g && host) g.renderer.render(g.world.scene, g.camera); }
  function frame() {
    raf = 0;
    if (!host || mode !== 'show') return;
    g.controls.update(); draw(); raf = requestAnimationFrame(frame);
  }
  function stopDrawing() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function start(el, id, nextMode, progress) {
    var request = ++serial;
    stopDrawing();
    return lib().then(function () {
      if (request !== serial) return null;
      return id ? loadCar(id, progress) : null;
    }).then(function (car) {
      if (request !== serial) { if (g) trim(); return; }
      host = el; mode = nextMode;
      if (g.world.car) g.world.scene.remove(g.world.car);
      g.world.car = car; g.world.carId = id;
      if (car) g.world.scene.add(car);
      // Clear residual OrbitControls damping from the previous view before
      // fixing the garage camera. Every car opens from the same angle.
      var c = g.controls;
      c.enabled = true; c.enableDamping = false; c.update();
      if (mode === 'show') {
        // Car Owner: close up, in front of the car (the models face -x before the holder's turn)
        var turn = car ? car.rotation.y : 0;
        c.target.set(0, .5, 0);
        g.camera.position.set(-Math.cos(turn) * SHOW_DISTANCE, 1.25, Math.sin(turn) * SHOW_DISTANCE);
      } else {
        c.target.set(0, .75, 0); g.camera.position.set(4.9, 2.5, 5.5);
      }
      c.update(); c.enableDamping = true;
      c.enabled = mode === 'show'; c.enableRotate = mode === 'show'; c.enableZoom = mode === 'show';
      if (g.canvas.parentNode !== el) el.appendChild(g.canvas);
      size(); trim();
      if (mode === 'show') frame();
      if (BR.garage3d.onMode) BR.garage3d.onMode(mode);
    });
  }
  window.addEventListener('resize', size);
  BR.garage3d = {
    supported: supported, has: has,
    show: function (el, id, progress) { return start(el, id, 'show', progress); },
    space: function (el, id, progress) { return start(el, id || '', 'space', progress); },
    // Kept for callers using older UI code; walking and lens zoom are removed.
    walk: function () {}, zoom: function () {}, stick: function () {},
    mode: function () { return mode; },
    stop: function () { ++serial; stopDrawing(); if (g) g.controls.enabled = false; mode = ''; host = null; },
    onMode: null, onZoom: null,
    debug: function () { return { g: g, cachedCars: Object.keys(cars) }; }
  };
})(window.BR = window.BR || {});
