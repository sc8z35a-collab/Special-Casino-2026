/* Quests and the player level, shared by the browser and the server
   (server/core/rules.js), so both count the same way.

   Every period starts from the same moment, 2026-10-18 9:00 Japan time
   (00:00 UTC): 5時間 every 5 hours from then, デイリー every day at 9:00,
   週間 every Sunday at 9:00, 月極 on the 18th of each month at 9:00 and
   特別 every 3 months (the 18th of Jan / Apr / Jul / Oct, 9:00).

   A quest counts a "metric" (spins, wins, $ earned at the casino ...). Quests
   on the same metric share their progress, whatever their period: one spin
   counts for every spin quest at once. A finished quest pays at once ($ for
   5時間 / デイリー / 週間, spin tokens for 月極 / 特別) and stays done (grey)
   until its period starts over. */
(function (BR) {
  'use strict';

  var H = 3600000, D = 24 * H;
  var EPOCH = Date.UTC(2026, 9, 18);

  var PERIODS = [
    { id: '5h', name: '5時間', ms: 5 * H, currency: 'dollars' },
    { id: 'day', name: 'デイリー', ms: D, currency: 'dollars' },
    { id: 'week', name: '週間', ms: 7 * D, currency: 'dollars' },
    { id: 'month', name: '月極', months: 1, currency: 'tokens' },
    { id: 'special', name: '特別', months: 3, currency: 'tokens' }
  ];

  // metrics: peek (opening a friend's chat), chat (a message to a friend),
  // spin, win (a spin that pays), earn ($ value of casino payouts: tokens x
  // the token price), call (calling a friend), talk (a call that is picked
  // up), watch (稼ぎに参加 = watching a friend), sent ($ value sent to
  // friends), strawberry / watermelon / melon (fruits given), borrow (money
  // from ピーター), clear (quests finished, all kinds), broke (net worth
  // below `brokeBelow` $). `money`: the progress is an amount of $.
  var LIST = [
    { id: '5h-peek', period: '5h', metric: 'peek', goal: 1, reward: 2000, text: '友達のチャットを覗く' },
    { id: '5h-chat', period: '5h', metric: 'chat', goal: 1, reward: 5000, text: '友達と話す（チャット）' },
    { id: '5h-spin1', period: '5h', metric: 'spin', goal: 1, reward: 7000, text: 'カジノを回す' },
    { id: '5h-spin2', period: '5h', metric: 'spin', goal: 2, reward: 14000, text: 'カジノを2回回す' },
    { id: '5h-spin5', period: '5h', metric: 'spin', goal: 5, reward: 20000, text: 'カジノを5回回す' },
    { id: '5h-spin10', period: '5h', metric: 'spin', goal: 10, reward: 20000, text: 'カジノを10回回す' },
    { id: '5h-win1', period: '5h', metric: 'win', goal: 1, reward: 3000, text: 'カジノで当たる' },
    { id: '5h-win3', period: '5h', metric: 'win', goal: 3, reward: 10000, text: 'カジノで3回当たる' },
    { id: '5h-call', period: '5h', metric: 'call', goal: 1, reward: 5000, text: '友達に電話をかけてみる' },
    { id: '5h-talk', period: '5h', metric: 'talk', goal: 1, reward: 10000, text: '友達と話す（通話）' },
    { id: '5h-join', period: '5h', metric: 'watch', goal: 1, reward: 5000, text: '稼ぎに参加する' },
    { id: '5h-earn10k', period: '5h', metric: 'earn', goal: 10000, reward: 15000, text: '10kを稼ぐ', money: true },
    { id: '5h-earn20k', period: '5h', metric: 'earn', goal: 20000, reward: 25000, text: '20kを稼ぐ', money: true },

    { id: 'day-send1k', period: 'day', metric: 'sent', goal: 1000, reward: 5000, text: '友達に1k以上送金する', money: true },
    { id: 'day-watch', period: 'day', metric: 'watch', goal: 1, reward: 10000, text: '友達を観戦する' },
    { id: 'day-straw1', period: 'day', metric: 'strawberry', goal: 1, reward: 5000, text: '友達にストロベリーを与える' },
    { id: 'day-straw2', period: 'day', metric: 'strawberry', goal: 2, reward: 10000, text: '友達にストロベリーを2個与える' },
    { id: 'day-watermelon', period: 'day', metric: 'watermelon', goal: 1, reward: 30000, text: '友達にスイカを与える' },
    { id: 'day-melon', period: 'day', metric: 'melon', goal: 1, reward: 50000, text: '友達にメロンを与える' },

    { id: 'month-send100k', period: 'month', metric: 'sent', goal: 100000, reward: 30000, text: '友達に100k送金する', money: true },
    { id: 'month-send300k', period: 'month', metric: 'sent', goal: 300000, reward: 50000, text: '友達に300k送金する', money: true },
    { id: 'month-earn500k', period: 'month', metric: 'earn', goal: 500000, reward: 60000, text: '500k稼ぐ', money: true },

    { id: 'special-borrow', period: 'special', metric: 'borrow', goal: 1, reward: 300000, text: '借金を借りる' },
    { id: 'special-clear100', period: 'special', metric: 'clear', goal: 100, reward: 100000, text: 'クエストを100個クリアする' },
    { id: 'special-clear200', period: 'special', metric: 'clear', goal: 200, reward: 300000, text: 'クエストを200個クリアする' },
    { id: 'special-earn1m', period: 'special', metric: 'earn', goal: 1000000, reward: 300000, text: '1M稼ぐ', money: true },
    { id: 'special-broke', period: 'special', metric: 'broke', goal: 1, reward: 1000000, text: '無一文になってしまう', note: 'コインもすべてお金に換算して総額が5万円を下回ったとき' }
  ];

  // index of the period `now` falls in, with its start and end (ms)
  function range(period, now) {
    var p = typeof period === 'string' ? byId(period) : period;
    if (p.ms) {
      var k = Math.floor((now - EPOCH) / p.ms);
      return { k: k, start: EPOCH + k * p.ms, end: EPOCH + (k + 1) * p.ms };
    }
    var d = new Date(now);
    var months = (d.getUTCFullYear() - 2026) * 12 + d.getUTCMonth() - 9;
    if (now < Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 18)) months--;
    var i = Math.floor(months / p.months);
    return { k: i, start: Date.UTC(2026, 9 + i * p.months, 18), end: Date.UTC(2026, 9 + (i + 1) * p.months, 18) };
  }
  function byId(id) {
    for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].id === id) return PERIODS[i];
    return null;
  }

  // the colour of a quest by its reward
  function tier(reward) {
    if (reward >= 1000000) return 'prism';   // 水色と金色
    if (reward >= 100000) return 'aqua';
    if (reward >= 50000) return 'red';
    if (reward >= 20000) return 'gold';
    if (reward >= 10000) return 'purple';
    if (reward >= 5000) return 'blue';
    return 'gray';
  }

  BR.QUESTS = {
    epoch: EPOCH,
    periods: PERIODS,
    list: LIST,
    // "無一文" means less than this in $ (spin tokens counted at their price)
    brokeBelow: 50000,
    range: range,
    period: byId,
    tier: tier,
    get: function (id) {
      for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
      return null;
    }
  };

  /* ------------------------------------------------------------ player level --- */
  // XP: one per spin, `questXp` per quest finished. Going from level L to
  // L + 1 takes `step` x L XP (100, 200, 300 ...).
  var LEVEL = { spinXp: 1, questXp: 20, step: 100 };
  function xpAt(level) { return LEVEL.step * level * (level - 1) / 2; }
  function levelOf(xp) {
    xp = Math.max(0, xp || 0);
    var l = Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * xp / LEVEL.step)) / 2));
    while (xpAt(l + 1) <= xp) l++;
    while (l > 1 && xpAt(l) > xp) l--;
    return l;
  }
  BR.LEVEL = {
    spinXp: LEVEL.spinXp,
    questXp: LEVEL.questXp,
    of: levelOf,
    at: xpAt,
    // { level, into: XP gained in this level, need: XP this level takes }
    info: function (xp) {
      var l = levelOf(xp);
      return { level: l, into: Math.max(0, (xp || 0) - xpAt(l)), need: xpAt(l + 1) - xpAt(l) };
    }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
