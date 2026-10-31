# Supplied Car Owner cars

The original GLBs stay outside git. Distribution uses Meshopt geometry and
WebP textures at up to 2048px, following Blue Lightning's existing pipeline.
Each car is Y-up with its nose toward -X; the existing renderer centres it,
fits its length to 4.6m and places its wheels on the floor. Studio lighting,
base and shelves, rotation and zoom limits, garage parking, first-person
movement/collisions and 5x lens remain in `js/render/garage3d.js`.
Only three recently viewed car models are cached. Displayed models are protected;
evicted geometry, materials and textures are disposed to bound phone memory.

| Source filename | Car ID | Display name | Base game price |
| --- | --- | --- | ---: |
| オンヴォーロ.glb | onvoro | MAGITA オンヴォーロ | 4,200,000 |
| フェラーリ325.glb | ferrari-325 | MAGITA 325 | 27,000,000 |
| メルセデスベンツ one.glb | mercedes-benz-one | MAGITA ONE | 55,000,000 |
| ランボルギーニアベンタドール.glb | lamborghini-aventador | MAGITA アベンタドール | 80,000,000 |
| ランボルギーニウルス.glb | lamborghini-urus | MAGITA ウルス | 30,000,000 |
| ランボルギーニクイヤスパイダー.glb | lamborghini-kuia-spyder | MAGITA クイヤスパイダー | 20,000,000 |
| 日産　gt-r.glb | nissan-gt-r | MAGITA GT-R | 34,000,000 |
| オレンジスポーツカー.glb | lamborghini-revuelto | MAGITA レヴエルト | 65,000,000 |
| ホワイトスポーツカー.glb | mercedes-amg-one-white | MAGITA ONE（ホワイト） | 300,000,000 |

The display names carry no real maker's name: every car is a MAGITA (the game's only maker, docs/handbook/39.md);
the IDs stay as they were, since owned cars are stored by them. The names and prices in `js/game/config.js` are
the ones that count.

The numeric amounts use the game's existing dollar currency, with no real-world
exchange-rate conversion. Named sources retain supplied spellings including
`325`, `one` and `クイヤスパイダー`.

Generic filenames were identified by inspecting front, side and rear renders of
the actual supplied models. These are visual inferences for stylized models:

- Orange: Revuelto, inferred from its Y-shaped lights, silhouette and high
  central hexagonal exhausts. [Manufacturer reference](https://www.lamborghini.com/en-en/models/revuelto-models/revuelto).
- White: Mercedes-AMG ONE, inferred from its three-pointed star, front lights
  and intakes, roof intake/longitudinal fin and rear aero.
  [Manufacturer reference](https://www.mercedes-amg.com/en/amg-one).
  Its own ID distinguishes it from the separately supplied priced ONE.

Both now have prices (2026-10-31). A pending price, should a car ever have one
again, is `null`, never zero: the car stays selectable for 3D preview with a
「価格未定」 label and the UI blocks buying. The server's `CARS`
map contains priced models only, so its existing purchase guard rejects pending
models as `bad_model`; no purchase API changes are required. Sales and VIP
pricing exclude them, and the buyback response is `null`. Set a positive price
in the shared `js/game/config.js` catalog once it is decided. Existing sale,
VIP discount, capacity, rental, resale and gifting rules apply to priced cars.

## Regeneration

```sh
sh tools/3d/import-cars.sh /path/to/the/nine/source-glbs
# Requires Playwright with Chromium and sharp available to Node:
node tools/3d/render-cars.mjs
python3 tools/fonts/subset.py
node tools/stamp.mjs
npm test
```

`CAR_TOOLS_NODE_MODULES` optionally supplies the thumbnail renderer's dependency
directory, and `CAR_CHROMIUM` a Chromium executable. Geometry targets the
smaller of 16% or 130,000 triangles with the existing 0.0008 shape-error limit.
The models have 60,000–130,000 triangles and are 0.94–1.85MB each (11.3MB total).
Transparent 1200×564 WebP thumbnails are rendered from those same models for
the catalog, garage, chat cards and WebGL fallback. The Japanese font subset
includes all added car names; long names use smaller type to keep controls visible.
