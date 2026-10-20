/* 開発者支援: real money (yen) for ロイヤルコイン, the coins in the wallet
   (server/core/pay.js). The player picks a plan and how many (1-100), sees
   what it costs and what it gives, checks it all once more (what the law
   asks a last screen to show) and pays on the payment company's own page
   (Stripe) with PayPay or at a konbini. The coins come only once the server
   has heard from Stripe; this screen shows what it says: the meters
   (開発費回収, then 来月の開発費確保) move the moment anyone's payment comes
   in, and the player's orders (a konbini slip to show at the till). Opened
   from the coins in the wallet and from the menu's 詳細. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api, C = BR.CONFIG.support;
  var $ = U.$, el = K.el, sfx = K.sfx, toast = K.toast;
  // where paying may lead: Stripe's payment page, and its konbini slip
  var CHECKOUT = /^https:\/\/checkout\.stripe\.com\/\S+$/;
  var VOUCHER = /^https:\/\/payments\.stripe\.com\/\S+$/;
  var ORDER_ID = /^[0-9a-f]{32}$/;
  // orders this device is waiting on, and the ones already thanked for
  var WATCH_KEY = 'br.pay.watch', SEEN_KEY = 'br.pay.seen', WATCH_MS = 5 * 86400000;
  var DONE = ['paid', 'failed', 'expired', 'canceled', 'refunded', 'review', 'error'];

  var info = null;          // GET /api/pay/info
  var plan = C.plans[0];
  var qty = 5;              // 50円: the least PayPay takes
  var busy = false;
  var asked = null;         // the purchase waiting for 決済ページへ進む
  var shown = { m1: null, m2: null };
  var tweens = {};

  /* ------------------------------------------------------------ what this device waits for --- */
  function readList(key) {
    try { var a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function writeList(key, a) {
    try { localStorage.setItem(key, JSON.stringify(a.slice(-40))); } catch (e) { /* private mode */ }
  }
  function watch(id) {
    var a = readList(WATCH_KEY).filter(function (w) { return w && w.id !== id && Date.now() - w.at < WATCH_MS; });
    a.push({ id: id, at: Date.now() });
    writeList(WATCH_KEY, a);
  }
  function unwatch(id) { writeList(WATCH_KEY, readList(WATCH_KEY).filter(function (w) { return w && w.id !== id; })); }
  function thanked(id) { return readList(SEEN_KEY).indexOf(id) >= 0; }
  function setThanked(id) { var a = readList(SEEN_KEY); if (a.indexOf(id) < 0) a.push(id); writeList(SEEN_KEY, a); }

  // back from Stripe's page: ?pay=done|cancel&order=<id> (taken off the address at once)
  var back = (function () {
    try {
      var p = new URLSearchParams(location.search), kind = p.get('pay'), id = p.get('order') || '';
      if (!kind) return null;
      history.replaceState(null, '', location.pathname);
      return (kind === 'done' || kind === 'cancel') && ORDER_ID.test(id) ? { kind: kind, id: id } : null;
    } catch (e) { return null; }
  })();

  /* ------------------------------------------------------------ the screen --- */
  function amount() { return plan.price * qty; }
  function coins() { return (plan.coins + plan.bonus) * qty; }
  function methods() { return info && info.methods ? info.methods : C.methods; }

  // why nobody can buy right now (null: they can)
  function blocked() {
    if (!api.online) return '開発者支援はオンライン版のみです';
    if (!info) return '読み込み中…';
    if (!info.on) return 'ただいま準備中です';
    if (!info.adult) return info.ageAsked ? '購入は18歳以上の方に限ります' : '年齢確認が済んでいないため購入できません（起動時の「18歳以上ですか？」に回答してください）';
    return null;
  }

  function renderHead() {
    var f = $('#sp-flag');
    f.hidden = !(info && (info.test || !info.on));
    f.className = 'sp-flag' + (info && info.test ? ' test' : '');
    f.textContent = info && info.test ? 'テストモード（本物のお金は動きません）' : '準備中';
    $('#sp-daily').textContent = U.fmt(info ? info.dailyMax : C.dailyMax) + '円';
  }

  function renderPlans() {
    var box = $('#sp-plans');
    box.textContent = '';
    C.plans.forEach(function (p, i) {
      var b = el('button', 'sp-plan' + (p.id === plan.id ? ' on' : ''));
      b.type = 'button';
      b.dataset.plan = p.id;
      var pile = el('span', 'sp-pile n' + (i + 1));
      for (var k = 0; k <= i; k++) pile.appendChild(el('i', 'ic ic-coin'));
      b.appendChild(pile);
      if (p.bonus) b.appendChild(el('span', 'sp-plan-bonus', '＋感謝料' + p.bonus + '枚'));
      b.appendChild(el('b', 'sp-plan-name', p.name));
      b.appendChild(el('span', 'sp-plan-price', p.price + '円'));
      b.appendChild(el('span', 'sp-plan-coins', 'ロイヤルコイン ' + p.coins + '枚' + (p.bonus ? ' + ' + p.bonus + '枚' : '')));
      box.appendChild(b);
    });
  }

  function renderTotal() {
    $('#sp-qty-n').textContent = qty;
    $('#sp-yen').textContent = U.fmt(amount()) + '円';
    $('#sp-coins').textContent = U.fmt(coins());
    $('#sp-minus').disabled = qty <= 1;
    $('#sp-plus').disabled = qty >= C.maxQty;
    Array.prototype.forEach.call($('#sp-quick').children, function (b) { b.classList.toggle('on', Number(b.dataset.q) === qty); });
    renderPay();
  }

  function renderPay() {
    var box = $('#sp-pay'), why = blocked(), a = amount(), ms = methods();
    var left = info && info.on ? info.dailyLeft : Infinity;
    box.textContent = '';
    ms.forEach(function (m) {
      var b = el('button', 'sp-pay-btn ' + m.id);
      b.type = 'button';
      b.dataset.method = m.id;
      b.appendChild(el('b', '', m.id === 'paypay' ? 'PayPay で支払う' : 'コンビニで支払う'));
      b.appendChild(el('small', '', a < m.min ? '合計' + U.fmt(m.min) + '円から' : m.id === 'konbini' ? C.konbiniDays + '日以内に店頭でお支払い' : 'お支払い後すぐにお届け'));
      b.disabled = !!why || busy || a < m.min || a > left;
      box.appendChild(b);
    });
    var hint = why || '';
    if (!hint && a > left) hint = '24時間で' + U.fmt(info.dailyMax) + '円までです（あと' + U.fmt(left) + '円）';
    else if (!hint && ms.every(function (m) { return a < m.min; })) {
      hint = '合計' + U.fmt(Math.min.apply(null, ms.map(function (m) { return m.min; }))) + '円から購入できます。口数を増やしてください';
    }
    $('#sp-hint').textContent = hint;
  }

  function meter(id, key, m, animate) {
    var node = $('#' + id), num = node.querySelector('.sp-m-have');
    node.querySelector('.sp-m-goal').textContent = U.fmt(m.goal);
    // (the first yen shows too)
    var pct = Math.max(0, Math.min(1, m.have / m.goal)) * 100;
    node.querySelector('.sp-m-bar i').style.width = (m.have > 0 ? Math.max(1.6, pct) : 0).toFixed(2) + '%';
    node.classList.toggle('full', m.have >= m.goal);
    var from = shown[key] === null ? 0 : shown[key];
    shown[key] = m.have;
    if (tweens[key]) { tweens[key](); tweens[key] = null; }
    if (!animate || from === m.have) { num.textContent = U.fmt(m.have); return; }
    node.classList.remove('rise'); void node.offsetWidth; node.classList.add('rise');
    tweens[key] = U.tween(1200, function (t) { num.textContent = U.fmt(Math.round(from + (m.have - from) * U.ease.outCubic(t))); }, function () { tweens[key] = null; });
  }
  function renderMeters(animate) {
    if (!info || !info.meters) return;
    var m1 = info.meters.recover, m2 = info.meters.monthly;
    meter('sp-m1', 'm1', m1, animate);
    meter('sp-m2', 'm2', m2, animate);
    $('#sp-m1 .sp-m-note').textContent = m1.have >= m1.goal ? '開発費を回収できました。本当にありがとうございます！' : '残り ' + U.fmt(m1.goal - m1.have) + '円';
    $('#sp-m2 .sp-m-note').textContent = !m2.open ? '開発費の回収が終わると、こちらが増え始めます'
      : m2.have >= m2.goal ? '来月の開発費を確保できました。ありがとうございます！'
        : '残り ' + U.fmt(m2.goal - m2.have) + '円（毎月1日に0円から始まります）';
    $('#sp-m2').classList.toggle('waiting', !m2.open);
  }

  function renderOrders() {
    var box = $('#sp-orders');
    box.textContent = '';
    var list = info && info.orders ? info.orders.filter(function (o) { return o.status !== 'new' && o.status !== 'error'; }) : [];
    if (!list.length) return;
    box.appendChild(el('h4', '', 'あなたの購入'));
    list.forEach(function (o) {
      var row = el('div', 'sp-order ' + o.status);
      row.appendChild(el('span', 'sp-o-when', K.fmtTime(o.createdAt)));
      row.appendChild(el('span', 'sp-o-what', o.name + ' × ' + o.qty + '口（' + o.methodName + '）'));
      row.appendChild(el('span', 'sp-o-yen', U.fmt(o.amount) + '円'));
      row.appendChild(el('span', 'sp-o-st', o.statusName));
      if (o.voucher && VOUCHER.test(o.voucher.url)) {
        var a = el('a', 'sp-o-slip', '支払い番号を見る');
        a.href = o.voucher.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        row.appendChild(a);
        if (o.voucher.until) row.appendChild(el('small', 'sp-o-until', K.fmtTime(o.voucher.until) + 'まで'));
      }
      box.appendChild(row);
    });
  }

  function render(animate) {
    renderHead();
    renderPlans();
    renderTotal();
    renderMeters(animate);
    renderOrders();
  }

  function refresh(animate) {
    if (!api.online || !api.hasToken()) return Promise.resolve();
    return api.payInfo().then(function (r) {
      info = r;
      if (BR.screens.current() === 'support') render(animate);
    }, function (err) {
      if (BR.screens.current() === 'support') toast(err.message, 3200);
    });
  }

  /* ------------------------------------------------------------ buying --- */
  function row(dl, k, v) {
    dl.appendChild(el('dt', '', k));
    dl.appendChild(el('dd', '', v));
  }

  // the last look before paying: what, how many, how much, how and when, no cancelling
  function choose(id) {
    var m = methods().filter(function (x) { return x.id === id; })[0];
    if (!m || busy) return;
    var why = blocked();
    if (why) { sfx('deny'); toast(why, 3200); return; }
    if (amount() < m.min) { sfx('deny'); toast(m.name + 'は合計' + U.fmt(m.min) + '円からです'); return; }
    asked = { plan: plan, qty: qty, method: m };
    var dl = $('#sp-confirm-rows');
    dl.textContent = '';
    row(dl, '商品', plan.name + '（1口：ロイヤルコイン' + plan.coins + '枚' + (plan.bonus ? '＋感謝料' + plan.bonus + '枚' : '') + '・' + plan.price + '円）');
    row(dl, '数量', qty + '口');
    row(dl, 'お支払い金額', U.fmt(amount()) + '円（税込・手数料なし）');
    row(dl, 'お届けするもの', 'ロイヤルコイン ' + U.fmt(coins()) + '枚' + (plan.bonus ? '（感謝料 ' + U.fmt(plan.bonus * qty) + '枚を含む）' : ''));
    row(dl, 'お支払い方法', m.id === 'konbini' ? 'コンビニ決済（ご注文から' + C.konbiniDays + '日以内に、店頭で現金でお支払い）' : 'PayPay（このあとの決済ページでお支払い）');
    row(dl, 'お届けの時期', 'お支払いの確認後すぐ');
    row(dl, 'キャンセル', '購入後のキャンセル・返金はできません（法令で認められる場合を除く）');
    sfx('click');
    K.showModal('sp-confirm');
  }

  function go() {
    var a = asked;
    if (!a || busy) return;
    asked = null;
    busy = true;
    K.closeModal('sp-confirm');
    renderPay();
    api.payCheckout(a.plan.id, a.qty, a.method.id).then(function (r) {
      if (!r || !r.order || !ORDER_ID.test(r.order.id) || !CHECKOUT.test(String(r.url || ''))) throw new Error('決済ページを開けませんでした。少し待ってからもう一度お試しください');
      watch(r.order.id);
      sfx('click');
      toast('決済ページ（Stripe）に移動します…', 2600);
      // (the app opens it in the browser and stays here)
      setTimeout(function () { location.assign(r.url); }, 300);
      setTimeout(function () { busy = false; refresh(); }, 5000);
    }).catch(function (err) {
      busy = false;
      renderPay();
      sfx('deny');
      toast(err.message || '決済ページを開けませんでした', 3600);
      refresh();
    });
  }

  /* ------------------------------------------------------------ hearing about orders --- */
  function thank(o) {
    $('#sp-done-title').textContent = 'ご支援ありがとうございます！';
    $('#sp-done-text').textContent = o.name + ' × ' + o.qty + '口（' + U.fmt(o.amount) + '円）のお支払いを確認しました。\n' +
      'ロイヤルコイン ' + U.fmt(o.coins) + '枚をお届けしました。\n開発者からのメッセージをお待ちください！';
    K.showModal('sp-done');
    sfx('money');
    if (BR.juice && BR.juice.celebrate) { try { BR.juice.celebrate($('#sp-done .sp-done-coins'), 2); } catch (e) { /* the effects are a bonus */ } }
  }

  // an order as the server knows it now
  function heard(o, meters) {
    if (!o || !ORDER_ID.test(o.id)) return;
    if (info) {
      if (meters) info.meters = meters;
      var list = info.orders || (info.orders = []), i;
      for (i = 0; i < list.length; i++) if (list[i].id === o.id) break;
      if (i < list.length) list[i] = o; else list.unshift(o);
      if (BR.screens.current() === 'support') { renderMeters(true); renderOrders(); }
    }
    if (o.status === 'paid') {
      unwatch(o.id);
      if (!thanked(o.id)) { setThanked(o.id); thank(o); }
    } else if (DONE.indexOf(o.status) >= 0) {
      unwatch(o.id);
    }
  }

  // the orders this device waits on (back in the game, back online)
  function check() {
    if (!api.online || !api.hasToken() || !BR.social.me()) return;
    readList(WATCH_KEY).forEach(function (w) {
      if (!w || !ORDER_ID.test(w.id) || Date.now() - w.at > WATCH_MS) { if (w) unwatch(w.id); return; }
      api.payOrder(w.id).then(function (r) { heard(r.order, r.meters); }, function (err) { if (err.status === 404) unwatch(w.id); });
    });
  }

  // just back from Stripe's page: until it says paid (a few seconds at most)
  function follow(id, n) {
    api.payOrder(id).then(function (r) {
      heard(r.order, r.meters);
      if ((r.order.status === 'open' || r.order.status === 'new') && n < 24) setTimeout(function () { follow(id, n + 1); }, 2500);
    }, function () { if (n < 4) setTimeout(function () { follow(id, n + 1); }, 3000); });
  }
  function arrived() {
    var b = back;
    if (!b) return;
    back = null;
    BR.launch.whenDone(function () {
      setTimeout(function () {
        if (!api.hasToken()) { toast('お支払いの結果はゲーム（アプリ）でご確認ください', 5000); return; }
        open();
        if (b.kind === 'cancel') {
          toast('お支払いを中止しました（お金は動いていません）', 3600);
          api.payCancel(b.id).then(function (r) { heard(r.order); }, function () {});
          return;
        }
        watch(b.id);
        toast('お支払いを確認しています…', 2600);
        follow(b.id, 0);
      }, 500);
    });
  }

  /* ------------------------------------------------------------ setup --- */
  function open() {
    if (!api.online) { sfx('deny'); toast('開発者支援はオンライン版のみです'); return; }
    if (!api.hasToken()) { BR.account.require(open); return; }
    if (BR.game && BR.game.busy()) { sfx('deny'); return; }
    BR.screens.show('support');
  }

  function showLaw() {
    sfx('click');
    api.paySeller().then(function (d) {
      BR.lawFill($('#sp-law-rows'), d);
      K.showModal('sp-law-modal');
    }, function (err) { toast(err.message, 3200); });
  }

  function init() {
    K.registerModal('sp-confirm');
    K.registerModal('sp-done');
    K.registerModal('sp-law-modal');
    $('#sp-plans').addEventListener('click', function (e) {
      var b = e.target.closest('[data-plan]');
      if (!b) return;
      sfx('click');
      plan = C.plans.filter(function (p) { return p.id === b.dataset.plan; })[0] || plan;
      renderPlans();
      renderTotal();
    });
    function setQty(n) { qty = Math.max(1, Math.min(C.maxQty, Math.floor(n) || 1)); renderTotal(); }
    $('#sp-minus').addEventListener('click', function () { sfx('betDown'); setQty(qty - 1); });
    $('#sp-plus').addEventListener('click', function () { sfx('betUp'); setQty(qty + 1); });
    $('#sp-quick').addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]');
      if (!b) return;
      sfx('click');
      setQty(Number(b.dataset.q));
    });
    $('#sp-qty').addEventListener('click', function () {
      sfx('click');
      BR.screens.numpad({ icon: 'coin', value: qty, max: C.maxQty, onOk: function (n) { setQty(n); } });
    });
    $('#sp-pay').addEventListener('click', function (e) {
      var b = e.target.closest('[data-method]');
      if (b && !b.disabled) choose(b.dataset.method);
    });
    $('#sp-confirm-go').addEventListener('click', go);
    $('#sp-law').addEventListener('click', showLaw);
    K.dragScroll($('#sp-right'));
    K.dragScroll($('#sp-law-rows'));
    // the coins in the wallet open it
    var wc = $('.wallet .w-coins');
    wc.classList.add('tappable');
    wc.addEventListener('click', function () {
      if (BR.screens.current() === 'support') return;
      sfx('click');
      open();
    });
    BR.screens.register('support', {
      open: function () {
        shown.m1 = shown.m2 = null;
        render(false);
        refresh(true);
      },
      close: function () { K.closeModal('sp-confirm'); K.closeModal('sp-law-modal'); }
    });
    // (the one-file version has no server, so no such page)
    if (!api.online) { $('#start-law').hidden = true; return; }
    // anyone's payment moves the meters; this player's orders as they change
    BR.live.on('support', function (ev) {
      if (!info || !ev || !ev.meters) return;
      info.meters = ev.meters;
      if (BR.screens.current() === 'support') renderMeters(true);
    });
    BR.live.on('pay', function (ev) { if (ev) heard(ev.order); });
    BR.live.on('hello', function () { setTimeout(check, 1500); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(check, 600); });
    BR.social.onMe(function (m) { if (m) arrived(); });
  }

  BR.support = { init: init, open: open };
})(window.BR = window.BR || {});
