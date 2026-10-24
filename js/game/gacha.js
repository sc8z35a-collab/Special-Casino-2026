/* Capsule gacha rules shared by the browser and both server hosts.
   The server supplies cryptographically secure random values and settles every
   reward. The browser uses the same prices, campaign windows and odds table. */
(function (BR) {
  'use strict';

  var DAY = 86400000;
  var JST = 9 * 3600000;
  var CARS = [
    { id: 'two-state-sedan', name: 'Two state セダン' },
    { id: 'blue-lightning', name: 'ブルーライトニング' },
    { id: 'onvoro', name: 'オンヴォーロ' },
    { id: 'ferrari-325', name: 'フェラーリ325' },
    { id: 'mercedes-benz-one', name: 'メルセデスベンツ one' },
    { id: 'lamborghini-aventador', name: 'ランボルギーニアベンタドール' },
    { id: 'lamborghini-urus', name: 'ランボルギーニウルス' },
    { id: 'lamborghini-kuia-spyder', name: 'ランボルギーニクイヤスパイダー' },
    { id: 'nissan-gt-r', name: '日産 GT-R' },
    { id: 'lamborghini-revuelto', name: 'ランボルギーニ レヴエルト' },
    { id: 'mercedes-amg-one-white', name: 'メルセデスAMG ONE（ホワイト）' },
    { id: 'porsche-kuia-spyder', name: 'ポルシェクイヤスパイダー' }
  ];
  var RARE = [
    { id: 'lot', name: 'ロットコイン', chance: 30 },
    { id: 'royal', name: 'ロイヤルコイン', chance: 20 },
    { id: 'seed', name: '金の生る木の種', chance: 0.01 },
    { id: 'grown-tree', name: '金の生る木（成長済みノーマル個体）', chance: 0.005 },
    { id: 'garage', name: 'ガレージコイン', chance: 10 },
    { id: 'reset', name: 'リセットチケット', chance: 15 },
    { id: 'vip-week', name: 'VIP1週間券', chance: 14 },
    { id: 'onvoro', name: 'オンヴォーロ', chance: 5, car: true, carId: 'onvoro' },
    { id: 'porsche', name: 'ポルシェクイヤスパイダー', chance: 2, car: true, carId: 'porsche-kuia-spyder' },
    { id: 'random-car', name: 'ランダムな車', chance: 3.985, car: true }
  ];

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
  function price(count, saleOn) {
    var normal = count === 10 ? 45000000 : 5000000;
    return saleOn ? Math.round(normal * (count === 10 ? 0.85 : 0.9)) : normal;
  }
  function odds(kind, boostOn) {
    var base = kind === 'rare' ? RARE : [{ id: 'random-car', name: 'ランダムな車', chance: 100, car: true }];
    if (!boostOn) return base.map(function (x) { return Object.assign({}, x); });
    var carTotal = base.reduce(function (n, x) { return n + (x.car ? x.chance : 0); }, 0);
    var boostedTotal = Math.min(100, carTotal * 2.5);
    if (!carTotal || boostedTotal >= 100) return base.map(function (x) { return Object.assign({}, x); });
    var otherScale = (100 - boostedTotal) / (100 - carTotal);
    return base.map(function (x) {
      var out = Object.assign({}, x);
      out.chance = x.car ? x.chance * 2.5 : x.chance * otherScale;
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
  function drawOne(kind, boostOn, rand) {
    var hit = pick(odds(kind, boostOn), rand), out = { type: hit.id, name: hit.name, car: !!hit.car };
    if (hit.id === 'lot') {
      out.amount = (10 + Math.floor(rand() * 16)) * 1000;
      out.name = 'ロットコイン' + out.amount.toLocaleString('en-US') + '個';
    } else if (hit.id === 'royal') {
      out.amount = 8 + Math.floor(rand() * 5);
      out.name = 'ロイヤルコイン' + out.amount + '個';
    } else if (hit.id === 'garage' || hit.id === 'reset' || hit.id === 'vip-week' || hit.id === 'seed') {
      out.amount = 1;
    } else if (hit.car) {
      var c = hit.carId ? car(hit.carId) : CARS[Math.floor(rand() * CARS.length)];
      out.type = 'car'; out.carId = c.id; out.name = c.name;
    }
    return out;
  }
  function draw(kind, count, boostOn, saleOn, rand) {
    var pulls = [];
    for (var i = 0; i < count; i++) {
      var rewards = [], n = kind === 'rare' ? 3 : 1;
      for (var j = 0; j < n; j++) rewards.push(drawOne(kind, boostOn, rand));
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

  BR.GACHA = {
    cars: CARS, rare: RARE, events: events, price: price, odds: odds, draw: draw,
    pct: pct, car: car, day: DAY, grownGiven: 1500000
  };
})(globalThis.BR = globalThis.BR || {});
