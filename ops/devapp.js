/* DEV APP: the developer's own folder of apps (the memo pad, the study app, the security app, Adam). Only the outside is here now: the
   icons and their names; they open to "coming soon". What there is, is told by the server (GET /api/ops/devapp answers the developer
   alone; everyone else gets what a route that does not exist gets), so a page that is not the developer's has nothing to show even
   if this file is run by hand. Text is only ever put in with textContent. */
var OpsDevApp = (function () {
  'use strict';
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  return {
    show: function (view, request, toast) {
      view.replaceChildren();
      view.appendChild(el('div', 'bar', '')).appendChild(el('h2', '', 'DEV APP'));
      var box = el('div', 'devapp-grid'); box.setAttribute('role', 'list');
      view.appendChild(el('p', 'muted', '開発者だけのアプリです。いまは外側だけで、中身はこれから作ります。'));
      view.appendChild(box);
      request('GET', '/api/ops/devapp').then(function (r) {
        (r.apps || []).forEach(function (a) {
          var b = el('button', 'devapp-item'); b.type = 'button'; b.setAttribute('role', 'listitem');
          var img = el('img'); img.src = 'assets/' + String(a.icon).replace(/[^\w-]/g, '') + '.webp'; img.alt = ''; img.width = 96; img.height = 96; img.draggable = false;
          b.appendChild(img); b.appendChild(el('span', 'devapp-name', a.name)); b.appendChild(el('small', 'muted', '準備中'));
          b.addEventListener('click', function () { toast('「' + a.name + '」は準備中です'); });
          box.appendChild(b);
        });
      }, function () { box.replaceChildren(); view.appendChild(el('p', 'muted', '表示できません')); });
    }
  };
})();
