/* Online play: first-run registration, the board screen (ranking / messages /
   lobby), direct messages, player profiles and money transfers.  Everything
   here stays dormant in the offline build. */
(function (BR) {
  'use strict';

  var U = BR.util, S = BR.store.state, api = BR.api;
  var $ = U.$, $$ = U.$$;
  var online = api.online;

  /* ------------------------------------------------------------ helpers --- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function icon(name) { return el('i', 'ic ic-' + name); }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function yesterday() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1); }
  function fmtTime(ts) {
    var d = new Date(ts);
    var hm = d.getHours() + ':' + pad2(d.getMinutes());
    if (sameDay(d, new Date())) return hm;
    if (sameDay(d, yesterday())) return '昨日 ' + hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }
  function fmtDay(ts) {
    var d = new Date(ts), now = new Date();
    if (sameDay(d, now)) return '今日';
    if (sameDay(d, yesterday())) return '昨日';
    return (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '年' : '') + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function fmtDate(ts) { var d = new Date(ts); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate(); }
  function clip(s, n) {
    var a = Array.from(String(s || '').replace(/\s+/g, ' '));
    return a.length > n ? a.slice(0, n).join('') + '…' : a.join('');
  }
  function nfkc(s) { s = String(s || ''); return s.normalize ? s.normalize('NFKC') : s; }

  var CUR = { tokens: { icon: 'chip', name: 'トークン' }, dollars: { icon: 'dollar', name: 'ドル' } };
  function amountEl(n, currency, cls) {
    var a = el('span', 'amt' + (cls ? ' ' + cls : ''));
    a.appendChild(icon((CUR[currency] || CUR.tokens).icon));
    a.appendChild(el('span', '', U.fmt(n)));
    return a;
  }
  var AVATAR = ['#b8322a', '#c1621b', '#a8871a', '#2f8f4e', '#1f8a7a', '#2f6fae', '#7b48a8', '#b0336f', '#6d4c41', '#4f6b7a'];
  function avatar(user, cls) {
    var a = el('span', 'avatar' + (cls ? ' ' + cls : ''), (Array.from(String(user.name || '?'))[0] || '?').toUpperCase());
    a.style.background = AVATAR[Math.abs(user.id | 0) % AVATAR.length];
    return a;
  }
  function presence(on) { return el('i', 'dot' + (on ? ' on' : '')); }
  function nameSpan(name) { return el('span', 'uname', name); }
  function toast(msg, ms) { BR.app.toast(msg, ms); }
  function sfx(n) { BR.sfx.play(n); }
  function fail(err) {
    sfx('deny');
    toast(err && err.message ? err.message : 'エラーが発生しました', 3200);
  }
  function visible() { return BR.screens.current() === 'board'; }

  /* ------------------------------------------------------------ state --- */
  var me = null;             // my profile as the server sees it
  var unread = 0;            // unread direct messages
  var view = 'ranking';      // ranking | messages | lobby | dm
  var boardType = 'total';
  var peer = null;           // { id, name, online } of the open direct conversation
  var chans = {};            // 'lobby' | 'dm:<userId>' -> message cache
  var drafts = {};
  var convs = null;          // conversation list, most recent first
  var ranks = {};            // last ranking per type
  var greeted = false;       // a live connection has been made before

  function resetSocial() {
    chans = {};
    drafts = {};
    convs = null;
    ranks = {};
    peer = null;
    greeted = false;
    setUnread(0);
    setLobbyNew(false);
  }

  /* ------------------------------------------------------------ overlays (unscaled) --- */
  // Keep fixed overlays inside the visible area while the keyboard is up
  // (iOS and recent Android shrink only the visual viewport).
  var fitted = [];
  function fitOverlay(node) {
    if (fitted.indexOf(node) < 0) fitted.push(node);
    fitAll();
  }
  function fitAll() {
    var vv = window.visualViewport;
    fitted.forEach(function (n) {
      if (n.hidden || !vv) return;
      n.style.height = vv.height + 'px';
      n.style.transform = 'translateY(' + vv.offsetTop + 'px)';
    });
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitAll);
    window.visualViewport.addEventListener('scroll', fitAll);
  }

  /* ------------------------------------------------------------ account --- */
  var NAME_RE = /^[A-Za-z0-9_\-ぁ-ゖァ-ヺー・々〆一-鿿㐀-䶿]+$/;
  // null = fine, '' = empty, otherwise the problem (the server has the last word)
  function nameProblem(raw) {
    var name = nfkc(raw).trim();
    var len = Array.from(name).length;
    if (!len) return '';
    if (len < 2 || len > 12) return 'ユーザー名は2〜12文字にしてください';
    if (!NAME_RE.test(name)) return 'ユーザー名には日本語・英数字・「_」「-」だけが使えます';
    if (/^[_\-ー・]+$/.test(name)) return 'ユーザー名に文字か数字を含めてください';
    return null;
  }

  var ov = { busy: false, first: false };
  var CARDS = { register: '#ov-register', login: '#ov-login', code: '#ov-codecard' };
  function showCard(which) {
    Object.keys(CARDS).forEach(function (k) { $(CARDS[k]).hidden = k !== which; });
    fitOverlay($('#welcome'));
  }
  function setOvError(which, text) { $('#ov-' + which + '-error').textContent = text || ''; }
  function ovBusy(on) {
    ov.busy = on;
    $$('#welcome button, #welcome input').forEach(function (b) { b.disabled = on; });
  }
  function showWelcome(notice) {
    var n = $('#ov-notice');
    n.textContent = notice || '';
    n.hidden = !notice;
    setOvError('register', '');
    setOvError('login', '');
    $('#welcome').hidden = false;
    showCard('register');
  }
  function hideWelcome() {
    var a = document.activeElement;
    if (a && a.blur && $('#welcome').contains(a)) a.blur();
    $('#welcome').hidden = true;
    BR.app.relayout();
  }

  function onRegister(e) {
    e.preventDefault();
    if (ov.busy) return;
    var input = $('#ov-name');
    var problem = nameProblem(input.value);
    if (problem !== null) {
      setOvError('register', problem || 'ユーザー名を入力してください');
      return;
    }
    ovBusy(true);
    setOvError('register', '');
    api.register(nfkc(input.value).trim()).then(function (r) {
      signIn(r.token, r.me);
      showCode(r.recoveryCode, true);
    }, function (err) {
      setOvError('register', err.message);
    }).then(function () { ovBusy(false); });
  }

  function onLogin(e) {
    e.preventDefault();
    if (ov.busy) return;
    var code = $('#ov-code').value;
    if (nfkc(code).replace(/[^0-9A-Za-z]/g, '').length !== 16) {
      setOvError('login', '引き継ぎコードは16文字です');
      return;
    }
    ovBusy(true);
    setOvError('login', '');
    api.login(code).then(function (r) {
      signIn(r.token, r.me);
      hideWelcome();
      sfx('purchase');
      toast(r.me.name + 'さん、おかえりなさい！');
    }, function (err) {
      setOvError('login', err.message);
    }).then(function () { ovBusy(false); });
  }

  // XXXX-XXXX-XXXX-XXXX while typing
  function formatCode() {
    var input = $('#ov-code');
    var raw = nfkc(input.value).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16);
    var v = (raw.match(/.{1,4}/g) || []).join('-');
    if (v !== input.value) input.value = v;
  }

  function showCode(code, first) {
    ov.first = first;
    $('#ov-code-title').textContent = first ? '登録が完了しました！' : '新しい引き継ぎコード';
    $('#ov-code-value').textContent = code;
    $('#ov-copy').textContent = 'コードをコピー';
    $('#ov-done').textContent = first ? 'ゲームをはじめる' : '閉じる';
    $('#welcome').hidden = false;
    showCard('code');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.cssText = 'position:fixed;left:0;top:0;opacity:0;';
    document.body.appendChild(t);
    t.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* unsupported */ }
    document.body.removeChild(t);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
  }

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
  var retry = 1000, retryTimer = 0, warned = false;
  function start() {
    clearTimeout(retryTimer);
    if (!api.hasToken()) return;
    BR.bank.refresh().then(function (r) {
      retry = 1000;
      warned = false;
      me = r.me;
      setUnread(r.unread);
      setOnline(r.online);
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

  function onAuthLost(err) {
    if (!api.hasToken()) return;
    clearTimeout(retryTimer);
    BR.live.close();
    api.setToken(null);
    BR.bank.reset();
    me = null;
    resetSocial();
    entry.close();
    closeModals();
    if (visible()) BR.screens.show('slot');
    BR.app.renderWallet(false);
    showWelcome(err && err.code === 'banned'
      ? 'このアカウントは利用停止されています。'
      : 'ログインの有効期限が切れました。引き継ぎコードで復元するか、新しく登録してください。');
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
      setError('');
      var feed = $('#entry-feed');
      if (o.feed) {
        home = o.feed.parentNode;
        homeNext = o.feed.nextSibling;
        feed.appendChild(o.feed);
      }
      feed.hidden = !o.feed;
      root.hidden = false;
      fitOverlay(root);
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
      Promise.resolve().then(function () { return o.onSubmit(text); }).then(function () {
        if (opts !== o) return;
        input.value = '';
        if (o.onDraft) o.onDraft('');
        setError('');
      }, function (err) {
        if (opts === o) setError(err && err.message ? err.message : '送信できませんでした');
      }).then(function () {
        sending = false;
        send.disabled = false;
      });
    }
    return { init: init, open: open, close: close, isOpen: function () { return !!opts; } };
  })();

  /* ------------------------------------------------------------ scrolling --- */
  // In the portrait fallback the stage is turned 90°, where native touch
  // scrolling would follow the wrong axis: those panes are dragged by hand.
  function dragScroll(sc) {
    var d = null, fling = 0, swallow = false;
    sc.addEventListener('pointerdown', function (e) {
      cancelAnimationFrame(fling);
      swallow = false;
      d = null;
      if (!BR.app.view.portrait || e.pointerType === 'mouse') return;
      d = { id: e.pointerId, x: e.clientX, top: sc.scrollTop, moved: false, v: 0, lx: e.clientX, lt: U.now() };
    });
    sc.addEventListener('pointermove', function (e) {
      if (!d || e.pointerId !== d.id) return;
      var s = BR.app.view.s;
      if (!d.moved && Math.abs(e.clientX - d.x) > 8) {
        d.moved = true;
        try { sc.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      }
      if (!d.moved) return;
      // the stage's y axis runs along the screen's -x axis
      sc.scrollTop = d.top + (e.clientX - d.x) / s;
      var now = U.now(), dt = Math.max(1, now - d.lt);
      d.v = 0.75 * ((e.clientX - d.lx) / s / dt) + 0.25 * d.v;
      d.lx = e.clientX;
      d.lt = now;
    });
    function end(e) {
      if (!d || e.pointerId !== d.id) return;
      if (d.moved) {
        swallow = true;
        var v = d.v, last = U.now();
        (function step() {
          var now = U.now(), dt = now - last;
          last = now;
          v *= Math.pow(0.995, dt);
          if (Math.abs(v) < 0.02) return;
          sc.scrollTop += v * dt;
          fling = requestAnimationFrame(step);
        })();
      }
      d = null;
    }
    sc.addEventListener('pointerup', end);
    sc.addEventListener('pointercancel', end);
    sc.addEventListener('click', function (e) {
      if (!swallow) return;
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
  }

  /* ------------------------------------------------------------ badges --- */
  function badge(node, n) {
    node.hidden = !n;
    node.textContent = n > 99 ? '99+' : String(n);
  }
  function setUnread(n) {
    unread = Math.max(0, n | 0);
    badge($('#radio-badge'), unread);
    badge($('#tab-badge'), unread);
  }
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
      toast('ランキングとチャットはオンライン版で利用できます');
      return;
    }
    if (!api.hasToken()) { showWelcome(); return; }
    if (!BR.bank.ready()) { toast('サーバーに接続しています…'); return; }
    hideCoach();
    if (!visible()) BR.screens.show('board');
    setView(tab);
  }

  function setView(v) {
    if (v === 'dm' && !peer) v = 'messages';
    view = v;
    tabs.set(v === 'dm' ? 'messages' : v);
    $('#pane-ranking').classList.toggle('active', v === 'ranking');
    $('#pane-messages').classList.toggle('active', v === 'messages');
    $('#pane-chat').classList.toggle('active', v === 'lobby' || v === 'dm');
    $('#pane-chat').classList.toggle('is-dm', v === 'dm');
    if (v === 'ranking') loadRanking();
    else if (v === 'messages') loadConversations();
    else if (v === 'lobby') { setLobbyNew(false); showChat('lobby', null); }
    else { renderDmHead(); showChat('dm:' + peer.id, peer.id); }
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
    who.appendChild(el('span', 'me-tag', 'あなた'));
    who.appendChild(nameSpan(me ? me.name : ''));
    mine.appendChild(who);
    mine.appendChild(amountEl(r.me.value, 'tokens', 'rank-val'));
    setOnline(r.online);
  }
  function rankRow(r) {
    var li = el('li', 'rank-row' + (r.rank <= 3 ? ' top' + r.rank : '') + (me && r.id === me.id ? ' self' : ''));
    li.dataset.uid = r.id;
    li.appendChild(el('span', 'rank-no', r.rank));
    var who = el('span', 'rank-name');
    who.appendChild(presence(r.online));
    who.appendChild(nameSpan(r.name));
    li.appendChild(who);
    li.appendChild(amountEl(r.value, 'tokens', 'rank-val'));
    return li;
  }
  function rankUser(id) {
    var found = null;
    Object.keys(ranks).forEach(function (t) {
      ranks[t].rows.forEach(function (r) { if (r.id === id) found = { id: r.id, name: r.name, online: r.online }; });
    });
    return found;
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
      renderConvNote('まだメッセージはありません。\nランキングやロビーでプレイヤーをタップして話しかけてみましょう！');
      return;
    }
    var list = $('#conv-list');
    list.textContent = '';
    convs.forEach(function (c) { list.appendChild(convRow(c)); });
  }
  function convRow(c) {
    var li = el('li', 'conv-row' + (c.unread ? ' unread' : ''));
    li.dataset.uid = c.user.id;
    var av = avatar(c.user);
    av.appendChild(presence(c.user.online));
    li.appendChild(av);
    var mid = el('div', 'conv-mid');
    mid.appendChild(el('div', 'conv-name uname', c.user.name));
    mid.appendChild(el('div', 'conv-last', preview(c.last)));
    li.appendChild(mid);
    var side = el('div', 'conv-side');
    side.appendChild(el('span', 'conv-time', fmtTime(c.at)));
    var b = el('b', 'badge');
    badge(b, c.unread);
    side.appendChild(b);
    li.appendChild(side);
    return li;
  }
  function preview(last) {
    if (last.kind === 'transfer') {
      return (last.mine ? '送金しました: ' : '受け取りました: ') + U.fmt(last.amount) + ' ' + (CUR[last.currency] || CUR.tokens).name;
    }
    return (last.mine ? 'あなた: ' : '') + clip(last.text, 60);
  }
  function convUser(id) {
    var found = null;
    (convs || []).forEach(function (c) { if (c.user.id === id) found = c.user; });
    return found;
  }
  // keep the conversation list in step with live messages
  function touchConv(m, other, mine) {
    if (!convs) return;
    var c = null;
    for (var i = 0; i < convs.length; i++) if (convs[i].user.id === other) { c = convs.splice(i, 1)[0]; break; }
    if (!c) {
      var name = mine ? (peer && peer.id === other ? peer.name : '') : (m.from && m.from.name);
      if (!name) { convs = null; return; } // unknown: reload when the list is opened
      c = { user: { id: other, name: name, online: mine ? !!(peer && peer.online) : true }, unread: 0 };
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
  function keyOf(m) {
    if (m.channel === 'lobby') return 'lobby';
    var mine = !!(m.from && me && m.from.id === me.id);
    return 'dm:' + (mine ? m.to : m.from ? m.from.id : 0);
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
    if (!prev || !sameDay(new Date(prev.at), new Date(m.at))) list.appendChild(el('div', 'day-sep', fmtDay(m.at)));
    list.appendChild(msgEl(m, key));
  }
  function msgEl(m, key) {
    var mine = !!(m.from && me && m.from.id === me.id);
    var node;
    if (m.kind === 'system') {
      node = el('div', 'msg sys');
      node.appendChild(el('span', 'sys-text', m.text));
      node.appendChild(el('span', 'msg-time', fmtTime(m.at)));
      return node;
    }
    if (m.kind === 'transfer') {
      node = el('div', 'msg xfer' + (mine ? ' mine' : ''));
      var card = el('div', 'xfer-card');
      card.appendChild(el('div', 'xfer-label', mine ? '送金しました' : '送金が届きました'));
      card.appendChild(amountEl(m.amount, m.currency, 'xfer-amount'));
      node.appendChild(card);
      node.appendChild(el('span', 'msg-time', fmtTime(m.at)));
      return node;
    }
    node = el('div', 'msg ' + (mine ? 'mine' : 'theirs'));
    if (key === 'lobby' && !mine && m.from) {
      var n = el('button', 'msg-name uname', m.from.name || '?');
      n.dataset.uid = m.from.id;
      node.appendChild(n);
    }
    node.appendChild(el('div', 'bubble', m.text));
    node.appendChild(el('span', 'msg-time', fmtTime(m.at)));
    return node;
  }
  function renderChatBar() {
    var key = chatKey();
    if (!key) return;
    var d = drafts[key];
    var ph = $('#chat-placeholder');
    ph.textContent = d ? clip(d, 80) : key === 'lobby' ? 'みんなにメッセージ…' : 'メッセージを入力…';
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
    u.appendChild(avatar(peer));
    var t = el('span', 'dm-id');
    t.appendChild(el('span', 'dm-name uname', peer.name));
    var st = el('span', 'dm-status');
    st.appendChild(presence(peer.online));
    st.appendChild(el('span', '', peer.online ? 'オンライン' : 'オフライン'));
    t.appendChild(st);
    u.appendChild(t);
  }

  function openDm(user) {
    if (!user || !me || user.id === me.id) return;
    peer = { id: user.id, name: user.name, online: !!user.online };
    closeModals();
    if (!visible()) BR.screens.show('board');
    setView('dm');
  }

  /* ------------------------------------------------------------ modals --- */
  var confirmDone = null;
  function showModal(id) { $('#' + id).hidden = false; }
  function closeModal(id) {
    $('#' + id).hidden = true;
    if (id === 'confirm' && confirmDone) {
      var f = confirmDone;
      confirmDone = null;
      f(false);
    }
  }
  function closeModals() {
    ['confirm', 'transfer', 'profile'].forEach(closeModal);
    $('#numpad').hidden = true;
  }
  // build(p) fills the question; resolves true when confirmed
  function confirmBox(build, okLabel) {
    if (confirmDone) closeModal('confirm');
    var p = $('#confirm-text');
    p.textContent = '';
    build(p);
    $('#confirm-yes').textContent = okLabel || 'OK';
    showModal('confirm');
    return new Promise(function (resolve) { confirmDone = resolve; });
  }

  /* profile */
  var prof = { data: null, seq: 0 };
  function openProfile(user) {
    if (!user || !me) return;
    var seq = ++prof.seq;
    prof.data = null;
    fillProfile(user, null, user.id === me.id);
    showModal('profile');
    api.user(user.id).then(function (r) {
      if (seq !== prof.seq) return;
      prof.data = r;
      fillProfile(r.user, r, r.self);
    }, function (err) {
      if (seq !== prof.seq) return;
      closeModal('profile');
      fail(err);
    });
  }
  function statAmount(id, v) {
    var b = $(id);
    b.textContent = '';
    if (v === null) b.textContent = '-';
    else b.appendChild(amountEl(v, 'tokens'));
  }
  function fillProfile(u, r, self) {
    var old = $('#pf-avatar');
    var av = avatar(u, 'big');
    av.id = 'pf-avatar';
    old.parentNode.replaceChild(av, old);
    $('#pf-name').textContent = u.name;
    var st = $('#pf-status');
    st.textContent = '';
    if (r) {
      st.appendChild(presence(r.user.online));
      st.appendChild(el('span', '', self ? 'あなた' : r.user.online ? 'オンライン' : 'オフライン'));
    }
    $('#pf-rank').textContent = r ? U.fmt(r.user.rank) : '-';
    statAmount('#pf-total', r ? r.user.totalWon : null);
    statAmount('#pf-biggest', r ? r.user.biggestWin : null);
    statAmount('#pf-today', r ? r.user.dayWon : null);
    $('#pf-spins').textContent = r ? U.fmt(r.user.spins) + '回' : '-';
    $('#pf-since').textContent = r ? '登録日 ' + fmtDate(r.user.createdAt) : '';
    $('#pf-actions-other').hidden = self;
    $('#pf-actions-self').hidden = !self;
    var blk = $('#pf-block');
    blk.textContent = r && r.blocked ? 'ブロック解除' : 'ブロック';
    blk.disabled = !r;
    $('#pf-blocks').hidden = true;
    if (self && r) loadBlocks();
  }
  function profileUser() { return prof.data ? prof.data.user : null; }

  function toggleBlock() {
    var r = prof.data;
    if (!r || r.self) return;
    var u = r.user, blocked = r.blocked;
    var ask = blocked ? Promise.resolve(true) : confirmBox(function (p) {
      p.appendChild(nameSpan(u.name));
      p.appendChild(document.createTextNode('さんをブロックしますか？'));
      p.appendChild(el('small', 'confirm-sub', 'この人からのメッセージと送金が届かなくなり、ロビーの発言も表示されなくなります。'));
    }, 'ブロック');
    ask.then(function (ok) {
      if (!ok) return null;
      return api.block(u.id, !blocked).then(function (res) {
        r.blocked = res.blocked;
        if (prof.data === r) fillProfile(u, r, false);
        sfx('click');
        toast(res.blocked ? 'ブロックしました' : 'ブロックを解除しました');
        if (res.blocked) dropFromLobby(u.id);
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
        row.appendChild(nameSpan(b.name));
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
    confirmBox(function (p) {
      p.appendChild(document.createTextNode('新しい引き継ぎコードを発行しますか？'));
      p.appendChild(el('small', 'confirm-sub', '今までのコードは使えなくなります。'));
    }, '発行する').then(function (ok) {
      if (!ok) return null;
      return api.recovery().then(function (r) {
        closeModals();
        showCode(r.recoveryCode, false);
      });
    }).catch(fail);
  }

  /* transfer */
  var tf = { user: null, cur: 'tokens', value: 0, busy: false };
  function openTransfer(user) {
    if (!user || !me || user.id === me.id) return;
    tf.user = { id: user.id, name: user.name, online: user.online };
    tf.cur = 'tokens';
    tf.value = 0;
    tf.busy = false;
    $('#tf-name').textContent = user.name;
    closeModal('profile');
    renderTransfer();
    showModal('transfer');
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
    $('#tf-icon').className = 'ic ic-' + CUR[tf.cur].icon;
    tf.value = Math.min(tf.value, tfMax());
    $('#tf-value').textContent = tf.value > 0 ? U.fmt(tf.value) : '-';
    $('#tf-note').textContent = '1回に送れる上限: ' + U.fmt(tfCap()) + ' ' + CUR[tf.cur].name;
    $('#tf-go').disabled = tf.busy || tf.value <= 0;
    var none = tf.busy || tfMax() <= 0;
    $$('#tf-quick button').forEach(function (b) { b.disabled = none; });
    $('#tf-amount').disabled = none;
  }
  function sendMoney() {
    if (tf.busy || tf.value <= 0 || !tf.user) return;
    var u = tf.user, cur = tf.cur, amount = tf.value;
    confirmBox(function (p) {
      p.appendChild(nameSpan(u.name));
      p.appendChild(document.createTextNode('さんに'));
      p.appendChild(amountEl(amount, cur, 'confirm-amt'));
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
        toast(u.name + 'さんに ' + U.fmt(amount) + ' ' + CUR[cur].name + ' を送金しました');
        closeModal('transfer');
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
      if (m.kind === 'transfer') sfx('purchase');
      markRead(other);
      return;
    }
    if (typeof m.unread === 'number') setUnread(m.unread);
    notify(m);
  }

  function notify(m) {
    var name = m.from ? m.from.name : '';
    if (m.kind === 'transfer') {
      sfx('purchase');
      toast(name + 'さんから ' + U.fmt(m.amount) + ' ' + (CUR[m.currency] || CUR.tokens).name + ' が届きました！', 3400);
    } else {
      sfx('message');
      toast(clip(name, 12) + ': ' + clip(m.text, 22), 3000);
    }
  }

  function onPresence(p) {
    setOnline(p.count);
    $$('#screen-board [data-uid="' + (p.id | 0) + '"] .dot').forEach(function (d) { d.classList.toggle('on', !!p.online); });
    (convs || []).forEach(function (c) { if (c.user.id === p.id) c.user.online = p.online; });
    Object.keys(ranks).forEach(function (t) { ranks[t].rows.forEach(function (r) { if (r.id === p.id) r.online = p.online; }); });
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
    setOnline(h.online);
    if (greeted) resync();
    greeted = true;
  }

  // after a dropped connection: fetch whatever is on screen again
  function resync() {
    Object.keys(chans).forEach(function (k) { chans[k].loaded = false; });
    if (!visible()) { convs = null; return; }
    if (view === 'ranking') loadRanking();
    else if (view === 'messages') loadConversations();
    else showChat(chatKey(), view === 'dm' ? peer.id : null);
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
      openProfile(rankUser(Number(row.dataset.uid)));
    });
    $('#rank-me').addEventListener('click', function () { sfx('click'); openProfile(me); });
    $('#conv-list').addEventListener('click', function (e) {
      var row = e.target.closest('[data-uid]');
      if (!row) return;
      sfx('click');
      openDm(convUser(Number(row.dataset.uid)));
    });
    chatList().addEventListener('click', function (e) {
      var n = e.target.closest('.msg-name');
      if (!n) return;
      sfx('click');
      openProfile({ id: Number(n.dataset.uid), name: n.textContent });
    });
    $('#chat-bar').addEventListener('click', function () { sfx('click'); compose(); });
    $('#dm-user').addEventListener('click', function () { sfx('click'); openProfile(peer); });
    $('#dm-profile').addEventListener('click', function () { sfx('click'); openProfile(peer); });
    $('#dm-money').addEventListener('click', function () { sfx('click'); openTransfer(peer); });
    $('#chat-scroll').addEventListener('scroll', function () { if (this.scrollTop < 80) loadOlder(); }, { passive: true });
    $('#entry-feed').addEventListener('scroll', function () { if (this.scrollTop < 60 && entry.isOpen()) loadOlder(); }, { passive: true });
    $$('#screen-board .scroller').forEach(dragScroll);

    BR.screens.register('board', {
      back: function () {
        if (view === 'dm') { setView('messages'); return true; }
        return false;
      },
      close: function () {
        entry.close();
        closeModals();
      }
    });
  }

  function bindModals() {
    $$('.modal').forEach(function (m) {
      m.addEventListener('click', function (e) {
        if (e.target === m || e.target.closest('[data-close]')) {
          sfx('click');
          closeModal(m.id);
        }
      });
    });
    $('#confirm-yes').addEventListener('click', function () {
      var f = confirmDone;
      confirmDone = null;
      $('#confirm').hidden = true;
      sfx('click');
      if (f) f(true);
    });
    $('#confirm-no').addEventListener('click', function () { sfx('click'); closeModal('confirm'); });
    $('#pf-message').addEventListener('click', function () { sfx('click'); openDm(profileUser()); });
    $('#pf-transfer').addEventListener('click', function () { sfx('click'); openTransfer(profileUser()); });
    $('#pf-block').addEventListener('click', toggleBlock);
    $('#pf-recovery').addEventListener('click', function () { sfx('click'); reissueCode(); });
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
        icon: CUR[tf.cur].icon,
        value: tf.value,
        max: tfMax(),
        onOk: function (n) { tf.value = n; renderTransfer(); }
      });
    });
    $('#tf-go').addEventListener('click', function () { sfx('click'); sendMoney(); });
  }

  function bindWelcome() {
    $('#ov-register').addEventListener('submit', onRegister);
    $('#ov-login').addEventListener('submit', onLogin);
    $('#ov-name').addEventListener('input', function () {
      var p = nameProblem(this.value);
      setOvError('register', p || '');
    });
    $('#ov-code').addEventListener('input', formatCode);
    $$('#welcome [data-go]').forEach(function (b) {
      b.addEventListener('click', function () {
        setOvError('register', '');
        setOvError('login', '');
        showCard(b.dataset.go);
        var input = b.dataset.go === 'login' ? $('#ov-code') : $('#ov-name');
        input.focus();
      });
    });
    $('#ov-copy').addEventListener('click', function () {
      var code = $('#ov-code-value').textContent;
      copyText(code).then(function () {
        $('#ov-copy').textContent = 'コピーしました！';
      }, function () {
        var r = document.createRange();
        r.selectNodeContents($('#ov-code-value'));
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        $('#ov-copy').textContent = '長押しでコピーしてください';
      });
    });
    $('#ov-done').addEventListener('click', function () {
      hideWelcome();
      if (ov.first) showCoach();
    });
  }

  function init() {
    entry.init();
    bindBoard();
    bindModals();
    bindWelcome();
    $('#coach').addEventListener('click', hideCoach);
    if (!online) return;
    api.on('auth-lost', onAuthLost);
    BR.live.on('hello', onHello);
    BR.live.on('msg', onMsg);
    BR.live.on('balance', function (b) { BR.app.serverBalance(b); });
    BR.live.on('presence', onPresence);
    BR.live.on('board', onBoard);
    BR.live.on('status', function (on) { $('#board-info').classList.toggle('off', !on); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && visible() && view === 'dm' && peer) markRead(peer.id);
    });
    if (api.hasToken()) start();
    else showWelcome();
  }

  BR.social = {
    init: init,
    open: openBoard,
    // Escape on a keyboard: close the top-most layer; true if something closed
    escape: function () {
      if (entry.isOpen()) { entry.close(); return true; }
      var open = ['confirm', 'transfer', 'profile'].filter(function (id) { return !$('#' + id).hidden; });
      if (open.length) { closeModal(open[0]); return true; }
      return false;
    }
  };
  BR.entry = entry;
})(window.BR = window.BR || {});
