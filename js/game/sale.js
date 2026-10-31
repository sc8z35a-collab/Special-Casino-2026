/* Sales, shared with the server (the same hours and prices everywhere):
   - the Shop (お守り加護): its 10-40 % off holds 5 hours a day only, from an
     hour of its own each Japan day (BR.sale.shop);
   - Car Owner, now and then, never two at once (BR.sale.cars; the odds and
     discounts are BR.CONFIG.carSales):
       極セール            5 % of the days: 5 hours, 2 cars 1-10 % off
       超極セール          5 % of the weeks: 24 hours, 5 cars 10-30 % off
       超ダイナミックセール  5 % of the months: 24 hours, 8 cars 20-45 % off
       年感謝セール        once a year on a day of its own: 24 hours, every car 10-30 % off
     A sale that would fall on a day a bigger one already has is called off
     (the yearly one comes first, then the monthly, the weekly, the daily);
   - the car buy-back (BR.sale.buyback): a car's price now (its sale price in
     a sale) less 10-35 %, a new rate for each car every Japan day; in a
     大廃棄セール (45 % of the fortnights, one day without a car sale) every
     car less only 2.5-10 %, the same for all. */
(function (BR) {
  'use strict';

  var STEPS = [10, 15, 20, 25, 30, 35, 40];
  var HOUR = 3600000, DAY = 86400000, JST = 9 * HOUR;

  // FNV-1a: the same small hash in every browser and on the server
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  // well stirred (keys that differ in one letter land far apart)
  function mix(h) {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  // 0 .. n-1, the same for the same key
  function pick(key, n) { return mix(hash(key)) % n; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // the Japan date of a moment
  function jday(ms) {
    var d = new Date(ms + JST);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), w: d.getUTCDay() };
  }
  function midnight(y, m, d) { return Date.UTC(y, m - 1, d) - JST; }   // 0:00 Japan time
  function dayKey(ms) { var t = jday(ms); return t.y + '-' + pad(t.m) + '-' + pad(t.d); }
  function round100(n) { return Math.round(n / 100) * 100; }

  /* ------------------------------------------------------------ the Shop: 5 hours a day --- */
  // that Japan day's sale hours (they end by midnight)
  function shopWindow(ms) {
    var t = jday(ms), k = dayKey(ms);
    var start = midnight(t.y, t.m, t.d) + pick('shop-hour/' + k, 20) * HOUR;
    return { day: k, start: start, end: start + 5 * HOUR };
  }

  /* ------------------------------------------------------------ Car Owner --- */
  // 0:00 (Japan time) of the day each sale falls on (0: none that time)
  function yearDay(y) {
    var len = Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / DAY);
    var d = new Date(Date.UTC(y, 0, 1) + pick('car-year/' + y, len) * DAY);
    return midnight(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  function monthDay(y, m) {
    var k = y + '-' + pad(m);
    if (pick('car-month/' + k + '/chance', 100) >= BR.CONFIG.carSales.month.chance) return 0;
    var len = new Date(Date.UTC(y, m, 0)).getUTCDate();
    var at = midnight(y, m, 1 + pick('car-month/' + k + '/day', len));
    return at === yearDay(y) ? 0 : at;
  }
  function mondayOf(dayMs) { return dayMs - ((jday(dayMs).w + 6) % 7) * DAY; }
  function weekDay(monday) {
    var k = dayKey(monday);
    if (pick('car-week/' + k + '/chance', 100) >= BR.CONFIG.carSales.week.chance) return 0;
    var at = monday + pick('car-week/' + k + '/day', 7) * DAY, t = jday(at);
    return at === yearDay(t.y) || at === monthDay(t.y, t.m) ? 0 : at;
  }
  // a day's 極セール: when it starts (0: none)
  function dayStart(dayMs) {
    var c = BR.CONFIG.carSales.day, t = jday(dayMs), k = dayKey(dayMs);
    if (pick('car-day/' + k + '/chance', 100) >= c.chance) return 0;
    if (dayMs === yearDay(t.y) || dayMs === monthDay(t.y, t.m) || dayMs === weekDay(mondayOf(dayMs))) return 0;
    return dayMs + pick('car-day/' + k + '/hour', 24 - c.hours + 1) * HOUR;
  }

  // is there a Car Owner sale on that Japan day (0:00 of it)?
  function saleDay(dayMs) {
    var t = jday(dayMs);
    return dayMs === yearDay(t.y) || dayMs === monthDay(t.y, t.m) || dayMs === weekDay(mondayOf(dayMs)) || !!dayStart(dayMs);
  }
  // the 大廃棄セール of the fortnight `ms` is in: its day (0:00 Japan time) and
  // its rate, or null (fortnights counted from Monday 2026-01-05)
  var FORTNIGHT0 = Date.UTC(2026, 0, 5) - JST;
  function disposal(ms) {
    var c = BR.CONFIG.carBuyback.disposal, i = Math.floor((ms - FORTNIGHT0) / (14 * DAY)), from = FORTNIGHT0 + i * 14 * DAY;
    if (pick('car-dispose/' + i + '/chance', 1000) >= c.chance * 10) return null;
    // a day of its own in the fortnight; a car sale's day passes it to the next free one
    var d0 = pick('car-dispose/' + i + '/day', 14);
    for (var k = 0; k < 14; k++) {
      var day = from + ((d0 + k) % 14) * DAY;
      if (saleDay(day)) continue;
      var steps = Math.round((c.max - c.min) / c.step) + 1;
      return { name: c.name, start: day, end: day + DAY, pct: c.min + pick('car-dispose/' + i + '/rate', steps) * c.step };
    }
    return null;
  }

  function carPriced(car) { return !!car && typeof car.price === 'number' && isFinite(car.price) && car.price > 0; }
  // a car Car Owner still sells (an `ended` one only bought back)
  function carSold(car) { return carPriced(car) && !car.ended; }

  // The Car Owner sale on at `ms`, or null: { kind, name, start, end, pct: { carId: % off } }
  function carSale(ms, cars) {
    var S = BR.CONFIG.carSales, t = jday(ms), today = midnight(t.y, t.m, t.d), on = null;
    if (yearDay(t.y) === today) on = { kind: 'year', start: today, key: 'car-year/' + t.y };
    else if (monthDay(t.y, t.m) === today) on = { kind: 'month', start: today, key: 'car-month/' + t.y + '-' + pad(t.m) };
    else if (weekDay(mondayOf(today)) === today) on = { kind: 'week', start: today, key: 'car-week/' + dayKey(mondayOf(today)) };
    else {
      var s = dayStart(today);
      if (s && ms >= s && ms < s + S.day.hours * HOUR) on = { kind: 'day', start: s, key: 'car-day/' + dayKey(today) };
    }
    if (!on) return null;
    var c = S[on.kind];
    // which cars (a shuffle of its own), and how much off each
    var order = (cars || BR.CONFIG.cars).filter(carSold).map(function (x) { return x.id; }).sort()
      .map(function (id) { return { id: id, r: mix(hash(on.key + '/order/' + id)) }; })
      .sort(function (a, b) { return a.r - b.r; });
    var pct = {};
    order.slice(0, c.cars ? Math.min(c.cars, order.length) : order.length).forEach(function (o) {
      pct[o.id] = c.min + pick(on.key + '/pct/' + o.id, c.max - c.min + 1);
    });
    return { kind: on.kind, name: c.name, start: on.start, end: on.start + c.hours * HOUR, pct: pct };
  }

  BR.sale = {
    // Older servers still call this accessor for portraits. Keep that call
    // compatible while charging only the catalog's fixed dollar price.
    price: function (avatar) { return avatar && avatar.price > 0 ? avatar.price : 0; },
    // Discount of a Shop item on the Japan date `day`.
    pct: function (id, day) {
      return STEPS[hash(day + '/' + id) % STEPS.length];
    },
    // A Shop item at `ms`: { price (what it costs now), pct (0 outside the sale
    // hours), on, start, end (today's sale hours), next (when the next ones begin) }
    shop: function (item, ms) {
      if (item.fixedPrice) return { price: item.price, pct: 0, on: false, start: 0, end: 0, next: 0 };
      var w = shopWindow(ms), on = ms >= w.start && ms < w.end;
      var pct = on ? BR.sale.pct(item.id, w.day) : 0;
      var next = ms < w.start ? w.start : shopWindow(midnight(jday(ms).y, jday(ms).m, jday(ms).d) + DAY).start;
      return { price: on ? round100(item.price * (100 - pct) / 100) : item.price, pct: pct, on: on, start: w.start, end: w.end, next: on ? w.start : next };
    },
    // the Car Owner sale on at `ms` (null: none), and a car's price then
    // (`off`: VIP's % off on top of it)
    cars: carSale,
    carPriced: carPriced,
    carSold: carSold,
    // (`extra`: MAGITA's surcharge on it, when the maker is struggling: added after the % off, server/core/corp.js)
    carPrice: function (car, sale, off, extra) {
      if (!carPriced(car)) return { price: null, pct: 0, vip: 0, extra: 0 };
      var pct = sale && sale.pct[car.id] || 0, all = pct + (off || 0);
      return { price: (all ? round100(car.price * (100 - all) / 100) : car.price) + (extra || 0), pct: pct, vip: off || 0, extra: extra || 0 };
    },
    // the 大廃棄セール on at `ms` (null: none)
    disposal: function (ms) {
      var d = disposal(ms);
      return d && ms >= d.start && ms < d.end ? d : null;
    },
    // What the buy-back pays for `car` at `ms`: its price now (`sale`: the car
    // sale on now) less `pct` % (the day's rate, or the 大廃棄セール's).
    buyback: function (car, ms, sale) {
      if (!carPriced(car)) return null;
      var b = BR.CONFIG.carBuyback, d = BR.sale.disposal(ms);
      var pct = d ? d.pct : b.min + pick('car-buyback/' + dayKey(ms) + '/' + car.id, b.max - b.min + 1);
      var now = BR.sale.carPrice(car, sale).price;
      return { price: round100(now * (100 - pct) / 100), pct: pct, disposal: !!d };
    }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
