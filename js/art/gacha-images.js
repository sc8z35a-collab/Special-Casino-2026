/* Supplied gacha controls; reward pictures are the game's existing assets. */
(function (BR) {
  'use strict';
  BR.GACHA_ART = {
    icon: 'img/gacha/icon.webp',
    background: 'img/gacha/background.webp',
    confirm: 'img/gacha/confirm.webp',
    tiers: { rare: 'img/gacha/rare.webp', legendary: 'img/gacha/legendary.webp', secret: 'img/gacha/secret.webp' },
    pulls: { 1: 'img/gacha/pull-1.webp', 3: 'img/gacha/pull-3.webp', 10: 'img/gacha/pull-10.webp' },
    discounts: { 3: 'img/gacha/off-10.webp', 10: 'img/gacha/off-25.webp' },
    odds: 'img/gacha/odds.webp',
    // リリース記念セール's mark
    releaseSale: 'img/ui/release-sale.webp',
    // the free tickets (功績's rewards), by the gacha they are for
    tickets: { rare: 'img/gacha/ticket-rare.webp', legendary: 'img/gacha/ticket-legendary.webp', secret: 'img/gacha/ticket-secret.webp' },
    rewards: {
      lot: 'img/ui/chip-pile.webp', royal: 'img/ui/coin.webp', garage: 'img/ui/garage.webp',
      reset: 'img/ui/lowpoly/quest.webp', 'vip-week': 'img/ui/refresh/vip.webp',
      seed: 'img/tree/seed.webp', 'grown-tree': 'img/tree/preview.webp'
    },
    // No Porsche-specific picture/model is bundled; use the existing generic
    // car icon for it, rather than depicting a different car as the reward.
    cars: { 'lamborghini-urus': 'img/cars/lamborghini-urus.webp' },
    carFallback: 'img/ui/refresh/car.webp'
  };
})(window.BR = window.BR || {});
