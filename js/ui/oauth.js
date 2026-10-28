/* Google / Discord (server/core/oauth.js): "Googleで続ける" / "Discordで続ける" on the sign-up and log-in cards (a new player or one who linked
   it before), and the 連携 buttons of the profile (a player who is in adds one more way in).

   The page asks the server for the provider's address and a secret for this sign-in (kept in localStorage, so it survives the trip), and goes
   there: in a browser, this tab; in the app (and an installed web app), the phone's browser, because Google refuses to run in an app's own web
   view (the app opens every address that is not the game's in the browser). While the provider has the player, this page asks the server every
   couple of seconds how it went, and at once when it is in front again, so the player only has to come back. Nothing a page could use is in
   any address; the secret works only from the device that began it. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$, $$ = U.$$;
  var KEY = 'blockbuster-reels/oauth-flow';
  var LIFE = 15 * 60 * 1000;
  var NAMES = { google: 'Google', discord: 'Discord' };

  var attempts = 0, timer = 0, asking = false, starting = false, providers = null, shown = '', generation = 0;

  /* ------------------------------------------------------------ the flow under way --- */
  // (kept in localStorage so it survives the trip to the provider; in this page's memory as well, for a browser that keeps nothing)
  var memory = null;
  function saved() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.flow && NAMES[s.provider] && Date.now() - s.at < LIFE) return s;
      if (s) localStorage.removeItem(KEY);
    } catch (e) { /* none */ }
    return null;
  }
  function save(s) { memory = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* in this page only */ } }
  function current() { return saved() || (memory && Date.now() - memory.at < LIFE ? memory : null); }
  function clear() {
    generation++; asking = false; starting = false;
    memory = null;
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    stop();
  }
  function stop() { clearTimeout(timer); timer = 0; }
  function active(s, gen) { var live = current(); return gen === generation && live && live.flow === s.flow; }

  // in the app (and an installed web app) the provider's page is the phone's browser
  function external() { var p = BR.platform || {}; return !!(p.app || p.standalone); }

  /* ------------------------------------------------------------ providers --- */
  function loadProviders() {
    if (!api.online) return Promise.resolve({});
    if (!providers) providers = api.oauthProviders().catch(function () { providers = null; return {}; });
    return providers;
  }
  function paintButtons() {
    loadProviders().then(function (p) {
      $$('#welcome .ov-social').forEach(function (box) {
        var any = false;
        $$('[data-sns]', box).forEach(function (b) {
          var on = !!p[b.dataset.sns];
          b.hidden = !on;
          any = any || on;
        });
        box.hidden = !any;
      });
    });
  }

  /* ------------------------------------------------------------ beginning --- */
  function failed(err) {
    starting = false;
    K.sfx('deny');
    if (BR.account.isOpen() && shown !== 'wait') { shownError(err.message); return; }
    K.toast(err.message, 4200);
  }
  // the message on the card that is open (the sign-up and log-in cards have their own lines)
  function shownError(text) {
    var card = ['register', 'login'].filter(function (c) { return !$('#ov-' + c).hidden; })[0];
    var e = card && $('#ov-' + card + '-error');
    if (e) e.textContent = text;
    else K.toast(text, 4200);
  }

  function begin(provider, purpose) {
    if (starting || !NAMES[provider]) return;
    clear();
    starting = true;
    var gen = generation;
    var ext = external();
    (purpose === 'link' ? api.oauthLinkStart(provider, ext) : api.oauthStart(provider, ext)).then(function (r) {
      if (gen !== generation) return;
      starting = false;
      save({ flow: r.flow, provider: provider, purpose: purpose, external: ext, url: r.url, at: Date.now() });
      if (purpose === 'login') { shown = 'wait'; BR.account.oauthWait({ provider: provider, external: ext }); }
      else K.toast(NAMES[provider] + 'のログイン画面を開きます', 2600);
      go(r.url);
      watch();
    }, function (err) { if (gen === generation) failed(err); });
  }
  // (the app hands an address that is not the game's to the phone's browser; in a browser this tab goes there and comes back)
  function go(url) { BR.oauth.go(url); }

  /* ------------------------------------------------------------ asking how it went --- */
  function watch() {
    stop();
    attempts = 0;
    function poll() {
      timer = 0;
      if (!current()) { var expired = memory; clear(); if (expired) end(expired, 'ログインの有効期限が切れました。もう一度お試しください。'); return; }
      ask();
      timer = setTimeout(poll, Math.min(30000, 2000 * Math.pow(1.5, attempts++)));
    }
    poll();
  }
  function ask() {
    var s = current();
    if (!s) { stop(); return; }
    if (asking || document.hidden) return;
    var gen = generation;
    asking = true;
    api.oauthPoll(s.flow).then(function (r) { if (!active(s, gen)) return; asking = false; answer(s, r); }, function (err) { if (!active(s, gen)) return; asking = false; trouble(s, err); });
  }
  function answer(s, r) {
    if (r.step === 'wait') {
      if (s.purpose === 'login' && shown !== 'wait' && s.external) { shown = 'wait'; BR.account.oauthWait({ provider: s.provider, external: true }); }
      return;
    }
    stop();
    shown = '';
    if (r.step === 'failed') { end(s, r.message || 'ログインできませんでした'); return; }
    if (r.step === 'login') { clear(); BR.account.signedIn(r); return; }
    if (r.step === 'signup') { K.sfx('click'); BR.account.oauthSignup({ flow: s.flow, provider: r.provider || s.provider, label: r.label || '' }); return; }
    if (r.step === 'ready') { link(s); return; }
    end(s, 'ログインできませんでした');
  }
  function trouble(s, err) {
    // no signal for a moment: keep asking; anything else ends this sign-in
    if (err && (err.code === 'network' || err.status === 0 || err.status >= 500 || err.code === 'rate_limited')) return;
    stop();
    shown = '';
    end(s, err && err.message ? err.message : 'ログインできませんでした');
  }
  // a sign-in that ended without an account: the reason, where the player is looking
  function end(s, message) {
    clear();
    K.sfx('deny');
    if (s.purpose === 'login') BR.account.oauthWait({ provider: s.provider, external: false, error: message });
    else { if (BR.account.isOpen()) BR.account.close(); K.toast(message, 4800); }
  }

  /* ------------------------------------------------------------ linking (the profile) --- */
  function link(s) {
    var gen = generation;
    api.oauthLink(s.flow).then(function (r) {
      if (!active(s, gen)) return;
      clear();
      K.sfx('purchase');
      K.toast((NAMES[r.provider] || '') + 'を連携しました。次からこれでもログインできます', 4200);
      refreshTiles();
    }, function (err) { if (active(s, gen)) end(s, err.message); });
  }

  // the tiles of the player's own profile (js/ui/profile-custom.js makes them): one for each provider the server offers
  var tileSeq = 0, last = null;
  function profileTiles(box, make) {
    last = { box: box, make: make };
    if (!api.online || !api.hasToken()) return;
    var seq = ++tileSeq;
    api.oauthLinks().then(function (r) {
      if (seq !== tileSeq || !box.isConnected) return;
      $$('[data-act^="oauth:"]', box).forEach(function (b) { b.remove(); });
      Object.keys(NAMES).forEach(function (p) {
        if (!r.providers[p]) return;
        var mine = r.links.filter(function (l) { return l.provider === p; })[0];
        var b = make(mine ? NAMES[p] + 'の連携を解除（連携中' + (mine.label ? '：' + mine.label : '') + '）' : NAMES[p] + 'を連携', p, 'oauth:' + p);
        b.classList.toggle('linked', !!mine);
        box.appendChild(b);
      });
    }, function () { /* the tiles stay away */ });
  }
  function refreshTiles() { if (last && last.box.isConnected) profileTiles(last.box, last.make); }
  function tapTile(provider) {
    if (!NAMES[provider]) return;
    api.oauthLinks().then(function (r) {
      var mine = r.links.filter(function (l) { return l.provider === provider; })[0];
      if (!mine) { K.closeModal('profile'); begin(provider, 'link'); return; }
      K.confirmBox(function (p) {
        p.appendChild(document.createTextNode(NAMES[provider] + 'の連携を解除しますか？'));
        p.appendChild(K.el('small', 'confirm-sub', '解除すると、' + NAMES[provider] + 'ではログインできなくなります。引き継ぎコードや、ほかの連携でログインできます。'));
      }, '解除する').then(function (ok) {
        if (!ok) return;
        api.oauthUnlink(provider).then(function () {
          K.sfx('click');
          K.toast(NAMES[provider] + 'の連携を解除しました', 3200);
          refreshTiles();
        }, K.fail);
      });
    }, K.fail);
  }

  /* ------------------------------------------------------------ coming back --- */
  // This page was reloaded: the browser tab that went to the provider came back, or the phone closed the app meanwhile.
  function resume() {
    var s = saved();
    if (/[?&]oauth=1\b/.test(location.search)) {
      if (window.history && history.replaceState) history.replaceState(null, '', location.pathname);
      if (!s) { K.toast('ログインを終えられませんでした。もう一度お試しください', 4200); return; }
    }
    if (!s) return;
    memory = s;
    var gen = generation;
    BR.launch.whenDone(function () {
      if (!active(s, gen)) return;
      if (s.purpose === 'login') { shown = 'wait'; BR.account.oauthWait({ provider: s.provider, external: s.external }); }
      watch();
    });
  }

  function init() {
    if (!api.online) return;
    $$('#welcome [data-sns]').forEach(function (b) {
      b.addEventListener('click', function () { K.sfx('click'); begin(b.dataset.sns, 'login'); });
    });
    $('#ov-wait-stop').addEventListener('click', function () { K.sfx('click'); clear(); shown = ''; BR.account.close(); });
    $('#ov-wait-again').addEventListener('click', function () {
      var s = current();
      K.sfx('click');
      if (s && s.url) go(s.url);
    });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) ask(); });
    window.addEventListener('focus', ask);
    resume();
  }

  BR.oauth = {
    init: init, begin: begin, clear: clear, paint: paintButtons, profileTiles: profileTiles, tapTile: tapTile,
    // (where the provider's page opens; a test puts its own here)
    go: function (url) { location.href = url; }
  };
})(window.BR = window.BR || {});
