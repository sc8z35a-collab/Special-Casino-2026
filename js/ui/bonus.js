/* The login bonus: being logged in at any moment of a day (6:00 to 6:00
   Japan time) counts as a login; the first one of each day pays that day's
   spin tokens (1st..4th day, then over again) and shows the LOGIN BONUS
   board once, with the days received so far framed in grey. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$, $$ = U.$$;

  var queued = null, timer = 0, next = 0;

  // waits for the studio logos, sign-up and the story to be out of the way
  function ready() {
    return BR.launch.done() && !BR.account.isOpen() && !BR.launch.maintenance();
  }

  function show(b) {
    if (!b) return;
    queued = b;
    if (!ready()) { setTimeout(function () { if (queued === b) show(b); }, 700); return; }
    queued = null;
    $$('#bonus .bonus-day').forEach(function (t) {
      var d = Number(t.dataset.day);
      t.classList.toggle('got', d <= b.day);
      t.classList.toggle('today', d === b.day);
    });
    $('#bonus-text').textContent = 'ログイン' + b.day + '日目！ スピントークン ' + U.fmt(b.amount) + ' を受け取りました';
    K.showModal('bonus');
    K.sfx('money');
    // once the board has landed, today's chips burst out of their card and
    // fly into the wallet (js/render/juice.js)
    var today = $('#bonus .bonus-day.today');
    setTimeout(function () {
      var J = BR.juice;
      if (J && K.isOpen('bonus')) {
        J.reward(today, 3);
        J.rain({ pic: 'chip', dur: 1.2, rate: 24 });
      }
      BR.app.renderWallet(true);
      if (J && K.isOpen('bonus')) J.payout('tokens', b.amount, today);
    }, 650);
  }

  // the day turns at 6:00 Japan time: still here, so that day counts too
  function schedule(at) {
    if (!(at > 0)) return;
    next = at;
    clearTimeout(timer);
    timer = setTimeout(check, Math.min(2147483000, Math.max(1000, at - Date.now()) + 2000 + Math.random() * 20000));
  }
  function check() {
    if (!api.hasToken() || BR.launch.maintenance()) return;
    api.loginBonus().then(function (r) {
      if (r.me) BR.social.setMe(r.me);
      show(r.loginBonus);
      schedule(r.next);
    }, function () { /* tried again when the app comes back */ });
  }

  function init() {
    K.registerModal('bonus');
    if (BR.SOCIAL_IMG.loginBonus) $('#bonus-board').style.backgroundImage = 'url("' + BR.SOCIAL_IMG.loginBonus + '")';
    $('#bonus-ok').addEventListener('click', function () { K.sfx('click'); K.closeModal('bonus'); });
    if (!api.online) return;
    BR.live.on('hello', function (h) { show(h.loginBonus); schedule(h.loginReset); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && next && Date.now() >= next) check();
    });
  }

  BR.bonus = {
    init: init,
    show: show,
    schedule: schedule,
    // the board is up, or waiting to come up
    busy: function () { return !!queued || K.isOpen('bonus'); }
  };
})(window.BR = window.BR || {});
