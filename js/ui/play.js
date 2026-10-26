/* Playing with friends (the client side of server/core/api.js):
   - フレンド対決: two friends spin the same number of times at one bet; the
     larger total win wins. The bet stays put until the player's spins are
     done, and the result goes into their chat.
   - 協力スロット: the players of a group sit at one table; every bet fills
     the group's gauge, and a full gauge pays everyone who bet in the round.
   - 観戦ベット: someone watching a friend stakes spin tokens on whether the
     friend gets a BIG WIN (or better) within their next spins.
   The live state shows as ribbons at the top middle of the slot screen
   (#mode-stack); results wait until the reels have stopped. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, S = BR.store.state;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;

  var meId = 0;
  var battle = null;     // my battle: live, or my invitation waiting for an answer
  var incoming = null;   // a friend's invitation on screen
  var coop = null;       // the table I sit at: { group, name, gauge, goal, players }
  var coopLoading = 0;   // the group being looked up
  var bet = null;        // my open 観戦ベット
  var betHost = null;    // { id, name } of the player it is on
  var host = null;       // the player I watch
  var ticker = 0, betTimer = 0, lastAsk = 0;
  var ui = {};           // dialogs and ribbons, made at init()
  // live updates applied later (after the reels) must not undo newer ones:
  // each gets a number in the order it arrived
  var seq = { battle: 0, battleShown: 0, coop: 0, coopShown: 0 };

  function cfg(k) { return BR.CONFIG[k]; }
  function myId() { var m = BR.social && BR.social.me(); return m ? m.id : 0; }
  function reelsBusy() { return !!(BR.game && BR.game.busy()); }
  // results wait for the reels: nothing is given away before they stop
  function whenIdle(fn) {
    var t0 = Date.now();
    (function wait() {
      if (!reelsBusy() || Date.now() - t0 > 12000) fn();
      else setTimeout(wait, 200);
    })();
  }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var pad = function (v) { return v < 10 ? '0' + v : String(v); };
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(s % 60);
  }
  function chip(n, cls) { return K.amountEl(n, 'tokens', cls); }
  function button(cls, label, act) {
    var b = el('button', cls, label);
    b.type = 'button';
    if (act) b.dataset.act = act;
    return b;
  }
  function clear(node) { node.textContent = ''; return node; }
  function sideText(side) { return side === 'hit' ? '出る' : '出ない'; }

  // A dialog inside the stage, below the yes/no box (which must stay on top).
  function makeModal(id, cls) {
    var m = el('div', 'modal pl-modal');
    m.id = id;
    m.hidden = true;
    var card = el('div', 'modal-card pl-card ' + cls);
    card.setAttribute('role', 'dialog');
    var x = el('button', 'modal-x');
    x.type = 'button';
    x.setAttribute('data-close', '');
    x.setAttribute('aria-label', '閉じる');
    card.appendChild(x);
    var title = el('h3', 'modal-title');
    card.appendChild(title);
    var body = el('div', 'pl-body');
    card.appendChild(body);
    m.appendChild(card);
    var stage = $('#stage'), confirm = $('#confirm');
    stage.insertBefore(m, confirm && confirm.parentNode === stage ? confirm : null);
    K.registerModal(id);
    return { id: id, root: m, title: title, body: body };
  }
  // "<name>さん<rest>" with the name cut short when it is long
  function titled(m, name, rest) {
    clear(m.title);
    if (name) m.title.appendChild(el('span', 'uname', name));
    m.title.appendChild(el('span', '', rest));
  }
  // a row of choices; the chosen one is .active
  function choices(cls, items, value, onPick) {
    var row = el('div', 'pl-choices ' + cls);
    items.forEach(function (it) {
      var b = el('button', 'pl-choice' + (it.value === value ? ' active' : ''));
      b.type = 'button';
      b.dataset.v = String(it.value);
      if (it.chip) b.appendChild(chip(it.value));
      else b.appendChild(el('span', '', it.label));
      if (it.sub) b.appendChild(el('small', '', it.sub));
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(row.children, function (c) { c.classList.toggle('active', c === b); });
        sfx('click');
        onPick(it.value);
      });
      row.appendChild(b);
    });
    return row;
  }

  /* ================================================================ フレンド対決 */

  /* ----- asking a friend ----- */
  var ask = { user: null, spins: 0, bet: 0, busy: false };
  function challenge(user) {
    if (!api.online || !user) return;
    if (!myId()) { sfx('deny'); toast('ログインしてからお試しください'); return; }
    if (battle) { sfx('deny'); toast(battle.state === 'live' ? '対決が終わってから申し込んでください' : '返事を待っている対決があります'); return; }
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです', 3200); return; }
    var spins = cfg('battle').spins;
    ask.user = { id: user.id, name: user.name, avatar: user.avatar };
    ask.spins = ask.spins && spins.indexOf(ask.spins) >= 0 ? ask.spins : spins[0];
    ask.bet = BR.app.bet ? BR.app.bet() : cfg('bets')[0];
    ask.busy = false;
    renderAsk();
    K.closeModals();
    K.showModal(ui.ask.id);
  }
  function renderAsk() {
    var m = ui.ask, b = clear(m.body);
    titled(m, ask.user.name, 'さんにフレンド対決を申し込む');
    var head = el('div', 'pl-vs-head');
    head.appendChild(K.avatarEl(BR.social.me() || {}, 'sm'));
    head.appendChild(el('b', 'pl-vs-badge', 'VS'));
    head.appendChild(K.avatarEl(ask.user, 'sm'));
    head.appendChild(el('p', 'pl-lead', '同じ回数を同じベットで回して、獲得トークンの多いほうが勝ち！'));
    b.appendChild(head);
    b.appendChild(el('div', 'pl-label', '回数'));
    b.appendChild(choices('pl-spins', cfg('battle').spins.map(function (n) { return { value: n, label: n + '回' }; }), ask.spins, function (v) {
      ask.spins = v;
      renderNeed();
    }));
    b.appendChild(el('div', 'pl-label', 'ベット'));
    b.appendChild(choices('pl-bets', cfg('bets').map(function (n) { return { value: n, chip: true }; }), ask.bet, function (v) {
      ask.bet = v;
      renderNeed();
    }));
    var need = el('p', 'pl-note');
    need.id = 'pl-ask-need';
    b.appendChild(need);
    var acts = el('div', 'pl-acts');
    var go = button('act-btn gold', '申し込む', 'go');
    go.id = 'pl-ask-go';
    go.addEventListener('click', sendAsk);
    acts.appendChild(go);
    b.appendChild(acts);
    renderNeed();
  }
  function renderNeed() {
    var n = $('#pl-ask-need');
    if (!n) return;
    var most = ask.bet * ask.spins;
    clear(n);
    n.appendChild(document.createTextNode('使うトークンは最大 '));
    n.appendChild(chip(most, 'pl-inline'));
    n.appendChild(document.createTextNode('（' + ask.spins + '回 × ' + U.fmt(ask.bet) + '）'));
    n.classList.toggle('warn', S.tokens < most);
    if (S.tokens < most) n.appendChild(el('span', 'pl-warn', '　手持ちが足りなくなるかもしれません'));
    $('#pl-ask-go').disabled = ask.busy;
  }
  function sendAsk() {
    if (ask.busy || !ask.user) return;
    ask.busy = true;
    renderNeed();
    sfx('click');
    api.challenge(ask.user.id, ask.spins, ask.bet).then(function (r) {
      ask.busy = false;
      K.closeModal(ui.ask.id);
      setBattle(r.battle);
      sfx('send');
      toast(ask.user.name + 'さんにフレンド対決を申し込みました', 3000);
    }, function (err) {
      ask.busy = false;
      renderNeed();
      fail(err);
    });
  }

  /* ----- a friend asks me ----- */
  var inviteBox = null;
  function showInvite(b) {
    incoming = b;
    // not on top of the beginner guide: it waits (an invitation lasts minutes)
    if (BR.guide && BR.guide.active && BR.guide.active()) {
      setTimeout(function () { if (incoming === b) showInvite(b); }, 1500);
      return;
    }
    closeInviteBox();
    var o = b.other;
    var wrap = el('div', 'call-in pl-invite');
    var card = el('div', 'call-card pl-invite-card');
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-label', 'フレンド対決');
    card.appendChild(K.avatarEl(o, 'big'));
    var text = el('div', 'call-in-text');
    var who = el('div', 'call-in-who');
    who.appendChild(el('b', 'uname', o.name));
    who.appendChild(el('span', '', 'さんから'));
    text.appendChild(who);
    text.appendChild(el('div', 'call-in-what', 'フレンド対決の申し込み！'));
    var small = el('small', '');
    small.appendChild(document.createTextNode(b.spins + '回・ベット ' + U.fmt(b.bet) + ' で勝負'));
    var left = el('span', 'pl-invite-left');
    small.appendChild(left);
    text.appendChild(small);
    card.appendChild(text);
    var acts = el('div', 'call-in-acts');
    var no = button('call-btn decline', '', 'no');
    no.appendChild(el('span', 'pl-x-mark'));
    no.appendChild(el('span', '', 'あとで'));
    var yes = button('call-btn accept', '', 'yes');
    yes.appendChild(K.icon('check'));
    yes.appendChild(el('span', '', '受ける'));
    acts.appendChild(no);
    acts.appendChild(yes);
    card.appendChild(acts);
    wrap.appendChild(card);
    $('#stage').appendChild(wrap);
    inviteBox = { root: wrap, left: left, battle: b };
    no.addEventListener('click', function () { answer(b, false); });
    yes.addEventListener('click', function () { answer(b, true); });
    sfx('ring');
    tickNow();
  }
  function closeInviteBox() {
    if (!inviteBox) return;
    if (inviteBox.root.parentNode) inviteBox.root.parentNode.removeChild(inviteBox.root);
    inviteBox = null;
  }
  function answer(b, yes) {
    if (!inviteBox || inviteBox.busy) return;
    inviteBox.busy = true;
    sfx('click');
    api.battleRespond(b.id, yes).then(function (r) {
      incoming = null;
      closeInviteBox();
      if (yes && r.battle) startLive(r.battle, false);
    }, function (err) {
      incoming = null;
      closeInviteBox();
      fail(err);
    });
  }

  /* ----- the battle ----- */
  function setBattle(b) {
    battle = b && (b.state === 'live' || (b.state === 'invite' && b.from === myId())) ? b : null;
    renderBattle();
    applyBet();
  }
  function startLive(b, quiet) {
    setBattle(b);
    if (quiet) return;
    sfx('notify');
    if (BR.watch && BR.watch.active()) {
      toast('フレンド対決スタート！ホームを出てスロットを回しましょう', 3600);
      return;
    }
    if (BR.screens.current() !== 'slot') BR.screens.show('slot');
    toast('フレンド対決スタート！ベット ' + U.fmt(b.bet) + ' で ' + b.spins + '回回そう', 3400);
    if (BR.juice) {
      BR.juice.banner('対決スタート！', 'chance', 1500, b.spins + '回勝負');
      BR.juice.flash('#ffd27a', 0.2, 300);
    }
  }
  function betLocked() { return !!battle && battle.state === 'live' && battle.me.n < battle.spins; }
  // the battle's bet: set as soon as the reels allow it
  function applyBet() {
    clearTimeout(betTimer);
    if (!betLocked() || !BR.app || !BR.app.setBet) return;
    if (BR.app.bet() === battle.bet) return;
    if (!BR.app.setBet(battle.bet)) betTimer = setTimeout(applyBet, 400);
  }

  function renderBattle() {
    var r = ui.battle;
    clear(r);
    r.hidden = !battle;
    r.classList.toggle('wait', !!battle && battle.state === 'invite');
    if (!battle) return;
    var b = battle;
    r.appendChild(el('b', 'pl-vs-badge', 'VS'));
    r.appendChild(K.avatarEl(b.other, 'pl-av'));
    var who = el('span', 'pl-who');
    who.appendChild(el('span', 'uname', b.other.name));
    who.appendChild(el('small', '', b.spins + '回・ベット ' + U.fmt(b.bet)));
    r.appendChild(who);
    if (b.state === 'invite') {
      var w = el('span', 'pl-wait-text', '返事を待っています…');
      w.appendChild(el('b', 'pl-left'));
      r.appendChild(w);
      r.appendChild(button('pl-mini', '取り消す', 'cancel'));
    } else {
      r.appendChild(score('あなた', b.me, b.spins, b.me.won >= b.other.won && b.me.won > 0));
      r.appendChild(score('相手', b.other, b.spins, b.other.won > b.me.won));
      var t = el('span', 'pl-time');
      t.appendChild(el('small', '', '残り'));
      t.appendChild(el('b', 'pl-left'));
      r.appendChild(t);
      r.appendChild(button('pl-mini', 'やめる', 'quit'));
    }
    tickNow();
  }
  function score(label, side, spins, ahead) {
    var s = el('span', 'pl-score' + (ahead ? ' ahead' : '') + (side.n >= spins ? ' done' : ''));
    var top = el('span', 'pl-score-top');
    top.appendChild(el('small', '', label));
    top.appendChild(el('i', '', side.n >= spins ? '完了' : side.n + '/' + spins));
    s.appendChild(top);
    s.appendChild(chip(side.won, 'pl-score-amt'));
    return s;
  }
  function onBattleClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b || !battle) return;
    var cur = battle;
    if (b.dataset.act === 'cancel') {
      sfx('click');
      api.battleQuit(cur.id).then(function () {
        if (battle && battle.id === cur.id) setBattle(null);
        toast('フレンド対決の申し込みを取り消しました');
      }, fail);
    } else if (b.dataset.act === 'quit') {
      sfx('click');
      K.confirmBox(function (p) {
        p.appendChild(document.createTextNode('フレンド対決をやめますか？'));
        p.appendChild(el('small', 'confirm-sub', 'やめると ' + cur.other.name + 'さんの勝ちになります。'));
      }, 'やめる').then(function (ok) {
        if (ok) api.battleQuit(cur.id).catch(fail);
      });
    }
  }

  // 勝ち / 負け / 引き分け, after the reels have stopped
  var resultBox = null, resultTimer = 0;
  function showResult(b) {
    closeResult();
    var me = myId();
    var win = b.winner === me, draw = b.winner === 0;
    var wrap = el('div', 'pl-result ' + (win ? 'win' : draw ? 'draw' : 'lose'));
    var card = el('div', 'pl-result-card');
    card.setAttribute('role', 'dialog');
    card.appendChild(el('div', 'pl-result-kicker', 'フレンド対決（' + b.spins + '回・ベット ' + U.fmt(b.bet) + '）'));
    card.appendChild(el('div', 'pl-result-title', win ? '勝ち！' : draw ? '引き分け' : '負け…'));
    var row = el('div', 'pl-result-row');
    row.appendChild(resultSide(BR.social.me() || b.me, 'あなた', b.me.won, win));
    row.appendChild(el('b', 'pl-vs-badge', 'VS'));
    row.appendChild(resultSide(b.other, b.other.name, b.other.won, !win && !draw));
    card.appendChild(row);
    var note = b.quit ? (b.quit === me ? 'あなたがやめたので、' + b.other.name + 'さんの勝ちです' : b.other.name + 'さんがやめました') : 'タップで閉じる';
    card.appendChild(el('small', 'pl-result-note', note));
    wrap.appendChild(card);
    wrap.addEventListener('click', closeResult);
    $('#stage').appendChild(wrap);
    resultBox = wrap;
    sfx(win ? 'bigWin' : draw ? 'notify' : 'callEnd');
    // a win is a party; a loss just sinks in
    var J = BR.juice;
    if (J && win) {
      setTimeout(function () {
        if (resultBox !== wrap) return;
        J.celebrate(card.querySelector('.pl-result-title'), 3);
        J.rain({ kind: 'confetti', dur: 2.2, rate: 46 });
      }, 280);
    } else if (J && draw) {
      J.celebrate(card.querySelector('.pl-result-title'), 1);
    }
    resultTimer = setTimeout(closeResult, 4500);
  }
  function resultSide(u, label, won, best) {
    var s = el('div', 'pl-side' + (best ? ' best' : ''));
    s.appendChild(K.avatarEl(u, 'sm'));
    s.appendChild(el('span', 'pl-side-name uname', label));
    s.appendChild(chip(won, 'pl-side-amt'));
    return s;
  }
  function closeResult() {
    clearTimeout(resultTimer);
    if (resultBox && resultBox.parentNode) resultBox.parentNode.removeChild(resultBox);
    resultBox = null;
  }

  function onBattle(ev) {
    var b = ev && ev.battle;
    if (!b || !myId()) return;
    switch (ev.type) {
      case 'invite':
        showInvite(b);
        break;
      case 'start':
        // my invitation was accepted (also when it was sent from another screen or device)
        if (b.state === 'live') startLive(b, false);
        break;
      case 'step':
        var n = ++seq.battle;
        whenIdle(function () {
          if (!battle || battle.id !== b.id || n < seq.battleShown) return;
          seq.battleShown = n;
          setBattle(b);
        });
        break;
      case 'done':
        if (incoming && incoming.id === b.id) { incoming = null; closeInviteBox(); }
        seq.battleShown = ++seq.battle;
        whenIdle(function () {
          if (battle && battle.id === b.id) setBattle(null);
          showResult(b);
        });
        break;
      case 'declined':
        if (battle && battle.id === b.id) {
          setBattle(null);
          sfx('deny');
          toast(b.other.name + 'さんは今は対決できないようです', 3200);
        }
        break;
      case 'cancelled':
        if (incoming && incoming.id === b.id) {
          incoming = null;
          closeInviteBox();
          toast(b.other.name + 'さんが対決の申し込みを取り消しました', 3000);
        }
        break;
    }
  }

  // after (re)connecting: an invitation or a battle still going on
  var restoreTimer = 0;
  // (`known`: the answer the connection's hello brought)
  function restoreBattle(known) {
    clearTimeout(restoreTimer);
    (known || api.battle()).then(function (r) {
      var b = r.battle;
      if (!b) {
        if (battle) setBattle(null);
        if (incoming) { incoming = null; closeInviteBox(); }
        return;
      }
      if (b.state === 'invite' && b.from !== myId()) {
        if (!incoming || incoming.id !== b.id) showInvite(b);
        return;
      }
      setBattle(b);
    }, function () { /* tried again on the next connection */ });
  }

  /* ================================================================ 協力スロット */

  function coopOpen(group) {
    if (!api.online || !group) return;
    var m = ui.coop;
    m.group = group;
    titled(m, group.name, 'の協力スロット');
    renderCoopPanel(null, false);
    K.closeModals();
    K.showModal(m.id);
    api.coop(group.id).then(function (r) {
      if (m.group !== group || !K.isOpen(m.id)) return;
      renderCoopPanel(r.coop, r.seated);
    }, function (err) {
      K.closeModal(m.id);
      fail(err);
    });
  }
  function gaugeEl(gauge, goal, big) {
    var g = el('div', 'pl-gauge' + (big ? ' big' : ''));
    var pct = goal > 0 ? Math.min(100, gauge / goal * 100) : 0;
    var fill = el('i', 'pl-fill');
    fill.style.width = pct.toFixed(1) + '%';
    g.appendChild(fill);
    var t = el('span', 'pl-gauge-text');
    if (big) {
      t.appendChild(chip(gauge));
      t.appendChild(el('span', 'pl-of', ' / ' + U.fmt(goal)));
    } else {
      t.textContent = Math.floor(pct) + '%';
    }
    g.appendChild(t);
    return g;
  }
  function renderCoopPanel(c, seated) {
    var m = ui.coop, b = clear(m.body);
    var rate = Math.round(cfg('coop').bonus * 100);
    b.appendChild(el('p', 'pl-lead', 'みんなのベットが1つのゲージにたまり、満タンになると、そのラウンドで賭けたトークンの' + rate + '%が全員にボーナスで入ります。'));
    if (!c) { b.appendChild(el('div', 'pl-empty', '読み込み中…')); return; }
    b.appendChild(el('div', 'pl-label', '協力ゲージ'));
    b.appendChild(gaugeEl(c.gauge, c.goal, true));
    b.appendChild(el('div', 'pl-label', '座っている人（' + c.players.length + '人）'));
    var seats = el('div', 'pl-seats');
    if (!c.players.length) seats.appendChild(el('div', 'pl-empty', 'まだ誰も座っていません'));
    c.players.forEach(function (p) {
      var s = el('div', 'pl-seat');
      var av = K.avatarEl(p, 'sm');
      av.appendChild(K.presence(p.online));
      s.appendChild(av);
      var t = el('span', 'pl-seat-id');
      t.appendChild(el('span', 'uname', p.id === myId() ? 'あなた' : p.name));
      var round = el('small', '', 'このラウンド ');
      round.appendChild(chip(p.bet, 'pl-inline'));
      t.appendChild(round);
      s.appendChild(t);
      seats.appendChild(s);
    });
    b.appendChild(seats);
    var acts = el('div', 'pl-acts');
    if (seated) {
      var up = button('act-btn', '立つ（やめる）', 'stand');
      up.addEventListener('click', function () { sit(c.group, false, up); });
      acts.appendChild(up);
      var go = button('act-btn gold', 'スロットへ', 'go');
      go.addEventListener('click', function () { sfx('click'); K.closeModal(m.id); BR.screens.show('slot'); });
      acts.appendChild(go);
    } else {
      var sitBtn = button('act-btn gold', coop && coop.group !== c.group ? 'このテーブルに移る' : '座って始める', 'sit');
      sitBtn.addEventListener('click', function () { sit(c.group, true, sitBtn); });
      acts.appendChild(sitBtn);
    }
    b.appendChild(acts);
  }
  function sit(groupId, on, btn) {
    if (btn) btn.disabled = true;
    sfx('click');
    api.sitCoop(groupId, on).then(function (r) {
      var me = BR.social.me();
      if (me) me.coop = on ? groupId : 0;
      setCoop(on ? r.coop : null);
      K.closeModal(ui.coop.id);
      if (on) {
        sfx('notify');
        if (BR.watch && BR.watch.active()) toast('協力スロットに座りました。ホームを出て回すとゲージがたまります', 3600);
        else {
          BR.screens.show('slot');
          toast('協力スロットに座りました。スピンするとゲージがたまります', 3200);
        }
      } else {
        toast('協力スロットから立ちました');
      }
    }, function (err) {
      if (btn) btn.disabled = false;
      fail(err);
    });
  }

  function setCoop(c) {
    coop = c || null;
    renderCoop();
  }
  // the table from my profile (me.coop): looked up when it changes
  function loadCoop(groupId) {
    if (!groupId) { coopLoading = 0; if (coop) setCoop(null); return; }
    if ((coop && coop.group === groupId) || coopLoading === groupId) return;
    coopLoading = groupId;
    api.coop(groupId).then(function (r) {
      if (coopLoading !== groupId) return;
      coopLoading = 0;
      setCoop(r.seated ? r.coop : null);
    }, function () {
      if (coopLoading === groupId) coopLoading = 0;
    });
  }

  function renderCoop() {
    var r = ui.coopBar;
    clear(r);
    r.hidden = !coop;
    if (!coop) return;
    r.appendChild(el('b', 'pl-tag', '協力'));
    r.appendChild(el('span', 'pl-group uname', coop.name));
    r.appendChild(gaugeEl(coop.gauge, coop.goal, false));
    var faces = el('span', 'pl-faces');
    coop.players.slice(0, 5).forEach(function (p) { faces.appendChild(K.avatarEl(p, 'xs')); });
    if (coop.players.length > 5) faces.appendChild(el('span', 'pl-more', '+' + (coop.players.length - 5)));
    r.appendChild(faces);
    var t = el('span', 'pl-ticker');
    t.id = 'pl-coop-ticker';
    if (coop.last) t.textContent = coop.last;
    r.appendChild(t);
    var x = button('pl-x', '', 'stand');
    x.setAttribute('aria-label', '協力スロットから立つ');
    r.appendChild(x);
  }
  function coopTicker(text, hot) {
    if (!coop) return;
    coop.last = text;
    var t = $('#pl-coop-ticker');
    if (!t) return;
    t.textContent = text;
    t.classList.remove('flash', 'hot');
    void t.offsetWidth;
    t.classList.add('flash');
    if (hot) t.classList.add('hot');
  }
  function onCoopClick(e) {
    var b = e.target.closest('[data-act]');
    if (b && b.dataset.act === 'stand' && coop) { sit(coop.group, false, b); return; }
    // the rest of the ribbon: the table's panel
    if (!b && coop) { sfx('click'); coopOpen({ id: coop.group, name: coop.name }); }
  }

  function onCoop(ev) {
    if (!ev || !coop || ev.group !== coop.group) return;
    if (ev.type === 'spin') {
      var mine = ev.by && ev.by.id === myId();
      var n = ++seq.coop;
      var apply = function () {
        if (!coop || coop.group !== ev.group) return;
        if (n > seq.coopShown) {
          seq.coopShown = n;
          coop.gauge = ev.gauge;
          coop.goal = ev.goal;
        }
        coop.players.forEach(function (p) { if (ev.by && p.id === ev.by.id) p.bet += ev.bet; });
        renderCoop();
        var who = mine ? 'あなた' : (ev.by ? ev.by.name + 'さん' : '');
        coopTicker(ev.win > 0 ? who + ' +' + U.fmt(ev.win) : who + ' ベット ' + U.fmt(ev.bet), ev.tier >= 2);
      };
      if (mine) whenIdle(apply); else apply();
    } else if (ev.type === 'seat') {
      if (!ev.user) return;
      coop.players = coop.players.filter(function (p) { return p.id !== ev.user.id; });
      if (ev.on) coop.players.push({ id: ev.user.id, name: ev.user.name, avatar: ev.user.avatar, bet: 0, online: true });
      renderCoop();
      if (ev.user.id !== myId()) coopTicker(ev.user.name + (ev.on ? 'さんが座りました' : 'さんが立ちました'));
    } else if (ev.type === 'bonus') {
      var nb = ++seq.coop;
      whenIdle(function () {
        if (!coop || coop.group !== ev.group) return;
        if (nb > seq.coopShown) { seq.coopShown = nb; coop.gauge = ev.gauge; }
        coop.players.forEach(function (p) { p.bet = 0; });
        renderCoop();
        var mine = null;
        (ev.paid || []).forEach(function (p) { if (p.id === myId()) mine = p; });
        ui.coopBar.classList.remove('bonus');
        void ui.coopBar.offsetWidth;
        ui.coopBar.classList.add('bonus');
        coopTicker('ゲージ満タン！ボーナス！', true);
        sfx('money');
        if (BR.juice) BR.juice.reward(ui.coopBar, 3);
        toast(mine ? '協力ボーナス！ +' + U.fmt(mine.amount) + ' トークン' : '協力ゲージ満タン！みんなにボーナス！', 3600);
      });
    }
  }

  /* ================================================================ 観戦ベット */

  var pick = { side: 'hit', stake: 0, busy: false };
  function watchStart(r) {
    host = r && r.user ? { id: r.user.id, name: r.user.name } : null;
    if (r && r.bet && r.bet.state === 'open') {
      bet = r.bet;
      if (!betHost || betHost.id !== bet.host) betHost = host && host.id === bet.host ? host : betHost;
    }
    ui.betBtn.hidden = false;
    renderBetChip();
  }
  function watchStop() {
    host = null;
    ui.betBtn.hidden = true;
    renderBetChip();
    if (K.isOpen(ui.bet.id)) K.closeModal(ui.bet.id);
  }
  function currentHost() {
    if (host) return host;
    var t = BR.watch && BR.watch.target();
    return t ? { id: t.id, name: t.name } : null;
  }
  function openBet() {
    var h = currentHost();
    if (!h) return;
    var wb = cfg('watchBet');
    pick.stake = pick.stake && wb.stakes.indexOf(pick.stake) >= 0 ? pick.stake : wb.stakes[0];
    pick.busy = false;
    renderBetPanel(h);
    K.showModal(ui.bet.id);
  }
  function renderBetPanel(h) {
    var m = ui.bet, b = clear(m.body), wb = cfg('watchBet');
    titled(m, '', '観戦ベット');
    var q = el('p', 'pl-question');
    q.appendChild(el('span', 'uname', h.name));
    q.appendChild(document.createTextNode('さんが次の' + wb.spins + '回で '));
    q.appendChild(el('b', '', 'BIG WIN以上'));
    q.appendChild(document.createTextNode(' を出す？'));
    b.appendChild(q);
    if (bet) {
      var st = el('div', 'pl-open-bet');
      st.appendChild(el('b', '', '賭け中'));
      st.appendChild(el('span', 'pl-side-tag ' + bet.side, sideText(bet.side)));
      st.appendChild(chip(bet.stake));
      st.appendChild(el('span', '', '残り' + bet.left + '回' + (betHost && betHost.id !== h.id ? '（' + betHost.name + 'さんへの賭け）' : '')));
      b.appendChild(st);
      b.appendChild(el('p', 'pl-note', '結果が出たら、また賭けられます。'));
      return;
    }
    b.appendChild(choices('pl-sides', [
      { value: 'hit', label: '出る', sub: '当たれば ×' + wb.hit },
      { value: 'miss', label: '出ない', sub: '当たれば ×' + wb.miss }
    ], pick.side, function (v) { pick.side = v; }));
    b.appendChild(el('div', 'pl-label', '賭けるトークン'));
    b.appendChild(choices('pl-stakes', wb.stakes.map(function (n) { return { value: n, chip: true }; }), pick.stake, function (v) { pick.stake = v; }));
    b.appendChild(el('p', 'pl-note', 'BIG WIN（ベットの' + BR.CONFIG.tiers.big + '倍以上）が' + wb.spins + '回以内に出るかを予想。的中で賭けたトークンの' + wb.hit + '倍（「出ない」は' + wb.miss + '倍）が戻ります。'));
    var acts = el('div', 'pl-acts');
    var go = button('act-btn gold', '賭ける', 'bet');
    go.addEventListener('click', function () { placeBet(h, go); });
    acts.appendChild(go);
    b.appendChild(acts);
  }
  function placeBet(h, btn) {
    if (pick.busy) return;
    if (S.tokens < pick.stake) { sfx('deny'); toast('スピントークンが足りません'); return; }
    pick.busy = true;
    btn.disabled = true;
    sfx('click');
    api.watchBet(pick.side, pick.stake).then(function (r) {
      pick.busy = false;
      bet = r.bet;
      betHost = h;
      if (r.balance) BR.app.serverBalance(r.balance);
      K.closeModal(ui.bet.id);
      renderBetChip();
      sfx('send');
      toast('観戦ベット：「' + sideText(bet.side) + '」に ' + U.fmt(bet.stake) + ' トークン賭けました', 3000);
    }, function (err) {
      pick.busy = false;
      btn.disabled = false;
      fail(err);
    });
  }
  function renderBetChip() {
    var c = ui.betChip;
    clear(c);
    c.hidden = !bet || !host;
    if (c.hidden) return;
    c.appendChild(el('b', 'pl-side-tag ' + bet.side, sideText(bet.side)));
    c.appendChild(chip(bet.stake));
    c.appendChild(el('small', '', '残り' + bet.left + '回'));
  }

  function onWatch(ev) {
    if (!ev) return;
    if (ev.type === 'bet' && ev.bet) {
      var b = ev.bet;
      if (ev.host) betHost = { id: ev.host.id, name: ev.host.name };
      if (b.state === 'open') {
        whenIdle(function () {
          if (bet && bet.id === b.id && bet.state === 'open') { bet = b; renderBetChip(); }
        });
        return;
      }
      whenIdle(function () {
        if (bet && bet.id === b.id) bet = null;
        renderBetChip();
        if (b.state === 'won') {
          sfx('money');
          toast('観戦ベット的中！ +' + U.fmt(b.paid) + ' トークン', 3600);
          if (BR.juice) BR.juice.reward('#toast', 3);
        } else if (b.state === 'lost') {
          sfx('deny');
          toast('観戦ベットはハズレ…（' + sideText(b.side) + '）', 3000);
        }
      });
    } else if (ev.type === 'betOn' && ev.by && ev.bet) {
      sfx('notify');
      toast(ev.by.name + 'さんがあなたの次の' + ev.bet.spins + '回に賭けました（BIG WINが' + sideText(ev.bet.side) + '）', 3600);
    } else if (ev.type === 'betEnd' && ev.by && ev.bet) {
      var by = ev.by.name, won = ev.bet.state === 'won';
      whenIdle(function () { toast(by + 'さんの観戦ベットは' + (won ? '的中！' : 'ハズレ'), 2800); });
    }
  }

  /* ================================================================ timers, session */

  // countdowns: the invitation, the battle's time, the waiting invitation
  function tickNow() {
    var now = Date.now();
    if (inviteBox) {
      var left = inviteBox.battle.until - now;
      if (left <= 0) {
        incoming = null;
        closeInviteBox();
      } else {
        inviteBox.left.textContent = '・残り ' + clock(left);
      }
    }
    if (battle) {
      var l = battle.until - now;
      var t = ui.battle.querySelector('.pl-left');
      if (battle.state === 'invite' && l <= 0) {
        setBattle(null);
        toast('フレンド対決の申し込みは期限切れになりました');
      } else if (t) {
        t.textContent = l > 0 ? clock(l) : 'まもなく終了';
        // past its time: asking the server decides it (not too often: the clocks may differ)
        if (l <= -3000 && now - lastAsk > 30000) { lastAsk = now; restoreBattle(); }
      }
    }
  }
  function startTicker() {
    if (ticker) return;
    ticker = setInterval(tickNow, 1000);
  }

  function reset() {
    battle = null;
    incoming = null;
    coop = null;
    coopLoading = 0;
    bet = null;
    betHost = null;
    host = null;
    clearTimeout(betTimer);
    clearTimeout(restoreTimer);
    closeInviteBox();
    closeResult();
    if (ui.battle) { renderBattle(); renderCoop(); renderBetChip(); }
  }

  function onMe(me) {
    var id = me ? me.id : 0;
    if (!id) {
      if (meId) reset();
      meId = 0;
      return;
    }
    if (id !== meId) {
      if (meId) reset();
      meId = id;
      // (the live connection's hello, a moment after, asks as well: this one waits for it, and asks on its own only when none comes)
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(restoreBattle, 2000);
    }
    loadCoop(me.coop || 0);
  }

  function init() {
    var stack = $('#mode-stack'), tools = $('#watch-tools');
    ui.ask = makeModal('pl-ask', 'pl-ask-card');
    ui.coop = makeModal('pl-coop', 'pl-coop-card');
    ui.bet = makeModal('pl-bet', 'pl-bet-card');
    ui.battle = el('div', 'pl-ribbon pl-battle');
    ui.battle.hidden = true;
    ui.coopBar = el('div', 'pl-ribbon pl-coop');
    ui.coopBar.hidden = true;
    if (stack) { stack.appendChild(ui.battle); stack.appendChild(ui.coopBar); }
    ui.betBtn = el('button', 'tool-btn pl-bet-btn');
    ui.betBtn.type = 'button';
    ui.betBtn.hidden = true;
    ui.betBtn.appendChild(K.icon('chip'));
    ui.betBtn.appendChild(el('span', '', '観戦ベット'));
    ui.betChip = el('span', 'pl-bet-chip');
    ui.betChip.hidden = true;
    if (tools) { tools.appendChild(ui.betBtn); tools.appendChild(ui.betChip); }
    ui.battle.addEventListener('click', onBattleClick);
    ui.coopBar.addEventListener('click', onCoopClick);
    ui.betBtn.addEventListener('click', function () { sfx('click'); openBet(); });
    ui.betChip.addEventListener('click', function () { sfx('click'); openBet(); });
    // a battle's bet that could not be set while the reels turned
    BR.screens.onChange(function (name) { if (name === 'slot') applyBet(); });
    if (!api.online) return;
    startTicker();
    BR.live.on('battle', onBattle);
    BR.live.on('coop', onCoop);
    BR.live.on('watch', onWatch);
    BR.live.on('hello', function (h) {
      if (!myId()) return;
      restoreBattle(h.battle !== undefined ? Promise.resolve({ battle: h.battle }) : null);
      var me = BR.social.me();
      // the table may have changed while the connection was down
      if (coop) { var g = coop.group; coop = null; loadCoop(g); } else if (me) loadCoop(me.coop || 0);
    });
    if (BR.social && BR.social.onMe) BR.social.onMe(onMe);
  }

  BR.play = {
    init: init,
    challenge: challenge,
    coopOpen: coopOpen,
    betLocked: betLocked,
    watchStart: watchStart,
    watchStop: watchStop,
    // the battle on now (for other screens): null or the server's battle
    battle: function () { return battle && battle.state === 'live' ? battle : null; }
  };
})(window.BR = window.BR || {});
