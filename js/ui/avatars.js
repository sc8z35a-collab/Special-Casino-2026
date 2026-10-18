/* Player icons: the picker on the sign-up card (paid icons are held shut by
   chains there), the icon dialog of one's own profile (paid icons are always
   on sale, the Sale badge only shows on icons the player does not own) and
   the chain-breaking moment after a purchase. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var el = K.el;

  var shop = null;     // today's sale from the server: { day, until, items: [{ id, price, salePrice, pct }] }

  function list() { return BR.CONFIG.avatars; }
  function saleOf(id) {
    if (shop) for (var i = 0; i < shop.items.length; i++) if (shop.items[i].id === id) return shop.items[i];
    var a = K.avatarInfo(id);
    if (!a || !(a.price > 0)) return null;
    // until the server has answered: the same formula on this device's date
    var day = U.utcDay();
    return { id: id, price: a.price, salePrice: BR.sale.price(a, day), pct: BR.sale.pct(id, day) };
  }
  function money(n) { return '$' + U.fmt(n); }

  function chains(tile) {
    tile.appendChild(el('i', 'av-chain'));
    tile.appendChild(el('i', 'av-chain flip'));
    tile.appendChild(el('i', 'ic ic-lock av-lock'));
  }

  // one icon button; opts: { selected, locked, sale, owned, current }
  function tile(a, opts) {
    var t = el('button', 'av-tile' + (a.price > 0 ? ' paid' : ' free') + (a.rare ? ' rare' : ''));
    t.type = 'button';
    t.dataset.id = a.id;
    var pic = el('span', 'av-pic');
    pic.style.backgroundImage = 'url("' + K.avatarSrc(a.id) + '")';
    t.appendChild(pic);
    if (opts.locked) { t.classList.add('locked'); chains(t); }
    if (opts.selected) t.classList.add('selected');
    if (opts.current) t.appendChild(el('i', 'ic ic-check av-check'));
    t.appendChild(el('span', 'av-name', a.name));
    if (opts.sale) {
      var s = saleOf(a.id);
      t.classList.add('on-sale');
      t.appendChild(el('i', 'sale-badge'));
      var price = el('span', 'av-price');
      price.appendChild(el('s', '', money(s.price)));
      price.appendChild(el('b', '', money(s.salePrice)));
      price.appendChild(el('em', '', '-' + s.pct + '%'));
      t.appendChild(price);
    } else if (a.price > 0 && opts.owned) {
      t.appendChild(el('span', 'av-owned', '所持'));
    }
    return t;
  }

  function shake(node) {
    node.classList.remove('shake');
    void node.offsetWidth;
    node.classList.add('shake');
  }

  /* ------------------------------------------------------------ sign-up --- */
  // Fills `grid`; paid icons are chained. Calls onPick(id) for free icons.
  function signupGrid(grid, selected, onPick, onLocked) {
    grid.textContent = '';
    list().forEach(function (a) {
      var t = tile(a, { selected: a.id === selected, locked: a.price > 0 });
      t.addEventListener('click', function () {
        if (a.price > 0) {
          K.sfx('chain');
          shake(t);
          onLocked(a);
          return;
        }
        K.sfx('click');
        Array.prototype.forEach.call(grid.children, function (x) { x.classList.toggle('selected', x === t); });
        onPick(a.id);
      });
      grid.appendChild(t);
    });
  }

  /* ------------------------------------------------------------ own icon dialog --- */
  var busy = false;
  function me() { return BR.social.me(); }
  function usable(id) { var m = me(); return !!m && m.avatars.indexOf(id) >= 0; }

  function renderPicker() {
    var m = me();
    if (!m) return;
    var grid = $('#av-grid');
    grid.textContent = '';
    list().forEach(function (a) {
      var owned = usable(a.id);
      var t = tile(a, {
        current: m.avatar === a.id,
        selected: m.avatar === a.id,
        locked: a.price > 0 && !owned,
        sale: a.price > 0 && !owned,
        owned: owned
      });
      t.addEventListener('click', function () { pick(a, t); });
      grid.appendChild(t);
    });
    var note = $('#av-sale-note');
    var until = shop ? new Date(shop.until) : null;
    note.textContent = '有料アイコンは毎日10〜40%オフのセール中！' +
      (until ? '（今日の価格は ' + until.getHours() + ':' + ('0' + until.getMinutes()).slice(-2) + ' まで）' : '');
  }

  function openPicker() {
    if (!me()) return;
    renderPicker();
    K.showModal('avatar-modal');
  }

  function pick(a, t) {
    if (busy) return;
    var m = me();
    if (usable(a.id)) {
      if (m.avatar === a.id) { K.sfx('click'); return; }
      busy = true;
      K.sfx('click');
      api.setAvatar(a.id).then(function (r) {
        BR.social.setMe(r.me);
        renderPicker();
        K.toast('アイコンを「' + a.name + '」に変更しました');
      }, K.fail).then(function () { busy = false; });
      return;
    }
    var s = saleOf(a.id);
    K.sfx('chain');
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('「' + a.name + '」を'));
      p.appendChild(K.amountEl(s.salePrice, 'dollars', 'confirm-amt'));
      p.appendChild(document.createTextNode('で購入しますか？'));
      p.appendChild(el('small', 'confirm-sub', 'セール価格（通常 ' + money(s.price) + ' → ' + s.pct + '%オフ）。購入するとすぐにこのアイコンになります。'));
    }, '購入する').then(function (ok) {
      if (!ok) return;
      busy = true;
      api.buyAvatar(a.id, s.salePrice).then(function (r) {
        BR.social.setMe(r.me);
        BR.app.serverBalance(r.me);
        breakFree(t, function () {
          renderPicker();
          K.toast('「' + a.name + '」を手に入れました！', 2800);
        });
      }, function (err) {
        if (err.code === 'price_changed' && err.extra.iconShop) { setShop(err.extra.iconShop); renderPicker(); }
        K.fail(err);
      }).then(function () { busy = false; });
    });
  }

  // the chains fall away from a freshly bought icon
  function breakFree(t, done) {
    K.sfx('unchain');
    t.classList.remove('on-sale');
    t.classList.add('breaking');
    setTimeout(done, 1150);
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
