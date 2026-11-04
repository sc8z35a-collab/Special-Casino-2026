/* The server settles all the reward slots (GACHA.slotsOf(kind) a pull) before this lightweight reveal. */
(function (BR) {
  'use strict';
  var K = BR.kit, api = BR.api, G = BR.GACHA, A = BR.GACHA_ART, el = K.el;
  var state = null, kind = 'rare', busy = false, generation = 0, root, reveal;
  var timer = 0, pending = null, lastDraw = null, skipped = false, started = 0, loading = false, receivedAt = 0;
  var saleAsked = 0, ui = {}, controls = null, oddsKey = '', motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function shown() { return root && !root.hidden; }
  function reduced() { return document.body.classList.contains('fx-off-screens') || motion.matches; }
  function tier() { return G.kinds.filter(function (k) { return k.id === kind; })[0]; }
  function picture(src, cls, lazy) { var img = el('img', cls); if (lazy) img.loading = 'lazy'; img.alt = ''; img.draggable = false; img.decoding = 'async'; img.src = src; return img; }
  function button(text, run, cls) { var b = el('button', cls || 'mini-btn', text); b.type = 'button'; b.disabled = busy; b.addEventListener('click', run); return b; }
  function money(n) { return '$' + BR.util.fmt(n); }
  function price(count) { return state.prices[kind][count === 1 ? 'single' : count === 3 ? 'three' : 'ten']; }
  // the free tickets (功績's rewards) for a kind: one a pull
  function tickets(k) { return state && state.items && state.items.tickets ? state.items.tickets[k || kind] || 0 : 0; }
  function boostOn() { return G.events(state.now + performance.now() - receivedAt).boost.on; }
  // リリース記念セール (the server says which gacha and until when): on while its end is ahead
  function saleLeft() { var s = state && state.releaseSale; return s ? Math.max(0, s.end - (state.now + performance.now() - receivedAt)) : 0; }
  function onSale(k) { return saleLeft() > 0 && state.releaseSale.kind === k; }
  function clockText(ms) { var t = Math.ceil(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = t % 60; return h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  function apply(r) { state = r; receivedAt = performance.now(); if (r.me) { BR.social.setMe(r.me); BR.app.serverBalance(r.me, true); } }
  function rewardArt(r) {
    if (r.type === 'car') return A.cars[r.carId] || BR.SOCIAL_IMG.cars[r.carId] || A.carFallback;
    return A.rewards[r.type] || A.icon;
  }
  function clearTimer() { clearTimeout(timer); timer = 0; }
  function closeResults() { clearTimer(); reveal.hidden = true; pending = null; lastDraw = null; busy = false; render(); }
  function showResults(r) {
    clearTimer(); pending = null; lastDraw = r; busy = false;
    if (!shown()) { reveal.hidden = true; return; }
    var list = ui.results, fragment = document.createDocumentFragment();
    document.getElementById('gacha-result-name').textContent = G.kinds.filter(function (k) { return k.id === r.kind; })[0].name + ' ' + r.count + '連' + (r.free ? '（無料券）' : '');
    var bonus = r.pulls.reduce(function (n, p) { return n + (p.bonus || 0); }, 0);
    var bonusBox = document.getElementById('gacha-bonus'); bonusBox.replaceChildren();
    if (bonus) { bonusBox.appendChild(picture(A.rewards.royal)); bonusBox.appendChild(el('span', '', '+' + bonus)); }
    r.pulls.forEach(function (pull, i) {
      var row = el('section', 'gc-pull'); row.setAttribute('aria-label', (i + 1) + '回目');
      pull.rewards.forEach(function (reward, j) {
        var card = el('div', 'gc-reward' + (reward.type === 'car' ? ' gc-car-reward' : ''));
        card.style.setProperty('--gc-delay', Math.min(i * 60 + j * 100, 500) + 'ms');
        card.appendChild(picture(rewardArt(reward), 'gc-reward-art', true));
        card.appendChild(el('strong', '', reward.name)); if (reward.pending) card.appendChild(el('small', '', 'アイテム欄で受け取り')); row.appendChild(card);
      }); fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
    reveal.classList.toggle('gc-no-motion', reduced()); reveal.classList.add('gc-revealed'); reveal.hidden = false;
    render(); K.sfx('win');
  }
  function settleVisual() {
    if (!pending) return;
    var r = pending;
    if (skipped || reduced() || document.hidden || !shown()) { showResults(r); return; }
    timer = setTimeout(function () { showResults(r); }, Math.max(0, 900 - (Date.now() - started)));
  }
  function begin(count, quoted, chosen, gen, free) {
    if (gen !== generation || !shown()) { busy = false; render(); return; }
    pending = null; lastDraw = null; skipped = false; started = Date.now(); clearTimer();
    reveal.classList.remove('gc-revealed'); reveal.classList.toggle('gc-no-motion', reduced()); reveal.hidden = false;
    document.getElementById('gacha-results').replaceChildren(); document.getElementById('gacha-status').textContent = '';
    K.sfx('spin');
    api.gachaSpin(chosen, count, quoted, free).then(function (r) {
      if (gen !== generation) return;
      apply(r); pending = r; lastDraw = r; settleVisual();
    }, function (e) {
      if (gen !== generation) return;
      clearTimer(); reveal.hidden = true; pending = null; busy = false; K.fail(e); render();
      if (e.code === 'price_changed') api.gacha().then(function (r) { if (gen === generation) { apply(r); render(); } }, K.fail);
    });
  }
  // `free`: with the free tickets, one a pull
  function spin(count, free) {
    if (busy || !state) return;
    var retry = api.pendingGacha();
    if (retry) { count = retry.count; kind = retry.kind; free = retry.ticket; }
    var quoted = retry ? retry.price : free ? 0 : price(count), chosen = kind, gen = generation;
    busy = true; render();
    document.getElementById('confirm').classList.add('gc-confirm');
    K.confirmBox(function (box) {
      box.appendChild(el('strong', 'gc-confirm-title', '本当に引きますか？'));
      box.appendChild(el('span', 'gc-confirm-choice', tier().name + ' ' + count + '連 · ' + count * G.slotsOf(chosen) + '枠'));
      if (free) {
        var t = el('span', 'gc-confirm-price gc-confirm-ticket');
        t.appendChild(picture(A.tickets[chosen]));
        t.appendChild(el('span', '', '無料券 ×' + count));
        box.appendChild(t);
      } else box.appendChild(el('span', 'gc-confirm-price', money(quoted)));
    }, 'YES', 'NO').then(function (ok) {
      document.getElementById('confirm').classList.remove('gc-confirm');
      if (gen !== generation) return;
      if (ok) begin(count, quoted, chosen, gen, free); else { busy = false; render(); }
    });
  }
  function use(item) {
    if (busy) return; busy = true; render(); var gen = generation;
    api.gachaUse(item).then(function (r) { if (gen === generation) apply(r); }, K.fail).then(function () { if (gen !== generation) return; busy = false; render(); });
  }
  /* ----------------------------------------------------- アイテム売却所 --- */
  // What can be sold back (GACHA.sell, a piece, each to the company that provides it): how many of each held, a slider
  // each from 0 to all of them, and one sale for all (POST /api/gacha/sell { items }: all or none).
  var SELLS = [
    { item: 'vip-week', name: 'VIP1週間券', to: 'DAIZIN', art: 'vip-week', held: function () { return state.items.vipWeek || 0; } },
    { item: 'reset-5h', name: 'リセットチケット（5時間）', to: 'YOSIDA', art: 'reset', held: function () { return (state.resets || {})['5h'] || 0; } },
    { item: 'reset-day', name: 'リセットチケット（24時間）', to: 'YOSIDA', art: 'reset', held: function () { return (state.resets || {}).day || 0; } },
    { item: 'garage', name: 'ガレージコイン（空いているガレージ）', to: 'MAGITA', art: 'garage', held: function () { return state.garageFree || 0; } },
    { item: 'seed', name: '金の生る木の種', to: 'YOSIDA', art: 'seed', held: function () { return state.items.seed || 0; } }
  ];
  var picked = {}, sellUi = null;
  function sellables() { return SELLS.filter(function (x) { return G.sell[x.item] && x.held() > 0; }); }
  function sellTotal() { return SELLS.reduce(function (n, x) { return n + (picked[x.item] || 0) * (G.sell[x.item] || 0); }, 0); }
  function openSell() {
    if (busy || !state) return;
    picked = {};
    sellUi.box.hidden = false;
    renderSell(true);
  }
  function closeSell() { if (sellUi) sellUi.box.hidden = true; picked = {}; }
  function setPicked(x, n) {
    picked[x.item] = Math.max(0, Math.min(x.held(), Math.round(Number(n) || 0)));
    renderSell(false);
  }
  // `rebuild`: the rows anew (opened, or what is held changed); else only the numbers
  function renderSell(rebuild) {
    if (!sellUi || sellUi.box.hidden || !state) return;
    var list = sellables();
    if (rebuild) {
      sellUi.rows = {};
      var frag = document.createDocumentFragment();
      list.forEach(function (x) {
        var row = el('section', 'gc-sell-row'), held = x.held();
        row.appendChild(picture(A.rewards[x.art] || A.icon, 'gc-sell-art'));
        var info = el('div', 'gc-sell-info');
        info.appendChild(el('strong', '', x.name));
        info.appendChild(el('small', '', '1つ ' + money(G.sell[x.item]) + '・' + x.to + 'が買い取り・持っている数 ' + held));
        var line = el('div', 'gc-sell-line');
        var minus = button('−', function () { setPicked(x, (picked[x.item] || 0) - 1); }, 'mini-btn gc-sell-step');
        var range = el('input', 'gc-sell-range');
        range.type = 'range'; range.min = '0'; range.max = String(held); range.step = '1'; range.value = String(picked[x.item] || 0);
        range.setAttribute('aria-label', x.name + 'を売る数');
        range.addEventListener('input', function () { setPicked(x, range.value); });
        var plus = button('+', function () { setPicked(x, (picked[x.item] || 0) + 1); }, 'mini-btn gc-sell-step');
        var all = button('すべて', function () { setPicked(x, x.held()); }, 'mini-btn gc-sell-all');
        var n = el('b', 'gc-sell-n');
        line.appendChild(minus); line.appendChild(range); line.appendChild(plus); line.appendChild(all);
        info.appendChild(line);
        row.appendChild(info);
        var sub = el('div', 'gc-sell-sub'); sub.appendChild(n); var subMoney = el('span'); sub.appendChild(subMoney);
        row.appendChild(sub);
        sellUi.rows[x.item] = { range: range, n: n, money: subMoney, minus: minus, plus: plus, all: all };
        frag.appendChild(row);
      });
      if (!list.length) frag.appendChild(el('p', 'gc-sell-empty', '売れるアイテムを持っていません'));
      sellUi.list.replaceChildren(frag);
    }
    list.forEach(function (x) {
      var r = sellUi.rows[x.item], k = picked[x.item] || 0, held = x.held();
      if (!r) return;
      if (Number(r.range.value) !== k) r.range.value = String(k);
      r.n.textContent = k + ' / ' + held;
      r.money.textContent = money(k * G.sell[x.item]);
      r.range.disabled = busy; r.minus.disabled = busy || k <= 0; r.plus.disabled = busy || k >= held; r.all.disabled = busy || k >= held;
    });
    var total = sellTotal();
    sellUi.total.textContent = money(total);
    sellUi.go.disabled = busy || total <= 0;
  }
  function sellPicked() {
    if (busy || !state) return;
    var items = {}, lines = [];
    SELLS.forEach(function (x) { var k = picked[x.item] || 0; if (k > 0) { items[x.item] = k; lines.push(x.name + ' ×' + k); } });
    if (!lines.length) return;
    var total = sellTotal(), gen = generation;
    busy = true; renderSell(false);
    K.confirmBox(function (box) {
      box.appendChild(el('strong', 'gc-confirm-title', 'まとめて売りますか？'));
      lines.forEach(function (t) { box.appendChild(el('span', 'gc-confirm-choice', t)); });
      box.appendChild(el('span', 'gc-confirm-price', money(total)));
    }, '売る', 'やめる').then(function (ok) {
      if (gen !== generation) return;
      if (!ok) { busy = false; renderSell(false); return; }
      api.gachaSellAll(items).then(function (r) {
        if (gen !== generation) return;
        apply(r); picked = {};
        K.toast(lines.length + '種類を' + money(r.paid) + 'で売りました');
      }, K.fail).then(function () {
        if (gen !== generation) return;
        busy = false; render();
        if (!sellables().length) closeSell(); else renderSell(true);
      });
    });
  }
  // Create the controls and their listeners on the first visit, then update existing nodes.
  function buildControls() {
    controls = { tiers: [], bundles: [], itemKey: '' };
    var fragment = document.createDocumentFragment();
    var tiers = el('div', 'gc-tiers');
    G.kinds.forEach(function (v) {
      var b = button('', function () { kind = v.id; render(); }, 'gc-tier');
      b.dataset.kind = v.id; b.setAttribute('aria-label', v.name);
      var art = el('span', 'gc-tier-art'); art.appendChild(picture(A.tiers[v.id])); b.appendChild(art);
      b.appendChild(el('strong', '', v.name.replace('ガチャ', '')));
      var ticket = el('span', 'gc-tier-ticket'); ticket.hidden = true; ticket.appendChild(picture(A.tickets[v.id])); ticket.appendChild(el('b'));
      var sale = picture(A.releaseSale, 'gc-tier-sale'); sale.hidden = true;
      b.appendChild(ticket); b.appendChild(sale); tiers.appendChild(b); controls.tiers.push(b);
    }); fragment.appendChild(tiers);
    var hero = el('div', 'gc-hero'); hero.appendChild(picture(A.icon, 'gc-hero-machine'));
    var saleBar = el('div', 'gc-sale-bar'); saleBar.hidden = true; saleBar.appendChild(picture(A.releaseSale)); var saleClock = el('b', 'gc-sale-clock'); saleBar.appendChild(saleClock);
    hero.appendChild(saleBar); controls.sale = { bar: saleBar, clock: saleClock };
    fragment.appendChild(hero);
    var purchases = el('div', 'gc-purchases');
    [1, 3, 10].forEach(function (count) {
      var box = el('div', 'gc-bundle');
      var b = button('', function () { spin(count); }, 'gc-art-button gc-pull-button');
      b.dataset.count = count;
      b.appendChild(picture(A.pulls[count]));
      if (A.discounts[count]) b.appendChild(picture(A.discounts[count], 'gc-discount'));
      var cost = el('strong', 'gc-price'), was = el('s', 'gc-was'); was.hidden = true;
      var slots = el('small', 'gc-slots', count * G.slotsOf(kind) + '枠');
      box.appendChild(b); box.appendChild(was); box.appendChild(cost); box.appendChild(slots);
      controls.bundles.push({ button: b, price: cost, was: was, count: count, slots: slots });
      purchases.appendChild(box);
    });
    // 無料で引く: one free ticket, one pull (shown while the chosen gacha has tickets)
    var free = el('div', 'gc-bundle gc-free'), fb = button('', function () { spin(1, true); }, 'gc-art-button gc-free-button');
    var fimg = picture(A.tickets[kind]); fb.appendChild(fimg); fb.appendChild(el('span', 'gc-free-label', '無料で引く'));
    var fcount = el('strong', 'gc-free-count');
    var fslots = el('small', 'gc-free-slots', G.slotsOf(kind) + '枠');
    free.appendChild(fb); free.appendChild(fcount); free.appendChild(fslots);
    controls.free = { box: free, button: fb, img: fimg, count: fcount, slots: fslots };
    purchases.appendChild(free);
    fragment.appendChild(purchases);
    ui.controls.replaceChildren(fragment);
  }
  function render() {
    if (!state || !root) return;
    if (!controls) buildControls();
    ui.controls.hidden = false;
    var retry = api.pendingGacha();
    if (retry) kind = retry.kind;
    controls.tiers.forEach(function (b) {
      b.disabled = busy || !!retry;
      var pressed = String(kind === b.dataset.kind);
      if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
      var n = tickets(b.dataset.kind), tag = b.querySelector('.gc-tier-ticket');
      tag.hidden = !n;
      tag.lastChild.textContent = '×' + n;
      b.querySelector('.gc-tier-sale').hidden = !onSale(b.dataset.kind);
    });
    // the gacha chosen: its own background
    root.dataset.kind = kind;
    controls.sale.bar.hidden = !onSale(kind);
    tick();
    var have = tickets(), free = controls.free, freeRetry = !!retry && retry.ticket;
    free.box.hidden = !have && !freeRetry;
    if (free.img.getAttribute('src') !== A.tickets[kind]) free.img.src = A.tickets[kind];
    free.count.textContent = '無料券 ×' + have;
    free.slots.textContent = G.slotsOf(kind) + '枠';
    free.button.disabled = busy || (!!retry && !freeRetry) || (!have && !freeRetry);
    free.button.setAttribute('aria-label', '無料で引く 無料券' + have + '枚');
    controls.bundles.forEach(function (v) {
      var recovering = retry && !retry.ticket && retry.count === v.count;
      var cost = recovering ? retry.price : price(v.count), insufficient = !recovering && state.me && state.me.dollars < cost;
      var text = money(cost), was = onSale(kind) && !recovering ? money(G.price(kind, v.count, false)) : '', slotText = v.count * G.slotsOf(kind) + '枠';
      if (v.slots.textContent !== slotText) { v.slots.textContent = slotText; v.button.setAttribute('aria-label', v.count + '連 ' + text + ' ' + slotText); }
      v.was.hidden = !was; v.was.textContent = was;
      if (v.price.textContent !== text) {
        v.price.textContent = text;
        v.button.setAttribute('aria-label', v.count + '連 ' + text + ' ' + v.count * G.slotsOf(kind) + '枠');
      }
      v.button.disabled = busy || insufficient || (!!retry && !recovering); v.button.title = recovering ? '前の抽選結果を確認' : insufficient ? '$が足りません' : '';
    });
    ui.event.hidden = !boostOn();
    var wallet = state.me ? money(state.me.dollars) : '';
    if (ui.wallet.textContent !== wallet) ui.wallet.textContent = wallet;
    ui.odds.disabled = busy;
    var items = ui.items, itemKey = JSON.stringify([state.items, state.resets, state.garageFree]);
    if (controls.itemKey !== itemKey) {
      items.replaceChildren(); controls.itemKey = itemKey;
      if (state.items.seed) { var seed = button('種 ×' + state.items.seed, function () { use('seed'); }); seed.prepend(picture(A.rewards.seed)); items.appendChild(seed); }
      if (state.items.vipWeek) { var vip = button('VIP1週間券 ×' + state.items.vipWeek, function () { use('vip-week'); }); vip.prepend(picture(A.rewards['vip-week'])); items.appendChild(vip); }
      // (what can be sold back — the VIP1週間券, the reset tickets, the garage coins, the seeds —: in the 売却所, all at once)
      if (sellables().length) items.appendChild(button('アイテム売却所', openSell, 'mini-btn gc-sell'));
      (state.items.waiting || []).forEach(function (r) {
        var claim = button(r.name + ' ×' + r.count + ' 受け取る', function () { use(r.key); }); claim.prepend(picture(rewardArt(r))); items.appendChild(claim);
      });
    }
    Array.prototype.forEach.call(items.children, function (b) { b.disabled = busy; });
    if (sellUi && !sellUi.box.hidden) renderSell(controls.sellKey !== itemKey);
    controls.sellKey = itemKey;
    items.hidden = !items.childElementCount;
  }
  // the sale's time left, each second while the screen is open (the prices go back when it ends: the server says so)
  function tick() {
    if (!controls || !state) return;
    var left = saleLeft();
    if (controls.sale.bar.hidden) return;
    controls.sale.clock.textContent = '残り ' + clockText(left);
    if (left <= 0 && !busy && Date.now() - saleAsked > 10000) {
      saleAsked = Date.now();
      api.gacha().then(function (r) { if (shown() && !busy) { apply(r); render(); } }, function () {});
    }
  }
  function showOdds() {
    if (!state || busy) return;
    // The rules are shared with the server. Advance its supplied time using a monotonic clock;
    // opening the probability sheet needs no request, even across a campaign boundary.
    var boost = boostOn();
    var key = kind + ':' + boost;
    ui.event.hidden = !boost;
    if (key !== oddsKey) {
      var fragment = document.createDocumentFragment();
      G.odds(kind, boost).forEach(function (entry) {
        var row = el('tr'); row.appendChild(el('td', '', G.label(entry))); row.appendChild(el('td', '', G.pct(entry.chance) + '%')); fragment.appendChild(row);
      });
      ui.rows.replaceChildren(fragment); oddsKey = key;
    }
    K.showModal('gacha-odds-modal');
  }
  function open() {
    if (!api.online || !api.hasToken()) { K.fail({ message: 'ログインしてから利用してください' }); return; }
    if (busy) return;
    if (shown() && state) return;
    K.showModal('gacha-modal');
    if (loading) return;
    var gen = ++generation; state = null; loading = true;
    ui.controls.hidden = true; ui.items.hidden = true;
    document.getElementById('gacha-status').textContent = '読み込み中…';
    document.querySelector('#gacha-modal .gacha-card').scrollTop = 0;
    api.gacha().then(function (r) {
      if (gen !== generation) return; loading = false; apply(r); document.getElementById('gacha-status').textContent = ''; render();
      if (lastDraw && shown()) showResults(lastDraw);
    }, function (e) { if (gen === generation) { loading = false; document.getElementById('gacha-status').textContent = e.message; } });
  }
  BR.gacha = {
    open: open,
    reset: function () { generation++; clearTimer(); busy = false; state = null; pending = null; lastDraw = null; loading = false; if (reveal) { reveal.hidden = true; ui.results.replaceChildren(); } document.getElementById('confirm').classList.remove('gc-confirm'); },
    init: function () {
      root = document.getElementById('gacha-modal'); reveal = document.getElementById('gacha-reveal');
      ['controls', 'items', 'event', 'wallet', 'results'].forEach(function (key) { ui[key] = document.getElementById('gacha-' + key); });
      ui.odds = document.getElementById('gacha-odds-open'); ui.rows = document.getElementById('gacha-odds-rows');
      // Register the odds layer first so Escape closes it before its parent.
      K.registerModal('gacha-odds-modal'); K.registerModal('gacha-modal');
      document.getElementById('gacha-odds-open').addEventListener('click', showOdds);
      document.getElementById('gacha-result-close').addEventListener('click', closeResults);
      sellUi = { box: document.getElementById('gacha-sell'), list: document.getElementById('gacha-sell-list'), total: document.getElementById('gacha-sell-total'), go: document.getElementById('gacha-sell-go'), rows: {} };
      document.getElementById('gacha-sell-close').addEventListener('click', closeSell);
      sellUi.go.addEventListener('click', sellPicked);
      setInterval(function () { if (shown()) tick(); }, 1000);
      document.getElementById('gacha-skip').addEventListener('click', function () { skipped = true; if (pending) showResults(pending); });
      root.addEventListener('closed', function () {
        clearTimer(); K.closeModal('gacha-odds-modal'); reveal.hidden = true; closeSell();
        if (pending) { pending = null; busy = false; }
      });
      document.addEventListener('visibilitychange', function () { if (document.hidden && pending) showResults(pending); });
    }
  };
})(window.BR = window.BR || {});
