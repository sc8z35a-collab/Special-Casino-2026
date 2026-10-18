/* The game as an app: installing it (Android: the APK from this site or
   Chrome's install; iPhone: Safari's "Add to Home Screen"), the アップデート
   button (a newer game on the server -> reload; a newer Android app ->
   download and install from inside the app), the service worker, and the
   bridge the Android app uses for its back button. */
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
  var CHECK_EVERY = 15 * 60000;

  var state = {
    apk: null,           // download/app.json when the site offers the Android app
    web: false,          // a newer game is on the server
    app: null,           // a newer Android app (app mode): its app.json
    prompt: null,        // Chrome's install prompt (beforeinstallprompt)
    told: false,
    updating: false
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
    b.querySelector('span').textContent = update ? 'アップデート' : 'アプリで遊ぶ';
    b.querySelector('.ic').className = 'ic ' + (update ? 'ic-download' : 'ic-add-home');
  }

  function onButton() {
    K.sfx('click');
    if (state.app) { askAppUpdate(); return; }
    if (state.web) { reload(); return; }
    openSheet();
  }

  /* ------------------------------------------------------------ updates --- */
  function reload() {
    K.toast('最新版を読み込んでいます…');
    setTimeout(function () { location.reload(); }, 300);
  }

  function checkWeb() {
    if (!BR.BUILD || BR.BUILD === 'dev') return;
    getJson('version.json').then(function (v) {
      if (!v || !v.build || v.build === BR.BUILD || state.web) return;
      state.web = true;
      renderButton();
      tell('新しいバージョンがあります。スタート画面の「アップデート」で更新できます');
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
      tell('アプリの新しいバージョン（' + info.versionName + '）があります。スタート画面の「アップデート」で更新できます');
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
        ? 'このバージョンは今のアプリの上に入れられません。アプリをいったん削除してから、新しいアプリを入れてください（残高やフレンドはサーバーに保存されています）。'
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
    window.TwoStateApp.update(info.apk + '?v=' + info.versionCode, info.sha256 || '');
  }

  // events from the Android app: { state, progress?, message? }
  function onAppUpdate(ev) {
    switch (ev.state) {
      case 'downloading':
        if (typeof ev.progress === 'number') progress(ev.progress);
        setUpdateText('ダウンロードしています… ' + (ev.progress || 0) + '%');
        break;
      case 'permission':
        setUpdateText('「この提供元のアプリを許可」をオンにして、この画面に戻ってください。そのままインストールが始まります。');
        break;
      case 'installing':
      case 'confirm':
        progress(100);
        setUpdateText('インストール画面で「更新」（または「インストール」）をタップしてください。終わるとアプリが新しくなります。');
        break;
      case 'done':
        setUpdateText('アップデートが完了しました。');
        break;
      case 'cancelled':
        state.updating = false;
        $('#up-go').disabled = false;
        setUpdateText('アップデートを中止しました。もう一度「アップデート」を押すとやり直せます。');
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
      // the studio logos cannot be skipped; the story can
      if (!BR.launch.done()) return true;
      if (BR.launch.introPlaying()) { BR.launch.skipIntro(); return true; }
      if (BR.launch.maintenance()) return true;
      if (!$('#numpad').hidden) { $('#numpad').hidden = true; return true; }
      if (BR.social && BR.social.escape()) return true;
      if (BR.account && BR.account.isOpen()) { BR.account.close(); return true; }
      return BR.screens.back();
    },
    updateEvent: onAppUpdate
  };

  function init() {
    K = BR.kit;
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
      navigator.serviceWorker.register('sw.js').catch(function () { /* the game works without it */ });
    }
    if (api.online && !platform.app) {
      getJson('download/app.json').then(function (info) { if (info && info.apk) state.apk = info; }, function () {});
    }
    renderButton();
    if (api.online) {
      setTimeout(check, 4000);
      setInterval(check, CHECK_EVERY);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    }
    if (/[?&]install\b/.test(location.search) && api.online && !platform.installed) BR.launch.whenDone(function () { setTimeout(openSheet, 600); });
  }

  BR.install = { init: init, open: openSheet, check: check };
})(window.BR = window.BR || {});
