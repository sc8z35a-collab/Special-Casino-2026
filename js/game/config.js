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
      { id: 'pumpkin', name: 'パンプキン', price: 100000 },
      { id: 'red', name: 'レッド', price: 350000, rare: true },
      { id: 'vampire', name: 'ヴァンパイア', price: 800000, rare: true }
    ],
    // Car Owner shop (price in $)
    cars: [
      { id: 'two-state-sedan', name: 'Two state セダン', price: 1200000 }
    ]
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
