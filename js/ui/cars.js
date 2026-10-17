/* Car Owner (the car shop) and Garage (the cars one owns), on the board
   screen, plus giving a car to a friend. Prices are in $. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;

  var garage = null;   // { catalog, cars } from the server
  var busy = false;

  function model(id) {
    var list = BR.CONFIG.cars;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function picture(id) { return BR.SOCIAL_IMG.cars[id] || ''; }
  function load() {
    return api.cars().then(function (r) { garage = r; return r; });
  }
  function onBoard(view) { return BR.screens.current() === 'board' && $('#pane-' + view).classList.contains('active'); }

  /* ------------------------------------------------------------ Car Owner --- */
  function showShop() {
    var car = BR.CONFIG.cars[0];
    $('#car-pic').style.backgroundImage = 'url("' + picture(car.id) + '")';
    $('#car-name').textContent = car.name;
    var price = $('#car-price');
    price.textContent = '';
    price.appendChild(K.amountEl(car.price, 'dollars'));
    renderOwned();
    load().then(function () { if (onBoard('cars')) renderOwned(); }, function () {});
  }
  function renderOwned() {
    var car = BR.CONFIG.cars[0];
    var n = garage ? garage.cars.filter(function (c) { return c.model === car.id; }).length : null;
    $('#car-own').textContent = n === null ? '' : n > 0 ? 'Garage に ' + n + '台あります' : 'まだ持っていません';
    var buy = $('#car-buy');
    buy.disabled = busy;
    buy.classList.toggle('short', S.dollars < car.price);
  }
  function buy() {
    var car = BR.CONFIG.cars[0];
    if (busy) return;
    if (S.dollars < car.price) {
      sfx('deny');
      toast('$が足りません（' + U.fmt(car.price) + ' $ 必要です）');
      return;
    }
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode(car.name + ' を'));
      p.appendChild(K.amountEl(car.price, 'dollars', 'confirm-amt'));
      p.appendChild(document.createTextNode('で購入しますか？'));
      p.appendChild(el('small', 'confirm-sub', '購入した車は Garage に入ります。'));
    }, '購入する').then(function (ok) {
      if (!ok) return;
      busy = true;
      renderOwned();
      api.buyCar(car.id).then(function (r) {
        BR.app.serverBalance(r.me);
        BR.social.setMe(r.me);
        sfx('purchase');
        var pic = $('#car-pic');
        pic.classList.remove('sold');
        void pic.offsetWidth;
        pic.classList.add('sold');
        toast(car.name + ' を購入しました！Garage で見られます', 3200);
        return load();
      }).catch(fail).then(function () {
        busy = false;
        if (onBoard('cars')) renderOwned();
      });
    });
  }

  /* ------------------------------------------------------------ Garage --- */
  function showGarage() {
    renderGarage();
    load().then(function () { if (onBoard('garage')) renderGarage(); }, function (err) {
      if (!garage) garageNote(err.message);
    });
  }
  function garageNote(text) {
    var g = $('#garage-grid');
    g.textContent = '';
    g.appendChild(el('div', 'empty', text));
  }
  function renderGarage() {
    if (!garage) { garageNote('読み込み中…'); return; }
    var g = $('#garage-grid');
    g.textContent = '';
    if (!garage.cars.length) {
      garageNote('まだ車を持っていません。\nCar Owner で購入しましょう！');
      return;
    }
    garage.cars.forEach(function (c) {
      var m = model(c.model) || { name: c.model };
      var card = el('div', 'garage-card');
      card.dataset.car = c.id;
      var pic = el('span', 'garage-pic');
      pic.style.backgroundImage = 'url("' + picture(c.model) + '")';
      card.appendChild(pic);
      card.appendChild(el('div', 'garage-name', m.name));
      card.appendChild(el('div', 'garage-from', c.from ? c.from.name + 'さんからのプレゼント' : K.fmtDate(c.acquiredAt) + ' に購入'));
      var b = el('button', 'act-btn garage-gift');
      b.type = 'button';
      b.appendChild(K.icon('gift'));
      b.appendChild(el('span', '', 'フレンドにあげる'));
      b.addEventListener('click', function () { sfx('click'); chooseFriend(c); });
      card.appendChild(b);
      g.appendChild(card);
    });
  }

  /* ------------------------------------------------------------ gifts --- */
  // a list of choices in the pick dialog; onPick(item)
  function pickDialog(title, items, render, onPick, emptyText) {
    $('#pick-title').textContent = title;
    var list = $('#pick-list');
    list.textContent = '';
    if (!items.length) list.appendChild(el('div', 'empty', emptyText));
    items.forEach(function (it) {
      var row = el('button', 'pick-row');
      row.type = 'button';
      render(row, it);
      row.addEventListener('click', function () { sfx('click'); K.closeModal('pick'); onPick(it); });
      list.appendChild(row);
    });
    K.showModal('pick');
  }

  function chooseFriend(car) {
    var have = BR.social.friendsList();
    (have ? Promise.resolve(have) : BR.social.loadFriends().then(function (r) { return r.friends; })).then(function (list) {
      pickDialog('誰にあげますか？', list, function (row, f) {
        var av = K.avatarEl(f);
        av.appendChild(K.presence(f.online));
        row.appendChild(av);
        row.appendChild(el('span', 'pick-name uname', f.name));
      }, function (f) { confirmGift(f, car); }, 'まだフレンドがいません。\nフレンドになると車をプレゼントできます。');
    }).catch(fail);
  }

  // from a friend's profile: which car?
  function giftTo(user) {
    load().then(function (r) {
      if (!r.cars.length) {
        sfx('deny');
        toast('あげられる車がありません。Car Owner で購入できます', 3200);
        return;
      }
      if (r.cars.length === 1) { confirmGift(user, r.cars[0]); return; }
      pickDialog(user.name + 'さんにあげる車', r.cars, function (row, c) {
        var pic = el('span', 'pick-car');
        pic.style.backgroundImage = 'url("' + picture(c.model) + '")';
        row.appendChild(pic);
        row.appendChild(el('span', 'pick-name', (model(c.model) || { name: c.model }).name));
        row.appendChild(el('span', 'pick-sub', c.from ? c.from.name + 'さんから' : K.fmtDate(c.acquiredAt)));
      }, function (c) { confirmGift(user, c); }, '');
    }).catch(fail);
  }

  function confirmGift(user, car) {
    var m = model(car.model) || { name: car.model };
    K.confirmBox(function (p) {
      p.appendChild(K.nameSpan(user.name));
      p.appendChild(document.createTextNode('さんに ' + m.name + ' をプレゼントしますか？'));
      p.appendChild(el('small', 'confirm-sub', 'プレゼントした車は相手の Garage に移ります。取り消せません。'));
    }, 'プレゼントする').then(function (ok) {
      if (!ok) return;
      api.giftCar(user.id, car.id).then(function (r) {
        sfx('purchase');
        toast(user.name + 'さんに ' + m.name + ' をプレゼントしました！', 3200);
        BR.social.onMsg(r.message);
        return load();
      }).then(function () {
        if (onBoard('garage')) renderGarage();
        if (onBoard('cars')) renderOwned();
      }).catch(fail);
    });
  }

  function init() {
    K.registerModal('pick');
    $('#car-buy').addEventListener('click', function () { sfx('click'); buy(); });
    K.dragScroll($('#pick-list'));
  }

  BR.cars = {
    init: init,
    showShop: showShop,
    showGarage: showGarage,
    giftTo: giftTo,
    // a car arrived: refresh when the garage is on screen
    changed: function () {
      garage = null;
      if (onBoard('garage')) showGarage();
      else if (onBoard('cars')) showShop();
    }
  };
})(window.BR = window.BR || {});
