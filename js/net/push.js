/* Phone notifications for messages (from friends, groups and Ice Smoker公式
   ボット), voice calls and 一緒に稼ぐ invitations while the game is not in
   sight, with the phone's sound and vibration.
   - In a browser, or the game added to the home screen: Web Push. The player
     allows notifications once, the browser subscribes with the server's key
     (GET /api/push/key) and the server sends them (server/core/push.js);
     sw.js shows them and a tap opens the chat they are about.
   - In the Android app (a WebView, which has no Web Push): the app shows them
     itself (window.TwoStateApp.notice) while it runs in the background.
   Everyone is asked once after signing in (asked again later after あとで,
   three times at most); the profile's 通知 tile turns them on or off. The page
   also tells the server when it goes out of sight, so the server knows when a
   message has to go to the phone. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var el = K.el;
  var ASKED = 'blockbuster-reels/push-asked';     // { n: times asked, at: last time }
  var AGAIN_MS = 3 * 86400000, MAX_ASKS = 3;

  var me = null, root = null, promptTimer = 0, busy = false;
  var epoch = 0;
  var app = window.TwoStateApp && typeof window.TwoStateApp.notice === 'function' ? window.TwoStateApp : null;
  function current(gen, layer) { return gen === epoch && !!me && api.hasToken() && (!layer || root === layer); }
  function guard(gen, layer) {
    if (current(gen, layer)) return;
    var error = new Error('ログイン状態が変わりました'); error.code = 'session_changed'; throw error;
  }

  function mode() {
    if (!api.online) return 'none';
    if (app) return 'app';
    if (window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'web';
    return 'none';
  }
  // 'granted' | 'denied' | 'default' | 'none'
  function permission() {
    var m = mode();
    if (m === 'app') { try { return String(app.notifyState()); } catch (e) { return 'none'; } }
    if (m === 'web') return Notification.permission;
    return 'none';
  }
  function asked() {
    try { return JSON.parse(localStorage.getItem(ASKED) || 'null') || { n: 0, at: 0 }; } catch (e) { return { n: 0, at: 0 }; }
  }
  function markAsked() {
    var a = asked();
    try { localStorage.setItem(ASKED, JSON.stringify({ n: a.n + 1, at: Date.now() })); } catch (e) { /* asked again next time */ }
  }

  /* ------------------------------------------------------------ Web Push --- */
  function keyBytes(b64) {
    var s = b64.replace(/-/g, '+').replace(/_/g, '/');
    s += '===='.slice(0, (4 - s.length % 4) % 4);
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function registration() {
    return navigator.serviceWorker.getRegistration().then(function (r) {
      return r || navigator.serviceWorker.register('sw.js');
    }).then(function () { return navigator.serviceWorker.ready; });
  }
  // this browser's subscription, made if needed and given to the server (for the account signed in now)
  function subscribe(check) {
    check();
    return Promise.all([registration(), api.pushKey()]).then(function (r) {
      check();
      var reg = r[0], key = r[1].key;
      return reg.pushManager.getSubscription().then(function (sub) {
        check();
        if (sub) return sub;
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      }).catch(function () {
        check();
        // made with another key (the server's changed): made again
        return reg.pushManager.getSubscription().then(function (old) {
          check();
          return (old ? old.unsubscribe() : Promise.resolve()).then(function () {
            check();
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
          });
        });
      });
    }).then(function (sub) { check(); return api.pushSubscribe(sub.toJSON()); });
  }
  function endpoint() {
    if (mode() !== 'web') return Promise.resolve(null);
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      return reg ? reg.pushManager.getSubscription() : null;
    }).then(function (sub) { return sub ? sub.endpoint : null; }).catch(function () { return null; });
  }

  /* ------------------------------------------------------------ on / off --- */
  // (from a tap: the browser asks for the permission right away)
  function enable(check) {
    check();
    var m = mode();
    if (m === 'app') {
      try { app.askNotify(); } catch (e) { /* an older app */ }
      return Promise.resolve(permission());
    }
    if (m !== 'web') return Promise.resolve('none');
    var ask = Notification.permission === 'granted' ? Promise.resolve('granted')
      : new Promise(function (resolve) {
        var r = Notification.requestPermission(resolve);
        if (r && r.then) r.then(resolve);
      });
    return ask.then(function (p) {
      check();
      if (p !== 'granted') return p;
      return subscribe(check).then(function () { return 'granted'; });
    });
  }
  function disable(check) {
    check();
    var m = mode();
    if (m === 'app') { try { app.notifyOff(); } catch (e) { /* an older app */ } return Promise.resolve(); }
    return navigator.serviceWorker.getRegistration().then(function (reg) {
      check();
      return reg ? reg.pushManager.getSubscription() : null;
    }).then(function (sub) {
      check();
      if (!sub) return null;
      return api.pushUnsubscribe(sub.endpoint).catch(function () {}).then(function () { check(); return sub.unsubscribe(); });
    }).catch(function (e) { if (e && e.code === 'session_changed') throw e; });
  }
  // signing out: this phone stops getting the account's notifications
  function forget() {
    var gen = ++epoch;
    return endpoint().then(function (ep) { return current(gen) && ep ? api.pushUnsubscribe(ep).catch(function () {}).then(function () { return ep; }) : null; });
  }
  // signed in: an allowed browser is (still) subscribed for this account
  function sync() {
    var gen = epoch;
    if (mode() === 'web' && Notification.permission === 'granted') subscribe(function () { guard(gen); }).catch(function () {});
  }

  /* ------------------------------------------------------------ the question --- */
  function close() { busy = false; if (root) { root.parentNode.removeChild(root); root = null; } }
  // state: what to show (the question, or the settings from the profile)
  function show(fromProfile) {
    if (!me || !api.hasToken()) return;
    close();
    var m = mode(), p = permission();
    root = el('div', 'ov push-ov');
    var sc = el('div', 'ov-scroll');
    var card = el('div', 'ov-card push-card');
    card.setAttribute('role', 'dialog');
    var x = el('button', 'ov-close');
    x.type = 'button';
    x.setAttribute('aria-label', '閉じる');
    x.addEventListener('click', function () { K.sfx('click'); close(); });
    card.appendChild(x);
    card.appendChild(el('i', 'push-bell'));
    card.appendChild(el('h2', 'ov-title', '通知をオンにしよう'));
    card.appendChild(el('p', 'ov-text', 'メッセージ・通話の呼び出し・「一緒に稼ぐ」の招待を、ゲームを閉じていても通知でお知らせします。'));
    var err = el('p', 'ov-error');
    var row = el('div', 'ov-row');
    var later = el('button', 'ov-btn', fromProfile ? '閉じる' : 'あとで');
    later.type = 'button';
    later.addEventListener('click', function () { K.sfx('click'); close(); });
    var on = el('button', 'ov-btn gold', '通知をオンにする');
    on.type = 'button';
    if (m === 'none') {
      card.appendChild(el('p', 'ov-notice', 'この環境では通知を使えません。iPhone は「ホーム画面に追加」したアプリ、Android は Chrome かアプリ版で使えます。'));
      on.hidden = true;
    } else if (p === 'denied') {
      card.appendChild(el('p', 'ov-notice', m === 'app' ? '通知がオフになっています。スマホの「設定」→「アプリ」→「Two state Casino RP」→「通知」から許可してください。'
        : '通知がブロックされています。ブラウザのアドレスバーの鍵マーク（サイトの設定）から「通知」を許可してください。'));
      on.hidden = true;
    } else if (fromProfile && p === 'granted') {
      card.querySelector('.ov-title').textContent = '通知はオンです';
      on.textContent = '通知をオフにする';
      on.classList.remove('gold');
      on.addEventListener('click', function () {
        if (busy) return;
        var gen = ++epoch, layer = root;
        busy = true;
        disable(function () { guard(gen, layer); }).then(function () {
          if (!current(gen, layer)) return;
          close(); K.toast('通知をオフにしました');
        }, function (e) { if (current(gen, layer)) { busy = false; err.textContent = e.message; } });
      });
    }
    if (!(fromProfile && p === 'granted')) {
      on.addEventListener('click', function () {
        if (busy) return;
        var gen = ++epoch, layer = root;
        busy = true;
        err.textContent = '';
        enable(function () { guard(gen, layer); }).then(function (r) {
          if (!current(gen, layer)) return;
          busy = false;
          if (r === 'granted') { close(); K.sfx('notify'); K.toast('通知をオンにしました'); }
          else if (r === 'denied') { err.textContent = '通知が許可されませんでした。あとでプロフィールの「通知」からオンにできます'; }
          else if (m === 'app') { close(); }
        }, function (e) {
          if (!current(gen, layer)) return;
          busy = false;
          err.textContent = (e && e.message) || '通知をオンにできませんでした。もう一度お試しください';
        });
      });
    }
    row.appendChild(later);
    row.appendChild(on);
    card.appendChild(row);
    card.appendChild(err);
    sc.appendChild(card);
    root.appendChild(sc);
    document.body.appendChild(root);
    K.fitOverlay(root);
  }

  // asked once after signing in, when nothing else is going on
  function blocked() {
    var L = BR.launch, $ = U.$;
    if (document.hidden || !me) return true;
    if (me.age === null || me.age === undefined) return true;
    if (!L || !L.done() || L.maintenance()) return true;
    if (BR.account && BR.account.isOpen()) return true;
    if (BR.bonus && BR.bonus.busy()) return true;
    if (BR.guide && BR.guide.active && BR.guide.active()) return true;
    if (BR.entry && BR.entry.isOpen()) return true;
    if (BR.screens.current() !== 'slot') return true;
    if (BR.game && BR.game.busy()) return true;
    var th = $('#thanks'), np = $('#numpad');
    if ((th && !th.hidden) || (np && !np.hidden)) return true;
    if (document.querySelector('#stage .modal:not([hidden]), .ov:not([hidden])')) return true;
    return false;
  }
  function maybeAsk() {
    clearTimeout(promptTimer);
    var a = asked();
    if (!me || mode() === 'none' || permission() !== 'default') return;
    if (a.n >= MAX_ASKS || (a.n && Date.now() - a.at < AGAIN_MS)) return;
    if (blocked()) { promptTimer = setTimeout(maybeAsk, 1500); return; }
    markAsked();
    show(false);
  }

  /* ------------------------------------------------------------ in sight --- */
  function tellSight(on) {
    if (!api.online || !api.hasToken() || !me) return;
    if (BR.live.send({ op: 'sight', on: on ? 1 : 0 })) return;
    api.sight(on).catch(function () {});
  }

  /* ------------------------------------------------------------ the app's own notifications --- */
  var rang = {};
  function appNotify(title, body, tag, call) {
    if (!me || !app || !document.hidden || permission() !== 'granted') return;
    // a tap leads to the chat (or the friends, for an invitation)
    var open = /^(dm|group):\d+$/.test(tag) ? tag : tag.indexOf('invite:') === 0 ? 'friends' : tag.indexOf('tree:') === 0 ? 'tree' : tag.indexOf('stock:') === 0 ? 'stocks' : '';
    try { app.notice(String(title), String(body), String(tag), call ? 1 : 0, open); } catch (e) { /* an older app */ }
  }
  function onMsg(m) {
    if (!me || !m || !m.from || m.from.id === me.id || m.kind === 'system' || m.kind === 'offer') return;
    var text = m.kind === 'transfer' ? U.fmt(m.amount) + (m.currency === 'tokens' ? ' トークン' : ' ドル') + 'が届きました'
      : m.kind === 'present' ? BR.presents.name(m.text) + 'のプレゼントが届きました'
        : m.kind === 'gift' ? '車のプレゼントが届きました' : m.kind === 'item' ? 'アイテムが届きました' : K.clip(m.text, 140);
    if (m.group) appNotify(m.from.name, text, 'group:' + m.group, false);
    else appNotify(m.from.name, text, 'dm:' + m.from.id, false);
  }
  function onHub(ev) {
    if (ev && ev.type === 'invite' && ev.from) appNotify('「一緒に稼ぐ」の招待', ev.from.name + 'さんから「一緒に稼ぐ」の招待が届きました。10分以内に参加しよう！', 'invite:' + ev.from.id, false);
  }
  function onCall(c) {
    if (!c || !c.from || !c.data || c.data.op !== 'hello' || c.data.reply) return;
    if (Date.now() - (rang[c.from.id] || 0) < 120000) return;
    rang[c.from.id] = Date.now();
    appNotify(c.from.name + 'さんから通話', c.type === 'hub' ? '「一緒に稼ぐ」の通話であなたを呼んでいます' : 'ホームの通話であなたを呼んでいます', 'call:' + c.from.id, true);
  }

  /* ------------------------------------------------------------ where a tap leads --- */
  function openTarget(open) {
    if (!open || !me) return;
    var gen = epoch;
    var m = /^(dm|group):(\d+)$/.exec(open);
    if (m && m[1] === 'dm') {
      api.user(Number(m[2])).then(function (r) { if (current(gen)) BR.social.openDm(r.user); }, function () { if (current(gen)) BR.social.open('messages'); });
    } else if (m) {
      BR.social.openGroup(Number(m[2]));
    } else if (open === 'friends') {
      BR.social.open('friends');
    } else if (open === 'tree') {
      BR.tree.open();
    } else if (open === 'stocks' && BR.stocks) {
      BR.stocks.open();
    }
  }
  var pending = (function () {
    try {
      var p = new URLSearchParams(location.search).get('open');
      if (p) history.replaceState(null, '', location.pathname);
      return p || '';
    } catch (e) { return ''; }
  })();

  function onMe(m) {
    var was = me;
    if (!m || !was || was.id !== m.id) { epoch++; clearTimeout(promptTimer); close(); rang = {}; }
    me = m;
    if (!m) { clearTimeout(promptTimer); close(); return; }
    if (!was || was.id !== m.id) {
      sync();
      if (pending) { var p = pending, gen = epoch; pending = ''; setTimeout(function () { if (current(gen)) openTarget(p); }, 600); }
    }
    maybeAsk();
  }

  function init() {
    if (!api.online) return;
    BR.social.onMe(onMe);
    document.addEventListener('visibilitychange', function () { tellSight(!document.hidden); });
    window.addEventListener('pagehide', function () { tellSight(false); });
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'open') openTarget(e.data.open);
      });
    }
    if (app) {
      BR.live.on('msg', onMsg);
      BR.live.on('hub', onHub);
      BR.live.on('call', onCall);
      BR.live.on('tree', function (event) { if (event.type === 'ready') appNotify('金の生る木', event.name + 'が収穫できます', 'tree:' + event.id + ':' + event.cycleAt, false); });
      // a limit or stop order that traded (js/game/stocks.js has the names)
      BR.live.on('stock', function (event) {
        var o = event && event.order;
        if (!o || o.status !== 'filled' || o.type === 'market') return;
        var c = BR.STOCKS && BR.STOCKS.company(o.company);
        appNotify('投資', (c ? c.name : o.company) + ' ' + BR.util.fmt(o.shares) + '株 ' + (o.side === 'buy' ? '買い' : '売り') + ' 約定 $' + BR.util.fmt(o.fill), 'stock:' + o.id, false);
      });
    }
  }

  BR.push = {
    init: init,
    mode: mode,
    permission: permission,
    settings: function () { show(true); },
    forget: forget,
    openTarget: openTarget,
    // the app tells the page what became of its question
    appState: function (state) { if (state === 'granted') K.toast('通知をオンにしました'); }
  };
})(window.BR = window.BR || {});
