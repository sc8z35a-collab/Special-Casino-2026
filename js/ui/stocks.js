/* 投資: the two companies' shares — the chart, the order panel, my holdings,
   orders and dividends. The server decides everything (server/core/stocks.js)
   by the rules in js/game/stocks.js; this screen shows it and sends orders.
   While it is open and in sight the server sends each second's prices on the
   live connection (told every 20 seconds that the screen is still open), and
   the chart is drawn here on a canvas, no library. No words beyond labels.
   The 企業 tab shows the company behind the share (server/core/corp.js): its
   last published quarter, the year's guidance and its dividend, the per-share
   figures, the next 決算発表 and its news (told again when a day closes). */
(function (BR) {
  'use strict';
  var K = BR.kit, api = BR.api, S = BR.STOCKS, el = K.el, fmt = BR.util.fmt;
  var HOLD_MS = 450, RENEW_MS = 20000, GAP_MS = 3500, SYNC_MS = 60000, EASE_MS = 280;
  var UP = '#28c76f', DOWN = '#f0506e', GRID = 'rgba(160,178,205,.16)', TEXT = '#9fb0c8', MA = ['#f5b941', '#9b8cff'];
  var TYPE = { market: '成行', limit: '指値', stop: '逆指値' };
  var STATUS = { filled: '約定', canceled: '取消', expired: '失効', failed: '不成立' };
  var NEWS = { results: '決算', guidance: '予想', revise: '修正', dividend: '配当', release: '発売', hit: 'ヒット', flop: '不振', start: '開発', delay: '延期', cancel: '中止', update: '更新', week: '販売', hire: '採用', support: '援助' };
  var LABEL = { '1h': '1H', '1d': '1D', '1w': '1W', '1m': '1M', '1y': '1Y', all: 'ALL' };
  var root, canvas, ui = {}, st = null, generation = 0, renewTimer = 0, refreshTimer = 0, raf = 0;

  function byId(id) { return document.getElementById(id); }
  function shown() { return !!root && !root.hidden; }
  function money(n) { return '$' + fmt(n); }
  function signed(n) { return (n < 0 ? '−$' : n > 0 ? '+$' : '$') + fmt(Math.abs(n)); }
  function pct(a, b) { return b ? (a - b) / b * 100 : 0; }
  function pctText(x) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(2) + '%'; }
  function tone(x) { return x > 0 ? 'sk-up' : x < 0 ? 'sk-down' : ''; }
  function company() { return S.company(st.company); }
  function quote(id) { return st.market[id || st.company] || null; }
  function holding(id) {
    var m = st.mine, list = m ? m.holdings : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === (id || st.company)) return list[i];
    return { id: id || st.company, shares: 0, free: 0, cost: 0, value: 0, realized: 0, dividends: 0, today: 0 };
  }
  function dollars() { return BR.store.state.dollars || 0; }
  function button(cls, text, run) { var b = el('button', cls, text); b.type = 'button'; if (run) b.addEventListener('click', function (e) { K.sfx('click'); run(e); }); return b; }
  function seg(box, items, pick) {
    box.replaceChildren();
    items.forEach(function (it) {
      var b = button('sk-chip', it.label, function () { pick(it.id); });
      b.dataset.v = it.id;
      box.appendChild(b);
    });
  }
  function mark(box, v) { Array.prototype.forEach.call(box.children, function (b) { b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'); }); }

  function reset() {
    var was = st || {};
    st = {
      company: was.company || 'riru', period: was.period || '1d', mode: was.mode || 'line', ma: !!was.ma, list: 'orders',
      side: 'buy', type: 'market', shares: 1, price: 0, priceFor: '',
      market: {}, mine: null, t: 0, corp: null,
      candles: [], chartKey: '', minute: null,
      history: [], more: false,
      busy: false, pending: null, seen: {}, lastFrame: 0, lastRenew: 0, lastSync: 0, lastFull: 0, hover: -1,
      view: null, anim: null, scale: 1
    };
  }

  /* --------------------------------------------------- the server's word --- */

  function apply(r) {
    r.market.forEach(function (m) {
      var had = st.market[m.id];
      // (prices newer than this answer already came by the second's ticks)
      if (had && r.t < st.t) { m.price = had.price; m.high = Math.max(m.high, had.high); m.low = Math.min(m.low, had.low); }
      st.market[m.id] = m;
    });
    st.mine = r.mine;
    if (r.corp) st.corp = r.corp;
    st.t = Math.max(st.t, r.t);
    if (r.me) { BR.social.setMe(r.me); BR.app.serverBalance(r.me, true); }
    renderAll();
  }
  function load() {
    var gen = generation;
    st.lastSync = st.lastFull = Date.now();
    api.stocks().then(function (r) { if (gen === generation) apply(r); }, function (e) { if (gen === generation) K.fail(e); });
    loadChart(false);
  }
  // the chart of the company and period chosen (`more`: only its last candles, onto the ones held)
  function loadChart(more) {
    var gen = generation, key = st.company + ':' + st.period, held = st.chartKey === key && st.candles.length;
    var since = more && held ? st.candles[Math.max(0, st.candles.length - 2)].at : null;
    api.stocksChart(st.company, st.period, since).then(function (r) {
      if (gen !== generation || key !== st.company + ':' + st.period) return;
      var got = S.decode(r.chart), from = got.length ? got[0].at : Infinity;
      st.candles = (since !== null && st.chartKey === key ? st.candles.filter(function (k) { return k.at < from; }) : []).concat(got);
      var count = S.period(st.period).count;
      if (st.candles.length > count + 1) st.candles = st.candles.slice(st.candles.length - count - 1);
      if (st.chartKey !== key) { st.view = null; st.hover = -1; }
      st.chartKey = key;
      draw();
    }, function (e) { if (gen === generation && !more) K.fail(e); });
  }
  // the chart's last candles every minute (the volume, a missed second), the rest every 5 minutes (the day's turn, the dividends)
  function sync() {
    var now = Date.now();
    st.lastSync = now;
    loadChart(true);
    if (now - st.lastFull > 5 * SYNC_MS) { st.lastFull = now; refreshSoon(); }
  }
  // an order of mine traded or ended (on this device or another): look again, once (`key`: an order's id and
  // state, skipped when this screen's own answer said it — that answer may come just after the event)
  function refreshSoon(key) {
    clearTimeout(refreshTimer);
    if (key) (st.waiting = st.waiting || []).push(key);
    else st.must = true;
    refreshTimer = setTimeout(function () {
      var keys = st.waiting || [], must = st.must;
      st.waiting = null;
      st.must = false;
      if (!shown() || (!must && keys.length && keys.every(function (k) { return st.seen[k]; }))) return;
      var gen = generation;
      api.stocks().then(function (r) { if (gen === generation) apply(r); }, function () {});
      loadChart(true);
      if (st.list === 'history') loadHistory(false);
    }, 400);
  }

  // a second's tick: { t, q: [[price, minute high, minute low], …] } in the order of S.companies
  function onFrame(f) {
    if (f.t <= st.t) return;
    st.t = f.t;
    st.lastFrame = Date.now();
    S.companies.forEach(function (c, i) {
      var x = f.q[i], m = st.market[c.id];
      if (!x || !m) return;
      m.price = x[0];
      m.high = Math.max(m.high, x[1]);
      m.low = Math.min(m.low, x[2]);
    });
    var last = st.candles[st.candles.length - 1], i = S.companies.indexOf(company()), x = f.q[i];
    if (last && x) {
      var per = S.period(st.period), at = S.bucket(f.t - 1, per.span), shown0 = shownClose();
      if (at > last.at) {
        last = { at: at, o: last.c, h: Math.max(last.c, x[0]), l: Math.min(last.c, x[0]), c: x[0], v: 0 };
        st.candles.push(last);
        if (st.candles.length > per.count + 1) st.candles.shift();
      } else if (at === last.at) {
        last.c = x[0];
        last.h = Math.max(last.h, x[0], x[1]);
        last.l = Math.min(last.l, x[0], x[2]);
      }
      st.anim = { from: shown0, to: last.c, start: performance.now() };
    }
    renderLive();
    schedule();
  }
  function onStock(e) {
    if (!shown() || !e) return;
    if (e.q) onFrame(e);
    // (a company's day closed: its figures and news)
    else if (e.corp) { st.corp = e.corp; if (st.list === 'corp') renderList(); }
    // (an order this screen just sent comes back too: its answer already said it)
    else if (e.order) refreshSoon(e.order.id + ':' + e.order.status);
  }
  function saw(o) { if (o) st.seen[o.id + ':' + o.status] = 1; }

  /* ---------------------------------------------------------- watching --- */

  function say(on) {
    st.lastRenew = Date.now();
    if (BR.live.send({ op: 'stocks', on: on ? 1 : 0 })) return;
    if (api.hasToken()) api.stocksWatch(on).catch(function () {});
  }
  function watch(on) {
    clearInterval(renewTimer);
    renewTimer = 0;
    say(on);
    if (on) renewTimer = setInterval(function () { if (shown() && !document.hidden) say(true); }, RENEW_MS);
  }
  // each second while open: the ticks stopped (a connection that came back, a server that slept) → ask again
  function check() {
    if (!shown() || document.hidden) return;
    var now = Date.now();
    if (now - st.lastFrame > GAP_MS && now - st.lastRenew > 5000) { say(true); sync(); }
    else if (now - st.lastSync > SYNC_MS) sync();
  }

  /* ----------------------------------------------------------- the chart --- */

  function fit() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    st.scale = canvas.clientWidth ? w / canvas.clientWidth : dpr;
    draw();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(); }); }
  function shownClose() {
    var last = st.candles[st.candles.length - 1];
    if (!last) return 0;
    var a = st.anim;
    if (!a) return last.c;
    var t = Math.min(1, (performance.now() - a.start) / EASE_MS);
    return a.from + (a.to - a.from) * (1 - Math.pow(1 - t, 3));
  }
  function nice(x) {
    var p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9)))), f = x / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function sma(data, n, i) {
    if (i < n - 1) return null;
    var s = 0;
    for (var j = i - n + 1; j <= i; j++) s += data[j].c;
    return s / n;
  }
  function stamp(at) {
    var d = new Date(at * 1000), p = st.period, two = function (n) { return n < 10 ? '0' + n : String(n); };
    if (p === '1h' || p === '1d') return d.getHours() + ':' + two(d.getMinutes());
    if (p === '1w' || p === '1m') return (d.getMonth() + 1) + '/' + d.getDate();
    return d.getFullYear() + '/' + (d.getMonth() + 1);
  }
  // a candle's start, in full (the finger's candle)
  function when(at) {
    var d = new Date(at * 1000), md = (d.getMonth() + 1) + '/' + d.getDate(), m2 = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
    if (st.period === 'all' || st.period === '1y') return d.getFullYear() + '/' + md + (st.period === 'all' ? '〜' : '');
    return md + ' ' + d.getHours() + ':' + m2;
  }
  function geometry() {
    var W = canvas.width, H = canvas.height, s = st.scale || 1, data = st.candles, n = data.length;
    var count = S.period(st.period).count, first = Math.max(0, n - count), slots = Math.max(2, n - first);
    var axis = 150 * s, top = 18 * s, bottom = 40 * s, plotW = W - axis, plotH = H - top - bottom;
    var volH = plotH * 0.17, gap = 10 * s, priceH = plotH - volH - gap;
    return { W: W, H: H, s: s, n: n, first: first, slot: plotW / slots, plotW: plotW, top: top, priceH: priceH, volTop: top + priceH + gap, volH: volH, axis: axis };
  }
  function draw() {
    if (!canvas || !shown() || !canvas.width) return;
    var c = canvas.getContext('2d'), g = geometry(), data = st.candles, s = g.s, again = false;
    c.clearRect(0, 0, g.W, g.H);
    if (!g.n) return;
    var close = shownClose(), lastI = g.n - 1, m = quote(), i, k;
    if (st.anim && performance.now() - st.anim.start < EASE_MS) again = true;
    else st.anim = null;
    // the range, eased towards the candles' (the line's) highs and lows
    var lo = Infinity, hi = -Infinity, vmax = 0;
    for (i = g.first; i < g.n; i++) {
      k = data[i];
      lo = Math.min(lo, st.mode === 'line' ? Math.min(k.o, k.c) : k.l);
      hi = Math.max(hi, st.mode === 'line' ? Math.max(k.o, k.c) : k.h);
      vmax = Math.max(vmax, k.v);
    }
    lo = Math.min(lo, close);
    hi = Math.max(hi, close);
    var pad = Math.max((hi - lo) * 0.1, hi * 0.0015);
    lo -= pad;
    hi += pad;
    var v = st.view;
    if (!v || v.key !== st.chartKey) v = st.view = { key: st.chartKey, lo: lo, hi: hi };
    else {
      v.lo += (lo - v.lo) * 0.25;
      v.hi += (hi - v.hi) * 0.25;
      if (Math.abs(v.lo - lo) > (hi - lo) * 0.002 || Math.abs(v.hi - hi) > (hi - lo) * 0.002) again = true;
    }
    var y = function (p) { return g.top + (v.hi - p) / (v.hi - v.lo) * g.priceH; };
    var x = function (j) { return (j - g.first) * g.slot + g.slot / 2; };
    var font = function (px, w) { c.font = (w || 600) + ' ' + Math.round(px * s) + 'px system-ui, sans-serif'; };
    // the grid and the prices on it
    var step = nice((v.hi - v.lo) / 5);
    c.lineWidth = Math.max(1, s);
    font(19);
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    for (var p = Math.ceil(v.lo / step) * step; p <= v.hi; p += step) {
      c.strokeStyle = GRID;
      c.beginPath(); c.moveTo(0, y(p)); c.lineTo(g.plotW, y(p)); c.stroke();
      c.fillStyle = TEXT;
      c.fillText(fmt(p), g.plotW + 12 * s, y(p));
    }
    // the times underneath
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    var shownN = g.n - g.first, every = Math.max(1, Math.round(shownN / 5));
    for (i = g.n - 1; i >= g.first; i -= every) {
      c.fillStyle = TEXT;
      c.fillText(stamp(data[i].at), Math.min(Math.max(x(i), 40 * s), g.plotW - 40 * s), g.H - 10 * s);
    }
    // the day before's close (1H, 1D)
    if (m && (st.period === '1h' || st.period === '1d') && m.prev >= v.lo && m.prev <= v.hi) {
      c.setLineDash([3 * s, 6 * s]);
      c.strokeStyle = 'rgba(190,200,220,.45)';
      c.beginPath(); c.moveTo(0, y(m.prev)); c.lineTo(g.plotW, y(m.prev)); c.stroke();
      c.setLineDash([]);
    }
    // volume
    for (i = g.first; i < g.n; i++) {
      k = data[i];
      if (!k.v || !vmax) continue;
      var vh = Math.max(1, k.v / vmax * g.volH);
      c.fillStyle = (k.c >= k.o ? UP : DOWN) + '66';
      c.fillRect(x(i) - Math.max(1, g.slot * 0.32), g.volTop + g.volH - vh, Math.max(1, g.slot * 0.64), vh);
    }
    var first = data[g.first], color = close >= first.o ? UP : DOWN;
    if (st.mode === 'line') {
      c.beginPath();
      for (i = g.first; i < g.n; i++) { var cy = y(i === lastI ? close : data[i].c); if (i === g.first) c.moveTo(x(i), cy); else c.lineTo(x(i), cy); }
      c.strokeStyle = color;
      c.lineWidth = 3 * s;
      c.lineJoin = 'round';
      c.stroke();
      c.lineTo(x(lastI), g.top + g.priceH);
      c.lineTo(x(g.first), g.top + g.priceH);
      c.closePath();
      var grad = c.createLinearGradient(0, g.top, 0, g.top + g.priceH);
      grad.addColorStop(0, color + '40');
      grad.addColorStop(1, color + '00');
      c.fillStyle = grad;
      c.fill();
    } else {
      var bw = Math.max(1, g.slot * 0.64);
      for (i = g.first; i < g.n; i++) {
        k = data[i];
        var cc = i === lastI ? close : k.c, up = cc >= k.o;
        c.strokeStyle = c.fillStyle = up ? UP : DOWN;
        c.lineWidth = Math.max(1, s * 1.5);
        c.beginPath(); c.moveTo(x(i), y(Math.max(k.h, cc))); c.lineTo(x(i), y(Math.min(k.l, cc))); c.stroke();
        var top = y(Math.max(k.o, cc));
        c.fillRect(x(i) - bw / 2, top, bw, Math.max(Math.max(1, s), y(Math.min(k.o, cc)) - top));
      }
    }
    if (st.ma) {
      [5, 25].forEach(function (w, n0) {
        c.beginPath();
        var on = false;
        for (var j = g.first; j < g.n; j++) {
          var a = sma(data, w, j);
          if (a === null) continue;
          if (!on) { c.moveTo(x(j), y(a)); on = true; } else c.lineTo(x(j), y(a));
        }
        c.strokeStyle = MA[n0];
        c.lineWidth = 2 * s;
        c.stroke();
      });
    }
    // the price now, on the axis
    var py = y(close), up0 = !m || close >= m.prev;
    c.setLineDash([6 * s, 6 * s]);
    c.strokeStyle = (up0 ? UP : DOWN) + 'aa';
    c.lineWidth = Math.max(1, s);
    c.beginPath(); c.moveTo(0, py); c.lineTo(g.plotW, py); c.stroke();
    c.setLineDash([]);
    tag(c, g, py, fmt(Math.round(close)), up0 ? UP : DOWN, '#fff');
    if (st.mode === 'line') { c.fillStyle = color; c.beginPath(); c.arc(x(lastI), py, 6 * s, 0, Math.PI * 2); c.fill(); }
    // the finger's candle
    if (st.hover >= g.first && st.hover < g.n) {
      var hk = data[st.hover], hx = x(st.hover), hy = y(st.hover === lastI ? close : hk.c);
      c.strokeStyle = 'rgba(230,236,248,.55)';
      c.lineWidth = Math.max(1, s);
      c.beginPath(); c.moveTo(hx, g.top); c.lineTo(hx, g.top + g.priceH + g.volH); c.moveTo(0, hy); c.lineTo(g.plotW, hy); c.stroke();
      tag(c, g, hy, fmt(hk.c), '#dfe7f5', '#14202f');
    }
    if (again) schedule();
  }
  function tag(c, g, yy, text, bg, fg) {
    var s = g.s, h = 34 * s, w = g.axis - 8 * s;
    c.fillStyle = bg;
    c.beginPath();
    if (c.roundRect) c.roundRect(g.plotW + 4 * s, yy - h / 2, w, h, 8 * s); else c.rect(g.plotW + 4 * s, yy - h / 2, w, h);
    c.fill();
    c.fillStyle = fg;
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.font = '800 ' + Math.round(19 * s) + 'px system-ui, sans-serif';
    c.fillText(text, g.plotW + 12 * s, yy + s);
  }
  function hoverAt(e) {
    var r = canvas.getBoundingClientRect(), g = geometry();
    if (!r.width || !g.n) return;
    var px = (e.clientX - r.left) / r.width * canvas.width;
    var j = g.first + Math.floor(px / g.slot);
    st.hover = px > g.plotW ? -1 : Math.max(g.first, Math.min(g.n - 1, j));
    renderHead();
    schedule();
  }
  function unhover() { if (st.hover < 0) return; st.hover = -1; renderHead(); schedule(); }

  /* ------------------------------------------------------------- the rest --- */

  function renderTabs() {
    Array.prototype.forEach.call(ui.tabs.children, function (b) {
      var m = quote(b.dataset.v), d = m ? pct(m.price, m.prev) : 0;
      b.setAttribute('aria-selected', b.dataset.v === st.company ? 'true' : 'false');
      b.querySelector('.sk-tab-price').textContent = m ? money(m.price) : '';
      var ch = b.querySelector('.sk-tab-change');
      ch.textContent = m ? pctText(d) : '';
      ch.className = 'sk-tab-change ' + tone(d);
    });
  }
  function renderHead() {
    var m = quote(), box = ui.head;
    box.replaceChildren();
    if (!m) return;
    var k = st.hover >= 0 ? st.candles[st.hover] : null;
    if (k) {
      box.appendChild(el('b', 'sk-when', when(k.at)));
      [['始', k.o], ['高', k.h], ['安', k.l], ['終', k.c]].forEach(function (p) { var s0 = el('span', 'sk-ohlc'); s0.appendChild(el('small', '', p[0])); s0.appendChild(el('b', '', fmt(p[1]))); box.appendChild(s0); });
      var vv = el('span', 'sk-ohlc'); vv.appendChild(el('small', '', '出来高')); vv.appendChild(el('b', '', fmt(k.v))); box.appendChild(vv);
      return;
    }
    var d = m.price - m.prev;
    box.appendChild(el('b', 'sk-price ' + tone(d), money(m.price)));
    box.appendChild(el('span', 'sk-change ' + tone(d), (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + signed(d).replace('$', '') + ' (' + pctText(pct(m.price, m.prev)) + ')'));
    [['高', m.high], ['安', m.low], ['前日', m.prev]].forEach(function (p) { var s0 = el('span', 'sk-ohlc'); s0.appendChild(el('small', '', p[0])); s0.appendChild(el('b', '', fmt(p[1]))); box.appendChild(s0); });
  }
  function renderCash() { ui.cash.textContent = money(dollars()); }

  function row(label, value, cls) { var r = el('div', 'sk-row'); r.appendChild(el('small', '', label)); r.appendChild(el('b', cls || '', value)); return r; }
  // (made once, its numbers changed every second: a tap on 受取 is never lost to a new button)
  function buildHold() {
    var box = ui.hold;
    box.replaceChildren();
    ui.holdRows = {};
    [['shares', '保有'], ['avg', '平均'], ['value', '評価'], ['profit', '損益'], ['realized', '実現'], ['dividend', '配当']].forEach(function (r) {
      var line = row(r[1], '');
      ui.holdRows[r[0]] = line.lastChild;
      box.appendChild(line);
    });
    var claim = el('div', 'sk-claim');
    ui.pending = el('b', '');
    ui.claim = button('sk-btn sk-gold', '受取', function () { claimDividends(); });
    claim.appendChild(el('small', '', '配当金'));
    claim.appendChild(ui.pending);
    claim.appendChild(ui.claim);
    box.appendChild(claim);
  }
  function renderHold() {
    var h = holding(), m = quote(), c = company(), R = ui.holdRows, value = h.shares * (m ? m.price : 0), profit = value - h.cost;
    R.shares.textContent = fmt(h.shares) + '株' + (h.free !== h.shares ? '（売却可 ' + fmt(h.free) + '）' : '');
    R.avg.textContent = h.shares ? money(Math.round(h.cost / h.shares)) : '—';
    R.value.textContent = money(value);
    R.profit.textContent = h.shares ? signed(profit) + ' (' + pctText(pct(value, h.cost)) + ')' : '—';
    R.profit.className = h.shares ? tone(profit) : '';
    R.realized.textContent = signed(h.realized);
    R.realized.className = tone(h.realized);
    // (業績連動: the company's dividend a share for the year, paid out day by day; before the companies, the old daily rate)
    var cc = st.corp && st.corp[st.company];
    R.dividend.textContent = (cc ? '年' + money(cc.dps) : (c.dividend * 100).toFixed(1) + '%/日') + ' · ' + money(h.dividends) + (h.today ? ' · 本日 +' + money(h.today) : '');
    var pend = st.mine ? st.mine.dividend.pending : 0;
    ui.pending.textContent = money(pend);
    ui.claim.disabled = !pend || st.busy;
  }

  /* ------------------------------------------------------- the order panel --- */

  function unitPrice() {
    var m = quote();
    if (!m) return 0;
    if (st.type === 'market') return m.price;
    return st.type === 'limit' ? st.price : Math.ceil(st.price * (1 + S.stopMargin));
  }
  // a limit / stop price to start from: a little past the price now, on the side the order waits for
  function defaultPrice() {
    var m = quote();
    if (!m) return;
    var down = (st.side === 'buy') === (st.type === 'limit');
    st.price = down ? Math.floor(m.price * 0.99) : Math.ceil(m.price * 1.01);
    st.priceFor = st.company + st.side + st.type;
  }
  function priceOk() {
    if (st.type === 'market') return true;
    var m = quote();
    if (!m || !st.price) return false;
    var down = (st.side === 'buy') === (st.type === 'limit');
    return Math.abs(st.price - m.price) <= m.price * S.priceRange && (down ? st.price < m.price : st.price > m.price);
  }
  // bought today (from 9:00 Japan time): the filled buys with their fee and the money buy orders hold (the server's)
  function boughtToday() { return st.mine ? st.mine.bought || 0 : 0; }
  // sold today: the filled sales at their price and the sell orders waiting at theirs; traded today: every filled
  // order, buys and sales (from $400,000,000 of it the fee is 10%: js/game/stocks.js activeAt)
  function soldToday() { return st.mine ? st.mine.sold || 0 : 0; }
  function tradedToday() { return st.mine ? st.mine.traded || 0 : 0; }
  function sellRoom() { return Math.max(0, ((st.mine && st.mine.sellCap) || S.sellCap) - soldToday()); }
  // MAX: a sale, every share free to sell; a buy, as many as the money in hand and the day's room both allow — at the
  // price the order will really pay (a big market order slips: js/game/stocks.js), the fee included
  function depth() { var c = BR.CORP && BR.CORP.company(st.company); return c && c.depth || 1e8; }
  function maxShares() {
    var m = st.mine, q = quote();
    if (!m || !q || !unitPrice()) return 0;
    if (st.side === 'sell') return S.maxSell(depth(), st.type, st.price, q.price, sellRoom(), holding().free);
    var room = Math.max(0, (m.dayCap || S.dayCap) - boughtToday());
    return S.maxBuy(depth(), st.type, st.price, q.price, Math.min(dollars(), room), S.maxShares, tradedToday());
  }
  function digits(input) { var n = Number(String(input.value).replace(/[^\d]/g, '')); return Number.isSafeInteger(n) ? n : 0; }
  function buildOrder() {
    var box = ui.order;
    box.replaceChildren();
    ui.side = el('div', 'sk-seg sk-sides');
    seg(ui.side, [{ id: 'buy', label: '買い' }, { id: 'sell', label: '売り' }], function (v) { st.side = v; renderOrder(); });
    ui.type = el('div', 'sk-seg sk-types');
    seg(ui.type, [{ id: 'market', label: TYPE.market }, { id: 'limit', label: TYPE.limit }, { id: 'stop', label: TYPE.stop }], function (v) { st.type = v; renderOrder(); });
    var top = el('div', 'sk-order-top');
    top.appendChild(ui.side);
    top.appendChild(ui.type);
    box.appendChild(top);
    function stepper(label, get, set, steps) {
      var r = el('div', 'sk-field'), input = el('input', 'sk-input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.setAttribute('aria-label', label);
      input.addEventListener('input', function () { set(digits(input)); st.fit = false; renderOrder(true); });
      r.appendChild(el('small', '', label));
      var minus = button('sk-btn sk-step', '−', function () { set(Math.max(1, get() - steps())); st.fit = false; renderOrder(); });
      var plus = button('sk-btn sk-step', '+', function () { set(get() + steps()); st.fit = false; renderOrder(); });
      r.appendChild(minus);
      r.appendChild(input);
      r.appendChild(plus);
      return { row: r, input: input };
    }
    ui.priceRow = stepper('値段', function () { return st.price; }, function (n) { st.price = n; }, function () { var m = quote(); return Math.max(1, Math.round((m ? m.price : 0) * 0.002)); });
    ui.sharesRow = stepper('株数', function () { return st.shares; }, function (n) { st.shares = Math.min(S.maxShares, n); }, function () { return 1; });
    box.appendChild(ui.priceRow.row);
    ui.sharesRow.row.classList.add('sk-shares');
    [10, 100].forEach(function (n) { ui.sharesRow.row.appendChild(button('sk-btn', '+' + n, function () { st.shares = Math.min(S.maxShares, st.shares + n); st.fit = false; renderOrder(); })); });
    // (MAX: the order goes as one that fits — the server takes it down to what fits at its price then, never refused for
    // the day's room or the money)
    ui.sharesRow.row.appendChild(button('sk-btn', 'MAX', function () { st.shares = Math.max(1, maxShares()); st.fit = st.side === 'buy'; renderOrder(); }));
    box.appendChild(ui.sharesRow.row);
    ui.total = el('div', 'sk-total');
    box.appendChild(ui.total);
    ui.go = el('button', 'sk-go');
    ui.go.type = 'button';
    ui.goText = el('span', 'sk-go-text');
    ui.go.appendChild(ui.goText);
    hold(ui.go, submit);
    box.appendChild(ui.go);
  }
  // `typing`: from the field being typed in (its text stays as it is)
  function renderOrder(typing) {
    if (!ui.go || !st) return;
    if (st.type !== 'market' && st.priceFor !== st.company + st.side + st.type) defaultPrice();
    mark(ui.side, st.side);
    mark(ui.type, st.type);
    ui.priceRow.row.hidden = st.type === 'market';
    var active = document.activeElement;
    // (MAX stays MAX: as the price moves, the most that can be bought now)
    var max = maxShares();
    if (st.fit && st.side === 'buy' && !st.busy && max > 0) st.shares = max;
    if (!typing || active !== ui.priceRow.input) ui.priceRow.input.value = st.price ? fmt(st.price) : '';
    if (!typing || active !== ui.sharesRow.input) ui.sharesRow.input.value = String(st.shares || '');
    var unit = unitPrice(), shares = st.shares, q = quote();
    // (a market buy at the price it will slip to; a stop buy at its stop)
    if (st.side === 'buy' && st.type === 'market' && q) unit = S.slipped(depth(), { side: 'buy', type: 'market', shares: shares }, q.price);
    var value = st.type === 'stop' && st.side === 'buy' ? st.price * shares : unit * shares;
    var ok = shares > 0 && (shares <= max || (st.fit && max > 0)) && priceOk() && !st.busy && !!st.mine;
    ui.priceRow.input.classList.toggle('sk-bad', st.type !== 'market' && !priceOk());
    ui.sharesRow.input.classList.toggle('sk-bad', shares > max);
    ui.total.replaceChildren();
    var fee = S.fee(value, tradedToday()), total = st.side === 'buy' ? value + fee : value - fee;
    ui.total.appendChild(row('合計', money(total)));
    ui.total.appendChild(row('手数料', money(fee) + (S.feeBpOf(value, tradedToday()) === S.activeFeeBp ? '（10%・アクティブ）' : '')));
    var left = st.side === 'buy' ? Math.max(0, (st.mine && st.mine.dayCap || S.dayCap) - boughtToday()) : sellRoom();
    ui.total.appendChild(row('最大', fmt(max) + '株' + (st.mine ? '（本日あと' + money(left) + '）' : '')));
    ui.go.classList.toggle('sk-buy', st.side === 'buy');
    ui.go.classList.toggle('sk-sell', st.side === 'sell');
    ui.goText.textContent = (st.side === 'buy' ? '買う' : '売る') + (st.type === 'market' ? '' : '（' + TYPE[st.type] + '）');
    ui.go.disabled = !ok;
  }
  // press and hold: no dialog to read, and no order from a slip of the finger
  function hold(b, run) {
    var timer = 0;
    function start(e) {
      if (b.disabled || timer) return;
      if (e && e.preventDefault) e.preventDefault();
      b.classList.add('sk-holding');
      timer = setTimeout(function () { timer = 0; b.classList.remove('sk-holding'); run(); }, HOLD_MS);
    }
    function stop() { if (!timer) return; clearTimeout(timer); timer = 0; b.classList.remove('sk-holding'); }
    b.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { b.addEventListener(ev, stop); });
    b.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); });
    b.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ') stop(); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }
  function submit() {
    if (st.busy || ui.go.disabled) return;
    var o = { company: st.company, side: st.side, type: st.type, shares: st.shares };
    if (st.type !== 'market') o.price = st.price;
    if (st.fit && st.side === 'buy') o.fit = true;
    // (an answer lost on the way: the same order again goes with the same key, and is not made twice)
    var p = st.pending, same = p && p.company === o.company && p.side === o.side && p.type === o.type && p.shares === o.shares && p.price === o.price;
    o.key = same ? p.key : api.orderKey();
    st.pending = o;
    st.busy = true;
    renderOrder();
    var gen = generation;
    api.stocksOrder(o).then(function (r) {
      if (gen !== generation) return;
      st.pending = null;
      st.busy = false;
      st.fit = false;
      // (a MAX order the server took down to what fit: the shares it was for)
      if (r.order && r.order.shares) st.shares = r.order.shares;
      K.sfx(o.side === 'buy' ? 'betUp' : 'betDown');
      saw(r.order);
      apply(r);
      flash(r.order);
      loadChart(true);
    }, function (e) {
      if (gen !== generation) return;
      st.busy = false;
      if (e.code !== 'network') st.pending = null;
      K.fail(e);
      renderOrder();
      refreshSoon();
    });
  }
  function flash(o) {
    if (!o || !ui.order) return;
    ui.order.classList.remove('sk-done');
    void ui.order.offsetWidth;
    ui.order.classList.add('sk-done');
  }
  function claimDividends() {
    if (st.busy) return;
    st.busy = true;
    ui.claim.disabled = true;
    var gen = generation;
    api.stocksClaim().then(function (r) {
      if (gen !== generation) return;
      st.busy = false;
      if (r.paid) K.sfx('win');
      apply(r);
    }, function (e) { if (gen !== generation) return; st.busy = false; K.fail(e); renderAll(); });
  }

  /* -------------------------------------------------- orders and history --- */

  function short(id) { var c = S.company(id); return c ? c.ticker : id; }
  function renderList() {
    var box = ui.list, m = st.mine;
    mark(ui.listTabs, st.list);
    ui.listTabs.firstChild.textContent = '注文' + (m && m.orders.length ? ' ' + m.orders.length : '');
    box.replaceChildren();
    if (st.list === 'corp') { renderCorp(box); return; }
    if (st.list === 'orders') {
      (m ? m.orders : []).forEach(function (o) {
        var r = el('div', 'sk-line sk-open');
        r.appendChild(el('b', '', short(o.company)));
        r.appendChild(el('span', o.side === 'buy' ? 'sk-up' : 'sk-down', o.side === 'buy' ? '買' : '売'));
        r.appendChild(el('span', '', TYPE[o.type]));
        r.appendChild(el('span', 'sk-num', money(o.price)));
        r.appendChild(el('span', 'sk-num', fmt(o.shares) + '株'));
        r.appendChild(el('small', '', K.fmtTime(o.expires)));
        var x = button('sk-btn sk-x', '取消', function () { cancel(o.id, x); });
        x.setAttribute('aria-label', '取消');
        r.appendChild(x);
        box.appendChild(r);
      });
      return;
    }
    st.history.forEach(function (o) {
      var r = el('div', 'sk-line' + (o.status === 'filled' ? '' : ' sk-muted'));
      r.appendChild(el('small', '', K.fmtTime(o.done || o.at)));
      r.appendChild(el('b', '', short(o.company)));
      r.appendChild(el('span', o.side === 'buy' ? 'sk-up' : 'sk-down', o.side === 'buy' ? '買' : '売'));
      r.appendChild(el('span', '', TYPE[o.type]));
      r.appendChild(el('span', 'sk-num', fmt(o.shares) + '株'));
      r.appendChild(el('span', 'sk-num', o.status === 'filled' ? money(o.fill) : ''));
      r.appendChild(el('span', 'sk-num', o.status === 'filled' ? money(o.amount) : ''));
      r.appendChild(el('span', 'sk-num ' + (o.side === 'sell' && o.status === 'filled' ? tone(o.profit) : ''), o.side === 'sell' && o.status === 'filled' ? signed(o.profit) : ''));
      r.appendChild(el('small', 'sk-status', STATUS[o.status] || o.status));
      box.appendChild(r);
    });
    if (st.more) box.appendChild(button('sk-btn sk-more', '…', function () { loadHistory(true); }));
  }
  // the company behind the share: labels and numbers
  function renderCorp(box) {
    var c = st.corp && st.corp[st.company], C = BR.CORP;
    if (!c || !C) return;
    var cm = C.fmt.money, q0 = quote(), price = q0 ? q0.price : 0;
    var line = function (cells) {
      var r = el('div', 'sk-line sk-corp');
      cells.forEach(function (x) { var cell = el('span', 'sk-cell'); cell.appendChild(el('small', '', x[0])); cell.appendChild(el('b', x[2] || '', x[1])); r.appendChild(cell); });
      box.appendChild(r);
    };
    var yoy = function (a, b) { return b ? C.fmt.pct(a / Math.abs(b) - 1) : '—'; };
    var next = c.next ? new Date(c.next * 1000) : null;
    line([['会社', c.full], ['社員', fmt(c.staff) + '名'], ['ランク', c.rank], ['次の決算発表', next ? (next.getMonth() + 1) + '/' + next.getDate() : '—']]);
    if (c.last) {
      var l = c.last, p = l.prev;
      line([['決算', l.label.replace(/^(\d+)年度 第(\d)四半期$/, '$1 Q$2')], ['売上高', cm(l.sales)], ['前年比', p ? yoy(l.sales, p.sales) : '—', p ? tone(l.sales - p.sales) : ''], ['営業利益', cm(l.op), tone(l.op)], ['純利益', cm(l.net), tone(l.net)]]);
    }
    if (c.guide) {
      var g = c.guide;
      line([['予想', g.fy + '年度'], ['売上高', cm(g.sales)], ['営業利益', cm(g.op), tone(g.op)], ['純利益', cm(g.net), tone(g.net)], ['配当', '年' + money(g.dps)]]);
    }
    line([['EPS', money(c.eps)], ['BPS', money(c.bps)], ['PER', c.eps > 0 && price ? (price / c.eps).toFixed(1) + '倍' : '—'], ['PBR', c.bps > 0 && price ? (price / c.bps).toFixed(2) + '倍' : '—'],
      ['利回り', price ? (c.dps / price * 100).toFixed(2) + '%' : '—']]);
    // (its latest news: the headlines, without the company's name before them)
    (c.news || []).forEach(function (n) {
      var r = el('div', 'sk-line sk-news');
      r.appendChild(el('small', '', K.fmtTime(n.at * 1000)));
      r.appendChild(el('b', '', NEWS[n.kind] || ''));
      r.appendChild(el('span', '', String(n.text).replace(/^[^：]*：/, '')));
      box.appendChild(r);
    });
  }
  function loadHistory(more) {
    var gen = generation, before = more && st.history.length ? st.history[st.history.length - 1].id : 0;
    api.stocksHistory(before).then(function (r) {
      if (gen !== generation) return;
      st.history = more ? st.history.concat(r.orders) : r.orders;
      st.more = r.more;
      if (st.list === 'history') renderList();
    }, function (e) { if (gen === generation) K.fail(e); });
  }
  function cancel(id, b) {
    b.disabled = true;
    var gen = generation;
    api.stocksCancel(id).then(function (r) { if (gen === generation) { saw(r.order); apply(r); } }, function (e) { if (gen !== generation) return; K.fail(e); refreshSoon(); });
  }
  function renderMeter() {
    var m = st.mine, box = ui.meter;
    box.replaceChildren();
    if (!m) return;
    var cap = m.dayCap || S.dayCap, used = boughtToday(), bar = el('div', 'sk-bar'), fill = el('i');
    fill.style.width = Math.min(100, used / cap * 100).toFixed(1) + '%';
    bar.appendChild(fill);
    var a = el('div', 'sk-row');
    a.appendChild(el('small', '', '本日の買い'));
    a.appendChild(bar);
    a.appendChild(el('b', '', money(used) + ' / ' + money(cap)));
    box.appendChild(a);
    // the day's sales against their own cap
    var scap = m.sellCap || S.sellCap, sold = soldToday(), sbar = el('div', 'sk-bar'), sfill = el('i');
    sfill.style.width = Math.min(100, sold / scap * 100).toFixed(1) + '%';
    sbar.appendChild(sfill);
    var b = el('div', 'sk-row');
    b.appendChild(el('small', '', '本日の売り'));
    b.appendChild(sbar);
    b.appendChild(el('b', '', money(sold) + ' / ' + money(scap)));
    box.appendChild(b);
    // the trades left, and an active player's fee (from $400,000,000 traded in the day, 10%)
    var at = m.activeAt || S.activeAt, traded = tradedToday(), c = el('div', 'sk-row');
    c.appendChild(el('small', '', '残り ' + (m.tradesMax - m.trades) + '/' + m.tradesMax));
    c.appendChild(el('b', traded >= at ? 'sk-active' : '', '売買 ' + money(traded) + (traded >= at ? '・手数料10%' : ' / ' + money(at))));
    box.appendChild(c);
  }

  // every second: what moves with the prices
  function renderLive() { renderTabs(); renderHead(); renderHold(); renderOrder(true); renderMeter(); }
  function renderAll() {
    if (!shown()) return;
    mark(ui.periods, st.period);
    mark(ui.modes, st.mode);
    ui.modes.lastChild.setAttribute('aria-pressed', st.ma ? 'true' : 'false');
    renderCash();
    renderTabs();
    renderHead();
    renderHold();
    renderOrder();
    renderList();
    renderMeter();
    schedule();
  }

  function buildStatic() {
    ui.tabs.replaceChildren();
    S.companies.forEach(function (c) {
      var b = button('sk-tab', '', function () { pickCompany(c.id); });
      b.dataset.v = c.id;
      b.setAttribute('role', 'tab');
      b.appendChild(el('b', 'sk-tab-name', c.name));
      b.appendChild(el('span', 'sk-tab-price'));
      b.appendChild(el('span', 'sk-tab-change'));
      ui.tabs.appendChild(b);
    });
    seg(ui.periods, S.periods.map(function (p) { return { id: p.id, label: LABEL[p.id] }; }), function (v) { st.period = v; st.candles = []; st.chartKey = ''; renderAll(); loadChart(false); });
    seg(ui.modes, [{ id: 'line', label: '〜' }, { id: 'candle', label: '▮' }], function (v) { st.mode = v; st.view = null; renderAll(); });
    var ma = button('sk-chip', 'MA', function () { st.ma = !st.ma; renderAll(); });
    ma.dataset.v = 'ma';
    ui.modes.appendChild(ma);
    seg(ui.listTabs, [{ id: 'orders', label: '注文' }, { id: 'history', label: '履歴' }, { id: 'corp', label: '企業' }], function (v) { st.list = v; renderList(); if (v === 'history') loadHistory(false); });
    buildHold();
    buildOrder();
    K.dragScroll(ui.list);
  }
  function pickCompany(id) {
    if (st.company === id) return;
    st.company = id;
    st.fit = false;
    st.candles = [];
    st.chartKey = '';
    st.hover = -1;
    renderAll();
    loadChart(false);
  }

  function open() {
    if (!api.online || !api.hasToken()) { K.fail({ message: 'オンラインでログインしてから利用してください' }); return; }
    generation++;
    reset();
    K.showModal('stocks-modal');
    renderAll();
    requestAnimationFrame(fit);
    watch(true);
    load();
  }
  function close() {
    generation++;
    clearTimeout(refreshTimer);
    watch(false);
    clearInterval(renewTimer);
    renewTimer = 0;
  }

  BR.stocks = {
    open: open,
    init: function () {
      root = byId('stocks-modal');
      canvas = byId('sk-chart');
      ['tabs', 'cash', 'head', 'periods', 'modes', 'hold', 'order', 'list-tabs', 'list', 'meter'].forEach(function (k) { ui[k.replace('-t', 'T')] = byId('sk-' + k); });
      reset();
      K.registerModal('stocks-modal');
      buildStatic();
      root.addEventListener('closed', close);
      BR.live.on('stock', onStock);
      BR.live.on('balance', function () { if (shown()) { renderCash(); renderOrder(true); } });
      BR.live.on('status', function (on) { if (on && shown()) { say(true); load(); } });
      document.addEventListener('visibilitychange', function () {
        if (!shown()) return;
        if (document.hidden) say(false);
        else { say(true); load(); }
      });
      window.addEventListener('resize', function () { if (shown()) requestAnimationFrame(fit); });
      if (window.ResizeObserver) new ResizeObserver(function () { if (shown()) fit(); }).observe(canvas.parentNode);
      canvas.addEventListener('pointermove', hoverAt);
      canvas.addEventListener('pointerdown', hoverAt);
      canvas.addEventListener('pointerleave', unhover);
      canvas.addEventListener('pointerup', function (e) { if (e.pointerType !== 'mouse') setTimeout(unhover, 1200); });
      setInterval(check, 1000);
    }
  };
})(window.BR = window.BR || {});
