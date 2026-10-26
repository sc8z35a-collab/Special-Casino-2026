/* CDW 1.0 — custom desktop window. The desktop's own icon ("デスクトップ") turns it on: the apps go see-through, the notification
   centre goes, only the app bar stays, and small windows (the server's figures, the reports, the last six lines of the log,
   the operators' chat, …) can be put on the desktop, each as big as you like, never over one another.

   What a person may have is decided by the server (server/core/cdw.js): the catalog comes from it, cut to who they are, and the
   layout is kept there and refused there if it holds a window that is not theirs. This file only draws what it is given. A window
   the server did not list is never built, whatever is in this browser; and what a window shows comes from the same routes as the
   apps, each of which asks the same of the person (a developer's or an operator's window shows nothing to anyone else even if this
   file were changed by hand). Text only ever goes in with textContent. */
var OpsCDW = (function () {
  'use strict';
  var app = document.getElementById('app'), area = document.getElementById('mac-windows');
  if (!app || !area) return { toggle: function () {}, session: function () {}, off: function () {}, on: function () { return false; } };

  var CELL = 24, MARGIN = { left: 140, top: 74, right: 20, bottom: 104 };
  var S = { role: '', catalog: [], grid: { maxCols: 160, maxRows: 90, maxItems: 12 }, items: [], loaded: false, loading: null, on: false, cols: 0, rows: 0, x0: 0, y0: 0, hidden: {} };
  var layer = null, bar = null, palette = null, note = null, saveTimer = 0, fadeTimer = 0, resizeTimer = 0, live = {}, keeps = {};
  var motion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function h(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function btn(cls, text, label) { var b = h('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; }
  function io() { return window.OpsExt ? OpsExt.io() : { request: null, toast: function () {}, live: function () { return false; } }; }
  function req(method, path, body) { var r = io().request; return r ? r(method, path, body) : Promise.reject({ status: 0 }); }
  function toast(t) { try { io().toast(t); } catch (e) { /* the page's own toast is a convenience */ } }
  function reduced() { return motion.matches || document.body.classList.contains('mac-reduce-motion'); }
  function phone() { return document.body.classList.contains('mac-phone'); }
  function fmt(n) { return Number(n || 0).toLocaleString('ja-JP'); }
  function bytes(n) { n = Number(n) || 0; if (n < 1024) return Math.round(n) + 'B'; if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + 'KB'; if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + 'MB'; return (n / 1073741824).toFixed(2) + 'GB'; }
  function ago(ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    return s < 60 ? s + '秒前' : s < 3600 ? Math.floor(s / 60) + '分前' : s < 86400 ? Math.floor(s / 3600) + '時間前' : Math.floor(s / 86400) + '日前';
  }
  function clip(t, n) { t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  var NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) { var n = document.createElementNS(NS, tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function avatarOf(name) { return name ? 'url("/img/avatars/' + encodeURIComponent(name) + '.webp")' : ''; }

  /* ------------------------------------------------------------ the layout: cells, and never one over another --- */
  function hit(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  function inside(r) { return r.x >= 0 && r.y >= 0 && r.x + r.w <= S.cols && r.y + r.h <= S.rows; }
  function clear(r, skip) { return inside(r) && S.items.every(function (o) { return o === skip || S.hidden[o.id] || !hit(r, o); }); }
  function spot(w, hgt, skip) {
    for (var y = 0; y + hgt <= S.rows; y++) for (var x = 0; x + w <= S.cols; x++) if (clear({ x: x, y: y, w: w, h: hgt }, skip)) return { x: x, y: y };
    return null;
  }
  function entry(id) { return S.catalog.filter(function (c) { return c.id === id; })[0]; }
  // a window of this id at its own size, or smaller (never below its least) where there is room
  function place(c, skip) {
    for (var k = 0; k < 24; k++) {
      var w = Math.max(c.min[0], c.w - k * 2), hh = Math.max(c.min[1], c.h - k * 2), s = spot(w, hh, skip);
      if (s) return { id: c.id, x: s.x, y: s.y, w: w, h: hh };
      if (w === c.min[0] && hh === c.min[1]) break;
    }
    return null;
  }
  // the screen this time: what no longer fits is put where it does, or left out of sight (not lost: the server still has it)
  function fitAll() {
    var list = S.items.slice().sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });
    S.hidden = {};
    var kept = [];
    list.forEach(function (it) {
      var c = entry(it.id);
      if (!c) return;
      it.w = Math.min(Math.max(it.w, c.min[0]), Math.min(c.max[0], S.cols)); it.h = Math.min(Math.max(it.h, c.min[1]), Math.min(c.max[1], S.rows));
      var ok = inside(it) && kept.every(function (o) { return !hit(it, o); });
      if (!ok) {
        var s = (function () { for (var y = 0; y + it.h <= S.rows; y++) for (var x = 0; x + it.w <= S.cols; x++) { var r = { x: x, y: y, w: it.w, h: it.h }; if (kept.every(function (o) { return !hit(r, o); })) return r; } return null; })();
        if (s) { it.x = s.x; it.y = s.y; } else { S.hidden[it.id] = true; return; }
      }
      kept.push(it);
    });
  }
  function measure() {
    var W = app.clientWidth, H = app.clientHeight;
    S.x0 = MARGIN.left; S.y0 = MARGIN.top;
    S.cols = Math.max(0, Math.min(S.grid.maxCols, Math.floor((W - MARGIN.left - MARGIN.right) / CELL)));
    S.rows = Math.max(0, Math.min(S.grid.maxRows, Math.floor((H - MARGIN.top - MARGIN.bottom) / CELL)));
  }

  /* ------------------------------------------------------------ keeping it (the server decides) --- */
  function layout() { return { v: 1, items: S.items.map(function (i) { return { id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }; }) }; }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      req('POST', '/api/ops/cdw', { layout: layout() }).then(function () {}, function (err) {
        toast((err && err.message) || '配置を保存できませんでした');
        // what the server holds is the truth: ask again and draw that
        S.loaded = false; load().then(function () { if (S.on) { measure(); fitAll(); renderAll(); } });
      });
    }, 500);
  }
  function load() {
    if (S.loading) return S.loading;
    S.loading = req('GET', '/api/ops/cdw').then(function (r) {
      S.role = r.role; S.catalog = r.catalog || []; S.grid = r.grid || S.grid; S.items = (r.layout && r.layout.items) || []; S.loaded = true;
    }, function () { S.loaded = false; }).then(function () { S.loading = null; });
    return S.loading;
  }

  /* ------------------------------------------------------------ the windows' contents --- */
  // each: how to draw the inside once, and what it asks for (`ask(keep)`: a route the app uses, with what it has: ops/beat.js asks for every
  // window in one request at the site's pace, `live` ones at the live views' pace)
  var W = {};
  function statBox(label, value, sub) {
    var b = h('div', 'cdw-stat'); b.appendChild(h('span', 'cdw-stat-l', label)); b.appendChild(h('b', 'cdw-stat-v', value)); if (sub) b.appendChild(h('small', '', sub));
    return b;
  }
  function more(api, id, text) { var b = btn('cdw-more', text || 'アプリで開く'); b.addEventListener('click', function () { api.open(id); }); return b; }
  function empty(text) { return h('p', 'cdw-empty', text); }
  // rows of text: [time ago, headline, detail]
  function lines(list, max) {
    var ul = h('ul', 'cdw-lines');
    list.slice(0, max).forEach(function (x) {
      var li = h('li'); li.appendChild(h('span', 'cdw-line-t', x[0])); var b = h('span', 'cdw-line-x'); b.appendChild(h('b', '', x[1])); if (x[2]) b.appendChild(h('span', '', x[2])); li.appendChild(b); ul.appendChild(li);
    });
    return ul;
  }

  W.server = {
    live: true,
    // (the history this window holds is not sent again: only the seconds after it)
    ask: function (keep) { return { p: '/api/ops/server?lean=1' + (keep.hist && keep.hist.length ? '&hs=' + (keep.hist[keep.hist.length - 1][0] - 1) : '') }; },
    mount: function (body, api) {
      var top = h('div', 'cdw-stats'), box = h('div', 'cdw-graph'), foot = h('div', 'cdw-legend');
      var chart = svg('svg', { viewBox: '0 0 300 90', preserveAspectRatio: 'none', 'class': 'cdw-chart', 'aria-hidden': 'true' });
      box.appendChild(chart);
      foot.appendChild(h('span', 'lg-req', 'リクエスト')); foot.appendChild(h('span', 'lg-bytes', '送信量'));
      var note2 = h('small', 'cdw-note'); foot.appendChild(note2);
      body.appendChild(top); body.appendChild(box); body.appendChild(foot); body.appendChild(more(api, 'server', 'サーバーの詳細'));
      return function (r) {
        top.replaceChildren();
        var l10 = r.rate.last10, sec = Math.max(1, l10.seconds || 10);
        top.appendChild(statBox('接続中', fmt(r.live.online) + '人', '運営 ' + fmt(r.live.operatorsOnline) + '人'));
        top.appendChild(statBox('リクエスト', (l10.requests / sec).toFixed(1) + '/秒'));
        top.appendChild(statBox('送信', bytes(l10.bytes / sec) + '/秒'));
        top.appendChild(statBox('今月の使用量', (r.usage ? r.usage.percent : 0).toFixed(1) + '%', r.usage ? '約' + fmt(r.usage.yen) + '円' : ''));
        var got = r.rate.history || [];
        if (r.rate.delta) {
          var from = got.length ? got[0][0] : Infinity;
          got = (api.keep.hist || []).filter(function (x) { return x[0] < from; }).concat(got).slice(-300);
        }
        api.keep.hist = got;
        var hist = got.slice(-120);
        chart.replaceChildren();
        [22, 45, 68].forEach(function (y) { chart.appendChild(svg('line', { x1: 0, x2: 300, y1: y, y2: y, 'class': 'cdw-grid' })); });
        if (hist.length > 1) {
          var maxR = hist.reduce(function (m, x) { return Math.max(m, x[1]); }, 1), maxB = hist.reduce(function (m, x) { return Math.max(m, x[2]); }, 1);
          var line = function (i, max) { return hist.map(function (x, k) { return (k ? 'L' : 'M') + (k / (hist.length - 1) * 300).toFixed(1) + ' ' + (86 - x[i] / max * 78).toFixed(1); }).join(''); };
          chart.appendChild(svg('path', { d: line(1, maxR) + 'L300 90L0 90Z', 'class': 'cdw-area' }));
          chart.appendChild(svg('path', { d: line(1, maxR), 'class': 'cdw-line-r' }));
          chart.appendChild(svg('path', { d: line(2, maxB), 'class': 'cdw-line-b' }));
          note2.textContent = '直近' + hist.length + '秒・最大 ' + fmt(maxR) + '回/秒・' + bytes(maxB) + '/秒';
        }
      };
    }
  };
  // a list: asked with the rev it was given ("the same" while it has not changed)
  function listOf(p) { return function (keep) { return { p: p, rev: keep.rev || '' }; }; }
  W.reports = {
    ask: listOf('/api/ops/reports'),
    mount: function (body, api) {
      var head = h('div', 'cdw-count'), list = h('div'); body.appendChild(head); body.appendChild(list); body.appendChild(more(api, 'reports'));
      return function (r) {
        var rows = r.reports || [];
        head.replaceChildren(h('b', '', fmt(rows.length)), h('span', '', '件の未対応'));
        list.replaceChildren(rows.length ? lines(rows.map(function (x) { return [ago(x.at), (x.kindName || '通報') + '：' + (x.target ? x.target.name : '—'), clip(x.text, 40)]; }), 5) : empty('未対応の通報はありません'));
      };
    }
  };
  W.detections = {
    ask: listOf('/api/ops/detections'),
    mount: function (body, api) {
      var head = h('div', 'cdw-count'), list = h('div'); body.appendChild(head); body.appendChild(list); body.appendChild(more(api, 'detections'));
      return function (r) {
        var rows = r.detections || [];
        head.replaceChildren(h('b', '', fmt(rows.length)), h('span', '', '件の未確認'));
        list.replaceChildren(rows.length ? lines(rows.map(function (x) { return [ago(x.at), x.sender ? x.sender.name : '—', clip((x.words || []).join('・') || x.masked, 40)]; }), 5) : empty('未確認の検知はありません'));
      };
    }
  };
  W.feedback = {
    ask: listOf('/api/ops/feedback'),
    mount: function (body, api) {
      var head = h('div', 'cdw-count'), list = h('div'); body.appendChild(head); body.appendChild(list); body.appendChild(more(api, 'feedback'));
      var KIND = { bug: '報告', idea: '意見案', rating: '評価' };
      return function (r) {
        var rows = (r.feedback || []).filter(function (x) { return !x.handledAt; });
        head.replaceChildren(h('b', '', fmt(rows.length)), h('span', '', '件の未対応'));
        list.replaceChildren(rows.length ? lines(rows.map(function (x) { return [ago(x.at), (KIND[x.kind] || '報告') + '：' + (x.user && x.user.name || '—'), clip(x.text, 44)]; }), 5) : empty('未対応の報告・意見案はありません'));
      };
    }
  };
  W.log = {
    // (the six lines it shows, not the log's first page)
    ask: listOf('/api/ops/log?slim=1&limit=6'),
    mount: function (body, api) {
      var list = h('div'); body.appendChild(list); body.appendChild(more(api, 'log', 'ログをすべて見る'));
      return function (r) {
        var rows = (r.entries || []).slice(0, 6);
        list.replaceChildren(rows.length ? lines(rows.map(function (x) { return [ago(x.at), x.actor && x.actor.name || 'システム', clip(x.summary, 70)]; }), 6) : empty('ログはまだありません'));
      };
    }
  };
  W.security = {
    // (what it shows: the level, the last five minutes, the blocks)
    live: true, ask: listOf('/api/ops/security?lean=1'),
    mount: function (body, api) {
      var level = h('div', 'cdw-level'), stats = h('div', 'cdw-stats'), list = h('div'); body.appendChild(level); body.appendChild(stats); body.appendChild(list); body.appendChild(more(api, 'security'));
      var WORD = { calm: '平常', watch: '警戒', attack: '攻撃を検知', breach: '突破の疑い', lockdown: 'ロックダウン中' };
      return function (r) {
        var s = r.shield || {}, e = r.emergency || {}, five = s.last5m || {};
        var lv = e.level === 'lockdown' ? 'lockdown' : e.stopped ? 'attack' : five.attacks > 0 ? 'attack' : five.floods > 0 ? 'watch' : 'calm';
        level.className = 'cdw-level lv-' + lv; level.textContent = WORD[lv] || String(lv);
        stats.replaceChildren(statBox('直近5分の攻撃', fmt(five.attacks)), statBox('フラッド', fmt(five.floods)), statBox('ブロック中', fmt(s.blockCount)), statBox('認証の失敗', fmt(five.authFails)));
        list.replaceChildren((s.blocks || []).length ? lines((s.blocks || []).map(function (b) { return [b.until ? '〜' + new Date(b.until).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '', b.scope + ':' + clip(b.target, 24), clip(b.reason, 30)]; }), 3) : empty('いまブロックしているものはありません'));
      };
    }
  };
  W.team = {
    // (the live connection tells when the conversation changes: OpsCDW.nudge; this is for what it misses, and while it is down)
    live: true,
    ask: function (keep) {
      if (keep.at && !keep.nudged && io().live() && Date.now() - keep.at < 30000) return null;
      keep.nudged = false;
      return { p: '/api/ops/team/messages?with=0&limit=6', rev: keep.rev || '' };
    },
    mount: function (body, api) {
      var list = h('div', 'cdw-chat'), form = h('form', 'cdw-compose'), input = h('input'); input.type = 'text'; input.maxLength = 400; input.placeholder = '全体チャットに送る'; input.setAttribute('aria-label', '全体チャットに送る');
      var send = btn('cdw-send', '送信'); send.type = 'submit'; form.appendChild(input); form.appendChild(send);
      body.appendChild(list); body.appendChild(form); body.appendChild(more(api, 'team', '運営チャットを開く'));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        req('POST', '/api/ops/team/messages', { to: 0, text: text }).then(function () { input.value = ''; api.refresh(); }, function (err) { toast((err && err.message) || '送れませんでした'); }).then(function () { send.disabled = false; });
      });
      return function (r) {
        var rows = (r.messages || []).slice(-6);
        var stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
        list.replaceChildren();
        if (!rows.length) list.appendChild(empty('まだ話がありません'));
        rows.forEach(function (m) {
          var row = h('div', 'cdw-msg' + (m.fromMe || m.mine ? ' mine' : ''));
          row.appendChild(h('b', '', m.from && m.from.name || m.name || '—'));
          row.appendChild(h('span', '', clip(String(m.text || m.body || '').replace(/@\[[^\]]*\]/g, '…'), 90)));
          list.appendChild(row);
        });
        if (stick) list.scrollTop = list.scrollHeight;
      };
    }
  };
  W.vault = {
    ask: listOf('/api/vault/spaces'),
    mount: function (body, api) {
      var bar2 = h('div', 'cdw-meter'), fill = h('i'); bar2.appendChild(fill);
      var top = h('div', 'cdw-stats'), list = h('div'); body.appendChild(top); body.appendChild(bar2); body.appendChild(list); body.appendChild(more(api, 'vault', '保管庫を開く'));
      return function (r) {
        var pool = r.pool || {}, me = r.me || {};
        var spaces = (r.spaces || []).concat(r.personal ? [Object.assign({ with: { name: '自分の保管庫' } }, r.personal)] : []);
        var files = spaces.reduce(function (n, s) { return n + (s.files || 0); }, 0);
        top.replaceChildren(statBox('全体', bytes(pool.used) + ' / ' + bytes(pool.maxBytes)), statBox('ファイル', fmt(files) + '件'), statBox('保管先', pool.store === 'bucket' ? 'R2' : 'データベース'));
        fill.style.width = Math.min(100, pool.maxBytes ? pool.used / pool.maxBytes * 100 : 0).toFixed(1) + '%';
        var recent = spaces.filter(function (s) { return s.last; }).sort(function (a, b) { return b.last - a.last; });
        list.replaceChildren(recent.length ? lines(recent.map(function (s) { return [ago(s.last), (s.with && s.with.name) || (s.owner && s.owner.name) || '保管庫', fmt(s.files) + '件・' + bytes(s.bytes)]; }), 4) : empty('ファイルはまだありません'));
        if (me && me.limit) top.appendChild(statBox('自分の枠', bytes(me.used) + ' / ' + bytes(me.limit)));
      };
    }
  };
  W.profile = {
    mount: function (body, api) {
      var card = h('div', 'cdw-card'), face = h('div', 'cdw-card-face'), name = h('b', 'cdw-card-name'), role = h('span', 'cdw-card-role'), lines2 = h('div', 'cdw-card-lines');
      var mark = h('span', 'cdw-card-brand', 'TWO STATE');
      card.appendChild(mark); card.appendChild(face); card.appendChild(name); card.appendChild(role); card.appendChild(lines2); body.appendChild(card); body.appendChild(more(api, 'profile', 'プロフィールを開く'));
      function draw(me, ops) {
        name.textContent = me.name; role.textContent = me.developer ? '開発者' : me.viewer ? '閲覧者' : '運営者';
        card.classList.toggle('dev', !!me.developer);
        if (ops && ops.avatar) face.style.backgroundImage = avatarOf(ops.avatar); else face.textContent = String(me.name || '?').slice(0, 1);
        lines2.appendChild(h('span', '', '運営サイト ' + (me.developer ? '管理者' : '運営')));
        lines2.appendChild(h('span', '', (location.protocol === 'https:' ? '安全な接続' : '接続') + '・' + new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' })));
      }
      // (asked once: the window put again, or the desktop drawn again, uses what it has)
      var k = api.keep;
      if (k.me) draw(k.me, k.ops);
      else {
        Promise.all([req('GET', '/api/ops/me'), req('GET', '/api/ops/operators').catch(function () { return {}; })]).then(function (rs) {
          k.me = rs[0]; k.ops = (rs[1].operators || []).filter(function (o) { return o.name === k.me.name; })[0];
          draw(k.me, k.ops);
        }, function () { name.textContent = '読み込めません'; });
      }
      return function () {};
    }
  };
  W.diary = {
    ask: listOf('/api/ops/diary?limit=3'),
    mount: function (body, api) {
      var form = h('form', 'cdw-diary'), title = h('input'), text = h('textarea'), go = btn('cdw-send', '公開');
      title.type = 'text'; title.maxLength = 100; title.placeholder = 'タイトル'; title.setAttribute('aria-label', 'タイトル');
      text.rows = 4; text.maxLength = 20000; text.placeholder = '今日のこと'; text.setAttribute('aria-label', '本文');
      go.type = 'submit'; form.appendChild(title); form.appendChild(text); form.appendChild(go);
      var list = h('div'); body.appendChild(form); body.appendChild(list); body.appendChild(more(api, 'diary', '日記を開く'));
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!title.value.trim() || !text.value.trim()) { toast('タイトルと本文を入力してください'); return; }
        go.disabled = true;
        req('POST', '/api/ops/diary', { title: title.value.trim(), text: text.value.trim(), reward: 0 }).then(function () { title.value = ''; text.value = ''; toast('日記を公開しました'); api.refresh(); }, function (err) { toast((err && err.message) || '公開できませんでした'); }).then(function () { go.disabled = false; });
      });
      return function (r) {
        var rows = (r.posts || r.diary || []).slice(0, 3);
        list.replaceChildren(rows.length ? lines(rows.map(function (p) { return [ago(p.createdAt || p.at || p.created_at || Date.now()), clip(p.title, 24), clip(p.text || p.body, 40)]; }), 3) : empty('最近の日記はありません'));
      };
    }
  };

  /* ------------------------------------------------------------ the windows --- */
  var ICON = { server: 'server', reports: 'reports', detections: 'detections', feedback: 'feedback', log: 'log', security: 'security', team: 'team', vault: 'vault', profile: 'operators', diary: 'diary' };
  function pos(it, el) {
    el.style.left = S.x0 + it.x * CELL + 'px'; el.style.top = S.y0 + it.y * CELL + 'px';
    el.style.width = it.w * CELL + 'px'; el.style.height = it.h * CELL + 'px';
    el.classList.toggle('cdw-small', it.w < 18); el.classList.toggle('cdw-short', it.h < 12);
  }
  function mountOf(it) {
    var c = entry(it.id), impl = W[it.id];
    if (!c || !impl) return null;
    var root = h('section', 'cdw-widget'); root.dataset.id = it.id; root.setAttribute('aria-label', c.name);
    var head = h('header', 'cdw-head'), img = h('img'); img.src = 'assets/' + ICON[it.id] + '.webp'; img.alt = ''; img.width = 22; img.height = 22; img.draggable = false;
    head.appendChild(img); head.appendChild(h('strong', '', c.name));
    var x = btn('cdw-x', '×', c.name + 'を外す'); head.appendChild(x);
    var bodyEl = h('div', 'cdw-body'); root.appendChild(head); root.appendChild(bodyEl); root.appendChild(h('i', 'cdw-sheen'));
    ['e', 's', 'se'].forEach(function (d) { var g = h('i', 'cdw-grip ' + d); g.dataset.edge = d; root.appendChild(g); });
    // (`keep`: what a window holds — its last answer, the rev it is asked with — kept while the desktop is drawn again)
    var inst = { item: it, root: root, body: bodyEl, update: null, keep: keeps[it.id] || (keeps[it.id] = {}) };
    var api = {
      open: function (id) { if (window.OpsDesktop && OpsDesktop.open) { off(); OpsDesktop.open(id); } },
      refresh: function () { OpsBeat.soon('cdw:' + it.id); },
      keep: inst.keep
    };
    try { inst.update = impl.mount(bodyEl, api) || function () {}; } catch (e) { bodyEl.appendChild(empty('表示できません')); inst.update = function () {}; }
    x.addEventListener('click', function () { remove(it.id); });
    drag(inst, head, 'move');
    Array.prototype.forEach.call(root.querySelectorAll('.cdw-grip'), function (g) { drag(inst, g, g.dataset.edge); });
    pos(it, root);
    // what it had is drawn at once; what it asks for is asked with the rest (ops/beat.js)
    if (inst.keep.last) inst.update(inst.keep.last);
    watch(inst);
    return inst;
  }
  function watch(inst) {
    var id = inst.item.id, impl = W[id], keep = inst.keep;
    if (!impl.ask) return;
    OpsBeat.want('cdw:' + id, {
      live: impl.live, at: keep.at || 0,
      ask: function () { return S.on && live[id] === inst ? impl.ask(keep) : null; },
      got: function (r) {
        keep.at = Date.now();
        inst.root.classList.remove('cdw-stale');
        // (the same: drawn again from what it has, so that "3分前" moves on)
        if (!r.same) { keep.rev = r.rev; keep.last = r; }
        if (keep.last) inst.update(keep.last);
      },
      failed: function (err) {
        inst.root.classList.add('cdw-stale');
        // the server says it is not theirs (their rights were taken away): it goes
        if (err && (err.status === 403 || err.status === 404)) { S.loaded = false; load().then(function () { if (S.on) { measure(); fitAll(); renderAll(); } }); }
      }
    });
  }
  function unmount(id) { if (live[id]) { live[id].root.remove(); delete live[id]; } OpsBeat.drop('cdw:' + id); }
  function renderAll() {
    Object.keys(live).forEach(unmount);
    var n = 0;
    S.items.forEach(function (it) {
      if (S.hidden[it.id]) return;
      var inst = mountOf(it);
      if (inst) { inst.root.style.setProperty('--i', String(n++)); live[it.id] = inst; stage.appendChild(inst.root); }
    });
    var out = Object.keys(S.hidden).length;
    note.hidden = !out; note.textContent = out ? 'この画面の大きさに入らない窓が ' + out + ' 個あります（画面を広げると戻ります）' : '';
    if (window.OpsGlass) OpsGlass.scan();
  }
  var stage = null;
  function remove(id) {
    S.items = S.items.filter(function (i) { return i.id !== id; });
    unmount(id);
    delete S.hidden[id];
    save(); drawPalette();
  }
  function add(id) {
    var c = entry(id);
    if (!c || S.items.some(function (i) { return i.id === id; }) || S.items.length >= S.grid.maxItems) return;
    var p = place(c, null);
    if (!p) { toast('空きがありません。ほかの窓を小さくするか外してください'); return; }
    S.items.push(p);
    var inst = mountOf(p);
    if (inst) { live[id] = inst; stage.appendChild(inst.root); if (!reduced()) inst.root.classList.add('cdw-in'); }
    if (window.OpsGlass) OpsGlass.scan();
    save(); drawPalette();
  }
  // a window put in order: every window packed from the top left, the biggest first
  function arrange() {
    var list = S.items.slice().sort(function (a, b) { return (b.w * b.h) - (a.w * a.h); }), kept = [];
    S.hidden = {};
    list.forEach(function (it) {
      var c = entry(it.id), p = null;
      for (var k = 0; k < 24 && !p; k++) {
        var w = Math.max(c.min[0], it.w - k * 2), hh = Math.max(c.min[1], it.h - k * 2);
        for (var y = 0; y + hh <= S.rows && !p; y++) for (var x = 0; x + w <= S.cols && !p; x++) { var r = { x: x, y: y, w: w, h: hh }; if (kept.every(function (o) { return !hit(r, o); })) p = r; }
        if (w === c.min[0] && hh === c.min[1]) break;
      }
      if (p) { it.x = p.x; it.y = p.y; it.w = p.w; it.h = p.h; kept.push(it); } else S.hidden[it.id] = true;
    });
    renderAll(); save();
  }

  // moving and sizing: a step is taken only where it leaves the window clear of the others (it slides along what it meets)
  function drag(inst, handle, edge) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || !e.isPrimary || (edge === 'move' && e.target.closest('button'))) return;
      e.preventDefault();
      var it = inst.item, start = { x: e.clientX, y: e.clientY }, from = { x: it.x, y: it.y, w: it.w, h: it.h }, c = entry(it.id);
      handle.setPointerCapture(e.pointerId); inst.root.classList.add('cdw-drag');
      function move(ev) {
        var dx = Math.round((ev.clientX - start.x) / CELL), dy = Math.round((ev.clientY - start.y) / CELL), t;
        if (edge === 'move') {
          var nx = Math.max(0, Math.min(S.cols - it.w, from.x + dx)), ny = Math.max(0, Math.min(S.rows - it.h, from.y + dy));
          [[nx, ny], [nx, it.y], [it.x, ny]].some(function (p) { var r = { x: p[0], y: p[1], w: it.w, h: it.h }; if (clear(r, it)) { it.x = r.x; it.y = r.y; return true; } return false; });
        } else {
          var nw = from.w + (edge.indexOf('e') >= 0 ? dx : 0), nh = from.h + (edge.indexOf('s') >= 0 ? dy : 0);
          nw = Math.max(c.min[0], Math.min(c.max[0], nw)); nh = Math.max(c.min[1], Math.min(c.max[1], nh));
          // as big as is asked, or the biggest that stays clear
          for (t = 0; t < 80 && !clear({ x: it.x, y: it.y, w: nw, h: nh }, it); t++) { if (nw > it.w) nw--; else if (nh > it.h) nh--; else break; if (nw < c.min[0] || nh < c.min[1]) break; }
          if (clear({ x: it.x, y: it.y, w: nw, h: nh }, it)) { it.w = nw; it.h = nh; }
        }
        pos(it, inst.root);
      }
      function done(ev) {
        if (ev.pointerId !== e.pointerId) return;
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); handle.removeEventListener('pointercancel', done);
        inst.root.classList.remove('cdw-drag');
        if (it.x !== from.x || it.y !== from.y || it.w !== from.w || it.h !== from.h) save();
      }
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', done); handle.addEventListener('pointercancel', done);
    });
  }

  /* ------------------------------------------------------------ the bar on top, and the list of what can be added --- */
  function buildChrome() {
    layer = h('div', 'cdw-layer'); layer.hidden = true; layer.setAttribute('aria-label', 'デスクトップの窓（CDW 1.0）');
    bar = h('div', 'cdw-bar'); bar.setAttribute('role', 'toolbar');
    bar.appendChild(h('strong', 'cdw-brand', 'CDW 1.0'));
    var addB = btn('cdw-tool', '＋ 窓を置く'), arr = btn('cdw-tool', '整列'), done = btn('cdw-tool cdw-done', '完了');
    addB.setAttribute('aria-haspopup', 'true'); addB.setAttribute('aria-expanded', 'false');
    bar.appendChild(addB); bar.appendChild(arr); bar.appendChild(done);
    note = h('span', 'cdw-bar-note'); note.hidden = true; bar.appendChild(note);
    palette = h('div', 'cdw-palette'); palette.hidden = true; palette.setAttribute('role', 'menu');
    addB.addEventListener('click', function () { palette.hidden = !palette.hidden; addB.setAttribute('aria-expanded', palette.hidden ? 'false' : 'true'); drawPalette(); if (window.OpsGlass) OpsGlass.scan(); });
    arr.addEventListener('click', arrange);
    done.addEventListener('click', off);
    stage = h('div', 'cdw-stage');
    layer.appendChild(bar); layer.appendChild(palette); layer.appendChild(stage);
    app.appendChild(layer);
    document.addEventListener('keydown', function (e) { if (S.on && e.key === 'Escape' && !document.querySelector('.mac-overlay:not([hidden])')) { if (!palette.hidden) { palette.hidden = true; } else off(); } });
    document.addEventListener('pointerdown', function (e) { if (S.on && !palette.hidden && !e.target.closest('.cdw-palette, .cdw-bar')) palette.hidden = true; }, true);
    // (drawn again once the window has its new size, not for every step of the drag)
    window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { if (S.on) { measure(); fitAll(); renderAll(); } }, 150); });
  }
  function drawPalette() {
    if (!palette) return;
    palette.replaceChildren();
    var have = {}; S.items.forEach(function (i) { have[i.id] = true; });
    var left = S.catalog.filter(function (c) { return !have[c.id]; });
    if (!left.length) palette.appendChild(empty('置ける窓はすべて置いてあります'));
    left.forEach(function (c) {
      var b = btn('cdw-pick', '', c.name + 'を置く'); b.setAttribute('role', 'menuitem');
      var img = h('img'); img.src = 'assets/' + ICON[c.id] + '.webp'; img.alt = ''; img.width = 26; img.height = 26;
      b.appendChild(img); b.appendChild(h('span', '', c.name));
      b.addEventListener('click', function () { palette.hidden = true; add(c.id); });
      palette.appendChild(b);
    });
  }

  /* ------------------------------------------------------------ in and out --- */
  function on() {
    if (S.on) return;
    if (phone()) { toast('デスクトップの窓は、スマホでは使えません'); return; }
    if (!layer) buildChrome();
    function go() {
      if (!S.loaded) { toast('窓の設定を読み込めませんでした。しばらくしてからもう一度お試しください'); return; }
      S.on = true;
      // (back on the desktop: every window asks at once)
      Object.keys(keeps).forEach(function (id) { keeps[id].at = 0; });
      document.body.classList.add('mac-cdw'); area.inert = true;
      layer.hidden = false; measure(); fitAll(); renderAll(); drawPalette();
      if (!reduced()) { layer.classList.remove('cdw-fade'); void layer.offsetWidth; layer.classList.add('cdw-fade'); clearTimeout(fadeTimer); fadeTimer = setTimeout(function () { layer.classList.remove('cdw-fade'); }, 2200); }
      if (window.OpsDesktop && OpsDesktop.cdwChanged) OpsDesktop.cdwChanged(true);
    }
    if (S.loaded) go(); else load().then(go);
  }
  function off() {
    if (!S.on) return;
    S.on = false;
    document.body.classList.remove('mac-cdw'); area.inert = false;
    if (layer) { layer.hidden = true; palette.hidden = true; }
    Object.keys(live).forEach(function (id) { OpsBeat.drop('cdw:' + id); });
    if (window.OpsDesktop && OpsDesktop.cdwChanged) OpsDesktop.cdwChanged(false);
  }
  return {
    toggle: function () { if (S.on) off(); else on(); },
    on: function () { return S.on; },
    off: off,
    // the live connection told of a change to what a window shows (ops/ops.js: the 全体チャット)
    nudge: function (id) { if (keeps[id]) keeps[id].nudged = true; OpsBeat.soon('cdw:' + id); },
    // signed in or out: the next person starts from nothing
    session: function (signedIn) {
      off();
      Object.keys(live).forEach(unmount);
      keeps = {}; S.role = ''; S.catalog = []; S.items = []; S.loaded = false; S.loading = null; S.hidden = {};
      if (signedIn) load();
    }
  };
})();
