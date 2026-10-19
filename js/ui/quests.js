/* クエスト (the quest button on the slot screen), the player level and the
   small green notice 「クエスト達成！」 at the very top of the slot screen
   (3 seconds; quests finished within 10 seconds share it, it makes no sound,
   and one finished away from the slot screen waits there). A finished quest
   pays once the player receives it (受け取る, or 一括受け取り for all of
   them); the badge on the button counts what is waiting. On the quest
   screen the quests of one metric make one row, a chain of steps: the step
   on now with its progress, how many steps there are, where the chain ends
   and what all of it pays. Definitions and periods: js/game/quests.js; the
   progress and the rewards are the server's. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, Q = BR.QUESTS, LV = BR.LEVEL;
  var $ = U.$, $$ = U.$$;
  var el = K.el, sfx = K.sfx, toast = K.toast;

  var BATCH_MS = 10000, NOTE_MS = 3000;
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
    var grew = xp !== null && v > xp;
    xp = v;
    var after = LV.of(xp);
    var levelled = !quiet && before !== null && after > before;
    renderLevel(levelled);
    if (levelled) note({ level: after });
    else if (grew && !quiet) xpSparkle();
  }
  // XP came in: a little glitter where the bar has grown to
  function xpSparkle() {
    var J = BR.juice, fill = $('#lv-fill'), card = $('#me-card');
    if (!J || !fill || !card || card.hidden || !home()) return;
    setTimeout(function () {
      var r = J.size(fill), c = J.at(fill);
      J.sparks(c.x + r.w / 2, c.y, { n: 5, speed: 160, life: 0.5, g: -80, size: 0.7 });
    }, 500);
  }
  function levelBar(info) {
    var bar = el('i', 'lv-bar');
    var fill = el('i');
    fill.style.width = Math.round(info.into / info.need * 100) + '%';
    bar.appendChild(fill);
    return bar;
  }
  // The level shows on my card (top left of the slot screen) and on the
  // quest screen. A new level: the bar on the card fills up to the end and
  // stays full until the LEVEL UP shows (levelUp), then the number turns
  // over and the bar starts again from nothing.
  var turn = null, turnTimer = 0;
  function pct(info) { return Math.round(info.into / info.need * 100) + '%'; }
  function renderLevel(levelled) {
    var q = $('#q-lv');
    q.textContent = '';
    if (xp === null) return;
    var info = LV.info(xp);
    if (levelled || turn) {
      turn = info;
      $('#lv-fill').style.width = '100%';
      clearTimeout(turnTimer);
      turnTimer = setTimeout(turnOver, 20000);
    } else {
      $('#lv-num').textContent = info.level;
      $('#lv-fill').style.width = pct(info);
    }
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
      text.appendChild(el('b', '', 'クエスト達成！'));
      text.appendChild(el('span', '', '「' + (first ? first.text : '') + '」' + (b.ids.length > 1 ? 'ほか' + (b.ids.length - 1) + '件' : '')));
    }
    if (b.level) {
      text.appendChild(el('b', 'qn-level', 'Lv.' + b.level + ' にアップ！'));
      levelUp(b.level);
    }
    box.appendChild(text);
    box.hidden = false;
    box.classList.remove('show');
    void box.offsetWidth;
    box.classList.add('show');
    b.shown = true;
    // the quest button lights up: something is waiting there
    if (b.ids.length && BR.juice) {
      var J = BR.juice, q = $('#btn-quest');
      J.ring(J.at(q).x, J.at(q).y, { r0: 30, r1: 160, dur: 0.6, w: 8, color: 'green' });
      J.sparks(J.at(q).x, J.at(q).y, { n: 14, speed: 420, life: 0.7, g: 300, color: 'green' });
      J.bump(q, 1.2);
    }
    clearTimeout(noteTimer);
    noteTimer = setTimeout(hideNote, NOTE_MS);
  }
  function turnOver() {
    clearTimeout(turnTimer);
    var info = turn, fill = $('#lv-fill'), J = BR.juice;
    if (!info) return;
    turn = null;
    $('#lv-num').textContent = info.level;
    fill.style.transition = 'none';
    fill.style.width = '0%';
    void fill.offsetWidth;
    fill.style.transition = '';
    fill.style.width = pct(info);
    if (J && home() && J.visible(fill)) {
      var num = $('.me-lv b'), c = J.at(num);
      J.ring(c.x, c.y, { r0: 6, r1: 90, dur: 0.5, w: 6 });
      J.sparks(c.x, c.y, { n: 14, speed: 420, life: 0.6, g: 300 });
      J.bump(num, 1.5);
    }
  }

  // LEVEL UP across the screen, the card at the top left lights up
  var levelShown = 0;
  function levelUp(n) {
    setTimeout(turnOver, 420);
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
  // how a quest's progress reads: minutes, $, spin tokens or a count
  function amount(def, v) {
    if (def.sec) return Math.floor(v / 60) + '分';
    if (def.money) return '$' + short(v);
    if (def.tokens) return short(v);
    return String(v);
  }
  var EVERY = {
    '5h': '5時間ごとに更新', day: '毎日 9:00 に更新', week: '毎週日曜 9:00 に更新',
    coop: '毎週日曜 9:00 に更新・友達と稼ぐ中だけ進む', month: '毎月18日 9:00 に更新', special: 'リセットなし（一度きり）'
  };
  function resetText(p, end) {
    var every = '報酬はドル・' + EVERY[p.id];
    if (!end) return every;
    var d = new Date(end);
    var when = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    return every + '（次は ' + when + '）';
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

  // The quests of a period as chains (one metric each, the 臨時緊急 apart):
  // [{ steps: [{ def, st }] by goal, cur: the step on now (-1: all received) }]
  function chains(p) {
    var by = {}, order = [];
    p.quests.forEach(function (st) {
      var def = Q.get(st.id);
      if (!def) return;
      var key = def.metric + (def.emergency ? '!' : '');
      if (!by[key]) { by[key] = []; order.push(key); }
      by[key].push({ def: def, st: st });
    });
    return order.map(function (k) {
      var steps = by[k].sort(function (a, b) { return a.def.goal - b.def.goal; });
      var cur = -1;
      for (var i = 0; i < steps.length; i++) if (steps[i].st.state !== 'received') { cur = i; break; }
      return { steps: steps, cur: cur, emergency: !!steps[0].def.emergency };
    });
  }
  function chainState(c) { return c.cur < 0 ? 'received' : c.steps[c.cur].st.state; }

  function render() {
    var def = Q.period(tab), p = current();
    $('#q-title').textContent = def.name + 'クエスト';
    $('#q-sub').textContent = p ? resetText(def, p.end) : '';
    $('#screen-quests').dataset.period = tab;
    renderClock();
    if (!p) { renderNote('読み込み中…'); return; }
    var list = $('#q-list');
    list.textContent = '';
    if (def.hub) list.appendChild(hubBanner());
    var cs = chains(p);
    if (!cs.length) { list.appendChild(el('div', 'empty', '現在、' + def.name + 'クエストはありません')); return; }
    // the 臨時緊急 first, then what waits to be received, what is open, what is all done
    var order = { ready: 0, open: 1, received: 2 };
    cs.sort(function (a, b) { return (b.emergency - a.emergency) || (order[chainState(a)] - order[chainState(b)]); });
    cs.forEach(function (c) { list.appendChild(chainRow(c)); });
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

  // 週間協力: it only moves in a hub with friends
  function hubBanner() {
    var on = !!(BR.hub && BR.hub.active());
    var b = el('div', 'q-hub' + (on ? ' on' : ''));
    var t = el('div', 'q-hub-text');
    t.appendChild(el('b', '', on ? '友達と稼ぐに参加中：進行中！' : '友達と稼ぐ（ハブ）に参加しているあいだだけ進みます'));
    t.appendChild(el('span', '', 'ハブのみんなが稼いだ額と、友達と一緒に稼いだ時間がカウントされます（4分以上なにも操作がないと時間は止まります）'));
    b.appendChild(t);
    if (!on) {
      var go = el('button', 'act-btn gold q-hub-go', 'フレンドを招待');
      go.type = 'button';
      go.dataset.go = 'friends';
      b.appendChild(go);
    }
    return b;
  }

  // the badge of a quest by what it counts
  var MARK = {
    spin: 'SPIN', win: 'WIN', bet: 'BET', combo: 'COMBO', earn: '$', coopEarn: '$', online: 'TIME', hubSec: 'TIME',
    talkSec: 'TALK', talk: 'TALK', call: 'CALL', chat: 'CHAT', peek: 'CHAT', watch: 'WATCH', wbet: 'BET', hub: 'HUB',
    sent: 'SEND', friend: 'FRIEND', strawberry: 'FRUIT', watermelon: 'FRUIT', melon: 'FRUIT', borrow: 'LOAN',
    clear: 'QUEST', sclear: 'QUEST', broke: '$0'
  };

  function chainRow(c) {
    var n = c.steps.length, i = c.cur < 0 ? n - 1 : c.cur;
    var def = c.steps[i].def, st = c.steps[i].st, state = chainState(c);
    var r = el('div', 'q-row t-' + Q.tier(def.reward) + ' ' + state + (c.emergency ? ' emergency' : '') + (n > 1 ? ' chain' : ''));
    r.dataset.quest = def.id;
    var gem = el('i', 'q-gem');
    gem.appendChild(el('b', '', MARK[def.metric] || 'Q'));
    r.appendChild(gem);
    var main = el('div', 'q-main');
    var head = el('div', 'q-headline');
    if (c.emergency) head.appendChild(el('span', 'q-flag', '臨時緊急'));
    head.appendChild(el('span', 'q-text', def.text));
    if (n > 1) head.appendChild(el('span', 'q-step', 'STEP ' + (i + 1) + '/' + n));
    main.appendChild(head);
    if (def.note) main.appendChild(el('div', 'q-note', def.note));
    var prog = el('div', 'q-prog');
    var bar = el('i', 'q-bar');
    var fill = el('i');
    var v = state === 'received' ? def.goal : st.progress;
    fill.style.width = Math.round(Math.min(1, v / def.goal) * 100) + '%';
    bar.appendChild(fill);
    prog.appendChild(bar);
    prog.appendChild(el('span', 'q-count', amount(def, v) + ' / ' + amount(def, def.goal)));
    main.appendChild(prog);
    if (n > 1) main.appendChild(chainInfo(c));
    r.appendChild(main);
    var rew = el('div', 'q-reward');
    if (state === 'received') {
      rew.appendChild(el('span', 'q-got', n > 1 ? '全段階クリア' : '受け取り済み'));
    } else {
      rew.appendChild(K.amountEl(def.reward, 'dollars'));
      if (state === 'ready') {
        var b = el('button', 'act-btn gold q-take', '受け取る');
        b.type = 'button';
        b.dataset.claim = def.id;
        b.disabled = claiming;
        rew.appendChild(b);
      }
    }
    r.appendChild(rew);
    return r;
  }
  // a chain's steps as pips, where it ends and what all of it pays
  function chainInfo(c) {
    var box = el('div', 'q-chain');
    var pips = el('span', 'q-pips');
    c.steps.forEach(function (s, k) {
      pips.appendChild(el('i', s.st.state === 'received' ? 'got' : s.st.state === 'ready' ? 'ready' : k === c.cur ? 'now' : ''));
    });
    box.appendChild(pips);
    var total = 0, left = 0;
    c.steps.forEach(function (s) { total += s.def.reward; if (s.st.state !== 'received') left += s.def.reward; });
    box.appendChild(el('span', 'q-final', '最終目標：' + c.steps[c.steps.length - 1].def.text));
    var sum = el('span', 'q-sum');
    sum.appendChild(document.createTextNode('全' + c.steps.length + '段階の合計 '));
    sum.appendChild(el('b', '', '$' + U.fmt(total)));
    if (left && left < total) sum.appendChild(document.createTextNode('（のこり $' + U.fmt(left) + '）'));
    box.appendChild(sum);
    return box;
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
        toast((r.claimed.length > 1 ? r.claimed.length + '件の' : '') + '報酬を受け取りました' + (r.dollars ? '：$' + U.fmt(r.dollars) : ''), 3200);
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
    $('#q-reset').textContent = !p ? '-' : p.end ? left(p.end - now()) : 'なし';
  }
  function onTick() {
    if (!visible()) return;
    renderClock();
    // a period started over: fetch the new list
    if (data && data.periods.some(function (p) { return p.end && now() >= p.end; })) reloadSoon();
  }

  function init() {
    var tabs = BR.screens.tabs($('#screen-quests'), function (t) {
      tab = t;
      $('#q-scroll').scrollTop = 0;
      render();
    });
    K.dragScroll($('#q-scroll'));
    $('#q-list').addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) { sfx('click'); BR.social.open('friends'); return; }
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
