/* JSON API client for the online server (only used in online mode). */
(function (BR) {
  'use strict';

  var meta = document.querySelector('meta[name="br-mode"]');
  var online = !!meta && meta.getAttribute('content') === 'online';
  var KEY = 'blockbuster-reels/auth';
  var token = null;
  var handlers = {};
  try { token = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }

  function ApiError(status, code, message) {
    this.status = status;
    this.code = code;
    this.message = message;
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
        var err = new ApiError(res.status, e.code || 'error', e.message || ('エラーが発生しました（' + res.status + '）'));
        if (res.status === 401 || (res.status === 403 && e.code === 'banned')) emit('auth-lost', err);
        throw err;
      });
    });
  }

  function get(path) { return request('GET', path); }
  function post(path, body) { return request('POST', path, body || {}); }

  BR.api = {
    online: online,
    ApiError: ApiError,
    hasToken: function () { return !!token; },
    setToken: function (t) {
      token = t || null;
      try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY); } catch (e) { /* in-memory only */ }
    },
    on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },

    register: function (name) { return post('/api/register', { name: name }); },
    login: function (code) { return post('/api/login', { code: code }); },
    logout: function () { return post('/api/logout'); },
    recovery: function () { return post('/api/recovery'); },
    me: function () { return get('/api/me'); },
    spin: function (bet) { return post('/api/spin', { bet: bet }); },
    buy: function (n) { return post('/api/buy', { amount: n }); },
    sell: function (n) { return post('/api/sell', { amount: n }); },
    daily: function () { return post('/api/daily'); },
    board: function (type) { return get('/api/board?type=' + encodeURIComponent(type)); },
    user: function (id) { return get('/api/user?id=' + encodeURIComponent(id)); },
    conversations: function () { return get('/api/conversations'); },
    messages: function (withId, before) {
      var q = [];
      if (withId) q.push('with=' + encodeURIComponent(withId));
      if (before) q.push('before=' + encodeURIComponent(before));
      return get('/api/messages' + (q.length ? '?' + q.join('&') : ''));
    },
    send: function (to, text) { return post('/api/messages', { to: to, text: text }); },
    read: function (withId) { return post('/api/read', { with: withId }); },
    transfer: function (to, amount, currency) { return post('/api/transfer', { to: to, amount: amount, currency: currency }); },
    blocks: function () { return get('/api/blocks'); },
    block: function (id, on) { return post('/api/block', { user: id, blocked: !!on }); },
    ticket: function () { return post('/api/stream-ticket'); }
  };
})(window.BR = window.BR || {});
