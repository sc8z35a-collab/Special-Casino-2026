/* The login bonus: being logged in at any moment of a day (6:00 to 6:00
   Japan time) counts as a login; the first one of each day pays that day's
   spin tokens (1st..4th day, then over again) and shows the LOGIN BONUS
   board once, with the days received so far framed in grey. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$, $$ = U.$$;

  var queued = null, shown = null, timer = 0, waitTimer = 0, effectTimer = 0, next = 0, epoch = 0, checking = null;

  // waits for the studio logos, sign-up and the story to be out of the way
  function ready() {
    return BR.launch.done() && !BR.account.isOpen() && !BR.launch.maintenance();
  }

  function show(b) {
    if (!b) return;
    var version = epoch;
    queued = b;
    clearTimeout(waitTimer); waitTimer = 0;
    if (!ready()) {
      waitTimer = setTimeout(function () {
        if (version !== epoch || queued !== b) return;
        waitTimer = 0; show(b);
      }, 700);
      return;
    }
    queued = null;
    shown = b;
    clearTimeout(effectTimer);
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
    effectTimer = setTimeout(function () {
      if (version !== epoch || shown !== b) return;
      effectTimer = 0;
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
    var version = epoch;
    timer = setTimeout(function () {
      if (version !== epoch || next !== at) return;
      timer = 0; check();
    }, Math.min(2147483000, Math.max(1000, at - Date.now()) + 2000 + Math.random() * 20000));
  }
  function check() {
    if (checking || !api.hasToken() || BR.launch.maintenance()) return;
    var job = { epoch: epoch }; checking = job;
    api.loginBonus().then(function (r) {
      if (checking !== job || job.epoch !== epoch) return;
      checking = null;
      if (r.me) BR.social.setMe(r.me);
      show(r.loginBonus);
      schedule(r.next);
    }, function () { if (checking === job) checking = null; /* tried again when the app comes back */ });
  }

  function reset() {
    epoch++;
    clearTimeout(timer); clearTimeout(waitTimer); clearTimeout(effectTimer);
    timer = waitTimer = effectTimer = next = 0;
    queued = shown = checking = null;
    K.closeModal('bonus');
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
    reset: reset,
    // the board is up, or waiting to come up
    busy: function () { return !!queued || K.isOpen('bonus'); }
  };
})(window.BR = window.BR || {});
