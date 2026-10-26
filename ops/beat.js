/* The operator site's beat (ops/ops.js, ops/cdw.js): what the site keeps asking for — the tabs' numbers, the tab in front, the desktop's
   windows — in one request at a time (POST /api/ops/batch, server/core/api.js), at the pace the developer chose (更新頻度: the lists'
   and the live views'); over the site's live connection when it is up (ops/ops.js request(), js/net/wire.js).
     OpsBeat.want(id, { live, every, ask, got, failed, run })
        ask(): { p, rev, h } — what to ask now, or a list of them (null: nothing this time); h: headers the request carries (the vault's
               code ticket); got(answer, ask) / failed(error, ask): its answer (a list for a list)
        run(): instead of ask, something that asks for itself (it is only given the beat's time)
        live: at the live views' pace, else the lists'; every: a pace of its own (ms)
     OpsBeat.drop(id)   OpsBeat.soon(id): asked in a moment (a push said it changed)   OpsBeat.pace([lists, live])
     OpsBeat.start(request)   OpsBeat.stop(): nothing more, and an answer still on its way is dropped
   A beat is when the first of them is due; whatever is due within half the fastest pace comes along on it (a slower one rides on a faster
   one instead of a request of its own). Nothing is asked while the page is not seen; all that is due is asked as soon as it is seen again. */
var OpsBeat = (function () {
  'use strict';
  var askers = {}, pace = [15000, 5000], request = null, timer = 0, busy = false, gen = 0;

  function every(a) { return a.every || (a.live ? pace[1] : pace[0]); }
  // half the fastest pace: what is due within that of a request comes along on it
  function slack() { var m = Infinity; Object.keys(askers).forEach(function (id) { m = Math.min(m, every(askers[id])); }); return m === Infinity ? 0 : m / 2; }
  // the next beat: when the first of them is due
  function schedule() {
    clearTimeout(timer);
    if (!request) return;
    var now = Date.now(), next = Infinity;
    Object.keys(askers).forEach(function (id) { var a = askers[id]; next = Math.min(next, a.soon ? 120 : a.at + every(a) - now); });
    if (next !== Infinity) timer = setTimeout(beat, Math.max(0, next));
  }
  function beat() {
    if (!request || busy || document.hidden) return;
    var now = Date.now(), s = slack(), asks = [], who = [], headers = {};
    Object.keys(askers).forEach(function (id) {
      var a = askers[id];
      if (!a.soon && a.at + every(a) - s > now) return;
      a.soon = false; a.at = now;
      if (a.run) { try { a.run(); } catch (e) { if (window.console) console.error(e); } return; }
      var q = null;
      try { q = a.ask(); } catch (e) { if (window.console) console.error(e); }
      if (!q) return;
      var list = Array.isArray(q) ? q : [q];
      who.push([a, q, asks.length]);
      list.forEach(function (x) {
        asks.push({ p: x.p, rev: x.rev || undefined });
        Object.keys(x.h || {}).forEach(function (k) { headers[k] = x.h[k]; });
      });
    });
    if (!asks.length) { schedule(); return; }
    busy = true;
    var mine = gen;
    request('POST', '/api/ops/batch', { asks: asks }, headers).then(function (r) {
      if (mine !== gen) return;
      who.forEach(function (w) {
        var a = w[0], q = w[1], many = Array.isArray(q), n = many ? q.length : 1, xs = (r.answers || []).slice(w[2], w[2] + n);
        var bad = xs.length < n ? { error: null } : xs.filter(function (x) { return x.error; })[0];
        if (askers[a.id] !== a) return;
        try { if (bad) { if (a.failed) a.failed(bad.error || null, q); } else a.got(many ? xs : xs[0], q); } catch (e) { if (window.console) console.error(e); }
      });
    }, function (err) {
      if (mine !== gen) return;
      who.forEach(function (w) { if (askers[w[0].id] === w[0] && w[0].failed) w[0].failed(err, w[1]); });
    }).then(function () { if (mine !== gen) return; busy = false; schedule(); });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) beat(); });

  return {
    want: function (id, a) { a.id = id; a.at = a.at === undefined ? Date.now() : a.at; askers[id] = a; schedule(); },
    drop: function (id) { delete askers[id]; schedule(); },
    soon: function (id) { var a = askers[id]; if (a) { a.soon = true; schedule(); } },
    pace: function (p) { if (p && (p[0] !== pace[0] || p[1] !== pace[1])) { pace = p.slice(); schedule(); } },
    start: function (req) { request = req; schedule(); },
    stop: function () { request = null; askers = {}; busy = false; gen++; clearTimeout(timer); }
  };
})();
