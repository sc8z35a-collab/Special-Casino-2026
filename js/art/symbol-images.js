/* Supplied low-poly symbols in transparent 192x182 cells at 1.5x.
   Internal payout/save ids stay stable: revolver is the coin, diamond the
   watch, statue the decorated goddess coin. No obsolete turn sheets load. */
(function (BR) {
  'use strict';
  BR.SYMBOL_IMG = {
    revolver: 'img/symbols/lowpoly/revolver.webp',
    gold: 'img/symbols/lowpoly/gold.webp',
    diamond: 'img/symbols/lowpoly/diamond.webp',
    star: 'img/symbols/lowpoly/star.webp',
    bar: 'img/symbols/lowpoly/bar.webp',
    seven: 'img/symbols/lowpoly/seven.webp',
    statue: 'img/symbols/lowpoly/statue.webp'
  };
  BR.SYMBOL_TURN = {}; // Supplied coins stay visually consistent during wins.
  BR.SYMBOL_TURN_SHEET = { frames: 24, cols: 6, pad: 1.4, scale: 1.25 };
})(window.BR = window.BR || {});
