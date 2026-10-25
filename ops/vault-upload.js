/* The vault's uploads, on their own. The operator site's background worker
   (ops/ops-sw.js) runs them, so they go on with the vault closed and with the
   site's page closed, as long as the browser lets the worker run (and from
   where they were the next time the site is opened); a browser without one
   runs them in the page (the same code).
   Each file waits in this browser's IndexedDB with what it needs: the file
   itself, its id on the server and the upload's own pass for it (a week: no
   developer code needed meanwhile). The pass is all it sends: no login is kept
   here (a stolen one would be worth nothing without the page's key, but there
   is none to steal), and the server takes the pass alone for the pieces and
   the end of that one file (server/core/vault.js: passFor). Nothing is lost when
   the page or the worker stops: the next start asks the server which pieces
   it has and sends the rest, each as it is (no base64) with its SHA-256 (POST
   /api/vault/piece; on Cloudflare straight into R2).
   How fast: as the server says (the developer's 標準 / 高速 / 最速, with
   each file's /missing): so many MiB of pieces in the air at once (half on a
   device with little memory) and so many files at once.
   When something stops it, it starts again by itself: a piece at once, then
   after a moment, a few times; then the whole file after 1 s, 3, 10, 30 and
   every minute for as long as it takes (the connection, the server busy). Any
   other trouble: again after 15 s, 1 minute, 3, 10 and every 10 minutes; a
   lost login or pass, every 10 minutes (and at once when the site has a new
   one). Only a file deleted from the vault stops for good.
   A job: { key, who, id, name, size, type, space, folder, parent, model,
   pass, piece, chunks, sent, rate (bytes a second, while it goes),
   state: 'wait' | 'run' | 'stop' | 'done' | 'fail', why: 'net' | 'locked' |
   'login' | 'full' | 'room' | 'error' | 'gone' | '', message, tries, next, at,
   sha256, mem } */
var VaultUploads = (function () {
  'use strict';

  var NAME = 'two-state-ops-uploads', JOBS = 'jobs', FILES = 'files';
  // what the server says about how fast (each /missing): MiB of pieces in the air at once, files at once
  var pace = { budgetMb: 128, files: 3 };
  // a device with little memory: half as much in the air
  var small = typeof navigator !== 'undefined' && navigator.deviceMemory && navigator.deviceMemory <= 4;
  function lanesFor(piece) { return Math.max(2, Math.min(16, Math.floor(pace.budgetMb * (small ? 0.5 : 1) * 1048576 / Math.max(1, piece || 1048576)))); }
  // a piece that fails for the connection: again at once, then after these waits (ms), before the whole file waits
  var PIECE_WAITS = [0, 400, 1200, 3000, 6000, 10000];
  // a whole file stopped: again after these waits, the last one over and over
  var WAITS = { net: [1000, 3000, 10000, 30000, 60000], error: [15000, 60000, 180000, 600000], login: [600000], locked: [600000] };
  // what stops for the connection or the server being busy: tried again on its own
  var AGAIN = { offline: 1, missing: 1, piece_size: 1, bad_hash: 1, rate_limited: 1, unavailable: 1, length_required: 1, internal: 1 };

  /* ------------------------------------------------------------ the store --- */
  var opened = null;
  function db() {
    if (!opened) {
      opened = new Promise(function (ok, no) {
        var r = indexedDB.open(NAME, 1);
        r.onupgradeneeded = function () {
          r.result.createObjectStore(JOBS, { keyPath: 'key' });
          r.result.createObjectStore(FILES);
        };
        r.onsuccess = function () { ok(r.result); };
        r.onerror = function () { opened = null; no(r.error); };
      });
    }
    return opened;
  }
  // one transaction: `fn(stores)` returns the request whose result is wanted (or nothing)
  function tx(names, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction(names, mode), stores = {};
        names.forEach(function (n) { stores[n] = t.objectStore(n); });
        var req = fn(stores);
        t.oncomplete = function () { ok(req ? req.result : undefined); };
        t.onerror = function () { no(t.error); };
        t.onabort = function () { no(t.error); };
      });
    });
  }
  function all() { return tx([JOBS], 'readonly', function (s) { return s[JOBS].getAll(); }).then(function (l) { return l || []; }); }
  function get(key) { return tx([JOBS], 'readonly', function (s) { return s[JOBS].get(key); }); }
  function save(j) { return tx([JOBS], 'readwrite', function (s) { s[JOBS].put(j); }); }
  // a new job with its file (`file` null: the page keeps it, `mem`)
  function add(j, file) {
    return tx([JOBS, FILES], 'readwrite', function (s) {
      s[JOBS].put(j);
      if (file) s[FILES].put(file, j.key);
    });
  }
  function fileOf(key) { return tx([FILES], 'readonly', function (s) { return s[FILES].get(key); }); }
  function forget(key) { return tx([JOBS, FILES], 'readwrite', function (s) { s[JOBS].delete(key); s[FILES].delete(key); }); }
  function forgetFile(key) { return tx([FILES], 'readwrite', function (s) { s[FILES].delete(key); }); }

  /* ------------------------------------------------------------ the engine --- */
  // host: { tell(job), file(key) -> a File the page holds (mem jobs), mine(job) -> whether this engine sends it }
  function engine(host) {
    var cancelled = {};
    // (a copy: the site's own pages only)
    function tell(j) { try { host.tell(Object.assign({}, j)); } catch (e) { /* a page gone */ } }

    function call(j, method, path, body) {
      if (!j.pass) return Promise.reject({ status: 401, code: 'auth', message: 'ログインが必要です' });
      var h = { 'X-Vault-Upload': j.pass };
      if (body !== undefined) h['Content-Type'] = 'application/json';
      return fetch(path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'same-origin' })
        .then(answer, offline);
    }
    function answer(res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        if (res.ok) return b;
        var e = b.error || {};
        throw { status: res.status, code: e.code || '', message: e.message || '' };
      });
    }
    function offline() { throw { status: 0, code: 'offline', message: '' }; }
    function later(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
    function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }

    // one piece, as it is
    function sendPiece(j, blob, n) {
      var from = n * j.piece;
      return blob.slice(from, Math.min(j.size, from + j.piece)).arrayBuffer().then(function (buf) {
        return crypto.subtle.digest('SHA-256', buf).then(function (h) {
          return fetch('/api/vault/piece?id=' + j.id + '&n=' + n, {
            method: 'POST', body: buf, cache: 'no-store', credentials: 'same-origin',
            headers: { 'X-Vault-Upload': j.pass, 'Content-Type': 'application/octet-stream', 'X-Piece-SHA256': hex(h) }
          }).then(answer, offline);
        });
      });
    }
    // the pieces still missing, as many at a time as the speed allows (one
    // that fails for the connection: again at once, then after a moment)
    function pieces(j, blob, todo) {
      var queue = todo.slice(), failed = null, told = 0, recent = [];
      j.retry = 0;
      function one(n, tries) {
        if (cancelled[j.key]) return Promise.reject({ code: 'cancelled' });
        return sendPiece(j, blob, n).catch(function (err) {
          if (tries < PIECE_WAITS.length && retry(err)) {
            // (sent again at once: shown as such meanwhile)
            if (j.retry < tries + 1) { j.retry = tries + 1; j.rate = 0; tell(j); }
            return later(PIECE_WAITS[tries]).then(function () { return one(n, tries + 1); });
          }
          throw err;
        });
      }
      function lane() {
        if (failed || !queue.length) return Promise.resolve();
        var n = queue.shift();
        return one(n, 0).then(function () {
          j.sent++;
          j.retry = 0;
          var now = Date.now();
          // (how fast: over the last 5 seconds)
          recent.push([now, n === j.chunks - 1 ? j.size - n * j.piece : j.piece]);
          while (recent.length > 1 && recent[0][0] < now - 5000) recent.shift();
          var span = (now - recent[0][0]) / 1000;
          if (recent.length > 1 && span > 0.3) j.rate = Math.round(recent.slice(1).reduce(function (sum, x) { return sum + x[1]; }, 0) / span);
          if (now - told > 400 || j.sent === j.chunks) { told = now; tell(j); save(j).catch(function () {}); }
          return lane();
        }, function (err) { failed = failed || err; });
      }
      var lanes = [];
      for (var i = 0; i < Math.min(lanesFor(j.piece), queue.length); i++) lanes.push(lane());
      return Promise.all(lanes).then(function () { if (failed) throw failed; });
    }
    function retry(err) { return !!err && (AGAIN[err.code] || err.status === 0 || err.status === 429 || err.status >= 500); }

    // a whole file: what the server still needs, those pieces, then the end
    function send(j) {
      j.state = 'run';
      j.why = '';
      j.message = '';
      return save(j).then(function () {
        tell(j);
        return call(j, 'GET', '/api/vault/missing?id=' + j.id);
      }).then(function (r) {
        if (r.upload) j.pass = r.upload;
        if (r.speed) pace = { budgetMb: r.speed.budgetMb, files: r.speed.files };
        j.piece = r.file.piece;
        j.chunks = r.file.chunks;
        if (r.file.done) return { done: true, sha256: r.file.sha256 };
        var todo = [];
        r.missing.forEach(function (m) { for (var n = m[0]; n <= m[1]; n++) todo.push(n); });
        j.sent = j.chunks - todo.length;
        tell(j);
        return Promise.resolve(j.mem ? host.file && host.file(j.key) : fileOf(j.key)).then(function (blob) {
          if (!blob) throw { code: 'no_blob', message: 'このブラウザに元のファイルが残っていません。もう一度ファイルを選んでください（届いた部分の続きから送ります）' };
          if (blob.size !== j.size) throw { code: 'no_blob', message: '元のファイルの大きさが変わっています。同じファイルを選び直してください' };
          return pieces(j, blob, todo);
        }).then(function () { return call(j, 'POST', '/api/vault/finish', { id: j.id }); });
      }).then(function (r) {
        if (!r.done) throw { code: 'missing', message: '届いていない部分がありました' };
        j.state = 'done';
        j.why = '';
        j.sha256 = r.sha256 || '';
        j.sent = j.chunks;
        j.tries = 0;
        j.rate = 0;
        j.doneAt = Date.now();
        // (a model's file stays until the page has made its picture)
        return (j.model ? save(j) : save(j).then(function () { return forgetFile(j.key); })).then(function () { tell(j); });
      }).catch(function (err) { return stopped(j, err); });
    }
    function stopped(j, err) {
      err = err || {};
      if (err.code === 'cancelled' || cancelled[j.key]) return null;
      var code = err.code || '', st = err.status;
      var why = retry(err) ? 'net'
        : code === 'vault_locked' ? 'locked'
        : st === 401 || code === 'not_operator' || code === 'banned' || code === 'ended' ? 'login'
        : code === 'no_file' ? 'gone'
        : 'error';
      if (code === 'done') { j.state = 'done'; j.doneAt = Date.now(); return save(j).then(function () { tell(j); }); }
      j.state = why === 'gone' ? 'fail' : 'stop';
      j.why = why;
      j.message = err.message || '';
      j.rate = 0;
      j.tries = (j.tries || 0) + 1;
      // (again after a while: longer each time, then the longest over and over)
      var w = WAITS[why] || WAITS.error;
      j.next = Date.now() + w[Math.min(w.length - 1, j.tries - 1)];
      return save(j).then(function () { tell(j); }, function () { tell(j); });
    }
    // a stopped file that goes again by itself when its time comes
    function again(j) { return j.state === 'stop' && !!WAITS[j.why]; }

    // Each slot sends one file after another: the ones waiting, then the
    // stopped ones when their time comes (as many slots as the speed allows
    // files at once). A slot with nothing to do waits for the next one due
    // within two minutes (a new file wakes it), else it ends (the browser or
    // the page brings it back).
    var active = {}, slots = 0, naps = [];
    function nap(ms) {
      return new Promise(function (ok) {
        var t = setTimeout(done, ms);
        function done() { clearTimeout(t); naps = naps.filter(function (x) { return x !== done; }); ok(); }
        naps.push(done);
      });
    }
    function slot() {
      return all().then(function (list) {
        var now = Date.now();
        var mine = list.filter(function (j) { return j.id && j.pass && host.mine(j) && !active[j.key]; });
        var due = mine.filter(function (j) {
          return j.state === 'wait' || j.state === 'run' || (again(j) && j.next <= now);
        }).sort(function (a, b) { return a.at - b.at; })[0];
        if (due) {
          active[due.key] = true;
          var free = function () { delete active[due.key]; };
          return send(due).then(free, free).then(slot);
        }
        var soon = mine.filter(again).reduce(function (m, j) { return Math.min(m, j.next); }, Infinity);
        if (soon - now < 120000) return nap(Math.max(500, soon - now)).then(slot);
        return null;
      });
    }
    // up to as many slots as files may go at once; the promise: when every slot has ended
    var waiting = [];
    function run() {
      naps.slice().forEach(function (wake) { wake(); });
      while (slots < Math.max(1, pace.files)) { slots++; slot().then(end, end); }
      return new Promise(function (ok) { waiting.push(ok); });
    }
    function end() {
      if (--slots) return;
      var l = waiting;
      waiting = [];
      l.forEach(function (ok) { ok(); });
    }
    // whether files still wait to go (for the browser to come back to them)
    function pending() {
      return all().then(function (list) {
        return list.some(function (j) { return j.id && host.mine(j) && (j.state === 'wait' || j.state === 'run' || again(j)); });
      });
    }
    // now, not later: every stopped file that goes again by itself (the connection back, a new login)
    function wake() {
      return all().then(function (list) {
        return Promise.all(list.filter(function (j) { return host.mine(j) && again(j); }).map(function (j) { j.next = 0; return save(j); }));
      }).then(run, run);
    }
    return {
      run: run,
      wake: wake,
      pending: pending,
      cancel: function (key) { cancelled[key] = true; },
      busy: function () { return slots > 0; }
    };
  }

  return { all: all, get: get, save: save, add: add, fileOf: fileOf, forget: forget, forgetFile: forgetFile, engine: engine };
})();
if (typeof self !== 'undefined') self.VaultUploads = VaultUploads;
