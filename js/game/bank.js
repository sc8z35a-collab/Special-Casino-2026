/* The economy behind the slot: spins, token purchases and the daily gift.
   Offline (single-file build) everything is settled in the browser; online
   the server settles it and the browser only mirrors the balances. */
(function (BR) {
  'use strict';

  var U = BR.util, C = BR.CONFIG, S = BR.store.state, api = BR.api;
  var online = api.online;
  // server counters, online mode only
  var srv = { ready: false, me: null, dailyReady: false, boughtToday: 0, nextReset: 0, offset: 0, rules: null };

  function fail(code, message) { return Promise.reject(new api.ApiError(409, code, message)); }
  function serverNow() { return Date.now() + srv.offset; }
  function rolledOver() { return srv.nextReset > 0 && serverNow() >= srv.nextReset; }

  // Balances carry a revision number; anything older than what we show is dropped.
  function applyBalance(b) {
    if (!b) return false;
    if (typeof b.rev === 'number' && typeof S.rev === 'number' && b.rev < S.rev) return false;
    S.tokens = b.tokens;
    S.dollars = b.dollars;
    S.coins = b.coins;
    if (typeof b.rev === 'number') S.rev = b.rev;
    return true;
  }

  // `keepBalance`: only take the counters (the caller queues the balance itself)
  function applyMe(me, keepBalance) {
    if (!keepBalance) applyBalance(me);
    srv.me = me;
    srv.dailyReady = me.dailyReady;
    srv.boughtToday = me.boughtToday;
    S.stats = { spins: me.spins, won: me.totalWon, biggest: me.biggestWin };
  }

  function boughtToday() {
    if (online) return rolledOver() ? 0 : srv.boughtToday;
    BR.store.dayRoll();
    return S.boughtToday;
  }

  function maxBuy() {
    return Math.max(0, Math.min(Math.floor(S.dollars / C.tokenPrice), C.dailyLimit - boughtToday()));
  }

  var local = {
    // settles asynchronously like the server does
    spin: function (bet) {
      return Promise.resolve().then(function () {
        if (S.tokens < bet) return fail('insufficient', 'スピントークンが不足しています');
        var res = BR.engine.spin(bet);
        S.tokens = S.tokens - bet + res.total;
        S.stats.spins++;
        S.stats.won += res.total;
        S.stats.biggest = Math.max(S.stats.biggest, res.total);
        BR.store.save();
        return { result: res, balance: { tokens: S.tokens, dollars: S.dollars, coins: S.coins } };
      });
    },
    buy: function (n) {
      if (n > maxBuy()) return fail('limit', S.dollars < n * C.tokenPrice ? '$が足りません' : '本日の購入上限を超えています');
      S.dollars -= n * C.tokenPrice;
      S.tokens += n;
      S.boughtToday += n;
      BR.store.save();
      return Promise.resolve();
    },
    sell: function (n) {
      if (n > S.tokens) return fail('insufficient', 'スピントークンが足りません');
      S.tokens -= n;
      S.dollars += n * C.tokenPrice;
      BR.store.save();
      return Promise.resolve();
    },
    claimDaily: function () {
      if (S.freeDay === U.utcDay()) return fail('claimed', '今日の無料トークンは受け取り済みです');
      S.freeDay = U.utcDay();
      S.tokens += C.dailyFree;
      BR.store.save();
      return Promise.resolve(C.dailyFree);
    },
    refresh: function () { return Promise.resolve(); }
  };

  var remote = {
    spin: function (bet) {
      return api.spin(bet).then(function (r) {
        applyBalance(r.balance);
        S.stats = { spins: r.stats.spins, won: r.stats.totalWon, biggest: r.stats.biggestWin };
        return r;
      });
    },
    buy: function (n) { return api.buy(n).then(function (r) { applyMe(r.me); }); },
    sell: function (n) { return api.sell(n).then(function (r) { applyMe(r.me); }); },
    claimDaily: function () {
      return api.daily().then(function (r) {
        applyMe(r.me);
        srv.nextReset = r.nextReset;
        return r.amount;
      });
    },
    refresh: function () {
      return api.me().then(function (r) {
        srv.offset = r.now - Date.now();
        srv.nextReset = r.nextReset;
        srv.rules = r.rules;
        srv.ready = true;
        applyMe(r.me);
        return r;
      });
    }
  };

  var impl = online ? remote : local;

  BR.bank = {
    online: online,
    spin: impl.spin,
    buy: impl.buy,
    sell: impl.sell,
    claimDaily: impl.claimDaily,
    refresh: impl.refresh,
    applyBalance: applyBalance,
    applyMe: applyMe,
    maxBuy: maxBuy,
    ready: function () { return !online || srv.ready; },
    // signed out: balances are unknown until the next refresh
    reset: function () { srv.ready = false; srv.me = null; S.rev = undefined; },
    me: function () { return srv.me; },
    rules: function () { return srv.rules; },
    dailyReady: function () {
      if (online) return srv.dailyReady || rolledOver();
      return S.freeDay !== U.utcDay();
    },
    secondsToReset: function () {
      if (online && srv.nextReset) return Math.max(0, Math.ceil((srv.nextReset - serverNow()) / 1000));
      return U.secondsToUtcMidnight();
    }
  };
})(window.BR = window.BR || {});
