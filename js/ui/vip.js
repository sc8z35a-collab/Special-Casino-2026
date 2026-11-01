/* VIP (js/game/vip.js, server: POST /api/vip/extend): ロイヤルコイン make
   days of it (a day: 24 hours, counted down to the second here), まとめ買い
   packs give free days on top (今だけ特大セール), VIP EXP its level
   (VIP0-VIP3), and what each level gives. The free trial (POST
   /api/vip/trial): VIP3 for 3 days, once, for one who never had VIP; days
   bought during it go on after it at their own level. The badge on one's
   card (and for friends) shows while it is on. DAIZIN, VIP's company, buys
   ロイヤルコイン back for $ (C.vip.buyback, POST /api/coins/sell). */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, S = BR.store.state, C = BR.CONFIG, V = BR.VIP;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;
  var DAY = V.day;

  var days = 1, busy = false, lastLevel = null, timer = 0, trialSeen = 0, sellN = 1, selling = false;
  var cart = {}, mode = 'normal';
  var TRIAL = C.vip.trial;

  function cartItems() { return Object.keys(cart).map(function (days) { return { days: Number(days), qty: cart[days] }; }); }

  function me() { return BR.social.me(); }
  function vip() { var m = me(); return m && m.vip ? m.vip : null; }
  function isOn(v) { return !!v && V.now(v) !== null; }
  function trialOn(v) { return isOn(v) && v.trialUntil > Date.now(); }
  // days that can still be added (VIP reaches `maxDays` ahead at most)
  function room() {
    var v = vip(), from = Math.max(Date.now(), v ? v.until : 0);
    return Math.max(0, Math.floor((Date.now() + C.vip.maxDays * DAY - from) / DAY));
  }
  function at(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function expText(n) {
    var parts = String(Math.round(n * 1000) / 1000).split('.');
    return U.fmt(Number(parts[0])) + (parts[1] ? '.' + parts[1] : '');
  }
  // what is left, to the second: 2日 03:12:45
  function clock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400);
    var hms = pad(Math.floor(s % 86400 / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60);
    return d > 0 ? d + '日 ' + hms : hms;
  }

  function open() {
    if (!api.online) { sfx('deny'); toast('VIPはオンライン版のみです'); return; }
    if (!api.hasToken()) { BR.account.require(open); return; }
    if (BR.game && BR.game.busy()) { sfx('deny'); return; }
    BR.screens.show('vip');
  }

  // the parts that count down every second: the state, the trial's card
  function renderClock() {
    var v = vip() || { on: false, until: 0, exp: 0, level: 0, trialUntil: 0, trial: false };
    var on = isOn(v), trial = trialOn(v), now = Date.now(), info = V.info(v.exp);
    var st = $('#vp-state');
    st.className = 'vp-state' + (trial ? ' on trial' : on ? ' on' : '');
    st.textContent = '';
    if (v.permanent && !(v.until > now)) st.textContent = 'VIP2特典 永続有効';
    else if (!on) st.textContent = '無効';
    else {
      st.appendChild(document.createTextNode((trial ? 'お試し中 残り ' : '有効 残り ')));
      st.appendChild(el('span', 'vp-clock', clock((trial ? v.trialUntil : v.until) - now)));
      st.appendChild(document.createTextNode('（' + at(trial ? v.trialUntil : v.until) + 'まで）'));
      var activeMode = V.modeAt(v.modes, now);
      if (activeMode !== 'normal') st.appendChild(el('b', 'vp-active-mode ' + activeMode, activeMode.toUpperCase() + ' EXP ×' + V.mode(activeMode).multiplier));
    }
    // the free trial: may be had (once), or going on
    var box = $('#vp-trial');
    box.hidden = !v.trial && !trial;
    box.classList.toggle('on', trial);
    $('#vp-trial-go').hidden = !v.trial;
    $('#vp-trial-go').disabled = busy;
    if (v.trial) {
      $('#vp-trial-title').textContent = 'VIP' + TRIAL.level + ' を' + TRIAL.days + '日間 無料でお試し';
      $('#vp-trial-sub').textContent = 'VIPを使ったことがない人だけ・一生に1回。お試しのあとは、ロイヤルコインで追加した日数ぶん VIP' + V.label(info.level) + ' に移ります（追加しなければそのまま終了）';
    } else if (trial) {
      var after = Math.max(0, v.until - v.trialUntil);
      $('#vp-trial-title').textContent = 'VIP' + TRIAL.level + ' お試し中　残り ' + clock(v.trialUntil - now);
      $('#vp-trial-sub').textContent = after > 0
        ? 'お試しのあと、追加した ' + clock(after) + ' は VIP' + V.label(info.level) + ' で続きます'
        : 'ロイヤルコインで日数を追加すると、お試しのあと VIP' + V.label(info.level) + ' で続きます（追加しなければお試しで終了）';
    }
  }

  function render() {
    var v = vip() || { on: false, until: 0, exp: 0, level: 0, trialUntil: 0, trial: false };
    var on = isOn(v), info = V.info(v.exp), now = V.now(v);
    var lv = $('#vp-level');
    lv.textContent = '';
    lv.appendChild(K.vipBadge(V.badge(v) === null ? info.level : V.badge(v)));
    renderClock();
    renderPacks(info.level);
    renderSell();
    // EXP to the next level
    $('#vp-exp').textContent = info.next ? expText(info.exp) + ' / ' + U.fmt(info.next) : expText(info.exp);
    var pct = info.next ? (info.exp - info.from) / (info.next - info.from) * 100 : 100;
    $('#vp-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('#vp-exp-note').textContent = info.next ? 'VIP' + V.label(info.level + 1) + 'まで あと ' + U.fmt(Math.ceil(info.next - info.exp)) + ' EXP' : 'VIP' + V.label(info.level) + '（最高レベル）';
    // the days
    var max = room();
    days = Math.max(1, Math.min(days, Math.max(1, max)));
    $('#vp-days-n').textContent = U.fmt(days);
    var quote = V.cart(cartItems(), info.level, mode);
    var cost = quote || V.cost(days, info.level, mode);
    Array.prototype.forEach.call(document.querySelectorAll('#vp-modes [data-mode]'), function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
      b.disabled = busy;
    });
    var schedule = $('#vp-mode-schedule');
    schedule.textContent = '';
    if (mode !== 'normal') schedule.appendChild(el('div', '', mode.toUpperCase() + ' EXP ×' + V.mode(mode).multiplier + '：' + at(Math.max(Date.now(), v.until)) + '〜' + at(Math.max(Date.now(), v.until) + (quote ? quote.days : days) * DAY)));
    (v.modes || []).filter(function (p) { return p.end > Date.now(); }).forEach(function (p) {
      schedule.appendChild(el('small', '', '購入済み ' + p.mode.toUpperCase() + '：' + at(p.start) + '〜' + at(p.end)));
    });
    $('#vp-minus').disabled = busy || !!quote || days <= 1;
    $('#vp-plus').disabled = busy || !!quote || days >= max;
    $('#vp-cart-clear').hidden = !quote;
    $('#vp-cart-clear').disabled = busy;
    var box = $('#vp-cost');
    box.textContent = '';
    var line = el('div', 'vp-cost-line');
    line.appendChild(el('i', 'ic ic-coin'));
    if (!quote) line.appendChild(el('span', '', C.vip.coins + '枚 × ' + days + '日' + (mode === 'normal' ? '' : ' ＋ ' + V.mode(mode).coins + '枚') + ' ='));
    line.appendChild(el('b', '', U.fmt(cost.coins) + '枚'));
    box.appendChild(line);
    if (cost.back) box.appendChild(el('div', 'vp-back', 'VIP' + C.vip.refund.from + '以上：' + U.fmt(cost.back) + '枚還元'));
    if (quote) box.appendChild(el('div', 'vp-cart-summary', '合計' + quote.days + '日（おまけ' + quote.bonus + '日を含む）'));
    if (quote && quote.resetTickets) box.appendChild(el('div', 'vp-ticket-bonus', '5時間クエストリセット券 ' + quote.resetTickets + '枚付き'));
    var go = $('#vp-go');
    go.textContent = '';
    go.appendChild(el('span', 'vp-go-label', busy ? '処理中…' : quote ? '購入する' : '購入する（' + days + '日）'));
    if (quote) {
      var badges = el('span', 'vp-cart-badges');
      quote.packs.forEach(function (p) { badges.appendChild(el('span', 'vp-cart-badge', p.days + '日プラン ×' + p.qty)); });
      go.appendChild(badges);
    }
    go.disabled = busy || max < (quote ? quote.days : days) || S.coins < cost.coins;
    renderTable(on && now !== null ? now : info.level, on, trialOn(v) ? info.level : null);
  }

  // まとめ買い: each pack, how much more it gives, what it costs (the best deal marked)
  function renderPacks(level) {
    var packs = V.packs();
    $('#vp-packs').hidden = !packs.length;
    if (!packs.length) return;
    $('#vp-packs-sale').textContent = C.vip.packs.sale;
    var list = $('#vp-packs-list'), best = 0, max = room(), quote = V.cart(cartItems(), level);
    packs.forEach(function (p) { best = Math.max(best, V.deal(p)); });
    list.textContent = '';
    packs.forEach(function (p) {
      var cost = V.cost(p.days, level);
      var b = el('button', 'vp-pack' + (V.deal(p) === best ? ' best' : ''));
      b.type = 'button';
      b.dataset.pack = p.days;
      b.appendChild(el('span', 'vp-pack-deal', V.deal(p) + '%お得'));
      var d = el('span', 'vp-pack-days', String(p.days));
      d.appendChild(el('small', '', '日'));
      b.appendChild(d);
      b.appendChild(el('span', 'vp-pack-bonus', '+' + p.bonus + '日 おまけ'));
      if (p.resetTickets) b.appendChild(el('span', 'vp-pack-ticket', '5時間リセット券' + p.resetTickets + '枚付き'));
      var price = el('span', 'vp-pack-price');
      price.appendChild(el('i', 'ic ic-coin'));
      price.appendChild(document.createTextNode(U.fmt(cost.coins) + '枚'));
      b.appendChild(price);
      b.disabled = busy || max < (quote ? quote.days : 0) + p.days + p.bonus;
      b.classList.toggle('short', S.coins < cost.coins);
      if (cart[p.days]) b.appendChild(el('span', 'vp-pack-in-cart', 'カート：' + cart[p.days]));
      list.appendChild(b);
    });
  }
  function addPack(n) {
    var p = V.pack(n), v = vip();
    if (!p || busy) return;
    var cost = V.cost(p.days, v ? v.level : 0);
    K.confirmBox(function (box) {
      box.appendChild(document.createTextNode('VIP ' + p.days + '日プランをカートに追加しますか？'));
      box.appendChild(el('small', 'confirm-sub', 'おまけ' + p.bonus + '日・ロイヤルコイン' + cost.coins + '枚'
        + (p.resetTickets ? '・5時間クエストリセット券' + p.resetTickets + '枚付き' : '') + '。購入ボタンでまとめて購入できます。'));
    }, 'はい', 'いいえ').then(function (ok) {
      if (!ok) return;
      var current = V.cart(cartItems(), v ? v.level : 0);
      if ((current ? current.days : 0) + p.days + p.bonus > room()) { toast('VIPの追加日数の上限を超えます'); return; }
      cart[p.days] = (cart[p.days] || 0) + 1;
      render();
    });
  }
  // the free trial, once
  function startTrial() {
    var v = vip();
    if (!v || !v.trial || busy) return;
    K.confirmBox(function (box) {
      box.appendChild(document.createTextNode('VIP' + TRIAL.level + ' を ' + TRIAL.days + '日間 無料で試しますか？'));
      box.appendChild(el('small', 'confirm-sub', '一生に1回だけです。' + TRIAL.days + '日（' + TRIAL.days * 24 + '時間）たつと終わり、ロイヤルコインで追加した日数があれば VIP' + V.label(V.level(v.exp)) + ' で続きます。'));
    }, '無料で試す').then(function (ok) {
      if (!ok) return;
      busy = true;
      render();
      api.vipTrial().then(function (r) {
        busy = false;
        BR.app.serverBalance(r.me);
        BR.social.setMe(r.me);
        sfx('levelUp');
        if (BR.juice) BR.juice.reward('#vp-trial', 3);
        toast('VIP' + TRIAL.level + ' のお試しが始まりました（' + TRIAL.days + '日間）', 3200);
        render();
      }, function (err) {
        busy = false;
        render();
        fail(err);
      });
    });
  }
  // the trial over (once each): on at the player's own level for the days bought, or over
  function trialOver(v) {
    if (!v || !(v.trialUntil > 0) || v.trialUntil > Date.now() || trialSeen === v.trialUntil) return;
    var key = 'two-state-vip/trial-over/' + (me() ? me().id : 0);
    trialSeen = v.trialUntil;
    try { if (Number(localStorage.getItem(key)) === v.trialUntil) return; localStorage.setItem(key, String(v.trialUntil)); } catch (e) { /* once in this page */ }
    if (Date.now() - v.trialUntil > 7 * DAY) return;
    toast(v.until > Date.now() ? 'VIPのお試しが終わりました。追加した日数ぶん VIP' + V.label(V.level(v.exp)) + ' で続きます' : 'VIPのお試しが終わりました', 4200, open);
  }

  // what each level gives (the player's own level marked; `own`: during the
  // trial, the level of their EXP)
  function renderTable(level, on, own) {
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
      ['車両VIP割引', function (l) { return V.carDiscount(l) + '%OFF'; }],
      ['ガレージ拡張', function () { return C.vip.garageOff + '%OFF'; }],
      ['通話品質', function (l) { return l >= 4 ? 'ULTRA 256kbps' : V.tier(l) >= 2 ? '最高' : '向上'; }],
      ['新機能のアーリーアクセス', function (l) { return l >= 4 ? '最高等級' : yes; }],
      ['限定車', function (l) { return l >= 1 ? 'VIP' + (l === 1 ? '1' : '1〜' + V.label(l)) : no; }],
      ['ロイヤルコイン還元（1日）', function (l) { return l >= C.vip.refund.from ? C.vip.refund.coins + '枚' : no; }],
      ['バイトの時給', function (l) { return V.wage(l) > 1 ? '×' + V.wage(l).toFixed(1) : no; }],
      ['VIP3.1限定車（準備中）', function (l) { return l >= 4 ? '解放' : no; }],
      ['VIP3.1特別ログイン（内容準備中）', function (l) { return l >= 4 ? '最大60日' : no; }],
      ['VIP終了後の永続特典', function (l) { return l >= 5 ? 'VIP2まで' : no; }],
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
    var td = el('td', '', 'EXP：カジノで当たる +' + E.win + '・クエストクリア +' + E.quest + '・ULTRA BIG WIN +' + E.ultra + '（VIP特典有効中）／車を購入 +' + E.car);
    td.colSpan = n + 1;
    foot.appendChild(td);
    t.appendChild(foot);
    if (own !== null && own !== undefined) {
      var tr = el('tr', 'vp-foot');
      var tt = el('td', '', 'お試し中は VIP' + V.label(level) + ' の特典が使えます（ロイヤルコイン還元だけは自分のレベル VIP' + V.label(own) + ' で数えます）');
      tt.colSpan = n + 1;
      tr.appendChild(tt);
      t.appendChild(tr);
    }
    // for now everybody's calls are better than VIP3's
    if (V.boost() > V.tier(3)) {
      var now = el('tr', 'vp-foot');
      var b = el('td', '', '今だけ：VIPでなくても、全員の通話が VIP3 より高い音質（' + V.kbps(V.boost()) + 'kbps）になっています');
      b.colSpan = n + 1;
      now.appendChild(b);
      t.appendChild(now);
    }
  }

  // DAIZINの買い取り: how many of the coins, and what they bring
  function renderSell() {
    var B = C.vip.buyback, have = Math.max(0, S.coins || 0), top = Math.max(1, Math.min(have, B.max));
    sellN = Math.max(1, Math.min(sellN, top));
    $('#vp-sell-rate').textContent = '1枚 $' + U.fmt(B.each) + '・所持 ' + U.fmt(have) + '枚';
    $('#vp-sell-n').textContent = U.fmt(sellN);
    var range = $('#vp-sell-range');
    range.max = String(top);
    range.value = String(sellN);
    range.disabled = selling || have < 2;
    var go = $('#vp-sell-go');
    go.textContent = have ? U.fmt(sellN) + '枚を $' + U.fmt(sellN * B.each) + ' で買い取ってもらう' : 'ロイヤルコインがありません';
    go.disabled = selling || have < 1;
    $('#vp-sell-minus').disabled = selling || sellN <= 1;
    $('#vp-sell-plus').disabled = selling || sellN >= top;
    $('#vp-sell-all').disabled = selling || have < 1;
  }
  function sell() {
    var B = C.vip.buyback, n = sellN;
    if (selling) return;
    if ((S.coins || 0) < n) { sfx('deny'); toast('ロイヤルコインが足りません'); return; }
    K.confirmBox(function (box) {
      box.appendChild(el('b', '', 'ロイヤルコイン' + U.fmt(n) + '枚をDAIZINに買い取ってもらいますか？'));
      box.appendChild(el('small', 'confirm-sub', '受け取り：$' + U.fmt(n * B.each) + '（1枚 $' + U.fmt(B.each) + '）・買い取ったコインは戻りません'));
    }, '買い取ってもらう', 'やめる').then(function (ok) {
      if (!ok) return;
      selling = true;
      renderSell();
      api.sellCoins(n).then(function (r) {
        selling = false;
        BR.app.serverBalance(r.me);
        BR.social.setMe(r.me);
        sfx('money');
        toast('DAIZINがロイヤルコイン' + U.fmt(r.sold) + '枚を $' + U.fmt(r.paid) + ' で買い取りました', 3600);
        sellN = 1;
        render();
      }, function (err) {
        selling = false;
        renderSell();
        fail(err);
      });
    });
  }

  function go() {
    if (busy) return;
    var n = days, v = vip(), items = cartItems();
    var quote = V.cart(items, v ? v.level : 0, mode);
    var cost = quote || V.cost(n, v ? v.level : 0, mode);
    if (S.coins < cost.coins) { sfx('deny'); toast('ロイヤルコインが足りません'); return; }
    busy = true;
    render();
    (quote ? api.vipCart(items, mode) : api.vipExtend(n, mode)).then(function (r) {
      busy = false;
      cart = {};
      BR.app.serverBalance(r.me);
      BR.social.setMe(r.me);
      sfx('register');
      if (BR.juice) BR.juice.reward('#vp-go', 3);
      if (!BR.reward3d || !BR.reward3d.play('vip', '+' + r.days + '日' + (r.mode !== 'normal' ? '・' + r.mode.toUpperCase() : ''))) {
        if (BR.juice) BR.juice.banner('VIP EXTENDED!', 'level', 2200, '+' + r.days + '日');
      }
      toast('VIPを' + r.days + '日分追加しました' + (r.back ? '・ロイヤルコイン ' + r.back + '枚還元' : '')
        + (r.resetTickets ? '・5時間リセット券' + r.resetTickets + '枚を獲得' : ''), 4000);
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
      toast('VIP' + V.label(v.level) + ' になりました！', 3200, open);
      if (BR.juice) BR.juice.reward('#me-card', 3);
    }
    lastLevel = v.level;
  }

  function init() {
    if (!api.online) return;
    $('#vp-modes').addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]');
      if (!b || busy) return;
      mode = b.dataset.mode; sfx('click'); render();
    });
    $('#vp-go').addEventListener('click', function () { sfx('click'); go(); });
    $('#vp-minus').addEventListener('click', function () { sfx('click'); days = Math.max(1, days - 1); render(); });
    $('#vp-plus').addEventListener('click', function () { sfx('click'); days = Math.min(Math.max(1, room()), days + 1); render(); });
    $('#vp-cart-clear').addEventListener('click', function () { if (busy) return; sfx('click'); cart = {}; render(); });
    $('#vp-trial-go').addEventListener('click', function () { sfx('click'); startTrial(); });
    $('#vp-sell-minus').addEventListener('click', function () { sfx('click'); sellN = Math.max(1, sellN - 1); renderSell(); });
    $('#vp-sell-plus').addEventListener('click', function () { sfx('click'); sellN += 1; renderSell(); });
    $('#vp-sell-all').addEventListener('click', function () { sfx('click'); sellN = Math.max(1, Math.min(S.coins || 0, C.vip.buyback.max)); renderSell(); });
    $('#vp-sell-range').addEventListener('input', function (e) { sellN = Number(e.target.value) || 1; renderSell(); });
    $('#vp-sell-go').addEventListener('click', function () { sfx('click'); sell(); });
    $('#vp-packs-list').addEventListener('click', function (e) {
      var b = e.target.closest('[data-pack]');
      if (!b || b.disabled) return;
      sfx('click');
      addPack(Number(b.dataset.pack));
    });
    K.dragScroll($('#vp-right'));
    K.dragScroll($('#vp-left'));
    BR.screens.register('vip', { open: function () { render(); BR.clock.drop(timer); timer = BR.clock.every(renderClock, 1000); }, close: function () { BR.clock.drop(timer); timer = 0; } });
    BR.social.onMe(function (m) {
      updateVip(); scheduleBoundary();
      if (!m) { lastLevel = null; cart = {}; mode = 'normal'; return; }
      if (m.vip) { seen(m.vip); trialOver(m.vip); }
      if (BR.screens.current() === 'vip') render();
    });
    // the badge goes when the days are over (and turns to one's own level when
    // the trial is); on this screen the time left counts down every second
    var phase = '', boundaryTimer = 0;
    function updateVip() {
      var v = vip();
      if (v) v.on = V.now(v) !== null;
      // (on, off, or in the trial: a change shows everywhere at once)
      var now = v ? (trialOn(v) ? 'trial' : isOn(v) ? 'on/' + V.modeAt(v.modes, Date.now()) + '/' + String(v.until > Date.now()) : 'off') : '';
      var changed = now !== phase;
      phase = now;
      if (changed) { BR.social.renderMe(); if (BR.call && BR.call.quality) BR.call.quality(); }
      if (v) trialOver(v);
      if (BR.screens.current() === 'vip') { if (changed) render(); else renderClock(); }
    }
    function scheduleBoundary() {
      clearTimeout(boundaryTimer);
      var v = vip(), now = Date.now(), ends = v ? [v.until, v.trialUntil].concat((v.modes || []).flatMap(function (m) { return [m.start, m.end]; })) : [];
      var next = Math.min.apply(Math, ends.filter(function (t) { return t > now; }));
      if (next < Infinity) boundaryTimer = setTimeout(function () { updateVip(); scheduleBoundary(); }, Math.min(2147483000, next - now + 30));
    }
    updateVip(); scheduleBoundary();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { updateVip(); scheduleBoundary(); } });
  }

  BR.vip = { init: init, open: open, set: set };
})(window.BR = window.BR || {});
