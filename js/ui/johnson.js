/* ジョンソン in the chat (server/core/johnson.js): a friend NPC, always
   online, at the top of the friends and in the message list under マイクソン.
   Every 2 days he sends money to help grow the 金の生る木, and once ever he
   helps when the player is nearly broke; his chat header counts down to his
   next gift and leads to the tree. He answers what is written to him. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;
  var sfx = K.sfx;

  var who = null;      // { id, name, avatar, npc }
  var info = null;     // { next, gifts, given, rescued, offset }
  var timer = 0;

  function is(user) { return !!user && (user.npc === 'johnson' || (!!who && user.id === who.id)); }
  function clock(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    var hms = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x;
    return d ? d + '日 ' + hms : hms;
  }
  function open() { return !!BR.social.peerIs && BR.social.peerIs(who) && BR.social.viewingDm(); }

  function load() {
    return api.johnson().then(function (r) {
      who = r.johnson;
      info = { next: r.next, gifts: r.gifts, given: r.given, rescued: r.rescued, offset: r.now - Date.now() };
      renderHead();
      return r;
    });
  }

  // his chat header: when the next gift comes, and the way to the tree
  function renderHead() {
    if (!BR.social.peerIs || !BR.social.peerIs(who)) return;
    $('#dm-johnson').hidden = false;
    var left = info ? info.next - (Date.now() + info.offset) : 0;
    $('#dm-johnson-next').textContent = !info ? '-' : left > 0 ? 'あと ' + clock(left) : 'まもなく';
    $('#dm-johnson-given').textContent = info && info.given ? '（これまで $' + U.fmt(info.given) + '）' : '';
    clearTimeout(timer);
    if (open()) timer = setTimeout(renderHead, 1000);
  }

  // his chat was opened: a gift that is due comes now
  function opened() { load().catch(function () {}); }

  function init() {
    $('#dm-johnson-tree').addEventListener('click', function () {
      sfx('click');
      if (BR.tree) BR.tree.open();
    });
    if (!api.online) return;
    BR.live.on('hello', function (h) { if (h.johnson) who = h.johnson; });
  }

  BR.johnson = {
    init: init,
    is: is,
    set: function (j) { if (j) who = j; },
    who: function () { return who; },
    renderHead: renderHead,
    opened: opened,
    // his row in the message list before he has written, and at the top of the friends
    placeholder: function () {
      return who ? { user: { id: who.id, name: who.name, avatar: who.avatar, online: true, npc: 'johnson' }, unread: 0, at: 0, friend: true, last: null } : null;
    },
    intro: '2日に一度、木を育てる資金をくれる友達'
  };
})(window.BR = window.BR || {});
