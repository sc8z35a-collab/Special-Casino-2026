/* 街ライブ: the country of 50,000 people (js/game/npc.js; server/core/npc.js) as it is now — every person a dot on the
   map of the five districts where they are, coloured by what they do (or their mood, or their money), the numbers of
   the moment, the districts and their mayors, the country's books and knobs, the elections, petitions and the
   council, the unions, the companies' heads and new businesses, the news and the town's talk; a dot touched shows its
   person. Only to look at: nothing here changes the country (the players are visitors to it). While open, the server
   sends each minute what changed (told every 20 seconds that the screen is still open). Drawn on a canvas. */
(function (BR) {
  'use strict';
  var K = BR.kit, api = BR.api, NPC = BR.NPC, el = K.el, fmt = BR.util.fmt;
  var RENEW_MS = 20000, MOVE_MS = 1600;
  // where each district lies on the map (x, y, w, h in 0..1)
  var TILES = [[0.35, 0.03, 0.3, 0.45], [0.68, 0.03, 0.3, 0.45], [0.18, 0.52, 0.3, 0.45], [0.02, 0.03, 0.3, 0.45], [0.51, 0.52, 0.3, 0.45]];
  var TABS = [['now', '今'], ['districts', '区'], ['nation', '国'], ['politics', '政治'], ['labor', '労働'], ['companies', '企業'], ['news', 'ニュース']];
  var MODES = [['act', 'していること'], ['mood', '気分'], ['money', 'お金']];
  var root, canvas, ui = {}, st = null, timer = 0, raf = 0;

  function byId(id) { return document.getElementById(id); }
  function shown() { return !!root && !root.hidden; }
  function money(n) { return NPC.money(n); }
  function button(cls, text, run) { var b = el('button', cls, text); b.type = 'button'; if (run) b.addEventListener('click', function (e) { K.sfx('click'); run(e); }); return b; }
  function decode(b64) { var s = atob(b64), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function hash(n) { var x = (n ^ 0x9e3779b1) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0; x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0; return (x ^ (x >>> 16)) >>> 0; }
  function time(ms) { var d = new Date(ms + 9 * 3600000); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + d.getUTCHours() + ':' + ('0' + d.getUTCMinutes()).slice(-2); }

  function reset() { st = { tab: (st && st.tab) || 'now', mode: (st && st.mode) || 'act', data: null, frame: null, from: null, to: null, moved: 0, n: 0, live: null, pick: -1 }; }

  /* ---------------------------------------------------------------- the map --- */
  // a person's spot on the map: their district's tile, the place they are at (one of its kind, by the person), a
  // little spread about it (their own: the same each time)
  function spot(i, b0, w, h) {
    var d = b0 >> 5, place = NPC.places[b0 & 31] || 'street', D = NPC.districts[d] || NPC.districts[0], t = TILES[d] || TILES[0];
    var list = D.places[place === 'street' ? 'home' : place] || [], hs = hash(i);
    var p = list.length ? list[hs % list.length] : [50, 50, 40];
    var a = (hs % 6283) / 1000, r = (p[2] || 6) * Math.sqrt(((hs >>> 13) % 1000) / 1000);
    var x = (p[0] + Math.cos(a) * r) / 100, y = (p[1] + Math.sin(a) * r) / 100;
    if (place === 'street') { x = ((hs >>> 3) % 1000) / 1000; y = ((hs >>> 17) % 1000) / 1000; }
    return [(t[0] + t[2] * Math.min(0.98, Math.max(0.02, x))) * w, (t[1] + t[3] * Math.min(0.98, Math.max(0.02, y))) * h];
  }
  function colour(f, i) {
    var b = i * 5;
    if (st.mode === 'mood') { var m = f[b + 2] / 255; return 'hsl(' + Math.round(m * 130) + ',70%,' + (40 + m * 15) + '%)'; }
    if (st.mode === 'money') { var k = f[b + 3]; return k & 4 ? '#7a6a5a' : k & 2 ? '#f4c95d' : k & 1 ? '#5c9ded' : '#8a96aa'; }
    var a = NPC.acts[f[b + 1]];
    return a ? a.color : '#888';
  }
  function fit() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    schedule();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(); }); }
  function draw() {
    if (!shown() || !canvas) return;
    var g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    // the districts
    NPC.districts.forEach(function (D, d) {
      var t = TILES[d], x = t[0] * w, y = t[1] * h, tw = t[2] * w, th = t[3] * h;
      g.fillStyle = 'rgba(16,26,42,.92)';
      g.strokeStyle = D.color + '88';
      g.lineWidth = 2;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, tw, th, 18); else g.rect(x, y, tw, th);
      g.fill(); g.stroke();
      Object.keys(D.places).forEach(function (k) {
        if (k === 'home') return;
        (D.places[k] || []).forEach(function (p) {
          g.fillStyle = 'rgba(160,178,205,.10)';
          g.beginPath();
          g.arc(x + tw * p[0] / 100, y + th * p[1] / 100, Math.max(6, tw * p[2] / 100), 0, Math.PI * 2);
          g.fill();
        });
      });
      g.fillStyle = D.color;
      g.font = '700 ' + Math.round(h * 0.034) + 'px sans-serif';
      g.fillText(D.name, x + 14, y + h * 0.045);
    });
    var f = st.frame;
    if (!f) return;
    var n = st.n, ease = Math.min(1, (performance.now() - st.moved) / MOVE_MS), dot = Math.max(3, Math.round(w / 520));
    for (var i = 0; i < n; i++) {
      var p = st.to[i], q = st.from ? st.from[i] : p;
      var x = q[0] + (p[0] - q[0]) * ease, y = q[1] + (p[1] - q[1]) * ease;
      g.fillStyle = colour(f, i);
      g.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    if (st.pick >= 0 && st.to[st.pick]) {
      var s = st.to[st.pick];
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.beginPath(); g.arc(s[0], s[1], dot * 4, 0, Math.PI * 2); g.stroke();
    }
    if (ease < 1) schedule();
  }
  function place(f) {
    var w = canvas.width, h = canvas.height, out = new Array(st.n);
    for (var i = 0; i < st.n; i++) out[i] = spot(i, f[i * 5], w, h);
    return out;
  }
  function setFrame(f) {
    st.frame = f;
    st.n = Math.floor(f.length / 5);
    st.from = st.to;
    st.to = place(f);
    st.moved = performance.now();
    schedule();
  }
  // a minute's change from the server: who changed (3 bytes of their number, then their 5 bytes)
  function onTown(e) {
    if (!shown() || !e) return;
    if (e.day) { load(); return; }
    if (e.f) setFrame(decode(e.f));
    else if (e.d && st.frame) {
      var d = decode(e.d), f = new Uint8Array(st.frame);
      for (var k = 0; k + 8 <= d.length; k += 8) { var i = (d[k] << 16) | (d[k + 1] << 8) | d[k + 2]; if (i < st.n) f.set(d.subarray(k + 3, k + 8), i * 5); }
      setFrame(f);
    }
    if (e.stats) { st.live = e.stats; renderHead(); if (st.tab === 'now') renderSide(); }
  }

  /* ---------------------------------------------------------------- the panels --- */
  function renderHead() {
    var d = st.data;
    ui.status.replaceChildren();
    if (!d || !d.started) { ui.status.appendChild(el('span', 'tw-off', 'まだ始まっていません')); return; }
    var on = st.live ? st.live.active : d.active;
    ui.status.appendChild(el('span', on ? 'tw-on' : 'tw-off', on ? '● 活動中' : '休止中（再開 ' + time(d.next) + '）'));
    ui.status.appendChild(el('span', 'tw-pop', '人口 ' + fmt(d.stats.population)));
  }
  function row(box, label, value, cls) { var r = el('div', 'tw-row' + (cls ? ' ' + cls : '')); r.appendChild(el('span', '', label)); r.appendChild(el('b', '', value)); box.appendChild(r); return r; }
  function section(box, title) { var s = el('section', 'tw-sec'); s.appendChild(el('h3', '', title)); box.appendChild(s); return s; }
  function who(p) { return p ? p.name : '—'; }
  function renderSide() {
    var d = st.data, box = ui.side;
    box.replaceChildren();
    Array.prototype.forEach.call(ui.tabs.children, function (b) { b.setAttribute('aria-selected', b.dataset.v === st.tab ? 'true' : 'false'); });
    if (!d || !d.started) { box.appendChild(el('p', 'tw-empty', 'NPCの国はまだ始まっていません。')); return; }
    var s, l = st.live || {};
    if (st.tab === 'now') {
      s = section(box, d.nation.name + 'のいま');
      var acts = l.acts;
      if (acts) {
        var order = acts.map(function (n, k) { return [k, n]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8);
        order.forEach(function (x) { var a = NPC.acts[x[0]]; var r = row(s, a ? a.name : '', fmt(x[1]) + '人'); r.style.setProperty('--c', a ? a.color : '#888'); r.classList.add('tw-act'); });
      }
      s = section(box, '数字');
      row(s, '平均の気分', Math.round((d.stats.mood || 0) / 2.55) + ' / 100');
      row(s, '失業率', ((d.stats.unemployment || 0) * 100).toFixed(1) + '%');
      row(s, '景気', ((d.stats.economy || 1) * 100).toFixed(1));
      row(s, '物価', ((d.stats.prices || 1) * 100).toFixed(1));
      row(s, '路上で暮らす人', fmt(d.stats.homeless || 0) + '人');
      row(s, '居候', fmt(d.stats.staying || 0) + '人');
      row(s, '格差（ジニ係数）', String(d.stats.gini || 0));
      s = section(box, '街の声');
      (d.talk || []).slice(0, 8).forEach(function (t) { s.appendChild(el('p', 'tw-talk', t.text)); });
    } else if (st.tab === 'districts') {
      d.districts.forEach(function (x) {
        s = section(box, x.name);
        s.appendChild(el('p', 'tw-look', x.look));
        row(s, '区長', who(x.mayor));
        row(s, '支持率', x.approval + '%');
        row(s, '公約', (x.platform || []).map(function (id) { var p = NPC.platforms.filter(function (y) { return y.id === id; })[0]; return p ? p.name : id; }).join('・') || '—');
        row(s, '人口', fmt(x.people) + '人');
        row(s, '景気', (x.economy * 100).toFixed(1));
        if (x.speech) s.appendChild(el('p', 'tw-talk', '「' + x.speech + '」'));
      });
    } else if (st.tab === 'nation') {
      s = section(box, '国の財布');
      row(s, '国の預金', money(d.nation.cash));
      row(s, '国の借金（国債）', money(d.nation.debt));
      row(s, '年金の積立金', money(d.nation.fund));
      s = section(box, '国の決まり（変えられるのは街の議会と市民投票だけ）');
      NPC.knobs.forEach(function (k) { row(s, k.name, fmtKnob(k, d.nation.knobs[k.id])); });
      if (d.nation.pending && d.nation.pending.length) { s = section(box, '来月からの変更'); d.nation.pending.forEach(function (p) { var k = NPC.knob[p.id]; row(s, k ? k.name : p.id, fmtKnob(k, p.to)); }); }
    } else if (st.tab === 'politics') {
      var po = d.politics;
      if (po.campaign) { s = section(box, '区長選挙（選挙運動中）'); po.campaign.cands.forEach(function (c) { row(s, NPC.districts[c.district].name, c.name + (c.incumbent ? '（現職）' : '')); }); }
      s = section(box, '署名');
      if (!po.petitions.length) s.appendChild(el('p', 'tw-empty', '集めている署名はありません'));
      po.petitions.forEach(function (p) { row(s, p.title, fmt(p.count) + '人' + (p.state === 'won' ? '・市民投票へ' : '')); });
      s = section(box, '市民投票');
      po.votes.forEach(function (v) { row(s, v.title, v.result ? (v.result.pass ? '可決' : '否決') + '（投票率' + Math.round(v.result.turnout * 100) + '%）' : '投票日 ' + dateOf(v.day)); });
      s = section(box, '街の議会');
      po.council.forEach(function (c) { (c.minutes || []).forEach(function (m) { row(s, m.name, (m.pass ? '可決 ' : '否決 ') + fmtKnob(NPC.knob[m.id], m.to)); }); });
      s = section(box, '最近の選挙');
      po.elections.slice(0, 5).forEach(function (e) { var w = e.cands.filter(function (c) { return c.i === e.winner; })[0]; row(s, NPC.districts[e.district].name + '（' + dateOf(e.day) + '）', (w ? w.name : '') + ' 当選・投票率' + Math.round(e.turnout * 100) + '%'); });
    } else if (st.tab === 'labor') {
      s = section(box, '労働組合と春闘');
      d.companies.forEach(function (c) {
        var u = d.labor.unions[c.id];
        if (!u) return;
        var state = { idle: '平常', talks: '交渉中', strike: 'ストライキ中（' + u.days + '日目）', settled: '妥結（賃上げ' + (u.raise * 100).toFixed(2) + '%）' }[u.state] || u.state;
        row(s, c.name, '組合員' + fmt(u.members) + '人・' + state);
      });
    } else if (st.tab === 'companies') {
      d.companies.forEach(function (c) {
        s = section(box, c.name);
        row(s, 'CEO', who(c.ceo));
        row(s, '社長', who(c.president));
        row(s, '社員', fmt(c.staff) + '人');
        c.ventures.forEach(function (v) { row(s, '新事業', v.name + '（顧客' + fmt(v.customers) + '人）'); });
      });
    } else {
      s = section(box, 'ニュース');
      (d.news || []).forEach(function (n) { var p = el('p', 'tw-news'); p.appendChild(el('small', '', time(n.at))); p.appendChild(document.createTextNode(' ' + n.text)); s.appendChild(p); });
    }
  }
  function dateOf(day) { var t = new Date(day * 86400000); return (t.getUTCMonth() + 1) + '/' + t.getUTCDate(); }
  function fmtKnob(k, v) { if (!k) return String(v); return k.unit === '$' ? money(v) : v + k.unit; }

  /* ---------------------------------------------------------------- a person --- */
  function pickAt(x, y) {
    if (!st.to) return;
    var best = -1, bd = 1e9;
    for (var i = 0; i < st.n; i++) { var p = st.to[i], dx = p[0] - x, dy = p[1] - y, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } }
    if (best < 0 || bd > 900) return;
    st.pick = best;
    schedule();
    api.townPerson(best).then(function (r) { if (shown()) showCard(r.person); }, K.fail);
  }
  function showCard(p) {
    var box = ui.card;
    box.replaceChildren();
    box.hidden = false;
    var head = el('div', 'tw-card-head');
    head.appendChild(el('b', '', p.name));
    head.appendChild(el('small', '', p.kana + '・' + p.age + '歳'));
    head.appendChild(button('tw-x', '×', function () { box.hidden = true; st.pick = -1; schedule(); }));
    box.appendChild(head);
    row(box, '住まい', p.district + '（' + p.home + '）');
    row(box, '仕事', p.job || '—');
    (p.posts || []).forEach(function (x) { row(box, '役職', x); });
    row(box, 'いま', p.act + '（' + p.at + '・' + p.place + '）');
    row(box, '気分', Math.round(p.mood / 2.55) + ' / 100');
    box.appendChild(el('p', 'tw-voice', '心の声：「' + p.voice + '」'));
    if (p.life && p.life.length) {
      var s = el('div', 'tw-life');
      s.appendChild(el('small', '', '人生の本より'));
      p.life.forEach(function (m) { s.appendChild(el('p', '', m.what + '（' + (m.ago ? m.ago + '日前' : '今日') + '）')); });
      box.appendChild(s);
    }
  }

  /* ---------------------------------------------------------------- open, close --- */
  function load() {
    return api.town().then(function (r) {
      if (!shown()) return;
      st.data = r;
      if (r.live) st.live = r.live;
      if (r.started && r.frame) { fit(); setFrame(decode(r.frame)); }
      renderHead();
      renderSide();
    }, K.fail);
  }
  function say(on) {
    if (BR.live.send({ op: 'town', on: on ? 1 : 0 })) return;
    if (api.hasToken()) api.townWatch(on).catch(function () {});
  }
  function open() {
    if (!api.online || !api.hasToken()) { K.fail({ message: 'オンラインでログインしてから利用してください' }); return; }
    reset();
    K.showModal('town-modal');
    ui.card.hidden = true;
    renderHead();
    renderSide();
    requestAnimationFrame(fit);
    say(true);
    clearInterval(timer);
    timer = setInterval(function () { if (shown() && !document.hidden) say(true); }, RENEW_MS);
    load();
  }
  function close() { clearInterval(timer); timer = 0; say(false); }

  BR.town = {
    open: open,
    init: function () {
      root = byId('town-modal');
      canvas = byId('tw-map');
      ['status', 'tabs', 'side', 'modes', 'card'].forEach(function (k) { ui[k] = byId('tw-' + k); });
      reset();
      K.registerModal('town-modal');
      TABS.forEach(function (t) { var b = button('tw-tab', t[1], function () { st.tab = t[0]; renderSide(); }); b.dataset.v = t[0]; ui.tabs.appendChild(b); });
      MODES.forEach(function (m) { var b = button('tw-chip', m[1], function () { st.mode = m[0]; Array.prototype.forEach.call(ui.modes.children, function (x) { x.setAttribute('aria-pressed', x.dataset.v === st.mode ? 'true' : 'false'); }); schedule(); }); b.dataset.v = m[0]; b.setAttribute('aria-pressed', m[0] === 'act' ? 'true' : 'false'); ui.modes.appendChild(b); });
      root.addEventListener('closed', close);
      canvas.addEventListener('click', function (e) {
        var r = canvas.getBoundingClientRect();
        pickAt((e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height);
      });
      BR.live.on('town', onTown);
      BR.live.on('status', function (on) { if (on && shown()) { say(true); load(); } });
      document.addEventListener('visibilitychange', function () { if (shown()) say(!document.hidden); });
      window.addEventListener('resize', function () { if (shown() && st.frame) { fit(); st.from = null; st.to = place(st.frame); schedule(); } });
    }
  };
})(window.BR = window.BR || {});
