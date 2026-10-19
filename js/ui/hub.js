/* 友達と稼ぐ (the client side of the hubs in server/core/api.js). Friends
   invited from the friend list (一緒に稼ぐ) play together in a hub of up to
   five, each on their own reels: the others' reels are not shown, only what
   they win. An invitation arrives as a card (参加する) and also waits on the
   inviter's row in the friend list. While two or more are in it, the hub bar
   at the top of the slot screen shows who is there, the combo everyone
   shares with what the next win pays, and opens the list of what the hub
   gives (効果). The hub's voice connects everyone with every microphone off
   (js/net/call.js). A hub with one player left closes by itself; inviting
   someone again starts a new one. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var HUB = BR.CONFIG.hub;
  var FRIEND_REELS = 2400;   // a friend's win shows after about the time their reels turn

  var hub = null;        // the server's hub, or null
  var invites = [];      // invitations to me: [{ from: user, until }]
  var seq = 0;           // the newest hub spin shown (updates can arrive out of order)
  var voiceOff = false;  // I hung up the hub's voice
  var ui = {};
  var card = null;       // the invitation card on screen: { root, left, from, busy }
  var listeners = [];
  var joining = 0;

  function myId() { var m = BR.social && BR.social.me(); return m ? m.id : 0; }
  function pct(p) { return (Math.round(p * 1000) / 10) + '%'; }
  function times(m) { return '×' + (Math.round(m * 100) / 100); }
  function changed() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) { if (window.console) console.warn(e); } });
  }
  function member(id) {
    if (!hub) return null;
    for (var i = 0; i < hub.members.length; i++) if (hub.members[i].id === id) return hub.members[i];
    return null;
  }
  function invitation(fromId) {
    var now = Date.now();
    invites = invites.filter(function (i) { return i.until > now; });
    for (var i = 0; i < invites.length; i++) if (invites[i].from.id === fromId) return invites[i];
    return null;
  }

  /* ------------------------------------------------------------ what a hub gives --- */
  // [{ pic: symbol | badge text, title, text }]
  function effects() {
    var W = BR.CONFIG.weights, H = HUB.weights;
    return [
      { sym: 'statue', title: '女神像の確率アップ', text: pct(W.statue) + ' → ' + pct(H.statue), up: true },
      { sym: 'seven', title: '7の確率アップ', text: pct(W.seven) + ' → ' + pct(H.seven), up: true },
      { sym: 'revolver', title: '銃の確率ダウン（はずれにくい）', text: pct(W.revolver) + ' → ' + pct(H.revolver), up: false },
      { sym: 'diamond', title: 'ダイヤ確定', text: pct(HUB.diamonds) + 'の確率でダイヤ5つがそろう（20倍）' },
      { badge: 'COMBO', title: 'コンボをみんなで共有', text: '1コンボごとに当たりの報酬が' + times(HUB.comboStep) + 'ずつアップ（2コンボ目 ×1.1・3コンボ目 ×1.21…）。' + HUB.misses + '回続けて外れるまでコンボは消えない' },
      { badge: '777', title: '777ボーナス', text: '7が3つ以上そろうと、7の報酬が' + times(HUB.sevens) },
      { badge: 'EXP', title: 'レベルブースト', text: '経験値が' + times(HUB.xp) + '（抜けるまで自動）' },
      { badge: 'QUEST', title: 'クエストはすべて有効', text: '週間協力クエストも進みます' }
    ];
  }
  function effectRow(e) {
    var r = el('div', 'hb-eff' + (e.up === true ? ' up' : e.up === false ? ' down' : ''));
    var pic = el('i', 'hb-eff-pic' + (e.badge ? ' badge' : ''));
    if (e.sym) pic.style.backgroundImage = 'url("' + BR.SYMBOL_IMG[e.sym] + '")';
    else pic.textContent = e.badge;
    r.appendChild(pic);
    var t = el('div', 'hb-eff-text');
    t.appendChild(el('b', '', e.title));
    t.appendChild(el('span', '', e.text));
    r.appendChild(t);
    if (e.up !== undefined) r.appendChild(el('i', 'hb-arrow ' + (e.up ? 'up' : 'down')));
    return r;
  }

  /* ------------------------------------------------------------ the hub bar --- */
  function render() {
    var bar = ui.bar;
    bar.textContent = '';
    var on = !!hub;
    bar.hidden = !on;
    $('#screen-slot').classList.toggle('in-hub', on);
    if (!on) return;
    var tag = el('span', 'hb-tag');
    tag.appendChild(el('b', '', '友達と稼ぐ'));
    tag.appendChild(el('small', '', hub.members.length + '/' + hub.max + '人'));
    bar.appendChild(tag);
    var faces = el('span', 'hb-faces');
    hub.members.forEach(function (m) {
      var a = K.avatarEl(m, 'sm');
      a.classList.toggle('away', !m.online);
      a.title = m.name;
      faces.appendChild(a);
    });
    bar.appendChild(faces);
    var combo = el('span', 'hb-combo' + (hub.combo >= 2 ? ' hot' : ''));
    combo.appendChild(el('small', '', 'みんなのCOMBO'));
    combo.appendChild(el('b', 'hb-combo-n', String(hub.combo)));
    bar.appendChild(combo);
    var next = el('span', 'hb-next');
    next.appendChild(el('small', '', '次の当たり'));
    next.appendChild(el('b', '', times(hub.next || 1)));
    bar.appendChild(next);
    var lives = el('span', 'hb-lives');
    lives.title = HUB.misses + '回続けて外れるとコンボ終了';
    for (var i = 0; i < HUB.misses; i++) lives.appendChild(el('i', i < HUB.misses - hub.misses ? 'on' : ''));
    bar.appendChild(lives);
    bar.appendChild(el('span', 'hb-exp', 'EXP' + times(HUB.xp)));
    var fx = el('button', 'pl-mini hb-btn', '効果');
    fx.type = 'button';
    fx.dataset.act = 'effects';
    bar.appendChild(fx);
    if (voiceOff) {
      var v = el('button', 'pl-mini hb-btn', '通話に入る');
      v.type = 'button';
      v.dataset.act = 'voice';
      bar.appendChild(v);
    }
    var out = el('button', 'pl-mini', '抜ける');
    out.type = 'button';
    out.dataset.act = 'leave';
    bar.appendChild(out);
  }
  // the combo moved: the number jumps
  function bumpCombo() {
    var n = ui.bar.querySelector('.hb-combo-n');
    if (n && BR.juice) BR.juice.bump(n, 1.6);
  }

  function setHub(h, quiet) {
    var was = hub;
    hub = h || null;
    if (hub && was && was.id === hub.id) seq = Math.max(seq, hub.seq || 0);
    else seq = hub ? hub.seq || 0 : 0;
    if (!hub) voiceOff = false;
    render();
    syncVoice();
    changed();
    if (!quiet && hub && (!was || was.id !== hub.id)) welcome();
  }
  function syncVoice() {
    if (!BR.call || !BR.call.syncHub) return;
    if (!hub || voiceOff) BR.call.syncHub(0, []);
    else BR.call.syncHub(hub.id, hub.members.filter(function (m) { return m.online; }));
  }
  // just joined: a show, and what the hub gives
  function welcome() {
    sfx('notify');
    var J = BR.juice;
    if (J && BR.screens.current() === 'slot') {
      J.banner('みんなで稼ごう！', 'chance', 1600, '友達と稼ぐ ' + hub.members.length + '人');
      J.flash('#ffd27a', 0.22, 320);
      J.rain({ kind: 'confetti', dur: 1, rate: 36 });
    }
    toast('「友達と稼ぐ」に参加中：7・女神像が出やすく、コンボはみんなで共有（効果ボタンで詳しく）', 4200);
  }

  /* ------------------------------------------------------------ invitations --- */
  function invite(user) {
    if (!api.online || !user) return;
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです（オンラインのフレンドを招待できます）', 3200); return; }
    if (hub && hub.members.length >= hub.max) { sfx('deny'); toast('「友達と稼ぐ」は' + hub.max + '人までです'); return; }
    sfx('click');
    api.hubInvite(user.id).then(function () {
      sfx('send');
      toast(user.name + 'さんを「友達と稼ぐ」に招待しました（参加を待っています）', 3000);
    }, fail);
  }

  function showCard(inv) {
    // not on top of the beginner guide: it waits (an invitation lasts minutes)
    if (BR.guide && BR.guide.active && BR.guide.active()) {
      setTimeout(function () { if (invitation(inv.from.id)) showCard(inv); }, 1500);
      return;
    }
    closeCard();
    var o = inv.from;
    var wrap = el('div', 'call-in pl-invite hb-invite');
    var box = el('div', 'call-card pl-invite-card');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-label', '友達と稼ぐ');
    box.appendChild(K.avatarEl(o, 'big'));
    var text = el('div', 'call-in-text');
    var who = el('div', 'call-in-who');
    who.appendChild(el('b', 'uname', o.name));
    who.appendChild(el('span', '', 'さんから'));
    text.appendChild(who);
    text.appendChild(el('div', 'call-in-what', '「友達と稼ぐ」のお誘い！'));
    var small = el('small', '');
    small.appendChild(document.createTextNode('7・女神像が出やすく、コンボ共有で報酬アップ・経験値' + times(HUB.xp)));
    var left = el('span', 'pl-invite-left');
    small.appendChild(left);
    text.appendChild(small);
    box.appendChild(text);
    var acts = el('div', 'call-in-acts');
    var no = el('button', 'call-btn decline');
    no.type = 'button';
    no.appendChild(el('span', 'pl-x-mark'));
    no.appendChild(el('span', '', 'あとで'));
    var yes = el('button', 'call-btn accept');
    yes.type = 'button';
    yes.appendChild(K.icon('check'));
    yes.appendChild(el('span', '', '参加する'));
    acts.appendChild(no);
    acts.appendChild(yes);
    box.appendChild(acts);
    wrap.appendChild(box);
    $('#stage').appendChild(wrap);
    card = { root: wrap, left: left, from: o.id, until: inv.until };
    // あとで: the invitation stays in the friend list until it runs out
    no.addEventListener('click', function () { sfx('click'); closeCard(); });
    yes.addEventListener('click', function () { join(o.id); });
    sfx('ring');
    tick();
  }
  function closeCard() {
    if (!card) return;
    if (card.root.parentNode) card.root.parentNode.removeChild(card.root);
    card = null;
  }
  function tick() {
    if (!card) return;
    var left = card.until - Date.now();
    if (left <= 0) { closeCard(); changed(); return; }
    var s = Math.ceil(left / 1000);
    card.left.textContent = '・残り ' + Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  }

  function join(fromId) {
    if (joining) return;
    joining = fromId;
    sfx('click');
    var go = function () {
      api.hubJoin(fromId).then(function (r) {
        joining = 0;
        closeCard();
        invites = invites.filter(function (i) { return i.from.id !== fromId; });
        if (BR.screens.current() !== 'slot' && !(BR.watch && BR.watch.active && BR.watch.active())) BR.screens.show('slot');
        setHub(r.hub);
      }, function (err) {
        joining = 0;
        closeCard();
        invites = invites.filter(function (i) { return i.from.id !== fromId; });
        changed();
        fail(err);
      });
    };
    // already in another hub: moving over leaves it
    if (hub && !member(fromId)) {
      K.confirmBox(function (p) { p.textContent = '今の「友達と稼ぐ」を抜けて、こちらに参加しますか？'; }, '参加する').then(function (ok) {
        if (ok) go(); else joining = 0;
      });
      return;
    }
    go();
  }

  function leave() {
    if (!hub) return;
    K.confirmBox(function (p) { p.textContent = '「友達と稼ぐ」を抜けますか？（コンボ共有などの効果がなくなります）'; }, '抜ける').then(function (ok) {
      if (!ok) return;
      api.hubLeave().then(function () {
        setHub(null);
        toast('「友達と稼ぐ」を抜けました');
      }, fail);
    });
  }

  /* ------------------------------------------------------------ the effects dialog --- */
  function openEffects() {
    var m = ui.modal;
    m.title.textContent = '「友達と稼ぐ」の効果';
    m.body.textContent = '';
    m.body.appendChild(el('p', 'hb-lead', '2人以上で参加しているあいだ、全員のスロットに次の効果がつきます（最大' + HUB.max + '人）。'));
    var list = el('div', 'hb-effs');
    effects().forEach(function (e) { list.appendChild(effectRow(e)); });
    m.body.appendChild(list);
    if (hub) {
      var who = el('div', 'hb-who');
      hub.members.forEach(function (p) {
        var r = el('span', 'hb-person' + (p.online ? '' : ' away'));
        r.appendChild(K.avatarEl(p, 'sm'));
        r.appendChild(el('span', 'uname', p.name));
        who.appendChild(r);
      });
      m.body.appendChild(who);
      var won = el('div', 'hb-won');
      won.appendChild(el('span', '', 'みんなで稼いだトークン'));
      won.appendChild(K.amountEl(hub.won || 0, 'tokens'));
      m.body.appendChild(won);
    }
    m.body.appendChild(el('p', 'hb-note', 'マイクは最初オフです（通話バーのマイクでオン）。ほかの人のリールは見えません。ひとりになると自動で解散します。'));
    K.showModal(m.id);
  }

  /* ------------------------------------------------------------ spins --- */
  // My spin in the hub, once its reels have stopped (js/main.js): the combo
  // everyone shares, and what the hub added to the win.
  function afterSpin(res) {
    var h = res.hub;
    if (!h || !hub) return;
    if (res.total > 0) hub.won = (hub.won || 0) + res.total;
    apply(h);
    var J = BR.juice;
    if (!J) return;
    var w = J.at('.win-box');
    if (h.diamonds) {
      J.banner('ダイヤ確定！！', 'chance', 1500, '友達と稼ぐボーナス');
      J.flash('#b6e3ff', 0.35, 360);
    }
    var parts = [];
    if (h.sevens) parts.push('777 ' + times(HUB.sevens));
    if (res.total > 0 && h.mult > 1) parts.push(h.combo + 'COMBO ' + times(h.mult));
    if (parts.length) {
      J.text(w.x, w.y - 92, parts.join('・'), 'big hb-boost', 2000);
      J.ring(w.x, w.y, { r0: 30, r1: 260, dur: 0.6, w: 8, sy: 0.45, color: 'pink' });
    }
    if (res.total <= 0 && h.combo > 0 && h.misses > 0) {
      J.text(w.x, w.y - 80, 'コンボ継続中・あと' + (HUB.misses - h.misses) + '回外れると終了', 'hb-keep', 1800);
    }
  }
  // the hub after a spin (mine or someone else's), in the order they happened
  function apply(h) {
    if (!hub || !(h.seq > seq)) return false;
    seq = h.seq;
    var grew = h.combo > hub.combo;
    hub.combo = h.combo;
    hub.misses = h.misses;
    hub.next = h.next;
    render();
    if (grew) bumpCombo();
    return true;
  }
  // someone else in the hub spun: after about the time their reels take,
  // their win (and the combo it made) shows
  function friendSpin(ev) {
    setTimeout(function () {
      if (!hub) return;
      if (ev.win > 0) hub.won = (hub.won || 0) + ev.win;
      // (an older spin than one already shown moves nothing)
      if (!apply(ev)) return;
      if (BR.combo && BR.combo.shared) BR.combo.shared(ev.combo, ev.win > 0);
      if (ev.win > 0) note(ev);
    }, FRIEND_REELS);
  }
  // a small note under the hub bar: who won what
  function note(ev) {
    var n = el('div', 'hb-note-pop' + (ev.tier >= 2 ? ' big' : ''));
    n.appendChild(K.avatarEl(ev.user, 'sm'));
    var t = el('span', 'hb-pop-text');
    t.appendChild(el('b', 'uname', ev.user.name));
    t.appendChild(el('span', '', ev.diamonds ? 'さんがダイヤ確定！' : ev.tier >= 2 ? 'さんがBIG WIN！' : 'さんが当たり！'));
    n.appendChild(t);
    n.appendChild(K.amountEl(ev.win, 'tokens', 'hb-pop-amt'));
    if (ev.combo >= 2) n.appendChild(el('b', 'hb-pop-combo', ev.combo + ' COMBO'));
    ui.pops.appendChild(n);
    while (ui.pops.children.length > 3) ui.pops.removeChild(ui.pops.firstChild);
    setTimeout(function () { n.classList.add('out'); }, 2600);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 3100);
    if (BR.screens.current() === 'slot') sfx(ev.tier >= 2 ? 'notify' : 'coinIn');
  }

  /* ------------------------------------------------------------ live events --- */
  function onHub(ev) {
    if (!ev) return;
    switch (ev.type) {
      case 'invite':
        invites = invites.filter(function (i) { return i.from.id !== ev.from.id; }).concat([{ from: ev.from, until: ev.until }]);
        changed();
        if (!member(ev.from.id)) showCard({ from: ev.from, until: ev.until });
        break;
      case 'declined':
        toast(ev.by.name + 'さんは今は参加できないようです');
        break;
      case 'join':
        // (a hub that has just formed with me in it gets its welcome)
        if (ev.hub) setHub(ev.hub);
        if (ev.user.id !== myId()) {
          sfx('notify');
          toast(ev.user.name + 'さんが「友達と稼ぐ」に参加しました！', 2600);
        }
        break;
      case 'leave':
        if (ev.hub) setHub(ev.hub, true); else refresh();
        toast(ev.user.name + 'さんが「友達と稼ぐ」を抜けました', 2400);
        break;
      case 'away':
      case 'back': {
        var m = member(ev.user.id);
        if (m) { m.online = ev.type === 'back'; render(); syncVoice(); }
        break;
      }
      case 'closed':
        setHub(null);
        sfx('callEnd');
        toast('ひとりになったので「友達と稼ぐ」は解散しました。また友達を招待しよう！', 3600);
        break;
      case 'spin':
        friendSpin(ev);
        break;
    }
  }
  function refresh() {
    if (!api.online || !myId()) return;
    api.hub().then(function (r) {
      invites = r.invites || [];
      setHub(r.hub, true);
    }, function () {});
  }

  function init() {
    ui.bar = el('div', 'pl-ribbon hb-bar');
    ui.bar.hidden = true;
    var stack = $('#mode-stack');
    if (stack) stack.insertBefore(ui.bar, stack.firstChild);
    ui.pops = el('div', 'hb-pops');
    $('#screen-slot').appendChild(ui.pops);
    ui.bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      sfx('click');
      if (b.dataset.act === 'effects') openEffects();
      else if (b.dataset.act === 'leave') leave();
      else if (b.dataset.act === 'voice') { voiceOff = false; render(); syncVoice(); }
    });
    // the dialog with what a hub gives
    var m = el('div', 'modal pl-modal');
    m.id = 'hub-effects';
    m.hidden = true;
    var c = el('div', 'modal-card pl-card hb-card');
    c.setAttribute('role', 'dialog');
    var x = el('button', 'modal-x');
    x.type = 'button';
    x.setAttribute('data-close', '');
    x.setAttribute('aria-label', '閉じる');
    c.appendChild(x);
    var title = el('h3', 'modal-title');
    c.appendChild(title);
    var body = el('div', 'pl-body');
    c.appendChild(body);
    m.appendChild(c);
    var stage = $('#stage'), confirm = $('#confirm');
    stage.insertBefore(m, confirm && confirm.parentNode === stage ? confirm : null);
    K.registerModal(m.id);
    ui.modal = { id: m.id, title: title, body: body };
    setInterval(tick, 1000);
    if (!api.online) return;
    // logged out: nothing of the hub stays on screen
    if (BR.social && BR.social.onMe) BR.social.onMe(function (me) {
      if (me) return;
      invites = [];
      closeCard();
      if (hub) setHub(null, true);
    });
    BR.live.on('hub', onHub);
    BR.live.on('hello', function (h) {
      invites = (h && h.hubInvites) || [];
      setHub(h ? h.hub : null, true);
      // an invitation that came while away: its card, once
      var open = invites.filter(function (i) { return !member(i.from.id); })[0];
      if (open && (!card || card.from !== open.from.id)) showCard(open);
    });
  }

  BR.hub = {
    init: init,
    invite: invite,
    join: join,
    leave: leave,
    openEffects: openEffects,
    effects: effects,
    afterSpin: afterSpin,
    // the hub's voice: hung up (the hub bar can bring it back)
    hangUp: function () { voiceOff = true; render(); syncVoice(); },
    active: function () { return !!hub && hub.members.length >= 2; },
    combo: function () { return hub ? hub.combo : 0; },
    isMember: function (id) { return !!member(id); },
    invitedBy: function (id) { return !!invitation(id); },
    onChange: function (fn) { listeners.push(fn); }
  };
})(window.BR = window.BR || {});
