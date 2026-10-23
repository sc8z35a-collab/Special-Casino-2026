# 3D tree auctions

`js/render/auction3d.js` shares the game's existing Three.js r170 bundle. The
server remains authoritative for prices, timing, payment and tree awards.

- The player is `dennis` / デニス, displayed as **あなた**. Five NPCs retain
  their supplied model names: ジョウモンさん, ナターシャ,
  ミスタースミスジョンソン, 神谷社長 and 野生を生きる男.
- Models are decoded before opening a new auction. The server then reserves
  seven seconds for the continuous introduction camera, with bidding disabled.
- Bidding lasts at least 90 seconds, and no more than 180 seconds after the
  introduction. After 90 seconds, six seconds without a new bid closes it;
  a late bid cannot extend the hard deadline. Existing in-flight auctions
  without the new timing fields keep their original closing time.
- Every fresh accepted bid raises that buyer's left hand and shows `cash.webp`
  for 1.35 seconds. `sounds/money.mp3` plays for both player and NPC bids.
  Opening an existing auction does not replay historical bids or sounds.
- Results animate the winner and the disappointed buyers, then move close to
  the winner's face. The second viewport rotates the seed or tree according
  to the market, including on an NPC win.
- The venue uses a camera-side clipping plane, so its front fence cannot hide
  the buyers. The uploaded source GLB is preserved.
- The ambient murmur is a temporary synthesized eight-second loop in
  `BR.sfx.auctionCrowd`; no crowd recording was supplied. It shares sound-effect
  volume/voice-call ducking and stops on results, other screens and hidden tabs.
- A missing WebGL context shows an explanation and retains price controls,
  money feedback and the server auction. Reopening the screen retries once.

## Asset build

Install `@gltf-transform/cli@4.1.1` (also used in `build.sh`) outside the game
checkout, then run:

```sh
python3 tools/3d/build-auction.py /path/to/uploads /path/to/gltf-transform
node tools/stamp.mjs
```

The script reads the ten supplied GLBs, renames their animation clips, removes
unused walking/running clips, reduces geometry, and writes meshopt GLBs with
1024px WebP textures to `img/3d/auction/`. All ten total approximately 8 MB.
Larger files are stored as byte-preserving `.bin` parts listed in `assets.json`;
the client joins them before GLTFLoader decodes the original GLB. This changes
neither the geometry nor the textures or animations.
`cash.webp` is a 384px conversion of 名称未設定のデザイン.png, preserving alpha.

| Original animation ID | Runtime clip |
| --- | --- |
| `_01a1638f_2bcb_700d_8d3a_f194111e7767` | `bid` — left hand above the head |
| `_01a16391_e552_76c0_bb2d_81744e3e9327` | `lose` — head in hands |
| `_01a16393_ee48_70ae_babf_4bbe4e176ca9` | `win` — celebration |
| `_01a16395_9a38_745a_87ab_995c42151e60` | `idle` — standing |

## Validation

`node --test server/test/tree.test.js` covers the cast, introduction lock,
minimum duration, deadline and exactly-once settlement, alongside existing
tree-growth, SUPER and auction tests. All six compressed skeletons have also
been loaded with Three.js and checked for a bound head bone and a left hand
above that head during the bid clip. The production scene/camera code was
rendered offline to inspect the sweep, venue occlusion and both result lots.
Browser UI checks cover the no-WebGL fallback; the verification browser has
WebGL disabled, so actual browser GPU rendering remains unverified there.
