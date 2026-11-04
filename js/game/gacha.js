/* Capsule gacha rules shared by the browser and both server hosts.
   The server supplies cryptographically secure random values and settles every
   reward. The browser uses the same prices, campaign windows and odds table. */
(function (BR) {
  'use strict';

  var DAY = 86400000;
  var JST = 9 * 3600000;
  // every car a prize may be (a player's won one waiting to be taken too: the ended ones, the K110), by Car Owner's
  // list (js/game/config.js); `DRAW`: the ones a ランダムな車 may be — every car on sale, none that ended
  var CARS = ((BR.CONFIG && BR.CONFIG.cars) || []).filter(function (c) { return c.price > 0; }).map(function (c) { return { id: c.id, name: c.name }; });
  var DRAW = ((BR.CONFIG && BR.CONFIG.cars) || []).filter(function (c) { return c.price > 0 && !c.ended; }).map(function (c) { return { id: c.id, name: c.name }; });
  var RARE = [
    { id: 'lot', name: 'ロットコイン', chance: 30, min: 10000, max: 25000, step: 1000 },
    { id: 'royal', name: 'ロイヤルコイン', chance: 20, min: 8, max: 12, step: 1 },
    { id: 'seed', name: '金の生る木の種', chance: 0.01 },
    { id: 'grown-tree', name: '金の生る木（成長済みノーマル個体）', chance: 0.005 },
    { id: 'garage', name: 'ガレージコイン', chance: 10 },
    { id: 'reset', name: 'リセットチケット', chance: 23.3 },
    { id: 'vip-week', name: 'VIP1週間券', chance: 14 },
    { id: 'onvoro', name: 'MAGITA オンヴォーロ', chance: 1.7, car: true, carId: 'onvoro' },
    // (the K110 — once the クイヤスパイダーGT — no longer given: its chance a ランダムな車's)
    { id: 'random-car', name: 'ランダムな車', chance: 0.985, car: true }
  ];
  var LEGENDARY = [
    { id: 'lot', name: 'ロットコイン', chance: 10, min: 10000, max: 40000, step: 1000 },
    { id: 'royal', name: 'ロイヤルコイン', chance: 10, min: 20, max: 32, step: 1 },
    { id: 'garage', name: 'ガレージコイン', chance: 20, amount: 1 },
    { id: 'reset', name: 'リセットチケット', chance: 21.06, amount: 2 },
    { id: 'vip-week', name: 'VIP1週間券', chance: 24 },
    { id: 'onvoro', name: 'MAGITA オンヴォーロ', chance: 3.5, car: true, carId: 'onvoro' },
    { id: 'random-car', name: 'ランダムな車', chance: 10.435, car: true },
    { id: 'seed', name: '金の生る木の種', chance: 1 },
    { id: 'grown-tree', name: '金の生る木（成長済みノーマル個体）', chance: 0.005 }
  ];
  var SECRET = [
    { id: 'lot', name: 'ロットコイン', chance: 10, min: 100000, max: 300000, step: 1000 },
    { id: 'royal-high', type: 'royal', name: 'ロイヤルコイン', chance: 19, min: 90, max: 120, step: 1 },
    { id: 'royal', name: 'ロイヤルコイン', chance: 8, min: 30, max: 60, step: 1 },
    { id: 'garage', name: 'ガレージコイン', chance: 8, amount: 4 },
    { id: 'reset', name: 'リセットチケット', chance: 10, amount: 3 },
    { id: 'vip-week', name: 'VIP1週間券', chance: 24 },
    { id: 'random-car', name: 'ランダムな車', chance: 20, car: true },
    { id: 'seed', name: '金の生る木の種', chance: 1 }
  ];
  var TABLES = { rare: RARE, legendary: LEGENDARY, secret: SECRET };
  // `price`: one pull (一連: `SLOTS` slots, the secret one `slots` of its own)
  var SLOTS = 2;
  var KINDS = [
    { id: 'rare', name: 'レアガチャ', price: 4500000 },
    { id: 'legendary', name: 'レジェンダリーガチャ', price: 27000000 },
    // (3 slots a pull from 2026-11-04: its price a little below the 3-slot $67.5M that its old return a slot would make)
    { id: 'secret', name: 'シークレットガチャ', price: 60000000, slots: 3 }
  ];
  // リリース記念セール: the secret gacha at this a pull for `hours` from when the server first ran with it
  // (server/core/gacha.js keeps that moment and tells the game when the sale ends)
  var RELEASE_SALE = { kind: 'secret', price: 54000000, hours: 100 };
  // what the players can sell what the gacha gave them for, a piece (each bought back by the company that provides
  // it: the VIP1週間券 DAIZIN, the reset tickets YOSIDA, a garage coin — an empty place of one's garage — MAGITA, a
  // money tree's seed YOSIDA, at what it pays one whose trees are all there: CORP.yosida.gacha.treePay)
  var SELL = { 'vip-week': 200000, 'reset-5h': 250000, 'reset-day': 350000, garage: 350000, seed: 3000000 };

  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function weekStart(now) {
    var d = new Date(now + JST);
    var back = (d.getUTCDay() + 6) % 7;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back) - JST;
  }
  function windowFor(id, week) {
    // One independent 24-hour window per Japan-time week, wholly inside it.
    var minute = hash(id + ':' + week) % (6 * 24 * 60);
    var start = week + minute * 60000;
    return { start: start, end: start + DAY };
  }
  function campaign(id, now) {
    var week = weekStart(now), current = windowFor(id, week);
    var on = now >= current.start && now < current.end;
    var next = now < current.start ? current.start : windowFor(id, week + 7 * DAY).start;
    return { on: on, start: current.start, end: current.end, next: next };
  }
  function events(now) {
    return { boost: campaign('probability-up', now), sale: campaign('big-sale', now) };
  }
  // `sale`: the リリース記念セール is on (its kind costs its sale price a pull; 3 and 10 pulls keep their discount)
  // the slots of one pull of a kind
  function slotsOf(kind) {
    var tier = KINDS.filter(function (k) { return k.id === kind; })[0];
    return (tier && tier.slots) || SLOTS;
  }
  function price(kind, count, sale) {
    var tier = KINDS.filter(function (k) { return k.id === kind; })[0];
    if (!tier || (count !== 1 && count !== 3 && count !== 10)) throw new RangeError('Unknown gacha bundle');
    var one = sale && kind === RELEASE_SALE.kind ? RELEASE_SALE.price : tier.price;
    return Math.round(one * count * (count === 3 ? 0.9 : count === 10 ? 0.75 : 1));
  }
  function odds(kind, boostOn) {
    if (!Object.prototype.hasOwnProperty.call(TABLES, kind)) throw new RangeError('Unknown gacha kind');
    var base = TABLES[kind];
    if (!boostOn) return base.map(function (x) { return Object.assign({}, x); });
    var carTotal = base.reduce(function (n, x) { return n + (x.car ? x.chance : 0); }, 0);
    var boostedTotal = Math.min(100, carTotal * 1.5);
    if (!carTotal || boostedTotal >= 100) return base.map(function (x) { return Object.assign({}, x); });
    var otherScale = (100 - boostedTotal) / (100 - carTotal);
    return base.map(function (x) {
      var out = Object.assign({}, x);
      out.chance = x.car ? x.chance * 1.5 : x.chance * otherScale;
      return out;
    });
  }
  function pick(table, rand) {
    var roll = rand() * 100, at = 0;
    for (var i = 0; i < table.length; i++) {
      at += table[i].chance;
      if (roll < at) return table[i];
    }
    return table[table.length - 1];
  }
  function car(id) {
    for (var i = 0; i < CARS.length; i++) if (CARS[i].id === id) return CARS[i];
    return null;
  }
  // a car's list price (the gacha-only one: what its maker sells it at, js/game/corp.js)
  var ONLY = { 'porsche-kuia-spyder': 24000000 };
  function carPrice(id) {
    var list = (BR.CONFIG && BR.CONFIG.cars) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id && list[i].price) return list[i].price;
    return ONLY[id] || 20000000;
  }
  // ランダムな車: of the cars on sale, the cheaper the likelier (by one over its price) — the dearest is a rare find,
  // not one in twelve
  function randomCar(rand) {
    var total = 0, i;
    for (i = 0; i < DRAW.length; i++) total += 1 / carPrice(DRAW[i].id);
    var roll = rand() * total;
    for (i = 0; i < DRAW.length; i++) { roll -= 1 / carPrice(DRAW[i].id); if (roll < 0) return DRAW[i]; }
    return DRAW[DRAW.length - 1];
  }
  function drawOne(table, rand) {
    var hit = pick(table, rand), out = { type: hit.type || hit.id, name: hit.name, car: !!hit.car };
    if (out.type === 'lot') {
      out.amount = hit.min + Math.floor(rand() * ((hit.max - hit.min) / hit.step + 1)) * hit.step;
      out.name = 'ロットコイン' + out.amount.toLocaleString('en-US') + '個';
    } else if (out.type === 'royal') {
      out.amount = hit.min + Math.floor(rand() * ((hit.max - hit.min) / hit.step + 1)) * hit.step;
      out.name = 'ロイヤルコイン' + out.amount + '個';
    } else if (hit.id === 'garage' || hit.id === 'reset' || hit.id === 'vip-week' || hit.id === 'seed') {
      out.amount = hit.amount || 1;
      if (hit.id === 'garage' || hit.id === 'reset') out.name += out.amount + '枚';
    } else if (hit.car) {
      var c = hit.carId ? car(hit.carId) : randomCar(rand);
      out.type = 'car'; out.carId = c.id; out.name = c.name;
    }
    return out;
  }
  function draw(kind, count, boostOn, saleOn, rand) {
    // Every slot in a purchase has the same table; build it once, including a 30-slot bundle.
    var table = odds(kind, boostOn), pulls = [];
    for (var i = 0; i < count; i++) {
      var rewards = [], n = slotsOf(kind);
      for (var j = 0; j < n; j++) rewards.push(drawOne(table, rand));
      var bonus = null;
      if (saleOn && rand() < 0.8) {
        var tier = rand();
        bonus = tier < 0.89 ? 4 : tier < 0.99 ? 12 + Math.floor(rand() * 5) : 20 + Math.floor(rand() * 13);
      }
      pulls.push({ rewards: rewards, bonus: bonus });
    }
    return pulls;
  }
  function pct(n) {
    if (n >= 10) return String(Math.round(n * 1000) / 1000);
    if (n >= 0.1) return String(Math.round(n * 100000) / 100000);
    return String(Math.round(n * 10000000) / 10000000);
  }
  function label(reward) {
    var type = reward.type || reward.id;
    if (type === 'lot' || type === 'royal') return reward.name + ' ' + reward.min.toLocaleString('en-US') + '〜' + reward.max.toLocaleString('en-US') + (type === 'lot' ? '個' : '枚');
    if (type === 'garage' || type === 'reset') return reward.name + ' ' + (reward.amount || 1) + '枚';
    return reward.name;
  }

  BR.GACHA = {
    cars: CARS, pool: DRAW, carPrice: carPrice, randomCar: randomCar, rare: RARE, legendary: LEGENDARY, secret: SECRET, kinds: KINDS, slots: SLOTS, slotsOf: slotsOf, sell: SELL, releaseSale: RELEASE_SALE, events: events, price: price, odds: odds, draw: draw,
    pct: pct, label: label, car: car, day: DAY, grownGiven: 1500000
  };
})(globalThis.BR = globalThis.BR || {});
