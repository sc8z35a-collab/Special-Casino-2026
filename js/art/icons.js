/* Hand-drawn UI icons (SVG strings). */
(function (BR) {
  'use strict';

  // Casino chip / spin token: red ring with white inserts, silver horseshoe centre.
  function chip(id) {
    id = id || 'cp';
    var inserts = '';
    for (var i = 0; i < 8; i++) {
      var a = i * 45 + 22.5;
      inserts += '<path d="M43.4,2.6 Q50,2 56.6,2.6 L55.2,13.2 Q50,12.7 44.8,13.2Z" transform="rotate(' + a + ' 50 50)"/>';
    }
    var notches = '';
    for (var j = 0; j < 32; j++) {
      notches += '<rect x="48.8" y="13.6" width="2.4" height="3.4" rx="0.5" transform="rotate(' + (j * 11.25) + ' 50 50)"/>';
    }
    var holes = '';
    [[-14.5, 6], [-15.5, -3], [-12.5, -11.5], [14.5, 6], [15.5, -3], [12.5, -11.5]].forEach(function (p) {
      holes += '<ellipse cx="' + (50 + p[0]) + '" cy="' + (50 + p[1]) + '" rx="1.5" ry="1.1"/>';
    });
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<defs>' +
      '<radialGradient id="' + id + 'r" cx="0.4" cy="0.35" r="0.75"><stop offset="0" stop-color="#ef5a3c"/><stop offset="0.55" stop-color="#d0331f"/><stop offset="1" stop-color="#9e1e12"/></radialGradient>' +
      '<linearGradient id="' + id + 'w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#e2e2e2"/><stop offset="1" stop-color="#b9b9b9"/></linearGradient>' +
      '<radialGradient id="' + id + 's" cx="0.38" cy="0.32" r="0.8"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#e3e3e3"/><stop offset="0.75" stop-color="#b3b3b3"/><stop offset="1" stop-color="#8d8d8d"/></radialGradient>' +
      '<linearGradient id="' + id + 'h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fafafa"/><stop offset="0.5" stop-color="#c9c9c9"/><stop offset="1" stop-color="#8a8a8a"/></linearGradient>' +
      '</defs>' +
      '<circle cx="50" cy="50" r="49" fill="#6e140c"/>' +
      '<circle cx="50" cy="50" r="47.6" fill="url(#' + id + 'r)"/>' +
      '<g fill="url(#' + id + 'w)">' + inserts + '</g>' +
      '<circle cx="50" cy="50" r="37.2" fill="#3a3a3a"/>' +
      '<circle cx="50" cy="50" r="36" fill="#d6d6d6"/>' +
      '<g fill="#3c3c3c">' + notches + '</g>' +
      '<circle cx="50" cy="50" r="32.6" fill="#6d6d6d"/>' +
      '<circle cx="50" cy="50" r="31.6" fill="url(#' + id + 's)"/>' +
      '<circle cx="50" cy="50" r="27.6" fill="none" stroke="#ffffff" stroke-width="1.6" opacity="0.85"/>' +
      '<circle cx="50" cy="50" r="26.4" fill="none" stroke="#8f8f8f" stroke-width="0.8" opacity="0.7"/>' +
      '<g transform="rotate(38 50 50)">' +
      '<path d="M36.5,56 Q34,40 42,33.5 Q50,28 58,33.5 Q66,40 63.5,56 L66.5,57 L64.5,63.5 L56.5,61.5 L57.5,57.5 Q60.5,42.5 54.5,38.5 Q50,35.5 45.5,38.5 Q39.5,42.5 42.5,57.5 L43.5,61.5 L35.5,63.5 L33.5,57Z" fill="#6a6a6a" transform="translate(0.9,1.1)" opacity="0.8"/>' +
      '<path d="M36.5,56 Q34,40 42,33.5 Q50,28 58,33.5 Q66,40 63.5,56 L66.5,57 L64.5,63.5 L56.5,61.5 L57.5,57.5 Q60.5,42.5 54.5,38.5 Q50,35.5 45.5,38.5 Q39.5,42.5 42.5,57.5 L43.5,61.5 L35.5,63.5 L33.5,57Z" fill="url(#' + id + 'h)"/>' +
      '<g fill="#555" transform="translate(0 2)">' + holes + '</g>' +
      '</g>' +
      '<ellipse cx="38" cy="34" rx="12" ry="6" fill="#fff" opacity="0.35" transform="rotate(-30 38 34)"/>' +
      '</svg>';
  }

  // spin-token / dollar / coin icons are bitmaps now (BR.UI_IMG)
  var ICONS = {
    plus: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M20,9.5V30.5M9.5,20H30.5" stroke="#fff" stroke-width="5" stroke-linecap="square"/></svg>',

    back: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 42"><path d="M40.5,21H5.5M22.5,3.5L3.5,21L22.5,38.5" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    soundOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 50"><path d="M3,17.6 Q3,15 5.6,15 L15,15 L29.6,3.6 Q33,1.4 33,5.4 L33,44.6 Q33,48.6 29.6,46.4 L15,35.4 L5.6,35.4 Q3,35.4 3,32.8Z" fill="#d9d9d9"/>' +
      '<path d="M37.6,16.6L55,34M55,16.6L37.6,34" stroke="#e8232b" stroke-width="5"/></svg>',

    soundOn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 50"><path d="M3,17.6 Q3,15 5.6,15 L15,15 L29.6,3.6 Q33,1.4 33,5.4 L33,44.6 Q33,48.6 29.6,46.4 L15,35.4 L5.6,35.4 Q3,35.4 3,32.8Z" fill="#d9d9d9"/>' +
      '<path d="M39,17 Q43,25 39,33M44.5,11.5 Q52,25 44.5,38.5M50,6 Q61,25 50,44" fill="none" stroke="#d9d9d9" stroke-width="3.6" stroke-linecap="round"/></svg>',

    // drawn in the coordinate frame of their HUD circle (origin = circle centre)
    radio: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-43 -43 86 86">' +
      '<path fill="#d8d3d3" fill-rule="evenodd" d="' +
      'M3.4,-24.4 Q3.4,-27.2 6.2,-27.2 Q9,-27.2 9,-24.4 L9,-11 L3.4,-11Z ' +
      'M-11,-12 Q-11,-13.9 -9.1,-13.9 L-6.4,-13.9 Q-4.5,-13.9 -4.5,-12 Z ' +
      'M-12.2,-9 Q-12.2,-11.6 -9.6,-11.6 L9.9,-11.6 Q12.5,-11.6 12.5,-9 L12.5,-7 L13.3,-6.6 L13.3,-1.6 L12.5,-1.2 L12.5,20.4 Q12.5,23 9.9,23 L-9.6,23 Q-12.2,23 -12.2,20.4Z ' +
      'M-9,-6 Q-9,-8 -7,-8 L7,-8 Q9,-8 9,-6 L9,-1 Q9,1 7,1 L-7,1 Q-9,1 -9,-1Z ' +
      'M-5,7.9 Q-5,6.8 -3.9,6.8 L3.4,6.8 Q4.5,6.8 4.5,7.9 Q4.5,9 3.4,9 L-3.9,9 Q-5,9 -5,7.9Z ' +
      'M-7,12 Q-7,10.8 -5.8,10.8 L5.3,10.8 Q6.5,10.8 6.5,12 Q6.5,13.2 5.3,13.2 L-5.8,13.2 Q-7,13.2 -7,12Z ' +
      'M-5,16.75 Q-5,15.5 -3.75,15.5 L3.25,15.5 Q4.5,15.5 4.5,16.75 Q4.5,18 3.25,18 L-3.75,18 Q-5,18 -5,16.75Z"/>' +
      '</svg>',

    mic: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-46 -46 92 92">' +
      '<rect x="-8" y="-17.5" width="16" height="27" rx="8" fill="#d8d3d3"/>' +
      '<path d="M-12.6,0.6 V1 A12.6,12.6 0 0 0 12.6,1 V0.6 M0,13.6 V22.4 M-8,22.4 H8" fill="none" stroke="#d8d3d3" stroke-width="2.6" stroke-linecap="round"/>' +
      '</svg>',

    edit: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M27,13 V7.5 Q27,5 24.5,5 H7.5 Q5,5 5,7.5 V32.5 Q5,35 7.5,35 H15" fill="none" stroke="#d6dbe6" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M10.5,13H21.5M10.5,19.5H17" stroke="#d6dbe6" stroke-width="2.8" stroke-linecap="round"/>' +
      '<path d="M18.5,35.5 L19.4,30 L31.2,18.2 Q32.6,16.8 34,18.2 L35.8,20 Q37.2,21.4 35.8,22.8 L24,34.6Z" fill="none" stroke="#d6dbe6" stroke-width="2.6" stroke-linejoin="round"/></svg>',

    stopwatch: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="15.5" y="2" width="9" height="4.4" rx="1.4" fill="#f5b200"/><rect x="18.4" y="5" width="3.2" height="5" fill="#f5b200"/>' +
      '<path d="M30,8.5 L33.8,12.2" stroke="#f5b200" stroke-width="3.2" stroke-linecap="round"/>' +
      '<circle cx="20" cy="23.5" r="14" fill="none" stroke="#f5b200" stroke-width="4"/>' +
      '<path d="M20,23.5 L20,15.5" stroke="#f5b200" stroke-width="3.4" stroke-linecap="round"/><circle cx="20" cy="23.5" r="2.6" fill="#f5b200"/>' +
      '<path d="M8.6,19 Q10.6,12.4 17,10.4" stroke="#f5b200" stroke-width="2.4" fill="none" stroke-linecap="round" opacity="0.6"/></svg>',

    info: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18.5" fill="#f6c700"/><circle cx="20" cy="11.4" r="2.9" fill="#3a2a00"/><rect x="17.3" y="16.4" width="5.4" height="14.6" rx="1.6" fill="#3a2a00"/></svg>',

    del: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36"><path d="M15,4 H42 Q45,4 45,7 V29 Q45,32 42,32 H15 L3,18Z" fill="none" stroke="#fff" stroke-width="3.4" stroke-linejoin="round"/>' +
      '<path d="M23,12 L35,24 M35,12 L23,24" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/></svg>',

    grip: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M14,11V29M20,11V29M26,11V29" stroke="#6b6f86" stroke-width="2.6" stroke-linecap="round"/></svg>'
  };

  BR.ICONS = ICONS;
  BR.chipSVG = chip;

  BR.svgURL = function (svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
})(window.BR = window.BR || {});
