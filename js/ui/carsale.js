/* Selling a car to a friend in the chat (server/core/api.js, POST
   /api/cars/offer …): 「車を売る」 picks one of one's cars and its price
   (BR.CONFIG.carResale: % of what one paid for it); the offer is a card in
   the chat the friend buys from (the seller can take it back), and a sold
   car leaves the seller a card to tap for the money. A car sold this way is
   a 中古車 for good. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, S = BR.store.state;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;

  var st = { user: null, cars: [], car: null, value: 0, busy: false };
  var working = {};   // message id -> its action is running

  function model(id) {
    var list = BR.CONFIG.cars;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function carName(id) { var m = model(id); return m ? m.name : '車'; }
  function picture(id) { return BR.SOCIAL_IMG.cars[id] || ''; }
  function info(m) {
    try { var b = JSON.parse(m.text || '{}'); return b && typeof b === 'object' ? b : {}; } catch (e) { return {}; }
  }
  function money(n) { return '$' + U.fmt(n); }
  // what a car can be sold for: { base: what was paid, min, max }
  function range(c) {
    var R = BR.CONFIG.carResale, base = c.paid || (model(c.model) || { price: 0 }).price;
    return { base: base, min: Math.ceil(base * R.min / 100), max: Math.floor(base * R.max / 100) };
  }
  function usedTag() { return el('span', 'used-tag', '中古車'); }
  function carPic(id, cls) {
    var p = el('span', cls || 'gift-car');
    var src = picture(id);
    if (src) p.style.backgroundImage = 'url("' + src + '")';
    return p;
  }
  function nameRow(id, used) {
    var n = el('div', 'gift-name', carName(id));
    if (used) n.appendChild(usedTag());
    return n;
  }

  /* ------------------------------------------------------------ 車を売る --- */
  function open(user, carId) {
    if (!user || st.busy) return;
    api.cars().then(function (r) {
      var cars = r.cars.filter(function (c) { return !c.rent && !c.offer; });
      if (!cars.length) {
        sfx('deny');
        toast(r.cars.length ? '売れる車がありません（貸し出し中・販売中は不可）' : 'Garage に車がありません', 3200);
        return;
      }
      st.user = { id: user.id, name: user.name };
      st.cars = cars;
      pick(cars.filter(function (c) { return c.id === carId; })[0] || cars[0]);
      $('#cs-name').textContent = user.name;
      K.showModal('carsale');
    }).catch(fail);
  }
  function pick(c) {
    st.car = c;
    st.value = range(c).base;
    render();
  }
  function setValue(v) {
    var r = range(st.car);
    st.value = Math.max(r.min, Math.min(r.max, Math.round(v)));
    render();
  }
  function render() {
    var list = $('#cs-cars');
    list.textContent = '';
    st.cars.forEach(function (c) {
      var b = el('button', 'cs-car' + (c === st.car ? ' on' : ''));
      b.type = 'button';
      b.appendChild(carPic(c.model, 'cs-pic'));
      b.appendChild(nameRow(c.model, c.used));
      b.appendChild(el('span', 'cs-paid', '購入価格 ' + money(range(c).base)));
      b.addEventListener('click', function () { if (c !== st.car) { sfx('click'); pick(c); } });
      list.appendChild(b);
    });
    var r = range(st.car);
    $('#cs-value').textContent = U.fmt(st.value);
    var pct = r.base ? Math.round((st.value / r.base - 1) * 100) : 0;
    $('#cs-pct').textContent = (pct > 0 ? '+' : '') + pct + '%';
    $('#cs-pct').className = 'cs-pct' + (pct > 0 ? ' up' : pct < 0 ? ' down' : '');
    var range$ = $('#cs-range');
    range$.min = String(r.min);
    range$.max = String(r.max);
    range$.step = String(Math.max(1, Math.round(r.base / 100)));
    range$.value = String(st.value);
    $('#cs-note').textContent = money(r.min) + '〜' + money(r.max);
    $('#cs-go').disabled = st.busy;
  }
  function go() {
    if (st.busy || !st.car || !st.user) return;
    var u = st.user, c = st.car, price = st.value;
    st.busy = true;
    render();
    api.carOffer(u.id, c.id, price).then(function (r) {
      st.busy = false;
      K.closeModal('carsale');
      sfx('send');
      BR.social.onMsg(r.message);
      toast(u.name + 'さんに ' + carName(c.model) + ' を ' + money(price) + ' で出品しました', 3200);
      BR.cars.changed();
    }, function (err) {
      st.busy = false;
      render();
      fail(err);
    });
  }

  /* ------------------------------------------------------------ the cards --- */
  // the offer: the friend buys it, the seller can take it back
  function offerEl(m, mine) {
    var b = info(m), state = m.state || 'open', on = state === 'open';
    var node = el('div', 'msg xfer car-deal ' + (mine ? 'mine' : 'theirs') + ' st-' + state);
    node.dataset.pid = m.id;
    var card = el('div', 'xfer-card gift-card');
    card.appendChild(el('div', 'xfer-label', mine ? '車を出品しました' : '車の販売'));
    card.appendChild(carPic(b.model));
    card.appendChild(nameRow(b.model, b.used));
    card.appendChild(K.amountEl(m.amount, 'dollars', 'xfer-amount'));
    if (on) {
      var act = el('button', 'deal-act' + (mine ? '' : ' gold'), working[m.id] ? '…' : mine ? '出品を取り消す' : '購入する');
      act.type = 'button';
      act.disabled = !!working[m.id];
      act.addEventListener('click', function () { sfx('click'); if (mine) cancel(m); else buy(m); });
      card.appendChild(act);
    } else {
      card.appendChild(el('div', 'pr-state', state === 'sold' ? '売却済み' : '取り消し済み'));
    }
    node.appendChild(card);
    return node;
  }
  // sold: the seller taps it for the money
  function soldEl(m, mine) {
    var b = info(m), open = !mine && !m.claimed && !K.receiptExpired(m);
    var node = el('div', 'msg xfer car-deal sold ' + (mine ? 'mine' : 'theirs') + (open ? ' can-claim' : ''));
    node.dataset.pid = m.id;
    var card = el(open ? 'button' : 'div', 'xfer-card gift-card');
    if (open) card.type = 'button';
    card.appendChild(el('div', 'xfer-label', mine ? '車を購入しました' : '車が売れました！'));
    card.appendChild(carPic(b.model));
    card.appendChild(nameRow(b.model, true));
    card.appendChild(K.amountEl(m.amount, 'dollars', 'xfer-amount'));
    card.appendChild(el('div', 'pr-state', K.receiptExpired(m) ? '期限を過ぎたため受け取れません' : mine ? (m.claimed ? '売上金が受け取られました' : 'Garage に入りました')
      : m.claimed ? '受け取り済み' : working[m.id] ? '受け取っています…' : 'タップして売上金を受け取る'));
    K.receiptHint(card, m);
    if (open) card.addEventListener('click', function () { claim(m); });
    node.appendChild(card);
    return node;
  }

  function busyOn(m, on) {
    if (on) working[m.id] = true; else delete working[m.id];
    BR.social.refreshMsg(m.id);
  }
  function buy(m) {
    if (working[m.id]) return;
    var b = info(m);
    if (S.dollars < m.amount) { sfx('deny'); toast('$が足りません（' + money(m.amount) + ' 必要です）'); return; }
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode(carName(b.model) + (b.used ? '（中古車）' : '') + ' を'));
      p.appendChild(K.amountEl(m.amount, 'dollars', 'confirm-amt'));
      p.appendChild(document.createTextNode('で購入しますか？'));
    }, '購入する').then(function (ok) {
      if (!ok) return;
      busyOn(m, true);
      api.carOfferBuy(m.id).then(function (r) {
        BR.social.patchMsg(m.id, { state: 'sold' });
        busyOn(m, false);
        if (r.me) { BR.app.serverBalance(r.me); BR.social.setMe(r.me); }
        sfx('register');
        if (BR.juice) BR.juice.reward(null, 3);
        toast(carName(b.model) + ' を購入しました！', 3200);
        BR.cars.changed();
      }, function (err) {
        if (err.code === 'done' || err.code === 'gone') BR.social.patchMsg(m.id, { state: err.message.indexOf('売れ') >= 0 ? 'sold' : 'canceled' });
        busyOn(m, false);
        fail(err);
      });
    });
  }
  function cancel(m) {
    if (working[m.id]) return;
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('この出品を取り消しますか？'));
    }, '取り消す').then(function (ok) {
      if (!ok) return;
      busyOn(m, true);
      api.carOfferCancel(m.id).then(function () {
        BR.social.patchMsg(m.id, { state: 'canceled' });
        busyOn(m, false);
        BR.cars.changed();
      }, function (err) { busyOn(m, false); fail(err); });
    });
  }
  function claim(m) {
    if (m.claimed || K.receiptExpired(m) || working[m.id]) return;
    busyOn(m, true);
    api.carSoldClaim(m.id).then(function (r) {
      BR.social.patchMsg(m.id, { claimed: true });
      busyOn(m, false);
      if (r.balance) BR.app.serverBalance(r.balance);
      sfx('money');
      toast('売上金 ' + money(r.paid) + ' を受け取りました！');
      if (BR.juice && BR.juice.reward) BR.juice.reward('#toast', 2);
    }, function (err) {
      if (err && err.code === 'claimed') BR.social.patchMsg(m.id, { claimed: true });
      if (err && err.code === 'expired') BR.social.patchMsg(m.id, { expired: true });
      busyOn(m, false);
      fail(err);
    });
  }
  // the other end (or another device) changed a card
  function onCard(d) {
    if (!d || !d.id) return;
    var patch = {};
    if (d.state) patch.state = d.state;
    if (d.claimed) patch.claimed = true;
    BR.social.patchMsg(d.id, patch);
    if (d.kind === 'car_offer') BR.cars.changed();
  }

  // the message list's line for a card
  function preview(last) {
    var b = info(last);
    if (last.kind === 'car_sold') return (last.mine ? '購入しました: ' : '売れました: ') + carName(b.model);
    return (last.mine ? '出品しました: ' : '車の販売: ') + carName(b.model);
  }
  function note(m) {
    var b = info(m);
    return m.kind === 'car_sold' ? (m.from ? m.from.name : '') + 'さんが ' + carName(b.model) + ' を購入しました！タップして売上金を受け取ろう'
      : (m.from ? m.from.name : '') + 'さんから車の販売：' + carName(b.model) + ' ' + money(m.amount);
  }

  function init() {
    K.registerModal('carsale');
    $('#cs-go').addEventListener('click', function () { sfx('click'); go(); });
    $('#cs-range').addEventListener('input', function () { setValue(Number($('#cs-range').value)); });
    $('#cs-down').addEventListener('click', function () { sfx('click'); setValue(st.value - Math.max(1, Math.round(range(st.car).base / 100))); });
    $('#cs-up').addEventListener('click', function () { sfx('click'); setValue(st.value + Math.max(1, Math.round(range(st.car).base / 100))); });
    $('#cs-amount').addEventListener('click', function () {
      sfx('click');
      var r = range(st.car);
      BR.screens.numpad({ icon: 'dollar', value: st.value, max: r.max, onOk: function (n) { setValue(n); } });
    });
    K.dragScroll($('#cs-cars'));
    BR.live.on('card', onCard);
  }

  BR.carsale = { init: init, open: open, offerEl: offerEl, soldEl: soldEl, preview: preview, note: note, usedTag: usedTag };
})(window.BR = window.BR || {});
