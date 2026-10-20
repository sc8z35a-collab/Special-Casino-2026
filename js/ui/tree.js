/* 金の生る木: the player's trees, a tab each. Money is given with one tap (the
   amount picked from RULES.tree.amounts): every bit raises the $ a second the
   tree earns, and at set totals it grows into its next look (the nine
   pictures in img/tree). A harvest time is picked once (30分 x1.0 … 1週間
   x1.6); the money grows until then, cannot be harvested before, and the same
   time (or another) starts again with the harvest. More trees come from the
   auctions (the last tab): bidding against NPC buyers, leaving whenever, and
   only a tree won shows whether it is SUPER (its harvests x1.1 forever).
   The server decides everything (server/core/tree.js); this shows it and
   counts the money growing between its answers. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api, TR = BR.TREE, R = BR.TREE.rules;
  var IMG = BR.SOCIAL_IMG.tree;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var AMOUNT = 'blockbuster-reels/tree-amount';
  var POLL = 500;          // a running auction is looked at this often
  var TAPS = 5;            // one-tap gifts waiting their turn at most

  var trees = null;        // from the server; each with `at`: the server time it is for
  var offset = 0;          // server time - local time
  var tab = null;          // the tree shown (its id) or 'auction'
  var auction = null;      // the auction I am in, or the last one
  var watched = 0;         // the auction seen running here (its end is shown once)
  var ended = null;        // that end, until it is put away
  var amount = R.amounts[1];
  var pending = 0, giving = false, busy = false;
  var ticker = 0, poller = 0, badgeTimer = 0, loading = null, bidding = false;
  var harvestNext = null;  // the time picked for after the harvest
  var liveId = 0;          // the auction the live view on screen was built for

  try {
    var saved = Number(localStorage.getItem(AMOUNT));
    if (R.amounts.indexOf(saved) >= 0) amount = saved;
  } catch (e) { /* the default amount */ }

  function now() { return Date.now() + offset; }
  function shown() { return BR.screens.current() === 'tree'; }
  function money(n) { return '$' + U.fmt(Math.floor(n)); }
  function treeOf(id) {
    for (var i = 0; trees && i < trees.length; i++) if (trees[i].id === id) return trees[i];
    return null;
  }
  function cycleName(id) { var c = TR.cycleOf(id); return c ? c.name : ''; }
  function multText(m) { return '×' + (Math.round(m * 100) / 100); }
  function boost(t) { return t.super ? R.superMult : 1; }

  /* ------------------------------------------------------------ the money growing --- */
  // what the tree has grown by `at` (server time): nothing more once the time is up
  function grown(t, at) {
    if (!t.cycle) return t.grown;
    return t.grown + Math.max(0, Math.min(at, t.cycle.end) - t.at) / 1000 * t.rate;
  }
  function value(t, at) { return Math.floor(grown(t, at) * (t.cycle ? t.cycle.mult : 1) * boost(t)); }
  function expected(t) { return t.cycle ? value(t, t.cycle.end) : 0; }
  function ready(t, at) { return !!t.cycle && at >= t.cycle.end; }
  // what one cycle pays at today's rate
  function estimate(t, c) { return Math.floor(t.rate * c.ms / 1000 * c.mult * boost(t)); }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var hms = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
    return d ? d + '日 ' + hms : hms;
  }

  /* ------------------------------------------------------------ state --- */
  function set(r) {
    offset = r.now - Date.now();
    trees = r.trees;
    if ('auction' in r) setAuction(r.auction);
    if (tab !== 'auction' && !treeOf(tab)) tab = trees.length ? trees[0].id : 'auction';
    renderBadge();
    if (shown()) render();
  }
  function load() {
    if (loading) return loading;
    loading = api.trees().then(function (r) { loading = null; set(r); return r; },
      function (err) { loading = null; throw err; });
    return loading;
  }
  function replace(t) {
    for (var i = 0; trees && i < trees.length; i++) if (trees[i].id === t.id) trees[i] = t;
    renderBadge();
  }

  // the round button: how many trees can be harvested (and a timer for the next)
  function renderBadge() {
    clearTimeout(badgeTimer);
    if (!trees) { K.badge($('#tree-badge'), 0); return; }
    var at = now(), n = 0, next = Infinity;
    trees.forEach(function (t) {
      if (ready(t, at)) n++;
      else if (t.cycle) next = Math.min(next, t.cycle.end);
    });
    K.badge($('#tree-badge'), n);
    if (next < Infinity) badgeTimer = setTimeout(renderBadge, Math.min(2147483000, next - at + 300));
  }

  /* ------------------------------------------------------------ the screen --- */
  function open() {
    if (!api.online) { sfx('deny'); toast('金の生る木はオンライン版で遊べます'); return; }
    BR.account.require(function () {
      if (!BR.bank.ready()) { toast('サーバーに接続しています…'); return; }
      BR.screens.show('tree');
    });
  }
  function onShow() {
    render();
    load().catch(function (err) { if (!trees) renderNote(err.message); });
    api.auction().then(function (r) { setAuction(r.auction, true); if (shown()) render(); }, function () {});
    clearInterval(ticker);
    ticker = setInterval(tick, 250);
  }
  function onHide() {
    clearInterval(ticker);
    // a running auction goes on without the screen: its end shows when it is opened again
    stopPolling();
  }

  function renderNote(text) {
    $('#tree-pane').classList.remove('active');
    var pane = $('#auction-pane');
    pane.classList.add('active');
    pane.textContent = '';
    pane.appendChild(el('div', 'empty', text));
  }

  function select(next) {
    if (next === tab) return;
    tab = next;
    harvestNext = null;
    render();
    BR.screens.enter($(tab === 'auction' ? '#auction-pane' : '#tree-pane'));
    if (tab === 'auction') api.auction().then(function (r) { setAuction(r.auction, true); if (tab === 'auction') renderAuction(); }, function () {});
  }

  function render() {
    renderTabs();
    var onTree = tab !== 'auction' && !!treeOf(tab);
    $('#tree-pane').classList.toggle('active', onTree);
    $('#auction-pane').classList.toggle('active', !onTree);
    if (onTree) renderTree();
    else renderAuction();
  }

  function renderTabs() {
    var box = $('#tree-tabs');
    box.textContent = '';
    var at = now();
    (trees || []).forEach(function (t) {
      var b = el('button', 'tab tr-tab' + (tab === t.id ? ' active' : '') + (t.super ? ' super' : ''));
      b.type = 'button';
      b.dataset.tab = String(t.id);
      var pic = el('i', 'tr-tab-pic');
      pic.style.backgroundImage = 'url("' + IMG.stages[t.stage - 1] + '")';
      b.appendChild(pic);
      b.appendChild(el('span', 'uname', t.name));
      if (ready(t, at)) b.appendChild(el('b', 'tab-dot'));
      box.appendChild(b);
    });
    var more = el('button', 'tab tr-tab tr-more' + (tab === 'auction' ? ' active' : ''));
    more.type = 'button';
    more.dataset.tab = 'auction';
    more.appendChild(el('span', '', '＋ 木を増やす'));
    if (auction && auction.status === 'live') more.appendChild(el('b', 'tr-live', 'LIVE'));
    box.appendChild(more);
    box.appendChild(el('div', 'tabs-info tr-count', (trees ? trees.length : 0) + ' / ' + R.max + '本'));
  }

  /* ------------------------------------------------------------ one tree --- */
  function renderTree() {
    var t = treeOf(tab);
    var art = $('#tr-art');
    var src = IMG.stages[t.stage - 1];
    if (art.getAttribute('src') !== src) art.setAttribute('src', src);
    art.alt = t.name;
    $('#tr-name').textContent = t.name.replace(/^SUPER /, '');
    $('#tr-super').hidden = !t.super;
    $('#tr-super').textContent = 'SUPER ' + multText(R.superMult);
    // the look and the next one
    $('#tr-look').textContent = t.stage + ' / ' + TR.stages;
    var lo = R.stages[t.stage - 1], hi = t.next;
    $('#tr-look-bar').style.width = (hi ? U.clamp((t.given - lo) / (hi - lo), 0, 1) * 100 : 100) + '%';
    $('#tr-look-next').textContent = hi ? '次の姿まで あと ' + money(hi - t.given) : 'いちばん大きな姿です';
    // giving money
    $('#tr-rate').textContent = (Math.round(t.rate * 100) / 100).toFixed(2);
    $('#tr-given').textContent = U.fmt(t.given);
    var more = TR.rateOf(t.given + amount) - t.rate;
    $('#tr-rate-next').textContent = more > 0.0001
      ? 'ワンタップで 毎秒 +$' + (Math.round(more * 100) / 100).toFixed(2)
      : '毎秒の金額は最大です（見た目はまだ育ちます）';
    renderAmounts();
    renderGive();
    renderHarvest(t);
  }

  function renderAmounts() {
    var box = $('#tr-amounts');
    if (!box.firstChild) {
      R.amounts.forEach(function (a) {
        var b = el('button', 'tr-amount');
        b.type = 'button';
        b.dataset.amount = String(a);
        b.appendChild(K.icon('dollar'));
        b.appendChild(el('span', '', U.fmt(a)));
        box.appendChild(b);
      });
    }
    Array.prototype.forEach.call(box.children, function (b) { b.classList.toggle('on', Number(b.dataset.amount) === amount); });
  }
  function renderGive() {
    var b = $('#tr-give');
    if (!b.firstChild) {
      b.appendChild(K.icon('dollar'));
      b.appendChild(el('span', 'tr-give-text'));
      b.appendChild(el('small', 'tr-queue'));
    }
    b.querySelector('.tr-give-text').textContent = U.fmt(amount) + ' をあげる';
    var q = b.querySelector('.tr-queue');
    q.textContent = '+' + pending;
    q.hidden = !pending;
    b.classList.toggle('short', S.dollars < amount);
  }

  // one tap: one gift (taps while one is on its way wait their turn)
  function give() {
    var t = treeOf(tab);
    if (!t) return;
    if (S.dollars < amount * (pending + (giving ? 2 : 1))) { sfx('deny'); toast('$が足りません'); return; }
    if (pending >= TAPS) return;
    pending++;
    renderGive();
    if (!giving) giveNext(t.id);
  }
  function giveNext(id) {
    if (!pending) { giving = false; return; }
    giving = true;
    pending--;
    var before = treeOf(id), was = before ? before.stage : 0, a = amount;
    api.treeGive(id, a).then(function (r) {
      BR.app.serverBalance(r.balance);
      replace(r.tree);
      sfx('register');
      if (shown() && tab === id) {
        renderTree();
        renderTabs();
        coinsIn();
      }
      if (r.tree.stage > was) grewUp(r.tree);
      giveNext(id);
    }, function (err) {
      pending = 0;
      giving = false;
      if (shown() && tab === id) renderGive();
      fail(err);
    });
  }
  // coins drop into the tree
  function coinsIn() {
    var box = $('#tree-pane .tr-scene');
    for (var i = 0; i < 4; i++) {
      var c = el('i', 'tr-drop');
      c.style.left = (300 + Math.random() * 160) + 'px';
      c.style.animationDelay = (i * 0.07) + 's';
      box.appendChild(c);
      setTimeout(function (n) { n.remove(); }.bind(null, c), 1100);
    }
  }
  function grewUp(t) {
    sfx('levelUp');
    toast('木が育ちました！（見た目 ' + t.stage + ' / ' + TR.stages + '）', 3200);
    var art = $('#tr-art');
    art.classList.remove('grow');
    void art.offsetWidth;
    art.classList.add('grow');
    if (BR.juice) BR.juice.reward('#tr-art', 2);
  }

  /* ------------------------------------------------------------ the harvest --- */
  function cycleButton(t, c, cls, picked) {
    var b = el('button', 'tr-cycle' + (cls ? ' ' + cls : '') + (picked ? ' on' : ''));
    b.type = 'button';
    b.dataset.cycle = c.id;
    b.appendChild(el('b', 'tr-cycle-name', c.name));
    b.appendChild(el('span', 'tr-cycle-mult', multText(c.mult)));
    var est = el('small', 'tr-cycle-est');
    est.appendChild(document.createTextNode('見込み '));
    est.appendChild(K.amountEl(estimate(t, c), 'dollars'));
    b.appendChild(est);
    return b;
  }

  function renderHarvest(t) {
    var box = $('#tr-harvest');
    box.textContent = '';
    var at = now();
    box.dataset.state = !t.cycle ? 'pick' : ready(t, at) ? 'ready' : 'growing';
    var head = el('div', 'tr-card-head');
    box.appendChild(head);
    if (!t.cycle) {
      head.appendChild(el('h3', '', '収穫の時期を選ぶ'));
      box.appendChild(el('p', 'tr-note', t.given > 0
        ? '長く待つほど収穫が増えます。一度決めると、その時期まで変更も収穫もできません。'
        : 'お金をあげると、収穫の時期を選べるようになります。'));
      var row = el('div', 'tr-cycles');
      R.cycles.forEach(function (c) {
        var b = cycleButton(t, c, 'start');
        b.disabled = t.given <= 0 || busy;
        row.appendChild(b);
      });
      box.appendChild(row);
      return;
    }
    var c = TR.cycleOf(t.cycle.id);
    if (!ready(t, at)) {
      head.appendChild(el('h3', '', '育成中'));
      head.appendChild(el('span', 'tr-chip', c.name + ' ' + multText(c.mult) + (t.super ? ' ・ SUPER ' + multText(R.superMult) : '')));
      var time = el('div', 'tr-time');
      time.appendChild(el('small', '', '収穫まで あと'));
      time.appendChild(el('b', '', clock(t.cycle.end - at)));
      box.appendChild(time);
      var bar = el('div', 'tr-bar big');
      bar.appendChild(el('i'));
      box.appendChild(bar);
      var rows = el('div', 'tr-rows');
      rows.appendChild(rowOf('いま実っているお金', 'now'));
      rows.appendChild(rowOf('収穫時の見込み', 'end'));
      box.appendChild(rows);
      var wait = el('button', 'act-btn tr-harvest-btn', '収穫は ' + K.fmtTime(t.cycle.end - offset) + ' から');
      wait.type = 'button';
      wait.disabled = true;
      box.appendChild(wait);
      tickHarvest(t, at);
      return;
    }
    // ready: the money and the next time (the same one unless another is picked)
    head.appendChild(el('h3', 'tr-ready', '収穫できます！'));
    head.appendChild(el('span', 'tr-chip', c.name + ' ' + multText(c.mult) + (t.super ? ' ・ SUPER ' + multText(R.superMult) : '')));
    var got = el('div', 'tr-got');
    got.appendChild(K.amountEl(value(t, at), 'dollars', 'tr-got-amt'));
    box.appendChild(got);
    box.appendChild(el('p', 'tr-note', '収穫後は次の時期で育て直します:'));
    var pick = el('div', 'tr-cycles small');
    var next = harvestNext || t.cycle.id;
    R.cycles.forEach(function (x) { pick.appendChild(cycleButton(t, x, 'next', x.id === next)); });
    box.appendChild(pick);
    var go = el('button', 'act-btn gold tr-harvest-btn', '収穫する');
    go.type = 'button';
    go.dataset.act = 'harvest';
    go.disabled = busy;
    box.appendChild(go);
  }
  function rowOf(label, key) {
    var r = el('div', 'tr-row');
    r.appendChild(el('span', '', label));
    var v = K.amountEl(0, 'dollars');
    v.dataset.v = key;
    r.appendChild(v);
    return r;
  }
  function tickHarvest(t, at) {
    var box = $('#tr-harvest');
    var b = box.querySelector('.tr-time b');
    if (b) b.textContent = clock(t.cycle.end - at);
    var bar = box.querySelector('.tr-bar i');
    if (bar) bar.style.width = U.clamp((at - t.cycle.at) / (t.cycle.end - t.cycle.at), 0, 1) * 100 + '%';
    var n = box.querySelector('[data-v="now"] span');
    if (n) n.textContent = U.fmt(value(t, at));
    var e = box.querySelector('[data-v="end"] span');
    if (e) e.textContent = U.fmt(expected(t));
  }

  function tick() {
    if (!shown() || !trees) return;
    var at = now();
    if (tab !== 'auction') {
      var t = treeOf(tab);
      if (!t) return;
      var box = $('#tr-harvest');
      var state = !t.cycle ? 'pick' : ready(t, at) ? 'ready' : 'growing';
      if (box.dataset.state !== state) { renderHarvest(t); renderTabs(); renderBadge(); }
      else if (state === 'growing') tickHarvest(t, at);
      else if (state === 'ready') { var g = box.querySelector('.tr-got-amt span'); if (g) g.textContent = U.fmt(value(t, at)); }
      $('#tree-pane').classList.toggle('growing', state === 'growing');
    } else if (auction && auction.status === 'live') {
      tickAuction();
    }
  }

  function start(id) {
    var t = treeOf(tab), c = TR.cycleOf(id);
    if (!t || !c || busy) return;
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('「' + c.name + '」で育てますか？'));
      p.appendChild(el('small', 'confirm-sub', c.name + '後に ' + multText(c.mult) + ' で収穫（見込み $' + U.fmt(estimate(t, c)) + '）。その時期まで変更も収穫もできません。'));
    }, '育てる').then(function (ok) {
      if (!ok) return;
      busy = true;
      renderHarvest(t);
      api.treeStart(t.id, c.id).then(function (r) {
        busy = false;
        replace(r.tree);
        sfx('purchase');
        if (shown() && tab === t.id) { renderTree(); renderTabs(); }
        toast('「' + c.name + '」で育て始めました', 2600);
      }, function (err) {
        busy = false;
        if (shown() && tab === t.id) renderHarvest(t);
        fail(err);
        load().catch(function () {});
      });
    });
  }

  function harvest() {
    var t = treeOf(tab);
    if (!t || busy) return;
    var next = harvestNext || t.cycle.id;
    busy = true;
    renderHarvest(t);
    api.treeHarvest(t.id, next).then(function (r) {
      busy = false;
      harvestNext = null;
      BR.app.serverBalance(r.balance);
      replace(r.tree);
      sfx('money');
      if (BR.juice) BR.juice.reward('#tr-harvest .tr-harvest-btn', 3);
      toast('$' + U.fmt(r.paid) + ' を収穫しました！（次は「' + cycleName(next) + '」）', 3600);
      if (shown() && tab === t.id) { renderTree(); renderTabs(); }
    }, function (err) {
      busy = false;
      if (shown() && tab === t.id) renderHarvest(t);
      fail(err);
      load().catch(function () {});
    });
  }

  /* ------------------------------------------------------------ the auctions --- */
  // a new look at the auction; `quiet`: no sounds (just opened)
  function setAuction(a, quiet) {
    var was = auction;
    auction = a || null;
    if (!auction) return;
    auction.seen = Date.now();
    if (auction.status === 'live') {
      watched = auction.id;
      if (!quiet && was && was.id === auction.id && was.leader === 'me' && auction.leader !== 'me') sfx('notify');
      if (shown()) startPolling();
    } else if (auction.id === watched) {
      // it ended while it was watched here: show how, once
      watched = 0;
      ended = auction;
      stopPolling();
      if (!quiet || !was || was.status === 'live') endSound(auction);
      if (auction.status === 'won') load().catch(function () {});
    }
  }
  function endSound(a) {
    if (a.status === 'won') { sfx('levelUp'); setTimeout(function () { sfx('register'); }, 500); }
    else if (a.status === 'lost' || a.status === 'unpaid' || a.status === 'full') sfx('miss');
  }
  function startPolling() {
    if (poller) return;
    poller = setInterval(function () {
      if (!shown()) { stopPolling(); return; }
      if (bidding) return;
      api.auction().then(function (r) {
        var was = auction ? auction.status : '';
        if (r.balance) BR.app.serverBalance(r.balance);
        setAuction(r.auction);
        if (!shown()) return;
        if ((auction ? auction.status : '') !== was) renderTabs();
        if (tab === 'auction') renderAuction();
      }, function () {});
    }, POLL);
  }
  function stopPolling() { clearInterval(poller); poller = 0; }

  function renderAuction() {
    var pane = $('#auction-pane');
    if (auction && auction.status === 'live') {
      if (liveId !== auction.id || !pane.querySelector('.au-live')) {
        pane.textContent = '';
        pane.appendChild(liveView(auction));
        liveId = auction.id;
      }
      updateLive(auction);
      tickAuction();
      return;
    }
    liveId = 0;
    pane.textContent = '';
    pane.appendChild(marketsView());
    if (ended) pane.appendChild(resultView(ended));
  }

  function lotArt(a) {
    var pic = el('div', 'au-art');
    pic.style.backgroundImage = 'url("' + (a.market === 'seed' ? IMG.seed : IMG.stages[(a.lot.stage || 1) - 1]) + '")';
    return pic;
  }

  function marketsView() {
    var owned = trees ? trees.length : 1;
    var v = el('div', 'au-markets-view');
    var row = el('div', 'au-markets');
    ['seed', 'grown'].forEach(function (id) {
      var m = R.markets[id];
      var card = el('div', 'au-market');
      var pic = el('div', 'au-art');
      pic.style.backgroundImage = 'url("' + (id === 'seed' ? IMG.seed : IMG.stages[2]) + '")';
      card.appendChild(pic);
      var info = el('div', 'au-market-info');
      info.appendChild(el('h3', '', m.name));
      info.appendChild(el('p', 'au-desc', id === 'seed'
        ? '種から育てる新しい金の生る木。'
        : '少し育った金の生る木（見た目 2〜4）。'));
      var avg = el('div', 'au-avgs');
      [['2本目', m.second, owned <= 1], ['3本目以降', m.more, owned >= 2]].forEach(function (x) {
        var line = el('div', 'au-avg' + (x[2] ? ' now' : ''));
        line.appendChild(el('span', '', x[0] + 'の平均落札価格'));
        line.appendChild(K.amountEl(x[1], 'dollars'));
        avg.appendChild(line);
      });
      info.appendChild(avg);
      var b = el('button', 'act-btn gold au-join', '競りに参加する');
      b.type = 'button';
      b.dataset.market = id;
      b.disabled = owned >= R.max || busy;
      info.appendChild(b);
      card.appendChild(info);
      row.appendChild(card);
    });
    v.appendChild(row);
    var notes = el('ul', 'au-notes');
    [
      owned >= R.max ? '金の生る木は' + R.max + '本までです。' : 'いまの木は' + owned + '本。落札すると' + (owned + 1) + '本目になります（' + R.max + '本まで）。',
      '相手はNPCです。いつでも離脱でき、離脱すれば支払いはありません。',
      '落札価格は平均より安くも高くもなります。入札がないまま' + 6 + '秒たつと落札です。',
      'SUPERの木かどうかは落札するまでわかりません。SUPERなら収穫はずっと' + multText(R.superMult) + '！'
    ].forEach(function (s) { notes.appendChild(el('li', '', s)); });
    v.appendChild(notes);
    return v;
  }

  function liveView(a) {
    var v = el('div', 'au-live');
    // what is sold
    var lot = el('div', 'au-lot');
    lot.appendChild(lotArt(a));
    lot.appendChild(el('div', 'au-mystery', 'SUPER ？'));
    lot.appendChild(el('h3', 'au-lot-name', a.lot.name));
    lot.appendChild(el('p', 'au-lot-sub', R.markets[a.market].name + (a.market === 'grown' ? '・見た目 ' + a.lot.stage + ' / ' + TR.stages : '')));
    var avg = el('div', 'au-avg now');
    avg.appendChild(el('span', '', '平均落札価格'));
    avg.appendChild(K.amountEl(a.avg, 'dollars'));
    lot.appendChild(avg);
    v.appendChild(lot);
    // the price, who leads, the hammer, the buttons
    var mid = el('div', 'au-mid');
    mid.appendChild(el('small', 'au-label', '現在の価格'));
    mid.appendChild(K.amountEl(a.price, 'dollars', 'au-price'));
    mid.appendChild(el('div', 'au-leader'));
    var hammer = el('div', 'au-hammer');
    hammer.appendChild(el('i'));
    mid.appendChild(hammer);
    mid.appendChild(el('div', 'au-close'));
    var acts = el('div', 'au-acts');
    [1, 5].forEach(function (n) {
      var b = el('button', 'act-btn gold au-bid');
      b.type = 'button';
      b.dataset.steps = String(n);
      b.appendChild(el('small', '', n === 1 ? '入札' : '一気に入札'));
      b.appendChild(K.amountEl(0, 'dollars'));
      acts.appendChild(b);
    });
    mid.appendChild(acts);
    var leave = el('button', 'text-btn au-leave', '競りから離脱する');
    leave.type = 'button';
    mid.appendChild(leave);
    v.appendChild(mid);
    // the bidders and what they bid
    var side = el('div', 'au-side');
    side.appendChild(el('h4', '', '入札者'));
    var who = el('div', 'au-who');
    who.appendChild(el('span', 'au-me', 'あなた'));
    a.bidders.forEach(function (n) { var x = el('span', '', n); x.dataset.name = n; who.appendChild(x); });
    side.appendChild(who);
    side.appendChild(el('h4', '', '入札の記録'));
    side.appendChild(el('div', 'au-log'));
    v.appendChild(side);
    return v;
  }
  function updateLive(a) {
    var pane = $('#auction-pane');
    var mine = a.leader === 'me';
    pane.querySelector('.au-mid').classList.toggle('mine', mine);
    pane.querySelector('.au-price span').textContent = U.fmt(a.price);
    pane.querySelector('.au-leader').textContent = mine ? 'あなたが最高額です！' : a.leader ? '最高額: ' + a.leader : 'まだ入札はありません';
    Array.prototype.forEach.call(pane.querySelectorAll('.au-bid'), function (b) {
      var price = a.price + Number(b.dataset.steps) * a.step;
      b.querySelector('.amt span').textContent = U.fmt(price);
      b.disabled = mine || bidding || S.dollars < price;
    });
    pane.querySelector('.au-me').classList.toggle('lead', mine);
    Array.prototype.forEach.call(pane.querySelectorAll('.au-who [data-name]'), function (x) { x.classList.toggle('lead', x.dataset.name === a.leader); });
    var log = pane.querySelector('.au-log');
    log.textContent = '';
    a.bids.slice().reverse().forEach(function (b, i) {
      var line = el('div', 'au-bid-line' + (b.who === 'me' ? ' mine' : '') + (i === 0 ? ' top' : ''));
      line.appendChild(el('span', 'uname', b.who === 'me' ? 'あなた' : b.who));
      line.appendChild(K.amountEl(b.price, 'dollars'));
      log.appendChild(line);
    });
    if (!a.bids.length) log.appendChild(el('div', 'au-empty', 'まもなく競りが始まります…'));
  }
  // the hammer counts down between looks
  function tickAuction() {
    var a = auction;
    var bar = $('#auction-pane .au-hammer i'), text = $('#auction-pane .au-close');
    if (!a || !bar) return;
    var left = Math.max(0, a.closeIn - (Date.now() - a.seen));
    bar.style.width = U.clamp(left / a.closeMs, 0, 1) * 100 + '%';
    bar.parentNode.classList.toggle('soon', left < 2500);
    var s = (Math.ceil(left / 100) / 10).toFixed(1);
    text.textContent = !a.bids.length ? '入札者が集まっています…'
      : a.leader === 'me' ? 'このまま ' + s + '秒 入札がなければ、あなたが落札！'
      : '入札がなければ ' + s + '秒 で ' + a.leader + ' が落札';
  }

  function resultView(a) {
    var box = el('div', 'au-result ' + a.status + (a.status === 'won' && a.lot.super ? ' super' : ''));
    var card = el('div', 'au-result-card');
    var title = { won: '落札しました！', lost: '落札できませんでした', left: '競りから離脱しました', unpaid: '落札できませんでした', full: '落札できませんでした' }[a.status] || '競りは終わりました';
    card.appendChild(el('h3', '', title));
    if (a.status === 'won' && a.tree) {
      var pic = el('div', 'au-art');
      pic.style.backgroundImage = 'url("' + IMG.stages[a.tree.stage - 1] + '")';
      card.appendChild(pic);
      if (a.lot.super) card.appendChild(el('div', 'au-super', 'SUPER'));
      card.appendChild(el('b', 'au-result-name uname', a.tree.name));
      card.appendChild(el('p', '', a.lot.super ? 'SUPERの木です！この木の収穫はずっと' + multText(R.superMult) + 'になります。' : (trees ? trees.length : '') + '本目の金の生る木として植えました。'));
      var paid = el('p', 'au-paid');
      paid.appendChild(document.createTextNode('支払い '));
      paid.appendChild(K.amountEl(a.price, 'dollars'));
      card.appendChild(paid);
    } else if (a.status === 'lost') {
      var p = el('p', '');
      p.appendChild(document.createTextNode((a.winner || 'ほかの入札者') + 'が '));
      p.appendChild(K.amountEl(a.price, 'dollars'));
      p.appendChild(document.createTextNode(' で落札しました。'));
      card.appendChild(p);
    } else if (a.status === 'left') {
      card.appendChild(el('p', '', '支払いはありません。また参加できます。'));
    } else if (a.status === 'unpaid') {
      card.appendChild(el('p', '', '$が足りなかったため、落札は取り消されました。'));
    } else if (a.status === 'full') {
      card.appendChild(el('p', '', '金の生る木は' + R.max + '本までのため、植えられませんでした。'));
    }
    var ok = el('button', 'act-btn gold au-ok', a.status === 'won' && a.tree ? 'この木を見る' : 'OK');
    ok.type = 'button';
    ok.dataset.tree = a.status === 'won' && a.tree ? String(a.tree.id) : '';
    card.appendChild(ok);
    box.appendChild(card);
    return box;
  }

  function join(market) {
    if (busy) return;
    busy = true;
    ended = null;
    api.auctionStart(market).then(function (r) {
      busy = false;
      setAuction(r.auction, true);
      sfx('chance');
      if (shown()) { renderTabs(); renderAuction(); }
    }, function (err) {
      busy = false;
      fail(err);
      api.auction().then(function (r) { setAuction(r.auction, true); if (shown()) render(); }, function () {});
    });
  }
  function bid(steps) {
    if (bidding || !auction || auction.status !== 'live') return;
    bidding = true;
    updateLive(auction);
    api.auctionBid(steps).then(function (r) {
      bidding = false;
      if (r.balance) BR.app.serverBalance(r.balance);
      setAuction(r.auction, true);
      sfx('betUp');
      if (shown() && tab === 'auction') { renderTabs(); renderAuction(); }
    }, function (err) {
      bidding = false;
      if (auction && shown() && tab === 'auction') renderAuction();
      fail(err);
    });
  }
  function leave() {
    if (!auction || auction.status !== 'live') return;
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('競りから離脱しますか？'));
      p.appendChild(el('small', 'confirm-sub', '支払いはありません。この競りには戻れません。'));
    }, '離脱する').then(function (ok) {
      if (!ok) return;
      api.auctionLeave().then(function (r) {
        setAuction(r.auction, true);
        if (shown()) { renderTabs(); renderAuction(); }
      }, fail);
    });
  }
  /* ------------------------------------------------------------ init --- */
  function init() {
    $('#tree-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.tab');
      if (!b || b.classList.contains('active')) return;
      sfx('click');
      select(b.dataset.tab === 'auction' ? 'auction' : Number(b.dataset.tab));
    });
    $('#tr-amounts').addEventListener('click', function (e) {
      var b = e.target.closest('.tr-amount');
      if (!b) return;
      sfx('click');
      amount = Number(b.dataset.amount);
      try { localStorage.setItem(AMOUNT, String(amount)); } catch (err) { /* only for now */ }
      if (treeOf(tab)) renderTree();
    });
    $('#tr-give').addEventListener('click', give);
    $('#tr-harvest').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.classList.contains('start')) { sfx('click'); start(b.dataset.cycle); return; }
      if (b.classList.contains('next')) { sfx('click'); harvestNext = b.dataset.cycle; renderHarvest(treeOf(tab)); return; }
      if (b.dataset.act === 'harvest') harvest();
    });
    $('#auction-pane').addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.classList.contains('au-join')) { sfx('click'); join(b.dataset.market); return; }
      if (b.classList.contains('au-bid')) { bid(Number(b.dataset.steps)); return; }
      if (b.classList.contains('au-leave')) { sfx('click'); leave(); return; }
      if (b.classList.contains('au-ok')) {
        sfx('click');
        var id = Number(b.dataset.tree);
        ended = null;
        if (id) load().then(function () { select(id); }, function () { renderAuction(); });
        else renderAuction();
      }
    });
    BR.screens.register('tree', { open: onShow, close: onHide });
    if (!api.online) return;
    // signed in: how many trees can be harvested shows on the round button
    BR.live.on('hello', function () { load().catch(function () {}); });
  }

  BR.tree = {
    init: init,
    open: open,
    // signed out: nothing to show until the next player
    reset: function () { trees = null; auction = null; ended = null; watched = 0; tab = null; stopPolling(); renderBadge(); }
  };
})(window.BR = window.BR || {});
