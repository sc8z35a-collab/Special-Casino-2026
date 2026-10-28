/* security HOME (server/core/sec.js, server/core/seccomm.js): the operators' final safety base, apart from the operator site.
   An operator signs in once (the name and password of the game; only the operators and the 閲覧者 get in), enters today's passkey,
   and the page opens a SECURE CHANNEL to the server (js/net/secchannel.js): from then on everything it says and hears is sealed, the
   server proves who it is, and the lock at the top shows what the page itself checked (https, the address, the server's identity,
   the clock). The server insists on the channel: a request that does not come through it is turned away.

   What there is to see is the server's to say: GET /api/sec/me lists the panels this person has, and this page is built from that and
   from nothing else (the developer's panels are loaded only if the server lists them; the routes behind them answer no one else).
   The panels: 全体の状況 (TWO STATE's server, the threat level, the threats to the operator site, the guard, the log in short),
   脅威情報, 守りの状態, ログ, 連絡チャンネル, ロックダウン. Nothing operational can be done from here but the lockdown. */
(function () {
  'use strict';

  var TOKEN_KEY = 'two-state-sec/token';
  var DEVICE_KEY = 'two-state-sec/device';
  var NAME_KEY = 'two-state-sec/login-name';
  // the newest channel message each operator has seen here (+ their id)
  var SEEN_KEY = 'two-state-sec/seen/';
  // how often it refreshes: the developer's one choice for every operator (server/core/ops.js)
  var SPEEDS = { max: 1000, high: 2000, normal: 5000, slow: 15000, slowest: 60000 };
  var PAGE = 200;   // log entries per answer (server/core/opslog.js)
  var ACTIONS = {
    release: 'DEV更新', open: 'サイトを開いた', emergency_stop: '緊急停止', emergency_release: '緊急停止の解除',
    lockdown: 'ロックダウン', lockdown_release: 'ロックダウンの解除', shield_block: '手動ブロック', shield_auto_block: '自動ブロック',
    shield_unblock: 'ブロック解除', sec_message: 'セキュリティ基地の連絡', dev_code_fail: '開発者コードの入力ミス',
    dev_code_set: '開発者コードを登録', dev_code_change: '開発者コードを変更', ops_grant: '運営権の付与', ops_revoke: '運営権の剥奪',
    account_delete: 'アカウント削除', account_purge: 'データの削除（会話は保存）', backup_run: 'バックアップ', backup_failed: 'バックアップの失敗',
    'ban:suspend': 'アクセス禁止', 'ban:ban': 'BAN', 'ban:perma': '永久BAN', 'ban:none': '処分の解除',
    player_register: '登録', player_login: 'ログイン', player_oauth_link: 'Google / Discord を連携', player_oauth_unlink: 'Google / Discord の連携を解除', bot_message: '公式のメッセージ', money: '送金',
    sec_channel_denied: 'セキュア通信の不正な要求', sec_channel_closed: 'セキュア通信の接続を終了', sec_cdw_denied: '許可のない窓の操作',
    login_fail: 'ログインの失敗', login_lock: 'ログインの制限', login_burst: 'ログインの連続失敗', pk_fail: 'パスキーの入力ミス', patrol_alert: '自動点検の警告'
  };
  var KINDS = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
  var LEVELS = {
    safe: { word: '平常', pct: 8 }, watch: { word: '注意', pct: 26 }, elevated: { word: '警戒', pct: 50 },
    high: { word: '高', pct: 74 }, breach: { word: '突破', pct: 92 }, lockdown: { word: 'ロックダウン', pct: 100 }
  };
  // what the page found wrong with the connection (js/net/secchannel.js: info().problems), in words
  var PROBLEMS = {
    protocol: 'このページはHTTPSで開かれていません', context: 'このページは安全なコンテキストではありません', framed: '他のサイトの中に埋め込まれています',
    'server-tls': 'サーバーは、暗号化された接続として受け取っていません', host: 'サーバーが見たアドレスと、このページのアドレスが違います',
    origin: 'サーバーが見た送信元と、このページが違います', clock: 'この端末の時計がサーバーとずれています', person: 'サーバーが答えた相手が違います'
  };
  var CHECKS = [
    ['protocol', 'ページがHTTPSで開かれている'], ['context', '安全なコンテキストである'], ['framed', '他のサイトに埋め込まれていない'],
    ['server-tls', 'サーバー自身が暗号化された接続と見ている'], ['host', 'サーバーが見たアドレスが、このページと同じ'],
    ['origin', 'サーバーが見た送信元が、このページと同じ'], ['clock', '時計がサーバーと合っている']
  ];
  function actionName(a) { return ACTIONS[a] || a; }

  var $ = function (s) { return document.querySelector(s); };
  var token = null, me = null, meId = 0, speed = 'normal', chan = null;
  // each sign-in and sign-out starts a new session: answers to an older one are dropped
  var session = 0;
  var timer = 0, aliveTimer = 0, lockLeft = 0, lockStamp = 0, lockTimer = 0, askTimer = 0, askSeq = 0, deviceNew = false;
  var panels = {}, order = [], view = '', defs = {}, data = { status: null, threats: null, posture: null }, tickN = 0, statusErr = '';
  var locked = false, closeDialog = null, devLoaded = false;

  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }

  /* ------------------------------------------------------------ helpers --- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  var NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP'); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function stamp(ts) { if (!ts) return '-'; var d = new Date(ts); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function ago(ts) { if (!ts) return '-'; var s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'たった今'; if (s < 3600) return Math.floor(s / 60) + '分前'; if (s < 86400) return Math.floor(s / 3600) + '時間前'; return Math.floor(s / 86400) + '日前'; }
  function bytes(n) { n = Number(n || 0); if (n < 1024) return Math.round(n) + 'B'; if (n < 1048576) return (n / 1024).toFixed(1) + 'KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + 'MB'; return (n / 1073741824).toFixed(2) + 'GB'; }
  function span(ms) { var m = Math.floor(ms / 60000); return m < 60 ? m + '分' : m < 1440 ? Math.floor(m / 60) + '時間' + (m % 60) + '分' : Math.floor(m / 1440) + '日' + Math.floor((m % 1440) / 60) + '時間'; }
  function toast(t) { securityNotice({ text: String(t) }); var n = $('#toast'); n.textContent = t; n.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { n.hidden = true; }, 2600); }
  function fail(e) { toast(e && e.message ? e.message : 'エラーが発生しました'); }
  // one request of a kind at a time, so a slow server never piles them up nor answers them out of order; asked for again meanwhile, it runs once more after
  function single(fn) {
    var busy = false, again = false;
    return function run() {
      if (busy) { again = true; return; }
      busy = true; again = false;
      Promise.resolve().then(fn).then(null, function () {}).then(function () { busy = false; if (again && token) run(); });
    };
  }
  function securityNotice(detail) {
    if (window.parent !== window) window.parent.postMessage(Object.assign({ type: 'ops:security-notice' }, detail), location.origin);
  }

  /* ------------------------------------------------------------ server --- */
  function device() {
    var d = null;
    try { d = localStorage.getItem(DEVICE_KEY); } catch (e) { d = null; }
    if (!d || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) {
      var a = new Uint8Array(18);
      crypto.getRandomValues(a);
      d = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      deviceNew = true;
      try { localStorage.setItem(DEVICE_KEY, d); } catch (e) { /* this tab */ }
    }
    return d;
  }
  // the ordinary request (what the sealed channel itself rides on, and the login, the passkey and the few routes outside the base)
  function raw(method, path, body, headers) {
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (headers) Object.keys(headers).forEach(function (k) { h[k] = headers[k]; });
    var s = session;
    // (signed with this page's key once today's passkey is in: pk.js)
    return OpsPk.header(method, path).catch(function () { return null; }).then(function (gate) {
      if (gate) h['X-Gate'] = gate;
      return fetch(path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' });
    })
      .catch(function () { throw { status: 0, message: '通信できませんでした' }; })
      .then(function (res) {
        return res.json().catch(function () { if (res.ok) throw { status: 0, message: '通信できませんでした' }; return {}; }).then(function (j) {
          if (res.ok && (!j || typeof j !== 'object' || Array.isArray(j))) throw { status: 0, message: '通信できませんでした' };
          if (res.ok) return j;
          var e = j.error || {};
          var err = { status: res.status, code: e.code || '', message: e.message || ('エラー（' + res.status + '）'), until: e.until || 0, left: e.left || 0, scope: e.scope || '' };
          // the passkey is asked for (this page is new, or its hour is up)
          if ((e.code === 'pk_required' || e.code === 'pk_expired') && token && s === session) showPasskey(e.code === 'pk_required' && err.message === PK_DEFAULT ? '' : err.message);
          // signed out on the server: only while signed in, and in this same session (not a wrong password, nor a late answer to the last one)
          if ((res.status === 401 || e.code === 'not_operator' || e.code === 'mfa_required') && path !== '/api/ops/login' && token && s === session) signedOut(err.message);
          throw err;
        });
      });
  }
  // a request to the base: through the secure channel (opened by itself the first time, and again if the server ended it)
  function api(method, path, body) {
    if (!/^\/api\/sec\//.test(path)) return raw(method, path, body);
    if (!chan) newChannel();
    return chan.call(method, path, body).then(null, function (err) {
      // the server is not the one this page kept: nothing more is said to it until that is answered
      if (err && err.code === 'identity_changed') { showIdentity(err); throw { status: 0, code: 'identity_changed', message: err.message }; }
      throw err;
    });
  }
  function newChannel() {
    chan = BR.secChannel.create({ request: raw, uid: meId || 0 });
    chan.onChange(showChannel);
  }
  function setToken(t) { token = t || null; try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* this tab */ } }

  /* ------------------------------------------------------------ the lock at the top --- */
  var chanInfo = null;
  function showChannel(info) {
    chanInfo = info;
    var b = $('#chan'), t = $('#chan-text');
    if (!info) { b.className = 'chan'; t.textContent = '接続を確かめています…'; return; }
    if (info.error) { b.className = 'chan bad'; t.textContent = 'セキュア通信を確立できません'; }
    else if (info.secure) { b.className = 'chan ok'; t.textContent = 'セキュア通信：確認済み'; }
    else { b.className = 'chan warn'; t.textContent = 'セキュア通信：確認できない項目があります'; }
    if (!$('#chan-pop').hidden) drawChannelPop();
  }
  function drawChannelPop() {
    var pop = $('#chan-pop'), info = chanInfo;
    pop.textContent = '';
    pop.appendChild(el('h3', '', 'セキュア通信の確認'));
    if (!info) { pop.appendChild(el('p', 'muted', 'まだ確かめていません。')); return; }
    if (info.error) { pop.appendChild(el('p', 'bad', 'つなげませんでした（' + info.error + '）。ページを読み込み直してください。')); return; }
    pop.appendChild(el('p', 'muted', 'このページ自身が確かめた項目です。すべて満たしたときだけ「確認済み」になります。'));
    var ul = el('ul', 'checks');
    CHECKS.forEach(function (c) {
      var bad = info.problems.indexOf(c[0]) >= 0, li = el('li', bad ? 'bad' : 'ok');
      li.appendChild(el('i', 'dot')); li.appendChild(el('span', '', c[1]));
      if (bad && PROBLEMS[c[0]]) li.appendChild(el('small', '', PROBLEMS[c[0]]));
      ul.appendChild(li);
    });
    var idLi = el('li', 'ok'); idLi.appendChild(el('i', 'dot')); idLi.appendChild(el('span', '', 'サーバーの身元が、前に確かめたものと同じ（署名を確認）'));
    idLi.appendChild(el('small', '', (info.pin === 'new' ? 'この端末では初めて記録しました：' : '前回と同じ：') + info.fp));
    ul.appendChild(idLi);
    pop.appendChild(ul);
    pop.appendChild(el('p', 'muted fine', (info.tls || '暗号化なし') + (info.http ? '・' + info.http : '') + '・時計のずれ ' + Math.round((info.skew || 0) / 1000) + '秒'));
  }

  // the server is not the one this page kept: the page stops; nothing is sent
  function showIdentity(err) {
    var was = '';
    try { was = localStorage.getItem('two-state-sec/identity/' + location.origin) || ''; } catch (e) { was = ''; }
    session++; clearInterval(timer); clearInterval(aliveTimer);
    $('#app').hidden = true; $('#login').hidden = true; $('#pk').hidden = true; $('#identity').hidden = false;
    $('#identity-now').textContent = err.fp || '?';
    BR.secChannel.fingerprint(BR.secChannel.unb64(was || 'AA')).then(function (fp) { $('#identity-was').textContent = was ? fp : '（記録なし）'; }, function () { $('#identity-was').textContent = '?'; });
    $('#identity-trust').onclick = function () {
      openDialog({ title: 'いまのサーバーを信頼し直しますか？', text: 'サーバーを入れ替えたと、開発者に確かめましたか？ 確かめていないなら、やめてください。', ok: '信頼し直す', danger: true }).then(function (ok) {
        if (ok === null) return;
        try { localStorage.setItem('two-state-sec/identity/' + location.origin, err.offered); } catch (e) { /* the next look asks again */ }
        location.reload();
      });
    };
    $('#identity-reload').onclick = function () { location.reload(); };
  }

  /* ------------------------------------------------------------ login --- */
  // The passkey (server/core/pk.js), asked each time this page opens and after an hour on it: today's six digits from Discord's /passkey.
  // A wrong one keeps the account out for an hour. The page's key lives in its memory only (pk.js); the page starts over when the hour is up.
  var PK_DEFAULT = '今日のパスキーを入力してください', pkTimer = 0, pkWarn = 0, pkLockTimer = 0, pkLockEnd = 0;
  // what this operator saw goes (the next one, or this one after the passkey, starts clean)
  function wipe() {
    if (closeDialog) closeDialog(null);
    clearInterval(timer); clearInterval(aliveTimer);
    $('#stage').textContent = ''; $('#rail').textContent = '';
    panels = {}; order = []; view = ''; data = { status: null, threats: null, posture: null }; chanInfo = null;
    Object.keys(defs).forEach(function (k) { if (defs[k].reset) defs[k].reset(); });
    if (chan) { chan.drop(); chan = null; }
    showChannel(null);
  }
  function showPasskey(message) {
    if (!token) return;
    if (!$('#pk').hidden) { if (message) $('#pk-error').textContent = message; return; }
    clearTimeout(pkTimer); clearTimeout(pkWarn);
    OpsPk.close();
    session++; wipe();
    $('#app').hidden = true; $('#login').hidden = true; $('#pk').hidden = false;
    document.body.classList.remove('role-viewer');
    $('#pk-code').value = ''; $('#pk-error').textContent = message || ''; $('#pk-go').disabled = false;
    pkLockEnd = 0; clearInterval(pkLockTimer);
    raw('GET', '/api/pk/state').then(function (st) {
      $('#pk-day').textContent = '今日（' + st.day.replace(/-/g, '/') + '）のパスキーを入力してください。';
      $('#pk-role').textContent = { developer: '開発者', operator: '運営者', viewer: '閲覧者' }[st.role] || '運営者';
      $('#pk-name').textContent = st.name;
      if (st.locked > Date.now()) pkWait(st.locked);
    }, function () {});
    setTimeout(function () { $('#pk-code').focus(); }, 50);
  }
  function pkWait(until) {
    pkLockEnd = until; clearInterval(pkLockTimer);
    var go = $('#pk-go');
    function tick() {
      var left = pkLockEnd - Date.now();
      if (left <= 0) { clearInterval(pkLockTimer); go.disabled = false; $('#pk-error').textContent = 'もう一度入力できます'; return; }
      go.disabled = true;
      $('#pk-error').textContent = 'パスキーを間違えたため入力できません。あと ' + Math.floor(left / 60000) + '分' + pad(Math.floor(left / 1000) % 60) + '秒で入力できます';
    }
    tick(); pkLockTimer = setInterval(tick, 1000);
  }
  // the hour: a warning five minutes before, and the page starts over when it is up
  function pkSchedule(until) {
    clearTimeout(pkTimer); clearTimeout(pkWarn);
    var left = until - Date.now();
    pkWarn = setTimeout(function () { toast('あと5分で、パスキーをもう一度入力することになります'); }, Math.max(0, left - 5 * 60000));
    pkTimer = setTimeout(function () { location.reload(); }, Math.max(0, left));
  }
  function onPasskey(e) {
    e.preventDefault();
    if (Date.now() < pkLockEnd) return;
    var code = $('#pk-code').value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) { $('#pk-error').textContent = '6桁の数字を入力してください'; return; }
    var go = $('#pk-go'); go.disabled = true; $('#pk-error').textContent = '';
    OpsPk.publicKey().then(function (pub) {
      return raw('POST', '/api/pk/open', { passkey: code, pub: pub });
    }).then(function (r) {
      OpsPk.open(r.gid, r.until);
      pkSchedule(r.until);
      $('#pk').hidden = true; $('#pk-code').value = '';
      return api('GET', '/api/sec/me').then(start);
    }).catch(function (err) {
      if (err.code === 'pk_wrong' || err.code === 'pk_locked') { $('#pk-error').textContent = err.message; if (err.until) pkWait(err.until); return; }
      go.disabled = false;
      if (err.code === 'identity_changed') return;
      if (err.status !== 401 && err.code !== 'not_operator' && err.code !== 'pk_required') $('#pk-error').textContent = err.message || 'エラーが発生しました';
    });
  }
  function showLogin(message) {
    $('#pk').hidden = true;
    $('#app').hidden = true; $('#login').hidden = false;
    $('#login-error').textContent = message || '';
    // (a name tried in this tab comes back after a reload; the server says how long it must still wait)
    var last = '';
    try { last = sessionStorage.getItem(NAME_KEY) || ''; } catch (e) { last = ''; }
    if (last && !$('#login-name').value) $('#login-name').value = last;
    askWait();
    setTimeout(askWait, 900);
    clearInterval(timer);
    clearInterval(aliveTimer);
    document.body.classList.remove('role-viewer');
    setTimeout(function () { $('#login-name').focus(); }, 50);
  }
  // signed out: what this operator saw goes with them, so the next one starts clean
  function signedOut(message) {
    setToken(null); me = null; meId = 0; session++;
    OpsPk.close();
    wipe();
    showLogin(message);
  }
  // the server forgets a token (best effort)
  function revoke(t) {
    if (t) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
  }
  // The wait after wrong tries is the server's (server/core/opslogin.js): it counts it and says how much is left; this page only shows
  // that, so a reload or another tab shows the same count.
  function lockRest() { return lockLeft > 0 ? Math.max(0, lockLeft - (performance.now() - lockStamp)) : 0; }
  function showWait(left, scope) {
    lockLeft = left; lockStamp = performance.now(); clearInterval(lockTimer);
    var go = $('#login-go'), what = scope === 'account' ? 'このアカウントは入力制限中です' : 'この接続からの入力が制限されています';
    function tick() {
      var rest = lockRest();
      if (rest <= 0) { clearInterval(lockTimer); askWait(true); return; }
      go.disabled = true;
      $('#login-error').textContent = what + '。あと ' + Math.floor(rest / 60000) + '分' + pad(Math.floor(rest / 1000) % 60) + '秒';
    }
    tick(); lockTimer = setInterval(tick, 1000);
  }
  function clearWait(said) {
    var was = lockLeft > 0;
    clearInterval(lockTimer); lockLeft = 0;
    $('#login-go').disabled = false;
    if (was || /入力制限|制限されて/.test($('#login-error').textContent)) $('#login-error').textContent = said ? 'もう一度入力できます' : '';
  }
  function askWait(ended) {
    var name = $('#login-name').value.trim(), seq = ++askSeq;
    raw('POST', '/api/ops/login-wait', { name: name }, { 'X-Ops-Device': device() }).then(function (r) {
      if (seq !== askSeq || $('#login').hidden) return;
      if (r.left > 0) showWait(r.left, r.scope); else clearWait(ended === true);
    }, function () { /* the login itself tells the wait when it is tried */ });
  }
  function askSoon() { clearTimeout(askTimer); askTimer = setTimeout(askWait, 350); }
  function onLogin(e) {
    e.preventDefault();
    if (lockRest() > 0) return;
    var name = $('#login-name').value.trim(), pass = $('#login-pass').value;
    if (!name || !pass) { $('#login-error').textContent = '名前とパスワードを入力してください'; return; }
    var go = $('#login-go'); go.disabled = true; $('#login-error').textContent = '';
    try { sessionStorage.setItem(NAME_KEY, name); } catch (e2) { /* the page asks for what is typed */ }
    setToken(null);   // (one left from before is of no use: a new one comes)
    var dev = device();
    // (what the browser can say of the device goes with the login, to be written to the log if the try is wrong)
    (window.OpsDevice ? OpsDevice.collect('sec', deviceNew) : Promise.resolve({})).then(function (client) {
      return raw('POST', '/api/ops/login', { name: name, password: pass, otp: $('#login-otp').value.trim(), phrase: $('#login-phrase').value, recovery: $('#login-backup').value.trim(), client: client }, { 'X-Ops-Device': dev });
    }).then(function (r) {
      setToken(r.token);
      return api('GET', '/api/sec/me').then(function (m) {
        $('#login-pass').value = ''; $('#login-otp').value = ''; $('#login-phrase').value = ''; $('#login-backup').value = ''; $('#login-extra').open = false;
        try { sessionStorage.removeItem(NAME_KEY); } catch (e2) { /* nothing was kept */ }
        start(m);
      }, function (err) {
        // the passkey is asked for next (its page is up already): the login stays
        if (err.code === 'pk_required' || err.code === 'pk_expired') { $('#login-pass').value = ''; $('#login-otp').value = ''; $('#login-phrase').value = ''; $('#login-backup').value = ''; return; }
        if (err.code === 'identity_changed') return;
        revoke(r.token);
        setToken(null); throw err;
      });
    }).catch(function (err) {
      if (err.code === 'mfa_required' || err.code === 'mfa_invalid') { $('#login-extra').open = true; $('#login-otp').focus(); }
      if (err.code === 'ops_locked') { showWait(err.left || Math.max(1000, (err.until || 0) - Date.now()), err.scope); return; }
      $('#login-error').textContent = err.message;
    }).then(function () { if (lockRest() <= 0) go.disabled = false; });
  }
  function logout() {
    var c = chan;
    // (the channel is ended first, while the login still stands; then the login)
    (c ? c.close() : Promise.resolve()).then(function () { revoke(token); signedOut('出ました'); });
  }

  /* ------------------------------------------------------------ the shell: the panels this person has --- */
  var ICONS = {
    overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', threats: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 8v5M12 16v.5',
    posture: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 5-5', log: 'M5 6h14M5 12h14M5 18h9', chat: 'M4 5h16v11H9l-5 4z',
    lockdown: 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z', 'dev-patrol': 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
    'dev-stele': 'M7 21V8a5 5 0 0110 0v13zM10 12h4M10 16h4', 'dev-channels': 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
    'dev-access': 'M15 8a4 4 0 11-2.8 6.8L4 15v3h3v-2h2v-2h2.2M16 7.5h.01'
  };
  function icon(id) {
    var s = svg('svg', { viewBox: '0 0 24 24', width: '22', height: '22', 'aria-hidden': 'true', 'class': 'ico' });
    s.appendChild(svg('path', { d: ICONS[id] || ICONS.overview, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    return s;
  }
  // a panel's page registers itself here (the developer's, from dev.js, only if the server listed one)
  function register(id, def) { defs[id] = def; }
  function build(list) {
    var rail = $('#rail'), stage = $('#stage');
    rail.textContent = ''; stage.textContent = ''; panels = {}; order = [];
    list.forEach(function (p) {
      var def = defs[p.id];
      if (!def) return;
      var b = el('button', 'rail-item'); b.type = 'button'; b.dataset.panel = p.id; b.setAttribute('aria-label', p.name);
      b.appendChild(icon(p.id)); b.appendChild(el('span', '', p.name));
      if (p.id === 'chat') b.appendChild(el('b', 'count', '')).hidden = true;
      b.addEventListener('click', function () { select(p.id); });
      rail.appendChild(b);
      var sec = el('section', 'panel'); sec.id = 'panel-' + p.id; sec.hidden = true; sec.setAttribute('aria-label', p.name);
      stage.appendChild(sec);
      panels[p.id] = { node: sec, rail: b, def: def, built: false, name: p.name };
      order.push(p.id);
    });
  }
  function select(id) {
    var p = panels[id];
    if (!p) return;
    view = id;
    order.forEach(function (k) { var on = k === id; panels[k].node.hidden = !on; panels[k].rail.classList.toggle('on', on); panels[k].rail.setAttribute('aria-current', on ? 'page' : 'false'); });
    if (!p.built) { p.built = true; p.def.build(p.node, p.name); }
    if (p.def.show) p.def.show();
  }
  function ensureDev(list) {
    if (!list.some(function (p) { return /^dev-/.test(p.id); }) || devLoaded) return Promise.resolve();
    // (the developer's panels are fetched only when the server has said this person has them)
    return new Promise(function (resolve) {
      var s = document.createElement('script'); s.src = 'dev.js'; s.onload = function () { devLoaded = true; resolve(); }; s.onerror = function () { resolve(); };
      document.head.appendChild(s);
    });
  }

  /* ------------------------------------------------------------ start --- */
  // A 閲覧者 (viewer): the status, the threats, the posture and the log only — no channel, no lockdown (the server refuses them anyway) —
  // and every 2 seconds the question whether they still may: taken away, they are out at once.
  function start(m) {
    me = m; meId = m.id || 0; session++; statusErr = '';
    var s = session;
    $('#login').hidden = true; $('#pk').hidden = true; $('#identity').hidden = true; $('#app').hidden = false;
    $('#op-name').textContent = (m.developer ? '開発者: ' : m.viewer ? '閲覧者: ' : '運営者: ') + m.name;
    document.body.classList.toggle('role-viewer', !!m.viewer);
    $('#speed').disabled = !m.developer;
    $('#speed').title = m.developer ? '更新頻度（運営者全員に反映）' : '更新頻度は開発者だけが変えられます';
    useSpeed(m.speed, false);
    ensureDev(m.panels || []).then(function () {
      if (s !== session) return;
      build(m.panels || []);
      select('overview');
      tick(true);
      startTimer();
    });
  }
  function tick(first) {
    if (!me) return;
    tickN++;
    loadStatus();
    if (first || tickN % 3 === 0 || view === 'threats') loadThreats();
    if (first || tickN % 6 === 0 || view === 'posture') loadPosture();
    Object.keys(panels).forEach(function (k) { if (panels[k].built && panels[k].def.tick && (k === view || panels[k].def.always)) panels[k].def.tick(first); });
  }
  function useSpeed(v, restart) {
    if (!SPEEDS[v]) v = 'normal';
    $('#speed').value = v;
    if (v === speed) return;
    speed = v;
    if (restart) startTimer();
  }
  function startTimer() {
    clearInterval(timer);
    clearInterval(aliveTimer);
    timer = setInterval(function () { if (seen()) tick(false); }, SPEEDS[speed]);
    if (me && me.viewer) aliveTimer = setInterval(function () { if (seen() && me) api('GET', '/api/sec/me').catch(function () {}); }, 2000);
  }
  // In sight: the page is shown (not a tab in the background) and, inside the operator site, its window is not put away (the page cannot tell it
  // by itself: its document still says it is visible; the site tells it: ops/ops.js setView). Nothing is asked for what nobody looks at.
  var framed = true;
  function seen() { return framed && !document.hidden; }

  /* ------------------------------------------------------------ data --- */
  var loadStatus = single(function () {
    var s = session;
    return api('GET', '/api/sec/status').then(function (r) {
      if (s !== session) return;
      statusErr = ''; $('#stage').classList.remove('stale');
      if (r.speed) useSpeed(r.speed, true);
      data.status = r;
      renderLock(r);
      Object.keys(panels).forEach(function (k) { if (panels[k].built && panels[k].def.status) panels[k].def.status(r); });
    }, function (err) {
      if (s !== session) return;
      // what is shown is no longer live; the same trouble every tick is told once
      $('#stage').classList.add('stale');
      if (err.message !== statusErr) fail(err);
      statusErr = err.message;
    });
  });
  var loadThreats = single(function () {
    var s = session;
    return api('GET', '/api/sec/threats').then(function (r) {
      if (s !== session) return;
      data.threats = r;
      Object.keys(panels).forEach(function (k) { if (panels[k].built && panels[k].def.threats) panels[k].def.threats(r); });
    });
  });
  var loadPosture = single(function () {
    var s = session;
    return api('GET', '/api/sec/posture').then(function (r) {
      if (s !== session) return;
      data.posture = r;
      Object.keys(panels).forEach(function (k) { if (panels[k].built && panels[k].def.posture) panels[k].def.posture(r); });
    });
  });
  // the lockdown banner, and the buttons that follow the state
  function renderLock(s) {
    var em = s.emergency || {};
    locked = em.level === 'lockdown';
    $('#lock-banner').hidden = !locked;
    document.body.classList.toggle('is-locked', locked);
    if (locked) $('#lock-sub').textContent = stamp(em.at) + ' から・' + (em.reason || '') + (em.releaseAt ? '・自動解除 ' + stamp(em.releaseAt) : '');
    $('#lock-release').hidden = !!(me && me.viewer);
  }

  /* ------------------------------------------------------------ small drawing helpers --- */
  function card(cls, title, sub) {
    var c = el('article', 'card ' + cls), h = el('header', 'card-head');
    h.appendChild(el('h3', '', title));
    if (sub) h.appendChild(el('small', 'muted', sub));
    c.appendChild(h);
    return c;
  }
  function tile(box, label, value, cls, note) {
    var s = el('div', 'tile' + (cls ? ' ' + cls : ''));
    s.appendChild(el('span', '', label)); s.appendChild(el('b', '', value));
    if (note) s.appendChild(el('small', '', note));
    box.appendChild(s);
    return s;
  }
  function lines(svgEl, hist, series, w, h) {
    svgEl.textContent = '';
    if (!hist || hist.length < 2) return;
    var n = hist.length;
    series.forEach(function (s) {
      var max = 1;
      hist.forEach(function (x) { max = Math.max(max, s.f(x)); });
      var d = '';
      hist.forEach(function (x, k) { d += (k ? 'L' : 'M') + (k / (n - 1) * w).toFixed(1) + ' ' + (h - 3 - s.f(x) / max * (h - 8)).toFixed(1); });
      if (s.fill) svgEl.appendChild(svg('path', { d: d + 'L' + w + ' ' + h + 'L0 ' + h + 'Z', 'class': 'area ' + s.cls }));
      svgEl.appendChild(svg('path', { d: d, 'class': 'line ' + s.cls }));
    });
  }
  function bars(svgEl, hours, w, h) {
    svgEl.textContent = '';
    var max = 1;
    hours.forEach(function (x) { max = Math.max(max, x[1]); });
    var bw = w / hours.length;
    hours.forEach(function (x, i) {
      var bh = x[1] ? Math.max(3, x[1] / max * (h - 6)) : 1.5;
      svgEl.appendChild(svg('rect', { x: (i * bw + 1).toFixed(1), y: (h - bh).toFixed(1), width: (bw - 2).toFixed(1), height: bh.toFixed(1), rx: '2', 'class': 'bar' + (x[1] ? ' on' : '') }));
    });
  }
  function logLine(x, go) {
    var r = el('button', 'mini'); r.type = 'button';
    r.appendChild(el('span', 'time', String(x.jst || '').replace(/^\d+\//, '').replace(/\.\d+ JST$/, '')));
    r.appendChild(el('span', 'lk k-' + x.kind, KINDS[x.kind] || ''));
    r.appendChild(el('span', 'sum', x.summary));
    if (go) r.addEventListener('click', go);
    return r;
  }
  function blockRow(b) {
    var r = el('div', 'row');
    r.appendChild(el('span', 'tag ' + b.scope, b.scope === 'ip' ? 'IP' : b.scope === 'account' ? 'アカウント' : '端末'));
    r.appendChild(el('span', 'target', b.target));
    if (b.manual) r.appendChild(el('span', 'tag manual', '手動'));
    r.appendChild(el('span', 'why', (b.reason || '') + (b.until ? '｜あと' + Math.max(1, Math.round((b.until - Date.now()) / 60000)) + '分' : '｜解除まで')));
    return r;
  }
  function attackerRow(x) {
    var r = el('div', 'row');
    r.appendChild(el('span', 'target', x.ip));
    if (x.flags && x.flags.length) r.appendChild(el('span', 'why', x.flags.join('・')));
    r.appendChild(el('span', 'score', fmt(x.score)));
    return r;
  }
  function empty(t) { return el('p', 'empty', t); }

  /* ------------------------------------------------------------ 全体の状況 --- */
  var O = {};
  register('overview', {
    reset: function () { O = {}; },
    build: function (root) {
      var grid = el('div', 'grid');
      // the threat level
      var lv = card('c-level', '脅威レベル', 'TWO STATE と運営サイト'); O.ring = el('div', 'ring lv-safe'); O.ringWord = el('b', '', '—'); O.ring.appendChild(O.ringWord); O.ring.appendChild(el('span', '', '総合'));
      O.facts = el('div', 'facts'); var body = el('div', 'level-body'); body.appendChild(O.ring); body.appendChild(O.facts); lv.appendChild(body); grid.appendChild(lv);
      // TWO STATE's server
      var sv = card('c-server', 'TWO STATE のサーバー', 'リアルタイム'); O.tiles = el('div', 'tiles'); sv.appendChild(O.tiles);
      O.chart = svg('svg', { viewBox: '0 0 320 64', preserveAspectRatio: 'none', 'class': 'chart', 'aria-hidden': 'true' }); sv.appendChild(O.chart);
      var lg = el('div', 'legend'); lg.appendChild(el('span', 'lg-req', 'リクエスト')); lg.appendChild(el('span', 'lg-atk', '攻撃・フラッド')); sv.appendChild(lg); grid.appendChild(sv);
      // the threats to the operator site
      var st = card('c-site', '運営サイトの脅威情報', '直近24時間のログから'); O.signals = el('div', 'signals'); st.appendChild(O.signals);
      O.hours = svg('svg', { viewBox: '0 0 240 40', preserveAspectRatio: 'none', 'class': 'chart', 'aria-hidden': 'true' }); st.appendChild(O.hours); grid.appendChild(st);
      // how the server is guarded
      var po = card('c-posture', '守りの状態'); O.posture = el('div', 'posture-list'); po.appendChild(O.posture); grid.appendChild(po);
      // what is blocked and who attacks
      var bl = card('c-blocks', 'ブロックと攻撃元'); O.blocks = el('div', 'rows'); bl.appendChild(O.blocks); grid.appendChild(bl);
      // the operators
      var op = card('c-ops', '運営者'); O.ops = el('div', 'rows'); op.appendChild(O.ops); grid.appendChild(op);
      // the log in short
      var lg6 = card('c-log', 'セキュリティのログ', '新しい順'); O.log = el('div', 'minis'); lg6.appendChild(O.log); grid.appendChild(lg6);
      root.appendChild(grid);
    },
    status: function (s) {
      var sh = s.shield || {}, h = s.health || {}, sv = s.server || {}, p = sh.pressure || {}, m5 = sh.last5m || {};
      var info = LEVELS[s.level] || LEVELS.safe;
      O.ring.className = 'ring lv-' + (LEVELS[s.level] ? s.level : 'safe');
      O.ring.style.setProperty('--pct', info.pct + '%');
      O.ringWord.textContent = info.word;
      O.facts.textContent = '';
      [['直近5分の攻撃', fmt(m5.attacks || 0)], ['ブロック中', fmt((sh.blocks || []).length)], ['攻撃元アドレス', (p.attackers || 0) + ' / ' + (p.breachAt || 8)],
        ['鍵への総当たり', (p.criticals || 0) + ' / ' + (p.criticalAt || 40)], ['運営サイトの脅威度', fmt((s.site || {}).score || 0)]].forEach(function (f) {
        var d = el('div'); d.appendChild(el('span', '', f[0])); d.appendChild(el('b', '', f[1])); O.facts.appendChild(d);
      });
      // the server
      var live = sv.live || {}, l10 = (sv.rate || {}).last10 || { requests: 0, bytes: 0, seconds: 10 }, sec = Math.max(1, l10.seconds || 10), us = sv.usage || { percent: 0, yen: 0 };
      O.tiles.textContent = '';
      tile(O.tiles, 'プレイヤー接続', fmt(h.online || live.online || 0));
      tile(O.tiles, '運営者オンライン', fmt(h.operatorsOnline || live.operatorsOnline || 0));
      tile(O.tiles, 'リクエスト', (l10.requests / sec).toFixed(1) + '/秒');
      tile(O.tiles, '送信', bytes(l10.bytes / sec) + '/秒');
      tile(O.tiles, '今月の使用量', Number(us.percent || 0).toFixed(1) + '%', Number(us.percent) >= 80 ? 'hot' : Number(us.percent) >= 50 ? 'warn' : '', '約' + fmt(us.yen) + '円');
      tile(O.tiles, 'データベース', h.dbBytes == null ? '-' : bytes(h.dbBytes));
      tile(O.tiles, '外部通信', h.outbound ? '通常' : '遮断中', h.outbound ? '' : 'hot');
      tile(O.tiles, 'サーバー', h.host || sv.host || '-', '', h.startedAt ? '稼働 ' + span(Date.now() - h.startedAt) : '');
      lines(O.chart, sh.history || [], [{ f: function (x) { return x[1]; }, cls: 'req', fill: true }, { f: function (x) { return x[2] + x[3]; }, cls: 'atk' }], 320, 64);
      // blocks and attackers
      O.blocks.textContent = '';
      var blocks = sh.blocks || [], tops = (sh.topAttackers || []).filter(function (x) { return x.score > 0; });
      if (!blocks.length && !tops.length) O.blocks.appendChild(empty('ブロック中のものも、脅威も、ありません'));
      blocks.slice(0, 6).forEach(function (b) { O.blocks.appendChild(blockRow(b)); });
      if (tops.length) { O.blocks.appendChild(el('h4', '', '脅威スコアの高いアドレス')); tops.slice(0, 5).forEach(function (x) { O.blocks.appendChild(attackerRow(x)); }); }
      // operators
      O.ops.textContent = '';
      (s.operators || []).forEach(function (o) {
        var r = el('div', 'row');
        r.appendChild(el('span', 'dot ' + (o.base || o.site ? 'site' : o.game ? 'game' : ''), ''));
        r.appendChild(el('span', 'target', o.name));
        if (o.developer) r.appendChild(el('span', 'tag manual', '開発者'));
        r.appendChild(el('span', 'why', o.base ? 'セキュリティ基地' : o.site ? '運営サイト' : o.game ? 'ゲーム中' : ago(o.seenAt)));
        O.ops.appendChild(r);
      });
      // the log in short
      O.log.textContent = '';
      (s.security || []).slice(0, 8).forEach(function (x) { O.log.appendChild(logLine(x, panels.log ? function () { select('log'); } : null)); });
      if (!(s.security || []).length) O.log.appendChild(empty('記録はありません'));
    },
    threats: function (t) { overviewThreats(t); },
    posture: function (p) { overviewPosture(p); }
  });
  function signalList(box, t, full) {
    box.textContent = '';
    (t.signals || []).forEach(function (x) {
      var r = el('div', 'signal lv-' + x.level);
      r.appendChild(el('i', 'dot'));
      r.appendChild(el('span', 'name', x.name));
      r.appendChild(el('span', 'n', x.n1h ? '1時間 ' + fmt(x.n1h) + '件' : x.n24h ? '24時間 ' + fmt(x.n24h) + '件' : 'なし'));
      if (full) r.appendChild(el('span', 'last', x.last ? ago(x.last) : '-'));
      box.appendChild(r);
    });
  }
  function overviewThreats(t) {
    if (!O.signals) return;
    signalList(O.signals, t, false);
    bars(O.hours, t.hours || [], 240, 40);
  }
  function overviewPosture(p) {
    if (!O.posture) return;
    O.posture.textContent = '';
    (p.items || []).forEach(function (x) {
      var r = el('div', 'check ' + (x.ok === null ? 'idle' : x.ok ? 'ok' : 'bad'));
      r.appendChild(el('i', 'dot')); r.appendChild(el('span', 'name', x.name)); r.appendChild(el('small', '', x.detail));
      O.posture.appendChild(r);
    });
  }

  /* ------------------------------------------------------------ 脅威情報 --- */
  var T = {};
  register('threats', {
    reset: function () { T = {}; },
    build: function (root) {
      var grid = el('div', 'grid two');
      var a = card('wide', '運営サイトへの脅威', 'ログに残った出来事の数（直近1時間・24時間）'); T.signals = el('div', 'signals full'); a.appendChild(T.signals);
      T.hours = svg('svg', { viewBox: '0 0 240 56', preserveAspectRatio: 'none', 'class': 'chart tall', 'aria-hidden': 'true' }); a.appendChild(T.hours);
      a.appendChild(el('p', 'muted fine', '左が24時間前、右がいま。1本が1時間です。'));
      grid.appendChild(a);
      var b = card('', 'ブロック中'); T.blocks = el('div', 'rows'); b.appendChild(T.blocks); grid.appendChild(b);
      var c = card('', '脅威スコアの高いアドレス'); T.attackers = el('div', 'rows'); c.appendChild(T.attackers); grid.appendChild(c);
      var d = card('wide', '直近のセキュリティの記録'); T.recent = el('div', 'minis'); d.appendChild(T.recent); grid.appendChild(d);
      root.appendChild(grid);
    },
    show: function () { loadThreats(); if (data.threats) this.threats(data.threats); },
    threats: function (t) {
      signalList(T.signals, t, true);
      bars(T.hours, t.hours || [], 240, 56);
      T.blocks.textContent = ''; (t.blocks || []).slice(0, 30).forEach(function (b) { T.blocks.appendChild(blockRow(b)); });
      if (!(t.blocks || []).length) T.blocks.appendChild(empty('ブロック中のものはありません'));
      T.attackers.textContent = ''; (t.attackers || []).forEach(function (x) { T.attackers.appendChild(attackerRow(x)); });
      if (!(t.attackers || []).length) T.attackers.appendChild(empty('脅威は検知されていません'));
      T.recent.textContent = ''; (t.recent || []).forEach(function (x) { T.recent.appendChild(logLine(x, function () { if (panels.log) select('log'); })); });
    }
  });

  /* ------------------------------------------------------------ 守りの状態 --- */
  var P = {};
  register('posture', {
    reset: function () { P = {}; },
    build: function (root) {
      var grid = el('div', 'grid two');
      var a = card('', 'サーバーの申告', 'サーバーが自分の設定として答えたもの'); P.list = el('div', 'posture-list big'); a.appendChild(P.list); grid.appendChild(a);
      var b = card('', 'この接続の確認', 'このページ自身が確かめたもの'); P.checks = el('ul', 'checks'); b.appendChild(P.checks); P.id = el('div', 'identity'); b.appendChild(P.id); grid.appendChild(b);
      root.appendChild(grid);
    },
    show: function () { loadPosture(); this.draw(); },
    posture: function (p) { this.draw(p); },
    draw: function (p) {
      p = p || data.posture;
      var info = chanInfo;
      if (P.checks) {
        P.checks.textContent = '';
        if (info && !info.error) {
          CHECKS.forEach(function (c) {
            var bad = info.problems.indexOf(c[0]) >= 0, li = el('li', bad ? 'bad' : 'ok');
            li.appendChild(el('i', 'dot')); li.appendChild(el('span', '', c[1]));
            if (bad && PROBLEMS[c[0]]) li.appendChild(el('small', '', PROBLEMS[c[0]]));
            P.checks.appendChild(li);
          });
        } else P.checks.appendChild(empty('まだ確かめていません'));
        P.id.textContent = '';
        if (info && info.fp) {
          P.id.appendChild(el('span', 'muted', 'サーバーの身元（署名の鍵の指紋）'));
          P.id.appendChild(el('code', 'fp', info.fp));
          P.id.appendChild(el('small', 'muted', (info.pin === 'new' ? 'この端末では初めて記録しました。次からは、これと違うと接続を止めます。' : '前回記録したものと同じです。') + (p && p.identity ? '　サーバー側の記録：' + stamp(p.identity.since) : '')));
        }
      }
      if (P.list && p) {
        P.list.textContent = '';
        (p.items || []).forEach(function (x) {
          var r = el('div', 'check ' + (x.ok === null ? 'idle' : x.ok ? 'ok' : 'bad'));
          r.appendChild(el('i', 'dot')); r.appendChild(el('span', 'name', x.name)); r.appendChild(el('small', '', x.detail));
          P.list.appendChild(r);
        });
      }
    }
  });

  /* ------------------------------------------------------------ ログ --- */
  var L = { log: [], q: '', kind: '', done: false, gen: 0, busy: false, timer: 0 };
  register('log', {
    reset: function () { L.log = []; L.gen++; L.q = ''; L.kind = ''; },
    build: function (root) {
      var head = el('div', 'log-head'), search = el('input', 'search'); search.type = 'search'; search.placeholder = '名前・内容で探す'; search.autocomplete = 'off'; search.spellcheck = false; search.setAttribute('aria-label', 'ログを探す');
      search.addEventListener('input', function () { clearTimeout(L.timer); L.timer = setTimeout(function () { L.q = search.value.trim(); loadLog(); }, 300); });
      head.appendChild(search);
      var verifyBtn = el('button', 'btn small', 'ログ整合性を確認'); verifyBtn.type = 'button'; verifyBtn.addEventListener('click', verify); head.appendChild(verifyBtn);
      root.appendChild(head);
      L.verify = el('p', 'verify'); root.appendChild(L.verify);
      var chips = el('div', 'chips');
      [['', 'すべて'], ['security', 'セキュリティ'], ['emergency', '緊急'], ['operator', '運営'], ['player', 'プレイヤー'], ['vault', '保管庫']].forEach(function (k, i) {
        var c = el('button', 'chip' + (i ? '' : ' on'), k[1]); c.type = 'button';
        c.addEventListener('click', function () { L.kind = k[0]; Array.prototype.forEach.call(chips.children, function (x) { x.classList.toggle('on', x === c); }); loadLog(); });
        chips.appendChild(c);
      });
      root.appendChild(chips);
      L.list = el('div', 'log'); root.appendChild(L.list);
      L.more = el('button', 'btn wide small', 'さらに読み込む'); L.more.type = 'button'; L.more.hidden = true; L.more.addEventListener('click', moreLog); root.appendChild(L.more);
    },
    show: function () { if (!L.log.length) loadLog(); else refreshLog(); },
    tick: function () { if (!L.q) refreshLog(); }
  });
  // (lines only; a line's detail is fetched when it is opened; what is new is asked for by number, so it is a few lines and not the page again)
  function logUrl(before, since) { return '/api/sec/log?slim=1&q=' + encodeURIComponent(L.q) + '&kind=' + encodeURIComponent(L.kind) + (before ? '&before=' + before : '') + (since ? '&since=' + since : ''); }
  // the list from the start (signing in, a search, a kind)
  function loadLog() {
    var gen = ++L.gen, s = session, list = L.list;
    L.log = []; L.done = false; list.textContent = ''; list.scrollTop = 0;
    list.appendChild(empty('読み込み中…'));
    L.more.hidden = true;
    api('GET', logUrl(0)).then(function (r) {
      if (gen !== L.gen || s !== session) return;
      list.textContent = '';
      L.log = r.entries;
      if (!L.log.length) list.appendChild(empty('記録はありません'));
      L.log.forEach(function (x) { list.appendChild(logEntry(x)); });
      L.done = L.log.length < PAGE;
      L.more.hidden = L.done || !!L.q;
    }, function (err) {
      if (gen !== L.gen || s !== session) return;
      list.textContent = ''; list.appendChild(empty('読み込めませんでした'));
      if (err.status) fail(err);
    });
  }
  // the newer entries on top, quietly: what is open, read further down and scrolled to stays as it is
  var refreshLog = single(function () {
    var gen = L.gen, s = session, top = L.log.length ? L.log[0].id : 0;
    return api('GET', logUrl(0, top)).then(function (r) {
      if (gen !== L.gen || s !== session) return;
      var fresh = r.entries.filter(function (x) { return x.id > top; });
      if (!fresh.length) return;
      // a whole page came in since the last look: start over rather than leave a gap
      if (top && fresh.length >= PAGE) { loadLog(); return; }
      var list = L.list, at = list.scrollTop, height = list.scrollHeight;
      var none = list.querySelector('.empty'); if (none) list.removeChild(none);
      var rows = document.createDocumentFragment();
      fresh.forEach(function (x) { rows.appendChild(logEntry(x)); });
      list.insertBefore(rows, list.firstChild);
      L.log = fresh.concat(L.log);
      if (at > 0) list.scrollTop = at + list.scrollHeight - height;
      if (!top) { L.done = r.entries.length < PAGE; L.more.hidden = L.done || !!L.q; }
    });
  });
  // the older entries at the end (one page at a time, never the same twice)
  function moreLog() {
    if (L.busy || L.done || !L.log.length) return;
    var gen = L.gen, s = session, btn = L.more;
    L.busy = true; btn.disabled = true;
    api('GET', logUrl(L.log[L.log.length - 1].id)).then(function (r) {
      if (gen !== L.gen || s !== session) return;
      r.entries.forEach(function (x) { L.list.appendChild(logEntry(x)); });
      L.log = L.log.concat(r.entries);
      L.done = r.entries.length < PAGE;
      btn.hidden = L.done || !!L.q;
    }, function (err) { if (err.status) fail(err); }).then(function () { L.busy = false; btn.disabled = false; });
  }
  function logEntry(x) {
    var row = el('div', 'entry');
    var line = el('button', 'entry-line'); line.type = 'button';
    line.appendChild(el('span', 'time', String(x.jst || '').replace(/\.\d+ JST$/, '')));
    line.appendChild(el('span', 'lk k-' + x.kind, KINDS[x.kind] || ''));
    line.appendChild(el('span', 'sum', x.summary));
    line.addEventListener('click', function () {
      var open = row.classList.toggle('open');
      var d = row.querySelector('.entry-detail');
      if (!open) { if (d) d.hidden = true; return; }
      if (d) { d.hidden = false; return; }
      // the whole line is fetched now (the list has only the line)
      var box = el('div', 'entry-detail'); box.appendChild(empty('読み込み中…')); row.appendChild(box);
      api('GET', '/api/sec/log/entries?ids=' + x.id).then(function (r) {
        var full = (r.entries || [])[0];
        if (!full) { box.textContent = ''; box.appendChild(empty('読み込めませんでした')); return; }
        row.replaceChild(logDetail(full), box);
      }, function (err) { box.textContent = ''; box.appendChild(empty('読み込めませんでした')); if (err.status) fail(err); });
    });
    row.appendChild(line);
    return row;
  }
  function logDetail(x) {
    var box = el('div', 'entry-detail');
    var t = el('table');
    var req = (x.detail && x.detail.request) || {};
    [['記録番号', '#' + x.id], ['内容', x.summary], ['操作', actionName(x.action) + '（' + x.action + '）'],
      ['日時', x.jst], ['実行', x.actor.name + (x.actor.id ? '（ID ' + x.actor.id + '）' : '')], ['対象', x.target ? x.target.name : '-'],
      ['IPアドレス', req.ip || '-'], ['ブラウザ・端末', req.userAgent || '-'], ['この記録のハッシュ', x.hash]].forEach(function (r) {
      var tr = el('tr'); tr.appendChild(el('th', '', r[0])); tr.appendChild(el('td', r[0].indexOf('ハッシュ') >= 0 ? 'mono' : '', r[1])); t.appendChild(tr);
    });
    box.appendChild(t);
    var rest = {};
    Object.keys(x.detail || {}).forEach(function (k) { if (k !== 'time' && k !== 'request') rest[k] = x.detail[k]; });
    if (Object.keys(rest).length) box.appendChild(el('pre', '', JSON.stringify(rest, null, 2)));
    return box;
  }
  function verify() {
    var v = L.verify; v.className = 'verify'; v.textContent = '確認中…';
    api('GET', '/api/sec/verify').then(function (r) {
      v.className = 'verify ' + (r.ok ? 'ok' : 'bad');
      v.textContent = r.ok ? '✓ ログ整合性：' + fmt(r.count) + '件すべて正しくつながっています' : '⚠ ' + (r.brokenAt || '') + '番で異常（' + (r.reason || '') + '）';
    }, function () { v.className = 'verify bad'; v.textContent = '確認できませんでした'; });
  }

  /* ------------------------------------------------------------ 連絡チャンネル --- */
  var C = { lastId: 0, seen: 0, unread: 0, loaded: false, sending: false };
  function readSeen() { try { return Number(localStorage.getItem(SEEN_KEY + meId)) || 0; } catch (e) { return 0; } }
  function saveSeen() { try { localStorage.setItem(SEEN_KEY + meId, String(C.seen)); } catch (e) { /* this tab */ } }
  function markChat() {
    var open = view === 'chat', b = panels.chat && panels.chat.rail.querySelector('.count');
    if (b) { b.hidden = open || !C.unread; b.textContent = C.unread > 99 ? '99+' : String(C.unread); }
    securityNotice({ count: open ? 0 : C.unread });
  }
  // the channel is in sight: everything in it is read
  function markSeen() { C.seen = Math.max(C.seen, C.lastId); C.unread = 0; saveSeen(); markChat(); }
  register('chat', {
    always: true,
    reset: function () { C = { lastId: 0, seen: 0, unread: 0, loaded: false, sending: false }; },
    build: function (root) {
      root.appendChild(el('p', 'hint muted', '運営者だけの連絡チャンネルです。メッセージはセキュア通信で送られ、サーバーには暗号化して保存されます（データベースを直接見ても読めません）。ロックダウン中もここは使えます。'));
      C.scroll = el('div', 'chat-scroll'); C.list = el('div', 'chat-list'); C.scroll.appendChild(C.list); root.appendChild(C.scroll);
      var form = el('form', 'chat-compose'), ta = el('textarea'); ta.rows = 2; ta.maxLength = 4000; ta.placeholder = 'メッセージ（Ctrl+Enter で送信）'; ta.setAttribute('aria-label', 'メッセージ');
      var send = el('button', 'btn primary', '送信'); send.type = 'submit';
      form.appendChild(ta); form.appendChild(send); root.appendChild(form);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = ta.value.trim();
        if (!text || C.sending) return;
        C.sending = true;
        api('POST', '/api/sec/messages', { text: text }).then(function () { ta.value = ''; loadChat(); }, fail).then(function () { C.sending = false; });
      });
      ta.addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); form.dispatchEvent(new Event('submit', { cancelable: true })); } });
      C.seen = readSeen();
    },
    show: function () { markSeen(); loadChat(); C.scroll.scrollTop = C.scroll.scrollHeight; },
    tick: function () { loadChat(); }
  });
  var loadChat = single(function () {
    var s = session;
    if (!panels.chat || !panels.chat.built) return Promise.resolve();
    return api('GET', '/api/sec/messages' + (C.lastId ? '?after=' + C.lastId : '')).then(function (r) {
      if (s !== session) return;
      var box = C.list, sc = C.scroll;
      // (only what is not shown yet: a message never appears twice)
      var fresh = (r.messages || []).filter(function (m) { return m.id > C.lastId; });
      // the first time on this browser, what is already here counts as read
      if (!C.loaded && !C.seen && fresh.length) { C.seen = fresh[fresh.length - 1].id; saveSeen(); }
      C.loaded = true;
      if (!fresh.length) { if (!box.children.length) box.appendChild(empty('まだメッセージはありません')); return; }
      var none = box.querySelector('.empty'); if (none) box.removeChild(none);
      // (reading further up: new ones do not pull the view down, unless mine)
      var atEnd = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40, mine = false;
      fresh.forEach(function (m) {
        var b = el('div', 'msg' + (m.from.id === meId ? ' mine' : ''));
        var who = el('div', 'who'); who.appendChild(el('span', '', m.from.name)); who.appendChild(el('span', '', stamp(m.at))); b.appendChild(who);
        b.appendChild(el('div', 'body', m.text));
        box.appendChild(b);
        C.lastId = Math.max(C.lastId, m.id);
        if (m.from.id === meId) mine = true; else if (m.id > C.seen) C.unread++;
      });
      if (view === 'chat') { markSeen(); if (atEnd || mine) sc.scrollTop = sc.scrollHeight; } else markChat();
    });
  });
  // the unread count is kept up to date even while another panel is shown
  setInterval(function () { if (me && !me.viewer && panels.chat && panels.chat.built && view !== 'chat' && seen()) loadChat(); }, 8000);

  /* ------------------------------------------------------------ ロックダウン --- */
  var K = {};
  register('lockdown', {
    reset: function () { K = {}; },
    build: function (root) {
      var a = card('wide', 'ロックダウン', '運営者の誰でも、いつでも');
      K.state = el('p', 'muted'); a.appendChild(K.state);
      a.appendChild(el('p', 'fine muted', '発動すると、全ユーザー（プレイヤー・運営者・開発者）が締め出され、外部通信を遮断し、ログ以外を停止します。重要データを保護し、攻撃情報を緊急ログに記録します。解除するまで（最長1か月で自動解除）続きます。このホームだけは、ロックダウン中も動きます。'));
      var acts = el('div', 'acts'); K.raise = el('button', 'btn danger', 'ロックダウンを発動'); K.raise.type = 'button'; K.raise.addEventListener('click', askLockdown);
      K.release = el('button', 'btn', 'ロックダウンを解除'); K.release.type = 'button'; K.release.addEventListener('click', releaseLockdown);
      acts.appendChild(K.raise); acts.appendChild(K.release); a.appendChild(acts);
      var b = card('wide', '緊急の記録'); K.log = el('div', 'minis'); b.appendChild(K.log);
      var grid = el('div', 'grid two'); grid.appendChild(a); grid.appendChild(b); root.appendChild(grid);
    },
    status: function (s) {
      var em = s.emergency || {};
      K.state.textContent = em.level === 'lockdown' ? 'ロックダウン中（' + (em.reason || '') + '）。外部通信を遮断し、ログ以外を停止しています。'
        : em.level === 'stop' ? '緊急停止中（' + (em.reason || '') + '）' : 'ふだんどおり動いています。異常な使用量や攻撃を検知すると自動で停止・ロックダウンします。';
      K.raise.hidden = em.level === 'lockdown'; K.release.hidden = em.level !== 'lockdown';
      K.log.textContent = '';
      (s.emergencyLog || []).forEach(function (x) { K.log.appendChild(logLine(x)); });
      if (!(s.emergencyLog || []).length) K.log.appendChild(empty('記録はありません'));
    }
  });
  function askLockdown() {
    openDialog({ title: 'ロックダウンを発動しますか？', text: '全ユーザー（プレイヤー・運営者・開発者）が締め出され、外部通信を遮断し、ログ以外を停止します。重要データを保護し、攻撃情報を緊急ログに記録します。解除するまで（最長1か月で自動解除）続きます。', area: '理由（任意）', ok: '発動する', danger: true }).then(function (reason) {
      if (reason === null) return;
      api('POST', '/api/sec/lockdown', { reason: reason }).then(function () { toast('ロックダウンを発動しました'); loadStatus(); }, fail);
    });
  }
  function releaseLockdown() {
    openDialog({ title: 'ロックダウンを解除しますか？', text: '原因を確認してから解除してください。サーバーが通常に戻ります。', ok: '解除する', danger: true }).then(function (ok) {
      if (ok === null) return;
      api('POST', '/api/sec/release', {}).then(function () { toast('解除しました'); loadStatus(); }, fail);
    });
  }

  /* ------------------------------------------------------------ dialog --- */
  function openDialog(o) {
    return new Promise(function (resolve) {
      var back = $('#dialog'), form = $('#dialog-form');
      $('#dialog-title').textContent = o.title || '';
      $('#dialog-text').textContent = o.text || '';
      $('#dialog-error').textContent = '';
      var areaField = $('#dialog-area-field'), area = $('#dialog-area');
      areaField.hidden = !o.area; area.value = '';
      if (o.area) $('#dialog-area-label').textContent = o.area;
      var ok = $('#dialog-ok'); ok.textContent = o.ok || 'OK'; ok.className = 'btn ' + (o.danger ? 'danger solid' : 'primary');
      back.hidden = false;
      setTimeout(function () { (o.area ? area : ok).focus(); }, 40);
      function close(v) { back.hidden = true; form.onsubmit = null; $('#dialog-cancel').onclick = null; closeDialog = null; resolve(v); }
      closeDialog = close;
      form.onsubmit = function (ev) { ev.preventDefault(); close(o.area ? area.value.trim() : true); };
      $('#dialog-cancel').onclick = function () { close(null); };
    });
  }

  // what the developer's panels (dev.js) may use: the same channel, the same helpers, and nothing more
  window.SecHome = { register: register, api: api, el: el, svg: svg, card: card, tile: tile, empty: empty, fmt: fmt, ago: ago, stamp: stamp, bytes: bytes, span: span, toast: toast, fail: fail, dialog: openDialog, session: function () { return session; }, single: single };

  /* ------------------------------------------------------------ init --- */
  function init() {
    $('#login-form').addEventListener('submit', onLogin);
    $('#login-name').addEventListener('input', askSoon);
    $('#login-name').addEventListener('change', askSoon);
    if (window.OpsDevice) OpsDevice.watch($('#login-form'));
    $('#pk-form').addEventListener('submit', onPasskey);
    $('#pk-other').addEventListener('click', logout);
    $('#logout').addEventListener('click', logout);
    // the developer only (the server says no to anyone else)
    $('#speed').addEventListener('change', function () {
      var v = $('#speed').value;
      raw('POST', '/api/ops/speed', { speed: v }).then(function (r) { useSpeed(r.speed, true); toast('更新頻度を変えました（運営者全員に反映）'); },
        function (err) { $('#speed').value = speed; fail(err); });
    });
    $('#lock-release').addEventListener('click', releaseLockdown);
    $('#chan').addEventListener('click', function () {
      var pop = $('#chan-pop'); pop.hidden = !pop.hidden;
      $('#chan').setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
      if (!pop.hidden) drawChannelPop();
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('#chan, #chan-pop')) { $('#chan-pop').hidden = true; $('#chan').setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('#chan-pop').hidden = true; $('#chan').setAttribute('aria-expanded', 'false'); } });
    // back in sight: up to date at once, not at the next tick
    document.addEventListener('visibilitychange', function () { if (seen() && me) tick(false); });
    // (inside the operator site: its window put away, or brought back)
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || e.source !== window.parent || !e.data || e.data.type !== 'ops-view') return;
      var back = !!e.data.visible && !framed;
      framed = !!e.data.visible;
      if (back && me) tick(false);
    });
    // (opened and put away again before this page was up: it asks where it stands)
    if (window.parent !== window) { try { window.parent.postMessage({ type: 'ops-view-ask' }, location.origin); } catch (e) { /* on its own */ } }
    window.addEventListener('pagehide', function () { if (chan && me) { try { chan.close(); } catch (e) { /* the server forgets it by itself */ } } });

    if (!window.BR || !BR.secChannel || !BR.secChannel.available) { showLogin('このブラウザではセキュア通信を使えません。新しいブラウザで開いてください'); return; }
    if (token) {
      // (signed out on the server: raw() has shown why; anything else is told here)
      api('GET', '/api/sec/me').then(start, function (err) { if (!me && err.code !== 'identity_changed' && err.status !== 401 && err.code !== 'not_operator' && err.code !== 'pk_required' && err.code !== 'pk_expired') showLogin(err.message); });
    } else {
      showLogin('');
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
