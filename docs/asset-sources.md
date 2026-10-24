# 素材原版と生成物

`dist/` と `tools/{3d,video,sound,art}/source/` は追跡しません。
配信用の `img/`、`icons/`、`sounds/`、`video/` は引き続き追跡します。
通常のゲーム起動・サーバーテストに原版は不要です。
`ops/assets/readme-dev.txt` も運営サイトが読む配信ファイルとして追跡します。

1ファイル版が必要な場合は、チェックアウト後に
`python3 tools/build_single.py` で `dist/blockbuster-reels.html` を生成してください。
この処理は追跡済みの配信素材を読み、原版素材を必要としません。

原版は別途保管し、素材を再生成するときだけ元の場所・名前で配置してください。
新規チェックアウトには原版がないため、次の手順は原版の復元なしでは実行できません。

| 原版の配置先 | 使用する生成スクリプト |
| --- | --- |
| `tools/video/source/{studio-source,title-source}.mp4` | `sh tools/video/encode_launch.sh`、`sh tools/video/encode_title.sh`（ffmpeg） |
| `tools/sound/source/*.mp3` | `python3 tools/sound/sounds.py`（ffmpeg・NumPy） |
| `tools/art/source/` の既存サブディレクトリとファイル名 | `tools/art/symbol_images.py`、`social_images.py`、`ui_images.py`、`icons.py`（Pillow等、既存手順の環境） |

`tools/art/art_3d.py` は3Dレンダリング結果から `tools/art/source/ui/` の一部を
再生成しますが、提供された原版全体の代わりにはなりません。
引数で素材ディレクトリを指定する `tools/art/import_*.py` は従来どおり外部素材を指定できます。

配信ファイルを変更した場合は従来どおり `node tools/stamp.mjs` を実行します。
READMEを変更した場合は `node tools/sync_devunit_readme.cjs` で運営サイト用コピーを同期します。
