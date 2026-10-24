/* The player's side of the operators' screen view (server/core/opswatch.js).

   It does nothing until the server says an operator pressed 見る, and stops
   when the server says so (or after 31 minutes, whatever happens). It never
   shows anything. While it runs it sends, sealed for that one operator's page
   (js/net/watchcrypto.js), a few numbers describing the game as it is played:
   which screen is open, the wallet, the bet, which reels turn and what the
   others show, the win being shown. It does not send pictures, sound, what the
   player types, what is said in a chat, passwords, the camera or microphone,
   or anything about the device. The server's ceiling is 300 kbps; this uses a
   few kbps at most (a frame only when something changed, and one every two
   seconds when nothing did).
   Nothing comes back that could be a tap or a key: the only things this
   module receives are start, stop and the frame rate / resolution to use. */
(function (BR) {
  'use strict';

  var WC = BR.watchCrypto, C = BR.CONFIG;
  var HEARTBEAT = 2000;
  var LOCAL_MAX = 31 * 60000;
  var HTTP_GAP = 250;      // without a WebSocket: at most 4 requests a second
  var sess = null;

  function num(v) {
    v = Math.round(Number(v));
    return isFinite(v) ? Math.max(0, Math.min(v, 9e15)) : 0;
  }

  // The game's state in the fewest numbers that draw it again.
  function snapshot() {
    var S = BR.store.state, G = BR.game || {}, R = BR.app && BR.app.reels;
    var modes = [0, 0, 0, 0, 0], grid = [[-1, -1, -1], [-1, -1, -1], [-1, -1, -1], [-1, -1, -1], [-1, -1, -1]];
    if (R && R.reels && R.getGrid) {
      var shown = R.getGrid();
      for (var i = 0; i < 5; i++) {
        var turning = R.reels[i].phase !== 'idle';
        modes[i] = turning ? 1 : 0;
        if (!turning) grid[i] = shown[i].map(function (s) { return C.symbols.indexOf(s); });
      }
    }
    var res = G.result;
    return {
      v: 1,
      s: String(BR.screens.current()).slice(0, 16),
      t: [num(S.tokens), num(S.dollars), num(S.coins)],
      b: num(BR.app && BR.app.bet ? BR.app.bet() : 0),
      r: modes,
      g: grid,
      w: G.presenting && res ? num(res.total) : 0,
      x: res ? num(res.tier) : 0,
      c: res ? num(res.combo) : 0,
      sp: G.spinning ? 1 : 0,
      k: G.watch ? 1 : 0
    };
  }

  function stop(sid) {
    if (!sess || (sid && sid !== sess.sid)) return;
    clearInterval(sess.timer);
    sess = null;
  }

  function tune(s) {
    clearInterval(s.timer);
    s.timer = setInterval(tick, Math.round(1000 / s.fps));
  }

  function tick() {
    var s = sess;
    if (!s || !s.key) return;
    var now = Date.now();
    if (now - s.startedAt > LOCAL_MAX) { stop(); return; }
    var snap = snapshot(), text = JSON.stringify(snap);
    if (text === s.last && now - s.sentAt < HEARTBEAT) return;
    s.last = text;
    s.sentAt = now;
    var n = s.n++, e = s.e;
    WC.seal(s.key, s.sid, e, n, snap).then(function (d) {
      if (sess !== s) return;
      var msg = { op: 'view', sid: s.sid, e: e, n: n, d: d };
      if (BR.live.send(msg)) return;
      // no WebSocket (the Node server): an ordinary request, few and one at a time
      if (s.busy || Date.now() - s.httpAt < HTTP_GAP) return;
      s.busy = true;
      s.httpAt = Date.now();
      BR.api.watchFrame(msg).then(function (r) {
        s.busy = false;
        // the server no longer takes them (the watch ended and the stop never arrived)
        s.bad = r && r.ok === false ? (s.bad || 0) + 1 : 0;
        if (s.bad >= 5) stop(s.sid);
      }, function (err) {
        s.busy = false;
        if (err && (err.status === 404 || err.status === 401 || err.status === 403)) stop(s.sid);
      });
    }, function () { stop(s.sid); });
  }

  // The server asks the game to send (a new watch, a new frame rate, or the game reconnecting).
  function begin(m) {
    if (!m || typeof m.sid !== 'string' || !WC || !WC.available || !BR.api.hasToken()) return;
    var fps = [20, 15, 10].indexOf(m.fps) >= 0 ? m.fps : 10;
    if (sess && sess.sid === m.sid) {
      // the same watch: only the rate may change
      if (sess.fps !== fps) { sess.fps = fps; if (sess.key) tune(sess); }
      return;
    }
    if (typeof m.pub !== 'string') return;
    stop();
    var s = sess = { sid: m.sid, fps: fps, n: 0, e: 0, key: null, last: '', sentAt: 0, startedAt: Date.now(), busy: false, httpAt: 0, timer: 0 };
    WC.newPair().then(function (mine) {
      if (sess !== s) return null;
      return BR.api.watchHello(s.sid, mine.pub).then(function (h) {
        if (sess !== s) return null;
        s.e = Number(h.e) || 1;
        // (the key is bound to both public halves: the operator's, then ours)
        return WC.deriveKey(mine, m.pub, m.pub, mine.pub, s.sid);
      });
    }).then(function (key) {
      if (!key || sess !== s) return;
      s.key = key;
      tune(s);
      tick();
    }).catch(function () { if (sess === s) stop(s.sid); });
  }

  BR.live.on('view', function (m) {
    if (m && m.on === false) stop(m.sid); else begin(m);
  });
  // the game (re)connected while a watch is on: it asks again
  BR.live.on('hello', function (h) {
    if (h && h.view) begin(h.view);
  });
  // the page closing ends it on this side
  window.addEventListener('pagehide', function () { stop(); });
  BR.watchfeed = { active: function () { return !!sess; } };
})(window.BR = window.BR || {});
