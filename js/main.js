/* Boot, landscape full-screen layout and the slot game controller (also
   used to show a friend's spins while watching their screen). */
(function (BR) {
  'use strict';

  var U = BR.util, C = BR.CONFIG, S = BR.store.state;
  var $ = U.$, $$ = U.$$;
  var REF_W = 2000, REF_H = 924, MIN_W = 1800;

  var stage = $('#stage');
  var view = { W: REF_W, H: REF_H, s: 1, res: 1, portrait: false };
  var reels, fx;

  /* ------------------------------------------------------------ icons --- */
  function installIcons() {
    var css = '';
    var map = {
      plus: BR.ICONS.plus, back: BR.ICONS.back, radio: BR.ICONS.radio, mic: BR.ICONS.mic, edit: BR.ICONS.edit,
      stopwatch: BR.ICONS.stopwatch, info: BR.ICONS.info, grip: BR.ICONS.grip, del: BR.ICONS.del,
      'sound-off': BR.ICONS.soundOff, 'sound-on': BR.ICONS.soundOn,
      lock: BR.ICONS.lock, phone: BR.ICONS.phone, hangup: BR.ICONS.hangup, 'mic-on': BR.ICONS.micOn, 'mic-off': BR.ICONS.micOff,
      eye: BR.ICONS.eye, car: BR.ICONS.car, gift: BR.ICONS.gift, friends: BR.ICONS.friends, search: BR.ICONS.search, check: BR.ICONS.check,
      share: BR.ICONS.share, 'add-home': BR.ICONS.addHome, download: BR.ICONS.download, android: BR.ICONS.android, apple: BR.ICONS.apple,
      bag: BR.ICONS.bag, home: BR.ICONS.home, speaker: BR.ICONS.speaker
    };
    function url(u) { return 'url("' + u.replace(/"/g, '%22') + '")'; }
    function svg(markup) { return url(BR.svgURL(markup)); }
    Object.keys(map).forEach(function (k) { css += '.ic-' + k + '{background-image:' + svg(map[k]) + '}\n'; });
    var art = BR.UI_IMG;
    css += '.ic-chip{background-image:' + url(art.chip) + '}\n';
    css += '.ic-coin{background-image:' + url(art.coin) + '}\n';
    css += '.ic-dollar{background-image:' + url(art.dollar) + '}\n';
    css += '.ic-sound{background-image:' + svg(BR.ICONS.soundOff) + '}\n';
    css += '.sound-on .ic-sound{background-image:' + svg(BR.ICONS.soundOn) + '}\n';
    css += '.payline-mark{background-image:' + svg(BR.UISVG.payline()) + '}\n';
    css += '.spin-disc{background-image:' + url(art.spin) + '}\n';
    css += '.spin-arrows{background-image:' + url(art.spinArrows) + '}\n';
    css += '.pill{background-image:' + url(art.pill) + '}\n';
    css += '.pill-get{background-image:' + url(art.pillGet) + '}\n';
    css += '.pill-max{background-image:' + url(art.pillMax) + '}\n';
    css += '.chip-pile{background-image:' + url(art.chipPile) + '}\n';
    css += '#bg{background-image:' + url(art.bg) + '}\n';
    css += '#frame{border-image-source:' + url(art.frame) + '}\n';
    var soc = BR.SOCIAL_IMG;
    css += '.av-chain{background-image:' + url(soc.chain) + '}\n';
    css += '.sale-badge{background-image:' + url(soc.sale) + '}\n';
    if (soc.items.omamori) css += '.charm-pic{background-image:' + url(soc.items.omamori) + '}\n';
    Object.keys(soc.fruits).forEach(function (k) {
      if (soc.fruits[k]) css += '[data-fruit="' + k + '"] .fruit-pic,.fruit-fly.' + k + '{background-image:' + url(soc.fruits[k]) + '}\n';
    });
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    $('.reel-frame').innerHTML = BR.UISVG.reelFrame();
  }

  /* ------------------------------------------------------------ layout --- */
  // While a text field has the keyboard up the window shrinks; keep the game
  // laid out for the full screen underneath and catch up afterwards.
  function typing() {
    var a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }
  function layout() {
    if (typing() && view.ready) return;
    var vw = window.innerWidth, vh = window.innerHeight;
    var portrait = vh > vw * 1.05;
    stage.classList.toggle('rot', portrait);
    var w = portrait ? vh : vw, h = portrait ? vw : vh;
    // Fit the 924px-tall reference height; on narrower (16:9, tablet) screens
    // allow the design to shrink to 1800px wide before adding height.
    var s = Math.min(w / MIN_W, h / REF_H);
    var W = Math.round(w / s), H = Math.round(h / s);
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    // the start video covers the stage like a background picture, but never
    // crops into its two buttons (tablets get bands above and below instead)
    stage.style.setProperty('--cover', String(Math.min(Math.max(W / REF_W, H / REF_H), W / 1640)));
    stage.style.transform = portrait
      ? 'translate(' + vw + 'px,0) rotate(90deg) scale(' + s + ')'
      : 'scale(' + s + ')';
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var res = s * dpr;
    // keep full-screen canvases within a sane pixel budget on huge displays
    var maxPx = 4.2e6;
    if (W * H * res * res > maxPx) res = Math.sqrt(maxPx / (W * H));
    var changed = W !== view.W || H !== view.H || Math.abs(res - view.res) > 1e-3 || !view.ready;
    view.W = W; view.H = H; view.s = s; view.res = res; view.portrait = portrait;
    if (!changed) return;
    view.ready = true;
    reels.resize(Math.max(1, Math.min(s * dpr, 3)));
    fx.resize(W, H, res);
  }

  /* ------------------------------------------------------------ fullscreen --- */
  var wantFullscreen = true;
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function enterFullscreen() {
    // installed (Android app, home-screen app): already full screen
    if (!wantFullscreen || isFullscreen() || (BR.platform && BR.platform.installed)) return;
    var el = document.documentElement;
    var req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      var p = req.call(el, { navigationUI: 'hide' });
      var lock = function () {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
      };
      if (p && p.then) p.then(lock).catch(function () {}); else lock();
    } catch (e) { /* not allowed (iframe / iOS) */ }
  }
  function exitFullscreen() {
    wantFullscreen = false;
    var ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (isFullscreen() && ex) try { ex.call(document); } catch (e) { /* ignore */ }
  }
  function toggleFullscreen() {
    if (isFullscreen()) { exitFullscreen(); return; }
    wantFullscreen = true;
    enterFullscreen();
  }

  /* ------------------------------------------------------------ wallet / HUD --- */
  var shown = { tokens: null, dollars: null, coins: null };
  var walletAnim = {};
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  // While the reels turn, the wallet keeps the stake (before the result is
  // known) or the win (until the reels have stopped) out of the token count.
  function walletValue(k) {
    var src = game.watch ? game.watch.balance : S;
    return k === 'tokens' ? Math.max(0, src.tokens - game.hold) : src[k];
  }
  function renderWallet(animate) {
    var ready = BR.bank.ready() || !!game.watch;
    $('.wallet').classList.toggle('watching', !!game.watch);
    ['tokens', 'dollars', 'coins'].forEach(function (k) {
      if (walletAnim[k]) walletAnim[k]();
      if (!ready) {
        shown[k] = null;
        setText('w-' + k, '-');
        return;
      }
      var to = walletValue(k), from = shown[k];
      if (!animate || from === to || from === null) {
        shown[k] = to;
        setText('w-' + k, U.fmt(to));
        return;
      }
      var el = document.getElementById('w-' + k);
      el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
      var dur = Math.min(1400, 300 + Math.log10(Math.abs(to - from) + 1) * 220);
      walletAnim[k] = U.tween(dur, function (t) {
        shown[k] = Math.round(from + (to - from) * U.ease.outCubic(t));
        setText('w-' + k, U.fmt(shown[k]));
      });
    });
  }

  function bet() { return C.bets[S.betIndex]; }
  function renderBet() {
    setText('bet-value', U.fmt(bet()));
    var lock = game.busy();
    $('#bet-minus').disabled = lock || S.betIndex <= 0;
    $('#bet-plus').disabled = lock || S.betIndex >= C.bets.length - 1;
  }

  function setWinGoodLuck() {
    var box = $('.win-box');
    box.classList.remove('flash');
    box.innerHTML = '<span id="win-value" class="win-text">グッドラック！</span>';
  }
  function setWinAmount(v, flash) {
    var box = $('.win-box');
    var num = box.querySelector('.win-num');
    if (!num) {
      box.innerHTML = '<span id="win-value" class="win-amount"><i class="ic ic-chip"></i><span class="win-num"></span></span>';
      num = box.querySelector('.win-num');
    }
    num.textContent = U.fmt(v);
    if (flash) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  }

  var toastTimer = 0;
  function toast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }

  /* ------------------------------------------------------------ game flow --- */
  var game = {
    spinning: false,
    presenting: false,
    auto: false,
    result: null,
    hold: 0,          // tokens hidden from the wallet display (see walletValue)
    waiting: false,   // the spin is out at the server, reels turning
    queued: null,     // balance pushed by the server while a spin was out
    seq: 0,
    watch: null,      // watching a friend: { user, balance, queue, mine: { grid } }
    busy: function () { return game.spinning || game.presenting; }
  };

  // Shown when a spin could not be settled: nothing on the pay line wins.
  var BLANK_GRID = [
    ['star', 'gold', 'diamond'],
    ['diamond', 'revolver', 'gold'],
    ['revolver', 'diamond', 'star'],
    ['gold', 'revolver', 'bar'],
    ['diamond', 'star', 'revolver']
  ];

  // Suspense: slow down the remaining reels when one more match pays >= 20x.
  function anticipationFor(res) {
    var line = res.line, out = [];
    for (var i = 2; i < 5; i++) {
      var counts = {};
      for (var j = 0; j < i; j++) counts[line[j]] = (counts[line[j]] || 0) + 1;
      var hot = Object.keys(counts).some(function (s) { return (C.pays[s][counts[s] + 1] || 0) >= 20; });
      if (hot) out.push(i);
      if (out.length >= 2) break;
    }
    return out;
  }

  function spin() {
    BR.sfx.unlock();
    // the reels always run their whole course: no stopping them early
    if (game.spinning) return;
    if (game.presenting) {
      fx.skip();
      return;
    }
    if (game.watch) {
      BR.sfx.play('deny');
      toast(game.watch.user.name + 'さんのホームで観戦中です（「ホームを出る」で戻れます）');
      return;
    }
    if (!BR.bank.ready()) {
      setAuto(false);
      BR.sfx.play('deny');
      toast(BR.api.hasToken() ? 'サーバーに接続しています…' : 'ユーザー登録またはログインをしてください');
      if (!BR.api.hasToken()) BR.account.require(function () {});
      return;
    }
    var stake = bet();
    if (S.tokens < stake) {
      setAuto(false);
      BR.sfx.play('deny');
      toast('スピントークンが不足しています');
      setTimeout(function () { BR.screens.show('tokens'); }, 650);
      return;
    }
    var seq = ++game.seq;
    game.spinning = true;
    game.waiting = true;
    game.result = null;
    game.hold = stake;
    game.t0 = U.now();
    renderWallet(false);
    setWinGoodLuck();
    renderBet();
    $('#btn-spin').classList.add('spinning');
    $$('.payline-mark').forEach(function (m) { m.classList.remove('lit'); });
    reels.spin();
    BR.sfx.play('spinStart');
    BR.sfx.startReels();
    BR.bank.spin(stake).then(function (r) {
      if (seq === game.seq) land(r.result);
      BR.shop.afterSpin(r);
    }, function (err) {
      if (seq !== game.seq) return;
      land(null);
      setAuto(false);
      BR.sfx.play('deny');
      toast(err.message, 3200);
      // the server may have settled it anyway (lost response): re-sync
      BR.bank.refresh().then(function () { renderWallet(true); renderBet(); }, function () {});
      if (err.code === 'insufficient') setTimeout(function () { if (!game.busy()) BR.screens.show('tokens'); }, 1600);
    });
  }

  // The result is known: schedule the reel stops (shortened by the time the
  // server took) and keep the win hidden until the reels have stopped.
  function land(res) {
    game.waiting = false;
    game.result = res;
    // tokens given back by the お守り加護 also wait for the reels
    game.hold = res ? res.total + (res.charm ? res.charm.back : 0) : 0;
    if (game.queued) { BR.bank.applyBalance(game.queued); game.queued = null; }
    renderWallet(false);
    var late = (U.now() - game.t0) / 1000;
    var base = Math.max(0.3, (game.auto ? 0.8 : 0.95) - late);
    reels.scheduleStops(res ? res.grid : BLANK_GRID, { antic: res ? anticipationFor(res) : [], base: base });
  }

  // Balance pushed by the server (money received, another device, reconnect).
  function serverBalance(b) {
    if (game.watch) { BR.bank.applyBalance(b); return; }
    if (game.waiting) {
      if (!game.queued || !(game.queued.rev > b.rev)) game.queued = b;
      return;
    }
    if (BR.bank.applyBalance(b)) {
      renderWallet(true);
      renderBet();
    }
  }

  function onAllStopped() {
    game.spinning = false;
    game.hold = 0;
    BR.sfx.stopReels();
    $('#btn-spin').classList.remove('spinning');
    var res = game.result;
    if (res && res.charm) BR.shop.charmSaved(res);
    if (!res || res.total <= 0) {
      renderWallet(!!(res && res.charm));
      renderBet();
      if (game.watch) { setTimeout(nextWatched, res && res.charm ? 900 : 250); return; }
      scheduleAuto(game.auto ? (res && res.charm ? 1200 : 450) : 0);
      return;
    }
    game.presenting = true;
    var cols = [];
    res.wins.forEach(function (w) { w.cols.forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
    if (res.charm) game.hold = 0;
    reels.setHighlight(cols);
    $$('.payline-mark').forEach(function (m) { m.classList.add('lit'); });
    // as in the reference, the WIN box and the balance show the final values
    // right away while the overlay counts up
    setWinAmount(res.total, true);
    renderWallet(true);
    renderBet();
    var done = function () {
      game.presenting = false;
      renderBet();
      if (game.watch) { nextWatched(); return; }
      scheduleAuto(game.auto ? 350 : 0);
    };
    // a plain WIN has no overlay: the lit line, the WIN box and the sound
    if (res.tier < 2) {
      BR.sfx.play('win');
      setTimeout(done, 700);
      return;
    }
    fx.play({ tier: res.tier, amount: res.total, bet: res.bet, mult: res.mult, cols: cols, auto: game.auto || !!game.watch }).then(done);
  }

  /* ------------------------------------------------------------ watching a friend --- */
  function watchEnter(user, balance, last) {
    setAuto(false);
    game.watch = { user: user, balance: balance, queue: [], mine: { grid: reels.getGrid() } };
    if (last && last.grid) reels.setGrid(last.grid);
    setWinGoodLuck();
    renderWallet(false);
    renderBet();
    BR.shop.renderCharm();
  }
  function watchExit() {
    var w = game.watch;
    if (!w) return;
    game.watch = null;
    if (!game.busy()) {
      if (w.mine.grid) reels.setGrid(w.mine.grid);
      setWinGoodLuck();
    }
    $$('.payline-mark').forEach(function (m) { m.classList.remove('lit'); });
    renderWallet(false);
    renderBet();
    BR.shop.renderCharm();
  }
  function watchBalance(b) {
    if (!game.watch) return;
    if (game.busy()) { game.watch.queue.push({ balance: b }); return; }
    game.watch.balance = b;
    renderWallet(true);
  }
  function watchSpin(result, balance) {
    var w = game.watch;
    if (!w) return;
    w.queue.push({ result: result, balance: balance });
    // a friend on auto-spin: keep up by skipping to the latest spins
    var spins = w.queue.filter(function (q) { return q.result; });
    if (spins.length > 2) w.queue.splice(0, w.queue.indexOf(spins[spins.length - 2]));
    if (!game.busy()) nextWatched();
  }
  function nextWatched() {
    var w = game.watch;
    if (!w || game.busy()) return;
    var item = w.queue.shift();
    if (!item) return;
    if (!item.result) { w.balance = item.balance; renderWallet(true); nextWatched(); return; }
    var res = item.result;
    w.balance = item.balance;
    game.spinning = true;
    game.result = res;
    game.hold = res.total + (res.charm ? res.charm.back : 0);
    game.t0 = U.now();
    renderWallet(false);
    setWinGoodLuck();
    $$('.payline-mark').forEach(function (m) { m.classList.remove('lit'); });
    reels.spin();
    BR.sfx.play('spinStart');
    BR.sfx.startReels();
    setTimeout(function () {
      if (game.result !== res) return;
      reels.scheduleStops(res.grid, { antic: anticipationFor(res), base: 0.55 });
    }, 420);
  }

  var autoTimer = 0;
  function scheduleAuto(ms) {
    clearTimeout(autoTimer);
    if (!game.auto) return;
    autoTimer = setTimeout(function () {
      if (!game.auto || game.busy()) return;
      if (BR.screens.current() !== 'slot') return;
      spin();
    }, ms);
  }
  function setAuto(on) {
    game.auto = on;
    var b = $('#btn-auto');
    b.classList.toggle('on', on);
    b.querySelector('.auto-state b').textContent = on ? 'オン' : 'オフ';
    if (on && !game.busy()) scheduleAuto(250);
    if (!on) clearTimeout(autoTimer);
  }

  function changeBet(d) {
    if (game.busy()) return;
    var i = U.clamp(S.betIndex + d, 0, C.bets.length - 1);
    if (i === S.betIndex) return;
    S.betIndex = i;
    BR.store.save();
    renderBet();
    BR.sfx.play(d > 0 ? 'betUp' : 'betDown');
    var box = $('.bet-box span');
    box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
  }

  function maxBet() {
    if (game.busy()) return;
    var idx = 0;
    for (var i = C.bets.length - 1; i >= 0; i--) if (C.bets[i] <= S.tokens) { idx = i; break; }
    if (S.tokens < C.bets[0]) toast('スピントークンが不足しています');
    S.betIndex = idx;
    BR.store.save();
    renderBet();
    BR.sfx.play('betUp');
  }

  function setSound(muted) {
    S.muted = muted;
    BR.store.save();
    BR.sfx.setMuted(muted);
    $('#btn-sound').classList.toggle('sound-on', !muted);
  }

  /* ------------------------------------------------------------ input --- */
  // Pressed look on pointerdown; the action itself fires on click.
  function press(el, fn) {
    el.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      enterFullscreen();
      if (el.disabled) return;
      el.classList.add('pressed');
      BR.sfx.unlock();
    });
    var clear = function () { el.classList.remove('pressed'); };
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('pointercancel', clear);
    el.addEventListener('click', function (e) {
      if (el.disabled) return;
      fn(e);
    });
  }

  function bind() {
    press($('#btn-spin'), function () { if (game.auto && !game.presenting) { setAuto(false); return; } spin(); });
    // the sound button only changes its look: every sound plays regardless
    press($('#bet-minus'), function () { changeBet(-1); });
    press($('#bet-plus'), function () { changeBet(1); });
    press($('#btn-max'), function () { BR.sfx.play('click'); maxBet(); });
    press($('#btn-auto'), function () { BR.sfx.play('click'); setAuto(!game.auto); });
    // the machine is locked while the reels turn or a win is being paid out
    function nav(screen) {
      return function () {
        if (game.busy()) { BR.sfx.play('deny'); return; }
        BR.sfx.play('click');
        BR.screens.show(screen);
      };
    }
    press($('#btn-get'), nav('tokens'));
    press($('#btn-rules'), nav('rules'));
    press($('#w-plus'), function () {
      if (BR.screens.current() === 'tokens') return;
      nav('tokens')();
    });
    press($('#btn-sound'), function () { setSound(!S.muted); BR.sfx.play('click'); });
    // walkie-talkie: ranking & messages, microphone: lobby chat (online)
    [['#btn-radio', 'ranking'], ['#btn-mic', 'lobby']].forEach(function (b) {
      press($(b[0]), function () {
        if (game.busy()) { BR.sfx.play('deny'); return; }
        BR.sfx.play('click');
        BR.social.open(b[1]);
      });
    });
    $$('[data-action="back"]').forEach(function (b) {
      press(b, function () {
        BR.sfx.play('click');
        if (!BR.screens.back()) toggleFullscreen();
      });
    });
    // text fields live in overlays outside the stage: leave them alone
    function inField(e) { return !!(e.target && e.target.closest && e.target.closest('input, textarea, .ov, .entry')); }
    document.addEventListener('pointerdown', function (e) { if (!inField(e)) enterFullscreen(); BR.sfx.unlock(); }, true);
    // on touch screens only the end of a tap may open full screen: the very first tap counts
    ['pointerup', 'click'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { if (!inField(e)) enterFullscreen(); }, true);
    });
    document.addEventListener('keydown', function (e) {
      if (inField(e)) return;
      if (e.key === 'Escape' && BR.social.escape()) { e.preventDefault(); return; }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (BR.screens.current() === 'slot') spin(); }
    });
    document.addEventListener('focusout', function () { setTimeout(function () { if (!typing()) layout(); }, 350); });
    window.addEventListener('resize', function () { requestAnimationFrame(layout); });
    window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });
    document.addEventListener('fullscreenchange', function () { setTimeout(layout, 60); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) BR.sfx.suspend(); else BR.sfx.resume(); });
    document.addEventListener('contextmenu', function (e) { if (!inField(e)) e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { if (!inField(e)) e.preventDefault(); });
  }

  /* ------------------------------------------------------------ boot --- */
  function boot() {
    installIcons();
    reels = new BR.Reels($('#reel-canvas'));
    fx = new BR.FX($('#fx'), $('#fx-hit'));
    BR.game = game;
    BR.app = {
      renderWallet: renderWallet, toast: toast, renderBet: renderBet, view: view, setAuto: setAuto,
      reels: reels, fx: fx, spin: spin, serverBalance: serverBalance,
      watchEnter: watchEnter, watchExit: watchExit, watchSpin: watchSpin, watchBalance: watchBalance,
      relayout: function () { requestAnimationFrame(layout); }
    };
    reels.on('land', function (i) { BR.sfx.play('reelStop', i); if (i === 4) BR.sfx.stopReels(); });
    reels.on('anticipate', function () { BR.sfx.play('anticipate'); });
    reels.on('allstopped', onAllStopped);
    // initial screen like the reference shot
    reels.setGrid([
      ['statue', 'diamond', 'revolver'],
      ['seven', 'seven', 'bar'],
      ['diamond', 'gold', 'star'],
      ['star', 'star', 'diamond'],
      ['bar', 'bar', 'bar']
    ]);
    BR.screens.init();
    BR.kit.init();
    BR.account.init();
    BR.avatars.init();
    BR.social.init();
    BR.cars.init();
    BR.shop.init();
    BR.peter.init();
    BR.bonus.init();
    BR.call.init();
    BR.watch.init();
    BR.start.init();
    BR.install.init();
    bind();
    $('#btn-sound').classList.toggle('sound-on', !S.muted);
    renderWallet(false);
    renderBet();
    layout();
    BR.launch.init();
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () { document.documentElement.classList.add('fonts-ready'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.BR = window.BR || {});
