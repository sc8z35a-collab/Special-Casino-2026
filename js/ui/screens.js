/* Secondary screens: token shop (buy / exchange) and rules (pay table / rules). */
(function (BR) {
  'use strict';

  var U = BR.util, C = BR.CONFIG, S = BR.store.state;
  var $ = U.$, $$ = U.$$;
  var current = 'slot';

  /* ------------------------------------------------------------ navigation --- */
  function show(name) {
    if (name === current) return;
    if (name !== 'slot' && BR.game && BR.game.auto) BR.app.setAuto(false);
    current = name;
    $$('.screen').forEach(function (s) { s.classList.toggle('active', s.id === 'screen-' + name); });
    if (name === 'tokens') shop.open();
    if (name === 'rules') rules.open();
  }

  function tabs(root, onChange) {
    var btns = $$('.tab', root);
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('active')) return;
        btns.forEach(function (x) { x.classList.toggle('active', x === b); });
        BR.sfx.play('click');
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
      setInterval(function () { if (current === 'tokens') self.renderDaily(); }, 1000);
    },
    open: function () {
      this.mode = 'buy';
      this.tabs.set('buy');
      this.value = 0;
      BR.store.dayRoll();
      this.render();
      drawPile();
    },
    max: function () {
      if (this.mode === 'buy') {
        BR.store.dayRoll();
        return Math.max(0, Math.min(Math.floor(S.dollars / C.tokenPrice), C.dailyLimit - S.boughtToday));
      }
      return Math.max(0, S.tokens);
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
      $('#tp-val-b').textContent = v > 0 ? U.fmt(v * C.tokenPrice) : '-';
      var p = this.toSlider(v);
      $('#tp-fill').style.width = (p * 100) + '%';
      $('#tp-thumb').style.left = 'calc((100% - 52px) * ' + p.toFixed(4) + ')';
      $('#tp-minus').disabled = v <= 0;
      $('#tp-plus').disabled = v >= m;
      var act = $('#tp-action');
      act.textContent = buy ? '入手' : '交換';
      act.disabled = v <= 0;
      $('#tp-note').textContent = buy
        ? 'スピントークン上限は毎日00:00 UTCに更新されます'
        : '1スピントークン = ' + C.tokenPrice + '$ で交換されます';
      this.renderDaily();
    },
    commit: function () {
      var v = this.value;
      if (v <= 0) return;
      if (this.mode === 'buy') {
        BR.store.dayRoll();
        if (v > this.max()) { BR.app.toast('上限を超えています'); return; }
        S.dollars -= v * C.tokenPrice;
        S.tokens += v;
        S.boughtToday += v;
        BR.app.toast(U.fmt(v) + ' スピントークンを入手しました');
      } else {
        if (v > S.tokens) return;
        S.tokens -= v;
        S.dollars += v * C.tokenPrice;
        BR.app.toast(U.fmt(v) + ' スピントークンを交換しました');
      }
      BR.store.save();
      BR.sfx.play('purchase');
      BR.app.renderWallet(true);
      BR.app.renderBet();
      this.value = 0;
      this.render();
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
      var ready = S.freeDay !== U.utcDay();
      btn.classList.toggle('ready', ready);
      if (ready) {
        label.textContent = '受け取る';
      } else {
        var s = U.secondsToUtcMidnight();
        var h = Math.floor(s / 3600), mi = Math.floor((s % 3600) / 60), se = s % 60;
        label.textContent = h > 0 ? h + '時間' + mi + '分' : mi + '分' + se + '秒';
      }
    },
    claimDaily: function () {
      if (S.freeDay === U.utcDay()) { BR.sfx.play('deny'); BR.app.toast('次の無料トークンまでお待ちください'); return; }
      S.freeDay = U.utcDay();
      S.tokens += C.dailyFree;
      BR.store.save();
      BR.sfx.play('purchase');
      BR.app.renderWallet(true);
      BR.app.renderBet();
      BR.app.toast(U.fmt(C.dailyFree) + ' 無料スピントークンを受け取りました！');
      this.render();
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

  /* ------------------------------------------------------------ chip pile --- */
  var pileDrawn = 0;
  function drawPile() {
    var cv = $('#chip-pile');
    var res = BR.app.view.res;
    if (pileDrawn === res) return;
    pileDrawn = res;
    var W = 300, H = 140;
    cv.width = Math.round(W * res);
    cv.height = Math.round(H * res);
    BR.assets.rasterize(BR.chipSVG('pile'), 120 * Math.max(1, res), 120 * Math.max(1, res)).then(function (face) {
      var g = cv.getContext('2d');
      g.setTransform(res, 0, 0, res, 0, 0);
      g.clearRect(0, 0, W, H);
      // stacks: [cx, bottomY, r, count] - layout follows the reference pile
      var stacks = [[46, 136, 32, 10], [256, 138, 27, 5], [156, 120, 28, 3], [214, 134, 27, 2]];
      stacks.forEach(function (s) { stack(g, face, s[0], s[1], s[2], s[3]); });
      // leaning / standing chips
      var D = BR.fxSprites.drawChip;
      D(g, face, 102, 50, 38, 0.5, -0.12, 0.86, 0.4, 1);
      D(g, face, 196, 92, 31, 0.1, -0.6, 0.79, 1.1, 1);
      D(g, face, 62, 120, 27, -0.06, -0.72, 0.69, 0.2, 1);
      D(g, face, 132, 116, 30, 0.06, -0.76, 0.64, 2.4, 1);
    });
  }

  function stack(g, face, cx, by, r, n) {
    var ry = r * 0.42, t = r * 0.2;
    for (var i = 0; i < n; i++) {
      var y = by - ry - i * t;
      var jitter = Math.sin(i * 2.3 + cx) * 1.6;
      var x = cx + jitter;
      // side band
      g.fillStyle = '#a3241a';
      g.beginPath();
      g.ellipse(x, y + t, r, ry, 0, 0, Math.PI);
      g.lineTo(x - r, y);
      g.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
      g.closePath();
      g.fill();
      // white inserts on the band
      g.fillStyle = '#ece6e4';
      for (var k = 0; k < 8; k++) {
        var a = (k / 8) * Math.PI * 2 + i * 0.7;
        var c = Math.cos(a), s = Math.sin(a);
        if (s < 0.05) continue;
        var px = x + r * c, w = r * 0.18 * s + 0.6;
        g.fillRect(px - w / 2, y + ry * s - 0.2, w, t + 0.4);
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.beginPath();
      g.ellipse(x, y + t, r, ry, 0, 0, Math.PI);
      g.lineTo(x - r, y);
      g.ellipse(x, y, r, ry, 0, Math.PI, 0, true);
      g.closePath();
      g.fill();
      // top face
      g.save();
      g.translate(x, y);
      g.scale(1, ry / r);
      g.rotate(i * 0.9);
      g.drawImage(face, -r, -r, 2 * r, 2 * r);
      g.restore();
    }
  }

  /* ------------------------------------------------------------ rules --- */
  var rules = {
    built: false,
    init: function () {
      tabs($('#screen-rules'), function (t) {
        $('#pane-combos').classList.toggle('active', t === 'combos');
        $('#pane-rules').classList.toggle('active', t === 'rules');
      });
    },
    open: function () {
      if (this.built) return;
      this.built = true;
      var grid = document.createElement('div');
      grid.className = 'pay-grid';
      var chipURL = BR.svgURL(BR.ICONS.chip);
      var pos = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]];
      C.symbols.forEach(function (sym, i) {
        var card = document.createElement('div');
        card.className = 'pay-card';
        card.style.left = (pos[i][0] * 507) + 'px';
        card.style.top = (pos[i][1] * 223) + 'px';
        var pays = C.pays[sym];
        var counts = Object.keys(pays).map(Number).sort(function (a, b) { return a - b; });
        var prob = Math.round(C.weights[sym] * 1000) / 10;
        card.innerHTML =
          '<div class="pc-img"><img alt="" src="' + BR.svgURL(BR.SYMBOL_SVG[sym]) + '"></div>' +
          '<div class="pc-prob">確率: <b>' + prob + '%</b></div>' +
          '<div class="pc-counts">' + counts.map(function (c) { return '<div>' + c + '/5</div>'; }).join('') + '</div>' +
          '<div class="pc-div"></div>' +
          '<div class="pc-mults">' + counts.map(function (c) {
            return '<div><i class="ic" style="background-image:url(&quot;' + chipURL + '&quot;)"></i>x' + U.fmtMult(pays[c]) + '</div>';
          }).join('') + '</div>';
        grid.appendChild(card);
      });
      $('#pane-combos').appendChild(grid);
    }
  };

  BR.screens = {
    init: function () { shop.init(); rules.init(); initNumpad(); },
    show: show,
    current: function () { return current; },
    resize: function () { pileDrawn = 0; if (current === 'tokens') drawPile(); }
  };
})(window.BR = window.BR || {});
