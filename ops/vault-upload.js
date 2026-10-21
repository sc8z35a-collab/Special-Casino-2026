/* The vault's uploads, on their own. The operator site's background worker
   (ops/ops-sw.js) runs them, so they go on with the vault closed and with the
   site's page closed, as long as the browser lets the worker run (and from
   where they were the next time the site is opened); a browser without one
   runs them in the page (the same code).
   Each file waits in this browser's IndexedDB with what it needs: the file
   itself, its id on the server, the upload's own pass for it (a week: no
   developer code needed meanwhile) and the site's login. Nothing is lost when
   the page or the worker stops: the next start asks the server which pieces
   it has and sends the rest, four at a time, each as it is (no base64) with
   its SHA-256 (POST /api/vault/piece; on Cloudflare straight into R2).
   A job: { key, who, id, name, size, type, space, folder, parent, model,
   token, pass, piece, chunks, sent, state: 'wait' | 'run' | 'stop' | 'done' |
   'fail', why: 'net' | 'locked' | 'login' | 'full' | 'room' | 'error' |
   'gone' | '', message, tries, next, at, sha256, mem } */
var VaultUploads = (function () {
  'use strict';

  var NAME = 'two-state-ops-uploads', JOBS = 'jobs', FILES = 'files';
  var LANES = 4;
  // a piece that fails for the connection is tried again this often before the whole file stops (and waits)
  var PIECE_TRIES = 4;
  // what stops for the connection or the server being busy: tried again on its own
  var AGAIN = { offline: 1, missing: 1, piece_size: 1, bad_hash: 1, rate_limited: 1, unavailable: 1, length_required: 1 };

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
    var running = null, again = false, cancelled = {};
    // (a copy: the site's own pages only)
    function tell(j) { try { host.tell(Object.assign({}, j)); } catch (e) { /* a page gone */ } }

    function call(j, method, path, body) {
      var h = { Authorization: 'Bearer ' + j.token };
      if (j.pass) h['X-Vault-Upload'] = j.pass;
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
            headers: { Authorization: 'Bearer ' + j.token, 'X-Vault-Upload': j.pass, 'Content-Type': 'application/octet-stream', 'X-Piece-SHA256': hex(h) }
          }).then(answer, offline);
        });
      });
    }
    // the pieces still missing, LANES at a time (one that fails for the connection: again, a few times)
    function pieces(j, blob, todo) {
      var queue = todo.slice(), failed = null, told = 0;
      function one(n, tries) {
        if (cancelled[j.key]) return Promise.reject({ code: 'cancelled' });
        return sendPiece(j, blob, n).catch(function (err) {
          if (tries + 1 < PIECE_TRIES && retry(err)) return later(1500 * (tries + 1)).then(function () { return one(n, tries + 1); });
          throw err;
        });
      }
      function lane() {
        if (failed || !queue.length) return Promise.resolve();
        return one(queue.shift(), 0).then(function () {
          j.sent++;
          var now = Date.now();
          if (now - told > 400 || j.sent === j.chunks) { told = now; tell(j); save(j).catch(function () {}); }
          return lane();
        }, function (err) { failed = failed || err; });
      }
      var lanes = [];
      for (var i = 0; i < Math.min(LANES, queue.length); i++) lanes.push(lane());
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
      j.tries = (j.tries || 0) + 1;
      // (again after 5 s, then 10, 20, 40, and every minute)
      j.next = Date.now() + Math.min(60000, 5000 * Math.pow(2, Math.min(4, j.tries - 1)));
      return save(j).then(function () { tell(j); }, function () { tell(j); });
    }

    // every file that is due, one after another (the stopped ones when their time comes)
    function loop() {
      return all().then(function (list) {
        var now = Date.now();
        var mine = list.filter(function (j) { return j.id && j.token && host.mine(j); });
        var due = mine.filter(function (j) {
          return j.state === 'wait' || j.state === 'run' || (j.state === 'stop' && j.why === 'net' && j.next <= now);
        }).sort(function (a, b) { return a.at - b.at; })[0];
        if (due) return send(due).then(loop);
        // one waiting for the connection soon: waited for here
        var soon = mine.filter(function (j) { return j.state === 'stop' && j.why === 'net'; }).reduce(function (m, j) { return Math.min(m, j.next); }, Infinity);
        if (soon - now < 120000) return later(Math.max(1000, soon - now)).then(loop);
        return null;
      });
    }
    function run() {
      if (running) { again = true; return running; }
      running = loop().then(done, done);
      function done() {
        running = null;
        if (again) { again = false; return run(); }
        return null;
      }
      return running;
    }
    // whether files still wait to go (for the browser to come back to them)
    function pending() {
      return all().then(function (list) {
        return list.some(function (j) { return j.id && host.mine(j) && (j.state === 'wait' || j.state === 'run' || (j.state === 'stop' && j.why === 'net')); });
      });
    }
    return {
      run: run,
      pending: pending,
      cancel: function (key) { cancelled[key] = true; },
      busy: function () { return !!running; }
    };
  }

  return { all: all, get: get, save: save, add: add, fileOf: fileOf, forget: forget, forgetFile: forgetFile, engine: engine };
})();
if (typeof self !== 'undefined') self.VaultUploads = VaultUploads;
