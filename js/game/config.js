/* Game rules: symbols, per-cell probabilities and the pay table shown in the
   in-game "組み合わせ" tab.  RTP with these numbers is 82.00 % (a win on
   33.5 % of the spins); in a hub (友達と稼ぐ) see `hub`. */
(function (BR) {
  'use strict';

  BR.CONFIG = {
    // order = paytable order (low -> high)
    symbols: ['revolver', 'gold', 'diamond', 'star', 'bar', 'seven', 'statue'],
    // probability of each symbol landing on any reel position
    weights: { revolver: 0.452, gold: 0.227, diamond: 0.212, star: 0.045, bar: 0.039, seven: 0.021, statue: 0.004 },
    // matches anywhere on the centre line: count -> multiplier of the bet
    pays: {
      revolver: { 4: 1.5, 5: 3 },
      gold: { 3: 2, 4: 4, 5: 10 },
      diamond: { 3: 2.5, 4: 5, 5: 20 },
      star: { 2: 3, 3: 10, 4: 20, 5: 100 },
      bar: { 2: 4, 3: 15, 4: 50, 5: 500 },
      seven: { 2: 10, 3: 20, 4: 100, 5: 1000 },
      statue: { 1: 2, 2: 10, 3: 100, 4: 1000, 5: 10000 }
    },
    bets: [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000],
    // win presentation tiers by multiplier: WIN < 5x <= BIG WIN < 15x <= SUPER BIG WIN
    tiers: { big: 5, superBig: 15 },
    // from this many wins in a row (the combo; in a hub the one everyone
    // shares) every win pays double
    comboDouble: 5,
    // アクセス日数 (login days, all told): Ice Smoker公式 sends `amount` $
    // by itself on each of these (not to a 永久BAN account)
    accessDays: { at: [5, 10, 15, 20, 25, 30, 35], amount: 250000 },
    // 登録者数の記念: when the accounts registered reach `players`, Ice
    // Smoker公式 sends everyone then (not the プレイヤーアーカイブ) `dollars` $, once
    milestones: [{ players: 10, dollars: 100000 }, { players: 20, dollars: 200000 }, { players: 50, dollars: 500000 }],
    tokenPrice: 10,          // $ per spin token
    // The slots are Dtrade's (js/game/corp.js): a spin that bets `bigBet` tokens or more and wins pays Dtrade
    // `winFee` of its win (rounded down, in tokens); changing tokens back to $ costs `exchangeFee` $ each time;
    // and every month a player who spun in it is charged `monthly.amount` $ for the slots by TWO STATE公式, to be
    // paid within `monthly.days` days (after that it is taken, even if that leaves the $ below 0).
    casino: { bigBet: 2000, winFee: 0.06, exchangeFee: 40000, monthly: { amount: 1000000, days: 5 } },
    dailyLimit: 10000000,    // spin tokens that can be bought per UTC day
    dailyFree: 1000,         // free tokens claimable once per UTC day
    start: { tokens: 0, dollars: 5008159, coins: 74 },
    // 開発者支援 (js/ui/support.js, server/core/pay.js): yen for ロイヤルコイン,
    // the coins in the wallet. They make days of VIP, and DAIZIN buys them back
    // for $ (vip.buyback); never bet, exchanged for tokens, sent to anyone or
    // paid out. Up to `maxQty` of one plan at
    // once (`bonus`: 感謝料 coins on top, per unit), paid with PayPay or at a
    // konbini (each from `min` yen, the payment company's smallest payment;
    // a konbini payment waits `konbiniDays` days), at most `dailyMax` yen a
    // player a day. The meters fill with every yen paid: 開発費回収 up to
    // `recover` once, then 来月の開発費確保 up to `monthly` every month.
    support: {
      plans: [
        { id: 'support1', name: '開発者支援I', price: 10, coins: 10, bonus: 0 },
        { id: 'support2', name: '開発者支援II', price: 20, coins: 20, bonus: 0 },
        { id: 'support3', name: '開発者支援III', price: 30, coins: 30, bonus: 4 }
      ],
      maxQty: 100,
      methods: [
        { id: 'paypay', name: 'PayPay', min: 50, max: 1000000 },
        { id: 'konbini', name: 'コンビニ決済', min: 120, max: 300000 }
      ],
      konbiniDays: 3,
      dailyMax: 10000,
      goals: { recover: 9900, monthly: 3400 }
    },
    // VIP (js/game/vip.js): `coins` ロイヤルコイン a day of it, at most
    // `maxDays` days ahead; from VIP`refund.from` on, `refund.coins` of a day's
    // come back. VIP EXP: `exp.win` a casino win, `exp.quest` a quest
    // finished and `exp.ultra` an ULTRA BIG WIN while VIP is on, `exp.car`
    // every car bought at Car Owner; `levels`: the EXP VIP0-VIP3 start at.
    // While it is on: XP in a hub `hubXp` times, cars `carOff` % off on top
    // of any sale, a garage place `garageOff` % off; from VIP1 the バイト being
    // worked pay `wage[level]` times and an ULTRA BIG WIN `ultra` times;
    // calls at `voice` kbit/s (no VIP, VIP0-1, VIP2-3: the best in a call for
    // everyone in it). `cars` in the Car Owner list with `vip` are for that level on.
    // A day of VIP is 24 hours from when it starts (or from the end of the days
    // already bought). `packs`: まとめ買い, `days` paid for with `bonus` more
    // free (`sale`: its label; '' ends it). `trial`: VIP`level` for `days`
    // days, free, once in a player's life for one who never had VIP; days
    // bought during it come after it, at the player's own level (VIP0 at first).
    vip: {
      coins: 4,
      maxDays: 365,
      // DAIZIN (VIP's company, js/game/corp.js) buys ロイヤルコイン back: `each` $ a coin, out of its own money, at
      // most `max` coins at once (POST /api/coins/sell)
      buyback: { each: 50000, max: 100000 },
      packs: { sale: '今だけ特大セール', list: [{ days: 10, bonus: 2 }, { days: 20, bonus: 7 },
        { days: 30, bonus: 12, resetTickets: 1 }, { days: 40, bonus: 25, resetTickets: 1 }] },
      trial: { days: 3, level: 3 },
      refund: { from: 1, coins: 2 },
      exp: { win: 1, quest: 0.1, ultra: 250, car: 30 },
      levels: [0, 1200, 2100, 4500, 8800, 14800],
      labels: ['0', '1', '2', '3', '3.1', '4'],
      badgeImages: {
        '0': 'img/vip/vip-0.webp',
        '1': 'img/vip/vip-1.webp',
        '2': 'img/vip/vip-2.webp',
        '3': 'img/vip/vip-3.webp',
        '3.1': 'img/vip/vip-3.1.webp',
        '4': 'img/vip/vip-4.webp'
      },
      modes: { normal: { coins: 0, multiplier: 1 }, pro: { coins: 8, multiplier: 1.6 }, ultra: { coins: 12, multiplier: 2 } },
      permanent: { from: 5, level: 2 },
      specialLogin: { from: 4, days: 60, rewards: [] },
      hubXp: 1.5,
      carOff: 3,
      carOff31: 15,
      garageOff: 40,
      wage: [1, 2.5, 2.5, 3, 3, 3],
      ultra: 1.3,
      // a call's Opus bitrate (kbps) by tier: no VIP, VIP0-1, VIP2-3, and the
      // one above VIP3; `voiceAll`: the tier every call has at least, for now
      // (the paid plan has plenty of room: everyone gets more than VIP3)
      voice: [32, 48, 64, 96, 256],
      voiceAll: 3
    },
    receiveDays: { money: 30, item: 90 },
    // 運営へのメッセージ・報告・意見案・通報・プレイヤー間のメッセージ: more than
    // `chars` characters or `bytes` bytes are not sent
    sendMax: { chars: 6000, bytes: 2097152 },
    // 通報: `perHour` a player, each one paid `reward` $ by Ice Smoker公式;
    // 意見案: `perDay` a player (days from 9:00 Japan time), an adopted one pays `reward` spin tokens
    report: { perHour: 3, reward: 5000 },
    // 通報 of one message (the ⋯ under it): `perDay` a player (days from 6:00
    // Japan time), `chars` characters at most; paid only if the operators accept it
    messageReport: { perDay: 8, chars: 1000 },
    // 送信の取り消し: a player's own words, for `minutes` after they were sent
    retract: { minutes: 60 },
    idea: { perDay: 10, reward: 50000 },
    // a car sold to a friend in the chat: `min`-`max` % of what the seller paid for it
    carResale: { min: 50, max: 300 },
    // Player portraits: one free starter; the others have fixed dollar prices.
    defaultAvatar: 'traveler-green',
    avatarRarities: { green: '緑', blue: '青', purple: '紫', gold: '金色', red: '赤', cyan: '水色', secret: 'シークレット' },
    avatars: [
      { id: 'traveler-green', name: '旅人', rarity: 'green', price: 0 },
      { id: 'adventurer-blue', name: '冒険者', rarity: 'blue', price: 100000 },
      { id: 'magician-purple', name: '魔法使い', rarity: 'purple', price: 350000 },
      { id: 'dealer-purple', name: 'ディーラー', rarity: 'purple', price: 350000 },
      { id: 'adventurer-gold', name: '大冒険者', rarity: 'gold', price: 600000 },
      { id: 'knight-gold', name: '騎士', rarity: 'gold', price: 600000 },
      { id: 'karate-red', name: '空手家', rarity: 'red', price: 950000 },
      { id: 'rogue-red', name: '放浪者', rarity: 'red', price: 950000 },
      { id: 'swordsman-red', name: '剣士', rarity: 'red', price: 950000 },
      { id: 'pilot-cyan', name: '飛行士', rarity: 'cyan', price: 1200000 },
      { id: 'explorer-cyan', name: '探検家', rarity: 'cyan', price: 1200000 },
      { id: 'healer-cyan', name: 'ヒーラー', rarity: 'cyan', price: 1200000 },
      { id: 'gambler-secret', name: '勝負師', rarity: 'secret', price: 2100000, rare: true },
      { id: 'adam-secret', name: 'アダム', rarity: 'secret', price: 2100000, rare: true },
      // シークレットアイコン: never sold and never free, only given (a 功績 reward: server/core/medals.js); `given`
      { id: 'philosopher-secret', name: '哲学者', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'warrior-secret', name: '女戦士', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'assassin-secret', name: 'アサシン', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'waitress-secret', name: '看板娘', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'chef-secret', name: 'シェフ', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'wanderer-secret', name: '旅の少女', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'fennec-secret', name: 'フェネック', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'professor-secret', name: '博士', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'chemist-secret', name: '研究員', rarity: 'secret', price: 0, rare: true, given: true },
      { id: 'sage-secret', name: '大賢者', rarity: 'secret', price: 0, rare: true, given: true }
    ],
    // Car Owner shop (price in $); `model`: a 3D model to look at
    // (img/3d/cars/<id>.glb, js/render/garage3d.js). A null price means the
    // car can be previewed but cannot be bought or included in a sale; an
    // `ended` one is no longer sold (the ones the players have can still be
    // sold back). Every car is made by MAGITA or YOSIDA (`maker`; what it costs to
    // make and how its price is shared with Car Owner: js/game/corp.js products).
    cars: [
      { id: 'two-state-sedan', name: 'MAGITA Two state セダン', price: 26500000, ended: true },
      { id: 'blue-lightning', name: 'MAGITA シロン', price: 35000000, model: true },
      { id: 'onvoro', name: 'MAGITA オンヴォーロ', price: 4200000, model: true },
      { id: 'ferrari-325', name: 'MAGITA 325', price: 27000000, model: true },
      { id: 'mercedes-benz-one', name: 'MAGITA ONE', price: 55000000, model: true },
      { id: 'lamborghini-aventador', name: 'MAGITA アベンタドール', price: 80000000, model: true },
      { id: 'lamborghini-urus', name: 'MAGITA ウルス', price: 30000000, model: true },
      { id: 'lamborghini-kuia-spyder', name: 'MAGITA クイヤスパイダー', price: 20000000, model: true },
      { id: 'nissan-gt-r', name: 'MAGITA GT-R', price: 34000000, model: true },
      { id: 'lamborghini-revuelto', name: 'MAGITA レヴエルト', price: 65000000, model: true },
      { id: 'mercedes-amg-one-white', name: 'MAGITA ONE（ホワイト）', price: 300000000, model: true },
      // YOSIDA's cars (MAGITA's rival: js/game/corp.js), sold at Car Owner too; pictures are placeholders for now
      { id: 'yoshida-zx4', name: 'YOSHIDA ZX4', price: 8500000, maker: 'yosida' },
      { id: 'yoshida-p100w', name: 'YOSHIDA P100W', price: 6400000, maker: 'yosida' },
      { id: 'yoshida-h9c', name: 'YOSHIDA H9C', price: 10500000, maker: 'yosida' },
      { id: 'yoshida-s5', name: 'YOSHIDA S5', price: 4000000, maker: 'yosida' },
      { id: 'yoshida-s6', name: 'YOSHIDA S6', price: 3600000, maker: 'yosida' },
      { id: 'yoshida-k10e', name: 'YOSHIDA K10E', price: 6000000, maker: 'yosida' }
    ],
    // the garage holds this many cars; one more place costs `slotPrice` $ (for good, any number). The garages are
    // MAGITA Garage's: every month each place costs its contract fee (js/game/corp.js MAGITA.garage), taken from the $
    garage: { slots: 2, slotPrice: 1000000 },
    // Car Owner sales (js/game/sale.js), never two at once: on `chance` % of
    // the days / weeks / months (the yearly one always), `hours` long, on
    // `cars` cars at random (0: all of them), each `min`-`max` % off
    carSales: {
      day: { name: '極セール', chance: 5, hours: 5, cars: 2, min: 1, max: 10 },
      week: { name: '超極セール', chance: 5, hours: 24, cars: 5, min: 10, max: 30 },
      month: { name: '超ダイナミックセール', chance: 5, hours: 24, cars: 8, min: 20, max: 45 },
      year: { name: '年感謝セール', chance: 100, hours: 24, cars: 0, min: 10, max: 30 }
    },
    // the car buy-back: a car's price now (with its sale) less `min`-`max` %,
    // a new rate every Japan day; the 大廃棄セール (on `chance` % of the
    // fortnights, a day long): every car less the same `min`-`max` % (by `step`)
    carBuyback: { min: 10, max: 35, disposal: { name: '大廃棄セール', chance: 45, min: 2.5, max: 10, step: 0.5 } },
    // renting cars out (any number of one's cars): every `hours` hours customers
    // come (each of these with its chance), paying `min`-`max` $ each (the
    // dearer the car, the more), and `vip.chance` of them `vip.pay` $; a car
    // out is away for `hours` hours at least (stopping it waits for that); MAGITA Garage takes its cut of the
    // takings when they are collected (js/game/corp.js MAGITA.garage.rentCut)
    carRental: { hours: 5, maxPay: 4500000, customers: [1, 0.9, 0.4, 0.3, 0.1], min: 10000, max: 60000, spread: 20000, vip: { chance: 0.03, pay: 150000 } },
    // Shop (price in $, 10-40 % off for 5 hours a day: js/game/sale.js);
    // anything bought here can be given to friends, up to `max` per player
    shop: [
      { id: 'omamori', name: 'セーフティースロット', price: 80000, max: 10 },
      { id: 'repair-kit', name: '車修理キット', price: 450000, max: 999, category: 'car', fixedPrice: true },
      { id: 'car-oil-medium', name: '車オイル中型', price: 550000, max: 999, category: 'car', fixedPrice: true },
      { id: 'gasoline-full', name: 'ガソリン満杯', price: 25000, max: 999, category: 'car', fixedPrice: true },
      { id: 'engine-v1', name: '高機動エンジンVI', price: 2500000, max: 999, category: 'car', kind: 'engine', fixedPrice: true },
      { id: 'engine-v2', name: '高機動エンジンV2', price: 4800000, max: 999, category: 'car', kind: 'engine', fixedPrice: true },
      { id: 'engine-v3', name: '高機動エンジンV3', price: 8200000, max: 999, category: 'car', kind: 'engine', fixedPrice: true },
      // YOSIDA's 高効率エンジン series (placeholder pictures for now)
      { id: 'yoshida-er10', name: 'YOSHIDA ER-10', price: 2000000, max: 999, category: 'car', kind: 'engine', fixedPrice: true, maker: 'yosida' },
      { id: 'yoshida-er20', name: 'YOSHIDA ER-20', price: 6500000, max: 999, category: 'car', kind: 'engine', fixedPrice: true, maker: 'yosida' }
    ],
    // セーフティースロット (once お守り加護), switched on before a spin: the next losing spin gives back
    // min-max % of the lost tokens (all of them `fullChance` of the time);
    // with 友達と稼ぐ's benefits on, up to `hub.max` % and `hub.fullChance`
    charm: { item: 'omamori', min: 5, max: 20, fullChance: 0.02, hub: { max: 70, fullChance: 0.04 } },
    // thrown at the friend one is watching: spin tokens from the thrower
    fruits: [
      { id: 'strawberry', name: 'ストロベリー', tokens: 1000 },
      { id: 'watermelon', name: 'スイカ', tokens: 2000 },
      { id: 'melon', name: 'メロン', tokens: 5000 }
    ],
    // people watching one player (the player picks who they talk with)
    maxWatchers: 10,
    // 協力スロット: the spin tokens a group's players bet at its table fill
    // one gauge; when it is full, everyone who bet gets `bonus` of what they
    // bet in that round (the gauge then starts over)
    coop: { goal: 100000, bonus: 0.05 },
    // フレンド対決: two friends spin the same number of times (one of
    // `spins`) at one bet, and the larger total win wins. An invitation waits
    // `inviteMs`; a battle not finished in `maxMs` is decided as it stands.
    battle: { spins: [10, 20, 30], inviteMs: 600000, maxMs: 3600000 },
    // 観戦ベット: a watcher stakes spin tokens on whether the player gets a
    // BIG WIN (or better) within their next `spins` spins: "hit" pays `hit`
    // times the stake, "miss" `miss` times (a BIG WIN in 10 spins: 18.8 %).
    // A bet left open for `refundMs` (the player stopped) is given back.
    watchBet: { spins: 10, stakes: [1000, 5000, 10000], hit: 5, miss: 1.15, refundMs: 86400000 },
    // login bonus in spin tokens for the 1st, 2nd, 3rd, 4th day logged in
    // (then it starts over); a day runs from 6:00 to 6:00 Japan time
    loginBonus: { days: [45000, 50000, 65000, 90000], dayStartsJst: 6 },
    // Peter the money lender ($): never more than `max` in all (counted over
    // every loan ever made to the player, repaid or not, those before DEV11
    // too); he offers money on his own when a player is nearly broke (net
    // worth below `brokeBelow` $). `voice`: his recorded offers (they say
    // 500万 and 600万: off while the offers are other amounts)
    lender: {
      max: 2500000,
      brokeBelow: 10000,
      minLoan: 10000,
      offers: [{ amount: 1500000, rate: [2, 5] }, { amount: 1000000, rate: [10, 10] }],
      voice: false,
      // asked in the chat: like the first offer when nothing is owed, then 10 %
      chatRate: [[2, 5], [10, 10]]
    },
    // presents sent in a chat (the picture img/gifts/<id>.webp): the sender
    // pays `price` $, the friend taps it once to get as much
    presents: [
      { id: 'cookie', name: 'クッキー', price: 10000 },
      { id: 'bear', name: 'クマのぬいぐるみ', price: 50000 },
      { id: 'snowman', name: '雪だるま', price: 100000 },
      { id: 'pumpkin', name: 'パンプキンヘッド', price: 250000 },
      { id: 'diamond', name: 'ダイヤモンド', price: 1000000 }
    ],
    // 通報: what kind of trouble
    reportKinds: [
      { id: 'spam', name: 'スパム' },
      { id: 'abuse', name: '暴言' },
      { id: 'harass', name: '嫌がらせ' },
      { id: 'conduct', name: '不適切な行動' },
      { id: 'cheat', name: 'チート' },
      { id: 'other', name: 'その他' }
    ],
    // ジョンソン, a friend NPC ($): `gift` (rounded to 1000) every `every` ms to
    // help grow the 金の生る木, and once ever `rescue` when the money (tokens
    // at their price) is under `rescueBelow`; nothing is ever paid back
    johnson: { every: 172800000, gift: [100000, 200000], rescue: 350000, rescueBelow: 80000 },
    // part-time jobs (バイト): `wage` $ an hour, paid for every second worked
    // (also while away); `level`: the player level that unlocks it. How many
    // can be worked at once: `jobSlots`, one more every `jobSlotEvery` player
    // levels (Lv.3: 2, Lv.6: 3 ...: BR.LEVEL.jobSlots).
    jobs: [
      { id: 'garage', name: '近所のガレージの壁を殴るバイト', wage: 20000, level: 1 }
    ],
    jobSlots: 1,
    jobSlotEvery: 3,
    jobMaxPay: 6000000,
    // $ for every player who updates the game to a new release (js/game/news.js)
    updateBonus: 250000,
    // 金の生る木 (js/game/tree.js): money given to a tree (one tap: one of `amounts`, the stops of the slider)
    // makes it earn $ every second: `rate` [given so far, $ a second], a
    // straight line in between (no jumps), flat after the last. A harvest
    // `cycle` is picked when it starts and the money waits until it is over:
    // what grew in it times `mult`. `stages`: the given sum each look starts
    // at. A SUPER tree pays `superMult` times, for good. More trees come from
    // the auctions (`markets`: the average winning price for the 2nd tree and
    // for every one after it), at most `max`.
    tree: {
      amounts: [5000, 10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000],
      rate: [[0, 5], [150000, 7], [200000, 8], [500000, 9], [1500000, 10], [3000000, 11], [6000000, 12], [10000000, 13], [20000000, 14]],
      cycles: [
        { id: '30m', name: '30分', ms: 1800000, mult: 1 },
        { id: '2h', name: '2時間', ms: 7200000, mult: 1.1 },
        { id: '1d', name: '1日', ms: 86400000, mult: 1.2 },
        { id: '1w', name: '1週間', ms: 604800000, mult: 1.6 }
      ],
      stages: [0, 150000, 200000, 500000, 1500000, 3000000, 6000000, 10000000, 20000000],
      superMult: 1.1,
      max: 8,
      markets: {
        seed: { name: '木の種市場', second: 10200000, more: 21300000 },
        grown: { name: '成長した木市場', second: 12100000, more: 22100000 }
      },
      superChance: 0.12
    },
    // 友達と稼ぐ: friends invited from the friend list play together in a hub
    // of up to `max` players (each on their own reels, which the others do not
    // see; nobody leaves unless they press 抜ける, a hub of one closes). While
    // two or more of its players are active (a tap, a key or a voice in the
    // last 4 minutes), every spin of theirs uses `weights` (the statue 1 %, 7
    // 4 %, the revolver 35 %, the rest as usual between them),
    // `diamonds` of the spins land five diamonds, the
    // combo is shared by everyone: each win in a row pays `comboStep` times
    // more than the one before (x1, x1.1, x1.21 ...) and only `misses` misses
    // in a row end it; 777 (three 7s or more) pays `sevens` times, XP is `xp`
    // times, and 5時間 quests count `booster` times as fast with two active
    // players, `boosterStep` times more for each one after that (x2, x2.2,
    // x2.42 ...), and the best paid バイト being worked pays `wage` times its
    // wage. An invitation waits `inviteMs`.
    hub: {
      max: 5,
      weights: { revolver: 0.35, gold: 0.26, diamond: 0.243, star: 0.052, bar: 0.045, seven: 0.04, statue: 0.01 },
      diamonds: 0.01,
      comboStep: 1.1,
      misses: 3,
      sevens: 1.5,
      xp: 1.2,
      booster: 2,
      boosterStep: 1.1,
      wage: 1.5,
      inviteMs: 600000
    }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
