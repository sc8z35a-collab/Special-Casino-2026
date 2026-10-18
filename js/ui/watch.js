/* 稼ぎに参加: watching a friend's slot live, which also puts one in their
   "home": everyone watching the same player (up to 10) talks together in the
   home call. The reels, the wins and the wallet on the slot screen follow the
   friend's spins (live "watch" events) until one stops watching. Watchers
   can throw fruits at the friend: spin tokens from their own wallet
   (ストロベリー 1 000, スイカ 2 000, メロン 5 000), sent with a single tap.
   Players also see who is watching them, and can ask a friend over
   (稼ぎに参加要請). */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, S = BR.store.state;
  var $ = U.$, $$ = U.$$;
  var el = K.el, sfx = K.sfx, toast = K.toast;

  var state = null;        // { user, members: { id: user } } while watching
  var watchers = {};       // id -> { id, name, avatar } of players watching me
  var offerFrom = null;    // the friend whose 参加要請 is on screen
  var offerTimer = 0;

  function fruitInfo(id) {
    var list = BR.CONFIG.fruits;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function renderBar() {
    var bar = $('#watch-bar');
    $('#screen-slot').classList.toggle('watching', !!state);
    $('#stage').classList.toggle('watching', !!state);
    $('#fruit-tray').hidden = !state;
    if (!state) { bar.hidden = true; return; }
    bar.hidden = false;
    var old = $('#watch-avatar');
    var av = K.avatarEl(state.user, 'sm');
    av.id = 'watch-avatar';
    old.parentNode.replaceChild(av, old);
    $('#watch-name').textContent = state.user.name;
    renderMine();
  }
  function renderMine() {
    if (state) $('#fruit-mine').textContent = '手持ち ' + U.fmt(Math.max(0, S.tokens - pendingCost()));
  }

  function start(user) {
    if (!user) return;
    if (state && state.user.id === user.id) { BR.screens.show('slot'); return; }
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです'); return; }
    if (BR.game.busy()) { sfx('deny'); toast('スピンが終わってからお試しください'); return; }
    api.watch(user.id, true).then(function (r) {
      K.closeModals();
      flushTips();
      state = { user: r.user, members: {} };
      (r.members || []).forEach(function (m) { state.members[m.id] = m; });
      BR.screens.show('slot');
      BR.app.watchEnter(r.user, r.balance, r.last);
      BR.shop.watchedCharm(!!r.charm);
      renderBar();
      sfx('notify');
      var n = Object.keys(state.members).length;
      toast(r.user.name + 'さんの稼ぎに参加しました' + (n ? '（ほかに' + n + '人）' : '') + '・ホーム通話中', 3000);
      // the home's voice call
      BR.call.homeEnter(r.user.id, r.user, r.members || []);
    }, K.fail);
  }

  // `quiet`: the server already knows (signed out, friend left)
  function stop(quiet, message) {
    if (!state) return;
    var id = state.user.id;
    flushTips();
    state = null;
    // goodbyes to the home call first, while still in the home
    BR.call.homeLeave();
    if (!quiet) api.watch(id, false).catch(function () {});
    BR.app.watchExit();
    BR.shop.watchedCharm(false);
    renderBar();
    if (message) toast(message, 3200);
    // back home: my own watchers' call, if there are any
    syncHome();
  }

  /* ------------------------------------------------------------ my own home --- */
  function renderWatchers() {
    var list = Object.keys(watchers).map(function (k) { return watchers[k]; });
    var box = $('#watched-by');
    box.hidden = !list.length;
    $('#watched-count').textContent = list.length > 1 ? list.length + '人が稼ぎに参加中' : list.length ? list[0].name + 'さんが稼ぎに参加中' : '';
  }
  // my home call follows who is watching me
  function syncHome() {
    var list = Object.keys(watchers).map(function (k) { return watchers[k]; });
    var me = BR.social.me();
    if (state || !me) return;
    if (!list.length) { if (BR.call.homeRoom() === me.id) BR.call.homeLeave(); return; }
    if (BR.call.homeRoom() !== me.id) BR.call.homeEnter(me.id, me, list);
  }

  /* ------------------------------------------------------------ fruits --- */
  var tips = { to: 0, fruits: {}, timer: 0 };
  function pendingCost() {
    var n = 0;
    Object.keys(tips.fruits).forEach(function (k) { n += tips.fruits[k] * fruitInfo(k).tokens; });
    return n;
  }
  function throwFruit(id, btn) {
    if (!state) return;
    var f = fruitInfo(id);
    if (S.tokens - pendingCost() < f.tokens) {
      sfx('deny');
      toast('スピントークンが足りません（' + f.name + 'は ' + U.fmt(f.tokens) + ' トークン）');
      return;
    }
    if (tips.to !== state.user.id) { flushTips(); tips.to = state.user.id; }
    tips.fruits[id] = (tips.fruits[id] || 0) + 1;
    sfx('fruit');
    flyFrom(btn, id);
    renderMine();
    // taps in quick succession go out together
    clearTimeout(tips.timer);
    tips.timer = setTimeout(flushTips, 350);
  }
  function flushTips() {
    clearTimeout(tips.timer);
    var fruits = tips.fruits, to = tips.to;
    tips.fruits = {};
    if (!to || !Object.keys(fruits).length) return;
    api.tip(to, fruits).then(function (r) {
      BR.bank.applyBalance(r.balance);
      renderMine();
    }, function (err) {
      renderMine();
      K.fail(err);
    });
  }

  // a fruit flies from the tray button to the reels
  function flyFrom(btn, id) {
    var layer = $('#fruit-layer');
    var stage = $('#stage').getBoundingClientRect();
    var b = btn.getBoundingClientRect();
    var s = BR.app.view.s, rot = BR.app.view.portrait;
    var x = rot ? (b.top + b.height / 2 - stage.top) / s : (b.left + b.width / 2 - stage.left) / s;
    var y = rot ? (stage.right - (b.left + b.width / 2)) / s : (b.top + b.height / 2 - stage.top) / s;
    var f = el('i', 'fruit-fly toss ' + id);
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    f.style.setProperty('--dx', (1000 - x + (Math.random() * 300 - 150)) + 'px');
    f.style.setProperty('--dy', (420 - y + (Math.random() * 160 - 80)) + 'px');
    layer.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1100);
  }

  // fruits raining down on the screen of the one they were thrown at
  function rain(fruits) {
    var layer = $('#fruit-layer');
    var list = [];
    Object.keys(fruits).forEach(function (k) { for (var i = 0; i < Math.min(fruits[k], 12); i++) list.push(k); });
    list.slice(0, 24).forEach(function (k, i) {
      setTimeout(function () {
        var f = el('i', 'fruit-fly drop ' + k);
        f.style.left = (520 + Math.random() * 960) + 'px';
        f.style.top = '-140px';
        f.style.setProperty('--r', (Math.random() * 120 - 60) + 'deg');
        layer.appendChild(f);
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 1700);
      }, i * 90);
    });
  }
  function fruitText(fruits) {
    return Object.keys(fruits).map(function (k) { return fruitInfo(k).name + '×' + fruits[k]; }).join('・');
  }
  function onTip(t) {
    // thrown at me
    sfx('fruit');
    setTimeout(function () { sfx('purchase'); }, 200);
    if (BR.screens.current() === 'slot') rain(t.fruits);
    toast(t.from.name + 'さんから ' + fruitText(t.fruits) + '（+' + U.fmt(t.amount) + ' トークン）', 3400);
  }

  /* ------------------------------------------------------------ 稼ぎに参加要請 --- */
  function askOver(user) {
    if (!user) return;
    if (state) { sfx('deny'); toast('観戦中は参加要請を送れません'); return; }
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです'); return; }
    api.homeInvite(user.id).then(function () {
      sfx('send');
      toast(user.name + 'さんに稼ぎに参加要請を送りました', 3000);
    }, K.fail);
  }
  // the card: a friend asks me over (or their call moved to their home)
  function offer(from, why) {
    if (!from || (state && state.user.id === from.id)) return;
    offerFrom = { id: from.id, name: from.name, avatar: from.avatar, online: true };
    var old = $('#home-in-avatar');
    var av = K.avatarEl(offerFrom, 'big');
    av.id = 'home-in-avatar';
    old.parentNode.replaceChild(av, old);
    $('#home-in-name').textContent = from.name;
    $('#home-in-what').textContent = why === 'moved' ? '通話がホーム通話になりました。参加しますか？' : '稼ぎに参加要請が届きました！';
    $('#home-in').hidden = false;
    sfx('ring');
    clearTimeout(offerTimer);
    offerTimer = setTimeout(closeOffer, 30000);
  }
  function closeOffer() {
    clearTimeout(offerTimer);
    offerFrom = null;
    $('#home-in').hidden = true;
  }

  function onWatch(ev) {
    if (ev.type === 'watched') {
      if (!ev.by) return;
      if (ev.on) {
        var isNew = !watchers[ev.by.id];
        watchers[ev.by.id] = ev.by;
        if (isNew) { sfx('notify'); toast(ev.by.name + 'さんがあなたの稼ぎに参加しました（ホーム通話）', 3000); }
      } else {
        delete watchers[ev.by.id];
      }
      renderWatchers();
      if (BR.call.homeRoom() === (BR.social.me() || {}).id) BR.call.homeMember(ev.by, ev.on);
      syncHome();
      return;
    }
    if (!state || ev.user !== state.user.id) return;
    if (ev.type === 'spin') BR.app.watchSpin(ev.result, ev.balance);
    else if (ev.type === 'balance') BR.app.watchBalance(ev.balance);
    else if (ev.type === 'charm') BR.shop.watchedCharm(ev.on);
    else if (ev.type === 'tip') rain(ev.fruits);
    else if (ev.type === 'member') {
      if (ev.on) state.members[ev.by.id] = ev.by; else delete state.members[ev.by.id];
      BR.call.homeMember(ev.by, ev.on);
    } else if (ev.type === 'offline') stop(true, state.user.name + 'さんがオフラインになったのでホームを出ました');
  }

  function init() {
    $('#watch-stop').addEventListener('click', function () { sfx('click'); stop(false); });
    $$('#fruit-tray .fruit-btn').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { throwFruit(b.dataset.fruit, b); });
    });
    $('#home-yes').addEventListener('click', function () {
      sfx('click');
      var u = offerFrom;
      closeOffer();
      if (u) start(u);
    });
    $('#home-no').addEventListener('click', function () { sfx('click'); closeOffer(); });
    BR.screens.register('slot', {
      back: function () {
        if (!state) return false;
        stop(false);
        return true;
      }
    });
    if (!api.online) return;
    BR.live.on('watch', onWatch);
    BR.live.on('tip', onTip);
    BR.live.on('home', function (ev) { if (ev.type === 'invite' && ev.from) offer(ev.from, 'invite'); });
    BR.live.on('balance', function () { renderMine(); });
    // the server forgets watchers whose connection dropped: carry on after a reconnect
    BR.live.on('hello', function () {
      watchers = {};
      renderWatchers();
      api.watchers().then(function (r) {
        r.watchers.forEach(function (w) { watchers[w.id] = w; });
        renderWatchers();
        syncHome();
      }, function () {});
      if (!state) return;
      var id = state.user.id;
      api.watch(id, true).then(function (r) {
        if (!state || state.user.id !== id) return;
        BR.app.watchBalance(r.balance);
        state.members = {};
        (r.members || []).forEach(function (m) { state.members[m.id] = m; });
        BR.call.homeEnter(id, r.user, r.members || []);
      }, function () { stop(true, '観戦を続けられませんでした'); });
    });
  }

  BR.watch = {
    init: init,
    start: start,
    stop: stop,
    askOver: askOver,
    offer: offer,
    active: function () { return !!state; },
    target: function () { return state ? state.user : null; }
  };
})(window.BR = window.BR || {});
