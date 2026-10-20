/* Game rules: symbols, per-cell probabilities and the pay table shown in the
   in-game "組み合わせ" tab.  RTP with these numbers is 82.00 % (a win on
   33.5 % of the spins); in a hub (友達と稼ぐ) see `hub`. */
(function (BR) {
  'use strict';

  BR.CONFIG = {
    // order = paytable order (low -> high)
    symbols: ['revolver', 'gold', 'diamond', 'star', 'bar', 'seven', 'statue'],
    // probability of each symbol landing on any reel position
    weights: { revolver: 0.452, gold: 0.227, diamond: 0.212, star: 0.045, bar: 0.039, seven: 0.021, statue: 0.004 },
    // matches anywhere on the centre line: count -> multiplier of the bet
    pays: {
      revolver: { 4: 1.5, 5: 3 },
      gold: { 3: 2, 4: 4, 5: 10 },
      diamond: { 3: 2.5, 4: 5, 5: 20 },
      star: { 2: 3, 3: 10, 4: 20, 5: 100 },
      bar: { 2: 4, 3: 15, 4: 50, 5: 500 },
      seven: { 2: 10, 3: 20, 4: 100, 5: 1000 },
      statue: { 1: 2, 2: 10, 3: 100, 4: 1000, 5: 10000 }
    },
    bets: [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000],
    // win presentation tiers by multiplier: WIN < 5x <= BIG WIN < 15x <= SUPER BIG WIN
    tiers: { big: 5, superBig: 15 },
    // from this many wins in a row (the combo; in a hub the one everyone
    // shares) every win pays double
    comboDouble: 5,
    // アクセス日数 (login days, all told): Ice Smoker公式ボット sends `amount` $
    // by itself on each of these (not to a 永久BAN account)
    accessDays: { at: [5, 10, 15, 20, 25, 30, 35], amount: 250000 },
    tokenPrice: 10,          // $ per spin token
    dailyLimit: 10000000,    // spin tokens that can be bought per UTC day
    dailyFree: 1000,         // free tokens claimable once per UTC day
    start: { tokens: 0, dollars: 5008159, coins: 74 },
    // player icons: price in $ (0 = free); "rare" ones are locked at sign-up
    // Player icons (img/avatars/<id>.webp). Paid ones are chained on the
    // sign-up screen and sold later for $, always 10-40 % off (js/game/sale.js).
    avatars: [
      { id: 'bald', name: 'スキンヘッド', price: 0 },
      { id: 'beard', name: 'ヒゲ', price: 0 },
      { id: 'curly', name: 'くせ毛', price: 0 },
      { id: 'blond', name: '金髪', price: 0 },
      { id: 'witch', name: '魔女ハット', price: 0 },
      { id: 'cap', name: '黒キャップ', price: 0 },
      { id: 'catcap', name: 'ネコキャップ', price: 0 },
      { id: 'pumpkin', name: 'パンプキン', price: 100000 },
      { id: 'red', name: 'レッド', price: 350000, rare: true },
      { id: 'vampire', name: 'ヴァンパイア', price: 800000, rare: true }
    ],
    // Car Owner shop (price in $); `model`: a 3D model to look at
    // (img/3d/cars/<id>.glb, js/render/garage3d.js)
    cars: [
      { id: 'two-state-sedan', name: 'Two state セダン', price: 1200000 },
      { id: 'blue-lightning', name: 'ブルーライトニング', price: 6000000, model: true }
    ],
    // the garage holds this many cars; one more place costs `slotPrice` $ (for good, any number)
    garage: { slots: 2, slotPrice: 1000000 },
    // Car Owner sales (js/game/sale.js), never two at once: on `chance` % of
    // the days / weeks / months (the yearly one always), `hours` long, on
    // `cars` cars at random (0: all of them), each `min`-`max` % off
    carSales: {
      day: { name: '極セール', chance: 5, hours: 5, cars: 2, min: 1, max: 10 },
      week: { name: '超極セール', chance: 5, hours: 24, cars: 5, min: 10, max: 30 },
      month: { name: '超ダイナミックセール', chance: 5, hours: 24, cars: 8, min: 20, max: 45 },
      year: { name: '年感謝セール', chance: 100, hours: 24, cars: 0, min: 10, max: 30 }
    },
    // Shop (price in $, 10-40 % off for 5 hours a day: js/game/sale.js);
    // anything bought here can be given to friends, up to `max` per player
    shop: [
      { id: 'omamori', name: 'お守り加護', price: 90000, max: 10 }
    ],
    // お守り加護, switched on before a spin: the next losing spin gives back
    // min-max % of the lost tokens (all of them `fullChance` of the time);
    // with 友達と稼ぐ's benefits on, up to `hub.max` % and `hub.fullChance`
    charm: { item: 'omamori', min: 5, max: 20, fullChance: 0.02, hub: { max: 70, fullChance: 0.04 } },
    // thrown at the friend one is watching: spin tokens from the thrower
    fruits: [
      { id: 'strawberry', name: 'ストロベリー', tokens: 1000 },
      { id: 'watermelon', name: 'スイカ', tokens: 2000 },
      { id: 'melon', name: 'メロン', tokens: 5000 }
    ],
    // people watching one player (the player picks who they talk with)
    maxWatchers: 10,
    // 協力スロット: the spin tokens a group's players bet at its table fill
    // one gauge; when it is full, everyone who bet gets `bonus` of what they
    // bet in that round (the gauge then starts over)
    coop: { goal: 100000, bonus: 0.05 },
    // フレンド対決: two friends spin the same number of times (one of
    // `spins`) at one bet, and the larger total win wins. An invitation waits
    // `inviteMs`; a battle not finished in `maxMs` is decided as it stands.
    battle: { spins: [10, 20, 30], inviteMs: 600000, maxMs: 3600000 },
    // 観戦ベット: a watcher stakes spin tokens on whether the player gets a
    // BIG WIN (or better) within their next `spins` spins: "hit" pays `hit`
    // times the stake, "miss" `miss` times (a BIG WIN in 10 spins: 18.8 %).
    // A bet left open for `refundMs` (the player stopped) is given back.
    watchBet: { spins: 10, stakes: [1000, 5000, 10000], hit: 5, miss: 1.15, refundMs: 86400000 },
    // login bonus in spin tokens for the 1st, 2nd, 3rd, 4th day logged in
    // (then it starts over); a day runs from 6:00 to 6:00 Japan time
    loginBonus: { days: [45000, 50000, 65000, 90000], dayStartsJst: 6 },
    // Peter the money lender ($): never more than `max` in all (counted over
    // every loan ever made to the player, repaid or not); he offers money on
    // his own when a player is nearly broke (net worth below `brokeBelow` $)
    lender: {
      max: 11000000,
      brokeBelow: 10000,
      minLoan: 10000,
      offers: [{ amount: 5000000, rate: [2, 5] }, { amount: 6000000, rate: [10, 10] }],
      // asked in the chat: like the first offer when nothing is owed, then 10 %
      chatRate: [[2, 5], [10, 10]]
    },
    // presents sent in a chat (the picture img/gifts/<id>.webp): the sender
    // pays `price` $, the friend taps it once to get as much
    presents: [
      { id: 'cookie', name: 'クッキー', price: 10000 },
      { id: 'bear', name: 'クマのぬいぐるみ', price: 50000 },
      { id: 'snowman', name: '雪だるま', price: 100000 },
      { id: 'pumpkin', name: 'パンプキンヘッド', price: 250000 },
      { id: 'diamond', name: 'ダイヤモンド', price: 1000000 }
    ],
    // 通報: what kind of trouble
    reportKinds: [
      { id: 'spam', name: 'スパム' },
      { id: 'abuse', name: '暴言' },
      { id: 'harass', name: '嫌がらせ' },
      { id: 'conduct', name: '不適切な行動' },
      { id: 'cheat', name: 'チート' },
      { id: 'other', name: 'その他' }
    ],
    // ジョンソン, a friend NPC ($): `gift` (rounded to 1000) every `every` ms to
    // help grow the 金の生る木, and once ever `rescue` when the money (tokens
    // at their price) is under `rescueBelow`; nothing is ever paid back
    johnson: { every: 172800000, gift: [100000, 200000], rescue: 350000, rescueBelow: 80000 },
    // part-time jobs (バイト): `wage` $ an hour, paid for every second worked
    // (also while away); `level`: the player level that unlocks it. How many
    // can be worked at once: `jobSlots`, one more every `jobSlotEvery` player
    // levels (Lv.3: 2, Lv.6: 3 ...: BR.LEVEL.jobSlots).
    jobs: [
      { id: 'garage', name: '近所のガレージの壁を殴るバイト', wage: 20000, level: 1 }
    ],
    jobSlots: 1,
    jobSlotEvery: 3,
    // $ for every player who updates the game to a new release (js/game/news.js)
    updateBonus: 250000,
    // 金の生る木 (js/game/tree.js): money given to a tree (one tap: `amounts`)
    // makes it earn $ every second: `rate` [given so far, $ a second], a
    // straight line in between (no jumps), flat after the last. A harvest
    // `cycle` is picked when it starts and the money waits until it is over:
    // what grew in it times `mult`. `stages`: the given sum each look starts
    // at. A SUPER tree pays `superMult` times, for good. More trees come from
    // the auctions (`markets`: the average winning price for the 2nd tree and
    // for every one after it), at most `max`.
    tree: {
      amounts: [5000, 10000, 20000, 50000, 100000],
      rate: [[0, 5], [150000, 10], [200000, 12], [500000, 14], [1500000, 15], [3000000, 18], [6000000, 20], [10000000, 21]],
      cycles: [
        { id: '30m', name: '30分', ms: 1800000, mult: 1 },
        { id: '2h', name: '2時間', ms: 7200000, mult: 1.1 },
        { id: '1d', name: '1日', ms: 86400000, mult: 1.2 },
        { id: '1w', name: '1週間', ms: 604800000, mult: 1.6 }
      ],
      stages: [0, 150000, 200000, 500000, 1500000, 3000000, 6000000, 10000000, 20000000],
      superMult: 1.1,
      max: 8,
      markets: {
        seed: { name: '木の種市場', second: 10200000, more: 21300000 },
        grown: { name: '成長した木市場', second: 12100000, more: 22100000 }
      },
      superChance: 0.12
    },
    // 友達と稼ぐ: friends invited from the friend list play together in a hub
    // of up to `max` players (each on their own reels, which the others do not
    // see; nobody leaves unless they press 抜ける, a hub of one closes). While
    // two or more of its players are active (a tap, a key or a voice in the
    // last 4 minutes), every spin of theirs uses `weights` (the statue 1 %, 7
    // 4 %, the revolver 35 %, the rest as usual between them),
    // `diamonds` of the spins land five diamonds, the
    // combo is shared by everyone: each win in a row pays `comboStep` times
    // more than the one before (x1, x1.1, x1.21 ...) and only `misses` misses
    // in a row end it; 777 (three 7s or more) pays `sevens` times, XP is `xp`
    // times, and 5時間 quests count `booster` times as fast with two active
    // players, `boosterStep` times more for each one after that (x2, x2.2,
    // x2.42 ...), and the best paid バイト being worked pays `wage` times its
    // wage. An invitation waits `inviteMs`.
    hub: {
      max: 5,
      weights: { revolver: 0.35, gold: 0.26, diamond: 0.243, star: 0.052, bar: 0.045, seven: 0.04, statue: 0.01 },
      diamonds: 0.01,
      comboStep: 1.1,
      misses: 3,
      sevens: 1.5,
      xp: 1.2,
      booster: 2,
      boosterStep: 1.1,
      wage: 1.5,
      inviteMs: 600000
    }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
