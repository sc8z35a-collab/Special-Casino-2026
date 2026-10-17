/* Decorative SVG pieces of the slot screen: reel window frame, pay-line
   markers and the SPIN button arrows. */
(function (BR) {
  'use strict';

  function rr(x, y, w, h, r) {
    return 'M' + (x + r) + ',' + y + 'H' + (x + w - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + w) + ',' + (y + r) +
      'V' + (y + h - r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + w - r) + ',' + (y + h) +
      'H' + (x + r) + 'A' + r + ',' + r + ' 0 0 1 ' + x + ',' + (y + h - r) +
      'V' + (y + r) + 'A' + r + ',' + r + ' 0 0 1 ' + (x + r) + ',' + y + 'Z';
  }

  // Gold frame around the 5x3 window (1044 x 586 design px).  Ring layout
  // measured from the reference: gold band 1..11, dark groove 11..17 (top
  // 12..16), side lips 18..25, bottom highlight 569..573.
  function reelFrame() {
    var W = 1044, H = 586;
    var outer = rr(0.5, 0.5, W - 1, H - 1, 17);
    var open = rr(11, 12, W - 22, H - 25, 4);
    var inner = rr(17.5, 16, W - 35, H - 32, 2);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs>' +
      '<linearGradient id="rfg" x1="0" y1="0" x2="0" y2="' + H + '" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#eab57c"/><stop offset="0.02" stop-color="#f2c27a"/><stop offset="0.5" stop-color="#efc57c"/><stop offset="0.975" stop-color="#e6b36e"/><stop offset="1" stop-color="#c99a5e"/></linearGradient>' +
      '<linearGradient id="rfl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6034"/><stop offset="0.2" stop-color="#ecc697"/><stop offset="0.45" stop-color="#d6b278"/><stop offset="0.75" stop-color="#b48c5c"/><stop offset="1" stop-color="#c8a27a"/></linearGradient>' +
      '<linearGradient id="rfr" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#8a6034"/><stop offset="0.2" stop-color="#edc498"/><stop offset="0.45" stop-color="#d4ad74"/><stop offset="0.75" stop-color="#b08a5e"/><stop offset="1" stop-color="#c8a27a"/></linearGradient>' +
      '<filter id="rfs" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '</defs>' +
      '<path d="' + outer + '" fill="none" stroke="#000" stroke-width="10" opacity="0.4" filter="url(#rfs)" transform="translate(0,5)"/>' +
      // gold band
      '<path d="' + outer + ' ' + open + '" fill="url(#rfg)" fill-rule="evenodd" stroke="#6e2c12" stroke-width="1"/>' +
      '<path d="' + rr(8.5, 9.5, W - 17, H - 18, 7) + '" fill="none" stroke="#fcd497" stroke-width="2.2" opacity="0.9"/>' +
      '<path d="' + rr(2.5, 2.5, W - 5, H - 5, 15) + '" fill="none" stroke="#f6cf8e" stroke-width="1" opacity="0.6"/>' +
      // groove
      '<clipPath id="rfc"><path d="' + open + '"/></clipPath>' +
      '<g clip-path="url(#rfc)">' +
      '<path d="' + open + ' ' + inner + '" fill="#7a4d18" fill-rule="evenodd"/>' +
      '<path d="M0,12.5 H' + W + '" stroke="#c9a77a" stroke-width="1.6"/>' +
      '<path d="M0,' + (H - 15.5) + ' H' + W + '" stroke="#fde6c4" stroke-width="3"/>' +
      '<path d="M0,' + (H - 13.5) + ' H' + W + '" stroke="#f7d29b" stroke-width="1.2"/>' +
      // side lips (overlap the reel canvas edge)
      '<rect x="17.5" y="15" width="7.5" height="' + (H - 32) + '" fill="url(#rfl)"/>' +
      '<rect x="' + (W - 25) + '" y="15" width="7.5" height="' + (H - 32) + '" fill="url(#rfr)"/>' +
      '</g>' +
      '</svg>';
  }

  // Red gem triangle with gold bezel (points right).
  function payline() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 46">' +
      '<defs><linearGradient id="plg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b0"/><stop offset="0.5" stop-color="#d9a446"/><stop offset="1" stop-color="#8e5c18"/></linearGradient>' +
      '<linearGradient id="plr" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="#ff6b78"/><stop offset="0.45" stop-color="#e3162e"/><stop offset="1" stop-color="#8a0614"/></linearGradient></defs>' +
      '<path d="M3.2,1.6 Q1.2,1 1.2,3.4 L1.2,42.6 Q1.2,45 3.2,44.4 L28,25 Q29.6,23 28,21Z" fill="#5e3a0c"/>' +
      '<path d="M3.6,3.4 L3.6,42.6 L26.6,23Z" fill="url(#plg)"/>' +
      '<path d="M7.4,10.6 L7.4,35.4 L21.6,23Z" fill="url(#plr)" stroke="#6d0410" stroke-width="0.8"/>' +
      '<path d="M8.6,13 L8.6,23 L18.6,23Z" fill="#ff9aa4" opacity="0.55"/>' +
      '</svg>';
  }

  // Two brown circular arrows of the SPIN button (194 x 194), measured from
  // the reference: body r 54..68, head r 45..78, tail cut at 204deg, tip at 346deg.
  function spinArrows() {
    var c = 97;
    function pt(a, rad) { a = a * Math.PI / 180; return (c + rad * Math.cos(a)).toFixed(2) + ',' + (c + rad * Math.sin(a)).toFixed(2); }
    function arrow(rot) {
      var a0 = 204 + rot, a1 = 316 + rot, tip = 346 + rot;
      var ro = 68, ri = 54;
      return 'M' + pt(a0, ro) + ' A' + ro + ',' + ro + ' 0 0 1 ' + pt(a1, ro) +
        ' L' + pt(a1 + 1, 78.5) + ' L' + pt(tip, 67.5) + ' L' + pt(a1 - 1, 44.5) + ' L' + pt(a1, ri) +
        ' A' + ri + ',' + ri + ' 0 0 0 ' + pt(a0 + 1.2, ri) + 'Z';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 194 194">' +
      '<defs><linearGradient id="sag" x1="0" y1="0" x2="0" y2="194" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6e4222"/><stop offset="0.5" stop-color="#603819"/><stop offset="1" stop-color="#6b4020"/></linearGradient>' +
      '<filter id="sab" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.6"/></filter></defs>' +
      '<g fill="url(#sag)" filter="url(#sab)"><path d="' + arrow(0) + '"/><path d="' + arrow(180) + '"/></g>' +
      '</svg>';
  }

  // Gold "stadium" button face with the multi-ring bezel of the reference.
  function pill(w, h) {
    function st(i) { var r = h / 2 - i; return rr(i, i, w - 2 * i, h - 2 * i, Math.max(0.5, r)); }
    var rings = [
      [0, 'url(#po)'],          // outer bevel (bright top, darker bottom)
      [2.2, '#8a5810'],         // dark groove
      [4.2, '#b07d3b'],
      [5.2, '#d8ae66'],
      [6.2, 'url(#pb)'],        // bright inner ring
      [10.4, '#d9b462'],
      [11.4, 'url(#pf)']        // face
    ];
    var body = '<path d="' + st(0) + '" fill="#4a1f05"/>';
    rings.forEach(function (r) { body += '<path d="' + st(r[0] + 0.6) + '" fill="' + r[1] + '"/>'; });
    var fx = (w / 2 - 11.4), fy = (h / 2 - 11.4);
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' +
      '<defs>' +
      '<linearGradient id="po" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0c886"/><stop offset="0.3" stop-color="#ecc37c"/><stop offset="0.75" stop-color="#d0995a"/><stop offset="1" stop-color="#c1835a"/></linearGradient>' +
      '<linearGradient id="pb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4a4"/><stop offset="0.5" stop-color="#fff0a0"/><stop offset="1" stop-color="#feeba7"/></linearGradient>' +
      '<radialGradient id="pf" cx="' + (w / 2) + '" cy="' + (h / 2) + '" r="' + fx + '" gradientUnits="userSpaceOnUse" gradientTransform="translate(' + (w / 2) + ',' + (h / 2) + ') scale(1,' + (fy / fx).toFixed(4) + ') translate(' + (-w / 2) + ',' + (-h / 2) + ')">' +
      '<stop offset="0" stop-color="#fffbb4"/><stop offset="0.42" stop-color="#fff6a2"/><stop offset="0.6" stop-color="#fde58d"/>' +
      '<stop offset="0.76" stop-color="#f5cf77"/><stop offset="0.88" stop-color="#e6b360"/><stop offset="1" stop-color="#d3a554"/></radialGradient>' +
      '</defs>' + body +
      '<path d="' + st(1.3) + '" fill="none" stroke="#fff3c8" stroke-width="0.7" opacity="0.6"/>' +
      '</svg>';
  }

  BR.UISVG = { reelFrame: reelFrame, payline: payline, spinArrows: spinArrows, pill: pill, rr: rr };
})(window.BR = window.BR || {});
