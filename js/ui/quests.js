/* クエスト (the quest button on the slot screen), the player level and the
   green notices 「クエストを完了しました」 on the slot screen. Quests finished
   within 10 seconds share one notice, and a notice makes no sound; finished
   away from the slot screen, it waits there. A finished quest pays once the
   player receives it (受け取る, or 一括受け取り for all of them); the badge on
   the button counts what is waiting. Definitions and periods:
   js/game/quests.js; the progress and the rewards are the server's. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, Q = BR.QUESTS, LV = BR.LEVEL;
  var $ = U.$, $$ = U.$$;
  var el = K.el, sfx = K.sfx, toast = K.toast;

  var BATCH_MS = 10000;
  var data = null;        // { periods: [{ id, start, end, quests: [{ id, state: open|ready|received, progress }] }] }
  var offset = 0;         // server clock - this clock
  var tab = '5h';
  var loading = null;
  var xp = null;          // the player's XP (null until known)
  var ready = 0;          // finished quests waiting to be received
  var claiming = false;
  var batch = null;       // the notice being collected: { ids, level, until, shown }
  var noteTimer = 0, waitTimer = 0, ticker = 0, reloadTimer = 0;

  function now() { return Date.now() + offset; }
  function visible() { return BR.screens.current() === 'quests'; }
  function home() { return BR.screens.current() === 'slot'; }

  /* ------------------------------------------------------------ level --- */
  // quiet: no notice (the first value after logging in)
  function setXp(v, quiet) {
    if (typeof v !== 'number' || (xp !== null && v < xp)) return;
    var before = xp === null ? null : LV.of(xp);
    xp = v;
    renderLevel();
    var after = LV.of(xp);
    if (!quiet && before !== null && after > before) note({ level: after });
  }
  function levelBar(info) {
    var bar = el('i', 'lv-bar');
    var fill = el('i');
    fill.style.width = Math.round(info.into / info.need * 100) + '%';
    bar.appendChild(fill);
    return bar;
  }
  // the level shows on my card (top left of the slot screen) and on the quest screen
  function renderLevel() {
    var q = $('#q-lv');
    q.textContent = '';
    if (xp === null) return;
    var info = LV.info(xp);
    $('#lv-num').textContent = info.level;
    $('#lv-fill').style.width = Math.round(info.into / info.need * 100) + '%';
    q.appendChild(el('b', 'q-lv-num', 'Lv.' + info.level));
    q.appendChild(levelBar(info));
    q.appendChild(el('span', 'q-lv-xp', U.fmt(info.into) + ' / ' + U.fmt(info.need) + ' XP'));
  }

  /* ------------------------------------------------------------ notices --- */
  function note(add) {
    var t = Date.now();
    // a new window of 10 s, unless the last notice never got shown
    if (!batch || (t > batch.until && batch.shown)) batch = { ids: [], level: 0, until: t + BATCH_MS, shown: false };
    if (add.ids) batch.ids = batch.ids.concat(add.ids);
    if (add.level) batch.level = Math.max(batch.level, add.level);
    // away from the slot screen: shown (all of it) when the player is back
    if (!home()) { batch.shown = false; return; }
    showNote();
  }
  function showNote() {
    var b = batch;
    if (!b || !home()) return;
    // never before the reels have stopped (「カジノで当たる」 would tell the result)
    if (BR.game && BR.game.busy()) { clearTimeout(waitTimer); waitTimer = setTimeout(showNote, 300); return; }
    var box = $('#quest-note');
    box.textContent = '';
    box.appendChild(el('i', 'qn-icon'));
    var text = el('div', 'qn-text');
    if (b.ids.length) {
      var first = Q.get(b.ids[0]);
      text.appendChild(el('b', '', 'クエストを完了しました'));
      text.appendChild(el('span', '', '「' + (first ? first.text : '') + '」' + (b.ids.length > 1 ? 'ほか' + (b.ids.length - 1) + '件' : '') + '・クエストで受け取れます'));
    }
    if (b.level) {
      text.appendChild(el('b', 'qn-level', 'レベルアップ！ Lv.' + b.level));
      levelUp(b.level);
    }
    box.appendChild(text);
    box.hidden = false;
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    b.shown = true;
    clearTimeout(noteTimer);
    // up while the 10 s window is open, then a little longer
    noteTimer = setTimeout(hideNote, Math.max(4000, b.until - Date.now() + 2500));
  }
  // LEVEL UP across the screen, the card at the top left lights up
  var levelShown = 0;
  function levelUp(n) {
    if (n <= levelShown) return;
    levelShown = n;
    var J = BR.juice, card = $('#me-card');
    sfx('levelUp');
    if (!J) return;
    J.banner('LEVEL UP!', 'level', 2000, 'Lv.' + n);
    J.flash('#fff3c0', 0.3, 420);
    J.rain({ kind: 'confetti', dur: 1.2, rate: 40 });
    if (card && !card.hidden) {
      J.celebrate(card, 2);
      card.classList.remove('jc-level');
      void card.offsetWidth;
      card.classList.add('jc-level');
    }
  }

  function hideNote() {
    var box = $('#quest-note');
    box.classList.remove('show');
    noteTimer = setTimeout(function () { box.hidden = true; }, 350);
  }

  // the badge on the quest button: finished quests waiting to be received
  function setReady(n) {
    if (typeof n !== 'number') return;
    ready = Math.max(0, n);
    K.badge($('#quest-badge'), ready);
    renderClaimAll();
  }

  // a quest was finished (pushed by the server)
  function onQuest(ev) {
    if (!ev || !ev.done || !ev.done.length) return;
    setReady(typeof ev.ready === 'number' ? ev.ready : ready + ev.done.length);
    note({ ids: ev.done });
    if (visible()) reloadSoon();
  }

  /* ------------------------------------------------------------ the quest screen --- */
  function open() {
    if (!api.online) { sfx('deny'); toast('クエストはオンライン版で遊べます'); return; }
    BR.account.require(function () {
      if (!BR.bank.ready()) { toast('サーバーに接続しています…'); return; }
      BR.screens.show('quests');
    });
  }

  function load() {
    if (loading) return loading;
    loading = api.quests().then(function (r) {
      loading = null;
      offset = r.now - Date.now();
      data = r;
      setXp(r.xp, true);
      setReady(r.ready);
      if (visible()) render();
      return r;
    }, function (err) {
      loading = null;
      if (visible() && !data) renderNote(err.message);
      throw err;
    });
    return loading;
  }
  function reloadSoon() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () { load().catch(function () {}); }, 500);
  }

  function short(n) {
    var t = function (v) { return String(Math.round(v * 10) / 10); };
    if (n >= 1e6) return t(n / 1e6) + 'M';
    if (n >= 1e3) return t(n / 1e3) + 'k';
    return String(n);
  }
  function left(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    var pad = function (v) { return v < 10 ? '0' + v : String(v); };
    if (d > 0) return d + '日 ' + h + '時間';
    return h + ':' + pad(m) + ':' + pad(sec);
  }
  function resetText(p, end) {
    var d = new Date(end);
    var when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    var cur = p.currency === 'tokens' ? '報酬はスピントークン' : '報酬はドル';
    var every = { '5h': '5時間ごとに更新', day: '毎日 9:00 に更新', week: '毎週日曜 9:00 に更新', month: '毎月18日 9:00 に更新', special: '3か月ごとに更新' }[p.id];
    return cur + '・' + every + '（次は ' + when + '）';
  }

  function renderNote(text) {
    var list = $('#q-list');
    list.textContent = '';
    list.appendChild(el('div', 'empty', text));
  }

  function current() {
    if (!data) return null;
    for (var i = 0; i < data.periods.length; i++) if (data.periods[i].id === tab) return data.periods[i];
    return null;
  }

  function render() {
    var def = Q.period(tab), p = current();
    $('#q-title').textContent = def.name + 'クエスト';
    $('#q-sub').textContent = p ? resetText(def, p.end) : '';
    renderClock();
    if (!p) { renderNote('読み込み中…'); return; }
    var list = $('#q-list');
    list.textContent = '';
    var rows = p.quests.map(function (st) { return { st: st, def: Q.get(st.id) }; }).filter(function (x) { return x.def; });
    if (!rows.length) { renderNote('現在、' + def.name + 'クエストはありません'); return; }
    // waiting to be received first, received ones at the bottom
    var order = { ready: 0, open: 1, received: 2 };
    rows.sort(function (a, b) { return order[a.st.state] - order[b.st.state]; });
    rows.forEach(function (x) { list.appendChild(row(x.def, x.st, def.currency)); });
    var done = p.quests.filter(function (q) { return q.state !== 'open'; }).length;
    $('#q-sub').textContent += '　達成 ' + done + ' / ' + p.quests.length;
    renderClaimAll();
  }

  // the 一括受け取り button and a dot on every tab with something to receive
  function renderClaimAll() {
    var btn = $('#q-claim-all');
    btn.hidden = !ready;
    btn.disabled = claiming;
    $('#q-claim-n').textContent = ready > 99 ? '99+' : String(ready);
    if (!data) return;
    data.periods.forEach(function (p) {
      var t = document.querySelector('#q-tabs .tab[data-tab="' + p.id + '"]');
      if (t) t.classList.toggle('has-ready', p.quests.some(function (q) { return q.state === 'ready'; }));
    });
  }

  function row(def, st, currency) {
    var r = el('div', 'q-row t-' + Q.tier(def.reward) + ' ' + st.state);
    r.dataset.quest = def.id;
    r.appendChild(el('i', 'q-gem'));
    var main = el('div', 'q-main');
    main.appendChild(el('div', 'q-text', def.text));
    if (def.note) main.appendChild(el('div', 'q-note', def.note));
    var prog = el('div', 'q-prog');
    var bar = el('i', 'q-bar');
    var fill = el('i');
    fill.style.width = Math.round(Math.min(1, st.progress / def.goal) * 100) + '%';
    bar.appendChild(fill);
    prog.appendChild(bar);
    var f = def.money ? short : String;
    prog.appendChild(el('span', 'q-count', f(st.progress) + '/' + f(def.goal)));
    main.appendChild(prog);
    r.appendChild(main);
    var rew = el('div', 'q-reward');
    rew.appendChild(K.amountEl(def.reward, currency));
    if (st.state === 'ready') {
      var b = el('button', 'act-btn gold q-take', '受け取る');
      b.type = 'button';
      b.dataset.claim = def.id;
      b.disabled = claiming;
      rew.appendChild(b);
    } else if (st.state === 'received') {
      rew.appendChild(el('span', 'q-got', '受け取り済み'));
    }
    r.appendChild(rew);
    return r;
  }

  // 受け取る (one quest) / 一括受け取り (ids: null)
  function claim(ids) {
    if (claiming) return;
    claiming = true;
    renderClaimAll();
    $$('#q-list .q-take').forEach(function (b) { b.disabled = true; });
    api.claimQuests(ids).then(function (r) {
      claiming = false;
      if (data) data.periods = r.periods;
      setReady(r.ready);
      setXp(r.xp);
      if (r.balance) BR.app.serverBalance(r.balance);
      if (r.claimed.length) {
        sfx('purchase');
        if (BR.juice) BR.juice.reward(null, r.claimed.length > 1 ? 3 : 2);
        var parts = [];
        if (r.dollars) parts.push('$' + U.fmt(r.dollars));
        if (r.tokens) parts.push(U.fmt(r.tokens) + ' トークン');
        toast((r.claimed.length > 1 ? r.claimed.length + '件の' : '') + '報酬を受け取りました' + (parts.length ? '：' + parts.join('・') : ''), 3200);
      }
      if (visible()) render();
    }, function (err) {
      claiming = false;
      if (visible()) render();
      K.fail(err);
    });
  }

  function renderClock() {
    var p = current();
    $('#q-reset').textContent = p ? left(p.end - now()) : '-';
  }
  function onTick() {
    if (!visible()) return;
    renderClock();
    // a period started over: fetch the new list
    if (data && data.periods.some(function (p) { return now() >= p.end; })) reloadSoon();
  }

  function init() {
    var tabs = BR.screens.tabs($('#screen-quests'), function (t) {
      tab = t;
      $('#q-scroll').scrollTop = 0;
      render();
    });
    K.dragScroll($('#q-scroll'));
    $('#q-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-claim]');
      if (!b || b.disabled) return;
      sfx('click');
      claim([b.dataset.claim]);
    });
    $('#q-claim-all').addEventListener('click', function () {
      if (claiming) return;
      sfx('click');
      claim(null);
    });
    BR.screens.register('quests', {
      open: function () {
        // a tab with something to receive comes first
        if (data && !(current() && current().quests.some(function (q) { return q.state === 'ready'; }))) {
          var hit = data.periods.filter(function (p) { return p.quests.some(function (q) { return q.state === 'ready'; }); })[0];
          if (hit) tab = hit.id;
        }
        tabs.set(tab);
        render();
        load().catch(function () {});
        clearInterval(ticker);
        ticker = setInterval(onTick, 1000);
      },
      close: function () { clearInterval(ticker); }
    });
    // back on the slot screen: a notice that waited shows now
    BR.screens.onChange(function (name) {
      if (name === 'slot' && batch && !batch.shown) showNote();
      if (name !== 'slot') { clearTimeout(noteTimer); $('#quest-note').hidden = true; }
    });
    if (!api.online) return;
    BR.live.on('quest', onQuest);
    BR.live.on('hello', function (h) { if (h.me) { setXp(h.me.xp, xp === null); setReady(h.me.questsReady); } });
  }

  BR.quests = {
    init: init,
    open: open,
    setXp: setXp,
    setReady: setReady,
    xp: function () { return xp; },
    // signed out: nothing to show until the next player
    reset: function () { xp = null; data = null; batch = null; setReady(0); renderLevel(); }
  };
})(window.BR = window.BR || {});
