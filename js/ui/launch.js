/* Optional studio logo (one tap fades to black), title music and maintenance notice.
   Browsers that block autoplay with sound retry the logo muted. */
(function (BR) {
  'use strict';

  var U = BR.util, api = BR.api;
  var $ = U.$;
  var M = BR.LAUNCH_MEDIA;
  // (the story video after signing up was left out in DEV6: its old mark goes)
  var INTRO_KEY = 'blockbuster-reels/intro-pending';

  var done = false, waiting = [];
  function whenDone(fn) { if (done) fn(); else waiting.push(fn); }

  // A video loaded whole and played from a Blob URL: Safari plays video URLs
  // only from servers that answer byte ranges, and the single-file build
  // carries the files as data: URIs.
  var blobs = {};
  function blobUrl(src) {
    if (blobs[src]) return blobs[src];
    var m = /^data:([^;,]+);base64,(.*)$/.exec(src);
    var p;
    if (!window.Blob || !window.URL || !URL.createObjectURL) p = Promise.resolve(src);
    else if (m) {
      try {
        var bin = atob(m[2]), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        p = Promise.resolve(URL.createObjectURL(new Blob([out], { type: m[1] })));
      } catch (e) { p = Promise.resolve(src); }
    } else if (!window.fetch) p = Promise.resolve(src);
    else {
      p = fetch(src).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (b) { return URL.createObjectURL(b); }, function () { delete blobs[src]; return src; });
    }
    blobs[src] = p;
    return p;
  }

  /* ------------------------------------------------------------ studio logos --- */
  var splash = { video: null, timer: 0, skipping: false };

  function finishSplash() {
    if (done) return;
    done = true;
    clearTimeout(splash.timer);
    $('#splash').hidden = true;
    var v = splash.video;
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    waiting.splice(0).forEach(function (f) { try { f(); } catch (e) { if (window.console) console.warn(e); } });
  }
  function skipSplash() {
    if (done || splash.skipping) return;
    splash.skipping = true;
    clearTimeout(splash.timer);
    BR.sfx.unlock();
    if (splash.video) splash.video.pause();
    $('#splash').classList.add('skipping');
    splash.timer = setTimeout(finishSplash, 700);
  }
  function startSplash() {
    var root = $('#splash'), v = splash.video = $('#splash-video');
    if (BR.fx && !BR.fx.on('logo')) { finishSplash(); return; }
    root.addEventListener('click', skipSplash);
    v.muted = false;
    v.addEventListener('playing', function () {
      if (splash.skipping || done) { v.pause(); return; }
      clearTimeout(splash.timer);
      splash.timer = setTimeout(finishSplash, Math.max(8, (v.duration || 5) + 3) * 1000);
    });
    function videoFinished() { if (!splash.skipping) finishSplash(); }
    v.addEventListener('ended', videoFinished);
    v.addEventListener('error', videoFinished);
    blobUrl(M.studio).then(function (url) {
      if (done || splash.skipping) return;
      v.src = url;
      var p = v.play();
      if (p && p.catch) p.catch(function () {
        if (done || splash.skipping) return;
        v.muted = true;
        var retry = v.play();
        if (retry && retry.catch) retry.catch(videoFinished);
      });
    });
    splash.timer = setTimeout(finishSplash, 15000);
  }

  /* ------------------------------------------------------------ title music --- */
  function musicOn() { whenDone(function () { if (BR.screens.current() === 'start') BR.sfx.music.play(M.bgm); }); }
  function musicOff() { BR.sfx.music.stop(); }

  /* ------------------------------------------------------------ maintenance --- */
  var maint = { on: false, timer: 0 };

  // "10月19日" (the day the quota resets, here), plus the time of day
  function recoveryText(until) {
    var d = new Date(until);
    var date = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    var hm = d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2);
    return { date: date, time: date + ' ' + hm + 'ごろ' };
  }

  function showMaintenance(info) {
    var until = (info && info.until) || nextUtcMidnight();
    var h2 = document.querySelector('#maint h2');
    if (info && info.lockdown) {
      // the lockdown: a plain 緊急メンテナンス notice, no "recovery by" date
      if (h2) h2.textContent = '緊急メンテナンス';
      $('#maint-text').textContent = 'ただいま緊急メンテナンスを行っています。';
      $('#maint-sub').textContent = '復旧までしばらくお待ちください。';
    } else {
      if (h2) h2.textContent = 'メンテナンス中';
      var t = recoveryText(until);
      $('#maint-text').textContent = 'サーバーのメンテナンス中です。' + t.date + 'には復旧予定です。';
      $('#maint-sub').textContent = '復旧予定 ' + t.time;
    }
    if (maint.on) return;
    maint.on = true;
    whenDone(function () { $('#maint').hidden = false; });
    if (BR.live) BR.live.close();
    if (BR.call) BR.call.hangupAll();
    // try again once the day has turned (spread out so not everyone comes back at once)
    clearTimeout(maint.timer);
    var wait = Math.max(10000, until - Date.now()) + 5000 + Math.random() * 60000;
    maint.timer = setTimeout(function () { location.reload(); }, Math.min(wait, 2147483000));
  }
  function nextUtcMidnight() {
    var d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }

  function init() {
    startSplash();
    try { localStorage.removeItem(INTRO_KEY); } catch (e) { /* nothing kept */ }
    $('#maint-reload').addEventListener('click', function () { BR.sfx.play('click'); location.reload(); });
    if (api.online) api.on('maintenance', showMaintenance);
  }

  BR.launch = {
    init: init,
    whenDone: whenDone,
    done: function () { return done; },
    blobUrl: blobUrl,
    musicOn: musicOn,
    musicOff: musicOff,
    maintenance: function () { return maint.on; }
  };
})(window.BR = window.BR || {});
