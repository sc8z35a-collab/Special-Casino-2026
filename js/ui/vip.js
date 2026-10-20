/* VIP (js/game/vip.js, server: POST /api/vip/extend): ロイヤルコイン make
   days of it, VIP EXP its level (VIP0-VIP3), and what each level gives. The
   badge on one's card (and for friends) shows while it is on. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, S = BR.store.state, C = BR.CONFIG, V = BR.VIP;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var DAY = V.day;

  var days = 1, busy = false, lastLevel = null, timer = 0;

  function me() { return BR.social.me(); }
  function vip() { var m = me(); return m && m.vip ? m.vip : null; }
  function isOn(v) { return !!v && v.on && v.until > Date.now(); }
  // days that can still be added (VIP reaches `maxDays` ahead at most)
  function room() {
    var v = vip(), from = Math.max(Date.now(), v ? v.until : 0);
    return Math.max(0, Math.floor((Date.now() + C.vip.maxDays * DAY - from) / DAY));
  }
  function left(ms) {
    var h = Math.floor(ms / 3600000), d = Math.floor(h / 24);
    return d > 0 ? d + '日' + (h % 24) + '時間' : h > 0 ? h + '時間' + Math.floor(ms % 3600000 / 60000) + '分' : Math.max(1, Math.ceil(ms / 60000)) + '分';
  }
  function at(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }

  function open() {
    if (!api.online) { sfx('deny'); toast('VIPはオンライン版でのみご利用いただけます'); return; }
    if (!api.hasToken()) { BR.account.require(open); return; }
    if (BR.game && BR.game.busy()) { sfx('deny'); return; }
    BR.screens.show('vip');
  }

  function render() {
    var v = vip() || { on: false, until: 0, exp: 0, level: 0 };
    var on = isOn(v), info = V.info(v.exp);
    var lv = $('#vp-level');
    lv.textContent = '';
    lv.appendChild(K.vipBadge(info.level));
    var st = $('#vp-state');
    st.className = 'vp-state' + (on ? ' on' : '');
    st.textContent = on ? '有効 残り' + left(v.until - Date.now()) + '（' + at(v.until) + 'まで）' : '無効';
    // EXP to the next level
    $('#vp-exp').textContent = info.next ? U.fmt(Math.floor(info.exp)) + ' / ' + U.fmt(info.next) : U.fmt(Math.floor(info.exp));
    var pct = info.next ? (info.exp - info.from) / (info.next - info.from) * 100 : 100;
    $('#vp-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('#vp-exp-note').textContent = info.next ? 'VIP' + (info.level + 1) + 'まで あと ' + U.fmt(Math.ceil(info.next - info.exp)) + ' EXP' : 'VIP' + info.level + '（最高レベル）';
    // the days
    var max = room();
    days = Math.max(1, Math.min(days, Math.max(1, max)));
    $('#vp-days-n').textContent = U.fmt(days);
    var cost = V.cost(days, info.level);
    var box = $('#vp-cost');
    box.textContent = '';
    var line = el('div', 'vp-cost-line');
    line.appendChild(el('i', 'ic ic-coin'));
    line.appendChild(el('span', '', C.vip.coins + '枚 × ' + days + '日 ='));
    line.appendChild(el('b', '', U.fmt(cost.coins) + '枚'));
    box.appendChild(line);
    if (cost.back) box.appendChild(el('div', 'vp-back', 'VIP' + C.vip.refund.from + '以上：' + U.fmt(cost.back) + '枚還元'));
    box.appendChild(el('div', 'vp-have', '所持 ' + U.fmt(S.coins) + '枚'));
    var go = $('#vp-go');
    go.textContent = busy ? '処理中…' : on ? days + '日延長する' : 'VIPを有効にする（' + days + '日）';
    go.disabled = busy || max < 1 || S.coins < cost.coins;
    renderTable(info.level, on);
  }

  // what each level gives (the player's own level marked)
  function renderTable(level, on) {
    var t = $('#vp-table');
    t.textContent = '';
    var L = C.vip.levels, n = L.length;
    var head = el('tr');
    head.appendChild(el('th', 'vp-k', ''));
    for (var i = 0; i < n; i++) {
      var th = el('th', 'vp-col' + (i === level ? ' me' + (on ? ' on' : '') : ''));
      th.appendChild(K.vipBadge(i));
      th.appendChild(el('small', '', U.fmt(L[i]) + ' EXP'));
      head.appendChild(th);
    }
    t.appendChild(head);
    var yes = '✓', no = '−';
    var rows = [
      ['友達と稼ぐの経験値', function () { return '×' + C.vip.hubXp; }],
      ['VIPバッジ', function () { return yes; }],
      ['車両VIP割引', function () { return C.vip.carOff + '%OFF'; }],
      ['ガレージ拡張', function () { return C.vip.garageOff + '%OFF'; }],
      ['通話品質', function (l) { return V.tier(l) >= 2 ? '最高' : '向上'; }],
      ['新機能のアーリーアクセス', function () { return yes; }],
      ['限定車', function (l) { return l >= 1 ? 'VIP' + (l === 1 ? '1' : '1〜' + l) : no; }],
      ['ロイヤルコイン還元（1日）', function (l) { return l >= C.vip.refund.from ? C.vip.refund.coins + '枚' : no; }],
      ['バイトの時給', function (l) { return V.wage(l) > 1 ? '×' + V.wage(l).toFixed(1) : no; }],
      ['ULTRA BIG WIN 報酬', function (l) { return V.ultra(l) > 1 ? '×' + V.ultra(l) : no; }]
    ];
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', 'vp-k', r[0]));
      for (var l = 0; l < n; l++) {
        var v = r[1](l);
        tr.appendChild(el('td', 'vp-col' + (l === level ? ' me' + (on ? ' on' : '') : '') + (v === no ? ' no' : ''), v));
      }
      t.appendChild(tr);
    });
    var E = C.vip.exp;
    var foot = el('tr', 'vp-foot');
    var td = el('td', '', 'EXP：カジノで当たる +' + E.win + '・クエストクリア +' + E.quest + '・ULTRA BIG WIN +' + E.ultra + '（VIP有効中）／車を購入 +' + E.car);
    td.colSpan = n + 1;
    foot.appendChild(td);
    t.appendChild(foot);
  }

  function go() {
    if (busy) return;
    var n = days, v = vip(), on = isOn(v);
    var cost = V.cost(n, v ? v.level : 0);
    if (S.coins < cost.coins) { sfx('deny'); toast('ロイヤルコインが足りません'); return; }
    busy = true;
    render();
    api.vipExtend(n).then(function (r) {
      busy = false;
      BR.app.serverBalance(r.me);
      BR.social.setMe(r.me);
      sfx('register');
      if (BR.juice) BR.juice.reward('#vp-go', 3);
      toast((on ? 'VIPを' + n + '日延長しました' : 'VIPが有効になりました（' + n + '日）') + (r.back ? '・ロイヤルコイン ' + r.back + '枚還元' : ''), 3200);
      render();
    }, function (err) {
      busy = false;
      render();
      fail(err);
    });
  }

  // a new VIP state (the account, a spin): the badge, and a level reached
  function set(v) {
    var m = me();
    if (!m || !v) return;
    m.vip = v;
    seen(v);
    BR.social.renderMe();
    if (BR.call && BR.call.quality) BR.call.quality();
    if (BR.screens.current() === 'vip') render();
  }
  function seen(v) {
    if (lastLevel !== null && v.level > lastLevel) {
      sfx('levelUp');
      toast('VIP' + v.level + ' になりました！', 3200, open);
      if (BR.juice) BR.juice.reward('#me-card', 3);
    }
    lastLevel = v.level;
  }

  function init() {
    if (!api.online) return;
    $('#vp-go').addEventListener('click', function () { sfx('click'); go(); });
    $('#vp-minus').addEventListener('click', function () { sfx('click'); days = Math.max(1, days - 1); render(); });
    $('#vp-plus').addEventListener('click', function () { sfx('click'); days = Math.min(Math.max(1, room()), days + 1); render(); });
    $('#vp-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-d]');
      if (!b) return;
      sfx('click');
      days = Number(b.dataset.d);
      render();
    });
    $('#vp-days').addEventListener('click', function () {
      sfx('click');
      BR.screens.numpad({ icon: 'coin', value: days, max: Math.max(1, room()), onOk: function (n) { days = Math.max(1, n); render(); } });
    });
    K.dragScroll($('#vp-right'));
    BR.screens.register('vip', { open: function () { render(); } });
    BR.social.onMe(function (m) {
      if (!m) { lastLevel = null; return; }
      if (m.vip) seen(m.vip);
      if (BR.screens.current() === 'vip') render();
    });
    // the badge goes when the days are over
    clearInterval(timer);
    timer = setInterval(function () {
      var v = vip();
      if (v && v.on && v.until <= Date.now()) { v.on = false; BR.social.renderMe(); }
      if (BR.screens.current() === 'vip') render();
    }, 30000);
  }

  BR.vip = { init: init, open: open, set: set };
})(window.BR = window.BR || {});
