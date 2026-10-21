/* JSON API client for the online server (only used in online mode).
   The login token is kept in two places (localStorage and IndexedDB), so one
   of them being cleared does not log the player out; the name + password
   always bring the account back anyway. */
(function (BR) {
  'use strict';

  var meta = document.querySelector('meta[name="br-mode"]');
  var online = !!meta && meta.getAttribute('content') === 'online' && location.protocol !== 'file:';
  var liveMode = (meta && meta.getAttribute('data-live')) || 'sse';
  var KEY = 'blockbuster-reels/auth';
  var NAME_KEY = 'blockbuster-reels/last-name';
  var token = null;
  var handlers = {};
  try { token = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }

  /* second copy of the token in IndexedDB */
  var idb = {
    open: function () {
      return new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('no idb')); return; }
        var req = indexedDB.open('blockbuster-reels', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    },
    get: function (k) {
      return idb.open().then(function (db) {
        return new Promise(function (resolve) {
          var r = db.transaction('kv').objectStore('kv').get(k);
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { resolve(null); };
        });
      }).catch(function () { return null; });
    },
    set: function (k, v) {
      return idb.open().then(function (db) {
        var st = db.transaction('kv', 'readwrite').objectStore('kv');
        if (v === null) st.delete(k); else st.put(v, k);
      }).catch(function () { /* unavailable */ });
    }
  };

  function persist(t) {
    try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* in-memory only */ }
    idb.set(KEY, t);
  }

  // Resolves once the token is known (it may have to come back from IndexedDB).
  var restored = !online ? Promise.resolve() : (token ? Promise.resolve() : idb.get(KEY).then(function (t) {
    if (t && !token) { token = t; persist(t); }
  }));
  if (online && token) idb.get(KEY).then(function (t) { if (t !== token && token) idb.set(KEY, token); });

  function ApiError(status, code, message, extra) {
    this.status = status;
    this.code = code;
    this.message = message;
    this.extra = extra || {};
  }
  ApiError.prototype = Object.create(Error.prototype);

  function emit(ev, arg) { (handlers[ev] || []).forEach(function (f) { f(arg); }); }

  function request(method, path, body) {
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    // the device (js/net/device.js): two accounts a device, BANs
    if (BR.device) headers['X-Device'] = BR.device.header();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin'
    }).catch(function () {
      throw new ApiError(0, 'network', '通信できませんでした。電波の良い所でもう一度お試しください');
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (res.ok) return json;
        var e = json.error || {};
        // the server's daily quota is used up: ours says so, the host's own
        // limit answers 429 (or an error page) without our JSON
        if (e.code === 'maintenance' || (!json.error && (res.status === 429 || res.status === 503))) {
          // a lockdown carries lockdown: true — the game shows 緊急メンテナンス
          e = { code: 'maintenance', message: e.message || 'サーバーのメンテナンス中です', until: e.until, lockdown: !!e.lockdown, emergency: !!e.emergency };
          emit('maintenance', e);
        }
        var err = new ApiError(res.status, e.code || 'error', e.message || ('エラーが発生しました（' + res.status + '）'), e);
        if (res.status === 401 && token && path !== '/api/login' && path !== '/api/register') emit('auth-lost', err);
        // banned (or another account on this device is): the title screen, locked (js/ui/banlock.js)
        if (res.status === 403 && (e.code === 'banned' || e.code === 'device_banned') && path !== '/api/login' && path !== '/api/register') emit('banned', err);
        throw err;
      });
    });
  }

  function get(path) { return request('GET', path); }
  function post(path, body) { return request('POST', path, body || {}); }
  // Words only: the server's automatic filter stops a chat message with
  // anything else in it (and the sender's chat with it), so the game never
  // sends one. Invisible control characters go; what looks like a file (a
  // data: URL, a long run of base64) is not sent (server/core/attach.js).
  // eslint-disable-next-line no-control-regex
  var CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F]/g;
  function looksLikeFile(t) {
    if (/data:[\w.+-]+\/[\w.+-]+(?:;[\w=.+-]+)*;base64,[A-Za-z0-9+/]{40,}/i.test(t)) return true;
    var runs = t.match(/[A-Za-z0-9+/]{400,}/g) || [];
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i], seen = {}, n = 0;
      for (var j = 0; j < r.length && n < 20; j++) if (!seen[r[j]]) { seen[r[j]] = 1; n++; }
      if (n >= 20 && /[A-Z]/.test(r) && /[a-z]/.test(r) && /\d/.test(r)) return true;
    }
    return false;
  }
  function words(path, body) {
    var t = String(body.text == null ? '' : body.text).replace(CONTROL, '');
    if (looksLikeFile(t)) return Promise.reject(new ApiError(400, 'not_text', 'ファイルのような長い英数字の列は送れません'));
    body.text = t;
    return post(path, body);
  }
  // 運営へのメッセージ・報告・意見案・通報・プレイヤー間のメッセージ: too big
  // ones (BR.CONFIG.sendMax) are stopped here, before they are sent
  function postText(path, body) {
    var M = BR.CONFIG.sendMax;
    if (Array.from(String(body.text || '')).length > M.chars || new Blob([JSON.stringify(body)]).size > M.bytes) {
      return Promise.reject(new ApiError(413, 'too_large', '送信できません。大きすぎます。'));
    }
    return words(path, body);
  }
  function q(v) { return encodeURIComponent(v); }

  BR.api = {
    online: online,
    liveMode: liveMode,
    ApiError: ApiError,
    restored: restored,
    hasToken: function () { return !!token; },
    setToken: function (t) {
      token = t || null;
      persist(token);
    },
    lastName: function () { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } },
    rememberName: function (n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ } },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },

    /* account */
    nameCheck: function (name) { return get('/api/name-check?name=' + q(name)); },
    register: function (name, password, avatar) { return post('/api/register', { name: name, password: password, avatar: avatar }); },
    login: function (name, password) { return post('/api/login', { name: name, password: password }); },
    loginCode: function (code) { return post('/api/login', { code: code }); },
    logout: function () { return post('/api/logout'); },
    recovery: function () { return post('/api/recovery'); },
    password: function (current, password) { return post('/api/password', { current: current, password: password }); },
    me: function () { return get('/api/me'); },
    banState: function () { return get('/api/ban'); },

    /* the game */
    // (idle: how long ago the player last did something, for the hub: js/ui/activity.js)
    spin: function (bet) { return post('/api/spin', { bet: bet, idle: BR.activity ? Math.round(BR.activity.idle()) : 0 }); },
    buy: function (n) { return post('/api/buy', { amount: n }); },
    sell: function (n) { return post('/api/sell', { amount: n }); },
    daily: function () { return post('/api/daily'); },

    /* players and friends */
    user: function (id) { return get('/api/user?id=' + q(id)); },
    userByName: function (name) { return get('/api/user?name=' + q(name)); },
    friends: function () { return get('/api/friends'); },
    friendRequest: function (user) { return post('/api/friends/request', typeof user === 'number' ? { user: user } : { name: user }); },
    friendRespond: function (id, accept) { return post('/api/friends/respond', { user: id, accept: !!accept }); },
    friendCancel: function (id) { return post('/api/friends/cancel', { user: id }); },
    friendRemove: function (id) { return post('/api/friends/remove', { user: id }); },

    /* chat */
    conversations: function () { return get('/api/conversations'); },
    // `chat`: { with: <player> } or { group: <id> }
    messages: function (chat, before) {
      var p = [chat.group ? 'group=' + q(chat.group) : 'with=' + q(chat.with)];
      if (before) p.push('before=' + q(before));
      return get('/api/messages?' + p.join('&'));
    },
    send: function (chat, text) { return postText('/api/messages', chat.group ? { group: chat.group, text: text } : { to: chat.with, text: text }); },
    read: function (chat) { return post('/api/read', chat.group ? { group: chat.group } : { with: chat.with }); },
    typing: function (chat) { return post('/api/typing', chat.group ? { group: chat.group } : { to: chat.with }); },
    makeGroup: function (name, members) { return post('/api/groups', { name: name, members: members }); },
    leaveGroup: function (id) { return post('/api/groups/leave', { group: id }); },
    transfer: function (to, amount, currency) { return post('/api/transfer', { to: to, amount: amount, currency: currency }); },
    // money, a car or an item sent in a chat arrives with the tap
    claim: function (messageId) { return post('/api/messages/claim', { message: messageId }); },
    retract: function (messageId) { return post('/api/messages/retract', { message: messageId }); },
    blocks: function () { return get('/api/blocks'); },
    block: function (id, on) { return post('/api/block', { user: id, blocked: !!on }); },

    /* icons and cars */
    setAvatar: function (id) { return post('/api/avatar', { id: id }); },
    buyAvatar: function (id, price) { return post('/api/avatar/buy', { id: id, price: price }); },
    cars: function () { return get('/api/cars'); },
    buyCar: function (model, price) { return post('/api/cars/buy', { model: model, price: price }); },
    giftCar: function (to, carId) { return post('/api/cars/gift', { to: to, car: carId }); },
    sellCar: function (carId, price) { return post('/api/cars/sell', { car: carId, price: price }); },
    rentCar: function (carId, action) { return post('/api/cars/rent', { car: carId, action: action }); },
    collectRent: function () { return post('/api/cars/collect'); },
    expandGarage: function (price) { return post('/api/garage/expand', { price: price }); },
    // a car sold to a friend in the chat
    carOffer: function (to, carId, price) { return post('/api/cars/offer', { to: to, car: carId, price: price }); },
    carOfferCancel: function (id) { return post('/api/cars/offer/cancel', { id: id }); },
    carOfferBuy: function (id) { return post('/api/cars/offer/buy', { id: id }); },
    carSoldClaim: function (id) { return post('/api/cars/sold/claim', { id: id }); },
    vipExtend: function (days) { return post('/api/vip/extend', { days: days }); },
    vipPack: function (days) { return post('/api/vip/extend', { pack: days }); },
    vipTrial: function () { return post('/api/vip/trial'); },

    /* Shop, 所有 and the お守り加護 */
    items: function () { return get('/api/items'); },
    buyItem: function (id, count, price) { return post('/api/shop/buy', { id: id, count: count, price: price }); },
    giveItem: function (to, id, count) { return post('/api/items/give', { to: to, id: id, count: count }); },
    charm: function () { return post('/api/charm'); },

    /* Peter */
    peter: function () { return get('/api/peter'); },
    borrow: function (offer) { return post('/api/peter/borrow', { offer: offer }); },
    repay: function (amount) { return post('/api/peter/repay', { amount: amount }); },
    johnson: function () { return get('/api/johnson'); },

    /* voice chat and watching */
    iceServers: function () { return get('/api/call/ice'); },
    call: function (to, type, callId, data) { return post('/api/call', { to: to, type: type, callId: callId, data: data === undefined ? null : data }); },
    watch: function (id, on) { return post('/api/watch', { user: id, on: !!on }); },
    watchers: function () { return get('/api/watchers'); },
    voice: function (userId, on) { return post('/api/watch/voice', { user: userId, on: !!on }); },
    homeChat: function (room, text) { return words('/api/home/chat', { room: room, text: text }); },
    watchBet: function (side, stake) { return post('/api/watch/bet', { side: side, stake: stake }); },
    tip: function (to, fruits) { return post('/api/tip', { to: to, fruits: fruits }); },

    /* フレンド対決 and 協力スロット */
    battle: function () { return get('/api/battle'); },
    challenge: function (to, spins, bet) { return post('/api/battle', { to: to, spins: spins, bet: bet }); },
    battleRespond: function (id, accept) { return post('/api/battle/respond', { id: id, accept: !!accept }); },
    battleQuit: function (id) { return post('/api/battle/quit', { id: id }); },
    coop: function (group) { return get('/api/coop?group=' + q(group)); },
    sitCoop: function (group, on) { return post('/api/coop', { group: group, on: !!on }); },

    /* 友達と稼ぐ (hubs) and the activity beat of the time quests */
    hub: function () { return get('/api/hub'); },
    hubInvite: function (to) { return post('/api/hub/invite', { to: to }); },
    hubJoin: function (from) { return post('/api/hub/join', { from: from }); },
    hubDecline: function (from) { return post('/api/hub/decline', { from: from }); },
    hubLeave: function () { return post('/api/hub/leave'); },
    hubSay: function (to, text) { return words('/api/hub/say', { to: to, text: text }); },
    beat: function (idle, voice) { return post('/api/beat', { idle: idle, voice: voice ? 1 : 0 }); },

    /* the beginner guide and feedback to the operator */
    guideDone: function () { return post('/api/guide'); },
    sendFeedback: function (ratings, comment) { return post('/api/feedback', { ratings: ratings, comment: comment }); },

    /* 18歳以上？, presents, 通報 and the official bot's 報告 / 意見案 */
    age: function (adult) { return post('/api/age', { adult: !!adult }); },
    present: function (to, id) { return post('/api/present', { to: to, id: id }); },
    presentClaim: function (messageId) { return post('/api/present/claim', { message: messageId }); },
    report: function (user, kind, text, place) { return postText('/api/report', { user: user, kind: kind, text: text, place: place }); },
    reportMessage: function (messageId, kind, text) { return postText('/api/report/message', { message: messageId, kind: kind, text: text }); },
    officialFeedback: function (kind, text) { return postText('/api/official/feedback', { kind: kind, text: text }); },

    /* phone notifications (js/net/push.js) */
    pushKey: function () { return get('/api/push/key'); },
    pushSubscribe: function (sub) { return post('/api/push/subscribe', sub); },
    pushUnsubscribe: function (endpoint) { return post('/api/push/unsubscribe', { endpoint: endpoint }); },
    sight: function (on) { return post('/api/sight', { on: on ? 1 : 0 }); },

    /* quests, バイト and updates */
    quests: function () { return get('/api/quests'); },
    claimQuests: function (ids) { return post('/api/quests/claim', ids ? { ids: ids } : {}); },
    peek: function (withId) { return post('/api/quests/peek', { with: withId }); },
    jobs: function () { return get('/api/jobs'); },
    startJob: function (id) { return post('/api/jobs/start', { id: id }); },
    stopJob: function (id) { return post('/api/jobs/stop', { id: id }); },
    collectJobs: function () { return post('/api/jobs/collect'); },
    release: function (n) { return post('/api/release', { release: n, build: BR.BUILD || '' }); },
    releaseClaim: function () { return post('/api/release/claim'); },

    /* 金の生る木 and its auctions */
    trees: function () { return get('/api/tree'); },
    treeGive: function (tree, amount) { return post('/api/tree/give', { tree: tree, amount: amount }); },
    treeStart: function (tree, cycle) { return post('/api/tree/start', { tree: tree, cycle: cycle }); },
    treeHarvest: function (tree, next) { return post('/api/tree/harvest', { tree: tree, next: next }); },
    auction: function () { return get('/api/tree/auction'); },
    auctionStart: function (market) { return post('/api/tree/auction/start', { market: market }); },
    auctionBid: function (steps) { return post('/api/tree/auction/bid', { steps: steps }); },
    auctionLeave: function () { return post('/api/tree/auction/leave'); },

    /* 開発者支援 (js/ui/support.js): the price is the server's, the plan and how many are ours */
    payInfo: function () { return get('/api/pay/info'); },
    payCheckout: function (plan, qty, method) { return post('/api/pay/checkout', { plan: plan, qty: qty, method: method }); },
    payOrder: function (id) { return get('/api/pay/order?id=' + q(id)); },
    payCancel: function (id) { return post('/api/pay/cancel', { order: id }); },
    paySeller: function () { return get('/api/pay/seller'); },

    loginBonus: function () { return post('/api/login-bonus'); },
    ticket: function () { return post('/api/stream-ticket'); }
  };
})(window.BR = window.BR || {});
