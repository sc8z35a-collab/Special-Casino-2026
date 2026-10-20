/* 金の生る木: what a tree earns and how it looks, from BR.CONFIG.tree (the
   server pays by these, the game shows them). */
(function (BR) {
  'use strict';

  var T = BR.CONFIG.tree;

  // $ a second for `given` $ given to the tree: a straight line between the
  // points of T.rate (more with every bit given), flat after the last
  function rateOf(given) {
    var pts = T.rate, g = Math.max(0, given || 0);
    if (g >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (var i = 1; i < pts.length; i++) {
      if (g < pts[i][0]) {
        var a = pts[i - 1], b = pts[i];
        return a[1] + (b[1] - a[1]) * (g - a[0]) / (b[0] - a[0]);
      }
    }
    return pts[0][1];
  }
  // the look, 1..9
  function stageOf(given) {
    var s = 1;
    for (var i = 1; i < T.stages.length; i++) if ((given || 0) >= T.stages[i]) s = i + 1;
    return s;
  }
  function cycleOf(id) {
    for (var i = 0; i < T.cycles.length; i++) if (T.cycles[i].id === id) return T.cycles[i];
    return null;
  }
  // the average winning price at an auction for one more tree, `owned` trees owned now
  function averagePrice(market, owned) {
    var m = T.markets[market];
    return m ? (owned <= 1 ? m.second : m.more) : 0;
  }

  BR.TREE = { rules: T, rateOf: rateOf, stageOf: stageOf, cycleOf: cycleOf, averagePrice: averagePrice, stages: T.stages.length };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
