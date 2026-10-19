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
      plus: BR.ICONS.plus, back: BR.ICONS.back, edit: BR.ICONS.edit,
      stopwatch: BR.ICONS.stopwatch, info: BR.ICONS.info, grip: BR.ICONS.grip, del: BR.ICONS.del,
      'sound-off': BR.ICONS.soundOff, 'sound-on': BR.ICONS.soundOn,
      lock: BR.ICONS.lock, phone: BR.ICONS.phone, hangup: BR.ICONS.hangup, 'mic-on': BR.ICONS.micOn, 'mic-off': BR.ICONS.micOff,
      eye: BR.ICONS.eye, car: BR.ICONS.car, gift: BR.ICONS.gift, friends: BR.ICONS.friends, search: BR.ICONS.search, check: BR.ICONS.check,
      share: BR.ICONS.share, 'add-home': BR.ICONS.addHome, download: BR.ICONS.download, android: BR.ICONS.android, apple: BR.ICONS.apple,
      bag: BR.ICONS.bag, home: BR.ICONS.home, speaker: BR.ICONS.speaker, 'speaker-off': BR.ICONS.speakerOff, chat: BR.ICONS.chat
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
    // the round buttons on the slot screen: menu, quests
    css += '.ic-menu{background-image:' + url(soc.buttons.menu) + '}\n';
    css += '.ic-quest,.q-icon,.qn-icon{background-image:' + url(soc.buttons.quest) + '}\n';
    css += '.ic-tree{background-image:' + url(soc.buttons.tree) + '}\n';
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
    if ((typing() || (BR.entry && BR.entry.isOpen())) && view.ready) return;
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
    if (BR.juice) BR.juice.resize(W, H, res);
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
  var walletAnim = {};   // the count under way (or waiting for its coins): cancels it
  var aim = {};          // the value each count is going to
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  // While the reels turn, the wallet keeps the stake (before the result is
  // known) or the win (until the reels have stopped) out of the token count.
  function walletValue(k) {
    var src = game.watch ? game.watch.balance : S;
    return k === 'tokens' ? Math.max(0, src.tokens - game.hold) : src[k];
  }
  // Money coming in flies into the wallet as coins first (js/render/juice.js:
  // from `src`, an element or a stage point, else from what the moment told
  // BR.juice.source()) and the count starts when the first coin gets there.
  function renderWallet(animate, src) {
    var ready = BR.bank.ready() || !!game.watch;
    $('.wallet').classList.toggle('watching', !!game.watch);
    ['tokens', 'dollars', 'coins'].forEach(function (k) {
      var to = ready ? walletValue(k) : null;
      // already counting (or about to) towards this very value: let it run
      if (animate && ready && walletAnim[k] && aim[k] === to) return;
      var running = !!walletAnim[k], before = aim[k];
      if (walletAnim[k]) { walletAnim[k](); walletAnim[k] = null; }
      aim[k] = to;
      if (!ready) {
        shown[k] = null;
        setText('w-' + k, '-');
        return;
      }
      var from = shown[k];
      if (!animate || from === to || from === null) {
        shown[k] = to;
        setText('w-' + k, U.fmt(to));
        return;
      }
      var el = document.getElementById('w-' + k);
      var run = function () {
        el.classList.toggle('down', to < from);
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
        var dur = Math.min(1600, 380 + Math.log10(Math.abs(to - from) + 1) * 240);
        walletAnim[k] = U.tween(dur, function (t) {
          shown[k] = Math.round(from + (to - from) * U.ease.outCubic(t));
          setText('w-' + k, U.fmt(shown[k]));
        }, function () { walletAnim[k] = null; });
      };
      // the coins fly in for what is new (a count already under way had the rest)
      var fresh = to - (running && typeof before === 'number' ? before : from);
      var wait = fresh > 0 && BR.juice ? BR.juice.gain(k, fresh, src) : 0;
      if (!wait) { run(); return; }
      var timer = setTimeout(run, wait);
      walletAnim[k] = function () { clearTimeout(timer); };
    });
  }

  function bet() { return C.bets[S.betIndex]; }
  function renderBet() {
    setText('bet-value', U.fmt(bet()));
    var lock = game.busy();
    $('#bet-minus').disabled = lock || S.betIndex <= 0;
    $('#bet-plus').disabled = lock || S.betIndex >= C.bets.length - 1;
  }

  var winRoll = null;   // the WIN box counting up (a plain WIN): cancels it
  function setWinGoodLuck() {
    if (winRoll) { winRoll(); winRoll = null; }
    var box = $('.win-box');
    box.classList.remove('flash');
    box.innerHTML = '<span id="win-value" class="win-text">グッドラック！</span>';
  }
  // `roll`: count up to it (a plain WIN has no overlay doing that), else at once
  function setWinAmount(v, flash, roll) {
    var box = $('.win-box');
    var num = box.querySelector('.win-num');
    if (!num) {
      box.innerHTML = '<span id="win-value" class="win-amount"><i class="ic ic-chip"></i><span class="win-num"></span></span>';
      num = box.querySelector('.win-num');
    }
    if (winRoll) { winRoll(); winRoll = null; }
    if (roll && v > 0) {
      num.textContent = '0';
      winRoll = U.tween(Math.min(900, 380 + Math.log10(v + 1) * 110), function (t) {
        num.textContent = U.fmt(Math.round(v * U.ease.outCubic(t)));
      }, function () {
        winRoll = null;
        if (BR.juice) BR.juice.bump(num.parentNode, 1.3);
      });
    } else {
      num.textContent = U.fmt(v);
    }
    if (flash) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
  }

  // `tap`: what tapping the notice opens (a message's chat ...)
  var toastTimer = 0, toastTap = null;
  function toast(msg, ms, tap) {
    var t = $('#toast');
    t.textContent = msg;
    toastTap = tap || null;
    t.classList.toggle('tappable', !!tap);
    // a new notice over one still up bounces in again
    if (t.classList.contains('show')) { t.classList.remove('show'); void t.offsetWidth; }
    t.classList.add('show');
    clearTimeout(toastTimer);
    // short: a notice gets out of the way quickly
    toastTimer = setTimeout(hideToast, Math.max(1500, Math.round((ms || 2200) * 0.7)));
  }
  function hideToast() {
    var t = $('#toast');
    t.classList.remove('show', 'tappable');
    toastTap = null;
  }

  /* ------------------------------------------------------------ game flow --- */
  var game = {
    spinning: false,
    presenting: false,
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
      BR.sfx.play('deny');
      toast(BR.api.hasToken() ? 'サーバーに接続しています…' : 'ユーザー登録またはログインをしてください');
      if (!BR.api.hasToken()) BR.account.require(function () {});
      return;
    }
    var stake = bet();
    if (S.tokens < stake) {
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
    if (BR.slotfx) BR.slotfx.spinStart();
    BR.sfx.play('spinStart');
    BR.sfx.startReels();
    BR.bank.spin(stake).then(function (r) {
      if (seq === game.seq) land(r.result);
      BR.shop.afterSpin(r);
      BR.quests.setXp(r.xp);
    }, function (err) {
      if (seq !== game.seq) return;
      land(null);
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
    var base = Math.max(0.3, 0.95 - late);
    reels.scheduleStops(res ? res.grid : BLANK_GRID, { antic: res ? anticipationFor(res) : [], base: base });
  }

  // Balance pushed by the server (money received, another device, reconnect).
  // `quiet`: the wallet changes without moving (バイト wages).
  function serverBalance(b, quiet) {
    if (game.watch) { BR.bank.applyBalance(b); return; }
    if (game.waiting) {
      if (!game.queued || !(game.queued.rev > b.rev)) game.queued = b;
      return;
    }
    if (BR.bank.applyBalance(b)) {
      renderWallet(!quiet);
      renderBet();
    }
  }

  function onAllStopped() {
    game.spinning = false;
    game.hold = 0;
    BR.sfx.stopReels();
    $('#btn-spin').classList.remove('spinning');
    var res = game.result;
    if (BR.slotfx) BR.slotfx.stopped(!!(res && res.total > 0));
    // small wins and winning streaks (js/render/combo.js); in a hub, what it added (js/ui/hub.js)
    if (res && BR.combo && BR.combo.spun) BR.combo.spun(res, !!game.watch);
    if (res && res.hub && !game.watch && BR.hub) BR.hub.afterSpin(res);
    if (res && res.charm) BR.shop.charmSaved(res);
    if (!res || res.total <= 0) {
      renderWallet(!!(res && res.charm));
      renderBet();
      if (game.watch) setTimeout(nextWatched, res && res.charm ? 900 : 250);
      return;
    }
    game.presenting = true;
    var cols = [];
    res.wins.forEach(function (w) { w.cols.forEach(function (c) { if (cols.indexOf(c) < 0) cols.push(c); }); });
    if (res.charm) game.hold = 0;
    reels.setHighlight(cols);
    $$('.payline-mark').forEach(function (m) { m.classList.add('lit'); });
    // the WIN box shows the win right away; the coins jump out of the winning
    // symbols into the wallet (a BIG WIN pays out when its overlay is over)
    var mid = BR.slotfx ? BR.slotfx.win(res, cols) : null;
    // BIG WIN switched off in 演出設定: shown like a plain WIN (the WIN box counts up)
    var overlay = res.tier >= 2 && (!BR.fx || BR.fx.on('bigwin'));
    setWinAmount(res.total, true, !overlay);
    if (res.tier >= 2) game.hold = res.total;
    renderWallet(true, mid);
    renderBet();
    var done = function () {
      game.presenting = false;
      if (res.tier >= 2) {
        // the win pours out of where its count was into the wallet
        var from = { x: view.W / 2, y: view.H / 2 + 136 };
        game.hold = 0;
        if (BR.juice) BR.juice.payout('tokens', res.total, from, { n: res.tier >= 3 ? 30 : 22, size: 58 });
        renderWallet(true, from);
        BR.sfx.play('coinShower', res.tier >= 3 ? 26 : 18);
      }
      renderBet();
      if (game.watch) nextWatched();
    };
    // a plain WIN has no overlay: the lit line, the WIN box and the sound
    if (!overlay) {
      BR.sfx.play(res.tier >= 2 ? 'bigWin' : 'win');
      setTimeout(done, res.tier >= 2 ? 1400 : 700);
      return;
    }
    fx.play({ tier: res.tier, amount: res.total, bet: res.bet, mult: res.mult, cols: cols, auto: !!game.watch }).then(done);
  }

  /* ------------------------------------------------------------ watching a friend --- */
  function watchEnter(user, balance, last) {
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
    // a friend spinning fast: keep up by skipping to the latest spins
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
    if (BR.slotfx) BR.slotfx.spinStart();
    BR.sfx.play('spinStart');
    BR.sfx.startReels();
    setTimeout(function () {
      if (game.result !== res) return;
      reels.scheduleStops(res.grid, { antic: anticipationFor(res), base: 0.55 });
    }, 420);
  }

  // フレンド対決: the battle's bet stays until it is over (js/ui/play.js)
  function betLocked() {
    if (!BR.play || !BR.play.betLocked || !BR.play.betLocked()) return false;
    BR.sfx.play('deny');
    toast('フレンド対決中はベットを変えられません');
    return true;
  }
  function setBet(value) {
    var i = C.bets.indexOf(value);
    if (i < 0 || game.busy()) return false;
    S.betIndex = i;
    BR.store.save();
    renderBet();
    return true;
  }

  function changeBet(d) {
    if (game.busy() || betLocked()) return;
    var i = U.clamp(S.betIndex + d, 0, C.bets.length - 1);
    if (i === S.betIndex) return;
    S.betIndex = i;
    BR.store.save();
    renderBet();
    BR.sfx.play(d > 0 ? 'betUp' : 'betDown');
    var box = $('.bet-box span');
    box.classList.remove('bump'); void box.offsetWidth; box.classList.add('bump');
    if (BR.juice) {
      var p = BR.juice.at(box);
      BR.juice.sparks(p.x, p.y, { n: d > 0 ? 8 : 4, speed: d > 0 ? 380 : 220, life: 0.5, g: d > 0 ? 300 : 600, color: d > 0 ? 'gold' : 'white' });
    }
  }

  function maxBet() {
    if (game.busy() || betLocked()) return;
    var idx = 0;
    for (var i = C.bets.length - 1; i >= 0; i--) if (C.bets[i] <= S.tokens) { idx = i; break; }
    if (S.tokens < C.bets[0]) toast('スピントークンが不足しています');
    var was = S.betIndex;
    S.betIndex = idx;
    BR.store.save();
    renderBet();
    BR.sfx.play('betUp');
    // all in: the bet box flares up
    if (BR.juice && idx > was) {
      var box = $('.bet-box');
      var p = BR.juice.at(box);
      BR.juice.ring(p.x, p.y, { r0: 20, r1: 220, dur: 0.5, w: 8, sy: 0.4 });
      BR.juice.sparks(p.x, p.y, { n: 18, speed: 560, life: 0.7, g: 500 });
      BR.juice.bump(box, 1.12);
    }
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
    press($('#btn-spin'), function () { spin(); });
    // the sound button only changes its look: every sound plays regardless
    press($('#bet-minus'), function () { changeBet(-1); });
    press($('#bet-plus'), function () { changeBet(1); });
    press($('#btn-max'), function () { BR.sfx.play('click'); maxBet(); });
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
    // 金の生る木 (online)
    press($('#btn-tree'), function () {
      if (game.busy()) { BR.sfx.play('deny'); return; }
      BR.sfx.play('click');
      BR.tree.open();
    });
    press($('#w-plus'), function () {
      if (BR.screens.current() === 'tokens') return;
      nav('tokens')();
    });
    press($('#btn-sound'), function () { setSound(!S.muted); BR.sfx.play('click'); });
    $('#toast').addEventListener('click', function () {
      var f = toastTap;
      if (!f) return;
      hideToast();
      f();
    });
    // the menu (フレンド, メッセージ, Car Owner, Shop, バイト, 詳細) and the quests (online)
    press($('#btn-radio'), function () {
      if (game.busy()) { BR.sfx.play('deny'); return; }
      BR.sfx.play('click');
      BR.social.open();
    });
    press($('#btn-quest'), function () {
      if (game.busy()) { BR.sfx.play('deny'); return; }
      BR.sfx.play('click');
      BR.quests.open();
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
    // iPhone: no pinch zoom; when the keyboard goes, the page goes back in
    // place (Safari may leave it scrolled up) before the layout catches up
    ['gesturestart', 'gesturechange'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
    });
    function settle() {
      if (typing()) return;
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
    // the keyboard takes a moment to go (and iOS to give the height back): lay
    // out again a few times instead of once with a half-restored window
    document.addEventListener('focusout', function () {
      setTimeout(settle, 60);
      [350, 800, 1500].forEach(function (ms) {
        setTimeout(function () { if (!typing()) { settle(); layout(); } }, ms);
      });
    });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { setTimeout(settle, 60); });
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
      renderWallet: renderWallet, toast: toast, renderBet: renderBet, view: view,
      reels: reels, fx: fx, spin: spin, serverBalance: serverBalance, setBet: setBet, bet: bet,
      watchEnter: watchEnter, watchExit: watchExit, watchSpin: watchSpin, watchBalance: watchBalance,
      relayout: function () { requestAnimationFrame(layout); }
    };
    reels.on('land', function (i) {
      BR.sfx.play('reelStop', i);
      if (i === 4) BR.sfx.stopReels();
      if (BR.slotfx) BR.slotfx.land(i);
    });
    reels.on('anticipate', function (i) {
      BR.sfx.play('anticipate');
      if (BR.slotfx) BR.slotfx.anticipate(i);
    });
    reels.on('allstopped', onAllStopped);
    // initial screen like the reference shot
    reels.setGrid([
      ['statue', 'diamond', 'revolver'],
      ['seven', 'seven', 'bar'],
      ['diamond', 'gold', 'star'],
      ['star', 'star', 'diamond'],
      ['bar', 'bar', 'bar']
    ]);
    if (BR.juice) BR.juice.init();
    if (BR.slotfx) BR.slotfx.init();
    BR.screens.init();
    BR.kit.init();
    BR.account.init();
    BR.avatars.init();
    BR.social.init();
    BR.cars.init();
    BR.shop.init();
    BR.peter.init();
    BR.johnson.init();
    BR.official.init();
    BR.presents.init();
    BR.safety.init();
    BR.push.init();
    BR.bonus.init();
    BR.quests.init();
    BR.jobs.init();
    BR.tree.init();
    BR.effects.init();
    BR.news.init();
    BR.call.init();
    BR.watch.init();
    if (BR.activity) BR.activity.init();
    if (BR.hub) BR.hub.init();
    if (BR.bigwin) BR.bigwin.init();
    if (BR.combo && BR.combo.init) BR.combo.init();
    if (BR.play && BR.play.init) BR.play.init();
    if (BR.feedback && BR.feedback.init) BR.feedback.init();
    if (BR.guide && BR.guide.init) BR.guide.init();
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
