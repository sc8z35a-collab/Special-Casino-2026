/* 画面を見る: watching a friend's slot live. The reels, the wins and the
   wallet on the slot screen follow the friend's spins (sent by the server as
   live "watch" events) until one stops watching. Players also see when
   someone is watching them. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var sfx = K.sfx, toast = K.toast;

  var state = null;        // { user } while watching
  var watchers = {};       // id -> { id, name, avatar } of players watching me

  function renderBar() {
    var bar = $('#watch-bar');
    $('#screen-slot').classList.toggle('watching', !!state);
    if (!state) { bar.hidden = true; return; }
    bar.hidden = false;
    var old = $('#watch-avatar');
    var av = K.avatarEl(state.user, 'sm');
    av.id = 'watch-avatar';
    old.parentNode.replaceChild(av, old);
    $('#watch-name').textContent = state.user.name;
  }

  function start(user) {
    if (!user) return;
    if (state && state.user.id === user.id) { BR.screens.show('slot'); return; }
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです'); return; }
    if (BR.game.busy()) { sfx('deny'); toast('スピンが終わってからお試しください'); return; }
    api.watch(user.id, true).then(function (r) {
      K.closeModals();
      state = { user: r.user };
      BR.screens.show('slot');
      BR.app.watchEnter(r.user, r.balance, r.last);
      renderBar();
      sfx('notify');
      toast(r.user.name + 'さんの画面を見ています', 2600);
    }, K.fail);
  }

  // `quiet`: the server already knows (signed out, friend left)
  function stop(quiet, message) {
    if (!state) return;
    var id = state.user.id;
    state = null;
    if (!quiet) api.watch(id, false).catch(function () {});
    BR.app.watchExit();
    renderBar();
    if (message) toast(message, 3200);
  }

  function renderWatchers() {
    var list = Object.keys(watchers).map(function (k) { return watchers[k]; });
    var box = $('#watched-by');
    box.hidden = !list.length;
    $('#watched-count').textContent = list.length > 1 ? list.length + '人が観戦中' : list.length ? list[0].name + 'さんが観戦中' : '';
  }

  function onWatch(ev) {
    if (ev.type === 'watched') {
      if (!ev.by) return;
      if (ev.on) {
        var isNew = !watchers[ev.by.id];
        watchers[ev.by.id] = ev.by;
        if (isNew) { sfx('notify'); toast(ev.by.name + 'さんがあなたの画面を見ています', 3000); }
      } else {
        delete watchers[ev.by.id];
      }
      renderWatchers();
      return;
    }
    if (!state || ev.user !== state.user.id) return;
    if (ev.type === 'spin') BR.app.watchSpin(ev.result, ev.balance);
    else if (ev.type === 'balance') BR.app.watchBalance(ev.balance);
    else if (ev.type === 'offline') stop(true, state.user.name + 'さんがオフラインになったので観戦を終了しました');
  }

  function init() {
    $('#watch-stop').addEventListener('click', function () { sfx('click'); stop(false); });
    BR.screens.register('slot', {
      back: function () {
        if (!state) return false;
        stop(false);
        return true;
      }
    });
    if (!api.online) return;
    BR.live.on('watch', onWatch);
    // the server forgets watchers whose connection dropped: carry on after a reconnect
    BR.live.on('hello', function () {
      watchers = {};
      renderWatchers();
      api.watchers().then(function (r) {
        r.watchers.forEach(function (w) { watchers[w.id] = w; });
        renderWatchers();
      }, function () {});
      if (!state) return;
      var id = state.user.id;
      api.watch(id, true).then(function (r) {
        if (state && state.user.id === id) BR.app.watchBalance(r.balance);
      }, function () { stop(true, '観戦を続けられませんでした'); });
    });
  }

  BR.watch = {
    init: init,
    start: start,
    stop: stop,
    active: function () { return !!state; }
  };
})(window.BR = window.BR || {});
