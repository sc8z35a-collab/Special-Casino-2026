/* TWO STATE サーバー運営サイト (server/core/ops.js). The operator logs in
   once with their name and password (the session is kept on this browser);
   only the accounts the server names as operators get in.
   - プレイヤー: everyone's money, connection, 18歳以上, 引き継ぎコード and bans
     at a glance, with marks on the icons (返信待ち: a message to the official
     bot waits for an answer; 検知: the chat filter found something). A tap on
     an icon opens the conversation with Ice Smoker公式 (opening it marks
     the player's messages read), a tap on the row the player's details and
     the actions: アクセス禁止 (a week), BAN (30 days), 永久BAN, lifting them,
     letting a player past a BAN on their device, a new 引き継ぎコード, a new
     password, a message from the bot (件名, 〇〇様, the matter, Ice Smoker公式
     より) and money from the bot ($0〜1000万).
   - 通報: accepted with a reward of 60万 / 120万 / 240万 sent by the bot with
     its thanks, or declined. 検知: the original words. 報告・意見案: an
     意見案 adopted earns its player 50,000 spin tokens from Ice Smoker公式 with its thanks.
   - 運営者: operator rights given to a player or taken away (they are logged
     out everywhere at once and kept out of this site), each with the
     developer code; the developer registers that code here once.
   - ログ: everything done here, and every DEV going live, newest first; a tap
     shows all that is known about it. It cannot be changed or deleted.
   - 課金 (the developer's own): the players who paid for 開発者支援, waiting
     for the developer's words; answered (through the official bot), they
     leave the list. Every order, the meters, and whether payments are on.
   - 運営チャット: the operators, live (on the site, in the game, or when last
     online), and their talk, one to one or all together (never taken back).
   - サーバー: what the server sees of itself, live: requests, bytes sent,
     connections, the database, the vault, the plan and this month's bill.
   - 保管庫 (the developer's own, opened with the developer code): big files in
     folders, 10 to a page, sent in pieces checked by SHA-256 (a stopped upload
     goes on where it stopped, on its own once there is room or a connection),
     fetched back the same way, and time-limited links (for an AI too: what it
     takes and does is labelled; what it put in the game is 実装済み).
   - アーカイブ: the 永久BAN and deleted accounts, all their data gone 90 days
     after they came in; a 永久BAN can be lifted, a deleted account never
     comes back. Only the developer sees the button that deletes an account
     (with the developer code; the accounts on the same device go too).
   - 緊急停止: when the server stops itself (far more use than usual), every
     page shows it; the developer sees why and starts it again with the code.
   The login waits after two wrong tries (5 minutes, then 10, 20 …).
   The site refreshes at the speed chosen at the top (kept on this browser).
   Passwords are kept only as one-way hashes, so they can be set, never shown.
   On a phone the site goes full screen and landscape at the first tap; held
   upright where that is not possible, the whole site is turned sideways. */
(function () {
  'use strict';

  var KEY = 'two-state-ops/token';
  // how often the site refreshes, chosen at the top: [the lists, the live views
  // (サーバー, 運営チャット, a chat with a player)] in ms
  var SPEEDS = { max: [3000, 1000], high: [5000, 2000], normal: [15000, 5000], slow: [60000, 15000] };
  var SPEED_KEY = 'two-state-ops/speed';
  var BAN = {
    suspend: { name: 'アクセス禁止', long: 'アクセス禁止（1週間）', cls: 'k-suspend' },
    ban: { name: 'BAN', long: 'BAN（30日）', cls: 'k-ban' },
    perma: { name: '永久BAN', long: '永久BAN（解除するまで）', cls: 'k-perma' }
  };
  var ACTIONS = {
    release: 'DEV更新', open: 'サイトを開いた', 'ban:suspend': 'アクセス禁止', 'ban:ban': 'BAN', 'ban:perma': '永久BAN', 'ban:none': '処分の解除',
    device_ok: '端末の許可', recovery: '引き継ぎコード再発行', password: 'パスワード再設定', bot_read: 'チャットを既読', bot_message: '公式のメッセージ',
    money: '送金', report_accept: '通報を受理', report_reject: '通報を不受理', detections_reviewed: '検知を確認', feedback_handled: '報告・意見案を対応済み',
    idea_adopt: '意見案を採用', ops_revoke: '運営権の剥奪', ops_grant: '運営権の付与', ops_restore: '運営権を戻す',
    dev_code_set: '開発者コードを登録', dev_code_change: '開発者コードを変更', dev_code_fail: '開発者コードの入力ミス',
    bot_auto_reply: '自動返信', log_kept: '運営ログの保持', 'admin:restore-time': '管理コマンド: 時点への巻き戻し',
    account_delete: 'アカウント削除', account_purge: 'データの完全削除', emergency_stop: '緊急停止', emergency_release: '緊急停止の解除',
    backup_key: 'バックアップの鍵', backup_run: 'バックアップ', backup_get: 'バックアップのダウンロード', backup_delete: 'バックアップの削除',
    backup_settings: 'バックアップの設定', backup_failed: 'バックアップの失敗', vault_note: '保管庫のメッセージ', vault_note_delete: '保管庫のメッセージ削除',
    player_register: '登録', player_login: 'ログイン', player_password: 'パスワード変更', player_recovery: '引き継ぎコード再発行',
    player_transfer: '送金', player_report: '通報', player_feedback: '報告・意見案',
    pay_order: '支払いページ', pay_paid: '購入（入金を確認）', pay_slip: 'コンビニ払いの番号', pay_unpaid: 'コンビニ未払い', pay_refund: '返金',
    pay_review: '決済の不一致（保留）', pay_reply: '開発者の返信', pay_error: '決済ページのエラー', pay_unknown: '不明な決済通知', pay_bad_signature: '不正な決済通知を拒否',
    vault_open: '保管庫を開いた', vault_upload: '保管庫に保存', vault_delete: '保管庫から削除', vault_link: '保管庫のリンク作成',
    vault_link_stop: '保管庫のリンク停止', vault_pull: '保管庫からリンクで取得', vault_folder: '保管庫のフォルダ', vault_move: '保管庫で移動',
    vault_bucket: '保管庫をR2へ移動', vault_ai_label: 'AIのラベル（保管庫）', vault_ai_done: 'AIが実装（保管庫）', vault_restore: '保管庫で実装済みから戻す'
  };
  function actionName(a) { return ACTIONS[a] || (a.indexOf('admin:') === 0 ? '管理コマンド: ' + a.slice(6) : a); }
  var KINDS = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
  var REPORT_PLACES = { profile: 'プロフィール', hub: '「一緒に稼ぐ」', search: 'フレンド検索', chat: 'チャット', message: 'メッセージ（⋯から1件を通報）' };
  var FB_ITEMS = { slot: 'スロットの面白さ', features: 'スロット以外の機能の面白さ', clarity: '全体的なわかりやすさ', controls: '操作性', looks: '見やすさ', polish: '完成度' };

  var $ = function (s) { return document.querySelector(s); };
  var token = null;
  var state = {
    view: 'players', players: [], total: 0, counts: {}, now: Date.now(), filter: 'all', sort: 'new', q: '', open: 0, busy: false,
    reportStatus: 'open', detAll: false, fb: 'open', feedback: [], log: [], logQ: '', logDone: false, chat: null,
    developer: false, operators: [], pay: null, payView: 'waiting', vault: null, vaultFiles: [], vaultFolders: [], vaultFolder: '', vaultPicked: {},
    vaultShow: 'all', vaultPage: 0, logKind: ''
  };
  var timer = 0, liveTimer = 0, searchTimer = 0, logTimer = 0, chatTimer = 0;
  var speed = 'normal';

  try { token = localStorage.getItem(KEY); } catch (e) { token = null; }
  try { speed = localStorage.getItem(SPEED_KEY) || 'normal'; } catch (e) { /* this tab only */ }
  if (!SPEEDS[speed]) speed = 'normal';

  /* ------------------------------------------------------------ the server --- */
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
          var err = { status: res.status, code: e.code || '', message: e.message || 'エラーが発生しました（' + res.status + '）', until: e.until || 0 };
          // the server stopped itself
          if (res.status === 503 && e.emergency) showEmergency();
          else if (res.status === 401 || e.code === 'not_operator' || e.code === 'banned') signedOut(err.message);
          throw err;
        });
      });
  }
  function setToken(t) {
    token = t || null;
    try { if (token) localStorage.setItem(KEY, token); else localStorage.removeItem(KEY); } catch (e) { /* this tab only */ }
  }

  /* ------------------------------------------------------------ formatting --- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP'); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function date(ts, time) {
    if (!ts) return '-';
    var d = new Date(ts);
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + (time ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : '');
  }
  function stamp(ts) {
    if (!ts) return '-';
    var d = new Date(ts);
    return date(ts, true) + ':' + pad(d.getSeconds());
  }
  function ago(ts) {
    if (!ts) return '-';
    var s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'たった今';
    if (s < 3600) return Math.floor(s / 60) + '分前';
    if (s < 86400) return Math.floor(s / 3600) + '時間前';
    return Math.floor(s / 86400) + '日前';
  }
  function hours(ms) {
    var m = Math.floor((ms || 0) / 60000);
    return m < 60 ? m + '分' : Math.floor(m / 60) + '時間' + (m % 60 ? (m % 60) + '分' : '');
  }
  function face(p, big) {
    var f = el('span', 'face');
    if (p && p.avatar) f.style.backgroundImage = 'url("/img/avatars/' + encodeURIComponent(p.avatar) + '.webp")';
    else f.textContent = (Array.from((p && p.name) || '?')[0] || '?').toUpperCase();
    if (big) f.classList.add('big');
    return f;
  }
  // the icon, with 返信待ち and 検知; a tap opens the conversation with the bot
  function faceButton(p) {
    var b = el('button', 'face-wrap');
    b.type = 'button';
    b.dataset.chat = p.id;
    b.title = p.name + 'さんと公式チャットを開く';
    b.appendChild(face(p));
    if (p.waiting) b.appendChild(el('span', 'mark wait', '返信待ち'));
    if (p.detections) b.appendChild(el('span', 'mark det', '検知' + (p.detections > 1 ? ' ' + p.detections : '')));
    return b;
  }
  function person(p, sub) {
    var b = el('button', 'person');
    b.type = 'button';
    if (p && p.id) b.dataset.open = p.id;
    b.appendChild(face(p || {}));
    var t = el('span', '', p ? p.name : '（不明）');
    if (sub) t.appendChild(el('small', '', sub));
    b.appendChild(t);
    return b;
  }
  function banBadge(p) {
    if (p.ban) {
      var b = BAN[p.ban.kind] || BAN.perma;
      return el('span', 'ban ' + b.cls, b.name + (p.ban.until ? '（' + date(p.ban.until, true) + 'まで）' : ''));
    }
    if (p.deviceBlocked) return el('span', 'ban k-device', '端末のBANで停止中');
    return el('span', 'ban k-none', 'なし');
  }
  function ageBadge(p) {
    if (p.age === true) return el('span', 'age yes', 'はい');
    if (p.age === false) return el('span', 'age no', 'いいえ');
    return el('span', 'age none', '未回答');
  }
  function toast(text) {
    var t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function copy(text) {
    var done = function () { toast('コピーしました'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { toast(text); });
    else toast(text);
  }
  function fail(err) { toast(err && err.message ? err.message : 'エラーが発生しました'); }

  /* ------------------------------------------------------------ logging in --- */
  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = message || '';
    closeDetail();
    closeChat();
    clearInterval(timer);
    clearInterval(liveTimer);
    setTimeout(function () { $('#login-name').focus(); }, 50);
  }
  function signedOut(message) {
    setToken(null);
    showLogin(message);
  }
  // this browser's own id (two wrong logins make it wait: server/core/opslogin.js)
  var DEVICE_KEY = 'two-state-ops/device', lockTimer = 0, lockEnd = 0;
  function opsDevice() {
    var d = null;
    try { d = localStorage.getItem(DEVICE_KEY); } catch (e) { d = null; }
    if (!d || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) {
      var a = new Uint8Array(18);
      crypto.getRandomValues(a);
      d = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { localStorage.setItem(DEVICE_KEY, d); } catch (e) { /* this tab only */ }
    }
    return d;
  }
  // the wait, counted down on the login card
  function waitUntil(until) {
    lockEnd = until;
    clearInterval(lockTimer);
    var go = $('#login-go');
    function tick() {
      var left = lockEnd - Date.now();
      if (left <= 0) { clearInterval(lockTimer); go.disabled = false; $('#login-error').textContent = 'もう一度入力できます'; return; }
      go.disabled = true;
      $('#login-error').textContent = '入力制限中です。あと ' + Math.floor(left / 60000) + '分' + pad(Math.floor(left / 1000) % 60) + '秒で入力できます';
    }
    tick();
    lockTimer = setInterval(tick, 1000);
  }
  function onLogin(e) {
    e.preventDefault();
    if (Date.now() < lockEnd) return;
    var name = $('#login-name').value.trim(), pass = $('#login-pass').value;
    if (!name || !pass) { $('#login-error').textContent = '名前とパスワードを入力してください'; return; }
    var go = $('#login-go');
    go.disabled = true;
    $('#login-error').textContent = '';
    request('POST', '/api/ops/login', { name: name, password: pass }, { 'X-Ops-Device': opsDevice() }).then(function (r) {
      setToken(r.token);
      return request('GET', '/api/ops/me').then(function (me) {
        $('#login-pass').value = '';
        start(me);
      }, function (err) {
        // not an operator: the session just made goes again
        fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + r.token, 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
        setToken(null);
        throw err;
      });
    }).catch(function (err) {
      if (err.code === 'ops_locked' && err.until) { waitUntil(err.until); return; }
      $('#login-error').textContent = err.message;
    }).then(function () { if (Date.now() >= lockEnd) go.disabled = false; });
  }
  function logout() {
    var t = token;
    setToken(null);
    if (t) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
    showLogin('ログアウトしました');
  }

  /* ------------------------------------------------------------ views --- */
  function start(me) {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#op-name').textContent = (me.developer ? '開発者: ' : '運営者: ') + me.name;
    state.name = me.name;
    state.developer = !!me.developer;
    state.devCodeSet = !!me.devCodeSet;
    // 課金 and 保管庫: the developer's own
    $('#tab-pay').hidden = !state.developer;
    $('#tab-vault').hidden = !state.developer;
    if (state.developer) loadPay(true);
    load();
    // /ops/#vault: straight to the vault
    if (state.developer && location.hash === '#vault') setView('vault');
    loadTeam(true);
    startTimers();
  }
  // the lists at one speed, the live views at a faster one (while the page is seen)
  function startTimers() {
    clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden || !$('#dialog').hidden || !$('#money').hidden) return;
      load(true);
      if (state.view === 'reports') loadReports(true);
      else if (state.view === 'detections') loadDetections(true);
      else if (state.view === 'feedback') loadFeedback(true);
      if (state.view !== 'team') loadTeam(true);
      if (state.developer && !(state.view === 'pay' && document.activeElement && document.activeElement.tagName === 'TEXTAREA')) loadPay(true);
    }, SPEEDS[speed][0]);
    clearInterval(liveTimer);
    liveTimer = setInterval(function () {
      if (document.hidden) return;
      if (state.view === 'server') loadServer(true);
      else if (state.view === 'team') loadTeam(true);
    }, SPEEDS[speed][1]);
    if (state.chat) chatEvery();
  }
  function setSpeed(v) {
    if (!SPEEDS[v]) return;
    speed = v;
    try { localStorage.setItem(SPEED_KEY, v); } catch (e) { /* this tab only */ }
    if (!$('#app').hidden) startTimers();
    toast('更新頻度：' + $('#speed').selectedOptions[0].textContent + '（一覧 ' + SPEEDS[v][0] / 1000 + '秒・サーバーとチャット ' + SPEEDS[v][1] / 1000 + '秒ごと）');
  }
  function setView(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) { t.classList.toggle('on', t.dataset.view === v); });
    ['players', 'archive', 'reports', 'detections', 'feedback', 'log', 'operators', 'team', 'server', 'pay', 'vault'].forEach(function (x) { $('#view-' + x).hidden = x !== v; });
    if (v === 'players') load();
    else if (v === 'archive') loadArchive();
    else if (v === 'operators') loadOperators();
    else if (v === 'reports') loadReports();
    else if (v === 'detections') loadDetections();
    else if (v === 'feedback') loadFeedback();
    else if (v === 'log') { loadLog(true); verifyLog(); }
    else if (v === 'team') openTeamView();
    else if (v === 'server') { loadServer(); renderDevCards(); }
    else if (v === 'pay') loadPay();
    else if (v === 'vault') renderVault();
    scrollTop();
  }
  function scrollTop() { if (turned) $('#app').scrollTop = 0; else window.scrollTo(0, 0); }
  function setCount(id, n) {
    var b = $('#count-' + id);
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n || 0);
  }

  /* ------------------------------------------------------------ the players --- */
  function load(quiet) {
    return request('GET', '/api/ops/players' + (state.q ? '?q=' + encodeURIComponent(state.q) : '')).then(function (r) {
      state.players = r.players || [];
      state.total = r.total || 0;
      state.now = r.now || Date.now();
      state.counts = { waiting: r.waiting || 0, reports: r.reports || 0, detections: r.detections || 0, feedback: r.feedback || 0 };
      setCount('reports', state.counts.reports);
      setCount('detections', state.counts.detections);
      setCount('feedback', state.counts.feedback);
      setCount('archive', r.archived || 0);
      render();
      if (state.open && quiet) refreshDetail();
    }, function (err) { if (!quiet) fail(err); });
  }
  function visible() {
    var list = state.players.filter(function (p) {
      if (state.filter === 'online') return p.online;
      if (state.filter === 'waiting') return p.waiting;
      if (state.filter === 'detected') return p.detections > 0;
      if (state.filter === 'banned') return !!p.ban || p.deviceBlocked;
      return true;
    });
    var by = {
      new: function (a, b) { return b.createdAt - a.createdAt; },
      worth: function (a, b) { return b.worth - a.worth; },
      seen: function (a, b) { return (b.online - a.online) || (b.lastSeen - a.lastSeen); },
      play: function (a, b) { return b.playMs - a.playMs; }
    }[state.sort];
    // waiting for an answer: always first
    return list.sort(function (a, b) { return (b.waiting - a.waiting) || by(a, b); });
  }
  function render() {
    $('#sum-total').textContent = fmt(state.total);
    $('#sum-online').textContent = fmt(state.players.filter(function (p) { return p.online; }).length);
    $('#sum-waiting').textContent = fmt(state.counts.waiting || 0);
    $('#sum-banned').textContent = fmt(state.players.filter(function (p) { return p.ban || p.deviceBlocked; }).length);
    $('#sum-at').textContent = date(Date.now(), true).slice(11);
    var body = $('#rows');
    body.textContent = '';
    var list = visible();
    $('#empty').hidden = list.length > 0;
    list.forEach(function (p) { body.appendChild(rowEl(p)); });
  }
  function td(label, child, cls) {
    var c = el('td', cls || '');
    c.setAttribute('data-label', label);
    if (child) c.appendChild(child);
    return c;
  }
  function rowEl(p) {
    var tr = el('tr');
    tr.dataset.id = p.id;
    var w = el('div', 'who');
    w.appendChild(faceButton(p));
    var t = el('div');
    var n = el('b', '', p.name);
    if (p.developer) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag maker', '開発者')); }
    if (p.operator) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag op', '運営')); }
    if (p.vip !== null && p.vip !== undefined) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag vip vip-' + p.vip, 'VIP' + p.vip)); }
    if (p.chatBan) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag chatban', 'チャット停止')); }
    t.appendChild(n);
    t.appendChild(el('small', '', '登録 ' + date(p.createdAt)));
    w.appendChild(t);
    tr.appendChild(td('プレイヤー', w));
    var s = el('span', 'status' + (p.online ? ' on' : ''));
    s.appendChild(el('i', 'dot'));
    s.appendChild(document.createTextNode(p.online ? 'オンライン' : '最終 ' + ago(p.lastSeen)));
    tr.appendChild(td('オンライン状況', s));
    var m = el('div', 'money');
    m.appendChild(el('b', '', '$' + fmt(p.worth)));
    m.appendChild(el('small', '', 'トークン ' + fmt(p.tokens) + '・$' + fmt(p.dollars) + '・ロイヤルコイン ' + fmt(p.coins)));
    tr.appendChild(td('資産', m, 'num'));
    tr.appendChild(td('18歳以上', ageBadge(p)));
    tr.appendChild(td('引き継ぎコード', codeEl(p)));
    tr.appendChild(td('パスワード', el('span', 'muted', p.hasPassword ? '設定済み（非公開）' : '未設定')));
    tr.appendChild(td('処分', banBadge(p)));
    return tr;
  }
  function codeEl(p) {
    var c = el('span', 'code');
    if (!p.code) {
      c.appendChild(el('span', 'muted', '未取得（再発行で表示）'));
      return c;
    }
    c.appendChild(el('span', 'mono', p.code));
    var b = el('button', 'copy', 'コピー');
    b.type = 'button';
    b.dataset.copy = p.code;
    c.appendChild(b);
    return c;
  }

  /* ------------------------------------------------------------ one player --- */
  function openDetail(id) {
    state.open = id;
    $('#drawer').hidden = false;
    $('#drawer-back').hidden = false;
    $('#detail').textContent = '';
    $('#detail').appendChild(el('p', 'muted', '読み込み中…'));
    $('#drawer').scrollTop = 0;
    refreshDetail();
  }
  function closeDetail() {
    state.open = 0;
    $('#drawer').hidden = true;
    $('#drawer-back').hidden = true;
  }
  function refreshDetail() {
    var id = state.open;
    if (!id) return;
    request('GET', '/api/ops/player?id=' + id).then(function (r) {
      if (state.open === id) renderDetail(r.player);
    }, fail);
  }
  function cell(label, value, wide) {
    var c = el('div', 'cell' + (wide ? ' wide' : ''));
    c.appendChild(el('span', '', label));
    if (typeof value === 'string') c.appendChild(el('b', '', value));
    else c.appendChild(value);
    return c;
  }
  function section(title) {
    var s = el('section', 'd-sec');
    s.appendChild(el('h3', '', title));
    return s;
  }
  function act(label, name, cls, kind) {
    var b = el('button', 'btn small ' + (cls || ''), label);
    b.type = 'button';
    b.dataset.act = name;
    if (kind) b.dataset.kind = kind;
    return b;
  }
  function renderDetail(p) {
    var box = $('#detail');
    box.textContent = '';
    var head = el('div', 'd-head');
    head.appendChild(faceButton(p));
    var t = el('div');
    t.appendChild(el('h2', '', p.name));
    var s = el('span', 'status' + (p.online ? ' on' : ''));
    s.appendChild(el('i', 'dot'));
    s.appendChild(document.createTextNode(p.online ? 'オンライン' : '最終オンライン ' + date(p.lastSeen, true)));
    t.appendChild(s);
    head.appendChild(t);
    box.appendChild(head);
    // in the プレイヤーアーカイブ
    if (p.archive) {
      var left = Math.max(0, Math.ceil((p.archive.purgeAt - Date.now()) / 86400000));
      box.appendChild(el('p', 'note bad', p.deleted
        ? 'このアカウントは ' + date(p.archive.at, true) + ' に削除されました（取り消し不可）。' + date(p.archive.purgeAt, true) + '（あと' + left + '日）にデータを完全に削除します。'
        : '永久BANでプレイヤーアーカイブに入っています。' + date(p.archive.purgeAt, true) + '（あと' + left + '日）にデータを完全に削除します（永久BANを解除すると一覧に戻ります）。'));
    }

    // the automatic filter stopped their chat: an operator lets it go again
    if (p.chatBan) {
      var cb = section('チャット停止（自動フィルタリングシステム）');
      cb.appendChild(el('p', 'note bad', 'テキスト以外のもの（' + (p.chatBan.why || '理由不明') + '）を送ろうとしたため、' + date(p.chatBan.at, true) + ' からチャットを止めています。くわしくはログの「緊急」にあります。Ice Smoker公式へのメッセージは送れます。'));
      var ca = el('div', 'acts');
      if (!p.deleted) ca.appendChild(act('チャット停止を解除', 'chatUnban', 'ok'));
      cb.appendChild(ca);
      box.appendChild(cb);
    }

    var bot = section('Ice Smoker公式');
    if (p.waiting) bot.appendChild(el('p', 'note bad', 'このプレイヤーのメッセージが返信を待っています。'));
    var a = el('div', 'acts');
    a.appendChild(act('チャットを開く', 'chat', 'primary'));
    if (!p.deleted) a.appendChild(act('送金する', 'money'));
    bot.appendChild(a);
    box.appendChild(bot);

    var basic = section('基本情報');
    var g = el('div', 'grid');
    g.appendChild(cell('登録日', date(p.createdAt, true)));
    var age = el('b');
    age.appendChild(ageBadge(p));
    if (p.ageAt) age.appendChild(el('small', 'muted', ' ' + date(p.ageAt, true) + ' に回答'));
    g.appendChild(cell('18歳以上ですか？', age));
    g.appendChild(cell('遊んでいる累計時間', hours(p.playMs)));
    g.appendChild(cell('最長連続オンライン日', fmt(p.dayBest) + '日'));
    g.appendChild(cell('いまの連続オンライン日', fmt(p.dayStreak) + '日'));
    g.appendChild(cell('ログイン日数', fmt(p.loginDays) + '日'));
    g.appendChild(cell('レベル', 'Lv.' + p.level + '（' + fmt(p.xp) + ' XP）'));
    g.appendChild(cell('フレンド', fmt(p.friends) + '人'));
    g.appendChild(cell('友達と稼ぐ', p.hub ? '参加中（ハブ #' + p.hub + '）' : 'なし'));
    g.appendChild(cell('このプレイヤーへの通報', fmt(p.reportsAgainst) + '件'));
    g.appendChild(cell('このプレイヤーからの通報', fmt(p.reportsBy) + '件'));
    g.appendChild(cell('未確認の検知', fmt(p.detections) + '件'));
    g.appendChild(cell('ゲームのバージョン', versionEl(p.client), true));
    basic.appendChild(g);
    box.appendChild(basic);

    var money = section('資産と記録');
    g = el('div', 'grid');
    g.appendChild(cell('資産（$換算）', '$' + fmt(p.worth)));
    g.appendChild(cell('スピントークン', fmt(p.tokens)));
    g.appendChild(cell('ドル', '$' + fmt(p.dollars)));
    g.appendChild(cell('ロイヤルコイン', fmt(p.coins)));
    g.appendChild(cell('VIP', (p.vip !== null && p.vip !== undefined ? 'VIP' + p.vip + '（' + stamp(p.vipUntil) + ' まで）' : '無効') + '・EXP ' + fmt(Math.floor(p.vipExp || 0))));
    g.appendChild(cell('スピン回数', fmt(p.spins) + '回'));
    g.appendChild(cell('最大勝利', fmt(p.biggestWin)));
    g.appendChild(cell('累計ベット', fmt(p.totalBet)));
    g.appendChild(cell('累計獲得', fmt(p.totalWon)));
    money.appendChild(g);
    box.appendChild(money);

    var acc = section('アカウント');
    g = el('div', 'grid');
    g.appendChild(cell('引き継ぎコード', codeEl(p), true));
    g.appendChild(cell('パスワード', p.hasPassword ? '設定済み（非公開）' : '未設定', true));
    acc.appendChild(g);
    acc.appendChild(el('p', 'note', 'パスワードはハッシュでのみ保存しているため表示できません。忘れた人には再設定してください。'));
    a = el('div', 'acts');
    a.style.marginTop = '10px';
    if (!p.deleted) {
      a.appendChild(act('引き継ぎコードを再発行', 'recovery'));
      a.appendChild(act('パスワードを再設定', 'password'));
    }
    acc.appendChild(a);
    box.appendChild(acc);

    var ban = section('処分');
    var now = el('p', 'note' + (p.ban || p.deviceBlocked ? ' bad' : ''));
    now.textContent = p.ban ? p.ban.message + '（' + date(p.ban.at, true) + ' に実施）'
      : p.deviceBlocked ? 'この端末にBAN中のアカウントがあるため、このアカウントもアクセスできません。'
        : '処分はありません。';
    ban.appendChild(now);
    if (p.deleted) {
      ban.appendChild(el('p', 'muted', '削除したアカウントは、開発者でも元に戻せません。'));
    } else if (p.operator) {
      ban.appendChild(el('p', 'muted', '運営者のアカウントには処分を使えません。'));
    } else {
      a = el('div', 'acts');
      a.style.marginTop = '10px';
      a.appendChild(act('アクセス禁止（1週間）', 'ban', 'warn', 'suspend'));
      a.appendChild(act('BAN（30日）', 'ban', 'danger', 'ban'));
      a.appendChild(act('永久BAN', 'ban', 'danger solid', 'perma'));
      if (p.ban) a.appendChild(act('処分を解除', 'ban', 'ok', 'none'));
      if (p.deviceBlocked) a.appendChild(act('端末のBANから外す', 'deviceOk', 'ok'));
      ban.appendChild(a);
      ban.appendChild(el('p', 'muted', 'アクセス禁止は1週間、BANは30日で自動解除（いつでも解除可）。BAN・永久BANは同じ端末のほかのアカウントも止めます。永久BANはプレイヤーアーカイブに移り、90日後にデータを完全に削除します。'));
    }
    box.appendChild(ban);
    // the developer's eyes only: deleting the account
    if (state.developer && !p.deleted && !p.operator) {
      var del = section('アカウントの削除（開発者だけに表示）');
      del.appendChild(el('p', 'muted', 'このプレイヤーと同じ端末のアカウントを削除します。すぐにログアウトされ、プレイヤーアーカイブに移り、90日後にデータを完全に削除します。開発者でも取り消せません（開発者コードが必要・ログに残ります）。'));
      a = el('div', 'acts');
      a.style.marginTop = '10px';
      a.appendChild(act('アカウントを削除', 'delete', 'danger solid'));
      del.appendChild(a);
      box.appendChild(del);
    }

    var det = section('検知された言葉');
    var dl = el('div', 'cards');
    dl.appendChild(el('p', 'muted', '読み込み中…'));
    det.appendChild(dl);
    box.appendChild(det);
    request('GET', '/api/ops/detections?id=' + p.id + '&all=1').then(function (r) {
      dl.textContent = '';
      if (!r.detections.length) dl.appendChild(el('p', 'muted', '検知はありません'));
      r.detections.slice(0, 30).forEach(function (d) { dl.appendChild(detectionCard(d, true)); });
    }, function () { dl.textContent = ''; });

    var dev = section('端末（' + (p.devices || []).length + '）');
    if (!p.devices || !p.devices.length) dev.appendChild(el('p', 'muted', '記録された端末はありません'));
    (p.devices || []).forEach(function (d) {
      var r = el('div', 'dev');
      r.appendChild(el('b', '', d.label));
      r.appendChild(el('small', '', '初回 ' + date(d.firstAt, true) + '・最終 ' + date(d.lastAt, true)));
      if (d.others.length) {
        var o = el('div', 'others');
        d.others.forEach(function (x) {
          var b = el('button', '', x.name + (x.ban ? '（' + (BAN[x.ban] || BAN.perma).name + '）' : ''));
          b.type = 'button';
          b.dataset.open = x.id;
          o.appendChild(b);
        });
        r.appendChild(o);
      }
      dev.appendChild(r);
    });
    box.appendChild(dev);
    box.dataset.player = JSON.stringify({ id: p.id, name: p.name });
  }

  /* ------------------------------------------------------------ actions --- */
  // a dialog: { title, text, ok, danger, input: { label, type, value } } -> Promise(value | null)
  // (with more than one of input, select and area: { value, pick, text })
  function ask(o) {
    return new Promise(function (resolve) {
      $('#dialog-title').textContent = o.title;
      $('#dialog-text').textContent = o.text || '';
      $('#dialog-error').textContent = '';
      var ok = $('#dialog-ok');
      ok.textContent = o.ok || 'OK';
      ok.className = 'btn ' + (o.danger ? 'danger solid' : 'primary');
      var field = $('#dialog-field'), input = $('#dialog-input');
      field.hidden = !o.input;
      if (o.input) {
        $('#dialog-label').textContent = o.input.label;
        input.type = o.input.type || 'text';
        input.value = o.input.value || '';
      }
      // a choice from a list: { label, options: [{ value, label }], value }
      var pick = $('#dialog-pick'), select = $('#dialog-select');
      pick.hidden = !o.select;
      if (o.select) {
        $('#dialog-pick-label').textContent = o.select.label;
        select.textContent = '';
        o.select.options.forEach(function (x) { var op = el('option', '', x.label); op.value = x.value; select.appendChild(op); });
        select.value = o.select.value || '';
      }
      // several lines: { label, value }
      var areaField = $('#dialog-area-field'), area = $('#dialog-area');
      areaField.hidden = !o.area;
      if (o.area) {
        $('#dialog-area-label').textContent = o.area.label;
        area.value = o.area.value || '';
      }
      $('#dialog').hidden = false;
      setTimeout(function () { (o.input ? input : o.select ? select : o.area ? area : ok).focus(); }, 30);
      var done = function (v) {
        $('#dialog').hidden = true;
        $('#dialog-form').onsubmit = null;
        $('#dialog-cancel').onclick = null;
        resolve(v);
      };
      $('#dialog-form').onsubmit = function (e) {
        e.preventDefault();
        if (o.input && o.check) {
          var problem = o.check(input.value);
          if (problem) { $('#dialog-error').textContent = problem; return; }
        }
        var many = [o.input, o.select, o.area].filter(Boolean).length > 1;
        done(many ? { value: input.value, pick: select.value, text: area.value } : o.input ? input.value : o.select ? select.value : o.area ? area.value : true);
      };
      $('#dialog-cancel').onclick = function () { done(null); };
    });
  }
  function current() { try { return JSON.parse($('#detail').dataset.player || 'null'); } catch (e) { return null; } }
  function afterChange(r) {
    if (r && r.player) {
      var i = state.players.findIndex(function (p) { return p.id === r.player.id; });
      if (i >= 0) state.players[i] = r.player;
      render();
    }
    refreshDetail();
  }
  function onAction(b) {
    var p = current();
    if (!p || state.busy) return;
    var name = b.dataset.act;
    if (name === 'chat') { openChat(p.id); return; }
    if (name === 'money') { openMoney(p); return; }
    if (name === 'chatUnban') {
      ask({ title: 'チャット停止を解除しますか？', text: p.name + ' さんはすぐにまたチャットできるようになります（ログに残ります）。', ok: '解除する' }).then(function (ok) {
        if (!ok) return null;
        return request('POST', '/api/ops/chat-ban', { id: p.id }).then(function (r) { toast('チャット停止を解除しました'); afterChange(r); });
      }).catch(fail);
      return;
    }
    if (name === 'ban') {
      var kind = b.dataset.kind;
      var info = BAN[kind];
      ask(kind === 'none'
        ? { title: '処分を解除しますか？', text: p.name + ' さんはすぐにまた遊べるようになります。公式から解除のお知らせが届きます。', ok: '解除する' }
        : { title: info.long + 'にしますか？', text: p.name + ' さんのゲームはすぐにタイトル画面に戻り、' + (kind === 'perma' ? '解除するまで' : kind === 'ban' ? '30日間' : '1週間') + '先へ進めなくなります。処分と解除のお知らせが公式から届きます。' + (kind === 'suspend' ? '' : '同じ端末のほかのアカウントも止まります。'), ok: info.name + 'にする', danger: true }
      ).then(function (ok) {
        if (!ok) return null;
        state.busy = true;
        return request('POST', '/api/ops/ban', { id: p.id, kind: kind }).then(function (r) {
          toast(kind === 'none' ? '処分を解除しました' : info.long + 'にしました');
          afterChange(r);
        });
      }).catch(fail).then(function () { state.busy = false; });
    } else if (name === 'deviceOk') {
      ask({ title: '端末のBANから外しますか？', text: p.name + ' さんは、同じ端末のアカウントがBAN中でも遊べるようになります（次にその端末でBANがあると、また止まります）。', ok: '外す' }).then(function (ok) {
        if (!ok) return null;
        return request('POST', '/api/ops/device-ok', { id: p.id }).then(function (r) { toast('端末のBANから外しました'); afterChange(r); });
      }).catch(fail);
    } else if (name === 'recovery') {
      ask({ title: '引き継ぎコードを再発行しますか？', text: '今までのコードは使えなくなります。本人確認のうえで発行してください。', ok: '再発行する' }).then(function (ok) {
        if (!ok) return null;
        return request('POST', '/api/ops/recovery', { id: p.id }).then(function (r) {
          afterChange(r);
          return ask({ title: '新しい引き継ぎコード', text: p.name + ' さんの新しいコードです: ' + r.code, ok: 'コピーして閉じる' }).then(function (c) { if (c) copy(r.code); });
        });
      }).catch(fail);
    } else if (name === 'delete') {
      deleteAccount(p);
    } else if (name === 'password') {
      ask({
        title: 'パスワードを再設定',
        text: p.name + ' さんの新しいパスワード（4〜64文字）。本人確認のうえで設定してください。',
        ok: '設定する',
        input: { label: '新しいパスワード', type: 'text' },
        check: function (v) { var n = Array.from(v).length; return n < 4 ? '4文字以上にしてください' : n > 64 ? '64文字までです' : ''; }
      }).then(function (pw) {
        if (pw === null) return null;
        return request('POST', '/api/ops/password', { id: p.id, password: pw }).then(function (r) { toast('パスワードを設定しました'); afterChange(r); });
      }).catch(fail);
    }
  }

  // what the player's game runs: 最新, or which DEV, on what and when it said so
  function platformOf(ua) {
    ua = String(ua || '');
    var os = /Android/.test(ua) ? 'Android' : /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    var app = /; wv\)|TwoState/.test(ua) ? 'アプリ' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
    return [os, app].filter(Boolean).join('・') || '不明';
  }
  function versionEl(c) {
    var b = el('b', 'verline');
    if (!c || !c.release) { b.textContent = '未確認（まだ新しい版で起動していません）'; return b; }
    var newest = c.release >= c.newest;
    b.appendChild(el('span', 'ver ' + (newest ? 'new' : 'old'), newest ? '最新' : 'DEV' + c.release));
    b.appendChild(document.createTextNode(newest ? ' DEV' + c.release : ' 最新は DEV' + c.newest + '（更新されていません）'));
    b.appendChild(el('small', 'muted', [c.build ? 'build ' + c.build : '', platformOf(c.agent), c.at ? date(c.at, true) + ' に確認' : ''].filter(Boolean).join('・')));
    return b;
  }
  // the developer deletes an account (and the ones on the same device), with the developer code
  function deleteAccount(p) {
    request('GET', '/api/ops/delete-account?id=' + p.id).then(function (r) {
      var subs = r.sameDevice.map(function (x) { return x.name; });
      return withCode({
        title: p.name + ' さんのアカウントを削除しますか？',
        text: (subs.length ? '同じ端末の ' + subs.join('、') + ' さんのアカウントも一緒に削除します。' : '') + 'すぐにログアウトされ、プレイヤーアーカイブに移ります。' + r.days + '日後にデータを完全に削除します。この操作は開発者でも取り消せません。',
        ok: '削除する', danger: true
      }).then(function (code) {
        if (code === null) return null;
        return request('POST', '/api/ops/delete-account', { id: p.id, code: code }).then(function (d) {
          toast(d.deleted.map(function (x) { return x.name; }).join('、') + ' さんのアカウントを削除しました');
          afterChange(d);
          load(true);
        });
      });
    }).catch(fail);
  }

  /* ------------------------------------------------------------ 緊急停止 --- */
  var emergencyOn = false;
  function showEmergency() {
    if (emergencyOn) return;
    emergencyOn = true;
    clearInterval(timer);
    clearInterval(liveTimer);
    clearInterval(chatTimer);
    $('#emergency').hidden = false;
    $('#em-list').textContent = '';
    $('#em-release').hidden = true;
    $('#em-text').textContent = 'いつもよりはるかに多い使用量を検知したため、サーバーを止めています。開発者が確認して再開するまでお待ちください。';
    if (state.developer) loadEmergency();
  }
  function loadEmergency() {
    request('GET', '/api/emergency').then(function (r) {
      if (!r.stopped) { location.reload(); return; }
      $('#em-text').textContent = stamp(r.at) + ' から停止中：' + r.reason;
      $('#em-release').hidden = false;
      var list = $('#em-list');
      list.textContent = '';
      list.appendChild(el('h3', '', '緊急ログ'));
      r.entries.forEach(function (x) { list.appendChild(emergencyCard(x)); });
    }, function () {});
  }
  function emergencyCard(x) {
    var card = el('article', 'card');
    var head = el('div', 'card-head');
    head.appendChild(el('span', 'kind', actionName(x.action)));
    head.appendChild(el('span', 'time', stamp(x.at)));
    card.appendChild(head);
    card.appendChild(el('p', 'body-text', x.summary));
    var d = x.detail || {}, facts = el('div', 'facts');
    (d.over || []).forEach(function (o) { fact(facts, o.what + '（1分）', fmt(o.value) + '（ふだん ' + fmt(o.usual) + '・下限 ' + fmt(o.floor) + '）'); });
    var b = d.busiest || {};
    if (b.addresses && b.addresses.length) fact(facts, '多かったアドレス', b.addresses.slice(0, 5).map(function (a) { return a.key + '（' + fmt(a.n) + '）'; }).join('・'));
    if (b.accounts && b.accounts.length) fact(facts, '多かったアカウント', b.accounts.slice(0, 5).map(function (a) { return a.name + '（' + fmt(a.n) + '）'; }).join('・'));
    if (b.apis && b.apis.length) fact(facts, '多かったAPI', b.apis.slice(0, 5).map(function (a) { return a.key + '（' + fmt(a.n) + '）'; }).join('・'));
    card.appendChild(facts);
    var more = el('details', 'more');
    more.appendChild(el('summary', '', 'すべての記録'));
    more.appendChild(el('pre', 'em-pre', JSON.stringify(d, null, 2)));
    card.appendChild(more);
    return card;
  }
  function releaseEmergency() {
    withCode({ title: '緊急停止を解除しますか？', text: '原因を確かめてから解除してください。サーバーが再開し、解除から30分は自動で止まりません。', ok: '解除する', danger: true }).then(function (code) {
      if (code === null) return null;
      return request('POST', '/api/emergency/release', { code: code }).then(function () { toast('解除しました'); setTimeout(function () { location.reload(); }, 800); });
    }).catch(fail);
  }

  /* ------------------------------------------------------------ プレイヤーアーカイブ --- */
  function loadArchive() {
    var list = $('#archive-list');
    request('GET', '/api/ops/archive').then(function (r) {
      list.textContent = '';
      $('#archive-note').textContent = fmt(r.players.length) + '人';
      if (!r.players.length) list.appendChild(el('p', 'empty muted', 'アーカイブにプレイヤーはいません'));
      r.players.forEach(function (p) { list.appendChild(archiveCard(p, r.now)); });
    }, fail);
  }
  function archiveCard(p, now) {
    var a = p.archive || {};
    var card = el('article', 'card archive-card' + (p.deleted ? ' gone' : ''));
    var head = el('div', 'card-head');
    head.appendChild(person(p, p.withName ? p.withName + ' さんと同じ端末' : ''));
    head.appendChild(el('span', 'kind' + (p.deleted ? ' deleted' : ''), p.deleted ? 'アカウント削除' : '永久BAN'));
    head.appendChild(el('span', 'time', 'アーカイブ ' + stamp(a.at)));
    card.appendChild(head);
    var facts = el('div', 'facts');
    fact(facts, 'データの完全削除', date(a.purgeAt, true) + '（あと' + Math.max(0, Math.ceil((a.purgeAt - now) / 86400000)) + '日）');
    fact(facts, '資産', '$' + fmt(p.worth));
    fact(facts, '最終オンライン', date(p.lastSeen, true));
    fact(facts, '登録', date(p.createdAt, true));
    card.appendChild(facts);
    var acts = el('div', 'acts');
    if (p.deleted) acts.appendChild(el('span', 'muted', '削除したアカウントは元に戻せません'));
    else {
      var b = el('button', 'btn small ok', '永久BANを解除');
      b.type = 'button';
      b.dataset.lift = p.id;
      acts.appendChild(b);
    }
    card.appendChild(acts);
    return card;
  }
  function onArchive(e) {
    var o = e.target.closest('[data-open]');
    if (o) { openDetail(Number(o.dataset.open)); return; }
    var b = e.target.closest('[data-lift]');
    if (!b) return;
    var id = Number(b.dataset.lift);
    ask({ title: '永久BANを解除しますか？', text: 'プレイヤー一覧に戻り、データの完全削除の予定もなくなります。公式から解除のお知らせが届きます。', ok: '解除する' }).then(function (ok) {
      if (!ok) return null;
      return request('POST', '/api/ops/ban', { id: id, kind: 'none' }).then(function () { toast('永久BANを解除しました'); loadArchive(); load(true); });
    }).catch(fail);
  }

  /* ------------------------------------------------------------ the chat with the official bot --- */
  function openChat(id) {
    state.chat = { id: id, data: null, sending: false };
    $('#chat').hidden = false;
    $('#chat-who').textContent = '';
    $('#chat-list').textContent = '';
    $('#chat-list').appendChild(el('p', 'chat-empty', '読み込み中…'));
    $('#c-error').textContent = '';
    $('#c-preview').hidden = true;
    $('#c-subject').value = '';
    $('#c-body').value = '';
    loadChat(true);
    chatEvery();
  }
  function chatEvery() {
    clearInterval(chatTimer);
    chatTimer = setInterval(function () { if (!document.hidden && state.chat) loadChat(false); }, SPEEDS[speed][1]);
  }
  function closeChat() {
    clearInterval(chatTimer);
    state.chat = null;
    $('#chat').hidden = true;
  }
  function loadChat(scroll) {
    var c = state.chat;
    if (!c) return;
    request('GET', '/api/ops/chat?id=' + c.id).then(function (r) {
      if (state.chat !== c) return;
      var newer = !c.data || r.messages.length !== c.data.messages.length || (r.messages.length && r.messages[r.messages.length - 1].id !== c.data.messages[c.data.messages.length - 1].id);
      var readChanged = c.data && c.data.playerReadUpTo !== r.playerReadUpTo;
      c.data = r;
      renderChatHead(r.player);
      if (newer || readChanged || scroll) renderChat(newer || scroll);
      // reading it took the 返信待ち mark away: the list follows
      var i = state.players.findIndex(function (p) { return p.id === r.player.id; });
      if (i >= 0) { state.players[i] = r.player; render(); }
    }, fail);
  }
  function renderChatHead(p) {
    var w = $('#chat-who');
    w.textContent = '';
    w.appendChild(face(p));
    var t = el('div');
    t.appendChild(el('b', '', p.name + ' さん と Ice Smoker公式'));
    t.appendChild(el('small', '', (p.online ? 'オンライン' : '最終オンライン ' + ago(p.lastSeen)) + (p.waiting ? '・返信待ち' : '')));
    w.appendChild(t);
  }
  function renderChat(stick) {
    var c = state.chat, r = c.data, list = $('#chat-list'), sc = $('#chat-scroll');
    var atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60;
    list.textContent = '';
    if (!r.messages.length) list.appendChild(el('p', 'chat-empty', 'まだメッセージはありません。'));
    var lastDay = '';
    r.messages.forEach(function (m) {
      var day = date(m.at);
      if (day !== lastDay) { list.appendChild(el('div', 'day', day)); lastDay = day; }
      var mine = !!(m.from && r.bot && m.from.id === r.bot.id);
      var node = el('div', 'msg ' + (mine ? 'bot' : 'player') + (m.kind === 'transfer' ? ' money' : '') + (m.retracted ? ' retracted' : ''));
      var text = m.kind === 'transfer' ? '送金 ' + (m.currency === 'tokens' ? fmt(m.amount) + ' トークン' : '$' + fmt(m.amount)) + (m.pending ? (m.claimed ? '（受け取り済み）' : '（受け取り待ち）') : '')
        : m.kind === 'present' ? 'プレゼント（' + m.text + '）' : m.retracted ? '（' + (mine ? '運営' : 'プレイヤー') + 'が送信を取り消し）\n' + (m.original || '') : m.text;
      node.appendChild(el('div', 'bubble', text));
      var meta = el('div', 'msg-meta');
      if (mine && r.playerReadUpTo >= m.id) meta.appendChild(el('b', '', '既読'));
      meta.appendChild(document.createTextNode(stamp(m.at)));
      // the bot's words can be taken back within the hour (money never)
      if (mine && m.kind === 'text' && !m.retracted && Date.now() - m.at < 3600000) {
        var undo = el('button', 'btn tiny ghost', '取り消す');
        undo.type = 'button';
        undo.addEventListener('click', function () { retractBot(m); });
        meta.appendChild(undo);
      }
      node.appendChild(meta);
      list.appendChild(node);
    });
    if (stick || atBottom) sc.scrollTop = sc.scrollHeight;
  }
  function retractBot(m) {
    ask({ title: 'このメッセージの送信を取り消しますか？', text: 'プレイヤーの画面から消えます（この画面とログには残ります）。', ok: '取り消す', danger: true }).then(function (ok) {
      if (!ok) return null;
      return request('POST', '/api/ops/chat/retract', { message: m.id }).then(function () { toast('送信を取り消しました'); loadChat(); });
    }).catch(fail);
  }
  function composed() {
    var c = state.chat;
    var name = c && c.data ? c.data.player.name : '';
    return '【' + $('#c-subject').value.trim() + '】\n\n' + name + '様\n\n' + $('#c-body').value.trim() + '\n\nIce Smoker公式より';
  }
  function sendChat(e) {
    e.preventDefault();
    var c = state.chat;
    if (!c || c.sending) return;
    var subject = $('#c-subject').value.trim(), body = $('#c-body').value.trim();
    if (!subject) { $('#c-error').textContent = '件名を入力してください'; return; }
    if (!body) { $('#c-error').textContent = '要件を入力してください'; return; }
    c.sending = true;
    $('#c-send').disabled = true;
    $('#c-error').textContent = '';
    request('POST', '/api/ops/chat', { id: c.id, subject: subject, body: body }).then(function () {
      $('#c-subject').value = '';
      $('#c-body').value = '';
      $('#c-preview').hidden = true;
      toast('送信しました');
      loadChat(true);
    }, function (err) { $('#c-error').textContent = err.message; }).then(function () {
      c.sending = false;
      $('#c-send').disabled = false;
    });
  }

  /* ------------------------------------------------------------ money from the bot --- */
  var moneyFor = null;
  function amountOf(v) { return Number(String(v || '').replace(/[,\s$＄円]/g, '').replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); })); }
  function openMoney(p) {
    moneyFor = p;
    $('#money-title').textContent = p.name + ' さんへ送金';
    $('#money-amount').value = '';
    $('#money-note').value = '';
    $('#money-error').textContent = '';
    Array.prototype.forEach.call(document.querySelectorAll('#money-presets button'), function (b) { b.classList.remove('on'); });
    $('#money').hidden = false;
    setTimeout(function () { $('#money-amount').focus(); }, 30);
  }
  function sendMoney(e) {
    e.preventDefault();
    var p = moneyFor;
    if (!p) return;
    var amount = amountOf($('#money-amount').value);
    if (!Number.isInteger(amount) || amount < 0 || amount > 10000000) { $('#money-error').textContent = '金額は $0〜$10,000,000 の整数で入力してください'; return; }
    var note = $('#money-note').value.trim();
    if (!amount && !note) { $('#money-error').textContent = '金額を入力してください'; return; }
    ask({ title: '$' + fmt(amount) + ' を送りますか？', text: p.name + ' さんへ公式から送金します。' + (note ? '「' + note + '」も届きます。' : ''), ok: '送金する' }).then(function (ok) {
      if (!ok) return null;
      $('#money-ok').disabled = true;
      return request('POST', '/api/ops/money', { id: p.id, amount: amount, note: note }).then(function (r) {
        $('#money').hidden = true;
        toast(p.name + ' さんへ $' + fmt(amount) + ' を送りました');
        afterChange(r);
        if (state.chat && state.chat.id === p.id) loadChat(true);
      });
    }).catch(function (err) { $('#money-error').textContent = err.message; }).then(function () { $('#money-ok').disabled = false; });
  }

  /* ------------------------------------------------------------ 通報 --- */
  function loadReports(quiet) {
    var list = $('#report-list');
    if (!quiet) { list.textContent = ''; list.appendChild(el('p', 'muted', '読み込み中…')); }
    request('GET', '/api/ops/reports?status=' + state.reportStatus).then(function (r) {
      list.textContent = '';
      if (!r.reports.length) list.appendChild(el('p', 'empty muted', state.reportStatus === 'open' ? '未処理の通報はありません' : '処理済みの通報はありません'));
      r.reports.forEach(function (x) { list.appendChild(reportCard(x)); });
    }, function (err) { if (!quiet) fail(err); });
  }
  function fact(box, label, value) {
    var d = el('div');
    d.appendChild(el('span', '', label));
    d.appendChild(el('b', '', value));
    box.appendChild(d);
  }
  function reportCard(r) {
    var card = el('article', 'card' + (r.status !== 'open' ? ' done' : ''));
    card.dataset.report = r.id;
    var head = el('div', 'card-head');
    head.appendChild(el('span', 'kind', r.kindName));
    head.appendChild(person(r.reporter, '通報した人'));
    head.appendChild(el('span', 'arrow', '→'));
    head.appendChild(person(r.target, '通報された人'));
    head.appendChild(el('span', 'time', '#' + r.id + '・' + stamp(r.at)));
    card.appendChild(head);
    var ctx = r.context || {}, t = ctx.target || {};
    if (ctx.message) {
      var q = el('div', 'quote');
      q.appendChild(el('small', 'muted', '通報されたメッセージ' + (ctx.group ? '（グループ「' + ctx.group.name + '」）' : '') + '・' + stamp(ctx.message.at) + (ctx.message.retracted ? '・あとで送信者が取り消し' : '')));
      q.appendChild(el('p', '', ctx.message.text));
      card.appendChild(q);
    }
    card.appendChild(el('p', 'body-text', r.text || (ctx.message ? '（通報者のコメントなし）' : '')));
    var facts = el('div', 'facts');
    fact(facts, '通報した場所', REPORT_PLACES[r.place] || r.place || '-');
    fact(facts, 'ふたりの関係', (ctx.friends ? 'フレンド' : 'フレンドではない') + (ctx.sameHub ? '・同じ「一緒に稼ぐ」' : ''));
    fact(facts, '対象のレベル', t.level ? 'Lv.' + t.level : '-');
    fact(facts, '対象の所持金', '$' + fmt(t.dollars) + '・トークン ' + fmt(t.tokens));
    fact(facts, '対象の登録日', date(t.createdAt, true));
    fact(facts, '対象の最終オンライン', t.online ? 'オンライン（通報時）' : date(t.lastSeen, true));
    fact(facts, '対象の18歳以上', t.age === true ? 'はい' : t.age === false ? 'いいえ' : '未回答');
    fact(facts, '対象の処分', t.banned ? '処分中（通報時）' : 'なし');
    if (ctx.request) fact(facts, '通報した端末', (ctx.request.ip || '-') + ' / ' + (ctx.request.userAgent || '').slice(0, 80));
    card.appendChild(facts);
    if ((ctx.around || []).length) {
      var ar = el('details', 'more');
      ar.open = true;
      ar.appendChild(el('summary', '', '前後の会話（' + ctx.around.length + '件・取り消されたものも元の文で表示）'));
      var ac = el('div', 'mini-chat');
      ctx.around.forEach(function (m) {
        var line = el('p', m.reported ? 'hit' : '');
        line.appendChild(el('b', '', m.from ? m.from.name : 'システム'));
        line.appendChild(document.createTextNode((m.retracted ? '［取り消し済み］' : '') + (m.kind === 'transfer' ? '送金 ' + fmt(m.amount) : m.kind === 'text' || m.kind === 'system' ? m.text : '（' + m.kind + '）')));
        line.appendChild(el('small', '', stamp(m.at)));
        ac.appendChild(line);
      });
      ar.appendChild(ac);
      card.appendChild(ar);
    }
    if ((ctx.messages || []).length) {
      var more = el('details', 'more');
      more.appendChild(el('summary', '', 'ふたりの最近のメッセージ（' + ctx.messages.length + '件）'));
      var mc = el('div', 'mini-chat');
      ctx.messages.forEach(function (m) {
        var line = el('p');
        line.appendChild(el('b', '', m.from || '?'));
        line.appendChild(document.createTextNode(m.kind === 'transfer' ? '送金 ' + fmt(m.amount) : m.kind === 'text' ? m.text : '（' + m.kind + '）'));
        line.appendChild(el('small', '', stamp(m.at)));
        mc.appendChild(line);
      });
      more.appendChild(mc);
      card.appendChild(more);
    }
    if ((ctx.detections || []).length) {
      var dm = el('details', 'more');
      dm.appendChild(el('summary', '', '対象の検知された言葉（' + ctx.detections.length + '件）'));
      var dc = el('div', 'mini-chat');
      ctx.detections.forEach(function (d) {
        var line = el('p', '', d.original);
        line.appendChild(el('small', '', stamp(d.created_at)));
        dc.appendChild(line);
      });
      dm.appendChild(dc);
      card.appendChild(dm);
    }
    var a = el('div', 'acts');
    if (r.status === 'open') {
      [600000, 1200000, 2400000].forEach(function (v) {
        var b = el('button', 'btn small ok', '受理して $' + fmt(v) + ' 送る');
        b.type = 'button';
        b.dataset.accept = v;
        a.appendChild(b);
      });
      var no = el('button', 'btn small ghost', '受理しない');
      no.type = 'button';
      no.dataset.reject = '1';
      a.appendChild(no);
    } else {
      a.appendChild(el('span', 'kind ' + r.status, r.status === 'accepted' ? '受理（$' + fmt(r.reward) + ' 送金）' : '受理しなかった'));
      a.appendChild(el('span', 'muted', (r.handledBy ? r.handledBy.name : '?') + '・' + stamp(r.handledAt)));
    }
    card.appendChild(a);
    return card;
  }
  function onReport(e) {
    var o = e.target.closest('[data-open]');
    if (o) { openDetail(Number(o.dataset.open)); return; }
    var b = e.target.closest('[data-accept], [data-reject]');
    if (!b) return;
    var id = Number(b.closest('[data-report]').dataset.report);
    var reward = Number(b.dataset.accept || 0);
    ask(reward
      ? { title: '通報 #' + id + ' を受理しますか？', text: '通報した人へ公式から $' + fmt(reward) + ' とお礼が届きます。', ok: '受理して送る' }
      : { title: '通報 #' + id + ' を受理しませんか？', text: '通報した人には何も届きません。', ok: '受理しない', danger: true }
    ).then(function (ok) {
      if (!ok) return null;
      return request('POST', '/api/ops/report', reward ? { id: id, action: 'accept', reward: reward } : { id: id, action: 'reject' }).then(function () {
        toast(reward ? '受理して $' + fmt(reward) + ' を送りました' : '受理しませんでした');
        loadReports(true);
        load(true);
      });
    }).catch(fail);
  }

  /* ------------------------------------------------------------ 検知 --- */
  function loadDetections(quiet) {
    var list = $('#det-list');
    if (!quiet) { list.textContent = ''; list.appendChild(el('p', 'muted', '読み込み中…')); }
    request('GET', '/api/ops/detections' + (state.detAll ? '?all=1' : '')).then(function (r) {
      list.textContent = '';
      if (!r.detections.length) list.appendChild(el('p', 'empty muted', state.detAll ? '検知はありません' : '未確認の検知はありません'));
      r.detections.forEach(function (d) { list.appendChild(detectionCard(d, false)); });
    }, function (err) { if (!quiet) fail(err); });
  }
  // the original, with the parts the filter took out marked (masked: those parts as ***):
  // original = part0 + hit + part1 + hit + … + partN
  function highlighted(original, masked) {
    var p = el('p', 'body-text');
    var parts = String(masked).split('***'), out = [], at = parts[0].length, ok = original.indexOf(parts[0]) === 0;
    out.push({ text: parts[0] });
    for (var i = 1; ok && i < parts.length; i++) {
      var seg = parts[i], last = i === parts.length - 1;
      var end = last ? original.length - seg.length : original.indexOf(seg, at + 1);
      if (end <= at || (last && original.slice(end) !== seg)) { ok = false; break; }
      out.push({ hit: true, text: original.slice(at, end) });
      out.push({ text: seg });
      at = end + seg.length;
    }
    if (!ok) { p.textContent = original; return p; }
    out.forEach(function (x) {
      if (x.hit) p.appendChild(el('span', 'hit', x.text));
      else if (x.text) p.appendChild(document.createTextNode(x.text));
    });
    return p;
  }
  function detectionCard(d, compact) {
    var card = el('article', 'card' + (d.reviewedAt ? ' done' : ''));
    card.dataset.det = d.id;
    var head = el('div', 'card-head');
    head.appendChild(el('span', 'kind', (d.words || []).join('・') || '検知'));
    if (!compact) head.appendChild(person(d.sender, '送った人'));
    head.appendChild(el('span', 'arrow', '→'));
    var place = d.place === 'dm' ? null : d.place;
    if (d.recipient && d.recipient.id) head.appendChild(person(d.recipient, '受け取った人'));
    else head.appendChild(el('span', 'muted', place && place.indexOf('group:') === 0 ? 'グループ「' + place.slice(6) + '」' : place === 'home' ? 'ホームチャット' : place === 'hub' ? '「一緒に稼ぐ」の即席チャット' : (place || '-')));
    head.appendChild(el('span', 'time', stamp(d.at)));
    card.appendChild(head);
    card.appendChild(highlighted(d.original, d.masked));
    var a = el('div', 'acts');
    if (!d.reviewedAt) {
      var b = el('button', 'btn small ok', '確認済みにする');
      b.type = 'button';
      b.dataset.review = d.id;
      a.appendChild(b);
      if (!compact && d.sender) {
        var all = el('button', 'btn small ghost', d.sender.name + ' さんの検知をすべて確認済みに');
        all.type = 'button';
        all.dataset.reviewAll = d.sender.id;
        a.appendChild(all);
      }
    } else {
      a.appendChild(el('span', 'muted', '確認済み（' + stamp(d.reviewedAt) + '）'));
    }
    card.appendChild(a);
    return card;
  }
  function onDetection(e) {
    var o = e.target.closest('[data-open]');
    if (o) { openDetail(Number(o.dataset.open)); return; }
    var b = e.target.closest('[data-review], [data-review-all]');
    if (!b) return;
    var body = b.dataset.review ? { id: Number(b.dataset.review) } : { player: Number(b.dataset.reviewAll) };
    b.disabled = true;
    request('POST', '/api/ops/detections/review', body).then(function (r) {
      toast(r.reviewed + '件を確認済みにしました');
      if (state.view === 'detections') loadDetections(true);
      load(true);
      if (state.open) refreshDetail();
    }, function (err) { b.disabled = false; fail(err); });
  }

  /* ------------------------------------------------------------ 報告・意見案 --- */
  function loadFeedback(quiet) {
    var list = $('#fb-list');
    if (!quiet) { list.textContent = ''; list.appendChild(el('p', 'muted', '読み込み中…')); }
    request('GET', '/api/ops/feedback').then(function (r) {
      state.feedback = r.feedback || [];
      renderFeedback();
    }, function (err) { if (!quiet) fail(err); });
  }
  function renderFeedback() {
    var list = $('#fb-list');
    list.textContent = '';
    var items = state.feedback.filter(function (f) { return state.fb === 'all' || !f.handledAt; });
    if (!items.length) list.appendChild(el('p', 'empty muted', state.fb === 'all' ? 'まだ届いていません' : '未対応のものはありません'));
    items.forEach(function (f) {
      var card = el('article', 'card' + (f.handledAt ? ' done' : ''));
      card.dataset.fb = f.id;
      var head = el('div', 'card-head');
      head.appendChild(el('span', 'kind ' + f.kind, f.kind === 'bug' ? '報告（不具合）' : f.kind === 'idea' ? '意見案' : 'フィードバック（★）'));
      head.appendChild(person(f.user));
      head.appendChild(el('span', 'time', '#' + f.id + '・' + stamp(f.at)));
      card.appendChild(head);
      if (f.kind === 'rating') {
        var facts = el('div', 'facts');
        Object.keys(FB_ITEMS).forEach(function (k) {
          var v = f.ratings && f.ratings[k];
          fact(facts, FB_ITEMS[k], v ? '★'.repeat(v) + '☆'.repeat(5 - v) : '-');
        });
        card.appendChild(facts);
      }
      card.appendChild(el('p', 'body-text', f.text || '（コメントなし）'));
      var a = el('div', 'acts');
      if (f.user && f.user.id) {
        var c = el('button', 'btn small primary', 'チャットで返信');
        c.type = 'button';
        c.dataset.chat = f.user.id;
        a.appendChild(c);
      }
      if (f.kind === 'idea') {
        if (f.adoptedAt) a.appendChild(el('span', 'adopted', '採用済み（' + stamp(f.adoptedAt) + '）'));
        else {
          var ad = el('button', 'btn small warn', '採用する（50,000 スピントークンを送る）');
          ad.type = 'button';
          ad.dataset.adopt = f.id;
          a.appendChild(ad);
        }
      }
      if (!f.handledAt) {
        var h = el('button', 'btn small ok', '対応済みにする');
        h.type = 'button';
        h.dataset.handled = f.id;
        a.appendChild(h);
      } else if (!f.adoptedAt) {
        a.appendChild(el('span', 'muted', '対応済み（' + stamp(f.handledAt) + '）'));
      }
      card.appendChild(a);
      list.appendChild(card);
    });
  }
  function onFeedback(e) {
    var o = e.target.closest('[data-open]');
    if (o) { openDetail(Number(o.dataset.open)); return; }
    var c = e.target.closest('[data-chat]');
    if (c) { openChat(Number(c.dataset.chat)); return; }
    var ad = e.target.closest('[data-adopt]');
    if (ad) { adopt(Number(ad.dataset.adopt), ad); return; }
    var b = e.target.closest('[data-handled]');
    if (!b) return;
    b.disabled = true;
    request('POST', '/api/ops/feedback/handled', { id: Number(b.dataset.handled) }).then(function () {
      toast('対応済みにしました');
      loadFeedback(true);
      load(true);
    }, function (err) { b.disabled = false; fail(err); });
  }

  function adopt(id, b) {
    var f = state.feedback.find(function (x) { return x.id === id; });
    var who = f && f.user ? f.user.name : '';
    ask({ title: 'この意見案を採用しますか？', text: who + ' さんに公式から 50,000 スピントークンとお礼が届きます（1つにつき1回）。', ok: '採用する' }).then(function (ok) {
      if (!ok) return null;
      b.disabled = true;
      return request('POST', '/api/ops/feedback/adopt', { id: id }).then(function () {
        toast('採用して 50,000 スピントークンを送りました');
        loadFeedback(true);
        load(true);
      });
    }).catch(function (err) { b.disabled = false; fail(err); });
  }

  /* ------------------------------------------------------------ the operators (developer code) --- */
  function loadOperators() {
    var list = $('#op-list');
    list.textContent = '';
    list.appendChild(el('p', 'muted', '読み込み中…'));
    request('GET', '/api/ops/operators').then(function (r) {
      state.operators = r.operators || [];
      state.devCodeSet = !!r.devCodeSet;
      renderOperators();
    }, fail);
  }
  function renderOperators() {
    // the developer registers the code once (it is kept only as a one-way hash)
    var reg = $('#op-devcode');
    reg.hidden = !state.developer;
    $('#op-devcode-text').textContent = state.devCodeSet
      ? '開発者コードは登録済みです（変更には今のコードが必要）。'
      : '開発者コードが未登録です。運営権の付与・剥奪に使うコードを、最初に一度だけ登録してください。';
    $('#op-devcode-btn').textContent = state.devCodeSet ? '開発者コードを変更' : '開発者コードを登録';
    var list = $('#op-list');
    list.textContent = '';
    state.operators.forEach(function (o) {
      var card = el('article', 'card' + (o.operator ? '' : ' done'));
      var head = el('div', 'card-head');
      head.appendChild(person({ id: o.id, name: o.name, avatar: o.avatar }, !o.registered ? 'アカウント未登録'
        : o.site ? '運営サイトにいます' : o.online ? 'ゲーム中' : o.seenAt ? '最終オンライン ' + date(o.seenAt, true) + '（' + ago(o.seenAt) + '）' : 'まだオンラインになっていません'));
      head.appendChild(el('span', 'kind ' + (o.developer ? 'dev' : o.operator ? 'op' : 'revoked'), o.developer ? '開発者' : o.operator ? '運営者' : '運営権なし（剥奪済み）'));
      card.appendChild(head);
      var a = el('div', 'acts');
      if (o.changed && !o.developer) a.appendChild(el('span', 'muted', stamp(o.changed.at) + ' に' + (o.changed.by ? o.changed.by + 'が' : '') + (o.changed.granted ? '付与' : '剥奪')));
      if (o.developer) a.appendChild(el('span', 'muted', '開発者の運営権は剥奪できません'));
      else if (o.registered) {
        var b = el('button', o.operator ? 'btn small danger' : 'btn small', o.operator ? '運営権を剥奪する' : '運営権を戻す');
        b.type = 'button';
        b.dataset.opAct = o.operator ? 'revoke' : 'grant';
        b.dataset.name = o.name;
        a.appendChild(b);
      }
      card.appendChild(a);
      list.appendChild(card);
    });
  }
  // the developer code for one action (asked every time, never kept here)
  function withCode(o) {
    return ask({ title: o.title, text: o.text + '（開発者コードが必要です）', ok: o.ok, danger: o.danger, input: { label: '開発者コード', type: 'password' },
      check: function (v) { return /^[\d\s-]{4,40}$/.test(v) ? '' : '開発者コードを入力してください'; } });
  }
  function changeAccess(action, name, b) {
    var revoke = action === 'revoke';
    withCode(revoke
      ? { title: name + ' さんの運営権を剥奪しますか？', text: name + ' さんはすぐ全端末でログアウトされ、運営サイトに入れなくなります（ゲームには入れます）。', ok: '剥奪する', danger: true }
      : { title: name + ' さんに運営権を付与しますか？', text: name + ' さんは運営サイトのすべての操作ができるようになります。', ok: '付与する' }
    ).then(function (code) {
      if (code === null) return null;
      if (b) b.disabled = true;
      return request('POST', '/api/ops/operator', { name: name, action: action, code: code }).then(function (r) {
        toast(revoke ? name + ' さんの運営権を剥奪しました' : name + ' さんに運営権を付与しました');
        state.operators = r.operators || [];
        renderOperators();
        $('#op-grant-name').value = '';
      });
    }).catch(function (err) { if (b) b.disabled = false; fail(err); });
  }
  function onOperators(e) {
    var o = e.target.closest('[data-open]');
    if (o && Number(o.dataset.open)) { openDetail(Number(o.dataset.open)); return; }
    var b = e.target.closest('[data-op-act]');
    if (b) changeAccess(b.dataset.opAct, b.dataset.name, b);
  }
  function onGrant(e) {
    e.preventDefault();
    var name = $('#op-grant-name').value.trim();
    if (!name) { toast('運営権を付与するプレイヤーの名前を入力してください'); return; }
    changeAccess('grant', name, null);
  }
  function registerCode() {
    var change = state.devCodeSet;
    (change
      ? ask({ title: '開発者コードを変更', text: '今の開発者コードを入力してください。', ok: '次へ', input: { label: '今の開発者コード', type: 'password' } })
      : Promise.resolve('')
    ).then(function (old) {
      if (old === null) return null;
      return ask({
        title: change ? '新しい開発者コード' : '開発者コードを登録',
        text: '8〜32桁の数字（元のコードはどこにも残りません）。',
        ok: '登録する',
        input: { label: '開発者コード', type: 'password' },
        check: function (v) { return /^\d{8,32}$/.test(v.replace(/[\s-]/g, '')) ? '' : '8〜32桁の数字にしてください'; }
      }).then(function (code) {
        if (code === null) return null;
        return request('POST', '/api/ops/dev-code', { code: code, old: old }).then(function () {
          state.devCodeSet = true;
          toast('開発者コードを登録しました');
          renderOperators();
          if (change) return relockBackupKey(old, code);
          return null;
        });
      });
    }).catch(fail);
  }

  /* ------------------------------------------------------------ 課金 (開発者支援, the developer's own) --- */
  var drafts = {};   // replies being written, by player (kept while the list refreshes)
  function yen(n) { return fmt(n) + '円'; }
  function loadPay(quiet) {
    if (!state.developer) return Promise.resolve();
    return request('GET', '/api/ops/pay').then(function (r) {
      state.pay = r;
      setCount('pay', r.waiting.length);
      if (state.view === 'pay') renderPay();
    }, function (err) { if (!quiet) fail(err); });
  }
  function payStat(box, label, value, cls) {
    var d = el('div', 'stat' + (cls ? ' ' + cls : ''));
    d.appendChild(el('span', '', label));
    d.appendChild(el('b', '', value));
    box.appendChild(d);
  }
  function renderPay() {
    var r = state.pay;
    if (!r) return;
    var st = r.setup, t = r.totals, m = r.meters;
    var setup = $('#pay-setup');
    setup.textContent = '';
    var box = el('div', 'pay-setup ' + st.mode);
    box.appendChild(el('b', '', st.mode === 'live' ? '● 本番：実際のお金での購入を受け付けています'
      : st.mode === 'test' ? '● テストモード：Stripe のテスト用の鍵です（お金は動きません）' : '● 停止中：購入はできません（下の設定が必要です）'));
    if (st.problems && st.problems.length) {
      var ul = el('ul');
      st.problems.forEach(function (x) { ul.appendChild(el('li', '', x)); });
      box.appendChild(ul);
    }
    box.appendChild(el('p', '', '支払い方法：' + (st.methods.length ? st.methods.join('・') : 'なし') + '　/　1人24時間あたり ' + yen(st.dailyMax) + 'まで' +
      (st.seller ? '' : '　/　特定商取引法の表記（SELLER_NAME など）が未設定です')));
    if (st.webhook) box.appendChild(el('p', 'mono', 'Webhook の送信先：' + st.webhook + '　イベント：' + st.events.join(', ')));
    setup.appendChild(box);
    var sum = $('#pay-sum');
    sum.textContent = '';
    payStat(sum, '開発費回収', fmt(m.recover.have) + ' / ' + yen(m.recover.goal));
    payStat(sum, '来月の開発費確保（今月）', fmt(m.monthly.have) + ' / ' + yen(m.monthly.goal));
    payStat(sum, '今月の売上', yen(t.monthYen) + '（' + fmt(t.monthOrders) + '件）');
    payStat(sum, '累計の売上', yen(t.yen) + '（' + fmt(t.orders) + '件・' + fmt(t.payers) + '人）');
    payStat(sum, '返信待ち', fmt(r.waiting.length) + '人', r.waiting.length ? 'hot' : '');
    var list = $('#pay-list');
    list.textContent = '';
    var notes = [];
    if (t.slips) notes.push('コンビニ払いの支払い待ち ' + t.slips + '件（' + yen(t.slipYen) + '）');
    if (t.refunds) notes.push('返金 ' + t.refunds + '件（' + yen(t.refundYen) + '）');
    if (t.review) notes.push('⚠ Stripe と一致しない注文が ' + t.review + '件（ロイヤルコインは未付与。Stripe のダッシュボードで確認してください）');
    if (notes.length) list.appendChild(el('p', 'pay-notes', notes.join('　/　')));
    if (state.payView === 'waiting') {
      if (!r.waiting.length) list.appendChild(el('p', 'empty muted', '返信待ちの人はいません'));
      r.waiting.forEach(function (w) { list.appendChild(payCard(w)); });
    } else {
      if (!r.orders.length) list.appendChild(el('p', 'empty muted', '注文はまだありません'));
      r.orders.forEach(function (o) { list.appendChild(orderCard(o)); });
    }
  }
  // a player who paid: what they bought, how many, how much, and the reply
  function payCard(w) {
    var card = el('article', 'card pay-card');
    var head = el('div', 'card-head');
    head.appendChild(person(w.player, w.player.online ? 'オンライン' : ''));
    head.appendChild(el('span', 'kind idea', '返信待ち'));
    head.appendChild(el('span', 'time', '購入 ' + stamp(w.first) + (w.last !== w.first ? ' 〜 ' + stamp(w.last) : '')));
    card.appendChild(head);
    var items = el('div', 'pay-items');
    w.items.forEach(function (it) { items.appendChild(el('span', 'pay-item', it.name + ' × ' + fmt(it.qty) + '口（' + yen(it.amount) + '）')); });
    card.appendChild(items);
    card.appendChild(el('p', 'pay-total', '合計 ' + yen(w.amount) + '・ロイヤルコイン ' + fmt(w.coins) + '枚・' + fmt(w.orders) + '件'));
    var ta = el('textarea', 'pay-reply');
    ta.rows = 3;
    ta.maxLength = 5000;
    ta.placeholder = w.player.name + 'さんへの熱いお言葉';
    ta.value = drafts[w.player.id] || '';
    ta.dataset.draft = w.player.id;
    card.appendChild(ta);
    var a = el('div', 'acts');
    var b = el('button', 'btn primary small', '返信して一覧から消す');
    b.type = 'button';
    b.dataset.reply = w.player.id;
    b.dataset.upto = w.last;
    b.dataset.name = w.player.name;
    a.appendChild(b);
    card.appendChild(a);
    return card;
  }
  function orderCard(o) {
    var card = el('article', 'card' + (o.status === 'paid' ? '' : ' done'));
    var head = el('div', 'card-head');
    head.appendChild(person(o.player || {}, ''));
    head.appendChild(el('span', 'kind ' + (o.status === 'paid' ? 'accepted' : o.status === 'review' ? '' : 'rating'), o.statusName));
    head.appendChild(el('span', 'time', stamp(o.createdAt)));
    card.appendChild(head);
    var f = el('div', 'facts');
    fact(f, '内容', o.name + ' × ' + fmt(o.qty) + '口');
    fact(f, '金額', yen(o.amount));
    fact(f, 'ロイヤルコイン', fmt(o.coins) + '枚' + (o.coinsBack ? '（返金で ' + fmt(o.coinsBack) + '枚回収）' : ''));
    fact(f, '支払い方法', o.methodName);
    fact(f, '入金', o.paidAt ? stamp(o.paidAt) : '-');
    fact(f, '開発者の返信', o.repliedAt ? stamp(o.repliedAt) : o.status === 'paid' ? 'まだ' : '-');
    fact(f, '注文番号', o.id);
    card.appendChild(f);
    if (o.reply) card.appendChild(el('p', 'pay-said', '返信：' + o.reply));
    return card;
  }
  function onPay(e) {
    var b = e.target.closest('[data-reply]');
    if (!b) return;
    var id = Number(b.dataset.reply), name = b.dataset.name;
    var text = String(drafts[id] || '').trim();
    if (!text) { toast(name + 'さんへの返信を書いてください'); return; }
    var full = '【開発者からのメッセージ】\n\n' + name + '様\n\n' + text + '\n\nTwo state 開発者 ' + state.name;
    ask({ title: name + 'さんに返信しますか？', text: full, ok: '送信して一覧から消す' }).then(function (ok) {
      if (!ok) return null;
      b.disabled = true;
      return request('POST', '/api/ops/pay/reply', { id: id, text: text, upto: Number(b.dataset.upto) }).then(function () {
        delete drafts[id];
        toast(name + 'さんに返信しました');
        return loadPay();
      });
    }).catch(function (err) { b.disabled = false; fail(err); });
  }

  /* ------------------------------------------------------------ 運営チャット --- */
  // the operators (who is on) and the conversation open: an operator's id, 0 for everyone, null none
  // (the developer: also 'pair:<a>:<b>', a one-to-one talk between two others, read only)
  var team = { list: null, peer: null, messages: [], theirRead: 0, seq: 0, busy: 0, again: false, sending: false, pairs: [] };
  var isPair = function (peer) { return typeof peer === 'string'; };
  function teamUnread(r) { return r.all.unread + r.operators.reduce(function (n, o) { return n + o.unread; }, 0); }
  function peerRow(peer) {
    var r = team.list;
    if (!r || isPair(peer)) return null;
    return peer === 0 ? r.all : r.operators.filter(function (o) { return o.id === peer; })[0] || null;
  }
  function loadTeam(quiet) {
    return request('GET', '/api/ops/team').then(function (r) {
      team.list = r;
      // the conversation on the screen is read
      var open = state.view === 'team' && !document.hidden && team.peer !== null ? peerRow(team.peer) : null, mustRead = !!(open && open.unread);
      if (open) open.unread = 0;
      setCount('team', teamUnread(r));
      if (state.view !== 'team') return null;
      if (state.developer) request('GET', '/api/ops/team/pairs').then(function (p) { team.pairs = p.pairs; renderTeamList(); }, function () {});
      renderTeamList();
      renderTeamHead();
      return loadTeamMsgs(false, mustRead);
    }, function (err) { if (!quiet) fail(err); });
  }
  function openTeamView() {
    loadTeam().then(function () { if (team.peer === null && state.view === 'team') openTeam(0); });
  }
  function openTeam(peer) {
    team.peer = peer;
    team.seq++;
    team.messages = [];
    team.theirRead = 0;
    var o = peerRow(peer);
    if (o && o.unread) { o.unread = 0; setCount('team', teamUnread(team.list)); }
    var list = $('#team-msgs');
    list.textContent = '';
    list.appendChild(el('p', 'chat-empty', '読み込み中…'));
    $('#team-form').hidden = isPair(peer);
    renderTeamList();
    renderTeamHead();
    loadTeamMsgs(true, true);
  }
  function lastTeamId() { return team.messages.length ? team.messages[team.messages.length - 1].id : 0; }
  // what came after the last one (all of it the first time); `mustRead`: read up to the newest
  function loadTeamMsgs(stick, mustRead) {
    var peer = team.peer, seq = team.seq;
    if (peer === null) return Promise.resolve();
    if (team.busy === seq) { team.again = true; return Promise.resolve(); }
    team.busy = seq;
    var after = lastTeamId(), ab = isPair(peer) ? peer.split(':') : null;
    var url = ab ? '/api/ops/team/pair?a=' + ab[1] + '&b=' + ab[2] : '/api/ops/team/messages?with=' + peer;
    return request('GET', url + (after ? '&after=' + after : '')).then(function (r) {
      if (team.seq !== seq) return;
      var fresh = r.messages.filter(function (m) { return m.id > lastTeamId(); });
      var seen = (r.theirRead || 0) !== team.theirRead;
      team.messages = team.messages.concat(fresh);
      team.theirRead = r.theirRead || 0;
      if (fresh.length || seen || !after) renderTeamMsgs(stick);
      var me = team.list ? team.list.me : 0;
      if (!ab && (mustRead || fresh.some(function (m) { return m.from.id !== me; })) && lastTeamId() && !document.hidden) {
        request('POST', '/api/ops/team/read', { with: peer, upTo: lastTeamId() }).catch(function () {});
      }
    }, function (err) { if (stick && team.seq === seq) fail(err); }).then(function () {
      if (team.busy !== seq) return;
      team.busy = 0;
      if (team.again) { team.again = false; loadTeamMsgs(true); }
    });
  }
  function teamRow(peer, cls) {
    var b = el('button', 'team-row' + (cls ? ' ' + cls : '') + (peer !== null && team.peer === peer ? ' on' : ''));
    b.type = 'button';
    if (peer !== null) b.dataset.peer = String(peer);
    return b;
  }
  function unreadMark(n) { return el('b', 'count', n > 99 ? '99+' : String(n)); }
  function seenText(o) {
    if (o.site) return '運営サイトにいます';
    if (o.game) return 'ゲーム中';
    return o.seenAt ? '最終オンライン ' + date(o.seenAt, true) + '（' + ago(o.seenAt) + '）' : 'まだオンラインになっていません';
  }
  function renderTeamList() {
    var r = team.list, box = $('#team-list');
    if (!r) return;
    var site = r.operators.filter(function (o) { return o.site; }).length;
    var game = r.operators.filter(function (o) { return !o.site && o.game; }).length;
    $('#team-note').textContent = 'オンライン ' + (site + game) + '人 / ' + r.operators.length + '人（運営サイト ' + site + '人・ゲーム ' + game + '人）';
    box.textContent = '';
    var all = teamRow(0, 'all');
    all.appendChild(el('span', 'face team-all', '全'));
    var t = el('span', 'team-who');
    t.appendChild(el('b', '', '全体チャット'));
    t.appendChild(el('small', '', r.all.last ? r.all.last.from.name + '：' + r.all.last.text : '運営者全員で話せます'));
    all.appendChild(t);
    if (r.all.unread) all.appendChild(unreadMark(r.all.unread));
    box.appendChild(all);
    // me first, then on the site, in the game, and the rest by when they were last on
    r.operators.slice().sort(function (a, b) { return (b.me - a.me) || (b.site - a.site) || (b.game - a.game) || (b.seenAt - a.seenAt); }).forEach(function (o) {
      var row = teamRow(o.me ? null : o.id, o.me ? 'me' : '');
      var f = el('span', 'team-face');
      f.appendChild(face(o));
      f.appendChild(el('i', 'team-dot ' + (o.site ? 'site' : o.game ? 'game' : 'off')));
      row.appendChild(f);
      var w = el('span', 'team-who');
      var n = el('b', '', o.name);
      if (o.me) n.appendChild(el('span', 'team-me', '自分'));
      if (o.developer) n.appendChild(el('span', 'tag maker', '開発者'));
      n.appendChild(el('span', 'tag op', '運営'));
      w.appendChild(n);
      w.appendChild(el('small', '', seenText(o)));
      row.appendChild(w);
      if (o.unread) row.appendChild(unreadMark(o.unread));
      box.appendChild(row);
    });
    // the developer: the talks between the others
    if (state.developer && team.pairs.length) {
      box.appendChild(el('p', 'team-sub', '運営者どうしの個人チャット（開発者だけ閲覧）'));
      team.pairs.forEach(function (p) {
        var key = 'pair:' + p.a.id + ':' + p.b.id;
        var row = el('button', 'team-row pair' + (team.peer === key ? ' on' : ''));
        row.type = 'button';
        row.dataset.pair = key;
        var w = el('span', 'team-who');
        w.appendChild(el('b', '', p.a.name + ' ⇄ ' + p.b.name));
        w.appendChild(el('small', '', fmt(p.count) + '件・' + p.last.from.name + '：' + p.last.text));
        row.appendChild(w);
        box.appendChild(row);
      });
    }
  }
  function renderTeamHead() {
    var h = $('#team-head'), r = team.list;
    h.textContent = '';
    if (!r || team.peer === null) { h.appendChild(el('span', 'muted', '左の一覧から相手を選んでください')); return; }
    var t = el('div');
    if (isPair(team.peer)) {
      var ab = team.peer.split(':'), pr = team.pairs.filter(function (p) { return String(p.a.id) === ab[1] && String(p.b.id) === ab[2]; })[0];
      t.appendChild(el('b', '', pr ? pr.a.name + ' さんと ' + pr.b.name + ' さんの個人チャット' : '個人チャット'));
      t.appendChild(el('small', '', '開発者だけが閲覧できます（書き込みはできません）'));
    } else if (team.peer === 0) {
      h.appendChild(el('span', 'face team-all', '全'));
      t.appendChild(el('b', '', '全体チャット'));
      t.appendChild(el('small', '', '運営者全員（' + r.operators.length + '人）が見られます'));
    } else {
      var o = peerRow(team.peer);
      $('#team-form').hidden = !o;
      if (!o) { h.appendChild(el('span', 'muted', 'この人は運営者ではなくなりました')); return; }
      h.appendChild(face(o));
      t.appendChild(el('b', '', o.name + ' さんと個人チャット'));
      t.appendChild(el('small', '', seenText(o)));
    }
    h.appendChild(t);
  }
  function renderTeamMsgs(stick) {
    var list = $('#team-msgs'), sc = $('#team-scroll'), me = team.list ? team.list.me : 0;
    var atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60;
    list.textContent = '';
    if (!team.messages.length) list.appendChild(el('p', 'chat-empty', 'まだメッセージはありません。'));
    var lastDay = '';
    team.messages.forEach(function (m) {
      var day = date(m.at);
      if (day !== lastDay) { list.appendChild(el('div', 'day', day)); lastDay = day; }
      var mine = m.from.id === me && !isPair(team.peer);
      var node = el('div', 'msg ' + (mine ? 'bot' : 'player'));
      if (!mine && (team.peer === 0 || isPair(team.peer))) node.appendChild(el('span', 'msg-from', m.from.name));
      node.appendChild(el('div', 'bubble', m.text));
      var meta = el('div', 'msg-meta');
      if (mine && team.peer !== 0 && team.theirRead >= m.id) meta.appendChild(el('b', '', '既読'));
      meta.appendChild(document.createTextNode(stamp(m.at)));
      node.appendChild(meta);
      list.appendChild(node);
    });
    if (stick || atBottom) sc.scrollTop = sc.scrollHeight;
  }
  function sendTeam(e) {
    e.preventDefault();
    var peer = team.peer, text = $('#team-text').value.trim();
    if (peer === null || team.sending || !text) return;
    team.sending = true;
    request('POST', '/api/ops/team/messages', { to: peer, text: text }).then(function () {
      $('#team-text').value = '';
      if (team.peer === peer) loadTeamMsgs(true);
    }, fail).then(function () { team.sending = false; });
  }

  /* ------------------------------------------------------------ サーバー --- */
  var GB = 1073741824, srvBusy = false;
  var TABLE_NAMES = {
    users: 'プレイヤー', friends: 'フレンド', cars: '車', items: 'アイテム', trees: '金の生る木', chat_groups: 'グループチャット', reports: '通報',
    feedback: '報告・意見案', push_subs: 'スマホ通知の登録', pay_orders: '課金の注文', vault_files: '保管庫のファイル', vault_folders: '保管庫のフォルダ',
    ops_messages: '運営チャット', messages: 'メッセージ', transfers: '送金', spins: 'スピン', ops_log: '運営ログ', detections: '検知'
  };
  function bytes(n) {
    n = Number(n || 0);
    if (n >= 1099511627776) return (n / 1099511627776).toFixed(2) + 'TB';
    if (n >= GB) return (n / GB).toFixed(2) + 'GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n >= 1024) return (n / 1024).toFixed(1) + 'KB';
    return Math.round(n) + 'B';
  }
  // 10000000 -> 1,000万
  function count(n) {
    n = Number(n || 0);
    if (n >= 1e8) return (Math.round(n / 1e6) / 100).toLocaleString('ja-JP') + '億';
    if (n >= 1e4) return (Math.round(n / 100) / 100).toLocaleString('ja-JP') + '万';
    return fmt(Math.round(n));
  }
  function usd(n) { return '$' + Number(n || 0).toFixed(2); }
  function loadServer(quiet) {
    if (srvBusy) return;
    srvBusy = true;
    request('GET', '/api/ops/server').then(function (r) { if (state.view === 'server') renderServer(r); }, function (err) { if (!quiet) fail(err); })
      .then(function () { srvBusy = false; });
  }
  function srvStat(box, label, value, sub) {
    var s = el('div', 'stat');
    s.appendChild(el('span', '', label));
    s.appendChild(el('b', '', value));
    if (sub) s.appendChild(el('small', '', sub));
    box.appendChild(s);
  }
  function meter(part) {
    var m = el('span', 'meter' + (part >= 0.9 ? ' hot' : part >= 0.7 ? ' warm' : ''));
    var i = el('i');
    i.style.width = Math.min(100, Math.max(0, part * 100)).toFixed(1) + '%';
    m.appendChild(i);
    return m;
  }
  // a card: its title and rows [label, value, how full (0〜1) or nothing]
  function srvCard(card, title, rows, foot) {
    card.textContent = '';
    card.appendChild(el('h3', '', title));
    var t = el('table', 'srv-table');
    rows.forEach(function (x) {
      var tr = el('tr');
      tr.appendChild(el('th', '', x[0]));
      var td = el('td', '', x[1]);
      if (typeof x[2] === 'number' && isFinite(x[2])) td.appendChild(meter(x[2]));
      tr.appendChild(td);
      t.appendChild(tr);
    });
    card.appendChild(t);
    if (foot) card.appendChild(el('p', 'srv-foot muted', foot));
  }
  function renderServer(r) {
    $('#srv-at').textContent = (r.host === 'cloudflare' ? 'Cloudflare' : 'node') + '・' + stamp(r.now).slice(11) + ' 更新';
    var l10 = r.rate.last10, l60 = r.rate.last60, box = $('#srv-live');
    box.textContent = '';
    srvStat(box, 'プレイヤー接続中', fmt(r.live.online) + '人', typeof r.live.sockets === 'number' ? '接続 ' + fmt(r.live.sockets) + '本' : '');
    srvStat(box, '運営者オンライン', fmt(r.live.operatorsOnline) + '人', '運営サイトにいる人');
    srvStat(box, 'リクエスト', (l10.requests / l10.seconds).toFixed(1) + '回/秒', '直近1分 ' + fmt(l60.requests) + '回');
    srvStat(box, '送信量（帯域）', bytes(l10.bytes / l10.seconds) + '/秒', '直近1分 ' + bytes(l60.bytes));
    srvStat(box, 'ライブ通信', fmt(l60.wsOut) + '件/分', '受信 ' + fmt(l60.wsIn) + '件/分');
    srvStat(box, '今日（UTC）', count(r.today.requests) + '回', bytes(r.today.bytes) + ' 送信');
    srvChart(r.rate.history);
    srvPlan(r);
    srvBill(r);
    srvDb(r);
    srvVault(r);
    srvCloudflare(r);
    srvMachine(r);
  }
  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  // the last 5 minutes, a second at a time: requests (blue) and bytes sent (green), each to its own top
  function srvChart(h) {
    var box = $('#srv-chart'), W = 600, H = 120;
    var maxR = h.reduce(function (m, x) { return Math.max(m, x[1]); }, 1), maxB = h.reduce(function (m, x) { return Math.max(m, x[2]); }, 1);
    function line(i, max) {
      return h.map(function (x, k) { return (k ? 'L' : 'M') + (k / (h.length - 1) * W).toFixed(1) + ' ' + (H - 2 - x[i] / max * (H - 12)).toFixed(1); }).join('');
    }
    box.textContent = '';
    [30, 60, 90].forEach(function (y) { box.appendChild(svg('line', { x1: 0, x2: W, y1: y, y2: y, 'class': 'grid' })); });
    var req = line(1, maxR);
    box.appendChild(svg('path', { d: req + 'L' + W + ' ' + H + 'L0 ' + H + 'Z', 'class': 'area-req' }));
    box.appendChild(svg('path', { d: req, 'class': 'line-req' }));
    box.appendChild(svg('path', { d: line(2, maxB), 'class': 'line-bytes' }));
    $('#srv-chart-note').textContent = '最大 ' + fmt(maxR) + '回/秒・' + bytes(maxB) + '/秒';
  }
  function srvPlan(r) {
    var P = r.plan, W = P.workers, D = P.durableObjects, R = P.r2;
    if (P.id === 'paid') {
      srvCard($('#srv-plan'), '契約中：Workers Paid（月 $' + P.base + ' ≈ ' + fmt(P.base * P.rate) + '円）', [
        ['リクエスト', '月 ' + count(W.requests) + '回まで込み（超えると100万回ごとに $' + W.requestPrice.toFixed(2) + '）'],
        ['CPU 時間', '1回最大 ' + W.cpuMs / 1000 + '秒（無料は10ミリ秒）・月 ' + count(W.cpuMsMonth) + 'ミリ秒まで込み'],
        ['データベースへのリクエスト', '月 ' + count(D.requests) + '回まで込み（超えると100万回ごとに $' + D.requestPrice.toFixed(2) + '）'],
        ['データベースの保存量', D.storageGb + 'GB まで込み（超えると1GBごとに月 $' + D.storagePrice.toFixed(2) + '）・1つ最大 ' + D.perObjectGb + 'GB'],
        ['データベースの読み取り / 書き込み', '月 ' + count(D.rowsRead) + '行 / ' + count(D.rowsWritten) + '行まで込み'],
        ['自動デプロイ（ビルド）', '月 ' + fmt(W.builds) + '分まで'],
        ['1日の上限', 'なし（無料プランの「1日10万回」などがなくなります）'],
        ['R2（保管庫）', R.storageGb + 'GB まで無料・超えると1GBごとに月 $' + R.storagePrice + '・取り出しの転送量は無料']
      ], 'Cloudflare の公開価格（ドル）です。');
    } else {
      srvCard($('#srv-plan'), '契約中：Workers Free（無料）', [
        ['リクエスト', '1日 ' + count(W.requests) + '回まで'],
        ['CPU 時間', '1回 ' + W.cpuMs + 'ミリ秒まで'],
        ['データベース', '1日 ' + count(D.requests) + 'リクエスト・読み取り ' + count(D.rowsRead) + '行・書き込み ' + count(D.rowsWritten) + '行まで・保存 ' + D.storageGb + 'GB まで'],
        ['R2（保管庫）', R.storageGb + 'GB まで無料（支払い方法の登録が必要）']
      ], 'Workers Paid にしたら、設定の CF_PLAN を paid にしてください。');
    }
  }
  function srvBill(r) {
    var e = r.estimate;
    srvCard($('#srv-bill'), '今月の料金（目安）：' + usd(e.total) + ' ≈ ' + fmt(e.yen) + '円', e.lines.map(function (l) {
      if (l.included === undefined) return [l.label, usd(l.cost)];
      var used = l.unit === 'GB' ? l.used.toFixed(2) + 'GB / ' + l.included + 'GB' : count(l.used) + l.unit + ' / ' + count(l.included) + l.unit;
      return [l.label, used + '（' + usd(l.cost) + '）', l.included ? l.used / l.included : null];
    }), '数え始め ' + stamp(r.countingSince) + '・月は UTC で区切り。込みの分を超えた分だけかかります。');
  }
  function srvDb(r) {
    var d = r.database, D = r.plan.durableObjects;
    var limit = (r.plan.id === 'paid' ? D.perObjectGb : D.storageGb) * GB;
    var rows = [['大きさ', d.bytes === null ? '-' : bytes(d.bytes) + ' / ' + bytes(limit), d.bytes === null ? null : d.bytes / limit]];
    (d.rows || []).forEach(function (t) { rows.push([TABLE_NAMES[t.name] || t.name, fmt(t.rows) + (t.numbered ? '（通し番号）' : '件')]); });
    srvCard($('#srv-db'), 'データベース', rows, '件数は30分ごとに数え直します（' + stamp(d.at) + '）。');
  }
  function srvVault(r) {
    var v = r.vault;
    $('#srv-vault').hidden = !v;
    if (!v) return;
    var rows = [
      ['保存先', v.store === 'bucket' ? 'R2' : 'データベース'],
      ['使用量', bytes(v.used) + ' / ' + bytes(v.maxBytes), v.used / v.maxBytes],
      ['1ファイルの上限', bytes(v.fileBytes) + '（' + bytes(v.piece) + 'ずつ送信）'],
      ['ファイル', fmt(v.files) + '件（実装済み ' + fmt(v.implemented) + '件）・フォルダ ' + fmt(v.folders) + '個']
    ];
    if (v.inDb) rows.push(['データベースに残っている部分', fmt(v.inDb) + '（保管庫を開くと R2 へ移ります）']);
    srvCard($('#srv-vault'), '保管庫', rows, v.store === 'bucket' ? '' : 'R2 をつなぐと 50GB になります（README「保管庫を R2 につなぐ」）。');
  }
  function srvCloudflare(r) {
    var x = r.cloudflare, card = $('#srv-cf'), title = 'Cloudflare の集計（今月）';
    if (!x.configured) {
      srvCard(card, title, [['状態', '未設定']], 'Cloudflare の API トークン（Account Analytics の読み取り）を CF_API_TOKEN、アカウント ID を CF_ACCOUNT_ID としてシークレットに入れると、Cloudflare 自身の数字（リクエスト・エラー・CPU 時間・R2 の保存量と操作・データベースへのリクエスト）がここに出ます。');
      return;
    }
    if (x.loading) { srvCard(card, title, [['状態', '取得中…']]); return; }
    if (x.error) { srvCard(card, title, [['取得できません', x.error]]); return; }
    var part = function (p, rows) { return p.error ? [['取得できません', p.error]] : rows(p.data); };
    var ms = function (us) { return us === null || us === undefined ? '-' : (us / 1000).toFixed(2) + 'ms'; };
    srvCard(card, title, [].concat(
      part(x.workers, function (w) {
        return [['リクエスト', count(w.requests) + '回（エラー ' + fmt(w.errors) + '回）'], ['外部への通信', count(w.subrequests) + '回'], ['CPU 時間（中央値 / 99%）', ms(w.cpuP50) + ' / ' + ms(w.cpuP99)]];
      }),
      part(x.r2, function (b) { return [['R2 の保存量', bytes(b.bytes) + '（' + fmt(b.objects) + '個）'], ['R2 の操作（Class A / B）', count(b.classA) + '回 / ' + count(b.classB) + '回']]; }),
      part(x.durableObjects, function (d) { return [['データベースへのリクエスト', count(d.requests) + '回']]; })
    ), stamp(x.at) + ' に取得（1分ごと）');
  }
  function srvMachine(r) {
    var m = r.machine, card = $('#srv-machine');
    card.hidden = !m;
    if (!m) return;
    var rows = [
      ['このサーバーのメモリ', bytes(m.rss) + '（ヒープ ' + bytes(m.heap) + '）'],
      ['パソコンのメモリ', bytes(m.memTotal - m.memFree) + ' / ' + bytes(m.memTotal), (m.memTotal - m.memFree) / m.memTotal],
      ['負荷（1・5・15分）', m.load.map(function (x) { return x.toFixed(2); }).join(' / ') + '（CPU ' + m.cpus + '個）'],
      ['起動から', hours(m.uptime * 1000)],
      ['Node.js', m.node]
    ];
    if (m.disk) rows.push(['ディスク', bytes(m.disk.size - m.disk.free) + ' / ' + bytes(m.disk.size), (m.disk.size - m.disk.free) / m.disk.size]);
    srvCard(card, 'サーバーのマシン', rows);
  }

  /* ------------------------------------------------------------ the developer's own: backups and the emergency stop --- */
  // Backups are encrypted for a key made here: an ECDH P-256 pair whose private
  // half the server keeps only locked with the developer code (PBKDF2, then
  // AES-GCM). Opening one happens in this browser, with the code.
  var subtle = window.crypto && window.crypto.subtle;
  var ROUNDS = 600000, INFO = 'TWO STATE backup v1';
  var bk = { ticket: null, until: 0, data: null, timer: 0 };
  function cleanCode(c) { return String(c || '').replace(/[\s-]/g, ''); }
  function bytesOf(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function lockKeyFor(code, salt) {
    return subtle.importKey('raw', new TextEncoder().encode(cleanCode(code)), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: ROUNDS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  // the private half, locked with the code: { salt, iv, data, rounds }
  function lockPrivate(pkcs8, code) {
    var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    return lockKeyFor(code, salt).then(function (k) { return subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, pkcs8); })
      .then(function (data) { return { salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(data)), rounds: ROUNDS }; });
  }
  function unlockPrivate(locked, code) {
    return lockKeyFor(code, bytesOf(locked.salt)).then(function (k) {
      return subtle.decrypt({ name: 'AES-GCM', iv: bytesOf(locked.iv) }, k, bytesOf(locked.data));
    }).catch(function () { throw { message: 'バックアップの鍵を開けません（鍵を作ったときの開発者コードが必要です）' }; });
  }
  function breq(method, path, body) {
    return request(method, path, body, bk.ticket ? { 'X-Backup-Ticket': bk.ticket } : {}).catch(function (err) {
      if (err.code === 'backup_locked') { bk.ticket = null; renderBackup(); }
      throw err;
    });
  }
  function openBackup() {
    withCode({ title: 'バックアップを開く', text: '開発者だけが見られます。15分で閉じます。', ok: '開く' }).then(function (code) {
      if (code === null) return null;
      return request('POST', '/api/backup/open', { code: code }).then(function (r) {
        bk.ticket = r.ticket;
        bk.until = r.until;
        clearTimeout(bk.timer);
        bk.timer = setTimeout(function () { bk.ticket = null; bk.data = null; renderBackup(); }, Math.max(1000, r.until - Date.now() - 5000));
        return loadBackup();
      });
    }).catch(fail);
  }
  function loadBackup() {
    return breq('GET', '/api/backup').then(function (r) { bk.data = r; renderBackup(); }, fail);
  }
  var EVERY_NAMES = { off: '手動のみ', '5h': '5時間ごと', '12h': '12時間ごと', '24h': '1日ごと' };
  function renderBackup() {
    var c = $('#srv-backup');
    c.textContent = '';
    c.appendChild(el('h3', '', 'バックアップ（開発者だけに表示）'));
    if (!bk.ticket || !bk.data) {
      c.appendChild(el('p', 'muted', '保管庫以外の全データ（全プレイヤー・ログなど）のバックアップです。開発者以外は誰も設定・実行・ダウンロードできません。開くには開発者コードが必要です。'));
      var o = el('button', 'btn primary small', '開発者コードで開く');
      o.type = 'button';
      o.dataset.bk = 'open';
      c.appendChild(o);
      return;
    }
    var r = bk.data;
    if (!r.key) {
      c.appendChild(el('p', 'note', 'まず「鍵を作る」を押してください。鍵はこのブラウザで作られ、開発者コードでしか開けない形でサーバーに保存されます（サーバーも中身を読めません）。'));
      var k = el('button', 'btn primary small', '鍵を作る');
      k.type = 'button';
      k.dataset.bk = 'key';
      c.appendChild(k);
      return;
    }
    var form = el('div', 'bk-form');
    var every = el('select');
    every.id = 'bk-every';
    r.every.forEach(function (x) { var op = el('option', '', EVERY_NAMES[x] || x); op.value = x; every.appendChild(op); });
    every.value = r.settings.every;
    var keep = el('select');
    keep.id = 'bk-keep';
    r.keepChoices.forEach(function (x) { var op = el('option', '', x ? x + '個' : 'すべて'); op.value = String(x); keep.appendChild(op); });
    keep.value = String(r.settings.keep);
    var l1 = el('label', '', '自動バックアップ '), l2 = el('label', '', '自動のものを残す数 ');
    l1.appendChild(every);
    l2.appendChild(keep);
    form.appendChild(l1);
    form.appendChild(l2);
    [['設定を保存', 'save', ''], ['今すぐバックアップ', 'run', 'primary']].forEach(function (x) {
      var b = el('button', 'btn small ' + x[2], x[0]);
      b.type = 'button';
      b.dataset.bk = x[1];
      form.appendChild(b);
    });
    c.appendChild(form);
    c.appendChild(el('p', 'muted', '保存先 ' + (r.store === 'bucket' ? 'R2' : 'データベース') + '・' + (r.next ? '次の自動バックアップ ' + stamp(r.next) : '自動バックアップはオフ') + '・鍵 ' + date(r.key.at, true) + ' 作成・手動のものは削除するまで残ります'));
    var list = el('div', 'bk-list');
    if (!r.backups.length) list.appendChild(el('p', 'muted', 'バックアップはまだありません'));
    r.backups.forEach(function (b) {
      var row = el('div', 'bk-row');
      row.appendChild(el('b', '', stamp(b.at)));
      row.appendChild(el('span', 'kind ' + (b.kind === 'auto' ? 'idea' : 'accepted'), b.kind === 'auto' ? '自動' : '手動'));
      row.appendChild(el('span', 'muted', mb(b.sealed) + '・プレイヤー ' + fmt(b.tables.users || 0) + '人・ログ ' + fmt(b.tables.ops_log || 0) + '件'));
      [['ダウンロード', 'get', ''], ['削除', 'del', 'danger']].forEach(function (x) {
        var btn = el('button', 'btn small ' + x[2], x[0]);
        btn.type = 'button';
        btn.dataset.bk = x[1];
        btn.dataset.id = b.id;
        row.appendChild(btn);
      });
      list.appendChild(row);
    });
    c.appendChild(list);
  }
  // the key pair, made here; the private half goes to the server locked with the code
  function makeKey() {
    if (!subtle) { toast('このブラウザでは鍵を作れません（https で開いてください）'); return; }
    withCode({ title: 'バックアップの鍵を作る', text: 'これからのバックアップはこの鍵で暗号化され、開発者コードがないと誰も開けません。', ok: '作る' }).then(function (code) {
      if (code === null) return null;
      return subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']).then(function (pair) {
        return Promise.all([subtle.exportKey('jwk', pair.publicKey), subtle.exportKey('pkcs8', pair.privateKey)]);
      }).then(function (k) {
        return lockPrivate(k[1], code).then(function (locked) {
          return breq('POST', '/api/backup/key', { code: code, public: { kty: 'EC', crv: 'P-256', x: k[0].x, y: k[0].y }, locked: locked });
        });
      }).then(function () { toast('鍵を作りました'); return loadBackup(); });
    }).catch(fail);
  }
  // a new developer code: the key, unlocked with the old one, is locked with the new one
  function relockBackupKey(oldCode, newCode) {
    if (!subtle) return null;
    return request('POST', '/api/backup/open', { code: newCode }).then(function (o) {
      var h = { 'X-Backup-Ticket': o.ticket };
      return request('POST', '/api/backup/locked-key', { code: newCode }, h).then(function (k) {
        return unlockPrivate(k.locked, oldCode).then(function (pkcs8) { return lockPrivate(pkcs8, newCode); }).then(function (locked) {
          return request('POST', '/api/backup/key', { code: newCode, public: k.public, locked: locked, rewrap: true }, h);
        });
      });
    }).then(function () { toast('バックアップの鍵も新しい開発者コードにしました'); }, function (err) {
      if (err && err.code === 'no_key') return;
      toast('バックアップの鍵を新しいコードにできませんでした：' + ((err && err.message) || ''));
    });
  }
  function saveBackupSettings() {
    var every = $('#bk-every').value, keep = Number($('#bk-keep').value);
    withCode({ title: 'バックアップの設定を保存', text: (EVERY_NAMES[every] || every) + '・自動のものを' + (keep ? keep + '個' : 'すべて') + '残す', ok: '保存する' }).then(function (code) {
      if (code === null) return null;
      return breq('POST', '/api/backup/settings', { code: code, every: every, keep: keep }).then(function () { toast('保存しました'); return loadBackup(); });
    }).catch(fail);
  }
  function runBackup() {
    withCode({ title: '今すぐバックアップしますか？', text: '保管庫以外の全データを暗号化して保存します。', ok: 'バックアップする' }).then(function (code) {
      if (code === null) return null;
      return breq('POST', '/api/backup/run', { code: code }).then(function () { toast('バックアップしました'); return loadBackup(); });
    }).catch(fail);
  }
  // one backup: fetched, opened here with the code, and saved as a JSON file
  function getBackup(id) {
    if (!subtle || !window.DecompressionStream) { toast('このブラウザでは開けません（新しい Chrome / Safari で開いてください）'); return; }
    withCode({ title: 'バックアップをダウンロード', text: 'このブラウザの中で開いて（復号して）、JSON ファイルとして保存します。', ok: 'ダウンロード' }).then(function (code) {
      if (code === null) return null;
      return breq('POST', '/api/backup/get', { code: code, id: id }).then(function (r) {
        return unlockPrivate(r.locked, code).then(function (pkcs8) {
          return Promise.all([
            subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
            subtle.importKey('jwk', r.envelope.epk, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
          ]);
        }).then(function (k) {
          return subtle.deriveBits({ name: 'ECDH', public: k[1] }, k[0], 256);
        }).then(function (bits) {
          return subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
        }).then(function (hk) {
          return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(INFO) }, hk, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        }).then(function (key) {
          return subtle.decrypt({ name: 'AES-GCM', iv: bytesOf(r.envelope.iv) }, key, bytesOf(r.data));
        }).then(function (gz) {
          return new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).blob();
        }).then(function (plain) {
          var d = new Date(r.envelope.at), name = 'two-state-backup-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
          var url = URL.createObjectURL(new Blob([plain], { type: 'application/json' }));
          var a = document.createElement('a');
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
          toast('ダウンロードしました（' + name + '）');
        });
      });
    }).catch(fail);
  }
  function deleteBackup(id) {
    withCode({ title: 'このバックアップを削除しますか？', text: '元に戻せません。', ok: '削除する', danger: true }).then(function (code) {
      if (code === null) return null;
      return breq('POST', '/api/backup/delete', { code: code, id: id }).then(function () { toast('削除しました'); return loadBackup(); });
    }).catch(fail);
  }
  function onBackup(e) {
    var b = e.target.closest('[data-bk]');
    if (!b) return;
    var a = b.dataset.bk;
    if (a === 'open') openBackup();
    else if (a === 'key') makeKey();
    else if (a === 'save') saveBackupSettings();
    else if (a === 'run') runBackup();
    else if (a === 'get') getBackup(b.dataset.id);
    else if (a === 'del') deleteBackup(b.dataset.id);
  }
  // the emergency stop: what starts it, and the developer stopping it by hand
  function renderStop() {
    var c = $('#srv-stop');
    c.textContent = '';
    c.appendChild(el('h3', '', '緊急停止（開発者だけに表示）'));
    c.appendChild(el('p', 'muted', '保管庫を除く使用量（リクエスト・送信量・ライブ通信・データベースの増え方、運営サイトの分も）が、ふだんの10倍以上かつ下限以上の状態で2分続くと、緊急ログに記録してサーバーを自動で止めます。解除は開発者コードで。手動でも止められます。'));
    var t = el('table', 'srv-table');
    c.appendChild(t);
    request('GET', '/api/emergency').then(function (r) {
      var NAMES = { requests: 'リクエスト', bytes: '送信量', wsIn: 'ライブ通信（受信）', dbGrowth: 'データベースの増加', opsRequests: '運営サイトのリクエスト', opsBytes: '運営サイトの送信量' };
      Object.keys(r.floors).forEach(function (k) {
        var big = /bytes|Bytes|dbGrowth/.test(k);
        var tr = el('tr');
        tr.appendChild(el('th', '', NAMES[k] || k));
        tr.appendChild(el('td', '', 'ふだん ' + (big ? bytes(r.usual[k]) : fmt(Math.round(r.usual[k]))) + '/分・下限 ' + (big ? bytes(r.floors[k]) : fmt(r.floors[k])) + '/分'));
        t.appendChild(tr);
      });
    }, function () {});
    var b = el('button', 'btn small danger solid', '今すぐ緊急停止');
    b.type = 'button';
    b.dataset.stop = '1';
    c.appendChild(b);
  }
  function stopNow() {
    withCode({ title: 'サーバーを緊急停止しますか？', text: 'すべてのプレイヤーと運営者が使えなくなります（開発者だけが入れます）。解除は開発者コードで。', ok: '緊急停止する', danger: true }).then(function (code) {
      if (code === null) return null;
      return request('POST', '/api/emergency/stop', { code: code }).then(function () { showEmergency(); });
    }).catch(fail);
  }
  function renderDevCards() {
    $('#srv-dev').hidden = !state.developer;
    if (!state.developer) return;
    renderBackup();
    renderStop();
  }

  /* ------------------------------------------------------------ 保管庫 (the developer's own) --- */
  var vaultTimer = 0, moving = 0, v3d = null, viewing = null, pics = {};
  // three.js for the 3D previews (ops/vault3d.js), loaded the first time it is needed
  function vault3d() {
    if (!v3d) {
      v3d = new Promise(function (ok, no) {
        var s = document.createElement('script');
        s.src = 'vault3d.js';
        s.onload = function () { if (window.VAULT3D) ok(window.VAULT3D); else no(new Error('3Dを読み込めませんでした')); };
        s.onerror = function () { v3d = null; no(new Error('3Dを読み込めませんでした')); };
        document.head.appendChild(s);
      });
    }
    return v3d;
  }
  var KINDS_3D = /\.(glb|gltf|obj|fbx|stl|ply)$/i;
  function is3d(name) { return KINDS_3D.test(String(name || '')); }
  function vreq(method, path, body) {
    return request(method, path, body, state.vault ? { 'X-Vault-Ticket': state.vault.ticket } : {}).catch(function (err) {
      if (err.code === 'vault_locked') lockVault('保管庫が閉じました。もう一度開いてください');
      throw err;
    });
  }
  function mb(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(n >= 10737418240 ? 0 : 1) + 'GB';
    return n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
  }
  function lockVault(message) {
    state.vault = null;
    state.vaultFiles = [];
    state.vaultFolders = [];
    state.vaultFolder = '';
    state.vaultPicked = {};
    clearTimeout(vaultTimer);
    renderVault();
    if (message) toast(message);
  }
  function openVault() {
    withCode({ title: '保管庫を開く', text: '開発者専用の保管庫を30分間開きます。', ok: '開く' }).then(function (code) {
      if (code === null) return null;
      return request('POST', '/api/vault/open', { code: code }).then(function (r) {
        state.vault = r;
        clearTimeout(vaultTimer);
        vaultTimer = setTimeout(function () { lockVault('30分たったので保管庫を閉じました'); }, Math.max(1000, r.until - Date.now() - 5000));
        renderVault();
        return loadVault();
      });
    }).catch(fail);
  }
  function loadVault() {
    if (!state.vault) return Promise.resolve();
    return vreq('GET', '/api/vault/files').then(function (r) {
      state.vaultFiles = r.files || [];
      state.vaultFolders = r.folders || [];
      if (state.vault) { state.vault.used = r.used; state.vault.all = r.all; state.vault.store = r.store; state.vault.inDb = r.inDb; }
      // (a folder that went: back to the top; picks of files that went)
      if (state.vaultFolder && !folderOf(state.vaultFolder)) state.vaultFolder = '';
      Object.keys(state.vaultPicked).forEach(function (id) {
        if (!state.vaultFiles.some(function (f) { return f.id === id; })) delete state.vaultPicked[id];
      });
      renderVault();
      toBucket();
      resumeWaiting(false);
    }, fail);
  }
  // pieces kept in the database before R2 move into it while the vault is open
  var toBucketJob = null;
  function toBucket() {
    if (!state.vault || state.vault.store !== 'bucket' || !state.vault.inDb || toBucketJob) return;
    var total = state.vault.inDb, j = toBucketJob = job('R2 へ移動（データベースにある ' + fmt(total) + ' 部分）');
    j.set(0, total);
    (function step() {
      vreq('POST', '/api/vault/to-bucket').then(function (r) {
        j.set(total - r.left, total);
        if (r.left && r.moved && state.vault) return step();
        toBucketJob = null;
        if (state.vault) state.vault.inDb = r.left;
        if (r.left) j.fail('途中で止まりました（次に開いたときに続きから）'); else j.finish('すべて R2 に移しました');
        return null;
      }).catch(function (err) { toBucketJob = null; j.fail((err && err.message) || 'R2 に移せませんでした'); });
    })();
  }

  /* folders: the one open ('' the top), and what is in it */
  function folderOf(id) { return state.vaultFolders.filter(function (d) { return d.id === id; })[0] || null; }
  // the folders from the top down to `id`
  function trail(id) {
    var out = [];
    for (var d = folderOf(id); d && out.length < 10; d = folderOf(d.parent)) out.unshift(d);
    return out;
  }
  function pathName(id) { return ['保管庫'].concat(trail(id).map(function (d) { return d.name; })).join(' / '); }
  function byName(a, b) { return a.name.localeCompare(b.name, 'ja'); }
  function filesIn(id) { return state.vaultFiles.filter(function (f) { return !f.parent && (f.folder || '') === id; }); }
  function foldersIn(id) { return state.vaultFolders.filter(function (d) { return d.parent === id; }).sort(byName); }
  // where something can go: the top and every folder (not `skip` nor what is inside it)
  function places(skip) {
    var out = state.vaultFolders.filter(function (d) {
      return !skip || !trail(d.id).some(function (x) { return x.id === skip; });
    }).map(function (d) { return { value: d.id, label: pathName(d.id) }; });
    out.sort(function (a, b) { return a.label.localeCompare(b.label, 'ja'); });
    return [{ value: '', label: '保管庫（いちばん上）' }].concat(out);
  }
  function folderCard(d) {
    var card = el('article', 'card vault-folder');
    card.dataset.folder = d.id;
    var head = el('div', 'card-head');
    head.appendChild(el('b', 'vault-name', d.name));
    var n = filesIn(d.id).length + foldersIn(d.id).length;
    head.appendChild(el('span', 'time', n ? fmt(n) + '件' : '空'));
    card.appendChild(head);
    var a = el('div', 'acts');
    [['開く', 'open', 'primary'], ['名前を変更', 'rename'], ['移動', 'move'], ['削除', 'delete', 'danger']].forEach(function (x) {
      var b = el('button', 'btn small' + (x[2] ? ' ' + x[2] : ''), x[0]);
      b.type = 'button';
      b.dataset.fact = x[1];
      a.appendChild(b);
    });
    card.appendChild(a);
    return card;
  }
  function goFolder(id) {
    state.vaultFolder = id || '';
    state.vaultPicked = {};
    state.vaultPage = 0;
    renderVault();
  }
  function onFolder(e) {
    var crumb = e.target.closest('.vault-crumb');
    if (crumb) { goFolder(crumb.dataset.folder); return; }
    var card = e.target.closest('.vault-folder'), d = card && folderOf(card.dataset.folder);
    if (!d) return;
    var b = e.target.closest('[data-fact]'), act = b ? b.dataset.fact : 'open';
    if (act === 'open') goFolder(d.id);
    else if (act === 'rename') renameFolder(d);
    else if (act === 'move') moveFolder(d);
    else if (act === 'delete') deleteFolder(d);
  }
  function named(v) { return v.trim() ? '' : '名前を入れてください'; }
  function newFolder() {
    ask({ title: 'フォルダを作る', text: '「' + pathName(state.vaultFolder) + '」の中に作ります。', ok: '作る', input: { label: 'フォルダの名前' }, check: named }).then(function (name) {
      if (name === null) return null;
      return vreq('POST', '/api/vault/folders', { name: name, parent: state.vaultFolder }).then(function () { toast('フォルダを作りました'); return loadVault(); });
    }).catch(fail);
  }
  function renameFolder(d) {
    ask({ title: 'フォルダの名前を変更', ok: '変更する', input: { label: 'フォルダの名前', value: d.name }, check: named }).then(function (name) {
      if (name === null || name.trim() === d.name) return null;
      return vreq('POST', '/api/vault/folders/update', { id: d.id, name: name }).then(function () { toast('名前を変更しました'); return loadVault(); });
    }).catch(fail);
  }
  function moveFolder(d) {
    ask({ title: '「' + d.name + '」を移動', ok: '移動する', select: { label: '移動先', options: places(d.id), value: d.parent } }).then(function (to) {
      if (to === null || to === d.parent) return null;
      return vreq('POST', '/api/vault/folders/update', { id: d.id, parent: to }).then(function () { toast('移動しました'); return loadVault(); });
    }).catch(fail);
  }
  function deleteFolder(d) {
    ask({ title: '「' + d.name + '」を削除しますか？', text: '中のファイルとフォルダは消えずに、ひとつ上（' + pathName(d.parent) + '）へ移ります。', ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/folders/delete', { id: d.id }).then(function () {
        if (trail(state.vaultFolder).some(function (x) { return x.id === d.id; })) state.vaultFolder = d.parent;
        toast('フォルダを削除しました');
        return loadVault();
      });
    }).catch(fail);
  }
  // files (the picked ones, or one) into a folder
  function moveFiles(ids) {
    if (!ids.length) return;
    ask({ title: fmt(ids.length) + '件を移動', ok: '移動する', select: { label: '移動先', options: places(null), value: state.vaultFolder } }).then(function (to) {
      if (to === null) return null;
      return vreq('POST', '/api/vault/move', { ids: ids, folder: to }).then(function (r) {
        state.vaultPicked = {};
        toast(fmt(r.moved) + '件を「' + pathName(to) + '」へ移動しました');
        return loadVault();
      });
    }).catch(fail);
  }
  function renderPicked() {
    var n = Object.keys(state.vaultPicked).length;
    $('#vault-picked').hidden = !n;
    $('#vault-picked-n').textContent = fmt(n) + '件を選択中';
  }
  function renderVault() {
    var open = !!state.vault;
    $('#vault-closed').hidden = open;
    $('#vault-main').hidden = !open;
    $('#vault-lock').hidden = !open;
    $('#vault-usage').textContent = open ? '使用量 ' + mb(state.vault.used) + ' / ' + mb(state.vault.maxBytes) + '（1ファイル ' + mb(state.vault.fileBytes) + 'まで・保存先 ' + (state.vault.store === 'bucket' ? 'R2' : 'データベース') + '）' : '';
    var list = $('#vault-list'), folders = $('#vault-folders'), path = $('#vault-path');
    list.textContent = '';
    folders.textContent = '';
    path.textContent = '';
    $('#vault-picked').hidden = true;
    if (!open) return;
    var all = state.vault.all || { live: 0 };
    $('#vault-all-state').textContent = all.live ? '保管庫全体のリンク：' + all.live + '本 有効（' + stamp(all.until) + 'まで・取得 ' + fmt(all.uses) + '回）' : '保管庫全体のリンク：なし';
    $('#vault-all-stop').hidden = !all.live;
    // where it is: 保管庫 / 車 / 新車 (each a way back)
    [{ id: '', name: '保管庫' }].concat(trail(state.vaultFolder)).forEach(function (d, i, a) {
      if (i) path.appendChild(el('span', 'muted', '/'));
      var b = el('button', 'vault-crumb' + (i === a.length - 1 ? ' here' : ''), d.name);
      b.type = 'button';
      b.dataset.folder = d.id;
      path.appendChild(b);
    });
    var inside = foldersIn(state.vaultFolder);
    inside.forEach(function (d) { folders.appendChild(folderCard(d)); });
    // a model's light copy shows with the model; 10 to a page
    var all = filesIn(state.vaultFolder), show = state.vaultShow;
    var tops = all.filter(function (f) { return show === 'all' || (show === 'used') === !!f.implementedAt; });
    var pages = Math.max(1, Math.ceil(tops.length / VAULT_PAGE));
    if (state.vaultPage >= pages) state.vaultPage = pages - 1;
    if (!all.length && !inside.length) list.appendChild(el('p', 'empty muted', state.vaultFolder ? 'このフォルダは空です' : 'ファイルはまだありません'));
    else if (!tops.length && all.length) list.appendChild(el('p', 'empty muted', show === 'used' ? '実装済みのファイルはありません' : '未実装のファイルはありません'));
    tops.slice(state.vaultPage * VAULT_PAGE, (state.vaultPage + 1) * VAULT_PAGE).forEach(function (f) { list.appendChild(vaultCard(f)); });
    renderPager(pages, tops.length);
    renderPicked();
    renderWaiting();
  }
  var VAULT_PAGE = 10;
  function renderPager(pages, n) {
    var box = $('#vault-pager'), at = state.vaultPage;
    box.textContent = '';
    if (pages <= 1) return;
    function go(label, page, on, off) {
      var b = el('button', 'btn small' + (on ? ' primary' : ''), label);
      b.type = 'button';
      b.dataset.page = String(page);
      b.disabled = !!off;
      box.appendChild(b);
    }
    go('‹ 前へ', at - 1, false, at === 0);
    for (var i = 0; i < pages; i++) {
      // (many pages: the first, the last and the ones around this one)
      if (pages > 9 && i > 0 && i < pages - 1 && Math.abs(i - at) > 2) {
        if (!box.lastChild.classList.contains('gap')) box.appendChild(el('span', 'gap muted', '…'));
        continue;
      }
      go(String(i + 1), i, i === at);
    }
    go('次へ ›', at + 1, false, at === pages - 1);
    box.appendChild(el('span', 'muted', fmt(n) + '件中 ' + fmt(at * VAULT_PAGE + 1) + '〜' + fmt(Math.min(n, (at + 1) * VAULT_PAGE)) + '件目'));
  }
  function lightOf(f) { return state.vaultFiles.filter(function (x) { return x.parent === f.id && x.done; })[0] || null; }
  // the picture of a model, fetched once
  function picEl(f) {
    var p = el('div', 'vault-pic');
    p.dataset.vact = 'pic';
    if (pics[f.id]) { p.style.backgroundImage = 'url("' + pics[f.id] + '")'; return p; }
    vreq('GET', '/api/vault/preview?id=' + f.id).then(function (r) {
      if (!r.preview) return;
      pics[f.id] = r.preview;
      p.style.backgroundImage = 'url("' + r.preview + '")';
    }).catch(function () {});
    return p;
  }
  function modelFacts(facts, i, light) {
    fact(facts, '3Dモデル', String(i.format || '').toUpperCase() + '・三角形 ' + fmt(i.triangles) + '・頂点 ' + fmt(i.vertices) + '・メッシュ ' + fmt(i.meshes));
    fact(facts, 'マテリアル / テクスチャ', fmt(i.materials) + ' / ' + fmt(i.textures) + (i.maxTexture ? '（最大 ' + i.maxTexture + 'px）' : ''));
    if (i.size) fact(facts, '大きさ（幅×高さ×奥行き）', i.size.join(' × '));
    if (i.animations && i.animations.length) fact(facts, 'アニメーション', i.animations.map(function (a) { return (a.name || '-') + '（' + a.seconds + '秒）'; }).join('・'));
    if (i.skinned || i.morphs) fact(facts, 'ボーン / モーフ', fmt(i.skinned) + ' / ' + fmt(i.morphs));
    if (light) fact(facts, '軽量版', mb(light.size) + '（' + light.name + '）');
  }
  // what kind of item: 3Dモデル, テキスト, 画像, 動画, 音声, 圧縮, その他 (each counts one on a page)
  function fileKind(f) {
    var n = String(f.name || '').toLowerCase(), t = String(f.type || '');
    if (is3d(n)) return ['3Dモデル', 'k3d'];
    if (/^text\//.test(t) || /\.(txt|md|json|csv|log|ya?ml|xml|html?|js|css)$/.test(n)) return ['テキスト', 'ktext'];
    if (/^image\//.test(t) || /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(n)) return ['画像', 'kimg'];
    if (/^video\//.test(t) || /\.(mp4|mov|webm|mkv)$/.test(n)) return ['動画', 'kvid'];
    if (/^audio\//.test(t) || /\.(mp3|wav|ogg|m4a|flac)$/.test(n)) return ['音声', 'kaud'];
    if (/\.(zip|7z|rar|tar|gz)$/.test(n)) return ['圧縮', 'kzip'];
    return ['その他', 'koth'];
  }
  // the beginning of a text file (its first piece), fetched once
  var texts = {};
  function textEl(f) {
    var p = el('pre', 'vault-text', '読み込み中…');
    if (texts[f.id] !== undefined) { p.textContent = texts[f.id]; return p; }
    vreq('GET', '/api/vault/chunk?id=' + f.id + '&n=0').then(function (r) {
      var s = new TextDecoder().decode(bytesOf(r.data));
      texts[f.id] = Array.from(s).length > 1200 ? Array.from(s).slice(0, 1200).join('') + '\n…（続きはダウンロード）' : s;
      p.textContent = texts[f.id];
    }).catch(function () { p.textContent = '（読み込めませんでした）'; });
    return p;
  }
  // an image (small ones), fetched once
  function imageEl(f) {
    var p = el('div', 'vault-pic');
    p.dataset.vact = 'pic';
    if (pics[f.id]) { p.style.backgroundImage = 'url("' + pics[f.id] + '")'; return p; }
    fetchFile(f, null).then(function (blob) {
      pics[f.id] = URL.createObjectURL(new Blob([blob], { type: f.type || 'image/png' }));
      p.style.backgroundImage = 'url("' + pics[f.id] + '")';
    }).catch(function () {});
    return p;
  }
  // the developer's short messages on a file
  var NOTE_DAYS = [[1, '1日'], [3, '3日'], [7, '7日'], [30, '30日'], [0, '期限なし']];
  function notesEl(f) {
    var box = el('div', 'vault-notes');
    (f.notes || []).slice().reverse().forEach(function (n) {
      var over = n.until && n.until <= Date.now();
      var row = el('div', 'vnote' + (over ? ' over' : ''));
      row.appendChild(el('span', 'vnote-text', n.text));
      row.appendChild(el('small', '', date(n.at, true) + '・' + (over ? '期限切れ（AIには見えません）' : n.until ? date(n.until, true) + 'まで' : '期限なし')));
      var x = el('button', 'vnote-del', '×');
      x.type = 'button';
      x.title = 'このメッセージを削除';
      x.dataset.vact = 'notedel';
      x.dataset.note = n.id;
      row.appendChild(x);
      box.appendChild(row);
    });
    return box;
  }
  function addNote(f) {
    ask({
      title: '「' + f.name + '」にメッセージ', text: 'AI用リンクにも、期限まで表示されます。期限が過ぎても消えずに残ります（AIには見えなくなります）。', ok: '残す',
      input: { label: 'メッセージ（500文字まで）', type: 'text' },
      select: { label: '期間', options: NOTE_DAYS.map(function (d) { return { value: String(d[0]), label: d[1] }; }), value: '7' },
      check: function (v) { return v.trim() ? '' : 'メッセージを書いてください'; }
    }).then(function (v) {
      if (v === null) return null;
      return vreq('POST', '/api/vault/notes', { id: f.id, text: v.value, days: Number(v.pick) }).then(function () { toast('メッセージを残しました'); return loadVault(); });
    }).catch(fail);
  }
  // a text written here: saved as a .txt file (one item, like any other)
  function newText() {
    ask({
      title: 'テキストを作る', text: '「' + pathName(state.vaultFolder) + '」に保存します。', ok: '保存する',
      input: { label: '名前', type: 'text' }, area: { label: '本文' },
      check: function (v) { return v.trim() ? '' : '名前を入れてください'; }
    }).then(function (v) {
      if (v === null) return null;
      if (!v.text.trim()) { toast('本文を書いてください'); return null; }
      var name = v.value.trim().replace(/\.txt$/i, '') + '.txt';
      return upload(new File([v.text], name, { type: 'text/plain' }), { note: '', folder: state.vaultFolder });
    }).catch(fail);
  }
  // what an AI did with a file, newest first
  var LABEL_KINDS = { download: ['AIが取得', 'k-get'], ai: ['AIのラベル', 'k-ai'], implemented: ['実装済み', 'k-done'], restore: ['戻した', 'k-back'] };
  function labelsEl(f) {
    var box = el('div', 'vault-labels');
    (f.labels || []).slice().reverse().forEach(function (l) {
      var k = LABEL_KINDS[l.kind] || [l.kind, ''];
      var c = el('span', 'vlabel ' + k[1]);
      c.title = l.text;
      c.appendChild(el('i', '', k[0]));
      c.appendChild(el('span', '', l.text));
      c.appendChild(el('small', '', date(l.at, true)));
      box.appendChild(c);
    });
    return box;
  }
  function vaultCard(f) {
    var card = el('article', 'card vault-card' + (f.done ? '' : ' done') + (f.implementedAt ? ' used' : ''));
    card.dataset.file = f.id;
    var head = el('div', 'card-head');
    var pick = el('label', 'vault-check'), box = el('input');
    box.type = 'checkbox';
    box.dataset.vpick = f.id;
    box.checked = !!state.vaultPicked[f.id];
    box.setAttribute('aria-label', '選択');
    pick.appendChild(box);
    head.appendChild(pick);
    var kind = fileKind(f);
    head.appendChild(el('span', 'fkind ' + kind[1], kind[0]));
    head.appendChild(el('b', 'vault-name', f.name));
    head.appendChild(el('span', 'kind ' + (f.done ? 'accepted' : 'bug'), f.done ? '保存済み' : 'アップロード途中 ' + f.received + '/' + f.chunks));
    if (f.implementedAt) head.appendChild(el('span', 'kind used', '実装済み'));
    head.appendChild(el('span', 'time', '送信 ' + stamp(f.createdAt)));
    card.appendChild(head);
    var light = lightOf(f);
    var body = el('div', 'vault-body');
    if (f.preview) body.appendChild(picEl(f));
    else if (f.done && is3d(f.name)) body.appendChild(el('div', 'vault-pic none', 'プレビューなし'));
    else if (f.done && kind[1] === 'kimg' && f.size <= 8 * 1048576) body.appendChild(imageEl(f));
    var facts = el('div', 'facts');
    fact(facts, '送信日時', stamp(f.createdAt));
    fact(facts, '保存完了', f.done ? stamp(f.doneAt) : '送信中');
    if (f.implementedAt) fact(facts, '実装済みになった日時', stamp(f.implementedAt));
    if (f.info) modelFacts(facts, f.info, light);
    fact(facts, '大きさ', mb(f.size) + '（' + fmt(f.size) + 'バイト）');
    fact(facts, '種類', f.type || '-');
    fact(facts, 'SHA-256（部分ごとのハッシュの並び）', f.sha256 || '-');
    fact(facts, 'リンク', f.links.live ? f.links.live + '本 有効（' + stamp(f.links.until) + 'まで）' : 'なし');
    fact(facts, 'リンクからの取得', fmt(f.links.uses) + '回');
    if (f.note) fact(facts, 'メモ', f.note);
    body.appendChild(facts);
    card.appendChild(body);
    if (f.done && kind[1] === 'ktext') card.appendChild(textEl(f));
    card.appendChild(notesEl(f));
    card.appendChild(labelsEl(f));
    var a = el('div', 'acts');
    function btn(label, act, cls) {
      var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label);
      b.type = 'button';
      b.dataset.vact = act;
      a.appendChild(b);
    }
    if (f.done) {
      if (f.info) btn('3Dで見る', 'view', 'primary');
      else if (is3d(f.name)) btn('プレビューを作る', 'make');
      btn('ダウンロード', 'get');
      if (light) btn('軽量版をダウンロード', 'getlight');
      if (f.implementedAt) btn('実装済みから戻す', 'restore', 'ok');
      else btn('リンクを作る', 'link', 'primary');
      if (f.links.live) btn('リンクを停止', 'stop', 'warn');
    } else {
      btn('続きから送る（同じファイルを選ぶ）', 'resume', 'primary');
    }
    btn('＋ メッセージ', 'note');
    btn('移動', 'move');
    btn('削除', 'delete', 'danger');
    card.appendChild(a);
    return card;
  }
  // progress of one upload or download
  function job(name) {
    var card = el('article', 'card job');
    card.appendChild(el('b', '', name));
    var bar = el('div', 'bar'), fill = el('i');
    bar.appendChild(fill);
    card.appendChild(bar);
    var note = el('span', 'muted', '準備中…');
    card.appendChild(note);
    $('#vault-jobs').insertBefore(card, $('#vault-jobs').firstChild);
    moving++;
    var over = false;
    function end() { if (!over) { over = true; moving--; } }
    return {
      set: function (d, t) {
        var p = t ? d / t * 100 : 0;
        fill.style.width = p.toFixed(1) + '%';
        note.textContent = d + ' / ' + t + '（' + Math.round(p) + '%）';
      },
      finish: function (msg) { end(); fill.style.width = '100%'; card.classList.add('ok'); note.textContent = msg; setTimeout(function () { card.remove(); }, 20000); },
      fail: function (msg) { end(); card.classList.add('bad'); note.textContent = msg; },
      pause: function (msg) { end(); card.classList.add('paused'); note.textContent = msg; setTimeout(function () { card.remove(); }, 15000); }
    };
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join(''); }
  function sha(buf) { return crypto.subtle.digest('SHA-256', buf); }
  function base64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function later(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // four pieces at a time; a piece that fails is tried again (3 times)
  function pieces(todo, one) {
    var queue = todo.slice(), failed = null;
    function run(n, tries) {
      return one(n).catch(function (err) {
        if (tries < 3 && err.code !== 'vault_locked' && err.status !== 413 && err.status !== 404) return later(1500 * (tries + 1)).then(function () { return run(n, tries + 1); });
        throw err;
      });
    }
    function worker() {
      if (failed || !queue.length) return Promise.resolve();
      return run(queue.shift(), 0).then(worker, function (err) { failed = err; });
    }
    return Promise.all([worker(), worker(), worker(), worker()]).then(function () { if (failed) throw failed; });
  }
  // o: { id: an unfinished one to go on with, parent: the model of a light
  // copy, note, folder, rec: the stopped upload this takes up again }
  function upload(file, o) {
    o = o || {};
    var j = job(file.name + '（アップロード）'), made = null;
    var begin = o.id
      ? vreq('GET', '/api/vault/missing?id=' + o.id).then(function (r) {
        if (r.file.size !== file.size) throw { message: 'ファイルの大きさが違います。同じファイルを選んでください' };
        var todo = [];
        r.missing.forEach(function (m) { for (var n = m[0]; n <= m[1]; n++) todo.push(n); });
        return { file: r.file, todo: todo };
      })
      : vreq('POST', '/api/vault/files', { name: file.name, size: file.size, type: file.type || '', note: o.parent ? '' : o.note || '', parent: o.parent || undefined, folder: o.parent ? undefined : o.folder || '' }).then(function (r) {
        var todo = [];
        for (var n = 0; n < r.file.chunks; n++) todo.push(n);
        return { file: r.file, todo: todo };
      });
    return begin.then(function (b) {
      made = b.file;
      var CH = b.file.piece || state.vault.chunk, done = b.file.chunks - b.todo.length;
      j.set(done, b.file.chunks);
      return pieces(b.todo, function (n) {
        return file.slice(n * CH, Math.min(file.size, (n + 1) * CH)).arrayBuffer().then(function (buf) {
          return sha(buf).then(function (h) {
            return vreq('POST', '/api/vault/chunk', { id: b.file.id, n: n, sha256: hex(h), data: base64(new Uint8Array(buf)) });
          });
        }).then(function () { done++; j.set(done, b.file.chunks); });
      });
    }).then(function () {
      // every piece sent: the server puts the file together (R2 keeps no count of them)
      return vreq('POST', '/api/vault/finish', { id: made.id });
    }).then(function (r) {
      if (!r.done) throw { code: 'missing', message: '届いていない部分があります' };
      j.finish('保存しました（SHA-256 ' + String(r.sha256).slice(0, 16) + '…）');
      return loadVault().then(function () { if (!o.parent && made && is3d(file.name)) return preview(made, file); });
    }, function (err) {
      var why = stalled(err);
      if (why) {
        wait(file, { id: made ? made.id : o.id, parent: o.parent, note: o.note, folder: o.folder, rec: o.rec }, why);
        j.pause('止まりました：' + WHY[why]);
      } else j.fail((err && err.message) || 'アップロードできませんでした');
      return loadVault();
    });
  }

  /* uploads that stopped (the vault full, the connection gone, the vault
     closed) go on where they stopped, on their own, while this page is open */
  var waiting = [], resuming = false;
  var WHY = {
    full: '保管庫がいっぱいです。空きができしだい続きから送ります',
    net: '通信が切れました。戻りしだい続きから送ります',
    locked: '保管庫が閉じました。開きしだい続きから送ります'
  };
  function stalled(err) {
    if (!err) return '';
    if (err.code === 'vault_full') return 'full';
    if (err.code === 'vault_locked') return 'locked';
    if (err.code === 'missing' || err.status === 0 || err.status === 429 || err.status >= 500) return 'net';
    return '';
  }
  function wait(file, o, why) {
    var w = o.rec || { file: file, tries: 0 };
    if (waiting.indexOf(w) < 0) waiting.push(w);
    w.id = o.id || null;
    w.parent = o.parent || null;
    w.note = o.note;
    w.folder = o.folder;
    w.why = why;
    w.tries++;
    // (tried again after 5 s, then 10, 20, 40, and every minute)
    w.next = Date.now() + Math.min(60000, 5000 * Math.pow(2, Math.min(4, w.tries - 1)));
    renderWaiting();
  }
  // `now`: all of them at once (the button)
  function resumeWaiting(now) {
    if (resuming || !state.vault || !waiting.length) return;
    var free = state.vault.maxBytes - state.vault.used, t = Date.now();
    var go = waiting.filter(function (w) {
      if (now) return true;
      // a new file waits for room (and then goes at once)
      if (w.why === 'full' && !w.id) return w.file.size <= free;
      if (w.next > t) return false;
      return w.why !== 'net' || navigator.onLine !== false;
    });
    if (!go.length) return;
    waiting = waiting.filter(function (w) { return go.indexOf(w) < 0; });
    renderWaiting();
    resuming = true;
    go.reduce(function (p, w) {
      return p.then(function () {
        if (!state.vault) { wait(w.file, w, 'locked'); return null; }
        return upload(w.file, { id: w.id, parent: w.parent, note: w.note, folder: w.folder, rec: w });
      });
    }, Promise.resolve()).then(function () { resuming = false; });
  }
  function renderWaiting() {
    var box = $('#vault-waiting');
    box.textContent = '';
    box.hidden = !waiting.length;
    if (!waiting.length) return;
    var head = el('div', 'card-head');
    head.appendChild(el('b', '', '止まっているアップロード ' + waiting.length + '件'));
    var now = el('button', 'btn small primary', '今すぐ再開');
    now.type = 'button';
    now.dataset.wait = 'now';
    head.appendChild(now);
    box.appendChild(head);
    waiting.forEach(function (w, i) {
      var row = el('div', 'vault-wait');
      row.appendChild(el('b', '', w.file.name));
      row.appendChild(el('span', 'muted', mb(w.file.size) + '・' + WHY[w.why]));
      var x = el('button', 'btn small ghost', 'やめる');
      x.type = 'button';
      x.dataset.wait = String(i);
      row.appendChild(x);
      box.appendChild(row);
    });
  }
  // A model: its picture, what is in it, and its light copy (uploaded as a file of its own)
  function preview(f, file) {
    var j = job(f.name + '（3Dプレビュー）');
    j.set(0, 3);
    return vault3d().then(function (V) {
      return V.analyze(file, f.name);
    }).then(function (r) {
      j.set(1, 3);
      return vreq('POST', '/api/vault/meta', { id: f.id, preview: r.preview, info: r.info }).then(function () {
        pics[f.id] = r.preview;
        j.set(2, 3);
        if (!r.light) return null;
        var base = f.name.replace(/\.[^.]+$/, '');
        return upload(new File([r.light], base + '.light.glb', { type: 'model/gltf-binary' }), { parent: f.id });
      });
    }).then(function () { j.finish('プレビューを作りました'); return loadVault(); }, function (err) {
      j.fail('プレビューを作れませんでした：' + ((err && err.message) || ''));
    });
  }
  // a whole file from the vault, its hashes checked: a Blob
  function fetchFile(f, j) {
    var parts = [], digests = [], done = 0, todo = [];
    for (var n = 0; n < f.chunks; n++) todo.push(n);
    return pieces(todo, function (n) {
      return vreq('GET', '/api/vault/chunk?id=' + f.id + '&n=' + n).then(function (r) {
        var bin = atob(r.data), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return sha(bytes).then(function (h) {
          if (hex(h) !== r.sha256) throw { message: '部分 ' + n + ' が壊れています（ハッシュが一致しません）' };
          parts[n] = bytes;
          digests[n] = new Uint8Array(h);
          done++;
          if (j) j.set(done, f.chunks);
        });
      });
    }).then(function () {
      var all = new Uint8Array(32 * f.chunks);
      digests.forEach(function (d, i) { all.set(d, i * 32); });
      return sha(all).then(function (h) {
        if (f.sha256 && hex(h) !== f.sha256) throw { message: 'ファイル全体のハッシュが一致しません' };
        return new Blob(parts, { type: 'application/octet-stream' });
      });
    });
  }
  // the light copy (or the model itself when it is small) turning in 3D
  function view3d(f) {
    var light = lightOf(f), src = light || f;
    var box = $('#viewer-box');
    closeViewer();
    $('#viewer-name').textContent = f.name;
    $('#viewer-note').textContent = '読み込み中…';
    $('#viewer').hidden = false;
    Promise.all([vault3d(), fetchFile(src, { set: function (d, t) { $('#viewer-note').textContent = '読み込み中… ' + Math.round(d / t * 100) + '%'; } })]).then(function (r) {
      return r[1].arrayBuffer().then(function (buf) { return r[0].view(box, buf, src.name); });
    }).then(function (v) {
      if ($('#viewer').hidden) { v.stop(); return; }
      viewing = v;
      $('#viewer-note').textContent = (light ? '軽量版 ' + mb(light.size) : mb(f.size)) + '・ドラッグで回転・ホイール / 2本指でズーム';
    }).catch(function (err) { $('#viewer-note').textContent = (err && err.message) || '表示できませんでした'; });
  }
  function closeViewer() {
    if (viewing) { viewing.stop(); viewing = null; }
    var box = $('#viewer-box');
    box.textContent = '';
    box.classList.remove('big');
    box.style.backgroundImage = '';
    $('#viewer').hidden = true;
  }
  // the picture, big
  function showPic(f) {
    if (!pics[f.id]) return;
    closeViewer();
    $('#viewer-name').textContent = f.name;
    $('#viewer-note').textContent = '前（+Z）・右（+X）・上（+Y）・斜め';
    var box = $('#viewer-box');
    box.classList.add('big');
    box.style.backgroundImage = 'url("' + pics[f.id] + '")';
    $('#viewer').hidden = false;
  }
  function makePreview(f) {
    var j = job(f.name + '（ダウンロード）');
    fetchFile(f, j).then(function (blob) {
      j.finish('ダウンロードしました');
      return preview(f, new File([blob], f.name));
    }).catch(function (err) { j.fail((err && err.message) || 'ダウンロードできませんでした'); });
  }
  function download(f) {
    var j = job(f.name + '（ダウンロード）');
    return fetchFile(f, j).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
      j.finish('ダウンロードしました（ハッシュ一致を確認済み）');
    }).catch(function (err) { j.fail((err && err.message) || 'ダウンロードできませんでした'); });
  }
  // `f`: a file, or null for the whole vault
  function makeLink(f) {
    var hours = state.vault.hours || [1, 6, 24, 72];
    ask({
      title: f ? 'リンクを作る' : '保管庫全体のリンクを作る',
      text: (f ? '「' + f.name + '」（画像・情報・軽量版つき）' : '保管庫のすべてのファイル（画像・情報・軽量版つき・実装済みは除く）') + 'をログインなしで取り出せるリンクです（表示は一度だけ）。AI用にすると、AI が取ったファイルと AI の作業にラベルが付き、AI がゲームに入れたファイルは実装済みになってリンクから外れます。',
      ok: '作る',
      input: { label: '有効時間（' + hours.join('・') + ' 時間）', type: 'text', value: '24' },
      select: { label: 'リンクの種類', options: [{ value: 'plain', label: '読み取り専用' }, { value: 'ai', label: 'AI用（ラベルと実装済みの報告つき）' }], value: 'plain' },
      check: function (v) { return hours.indexOf(Number(v)) >= 0 ? '' : hours.join('・') + ' のどれかを入れてください'; }
    }).then(function (v) {
      if (v === null) return null;
      var ai = v.pick === 'ai';
      return vreq('POST', '/api/vault/link', { id: f ? f.id : '*', hours: Number(v.value), ai: ai }).then(function (r) {
        var url = location.origin + r.path;
        copy(url);
        loadVault();
        return ask({
          title: (ai ? 'AI用' : '読み取り専用') + 'リンクを作りました（' + v.value + '時間有効・コピー済み）',
          text: url + '\n\n' + (f ? '期限まで、このファイルだけを取り出せます。' : '期限まで、保管庫のすべてのファイルを取り出せます。') + '用が済んだら停止してください。'
            + (ai ? '\n\nAI には「このURLを開いて how の説明どおりに使い、作業したらラベルを付け、ゲームに入れたら implemented: true で報告して」と伝えてください。' : ''),
          ok: 'OK'
        });
      });
    }).catch(fail);
  }
  function onVault(e) {
    var b = e.target.closest('[data-vact]'), card = b && b.closest('[data-file]');
    if (!card) return;
    var f = state.vaultFiles.filter(function (x) { return x.id === card.dataset.file; })[0];
    if (!f) return;
    var act = b.dataset.vact;
    if (act === 'get') download(f);
    else if (act === 'getlight') { if (lightOf(f)) download(lightOf(f)); }
    else if (act === 'view') view3d(f);
    else if (act === 'pic') showPic(f);
    else if (act === 'make') makePreview(f);
    else if (act === 'link') makeLink(f);
    else if (act === 'move') moveFiles([f.id]);
    else if (act === 'note') addNote(f);
    else if (act === 'notedel') {
      ask({ title: 'このメッセージを削除しますか？', text: b.parentNode.querySelector('.vnote-text').textContent, ok: '削除する', danger: true }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/notes/delete', { note: Number(b.dataset.note) }).then(function () { toast('削除しました'); return loadVault(); });
      }).catch(fail);
    }
    else if (act === 'resume') { state.resumeId = f.id; $('#vault-file').click(); }
    else if (act === 'restore') {
      ask({ title: '実装済みから戻しますか？', text: '「' + f.name + '」がまたリンクから取り出せるようになります。', ok: '戻す' }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/restore', { id: f.id }).then(function () { toast('戻しました'); return loadVault(); });
      }).catch(fail);
    }
    else if (act === 'stop') {
      ask({ title: 'リンクを停止しますか？', text: '「' + f.name + '」の読み取り専用リンクがすべて、すぐに使えなくなります。', ok: '停止する', danger: true }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/link/stop', { id: f.id }).then(function (r) { toast('リンクを停止しました（' + r.stopped + '本）'); return loadVault(); });
      }).catch(fail);
    } else if (act === 'delete') {
      ask({ title: '「' + f.name + '」を削除しますか？', text: '保管庫から完全に消えます（元に戻せません）。リンクも使えなくなります。', ok: '削除する', danger: true }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/delete', { id: f.id }).then(function () { toast('削除しました'); return loadVault(); });
      }).catch(fail);
    }
  }
  // files picked: one after another, with the note and into the folder open
  // now (an unfinished one with the same name and size goes on where it stopped)
  function onFiles() {
    var input = $('#vault-file'), files = Array.prototype.slice.call(input.files || []), resume = state.resumeId;
    input.value = '';
    state.resumeId = null;
    if (!state.vault) return;
    var note = $('#vault-note').value.trim(), folder = state.vaultFolder;
    $('#vault-note').value = '';
    files.reduce(function (p, file) {
      return p.then(function () {
        if (!state.vault) return null;
        if (file.size > state.vault.fileBytes) { toast('「' + file.name + '」は大きすぎます（1ファイル ' + mb(state.vault.fileBytes) + 'まで）'); return null; }
        // (one that stopped, picked again: this takes it over)
        waiting = waiting.filter(function (w) { return !(w.file.name === file.name && w.file.size === file.size); });
        renderWaiting();
        var half = state.vaultFiles.filter(function (x) { return !x.done && (resume ? x.id === resume : x.name === file.name && x.size === file.size); })[0];
        return upload(file, { id: half ? half.id : null, note: note, folder: folder });
      });
    }, Promise.resolve());
  }

  /* ------------------------------------------------------------ the operators' log --- */
  function loadLog(reset) {
    var list = $('#log-list');
    if (reset) { state.log = []; state.logDone = false; list.textContent = ''; list.appendChild(el('p', 'empty muted', '読み込み中…')); }
    var before = !reset && state.log.length ? state.log[state.log.length - 1].id : 0;
    request('GET', '/api/ops/log?q=' + encodeURIComponent(state.logQ) + '&kind=' + state.logKind + (before ? '&before=' + before : '')).then(function (r) {
      if (reset) list.textContent = '';
      if (r.counts) {
        Array.prototype.forEach.call(document.querySelectorAll('#log-kinds [data-kind]'), function (c) {
          var b = c.querySelector('b');
          if (b) b.textContent = r.counts[c.dataset.kind] ? ' ' + fmt(r.counts[c.dataset.kind]) : '';
        });
      }
      state.log = state.log.concat(r.entries);
      state.logDone = r.entries.length < 200;
      if (!state.log.length) list.appendChild(el('p', 'empty muted', '記録はありません'));
      r.entries.forEach(function (x) { list.appendChild(logEntry(x)); });
      $('#log-more').hidden = state.logDone;
    }, fail);
  }
  function verifyLog() {
    var v = $('#log-verify');
    v.className = 'verify';
    v.textContent = '';
    request('GET', '/api/ops/log/verify').then(function (r) {
      v.className = 'verify ' + (r.ok ? 'ok' : 'bad');
      v.textContent = r.ok ? '✓ 改ざんチェック: すべての記録（' + fmt(r.count) + '件）が正しくつながっていて、外に控えた最新のハッシュとも一致しています'
        : '⚠ 改ざんチェック: ' + r.brokenAt + '番の記録で異常があります（' + r.reason + '）';
    }, function () {});
  }
  function logEntry(x) {
    var row = el('div', 'entry');
    var line = el('button', 'entry-line');
    line.type = 'button';
    line.appendChild(el('span', 'time', String(x.jst || '').replace(/\.\d+ JST$/, '')));
    line.appendChild(el('span', 'lk k-' + x.kind, KINDS[x.kind] || ''));
    line.appendChild(el('span', 'who', x.actor.name));
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
    var time = (x.detail && x.detail.time) || {};
    var rows = [
      ['記録番号', '#' + x.id],
      ['内容', x.summary],
      ['操作', actionName(x.action) + '（' + x.action + '）'],
      ['日時（日本時間）', x.jst],
      ['日時（UTC）', time.iso || new Date(x.at).toISOString()],
      ['実行した人', x.actor.name + (x.actor.id ? '（ID ' + x.actor.id + '）' : '')],
      ['対象', x.target ? x.target.name + '（ID ' + x.target.id + '）' : '-'],
      ['IPアドレス', req.ip || '-'],
      ['ブラウザ・端末', req.userAgent || '-'],
      ['端末ID', req.device || '-'],
      ['アクセス元', (req.origin || '-') + (req.referer ? '（' + req.referer + '）' : '')],
      ['ひとつ前の記録のハッシュ', x.prevHash],
      ['この記録のハッシュ', x.hash]
    ];
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('th', '', r[0]));
      tr.appendChild(el('td', r[0].indexOf('ハッシュ') >= 0 ? 'mono' : '', r[1]));
      t.appendChild(tr);
    });
    box.appendChild(t);
    var rest = {};
    Object.keys(x.detail || {}).forEach(function (k) { if (k !== 'time' && k !== 'request') rest[k] = x.detail[k]; });
    box.appendChild(el('pre', '', JSON.stringify(rest, null, 2)));
    return box;
  }

  /* ------------------------------------------------------------ phones: landscape, full screen --- */
  var turned = false, askedAt = 0;
  function phone() { return window.matchMedia && window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600; }
  // held upright (the keyboard coming up must not count)
  function upright() {
    if (screen.orientation && screen.orientation.type) return screen.orientation.type.indexOf('portrait') === 0;
    if (typeof window.orientation === 'number') return window.orientation === 0 || window.orientation === 180;
    return window.innerHeight > window.innerWidth;
  }
  function fullscreen() {
    if (!phone() || document.fullscreenElement || Date.now() - askedAt < 5000) return;
    askedAt = Date.now();
    var d = document.documentElement;
    var go = !document.fullscreenElement && d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : null;
    Promise.resolve(go).then(function () {
      if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape');
      return null;
    }).catch(function () { /* not here (iPhone): the site turns itself */ }).then(turn);
  }
  // held upright: the whole site turned sideways (and scrolled by hand)
  function turn() {
    var on = phone() && upright();
    if (on === turned) return;
    turned = on;
    $('#frame').classList.toggle('turned', on);
  }
  function scrollerOf(node, vertical) {
    for (var n = node; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n), o = vertical ? cs.overflowY : cs.overflowX;
      if ((o === 'auto' || o === 'scroll') && (vertical ? n.scrollHeight > n.clientHeight : n.scrollWidth > n.clientWidth)) return n;
    }
    return null;
  }
  function dragScroll() {
    var f = $('#frame'), d = null, fling = 0;
    f.addEventListener('touchstart', function (e) {
      cancelAnimationFrame(fling);
      if (!turned || e.touches.length !== 1) { d = null; return; }
      var t = e.touches[0];
      d = { x: t.clientX, y: t.clientY, v: 0, h: 0, at: Date.now(), sv: null, sh: null, target: e.target };
    }, { passive: true });
    f.addEventListener('touchmove', function (e) {
      if (!turned || !d) return;
      var t = e.touches[0], dx = t.clientX - d.x, dy = t.clientY - d.y, now = Date.now();
      d.x = t.clientX;
      d.y = t.clientY;
      // turned 90°: across the screen is up and down on the page
      if (!d.sv) d.sv = scrollerOf(d.target, true) || $('#app');
      if (!d.sh) d.sh = scrollerOf(d.target, false);
      d.sv.scrollTop += dx;
      if (d.sh) d.sh.scrollLeft -= dy;
      var dt = Math.max(1, now - d.at);
      d.v = dx / dt;
      d.at = now;
      e.preventDefault();
    }, { passive: false });
    f.addEventListener('touchend', function () {
      if (!turned || !d || !d.sv) return;
      var sc = d.sv, v = d.v * 16;
      d = null;
      var step = function () {
        if (Math.abs(v) < 0.5) return;
        sc.scrollTop += v;
        v *= 0.94;
        fling = requestAnimationFrame(step);
      };
      fling = requestAnimationFrame(step);
    });
  }

  /* ------------------------------------------------------------ start --- */
  function init() {
    turn();
    dragScroll();
    window.addEventListener('resize', turn);
    window.addEventListener('orientationchange', function () { setTimeout(turn, 200); });
    // a tap: full screen and landscape where the phone allows it (again after leaving it)
    document.addEventListener('pointerup', fullscreen, true);

    $('#login-form').addEventListener('submit', onLogin);
    $('#logout').addEventListener('click', logout);
    $('#tabs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-view]');
      if (t) setView(t.dataset.view);
    });
    $('#search').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.q = $('#search').value.trim(); load(); }, 250);
    });
    $('#filters').addEventListener('click', function (e) {
      var c = e.target.closest('[data-filter]');
      if (!c) return;
      state.filter = c.dataset.filter;
      Array.prototype.forEach.call(document.querySelectorAll('#filters .chip'), function (x) { x.classList.toggle('on', x === c); });
      render();
    });
    $('#sort').addEventListener('change', function () { state.sort = $('#sort').value; render(); });
    $('#rows').addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]');
      if (c) { e.stopPropagation(); copy(c.dataset.copy); return; }
      var f = e.target.closest('[data-chat]');
      if (f) { e.stopPropagation(); openChat(Number(f.dataset.chat)); return; }
      var tr = e.target.closest('tr[data-id]');
      if (tr) openDetail(Number(tr.dataset.id));
    });
    $('#detail').addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]');
      if (c) { copy(c.dataset.copy); return; }
      var f = e.target.closest('[data-chat]');
      if (f) { openChat(Number(f.dataset.chat)); return; }
      var o = e.target.closest('[data-open]');
      if (o) { openDetail(Number(o.dataset.open)); return; }
      var r = e.target.closest('[data-review], [data-review-all]');
      if (r) { onDetection(e); return; }
      var b = e.target.closest('[data-act]');
      if (b) onAction(b);
    });
    $('#drawer-close').addEventListener('click', closeDetail);
    $('#drawer-back').addEventListener('click', closeDetail);

    $('#report-filter').addEventListener('click', function (e) {
      var c = e.target.closest('[data-status]');
      if (!c) return;
      state.reportStatus = c.dataset.status;
      Array.prototype.forEach.call(document.querySelectorAll('#report-filter .chip'), function (x) { x.classList.toggle('on', x === c); });
      loadReports();
    });
    $('#report-list').addEventListener('click', onReport);
    $('#det-filter').addEventListener('click', function (e) {
      var c = e.target.closest('[data-all]');
      if (!c) return;
      state.detAll = c.dataset.all === '1';
      Array.prototype.forEach.call(document.querySelectorAll('#det-filter .chip'), function (x) { x.classList.toggle('on', x === c); });
      loadDetections();
    });
    $('#det-list').addEventListener('click', onDetection);
    $('#fb-filter').addEventListener('click', function (e) {
      var c = e.target.closest('[data-fb]');
      if (!c) return;
      state.fb = c.dataset.fb;
      Array.prototype.forEach.call(document.querySelectorAll('#fb-filter .chip'), function (x) { x.classList.toggle('on', x === c); });
      renderFeedback();
    });
    $('#fb-list').addEventListener('click', onFeedback);
    $('#op-list').addEventListener('click', onOperators);
    $('#op-grant').addEventListener('submit', onGrant);
    $('#op-devcode-btn').addEventListener('click', registerCode);
    $('#log-search').addEventListener('input', function () {
      clearTimeout(logTimer);
      logTimer = setTimeout(function () { state.logQ = $('#log-search').value.trim(); loadLog(true); }, 300);
    });
    $('#log-more').addEventListener('click', function () { loadLog(false); });
    $('#log-kinds').addEventListener('click', function (e) {
      var c = e.target.closest('[data-kind]');
      if (!c) return;
      state.logKind = c.dataset.kind;
      Array.prototype.forEach.call(document.querySelectorAll('#log-kinds .chip'), function (x) { x.classList.toggle('on', x === c); });
      loadLog(true);
    });
    $('#archive-list').addEventListener('click', onArchive);
    $('#em-release').addEventListener('click', releaseEmergency);
    $('#em-reload').addEventListener('click', function () { location.reload(); });
    $('#srv-backup').addEventListener('click', onBackup);
    $('#srv-stop').addEventListener('click', function (e) { if (e.target.closest('[data-stop]')) stopNow(); });
    $('#pay-filter').addEventListener('click', function (e) {
      var c = e.target.closest('[data-pay]');
      if (!c) return;
      state.payView = c.dataset.pay;
      Array.prototype.forEach.call(document.querySelectorAll('#pay-filter .chip'), function (x) { x.classList.toggle('on', x === c); });
      renderPay();
    });
    $('#pay-list').addEventListener('click', function (e) {
      var o = e.target.closest('[data-open]');
      if (o && Number(o.dataset.open)) { openDetail(Number(o.dataset.open)); return; }
      onPay(e);
    });
    $('#pay-list').addEventListener('input', function (e) {
      var t = e.target.closest('[data-draft]');
      if (t) drafts[t.dataset.draft] = t.value;
    });
    $('#vault-open').addEventListener('click', openVault);
    $('#vault-lock').addEventListener('click', function () { lockVault('保管庫を閉じました'); });
    $('#vault-list').addEventListener('click', onVault);
    $('#vault-list').addEventListener('change', function (e) {
      var box = e.target.closest('[data-vpick]');
      if (!box) return;
      if (box.checked) state.vaultPicked[box.dataset.vpick] = true; else delete state.vaultPicked[box.dataset.vpick];
      renderPicked();
    });
    $('#vault-new-folder').addEventListener('click', newFolder);
    $('#vault-new-text').addEventListener('click', newText);
    $('#vault-filter').addEventListener('click', function (e) {
      var c = e.target.closest('[data-vf]');
      if (!c) return;
      state.vaultShow = c.dataset.vf;
      state.vaultPage = 0;
      Array.prototype.forEach.call(document.querySelectorAll('#vault-filter .chip'), function (x) { x.classList.toggle('on', x === c); });
      renderVault();
    });
    $('#vault-pager').addEventListener('click', function (e) {
      var b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      state.vaultPage = Number(b.dataset.page);
      renderVault();
      $('#vault-path').scrollIntoView({ block: 'start' });
    });
    $('#vault-waiting').addEventListener('click', function (e) {
      var b = e.target.closest('[data-wait]');
      if (!b) return;
      if (b.dataset.wait === 'now') resumeWaiting(true);
      else { waiting.splice(Number(b.dataset.wait), 1); renderWaiting(); }
    });
    // stopped uploads: the connection back, or a look every 20 s for room
    window.addEventListener('online', function () {
      waiting.forEach(function (w) { if (w.why === 'net') w.next = 0; });
      resumeWaiting(false);
    });
    setInterval(function () { if (waiting.length && state.vault && !resuming) loadVault(); }, 20000);
    $('#vault-folders').addEventListener('click', onFolder);
    $('#vault-path').addEventListener('click', onFolder);
    $('#vault-picked-move').addEventListener('click', function () { moveFiles(Object.keys(state.vaultPicked)); });
    $('#vault-picked-clear').addEventListener('click', function () { state.vaultPicked = {}; renderVault(); });
    $('#vault-all-link').addEventListener('click', function () { makeLink(null); });
    $('#vault-all-stop').addEventListener('click', function () {
      ask({ title: '全体リンクを停止しますか？', text: '保管庫全体の読み取り専用リンクがすべて、すぐに使えなくなります。', ok: '停止する', danger: true }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/link/stop', { id: '*' }).then(function (r) { toast('リンクを停止しました（' + r.stopped + '本）'); return loadVault(); });
      }).catch(fail);
    });
    $('#viewer-close').addEventListener('click', closeViewer);
    $('#viewer').addEventListener('click', function (e) { if (e.target.id === 'viewer') closeViewer(); });
    $('#vault-file').addEventListener('change', onFiles);
    // leaving in the middle of an upload or a download
    window.addEventListener('beforeunload', function (e) { if (moving > 0 || waiting.length) { e.preventDefault(); e.returnValue = ''; } });

    $('#team-list').addEventListener('click', function (e) {
      var p = e.target.closest('[data-pair]');
      if (p) { openTeam(p.dataset.pair); return; }
      var b = e.target.closest('[data-peer]');
      if (b) openTeam(Number(b.dataset.peer));
    });
    $('#team-form').addEventListener('submit', sendTeam);
    $('#team-text').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendTeam(e); });
    $('#speed').value = speed;
    $('#speed').addEventListener('change', function () { setSpeed($('#speed').value); });

    $('#chat-close').addEventListener('click', closeChat);
    $('#chat-detail').addEventListener('click', function () { var c = state.chat; if (c) { closeChat(); openDetail(c.id); } });
    $('#chat-money').addEventListener('click', function () { var c = state.chat; if (c && c.data) openMoney(c.data.player); });
    $('#compose').addEventListener('submit', sendChat);
    $('#c-preview-btn').addEventListener('click', function () {
      var p = $('#c-preview');
      p.hidden = !p.hidden;
      if (!p.hidden) p.textContent = composed();
    });
    ['#c-subject', '#c-body'].forEach(function (s) {
      $(s).addEventListener('input', function () { if (!$('#c-preview').hidden) $('#c-preview').textContent = composed(); });
    });
    $('#money-form').addEventListener('submit', sendMoney);
    $('#money-cancel').addEventListener('click', function () { $('#money').hidden = true; });
    $('#money-presets').addEventListener('click', function (e) {
      var b = e.target.closest('[data-amount]');
      if (!b) return;
      $('#money-amount').value = fmt(Number(b.dataset.amount));
      Array.prototype.forEach.call(document.querySelectorAll('#money-presets button'), function (x) { x.classList.toggle('on', x === b); });
    });
    $('#money-amount').addEventListener('input', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#money-presets button'), function (x) { x.classList.remove('on'); });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#dialog').hidden) { $('#dialog-cancel').click(); return; }
      if (!$('#money').hidden) { $('#money').hidden = true; return; }
      if (!$('#chat').hidden) { closeChat(); return; }
      closeDetail();
    });
    if (!token) { showLogin(''); return; }
    request('GET', '/api/ops/me').then(start, function (err) { if (err.status !== 401 && err.code !== 'not_operator') showLogin(err.message); });
  }

  init();
})();
