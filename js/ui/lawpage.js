/* law.html: 特定商取引法に基づく表記 for anyone (no login needed), from
   GET /api/pay/seller (js/ui/law.js builds the rows; text only). */
(function (BR) {
  'use strict';

  var dl = document.getElementById('law-rows'), note = document.getElementById('law-note');
  function say(text) { note.hidden = false; note.textContent = text; }

  fetch('/api/pay/seller', { cache: 'no-store', credentials: 'omit' }).then(function (r) {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }).then(function (d) {
    BR.lawFill(dl, d);
    if (d.test) say('現在はテスト中です（実際のお金は動きません）。');
    else if (!d.on) say('開発者支援の販売は準備中です。');
  }).catch(function () {
    dl.textContent = '';
    say('読み込めませんでした。時間をおいてもう一度お試しください。');
  });
})(window.BR = window.BR || {});
