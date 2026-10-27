/* Optional operator tools. Session data stays in their owning controller. */
(function () {
  'use strict';
  var jobs = {}, generation = 0;
  function load(file) {
    if (!jobs[file]) jobs[file] = new Promise(function (resolve, reject) {
      var meta = document.querySelector('meta[data-ops-file="' + file + '"]') || (file === 'vault3d.js' ? document.querySelector('meta[name="ops-vault3d"]') : null);
      var css = /\.css$/.test(file), tag = document.createElement(css ? 'link' : 'script');
      if (css) { if (file === 'phone.css') tag.media = '(max-width: 700px), (max-height: 520px) and (pointer: coarse)'; tag.rel = 'stylesheet'; tag.href = meta ? meta.content : file; } else tag.src = meta ? meta.content : file;
      tag.onload = resolve; tag.onerror = function () { delete jobs[file]; tag.remove(); reject(new Error('読み込めませんでした。もう一度お試しください')); };
      if (css) {
        tag.dataset.opsStyle = file;
        var order = ['glass.css', 'cdw.css', 'phone.css'], rank = order.indexOf(file), before = Array.from(document.head.querySelectorAll('link[data-ops-style]')).find(function (node) { return order.indexOf(node.dataset.opsStyle) > rank; });
        document.head.insertBefore(tag, before || null);
      } else document.head.appendChild(tag);
    });
    return jobs[file];
  }
  window.OpsLoad = { load: load, cancel: function () { generation++; } };
  function failure(e) { if (window.OpsDesktop && OpsDesktop.toast) OpsDesktop.toast(e.message); else console.warn(e); }
  var cdw = { toggle: function () { var epoch = generation; return load('cdw.css').then(function () { return load('cdw.js'); }).then(function () { if (epoch === generation) return window.OpsCDW.toggle(); }).catch(failure); }, on: function () { return false; }, off: function () {}, session: function () {}, nudge: function () {} };
  window.OpsCDW = cdw;
  window.OpsCalendar = { show: function (root) { return load('calendar.js').then(function () { window.OpsCalendar.show(root); }).catch(failure); } };
  var watchApi;
  window.OpsWatch = {
    init: function (api) { watchApi = api; }, active: function () { return false; }, onLive: function () {},
    start: function (player) { var epoch = generation; return load('watch.js').then(function () { window.OpsWatch.init(watchApi); if (epoch === generation) return window.OpsWatch.start(player); }).catch(failure); },
    sync: function () { return watchApi.request('GET', '/api/ops/watch/state').then(function (r) { if (r.session) return watchApi.request('POST', '/api/ops/watch/stop', { sid: r.session.sid }).then(function () { watchApi.toast('前の画面を見ていたため、監視を終了しました'); }); }, function () {}); }
  };
  window.OpsDiaryProfile = function (ctx) {
    var real, pending, user, generation = 0, view;
    function ensure() {
      var epoch = generation;
      if (!pending) pending = load('diary-profile.js').then(function () {
        if (epoch !== generation) return;
        real = window.OpsDiaryProfile(ctx); real.start(user); real.view(view);
      }).catch(function (e) { pending = null; ctx.fail(e); });
      return pending;
    }
    return { start: function (u) { user = u; if (real) real.start(u); },
      reset: function () { generation++; user = null; if (real) real.reset(); real = null; pending = null; },
      refresh: function () { if (real) real.refresh(); },
      view: function (v) { view = v; if (real) real.view(v); else if (v === 'diary' || v === 'profile') ensure(); }
    };
  };
  function glass() {
    if (!document.body.classList.contains('mac-flat')) load('glass.css').then(function () { return load('glass.js'); }).catch(failure);
  }
  document.addEventListener('DOMContentLoaded', function () { var phone = matchMedia('(max-width: 700px), (max-height: 520px) and (pointer: coarse)'); function phoneStyle() { if (phone.matches) load('phone.css').catch(failure); } phoneStyle(); if (phone.addEventListener) phone.addEventListener('change', phoneStyle); else phone.addListener(phoneStyle); glass(); new MutationObserver(glass).observe(document.body, { attributes: true, attributeFilter: ['class'] }); });
})();
