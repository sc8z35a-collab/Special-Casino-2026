/* Dev News (a tab of the menu: what each update brought, js/game/news.js),
   the reminder on the slot screen when the game is out of date
   (「アップデートしてくださいね。」) and the thank-you money ($) for players
   who updated, shown with what is new. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx;
  var SEEN = 'blockbuster-reels/news-seen';

  var outdated = false;   // the server or this device has a newer game

  function seen() { try { return Number(localStorage.getItem(SEEN)) || 0; } catch (e) { return 0; } }
  function renderDot() { $('#news-dot').hidden = seen() >= BR.RELEASE; }

  function entryEl(n) {
    var box = el('article', 'news-entry');
    var head = el('div', 'news-head');
    head.appendChild(el('span', 'news-date', n.date.replace(/-/g, '/')));
    head.appendChild(el('h3', 'news-title', n.title));
    box.appendChild(head);
    var ul = el('ul', 'news-items');
    n.items.forEach(function (t) { ul.appendChild(el('li', '', t)); });
    box.appendChild(ul);
    return box;
  }

  function show() {
    var list = $('#news-list');
    list.textContent = '';
    BR.NEWS.forEach(function (n) { list.appendChild(entryEl(n)); });
    try { localStorage.setItem(SEEN, String(BR.RELEASE)); } catch (e) { /* the dot comes back next time */ }
    renderDot();
  }

  /* ------------------------------------------------------------ updates --- */
  function remind(on) {
    outdated = outdated || !!on;
    $('#update-note').hidden = !outdated;
  }

  // Tells the server which release this game is: an older one gets the
  // reminder, the first run of a new one the thank-you money.
  function checkRelease() {
    if (!api.online) return;
    api.release(BR.RELEASE).then(function (r) {
      if (r.outdated) { remind(true); return; }
      // the money flies in with the thank-you, not before it
      if (r.bonus > 0 && BR.juice) BR.juice.hold('dollars', r.bonus);
      if (r.me) {
        BR.social.setMe(r.me);
        BR.app.serverBalance(r.me);
      }
      if (r.bonus > 0) thank(r.bonus, r.updates || 1);
    }, function () { /* tried again at the next start */ });
  }

  // `updates`: how many releases the money is for. Several at once pay that
  // many times over, and the box (which scrolls, it never grows) shows what
  // each of them brought.
  function thank(amount, updates) {
    // after the studio logos, the story and the login bonus, not on top of them
    var L = BR.launch;
    if (!L.done() || L.introPlaying() || L.maintenance() || BR.account.isOpen() || BR.bonus.busy()) {
      setTimeout(function () { thank(amount, updates); }, 700);
      return;
    }
    $('#thanks-amt').textContent = U.fmt(amount);
    $('#thanks-sub').textContent = updates > 1
      ? 'アップデート' + updates + '回分（$' + U.fmt(amount / updates) + ' × ' + updates + '）の感謝料をお受け取りください'
      : '感謝料をお受け取りください';
    var box = $('#thanks-news');
    box.textContent = '';
    var missed = BR.NEWS.filter(function (n) { return n.id > BR.RELEASE - updates; });
    (missed.length ? missed : BR.NEWS.slice(0, 1)).forEach(function (n) { box.appendChild(entryEl(n)); });
    box.scrollTop = 0;
    K.showModal('thanks');
    sfx('purchase');
    // the money bursts out of the amount and rains down, then flies into the wallet
    setTimeout(function () {
      var J = BR.juice;
      if (!J || !K.isOpen('thanks')) return;
      J.reward('#thanks-amt', 3);
      J.rain({ pic: 'dollar', dur: 1.6, rate: 22 + Math.min(30, updates * 8) });
      J.payout('dollars', amount, '#thanks-amt');
    }, 700);
    try { localStorage.setItem(SEEN, String(BR.RELEASE)); } catch (e) { /* ignore */ }
    renderDot();
  }

  function init() {
    renderDot();
    K.registerModal('thanks');
    K.dragScroll($('#thanks-news'));
    $('#thanks-ok').addEventListener('click', function () { sfx('click'); K.closeModal('thanks'); });
    $('#update-note-go').addEventListener('click', function () {
      if (BR.install && BR.install.update) { BR.install.update(); return; }
      sfx('click');
      location.reload();
    });
  }

  BR.news = {
    init: init,
    show: show,
    remind: remind,
    checkRelease: checkRelease,
    // the server's newest release (me.release): newer than this game -> update
    serverRelease: function (n) { if (typeof n === 'number' && n > BR.RELEASE) remind(true); }
  };
})(window.BR = window.BR || {});
