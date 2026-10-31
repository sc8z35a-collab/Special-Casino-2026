# CAR SHOP and supplied effects artwork

SHOP now has SHOP / CAR SHOP / 所有 tabs. CAR SHOP uses fixed unit prices:

| Item | Price ($) | Image |
| --- | ---: | --- |
| 車修理キット | 450,000 | repair-kit.webp |
| 車オイル中型 | 550,000 | car-oil-medium.webp |
| ガソリン満杯 | 25,000 | gasoline-full.webp |
| 高機動エンジンVI | 2,500,000 | engine-v1.webp (small black) |
| 高機動エンジンV2 | 4,800,000 | engine-v2.webp (larger black) |
| 高機動エンジンV3 | 8,200,000 | engine-v3.webp (red) |

All six are made by MAGITA and sold by ジンクス; their costs, purchase prices and
exclusive-sale charges are in [handbook/39.md](handbook/39.md).

All purchases appear in 所有. Engines can be installed on an owned, available car,
exchanged, or detached there. An exchange returns the previous engine to inventory.
Installed engines travel with a car when its ownership changes. Server transactions
check ownership, stock, rental/sale locks and inventory capacity. Repeated or
concurrent install requests cannot duplicate stock. NPC buyback quotes and payment
include 90% of the installed engine's catalog price; selling consumes the car and
its engine together. No new fuel, wear, or engine performance system is introduced.

The new charm and seven car item pictures use transparent WebP. PRO and ULTRA are
96×32 and 128×32 respectively, including transparency, for their small UI labels.
The import command is `python3 tools/art/import_carshop.py <attachment-directory>`.

| Added media | Supplied/previous bytes | Runtime bytes | Reduction |
| --- | ---: | ---: | ---: |
| Nine item/quest images | 1,690,800 | 134,120 | 92.1% |
| New studio movie | 294,706 | 51,720 | 82.5% |
| Six 3D effects models | 4,635,244 | 1,656,636 | 64.3% |

The movie is H.264 at 426×240 / 15 fps, CRF 34, with mono AAC at 48 kbit/s and a
faststart index. One tap pauses it, fades the frame to black over 700 ms, then
reveals the title. Repeated taps and late load/end/error events preserve that fade.
Autoplay retries muted if sound is blocked. 演出設定 contains a persistent 起動時ロゴ
switch; OFF skips loading the movie on the next launch. The sound button, reset-all
button, settings close buttons and generic tap rings were removed. The settings
backdrop and Escape still dismiss the dialog.

The six WIN / BIG / SUPER / ULTRA / LEVEL UP / VIP extension models now load from
`img/3d/effects-lite/`, using meshopt, simplified meshes and WebP textures up to
384 px. Original models remain available for rebuilding; runtime mappings use only
the smaller versions. `tools/3d/build.sh` uses the reduced settings for future builds.

Validation: 222 server/application tests pass, including seven CAR SHOP tests;
actual DOM modules plus HTTP verify purchase, inventory, car selection, equip and
detach; logo/settings tests cover persistence, autoplay and skip races; all six
GLBs and 24 compressed mesh buffers decode successfully. New image/movie routes
and the self-contained HTML build are checked. Browser-wide layout and WebGL
rendering could not be checked because a working browser binary was unavailable.
