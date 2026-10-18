/* The start screen: the title video full screen, with the スタート and 友達
   buttons of the video made tappable exactly where they are drawn. Players
   who have not registered yet are taken to sign-up by either button. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;

  var video = null;

  function pickSource() {
    var v = BR.START_VIDEO;
    if (!api.online) return v.lite;
    var c = navigator.connection;
    var px = Math.max(screen.width || 0, screen.height || 0) * (window.devicePixelRatio || 1);
    return (c && c.saveData) || px < 1400 ? v.lite : v.full;
  }

  function play() {
    if (!video || BR.screens.current() !== 'start' || !BR.launch.done()) return;
    var p = video.play();
    if (p && p.catch) p.catch(function () { /* autoplay refused: the poster stays, the next tap starts it */ });
  }

  function onShow() { play(); BR.launch.musicOn(); }
  function onHide() { if (video) video.pause(); BR.launch.musicOff(); }

  // the buttons drawn in the video light up when pressed
  function press(btn, fn) {
    btn.addEventListener('pointerdown', function () {
      btn.classList.add('pressed');
      BR.sfx.unlock();
      play();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      btn.addEventListener(ev, function () { btn.classList.remove('pressed'); });
    });
    btn.addEventListener('click', function () {
      btn.classList.remove('flash');
      void btn.offsetWidth;
      btn.classList.add('flash');
      K.sfx('click');
      fn();
    });
  }

  function enterGame() {
    BR.screens.show('slot');
  }

  function onStart() {
    if (!api.online) { enterGame(); return; }
    api.restored.then(function () { BR.account.require(enterGame); });
  }

  function onFriends() {
    if (!api.online) {
      K.sfx('deny');
      K.toast('フレンド機能はオンライン版（サーバー公開後）で利用できます', 3200);
      return;
    }
    api.restored.then(function () {
      BR.account.require(function () { BR.social.open('friends'); });
    });
  }

  function init() {
    video = $('#start-video');
    video.muted = true;
    video.setAttribute('muted', '');
    video.poster = BR.START_VIDEO.poster;
    $('#start-backdrop').style.backgroundImage = 'url("' + BR.START_VIDEO.poster + '")';
    BR.launch.blobUrl(pickSource()).then(function (url) {
      video.src = url;
      play();
    });
    video.addEventListener('playing', function () { $('#screen-start').classList.add('playing'); });
    press($('#start-go'), onStart);
    press($('#start-friends'), onFriends);
    BR.screens.register('start', { open: onShow, close: onHide });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) play(); });
    // after the studio logos: the title video and its music
    BR.launch.whenDone(function () {
      play();
      if (BR.screens.current() === 'start') BR.launch.musicOn();
    });
    // app shortcuts (long press on the home-screen icon): ?open=friends / ?open=slot
    var open = /[?&]open=(friends|slot)\b/.exec(location.search);
    if (open) {
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname);
      BR.launch.whenDone(function () { setTimeout(open[1] === 'friends' ? onFriends : onStart, 300); });
    }
  }

  BR.start = { init: init, enterGame: enterGame };
})(window.BR = window.BR || {});
