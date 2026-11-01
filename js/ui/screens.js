/* Navigation between the screens (start, slot, tokens, rules, board) plus
   the token shop (buy / exchange) and the rules (pay table / rules). */
(function (BR) {
  'use strict';

  var U = BR.util, C = BR.CONFIG, S = BR.store.state;
  var $ = U.$, $$ = U.$$;
  var current = 'start';
  // the screen before this one, for the back button: one step back at most
  // (after going back there is nothing more to go back to but the usual way)
  var last = '', goingBack = false;
  var hooks = {};   // extra screens: { open, close, back }
  var watchers = []; // told about every screen change: fn(name, previous)

  /* ------------------------------------------------------------ navigation --- */
  var requestGeneration = 0;
  function request() { return ++requestGeneration; }
  function show(name) {
    var epoch = request();
    if (!BR.resources.ready(name)) {
      var job = name === 'slot' ? BR.resources.effects() : BR.resources.load(name);
      return BR.resources.wait(job).then(function () { if (epoch === requestGeneration) show(name); }, function (err) { if (epoch === requestGeneration) BR.kit.fail(err); });
    }
    if (name === current) return;
    // banned: the title screen only (js/ui/banlock.js)
    if (name !== 'start' && BR.banlock && BR.banlock.active()) return;
    var prev = current;
    current = name;
    last = goingBack ? '' : prev;
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); });
    $('#stage').dataset.screen = name;
    enter($('#screen-' + name));
    if (hooks[prev] && hooks[prev].close) hooks[prev].close();
    if (name === 'tokens') shop.open();
    if (name === 'rules') rules.open();
    if (hooks[name] && hooks[name].open) hooks[name].open();
    watchers.forEach(function (fn) { fn(name, prev); });
  }

  // Lists in a screen or pane that just opened come in one row after another
  // (css/juice.css); only for a moment, so later updates do not replay it.
  // A tab shows the list it remembers and then the fresh one from the server:
  // rows put in again meanwhile carry on from where the first ones were
  // (--jc-skip) instead of coming in a second time. Rows that come after
  // 読み込み中 are the first ones and come in then.
  var ROWS = '.fr-row, .conv-row, .q-row, .shop-card, .car-card, .news-entry, .job-card, .more-card, .rule-list li, .pay-card, .garage-card, .items-card';
  var ENTER_MS = 1100;
  function enter(node) {
    if (!node) return;
    clearTimeout(node.jcEnter);
    if (node.jcWatch) node.jcWatch.disconnect();
    node.style.removeProperty('--jc-skip');
    node.classList.add('jc-enter');
    var t0 = U.now(), had = null;
    function done() {
      node.classList.remove('jc-enter');
      node.style.removeProperty('--jc-skip');
      if (node.jcWatch) { node.jcWatch.disconnect(); node.jcWatch = null; }
    }
    // rows put in by the same tap belong to the first list
    setTimeout(function () { had = !!node.querySelector(ROWS); }, 0);
    if (window.MutationObserver) {
      node.jcWatch = new MutationObserver(function (changes) {
        if (had === null) return;
        var rows = changes.some(function (c) {
          return Array.prototype.some.call(c.addedNodes, function (n) { return n.nodeType === 1 && (n.matches(ROWS) || !!n.querySelector(ROWS)); });
        });
        if (!rows) return;
        if (!had) {
          had = true;
          t0 = U.now();
          clearTimeout(node.jcEnter);
          node.jcEnter = setTimeout(done, ENTER_MS);
          return;
        }
        node.style.setProperty('--jc-skip', ((U.now() - t0) / 1000).toFixed(3) + 's');
      });
      node.jcWatch.observe(node, { childList: true, subtree: true });
    }
    node.jcEnter = setTimeout(done, ENTER_MS);
  }

  // The back button: a screen may step back inside itself first; then the
  // screen one came from (once: one step back at most), else as before (the
  // slot to the start screen, any other to the slot).
  function back() {
    var h = hooks[current];
    if (h && h.back && h.back()) return true;
    if (current === 'start') return false;
    var to = last && last !== current ? last : current === 'slot' ? 'start' : 'slot';
    goingBack = true;
    try { show(to); } finally { goingBack = false; }
    // (a screen that could not be shown, e.g. banned: nothing to go back to)
    if (current !== to) last = '';
    return true;
  }

  function tabs(root, onChange) {
    var btns = $$('.tab', root);
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('active')) return;
        btns.forEach(function (x) { x.classList.toggle('active', x === b); });
        BR.sfx.play('click');
        enter(root);
        onChange(b.dataset.tab);
      });
    });
    return {
      set: function (tab) { btns.forEach(function (x) { x.classList.toggle('active', x.dataset.tab === tab); }); }
    };
  }

  /* ------------------------------------------------------------ token shop --- */
  var NICE = [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000];

  var shop = {
    mode: 'buy',
    value: 0,      // spin tokens being bought / exchanged
    init: function () {
      var self = this;
      this.tabs = tabs($('#screen-tokens'), function (t) { self.mode = t; self.value = 0; self.render(); });
      var track = $('#tp-track');
      var dragging = false;
      function setFromX(clientX) {
        var r = track.getBoundingClientRect();
        var horizontal = !BR.app.view.portrait;
        var p = horizontal ? (clientX.x - r.left) / r.width : (clientX.y - r.top) / r.height;
        p = U.clamp(p, 0, 1);
        self.setValue(self.fromSlider(p), true);
      }
      track.addEventListener('pointerdown', function (e) {
        dragging = true;
        track.setPointerCapture(e.pointerId);
        setFromX({ x: e.clientX, y: e.clientY });
      });
      track.addEventListener('pointermove', function (e) { if (dragging) setFromX({ x: e.clientX, y: e.clientY }); });
      ['pointerup', 'pointercancel'].forEach(function (ev) { track.addEventListener(ev, function () { dragging = false; }); });
      $('#tp-minus').addEventListener('click', function () { self.step(-1); });
      $('#tp-plus').addEventListener('click', function () { self.step(1); });
      $('#tp-action').addEventListener('click', function () { self.commit(); });
      $('#tp-input-a').addEventListener('click', function () { self.numpad('a'); });
      $('#tp-input-b').addEventListener('click', function () { self.numpad('b'); });
      $('#daily-btn').addEventListener('click', function () { self.claimDaily(); });
      BR.clock.every(function () { if (current === 'tokens') self.renderDaily(); }, 1000);
    },
    open: function () {
      var self = this;
      this.mode = 'buy';
      this.tabs.set('buy');
      this.value = 0;
      this.render();
      // pick up today's counters and any money received meanwhile
      BR.bank.refresh().then(function () { BR.app.renderWallet(false); self.setValue(self.value); }, function () {});
    },
    max: function () {
      return this.mode === 'buy' ? BR.bank.maxBuy() : Math.max(0, S.tokens);
    },
    // slider position <-> value (quadratic so small amounts are easy to pick)
    fromSlider: function (p) {
      var m = this.max();
      if (m <= 0) return 0;
      var v = m * p * p;
      if (p >= 0.999) return m;
      var mag = v >= 100000 ? 1000 : v >= 10000 ? 100 : v >= 1000 ? 10 : 1;
      return Math.min(m, Math.round(v / mag) * mag);
    },
    toSlider: function (v) {
      var m = this.max();
      return m > 0 ? Math.sqrt(U.clamp(v / m, 0, 1)) : 0;
    },
    setValue: function (v, fromDrag) {
      var nv = U.clamp(Math.floor(v), 0, this.max());
      if (nv !== this.value && fromDrag) BR.sfx.play('slider');
      this.value = nv;
      this.render();
    },
    step: function (dir) {
      var m = this.max(), v = this.value, nv = v;
      if (dir > 0) {
        nv = m;
        for (var i = 0; i < NICE.length; i++) if (NICE[i] > v) { nv = Math.min(m, NICE[i]); break; }
      } else {
        nv = 0;
        for (var j = NICE.length - 1; j >= 0; j--) if (NICE[j] < v) { nv = NICE[j]; break; }
        if (v > NICE[NICE.length - 1]) nv = NICE[NICE.length - 1];
      }
      BR.sfx.play(dir > 0 ? 'betUp' : 'betDown');
      this.setValue(nv);
    },
    render: function () {
      var buy = this.mode === 'buy';
      var v = this.value, m = this.max();
      $('#tp-title').textContent = buy ? 'スピントークンを入手' : 'スピントークンを交換';
      $('#tp-label-a').textContent = buy ? '獲得:' : '交換:';
      $('#tp-label-b').textContent = buy ? '交換:' : '獲得:';
      $('#tp-val-a').textContent = v > 0 ? U.fmt(v) : '-';
      // (changing back: Dtrade's exchange fee comes off what it brings)
      var xfee = BR.bank.exchangeFee ? BR.bank.exchangeFee() : C.casino.exchangeFee;
      var got = buy ? v * C.tokenPrice : v * C.tokenPrice - xfee;
      $('#tp-val-b').textContent = v > 0 ? (got > 0 ? U.fmt(got) : '0') : '-';
      var p = this.toSlider(v);
      $('#tp-fill').style.width = (p * 100) + '%';
      $('#tp-thumb').style.left = 'calc((100% - 52px) * ' + p.toFixed(4) + ')';
      $('#tp-minus').disabled = v <= 0;
      $('#tp-plus').disabled = v >= m;
      var act = $('#tp-action');
      act.textContent = buy ? '入手' : '交換';
      act.disabled = v <= 0 || this.busy || (!buy && got <= 0);
      $('#tp-note').textContent = buy
        ? 'スピントークン上限は毎日00:00 UTCに更新されます'
        : '1スピントークン = ' + C.tokenPrice + '$・交換手数料 $' + U.fmt(xfee) + '（Dtrade' + (xfee > C.casino.exchangeFee ? '・総資産$' + U.fmt(C.wealthy.at) + '以上' : '') + '）';
      this.renderDaily();
    },
    commit: function () {
      var self = this, v = this.value, buy = this.mode === 'buy';
      if (v <= 0 || this.busy) return;
      this.busy = true;
      this.render();
      (buy ? BR.bank.buy(v) : BR.bank.sell(v)).then(function () {
        BR.app.toast(U.fmt(v) + (buy ? ' スピントークンを入手しました' : ' スピントークンを交換しました'));
        // tokens bought at the till; tokens changed back: the $ come in
        BR.sfx.play(buy ? 'register' : 'money');
        if (BR.juice) BR.juice.reward('#tp-action', 2);
        BR.app.renderWallet(true);
        BR.app.renderBet();
        self.value = 0;
      }, function (err) {
        BR.sfx.play('deny');
        BR.app.toast(err.message);
      }).then(function () {
        self.busy = false;
        self.render();
      });
    },
    numpad: function (which) {
      var self = this;
      var buy = this.mode === 'buy';
      // field a shows tokens (buy) / tokens (sell); field b shows dollars
      var isDollar = which === 'b';
      openNumpad({
        icon: isDollar ? 'dollar' : 'chip',
        value: isDollar ? this.value * C.tokenPrice : this.value,
        max: isDollar ? this.max() * C.tokenPrice : this.max(),
        onOk: function (n) { self.setValue(isDollar ? Math.floor(n / C.tokenPrice) : n); }
      });
      void buy;
    },
    renderDaily: function () {
      var btn = $('#daily-btn'), label = $('#daily-label');
      var ready = BR.bank.dailyReady();
      btn.classList.toggle('ready', ready);
      if (ready) {
        label.textContent = '受け取る';
      } else {
        var s = BR.bank.secondsToReset();
        var h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
        label.textContent = h > 0 ? h + '時間' + mi + '分' : mi + '分' + se + '秒';
      }
    },
    claimDaily: function () {
      var self = this;
      if (!BR.bank.dailyReady()) { BR.sfx.play('deny'); BR.app.toast('次の無料トークンまでお待ちください'); return; }
      if (this.claiming) return;
      this.claiming = true;
      BR.bank.claimDaily().then(function (amount) {
        BR.sfx.play('money');
        if (BR.juice) BR.juice.reward('#daily-btn', 2);
        BR.app.renderWallet(true);
        BR.app.renderBet();
        BR.app.toast(U.fmt(amount) + ' 無料スピントークンを受け取りました！');
      }, function (err) {
        BR.sfx.play('deny');
        BR.app.toast(err.message);
      }).then(function () {
        self.claiming = false;
        self.render();
      });
    }
  };

  /* ------------------------------------------------------------ numpad --- */
  var np = { el: null, value: '0', opts: null, fresh: true };
  function openNumpad(opts) {
    np.opts = opts;
    np.fresh = true;          // the first digit replaces the prefilled value
    np.value = String(opts.value || 0);
    $('#np-icon').className = 'ic ic-' + opts.icon;
    renderNumpad();
    $('#numpad').hidden = false;
  }
  function renderNumpad() { $('#np-value').textContent = U.fmt(Number(np.value)); }
  function initNumpad() {
    $('#numpad').addEventListener('click', function (e) {
      if (e.target.id === 'numpad') { $('#numpad').hidden = true; return; }
      var b = e.target.closest('button');
      if (!b) return;
      BR.sfx.play('click');
      var k = b.dataset.k || b.textContent.trim();
      if (k === 'cancel') { $('#numpad').hidden = true; return; }
      if (k === 'ok') { $('#numpad').hidden = true; np.opts.onOk(Math.min(Number(np.value), np.opts.max)); return; }
      if (k === 'del') np.value = np.value.length > 1 && !np.fresh ? np.value.slice(0, -1) : '0';
      else if (k === 'max') np.value = String(np.opts.max);
      else if (/^\d$/.test(k)) np.value = (np.value === '0' || np.fresh ? '' : np.value) + k;
      np.fresh = false;
      if (Number(np.value) > np.opts.max) np.value = String(np.opts.max);
      renderNumpad();
    });
  }

  /* ------------------------------------------------------------ rules --- */
  var rules = {
    built: false,
    init: function () {
      tabs($('#screen-rules'), function (t) {
        $('#pane-combos').classList.toggle('active', t === 'combos');
      });
    },
    open: function () {
      if (this.built) return;
      this.built = true;
      var grid = document.createElement('div');
      grid.className = 'pay-grid';
      var pos = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
      C.symbols.forEach(function (sym, i) {
        var card = document.createElement('div');
        card.className = 'pay-card';
        card.style.left = (pos[i][0] * 507) + 'px';
        card.style.top = (pos[i][1] * 223) + 'px';
        var pays = C.pays[sym];
        var counts = Object.keys(pays).map(Number).sort(function (a, b) { return a - b; });
        var prob = Math.round(C.weights[sym] * 1000) / 10;
        // 友達と稼ぐ (a hub) has odds of its own: up or down
        var hub = Math.round(C.hub.weights[sym] * 1000) / 10;
        var hubTag = hub === prob ? '' : '<div class="pc-hub ' + (hub > prob ? 'up' : 'down') + '">友達と稼ぐ <b>' + hub + '%</b>' + (hub > prob ? '▲' : '▼') + '</div>';
        card.innerHTML =
          '<div class="pc-img"><img alt="" src="' + BR.SYMBOL_IMG[sym] + '"></div>' + hubTag +
          '<div class="pc-prob">確率: <b>' + prob + '%</b></div>' +
          '<div class="pc-counts">' + counts.map(function (c) { return '<div>' + c + '/5</div>'; }).join('') + '</div>' +
          '<div class="pc-div"></div>' +
          '<div class="pc-mults">' + counts.map(function (c) {
            return '<div><i class="ic ic-chip"></i>x' + U.fmtMult(pays[c]) + '</div>';
          }).join('') + '</div>';
        grid.appendChild(card);
      });
      $('#pane-combos').appendChild(grid);
    }
  };

  BR.screens = {
    init: function () { shop.init(); rules.init(); initNumpad(); },
    show: show,
    // Optional controllers reserve their selection before their download starts.
    request: request,
    isLatest: function (epoch) { return epoch === requestGeneration; },
    back: back,
    current: function () { return current; },
    register: function (name, h) { hooks[name] = h; },
    onChange: function (fn) { watchers.push(fn); },
    tabs: tabs,
    enter: enter,
    numpad: openNumpad
  };
})(window.BR = window.BR || {});
