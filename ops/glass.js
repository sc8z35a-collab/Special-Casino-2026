/* The lens and the light of the liquid glass (ops/glass.css draws the rest).

   Where the browser can bend what is behind a pane (Chromium: backdrop-filter with an SVG
   displacement map), each large pane gets a map of its own size: nothing at the middle,
   a push toward the middle at the edge, so the picture behind seems to bend round the rim
   like thick glass. Elsewhere (Safari, Firefox) the glass is blur, colour, rim and shine,
   which is all CSS. The map is drawn small (a third of the size) and stretched, once per size.

   And a spot of light that follows the mouse over a pane (mouse only; a touch screen has none).

   Only the DOM and CSSOM are used (no inline style attribute, nothing the page's content
   security policy would refuse). Nothing is sent anywhere. Off at once when the glass is off
   (body.mac-flat), and not started on a device that says it is weak. */
(function () {
  'use strict';
  var body = document.body, NS = 'http://www.w3.org/2000/svg';

  var brands = navigator.userAgentData && navigator.userAgentData.brands;
  var isChromium = brands ? brands.some(function (b) { return /Chromium/i.test(b.brand); }) : /Chrome\//.test(navigator.userAgent);
  var weak = (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2);
  var canLens = isChromium && !weak && window.CSS && CSS.supports && CSS.supports('backdrop-filter', 'url(#x) blur(1px)');
  var phone = window.matchMedia('(max-width: 700px)');
  var coarse = window.matchMedia('(hover: none)');

  // what gets a lens: selector, how far the edge pushes (px), how wide the bent rim is (px), whether a phone leaves it out,
  // and (the upgraded glass of CDW) how much the colours part at the rim: red is bent by (1 - that) of the push, blue by (1 + that)
  var KINDS = [
    ['.cdw-widget', 22, 34, true, .22],
    ['.cdw-bar', 8, 16, true, .16],
    ['.cdw-palette', 12, 24, true, .18],
    ['.mac-dock', 12, 22, false],
    ['.mac-window', 20, 30, true],
    ['.mac-notifications', 14, 24, false],
    ['.mac-dropdown', 10, 18, false],
    ['.mac-account', 10, 18, false],
    ['.mac-help-panel', 14, 24, false],
    ['.dialog', 14, 24, false],
    ['.drawer', 14, 24, false]
  ];
  var PANES = KINDS.map(function (k) { return k[0]; }).join(', ');

  var host = null, items = new Map(), watched = new WeakSet(), counter = 0, ro = null, maps = new Map();

  function flat() { return body.classList.contains('mac-flat'); }
  function off() { return !canLens || flat(); }
  function kindOf(el) { return KINDS.filter(function (k) { return el.matches(k[0]); })[0]; }

  // the map: red and green say how far, and which way, each point of the picture is taken from
  function lensMap(w, h, radius, bezel) {
    var key = w + 'x' + h + 'r' + radius + 'b' + bezel;
    if (maps.has(key)) return maps.get(key);
    var k = 3, cw = Math.max(4, Math.round(w / k)), ch = Math.max(4, Math.round(h / k));
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var g = c.getContext('2d'), im = g.createImageData(cw, ch), d = im.data;
    var rr = Math.min(radius / k, cw / 2, ch / 2), bb = Math.max(1, bezel / k);
    var hx = cw / 2 - rr, hy = ch / 2 - rr;
    for (var y = 0; y < ch; y++) {
      for (var x = 0; x < cw; x++) {
        var px = x + .5 - cw / 2, py = y + .5 - ch / 2;
        var qx = Math.abs(px) - hx, qy = Math.abs(py) - hy;
        var ox = Math.max(qx, 0), oy = Math.max(qy, 0), outside = Math.sqrt(ox * ox + oy * oy);
        var dist = rr - (outside + Math.min(Math.max(qx, qy), 0));      // how far inside the edge
        var i = (y * cw + x) * 4, r = 128, gr = 128;
        if (dist < bb) {
          var t = 1 - Math.max(0, dist) / bb, m = t * t, nx, ny;
          if (outside > 0) { nx = ox / outside * (px < 0 ? -1 : 1); ny = oy / outside * (py < 0 ? -1 : 1); }
          else if (qx > qy) { nx = px < 0 ? -1 : 1; ny = 0; }
          else { nx = 0; ny = py < 0 ? -1 : 1; }
          // the picture is taken from a little further in, so the rim shows what lies just inside it
          r = 128 - nx * m * 127; gr = 128 - ny * m * 127;
        }
        d[i] = r; d[i + 1] = gr; d[i + 2] = 128; d[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
    var url = c.toDataURL('image/png');
    if (maps.size > 24) maps.delete(maps.keys().next().value);
    maps.set(key, url);
    return url;
  }

  function defs() {
    if (!host) {
      host = document.createElementNS(NS, 'svg');
      host.setAttribute('class', 'mac-glass-defs'); host.setAttribute('width', '0'); host.setAttribute('height', '0');
      host.setAttribute('aria-hidden', 'true'); host.setAttribute('focusable', 'false');
      host.appendChild(document.createElementNS(NS, 'defs'));
      body.appendChild(host);
    }
    return host.firstChild;
  }
  var SPLIT = [['r', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', -1], ['g', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 0], ['b', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 1]];
  function make(shift, split) {
    var id = 'lg' + (++counter);
    var f = document.createElementNS(NS, 'filter');
    f.setAttribute('id', id); f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '1'); f.setAttribute('height', '1');
    f.setAttribute('filterUnits', 'objectBoundingBox'); f.setAttribute('primitiveUnits', 'userSpaceOnUse'); f.setAttribute('color-interpolation-filters', 'sRGB');
    var image = document.createElementNS(NS, 'feImage');
    image.setAttribute('x', '0'); image.setAttribute('y', '0'); image.setAttribute('preserveAspectRatio', 'none'); image.setAttribute('result', 'map');
    f.appendChild(image);
    function bend(scale, result) {
      var d = document.createElementNS(NS, 'feDisplacementMap');
      d.setAttribute('in', 'SourceGraphic'); d.setAttribute('in2', 'map'); d.setAttribute('xChannelSelector', 'R'); d.setAttribute('yChannelSelector', 'G'); d.setAttribute('scale', String(scale));
      if (result) d.setAttribute('result', result);
      f.appendChild(d);
    }
    if (!split) bend(shift * 2);
    else {
      // three pictures of what is behind, each bent by its own amount and kept to one colour, laid back together
      SPLIT.forEach(function (c) {
        bend(shift * 2 * (1 + c[2] * split), 'b' + c[0]);
        var m = document.createElementNS(NS, 'feColorMatrix');
        m.setAttribute('in', 'b' + c[0]); m.setAttribute('type', 'matrix'); m.setAttribute('values', c[1]); m.setAttribute('result', 'c' + c[0]);
        f.appendChild(m);
      });
      [['cr', 'cg', 'rg'], ['rg', 'cb', '']].forEach(function (p) {
        var bl = document.createElementNS(NS, 'feBlend');
        bl.setAttribute('in', p[0]); bl.setAttribute('in2', p[1]); bl.setAttribute('mode', 'screen'); if (p[2]) bl.setAttribute('result', p[2]);
        f.appendChild(bl);
      });
    }
    defs().appendChild(f);
    return { id: id, filter: f, image: image, w: 0, h: 0, timer: 0 };
  }

  function build(el) {
    var kind = kindOf(el);
    if (!kind || off() || (kind[3] && phone.matches)) { unlens(el); return; }
    var w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h) return;
    var rec = items.get(el);
    if (!rec) { rec = make(kind[1], kind[4] || 0); items.set(el, rec); }
    // the map follows the size at once (stretched); it is drawn again when the size has settled
    rec.image.setAttribute('width', String(w)); rec.image.setAttribute('height', String(h));
    if (rec.w === w && rec.h === h) return;
    rec.w = w; rec.h = h;
    clearTimeout(rec.timer);
    var draw = function () {
      var radius = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
      rec.image.setAttribute('href', lensMap(w, h, Math.round(radius), Math.min(kind[2], Math.floor(Math.min(w, h) / 3))));
      el.style.setProperty('--lg-lens', 'url(#' + rec.id + ')');
    };
    if (rec.image.getAttribute('href')) { el.style.setProperty('--lg-lens', 'url(#' + rec.id + ')'); rec.timer = setTimeout(draw, 160); } else draw();
  }
  function unlens(el) { el.style.removeProperty('--lg-lens'); var rec = items.get(el); if (rec) { clearTimeout(rec.timer); rec.w = rec.h = 0; } }

  function watch(el) {
    if (watched.has(el)) return;
    watched.add(el);
    if (!ro) ro = new ResizeObserver(function (list) { list.forEach(function (e) { build(e.target); }); });
    ro.observe(el);
  }
  function scan() {
    // (a pane that has left the page takes its filter with it)
    items.forEach(function (rec, el) { if (!el.isConnected) { clearTimeout(rec.timer); if (ro) ro.unobserve(el); rec.filter.remove(); items.delete(el); } });
    Array.prototype.forEach.call(document.querySelectorAll(PANES), watch);
  }
  function sync() { scan(); items.forEach(function (rec, el) { if (off()) unlens(el); else build(el); }); }

  // the spot of light that follows the pointer over the pane it is on
  var lit = null, pending = null, frame = 0;
  function light() {
    frame = 0;
    var e = pending; pending = null;
    if (!e || flat()) return;
    var pane = e.target && e.target.closest ? e.target.closest(PANES) : null;
    if (lit && lit !== pane) { lit.style.removeProperty('--lx'); lit.style.removeProperty('--ly'); }
    lit = pane;
    if (!pane) return;
    var r = pane.getBoundingClientRect();
    if (!r.width || !r.height) return;
    pane.style.setProperty('--lx', Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)).toFixed(1) + '%');
    pane.style.setProperty('--ly', Math.max(-10, Math.min(110, (e.clientY - r.top) / r.height * 100)).toFixed(1) + '%');
  }
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' || coarse.matches) return;
    pending = e;
    if (!frame) frame = requestAnimationFrame(light);
  }, { passive: true });

  new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['class'] });
  phone.addEventListener('change', sync);
  window.OpsGlass = { scan: scan, lens: function () { return !off(); } };
  if (canLens) scan();
})();
