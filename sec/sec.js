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
  var SPEED_KEY = 'two-state-sec/speed';
  var SPEEDS = { max: 1000, high: 2000, normal: 5000, slow: 15000 };
  var ACTIONS = {
    release: 'DEV更新', open: 'サイトを開いた', emergency_stop: '緊急停止', emergency_release: '緊急停止の解除',
    lockdown: 'ロックダウン', lockdown_release: 'ロックダウンの解除', shield_block: '手動ブロック', shield_auto_block: '自動ブロック',
    shield_unblock: 'ブロック解除', sec_message: 'セキュリティ基地の連絡', dev_code_fail: '開発者コードの入力ミス',
    dev_code_set: '開発者コードを登録', dev_code_change: '開発者コードを変更', ops_grant: '運営権の付与', ops_revoke: '運営権の剥奪',
    account_delete: 'アカウント削除', account_purge: 'データの完全削除', backup_run: 'バックアップ', backup_failed: 'バックアップの失敗',
    'ban:suspend': 'アクセス禁止', 'ban:ban': 'BAN', 'ban:perma': '永久BAN', 'ban:none': '処分の解除',
    player_register: '登録', player_login: 'ログイン', bot_message: '公式のメッセージ', money: '送金'
  };
  var KINDS = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
  function actionName(a) { return ACTIONS[a] || a; }

  var $ = function (s) { return document.querySelector(s); };
  var token = null, me = null, speed = 'normal';
  var timer = 0, lockEnd = 0, lockTimer = 0;
  var side = 'log', log = [], logQ = '', logKind = '', logDone = false, logTimer = 0;
  var lastChatId = 0, lastSeenChat = 0, chatOpen = false;
  var locked = false;

  try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { token = null; }
  try { speed = localStorage.getItem(SPEED_KEY) || 'normal'; } catch (e) { /* this tab */ }
  if (!SPEEDS[speed]) speed = 'normal';

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
    return fetch(path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' })
      .catch(function () { throw { status: 0, message: '通信できませんでした' }; })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          if (res.ok) return j;
          var e = j.error || {};
          var err = { status: res.status, code: e.code || '', message: e.message || ('エラー（' + res.status + '）'), until: e.until || 0 };
          if (res.status === 401 || e.code === 'not_operator') signedOut(err.message);
          throw err;
        });
      });
  }
  function setToken(t) { token = t || null; try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* this tab */ } }

  /* ------------------------------------------------------------ helpers --- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP'); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function stamp(ts) { if (!ts) return '-'; var d = new Date(ts); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function ago(ts) { if (!ts) return '-'; var s = Math.max(0, (Date.now() - ts) / 1000); if (s < 60) return 'たった今'; if (s < 3600) return Math.floor(s / 60) + '分前'; if (s < 86400) return Math.floor(s / 3600) + '時間前'; return Math.floor(s / 86400) + '日前'; }
  function bytes(n) { n = Number(n || 0); if (n < 1024) return n + 'B'; if (n < 1048576) return (n / 1024).toFixed(1) + 'KB'; if (n < 1073741824) return (n / 1048576).toFixed(1) + 'MB'; return (n / 1073741824).toFixed(2) + 'GB'; }
  function toast(t) { var n = $('#toast'); n.textContent = t; n.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { n.hidden = true; }, 2600); }
  function fail(e) { toast(e && e.message ? e.message : 'エラーが発生しました'); }

  /* ------------------------------------------------------------ login --- */
  function showLogin(message) {
    $('#app').hidden = true; $('#login').hidden = false;
    $('#login-error').textContent = message || '';
    clearInterval(timer);
    setTimeout(function () { $('#login-name').focus(); }, 50);
  }
  function signedOut(message) { setToken(null); me = null; showLogin(message); }
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
    request('POST', '/api/ops/login', { name: name, password: pass }, { 'X-Ops-Device': device() }).then(function (r) {
      setToken(r.token);
      return request('GET', '/api/sec/me').then(function (m) { $('#login-pass').value = ''; start(m); }, function (err) {
        fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + r.token, 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
        setToken(null); throw err;
      });
    }).catch(function (err) {
      if (err.code === 'ops_locked' && err.until) { waitUntil(err.until); return; }
      $('#login-error').textContent = err.message;
    }).then(function () { if (Date.now() >= lockEnd) go.disabled = false; });
  }
  function logout() {
    var t = token; setToken(null); me = null;
    if (t) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
    showLogin('出ました');
  }

  /* ------------------------------------------------------------ start --- */
  function start(m) {
    me = m;
    meId = m.id || meId;
    $('#login').hidden = true; $('#app').hidden = false;
    $('#op-name').textContent = (m.developer ? '開発者: ' : '運営者: ') + m.name;
    $('#speed').value = speed;
    loadStatus(); loadLog(true); loadChat();
    startTimer();
  }
  function startTimer() {
    clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden) return;
      loadStatus();
      loadChat();
      if (side === 'log' && !logQ) loadLog(true, true);
    }, SPEEDS[speed]);
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
  function loadStatus() {
    return request('GET', '/api/sec/status').then(renderStatus, function (err) { if (err.status) fail(err); });
  }
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
      r.appendChild(el('span', 'dot ' + (o.site ? 'site' : o.game ? 'game' : ''), ''));
      r.appendChild(el('span', '', o.name));
      if (o.developer) r.appendChild(el('span', 'dev', '開発者'));
      r.appendChild(el('span', 'seen', o.site ? 'セキュリティ基地' : o.game ? 'ゲーム中' : ago(o.seenAt)));
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
  function loadLog(reset, quiet) {
    var list = $('#log-list');
    if (reset && !quiet) { log = []; logDone = false; list.textContent = ''; list.appendChild(el('p', 'empty', '読み込み中…')); }
    var before = !reset && log.length ? log[log.length - 1].id : 0;
    request('GET', '/api/sec/log?q=' + encodeURIComponent(logQ) + '&kind=' + logKind + (before ? '&before=' + before : '')).then(function (r) {
      if (reset) { log = []; list.textContent = ''; }
      log = log.concat(r.entries);
      logDone = r.entries.length < 200;
      if (!log.length) list.appendChild(el('p', 'empty', '記録はありません'));
      if (reset) r.entries.forEach(function (x) { list.appendChild(logEntry(x)); });
      else r.entries.forEach(function (x) { list.appendChild(logEntry(x)); });
      $('#log-more').hidden = logDone || !!logQ;
    }, function (err) { if (!quiet && err.status) fail(err); });
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
  function loadChat() {
    return request('GET', '/api/sec/messages' + (lastChatId ? '?after=' + lastChatId : '')).then(function (r) {
      var fresh = r.messages || [];
      if (lastChatId && !fresh.length) return;
      var box = $('#chat-list');
      if (!lastChatId) box.textContent = '';
      fresh.forEach(function (m) { box.appendChild(msgEl(m)); lastChatId = Math.max(lastChatId, m.id); });
      if (!fresh.length && !box.children.length) box.appendChild(el('p', 'empty', 'まだメッセージはありません'));
      if (chatOpen) { lastSeenChat = lastChatId; markChatDot(); var sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight; }
      else markChatDot();
    }, function () {});
  }
  function msgEl(m) {
    var box = el('div', 'msg' + (me && m.from.id === me_id() ? ' mine' : ''));
    var who = el('div', 'who'); who.appendChild(el('span', '', m.from.name)); who.appendChild(el('span', '', stamp(m.at))); box.appendChild(who);
    box.appendChild(el('div', 'body', m.text));
    return box;
  }
  function me_id() { return meId; }
  var meId = 0;
  function markChatDot() {
    var dot = $('#chat-dot');
    var n = Math.max(0, lastChatId - lastSeenChat);
    dot.hidden = chatOpen || !n;
    dot.textContent = n > 99 ? '99+' : String(n);
  }
  function sendChat(e) {
    e.preventDefault();
    var ta = $('#chat-text'), text = ta.value.trim();
    if (!text) return;
    request('POST', '/api/sec/messages', { text: text }).then(function () { ta.value = ''; loadChat(); }, fail);
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
      function close(v) { back.hidden = true; form.onsubmit = null; $('#dialog-cancel').onclick = null; resolve(v); }
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
    if (v === 'chat') { lastSeenChat = lastChatId; markChatDot(); var sc = $('#chat-scroll'); sc.scrollTop = sc.scrollHeight; }
  }
  function init() {
    $('#login-form').addEventListener('submit', onLogin);
    $('#logout').addEventListener('click', logout);
    $('#speed').addEventListener('change', function () { speed = $('#speed').value; if (!SPEEDS[speed]) speed = 'normal'; try { localStorage.setItem(SPEED_KEY, speed); } catch (e) { /* this tab */ } startTimer(); });
    $('#btn-lockdown').addEventListener('click', askLockdown);
    $('#btn-verify').addEventListener('click', verify);
    $('#lock-release').addEventListener('click', releaseLockdown);
    $('#log-search').addEventListener('input', function () { clearTimeout(logTimer); logTimer = setTimeout(function () { logQ = $('#log-search').value.trim(); loadLog(true); }, 300); });
    $('#log-more').addEventListener('click', function () { loadLog(false); });
    $('#log-kinds').addEventListener('click', function (e) {
      var c = e.target.closest('[data-kind]'); if (!c) return;
      logKind = c.dataset.kind;
      Array.prototype.forEach.call(document.querySelectorAll('#log-kinds .chip'), function (x) { x.classList.toggle('on', x === c); });
      loadLog(true);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.side-tab'), function (t) { t.addEventListener('click', function () { setSide(t.dataset.side); }); });
    $('#chat-form').addEventListener('submit', sendChat);
    $('#chat-text').addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendChat(e); } });

    // the operator id, once we know it, for 'mine' messages
    if (token) {
      request('GET', '/api/sec/me').then(function (m) { meId = m.id || 0; start(m); }, function () { showLogin(''); });
    } else {
      showLogin('');
    }
  }
  document.addEventListener('DOMContentLoaded', init);
})();
