/* 企業: the companies of the game's world (server/core/corp.js works them out day by day; the 投資 screen,
   js/ui/stocks.js, shows the listed ones, and the operator site's 株式 app, ops/corp.js, all of them). Who they
   are, the fiscal calendar, the accounts their books keep and how the statements read, the taxes, the lending
   ranks, the economy they share and how each makes its money. Money is whole $ (the NPCs say 円); a day is a
   trading day, 9:00 to 9:00 Japan time (a UTC day), named by its date. Every number here is where a company
   starts: from then on it hires, raises pay, sells, borrows and grows by itself. */
(function (BR) {
  'use strict';

  var DAY_MS = 86400000;

  /* ------------------------------------------------------------ the calendar --- */
  function dayOf(ms) { return Math.floor(ms / DAY_MS); }
  function ymd(day) { var d = new Date(day * DAY_MS); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
  function dayAt(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS); }
  // the fiscal year (年度) runs from April to March and is named by the year it starts in
  var FY_START = 4;
  function fyOf(day) { var t = ymd(day); return t.m >= FY_START ? t.y : t.y - 1; }
  function fyStart(fy) { return dayAt(fy, FY_START, 1); }
  function fyEnd(fy) { return fyStart(fy + 1) - 1; }
  // the quarter of the fiscal year (1: April to June … 4: January to March)
  function quarterOf(day) { return Math.floor(((ymd(day).m - FY_START + 12) % 12) / 3) + 1; }
  function quarterStart(fy, q) { var m = FY_START + (q - 1) * 3; return m > 12 ? dayAt(fy + 1, m - 12, 1) : dayAt(fy, m, 1); }
  function quarterEnd(fy, q) { return q === 4 ? fyEnd(fy) : quarterStart(fy, q + 1) - 1; }
  function monthStart(day) { var t = ymd(day); return dayAt(t.y, t.m, 1); }
  function monthEnd(day) { var t = ymd(day); return (t.m === 12 ? dayAt(t.y + 1, 1, 1) : dayAt(t.y, t.m + 1, 1)) - 1; }
  function isMonthEnd(day) { return ymd(day + 1).d === 1; }
  function isQuarterEnd(day) { return isMonthEnd(day) && ymd(day).m % 3 === 0; }
  function isFyEnd(day) { return isMonthEnd(day) && ymd(day).m === FY_START - 1; }
  function monthKey(day) { var t = ymd(day); return t.y + '-' + (t.m < 10 ? '0' : '') + t.m; }
  function quarterKey(day) { return 'FY' + fyOf(day) + 'Q' + quarterOf(day); }
  function fyKey(day) { return 'FY' + fyOf(day); }
  function monthLabel(day) { var t = ymd(day); return t.y + '年' + t.m + '月'; }
  function quarterLabel(day) { return fyOf(day) + '年度 第' + quarterOf(day) + '四半期'; }
  function fyLabel(day) { return fyOf(day) + '年度'; }
  function dateLabel(day) { var t = ymd(day); return t.y + '年' + t.m + '月' + t.d + '日'; }

  /* ------------------------------------------------------------- the economy --- */
  // The economy every company lives in (景気): its log moves month by month towards 0 (half-life `half` months)
  // with shocks of `sd`, so it wanders about ±`sd`·2.5 for years. A company's own demand follows it by its `beta`
  // (a carmaker's sales swing with it, a shop's hardly; a bank's credit costs go the other way).
  var ECONOMY = { half: 18, sd: 0.022 };
  // a year by the month (January first): how much more or less is sold than on an average day
  var SEASONS = {
    flat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    games: [0.9, 0.85, 1, 0.9, 1, 0.9, 1.05, 1.15, 0.95, 1, 1.15, 1.35],
    cars: [0.85, 1.05, 1.35, 0.85, 0.9, 0.95, 1, 0.85, 1.15, 0.95, 1, 1.1],
    retail: [0.95, 0.85, 1.05, 1, 1.05, 0.95, 1.05, 1.1, 0.9, 0.95, 1.05, 1.3],
    jobs: [1.1, 1.15, 1.25, 1.2, 0.95, 0.9, 0.95, 0.8, 0.95, 1, 0.95, 0.8],
    luxury: [0.95, 0.9, 1, 1.05, 1.1, 0.95, 1.05, 1.2, 0.95, 0.95, 0.95, 1.25],
    markets: [1.05, 1, 1.1, 1, 0.95, 0.95, 1, 0.9, 1, 1, 1, 1.05]
  };

  /* ------------------------------------------------------------ the companies --- */
  // Every company: its books on the day the company system starts (capital 資本金, reserve 資本準備金, retained
  // 利益剰余金), its people (staff, the average yearly pay 年収, what each costs it a year 会社負担人件費), its
  // yearly costs (place: the buildings it runs, with their name; rd: its research and development, with its name;
  // ads 広告宣伝費), what it sells in a year and earns from it (sales, op: the 営業利益 it makes at the start; the
  // rest of its costs are what that leaves), its buildings and machines (ppe), how it grows (growth: its sales a
  // year, hire: its staff, raise: pay, quit: who leaves a year), how it lives with the economy (beta, season), and
  // its shares (payout: the profit paid as dividends 配当性向, per/pbr: how the market prices it, founders: the
  // part its founders hold; listed: traded in the game's 投資; price: the share price it starts at when not).
  //
  // `streams`: what it sells, each a `share` of its sales at the start, with what it costs to sell (`cost`, a share
  // of the sale) and from whom it buys that (`from`: another company here, whose sale it becomes); `player`: the
  // game's own players' money that comes to it (cars bought and sold back, the garage, the Shop, VIP, the バイト's
  // employers, the 投資's fees): it is added to that stream as it is spent, on top of the rest.
  // A studio (model 'studio') makes games instead of streams: see `lines` below.
  var COMPANIES = [
    {
      id: 'tenesice', name: 'テネシス', full: '株式会社テネシス', en: 'Tenesice', rank: 'S', model: 'bank', kind: '銀行（金融の絶対支配者）',
      capital: 50000000000, reserve: 50000000000, retained: 3500000000000,
      staff: 12000, salary: 4800000, cost: 7000000,
      place: { name: '本店・支店網・巨大金庫維持費', amount: 15000000000 }, rd: { name: '金融セキュリティ・システム研究開発費', amount: 20000000000 },
      sales: 450000000000, op: 150000000000, salesName: '業務粗利益',
      streams: [
        { id: 'nii', name: '資金利益', share: 0.62, beta: 0.4 },
        { id: 'fees', name: '役務取引等利益', share: 0.32, beta: 0.9 },
        { id: 'trading', name: 'その他業務利益', share: 0.06, beta: 2.2, noise: 0.25 }
      ],
      // 与信関係費用: what goes bad of its loans, a share of its sales, rising as the economy falls
      credit: { share: 0.09, beta: -3 },
      // its balance sheet: assets `assets` times its equity, of which loans, bonds and cash; deposits for the rest
      bank: { assets: 12, loans: 0.55, bonds: 0.3 },
      ppe: 200000000000, growth: 0.02, beta: 0.6, season: 'flat', hire: 0.015, raise: 0.02, quit: 0.04,
      payout: 0.4, per: 11, pbr: 0.8, founders: 0.05, price: 60000
    },
    {
      id: 'magita', name: 'MAGITA', full: '株式会社MAGITA', en: 'MAGITA', rank: 'A', model: 'maker', kind: '総合重工メーカー（車・エンジン・オイル・修理キット）',
      capital: 2000000000, reserve: 2000000000, retained: 120000000000,
      staff: 6000, salary: 3200000, cost: 4800000,
      place: { name: '巨大工場・製造ライン維持費', amount: 8500000000 }, rd: { name: '車両・エンジン・化学研究開発費', amount: 6000000000 },
      sales: 90000000000, op: 9000000000,
      // what Car Owner and the Shop buy from it are its sales to them (each car and item at its 仕入れ価格, with its
      // 専売特別費用 on top, and what it costs to make: `products`); the rest it sells abroad and to companies, its
      // materials a share of that. Its factory hands (factory) and its factories are a cost of sales.
      streams: [
        { id: 'dealer', name: '車両の卸売（カーオーナー向け）', to: 'carowner' },
        { id: 'retail', name: '車用品の卸売（ジンクス向け）', to: 'jinx' },
        { id: 'excl', name: '専売特別収入', to: '*' },
        { id: 'export', name: '海外・法人向け販売', share: 1, beta: 1.4 }
      ],
      materials: true, factory: 0.7, inventoryDays: 45,
      ppe: 60000000000, growth: 0.03, beta: 1.4, season: 'flat', hire: 0.02, raise: 0.025, quit: 0.05,
      payout: 0.3, per: 13, pbr: 0.9, founders: 0.12, price: 18000
    },
    {
      id: 'carowner', name: 'カーオーナー', full: '株式会社カーオーナー', en: 'CAR OWNER', rank: 'A', model: 'dealer', kind: '自動車販売（MAGITAのディーラー）',
      capital: 500000000, reserve: 500000000, retained: 25000000000,
      staff: 2500, salary: 2800000, cost: 4000000,
      place: { name: '大型ショールーム・店舗維持費', amount: 2200000000 }, rd: { name: '販売管理システム開発費', amount: 150000000 }, ads: 1200000000,
      sales: 65000000000, op: 2500000000,
      // the cars (each model's customers a year: products), the cars bought back from players, and the rest of its
      // trade (its share of the sales and its cost found so that it makes its 営業利益: flex)
      streams: [
        { id: 'cars', name: '新車販売', products: 'cars', from: 'magita', beta: 1.5, player: ['car'] },
        { id: 'used', name: '中古車販売', player: ['buyback'] },
        { id: 'service', name: '整備・保険・ガレージ', flex: true, beta: 0.8, player: ['garage'] }
      ],
      inventoryDays: 40,
      ppe: 8000000000, growth: 0.03, beta: 1.5, season: 'cars', hire: 0.02, raise: 0.02, quit: 0.08,
      payout: 0.3, per: 12, pbr: 0.8, founders: 0.2, price: 9000
    },
    {
      id: 'jinx', name: 'ジンクス', full: '株式会社ジンクス', en: 'JINX', rank: 'A', model: 'retail', kind: 'ショップ（SHOPの運営・管理）',
      capital: 300000000, reserve: 300000000, retained: 18000000000,
      staff: 3000, salary: 2200000, cost: 3200000,
      place: { name: '店舗網・巨大倉庫維持費', amount: 1800000000 }, rd: { name: '流通・PB商品開発費', amount: 200000000 }, ads: 900000000,
      sales: 50000000000, op: 2000000000,
      // the Shop's items (its own セーフティースロット, and MAGITA's car items bought from it: products), and the rest
      // of its trade (flex, as the dealer's)
      streams: [
        { id: 'items', name: 'SHOP商品売上', products: 'items', beta: 0.9, player: ['shop'] },
        { id: 'goods', name: '一般商品売上', flex: true, beta: 0.5 }
      ],
      inventoryDays: 30,
      ppe: 6000000000, growth: 0.02, beta: 0.6, season: 'retail', hire: 0.015, raise: 0.02, quit: 0.12,
      payout: 0.35, per: 14, pbr: 1.0, founders: 0.15, price: 7000
    },
    {
      id: 'daizin', name: 'DAIZIN', full: '株式会社DAIZIN', en: 'DAIZIN', rank: 'A', model: 'service', kind: 'VIPサービス（VIP機能の運営・管理）',
      capital: 200000000, reserve: 200000000, retained: 15000000000,
      staff: 400, salary: 5500000, cost: 8000000,
      place: { name: '最高級VIPラウンジ・専用施設維持費', amount: 2500000000 }, rd: { name: '独自VIPサービス企画開発費', amount: 300000000 },
      sales: 12000000000, op: 3500000000,
      streams: [
        { id: 'members', name: 'VIP会員収入', share: 0.7, cost: 0.12, beta: 1.1, player: ['vip'] },
        { id: 'lounge', name: 'ラウンジ・専用サービス収入', share: 0.3, cost: 0.3, beta: 1.4 }
      ],
      ppe: 6000000000, growth: 0.05, beta: 1.2, season: 'luxury', hire: 0.03, raise: 0.03, quit: 0.05,
      payout: 0.4, per: 18, pbr: 2.0, founders: 0.3, price: 25000
    },
    {
      id: 'citywork', name: 'シティーワーク', full: '株式会社シティーワーク', en: 'CITY WORK', rank: 'A', model: 'service', kind: '求人メディア（バイト提供1位）',
      capital: 80000000, reserve: 80000000, retained: 12000000000,
      staff: 900, salary: 3600000, cost: 5200000,
      place: { name: 'オフィス・求人サーバー維持費', amount: 600000000 }, rd: { name: 'マッチングシステム研究開発費', amount: 800000000 }, ads: 2800000000,
      sales: 15000000000, op: 2800000000,
      streams: [
        { id: 'listings', name: '求人広告・掲載料収入', share: 0.85, cost: 0.12, beta: 1.3, player: ['job'] },
        { id: 'placement', name: '人材紹介・その他', share: 0.15, cost: 0.3, beta: 1.5 }
      ],
      // its share of the game's バイト (the employers' fees on what the players are paid), losing to スピーディード bit by bit
      jobs: { share: 0.65, drift: -0.02 },
      ppe: 1500000000, growth: 0.03, beta: 1.3, season: 'jobs', hire: 0.02, raise: 0.03, quit: 0.08,
      payout: 0.35, per: 22, pbr: 3.0, founders: 0.1, price: 16000
    },
    {
      id: 'speedeed', name: 'スピーディード', full: '株式会社スピーディード', en: 'SPEEDEED', rank: 'A', model: 'service', kind: '求人検索（バイト提供2位・急成長）',
      capital: 40000000, reserve: 40000000, retained: 4500000000,
      staff: 500, salary: 3800000, cost: 5500000,
      place: { name: 'オフィス・クラウドサーバー維持費', amount: 450000000 }, rd: { name: '検索アルゴリズム研究開発費', amount: 1000000000 }, ads: 1750000000,
      sales: 8000000000, op: 1200000000,
      streams: [
        { id: 'search', name: '求人検索の広告収入', share: 0.9, cost: 0.08, beta: 1.1, player: ['job'] },
        { id: 'other', name: 'その他', share: 0.1, cost: 0.3, beta: 1.2 }
      ],
      jobs: { share: 0.35, drift: 0.02 },
      ppe: 800000000, growth: 0.25, beta: 1.1, season: 'jobs', hire: 0.18, raise: 0.04, quit: 0.1,
      payout: 0.05, per: 45, pbr: 6.0, founders: 0.35, price: 22000
    },
    {
      id: 'dtrade', name: 'Dtrade', full: '株式会社Dtrade', en: 'Dtrade', rank: 'A', model: 'service', kind: '証券（投資機能の運営）',
      capital: 100000000, reserve: 100000000, retained: 45000000000,
      staff: 350, salary: 5000000, cost: 7500000,
      place: { name: 'データセンター・施設維持費', amount: 1200000000 }, rd: { name: '金融システム研究開発費', amount: 600000000 }, ads: 80000000,
      sales: 8500000000, op: 4000000000,
      streams: [
        { id: 'commission', name: '受入手数料', share: 0.7, cost: 0, beta: 1.8, noise: 0.15, player: ['trade'] },
        { id: 'finance', name: '金融収益', share: 0.3, cost: 0, beta: 0.5 }
      ],
      ppe: 3000000000, growth: 0.06, beta: 1.8, season: 'markets', hire: 0.04, raise: 0.03, quit: 0.06,
      payout: 0.5, per: 16, pbr: 1.2, founders: 0.25, price: 40000
    },
    {
      // A studio: the game makers (`makers` of the staff) work in `lines` of games, each a `team` share of them,
      // releasing one every `every` months, each `months` in the making; a game sells `base` in its life at the
      // line's usual budget with 72 points (a copy for `price`). 'live' lines run games for years (their makers'
      // pay is a cost of sales). `contract`: makers working for the partner. `catalog`: the older games' sales a
      // year, halving every `catalogHalf` years; `platform`: the cut the stores keep; `skill`: points it adds.
      id: 'riru', name: 'RIRU STUDIO', full: 'RIRU STUDIO株式会社', en: 'RIRU', rank: 'A', model: 'studio', kind: '開発スタジオ', listed: true,
      capital: 50000000, reserve: 50000000, retained: 10000000000,
      staff: 450, salary: 3000000, cost: 5000000, makers: 0.85,
      place: { name: 'スタジオ代', amount: 235000000 }, rd: { name: '研究開発費', amount: 250000000 }, other: 80000000,
      lines: [{ id: 'own', name: '自社タイトル', team: 0.75, every: 9, months: 27, base: 2000000000, price: 6800, scale: '大型' }],
      contract: { team: 0.25 },
      catalog: 150000000, catalogHalf: 3, platform: 0.3, skill: 3,
      ppe: 300000000, capex: 80000000, life: 5, beta: 1, season: 'games', hire: 0, raise: 0.03, quit: 0.09,
      payout: 0.2, per: 28, pbr: 1.4, depth: 40000000, founders: 0.15,
      partner: { with: 'ice', role: 'studio' }
    },
    {
      id: 'ice', name: 'Ice Smoker', full: 'ICE SMOKER株式会社', en: 'ICE SMOKER', rank: 'A', model: 'studio', kind: 'ゲーム開発・販売（業界最大手）', listed: true,
      capital: 45000000, reserve: 45000000, retained: 35000000000,
      staff: 1600, salary: 4200000, cost: 6500000, makers: 0.7,
      place: { name: 'スタジオ代', amount: 1200000000 }, rd: { name: '研究開発費', amount: 1500000000 }, ads: 600000000, other: 400000000,
      lines: [
        { id: 'aaa', name: '大型タイトル', team: 0.48, every: 12, months: 36, base: 12000000000, price: 9800, scale: 'AAA' },
        { id: 'mid', name: '中型タイトル', team: 0.27, every: 6, months: 18, base: 2600000000, price: 5800, scale: '中型' },
        { id: 'live', name: '運営型タイトル', team: 0.25, kind: 'live' }
      ],
      live: { titles: [{ name: 'ICE ONLINE', genre: 'MMORPG', sales: 2800000000 }, { name: 'Frost Arena', genre: '対戦アクション', sales: 2800000000 }], half: 4, server: 0.08 },
      license: 600000000,
      catalog: 3500000000, catalogHalf: 4, platform: 0.25, skill: 2,
      ppe: 2000000000, capex: 450000000, life: 5, beta: 1, season: 'games', hire: 0.015, raise: 0.025, quit: 0.06,
      payout: 0.35, per: 20, pbr: 1.6, depth: 150000000, founders: 0.1,
      // Ice Smoker backs RIRU STUDIO: the 業務委託 fee each month (RIRU's sales), the 開発援助金 changing month by
      // month (RIRU's 営業外収益), together `budget` a year; and it holds `stake` of RIRU's shares (持分法)
      partner: { with: 'riru', role: 'backer', budget: 900000000, fee: 45000000, support: [15000000, 60000000], stake: 0.2 }
    }
  ];
  function company(id) { for (var i = 0; i < COMPANIES.length; i++) if (COMPANIES[i].id === id) return COMPANIES[i]; return null; }

  /* ------------------------------------------------------------- the products --- */
  // What each car and Shop item is made of and how its price is shared (its price: js/game/config.js). `cost`: what
  // making one costs its maker (materials only); `buy`: what the seller pays for it (仕入れ価格) and `excl`: what the
  // maker adds on top through its own system (専売特別費用); the seller keeps the rest of the price (販売店側純利益,
  // before its own costs of selling). `npc`: how many customers outside the game buy one a year at the start. Every
  // car is MAGITA's: the only carmaker there is, so the dealer takes the terms it is given.
  var PRODUCTS = {
    // what selling one costs the seller (販売費): kept inside its books, never added to the price
    sell: { cars: 150000, items: 2500 },
    cars: {
      'mercedes-amg-one-white': { maker: 'magita', cost: 120000000, buy: 280000000, excl: 10000000, npc: 15 },
      'lamborghini-revuelto': { maker: 'magita', cost: 10000000, buy: 60000000, excl: 3000000, npc: 110 },
      'nissan-gt-r': { maker: 'magita', cost: 9000000, buy: 30000000, excl: 2000000, npc: 260 },
      'lamborghini-kuia-spyder': { maker: 'magita', cost: 5000000, buy: 17000000, excl: 13000000, npc: 90 },
      'lamborghini-urus': { maker: 'magita', cost: 6000000, buy: 29000000, excl: 11000000, npc: 110 },
      'lamborghini-aventador': { maker: 'magita', cost: 4000000, buy: 70000000, excl: 6000000, npc: 70 },
      'mercedes-benz-one': { maker: 'magita', cost: 10000000, buy: 42000000, excl: 1000000, npc: 140 },
      'ferrari-325': { maker: 'magita', cost: 3500000, buy: 30000000, excl: 2000000, npc: 90 },
      // (made from scrapped cars: MAGITA loses on each one, and lets the dealer earn well on it, on purpose)
      onvoro: { maker: 'magita', cost: 500000, buy: 200000, excl: 0, npc: 2800 },
      'blue-lightning': { maker: 'magita', cost: 3000000, buy: 30000000, excl: 3000000, npc: 100 }
    },
    items: {
      omamori: { maker: 'jinx', cost: 1000, npc: 50000 },
      'repair-kit': { maker: 'magita', cost: 10000, buy: 390000, excl: 10000, npc: 4000 },
      'car-oil-medium': { maker: 'magita', cost: 210000, buy: 400000, excl: 50000, npc: 3000 },
      'gasoline-full': { maker: 'magita', cost: 20000, buy: 24000, excl: 0, npc: 60000 },
      'engine-v1': { maker: 'magita', cost: 400000, buy: 2000000, excl: 400000, npc: 600 },
      'engine-v2': { maker: 'magita', cost: 600000, buy: 4500000, excl: 100000, npc: 300 },
      'engine-v3': { maker: 'magita', cost: 800000, buy: 7500000, excl: 400000, npc: 150 }
    }
  };

  /* --------------------------------------------------------------- the ties --- */
  // ビジネス友好度 (0〜100): how well two companies get on, where it starts and why. It moves with what passes between
  // them (trade, losses taken on the other's terms, support, loans paid back, a rival's gains) and drifts back to
  // where it began; and it changes the terms: MAGITA's rebates and how fast it wants paying, Ice Smoker's backing,
  // Tenesice's rate ('*': with every company).
  var TIES = [
    { a: 'magita', b: 'carowner', start: 35, why: 'MAGITAの独占供給・厳しい取引条件' },
    { a: 'magita', b: 'jinx', start: 50, why: 'CAR SHOPの車用品の供給' },
    { a: 'ice', b: 'riru', start: 90, why: '共同開発・業務委託・資本提携' },
    { a: 'citywork', b: 'speedeed', start: 20, why: '求人市場で競合' },
    { a: 'daizin', b: 'carowner', start: 60, why: 'VIP顧客への高級車の販売' },
    { a: 'jinx', b: 'carowner', start: 55, why: '車用品と整備の連携' },
    { a: 'dtrade', b: 'riru', start: 65, why: '株式の売買・株主事務' },
    { a: 'dtrade', b: 'ice', start: 65, why: '株式の売買・株主事務' },
    { a: 'tenesice', b: '*', start: 60, why: '取引銀行（預金・融資）' }
  ];

  // The players' money that comes to the companies (server/core/api.js: as it is spent): what kind, whose sale it
  // becomes. VIP is bought with ロイヤルコイン, each counted as `coin` $; the バイト's employers pay the job sites
  // `jobFee` of what the players are paid; the 投資's 0.6% fee is Dtrade's.
  var PLAYERS = { coin: 100000, jobFee: 0.15 };

  var GENRES = ['RPG', 'アクション', 'アクションRPG', 'シューター', 'アドベンチャー', 'ストラテジー', 'レース', 'スポーツ', '格闘', 'パズル', 'シミュレーション', 'ホラー', 'オープンワールド'];
  // a new game's name: one of each (a sequel of a hit keeps its name and a number)
  var NAMES = {
    jp: [['蒼穹', '紅蓮', '星海', '幻影', '鋼鉄', '黎明', '深淵', '白銀', '雷鳴', '夜想', '天空', '翠玉', '月影', '焔'],
      ['のアルカナ', 'クロニクル', 'レクイエム', 'ラビリンス', 'フロンティア', 'オデッセイ', 'サーガ', 'リバース', 'ブレイカー', 'エンブレム', 'の守護者', 'の旅路']],
    en: [['NEON', 'ECHO', 'ASTRA', 'IRON', 'VOID', 'NOVA', 'CRIMSON', 'SILENT', 'ROGUE', 'ZERO', 'HOLLOW', 'SOLAR'],
      ['DRIFT', 'PROTOCOL', 'HORIZON', 'LEGION', 'SIGNAL', 'REQUIEM', 'FRONTIER', 'RIFT', 'CROWN', 'TIDE', 'ORBIT', 'SHIFT']]
  };

  /* ------------------------------------------------------------- the lending --- */
  // Ranks: who lends at what. Tenesice is S (the bank itself); every company here is A, and borrows from it at
  // 0.8〜1.2% a year (the healthier its books, the lower). Money kept at the bank earns `deposit` a year, bonds
  // `bonds`. A company keeps `months` of its costs at hand: more goes into bonds, under `floor` months it sells
  // bonds, then borrows (in `unit`s, for `years`).
  var RANKS = { S: { name: 'S' }, A: { name: 'A', rate: [0.008, 0.012] } };
  var MONEY = { deposit: 0.002, bonds: 0.005, months: 6, floor: 2, unit: 50000000, years: 3 };

  /* --------------------------------------------------------------- the taxes --- */
  // As in Japan (a company in Tokyo), by its capital at the year's end: up to `small.capital` a 中小法人 (法人税
  // `small.low` on the first `small.lowUpTo` of the year's income, 事業税 by income alone, losses carried forward
  // set against all of a year's income), above it a 大法人 (事業税 partly by its size, 外形標準課税: `large.value`
  // of what it adds (pay, interest, rent and income) and `large.capital` of its capital; losses against only
  // `large.carryShare` of the income). 地方法人税 and 住民税 are shares of the 法人税; 特別法人事業税 a share of the
  // 事業税; the 均等割 a fixed sum a year by the capital (with the reserve) and the staff ([up to, ≤50, more]).
  // Losses are carried `carryYears` years. Half of last year's tax is paid in the year's `interimMonth`th month
  // (中間納付), the rest `finalMonths` months after its end; a year's 事業税 is a cost of the year it is paid in.
  var TAX = {
    corporate: 0.232, local: 0.103, inhabitant: 0.07,
    small: { capital: 100000000, low: 0.15, lowUpTo: 8000000, business: 0.07, special: 0.37 },
    large: { business: 0.01, special: 2.6, value: 0.012, capital: 0.005, carryShare: 0.5 },
    flat: [[10000000, 70000, 140000], [100000000, 180000, 200000], [1000000000, 290000, 530000], [5000000000, 950000, 2290000], [Infinity, 1210000, 3800000]],
    carryYears: 10,
    // dividends from a company one holds more than 5% of and at most a third: half of them are not taxed
    dividendExempt: 0.5,
    interimMonth: 8, finalMonths: 2
  };

  /* ------------------------------------------------------- the books' accounts --- */
  // code: [name, kind]; kinds: a asset, l liability, e equity (balances), r 売上高, c 売上原価, s 販管費,
  // ni 営業外収益, ne 営業外費用, xi 特別利益, xl 特別損失, t taxes. A company's own sales and costs of sales are
  // accounts of its own ('r:<stream>', 'c:<stream>'), named by its streams (studios: by these).
  var ACCOUNTS = {
    cash: ['現金及び預金', 'a'], ar: ['売掛金', 'a'], stock: ['商品・製品', 'a'], wip: ['仕掛品（開発中のゲーム）', 'a'],
    lent: ['貸出金', 'a'], ppe: ['有形固定資産', 'a'], content: ['コンテンツ資産', 'a'], bonds: ['投資有価証券', 'a'], affil: ['関係会社株式', 'a'],
    ap: ['買掛金・未払金', 'l'], accrued: ['未払費用', 'l'], bonus: ['賞与引当金', 'l'], taxdue: ['未払法人税等', 'l'], deposits: ['預金', 'l'], loan: ['借入金', 'l'],
    capital: ['資本金', 'e'], reserve: ['資本準備金', 'e'], othercap: ['その他資本剰余金', 'e'], legal: ['利益準備金', 'e'],
    retained: ['繰越利益剰余金', 'e'], treasury: ['自己株式', 'e'],
    'r:game': ['ゲーム売上', 'r'], 'r:live': ['運営型タイトル売上', 'r'], 'r:contract': ['受託開発売上', 'r'], 'r:license': ['ライセンス収入', 'r'],
    'c:platform': ['プラットフォーム手数料', 'c'], 'c:amort': ['コンテンツ償却費', 'c'], 'c:contract': ['受託開発原価', 'c'], 'c:live': ['運営費', 'c'],
    'c:materials': ['材料費', 'c'], 'c:factory': ['製造労務費', 'c'], 'c:plant': ['製造経費', 'c'], 'c:rebate': ['販売奨励金', 'c'],
    sSalary: ['給料手当', 's'], sBonus: ['賞与', 's'], sWelfare: ['法定福利費・福利厚生費', 's'], sPlace: ['地代家賃・施設維持費', 's'],
    sRd: ['研究開発費', 's'], sAds: ['広告宣伝費', 's'], sSelling: ['販売費', 's'], sPartner: ['開発援助・業務委託費', 's'], sCredit: ['与信関係費用', 's'], sDepr: ['減価償却費', 's'], sOther: ['その他', 's'],
    nInterest: ['受取利息', 'ni'], nDividend: ['受取配当金', 'ni'], nSupport: ['受取援助金', 'ni'], nEquity: ['持分法による投資利益', 'ni'], nOther: ['雑収入', 'ni'],
    eInterest: ['支払利息', 'ne'], eEquity: ['持分法による投資損失', 'ne'], eOther: ['雑損失', 'ne'],
    xGain: ['固定資産売却益', 'xi'], xImpair: ['コンテンツ評価損', 'xl'], xCancel: ['開発中止損失', 'xl'],
    tax: ['法人税、住民税及び事業税', 't']
  };
  // an account's name and kind for a company (its own sales and costs by its streams; its place and research by their names)
  function account(code, c) {
    if (c) {
      if (code === 'sPlace' && c.place) return [c.place.name, 's'];
      if (code === 'sRd' && c.rd) return [c.rd.name, 's'];
      var m = /^([rc]):(.+)$/.exec(code);
      if (m && c.streams) for (var i = 0; i < c.streams.length; i++) if (c.streams[i].id === m[2]) return [m[1] === 'r' ? c.streams[i].name : c.streams[i].name + 'の原価', m[1]];
    }
    var a = ACCOUNTS[code] || SEEN[code];
    if (a) return a;
    a = code.indexOf('cf:') === 0 ? [code, 'cf'] : [code, /^r:/.test(code) ? 'r' : /^c:/.test(code) ? 'c' : 's'];
    SEEN[code] = a;
    return a;
  }
  var SEEN = {};
  // the 損益計算書: each line, the kinds of accounts it adds up, and the totals between them
  var PL = [
    { id: 'sales', name: '売上高', kinds: ['r'] },
    { id: 'cogs', name: '売上原価', kinds: ['c'] },
    { id: 'gross', name: '売上総利益（粗利）', total: [['sales', 1], ['cogs', -1]] },
    { id: 'sga', name: '販売費及び一般管理費', kinds: ['s'] },
    { id: 'op', name: '営業利益', total: [['gross', 1], ['sga', -1]] },
    { id: 'noi', name: '営業外収益', kinds: ['ni'] },
    { id: 'noe', name: '営業外費用', kinds: ['ne'] },
    { id: 'ord', name: '経常利益', total: [['op', 1], ['noi', 1], ['noe', -1]] },
    { id: 'xi', name: '特別利益', kinds: ['xi'] },
    { id: 'xl', name: '特別損失', kinds: ['xl'] },
    { id: 'pretax', name: '税引前当期純利益', total: [['ord', 1], ['xi', 1], ['xl', -1]] },
    { id: 'tax', name: '法人税、住民税及び事業税', kinds: ['t'] },
    { id: 'net', name: '当期純利益', total: [['pretax', 1], ['tax', -1]] }
  ];
  // the 貸借対照表's groups
  var BS = [
    { id: 'current', name: '流動資産', side: 'a', accounts: ['cash', 'ar', 'stock', 'wip'] },
    { id: 'fixed', name: '固定資産', side: 'a', accounts: ['lent', 'ppe', 'content', 'bonds', 'affil'] },
    { id: 'currentL', name: '流動負債', side: 'l', accounts: ['deposits', 'ap', 'accrued', 'bonus', 'taxdue'] },
    { id: 'fixedL', name: '固定負債', side: 'l', accounts: ['loan'] },
    { id: 'equity', name: '純資産', side: 'e', accounts: ['capital', 'reserve', 'othercap', 'legal', 'retained', 'treasury'] }
  ];
  // the キャッシュ・フロー計算書 (直接法): where each movement of cash goes
  var CF = [
    { id: 'op', name: '営業活動によるキャッシュ・フロー', lines: [['receipts', '営業収入'], ['purchases', '仕入れによる支出'], ['payroll', '人件費の支出'],
      ['expenses', 'その他の営業支出'], ['support', '援助金の受取額'], ['interestIn', '利息及び配当金の受取額'], ['interestOut', '利息の支払額'], ['taxes', '法人税等の支払額']] },
    { id: 'inv', name: '投資活動によるキャッシュ・フロー', lines: [['capex', '有形固定資産の取得による支出'], ['bondsBuy', '投資有価証券の取得による支出'],
      ['bondsSell', '投資有価証券の売却による収入'], ['lending', '貸出金の増減']] },
    { id: 'fin', name: '財務活動によるキャッシュ・フロー', lines: [['issue', '株式の発行による収入'], ['treasurySale', '自己株式の処分による収入'],
      ['buyback', '自己株式の取得による支出'], ['borrow', '借入れによる収入'], ['repay', '借入金の返済による支出'], ['deposits', '預金の増減'], ['dividends', '配当金の支払額']] }
  ];

  // a P/L from a period's sums by account ({ code: $ }): each line's total
  function plOf(sums) {
    var out = {};
    PL.forEach(function (line) {
      var n = 0;
      if (line.total) line.total.forEach(function (t) { n += out[t[0]] * t[1]; });
      else Object.keys(sums).forEach(function (code) { if (code.indexOf('cf:') !== 0 && line.kinds.indexOf(account(code)[1]) >= 0) n += sums[code]; });
      out[line.id] = n;
    });
    return out;
  }

  /* ---------------------------------------------------------------- showing --- */
  function group(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  // $ shortly: $1.23T, $28.04B, $235.0M, $12,345 (a loss with a minus)
  function money(n) {
    var a = Math.abs(n), s = n < 0 ? '−$' : '$';
    if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e11 ? 1 : 2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    return s + group(a);
  }
  // a statement's figure in millions (百万ドル), a loss with △ as Japanese statements write it
  function mil(n) { var m = Math.round(n / 1e6); return (m < 0 ? '△' : '') + group(m); }
  function pct(x, digits) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(digits === undefined ? 1 : digits) + '%'; }

  BR.CORP = {
    DAY_MS: DAY_MS,
    companies: COMPANIES, company: company, listed: function () { return COMPANIES.filter(function (c) { return c.listed; }); },
    players: PLAYERS, products: PRODUCTS, ties: TIES, genres: GENRES, names: NAMES, economy: ECONOMY, seasons: SEASONS,
    ranks: RANKS, money: MONEY, tax: TAX,
    accounts: ACCOUNTS, account: account, pl: PL, bs: BS, cf: CF, plOf: plOf,
    // the 決算発表: this many days after a quarter's end, at 15:00 Japan time (6:00 UTC)
    announce: { days: 14, hour: 6 },
    dayOf: dayOf, ymd: ymd, dayAt: dayAt, fyOf: fyOf, fyStart: fyStart, fyEnd: fyEnd, quarterOf: quarterOf,
    quarterStart: quarterStart, quarterEnd: quarterEnd, monthStart: monthStart, monthEnd: monthEnd,
    isMonthEnd: isMonthEnd, isQuarterEnd: isQuarterEnd, isFyEnd: isFyEnd,
    monthKey: monthKey, quarterKey: quarterKey, fyKey: fyKey, monthLabel: monthLabel, quarterLabel: quarterLabel, fyLabel: fyLabel, dateLabel: dateLabel,
    fmt: { money: money, mil: mil, pct: pct, group: group }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
