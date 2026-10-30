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
  var token = null, tokenGeneration = 0, persistence = Promise.resolve();
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
          r.onsuccess = function () { db.close(); resolve(r.result || null); };
          r.onerror = function () { db.close(); resolve(null); };
        });
      }).catch(function () { return null; });
    },
    set: function (k, v) {
      return idb.open().then(function (db) {
        return new Promise(function (resolve) {
          var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
          tx.oncomplete = tx.onerror = tx.onabort = function () { db.close(); resolve(); };
          if (v === null) st.delete(k); else st.put(v, k);
        });
      }).catch(function () { /* unavailable */ });
    }
  };

  function persist(t) {
    try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch (e) { /* in-memory only */ }
    persistence = persistence.then(function () { return idb.set(KEY, t); });
  }

  // Resolves once the token is known (it may have to come back from IndexedDB).
  var restored = !online ? Promise.resolve() : (token ? Promise.resolve() : idb.get(KEY).then(function (t) {
    if (t && !token && tokenGeneration === 0) { token = t; persist(t); }
  }));
  if (online && token) idb.get(KEY).then(function (t) { if (t !== token && token) persist(token); });

  function ApiError(status, code, message, extra) {
    this.status = status;
    this.code = code;
    this.message = message;
    this.extra = extra || {};
  }
  ApiError.prototype = Object.create(Error.prototype);

  function emit(ev, arg) { (handlers[ev] || []).forEach(function (f) { f(arg); }); }

  /* What the server sends whole on every start and every connection (GET /api/me, the live connection's hello: the player, the shops'
     list of icons, the NPCs', the rules…) is kept, and asked for again with held=part.rev,…: a part that is the same is not sent again
     but named in `kept`, and is taken from here (server/core/hash.js). The icons' list and the rules, the same for everyone, are kept from
     one visit to the next. */
  var HELD_KEY = 'blockbuster-reels/held', KEEP = { iconShop: 1, rules: 1 };
  var held = { parts: {}, revs: {} };
  try { var kept = JSON.parse(localStorage.getItem(HELD_KEY) || 'null'); if (kept && kept.parts && kept.revs) held = kept; } catch (e) { /* none */ }
  function heldParam() { return BR.held.param(held); }
  function fromHeld(x) {
    if (!x || !x.revs) return x;
    var out = BR.held.merge(x, held);
    if (Object.keys(x.revs).some(function (k) { return KEEP[k]; })) {
      var save = { parts: {}, revs: {} };
      Object.keys(KEEP).forEach(function (k) { if (k in held.parts) { save.parts[k] = held.parts[k]; save.revs[k] = held.revs[k]; } });
      try { localStorage.setItem(HELD_KEY, JSON.stringify(save)); } catch (e) { /* this visit only */ }
    }
    return out;
  }
  // (another login: what was the last one's is not this one's)
  function forgetHeld() { Object.keys(held.parts).forEach(function (k) { if (!KEEP[k]) { delete held.parts[k]; delete held.revs[k]; } }); }

  var pendingSpin = null, pendingGacha = null, clockOffset = 0, rotatingToken = null;
  var NETWORK = '通信できませんでした。電波の良い所でもう一度お試しください';
  function drawKey() {
    var bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return Math.round(Date.now() + clockOffset) + '-' + Array.prototype.map.call(bytes, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  // Survive a reload in this tab after the server committed but the answer was
  // lost. The owner marker cannot be used as a login credential.
  function readDraw(type) {
    try { var r = JSON.parse(sessionStorage.getItem('blockbuster-reels/pending-' + type) || 'null');
      return token && r && r.owner === token.slice(-16) && r.body && r.body.key ? { token: token, body: r.body } : null;
    } catch (e) { return null; }
  }
  function saveDraw(type, job) {
    try {
      var key = 'blockbuster-reels/pending-' + type;
      if (job) sessionStorage.setItem(key, JSON.stringify({ owner: job.token.slice(-16), body: job.body }));
      else sessionStorage.removeItem(key);
    } catch (e) { /* in-memory retry remains available */ }
  }
  function spinPending() { if (!pendingSpin || pendingSpin.token !== token) pendingSpin = readDraw('spin'); return pendingSpin; }
  function gachaPending() { if (!pendingGacha || pendingGacha.token !== token) pendingGacha = readDraw('gacha'); return pendingGacha; }
  // Only a successful password change proves that the new session belongs to
  // this account. Keep uncertain draws, but retire old in-flight callbacks.
  function rotateDraws(nextToken) {
    var spin = spinPending(), gacha = gachaPending();
    pendingSpin = spin ? { token: nextToken, body: spin.body } : null;
    pendingGacha = gacha ? { token: nextToken, body: gacha.body } : null;
    if (pendingSpin) saveDraw('spin', pendingSpin);
    if (pendingGacha) saveDraw('gacha', pendingGacha);
  }
  function viaHttp(method, path, headers, body) {
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'same-origin'
    }).catch(function () {
      throw new ApiError(0, 'network', NETWORK);
    }).then(function (res) {
      return res.json().catch(function () {
        // A committed write with a truncated answer is uncertain, never a success.
        if (res.status >= 200 && res.status < 300) throw new ApiError(0, 'network', NETWORK);
        return {};
      }).then(function (json) {
        if (res.status >= 200 && res.status < 300 && (!json || typeof json !== 'object' || Array.isArray(json))) throw new ApiError(0, 'network', NETWORK);
        return { status: res.status, json: json };
      });
    });
  }

  function discardSession(t) {
    if (!t || t === token) return Promise.resolve();
    return viaHttp('POST', '/api/logout', { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, {}).catch(function () {});
  }

  // On the live connection when it is up (js/net/wire.js: no request of its own), else over HTTP; the answer is read the same way.
  function request(method, path, body) {
    var sentToken = token, sentGeneration = tokenGeneration;
    var headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    // (on the connection the login rides with each request; the device with the connection itself)
    var live = BR.live && BR.live.call(method, path, { Authorization: headers.Authorization }, body);
    // the device (js/net/device.js): two accounts a device, BANs
    if (BR.device) headers['X-Device'] = BR.device.header();
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    var got = !live ? viaHttp(method, path, headers, body) : live.then(function (r) {
      return r ? { status: r.status, json: r.body } : viaHttp(method, path, headers, body);
    }, function () {
      // (the connection went before the answer: a look is asked again; what may have been done is not done twice)
      if (method === 'GET' || ((path === '/api/spin' || path === '/api/gacha/spin' || path === '/api/stocks/order') && body && body.key)) return viaHttp(method, path, headers, body);
      throw new ApiError(0, 'network', NETWORK);
    });
    return got.then(function (r) {
      var authenticates = /^\/api\/(?:login|register|oauth\/(?:poll|register))$/.test(path);
      if ((sentToken || authenticates) && sentGeneration !== tokenGeneration && path !== '/api/password') {
        if (authenticates && r.status >= 200 && r.status < 300) discardSession(r.json && r.json.token);
        throw new ApiError(0, 'session_changed', 'ログイン状態が変わりました');
      }
      var json = r.json || {};
      if (r.status >= 200 && r.status < 300) {
        if (Number.isFinite(json.now)) clockOffset = json.now - Date.now();
        return json;
      }
      var e = json.error || {};
      // the server's daily quota is used up: ours says so, the host's own
      // limit answers 429 (or an error page) without our JSON
      if (e.code === 'maintenance' || (!json.error && (r.status === 429 || r.status === 503))) {
        // a lockdown carries lockdown: true — the game shows 緊急メンテナンス
        e = { code: 'maintenance', message: e.message || 'サーバーのメンテナンス中です', until: e.until, lockdown: !!e.lockdown, emergency: !!e.emergency };
        emit('maintenance', e);
      }
      var err = new ApiError(r.status, e.code || 'error', e.message || ('エラーが発生しました（' + r.status + '）'), e);
      if (r.status === 401 && token && token === sentToken && token !== rotatingToken && path !== '/api/login' && path !== '/api/register') emit('auth-lost', err);
      // banned (or another account on this device is): the title screen, locked (js/ui/banlock.js)
      if (r.status === 403 && sentGeneration === tokenGeneration && (e.code === 'banned' || e.code === 'device_banned') && path !== '/api/login' && path !== '/api/register') emit('banned', err);
      throw err;
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
    discardSession: discardSession,
    setToken: function (t) {
      tokenGeneration++;
      if ((t || null) !== token) forgetHeld();
      token = t || null;
      persist(token);
    },
    // the live connection's address carries what is held of its hello (js/net/live.js), and its hello is made whole with it
    heldParam: heldParam,
    fromHeld: fromHeld,
    lastName: function () { try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; } },
    rememberName: function (n) { try { localStorage.setItem(NAME_KEY, n); } catch (e) { /* ignore */ } },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },

    /* account */
    nameCheck: function (name) { return get('/api/name-check?name=' + q(name)); },
    register: function (name, password, avatar) { return post('/api/register', { name: name, password: password, avatar: avatar }); },
    login: function (name, password) { return post('/api/login', { name: name, password: password }); },
    loginCode: function (code) { return post('/api/login', { code: code }); },
    logout: function (endpoint) { return post('/api/logout', { endpoint: endpoint }); },
    recovery: function () { return post('/api/recovery'); },
    // Google / Discord (js/ui/oauth.js)
    oauthProviders: function () { return get('/api/oauth/providers'); },
    oauthStart: function (provider, external) { return post('/api/oauth/start', { provider: provider, external: !!external }); },
    oauthLinkStart: function (provider, external) { return post('/api/oauth/link-start', { provider: provider, external: !!external }); },
    oauthPoll: function (flow) { return post('/api/oauth/poll', { flow: flow }); },
    oauthRegister: function (flow, name, avatar) { return post('/api/oauth/register', { flow: flow, name: name, avatar: avatar }); },
    oauthLink: function (flow) { return post('/api/oauth/link', { flow: flow }); },
    oauthUnlink: function (provider) { return post('/api/oauth/unlink', { provider: provider }); },
    oauthLinks: function () { return get('/api/oauth/links'); },
    password: function (current, password) {
      var oldToken = token, oldGeneration = tokenGeneration;
      rotatingToken = oldToken;
      BR.live.close();
      return post('/api/password', { current: current, password: password }).then(function (r) {
      if (token !== oldToken || tokenGeneration !== oldGeneration) {
        if (rotatingToken === oldToken) rotatingToken = null;
        // A logout or another account won while the password was being hashed.
        // Discard the new unused session without changing that account's login.
        discardSession(r.token);
        throw new ApiError(0, 'session_changed', 'ログイン状態が変わりました');
      }
      rotateDraws(r.token);
      BR.api.setToken(r.token);
      if (rotatingToken === oldToken) rotatingToken = null;
      BR.live.connect();
      return r;
    }, function (err) {
      if (rotatingToken === oldToken) rotatingToken = null;
      if (token !== oldToken || tokenGeneration !== oldGeneration) throw err;
      if (err.status === 401) emit('auth-lost', err);
      else BR.live.connect();
      throw err;
    }); },
    // (held= even when nothing is held: the answer then names its parts' revs)
    me: function () { return get('/api/me?held=' + heldParam()).then(fromHeld); },
    banState: function () { return get('/api/ban'); },

    /* the game */
    pendingSpinBet: function () { var job = spinPending(); return job ? job.body.bet : null; },
    pendingGacha: function () { var job = gachaPending(); return job ? { kind: job.body.kind, count: job.body.count, price: job.body.price } : null; },
    gacha: function () { return get('/api/gacha'); },
    gachaSpin: function (kind, count, price) {
      var job = gachaPending();
      if (job && (job.body.kind !== kind || job.body.count !== count || job.body.price !== price)) return Promise.reject(new ApiError(409, 'gacha_pending', '前の抽選結果を確認してください'));
      if (!job) { job = pendingGacha = { token: token, body: { key: drawKey(), kind: kind, count: count, price: price } }; saveDraw('gacha', job); }
      if (!job.promise) job.promise = post('/api/gacha/spin', job.body).then(function (r) {
        if (pendingGacha === job) { pendingGacha = null; saveDraw('gacha', null); }
        return r;
      }, function (err) {
        job.promise = null;
        if (err.status && err.status < 500 && pendingGacha === job) { pendingGacha = null; saveDraw('gacha', null); }
        throw err;
      });
      return job.promise;
    },
    gachaUse: function (item) { return post('/api/gacha/use', { item: item }); },
    lineReward: function (token) { return post('/api/line/reward', { token: token }); },
    lineRewardClaim: function (token) { return post('/api/line/reward/claim', { token: token }); },
    diary: function (saved, before) { return get('/api/diary?bookmarks=' + (saved ? '1' : '0') + (before ? '&before=' + q(before) : '')); },
    diaryRead: function (id) { return post('/api/diary/read', { post: id }); },
    diaryImage: function (id) { return get('/api/diary/image?post=' + q(id)); },
    diaryReact: function (id, kind, on) { return post('/api/diary/react', { post: id, kind: kind, on: on }); },
    diaryComments: function (id, before) { return get('/api/diary/comments?post=' + q(id) + (before ? '&before=' + q(before) : '')); },
    diaryComment: function (id, text) { return words('/api/diary/comments', { post: id, text: text }); },
    diaryClaim: function (id) { return post('/api/diary/claim', { post: id }); },
    // (idle: how long ago the player last did something, for the hub: js/ui/activity.js)
    spin: function (bet) {
      if (!spinPending()) {
        pendingSpin = { token: token, body: { key: drawKey(), bet: bet, idle: BR.activity ? Math.round(BR.activity.idle()) : 0 } };
        saveDraw('spin', pendingSpin);
      }
      var job = pendingSpin;
      if (job.promise) return job.promise;
      // A lost answer keeps the same immutable request for the next attempt.
      job.promise = post('/api/spin', job.body).then(function (r) {
        if (pendingSpin === job) { pendingSpin = null; saveDraw('spin', null); }
        return r;
      }, function (err) {
        job.promise = null;
        if (err.status && err.status < 500 && pendingSpin === job) { pendingSpin = null; saveDraw('spin', null); }
        throw err;
      });
      return job.promise;
    },
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
    equipEngine: function (carId, engine) { return post('/api/cars/engine', { car: carId, engine: engine }); },
    rentCar: function (carId, action) { return post('/api/cars/rent', { car: carId, action: action }); },
    collectRent: function () { return post('/api/cars/collect'); },
    expandGarage: function (price) { return post('/api/garage/expand', { price: price }); },
    // a car sold to a friend in the chat
    carOffer: function (to, carId, price) { return post('/api/cars/offer', { to: to, car: carId, price: price }); },
    carOfferCancel: function (id) { return post('/api/cars/offer/cancel', { id: id }); },
    carOfferBuy: function (id) { return post('/api/cars/offer/buy', { id: id }); },
    carSoldClaim: function (id) { return post('/api/cars/sold/claim', { id: id }); },
    vipExtend: function (days, mode) { return post('/api/vip/extend', { days: days, mode: mode }); },
    vipPack: function (days) { return post('/api/vip/extend', { pack: days }); },
    vipCart: function (packs, mode) { return post('/api/vip/extend', { packs: packs, mode: mode }); },
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
    voice: function (userId, on, since) { return post('/api/watch/voice', { user: userId, on: !!on, since: since }); },
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
    resetQuests: function (period, start, version) { return post('/api/quests/reset', { period: period, start: start, version: version }); },
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
    auctionBid: function (steps, id) { return post('/api/tree/auction/bid', { steps: steps, id: id }); },
    auctionLeave: function (id) { return post('/api/tree/auction/leave', { id: id }); },

    /* 投資 (js/ui/stocks.js): an order carries a key of its own, so a retry after a lost answer is the same order */
    stocks: function () { return get('/api/stocks'); },
    stocksChart: function (company, period, since) { return get('/api/stocks/chart?c=' + q(company) + '&p=' + q(period) + (since != null ? '&since=' + q(since) : '')); },
    stocksHistory: function (before) { return get('/api/stocks/history' + (before ? '?before=' + q(before) : '')); },
    stocksOrder: function (order) { return post('/api/stocks/order', order); },
    stocksCancel: function (id) { return post('/api/stocks/cancel', { id: id }); },
    stocksClaim: function () { return post('/api/stocks/claim'); },
    stocksWatch: function (on) { return post('/api/stocks/watch', { on: on ? 1 : 0 }); },
    orderKey: function () { return drawKey(); },

    /* 開発者支援 (js/ui/support.js): the price is the server's, the plan and how many are ours */
    payInfo: function () { return get('/api/pay/info'); },
    payCheckout: function (plan, qty, method) { return post('/api/pay/checkout', { plan: plan, qty: qty, method: method }); },
    payOrder: function (id) { return get('/api/pay/order?id=' + q(id)); },
    payCancel: function (id) { return post('/api/pay/cancel', { order: id }); },
    paySeller: function () { return get('/api/pay/seller'); },

    loginBonus: function () { return post('/api/login-bonus'); },
    ticket: function () { return post('/api/stream-ticket'); },
    // the operators' screen view (js/net/watchfeed.js): our public key, and a sealed frame without a WebSocket
    watchHello: function (sid, pub) { return post('/api/watch/hello', { sid: sid, pub: pub }); },
    watchFrame: function (msg) { return post('/api/watch/frame', { sid: msg.sid, e: msg.e, n: msg.n, d: msg.d }); }
  };
})(window.BR = window.BR || {});
