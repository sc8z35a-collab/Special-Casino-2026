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

    grip: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M14,11V29M20,11V29M26,11V29" stroke="#6b6f86" stroke-width="2.6" stroke-linecap="round"/></svg>',

    /* online features */
    lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="lkg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".5" stop-color="#e9bf3a"/><stop offset="1" stop-color="#a87412"/></linearGradient></defs>' +
      '<path d="M12.5,18V13.5Q12.5,5.5 20,5.5Q27.5,5.5 27.5,13.5V18" fill="none" stroke="#d9dde4" stroke-width="4.2"/>' +
      '<rect x="7.5" y="17" width="25" height="19" rx="3.5" fill="url(#lkg)" stroke="#5a3a00" stroke-width="1.4"/>' +
      '<circle cx="20" cy="25" r="3" fill="#4a2e00"/><rect x="18.6" y="26" width="2.8" height="6" rx="1.2" fill="#4a2e00"/></svg>',

    phone: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M11.5,4.5 L16.5,10.5 Q17.6,12 16.4,13.6 L13.8,16.6 Q16.6,22.6 23.4,26.2 L26.4,23.6 Q28,22.4 29.5,23.5 L35.5,28.5 Q36.6,29.6 35.6,31 L32.6,34.4 Q30.6,36.4 27.2,35.4 Q11,30 4.6,12.8 Q3.6,9.4 5.6,7.4 L9,4.4 Q10.4,3.4 11.5,4.5Z" fill="#fff"/></svg>',

    hangup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M4,22.5 Q4,16 20,16 Q36,16 36,22.5 L35,27 Q34.6,28.6 33,28.4 L26.6,27.2 Q25,26.8 25,25.2 L25,21.6 Q20,20.4 15,21.6 L15,25.2 Q15,26.8 13.4,27.2 L7,28.4 Q5.4,28.6 5,27Z" fill="#fff"/></svg>',

    micOn: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="14" y="4" width="12" height="21" rx="6" fill="#fff"/><path d="M8.5,19Q8.5,30.5 20,30.5Q31.5,30.5 31.5,19M20,30.5V36.5M13.5,36.5H26.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',

    micOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="14" y="4" width="12" height="21" rx="6" fill="#fff" opacity=".55"/><path d="M8.5,19Q8.5,30.5 20,30.5Q31.5,30.5 31.5,19M20,30.5V36.5M13.5,36.5H26.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/><path d="M6,5L34,35" stroke="#ff5a4f" stroke-width="4" stroke-linecap="round"/></svg>',

    eye: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M2.5,20Q11,8.5 20,8.5Q29,8.5 37.5,20Q29,31.5 20,31.5Q11,31.5 2.5,20Z" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><circle cx="20" cy="20" r="6.6" fill="#fff"/><circle cx="22" cy="18" r="2.2" fill="#3a3a3a"/></svg>',

    car: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M5,25.5V20.5Q5,18.6 7,18.2L11.5,17.4L15.4,11.6Q16.4,10.4 18,10.4H26.6Q28.2,10.4 29.2,11.8L32.6,17.4Q35.4,18 35.4,21V25.5Q35.4,27 34,27H6.5Q5,27 5,25.5Z" fill="#fff"/><path d="M14.4,17.2L17.2,13H22V17.2ZM24.2,17.2V13H27.2L29.6,17.2Z" fill="#6b5a2c"/><circle cx="12" cy="27.4" r="4.4" fill="#2b2b2b" stroke="#fff" stroke-width="2.2"/><circle cx="28.6" cy="27.4" r="4.4" fill="#2b2b2b" stroke="#fff" stroke-width="2.2"/></svg>',

    gift: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="5" y="14" width="30" height="8" rx="1.6" fill="#fff"/><rect x="7.5" y="22" width="25" height="14" rx="1.6" fill="#fff"/><rect x="18" y="14" width="4.2" height="22" fill="#e5262b"/><path d="M20,14Q12,4 8.6,8.6Q6.6,12.6 20,14ZM20,14Q28,4 31.4,8.6Q33.4,12.6 20,14Z" fill="none" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/></svg>',

    friends: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="14.5" cy="13" r="6.4" fill="#fff"/><path d="M2.5,34Q3.5,22 14.5,22Q25.5,22 26.5,34Z" fill="#fff"/><circle cx="27.5" cy="12" r="5.4" fill="#fff" opacity=".7"/><path d="M28.4,20.4Q37,21 37.6,32H29.4Q28.6,25 24.6,21.6Q26,20.4 28.4,20.4Z" fill="#fff" opacity=".7"/></svg>',

    search: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="17" cy="17" r="10.5" fill="none" stroke="#fff" stroke-width="4"/><path d="M25,25L35,35" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>',

    check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M7,21L16,30L33,11" fill="none" stroke="#fff" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    /* installing the app */
    share: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M14,15H10.5Q8,15 8,17.5V34Q8,36.5 10.5,36.5H29.5Q32,36.5 32,34V17.5Q32,15 29.5,15H26" fill="none" stroke="#4aa8ff" stroke-width="2.8" stroke-linecap="round"/><path d="M20,24V3.5M13.5,10L20,3.5L26.5,10" fill="none" stroke="#4aa8ff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',

    addHome: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="5" y="5" width="30" height="30" rx="7" fill="none" stroke="#fff" stroke-width="2.8"/><path d="M20,12.5V27.5M12.5,20H27.5" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/></svg>',

    download: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M20,4V25M12,17.5L20,25.5L28,17.5" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6,26V31.5Q6,35 9.5,35H30.5Q34,35 34,31.5V26" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>',

    android: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M8,30V18.5Q8,17 9.5,17H30.5Q32,17 32,18.5V30Q32,31.5 30.5,31.5H9.5Q8,31.5 8,30ZM8.6,15Q10,6.5 20,6.5Q30,6.5 31.4,15Z" fill="#3ddc84"/><circle cx="14.5" cy="11.5" r="1.6" fill="#0d3b22"/><circle cx="25.5" cy="11.5" r="1.6" fill="#0d3b22"/><path d="M11.5,7L9,3M28.5,7L31,3" stroke="#3ddc84" stroke-width="2" stroke-linecap="round"/></svg>',

    apple: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M27.6,21.2Q27.5,16.6 31.4,14.4Q29.2,11.2 25.4,11Q23.6,10.8 21.4,11.8Q20,12.4 19.3,12.4Q18.4,12.4 16.8,11.8Q15,11 13.4,11.1Q8.6,11.4 6.8,16Q5.4,19.6 6.6,24.8Q7.6,29 10.4,32.6Q12.2,35 14.2,35Q15.4,35 16.8,34.3Q18.2,33.6 19.8,33.6Q21.4,33.6 22.8,34.3Q24.2,35 25.6,34.9Q28.2,34.8 30.4,31Q31.6,29 32.2,27Q27.8,25.2 27.6,21.2ZM24.8,8.2Q26.6,5.9 26.4,3.4Q24,3.6 22.2,5.6Q20.4,7.6 20.6,10.2Q23,10.4 24.8,8.2Z" fill="#fff"/></svg>',
    // shopping bag (Shop tab)
    bag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M7.5,13H32.5L30.6,35.4Q30.4,37 28.8,37H11.2Q9.6,37 9.4,35.4Z" fill="#fff"/><path d="M14,16.5V10.5Q14,4.5 20,4.5Q26,4.5 26,10.5V16.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="14" cy="17" r="1.8" fill="#8a2020"/><circle cx="26" cy="17" r="1.8" fill="#8a2020"/></svg>',
    // a house
    home: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M4,19.5L20,5.5L36,19.5" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5,18V34.5Q8.5,36 10,36H16.5V26.5H23.5V36H30Q31.5,36 31.5,34.5V18L20,8.4Z" fill="#fff"/></svg>',
    // play a recorded voice again
    speaker: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M5,15H12L21,7V33L12,25H5Z" fill="#fff"/><path d="M26,14Q30,20 26,26M30.5,10Q37.5,20 30.5,30" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
    speakerOff: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M5,15H12L21,7V33L12,25H5Z" fill="#fff" opacity=".55"/><path d="M26,14Q30,20 26,26M30.5,10Q37.5,20 30.5,30" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".55"/><path d="M6,5L34,35" stroke="#ff5a4f" stroke-width="4" stroke-linecap="round"/></svg>',
    // the chat of a home (a speech bubble)
    chat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><path d="M7,6H33Q37,6 37,10V25Q37,29 33,29H19L10.5,35.5V29H7Q3,29 3,25V10Q3,6 7,6Z" fill="#fff"/><circle cx="12.5" cy="17.5" r="2.4" fill="#2a0408"/><circle cx="20" cy="17.5" r="2.4" fill="#2a0408"/><circle cx="27.5" cy="17.5" r="2.4" fill="#2a0408"/></svg>'
  };

  BR.ICONS = ICONS;
  BR.chipSVG = chip;

  BR.svgURL = function (svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
})(window.BR = window.BR || {});
