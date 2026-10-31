/* 投資: the two companies, the fee, the limits and the charts' periods (the
   server trades by these, server/core/stocks.js; the game shows them,
   js/ui/stocks.js). Prices are whole dollars, a trading day runs from 9:00
   to 9:00 Japan time (a UTC day), and the market never closes. */
(function (BR) {
  'use strict';

  var DAY = 86400;
  // vol: the day's standard deviation of the price's moves (a log return);
  // dividend: paid each day on the day's average holding, at the day's close;
  // band: how far (in log price) from `base` the price wanders freely
  // (RIRU about 0.45–2.2 times its base, Ice Smoker 0.74–1.35 times)
  var COMPANIES = [
    { id: 'riru', name: 'RIRU STUDIO', full: 'RIRU STUDIO株式会社', ticker: 'RIRU', base: 12000, vol: 0.07, dividend: 0.002, band: 0.8 },
    { id: 'ice', name: 'Ice Smoker', full: 'Ice Smoker株式会社', ticker: 'ICE', base: 30000, vol: 0.025, dividend: 0.004, band: 0.3 },
    // listed with the country of people (js/game/npc.js): the carmaker and the bank, at their books' prices
    { id: 'magita', name: 'MAGITA', full: '株式会社MAGITA', ticker: 'MGT', base: 18000, vol: 0.03, dividend: 0.003, band: 0.35 },
    { id: 'tenesice', name: 'テネシス', full: '株式会社テネシス', ticker: 'TNS', base: 60000, vol: 0.015, dividend: 0.003, band: 0.25 }
  ];
  // 1.8% each way (Dtrade's, three times the 0.6% it began at), in hundredths of a percent
  var FEE_BP = 180;

  // span: seconds a candle; count: how many; from: the stored candles they are made of
  var PERIODS = [
    { id: '1h', span: 60, count: 60, from: 60 },
    { id: '1d', span: 300, count: 288, from: 60 },
    { id: '1w', span: 3600, count: 168, from: 3600 },
    { id: '1m', span: 14400, count: 186, from: 3600 },
    { id: '1y', span: DAY, count: 366, from: DAY },
    { id: 'all', span: 7 * DAY, count: 520, from: DAY }
  ];

  function company(id) {
    for (var i = 0; i < COMPANIES.length; i++) if (COMPANIES[i].id === id) return COMPANIES[i];
    return null;
  }
  function period(id) {
    for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].id === id) return PERIODS[i];
    return null;
  }
  // the fee on `value` $ of shares, rounded up (exact: value * FEE_BP is a whole number)
  // (the fee as it is now: the country's people may lower it, js/game/npc.js knobs, and the server says so)
  function fee(value) { return value > 0 ? Math.ceil(value * BR.STOCKS.feeBp / 10000) : 0; }
  // what buying costs and selling brings, fee included
  function buyAmount(price, shares) { var v = price * shares; return v + fee(v); }
  function sellAmount(price, shares) { var v = price * shares; return v - fee(v); }
  // the trading day of a moment (ms), and when it ends
  function dayOf(ms) { return Math.floor(ms / 86400000); }
  function dayEnd(ms) { return (dayOf(ms) + 1) * 86400000; }
  // where a candle of `span` seconds starts (weeks from Monday 9:00 Japan time)
  function bucket(at, span) {
    var shift = span === 7 * DAY ? 4 * DAY : 0;
    return Math.floor((at - shift) / span) * span + shift;
  }

  // A chart as the server sends it (columns of small numbers; every open is the
  // close before it plus o[i]) back into candles { at, o, h, l, c, v }.
  function decode(ch) {
    var out = [], prev = ch.base, n = ch.c ? ch.c.length : 0;
    for (var i = 0; i < n; i++) {
      var o = prev + (ch.o[i] || 0), c = o + ch.c[i];
      var hi = Math.max(o, c) + (ch.h[i] || 0), lo = Math.min(o, c) - (ch.l[i] || 0);
      out.push({ at: ch.t0 + i * ch.span, o: o, h: hi, l: lo, c: c, v: ch.v[i] || 0 });
      prev = c;
    }
    return out;
  }

  BR.STOCKS = {
    companies: COMPANIES,
    company: company,
    periods: PERIODS,
    period: period,
    feeBp: FEE_BP,
    fee: fee,
    buyAmount: buyAmount,
    sellAmount: sellAmount,
    // held investments (at the price now) and the money held for buy orders: both companies together
    cap: 8000000,
    // trades a trading day: every order counts once (an order that waits holds its count; cancelled, it gives it back)
    tradesPerDay: 30,
    // limit and stop orders waiting at once
    openOrders: 10,
    // a limit / stop price is at most this far from the price now
    priceRange: 0.3,
    // a stop buy holds this much more than its price × shares (the price may pass the stop by a dollar or two)
    stopMargin: 0.01,
    maxShares: 100000,
    dayOf: dayOf,
    dayEnd: dayEnd,
    bucket: bucket,
    decode: decode
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
