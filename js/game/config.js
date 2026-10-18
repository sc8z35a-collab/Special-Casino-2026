/* Game rules: symbols, per-cell probabilities and the pay table shown in the
   in-game "組み合わせ" tab.  RTP with these numbers is 92.84 %. */
(function (BR) {
  'use strict';

  BR.CONFIG = {
    // order = paytable order (low -> high)
    symbols: ['revolver', 'gold', 'diamond', 'star', 'bar', 'seven', 'statue'],
    // probability of each symbol landing on any reel position
    weights: { revolver: 0.40, gold: 0.25, diamond: 0.20, star: 0.08, bar: 0.045, seven: 0.02, statue: 0.005 },
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
    // Car Owner shop (price in $)
    cars: [
      { id: 'two-state-sedan', name: 'Two state セダン', price: 1200000 }
    ],
    // Shop (price in $, always 10-40 % off like the icons); anything bought
    // here can be given to friends, up to `max` per player
    shop: [
      { id: 'omamori', name: 'お守り加護', price: 90000, max: 10 }
    ],
    // お守り加護, switched on before a spin: the next losing spin gives back
    // min-max % of the lost tokens (all of them `fullChance` of the time)
    charm: { item: 'omamori', min: 5, max: 20, fullChance: 0.02 },
    // thrown at the friend one is watching: spin tokens from the thrower
    fruits: [
      { id: 'strawberry', name: 'ストロベリー', tokens: 1000 },
      { id: 'watermelon', name: 'スイカ', tokens: 2000 },
      { id: 'melon', name: 'メロン', tokens: 5000 }
    ],
    // people watching one player (they share the player's voice call)
    maxWatchers: 10,
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
    // part-time jobs (バイト): `wage` $ an hour, paid for every second worked
    // (also while away); `level`: the player level that unlocks it. How many
    // can be worked at once: `jobSlots` (more with the player level, coming).
    jobs: [
      { id: 'garage', name: '近所のガレージの壁を殴るバイト', wage: 20000, level: 1 }
    ],
    jobSlots: 1,
    // $ for every player who updates the game to a new release (js/game/news.js)
    updateBonus: 250000
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
