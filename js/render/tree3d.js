/* Money trees and auction icons share one WebGL context. Each visible view
   receives the rendered image in a 2D canvas; the main canvas has orbit and
   pinch controls. Fertilizer bags are independent cannon-es rigid bodies. */
(function (BR) {
  'use strict';
  var ROOT = 'img/3d/tree/';
  // Null entries retain the existing artwork until the oversized originals
  // can be supplied. Never substitute a different growth stage silently.
  var FILES = BR.TREE_MODELS;
  var T, C, renderer, environment, loading, physicsLoading, frameId = 0;
  var views = [], models = {}, main = null, active = false, lastFrame = 0;
  var SIDE = 1024;
  function physics() {
    if (!physicsLoading) physicsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = BR.util.codeUrl('js/vendor/tree-physics.js');
      s.onload = function () { C = window.BRTreePhysics; if (C) resolve(C); else reject(new Error('physics')); };
      s.onerror = function () { physicsLoading = null; reject(new Error('physics')); };
      document.head.appendChild(s);
    });
    return physicsLoading;
  }
  function setup() {
    if (loading) return loading;
    loading = BR.win3d.three().then(function (lib) {
      T = lib;
      renderer = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
      renderer.setPixelRatio(1);
      renderer.setSize(SIDE, SIDE, false);
      renderer.setClearColor(0, 0);
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      var pm = new T.PMREMGenerator(renderer);
      environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
      pm.dispose();
      renderer.setScissorTest(true);
      renderer.domElement.addEventListener('webglcontextlost', function (e) { e.preventDefault(); pause(); loading = null; });
      return true;
    }).catch(function () { loading = null; return false; });
    return loading;
  }
  function load(file) {
    if (!models[file]) models[file] = new Promise(function (resolve, reject) {
      new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder).load(ROOT + file, function (g) {
        resolve(g.scene);
      }, undefined, reject);
    }).catch(function (err) { delete models[file]; throw err; });
    return models[file];
  }
  function normalized(source, height, bury) {
    var model = source.clone(true), box = new T.Box3().setFromObject(model);
    var size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    var scale = height / (size.y || 1);
    var root = new T.Group();
    model.position.set(-center.x, -box.min.y, -center.z);
    root.add(model);
    root.scale.setScalar(scale);
    root.position.y = -(bury || 0);
    return root;
  }
  function makeView(host, interactive) {
    var canvas = document.createElement('canvas');
    canvas.className = 'tr3d-canvas';
    canvas.setAttribute('aria-label', interactive ? '金の生る木。ドラッグで360度回転、2本指またはホイールでズーム' : host.getAttribute('aria-label') || '回転する3Dモデル');
    canvas.setAttribute('role', 'img');
    if (interactive) canvas.tabIndex = 0;
    host.appendChild(canvas);
    var scene = new T.Scene();
    scene.environment = environment;
    scene.add(new T.HemisphereLight(0xfff5df, 0x344c31, 2));
    var sun = new T.DirectionalLight(0xffedc7, 2.5);
    sun.position.set(-3, 6, 5);
    scene.add(sun);
    var camera = new T.PerspectiveCamera(38, 1, 0.02, 100);
    var v = { host: host, canvas: canvas, ctx: canvas.getContext('2d'), scene: scene, camera: camera,
      interactive: interactive, alive: true, ready: false, bags: [], colliders: [], serial: 0 };
    if (interactive) {
      camera.position.set(4.6, 3.7, 6.2);
      v.controls = new T.OrbitControls(camera, canvas);
      v.controls.target.set(0, 1.25, 0);
      v.controls.enableDamping = true;
      v.controls.enablePan = false;
      v.controls.minDistance = 2.4;
      v.controls.maxDistance = 13;
      v.controls.maxPolarAngle = Math.PI * 0.96;
      v.controls.update();
      v.key = function (e) {
        if (e.key !== '+' && e.key !== '=' && e.key !== '-') return;
        e.preventDefault();
        var delta = camera.position.clone().sub(v.controls.target);
        var distance = Math.max(2.4, Math.min(13, delta.length() * (e.key === '-' ? 1.15 : 0.87)));
        camera.position.copy(v.controls.target).add(delta.setLength(distance));
      };
      canvas.addEventListener('keydown', v.key);
    }
    views.push(v);
    startFrames();
    return v;
  }
  function disposeBag(v, bag) {
    clearTimeout(bag.timer);
    v.world.removeBody(bag.body);
    v.scene.remove(bag.mesh);
    bag.label.remove();
    var i = v.bags.indexOf(bag);
    if (i >= 0) v.bags.splice(i, 1);
  }
  function dispose(v) {
    if (!v || !v.alive) return;
    v.alive = false;
    v.serial++;
    v.bags.slice().forEach(function (b) { disposeBag(v, b); });
    if (v.controls) v.controls.dispose();
    if (v.key) v.canvas.removeEventListener('keydown', v.key);
    if (v.owned) v.owned.forEach(function (o) { o.geometry.dispose(); o.material.dispose(); });
    v.canvas.remove();
    if (v.timers) v.timers.remove();
    v.host.classList.remove('has-3d');
    views = views.filter(function (x) { return x !== v; });
    if (main === v) main = null;
  }
  function startFrames() {
    if (!frameId && active) frameId = requestAnimationFrame(frame);
  }
  function frame(at) {
    frameId = 0;
    var dt = lastFrame ? Math.min(0.25, (at - lastFrame) / 1000) : 1 / 30;
    if (at - lastFrame < 1000 / 30) { startFrames(); return; }
    lastFrame = at;
    views.slice().forEach(function (v) {
      if (!v.host.isConnected) { dispose(v); return; }
      if (document.hidden || !v.ready || !v.host.getClientRects().length) return;
      if (v.world) v.world.step(1 / 120, dt, 30);
      if (v.controls) v.controls.update(dt);
      else if (v.model && !matchMedia('(prefers-reduced-motion: reduce)').matches) v.model.rotation.y += dt * 0.22;
      var rect = v.host.getBoundingClientRect();
      var ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      var w = Math.max(1, Math.min(SIDE, Math.round(rect.width * ratio)));
      var h = Math.max(1, Math.min(SIDE, Math.round(rect.height * ratio)));
      if (v.canvas.width !== w || v.canvas.height !== h) { v.canvas.width = w; v.canvas.height = h; }
      v.camera.aspect = w / h;
      v.camera.updateProjectionMatrix();
      v.bags.forEach(function (b) {
        if (at >= b.expires) { disposeBag(v, b); return; }
        b.mesh.position.copy(b.body.position);
        b.mesh.quaternion.copy(b.body.quaternion);
        var p = b.mesh.position.clone().add(new T.Vector3(0, 0.28, 0)).project(v.camera);
        b.label.style.left = ((p.x + 1) * 50) + '%';
        b.label.style.top = ((1 - p.y) * 50) + '%';
        b.label.hidden = p.z > 1;
        b.label.textContent = Math.ceil((b.expires - at) / 1000) + '秒';
      });
      renderer.setViewport(0, 0, w, h);
      renderer.setScissor(0, 0, w, h);
      renderer.clear();
      renderer.render(v.scene, v.camera);
      v.ctx.clearRect(0, 0, w, h);
      v.ctx.drawImage(renderer.domElement, 0, SIDE - h, w, h, 0, 0, w, h);
    });
    if (views.length) startFrames();
  }
  function soil(v) {
    if (FILES.soil) return load(FILES.soil).then(function (source) {
      var root = normalized(source, 0.48);
      var box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3());
      root.scale.multiplyScalar(4.8 / Math.max(size.x, size.z));
      root.position.y = -new T.Box3().setFromObject(root).max.y + 0.015;
      v.scene.add(root);
    });
    // Temporary ground only; the supplied soil export exceeded the transfer limit.
    var mesh = new T.Mesh(new T.CylinderGeometry(2.4, 2.15, 0.38, 32), new T.MeshStandardMaterial({ color: 0x56351e, roughness: 1, flatShading: true }));
    mesh.position.y = -0.2;
    v.scene.add(mesh);
    v.owned = [mesh];
    return Promise.resolve();
  }
  function makeWorld(v) {
    v.world = new C.World({ gravity: new C.Vec3(0, -9.82, 0), allowSleep: true });
    v.world.defaultContactMaterial.friction = 0.6;
    v.world.defaultContactMaterial.restitution = 0.3;
    v.groundMaterial = new C.Material('soil');
    v.bagMaterial = new C.Material('fertilizer');
    v.world.addContactMaterial(new C.ContactMaterial(v.groundMaterial, v.bagMaterial, { friction: 0.75, restitution: 0.18 }));
    var ground = new C.Body({ mass: 0, shape: new C.Cylinder(2.4, 2.15, 0.38, 32), material: v.groundMaterial,
      position: new C.Vec3(0, -0.2, 0) });
    v.world.addBody(ground);
    v.timers = document.createElement('div');
    v.timers.className = 'tr-fertilizer-timers';
    v.timers.setAttribute('aria-hidden', 'true');
    v.host.appendChild(v.timers);
  }
  function treeColliders(v, model) {
    v.colliders.forEach(function (b) { v.world.removeBody(b); });
    v.colliders = [];
    var box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3());
    var height = Math.max(0.4, box.max.y), trunkHeight = height * 0.63;
    function add(shape, x, y, z) {
      var b = new C.Body({ mass: 0, shape: shape, position: new C.Vec3(x, y, z) });
      v.world.addBody(b);
      v.colliders.push(b);
    }
    // Stable collision proxies follow the dimensions of each loaded stage.
    add(new C.Box(new C.Vec3(0.1, trunkHeight / 2, 0.1)), 0, trunkHeight / 2, 0);
    var radius = Math.min(size.x, size.z, height * 0.7) * 0.36;
    if (radius > 0.08) add(new C.Sphere(radius), 0, height * 0.73, 0);
  }
  function setStage(v, stage) {
    if (v.stage === stage && v.ready) return Promise.resolve(true);
    var file = FILES.stages[stage - 1], serial = ++v.serial;
    if (!file) return Promise.resolve(false);
    return load(file).then(function (source) {
      if (!v.alive || serial !== v.serial) return false;
      var height = [1.2, 1.6, 1.95, 2.25, 2.55, 2.9, 3.2, 3.5, 3.8][stage - 1];
      if (v.model) v.scene.remove(v.model);
      v.model = normalized(source, height, 0.08);
      v.scene.add(v.model);
      treeColliders(v, v.model);
      v.stage = stage;
      v.ready = true;
      return true;
    });
  }
  function show(host, tree) {
    active = true;
    var key = tree.id + ':' + tree.stage;
    host.dataset.treeModel = key;
    if (!FILES.stages[tree.stage - 1]) { dispose(main); host.classList.remove('has-3d'); return; }
    if (main && main.treeId !== tree.id) dispose(main);
    setup().then(function (ok) { return ok ? physics() : null; }).then(function (ok) {
      if (!ok || !active || host.dataset.treeModel !== key || !host.isConnected || !host.getClientRects().length) return null;
      if (!main) {
        main = makeView(host, true);
        main.treeId = tree.id;
        makeWorld(main);
        soil(main).catch(function () {});
        // Prepare the bag before the first confirmed gift.
        load(FILES.fertilizer).catch(function () {});
      }
      return setStage(main, tree.stage);
    }).then(function (ok) {
      if (host.dataset.treeModel === key) host.classList.toggle('has-3d', !!ok);
      startFrames();
    }).catch(function () { host.classList.remove('has-3d'); });
  }
  function icon(host, kind, stage) {
    active = true;
    var file = kind === 'stage' ? FILES.stages[stage - 1] : FILES[kind];
    if (!file) return;
    setup().then(function (ok) { return ok ? load(file) : null; }).then(function (source) {
      if (!source || !active || !host.isConnected) return;
      var v = makeView(host, false);
      v.model = normalized(source, 2);
      v.model.position.y -= 1;
      v.scene.add(v.model);
      var sphere = new T.Box3().setFromObject(v.model).getBoundingSphere(new T.Sphere());
      v.camera.position.set(0, sphere.radius * 0.35, sphere.radius / Math.sin(19 * Math.PI / 180) * 1.15);
      v.camera.lookAt(sphere.center);
      v.ready = true;
      host.classList.add('has-3d');
    }).catch(function () {});
  }
  function toss(treeId) {
    var v = main;
    if (!v || !v.ready || v.treeId !== treeId) return false;
    load(FILES.fertilizer).then(function (source) {
      if (!v.alive) return;
      var mesh = normalized(source, 0.36);
      // Center the visual mesh around its physical center of mass.
      var center = new T.Box3().setFromObject(mesh).getCenter(new T.Vector3());
      var holder = new T.Group();
      mesh.position.sub(center);
      holder.add(mesh);
      var body = new C.Body({ mass: 0.45, material: v.bagMaterial,
        shape: new C.Box(new C.Vec3(0.13, 0.18, 0.09)), linearDamping: 0.22, angularDamping: 0.35,
        sleepSpeedLimit: 0.12, sleepTimeLimit: 0.8 });
      // Throw from the camera's side, so orbiting never makes it a front throw.
      var side = v.camera.position.clone().sub(v.controls.target);
      side.y = 0;
      side.normalize().applyAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2);
      body.position.set(side.x * 2.2, 0.65 + Math.random() * 0.14, side.z * 2.2);
      body.velocity.set(-side.x * 4.5, 1.8, -side.z * 4.5);
      body.angularVelocity.set(2.5, -2 + Math.random() * 4, 3.5);
      holder.position.copy(body.position);
      v.world.addBody(body);
      v.scene.add(holder);
      var label = document.createElement('span');
      label.textContent = '8秒';
      v.timers.appendChild(label);
      var bag = { mesh: holder, body: body, label: label, expires: performance.now() + 8000 };
      bag.timer = setTimeout(function () { if (v.bags.indexOf(bag) >= 0) disposeBag(v, bag); }, 8000);
      v.bags.push(bag);
    }).catch(function () {});
    return true;
  }
  function pause() {
    active = false;
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastFrame = 0;
    views.slice().forEach(dispose);
  }
  function zoom(factor) {
    if (!main) return;
    var delta = main.camera.position.clone().sub(main.controls.target);
    var distance = Math.max(2.4, Math.min(13, delta.length() * factor));
    main.camera.position.copy(main.controls.target).add(delta.setLength(distance));
    main.controls.update();
  }
  BR.tree3d = { show: show, icon: icon, toss: toss, zoom: zoom, pause: pause, files: FILES };
})(window.BR = window.BR || {});
