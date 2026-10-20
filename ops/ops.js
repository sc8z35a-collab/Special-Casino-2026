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
   - 保管庫 (the developer's own, opened with the developer code): big files
     sent in 1 MiB pieces checked by SHA-256 (a broken upload goes on where it
     stopped), fetched back the same way, and time-limited read-only links.
   Passwords are kept only as one-way hashes, so they can be set, never shown.
   On a phone the site goes full screen and landscape at the first tap; held
   upright where that is not possible, the whole site is turned sideways. */
(function () {
  'use strict';

  var KEY = 'two-state-ops/token';
  var REFRESH = 15000, CHAT_REFRESH = 5000;
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
    pay_order: '支払いページ', pay_paid: '購入（入金を確認）', pay_slip: 'コンビニ払いの番号', pay_unpaid: 'コンビニ未払い', pay_refund: '返金',
    pay_review: '決済の不一致（保留）', pay_reply: '開発者の返信', pay_error: '決済ページのエラー', pay_unknown: '不明な決済通知', pay_bad_signature: '不正な決済通知を拒否',
    vault_open: '保管庫を開いた', vault_upload: '保管庫に保存', vault_delete: '保管庫から削除', vault_link: '保管庫のリンク作成',
    vault_link_stop: '保管庫のリンク停止', vault_pull: '保管庫からリンクで取得'
  };
  function actionName(a) { return ACTIONS[a] || (a.indexOf('admin:') === 0 ? '管理コマンド: ' + a.slice(6) : a); }
  var REPORT_PLACES = { profile: 'プロフィール', hub: '「一緒に稼ぐ」', search: 'フレンド検索', chat: 'チャット' };
  var FB_ITEMS = { slot: 'スロットの面白さ', features: 'スロット以外の機能の面白さ', clarity: '全体的なわかりやすさ', controls: '操作性', looks: '見やすさ', polish: '完成度' };

  var $ = function (s) { return document.querySelector(s); };
  var token = null;
  var state = {
    view: 'players', players: [], total: 0, counts: {}, now: Date.now(), filter: 'all', sort: 'new', q: '', open: 0, busy: false,
    reportStatus: 'open', detAll: false, fb: 'open', feedback: [], log: [], logQ: '', logDone: false, chat: null,
    developer: false, operators: [], pay: null, payView: 'waiting', vault: null, vaultFiles: []
  };
  var timer = 0, searchTimer = 0, logTimer = 0, chatTimer = 0;

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
          var err = { status: res.status, code: e.code || '', message: e.message || 'エラーが発生しました（' + res.status + '）' };
          if (res.status === 401 || e.code === 'not_operator' || e.code === 'banned') signedOut(err.message);
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
    setTimeout(function () { $('#login-name').focus(); }, 50);
  }
  function signedOut(message) {
    setToken(null);
    showLogin(message);
  }
  function onLogin(e) {
    e.preventDefault();
    var name = $('#login-name').value.trim(), pass = $('#login-pass').value;
    if (!name || !pass) { $('#login-error').textContent = '名前とパスワードを入力してください'; return; }
    var go = $('#login-go');
    go.disabled = true;
    $('#login-error').textContent = '';
    request('POST', '/api/login', { name: name, password: pass }).then(function (r) {
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
      $('#login-error').textContent = err.message;
    }).then(function () { go.disabled = false; });
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
    clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden || !$('#dialog').hidden || !$('#money').hidden) return;
      load(true);
      if (state.view === 'reports') loadReports(true);
      else if (state.view === 'detections') loadDetections(true);
      else if (state.view === 'feedback') loadFeedback(true);
      if (state.developer && !(state.view === 'pay' && document.activeElement && document.activeElement.tagName === 'TEXTAREA')) loadPay(true);
    }, REFRESH);
  }
  function setView(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) { t.classList.toggle('on', t.dataset.view === v); });
    ['players', 'reports', 'detections', 'feedback', 'log', 'operators', 'pay', 'vault'].forEach(function (x) { $('#view-' + x).hidden = x !== v; });
    if (v === 'players') load();
    else if (v === 'operators') loadOperators();
    else if (v === 'reports') loadReports();
    else if (v === 'detections') loadDetections();
    else if (v === 'feedback') loadFeedback();
    else if (v === 'log') { loadLog(true); verifyLog(); }
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
    if (p.operator) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag op', '運営')); }
    if (p.vip !== null && p.vip !== undefined) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag vip vip-' + p.vip, 'VIP' + p.vip)); }
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

    var bot = section('Ice Smoker公式');
    if (p.waiting) bot.appendChild(el('p', 'note bad', 'このプレイヤーのメッセージが返信を待っています。'));
    var a = el('div', 'acts');
    a.appendChild(act('チャットを開く', 'chat', 'primary'));
    a.appendChild(act('送金する', 'money'));
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
    acc.appendChild(el('p', 'note', 'パスワードは安全のため元に戻せない形（ハッシュ）でだけ保存しているので、運営者にも表示できません。忘れた人には新しいパスワードを設定してください。'));
    a = el('div', 'acts');
    a.style.marginTop = '10px';
    a.appendChild(act('引き継ぎコードを再発行', 'recovery'));
    a.appendChild(act('パスワードを再設定', 'password'));
    acc.appendChild(a);
    box.appendChild(acc);

    var ban = section('処分');
    var now = el('p', 'note' + (p.ban || p.deviceBlocked ? ' bad' : ''));
    now.textContent = p.ban ? p.ban.message + '（' + date(p.ban.at, true) + ' に実施）'
      : p.deviceBlocked ? 'この端末にBAN中のアカウントがあるため、このアカウントもアクセスできません。'
        : '処分はありません。';
    ban.appendChild(now);
    if (p.operator) {
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
      ban.appendChild(el('p', 'muted', 'アクセス禁止は1週間、BANは30日で自動的に解除されます（いつでも解除できます）。BAN・永久BANをすると、同じ端末で使われたほかのアカウントもアクセスできなくなります。'));
    }
    box.appendChild(ban);

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
      $('#dialog').hidden = false;
      setTimeout(function () { (o.input ? input : ok).focus(); }, 30);
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
        done(o.input ? input.value : true);
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
    if (name === 'ban') {
      var kind = b.dataset.kind;
      var info = BAN[kind];
      ask(kind === 'none'
        ? { title: '処分を解除しますか？', text: p.name + ' さんはすぐにまた遊べるようになります。公式から解除のお知らせが届きます。', ok: '解除する' }
        : { title: info.long + 'にしますか？', text: p.name + ' さんのゲームはすぐにタイトル画面に戻り、' + (kind === 'perma' ? '解除するまで' : kind === 'ban' ? '30日間' : '1週間') + 'そこから先へ進めなくなります（TWO STATE を遊べません）。公式から「' + date(Date.now(), true) + 'に公式より' + info.name + 'されました」とお知らせが届き、解除されたときもお知らせが届きます。' + (kind === 'suspend' ? '' : '同じ端末のほかのアカウントも止まります。'), ok: info.name + 'にする', danger: true }
      ).then(function (ok) {
        if (!ok) return null;
        state.busy = true;
        return request('POST', '/api/ops/ban', { id: p.id, kind: kind }).then(function (r) {
          toast(kind === 'none' ? '処分を解除しました' : info.long + 'にしました');
          afterChange(r);
        });
      }).catch(fail).then(function () { state.busy = false; });
    } else if (name === 'deviceOk') {
      ask({ title: '端末のBANから外しますか？', text: p.name + ' さんは、同じ端末のアカウントがBANされていても遊べるようになります（次にその端末のアカウントがBANされると、また止まります）。', ok: '外す' }).then(function (ok) {
        if (!ok) return null;
        return request('POST', '/api/ops/device-ok', { id: p.id }).then(function (r) { toast('端末のBANから外しました'); afterChange(r); });
      }).catch(fail);
    } else if (name === 'recovery') {
      ask({ title: '引き継ぎコードを再発行しますか？', text: '今までのコードは使えなくなります。本人であることを確かめてから発行してください。', ok: '再発行する' }).then(function (ok) {
        if (!ok) return null;
        return request('POST', '/api/ops/recovery', { id: p.id }).then(function (r) {
          afterChange(r);
          return ask({ title: '新しい引き継ぎコード', text: p.name + ' さんの新しいコードです: ' + r.code, ok: 'コピーして閉じる' }).then(function (c) { if (c) copy(r.code); });
        });
      }).catch(fail);
    } else if (name === 'password') {
      ask({
        title: 'パスワードを再設定',
        text: p.name + ' さんの新しいパスワードを入力してください（4〜64文字）。本人であることを確かめてから設定してください。',
        ok: '設定する',
        input: { label: '新しいパスワード', type: 'text' },
        check: function (v) { var n = Array.from(v).length; return n < 4 ? '4文字以上にしてください' : n > 64 ? '64文字までです' : ''; }
      }).then(function (pw) {
        if (pw === null) return null;
        return request('POST', '/api/ops/password', { id: p.id, password: pw }).then(function (r) { toast('パスワードを設定しました'); afterChange(r); });
      }).catch(fail);
    }
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
    clearInterval(chatTimer);
    chatTimer = setInterval(function () { if (!document.hidden && state.chat) loadChat(false); }, CHAT_REFRESH);
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
    if (!r.messages.length) list.appendChild(el('p', 'chat-empty', 'まだメッセージはありません。下から最初のメッセージを送れます。'));
    var lastDay = '';
    r.messages.forEach(function (m) {
      var day = date(m.at);
      if (day !== lastDay) { list.appendChild(el('div', 'day', day)); lastDay = day; }
      var mine = !!(m.from && r.bot && m.from.id === r.bot.id);
      var node = el('div', 'msg ' + (mine ? 'bot' : 'player') + (m.kind === 'transfer' ? ' money' : ''));
      var text = m.kind === 'transfer' ? '送金 ' + (m.currency === 'tokens' ? fmt(m.amount) + ' トークン' : '$' + fmt(m.amount))
        : m.kind === 'present' ? 'プレゼント（' + m.text + '）' : m.kind === 'system' ? m.text : m.text;
      node.appendChild(el('div', 'bubble', text));
      var meta = el('div', 'msg-meta');
      if (mine && r.playerReadUpTo >= m.id) meta.appendChild(el('b', '', '既読'));
      meta.appendChild(document.createTextNode(stamp(m.at)));
      node.appendChild(meta);
      list.appendChild(node);
    });
    if (stick || atBottom) sc.scrollTop = sc.scrollHeight;
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
    ask({ title: '$' + fmt(amount) + ' を送りますか？', text: p.name + ' さんへ Ice Smoker公式から送金します。' + (note ? '「' + note + '」も一緒に届きます。' : ''), ok: '送金する' }).then(function (ok) {
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
    card.appendChild(el('p', 'body-text', r.text));
    var ctx = r.context || {}, t = ctx.target || {};
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
      ? { title: '通報 #' + id + ' を受理しますか？', text: '通報した人へ Ice Smoker公式から $' + fmt(reward) + ' と感謝のメッセージが自動で届きます。', ok: '受理して送る' }
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
    ask({ title: 'この意見案を採用しますか？', text: who + ' さんに Ice Smoker公式から 50,000 スピントークンと感謝のメッセージが届きます（1つの意見案につき1回）。', ok: '採用する' }).then(function (ok) {
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
      ? '開発者コードは登録済みです（変更するときは今のコードが必要です）。'
      : '開発者コードがまだ登録されていません。運営権の付与・剥奪に使うコードを、最初に一度だけ登録してください（サーバーには元に戻せない形でだけ保存されます）。';
    $('#op-devcode-btn').textContent = state.devCodeSet ? '開発者コードを変更' : '開発者コードを登録';
    var list = $('#op-list');
    list.textContent = '';
    state.operators.forEach(function (o) {
      var card = el('article', 'card' + (o.operator ? '' : ' done'));
      var head = el('div', 'card-head');
      head.appendChild(person({ id: o.id, name: o.name, avatar: o.avatar }, o.registered ? (o.online ? 'オンライン' : '') : 'アカウント未登録'));
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
      ? { title: name + ' さんの運営権を剥奪しますか？', text: name + ' さんはすぐにすべての端末でログアウトされ、運営サイトにログインできなくなります（ゲームには一般のプレイヤーとしてログインできます）。', ok: '剥奪する', danger: true }
      : { title: name + ' さんに運営権を付与しますか？', text: name + ' さんは運営サイトにログインして、運営のすべての操作ができるようになります。', ok: '付与する' }
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
        text: '8〜32桁の数字。開発者だけが知っているコードにしてください（ここにもサーバーにも、元のコードは残りません）。',
        ok: '登録する',
        input: { label: '開発者コード', type: 'password' },
        check: function (v) { return /^\d{8,32}$/.test(v.replace(/[\s-]/g, '')) ? '' : '8〜32桁の数字にしてください'; }
      }).then(function (code) {
        if (code === null) return null;
        return request('POST', '/api/ops/dev-code', { code: code, old: old }).then(function () {
          state.devCodeSet = true;
          toast('開発者コードを登録しました');
          renderOperators();
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
    if (t.review) notes.push('⚠ Stripe の内容と一致しない注文が ' + t.review + '件あります（ロイヤルコインは付与していません。Stripe のダッシュボードで確認してください）');
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
    ta.placeholder = w.player.name + 'さんへの熱いお言葉（公式から【開発者からのメッセージ】として届きます）';
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
  function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(n >= 104857600 ? 0 : 1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
  function lockVault(message) {
    state.vault = null;
    state.vaultFiles = [];
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
      if (state.vault) { state.vault.used = r.used; state.vault.all = r.all; }
      renderVault();
    }, fail);
  }
  function renderVault() {
    var open = !!state.vault;
    $('#vault-closed').hidden = open;
    $('#vault-main').hidden = !open;
    $('#vault-lock').hidden = !open;
    $('#vault-usage').textContent = open ? '使用量 ' + mb(state.vault.used) + ' / ' + mb(state.vault.maxBytes) + '（1ファイル ' + mb(state.vault.fileBytes) + 'まで）' : '';
    var list = $('#vault-list');
    list.textContent = '';
    if (!open) return;
    var all = state.vault.all || { live: 0 };
    $('#vault-all-state').textContent = all.live ? '保管庫全体のリンク：' + all.live + '本 有効（' + stamp(all.until) + 'まで・取得 ' + fmt(all.uses) + '回）' : '保管庫全体のリンク：なし';
    $('#vault-all-stop').hidden = !all.live;
    // a model's light copy shows with the model
    var tops = state.vaultFiles.filter(function (f) { return !f.parent; });
    if (!tops.length) list.appendChild(el('p', 'empty muted', 'ファイルはまだありません'));
    tops.forEach(function (f) { list.appendChild(vaultCard(f)); });
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
  function vaultCard(f) {
    var card = el('article', 'card vault-card' + (f.done ? '' : ' done'));
    card.dataset.file = f.id;
    var head = el('div', 'card-head');
    head.appendChild(el('b', 'vault-name', f.name));
    head.appendChild(el('span', 'kind ' + (f.done ? 'accepted' : 'bug'), f.done ? '保存済み' : 'アップロード途中 ' + f.received + '/' + f.chunks));
    head.appendChild(el('span', 'time', stamp(f.createdAt)));
    card.appendChild(head);
    var light = lightOf(f);
    var body = el('div', 'vault-body');
    if (f.preview) body.appendChild(picEl(f));
    else if (f.done && is3d(f.name)) body.appendChild(el('div', 'vault-pic none', 'プレビューなし'));
    var facts = el('div', 'facts');
    if (f.info) modelFacts(facts, f.info, light);
    fact(facts, '大きさ', mb(f.size) + '（' + fmt(f.size) + 'バイト）');
    fact(facts, '種類', f.type || '-');
    fact(facts, 'SHA-256（部分ごとのハッシュの並び）', f.sha256 || '-');
    fact(facts, '読み取り専用リンク', f.links.live ? f.links.live + '本 有効（' + stamp(f.links.until) + 'まで）' : 'なし');
    fact(facts, 'リンクからの取得', fmt(f.links.uses) + '回');
    if (f.note) fact(facts, 'メモ', f.note);
    body.appendChild(facts);
    card.appendChild(body);
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
      btn('読み取り専用リンクを作る', 'link', 'primary');
      if (f.links.live) btn('リンクを停止', 'stop', 'warn');
    } else {
      btn('続きから送る（同じファイルを選ぶ）', 'resume', 'primary');
    }
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
      fail: function (msg) { end(); card.classList.add('bad'); note.textContent = msg; }
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
  // three pieces at a time; a piece that fails is tried again (3 times)
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
    return Promise.all([worker(), worker(), worker()]).then(function () { if (failed) throw failed; });
  }
  function upload(file, resumeId, parent) {
    var CH = state.vault.chunk, j = job(file.name + '（アップロード）'), made = null;
    var begin = resumeId
      ? vreq('GET', '/api/vault/missing?id=' + resumeId).then(function (r) {
        if (r.file.size !== file.size) throw { message: 'ファイルの大きさが違います。同じファイルを選んでください' };
        var todo = [];
        r.missing.forEach(function (m) { for (var n = m[0]; n <= m[1]; n++) todo.push(n); });
        return { file: r.file, todo: todo };
      })
      : vreq('POST', '/api/vault/files', { name: file.name, size: file.size, type: file.type || '', note: parent ? '' : $('#vault-note').value.trim(), parent: parent || undefined }).then(function (r) {
        var todo = [];
        for (var n = 0; n < r.file.chunks; n++) todo.push(n);
        return { file: r.file, todo: todo };
      });
    var last = null;
    return begin.then(function (b) {
      made = b.file;
      var done = b.file.chunks - b.todo.length;
      j.set(done, b.file.chunks);
      return pieces(b.todo, function (n) {
        return file.slice(n * CH, Math.min(file.size, (n + 1) * CH)).arrayBuffer().then(function (buf) {
          return sha(buf).then(function (h) {
            return vreq('POST', '/api/vault/chunk', { id: b.file.id, n: n, sha256: hex(h), data: base64(new Uint8Array(buf)) });
          });
        }).then(function (r) { last = r; done++; j.set(done, b.file.chunks); });
      });
    }).then(function () {
      j.finish(last && last.done ? '保存しました（SHA-256 ' + String(last.sha256).slice(0, 16) + '…）' : '送り終えました');
      if (!parent) $('#vault-note').value = '';
      return loadVault().then(function () { if (!parent && made && is3d(file.name)) return preview(made, file); });
    }, function (err) { j.fail((err && err.message) || 'アップロードできませんでした'); return loadVault(); });
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
        return upload(new File([r.light], base + '.light.glb', { type: 'model/gltf-binary' }), null, f.id);
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
      title: f ? '読み取り専用リンクを作る' : '保管庫全体のリンクを作る',
      text: (f ? '「' + f.name + '」（画像・情報・軽量版つき）' : '保管庫のすべてのファイル（画像・情報・軽量版つき）') + 'を、ログインなしで取り出せるリンクです（リンクは一度しか表示されません）。有効時間を ' + hours.join('・') + ' 時間から選んで入れてください。',
      ok: '作る', input: { label: '有効時間（時間）', type: 'text', value: '24' },
      check: function (v) { return hours.indexOf(Number(v)) >= 0 ? '' : hours.join('・') + ' のどれかを入れてください'; }
    }).then(function (v) {
      if (v === null) return null;
      return vreq('POST', '/api/vault/link', { id: f ? f.id : '*', hours: Number(v) }).then(function (r) {
        var url = location.origin + r.path;
        copy(url);
        loadVault();
        return ask({ title: 'リンクを作りました（' + v + '時間有効・コピー済み）', text: url + '\n\n' + (f ? 'このリンクを知っている人は、期限までこのファイルだけを取り出せます。' : 'このリンクを知っている人は、期限まで保管庫のすべてのファイルを取り出せます。') + '用が済んだら停止してください。', ok: 'OK' });
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
    else if (act === 'resume') { state.resumeId = f.id; $('#vault-file').click(); }
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
  // files picked: one after another (an unfinished one with the same name and size goes on where it stopped)
  function onFiles() {
    var input = $('#vault-file'), files = Array.prototype.slice.call(input.files || []), resume = state.resumeId;
    input.value = '';
    state.resumeId = null;
    if (!state.vault) return;
    files.reduce(function (p, file) {
      return p.then(function () {
        if (!state.vault) return null;
        if (file.size > state.vault.fileBytes) { toast('「' + file.name + '」は大きすぎます（1ファイル ' + mb(state.vault.fileBytes) + 'まで）'); return null; }
        var half = state.vaultFiles.filter(function (x) { return !x.done && (resume ? x.id === resume : x.name === file.name && x.size === file.size); })[0];
        return upload(file, half ? half.id : null);
      });
    }, Promise.resolve());
  }

  /* ------------------------------------------------------------ the operators' log --- */
  function loadLog(reset) {
    var list = $('#log-list');
    if (reset) { state.log = []; state.logDone = false; list.textContent = ''; list.appendChild(el('p', 'empty muted', '読み込み中…')); }
    var before = !reset && state.log.length ? state.log[state.log.length - 1].id : 0;
    request('GET', '/api/ops/log?q=' + encodeURIComponent(state.logQ) + (before ? '&before=' + before : '')).then(function (r) {
      if (reset) list.textContent = '';
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
      v.textContent = r.ok ? '✓ 改ざんチェック: すべての記録（' + fmt(r.count) + '件）が正しくつながっています'
        : '⚠ 改ざんチェック: ' + r.brokenAt + '番の記録で異常があります（' + r.reason + '）';
    }, function () {});
  }
  function logEntry(x) {
    var row = el('div', 'entry');
    var line = el('button', 'entry-line');
    line.type = 'button';
    line.appendChild(el('span', 'time', String(x.jst || '').replace(/\.\d+ JST$/, '')));
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
    window.addEventListener('beforeunload', function (e) { if (moving > 0) { e.preventDefault(); e.returnValue = ''; } });

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
