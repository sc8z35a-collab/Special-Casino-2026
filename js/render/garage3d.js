/* The cars in 3D: Car Owner's studio and the garage in 3D.
   The studio: the car on the round base (its pattern up), lit low and
   dramatic by two stage lights (a moving head and a spotlight on a stand,
   each with a real light and a soft beam) in a dark room with a glossy floor,
   and behind the car a curve of bookshelves (the vault's 書棚) lit warm from
   above. In Car Owner the camera stands close to the car and stays still: a
   drag turns it round the car, the wheel or a pinch zooms in and out a little.
   The garage in 3D (ガレージ3D, from the garage, full screen): the vault's
   garage (its open side towards us), one's car parked in it nose out, lit
   from the ceiling, a dark driveway outside. The camera looks in from the
   door and sweeps slowly from side to side; a drag looks from elsewhere (never
   round the walls). A double tap goes in in first person: walk round the car
   and about the garage (the stick, or W A S D; the walls, the cabinets and
   the car stop one), look round with a drag, and zoom up to 5x like a camera
   lens: the background melts into bokeh as the lens gets longer, colour
   fringes at the edges (chromatic aberration), a sensor's moire on fine
   detail, a vignette and a little grain. Another double tap (or 戻る) comes
   back out.
   three.js and the models load the first time they are needed (online only,
   with WebGL); one renderer serves both places. */
(function (BR) {
  'use strict';

  var STUDIO = { base: 'img/3d/studio/base.glb', moving: 'img/3d/studio/moving-head.glb', spot: 'img/3d/studio/spotlight.glb', shelf: 'img/3d/studio/bookshelf.glb' };
  var GARAGE = 'img/3d/garage/garage.glb';
  function carFile(id) { return 'img/3d/cars/' + id + '.glb'; }
  // sizes in metres
  var CAR_LEN = 4.6, BASE_D = 6.8, MOVING_H = 0.95, SPOT_H = 2.45, EYE = 1.6;
  var FOV = 42, ZOOM_MAX = 5;
  // Car Owner's camera: how far from the car at first, and how near / far the zoom goes
  var SHOW = { dist: 4.7, near: 3.3, far: 7.2 };
  // the bookshelves behind the car: how tall, how far from it, how many
  var SHELF = { h: 2.5, r: 6.9, n: 7 };
  /* The garage, measured on its model at ROOM.h tall (its open side to +z):
     the floor inside, the side walls (x = ±half), the cabinets at the back
     (left of x = -1: z = cabinets; else z = back), the door (z = front) and
     the ceiling; where the car stands (z), and the margins kept from the
     walls and the car on foot. */
  var ROOM = { h: 3.4, floor: 0.06, half: 1.95, back: -3.04, cabinets: -2.36, front: 3.5, top: 3.1, carZ: 0.4, body: 0.3 };
  // the camera in the garage: how far from the car, how near / far, how far round to either side of the door (radians)
  var PARK = { dist: 6.4, near: 3.2, far: 8.5, turn: 0.5 };

  var T = null;
  var g = null;            // the one renderer: { canvas, renderer, camera, controls, composer, world, fps }
  var studio = null;       // the places: { scene, car, carId, exposure, place(car) }
  var garage = null;
  var three = null, studioLoad = null, garageLoad = null;
  var cars = {};           // car id -> Promise of its model (metres, standing on y = 0)
  var mode = '';           // '' | 'show' (Car Owner) | 'space' (the garage) | 'walk' (first person in the garage)
  var host = null, raf = 0, last = 0;
  var walk = null;         // first person: { yaw, pitch, zoom, keys, stick, focus }

  function online() { return !!(BR.api && BR.api.online); }
  function webgl() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  }
  function supported() { return online() && webgl(); }
  // the view's height in degrees: wider on a screen taller than it is wide (a phone held upright), to see more than a sliver across
  function fov() {
    var a = g.camera.aspect;
    return a >= 1 ? FOV : Math.min(75, 2 * Math.atan(Math.tan(FOV * Math.PI / 360) / a) * 180 / Math.PI);
  }
  function has(id) {
    var list = BR.CONFIG.cars;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return !!list[i].model;
    return false;
  }

  /* ------------------------------------------------------------ loading --- */
  function gltf(url, progress) {
    return new Promise(function (resolve, reject) {
      new T.GLTFLoader().setMeshoptDecoder(T.MeshoptDecoder).load(url, function (r) { resolve(r.scene); }, function (e) {
        if (progress && e && e.total) progress(e.loaded / e.total);
      }, reject);
    });
  }
  // a model scaled to `size` metres along `axis` ('x' or 'y'), centred on x/z, standing on y = 0
  function fit(obj, axis, size) {
    var box = new T.Box3().setFromObject(obj), s = box.getSize(new T.Vector3());
    var k = size / (axis === 'x' ? s.x : s.y);
    obj.scale.multiplyScalar(k);
    box.setFromObject(obj);
    var c = box.getCenter(new T.Vector3());
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.position.y -= box.min.y;
    var holder = new T.Group();
    holder.add(obj);
    return holder;
  }
  function shadows(obj, cast, receive) {
    obj.traverse(function (o) { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  }

  // three.js and the renderer
  function lib() {
    if (!three) {
      three = BR.win3d.three().then(function (l) {
        T = l;
        if (!g) build();
      }, function (e) { three = null; throw e; });
    }
    return three;
  }
  function loadStudio(progress) {
    if (studioLoad) return studioLoad;
    var parts = 0, done = function (m) { parts++; if (progress) progress(parts / 4); return m; };
    studioLoad = lib().then(function () {
      return Promise.all([gltf(STUDIO.base).then(done), gltf(STUDIO.moving).then(done), gltf(STUDIO.spot).then(done), gltf(STUDIO.shelf).then(done)]);
    }).then(function (m) {
      studio = makeStudio(m[0], m[1], m[2], m[3]);
      return studio;
    }).catch(function (e) {
      studioLoad = null;
      throw e;
    });
    return studioLoad;
  }
  function loadGarage(progress) {
    if (garageLoad) return garageLoad;
    garageLoad = lib().then(function () { return gltf(GARAGE, progress); }).then(function (m) {
      garage = makeGarage(m);
      return garage;
    }).catch(function (e) {
      garageLoad = null;
      throw e;
    });
    return garageLoad;
  }
  function car(id) {
    if (!cars[id]) {
      cars[id] = gltf(carFile(id)).then(function (m) {
        // its nose to -x in the file: turned to face the front-left of the studio
        var c = fit(m, 'x', CAR_LEN);
        c.rotation.y = 0.55;
        shadows(c, true, true);
        return c;
      }, function (e) { delete cars[id]; throw e; });
    }
    return cars[id];
  }

  /* ------------------------------------------------------------ the renderer --- */
  function build() {
    var canvas = document.createElement('canvas');
    canvas.className = 'g3d-canvas';
    var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    var camera = new T.PerspectiveCamera(FOV, 16 / 9, 0.05, 80);
    var controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    g = { canvas: canvas, renderer: renderer, camera: camera, controls: controls, composer: null, world: null, fps: 60 };
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); stop(); }, false);
  }
  // a place's scene: its background, its fog and the reflections round it
  function world(bg, fogFrom, fogTo, env) {
    var scene = new T.Scene();
    scene.background = new T.Color(bg);
    scene.fog = new T.Fog(bg, fogFrom, fogTo);
    var pm = new T.PMREMGenerator(g.renderer);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = env;
    pm.dispose();
    return { scene: scene, car: null, carId: '' };
  }
  function ground(scene, color, roughness) {
    var floor = new T.Mesh(new T.CircleGeometry(30, 64), new T.MeshStandardMaterial({ color: color, roughness: roughness, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  // a soft beam of light from `from` to `to` (a cone that fades along it and at its edges)
  function beam(from, to, radius, color) {
    var len = from.distanceTo(to);
    var geo = new T.CylinderGeometry(0.06, radius, len, 40, 1, true);
    geo.translate(0, -len / 2, 0);
    geo.rotateX(-Math.PI / 2);
    var mat = new T.ShaderMaterial({
      uniforms: { color: { value: new T.Color(color) }, strength: { value: 0.24 } },
      vertexShader: 'varying float vAlong; varying vec3 vN; varying vec3 vView;' +
        'void main() { vAlong = clamp(position.z / ' + len.toFixed(3) + ', 0.0, 1.0);' +
        'vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);' +
        'gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 color; uniform float strength; varying float vAlong; varying vec3 vN; varying vec3 vView;' +
        'void main() { float edge = pow(abs(dot(vN, vView)), 1.6); float a = strength * edge * pow(1.0 - vAlong, 1.4);' +
        'gl_FragColor = vec4(color * a, a); }',
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide
    });
    var m = new T.Mesh(geo, mat);
    m.position.copy(from);
    m.lookAt(to);
    m.renderOrder = 2;
    return m;
  }

  // the glow of a lamp's lens (a soft round sprite, added light)
  function glow(at, color, size) {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 128, 128);
    var sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), color: color, blending: T.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.position.copy(at);
    sp.scale.set(size, size, 1);
    return sp;
  }

  /* ------------------------------------------------------------ the studio --- */
  function makeStudio(baseM, movingM, spotM, shelfM) {
    var w = world(0x06070b, 16, 40, 0.1), s = w.scene;
    w.exposure = 0.78;
    s.add(new T.HemisphereLight(0x8a96b8, 0x0b0b10, 0.12));
    // the glossy floor, fading into the dark
    ground(s, 0x0e0f14, 0.5);
    // the round base, its pattern up (the pattern faces +z in the file)
    baseM.rotation.x = -Math.PI / 2;
    var base = fit(baseM, 'x', BASE_D);
    shadows(base, false, true);
    s.add(base);
    var baseTop = new T.Box3().setFromObject(base).max.y;
    // the car on it, turned to the front left
    w.place = function (c) { c.rotation.y = 0.55; c.position.set(0, baseTop, 0); };
    var target = new T.Vector3(0, 0.75, 0);
    // the moving head on the floor at the back left, its head towards the car
    var moving = fit(movingM, 'y', MOVING_H);
    moving.position.set(-4.1, 0, -2.5);
    moving.rotation.y = Math.atan2(-moving.position.x, -moving.position.z) + Math.PI / 2;
    shadows(moving, true, false);
    s.add(moving);
    // the spotlight on its stand at the front right, facing the car
    var spot = fit(spotM, 'y', SPOT_H);
    spot.position.set(4.6, 0, 3.0);
    spot.rotation.y = Math.atan2(-spot.position.x, -spot.position.z);
    shadows(spot, true, false);
    s.add(spot);
    // their lights, low and dramatic: a warm key from the spotlight (the
    // shadows), a cool one from the moving head picking out the car's edges
    var keyFrom = new T.Vector3(4.6, SPOT_H * 0.86, 3.0);
    var key = new T.SpotLight(0xffe6c8, 150, 0, 0.36, 0.75, 2);
    key.position.copy(keyFrom);
    key.target.position.copy(target);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 20;
    s.add(key, key.target);
    var coolFrom = new T.Vector3(-4.1, MOVING_H * 0.8, -2.5);
    var cool = new T.SpotLight(0x8fc4ff, 230, 9, 0.3, 0.5, 2);
    cool.position.copy(coolFrom);
    cool.target.position.set(0, 0.9, 0);
    s.add(cool, cool.target);
    // the lamps' lenses glow, and the moving head is lit a little from the front
    s.add(glow(coolFrom.clone().lerp(new T.Vector3(0, 0.9, 0), 0.05), 0x5f86b0, 0.45));
    s.add(glow(keyFrom.clone().lerp(target, 0.03), 0xa08a70, 0.45));
    var fill = new T.PointLight(0xc8d4ff, 2, 4, 2);
    fill.position.set(-3.2, 1.4, -1.4);
    s.add(fill);
    // a faint top light on the car (its pool stays on the base), and a dim
    // light behind so the stands and the moving head show against the dark
    var top = new T.SpotLight(0xffffff, 14, 0, 0.38, 0.9, 2);
    top.position.set(0, 9, 0);
    top.target.position.set(0, 0, 0);
    s.add(top, top.target);
    var back = new T.PointLight(0x6f7fa8, 5, 9, 2);
    back.position.set(0.6, 3.2, -4.2);
    s.add(back);
    s.add(beam(keyFrom, target, 1.5, 0xffe8c8), beam(coolFrom, new T.Vector3(0, 1.0, 0), 1.2, 0x9ccaff));
    // the bookshelves: a curve of them behind the car (seen from where the
    // camera starts), facing it, lit warm from above
    var shelf = fit(shelfM, 'y', SHELF.h);
    shadows(shelf, false, true);
    var sw = new T.Box3().setFromObject(shelf).getSize(new T.Vector3()).x;
    var behind = Math.atan2(4.9, 5.2) + Math.PI, step = (sw + 0.03) / SHELF.r;
    for (var i = 0; i < SHELF.n; i++) {
      var a = behind + (i - (SHELF.n - 1) / 2) * step, one = i ? shelf.clone() : shelf;
      one.position.set(SHELF.r * Math.sin(a), 0, SHELF.r * Math.cos(a));
      one.rotation.y = a + Math.PI;
      s.add(one);
    }
    [-0.62, 0.62].forEach(function (k) {
      var a = behind + k * step * (SHELF.n - 1) / 2;
      var lamp = new T.SpotLight(0xffc98a, 34, 0, 0.62, 0.85, 2);
      lamp.position.set(4.4 * Math.sin(a), 4.4, 4.4 * Math.cos(a));
      lamp.target.position.set(SHELF.r * Math.sin(a), 1.1, SHELF.r * Math.cos(a));
      s.add(lamp, lamp.target);
    });
    return w;
  }

  /* ------------------------------------------------------------ the garage --- */
  function makeGarage(roomM) {
    var w = world(0x05060a, 14, 34, 0.22), s = w.scene;
    w.exposure = 0.9;
    s.add(new T.HemisphereLight(0xdfe4ee, 0x2a2622, 0.3));
    // the driveway outside, in the dark (and the night's cool light on it)
    ground(s, 0x16171b, 0.85);
    var night = new T.DirectionalLight(0x8ea6d8, 0.22);
    night.position.set(-3, 6, 12);
    s.add(night);
    // the garage at its size, its floor taking the car's shadow
    var room = fit(roomM, 'y', ROOM.h);
    shadows(room, false, true);
    s.add(room);
    // the light over the car (its shadow on the floor), and the tube lights along the ceiling
    var top = new T.SpotLight(0xfff0dc, 42, 0, 0.95, 0.7, 2);
    top.position.set(0, ROOM.top - 0.12, ROOM.carZ);
    top.target.position.set(0, 0, ROOM.carZ);
    top.castShadow = true;
    top.shadow.mapSize.set(1024, 1024);
    top.shadow.bias = -0.0004;
    top.shadow.normalBias = 0.02;
    top.shadow.camera.near = 0.5;
    top.shadow.camera.far = 5;
    s.add(top, top.target);
    [-1.9, 2.4].forEach(function (z) {
      var tube = new T.PointLight(0xf2f5ff, 7, 7, 2);
      tube.position.set(0, ROOM.top - 0.25, z);
      s.add(tube);
    });
    // the inside, for the lens's focus (the walls are far too many triangles to test each frame)
    w.box = new T.Box3(new T.Vector3(-ROOM.half, ROOM.floor, ROOM.back), new T.Vector3(ROOM.half, ROOM.top, ROOM.front));
    // the car nose out (to the door), a little forward of the middle
    w.place = function (c) {
      c.rotation.y = Math.PI / 2;
      c.position.set(0, ROOM.floor, ROOM.carZ);
      c.updateMatrixWorld(true);
      var b = new T.Box3().setFromObject(c), m = ROOM.body;
      w.foot = { x0: b.min.x - m, x1: b.max.x + m, z0: b.min.z - m, z1: b.max.z + m };
    };
    return w;
  }
  // where one may stand in the garage (on foot, at x, z, coming from px, pz):
  // inside between the walls, out of the door onto the driveway, never into the car
  function bound(x, z, px, pz) {
    var R = ROOM, wall = R.half - R.body, door = R.front + R.body;
    z = Math.max((x < -1 ? R.cabinets : R.back) + R.body, Math.min(R.front + 6, z));
    if (z < door && Math.abs(x) > wall) {
      // from outside the front wall stops one; inside, the side walls
      if (pz >= door) z = door;
      else x = Math.max(-wall, Math.min(wall, x));
    }
    x = Math.max(-5, Math.min(5, x));
    var f = garage.car && garage.foot;
    if (f && x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1) {
      var d = [x - f.x0, f.x1 - x, z - f.z0, f.z1 - z], m = Math.min(d[0], d[1], d[2], d[3]);
      if (m === d[0]) x = f.x0; else if (m === d[1]) x = f.x1; else if (m === d[2]) z = f.z0; else z = f.z1;
    }
    return [x, z];
  }

  // the car into a place (from the other one, if it was there)
  function putCar(w, id) {
    if (w.carId === id && (w.car || !id)) return Promise.resolve();
    w.carId = id;
    if (!id) {
      if (w.car) w.scene.remove(w.car);
      w.car = null;
      return Promise.resolve();
    }
    return car(id).then(function (c) {
      if (w.carId !== id) return;
      if (w.car && w.car !== c) w.scene.remove(w.car);
      [studio, garage].forEach(function (o) { if (o && o !== w && o.car === c) { o.car = null; o.carId = ''; } });
      w.place(c);
      w.car = c;
      w.scene.add(c);
      g.renderer.compile(w.scene, g.camera);
    });
  }

  /* ------------------------------------------------------------ the frame --- */
  function size() {
    if (!host) return;
    // its own size (on a phone held upright the game is turned a quarter
    // round, and the box on screen has the width and height swapped)
    var r = host.getBoundingClientRect();
    var w = Math.max(1, host.clientWidth || Math.round(r.width)), h = Math.max(1, host.clientHeight || Math.round(r.height));
    // sharp enough for the pixels it covers on screen (the game may be drawn
    // smaller than its own size), never heavier than needed (and lighter once
    // frames get slow)
    var k = Math.max(r.width, r.height) / Math.max(w, h) || 1;
    var pr = Math.min((window.devicePixelRatio || 1) * k, mode === 'show' ? 1.5 : 1.75) * (g.fps < 30 ? 0.7 : 1);
    g.renderer.setPixelRatio(pr);
    g.renderer.setSize(w, h, false);
    g.camera.aspect = w / h;
    if (mode !== 'walk') g.camera.fov = fov();
    g.camera.updateProjectionMatrix();
    if (g.composer) {
      g.composer.setPixelRatio(pr);
      g.composer.setSize(w, h);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    if (dt > 0) g.fps += (1 / dt - g.fps) * 0.05;
    if (mode === 'walk') { stepWalk(dt); g.composer.render(dt); }
    else {
      if (mode === 'space') sweep();
      g.controls.update();
      g.renderer.render(g.world.scene, g.camera);
    }
  }
  function run() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  function attach(el, m, w) {
    host = el;
    mode = m;
    g.world = w;
    g.renderer.toneMappingExposure = w.exposure;
    if (g.canvas.parentNode !== el) el.appendChild(g.canvas);
    size();
  }

  // the orbit for Car Owner (close to the car and still; a drag turns it, a
  // little zoom) or the garage (looking in from the door, sweeping slowly
  // from side to side; never round the walls, never over the roof)
  function orbit(show) {
    var c = g.controls, cam = g.camera;
    c.enabled = true;
    c.enableZoom = true;
    cam.fov = fov();
    if (show) {
      c.autoRotate = false;
      c.zoomSpeed = 0.6;
      c.minDistance = SHOW.near;
      c.maxDistance = SHOW.far;
      c.minPolarAngle = Math.PI * 0.16;
      c.maxPolarAngle = Math.PI * 0.47;
      c.minAzimuthAngle = -Infinity;
      c.maxAzimuthAngle = Infinity;
      c.target.set(0, 0.7, 0);
      cam.position.set(4.9, 1.85, 5.2).sub(c.target).setLength(SHOW.dist).add(c.target);
    } else {
      c.autoRotate = true;
      c.autoRotateSpeed = 0.35;
      c.zoomSpeed = 1;
      c.minDistance = PARK.near;
      c.maxDistance = PARK.far;
      c.minPolarAngle = Math.PI * 0.36;
      c.maxPolarAngle = Math.PI * 0.49;
      c.minAzimuthAngle = -PARK.turn;
      c.maxAzimuthAngle = PARK.turn;
      c.target.set(0, ROOM.floor + 0.75, ROOM.carZ);
      var a = 0.3, e = 0.22;
      cam.position.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(PARK.dist).add(c.target);
    }
    cam.updateProjectionMatrix();
    c.update();
  }
  // the garage's slow sweep turns back before either side
  function sweep() {
    var c = g.controls;
    if (!c.autoRotate) return;
    var a = c.getAzimuthalAngle(), s = Math.abs(c.autoRotateSpeed);
    if (a > PARK.turn * 0.85) c.autoRotateSpeed = s;
    else if (a < -PARK.turn * 0.85) c.autoRotateSpeed = -s;
  }

  /* ------------------------------------------------------------ first person --- */
  // the lens: colour fringes, the sensor's moire on fine detail, vignette, grain
  var LENS = {
    uniforms: { tDiffuse: { value: null }, res: { value: null }, zoom: { value: 1 }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform sampler2D tDiffuse; uniform vec2 res; uniform float zoom; uniform float time; varying vec2 vUv;',
      'float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }',
      'void main() {',
      '  vec2 c = vUv - 0.5; float r2 = dot(c, c);',
      // chromatic aberration: wider towards the edges, and with a longer lens
      '  float ca = 0.0012 + 0.0016 * (zoom - 1.0);',
      '  vec3 col = vec3(texture2D(tDiffuse, vUv + c * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - c * ca).b);',
      // moire: the pixel grid beating against fine detail (it shows as the lens gets longer)
      '  vec2 px = vUv * res; vec2 o = 1.0 / res;',
      '  float l = luma(col);',
      '  float d = abs(l - luma(texture2D(tDiffuse, vUv + vec2(o.x, 0.0)).rgb)) + abs(l - luma(texture2D(tDiffuse, vUv + vec2(0.0, o.y)).rgb));',
      '  float detail = clamp(d * 5.0, 0.0, 1.0);',
      '  float beat = sin(px.x * 0.92 + px.y * 0.23) * sin(px.y * 0.87 - px.x * 0.19);',
      '  vec3 fringe = vec3(sin(beat * 3.1), sin(beat * 3.1 + 2.09), sin(beat * 3.1 + 4.19));',
      '  col += fringe * detail * smoothstep(1.4, 5.0, zoom) * 0.07 * (0.4 + l);',
      // vignette (a longer lens darkens the corners more) and a little grain
      '  col *= 1.0 - smoothstep(0.18, 0.62, r2 * (1.0 + 0.18 * (zoom - 1.0))) * 0.55;',
      '  col += (fract(sin(dot(px + time * 61.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.018;',
      '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
      '}'
    ].join('\n')
  };

  // (first person is only in the garage)
  function composer() {
    if (g.composer) return;
    var c = new T.EffectComposer(g.renderer);
    c.addPass(new T.RenderPass(garage.scene, g.camera));
    g.bokeh = new T.BokehPass(garage.scene, g.camera, { focus: 6, aperture: 0.002, maxblur: 0.006 });
    c.addPass(g.bokeh);
    g.lens = new T.ShaderPass(LENS);
    g.lens.uniforms.res.value = new T.Vector2(1, 1);
    c.addPass(g.lens);
    c.addPass(new T.OutputPass());
    g.composer = c;
    g.ray = new T.Raycaster();
  }

  function enterWalk() {
    if (mode !== 'space') return;
    composer();
    mode = 'walk';
    g.controls.enabled = false;
    g.controls.autoRotate = false;
    // standing where the camera was (or the nearest place one can stand), looking at the car
    var c = g.camera.position, t = g.controls.target, p = bound(c.x, c.z, c.x, c.z);
    g.camera.position.set(p[0], ROOM.floor + EYE, p[1]);
    walk = { yaw: Math.atan2(t.x - p[0], t.z - p[1]), pitch: -0.08, zoom: 1, keys: {}, stick: { x: 0, y: 0 }, focus: 6 };
    size();
    BR.garage3d.onMode && BR.garage3d.onMode('walk');
  }
  function leaveWalk() {
    if (mode !== 'walk') return;
    mode = 'space';
    walk = null;
    orbit(false);
    size();
    BR.garage3d.onMode && BR.garage3d.onMode('space');
  }

  function stepWalk(dt) {
    var w = walk, cam = g.camera;
    // moving: the stick or the keys, in the direction one looks
    var fx = w.stick.y + (w.keys.w || w.keys.arrowup ? 1 : 0) - (w.keys.s || w.keys.arrowdown ? 1 : 0);
    var sx = w.stick.x + (w.keys.d || w.keys.arrowright ? 1 : 0) - (w.keys.a || w.keys.arrowleft ? 1 : 0);
    var speed = 2.6 / Math.sqrt(w.zoom);
    var sin = Math.sin(w.yaw), cos = Math.cos(w.yaw);
    var p = bound(cam.position.x + (sin * fx - cos * sx) * speed * dt, cam.position.z + (cos * fx + sin * sx) * speed * dt, cam.position.x, cam.position.z);
    cam.position.set(p[0], ROOM.floor + EYE, p[1]);
    cam.rotation.set(w.pitch, w.yaw + Math.PI, 0, 'YXZ');
    // the lens: a longer one narrows the view
    cam.fov = 2 * Math.atan(Math.tan(fov() * Math.PI / 360) / w.zoom) * 180 / Math.PI;
    cam.updateProjectionMatrix();
    // focus where the middle of the view lands (the car, else the garage's walls, else far away), eased like a real lens
    g.ray.setFromCamera({ x: 0, y: 0 }, cam);
    var hit = garage.car && g.ray.intersectObject(garage.car, true)[0];
    var wall = !hit && g.ray.ray.intersectBox(garage.box, new T.Vector3());
    var want = hit ? hit.distance : wall ? wall.distanceTo(cam.position) : 12;
    w.focus += (want - w.focus) * Math.min(1, dt * 6);
    var u = g.bokeh.uniforms;
    u.focus.value = w.focus;
    u.aperture.value = 0.0012 * w.zoom * w.zoom;
    u.maxblur.value = 0.004 + 0.0028 * (w.zoom - 1);
    var res = g.lens.uniforms.res.value;
    g.renderer.getDrawingBufferSize(res);
    g.lens.uniforms.zoom.value = w.zoom;
    g.lens.uniforms.time.value = (performance.now() / 1000) % 100;
  }

  /* ------------------------------------------------------------ input in first person --- */
  var drag = null, pinch = null, taps = [];
  function onDown(e) {
    // two taps close together: in, or back out
    var now = performance.now();
    taps = taps.filter(function (t) { return now - t.at < 320; });
    if (taps.length && Math.abs(taps[0].x - e.clientX) < 40 && Math.abs(taps[0].y - e.clientY) < 40) {
      taps = [];
      if (mode === 'space') enterWalk(); else if (mode === 'walk') leaveWalk();
      return;
    }
    taps.push({ at: now, x: e.clientX, y: e.clientY });
    if (mode !== 'walk') return;
    if (pointers.size === 0) drag = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      var p = Array.from(pointers.values());
      pinch = { d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), zoom: walk.zoom };
      drag = null;
    }
  }
  var pointers = new Map();
  function onMove(e) {
    if (mode !== 'walk' || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      var p = Array.from(pointers.values());
      setZoom(pinch.zoom * Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) / pinch.d);
      return;
    }
    if (!drag) return;
    // looking round: slower the longer the lens
    var k = 0.0042 / walk.zoom;
    walk.yaw -= (e.clientX - drag.x) * k;
    walk.pitch = Math.max(-1.1, Math.min(1.0, walk.pitch - (e.clientY - drag.y) * k));
    drag = { x: e.clientX, y: e.clientY };
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) drag = null;
  }
  function onWheel(e) {
    if (mode !== 'walk') return;
    e.preventDefault();
    setZoom(walk.zoom * Math.exp(-e.deltaY * 0.0015));
  }
  function onKey(e) {
    if (mode !== 'walk') return;
    var k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) < 0) return;
    walk.keys[k] = e.type === 'keydown';
    e.preventDefault();
  }
  function setZoom(z) {
    if (!walk) return;
    walk.zoom = Math.max(1, Math.min(ZOOM_MAX, z));
    if (BR.garage3d.onZoom) BR.garage3d.onZoom(walk.zoom);
  }
  function listen(el) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);
  window.addEventListener('resize', function () { if (g && host) size(); });

  /* ------------------------------------------------------------ the public side --- */
  var listening = false;
  function start(el, id, m, progress) {
    var w = null;
    return (m === 'show' ? loadStudio(progress) : loadGarage(progress)).then(function (place) {
      w = place;
      if (!listening) { listen(g.canvas); listening = true; }
      attach(el, m, w);
      orbit(m === 'show');
      return putCar(w, id);
    }).then(function () {
      if (host !== el || g.world !== w) return;
      run();
    });
  }

  BR.garage3d = {
    supported: supported,
    has: has,
    // Car Owner: the car in the studio inside `el`, close up (progress(0..1) while loading)
    show: function (el, id, progress) { return start(el, id, 'show', progress); },
    // the garage in 3D inside `el`, the car `id` parked in it ('': none; double tap: first person)
    space: function (el, id, progress) { return start(el, id || '', 'space', progress); },
    walk: function (on) { if (on) enterWalk(); else leaveWalk(); },
    zoom: setZoom,
    stick: function (x, y) { if (walk) { walk.stick.x = x; walk.stick.y = y; } },
    mode: function () { return mode; },
    // stops drawing (the canvas stays where it is until shown elsewhere)
    stop: function () { stop(); if (mode === 'walk') leaveWalk(); mode = ''; host = null; },
    onMode: null,
    onZoom: null,
    // (the renderer and the places, to look into them while working on them)
    debug: function () { return { g: g, studio: studio, garage: garage }; }
  };
})(window.BR = window.BR || {});
