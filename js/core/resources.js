/* Cached, ordered resources. A failed load can be retried; navigation never
   shows a screen until its styles and optional controllers are ready. */
(function (BR) {
  'use strict';
  var files = {}, groups = {}, done = {}, generation = 0, modules = [], initialized = new WeakSet();
  function file(path) {
    if (!files[path]) files[path] = new Promise(function (resolve, reject) {
      var css = /\.css$/.test(path), tag = document.createElement(css ? 'link' : 'script');
      if (css) { tag.rel = 'stylesheet'; tag.href = BR.util.codeUrl(path); } else tag.src = BR.util.codeUrl(path);
      tag.onload = resolve; tag.onerror = function () { delete files[path]; tag.remove(); reject(new Error('resource_load')); };
      if (css) {
        tag.dataset.brStyle = path;
        var order = BR.STYLES || [], rank = order.indexOf(path), before = Array.from(document.head.querySelectorAll('link[data-br-style]')).find(function (node) { return order.indexOf(node.dataset.brStyle) > rank; });
        document.head.insertBefore(tag, before || null);
      } else document.head.appendChild(tag);
    });
    return files[path];
  }
  function ready(name) { return !!done[name] || !BR.api.online || !(BR.RESOURCES || {})[name]; }
  function load(name) {
    if (ready(name)) return Promise.resolve();
    if (!groups[name]) groups[name] = BR.RESOURCES[name].reduce(function (p, path) { return p.then(function () { return file(path); }); }, Promise.resolve()).then(function () { done[name] = true; modules.forEach(function (m) { var api = BR[m.name]; if (api && api !== m.proxy) initialize(api); }); if (name === 'slot') initEffects(); }).catch(function (e) { delete groups[name]; throw e; });
    return groups[name];
  }
  function fail() { if (BR.kit) BR.kit.fail({ message: '画面を読み込めませんでした。もう一度お試しください。' }); }
  BR.resources = { load: load, ready: ready, file: file, cancelPending: function () { generation++; } };
  function initialize(api) { if (!initialized.has(api)) { if (api.init) api.init(); initialized.add(api); } }
  function module(name, methods, group, empty) {
    if (BR[name]) return;
    var proxy, job;
    function ensure() {
      if (!job) job = load(group || name).then(function () {
        if (!BR[name] || BR[name] === proxy) throw new Error('module_missing');
        var api = BR[name]; initialize(api); return api;
      }).catch(function (e) { job = null; BR[name] = proxy; throw e; });
      return job;
    }
    proxy = { init: function () {}, active: function () { return false; }, stop: function () {}, leave: function () {}, changed: function () {}, target: function () { return null; } };
    methods.forEach(function (method) { proxy[method] = function () { var args = arguments, epoch = generation; return ensure().then(function (api) { if (epoch === generation) return api[method].apply(api, args); }, fail); }; });
    BR[name] = proxy; modules.push({ name: name, proxy: proxy });
    if (empty) empty(proxy, ensure);
  }
  if (!BR.watchQuality) BR.watchQuality = { active: function () { return false; }, resCap: function () { return Infinity; } };
  module('watch', ['start', 'openChat'], 'watch');
  module('carsaleDialog', ['open'], 'carsaleDialog');
  module('cars', ['showShop', 'showGarage', 'giftTo', 'pickDialog'], 'cars');
  module('guide', ['start'], 'guide', function (proxy, ensure) {
    proxy.init = function () { BR.social.onMe(function (m) { if (m && m.guide) ensure().catch(fail); }); };
  });
  // These effects are optional while their first screen is loading.
  function initEffects() {
    if (!done.slotInit) { done.slotInit = true; if (BR.juice) BR.juice.init(); if (BR.slotfx) BR.slotfx.init(); BR.app.relayout(); }
  }
  BR.resources.effects = function () { return load('slot').then(initEffects); };
})(window.BR = window.BR || {});
