/* Ice Smoker公式 in the chat (server/core/official.js): the operators'
   account, always online and always at the top of the messages. Players can
   write to it, and its head has 報告 (a bug, an error) and 意見案 (an idea),
   both of any length (js/ui/safety.js). The operators answer through it from
   the operator site; it cannot be called, blocked or reported. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit, api = BR.api;
  var $ = U.$;

  var who = null;      // { id, name, avatar, npc: 'official' }

  function is(user) { return !!user && (user.npc === 'official' || (!!who && user.id === who.id)); }

  function init() {
    $('#dm-official-bug').addEventListener('click', function () { BR.safety.toBot('bug'); });
    $('#dm-official-idea').addEventListener('click', function () { BR.safety.toBot('idea'); });
    if (!api.online) return;
    BR.live.on('hello', function (h) { if (h.official) who = h.official; });
  }

  BR.official = {
    init: init,
    is: is,
    set: function (o) { if (o) who = o; },
    who: function () { return who; },
    // its row in the message list before anything was written
    placeholder: function () {
      return who ? { user: { id: who.id, name: who.name, avatar: who.avatar, online: true, npc: 'official' }, unread: 0, at: 0, friend: false, last: null } : null;
    },
    intro: '運営からのお知らせ・お問い合わせはこちら。不具合の報告や意見案も送れます'
  };
})(window.BR = window.BR || {});
