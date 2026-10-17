# Two state Casino RP — BLOCKBUSTER REELS

スマホの横画面・全画面で遊ぶ 5 リール × 3 段のカジノスロットです。
サーバーに置くと **オンライン版** になり、ユーザー登録・ランキング・フレンド・チャット・送金・車・アイコン・
マイクでの会話（稼ぎに招待）・フレンドの画面を見る機能が使えます。
**サーバーは Cloudflare の無料プランで動きます**（下の「無料サーバーで公開する」）。

リールのシンボル、各アイコン、SPIN ボタン、背景、アプリアイコン、プレイヤーアイコン、鎖、Sale バッジ、車の画像、
起動画面の動画は提供素材（`tools/art/source/`、`tools/video/source/`）、
クリック・SPIN・リール回転・当たりの効果音は提供された録音（`tools/sound/source/`）を使用しています。

## 遊び方

| 方法 | 手順 |
| --- | --- |
| オンラインで遊ぶ | 公開した URL を開く → 起動画面の **スタート** |
| 1 ファイルで遊ぶ | `dist/blockbuster-reels.html` をスマホに送ってブラウザで開くだけ（オフライン・1 人用。フレンドやチャットはありません） |
| 全画面にする | Android: 最初のタップで自動的に全画面＋横向きロック。iPhone: Safari の共有 →「ホーム画面に追加」から起動すると全画面になります |

- 起動すると「Two state Casino RP」の動画が流れる起動画面になります。動画の **スタート** でスロットへ、**友達** でフレンド画面へ進みます。
  まだ登録していない人は、どちらを押しても最初に登録画面が出ます。
- 縦持ちでも画面が自動で 90° 回転し、横画面レイアウトのまま遊べます。
- スロット画面左上の ← で起動画面に戻ります。
- 効果音は最初からすべて鳴ります。左上のスピーカーボタンは見た目だけ切り替わる飾りです。

## オンライン機能

| 機能 | 内容 |
| --- | --- |
| 登録 | ユーザー名（2〜12 文字）とパスワード（4 文字以上）を決め、アイコンを選ぶだけ。**ほかの人と同じ名前は使えません**（大文字・小文字や全角・半角の違いも同じ名前として扱います）。入力中に「使えます / すでに使われています」がわかります |
| ログイン | 機種変更やデータ削除のあとは **ユーザー名＋パスワード** でログインすると、残高・フレンド・車がそのまま戻ります。パスワードを忘れたときは登録時の **引き継ぎコード**（16 文字）でもログインできます |
| アイコン | 8 種類。スキンヘッド・ヒゲ・くせ毛・金髪・魔女ハットは最初から選べます。**パンプキン（$100,000）・レッド（$350,000）・ヴァンパイア（$800,000）** はレアで、最初の選択画面では鎖でロックされています。あとからプロフィールの「アイコン変更」で購入できます |
| セール | 有料アイコンは常に **10〜40% オフ**（割引率はアイコンごとに毎日 0:00 UTC に変わります）。Sale バッジは持っていない人にだけ表示され、購入すると鎖が外れる演出が入ります |
| フレンド | 最初は 0 人。フレンドタブの検索で **ユーザー名をそのまま入力**（完全一致）→「フレンド申請」。相手が承認すると「〜さんからフレンド承認されました」と通知が届き、会話できるようになります。お互いに申請した場合はその場でフレンドになります |
| メッセージ | フレンドとの 1 対 1 チャット。未読数は無線機ボタンとタブにバッジで表示 |
| 稼ぎに招待 | フレンドをタップ →「稼ぎに招待」で **マイクで会話** しながらそれぞれのスロットを回せます。相手には呼び出しが届き「参加する」で通話開始。通話中は画面上部のバーでマイクのオン / オフ・終了ができます |
| 画面を見る | フレンドのスロット画面をリアルタイムで観戦（リールの回転・当たり演出・残高）。見られている側には「〜さんが観戦中」と表示されます |
| Car Owner | Two state セダンを **$1,200,000** で購入 |
| Garage | 持っている車の一覧。「フレンドにあげる」で車をプレゼント（フレンドのプロフィールの「車をあげる」からも可）。届いた車は相手の Garage に入り、チャットにプレゼントカードが残ります |
| 送金 | フレンドにスピントークンか $ を送れます（1 回の上限: 1,000 万トークン / 1 億 $） |
| ランキング | 「累計獲得」「今日の獲得」「最大勝利」の上位 100 人と自分の順位 |
| ロビー | **マイクボタン** で開く全員参加のチャット。SUPER BIG WIN が出ると自動でお知らせが流れます |
| ブロック | フレンドも解除され、その人からの申請・メッセージ・送金が届かなくなります |

- スピンの結果・残高・購入・送金はすべてサーバーが決定し記録します（ブラウザ側で残高を書き換えることはできません）。
- **お金がリセットされない仕組み**: 残高はサーバーのデータベースだけが持ち、変更はすべてトランザクション内で行います。
  コードを更新（再デプロイ）してもデータはそのまま残ります（自動テストで確認済み）。端末側のログイン情報は 2 か所に保存し、
  両方消えてもユーザー名＋パスワードで元の残高に戻れます。オフライン版の残高も端末内に二重に保存し、ゲーム内に残高を初期化する処理はありません。
- ゲーム内のトークン・$・コイン・車・アイコンは遊び用の仮想アイテムで、現金や景品とは交換できません。
  **現金での購入や換金の仕組みは追加しないでください**（賭博に当たるおそれがあります）。

## 無料サーバーで公開する（Cloudflare）

ゲーム画面・API・データベースがすべて Cloudflare の無料プランに収まります。
必要なのは Cloudflare の無料アカウントと、この GitHub リポジトリだけです。

1. [Cloudflare に無料登録](https://dash.cloudflare.com/sign-up) してログイン
2. 左のメニュー **Workers & Pages** →「**作成（Create）**」→「**リポジトリをインポート（Import a repository）**」
3. GitHub と連携して `Special-Casino-2026` を選ぶ
4. 設定画面ではプロジェクト名を **`blockbuster-reels`** のままにし、ビルドコマンドは空欄、デプロイコマンドは `npx wrangler deploy`（初期値）のまま
   - 公開に使うブランチ（本番ブランチ）は、この作業をした `claude/epic-gates-fmo9j7` を選ぶか、先に GitHub で main に取り込んで（マージして）ください
5. 「**デプロイ**」を押す → 1〜2 分で `https://blockbuster-reels.<あなたのアカウント名>.workers.dev` が公開 URL になります

これで完成です。以後は GitHub のブランチを更新するたびに自動で再デプロイされ、**プレイヤーのデータはそのまま残ります**。

> 絶対に変えないでください: `wrangler.jsonc` の `"name"`（`blockbuster-reels`）と `"migrations"` の行。
> 全プレイヤーのアカウントとお金はこの名前に結び付いたデータベース（Durable Object）に保存されています。

- パソコンからコマンドで公開する場合: Node.js を入れて `npm install` → `npx wrangler login` → `npm run deploy`
- 自分のパソコンで試す場合: `npm install` → `npm run dev` → http://localhost:8787
- 独自ドメインを使う場合: Cloudflare の Worker の「設定 → ドメインとルート」から追加できます

### 無料プランの目安

| 項目 | 無料枠（1 日） | このゲームでの目安 |
| --- | --- | --- |
| リクエスト | 10 万回 | スピン 1 回 ≒ 1 回。1 日数万スピンまで |
| データベースの書き込み | 10 万行 | スピン 1 回 ≒ 1 行 |
| 保存容量 | 5 GB | 数十万人分でも余裕があります |

上限を超えると、その日（日本時間 9:00 まで）は API がエラーになりますが、**データは消えません**。
画面・画像・動画の配信は無料で無制限です。

### 設定（任意）

Cloudflare の Worker の「設定 → 変数とシークレット」で追加できます（どれも省略可）。

| 変数 | 内容 |
| --- | --- |
| `ADMIN_TOKEN`（シークレット） | 管理コマンド用の合言葉（24 文字以上）。設定すると下の管理コマンドが使えます |
| `CF_TURN_KEY_ID` / `CF_TURN_API_TOKEN`（シークレット） | 通話がつながりにくい回線向けの中継サーバー。Cloudflare の **Realtime → TURN** で作成したキー ID と API トークン（毎月 1,000 GB まで無料） |
| `REGISTRATION` | `closed` で新規登録を止める（既存プレイヤーは遊べます） |
| `START_TOKENS` / `START_DOLLARS` / `START_COINS` | 新規プレイヤーの初期残高（既定 0 / 5,008,159 / 74） |
| `MAX_TRANSFER_TOKENS` / `MAX_TRANSFER_DOLLARS` | 1 回の送金上限 |

通話（稼ぎに招待）は端末どうしを直接つなぎます。ほとんどの Wi-Fi・モバイル回線はそのままつながりますが、
一部の回線でつながらない場合は上の TURN を設定してください。マイクの使用には HTTPS が必要です（workers.dev は HTTPS です）。

### 管理コマンド

`ADMIN_TOKEN` を設定したあと、Node.js の入ったパソコンから実行します。

```sh
export ADMIN_TOKEN=設定した合言葉
URL=https://blockbuster-reels.あなたのアカウント名.workers.dev
node server/node/admin-cli.js --remote $URL stats                 # 全体の数字
node server/node/admin-cli.js --remote $URL users [検索語]        # プレイヤー一覧
node server/node/admin-cli.js --remote $URL show たけし           # 1 人の詳細
node server/node/admin-cli.js --remote $URL ban たけし            # 利用停止（unban で解除）
node server/node/admin-cli.js --remote $URL grant たけし dollars 100000   # 残高を増減（マイナスで減らす）
node server/node/admin-cli.js --remote $URL rename たけし たけし2  # 名前の変更
node server/node/admin-cli.js --remote $URL recovery たけし       # 引き継ぎコードを再発行（本人確認のうえで）
node server/node/admin-cli.js --remote $URL backup backup.json    # 全データをファイルに保存
```

- もしもの時の巻き戻し: Cloudflare はデータベースの過去 30 日分を保持しています。
  `node server/node/admin-cli.js --remote $URL restore-time 2026-10-17T12:00:00Z` でその時点の状態に戻せます（通常は不要です）。

## 自分のサーバー（VPS / Docker）で公開する場合

無料の Cloudflare 版のほかに、Node.js の同じサーバーを自分で動かすこともできます（中身の API は共通です）。

```sh
git clone https://github.com/sc8z35a-collab/Special-Casino-2026.git
cd Special-Casino-2026
cp .env.example .env && nano .env      # DOMAIN=あなたのドメイン
docker compose up -d --build           # HTTPS 証明書は自動取得
```

- Node.js 22.13 以上だけで動かす場合: `npm start`（http://localhost:8080）
- 管理コマンド: `docker compose exec -u node app node server/node/admin-cli.js stats` など（`--remote` なしでローカルのデータベースを操作）
- 更新: `git pull && docker compose up -d --build`（データは `game-data` ボリュームに残ります。`down -v` はデータも消えるので使わないでください）

## ルール（ゲーム内「ルール」タブと同じ）

- 「SPIN」をタップしてゲームを開始します。
- 選択されたベットが各スピンから引かれます。賞金は中央ラインとベット、マッチしたシンボルの種類と数で決まります（並び順は問いません）。
- 複数の当たりの組み合わせがライン上で止まった場合、報酬は加算されます。
- スピン中にゲームを終了すると、ベットは放棄されます。
- 1 日の購入上限: 10,000,000 スピントークン（毎日 00:00 UTC にリセット）。
- 1 スピントークン = 10 $。「トークンを入手」で $ と交換、「トークンを交換」で $ に戻せます。毎日 1 回、無料トークン（1,000）を受け取れます。

### 配当表（ベットに対する倍率）

| シンボル | 確率 | 1/5 | 2/5 | 3/5 | 4/5 | 5/5 |
| --- | --- | --- | --- | --- | --- | --- |
| リボルバー | 40% | | | | x1.5 | x3 |
| 金塊 | 25% | | | x2 | x4 | x10 |
| ダイヤ | 20% | | | x2.5 | x5 | x20 |
| スター | 8% | | x3 | x10 | x20 | x100 |
| BAR | 4.5% | | x4 | x15 | x50 | x500 |
| 7 | 2% | | x10 | x20 | x100 | x1000 |
| 女神像 | 0.5% | x2 | x10 | x100 | x1000 | x10000 |

この設定での理論還元率（RTP）は約 92.8%、当選確率は約 34% です（各リール位置は上表の確率で独立に抽選）。

### 当たり演出

| 演出 | 条件 | 内容 |
| --- | --- | --- |
| WIN | 合計 5 倍未満 | 当たりラインを残して上下に「WIN」と獲得額、チップが弾ける |
| BIG WIN | 5 倍以上 15 倍未満 | 画面全体の光線・3D タイトル・チップの噴水・カウントアップ |
| SUPER BIG WIN | 15 倍以上 | BIG WIN からカウント途中で「SUPER」に昇格、花火とチップの雨 |

演出中に画面をタップするとカウントを飛ばせます。あと 1 つで 20 倍以上になる場面では残りのリールが減速して光る「リーチ演出」が入ります。

## 構成

```
index.html                 画面の骨組み（起動画面 / スロット / トークン / ルール / ボード / ダイアログ / 登録）
css/style.css              2000×924 の基準座標で組んだレイアウト
css/social.css, online.css ボード・チャット・プロフィール / 起動画面・フレンド・アイコン・車・通話・観戦
js/main.js                 起動・横画面全画面スケーリング・ゲーム進行・観戦表示
js/game/config.js          シンボル確率・配当表・ベット・アイコン・車の価格（サーバーも同じファイルを使用）
js/game/sale.js            アイコンの日替わりセール（サーバーと共通）
js/game/engine.js, bank.js 抽選と精算（オフラインはブラウザ、オンラインはサーバー）
js/net/                    API・リアルタイム通知（WebSocket / SSE）・音声通話（WebRTC）
js/ui/                     起動画面・登録・ボード・フレンド・アイコン・車・観戦
js/render/, js/audio/      リール描画・当たり演出・効果音
server/core/               サーバー本体（API・データベース・認証・管理コマンド）。どちらのサーバーでも共通
server/cloudflare/         無料版サーバー（Cloudflare Worker + Durable Object）
server/node/               自前サーバー版（Node.js）
wrangler.jsonc, .assetsignore, _headers   Cloudflare の設定（公開するファイルはゲーム画面の分だけ）
Dockerfile, docker-compose.yml, deploy/   自前サーバー用の設定
tools/                     画像 / 動画 / 効果音 / フォント / 1 ファイル版の生成スクリプト
```

### テスト

```sh
npm install
npm test          # サーバーの自動テスト（登録・ログイン・フレンド・送金・アイコン・車・通話・観戦・データの保持）
npm run dev       # Cloudflare 版をローカルで起動して確認
```

### 再生成

```sh
pip install numpy pillow scipy opencv-python-headless fonttools brotli
python3 tools/art/symbol_images.py  # シンボル画像 → img/symbols/*.webp
python3 tools/art/ui_images.py      # アイコン・SPIN・ボタン・チップの山・背景 → img/ui/*.webp
python3 tools/art/social_images.py  # プレイヤーアイコン・鎖・Sale バッジ・車 → img/avatars, img/ui, img/cars
python3 tools/art/icons.py          # アプリアイコン（7）→ icons/*.png
sh tools/video/encode_title.sh      # 起動画面の動画（ffmpeg を使用）→ video/
python3 tools/sound/sounds.py       # 効果音（ffmpeg を使用）→ sounds/
python3 tools/fonts/subset.py       # 使用文字だけのフォント → fonts/, css/fonts.css
python3 tools/build_single.py       # 1 ファイル版 → dist/blockbuster-reels.html
```

フォントは SIL Open Font License のフォント（Noto Sans JP / Exo 2 / Montserrat）を使用しています（`fonts/LICENSE-OFL.txt`）。
