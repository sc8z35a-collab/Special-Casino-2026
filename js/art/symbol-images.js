/* Reel symbol images, rendered from their 3D models (tools/3d/render-art.mjs,
   placed by tools/art/symbol_3d.py). Each file is one transparent reel cell
   (192x182 design px at 2.5x). SYMBOL_TURN: each symbol's full 3D turn, 24
   frames (15 degrees apart, the first one the still) in a 6 x 4 sheet, each
   frame the cell made TURN.pad times bigger at TURN.scale x (loaded when a
   symbol first wins). */
(function (BR) {
  'use strict';
  BR.SYMBOL_IMG = {
    revolver: 'img/symbols/revolver.webp',
    gold: 'img/symbols/gold.webp',
    diamond: 'img/symbols/diamond.webp',
    star: 'img/symbols/star.webp',
    bar: 'img/symbols/bar.webp',
    seven: 'img/symbols/seven.webp',
    statue: 'img/symbols/statue.webp'
  };
  BR.SYMBOL_TURN = {
    revolver: 'img/symbols/turn/revolver.webp',
    gold: 'img/symbols/turn/gold.webp',
    diamond: 'img/symbols/turn/diamond.webp',
    star: 'img/symbols/turn/star.webp',
    bar: 'img/symbols/turn/bar.webp',
    seven: 'img/symbols/turn/seven.webp',
    statue: 'img/symbols/turn/statue.webp'
  };
  BR.SYMBOL_TURN_SHEET = { frames: 24, cols: 6, pad: 1.4, scale: 1.25 };
})(window.BR = window.BR || {});
