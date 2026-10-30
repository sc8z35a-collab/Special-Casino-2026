/* Player portraits: one free starter and fixed prices by background rarity. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$, el = K.el;
  var shop = null;
  var busy = false;

  // (シークレットアイコン are only given, never sold: only the ones the player has are shown)
  function list() { return BR.CONFIG.avatars.filter(function (a) { return !a.given || usable(a.id); }); }
  function priceOf(a) {
    if (shop) for (var i = 0; i < shop.items.length; i++) if (shop.items[i].id === a.id) return shop.items[i].price;
    return a.price;
  }
  function money(n) {
    return '$' + (n >= 1000000 ? n / 1000000 + 'M' : n >= 1000 ? n / 1000 + 'K' : U.fmt(n));
  }

  function tile(a, opts) {
    var t = el('button', 'av-tile' + (a.price > 0 ? ' paid' : ' free'));
    t.type = 'button';
    t.dataset.id = a.id;
    t.dataset.rarity = a.rarity;
    t.setAttribute('aria-pressed', String(!!opts.selected));
    t.setAttribute('aria-label', a.name + '・' + BR.CONFIG.avatarRarities[a.rarity] + '・' +
      (opts.current ? '使用中' : opts.owned && (a.price > 0 || a.given) ? '所持' : a.price > 0 ? money(priceOf(a)) : '無料'));
    var pic = el('span', 'av-pic');
    pic.style.backgroundImage = 'url("' + K.avatarSrc(a.id) + '")';
    t.appendChild(pic);
    if (opts.selected) t.classList.add('selected');
    if (opts.current) t.appendChild(el('i', 'ic ic-check av-check'));
    t.appendChild(el('span', 'av-name', a.name));
    t.appendChild(el('span', 'av-rarity', BR.CONFIG.avatarRarities[a.rarity]));
    if (a.price > 0 && !opts.owned) {
      t.appendChild(el('span', 'av-price', money(priceOf(a))));
    } else {
      t.appendChild(el('span', 'av-owned', opts.current ? '使用中' : a.price > 0 || a.given ? '所持' : '無料'));
    }
    return t;
  }

  function signupGrid(grid, selected, onPick, onLocked) {
    grid.textContent = '';
    list().forEach(function (a) {
      var t = tile(a, { selected: a.id === selected });
      t.addEventListener('click', function () {
        K.sfx('click');
        if (a.price > 0) { onLocked(a); return; }
        Array.prototype.forEach.call(grid.children, function (x) {
          x.classList.toggle('selected', x === t);
          x.setAttribute('aria-pressed', String(x === t));
        });
        onPick(a.id);
      });
      grid.appendChild(t);
    });
  }

  function me() { return BR.social && BR.social.me(); }
  function usable(id) { var m = me(); return !!m && m.avatars.indexOf(id) >= 0; }

  function renderPicker() {
    var m = me();
    if (!m) return;
    var grid = $('#av-grid');
    grid.textContent = '';
    list().forEach(function (a) {
      var t = tile(a, { current: m.avatar === a.id, selected: m.avatar === a.id, owned: usable(a.id) });
      t.addEventListener('click', function () { pick(a); });
      grid.appendChild(t);
    });
  }

  function openPicker() {
    if (!me()) return;
    renderPicker();
    K.showModal('avatar-modal');
  }

  function pick(a) {
    if (busy || !me()) return;
    K.sfx('click');
    if (usable(a.id)) {
      if (me().avatar === a.id) return;
      busy = true;
      api.setAvatar(a.id).then(function (r) {
        BR.social.setMe(r.me);
        renderPicker();
        K.toast('アイコンを「' + a.name + '」に変更しました');
      }, K.fail).then(function () { busy = false; });
      return;
    }
    var price = priceOf(a);
    // Keep a second click from opening another confirmation or purchase.
    busy = true;
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('「' + a.name + '」を'));
      p.appendChild(K.amountEl(price, 'dollars', 'confirm-amt'));
      p.appendChild(document.createTextNode('で購入しますか？'));
      p.appendChild(el('small', 'confirm-sub', '購入するとこのアイコンになります。'));
    }, '購入する').then(function (ok) {
      if (!ok) return;
      return api.buyAvatar(a.id, price).then(function (r) {
        BR.social.setMe(r.me);
        BR.app.serverBalance(r.me);
        K.sfx('register');
        renderPicker();
        K.toast('「' + a.name + '」を手に入れました！', 2800);
      });
    }).catch(function (err) {
      if (err.code === 'price_changed' && err.extra && err.extra.iconShop) {
        setShop(err.extra.iconShop);
        renderPicker();
      }
      K.fail(err);
    }).then(function () { busy = false; });
  }

  function setShop(s) { if (s && s.items) shop = s; }
  function init() {
    K.registerModal('avatar-modal');
    K.dragScroll($('#av-grid'));
  }

  BR.avatars = {
    init: init,
    signupGrid: signupGrid,
    openPicker: openPicker,
    refresh: function () { if (K.isOpen('avatar-modal')) renderPicker(); },
    setShop: setShop
  };
})(window.BR = window.BR || {});
