# Two state Casino RP — BLOCKBUSTER REELS

オンラインのカジノゲームと、その運営サイト・Cloudflare Workers版／Node版サーバーです。

```sh
npm ci
npm run dev     # Cloudflare Workersのローカル起動
npm start       # Nodeサーバーの起動
npm test        # server/testの検証
```

## ドキュメント

- [Two state Casino RP — BLOCKBUSTER REELS](docs/handbook/01.md)
- [遊び方](docs/handbook/02.md)
- [オンライン機能](docs/handbook/03.md)
- [5時間クエストの追加段階](docs/handbook/04.md)
- [デイリー送金クエストの追加段階](docs/handbook/05.md)
- [レベルアップとリセットチケット](docs/handbook/06.md)
- [VIPのカート購入とチケット](docs/handbook/07.md)
- [クエストのPRO・ULTRA](docs/handbook/08.md)
- [DEV13：受け取り期限・VIP拡張](docs/handbook/09.md)
- [無料サーバーで公開する（Cloudflare）](docs/handbook/10.md)
- [契約中のプラン：Workers Paid（月 5 ドル ≒ 750 円、2026/10/20 から）](docs/handbook/11.md)
- [無料プランの目安](docs/handbook/12.md)
- [保管庫を R2 につなぐ（50GB）](docs/handbook/13.md)
- [設定（任意）](docs/handbook/14.md)
- [Discord に通知する](docs/handbook/15.md)
- [LINE に通知する（LINE ボット）](docs/handbook/16.md)
- [パスキー認証を始める（Discord ボット）](docs/handbook/17.md)
- [Google / Discord ログインを始める](docs/handbook/18.md)
- [運営の権限を守る仕組み（自動で働くもの）](docs/handbook/19.md)
- [開発者支援（課金）を始める](docs/handbook/20.md)
- [サーバー運営サイト](docs/handbook/21.md)
- [運営の画面を見る機能（状態転送方式）](docs/handbook/22.md)
- [管理コマンド](docs/handbook/23.md)
- [アプリとして配布する（無料）](docs/handbook/24.md)
- [Android アプリ（APK）を作る（最初に 1 回だけ）](docs/handbook/25.md)
- [アップデートの仕組み](docs/handbook/26.md)
- [自分のサーバー（VPS / Docker）で公開する場合](docs/handbook/27.md)
- [ルール（ゲーム内「ルール」タブと同じ）](docs/handbook/28.md)
- [配当表（ベットに対する倍率）](docs/handbook/29.md)
- [当たり演出](docs/handbook/30.md)
- [そのほかの演出（js/render/juice.js・slotfx.js・css/juice.css）](docs/handbook/31.md)
- [構成](docs/handbook/32.md)
- [テスト](docs/handbook/33.md)
- [再生成](docs/handbook/34.md)
- [DEV13：追加クエストと収益の回収待ち](docs/handbook/35.md)
- [金の生る木の3D対応（指定素材の一部は未取り込み）](docs/handbook/36.md)
- [投資（RIRU STUDIO・Ice Smoker）](docs/handbook/37.md)
- [功績（メダル）](docs/handbook/38.md)
- [企業（決算・商品・ビジネス友好度）](docs/handbook/39.md)

- [開発のお知らせ](README_DEV_NEWS.md)
- [LINE配信・ガチャ](README_LINE_FEED.md)
- [改善項目の実装記録](docs/implementation-progress.md)
- [功績：非公開の資料（配信されない）](docs/medals-hidden.md)
- [経済システムの計画（企業10社は実装済み・残りは計画）](docs/economy-plan.md)
- [NPCの街の計画 第2版（20万人・全市民が社員になれる、未実装）](docs/npc-plan.md)

説明の原稿は `docs/handbook/` と `README_DEV_NEWS.md` で管理します。運営サイトのDEV UNIT用ファイルは `node tools/sync_devunit_readme.cjs` で生成します。`--check` は生成物との不一致を検出します。

## 保守・最適化の記録

- [保守・軽量化の全対応表](docs/optimization-progress-2026-10.md)
- [認証・配当・保存期間など12項目の詳細](docs/maintenance-progress.md)
