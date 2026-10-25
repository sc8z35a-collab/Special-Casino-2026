/* What this browser can say of itself, sent along with a login so that a wrong try is written to
   the operators' log with all that is known of where it came from (the server reads the
   connection and the headers itself: server/core/reqinfo.js). Plain facts that any page can read:
   nothing here changes how the page works, nothing is stored, and nothing leaves the page but
   with the login. The server keeps it apart as "what the page said" (it can be made up) and cuts
   it down to the names it knows. Used by the operator site and by security HOME. */
window.OpsDevice = (function () {
  'use strict';
  var born = performance.now(), keys = 0, firstKey = 0, gpu = null;

  // how the form is filled: a person types; a program (or the browser's autofill) sets it at once
  function watch(form) {
    form.addEventListener('keydown', function () { if (!firstKey) firstKey = performance.now(); keys++; }, true);
  }
  function media(q) { try { return window.matchMedia(q).matches; } catch (e) { return undefined; } }
  // the graphics chip, as the browser tells it (not every browser does)
  function chip() {
    if (gpu !== null) return gpu;
    gpu = '';
    try {
      var c = document.createElement('canvas'), g = c.getContext('webgl') || c.getContext('experimental-webgl');
      var x = g && g.getExtension('WEBGL_debug_renderer_info');
      if (x) gpu = String(g.getParameter(x.UNMASKED_RENDERER_WEBGL) || '');
      var lose = g && g.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (e) { gpu = ''; }
    return gpu;
  }
  function facts(page, fresh) {
    var n = navigator, s = window.screen || {}, c = n.connection || n.mozConnection || n.webkitConnection || {}, tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { tz = ''; }
    var now = performance.now();
    return {
      page: page, lang: n.language, langs: n.languages ? Array.prototype.slice.call(n.languages, 0, 8) : undefined,
      tz: tz, tzOffset: new Date().getTimezoneOffset(),
      screen: { w: s.width, h: s.height, aw: s.availWidth, ah: s.availHeight, depth: s.colorDepth, dpr: window.devicePixelRatio },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      touch: n.maxTouchPoints, cores: n.hardwareConcurrency, memory: n.deviceMemory,
      platform: n.platform, vendor: n.vendor, product: n.product,
      webdriver: n.webdriver === true, cookies: n.cookieEnabled, dnt: n.doNotTrack, pdf: n.pdfViewerEnabled, online: n.onLine,
      standalone: media('(display-mode: standalone)') === true || n.standalone === true,
      plugins: n.plugins ? n.plugins.length : undefined,
      conn: { type: c.type, effective: c.effectiveType, down: c.downlink, rtt: c.rtt, save: c.saveData },
      prefers: {
        dark: media('(prefers-color-scheme: dark)'), reduceMotion: media('(prefers-reduced-motion: reduce)'),
        contrast: media('(prefers-contrast: more)') ? 'more' : media('(prefers-contrast: less)') ? 'less' : '',
        pointer: media('(pointer: coarse)') ? 'coarse' : media('(pointer: fine)') ? 'fine' : '', hover: media('(hover: hover)')
      },
      gpu: chip(), fresh: !!fresh,
      sinceLoad: Math.round(now - born), keys: keys, typing: firstKey ? Math.round(now - firstKey) : 0
    };
  }
  // all of it, with the finer details of the browser's own hints when it gives them (never later than half a second)
  function collect(page, fresh) {
    var out;
    try { out = facts(page, fresh); } catch (e) { return Promise.resolve({ page: page }); }
    var ud = navigator.userAgentData;
    if (!ud) return Promise.resolve(out);
    out.uaData = { brands: ud.brands, mobile: ud.mobile, platform: ud.platform };
    if (!ud.getHighEntropyValues) return Promise.resolve(out);
    var more = ud.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'wow64']).then(function (v) {
      out.uaData.arch = v.architecture; out.uaData.bitness = v.bitness; out.uaData.model = v.model; out.uaData.platformVersion = v.platformVersion;
      out.uaData.uaFullVersion = v.uaFullVersion; out.uaData.fullVersionList = v.fullVersionList; out.uaData.wow64 = v.wow64;
    }, function () { /* the hints are optional */ });
    var limit = new Promise(function (ok) { setTimeout(ok, 500); });
    return Promise.race([more, limit]).then(function () { return out; });
  }
  return { watch: watch, collect: collect };
})();
