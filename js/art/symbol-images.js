/* Supplied reel artwork (tools/art/import_supplied.py) in transparent
   192x182 cells at 3x. Internal ids stay stable for payouts and saved progress:
   revolver is now the coin, diamond the watch. Only the unchanged statue
   uses its old 3D turn; the supplied pictures keep their appearance on wins. */
(function (BR) {
  'use strict';
  BR.SYMBOL_IMG = {
    revolver: 'img/symbols/lowpoly/revolver.webp',
    gold: 'img/symbols/lowpoly/gold.webp',
    diamond: 'img/symbols/lowpoly/diamond.webp',
    star: 'img/symbols/lowpoly/star.webp',
    bar: 'img/symbols/lowpoly/bar.webp',
    seven: 'img/symbols/lowpoly/seven.webp',
    statue: 'img/symbols/statue.webp'
  };
  BR.SYMBOL_TURN = {
    statue: 'img/symbols/turn/statue.webp'
  };
  BR.SYMBOL_TURN_SHEET = { frames: 24, cols: 6, pad: 1.4, scale: 1.25 };
})(window.BR = window.BR || {});
