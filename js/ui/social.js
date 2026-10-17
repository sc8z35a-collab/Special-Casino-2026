/* Online play: the session (sign-in, live connection), the board screen
   (ranking / friends / messages / lobby / Car Owner / Garage), direct
   messages, player profiles, friend requests and money transfers.
   Everything here stays dormant in the offline build. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api;
  var $ = U.$, $$ = U.$$;
  var el = K.el, icon = K.icon, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var online = api.online;

  function visible() { return BR.screens.current() === 'board'; }

  /* ------------------------------------------------------------ state --- */
  var me = null;             // my profile as the server sees it
  var unread = 0;            // unread direct messages
  var requests = 0;          // friend requests waiting for me
  var view = 'ranking';      // ranking | friends | messages | lobby | dm | cars | garage
  var boardType = 'total';
  var peer = null;           // { id, name, avatar, online } of the open direct conversation
  var chans = {};            // 'lobby' | 'dm:<userId>' -> message cache
  var drafts = {};
  var convs = null;          // conversation list, most recent first
  var ranks = {};            // last ranking per type
  var friends = null;        // { friends, incoming, outgoing }
  var found = null;          // last friend search result { user, ... }
  var greeted = false;       // a live connection has been made before
  var cameFrom = 'slot';     // where the board's back button returns to

  function resetSocial() {
    chans = {};
    drafts = {};
    convs = null;
    ranks = {};
    friends = null;
    found = null;
    peer = null;
    greeted = false;
    setUnread(0);
    setRequests(0);
    setLobbyNew(false);
  }

  /* ------------------------------------------------------------ session --- */
  function signIn(token, profile) {
    BR.live.close();
    BR.bank.reset();
    api.setToken(token);
    resetSocial();
    me = profile;
    BR.app.renderWallet(false);
    start();
  }

  // Load the account, then go live.  Retries quietly while the server is away.
  var retry = 1000, retryTimer = 0, warned = false, starting = null;
  function start() {
    clearTimeout(retryTimer);
    if (!api.hasToken()) return;
    starting = BR.bank.refresh();
    starting.then(function (r) {
      retry = 1000;
      warned = false;
      me = r.me;
      setUnread(r.unread);
      setRequests(r.friendRequests);
      setOnline(r.online);
      BR.avatars.setShop(r.iconShop);
      BR.app.renderWallet(false);
      BR.app.renderBet();
      BR.live.connect();
    }, function (err) {
      if (err.status === 401 || err.status === 403) return; // auth-lost takes over
      if (!warned) {
        warned = true;
        toast('サーバーに接続できません。再接続しています…', 3000);
      }
      retryTimer = setTimeout(start, retry);
      retry = Math.min(retry * 2, 30000);
    });
  }

  // The token stopped working (logged out elsewhere, banned). The money is
  // safe on the server: logging in again brings everything back.
  function onAuthLost(err) {
    clearTimeout(retryTimer);
    BR.live.close();
    api.setToken(null);
    BR.bank.reset();
    if (BR.call) BR.call.hangupAll();
    if (BR.watch) BR.watch.stop(true);
    me = null;
    resetSocial();
    BR.entry.close();
    K.closeModals();
    if (BR.screens.current() !== 'start' && BR.screens.current() !== 'slot') BR.screens.show('slot');
    BR.app.renderWallet(false);
    BR.account.open('login', err && err.code === 'banned'
      ? 'このアカウントは利用停止されています。'
      : 'もう一度ログインしてください。ユーザー名とパスワードで、残高もそのまま戻ります。');
  }

  function logout() {
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('ログアウトしますか？'));
      p.appendChild(el('small', 'confirm-sub', '残高やフレンドはサーバーに保存されています。ユーザー名とパスワードでいつでも戻れます。'));
    }, 'ログアウト').then(function (ok) {
      if (!ok) return;
      api.logout().catch(function () {}).then(function () {
        BR.live.close();
        api.setToken(null);
        BR.bank.reset();
        if (BR.call) BR.call.hangupAll();
        if (BR.watch) BR.watch.stop(true);
        me = null;
        resetSocial();
        K.closeModals();
        BR.app.renderWallet(false);
        BR.screens.show('start');
        toast('ログアウトしました');
      });
    });
  }

  /* ------------------------------------------------------------ coach mark --- */
  var coachTimer = 0;
  function showCoach() {
    if (S.coach) return;
    $('#coach').hidden = false;
    coachTimer = setTimeout(hideCoach, 9000);
  }
  function hideCoach() {
    clearTimeout(coachTimer);
    if ($('#coach').hidden) return;
    $('#coach').hidden = true;
    S.coach = true;
    BR.store.save();
  }

  /* ------------------------------------------------------------ text entry --- */
  // A real input outside the scaled stage: 17px text keeps iOS from zooming
  // in, and the conversation being answered moves in above it while typing.
  var entry = (function () {
    var root, input, send, opts = null, sending = false, home = null, homeNext = null;

    function setError(t) {
      var e = $('#entry-error');
      e.textContent = t || '';
      e.hidden = !t;
    }
    function init() {
      root = $('#entry');
      input = $('#entry-input');
      send = $('#entry-send');
      $('#entry-form').addEventListener('submit', function (e) { e.preventDefault(); submit(); });
      // tapping "send" must not take the focus (and the keyboard) away
      ['pointerdown', 'mousedown'].forEach(function (ev) {
        send.addEventListener(ev, function (e) { if (e.pointerType !== 'mouse') e.preventDefault(); });
      });
      input.addEventListener('input', function () { if (opts && opts.onDraft) opts.onDraft(input.value); });
      $('#entry-close').addEventListener('click', close);
      root.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    }
    function open(o) {
      if (opts) close();
      opts = o;
      $('#entry-title').textContent = o.title;
      input.value = o.value || '';
      input.maxLength = o.max || 300;
      input.placeholder = o.placeholder || 'メッセージを入力';
      input.enterKeyHint = o.enterKeyHint || 'send';
      send.textContent = o.button || '送信';
      setError('');
      var feed = $('#entry-feed');
      if (o.feed) {
        home = o.feed.parentNode;
        homeNext = o.feed.nextSibling;
        feed.appendChild(o.feed);
      }
      feed.hidden = !o.feed;
      root.classList.toggle('no-feed', !o.feed);
      root.hidden = false;
      K.fitOverlay(root);
      input.focus();
      feed.scrollTop = feed.scrollHeight;
    }
    function close() {
      if (!opts) return;
      var o = opts;
      opts = null;
      input.blur();
      root.hidden = true;
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
      });
    }
    return { init: init, open: open, close: close, isOpen: function () { return !!opts; } };
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
  function setLobbyNew(on) {
    $('#mic-badge').hidden = !on;
    $('#lobby-dot').hidden = !on;
  }
  function setOnline(n) {
    if (typeof n === 'number') $('#online-count').textContent = U.fmt(n) + '人がオンライン';
  }

  /* ------------------------------------------------------------ board screen --- */
  var tabs;
  function openBoard(tab) {
    if (!online) {
      sfx('deny');
      toast(tab === 'friends' ? 'フレンド機能はオンライン版で利用できます' : 'ランキングとチャットはオンライン版で利用できます');
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
      hideCoach();
      if (!visible()) {
        cameFrom = BR.screens.current() === 'start' ? 'start' : 'slot';
        BR.screens.show('board');
      }
      setView(tab || 'ranking');
    });
  }

  var PANES = { ranking: 'ranking', friends: 'friends', messages: 'messages', lobby: 'chat', dm: 'chat', cars: 'cars', garage: 'garage' };
  function setView(v) {
    if (v === 'dm' && !peer) v = 'messages';
    view = v;
    tabs.set(v === 'dm' ? 'messages' : v);
    Object.keys(PANES).forEach(function (k) { $('#pane-' + PANES[k]).classList.toggle('active', PANES[k] === PANES[v]); });
    $('#pane-chat').classList.toggle('is-dm', v === 'dm');
    if (v === 'ranking') loadRanking();
    else if (v === 'friends') loadFriends();
    else if (v === 'messages') loadConversations();
    else if (v === 'lobby') { setLobbyNew(false); showChat('lobby', null); }
    else if (v === 'dm') { renderDmHead(); showChat('dm:' + peer.id, peer.id); }
    else if (v === 'cars') BR.cars.showShop();
    else if (v === 'garage') BR.cars.showGarage();
  }

  /* ranking */
  function loadRanking() {
    var type = boardType;
    if (ranks[type]) renderRanking(ranks[type]);
    else renderRankingNote('読み込み中…');
    api.board(type).then(function (r) {
      ranks[type] = r;
      if (visible() && view === 'ranking' && boardType === type) renderRanking(r);
    }, function (err) {
      if (!ranks[type]) renderRankingNote(err.message);
    });
  }
  function renderRankingNote(text) {
    var list = $('#rank-list');
    list.textContent = '';
    list.appendChild(el('li', 'empty', text));
    $('#rank-me').hidden = true;
  }
  function renderRanking(r) {
    var list = $('#rank-list');
    list.textContent = '';
    if (!r.rows.length) list.appendChild(el('li', 'empty', r.type === 'today' ? '今日はまだ誰も獲得していません' : 'まだプレイヤーがいません'));
    r.rows.forEach(function (row) { list.appendChild(rankRow(row)); });
    $('#rank-meta').textContent = '登録プレイヤー ' + U.fmt(r.players) + '人' + (r.type === 'today' ? '・毎日00:00 UTCにリセット' : '');
    var mine = $('#rank-me');
    mine.textContent = '';
    mine.hidden = false;
    mine.className = 'rank-row rank-me' + (r.me.rank && r.me.rank <= 3 ? ' top' + r.me.rank : '');
    mine.appendChild(el('span', 'rank-no', r.me.rank ? r.me.rank : '-'));
    var who = el('span', 'rank-name');
    who.appendChild(K.avatarEl(me || {}, 'sm'));
    who.appendChild(el('span', 'me-tag', 'あなた'));
    who.appendChild(K.nameSpan(me ? me.name : ''));
    mine.appendChild(who);
    mine.appendChild(K.amountEl(r.me.value, 'tokens', 'rank-val'));
    setOnline(r.online);
  }
  function rankRow(r) {
    var li = el('li', 'rank-row' + (r.rank <= 3 ? ' top' + r.rank : '') + (me && r.id === me.id ? ' self' : ''));
    li.dataset.uid = r.id;
    li.appendChild(el('span', 'rank-no', r.rank));
    var who = el('span', 'rank-name');
    var av = K.avatarEl(r, 'sm');
    av.appendChild(K.presence(r.online));
    who.appendChild(av);
    who.appendChild(K.nameSpan(r.name));
    li.appendChild(who);
    li.appendChild(K.amountEl(r.value, 'tokens', 'rank-val'));
    return li;
  }
  function knownUser(id) {
    var hit = null;
    Object.keys(ranks).forEach(function (t) {
      ranks[t].rows.forEach(function (r) { if (r.id === id) hit = { id: r.id, name: r.name, avatar: r.avatar, online: r.online }; });
    });
    if (!hit && friends) ['friends', 'incoming', 'outgoing'].forEach(function (k) {
      friends[k].forEach(function (f) { if (f.id === id) hit = f; });
    });
    if (!hit) (convs || []).forEach(function (c) { if (c.user.id === id) hit = c.user; });
    if (!hit && found && found.user.id === id) hit = found.user;
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
  function personRow(u, extraCls) {
    var row = el('div', 'fr-row' + (extraCls ? ' ' + extraCls : ''));
    row.dataset.uid = u.id;
    var who = el('button', 'fr-who');
    who.type = 'button';
    who.dataset.act = 'profile';
    var av = K.avatarEl(u);
    av.appendChild(K.presence(u.online));
    who.appendChild(av);
    var id = el('span', 'fr-id');
    id.appendChild(el('span', 'fr-name uname', u.name));
    id.appendChild(el('span', 'fr-status' + (u.online ? ' on' : ''), u.online ? 'オンライン' : 'オフライン'));
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
    if (!friends.friends.length) {
      box.appendChild(el('div', 'empty fr-empty', 'まだフレンドはいません。\n上の検索でユーザー名を入力して、フレンド申請を送りましょう！\n承認されると通知が届き、会話できるようになります。'));
    }
    friends.friends.forEach(function (u) {
      var p = personRow(u, 'friend');
      var inv = actBtn(p.acts, '稼ぎに招待', 'call', 'call', 'phone');
      inv.disabled = !u.online;
      var w = actBtn(p.acts, '画面を見る', 'watch', '', 'eye');
      w.disabled = !u.online;
      actBtn(p.acts, 'メッセージ', 'dm');
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
      placeholder: 'ユーザー名をそのまま入力（完全一致）',
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

  // a friend action on user `id` (from the friends pane or a profile)
  function friendAction(act, id) {
    var u = knownUser(id) || { id: id, name: '' };
    if (act === 'profile') { sfx('click'); openProfile(u); return; }
    if (act === 'clear') { sfx('click'); found = null; renderFriends(); return; }
    if (act === 'dm') { sfx('click'); openDm(u); return; }
    if (act === 'call') { sfx('click'); BR.call.invite(u); return; }
    if (act === 'watch') { sfx('click'); BR.watch.start(u); return; }
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
      p.appendChild(el('small', 'confirm-sub', 'メッセージ・送金・車のプレゼント・通話・画面を見ることができなくなります。'));
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

  /* conversations */
  function loadConversations() {
    renderConversations();
    api.conversations().then(function (r) {
      convs = r.conversations;
      setUnread(r.unread);
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
    if (!convs.length) {
      renderConvNote('まだメッセージはありません。\nフレンドになると、ここで会話できます。');
      return;
    }
    var list = $('#conv-list');
    list.textContent = '';
    convs.forEach(function (c) { list.appendChild(convRow(c)); });
  }
  function convRow(c) {
    var li = el('li', 'conv-row' + (c.unread ? ' unread' : ''));
    li.dataset.uid = c.user.id;
    var av = K.avatarEl(c.user);
    av.appendChild(K.presence(c.user.online));
    li.appendChild(av);
    var mid = el('div', 'conv-mid');
    mid.appendChild(el('div', 'conv-name uname', c.user.name));
    mid.appendChild(el('div', 'conv-last', preview(c.last)));
    li.appendChild(mid);
    var side = el('div', 'conv-side');
    side.appendChild(el('span', 'conv-time', K.fmtTime(c.at)));
    var b = el('b', 'badge');
    K.badge(b, c.unread);
    side.appendChild(b);
    li.appendChild(side);
    return li;
  }
  function carName(model) {
    var cars = BR.CONFIG.cars;
    for (var i = 0; i < cars.length; i++) if (cars[i].id === model) return cars[i].name;
    return '車';
  }
  function preview(last) {
    if (last.kind === 'transfer') {
      return (last.mine ? '送金しました: ' : '受け取りました: ') + U.fmt(last.amount) + ' ' + (K.CUR[last.currency] || K.CUR.tokens).name;
    }
    if (last.kind === 'gift') return (last.mine ? 'プレゼントしました: ' : 'プレゼントが届きました: ') + carName(last.text);
    if (last.kind === 'system') return K.clip(last.text, 60);
    return (last.mine ? 'あなた: ' : '') + K.clip(last.text, 60);
  }
  // keep the conversation list in step with live messages
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

  /* chat (lobby and direct messages share one view) */
  function chan(key) {
    return chans[key] || (chans[key] = { list: [], ids: {}, hasMore: false, loaded: false, loading: null, older: false });
  }
  function byId(a, b) { return a.id - b.id; }
  function chatKey() { return view === 'lobby' ? 'lobby' : view === 'dm' && peer ? 'dm:' + peer.id : null; }
  function viewing(key) { return visible() && !document.hidden && chatKey() === key; }
  // "dm:<low id>:<high id>" -> "dm:<the other player>"
  function keyOf(m) {
    if (m.channel === 'lobby') return 'lobby';
    if (m.peer) return 'dm:' + m.peer;
    var p = String(m.channel).split(':'), a = Number(p[1]), b = Number(p[2]);
    return 'dm:' + (me && a === me.id ? b : a);
  }
  function chatList() { return $('#chat-list'); }
  function nearBottom(sc) { return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 160; }
  function scrollChat() { var sc = chatList().parentNode; sc.scrollTop = sc.scrollHeight; }

  function loadChan(key, withId) {
    var c = chan(key);
    if (c.loading) return c.loading;
    c.loading = api.messages(withId).then(function (r) {
      c.loading = null;
      c.loaded = true;
      if (!c.list.length) c.hasMore = r.hasMore;
      r.messages.forEach(function (m) {
        if (c.ids[m.id]) return;
        c.ids[m.id] = true;
        c.list.push(m);
      });
      c.list.sort(byId);
      return c;
    }, function (err) {
      c.loading = null;
      throw err;
    });
    return c.loading;
  }

  function showChat(key, withId) {
    var c = chan(key);
    renderChat();
    scrollChat();
    if (!c.loaded) {
      loadChan(key, withId).then(function () {
        if (chatKey() !== key) return;
        renderChat();
        scrollChat();
      }, function (err) {
        if (chatKey() === key && !c.list.length) renderChat(err.message);
      });
    }
    if (withId) markRead(withId);
  }

  function renderChat(note) {
    var key = chatKey();
    if (!key) return;
    var c = chan(key), list = chatList();
    list.textContent = '';
    if (c.hasMore) list.appendChild(el('div', 'chat-more', '上にスクロールして以前のメッセージを表示'));
    var prev = null;
    c.list.forEach(function (m) { appendMsg(list, m, prev, key); prev = m; });
    if (!c.list.length) {
      list.appendChild(el('div', 'empty chat-empty', note || (!c.loaded ? '読み込み中…'
        : key === 'lobby' ? 'ロビーでは全プレイヤーと会話できます。\n最初のメッセージを送ってみましょう！'
          : 'まだメッセージはありません。\nあいさつしてみましょう！')));
    }
    renderChatBar();
  }
  function appendMsg(list, m, prev, key) {
    if (!prev || !K.sameDay(new Date(prev.at), new Date(m.at))) list.appendChild(el('div', 'day-sep', K.fmtDay(m.at)));
    list.appendChild(msgEl(m, key));
  }
  function msgEl(m, key) {
    var mine = !!(m.from && me && m.from.id === me.id);
    var node, card;
    if (m.kind === 'system') {
      node = el('div', 'msg sys');
      node.appendChild(el('span', 'sys-text', m.text));
      node.appendChild(el('span', 'msg-time', K.fmtTime(m.at)));
      return node;
    }
    if (m.kind === 'transfer') {
      node = el('div', 'msg xfer' + (mine ? ' mine' : ''));
      card = el('div', 'xfer-card');
      card.appendChild(el('div', 'xfer-label', mine ? '送金しました' : '送金が届きました'));
      card.appendChild(K.amountEl(m.amount, m.currency, 'xfer-amount'));
      node.appendChild(card);
      node.appendChild(el('span', 'msg-time', K.fmtTime(m.at)));
      return node;
    }
    if (m.kind === 'gift') {
      node = el('div', 'msg xfer gift' + (mine ? ' mine' : ''));
      card = el('div', 'xfer-card gift-card');
      card.appendChild(el('div', 'xfer-label', mine ? '車をプレゼントしました' : '車のプレゼントが届きました！'));
      var pic = el('span', 'gift-car');
      var src = BR.SOCIAL_IMG.cars[m.text];
      if (src) pic.style.backgroundImage = 'url("' + src + '")';
      card.appendChild(pic);
      card.appendChild(el('div', 'gift-name', carName(m.text)));
      if (!mine) card.appendChild(el('div', 'gift-hint', 'Garage で見られます'));
      node.appendChild(card);
      node.appendChild(el('span', 'msg-time', K.fmtTime(m.at)));
      return node;
    }
    node = el('div', 'msg ' + (mine ? 'mine' : 'theirs'));
    if (key === 'lobby' && !mine && m.from) {
      var n = el('button', 'msg-name');
      n.type = 'button';
      n.dataset.uid = m.from.id;
      n.appendChild(K.avatarEl(m.from, 'xs'));
      n.appendChild(el('span', 'uname', m.from.name || '?'));
      node.appendChild(n);
    }
    node.appendChild(el('div', 'bubble', m.text));
    node.appendChild(el('span', 'msg-time', K.fmtTime(m.at)));
    return node;
  }
  function renderChatBar() {
    var key = chatKey();
    if (!key) return;
    var d = drafts[key];
    var ph = $('#chat-placeholder');
    ph.textContent = d ? K.clip(d, 80) : key === 'lobby' ? 'みんなにメッセージ…' : 'メッセージを入力…';
    ph.classList.toggle('draft', !!d);
  }

  // a message that was just added to the cache
  function showLive(key, m, mine) {
    if (!visible() || chatKey() !== key) return;
    var c = chan(key), list = chatList(), sc = list.parentNode;
    var stick = mine || nearBottom(sc);
    var i = c.list.indexOf(m);
    var empty = list.querySelector('.chat-empty');
    if (empty || i !== c.list.length - 1) renderChat();
    else appendMsg(list, m, c.list[i - 1] || null, key);
    if (stick) scrollChat();
  }

  function loadOlder() {
    var key = chatKey();
    if (!key) return;
    var c = chan(key);
    if (!c.hasMore || c.older || !c.list.length) return;
    c.older = true;
    api.messages(key === 'lobby' ? null : peer.id, c.list[0].id).then(function (r) {
      c.older = false;
      c.hasMore = r.hasMore;
      var added = r.messages.filter(function (m) {
        if (c.ids[m.id]) return false;
        c.ids[m.id] = true;
        return true;
      });
      c.list = added.concat(c.list);
      if (chatKey() !== key) return;
      var sc = chatList().parentNode, h = sc.scrollHeight, top = sc.scrollTop;
      renderChat();
      sc.scrollTop = top + (sc.scrollHeight - h);
    }, function () { c.older = false; });
  }

  var readTimers = {};
  function markRead(otherId) {
    (convs || []).forEach(function (c) { if (c.user.id === otherId) c.unread = 0; });
    clearTimeout(readTimers[otherId]);
    readTimers[otherId] = setTimeout(function () {
      api.read(otherId).then(function (r) { setUnread(r.unread); }, function () {});
    }, 200);
  }

  function compose() {
    var key = chatKey();
    if (!key) return;
    var to = key === 'lobby' ? 'lobby' : peer.id;
    entry.open({
      title: key === 'lobby' ? 'ロビー（全員に公開）' : peer.name,
      value: drafts[key] || '',
      max: 300,
      placeholder: key === 'lobby' ? 'みんなにメッセージ' : 'メッセージを入力',
      feed: chatList(),
      onDraft: function (t) { drafts[key] = t; },
      onSubmit: function (text) {
        return api.send(to, text).then(function (r) {
          drafts[key] = '';
          sfx('send');
          onMsg(r.message);
        });
      },
      onClose: function () {
        renderChatBar();
        scrollChat();
      }
    });
  }

  function renderDmHead() {
    var u = $('#dm-user');
    u.textContent = '';
    u.appendChild(K.avatarEl(peer));
    var t = el('span', 'dm-id');
    t.appendChild(el('span', 'dm-name uname', peer.name));
    var st = el('span', 'dm-status');
    st.appendChild(K.presence(peer.online));
    st.appendChild(el('span', '', peer.online ? 'オンライン' : 'オフライン'));
    t.appendChild(st);
    u.appendChild(t);
    $('#dm-call').disabled = !peer.online;
  }

  function openDm(user) {
    if (!user || !me || user.id === me.id) return;
    peer = { id: user.id, name: user.name, avatar: user.avatar, online: !!user.online };
    K.closeModals();
    if (!visible()) { cameFrom = BR.screens.current() === 'start' ? 'start' : 'slot'; BR.screens.show('board'); }
    setView('dm');
  }

  /* ------------------------------------------------------------ profile --- */
  var prof = { data: null, seq: 0 };
  function openProfile(user) {
    if (!user || !me) return;
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
  function pfBtn(box, label, act, cls, ic) {
    var b = el('button', 'act-btn' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.dataset.act = act;
    if (ic) b.appendChild(icon(ic));
    b.appendChild(el('span', '', label));
    box.appendChild(b);
    return b;
  }
  function fillProfile(u, r, self) {
    var old = $('#pf-avatar');
    var av = K.avatarEl(self ? me : u, 'big');
    av.id = 'pf-avatar';
    old.parentNode.replaceChild(av, old);
    $('#pf-name').textContent = u.name;
    var st = $('#pf-status');
    st.textContent = '';
    if (r) {
      st.appendChild(K.presence(r.user.online));
      st.appendChild(el('span', '', self ? 'あなた' : r.user.online ? 'オンライン' : 'オフライン'));
      if (!self && r.user.friendship === 'friends') st.appendChild(el('span', 'pf-friend', 'フレンド'));
    }
    $('#pf-rank').textContent = r ? U.fmt(r.user.rank) : '-';
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
      pfBtn(a1, 'アイコン変更', 'avatar', 'gold');
      pfBtn(a1, me && me.hasPassword ? 'パスワード変更' : 'パスワード設定', 'password');
      pfBtn(a1, '引き継ぎコード', 'recovery');
      var lo = el('button', 'text-btn', 'ログアウト');
      lo.type = 'button';
      lo.dataset.act = 'logout';
      a2.appendChild(lo);
      loadBlocks();
      return;
    }
    var rel = u.friendship;
    if (rel === 'friends') {
      var c = pfBtn(a1, '稼ぎに招待', 'call', 'call', 'phone');
      c.disabled = !u.online;
      var w = pfBtn(a1, '画面を見る', 'watch', '', 'eye');
      w.disabled = !u.online;
      pfBtn(a1, 'メッセージ', 'dm');
      pfBtn(a2, '送金', 'transfer', 'gold', 'chip');
      pfBtn(a2, '車をあげる', 'gift', '', 'gift');
      var rm = el('button', 'text-btn', 'フレンド解除');
      rm.type = 'button';
      rm.dataset.act = 'remove';
      a2.appendChild(rm);
    } else if (rel === 'incoming') {
      pfBtn(a1, '申請を承認する', 'accept', 'gold', 'check');
      pfBtn(a1, '拒否', 'decline');
    } else if (rel === 'outgoing') {
      pfBtn(a1, '申請中（取り消す）', 'cancel');
    } else {
      pfBtn(a1, 'フレンド申請', 'request', 'gold', 'friends');
      a1.appendChild(el('span', 'pf-hint', 'フレンドになると会話・送金・通話ができます'));
    }
    var blk = el('button', 'text-btn', r.blocked ? 'ブロック解除' : 'ブロック');
    blk.type = 'button';
    blk.dataset.act = 'block';
    a2.appendChild(blk);
  }
  function profileUser() { return prof.data ? prof.data.user : null; }

  function onProfileAction(act) {
    var r = prof.data;
    if (!r) return;
    var u = r.user;
    switch (act) {
      case 'avatar': sfx('click'); K.closeModal('profile'); BR.avatars.openPicker(); break;
      case 'password': sfx('click'); K.closeModal('profile'); BR.account.openPassword(); break;
      case 'recovery': sfx('click'); reissueCode(); break;
      case 'logout': sfx('click'); logout(); break;
      case 'transfer': sfx('click'); openTransfer(u); break;
      case 'gift': sfx('click'); K.closeModal('profile'); BR.cars.giftTo(u); break;
      case 'block': toggleBlock(); break;
      case 'dm': sfx('click'); openDm(u); break;
      case 'call': sfx('click'); K.closeModal('profile'); BR.call.invite(u); break;
      case 'watch': sfx('click'); K.closeModal('profile'); BR.watch.start(u); break;
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
      p.appendChild(el('small', 'confirm-sub', 'フレンドも解除され、この人からの申請・メッセージ・送金が届かなくなり、ロビーの発言も表示されなくなります。'));
    }, 'ブロック');
    ask.then(function (ok) {
      if (!ok) return null;
      return api.block(u.id, !blocked).then(function (res) {
        r.blocked = res.blocked;
        if (res.blocked) u.friendship = 'none';
        if (prof.data === r) fillProfile(u, r, false);
        sfx('click');
        toast(res.blocked ? 'ブロックしました' : 'ブロックを解除しました');
        if (res.blocked) { dropFromLobby(u.id); friends = null; }
      });
    }).catch(fail);
  }
  function dropFromLobby(userId) {
    var c = chans.lobby;
    if (!c) return;
    c.list = c.list.filter(function (m) { return !(m.from && m.from.id === userId); });
    if (visible() && view === 'lobby') renderChat();
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
          api.block(b.id, false).then(function () {
            row.parentNode.removeChild(row);
            toast('ブロックを解除しました');
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
      p.appendChild(el('small', 'confirm-sub', '送金は取り消せません。よろしいですか？'));
    }, '送金する').then(function (ok) {
      if (!ok) return;
      tf.busy = true;
      renderTransfer();
      api.transfer(u.id, amount, cur).then(function (r) {
        tf.busy = false;
        BR.app.serverBalance(r.balance);
        onMsg(r.message);
        sfx('purchase');
        toast(u.name + 'さんに ' + U.fmt(amount) + ' ' + K.CUR[cur].name + ' を送金しました');
        K.closeModal('transfer');
      }, function (err) {
        tf.busy = false;
        renderTransfer();
        fail(err);
      });
    });
  }

  /* ------------------------------------------------------------ live events --- */
  function trim(key, c) {
    if (key !== 'lobby' || c.list.length <= 400 || viewing(key)) return;
    c.list.splice(0, c.list.length - 300).forEach(function (m) { delete c.ids[m.id]; });
    c.hasMore = true;
  }

  function onMsg(m) {
    if (!me || !m || !m.id) return;
    var key = keyOf(m);
    var c = chan(key);
    if (c.ids[m.id]) return;
    c.ids[m.id] = true;
    c.list.push(m);
    if (c.list.length > 1 && c.list[c.list.length - 2].id > m.id) c.list.sort(byId);
    trim(key, c);
    var mine = !!(m.from && m.from.id === me.id);
    var here = viewing(key);
    showLive(key, m, mine);
    if (key === 'lobby') {
      if (!here && !mine && m.kind === 'text') setLobbyNew(true);
      return;
    }
    var other = Number(key.slice(3));
    touchConv(m, other, mine);
    if (mine) return;
    if (here) {
      if (m.kind === 'transfer' || m.kind === 'gift') sfx('purchase');
      markRead(other);
      return;
    }
    if (typeof m.unread === 'number') setUnread(m.unread);
    if (m.kind !== 'system') notify(m);
  }

  function notify(m) {
    var name = m.from ? m.from.name : '';
    if (m.kind === 'transfer') {
      sfx('purchase');
      toast(name + 'さんから ' + U.fmt(m.amount) + ' ' + (K.CUR[m.currency] || K.CUR.tokens).name + ' が届きました！', 3400);
    } else if (m.kind === 'gift') {
      sfx('purchase');
      toast(name + 'さんから ' + carName(m.text) + ' のプレゼントが届きました！Garage で見られます', 4200);
      BR.cars.changed();
    } else {
      sfx('message');
      toast(K.clip(name, 12) + ': ' + K.clip(m.text, 22), 3000);
    }
  }

  function onFriend(f) {
    if (!me) return;
    if (typeof f.pending === 'number' && f.type !== 'accepted') setRequests(f.pending);
    var name = f.user ? f.user.name : '';
    if (f.type === 'request') {
      sfx('notify');
      toast(name + 'さんからフレンド申請が届きました', 3400);
    } else if (f.type === 'accepted') {
      sfx('notify');
      toast(name + 'さんからフレンド承認されました！会話できるようになりました', 4200);
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
    $$('#screen-board [data-uid="' + (p.id | 0) + '"] .dot').forEach(function (d) { d.classList.toggle('on', !!p.online); });
    (convs || []).forEach(function (c) { if (c.user.id === p.id) c.user.online = p.online; });
    Object.keys(ranks).forEach(function (t) { ranks[t].rows.forEach(function (r) { if (r.id === p.id) r.online = p.online; }); });
    if (friends) {
      var hit = false;
      ['friends', 'incoming', 'outgoing'].forEach(function (k) { friends[k].forEach(function (f) { if (f.id === p.id) { f.online = p.online; hit = true; } }); });
      if (hit && visible() && view === 'friends') renderFriends();
    }
    if (peer && peer.id === p.id) {
      peer.online = p.online;
      if (visible() && view === 'dm') renderDmHead();
    }
    var pu = profileUser();
    if (pu && pu.id === p.id && !prof.data.self) {
      pu.online = p.online;
      fillProfile(pu, prof.data, false);
    }
  }

  var boardTimer = 0;
  function onBoard() {
    if (!visible() || view !== 'ranking') return;
    clearTimeout(boardTimer);
    boardTimer = setTimeout(function () { if (visible() && view === 'ranking') loadRanking(); }, 1200);
  }

  function onHello(h) {
    me = h.me;
    BR.bank.applyMe(h.me, true);
    BR.app.serverBalance(h.me);
    setUnread(h.unread);
    setRequests(h.friendRequests);
    setOnline(h.online);
    BR.avatars.setShop(h.iconShop);
    if (greeted) resync();
    greeted = true;
  }

  // after a dropped connection: fetch whatever is on screen again
  function resync() {
    Object.keys(chans).forEach(function (k) { chans[k].loaded = false; });
    friends = null;
    if (!visible()) { convs = null; return; }
    setView(view);
  }

  /* ------------------------------------------------------------ init --- */
  function bindBoard() {
    tabs = BR.screens.tabs($('#screen-board'), function (t) { setView(t); });
    $$('#rank-seg .seg-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.type === boardType) return;
        boardType = b.dataset.type;
        $$('#rank-seg .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
        sfx('click');
        $('#rank-scroll').scrollTop = 0;
        loadRanking();
      });
    });
    $('#rank-list').addEventListener('click', function (e) {
      var row = e.target.closest('[data-uid]');
      if (!row) return;
      sfx('click');
      openProfile(knownUser(Number(row.dataset.uid)));
    });
    $('#rank-me').addEventListener('click', function () { sfx('click'); openProfile(me); });
    $('#fr-search').addEventListener('click', function () { sfx('click'); searchFriend(); });
    $('#fr-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      var row = e.target.closest('[data-uid]');
      if (!b || !row || b.disabled) return;
      friendAction(b.dataset.act, Number(row.dataset.uid));
    });
    $('#conv-list').addEventListener('click', function (e) {
      var row = e.target.closest('[data-uid]');
      if (!row) return;
      sfx('click');
      openDm(knownUser(Number(row.dataset.uid)));
    });
    chatList().addEventListener('click', function (e) {
      var n = e.target.closest('.msg-name');
      if (!n) return;
      sfx('click');
      openProfile(knownUser(Number(n.dataset.uid)) || { id: Number(n.dataset.uid), name: n.textContent });
    });
    $('#chat-bar').addEventListener('click', function () { sfx('click'); compose(); });
    $('#dm-user').addEventListener('click', function () { sfx('click'); openProfile(peer); });
    $('#dm-profile').addEventListener('click', function () { sfx('click'); openProfile(peer); });
    $('#dm-money').addEventListener('click', function () { sfx('click'); openTransfer(peer); });
    $('#dm-call').addEventListener('click', function () { sfx('click'); BR.call.invite(peer); });
    $('#chat-scroll').addEventListener('scroll', function () { if (this.scrollTop < 80) loadOlder(); }, { passive: true });
    $('#entry-feed').addEventListener('scroll', function () { if (this.scrollTop < 60 && entry.isOpen()) loadOlder(); }, { passive: true });
    $$('#screen-board .scroller').forEach(K.dragScroll);

    BR.screens.register('board', {
      back: function () {
        if (view === 'dm') { setView('messages'); return true; }
        if (cameFrom === 'start') { BR.screens.show('start'); return true; }
        return false;
      },
      close: function () {
        entry.close();
        K.closeModals();
      }
    });
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
  }

  function init() {
    entry.init();
    bindBoard();
    bindModals();
    $('#coach').addEventListener('click', hideCoach);
    if (!online) return;
    api.on('auth-lost', onAuthLost);
    BR.live.on('hello', onHello);
    BR.live.on('msg', onMsg);
    BR.live.on('balance', function (b) { BR.app.serverBalance(b); });
    BR.live.on('presence', onPresence);
    BR.live.on('board', onBoard);
    BR.live.on('friend', onFriend);
    BR.live.on('status', function (on) { $('#board-info').classList.toggle('off', !on); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && visible() && view === 'dm' && peer) markRead(peer.id);
    });
    api.restored.then(function () { if (api.hasToken()) start(); });
  }

  BR.social = {
    init: init,
    open: openBoard,
    signIn: signIn,
    me: function () { return me; },
    setMe: function (m) {
      me = m;
      BR.bank.applyMe(m, true);
      if (visible() && view === 'ranking' && ranks[boardType]) renderRanking(ranks[boardType]);
    },
    friendsList: function () { return friends ? friends.friends : null; },
    loadFriends: loadFriends,
    openProfile: openProfile,
    openDm: openDm,
    onMsg: onMsg,
    firstRun: function () { if (BR.screens.current() === 'slot') showCoach(); },
    // Escape on a keyboard: close the top-most layer; true if something closed
    escape: function () {
      if (entry.isOpen()) { entry.close(); return true; }
      return K.escape();
    }
  };
  BR.entry = entry;
})(window.BR = window.BR || {});
