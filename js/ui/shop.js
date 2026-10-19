/* Shop (on the board screen; always on sale like the icons), 所有 (all one
   owns: Shop items, cars, icons) and the お守り加護 on the slot screen: one
   tap before a spin switches it on, and the next losing spin gives back
   5-20 % of the lost tokens (now and then all of them). Shop items can be
   given to friends. Prices are in $. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;

  var sale = null;      // today's Shop prices from the server: { day, until, items: [{ id, price, salePrice, pct, max }] }
  var qty = {};         // id -> how many to buy
  var busy = false;

  function catalog() { return BR.CONFIG.shop; }
  function info(id) {
    var list = catalog();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function saleOf(id) {
    if (sale) for (var i = 0; i < sale.items.length; i++) if (sale.items[i].id === id) return sale.items[i];
    var it = info(id), day = U.utcDay();
    return { id: id, price: it.price, salePrice: BR.sale.price(it, day), pct: BR.sale.pct(id, day), max: it.max };
  }
  function me() { return BR.social.me(); }
  function owned(id) { var m = me(); return (m && m.items && m.items[id]) || 0; }
  function picture(id) { return BR.SOCIAL_IMG.items[id] || ''; }
  function money(n) { return '$' + U.fmt(n); }
  function onBoard(view) { return BR.screens.current() === 'board' && $('#pane-' + view).classList.contains('active'); }

  function setMe(m) {
    if (!m) return;
    BR.social.setMe(m);
    renderCharm();
    if (onBoard('shop')) renderShop();
    if (onBoard('items')) renderItems();
  }

  /* ------------------------------------------------------------ Shop --- */
  var LINES = {
    omamori: ['回す前にワンタップで発動', '負けたスピンの損を 5〜20% 軽減', 'まれに 100% 軽減（大吉）']
  };

  function showShop() {
    renderShop();
    api.items().then(function (r) {
      sale = r.shop;
      var m = me();
      if (m) { m.items = r.items; m.charm = r.charm; }
      if (onBoard('shop')) renderShop();
      renderCharm();
    }, function () {});
  }

  function renderShop() {
    var grid = $('#shop-grid');
    grid.textContent = '';
    catalog().forEach(function (it) {
      var s = saleOf(it.id), have = owned(it.id), room = Math.max(0, it.max - have);
      var n = Math.max(1, Math.min(qty[it.id] || 1, room || 1));
      qty[it.id] = n;
      var card = el('div', 'shop-card');
      var stage = el('div', 'shop-stage');
      var pic = el('span', 'shop-pic');
      pic.style.backgroundImage = 'url("' + picture(it.id) + '")';
      stage.appendChild(pic);
      if (room > 0) stage.appendChild(el('i', 'sale-badge'));
      card.appendChild(stage);
      var body = el('div', 'shop-body');
      body.appendChild(el('div', 'shop-brand', 'SHOP'));
      body.appendChild(el('h3', 'shop-name', it.name));
      var ul = el('ul', 'shop-lines');
      (LINES[it.id] || []).forEach(function (t) { ul.appendChild(el('li', '', t)); });
      body.appendChild(ul);
      var price = el('div', 'shop-price');
      price.appendChild(el('s', '', money(s.price)));
      price.appendChild(K.amountEl(s.salePrice, 'dollars', 'shop-now'));
      price.appendChild(el('em', '', '-' + s.pct + '%'));
      price.appendChild(el('small', '', '/ 個'));
      body.appendChild(price);
      body.appendChild(el('div', 'shop-own', '所持 ' + have + ' / ' + it.max + '個'));
      var row = el('div', 'shop-buy-row');
      var minus = el('button', 'sq-btn minus');
      minus.appendChild(el('i'));
      minus.disabled = busy || n <= 1;
      minus.addEventListener('click', function () { qty[it.id] = Math.max(1, n - 1); sfx('betDown'); renderShop(); });
      var count = el('div', 'hud-box shop-qty', n + '個');
      var plus = el('button', 'sq-btn plus');
      plus.appendChild(el('i'));
      plus.disabled = busy || n >= room;
      plus.addEventListener('click', function () { qty[it.id] = Math.min(room, n + 1); sfx('betUp'); renderShop(); });
      row.appendChild(minus);
      row.appendChild(count);
      row.appendChild(plus);
      var buyBtn = el('button', 'act-btn gold shop-buy', room > 0 ? '購入する（' + money(s.salePrice * n) + '）' : '上限まで持っています');
      buyBtn.disabled = busy || room <= 0;
      buyBtn.classList.toggle('short', S.dollars < s.salePrice * n);
      buyBtn.addEventListener('click', function () { sfx('click'); buy(it, n); });
      row.appendChild(buyBtn);
      body.appendChild(row);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  function buy(it, n) {
    var s = saleOf(it.id);
    if (busy) return;
    if (S.dollars < s.salePrice * n) { sfx('deny'); toast('$が足りません（' + money(s.salePrice * n) + ' 必要です）'); return; }
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode(it.name + ' ×' + n + ' を'));
      p.appendChild(K.amountEl(s.salePrice * n, 'dollars', 'confirm-amt'));
      p.appendChild(document.createTextNode('で購入しますか？'));
      p.appendChild(el('small', 'confirm-sub', 'セール中 ' + s.pct + '%OFF（通常 ' + money(s.price) + ' / 個）'));
    }, '購入する').then(function (ok) {
      if (!ok) return;
      busy = true;
      renderShop();
      api.buyItem(it.id, n, s.salePrice).then(function (r) {
        BR.app.serverBalance(r.me);
        setMe(r.me);
        sfx('purchase');
        toast(it.name + ' ×' + n + ' を購入しました！スロット画面からワンタップで使えます', 3600);
        if (BR.juice) BR.juice.reward('#pane-shop .shop-pic', 2);
      }, function (err) {
        if (err.code === 'price_changed' && err.extra.itemShop) sale = err.extra.itemShop;
        fail(err);
      }).then(function () {
        busy = false;
        if (onBoard('shop')) renderShop();
      });
    });
  }

  /* ------------------------------------------------------------ 所有 --- */
  // 所有 (in the Shop tab): the items one owns, nothing else
  function showItems() {
    renderItems();
    api.items().then(function (r) {
      var m = me();
      if (m) { m.items = r.items; m.charm = r.charm; }
      sale = r.shop;
      if (onBoard('items')) renderItems();
      renderCharm();
    }, function () {});
  }

  function renderItems() {
    var box = $('#items-list');
    box.textContent = '';
    var m = me();
    var any = false;
    catalog().forEach(function (it) {
      var n = owned(it.id), active = it.id === BR.CONFIG.charm.item && m && m.charm;
      if (!n && !active) return;
      any = true;
      var row = el('div', 'item-row');
      var pic = el('span', 'item-pic');
      pic.style.backgroundImage = 'url("' + picture(it.id) + '")';
      row.appendChild(pic);
      var mid = el('div', 'item-mid');
      mid.appendChild(el('div', 'item-name', it.name));
      mid.appendChild(el('div', 'item-sub', '×' + n + '（最大' + it.max + '個）' + (active ? '　＋ 発動中 1' : '')));
      row.appendChild(mid);
      var give = el('button', 'act-btn item-give');
      give.appendChild(K.icon('gift'));
      give.appendChild(el('span', '', 'フレンドに譲る'));
      give.disabled = !n;
      give.addEventListener('click', function () { sfx('click'); chooseFriend(it); });
      row.appendChild(give);
      box.appendChild(row);
    });
    if (!any) box.appendChild(el('div', 'empty items-empty', 'まだアイテムを持っていません。Shop で買えます。'));
  }

  // giving: which friend, how many
  function chooseFriend(it) {
    var have = BR.social.friendsList();
    (have ? Promise.resolve(have) : BR.social.loadFriends().then(function (r) { return r.friends; })).then(function (list) {
      BR.cars.pickDialog('誰に譲りますか？', list, function (row, f) {
        var av = K.avatarEl(f);
        av.appendChild(K.presence(f.online));
        row.appendChild(av);
        row.appendChild(el('span', 'pick-name uname', f.name));
      }, function (f) { giveTo(f, it); }, 'まだフレンドがいません。\nフレンドになるとアイテムを譲れます。');
    }).catch(fail);
  }

  // from a friend's profile
  function giveFrom(user) {
    var list = catalog().filter(function (it) { return owned(it.id) > 0; });
    if (!list.length) { sfx('deny'); toast('譲れるアイテムがありません。Shop で買えます', 3000); return; }
    giveTo(user, list[0]);
  }

  function giveTo(user, it) {
    var have = owned(it.id);
    if (!have) return;
    var ask = have === 1 ? Promise.resolve(1) : new Promise(function (resolve) {
      BR.screens.numpad({ icon: 'gift', value: 1, max: have, onOk: function (n) { resolve(n); } });
    });
    ask.then(function (n) {
      if (!(n > 0)) return;
      K.confirmBox(function (p) {
        p.appendChild(K.nameSpan(user.name));
        p.appendChild(document.createTextNode('さんに ' + it.name + ' ×' + n + ' を譲りますか？'));
        p.appendChild(el('small', 'confirm-sub', '譲ったアイテムは相手の所有に移ります。取り消せません。'));
      }, '譲る').then(function (ok) {
        if (!ok) return;
        api.giveItem(user.id, it.id, n).then(function (r) {
          setMe(r.me);
          BR.social.onMsg(r.message);
          sfx('purchase');
          toast(user.name + 'さんに ' + it.name + ' ×' + n + ' を譲りました', 3200);
          if (BR.juice) BR.juice.reward(null, 1);
        }).catch(fail);
      });
    });
  }

  /* ------------------------------------------------------------ お守り加護 (slot screen) --- */
  function renderCharm() {
    var btn = $('#btn-charm');
    var m = me();
    var show = api.online && !!m && !BR.watch.active();
    btn.hidden = !show;
    if (!show) return;
    var n = owned(BR.CONFIG.charm.item);
    $('#charm-count').textContent = n;
    btn.classList.toggle('on', !!m.charm);
    btn.classList.toggle('none', !n && !m.charm);
    $('#charm-label').textContent = m.charm ? '発動中' : 'お守り加護';
  }

  function useCharm() {
    var m = me();
    if (!m) return;
    if (m.charm) { sfx('click'); toast('お守り加護 発動中：次に負けたスピンで守ってくれます', 3000); return; }
    if (BR.game.busy() || BR.game.auto) {
      sfx('deny');
      toast('お守り加護はスロットを回す前にだけ使えます', 3000);
      return;
    }
    if (!owned(BR.CONFIG.charm.item)) {
      sfx('deny');
      toast('お守り加護を持っていません。Shop で買えます', 3000);
      setTimeout(function () { if (!BR.game.busy()) BR.social.open('shop'); }, 700);
      return;
    }
    if (busy) return;
    busy = true;
    api.charm().then(function (r) {
      setMe(r.me);
      sfx('charmOn');
      var b = $('#btn-charm');
      b.classList.remove('lit');
      void b.offsetWidth;
      b.classList.add('lit');
      if (BR.juice) {
        var p = BR.juice.at(b);
        BR.juice.ring(p.x, p.y, { r0: 30, r1: 220, dur: 0.6, w: 8, color: 'white' });
        BR.juice.stars(p.x, p.y, { n: 6, r: 110, size: 80 });
        BR.juice.sparks(p.x, p.y, { n: 16, speed: 420, life: 0.9, g: -120, color: 'gold' });
      }
      toast('お守り加護を使いました！次に負けたスピンで守ってくれます', 3200);
    }, fail).then(function () { busy = false; });
  }

  // A spin result: the お守り加護 gave tokens back (shown once the reels stop).
  function charmSaved(res, where) {
    if (!res || !res.charm) return;
    var c = res.charm, full = c.pct >= 100;
    sfx('charmSave', full);
    var layer = $('#fx-hit').parentNode;
    var pop = el('div', 'charm-pop' + (full ? ' full' : ''));
    pop.appendChild(el('i', 'charm-pic'));
    var t = el('div', 'charm-pop-text');
    t.appendChild(el('b', '', full ? '大吉！お守り加護' : 'お守り加護'));
    t.appendChild(el('span', '', (full ? '100%' : c.pct + '%') + ' 軽減　+' + U.fmt(c.back)));
    pop.appendChild(t);
    (where || layer).appendChild(pop);
    setTimeout(function () { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 2600);
    // the saved tokens: light out of the charm, and they fly back into the wallet
    if (BR.juice) setTimeout(function () { if (pop.parentNode) BR.juice.reward(pop.querySelector('.charm-pic'), full ? 3 : 1); }, 250);
  }

  // my spin: the server says whether the お守り加護 is still on
  function afterSpin(r) {
    var m = me();
    if (!m || typeof r.charm !== 'boolean') return;
    if (m.charm !== r.charm) { m.charm = r.charm; renderCharm(); }
  }

  // the friend I watch switched theirs on (or it was used up)
  function watchedCharm(on) { $('#screen-slot').classList.toggle('watched-charm', !!on); }

  function init() {
    $('#btn-charm').addEventListener('click', useCharm);
    if (!api.online) return;
    BR.live.on('hello', function (h) { if (h.itemShop) sale = h.itemShop; setTimeout(renderCharm, 0); });
    BR.live.on('items', function (e) {
      var m = me();
      if (m) m.items = e.items;
      renderCharm();
      if (onBoard('items')) renderItems();
      if (onBoard('shop')) renderShop();
    });
  }

  BR.shop = {
    init: init,
    showShop: showShop,
    showItems: showItems,
    setSale: function (s) { if (s) sale = s; },
    renderCharm: renderCharm,
    charmSaved: charmSaved,
    afterSpin: afterSpin,
    watchedCharm: watchedCharm,
    giveFrom: giveFrom
  };
})(window.BR = window.BR || {});
