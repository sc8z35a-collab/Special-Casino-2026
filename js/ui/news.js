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
  var latest = 0;         // the newest release the server knows (DEV number)
  var released = {};      // DEV number -> when it went live (ms, from the server)

  function seen() { try { return Number(localStorage.getItem(SEEN)) || 0; } catch (e) { return 0; } }
  function renderDot() { $('#news-dot').hidden = $('#news-card-dot').hidden = seen() >= BR.RELEASE; }

  // the release number as the players know it: DEV5, S2 DEV1 (js/game/news.js phases)
  function devName(id) { return BR.releaseName ? BR.releaseName(id) : 'DEV' + id; }
  // when it came: "2026/10/20 10:25" (Japan time): the moment the server
  // started with it if known, else the date and time written in the news
  function when(n) {
    var at = released[n.id];
    if (at) {
      var d = new Date(at + 9 * 3600000), p = function (v) { return (v < 10 ? '0' : '') + v; };
      return d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    }
    return n.date.replace(/-/g, '/') + (n.time ? ' ' + n.time : '');
  }
  function devBadge(id) {
    var b = el('span', 'news-dev'), part = BR.releasePart ? BR.releasePart(id) : { phase: '', n: id };
    b.setAttribute('aria-label', devName(id));
    // (a phase's releases carry its name before the DEV mark: S2 [DEV] 1)
    if (part.phase) b.appendChild(el('b', 'news-phase', part.phase));
    b.appendChild(el('i', 'ic ic-dev'));
    b.appendChild(el('span', '', part.n));
    return b;
  }
  function entryEl(n) {
    var box = el('article', 'news-entry' + (n.id === BR.RELEASE ? ' current' : ''));
    var head = el('div', 'news-head');
    head.appendChild(devBadge(n.id));
    head.appendChild(el('span', 'news-date', when(n)));
    head.appendChild(el('h3', 'news-title', n.title));
    box.appendChild(head);
    var ul = el('ul', 'news-items');
    n.items.forEach(function (t) { ul.appendChild(el('li', '', t)); });
    box.appendChild(ul);
    return box;
  }

  function show() {
    if (!BR.NEWS) return BR.resources.load('news').then(show, K.fail);
    var list = $('#news-list');
    list.textContent = '';
    // which one this game is (and that a newer one is out)
    var ver = el('div', 'news-version');
    ver.appendChild(devBadge(BR.RELEASE));
    if (latest > BR.RELEASE) {
      var up = el('button', 'mini-btn gold news-update');
      up.type = 'button';
      up.appendChild(el('span', '', devName(latest) + ' にアップデート'));
      up.addEventListener('click', update);
      ver.appendChild(up);
    }
    list.appendChild(ver);
    BR.NEWS.forEach(function (n) { list.appendChild(entryEl(n)); });
    try { localStorage.setItem(SEEN, String(BR.RELEASE)); } catch (e) { /* the dot comes back next time */ }
    renderDot();
  }

  /* ------------------------------------------------------------ updates --- */
  function remind(on, release) {
    var was = outdated;
    outdated = outdated || !!on;
    if (outdated && !was && BR.install && BR.install.outdated) BR.install.outdated();
    if (release > latest) latest = release;
    paintNote();
  }
  // a newer Android app (js/ui/install.js): the same note with its own words, so the update can be started from the slot screen
  var appText = '';
  function appNew(text) { appText = text || ''; paintNote(); }
  function paintNote() {
    $('#update-note').hidden = !outdated && !appText;
    if (outdated && latest > BR.RELEASE) $('#update-note-text').textContent = '新しいバージョン（' + devName(latest) + '）があります';
    else if (!outdated) $('#update-note-text').textContent = appText;
  }
  // one tap: the newest game right away (the web page and the app alike)
  function update() {
    sfx('click');
    if (BR.install && BR.install.update) BR.install.update();
    else location.reload();
  }

  // Tells the server which release this game is: an older one gets the
  // reminder, the first run of a new one the thank-you money (it arrives
  // with the tap on the thanks, and waits there until then).
  var owed = 0, claimingBonus = false;
  function checkRelease() {
    if (!api.online) return;
    api.release(BR.RELEASE).then(function (r) {
      if (r.released) released = r.released;
      if (r.outdated) { remind(true, r.release); return; }
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
    if (!BR.NEWS) return BR.resources.load('news').then(function () { thank(amount, updates); }, K.fail);
    // after the studio logos, the story and the login bonus, not on top of them
    var L = BR.launch;
    if (!L.done() || L.maintenance() || BR.account.isOpen() || BR.bonus.busy()) {
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
    owed = amount;
    renderOk();
    K.showModal('thanks');
    sfx('notify');
    try { localStorage.setItem(SEEN, String(BR.RELEASE)); } catch (e) { /* ignore */ }
    renderDot();
  }
  function renderOk() {
    var b = $('#thanks-ok');
    b.disabled = claimingBonus;
    b.textContent = claimingBonus ? '受け取っています…' : owed > 0 ? '受け取る' : 'OK';
  }
  // the tap: the money bursts out of the amount and rains down, then flies into the wallet
  function receive() {
    if (claimingBonus) return;
    if (!(owed > 0)) { K.closeModal('thanks'); return; }
    claimingBonus = true;
    renderOk();
    api.releaseClaim().then(function (r) {
      claimingBonus = false;
      var paid = r.paid || 0, J = BR.juice;
      owed = 0;
      if (paid && J) J.hold('dollars', paid);
      if (r.me) {
        BR.social.setMe(r.me);
        BR.app.serverBalance(r.me);
      }
      renderOk();
      if (!paid) { K.closeModal('thanks'); return; }
      sfx('money');
      if (J) {
        J.reward('#thanks-amt', 3);
        J.rain({ pic: 'dollar', dur: 1.6, rate: 22 + Math.min(30, Math.round(paid / BR.CONFIG.updateBonus) * 8) });
        J.payout('dollars', paid, '#thanks-amt');
      }
      setTimeout(function () { K.closeModal('thanks'); }, 1700);
    }, function (err) {
      claimingBonus = false;
      renderOk();
      K.fail(err);
    });
  }

  function init() {
    renderDot();
    K.registerModal('thanks');
    K.dragScroll($('#thanks-news'));
    $('#thanks-ok').addEventListener('click', function () { sfx('click'); receive(); });
    $('#update-note-go').addEventListener('click', update);
  }

  BR.news = {
    init: init,
    show: show,
    remind: remind,
    appNew: appNew,
    checkRelease: checkRelease,
    // the server's newest release (me.release): newer than this game -> update
    serverRelease: function (n) { if (typeof n === 'number' && n > BR.RELEASE) remind(true, n); },
    devName: devName
  };
})(window.BR = window.BR || {});
