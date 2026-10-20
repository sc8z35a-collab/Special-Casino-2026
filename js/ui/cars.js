/* Car Owner (the car shop) and Garage (the cars one owns), on the board
   screen. Prices are in $.
   - Car Owner: every car of the catalog (the picker), a car with a 3D model
     turning in the studio (js/render/garage3d.js), its price with the Car
     Owner sale on now (極 / 超極 / 超ダイナミック / 年感謝セール, js/game/sale.js)
     and how long it lasts.
   - Garage: two places, one more for $1,000,000 each (for good). Every car can
     be looked at in its 3D space (double tap: first person, a 5x lens), rented
     out (any number of them: customers every 5 hours, the takings collected
     here; a car out is away for 5 hours at the least), sold to the buy-back
     (its price now less the day's rate; 大廃棄セール: far less taken off) or
     given to a friend, or sold to one in the chat (js/ui/carsale.js: a car
     sold that way is a 中古車). VIP: every car a few % off on top of any sale,
     a garage place 40 % off, and cars only a VIP level can buy. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, S = BR.store.state, api = BR.api;
  var $ = U.$;
  var el = K.el, sfx = K.sfx, toast = K.toast, fail = K.fail;

  var garage = null;   // from the server: { catalog, cars, capacity, slotPrice, sale, disposal, buyback, now }
  var skew = 0;        // the server's clock less ours
  var busy = false;
  var sel = '';        // the car Car Owner shows
  var tick = 0;        // the countdowns

  function catalog() { return BR.CONFIG.cars; }
  function model(id) {
    var list = catalog();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function picture(id) { return BR.SOCIAL_IMG.cars[id] || ''; }
  function now() { return Date.now() + skew; }
  function money(n) { return '$' + U.fmt(n); }
  function load() {
    return api.cars().then(function (r) {
      garage = r;
      skew = (r.now || Date.now()) - Date.now();
      return r;
    });
  }
  function onBoard(view) { return BR.screens.current() === 'board' && $('#pane-' + view).classList.contains('active'); }
  function left(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
  }
  function at(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  // the sale on now (the server's word once it has spoken; it ends by itself)
  function sale() {
    var s = garage && garage.sale;
    if (s && now() < s.end) return s;
    return BR.sale.cars(now(), catalog());
  }
  // VIP's level while it is on (null: off)
  function vipLevel() {
    var m = BR.social.me();
    return m && m.vip && m.vip.on && m.vip.until > now() ? m.vip.level : null;
  }
  function priceOf(car) { return BR.sale.carPrice(car, sale(), vipLevel() === null ? 0 : BR.CONFIG.vip.carOff); }
  // one more garage place (the server's price once it has spoken)
  function slotPrice() {
    var p = BR.CONFIG.garage.slotPrice;
    return vipLevel() === null ? p : Math.round(p * (100 - BR.CONFIG.vip.garageOff) / 10000) * 100;
  }
  function owned() { return garage ? garage.cars.length : 0; }
  function capacity() { return garage ? garage.capacity : BR.CONFIG.garage.slots; }

  /* ------------------------------------------------------------ Car Owner --- */
  function showShop() {
    if (!sel || !model(sel)) sel = catalog()[catalog().length - 1].id;
    renderShop();
    load().then(function () { if (onBoard('cars')) renderShop(); }, function () {});
    clearInterval(tick);
    tick = setInterval(function () {
      if (onBoard('cars')) renderSale();
      else if (onBoard('garage')) renderBar();
      else clearInterval(tick);
    }, 1000);
  }
  function renderShop() {
    var car = model(sel);
    // the picker: every car, its sale mark
    var pick = $('#car-picker');
    pick.textContent = '';
    var s = sale();
    catalog().forEach(function (c) {
      var b = el('button', 'car-thumb' + (c.id === sel ? ' on' : ''));
      b.type = 'button';
      var p = el('span', 'car-thumb-pic');
      p.style.backgroundImage = 'url("' + picture(c.id) + '")';
      b.appendChild(p);
      b.appendChild(el('span', 'car-thumb-name', c.name));
      if (s && s.pct[c.id]) b.appendChild(el('em', 'car-thumb-off', '-' + s.pct[c.id] + '%'));
      if (c.model) b.appendChild(el('i', 'car-thumb-3d', '3D'));
      if (c.vip) { var vb = K.vipBadge(c.vip); vb.classList.add('car-thumb-vip'); b.appendChild(vb); }
      b.addEventListener('click', function () {
        if (sel === c.id) return;
        sfx('click');
        sel = c.id;
        renderShop();
      });
      pick.appendChild(b);
    });
    $('#car-name').textContent = car.name;
    var pr = priceOf(car), price = $('#car-price');
    price.textContent = '';
    if (pr.pct || pr.vip) price.appendChild(el('s', 'car-was', money(car.price)));
    price.appendChild(K.amountEl(pr.price, 'dollars'));
    if (pr.pct) price.appendChild(el('em', 'car-off', '-' + pr.pct + '%'));
    if (pr.vip) price.appendChild(el('em', 'car-vip-note', 'VIP -' + pr.vip + '%'));
    renderSale();
    renderOwned();
    stage(car);
  }
  // the Car Owner sale and how long it has to go
  function renderSale() {
    var box = $('#car-sale'), s = sale();
    box.hidden = !s;
    if (!s) return;
    var mine = s.pct[sel];
    box.textContent = '';
    box.appendChild(el('b', '', s.name + '開催中！'));
    box.appendChild(el('span', '', mine ? 'この車 ' + mine + '%OFF' : '対象：' + Object.keys(s.pct).map(function (id) { var m = model(id); return (m ? m.name : id) + ' ' + s.pct[id] + '%OFF'; }).join('・')));
    box.appendChild(el('small', '', '残り ' + left(s.end - now())));
  }
  function renderOwned() {
    var car = model(sel);
    var n = garage ? garage.cars.filter(function (c) { return c.model === car.id; }).length : null;
    $('#car-own').textContent = n === null ? '' : (n > 0 ? 'Garage に ' + n + '台' : 'まだ持っていません') + '・ガレージ ' + owned() + ' / ' + capacity() + '台';
    var buy = $('#car-buy');
    var locked = !BR.VIP.carOpen(car, vipLevel());
    buy.disabled = busy || locked;
    buy.textContent = locked ? 'VIP' + car.vip + '限定車' : '購入する';
    buy.classList.toggle('short', S.dollars < priceOf(car).price);
  }

  // the 3D studio for a car with a model, its picture otherwise
  function stage(car) {
    var pic = $('#car-pic'), host = $('#car-3d'), note = $('#car-3d-note');
    pic.style.backgroundImage = 'url("' + picture(car.id) + '")';
    var three = !!car.model && BR.garage3d && BR.garage3d.supported() && !$('#g3d').classList.contains('on');
    $('#car-stage').classList.toggle('three', three);
    if (!three) { host.hidden = true; note.textContent = ''; if (BR.garage3d) BR.garage3d.stop(); return; }
    host.hidden = false;
    note.textContent = '3Dを読み込み中…';
    var want = car.id;
    BR.garage3d.show(host, car.id, function (p) { if (sel === want) note.textContent = '3Dを読み込み中… ' + Math.round(p * 100) + '%'; }).then(function () {
      if (sel === want) note.textContent = 'ドラッグで回転';
    }, function () {
      // no 3D after all: the picture
      $('#car-stage').classList.remove('three');
      host.hidden = true;
      note.textContent = '';
    });
  }
  function leave() {
    clearInterval(tick);
    if (BR.garage3d && !$('#g3d').classList.contains('on')) BR.garage3d.stop();
  }

  function buy() {
    var car = model(sel);
    if (busy) return;
    var pr = priceOf(car);
    if (S.dollars < pr.price) {
      sfx('deny');
      toast('$が足りません（' + U.fmt(pr.price) + ' $ 必要です）');
      return;
    }
    if (garage && owned() >= capacity()) { full(); return; }
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode(car.name + ' を'));
      p.appendChild(K.amountEl(pr.price, 'dollars', 'confirm-amt'));
      p.appendChild(document.createTextNode('で購入しますか？'));
      p.appendChild(el('small', 'confirm-sub', (pr.pct ? 'セール中 ' + pr.pct + '%OFF' : '') + (pr.vip ? (pr.pct ? '・' : '') + 'VIP割引 ' + pr.vip + '%OFF' : '') + (pr.pct || pr.vip ? '（通常 ' + money(car.price) + '）。' : '') + '購入した車は Garage に入ります。'));
    }, '購入する').then(function (ok) {
      if (!ok) return;
      busy = true;
      renderOwned();
      api.buyCar(car.id, pr.price).then(function (r) {
        BR.app.serverBalance(r.me);
        BR.social.setMe(r.me);
        sfx('register');
        var pic = $('#car-stage');
        pic.classList.remove('sold');
        void pic.offsetWidth;
        pic.classList.add('sold');
        // the biggest purchase there is: the car shines, confetti everywhere
        if (BR.juice) {
          BR.juice.reward(pic, 3);
          BR.juice.rain({ kind: 'confetti', dur: 1.6, rate: 50 });
        }
        toast(car.name + ' を購入しました！Garage で見られます', 3200);
        return load();
      }).catch(function (err) {
        if (err.code === 'garage_full') { full(); return null; }
        if (err.code === 'price_changed') load().then(function () { if (onBoard('cars')) renderShop(); }, function () {});
        fail(err);
      }).then(function () {
        busy = false;
        if (onBoard('cars')) renderShop();
      });
    });
  }
  function full() {
    sfx('deny');
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('ガレージがいっぱいです（' + capacity() + '台）。1台分広げますか？'));
      p.appendChild(K.amountEl(garage ? garage.slotPrice : slotPrice(), 'dollars', 'confirm-amt'));
      p.appendChild(el('small', 'confirm-sub', '広げた分はずっと使えます。何台分でも広げられます。'));
    }, '広げる').then(function (ok) { if (ok) expand(true); });
  }

  /* ------------------------------------------------------------ Garage --- */
  function showGarage() {
    renderGarage();
    load().then(function () { if (onBoard('garage')) renderGarage(); }, function (err) {
      if (!garage) garageNote(err.message);
    });
    clearInterval(tick);
    tick = setInterval(function () {
      if (onBoard('garage')) { renderBar(); renderTimes(); } else if (onBoard('cars')) renderSale(); else clearInterval(tick);
    }, 1000);
  }
  function garageNote(text) {
    var g = $('#garage-grid');
    g.textContent = '';
    g.appendChild(el('div', 'empty', text));
  }
  // the bar: places, the takings, the 大廃棄セール
  function renderBar() {
    var bar = $('#garage-bar');
    bar.textContent = '';
    if (!garage) return;
    var d = garage.disposal && now() < garage.disposal.end ? garage.disposal : null;
    if (d) {
      var dz = el('div', 'garage-disposal');
      dz.appendChild(el('b', '', d.name + '開催中！'));
      dz.appendChild(el('span', '', '全車両 買取 −' + d.pct + '% の高価買取'));
      dz.appendChild(el('small', '', '残り ' + left(d.end - now())));
      bar.appendChild(dz);
    }
    var places = el('div', 'garage-places');
    places.appendChild(el('span', '', 'ガレージ'));
    places.appendChild(el('b', '', owned() + ' / ' + capacity() + '台'));
    var ex = el('button', 'mini-btn gold', '+1台分 広げる（' + money(garage.slotPrice) + '）');
    ex.type = 'button';
    ex.disabled = busy;
    ex.addEventListener('click', function () { sfx('click'); expand(false); });
    places.appendChild(ex);
    bar.appendChild(places);
    var earned = garage.cars.reduce(function (n, c) { return n + (c.earned || 0); }, 0);
    var rented = garage.cars.filter(function (c) { return c.rent; }).length;
    var rent = el('div', 'garage-rent');
    rent.appendChild(el('span', '', '貸し出し中 ' + rented + '台・売上'));
    rent.appendChild(K.amountEl(earned, 'dollars'));
    var get = el('button', 'mini-btn gold', '受け取る');
    get.type = 'button';
    get.disabled = busy || earned < 1;
    get.addEventListener('click', function () { sfx('click'); collect(get); });
    rent.appendChild(get);
    bar.appendChild(rent);
  }
  function renderGarage() {
    renderBar();
    if (!garage) { garageNote('読み込み中…'); return; }
    var g = $('#garage-grid');
    g.textContent = '';
    if (!garage.cars.length) {
      garageNote('まだ車を持っていません。\nCar Owner で購入しましょう！');
      return;
    }
    garage.cars.forEach(function (c) {
      var m = model(c.model) || { name: c.model, price: 0 };
      var card = el('div', 'garage-card' + (c.rent ? ' out' : ''));
      card.dataset.car = c.id;
      var pic = el('span', 'garage-pic');
      pic.style.backgroundImage = 'url("' + picture(c.model) + '")';
      if (c.rent) pic.appendChild(el('i', 'garage-out', '貸し出し中'));
      else if (m.model) pic.appendChild(el('i', 'garage-3d', '3D'));
      if (c.used) pic.appendChild(el('i', 'garage-used', '中古車'));
      if (c.offer) pic.appendChild(el('i', 'garage-offer', '販売中'));
      card.appendChild(pic);
      card.appendChild(el('div', 'garage-name', m.name));
      card.appendChild(el('div', 'garage-from', c.from ? c.from.name + (c.via === 'friend' ? 'さんから購入' : 'さんからのプレゼント') : K.fmtDate(c.acquiredAt) + ' に購入'));
      card.appendChild(el('div', 'garage-status'));
      var row = el('div', 'garage-acts');
      var held = !!c.rent || !!c.offer;
      if (m.model) row.appendChild(button('', '3Dで見る', !!c.rent, function () { open3d(c); }));
      row.appendChild(c.rent
        ? button('', c.rent.until ? '停止予約済み' : '貸し出しを止める', !!c.rent.until, function () { stopRent(c); })
        : button('', '貸し出す', !!c.offer, function () { startRent(c); }));
      var b = garage.buyback && garage.buyback[c.model];
      if (b) row.appendChild(button('', '売る ' + money(b.price), held, function () { sell(c); }));
      row.appendChild(button('gift', 'あげる', held, function () { chooseFriend(c); }));
      row.appendChild(button('', '友達に売る', held, function () { chooseFriend(c, true); }));
      card.appendChild(row);
      g.appendChild(card);
    });
    renderTimes();
  }
  function button(ic, text, off, fn) {
    var b = el('button', 'act-btn garage-act');
    b.type = 'button';
    if (ic) b.appendChild(K.icon(ic));
    b.appendChild(el('span', '', text));
    b.disabled = busy || off;
    b.addEventListener('click', function () { sfx('click'); fn(); });
    return b;
  }
  // the rented cars' clocks
  function renderTimes() {
    if (!garage) return;
    garage.cars.forEach(function (c) {
      var card = document.querySelector('#garage-grid .garage-card[data-car="' + c.id + '"] .garage-status');
      if (!card) return;
      var t = '';
      if (c.rent && c.rent.until) t = at(c.rent.until) + ' に戻ります（' + left(c.rent.until - now()) + '）';
      else if (c.rent) t = '次のお客さんの集計まで ' + left(c.rent.next - now());
      if (c.last) t += (t ? '\n' : '') + '前回の5時間：' + c.last.n + '人 ' + money(c.last.sum) + (c.last.vip ? '（VIP ' + c.last.vip + '人！）' : '');
      card.textContent = t;
      // a block has passed: count it
      if (c.rent && now() >= (c.rent.until || c.rent.next) + 1500 && !busy) {
        busy = true;
        load().then(function () { busy = false; if (onBoard('garage')) renderGarage(); }, function () { busy = false; });
      }
    });
  }

  function expand(thenBuy) {
    var price = garage ? garage.slotPrice : slotPrice();
    if (S.dollars < price) { sfx('deny'); toast('$が足りません（' + U.fmt(price) + ' $ 必要です）'); return; }
    var go = function () {
      busy = true;
      api.expandGarage(price).then(function (r) {
        BR.app.serverBalance(r.me);
        BR.social.setMe(r.me);
        sfx('register');
        toast('ガレージを広げました（' + r.capacity + '台）', 2800);
        if (garage) garage.capacity = r.capacity;
      }).catch(fail).then(function () {
        busy = false;
        if (onBoard('garage')) renderGarage();
        if (onBoard('cars')) renderOwned();
        if (thenBuy) buy();
      });
    };
    if (thenBuy) { go(); return; }
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode('ガレージを1台分広げますか？'));
      p.appendChild(K.amountEl(price, 'dollars', 'confirm-amt'));
      p.appendChild(el('small', 'confirm-sub', '広げた分はずっと使えます（今 ' + capacity() + '台 → ' + (capacity() + 1) + '台）。'));
    }, '広げる').then(function (ok) { if (ok) go(); });
  }

  function startRent(c) {
    var m = model(c.model) || { name: c.model, price: 1000000 };
    var R = BR.CONFIG.carRental;
    var t = Math.max(0, Math.min(1, Math.log(m.price / 1e6) / Math.log(20)));
    var lo = Math.round((R.min + (R.max - R.spread - R.min) * t) / 1000) * 1000;
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode(m.name + ' を貸し出しますか？'));
      p.appendChild(el('small', 'confirm-sub', R.hours + '時間ごとにお客さんが1〜5人来て、1人 ' + money(lo) + '〜' + money(lo + R.spread) + ' 払ってくれます（まれに ' + money(R.vip.pay) + ' 払うお客さんも！）。' +
        '貸し出し中は少なくとも' + R.hours + '時間、この車を売ったり・あげたり・3Dで見たりできません。'));
    }, '貸し出す').then(function (ok) {
      if (!ok) return;
      busy = true;
      api.rentCar(c.id, 'start').then(function () {
        sfx('register');
        toast(m.name + ' を貸し出しました。' + R.hours + '時間ごとにお客さんが来ます', 3200);
        return load();
      }).catch(fail).then(function () { busy = false; if (onBoard('garage')) renderGarage(); });
    });
  }
  function stopRent(c) {
    var m = model(c.model) || { name: c.model };
    var B = BR.CONFIG.carRental.hours * 3600000;
    var back = c.rent.start + Math.max(1, Math.ceil((now() - c.rent.start) / B)) * B;
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode(m.name + ' の貸し出しを止めますか？'));
      p.appendChild(el('small', 'confirm-sub', '今の' + BR.CONFIG.carRental.hours + '時間が終わる ' + at(back) + ' に戻ってきます（それまでのお客さんの分も売上になります）。'));
    }, '止める').then(function (ok) {
      if (!ok) return;
      busy = true;
      api.rentCar(c.id, 'stop').then(function () { toast(at(back) + ' に戻ってきます', 2800); return load(); })
        .catch(fail).then(function () { busy = false; if (onBoard('garage')) renderGarage(); });
    });
  }
  function collect(btn) {
    busy = true;
    api.collectRent().then(function (r) {
      BR.app.serverBalance(r.me);
      BR.social.setMe(r.me);
      sfx('money');
      if (BR.juice) BR.juice.payout('dollars', r.paid, btn);
      toast('貸し出しの売上 ' + money(r.paid) + ' を受け取りました', 2800);
      return load();
    }).catch(fail).then(function () { busy = false; if (onBoard('garage')) renderGarage(); });
  }
  function sell(c) {
    var m = model(c.model) || { name: c.model };
    var b = garage.buyback[c.model];
    K.confirmBox(function (p) {
      p.appendChild(document.createTextNode(m.name + ' を'));
      p.appendChild(K.amountEl(b.price, 'dollars', 'confirm-amt'));
      p.appendChild(document.createTextNode('で売りますか？'));
      p.appendChild(el('small', 'confirm-sub', (b.disposal ? '大廃棄セールの高価買取' : '今日の買取') + '：今の販売価格の −' + b.pct + '%。売った車は戻りません。' + (c.earned ? 'この車の貸し出しの売上も一緒に受け取ります。' : '')));
    }, '売る').then(function (ok) {
      if (!ok) return;
      busy = true;
      api.sellCar(c.id, b.price).then(function (r) {
        BR.app.serverBalance(r.me);
        BR.social.setMe(r.me);
        sfx('money');
        toast(m.name + ' を ' + money(r.paid) + ' で売りました' + (r.earned ? '（貸し出しの売上 ' + money(r.earned) + ' も）' : ''), 3200);
        return load();
      }).catch(function (err) {
        if (err.code === 'price_changed') load().then(function () { if (onBoard('garage')) renderGarage(); }, function () {});
        fail(err);
      }).then(function () { busy = false; if (onBoard('garage')) renderGarage(); });
    });
  }

  /* ------------------------------------------------------------ the 3D space --- */
  var space = null;
  function open3d(c) {
    if (!BR.garage3d || !BR.garage3d.supported()) { sfx('deny'); toast('この端末では3Dを表示できません', 2600); return; }
    var m = model(c.model) || { name: c.model };
    var box = $('#g3d');
    box.hidden = false;
    box.classList.add('on');
    box.classList.remove('walk');
    $('#g3d-name').textContent = m.name;
    $('#g3d-hint').textContent = 'ドラッグで回転・ダブルタップで中に入る';
    $('#g3d-load').hidden = false;
    $('#g3d-load').textContent = '3Dを読み込み中…';
    space = c.model;
    BR.garage3d.onMode = function (mode) {
      box.classList.toggle('walk', mode === 'walk');
      $('#g3d-hint').textContent = mode === 'walk' ? 'ドラッグで見回す・スティックで歩く・2本指かスライダーでズーム（最大5倍）・ダブルタップで戻る' : 'ドラッグで回転・ダブルタップで中に入る';
      zoomShown(1);
    };
    BR.garage3d.onZoom = zoomShown;
    BR.garage3d.space($('#g3d-view'), c.model, function (p) { $('#g3d-load').textContent = '3Dを読み込み中… ' + Math.round(p * 100) + '%'; }).then(function () {
      $('#g3d-load').hidden = true;
    }, function () {
      $('#g3d-load').textContent = '3Dを読み込めませんでした';
    });
  }
  function close3d() {
    if (!space) return;
    space = null;
    BR.garage3d.stop();
    var box = $('#g3d');
    box.classList.remove('on', 'walk');
    box.hidden = true;
    if (onBoard('cars')) renderShop();
  }
  function zoomShown(z) {
    $('#g3d-zoom').value = String(z);
    $('#g3d-zoom-n').textContent = '×' + z.toFixed(1);
  }
  // the stick: a thumb's push, -1..1 each way
  function stick() {
    var pad = $('#g3d-stick'), knob = pad.querySelector('i'), id = null;
    function set(e) {
      var r = pad.getBoundingClientRect(), rad = r.width / 2;
      var x = (e.clientX - r.left - rad) / rad, y = (e.clientY - r.top - rad) / rad, l = Math.hypot(x, y);
      if (l > 1) { x /= l; y /= l; }
      knob.style.transform = 'translate(' + (x * rad * 0.6) + 'px,' + (y * rad * 0.6) + 'px)';
      BR.garage3d.stick(x, -y);
    }
    pad.addEventListener('pointerdown', function (e) { id = e.pointerId; pad.setPointerCapture(id); set(e); e.stopPropagation(); });
    pad.addEventListener('pointermove', function (e) { if (e.pointerId === id) set(e); });
    var end = function (e) { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; BR.garage3d.stick(0, 0); };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
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

  // a friend to give the car to (or, `sell`, to offer it to in the chat)
  function chooseFriend(car, sell) {
    var have = BR.social.friendsList();
    (have ? Promise.resolve(have) : BR.social.loadFriends().then(function (r) { return r.friends; })).then(function (list) {
      pickDialog(sell ? '誰に売りますか？' : '誰にあげますか？', list, function (row, f) {
        var av = K.avatarEl(f);
        av.appendChild(K.presence(f.online));
        row.appendChild(av);
        row.appendChild(el('span', 'pick-name uname', f.name));
      }, function (f) { if (sell) BR.carsale.open(f, car.id); else confirmGift(f, car); }, 'まだフレンドがいません。');
    }).catch(fail);
  }

  // from a friend's profile: which car? (not the rented ones)
  function giftTo(user) {
    load().then(function (r) {
      var cars = r.cars.filter(function (c) { return !c.rent && !c.offer; });
      if (!cars.length) {
        sfx('deny');
        toast(r.cars.length ? '貸し出し中の車はあげられません' : 'あげられる車がありません。Car Owner で購入できます', 3200);
        return;
      }
      if (cars.length === 1) { confirmGift(user, cars[0]); return; }
      pickDialog(user.name + 'さんにあげる車', cars, function (row, c) {
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
        sfx('coins');
        toast(user.name + 'さんに ' + m.name + ' をプレゼントしました！', 3200);
        if (BR.juice) BR.juice.reward(null, 2);
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
    $('#g3d-close').addEventListener('click', function () { sfx('click'); close3d(); });
    $('#g3d-out').addEventListener('click', function () { sfx('click'); BR.garage3d.walk(false); });
    $('#g3d-in').addEventListener('click', function () { sfx('click'); BR.garage3d.walk(true); });
    $('#g3d-zoom').addEventListener('input', function () { BR.garage3d.zoom(Number($('#g3d-zoom').value)); });
    stick();
    // leaving the board (or Car Owner) stops the 3D
    BR.screens.onChange(function (name) { if (name !== 'board') { leave(); close3d(); } });
  }

  BR.cars = {
    init: init,
    showShop: showShop,
    showGarage: showGarage,
    leave: leave,
    giftTo: giftTo,
    pickDialog: pickDialog,
    // a car arrived: refresh when the garage is on screen
    changed: function () {
      garage = null;
      if (onBoard('garage')) showGarage();
      else if (onBoard('cars')) showShop();
    }
  };
})(window.BR = window.BR || {});
