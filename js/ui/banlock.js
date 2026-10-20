/* アクセス禁止 / BAN: the moment an operator bans the account (or a BAN on
   another account of this device shuts it out), the game goes back to the
   title screen and stays there. The notice from the official covers the
   スタート and 友達 buttons: when the player was banned and until when.
   Nothing else opens meanwhile (BR.screens keeps to the title screen). The
   login is kept, so the game asks the server now and then (GET /api/ban) and
   lets the player back in once the ban is lifted or has run out; the
   official bot's messages about it wait in the chat. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;

  var KEY = 'blockbuster-reels/ban';
  var CHECK_MS = 20000;
  var KIND = { suspend: 'アクセス禁止', ban: 'BAN', perma: '永久BAN' };
  var ban = null;          // { code: 'banned' | 'device_banned', kind, at, until, message, notice }
  var timer = 0;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function save(b) {
    try { if (b) localStorage.setItem(KEY, JSON.stringify(b)); else localStorage.removeItem(KEY); } catch (e) { /* this visit only */ }
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // 2026/10/27 12:34 (Japan time, as the server writes it)
  function when(ms) {
    var d = new Date(ms + 9 * 3600000);
    return d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  function render() {
    var device = ban.code === 'device_banned';
    $('#ban-lock-title').textContent = device ? '利用停止中' : (KIND[ban.kind] || '利用停止') + (ban.until ? '中' : '');
    $('#ban-lock-notice').textContent = device ? ban.message : (ban.notice || ban.message || 'このアカウントは利用停止されています').replace('に公式より', 'に\n公式より');
    $('#ban-lock-until').textContent = device ? '' : ban.until ? '期間：' + when(ban.until) + ' まで' : '期間：解除されるまで';
    $('#ban-lock-sub').textContent = '解除されると、自動でまた遊べるようになります。';
    $('#ban-lock-go').hidden = true;
  }

  // Locks the game on the title screen (b: the server's ban state).
  function lock(b) {
    var first = !ban;
    ban = b && b.code ? b : { code: 'banned', message: (b && b.message) || 'このアカウントは利用停止されています' };
    save(ban);
    if (first) {
      // everything stops: calls, watching, the live connection, every dialog (the login stays)
      if (BR.social && BR.social.lockDown) BR.social.lockDown();
      if (BR.account && BR.account.isOpen()) BR.account.close();
      BR.screens.show('start');
      document.documentElement.classList.add('ban-locked');
      K.sfx('deny');
    }
    render();
    $('#ban-lock').hidden = false;
    // (requests refused meanwhile lock it again: the next question stays when it was)
    if (!timer) schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(check, CHECK_MS);
  }
  function check() {
    clearTimeout(timer);
    timer = 0;
    if (!ban) return;
    if (!api.hasToken()) {
      // no login to ask with: a ban with an end opens when its time is up
      if (ban.until && Date.now() >= ban.until) lifted();
      else schedule();
      return;
    }
    api.banState().then(function (r) {
      if (!ban) return;
      if (r.ban) { ban = r.ban; save(ban); render(); schedule(); return; }
      lifted();
    }, function (err) {
      if (err.status === 401) { free(); return; }
      schedule();
    });
  }

  // The ban is over: one tap and the game starts again (signed in as before).
  function lifted() {
    clearTimeout(timer);
    timer = 0;
    ban = null;
    save(null);
    $('#ban-lock-title').textContent = '解除されました';
    $('#ban-lock-notice').textContent = '利用停止が解除されました。また TWO STATE で遊べます！';
    $('#ban-lock-until').textContent = '';
    $('#ban-lock-sub').textContent = 'Ice Smoker公式ボットからのお知らせは、メッセージで見られます。';
    $('#ban-lock-go').hidden = false;
    K.sfx('purchase');
  }
  // The login itself is gone: the title screen as for anyone signed out.
  function free() {
    clearTimeout(timer);
    timer = 0;
    ban = null;
    save(null);
    $('#ban-lock').hidden = true;
    document.documentElement.classList.remove('ban-locked');
  }

  function init() {
    if (!api.online) return;
    $('#ban-lock-go').addEventListener('click', function () {
      K.sfx('click');
      location.reload();
    });
    // a phone back in front: ask now
    document.addEventListener('visibilitychange', function () { if (!document.hidden && ban) check(); });
    // locked when the game was closed: locked again before anything else shows
    var b = load();
    if (b) {
      lock(b);
      check();
    }
  }

  BR.banlock = {
    init: init,
    lock: lock,
    active: function () { return !!ban; }
  };
})(window.BR = window.BR || {});
