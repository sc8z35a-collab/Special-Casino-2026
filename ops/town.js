/* 街: the country of people behind the companies (server/core/npc.js), all of it — the country now (its numbers, its
   books, its districts and mayors, what the council and the people decide and what the companies decide, the
   elections, petitions, votes and the council's minutes, the unions), its 50,000 people (found by name, district or
   employer, each one whole: character, needs, money, work, pension, home, relations, memories, the reasons of their
   decisions), each company's people (its executives, departments and named posts, the meetings in its 会議室 with
   who said what and the stopper's word, its reports, its new businesses, MAGITA's research departments, Tenesice's
   lending), and its news. The developer may pause the country or fix how deep its people think (its knobs and the
   companies' prices are the country's and the companies' own to decide). Asked for when opened and when the server says a day closed ('npc'); asking
   again with the last answer's rev is answered { same: true }. Labels from js/game/npc.js (BR.NPC). Text only by textContent. */
var OpsTown = (function () {
  'use strict';
  var N = function () { return window.BR && window.BR.NPC; };
  var TABS = [['nation', '国'], ['people', '住民'], ['orgs', '会社の人と会議'], ['locals', '地元の企業'], ['asuka', 'アスカ国'], ['news', 'ニュース']];
  var STANCE = { for: '賛成', against: '反対', neutral: '保留', stop: '差し止め', overrule: '決裁' };
  var st = { view: null, request: null, toast: null, tab: 'nation', all: null, people: null, person: null, company: 'tenesice', orgs: {}, q: '', d: '', j: '', page: 0, gen: 0 };

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function money(n) { return N().money(Math.round(n || 0)); }
  function pct(x) { return ((x || 0) * 100).toFixed(1) + '%'; }
  function day(d) { var t = new Date(d * 86400000); return t.getUTCFullYear() + '/' + (t.getUTCMonth() + 1) + '/' + t.getUTCDate(); }
  function at(ms) { var t = new Date(ms); return (t.getMonth() + 1) + '/' + t.getDate() + ' ' + t.getHours() + ':' + ('0' + t.getMinutes()).slice(-2); }
  function panel(title, note) { var p = el('section', 'town-panel'); var h = el('div', 'town-head'); h.appendChild(el('h3', '', title)); if (note) h.appendChild(el('span', 'muted', note)); p.appendChild(h); return p; }
  function kv(box, label, value) { var r = el('div', 'town-kv'); r.appendChild(el('span', '', label)); r.appendChild(el('b', '', value)); box.appendChild(r); return r; }
  function table(head, rows) {
    var wrap = el('div', 'town-table-wrap'), t = el('table', 'town-table'), tr = el('tr');
    head.forEach(function (h) { tr.appendChild(el('th', '', h)); });
    var th = el('thead'); th.appendChild(tr); t.appendChild(th);
    var tb = el('tbody');
    rows.forEach(function (r) {
      var row = el('tr', r.onclick ? 'town-link' : '');
      if (r.onclick) row.addEventListener('click', r.onclick);
      (r.cells || r).forEach(function (c) { var td = el('td'); if (c instanceof Node) td.appendChild(c); else td.textContent = c === undefined || c === null ? '—' : c; row.appendChild(td); });
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t); return wrap;
  }
  function who(p) { return p ? p.name : '—'; }
  function knobText(k, v) { return !k ? String(v) : k.unit === '$' ? money(v) : v + k.unit; }

  /* ---------------------------------------------------------------- GDP --- */
  // a country's GDP (server/core/npc-gdp.js gdpView): the last day closed, the month, the year (暦年) and the last 365
  // days, nominal and real (at the prices of its beginning), what it was spent on, and its last 90 days as bars
  function gdpPanel(box, g, name) {
    var p = panel(name + 'のGDP（国内総生産）', '支出面：消費＋政府＋投資＋輸出−輸入・実質は建国時の物価で・毎日の締めで更新');
    if (!g) { p.appendChild(el('p', 'muted', '最初の締めの翌日から数えます。')); box.appendChild(p); return; }
    var sign = function (x) { return x === null || x === undefined ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%'; };
    var t = el('div', 'town-grid');
    kv(t, '実質GDP（年率・直近30日）', money(g.pace.real) + '（前の30日比 ' + sign(g.pace.growth) + '）');
    kv(t, '名目GDP（年率・直近30日）', money(g.pace.nominal));
    kv(t, '直近365日の実質GDP', money(g.last365.real) + (g.last365.days < 365 ? '（' + g.last365.days + '日分）' : '') + (g.yoy !== null ? '・前年比 ' + sign(g.yoy) : ''));
    kv(t, '1人あたりGDP（年）', money(g.head) + '（人口 ' + (g.people || 0).toLocaleString('ja-JP') + '人）');
    kv(t, 'GDPデフレーター', (g.defl * 100).toFixed(1) + '（建国時＝100）');
    p.appendChild(t);
    var rows = [['日（' + day(g.day.day) + '）', g.day, sign(g.day.growth)], ['月（' + g.month.key + '・' + g.month.days + '日）', g.month, g.prevMonth ? '前月 ' + money(g.prevMonth.real) : '—'],
      ['年（' + g.year.y + '年・' + g.year.days + '日）', g.year, g.lastYear ? '前年 ' + money(g.lastYear.real) : '—']];
    p.appendChild(table(['', '名目GDP', '実質GDP', '消費(C)', '政府(G)', '投資(I)', '輸出(X)', '輸入(M)', '比較'], rows.map(function (x) {
      var o = x[1];
      return [x[0], money(o.nominal), money(o.real), money(o.c), money(o.g), money(o.i), money(o.x), money(o.m), x[2]];
    })));
    // the last 90 days' real GDP (a day each; the months' ends are when the monthly bills and pay fall)
    var bars = el('div', 'town-bars'), max = g.series.reduce(function (m, x) { return Math.max(m, Math.abs(x[2])); }, 1);
    bars.setAttribute('role', 'img');
    bars.setAttribute('aria-label', name + 'の実質GDP（直近' + g.series.length + '日）');
    g.series.forEach(function (x) { var b = el('i', x[2] < 0 ? 'neg' : ''); b.style.height = Math.max(1, Math.round(Math.abs(x[2]) / max * 48)) + 'px'; b.title = day(x[0]) + ' 実質 ' + money(x[2]) + '・名目 ' + money(x[1]); bars.appendChild(b); });
    p.appendChild(bars);
    p.appendChild(el('p', 'muted town-note', '消費＝市民（とプレイヤー）が買ったもの（消費税込み）、政府＝公務員の給与・医療・区の購入、投資＝企業の設備・ゲームの開発・地元企業の投資・公共事業、輸出入＝もう一方の国と海外との取引（アスカ国の支店はアスカ国の生産）。月末の請求・給料・設備投資の日は1日の値が大きく動きます。'));
    box.appendChild(p);
  }

  // the times' mood and the prices (server/core/npc-macro.js macroView): what pulls the mood, what everyone expects
  // the prices to do, the price index and the rents against the beginning, and the last 120 days of the mood
  function macroPanel(box, m) {
    var p = panel('景気の波と物価', '市民・企業・国が感じている景気（バブル〜恐慌）と、それによるインフレ・デフレ・誰も決めていません');
    if (!m) { p.appendChild(el('p', 'muted', '国の次の日から数えます。')); box.appendChild(p); return; }
    var sign = function (x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(2) + '%'; };
    var g = el('div', 'town-grid'), P = m.parts || {};
    kv(g, '世の中の景気', m.name + '（' + (m.mood >= 0 ? '+' : '−') + Math.abs(m.mood).toFixed(3) + '・支出への効き ×' + m.boom.toFixed(3) + '）');
    kv(g, '今のインフレ率（年率）', sign(m.pi)); kv(g, '予想インフレ率', sign(m.expInfl));
    kv(g, '物価指数', (m.cpi * 100).toFixed(2) + '（はじめ＝100）'); kv(g, '家賃指数', (m.rentIdx * 100).toFixed(2));
    kv(g, '消費の勢い（年平均比）', sign(P.econ || 0)); kv(g, '株価（90日前比）', sign(P.market || 0)); kv(g, '借入の伸び（90日）', sign(P.credit || 0));
    kv(g, '失業率（1年平均との差）', sign(-(P.jobs || 0))); kv(g, '金利（中立金利との差）', sign(P.rate || 0)); kv(g, 'アルタスの資源価格（年率）', sign(P.altas || 0));
    p.appendChild(g);
    var bars = el('div', 'town-bars town-mood'), list = m.hist || [];
    bars.setAttribute('role', 'img'); bars.setAttribute('aria-label', '世の中の景気（直近' + list.length + '日）');
    list.forEach(function (x) { var b = el('i', x[1] < 0 ? 'neg' : ''); b.style.height = Math.max(1, Math.round(Math.abs(x[1]) * 48)) + 'px'; b.title = day(x[0]) + ' 景気 ' + x[1].toFixed(3) + '・インフレ率 ' + sign(x[2]); bars.appendChild(b); });
    p.appendChild(bars);
    p.appendChild(el('p', 'muted town-note', '好景気・バブルでは市民が収入と貯金をよく使い（カジノ・遊び・株への投資も増え）、企業は利益をため込まずに予算・配当・設備投資を増やし、国は国庫の余裕を早く使います。不景気ではその逆。景気は消費の勢い・株価・借入・雇用でふくらみ、自分の噂でも勢いづき、高い金利・お金の不足・株価の反落でしぼみます。物価は予想インフレ率に需要・雇用・景気・資源価格が上乗せされて動きます。'));
    box.appendChild(p);
  }

  /* ------------------------------------------------------------ アスカ国, live --- */
  // what its people are doing now (they live minute by minute as ヴェルノア's: server/core/asuka.js tick) and the day's
  // money so far, asked every 10 seconds while the page is open
  var asukaTimer = 0, ASUKA_ASK = 10000;
  function asukaLive() {
    var p = panel('アスカ国の今（リアルタイム）', '市民はヴェルノアと同じく1分ごとに動きます（9:00/11:00〜22:00）・10秒ごとに更新');
    var body = el('div'); p.appendChild(body);
    function show(v) {
      if (!v) { body.replaceChildren(el('p', 'muted', '読み込み中…')); return; }
      var L = v.live;
      if (!L) { body.replaceChildren(el('p', 'muted', 'アスカ国はまだ建国されていません。')); return; }
      var parts = [], g = el('div', 'town-grid'), T = L.today, M = L.money;
      var t = new Date((v.minute || L.minute) * 60000 + 9 * 3600000);
      kv(g, '国の時刻', t.getUTCFullYear() + '/' + (t.getUTCMonth() + 1) + '/' + t.getUTCDate() + ' ' + t.getUTCHours() + ':' + ('0' + t.getUTCMinutes()).slice(-2) + '（日本時間）');
      L.acts.forEach(function (name, k) { if (L.all[k]) kv(g, name, L.all[k].toLocaleString('ja-JP') + '人'); });
      if (T) { kv(g, '今日の生活費（地元の商売）', money(T.living)); kv(g, '今日の買い物（ヴェルノア企業の拠点）', money(T.bought)); kv(g, '今日の消費税', money(T.tax)); kv(g, '今日の外出', T.trips.toLocaleString('ja-JP') + '回'); }
      kv(g, 'まだ使うつもりのお金（今日）', money(L.left)); kv(g, '国民の預金', money(M.people)); kv(g, '国庫', money(M.treasury)); kv(g, 'ATSUKA Vision', money(M.atsuka)); kv(g, '地元の商売', money(M.trade));
      kv(g, '企業への支払い待ち（締めで入金）', money(M.toCo)); kv(g, 'アスカ国のお金の合計', money(M.all));
      parts.push(g);
      parts.push(table(['区'].concat(L.acts), L.districts.map(function (d) { return [d.name].concat(d.acts.map(function (n) { return n.toLocaleString('ja-JP'); })); })));
      if (T) parts.push(el('p', 'muted town-note', '今日の買い物：' + T.byCat.filter(function (c) { return c.n > 0; }).map(function (c) { return c.name + ' ' + money(c.n); }).join('・') + (L.last ? '（前日：生活費 ' + money(L.last.living) + '・買い物 ' + money(L.last.bought) + '）' : '')));
      body.replaceChildren.apply(body, parts);
    }
    function askLive() {
      if (!st.request) return;
      st.request('GET', '/api/ops/npc/asuka').then(function (r) { st.asukaLive = r; if (p.isConnected) show(r); }, function () { /* (kept: the last figures) */ });
    }
    show(st.asukaLive);
    askLive();
    if (asukaTimer) clearInterval(asukaTimer);
    asukaTimer = setInterval(function () { if (!p.isConnected) { clearInterval(asukaTimer); asukaTimer = 0; return; } askLive(); }, ASUKA_ASK);
    return p;
  }

  /* ---------------------------------------------------------------- アスカ国 --- */
  // the country beside it (server/core/asuka.js view): its people and money, ATSUKA Vision, ヴェルノア's companies'
  // branches, the money between the two countries, its months and news
  function asuka(box, r) {
    var a = r.asuka;
    if (!a) { box.appendChild(el('p', 'muted', 'アスカ国はまだ建国されていません（次の締めで建国されます）。')); return; }
    box.appendChild(asukaLive());
    var p = panel('アスカ国', '建国 ' + day(a.founded) + '・建国資金 ' + money(a.total) + '（一度だけ発行）・人口 ' + a.people.toLocaleString('ja-JP') + '人');
    var g = el('div', 'town-grid'), J = a.jobs;
    kv(g, 'ATSUKA Visionで働く人', String(J.atsuka)); kv(g, '地元の商売で働く人', String(J.trade)); kv(g, 'ヴェルノア企業の支店で働く人', String(J.branch));
    kv(g, '仕事を探している人', String(J.none) + '（失業率 ' + pct(a.stats && a.stats.jobless) + '）'); kv(g, '学生', String(J.student)); kv(g, '退職した人', String(J.retired));
    p.appendChild(g);
    box.appendChild(p);
    gdpPanel(box, r.gdp && r.gdp.asuka, 'アスカ国');
    p = panel('アスカ国のお金', 'すべて建国資金から：両国の間を行き来するだけ');
    g = el('div', 'town-grid'); var M = a.money;
    kv(g, '国民の預金', money(M.people)); kv(g, '国庫', money(M.treasury)); kv(g, 'ATSUKA Vision', money(M.atsuka)); kv(g, '国立銀行の自己資金', money(M.bank));
    kv(g, '国立銀行の貸出', money(M.lent)); kv(g, '企業誘致の資金（残り）', money(M.boost) + '（支払い済み ' + money(M.boostPaid) + '）'); kv(g, '年金の積立金', money(M.pension)); kv(g, '地元の商売', money(M.trade));
    kv(g, 'アスカ国のお金の合計', money(M.all));
    kv(g, 'ヴェルノアから入ったお金（累計）', money(a.sum.fromVernoa)); kv(g, 'ヴェルノアへ出たお金（累計）', money(a.sum.toVernoa)); kv(g, 'ATSUKA Visionの調達（累計）', money(a.procured));
    p.appendChild(g);
    box.appendChild(p);
    // its balance with ヴェルノア kept: the rent and the withholding it moves, its prices, its fund's bonds
    var pol = a.policy;
    if (pol) {
      p = panel('アスカ国の財政ルール', 'ヴェルノアとの収支が3か月続けて赤字なら地代と源泉税を上げ、黒字なら下げる');
      g = el('div', 'town-grid');
      kv(g, '先月のヴェルノアとの収支', (pol.last >= 0 ? '+' : '−') + money(Math.abs(pol.last || 0)));
      kv(g, '支店の地代（売上に対し）', ((pol.rent || 0) * 100).toFixed(1) + '%'); kv(g, '送金の源泉税', ((pol.withhold || 0) * 100).toFixed(0) + '%');
      kv(g, '物価（建国時＝1）', String(pol.price)); kv(g, '政府系ファンド（ヴェルノア国債）', money(pol.bonds));
      p.appendChild(g);
      box.appendChild(p);
    }
    p = panel('ATSUKA Vision', '国営の事業：アスカ国の雇用主で、ヴェルノアから稼ぐ');
    p.appendChild(table(['事業', '内容', '働く人', 'ヴェルノアからの売上（累計）'], a.atsuka.map(function (d) { return [d.name, d.what, String(d.staff), money(d.rev)]; })));
    box.appendChild(p);
    // アルタス: the resources of every company, its prices as a monopoly sets them, what it sold by who bought it
    var al = a.altas;
    if (al) {
      p = panel('アルタス（国営資源事業）', 'ヴェルノアの45社とアスカの商売の資源を独占して売る。売上は買われた分だけ・価格は毎月アルタスが決める');
      g = el('div', 'town-grid'); var L = al.last;
      kv(g, '資源価格（建国時＝1）', (al.price || 1).toFixed(3)); kv(g, '働く人', String(al.staff)); kv(g, '今月の売上（ここまで）', money(al.month && al.month.rev));
      if (L) {
        kv(g, '先月の売上', money(L.rev)); kv(g, '先月の人件費', money(L.pay)); kv(g, '先月の設備（ヴェルノアの重機・車両）', money(L.equip));
        kv(g, '先月の利益', money(L.profit) + '（利益率 ' + pct(L.margin) + '）'); kv(g, '先月の国庫への配当', money(L.dividend));
      }
      kv(g, '国庫への配当（累計）', money(al.dividends));
      p.appendChild(g);
      var groups = {}, order = [];
      (al.customers || []).forEach(function (c) { if (!(c.group in groups)) { groups[c.group] = 0; order.push(c.group); } groups[c.group] += c.n; });
      var when = L ? '先月' : '今月';
      if (order.length) p.appendChild(table(['お客の種類（' + when + '）', '売上'], order.map(function (k) { return [k, money(groups[k])]; })));
      if ((al.customers || []).length) p.appendChild(table(['お客（' + when + '・上位20）', '種類', '売上'], al.customers.slice(0, 20).map(function (c) { return [c.label, c.group, money(c.n)]; })));
      if (al.hist && al.hist.length) {
        p.appendChild(table(['月末', '資源価格', '売上', '人件費', '設備', '利益', '国庫への配当'], al.hist.slice().reverse().map(function (h) {
          return [day(h.day), h.price.toFixed(3) + (h.next !== h.price ? '→' + h.next.toFixed(3) : ''), money(h.rev), money(h.pay), money(h.equip || 0), money(h.profit), money(h.dividend)];
        })));
      }
      box.appendChild(p);
    }
    p = panel('ヴェルノア企業の拠点', '各社がアスカの人の支出を見て、採算が合うだけ開く（毎月）');
    var rows = [];
    a.cats.forEach(function (c) { c.cos.forEach(function (co, k) { rows.push([k ? '' : c.name, k ? '' : money(c.want) + '/年', co.name, c.digital ? '配信（拠点なし）' : co.branches + 'か所']); }); });
    p.appendChild(table(['分野', 'アスカの人が使いたい額', '会社', '拠点'], rows));
    box.appendChild(p);
    if (a.hist && a.hist.length) {
      p = panel('月ごとの記録');
      p.appendChild(table(['月末', 'お金の合計', '国民の預金', '国庫', 'ATSUKA Vision', '失業率', 'ヴェルノアから（累計）', 'ヴェルノアへ（累計）'], a.hist.slice(-12).reverse().map(function (h) {
        return [day(h.day), money(h.money), money(h.cash), money(h.treasury), money(h.atsuka), pct(h.jobless), money(h.fromVernoa), money(h.toVernoa)];
      })));
      box.appendChild(p);
    }
    p = panel('アスカ国のニュース');
    var list = el('ul', 'town-list');
    (a.news || []).slice().reverse().forEach(function (n) { list.appendChild(el('li', '', day(n.day) + '　' + n.text)); });
    p.appendChild(list);
    box.appendChild(p);
  }

  /* ---------------------------------------------------------------- asking --- */
  function ask() {
    if (!st.request) return;
    var gen = ++st.gen;
    var path = '/api/ops/npc' + (st.all && st.all.rev ? '?rev=' + encodeURIComponent(st.all.rev) : '');
    st.request('GET', path).then(function (r) {
      if (gen !== st.gen) return;
      if (!r.same) st.all = r;
      render();
    }, function (e) { if (gen === st.gen) st.view.replaceChildren(el('p', 'muted', '表示できません：' + (e && e.message || '通信できませんでした'))); });
  }
  function askOrg(id) {
    var have = st.orgs[id], path = '/api/ops/npc/org?c=' + encodeURIComponent(id) + (have && have.rev ? '&rev=' + encodeURIComponent(have.rev) : '');
    st.request('GET', path).then(function (r) { if (!r.same) st.orgs[id] = r; if (st.tab === 'orgs' && st.company === id) render(); }, function (e) { st.toast(e && e.message || '読み込めませんでした'); });
  }
  function search() {
    var p = '/api/ops/npc/people?q=' + encodeURIComponent(st.q) + '&d=' + encodeURIComponent(st.d) + '&j=' + encodeURIComponent(st.j) + '&p=' + st.page;
    st.request('GET', p).then(function (r) { st.people = r; render(); }, function (e) { st.toast(e && e.message || '検索できませんでした'); });
  }
  function openPerson(i) {
    st.request('GET', '/api/ops/npc/person?i=' + i).then(function (r) { st.person = r.person; st.tab = 'people'; render(); if (st.view) st.view.scrollTop = 0; }, function (e) { st.toast(e && e.message || '読み込めませんでした'); });
  }
  function link(p) { if (!p) return document.createTextNode('—'); var a = btn('town-name', p.name, function (e) { e.stopPropagation(); openPerson(p.i); }); return a; }

  /* ---------------------------------------------------------------- render --- */
  function render() {
    var view = st.view;
    if (!view || !N()) return;
    var box = el('div', 'town');
    var bar = el('div', 'town-tabs');
    TABS.forEach(function (t) { var b = btn('chip' + (st.tab === t[0] ? ' on' : ''), t[1], function () { st.tab = t[0]; if (t[0] === 'orgs') askOrg(st.company); render(); }); bar.appendChild(b); });
    box.appendChild(bar);
    var r = st.all;
    if (!r) box.appendChild(el('p', 'muted', '読み込み中…'));
    else if (!r.started) box.appendChild(el('p', 'muted', 'NPCの国はまだ始まっていません（企業が始まった後、次の起動で始まります）。'));
    else if (st.tab === 'nation') nation(box, r);
    else if (st.tab === 'people') people(box, r);
    else if (st.tab === 'orgs') orgs(box);
    else if (st.tab === 'locals') locals(box, r);
    else if (st.tab === 'asuka') asuka(box, r);
    else news(box, r);
    view.replaceChildren(box);
  }

  // 地元の企業: the 32 local companies by their economies (server/core/npc-local.js view) — their people, last month
  // against the plan for this country, who paid them for what — and what each of the thirteen paid them
  function locals(box, r) {
    var L = r.locals;
    if (!L) { box.appendChild(el('p', 'muted', '地元の企業はまだ始まっていません（国の次の日から）。')); return; }
    var co = window.BR && window.BR.CORP;
    L.spheres.forEach(function (sp) {
      var list = L.firms.filter(function (f) { return f.sphere === sp.id; });
      var p = panel(sp.name, list.length + '社');
      p.appendChild(table(['No.', '会社', '本社', '社員', '年収', '先月の売上（計画）', '営業利益（計画）', '決算賞与', '利益剰余金', '主な売上'], list.map(function (f) {
        var m = f.month || {};
        return { cells: [String(f.no), f.name, f.hq, f.staff + ' / ' + f.target, money(f.pay), money(m.sales) + '（' + money(f.plan.sales / 12) + '）', money(m.op) + '（' + money(f.plan.op / 12) + '）',
          m.bonus ? money(m.bonus) : '—', money(f.retained), f.by.slice(0, 3).map(function (x) { return x.label + ' ' + money(x.n); }).join('・') || '—'] };
      })));
      p.appendChild(el('p', 'muted town-note', list.map(function (f) { return f.name + '：' + f.role; }).join(' ／ ')));
      box.appendChild(p);
    });
    var q = panel('上位13社から地元の企業へ（先月）', '研究開発費・施設費・その他の経費・販売費のうち、地元の企業への業務委託・共同研究費・賃借・発注');
    q.appendChild(table(['会社', '支払先（内容）'], Object.keys(L.paidBy).map(function (id) {
      return { cells: [co && co.company(id) ? co.company(id).name : id, L.paidBy[id].slice(0, 6).map(function (x) { return x.firm + '（' + x.what + '）' + money(x.n); }).join('、')] };
    })));
    box.appendChild(q);
  }
  function nation(box, r) {
    var s = r.stats, p = panel(r.nation.name, (r.active ? '活動中' : '休止中（再開 ' + at(r.next) + '）') + '・人口' + (s.population || 0).toLocaleString('ja-JP'));
    var g = el('div', 'town-grid');
    [['失業率', pct(s.unemployment)], ['平均の気分', Math.round((s.mood || 0) / 2.55) + '/100'], ['景気', ((s.economy || 1) * 100).toFixed(1)], ['物価', ((s.prices || 1) * 100).toFixed(1)], ['インフレ率', pct(s.inflation)],
      ['ジニ係数', String(s.gini)], ['資産の中央値', money(s.median)], ['路上で暮らす人', String(s.homeless)], ['居候', String(s.staying)], ['市民の預金', money(s.cash)], ['市民の借金', money(s.debt)]].forEach(function (x) { kv(g, x[0], x[1]); });
    p.appendChild(g);
    box.appendChild(p);
    gdpPanel(box, r.gdp && r.gdp.vernoa, r.nation.name);
    macroPanel(box, r.macro);
    var nf = r.nationFull;
    p = panel('国の帳簿', 'テネシスの国の口座');
    g = el('div', 'town-grid');
    kv(g, '国の預金', money(nf.cash)); kv(g, '国債の残高', money(nf.debt)); kv(g, 'うちテネシスから', money(nf.bank)); kv(g, '年金の積立金（現金）', money(nf.fund.cash)); kv(g, '年金の積立金（国債）', money(nf.fund.bonds)); kv(g, '年金の支払い（累計）', money(nf.fund.paid));
    p.appendChild(g);
    var rows = [];
    // (each kind's name; one not listed shows as it is)
    var KIND = { consumption: '消費税', income: '所得税', social: '社会保険料', corporate: '法人税', inheritance: '相続税', escheat: '相続人のいない遺産', gains: '譲渡益税',
      pensionIn: '年金の保険料', civil: '公務員の給与', pension: '年金', welfare: '生活保護', jobless: '失業手当', medical: '医療', works: '公共事業', grants: '交付金・給付',
      guarantee: '未払賃金の立替払', bondInterest: '国債の利子', debtInterest: 'テネシスへの利子', casinoWins: '市民のスロットの勝ち分',
      slotWins: 'プレイヤーのスロットの勝ち分', questRewards: 'クエストの報酬', gachaClaims: 'ガチャ代（YOSIDAへ）', loginBonus: 'ログインボーナス', dailyTokens: '毎日の無料トークン',
      coopBonus: '協力プレイのボーナス', releaseBonus: 'アップデートのお礼', medalRewards: '功績の報酬', diaryRewards: '日記の報酬', treeHarvest: '金の生る木の収穫', npcGifts: 'ジョンソン・運営からの贈り物',
      playerStart: 'プレイヤーの初期資金', treeFund: '金の生る木の肥料（収穫の財源）', newLife: '生まれた人の初期資金', bankRescue: 'テネシスへの公的資金', asukaBonds: 'アスカ国の政府系ファンドへの国債の利子', gachaShare: 'ガチャ代の国庫分（20%）' };
    var kindName = function (k) { return KIND[k] || k; };
    Object.keys(nf.day.in || {}).forEach(function (k) { rows.push(['収入', kindName(k), money(nf.day.in[k])]); });
    Object.keys(nf.day.out || {}).forEach(function (k) { rows.push(['支出', kindName(k), money(nf.day.out[k])]); });
    if (rows.length) p.appendChild(table(['', '項目（今日）', '金額'], rows));
    box.appendChild(p);
    // the money ledger: every $ from someone to someone (it moves only when a country is founded)
    var L = r.ledger;
    if (L) {
      p = panel('マネー台帳', 'お金は途中で生まれも消えもしない：建国のときだけ増える');
      g = el('div', 'town-grid');
      kv(g, '今のずれ（累計）', (L.drift >= 0 ? '+' : '−') + '$' + Math.abs(L.drift).toLocaleString('en-US')).classList.toggle('town-bad', L.drift !== 0);
      kv(g, '1日の最大のずれ', '$' + Math.abs(L.worst).toLocaleString('en-US'));
      kv(g, '最初に数えたお金', money(L.base)); kv(g, 'その後の建国で増えた分', money(L.founded)); kv(g, '最後に数えた日', day(L.at));
      p.appendChild(g);
      // (the players' side: their money and what is held for them, against what crossed between them and the country)
      var PL = L.players, last = PL && PL.days && PL.days[PL.days.length - 1];
      if (PL) {
        g = el('div', 'town-grid');
        kv(g, 'プレイヤー側のずれ（累計）', (PL.drift >= 0 ? '+' : '−') + '$' + Math.abs(PL.drift).toLocaleString('en-US')).classList.toggle('town-bad', PL.drift !== 0);
        kv(g, 'プレイヤー側の1日の最大のずれ', '$' + Math.abs(PL.worst || 0).toLocaleString('en-US'));
        if (last) {
          var LP = last.parts || {};
          kv(g, 'プレイヤーのお金（合計）', money(last.money));
          kv(g, 'うち$とトークン', money(LP.held)); kv(g, 'うち注文で預かり中', money(LP.orders)); kv(g, 'うち未受取の配当', money(LP.dividends));
          kv(g, 'うち観戦ベットの賭け金', money(LP.bets)); kv(g, 'うち受け取り待ちの送金・プレゼント・車の代金', money(LP.sent));
          kv(g, '国から受け取った分−国へ払った分（累計）', money(last.crossed));
        }
        p.appendChild(g);
      }
      box.appendChild(p);
    }
    p = panel('5つの区');
    p.appendChild(table(['区', '区長', '支持率', '人口', '景気', '公約'], r.districts.map(function (d) {
      return { cells: [d.name, link(d.mayor), d.approval + '%', String(d.people), (d.economy * 100).toFixed(1), (d.platform || []).map(function (id) { var x = N().platforms.filter(function (y) { return y.id === id; })[0]; return x ? x.name : id; }).join('・')] };
    })));
    box.appendChild(p);
    // the knobs: what the council and the people move, as the country's situation calls for (no range; 運営 sets none)
    p = panel('国の決まり', '税・年金・予算などは、街の議会と市民投票が状況に応じて決めます（翌月1日から・同じ項目は四半期に1回・範囲なし）。運営は変更できません');
    p.appendChild(table(['項目', '今', '最後の変更'], r.knobs.map(function (k) {
      return { cells: [(k.group ? '［' + k.group + '］' : '') + k.name, knobText(k, k.value), k.changed ? day(k.changed) : ''] };
    })));
    box.appendChild(p);
    // what the companies decide themselves: their fees, MAGITA's surcharge, Tenesice's rates and phone bill; the prices
    var dc = r.decided;
    if (dc) {
      p = panel('企業が自分で決めていること', '業績と状況に応じて各社が毎月見直します（運営は変更できません・範囲なし）');
      g = el('div', 'town-grid');
      kv(g, 'Dtradeの勝利金手数料', (dc.fees.winFee * 100).toFixed(2) + '%'); kv(g, 'Dtradeの交換手数料', money(dc.fees.exchangeFee)); kv(g, 'Dtradeの株の売買手数料', (dc.fees.tradeFee * 100).toFixed(2) + '%');
      kv(g, '求人サイトの掲載料（シティーワーク）', (dc.fees.jobFee * 100).toFixed(1) + '%'); kv(g, 'MAGITAの仕入れ価格への上乗せ（経営悪化時）', money(dc.surcharge));
      kv(g, 'テネシスの個人向け金利', (dc.rates.person * 100).toFixed(2) + '%'); kv(g, 'テネシスのクイックローン金利', (dc.quick * 100).toFixed(1) + '%'); kv(g, 'テネシス・モバイルの月額', money(dc.phone));
      kv(g, '物価（はじめ＝1）', dc.cpi.toFixed(3)); kv(g, '家賃の水準（はじめ＝1）', dc.rentIdx.toFixed(3));
      p.appendChild(g);
      box.appendChild(p);
    }
    var po = r.politics;
    p = panel('政治');
    if (po.campaign) p.appendChild(table(['区', '候補', '公約'], po.campaign.cands.map(function (c) { return [N().districts[c.district].name, c.name + (c.incumbent ? '（現職）' : ''), (c.platform || []).join('・')]; })));
    p.appendChild(el('h4', '', '署名'));
    p.appendChild(table(['題名', '範囲', '署名', '呼びかけ人', '状態'], po.petitions.map(function (x) { return { cells: [x.title, x.scope === 'national' ? '国' : N().districts[x.district].name, String(x.count), link(x.leader), x.state] }; })));
    p.appendChild(el('h4', '', '市民投票'));
    p.appendChild(table(['題名', '日', '結果'], po.votes.map(function (v) { return [v.title, day(v.day), v.result ? (v.result.pass ? '可決' : '否決') + ' 賛成' + v.result.yes + '・反対' + v.result.no + '・投票率' + pct(v.result.turnout) : '予定'] })));
    p.appendChild(el('h4', '', '街の議会'));
    po.council.forEach(function (c) { (c.minutes || []).forEach(function (m) { p.appendChild(el('p', '', day(c.day) + '：' + m.name + ' ' + knobText(N().knob[m.id], m.from) + '→' + knobText(N().knob[m.id], m.to) + '（' + (m.pass ? '可決' : '否決') + '・' + m.votes.map(function (v) { return N().districts[v.district].name + (v.yes ? '○' : '×'); }).join(' ') + '）')); }); });
    box.appendChild(p);
    p = panel('労働組合');
    p.appendChild(table(['会社', '組合員', '代表', '状態', '要求', '回答', '賃上げ'], r.companies.map(function (c) { var u = r.labor.unions[c.id] || {}; return { cells: [c.name, String(u.members || 0), link(u.rep), u.state, pct(u.demand), pct(u.offer), pct(u.raise)] }; })));
    box.appendChild(p);
    // the server's side: how heavy the country is, the AI's share used, the switches
    var u = r.usage;
    p = panel('負荷と設定', '1分の計算の平均・生成AIの今日の使用量（込みの分の90%まで）');
    g = el('div', 'town-grid');
    kv(g, '1分の計算', u.tickMs + 'ms'); kv(g, '計算した分', String(u.ticks)); kv(g, '保存', String(u.saves)); kv(g, 'サーバー使用量', (u.server || 0).toFixed ? u.server.toFixed(1) + '%' : String(u.server));
    kv(g, '生成AI', u.ai.on ? Math.round(u.ai.neurons) + ' / ' + u.ai.cap + ' Neurons（' + u.ai.calls + '回）' : '使えません（ひな形で作成）'); kv(g, '考える深さ', r.depth); kv(g, '一時停止', r.paused ? 'はい' : 'いいえ');
    p.appendChild(g);
    var ctl = el('div', 'town-actions');
    ctl.appendChild(btn('btn', r.paused ? '再開する' : '一時停止する', function () { control({ paused: !r.paused }); }));
    ['auto', 'shallow', 'standard', 'deep', 'deepest'].forEach(function (d) { ctl.appendChild(btn('btn small', { auto: '深さ：自動', shallow: '浅い', standard: '標準', deep: '深い', deepest: 'いちばん深い' }[d], function () { control({ depth: d }); })); });
    p.appendChild(ctl);
    box.appendChild(p);
  }
  function control(body) {
    st.request('POST', '/api/ops/npc/control', body).then(function () { st.toast('設定しました'); st.all = null; ask(); }, function (e) { st.toast(e && e.message || '設定できませんでした'); });
  }

  function people(box, r) {
    var p = panel('住民をさがす', '名前（漢字・かな）・区・勤め先');
    var f = el('form', 'town-search');
    var q = el('input'); q.placeholder = '名前'; q.value = st.q;
    var d = el('select'); [['', 'すべての区']].concat(N().districts.map(function (x) { return [String(x.id), x.name]; })).forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; d.appendChild(op); }); d.value = st.d;
    var j = el('select'); [['', 'すべての仕事']].concat(N().jobNames.map(function (x, k) { return [String(k), x]; })).forEach(function (o) { var op = el('option', '', o[1]); op.value = o[0]; j.appendChild(op); }); j.value = st.j;
    var go = el('button', 'btn', '検索'); go.type = 'submit';
    f.appendChild(q); f.appendChild(d); f.appendChild(j); f.appendChild(go);
    f.addEventListener('submit', function (e) { e.preventDefault(); st.q = q.value.trim(); st.d = d.value; st.j = j.value; st.page = 0; search(); });
    p.appendChild(f);
    if (st.people) {
      p.appendChild(el('p', 'muted', st.people.found + '人'));
      p.appendChild(table(['名前', '年齢', '区', '仕事', 'いま', '気分'], st.people.people.map(function (c) { return { onclick: function () { openPerson(c.i); }, cells: [c.name, String(c.age), N().districts[c.district].name, c.job, c.act, String(Math.round(c.mood / 2.55))] }; })));
      var nav = el('div', 'town-actions');
      if (st.page > 0) nav.appendChild(btn('btn small', '前へ', function () { st.page--; search(); }));
      if ((st.page + 1) * 50 < st.people.found) nav.appendChild(btn('btn small', '次へ', function () { st.page++; search(); }));
      p.appendChild(nav);
    }
    box.appendChild(p);
    if (st.person) personPanel(box, st.person);
  }
  function personPanel(box, x) {
    var p = panel(x.name + '（' + x.kana + '・' + x.age + '歳）', x.district + '・' + x.home + (x.posts && x.posts.length ? '・' + x.posts.join('、') : ''));
    p.appendChild(el('p', 'town-voice', '心の声：「' + x.voice + '」'));
    var g = el('div', 'town-grid');
    kv(g, 'いま', x.act + '（' + x.at + '・' + x.place + '）'); kv(g, '仕事', x.job || '—'); kv(g, '健康', String(x.health));
    var m = x.money;
    kv(g, '手元のお金', money(m.cash)); kv(g, '借金', money(m.debt) + (m.loan ? '（' + m.loan + '）' : '')); kv(g, '信用', String(m.credit)); kv(g, '月の予算', money(m.budget));
    kv(g, '今月の使ったお金', money(m.spent)); kv(g, 'カジノのトークン', money(m.tokens));
    kv(g, '給料（年）', money(x.work.salary)); kv(g, '役職', x.work.rank); kv(g, '勤続', x.work.tenure + 'か月'); kv(g, '仕事の満足', String(x.work.satisfaction));
    kv(g, '年金の記録', x.pension.months + 'か月'); kv(g, '年金（月）', money(x.pension.monthly)); kv(g, '車', x.car || 'なし'); kv(g, 'スマホ', x.phone); kv(g, 'VIP', x.vip ? 'はい' : 'いいえ');
    p.appendChild(g);
    var t = function (title, obj) { var s = el('div', 'town-bars'); s.appendChild(el('h4', '', title)); Object.keys(obj).forEach(function (k) { var r = el('div', 'town-bar'); r.appendChild(el('span', '', k)); var b = el('i'); b.style.width = Math.round(obj[k] / 2.55) + '%'; r.appendChild(b); s.appendChild(r); }); return s; };
    var cols = el('div', 'town-cols');
    cols.appendChild(t('性格', x.traits)); cols.appendChild(t('欲求（満たされ具合）', x.needs)); cols.appendChild(t('気持ち', x.feelings)); cols.appendChild(t('不満', x.discontent)); cols.appendChild(t('スキル', x.skills));
    p.appendChild(cols);
    p.appendChild(el('h4', '', '人間関係'));
    p.appendChild(table(['相手', '親しさ', '信頼', ''], x.relations.map(function (rl) { return { onclick: function () { openPerson(rl.i); }, cells: [rl.name, String(rl.close), String(rl.trust), rl.family ? '家族' : ''] }; })));
    p.appendChild(el('h4', '', '人生の本（最近の出来事）'));
    (x.life || []).forEach(function (l) { p.appendChild(el('p', '', l.what + '（' + (l.ago ? l.ago + '日前' : '今日') + '・強さ' + l.power + '）')); });
    if (x.reasons && x.reasons.length) { p.appendChild(el('h4', '', '決断の理由')); x.reasons.forEach(function (rs) { p.appendChild(el('p', '', rs.text)); }); }
    var holds = Object.keys(x.holds || {});
    if (holds.length) { p.appendChild(el('h4', '', '持っている株')); p.appendChild(table(['会社', '株数'], holds.map(function (k) { return [k, String(x.holds[k])]; }))); }
    box.appendChild(p);
  }

  function orgs(box) {
    var bar = el('div', 'town-tabs');
    N().companies.forEach(function (id) { bar.appendChild(btn('chip' + (st.company === id ? ' on' : ''), (window.BR.CORP ? window.BR.CORP.company(id).name : id), function () { st.company = id; askOrg(id); render(); })); });
    box.appendChild(bar);
    var o = st.orgs[st.company];
    if (!o) { box.appendChild(el('p', 'muted', '読み込み中…')); return; }
    var p = panel(o.name + 'の人', '社員' + o.staff + '人');
    var g = el('div', 'town-grid');
    var k = function (label, person) { var r = el('div', 'town-kv'); r.appendChild(el('span', '', label)); var b = el('b'); b.appendChild(link(person)); r.appendChild(b); g.appendChild(r); };
    k('CEO', o.ceo); k('社長', o.president); o.officers.forEach(function (x) { k('役員', x); });
    p.appendChild(g);
    p.appendChild(table(['部署', '人数', '部長', '課長', '担当'], o.depts.map(function (d) {
      var named = el('span'); d.named.forEach(function (n, x) { if (x) named.appendChild(document.createTextNode('・')); named.appendChild(document.createTextNode(n.name + '：')); named.appendChild(link(n.who)); });
      var mg = el('span'); d.managers.forEach(function (m, x) { if (x) mg.appendChild(document.createTextNode('・')); mg.appendChild(link(m)); });
      return { cells: [d.name, String(d.size), link(d.head), mg, named] };
    })));
    box.appendChild(p);
    if (o.lend || o.terms) { p = panel('取引の条件'); if (o.lend) kv(p, 'テネシスからの借入', '年' + (o.lend.rate * 100).toFixed(2) + '%・融資枠' + money(o.lend.cap)); if (o.terms) kv(p, 'MAGITAからの仕入れ価格', ((o.terms - 1) * 100).toFixed(1) + '%'); box.appendChild(p); }
    p = panel('会議室', '提案・出席者の発言・ストップ係・決定');
    o.meetings.forEach(function (m) {
      var d = el('details', 'town-meet');
      var s = el('summary', '', day(m.day) + '　' + (m.room || '') + '　' + m.title + '　' + (m.veto ? '【差し止め】' : m.pass ? '【可決】' : '【否決】'));
      d.appendChild(s);
      (m.lines || []).forEach(function (l) { d.appendChild(el('p', 'town-line', (l.name ? l.name + '（' + l.role + '）' : l.role) + (STANCE[l.stance] ? ' ' + STANCE[l.stance] : '') + '：' + l.text)); });
      if (m.veto) d.appendChild(el('p', 'town-veto', 'ストップ係 ' + m.veto.name + '：' + m.veto.why));
      p.appendChild(d);
    });
    if (!o.meetings.length) p.appendChild(el('p', 'muted', 'まだ会議はありません'));
    box.appendChild(p);
    if (o.labs && o.labs.length) {
      p = panel('研究開発本部の部門');
      p.appendChild(table(['部門', 'テーマ', '部門長', '人数', '開始', '予定', '結果'], o.labs.map(function (l) { return { cells: [l.name, l.theme, link(l.head), String(l.size), l.start ? day(l.start) : '', l.due ? day(l.due) : '', l.done ? (l.ok ? '成功' : '未達') : '研究中'] }; })));
      box.appendChild(p);
    }
    p = panel('新事業', '本当に市民が使い、お金を払う事業。伸びれば拡大、損が続けば撤退');
    if (!o.ventures.length) p.appendChild(el('p', 'muted', 'まだありません'));
    o.ventures.forEach(function (v) {
      var d = el('details', 'town-meet');
      d.appendChild(el('summary', '', v.name + '　' + { trial: '試験', run: '本格', grow: '拡大', shrink: '縮小', closed: '撤退' }[v.stage] + '　顧客' + v.customers + '人・担当' + v.staff + '人・累計損益' + money(v.total.rev - v.total.cost)));
      if (v.announce) d.appendChild(el('p', 'town-voice', v.announce));
      kv(d, '事業責任者', who(v.lead)); kv(d, '開始', day(v.start)); kv(d, '料金', v.fee ? money(v.fee) + '/月' : money(v.use) + '/回');
      d.appendChild(table(['月', '売上', '費用', '顧客', '担当', '品質'], (v.months || []).slice(-12).map(function (x) { return [day(x.day), money(x.rev), money(x.cost), String(x.customers), String(x.staff), String(x.quality)]; })));
      (v.reports || []).slice(-3).forEach(function (x) { d.appendChild(el('p', '', x.text)); });
      (v.log || []).slice(-5).forEach(function (x) { d.appendChild(el('p', 'muted', day(x.day) + ' ' + x.text)); });
      p.appendChild(d);
    });
    box.appendChild(p);
    p = panel('報告書', '経理の月次・競合他社分析・新事業');
    o.reports.forEach(function (x) { var d = el('details', 'town-meet'); d.appendChild(el('summary', '', day(x.day) + '　' + x.title)); d.appendChild(el('p', '', x.text)); p.appendChild(d); });
    box.appendChild(p);
    p = panel('考えていること');
    o.think.forEach(function (x) { p.appendChild(el('p', '', day(x.day) + ' ' + x.name + '：' + x.text)); });
    box.appendChild(p);
  }

  function news(box, r) {
    var p = panel('ニュース');
    (r.news || []).forEach(function (n) { p.appendChild(el('p', '', at(n.at) + '　' + n.text)); });
    box.appendChild(p);
    p = panel('街の声');
    (r.talk || []).forEach(function (t) { p.appendChild(el('p', '', t.text)); });
    box.appendChild(p);
  }

  return {
    show: function (view, request, toast) { st.view = view; st.request = request; st.toast = toast; render(); ask(); },
    // a day closed on the server: asked again while open
    live: function () { if (st.view && !st.view.hidden) { ask(); if (st.tab === 'orgs') askOrg(st.company); } }
  };
})();
