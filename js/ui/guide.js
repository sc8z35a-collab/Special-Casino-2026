/* 初心者向けの案内ガイド: a walk through the slot screen and the menu for
   every player with less than 30 minutes of play who has not finished it
   (me.guide, from the server). A dimmed layer blocks everything but what a
   step points at, some steps wait for the player to tap (SPIN, the menu,
   戻る), and the Android back button does nothing (js/ui/install.js). The
   スキップ button (tapped twice: once more to be sure) ends it for good, as
   finishing does. Replayed from the menu (詳細) it can be closed and tells
   the server nothing. */
(function (BR) {
  'use strict';

  var U = BR.util, api = BR.api;
  var $ = U.$;
  var K = null;
  // the server has not heard "done" yet (a failed request): the player's id
  var PENDING = 'blockbuster-reels/guide-done';

  var run = null;      // the guide on screen (see start())
  var waitTimer = 0;   // waiting for a calm moment to start
  var calmCount = 0;
  var retried = false; // the "done" request was sent again this session

  /* ------------------------------------------------------------ the steps --- */
  function tab(name) { return '#board-tabs .tab[data-tab="' + name + '"]'; }
  var STEPS = [
    { screen: 'slot', title: 'ようこそ Two state Casino RP へ！',
      text: '遊び方をかんたんに案内します。\nまずはホーム画面から！' },
    { screen: 'slot', target: '.wallet', title: 'あなたの持ち物',
      text: 'チップはスピントークン（スロット用）、$ はドル、黄色いコインはロイヤルコイン（VIP用・タップで開発者支援）です。' },
    { screen: 'slot', target: '#btn-get', title: 'トークンを入手',
      text: '$ をスピントークンに交換できます。毎日1回、無料のトークンももらえます。' },
    { screen: 'slot', target: '.bet-group', title: 'ベット',
      text: '1回のスピンで賭けるトークンの数です。− と ＋ で変えられます。' },
    { screen: 'slot', target: '#btn-spin', round: true, spin: true, title: 'SPIN！',
      text: 'さっそく回してみましょう！\n光っている SPIN をタップしてください。',
      textIdle: 'SPIN でスロットが回ります。トークンがないときは「トークンを入手」で手に入れましょう。' },
    { screen: 'slot', target: '.win-group', title: '当たり',
      text: '当たると獲得トークンがここに出ます。連続で当たるとコンボに！' },
    { screen: 'slot', target: '#btn-charm', title: 'お守り加護',
      text: '使うと、次に負けたスピンでトークンの一部が戻ってきます。Shop で買えます。' },
    { screen: 'slot', target: '#btn-quest', round: true, title: 'クエスト',
      text: '達成したら「受け取る」でごほうびがもらえます（一括受け取りも可）。' },
    { screen: 'slot', target: '#me-card', title: 'プロフィール',
      text: 'あなたの名前とレベルです。タップでプロフィール・アイコン変更。' },
    { screen: 'slot', target: '#btn-radio', round: true, act: 'menu', title: 'メニュー',
      text: 'フレンドやメッセージはメニューから。\nメニューのボタンをタップしてみましょう！', hint: 'メニューをタップ' },
    { screen: 'board', target: tab('friends'), title: 'フレンド',
      text: 'ユーザー名で検索してフレンド申請。観戦やフレンド対決もできます。' },
    { screen: 'board', target: tab('messages'), title: 'メッセージ',
      text: 'フレンドやグループと会話できます。お金に困ったらマイクソン、金の生る木のことはジョンソンへ。' },
    { screen: 'board', target: [tab('cars'), tab('shop')], title: 'Car Owner と Shop',
      text: '車を買ってガレージに飾ったり、プレゼントしたり。Shop ではお守り加護などが買えます。' },
    { screen: 'board', target: tab('jobs'), title: 'バイト',
      text: 'バイトをすると、ゲームを閉じていてもお金がたまります。' },
    { screen: 'board', target: tab('more'), title: '詳細',
      text: 'Dev News・このガイド・運営へのフィードバックはここから。' },
    { screen: 'board', target: '#screen-board [data-action="back"]', act: 'back', title: 'ホームに戻ろう',
      text: '「戻る」でいつでもホーム画面に戻れます。', hint: '「戻る」をタップ' },
    { screen: 'slot', last: true, title: '準備OK！',
      text: '案内はおしまいです。\nスロットを楽しんでください！' }
  ];

  /* ------------------------------------------------------------ geometry --- */
  // A visible element (not hidden, not in a hidden screen, with a size).
  function visibleEl(el) {
    if (!el) return false;
    for (var n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function targetEls(st) {
    var sels = [].concat(st.target || []);
    var out = [];
    sels.forEach(function (sel) { var el = $(sel); if (visibleEl(el)) out.push(el); });
    return out;
  }
  // a screen rectangle in stage design px (the stage is scaled, and turned a
  // quarter clockwise on a phone held upright: see layout() in js/main.js)
  function toStage(r) {
    var st = $('#stage').getBoundingClientRect();
    var v = BR.app.view, s = v.s || 1;
    if (v.portrait) return { x: (r.top - st.top) / s, y: (st.right - r.right) / s, w: r.height / s, h: r.width / s };
    return { x: (r.left - st.left) / s, y: (r.top - st.top) / s, w: r.width / s, h: r.height / s };
  }
  function rectOf(els) {
    var box = null;
    els.forEach(function (el) {
      var r = toStage(el.getBoundingClientRect());
      if (!box) { box = r; return; }
      var x2 = Math.max(box.x + box.w, r.x + r.w), y2 = Math.max(box.y + box.h, r.y + r.h);
      box.x = Math.min(box.x, r.x);
      box.y = Math.min(box.y, r.y);
      box.w = x2 - box.x;
      box.h = y2 - box.y;
    });
    return box;
  }
  function px(node, key, v) {
    var s = Math.round(v * 2) / 2 + 'px';
    if (node.style[key] !== s) node.style[key] = s;
  }
  function box(node, x, y, w, h) {
    px(node, 'left', x);
    px(node, 'top', y);
    px(node, 'width', Math.max(0, w));
    px(node, 'height', Math.max(0, h));
  }
  function overlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }

  /* ------------------------------------------------------------ the overlay --- */
  function build() {
    var el = K.el;
    var root = el('div', 'guide');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', '初心者ガイド');
    var hole = el('div', 'gd-hole none');
    var ring = el('div', 'gd-ring');
    var blocks = [0, 1, 2, 3].map(function () { return el('div', 'gd-block'); });
    var arrow = el('i', 'gd-arrow');
    var bubble = el('div', 'gd-bubble');
    bubble.setAttribute('aria-live', 'polite');
    var head = el('div', 'gd-head');
    head.appendChild(el('span', 'gd-badge', 'GUIDE'));
    var count = el('span', 'gd-count');
    head.appendChild(count);
    var close = el('button', 'gd-close', '閉じる');
    close.type = 'button';
    head.appendChild(close);
    var skip = el('button', 'gd-close gd-skip', 'スキップ');
    skip.type = 'button';
    head.appendChild(skip);
    bubble.appendChild(head);
    var bar = el('div', 'gd-bar');
    var fill = el('i');
    bar.appendChild(fill);
    bubble.appendChild(bar);
    var title = el('h3', 'gd-title');
    var text = el('p', 'gd-text');
    bubble.appendChild(title);
    bubble.appendChild(text);
    var foot = el('div', 'gd-foot');
    var hint = el('span', 'gd-hint');
    hint.appendChild(el('i', 'gd-tap'));
    var hintText = el('span');
    hint.appendChild(hintText);
    foot.appendChild(hint);
    var next = el('button', 'act-btn gold gd-next', '次へ');
    next.type = 'button';
    foot.appendChild(next);
    bubble.appendChild(foot);
    root.appendChild(hole);
    root.appendChild(ring);
    blocks.forEach(function (b) { root.appendChild(b); });
    root.appendChild(arrow);
    root.appendChild(bubble);
    next.addEventListener('click', function () { if (run && !run.act) { K.sfx('click'); advance(); } });
    close.addEventListener('click', function () { if (run && run.replay) { K.sfx('click'); finish(false); } });
    // the first tap asks, a second one within a few seconds skips
    var armed = 0;
    skip.addEventListener('click', function () {
      if (!run || run.replay) return;
      K.sfx('click');
      if (Date.now() - armed < 3500) { finish('skip'); return; }
      armed = Date.now();
      skip.textContent = 'もう一度タップでスキップ';
      skip.classList.add('sure');
      setTimeout(function () { skip.textContent = 'スキップ'; skip.classList.remove('sure'); }, 3500);
    });
    $('#stage').appendChild(root);
    return {
      root: root, hole: hole, ring: ring, blocks: blocks, arrow: arrow, bubble: bubble, count: count, close: close, skip: skip,
      fill: fill, title: title, text: text, hint: hint, hintText: hintText, next: next
    };
  }

  /* ------------------------------------------------------------ running --- */
  function bet() { return BR.app.bet ? BR.app.bet() : BR.CONFIG.bets[BR.store.state.betIndex]; }
  function canSpin() { return BR.bank.ready() && BR.store.state.tokens >= bet() && !BR.game.busy(); }

  function start(replay) {
    if (run || !api.online) return;
    var me = BR.social && BR.social.me();
    if (!me) return;
    K = K || BR.kit;
    clearTimeout(waitTimer);
    waitTimer = 0;
    if (BR.entry && BR.entry.isOpen()) BR.entry.close();
    run = { replay: !!replay, uid: me.id, i: -1, step: null, act: null, phase: '', timers: [], dom: build() };
    // notices stay readable above the dimmed screen
    $('#stage').classList.add('guide-on');
    run.poll = BR.clock.every(tick, 250);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    window.addEventListener('resize', onResize);
    go(0);
    // from here on the spotlight and the card glide from step to step
    var root = run && run.dom.root;
    if (root) requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('gd-ready'); }); });
  }

  function later(ms, fn) {
    var R = run;
    if (!R) return;
    R.timers.push(setTimeout(function () { if (run === R) fn(); }, ms));
  }
  function clearTimers(R) {
    R.timers.forEach(clearTimeout);
    R.timers = [];
    clearTimeout(R.fix);
  }

  // The next step that can be shown from `i` on (on its screen, its target visible).
  function go(i) {
    var R = run;
    if (!R) return;
    clearTimers(R);
    R.step = null;
    R.act = null;
    for (; i < STEPS.length; i++) {
      var st = STEPS[i];
      if (st.screen && BR.screens.current() !== st.screen) {
        if (st.screen === 'board') { if (BR.social && BR.social.open) BR.social.open('friends'); }
        else BR.screens.show(st.screen);
      }
      if (!st.target || targetEls(st).length) break;
    }
    if (i >= STEPS.length) { finish(true); return; }
    R.i = i;
    R.step = STEPS[i];
    render();
  }
  function advance() { if (run) go(run.i + 1); }

  function render() {
    var R = run, st = R.step, d = R.dom;
    var act = st.act || (st.spin && canSpin() ? 'spin' : null);
    R.act = act;
    R.phase = act ? 'armed' : '';
    R.clicked = 0;
    R.calm = 0;
    d.count.textContent = (R.i + 1) + ' / ' + STEPS.length;
    d.fill.style.width = Math.round((R.i + 1) / STEPS.length * 100) + '%';
    d.title.textContent = st.title;
    d.text.textContent = st.spin && !act ? st.textIdle : st.text;
    d.hintText.textContent = act === 'spin' ? 'SPIN をタップ' : st.hint || '';
    d.hint.hidden = !act;
    d.next.hidden = !!act;
    d.next.textContent = st.last ? 'はじめる！' : '次へ';
    d.close.hidden = !R.replay;
    d.skip.hidden = R.replay;
    d.root.classList.toggle('gd-act', !!act);
    d.root.classList.toggle('gd-intro', !st.target);
    d.root.classList.remove('gd-wait');
    d.bubble.classList.remove('gd-in');
    void d.bubble.offsetWidth;
    d.bubble.classList.add('gd-in');
    place();
  }

  // Puts the hole, the blockers, the arrow and the card where they belong
  // (again on every tick: the layout may change under the guide).
  function place() {
    var R = run;
    if (!R || !R.step) return;
    var d = R.dom, st = R.step;
    var W = d.root.offsetWidth, H = d.root.offsetHeight;
    var hole = null;
    if (st.target) {
      var els = targetEls(st);
      if (!els.length) {
        // it went away: move on (an interactive step waits for its screen change)
        if (!R.act) later(0, advance);
        return;
      }
      var r = rectOf(els);
      var pad = st.round ? 12 : 14;
      hole = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
      if (st.round) {
        var m = Math.max(hole.w, hole.h);
        hole.x -= (m - hole.w) / 2;
        hole.y -= (m - hole.h) / 2;
        hole.w = hole.h = m;
      }
    }
    var rad = !hole ? 0 : st.round ? hole.w / 2 : 22;
    if (hole) {
      box(d.hole, hole.x, hole.y, hole.w, hole.h);
      box(d.ring, hole.x, hole.y, hole.w, hole.h);
      var br = Math.round(rad) + 'px';
      if (d.hole.style.borderRadius !== br) d.hole.style.borderRadius = d.ring.style.borderRadius = br;
      d.hole.classList.remove('none');
    } else {
      box(d.hole, W / 2, H / 2, 0, 0);
      d.hole.classList.add('none');
    }
    // taps go through the hole only when the step asks for them
    var b = d.blocks;
    if (hole && R.act) {
      box(b[0], 0, 0, W, hole.y);
      box(b[1], 0, hole.y + hole.h, W, H - hole.y - hole.h);
      box(b[2], 0, hole.y, hole.x, hole.h);
      box(b[3], hole.x + hole.w, hole.y, W - hole.x - hole.w, hole.h);
    } else {
      box(b[0], 0, 0, W, H);
      for (var i = 1; i < 4; i++) box(b[i], 0, 0, 0, 0);
    }
    // the card: below, above, left or right of the hole, never off the stage
    var bw = d.bubble.offsetWidth, bh = d.bubble.offsetHeight;
    var M = 60, gap = 34, side = '', bx, by;
    if (!hole) {
      bx = (W - bw) / 2;
      by = (H - bh) / 2;
    } else if (H - (hole.y + hole.h) - gap - M >= bh) {
      side = 'top';
      bx = hole.x + hole.w / 2 - bw / 2;
      by = hole.y + hole.h + gap;
    } else if (hole.y - gap - M >= bh) {
      side = 'bottom';
      bx = hole.x + hole.w / 2 - bw / 2;
      by = hole.y - gap - bh;
    } else if (hole.x - gap - M >= bw) {
      side = 'right';
      bx = hole.x - gap - bw;
      by = hole.y + hole.h / 2 - bh / 2;
    } else if (W - (hole.x + hole.w) - gap - M >= bw) {
      side = 'left';
      bx = hole.x + hole.w + gap;
      by = hole.y + hole.h / 2 - bh / 2;
    } else {
      bx = (W - bw) / 2;
      by = H - bh - M;
    }
    bx = U.clamp(bx, M, Math.max(M, W - bw - M));
    by = U.clamp(by, 20, Math.max(20, H - bh - 20));
    px(d.bubble, 'left', bx);
    px(d.bubble, 'top', by);
    if (d.bubble.dataset.side !== side) d.bubble.dataset.side = side;
    if (side) {
      var t = side === 'top' || side === 'bottom'
        ? U.clamp(hole.x + hole.w / 2 - bx, 44, bw - 44)
        : U.clamp(hole.y + hole.h / 2 - by, 44, bh - 44);
      d.bubble.style.setProperty('--tail', Math.round(t) + 'px');
    }
    placeArrow(d, hole, { x: bx, y: by, w: bw, h: bh }, W, H);
  }

  // a bouncing arrow at the hole of a step that waits for a tap
  function placeArrow(d, hole, card, W, H) {
    var a = d.arrow;
    if (!hole || !run.act) return;
    var S = 64, g = 14;
    var spots = [
      { dir: 'down', x: hole.x + hole.w / 2 - S / 2, y: hole.y - g - S },
      { dir: 'up', x: hole.x + hole.w / 2 - S / 2, y: hole.y + hole.h + g },
      { dir: 'right', x: hole.x - g - S, y: hole.y + hole.h / 2 - S / 2 },
      { dir: 'left', x: hole.x + hole.w + g, y: hole.y + hole.h / 2 - S / 2 }
    ];
    var pick = spots[0];
    for (var i = 0; i < spots.length; i++) {
      var p = spots[i], r = { x: p.x, y: p.y, w: S, h: S };
      if (p.x >= 8 && p.y >= 8 && p.x + S <= W - 8 && p.y + S <= H - 8 && !overlap(r, card)) { pick = p; break; }
    }
    px(a, 'left', pick.x);
    px(a, 'top', pick.y);
    if (a.dataset.dir !== pick.dir) a.dataset.dir = pick.dir;
  }

  function tick() {
    var R = run;
    if (!R || !R.step) return;
    var now = Date.now(), g = BR.game;
    if (R.act === 'spin') {
      if (R.phase === 'armed' && g.busy()) {
        // the reels are turning: out of the way until the result has been shown
        R.phase = 'running';
        R.ran = now;
        R.dom.root.classList.add('gd-wait');
      } else if (R.phase === 'running') {
        if (g.busy()) R.calm = 0;
        else if (!R.calm) R.calm = now;
        if ((R.calm && now - R.calm > 700) || now - R.ran > 20000) {
          R.phase = 'done';
          advance();
          return;
        }
      } else if (R.phase === 'armed' && !canSpin() && !g.busy()) {
        // no tokens any more (or the server went away): just explain it
        render();
        return;
      }
    } else if (R.act === 'menu') {
      if (R.phase === 'armed' && BR.screens.current() === 'board') {
        R.phase = 'done';
        // the menu may open on any tab: show them all from フレンド
        if (BR.social && BR.social.open) BR.social.open('friends');
        later(450, advance);
      }
    } else if (R.act === 'back') {
      if (R.phase === 'armed' && BR.screens.current() === 'slot') {
        R.phase = 'done';
        later(350, advance);
      } else if (R.phase === 'armed' && R.clicked && now - R.clicked > 900 && BR.screens.current() === 'board') {
        // 戻る stepped back inside the menu: home it is
        BR.screens.show('slot');
      }
    }
    if (R.phase !== 'done') place();
  }

  // a screen the step did not ask for (no tokens -> the token screen ...): back
  function screenChanged(name) {
    var R = run;
    if (!R || !R.step || R.act === 'menu' || R.act === 'back') return;
    var want = R.step.screen;
    if (!want || want === name) return;
    clearTimeout(R.fix);
    R.fix = setTimeout(function () {
      if (run !== R || !R.step || R.step.screen !== want || BR.screens.current() === want) return;
      if (want === 'board') { if (BR.social && BR.social.open) BR.social.open('friends'); }
      else BR.screens.show(want);
    }, 400);
  }

  function onClick(e) {
    var R = run;
    if (!R || R.act !== 'back' || !e.target || !e.target.closest) return;
    if (e.target.closest('#screen-board [data-action="back"]')) R.clicked = Date.now();
  }

  // the keyboard: Enter/Space for 次へ (and SPIN on its step); Escape and
  // Tab do nothing (Escape closes a replay)
  function onKey(e) {
    var R = run;
    if (!R) return;
    var k = e.key, space = e.code === 'Space' || k === ' ';
    if (!space && k !== 'Enter' && k !== 'Escape' && k !== 'Tab') return;
    if (R.act === 'spin' && R.phase === 'armed' && (space || k === 'Enter')) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'Escape' && R.replay) { finish(false); return; }
    if ((k === 'Enter' || space) && !R.act && !e.repeat) { K.sfx('click'); advance(); }
  }

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(place, 120);
  }

  // `completed`: the last step was reached, or 'skip' (skipped: done as well);
  // else it was closed or the player signed out
  function finish(completed) {
    var R = run;
    if (!R) return;
    run = null;
    clearTimers(R);
    BR.clock.drop(R.poll);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('resize', onResize);
    var root = R.dom.root;
    $('#stage').classList.remove('guide-on');
    root.classList.add('gd-out');
    setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, 320);
    if (!completed) return;
    if (completed === 'skip') {
      K.toast('ガイドは「詳細」からいつでも見られます', 3600);
      sendDone(R.uid);
      return;
    }
    K.sfx('notify');
    if (R.replay) { K.toast('ガイドを最後まで見ました', 2600); return; }
    K.toast('ガイド完了！楽しんでください', 3200);
    sendDone(R.uid);
  }

  /* ------------------------------------------------------------ done, on the server --- */
  function pendingFor(uid) {
    try { return localStorage.getItem(PENDING) === String(uid); } catch (e) { return false; }
  }
  function setPending(uid) {
    try { if (uid) localStorage.setItem(PENDING, String(uid)); else localStorage.removeItem(PENDING); } catch (e) { /* memory only */ }
  }
  var doneHere = 0;   // finished on this device in this session (the server may not know yet)
  function sendDone(uid) {
    doneHere = uid;
    setPending(uid);
    api.guideDone().then(function (r) {
      setPending(null);
      if (r && r.me && BR.social.me() && BR.social.me().id === r.me.id) BR.social.setMe(r.me);
    }, function () { /* sent again at the next start */ });
  }

  /* ------------------------------------------------------------ when to start --- */
  // Nothing else on screen: the logos and the story are over, no sign-up,
  // login bonus, thank-you, dialog or text field, the slot is on, not watching.
  function calm() {
    var L = BR.launch;
    if (!L || !L.done() || L.maintenance()) return false;
    if (BR.account && BR.account.isOpen()) return false;
    if (BR.bonus && BR.bonus.busy()) return false;
    var th = $('#thanks');
    if (th && !th.hidden) return false;
    if (document.querySelector('#stage .modal:not([hidden]), .ov:not([hidden])')) return false;
    if (BR.entry && BR.entry.isOpen()) return false;
    if (BR.feedback && BR.feedback.isOpen && BR.feedback.isOpen()) return false;
    if (BR.screens.current() !== 'slot') return false;
    if (BR.watch && BR.watch.active && BR.watch.active()) return false;
    if (BR.game && BR.game.busy()) return false;
    return !document.hidden;
  }
  function schedule() {
    if (run || waitTimer) return;
    waitTimer = setTimeout(function () {
      waitTimer = 0;
      var me = BR.social.me();
      if (!me || !me.guide || run) { calmCount = 0; return; }
      // calm twice in a row: whatever was about to open (the login bonus ...) has
      calmCount = calm() ? calmCount + 1 : 0;
      if (calmCount >= 2) { calmCount = 0; start(false); return; }
      schedule();
    }, 700);
  }

  function onMe(me) {
    if (!me) {
      clearTimeout(waitTimer);
      waitTimer = 0;
      if (run) finish(false);
      return;
    }
    if (!me.guide) return;
    // finished here already: the server only has to hear it (once more a session)
    if (doneHere === me.id || pendingFor(me.id)) {
      if (!retried) { retried = true; sendDone(me.id); }
      return;
    }
    if (!run) schedule();
  }

  function init() {
    K = BR.kit;
    if (BR.social && BR.social.me()) onMe(BR.social.me());
    if (!api.online) return;
    if (BR.social && BR.social.onMe) BR.social.onMe(onMe);
    BR.screens.onChange(function (name) { if (run) screenChanged(name); });
  }

  BR.guide = {
    init: init,
    // replay: from the menu (詳細), may be closed, the server is not told
    start: function (replay) {
      if (run) return;
      if (replay) {
        if (BR.screens.current() !== 'slot') BR.screens.show('slot');
        if (BR.game && BR.game.busy()) { K.sfx('deny'); K.toast('スピンが終わってからお試しください'); return; }
        if (BR.watch && BR.watch.active && BR.watch.active()) { K.sfx('deny'); K.toast('観戦中はガイドを見られません'); return; }
      }
      start(replay);
    },
    active: function () { return !!run; }
  };
})(window.BR = window.BR || {});
