/* The supplied title picture and one full-screen start button. The existing
   account flow, studio splash, title music and app shortcuts still apply. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var pending = false;

  function enterGame() { BR.screens.show('slot'); }

  function onStart() {
    if (pending || !BR.launch.done() || (BR.banlock && BR.banlock.active())) return;
    if (!api.online) { enterGame(); return; }
    pending = true;
    api.restored.then(function () {
      pending = false;
      if (BR.screens.current() !== 'start' || (BR.banlock && BR.banlock.active())) return;
      BR.account.require(enterGame);
    }, function (err) { pending = false; K.fail(err); });
  }

  // Keep the installed app's ?open=friends shortcut working.
  function onFriends() {
    if (BR.banlock && BR.banlock.active()) return;
    if (!api.online) {
      K.sfx('deny');
      K.toast('フレンド機能はオンライン版で使えます', 3200);
      return;
    }
    api.restored.then(function () {
      BR.account.require(function () { BR.social.open('friends'); });
    });
  }

  function init() {
    $('#start-image').src = BR.START_ART;
    var button = $('#start-go');
    button.addEventListener('pointerdown', function () { BR.sfx.unlock(); });
    button.addEventListener('click', function () {
      BR.sfx.unlock();
      K.sfx('click');
      onStart();
    });
    BR.screens.register('start', { open: function () { BR.launch.musicOn(); }, close: function () { BR.launch.musicOff(); } });
    BR.launch.whenDone(function () { if (BR.screens.current() === 'start') BR.launch.musicOn(); });
    var open = /[?&]open=(friends|slot)\b/.exec(location.search);
    if (open) {
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname);
      BR.launch.whenDone(function () { setTimeout(open[1] === 'friends' ? onFriends : onStart, 300); });
    }
  }

  BR.start = { init: init, enterGame: enterGame };
})(window.BR = window.BR || {});
