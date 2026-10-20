/* 観戦 (稼ぎに参加): watching a friend's slot live, which puts one in their
   "home". The reels, the wins and the wallet on the slot screen follow the
   friend's spins (live "watch" events) until one stops watching. Watchers can
   throw fruits at the friend (spin tokens from their own wallet: ストロベリー
   1 000, スイカ 2 000, メロン 5 000) and chat with everyone in the home on
   the spot. Nobody talks at first: the watched player sees who is watching
   and picks the ones they talk with (js/net/call.js); 観戦ベット lives in
   js/ui/play.js. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, S = BR.store.state;
  var $ = U.$, $$ = U.$$;
  var el = K.el, sfx = K.sfx, toast = K.toast;

  var state = null;        // watching: { user, members: { id: user (+ voice) }, voice: [ids] }
  var watchers = {};       // my own home: id -> { id, name, avatar, voice }
  var chat = { room: 0, list: [], ids: {} };   // the chat of the home I am in
  var CHAT_KEEP = 30;

  function me() { return BR.social.me(); }
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
    $('#watch-tools').hidden = !state;
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

  // the people of a home as a map (for the voice)
  function people(list) {
    var out = {};
    list.forEach(function (u) { out[u.id] = u; });
    return out;
  }

  function start(user) {
    if (!user) return;
    if (state && state.user.id === user.id) { BR.screens.show('slot'); return; }
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです'); return; }
    if (BR.game.busy()) { sfx('deny'); toast('スピンが終わってからお試しください'); return; }
    if (state) stop(false);
    api.watch(user.id, true).then(function (r) {
      K.closeModals();
      flushTips();
      // my own home's voice ends while I am somewhere else
      if (BR.call.room() && BR.call.room() !== r.user.id) BR.call.leave();
      enter(r);
      BR.screens.show('slot');
      BR.app.watchEnter(r.user, r.balance, r.last);
      BR.shop.watchedCharm(!!r.charm);
      sfx('notify');
      var n = Object.keys(state.members).length;
      toast(r.user.name + 'さんの観戦を始めました' + (n ? '（ほかに' + n + '人）' : ''), 3400);
      if (BR.play && BR.play.watchStart) BR.play.watchStart(r);
    }, K.fail);
  }

  // the watch response (also after a reconnect): who is here, who talks, the chat so far
  function enter(r) {
    state = { user: r.user, members: {}, voice: [] };
    (r.members || []).forEach(function (m) {
      state.members[m.id] = m;
      if (m.voice) state.voice.push(m.id);
    });
    var my = me();
    if (r.voice && my) state.voice.push(my.id);
    setChat(r.user.id, r.chat || []);
    renderBar();
    syncVoice();
  }

  // the voice of the home I watch
  function syncVoice() {
    if (!state) return;
    var map = people(Object.keys(state.members).map(function (k) { return state.members[k]; }));
    BR.call.sync(state.user.id, state.user, state.voice, map);
  }

  // `quiet`: the server already knows (signed out, friend left)
  function stop(quiet, message) {
    if (!state) return;
    var id = state.user.id;
    flushTips();
    state = null;
    if (BR.call.room() === id) BR.call.leave();
    if (!quiet) api.watch(id, false).catch(function () {});
    BR.app.watchExit();
    BR.shop.watchedCharm(false);
    if (BR.play && BR.play.watchStop) BR.play.watchStop();
    if (chat.room === id) setChat(0, []);
    if (BR.entry.isOpen() && chatOpen) BR.entry.close();
    renderBar();
    if (message) toast(message, 3200);
    // back home: my own home (its chat and its voice) if people watch me
    syncHome();
  }

  /* ------------------------------------------------------------ my own home --- */
  function watcherList() { return Object.keys(watchers).map(function (k) { return watchers[k]; }); }
  function voiceList() { return watcherList().filter(function (w) { return w.voice; }).map(function (w) { return w.id; }); }

  function renderWatchers() {
    var list = watcherList();
    var box = $('#watched-by');
    box.hidden = !list.length;
    $('#watched-count').textContent = list.length > 1 ? list.length + '人が観戦中' : list.length ? list[0].name + 'さんが観戦中' : '';
    var talk = voiceList().length;
    var t = $('#watched-talk');
    t.hidden = !talk;
    t.textContent = talk ? '通話 ' + talk + '人' : '';
    if (K.isOpen('home-panel')) renderPanel();
  }
  // my home's voice and chat follow who is watching me (not while I watch someone)
  function syncHome() {
    var my = me();
    if (state || !my) return;
    if (!watcherList().length) {
      if (BR.call.room() === my.id) BR.call.leave();
      if (chat.room === my.id) setChat(0, []);
      return;
    }
    if (chat.room !== my.id) setChat(my.id, []);
    BR.call.sync(my.id, my, voiceList(), people(watcherList()));
  }

  // the panel: everyone watching me, and whether I talk with them
  function renderPanel() {
    var list = $('#hp-list');
    list.textContent = '';
    var ws = watcherList();
    if (!ws.length) list.appendChild(el('div', 'hp-empty', '今は誰も観戦していません'));
    ws.forEach(function (w) {
      var row = el('div', 'hp-row' + (w.voice ? ' on' : ''));
      row.dataset.uid = w.id;
      row.appendChild(K.avatarEl(w, 'sm'));
      var id = el('div', 'hp-id');
      id.appendChild(el('span', 'hp-name uname', w.name));
      id.appendChild(el('span', 'hp-state', w.voice ? '通話中（話しています）' : '観戦中（マイクはオフ）'));
      row.appendChild(id);
      var b = el('button', 'act-btn' + (w.voice ? '' : ' gold'));
      b.type = 'button';
      b.dataset.voice = w.voice ? 'off' : 'on';
      b.appendChild(K.icon(w.voice ? 'hangup' : 'phone'));
      b.appendChild(el('span', '', w.voice ? '話すのをやめる' : 'この人と話す'));
      row.appendChild(b);
      list.appendChild(row);
    });
  }
  function openPanel() {
    renderPanel();
    K.showModal('home-panel');
  }
  // the watched player picks (or drops) someone to talk with; their own microphone goes on with it
  function setVoice(id, on) {
    var my = me();
    return api.voice(id, on).then(function (r) {
      Object.keys(watchers).forEach(function (k) { watchers[k].voice = r.voice.indexOf(Number(k)) >= 0; });
      renderWatchers();
      if (state || !my) return;
      BR.call.sync(my.id, my, r.voice, people(watcherList()), { mic: on });
    }, K.fail);
  }
  // the hang-up button of the call bar
  function endVoice() {
    var my = me();
    if (!my) { BR.call.leave(); return; }
    if (state) {
      api.voice(my.id, false).catch(function () {});
      state.voice = state.voice.filter(function (id) { return id !== my.id; });
      BR.call.leave();
      return;
    }
    voiceList().forEach(function (id) { api.voice(id, false).catch(function () {}); watchers[id].voice = false; });
    renderWatchers();
    BR.call.leave();
  }

  /* ------------------------------------------------------------ the home chat --- */
  var chatOpen = false, chatFeed = null;
  function setChat(room, list) {
    chat = { room: room, list: [], ids: {} };
    list.forEach(addChat);
    $('#home-chat').textContent = '';
    if (chatFeed) renderFeed();
  }
  function addChat(m) {
    if (!m || chat.ids[m.id]) return false;
    chat.ids[m.id] = true;
    chat.list.push(m);
    if (chat.list.length > CHAT_KEEP) chat.list.splice(0, chat.list.length - CHAT_KEEP).forEach(function (x) { delete chat.ids[x.id]; });
    return true;
  }
  function lineEl(m) {
    var my = me();
    var mine = !!(my && m.from && m.from.id === my.id);
    var row = el('div', 'msg ' + (mine ? 'mine' : 'theirs'));
    if (!mine) {
      var who = el('div', 'msg-name');
      who.appendChild(K.avatarEl(m.from, 'xs'));
      who.appendChild(el('span', 'uname', m.from.name || '?'));
      row.appendChild(who);
    }
    row.appendChild(el('div', 'bubble', m.text));
    row.appendChild(el('span', 'msg-time', K.fmtTime(m.at)));
    return row;
  }
  function renderFeed() {
    if (!chatFeed) return;
    chatFeed.textContent = '';
    if (!chat.list.length) chatFeed.appendChild(el('div', 'empty chat-empty', 'ホームのみんなにメッセージ（保存されません）'));
    chat.list.forEach(function (m) { chatFeed.appendChild(lineEl(m)); });
    var f = $('#entry-feed');
    f.scrollTop = f.scrollHeight;
  }
  // a line floats over the slot screen for a while
  function float(m) {
    var box = $('#home-chat');
    var b = el('button', 'hc-line');
    b.type = 'button';
    b.appendChild(K.avatarEl(m.from, 'xs'));
    var t = el('span', 'hc-text');
    t.appendChild(el('b', 'uname', m.from.name || '?'));
    t.appendChild(document.createTextNode(K.clip(m.text, 40)));
    b.appendChild(t);
    box.appendChild(b);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(function () { b.classList.add('out'); }, 9000);
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 9600);
  }
  function openChat() {
    var room = chat.room;
    if (!room) { sfx('deny'); return; }
    chatFeed = el('div', 'chat-list home-feed');
    renderFeed();
    chatOpen = true;
    BR.entry.open({
      title: 'ホームチャット',
      max: 200,
      placeholder: state ? 'ホームのみんなにメッセージ' : '観戦している人たちにメッセージ',
      feed: chatFeed,
      rule: true,
      onSubmit: function (text) {
        return api.homeChat(room, text).then(function (r) {
          sfx('send');
          if (chat.room === room && addChat(r.message)) renderFeed();
        });
      },
      onClose: function () { chatOpen = false; chatFeed = null; }
    });
  }
  function onHomeChat(m) {
    if (!m || m.room !== chat.room) return;
    if (!addChat(m)) return;
    var my = me();
    var mine = !!(my && m.from && m.from.id === my.id);
    if (chatOpen) { renderFeed(); if (!mine) sfx('message'); return; }
    if (mine) return;
    if (BR.screens.current() === 'slot') { float(m); sfx('message'); return; }
    sfx('message');
    toast('ホーム ' + K.clip(m.from.name, 10) + ': ' + K.clip(m.text, 22), 3400, function () {
      BR.screens.show('slot');
      openChat();
    });
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
    setTimeout(function () { sfx('money'); }, 200);
    if (BR.screens.current() === 'slot') rain(t.fruits);
    toast(t.from.name + 'さんから ' + fruitText(t.fruits) + '（+' + U.fmt(t.amount) + ' トークン）', 3400);
    if (BR.juice) BR.juice.reward('#toast', 2);
  }

  /* ------------------------------------------------------------ live events --- */
  function onWatch(ev) {
    var my = me();
    // my own home: someone came or left, the voice changed
    if (ev.type === 'watched') {
      if (!ev.by) return;
      if (ev.on) {
        var isNew = !watchers[ev.by.id];
        watchers[ev.by.id] = { id: ev.by.id, name: ev.by.name, avatar: ev.by.avatar, voice: !!(watchers[ev.by.id] && watchers[ev.by.id].voice) };
        if (isNew) {
          sfx('notify');
          toast(ev.by.name + 'さんが観戦しています（👁 から話すか選べます）', 3600, openPanel);
        }
      } else {
        delete watchers[ev.by.id];
      }
      renderWatchers();
      syncHome();
      return;
    }
    if (ev.type === 'voice' && my && ev.user === my.id) {
      Object.keys(watchers).forEach(function (k) { watchers[k].voice = ev.voice.indexOf(Number(k)) >= 0; });
      renderWatchers();
      syncHome();
      return;
    }
    if (!state || ev.user !== state.user.id) return;
    if (ev.type === 'spin') BR.app.watchSpin(ev.result, ev.balance);
    else if (ev.type === 'balance') BR.app.watchBalance(ev.balance);
    else if (ev.type === 'charm') BR.shop.watchedCharm(ev.on);
    else if (ev.type === 'tip') rain(ev.fruits);
    else if (ev.type === 'member') {
      if (ev.on) state.members[ev.by.id] = { id: ev.by.id, name: ev.by.name, avatar: ev.by.avatar, voice: false };
      else {
        delete state.members[ev.by.id];
        state.voice = state.voice.filter(function (id) { return id !== ev.by.id; });
      }
      syncVoice();
    } else if (ev.type === 'voice') {
      // the watched player picked (or dropped) someone to talk with
      var was = my && state.voice.indexOf(my.id) >= 0;
      state.voice = ev.voice.slice();
      Object.keys(state.members).forEach(function (k) { state.members[k].voice = ev.voice.indexOf(Number(k)) >= 0; });
      var now = my && state.voice.indexOf(my.id) >= 0;
      if (now && !was) {
        sfx('notify');
        toast(state.user.name + 'さんが通話をオンにしました。マイクボタンで話せます', 4200);
      } else if (was && !now && ev.by && ev.by.id === my.id) {
        toast('通話を終えました', 2400);
      } else if (was && !now) {
        toast(state.user.name + 'さんとの通話が終わりました', 3000);
      }
      syncVoice();
    } else if (ev.type === 'offline') stop(true, state.user.name + 'さんがオフラインになったので観戦を終えました');
  }

  function init() {
    $('#watch-stop').addEventListener('click', function () { sfx('click'); stop(false); });
    $$('#fruit-tray .fruit-btn').forEach(function (b) {
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { throwFruit(b.dataset.fruit, b); });
    });
    $('#home-chat-btn').addEventListener('click', function () { sfx('click'); openChat(); });
    $('#home-chat').addEventListener('click', function (e) { if (e.target.closest('.hc-line')) { sfx('click'); openChat(); } });
    $('#watched-by').addEventListener('click', function () { sfx('click'); openPanel(); });
    K.registerModal('home-panel');
    $('#hp-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-voice]');
      var row = e.target.closest('[data-uid]');
      if (!b || !row || b.disabled) return;
      sfx('click');
      b.disabled = true;
      setVoice(Number(row.dataset.uid), b.dataset.voice === 'on');
    });
    $('#hp-chat').addEventListener('click', function () { sfx('click'); K.closeModal('home-panel'); openChat(); });
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
    BR.live.on('homechat', onHomeChat);
    BR.live.on('balance', function () { renderMine(); });
    // the server forgets watchers whose connection dropped: carry on after a reconnect
    BR.live.on('hello', function () {
      watchers = {};
      renderWatchers();
      api.watchers().then(function (r) {
        r.watchers.forEach(function (w) { watchers[w.id] = w; });
        var my = me();
        if (!state && my && r.watchers.length) setChat(my.id, r.chat || []);
        renderWatchers();
        syncHome();
      }, function () {});
      if (!state) return;
      var id = state.user.id;
      api.watch(id, true).then(function (r) {
        if (!state || state.user.id !== id) return;
        BR.app.watchBalance(r.balance);
        enter(r);
        if (BR.play && BR.play.watchStart) BR.play.watchStart(r);
      }, function () { stop(true, '観戦を続けられませんでした'); });
    });
  }

  BR.watch = {
    init: init,
    start: start,
    stop: stop,
    endVoice: endVoice,
    openChat: openChat,
    active: function () { return !!state; },
    target: function () { return state ? state.user : null; }
  };
})(window.BR = window.BR || {});
