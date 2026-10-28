/* Optional screens load once, in dependency order, when first opened. */
(function (BR) {
  'use strict';
  var files = Object.create(null), screens = Object.create(null);
  function script(path) {
    if (!files[path]) files[path] = new Promise(function (resolve, reject) {
      var tag = document.createElement('script'); tag.src = BR.util.codeUrl(path);
      tag.onload = resolve;
      tag.onerror = function () { delete files[path]; tag.remove(); reject(new Error('screen_load')); };
      document.head.appendChild(tag);
    });
    return files[path];
  }
  function install(name, paths) {
    // The standalone HTML already contains these modules and initializes them normally.
    if (BR[name]) return;
    var state = { generation: 0, job: null, ready: null }, proxy;
    function load() {
      if (state.ready) return Promise.resolve(state.ready);
      if (!state.job) state.job = BR.resources.load(name).then(function () { return paths.reduce(function (job, path) { return job.then(function () { return script(path); }); }, Promise.resolve()); }).then(function () {
        var api = BR[name];
        if (!api || api === proxy || typeof api.open !== 'function') throw new Error('screen_missing');
        api.init(); state.ready = api; return api;
      }).catch(function (error) {
        state.job = null; paths.forEach(function (path) { delete files[path]; }); BR[name] = proxy; throw error;
      });
      return state.job;
    }
    proxy = {
      init: function () {},
      open: function () {
        var args = arguments, generation = ++state.generation;
        var job = load();
        return (BR.resources.wait ? BR.resources.wait(job) : job).then(function (api) { if (generation === state.generation) return api.open.apply(api, args); }, function () {
          if (generation === state.generation) BR.kit.fail({ message: '画面を読み込めませんでした。もう一度お試しください。' });
        });
      },
      reset: function () { state.generation++; }
    };
    screens[name] = { load: load, cancel: function () { state.generation++; } }; BR[name] = proxy;
  }
  Object.keys(BR.LAZY || {}).forEach(function (name) { install(name, BR.LAZY[name]); });
  BR.lazy = {
    load: function (name) { return screens[name] ? screens[name].load() : Promise.resolve(BR[name]); },
    cancelPending: function () { if (BR.resources.cancelPending) BR.resources.cancelPending(); Object.keys(screens).forEach(function (name) { screens[name].cancel(); }); }
  };
})(window.BR = window.BR || {});
