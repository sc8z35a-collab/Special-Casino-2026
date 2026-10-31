/* Online play: the session (sign-in, live connection), the menu (フレンド /
   メッセージ / Car Owner / Shop / バイト / 詳細), conversations with a friend
   or a group (既読, 入力中), player profiles, friend requests and money
   transfers. Everything here stays dormant in the offline build. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api;
  var $ = U.$, $$ = U.$$;
  var el = K.el, icon = K.icon, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var online = api.online;

  function visible() { return BR.screens.current() === 'board'; }

  /* ------------------------------------------------------------ state --- */
  var me = null;             // my profile as the server sees it
  var unread = 0;            // unread messages (conversations and groups)
  var requests = 0;          // friend requests waiting for me
  var view = 'friends';      // friends | messages | dm | group | cars | garage | shop | items | jobs | more | feedback
  var lastTab = 'friends';   // where the menu opens (never メッセージ: it hides the other tabs)
  var peer = null;           // { id, name, avatar, online, lastSeen } of the open conversation
  var group = null;          // the open group (as the server describes it)
  var chans = {};            // 'dm:<userId>' | 'group:<id>' -> message cache
  var drafts = {};
  var convs = null;          // conversations with one person, most recent first
  var groups = null;         // my groups
  var friends = null;        // { friends, incoming, outgoing }
  var found = null;          // last friend search result { user, ... }
  var typers = {};           // chat key -> { userId: { name, until } } (入力中)
  var greeted = false;       // a live connection has been made before
  var cameFrom = 'slot';     // where the menu's back button returns to
  var sessionGeneration = 0;

  // modules that follow my profile (the guide, feedback, フレンド対決 ...): fn(me or null)
  var meListeners = [];
  var claiming = {};         // message id -> true while money, a car or an item is being received
  var menu = null;           // the ⋯ menu under a message, while it is open
  function meChanged() {
    renderMeCard();
    meListeners.forEach(function (fn) { try { fn(me); } catch (e) { if (window.console) console.warn(e); } });
  }
  function acceptMe(m) {
    if (!m || !api.hasToken() || (me && (m.id !== me.id || (typeof m.rev === 'number' && typeof me.rev === 'number' && m.rev < me.rev)))) return false;
    if (BR.bank.applyMe(m, true) === false) return false;
    me = m;
    return true;
  }
  function setMe(m) {
    if (!acceptMe(m)) return false;
    BR.quests.setXp(m.xp);
    BR.quests.setReady(m.questsReady);
    BR.quests.setBonuses(m.questBonuses);
    BR.shop.renderCharm();
    meChanged();
    return true;
  }

  function resetSocial() {
    sessionGeneration++;
    Object.keys(readTimers).forEach(function (key) { clearTimeout(readTimers[key]); });
    readTimers = {}; typingSent = {}; clearTimeout(typingTimer); typingTimer = 0;
    claiming = {};
    if (menu) closeMenu();
    prof.seq++; prof.data = null;
    chans = {};
    drafts = {};
    convs = null;
    groups = null;
    friends = null;
    found = null;
    peer = null;
    group = null;
    typers = {};
    greeted = false;
    setUnread(0);
    setRequests(0);
  }

  /* ------------------------------------------------------------ session --- */
  function signIn(token, profile) {
    BR.live.close();
    clearAccountState();
    api.setToken(token);
    me = profile;
    BR.bank.applyMe(profile);
    BR.app.renderWallet(false);
    start();
  }

  // Load the account, then go live.  Retries quietly while the server is away.
  var retry = 1000, retryTimer = 0, warned = false, starting = null;
  function start() {
    clearTimeout(retryTimer);
    if (!api.hasToken()) return;
    var job = starting = BR.bank.refresh();
    job.then(function (r) {
      if (starting !== job) return;
      retry = 1000;
      warned = false;
      if (!acceptMe(r.me) && !me) return;
      if (BR.call && BR.call.setBlocked) BR.call.setBlocked(r.blocked, r.me && r.me.rev);
      setUnread(r.unread);
      setRequests(r.friendRequests);
      setOnline(r.online);
      BR.avatars.setShop(r.iconShop);
      BR.shop.setSale(r);
      BR.peter.set(r.peter);
      BR.johnson.set(r.johnson);
      BR.official.set(r.official);
      BR.shop.renderCharm();
      BR.bonus.show(r.loginBonus);
      BR.bonus.schedule(r.loginReset);
      BR.quests.setXp(me.xp, true);
      BR.quests.setReady(me.questsReady);
      BR.jobs.set(me);
      BR.news.serverRelease(me.release);
      BR.news.checkRelease();
      BR.app.renderWallet(false);
      BR.app.renderBet();
      meChanged();
      BR.live.connect();
      if (BR.lineReward) BR.lineReward.check();
    }, function (err) {
      if (starting !== job || err.code === 'session_changed') return;
      if (err.status === 401 || err.status === 403) return; // auth-lost takes over
      if (err.code === 'maintenance') return;                // the notice is up until the quota resets
      if (!warned) {
        warned = true;
        toast('接続が切れました。再接続しています…', 3000);
      }
      retryTimer = setTimeout(start, retry);
      retry = Math.min(retry * 2, 30000);
    });
  }

  // A banned account (js/ui/banlock.js): banned logins land here, and a ban
  // while playing stops everything but keeps the login, to ask with.
  function signInBanned(token, ban) {
    api.setToken(token);
    BR.banlock.lock(ban);
  }
  function lockDown() { signedOut(true); }

  function signedOut(keepLogin) {
    BR.live.close();
    if (!keepLogin) api.setToken(null);
    clearAccountState();
    if (BR.account && BR.account.close) BR.account.close();
    BR.app.renderWallet(false);
  }
  function clearAccountState() {
    starting = null;
    clearTimeout(retryTimer);
    if (BR.account && BR.account.invalidate) BR.account.invalidate();
    BR.bank.reset();
    if (BR.bonus) BR.bonus.reset();
    if (BR.call) BR.call.hangupAll();
    if (BR.watch) { if (BR.watch.reset) BR.watch.reset(); else BR.watch.stop(true); }
    me = null;
    resetSocial();
    meChanged();
    BR.quests.reset();
    BR.jobs.reset();
    if (BR.tree) BR.tree.reset();
    if (BR.lineReward) BR.lineReward.reset();
    if (BR.gacha) BR.gacha.reset();
    if (BR.feats) BR.feats.set(0);
    if (BR.medals && BR.medals.reset) BR.medals.reset();
    if (BR.lazy) BR.lazy.cancelPending();
    BR.entry.close();
    closeGroupForm();
    K.closeModals();
  }

  // The token stopped working (logged out elsewhere, or by the server: an
  // operator's rights taken away). The money is safe on the server: logging
  // in again brings everything back.
  function onAuthLost(err) {
    clearTimeout(retryTimer);
    signedOut();
    if (BR.screens.current() !== 'start' && BR.screens.current() !== 'slot') BR.screens.show('slot');
    BR.account.open('login', err && err.code === 'ended' && err.message
      ? err.message + '。'
      : 'もう一度ログインしてください（残高はそのまま戻ります）。');
  }
  // banned (アクセス禁止 / BAN / 永久BAN, or another account on this device):
  // locked on the title screen until it ends
  function onBanned(err) {
    clearTimeout(retryTimer);
    BR.banlock.lock((err && err.extra && err.extra.ban) || err);
  }

  function logout() {
    if (!me) return;
    var gen = sessionGeneration, owner = me.id;
    function current() { return gen === sessionGeneration && me && me.id === owner; }
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('ログアウトしますか？'));
      p.appendChild(el('small', 'confirm-sub', '残高やフレンドは消えません。ユーザー名とパスワードでいつでも戻れます。'));
    }, 'ログアウト').then(function (ok) {
      if (!ok || !current()) return;
      // this phone stops getting the account's notifications first (while signed in)
      (BR.push ? BR.push.forget() : Promise.resolve()).then(function (endpoint) { if (current()) return api.logout(endpoint); }).catch(function () {}).then(function () {
        if (!current()) return;
        signedOut();
        BR.screens.show('start');
        toast('ログアウトしました');
      });
    });
  }

  /* ------------------------------------------------------------ my card (top left of the slot screen) --- */
  function renderMeCard() {
    var card = $('#me-card');
    card.hidden = !me;
    $('#me-vip-button').hidden = !me;
    $('#slot-title').hidden = !!me;
    if (!me) return;
    var old = $('#me-avatar');
    var av = K.avatarEl(me);
    av.id = 'me-avatar';
    old.parentNode.replaceChild(av, old);
    $('#me-name').textContent = me.name;
    var v = $('#me-vip');
    v.textContent = '';
    K.addVip(v, K.vipLevel(me));
  }

  /* ------------------------------------------------------------ last online --- */
  function ago(ts) {
    var d = Math.max(0, Date.now() - ts);
    if (d < 60000) return 'たった今';
    if (d < 3600000) return Math.floor(d / 60000) + '分前';
    if (d < 86400000) return Math.floor(d / 3600000) + '時間前';
    if (d < 7 * 86400000) return Math.floor(d / 86400000) + '日前';
    return K.fmtDate(ts);
  }
  // 「オンライン」 or when they were last here (the NPCs: what they are)
  function seenText(u) {
    if (!u) return '';
    if (BR.official.is(u)) return '運営公式アカウント';
    if (BR.peter.is(u)) return '金貸し';
    if (BR.johnson.is(u)) return '友達・いつでもオンライン';
    if (u.online) return 'オンライン';
    return u.lastSeen ? '最終オンライン ' + ago(u.lastSeen) : 'オフライン';
  }

  /* ------------------------------------------------------------ text entry --- */
  // A real input outside the scaled stage (17px text keeps iOS from zooming in): a bar on the bottom edge of what the
  // keyboard leaves. The screen stays the screen the player was on: the game is lifted just enough (BR.app.lift) to
  // keep the end of the conversation (`anchor`, the scroller that holds `feed`) above the bar. A conversation with no
  // place on the screen (the hub's, the home's) is shown above the bar as glass, as large as on the screen.
  var entry = (function () {
    var root, input, send, bar, opts = null, sending = false, home = null, homeNext = null, inStage = false, lifted = 0;

    function setError(t) {
      var e = $('#entry-error');
      e.textContent = t || '';
      e.hidden = !t;
      relift();
    }
    function init() {
      root = $('#entry');
      input = $('#entry-input');
      send = $('#entry-send');
      bar = $('#entry-form');
      $('#entry-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
      // tapping "send" must not take the focus (and the keyboard) away
      ['pointerdown', 'mousedown'].forEach(function (ev) {
        send.addEventListener(ev, function (e) { e.preventDefault(); });
      });
      input.addEventListener('input', function () { if (opts && opts.onDraft) opts.onDraft(input.value); });
      // the keyboard put away by a tap elsewhere: the bar goes with it (the game is where it was)
      input.addEventListener('blur', function () {
        setTimeout(function () {
          if (opts && !sending && document.activeElement !== input && !root.contains(document.activeElement)) close();
        }, 220);
      });
      $('#entry-close').addEventListener('click', close);
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
      // the keyboard comes, goes, or changes its height: the lift follows
      if (window.visualViewport) ['resize', 'scroll'].forEach(function (ev) { window.visualViewport.addEventListener(ev, relift); });
      window.addEventListener('resize', relift);
    }
    // the end of the conversation stays above the bar: the game goes up by what the bar and the keyboard take
    function relift() {
      if (!opts || root.hidden) return;
      if (!inStage) {   // (the glass above the bar: its end stays in sight as the keyboard changes its height)
        var glass = $('#entry-feed');
        if (!glass.hidden) glass.scrollTop = glass.scrollHeight;
        return;
      }
      var vv = window.visualViewport;
      var bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      var errors = $('#entry-error');
      var barTop = bottom - bar.offsetHeight - (errors.hidden ? 0 : errors.offsetHeight);
      var want = Math.max(0, Math.round(opts.anchor.getBoundingClientRect().bottom + lifted - barTop));
      if (want !== lifted) {
        lifted = want;
        if (BR.app && BR.app.lift) BR.app.lift(want);
      }
      opts.anchor.scrollTop = opts.anchor.scrollHeight;
    }
    function open(o) {
      if (opts) close();
      opts = o;
      $('#entry-title').textContent = o.title;
      input.value = o.value || '';
      if (o.max) input.maxLength = o.max; else input.removeAttribute('maxlength');
      input.placeholder = o.placeholder || 'メッセージを入力';
      input.enterKeyHint = o.enterKeyHint || 'send';
      send.textContent = o.button || '送信';
      var view = (BR.app && BR.app.view) || {};
      var s = view.s;
      root.style.setProperty('--entry-s', (s || 0.45).toFixed(4));
      var feed = $('#entry-feed');
      // on the game's own screen (upright, not turned): it stays there; else it is shown above the bar
      inStage = !!(o.feed && o.anchor && !view.portrait && $('#stage').contains(o.anchor));
      lifted = 0;
      setError('');
      if (o.feed && !inStage) {
        // the same size as on the (scaled) screen: typing must not make it bigger
        if (s) feed.style.setProperty('--entry-u', s.toFixed(4) + 'px');
        home = o.feed.parentNode;
        homeNext = o.feed.nextSibling;
        feed.appendChild(o.feed);
      }
      feed.hidden = !(o.feed && !inStage);
      root.classList.toggle('no-feed', !o.feed || inStage);
      root.classList.toggle('in-stage', inStage);
      $('#entry-rule').hidden = !o.rule;
      root.hidden = false;
      K.fitOverlay(root);
      input.focus();
      feed.scrollTop = feed.scrollHeight;
      // (the keyboard takes a moment to come)
      relift();
      [120, 350, 800].forEach(function (ms) { setTimeout(relift, ms); });
    }
    function close() {
      if (!opts) return;
      var o = opts;
      opts = null;
      input.blur();
      root.hidden = true;
      root.classList.remove('in-stage');
      if (inStage && BR.app && BR.app.lift) BR.app.lift(0);
      inStage = false;
      lifted = 0;
      if (o.feed && home) home.insertBefore(o.feed, homeNext);
      home = homeNext = null;
      if (o.onClose) o.onClose();
      BR.app.relayout();
    }
    function submit() {
      if (!opts || sending) return;
      var text = input.value.trim();
      if (!text) return;
      var o = opts;
      sending = true;
      send.disabled = true;
      Promise.resolve().then(function () { return o.onSubmit(text); }).then(function (closeAfter) {
        if (opts !== o) return;
        input.value = '';
        if (o.onDraft) o.onDraft('');
        setError('');
        if (closeAfter === true) close();
      }, function (err) {
        if (opts === o) setError(err && err.message ? err.message : '送信できませんでした');
      }).then(function () {
        sending = false;
        send.disabled = false;
        // still writing: the keyboard stays up, the next line goes in the same place
        if (opts === o && !root.hidden) input.focus();
      });
    }
    // the conversation being shown scrolls with new lines
    function scrollFeed() {
      if (!opts || !opts.feed) return;
      if (inStage) { relift(); return; }
      var f = $('#entry-feed');
      f.scrollTop = f.scrollHeight;
    }
    return { init: init, open: open, close: close, isOpen: function () { return !!opts; }, scrollFeed: scrollFeed };
  })();

  /* ------------------------------------------------------------ badges --- */
  function setUnread(n) {
    unread = Math.max(0, n | 0);
    K.badge($('#tab-badge'), unread);
    renderHudBadge();
  }
  function setRequests(n) {
    requests = Math.max(0, n | 0);
    K.badge($('#friends-badge'), requests);
    renderHudBadge();
  }
  function renderHudBadge() { K.badge($('#radio-badge'), unread + requests); }
  function setOnline(n) {
    if (typeof n === 'number') $('#online-count').textContent = U.fmt(n) + '人がオンライン';
  }

  /* ------------------------------------------------------------ the menu --- */
  var tabs;
  function openBoard(tab) {
    if (!online) {
      sfx('deny');
      toast('フレンド・メッセージはオンライン版で利用できます');
      return;
    }
    BR.account.require(function () {
      if (!BR.bank.ready()) {
        toast('サーバーに接続しています…');
        // open it as soon as the account has loaded
        if (starting) starting.then(function () { if (BR.bank.ready()) openBoard(tab); }, function () {});
        else start();
        return;
      }
      if (!visible()) {
        cameFrom = BR.screens.current() === 'start' ? 'start' : 'slot';
        BR.screens.show('board');
      }
      setView(tab || lastTab);
    });
  }

  // view -> its tab and its pane
  var TAB_OF = {
    friends: 'friends', messages: 'messages', dm: 'messages', group: 'messages', cars: 'cars', garage: 'cars',
    shop: 'shop', carshop: 'shop', items: 'shop', jobs: 'jobs', more: 'more'
  };
  var PANE_OF = {
    friends: 'friends', messages: 'messages', dm: 'chat', group: 'chat', cars: 'cars', garage: 'garage',
    shop: 'shop', carshop: 'shop', items: 'items', jobs: 'jobs', more: 'more'
  };
  var PANES = ['friends', 'messages', 'chat', 'cars', 'garage', 'shop', 'items', 'jobs', 'more'];
  function setView(v) {
    if (!TAB_OF[v]) v = 'friends';
    if (v === 'dm' && !peer) v = 'messages';
    if (v === 'group' && !group) v = 'messages';
    // the cars' 3D stops when Car Owner is left
    if (v !== 'cars' && BR.cars && BR.cars.leave) BR.cars.leave();
    view = v;
    // (each view its own background: css/style.css)
    $('#stage').dataset.view = v;
    var tab = TAB_OF[v];
    if (tab !== 'messages') lastTab = v;
    tabs.set(tab);
    // in a conversation every button at the top stays; メッセージ goes back to the list
    $('#board-tabs').classList.toggle('in-chat', v === 'dm' || v === 'group');
    PANES.forEach(function (p) { $('#pane-' + p).classList.toggle('active', p === PANE_OF[v]); });
    BR.screens.enter($('#pane-' + PANE_OF[v]));
    $('#pane-chat').classList.toggle('is-dm', v === 'dm');
    $('#pane-chat').classList.toggle('is-group', v === 'group');
    if (v === 'friends') loadFriends().catch(function () {});
    else if (v === 'messages') loadConversations();
    else if (v === 'dm') { renderChatHead(); showChat('dm:' + peer.id); }
    else if (v === 'group') { renderChatHead(); showChat('group:' + group.id); }
    else if (v === 'cars') BR.cars.showShop();
    else if (v === 'garage') BR.cars.showGarage();
    else if (v === 'shop') BR.shop.showShop();
    else if (v === 'carshop') BR.shop.showShop('car');
    else if (v === 'items') BR.shop.showItems();
    else if (v === 'jobs') BR.jobs.show();
  }

  function knownUser(id) {
    var hit = null;
    if (friends) ['friends', 'incoming', 'outgoing'].forEach(function (k) {
      friends[k].forEach(function (f) { if (f.id === id) hit = f; });
    });
    if (!hit) (convs || []).forEach(function (c) { if (c.user.id === id) hit = c.user; });
    if (!hit) (groups || []).forEach(function (g) { g.members.forEach(function (m) { if (m.id === id) hit = hit || m; }); });
    if (!hit && found && found.user.id === id) hit = found.user;
    // the NPCs' rows are there before they have written anything
    if (!hit) { var pc = BR.peter.placeholder(); if (pc && pc.user.id === id) hit = pc.user; }
    if (!hit) { var jc = BR.johnson.placeholder(); if (jc && jc.user.id === id) hit = jc.user; }
    if (!hit) { var oc = BR.official.placeholder(); if (oc && oc.user.id === id) hit = oc.user; }
    return hit;
  }

  /* friends */
  function loadFriends() {
    renderFriends();
    return api.friends().then(function (r) {
      friends = r;
      setRequests(r.incoming.length);
      if (visible() && view === 'friends') renderFriends();
      return r;
    }, function (err) {
      if (!friends) renderFriendsNote(err.message);
      throw err;
    });
  }
  function renderFriendsNote(text) {
    var box = $('#fr-list');
    box.textContent = '';
    box.appendChild(el('div', 'empty', text));
  }
  function section(box, title, count) {
    var h = el('div', 'fr-title');
    h.appendChild(el('span', '', title));
    if (count !== undefined) h.appendChild(el('b', 'fr-count', count));
    box.appendChild(h);
  }
  // a player's icon, tapped: their card (名刺: the profile)
  function personRow(u, extraCls) {
    var row = el('div', 'fr-row' + (extraCls ? ' ' + extraCls : ''));
    row.dataset.uid = u.id;
    var who = el('div', 'fr-who');
    var av = K.avatarEl(u, 'fr-face');
    av.appendChild(K.presence(u.online));
    av.dataset.act = 'profile';
    av.setAttribute('role', 'button');
    av.setAttribute('aria-label', (u.name || '') + 'さんのプロフィール');
    who.appendChild(av);
    var id = el('span', 'fr-id');
    var nm = el('span', 'fr-name-row');
    nm.appendChild(el('span', 'fr-name uname', u.name));
    K.addVip(nm, K.vipLevel(u));
    id.appendChild(nm);
    var status = el('span', 'fr-status' + (u.online ? ' on' : ''), seenText(u)); status.dataset.seenUser = u.id;
    id.appendChild(status);
    who.appendChild(id);
    row.appendChild(who);
    var acts = el('div', 'fr-acts');
    row.appendChild(acts);
    return { row: row, acts: acts };
  }
  function actBtn(acts, label, act, cls, ic) {
    var b = el('button', 'fr-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.dataset.act = act;
    if (ic) b.appendChild(icon(ic));
    b.appendChild(el('span', '', label));
    acts.appendChild(b);
    return b;
  }
  // 友達と稼ぐ (js/ui/hub.js): join their invitation, invite them, or already together
  function hubButton(acts, u) {
    var H = BR.hub;
    if (!H) return;
    if (H.isMember(u.id)) { acts.appendChild(el('span', 'fr-note ok', '一緒に稼ぎ中')); return; }
    if (H.invitedBy(u.id)) { actBtn(acts, '参加する', 'hubJoin', 'gold fr-hub-join', 'check'); return; }
    var b = actBtn(acts, '一緒に稼ぐ', 'hubInvite', 'gold fr-hub', 'friends');
    b.disabled = !u.online;
  }
  function renderFriends() {
    var box = $('#fr-list');
    $('#fr-myname').textContent = me ? me.name : '';
    if (!friends) { renderFriendsNote('読み込み中…'); return; }
    box.textContent = '';
    if (found) {
      section(box, '検索結果');
      var f = found.user, p = personRow(f, 'found');
      var rel = found.self ? 'self' : f.friendship;
      if (rel === 'self') p.acts.appendChild(el('span', 'fr-note', 'あなたです'));
      else if (rel === 'friends') p.acts.appendChild(el('span', 'fr-note ok', 'フレンドです'));
      else if (rel === 'outgoing') actBtn(p.acts, '申請中（取り消す）', 'cancel', 'muted');
      else if (rel === 'incoming') { actBtn(p.acts, '承認する', 'accept', 'gold', 'check'); actBtn(p.acts, '拒否', 'decline'); }
      else actBtn(p.acts, 'フレンド申請', 'request', 'gold', 'friends');
      if (rel !== 'self') actBtn(p.acts, 'プロフィール', 'profile', 'muted');
      if (rel !== 'self' && !f.npc) actBtn(p.acts, '通報', 'report', 'muted fr-report');
      var x = el('button', 'fr-clear', '×');
      x.type = 'button';
      x.dataset.act = 'clear';
      x.setAttribute('aria-label', '検索結果を閉じる');
      p.row.appendChild(x);
      box.appendChild(p.row);
    }
    if (friends.incoming.length) {
      section(box, '届いたフレンド申請', friends.incoming.length);
      friends.incoming.forEach(function (u) {
        var p = personRow(u, 'incoming');
        actBtn(p.acts, '承認する', 'accept', 'gold', 'check');
        actBtn(p.acts, '拒否', 'decline');
        box.appendChild(p.row);
      });
    }
    section(box, 'フレンド', friends.friends.length);
    // ジョンソン, a friend from the start (an NPC: messages only)
    var jc = BR.johnson.placeholder();
    if (jc) {
      var jp = personRow(jc.user, 'friend npc');
      jp.acts.appendChild(el('span', 'fr-note', BR.johnson.intro));
      actBtn(jp.acts, 'メッセージ', 'dm');
      box.appendChild(jp.row);
    }
    if (!friends.friends.length) {
      box.appendChild(el('div', 'empty fr-empty', 'まだフレンドはいません。\n上の検索からフレンド申請を送りましょう！'));
    }
    // online first, then whoever was here most recently
    friends.friends.slice().sort(function (a, b) {
      return (b.online ? 1 : 0) - (a.online ? 1 : 0) || (b.lastSeen || 0) - (a.lastSeen || 0);
    }).forEach(function (u) {
      var p = personRow(u, 'friend' + (BR.hub && BR.hub.invitedBy(u.id) ? ' invited' : ''));
      // 一緒に稼ぐ by itself; the rest under ⋯
      hubButton(p.acts, u);
      actBtn(p.acts, '⋯', 'more', 'fr-more').setAttribute('aria-label', 'そのほかの操作');
      box.appendChild(p.row);
    });
    if (friends.outgoing.length) {
      section(box, '送ったフレンド申請', friends.outgoing.length);
      friends.outgoing.forEach(function (u) {
        var p = personRow(u, 'outgoing');
        p.acts.appendChild(el('span', 'fr-note', '承認待ち'));
        actBtn(p.acts, '取り消す', 'cancel', 'muted');
        box.appendChild(p.row);
      });
    }
  }

  function searchFriend() {
    entry.open({
      title: 'フレンドを検索',
      placeholder: 'ユーザー名（完全一致）',
      max: 24,
      button: '検索',
      enterKeyHint: 'search',
      onSubmit: function (text) {
        return api.userByName(K.nfkc(text).trim()).then(function (r) {
          found = r;
          sfx('click');
          if (visible() && view === 'friends') renderFriends();
          $('#fr-scroll').scrollTop = 0;
          return true;
        });
      }
    });
  }

  // ⋯ on a friend: 観戦する, フレンド対決, メッセージ, プロフィール
  function friendMenu(btn, u) {
    closeMenu();
    menu = el('div', 'msg-menu fr-menu');
    menu.setAttribute('role', 'menu');
    [['watch', '観戦する', !u.online], ['battle', 'フレンド対決', !u.online], ['dm', 'メッセージ'], ['profile', 'プロフィール']].forEach(function (a) {
      var b = el('button', 'msg-menu-item', a[1]);
      b.type = 'button';
      b.disabled = !!a[2];
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); friendAction(a[0], u.id); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, r.bottom + 4 + h > window.innerHeight - 8 ? r.top - h - 4 : r.bottom + 4) + 'px';
  }
  // a friend action on user `id` (from the friends pane or a profile)
  function friendAction(act, id, btn) {
    var u = knownUser(id) || { id: id, name: '' };
    if (act === 'more') { sfx('click'); friendMenu(btn, u); return; }
    if (act === 'profile') { sfx('click'); openProfile(u); return; }
    if (act === 'clear') { sfx('click'); found = null; renderFriends(); return; }
    if (act === 'dm') { sfx('click'); openDm(u); return; }
    if (act === 'watch') { sfx('click'); BR.watch.start(u); return; }
    if (act === 'battle') { sfx('click'); if (BR.play) BR.play.challenge(u); return; }
    if (act === 'hubInvite') { if (BR.hub) BR.hub.invite(u); return; }
    if (act === 'hubJoin') { if (BR.hub) BR.hub.join(u.id); return; }
    if (act === 'report') { BR.safety.report(u, 'search'); return; }
    var job;
    if (act === 'request') job = api.friendRequest(id).then(function (r) {
      sfx(r.friendship === 'friends' ? 'notify' : 'send');
      toast(r.friendship === 'friends' ? r.user.name + 'さんとフレンドになりました！' : r.user.name + 'さんにフレンド申請を送りました');
      return r.friendship;
    });
    else if (act === 'accept') job = api.friendRespond(id, true).then(function (r) {
      sfx('notify');
      toast(r.user.name + 'さんとフレンドになりました！');
      setRequests(r.pending);
      return 'friends';
    });
    else if (act === 'decline') job = api.friendRespond(id, false).then(function (r) {
      sfx('click');
      setRequests(r.pending);
      return 'none';
    });
    else if (act === 'cancel') job = api.friendCancel(id).then(function () { sfx('click'); toast('フレンド申請を取り消しました'); return 'none'; });
    else if (act === 'remove') job = K.confirmBox(function (p) {
      p.appendChild(K.nameSpan(u.name || ''));
      p.appendChild(document.createTextNode('さんをフレンドから外しますか？'));
      p.appendChild(el('small', 'confirm-sub', 'メッセージ・送金・観戦などができなくなります。'));
    }, '外す').then(function (ok) {
      if (!ok) return null;
      return api.friendRemove(id).then(function () { sfx('click'); toast('フレンドから外しました'); return 'none'; });
    });
    if (!job) return;
    job.then(function (rel) {
      if (rel === null || rel === undefined) return;
      if (found && found.user.id === id) found.user.friendship = rel;
      if (prof.data && prof.data.user.id === id) { prof.data.user.friendship = rel; fillProfile(prof.data.user, prof.data, false); }
      loadFriends().catch(function () {});
    }).catch(fail);
  }

  /* conversations and groups */
  function loadConversations() {
    renderConversations();
    api.conversations().then(function (r) {
      convs = r.conversations;
      groups = r.groups || [];
      setUnread(r.unread);
      if (group) groups.forEach(function (g) { if (g.id === group.id) group = g; });
      if (visible() && view === 'messages') renderConversations();
    }, function (err) {
      if (!convs) renderConvNote(err.message);
    });
  }
  function renderConvNote(text) {
    var list = $('#conv-list');
    list.textContent = '';
    list.appendChild(el('li', 'empty', text));
  }
  function renderConversations() {
    if (!convs) { renderConvNote('読み込み中…'); return; }
    var list = $('#conv-list');
    list.textContent = '';
    // Ice Smoker公式, マイクソン and ジョンソン are always at the top, even before they have written
    var officialConv = null, peterConv = null, johnsonConv = null, rest = [];
    convs.forEach(function (c) {
      if (BR.official.is(c.user)) officialConv = c;
      else if (BR.peter.is(c.user)) peterConv = c;
      else if (BR.johnson.is(c.user)) johnsonConv = c;
      else rest.push({ at: c.at, row: convRow(c) });
    });
    (groups || []).forEach(function (g) { rest.push({ at: g.at, row: groupRow(g) }); });
    rest.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    officialConv = officialConv || BR.official.placeholder();
    if (officialConv) list.appendChild(convRow(officialConv));
    peterConv = peterConv || BR.peter.placeholder();
    if (peterConv) list.appendChild(convRow(peterConv));
    johnsonConv = johnsonConv || BR.johnson.placeholder();
    if (johnsonConv) list.appendChild(convRow(johnsonConv));
    rest.forEach(function (x) { list.appendChild(x.row); });
    if (!rest.length) list.appendChild(el('li', 'empty', 'フレンドとここで会話できます。\n「＋ グループを作る」でグループも作れます。'));
  }
  function convRow(c) {
    var lender = BR.peter.is(c.user), friend = BR.johnson.is(c.user), bot = BR.official.is(c.user), npc = lender || friend || bot;
    var li = el('li', 'conv-row' + (c.unread ? ' unread' : '') + (npc ? ' npc' : '') + (bot ? ' official' : ''));
    li.dataset.uid = c.user.id;
    var av = K.avatarEl(c.user);
    av.appendChild(K.presence(npc || c.user.online));
    li.appendChild(av);
    var mid = el('div', 'conv-mid');
    var name = el('div', 'conv-name uname', c.user.name);
    if (npc) name.appendChild(el('span', 'npc-tag' + (friend ? ' friend' : bot ? ' official' : ''), friend ? '友達' : bot ? '公式' : '金貸し'));
    mid.appendChild(name);
    var key = 'dm:' + c.user.id;
    mid.appendChild(el('div', 'conv-last' + (typingNames(key).length ? ' typing' : ''), typingNames(key).length ? '入力中…'
      : c.last ? preview(c.last) : bot ? BR.official.intro : friend ? BR.johnson.intro + 'です' : 'お金に困ったら相談においで（「100万貸して」と書いてね）'));
    li.appendChild(mid);
    li.appendChild(convSide(c.at, c.unread));
    return li;
  }
  function convSide(at, n) {
    var side = el('div', 'conv-side');
    side.appendChild(el('span', 'conv-time', at ? K.fmtTime(at) : ''));
    var b = el('b', 'badge');
    K.badge(b, n);
    side.appendChild(b);
    return side;
  }
  // up to three faces for a group
  function groupFaces(g, cls) {
    var box = el('span', 'group-faces' + (cls ? ' ' + cls : ''));
    var others = g.members.filter(function (m) { return !me || m.id !== me.id; });
    others.slice(0, 3).forEach(function (m) { box.appendChild(K.avatarEl(m, 'sm')); });
    return box;
  }
  function groupRow(g) {
    var li = el('li', 'conv-row group' + (g.unread ? ' unread' : ''));
    li.dataset.gid = g.id;
    li.appendChild(groupFaces(g));
    var mid = el('div', 'conv-mid');
    var name = el('div', 'conv-name');
    name.appendChild(el('span', 'uname', g.name));
    name.appendChild(el('span', 'group-count', g.members.length + '人'));
    mid.appendChild(name);
    var key = 'group:' + g.id, typing = typingNames(key);
    var last = '';
    if (typing.length) last = typing[0] + 'さんが入力中…';
    else if (g.last) last = g.last.kind === 'system' ? K.clip(g.last.text, 60) : (g.last.mine ? 'あなた' : g.last.from || '') + ': ' + K.clip(g.last.text, 50);
    mid.appendChild(el('div', 'conv-last' + (typing.length ? ' typing' : ''), last));
    li.appendChild(mid);
    li.appendChild(convSide(g.at, g.unread));
    return li;
  }
  function itemName(id) {
    var list = BR.CONFIG.shop;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
    return 'アイテム';
  }
  function carName(model) {
    var cars = BR.CONFIG.cars;
    for (var i = 0; i < cars.length; i++) if (cars[i].id === model) return cars[i].name;
    return '車';
  }
  function preview(last) {
    if (last.retracted) return last.mine ? '送信を取り消しました' : 'メッセージの送信が取り消されました';
    if (last.kind === 'transfer') {
      return (last.mine ? '送金しました: ' : '届きました: ') + U.fmt(last.amount) + ' ' + (K.CUR[last.currency] || K.CUR.tokens).name;
    }
    if (last.kind === 'gift') return (last.mine ? 'プレゼントしました: ' : 'プレゼントが届きました: ') + carName(last.text);
    if (last.kind === 'bill') return 'カジノスロット使用料のご請求: $' + U.fmt(last.amount);
    if (last.kind === 'present') return BR.presents.preview(last);
    if (last.kind === 'car_offer' || last.kind === 'car_sold') return BR.carsale.preview(last);
    if (last.kind === 'item') return (last.mine ? '譲りました: ' : '届きました: ') + itemName(last.text) + ' ×' + last.amount;
    if (last.kind === 'offer') return K.clip(last.text, 60);
    if (last.kind === 'system') return K.clip(last.text, 60);
    return (last.mine ? 'あなた: ' : '') + K.clip(last.text, 60);
  }
  // keep the lists in step with live messages
  function touchConv(m, other, mine) {
    if (!convs) return;
    var c = null;
    for (var i = 0; i < convs.length; i++) if (convs[i].user.id === other) { c = convs.splice(i, 1)[0]; break; }
    if (!c) {
      var u = mine ? (peer && peer.id === other ? peer : null) : m.from;
      if (!u || !u.name) { convs = null; return; } // unknown: reload when the list is opened
      c = { user: { id: other, name: u.name, avatar: u.avatar, online: mine ? !!u.online : true }, unread: 0, friend: true };
    }
    c.at = m.at;
    c.last = { kind: m.kind, text: m.text, amount: m.amount, currency: m.currency, mine: mine };
    if (!mine && !viewing('dm:' + other)) c.unread++;
    convs.unshift(c);
    if (visible() && view === 'messages') renderConversations();
  }
  function groupById(id) {
    for (var i = 0; i < (groups || []).length; i++) if (groups[i].id === id) return groups[i];
    return null;
  }
  function touchGroup(m, mine) {
    var g = groupById(m.group);
    if (!g) {
      // a new group (someone added me): fetch the list again
      groups = null;
      convs = null;
      if (visible() && view === 'messages') loadConversations();
      return;
    }
    g.at = m.at;
    g.last = { kind: m.kind, text: m.text, mine: mine, from: m.from ? m.from.name : null };
    if (!mine && !viewing('group:' + g.id)) g.unread = (g.unread || 0) + 1;
    if (visible() && view === 'messages') renderConversations();
  }

  /* chat (a conversation and a group share one view) */
  function chan(key) {
    return chans[key] || (chans[key] = { list: [], ids: {}, hasMore: false, loaded: false, loading: null, older: false, readUpTo: 0, reads: {} });
  }
  function byId(a, b) { return a.id - b.id; }
  function chatKey() { return view === 'dm' && peer ? 'dm:' + peer.id : view === 'group' && group ? 'group:' + group.id : null; }
  function chatOf(key) {
    var p = key.split(':');
    return p[0] === 'group' ? { group: Number(p[1]) } : { with: Number(p[1]) };
  }
  function viewing(key) { return visible() && !document.hidden && chatKey() === key; }
  // "dm:<low id>:<high id>" -> "dm:<the other player>"; groups: "group:<id>"
  function keyOf(m) {
    if (m.group) return 'group:' + m.group;
    if (String(m.channel).indexOf('group:') === 0) return m.channel;
    if (m.peer) return 'dm:' + m.peer;
    var p = String(m.channel).split(':'), a = Number(p[1]), b = Number(p[2]);
    return 'dm:' + (me && a === me.id ? b : a);
  }
  function chatList() { return $('#chat-list'); }
  function scroller() { var l = chatList(); return l.parentNode; }
  function nearBottom(sc) { return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160; }
  function scrollChat() { var sc = scroller(); sc.scrollTop = sc.scrollHeight; }

  function loadChan(key) {
    var c = chan(key);
    if (c.loading) return c.loading;
    c.loading = api.messages(chatOf(key)).then(function (r) {
      c.loading = null;
      c.loaded = true;
      if (!c.list.length) c.hasMore = r.hasMore;
      r.messages.forEach(function (m) {
        if (c.ids[m.id]) return;
        c.ids[m.id] = true;
        c.list.push(m);
      });
      c.list.sort(byId);
      if (typeof r.readUpTo === 'number') c.readUpTo = Math.max(c.readUpTo, r.readUpTo);
      (r.reads || []).forEach(function (x) { c.reads[x.id] = Math.max(c.reads[x.id] || 0, x.upto); });
      if (r.group) {
        var g = groupById(r.group.id);
        if (g) { r.group.unread = 0; groups[groups.indexOf(g)] = r.group; }
        if (group && group.id === r.group.id) { group = r.group; if (view === 'group') renderChatHead(); }
      }
      return c;
    }, function (err) {
      c.loading = null;
      throw err;
    });
    return c.loading;
  }

  function showChat(key) {
    var c = chan(key);
    var npc = key.indexOf('dm:') === 0 && peer && BR.peter.is(peer);
    if (key.indexOf('dm:') === 0 && peer && BR.johnson.is(peer)) BR.johnson.opened();
    renderChat();
    scrollChat();
    if (!c.loaded) {
      loadChan(key).then(function () {
        if (chatKey() !== key) return;
        renderChat();
        scrollChat();
        if (npc) BR.peter.opened(c.list);
      }, function (err) {
        if (chatKey() === key && !c.list.length) renderChat(err.message);
      });
    } else if (npc) BR.peter.opened(c.list);
    markRead(key);
  }

  function renderChat(note) {
    var key = chatKey();
    if (!key) return;
    var c = chan(key), list = chatList();
    list.textContent = '';
    if (c.hasMore) list.appendChild(el('div', 'chat-more', '上にスクロールで以前のメッセージ'));
    var prev = null;
    c.list.forEach(function (m) { appendMsg(list, m, prev, key); prev = m; });
    if (!c.list.length) {
      list.appendChild(el('div', 'empty chat-empty', note || (!c.loaded ? '読み込み中…'
        : key.indexOf('group:') === 0 ? 'グループができました。\nメッセージを送ってみましょう！'
          : peer && BR.official.is(peer) ? '運営へのお問い合わせはこちらへ。\n不具合は「報告」、アイデアは「意見案」からどうぞ。'
            : 'まだメッセージはありません。\nあいさつしてみましょう！')));
    }
    renderTyping();
    renderChatBar();
  }
  function appendMsg(list, m, prev, key) {
    var typing = list.querySelector('.typing-row');
    var at = typing || null;
    if (!prev || !K.sameDay(new Date(prev.at), new Date(m.at))) list.insertBefore(el('div', 'day-sep', K.fmtDay(m.at)), at);
    // a message that just came in pops in (css/juice.css)
    var node = msgEl(m, key, prev);
    node.classList.add('jc-new');
    list.insertBefore(node, at);
  }

  // 既読: in a conversation once the friend has read it; in a group, how many have
  function readText(key, m) {
    var c = chans[key];
    if (!c) return '';
    if (key.indexOf('group:') === 0) {
      var n = 0;
      Object.keys(c.reads).forEach(function (id) { if (c.reads[id] >= m.id) n++; });
      return n ? '既読 ' + n : '';
    }
    return c.readUpTo >= m.id ? '既読' : '';
  }
  function timeEl(m, key, mine) {
    var t = el('span', 'msg-time');
    if (mine) {
      var r = el('b', 'msg-read', readText(key, m));
      t.appendChild(r);
    }
    t.appendChild(document.createTextNode(K.fmtTime(m.at)));
    // ⋯: copy, take back (my words, within the hour), report (someone's words)
    if (m.kind === 'text' && !m.retracted) {
      var more = el('button', 'msg-more', '⋯');
      more.type = 'button';
      more.setAttribute('aria-label', 'メッセージのメニュー');
      more.addEventListener('click', function (e) { e.stopPropagation(); sfx('click'); openMenu(more, m, mine); });
      t.appendChild(more);
    }
    return t;
  }
  function updateReads() {
    var key = chatKey();
    if (!key) return;
    var c = chans[key];
    if (!c) return;
    $$('#chat-list [data-mid]').forEach(function (n) {
      var m = c.ids[n.dataset.mid] ? find(c, Number(n.dataset.mid)) : null;
      var r = n.querySelector('.msg-read');
      if (m && r) r.textContent = readText(key, m);
    });
  }
  function find(c, id) {
    for (var i = c.list.length - 1; i >= 0; i--) if (c.list[i].id === id) return c.list[i];
    return null;
  }
  function refreshMsg(id) {
    var key = chatKey();
    if (!key || !visible() || !chans[key]) return;
    var c = chans[key], m = c.ids[id] ? find(c, id) : null;
    var old = m && chatList().querySelector('[data-pid="' + id + '"]');
    if (!old) return;
    var node = msgEl(m, key, c.list[c.list.indexOf(m) - 1] || null);
    old.parentNode.replaceChild(node, old);
  }
  // a card changed (js/ui/carsale.js): every copy of the message, and the chat on screen
  function patchMsg(id, patch) {
    Object.keys(chans).forEach(function (k) {
      var m = chans[k].ids[id] ? find(chans[k], id) : null;
      if (m) Object.keys(patch).forEach(function (p) { m[p] = patch[p]; });
    });
    refreshMsg(id);
  }
  // a present was received (on this device or another, by me or by the friend)
  function onPresent(d) {
    if (!d || !d.id) return;
    Object.keys(chans).forEach(function (k) {
      var m = chans[k].ids[d.id] ? find(chans[k], d.id) : null;
      if (m && d.claimed) m.claimed = true;
    });
    refreshMsg(d.id);
  }

  // money, a car or an item: the tap that receives it
  function claimMsg(m) {
    if (!m.pending || m.claimed || K.receiptExpired(m) || claiming[m.id]) return;
    claiming[m.id] = true;
    refreshMsg(m.id);
    api.claim(m.id).then(function (r) {
      delete claiming[m.id];
      if (r.me) { BR.social.setMe(r.me); BR.app.serverBalance(r.me); }
      patchMsg(m.id, { claimed: true });
      sfx(m.kind === 'transfer' ? 'money' : 'purchase');
      toast((m.kind === 'transfer' ? U.fmt(m.amount) + ' ' + (K.CUR[m.currency] || K.CUR.tokens).name
        : m.kind === 'gift' ? carName(m.text) : itemName(m.text) + ' ×' + m.amount) + ' を受け取りました！', 2800);
      if (BR.juice && BR.juice.reward) BR.juice.reward('#toast', 2);
      if (m.kind === 'gift') BR.cars.changed();
    }, function (err) {
      delete claiming[m.id];
      if (err && err.code === 'claimed') patchMsg(m.id, { claimed: true });
      else if (err && err.code === 'expired') patchMsg(m.id, { expired: true });
      else refreshMsg(m.id);
      fail(err);
    });
  }
  // TWO STATE公式's monthly bill for the slots: paid with the card's tap (taken from the $ once its days are over)
  function payBill(m) {
    if (!m.pending || m.claimed || claiming[m.id]) return;
    claiming[m.id] = true;
    refreshMsg(m.id);
    api.payBill(m.id).then(function (r) {
      delete claiming[m.id];
      if (r.me) { BR.social.setMe(r.me); BR.app.serverBalance(r.me); }
      patchMsg(m.id, { claimed: true });
      sfx('register');
      toast('カジノスロット使用料 $' + U.fmt(m.amount) + ' を支払いました', 2800);
    }, function (err) {
      delete claiming[m.id];
      refreshMsg(m.id);
      fail(err);
    });
  }
  // the card of money, a car or an item (since DEV9 it waits for the tap: m.pending)
  function canClaim(m, mine) { return !!m.pending && !mine && !m.claimed && !K.receiptExpired(m); }
  function cardNode(m, mine, cls) {
    var node = el('div', 'msg xfer' + (cls ? ' ' + cls : '') + (mine ? ' mine' : ' theirs') + (canClaim(m, mine) ? ' can-claim' : '') + (m.pending && m.claimed ? ' claimed' : ''));
    node.dataset.pid = m.id;
    return node;
  }
  function cardBox(m, mine, cls) {
    var open = canClaim(m, mine);
    var card = el(open ? 'button' : 'div', 'xfer-card' + (cls ? ' ' + cls : ''));
    if (open) {
      card.type = 'button';
      card.addEventListener('click', function () { claimMsg(m); });
    }
    return card;
  }
  // under the card: whether it was received (`hint`: where it is once it is)
  function claimState(card, m, mine, hint) {
    if (m.pending) {
      card.appendChild(el('div', 'pr-state', K.receiptExpired(m) ? '期限を過ぎたため受け取れません' : mine ? (m.returned ? '相手のアカウントが削除されたため、あなたに戻りました' : m.claimed ? '受け取られました' : 'まだ受け取られていません')
        : m.claimed ? '受け取り済み' : claiming[m.id] ? '受け取っています…' : 'タップして受け取る'));
    }
    K.receiptHint(card, m);
    if (hint && !mine && (!m.pending || m.claimed)) card.appendChild(el('div', 'gift-hint', hint));
  }

  /* the ⋯ under a message */
  function closeMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menu = null;
  }
  function openMenu(btn, m, mine) {
    closeMenu();
    var acts = [['copy', 'コピー']];
    if (mine && Date.now() - m.at < BR.CONFIG.retract.minutes * 60000) acts.push(['retract', '送信を取り消す']);
    if (!mine && m.from && !(BR.peter.is(m.from) || BR.johnson.is(m.from) || BR.official.is(m.from))) acts.push(['report', 'このメッセージを通報']);
    menu = el('div', 'msg-menu');
    menu.setAttribute('role', 'menu');
    acts.forEach(function (a) {
      var b = el('button', 'msg-menu-item' + (a[0] === 'copy' ? '' : ' warn'), a[1]);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', function (e) { e.stopPropagation(); sfx('click'); closeMenu(); msgAction(a[0], m); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    var r = btn.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(mine ? r.right - w : r.left, window.innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, r.bottom + 4 + h > window.innerHeight - 8 ? r.top - h - 4 : r.bottom + 4) + 'px';
  }
  function msgAction(what, m) {
    if (what === 'copy') {
      K.copyText(m.text).then(function () { toast('コピーしました', 1600); }, function () { toast('コピーできませんでした', 2000); });
    } else if (what === 'report') {
      BR.safety.reportMessage(m);
    } else if (what === 'retract') {
      K.confirmBox(function (p) { p.textContent = 'このメッセージの送信を取り消しますか？相手の画面からも消えます。'; }, '取り消す').then(function (ok) {
        if (!ok) return;
        api.retract(m.id).then(function (r) {
          onRetract({ id: m.id, at: r.retracted });
          toast('送信を取り消しました', 2000);
        }, fail);
      });
    }
  }
  // a message taken back (here, on another device, or by the other side)
  function onRetract(d) {
    if (!d || !d.id) return;
    patchMsg(d.id, { retracted: d.at || Date.now(), text: '' });
    // the lists' newest lines: fetched again
    convs = null;
    groups = null;
    if (visible() && view === 'messages') loadConversations();
  }
  // the automatic filter stopped my chat, or an operator let it go again
  function onChatBan(d) {
    if (!d) return;
    if (d.me) BR.social.setMe(d.me);
    else if (me) me.chatBan = d.on ? me.chatBan || { at: Date.now(), why: '' } : null;
    renderChatBar();
    if (d.on) { sfx('deny'); toast(d.message || 'チャットは停止中です', 6000); }
    else { sfx('notify'); toast('運営がチャットの停止を解除しました。またチャットできます', 4200); }
  }

  function msgEl(m, key, prev) {
    var mine = !!(m.from && me && m.from.id === me.id);
    var inGroup = key.indexOf('group:') === 0;
    var node, card;
    if (m.kind === 'system') {
      node = el('div', 'msg sys');
      node.appendChild(el('span', 'sys-text', m.text));
      node.appendChild(el('span', 'msg-time', K.fmtTime(m.at)));
      return node;
    }
    if (m.kind === 'offer') return BR.peter.offerEl(m);
    if (m.kind === 'present') {
      node = BR.presents.bubble(m, mine);
    } else if (m.kind === 'car_offer') {
      node = BR.carsale.offerEl(m, mine);
    } else if (m.kind === 'car_sold') {
      node = BR.carsale.soldEl(m, mine);
    } else if (m.kind === 'transfer') {
      node = cardNode(m, mine, '');
      card = cardBox(m, mine, '');
      card.appendChild(el('div', 'xfer-label', mine ? '送金しました' : '送金が届きました'));
      card.appendChild(K.amountEl(m.amount, m.currency, 'xfer-amount'));
      claimState(card, m, mine, '');
      node.appendChild(card);
    } else if (m.kind === 'bill') {
      node = cardNode(m, mine, 'bill');
      var payable = canClaim(m, mine);
      card = el(payable ? 'button' : 'div', 'xfer-card bill-card');
      if (payable) { card.type = 'button'; card.addEventListener('click', function () { payBill(m); }); }
      card.appendChild(el('div', 'xfer-label', 'カジノスロット使用料のご請求'));
      card.appendChild(K.amountEl(m.amount, 'dollars', 'xfer-amount'));
      card.appendChild(el('div', 'bill-text', m.text));
      card.appendChild(el('div', 'pr-state', m.claimed ? '支払い済み' : claiming[m.id] ? '支払っています…' : 'タップして支払う'));
      node.appendChild(card);
    } else if (m.kind === 'item') {
      node = cardNode(m, mine, 'gift item');
      card = cardBox(m, mine, 'gift-card');
      card.appendChild(el('div', 'xfer-label', mine ? 'アイテムを譲りました' : 'アイテムが届きました！'));
      var ip = el('span', 'gift-item');
      var isrc = BR.SOCIAL_IMG.items[m.text];
      if (isrc) ip.style.backgroundImage = 'url("' + isrc + '")';
      card.appendChild(ip);
      card.appendChild(el('div', 'gift-name', itemName(m.text) + ' ×' + m.amount));
      claimState(card, m, mine, 'Shop の「所有」で見られます');
      node.appendChild(card);
    } else if (m.kind === 'gift') {
      node = cardNode(m, mine, 'gift');
      card = cardBox(m, mine, 'gift-card');
      card.appendChild(el('div', 'xfer-label', mine ? '車をプレゼントしました' : '車のプレゼントが届きました！'));
      var pic = el('span', 'gift-car');
      var src = BR.SOCIAL_IMG.cars[m.text];
      if (src) pic.style.backgroundImage = 'url("' + src + '")';
      card.appendChild(pic);
      card.appendChild(el('div', 'gift-name', carName(m.text)));
      claimState(card, m, mine, 'Car Owner の「ガレージ」で見られます');
      node.appendChild(card);
    } else if (m.retracted) {
      node = el('div', 'msg retracted ' + (mine ? 'mine' : 'theirs'));
      node.appendChild(el('div', 'bubble', mine ? '送信を取り消しました' : 'メッセージの送信が取り消されました'));
    } else {
      node = el('div', 'msg ' + (mine ? 'mine' : 'theirs'));
      // in a group: who wrote it (a run of messages by one person shows it once)
      if (inGroup && !mine && m.from && !(prev && prev.from && prev.from.id === m.from.id && prev.kind === 'text' && m.at - prev.at < 300000)) {
        var who = el('div', 'msg-name');
        who.appendChild(K.avatarEl(m.from, 'xs'));
        who.appendChild(el('span', 'uname', m.from.name || '?'));
        node.appendChild(who);
      }
      node.appendChild(el('div', 'bubble', m.text));
    }
    if (!node.dataset.pid) node.dataset.pid = m.id;
    if (mine) node.dataset.mid = m.id;
    node.appendChild(timeEl(m, key, mine));
    return node;
  }
  function renderChatBar() {
    var key = chatKey();
    if (!key) return;
    var d = drafts[key];
    var ph = $('#chat-placeholder');
    var stopped = me && me.chatBan && !(peer && view === 'dm' && (BR.official.is(peer) || BR.peter.is(peer) || BR.johnson.is(peer)));
    ph.textContent = d ? K.clip(d, 80) : stopped ? 'チャットは停止中です（運営の確認待ち）' : view === 'group' ? 'グループにメッセージ…'
      : peer && BR.peter.is(peer) ? '「100万貸して」「100万返す」のように書けます'
      : peer && BR.johnson.is(peer) ? 'ジョンソンに話しかける…'
      : peer && BR.official.is(peer) ? '運営へのメッセージを入力…' : 'メッセージを入力…';
    ph.classList.toggle('draft', !!d);
  }

  // a message that was just added to the cache
  function showLive(key, m, mine) {
    if (!visible() || chatKey() !== key) return;
    var c = chan(key), list = chatList(), sc = scroller();
    var stick = mine || nearBottom(sc);
    var i = c.list.indexOf(m);
    var empty = list.querySelector('.chat-empty');
    if (empty || i !== c.list.length - 1) renderChat();
    else appendMsg(list, m, c.list[i - 1] || null, key);
    if (stick) scrollChat();
    entry.scrollFeed();
  }

  function loadOlder() {
    var key = chatKey();
    if (!key) return;
    var c = chan(key);
    if (!c.hasMore || c.older || !c.list.length) return;
    c.older = true;
    api.messages(chatOf(key), c.list[0].id).then(function (r) {
      c.older = false;
      c.hasMore = r.hasMore;
      var added = r.messages.filter(function (m) {
        if (c.ids[m.id]) return false;
        c.ids[m.id] = true;
        return true;
      });
      c.list = added.concat(c.list);
      if (chatKey() !== key) return;
      var sc = scroller(), h = sc.scrollHeight, top = sc.scrollTop;
      renderChat();
      sc.scrollTop = top + (sc.scrollHeight - h);
    }, function () { c.older = false; });
  }

  // read up to the newest message (the others see 既読)
  var readTimers = {};
  function markRead(key) {
    var gen = sessionGeneration;
    if (key.indexOf('group:') === 0) {
      var g = groupById(Number(key.slice(6)));
      if (g) g.unread = 0;
    } else {
      var id = Number(key.slice(3));
      (convs || []).forEach(function (c) { if (c.user.id === id) c.unread = 0; });
    }
    clearTimeout(readTimers[key]);
    readTimers[key] = setTimeout(function () {
      if (gen !== sessionGeneration) return;
      delete readTimers[key];
      api.read(chatOf(key)).then(function (r) { if (gen === sessionGeneration) setUnread(r.unread); }, function () {});
    }, 200);
  }

  /* 入力中 */
  var typingSent = {};
  function sendTyping(key) {
    if (key.indexOf('dm:') === 0 && peer && (BR.peter.is(peer) || BR.johnson.is(peer) || BR.official.is(peer))) return;
    var t = Date.now();
    if (typingSent[key] && t - typingSent[key] < 2500) return;
    typingSent[key] = t;
    var c = chatOf(key);
    var ws = c.group ? { op: 'typing', group: c.group } : { op: 'typing', to: c.with };
    if (!BR.live.send(ws)) api.typing(c).catch(function () {});
  }
  function typingNames(key) {
    var t = typers[key], out = [], now = Date.now();
    if (!t) return out;
    Object.keys(t).forEach(function (id) { if (t[id].until > now) out.push(t[id].name); });
    return out;
  }
  var typingTimer = 0;
  function onTyping(ev) {
    if (!me || !ev || !ev.from || ev.from.id === me.id) return;
    var key = ev.group ? 'group:' + ev.group : 'dm:' + ev.from.id;
    var t = typers[key] || (typers[key] = {});
    t[ev.from.id] = { name: ev.from.name, until: Date.now() + 4500 };
    typingChanged(key);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(function () { Object.keys(typers).forEach(typingChanged); }, 4600);
  }
  function typingChanged(key) {
    if (!visible()) return;
    if (chatKey() === key) renderTyping();
    else if (view === 'messages') renderConversations();
  }
  function renderTyping() {
    var list = chatList();
    var old = list.querySelector('.typing-row');
    if (old) old.parentNode.removeChild(old);
    var key = chatKey();
    var names = key ? typingNames(key) : [];
    if (!names.length) return;
    var sc = scroller(), stick = nearBottom(sc);
    var row = el('div', 'msg theirs typing-row');
    var b = el('div', 'bubble typing-dots');
    b.appendChild(el('i'));
    b.appendChild(el('i'));
    b.appendChild(el('i'));
    row.appendChild(b);
    row.appendChild(el('span', 'msg-time', (names.length > 2 ? names.slice(0, 2).join('さん、') + 'さんほか' : names.join('さんと') + 'さん') + 'が入力中…'));
    list.appendChild(row);
    if (stick) scrollChat();
    entry.scrollFeed();
  }

  function compose() {
    var key = chatKey();
    if (!key) return;
    var chat = chatOf(key);
    entry.open({
      title: view === 'group' ? group.name : peer.name,
      value: drafts[key] || '',
      placeholder: 'メッセージを入力',
      feed: chatList(),
      anchor: scroller(),
      rule: true,
      onDraft: function (t) { drafts[key] = t; if (t) sendTyping(key); },
      onSubmit: function (text) {
        return api.send(chat, text).then(function (r) {
          drafts[key] = '';
          typingSent[key] = 0;
          sfx('send');
          onMsg(r.message);
          // ピーター answers right away (and a loan leaves 「○○万円貸しました」)
          if (r.reply) {
            setTimeout(function () { onMsg(r.reply); sfx('message'); }, 500);
            BR.peter.setDebt(r.debt);
          }
          if (r.lent) {
            setTimeout(function () { onMsg(r.lent); sfx('money'); toast(r.lent.text, 3200); if (BR.juice) BR.juice.reward('#toast', 2); }, 900);
          }
        });
      },
      onClose: function () {
        renderChatBar();
        scrollChat();
      }
    });
  }

  // the head of the chat: who (or which group), and what can be done there
  function renderChatHead() {
    var u = $('#dm-user');
    u.textContent = '';
    var isGroup = view === 'group';
    var npc = !isGroup && (BR.peter.is(peer) || BR.johnson.is(peer) || BR.official.is(peer));
    if (isGroup) {
      u.appendChild(groupFaces(group, 'head'));
      var gt = el('span', 'dm-id');
      gt.appendChild(el('span', 'dm-name uname', group.name));
      var on = group.members.filter(function (m) { return m.online && (!me || m.id !== me.id); }).length;
      gt.appendChild(el('span', 'dm-status', group.members.length + '人' + (on ? '・' + on + '人がオンライン' : '')));
      u.appendChild(gt);
    } else {
      u.appendChild(K.avatarEl(peer));
      var t = el('span', 'dm-id');
      var nm = el('span', 'dm-name-row');
      nm.appendChild(el('span', 'dm-name uname', peer.name));
      K.addVip(nm, K.vipLevel(peer));
      t.appendChild(nm);
      var st = el('span', 'dm-status');
      st.appendChild(K.presence(npc || peer.online));
      st.appendChild(el('span', '', seenText(peer)));
      t.appendChild(st);
      u.appendChild(t);
    }
    $('#dm-battle').hidden = isGroup || npc;
    $('#dm-battle').disabled = !isGroup && !npc && !peer.online;
    $('#dm-money').hidden = isGroup || npc;
    $('#dm-car').hidden = isGroup || npc;
    $('#dm-profile').hidden = isGroup || npc;
    $('#dm-coop').hidden = !isGroup;
    $('#dm-members').hidden = !isGroup;
    $('#dm-leave').hidden = !isGroup;
    $('#dm-debt').hidden = isGroup || !BR.peter.is(peer);
    if (!isGroup && BR.peter.is(peer)) BR.peter.renderHead();
    $('#dm-johnson').hidden = isGroup || !BR.johnson.is(peer);
    if (!isGroup && BR.johnson.is(peer)) BR.johnson.renderHead();
    $('#dm-official').hidden = isGroup || !BR.official.is(peer);
    // presents go to a friend (not to a group or an NPC)
    var gift = !isGroup && !npc;
    $('#chat-gift').hidden = !gift;
    $('#pane-chat').classList.toggle('can-gift', gift);
  }

  function enterChat(v) {
    K.closeModals();
    if (!visible()) { cameFrom = BR.screens.current() === 'start' ? 'start' : 'slot'; BR.screens.show('board'); }
    setView(v);
  }
  function openDm(user) {
    if (!user || !me || user.id === me.id) return;
    peer = { id: user.id, name: user.name, avatar: user.avatar, online: !!user.online, npc: user.npc || null, lastSeen: user.lastSeen || null, vip: user.vip, vipBadge: user.vipBadge };
    group = null;
    enterChat('dm');
    // クエスト「友達のチャットを覗く」 (the server checks the friendship)
    if (!peer.npc) api.peek(peer.id).catch(function () {});
  }
  function openGroup(g) {
    if (!g || !me) return;
    group = groupById(g.id) || g;
    peer = null;
    enterChat('group');
  }
  function openGroupById(id) {
    var g = groupById(id);
    if (g) { openGroup(g); return; }
    api.conversations().then(function (r) {
      convs = r.conversations;
      groups = r.groups || [];
      var hit = groupById(id);
      if (hit) openGroup(hit);
    }, fail);
  }

  function showMembers() {
    if (!group) return;
    $('#pick-title').textContent = group.name + '（' + group.members.length + '人）';
    var list = $('#pick-list');
    list.textContent = '';
    group.members.forEach(function (m) {
      var row = el('div', 'pick-row member');
      var av = K.avatarEl(m, 'sm');
      av.appendChild(K.presence(m.online));
      row.appendChild(av);
      row.appendChild(el('span', 'pick-name uname', m.name));
      row.appendChild(el('span', 'pick-sub', me && m.id === me.id ? 'あなた' : m.online ? 'オンライン' : m.lastSeen ? '最終オンライン ' + ago(m.lastSeen) : ''));
      list.appendChild(row);
    });
    K.showModal('pick');
  }
  function leaveGroup() {
    var g = group;
    if (!g) return;
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('グループ「' + g.name + '」を抜けますか？'));
      p.appendChild(el('small', 'confirm-sub', 'このグループのメッセージは見られなくなります。'));
    }, '抜ける').then(function (ok) {
      if (!ok) return;
      api.leaveGroup(g.id).then(function (r) {
        sfx('click');
        groups = (groups || []).filter(function (x) { return x.id !== g.id; });
        delete chans['group:' + g.id];
        group = null;
        setUnread(r.unread);
        toast('グループを抜けました');
        setView('messages');
      }, fail);
    });
  }

  /* ------------------------------------------------------------ a new group --- */
  var groupForm = { picked: {}, busy: false };
  function openGroupForm() {
    groupForm.picked = {};
    groupForm.busy = false;
    $('#group-name').value = '';
    $('#group-error').textContent = '';
    $('#group-ov').hidden = false;
    K.fitOverlay($('#group-ov'));
    renderGroupPick();
    (friends ? Promise.resolve(friends) : loadFriends()).then(renderGroupPick, function (err) { $('#group-error').textContent = err.message; });
  }
  function closeGroupForm() {
    var ov = $('#group-ov');
    if (ov.hidden) return false;
    $('#group-name').blur();
    ov.hidden = true;
    BR.app.relayout();
    return true;
  }
  function renderGroupPick() {
    var box = $('#group-pick');
    box.textContent = '';
    if (!friends) { box.appendChild(el('div', 'group-pick-note', '読み込み中…')); return; }
    if (!friends.friends.length) { box.appendChild(el('div', 'group-pick-note', 'グループに入れられるフレンドがいません。')); return; }
    friends.friends.forEach(function (f) {
      var b = el('button', 'group-pick-row' + (groupForm.picked[f.id] ? ' on' : ''));
      b.type = 'button';
      b.dataset.uid = f.id;
      b.appendChild(K.avatarEl(f, 'sm'));
      b.appendChild(el('span', 'group-pick-name', f.name));
      b.appendChild(el('i', 'group-pick-check'));
      box.appendChild(b);
    });
    $('#group-make').textContent = '作成する' + (count(groupForm.picked) ? '（' + (count(groupForm.picked) + 1) + '人）' : '');
  }
  function count(o) { return Object.keys(o).filter(function (k) { return o[k]; }).length; }
  function submitGroup() {
    if (groupForm.busy) return;
    var name = K.nfkc($('#group-name').value).trim();
    var ids = Object.keys(groupForm.picked).filter(function (k) { return groupForm.picked[k]; }).map(Number);
    var err = !name ? 'グループ名を入力してください' : !ids.length ? 'メンバーを選んでください' : '';
    $('#group-error').textContent = err;
    if (err) { sfx('deny'); return; }
    groupForm.busy = true;
    $('#group-make').disabled = true;
    api.makeGroup(name, ids).then(function (r) {
      groupForm.busy = false;
      $('#group-make').disabled = false;
      closeGroupForm();
      sfx('notify');
      groups = groups || [];
      if (!groupById(r.group.id)) groups.unshift(r.group);
      toast('グループ「' + r.group.name + '」を作りました');
      openGroup(r.group);
    }, function (e) {
      groupForm.busy = false;
      $('#group-make').disabled = false;
      $('#group-error').textContent = e.message;
    });
  }

  /* ------------------------------------------------------------ profile --- */
  var prof = { data: null, seq: 0 };
  function openProfile(user) {
    if (!BR.resources.ready('profile')) {
      var owner = me && me.id, request = ++prof.seq;
      return Promise.all([BR.resources.load('online'), BR.resources.load('profile')]).then(function () { if (me && me.id === owner && request === prof.seq) openProfile(user); }, K.fail);
    }
    if (!user || !me) return;
    if (BR.peter.is(user) || BR.johnson.is(user) || BR.official.is(user)) { openDm(user); return; }
    var seq = ++prof.seq;
    prof.data = null;
    fillProfile(user, null, user.id === me.id);
    K.showModal('profile');
    api.user(user.id).then(function (r) {
      if (seq !== prof.seq) return;
      prof.data = r;
      fillProfile(r.user, r, r.self);
    }, function (err) {
      if (seq !== prof.seq) return;
      K.closeModal('profile');
      fail(err);
    });
  }
  function statAmount(id, v) {
    var b = $(id);
    b.textContent = '';
    if (v === null) b.textContent = '-';
    else b.appendChild(K.amountEl(v, 'tokens'));
  }
  // an action of the profile: a tile with its picture over its name (never wrapped)
  function pfBtn(box, label, act, cls, ic, note) {
    var b = el('button', 'pf-tile' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.dataset.act = act;
    b.appendChild(ic ? icon(ic) : el('i', 'ic pf-tile-dot'));
    b.appendChild(el('span', 'pf-tile-name', label));
    if (note) b.appendChild(el('small', 'pf-tile-note', note));
    box.appendChild(b);
    return b;
  }
  // a quiet action at the bottom (フレンド解除, ブロック, ログアウト)
  function pfLink(box, label, act) {
    var b = el('button', 'text-btn', label);
    b.type = 'button';
    b.dataset.act = act;
    box.appendChild(b);
    return b;
  }
  function fillProfile(u, r, self) {
    var old = $('#pf-avatar');
    var av = K.avatarEl(self ? me : u, 'big');
    av.id = 'pf-avatar';
    old.parentNode.replaceChild(av, old);
    $('#pf-name').textContent = u.name;
    var pv = $('#pf-vip');
    pv.textContent = '';
    K.addVip(pv, K.vipLevel(self ? me : r ? r.user : u));
    var lv = $('#pf-lv'), level = r ? r.user.level : null;
    lv.hidden = !level;
    lv.textContent = level ? 'Lv.' + level : '';
    var st = $('#pf-status');
    st.textContent = '';
    $('#pf-online').hidden = !(r && r.user.online);
    if (r) {
      st.appendChild(el('span', 'pf-chip ' + (r.user.online ? 'on' : 'off'), self ? 'あなた' : seenText(r.user)));
      if (!self && r.user.friendship === 'friends') st.appendChild(el('span', 'pf-chip friend', 'フレンド'));
      if (!self && BR.hub && BR.hub.isMember(u.id)) st.appendChild(el('span', 'pf-chip hub', '一緒に稼ぎ中'));
      if (self && me && me.operator) st.appendChild(el('span', 'pf-chip op', '運営'));
      else if (self && me && me.viewer) st.appendChild(el('span', 'pf-chip viewer', '閲覧者'));
    }
    statAmount('#pf-total', r ? r.user.totalWon : null);
    statAmount('#pf-biggest', r ? r.user.biggestWin : null);
    statAmount('#pf-today', r ? r.user.dayWon : null);
    $('#pf-spins').textContent = r ? U.fmt(r.user.spins) + '回' : '-';
    $('#pf-since').textContent = r ? '登録日 ' + K.fmtDate(r.user.createdAt) + (r.user.cars ? '・車 ' + r.user.cars + '台' : '') : '';
    var a1 = $('#pf-actions'), a2 = $('#pf-actions2');
    a1.textContent = '';
    a2.textContent = '';
    $('#pf-blocks').hidden = true;
    if (!r) return;
    if (self) {
      pfBtn(a1, 'アイコン変更', 'avatar', 'gold', 'edit');
      pfBtn(a1, me && me.hasPassword ? 'パスワード変更' : 'パスワード設定', 'password', '', 'lock');
      pfBtn(a1, '引き継ぎコード発行', 'recovery', '', 'share');
      pfBtn(a1, 'コードでログイン', 'codeLogin', '', 'download');
      pfBtn(a1, '演出設定', 'effects', '', 'sound');
      pfBtn(a1, 'VIP', 'vip', 'gold', 'crown', me && me.vip && me.vip.on && BR.VIP.now(me.vip) !== null ? 'VIP' + BR.VIP.label(BR.VIP.badge(me.vip)) : '');
      if (BR.push && BR.push.mode() !== 'none') pfBtn(a1, '通知', 'push', '', 'chat', BR.push.permission() === 'granted' ? 'オン' : 'オフ');
      pfLink(a2, 'ログアウト', 'logout');
      loadBlocks();
      return;
    }
    var rel = u.friendship;
    if (rel === 'friends') {
      var off = u.online ? '' : 'オフライン';
      if (BR.hub && !BR.hub.isMember(u.id)) {
        var inv = BR.hub.invitedBy(u.id);
        var hb = inv ? pfBtn(a1, '参加する', 'hubJoin', 'gold', 'check') : pfBtn(a1, '一緒に稼ぐ', 'hubInvite', 'gold', 'friends', off);
        hb.disabled = !u.online && !inv;
      }
      pfBtn(a1, '観戦する', 'watch', '', 'eye', off).disabled = !u.online;
      pfBtn(a1, 'フレンド対決', 'battle', '', 'chip', off).disabled = !u.online;
      pfBtn(a1, 'メッセージ', 'dm', '', 'chat');
      pfBtn(a1, '送金', 'transfer', 'gold', 'dollar');
      pfBtn(a1, '車をあげる', 'gift', '', 'gift');
      pfBtn(a1, 'アイテムを譲る', 'give', '', 'bag');
      pfLink(a2, 'フレンド解除', 'remove');
    } else if (rel === 'incoming') {
      pfBtn(a1, '申請を承認', 'accept', 'gold', 'check');
      pfBtn(a1, '拒否', 'decline');
    } else if (rel === 'outgoing') {
      pfBtn(a1, '申請を取り消す', 'cancel');
      a1.appendChild(el('span', 'pf-hint', '承認待ちです'));
    } else {
      pfBtn(a1, 'フレンド申請', 'request', 'gold', 'friends');
      a1.appendChild(el('span', 'pf-hint', 'フレンドになると会話・送金・観戦などができます'));
    }
    pfLink(a2, r.blocked ? 'ブロック解除' : 'ブロック', 'block');
    pfLink(a2, '通報', 'report');
  }
  function profileUser() { return prof.data ? prof.data.user : null; }

  function onProfileAction(act) {
    var r = prof.data;
    if (!r) return;
    var u = r.user;
    if (act.indexOf('oauth:') === 0) { sfx('click'); BR.oauth.tapTile(act.slice(6)); return; }
    switch (act) {
      case 'avatar': sfx('click'); K.closeModal('profile'); BR.avatars.openPicker(); break;
      case 'password': sfx('click'); K.closeModal('profile'); BR.account.openPassword(); break;
      case 'recovery': sfx('click'); reissueCode(); break;
      // another account of mine: its 引き継ぎコード
      case 'codeLogin': sfx('click'); K.closeModal('profile'); BR.account.open('code-login', 'ほかのアカウントの引き継ぎコードで、そのアカウントに切り替えます。'); break;
      case 'effects': sfx('click'); K.closeModal('profile'); BR.effects.open(); break;
      case 'vip': sfx('click'); K.closeModal('profile'); BR.vip.open(); break;
      case 'push': sfx('click'); K.closeModal('profile'); BR.push.settings(); break;
      case 'logout': sfx('click'); logout(); break;
      case 'transfer': sfx('click'); openTransfer(u); break;
      case 'gift': sfx('click'); K.closeModal('profile'); BR.cars.giftTo(u); break;
      case 'block': toggleBlock(); break;
      case 'report': K.closeModal('profile'); BR.safety.report(u, 'profile'); break;
      case 'dm': sfx('click'); openDm(u); break;
      case 'watch': sfx('click'); K.closeModal('profile'); BR.watch.start(u); break;
      case 'battle': sfx('click'); K.closeModal('profile'); if (BR.play) BR.play.challenge(u); break;
      case 'hubInvite': K.closeModal('profile'); friendAction(act, u.id); break;
      case 'hubJoin': K.closeModal('profile'); friendAction(act, u.id); break;
      case 'give': sfx('click'); K.closeModal('profile'); BR.shop.giveFrom(u); break;
      default: friendAction(act, u.id);
    }
  }

  function toggleBlock() {
    var r = prof.data;
    if (!r || r.self) return;
    var u = r.user, blocked = r.blocked;
    var ask = blocked ? Promise.resolve(true) : K.confirmBox(function (p) {
      p.appendChild(K.nameSpan(u.name));
      p.appendChild(document.createTextNode('さんをブロックしますか？'));
      p.appendChild(el('small', 'confirm-sub', '相手には知らされません。メッセージ・送金・通話などが届かなくなり、解除するとまとめて届きます。'));
    }, 'ブロック');
    ask.then(function (ok) {
      if (!ok) return null;
      return api.block(u.id, !blocked).then(function (res) {
        r.blocked = res.blocked;
        if (prof.data === r) fillProfile(u, r, false);
        sfx('click');
        blockChanged(u.id, res);
        // in a hub with them: their voice and quick chat go (or come back)
        if (BR.hub && BR.hub.blockChanged) BR.hub.blockChanged(u.id, res.blocked);
      });
    }).catch(fail);
  }
  // A block made or lifted (here, in a hub or in the list of blocks). It is
  // silent: friends stay friends. Lifted, what they sent meanwhile arrives:
  // the conversation and the list load again.
  function blockChanged(id, res) {
    if (BR.call && BR.call.blockChanged) BR.call.blockChanged(id, res.blocked, res.rev);
    if (res.blocked) { toast('ブロックしました'); return; }
    toast(res.released ? 'ブロックを解除しました（' + res.released + '件のメッセージが届きました）' : 'ブロックを解除しました', 3000);
    if (typeof res.unread === 'number') setUnread(res.unread);
    if (!res.released) return;
    delete chans['dm:' + id];
    convs = null;
    if (visible() && view === 'messages') loadConversations();
    if (visible() && view === 'dm' && peer && peer.id === id) showChat('dm:' + id);
  }
  function loadBlocks() {
    var box = $('#pf-blocks');
    api.blocks().then(function (r) {
      box.textContent = '';
      box.hidden = !r.blocks.length;
      if (!r.blocks.length) return;
      box.appendChild(el('div', 'pf-blocks-title', 'ブロック中のプレイヤー'));
      r.blocks.forEach(function (b) {
        var row = el('div', 'pf-block-row');
        row.appendChild(K.nameSpan(b.name));
        var x = el('button', 'text-btn', '解除');
        x.addEventListener('click', function () {
          x.disabled = true;
          api.block(b.id, false).then(function (res) {
            row.parentNode.removeChild(row);
            blockChanged(b.id, res);
            if (BR.hub && BR.hub.blockChanged) BR.hub.blockChanged(b.id, false);
            if (!box.querySelector('.pf-block-row')) box.hidden = true;
          }, function (err) { x.disabled = false; fail(err); });
        });
        row.appendChild(x);
        box.appendChild(row);
      });
    }, function () {});
  }
  function reissueCode() {
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('新しい引き継ぎコードを発行しますか？'));
      p.appendChild(el('small', 'confirm-sub', '今までのコードは使えなくなります。'));
    }, '発行する').then(function (ok) {
      if (!ok) return null;
      return api.recovery().then(function (r) {
        K.closeModals();
        BR.account.showCode(r.recoveryCode, false);
      });
    }).catch(fail);
  }

  /* ------------------------------------------------------------ transfer --- */
  var tf = { user: null, cur: 'tokens', value: 0, busy: false };
  function openTransfer(user) {
    if (!user || !me || user.id === me.id) return;
    tf.user = { id: user.id, name: user.name, online: user.online };
    tf.cur = 'tokens';
    tf.value = 0;
    tf.busy = false;
    $('#tf-name').textContent = user.name;
    K.closeModal('profile');
    renderTransfer();
    K.showModal('transfer');
  }
  function tfCap() {
    var r = BR.bank.rules();
    return r && r.maxTransfer ? r.maxTransfer[tf.cur] : 0;
  }
  function tfMax() { return Math.max(0, Math.min(S[tf.cur] || 0, tfCap())); }
  function renderTransfer() {
    $('#tf-bal-tokens').textContent = U.fmt(S.tokens);
    $('#tf-bal-dollars').textContent = U.fmt(S.dollars);
    $$('#tf-cur .tf-cur-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.cur === tf.cur); });
    $('#tf-icon').className = 'ic ic-' + K.CUR[tf.cur].icon;
    tf.value = Math.min(tf.value, tfMax());
    $('#tf-value').textContent = tf.value > 0 ? U.fmt(tf.value) : '-';
    $('#tf-note').textContent = '1回に送れる上限: ' + U.fmt(tfCap()) + ' ' + K.CUR[tf.cur].name;
    $('#tf-go').disabled = tf.busy || tf.value <= 0;
    var none = tf.busy || tfMax() <= 0;
    $$('#tf-quick button').forEach(function (b) { b.disabled = none; });
    $('#tf-amount').disabled = none;
  }
  function sendMoney() {
    if (tf.busy || tf.value <= 0 || !tf.user) return;
    var u = tf.user, cur = tf.cur, amount = tf.value;
    K.confirmBox(function (p) {
      p.appendChild(K.nameSpan(u.name));
      p.appendChild(document.createTextNode('さんに'));
      p.appendChild(K.amountEl(amount, cur, 'confirm-amt'));
      p.appendChild(document.createTextNode('を送金します。'));
      p.appendChild(el('small', 'confirm-sub', '送金は取り消せません。'));
    }, '送金する').then(function (ok) {
      if (!ok) return;
      tf.busy = true;
      renderTransfer();
      api.transfer(u.id, amount, cur).then(function (r) {
        tf.busy = false;
        BR.app.serverBalance(r.balance);
        onMsg(r.message);
        sfx('coins');
        toast(u.name + 'さんに ' + U.fmt(amount) + ' ' + K.CUR[cur].name + ' を送金しました');
        if (BR.juice) BR.juice.reward(null, 1);
        K.closeModal('transfer');
      }, function (err) {
        tf.busy = false;
        renderTransfer();
        fail(err);
      });
    });
  }

  /* ------------------------------------------------------------ live events --- */
  function onMsg(m) {
    if (!me || !m || !m.id) return;
    var key = keyOf(m);
    var c = chan(key);
    if (c.ids[m.id]) return;
    c.ids[m.id] = true;
    c.list.push(m);
    if (c.list.length > 1 && c.list[c.list.length - 2].id > m.id) c.list.sort(byId);
    var mine = !!(m.from && m.from.id === me.id);
    var here = viewing(key);
    if (!mine && m.from && typers[key] && typers[key][m.from.id]) delete typers[key][m.from.id];
    showLive(key, m, mine);
    if (key.indexOf('group:') === 0) touchGroup(m, mine);
    else touchConv(m, Number(key.slice(3)), mine);
    if (mine) return;
    if (here) {
      if (m.kind === 'transfer' || m.kind === 'gift' || m.kind === 'item' || m.kind === 'present' || m.kind === 'car_offer' || m.kind === 'car_sold') {
        sfx(m.kind === 'transfer' ? 'money' : 'purchase');
        // out of the card that just popped into the chat
        var cards = document.querySelectorAll('.msg.xfer.jc-new');
        if (BR.juice) BR.juice.reward(cards.length ? cards[cards.length - 1] : null, 2);
      }
      markRead(key);
      return;
    }
    if (typeof m.unread === 'number') setUnread(m.unread);
    if (m.kind !== 'system') notify(m, key);
  }

  // a notice for a message that came in elsewhere: tap it to open the chat
  function notify(m, key) {
    var name = m.from ? m.from.name : '';
    var open = key.indexOf('group:') === 0
      ? function () { sfx('click'); openGroupById(Number(key.slice(6))); }
      : function () { sfx('click'); openDm(knownUser(m.from.id) || m.from); };
    if (m.kind === 'transfer') {
      sfx('money');
      toast(name + 'さんから ' + U.fmt(m.amount) + ' ' + (K.CUR[m.currency] || K.CUR.tokens).name + ' が届きました！' + (m.pending ? 'タップして受け取ろう' : ''), 3400, open);
      if (BR.juice) BR.juice.reward('#toast', 2);
    } else if (m.kind === 'bill') {
      sfx('message');
      toast(name + 'からカジノスロット使用料 $' + U.fmt(m.amount) + ' のご請求が届きました。タップして確認', 4200, open);
    } else if (m.kind === 'gift') {
      sfx('purchase');
      toast(name + 'さんから ' + carName(m.text) + ' のプレゼントが届きました！' + (m.pending ? 'タップして受け取ろう' : 'ガレージで見られます'), 4200, open);
      if (BR.juice) BR.juice.reward('#toast', 3);
      BR.cars.changed();
    } else if (m.kind === 'item') {
      sfx('purchase');
      toast(name + 'さんから ' + itemName(m.text) + ' ×' + m.amount + ' が届きました！' + (m.pending ? 'タップして受け取ろう' : ''), 4200, open);
      if (BR.juice) BR.juice.reward('#toast', 2);
    } else if (m.kind === 'present') {
      sfx('purchase');
      toast(name + 'さんから' + BR.presents.name(m.text) + 'のプレゼントが届きました！タップして受け取ろう', 4200, open);
      if (BR.juice) BR.juice.reward('#toast', 2);
    } else if (m.kind === 'car_offer' || m.kind === 'car_sold') {
      sfx(m.kind === 'car_sold' ? 'register' : 'purchase');
      toast(BR.carsale.note(m), 4200, open);
      if (BR.juice) BR.juice.reward('#toast', 2);
      if (m.kind === 'car_sold') BR.cars.changed();
    } else if (m.from && BR.peter.is(m.from)) {
      BR.peter.notify(m, open);
    } else if (key.indexOf('group:') === 0) {
      var g = groupById(m.group);
      sfx('message');
      toast((g ? K.clip(g.name, 10) + ' ' : '') + K.clip(name, 10) + ': ' + K.clip(m.text, 20), 3400, open);
    } else {
      sfx('message');
      toast(K.clip(name, 12) + ': ' + K.clip(m.text, 22), 3400, open);
    }
  }

  // 既読: how far the friend (or each member of a group) has read
  function onRead(r) {
    if (!me || !r) return;
    var key = r.group ? 'group:' + r.group : 'dm:' + r.dm;
    var c = chans[key];
    if (!c) return;
    if (r.group) c.reads[r.by] = Math.max(c.reads[r.by] || 0, r.upto);
    else c.readUpTo = Math.max(c.readUpTo, r.upto);
    if (visible() && chatKey() === key) updateReads();
  }

  function onFriend(f) {
    if (!me) return;
    if (typeof f.pending === 'number' && f.type !== 'accepted') setRequests(f.pending);
    var name = f.user ? f.user.name : '';
    var goFriends = function () { sfx('click'); openBoard('friends'); };
    if (f.type === 'request') {
      sfx('notify');
      toast(name + 'さんからフレンド申請が届きました', 3400, goFriends);
    } else if (f.type === 'accepted') {
      sfx('notify');
      toast(name + 'さんとフレンドになりました！', 4200, function () { sfx('click'); openDm(f.user); });
    }
    if (found && f.user && found.user.id === f.user.id) {
      found.user.friendship = { request: 'incoming', accepted: 'friends', added: 'friends', declined: 'none', cancelled: 'none', removed: 'none' }[f.type] || found.user.friendship;
    }
    var pu = profileUser();
    if (pu && f.user && pu.id === f.user.id) openProfile(pu);
    if (visible() && view === 'friends') loadFriends().catch(function () {});
    else friends = null;
  }

  function onPresence(p) {
    setOnline(p.count);
    var seen = p.online ? null : Date.now();
    var mark = function (u) { if (u && u.id === p.id) { u.online = p.online; if (seen) u.lastSeen = seen; } };
    $$('#screen-board [data-uid="' + (p.id | 0) + '"] .dot').forEach(function (d) { d.classList.toggle('on', !!p.online); });
    (convs || []).forEach(function (c) { mark(c.user); });
    (groups || []).forEach(function (g) { g.members.forEach(mark); });
    if (friends) {
      var hit = false;
      ['friends', 'incoming', 'outgoing'].forEach(function (k) { friends[k].forEach(function (f) { if (f.id === p.id) { mark(f); hit = true; } }); });
      if (hit && visible() && view === 'friends') renderFriends();
    }
    if (peer && peer.id === p.id) {
      mark(peer);
      if (visible() && view === 'dm') renderChatHead();
    }
    if (group && visible() && view === 'group' && group.members.some(function (m) { return m.id === p.id; })) renderChatHead();
    var pu = profileUser();
    if (pu && pu.id === p.id && !prof.data.self) {
      mark(pu);
      fillProfile(pu, prof.data, false);
    }
  }

  function onHello(h) {
    if (!acceptMe(h.me)) { if (me && h.me && me.id === h.me.id) resync(); return; }
    BR.app.serverBalance(h.me);
    setUnread(h.unread);
    setRequests(h.friendRequests);
    setOnline(h.online);
    BR.avatars.setShop(h.iconShop);
    BR.shop.setSale(h);
    BR.peter.set(h.peter);
    BR.johnson.set(h.johnson);
    BR.official.set(h.official);
    BR.jobs.set(h.me);
    BR.quests.setReady(h.me.questsReady);
    BR.news.serverRelease(h.me.release);
    meChanged();
    if (greeted) resync();
    greeted = true;
  }

  // after a dropped connection: fetch whatever is on screen again
  function resync() {
    Object.keys(chans).forEach(function (k) { chans[k].loaded = false; });
    friends = null;
    if (!visible()) { convs = null; groups = null; return; }
    setView(view);
  }

  // the "last online" times count up while the lists are open
  BR.clock.every(function () {
    if (!visible() || document.hidden) return;
    if (view === 'friends' && friends) Array.prototype.forEach.call(document.querySelectorAll('[data-seen-user]'), function (node) {
      var user = [].concat(friends.friends || [], friends.incoming || [], friends.outgoing || []).find(function (u) { return String(u.id) === node.dataset.seenUser; });
      if (user && !user.online) node.textContent = seenText(user);
    });
    else if (view === 'dm' && peer && !peer.online) renderChatHead();
  }, 60000);

  /* ------------------------------------------------------------ init --- */
  function bindBoard() {
    tabs = BR.screens.tabs($('#screen-board'), function (t) { setView(t); });
    // メッセージ again while in a conversation: back to the list
    $('#board-tabs .tab[data-tab="messages"]').addEventListener('click', function () {
      if (view !== 'dm' && view !== 'group') return;
      sfx('click');
      entry.close();
      setView('messages');
    });
    $$('#screen-board .sub-seg .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.classList.contains('active')) return;
        sfx('click');
        setView(b.dataset.v);
      });
    });
    $('#fr-search').addEventListener('click', function () { sfx('click'); searchFriend(); });
    $('#fr-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      var row = e.target.closest('[data-uid]');
      if (!b || !row || b.disabled) return;
      friendAction(b.dataset.act, Number(row.dataset.uid), b);
    });
    $('#conv-list').addEventListener('click', function (e) {
      var face = e.target.closest('.conv-row[data-uid] > .avatar');
      if (face) { sfx('click'); openProfile(knownUser(Number(face.parentNode.dataset.uid))); return; }
      var g = e.target.closest('[data-gid]');
      if (g) { sfx('click'); openGroup(groupById(Number(g.dataset.gid))); return; }
      var row = e.target.closest('[data-uid]');
      if (!row) return;
      sfx('click');
      openDm(knownUser(Number(row.dataset.uid)));
    });
    $('#group-new').addEventListener('click', function () { sfx('click'); openGroupForm(); });
    $('#chat-bar').addEventListener('click', function () { sfx('click'); compose(); });
    $('#chat-gift').addEventListener('click', function () { sfx('click'); if (peer) BR.presents.open(peer); });
    $('#dm-profile').addEventListener('click', function () { sfx('click'); openProfile(peer); });
    $('#dm-money').addEventListener('click', function () { sfx('click'); openTransfer(peer); });
    $('#dm-car').addEventListener('click', function () { sfx('click'); BR.carsale.open(peer); });
    $('#dm-battle').addEventListener('click', function () { sfx('click'); if (BR.play) BR.play.challenge(peer); });
    $('#dm-coop').addEventListener('click', function () { sfx('click'); if (BR.play && group) BR.play.coopOpen(group); });
    $('#dm-members').addEventListener('click', function () { sfx('click'); showMembers(); });
    $('#dm-leave').addEventListener('click', function () { sfx('click'); leaveGroup(); });
    $('#chat-scroll').addEventListener('scroll', function () { if (this.scrollTop < 80) loadOlder(); }, { passive: true });
    $('#entry-feed').addEventListener('scroll', function () { if (this.scrollTop < 60 && entry.isOpen()) loadOlder(); }, { passive: true });
    $('#pane-more').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      sfx('click');
      if (b.dataset.act === 'guide' && BR.guide) { BR.screens.show('slot'); BR.guide.start(true); }
      if (b.dataset.act === 'feedback' && BR.feedback) BR.feedback.open();
      if (b.dataset.act === 'support' && BR.support) BR.support.open();
      if (b.dataset.act === 'vip' && BR.vip) BR.vip.open();
      if (b.dataset.act === 'dev-diary' && BR.diary) BR.diary.open();
      if (b.dataset.act === 'gacha' && BR.gacha) BR.gacha.open();
      if (b.dataset.act === 'stocks' && BR.stocks) BR.stocks.open();
      if (b.dataset.act === 'town' && BR.town) BR.town.open();
      if (b.dataset.act === 'dev-news') { K.showModal('news-modal'); BR.news.show(); }
      var soon = { 'studio-credits': 'スタジオクレジット', terms: '規約' };
      if (soon[b.dataset.act]) showSoon(soon[b.dataset.act], b.dataset.act);
    });
    $$('#screen-board .scroller').forEach(K.dragScroll);

    BR.screens.register('board', {
      // one press goes home (the slot screen, or the start screen the menu was opened from)
      back: function () {
        entry.close();
        if (cameFrom === 'start') { BR.screens.show('start'); return true; }
        return false;
      },
      close: function () {
        entry.close();
        closeGroupForm();
        K.closeModals();
      }
    });
  }

  function bindGroupForm() {
    $('#group-form').addEventListener('submit', function (e) { e.preventDefault(); submitGroup(); });
    $('#group-close').addEventListener('click', function () { sfx('click'); closeGroupForm(); });
    $('#group-pick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-uid]');
      if (!b) return;
      var id = Number(b.dataset.uid);
      groupForm.picked[id] = !groupForm.picked[id];
      sfx('click');
      renderGroupPick();
    });
    $('#group-ov').addEventListener('keydown', function (e) { if (e.key === 'Escape') closeGroupForm(); });
  }

  function bindModals() {
    K.registerModal('transfer');
    K.registerModal('profile');
    $('#profile').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      onProfileAction(b.dataset.act);
    });
    $$('#tf-cur .tf-cur-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (tf.busy || tf.cur === b.dataset.cur) return;
        tf.cur = b.dataset.cur;
        tf.value = 0;
        sfx('click');
        renderTransfer();
      });
    });
    $$('#tf-quick button').forEach(function (b) {
      b.addEventListener('click', function () {
        var add = b.dataset.add;
        tf.value = add === 'max' ? tfMax() : Math.min(tfMax(), tf.value + Number(add));
        sfx('betUp');
        renderTransfer();
      });
    });
    $('#tf-amount').addEventListener('click', function () {
      sfx('click');
      BR.screens.numpad({
        icon: K.CUR[tf.cur].icon,
        value: tf.value,
        max: tfMax(),
        onOk: function (n) { tf.value = n; renderTransfer(); }
      });
    });
    $('#tf-go').addEventListener('click', function () { sfx('click'); sendMoney(); });
    // my card on the slot screen: my profile (and the icon) from there
    // (the VIP badge on it opens VIP)
    $('#me-card').addEventListener('click', function (e) {
      if (BR.game.busy()) { sfx('deny'); return; }
      sfx('click');
      if (e.target.closest('.vip-badge') && BR.vip) { BR.vip.open(); return; }
      openProfile(me);
    });
    // VIP, next to my card
    $('#me-vip-button').addEventListener('click', function () {
      if (BR.game.busy()) { sfx('deny'); return; }
      sfx('click');
      if (BR.vip) BR.vip.open();
    });
  }

  function showSoon(title, act) {
    $('#more-soon').dataset.act = act || '';
    $('#more-soon-title').textContent = title;
    $('#more-soon-consent').hidden = title !== '規約';
    K.showModal('more-soon');
  }

  function init() {
    entry.init();
    K.registerModal('more-soon');
    K.registerModal('news-modal');
    K.dragScroll($('#news-scroll'));
    $('#start-terms').addEventListener('click', function () { sfx('click'); showSoon('規約', 'terms'); });
    bindBoard();
    bindGroupForm();
    bindModals();
    if (!online) return;
    BR.clock.every(function () {
      var key = chatKey(), c = key && chans[key];
      if (!visible() || !c) return;
      c.list.forEach(function (m) {
        if (!m.expired && K.receiptExpired(m)) { m.expired = true; refreshMsg(m.id); }
      });
    }, 1000);
    api.on('auth-lost', onAuthLost);
    api.on('banned', onBanned);
    // an operator has just banned this account (or one on this device), or
    // the server ended its logins
    BR.live.on('kick', function (ev) {
      if (ev.code === 'banned' || ev.code === 'device_banned') BR.banlock.lock(ev.ban || ev);
      else if (me) onAuthLost(ev);
    });
    BR.live.on('hello', onHello);
    BR.live.on('msg', onMsg);
    BR.live.on('read', onRead);
    BR.live.on('typing', onTyping);
    BR.live.on('balance', function (b) { BR.app.serverBalance(b, b.quiet); });
    BR.live.on('presence', onPresence);
    BR.live.on('present', onPresent);
    BR.live.on('retract', onRetract);
    BR.live.on('chatban', onChatBan);
    // 閲覧者 given or taken away (the badge on one's own profile)
    BR.live.on('viewer', function (ev) { if (me) { me.viewer = !!(ev && ev.on); BR.social.renderMe(); } });
    // the ⋯ menu closes with a tap anywhere else
    document.addEventListener('pointerdown', function (e) { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
    BR.live.on('friend', onFriend);
    BR.live.on('status', function (on) { $('#board-info').classList.toggle('off', !on); });
    // 友達と稼ぐ: an invitation came or ran out, someone joined or left
    if (BR.hub) BR.hub.onChange(function () { if (visible() && view === 'friends' && friends) renderFriends(); });
    document.addEventListener('visibilitychange', function () {
      var key = chatKey();
      if (!document.hidden && visible() && key) markRead(key);
    });
    api.restored.then(function () { if (api.hasToken()) start(); });
  }

  BR.social = {
    init: init,
    open: openBoard,
    signIn: signIn,
    signInBanned: signInBanned,
    lockDown: lockDown,
    me: function () { return me; },
    onMe: function (fn) { meListeners.push(fn); },
    setMe: setMe,
    friendsList: function () { return friends ? friends.friends : null; },
    peerIs: function (u) { return view === 'dm' && !!peer && !!u && peer.id === u.id; },
    viewingDm: function () { return visible() && view === 'dm' && !document.hidden; },
    rerenderChat: function () { if (visible() && (view === 'dm' || view === 'group')) renderChat(); },
    loadFriends: loadFriends,
    openProfile: openProfile,
    openDm: openDm,
    openGroup: openGroupById,
    onMsg: onMsg,
    seenText: seenText,
    blockChanged: blockChanged,
    refreshMsg: refreshMsg,
    patchMsg: patchMsg,
    renderMe: renderMeCard,
    // signing up (the story has played): nothing extra any more, the guide takes over
    firstRun: function () {},
    // Escape on a keyboard / the app's back button: close the top-most layer; true if something closed
    escape: function () {
      if (entry.isOpen()) { entry.close(); return true; }
      if (closeGroupForm()) return true;
      if (BR.safety && BR.safety.close()) return true;
      if (BR.feedback && BR.feedback.isOpen && BR.feedback.isOpen()) { BR.feedback.close(); return true; }
      return K.escape();
    }
  };
  BR.entry = entry;
})(window.BR = window.BR || {});
