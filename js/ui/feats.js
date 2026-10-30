/* 功績 on the slot screen: the button's number (medals waiting for their tap) and
   the word that a medal was earned. The medal screen itself loads when it is
   first opened (js/ui/medals.js). The server says which medals there are and
   when one is earned (server/core/medals.js): nothing is decided here. */
(function (BR) {
  'use strict';
  var K = BR.kit;
  var ready = 0;

  function set(n) {
    ready = Math.max(0, Number(n) || 0);
    K.badge(document.getElementById('medal-badge'), ready);
    document.getElementById('btn-medals').setAttribute('aria-label', '功績' + (ready ? '・受け取れるメダル' + ready + '個' : ''));
  }
  // earned now: told once (several at once in one word), a tap opens the medals
  function earned(e) {
    if (!e || !e.got || !e.got.length) return;
    set(e.ready);
    var got = e.got;
    K.sfx('register');
    K.toast(got.length === 1 ? 'メダル獲得！「' + got[0].name + '」' : 'メダルを' + got.length + '個獲得しました！', 3600, function () { BR.medals.open(); });
    if (BR.medals.earned) BR.medals.earned(e);
  }

  BR.feats = {
    init: function () {
      BR.social.onMe(function (m) { if (m && typeof m.medals === 'number') set(m.medals); });
      BR.live.on('hello', function (h) { if (h && h.me && typeof h.me.medals === 'number') set(h.me.medals); });
      BR.live.on('medal', earned);
    },
    set: set,
    ready: function () { return ready; }
  };
})(window.BR = window.BR || {});
