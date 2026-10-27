/* The lock beside the bell: shown only when this page has checked, with the server, that the connection is secure — and not otherwise.
   It opens the secure channel (js/net/secchannel.js, server/core/seccomm.js) and asks the server how it saw this very connection.
   Everything must hold, or the lock is not shown:
     - the page is https, in a secure context, and not framed by another site;
     - the server proved who it is (a signature the page checked, by the identity it kept the first time) and holds the same keys;
     - the address the server saw is this page's own (no copy of the site, no proxy in front that rewrites it);
     - the server itself saw the connection encrypted (TLS), and says so again in its sealed answer, with the same identity;
     - the two clocks agree.
   Nothing here is trusted because it is shown: a page that is not the site's own, or a connection that is taken apart on its way, fails
   at least one of these, and then there is no lock. It looks again every few minutes and when the page comes back into view. */
var OpsSecure = (function () {
  'use strict';
  var chan = null, timer = 0, initial = 0, stamp = 0, token = 0, busy = false, enabled = false;
  var EVERY = 4 * 60000;

  function show(text) { if (window.OpsDesktop && OpsDesktop.secure) OpsDesktop.secure(text); }
  function io() { return window.OpsExt ? OpsExt.io() : null; }

  function look() {
    if (!enabled || document.hidden || busy) return;
    var tools = io(), mine = token;
    if (!tools || !tools.request || !window.BR || !BR.secChannel || !BR.secChannel.available) { show(''); return; }
    busy = true;
    if (!chan) chan = BR.secChannel.create({ request: tools.request });
    var channel = chan;
    channel.open().then(function (info) {
      if (mine !== token) return;
      // (the lock is shown on a channel that checked out in every way; the server then says, sealed, what it saw)
      if (!info.secure) throw new Error('not secure: ' + info.problems.join(','));
      return channel.call('GET', '/api/sec/posture').then(function (p) {
        if (mine !== token) return;
        if (!p || !p.transport || !p.transport.tls || !p.identity || p.identity.fp !== info.fp) throw new Error('the server does not say the same');
        stamp = Date.now();
        show('セキュア通信：確認済み（' + p.transport.tls + '・サーバーの身元 ' + info.fp + '）');
      });
    }).catch(function () {
      // (any doubt: no lock; and the next look opens a new channel rather than trusting this one)
      if (mine !== token) return;
      channel.drop(); show('');
    }).then(function () { if (mine === token) busy = false; });
  }
  function schedule() { clearInterval(timer); timer = setInterval(function () { if (!document.hidden) look(); }, EVERY); }

  document.addEventListener('visibilitychange', function () { if (!document.hidden && enabled && Date.now() - stamp > 60000) look(); });
  window.addEventListener('online', function () { if (enabled) look(); });
  window.addEventListener('offline', function () { show(''); });

  return {
    // signed in (true) or out (false)
    session: function (signedIn) {
      token++;
      enabled = signedIn;
      clearInterval(timer); clearTimeout(initial); initial = 0; show('');
      if (chan) { chan.drop(); chan = null; }
      busy = false; stamp = 0;
      if (signedIn) { initial = setTimeout(function () { initial = 0; look(); }, 600); schedule(); }
    },
    look: look
  };
})();
