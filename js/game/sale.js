/* The icon sale, shared with the server: every paid icon is always on sale
   at 10-40 % off, with a new discount for each icon every UTC day. */
(function (BR) {
  'use strict';

  var STEPS = [10, 15, 20, 25, 30, 35, 40];

  // FNV-1a: the same small hash in every browser and on the server
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  BR.sale = {
    // discount in percent of icon `id` on `day` (BR.util.utcDay() format)
    pct: function (id, day) {
      return STEPS[hash(day + '/' + id) % STEPS.length];
    },
    // what the icon costs that day (0 for free icons)
    price: function (avatar, day) {
      if (!avatar || !(avatar.price > 0)) return 0;
      return Math.round(avatar.price * (100 - BR.sale.pct(avatar.id, day)) / 10000) * 100;
    }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
