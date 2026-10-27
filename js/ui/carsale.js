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
  }

  BR.carsaleDialog = { init: init, open: open };
})(window.BR = window.BR || {});
