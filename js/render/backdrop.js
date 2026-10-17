/* Static backdrop: red art-deco wallpaper (canvas) + gold screen frame (SVG). */
(function (BR) {
  'use strict';

  var REF_W = 2000, REF_H = 924;

  function patternSVG(W, H) {
    var pat = BR.PATTERN, P = pat.P;
    var ox = pat.origin[0] + (W - REF_W) / 2;
    var oy = pat.origin[1] + (H - REF_H) / 2;
    ox -= Math.ceil(ox / P) * P;
    oy -= Math.ceil(oy / P) * P;
    var uses = '';
    for (var y = oy; y < H; y += P) {
      for (var x = ox; x < W; x += P) {
        uses += '<use href="#bgtile" x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '"/>';
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H +
      '" viewBox="0 0 ' + W + ' ' + H + '"><defs><g id="bgtile">' + pat.tile + '</g></defs>' +
      '<g stroke="#57050d">' + uses + '</g></svg>';
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = src;
    });
  }

  // Draws the wallpaper into `canvas` sized W x H design px at `res` device
  // px per design px.  Lighting was matched to the reference: an even base
  // with a soft light patch upper-right, a weaker one upper-left and a
  // slightly darker bottom.
  function drawBackground(canvas, W, H, res) {
    canvas.width = Math.round(W * res);
    canvas.height = Math.round(H * res);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(res, 0, 0, res, 0, 0);
    ctx.fillStyle = '#37030a';
    ctx.fillRect(0, 0, W, H);
    var dx = (W - REF_W) / 2, dy = (H - REF_H) / 2;
    return loadImage(BR.svgURL(patternSVG(W, H))).then(function (img) {
      ctx.drawImage(img, 0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      spot(ctx, 1690 + dx, 230 + dy, 420, 'rgba(30,1,5,1)');
      spot(ctx, 300 + dx, 280 + dy, 330, 'rgba(8,0,1,1)');
      ctx.globalCompositeOperation = 'multiply';
      var b = ctx.createLinearGradient(0, H * 0.55, 0, H);
      b.addColorStop(0, 'rgb(255,255,255)');
      b.addColorStop(1, 'rgb(205,205,205)');
      ctx.fillStyle = b;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  function spot(ctx, x, y, r, color) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Gold double-line frame with stepped/chamfered art-deco corners.
  function frameSVG(W, H) {
    var corner =
      // dark bronze fill in the corner wedge
      '<path d="M4.5,4.5 L53,4.5 L4.5,53Z" fill="#3b2a0c"/>' +
      // nested bracket ornament
      '<path d="M12,38 V12 H38" fill="none" stroke="url(#fg)" stroke-width="2.6"/>' +
      '<path d="M19,31 V19 H31" fill="none" stroke="url(#fg)" stroke-width="2.2"/>' +
      // outer chamfer
      '<path d="M53,5.5 L5.5,53" stroke="url(#fg)" stroke-width="3"/>' +
      // inner stepped line with chamfer
      '<path d="M140,12.5 H101 L94,19.5 H60 L19.5,60 V94 L12.5,101 V140" fill="none" stroke="url(#fg)" stroke-width="3" stroke-linejoin="miter"/>' +
      '<path d="M140,11.2 H101.6 L94.6,18.2 H60.4 L18.2,60.4 V94.6 L11.2,101.6 V140" fill="none" stroke="#fff6cf" stroke-width="0.8" opacity="0.7"/>';
    var tr = function (t) { return '<g transform="' + t + '">' + corner + '</g>'; };
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="fg" x1="0" y1="0" x2="' + W + '" y2="' + H + '" gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#f9e19b"/><stop offset="0.12" stop-color="#c8963f"/><stop offset="0.3" stop-color="#f3d27f"/>' +
      '<stop offset="0.5" stop-color="#d4a24a"/><stop offset="0.7" stop-color="#f6da8c"/><stop offset="0.88" stop-color="#c38f38"/><stop offset="1" stop-color="#f2cf7a"/></linearGradient>' +
      '<linearGradient id="fgv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f8de96"/><stop offset="0.5" stop-color="#d9a84d"/><stop offset="1" stop-color="#a87628"/></linearGradient></defs>' +
      // outer band
      '<path d="M0,0 H' + W + ' V' + H + ' H0Z M4.5,4.5 V' + (H - 4.5) + ' H' + (W - 4.5) + ' V4.5Z" fill="url(#fg)" fill-rule="evenodd"/>' +
      '<path d="M5,5 H' + (W - 5) + ' V' + (H - 5) + ' H5Z" fill="none" stroke="#2a1604" stroke-width="1" opacity="0.6"/>' +
      // straight inner lines between the corners
      '<path d="M140,12.5 H' + (W - 140) + ' M140,' + (H - 12.5) + ' H' + (W - 140) + ' M12.5,140 V' + (H - 140) + ' M' + (W - 12.5) + ',140 V' + (H - 140) + '" stroke="url(#fg)" stroke-width="3"/>' +
      tr('') +
      tr('translate(' + W + ',0) scale(-1,1)') +
      tr('translate(0,' + H + ') scale(1,-1)') +
      tr('translate(' + W + ',' + H + ') scale(-1,-1)') +
      '</svg>';
  }

  BR.backdrop = { drawBackground: drawBackground, frameSVG: frameSVG, loadImage: loadImage };
})(window.BR = window.BR || {});
