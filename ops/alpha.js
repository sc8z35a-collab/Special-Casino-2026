/* 少数精鋭集団アルファ (server/core/npc-alpha.js): the 90 members and how each stands (what they put in, what they hold,
   what it made or lost them), today's meeting — the 10 who talk and their ways, the numbers they look at, what was said
   (by the AI, or in the model's own words), the plan, its orders and their fills —, and its days (70 of them, each in
   full: kept on the server and in R2). Asked for when opened, when a day closes ('npc') and every 20 seconds while open
   (the talk goes on a few messages a minute); asking again with the last rev is answered { same: true }. Text only by
   textContent. */
var OpsAlpha = (function () {
  'use strict';
  var N = function () { return window.BR && window.BR.NPC; };
  var TABS = [['today', '今日の会議'], ['members', 'メンバー'], ['days', '活動履歴']];
  var STYLE = { value: '配当・ファンダメンタル重視派', swing: '値動き・リバウンド狙い派', infra: 'インフラ・安定重視派' };
  var SIDE = { buy: '買い', sell: '売り' };
  var STATUS = { open: '注文中', filled: '約定', partial: '一部約定', cancelled: '取消（未約定）', none: '対象なし', skipped: '取引停止中' };
  var TALK = { own: '定型（AI未接続）', pending: 'AIの議論待ち', talking: 'AIで議論中', done: 'AIで議論', timeout: '注文時刻までにAIの議論が終わらず定型で補完' };
  var ASK = 20000;
  var st = { view: null, request: null, toast: null, tab: 'today', data: null, rev: '', day: null, timer: 0 };

  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined && text !== null) n.textContent = text; return n; }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; }
  function money(n) { return N() ? N().money(Math.round(n || 0)) : '$' + Math.round(n || 0).toLocaleString('en-US'); }
  function signed(n) { return (n >= 0 ? '+' : '−') + money(Math.abs(n || 0)); }
  function pct(x) { return ((x || 0) >= 0 ? '+' : '−') + Math.abs((x || 0) * 100).toFixed(1) + '%'; }
  function day(d) { var t = new Date(d * 86400000); return t.getUTCFullYear() + '/' + (t.getUTCMonth() + 1) + '/' + t.getUTCDate(); }
  // (a minute since 1970 as the hour in JST; a minute of the day as itself)
  function clock(m) { if (!m && m !== 0) return '—'; var t = new Date(m * 60000 + 9 * 3600000); return t.getUTCHours() + ':' + ('0' + t.getUTCMinutes()).slice(-2); }
  function hm(m) { return Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2); }
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
  function trades(list) { return (list || []).map(function (t) { return SIDE[t.side] + ' ' + name(t.company) + ' ' + t.share + '%'; }).join('、') || '—'; }
  function name(id) { var c = st.data && st.data.companies ? st.data.companies.filter(function (x) { return x.id === id; })[0] : null; return c ? c.name : id; }

  /* ---------------------------------------------------------------- the talk --- */
  function talkBox(talk, top) {
    var box = el('div', 'alpha-talk');
    var styles = {};
    (top || []).forEach(function (t) { styles[t.i] = t.style; });
    (talk.msgs || []).forEach(function (m, k) {
      var row = el('div', 'alpha-msg alpha-' + (m.style || styles[m.i] || 'value') + (m.last ? ' alpha-last' : ''));
      var head = el('div', 'alpha-who');
      head.appendChild(el('b', '', (k + 1) + '. ' + m.name));
      head.appendChild(el('span', 'alpha-style', STYLE[m.style] || ''));
      head.appendChild(el('span', 'alpha-tag', m.ai ? 'AI' : '定型'));
      row.appendChild(head);
      row.appendChild(el('p', '', m.text));
      box.appendChild(row);
    });
    if (!(talk.msgs || []).length) box.appendChild(el('p', 'muted', talk.status === 'pending' ? 'AIの議論が始まるのを待っています（9:30の最初の注文までに終わらなければ定型の議論で決まります）。' : 'まだ発言はありません。'));
    return box;
  }
  function ordersTable(orders) {
    return table(['時刻', '売買', '銘柄', '割合', '株価', '注文株数', '約定株数', '約定代金', '参加', '状態'], (orders || []).map(function (o) {
      return [clock(o.at), SIDE[o.side], name(o.company), o.share + '%', money(o.price), (o.shares || 0).toLocaleString('ja-JP'), (o.filled || 0).toLocaleString('ja-JP'), money(o.paid), (o.members || 0) + '人', (STATUS[o.status] || o.status) + (o.past ? '（上限価格を超え一部取消）' : '')];
    }));
  }
  function boardTable(board) {
    return table(['銘柄', '株価', '前日比', '5日', '20日', '日々の変動', '理論株価', '配当利回り', 'アルファ保有', '含み'], (board || []).map(function (b) {
      return [b.name, money(b.price), pct(b.r1), pct(b.r5), pct(b.r20), (b.vol * 100).toFixed(1) + '%', money(b.fair), (b.yield * 100).toFixed(2) + '%', b.held ? b.held.toLocaleString('ja-JP') + '株（' + money(b.held * b.price) + '）' : 'なし', b.held ? pct(b.gain) : '—'];
    }));
  }

  /* ---------------------------------------------------------------- the tabs --- */
  function head(v) {
    var p = panel('少数精鋭集団アルファ', '独立した株式トレーダー集団・定員' + v.rules.n + '名（この国の規模で' + (v.term ? v.term.n : '—') + '名）・毎月入れ替え・解散なし');
    var g = el('div', 'town-grid'), held = 0, open = 0, real = 0;
    v.members.forEach(function (m) { held += m.value; open += m.open; real += m.realized; });
    kv(g, '発足', day(v.founded));
    kv(g, '今月の定員', v.term ? v.term.n + '名（' + day(v.term.since) + 'から・1か月固定）' : '—');
    kv(g, '保有株の時価', money(held));
    kv(g, '含み損益', signed(open));
    kv(g, '確定損益（累計）', signed(real));
    kv(g, '買付の累計', money(v.sum.bought));
    kv(g, '売却の累計', money(v.sum.sold));
    kv(g, '手数料の累計（Dtrade）', money(v.sum.fees));
    kv(g, '活動日数', v.sum.days + '日');
    kv(g, '1日の上限（全体）', money(v.rules.cap) + '（この国の規模で按分）');
    kv(g, 'AI（Workers AI）', st.data.ai ? '接続中' : '未接続（定型の議論）');
    kv(g, '会話履歴の保存', (st.data.r2 ? 'R2とサーバー' : 'サーバー（R2なし）') + '・' + v.rules.keep + '日分');
    p.appendChild(g);
    return p;
  }
  function today(v) {
    var d = v.today, out = [];
    if (!d) { out.push(el('p', 'muted', '最初の会議は発足の日に開かれます。')); return out; }
    var p = panel(d.key + 'の会議', '上位10名が' + v.rules.msgs[0] + '〜' + v.rules.msgs[1] + '回の発言で決め、90名全員が従う・最大2社・売買は合計2回まで');
    var g = el('div', 'town-grid');
    kv(g, '議論', TALK[d.talk.status] || d.talk.status);
    kv(g, '発言数', (d.talk.msgs || []).length + ' / ' + d.talk.target);
    kv(g, '結論', trades(d.plan.trades));
    kv(g, '戦略', d.plan.strategy || '—');
    kv(g, '注文時刻（日本時間）', v.rules.at.map(hm).join('・') + '（大引け ' + hm(v.rules.close) + '）');
    kv(g, '記録', d.kept ? '記録済み' : '全員の注文が約定した時点で記録');
    p.appendChild(g);
    p.appendChild(el('h4', '', '議論する10名'));
    p.appendChild(table(['順位', '名前', '性格', '資産'], d.talkers.map(function (t) { return [String(t.rank), t.name, STYLE[t.style], money(t.wealth)]; })));
    p.appendChild(el('h4', '', '見ている数字'));
    p.appendChild(boardTable(d.board));
    p.appendChild(el('h4', '', '会話'));
    p.appendChild(talkBox(d.talk, d.talkers));
    p.appendChild(el('h4', '', '注文と約定'));
    p.appendChild(d.orders.length ? ordersTable(d.orders) : el('p', 'muted', 'まだ注文は出ていません（' + v.rules.at.map(hm).join('・') + 'に出します）。'));
    out.push(p);
    return out;
  }
  function members(v) {
    var p = panel('メンバー（' + v.members.length + '名）', '拠出は保有資産の比率で自動按分・損益は拠出の多い人ほど大きい・脱退不可');
    p.appendChild(table(['#', '名前', '資産', '現金', '拠出の累計', '保有の時価', '含み損益', '確定損益', '加入'], v.members.map(function (m, k) {
      return [String(k + 1), m.name, money(m.wealth), money(m.cash), money(m.put), money(m.value), signed(m.open), signed(m.realized), day(m.from)];
    })));
    var t = panel('これまでの定員', '毎月の初日に、選ばれし者の中から資産上位を選び直します');
    t.appendChild(table(['開始', '人数', '上位10名'], (v.terms || []).slice().reverse().map(function (x) { return [day(x.since), x.n + '名', x.names.join('・')]; })));
    return [p, t];
  }
  function days(v) {
    var out = [];
    var kept = {};
    (st.data.kept || []).forEach(function (k) { kept[k.day] = k.r2; });
    var p = panel('活動履歴（' + v.hist.length + '日）', '行をクリックすると、その日の会話・注文・損益を全部表示します');
    p.appendChild(table(['日付', '戦略', '結論', '約定', '議論', '保有の時価', '含み損益', '確定損益（累計）', 'R2'], v.hist.map(function (h) {
      return { onclick: function () { openDay(h.day); }, cells: [h.key, h.strategy, trades(h.trades), h.orders.map(function (o) { return SIDE[o.side] + name(o.company) + ' ' + (STATUS[o.status] || o.status); }).join('、'), (h.ai ? 'AI' : '定型') + '・' + h.msgs + '件', money(h.held), signed(h.open), signed(h.realized), kept[h.day] ? '保存済み' : '—'] };
    })));
    out.push(p);
    if (st.day) out.push(dayPanel(st.day));
    return out;
  }
  function dayPanel(r) {
    var p = panel(r.key + 'の記録', (r.why === 'filled' ? '全員の注文が約定した時点（' + clock(r.at) + '）' : '大引けの時点') + 'で記録・' + (r.talk.ai ? 'AIで議論' : '定型の議論'));
    var g = el('div', 'town-grid');
    kv(g, '結論', trades(r.plan.trades)); kv(g, '戦略', r.plan.strategy); kv(g, 'メンバー', r.members + '名');
    kv(g, '保有の時価', money(r.held)); kv(g, '含み損益', signed(r.open)); kv(g, '確定損益（累計）', signed(r.realized));
    p.appendChild(g);
    p.appendChild(el('h4', '', '見ていた数字'));
    p.appendChild(boardTable(r.board));
    p.appendChild(el('h4', '', '会話'));
    p.appendChild(talkBox(r.talk, r.top));
    p.appendChild(el('h4', '', '注文と約定'));
    p.appendChild(ordersTable(r.orders));
    p.appendChild(el('h4', '', 'メンバーの状況（拠出の多い順）'));
    p.appendChild(table(['名前', '拠出の累計', '保有の時価', '含み損益', '確定損益'], (r.standing || []).map(function (m) { return [m.name, money(m.put), money(m.value), signed(m.open), signed(m.realized)]; })));
    p.appendChild(btn('btn small', '閉じる', function () { st.day = null; render(); }));
    return p;
  }
  function openDay(d) {
    st.request('GET', '/api/ops/npc/alpha?day=' + d).then(function (r) {
      if (!r.day) { if (st.toast) st.toast('その日の記録は見つかりませんでした'); return; }
      st.day = r.day; render();
      var last = st.view && st.view.querySelector('.alpha-root .town-panel:last-of-type');
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'start' });
    }, function (e) { if (st.toast) st.toast(e.message); });
  }

  /* ---------------------------------------------------------------- the app --- */
  function render() {
    var root = st.view;
    if (!root) return;
    var box = el('div', 'town alpha-root');
    var v = st.data;
    if (!v) { box.appendChild(el('p', 'muted', '読み込み中…')); root.replaceChildren(box); return; }
    if (!v.started) { box.appendChild(el('p', 'muted', '少数精鋭集団アルファは2026年11月5日に発足します（NPCの国が始まってから）。')); root.replaceChildren(box); return; }
    box.appendChild(head(v));
    var tabs = el('div', 'chips town-tabs');
    TABS.forEach(function (t) { var b = btn('chip' + (st.tab === t[0] ? ' on' : ''), t[1], function () { st.tab = t[0]; render(); }); tabs.appendChild(b); });
    box.appendChild(tabs);
    var parts = st.tab === 'members' ? members(v) : st.tab === 'days' ? days(v) : today(v);
    parts.forEach(function (x) { box.appendChild(x); });
    root.replaceChildren(box);
  }
  function refresh() {
    if (!st.request) return;
    st.request('GET', '/api/ops/npc/alpha' + (st.rev ? '?rev=' + encodeURIComponent(st.rev) : '')).then(function (r) {
      if (r.same) return;
      st.data = r; st.rev = r.rev || '';
      if (st.view && !st.view.hidden) render();
    }, function (e) { if (st.toast) st.toast(e.message); });
  }
  return {
    show: function (root, request, toast) {
      st.view = root; st.request = request; st.toast = toast;
      render();
      refresh();
      if (st.timer) clearInterval(st.timer);
      st.timer = setInterval(function () { if (!st.view || st.view.hidden || !st.view.isConnected) return; refresh(); }, ASK);
    },
    live: function () { if (st.view && !st.view.hidden) refresh(); }
  };
})();
window.OpsAlpha = OpsAlpha;
