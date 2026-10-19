/* The device the game runs on, for the server's two accounts a device and
   for BANs that reach every account on a phone (server/core/api.js). Sent
   with every request as X-Device: "<id>~<fingerprint>".
   - id: random, kept in four places (localStorage, a cookie, IndexedDB and
     the Cache Storage); whichever survives a clean-up brings the others back.
   - fingerprint: a hash of what the phone and its browser are like (screen,
     processor, memory, time zone, languages, graphics chip, how text and
     shapes are drawn), the same after the storage is wiped; the server only
     matches it together with the same address. */
(function (BR) {
  'use strict';

  var KEY = 'blockbuster-reels/device';
  var COOKIE = 'brdev';
  var CACHE = 'br-device';
  var ID_RE = /^[0-9a-f]{32}$/;

  function newId() {
    var b = new Uint8Array(16);
    try { crypto.getRandomValues(b); } catch (e) { for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(b, function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  function valid(v) { return typeof v === 'string' && ID_RE.test(v) ? v : ''; }

  /* ------------------------------------------------------------ the places it is kept --- */
  function readLocal() { try { return valid(localStorage.getItem(KEY)); } catch (e) { return ''; } }
  function writeLocal(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* blocked */ } }
  function readCookie() {
    var m = new RegExp('(?:^|;\\s*)' + COOKIE + '=([0-9a-f]{32})').exec(document.cookie || '');
    return m ? m[1] : '';
  }
  function writeCookie(v) {
    try { document.cookie = COOKIE + '=' + v + '; max-age=315360000; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) { /* blocked */ }
  }
  function openIdb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no idb')); return; }
      var req = indexedDB.open('blockbuster-reels', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function readIdb() {
    return openIdb().then(function (db) {
      return new Promise(function (resolve) {
        var r = db.transaction('kv').objectStore('kv').get(KEY);
        r.onsuccess = function () { resolve(valid(r.result)); };
        r.onerror = function () { resolve(''); };
      });
    }).catch(function () { return ''; });
  }
  function writeIdb(v) {
    openIdb().then(function (db) { db.transaction('kv', 'readwrite').objectStore('kv').put(v, KEY); }).catch(function () { /* unavailable */ });
  }
  function readCache() {
    if (!window.caches) return Promise.resolve('');
    return caches.open(CACHE).then(function (c) { return c.match('/__device'); })
      .then(function (r) { return r ? r.text() : ''; }).then(valid).catch(function () { return ''; });
  }
  function writeCache(v) {
    if (!window.caches) return;
    caches.open(CACHE).then(function (c) { return c.put('/__device', new Response(v)); }).catch(function () { /* unavailable */ });
  }

  // the id everywhere it is kept
  function keep(v) {
    if (readLocal() !== v) writeLocal(v);
    if (readCookie() !== v) writeCookie(v);
    writeIdb(v);
    writeCache(v);
  }

  /* ------------------------------------------------------------ the fingerprint --- */
  // two 32-bit FNV-1a style hashes with different seeds: 16 hex characters each
  function hash(s, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
      h ^= h >>> 13;
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0).toString(16);
  }
  function pad8(x) { return ('0000000' + x).slice(-8); }
  function digest(s) { return pad8(hash(s, 2166136261)) + pad8(hash(s, 374761393)) + pad8(hash(s, 668265263)) + pad8(hash(s, 3266489917)); }

  function canvasPart() {
    try {
      var c = document.createElement('canvas');
      c.width = 240;
      c.height = 60;
      var g = c.getContext('2d');
      if (!g) return '';
      g.textBaseline = 'top';
      g.font = '16px "Arial", sans-serif';
      g.fillStyle = '#f60';
      g.fillRect(100, 1, 62, 20);
      g.fillStyle = '#069';
      g.fillText('TWO STATE カジノ 7777 ¥$€', 2, 15);
      g.fillStyle = 'rgba(102, 204, 0, 0.7)';
      g.fillText('TWO STATE カジノ 7777 ¥$€', 4, 17);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = 'rgb(255,0,255)';
      g.beginPath(); g.arc(50, 30, 22, 0, Math.PI * 2); g.closePath(); g.fill();
      g.fillStyle = 'rgb(0,255,255)';
      g.beginPath(); g.arc(70, 30, 22, 0, Math.PI * 2); g.closePath(); g.fill();
      return digest(c.toDataURL());
    } catch (e) { return ''; }
  }
  function glPart() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return '';
      var info = gl.getExtension('WEBGL_debug_renderer_info');
      var out = [
        info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        gl.getParameter(gl.MAX_TEXTURE_SIZE),
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        (gl.getSupportedExtensions() || []).length
      ].join('|');
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return out;
    } catch (e) { return ''; }
  }
  function fingerprint() {
    var n = navigator, s = window.screen || {};
    var w = s.width || 0, h = s.height || 0;
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* old browser */ }
    var parts = [
      n.platform || '',
      // the browser without its version numbers (an update keeps the fingerprint)
      String(n.userAgent || '').replace(/[\d._]+/g, ''),
      (n.languages || [n.language]).join(','),
      n.hardwareConcurrency || 0,
      n.deviceMemory || 0,
      n.maxTouchPoints || 0,
      // turning the phone does not change it
      Math.min(w, h) + 'x' + Math.max(w, h),
      s.colorDepth || 0,
      Math.round((window.devicePixelRatio || 1) * 100),
      tz,
      new Date(2026, 0, 1).getTimezoneOffset(),
      glPart(),
      canvasPart()
    ];
    return digest(parts.join('#'));
  }

  /* ------------------------------------------------------------ start --- */
  var id = readLocal() || readCookie();
  var fresh = !id;
  if (!id) id = newId();
  var fp = '';
  try { fp = fingerprint(); } catch (e) { fp = ''; }

  // A stored id from IndexedDB or the Cache Storage wins over one just made
  // (both survive some clean-ups that the others do not).
  var late = function (v) { return Promise.race([v, new Promise(function (r) { setTimeout(function () { r(''); }, 2000); })]); };
  var ready = Promise.all([late(readIdb()), late(readCache())]).then(function (got) {
    var old = got[0] || got[1];
    if (fresh && old) id = old;
    keep(id);
  });

  BR.device = {
    ready: ready,
    id: function () { return id; },
    // the X-Device header
    header: function () { return id + (fp ? '~' + fp : ''); }
  };
})(window.BR = window.BR || {});
