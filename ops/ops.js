/* TWO STATE サーバー運営サイト (server/core/ops.js). The operator logs in
   once with their name and password (the session is kept on this browser);
   only the accounts the server names as operators get in.
   - プレイヤー: everyone's money, connection, 18歳以上, 引き継ぎコード and bans
     at a glance, with marks on the icons (返信待ち: a message to the official
     bot waits for an answer; 検知: the chat filter found something). A tap on
     an icon opens the conversation with Ice Smoker公式ボット (opening it marks
     the player's messages read), a tap on the row the player's details and
     the actions: アクセス禁止 (a week), BAN (30 days), 永久BAN, lifting them,
     letting a player past a BAN on their device, a new 引き継ぎコード, a new
     password, a message from the bot (件名, 〇〇様, the matter, Ice Smoker公式
     より) and money from the bot ($0〜1000万).
   - 通報: accepted with a reward of 60万 / 120万 / 240万 sent by the bot with
     its thanks, or declined. 検知: the original words. 報告・意見案.
   - ログ: everything done here, and every DEV going live, newest first; a tap
     shows all that is known about it. It cannot be changed or deleted.
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
    device_ok: '端末の許可', recovery: '引き継ぎコード再発行', password: 'パスワード再設定', bot_read: 'チャットを既読', bot_message: '公式ボットのメッセージ',
    money: '送金', report_accept: '通報を受理', report_reject: '通報を不受理', detections_reviewed: '検知を確認', feedback_handled: '報告・意見案を対応済み',
    bot_auto_reply: '自動返信'
  };
  var REPORT_PLACES = { profile: 'プロフィール', hub: '「一緒に稼ぐ」', search: 'フレンド検索', chat: 'チャット' };
  var FB_ITEMS = { slot: 'スロットの面白さ', features: 'スロット以外の機能の面白さ', clarity: '全体的なわかりやすさ', controls: '操作性', looks: '見やすさ', polish: '完成度' };

  var $ = function (s) { return document.querySelector(s); };
  var token = null;
  var state = {
    view: 'players', players: [], total: 0, counts: {}, now: Date.now(), filter: 'all', sort: 'new', q: '', open: 0, busy: false,
    reportStatus: 'open', detAll: false, fb: 'open', feedback: [], log: [], logQ: '', logDone: false, chat: null
  };
  var timer = 0, searchTimer = 0, logTimer = 0, chatTimer = 0;

  try { token = localStorage.getItem(KEY); } catch (e) { token = null; }

  /* ------------------------------------------------------------ the server --- */
  function request(method, path, body) {
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
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
    b.title = p.name + 'さんと公式ボットのチャットを開く';
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
    $('#op-name').textContent = '運営者: ' + me.name;
    load();
    clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden || !$('#dialog').hidden || !$('#money').hidden) return;
      load(true);
      if (state.view === 'reports') loadReports(true);
      else if (state.view === 'detections') loadDetections(true);
      else if (state.view === 'feedback') loadFeedback(true);
    }, REFRESH);
  }
  function setView(v) {
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (t) { t.classList.toggle('on', t.dataset.view === v); });
    ['players', 'reports', 'detections', 'feedback', 'log'].forEach(function (x) { $('#view-' + x).hidden = x !== v; });
    if (v === 'players') load();
    else if (v === 'reports') loadReports();
    else if (v === 'detections') loadDetections();
    else if (v === 'feedback') loadFeedback();
    else if (v === 'log') { loadLog(true); verifyLog(); }
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
    m.appendChild(el('small', '', 'トークン ' + fmt(p.tokens) + '・$' + fmt(p.dollars) + '・コイン ' + fmt(p.coins)));
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

    var bot = section('Ice Smoker公式ボット');
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
    g.appendChild(cell('コイン', fmt(p.coins)));
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
        ? { title: '処分を解除しますか？', text: p.name + ' さんはすぐにまた遊べるようになります。', ok: '解除する' }
        : { title: info.long + 'にしますか？', text: p.name + ' さんはすぐにログアウトされ、' + (kind === 'perma' ? '解除するまで' : kind === 'ban' ? '30日間' : '1週間') + 'TWO STATE を遊べなくなります。' + (kind === 'suspend' ? '' : '同じ端末のほかのアカウントも止まります。'), ok: info.name + 'にする', danger: true }
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
    t.appendChild(el('b', '', p.name + ' さん と Ice Smoker公式ボット'));
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
    ask({ title: '$' + fmt(amount) + ' を送りますか？', text: p.name + ' さんへ Ice Smoker公式ボットから送金します。' + (note ? '「' + note + '」も一緒に届きます。' : ''), ok: '送金する' }).then(function (ok) {
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
      ? { title: '通報 #' + id + ' を受理しますか？', text: '通報した人へ Ice Smoker公式ボットから $' + fmt(reward) + ' と感謝のメッセージが自動で届きます。', ok: '受理して送る' }
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
      if (!f.handledAt) {
        var h = el('button', 'btn small ok', '対応済みにする');
        h.type = 'button';
        h.dataset.handled = f.id;
        a.appendChild(h);
      } else {
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
    var b = e.target.closest('[data-handled]');
    if (!b) return;
    b.disabled = true;
    request('POST', '/api/ops/feedback/handled', { id: Number(b.dataset.handled) }).then(function () {
      toast('対応済みにしました');
      loadFeedback(true);
      load(true);
    }, function (err) { b.disabled = false; fail(err); });
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
      ['操作', (ACTIONS[x.action] || x.action) + '（' + x.action + '）'],
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
    $('#log-search').addEventListener('input', function () {
      clearTimeout(logTimer);
      logTimer = setTimeout(function () { state.logQ = $('#log-search').value.trim(); loadLog(true); }, 300);
    });
    $('#log-more').addEventListener('click', function () { loadLog(false); });

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
