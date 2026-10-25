/* The operator site's extensions (server/core/ext.js). The files the server gives
   this person (none unless the deployment has some) are added to the page once they
   are in, and what those register here is asked by the page where it would otherwise
   go straight on: before a file is sent, before a picture is posted, and an item in the
   account menu. With none, every call here does nothing and the page goes on as it
   always did.
   OpsExt.hook('beforeSend', function (job, file, io) {…})   a promise; its rejection (an Error with a
                                                              message) stops that file for good
   OpsExt.hook('beforeInline', function (item, io) {…})      the same, for a picture posted whole:
                                                              item { kind, name, bytes }
   OpsExt.menu(label, function () {…})                       an item in the account menu
   OpsExt.url(name)                                          a promise: a fresh address for a file of
                                                              the server's that is not a script (a worker)
   io: { request, vault, toast, progress } as the page has them (vault: a request that carries the developer's code ticket,
   when there is one; progress(job, 0..1): how far a held file's check has come). OpsExt.io() gives the same to a part that was not handed them. */
var OpsExt = (function () {
  'use strict';
  var hooks = {}, urls = {}, request = null, started = null, loaded = {};
  var tools = { request: null, vault: null, toast: function () {}, progress: function () {} };
  var info = { expected: false, missing: false, failed: false, active: false };

  function add(a) {
    return new Promise(function (ok) {
      if (loaded[a.name]) { ok(); return; }
      loaded[a.name] = true;
      if (a.kind === 'script' || a.kind === 'style') {
        var n = document.createElement(a.kind === 'script' ? 'script' : 'link');
        if (a.kind === 'script') n.src = a.url; else { n.rel = 'stylesheet'; n.href = a.url; }
        n.onload = function () { ok(); };
        n.onerror = function () { info.failed = true; ok(); };
        document.head.appendChild(n);
      } else ok();
    });
  }
  // the files for this person: scripts and styles go into the page (once); asked again after each login
  function load(req, extra) {
    request = req;
    tools = { request: req, vault: (extra && extra.vault) || req, toast: (extra && extra.toast) || function () {}, progress: (extra && extra.progress) || function () {} };
    if (started) return started;
    started = req('GET', '/api/ops/ext').then(function (r) {
      info.expected = r.assets.length > 0 || !!r.missing;
      info.missing = !!r.missing;
      info.active = r.assets.length > 0;
      r.assets.forEach(function (a) { urls[a.name] = a.url; });
      return Promise.all(r.assets.map(add));
    }).then(function () {}, function () { started = null; });
    return started;
  }
  // (the address of a file comes with a ticket good for a couple of minutes: asked for when it is wanted)
  function url(name) {
    if (!request) return Promise.reject(new Error('not loaded'));
    return request('GET', '/api/ops/ext').then(function (r) {
      var a = r.assets.filter(function (x) { return x.name === name; })[0];
      if (!a) throw new Error('no such file');
      return a.url;
    });
  }
  // a hook: its answer, or `fallback` at once when none stands (the page goes on as it did)
  function run(name, fallback) {
    var args = Array.prototype.slice.call(arguments, 2);
    return (started || Promise.resolve()).then(function () {
      var fn = hooks[name];
      return fn ? fn.apply(null, args) : fallback;
    });
  }
  return {
    load: load, url: url, run: run,
    io: function () { return tools; },
    hook: function (name, fn) { hooks[name] = fn; },
    has: function (name) { return !!hooks[name]; },
    // the server has parts for this person, or lost ones it had (so a hook is to be there)
    expected: function () { return info.expected; },
    // anything loaded in this page: a log out starts the page over
    active: function () { return info.active; },
    menu: function (label, fn) { if (window.OpsDesktop) window.OpsDesktop.addItem(label, fn); },
    // the next person starts from nothing
    reset: function () { hooks = {}; started = null; info.expected = false; info.missing = false; if (window.OpsDesktop) window.OpsDesktop.clearItems(); }
  };
})();
