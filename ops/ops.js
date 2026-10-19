/* TWO STATE サーバー運営サイト (server/core/ops.js). The operator logs in
   once with their name and password (the session is kept on this browser);
   only the accounts the server names as operators get in. Everyone's money,
   connection, 引き継ぎコード and bans at a glance, a player's details with
   their play time, login days in a row and devices, and the actions:
   アクセス禁止 (a week), BAN (30 days), 永久BAN, lifting them, letting a player
   past a BAN on their device, a new 引き継ぎコード and a new password.
   Passwords are kept only as one-way hashes, so they can be set, never shown. */
(function () {
  'use strict';

  var KEY = 'two-state-ops/token';
  var REFRESH = 15000;
  var BAN = {
    suspend: { name: 'アクセス禁止', long: 'アクセス禁止（1週間）', cls: 'k-suspend' },
    ban: { name: 'BAN', long: 'BAN（30日）', cls: 'k-ban' },
    perma: { name: '永久BAN', long: '永久BAN（解除するまで）', cls: 'k-perma' }
  };

  var $ = function (s) { return document.querySelector(s); };
  var token = null;
  var state = { players: [], total: 0, now: Date.now(), filter: 'all', sort: 'new', q: '', open: 0, busy: false };
  var timer = 0, searchTimer = 0;

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
    if (p.avatar) f.style.backgroundImage = 'url("/img/avatars/' + encodeURIComponent(p.avatar) + '.webp")';
    else f.textContent = (Array.from(p.name || '?')[0] || '?').toUpperCase();
    if (big) f.classList.add('big');
    return f;
  }
  function banBadge(p) {
    if (p.ban) {
      var b = BAN[p.ban.kind] || BAN.perma;
      return el('span', 'ban ' + b.cls, b.name + (p.ban.until ? '（' + date(p.ban.until, true) + 'まで）' : ''));
    }
    if (p.deviceBlocked) return el('span', 'ban k-device', '端末のBANで停止中');
    return el('span', 'ban k-none', 'なし');
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

  /* ------------------------------------------------------------ logging in --- */
  function showLogin(message) {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = message || '';
    closeDetail();
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

  /* ------------------------------------------------------------ the list --- */
  function start(me) {
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#op-name').textContent = '運営者: ' + me.name;
    load();
    clearInterval(timer);
    timer = setInterval(function () { if (!document.hidden && $('#dialog').hidden) load(true); }, REFRESH);
  }
  function load(quiet) {
    return request('GET', '/api/ops/players' + (state.q ? '?q=' + encodeURIComponent(state.q) : '')).then(function (r) {
      state.players = r.players || [];
      state.total = r.total || 0;
      state.now = r.now || Date.now();
      render();
      if (state.open && quiet) refreshDetail();
    }, function (err) { if (!quiet) toast(err.message); });
  }
  function visible() {
    var list = state.players.filter(function (p) {
      if (state.filter === 'online') return p.online;
      if (state.filter === 'banned') return !!p.ban || p.deviceBlocked;
      return true;
    });
    var by = {
      new: function (a, b) { return b.createdAt - a.createdAt; },
      worth: function (a, b) { return b.worth - a.worth; },
      seen: function (a, b) { return (b.online - a.online) || (b.lastSeen - a.lastSeen); },
      play: function (a, b) { return b.playMs - a.playMs; }
    }[state.sort];
    return list.sort(by);
  }
  function render() {
    $('#sum-total').textContent = fmt(state.total);
    $('#sum-online').textContent = fmt(state.players.filter(function (p) { return p.online; }).length);
    $('#sum-banned').textContent = fmt(state.players.filter(function (p) { return p.ban || p.deviceBlocked; }).length);
    $('#sum-at').textContent = date(Date.now(), true).slice(11);
    var body = $('#rows');
    body.textContent = '';
    var list = visible();
    $('#empty').hidden = list.length > 0;
    list.forEach(function (p) { body.appendChild(rowEl(p)); });
  }
  function rowEl(p) {
    var tr = el('tr');
    tr.dataset.id = p.id;
    var who = el('td');
    who.setAttribute('data-label', 'プレイヤー');
    var w = el('div', 'who');
    w.appendChild(face(p));
    var t = el('div');
    var n = el('b', '', p.name);
    if (p.operator) { n.appendChild(document.createTextNode(' ')); n.appendChild(el('span', 'tag op', '運営')); }
    t.appendChild(n);
    t.appendChild(el('small', '', '登録 ' + date(p.createdAt)));
    w.appendChild(t);
    who.appendChild(w);
    tr.appendChild(who);
    var on = el('td');
    on.setAttribute('data-label', 'オンライン状況');
    var s = el('span', 'status' + (p.online ? ' on' : ''));
    s.appendChild(el('i', 'dot'));
    s.appendChild(document.createTextNode(p.online ? 'オンライン' : '最終 ' + ago(p.lastSeen)));
    on.appendChild(s);
    tr.appendChild(on);
    var money = el('td', 'num');
    money.setAttribute('data-label', '資産');
    var m = el('div', 'money');
    m.appendChild(el('b', '', '$' + fmt(p.worth)));
    m.appendChild(el('small', '', 'トークン ' + fmt(p.tokens) + '・$' + fmt(p.dollars) + '・コイン ' + fmt(p.coins)));
    money.appendChild(m);
    tr.appendChild(money);
    var code = el('td');
    code.setAttribute('data-label', '引き継ぎコード');
    code.appendChild(codeEl(p));
    tr.appendChild(code);
    var pw = el('td');
    pw.setAttribute('data-label', 'パスワード');
    pw.appendChild(el('span', 'muted', p.hasPassword ? '設定済み（非公開）' : '未設定'));
    tr.appendChild(pw);
    var ban = el('td');
    ban.setAttribute('data-label', '処分');
    ban.appendChild(banBadge(p));
    tr.appendChild(ban);
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
    }, function (err) { toast(err.message); });
  }
  function cell(label, value, wide) {
    var c = el('div', 'cell' + (wide ? ' wide' : ''));
    c.appendChild(el('span', '', label));
    c.appendChild(el('b', '', value));
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
    head.appendChild(face(p));
    var t = el('div');
    t.appendChild(el('h2', '', p.name));
    var s = el('span', 'status' + (p.online ? ' on' : ''));
    s.appendChild(el('i', 'dot'));
    s.appendChild(document.createTextNode(p.online ? 'オンライン' : '最終オンライン ' + date(p.lastSeen, true)));
    t.appendChild(s);
    head.appendChild(t);
    box.appendChild(head);

    var basic = section('基本情報');
    var g = el('div', 'grid');
    g.appendChild(cell('登録日', date(p.createdAt, true)));
    g.appendChild(cell('遊んでいる累計時間', hours(p.playMs)));
    g.appendChild(cell('最長連続オンライン日', fmt(p.dayBest) + '日'));
    g.appendChild(cell('いまの連続オンライン日', fmt(p.dayStreak) + '日'));
    g.appendChild(cell('ログイン日数', fmt(p.loginDays) + '日'));
    g.appendChild(cell('レベル', 'Lv.' + p.level + '（' + fmt(p.xp) + ' XP）'));
    g.appendChild(cell('フレンド', fmt(p.friends) + '人'));
    g.appendChild(cell('友達と稼ぐ', p.hub ? '参加中（ハブ #' + p.hub + '）' : 'なし'));
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
    var code = el('div', 'cell wide');
    code.appendChild(el('span', '', '引き継ぎコード'));
    code.appendChild(codeEl(p));
    g.appendChild(code);
    g.appendChild(cell('パスワード', p.hasPassword ? '設定済み（非公開）' : '未設定', true));
    acc.appendChild(g);
    acc.appendChild(el('p', 'note', 'パスワードは安全のため元に戻せない形（ハッシュ）でだけ保存しているので、運営者にも表示できません。忘れた人には新しいパスワードを設定してください。'));
    var a = el('div', 'acts');
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
      }).catch(function (err) { toast(err.message); }).then(function () { state.busy = false; });
    } else if (name === 'deviceOk') {
      ask({ title: '端末のBANから外しますか？', text: p.name + ' さんは、同じ端末のアカウントがBANされていても遊べるようになります（次にその端末のアカウントがBANされると、また止まります）。', ok: '外す' }).then(function (ok) {
        if (!ok) return null;
        return request('POST', '/api/ops/device-ok', { id: p.id }).then(function (r) { toast('端末のBANから外しました'); afterChange(r); });
      }).catch(function (err) { toast(err.message); });
    } else if (name === 'recovery') {
      ask({ title: '引き継ぎコードを再発行しますか？', text: '今までのコードは使えなくなります。本人であることを確かめてから発行してください。', ok: '再発行する' }).then(function (ok) {
        if (!ok) return null;
        return request('POST', '/api/ops/recovery', { id: p.id }).then(function (r) {
          afterChange(r);
          return ask({ title: '新しい引き継ぎコード', text: p.name + ' さんの新しいコードです: ' + r.code, ok: 'コピーして閉じる' }).then(function (c) { if (c) copy(r.code); });
        });
      }).catch(function (err) { toast(err.message); });
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
      }).catch(function (err) { toast(err.message); });
    }
  }

  /* ------------------------------------------------------------ start --- */
  function init() {
    $('#login-form').addEventListener('submit', onLogin);
    $('#logout').addEventListener('click', logout);
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
      var tr = e.target.closest('tr[data-id]');
      if (tr) openDetail(Number(tr.dataset.id));
    });
    $('#detail').addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]');
      if (c) { copy(c.dataset.copy); return; }
      var o = e.target.closest('[data-open]');
      if (o) { openDetail(Number(o.dataset.open)); return; }
      var b = e.target.closest('[data-act]');
      if (b) onAction(b);
    });
    $('#drawer-close').addEventListener('click', closeDetail);
    $('#drawer-back').addEventListener('click', closeDetail);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#dialog').hidden) { $('#dialog-cancel').click(); return; }
      closeDetail();
    });
    if (!token) { showLogin(''); return; }
    request('GET', '/api/ops/me').then(start, function (err) { if (err.status !== 401 && err.code !== 'not_operator') showLogin(err.message); });
  }

  init();
})();
