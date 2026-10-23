/* Attached Meshy models for player LEVEL UP and a successful VIP extension.
   Shares the existing three.js loader, but has its own canvas so a reward
   never interrupts a slot win. Text banners remain the fallback. */
(function (BR) {
  'use strict';
  var FILES = { level: 'img/3d/level-up.glb', vip: 'img/3d/vip-extend.glb' };
  var T, renderer, scene, camera, node, canvas, active, loading;
  var models = {}, off = false;
  function wanted() { return !BR.fx || (BR.fx.on('model3d') && BR.fx.on('celebrate')); }
  function stop() {
    if (active) cancelAnimationFrame(active.frame);
    active = null;
    if (node && node.parentNode) node.parentNode.removeChild(node);
    if (renderer) renderer.clear();
  }
  function setup() {
    canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    renderer = new T.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    renderer.setSize(1100, 400, false);
    renderer.setClearColor(0, 0);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    scene = new T.Scene();
    var pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    pm.dispose();
    var key = new T.DirectionalLight(0xfff2d4, 3);
    key.position.set(-2, 4, 6);
    scene.add(key);
    camera = new T.PerspectiveCamera(40, 1100 / 400, 0.1, 100);
    camera.position.z = 7;
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); off = true; stop(); });
  }
  function load(kind) {
    return new Promise(function (resolve) {
      new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder).load(FILES[kind], function (g) {
        var box = new T.Box3().setFromObject(g.scene), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        g.scene.position.copy(center).multiplyScalar(-1);
        var holder = new T.Group();
        holder.add(g.scene);
        holder.userData.scale = Math.min(10 / (size.x || 1), 3.4 / (size.y || 1), 2.8 / (size.z || 1));
        holder.scale.setScalar(holder.userData.scale);
        holder.visible = false;
        scene.add(holder);
        models[kind] = holder;
        resolve(true);
      }, undefined, function () { resolve(false); });
    });
  }
  function preload() {
    if (loading) return loading;
    if (off || !wanted() || !BR.api.online || !window.WebGLRenderingContext) return Promise.resolve(false);
    loading = BR.win3d.three().then(function (lib) {
      T = lib;
      setup();
      return Promise.all(Object.keys(FILES).map(load));
    }).then(function () {
      Object.keys(models).forEach(function (k) { models[k].visible = true; });
      renderer.compile(scene, camera);
      Object.keys(models).forEach(function (k) { models[k].visible = false; });
      return true;
    }).catch(function () { off = true; return false; });
    return loading;
  }
  function play(kind, subtitle) {
    if (!wanted() || off || !models[kind]) { preload(); return false; }
    stop();
    node = document.createElement('div');
    node.className = 'reward3d reward3d-' + kind;
    node.setAttribute('role', 'status');
    node.setAttribute('aria-label', (kind === 'level' ? 'LEVEL UP' : 'VIP延長') + ' ' + (subtitle || ''));
    node.appendChild(canvas);
    var sub = document.createElement('b');
    sub.className = 'reward3d-sub';
    sub.textContent = subtitle || '';
    node.appendChild(sub);
    document.getElementById('stage').appendChild(node);
    Object.keys(models).forEach(function (k) { models[k].visible = k === kind; });
    var m = models[kind], began = performance.now();
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    active = { frame: 0 };
    function frame() {
      if (!active) return;
      var t = (performance.now() - began) / 1000;
      if (t >= 2.7 || !wanted()) { stop(); return; }
      node.style.opacity = String(Math.min(1, t / 0.15, (2.7 - t) / 0.35));
      // These two exports face -Z. Keep their readable front toward the camera.
      m.rotation.y = Math.PI + (still ? 0 : -0.6 * Math.pow(Math.max(0, 1 - t / 0.6), 3) + 0.08 * Math.sin(t * 2));
      m.scale.setScalar(m.userData.scale * (still ? 1 : 1 + 0.025 * Math.sin(t * 3)));
      renderer.render(scene, camera);
      active.frame = requestAnimationFrame(frame);
    }
    frame();
    return true;
  }
  BR.reward3d = { preload: preload, play: play, stop: stop };
})(window.BR = window.BR || {});
