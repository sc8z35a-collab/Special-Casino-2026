/* The game as an app: installing it (Android: the APK from this site or
   Chrome's install; iPhone: Safari's "Add to Home Screen"), updates, the
   service worker, and the bridge the Android app uses for its back button.
   Updates are the same everywhere: the web page and the apps (which open the
   game from the server) load the newest game right away. A newer game is
   looked for every 2 minutes and whenever the game comes back into view; it
   loads by itself when nothing is going on (the title screen, or coming back
   to the game), else with one tap on 今すぐアップデート. A newer Android app
   itself (rare) downloads and installs from inside the app. */
(function (BR) {
  'use strict';

  var ua = navigator.userAgent || '';
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var platform = {
    app: /TwoStateCasinoApp\//.test(ua) && !!window.TwoStateApp,
    ios: /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    android: /Android/i.test(ua),
    standalone: mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || navigator.standalone === true
  };
  platform.installed = platform.app || platform.standalone;
  BR.platform = platform;

  var U = BR.util, K, api;
  var $ = U.$;
  var CHECK_EVERY = 2 * 60000;
  var AWAY = 30000;       // back after this long away: a newer game loads by itself

  var state = {
    apk: null,           // download/app.json when the site offers the Android app
    web: false,          // a newer game is on the server
    app: null,           // a newer Android app (app mode): its app.json
    prompt: null,        // Chrome's install prompt (beforeinstallprompt)
    told: false,
    updating: false,
    back: 0               // when the game came back into view (a newer game may load by itself then)
  };

  function getJson(path) {
    return fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* ------------------------------------------------------------ the start screen button --- */
  function renderButton() {
    var b = $('#start-app');
    var update = state.web || !!state.app;
    var install = api.online && !platform.installed;
    b.hidden = !update && !install;
    b.classList.toggle('update', update);
    b.querySelector('span').textContent = state.web ? '今すぐアップデート' : state.app ? 'アプリを更新' : 'アプリで遊ぶ';
    b.querySelector('.ic').className = 'ic ' + (update ? 'ic-download' : 'ic-add-home');
    // and on the slot screen: the 今すぐアップデート note (a newer app has its own words: the toast is gone in a few seconds)
    if (state.web && BR.news) BR.news.remind(true);
    else if (state.app && BR.news) BR.news.appNew('アプリの新しいバージョン（' + state.app.versionName + '）があります');
  }

  // 今すぐアップデート (the slot screen's note, Dev News): the newest game,
  // right away, on the web and in the apps alike
  function update() {
    K.sfx('click');
    if (!state.web && state.app) { askAppUpdate(); return; }
    reload();
  }

  function onButton() {
    K.sfx('click');
    if (state.web) { reload(); return; }
    if (state.app) { askAppUpdate(); return; }
    openSheet();
  }

  /* ------------------------------------------------------------ updates --- */
  // The old copies kept by the service worker go first, then the page loads
  // again from the server (the game's files are always checked with it).
  var RELOADED = 'blockbuster-reels/reloaded';
  function reloadedLately() { try { return Date.now() - (Number(sessionStorage.getItem(RELOADED)) || 0) < 60000; } catch (e) { return false; } }
  function reload(quiet) {
    if (state.updating) return;
    state.updating = true;
    try { sessionStorage.setItem(RELOADED, String(Date.now())); } catch (e) { /* fine */ }
    if (!quiet) K.toast('最新版を読み込んでいます…');
    if (platform.app && window.TwoStateApp.clearWebCache) {
      try { window.TwoStateApp.clearWebCache(); } catch (e) { /* older apps use the web fallback */ }
    }
    var clear = window.caches ? caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('two-state-') === 0; }).map(function (k) { return caches.delete(k); }));
    }) : Promise.resolve();
    var sw = navigator.serviceWorker && navigator.serviceWorker.getRegistrations ? navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.filter(function (r) {
        var worker = r.active || r.waiting || r.installing;
        return worker && new URL(worker.scriptURL).pathname === new URL('sw.js', location.href).pathname;
      }).map(function (r) { return r.unregister().catch(function () {}); }));
    }) : Promise.resolve();
    // The network requests and the fallback timer may finish together. Only
    // the first one may navigate: two reloads would play the studio logo twice.
    var navigated = false;
    var fallback = setTimeout(go, 2500);
    function go() {
      if (navigated) return;
      navigated = true;
      clearTimeout(fallback);
      var url = new URL(location.href);
      url.searchParams.set('_update', String(Date.now()));
      location.replace(url.href);
    }
    Promise.all([clear, sw]).then(go, go);
  }
  // nothing would be lost by loading the page again now
  function idle() {
    if (BR.game && BR.game.busy()) return false;
    if (BR.call && BR.call.active && BR.call.active()) return false;
    if (BR.entry && BR.entry.isOpen()) return false;
    if (BR.account && BR.account.isOpen()) return false;
    if (BR.play && BR.play.betLocked && BR.play.betLocked()) return false;
    return !document.querySelector('#stage .modal:not([hidden])');
  }
  // a newer game: by itself on the title screen or just after coming back, else the note
  function newer() {
    var resumed = state.back && Date.now() - state.back < 20000;
    // (never twice in a row by itself: a page the server has not caught up with stays put)
    if ((BR.screens.current() === 'start' || resumed) && idle() && !reloadedLately()) { reload(true); return; }
    tell('新しいバージョンがあります（「今すぐアップデート」で更新）');
  }

  function checkWeb() {
    if (!BR.BUILD || BR.BUILD === 'dev') return;
    getJson('version.json').then(function (v) {
      if (!v || !v.build || v.build === BR.BUILD) return;
      var first = !state.web;
      state.web = true;
      if (first) renderButton();
      newer();
    }, function () { /* offline: try again later */ });
  }

  function checkApp() {
    if (!platform.app) return;
    getJson('download/app.json').then(function (info) {
      var mine = Number(window.TwoStateApp.versionCode());
      if (!info || !(Number(info.versionCode) > mine)) return;
      if (state.app && state.app.versionCode === info.versionCode) return;
      state.app = info;
      renderButton();
      tell('アプリの新しいバージョン（' + info.versionName + '）があります（「今すぐアップデート」で更新）');
    }, function () { /* no app published, or offline */ });
  }

  function tell(text) {
    if (state.told) return;
    state.told = true;
    K.toast(text, 4200);
  }

  function check() {
    checkWeb();
    checkApp();
  }

  /* the Android app downloads and installs its update itself */
  function askAppUpdate() {
    var info = state.app;
    var mine = window.TwoStateApp.signature ? String(window.TwoStateApp.signature()) : '';
    var resign = info.certSha256 && mine && info.certSha256 !== mine;
    showUpdate({
      title: 'アプリのアップデート',
      text: resign
        ? 'このバージョンは上書きできません。アプリを削除してから入れ直してください（残高やフレンドは消えません）。'
        : 'Two state Casino ' + info.versionName + '（' + Math.max(1, Math.round(info.size / 1024)) + ' KB）に更新します。',
      go: resign ? 'ダウンロード' : 'アップデート',
      onGo: function () {
        if (resign) { location.href = info.apk + '?v=' + info.versionCode; return; }
        startAppUpdate(info);
      }
    });
  }

  function startAppUpdate(info) {
    if (state.updating) return;
    state.updating = true;
    progress(0);
    setUpdateText('ダウンロードしています…');
    $('#up-go').disabled = true;
    // an older app without the update bridge (or one that refuses): the button must not stay stuck, the file can be taken from the browser
    try {
      window.TwoStateApp.update(info.apk + '?v=' + info.versionCode, info.sha256 || '');
    } catch (e) {
      onAppUpdate({ state: 'error', message: 'このアプリでは自動アップデートできません。「ダウンロード」から新しいアプリを入れてください' });
      var go = $('#up-go');
      go.textContent = 'ダウンロード';
      go.onclick = function () { K.sfx('click'); location.href = info.apk + '?v=' + info.versionCode; };
    }
  }

  // events from the Android app: { state, progress?, message? }
  function onAppUpdate(ev) {
    switch (ev.state) {
      case 'downloading':
        if (typeof ev.progress === 'number') progress(ev.progress);
        setUpdateText('ダウンロードしています… ' + (ev.progress || 0) + '%');
        break;
      case 'permission':
        setUpdateText('「この提供元のアプリを許可」をオンにして戻ってください。インストールが始まります。');
        break;
      case 'installing':
      case 'confirm':
        progress(100);
        setUpdateText('インストール画面で「更新」（または「インストール」）をタップしてください。');
        break;
      case 'done':
        setUpdateText('アップデートが完了しました。');
        break;
      case 'cancelled':
        state.updating = false;
        $('#up-go').disabled = false;
        setUpdateText('アップデートを中止しました。');
        break;
      case 'error':
        state.updating = false;
        $('#up-go').disabled = false;
        $('#up-bar').hidden = true;
        setUpdateText(ev.message || 'アップデートできませんでした');
        K.sfx('deny');
        break;
    }
  }

  function showUpdate(o) {
    $('#up-title').textContent = o.title;
    setUpdateText(o.text);
    $('#up-bar').hidden = true;
    var go = $('#up-go');
    go.textContent = o.go;
    go.disabled = false;
    go.onclick = function () { K.sfx('click'); o.onGo(); };
    K.showModal('update');
  }
  function setUpdateText(t) { $('#up-text').textContent = t; }
  function progress(p) {
    $('#up-bar').hidden = false;
    $('#up-fill').style.width = Math.max(0, Math.min(100, p)) + '%';
  }

  /* ------------------------------------------------------------ installing --- */
  function openSheet() {
    var card = $('#install .install-card');
    card.classList.toggle('is-ios', platform.ios);
    card.classList.toggle('is-android', platform.android);
    var apk = $('#in-apk');
    apk.hidden = !state.apk;
    if (state.apk) {
      apk.href = state.apk.apk + '?v=' + state.apk.versionCode;
      $('#in-apk-size').textContent = state.apk.versionName + '・' + Math.max(1, Math.round(state.apk.size / 1024)) + ' KB';
    }
    $('#in-apk-none').hidden = !!state.apk;
    $('#in-pwa').hidden = !state.prompt;
    K.showModal('install');
  }

  function installPwa() {
    var p = state.prompt;
    if (!p) return;
    K.sfx('click');
    p.prompt();
    var done = p.userChoice || Promise.resolve();
    done.then(function () { state.prompt = null; $('#in-pwa').hidden = true; }, function () {});
  }

  function share() {
    var url = location.origin + location.pathname + '?install';
    K.sfx('click');
    if (navigator.share) {
      navigator.share({ title: 'Two state Casino RP', text: '一緒に遊ぼう！アプリはここから', url: url }).catch(function () {});
      return;
    }
    K.copyText(url).then(function () { K.toast('リンクをコピーしました。友達に送ってください'); }, function () { K.toast(url, 6000); });
  }

  /* ------------------------------------------------------------ Android app bridge --- */
  // The app's back button: close what is open, step back a screen; false on
  // the start screen (the app then goes to the background).
  window.BRNative = {
    back: function () {
      // the studio logos cannot be skipped
      if (!BR.launch.done()) return true;
      if (BR.launch.maintenance()) return true;
      // the beginner guide has to be finished
      if (BR.guide && BR.guide.active && BR.guide.active()) return true;
      if (!$('#numpad').hidden) { $('#numpad').hidden = true; return true; }
      if (BR.social && BR.social.escape()) return true;
      if (BR.account && BR.account.isOpen()) { BR.account.close(); return true; }
      return BR.screens.back();
    },
    updateEvent: onAppUpdate,
    // the app's notification permission, once the player answered (js/net/push.js)
    notifyState: function (state) { if (BR.push) BR.push.appState(state); }
  };

  // The pictures, fonts and sounds this page loaded, and its scripts and styles (named by the hash of their file), are kept by the service
  // worker (sw.js: the first visit was loaded before it took the page over), so the next start does not have to ask the server about each of them.
  function keepFiles() {
    if (!navigator.serviceWorker.ready || !window.performance || !performance.getEntriesByType || !BR.BUILD || BR.BUILD === 'dev') return;
    navigator.serviceWorker.ready.then(function (reg) {
      setTimeout(function () {
        var worker = reg.active;
        if (!worker) return;
        var urls = performance.getEntriesByType('resource').map(function (r) { return r.name; }).filter(function (u) {
          if (u.indexOf(location.origin + '/') !== 0) return false;
          var path = u.slice(location.origin.length);
          return /^\/(img|fonts|sounds|video|icons)\//.test(path) || /^\/(js|css)\/[^?]+\?v=[0-9a-f]{10}$/.test(path);
        });
        if (urls.length) worker.postMessage({ type: 'keep', build: BR.BUILD, urls: urls });
      }, 6000);
    }, function () { /* no worker */ });
  }

  function init() {
    K = BR.kit;
    // Artwork is optional: keep the normal labelled buttons when the asset
    // manifest is absent, so a cosmetic setting can never stop game startup.
    var updateButton = (BR.UI_IMG && BR.UI_IMG.updateButton) || (BR.LAUNCH_ASSETS && BR.LAUNCH_ASSETS.updateButton);
    if (updateButton) {
      var art = document.createElement('style');
      art.textContent = '#start-app.update,#update-note-go,#up-go,.news-update{' +
        'background-image:url("' + updateButton + '");' +
        'background-position:center;background-size:100% 100%;background-repeat:no-repeat;' +
        'box-shadow:0 5px 14px rgba(0,0,0,.45);color:transparent;text-shadow:none;border-radius:12px}' +
        '#start-app.update{width:320px;height:100px;padding:0}' +
        '#start-app.update .ic{visibility:hidden}' +
        '#update-note-go{width:270px;min-height:84px}' +
        '#up-go{width:330px;height:102px}' +
        '.news-update{width:280px;min-height:88px}' +
        '#up-go:disabled{opacity:.55}';
      document.head.appendChild(art);
    }
    api = BR.api;
    K.registerModal('install');
    K.registerModal('update');
    $('#start-app').addEventListener('click', onButton);
    $('#in-pwa').addEventListener('click', installPwa);
    $('#in-share').addEventListener('click', share);
    $('#up-later').addEventListener('click', function () { K.sfx('click'); K.closeModal('update'); });
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.prompt = e;
      if (K.isOpen('install')) $('#in-pwa').hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      state.prompt = null;
      K.toast('インストールしました！ホーム画面のアイコンから遊べます', 3600);
    });
    if (api.online && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () { /* the game works without it */ });
      keepFiles();
    }
    if (api.online && !platform.app) {
      getJson('download/app.json').then(function (info) { if (info && info.apk) state.apk = info; }, function () {});
    }
    renderButton();
    if (api.online) {
      setTimeout(check, 4000);
      setInterval(check, CHECK_EVERY);
      var hiddenAt = 0;
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) { hiddenAt = Date.now(); return; }
        // back after a while: a newer game may load by itself
        if (hiddenAt && Date.now() - hiddenAt > AWAY) state.back = Date.now();
        check();
      });
    }
    if (/[?&]install\b/.test(location.search) && api.online && !platform.installed) BR.launch.whenDone(function () { setTimeout(openSheet, 600); });
  }

  BR.install = {
    init: init,
    open: openSheet,
    check: check,
    update: update,
    // the server runs a newer release than this game (js/ui/news.js)
    outdated: function () {
      if (state.web) return;
      state.web = true;
      renderButton();
      newer();
    }
  };
})(window.BR = window.BR || {});
