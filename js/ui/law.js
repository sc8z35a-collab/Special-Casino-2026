/* 特定商取引法に基づく表記: its rows from what the server says (GET
   /api/pay/seller: the seller from the host's settings, the plans and the
   ways to pay), for the purchase screen's dialog (js/ui/support.js) and the
   page anyone can open without logging in (law.html, js/ui/lawpage.js). */
(function (BR) {
  'use strict';

  var ASK = 'ご請求があれば遅滞なく開示いたします（ゲーム内の「Ice Smoker公式」へのメッセージでご連絡ください）';
  function yen(n) { return Number(n).toLocaleString('en-US') + '円'; }

  // [[label, text], …] (text only: shown with textContent)
  BR.lawRows = function (d) {
    var s = d.seller || {};
    var plans = (d.plans || []).map(function (p) {
      return p.name + '：' + yen(p.price) + '（ロイヤルコイン' + p.coins + '枚' + (p.bonus ? '＋感謝料' + p.bonus + '枚' : '') + '）';
    });
    var methods = (d.methods || []).map(function (m) { return m.name + '（合計' + yen(m.min) + 'から）'; });
    return [
      ['販売事業者', s.name || ASK],
      ['運営統括責任者', s.head || s.name || ASK],
      ['所在地', s.address || ASK],
      ['電話番号', s.phone || ASK],
      ['メールアドレス', s.email || ASK],
      ['お問い合わせ', (s.hours ? '受付時間：' + s.hours + '。' : '') + 'ゲーム内のメッセージ「Ice Smoker公式」からも受け付けています'],
      ['販売価格', plans.join(' / ') + '（いずれも1口あたり・税込。1回に1〜' + (d.maxQty || 100) + '口）'],
      ['商品代金以外の必要料金', 'ありません（インターネットの通信料はお客様のご負担となります）'],
      ['お支払い方法', methods.length ? methods.join('、') : '準備中です'],
      ['お支払い時期', 'PayPay：ご注文時にお支払いいただきます。コンビニ決済：ご注文から' + (d.konbiniDays || 3) + '日以内に、店頭でお支払いください'],
      ['商品の引渡し時期', 'お支払いが確認できしだい、すぐにゲーム内のロイヤルコインとしてお届けします'],
      ['返品・キャンセル', 'デジタルコンテンツの性質上、購入後のキャンセル・返品・返金はお受けできません（法令に基づく場合を除きます）。ロイヤルコインが届かないなどの不具合は、お問い合わせください'],
      ['ロイヤルコインについて', 'ゲーム内でVIPを有効にするためのコインです（4枚で1日）。賭ける・トークンや $ に交換する・ほかのプレイヤーに送る・換金することはできません'],
      ['いただいたお金について', '決済会社 Stripe を通じて開発者の銀行口座に直接送金され、Two state の開発費にのみ使用します'],
      ['購入の条件', '18歳以上の方に限ります。24時間で' + yen(d.dailyMax || 10000) + 'まで（使いすぎ防止のため）'],
      ['動作環境', 'Chrome・Safari などの最新のブラウザ、または Android アプリ（インターネット接続が必要です）']
    ];
  };

  // fills a <dl> with the rows
  BR.lawFill = function (dl, d) {
    dl.textContent = '';
    BR.lawRows(d).forEach(function (r) {
      var dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = r[0];
      dd.textContent = r[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });
  };
})(window.BR = window.BR || {});
