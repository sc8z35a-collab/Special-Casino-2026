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
   - 保管庫: the developer's own (opened with the developer code) and the
     vaults operators share, one for every two of them (private: the two and
     the developer, who only looks into the others'). Big files in folders, 10
     to a page, sent in pieces checked by SHA-256 (a stopped upload goes on
     where it stopped, on its own once there is room or a connection), fetched
     back the same way; files and folders checked to move, download or delete
     several at once. One room for all of them: in the shared ones each
     operator keeps 1GB, more once the developer approves (with a limit). In
     the developer's own, time-limited links (for an AI too: what it takes and
     does is labelled; what it put in the game is 実装済み).
   - アーカイブ: the 永久BAN and deleted accounts, all their data gone 90 days
     after they came in; a 永久BAN can be lifted, a deleted account never
     comes back. Only the developer sees the button that deletes an account
     (with the developer code; the accounts on the same device go too).
   - 緊急停止: when the server stops itself (far more use than usual), every
     page shows it; the developer sees why and starts it again with the code.
   The login waits after two wrong tries (5 minutes, then 10, 20 …).
   The site refreshes at the speed shown at the top: one setting for every
   operator, which only the developer changes.
   Passwords are kept only as one-way hashes, so they can be set, never shown.
   Phones use their natural orientation; full screen is an explicit window action. */
(function () {
  'use strict';

  var KEY = 'two-state-ops/token';
  // how often the site refreshes (the developer's choice, from the server):
  // [the lists, the live views (サーバー, 運営チャット, a chat with a player)] in ms
  var SPEEDS = { max: [3000, 1000], high: [5000, 2000], normal: [15000, 5000], slow: [60000, 15000], slowest: [300000, 60000] };
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
    account_delete: 'アカウント削除', account_purge: 'データの削除（会話は保存）', emergency_stop: '緊急停止', emergency_release: '緊急停止の解除',
    lockdown: 'ロックダウン', lockdown_release: 'ロックダウンの解除', shield_block: '手動ブロック', shield_auto_block: '自動ブロック',
    shield_unblock: 'ブロックの解除', sec_message: 'セキュリティ基地の連絡',
    backup_key: 'バックアップの鍵', backup_run: 'バックアップ', backup_get: 'バックアップのダウンロード', backup_delete: 'バックアップの削除',
    backup_settings: 'バックアップの設定', backup_failed: 'バックアップの失敗', vault_note: '保管庫のコメント', vault_note_delete: '保管庫のコメント削除',
    player_register: '登録', player_login: 'ログイン', player_password: 'パスワード変更', player_recovery: '引き継ぎコード再発行',
    player_transfer: '送金', player_report: '通報', player_feedback: '報告・意見案',
    pay_order: '支払いページ', pay_paid: '購入（入金を確認）', pay_slip: 'コンビニ払いの番号', pay_unpaid: 'コンビニ未払い', pay_refund: '返金',
    pay_review: '決済の不一致（保留）', pay_reply: '開発者の返信', pay_error: '決済ページのエラー', pay_unknown: '不明な決済通知', pay_bad_signature: '不正な決済通知を拒否',
    vault_open: '保管庫を開いた', vault_upload: '保管庫に保存', vault_delete: '保管庫から削除', vault_link: '保管庫のリンク作成',
    vault_link_stop: '保管庫のリンク停止', vault_pull: '保管庫からリンクで取得', vault_folder: '保管庫のフォルダ', vault_move: '保管庫で移動',
    vault_bucket: '保管庫をR2へ移動', vault_ai_label: 'AIのラベル（保管庫）', vault_ai_done: 'AIが実装（保管庫）', vault_restore: '保管庫で実装済みから戻す',
    vault_quota_request: '保管庫の容量の申請', vault_quota_cancel: '容量の申請の取り下げ', vault_quota_approve: '容量の申請を承認', vault_quota_decline: '容量の申請を見送り',
    vault_quota_set: '保管庫の上限を変更', vault_rename: '保管庫で名前を変更', vault_backup: '保管庫のバックアップ', vault_backup_off: 'バックアップから外す',
    vault_backup_restore: 'バックアップから戻す', vault_ai_comment: 'AIのコメント（保管庫）', milestone: '登録者数の記念', voice_notice: '通話品質アップのお知らせ'
  };
  function actionName(a) { return ACTIONS[a] || (a.indexOf('admin:') === 0 ? '管理コマンド: ' + a.slice(6) : a); }
  var KINDS = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
  var REPORT_PLACES = { profile: 'プロフィール', hub: '「一緒に稼ぐ」', search: 'フレンド検索', chat: 'チャット', message: 'メッセージ（⋯から1件を通報）' };
  var FB_ITEMS = { slot: 'スロットの面白さ', features: 'スロット以外の機能の面白さ', clarity: '全体的なわかりやすさ', controls: '操作性', looks: '見やすさ', polish: '完成度' };

  var $ = function (s) { return document.querySelector(s); };
  var token = null;
  var diaryProfile = null;
  var state = {
    view: 'players', players: [], total: 0, counts: {}, now: Date.now(), filter: 'all', sort: 'new', q: '', open: 0, busy: false,
    reportStatus: 'open', detAll: false, fb: 'open', feedback: [], log: [], logQ: '', logDone: false, chat: null,
    developer: false, operators: [], pay: null, payView: 'waiting', vault: null, vaultFiles: [], vaultFolders: [], vaultFolder: '', vaultPicked: {},
    vaultShow: 'all', vaultPage: 0, logKind: '', vaultIn: '',
    // the vault open ('' the developer's own, 'p:<a>:<b>' a shared one), the ones to choose from, what one may do in it
    vaultSpace: '', vaultSpaces: null, vaultInfo: null,
    // the revisions of the lists this page has (the server answers "the same" while nothing changed), when they last came in full
    vaultRev: { files: '', spaces: '', full: 0 }, vaultSpeed: null
  };
  var timer = 0, liveTimer = 0, searchTimer = 0, logTimer = 0, chatTimer = 0;
  var speed = 'normal';

  try { token = localStorage.getItem(KEY); } catch (e) { token = null; }

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
          var err = { status: res.status, code: e.code || '', message: e.message || 'エラーが発生しました（' + res.status + '）', until: e.until || 0, mode: e.mode || 0 };
          // the server stopped itself (a plain emergency stop, or a lockdown)
          if (res.status === 503 && e.emergency) showEmergency(e);
          else if (res.status === 401 || e.code === 'not_operator' || e.code === 'banned') signedOut(err.message);
          else if (e.code === 'mfa_required' && path !== '/api/ops/login') showLogin(err.message);
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
    document.dispatchEvent(new CustomEvent('ops:notice', { detail: { app: state.view || 'players', text: String(text) } }));
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  function copy() { toast('この運営サイトではコピーできません'); }
  function fail(err) { toast(err && err.message ? err.message : 'エラーが発生しました'); }

  /* ------------------------------------------------------------ logging in --- */
  // the site put away (for the login, or the day's ログイン button)
  function leaveApp() {
    resetDevUnit();
    stopInline3d();
    if (call.on) callLeave();
    opsLiveClose();
    $('#dev-call').hidden = true;
    $('#app').hidden = true;
    $('#enter').hidden = true;
    closeDetail();
    closeChat();
    clearInterval(timer);
    clearInterval(liveTimer);
    clearInterval(aliveTimer);
  }
  function showLogin(message) {
    if (diaryProfile) diaryProfile.reset();
    leaveApp();
    $('#login').hidden = false;
    $('#login-error').textContent = message || '';
    setTimeout(function () { $('#login-name').focus(); }, 50);
  }
  // the first look of the day: ログイン to come in (the developer's ログインログ keeps it)
  var ROLE = { developer: ['dev', '開発者'], operator: ['op', '運営者'], viewer: ['k-viewer', '閲覧者'] };
  function roleOf(me) { return me.developer ? 'developer' : me.viewer ? 'viewer' : 'operator'; }
  function showEnter(me) {
    leaveApp();
    $('#login').hidden = true;
    $('#enter').hidden = false;
    var r = ROLE[roleOf(me)];
    $('#enter-role').className = 'kind ' + r[0];
    $('#enter-role').textContent = r[1];
    $('#enter-name').textContent = me.name;
    $('#enter-day').textContent = '今日（' + me.day.replace(/-/g, '/') + '）はじめての運営サイトです。「ログイン」を押すと入れます。';
    $('#enter-error').textContent = '';
    $('#enter-go').disabled = false;
    setTimeout(function () { $('#enter-go').focus(); }, 50);
  }
  function enter() {
    var go = $('#enter-go');
    go.disabled = true;
    $('#enter-error').textContent = '';
    request('POST', '/api/ops/enter').then(function () {
      return request('GET', '/api/ops/me');
    }).then(start, function (err) {
      go.disabled = false;
      if (err.status !== 401 && err.code !== 'not_operator') $('#enter-error').textContent = err.message;
    });
  }
  // the site's first answer: in, or the day's ログイン first
  function arrive(me) { if (me.entered === false) showEnter(me); else start(me); }
  // still the same day (Japan time) as when the site was entered? A new one asks for ログイン again
  function jstDay() { return new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10); }
  function dayCheck() {
    if (!token || $('#app').hidden || document.hidden || !state.day || jstDay() === state.day) return;
    request('GET', '/api/ops/me').then(function (me) {
      if (me.entered === false) showEnter(me);
      else state.day = me.day;
    }, function () {});
  }
  function signedOut(message) {
    setToken(null);
    // a viewer: nothing they saw stays in the page (it starts over, the reason kept for the login)
    if (state.viewer) {
      try { sessionStorage.setItem('ops-out', message || ''); } catch (e) { /* the login says nothing then */ }
      location.reload();
      return;
    }
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
    // (the day's ログイン as well: a login with the password is one)
    request('POST', '/api/ops/login', { name: name, password: pass, enter: true, otp: $('#login-otp').value.trim(), phrase: $('#login-phrase').value, recovery: $('#login-backup').value.trim() }, { 'X-Ops-Device': opsDevice() }).then(function (r) {
      setToken(r.token);
      return request('GET', '/api/ops/me').then(function (me) {
        $('#login-pass').value = '';
        $('#login-otp').value = ''; $('#login-phrase').value = ''; $('#login-backup').value = ''; $('#login-extra').open = false;
        start(me);
      }, function (err) {
        // not an operator: the session just made goes again
        fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + r.token, 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
        setToken(null);
        throw err;
      });
    }).catch(function (err) {
      if (err.code === 'mfa_required' || err.code === 'mfa_invalid') { $('#login-extra').open = true; $('#login-otp').focus(); }
      if (err.code === 'ops_locked' && err.until) { waitUntil(err.until); return; }
      $('#login-error').textContent = err.message;
    }).then(function () { if (Date.now() >= lockEnd) go.disabled = false; });
  }
  function logout() {
    var t = token;
    if (state.name) dropLogin(state.name);
    setToken(null);
    if (t) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' }).catch(function () {});
    showLogin('ログアウトしました');
  }

  /* DEV UNIT uses the same authenticated request helper as the operator apps. */
  var devUnit = { comments: [], latest: 0, unread: null, busy: false, generation: 0, readme: null, loadingDoc: false };
  function devUnitVisible() {
    var w = $('#mac-window-devunit');
    return !document.hidden && !$('#app').hidden && state.view === 'devunit' && w && w.classList.contains('is-active') && !w.classList.contains('is-minimized');
  }
  function resetDevUnit() {
    devUnit.generation++; devUnit.comments = []; devUnit.latest = 0; devUnit.unread = null; devUnit.busy = false; devUnit.loadingDoc = false; devUnit.readme = null;
    $('#devunit-comments').replaceChildren(); $('#devunit-text').value = ''; $('#devunit-error').textContent = ''; setCount('devunit', 0);
    $('#securityhome-frame').removeAttribute('src');
  }
  function renderDevDoc() {
    var root = $('#devunit-readme'), query = $('#devunit-search').value.trim().toLocaleLowerCase(); root.replaceChildren();
    if (devUnit.readme === null) return;
    var sections = devUnit.readme.split(/\n(?=#{1,3} )/), found = 0;
    sections.forEach(function (text, i) {
      if (query && text.toLocaleLowerCase().indexOf(query) < 0) return;
      var lines = text.split('\n'), title = lines.shift().replace(/^#+\s*/, '') || 'README DEV';
      var item = el('details'); item.open = !!query || i === 0;
      item.appendChild(el('summary', '', title)); item.appendChild(el('pre', '', lines.join('\n'))); root.appendChild(item); found++;
    });
    $('#devunit-doc-status').textContent = found ? $('#devunit-doc').selectedOptions[0].textContent + ' · ' + found + ' 項目' : '該当する項目はありません';
  }
  function loadDevDoc() {
    if (devUnit.readme !== null) { renderDevDoc(); return; }
    if (devUnit.loadingDoc) return;
    var gen = devUnit.generation; devUnit.loadingDoc = true;
    $('#devunit-doc-status').textContent = '資料を読み込み中…';
    fetch('assets/' + $('#devunit-doc').value, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw Error('READMEを読み込めません'); return r.text(); }).then(function (text) {
      if (gen !== devUnit.generation) return; devUnit.loadingDoc = false; devUnit.readme = text; renderDevDoc();
    }, function () { if (gen !== devUnit.generation) return; devUnit.loadingDoc = false; $('#devunit-doc-status').textContent = '資料を読み込めませんでした。アプリを開き直してください。'; });
  }
  function renderDevComments() {
    var box = $('#devunit-comments'), bottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.replaceChildren();
    devUnit.comments.forEach(function (c) {
      var item = el('article', 'devunit-comment');
      item.appendChild(el('b', '', c.from.name + (c.from.developer ? ' · 開発者' : ' · 運営者')));
      item.appendChild(el('p', '', c.text)); item.appendChild(el('small', '', new Date(c.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))); box.appendChild(item);
    });
    if (!devUnit.comments.length) box.appendChild(el('p', 'muted', 'まだコメントはありません'));
    if (bottom) box.scrollTop = box.scrollHeight;
  }
  function readDevComments() {
    if (!devUnitVisible() || !devUnit.latest) return;
    var gen = devUnit.generation;
    request('POST', '/api/ops/devunit/read', { id: devUnit.latest }).then(function () {
      if (gen !== devUnit.generation) return; devUnit.unread = 0; setCount('devunit', 0);
    }, function () {});
  }
  function loadDevComments(older) {
    if (devUnit.busy || state.viewer || !token || $('#app').hidden) return;
    devUnit.busy = true;
    var gen = devUnit.generation, first = devUnit.comments[0];
    request('GET', '/api/ops/devunit/comments' + (older && first ? '?before=' + first.id : '')).then(function (r) {
      if (gen !== devUnit.generation) return; devUnit.busy = false;
      if (older) { devUnit.comments = r.comments.concat(devUnit.comments); $('#devunit-more').hidden = !r.more; }
      else {
        // Merge the newest page without discarding already loaded older comments.
        var merged = new Map(); devUnit.comments.concat(r.comments).forEach(function (c) { merged.set(c.id, c); });
        devUnit.comments = Array.from(merged.values()).sort(function (a, b) { return a.id - b.id; });
        if (!first) $('#devunit-more').hidden = !r.more;
      }
      devUnit.latest = devUnit.comments.length ? devUnit.comments[devUnit.comments.length - 1].id : 0;
      renderDevComments(); readDevComments(); $('#devunit-error').textContent = '';
    }, function (e) { if (gen !== devUnit.generation) return; devUnit.busy = false; $('#devunit-error').textContent = e.message; });
  }
  function devUnitCounts() {
    if (!token || state.viewer || $('#app').hidden) return;
    var gen = devUnit.generation;
    request('GET', '/api/ops/devunit/counts').then(function (r) {
      if (gen !== devUnit.generation) return;
      if (devUnit.unread !== null && r.unread > devUnit.unread) {
        document.dispatchEvent(new CustomEvent('ops:notice', { detail: { app: 'devunit', text: '新しいコメントが届きました' } }));
        if (window.Notification && Notification.permission === 'granted') {
          try { var n = new Notification('DEV UNIT', { body: '新しいコメントが届きました', tag: 'devunit', icon: 'assets/devunit.webp' }); n.onclick = function () { window.focus(); setView('devunit'); n.close(); }; } catch (e) { /* The unread badge remains available. */ }
        }
      }
      devUnit.unread = r.unread; setCount('devunit', r.unread);
      if (devUnitVisible()) loadDevComments(false);
    }, function () {});
  }
  function initDevUnit() {
    $('#devunit-doc').addEventListener('change', function () { devUnit.generation++; devUnit.busy = false; devUnit.loadingDoc = false; devUnit.readme = null; loadDevDoc(); loadDevComments(false); });
    $('#devunit-search').addEventListener('input', renderDevDoc);
    $('#devunit-more').addEventListener('click', function () { loadDevComments(true); });
    $('#devunit-notify').hidden = !window.Notification;
    $('#devunit-notify').addEventListener('click', function () {
      Notification.requestPermission().then(function (p) { toast(p === 'granted' ? 'DEV UNITの通知を有効にしました' : 'アプリ内の未読バッジでお知らせします'); });
    });
    $('#devunit-form').addEventListener('submit', function (e) {
      e.preventDefault(); var input = $('#devunit-text'), text = input.value.trim(), submit = this.querySelector('[type="submit"]');
      if (!text || submit.disabled) return;
      var gen = devUnit.generation; submit.disabled = true;
      request('POST', '/api/ops/devunit/comments', { text: text }).then(function (r) {
        if (gen !== devUnit.generation) return;
        if (input.value.trim() === text) input.value = '';
        devUnit.comments = devUnit.comments.filter(function (c) { return c.id !== r.comment.id; }).concat([r.comment]).sort(function (a, b) { return a.id - b.id; }); devUnit.latest = devUnit.comments[devUnit.comments.length - 1].id; renderDevComments(); readDevComments(); $('#devunit-error').textContent = '';
      }, function (err) { if (gen === devUnit.generation) $('#devunit-error').textContent = err.message; }).then(function () { submit.disabled = false; });
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) devUnitCounts(); });
  }

  /* ------------------------------------------------------------ views --- */
  // what a 閲覧者 never sees (the server refuses it anyway): the players'
  // list and the archive, the operators' chat, the payments and the vault
  var VIEWER_HIDDEN = ['players', 'archive', 'team', 'pay', 'vault', 'devunit', 'diary', 'profile'];
  function start(me) {
    $('#login').hidden = true;
    $('#enter').hidden = true;
    $('#app').hidden = false;
    state.day = me.day || jstDay();
    $('#op-name').textContent = (me.developer ? '開発者: ' : me.viewer ? '閲覧者: ' : '運営者: ') + me.name;
    state.name = me.name;
    state.developer = !!me.developer;
    state.viewer = !!me.viewer;
    $('#tab-diary').hidden = !state.developer;
    $('#tab-profile').hidden = state.viewer;
    if (diaryProfile) diaryProfile.start(me);
    state.devCodeSet = !!me.devCodeSet;
    document.body.classList.toggle('role-viewer', state.viewer);
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) { t.hidden = state.viewer && VIEWER_HIDDEN.indexOf(t.dataset.view) >= 0; });
    $('#tab-diary').hidden = !state.developer;
    // the refresh speed: everyone sees it, only the developer changes it
    $('#speed').disabled = !state.developer;
    $('#speed').title = state.developer ? '運営サイトの更新頻度（運営者全員に反映）' : '更新頻度は開発者だけが変えられます';
    useSpeed(me.speed, false);
    if (state.viewer) {
      // looking only: no players' list to load, the counts on their own, and
      // every 2 seconds the question whether they still may (taken away: out)
      $('#tab-pay').hidden = true;
      $('#tab-vault').hidden = true;
      loadCounts();
      setView('reports');
      startTimers();
      return;
    }
    // 課金: the developer's own; 保管庫: every operator (their own and the shared vaults; the developer's own changes with the code)
    $('#tab-pay').hidden = !state.developer;
    $('#tab-vault').hidden = false;
    resetVault();
    // (this account's uploads waiting in this browser)
    Object.keys(up.cards).forEach(function (k) { up.cards[k].card.remove(); });
    up.cards = {};
    up.jobs = {};
    // (after a new login: the files that waited for one go now)
    refreshJobs().then(adoptJobs).then(kick);
    opsLiveOpen();
    devUnitCounts();
    if (state.developer) loadPay(true);
    load();
    loadCounts();
    // /ops/#vault: straight to the vault
    if (location.hash === '#vault') setView('vault');
    loadTeam(true);
    startTimers();
  }
  // a viewer's tabs: what waits in each (they have no players' list to bring them)
  function loadCounts() {
    return request('GET', '/api/ops/counts').then(function (r) {
      setCount('reports', r.reports || 0);
      setCount('detections', r.detections || 0);
      setCount('feedback', r.feedback || 0);
      if (r.speed) useSpeed(r.speed, true);
      // the サーバー button's colour for the month's usage, from every tab
      if (r.usage) paintUsageTab(r.usage.tier || '');
    }, function () {});
  }
  // a viewer: still one? (asked every 2 seconds while the page is seen; the answer 401 logs out)
  var aliveTimer = 0;
  function alive() {
    if (!state.viewer || !token || document.hidden) return;
    request('GET', '/api/ops/alive').catch(function () {});
  }
  // the lists at one speed, the live views at a faster one (while the page is seen)
  function startTimers() {
    clearInterval(timer);
    clearInterval(aliveTimer);
    if (state.viewer) aliveTimer = setInterval(alive, 2000);
    timer = setInterval(function () {
      if (document.hidden || !$('#dialog').hidden || !$('#money').hidden) return;
      if (state.viewer) {
        loadCounts();
        if (state.view === 'reports') loadReports(true);
        else if (state.view === 'detections') loadDetections(true);
        else if (state.view === 'feedback') loadFeedback(true);
        return;
      }
      load(true);
      loadCounts();
      devUnitCounts();
      if (diaryProfile) diaryProfile.refresh();
      if (state.view === 'reports') loadReports(true);
      else if (state.view === 'detections') loadDetections(true);
      else if (state.view === 'feedback') loadFeedback(true);
      if (state.view !== 'team') loadTeam(true);
      if (state.developer && !(state.view === 'pay' && document.activeElement && document.activeElement.tagName === 'TEXTAREA')) loadPay(true);
      // the vault open: what the other one of a shared vault did (not while files go up or down)
      if (state.view === 'vault') {
        if (!state.vault) openLook(true);
        else if (!moving && $('#viewer').hidden && $('#vmenu').hidden) loadVault(true);
      }
    }, SPEEDS[speed][0]);
    clearInterval(liveTimer);
    liveTimer = setInterval(function () {
      if (document.hidden) return;
      if (state.view === 'server') loadServer(true);
      else if (state.view === 'team') loadTeam(true);
      else if (state.view === 'security') loadSecurity(true);
    }, SPEEDS[speed][1]);
    if (state.chat) chatEvery();
  }
  // the speed from the server (`restart`: the timers already run)
  function useSpeed(v, restart) {
    if (!SPEEDS[v]) v = 'normal';
    $('#speed').value = v;
    if (v === speed) return;
    speed = v;
    if (restart && !$('#app').hidden) startTimers();
  }
  // the developer picks one: every operator's site follows
  function setSpeed(v) {
    if (!SPEEDS[v] || !state.developer) { $('#speed').value = speed; return; }
    request('POST', '/api/ops/speed', { speed: v }).then(function (r) {
      useSpeed(r.speed, true);
      var s = SPEEDS[speed];
      toast('更新頻度：' + $('#speed').selectedOptions[0].textContent + '（一覧 ' + (s[0] >= 60000 ? s[0] / 60000 + '分' : s[0] / 1000 + '秒') + '・サーバーとチャット ' + s[1] / 1000 + '秒ごと。運営者全員に反映）');
    }, function (err) { $('#speed').value = speed; fail(err); });
  }
  function setView(v) {
    if (v !== 'vault') stopInline3d();
    var again = state.view === v;
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) { t.classList.toggle('on', t.dataset.view === v); });
    ['players', 'archive', 'reports', 'detections', 'feedback', 'log', 'operators', 'team', 'security', 'server', 'pay', 'vault', 'devunit', 'securityhome', 'diary', 'profile'].forEach(function (x) { $('#view-' + x).hidden = x !== v; });
    if (diaryProfile) diaryProfile.view(v);
    if (v === 'players') load();
    else if (v === 'archive') loadArchive();
    else if (v === 'operators') loadOperators();
    else if (v === 'reports') loadReports();
    else if (v === 'detections') loadDetections();
    else if (v === 'feedback') loadFeedback();
    else if (v === 'devunit' && !state.viewer) { loadDevDoc(); loadDevComments(false); }
    else if (v === 'securityhome' && !$('#securityhome-frame').getAttribute('src')) $('#securityhome-frame').src = '/sec/';
    else if (v === 'log') { loadLog(true); verifyLog(); }
    else if (v === 'team') openTeamView();
    else if (v === 'security') loadSecurity();
    else if (v === 'server') { loadServer(); renderDevCards(); }
    else if (v === 'pay') loadPay();
    else if (v === 'vault') {
      // (the 保管庫 tab again while in it: its top)
      if (again && state.vault && (state.vaultFolder || state.vaultIn)) { goTop(); return; }
      renderVault(); if (state.vault) loadVault(true); else openLook();
    }
    // (the call goes on elsewhere: its reminder)
    renderCall();
    scrollTop();
  }
  function scrollTop() { if (turned) $('#app').scrollTop = 0; else window.scrollTo(0, 0); }
  // the top bar's height: what stays in sight below it (the bar of checked items in the vault) starts there
  function topBar() {
    var top = document.querySelector('.top');
    if (top && top.offsetHeight) document.documentElement.style.setProperty('--top-h', top.offsetHeight + 'px');
  }
  function setCount(id, n) {
    var b = $('#count-' + id);
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n || 0);
    document.dispatchEvent(new CustomEvent('ops:count', { detail: { app: id, count: n } }));
  }

  /* ------------------------------------------------------------ the players --- */
  function load(quiet) {
    return request('GET', '/api/ops/players' + (state.q ? '?q=' + encodeURIComponent(state.q) : '')).then(function (r) {
      state.players = r.players || [];
      state.total = r.total || 0;
      if (r.speed) useSpeed(r.speed, true);
      state.now = r.now || Date.now();
      state.counts = { waiting: r.waiting || 0, reports: r.reports || 0, detections: r.detections || 0, feedback: r.feedback || 0 };
      setCount('reports', state.counts.reports);
      setCount('detections', state.counts.detections);
      setCount('feedback', state.counts.feedback);
      setCount('archive', r.archived || 0);
      // (the developer: operators asking for more room in the shared vaults)
      setCount('vault', state.developer ? r.vaultRequests || 0 : 0);
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
    if (p.viewer) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag t-viewer', '閲覧者')); }
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
        ? 'このアカウントは ' + date(p.archive.at, true) + ' に削除されました（取り消し不可）。' + date(p.archive.purgeAt, true) + '（あと' + left + '日）にデータを削除します（会話とログは無期限で保存）。'
        : '永久BANでプレイヤーアーカイブに入っています。' + date(p.archive.purgeAt, true) + '（あと' + left + '日）にデータを削除します（会話とログは無期限で保存・永久BANを解除すると一覧に戻ります）。'));
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
      ban.appendChild(el('p', 'muted', 'アクセス禁止は1週間、BANは30日で自動解除（いつでも解除可）。BAN・永久BANは同じ端末のほかのアカウントも止めます。永久BANはプレイヤーアーカイブに移り、90日後にデータを削除します（会話とログは無期限で保存）。'));
    }
    box.appendChild(ban);
    // the developer's eyes only: deleting the account
    if (state.developer && !p.deleted && !p.operator) {
      var del = section('アカウントの削除（開発者だけに表示）');
      del.appendChild(el('p', 'muted', 'このプレイヤーと同じ端末のアカウントを削除します。すぐにログアウトされ、プレイヤーアーカイブに移り、90日後にデータを削除します（会話とログは無期限で保存）。開発者でも取り消せません（開発者コードが必要・ログに残ります）。'));
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
          return ask({ title: '新しい引き継ぎコード', text: p.name + ' さんの新しいコードです: ' + r.code, ok: '閉じる' }).then(function (c) { if (c) copy(r.code); });
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
        text: (subs.length ? '同じ端末の ' + subs.join('、') + ' さんのアカウントも一緒に削除します。' : '') + 'すぐにログアウトされ、プレイヤーアーカイブに移ります。' + r.days + '日後にデータを削除します（会話とログは無期限で保存）。この操作は開発者でも取り消せません。',
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
  function showEmergency(info) {
    if (emergencyOn) return;
    emergencyOn = true;
    clearInterval(timer);
    clearInterval(liveTimer);
    clearInterval(chatTimer);
    $('#emergency').hidden = false;
    $('#em-list').textContent = '';
    $('#em-release').hidden = true;
    // a lockdown: the operator site is shut too; direct everyone to security HOME
    var lockdown = !!(info && info.lockdown);
    $('#em-sec').hidden = !lockdown;
    if (lockdown) {
      $('#emergency').querySelector('h2').textContent = 'ロックダウン中です';
      $('#em-text').textContent = '防御が突破された可能性を検知したため、サーバーをロックダウンしています。運営の操作はできません。監視・連絡・解除はセキュリティ基地（security HOME）で行ってください。';
    } else {
      $('#em-text').textContent = 'いつもよりはるかに多い使用量を検知したため、サーバーを止めています。開発者が確認して再開するまでお待ちください。';
      if (state.developer) loadEmergency();
    }
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
    fact(facts, 'データの削除', date(a.purgeAt, true) + '（あと' + Math.max(0, Math.ceil((a.purgeAt - now) / 86400000)) + '日）');
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
    ask({ title: '永久BANを解除しますか？', text: 'プレイヤー一覧に戻り、データの削除の予定もなくなります。公式から解除のお知らせが届きます。', ok: '解除する' }).then(function (ok) {
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
      state.viewers = r.viewers || [];
      if (r.devCodeSet !== undefined) state.devCodeSet = !!r.devCodeSet;
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
      else if (o.registered && state.developer) {
        var b = el('button', o.operator ? 'btn small danger' : 'btn small', o.operator ? '運営権を剥奪する' : '運営権を戻す');
        b.type = 'button';
        b.dataset.opAct = o.operator ? 'revoke' : 'grant';
        b.dataset.name = o.name;
        a.appendChild(b);
      }
      if (o.operator && o.registered && !o.mfaMode) a.appendChild(el('span', 'auth-warning', '！追加認証未設定'));
      card.appendChild(a);
      list.appendChild(card);
    });
    // rights: the developer only
    $('#op-grant').hidden = !state.developer;
    renderViewers();
    $('#op-inlog-box').hidden = !state.developer;
    if (state.developer) loadInlog(false);
  }
  // the ログインログ (the developer's): who came into the site first each day, newest first
  var inlog = { rows: [], more: false, today: '' };
  function loadInlog(more) {
    var before = more && inlog.rows.length ? inlog.rows[inlog.rows.length - 1].id : 0;
    if (!more && !inlog.rows.length) $('#op-inlog').textContent = '';
    request('GET', '/api/ops/entries' + (before ? '?before=' + before : '')).then(function (r) {
      inlog.rows = more ? inlog.rows.concat(r.entries) : r.entries;
      inlog.more = !!r.more;
      inlog.today = r.today;
      renderInlog();
    }, fail);
  }
  function renderInlog() {
    var box = $('#op-inlog');
    box.textContent = '';
    if (!inlog.rows.length) box.appendChild(el('p', 'muted', 'まだ記録はありません'));
    var day = '';
    inlog.rows.forEach(function (e) {
      if (e.day !== day) {
        day = e.day;
        box.appendChild(el('div', 'inlog-day', day.replace(/-/g, '/') + (day === inlog.today ? '（今日）' : '')));
      }
      var row = el('div', 'inlog-row');
      row.appendChild(el('span', 'inlog-time', e.jst.slice(11, 19)));
      var r = ROLE[e.role] || ROLE.operator;
      row.appendChild(el('span', 'kind ' + r[0], r[1]));
      row.appendChild(el('span', 'inlog-name', e.user.name));
      row.appendChild(el('span', 'inlog-how', (e.how === 'password' ? 'パスワードでログイン' : 'ログインボタン') + ' · ' + e.agent));
      box.appendChild(row);
    });
    $('#op-inlog-more').hidden = !inlog.more;
  }
  // the viewers (閲覧者), each with when; the developer takes it away
  function renderViewers() {
    var box = $('#op-viewers');
    box.textContent = '';
    if (!(state.viewers || []).length) { box.appendChild(el('p', 'muted', '閲覧者はいません')); return; }
    state.viewers.forEach(function (v) {
      var card = el('article', 'card');
      var head = el('div', 'card-head');
      head.appendChild(person({ id: v.id, name: v.name, avatar: v.avatar }, v.site ? '運営サイトを見ています' : v.online ? 'ゲーム中' : '付与 ' + stamp(v.at) + (v.by ? '（' + v.by + '）' : '')));
      head.appendChild(el('span', 'kind k-viewer', '閲覧者'));
      card.appendChild(head);
      if (state.developer) {
        var a = el('div', 'acts'), b = el('button', 'btn small danger', '閲覧者の権限を剥奪する');
        b.type = 'button';
        b.dataset.viewerAct = 'revoke';
        b.dataset.name = v.name;
        a.appendChild(b);
        card.appendChild(a);
      }
      box.appendChild(card);
    });
  }
  function changeViewer(action, name, b) {
    var revoke = action === 'revoke';
    withCode(revoke
      ? { title: name + ' さんの閲覧者の権限を剥奪しますか？', text: name + ' さんはすぐに運営サイトと security HOME からログアウトされます（ゲームはそのまま遊べます）。', ok: '剥奪する', danger: true }
      : { title: name + ' さんを閲覧者にしますか？', text: name + ' さんは運営サイトと security HOME を見ることだけができるようになります（プレイヤー一覧・アーカイブ・保管庫・チャット・バックアップ・課金は見られず、操作は一切できません）。', ok: '閲覧者にする' }
    ).then(function (code) {
      if (code === null) return null;
      if (b) b.disabled = true;
      return request('POST', '/api/ops/viewer', { name: name, action: action, code: code }).then(function (r) {
        toast(revoke ? name + ' さんの閲覧者の権限を剥奪しました' : name + ' さんを閲覧者にしました');
        state.operators = r.operators || state.operators;
        state.viewers = r.viewers || [];
        renderOperators();
        $('#op-grant-name').value = '';
      });
    }).catch(function (err) { if (b) b.disabled = false; fail(err); });
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
    var v = e.target.closest('[data-viewer-act]');
    if (v) changeViewer(v.dataset.viewerAct, v.dataset.name, v);
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
      if (!call.on) call.members = r.call || [];
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
    closePick();
    renderTeamList();
    renderTeamHead();
    renderCall();
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
    if ((r.call || []).length) all.appendChild(el('span', 'team-calling', '🎙' + r.call.length));
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
      renderCall();
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
      node.appendChild(bubbleEl(m));
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
    var peer = team.peer, text = withTokens($('#team-text').value.trim());
    if (peer === null || team.sending || !text) return;
    team.sending = true;
    closePick();
    request('POST', '/api/ops/team/messages', { to: peer, text: text }).then(function () {
      $('#team-text').value = '';
      team.refs = {};
      if (team.peer === peer) loadTeamMsgs(true);
    }, fail).then(function () { team.sending = false; });
  }

  /* what a message names: a player (@[p:<id>]: a tap opens them), the
     developer (@[dev]: called at once) and a log line (@[log:<id>]: a tap
     shows it). In the box they read "@名前", "@開発者", "［ログ#12］". */
  var TOKEN = /@\[(p:\d+|dev|log:\d+)\]/g;
  function bubbleEl(m) {
    var b = el('div', 'bubble' + (m.refs && m.refs.dev ? ' calls-dev' : '')), text = String(m.text || ''), at = 0, t;
    var refs = m.refs || { players: {}, logs: {} };
    TOKEN.lastIndex = 0;
    while ((t = TOKEN.exec(text))) {
      if (t.index > at) b.appendChild(document.createTextNode(text.slice(at, t.index)));
      b.appendChild(refEl(t[1], refs));
      at = t.index + t[0].length;
    }
    if (at < text.length) b.appendChild(document.createTextNode(text.slice(at)));
    return b;
  }
  function refEl(tok, refs) {
    if (tok === 'dev') return el('span', 'mention dev', '@開発者');
    var id = Number(tok.slice(tok.indexOf(':') + 1));
    if (tok[0] === 'p') {
      var p = (refs.players || {})[id];
      if (!p) return el('span', 'mention gone', '@?');
      var b = el('button', 'mention', '@' + p.name);
      b.type = 'button';
      b.dataset.player = id;
      b.title = p.name + ' さんを開く';
      return b;
    }
    var x = (refs.logs || {})[id];
    var q = el('button', 'quote-log' + (x ? '' : ' gone'));
    q.type = 'button';
    q.dataset.log = id;
    q.appendChild(el('small', '', 'ログ #' + id + (x ? '・' + stamp(x.at) + '・' + (KINDS[x.kind] || '') : '')));
    q.appendChild(el('span', '', x ? x.summary : '（この記録は見つかりません）'));
    return q;
  }
  // a tap on a name or a quote in the chat
  function onTeamMsgs(e) {
    var p = e.target.closest('[data-player]');
    if (p) { openDetail(Number(p.dataset.player)); return; }
    var l = e.target.closest('[data-log]');
    if (l) showLogLine(Number(l.dataset.log));
  }
  // one line of the log, opened (from a quote)
  function showLogLine(id) {
    state.logQ = '#' + id;
    state.logKind = '';
    $('#log-search').value = state.logQ;
    Array.prototype.forEach.call(document.querySelectorAll('#log-kinds .chip'), function (x) { x.classList.toggle('on', x.dataset.kind === ''); });
    setView('log');
    var tries = 0;
    (function open() {
      var more = document.querySelector('#log-list .entry-more');
      if (more) { more.click(); return; }
      if (++tries < 20) setTimeout(open, 150);
    })();
  }
  // "@名前" and the rest back into what the server keeps
  function withTokens(text) {
    Object.keys(team.refs || {}).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) { text = text.split(k).join(team.refs[k]); });
    return text;
  }
  function insertAtCaret(ta, text, dropAt) {
    var from = ta.selectionStart, to = ta.selectionEnd, v = ta.value;
    // (the "@" just typed that opened the list goes)
    if (dropAt && from > 0 && v.charAt(from - 1) === '@') from--;
    ta.value = v.slice(0, from) + text + v.slice(to);
    ta.selectionStart = ta.selectionEnd = from + text.length;
    ta.focus();
  }
  // the list to pick from: 'at' (@開発者 first, then players) or 'log' (any line of the log)
  var pick = { mode: '', timer: 0, typed: false, seq: 0 };
  function openPick(mode, typed) {
    if (team.peer === null || isPair(team.peer)) return;
    pick.mode = mode;
    pick.typed = !!typed;
    $('#team-pick').hidden = false;
    var q = $('#team-pick-q');
    q.value = '';
    q.placeholder = mode === 'log' ? '記録を探す（名前・内容・#番号）' : 'プレイヤー名で探す';
    clearTimeout(pick.timer);
    renderPick([], mode);
    loadPick();
    setTimeout(function () { q.focus(); }, 20);
  }
  function closePick() { $('#team-pick').hidden = true; pick.mode = ''; clearTimeout(pick.timer); pick.seq++; }
  function loadPick() {
    var mode = pick.mode, q = $('#team-pick-q').value.trim(), seq = ++pick.seq;
    if (!mode) return;
    var url = mode === 'log' ? '/api/ops/log?q=' + encodeURIComponent(q) : '/api/ops/players?q=' + encodeURIComponent(q);
    request('GET', url).then(function (r) {
      if (seq !== pick.seq || pick.mode !== mode) return;
      renderPick(mode === 'log' ? (r.entries || []).slice(0, 30) : (r.players || []).slice(0, 30), mode);
    }, function () {});
  }
  function renderPick(items, mode) {
    var box = $('#team-pick-list');
    mode = mode || pick.mode;
    box.textContent = '';
    function row(label, sub, data, cls) {
      var b = el('button', 'team-pick-row' + (cls ? ' ' + cls : ''));
      b.type = 'button';
      b.setAttribute('role', 'option');
      Object.keys(data).forEach(function (k) { b.dataset[k] = data[k]; });
      b.appendChild(el('b', '', label));
      if (sub) b.appendChild(el('small', '', sub));
      box.appendChild(b);
    }
    if (mode === 'at') {
      row('@開発者', '特別タグ：開発者にすぐ知らせます（運営サイト・スマホ・Discord）', { pickDev: '1' }, 'dev');
      items.filter(function (p) { return p && p.name && !p.actor; }).forEach(function (p) { row('@' + p.name, (p.online ? 'オンライン・' : '') + '登録 ' + date(p.createdAt), { pickPlayer: p.id, name: p.name }); });
    } else {
      items.filter(function (x) { return x && x.actor; }).forEach(function (x) { row('#' + x.id + ' ' + x.summary, String(x.jst || '').slice(0, 16) + '・' + (KINDS[x.kind] || '') + '・' + x.actor.name, { pickLog: x.id }); });
    }
    if (!box.childNodes.length) box.appendChild(el('p', 'muted team-pick-empty', '見つかりません'));
  }
  function onPickList(e) {
    var b = e.target.closest('.team-pick-row');
    if (!b) return;
    var ta = $('#team-text'), key;
    team.refs = team.refs || {};
    if (b.dataset.pickDev) { key = '@開発者'; team.refs[key] = '@[dev]'; }
    else if (b.dataset.pickPlayer) { key = '@' + b.dataset.name; team.refs[key] = '@[p:' + b.dataset.pickPlayer + ']'; }
    else { key = '［ログ#' + b.dataset.pickLog + '］'; team.refs[key] = '@[log:' + b.dataset.pickLog + ']'; }
    var typed = pick.typed;
    closePick();
    insertAtCaret(ta, key + ' ', typed);
  }
  // a log line quoted from the log (its 詳細): into the 全体チャット's box
  function quoteInChat(x) {
    setView('team');
    var go = function () {
      if (team.peer === null || isPair(team.peer)) openTeam(0);
      team.refs = team.refs || {};
      var key = '［ログ#' + x.id + '］';
      team.refs[key] = '@[log:' + x.id + ']';
      insertAtCaret($('#team-text'), key + ' ');
    };
    setTimeout(go, 300);
  }

  /* the operator site's own live connection (an operator's): the 全体チャット's
     call and the developer called. WebSocket on Cloudflare, Server-Sent
     Events on the Node server (the page says which). */
  var opsLive = null, opsLiveWant = false, opsLiveTimer = 0;
  function liveSse() { var m = document.querySelector('meta[name="br-mode"]'); return !!m && m.getAttribute('data-live') === 'sse'; }
  function opsLiveOpen() {
    if (state.viewer || !token || opsLive) return;
    opsLiveWant = true;
    request('POST', '/api/ops/live-ticket', {}).then(function (r) {
      if (!opsLiveWant || opsLive) return;
      var path = '/api/' + (liveSse() ? 'stream' : 'live') + '?ops=' + encodeURIComponent(r.ticket), up = false;
      if (liveSse()) {
        var es = new EventSource(path);
        opsLive = { close: function () { es.close(); } };
        ['hello', 'opscall', 'opsping', 'devunit'].forEach(function (ev) {
          es.addEventListener(ev, function (e) { up = true; var d = null; try { d = JSON.parse(e.data); } catch (x) { return; } onOpsLive(ev, d); });
        });
        es.onerror = function () { es.close(); opsLiveLost(up); };
      } else {
        var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path);
        var ping = setInterval(function () { try { ws.send('ping'); } catch (x) { /* closing */ } }, 30000);
        opsLive = { close: function () { clearInterval(ping); ws.onclose = null; try { ws.close(); } catch (x) { /* closed */ } } };
        ws.onmessage = function (e) {
          if (e.data === 'pong') return;
          var m = null;
          try { m = JSON.parse(e.data); } catch (x) { return; }
          up = true;
          onOpsLive(m.event, m.data);
        };
        ws.onclose = function () { clearInterval(ping); opsLiveLost(up); };
      }
    }, function () { opsLiveLost(false); });
  }
  function opsLiveLost(was) {
    opsLive = null;
    // (the call goes with the connection: the server has let us out)
    if (call.on) { callEnd(); toast('接続が切れたため、通話から抜けました'); }
    if (!opsLiveWant) return;
    clearTimeout(opsLiveTimer);
    opsLiveTimer = setTimeout(opsLiveOpen, was ? 1000 : 5000);
  }
  function opsLiveClose() {
    opsLiveWant = false;
    clearTimeout(opsLiveTimer);
    if (opsLive) { opsLive.close(); opsLive = null; }
  }
  function onOpsLive(ev, d) {
    if (ev === 'devunit') devUnitCounts();
    else if (ev === 'opscall') onCall(d);
    else if (ev === 'opsping') devCalled(d);
  }
  // @開発者: the developer hears of it at once
  function devCalled(d) {
    var box = $('#dev-call');
    box.textContent = '';
    box.appendChild(el('b', '', '📣 ' + d.from.name + ' さんが' + (d.to ? '個人チャット' : '全体チャット') + 'で開発者を呼んでいます'));
    box.appendChild(el('span', '', d.text));
    var go = el('button', 'btn small primary', '開く');
    go.type = 'button';
    go.addEventListener('click', function () { box.hidden = true; setView('team'); setTimeout(function () { openTeam(d.to ? d.from.id : 0); }, 200); });
    var x = el('button', 'close', '×');
    x.type = 'button';
    x.setAttribute('aria-label', '閉じる');
    x.addEventListener('click', function () { box.hidden = true; });
    box.appendChild(go);
    box.appendChild(x);
    box.hidden = false;
    document.dispatchEvent(new CustomEvent('ops:notice', { detail: { app: 'team', text: d.from.name + ' さんが開発者を呼んでいます' } }));
    try { if (window.Notification && Notification.permission === 'granted') new Notification('運営チャットで開発者が呼ばれています', { body: d.from.name + '：' + d.text }); } catch (e) { /* none */ }
  }

  /* The 全体チャット's call: every operator who comes, for as long as they
     like, everyone to everyone (the newcomer calls each one already in it).
     High quality: Opus at 128 kbps with error correction, the microphone's
     echo and noise cancelled. */
  var CALL_BPS = 128000;
  var call = { on: false, joining: false, stream: null, peers: {}, members: [], muted: false, ice: [] };
  function hq(desc) {
    var sdp = String(desc.sdp || ''), m = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
    if (m) {
      var pt = m[1], line = new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)');
      var want = 'maxaveragebitrate=' + CALL_BPS + ';useinbandfec=1;usedtx=0;maxplaybackrate=48000';
      sdp = line.test(sdp) ? sdp.replace(line, function (all, p) { return 'a=fmtp:' + pt + ' ' + p.split(';').filter(function (x) { return !/^(maxaveragebitrate|useinbandfec|usedtx|maxplaybackrate)=/.test(x); }).concat(want).join(';'); })
        : sdp.replace(m[0], m[0] + '\r\na=fmtp:' + pt + ' ' + want);
    }
    return { type: desc.type, sdp: sdp };
  }
  function signal(to, data) { return request('POST', '/api/ops/call/signal', { to: to, data: data }).catch(function () {}); }
  function plain(d) { return d && d.toJSON ? d.toJSON() : d; }
  function peerFor(o, offer) {
    var p = call.peers[o.id];
    if (p) return p;
    var pc = new RTCPeerConnection({ iceServers: call.ice });
    p = call.peers[o.id] = { pc: pc, user: o, audio: null, pending: [], state: 'new' };
    call.stream.getTracks().forEach(function (t) { pc.addTrack(t, call.stream); });
    pc.onicecandidate = function (e) { if (e.candidate) signal(o.id, { candidate: plain(e.candidate) }); };
    pc.ontrack = function (e) {
      if (!p.audio) { p.audio = new Audio(); p.audio.autoplay = true; }
      p.audio.srcObject = e.streams[0];
      p.audio.play().catch(function () {});
    };
    pc.onconnectionstatechange = function () {
      p.state = pc.connectionState;
      if (p.state === 'connected') {
        pc.getSenders().forEach(function (sd) {
          if (!sd.track || sd.track.kind !== 'audio' || !sd.getParameters) return;
          var prm = sd.getParameters();
          prm.encodings = prm.encodings && prm.encodings.length ? prm.encodings : [{}];
          prm.encodings[0].maxBitrate = CALL_BPS;
          sd.setParameters(prm).catch(function () {});
        });
      }
      renderCall();
    };
    if (offer) {
      pc.createOffer().then(function (d) { return pc.setLocalDescription(hq(d)); })
        .then(function () { return signal(o.id, { sdp: plain(pc.localDescription) }); }).catch(function () {});
    }
    return p;
  }
  function dropPeer(id) {
    var p = call.peers[id];
    if (!p) return;
    try { p.pc.close(); } catch (e) { /* closed */ }
    if (p.audio) { p.audio.srcObject = null; }
    delete call.peers[id];
  }
  function onCall(d) {
    if (d.members) call.members = d.members;
    if (team.list) team.list.call = d.members || team.list.call;
    if (!call.on) { renderCall(); renderTeamList(); return; }
    if (d.type === 'leave') dropPeer(d.user.id);
    else if (d.type === 'signal') {
      var p = peerFor(d.from, false), pc = p.pc, x = d.data || {};
      if (x.sdp) {
        pc.setRemoteDescription(x.sdp).then(function () {
          p.pending.splice(0).forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); });
          if (x.sdp.type !== 'offer') return null;
          return pc.createAnswer().then(function (a) { return pc.setLocalDescription(hq(a)); })
            .then(function () { return signal(d.from.id, { sdp: plain(pc.localDescription) }); });
        }).catch(function () {});
      } else if (x.candidate) {
        if (pc.remoteDescription) pc.addIceCandidate(x.candidate).catch(function () {});
        else p.pending.push(x.candidate);
      }
    }
    renderCall();
  }
  function callJoin() {
    if (call.on || call.joining) return;
    if (!opsLive) { opsLiveOpen(); toast('接続を準備しています。少し待ってからもう一度押してください'); return; }
    if (!navigator.mediaDevices || !window.RTCPeerConnection) { toast('このブラウザでは通話できません'); return; }
    call.joining = true;
    renderCall();
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 } }).then(function (stream) {
      call.stream = stream;
      return request('POST', '/api/ops/call/join', {}).then(function (r) {
        call.on = true;
        call.muted = false;
        call.ice = r.ice || [];
        call.members = r.members || [];
        (r.others || []).forEach(function (o) { peerFor(o, true); });
        toast('通話に参加しました');
      });
    }).catch(function (err) {
      stopMic();
      fail(err && err.name === 'NotAllowedError' ? { message: 'マイクの使用が許可されていません' } : err && err.message ? err : { message: '通話に参加できませんでした' });
    }).then(function () { call.joining = false; renderCall(); });
  }
  function stopMic() {
    if (call.stream) call.stream.getTracks().forEach(function (t) { t.stop(); });
    call.stream = null;
  }
  // out of the call here (the server is told by callLeave)
  function callEnd() {
    Object.keys(call.peers).forEach(dropPeer);
    stopMic();
    call.on = false;
    renderCall();
  }
  function callLeave() {
    if (!call.on) return;
    callEnd();
    request('POST', '/api/ops/call/leave', {}).then(function (r) { call.members = r.members || []; renderCall(); }, function () {});
  }
  function callMute() {
    call.muted = !call.muted;
    if (call.stream) call.stream.getAudioTracks().forEach(function (t) { t.enabled = !call.muted; });
    renderCall();
  }
  function renderCall() {
    var box = $('#team-call'), here = state.view === 'team' && team.peer === 0, n = (call.members || []).length;
    box.hidden = !here || state.viewer;
    box.textContent = '';
    if (!box.hidden) {
      var t = el('div', 'team-call-who');
      t.appendChild(el('b', '', call.on ? '🎙 通話中（' + n + '人）' : n ? '🎙 ' + n + '人が通話中' : '🎙 全体チャットの通話'));
      t.appendChild(el('small', '', n ? call.members.map(function (m) {
        var p = call.peers[m.id];
        return m.name + (p && p.state !== 'connected' && p.state !== 'new' ? '（' + (p.state === 'connecting' ? '接続中' : p.state === 'failed' ? '接続できません' : p.state) + '）' : '');
      }).join('・') : '人数・時間の制限なし・高音質（128kbps）'));
      box.appendChild(t);
      function btn(label, act, cls) {
        var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label);
        b.type = 'button';
        b.dataset.call = act;
        box.appendChild(b);
      }
      if (call.on) { btn(call.muted ? 'マイクをオン' : 'マイクをミュート', 'mute', call.muted ? 'warn' : ''); btn('退出', 'leave', 'danger'); }
      else btn(call.joining ? '参加中…' : '通話に参加', 'join', 'primary');
    }
    // elsewhere on the site: a small reminder that the call goes on
    var pill = $('#call-pill');
    pill.hidden = !call.on || here;
    pill.textContent = '';
    if (!pill.hidden) {
      var go = el('button', 'call-pill-go', '🎙 通話中 ' + n + '人' + (call.muted ? '（ミュート）' : ''));
      go.type = 'button';
      go.dataset.call = 'open';
      var out = el('button', 'call-pill-out', '退出');
      out.type = 'button';
      out.dataset.call = 'leave';
      pill.appendChild(go);
      pill.appendChild(out);
    }
  }
  function onCallButtons(e) {
    var b = e.target.closest('[data-call]');
    if (!b) return;
    var a = b.dataset.call;
    if (a === 'join') callJoin();
    else if (a === 'leave') callLeave();
    else if (a === 'mute') callMute();
    else if (a === 'open') { setView('team'); setTimeout(function () { openTeam(0); }, 200); }
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

  /* ------------------------------------------------------------ セキュリティ --- */
  function loadSecurity(quiet) {
    return request('GET', '/api/ops/security').then(function (r) {
      state.security = r;
      if (state.view === 'security') renderSecurity(r);
      // the tab badge: blocks in force
      var n = (r.shield && r.shield.blocks ? r.shield.blocks.length : 0);
      setCount('security', n);
    }, function (err) { if (!quiet) fail(err); });
  }
  function secStat(box, label, value, cls) {
    var s = el('div', 'stat' + (cls ? ' ' + cls : ''));
    s.appendChild(el('span', '', label));
    s.appendChild(el('b', '', value));
    box.appendChild(s);
  }
  function renderSecurity(r) {
    var sh = r.shield || {}, em = r.emergency || {}, m = sh.last5m || {}, p = sh.pressure || {};
    $('#sec-at').textContent = '最終更新 ' + stamp(Date.now()).slice(11);
    var live = $('#sec-live'); live.textContent = '';
    secStat(live, 'リクエスト（5分）', fmt(m.requests || 0));
    secStat(live, '攻撃（5分）', fmt(m.attacks || 0), (m.attacks || 0) ? 'hot' : '');
    secStat(live, 'フラッド（5分）', fmt(m.floods || 0), (m.floods || 0) ? 'hot' : '');
    secStat(live, 'ログイン失敗（5分）', fmt(m.authFails || 0), (m.authFails || 0) ? 'warn' : '');
    secStat(live, 'ブロック中', fmt((sh.blocks || []).length), (sh.blocks || []).length ? 'warn' : '');
    secStat(live, '攻撃元アドレス', (p.attackers || 0) + '/' + (p.breachAt || 8), (p.attackers || 0) ? 'warn' : '');

    // the lockdown card (every operator can raise or lift it)
    var lc = $('#sec-lockcard'); lc.textContent = '';
    lc.appendChild(el('h3', '', '緊急システム・ロックダウン'));
    var state2 = em.level === 'lockdown' ? 'ロックダウン中' : em.level === 'stop' ? '緊急停止中' : 'ふだんどおり';
    lc.appendChild(el('p', 'muted', em.level ? (state2 + '（' + stamp(em.at) + '〜・' + (em.reason || '') + '）' + (em.releaseAt ? '・自動解除 ' + stamp(em.releaseAt) : '')) : 'ふだんどおり動いています。防御が突破されたと判断したときの最終手段です。'));
    var acts = el('div', 'acts');
    if (em.level === 'lockdown') {
      var rel = el('button', 'btn danger solid small', 'ロックダウンを解除'); rel.type = 'button'; rel.dataset.secRelease = '1'; acts.appendChild(rel);
    } else {
      var go = el('button', 'btn danger small', 'ロックダウンを発動'); go.type = 'button'; go.dataset.secLockdown = '1'; acts.appendChild(go);
    }
    var open = el('a', 'btn small', 'security HOME を開く'); open.href = '/sec/'; open.target = '_blank'; open.rel = 'noopener'; acts.appendChild(open);
    lc.appendChild(acts);
    lc.appendChild(el('p', 'muted', 'ロックダウン中は全ユーザー（プレイヤー・運営者・開発者）が締め出され、外部通信を遮断、ログ以外を停止します。最長1か月で自動解除。'));

    // the blocks in force
    var bl = $('#sec-blocks'); bl.textContent = '';
    bl.appendChild(el('h3', '', 'ブロック中 ' + ((sh.blocks || []).length ? '（' + (sh.blocks || []).length + '）' : '')));
    if (!(sh.blocks || []).length) bl.appendChild(el('p', 'muted', 'ブロック中のものはありません'));
    (sh.blocks || []).slice(0, 60).forEach(function (b) {
      var row = el('div', 'sec-row');
      row.appendChild(el('span', 'sec-tag ' + b.scope, b.scope === 'ip' ? 'IP' : b.scope === 'account' ? 'アカウント' : '端末'));
      row.appendChild(el('span', 'sec-target', b.target));
      if (b.manual) row.appendChild(el('span', 'sec-tag manual', '手動'));
      row.appendChild(el('span', 'sec-why', (b.reason || '') + (b.until ? '｜あと' + Math.max(1, Math.round((b.until - Date.now()) / 60000)) + '分' : '｜解除まで')));
      var un = el('button', 'btn ghost small', '解除'); un.type = 'button'; un.dataset.unblock = b.key; row.appendChild(un);
      bl.appendChild(row);
    });

    // the addresses with the highest threat score
    var at = $('#sec-attackers'); at.textContent = '';
    at.appendChild(el('h3', '', '脅威スコアの高いアドレス'));
    var tops = (sh.topAttackers || []).filter(function (x) { return x.score > 0; });
    if (!tops.length) at.appendChild(el('p', 'muted', '脅威は検知されていません'));
    tops.slice(0, 15).forEach(function (x) {
      var row = el('div', 'sec-row');
      row.appendChild(el('span', 'sec-target', x.ip));
      if (x.flags && x.flags.length) row.appendChild(el('span', 'sec-why', x.flags.join('・')));
      row.appendChild(el('span', 'sec-score', 'スコア ' + fmt(x.score)));
      var bk = el('button', 'btn ghost small', 'ブロック'); bk.type = 'button'; bk.dataset.blockIp = x.ip; row.appendChild(bk);
      at.appendChild(row);
    });
  }
  function secBlock(scope, target, reason) {
    return request('POST', '/api/ops/security/block', { scope: scope, target: target, reason: reason }).then(function () { toast('ブロックしました'); loadSecurity(); }, fail);
  }
  function secUnblock(key) {
    return request('POST', '/api/ops/security/unblock', { key: key }).then(function () { toast('解除しました'); loadSecurity(); }, fail);
  }
  function secLockdown() {
    ask({ title: 'ロックダウンを発動しますか？', text: '全ユーザー（プレイヤー・運営者・開発者）が締め出され、外部通信を遮断、ログ以外を停止します。重要データを保護し、攻撃情報を緊急ログに記録します。最長1か月で自動解除、運営者はいつでも手動で解除できます。', input: { label: '理由（任意）' }, ok: '発動する', danger: true }).then(function (reason) {
      if (reason === null) return;
      request('POST', '/api/sec/lockdown', { reason: reason }).then(function () { showEmergency({ lockdown: true }); }, fail);
    }).catch(fail);
  }
  function secRelease() {
    ask({ title: 'ロックダウンを解除しますか？', text: '原因を確認してから解除してください。サーバーが通常に戻ります。', ok: '解除する', danger: true }).then(function (ok) {
      if (ok === null) return;
      request('POST', '/api/sec/release', {}).then(function () { toast('解除しました'); loadSecurity(); }, fail);
    }).catch(fail);
  }

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
    srvUsage(r);
    srvPlan(r);
    srvBill(r);
    srvBreakdown(r);
    srvDb(r);
    srvVault(r);
    srvCloudflare(r);
    srvDiscord(r);
    srvMachine(r);
  }
  // how full the month's allowances are: the サーバー tab (and its button in the
  // bar, seen from every tab) turns green past 10%, blue 30%, purple 50%, red 70%
  var USAGE_TIERS = ['green', 'blue', 'purple', 'red'];
  var USAGE_NAMES = { green: '10%超', blue: '30%超', purple: '50%超', red: '70%超' };
  function paintUsageTab(tier) {
    var tab = document.querySelector('.tab[data-view="server"]');
    if (!tab) return;
    USAGE_TIERS.forEach(function (t) { tab.classList.remove('usage-' + t); });
    if (tier) tab.classList.add('usage-' + tier);
  }
  function srvUsage(r) {
    var e = r.estimate || {}, box = $('#srv-usage'), tier = e.usageTier || '';
    paintUsageTab(tier);
    if (!box) return;
    box.className = 'srv-usage' + (tier ? ' tier-' + tier : '');
    box.textContent = '';
    box.appendChild(el('b', '', '今月のサーバー使用量 ' + (Number(e.usagePercent) || 0).toFixed(1) + '%'));
    if (tier) box.appendChild(el('span', 'srv-usage-tier', USAGE_NAMES[tier]));
    var p = e.usagePeak;
    box.appendChild(el('small', 'muted', p ? 'いちばん多い項目：' + p.label + '（込みの分の ' + p.percent.toFixed(1) + '%）' : 'まだ使用量がありません'));
  }
  // where this month's sent bytes went: play, the screen view / 観戦 stream, call signalling
  function srvBreakdown(r) {
    var card = $('#srv-breakdown');
    if (!card) return;
    var b = (r.breakdown && r.breakdown.month) || { game: 0, video: 0, voice: 0, total: 0 };
    var t = (r.breakdown && r.breakdown.today) || { game: 0, video: 0, voice: 0, total: 0 };
    var whole = b.game + b.video + b.voice;
    var share = function (n) { return whole ? n / whole : 0; };
    var pct = function (n) { return whole ? ' ・' + (n / whole * 100).toFixed(1) + '%' : ''; };
    srvCard(card, '通信量の内訳（今月）', [
      ['映像通信（画面を見る・観戦）', bytes(b.video) + pct(b.video), share(b.video)],
      ['プレイヤーの処理（ゲーム・運営サイト）', bytes(b.game) + pct(b.game), share(b.game)],
      ['音声（通話の合図）', bytes(b.voice) + pct(b.voice), share(b.voice)],
      ['合計', bytes(whole)],
      ['今日（UTC）', '映像 ' + bytes(t.video) + '・処理 ' + bytes(t.game) + '・音声 ' + bytes(t.voice)]
    ], '通話の音声そのものは端末どうしで直接つながるため、サーバーを通るのは合図だけです。');
  }
  // the developer's Discord notices: on or not, and (the developer) a test
  function srvDiscord(r) {
    var d = r.discord || {}, card = $('#srv-discord');
    srvCard(card, 'Discord 通知', [['状態', d.on ? 'オン' : '未設定']], d.on
      ? '緊急停止・ロックダウン・攻撃元の自動ブロック・チャット停止・通報・報告／意見案・課金・開発者コードの間違い・運営権・バックアップの失敗・新しい版の反映を、Discord のチャンネルに送ります。'
      : 'Discord のチャンネルの Webhook の URL を、シークレット DISCORD_WEBHOOK_URL として入れるとオンになります（README「Discord に通知する」）。');
    if (!d.on || !state.developer) return;
    var b = el('button', 'btn small', 'テスト送信');
    b.type = 'button';
    b.addEventListener('click', function () {
      b.disabled = true;
      request('POST', '/api/ops/discord/test', {}).then(function () { toast('Discord に送りました'); }, fail).then(function () { b.disabled = false; });
    });
    card.appendChild(b);
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
    var s = v.shared || { files: 0, bytes: 0, vaults: 0, free: GB, requests: 0 };
    var rows = [
      ['保存先', v.store === 'bucket' ? 'R2' : 'データベース'],
      ['使用量（全体）', bytes(v.used) + ' / ' + bytes(v.maxBytes), v.used / v.maxBytes],
      ['1ファイルの上限', bytes(v.fileBytes) + '（' + bytes(v.piece) + 'ずつ送信）'],
      ['開発者専用保管庫', fmt(v.files) + '件（実装済み ' + fmt(v.implemented) + '件）・フォルダ ' + fmt(v.folders) + '個'],
      ['共有保管庫（運営者どうし）', fmt(s.vaults) + 'つで ' + fmt(s.files) + '件・' + bytes(s.bytes) + '（1人 ' + bytes(s.free) + 'まで・超えるには開発者の承認' + (s.requests ? '・申請 ' + fmt(s.requests) + '件' : '') + '）']
    ];
    if (v.inDb) rows.push(['データベースに残っている部分', fmt(v.inDb) + '（保管庫を開くと R2 へ移ります）']);
    srvCard($('#srv-vault'), '保管庫', rows, (v.store === 'bucket' ? '' : 'R2 をつなぐと 50GB になります（README「保管庫を R2 につなぐ」）。') + '開発者専用保管庫と共有保管庫は同じ容量を使います。');
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

  /* ------------------------------------------------------------ 保管庫 --- */
  /* The developer's own vault (their login shows it; the developer code lets
     them change it for 30 minutes), the backups they keep of any file, the
     vaults operators share (one for every two of them) and each operator's
     own: private, and their login is enough; the developer looks into every
     one (no changes). One room for all of them; what an operator keeps is 1GB
     until the developer approves more (with the limit they set). A file opens
     with a tap on its icon; everything else is in its ⋯ menu (or a right
     click, a long press), its 詳細 and its 💬. Files and folders are checked
     to move, download, back up or delete several at once (Shift: a range). */
  var vaultTimer = 0, moving = 0, v3d = null, viewing = null, viewUrl = '', pics = {}, vaultSig = '', lastPick = null, shown = {};
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
  // Visible cards show the model without opening the icon. Offscreen cards
  // release their meshes; two downloads at a time, one WebGL renderer total.
  var inline3dSession = null;
  function stopInline3d() {
    var s = inline3dSession;
    if (!s) return;
    s.alive = false;
    if (s.observer) s.observer.disconnect();
    s.items.forEach(function (i) { if (i.view) i.view.stop(); });
    if (s.gallery) s.gallery.stop();
    inline3dSession = null;
  }
  function inline3dEl(f) {
    if (!inline3dSession) inline3dSession = { alive: true, items: [], loading: 0, gallery: null, observer: null };
    var box = el('div', 'vault-inline3d'), model = el('div', 'vault-inline3d-model');
    var note = el('small', 'muted', '3Dを読み込み中…');
    box.appendChild(model);
    box.appendChild(note);
    inline3dSession.items.push({ file: f, box: box, host: model, note: note, visible: false, loading: false, failed: false, view: null });
    return box;
  }
  function watchInline3d() {
    var s = inline3dSession;
    if (!s || !s.alive) return;
    s.items = s.items.filter(function (i) {
      if (i.box.isConnected) return true;
      if (i.view) i.view.stop();
      if (s.observer) s.observer.unobserve(i.box);
      return false;
    });
    if (!s.observer && window.IntersectionObserver) s.observer = new IntersectionObserver(function (changes) {
      changes.forEach(function (c) {
        var i = s.items.filter(function (x) { return x.box === c.target; })[0];
        if (!i) return;
        i.visible = c.isIntersecting;
        if (!i.visible && i.view) { i.view.stop(); i.view = null; }
      });
      pumpInline3d(s);
    });
    s.items.forEach(function (i) {
      if (s.observer) s.observer.observe(i.box);
      else i.visible = true;
    });
    pumpInline3d(s);
  }
  function pumpInline3d(s) {
    if (!s.alive || state.view !== 'vault') return;
    s.items.forEach(function (i) {
      if (s.loading >= 2 || !i.visible || i.loading || i.failed || i.view || !i.box.isConnected) return;
      i.loading = true;
      s.loading++;
      var src = lightOf(i.file) || i.file;
      Promise.all([vault3d(), fetchFile(src, null)]).then(function (r) {
        if (!s.alive || !i.visible || !i.box.isConnected) return null;
        if (!s.gallery) s.gallery = r[0].gallery();
        return r[1].arrayBuffer().then(function (buf) { return s.gallery.add(i.host, buf, src.name); });
      }).then(function (view) {
        if (!view) return;
        if (!s.alive || !i.visible || !i.box.isConnected) { view.stop(); return; }
        i.view = view;
        i.note.textContent = 'ドラッグで回転・2本指 / ホイールでズーム';
      }).catch(function () {
        i.failed = true;
        if (!s.alive || !i.box.isConnected) return;
        i.note.textContent = '3Dを表示できませんでした。アイコンから再試行できます。';
        if (i.file.preview) i.host.appendChild(picEl(i.file));
      }).then(function () { i.loading = false; s.loading--; if (s.alive) pumpInline3d(s); });
    });
  }
  var KINDS_3D = /\.(glb|gltf|obj|fbx|stl|ply)$/i;
  function is3d(name) { return KINDS_3D.test(String(name || '')); }
  // (the developer's ticket goes with every call while they may change things; an operator has none)
  function vreq(method, path, body) {
    return request(method, path, body, state.vault && state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : {}).catch(function (err) {
      if (err.code === 'vault_locked' && state.vault && state.vault.ticket) relock('閲覧のみに戻りました。変更するには「編集する」から開発者コードを入力してください');
      throw err;
    });
  }
  function mb(n) {
    if (!n) return '0MB';
    if (n >= 1073741824) return (n / 1073741824).toFixed(n >= 10737418240 ? 0 : 1) + 'GB';
    return n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
  }
  // 2GB, 1.5GB: a limit in the shared vaults (one under 1GB in MB)
  function gb(n) { return n >= GB ? Math.round(n / GB * 10) / 10 + 'GB' : mb(n); }
  // nothing of the vault kept (closed, or someone else logged in)
  function resetVault() {
    state.vault = null;
    state.vaultMemo = '';
    shown = {};
    closeComments();
    state.vaultSpaces = null;
    state.vaultInfo = null;
    state.vaultSpace = '';
    state.vaultFiles = [];
    state.vaultFolders = [];
    state.vaultFolder = '';
    state.vaultIn = '';
    state.vaultPicked = {};
    state.vaultPage = 0;
    state.vaultRev = { files: '', spaces: '', full: 0 };
    vaultSig = '';
    lastPick = null;
    clearTimeout(vaultTimer);
  }
  // the developer back to looking only (the code's 30 minutes over, or 閉じる)
  function relock(message) {
    clearTimeout(vaultTimer);
    if (!state.vault) return Promise.resolve();
    state.vault.ticket = '';
    state.vault.until = 0;
    if (message) toast(message);
    vaultSig = '';
    renderVault();
    return loadVault();
  }
  // the developer: the developer code lets them change things for 30 minutes
  function unlockVault() {
    withCode({ title: '保管庫を編集する', text: '開発者コードを入れると、30分間 保管庫を変更できます（それまでは閲覧のみです）。', ok: '編集する' }).then(function (code) {
      if (code === null) return null;
      return request('POST', '/api/vault/open', { code: code }).then(function (r) {
        if (!state.vault) return null;
        state.vault.ticket = r.ticket;
        state.vault.until = r.until;
        state.vault.hours = r.hours;
        clearTimeout(vaultTimer);
        vaultTimer = setTimeout(function () { relock('30分たったので閲覧のみに戻りました'); }, Math.max(1000, r.until - Date.now() - 5000));
        toast('30分間 編集できます');
        vaultSig = '';
        renewPasses();
        return loadVault();
      });
    }).catch(fail);
  }
  // the vaults one sees (no code needed to look): the developer's own first
  // (the developer), one's own (an operator)
  function openLook(quiet) {
    if (state.vault || openLook.busy) return Promise.resolve();
    openLook.busy = true;
    return request('GET', '/api/vault/spaces').then(function (sp) {
      if (state.vault) return null;
      state.vault = { ticket: '', until: 0, chunk: sp.pool.chunk, maxBytes: sp.pool.maxBytes, fileBytes: sp.pool.fileBytes, used: sp.pool.used, store: sp.pool.store, me: sp.me, hours: sp.hours };
      state.vaultSpaces = sp;
      state.vaultSpeed = sp.speed || null;
      state.vaultSpace = state.developer ? '' : sp.personal ? sp.personal.id : sp.spaces.length ? sp.spaces[0].id : '';
      renderVault();
      return loadVault();
    }, function (err) { if (!quiet) fail(err); }).then(function () { openLook.busy = false; });
  }
  // the vaults one sees and one's room, and the open one's files and folders
  // (`quiet`: from the timer, redrawn only when something changed). The
  // lists are light; from the timer the server only says "the same" while
  // nothing has changed (in full once a minute all the same).
  function loadVault(quiet) {
    if (!state.vault) return Promise.resolve();
    var space = state.vaultSpace, none = !space && !state.developer, rv = state.vaultRev;
    var cheap = quiet && Date.now() - rv.full < 60000 && rv.space === space;
    var q = function (path, rev) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 'rev=' + encodeURIComponent(rev); };
    var filesPath = '/api/vault/files' + (space ? '?space=' + encodeURIComponent(space) : '');
    return Promise.all([
      vreq('GET', cheap && rv.spaces ? q('/api/vault/spaces', rv.spaces) : '/api/vault/spaces'),
      none ? null : vreq('GET', cheap && rv.files ? q(filesPath, rv.files) : filesPath)
    ]).then(function (rs) {
      var sp = rs[0], r = rs[1];
      if (!state.vault || state.vaultSpace !== space) return;
      // (nothing changed: as it is)
      if (sp.same && (!r || r.same)) return;
      if (sp.same) sp = state.vaultSpaces;
      if (r && r.same) r = { space: state.vaultInfo, files: state.vaultFiles, folders: state.vaultFolders, all: state.vault.all, store: state.vault.store, rev: rv.files };
      rv.spaces = sp.rev || '';
      rv.files = r ? r.rev || '' : '';
      rv.space = space;
      if (!cheap) rv.full = Date.now();
      if (sp.speed) state.vaultSpeed = sp.speed;
      state.vaultSpaces = sp;
      if (sp.requests) setCount('vault', sp.requests.length);
      state.vault.used = sp.pool.used;
      state.vault.maxBytes = sp.pool.maxBytes;
      state.vault.me = sp.me;
      if (sp.inDb !== undefined) state.vault.inDb = sp.inDb;
      state.vaultInfo = r ? r.space : null;
      state.vaultFiles = r ? r.files || [] : [];
      state.vaultFolders = r ? r.folders || [] : [];
      if (r) { state.vault.all = r.all; state.vault.store = r.store; }
      // (the code's ticket no longer good: looking only)
      if (r && r.locked && state.vault.ticket) { state.vault.ticket = ''; clearTimeout(vaultTimer); }
      // (a folder that went: back to the top; checks on what went)
      if (state.vaultFolder && !folderOf(state.vaultFolder)) state.vaultFolder = '';
      Object.keys(state.vaultPicked).forEach(function (id) { if (!fileOf(id) && !folderOf(id)) delete state.vaultPicked[id]; });
      // as it was: nothing redrawn (what is open on the page stays as it is)
      var sig = JSON.stringify([space, sp, state.vaultFiles, state.vaultFolders]);
      if (!quiet || sig !== vaultSig) { vaultSig = sig; renderVault(); }
      if (commentsFor) renderComments();
      toBucket();
      renderResume();
      roomCame();
    }, function (err) {
      // (a shared vault no longer there: back to the first one)
      var first = state.vaultSpaces && state.vaultSpaces.spaces[0], back = state.developer ? '' : first ? first.id : '';
      if (err && err.code === 'no_space' && state.vault && state.vaultSpace === space && back !== space) {
        state.vaultSpace = back;
        return loadVault();
      }
      if (!quiet) fail(err);
      return null;
    });
  }
  function fileOf(id) { return state.vaultFiles.filter(function (f) { return f.id === id; })[0] || null; }
  // another vault: from its top, nothing checked
  function goSpace(id) {
    if (!state.vault) return;
    if (id === state.vaultSpace) { goTop(); return; }
    state.vaultRev.full = 0;
    state.vaultSpace = id;
    state.vaultIn = '';
    state.vaultInfo = null;
    state.vaultFiles = [];
    state.vaultFolders = [];
    state.vaultFolder = '';
    state.vaultPage = 0;
    clearPicks();
    setShow('all');
    vaultSig = '';
    renderVault();
    loadVault();
  }
  // すべて / 未実装 / 実装済み (the developer's vault)
  function setShow(v) {
    state.vaultShow = v;
    Array.prototype.forEach.call(document.querySelectorAll('#vault-filter .chip'), function (x) { x.classList.toggle('on', x.dataset.vf === v); });
  }
  // pieces kept in the database before R2 move into it while the vault is open
  var toBucketJob = null;
  function toBucket() {
    if (!state.vault || !state.vault.ticket || state.vault.store !== 'bucket' || !state.vault.inDb || toBucketJob) return;
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
  // the open vault's name at the top of its folders
  function kindNow() { return state.vaultInfo ? state.vaultInfo.kind : state.vaultSpace === 'backup' ? 'backup' : ''; }
  function rootName() { var k = kindNow(); return k === 'backup' ? 'バックアップ' : k === 'own' ? '個人保管庫' : k === 'pair' ? '共有保管庫' : '保管庫'; }
  function pathName(id) { return [rootName()].concat(trail(id).map(function (d) { return d.name; })).join(' / '); }
  function byName(a, b) { return a.name.localeCompare(b.name, 'ja'); }
  // the files of a folder (not the ones inside a file there; the backups:
  // every file at once, wherever it is)
  function filesIn(id) {
    var flat = state.vaultSpace === 'backup';
    return state.vaultFiles.filter(function (f) { return !f.parent && (flat || ((f.folder || '') === id && !f.inside)); });
  }
  /* files in a file: the ones in it (and in them), the files from the
     outermost down to `id`, and the list shown now (a file's, or a folder's) */
  function inFile(id) { return state.vaultFiles.filter(function (f) { return !f.parent && f.inside === id; }); }
  function inFileAll(id, seen) {
    if ((seen || 0) > 8) return [];
    return inFile(id).reduce(function (all, f) { return all.concat([f], inFileAll(f.id, (seen || 0) + 1)); }, []);
  }
  function fileTrail(id) {
    var out = [];
    for (var f = fileOf(id); f && out.length < 10; f = f.inside ? fileOf(f.inside) : null) out.unshift(f);
    return out;
  }
  function listed() { return state.vaultIn ? inFile(state.vaultIn) : filesIn(state.vaultFolder); }
  // a file's inside open: the files in it (none: another file can be put in, or made here)
  function goInside(f) {
    state.vaultIn = f.id;
    state.vaultFolder = f.folder || '';
    clearPicks();
    state.vaultPage = 0;
    renderVault();
    scrollTop();
  }
  // the top of the vault open now (its icon, its name, the 保管庫 tab again)
  function goTop() {
    if (!state.vault) return;
    var was = state.vaultFolder || state.vaultIn;
    state.vaultFolder = '';
    state.vaultIn = '';
    clearPicks();
    state.vaultPage = 0;
    renderVault();
    scrollTop();
    if (was) toast(rootName() + 'のいちばん上に戻りました');
  }
  function foldersIn(id) { return state.vaultFolders.filter(function (d) { return d.parent === id; }).sort(byName); }
  // where something can go: the top and every folder (not the `skip` ones nor what is inside them)
  function places(skip) {
    var out = state.vaultFolders.filter(function (d) {
      return !trail(d.id).some(function (x) { return skip.indexOf(x.id) >= 0; });
    }).map(function (d) { return { value: d.id, label: pathName(d.id) }; });
    out.sort(function (a, b) { return a.label.localeCompare(b.label, 'ja'); });
    return [{ value: '', label: rootName() + '（いちばん上）' }].concat(out);
  }
  // what one may do in the open vault: change it (the developer only looks into the others')
  function canWrite() { return !!(state.vaultInfo && state.vaultInfo.write); }
  // a checkmark on a file or a folder
  function checkEl(id, name) {
    var label = el('label', 'vault-check'), box = el('input');
    box.type = 'checkbox';
    box.dataset.vpick = id;
    box.checked = !!state.vaultPicked[id];
    box.setAttribute('aria-label', name + ' を選択');
    label.appendChild(box);
    label.appendChild(el('i'));
    return label;
  }
  // the icon of an item (a tap opens it): a folder, an APK, any other file
  // (its extension written on it)
  function iconEl(type, name, ext) {
    var b = el('button', 'vicon vicon-' + type);
    b.type = 'button';
    b.dataset.vopen = '1';
    b.title = '開く';
    b.setAttribute('aria-label', name + ' を開く');
    var img = el('img');
    img.src = 'icons/' + type + '.svg';
    img.alt = '';
    img.draggable = false;
    b.appendChild(img);
    if (ext) b.appendChild(el('span', 'vicon-ext', ext));
    return b;
  }
  // the ⋯ of an item: everything that can be done with it
  function moreBtn(name) {
    var b = el('button', 'vbtn vmore', '⋯');
    b.type = 'button';
    b.dataset.vact = 'menu';
    b.title = 'メニュー';
    b.setAttribute('aria-label', name + ' のメニュー');
    b.setAttribute('aria-haspopup', 'menu');
    return b;
  }
  function folderCard(d) {
    var row = el('article', 'vitem vault-folder' + (state.vaultPicked[d.id] ? ' picked' : ''));
    row.dataset.folder = d.id;
    row.appendChild(checkEl(d.id, d.name));
    row.appendChild(iconEl('folder', d.name));
    var main = el('div', 'vitem-main');
    main.appendChild(el('b', 'vault-name', d.name));
    var n = filesIn(d.id).length + foldersIn(d.id).length;
    main.appendChild(el('small', 'vitem-sub', 'フォルダ・' + (n ? fmt(n) + '件' : '空')));
    row.appendChild(main);
    var acts = el('div', 'vitem-acts');
    acts.appendChild(moreBtn(d.name));
    row.appendChild(acts);
    return row;
  }
  function goFolder(id) {
    state.vaultFolder = id || '';
    state.vaultIn = '';
    clearPicks();
    state.vaultPage = 0;
    renderVault();
  }
  // what can be done with a folder (its ⋯, a right click)
  function folderMenu(d) {
    var items = [['開く', 'open']], write = canWrite();
    if (write) items.push(['名前を変更', 'rename'], ['移動', 'move']);
    if (state.developer && state.vault && state.vault.ticket) items.push(['中のファイルをすべてバックアップ', 'backup']);
    if (write) items.push(['削除', 'delete', 'danger']);
    return items;
  }
  function folderAct(d, act) {
    if (act === 'open') goFolder(d.id);
    else if (act === 'rename') renameFolder(d);
    else if (act === 'move') moveFolder(d);
    else if (act === 'backup') backupItems([], [d], true);
    else if (act === 'delete') deleteFolder(d);
  }
  // the path above the list (保管庫 / 車 / 新車): each a way back
  function onFolder(e) {
    var crumb = e.target.closest('.vault-crumb');
    if (!crumb) return;
    if (crumb.dataset.infile) { var f = fileOf(crumb.dataset.infile); if (f) goInside(f); }
    else goFolder(crumb.dataset.folder);
  }
  function named(v) { return v.trim() ? '' : '名前を入れてください'; }
  function newFolder() {
    ask({ title: 'フォルダを作る', text: '「' + pathName(state.vaultFolder) + '」の中に作ります。', ok: '作る', input: { label: 'フォルダの名前' }, check: named }).then(function (name) {
      if (name === null) return null;
      return vreq('POST', '/api/vault/folders', { name: name, parent: state.vaultFolder, space: state.vaultSpace }).then(function () { toast('フォルダを作りました'); return loadVault(); });
    }).catch(fail);
  }
  function renameFolder(d) {
    ask({ title: 'フォルダの名前を変更', ok: '変更する', input: { label: 'フォルダの名前', value: d.name }, check: named }).then(function (name) {
      if (name === null || name.trim() === d.name) return null;
      return vreq('POST', '/api/vault/folders/update', { id: d.id, name: name }).then(function () { toast('名前を変更しました'); return loadVault(); });
    }).catch(fail);
  }
  function moveFolder(d) {
    ask({ title: '「' + d.name + '」を移動', ok: '移動する', select: { label: '移動先', options: places([d.id]), value: d.parent } }).then(function (to) {
      if (to === null || to === d.parent) return null;
      return vreq('POST', '/api/vault/folders/update', { id: d.id, parent: to }).then(function () { toast('移動しました'); return loadVault(); });
    }).catch(fail);
  }
  function deleteFolder(d) {
    ask({ title: '本当に削除しますか？', text: 'フォルダ「' + d.name + '」を削除します。中のファイルとフォルダは消えずに、ひとつ上（' + pathName(d.parent) + '）へ移ります。', ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/folders/delete', { id: d.id }).then(function () {
        if (trail(state.vaultFolder).some(function (x) { return x.id === d.id; })) state.vaultFolder = d.parent;
        toast('フォルダを削除しました');
        return loadVault();
      });
    }).catch(fail);
  }

  /* the checkmarks: what is listed here (the folders, then the files of every
     page), checked one by one, a range with Shift, or all at once */
  function shownItems() {
    var show = state.vaultShow;
    return (state.vaultIn ? [] : foldersIn(state.vaultFolder)).map(function (d) { return d.id; }).concat(listed().filter(function (f) {
      return show === 'all' || (show === 'used') === !!f.implementedAt;
    }).map(function (f) { return f.id; }));
  }
  function pick(id, on) {
    if (on) state.vaultPicked[id] = folderOf(id) ? 'folder' : 'file';
    else delete state.vaultPicked[id];
  }
  function clearPicks() { state.vaultPicked = {}; lastPick = null; }
  function pickedFiles() { return state.vaultFiles.filter(function (f) { return state.vaultPicked[f.id] === 'file'; }); }
  function pickedFolders() { return state.vaultFolders.filter(function (d) { return state.vaultPicked[d.id] === 'folder'; }); }
  // a checkmark tapped (true: it was one)
  function onPick(e) {
    var box = e.target.closest('[data-vpick]');
    if (!box) return false;
    var id = box.dataset.vpick, ids = [id];
    if (e.shiftKey && lastPick && lastPick !== id) {
      var order = shownItems(), i = order.indexOf(lastPick), j = order.indexOf(id);
      if (i >= 0 && j >= 0) ids = order.slice(Math.min(i, j), Math.max(i, j) + 1);
    }
    ids.forEach(function (x) { pick(x, box.checked); });
    lastPick = id;
    renderPicks();
    return true;
  }
  function pickAll() {
    var all = shownItems(), every = all.length > 0 && all.every(function (id) { return state.vaultPicked[id]; });
    all.forEach(function (id) { pick(id, !every); });
    lastPick = null;
    renderPicks();
  }
  // the checks on the page as they are now (nothing else redrawn)
  function renderPicks() {
    Array.prototype.forEach.call(document.querySelectorAll('#vault-list [data-vpick], #vault-folders [data-vpick]'), function (b) {
      b.checked = !!state.vaultPicked[b.dataset.vpick];
      var card = b.closest('.card');
      if (card) card.classList.toggle('picked', b.checked);
    });
    renderPicked();
  }
  function renderPicked() {
    var all = shownItems(), ids = Object.keys(state.vaultPicked), n = ids.length;
    var dirs = ids.filter(function (id) { return state.vaultPicked[id] === 'folder'; }).length;
    var here = all.filter(function (id) { return state.vaultPicked[id]; }).length;
    var bar = $('#vault-select'), box = $('#vault-pick-all');
    bar.hidden = !state.vaultInfo || !all.length;
    bar.classList.toggle('on', n > 0);
    box.checked = all.length > 0 && here === all.length;
    box.indeterminate = here > 0 && here < all.length;
    $('#vault-picked-n').textContent = n
      ? fmt(n) + '件を選択中' + (dirs ? '（フォルダ ' + fmt(dirs) + (n > dirs ? '・ファイル ' + fmt(n - dirs) : '') + '）' : '')
      : 'すべて選択（' + fmt(all.length) + '件）';
    $('#vault-select-hint').hidden = n > 0;
    $('#vault-picked').hidden = !n;
    var backups = state.vaultSpace === 'backup';
    $('#vault-picked-move').hidden = !canWrite() || backups;
    $('#vault-picked-delete').hidden = !canWrite();
    $('#vault-picked-backup').hidden = !(state.developer && state.vault && state.vault.ticket) || backups;
  }
  // a file's place as words: 保管庫 / 車 / model.glb
  function fileWhere(f) { return pathName(f.folder || '') + ' / ' + fileTrail(f.id).map(function (x) { return x.name; }).join(' / '); }
  // the files something can go into: any file of the vault (not a light copy,
  // not one being moved nor one inside those), as 'f:<id>'
  function fileTargets(files) {
    var skip = {};
    files.forEach(function (f) { skip[f.id] = true; inFileAll(f.id).forEach(function (x) { skip[x.id] = true; }); });
    return state.vaultFiles.filter(function (f) { return !f.parent && !skip[f.id] && f.space !== 'backup' && fileTrail(f.id).length < 8; })
      .map(function (f) { return { value: 'f:' + f.id, label: '📄 ' + fileWhere(f) + ' の中' }; })
      .sort(function (a, b) { return a.label.localeCompare(b.label, 'ja'); });
  }
  // files and folders (the checked ones, or one file) into a folder; files
  // only, into a file too
  function moveItems(files, dirs) {
    var n = files.length + dirs.length;
    if (!n) return;
    var skip = dirs.map(function (d) { return d.id; });
    var options = places(skip).concat(dirs.length ? [] : fileTargets(files));
    ask({ title: fmt(n) + '件を移動', text: dirs.length ? '' : 'フォルダのほか、ほかのファイルの中（📄）にも移せます。', ok: '移動する', select: { label: '移動先', options: options, value: state.vaultIn ? 'f:' + state.vaultIn : state.vaultFolder } }).then(function (to) {
      if (to === null) return null;
      var into = to.indexOf('f:') === 0 ? to.slice(2) : '';
      var body = { ids: files.map(function (f) { return f.id; }), folders: skip };
      if (into) body.into = into; else body.folder = to;
      return vreq('POST', '/api/vault/move', body).then(function (r) {
        clearPicks();
        toast(fmt(r.moved) + '件を' + (into ? '「' + (fileOf(into) || { name: '' }).name + '」の中' : '「' + pathName(to) + '」') + 'へ移動しました');
        return loadVault();
      });
    }).catch(fail);
  }
  // every file in a folder and in the folders inside it (and the files in those files)
  function filesUnder(id) {
    var here = filesIn(id).reduce(function (all, f) { return all.concat([f], inFileAll(f.id)); }, []);
    return foldersIn(id).reduce(function (all, d) { return all.concat(filesUnder(d.id)); }, here);
  }
  // the checked files, and the files in the checked folders: saved one after another
  function downloadItems(files, dirs) {
    var seen = {};
    var list = dirs.reduce(function (all, d) { return all.concat(filesUnder(d.id)); }, files).filter(function (f) {
      if (seen[f.id] || !f.done) return false;
      seen[f.id] = true;
      return true;
    });
    if (!list.length) { toast('ダウンロードできるファイルがありません（アップロード途中のものは除きます）'); return; }
    (list.length > 1
      ? ask({ title: fmt(list.length) + '件をダウンロード', text: '1件ずつ順に保存します' + (dirs.length ? '（フォルダの中のファイルも含みます）' : '') + '。ブラウザに複数のファイルのダウンロードを確かめられたら「許可」してください。', ok: 'ダウンロード' })
      : Promise.resolve(true)
    ).then(function (ok) {
      if (!ok) return null;
      return list.reduce(function (p, f) { return p.then(function () { return download(f); }); }, Promise.resolve());
    }).catch(fail);
  }
  // the checked files go (for good, unless the developer backed them up);
  // the checked folders go, what is in them moves up
  function deleteItems(files, dirs) {
    if (state.vaultSpace === 'backup') files = files.filter(function (f) { return f.space === 'backup'; });
    var n = files.length + dirs.length;
    if (!n) { toast('バックアップでは、保管庫から削除されたファイルだけを削除できます'); return; }
    var size = files.reduce(function (s, f) { return s + f.size; }, 0), kept = files.filter(function (f) { return f.backup && f.space !== 'backup'; }).length, text = [];
    if (state.vaultSpace === 'backup') text.push('ファイル ' + fmt(files.length) + '件（' + mb(size) + '）をバックアップから完全に削除します（元に戻せません）。');
    else if (files.length) {
      text.push('ファイル ' + fmt(files.length) + '件（' + mb(size) + '）を削除します。' + (kept < files.length ? '保管庫から完全に消えます（元に戻せません）。' + (state.vaultSpace ? '' : 'リンクも使えなくなります。') : ''));
      if (kept) text.push('そのうち ' + fmt(kept) + '件は開発者のバックアップに残ります。');
    }
    if (dirs.length) text.push('フォルダ ' + fmt(dirs.length) + '個は削除され、中のファイルとフォルダは消えずにひとつ上へ移ります。');
    if (files.some(function (f) { return inFile(f.id).length; })) text.push('ファイルの中に入っているファイルは消えずに、ひとつ上へ移ります。');
    ask({ title: '本当に削除しますか？', text: fmt(n) + '件を削除します。\n' + text.join('\n'), ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return (files.length ? vreq('POST', '/api/vault/delete', { ids: files.map(function (f) { return f.id; }) }) : Promise.resolve()).then(function () {
        return dirs.length ? vreq('POST', '/api/vault/folders/delete', { ids: dirs.map(function (d) { return d.id; }) }) : null;
      }).then(function () {
        clearPicks();
        toast(fmt(n) + '件を削除しました');
        return loadVault();
      }, function (err) { fail(err); return loadVault(); });
    }).catch(fail);
  }

  // the developer backs up files (and every file in folders) of any vault;
  // `on` false: no longer
  function backupItems(files, dirs, on) {
    if (!files.length && !dirs.length) return;
    vreq('POST', '/api/vault/backup', { ids: files.map(function (f) { return f.id; }), folders: dirs.map(function (d) { return d.id; }), on: on }).then(function (r) {
      clearPicks();
      toast(r.changed ? fmt(r.changed) + '件を' + (on ? 'バックアップしました' : 'バックアップから外しました') : on ? 'もうバックアップしてあります' : 'バックアップしたものはありません');
      return loadVault();
    }).catch(fail);
  }
  // a file deleted from its vault goes back there from the backups
  function restoreBackup(f) {
    var from = f.backup && f.backup.removed ? f.backup.removed.where : '保管庫';
    ask({ title: '元の場所に戻しますか？', text: '「' + f.name + '」を' + from + 'に戻します（フォルダがなくなっていれば、いちばん上に戻ります）。バックアップはそのまま残ります。', ok: '戻す' }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/backups/restore', { id: f.id }).then(function (r) { toast(r.file.where + 'に戻しました'); return loadVault(); });
    }).catch(fail);
  }

  /* the vaults to choose from, one's room, whose the open one is */
  function renderSpaces() {
    var bar = $('#vault-spaces'), sp = state.vaultSpaces;
    bar.textContent = '';
    if (!sp) return;
    function what(x) { return x.files || x.folders ? fmt(x.files) + '件・' + mb(x.bytes) : '空'; }
    function chip(id, title, sub, cls) {
      var b = el('button', 'vspace' + (cls ? ' ' + cls : '') + (state.vaultSpace === id ? ' on' : ''));
      b.type = 'button';
      b.dataset.space = id;
      var t = el('span', 'vspace-who');
      t.appendChild(el('b', '', title));
      t.appendChild(el('small', '', sub));
      b.appendChild(t);
      bar.appendChild(b);
      return b;
    }
    if (state.developer) {
      var own = chip('', '開発者専用保管庫', what(sp.own), 'own');
      own.insertBefore(el('span', 'face vspace-mark', '開'), own.firstChild);
      var b = sp.backups || { files: 0, removed: 0, bytes: 0 };
      var bk = chip('backup', 'バックアップ', b.files ? fmt(b.files) + '件' + (b.removed ? '（削除済み ' + fmt(b.removed) + '）' : '') : '空', 'own');
      bk.insertBefore(el('span', 'face vspace-mark vspace-backup', '控'), bk.firstChild);
    } else if (sp.personal) {
      var mine = chip(sp.personal.id, 'あなたの個人保管庫', what(sp.personal), 'own');
      mine.insertBefore(face(sp.personal.owner || { name: state.name || '自' }), mine.firstChild);
    }
    if (sp.spaces.length) bar.appendChild(el('span', 'vspace-label', '共有保管庫（非公開・運営者ふたりごと）'));
    sp.spaces.forEach(function (x) {
      var b = chip(x.id, x.with.name + ' と共有', (x.with.operator ? '' : '運営者ではありません・') + what(x), x.with.operator ? '' : 'gone');
      b.insertBefore(face(x.with), b.firstChild);
      if (x.with.developer) b.querySelector('b').appendChild(el('span', 'tag maker', '開発者'));
    });
    if (sp.others && sp.others.length) {
      bar.appendChild(el('span', 'vspace-label', '運営者の保管庫（開発者だけ・閲覧のみ）'));
      sp.others.forEach(function (x) { chip(x.id, x.personal ? x.members[0].name + ' の個人保管庫' : x.members.map(function (m) { return m.name; }).join(' ⇄ '), what(x), 'look'); });
    }
  }
  function meterEl(used, limit) {
    var r = limit ? used / limit : 0;
    var m = el('span', 'meter' + (r >= 0.95 ? ' hot' : r >= 0.8 ? ' warm' : '')), i = el('i');
    i.style.width = Math.min(100, r * 100).toFixed(1) + '%';
    m.appendChild(i);
    return m;
  }
  function roomBtn(label, act, cls, data) {
    var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.dataset.room = act;
    Object.keys(data || {}).forEach(function (k) { b.dataset[k] = String(data[k]); });
    return b;
  }
  function renderRoom() {
    var box = $('#vault-room'), sp = state.vaultSpaces;
    box.textContent = '';
    box.hidden = !sp || !state.vault;
    if (box.hidden) return;
    if (state.developer) roomOfAll(box, sp); else roomOfMine(box, sp.me, sp.pool);
  }
  // an operator: what they keep in the shared vaults, their limit, their request
  function roomOfMine(box, me, pool) {
    var head = el('div', 'card-head');
    head.appendChild(el('b', '', '保管庫であなたが使える容量'));
    head.appendChild(el('span', 'time', me.approved ? '開発者が承認した上限（' + date(me.approved.at) + '）' : '標準（1人 ' + gb(me.free) + '）'));
    box.appendChild(head);
    var line = el('div', 'vroom-line');
    line.appendChild(el('b', '', mb(me.used) + ' / ' + gb(me.limit)));
    line.appendChild(meterEl(me.used, me.limit));
    box.appendChild(line);
    box.appendChild(el('p', 'muted vroom-note', 'あなたが送ったファイルの合計です（個人保管庫とどの共有保管庫の分も）。'
      + (me.approved ? '開発者が承認した上限まで保存できます（もっと必要なら、また申請できます）。' : gb(me.free) + 'を超えて保存するには、開発者の承認と上限の設定が必要です。')
      + '容量は開発者専用保管庫と共有です（保管庫全体の空き ' + mb(Math.max(0, pool.maxBytes - pool.used)) + '）。'));
    var a = el('div', 'acts');
    if (me.request) {
      a.appendChild(el('span', 'kind idea', '申請中：' + gb(me.request.bytes) + '（' + date(me.request.at, true) + '）'));
      if (me.request.reason) a.appendChild(el('span', 'muted vroom-why', '理由：' + me.request.reason));
      a.appendChild(roomBtn('申請を取り下げる', 'cancel', 'ghost'));
    } else {
      a.appendChild(roomBtn(me.approved ? 'さらに容量を申請' : '容量を申請', 'request', 'primary'));
      if (me.last) a.appendChild(el('span', 'kind ' + (me.last.status === 'approved' ? 'accepted' : 'rejected'), me.last.status === 'approved'
        ? '承認されました：上限 ' + gb(me.last.limit) + '（' + date(me.last.handledAt, true) + '）' : '前回の申請（' + gb(me.last.bytes) + '）は見送られました（' + date(me.last.handledAt, true) + '）'));
    }
    box.appendChild(a);
  }
  // the developer: the room of all the vaults, the requests, each operator's use and limit
  function roomOfAll(box, sp) {
    var head = el('div', 'card-head');
    head.appendChild(el('b', '', '容量の管理'));
    head.appendChild(el('span', 'time', '運営者は1人 ' + gb(sp.pool.free) + 'まで（共有・個人保管庫の合計。超えるには承認と上限の設定）'));
    box.appendChild(head);
    var shared = sp.spaces.concat(sp.others || []).reduce(function (s, x) { return s + x.bytes; }, 0);
    var line = el('div', 'vroom-line');
    line.appendChild(el('b', '', '保管庫全体 ' + mb(sp.pool.used) + ' / ' + mb(sp.pool.maxBytes)));
    line.appendChild(meterEl(sp.pool.used, sp.pool.maxBytes));
    box.appendChild(line);
    box.appendChild(el('p', 'muted vroom-note', '開発者専用保管庫 ' + mb(sp.own.bytes) + '・共有保管庫と個人保管庫 ' + mb(shared) + (sp.backups && sp.backups.bytes ? '・バックアップだけに残っているもの ' + mb(sp.backups.bytes) : '') + '（同じ容量を使います）。'));
    if (sp.requests.length) {
      box.appendChild(el('h4', 'vroom-sub', '容量の申請（' + fmt(sp.requests.length) + '件）'));
      sp.requests.forEach(function (r) {
        var p = sp.people.filter(function (x) { return x.id === r.user.id; })[0] || { used: 0, limit: sp.pool.free };
        var row = el('div', 'vroom-req');
        row.appendChild(face(r.user));
        var t = el('div', 'vroom-who');
        t.appendChild(el('b', '', r.user.name + '：' + gb(r.bytes) + ' を希望'));
        t.appendChild(el('small', '', '使用 ' + mb(p.used) + ' / ' + gb(p.limit) + '・' + date(r.at, true)));
        if (r.reason) t.appendChild(el('small', 'vroom-why', '理由：' + r.reason));
        row.appendChild(t);
        row.appendChild(roomBtn('承認して上限を決める', 'approve', 'primary', { id: r.id, bytes: r.bytes, name: r.user.name }));
        row.appendChild(roomBtn('見送る', 'decline', 'ghost', { id: r.id, name: r.user.name }));
        box.appendChild(row);
      });
    }
    if (sp.people.length) {
      box.appendChild(el('h4', 'vroom-sub', '運営者ごとの使用量（送ったファイルの合計）'));
      var t = el('table', 'srv-table vroom-people');
      sp.people.forEach(function (p) {
        var tr = el('tr'), th = el('th', '', p.name), td = el('td'), go = el('td', 'num');
        if (!p.operator) th.appendChild(el('small', '', '（運営者ではありません）'));
        td.appendChild(el('span', '', mb(p.used) + ' / ' + gb(p.limit) + (p.approved ? '（承認済みの上限・' + date(p.approved.at) + '）' : '（標準）')));
        td.appendChild(meterEl(p.used, p.limit));
        go.appendChild(roomBtn('上限を変更', 'limit', 'ghost', { user: p.id, name: p.name, limit: p.limit }));
        tr.appendChild(th);
        tr.appendChild(td);
        tr.appendChild(go);
        t.appendChild(tr);
      });
      box.appendChild(t);
    }
  }
  // a number of GB from a dialog, between `low` (not included unless `andLow`) and `high`
  function gbIn(v, low, high, andLow) {
    var n = Number(String(v).trim());
    return isFinite(n) && (andLow ? n >= low : n > low) && n <= high ? n : null;
  }
  function onRoom(e) {
    var b = e.target.closest('[data-room]');
    if (!b || !state.vaultSpaces) return;
    var d = b.dataset, pool = state.vaultSpaces.pool, free = pool.free / GB, most = pool.maxBytes / GB;
    var range = gb(pool.free) + 'より大きく ' + gb(pool.maxBytes) + 'まで';
    if (d.room === 'request') {
      var me = state.vaultSpaces.me, now = me.limit / GB;
      ask({
        title: '共有保管庫の容量を申請',
        text: '今の上限は ' + gb(me.limit) + '（使用 ' + mb(me.used) + '）です。開発者が承認すると、開発者が決めた上限まで使えるようになります（希望より小さいこともあります）。',
        ok: '申請する',
        input: { label: '希望する上限（GB・' + gb(me.limit) + 'より大きく ' + gb(pool.maxBytes) + 'まで）', value: String(Math.min(most, Math.max(2, Math.ceil(now * 2)))) },
        area: { label: '理由（任意・開発者に届きます）' },
        check: function (v) { return gbIn(v, now, most) === null ? gb(me.limit) + 'より大きく ' + gb(pool.maxBytes) + 'までの数を入れてください' : ''; }
      }).then(function (v) {
        if (v === null) return null;
        return vreq('POST', '/api/vault/quota/request', { bytes: Math.round(gbIn(v.value, now, most) * GB), reason: v.text }).then(function () { toast('申請しました。開発者の承認を待っています'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'cancel') {
      ask({ title: '申請を取り下げますか？', ok: '取り下げる' }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/quota/cancel', {}).then(function () { toast('申請を取り下げました'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'approve') {
      ask({
        title: d.name + ' さんの申請を承認',
        text: '希望は ' + gb(Number(d.bytes)) + ' です。承認するには上限を決めてください（' + range + '）。上限はあとから「上限を変更」で変えられます。',
        ok: '承認する',
        input: { label: '上限（GB）', value: String(Math.min(most, Math.round(Number(d.bytes) / GB * 10) / 10)) },
        check: function (v) { return gbIn(v, free, most) === null ? range + 'の数を入れてください' : ''; }
      }).then(function (v) {
        if (v === null) return null;
        return vreq('POST', '/api/vault/quota/decide', { id: Number(d.id), approve: true, limit: Math.round(gbIn(v, free, most) * GB) }).then(function () { toast(d.name + ' さんの申請を承認しました'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'decline') {
      ask({ title: d.name + ' さんの申請を見送りますか？', text: '上限は今のままです（' + d.name + ' さんには「見送られました」と表示されます）。', ok: '見送る' }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/quota/decide', { id: Number(d.id), approve: false }).then(function () { toast('見送りました'); return loadVault(); });
      }).catch(fail);
    } else if (d.room === 'limit') {
      ask({
        title: d.name + ' さんの上限を変更',
        text: '今は ' + gb(Number(d.limit)) + ' です。' + gb(pool.free) + ' を入れると標準に戻ります（' + gb(pool.free) + 'を超える分には上限が必要です）。',
        ok: '変更する',
        input: { label: '上限（GB・' + gb(pool.free) + '〜' + gb(pool.maxBytes) + '）', value: String(Math.round(Number(d.limit) / GB * 10) / 10) },
        check: function (v) { return gbIn(v, free, most, true) === null ? gb(pool.free) + '〜' + gb(pool.maxBytes) + 'の数を入れてください' : ''; }
      }).then(function (v) {
        if (v === null) return null;
        var n = gbIn(v, free, most, true);
        return vreq('POST', '/api/vault/quota/set', { user: Number(d.user), limit: n <= free ? 0 : Math.round(n * GB) }).then(function () { toast(d.name + ' さんの上限を変更しました'); return loadVault(); });
      }).catch(fail);
    }
  }
  // the open vault: whose it is, and who sees it
  function renderHead() {
    var h = $('#vault-head'), info = state.vaultInfo, sp = state.vaultSpaces;
    h.textContent = '';
    if (!state.vault || !sp) return;
    var t = el('div', 'vault-head-text');
    var look = state.developer && !state.vault.ticket ? '閲覧のみ（変更するには右上の「編集する」から開発者コード）' : '';
    if (!info) {
      if (!state.developer && !sp.spaces.length && !sp.personal) t.appendChild(el('b', '', 'ほかの運営者がいないため、共有保管庫はまだありません'));
    } else if (info.kind === 'dev') {
      h.appendChild(el('span', 'face vspace-mark', '開'));
      t.appendChild(el('b', '', '開発者専用保管庫'));
      t.appendChild(el('small', '', look || '編集できます（' + stamp(state.vault.until).slice(11, 16) + 'まで）'));
    } else if (info.kind === 'backup') {
      h.appendChild(el('span', 'face vspace-mark vspace-backup', '控'));
      t.appendChild(el('b', '', 'バックアップ'));
      t.appendChild(el('small', '', '開発者がバックアップしたファイル（どの保管庫のものも）。保管庫から削除されても、ここに残ります' + (look ? '・' + look : '')));
    } else if (info.kind === 'own') {
      var owner = info.members[0];
      h.appendChild(face(owner));
      t.appendChild(el('b', '', info.mine ? 'あなたの個人保管庫' : owner.name + ' さんの個人保管庫'));
      t.appendChild(el('small', '', info.mine ? '非公開：あなたと開発者だけが見られます' : '閲覧のみ：開発者だけが見られます（変更はできません）'));
    } else {
      var mine = sp.spaces.filter(function (x) { return x.id === info.id; })[0];
      if (mine) {
        h.appendChild(face(mine.with));
        t.appendChild(el('b', '', mine.with.name + ' さんとの共有保管庫'));
        t.appendChild(el('small', '', !mine.with.operator ? '相手は運営者ではなくなりました（見る・整理・削除はできます。新しいファイルは入れられません）'
          : '非公開：' + (state.developer || mine.with.developer ? 'ふたりだけ' : 'ふたりと開発者だけ') + 'が見られます'));
      } else {
        info.members.forEach(function (m) { h.appendChild(face(m)); });
        t.appendChild(el('b', '', info.members.map(function (m) { return m.name + ' さん'; }).join(' ⇄ ') + 'の共有保管庫'));
        t.appendChild(el('small', '', '閲覧のみ：開発者だけが見られます（アップロード・変更・削除はできません）'));
      }
    }
    // (its icon: back to the top of it)
    Array.prototype.forEach.call(h.querySelectorAll('.face'), function (x) {
      x.classList.add('vault-home');
      x.dataset.vtop = '1';
      x.title = 'いちばん上に戻る';
      x.setAttribute('role', 'button');
      x.setAttribute('aria-label', 'この保管庫のいちばん上に戻る');
    });
    h.appendChild(t);
  }
  // how much is used (the rest when the mouse is on it)
  function vaultUsage() {
    var v = state.vault, u = $('#vault-usage');
    if (!v) { u.textContent = ''; u.title = ''; return; }
    if (!state.developer && v.me) {
      u.textContent = mb(v.me.used) + ' / ' + gb(v.me.limit);
      u.title = 'あなたの使用量（共有保管庫と個人保管庫の合計）・1ファイル ' + mb(v.fileBytes) + 'まで';
      return;
    }
    u.textContent = mb(v.used) + ' / ' + mb(v.maxBytes);
    u.title = '全体の使用量（すべての保管庫の合計）・1ファイル ' + mb(v.fileBytes) + 'まで・保存先 ' + (v.store === 'bucket' ? 'R2' : 'データベース');
  }
  function renderVault() {
    stopInline3d();
    var open = !!state.vault, info = state.vaultInfo;
    topBar();
    renderSpeed();
    $('#vault-title').textContent = '保管庫';
    $('#vault-main').hidden = !open;
    // the developer: 編集する (the code) while looking only, 閉じる while changing
    var editing = open && state.developer && !!state.vault.ticket;
    $('#vault-unlock').hidden = !open || !state.developer || editing;
    $('#vault-lock').hidden = !editing;
    $('#vault-lock').title = editing ? stamp(state.vault.until) + 'まで編集できます（閉じると閲覧のみ）' : '';
    vaultUsage();
    var list = $('#vault-list'), folders = $('#vault-folders'), path = $('#vault-path');
    list.textContent = '';
    folders.textContent = '';
    path.textContent = '';
    $('#vault-pager').textContent = '';
    renderSpaces();
    renderRoom();
    renderHead();
    if (!open) return;
    // what the open vault lets one do: put files in (not after the other one
    // left), change, links (the developer's own)
    var own = !state.vaultSpace, add = !!(info && info.add);
    $('#vault-up').hidden = !canWrite();
    $('#vault-pick-files').hidden = !add;
    $('#vault-link').hidden = !own || !info;
    var links = state.vault.all || { live: 0 };
    $('#vault-link').textContent = links.live ? 'リンク（有効 ' + links.live + '）' : 'リンク';
    renderMemo();
    $('#vault-filter').hidden = !own || !info;
    $('#vault-path').hidden = !info || state.vaultSpace === 'backup';
    if (!info) { renderPicked(); renderResume(); return; }
    // where it is: 保管庫 / 車 / 新車 (each a way back)
    [{ id: '', name: rootName() }].concat(trail(state.vaultFolder)).forEach(function (d, i, a) {
      if (i) path.appendChild(el('span', 'muted', '/'));
      var b = el('button', 'vault-crumb' + (i === a.length - 1 && !state.vaultIn ? ' here' : ''), d.name);
      b.type = 'button';
      b.dataset.folder = d.id;
      path.appendChild(b);
    });
    // (a file whose inside was open, gone meanwhile: where it was)
    if (state.vaultIn && !fileOf(state.vaultIn)) state.vaultIn = '';
    fileTrail(state.vaultIn).forEach(function (f, i, a) {
      path.appendChild(el('span', 'muted', '/'));
      var b = el('button', 'vault-crumb vault-crumb-file' + (i === a.length - 1 ? ' here' : ''), f.name);
      b.type = 'button';
      b.dataset.infile = f.id;
      b.title = 'ファイル「' + f.name + '」の中';
      path.appendChild(b);
    });
    var inside = state.vaultIn ? [] : foldersIn(state.vaultFolder);
    inside.forEach(function (d) { folders.appendChild(folderCard(d)); });
    // a model's light copy shows with the model; 10 to a page
    var all = listed(), show = state.vaultShow;
    var tops = all.filter(function (f) { return show === 'all' || (show === 'used') === !!f.implementedAt; });
    var pages = Math.max(1, Math.ceil(tops.length / VAULT_PAGE));
    if (state.vaultPage >= pages) state.vaultPage = pages - 1;
    if (!all.length && !inside.length) list.appendChild(el('p', 'empty muted', state.vaultIn ? 'このファイルの中はまだ空です（アップロード・ドラッグ＆ドロップ・「＋」で入れられます）' : state.vaultFolder ? 'このフォルダは空です' : 'ファイルはまだありません'));
    else if (!tops.length && all.length) list.appendChild(el('p', 'empty muted', show === 'used' ? '実装済みのファイルはありません' : '未実装のファイルはありません'));
    tops.slice(state.vaultPage * VAULT_PAGE, (state.vaultPage + 1) * VAULT_PAGE).forEach(function (f) { list.appendChild(vaultCard(f)); });
    watchInline3d();
    renderPager(pages, tops.length);
    renderPicked();
    renderResume();
  }
  var VAULT_PAGE = 10;
  // how fast the vault goes (the developer changes it, for everyone)
  var SPEED_NOTE = { max: '最速：大きな部分（R2 では 16MB）を一度にたくさん、3ファイルずつ', fast: '高速：8MB の部分を一度に多めに、2ファイルずつ', normal: '標準：8MB の部分を少しずつ、1ファイルずつ' };
  function renderSpeed() {
    var box = $('#vault-speed-box'), sp = state.vaultSpeed;
    box.hidden = !state.vault || !sp;
    if (!sp) return;
    $('#vault-speed').value = sp.id;
    $('#vault-speed').disabled = !state.developer;
    box.title = (SPEED_NOTE[sp.id] || '') + (state.developer ? '（運営者全員に反映）' : '（速さは開発者だけが変えられます）');
  }
  function setVaultSpeed(v) {
    if (!state.developer || !state.vaultSpeed) { renderSpeed(); return; }
    vreq('POST', '/api/vault/speed', { speed: v }).then(function (r) {
      state.vaultSpeed = r.speed;
      if (state.vault) state.vault.chunk = r.chunk;
      renderSpeed();
      toast('保管庫の速さ：' + r.speed.name + '（' + SPEED_NOTE[r.speed.id].replace(/^[^：]+：/, '') + '。運営者全員に反映）');
      kick();
    }, function (err) { renderSpeed(); fail(err); });
  }
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
  // what kind of item: 3Dモデル, APK, プログラム, テキスト, 画像, 動画, 音声, 圧縮, その他 (each counts one on a page)
  var CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|php|java|kt|kts|swift|go|rs|c|h|cpp|hpp|cc|cs|dart|lua|sh|bash|zsh|bat|cmd|ps1|sql|pl|r|scala|gd|vue|svelte|html?|css|scss|less|json|ya?ml|toml|ini|xml|gradle|glsl|hlsl|shader|wgsl)$/;
  function fileKind(f) {
    var n = String(f.name || '').toLowerCase(), t = String(f.type || '');
    if (is3d(n)) return ['3Dモデル', 'k3d'];
    if (/\.(apk|aab|apks|xapk)$/.test(n) || t === 'application/vnd.android.package-archive') return ['APK', 'kapk'];
    if (CODE_EXT.test(n)) return ['プログラム', 'kcode'];
    if (/^text\//.test(t) || /\.(txt|md|csv|tsv|log)$/.test(n)) return ['テキスト', 'ktext'];
    if (/^image\//.test(t) || /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/.test(n)) return ['画像', 'kimg'];
    if (/^video\//.test(t) || /\.(mp4|mov|webm|mkv|m4v)$/.test(n)) return ['動画', 'kvid'];
    if (/^audio\//.test(t) || /\.(mp3|wav|ogg|m4a|flac|aac|opus)$/.test(n)) return ['音声', 'kaud'];
    if (/\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/.test(n)) return ['圧縮', 'kzip'];
    return ['その他', 'koth'];
  }
  function isTextual(k) { return k === 'ktext' || k === 'kcode'; }
  // a file's icon: the APK one, or the file one with its extension on it
  function fileIcon(f, kind) {
    var ext = (/\.([A-Za-z0-9]{1,6})$/.exec(f.name || '') || [])[1] || '';
    return kind[1] === 'kapk' ? iconEl('apk', f.name) : iconEl('file', f.name, ext.toUpperCase());
  }
  // the beginning of a text or a program (its first piece), fetched once
  var texts = {};
  function textEl(f) {
    var p = el('pre', 'vault-text', '読み込み中…');
    if (texts[f.id] !== undefined) { p.textContent = texts[f.id]; return p; }
    vreq('GET', '/api/vault/chunk?id=' + f.id + '&n=0').then(function (r) {
      var s = new TextDecoder().decode(bytesOf(r.data));
      texts[f.id] = Array.from(s).length > 1200 ? Array.from(s).slice(0, 1200).join('') + '\n…（続きはアイコンをタップ）' : s;
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

  /* comments on a file: the operators', the developer's and an AI's (from
     its link), each for a day, 3, 7, 30 or with no end */
  var commentsFor = null;
  function openComments(f) {
    commentsFor = f.id;
    $('#vcomments-text').value = '';
    $('#vcomments-days').value = '0';
    renderComments();
    $('#vcomments').hidden = false;
    if (canWrite()) setTimeout(function () { $('#vcomments-text').focus(); }, 30);
    if (!fullOf(f)) loadFull(f).then(function () { if (commentsFor === f.id) renderComments(); }, fail);
  }
  function closeComments() { commentsFor = null; $('#vcomments').hidden = true; }
  function renderComments() {
    var f = fileOf(commentsFor);
    if (!f) { closeComments(); return; }
    var full = fullOf(f);
    if (!full && f.noteCount && commentsFor) loadFull(f).then(function () { if (commentsFor === f.id) renderComments(); }, function () {});
    f = full || f;
    $('#vcomments-name').textContent = f.name;
    $('#vcomments-note').textContent = !f.space ? 'AI用リンクにも、期限まで表示されます' : f.space === 'backup' ? '' : 'この保管庫を使う人と開発者に見えます';
    $('#vcomments-form').hidden = !canWrite() || state.vaultSpace === 'backup';
    var list = $('#vcomments-list');
    list.textContent = '';
    if (!full && f.noteCount) list.appendChild(el('p', 'muted vcomments-empty', '読み込み中…'));
    else if (!(f.notes || []).length) list.appendChild(el('p', 'muted vcomments-empty', 'コメントはまだありません'));
    (f.notes || []).forEach(function (n) {
      var over = n.until && n.until <= Date.now(), ai = n.by && n.by.ai;
      var row = el('div', 'vcomment' + (over ? ' over' : '') + (ai ? ' ai' : ''));
      var head = el('div', 'vcomment-head');
      if (ai) head.appendChild(el('span', 'tag vai', 'AI'));
      else head.appendChild(el('b', '', n.by ? n.by.name : '?'));
      head.appendChild(el('small', '', date(n.at, true) + (n.until ? (over ? '・期限切れ' + (f.space ? '' : '（AIには見えません）') : '・' + date(n.until, true) + 'まで') : '')));
      if (canWrite() && state.vaultSpace !== 'backup') {
        var x = el('button', 'vnote-del', '×');
        x.type = 'button';
        x.title = 'このコメントを削除';
        x.dataset.note = n.id;
        head.appendChild(x);
      }
      row.appendChild(head);
      row.appendChild(el('p', 'vcomment-text', n.text));
      list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
  }
  function sendComment(e) {
    e.preventDefault();
    var f = fileOf(commentsFor), t = $('#vcomments-text'), text = t.value.trim();
    if (!f || !text) return;
    vreq('POST', '/api/vault/notes', { id: f.id, text: text, days: Number($('#vcomments-days').value) }).then(function () {
      t.value = '';
      return loadVault();
    }).catch(fail);
  }
  function onComments(e) {
    var x = e.target.closest('[data-note]');
    if (!x) return;
    ask({ title: '本当に削除しますか？', text: 'このコメントを削除します：\n' + x.closest('.vcomment').querySelector('.vcomment-text').textContent, ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/notes/delete', { note: Number(x.dataset.note) }).then(function () { toast('削除しました'); return loadVault(); });
    }).catch(fail);
  }

  /* making things here (the ＋): a folder, a file of any kind written here,
     files with a memo on them */
  var TEXT_TYPES = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', xml: 'application/xml', py: 'text/x-python', sh: 'application/x-sh' };
  function newFile() {
    ask({
      title: 'ファイルを作る', text: (state.vaultIn ? 'ファイル「' + (fileOf(state.vaultIn) || { name: '' }).name + '」の中' : '「' + pathName(state.vaultFolder) + '」') + 'に保存します。名前に拡張子を付けると、その種類のファイルになります（例：memo.txt・main.py・index.html）。', ok: '保存する',
      input: { label: '名前（拡張子つき）', type: 'text' }, area: { label: '中身' },
      check: function (v) { return v.trim() ? '' : '名前を入れてください'; }
    }).then(function (v) {
      if (v === null) return null;
      if (!v.text.length) { toast('中身を書いてください'); return null; }
      var name = v.value.trim();
      if (!/\.[A-Za-z0-9]{1,10}$/.test(name)) name += '.txt';
      var ext = name.split('.').pop().toLowerCase();
      return queueFile(new File([v.text], name, { type: TEXT_TYPES[ext] || 'text/plain' }), { note: '', folder: state.vaultFolder, inside: state.vaultIn, space: state.vaultSpace });
    }).catch(fail);
  }
  // a memo on the next files picked
  function memoUpload() {
    ask({ title: 'メモを付けてアップロード', text: '次に選ぶファイルに、このメモが付きます（詳細に表示されます）。', ok: 'ファイルを選ぶ', input: { label: 'メモ（500文字まで）', type: 'text', value: state.vaultMemo || '' } }).then(function (v) {
      if (v === null) return;
      state.vaultMemo = Array.from(v.trim()).slice(0, 500).join('');
      renderMemo();
      $('#vault-file').click();
    });
  }
  function renderMemo() {
    var m = $('#vault-memo');
    m.hidden = !state.vaultMemo;
    m.textContent = state.vaultMemo ? 'メモ「' + state.vaultMemo + '」を次のアップロードに付けます（タップで取り消し）' : '';
  }
  function plusMenu() {
    var info = state.vaultInfo, items = state.vaultIn ? [] : [['フォルダを作る', 'folder']];
    if (info && info.add) items.push(['ファイルを作る（テキスト・プログラム）', 'file'], ['メモを付けてアップロード', 'memo']);
    menuAt($('#vault-plus'), items, function (a) {
      if (a === 'folder') newFolder();
      else if (a === 'file') newFile();
      else if (a === 'memo') memoUpload();
    });
  }
  // the developer's own vault: a link to all of it, or stopping those
  function linkMenu() {
    var links = state.vault.all || { live: 0 }, items = [['保管庫全体のリンクを作る', 'make']];
    if (links.live) items.push(['全体リンクを停止（有効 ' + links.live + '本・' + stamp(links.until) + 'まで・取得 ' + fmt(links.uses) + '回）', 'stop', 'danger']);
    menuAt($('#vault-link'), items, function (a) {
      if (a === 'make') makeLink(null);
      else if (a === 'stop') {
        ask({ title: '全体リンクを停止しますか？', text: '保管庫全体のリンクがすべて、すぐに使えなくなります。', ok: '停止する', danger: true }).then(function (ok) {
          if (!ok) return null;
          return vreq('POST', '/api/vault/link/stop', { id: '*' }).then(function (r) { toast('リンクを停止しました（' + r.stopped + '本）'); return loadVault(); });
        }).catch(fail);
      }
    });
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
  // where a file of the backups is
  function whereOf(f) {
    return f.backup && f.backup.removed ? '削除済み（元：' + f.backup.removed.where + '）' : f.where || '保管庫';
  }
  // a file's 💬: how many comments
  function commentBtn(f) {
    var n = f.noteCount !== undefined ? f.noteCount : (f.notes || []).length;
    var b = el('button', 'vbtn vcomment-btn' + (n ? ' has' : ''));
    b.type = 'button';
    b.dataset.vact = 'comments';
    b.title = 'コメント';
    b.setAttribute('aria-label', 'コメント' + (n ? '（' + n + '件）' : ''));
    b.appendChild(el('span', 'vcomment-ic', '💬'));
    if (n) b.appendChild(el('b', '', String(n)));
    return b;
  }
  function vaultCard(f) {
    var kind = fileKind(f), inBackups = state.vaultSpace === 'backup';
    var row = el('article', 'vitem vault-card' + (f.done ? '' : ' undone') + (f.implementedAt ? ' used' : '') + (state.vaultPicked[f.id] ? ' picked' : '') + (shown[f.id] ? ' open' : ''));
    row.dataset.file = f.id;
    row.appendChild(checkEl(f.id, f.name));
    row.appendChild(fileIcon(f, kind));
    var main = el('div', 'vitem-main');
    main.appendChild(el('b', 'vault-name', f.name));
    var who = f.by && (inBackups || (state.vaultInfo && state.vaultInfo.kind === 'pair')) ? '・' + f.by.name : '';
    main.appendChild(el('small', 'vitem-sub', kind[0] + '・' + mb(f.size) + '・' + stamp(f.createdAt) + who));
    var tags = el('div', 'vitem-tags');
    if (!f.done) tags.appendChild(el('span', 'kind bug', 'アップロード途中 ' + f.received + '/' + f.chunks));
    if (f.implementedAt) tags.appendChild(el('span', 'kind used', '実装済み'));
    if (f.backup) {
      var b = el('span', 'kind vbackup', f.backup.removed ? 'バックアップのみ' : 'バックアップ');
      b.title = '開発者がバックアップ（' + date(f.backup.at, true) + '）';
      tags.appendChild(b);
    }
    if (inBackups) tags.appendChild(el('span', 'kind vwhere', whereOf(f)));
    var held = inBackups ? 0 : inFile(f.id).length;
    if (held) {
      var hb = el('button', 'kind vinside', '中のファイル ' + fmt(held) + '件');
      hb.type = 'button';
      hb.dataset.vact = 'inside';
      hb.title = '「' + f.name + '」の中を開く';
      tags.appendChild(hb);
    }
    if (!f.space && f.links && f.links.live) tags.appendChild(el('span', 'kind vlink', 'リンク有効'));
    if (tags.childNodes.length) main.appendChild(tags);
    row.appendChild(main);
    var acts = el('div', 'vitem-acts');
    acts.appendChild(commentBtn(f));
    var d = el('button', 'vbtn vdetail' + (shown[f.id] ? ' on' : ''), '詳細');
    d.type = 'button';
    d.dataset.vact = 'details';
    d.setAttribute('aria-expanded', shown[f.id] ? 'true' : 'false');
    acts.appendChild(d);
    acts.appendChild(moreBtn(f.name));
    row.appendChild(acts);
    if (f.done && kind[1] === 'k3d') row.appendChild(inline3dEl(f));
    if (shown[f.id]) row.appendChild(detailsEl(f, kind));
    return row;
  }
  // A file's 詳細: everything about it, asked for when it opens (the list is
  // light), and kept while the list is the same.
  var fulls = {};
  function fullOf(f) {
    var c = fulls[f.id];
    return c && c.rev === state.vaultRev.files ? c.file : null;
  }
  function loadFull(f) {
    var rev = state.vaultRev.files;
    return vreq('GET', '/api/vault/file?id=' + f.id).then(function (r) {
      fulls[f.id] = { rev: rev, file: r.file };
      return r.file;
    });
  }
  // one card drawn again (its 詳細 in)
  function redrawCard(id) {
    var row = document.querySelector('#vault-list [data-file="' + id + '"]'), f = fileOf(id);
    if (row && f) { row.replaceWith(vaultCard(f)); watchInline3d(); }
  }
  function detailsEl(f, kind) {
    var full = fullOf(f);
    if (!full) {
      var wait = el('div', 'vitem-detail loading', '詳細を読み込み中…');
      loadFull(f).then(function () { redrawCard(f.id); }, function (err) { wait.textContent = '詳細を読み込めませんでした：' + ((err && err.message) || ''); });
      return wait;
    }
    f = full;
    var box = el('div', 'vitem-detail'), light = lightOf(f);
    var body = el('div', 'vault-body');
    if (f.preview) body.appendChild(picEl(f));
    else if (f.done && is3d(f.name)) body.appendChild(el('div', 'vault-pic none', 'プレビューなし'));
    else if (f.done && kind[1] === 'kimg' && f.size <= 8 * 1048576) body.appendChild(imageEl(f));
    var facts = el('div', 'facts');
    fact(facts, '送信日時', stamp(f.createdAt));
    fact(facts, '保存完了', f.done ? stamp(f.doneAt) : '送信中');
    if (f.by) fact(facts, '送った人', f.by.name);
    if (state.vaultSpace === 'backup') fact(facts, '場所', whereOf(f));
    if (f.implementedAt) fact(facts, '実装済みになった日時', stamp(f.implementedAt));
    if (f.info) modelFacts(facts, f.info, light);
    fact(facts, '大きさ', mb(f.size) + '（' + fmt(f.size) + 'バイト）');
    fact(facts, '種類', kind[0] + (f.type ? '（' + f.type + '）' : ''));
    fact(facts, 'SHA-256（部分ごとのハッシュの並び）', f.sha256 || '-');
    if (!f.space) {
      fact(facts, 'リンク', f.links.live ? f.links.live + '本 有効（' + stamp(f.links.until) + 'まで）' : 'なし');
      fact(facts, 'リンクからの取得', fmt(f.links.uses) + '回');
    }
    if (f.note) fact(facts, 'メモ', f.note);
    if (f.backup) {
      fact(facts, 'バックアップ', date(f.backup.at, true) + '（' + f.backup.by.name + '）');
      if (f.backup.removed) fact(facts, '保管庫から削除', date(f.backup.removed.at, true) + '（' + f.backup.removed.by.name + '・元：' + f.backup.removed.where + '）');
    }
    body.appendChild(facts);
    box.appendChild(body);
    if (f.done && isTextual(kind[1])) box.appendChild(textEl(f));
    box.appendChild(labelsEl(f));
    return box;
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
  /* ------------------------------------------------------------ uploads --- */
  /* The files go up on their own (ops/vault-upload.js): in the site's
     background worker (ops/ops-sw.js) where there is one, so they go on with
     the vault closed and with this page closed; else here. Each one waits in
     this browser with its upload's own pass, and is shown here while it goes:
     a stopped one (the connection, the server busy, the room) goes on by
     itself, and 「再開」 sends every stopped one again at once. */
  var up = { mode: '', reg: null, engine: null, jobs: {}, cards: {}, mem: {}, ready: null };
  var UP_WHY = {
    net: '通信が切れたか、サーバーが混み合っています。自動で何度でも続きから送ります',
    locked: 'アップロードの許可（1週間）が切れました。「編集する」で開発者コードを入れると、自動で続きを送ります',
    login: 'ログインが切れました。ログインし直すと、自動で続きを送ります',
    full: '保管庫がいっぱいです。空きができしだい送ります',
    room: 'あなたの容量の上限です。開発者の承認か空きができしだい送ります（「容量を申請」から申請できます）',
    gone: 'このファイルは保管庫から削除されました',
    error: ''
  };
  // the stopped ones that go again by themselves (ops/vault-upload.js)
  var AGAIN_WHY = { net: 1, error: 1, login: 1, locked: 1 };
  function upInit() {
    var page = function () {
      up.mode = 'page';
      up.engine = VaultUploads.engine({ tell: onJob, mine: function () { return true; }, file: function (key) { return up.mem[key] || null; } });
      return 'page';
    };
    if ('serviceWorker' in navigator && window.isSecureContext && window.indexedDB) {
      navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'vault-upload') onJob(e.data.job); });
      up.ready = navigator.serviceWorker.register('/ops/ops-sw.js', { scope: '/ops/' }).then(function (reg) {
        up.reg = reg;
        return activeOf(reg);
      }).then(function () {
        up.mode = 'sw';
        // (a file only this page holds: sent from here)
        up.engine = VaultUploads.engine({ tell: onJob, mine: function (j) { return !!j.mem; }, file: function (key) { return up.mem[key] || null; } });
        return 'sw';
      }, page);
    } else up.ready = Promise.resolve(window.indexedDB ? page() : 'none');
    up.ready.then(function () { refreshJobs().then(adoptJobs); kick(); });
  }
  // this account's files waiting here take the site's login as it is now (a
  // new one after logging in again: the ones stopped for it go at once)
  function adoptJobs() {
    if (!window.indexedDB || !token) return Promise.resolve();
    var me = state.name, now = token;
    return VaultUploads.all().then(function (list) {
      return Promise.all(list.filter(function (j) { return j.who === me && j.state !== 'done' && j.token !== now; }).map(function (j) {
        j.token = now;
        if (j.state === 'stop' && j.why === 'login') { j.next = 0; j.tries = 0; }
        return VaultUploads.save(j).then(function () { onJob(j); });
      }));
    }).then(wakeJobs, wakeJobs);
  }
  // logging out: the login kept with this account's files here goes too (they wait for the next login)
  function dropLogin(me) {
    if (!window.indexedDB) return Promise.resolve();
    return VaultUploads.all().then(function (list) {
      return Promise.all(list.filter(function (j) { return j.who === me && j.token; }).map(function (j) { j.token = ''; return VaultUploads.save(j); }));
    }).catch(function () {});
  }
  // now, not later: every stopped file that goes again by itself
  function wakeJobs() {
    if (!up.ready) return;
    up.ready.then(function (mode) {
      if (mode === 'sw' && up.reg && up.reg.active) up.reg.active.postMessage({ type: 'wake' });
      if (up.engine && (mode === 'page' || Object.keys(up.mem).length)) up.engine.wake();
    });
  }
  // the developer code in again: the files whose pass ran out get a new one and go on
  function renewPasses() {
    Object.keys(up.jobs).forEach(function (k) {
      var j = up.jobs[k];
      if (j.id && j.state === 'stop' && j.why === 'locked') passFor(j).then(kick);
    });
  }
  function activeOf(reg) {
    return new Promise(function (ok, no) {
      var w = reg.active || reg.waiting || reg.installing;
      if (!w) { no(new Error('no worker')); return; }
      if (w.state === 'activated') { ok(w); return; }
      w.addEventListener('statechange', function () { if (w.state === 'activated') ok(w); else if (w.state === 'redundant') no(new Error('redundant')); });
    });
  }
  // the files go (whichever runs them)
  function kick() {
    if (!up.ready) return;
    up.ready.then(function (mode) {
      if (mode === 'sw' && up.reg && up.reg.active) up.reg.active.postMessage({ type: 'kick' });
      if (up.engine && (mode === 'page' || Object.keys(up.mem).length)) up.engine.run();
    });
  }
  // what waits in this browser, shown (this account's only; finished ones go after a while)
  function refreshJobs() {
    if (!window.indexedDB) return Promise.resolve();
    return VaultUploads.all().then(function (list) {
      list.forEach(function (j) { if (j.who === state.name) onJob(j); });
    }, function () {});
  }
  function upMine(j) { return j && j.who === state.name; }
  function onJob(j) {
    if (!upMine(j)) return;
    var was = up.jobs[j.key];
    up.jobs[j.key] = j;
    renderJob(j);
    if (j.state === 'done' && (!was || was.state !== 'done')) jobDone(j);
    renderResume();
  }
  function jobText(j) {
    var p = j.chunks ? Math.round(j.sent / j.chunks * 100) : 0;
    if (j.state === 'done') return '保存しました' + (j.sha256 ? '（SHA-256 ' + String(j.sha256).slice(0, 16) + '…）' : '');
    if (j.state === 'run' && j.retry) return '通信が途切れたので、すぐに送り直しています…（' + p + '% 送信済み・' + j.retry + '回目）';
    if (j.state === 'run') return '送信中… ' + mb(Math.min(j.size, j.sent * (j.piece || 0))) + ' / ' + mb(j.size) + '（' + p + '%）' + (j.rate ? '・' + mb(j.rate) + '/秒' : '');
    if (j.state === 'wait') return '順番待ち（' + mb(j.size) + '）';
    var why = UP_WHY[j.why] || '';
    if (j.state === 'fail') return 'できませんでした：' + (j.message || why || 'もう一度ファイルを選んでください');
    // (when it goes again by itself)
    var wait = j.next ? Math.max(0, Math.ceil((j.next - Date.now()) / 1000)) : 0;
    var again = AGAIN_WHY[j.why] ? (wait ? '・' + (wait >= 60 ? Math.ceil(wait / 60) + '分' : wait + '秒') + '後に自動で再開' : '・自動で再開中') : '';
    return '止まりました：' + (j.why === 'error' || !why ? (j.message || 'もう一度「再開」を押してください') : why) + (j.chunks ? '（' + p + '% 送信済み' + again + '）' : again ? '（' + again.slice(1) + '）' : '');
  }
  function renderJob(j) {
    var c = up.cards[j.key];
    if (!c) {
      var card = el('article', 'card job up-job');
      var head = el('div', 'up-job-head');
      head.appendChild(el('b', '', j.name + (j.parent ? '（軽量版）' : '')));
      var x = el('button', 'btn small ghost', 'やめる');
      x.type = 'button';
      x.dataset.upCancel = j.key;
      head.appendChild(x);
      card.appendChild(head);
      var bar = el('div', 'bar'), fill = el('i');
      bar.appendChild(fill);
      card.appendChild(bar);
      var note = el('span', 'muted');
      card.appendChild(note);
      $('#vault-jobs').insertBefore(card, $('#vault-jobs').firstChild);
      c = up.cards[j.key] = { card: card, fill: fill, note: note, x: x };
    }
    var p = j.state === 'done' ? 100 : j.chunks ? j.sent / j.chunks * 100 : 0;
    c.fill.style.width = p.toFixed(1) + '%';
    c.note.textContent = jobText(j);
    c.card.classList.toggle('ok', j.state === 'done');
    c.card.classList.toggle('paused', j.state === 'stop');
    c.card.classList.toggle('bad', j.state === 'fail');
    c.x.hidden = j.state === 'done';
  }
  // a file in: the list again; a model's picture made here (its file kept for it till then)
  function jobDone(j) {
    if (state.vault) loadVault();
    var go = Promise.resolve();
    if (j.model && !j.parent) {
      go = Promise.resolve(j.mem ? up.mem[j.key] : VaultUploads.fileOf(j.key)).then(function (blob) {
        if (blob) return preview({ id: j.id, name: j.name }, blob, j);
        return null;
      });
    }
    go.then(function () {
      setTimeout(function () { dropJob(j.key, true); }, 20000);
    });
  }
  function dropJob(key, quiet) {
    var c = up.cards[key];
    if (c) c.card.remove();
    delete up.cards[key];
    delete up.jobs[key];
    delete up.mem[key];
    renderResume();
    return VaultUploads.forget(key).catch(function () {}).then(function () { if (!quiet) kick(); });
  }
  function cancelJob(key) {
    var j = up.jobs[key];
    if (!j) return;
    if (up.reg && up.reg.active) up.reg.active.postMessage({ type: 'cancel', key: key });
    if (up.engine) up.engine.cancel(key);
    dropJob(key);
    toast('「' + j.name + '」のアップロードをやめました' + (j.id ? '（届いた部分は保管庫に「アップロード途中」で残ります。削除もできます）' : ''));
  }
  var upSeq = 0;
  // Files into the vault open now: each gets its place on the server (its
  // upload's own pass with it) and waits in this browser to go. `o`: { note,
  // space, folder, parent (a model's light copy: its pass), id (an unfinished
  // one to go on with) }
  function queueFile(file, o) {
    o = o || {};
    var j = {
      key: Date.now().toString(36) + '-' + (++upSeq) + '-' + Math.random().toString(36).slice(2, 8),
      who: state.name, id: o.id || '', name: file.name, size: file.size, type: file.type || '',
      note: o.note || '', space: o.parent ? '' : o.space || '', folder: o.folder || '', inside: o.parent ? '' : o.inside || '', parent: o.parent || '',
      model: !o.parent && is3d(file.name) && file.size > 0, token: token, pass: o.pass || '', piece: 0, chunks: 0, sent: 0,
      state: 'wait', why: '', message: '', tries: 0, next: 0, at: Date.now(), mem: false
    };
    if (!file.size) { toast('「' + file.name + '」は中身が空（0バイト）か、端末から読み込めませんでした。中身のあるファイルを選んでください'); return Promise.resolve(null); }
    if (state.vault && file.size > state.vault.fileBytes) { toast('「' + file.name + '」は大きすぎます（1ファイル ' + mb(state.vault.fileBytes) + 'まで）'); return Promise.resolve(null); }
    // kept in this browser (too big for its storage: in this page only, and sent from here)
    return VaultUploads.add(j, file).catch(function () {
      j.mem = true;
      up.mem[j.key] = file;
      return VaultUploads.add(j, null);
    }).then(function () {
      if (j.mem) up.mem[j.key] = file;
      onJob(j);
      return j.id ? passFor(j) : place(j);
    }).then(function () { kick(); return j; });
  }
  // its place on the server (and its pass); the room not there: it waits
  function place(j) {
    var extra = j.parent && j.pass ? { 'X-Vault-Upload': j.pass } : null;
    var body = { name: j.name, size: j.size, type: j.type, note: j.parent ? '' : j.note, parent: j.parent || undefined, space: j.parent ? undefined : j.space, folder: j.parent ? undefined : j.folder, inside: j.inside || undefined };
    var call = extra ? request('POST', '/api/vault/files', body, Object.assign({}, state.vault && state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : {}, extra)) : vreq('POST', '/api/vault/files', body);
    return call.then(function (r) {
      j.id = r.file.id;
      j.pass = r.upload;
      j.piece = r.file.piece;
      j.chunks = r.file.chunks;
      j.state = 'wait';
      j.why = '';
      j.message = '';
      return VaultUploads.save(j).then(function () { onJob(j); });
    }, function (err) { return stopJob(j, err); });
  }
  // an unfinished one on the server, gone on with: a new pass for it
  function passFor(j) {
    return vreq('GET', '/api/vault/missing?id=' + j.id).then(function (r) {
      if (r.file.size !== j.size) {
        // (not the same file after all: a new one)
        j.id = '';
        return place(j);
      }
      j.pass = r.upload;
      j.state = 'wait';
      j.why = '';
      return VaultUploads.save(j).then(function () { onJob(j); });
    }, function (err) { return stopJob(j, err); });
  }
  function stopJob(j, err) {
    var code = err && err.code;
    j.state = code === 'no_file' ? 'fail' : 'stop';
    j.why = code === 'vault_full' ? 'full' : code === 'need_approval' || code === 'over_limit' ? 'room' : code === 'vault_locked' ? 'locked'
      : err && (err.status === 0 || err.status === 429 || err.status >= 500) ? 'net' : code === 'no_file' ? 'gone' : 'error';
    j.message = (err && err.message) || '';
    j.next = Date.now() + 15000;
    return VaultUploads.save(j).then(function () { onJob(j); });
  }
  // 「再開」: every stopped file again at once (its place or its pass first
  // where it needs one); unfinished files with nothing here: picked again
  function resumeAll() {
    var list = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; }).filter(function (j) { return j.state !== 'done'; });
    var tasks = list.map(function (j) {
      j.token = token;
      j.tries = 0;
      j.next = 0;
      if (!j.id) return place(j);
      if (j.why === 'locked' || j.state === 'fail' && j.why !== 'gone') return passFor(j);
      if (j.why === 'gone') return dropJob(j.key, true);
      j.state = 'wait';
      j.why = '';
      j.message = '';
      return VaultUploads.save(j).then(function () { onJob(j); });
    });
    return Promise.all(tasks).then(function () {
      kick();
      var known = {};
      list.forEach(function (j) { if (j.id) known[j.id] = true; });
      var left = (state.vaultFiles || []).filter(function (f) { return !f.done && !known[f.id]; });
      if (left.length && canWrite()) {
        toast('続きを送るファイルを選んでください（' + left.length + '件：' + left.slice(0, 3).map(function (f) { return f.name; }).join('、') + (left.length > 3 ? ' ほか' : '') + '）');
        $('#vault-file').click();
      } else if (list.length) toast('止まっていたアップロードを再開しました（' + list.length + '件）');
      else if (!left.length) toast('止まっているアップロードはありません');
      else toast('「編集する」で開発者コードを入れると、途中のファイルの続きを送れます');
    });
  }
  // an unfinished file tapped: its upload waiting here goes on at once;
  // without one here, the same file is picked again (its pieces go on)
  function goOn(f) {
    var j = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; }).filter(function (x) { return x.id === f.id && x.state !== 'done'; })[0];
    if (j) {
      j.state = 'wait';
      j.next = 0;
      j.tries = 0;
      VaultUploads.save(j).then(function () { onJob(j); kick(); toast('「' + f.name + '」の続きを送ります'); });
      return;
    }
    if (!canWrite()) { toast('アップロードの途中です（「編集する」で開発者コードを入れると、続きを送れます）'); return; }
    state.resumeId = f.id;
    toast('「' + f.name + '」（' + mb(f.size) + '）と同じファイルを選んでください。届いた部分の続きから送ります');
    $('#vault-file').click();
  }
  // the room for a new file in a vault: all the vaults' room, and in a
  // shared one an operator's own (the developer has no limit)
  function roomIn(space) {
    var v = state.vault, free = v.maxBytes - v.used;
    if (space && !state.developer && v.me && v.me.limit) free = Math.min(free, v.me.limit - v.me.used);
    return free;
  }
  // a new file may get its place from here now (the developer: with the code)
  function canWriteIn() { return !state.developer || !!(state.vault && state.vault.ticket); }
  // room again (a file deleted, a limit raised): the files waiting for it get their place
  function roomCame() {
    if (!state.vault) return;
    Object.keys(up.jobs).forEach(function (k) {
      var j = up.jobs[k];
      if (j.id || j.state !== 'stop' || (j.why !== 'full' && j.why !== 'room') || j.next > Date.now()) return;
      if (j.size <= roomIn(j.space) && canWriteIn(j.space)) { j.next = Date.now() + 15000; place(j).then(kick); }
    });
  }
  // the 再開 button: whenever something is stopped or unfinished
  function renderResume() {
    var b = $('#vault-resume');
    if (!b) return;
    var mine = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; });
    var stopped = mine.filter(function (j) { return j.state === 'stop' || j.state === 'fail' && j.why !== 'gone'; }).length;
    var known = {};
    mine.forEach(function (j) { if (j.id) known[j.id] = true; });
    var half = (state.vaultFiles || []).filter(function (f) { return !f.done && !known[f.id]; }).length;
    b.hidden = !(stopped + half);
    b.textContent = '再開（' + (stopped + half) + '件）';
  }
  // A model: its picture, what is in it, and its light copy (uploaded as a
  // file of its own); `up`: its upload (its pass: the vault may be closed by now)
  function preview(f, file, upj) {
    var j = job(f.name + '（3Dプレビュー）');
    j.set(0, 3);
    var pass = upj && upj.pass ? { 'X-Vault-Upload': upj.pass } : null;
    return vault3d().then(function (V) {
      return V.analyze(file, f.name);
    }).then(function (r) {
      j.set(1, 3);
      return (pass ? Promise.resolve(pass) : passOf(f.id)).then(function (h) {
        return request('POST', '/api/vault/meta', { id: f.id, preview: r.preview, info: r.info }, Object.assign({}, state.vault && state.vault.ticket ? { 'X-Vault-Ticket': state.vault.ticket } : {}, h)).then(function () {
          pics[f.id] = r.preview;
          j.set(2, 3);
          if (!r.light) return null;
          var base = f.name.replace(/\.[^.]+$/, '');
          return queueFile(new File([r.light], base + '.light.glb', { type: 'model/gltf-binary' }), { parent: f.id, pass: h['X-Vault-Upload'] || '' });
        });
      });
    }).then(function () { j.finish('プレビューを作りました'); if (state.vault) return loadVault(); return null; }, function (err) {
      j.fail('プレビューを作れませんでした：' + ((err && err.message) || ''));
    });
  }
  // a file's upload pass, from the server (the vault open, or no code needed)
  function passOf(id) {
    return vreq('GET', '/api/vault/missing?id=' + id).then(function (r) { return { 'X-Vault-Upload': r.upload }; }, function () { return {}; });
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
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ''; }
    var box = $('#viewer-box');
    box.textContent = '';
    box.classList.remove('big', 'fit');
    box.style.backgroundImage = '';
    $('#viewer').hidden = true;
  }
  // a whole file shown here (`make` puts it in the box)
  function showBlob(f, make) {
    closeViewer();
    $('#viewer-name').textContent = f.name;
    $('#viewer-note').textContent = '読み込み中…';
    $('#viewer').hidden = false;
    fetchFile(f, { set: function (d, t) { $('#viewer-note').textContent = '読み込み中… ' + Math.round(d / t * 100) + '%'; } }).then(function (blob) {
      if ($('#viewer').hidden) return null;
      var box = $('#viewer-box');
      box.textContent = '';
      box.classList.add('fit');
      return Promise.resolve(make(box, blob)).then(function () { $('#viewer-note').textContent = mb(f.size); });
    }).catch(function (err) { $('#viewer-note').textContent = (err && err.message) || '表示できませんでした'; });
  }
  function urlOf(blob, type) {
    if (viewUrl) URL.revokeObjectURL(viewUrl);
    viewUrl = URL.createObjectURL(new Blob([blob], { type: type }));
    return viewUrl;
  }
  function showImage(f) {
    showBlob(f, function (box, blob) {
      var img = el('img', 'viewer-img');
      img.src = urlOf(blob, f.type || 'image/png');
      img.alt = f.name;
      box.appendChild(img);
    });
  }
  function showText(f) {
    showBlob(f, function (box, blob) {
      return blob.text().then(function (text) { box.appendChild(el('pre', 'viewer-text', text)); });
    });
  }
  function showMedia(f, video) {
    showBlob(f, function (box, blob) {
      var m = el(video ? 'video' : 'audio', 'viewer-media');
      m.controls = true;
      m.src = urlOf(blob, f.type || (video ? 'video/mp4' : 'audio/mpeg'));
      box.appendChild(m);
    });
  }
  // A tap on a file's icon: a model turns in 3D, a picture, a text or a
  // program, a video or a sound shows here; anything else (an APK, a zip) is
  // saved. One still going up goes on (the same file picked again).
  var SHOW_TEXT = 2 * 1048576, SHOW_PIC = 40 * 1048576, SHOW_MEDIA = 300 * 1048576;
  function openFile(f) {
    if (!f.done) {
      goOn(f);
      return;
    }
    var k = fileKind(f)[1];
    if (k === 'k3d') view3d(f);
    else if (k === 'kimg' && f.size <= SHOW_PIC) showImage(f);
    else if (isTextual(k) && f.size <= SHOW_TEXT) showText(f);
    else if ((k === 'kvid' || k === 'kaud') && f.size <= SHOW_MEDIA) showMedia(f, k === 'kvid');
    else download(f);
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
      title: f ? '「' + f.name + '」のリンクを作る' : '保管庫全体のリンクを作る',
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
          title: (ai ? 'AI用' : '読み取り専用') + 'リンクを作りました（' + v.value + '時間有効）',
          text: url + '\n\n' + (f ? '期限まで、このファイルだけを取り出せます。' : '期限まで、保管庫のすべてのファイルを取り出せます。') + '用が済んだら停止してください。'
            + (ai ? '\n\nAI には「このURLを開いて how の説明どおりに使い、作業したらラベルを付け、ゲームに入れたら implemented: true で報告して」と伝えてください。' : ''),
          ok: 'OK'
        });
      });
    }).catch(fail);
  }
  /* the menu of an item: its ⋯ (under it), a right click or a long press (where it was) */
  var menuDo = null, menuAt0 = 0, menuWidth = 0;
  function openMenu(items, at, then) {
    var m = $('#vmenu');
    m.textContent = '';
    items.forEach(function (x) {
      var b = el('button', 'vmenu-item' + (x[2] ? ' ' + x[2] : ''), x[0]);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.dataset.mact = x[1];
      m.appendChild(b);
    });
    menuDo = then;
    menuAt0 = Date.now();
    menuWidth = window.innerWidth;
    m.hidden = false;
    // in sight: moved in where it would go out
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(at.x, window.innerWidth - w - 8)) + 'px';
    m.style.top = Math.max(8, at.y + h + 8 > window.innerHeight ? at.y - h - (at.below || 0) : at.y) + 'px';
    var first = m.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  }
  function menuAt(b, items, then) {
    var r = b.getBoundingClientRect();
    openMenu(items, { x: r.left, y: r.bottom + 4, below: r.height + 8 }, then);
  }
  function closeMenu() { $('#vmenu').hidden = true; menuDo = null; }
  // (the page scrolled or turned: the menu goes; not for what opening it moved,
  // nor a phone's address bar coming and going)
  function menuMoved(e) {
    if ($('#vmenu').hidden || Date.now() - menuAt0 < 400) return;
    if (e.type === 'resize' && window.innerWidth === menuWidth) return;
    if (e.type === 'scroll' && e.target && e.target.closest && e.target.closest('#vmenu')) return;
    closeMenu();
  }
  function onMenu(e) {
    var b = e.target.closest('[data-mact]');
    if (!b || !menuDo) return;
    var then = menuDo;
    closeMenu();
    then(b.dataset.mact);
  }

  // what can be done with a file (its ⋯, a right click)
  function fileMenu(f) {
    var write = canWrite(), own = !f.space, kind = fileKind(f), inBackups = state.vaultSpace === 'backup';
    var dev = state.developer && state.vault && state.vault.ticket, items = [];
    if (f.done) {
      items.push(['開く', 'open'], ['ダウンロード', 'get']);
      if (lightOf(f)) items.push(['軽量版をダウンロード', 'getlight']);
      if (!f.info && kind[1] === 'k3d' && write && !inBackups && (own || state.vaultInfo.add)) items.push(['3Dプレビューを作る', 'make']);
    } else if (write) items.push(['続きから送る（同じファイルを選ぶ）', 'resume']);
    if (!inBackups) {
      var held = inFile(f.id).length;
      if (held || (write && fileTrail(f.id).length < 8)) items.push([held ? '中のファイルを開く（' + fmt(held) + '件）' : '中を開く（このファイルの中にファイルを入れる）', 'inside']);
    }
    items.push([shown[f.id] ? '詳細を閉じる' : '詳細', 'details'], ['コメント', 'comments']);
    if (write && !inBackups) items.push(['名前を変更', 'rename'], ['移動', 'move']);
    if (own && f.done && write) {
      if (f.implementedAt) items.push(['実装済みから戻す', 'restore']);
      else items.push(['リンクを作る', 'link']);
      if (f.links.live) items.push(['リンクを停止', 'stop']);
    }
    if (dev && f.done) {
      if (f.backup && f.backup.removed) items.push(['元の場所に戻す', 'unremove']);
      else items.push(f.backup ? ['バックアップから外す', 'unbackup'] : ['バックアップする', 'backup']);
    }
    if (write && (!inBackups || f.space === 'backup')) items.push([inBackups ? '完全に削除' : '削除', 'delete', 'danger']);
    return items;
  }
  function fileAct(f, act) {
    if (act === 'open') openFile(f);
    else if (act === 'inside') goInside(f);
    else if (act === 'details') { shown[f.id] = !shown[f.id]; renderVault(); }
    else if (act === 'comments') openComments(f);
    else if (act === 'get') download(f);
    else if (act === 'getlight') { if (lightOf(f)) download(lightOf(f)); }
    else if (act === 'pic') showPic(f);
    else if (act === 'make') makePreview(f);
    else if (act === 'link') makeLink(f);
    else if (act === 'rename') renameFile(f);
    else if (act === 'move') moveItems([f], []);
    else if (act === 'backup' || act === 'unbackup') backupItems([f], [], act === 'backup');
    else if (act === 'unremove') restoreBackup(f);
    else if (act === 'resume') goOn(f);
    else if (act === 'restore') {
      ask({ title: '実装済みから戻しますか？', text: '「' + f.name + '」がまたリンクから取り出せるようになります。', ok: '戻す' }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/restore', { id: f.id }).then(function () { toast('戻しました'); return loadVault(); });
      }).catch(fail);
    } else if (act === 'stop') {
      ask({ title: 'リンクを停止しますか？', text: '「' + f.name + '」のリンクがすべて、すぐに使えなくなります。', ok: '停止する', danger: true }).then(function (ok) {
        if (!ok) return null;
        return vreq('POST', '/api/vault/link/stop', { id: f.id }).then(function (r) { toast('リンクを停止しました（' + r.stopped + '本）'); return loadVault(); });
      }).catch(fail);
    } else if (act === 'delete') deleteFile(f);
  }
  function renameFile(f) {
    ask({ title: '名前を変更', ok: '変更する', input: { label: 'ファイルの名前', value: f.name }, check: named }).then(function (name) {
      if (name === null || name.trim() === f.name) return null;
      return vreq('POST', '/api/vault/rename', { id: f.id, name: name.trim() }).then(function () { toast('名前を変更しました'); return loadVault(); });
    }).catch(fail);
  }
  function deleteFile(f) {
    var text = f.space === 'backup' ? 'バックアップから完全に削除します（元に戻せません）。'
      : f.backup ? '保管庫から削除します。開発者のバックアップには残ります。'
        : '保管庫から完全に削除します（元に戻せません）。' + (f.space ? '' : 'リンクも使えなくなります。');
    if (f.space !== 'backup' && inFile(f.id).length) text += '中に入っているファイル（' + fmt(inFile(f.id).length) + '件）は消えずに、ひとつ上へ移ります。';
    ask({ title: '本当に削除しますか？', text: '「' + f.name + '」を' + text, ok: '削除する', danger: true }).then(function (ok) {
      if (!ok) return null;
      return vreq('POST', '/api/vault/delete', { id: f.id }).then(function (r) { toast(r.kept ? '削除しました（バックアップに残っています）' : '削除しました'); return loadVault(); });
    }).catch(fail);
  }
  // a tap in the lists: a checkmark checks, an icon opens, a button does its part
  function onItems(e) {
    if (onPick(e)) return;
    var row = e.target.closest('.vitem');
    if (!row) return;
    var f = row.dataset.file ? fileOf(row.dataset.file) : null, d = row.dataset.folder ? folderOf(row.dataset.folder) : null;
    var b = e.target.closest('[data-vact], [data-vopen]');
    if (d) {
      if (b && b.dataset.vact === 'menu') menuAt(b, folderMenu(d), function (a) { folderAct(d, a); });
      else if (b || e.target.closest('.vault-name')) goFolder(d.id);
      return;
    }
    if (!f || !b) return;
    if (b.dataset.vopen) openFile(f);
    else if (b.dataset.vact === 'menu') menuAt(b, fileMenu(f), function (a) { fileAct(f, a); });
    else fileAct(f, b.dataset.vact);
  }
  // a right click (or a long press): the item's menu where it was
  function onItemsMenu(e) {
    var row = e.target.closest('.vitem');
    if (!row) return;
    var f = row.dataset.file ? fileOf(row.dataset.file) : null, d = row.dataset.folder ? folderOf(row.dataset.folder) : null;
    if (!f && !d) return;
    e.preventDefault();
    openMenu(f ? fileMenu(f) : folderMenu(d), { x: e.clientX, y: e.clientY }, function (a) { if (f) fileAct(f, a); else folderAct(d, a); });
  }
  // files picked: into the vault and folder open now, with the note (an
  // unfinished one of the same size goes on where it stopped: the one tapped,
  // or one with the same name)
  function onFiles() {
    var input = $('#vault-file'), files = Array.prototype.slice.call(input.files || []), resume = state.resumeId;
    input.value = '';
    state.resumeId = null;
    sendFiles(files, resume, state.vaultFolder, state.vaultIn);
  }
  // `folder`: where they go in the vault open now ('' : its top); `inside`: into that file
  function sendFiles(files, resume, folder, inside) {
    if (!state.vault) return;
    var note = state.vaultMemo || '', space = state.vaultSpace, taken = {};
    if (files.length) { state.vaultMemo = ''; renderMemo(); }
    // (each unfinished one is gone on with once, by the file it was: same size, and the one tapped or the same name)
    Object.keys(up.jobs).forEach(function (k) { if (up.jobs[k].id) taken[up.jobs[k].id] = true; });
    var half = function (file) {
      var same = state.vaultFiles.filter(function (x) { return !x.done && !taken[x.id] && x.size === file.size; });
      var f = same.filter(function (x) { return resume && x.id === resume; })[0] || same.filter(function (x) { return x.name === file.name; })[0];
      if (f) taken[f.id] = true;
      return f;
    };
    files.reduce(function (p, file) {
      return p.then(function () {
        // (the same file again while it still waits here: that one goes on)
        var dup = Object.keys(up.jobs).map(function (k) { return up.jobs[k]; }).filter(function (j) { return j.state !== 'done' && j.name === file.name && j.size === file.size && j.space === space; })[0];
        if (dup) { dup.state = 'wait'; dup.next = 0; return VaultUploads.save(dup).then(function () { onJob(dup); kick(); }); }
        var f = half(file);
        return queueFile(file, { id: f ? f.id : '', note: note, space: space, folder: folder, inside: inside || '' });
      });
    }, Promise.resolve());
  }

  // files dragged in from the computer: dropped on the vault, into the folder
  // open now; dropped on a folder, into that folder (only while it may be
  // changed; never opened by the browser itself)
  var dragDepth = 0;
  function dragFiles(e) { return !!e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  // the folder dropped on, or the file (into it)
  function dropFolder(e) {
    var row = e.target.closest && e.target.closest('.vitem[data-folder], .vitem[data-file]');
    if (!row) return null;
    if (row.dataset.folder) return $('#vault-folders').contains(row) ? row : null;
    return $('#vault-list').contains(row) && state.vaultSpace !== 'backup' && fileTrail(row.dataset.file).length < 8 ? row : null;
  }
  function markDrop(row) {
    Array.prototype.forEach.call(document.querySelectorAll('.vitem.drop-in'), function (r) { if (r !== row) r.classList.remove('drop-in'); });
    if (row) row.classList.add('drop-in');
  }
  function endDrag() {
    dragDepth = 0;
    $('#vault-main').classList.remove('vault-drag');
    markDrop(null);
  }
  function onDragEnter(e) {
    if (!dragFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (canWrite()) $('#vault-main').classList.add('vault-drag');
  }
  function onDragOver(e) {
    if (!dragFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = canWrite() ? 'copy' : 'none';
    if (canWrite()) markDrop(dropFolder(e));
  }
  function onDragLeave(e) {
    if (!dragFiles(e)) return;
    if (--dragDepth <= 0) endDrag();
  }
  function onDrop(e) {
    if (!dragFiles(e)) return;
    e.preventDefault();
    var row = dropFolder(e);
    endDrag();
    if (!canWrite()) {
      toast(!$('#vault-unlock').hidden ? '「編集する」を押してから入れてください' : 'この保管庫には入れられません');
      return;
    }
    // (a folder from the computer is not taken: the files in it are)
    var items = Array.prototype.slice.call(e.dataTransfer.items || []), dirs = 0;
    items.forEach(function (it) { var en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en && en.isDirectory) dirs++; });
    var files = Array.prototype.slice.call(e.dataTransfer.files || []).filter(function (f, i) {
      var en = items[i] && items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      return !(en && en.isDirectory);
    });
    if (dirs) toast('フォルダはそのまま入れられません（中のファイルを選んで入れてください）');
    if (!files.length) return;
    if (row && row.dataset.file) {
      var into = fileOf(row.dataset.file);
      toast('「' + into.name + '」の中に ' + files.length + '個 入れます');
      sendFiles(files, null, into.folder || '', into.id);
      return;
    }
    var folder = row ? row.dataset.folder : state.vaultFolder;
    if (row) toast('「' + folderOf(folder).name + '」に ' + files.length + '個 入れます');
    sendFiles(files, null, folder, row ? '' : state.vaultIn);
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
  // One line of the log. A tap goes to the place it is about (a player, a
  // report, the vault …; not for a 閲覧者, who only reads); 詳細 shows all of it.
  function logEntry(x) {
    var row = el('div', 'entry'), go = state.viewer ? null : placeOf(x);
    var line = el('button', 'entry-line' + (go ? ' go' : ''));
    line.type = 'button';
    line.title = go ? go.label + 'を開く' : '詳細を表示';
    line.appendChild(el('span', 'time', String(x.jst || '').replace(/\.\d+ JST$/, '')));
    line.appendChild(el('span', 'lk k-' + x.kind, KINDS[x.kind] || ''));
    line.appendChild(el('span', 'who', x.actor.name));
    line.appendChild(el('span', 'sum', x.summary));
    function details() {
      var open = row.classList.toggle('open');
      more.classList.toggle('on', open);
      var d = row.querySelector('.entry-detail');
      if (!open) { if (d) d.hidden = true; return; }
      if (d) { d.hidden = false; return; }
      row.appendChild(logDetail(x));
    }
    line.addEventListener('click', function () { if (go) go.open(); else details(); });
    var more = el('button', 'entry-more', '詳細');
    more.type = 'button';
    more.addEventListener('click', details);
    var head = el('div', 'entry-head');
    head.appendChild(line);
    head.appendChild(more);
    row.appendChild(head);
    return row;
  }
  // where a log line takes one: { label, open } (null: nowhere in particular)
  function placeOf(x) {
    var a = String(x.action || ''), d = x.detail || {}, t = x.target && x.target.id ? x.target : null;
    // (what a player did: the player)
    if (!t && /^player_/.test(a) && x.actor && x.actor.id) t = x.actor;
    function to(label, open) { return { label: label, open: open }; }
    function tab(v, label) { return to(label, function () { setView(v); }); }
    if (/^vault_/.test(a)) {
      if (a === 'vault_quota_request' || a === 'vault_quota_cancel' || a === 'vault_quota_approve' || a === 'vault_quota_decline' || a === 'vault_quota_set') return tab('vault', '保管庫の容量');
      return to('保管庫', function () { openVaultAt(d.space || '', d.folder || ''); });
    }
    if (/^bot_/.test(a) && t) return to(t.name + ' さんとの公式チャット', function () { openChat(t.id); });
    if (/^report_|^player_report$/.test(a)) return tab('reports', '通報');
    if (a === 'detections_reviewed' || a === 'filter_block' || a === 'chat_unban') return t ? to(t.name + ' さん', function () { openDetail(t.id); }) : tab('detections', '検知');
    if (a === 'feedback_handled' || a === 'idea_adopt' || a === 'player_feedback') return tab('feedback', '報告・意見案');
    if (/^ops_|^viewer_|^dev_code_/.test(a)) return tab('operators', '運営者');
    if (a === 'account_delete' || a === 'account_purge') return tab('archive', 'プレイヤーアーカイブ');
    if (/^shield_|^lockdown|^emergency_|^sec_/.test(a)) return tab('security', 'セキュリティ');
    if (/^backup_|^discord_/.test(a)) return tab('server', 'サーバー');
    if (/^pay_/.test(a) && state.developer) return tab('pay', '課金');
    if (t) return to(t.name + ' さん', function () { openDetail(t.id); });
    return null;
  }
  // the vault at a vault and folder (from the log)
  function openVaultAt(space, folder) {
    setView('vault');
    // (the developer's own vault: only the developer sees it)
    if (!space && !state.developer) return;
    (state.vault ? Promise.resolve() : openLook()).then(function () {
      if (!state.vault) return null;
      if (space !== state.vaultSpace) goSpace(space);
      return loadVault().then(function () { if (folder && folderOf(folder)) goFolder(folder); });
    }).catch(function () {});
  }

  /* the log as a text for an AI (what happened, without the addresses, the
     devices and the hashes): the lines shown now, or one of them */
  var KIND_JA = { player: 'プレイヤー', operator: '運営', security: 'セキュリティ', vault: '保管庫', emergency: '緊急' };
  // (what could find a person or a machine stays out: addresses, devices, codes)
  var AI_SECRET = /^(request|time|ip|ips|host|device|devices|fp|userAgent|ua|agent|origin|referer|token|code|codes|password|recovery|sameDevice|sameDeviceAccounts)$/i;
  function aiSafe(v, depth) {
    if (typeof v === 'string') return v.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '[IP]').replace(/\b[0-9a-f]{0,4}(:[0-9a-f]{0,4}){3,7}\b/gi, '[IP]');
    if (!v || typeof v !== 'object' || depth > 4) return v;
    if (Array.isArray(v)) return v.slice(0, 20).map(function (x) { return aiSafe(x, depth + 1); });
    var out = {};
    Object.keys(v).forEach(function (k) { if (!AI_SECRET.test(k)) out[k] = aiSafe(v[k], depth + 1); });
    return out;
  }
  function aiLine(x) {
    var rest = aiSafe(x.detail || {}, 0);
    var detail = JSON.stringify(rest);
    if (detail.length > 600) detail = detail.slice(0, 600) + '…（省略）';
    return '#' + x.id + ' ' + String(x.jst || '').replace(/\.\d+ JST$/, '') + ' [' + (KIND_JA[x.kind] || x.kind) + '] ' + actionName(x.action) + '（' + x.action + '）\n'
      + '  実行: ' + x.actor.name + (x.target ? ' / 対象: ' + x.target.name : '') + '\n'
      + '  内容: ' + aiSafe(x.summary, 0) + (detail && detail !== '{}' ? '\n  詳細: ' + detail : '');
  }
  function aiReport(entries, what) {
    if (!entries.length) { toast('ログがありません'); return; }
    var first = entries[entries.length - 1], last = entries[0];
    var text = 'TWO STATE（オンラインのカジノゲーム）の運営ログです。内容を確認して、問題や気になる点があれば、原因の見立てと対処を教えてください。\n'
      + '範囲: ' + what + '・' + entries.length + '件（' + String(first.jst || '').slice(0, 16) + ' 〜 ' + String(last.jst || '').slice(0, 16) + ' 日本時間・新しい順）\n'
      + '----\n' + entries.map(aiLine).join('\n\n') + '\n----\n（IPアドレス・端末ID・ブラウザの情報と記録のハッシュは含めていません）';
    ask({ title: 'AIに報告する文章', text: '運営ログの報告文です。', area: { label: '報告文（' + entries.length + '件）', value: text }, ok: '閉じる' }).then(function (v) {
      if (v !== null) copy($('#dialog-area').value || text);
    });
  }
  function logScope() {
    var k = state.logKind, chip = document.querySelector('#log-kinds [data-kind="' + k + '"]');
    return (k ? (chip ? chip.firstChild.textContent : k) + 'のログ' : 'すべてのログ') + (state.logQ ? '（「' + state.logQ + '」で検索）' : '');
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
    if (Object.keys(rest).length) box.appendChild(el('pre', '', JSON.stringify(rest, null, 2)));
    var a = el('div', 'entry-acts'), ai = el('button', 'btn small', 'この記録をAIに報告する文章にする');
    ai.type = 'button';
    ai.addEventListener('click', function () { aiReport([x], '記録 #' + x.id); });
    a.appendChild(ai);
    var go = state.viewer ? null : placeOf(x);
    if (go) {
      var b = el('button', 'btn small primary', go.label + 'を開く');
      b.type = 'button';
      b.addEventListener('click', go.open);
      a.appendChild(b);
    }
    // (an operator: into the 運営チャット)
    if (!state.viewer) {
      var qb = el('button', 'btn small', '運営チャットで引用');
      qb.type = 'button';
      qb.addEventListener('click', function () { quoteInChat(x); });
      a.appendChild(qb);
    }
    box.appendChild(a);
    return box;
  }

  // Keep the operator UI upright in both portrait and landscape. The game
  // retains its own landscape behavior; fullscreen belongs to desktop.js.
  var turned = false;

  /* ------------------------------------------------------------ start --- */
  function init() {
    window.addEventListener('resize', topBar);
    window.addEventListener('orientationchange', topBar);

    $('#login-form').addEventListener('submit', onLogin);
    initDevUnit();
    diaryProfile = window.OpsDiaryProfile({ request: request, el: el, state: state, face: face, setView: setView, openDetail: openDetail, toast: toast, fail: fail });
    $('#logout').addEventListener('click', logout);
    $('#enter-go').addEventListener('click', enter);
    $('#enter-other').addEventListener('click', logout);
    $('#op-inlog-more').addEventListener('click', function () { loadInlog(true); });
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
    $('#op-viewers').addEventListener('click', onOperators);
    $('#op-grant').addEventListener('submit', onGrant);
    $('#op-grant-viewer').addEventListener('click', function () {
      var name = $('#op-grant-name').value.trim();
      if (!name) { toast('閲覧者にするプレイヤーの名前を入力してください'); return; }
      changeViewer('grant', name, null);
    });
    $('#op-devcode-btn').addEventListener('click', registerCode);
    $('#log-search').addEventListener('input', function () {
      clearTimeout(logTimer);
      logTimer = setTimeout(function () { state.logQ = $('#log-search').value.trim(); loadLog(true); }, 300);
    });
    $('#log-more').addEventListener('click', function () { loadLog(false); });
    $('#log-ai').addEventListener('click', function () { aiReport((state.log || []).slice(0, 100), logScope()); });
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
    $('#view-security').addEventListener('click', function (e) {
      var un = e.target.closest('[data-unblock]'); if (un) { secUnblock(un.dataset.unblock); return; }
      var bk = e.target.closest('[data-block-ip]'); if (bk) { secBlock('ip', bk.dataset.blockIp, '運営が手動でブロック'); return; }
      if (e.target.closest('[data-sec-lockdown]')) { secLockdown(); return; }
      if (e.target.closest('[data-sec-release]')) { secRelease(); return; }
    });
    $('#sec-block-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var scope = $('#sec-block-scope').value, target = $('#sec-block-target').value.trim(), reason = $('#sec-block-reason').value.trim();
      if (!target) { toast('対象を入力してください'); return; }
      secBlock(scope, target, reason).then(function () { $('#sec-block-target').value = ''; $('#sec-block-reason').value = ''; });
    });
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
    $('#vault-unlock').addEventListener('click', unlockVault);
    $('#vault-lock').addEventListener('click', function () { relock('閉じました（閲覧のみ）'); });
    // (a checkmark first: it only checks; an icon opens; the ⋯, 詳細 and 💬)
    ['#vault-list', '#vault-folders'].forEach(function (id) {
      $(id).addEventListener('click', onItems);
      $(id).addEventListener('contextmenu', onItemsMenu);
      // (a double click opens it too)
      $(id).addEventListener('dblclick', function (e) {
        if (e.target.closest('button, .vault-check, .vitem-detail, .vault-inline3d')) return;
        var row = e.target.closest('.vitem');
        if (row && row.dataset.folder) goFolder(row.dataset.folder);
        else if (row && fileOf(row.dataset.file)) openFile(fileOf(row.dataset.file));
      });
    });
    $('#vault-plus').addEventListener('click', plusMenu);
    $('#vault-link').addEventListener('click', linkMenu);
    $('#vault-memo').addEventListener('click', function () { state.vaultMemo = ''; renderMemo(); });
    $('#vmenu').addEventListener('click', onMenu);
    document.addEventListener('mousedown', function (e) { if (!$('#vmenu').hidden && !e.target.closest('#vmenu')) closeMenu(); }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#vmenu').hidden) closeMenu();
      else if (!$('#vcomments').hidden) closeComments();
    });
    window.addEventListener('scroll', menuMoved, true);
    window.addEventListener('resize', menuMoved);
    $('#vcomments-close').addEventListener('click', closeComments);
    $('#vcomments').addEventListener('click', function (e) { if (e.target.id === 'vcomments') closeComments(); });
    $('#vcomments-form').addEventListener('submit', sendComment);
    $('#vcomments-list').addEventListener('click', onComments);
    $('#vcomments-text').addEventListener('keydown', function (e) {
      // (Ctrl / ⌘ + Enter sends)
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendComment(e);
    });
    $('#vault-filter').addEventListener('click', function (e) {
      var c = e.target.closest('[data-vf]');
      if (!c) return;
      setShow(c.dataset.vf);
      state.vaultPage = 0;
      clearPicks();
      renderVault();
    });
    $('#vault-spaces').addEventListener('click', function (e) {
      var b = e.target.closest('[data-space]');
      if (b) goSpace(b.dataset.space);
    });
    // the vault's icon or its name: back to its top
    $('#vault-head').addEventListener('click', function (e) { if (e.target.closest('[data-vtop]')) goTop(); });
    $('#vault-title').addEventListener('click', goTop);
    $('#vault-room').addEventListener('click', onRoom);
    $('#vault-pick-all').addEventListener('click', pickAll);
    $('#vault-pager').addEventListener('click', function (e) {
      var b = e.target.closest('[data-page]');
      if (!b || b.disabled) return;
      state.vaultPage = Number(b.dataset.page);
      renderVault();
      $('#vault-path').scrollIntoView({ block: 'start' });
    });
    // uploads: やめる, 再開; the connection back: at once; and a look every 15 s
    upInit();
    $('#vault-jobs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-up-cancel]');
      if (b) cancelJob(b.dataset.upCancel);
    });
    $('#vault-resume').addEventListener('click', function () { resumeAll().catch(fail); });
    // the connection back: the stopped files at once
    window.addEventListener('online', wakeJobs);
    setInterval(function () {
      if (!token || $('#app').hidden || !Object.keys(up.jobs).some(function (k) { return up.jobs[k].state !== 'done'; })) return;
      kick();
      if (state.vault && !document.hidden) loadVault(true);
      // the server answering again: the files stopped for the connection go at once, not at their next try
      if (Object.keys(up.jobs).some(function (k) { return up.jobs[k].state === 'stop' && up.jobs[k].why === 'net'; })) {
        fetch('/api/health', { cache: 'no-store' }).then(function (r) { if (r.ok) wakeJobs(); }, function () {});
      }
    }, 15000);
    // (the countdown to each stopped file going again)
    setInterval(function () {
      Object.keys(up.jobs).forEach(function (k) { var j = up.jobs[k]; if (j.state === 'stop' && up.cards[k]) up.cards[k].note.textContent = jobText(j); });
    }, 1000);
    $('#vault-speed').addEventListener('change', function () { setVaultSpeed($('#vault-speed').value); });
    $('#vault-path').addEventListener('click', onFolder);
    $('#vault-picked-move').addEventListener('click', function () { moveItems(pickedFiles(), pickedFolders()); });
    $('#vault-picked-get').addEventListener('click', function () { downloadItems(pickedFiles(), pickedFolders()); });
    $('#vault-picked-delete').addEventListener('click', function () { deleteItems(pickedFiles(), pickedFolders()); });
    $('#vault-picked-clear').addEventListener('click', function () { clearPicks(); renderPicks(); });
    $('#vault-picked-backup').addEventListener('click', function () { backupItems(pickedFiles(), pickedFolders(), true); });
    $('#viewer-close').addEventListener('click', closeViewer);
    $('#viewer').addEventListener('click', function (e) { if (e.target.id === 'viewer') closeViewer(); });
    $('#vault-file').addEventListener('change', onFiles);
    var vm = $('#vault-main');
    vm.addEventListener('dragenter', onDragEnter);
    vm.addEventListener('dragover', onDragOver);
    vm.addEventListener('dragleave', onDragLeave);
    vm.addEventListener('drop', onDrop);
    // (a file dropped anywhere else on the site is not opened in its place)
    window.addEventListener('dragover', function (e) { if (dragFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', function (e) { if (dragFiles(e)) e.preventDefault(); });
    // leaving in the middle of an upload or a download
    // (uploads in the background worker go on: no question for them)
    window.addEventListener('beforeunload', function (e) {
      var here = Object.keys(up.jobs).some(function (k) { var j = up.jobs[k]; return j.state !== 'done' && (up.mode !== 'sw' || j.mem); });
      if (moving > 0 || here) { e.preventDefault(); e.returnValue = ''; }
    });

    $('#team-list').addEventListener('click', function (e) {
      var p = e.target.closest('[data-pair]');
      if (p) { openTeam(p.dataset.pair); return; }
      var b = e.target.closest('[data-peer]');
      if (b) openTeam(Number(b.dataset.peer));
    });
    $('#team-form').addEventListener('submit', sendTeam);
    $('#team-msgs').addEventListener('click', onTeamMsgs);
    $('#team-call').addEventListener('click', onCallButtons);
    $('#call-pill').addEventListener('click', onCallButtons);
    $('#team-at').addEventListener('click', function () { if (pick.mode === 'at') closePick(); else openPick('at', false); });
    $('#team-quote').addEventListener('click', function () { if (pick.mode === 'log') closePick(); else openPick('log', false); });
    $('#team-pick-list').addEventListener('click', onPickList);
    $('#team-pick-q').addEventListener('input', function () { clearTimeout(pick.timer); pick.timer = setTimeout(loadPick, 250); });
    $('#team-pick-q').addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closePick(); $('#team-text').focus(); }
      else if (e.key === 'Enter') { e.preventDefault(); var first = document.querySelector('#team-pick-list .team-pick-row'); if (first) first.click(); }
    });
    // "@" typed after a space (or at the start): the list opens
    $('#team-text').addEventListener('input', function (e) {
      var ta = e.target, i = ta.selectionStart, prev = ta.value.charAt(i - 2);
      if (e.data === '@' && ta.value.charAt(i - 1) === '@' && (i === 1 || /\s/.test(prev))) openPick('at', true);
    });
    // (the call goes when the page does)
    window.addEventListener('pagehide', function () { if (call.on) callLeave(); });
    $('#team-text').addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) sendTeam(e); });
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
    // (a viewer logged out a moment ago: why)
    var out = '';
    try { out = sessionStorage.getItem('ops-out') || ''; sessionStorage.removeItem('ops-out'); } catch (e) { /* none */ }
    if (!token) { showLogin(out); return; }
    request('GET', '/api/ops/me').then(arrive, function (err) { if (err.status !== 401 && err.code !== 'not_operator') showLogin(err.message); });
    // (back in sight: a viewer asks at once whether they still may; a new day, ログイン again)
    document.addEventListener('visibilitychange', alive);
    document.addEventListener('visibilitychange', dayCheck);
    setInterval(dayCheck, 60000);
  }

  init();
})();
