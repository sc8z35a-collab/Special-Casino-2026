/* VIP, shared by the browser and the server (server/core/rules.js), so both
   count the same way (the numbers: BR.CONFIG.vip). ロイヤルコイン make days of
   it (a day: 24 hours), or a まとめ買い pack with free days; VIP EXP makes its
   level, VIP0 to VIP3, kept for good; what a level gives only counts while
   VIP is on. The free trial gives VIP3 while it lasts. */
(function (BR) {
  'use strict';

  var DAY = 86400000;
  function V() { return BR.CONFIG.vip; }

  function level(exp) {
    var L = V().levels, l = 0;
    for (var i = 1; i < L.length; i++) if ((exp || 0) + 1e-9 >= L[i]) l = i;
    return l;
  }

  // the level VIP gives at `now`: the trial's while it lasts, else the EXP's (null: off)
  function current(until, exp, trialUntil, now) {
    if (!(until > now)) return null;
    return trialUntil > now ? V().trial.level : level(exp);
  }

  BR.VIP = {
    day: DAY,
    level: level,
    current: current,
    // the same for the account's VIP as the server sends it ({ until, exp, trialUntil })
    now: function (v, t) { return v ? current(v.until, v.exp, v.trialUntil || 0, t === undefined ? Date.now() : t) : null; },
    // まとめ買い: the packs on sale now ([]: none), one by its days, and how much more it gives (%)
    packs: function () { var p = V().packs; return p && p.sale ? p.list : []; },
    pack: function (days) { return BR.VIP.packs().filter(function (p) { return p.days === days; })[0] || null; },
    deal: function (p) { return Math.round(p.bonus / p.days * 100); },
    max: function () { return V().levels.length - 1; },
    // { level, exp, from: the EXP this level starts at, next: the next level's (0: the last) }
    info: function (exp) {
      var L = V().levels, l = level(exp);
      return { level: l, exp: exp || 0, from: L[l], next: l + 1 < L.length ? L[l + 1] : 0 };
    },
    // `days` more days at `level`: coins taken, and given back from VIP1
    cost: function (days, lv) {
      var v = V();
      return { coins: v.coins * days, back: lv >= v.refund.from ? v.refund.coins * days : 0 };
    },
    // what the バイト being worked pay while VIP is on
    wage: function (lv) { return V().wage[lv] || 1; },
    // $ (not rounded) a job paying `wage` an hour has earned from `since` to
    // `now`, VIP's part (up to `until`) at `mult` times, the trial's (up to
    // `trialUntil`, inside VIP's) at `trialMult` times
    earned: function (wage, since, now, until, mult, trialUntil, trialMult) {
      var on = function (end) { return Math.max(0, Math.min(now, end || 0) - since); };
      var extra = (mult - 1) * on(until) + (trialMult > mult ? (trialMult - mult) * on(trialUntil) : 0);
      return wage * (Math.max(0, now - since) + extra) / 3600000;
    },
    // an ULTRA BIG WIN pays this many times
    ultra: function (lv) { return lv >= 1 ? V().ultra : 1; },
    // the call quality tier: 0 no VIP, 1 VIP0-1, 2 VIP2-3 (`lv` null: no VIP)
    tier: function (lv) { return lv === null || lv === undefined ? 0 : lv >= 2 ? 2 : 1; },
    kbps: function (tier) { var k = V().voice; return k[Math.max(0, Math.min(k.length - 1, tier | 0))]; },
    // the tier every call has for now, whoever is in it (0: none; 3: above VIP3)
    boost: function () { return V().voiceAll || 0; },
    // a car the level may buy (`vip` on a car: the level it is for)
    carOpen: function (car, lv) { return !car.vip || (lv !== null && lv !== undefined && lv >= car.vip); }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
