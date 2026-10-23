/* VIP, shared by the browser and the server (server/core/rules.js), so both
   count the same way (the numbers: BR.CONFIG.vip). ロイヤルコイン make days of
   it (a day: 24 hours), or a まとめ買い pack with free days; VIP EXP makes its
   level (indices 0-5, labels 0/1/2/3/3.1/4), kept for good.
   Earned VIP4 keeps VIP2 benefits after the paid period expires. The free trial gives VIP3 while it lasts. */
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
    if (!(until > now)) return level(exp) >= V().permanent.from ? V().permanent.level : null;
    return trialUntil > now ? Math.max(V().trial.level, level(exp)) : level(exp);
  }

  BR.VIP = {
    day: DAY,
    level: level,
    current: current,
    label: function (lv) { return V().labels[lv] === undefined ? String(lv) : V().labels[lv]; },
    permanent: function (exp) { return level(exp) >= V().permanent.from; },
    badge: function (v, t) {
      if (!v) return null;
      return BR.VIP.permanent(v.exp) ? level(v.exp) : BR.VIP.now(v, t);
    },
    carDiscount: function (lv) { return lv === null || lv === undefined ? 0 : lv >= 4 ? V().carOff31 : V().carOff; },
    earlyAccess: function (lv) { return lv === null || lv === undefined ? 0 : lv >= 4 ? 2 : 1; },
    mode: function (name) { return Object.prototype.hasOwnProperty.call(V().modes, name) ? V().modes[name] : null; },
    intervals: function (json) {
      var list;
      try { list = typeof json === 'string' ? JSON.parse(json || '[]') : json; } catch (e) { return []; }
      return Array.isArray(list) ? list.filter(function (p) {
        return p && Number.isSafeInteger(p.start) && Number.isSafeInteger(p.end) && p.end > p.start
          && (p.mode === 'pro' || p.mode === 'ultra');
      }) : [];
    },
    modeAt: function (intervals, now) {
      var found = BR.VIP.intervals(intervals).filter(function (p) { return now >= p.start && now < p.end; });
      return found.length ? found[found.length - 1].mode : 'normal';
    },
    multiplier: function (intervals, now) { return BR.VIP.mode(BR.VIP.modeAt(intervals, now)).multiplier; },
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
    cost: function (days, lv, mode) {
      var v = V();
      var extra = BR.VIP.mode(mode || 'normal');
      return { coins: v.coins * days + (extra ? extra.coins : 0), back: lv >= v.refund.from ? v.refund.coins * days : 0 };
    },
    // A cart is quoted from the current offers; clients cannot set prices,
    // free days or ticket gifts. Repeated plans become one quantity badge.
    cart: function (items, lv, mode) {
      if (!Array.isArray(items) || !items.length || items.length > 32) return null;
      var by = {}, bought = 0, bonus = 0, tickets = 0;
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (!item || !Number.isSafeInteger(item.days) || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 365) return null;
        var p = BR.VIP.pack(item.days);
        if (!p) return null;
        by[p.days] = (by[p.days] || 0) + item.qty;
        bought += p.days * item.qty;
        bonus += p.bonus * item.qty;
        tickets += (p.resetTickets || 0) * item.qty;
      }
      var cost = BR.VIP.cost(bought, lv, mode);
      return { packs: Object.keys(by).map(function (days) { return { days: Number(days), qty: by[days] }; }),
        bought: bought, bonus: bonus, days: bought + bonus, coins: cost.coins, back: cost.back, resetTickets: tickets };
    },
    // what the バイト being worked pay while VIP is on
    wage: function (lv) { return V().wage[lv] || 1; },
    // $ (not rounded) a job paying `wage` an hour has earned from `since` to
    // `now`, VIP's part (up to `until`) at `mult` times, the trial's (up to
    // `trialUntil`, inside VIP's) at `trialMult` times
    earned: function (wage, since, now, until, mult, trialUntil, trialMult, permanentAt) {
      var on = function (end) { return Math.max(0, Math.min(now, end || 0) - since); };
      var extra = (mult - 1) * on(until) + (trialMult > mult ? (trialMult - mult) * on(trialUntil) : 0);
      if (permanentAt > 0) extra += (BR.VIP.wage(V().permanent.level) - 1) * Math.max(0, now - Math.max(since, until || 0, permanentAt));
      return wage * (Math.max(0, now - since) + extra) / 3600000;
    },
    // an ULTRA BIG WIN pays this many times
    ultra: function (lv) { return lv >= 1 ? V().ultra : 1; },
    // the call quality tier: 0 no VIP, 1 VIP0-1, 2 VIP2-3 (`lv` null: no VIP)
    tier: function (lv) { return lv === null || lv === undefined ? 0 : lv >= 4 ? 4 : lv >= 2 ? 2 : 1; },
    kbps: function (tier) { var k = V().voice; return k[Math.max(0, Math.min(k.length - 1, tier | 0))]; },
    // the tier every call has for now, whoever is in it (0: none; 3: above VIP3)
    boost: function () { return V().voiceAll || 0; },
    // a car the level may buy (`vip` on a car: the level it is for)
    carOpen: function (car, lv) { return !car.vip || (lv !== null && lv !== undefined && lv >= car.vip); }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
