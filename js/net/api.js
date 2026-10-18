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
          e = { code: 'maintenance', message: 'サーバーのメンテナンス中です', until: e.until };
          emit('maintenance', e);
        }
        var err = new ApiError(res.status, e.code || 'error', e.message || ('エラーが発生しました（' + res.status + '）'), e);
        if (res.status === 401 && token && path !== '/api/login' && path !== '/api/register') emit('auth-lost', err);
        if (res.status === 403 && e.code === 'banned') emit('auth-lost', err);
        throw err;
      });
    });
  }

  function get(path) { return request('GET', path); }
  function post(path, body) { return request('POST', path, body || {}); }
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

    /* the game */
    spin: function (bet) { return post('/api/spin', { bet: bet }); },
    buy: function (n) { return post('/api/buy', { amount: n }); },
    sell: function (n) { return post('/api/sell', { amount: n }); },
    daily: function () { return post('/api/daily'); },
    board: function (type) { return get('/api/board?type=' + q(type)); },

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
    messages: function (withId, before) {
      var p = [];
      if (withId) p.push('with=' + q(withId));
      if (before) p.push('before=' + q(before));
      return get('/api/messages' + (p.length ? '?' + p.join('&') : ''));
    },
    send: function (to, text) { return post('/api/messages', { to: to, text: text }); },
    read: function (withId) { return post('/api/read', { with: withId }); },
    transfer: function (to, amount, currency) { return post('/api/transfer', { to: to, amount: amount, currency: currency }); },
    blocks: function () { return get('/api/blocks'); },
    block: function (id, on) { return post('/api/block', { user: id, blocked: !!on }); },

    /* icons and cars */
    setAvatar: function (id) { return post('/api/avatar', { id: id }); },
    buyAvatar: function (id, price) { return post('/api/avatar/buy', { id: id, price: price }); },
    cars: function () { return get('/api/cars'); },
    buyCar: function (model) { return post('/api/cars/buy', { model: model }); },
    giftCar: function (to, carId) { return post('/api/cars/gift', { to: to, car: carId }); },

    /* Shop, 所有 and the お守り加護 */
    items: function () { return get('/api/items'); },
    buyItem: function (id, count, price) { return post('/api/shop/buy', { id: id, count: count, price: price }); },
    giveItem: function (to, id, count) { return post('/api/items/give', { to: to, id: id, count: count }); },
    charm: function () { return post('/api/charm'); },

    /* Peter */
    peter: function () { return get('/api/peter'); },
    borrow: function (offer) { return post('/api/peter/borrow', { offer: offer }); },
    repay: function (amount) { return post('/api/peter/repay', { amount: amount }); },

    /* voice chat and watching */
    iceServers: function () { return get('/api/call/ice'); },
    call: function (to, type, callId, data) { return post('/api/call', { to: to, type: type, callId: callId, data: data === undefined ? null : data }); },
    watch: function (id, on) { return post('/api/watch', { user: id, on: !!on }); },
    watchers: function () { return get('/api/watchers'); },
    tip: function (to, fruits) { return post('/api/tip', { to: to, fruits: fruits }); },
    homeInvite: function (to) { return post('/api/home/invite', { to: to }); },

    loginBonus: function () { return post('/api/login-bonus'); },
    ticket: function () { return post('/api/stream-ticket'); }
  };
})(window.BR = window.BR || {});
