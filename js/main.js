/* Boot, landscape full-screen layout and the slot game controller. */
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
      chip: BR.ICONS.chip, dollar: BR.ICONS.dollar, coin: BR.ICONS.coin, plus: BR.ICONS.plus,
      back: BR.ICONS.back, radio: BR.ICONS.radio, mic: BR.ICONS.mic, edit: BR.ICONS.edit,
      stopwatch: BR.ICONS.stopwatch, info: BR.ICONS.info, grip: BR.ICONS.grip, del: BR.ICONS.del,
      'sound-off': BR.ICONS.soundOff, 'sound-on': BR.ICONS.soundOn
    };
    Object.keys(map).forEach(function (k) {
      css += '.ic-' + k + '{background-image:url("' + BR.svgURL(map[k]).replace(/"/g, '%22') + '")}\n';
    });
    css += '.ic-sound{background-image:url("' + BR.svgURL(BR.ICONS.soundOff).replace(/"/g, '%22') + '")}\n';
    css += '.sound-on .ic-sound{background-image:url("' + BR.svgURL(BR.ICONS.soundOn).replace(/"/g, '%22') + '")}\n';
    css += '.payline-mark{background-image:url("' + BR.svgURL(BR.UISVG.payline()).replace(/"/g, '%22') + '")}\n';
    css += '.spin-arrows{background-image:url("' + BR.svgURL(BR.UISVG.spinArrows()).replace(/"/g, '%22') + '")}\n';
    css += '.pill{background-image:url("' + BR.svgURL(BR.UISVG.pill(167, 92)).replace(/"/g, '%22') + '")}\n';
    css += '.pill-auto{background-image:url("' + BR.svgURL(BR.UISVG.pill(168, 100)).replace(/"/g, '%22') + '")}\n';
    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    $('.reel-frame').innerHTML = BR.UISVG.reelFrame();
  }

  /* ------------------------------------------------------------ layout --- */
  function layout() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var portrait = vh > vw * 1.05;
    var w = portrait ? vh : vw, h = portrait ? vw : vh;
    // Fit the 924px-tall reference height; on narrower (16:9, tablet) screens
    // allow the design to shrink to 1800px wide before adding height.
    var s = Math.min(w / MIN_W, h / REF_H);
    var W = Math.round(w / s), H = Math.round(h / s);
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
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
    $('#frame').innerHTML = BR.backdrop.frameSVG(W, H);
    BR.backdrop.drawBackground($('#bg'), W, H, Math.min(res, 2));
    reels.resize(Math.max(1, Math.min(s * dpr, 3)));
    fx.resize(W, H, res);
    if (BR.screens) BR.screens.resize(res);
  }

  /* ------------------------------------------------------------ fullscreen --- */
  var wantFullscreen = true;
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function enterFullscreen() {
    if (!wantFullscreen || isFullscreen()) return;
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
  var shown = { tokens: S.tokens, dollars: S.dollars, coins: S.coins };
  var walletAnim = {};
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function renderWallet(animate) {
    ['tokens', 'dollars', 'coins'].forEach(function (k) {
      var to = S[k], from = shown[k];
      if (walletAnim[k]) walletAnim[k]();
      if (!animate || from === to) {
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
    busy: function () { return game.spinning || game.presenting; }
  };

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
    if (game.spinning) {
      reels.quickStop();
      return;
    }
    if (game.presenting) {
      fx.skip();
      return;
    }
    if (S.tokens < bet()) {
      setAuto(false);
      BR.sfx.play('deny');
      toast('スピントークンが不足しています');
      setTimeout(function () { BR.screens.show('tokens'); }, 650);
      return;
    }
    S.tokens -= bet();
    S.stats.spins++;
    BR.store.save();
    renderWallet(false);
    setWinGoodLuck();
    var res = BR.engine.spin(bet());
    game.result = res;
    game.spinning = true;
    renderBet();
    $('#btn-spin').classList.add('spinning');
    $$('.payline-mark').forEach(function (m) { m.classList.remove('lit'); });
    reels.spin();
    BR.sfx.play('spinStart');
    BR.sfx.startReels();
    reels.scheduleStops(res.grid, { antic: anticipationFor(res), base: game.auto ? 0.8 : 0.95 });
  }

  function onAllStopped() {
    game.spinning = false;
    BR.sfx.stopReels();
    $('#btn-spin').classList.remove('spinning');
    var res = game.result;
    if (!res || res.total <= 0) {
      renderBet();
      scheduleAuto(game.auto ? 450 : 0);
      return;
    }
    game.presenting = true;
    var cols = [];
    res.wins.forEach(function (w) { w.cols.forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
    reels.setHighlight(cols);
    $$('.payline-mark').forEach(function (m) { m.classList.add('lit'); });
    // as in the reference, the WIN box and the balance show the final values
    // right away while the overlay counts up
    S.tokens += res.total;
    S.stats.won += res.total;
    S.stats.biggest = Math.max(S.stats.biggest, res.total);
    BR.store.save();
    setWinAmount(res.total, true);
    renderWallet(true);
    renderBet();
    fx.play({ tier: res.tier, amount: res.total, bet: res.bet, mult: res.mult, cols: cols, auto: game.auto }).then(function () {
      game.presenting = false;
      renderBet();
      scheduleAuto(game.auto ? 350 : 0);
    });
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
    press($('#btn-spin'), function () { if (game.auto && !game.spinning && !game.presenting) { setAuto(false); return; } spin(); });
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
    ['#btn-radio', '#btn-mic'].forEach(function (id) {
      press($(id), function () { $(id).classList.toggle('on'); BR.sfx.play('click'); });
    });
    $$('[data-action="back"]').forEach(function (b) {
      press(b, function () {
        BR.sfx.play('click');
        if (BR.screens.current() !== 'slot') BR.screens.show('slot');
        else toggleFullscreen();
      });
    });
    document.addEventListener('pointerdown', function () { enterFullscreen(); BR.sfx.unlock(); }, true);
    document.addEventListener('keydown', function (e) {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (BR.screens.current() === 'slot') spin(); }
    });
    window.addEventListener('resize', function () { requestAnimationFrame(layout); });
    window.addEventListener('orientationchange', function () { setTimeout(layout, 250); });
    document.addEventListener('fullscreenchange', function () { setTimeout(layout, 60); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) BR.sfx.suspend(); else BR.sfx.resume(); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  }

  /* ------------------------------------------------------------ boot --- */
  function boot() {
    installIcons();
    reels = new BR.Reels($('#reel-canvas'));
    fx = new BR.FX($('#fx'), $('#fx-hit'));
    BR.game = game;
    BR.app = { renderWallet: renderWallet, toast: toast, renderBet: renderBet, view: view, setAuto: setAuto, reels: reels, fx: fx, spin: spin };
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
    bind();
    BR.sfx.setMuted(S.muted);
    $('#btn-sound').classList.toggle('sound-on', !S.muted);
    renderWallet(false);
    renderBet();
    layout();
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(function () { document.documentElement.classList.add('fonts-ready'); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.BR = window.BR || {});
