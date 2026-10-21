/* 友達と稼ぐ (the client side of the hubs in server/core/api.js). Friends
   invited from the friend list (一緒に稼ぐ) play together in a hub of up to
   five, each on their own reels: the others' reels are not shown, only what
   they win. An invitation arrives as a card (参加する) and also waits on the
   inviter's row in the friend list. Nobody leaves by going away: only the
   small 抜ける button in the corner of the hub bar takes a player out, and a
   hub with one player left closes (inviting someone again starts a new one).
   The hub's benefits are on while two or more of its players are active
   (something done within 4 minutes, js/ui/activity.js); the hub bar shows who
   is, the combo everyone shares with what the next win pays, the 5時間
   booster, and opens the list of what the hub gives (効果). The hub's voice
   connects everyone with every microphone off (js/net/call.js) and stays on
   while in the hub; a face in the bar opens that person's card: their
   volume, mute, a block, and a quick chat (即席チャット, not stored). */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var HUB = BR.CONFIG.hub;
  var IDLE = (BR.QUESTS && BR.QUESTS.idleMs) || 240000;
  var FRIEND_REELS = 2400;   // a friend's win shows after about the time their reels turn
  var CHAT_KEEP = 30;        // lines kept of each quick chat (this session only)

  var hub = null;        // the server's hub (members: + until, when they stop being active), or null
  var invites = [];      // invitations to me: [{ from: user, until }]
  var seq = 0;           // the newest hub spin shown (updates can arrive out of order)
  var ui = {};
  var card = null;       // the invitation card on screen: { root, left, from, busy }
  var listeners = [];
  var joining = 0;
  var noVoice = {};      // id: true, a block cuts the voice off (either way)
  var blocked = null;    // ids I blocked ({ id: true }), loaded once in a hub
  var chats = {};        // id: [{ from, to, text, at }]
  var unread = {};       // id: lines not seen yet
  var wasOn = null;      // the benefits as last shown (on / off)
  var shown = '';        // who was active as last drawn
  var mc = null;         // the member card on screen: { id, root }
  var chatWith = 0;      // the quick chat open in the text entry (its feed: chatFeed)
  var chatFeed = null;

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

  /* ------------------------------------------------------------ who is active --- */
  // a member is active until 4 minutes after the last thing they did (I am, by my own taps)
  function isActive(m) { return m.id === myId() ? !BR.activity || BR.activity.active() : m.until > Date.now(); }
  function activeCount() { return hub ? hub.members.filter(isActive).length : 0; }
  // the benefits: two or more active, me among them
  function benefitsOn() { return !!hub && activeCount() >= 2 && isActive({ id: myId() }); }
  function booster(n) { return n >= 2 ? Math.round(HUB.booster * Math.pow(HUB.boosterStep, n - 2) * 1000) / 1000 : 1; }
  function idleText(m) {
    if (!m.online) return 'オフライン';
    if (isActive(m)) return 'プレイ中';
    var min = Math.max(4, Math.floor((Date.now() - (m.until - IDLE)) / 60000));
    return min >= 60 ? '放置中（' + Math.floor(min / 60) + '時間以上）' : '放置中（' + min + '分）';
  }
  function stateOf(m) { return !m.online ? 'off' : isActive(m) ? 'on' : 'idle'; }

  /* ------------------------------------------------------------ what a hub gives --- */
  // [{ pic: symbol | badge text, title, text }]
  function effects() {
    var W = BR.CONFIG.weights, H = HUB.weights;
    return [
      { sym: 'statue', title: '女神像の確率アップ', text: pct(W.statue) + ' → ' + pct(H.statue), up: true },
      { sym: 'seven', title: '7の確率アップ', text: pct(W.seven) + ' → ' + pct(H.seven), up: true },
      { sym: 'revolver', title: '銃の確率ダウン（はずれにくい）', text: pct(W.revolver) + ' → ' + pct(H.revolver), up: false },
      { sym: 'diamond', title: 'ダイヤ確定', text: pct(HUB.diamonds) + 'の確率でダイヤ5つがそろう（20倍）' },
      { badge: 'COMBO', title: 'コンボをみんなで共有', text: '1コンボごとに報酬が' + times(HUB.comboStep) + 'ずつアップ（2コンボ目 ×1.1・3コンボ目 ×1.21…）。' + HUB.misses + '回続けて外れるまで続く' },
      { badge: '777', title: '777ボーナス', text: '7が3つ以上そろうと、7の報酬が' + times(HUB.sevens) },
      { badge: 'EXP', title: 'レベルブースト', text: '経験値が' + times(HUB.xp) + '（抜けるまで自動）' },
      { badge: '5H', title: '5時間クエスト ブースター', text: '5時間クエストのカウントが2人で' + times(HUB.booster) + '、1人増えるごとにさらに' + times(HUB.boosterStep) + '（3人 ×2.2・4人 ×2.42…）' },
      { badge: 'JOB', title: 'バイトの時給アップ', text: '勤務中でいちばん高いバイトの時給が' + times(HUB.wage) },
      { badge: '守', title: 'お守り加護パワーアップ', text: '負けたスピンの軽減が最大' + BR.CONFIG.charm.hub.max + '%に（通常' + BR.CONFIG.charm.min + '〜' + BR.CONFIG.charm.max + '%）。100%軽減（大吉）の確率も2倍' },
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
  function faceEl(m) {
    var b = el('button', 'hb-face ' + stateOf(m));
    b.type = 'button';
    b.dataset.user = m.id;
    b.setAttribute('aria-label', m.name + '（' + idleText(m) + '）');
    b.appendChild(K.avatarEl(m, 'sm'));
    b.appendChild(el('i', 'hb-dot'));
    var v = BR.call && BR.call.voice ? BR.call.voice(m.id) : null;
    if (m.id !== myId() && (noVoice[m.id] || (v && v.muted))) b.appendChild(el('i', 'hb-muted'));
    if (unread[m.id]) b.appendChild(el('i', 'hb-unread', String(Math.min(9, unread[m.id]))));
    return b;
  }
  function render() {
    var bar = ui.bar;
    bar.textContent = '';
    var on = !!hub;
    bar.hidden = !on;
    $('#screen-slot').classList.toggle('in-hub', on);
    if (!on) { shown = ''; return; }
    var going = benefitsOn();
    bar.classList.toggle('paused', !going);
    var tag = el('span', 'hb-tag');
    tag.appendChild(el('b', '', '友達と稼ぐ'));
    tag.appendChild(el('small', '', hub.members.length + '/' + hub.max + '人'));
    bar.appendChild(tag);
    var faces = el('span', 'hb-faces');
    hub.members.forEach(function (m) { faces.appendChild(faceEl(m)); });
    bar.appendChild(faces);
    var n = activeCount();
    if (going) {
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
      var boost = el('span', 'hb-boost');
      boost.appendChild(el('small', '', '5時間'));
      boost.appendChild(el('b', '', times(booster(n))));
      bar.appendChild(boost);
      bar.appendChild(el('span', 'hb-exp', 'EXP' + times(HUB.xp)));
    } else {
      // too few active: everything waits until two or more are
      var p = el('span', 'hb-paused');
      p.appendChild(el('b', '', '特典ストップ中'));
      p.appendChild(el('small', '', isActive({ id: myId() })
        ? 'プレイ中 ' + n + '/' + hub.members.length + '人・2人以上で再開'
        : 'あなたが放置中・タップで再開'));
      bar.appendChild(p);
    }
    var fx = el('button', 'pl-mini hb-btn', '効果');
    fx.type = 'button';
    fx.dataset.act = 'effects';
    bar.appendChild(fx);
    // the only way out: small, in the corner
    var out = el('button', 'hb-leave', '抜ける');
    out.type = 'button';
    out.dataset.act = 'leave';
    out.setAttribute('aria-label', '「友達と稼ぐ」を抜ける');
    bar.appendChild(out);
    shown = signature();
  }
  // who is active (the bar is drawn again when that changes)
  function signature() {
    return hub ? hub.members.map(function (m) { return m.id + stateOf(m); }).join(',') + (benefitsOn() ? '+' : '-') : '';
  }
  // the combo moved: the number jumps
  function bumpCombo() {
    var n = ui.bar.querySelector('.hb-combo-n');
    if (n && BR.juice) BR.juice.bump(n, 1.6);
  }

  // once a second: someone went idle or came back; the benefits stop or go on
  function watchActive() {
    if (!hub) { wasOn = null; return; }
    if (signature() !== shown) { render(); if (mc) fillMember(); }
    var on = benefitsOn();
    if (wasOn === null) { wasOn = on; return; }
    if (on === wasOn) return;
    wasOn = on;
    if (on) {
      sfx('notify');
      toast('「友達と稼ぐ」の特典が再開しました！', 2400);
      var J = BR.juice;
      if (J && BR.screens.current() === 'slot') J.banner('特典再開！', 'chance', 1200, '友達と稼ぐ');
    } else {
      sfx('deny');
      toast(isActive({ id: myId() })
        ? 'プレイ中が1人になったので特典はストップ中です（2人以上で再開）'
        : '4分以上操作がないので特典はストップ中です（タップで再開）', 3600);
    }
  }

  function setHub(h, quiet) {
    var was = hub;
    hub = h || null;
    if (hub) {
      var now = Date.now();
      hub.members.forEach(function (m) { m.until = now - (m.idle || 0) + IDLE; });
      if (h.noVoice) { noVoice = {}; h.noVoice.forEach(function (id) { noVoice[id] = true; }); }
      if (blocked === null) loadBlocked();
    }
    if (hub && was && was.id === hub.id) seq = Math.max(seq, hub.seq || 0);
    else seq = hub ? hub.seq || 0 : 0;
    if (!hub) { noVoice = {}; chats = {}; unread = {}; wasOn = null; closeMember(); if (chatWith) BR.entry.close(); }
    else if (!was || was.id !== hub.id) wasOn = null;
    render();
    syncVoice();
    changed();
    if (mc) { if (!member(mc.id)) closeMember(); else fillMember(); }
    if (!quiet && hub && (!was || was.id !== hub.id)) welcome();
  }
  // everyone in the hub who is connected, but the ones a block cuts off
  function syncVoice() {
    if (!BR.call || !BR.call.syncHub) return;
    if (!hub) { BR.call.syncHub(0, []); return; }
    BR.call.syncHub(hub.id, hub.members.filter(function (m) {
      return m.online && !noVoice[m.id] && !(blocked && blocked[m.id]);
    }));
  }
  function loadBlocked() {
    blocked = {};
    api.blocks().then(function (r) {
      (r.blocks || []).forEach(function (b) { blocked[b.id] = true; });
      syncVoice();
      render();
    }, function () { blocked = null; });
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
    toast('「友達と稼ぐ」に参加中：7・女神像が出やすく、コンボはみんなで共有', 4200);
  }

  /* ------------------------------------------------------------ invitations --- */
  function invite(user) {
    if (!api.online || !user) return;
    if (!user.online) { sfx('deny'); toast(user.name + 'さんは今オフラインです', 3200); return; }
    if (hub && hub.members.length >= hub.max) { sfx('deny'); toast('「友達と稼ぐ」は' + hub.max + '人までです'); return; }
    sfx('click');
    api.hubInvite(user.id).then(function () {
      sfx('send');
      toast(user.name + 'さんを「友達と稼ぐ」に招待しました', 3000);
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
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('「友達と稼ぐ」を抜けますか？'));
      p.appendChild(el('small', 'confirm-sub', 'コンボ共有などの効果と通話がなくなります。'));
    }, '抜ける').then(function (ok) {
      if (!ok) return;
      api.hubLeave().then(function () {
        setHub(null);
        toast('「友達と稼ぐ」を抜けました');
      }, fail);
    });
  }

  /* ------------------------------------------------------------ a member's card --- */
  // A face tapped: that person's state, their voice (volume, mute), a quick
  // chat, the profile and a block. Mine: my microphone and all the voices.
  function openMember(id) {
    var m = member(id);
    if (!m) return;
    closeMember();
    var root = el('div', 'hb-mc');
    root.setAttribute('role', 'dialog');
    $('#stage').appendChild(root);
    mc = { id: id, root: root };
    unread[id] = 0;
    fillMember();
    render();
    // a tap anywhere else closes it
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
  }
  function outside(e) {
    if (!mc) return;
    if (mc.root.contains(e.target) || e.target.closest('.hb-face') || e.target.closest('#confirm') || e.target.closest('#entry')) return;
    closeMember();
  }
  function closeMember() {
    document.removeEventListener('pointerdown', outside, true);
    if (!mc) return;
    if (mc.root.parentNode) mc.root.parentNode.removeChild(mc.root);
    mc = null;
  }
  function mcButton(label, act, cls, ic) {
    var b = el('button', 'hb-mc-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.dataset.act = act;
    if (ic) b.appendChild(K.icon(ic));
    b.appendChild(el('span', '', label));
    return b;
  }
  function fillMember() {
    if (!mc) return;
    var m = member(mc.id);
    if (!m) { closeMember(); return; }
    var root = mc.root, self = m.id === myId();
    root.textContent = '';
    var x = el('button', 'hb-mc-x');
    x.type = 'button';
    x.dataset.act = 'close';
    x.setAttribute('aria-label', '閉じる');
    root.appendChild(x);
    var top = el('div', 'hb-mc-top');
    var face = el('span', 'hb-face big ' + stateOf(m));
    face.appendChild(K.avatarEl(m, 'big'));
    face.appendChild(el('i', 'hb-dot'));
    top.appendChild(face);
    var id = el('div', 'hb-mc-id');
    var nm = el('span', 'fr-name-row');
    nm.appendChild(el('b', 'uname', m.name + (self ? '（あなた）' : '')));
    K.addVip(nm, m.vip);
    id.appendChild(nm);
    var st = el('span', 'hb-mc-state ' + stateOf(m));
    st.appendChild(el('i', 'hb-dot'));
    st.appendChild(document.createTextNode(idleText(m)));
    id.appendChild(st);
    top.appendChild(id);
    if (!self) top.appendChild(mcButton('プロフィール', 'profile', 'ghost'));
    root.appendChild(top);

    var call = BR.call;
    if (self) {
      // my side: the microphone and every voice at once
      var mine = el('div', 'hb-mc-row');
      var mic = call && call.mic();
      mine.appendChild(mcButton(mic ? 'マイク オン' : 'マイク オフ', 'mic', mic ? 'on' : 'off', mic ? 'mic-on' : 'mic-off'));
      var deaf = call && call.deaf();
      mine.appendChild(mcButton(deaf ? 'みんなの声 ミュート中' : 'みんなの声 オン', 'deaf', deaf ? 'off' : 'on', deaf ? 'speaker-off' : 'speaker'));
      root.appendChild(mine);
      root.appendChild(el('p', 'hb-mc-note', '通話は抜けるまで切れません。声はアイコンから人ごとにミュートできます。'));
      return;
    }
    // their voice: volume and mute (kept on this phone), or why there is none
    var cut = noVoice[m.id] || (blocked && blocked[m.id]);
    var v = call && call.voice ? call.voice(m.id) : { volume: 100, muted: false, connected: false };
    var voice = el('div', 'hb-mc-voice' + (cut || v.muted ? ' muted' : ''));
    if (cut) {
      voice.appendChild(el('span', 'hb-mc-cut', 'ブロック中のため通話はつながりません'));
    } else {
      var lab = el('span', 'hb-mc-lab');
      lab.appendChild(K.icon(v.muted ? 'speaker-off' : 'speaker'));
      lab.appendChild(el('span', '', '音量'));
      voice.appendChild(lab);
      voice.appendChild(slider(m.id, v.volume));
      voice.appendChild(el('b', 'hb-vol-n', v.volume + '%'));
      voice.appendChild(mcButton(v.muted ? 'ミュート解除' : 'ミュート', 'mute', v.muted ? 'off' : ''));
      if (!m.online) voice.appendChild(el('small', 'hb-mc-sub', 'オフライン（戻るとつながります）'));
      else if (!v.connected) voice.appendChild(el('small', 'hb-mc-sub', '通話に接続中…'));
    }
    root.appendChild(voice);
    // the quick chat: the last lines, and a field to write in
    var box = el('div', 'hb-mc-chat');
    var lines = (chats[m.id] || []).slice(-3);
    if (!lines.length) box.appendChild(el('p', 'hb-mc-empty', cut ? 'ブロック中は即席チャットも使えません' : m.name + 'さんに即席チャットを送れます（画面には残りません・記録は保存されます）'));
    lines.forEach(function (l) { box.appendChild(lineEl(l)); });
    root.appendChild(box);
    var acts = el('div', 'hb-mc-row');
    var say = mcButton('即席チャット', 'say', 'gold', 'chat');
    say.disabled = !!cut;
    acts.appendChild(say);
    acts.appendChild(mcButton(blocked && blocked[m.id] ? 'ブロック解除' : 'ブロック', 'block', 'danger'));
    acts.appendChild(mcButton('通報', 'report', 'danger'));
    root.appendChild(acts);
  }
  // a volume slider drawn by hand (it follows the finger in the scaled stage)
  function slider(id, value) {
    var s = el('div', 'hb-vol');
    s.setAttribute('role', 'slider');
    s.setAttribute('aria-label', '音量');
    s.setAttribute('aria-valuemin', '0');
    s.setAttribute('aria-valuemax', '100');
    var fill = el('i', 'hb-vol-fill'), knob = el('i', 'hb-vol-knob');
    s.appendChild(fill);
    s.appendChild(knob);
    function show(v) {
      fill.style.width = v + '%';
      knob.style.left = v + '%';
      s.setAttribute('aria-valuenow', String(v));
      var n = s.parentNode && s.parentNode.querySelector('.hb-vol-n');
      if (n) n.textContent = v + '%';
    }
    function at(e) {
      var r = s.getBoundingClientRect();
      var v = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * 20) * 5;
      show(v);
      BR.call.setVolume(id, v);
    }
    var dragging = false;
    s.addEventListener('pointerdown', function (e) {
      dragging = true;
      try { s.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      at(e);
    });
    s.addEventListener('pointermove', function (e) { if (dragging) at(e); });
    var stop = function () { dragging = false; };
    s.addEventListener('pointerup', stop);
    s.addEventListener('pointercancel', stop);
    show(value);
    return s;
  }
  function onMemberAction(act) {
    if (!mc) return;
    var m = member(mc.id);
    if (!m) return;
    sfx('click');
    switch (act) {
      case 'close': closeMember(); break;
      case 'profile': closeMember(); BR.social.openProfile(m); break;
      case 'mic':
        if (BR.call.paused()) { BR.call.resume(); fillMember(); break; }
        BR.call.setMic(!BR.call.mic()).then(fillMember); fillMember(); break;
      case 'deaf': BR.call.setDeaf(!BR.call.deaf()); fillMember(); break;
      case 'mute': {
        var v = BR.call.voice(m.id);
        BR.call.setMuted(m.id, !v.muted);
        toast(v.muted ? m.name + 'さんのミュートを解除しました' : m.name + 'さんの声をミュートしました', 2200);
        fillMember();
        render();
        break;
      }
      case 'say': openChat(m); break;
      case 'block': toggleBlock(m); break;
      case 'report': closeMember(); BR.safety.report(m, 'hub'); break;
    }
  }
  function toggleBlock(m) {
    var on = !(blocked && blocked[m.id]);
    var ask = !on ? Promise.resolve(true) : K.confirmBox(function (p) {
      p.appendChild(K.nameSpan(m.name));
      p.appendChild(document.createTextNode('さんをブロックしますか？'));
      p.appendChild(el('small', 'confirm-sub', '相手には知らされません。声・即席チャット・メッセージなどが届かなくなります（解除するとまとめて届きます）。'));
    }, 'ブロック');
    ask.then(function (ok) {
      if (!ok) return null;
      return api.block(m.id, on).then(function (res) {
        blockChanged(m.id, on);
        // (the toast, and what arrives when it is lifted: js/ui/social.js)
        BR.social.blockChanged(m.id, res);
      });
    }).catch(fail);
  }
  // a block made or lifted here or from a profile (js/ui/social.js)
  function blockChanged(id, on) {
    if (blocked === null) blocked = {};
    if (on) blocked[id] = true; else delete blocked[id];
    if (!hub) return;
    if (on && chatWith === id) BR.entry.close();
    // whether the other side still blocks me: the server knows
    if (!on) refresh(); else { syncVoice(); render(); fillMember(); }
  }

  /* ------------------------------------------------------------ the quick chat --- */
  function lineEl(l) {
    var mine = l.from && l.from.id === myId();
    var row = el('div', 'msg ' + (mine ? 'mine' : 'theirs'));
    row.appendChild(el('div', 'bubble', l.text));
    row.appendChild(el('span', 'msg-time', K.fmtTime(l.at)));
    return row;
  }
  function addLine(withId, l) {
    var list = chats[withId] || (chats[withId] = []);
    list.push(l);
    if (list.length > CHAT_KEEP) list.splice(0, list.length - CHAT_KEEP);
    if (chatWith === withId) renderChat();
    if (mc && mc.id === withId) fillMember();
  }
  function renderChat() {
    if (!chatFeed) return;
    chatFeed.textContent = '';
    var list = chats[chatWith] || [];
    if (!list.length) chatFeed.appendChild(el('div', 'empty chat-empty', '仲間に即席チャット（画面には残りません・記録は保存されます）'));
    list.forEach(function (l) { chatFeed.appendChild(lineEl(l)); });
    BR.entry.scrollFeed();
  }
  function openChat(m) {
    closeMember();
    chatWith = m.id;
    unread[m.id] = 0;
    render();
    chatFeed = el('div', 'chat-list hb-chat-feed');
    renderChat();
    BR.entry.open({
      title: m.name + 'さんと即席チャット',
      max: 200,
      placeholder: m.name + 'さんにメッセージ',
      feed: chatFeed,
      rule: true,
      onSubmit: function (text) {
        return api.hubSay(m.id, text).then(function (r) {
          sfx('send');
          addLine(m.id, r.line);
        });
      },
      onClose: function () { chatWith = 0; chatFeed = null; }
    });
  }
  // a line came: in the open chat, or as a bubble under the hub bar (tap: answer)
  function onSay(ev) {
    var m = member(ev.from.id);
    if (!m || (blocked && blocked[m.id])) return;
    addLine(m.id, ev);
    if (chatWith === m.id) { sfx('message'); return; }
    unread[m.id] = (unread[m.id] || 0) + 1;
    render();
    sfx('message');
    var n = el('button', 'hb-note-pop hb-say');
    n.type = 'button';
    n.appendChild(K.avatarEl(ev.from, 'sm'));
    var t = el('span', 'hb-pop-text');
    t.appendChild(el('b', 'uname', ev.from.name));
    t.appendChild(el('span', 'hb-say-text', K.clip(ev.text, 34)));
    n.appendChild(t);
    n.addEventListener('click', function () { sfx('click'); if (n.parentNode) n.parentNode.removeChild(n); openChat(m); });
    pop(n, 6000);
  }

  /* ------------------------------------------------------------ the effects dialog --- */
  function openEffects() {
    var m = ui.modal;
    m.title.textContent = '「友達と稼ぐ」の効果';
    m.body.textContent = '';
    m.body.appendChild(el('p', 'hb-lead', '2人以上がプレイ中のあいだ、全員のスロットに次の効果がつきます（最大' + HUB.max + '人）。'));
    var list = el('div', 'hb-effs');
    effects().forEach(function (e) { list.appendChild(effectRow(e)); });
    m.body.appendChild(list);
    if (hub) {
      var who = el('div', 'hb-who');
      hub.members.forEach(function (p) {
        var r = el('span', 'hb-person ' + stateOf(p));
        r.appendChild(K.avatarEl(p, 'sm'));
        r.appendChild(el('span', 'uname', p.name));
        r.appendChild(el('small', '', idleText(p)));
        who.appendChild(r);
      });
      m.body.appendChild(who);
      var won = el('div', 'hb-won');
      won.appendChild(el('span', '', 'みんなで稼いだトークン'));
      won.appendChild(K.amountEl(hub.won || 0, 'tokens'));
      m.body.appendChild(won);
    }
    m.body.appendChild(el('p', 'hb-note', '4分以上操作しないと「放置中」になります。プレイ中が1人になると特典と週間協力クエストは止まり、2人以上で再開します。自動で抜けることはありません（抜けるときはバー右上のボタン）。マイクは最初オフで、通話は切れません（アイコンから人ごとに音量・ミュート）。'));
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
    var m = member(ev.user.id);
    if (m) m.until = Date.now() + IDLE;
    setTimeout(function () {
      if (!hub) return;
      if (ev.win > 0) hub.won = (hub.won || 0) + ev.win;
      // (an older spin than one already shown moves nothing)
      if (!apply(ev)) return;
      if (BR.combo && BR.combo.shared) BR.combo.shared(ev.combo, ev.win > 0);
      if (ev.win > 0 && !(blocked && blocked[ev.user.id])) note(ev);
    }, FRIEND_REELS);
  }
  function pop(n, ms) {
    ui.pops.appendChild(n);
    while (ui.pops.children.length > 3) ui.pops.removeChild(ui.pops.firstChild);
    setTimeout(function () { n.classList.add('out'); }, ms - 500);
    setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, ms);
  }
  // a small note under the hub bar: who won what
  function note(ev) {
    var n = el('div', 'hb-note-pop' + (ev.tier >= 2 ? ' big' : ''));
    n.appendChild(K.avatarEl(ev.user, 'sm'));
    var t = el('span', 'hb-pop-text');
    t.appendChild(el('b', 'uname', ev.user.name));
    t.appendChild(el('span', '', ev.diamonds ? 'さんがダイヤ確定！' : ev.tier >= 3 ? 'さんがSUPER BIG WIN！' : ev.tier >= 2 ? 'さんがBIG WIN！' : 'さんが当たり！'));
    n.appendChild(t);
    n.appendChild(K.amountEl(ev.win, 'tokens', 'hb-pop-amt'));
    if (ev.combo >= 2) n.appendChild(el('b', 'hb-pop-combo', ev.combo + ' COMBO'));
    pop(n, 3100);
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
        if (ev.hub) setHub(mergeVoice(ev.hub));
        if (ev.user.id !== myId()) {
          sfx('notify');
          toast(ev.user.name + 'さんが「友達と稼ぐ」に参加しました！', 2600);
        }
        break;
      case 'leave':
        if (ev.hub) setHub(mergeVoice(ev.hub), true); else refresh();
        toast(ev.user.name + 'さんが「友達と稼ぐ」を抜けました', 2400);
        break;
      case 'away':
      case 'back': {
        var m = member(ev.user.id);
        if (m) { m.online = ev.type === 'back'; render(); syncVoice(); if (mc && mc.id === m.id) fillMember(); }
        break;
      }
      case 'activity': {
        var a = member(ev.user);
        if (a) { a.until = Date.now() - (ev.idle || 0) + IDLE; watchActive(); }
        break;
      }
      case 'say':
        onSay(ev);
        break;
      case 'closed':
        setHub(null);
        sfx('callEnd');
        toast('ひとりになったので「友達と稼ぐ」は解散しました', 3600);
        break;
      case 'spin':
        friendSpin(ev);
        break;
    }
  }
  // a hub from an event (the same for everyone) keeps the voices I know are cut off
  function mergeVoice(h) {
    if (!h.noVoice) h.noVoice = Object.keys(noVoice).map(Number);
    return h;
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
      var f = e.target.closest('.hb-face');
      if (f) {
        sfx('click');
        var id = Number(f.dataset.user);
        if (mc && mc.id === id) closeMember(); else openMember(id);
        return;
      }
      var b = e.target.closest('[data-act]');
      if (!b) return;
      sfx('click');
      if (b.dataset.act === 'effects') openEffects();
      else if (b.dataset.act === 'leave') leave();
    });
    // the member card's buttons (it lives in the stage, outside the bar)
    $('#stage').addEventListener('click', function (e) {
      if (!mc || !mc.root.contains(e.target)) return;
      var b = e.target.closest('[data-act]');
      if (b && !b.disabled) onMemberAction(b.dataset.act);
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
    setInterval(function () { tick(); watchActive(); }, 1000);
    if (BR.call && BR.call.onChange) BR.call.onChange(function () { if (mc) fillMember(); });
    if (BR.activity && BR.activity.onBack) BR.activity.onBack(function () { setTimeout(watchActive, 0); });
    if (!api.online) return;
    // logged out: nothing of the hub stays on screen
    if (BR.social && BR.social.onMe) BR.social.onMe(function (me) {
      if (me) return;
      invites = [];
      blocked = null;
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
    openMember: openMember,
    blockChanged: blockChanged,
    effects: effects,
    afterSpin: afterSpin,
    active: function () { return !!hub && hub.members.length >= 2; },
    // the benefits are on now (two or more active)
    on: benefitsOn,
    combo: function () { return hub ? hub.combo : 0; },
    isMember: function (id) { return !!member(id); },
    invitedBy: function (id) { return !!invitation(id); },
    onChange: function (fn) { listeners.push(fn); }
  };
})(window.BR = window.BR || {});
