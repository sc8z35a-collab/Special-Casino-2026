# BLOCKBUSTER REELS

スマホの横画面・全画面で遊ぶ 5 リール × 3 段のカジノスロットです。
サーバーに置くと **オンライン版** になり、ユーザー名の登録・ランキング（ボード）・プレイヤー同士のチャット・送金が使えます。
リールのシンボル、スピントークン / $ / コインのアイコン、SPIN ボタン、ボタン類、チップの山、背景とアプリアイコンは提供画像（`tools/art/source/`）を使用しています。
ゲーム本体・サーバーとも外部ライブラリには依存しません（サーバーは Node.js 標準機能と SQLite のみ）。

![screen](icons/icon-192.png)

## 遊び方

| 方法 | 手順 |
| --- | --- |
| オンラインで遊ぶ | 下の「サーバーの導入」で公開した URL を開く。最初にユーザー名を決めるとすぐ遊べます |
| 1 ファイルで遊ぶ | `dist/blockbuster-reels.html` をスマホに送ってブラウザで開くだけ（オフライン・1 人用。ランキングとチャットはありません） |
| 全画面にする | Android: 最初のタップで自動的に全画面＋横向きロック。iPhone: Safari の共有 →「ホーム画面に追加」で起動すると全画面になります |

- 縦持ちでも画面が自動で 90° 回転し、横画面レイアウトのまま遊べます。
- タイトル画面はなく、起動するとすぐスロット画面です（オンライン版は初回だけユーザー名の登録があります）。
- 左上の ← で全画面の ON / OFF を切り替えます（サブ画面では「戻る」）。

## オンライン機能

| 機能 | 内容 |
| --- | --- |
| ユーザー登録 | 初回起動時にユーザー名（2〜12 文字、日本語・英数字・`_` `-`）を決めるだけ。パスワードは不要です |
| 引き継ぎコード | 登録時に 16 文字のコード（`XXXX-XXXX-XXXX-XXXX`）を表示。機種変更やブラウザのデータ削除のあと「引き継ぎコードをお持ちの方」から入力するとアカウントが戻ります。プロフィールから再発行もできます |
| ボード（ランキング） | 右の **無線機ボタン** で開きます。「累計獲得」「今日の獲得」「最大勝利」の 3 種類、上位 100 人と自分の順位。オンライン中のプレイヤーには緑の点が付きます |
| プロフィール | ランキングやロビーで名前をタップ → 成績を表示し、**メッセージ**・**送金**・ブロックができます |
| メッセージ | 1 対 1 のチャット。未読数は無線機ボタンとタブにバッジで表示、届くと画面上部に通知が出ます |
| ロビー | **マイクボタン** で開く全員参加のチャット。SUPER BIG WIN が出ると自動でお知らせが流れます |
| 送金 | スピントークンか $ を相手に送れます（1 回の上限: 1,000 万トークン / 1 億 $）。確認画面のあと即座に相手の残高に反映され、チャットに送金カードが残ります |
| ブロック | ブロックした相手からのメッセージ・送金が届かなくなり、ロビーの発言も非表示になります |

- スピンの結果・残高・購入・送金はすべてサーバーが決定し記録します（ブラウザ側で残高を書き換えることはできません）。
- ランキングはスピンで獲得したトークンだけで集計します（送金で受け取った分は含みません）。
- ゲーム内のトークン・$・コインは遊び用の仮想通貨で、現金や景品とは交換できません。**現金での購入や換金の仕組みは追加しないでください**（賭博に当たるおそれがあります）。

## サーバーの導入（公開手順）

必要な作業は「サーバーを用意して起動コマンドを打つ」だけです。どれか 1 つを選んでください。

### A. 自分のサーバー（VPS）で公開する — おすすめ

月数百円〜の VPS（メモリ 1 GB 程度で十分）と独自ドメインを用意します。HTTPS 証明書は自動で取得・更新されます。

1. ドメインの DNS に **A レコード** を作り、VPS の IP アドレスを設定する
2. VPS に Docker を入れる（Ubuntu の例）
   ```sh
   curl -fsSL https://get.docker.com | sh
   ```
3. このリポジトリを取得して設定ファイルを作る
   ```sh
   git clone https://github.com/sc8z35a-collab/Special-Casino-2026.git
   cd Special-Casino-2026
   cp .env.example .env
   nano .env          # DOMAIN=あなたのドメイン に書き換える
   ```
4. 起動する
   ```sh
   docker compose up -d --build
   ```
5. ブラウザで `https://あなたのドメイン` を開く → 完成です

- 更新するとき: `git pull && docker compose up -d --build`（プレイヤーのデータはそのまま残ります）
- 止めるとき: `docker compose down`（データは `game-data` ボリュームに残ります。`down -v` はデータも消えるので注意）
- ログを見る: `docker compose logs -f app`
- ポート 80 と 443 を開けておいてください（ファイアウォールを使っている場合）。

### B. Render で公開する（サーバー管理なし）

1. [Render](https://render.com) にこの GitHub リポジトリでログイン
2. ダッシュボードの **New → Blueprint** でこのリポジトリを選び **Apply**（`render.yaml` の設定で自動構築されます）
3. 数分後に表示される `https://blockbuster-reels-xxxx.onrender.com` が公開 URL です

プレイヤーのデータを保存するディスクを使うため、有料の Starter プラン以上が必要です。独自ドメインは Render の Settings → Custom Domains で追加できます。

### C. Node.js だけで動かす

Node.js 22.13 以上があればそのまま起動できます（テストや LAN 内で遊ぶとき向け）。

```sh
cd server
npm start            # http://localhost:8080
```

インターネットに公開する場合は nginx / Caddy などで HTTPS 化し、環境変数 `TRUST_PROXY=1` を付けて起動してください。

### 設定（環境変数）

`.env`（A の場合）や Render の Environment に書きます。どれも省略できます。

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `DOMAIN` | — | 公開するドメイン（A の構成で必須） |
| `REGISTRATION` | `open` | `closed` にすると新規登録を止める（既存プレイヤーは遊べます） |
| `START_TOKENS` / `START_DOLLARS` / `START_COINS` | `0` / `5008159` / `74` | 新規プレイヤーの初期残高 |
| `MAX_TRANSFER_TOKENS` / `MAX_TRANSFER_DOLLARS` | `10000000` / `100000000` | 1 回の送金上限 |
| `REGISTRATIONS_PER_IP` | `30` | 同じ IP から 24 時間に作れるアカウント数（0 で無制限） |
| `REGISTER_PER_MINUTE` | `10` | 同じ IP からの 1 分あたりの登録試行回数 |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | 待ち受けるポート / アドレス |
| `DATA_DIR` | `data/`（Docker では `/data`） | データベースの保存先 |
| `TRUST_PROXY` | オフ | リバースプロキシの後ろで動かすとき `1`（プレイヤーの IP を正しく判定） |
| `CLIENT_IP_HEADER` | — | Cloudflare を前に置くときは `cf-connecting-ip` |
| `LOG_REQUESTS` | オン | API へのアクセスを 1 行ずつ記録（`0` でオフ） |

### 管理コマンド

サーバーを動かしたまま実行できます（A の構成の例。C の場合は `node server/admin.js …`）。

```sh
docker compose exec -u node app node server/admin.js stats            # 全体の数字
docker compose exec -u node app node server/admin.js users [検索語]   # プレイヤー一覧
docker compose exec -u node app node server/admin.js show たけし      # 1 人の詳細
docker compose exec -u node app node server/admin.js ban たけし       # 利用停止（unban で解除）
docker compose exec -u node app node server/admin.js grant たけし tokens 10000   # 残高を増減（マイナスで減らす）
docker compose exec -u node app node server/admin.js rename たけし たけし2      # 名前の変更
docker compose exec -u node app node server/admin.js recovery たけし  # 引き継ぎコードを再発行（本人確認のうえで）
docker compose exec -u node app node server/admin.js logout たけし    # 全端末からログアウトさせる
docker compose exec -u node app node server/admin.js messages         # ロビーの最新メッセージ（ユーザー名を付けるとその人の発言）
docker compose exec -u node app node server/admin.js redact 123       # メッセージを削除済みにする
```

ユーザーは名前か ID（`12` / `#12`）で指定します。

### バックアップ

```sh
docker compose exec -u node app node server/admin.js backup /data/backup.db
docker compose cp app:/data/backup.db ./backup-$(date +%F).db
```

戻すとき（`backup-2026-10-17.db` を戻す例）:

```sh
docker compose cp ./backup-2026-10-17.db app:/data/restore.db
docker compose stop app
docker compose run --rm --entrypoint sh app -c 'cd /data && rm -f blockbuster.db-wal blockbuster.db-shm && mv restore.db blockbuster.db && chown node:node blockbuster.db'
docker compose start app
```

### 安全のための仕組み

- 乱数はサーバーの暗号論的乱数（`crypto`）。配当計算はブラウザと同じルールファイルをサーバーで実行しています。
- ログイン情報はランダムなトークン（ハッシュ化して保存）。引き継ぎコードもハッシュ化して保存し、元のコードはサーバーに残りません。
- 登録・ログイン・スピン・チャット・送金にそれぞれ回数制限、同じ IP からの大量登録の制限、送金上限があります。
- 運営になりすます名前（admin、運営、公式 など）は登録できません。チャットの文字はすべて文字列として表示し、HTML として解釈しません。
- 残高の変更はすべてデータベースのトランザクション内で行い、二重送金や残高のマイナスは起こりません。
- 静的ファイルは許可したもの（ゲームの画面・画像・フォント）だけを配信し、`server/` や `tools/` は外から見えません。

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
サウンドは WebAudio で生成しており、初期状態はミュート（参考画面どおり）。左上のスピーカーで切り替えます。

## 構成

```
index.html                 画面の骨組み（スロット / トークン / ルール / ボード / 各ダイアログ）
css/style.css              2000×924 の基準座標で組んだレイアウト
css/social.css             ボード・チャット・プロフィール・送金・登録画面
js/main.js                 起動・横画面全画面スケーリング・ゲーム進行
js/game/config.js          シンボル確率・配当表・ベット段階（サーバーも同じファイルを使用）
js/game/engine.js          抽選と中央ライン判定
js/game/bank.js            スピン・購入・無料トークンの精算（オフラインはブラウザ、オンラインはサーバー）
js/net/api.js, live.js     サーバー API とリアルタイム通知（Server-Sent Events）
js/ui/screens.js           トークン購入・交換、ルール / 組み合わせ画面
js/ui/social.js            登録・ランキング・メッセージ・ロビー・プロフィール・送金
js/render/reels.js         リール描画（加速・モーションブラー・停止バウンド・リーチ・当たり枠）
js/render/fx.js            WIN / BIG WIN / SUPER BIG WIN 演出
js/audio/sfx.js            効果音シンセサイザー
js/art/*.js                SVG アイコン、画像ファイルの一覧
img/symbols/, img/ui/      提供画像から作ったシンボル・UI 画像
server/                    オンライン版サーバー（server.js 起動 / api.js API / db.js SQLite / admin.js 管理コマンド）
Dockerfile, docker-compose.yml, deploy/, render.yaml   公開用の設定
tools/                     画像 / フォント / 1 ファイル版の生成スクリプト
```

### テスト

```sh
cd server && npm test     # API・送金・チャット・ランキング・管理コマンドなど
```

### 再生成

```sh
pip install numpy pillow scipy opencv-python-headless fonttools brotli
python3 tools/art/symbol_images.py  # シンボル画像 → img/symbols/*.webp
python3 tools/art/ui_images.py      # アイコン・SPIN・ボタン・チップの山・背景 → img/ui/*.webp
python3 tools/art/icons.py          # アプリアイコン（7）→ icons/*.png
python3 tools/fonts/subset.py       # 使用文字だけのフォント → fonts/, css/fonts.css
python3 tools/build_single.py       # 1 ファイル版 → dist/blockbuster-reels.html
```

フォントは SIL Open Font License のフォント（Noto Sans JP / Exo 2 / Montserrat）を使用しています（`fonts/LICENSE-OFL.txt`）。
