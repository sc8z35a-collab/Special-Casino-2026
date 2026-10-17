/* Spin outcome generation + centre-line evaluation. */
(function (BR) {
  'use strict';

  var C = BR.CONFIG, U = BR.util;
  var cumulative = [];
  (function () {
    var acc = 0;
    C.symbols.forEach(function (s) { acc += C.weights[s]; cumulative.push([acc, s]); });
    cumulative[cumulative.length - 1][0] = 1; // guard against float drift
  })();

  function drawSymbol() {
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

  // grid[reel][row] with row 0 = top, 1 = centre (pay line), 2 = bottom
  function spin(bet) {
    var grid = [];
    for (var r = 0; r < 5; r++) grid.push([drawSymbol(), drawSymbol(), drawSymbol()]);
    var line = grid.map(function (col) { return col[1]; });
    var res = evaluate(line, bet);
    res.grid = grid;
    res.line = line;
    res.bet = bet;
    return res;
  }

  BR.engine = { spin: spin, evaluate: evaluate, drawSymbol: drawSymbol };
})(window.BR = window.BR || {});
