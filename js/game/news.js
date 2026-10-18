/* Dev News: what each update brought, newest first. The newest entry's id is
   the game's release number (BR.RELEASE): a player whose game is older is
   asked to update, and everyone who updates to a new release once gets
   BR.CONFIG.updateBonus $ (server/core/api.js). Add an entry with the next id
   for every update meant to reach the players. */
(function (BR) {
  'use strict';

  BR.NEWS = [
    {
      id: 1,
      date: '2026-10-18',
      title: 'クエスト・バイト・プレイヤーレベル登場！',
      items: [
        'クエストを追加しました。ホーム画面のクエストボタンから、5時間・デイリー・週間・月極・特別の5種類に挑戦できます',
        'クエストは報酬の大きさで色分けされ、達成すると自動で報酬が入ります（月極・特別はスピントークン）',
        'バイトを追加しました。「近所のガレージの壁を殴るバイト」で1時間 $20,000 稼げます',
        'プレイヤーレベルを導入しました。スピンとクエスト達成で経験値がたまります',
        '投資は近日公開予定です',
        'この Dev News で、今後のアップデート内容をお知らせします',
        'アップデートしてくれた方全員に感謝料 $250,000 をプレゼント',
        'ピーターの貸し出しは累計1100万円までと明記し、貸したときに「○○万円貸しました」と表示するようにしました',
        'アプリのアイコンを大きな7に変更し、メニューとロビーのボタンを新しい絵にしました',
        'ピーターのチャットが最初に開かない不具合と、アイコン選択画面の表示を直しました',
        '文字や数字の入力中に画面が拡大したり動いたりしないようにしました',
        'iPhone では Android 用アプリではなく「ホーム画面に追加」の手順を表示するようにしました'
      ]
    }
  ];
  BR.RELEASE = BR.NEWS[0].id;
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
