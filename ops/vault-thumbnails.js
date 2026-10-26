/* Small pictures of everything in the vault: made here, from the file in hand, so that nobody has to
   download a file to see what it is, and every item has one.
     tiny    (the lists):         at most about 120 px, a few KB
     medium  (the enlarged view): at most 512 px, tens of KB, far less than the original (the webp encoding of it was most of what
                                  a picture cost to make: a size of 640 px, 72KB, took two tries)
   An image is shrunk; a video gives a frame; a sound its waveform; a text or a program its first lines;
   a document, an APK or an EPUB its own cover or icon when the file carries one; a 3D model's picture is
   made by the 3D engine (ops/ops.js) and shrunk here. What can show nothing of itself gets a CARD (its kind,
   its extension, its name and size), drawn here, so no item is ever left without a picture, and
   fromFile() never fails: it tries each way up to five times, then draws the card.
   Small static pictures only: this never loads a 3D engine or a model file. */
(function () {
  'use strict';
  var TINY = { sides: [120, 96, 72, 56], max: 8 * 1024 };
  var MID = { sides: [512, 416, 336, 256, 192], max: 56 * 1024 };
  var LABEL = { kimg: '画像', kvid: '動画', kaud: '音声', ktext: 'テキスト', kcode: 'プログラム', kzip: '圧縮', kapk: 'APK', k3d: '3Dモデル', koth: 'ファイル', kdoc: '文書' };

  function pause(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  // `fn` up to `times` times (a pause between), then its last failure
  function attempt(fn, times, gap) {
    var n = 0;
    function go() {
      n++;
      return Promise.resolve().then(fn).catch(function (e) { if (n >= times) throw e; return pause(gap * n).then(go); });
    }
    return go();
  }
  function webp(canvas, q) {
    var url = canvas.toDataURL('image/webp', q);
    return /^data:image\/webp/.test(url) ? url : canvas.toDataURL('image/jpeg', Math.min(.8, q + .1));
  }
  function sizeOf(img) { return [img.naturalWidth || img.videoWidth || img.displayWidth || img.width || 0, img.naturalHeight || img.videoHeight || img.displayHeight || img.height || 0]; }
  // a picture of `img` (an image, a video frame, a canvas) the largest of the sizes that fits `spec.max`; square: on a plain square
  function shrink(img, spec, square) {
    var s = sizeOf(img), iw = s[0], ih = s[1], last = '';
    if (!iw || !ih) throw new Error('絵の大きさがわかりません');
    for (var i = 0; i < spec.sides.length; i++) {
      var side = spec.sides[i], k = Math.min(1, side / Math.max(iw, ih)), w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
      var c = document.createElement('canvas'), ctx;
      if (square) {
        c.width = c.height = side;
        ctx = c.getContext('2d'); ctx.fillStyle = '#edf1f7'; ctx.fillRect(0, 0, side, side);
        var f = Math.min(side / iw, side / ih); w = iw * f; h = ih * f;
        ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      } else {
        c.width = w; c.height = h; ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, w, h);
      }
      for (var q = i < 2 ? .55 : .4, n = 0; n < 2; n++, q -= .15) {
        last = webp(c, q);
        if (last.length <= spec.max) return last;
      }
    }
    return last;
  }
  function pictures(img) { return { thumbnail: shrink(img, TINY, true), preview: shrink(img, MID, false) }; }

  // an image as the page can draw it (a Blob, or a data URL / address), at most about a thousand pixels
  function decode(source) {
    if (typeof source !== 'string' && window.createImageBitmap) {
      return window.createImageBitmap(source).catch(function () { return load(source); });
    }
    return load(source);
  }
  function load(source) {
    return new Promise(function (resolve, reject) {
      var image = new Image(), url = typeof source === 'string' ? '' : URL.createObjectURL(source);
      image.onload = function () { if (url) URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { if (url) URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
      image.src = url || source;
    });
  }
  // (kept for the pages that ask for the small one only)
  function make(source) { return decode(source).then(function (img) { var t = shrink(img, TINY, true); if (img.close) img.close(); return t; }); }
  function medium(source) { return decode(source).then(function (img) { var t = shrink(img, MID, false); if (img.close) img.close(); return t; }); }

  /* ------------------------------------------------------------- the card --- */
  function hashOf(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + 'MB'; }
  function fit(ctx, text, width) {
    var t = String(text || '');
    if (ctx.measureText(t).width <= width) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1);
    return t + '…';
  }
  // what a file looks like when it can show nothing of itself: its kind, extension, name and size (and lines of what is in it)
  function card(meta, big) {
    var w = big ? 480 : 120, h = big ? 320 : 120, c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d'), name = String(meta.name || ''), ext = ((/\.([A-Za-z0-9]{1,6})$/.exec(name) || [])[1] || '').toUpperCase();
    if (meta.kind === 'koth' && /^(DOCX?|XLSX?|PPTX?|ODT|ODS|ODP|EPUB|PDF|RTF)$/.test(ext)) meta.kind = 'kdoc';
    var hue = hashOf(ext || meta.kind || name) % 360, u = w / 120;
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'hsl(' + hue + ',52%,52%)'); g.addColorStop(1, 'hsl(' + ((hue + 28) % 360) + ',58%,34%)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.arc(w * .88, h * .08, h * .42, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
    var font = '-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI",system-ui,sans-serif';
    ctx.font = '600 ' + Math.round(10 * u) + 'px ' + font;
    ctx.globalAlpha = .85; ctx.fillText(meta.label || LABEL[meta.kind] || 'ファイル', 8 * u, 16 * u); ctx.globalAlpha = 1;
    var big1 = ext || (LABEL[meta.kind] || '').slice(0, 4) || '?';
    ctx.font = '800 ' + Math.round((big1.length > 3 ? 30 : 38) * u) + 'px ' + font; ctx.textAlign = 'center';
    ctx.fillText(big1, w / 2, (big ? 0.46 : 0.58) * h); ctx.textAlign = 'left';
    var lines = (meta.lines || []).slice(0, big ? 5 : 0);
    ctx.font = '500 ' + Math.round(10 * u) + 'px ui-monospace,Menlo,Consolas,monospace'; ctx.globalAlpha = .92;
    lines.forEach(function (t, i) { ctx.fillText(fit(ctx, t, w - 24 * u), 12 * u, (big ? .6 : .6) * h + i * 14 * u); });
    ctx.globalAlpha = 1;
    ctx.font = '600 ' + Math.round(9.5 * u) + 'px ' + font;
    ctx.fillText(fit(ctx, name, w - 14 * u), 7 * u, h - 17 * u);
    ctx.globalAlpha = .8; ctx.font = '500 ' + Math.round(9 * u) + 'px ' + font; ctx.fillText(mb(meta.size || 0), 7 * u, h - 6 * u);
    return webp(c, big ? .6 : .5);
  }

  /* ------------------------------------------------- what is inside a file --- */
  function bytesOf(blob) { return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  // the entries of a zip (an APK, an office file, an EPUB …), read from the end of the file only
  function zipEntries(file) {
    var tail = Math.min(file.size, 66000);
    return bytesOf(file.slice(file.size - tail)).then(function (t) {
      var v = new DataView(t.buffer), at = -1;
      for (var i = t.length - 22; i >= 0; i--) if (v.getUint32(i, true) === 0x06054b50) { at = i; break; }
      if (at < 0) throw new Error('zipではありません');
      var count = v.getUint16(at + 10, true), size = v.getUint32(at + 12, true), off = v.getUint32(at + 16, true);
      if (off === 0xffffffff || size === 0xffffffff || count === 0xffff) throw new Error('大きすぎるzipです');
      if (size > 4 * 1048576 || off + size > file.size) throw new Error('zipの目次が大きすぎます');
      return bytesOf(file.slice(off, off + size));
    }).then(function (cd) {
      var v = new DataView(cd.buffer), out = [], p = 0, dec = new TextDecoder();
      while (p + 46 <= cd.length && v.getUint32(p, true) === 0x02014b50 && out.length < 20000) {
        var n = v.getUint16(p + 28, true), m = v.getUint16(p + 30, true), k = v.getUint16(p + 32, true);
        out.push({ name: dec.decode(cd.subarray(p + 46, p + 46 + n)), method: v.getUint16(p + 10, true), packed: v.getUint32(p + 20, true), size: v.getUint32(p + 24, true), at: v.getUint32(p + 42, true) });
        p += 46 + n + m + k;
      }
      return out;
    });
  }
  // one entry's bytes as a Blob (stored, or deflated: the browser undoes that)
  function zipEntryBlob(file, e, type) {
    if (e.size > 3 * 1048576 || e.packed > 3 * 1048576) return Promise.reject(new Error('大きすぎます'));
    return bytesOf(file.slice(e.at, e.at + 30)).then(function (h) {
      var v = new DataView(h.buffer), start = e.at + 30 + v.getUint16(26, true) + v.getUint16(28, true), raw = file.slice(start, start + e.packed);
      if (e.method === 0) return new Blob([raw], { type: type });
      if (e.method !== 8 || typeof DecompressionStream !== 'function') throw new Error('開けない圧縮です');
      return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob().then(function (b) { return new Blob([b], { type: type }); });
    });
  }
  var DENSITY = ['xxxhdpi', 'xxhdpi', 'xhdpi', 'hdpi', 'mdpi'];
  // the picture a package carries of itself: an APK's launcher icon, an office file's thumbnail, an EPUB's cover
  function ownPicture(entries) {
    var pics = entries.filter(function (e) { return /\.(png|jpe?g|webp)$/i.test(e.name) && e.size > 0; });
    var apk = pics.filter(function (e) { return /^res\/(mipmap|drawable)[^/]*\/(ic_launcher|icon|app_icon)[^/]*\.(png|webp)$/i.test(e.name); });
    if (apk.length) {
      apk.sort(function (a, b) {
        var da = DENSITY.findIndex(function (d) { return a.name.indexOf(d) >= 0; }), db = DENSITY.findIndex(function (d) { return b.name.indexOf(d) >= 0; });
        return ((da < 0 ? 9 : da) - (db < 0 ? 9 : db)) || (b.size - a.size);
      });
      return apk[0];
    }
    return pics.filter(function (e) { return /^(docProps\/thumbnail\.(jpe?g|png)|Thumbnails\/thumbnail\.png)$/i.test(e.name) || /(^|\/)cover[^/]*\.(jpe?g|png)$/i.test(e.name); })[0] || null;
  }
  function listLines(entries) {
    var names = entries.filter(function (e) { return e.name && e.name.slice(-1) !== '/'; });
    var out = [entries.length + ' 個のファイル'];
    var tops = [], seen = {};
    entries.forEach(function (e) { var t = e.name.split('/')[0]; if (t && !seen[t]) { seen[t] = 1; tops.push(t); } });
    tops.slice(0, 4).forEach(function (t) { out.push(t.slice(0, 40)); });
    return names.length ? out : ['（空）'];
  }
  function textLines(file) {
    return file.slice(0, 4096).text().then(function (s) {
      return s.replace(/\r/g, '').split('\n').slice(0, 5).map(function (l) { return l.replace(/\t/g, '  ').slice(0, 60); });
    });
  }
  function frameOf(file) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement('video'), url = URL.createObjectURL(file), done = false;
      function end(err, frame) {
        if (done) return;
        done = true; clearTimeout(timer);
        v.removeAttribute('src'); try { v.load(); } catch (e) { /* gone */ }
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(frame);
      }
      var timer = setTimeout(function () { end(new Error('動画の絵を取り出せませんでした')); }, 10000);
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.onerror = function () { end(new Error('動画を読み込めませんでした')); };
      v.onloadedmetadata = function () { try { v.currentTime = Math.min(1, (isFinite(v.duration) ? v.duration : 2) * .1); } catch (e) { end(e); } };
      v.onseeked = function () {
        try {
          var c = document.createElement('canvas'), k = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight, 1));
          c.width = Math.max(1, Math.round(v.videoWidth * k)); c.height = Math.max(1, Math.round(v.videoHeight * k));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          // a small play mark in the corner: this is a video
          var x = c.getContext('2d'), r = Math.max(10, c.width * .07);
          x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); x.arc(c.width - r * 1.6, c.height - r * 1.6, r, 0, 7); x.fill();
          x.fillStyle = '#fff'; x.beginPath(); x.moveTo(c.width - r * 1.9, c.height - r * 2.1); x.lineTo(c.width - r * 1.9, c.height - r * 1.1); x.lineTo(c.width - r * .95, c.height - r * 1.6); x.fill();
          end(null, { frame: c, seconds: v.duration });
        } catch (e) { end(e); }
      };
      v.src = url;
    });
  }
  // a sound's waveform from the first part of the file (what the browser can decode of it)
  function waveOf(file) {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.reject(new Error('音を読み取れません'));
    return file.slice(0, 3 * 1048576).arrayBuffer().then(function (buf) {
      var ctx = new AC();
      return new Promise(function (ok, no) { ctx.decodeAudioData(buf, ok, no); }).then(function (a) {
        var d = a.getChannelData(0), bars = 48, out = [], step = Math.max(1, Math.floor(d.length / bars));
        for (var i = 0; i < bars; i++) { var peak = 0; for (var j = i * step; j < Math.min(d.length, (i + 1) * step); j += 8) peak = Math.max(peak, Math.abs(d[j])); out.push(peak); }
        ctx.close && ctx.close();
        return out;
      }, function (e) { ctx.close && ctx.close(); throw e; });
    });
  }
  function waveCanvas(bars, name, w, h) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'), hue = hashOf(name) % 360, g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'hsl(' + hue + ',45%,24%)'); g.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ',50%,38%)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    var max = Math.max.apply(null, bars.concat([.05])), bw = w / bars.length;
    x.fillStyle = 'rgba(255,255,255,.86)';
    bars.forEach(function (p, i) { var bh = Math.max(2, p / max * h * .6); x.fillRect(i * bw + bw * .18, (h - bh) / 2, bw * .64, bh); });
    return c;
  }

  /* ------------------------------------------------------- a whole file --- */
  // {thumbnail, preview, lines}: from the file in hand, whatever it is. `kind`: the vault's kind (kimg, kvid …).
  function fromFile(file, kind) {
    var name = file.name || '', ext = ((/\.([A-Za-z0-9]{1,6})$/.exec(name) || [])[1] || '').toLowerCase();
    var meta = { name: name, size: file.size, kind: kind || 'koth', lines: [] };
    if (kind === 'koth' && /^(docx?|xlsx?|pptx?|odt|ods|odp|epub|pdf|rtf)$/.test(ext)) meta.kind = 'kdoc';
    function drawn(img) { var p = pictures(img); if (img.close) img.close(); return p; }
    function cards() { return { thumbnail: card(meta, false), preview: card(meta, true), card: true }; }
    function fromImage() { return decode(file).then(drawn); }
    function fromVideo() {
      return frameOf(file).then(function (r) { meta.lines = [(isFinite(r.seconds) ? Math.round(r.seconds) + '秒' : '')]; return pictures(r.frame); });
    }
    function fromSound() {
      return waveOf(file).then(function (bars) {
        return { thumbnail: shrink(waveCanvas(bars, name, 240, 240), TINY, true), preview: shrink(waveCanvas(bars, name, 512, 288), MID, false) };
      });
    }
    function fromText() { return textLines(file).then(function (lines) { meta.lines = lines; return cards(); }); }
    function fromPackage() {
      return zipEntries(file).then(function (entries) {
        meta.lines = listLines(entries);
        var own = ownPicture(entries);
        if (!own) return cards();
        return zipEntryBlob(file, own, /\.png$/i.test(own.name) ? 'image/png' : /\.webp$/i.test(own.name) ? 'image/webp' : 'image/jpeg').then(decode).then(drawn).catch(cards);
      });
    }
    var way = kind === 'kimg' ? fromImage : kind === 'kvid' ? fromVideo : kind === 'kaud' ? fromSound
      : kind === 'ktext' || kind === 'kcode' ? fromText : (kind === 'kzip' || kind === 'kapk' || meta.kind === 'kdoc') ? fromPackage : cards;
    // up to five tries (the file may be slow to read, a codec slow to start); then the card, which cannot fail
    return attempt(way, 5, 600).catch(function () { return cards(); }).catch(function () { return { thumbnail: '', preview: '', card: true }; });
  }

  /* --------------------------------------------- what was fetched already --- */
  // The small pictures fetched from the server are kept in this browser (IndexedDB), so the next time the
  // list is shown nothing is fetched again. They belong to the account that fetched them: another account
  // (or a logout) clears them.
  var cache = (function () {
    var db = null, ready = null, who = '';
    function open() {
      if (ready) return ready;
      ready = new Promise(function (ok) {
        try {
          var r = indexedDB.open('two-state-vault-pictures', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('p', { keyPath: 'id' }); };
          r.onsuccess = function () { db = r.result; ok(db); };
          r.onerror = r.onblocked = function () { ok(null); };
        } catch (e) { ok(null); }
      });
      return ready;
    }
    function run(mode, fn) {
      return open().then(function (d) {
        if (!d) return null;
        return new Promise(function (ok) {
          try { var t = d.transaction('p', mode), s = t.objectStore('p'), res = fn(s); t.oncomplete = function () { ok(res && res.result !== undefined ? res.result : null); }; t.onerror = t.onabort = function () { ok(null); }; } catch (e) { ok(null); }
        });
      });
    }
    return {
      // for this account: what another's left is cleared
      use: function (name) {
        if (who === name) return Promise.resolve();
        who = name;
        return run('readwrite', function (s) { var r = s.get('#who'); r.onsuccess = function () { if (!r.result || r.result.who !== name) { s.clear(); s.put({ id: '#who', who: name, at: Date.now() }); } }; return r; });
      },
      get: function (id, sig) { return run('readonly', function (s) { return s.get(id); }).then(function (r) { return r && r.sig === sig && Date.now() - r.at < 14 * 86400000 ? r.src : null; }); },
      put: function (id, sig, src) { return run('readwrite', function (s) { return s.put({ id: id, sig: sig, src: src, at: Date.now() }); }); },
      clear: function () { who = ''; return run('readwrite', function (s) { return s.clear(); }); }
    };
  })();

  window.VaultThumbnails = { make: make, medium: medium, fromFile: fromFile, card: card, attempt: attempt, cache: cache };
})();
