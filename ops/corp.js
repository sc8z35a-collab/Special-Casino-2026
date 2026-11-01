/* 企業: a folder of apps, one for each of the world's ten companies (server/core/corp.js). The folder shows them as
   icons, with every company at a glance and the ビジネス友好度 between them; an icon opens that company's official
   site: its status now, its 決算 (損益計算書・貸借対照表・キャッシュ・フロー計算書, by the quarter, the year and the
   month), its products (price, 原価, 仕入れ価格, 専売特別費用, what the seller and the maker keep), its business (the
   studios' projects and titles, the bank's book, each business's sales), its people and budgets, its shares,
   dividends, loans and taxes, its ties and its news.
   What is shown is asked for when the app is opened and again only when the server says a day has closed (the
   'corp' event on the live connection, free); asking again with the last answer's rev is answered { same: true }.
   Labels and numbers come from the shared rules (js/game/corp.js, BR.CORP). Text only ever goes in by textContent. */
var OpsCorp = (function () {
  'use strict';
  var SVG = 'http://www.w3.org/2000/svg';
  var C = function () { return window.BR && window.BR.CORP; };
  // each company's colours (its site's band and its icon: ops/assets/corp-<id>.webp)
  var THEME = {
    tenesice: ['#0f1c3f', '#2d4a8a'], magita: ['#5c0a10', '#c62832'], carowner: ['#0b2f63', '#2378dd'], jinx: ['#8a2c00', '#e47a12'],
    daizin: ['#140a24', '#53308a'], citywork: ['#11471c', '#2f9a44'], speedeed: ['#00505c', '#0aa6b8'], dtrade: ['#0d2b2a', '#1a8a7e'],
    riru: ['#5b1173', '#d8336f'], ice: ['#063d73', '#2f9fd8'], yosida: ['#0e3b31', '#1f8a6e'], wazima: ['#262c36', '#6b7f99'], myway: ['#3d0b3f', '#e8508f']
  };
  var TABS = [['top', 'トップ'], ['fin', '決算'], ['products', '商品'], ['biz', '事業'], ['people', '人と予算'], ['stock', '株式・財務'], ['ties', '友好度'], ['news', 'ニュース']];
  var NEWS = { results: '決算', guidance: '業績予想', revise: '予想修正', dividend: '配当', release: '発売', hit: 'ヒット', flop: '不振', start: '開発開始',
    delay: '発売延期', cancel: '開発中止', update: '大型更新', week: '週間', hire: '採用', loan: '借入', support: '開発援助', rebate: '販売奨励金', tie: '友好度', lab: '研究開発', surcharge: '値上げ',
    garage: 'ガレージ契約料', staff: '人員', tech: '技術開発', quest: 'クエスト手数料', deal: '価格交渉', ip: 'ブランド', char: '新キャラクター', license: 'IP契約', bankrupt: '倒産' };
  var st = { view: null, request: null, toast: null, at: '', tab: 'top', mode: 'q', sheet: 'pl', metric: 'sales', all: null, sites: {}, gen: 0, today: {} };

  /* ------------------------------------------------------------------ small things --- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function svg(tag, attrs) { var n = document.createElementNS(SVG, tag); Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); }); return n; }
  function btn(cls, text, fn, label) { var b = el('button', cls, text); b.type = 'button'; if (label) b.setAttribute('aria-label', label); if (fn) b.addEventListener('click', fn); return b; }
  function money(n) { return C().fmt.money(Math.round(n || 0)); }
  function mil(n) { return C().fmt.mil(n || 0); }
  function group(n) { return (n < 0 ? '−' : '') + C().fmt.group(n || 0); }
  function pct(x, d) { return C().fmt.pct(x, d); }
  function ratio(a, b) { return b ? a / Math.abs(b) - 1 : null; }
  function dayLabel(d) { return C().dateLabel(d); }
  function when(sec) {
    var t = new Date(sec * 1000), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return t.getFullYear() + '/' + (t.getMonth() + 1) + '/' + t.getDate() + ' ' + p(t.getHours()) + ':' + p(t.getMinutes());
  }
  function company(id) { return C().company(id) || { id: id, name: id }; }
  function nameOf(id) { return company(id).name; }
  function icon(id, size) {
    var img = el('img', 'corp-icon'); img.src = 'assets/corp-' + String(id).replace(/[^\w-]/g, '') + '.webp';
    img.alt = ''; img.width = size; img.height = size; img.draggable = false; return img;
  }
  function stat(label, value, sub, cls) {
    var b = el('div', 'stat corp-stat' + (cls ? ' ' + cls : ''));
    b.appendChild(el('span', '', label)); b.appendChild(el('b', '', value));
    if (sub) b.appendChild(el('small', 'muted', sub));
    return b;
  }
  function panel(title, note) {
    var p = el('section', 'corp-panel');
    var h = el('div', 'corp-panel-head'); h.appendChild(el('h3', '', title)); if (note) h.appendChild(el('span', 'muted', note));
    p.appendChild(h); return p;
  }
  // a table: head [label, num?] and rows of cells (a cell: text, or { t, cls, title })
  function table(head, rows, cls) {
    var wrap = el('div', 'corp-table-wrap'), t = el('table', 'corp-table' + (cls ? ' ' + cls : '')), th = el('thead'), tr = el('tr');
    head.forEach(function (h) { var c = el('th', h[1] ? 'num' : '', h[0]); c.scope = 'col'; tr.appendChild(c); });
    th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr', r.cls || '');
      if (r.onclick) { row.tabIndex = 0; row.classList.add('corp-link'); row.addEventListener('click', r.onclick); row.addEventListener('keydown', function (e) { if (e.key === 'Enter') r.onclick(); }); }
      (r.cells || r).forEach(function (c, i) {
        var o = c && typeof c === 'object' && !(c instanceof Node) ? c : { t: c };
        var td = el(i === 0 && !r.plain ? 'th' : 'td', (head[i] && head[i][1] ? 'num' : '') + (o.cls ? ' ' + o.cls : ''));
        if (i === 0 && !r.plain) td.scope = 'row';
        if (o.t instanceof Node) td.appendChild(o.t); else td.textContent = o.t === undefined || o.t === null ? '—' : o.t;
        if (o.title) td.title = o.title;
        row.appendChild(td);
      });
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t); return wrap;
  }
  function chips(list, on, fn, label) {
    var box = el('div', 'chips corp-chips'); box.setAttribute('role', 'tablist'); if (label) box.setAttribute('aria-label', label);
    list.forEach(function (x) {
      var b = btn('chip' + (x[0] === on ? ' on' : ''), x[1], function () { fn(x[0]); });
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', x[0] === on ? 'true' : 'false');
      box.appendChild(b);
    });
    return box;
  }
  // a 0–100 business tie: its number, a word for it and a bar (never the colour alone)
  function tieWord(v) { v = Math.round(v); return v >= 80 ? '非常に良好' : v >= 60 ? '良好' : v >= 40 ? '普通' : v >= 20 ? '冷え込み' : '険悪'; }
  function meter(v, start) {
    var box = el('div', 'corp-meter'); box.setAttribute('role', 'meter'); box.setAttribute('aria-valuemin', '0'); box.setAttribute('aria-valuemax', '100');
    box.setAttribute('aria-valuenow', String(Math.round(v))); box.setAttribute('aria-label', 'ビジネス友好度 ' + Math.round(v) + '（' + tieWord(v) + '）');
    var bar = el('i'); bar.style.width = Math.max(0, Math.min(100, v)) + '%'; box.appendChild(bar);
    if (start !== undefined) { var m = el('b'); m.style.left = Math.max(0, Math.min(100, start)) + '%'; m.title = 'はじめ ' + start; box.appendChild(m); }
    return box;
  }

  /* ------------------------------------------------------------------------ the chart --- */
  // One measure over time (the points named by `names`), with a crosshair and its value under the pointer (one series:
  // its title names it). Drawn to the width of the app's window, so its text stays the size of the page's.
  function chart(names, values, fmt, label) {
    var W = Math.max(300, Math.min(1400, ((st.view && st.view.clientWidth) || 700) - 70)), H = Math.round(Math.min(260, Math.max(170, W * 0.3))), L = 72, R = 14, T = 12, B = 26;
    var box = el('div', 'corp-chart'), tip = el('div', 'corp-tip'); tip.hidden = true;
    var n = values.length;
    if (n < 2) { box.appendChild(el('p', 'muted', 'まだ記録がありません')); return box; }
    var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
    if (lo > 0 && lo < hi * 0.4) lo = 0;
    if (hi < 0 && hi > lo * 0.4) hi = 0;
    if (hi === lo) { hi += Math.abs(hi) * 0.05 || 1; lo -= Math.abs(lo) * 0.05 || 1; }
    var pad = (hi - lo) * 0.08; hi += pad; if (lo !== 0) lo -= pad;
    var x = function (i) { return L + (W - L - R) * i / (n - 1); }, y = function (v) { return T + (H - T - B) * (hi - v) / (hi - lo); };
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'corp-svg', role: 'img', 'aria-label': label + '（' + names[0] + '〜' + names[n - 1] + '、最新 ' + fmt(values[n - 1]) + '）' });
    [0, 0.5, 1].forEach(function (f) {
      var v = hi - (hi - lo) * f, yy = y(v);
      s.appendChild(svg('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'corp-gl' }));
      var t = svg('text', { x: L - 8, y: yy + 4, class: 'corp-axis', 'text-anchor': 'end' }); t.textContent = fmt(v); s.appendChild(t);
    });
    if (lo < 0 && hi > 0) s.appendChild(svg('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'corp-zero' }));
    [0, n - 1].forEach(function (i) {
      var t = svg('text', { x: x(i), y: H - 6, class: 'corp-axis', 'text-anchor': i ? 'end' : 'start' }); t.textContent = names[i]; s.appendChild(t);
    });
    var d = '';
    values.forEach(function (v, i) { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); });
    s.appendChild(svg('path', { d: d, class: 'corp-line' }));
    var cross = svg('line', { y1: T, y2: H - B, class: 'corp-cross', visibility: 'hidden' }), dot = svg('circle', { r: 4.5, class: 'corp-dot', visibility: 'hidden' });
    s.appendChild(cross); s.appendChild(dot);
    var end = svg('circle', { cx: x(n - 1), cy: y(values[n - 1]), r: 4, class: 'corp-dot' }); s.appendChild(end);
    var hit = svg('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent' }); s.appendChild(hit);
    function at(e) {
      var r = s.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
      var i = Math.max(0, Math.min(n - 1, Math.round((px - L) / (W - L - R) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(values[i])); dot.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.replaceChildren(el('span', 'muted', names[i]), el('b', '', fmt(values[i])));
      var left = x(i) / W * r.width; tip.style.left = Math.max(0, Math.min(r.width - 150, left - 75)) + 'px';
    }
    s.addEventListener('pointermove', at); s.addEventListener('pointerdown', at);
    s.addEventListener('pointerleave', function () { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
    box.appendChild(s); box.appendChild(tip);
    return box;
  }
  // the days as the chart names them
  function dayNames(days) { return days.map(function (d) { var t = C().ymd(d); return t.y + '/' + t.m + '/' + t.d; }); }
  // a flow measure as the sum of the last 30 days, day by day
  function rolling(list, k) {
    var out = [], sum = 0;
    list.forEach(function (v, i) { sum += v; if (i >= k) sum -= list[i - k]; out.push(sum); });
    return out;
  }

  /* ------------------------------------------------------------------ the clock --- */
  // The companies live in real time: a day is a day, an hour an hour, a second a second, from the day they began (the
  // server's clock, as its last answer said it, ticking here every second; each business day runs from 9:00 to 9:00
  // Japan time and closes then).
  var clockTimer = 0, skew = 0;
  function liveClock(r) {
    if (r && r.now) skew = r.now - Date.now();
    var box = el('div', 'corp-clock'), t = el('b', 'corp-clock-time'), d = el('span', 'corp-clock-day'), bar = el('i', 'corp-clock-bar'), fill = el('span');
    bar.appendChild(fill);
    box.appendChild(el('span', 'corp-clock-live', 'LIVE'));
    box.appendChild(t); box.appendChild(d); box.appendChild(bar);
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    function tick() {
      var now = Date.now() + skew, j = new Date(now + 9 * 3600000);
      t.textContent = j.getUTCFullYear() + '/' + (j.getUTCMonth() + 1) + '/' + j.getUTCDate() + ' ' + p2(j.getUTCHours()) + ':' + p2(j.getUTCMinutes()) + ':' + p2(j.getUTCSeconds()) + '（日本時間）';
      var day = Math.floor(now / 86400000), into = now - day * 86400000, left = Math.floor((86400000 - into) / 1000);
      d.textContent = '営業日 ' + dayLabel(day) + '・経過 ' + (into / 864000).toFixed(1) + '%・締めまで ' + Math.floor(left / 3600) + ':' + p2(Math.floor(left % 3600 / 60)) + ':' + p2(left % 60);
      fill.style.width = (into / 864000).toFixed(2) + '%';
    }
    tick();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(function () {
      if (!box.isConnected) { clearInterval(clockTimer); clockTimer = 0; return; }
      tick();
    }, 1000);
    return box;
  }

  /* ------------------------------------------------------------- today, live --- */
  // The business day so far, run on second by second: the day's expected sales and profits (as the managers see them
  // now) by the part of the day gone, with the players' and the people's money as it has actually come in place of
  // what they usually spend by now (asked again every half minute while the site is open). The day's books are made
  // at 9:00; these are its running figures.
  var todayTimer = 0, TODAY_ASK = 30000;
  function todayFigures(t, now) {
    var f = Math.max(0, Math.min(1, (now - t.start) / 86400000)), live = t.players + t.people, extra = live - t.usual * f;
    var rest = Math.max(0, t.plan.sales - t.usual), sales = rest * f + live;
    var m = t.plan.sales > 0 ? Math.max(0, Math.min(1, t.plan.op / t.plan.sales)) : 0, n = t.plan.sales > 0 ? Math.max(0, Math.min(1, t.plan.net / t.plan.sales)) : 0;
    return { f: f, sales: sales, op: t.plan.op * f + extra * m, net: t.plan.net * f + extra * n, live: live };
  }
  function todayPanel(id, p) {
    var pt = panel('本日の稼ぎ（リアルタイム）', '営業日の9:00から・確定は9:00の締め');
    var tiles = el('div', 'corp-tiles corp-today');
    var cells = [stat(p.salesName || '売上高', '—', ''), stat('営業利益', '—', ''), stat('当期純利益', '—', ''), stat('プレイヤー・市民の支出（実績）', '—', '')];
    cells.forEach(function (c) { tiles.appendChild(c); });
    pt.appendChild(tiles);
    var note = el('p', 'muted corp-note', '');
    pt.appendChild(note);
    function show() {
      var t = st.today[id];
      if (!t || !t.data) { note.textContent = '読み込み中…'; return; }
      var d = t.data, x = todayFigures(d, Date.now() + skew);
      // (to the dollar: they move every second)
      var put = function (c, v, sub) { c.querySelector('b').textContent = (v < 0 ? '−$' : '$') + C().fmt.group(Math.abs(Math.round(v))); c.classList.toggle('neg', v < 0); var s = c.querySelector('small') || c.appendChild(el('small', 'muted')); s.textContent = sub; };
      put(cells[0], x.sales, '今日の見込み ' + money(d.plan.sales));
      put(cells[1], x.op, '今日の見込み ' + money(d.plan.op));
      put(cells[2], x.net, '今日の見込み ' + money(d.plan.net));
      put(cells[3], x.live, 'プレイヤー ' + money(d.players) + '・市民 ' + money(d.people) + '（いつもは1日 ' + money(d.usual) + '）');
      note.textContent = '経過 ' + (x.f * 100).toFixed(1) + '%。今日の見込み（経営陣の予想）を経過時間で積み上げ、プレイヤーと市民のお金は実際に入った額で数えています（30秒ごとに更新）。締めの決算とは少し違うことがあります。';
    }
    function askToday() {
      if (!st.request) return;
      st.request('GET', '/api/ops/corp/today?c=' + encodeURIComponent(id)).then(function (r) {
        if (r && r.now) skew = r.now - Date.now();
        if (r && r.today) st.today[id] = { data: r.today, at: Date.now() };
        show();
      }, function () { /* (kept: the last figures run on) */ });
    }
    var have = st.today[id];
    if (!have || Date.now() - have.at > TODAY_ASK) askToday();
    show();
    if (todayTimer) clearInterval(todayTimer);
    var ticks = 0;
    todayTimer = setInterval(function () {
      if (!pt.isConnected) { clearInterval(todayTimer); todayTimer = 0; return; }
      if (++ticks % (TODAY_ASK / 1000) === 0) askToday();
      show();
    }, 1000);
    return pt;
  }

  /* --------------------------------------------------------------------- asking --- */
  function ask() {
    if (!st.request) return;
    var gen = ++st.gen, id = st.at;
    var have = id ? st.sites[id] : st.all;
    var path = id ? '/api/ops/corp/company?c=' + encodeURIComponent(id) : '/api/ops/corp';
    if (have && have.rev) path += (id ? '&' : '?') + 'rev=' + encodeURIComponent(have.rev);
    st.request('GET', path).then(function (r) {
      if (gen !== st.gen) return;
      if (r.same) { if (have) have.now = r.now; return; }
      if (id) st.sites[id] = r; else st.all = r;
      render();
    }, function (e) {
      if (gen !== st.gen) return;
      if (!have) { st.view.replaceChildren(el('p', 'muted corp-empty', '表示できません：' + (e && e.message || '通信できませんでした'))); }
      else if (st.toast) st.toast(e && e.message || '更新できませんでした');
    });
  }
  function open(id) { st.at = id || ''; st.tab = 'top'; render(); ask(); if (st.view) st.view.scrollTop = 0; }

  function render() {
    var view = st.view;
    if (!view || !C()) return;
    var box = el('div', 'corp');
    if (st.at) site(box, st.at); else folder(box);
    view.replaceChildren(box);
  }

  /* ---------------------------------------------------------------- the folder --- */
  function folder(box) {
    var head = el('div', 'bar corp-bar'); head.appendChild(el('h2', '', '企業'));
    var a = st.all;
    if (a && a.started) head.appendChild(el('span', 'muted', a.companies.length + '社・' + dayLabel(a.day) + 'の締め（9:00）まで反映・景気指数 ' + a.econ.toFixed(3) +
      (a.econ >= 1.03 ? '（好景気）' : a.econ <= 0.97 ? '（不景気）' : '') + (a.garageFee ? '・MAGITA Garage 1台' + money(a.garageFee) + '/月' : '') +
      (a.questFee ? '・YOSIDAのクエスト手数料 ' + Math.round(a.questFee * 100) + '%' : '')));
    box.appendChild(head);
    if (a && a.started) box.appendChild(liveClock(a));
    // the apps: an icon each
    var grid = el('div', 'corp-grid'); grid.setAttribute('role', 'list');
    C().companies.forEach(function (p) {
      var b = btn('corp-app', '', function () { open(p.id); }, p.full + 'の公式サイトを開く');
      b.setAttribute('role', 'listitem');
      b.appendChild(icon(p.id, 72));
      b.appendChild(el('span', 'corp-app-name', p.name));
      var sm = a && a.companies ? a.companies.filter(function (c) { return c.id === p.id; })[0] : null;
      b.appendChild(el('small', 'muted', sm && sm.dead ? '倒産・上場廃止' : 'ランク' + ((sm && sm.creditRank) || p.rank) + (p.listed ? '・上場' : '')));
      grid.appendChild(b);
    });
    box.appendChild(grid);
    if (!a) { box.appendChild(el('p', 'muted corp-empty', '読み込み中…')); return; }
    if (!a.started) { box.appendChild(el('p', 'muted corp-empty', 'まだ始まっていません。')); return; }
    // every company at a glance
    var p1 = panel('各社の概況', '直近4四半期・百万ドル（プレイヤー・市民は直近30日のドル）');
    p1.appendChild(table([['会社'], ['社員', 1], ['売上高', 1], ['営業利益', 1], ['純利益', 1], ['現金', 1], ['借入金', 1], ['純資産', 1], ['プレイヤー(30日)', 1], ['市民(30日)', 1]],
      a.companies.map(function (c) {
        var who = el('span', 'corp-who'); who.appendChild(icon(c.id, 24)); who.appendChild(el('span', '', c.name + (c.parent ? '（' + nameOf(c.parent) + 'の子会社）' : '') + (c.dead ? '（倒産）' : '')));
        return { onclick: function () { open(c.id); }, cells: [{ t: who }, group(c.staff), mil(c.ttm.sales), { t: mil(c.ttm.op), cls: c.ttm.op < 0 ? 'neg' : '' },
          { t: mil(c.ttm.net), cls: c.ttm.net < 0 ? 'neg' : '' }, mil(c.cash), c.debt ? mil(c.debt) : '—', mil(c.equity), c.players ? money(c.players) : '—',
          c.people ? money(c.people) : (c.abroad ? '国外' : '—')] };
      })));
    box.appendChild(p1);
    // what the people spent at each company, the largest first
    var ranked = a.companies.filter(function (c) { return c.people > 0; }).sort(function (x, y) { return y.people - x.people; });
    if (ranked.length) {
      var all = ranked.reduce(function (n, c) { return n + c.people; }, 0), pn = panel('市民（NPC）が使ったお金', '直近30日・企業ごと');
      pn.appendChild(table([['会社'], ['金額', 1], ['割合', 1]], ranked.map(function (c) { return { onclick: function () { open(c.id); }, cells: [c.name, money(c.people), Math.round(c.people / all * 1000) / 10 + '%'] }; })));
      pn.appendChild(el('p', 'muted corp-note', '市民が各社の商品・サービス・ゲーム・カジノ（負け分）に払ったお金と、テネシスへの利息・手数料。YOSIDAには市民がカーオーナー・ジンクスで買ったYOSHIDA車・エンジンの分が仕入れ代金として、WAZIMAにはMAGITAから届きます（市民からの直接の支払いではありません）。'));
      box.appendChild(pn);
    }
    if (a.gov) box.appendChild(govPanel(a.gov));
    // the ties
    var p2 = panel('ビジネス友好度', '0〜100・▼ははじめの値');
    p2.appendChild(tieList(a.ties, ''));
    box.appendChild(p2);
  }
  // what the country's treasury paid for the game: the players' slot wins beyond their bets, the quests' rewards (YOSIDA's
  // fee in them) and YOSIDA's bill for the gacha (js/game/corp.js YOSIDA)
  function govPanel(g) {
    var keys = Object.keys(g.months || {}).sort().reverse().slice(0, 6), t = function (m) { return (m.slots || 0) + (m.quests || 0) + (m.gacha || 0); };
    var pg = panel('国庫からの支出（ゲーム）', '月ごと・ドル');
    pg.appendChild(table([['月'], ['スロットの勝ち分', 1], ['クエスト報酬', 1], ['うちYOSIDA手数料', 1], ['ガチャ代の請求（YOSIDA）', 1], ['合計', 1]],
      keys.map(function (k) { var m = g.months[k]; return [k, money(m.slots), money(m.quests), money(m.questfee), money(m.gacha), money(t(m))]; })
        .concat([{ cls: 'corp-total', cells: ['累計', money(g.all.slots), money(g.all.quests), money(g.all.questfee), money(g.all.gacha), money(t(g.all))] }])));
    pg.appendChild(el('p', 'muted corp-note', 'スロットでベットより多く勝った分とクエストの報酬は国の国庫から支払われ、YOSIDAはクエスト報酬から手数料を、ガチャでプレイヤーが払った額の50%を国に請求して受け取ります。NPCの国が動いている間は国の預金から引かれます。'));
    return pg;
  }
  function tieList(list, me) {
    var ul = el('ul', 'corp-ties');
    list.slice().sort(function (x, y) { return y.now - x.now; }).forEach(function (t) {
      var li = el('li'), who = el('div', 'corp-tie-who');
      var other = me ? (t.a === me ? t.b : t.a) : '';
      if (me) { who.appendChild(icon(other, 28)); who.appendChild(el('b', '', nameOf(other))); }
      else { who.appendChild(icon(t.a, 24)); who.appendChild(el('b', '', nameOf(t.a))); who.appendChild(el('span', 'muted', '×')); who.appendChild(icon(t.b, 24)); who.appendChild(el('b', '', nameOf(t.b))); }
      li.appendChild(who);
      var right = el('div', 'corp-tie-val');
      right.appendChild(meter(t.now, t.start));
      var d = Math.round((t.now - t.start) * 10) / 10;
      right.appendChild(el('span', 'corp-tie-num', Math.round(t.now) + '（' + tieWord(t.now) + '）' + (d ? ' ' + (d > 0 ? '+' : '−') + Math.abs(d) : '')));
      li.appendChild(right);
      if (t.why) li.appendChild(el('small', 'muted corp-tie-why', t.why));
      ul.appendChild(li);
    });
    return ul;
  }

  /* ------------------------------------------------------------------ a site --- */
  function site(box, id) {
    var p = company(id), r = st.sites[id], th = THEME[id] || ['#223', '#456'];
    var top = el('div', 'corp-nav');
    top.appendChild(btn('btn small corp-back', '‹ 企業', function () { open(''); }, '企業フォルダーに戻る'));
    top.appendChild(el('span', 'muted', '企業 / ' + p.name));
    box.appendChild(top);
    var s = el('div', 'corp-site'); s.style.setProperty('--c1', th[0]); s.style.setProperty('--c2', th[1]);
    var hero = el('header', 'corp-hero'), names = el('div', 'corp-hero-text');
    hero.appendChild(icon(id, 84));
    names.appendChild(el('small', 'corp-en', p.en));
    names.appendChild(el('h2', '', p.full));
    names.appendChild(el('p', '', p.kind));
    var badges = el('div', 'corp-badges');
    var sm0 = r && r.summary;
    badges.appendChild(el('span', 'corp-badge', 'ランク' + ((sm0 && sm0.creditRank) || p.rank) + (sm0 && sm0.loanRate ? '（テネシス 年' + (sm0.loanRate * 100).toFixed(2) + '%）' : '')));
    badges.appendChild(el('span', 'corp-badge', sm0 && sm0.dead ? '倒産・上場廃止' : p.listed ? '上場（投資で売買できます）' : '非上場'));
    if (sm0 && sm0.collab) badges.appendChild(el('span', 'corp-badge', 'MY WAYコラボ中'));
    badges.appendChild(el('span', 'corp-badge', '3月決算'));
    if (r && r.summary) badges.appendChild(el('span', 'corp-badge', '社員 ' + group(r.summary.staff) + '名'));
    names.appendChild(badges);
    hero.appendChild(names);
    s.appendChild(hero);
    if (!r) { s.appendChild(el('p', 'muted corp-empty', '読み込み中…')); box.appendChild(s); return; }
    if (r.started === false) { s.appendChild(el('p', 'muted corp-empty', 'まだ始まっていません。')); box.appendChild(s); return; }
    s.appendChild(liveClock(r));
    var tabs = TABS.filter(function (t) { return t[0] !== 'products' || r.products.length; });
    if (!tabs.some(function (t) { return t[0] === st.tab; })) st.tab = 'top';
    s.appendChild(chips(tabs, st.tab, function (k) { st.tab = k; render(); }, p.name + 'のページ'));
    var body = el('div', 'corp-body');
    ({ top: pageTop, fin: pageFin, products: pageProducts, biz: pageBiz, people: pagePeople, stock: pageStock, ties: pageTies, news: pageNews })[st.tab](body, r, p);
    s.appendChild(body);
    box.appendChild(s);
  }

  // トップ: where it stands now, the year's plan, its days in a chart, what players spent there and its latest news
  function pageTop(body, r, p) {
    var m = r.summary, sv = r.state;
    if (m.dead) {
      var pd = panel('倒産', dayLabel(m.dead.day));
      pd.appendChild(el('p', 'corp-big neg', '倒産・上場廃止'));
      pd.appendChild(el('p', 'muted', m.dead.why + '。負債 ' + money(m.dead.debt) + '（返済 ' + money(m.dead.repaid) + '・テネシスの損失 ' + money(m.dead.loss) + '）、社員' + group(m.dead.staff) + '名は解雇、全契約を終了、株式は上場廃止（価値はありません）。'));
      body.appendChild(pd);
    }
    body.appendChild(todayPanel(p.id, p));
    var tiles = el('div', 'corp-tiles');
    tiles.appendChild(stat(p.salesName || '売上高', money(m.ttm.sales), '直近4四半期'));
    tiles.appendChild(stat('営業利益', money(m.ttm.op), '直近4四半期', m.ttm.op < 0 ? 'neg' : ''));
    tiles.appendChild(stat('当期純利益', money(m.ttm.net), '直近4四半期', m.ttm.net < 0 ? 'neg' : ''));
    tiles.appendChild(stat('現金及び預金', money(m.cash), m.bonds ? '投資有価証券 ' + money(m.bonds) : ''));
    tiles.appendChild(stat('借入金', m.debt ? money(m.debt) : 'なし', sv.loans.length ? sv.loans.length + '件（テネシス）' : ''));
    tiles.appendChild(stat('純資産', money(m.equity), '資本金 ' + money(m.capital)));
    tiles.appendChild(stat('利益剰余金', money((sv.bal.retained || 0) + (sv.bal.legal || 0)), ''));
    tiles.appendChild(stat('従業員', group(m.staff) + '名', '年収 ' + money(sv.pay)));
    if (p.listed) tiles.appendChild(stat('適正株価（理論値）', '$' + group(m.fair), '1株配当 年$' + group(m.dps)));
    // (today, still running: what the players have spent here so far)
    var today = Math.floor(((r.now || Date.now())) / 86400000), now = (r.flows || []).filter(function (f) { return f.day === today; })[0];
    tiles.appendChild(stat('本日のプレイヤー支出', money(now ? now.spent : 0), '集計中（' + dayLabel(today) + '・9:00に締め）'));
    if (r.garageFee) tiles.appendChild(stat('MAGITA Garage 契約料', money(r.garageFee) + '/台・月', r.garageFee > 100000 ? '経営状況により値上げ中（通常 $100,000）' : '通常（不調なら$110,000〜$200,000）', r.garageFee > 100000 ? 'neg' : ''));
    if (r.tech) tiles.appendChild(stat('技術開発', (r.tech.edge >= 1.0005 ? '売上 +' + ((r.tech.edge - 1) * 100).toFixed(1) + '%' : '効果なし'), '成功 ' + r.tech.ok + ' / ' + Math.max(0, r.tech.n - (r.tech.cur ? 1 : 0)) + '件・今の成功率 ' + Math.round(r.tech.chance * 100) + '%'));
    tiles.appendChild(stat('市民の支出', m.people ? money(m.people) : p.abroad ? '—' : '$0', p.abroad ? '国外の会社（市民から直接のお金はなし）' : '直近30日（締めた日）'));
    if (p.abroad) tiles.appendChild(stat('本拠地', '国外', p.parent ? nameOf(p.parent) + 'の完全子会社（100%）' : 'ヴェルノアには販売・納入のみ'));
    if (r.toParent) tiles.appendChild(stat('親会社への利益', money(r.toParent.net), r.toParent.m + '・累計 ' + money(r.toParent.all), r.toParent.net < 0 ? 'neg' : ''));
    (r.children || []).forEach(function (c) { if (c.toParent) tiles.appendChild(stat(c.name + 'からの利益', money(c.toParent.net), c.toParent.m + '（売上・利益は連結で計上）・累計 ' + money(c.toParent.all), c.toParent.net < 0 ? 'neg' : '')); });
    var home = m.hq;
    if (!p.abroad && home) tiles.appendChild(stat('本社', home, p.parent ? nameOf(p.parent) + 'の完全子会社（100%）' : '国内（社員は市民）'));
    if (r.save) tiles.appendChild(stat('WAZIMAのコスト削減', '−' + Math.round((1 - (r.save.place || 1)) * 100) + '%', '製造経費 ×' + (r.save.place || 1).toFixed(3) + '・研究開発費 ×' + (r.save.rd || 1).toFixed(3) + '・その他 ×' + (r.save.other || 1).toFixed(3)));
    if (r.questFee) tiles.appendChild(stat('クエスト報酬の手数料', Math.round(r.questFee * 100) + '%', r.questFee > 0.1 ? '引き上げ中（通常10%・最大21%）' : '通常（不調・増益狙いで最大21%）', r.questFee > 0.1 ? 'neg' : ''));
    if (r.vipWeek) tiles.appendChild(stat('VIP1週間券の買い取り', money(r.vipWeek) + '/枚', 'DAIZINとの交渉（$1.2M〜$3.5M）'));
    if (r.ip) {
      var on = r.ip.contracts.filter(function (c) { return c.on; }).length;
      tiles.appendChild(stat('流行（キャラクター人気）', Math.round(r.ip.heat * 100) + '%', r.ip.heat < 0.85 ? 'マンネリ化・冷え込み' : '好調（新キャラクターで上昇）', r.ip.heat < 0.85 ? 'neg' : ''));
      tiles.appendChild(stat('ブランドの信用', Math.round(r.ip.brand * 100) + '%', 'コピー品 ' + Math.round(r.ip.fakes * 100) + '%', r.ip.brand < 0.7 ? 'neg' : ''));
      tiles.appendChild(stat('IP契約', on + ' / ' + r.ip.contracts.length + '社', '契約料 年' + money(r.ip.contracts.reduce(function (n, c) { return n + (c.on ? c.fee : 0); }, 0)), on < r.ip.contracts.length ? 'neg' : ''));
      tiles.appendChild(stat('成果報酬（企画採用）', group(r.ip.ideas.all || 0) + '件', '1件 $500K・累計 ' + money(r.ip.ideas.paid || 0)));
    }
    if (r.license) tiles.appendChild(stat('MY WAYとのIP契約', r.license.dead ? 'MY WAYが倒産' : r.license.on ? '契約中' : '打ち切り', '契約料 年' + money(r.license.fee) + (r.license.last ? '・先月の採算 ' + money(r.license.last.margin) : ''), !r.license.on || (r.license.last && r.license.last.margin < 0) ? 'neg' : ''));
    if (r.seeds) tiles.appendChild(stat('金の生る木の種', group(r.seeds.n) + '本/月', r.seeds.m + '・平均' + money(r.seeds.price) + '・原価$1.0M・出荷済み ' + group(r.seeds.sold) + '本'));
    body.appendChild(tiles);
    // the year's plan
    var g = sv.guide;
    if (g) {
      var pg = panel(g.fy + '年度の業績予想', '期初 ' + (g.pub ? dayLabel(g.pub) : '') + ' 公表');
      var ytd = (r.quarters || []).filter(function (q) { return q.key.indexOf('FY' + g.fy) === 0; });
      var done = ytd.reduce(function (a, q) { a.sales += q.pl.sales; a.op += q.pl.op; a.net += q.pl.net; return a; }, { sales: 0, op: 0, net: 0 });
      pg.appendChild(table([['', 0], ['予想', 1], ['ここまで（' + ytd.length + '四半期）', 1], ['進捗', 1]], [
        [p.salesName || '売上高', money(g.sales), money(done.sales), g.sales > 0 ? Math.round(done.sales / g.sales * 100) + '%' : '—'],
        ['営業利益', money(g.op), money(done.op), g.op > 0 ? Math.round(done.op / g.op * 100) + '%' : '—'],
        ['経常利益', money(g.ord), '', ''],
        ['当期純利益', money(g.net), money(done.net), g.net > 0 ? Math.round(done.net / g.net * 100) + '%' : '—'],
        ['1株当たり純利益', '$' + group(g.eps), '', ''],
        ['1株配当（年・業績連動）', '$' + group(g.dps), '', '']
      ]));
      body.appendChild(pg);
    }
    // its days
    var METRICS = [['sales', p.salesName || '売上高'], ['op', '営業利益'], ['net', '純利益'], ['cash', '現金'], ['equity', '純資産'], ['debt', '借入金'], ['staff', '社員数'], ['players', 'プレイヤー'], ['npc', '市民']];
    if (p.listed) METRICS.push(['fair', '適正株価']);
    if (!METRICS.some(function (x) { return x[0] === st.metric; })) st.metric = 'sales';
    // (sales and profits by the month, as the books close them; the players' money by the last 30 days; the rest at each day's end)
    var monthly = ['sales', 'op', 'net'].indexOf(st.metric) >= 0, d = r.days, names, vals;
    var pc = panel('推移', monthly ? '月ごと（締めた月）' : st.metric === 'players' || st.metric === 'npc' ? '各日までの30日間の合計' : '各日の終わり');
    pc.appendChild(chips(METRICS, st.metric, function (k) { st.metric = k; render(); }, '推移の項目'));
    if (monthly) { names = r.months.map(function (m) { return m.label; }); vals = r.months.map(function (m) { return m.pl[st.metric]; }); }
    else if (st.metric === 'players' || st.metric === 'npc') { vals = rolling(d[st.metric] || [], 30).slice(29); names = dayNames(d.day.slice(29)); }
    else { vals = d[st.metric] || []; names = dayNames(d.day); }
    var label = (METRICS.filter(function (x) { return x[0] === st.metric; })[0] || [])[1];
    pc.appendChild(chart(names, vals, st.metric === 'staff' ? function (v) { return group(v) + '名'; } : st.metric === 'fair' ? function (v) { return '$' + group(v); } : money, label));
    body.appendChild(pc);
    // the players' money
    var pp = panel('プレイヤーが使ったお金', '直近30日');
    var total = (r.flows || []).reduce(function (a, f) { return a + f.spent; }, 0);
    pp.appendChild(el('p', 'corp-big', money(total)));
    pp.appendChild(el('p', 'muted', playersNote(p)));
    body.appendChild(pp);
    // the people's money
    var pm = panel('市民（NPC）が使ったお金', '直近30日（締めた日）');
    pm.appendChild(el('p', 'corp-big', p.abroad ? '—' : money(m.people || 0)));
    pm.appendChild(el('p', 'muted', p.abroad ? '国外の会社のため、市民から直接のお金は届きません（市民がカーオーナー・ジンクスで買ったYOSHIDA車・エンジンは、その仕入れ代金として届きます）。' : '市民がこの会社の商品・サービス・ゲーム・カジノ（負け分）などに払ったお金の合計です。'));
    body.appendChild(pm);
    // the latest news
    var pn = panel('最新のお知らせ');
    pn.appendChild(newsList(r.news.slice(0, 6)));
    body.appendChild(pn);
  }
  function playersNote(p) {
    var by = { carowner: '車の購入（MAGITA・YOSHIDA）', jinx: 'SHOPでの購入', yosida: 'ガチャ代・クエスト報酬の手数料・金の生る木の肥料（40%）と木の市場、カーオーナー・ジンクス経由（YOSHIDA車・エンジンの仕入れ）。ガチャ代の50%は国にも請求', daizin: 'VIPのコイン購入（ロイヤルコインの買い取りは支出）', citywork: 'バイトの給料に対する掲載料（シェア分）',
      wazima: '—（MAGITA車の受託製造・共同開発。利益は毎月MAGITAへ）', myway: '投資での新株の購入（売上は連携企業のIP契約料と、市民の直営ショールームでの購入）',
      speedeed: 'バイトの給料に対する掲載料（シェア分）', dtrade: '投資の売買手数料', riru: '投資での新株の購入', ice: '投資での新株の購入', magita: 'MAGITA Garage（契約料・増設・貸し出し手数料）・MAGITA Robert（中古車の買い取り）・カーオーナー・ジンクス経由の仕入れ', tenesice: '—（プレイヤーとの直接の取引はありません）' };
    return 'プレイヤーのお金が届く先：' + (by[p.id] || '—');
  }
  function newsList(list) {
    var ul = el('ul', 'corp-news');
    if (!list.length) { ul.appendChild(el('li', 'muted', 'お知らせはまだありません')); return ul; }
    list.forEach(function (n) {
      var li = el('li'), h = el('div', 'corp-news-head');
      h.appendChild(el('time', 'muted', when(n.at)));
      h.appendChild(el('span', 'tag corp-tag', NEWS[n.kind] || n.kind));
      if (n.public === 0) h.appendChild(el('span', 'tag corp-tag inside', '社内'));
      li.appendChild(h);
      li.appendChild(el('p', '', n.text));
      ul.appendChild(li);
    });
    return ul;
  }

  // 決算: the statements by the quarter, the year or the month
  function pageFin(body, r, p) {
    var rows = st.mode === 'y' ? r.years : st.mode === 'm' ? r.months : r.quarters;
    var bar = el('div', 'corp-toolbar');
    bar.appendChild(chips([['q', '四半期'], ['y', '年度'], ['m', '月次']], st.mode, function (k) { st.mode = k; render(); }, '期間'));
    bar.appendChild(chips([['pl', '損益計算書'], ['bs', '貸借対照表'], ['cf', 'キャッシュ・フロー計算書']], st.sheet, function (k) { st.sheet = k; render(); }, '決算書'));
    body.appendChild(bar);
    var list = rows.slice().reverse().slice(0, st.mode === 'm' ? 12 : st.mode === 'y' ? 5 : 8);
    if (!list.length) { body.appendChild(el('p', 'muted corp-empty', 'まだ締めた期間がありません')); return; }
    var now = (r.now || Date.now()) / 1000;
    var head = [['（百万ドル）']].concat(list.map(function (x) {
      var t = x.label.replace(/^(\d+)年度 第(\d)四半期$/, '$1年度 Q$2');
      if (x.announce && x.announce > now) t += '（発表前）';
      return [t, 1];
    }));
    var out = st.sheet === 'bs' ? bsRows(list, p) : st.sheet === 'cf' ? cfRows(list) : plRows(list, p);
    body.appendChild(table(head, out, 'corp-sheet'));
    var notes = el('p', 'muted corp-note');
    notes.textContent = st.sheet === 'pl' ? '売上高・粗利・当期純利益は、日々の取引（プレイヤーが実際に使ったお金を含む）を複式簿記で積み上げたものです。四半期は期末から14日後の15:00（日本時間）に発表されます（発表前の数字は運営だけが見られます）。'
      : st.sheet === 'bs' ? '各期末の残高です。資産合計＝負債合計＋純資産合計。'
      : '直接法。期首の現金に各活動の増減を足すと期末の現金になります。';
    body.appendChild(notes);
    if (st.mode === 'y' && st.sheet === 'pl' && list[0].tax) body.appendChild(taxPanel(list[0]));
  }
  // the P/L's lines, each line's accounts under it, the per-share figures under them
  function plRows(list, p) {
    var out = [];
    C().pl.forEach(function (line) {
      var name = line.id === 'sales' && p.salesName ? p.salesName : line.name;
      out.push({ cls: line.total ? 'corp-total' + (line.id === 'net' ? ' corp-net' : '') : 'corp-line', cells: [name].concat(list.map(function (x) { return { t: mil(x.pl[line.id]), cls: x.pl[line.id] < 0 ? 'neg' : '' }; })) });
      if (line.kinds) {
        var codes = {};
        list.forEach(function (x) { Object.keys(x.accounts || {}).forEach(function (k) { if (line.kinds.indexOf(C().account(k, p)[1]) >= 0) codes[k] = (codes[k] || 0) + Math.abs(x.accounts[k]); }); });
        Object.keys(codes).sort(function (a, b) { return codes[b] - codes[a]; }).forEach(function (k) {
          out.push({ cls: 'corp-sub', cells: [C().account(k, p)[0]].concat(list.map(function (x) { var v = (x.accounts || {})[k]; return v ? mil(v) : '—'; })) });
        });
      }
      if (line.id === 'sales') out.push({ cls: 'corp-sub', cells: ['前年同期比'].concat(list.map(function (x) { var g = x.prev ? ratio(x.pl.sales, x.prev.sales) : null; return g === null ? '—' : pct(g); })) });
    });
    out.push({ cls: 'corp-total', cells: ['1株当たり当期純利益（ドル）'].concat(list.map(function (x) { return group(x.eps); })) });
    out.push({ cls: 'corp-line', cells: ['1株配当（ドル・期中支払い）'].concat(list.map(function (x) { return group(x.dps); })) });
    out.push({ cls: 'corp-line', cells: ['期末従業員数'].concat(list.map(function (x) { return group(x.staff) + '名'; })) });
    return out;
  }
  // the B/S's groups, their accounts and totals (a tax paid ahead is an asset: 未収還付法人税等)
  function bsRows(list, p) {
    var out = [], sideTotal = { a: [], l: [], e: [] };
    list.forEach(function () { sideTotal.a.push(0); sideTotal.l.push(0); sideTotal.e.push(0); });
    var val = function (x, k) { var v = x.bs[k] || 0; return k === 'taxdue' && v < 0 ? 0 : v; };
    var refund = function (x) { return x.bs.taxdue < 0 ? -x.bs.taxdue : 0; };
    var SIDES = { a: '資産の部', l: '負債の部', e: '純資産の部' };
    var lastSide = '';
    C().bs.forEach(function (g) {
      if (g.side !== lastSide) {
        if (lastSide) out.push({ cls: 'corp-total', cells: [SIDES[lastSide].replace('の部', '合計')].concat(sideTotal[lastSide].map(mil)) });
        out.push({ cls: 'corp-head', cells: [SIDES[g.side]].concat(list.map(function () { return ''; })) });
        lastSide = g.side;
      }
      var accounts = g.accounts.filter(function (k) { return list.some(function (x) { return val(x, k); }); });
      var extra = g.id === 'current' && list.some(refund);
      var tot = list.map(function (x) { return accounts.reduce(function (n, k) { return n + val(x, k); }, 0) + (g.id === 'current' ? refund(x) : 0); });
      tot.forEach(function (v, i) { sideTotal[g.side][i] += v; });
      out.push({ cls: 'corp-line', cells: [g.name].concat(tot.map(mil)) });
      accounts.forEach(function (k) { out.push({ cls: 'corp-sub', cells: [C().account(k, p)[0]].concat(list.map(function (x) { var v = val(x, k); return v ? mil(v) : '—'; })) }); });
      if (extra) out.push({ cls: 'corp-sub', cells: ['未収還付法人税等'].concat(list.map(function (x) { return refund(x) ? mil(refund(x)) : '—'; })) });
    });
    out.push({ cls: 'corp-total', cells: ['純資産合計'].concat(sideTotal.e.map(mil)) });
    out.push({ cls: 'corp-total corp-net', cells: ['負債純資産合計'].concat(sideTotal.l.map(function (v, i) { return mil(v + sideTotal.e[i]); })) });
    return out;
  }
  // the C/F: its three parts and their lines, the change in cash, cash at the start and the end
  function cfRows(list) {
    var out = [];
    C().cf.forEach(function (part) {
      out.push({ cls: 'corp-head', cells: [part.name].concat(list.map(function () { return ''; })) });
      part.lines.forEach(function (ln) {
        if (!list.some(function (x) { return x.cf[ln[0]]; })) return;
        out.push({ cls: 'corp-sub', cells: [ln[1]].concat(list.map(function (x) { var v = x.cf[ln[0]] || 0; return { t: v ? mil(v) : '—', cls: v < 0 ? 'neg' : '' }; })) });
      });
      out.push({ cls: 'corp-total', cells: [part.name.replace('による', '').replace('キャッシュ・フロー', 'CF') + ' 計'].concat(list.map(function (x) {
        var v = part.lines.reduce(function (n, ln) { return n + (x.cf[ln[0]] || 0); }, 0); return { t: mil(v), cls: v < 0 ? 'neg' : '' };
      })) });
    });
    out.push({ cls: 'corp-line', cells: ['現金及び現金同等物の増減額'].concat(list.map(function (x) { return mil(x.cash - x.cash0); })) });
    out.push({ cls: 'corp-line', cells: ['期首残高'].concat(list.map(function (x) { return mil(x.cash0); })) });
    out.push({ cls: 'corp-total corp-net', cells: ['期末残高'].concat(list.map(function (x) { return mil(x.cash); })) });
    return out;
  }
  function taxPanel(y) {
    var t = y.tax, pt = panel('税金の内訳（' + y.label + '）', t.small ? '中小法人（資本金1億ドル以下）' : '大法人（外形標準課税あり）');
    pt.appendChild(table([['', 0], ['金額', 1]], [
      ['課税所得', money(t.taxable)], ['繰越欠損金の使用', t.used ? money(t.used) : '—'], ['法人税', money(t.corporate)], ['地方法人税', money(t.local)],
      ['住民税（法人税割＋均等割 ' + money(t.flat || 0) + '）', money(t.inhabitant)], ['事業税（所得割）', money(t.business)],
      ['特別法人事業税', money(t.special || 0)], ['外形標準課税（付加価値割・資本割）', t.small ? '—' : money(t.sizeTax || 0)], { cls: 'corp-total', cells: ['合計', money(t.total)] }
    ]));
    return pt;
  }

  // 商品: each product's economics, and what sold of it
  function pageProducts(body, r, p) {
    var maker = p.id === 'magita';
    var pn = panel(maker ? 'MAGITAが作って卸している商品' : '取り扱い商品', '販売費は価格に上乗せせず販売店の販管費（販売費）で計上');
    pn.appendChild(table([['商品'], ['販売価格', 1], ['原価（材料のみ）', 1], ['仕入れ価格', 1], ['専売特別費用', 1], ['販売店の純利益', 1], ['販売費/個', 1], ['MAGITAの取り分', 1], ['先月 販売数', 1], ['うちプレイヤー', 1], ['12か月 販売数', 1]],
      r.products.map(function (x) {
        var name = el('span', '', x.name);
        if (x.ended) { var w = el('span', 'tag corp-tag inside', '販売終了'); name = el('span'); name.appendChild(el('span', '', x.name + ' ')); name.appendChild(w); }
        var mo = x.month || { npc: 0, players: 0 }, yr = x.year || { npc: 0, players: 0 };
        var known = x.cost !== undefined;
        return [{ t: name }, money(x.price), known ? money(x.cost) : '—', !known ? '—' : x.buy === null ? '（自社）' : money(x.buy),
          x.excl === null || x.excl === undefined ? '—' : money(x.excl), x.sellerNet === undefined ? '—' : { t: money(x.sellerNet), cls: x.sellerNet < 0 ? 'neg' : '' },
          x.selling ? money(x.selling) : '—', x.makerNet === null || x.makerNet === undefined ? '—' : money(x.makerNet),
          group(mo.npc + mo.players), group(mo.players), group(yr.npc + yr.players)];
      })));
    pn.appendChild(el('p', 'muted corp-note', '販売店の純利益＝販売価格−仕入れ価格−専売特別費用（販売費を引く前）。MAGITAの取り分＝仕入れ価格＋専売特別費用−材料の原価。メーカーがMAGITAだけなので販売店の利幅は小さく、MAGITAのコスト削減で原価は低く抑えられています。販売数にはプレイヤー以外のお客（NPC）への販売も含まれます。'));
    body.appendChild(pn);
  }

  // 事業: each business's sales and costs; the studios' games; the bank's book
  function pageBiz(body, r, p) {
    var last = r.quarters[r.quarters.length - 1], year = r.years[r.years.length - 1];
    if (p.streams && (last || year)) {
      var ps = panel('事業ごとの売上と原価', '百万ドル');
      var head = [['事業']], cols = [];
      if (last) { head.push([last.label.replace(/^(\d+)年度 第(\d)四半期$/, '$1年度Q$2') + ' 売上', 1], ['原価', 1]); cols.push(last); }
      if (year) { head.push([year.label + ' 売上', 1], ['原価', 1]); cols.push(year); }
      ps.appendChild(table(head, p.streams.map(function (x) {
        var row = [x.name];
        cols.forEach(function (c) { row.push(mil((c.accounts || {})['r:' + x.id] || 0), (c.accounts || {})['c:' + x.id] ? mil(c.accounts['c:' + x.id]) : '—'); });
        return row;
      })));
      body.appendChild(ps);
    }
    if (p.model === 'studio') studioPages(body, r, p);
    if (r.lab) labPanel(body, r);
    if (r.wlab) wazimaPanel(body, r);
    if (r.ip) mywayPanel(body, r);
    if (r.license) licensePanel(body, r, p);
    if (r.biz) bizPanel(body, r, p);
    if (r.gov) body.appendChild(govPanel(r.gov));
    if (p.model === 'bank') {
      var b = r.state.bal, pb = panel('銀行の勘定', '貸出・預金・有価証券');
      var tiles = el('div', 'corp-tiles');
      tiles.appendChild(stat('貸出金', money(b.lent || 0), '')); tiles.appendChild(stat('預金', money(b.deposits || 0), ''));
      tiles.appendChild(stat('有価証券', money(b.bonds || 0), '')); tiles.appendChild(stat('預貸率', b.deposits ? Math.round((b.lent || 0) / b.deposits * 100) + '%' : '—', '貸出金÷預金'));
      pb.appendChild(tiles);
      pb.appendChild(el('p', 'muted corp-note', '融資本部が毎週各社の与信を審査し、ランクAの会社には年0.8%〜1.2%、ランクBには3%〜6%、ランクCには10%で貸し出しています。MY WAYだけは勢いを恐れて、ランクにかかわらず年15%（融資枠は純資産の半分まで）。各社の「株式・財務」に借入の明細。'));
      body.appendChild(pb);
    }
    var pg = panel('年間予算');
    var bud = r.state.budget;
    pg.appendChild(table([['費目'], ['年額', 1]], [
      [p.place ? p.place.name : '施設費', money(bud.place)], [p.rd ? p.rd.name : '研究開発費', money(bud.rd)], ['広告宣伝費', bud.ads ? money(bud.ads) : '—'],
      ['その他の経費', money(bud.other)], ['設備投資', bud.capex ? money(bud.capex) : '—']
    ]));
    body.appendChild(pg);
  }
  // MY WAY: its characters (流行・信用・コピー品), each partner's contract (its fee, last month's sales and margin, the
  // breakeven), the new characters and what happened
  function mywayPanel(body, r) {
    var ip = r.ip, pc = panel('IP契約（連携企業）', '契約料は年額。採算＝コラボ売上 − 原価 − 契約料（先月）');
    pc.appendChild(table([['企業'], ['内容'], ['契約料', 1], ['状態'], ['先月のコラボ売上', 1], ['先月の採算', 1], ['採算ライン', 1]], ip.contracts.map(function (c) {
      return { onclick: function () { open(c.id); }, cells: [c.name, c.what, money(c.fee) + (c.fee !== c.base ? '（当初 ' + money(c.base) + '）' : ''), c.on ? '契約中' : '打ち切り' + (c.until ? '（' + dayLabel(c.until) + '）' : ''),
        c.last ? money(c.last.sales) : '—', { t: c.last ? money(c.last.margin) : '—', cls: c.last && c.last.margin < 0 ? 'neg' : '' }, '流行×信用 ' + Math.round(c.breakeven * 100) + '%'] };
    })));
    pc.appendChild(el('p', 'muted corp-note', '連携企業は契約料を毎日の費用として払い（MY WAYの売上）、MY WAYのキャラクター商品を通常の2倍の価格で売ります（コラボ売上＝当初の契約料×倍率×流行×信用）。採算割れが続くと連携企業の交渉担当が契約の打ち切りを会議にかけ、人気が戻ると再契約を検討します。契約料はMY WAYの交渉係と各社の交渉担当が四半期ごとに交渉します（当初の50%〜160%）。今の流行×信用は ' + Math.round(ip.pull * 100) + '%。'));
    body.appendChild(pc);
    var pk = panel('キャラクター', '新キャラクター（研究開発・緊急投入）');
    pk.appendChild(table([['日付'], ['キャラクター'], ['結果'], ['流行']], ip.chars.slice().reverse().map(function (x) { return [dayLabel(x.day), x.name, x.hit ? 'ヒット' : '不発', '+' + Math.round(x.by * 100) + '%']; })));
    pk.appendChild(el('p', 'muted corp-note', '流行は毎年少しずつ下がり（新キャラクターが1年出ないとマンネリ化で速く下がる）、新キャラクターのヒットと社員のアイデア（1件$500Kの成果報酬）で上がります。信用はコピー品の氾濫やスキャンダルで下がり、法的措置やキャンペーンで回復します。基本給と月次ボーナスは減額できないため、売上が落ちると大赤字になります。資金が尽き、テネシス（年15%・純資産の半分まで）からも借りられなくなると倒産します。'));
    body.appendChild(pk);
    var pe = panel('最近の出来事');
    pe.appendChild(table([['日付'], ['出来事']], ip.events.slice().reverse().map(function (e) { return [dayLabel(e.day), e.text]; })));
    body.appendChild(pe);
  }
  // a partner's contract with MY WAY
  function licensePanel(body, r, p) {
    var c = r.license, pl = panel('MY WAYとのIP契約', c.what);
    var tiles = el('div', 'corp-tiles');
    tiles.appendChild(stat('状態', c.dead ? 'MY WAYが倒産' : c.on ? '契約中' : '打ち切り', c.on ? dayLabel(c.from) + 'から' : c.until ? dayLabel(c.until) + 'まで' : ''));
    tiles.appendChild(stat('契約料（年）', money(c.fee), '当初 ' + money(c.base)));
    if (c.last) { tiles.appendChild(stat('先月のコラボ売上', money(c.last.sales), '原価 ' + money(c.last.cost) + '・契約料 ' + money(c.last.fee))); tiles.appendChild(stat('先月の採算', money(c.last.margin), '', c.last.margin < 0 ? 'neg' : '')); }
    tiles.appendChild(stat('採算ライン', '流行×信用 ' + Math.round(c.breakeven * 100) + '%', 'これを下回ると赤字'));
    pl.appendChild(tiles);
    pl.appendChild(el('p', 'muted corp-note', p.name + 'はMY WAYのキャラクターを使う代わりに契約料を払います（決算の「IP契約料（MY WAYへの支払ロイヤリティ）」）。コラボ商品は「MY WAYコラボ売上」。MY WAYとコラボしている間は投資熱で株価が高めに評価され、契約の発表日には株価が20〜35%急騰します。'));
    body.appendChild(pl);
  }
  // MAGITA's research (A1, T1, MOL1, RIMU TAG) and its surcharge while it struggles
  function labPanel(body, r) {
    var lab = r.lab, today = Math.floor((r.now || Date.now()) / 86400000);
    var pl = panel('研究開発プロジェクト', '製造原価 ×' + lab.mult.toFixed(3) + (lab.speed < 1 ? '・研究期間 ×' + lab.speed.toFixed(2) : ''));
    pl.appendChild(table([['研究'], ['開始'], ['完了（予定）'], ['状態'], ['効果']], lab.list.map(function (x) {
      var state = x.done ? (x.ok ? '成功' : '失敗') : '研究中 ' + Math.max(0, Math.min(99, Math.round((today - x.start) / Math.max(1, x.due - x.start) * 100))) + '%';
      var effect = x.cut ? '原価 −' + Math.round(x.cut * 100) + '%' : x.speed ? 'ほかの研究期間 −' + Math.round(x.speed * 100) + '%' : '';
      if (x.chance < 1) effect += '（成功率' + Math.round(x.chance * 100) + '%）';
      return [x.name, dayLabel(x.start), dayLabel(x.done || x.due), state, effect];
    })));
    pl.appendChild(el('p', 'muted corp-note', r.surcharge
      ? '経営悪化のため、' + dayLabel(r.surcharge) + 'からオンヴォーロ以外の全車種の仕入れ価格に手数料$3,000,000を上乗せ中（カーオーナーの販売価格も同額上がります）。四半期の営業利益が計画の90%に戻ると終了します。'
      : '四半期の営業利益が計画の50%を下回るか赤字になると、オンヴォーロ以外の全車種の仕入れ価格に手数料$3,000,000を上乗せします（カーオーナーの販売価格も同額上がります）。'));
    body.appendChild(pl);
  }
  // WAZIMA's research for MAGITA: what each cuts of MAGITA's costs besides materials, and where they are now
  function wazimaPanel(body, r) {
    var w = r.wlab, today = Math.floor((r.now || Date.now()) / 86400000), names = C().wazima.of, sv = w.save || {};
    var pl = panel('MAGITAのコスト削減研究', '製造経費 ×' + (sv.place || 1).toFixed(3) + '・研究開発費 ×' + (sv.rd || 1).toFixed(3) + '・その他 ×' + (sv.other || 1).toFixed(3));
    pl.appendChild(table([['研究'], ['開始'], ['完了（予定）'], ['状態'], ['効果']], w.list.slice().reverse().map(function (x) {
      var state = x.done ? (x.ok ? '成功' : '失敗') : '研究中 ' + Math.max(0, Math.min(99, Math.round((today - x.start) / Math.max(1, x.due - x.start) * 100))) + '%';
      return [x.name, dayLabel(x.start), dayLabel(x.done || x.due), state, 'MAGITAの' + x.of.map(function (k) { return names[k]; }).join('・') + ' −' + Math.round(x.cut * 100) + '%（成功率' + Math.round(x.chance * 100) + '%）'];
    })));
    pl.appendChild(el('p', 'muted corp-note', '原料以外のコスト（製造経費・研究開発費・その他の経費）を下げる研究です。成功するとMAGITAのその費用が下がります（元の55%まで）。WAZIMAの売上と費用は毎日MAGITAの決算に「WAZIMA（子会社・連結）」として計上され（MAGITAが払う共同開発費は除く）、利益は毎月の締めでMAGITAに払われます（営業外の分と税金の差は「子会社からの受取配当金」、赤字の月はMAGITAが負担）。MAGITAの研究開発費の25%は共同開発の費用としてWAZIMAに支払われます。'));
    body.appendChild(pl);
  }
  // the game's businesses by the month: YOSIDA's quests, gacha and trees; DAIZIN's buying back of the coins
  function bizPanel(body, r, p) {
    var keys = Object.keys(r.biz).sort().reverse().slice(0, 6);
    if (!keys.length) return;
    var cols = p.id === 'daizin'
      ? [['coins', '買い取ったコイン（枚）', group], ['coinPaid', '買い取りに払った額', money]]
      : [['gacha', 'ガチャ代', money], ['claim', '国への請求（50%）', money], ['prizeCost', '景品の原価', money], ['lot', 'ロットコイン（利益剰余金から）', money], ['royal', 'ロイヤルコイン（枚）', group],
        ['garage', 'ガレージコイン（枚）', group], ['vip', 'VIP1週間券（枚）', group], ['cars', '車（台）', group], ['tree', '金の生る木（本）', group],
        ['questfee', 'クエスト手数料', money], ['fertilizer', '肥料（40%）', money], ['treeSales', '木の市場', money]];
    var pb = panel(p.id === 'daizin' ? 'ロイヤルコインの買い取り' : 'ゲーム内の事業（クエスト・ガチャ・金の生る木）', '月ごと');
    pb.appendChild(table([['月']].concat(cols.map(function (c) { return [c[1], 1]; })), keys.map(function (k) {
      var m = r.biz[k];
      return [k].concat(cols.map(function (c) { return m[c[0]] ? c[2](m[c[0]]) : '—'; }));
    })));
    pb.appendChild(el('p', 'muted corp-note', p.id === 'daizin'
      ? 'プレイヤーのロイヤルコインを1枚$50,000で、DAIZINが自社の資金で買い取っています（売上原価「ロイヤルコインの買い取り」）。YOSIDAがガチャの景品として買うロイヤルコイン（1枚$100,000）とVIP1週間券は「ロイヤルコイン・VIP1週間券の販売（YOSIDA向け）」の売上です。'
      : 'ガチャの景品：ロットコインはトークンの価格で利益剰余金から直接、ロイヤルコインは1枚$100,000でDAIZINから、ガレージコインは1枚$1.4MでMAGITAから、VIP1週間券はDAIZINと交渉した価格で、MAGITAの車はMAGITAの仕入れ価格＋専売特別費用で買い、YOSHIDA車は自社の売上、金の生る木は自社製（原価$1.0M）、リセットチケットは自社のクエスト事業のため$0です。'));
    body.appendChild(pb);
  }
  function studioPages(body, r, p) {
    var lineName = function (id) { var l = (p.lines || []).filter(function (x) { return x.id === id; })[0]; return l ? l.name + (l.scale ? '（' + l.scale + '）' : '') : id; };
    var pj = panel('開発中のプロジェクト', r.projects.length + '本');
    pj.appendChild(table([['タイトル（仮）'], ['ジャンル'], ['ライン'], ['開始'], ['発売予定'], ['進み具合', 1], ['開発費（ここまで）', 1], ['延期', 1]],
      r.projects.slice().sort(function (a, b) { return a.due - b.due; }).map(function (x) {
        // (one that is done waits for its day: 完成)
        var done = Math.min(100, Math.round(x.prog * 100)), prog = el('span', 'corp-prog'), bar = el('i');
        bar.style.setProperty('--w', done + '%'); prog.appendChild(bar); prog.appendChild(el('b', '', x.prog >= 1 ? '完成・発売待ち' : done + '%'));
        return [x.name + (x.sequel ? '（続編）' : ''), x.genre, lineName(x.line), dayLabel(x.start), dayLabel(x.due), { t: prog }, money(x.spent), x.delays ? x.delays + '回' : '—'];
      })));
    body.appendChild(pj);
    var tt = panel('発売中のタイトル', '品質は0〜100');
    tt.appendChild(table([['タイトル'], ['ジャンル'], ['発売日'], ['品質', 1], ['開発費', 1], ['累計売上', 1], ['販売本数', 1], ['見込み', 1], ['']],
      r.titles.slice().sort(function (a, b) { return b.day - a.day; }).map(function (x) {
        return [x.name, x.genre, dayLabel(x.day), String(x.q), money(x.cost), money(x.sold), group(x.units), money(x.est), x.hit ? 'ヒット' : ''];
      })));
    body.appendChild(tt);
    if (r.live.length) {
      var lv = panel('運営型タイトル', '年間の売上ペース');
      lv.appendChild(table([['タイトル'], ['ジャンル'], ['売上ペース（年）', 1], ['次の大型アップデート']], r.live.map(function (x) { return [x.name, x.genre, money(x.rate), dayLabel(x.next)]; })));
      body.appendChild(lv);
    }
    var pc = panel('旧作（カタログ）', '');
    pc.appendChild(el('p', '', '旧作の売上ペース：年' + money(r.catalog)));
    var bk = r.state.backing;
    if (p.partner && p.partner.role === 'backer' && bk) pc.appendChild(el('p', '', nameOf(p.partner.with) + 'への開発援助・業務委託：' + bk.fy + '年度 予算' + money(bk.budget) + '、支払い済み' + money(bk.paid)));
    if (p.partner && p.partner.role === 'studio') pc.appendChild(el('p', '', nameOf(p.partner.with) + 'から毎月、業務委託料と開発援助金を受け取って共同開発しています（' + nameOf(p.partner.with) + 'が株式の約20%を保有）。'));
    body.appendChild(pc);
    if (r.archive.length) {
      var ar = panel('販売を終えたタイトル', '最近の' + r.archive.length + '本');
      ar.appendChild(table([['タイトル'], ['ジャンル'], ['発売日'], ['品質', 1], ['累計売上', 1], ['販売本数', 1]], r.archive.map(function (x) { return [x.name, x.genre, dayLabel(x.day), String(x.q), money(x.sold), group(x.units)]; })));
      body.appendChild(ar);
    }
  }

  // 人と予算: the people, their pay and morale
  function pagePeople(body, r, p) {
    var s = r.state, tiles = el('div', 'corp-tiles');
    tiles.appendChild(stat('従業員数', group(s.staff) + '名', s.target !== s.staff ? '目標 ' + group(s.target) + '名' : ''));
    tiles.appendChild(stat('平均年収', money(s.pay), 'はじめ ' + money(p.salary)));
    tiles.appendChild(stat('会社負担（1人・年）', money(s.unit), '給与＋賞与＋法定福利費など'));
    tiles.appendChild(stat('人件費（年）', money(s.staff * s.unit), ''));
    tiles.appendChild(stat('士気', Math.round(s.morale * 100) + '%', s.morale >= 0.7 ? '高い' : s.morale >= 0.45 ? 'ふつう' : '低い'));
    body.appendChild(tiles);
    var pc = panel('社員数の推移');
    pc.appendChild(chart(dayNames(r.days.day), r.days.staff, function (v) { return group(v) + '名'; }, '社員数'));
    body.appendChild(pc);
    if (r.cut) body.appendChild(el('p', 'corp-note neg', dayLabel(r.cut.day) + '：業績不振のため社員' + group(r.cut.n) + '人の削減を決定（退職金 1人' + money(r.cut.each) + '）'));
    // 技術開発: the one under way and the last done
    if (r.tech) {
      var t = r.tech, pt = panel('技術開発', '社員が多いほど・士気と研究費が高いほど成功しやすい');
      var rows = [];
      if (t.cur) rows.push([t.cur.name, dayLabel(t.cur.start), dayLabel(t.cur.due), '開発中', '成功率 ' + Math.round(t.chance * 100) + '%（今の社員・士気・研究費で）']);
      if (t.last) rows.push([t.last.name, dayLabel(t.last.start), dayLabel(t.last.day), t.last.ok ? '成功' : '失敗', t.last.ok ? (p.model === 'studio' ? 'ゲームの品質 +' : '売上 +') + ((t.last.lift || 0) * (p.model === 'studio' ? 2 : 1) * 100).toFixed(1) + '%' : '成功率 ' + Math.round((t.last.chance || 0) * 100) + '%だった']);
      pt.appendChild(rows.length ? table([['開発'], ['開始'], ['完了'], ['状態'], ['効果']], rows) : el('p', 'muted', 'まだありません（毎月1日に始まります）'));
      pt.appendChild(el('p', 'muted corp-note', '1つずつ5〜11か月かけて開発します。成功すると売上（スタジオはゲームの品質）が上がり、効果は少しずつ薄れます（ほかの会社も追いつくため）。今の累計：売上 ×' + t.edge.toFixed(3) + '。'));
      body.appendChild(pt);
    }
    body.appendChild(el('p', 'muted corp-note', '昇給は毎年4月、前年度の業績しだい。新卒は4月入社、中途採用は毎月1日。賞与は6月と12月に業績連動で支給されます。四半期末に今年度の営業利益が計画の50%を割る（または赤字）と社員の3〜10%を削減し（退職金は給与3か月分）、計画の125%を超えると採用計画を2〜5%増やします。'));
  }

  // 株式・財務: the shares and who holds them, the dividends, the loans and the taxes carried
  function pageStock(body, r, p) {
    var s = r.state, sh = s.shares, tiles = el('div', 'corp-tiles');
    tiles.appendChild(stat('発行済株式数', group(sh.issued) + '株', sh.treasury ? '自己株式 ' + group(sh.treasury) + '株' : ''));
    tiles.appendChild(stat('創業家などの保有', Math.round(sh.founders / Math.max(1, sh.issued) * 100) + '%', ''));
    tiles.appendChild(stat('1株配当（年）', '$' + group(s.dividend.dps), '配当総額 ' + money(s.dividend.total)));
    tiles.appendChild(stat('配当性向（目標）', Math.round((p.payout || 0) * 100) + '%', '業績連動'));
    tiles.appendChild(stat('1株当たり純資産', '$' + group(r.summary.equity / Math.max(1, sh.out)), ''));
    if (p.listed) tiles.appendChild(stat('適正株価（理論値）', '$' + group(r.summary.fair), 'PER ' + p.per + '倍・PBR ' + p.pbr + '倍が目安'));
    body.appendChild(tiles);
    var ph = panel('持ち合い');
    var hold = [];
    Object.keys(s.holders.by || {}).forEach(function (k) { hold.push([nameOf(k) + 'が保有', group(s.holders.by[k]) + '株', Math.round(s.holders.by[k] / Math.max(1, sh.issued) * 1000) / 10 + '%']); });
    Object.keys(s.holders.own || {}).forEach(function (k) { hold.push([nameOf(k) + 'の株を保有', group(s.holders.own[k]) + '株', '持分法']); });
    if (hold.length) ph.appendChild(table([['相手'], ['株数', 1], ['', 1]], hold)); else ph.appendChild(el('p', 'muted', 'ありません'));
    body.appendChild(ph);
    var pl = panel('借入金', 'テネシスから（ランク' + p.rank + '）');
    if (s.loans.length) pl.appendChild(table([['借入'], ['残高', 1], ['金利（年）', 1], ['借入日'], ['返済期限']], s.loans.map(function (l) { return [l.id, money(l.amt), (l.rate * 100).toFixed(2) + '%', dayLabel(l.from), dayLabel(l.until)]; })));
    else pl.appendChild(el('p', 'muted', p.id === 'tenesice' ? '（貸す側です）' : '借入はありません'));
    body.appendChild(pl);
    var pt = panel('税金');
    var tax = s.tax, rows = [];
    if (tax.last) rows.push([(tax.last.fy || '') + '年度の税金（確定）', money(tax.last.total)], ['うち事業税', money(tax.last.business)], ['今年度の中間納付', tax.last.interim ? money(tax.last.interim) : '—']);
    rows.push(['今年度の税金（ここまでの見積もり）', money(tax.booked || 0)]);
    (tax.carry || []).forEach(function (c) { rows.push([c[0] + '年度の繰越欠損金（10年）', money(c[1])]); });
    pt.appendChild(table([['', 0], ['', 1]], rows));
    body.appendChild(pt);
  }

  function pageTies(body, r, p) {
    var pn = panel('ビジネス友好度', '0〜100・▼ははじめの値');
    pn.appendChild(tieList(r.ties, p.id));
    pn.appendChild(el('p', 'muted corp-note', '友好度は毎月、取引の多さ・支払い・援助・ヒット作などで動きます。MAGITAとの友好度が70以上だと四半期末に販売奨励金が出て、60日の支払猶予がもらえます（30未満だと30日）。テネシスとの友好度は借入の金利にも効きます。'));
    body.appendChild(pn);
  }
  function pageNews(body, r) {
    var pn = panel('ニュース', '「社内」は投資の画面に出ないお知らせ');
    pn.appendChild(newsList(r.news));
    body.appendChild(pn);
  }

  return {
    // the app opened (or its icon pressed again): what is shown asked for, { same: true } when nothing changed
    show: function (view, request, toast) {
      st.request = request; st.toast = toast;
      st.view = view;
      render(); ask();
    },
    // a day closed on the server: asked again while the app is in sight (else when it is opened next: show asks)
    live: function () {
      if (st.view && !st.view.hidden && st.view.isConnected) ask();
    }
  };
})();
