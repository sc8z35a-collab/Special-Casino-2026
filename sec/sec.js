/* security HOME (server/core/sec.js). The operators' final safety base, apart
   from the operator site. An operator logs in once (the same name and password
   as the game; only operators get in). It then shows, in real time: the
   security shield (requests, attacks, floods and blocks), the server's health,
   the emergency/lockdown state, the threat level, the addresses with the
   highest threat score, the blocks in force and who among the operators is
   here; on the right, the same operators' log the operator site shows, and a
   channel the operators reach one another on (its messages sealed on the
   server). Its one power is the lockdown — raised or lifted here by hand at any
   time. Nothing else operational can be done from here. */
(function () {
  'use strict';

  var TOKEN_KEY = 'two-state-sec/token';
  var DEVICE_KEY = 'two-state-sec/device';
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
    player_register: '登録', player_login: 'ログイン', bot_message: '公式のメッセージ', money: '送金'
  };
  var KINDS = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
  function actionName(a) { return ACTIONS[a] || a; }

  var $ = function (s) { return document.querySelector(s); };
  var token = null, me = null, meId = 0, speed = 'normal';
  // each sign-in and sign-out starts a new session: answers to an older one are dropped
  var session = 0;
  var timer = 0, lockEnd = 0, lockTimer = 0, statusErr = '';
  var side = 'log', log = [], logQ = '', logKind = '', logDone = false, logTimer = 0, logGen = 0, logMoreBusy = false;
  var lastChatId = 0, seenChat = 0, unread = 0, chatLoaded = false, chatOpen = false, sending = false;
  var locked = false, closeDialog = null;

  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }

  /* ------------------------------------------------------------ server --- */
  function device() {
    var d = null;
    try { d = localStorage.getItem(DEVICE_KEY); } catch (e) { d = null; }
    if (!d || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) {
      var a = new Uint8Array(18);
      crypto.getRandomValues(a);
      d = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { localStorage.setItem(DEVICE_KEY, d); } catch (e) { /* this tab */ }
    }
    return d;
  }
  function request(method, path, body, headers) {
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
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok) return j;
          var e = j.error || {};
          var err = { status: res.status, code: e.code || '', message: e.message || ('エラー（' + res.status + '）'), until: e.until || 0 };
          // the passkey is asked for (this page is new, or its hour is up)
          if ((e.code === 'pk_required' || e.code === 'pk_expired') && token && s === session) showPasskey(e.code === 'pk_required' && err.message === PK_DEFAULT ? '' : err.message);
          // signed out on the server: only while signed in, and in this same
          // session (not a wrong password, nor a late answer to the last one)
          if ((res.status === 401 || e.code === 'not_operator' || e.code === 'mfa_required') && path !== '/api/ops/login' && token && s === session) signedOut(err.message);
          throw err;
        });
      });
  }
  function setToken(t) { token = t || null; try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* this tab */ } }
  // one request of a kind at a time, so a slow server never piles them up nor
  // answers them out of order; asked for again meanwhile, it runs once more after
  function single(fn) {
    var busy = false, again = false;
    return function run() {
      if (busy) { again = true; return; }
      busy = true; again = false;
      Promise.resolve().then(fn).then(null, function () {}).then(function () { busy = false; if (again && token) run(); });
    };
  }

  /* ------------------------------------------------------------ helpers --- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP'); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function stamp(ts) { if (!ts) return '-'; var d = new Date(ts); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function ago(ts) { if (!ts) return '-'; var s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'たった今'; if (s < 3600) return Math.floor(s / 60) + '分前'; if (s < 86400) return Math.floor(s / 3600) + '時間前'; return Math.floor(s / 86400) + '日前'; }
  function bytes(n) { n = Number(n || 0); if (n < 1024) return n + 'B'; if (n < 1048576) return (n / 1024).toFixed(1) + 'KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + 'MB'; return (n / 1073741824).toFixed(2) + 'GB'; }
  function toast(t) { securityNotice({ text: String(t) }); var n = $('#toast'); n.textContent = t; n.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { n.hidden = true; }, 2600); }
  function fail(e) { toast(e && e.message ? e.message : 'エラーが発生しました'); }

  /* ------------------------------------------------------------ login --- */
  // The passkey (server/core/pk.js), asked each time this page opens and after
  // an hour on it: today's six digits from Discord's /passkey. A wrong one
  // keeps the account out for an hour. The page's key lives in its memory only
  // (pk.js); the page starts over when the hour is up.
  var PK_DEFAULT = '今日のパスキーを入力してください', pkTimer = 0, pkWarn = 0, pkLockTimer = 0, pkLockEnd = 0;
  // what this operator saw goes (the next one, or this one after the passkey, starts clean)
  function wipe() {
    if (closeDialog) closeDialog(null);
    log = []; logGen++; $('#log-list').textContent = '';
    lastChatId = 0; unread = 0; chatLoaded = false; $('#chat-list').textContent = ''; markChatDot();
    $('#verify-line').className = 'verify'; $('#verify-line').textContent = '';
    clearInterval(timer); clearInterval(aliveTimer);
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
    request('GET', '/api/pk/state').then(function (st) {
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
      return request('POST', '/api/pk/open', { passkey: code, pub: pub });
    }).then(function (r) {
      OpsPk.open(r.gid, r.until);
      pkSchedule(r.until);
      $('#pk').hidden = true; $('#pk-code').value = '';
      return request('GET', '/api/sec/me').then(start);
    }).catch(function (err) {
      if (err.code === 'pk_wrong' || err.code === 'pk_locked') { $('#pk-error').textContent = err.message; if (err.until) pkWait(err.until); return; }
      go.disabled = false;
      if (err.status !== 401 && err.code !== 'not_operator' && err.code !== 'pk_required') $('#pk-error').textContent = err.message || 'エラーが発生しました';
    });
  }
  function showLogin(message) {
    $('#pk').hidden = true;
    $('#app').hidden = true; $('#login').hidden = false;
    $('#login-error').textContent = message || '';
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
  function waitUntil(until) {
    lockEnd = until; clearInterval(lockTimer);
    var go = $('#login-go');
    function tick() {
      var left = lockEnd - Date.now();
      if (left <= 0) { clearInterval(lockTimer); go.disabled = false; $('#login-error').textContent = 'もう一度入力できます'; return; }
      go.disabled = true;
      $('#login-error').textContent = '入力制限中です。あと ' + Math.floor(left / 60000) + '分' + pad(Math.floor(left / 1000) % 60) + '秒';
    }
    tick(); lockTimer = setInterval(tick, 1000);
  }
  function onLogin(e) {
    e.preventDefault();
    if (Date.now() < lockEnd) return;
    var name = $('#login-name').value.trim(), pass = $('#login-pass').value;
    if (!name || !pass) { $('#login-error').textContent = '名前とパスワードを入力してください'; return; }
    var go = $('#login-go'); go.disabled = true; $('#login-error').textContent = '';
    setToken(null);   // (one left from before is of no use: a new one comes)
    request('POST', '/api/ops/login', { name: name, password: pass, otp: $('#login-otp').value.trim(), phrase: $('#login-phrase').value, recovery: $('#login-backup').value.trim() }, { 'X-Ops-Device': device() }).then(function (r) {
      setToken(r.token);
      return request('GET', '/api/sec/me').then(function (m) { $('#login-pass').value = ''; $('#login-otp').value = ''; $('#login-phrase').value = ''; $('#login-backup').value = ''; $('#login-extra').open = false; start(m); }, function (err) {
        // the passkey is asked for next (its page is up already): the login stays
        if (err.code === 'pk_required' || err.code === 'pk_expired') { $('#login-pass').value = ''; $('#login-otp').value = ''; $('#login-phrase').value = ''; $('#login-backup').value = ''; return; }
        revoke(r.token);
        setToken(null); throw err;
      });
    }).catch(function (err) {
      if (err.code === 'mfa_required' || err.code === 'mfa_invalid') { $('#login-extra').open = true; $('#login-otp').focus(); }
      if (err.code === 'ops_locked' && err.until) { waitUntil(err.until); return; }
      $('#login-error').textContent = err.message;
    }).then(function () { if (Date.now() >= lockEnd) go.disabled = false; });
  }
  function logout() {
    revoke(token);
    signedOut('出ました');
  }

  /* ------------------------------------------------------------ start --- */
  // A 閲覧者 (viewer): the status and the log only — no channel, no lockdown
  // (the server refuses them anyway) — and every 2 seconds the question
  // whether they still may: taken away, they are out at once.
  function start(m) {
    me = m; meId = m.id || 0; session++;
    seenChat = readSeen(); statusErr = '';
    $('#login').hidden = true; $('#pk').hidden = true; $('#app').hidden = false;
    $('#op-name').textContent = (m.developer ? '開発者: ' : m.viewer ? '閲覧者: ' : '運営者: ') + m.name;
    document.body.classList.toggle('role-viewer', !!m.viewer);
    $('#speed').disabled = !m.developer;
    $('#speed').title = m.developer ? '更新頻度（運営者全員に反映）' : '更新頻度は開発者だけが変えられます';
    useSpeed(m.speed, false);
    if (m.viewer) setSide('log');
    loadStatus(); loadLog();
    if (!m.viewer) loadChat();
    startTimer();
  }
  function tick() {
    loadStatus();
    if (!me || !me.viewer) loadChat();
    if (side === 'log' && !logQ) refreshLog();
  }
  function useSpeed(v, restart) {
    if (!SPEEDS[v]) v = 'normal';
    $('#speed').value = v;
    if (v === speed) return;
    speed = v;
    if (restart) startTimer();
  }
  var aliveTimer = 0;
  function startTimer() {
    clearInterval(timer);
    clearInterval(aliveTimer);
    timer = setInterval(function () { if (!document.hidden) tick(); }, SPEEDS[speed]);
    if (me && me.viewer) aliveTimer = setInterval(function () { if (!document.hidden && me) request('GET', '/api/sec/me').catch(function () {}); }, 2000);
  }

  /* ------------------------------------------------------------ status --- */
  var LEVELS = {
    safe: { word: '平常', cls: 'lv-safe' }, watch: { word: '注意', cls: 'lv-watch' }, elevated: { word: '警戒', cls: 'lv-elevated' },
    high: { word: '高', cls: 'lv-high' }, breach: { word: '突破', cls: 'lv-breach' }, lockdown: { word: 'ロックダウン', cls: 'lv-lockdown' }
  };
  function levelOf(s) {
    if (s.emergency && s.emergency.level === 'lockdown') return 'lockdown';
    var sh = s.shield || {}, p = sh.pressure || {}, m = sh.last5m || {};
    if (p.attackers >= (p.breachAt || 8) || p.criticals >= (p.criticalAt || 40)) return 'breach';
    if (m.attacks >= 20 || (sh.blocks || []).length >= 8) return 'high';
    if (m.attacks >= 3 || m.floods >= 1 || (sh.blocks || []).length >= 1) return 'elevated';
    if (m.authFails >= 5) return 'watch';
    return 'safe';
  }
  var loadStatus = single(function () {
    var s = session;
    return request('GET', '/api/sec/status').then(function (r) {
      if (s !== session) return;
      statusErr = ''; $('.status-col').classList.remove('stale');
      if (r.speed) useSpeed(r.speed, true);
      renderStatus(r);
    }, function (err) {
      if (s !== session) return;
      // what is shown is no longer live; the same trouble every tick is told once
      $('.status-col').classList.add('stale');
      if (err.code === 'maintenance') $('#emergency-state').textContent = err.message;
      if (err.message !== statusErr) fail(err);
      statusErr = err.message;
    });
  });
  function stat(box, label, value, cls) {
    var s = el('div', 'stat' + (cls ? ' ' + cls : ''));
    s.appendChild(el('span', '', label));
    s.appendChild(el('b', '', value));
    box.appendChild(s);
  }
  function renderStatus(s) {
    var sh = s.shield || {}, em = s.emergency || {}, h = s.health || {};
    locked = em.level === 'lockdown';
    // the lockdown banner
    var banner = $('#lock-banner');
    banner.hidden = !locked;
    if (locked) {
      $('#lock-sub').textContent = stamp(em.at) + ' から・' + (em.reason || '') + (em.releaseAt ? '・自動解除 ' + stamp(em.releaseAt) : '');
    }
    $('#btn-lockdown').hidden = locked;

    // threat level
    var lv = levelOf(s), info = LEVELS[lv];
    var ring = $('#level-ring');
    ring.className = 'level-ring ' + info.cls;
    $('#level-word').textContent = info.word;
    var p = sh.pressure || {}, m5 = sh.last5m || {};
    var facts = $('#level-facts'); facts.textContent = '';
    [['直近5分の攻撃', fmt(m5.attacks || 0)], ['ブロック中', fmt((sh.blocks || []).length)],
     ['攻撃元アドレス', (p.attackers || 0) + ' / ' + (p.breachAt || 8)], ['鍵への総当たり', (p.criticals || 0) + ' / ' + (p.criticalAt || 40)]].forEach(function (f) {
      var d = el('div'); d.appendChild(el('span', '', f[0])); d.appendChild(el('b', '', f[1])); facts.appendChild(d);
    });

    // shield stats
    var ss = $('#shield-stats'); ss.textContent = '';
    stat(ss, 'リクエスト', fmt(m5.requests || 0));
    stat(ss, '攻撃', fmt(m5.attacks || 0), (m5.attacks || 0) ? 'hot' : '');
    stat(ss, '探索', fmt(m5.probes || 0), (m5.probes || 0) ? 'warn' : '');
    stat(ss, 'フラッド', fmt(m5.floods || 0), (m5.floods || 0) ? 'hot' : '');
    stat(ss, 'ログイン失敗', fmt(m5.authFails || 0), (m5.authFails || 0) ? 'warn' : '');
    stat(ss, 'ブロック', fmt(m5.blocked || 0), (m5.blocked || 0) ? 'hot' : '');
    sparkline(sh.history || []);

    // server
    var sv = $('#server-stats'); sv.textContent = '';
    stat(sv, 'プレイヤー接続', fmt(h.online || 0));
    stat(sv, '運営者オンライン', fmt(h.operatorsOnline || 0));
    stat(sv, 'ライブ接続', h.sockets == null ? '-' : fmt(h.sockets));
    stat(sv, 'データベース', h.dbBytes == null ? '-' : bytes(h.dbBytes));
    stat(sv, '外部通信', h.outbound ? '通常' : '遮断中', h.outbound ? '' : 'hot');
    stat(sv, 'サーバー', h.host || '-');

    // emergency
    $('#emergency-state').textContent = em.level === 'lockdown'
      ? 'ロックダウン中（' + (em.reason || '') + '）。外部通信を遮断し、ログ以外を停止しています。'
      : em.level === 'stop' ? '緊急停止中（' + (em.reason || '') + '）'
      : 'ふだんどおり動いています。異常な使用量や攻撃を検知すると自動で停止・ロックダウンします。';
    $('#btn-lockdown').textContent = 'ロックダウンを発動';

    // blocks
    var bl = $('#blocks-list'); bl.textContent = '';
    var blocks = sh.blocks || [];
    $('#blocks-count').textContent = blocks.length ? fmt(blocks.length) : '';
    $('#blocks-count').hidden = !blocks.length;
    if (!blocks.length) bl.appendChild(el('p', 'empty', 'ブロック中のものはありません'));
    blocks.slice(0, 40).forEach(function (b) { bl.appendChild(blockRow(b)); });

    // attackers
    var at = $('#attackers-list'); at.textContent = '';
    var tops = (sh.topAttackers || []).filter(function (x) { return x.score > 0; });
    if (!tops.length) at.appendChild(el('p', 'empty', '脅威は検知されていません'));
    tops.slice(0, 15).forEach(function (x) {
      var r = el('div', 'attacker-row');
      r.appendChild(el('span', 'ip', x.ip));
      if (x.flags && x.flags.length) r.appendChild(el('span', 'flags', x.flags.join('・')));
      r.appendChild(el('span', 'score', fmt(x.score)));
      at.appendChild(r);
    });

    // operators
    var ops = $('#ops-now'); ops.textContent = '';
    (s.operators || []).forEach(function (o) {
      var r = el('div', 'ops-row');
      r.appendChild(el('span', 'dot ' + (o.base || o.site ? 'site' : o.game ? 'game' : ''), ''));
      r.appendChild(el('span', '', o.name));
      if (o.developer) r.appendChild(el('span', 'dev', '開発者'));
      // here, on the operator site, in the game, or when last online
      r.appendChild(el('span', 'seen', o.base ? 'セキュリティ基地' : o.site ? '運営サイト' : o.game ? 'ゲーム中' : ago(o.seenAt)));
      ops.appendChild(r);
    });
  }
  function blockRow(b) {
    var r = el('div', 'block-row');
    r.appendChild(el('span', 'tag ' + b.scope, b.scope === 'ip' ? 'IP' : b.scope === 'account' ? 'アカウント' : '端末'));
    r.appendChild(el('span', 'target', b.target));
    if (b.manual) r.appendChild(el('span', 'tag manual', '手動'));
    r.appendChild(el('span', 'why', (b.reason || '') + (b.until ? '｜あと' + Math.max(1, Math.round((b.until - Date.now()) / 60000)) + '分' : '｜解除まで')));
    return r;
  }
  function sparkline(hist) {
    var svg = $('#shield-spark'); svg.textContent = '';
    if (!hist.length) return;
    var w = 320, hgt = 60, n = hist.length;
    var maxReq = 1, maxAtk = 1;
    hist.forEach(function (x) { maxReq = Math.max(maxReq, x[1]); maxAtk = Math.max(maxAtk, x[2] + x[3]); });
    function path(idx, max, color, fill) {
      var d = '';
      hist.forEach(function (x, i) { var px = n < 2 ? 0 : (i / (n - 1)) * w; var py = hgt - (x[idx] / max) * (hgt - 6) - 2; d += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' '; });
      var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', fill ? '1.5' : '2');
      svg.appendChild(p);
    }
    path(1, maxReq, '#4aa8ff');
    // attacks + floods together
    var d = '';
    hist.forEach(function (x, i) { var px = n < 2 ? 0 : (i / (n - 1)) * w; var py = hgt - ((x[2] + x[3]) / maxAtk) * (hgt - 6) - 2; d += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' '; });
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#ff4d5e'); p.setAttribute('stroke-width', '2');
    svg.appendChild(p);
  }

  /* ------------------------------------------------------------ verify --- */
  function verify() {
    var v = $('#verify-line'); v.className = 'verify'; v.textContent = '確認中…';
    request('GET', '/api/sec/verify').then(function (r) {
      v.className = 'verify ' + (r.ok ? 'ok' : 'bad');
      v.textContent = r.ok ? '✓ ログ整合性：' + fmt(r.count) + '件すべて正しくつながっています' : '⚠ ' + (r.brokenAt || '') + '番で異常（' + (r.reason || '') + '）';
    }, function () { v.className = 'verify bad'; v.textContent = '確認できませんでした'; });
  }

  /* ------------------------------------------------------------ lockdown --- */
  function askLockdown() {
    openDialog({ title: 'ロックダウンを発動しますか？', text: '全ユーザー（プレイヤー・運営者・開発者）が締め出され、外部通信を遮断し、ログ以外を停止します。重要データを保護し、攻撃情報を緊急ログに記録します。解除するまで（最長1か月で自動解除）続きます。', area: '理由（任意）', ok: '発動する', danger: true }).then(function (reason) {
      if (reason === null) return;
      request('POST', '/api/sec/lockdown', { reason: reason }).then(function () { toast('ロックダウンを発動しました'); loadStatus(); }, fail);
    });
  }
  function releaseLockdown() {
    openDialog({ title: 'ロックダウンを解除しますか？', text: '原因を確認してから解除してください。サーバーが通常に戻ります。', ok: '解除する', danger: true }).then(function (ok) {
      if (ok === null) return;
      request('POST', '/api/sec/release', {}).then(function () { toast('解除しました'); loadStatus(); }, fail);
    });
  }

  /* ------------------------------------------------------------ the log --- */
  function logUrl(before) {
    return '/api/sec/log?q=' + encodeURIComponent(logQ) + '&kind=' + encodeURIComponent(logKind) + (before ? '&before=' + before : '');
  }
  // the list from the start (signing in, a search, a kind)
  function loadLog() {
    var gen = ++logGen, s = session, list = $('#log-list');
    log = []; logDone = false; list.textContent = ''; list.scrollTop = 0;
    list.appendChild(el('p', 'empty', '読み込み中…'));
    $('#log-more').hidden = true;
    request('GET', logUrl(0)).then(function (r) {
      if (gen !== logGen || s !== session) return;
      list.textContent = '';
      log = r.entries;
      if (!log.length) list.appendChild(el('p', 'empty', '記録はありません'));
      log.forEach(function (x) { list.appendChild(logEntry(x)); });
      logDone = log.length < PAGE;
      $('#log-more').hidden = logDone || !!logQ;
    }, function (err) {
      if (gen !== logGen || s !== session) return;
      list.textContent = ''; list.appendChild(el('p', 'empty', '読み込めませんでした'));
      if (err.status) fail(err);
    });
  }
  // the newer entries on top, quietly: what is open, read further down and
  // scrolled to stays as it is (the whole list is not built again)
  var refreshLog = single(function () {
    var gen = logGen, s = session;
    return request('GET', logUrl(0)).then(function (r) {
      if (gen !== logGen || s !== session) return;
      var top = log.length ? log[0].id : 0;
      var fresh = r.entries.filter(function (x) { return x.id > top; });
      if (!fresh.length) return;
      // a whole page came in since the last look: start over rather than leave a gap
      if (top && fresh.length >= PAGE) { loadLog(); return; }
      var list = $('#log-list'), at = list.scrollTop, height = list.scrollHeight;
      var empty = list.querySelector('.empty'); if (empty) list.removeChild(empty);
      var rows = document.createDocumentFragment();
      fresh.forEach(function (x) { rows.appendChild(logEntry(x)); });
      list.insertBefore(rows, list.firstChild);
      log = fresh.concat(log);
      if (at > 0) list.scrollTop = at + list.scrollHeight - height;
      if (!top) { logDone = r.entries.length < PAGE; $('#log-more').hidden = logDone || !!logQ; }
    });
  });
  // the older entries at the end (one page at a time, never the same twice)
  function moreLog() {
    if (logMoreBusy || logDone || !log.length) return;
    var gen = logGen, s = session, btn = $('#log-more');
    logMoreBusy = true; btn.disabled = true;
    request('GET', logUrl(log[log.length - 1].id)).then(function (r) {
      if (gen !== logGen || s !== session) return;
      var list = $('#log-list');
      r.entries.forEach(function (x) { list.appendChild(logEntry(x)); });
      log = log.concat(r.entries);
      logDone = r.entries.length < PAGE;
      btn.hidden = logDone || !!logQ;
    }, function (err) { if (err.status) fail(err); }).then(function () { logMoreBusy = false; btn.disabled = false; });
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
      row.appendChild(logDetail(x));
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
    box.appendChild(el('pre', '', JSON.stringify(rest, null, 2)));
    return box;
  }

  /* ------------------------------------------------------------ channel --- */
  var loadChat = single(function () {
    var s = session;
    return request('GET', '/api/sec/messages' + (lastChatId ? '?after=' + lastChatId : '')).then(function (r) {
      if (s !== session) return;
      var box = $('#chat-list'), sc = $('#chat-scroll');
      // (only what is not shown yet: a message never appears twice)
      var fresh = (r.messages || []).filter(function (m) { return m.id > lastChatId; });
      // the first time on this browser, what is already here counts as read
      if (!chatLoaded && !seenChat && fresh.length) { seenChat = fresh[fresh.length - 1].id; saveSeen(); }
      chatLoaded = true;
      if (!fresh.length) { if (!box.children.length) box.appendChild(el('p', 'empty', 'まだメッセージはありません')); return; }
      var empty = box.querySelector('.empty'); if (empty) box.removeChild(empty);
      // (reading further up: new ones do not pull the view down, unless mine)
      var atEnd = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40, mine = false;
      fresh.forEach(function (m) {
        box.appendChild(msgEl(m));
        lastChatId = Math.max(lastChatId, m.id);
        if (m.from.id === meId) mine = true;
        else if (m.id > seenChat) unread++;
      });
      if (chatOpen) { markSeen(); if (atEnd || mine) sc.scrollTop = sc.scrollHeight; }
      else markChatDot();
    });
  });
  function msgEl(m) {
    var box = el('div', 'msg' + (m.from.id === meId ? ' mine' : ''));
    var who = el('div', 'who'); who.appendChild(el('span', '', m.from.name)); who.appendChild(el('span', '', stamp(m.at))); box.appendChild(who);
    box.appendChild(el('div', 'body', m.text));
    return box;
  }
  function readSeen() { try { return Number(localStorage.getItem(SEEN_KEY + meId)) || 0; } catch (e) { return 0; } }
  function saveSeen() { try { localStorage.setItem(SEEN_KEY + meId, String(seenChat)); } catch (e) { /* this tab */ } }
  // the channel is in sight: everything in it is read
  function markSeen() { seenChat = Math.max(seenChat, lastChatId); unread = 0; saveSeen(); markChatDot(); }
  // (the other operators' messages not read yet)
  function securityNotice(detail) {
    if (window.parent !== window) window.parent.postMessage(Object.assign({ type: 'ops:security-notice' }, detail), location.origin);
  }
  function markChatDot() {
    var dot = $('#chat-dot');
    dot.hidden = chatOpen || !unread;
    dot.textContent = unread > 99 ? '99+' : String(unread);
    securityNotice({ count: chatOpen ? 0 : unread });
  }
  function sendChat(e) {
    e.preventDefault();
    var ta = $('#chat-text'), text = ta.value.trim();
    if (!text || sending) return;
    sending = true;
    request('POST', '/api/sec/messages', { text: text }).then(function () { ta.value = ''; loadChat(); }, fail).then(function () { sending = false; });
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

  /* ------------------------------------------------------------ init --- */
  function setSide(v) {
    side = v; chatOpen = v === 'chat';
    Array.prototype.forEach.call(document.querySelectorAll('.side-tab'), function (t) { t.classList.toggle('on', t.dataset.side === v); });
    $('#side-log').hidden = v !== 'log';
    $('#side-chat').hidden = v !== 'chat';
    if (v === 'chat') { markSeen(); var sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight; }
    else if (me && !logQ) refreshLog();
  }
  function init() {
    $('#login-form').addEventListener('submit', onLogin);
    $('#pk-form').addEventListener('submit', onPasskey);
    $('#pk-other').addEventListener('click', logout);
    $('#logout').addEventListener('click', logout);
    // the developer only (the server says no to anyone else)
    $('#speed').addEventListener('change', function () {
      var v = $('#speed').value;
      request('POST', '/api/ops/speed', { speed: v }).then(function (r) { useSpeed(r.speed, true); toast('更新頻度を変えました（運営者全員に反映）'); },
        function (err) { $('#speed').value = speed; fail(err); });
    });
    $('#btn-lockdown').addEventListener('click', askLockdown);
    $('#btn-verify').addEventListener('click', verify);
    $('#lock-release').addEventListener('click', releaseLockdown);
    $('#log-search').addEventListener('input', function () { clearTimeout(logTimer); logTimer = setTimeout(function () { logQ = $('#log-search').value.trim(); loadLog(); }, 300); });
    $('#log-more').addEventListener('click', moreLog);
    $('#log-kinds').addEventListener('click', function (e) {
      var c = e.target.closest('[data-kind]'); if (!c) return;
      logKind = c.dataset.kind;
      Array.prototype.forEach.call(document.querySelectorAll('#log-kinds .chip'), function (x) { x.classList.toggle('on', x === c); });
      loadLog();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.side-tab'), function (t) { t.addEventListener('click', function () { setSide(t.dataset.side); }); });
    $('#chat-form').addEventListener('submit', sendChat);
    $('#chat-text').addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendChat(e); } });
    // back in sight: up to date at once, not at the next tick
    document.addEventListener('visibilitychange', function () { if (!document.hidden && me) tick(); });

    if (token) {
      // (signed out on the server: request() has shown why; anything else is told here)
      request('GET', '/api/sec/me').then(start, function (err) { if (!me && err.status !== 401 && err.code !== 'not_operator' && err.code !== 'pk_required' && err.code !== 'pk_expired') showLogin(err.message); });
    } else {
      showLogin('');
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
