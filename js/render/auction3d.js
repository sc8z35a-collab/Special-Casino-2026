/* The auction's supplied GLBs: six animated buyers, room, lectern and lots.
   One renderer follows the server's clock. No client animation decides a bid.
   Assets are decoded before starting a new auction, so all seven seconds of
   the introduction can be seen even on a slow connection. */
(function (BR) {
  'use strict';
  var BASE = 'img/3d/auction/';
  var FILES = ['dennis', 'joumon', 'natasha', 'johnson', 'kamiya', 'wild', 'room', 'lectern', 'seed', 'tree'];
  var T, library, assets = {}, prepared, catalog;
  var FALLBACK = ['joumon', 'natasha', 'johnson', 'kamiya', 'wild'];

  function lib() {
    if (!library) library = BR.win3d.three().then(function (t) { T = t; return t; }).catch(function (e) { library = null; throw e; });
    return library;
  }
  function load(id) {
    if (!catalog) catalog = fetch(BASE + 'assets.json').then(function (r) {
      if (!r.ok) throw new Error('Auction asset index: HTTP ' + r.status);
      return r.json();
    }).catch(function (e) { catalog = null; throw e; });
    if (!assets[id]) assets[id] = Promise.all([lib(), catalog]).then(function (loaded) {
      var entry = loaded[1][id];
      if (!entry) throw new Error('Missing auction model: ' + id);
      return Promise.all(entry.files.map(function (file) {
        return fetch(BASE + file).then(function (r) {
          if (!r.ok) throw new Error('Auction model: HTTP ' + r.status);
          return r.arrayBuffer();
        });
      })).then(function (parts) {
        var size = parts.reduce(function (n, p) { return n + p.byteLength; }, 0);
        if (size !== entry.bytes) throw new Error('Incomplete auction model: ' + id);
        var bytes = new Uint8Array(size), offset = 0;
        parts.forEach(function (part) { bytes.set(new Uint8Array(part), offset); offset += part.byteLength; });
        return new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder).parseAsync(bytes.buffer, BASE);
      });
    }).catch(function (e) { delete assets[id]; throw e; });
    return assets[id];
  }
  function preload(progress) {
    var count = 0;
    return Promise.all(FILES.map(function (id) {
      return load(id).then(function () { if (progress) progress(++count / FILES.length); });
    }));
  }
  function roster(a) {
    return (a.participants || [{ id: 'me', name: 'あなた', model: 'dennis' }].concat(a.bidders.map(function (name, i) {
      return { id: name, name: name, model: FALLBACK[i % FALLBACK.length] };
    }))).slice(0, 6);
  }
  function fit(root, size, axis) {
    var b = new T.Box3().setFromObject(root), s = b.getSize(new T.Vector3());
    var scale = size / (axis === 'width' ? s.x : s.y);
    var wrap = new T.Group();
    wrap.add(root);
    wrap.scale.setScalar(scale);
    b.setFromObject(wrap);
    var c = b.getCenter(new T.Vector3());
    wrap.position.set(-c.x, -b.min.y, -c.z);
    var anchor = new T.Group();
    anchor.add(wrap);
    root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return anchor;
  }
  // The cached roots are reused only after the previous arena has stopped.
  function prepare(models) {
    if (prepared) return prepared;
    prepared = {};
    FILES.forEach(function (id, i) {
      var g = models[i];
      if (FALLBACK.indexOf(id) >= 0 || id === 'dennis') {
        var mixer = new T.AnimationMixer(g.scene);
        var idle = g.animations.filter(function (c) { return c.name === 'idle'; })[0];
        if (idle) { mixer.clipAction(idle).play(); mixer.update(0); mixer.stopAllAction(); }
        prepared[id] = { root: fit(g.scene, 1.8), model: g.scene, clips: g.animations };
      } else {
        prepared[id] = { root: fit(g.scene, id === 'room' ? 17 : id === 'lectern' ? 1.18 : id === 'tree' ? 2.7 : .9, id === 'room' ? 'width' : 'height') };
        // A camera-side cutaway keeps the venue's front fence and stone posts
        // from hiding the buyers. The original asset remains intact.
        if (id === 'room') g.scene.traverse(function (o) {
          if (!o.isMesh) return;
          var materials = Array.isArray(o.material) ? o.material : [o.material];
          materials.forEach(function (m) { m.clippingPlanes = [new T.Plane(new T.Vector3(0, 0, -1), 2.45)]; m.clipShadows = true; });
        });
      }
    });
    return prepared;
  }
  function mount(host, initial) {
    return Promise.all(FILES.map(load)).then(function (models) {
      return new Arena(host, initial, prepare(models));
    });
  }

  function Arena(host, initial, models) {
    var self = this;
    this.host = host;
    this.models = models;
    this.actors = [];
    this.byId = {};
    this.data = initial;
    this.offset = initial.now - (initial.seen || Date.now());
    this.seen = {};
    this.destroyed = false;
    this.raf = 0;
    this.last = 0;
    this.resultAt = 0;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'au3d-canvas';
    this.canvas.setAttribute('aria-label', '6人の仲卸業者が参加する3D競り会場');
    this.renderer = new T.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = true;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x151b22);
    this.scene.fog = new T.Fog(0x151b22, 19, 37);
    this.scene.add(new T.HemisphereLight(0xe3ecff, 0x625039, 2.5));
    var key = new T.DirectionalLight(0xffe2b1, 3.2);
    key.position.set(-4, 9, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -10, right: 10, top: 9, bottom: -9, far: 35 });
    key.shadow.bias = -.001;
    this.scene.add(key);
    var rim = new T.DirectionalLight(0x91baff, 2);
    rim.position.set(4, 6, -4);
    this.scene.add(rim);
    var floor = new T.Mesh(new T.PlaneGeometry(50, 50), new T.MeshStandardMaterial({ color: 0x242a2b, roughness: .86 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.generated = [floor.geometry, floor.material];
    this.scene.add(models.room.root);
    // The miniature room's floor is just above its lower bounding plane.
    this.floor = .136; // measured floor top at all six buyer positions: ~.126 m
    this.scene.add(models.lectern.root);
    models.lectern.root.position.set(0, this.floor, -2.55);
    this.camera = new T.PerspectiveCamera(34, 16 / 9, .03, 80);
    this.target = new T.Vector3(0, 1.1, 2);
    this.fixed = new T.Vector3(0, 3.2, 8.5);
    this.camera.position.copy(this.fixed);
    this.camera.lookAt(this.target);

    this.labels = document.createElement('div');
    this.labels.className = 'au3d-labels';
    this.banner = document.createElement('div');
    this.banner.className = 'au3d-banner';
    this.banner.setAttribute('role', 'status');
    this.banner.setAttribute('aria-live', 'polite');
    this.bannerValue = '';
    var positions = [[-3.8, 2], [-2.3, 2], [-.78, 2], [.78, 2], [2.3, 2], [3.8, 2]];
    var people = roster(initial);
    // Every buyer faces +Z: both the sweep and the fixed camera see faces.
    people.forEach(function (person, i) {
      var m = models[person.model] || models[FALLBACK[i % 5]], root = m.root;
      root.position.set(positions[i][0], self.floor, positions[i][1]);
      root.rotation.set(0, 0, 0);
      self.scene.add(root);
      var mixer = new T.AnimationMixer(m.model), actions = {};
      m.clips.forEach(function (c) { actions[c.name] = mixer.clipAction(c); });
      var label = document.createElement('div');
      label.className = 'au3d-name' + (person.id === 'me' ? ' me' : '');
      label.textContent = person.name;
      self.labels.appendChild(label);
      var cash = document.createElement('img');
      cash.className = 'au3d-cash';
      cash.src = 'img/3d/auction/cash.webp';
      cash.alt = '';
      cash.hidden = true;
      self.labels.appendChild(cash);
      var actor = { id: person.id, root: root, mixer: mixer, actions: actions, current: '', label: label, cash: cash, cashUntil: 0, head: null };
      m.model.traverse(function (o) { if (o.isBone && /Head$/.test(o.name)) actor.head = o; });
      mixer.addEventListener('finished', function (e) { if (e.action === actions.bid && !self.resultAt) self.play(actor, 'idle'); });
      self.actors.push(actor);
      self.byId[person.id] = actor;
      self.play(actor, 'idle');
      if (actions.idle) actions.idle.time = i * .91;
    });
    this.productScene = new T.Scene();
    this.productScene.background = new T.Color(0x111d1b);
    this.productScene.add(new T.HemisphereLight(0xfff1ce, 0x334b37, 3));
    var light = new T.DirectionalLight(0xffdf9e, 4);
    light.position.set(3, 5, 5);
    this.productScene.add(light);
    var fill = new T.DirectionalLight(0xb4d7ff, 2);
    fill.position.set(-3, 3, -2);
    this.productScene.add(fill);
    this.productCamera = new T.PerspectiveCamera(35, 1, .03, 50);
    this.product = models[initial.market === 'seed' ? 'seed' : 'tree'].root;
    this.product.rotation.set(0, 0, 0);
    this.product.position.set(0, .22, 0);
    this.productScene.add(this.product);
    var stand = new T.Mesh(new T.CylinderGeometry(1.2, 1.35, .18, 48), new T.MeshStandardMaterial({ color: 0x5b4b28, metalness: .5, roughness: .4 }));
    stand.position.y = .09;
    this.productScene.add(stand);
    this.generated.push(stand.geometry, stand.material);
    this.productHeight = initial.market === 'seed' ? .9 : 2.7;
    this.attach(host);
    this.resizeObserver = new ResizeObserver(function () { self.resize(); });
    this.resizeObserver.observe(host);
    this.update(initial, true);
    this.canvas.addEventListener('webglcontextlost', function (e) {
      if (self.destroyed) return;
      e.preventDefault();
      var brokenHost = self.host;
      self.dispose();
      brokenHost.classList.add('au3d-failed');
      var note = document.createElement('p');
      note.className = 'au3d-loading';
      note.textContent = '3D表示が中断されました。競りの価格・入札操作は引き続き利用できます。';
      brokenHost.appendChild(note);
    });
    this.loop = function (t) { self.frame(t); };
    this.raf = requestAnimationFrame(this.loop);
  }
  Arena.prototype.attach = function (host) {
    if (this.resizeObserver) this.resizeObserver.unobserve(this.host);
    this.host = host;
    host.textContent = '';
    host.appendChild(this.canvas);
    host.appendChild(this.labels);
    host.appendChild(this.banner);
    if (this.resizeObserver) this.resizeObserver.observe(host);
    this.resize();
  };
  Arena.prototype.resize = function () {
    var r = this.host.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    // The mobile game may rotate the whole stage 90°. Keep the canvas in
    // layout coordinates; a rotated bounding rect swaps width and height.
    var w = this.host.clientWidth || r.width, h = this.host.clientHeight || r.height;
    var scale = Math.sqrt(r.width * r.height / Math.max(1, w * h)) || 1;
    this.width = Math.max(2, Math.round(w * scale * dpr));
    this.height = Math.max(2, Math.round(h * scale * dpr));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  };
  Arena.prototype.play = function (actor, name) {
    var action = actor.actions[name];
    if (!action || (actor.current === name && name === 'idle')) return;
    var old = actor.actions[actor.current];
    if (old) old.fadeOut(.18);
    action.reset();
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(name === 'bid' ? 1.4 : 1);
    action.setLoop(name === 'idle' || name === 'win' ? T.LoopRepeat : T.LoopOnce, Infinity);
    action.clampWhenFinished = name === 'lose';
    action.fadeIn(.18).play();
    actor.current = name;
  };
  Arena.prototype.update = function (a, first) {
    if (this.destroyed) return;
    this.data = a;
    this.offset = a.now - (a.seen || Date.now());
    var self = this;
    (a.bids || []).forEach(function (b) {
      var key = b.at + ':' + b.price + ':' + b.who;
      if (self.seen[key]) return;
      self.seen[key] = true;
      // Reopening an auction never replays old bids or old money sounds.
      if (first || a.status !== 'live' || a.now - b.at > 4000) return;
      var actor = self.byId[b.who];
      if (!actor) return;
      self.play(actor, 'bid');
      actor.cashUntil = performance.now() + 1350;
    });
    this.actors.forEach(function (actor) { actor.label.classList.toggle('lead', actor.id === a.leader); });
    if (a.status !== 'live' && !this.resultAt) {
      this.resultAt = performance.now() || 1;
      this.fromCamera = this.camera.position.clone();
      this.fromTarget = this.target.clone();
      var winner = a.winner || (a.status === 'won' ? 'me' : a.status === 'lost' ? a.leader : null);
      this.winner = this.byId[winner] || this.byId.me;
      this.actors.forEach(function (actor) {
        self.play(actor, actor.id === winner && (a.status === 'won' || a.status === 'lost') ? 'win' : 'lose');
        actor.cash.hidden = true;
      });
      this.labels.classList.add('result');
    }
  };
  Arena.prototype.message = function (s) {
    if (this.bannerValue === s) return;
    this.bannerValue = s;
    this.banner.textContent = s;
  };
  Arena.prototype.frame = function (t) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.host.isConnected) { this.last = t; return; }
    var dt = this.last ? Math.min(.08, (t - this.last) / 1000) : 0;
    this.last = t;
    this.actors.forEach(function (actor) { actor.mixer.update(dt); });
    var a = this.data, now = Date.now() + this.offset, intro = a.status === 'live' && now < a.startsAt;
    var renderer = this.renderer, width = this.width, height = this.height;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    if (this.resultAt) {
      var p = this.winner.root.position;
      var head = new T.Vector3(p.x, p.y + 1.48, p.z);
      if (this.winner.head) this.winner.head.getWorldPosition(head);
      var target = new T.Vector3(head.x, head.y + .13, head.z);
      var end = new T.Vector3(head.x + .08, head.y + .19, head.z + 1.05);
      var progress = Math.min(1, (t - this.resultAt) / 1100);
      var ease = progress * progress * (3 - 2 * progress);
      this.camera.position.lerpVectors(this.fromCamera, end, ease);
      this.target.lerpVectors(this.fromTarget, target, ease);
      this.camera.aspect = width * .57 / height;
      this.camera.fov = 34;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(this.target);
      renderer.setScissorTest(true);
      renderer.setViewport(0, 0, Math.round(width * .57), height);
      renderer.setScissor(0, 0, Math.round(width * .57), height);
      renderer.render(this.scene, this.camera);
      this.product.rotation.y += dt * .6; // a complete 360° view every ~10.5 s
      var h = this.productHeight;
      this.productCamera.aspect = width * .43 / height;
      this.productCamera.updateProjectionMatrix();
      var dist = h * 2.1 / Math.min(1, this.productCamera.aspect);
      this.productCamera.position.set(0, h * .68 + .22, dist);
      this.productCamera.lookAt(0, h * .5 + .22, 0);
      renderer.setViewport(Math.round(width * .57), 0, Math.ceil(width * .43), height);
      renderer.setScissor(Math.round(width * .57), 0, Math.ceil(width * .43), height);
      renderer.render(this.productScene, this.productCamera);
      renderer.setScissorTest(false);
      var winnerName = this.winner.label.textContent;
      this.message((a.status === 'won' || a.status === 'lost' ? '落札者：' + winnerName : '競り終了') + '　｜　' + (a.market === 'seed' ? '種' : '木') + 'を360°表示');
      return;
    }
    if (intro) {
      var duration = a.introMs || 7000;
      var elapsed = Math.max(0, Math.min(duration, now - (a.startsAt - duration)));
      var sweep = Math.min(1, elapsed / (duration - 650));
      var index = Math.round(sweep * (this.actors.length - 1));
      var one = this.actors[index].root.position;
      // Close tracking shot passes every buyer continuously, then pulls out.
      var x = this.actors[0].root.position.x + (this.actors[this.actors.length - 1].root.position.x - this.actors[0].root.position.x) * sweep;
      this.camera.position.set(x + .12, this.floor + 1.55, one.z + 3.25);
      this.target.set(x, this.floor + 1.15, one.z);
      if (elapsed > duration - 650) {
        var out = (elapsed - duration + 650) / 650;
        this.camera.position.lerp(this.fixed, out * out * (3 - 2 * out));
        this.target.lerp(new T.Vector3(0, 1.1, 2), out);
      }
      this.message('参加者紹介　' + this.actors[index].label.textContent + '　｜　まもなく競り開始');
    } else {
      this.camera.position.copy(this.fixed);
      this.target.set(0, 1.1, 2);
      this.message('競り開催中　｜　最大6人の仲卸業者');
    }
    this.camera.aspect = width / height;
    // The bidding view gets taller on 16:9 phones. Preserve the horizontal
    // field of view so both buyers at the ends remain fully visible.
    this.camera.fov = intro ? 34 : Math.min(75, 2 * Math.atan(Math.tan(17 * Math.PI / 180) * Math.max(1, 2.64 / this.camera.aspect)) * 180 / Math.PI);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
    renderer.render(this.scene, this.camera);
    var camera = this.camera, pos = new T.Vector3();
    this.actors.forEach(function (actor) {
      if (actor.head) actor.head.getWorldPosition(pos);
      else pos.copy(actor.root.position).add(new T.Vector3(0, 1.8, 0));
      pos.y += .36;
      pos.project(camera);
      var visible = pos.z > -1 && pos.z < 1 && Math.abs(pos.x) < 1.12 && Math.abs(pos.y) < 1.15;
      actor.label.hidden = !visible;
      actor.label.style.left = (pos.x * .5 + .5) * 100 + '%';
      actor.label.style.top = (-pos.y * .5 + .5) * 100 + '%';
      actor.cash.hidden = !visible || t > actor.cashUntil;
      actor.cash.style.left = (pos.x * .5 + .5) * 100 + '%';
      actor.cash.style.top = (-pos.y * .5 + .5) * 100 + '%';
    });
  };
  Arena.prototype.dispose = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.actors.forEach(function (actor) { actor.mixer.stopAllAction(); actor.mixer.uncacheRoot(actor.mixer.getRoot()); });
    this.generated.forEach(function (x) { x.dispose(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.labels.remove();
    this.banner.remove();
  };
  BR.auction3d = { preload: preload, mount: mount };
})(window.BR = window.BR || {});
