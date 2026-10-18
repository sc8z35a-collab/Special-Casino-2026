/* クエスト (the quest button on the slot screen), the player level and the
   green notices on the slot screen. Quests finished within 10 seconds share
   one notice, and a notice makes no sound; finished away from the slot screen,
   it waits there. Definitions and periods: js/game/quests.js; the progress
   comes from the server, which also pays the rewards. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, Q = BR.QUESTS, LV = BR.LEVEL;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast;

  var BATCH_MS = 10000;
  var data = null;        // { periods: [{ id, start, end, quests: [{ id, done, progress }] }] }
  var offset = 0;         // server clock - this clock
  var tab = '5h';
  var loading = null;
  var xp = null;          // the player's XP (null until known)
  var unseen = 0;         // quests finished since the list was last opened
  var batch = null;       // the notice being collected: { ids, dollars, tokens, level, until, shown }
  var noteTimer = 0, waitTimer = 0, ticker = 0, reloadTimer = 0;

  function now() { return Date.now() + offset; }
  function visible() { return BR.screens.current() === 'quests'; }
  function home() { return BR.screens.current() === 'slot'; }

  /* ------------------------------------------------------------ level --- */
  // quiet: no notice (the first value after logging in)
  function setXp(v, quiet) {
    if (typeof v !== 'number') return;
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
  function renderLevel() {
    var chip = $('#lv-chip'), q = $('#q-lv');
    q.textContent = '';
    if (xp === null) { chip.hidden = true; return; }
    var info = LV.info(xp);
    chip.hidden = false;
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
    if (!batch || (t > batch.until && batch.shown)) batch = { ids: [], dollars: 0, tokens: 0, level: 0, until: t + BATCH_MS, shown: false };
    if (add.ids) batch.ids = batch.ids.concat(add.ids);
    batch.dollars += add.dollars || 0;
    batch.tokens += add.tokens || 0;
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
      text.appendChild(el('b', '', 'クエスト達成！'));
      text.appendChild(el('span', '', '「' + (first ? first.text : '') + '」' + (b.ids.length > 1 ? 'ほか' + (b.ids.length - 1) + '件' : '')));
    }
    if (b.level) text.appendChild(el('b', 'qn-level', 'レベルアップ！ Lv.' + b.level));
    box.appendChild(text);
    if (b.dollars || b.tokens) {
      var rew = el('div', 'qn-reward');
      if (b.dollars) rew.appendChild(K.amountEl(b.dollars, 'dollars'));
      if (b.tokens) rew.appendChild(K.amountEl(b.tokens, 'tokens'));
      box.appendChild(rew);
    }
    box.hidden = false;
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    b.shown = true;
    clearTimeout(noteTimer);
    // up while the 10 s window is open, then a little longer
    noteTimer = setTimeout(hideNote, Math.max(4000, b.until - Date.now() + 2500));
  }
  function hideNote() {
    var box = $('#quest-note');
    box.classList.remove('show');
    noteTimer = setTimeout(function () { box.hidden = true; }, 350);
  }

  function setUnseen(n) {
    unseen = Math.max(0, n);
    K.badge($('#quest-badge'), unseen);
  }

  // a quest was finished (pushed by the server)
  function onQuest(ev) {
    if (!ev || !ev.done || !ev.done.length) return;
    setUnseen(unseen + ev.done.length);
    note({ ids: ev.done, dollars: ev.dollars, tokens: ev.tokens });
    if (typeof ev.xp === 'number') setXp(ev.xp);
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
    // finished ones go to the bottom
    rows.sort(function (a, b) { return (a.st.done ? 1 : 0) - (b.st.done ? 1 : 0); });
    rows.forEach(function (x) { list.appendChild(row(x.def, x.st, def.currency)); });
    var done = p.quests.filter(function (q) { return q.done; }).length;
    $('#q-sub').textContent += '　達成 ' + done + ' / ' + p.quests.length;
  }

  function row(def, st, currency) {
    var r = el('div', 'q-row t-' + Q.tier(def.reward) + (st.done ? ' done' : ''));
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
    r.appendChild(rew);
    if (st.done) r.appendChild(el('span', 'q-stamp', '達成'));
    return r;
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
    BR.screens.register('quests', {
      open: function () {
        tabs.set(tab);
        setUnseen(0);
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
    BR.live.on('hello', function (h) { if (h.me) setXp(h.me.xp, xp === null); });
  }

  BR.quests = {
    init: init,
    open: open,
    setXp: setXp,
    xp: function () { return xp; },
    // signed out: nothing to show until the next player
    reset: function () { xp = null; data = null; batch = null; setUnseen(0); renderLevel(); }
  };
})(window.BR = window.BR || {});
