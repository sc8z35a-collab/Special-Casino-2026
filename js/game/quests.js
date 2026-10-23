/* Quests and the player level, shared by the browser and the server
   (server/core/rules.js), so both count the same way.

   Every period starts from the same moment, 2026-10-18 9:00 Japan time
   (00:00 UTC): 5時間 every 5 hours from then, デイリー every day at 9:00,
   週間 and 週間協力 every Sunday at 9:00, 月極 on the 18th of each month at
   9:00; 特別 never starts over.

   A quest counts a "metric" (spins, wins, $ earned at the casino ...). Quests
   on the same metric share their progress, whatever their period: one spin
   counts for every spin quest at once. Within a period the quests on one
   metric make a chain (5分 -> 10分 -> 20分 ...): the quest screen shows one
   step at a time while the progress keeps adding up, with where the chain
   ends and what all of it pays. A finished quest is received (受け取る) for $
   and stays done until its period starts over.

   週間協力 quests only move in a hub (友達と稼ぐ) with friends. The 臨時緊急
   quests of 週間 only come up in some weeks (half of them). Time quests count
   only while the player is active: after 4 minutes without a tap, a key or a
   voice they stop, and go on with the next one. */
(function (BR) {
  'use strict';

  var H = 3600000, D = 24 * H, M = 60;
  var EPOCH = Date.UTC(2026, 9, 18);

  // every quest pays $; `hub`: only moves in a hub with friends; `forever`: never starts over
  var PERIODS = [
    { id: '5h', name: '5時間', ms: 5 * H },
    { id: 'day', name: 'デイリー', ms: D },
    { id: 'week', name: '週間', ms: 7 * D },
    { id: 'coop', name: '週間協力', ms: 7 * D, hub: true },
    { id: 'month', name: '月極', months: 1 },
    { id: 'special', name: '特別', forever: true }
  ];

  // metrics: peek (opening a friend's chat), chat (a message to a friend),
  // spin, win (a spin that pays), bet (spin tokens bet), combo (wins in a
  // row: the longest run, not a sum), earn ($ value of casino payouts: tokens
  // x the token price), call (calling a friend), talk (a call that is picked
  // up), talkSec (seconds talking with friends), online (seconds online and
  // active), watch (watching a friend), wbet (観戦ベット placed), hub
  // (joining 友達と稼ぐ), hubSec (seconds in a hub with friends), coopEarn ($
  // value of the payouts of everyone in one's hub), sent ($ value sent to
  // friends), friend (a new friend), strawberry / watermelon / melon (fruits
  // given), borrow (money from ピーター), clear (quests finished, all kinds),
  // sclear (特別 quests finished), broke (net worth below `brokeBelow` $),
  // jobpay ($ received from バイト), snowman (snowman presents sent), barWin
  // (a paying BAR combination), revolver5 (all five centre reels are guns),
  // casinoSpend (spin tokens bet, converted to dollars; payouts not deducted),
  // level / vipLevel (highest earned rank), vipUse (ever activated VIP),
  // carBuy (successful car purchases, including buying from a friend).
  // How the progress reads: `money` an amount of $, `tokens` of spin
  // tokens, `sec` seconds (shown in minutes).
  var MAX_METRICS = ['combo', 'level', 'vipLevel', 'vipUse'];

  function steps(period, metric, list, make) {
    return list.map(function (x) {
      var q = { id: period + '-' + x[0], period: period, metric: metric, goal: x[1], reward: x[2] };
      var more = make(x[1]);
      Object.keys(more).forEach(function (k) { q[k] = more[k]; });
      return q;
    });
  }
  function man(n) { return n >= 10000 ? (n / 10000) + '万' : String(n); }

  var LIST = [].concat(
    [
      { id: '5h-peek', period: '5h', metric: 'peek', goal: 1, reward: 2000, text: '友達のチャットを覗く' },
      { id: '5h-chat', period: '5h', metric: 'chat', goal: 1, reward: 5000, text: '友達と話す（チャット）' },
      { id: '5h-spin1', period: '5h', metric: 'spin', goal: 1, reward: 7000, text: 'カジノを回す' },
      { id: '5h-spin2', period: '5h', metric: 'spin', goal: 2, reward: 14000, text: 'カジノを2回回す' },
      { id: '5h-spin5', period: '5h', metric: 'spin', goal: 5, reward: 20000, text: 'カジノを5回回す' },
      { id: '5h-spin10', period: '5h', metric: 'spin', goal: 10, reward: 20000, text: 'カジノを10回回す' },
      { id: '5h-win1', period: '5h', metric: 'win', goal: 1, reward: 3000, text: 'カジノで当たる' },
      { id: '5h-win3', period: '5h', metric: 'win', goal: 3, reward: 10000, text: 'カジノで3回当たる' },
      { id: '5h-win10', period: '5h', metric: 'win', goal: 10, reward: 20000, text: 'カジノで10回当たる' },
      { id: '5h-win20', period: '5h', metric: 'win', goal: 20, reward: 40000, text: 'カジノで20回当たる' },
      { id: '5h-win30', period: '5h', metric: 'win', goal: 30, reward: 50000, text: 'カジノで30回当たる' }
    ],
    steps('5h', 'spin', [['spin20', 20, 25000], ['spin30', 30, 35000], ['spin40', 40, 50000], ['spin50', 50, 75000],
      ['spin60', 60, 80000], ['spin70', 70, 80000], ['spin80', 80, 80000], ['spin90', 90, 100000], ['spin100', 100, 100000]],
      function (n) { return { text: 'カジノを' + n + '回回す' }; }),
    steps('5h', 'barWin', [['bar1', 1, 10000], ['bar2', 2, 15000], ['bar3', 3, 20000]],
      function (n) { return { text: 'BARを揃えて' + n + '回当たる' }; }),
    steps('5h', 'revolver5', [['revolver5-1', 1, 5000], ['revolver5-2', 2, 6000], ['revolver5-3', 3, 7000],
      ['revolver5-4', 4, 8000], ['revolver5-5', 5, 9000]],
      function (n) { return { text: '銃を5列揃えて' + n + '回当たる' }; }),
    steps('5h', 'snowman', [['snowman1', 1, 10000], ['snowman2', 2, 20000], ['snowman3', 3, 30000],
      ['snowman5', 5, 50000], ['snowman10', 10, 120000]],
      function (n) { return { text: '友達に雪だるまを' + n + '回送る' }; }),
    steps('5h', 'win', [['win50', 50, 80000], ['win70', 70, 90000], ['win90', 90, 110000], ['win100', 100, 120000],
      ['win150', 150, 250000], ['win200', 200, 450000]],
      function (n) { return { text: 'カジノで' + n + '回当たる' }; }),
    steps('5h', 'combo', [['combo2', 2, 5000], ['combo3', 3, 10000], ['combo4', 4, 20000],
      ['combo5', 5, 100000], ['combo6', 6, 250000], ['combo7', 7, 400000], ['combo8', 8, 950000]],
      function (n) { return { text: 'カジノで' + n + 'コンボする' }; }),
    steps('5h', 'bet', [['bet10k', 10000, 10000], ['bet20k', 20000, 20000], ['bet50k', 50000, 30000], ['bet100k', 100000, 40000],
      ['bet200k', 200000, 50000], ['bet300k', 300000, 100000], ['bet500k', 500000, 200000], ['bet1m', 1e6, 80000],
      ['bet2m', 2e6, 100000], ['bet3m', 3e6, 120000], ['bet4m', 4e6, 150000], ['bet5m', 5e6, 200000], ['bet6m', 6e6, 220000]],
      function (n) { return { text: 'カジノで' + man(n) + 'トークン賭ける（累計）', tokens: true }; }),
    steps('5h', 'casinoSpend', [['spend30k', 30000, 10000], ['spend100k', 100000, 20000], ['spend200k', 200000, 30000],
      ['spend500k', 500000, 35000], ['spend1m', 1e6, 65000], ['spend2m', 2e6, 85000], ['spend3m', 3e6, 115000]],
      function (n) { return { text: 'カジノで' + man(n) + 'ドル使う（累計）', money: true,
        note: '賭けたトークンを1トークン＝$10に換算（払い戻しは差し引きません）' }; }),
    [
      { id: '5h-earn10k', period: '5h', metric: 'earn', goal: 10000, reward: 15000, text: '10kを稼ぐ', money: true },
      { id: '5h-earn20k', period: '5h', metric: 'earn', goal: 20000, reward: 25000, text: '20kを稼ぐ', money: true },
      { id: '5h-call', period: '5h', metric: 'call', goal: 1, reward: 5000, text: '友達に電話をかけてみる' },
      { id: '5h-talk', period: '5h', metric: 'talk', goal: 1, reward: 10000, text: '友達と話す（通話）' }
    ],
    steps('5h', 'talkSec', [['talk5', 5 * M, 10000], ['talk10', 10 * M, 20000], ['talk20', 20 * M, 30000], ['talk30', 30 * M, 40000]],
      function (n) { return { text: '友達と' + n / M + '分間話す（通話・累計）', sec: true }; }),
    steps('5h', 'online', [['online5', 5 * M, 3000], ['online10', 10 * M, 5000], ['online15', 15 * M, 10000], ['online20', 20 * M, 20000],
      ['online30', 30 * M, 40000], ['online60', 60 * M, 50000], ['online90', 90 * M, 100000], ['online120', 120 * M, 10000],
      ['online150', 150 * M, 12000], ['online180', 180 * M, 15000], ['online200', 200 * M, 20000], ['online250', 250 * M, 30000]],
      function (n) { return { text: n / M + '分間オンラインでいる', sec: true }; }),
    [{ id: '5h-join', period: '5h', metric: 'hub', goal: 1, reward: 5000, text: '稼ぎに参加する（友達と稼ぐ）' }],
    steps('5h', 'hub', [['join2', 2, 10000], ['join3', 3, 15000], ['join4', 4, 20000], ['join5', 5, 25000], ['join6', 6, 35000]],
      function (n) { return { text: '稼ぎに' + n + '回参加する（友達と稼ぐ）' }; }),
    steps('5h', 'clear', [['clear10', 10, 10000], ['clear20', 20, 15000], ['clear30', 30, 25000],
      ['clear40', 40, 35000], ['clear50', 50, 40000], ['clear60', 60, 60000]],
      function (n) { return { text: 'クエストを' + n + '個クリアする' }; }),
    steps('5h', 'wbet', [['wbet1', 1, 5000], ['wbet2', 2, 10000], ['wbet3', 3, 15000], ['wbet4', 4, 20000], ['wbet5', 5, 30000], ['wbet6', 6, 40000]],
      function (n) { return { text: '友達の観戦に' + n + '回賭ける（観戦ベット）' }; }),

    [
      { id: 'day-send1k', period: 'day', metric: 'sent', goal: 1000, reward: 5000, text: '友達に1k以上送金する', money: true },
      { id: 'day-send100k', period: 'day', metric: 'sent', goal: 100000, reward: 10000, text: '友達に100k以上送金する（お金換算）', money: true },
      { id: 'day-send300k', period: 'day', metric: 'sent', goal: 300000, reward: 30000, text: '友達に300k以上送金する（お金換算）', money: true },
      { id: 'day-watch', period: 'day', metric: 'watch', goal: 1, reward: 10000, text: '友達を観戦する' },
      { id: 'day-straw1', period: 'day', metric: 'strawberry', goal: 1, reward: 5000, text: '友達にストロベリーを与える' },
      { id: 'day-straw2', period: 'day', metric: 'strawberry', goal: 2, reward: 10000, text: '友達にストロベリーを2個与える' },
      { id: 'day-watermelon', period: 'day', metric: 'watermelon', goal: 1, reward: 30000, text: '友達にスイカを与える' },
      { id: 'day-melon', period: 'day', metric: 'melon', goal: 1, reward: 50000, text: '友達にメロンを与える' },
      { id: 'day-clear5', period: 'day', metric: 'clear', goal: 5, reward: 20000, text: 'クエストを5回クリアする' },
      { id: 'day-clear10', period: 'day', metric: 'clear', goal: 10, reward: 10000, text: 'クエストを10回クリアする' },
      { id: 'day-earn1m', period: 'day', metric: 'earn', goal: 1000000, reward: 40000, text: '1Mを稼ぐ', money: true },
      { id: 'day-earn2m', period: 'day', metric: 'earn', goal: 2000000, reward: 100000, text: '2Mを稼ぐ', money: true },
      { id: 'day-special', period: 'day', metric: 'sclear', goal: 1, reward: 30000, text: '特別クエストをひとつクリアする' },
      { id: 'day-talk', period: 'day', metric: 'talk', goal: 1, reward: 10000, text: '友達と話す（通話）' },
      { id: 'day-friend', period: 'day', metric: 'friend', goal: 1, reward: 10000, text: '友達を追加する' },
      { id: 'day-job100k', period: 'day', metric: 'jobpay', goal: 100000, reward: 10000, text: 'バイトで100k稼ぐ（累計）', money: true },
      { id: 'day-job150k', period: 'day', metric: 'jobpay', goal: 150000, reward: 20000, text: 'バイトで150k稼ぐ（累計）', money: true },
      { id: 'day-job300k', period: 'day', metric: 'jobpay', goal: 300000, reward: 40000, text: 'バイトで300k稼ぐ（累計）', money: true },

      { id: 'week-melon3', period: 'week', metric: 'watermelon', goal: 3, reward: 100000, text: '友達にスイカを3個与える', emergency: true },
      { id: 'week-melon5', period: 'week', metric: 'watermelon', goal: 5, reward: 200000, text: '友達にスイカを5個与える', emergency: true }
    ],

    steps('day', 'sent', [['send500k', 500000, 35000], ['send850k', 850000, 55000], ['send1.1m', 1100000, 65000],
      ['send1.85m', 1850000, 78000], ['send2.1m', 2100000, 89000]],
      function (n) { return { text: '友達に' + man(n) + 'ドル以上送金する（お金換算）', money: true }; }),
    steps('day', 'earn', [['earn2.5m', 2.5e6, 7000], ['earn3m', 3e6, 10000], ['earn3.5m', 3.5e6, 16000],
      ['earn4m', 4e6, 26000], ['earn5m', 5e6, 35000], ['earn7m', 7e6, 46000], ['earn9m', 9e6, 56000], ['earn10m', 10e6, 60000]],
      function (n) { return { text: n / 1e6 + 'Mを稼ぐ（累計）', money: true }; }),
    steps('day', 'watermelon', [['watermelon2', 2, 40000], ['watermelon3', 3, 50000], ['watermelon5', 5, 60000]],
      function (n) { return { text: '友達にスイカを' + n + '個与える' }; }),
    steps('day', 'melon', [['melon2', 2, 60000], ['melon3', 3, 70000], ['melon5', 5, 80000]],
      function (n) { return { text: '友達にメロンを' + n + '個与える' }; }),
    steps('day', 'friend', [['friend2', 2, 200000], ['friend3', 3, 300000]],
      function (n) { return { text: '友達を' + n + '人追加する' }; }),

    steps('coop', 'coopEarn', [['earn1m', 1e6, 100000], ['earn1.5m', 1.5e6, 150000], ['earn3m', 3e6, 200000], ['earn4m', 4e6, 250000],
      ['earn5m', 5e6, 300000], ['earn10m', 1e7, 500000], ['earn15m', 1.5e7, 800000]],
      function (n) { return { text: '友達と' + (n / 1e6) + 'M稼ぐ（みんなの累計）', money: true }; }),
    steps('coop', 'hubSec', [['time10', 10 * M, 200000], ['time20', 20 * M, 400000], ['time30', 30 * M, 500000], ['time50', 50 * M, 750000],
      ['time60', 60 * M, 800000], ['time90', 90 * M, 1000000], ['time120', 120 * M, 1250000], ['time150', 150 * M, 1400000],
      ['time200', 200 * M, 1500000], ['time250', 250 * M, 1500000], ['time300', 300 * M, 1500000], ['time500', 500 * M, 1500000],
      ['time600', 600 * M, 3000000]],
      function (n) { return { text: '友達と' + n / M + '分間稼ぐ（累計）', sec: true }; }),

    [
      { id: 'month-send100k', period: 'month', metric: 'sent', goal: 100000, reward: 30000, text: '友達に100k送金する', money: true },
      { id: 'month-send300k', period: 'month', metric: 'sent', goal: 300000, reward: 50000, text: '友達に300k送金する', money: true },
      { id: 'month-earn500k', period: 'month', metric: 'earn', goal: 500000, reward: 60000, text: '500k稼ぐ', money: true },

      { id: 'special-borrow', period: 'special', metric: 'borrow', goal: 1, reward: 300000, text: '借金を借りる' },
      { id: 'special-clear100', period: 'special', metric: 'clear', goal: 100, reward: 100000, text: 'クエストを100個クリアする' },
      { id: 'special-clear200', period: 'special', metric: 'clear', goal: 200, reward: 300000, text: 'クエストを200個クリアする' },
      { id: 'special-earn1m', period: 'special', metric: 'earn', goal: 1000000, reward: 300000, text: '1M稼ぐ', money: true },
      { id: 'special-win100', period: 'special', metric: 'win', goal: 100, reward: 100000, text: 'カジノで100回当たる' },
      { id: 'special-win500', period: 'special', metric: 'win', goal: 500, reward: 500000, text: 'カジノで500回当たる' },
      { id: 'special-broke', period: 'special', metric: 'broke', goal: 1, reward: 1000000, text: '無一文になってしまう', note: 'トークンも$に換算した総額が5万を下回ったとき（ロイヤルコインは除く）' }
    ],
    steps('special', 'level', [['level10', 10, 125000], ['level20', 20, 220000], ['level30', 30, 650000],
      ['level40', 40, 1200000], ['level50', 50, 3000000]],
      function (n) { return { text: 'プレイヤーレベルを' + n + 'にする' }; }),
    [{ id: 'special-vip-first', period: 'special', metric: 'vipUse', goal: 1, reward: 45000, text: 'VIPを初めて使う' }],
    steps('special', 'vipLevel', [['vip1', 1, 250000], ['vip2', 2, 500000], ['vip3', 3, 750000], ['vip3.1', 4, 1000000], ['vip4', 5, 2000000]],
      function (n) { return { text: 'VIP' + ['0', '1', '2', '3', '3.1', '4'][n] + 'にする' }; }),
    steps('special', 'earn', [['earn50m', 50e6, 300000], ['earn200m', 200e6, 1000000], ['earn500m', 500e6, 3000000]],
      function (n) { return { text: n / 1e6 + 'M稼ぐ（累計）', money: true }; }),
    steps('special', 'carBuy', [['car1', 1, 100000], ['car2', 2, 250000], ['car3', 3, 500000], ['car4', 4, 750000], ['car5', 5, 750000]],
      function (n) { return { text: '車を' + n + '台買う' }; })
  );

  // index of the period `now` falls in, with its start and end (ms; end 0: never)
  function range(period, now) {
    var p = typeof period === 'string' ? byId(period) : period;
    if (p.forever) return { k: 0, start: EPOCH, end: 0 };
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

  // 臨時緊急クエスト: whether they come up in week `k` (counted from the
  // epoch); the same for everyone, half of the weeks
  function emergencyWeek(k) {
    var h = Math.imul((k + 11) | 0, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return ((h >>> 0) & 1) === 1;
  }
  // whether quest `q` is on in period index `k`
  function active(q, k) { return !q.emergency || emergencyWeek(k); }

  // the chain `q` is a step of: the quests of its period on its metric, by goal
  function chainOf(q) {
    return LIST.filter(function (x) { return x.period === q.period && x.metric === q.metric && !!x.emergency === !!q.emergency; })
      .sort(function (a, b) { return a.goal - b.goal; });
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
    // One exclusive draw per completed STEP (out of 1000), saved until reset.
    bonuses: {
      rolls: 1000,
      ultra: { rolls: 1, multiplier: 6, coins: 8 },
      pro: { rolls: 50, multiplier: 3, coins: 0 }
    },
    // metrics that keep the biggest value instead of adding up
    maxMetrics: MAX_METRICS,
    // "無一文" means less than this in $ (spin tokens counted at their price)
    brokeBelow: 50000,
    // time quests stop after this long without a tap, a key or a voice
    idleMs: 4 * 60000,
    range: range,
    period: byId,
    tier: tier,
    active: active,
    emergencyWeek: emergencyWeek,
    chainOf: chainOf,
    get: function (id) {
      for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
      return null;
    }
  };

  /* ------------------------------------------------------------ player level --- */
  // XP: one per spin, `questXp` per quest received (x1.2 in a hub). Going
  // from level L to L + 1 takes `step` x L XP (100, 200, 300 ...).
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
    // バイト that can be worked at once at `level` (one more every few levels)
    jobSlots: function (level) {
      var C = BR.CONFIG;
      return C.jobSlots + Math.floor(Math.max(1, level || 1) / C.jobSlotEvery);
    },
    // { level, into: XP gained in this level, need: XP this level takes }
    info: function (xp) {
      var l = levelOf(xp);
      return { level: l, into: Math.max(0, (xp || 0) - xpAt(l)), need: xpAt(l + 1) - xpAt(l) };
    }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
