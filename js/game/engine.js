/* Spin outcome generation + centre-line evaluation. */
(function (BR) {
  'use strict';

  var C = BR.CONFIG, U = BR.util;
  // weights -> [[cumulative probability, symbol], ...] (one table per set of weights)
  var tables = [];
  function table(weights) {
    for (var t = 0; t < tables.length; t++) if (tables[t].w === weights) return tables[t].c;
    var c = [], acc = 0;
    C.symbols.forEach(function (s) { acc += weights[s]; c.push([acc, s]); });
    c[c.length - 1][0] = 1; // guard against float drift
    tables.push({ w: weights, c: c });
    return c;
  }

  // one symbol, by C.weights or by the `weights` given (a hub's)
  function drawSymbol(weights) {
    var cumulative = table(weights || C.weights);
    var r = U.random();
    for (var i = 0; i < cumulative.length; i++) if (r < cumulative[i][0]) return cumulative[i][1];
    return cumulative[cumulative.length - 1][1];
  }

  // Evaluate the centre line (array of 5 symbol ids).  Every symbol pays on its
  // own count; several winning combinations on the line are added together.
  function evaluate(line, bet) {
    var wins = [], mult = 0;
    C.symbols.forEach(function (s) {
      var cols = [];
      line.forEach(function (x, i) { if (x === s) cols.push(i); });
      var m = C.pays[s][cols.length];
      if (m) {
        wins.push({ symbol: s, count: cols.length, mult: m, amount: Math.floor(bet * m), cols: cols });
        mult += m;
      }
    });
    var total = wins.reduce(function (a, w) { return a + w.amount; }, 0);
    var tier = 0;
    if (total > 0) tier = mult >= C.tiers.superBig ? 3 : mult >= C.tiers.big ? 2 : 1;
    return { wins: wins, mult: mult, total: total, tier: tier };
  }

  // grid[reel][row] with row 0 = top, 1 = centre (pay line), 2 = bottom;
  // `weights`: other odds than C.weights (a hub's)
  function spin(bet, weights) {
    var grid = [];
    for (var r = 0; r < 5; r++) grid.push([drawSymbol(weights), drawSymbol(weights), drawSymbol(weights)]);
    var line = grid.map(function (col) { return col[1]; });
    var res = evaluate(line, bet);
    res.grid = grid;
    res.line = line;
    res.bet = bet;
    return res;
  }

  BR.engine = { spin: spin, evaluate: evaluate, drawSymbol: drawSymbol };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
