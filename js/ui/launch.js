/* Launching the game: the studio logos at every launch (they cannot be
   skipped), the title music while the title screen is up, the story video
   played once after signing up (skippable), and the maintenance notice when
   the server's daily quota is used up. Browsers only play sound after a
   tap, so outside the Android app a "TAP TO START" comes first. */
(function (BR) {
  'use strict';

  var U = BR.util, api = BR.api;
  var $ = U.$;
  var M = BR.LAUNCH_MEDIA;
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
  var splash = { video: null, timer: 0, started: false };

  function finishSplash() {
    if (done) return;
    done = true;
    clearTimeout(splash.timer);
    var root = $('#splash'), v = splash.video;
    root.classList.add('out');
    setTimeout(function () {
      root.hidden = true;
      v.removeAttribute('src');
      v.load();
    }, 450);
    waiting.splice(0).forEach(function (f) { try { f(); } catch (e) { if (window.console) console.warn(e); } });
  }

  function startSplash() {
    var v = splash.video = $('#splash-video');
    var tap = $('#splash-tap');
    v.addEventListener('playing', function () {
      splash.started = true;
      tap.hidden = true;
      clearTimeout(splash.timer);
      // a stalled video does not keep the game shut
      splash.timer = setTimeout(finishSplash, Math.max(8, (v.duration || 6) + 3) * 1000);
    });
    v.addEventListener('ended', finishSplash);
    v.addEventListener('error', finishSplash);
    function play() {
      // the Android app may play sound right away; browsers wait for the tap
      if (BR.platform && BR.platform.app) BR.sfx.unlock();
      v.muted = false;
      var p = v.play();
      if (p && p.catch) {
        p.catch(function (e) {
          if (e && e.name === 'NotAllowedError') {
            // sound needs a tap first: wait for it (no skipping either way)
            tap.hidden = false;
          } else {
            finishSplash();
          }
        });
      }
    }
    tap.addEventListener('click', function () {
      tap.hidden = true;
      play();
    });
    blobUrl(api.online ? M.studio : M.studioLite).then(function (url) {
      v.src = url;
      play();
    });
    // the file never came: carry on
    splash.timer = setTimeout(function () { if (!splash.started && tap.hidden) finishSplash(); }, 15000);
  }

  /* ------------------------------------------------------------ title music --- */
  function musicOn() { whenDone(function () { if (BR.screens.current() === 'start' && !intro.on) BR.sfx.music.play(M.bgm); }); }
  function musicOff() { BR.sfx.music.stop(); }

  /* ------------------------------------------------------------ the story --- */
  var intro = { on: false, next: null };

  function prefetchIntro() { if (api.online) blobUrl(M.intro); }

  // Plays the story once (after signing up), then `next`.
  function playIntro(next) {
    if (!api.online) { next(); return; }
    try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* only this time */ }
    intro.on = true;
    intro.next = next;
    musicOff();
    var root = $('#intro'), v = $('#intro-video');
    root.hidden = false;
    root.classList.remove('out');
    $('#intro-wait').hidden = false;
    blobUrl(M.intro).then(function (url) {
      if (!intro.on) return;
      v.src = url;
      v.muted = false;
      var p = v.play();
      if (p && p.catch) p.catch(function () { v.muted = true; v.play().catch(endIntro); });
    });
  }
  function endIntro() {
    if (!intro.on) return;
    intro.on = false;
    try { localStorage.removeItem(INTRO_KEY); } catch (e) { /* ignore */ }
    var root = $('#intro'), v = $('#intro-video');
    v.pause();
    root.classList.add('out');
    setTimeout(function () {
      root.hidden = true;
      v.removeAttribute('src');
      v.load();
    }, 400);
    var f = intro.next;
    intro.next = null;
    if (f) f();
  }

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
    var t = recoveryText(until);
    $('#maint-text').textContent = 'サーバーのメンテナンス中です。' + t.date + 'には復旧予定です。';
    $('#maint-sub').textContent = '復旧予定 ' + t.time;
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
    $('#intro-skip').addEventListener('click', function () { BR.sfx.play('click'); endIntro(); });
    $('#intro-video').addEventListener('ended', endIntro);
    $('#intro-video').addEventListener('error', endIntro);
    $('#intro-video').addEventListener('playing', function () { $('#intro-wait').hidden = true; });
    $('#maint-reload').addEventListener('click', function () { BR.sfx.play('click'); location.reload(); });
    if (api.online) {
      api.on('maintenance', showMaintenance);
      // signed up but the app was closed during the story: it plays now
      var pending = false;
      try { pending = !!localStorage.getItem(INTRO_KEY); } catch (e) { /* ignore */ }
      if (pending) whenDone(function () { api.restored.then(function () { if (api.hasToken()) playIntro(function () {}); }); });
    }
  }

  BR.launch = {
    init: init,
    whenDone: whenDone,
    done: function () { return done; },
    blobUrl: blobUrl,
    musicOn: musicOn,
    musicOff: musicOff,
    prefetchIntro: prefetchIntro,
    playIntro: playIntro,
    introPlaying: function () { return intro.on; },
    skipIntro: endIntro,
    maintenance: function () { return maint.on; }
  };
})(window.BR = window.BR || {});
