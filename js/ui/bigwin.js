/* A friend's SUPER BIG WIN: a notice at the top of the screen (the server
   tells every friend who is online, server/core/api.js superWin). It shows
   once their reels would have stopped; a tap watches them play. Several at
   once wait their turn. */
(function (BR) {
  'use strict';

  var U = BR.util, K = BR.kit;
  var $ = U.$;
  var el = K.el;
  var REELS = 2600;   // their reels turn about this long
  var SHOW = 5200;

  var queue = [], showing = null, timer = 0;

  function onBigWin(ev) {
    if (!ev || !ev.user) return;
    // watching them already: the reels show it
    var w = BR.watch && BR.watch.target && BR.watch.target();
    if (w && w.id === ev.user.id) return;
    setTimeout(function () {
      queue.push(ev);
      if (queue.length > 3) queue.shift();
      if (!showing) next();
    }, REELS);
  }

  function next() {
    var ev = queue.shift();
    if (!ev) { showing = null; return; }
    var root = $('#bw-note');
    root.textContent = '';
    root.appendChild(K.avatarEl(ev.user, 'sm'));
    var t = el('div', 'bw-text');
    var who = el('div', 'bw-who');
    who.appendChild(el('b', 'uname', ev.user.name));
    who.appendChild(el('span', '', 'さんが'));
    t.appendChild(who);
    t.appendChild(el('div', 'bw-title', 'SUPER BIG WIN!'));
    root.appendChild(t);
    root.appendChild(K.amountEl(ev.win, 'tokens', 'bw-amt'));
    root.appendChild(el('span', 'bw-go', '観戦する ›'));
    showing = ev;
    root.hidden = false;
    root.classList.remove('show');
    void root.offsetWidth;
    root.classList.add('show');
    K.sfx('notify');
    clearTimeout(timer);
    timer = setTimeout(hide, SHOW);
  }
  function hide() {
    var root = $('#bw-note');
    root.classList.remove('show');
    clearTimeout(timer);
    timer = setTimeout(function () { root.hidden = true; next(); }, 320);
  }

  function init() {
    var root = el('button', 'bw-note');
    root.id = 'bw-note';
    root.type = 'button';
    root.hidden = true;
    $('#stage').appendChild(root);
    root.addEventListener('click', function () {
      var ev = showing;
      if (!ev) return;
      K.sfx('click');
      queue = [];
      hide();
      if (BR.watch && BR.watch.start) BR.watch.start({ id: ev.user.id, name: ev.user.name, avatar: ev.user.avatar, online: true });
    });
    if (BR.api.online) BR.live.on('bigwin', onBigWin);
    if (BR.social && BR.social.onMe) BR.social.onMe(function (me) { if (!me) { queue = []; if (showing) hide(); } });
  }

  BR.bigwin = { init: init, show: onBigWin };
})(window.BR = window.BR || {});
