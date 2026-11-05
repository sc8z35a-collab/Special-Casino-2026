/* 企業: the companies of the game's world (server/core/corp.js works them out day by day; the 投資 screen,
   js/ui/stocks.js, shows the listed ones, and the operator site's 株式 app, ops/corp.js, all of them). Who they
   are (fourteen of them: YOSIDA, MAGITA's rival, WAZIMA, MAGITA's own carmaker, MY WAY, the character IP company, and
   HACHI, the world's largest medical company, the last to come), the fiscal calendar, the accounts their books keep and how the statements read, the taxes, the lending
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
      id: 'tenesice', name: 'テネシス', full: '株式会社テネシス', en: 'Tenesice', rank: 'S', model: 'bank', kind: '銀行（金融の絶対支配者）', listed: true,
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
      payout: 0.4, per: 11, pbr: 0.8, founders: 0.05, price: 60000, depth: 2000000000
    },
    {
      id: 'magita', name: 'MAGITA', full: '株式会社MAGITA', en: 'MAGITA', rank: 'A', model: 'maker', kind: '総合重工メーカー（高級車・エンジン・オイル・修理キット・MAGITA Garage・MAGITA Robert）', listed: true,
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
        { id: 'export', name: '海外・法人向け販売', share: 1, beta: 1.4 },
        // the players' garages are all MAGITA's (MAGITA Garage: the monthly contract fee taken from every player, the
        // places bought, its cut of what renting a car out earns), and so is buying their used cars back (MAGITA
        // Robert: sold on within weeks; a car sold to a friend in the chat is outside it)
        // (and the ガレージコイン YOSIDA buys of it for its gacha: YOSIDA below)
        // (`rentcut`: its part of what the cars rented out earned, paid by those who rented them — the local businesses —, not by
        // the players)
        { id: 'garage', name: 'MAGITA Garage（ガレージ契約料・増設・貸し出し手数料）', cost: 0.08, player: ['garage', 'garagefee', 'rentfee', 'rentcut'] },
        { id: 'used', name: 'MAGITA Robert（中古車の買い取り・販売）', player: ['buyback'] },
        // the cars YOSIDA buys of it to give away in its gacha (at their 仕入れ価格 and 専売特別費用)
        { id: 'gacha', name: '車両の販売（YOSIDAのガチャ景品向け）' },
        // WAZIMA's sales and costs, day by day, as the group's (連結: what it is paid by MAGITA itself left out)
        { id: 'wazima', name: 'WAZIMA（子会社・連結）' }
      ],
      // its own carmaker abroad, WAZIMA (WAZIMA below): what it pays it for the joint development (a share of its
      // research), and what WAZIMA earns, each month its own (子会社からの受取配当金)
      children: ['wazima'],
      materials: true, factory: 0.7, inventoryDays: 45,
      ppe: 60000000000, growth: 0.03, beta: 1.4, season: 'flat', hire: 0.02, raise: 0.025, quit: 0.05,
      payout: 0.3, per: 13, pbr: 0.9, founders: 0.12, price: 18000, depth: 400000000
    },
    {
      id: 'carowner', name: 'カーオーナー', full: '株式会社カーオーナー', en: 'CAR OWNER', rank: 'A', model: 'dealer', kind: '自動車販売（MAGITA・YOSHIDAのディーラー）', listed: true,
      capital: 500000000, reserve: 500000000, retained: 25000000000,
      staff: 2500, salary: 2800000, cost: 4000000,
      place: { name: '大型ショールーム・店舗維持費', amount: 2200000000 }, rd: { name: '販売管理システム開発費', amount: 150000000 }, ads: 1200000000,
      // (the profile's numbers are where it starts, found from what it sells: with YOSHIDA's cars — some 9,800 more a
      // year, cheap and wanted, and far more of their price its own — its sales and profit grew well past the $65B and
      // $2.5B it had with MAGITA's alone: what the cars leave it after their 仕入れ価格, less its people and its shops)
      sales: 118000000000, op: 18700000000,
      // the cars (each model's customers a year: products, each maker's swinging with the economy its own way: MAKERS),
      // the used cars it still has from before MAGITA Robert, and the rest of its trade (its share of the sales and
      // its cost found so that it makes its 営業利益: flex). It sells both makers' cars: in good times MAGITA's, in bad
      // ones YOSHIDA's, so it earns either way.
      streams: [
        { id: 'cars', name: '新車販売', products: 'cars', from: ['magita', 'yosida'], beta: 0.4, player: ['car'] },
        { id: 'used', name: '中古車販売（MAGITA Robert以前の在庫）' },
        { id: 'service', name: '整備・保険', flex: true, beta: 0.5 }
      ],
      inventoryDays: 40,
      ppe: 8000000000, growth: 0.03, beta: 0.4, season: 'cars', hire: 0.02, raise: 0.02, quit: 0.08,
      payout: 0.3, per: 12, pbr: 0.8, founders: 0.2, price: 9000, depth: 200000000
    },
    {
      // MAGITA's rival: cheap cars and efficient engines, made from end to end in its own plants. Its customers are
      // those who save: when times are bad they come to it (its sales follow the economy the other way: a
      // defensive stock), when good they go to MAGITA. No 専売特別費用: it is not big enough to ask for one. Its home
      // is in the country (リヴィエール区: its people are citizens), and what it sells abroad (`abroad` on a stream:
      // its cars and engines abroad, its money tree seeds) goes on once the country lives, money coming into it.
      id: 'yosida', name: 'YOSIDA', full: '株式会社YOSIDA', en: 'YOSIDA', rank: 'A', model: 'maker', kind: '自動車メーカー（大衆車・高効率エンジン、MAGITAのライバル）・クエスト・ガチャ・金の生る木の事業を独占', listed: true,
      capital: 1200000000, reserve: 1200000000, retained: 35000000000,
      staff: 4500, salary: 2400000, cost: 3800000,
      place: { name: '自社一貫工場・製造ライン維持費', amount: 6500000000 }, rd: { name: '車両・エンジン実用開発費', amount: 1700000000 },
      // (its sales and profit found from what it costs: 4,500 people at $3.8M, its plants and research are $25.3B a
      // year, its cars and engines cost it about 62% of what it sells them for, so $95B of sales leave it about $6B;
      // its biotech and its businesses in the game come on top: YOSIDA below)
      sales: 95000000000, op: 6000000000,
      streams: [
        { id: 'dealer', name: '車両の卸売（カーオーナー向け）', to: 'carowner' },
        { id: 'retail', name: 'エンジンの卸売（ジンクス向け）', to: 'jinx' },
        { id: 'export', name: '海外・法人向け販売', share: 1, beta: -0.5, abroad: true },
        // the money tree seeds it ships to the market abroad each month (YOSIDA.seeds)
        { id: 'seeds', name: '金の生る木の種の出荷（バイオテクノロジー）', seeds: true, abroad: true },
        // the game's quests, gacha and money trees, all its own: what the players pay, the fee on the quests' rewards,
        // what it bills the country for the gacha (YOSIDA below), and its own cars given away in it (a sale of its cars)
        { id: 'quest', name: 'クエスト事業（報酬の手数料）', player: ['questfee'] },
        { id: 'gacha', name: 'ガチャ事業', player: ['gacha'] },
        { id: 'claim', name: 'ガチャ代の国への請求（国庫）' },
        { id: 'tree', name: '金の生る木事業（肥料・木の市場）', player: ['fertilizer'] },
        { id: 'gachacar', name: '自社車の販売（ガチャ景品向け・社内）' }
      ],
      materials: true, factory: 0.75, inventoryDays: 30,
      ppe: 20000000000, growth: 0.03, beta: -0.5, season: 'cars', hire: 0.02, raise: 0.02, quit: 0.05,
      payout: 0.35, per: 11, pbr: 0.9, founders: 0.15, price: 12000, depth: 300000000
    },
    {
      // Once the world's third carmaker (after YOSHIDA), now all MAGITA's (`parent`): it makes MAGITA's cars for the
      // markets abroad (its sales: `export`, going on once the country lives), develops them with MAGITA (paid a share
      // of MAGITA's research), and researches how to cut what MAGITA spends besides its materials (WAZIMA below). Its
      // home is in the country (アイゼン区, beside MAGITA: its people are citizens); its sales and its profit are on
      // MAGITA's books (連結), its profit paid up each month (no dividends of its own: `payout` 0).
      id: 'wazima', name: 'WAZIMA', full: '株式会社WAZIMA', en: 'WAZIMA', rank: 'A', model: 'maker', kind: '自動車メーカー（MAGITAの完全子会社：MAGITA車の製造・共同開発・原料以外のコスト削減研究）', parent: 'magita',
      capital: 800000000, reserve: 800000000, retained: 22000000000,
      staff: 2250, salary: 2900000, cost: 4300000,
      place: { name: '省人化工場・高効率ライン維持費', amount: 2400000000 }, rd: { name: '生産技術・コスト削減研究開発費', amount: 1800000000 },
      // (2,250 people at $4.3M, its lines and research are $13.9B a year: its $24B of cars made for MAGITA leave it
      // about $2.4B, the joint development's fee on top)
      sales: 24000000000, op: 2400000000,
      streams: [
        { id: 'export', name: 'MAGITA車の受託製造（海外市場向け）', share: 1, beta: 1.2, abroad: true },
        { id: 'codev', name: '共同開発（MAGITA向け）' },
        // (what MIZUKAWA orders of its engineers, out of its research: corp-mizukawa.js)
        { id: 'mzorder', name: 'MIZUKAWAからの研究受託' }
      ],
      materials: true, factory: 0.8, inventoryDays: 30,
      ppe: 12000000000, growth: 0.03, beta: 1.2, season: 'cars', hire: 0.01, raise: 0.02, quit: 0.04,
      payout: 0, per: 10, pbr: 0.8, founders: 0, price: 10000
    },
    {
      id: 'jinx', name: 'ジンクス', full: '株式会社ジンクス', en: 'JINX', rank: 'A', model: 'retail', kind: 'ショップ（SHOPの運営・管理）',
      capital: 300000000, reserve: 300000000, retained: 18000000000,
      staff: 3000, salary: 2200000, cost: 3200000,
      place: { name: '店舗網・巨大倉庫維持費', amount: 1800000000 }, rd: { name: '流通・PB商品開発費', amount: 200000000 }, ads: 900000000,
      // (with YOSHIDA's engines on its shelves, some $9.6B more a year and $3.2B of it its own: past the $50B and $2B
      // it began with)
      sales: 59500000000, op: 5200000000,
      // the Shop's items (its own セーフティースロット, and MAGITA's car items bought from it: products), and the rest
      // of its trade (flex, as the dealer's)
      streams: [
        { id: 'items', name: 'SHOP商品売上', products: 'items', from: ['magita', 'yosida'], beta: 0.9, player: ['shop'] },
        { id: 'goods', name: '一般商品売上', flex: true, beta: 0.5 }
      ],
      inventoryDays: 30,
      ppe: 6000000000, growth: 0.02, beta: 0.6, season: 'retail', hire: 0.015, raise: 0.02, quit: 0.12,
      payout: 0.35, per: 14, pbr: 1.0, founders: 0.15, price: 7000
    },
    {
      id: 'daizin', name: 'DAIZIN', full: '株式会社DAIZIN', en: 'DAIZIN', rank: 'A', model: 'service', kind: 'VIPサービス（VIP機能の運営・管理・ロイヤルコインの買い取り）',
      capital: 200000000, reserve: 200000000, retained: 15000000000,
      staff: 400, salary: 5500000, cost: 8000000,
      place: { name: '最高級VIPラウンジ・専用施設維持費', amount: 2500000000 }, rd: { name: '独自VIPサービス企画開発費', amount: 300000000 },
      sales: 12000000000, op: 3500000000,
      streams: [
        { id: 'members', name: 'VIP会員収入', share: 0.7, cost: 0.12, beta: 1.1, player: ['vip'] },
        { id: 'lounge', name: 'ラウンジ・専用サービス収入', share: 0.3, cost: 0.3, beta: 1.4 },
        // the ロイヤルコイン and VIP1週間券 YOSIDA buys of it for its gacha (YOSIDA below)
        { id: 'coins', name: 'ロイヤルコイン・VIP1週間券の販売（YOSIDA向け）' }
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
      // the casino (the slots it runs) and the 投資's trading: the players' lost bets and its fees come to it
      id: 'dtrade', name: 'Dtrade', full: '株式会社Dtrade', en: 'Dtrade', rank: 'A', model: 'service', kind: '投資会社（カジノスロット・投資機能の運営）',
      capital: 500000000, reserve: 500000000, retained: 90000000000,
      staff: 400, salary: 5500000, cost: 8000000,
      place: { name: 'データセンター・施設維持費', amount: 2500000000 }, rd: { name: '金融システム研究開発費', amount: 1200000000 }, ads: 100000000,
      sales: 18000000000, op: 11000000000,
      streams: [
        { id: 'casino', name: 'カジノ収入（スロット）', share: 0.55, cost: 0, beta: 1.2, noise: 0.1, player: ['casino', 'winfee', 'slotfee', 'exchange'] },
        { id: 'commission', name: '受入手数料（投資）', share: 0.3, cost: 0, beta: 1.8, noise: 0.15, player: ['trade'] },
        { id: 'finance', name: '金融収益', share: 0.15, cost: 0, beta: 0.5 }
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
    },
    {
      // The world's biggest character IP company: no factory of its own — ジンクス makes and sells its plush toys, MAGITA
      // its special cars and engines (sold at Car Owner), Ice Smoker and RIRU STUDIO make games of its characters,
      // Tenesice has them as its face and Dtrade dresses its slots in them each winter — and every one of them pays it
      // a yearly IP fee (`license` streams: MYWAY below), its 直営ショールーム selling the rest. Its people are its
      // fortune: 1,250 of them on the best pay in the world (a general employee's $7.5M base and $200K a month on top,
      // $500K for each idea taken up; its 社長 $650M, its CEO $450M — js/game/npc.js), $16.3M a head with the care
      // it takes of them, which it cannot cut when times turn. It keeps little: 56% of its profit is paid out. Its home
      // is in オーロラ区 (its studio), its showroom in カナリア区. It can fail, the first company that ever has (MYWAY).
      // (its numbers at the start: 1,250 × $16.3M, its studio and licences $325M and its new characters $900M a year
      // against $45B of sales leave $23.4B, 52%; after tax $16.38B, $9.17B of it paid out, $7.21B kept)
      id: 'myway', name: 'MY WAY', full: '株式会社MY WAY', en: 'MY WAY', rank: 'A', model: 'service', kind: 'キャラクターIP企業（ぬいぐるみ・特別仕様車・ゲーム・看板キャラ・スロット外装のライセンス）', listed: true,
      capital: 2000000000, reserve: 0, retained: 25200000000,
      staff: 1250, salary: 13000000, cost: 16300000,
      place: { name: 'デザインスタジオ維持・ライセンス管理費', amount: 325000000 }, rd: { name: '新規キャラクター・特別仕様エンジン等開発費', amount: 900000000 },
      sales: 45000000000, op: 23400000000,
      streams: [
        { id: 'jinx', name: 'ジンクス（ぬいぐるみ・限定キャラグッズのライセンス）', license: true },
        { id: 'magita', name: 'MAGITA（特別仕様車・特別仕様エンジンの共同開発）', license: true },
        { id: 'carowner', name: 'カーオーナー（オリキャラデザイン車の販売ライセンス）', license: true },
        { id: 'ice', name: 'ICE SMOKER（世界1位ゲームへのIP使用権許諾・コラボ）', license: true },
        { id: 'tenesice', name: 'テネシス（公式看板キャラクターの独占契約）', license: true },
        { id: 'dtrade', name: 'Dtrade（カジノスロットの冬仕様外装・季節限定スキン）', license: true },
        { id: 'riru', name: 'RIRUスタジオ（新興ゲームへのIP使用権許諾・コラボ）', license: true },
        // (from 2026-11-03 every one of the thirteen is its partner, and the local companies and both countries may be)
        { id: 'yosida', name: 'YOSIDA（コラボ車 S6 WAY・限定ラッピング車）', license: true },
        { id: 'wazima', name: 'WAZIMA（キャラクターデザイン部品・工場見学ツアー）', license: true },
        { id: 'daizin', name: 'DAIZIN（VIPラウンジのキャラクター空間・限定ロイヤルコイン）', license: true },
        { id: 'citywork', name: 'シティーワーク（求人サイトの公式キャラクター）', license: true },
        { id: 'speedeed', name: 'スピーディード（バイトアプリの公式キャラクター）', license: true },
        { id: 'ipLocal', name: '地元企業32社とのIP契約', license: true },
        { id: 'ipNation', name: 'ヴェルノア国とのIP契約（国の公式キャラクター）', license: true },
        { id: 'ipAsuka', name: 'アスカ国とのIP契約（国の公式キャラクター）', license: true },
        // (MIZUKAWA, from its founding to 2027-01-01: its first collaboration car River W Feat., the profit 5:5)
        { id: 'mizukawa', name: 'MIZUKAWA（コラボ特別仕様車 River W Feat.：利益5:5）', license: true },
        // (the collaboration cars: MAGITA's and YOSHIDA's share of their profit to MY WAY — PRODUCTS.cars `collab`)
        { id: 'collabCars', name: 'コラボ車の利益配分（MAGITA 4:6・YOSHIDA 3:7）', license: true },
        { id: 'direct', name: '直営ショールーム・その他（旗艦店での直販・他社ライセンス）', share: 2500000000 / 45000000000, cost: 0, beta: 1.1 },
        // the players' profile icons (アイコン) bought in the game: its characters' (the price, all of it)
        { id: 'icons', name: 'アイコンの販売（プレイヤー）', player: ['icons'] }
      ],
      ppe: 1500000000, growth: 0.03, beta: 1.1, season: 'luxury', hire: 0.02, raise: 0.02, quit: 0.02,
      payout: 0.56, per: 24, pbr: 6, founders: 0.3, price: 50000, depth: 600000000
    },
    {
      // The world's largest medical company, the fourteenth (HACHI below): its wards in both countries — HACHI ○○区
      // 第○病院 — see almost every patient (診察・薬・入院・手術・リハビリ・健診) at fixed fees, and it buys and gives
      // the medicines itself. Founded on 2026-11-04 (`founded`: no made-up past — its books begin that day), its 利益剰余金
      // the treasury's $20B once (`retained`), Tenesice's loan that day. Its people here (`staff`): ヴェルノア's wards'
      // medical staff, its 経営陣 and its researchers (アスカ国's wards' are paid there, through its branches) — at the
      // pay it starts them on (`salary`: their average a year — $5M, $6M and $10M a month —), a 15% more each costing it.
      id: 'hachi', name: 'HACHI', full: '株式会社HACHI', en: 'HACHI', rank: 'S', model: 'service', kind: '医療（病棟の運営・薬の調達と提供：世界1位の規模）', listed: true,
      founded: [2026, 11, 4],
      capital: 0, reserve: 0, retained: 20000000000,
      staff: 1875, salary: 79200000, cost: 91080000,
      // (its wards' land and 管理費, its research with アスカ国 and the medicines' raw materials: HACHI below, booked as
      // they go — not a budget of a year)
      place: { name: '病棟の土地代・管理費', amount: 0 }, rd: { name: '薬・サービス・医療機器の研究（アスカ国との共同研究）', amount: 0 },
      sales: 1800000000000, op: 700000000000,
      // (its patients are the countries' people: what they pay is all its sales once the country lives — `alone`: each
      // service's share of `sales` in a company system without the country, as the others' `share`)
      streams: [
        { id: 'checkup', name: '定期検診（全国民の月1回の義務）', cost: 0.03, alone: 0.25 },
        { id: 'consult', name: '診察', cost: 0.03, alone: 0.2 },
        { id: 'medicine', name: '薬の提供（原材料はアスカ国から）', cost: 0.3, alone: 0.25 },
        { id: 'inpatient', name: '入院', cost: 0.15, alone: 0.15 },
        { id: 'surgery', name: '手術', cost: 0.12, alone: 0.1 },
        { id: 'rehab', name: 'リハビリ', cost: 0.03, alone: 0.05 },
        // (the 医療税: six tenths of it HACHI's, the state's the rest — CORP.hachi.tax —, once the country lives)
        { id: 'tax', name: '医療税の配分（6割）', cost: 0 }
      ],
      ppe: 0, growth: 0, beta: 0.2, season: 'flat', hire: 0, raise: 0.02, quit: 0.03,
      payout: 0.3, per: 14, pbr: 2, founders: 0.2, price: 80000, depth: 3000000000
    },
    {
      // The world's third carmaker (after MAGITA and YOSHIDA; WAZIMA the last), the fifteenth — アスカ国籍: its home,
      // its people, its taxes, its land and its materials アスカ国's (MIZUKAWA below). Founded on 2026-11-05 with $38B
      // of アスカ国's treasury once (`retained`). It sells at its own dealers only, MIZUKAWA GARAGE — the one carmaker
      // not selling through Car Owner or ジンクス —, its cars dear (its research is the dearest of the four) and made on
      // its own HIGA production lines (the cheapest to make); and it earns on its technology: its production lines'
      // (70% of the world's, WAZIMA the rest) of MAGITA and WAZIMA, its cars' of YOSHIDA. Its people (`staff`) at the pay
      // they start on (`salary`: their average a year) — all of it the economy's and its business's (MIZUKAWA.pay).
      // Not listed (アスカ国 has no market): it pays no dividend, everything it earns beyond its people goes into research.
      id: 'mizukawa', name: 'MIZUKAWA', full: 'MIZUKAWA Motors株式会社', en: 'MIZUKAWA MOTORS', rank: 'A', model: 'maker', nation: 'asuka',
      kind: '自動車メーカー（アスカ国籍：高級車・炎神エンジン・HIGA製造ライン・MIZUKAWA GARAGE・製造ライン技術の提供）', listed: false,
      founded: [2026, 11, 5],
      capital: 0, reserve: 0, retained: 38000000000,
      staff: 2300, salary: 42521739, cost: 48900000,
      place: { name: '製造工場・本社ビルの土地代・管理費', amount: 0 }, rd: { name: '研究開発費（研究開発員の給与・他社への発注・技術資産）', amount: 0 },
      sales: 160000000000, op: 25000000000,
      // (its own cars and engines, sold at MIZUKAWA GARAGE to the people of both countries and to the players — `own`:
      // its products alone —; its technology's fees; WAZIMA's books once it is its, and the businesses it took over)
      // (`alone`: each one's share of `sales` in a company system without the country)
      streams: [
        { id: 'cars', name: 'MIZUKAWA GARAGE（新車販売）', products: 'cars', own: true, player: ['car'], alone: 0.72 },
        { id: 'engines', name: 'MIZUKAWA GARAGE（エンジン販売）', products: 'items', own: true, player: ['shop'], alone: 0.12 },
        { id: 'linetech', name: '製造ライン技術提供料（MAGITA・WAZIMA）', alone: 0.1 },
        { id: 'cartech', name: '車技術提供料（YOSHIDA）', alone: 0.06 },
        { id: 'wazima', name: 'WAZIMA（子会社・連結：買収後）' },
        { id: 'locals', name: '取得した事業（旧MAGITA経済圏の4社）' }
      ],
      inventoryDays: 30,
      ppe: 0, growth: 0.05, beta: 1.6, season: 'cars', hire: 0, raise: 0, quit: 0.03,
      payout: 0, per: 16, pbr: 1.6, founders: 0, price: 10000
    }
  ];
  function company(id) { for (var i = 0; i < COMPANIES.length; i++) if (COMPANIES[i].id === id) return COMPANIES[i]; return null; }

  /* ---------------------------------------------------------------- HACHI --- */
  // HACHI's rules (server/core/corp-hachi.js its books, server/core/hachi.js its wards and its patients). Every number
  // is where it starts.
  // - `seed`: its 利益剰余金, the treasury's once, the day it is founded; Tenesice's loan that day `loan.months` of its
  //   costs at `loan.rate` (kept for `loan.years`: not paid back early), its line `loan.line` months — 非常に友好的
  // - `fees`: a visit's, fixed (100%負担の額: what the patient pays without insurance) — a 診察, a medicine, a
  //   リハビリ each; a day in a bed (`inpatient`); an operation (always a success: healthy after it); the monthly 定期検診
  // - `minutes`: how long each takes; `cap`: what a ward does at once at most (診察 400 — the checkups among them —,
  //   beds 800, operations 20, リハビリ 100), less when its people are fewer than `perWard` of the medical staff
  // - `wards`: 5 in ヴェルノア (one a district) and 15 in アスカ国 (three a district) at the start; between `min` and
  //   `max` in all as it does; `state` under the state's care; each `land` and `admin` a month (both countries alike);
  //   `open` what a new one costs (its equipment from FIGMA)
  // - `staff` at the start in a full world (its medical staff by wards: `medical` ÷ the 20 wards = `perWard`, 175 a ward,
  //   the standard: a ward with fewer does as much less of everything — its desks, beds, operations and リハビリ — in
  //   proportion; it takes on that many for each ward it has, as far as it is not cutting), `pay` a month each
  // - `equipment`: what FIGMA's equipment and its upkeep cost a ward a month; `research`: what it puts into the joint
  //   research with アスカ国 of what it made beyond `cushion` months of its costs — done by FIGMA (アスカ国 giving its
  //   raw materials): its equipment and its research both FIGMA's sales, and アスカ国's own medical research budget
  //   buys `figmaRatio` times that of it (4 : 6)
  // - `loan.credit`: Tenesice's special line (非常に友好的): short of `credit` days of its costs at hand any day — more
  //   going out than its windows take in —, it is lent at once at `loan.rate` as far as `loan.line` months of its costs
  // - `tax`: the 医療税 of both countries (of everyone's pay and every company's profit), `hachi` of it HACHI's — paid it
  //   day by day as it comes in —, the rest its country's
  // - `cut`: who goes first when it must cut (経営難): researchers, the 経営陣, the medical staff last
  // - `buyout`: its failure — アスカ国 alone buys the whole business at `mult` times its market value (no one else may
  //   take it over), paid out to its 社長, its people and FIGMA's (関連社員) by these shares; then the state runs it:
  //   no one let go, `wards.state` wards, no land rent (the state's)
  // - `myway`: MY WAY's characters for its 定期検診 advertising and its name (`years` a contract, then renewed, cut
  //   or talked over; on under the state too), `lift` more of the people keeping their checkups while it is on
  var HACHI = {
    founded: [2026, 11, 4],
    seed: 20000000000,
    loan: { months: 3, rate: 0.006, years: 10, line: 12, credit: 15 },
    fees: { checkup: 700000, consult: 850000, medicine: 850000, rehab: 850000, inpatient: 500000, surgery: 3000000 },
    minutes: { checkup: 30, consult: 25, surgery: 10, rehab: 60 },
    cap: { consult: 400, inpatient: 800, surgery: 20, rehab: 100 },
    wards: { vernoa: 5, asuka: 15, min: 7, max: 45, state: 20, land: 35000000, admin: 600000000, open: 2000000000 },
    staff: { medical: 3500, exec: 500, research: 500 }, perWard: 175,
    pay: { medical: 5000000, exec: 6000000, research: 10000000 },
    tax: { hachi: 0.6, state: 0.4 },
    burden: 1.15,
    equipment: 1200000000, figmaRatio: 1.5,
    research: { share: 0.5, cushion: 6 },
    cut: ['research', 'exec', 'medical'],
    buyout: { mult: 2, ceo: 0.2, staff: 0.5, related: 0.3 },
    myway: { years: 5, lift: 0.06 },
    // a ward's review each month (its 経営陣's): its patients a ward against `perWard` of everyone's visits (a ward's
    // share of both countries' people, a visit and a tenth each a month) — `busy` times that and making money, one more
    // where they are most; under `quiet` times that, or two months in the red, one fewer (never below `min`)
    review: { busy: 1.15, quiet: 0.5, visits: 1.1 },
    // (the job sites' 30% of a hire's first year, on its pay only as far as this: a medical professional's first year
    // beyond it is not theirs to take)
    placementCap: 39000000
  };
  /* ------------------------------------------------------------- MIZUKAWA --- */
  // MIZUKAWA Motors' rules (server/core/corp-mizukawa.js its books, server/core/asuka.js its people). Every number is
  // where it starts; its people, their pay and its prices all move with the economy and with how it does.
  // - `seed`: its 利益剰余金, アスカ国's treasury's once, the day it is founded
  // - `roles`: its people in アスカ国 (研究開発員・営業・システム・製造ライン管理・経営陣), each `n` and `pay` a month to
  //   start; `burden`: what each costs it beyond (アスカ国's social insurance)
  // - `pay`: 稼ぐほど上がる — its pay index (1 at the start) moved each month towards what it earns: its people's pay at
  //   most `share` of what its sales leave after their making (and its technology's fees), a step of `step` a month,
  //   between `min` and `max` times the start's; the researchers' half of the research pool on top (`research.pay`)
  // - `staff`: its people's number with its business, `min`〜`max` of the start's: `grow` more a quarter while it makes
  //   money and has the cash, `cut` fewer a month after two in the red with under `runway` months of its costs
  // - `facilities`: its plants', its head office's land and their 管理費, a month (`land` of it the land's rent, to
  //   アスカ国's treasury; the rest the local trade's work); `fee`: 販売手数料 a unit sold (MIZUKAWA GARAGE's)
  // - `research`: the pool every unit sold puts its research into, and more besides (`extra` times what it made in
  //   the month, 収益以上 — as far as `cushion` months of its costs stay at hand), never lost: `pay` of it its
  //   researchers' pay and bonus, `orders` its orders to others (`ordersTo`: YAMATO, WAZIMA's engineers, アスカ国), `asset`
  //   its technology's worth (技術ライセンス価値: kept, not spent — what its fees are lifted by)
  // - `line`: the world's production-line technology, `share` MIZUKAWA's (WAZIMA the rest), `grow` more a month and
  //   `perAsset` more for every `assetUnit` of its technology's worth, up to `max`; MAGITA and WAZIMA pay `rate` of what
  //   they make for it (each holder its share), YOSHIDA `cartech` of its cars' for its car technology — both × (1 +
  //   its worth ÷ `lift`)
  // - `higa`: HIGA MASTER製造技術 (begun before its founding): `cost` in all over its half year, done on `due` (always):
  //   every unit made after it `cut` cheaper
  // - `release`: a model's cost and research a unit worked out the day it comes out — its `base` cost × the economy's
  //   price index (`index`: アルタス's, held within its range) × HIGA (0.7 once done), its research its price × its
  //   `rate` (15〜55%: a model built on one before lower) ÷ the research bonus (`bonus` with WAZIMA its)
  // - `wazima`: its plan to buy WAZIMA of MAGITA at its value and `premium` more, `after` days from its founding at the
  //   earliest — what its cash and `cushion` months of its costs kept do not cover, Tenesice lends (as far as `loan`
  //   times a year of its sales): WAZIMA's profit, people, plants and business its, its research `bonus` times faster
  // - `locals`: its plan for the four companies of MAGITA's economy: their businesses bought at what they are worth
  //   and a share more as the talks go (`premium`), taken into it — their people not (they lose their jobs), their
  //   technology none —, `after` the WAZIMA buyout
  // - `myway`: its contract with MY WAY (its first collaboration car, River W Feat.: the profit `share` MY WAY's) ends
  //   on `until`; the Feat. cars still in stock go on sharing
  // - `asuka`: what of アスカ国's people's car money goes to MIZUKAWA GARAGE at home
  var MIZUKAWA = {
    founded: [2026, 11, 5],
    seed: 38000000000,
    roles: [
      { id: 'rd', name: '研究開発員', n: 1500, pay: 4000000 },
      { id: 'sales', name: '営業', n: 350, pay: 2000000 },
      { id: 'systems', name: 'システム', n: 150, pay: 3000000 },
      { id: 'line', name: '製造ライン管理', n: 200, pay: 3000000 },
      { id: 'exec', name: '経営陣', n: 100, pay: 4000000 }
    ],
    burden: 1.15,
    pay: { share: 0.55, step: 0.08, min: 0.6, max: 3 },
    staff: { min: 0.5, max: 2, grow: 0.03, cut: 0.05, runway: 3 },
    facilities: { month: 1000000000, land: 0.3 },
    fee: 100000,
    research: { pay: 0.5, orders: 0.3, asset: 0.2, ordersTo: { yamato: 0.4, wazima: 0.3, asuka: 0.3 }, extra: 1.2, cushion: 6 },
    line: { share: 0.7, grow: 0.002, perAsset: 0.01, assetUnit: 10000000000, max: 0.95, rate: 0.1, cartech: 0.06, lift: 100000000000 },
    higa: { name: 'HIGA MASTER製造技術', start: [2026, 8, 3], due: [2027, 2, 3], cost: 5000000000, cut: 0.3 },
    release: { index: [0.8, 1.2], bonus: 1.2 },
    wazima: { premium: 0.25, cushion: 3, after: 60, loan: 1 },
    locals: { firms: ['mgmaterial', 'mglogi', 'mgtown', 'jukofood'], premium: [0.1, 0.4], after: 30 },
    myway: { until: [2027, 1, 1], share: 0.5 },
    // (アスカ国's people's car money: `share` of it at MIZUKAWA GARAGE at home — their own country's carmaker —, the rest
    // at Car Owner's branches there)
    asuka: { share: 0.65 }
  };
  // a MIZUKAWA product on sale on day `day` (its release day and its stock: server/core/corp-mizukawa.js)
  function mizukawaOut(id, day) { var pr = PRODUCTS.cars[id] || PRODUCTS.items[id]; return !!(pr && pr.seller === 'mizukawa' && (!pr.from || day >= dayAt(pr.from[0], pr.from[1], pr.from[2]))); }
  // a ward's name: HACHI ○○区 第○病院 (its number in its district)
  function wardName(district, k) { return 'HACHI ' + district + ' 第' + k + '病院'; }

  /* ---------------------------------------------------------------- MY WAY --- */
  // MY WAY's licences and the life of its characters (server/core/corp-model.js ip; its people's part:
  // server/core/npc-org.js). Every number is where it starts.
  // - `partners`: each pays `fee` a year (its IP契約料, paid day by day like any bill, a cost on its own books: ¥ more it
  //   spends than before) for what it may make of MY WAY's characters (`what`), and sells `lift` times its fee of them
  //   (its コラボ売上: at twice the usual price, sold out at once — to its customers outside, or once the country lives
  //   to the people, who buy them as fans) at `cost` of their price. All of that × the characters' 流行 (heat) × their
  //   信用 (brand): when they cool, what a partner sells of them falls and the fee stays, and it cancels the contract
  //   (`breakeven`: below heat × brand of about fee ÷ (lift × (1 − cost)) it loses on it). MY WAY's 交渉係 and the
  //   partners' talk the fees up or down each quarter (`talks`: at most `step` a time, never under `floor` or over `cap`
  //   of the fee it began at).
  // - `hype`: a listed partner's shares jump `hype` (log of 1.2〜1.35) the day a contract is signed (the 99% that fail
  //   MY WAY's review: its approval is a seal on its technology and its books), and while its contract runs the market
  //   prices it `per` more (投資熱).
  // - `heat` (流行): 1 at the start, worn down `fatigue` a year (`stale` more when no new character came for a year:
  //   マンネリ化), lifted by each new character (`chars`: `perYear` a year at its research budget, each `lift` if it
  //   catches on, `flop` if not) and each idea taken up (`idea`: $500K to whoever had it, `ideaHeat` each); now and then
  //   a cold spell (`chill`: a month's chance, heat × `chillBy`).
  // - `brand` (信用): falls with the copies (`fakes`: `fakeGrow` more a month, a flood now and then: `flood`) and with a
  //   scandal (`scandal`: a month's chance, `scandalBy` off); comes back by itself towards 1 − `fakeHurt` × fakes.
  // - the people's measures (their departments' proposals in the 会議室, server/core/npc-org.js): a new character pushed
  //   out (`newChar`: its cost, its lift), the copies fought in court (`legal`), a brand campaign or an apology
  //   (`pr`), the fees offered lower to those who left (`win`), the costs of caring for the people cut (`care`: never
  //   the pay, which it cannot cut), a voluntary retirement (`retire`: of the staff, with `severance` months each).
  //   With no people to decide (before the country lives) the company does the obvious by itself (`auto`).
  // - Tenesice lends to it at `loanRate` a year whatever its rank (MY WAY's pace frightens it), no more than `line` of its
  //   equity. Out of money with nothing more to borrow it files for 破産 as any company does (BANKRUPTCY below): its
  //   contracts end, its people are let go, its shares stopped and struck off Dtrade (上場廃止, worth nothing), its
  //   trustee pays out what it has, and the bank loses the rest of what it lent.
  /* ------------------------------------------------- the game's businesses and failing --- */
  // The game's own businesses (機能) and who runs them: each its `owner` at the start, the money the players and the
  // people pay for it (`kinds`: the players' flows to the owner, server/core/corp.js; `npc`: the people's streams;
  // `products`/`npcProducts`: what is sold as goods; `job`: a job site's part of the バイト's fees), what of it is profit
  // (`margin`), who it suits among the thirteen (`fit`, 0.7 for the rest) and the local companies (`local`, the best
  // first). When its company fails, the trustee carries it on and sells it to the highest bidder (事業譲渡).
  var FEATURES = [
    { id: 'slots', name: 'カジノスロット', owner: 'dtrade', kinds: ['casino', 'winfee', 'slotfee', 'exchange'], npc: ['slotfee', 'winfee', 'exchange'], cas: true, margin: 0.55,
      fit: { tenesice: 1.1, daizin: 1.2, jinx: 0.8, myway: 0.9 }, local: ['goldhotel', 'alpha', 'chiikibank'] },
    { id: 'invest', name: '投資（株式の売買）', owner: 'dtrade', kinds: ['trade'], npc: ['commission'], margin: 0.6, fit: { tenesice: 1.4, daizin: 1.0 }, local: ['alpha', 'chiikibank', 'central'] },
    { id: 'garage', name: 'ガレージ（MAGITA Garage）', owner: 'magita', kinds: ['garage', 'garagefee', 'rentfee', 'rentcut'], margin: 0.5, fit: { carowner: 1.2, yosida: 1.1, wazima: 1.0 }, local: ['mgtown', 'autoparts'] },
    { id: 'robert', name: '中古車の買取（MAGITA Robert）', owner: 'magita', kinds: ['buyback'], margin: 0.08, fit: { carowner: 1.3, yosida: 1.0 }, local: ['nextused', 'autoparts'] },
    { id: 'cars', name: '新車の販売（カーオーナー）', owner: 'carowner', kinds: [], products: 'car', npcProducts: 'cars', npc: ['service'], margin: 0.12, fit: { magita: 1.2, yosida: 1.2, jinx: 0.9 }, local: ['nextused', 'autoparts'] },
    { id: 'shop', name: 'SHOP（ジンクス）', owner: 'jinx', kinds: [], products: 'shop', npcProducts: 'items', margin: 0.15, fit: { carowner: 1.0, daizin: 0.8 }, local: ['palette', 'freshmart'] },
    { id: 'vip', name: 'VIP・ロイヤルコイン（DAIZIN）', owner: 'daizin', kinds: ['vip'], npc: ['lounge', 'members'], coins: true, margin: 0.6, fit: { tenesice: 1.0, dtrade: 1.1, myway: 0.9 }, local: ['luxe', 'aegis'] },
    { id: 'jobs-citywork', name: 'バイトの求人（シティーワーク）', owner: 'citywork', kinds: [], job: true, margin: 0.2, fit: { speedeed: 1.4 }, local: ['central', 'chiikibank'] },
    { id: 'jobs-speedeed', name: 'バイトの求人（スピーディード）', owner: 'speedeed', kinds: [], job: true, margin: 0.15, fit: { citywork: 1.4 }, local: ['central', 'chiikibank'] },
    { id: 'gacha', name: 'ガチャ（YOSIDA）', owner: 'yosida', kinds: ['gacha'], prizes: true, margin: 0.3, fit: { dtrade: 1.2, daizin: 1.0, ice: 1.1, riru: 1.0 }, local: ['gamesark', 'neogear'] },
    { id: 'quests', name: 'クエスト（YOSIDA）', owner: 'yosida', kinds: ['questfee'], margin: 0.9, fit: { dtrade: 1.0, citywork: 1.1 }, local: ['cyberarena', 'alpha'] },
    { id: 'tree', name: '金の生る木（YOSIDA）', owner: 'yosida', kinds: ['fertilizer'], trees: true, margin: 0.6, fit: { magita: 0.9, wazima: 1.0 }, local: ['greenfoods', 'mgtown'] }
  ];
  // 破産 (Japan's 破産手続, a few months of it): a company files when it cannot pay (out of money with nothing more Tenesice
  // will lend: a company whose equity is below nothing is lent no more than its line) or when its equity has been
  // below nothing `insolvent` months running; it pays the court's deposit (`deposit`: of its debts, at least, at most),
  // stops, pays its people what it owes them (the country `guarantee` of what it cannot: 未払賃金立替払) and lets them
  // go; its shares stop trading and are struck off `delist` days on; the court opens it `open` days on and its trustee
  // sells its businesses (`auction`: the bids) and what it has (`sell`: of each asset's worth), pays its own fee
  // (`trustee`), the taxes, then everyone else alike (配当率), and closes it `close` days on. A business is worth
  // `years` years of its profit; the trustee takes nothing below `reserve` of that. A local company buying one borrows
  // all of it from Tenesice at `localRate`, over `localYears`.
  var BANKRUPTCY = {
    insolvent: 6, deposit: [0.002, 50000000, 2000000000], guarantee: 0.8,
    open: 14, delist: 30, auction: 35, distribute: 60, close: 120,
    sell: { ar: 0.9, stock: 0.4, wip: 0, ppe: 0.3, content: 0.2, affil: 0.5, goodwill: 0, lent: 0.8 },
    trustee: 0.02, years: 4, reserve: 0.3, bid: [0.65, 1], goodwillYears: 5, localRate: 0.06, localYears: 10,
    // a local company: below nothing `months` running and its bank out of patience (its overdraft beyond `overdraft`
    // months of its plan's sales)
    local: { months: 3, overdraft: 2 }
  };

  var MYWAY = {
    partners: {
      jinx: { fee: 15000000000, lift: 2.2, cost: 0.3, what: 'ぬいぐるみ・限定キャラグッズの製造販売' },
      magita: { fee: 6000000000, lift: 1.8, cost: 0.35, what: 'オリキャラデザイン車・特別仕様エンジンの共同開発' },
      carowner: { fee: 4000000000, lift: 1.8, cost: 0.3, what: 'オリキャラデザイン車の販売' },
      ice: { fee: 6500000000, lift: 1.9, cost: 0.15, what: '世界1位ゲームへのIP使用権許諾・コラボ' },
      // (Tenesice's alone a 超大型IP契約 from 2026-11-03: far bigger than anyone's, and up to four times its size —
      // `huge`; `fee0` its fee before)
      tenesice: { fee: 20000000000, fee0: 6000000000, lift: 1.5, cost: 0.05, huge: true, what: '公式看板キャラクターの独占契約（超大型IP契約：全支店・カード・ATM・アプリ）' },
      dtrade: { fee: 3500000000, lift: 1.8, cost: 0.1, what: 'カジノスロットの冬仕様外装・季節限定スキン' },
      riru: { fee: 1500000000, lift: 2.2, cost: 0.15, what: '新興ゲームへのIP使用権許諾・コラボ' },
      // (the rest of the thirteen, from 2026-11-03: `late`)
      yosida: { fee: 2500000000, lift: 2, cost: 0.35, late: true, what: 'コラボ車（S6 WAY）・限定ラッピング車' },
      wazima: { fee: 1200000000, lift: 1.9, cost: 0.3, late: true, what: 'キャラクターデザイン部品・工場見学ツアー' },
      daizin: { fee: 2000000000, lift: 1.8, cost: 0.2, late: true, what: 'VIPラウンジのキャラクター空間・限定ロイヤルコイン' },
      citywork: { fee: 800000000, lift: 1.6, cost: 0.1, late: true, what: '求人サイトの公式キャラクター' },
      speedeed: { fee: 600000000, lift: 1.6, cost: 0.1, late: true, what: 'バイトアプリの公式キャラクター' },
      // (HACHI, from its founding on 2026-11-04: its 定期検診 advertising and its name, a contract of five years —
      // `term` — then renewed, cut or talked over; on under the state too. No goods: what it is worth to it is the
      // checkups and visits its advertising brings, about a quarter more than its fee at full pull — `lift`)
      hachi: { fee: 8000000000, lift: 1.25, cost: 0, late: true, term: 5, what: '定期検診の広告・知名度向上（キャラクター使用権：5年更新）' },
      // (MIZUKAWA, from its founding on 2026-11-05 to 2027-01-01 — not renewed —: its collaboration car's profit half
      // MY WAY's on top of the fee)
      mizukawa: { fee: 1200000000, lift: 1.6, cost: 0, late: true, ends: [2027, 1, 1], what: 'コラボ特別仕様車 River W Feat.（利益5:5）' }
    },
    // the day the thirteen all became its partners and Tenesice's became its 超大型IP契約 (its seven partners before
    // at their first fees — `fee0` — and its showroom made its $45B)
    allFrom: [2026, 11, 3],
    // a contract's size (契約規模): its fee and what the partner sells of the characters both times `scale` — each
    // partner may take it up or down a `step` at a time, within `range` (Tenesice's 超大型 `huge`)
    scale: { step: 1.25, range: [0.4, 2], huge: [0.5, 4] },
    // MY WAY's 交渉係 talks with every partner every day (`daily`): most days nothing comes of it; on a day that it does
    // (`odds`), it asks more of a partner that earns well on its characters (`rich`: its margin on them against the fee)
    // — a bigger contract when it earns far more (`big`) —, gives a little to one that loses on them (or takes the
    // contract down a size), within the fee's band (talks). How far a side gives: its ビジネス友好度.
    daily: { odds: 0.08, rich: 0.4, big: 1.2, poor: 0, up: [0.01, 0.04], down: [0.01, 0.03] },
    // the local companies' contracts (the 32 — not the banks): a fee of `share` of a year's sales at its size,
    // its goods `lift` times it at `cost` of their price (sold to the people as fans); one signs when the characters
    // pull `pull` or more and it has `months` of its costs in hand, gives up after `badMonths` of losing on it
    locals: { share: 0.03, min: 30000000, lift: 1.8, cost: 0.3, pull: 0.85, months: 1.5, badMonths: 2, again: 1.2 },
    // the two countries' (国の公式キャラクター): its fee a year (by its size: a country of 50,000 / アスカ's own), and
    // what it brings — the people's love of the characters there (`pull`: × 1 + pull × its size) and, アスカ国's,
    // the trips to アスカ・リゾート (`trips`) —; signed while its treasury has `months` of its spending to spare
    nations: { vernoa: { fee: 3000000000, pull: 0.12, months: 3 }, asuka: { fee: 4000000000, pull: 0.1, trips: 0.15, months: 3 } },
    // MY WAY grows (成長企業): what it has beyond its equity's aim (`equity`: $1B in a bubble of its own to $5B in hard
    // times, × the country's size) into its economy each month — `months` to spend it at most, `cap` a month at most —:
    // the local companies about it (`parts.sphere`), research (`rd`), its people (`people`: a bonus), 株式会社YAMATO
    // (`yamato`: 世界一のビジネスパートナー, besides the `yamato` it gives each month); in its 社内バブル (its sales up
    // `bubble.growth` a month or its characters' pull `bubble.pull` or more, or a boom of `bubble.boom`) it borrows of
    // Tenesice up to `bubble.line` of its equity and a year's `bubble.sales` of its sales to grow on (its people,
    // its buildings, its ads); its shares up `ads.gain` or more over the month, `ads.of` of its month's sales more
    // into advertising (a sixth of it its budget's for good)
    grow: { equity: [1000000000, 5000000000], months: 6, cap: 4000000000, parts: { sphere: 0.35, rd: 0.2, people: 0.3, yamato: 0.15 },
      yamato: 150000000,
      bubble: { growth: 0.08, pull: 1.15, boom: 1.1, line: 2, sales: 0.5, capex: 0.45, ads: 0.25, people: 0.03 },
      ads: { gain: 0.03, of: 0.4, keep: 6 } },
    direct: 2500000000,
    talks: { step: 0.08, floor: 0.5, cap: 1.6 },
    hype: [0.2, 0.35], per: 0.15,
    heat: { fatigue: 0.12, stale: 0.25, min: 0.05, max: 1.6, chill: 0.02, chillBy: [0.45, 0.7] },
    chars: { perYear: 2, lift: [0.08, 0.22], flop: 0.3, names: ['ルミ', 'ポポ', 'ミント', 'クロ', 'ソラ', 'ハル', 'モカ', 'リン', 'ノア', 'ココ', 'ユズ', 'トト'] },
    idea: 500000, ideaRate: 0.025, ideaHeat: 0.0005,
    brand: { fakes: 0.05, fakeGrow: 0.01, flood: 0.03, floodBy: [0.2, 0.4], fakeHurt: 0.8, back: 0.04, scandal: 0.015, scandalBy: [0.25, 0.5] },
    newChar: { cost: 300000000, lift: [0.1, 0.3], chance: 0.75 },
    legal: { cost: 150000000, cut: 0.5, brand: 0.05 },
    pr: { cost: 200000000, brand: [0.08, 0.18] },
    win: { off: 0.2 },
    care: { cut: 0.1, floor: 0.5 },
    retire: { share: 0.1, severance: 6 },
    // (when a partner gives up: its contract losing for `badMonths` months running; back when heat × brand is `again`
    // times its breakeven for as long)
    badMonths: 2, again: 1.25,
    loanRate: 0.15, line: 0.5,
    // MY WAYの経営理念 (fixed: its own, set by no one else) — its people first, and an economy of its own always in a boom:
    // - `keepQuarters`: quarters of losses in a row before it cuts anything of its people's — their pay, their care,
    //   their places (当分は社員の給料を減らさない); it pushes on until then
    // - its pay: each month its sales grew (its last month against the two before), `raiseBy` of that growth onto
    //   everyone's pay, each their own share of it (`spread`: from its low to its high times), and more in a boom
    //   (`boom` of how hot the economy is)
    // - little kept (利益剰余金を貯めない): it aims at `margin` of its plan's margin and spends the rest — its people's
    //   welfare, its buildings, research, advertising, running and investment —, up to `raise` more a month and `top`
    //   times its budgets; `payout` of its profit to its shareholders
    // - its economy (the MY WAY経済圏's local companies): each month `sphere` of its profit as their support, and at
    //   least `floor` of their month's sales; they take on its ways — their people's pay raised as their sales grow,
    //   `grow` more people a month while it supports them, never a cut
    philosophy: { keepQuarters: 4, raiseBy: 0.6, spread: [0.5, 1.5], boom: 0.03, margin: 0.4, raise: 0.3, top: 12, payout: 0.9, sphere: 0.25, floor: 0.1, grow: 0.03 }
  };
  // a partner's breakeven heat × brand at its contract's fee now
  // (`fee`: the fee at its size 1; the size doubles both its fee and what is sold, so it does not move this)
  function breakeven(id, fee) {
    var p = MYWAY.partners[id];
    if (!p) return 1;
    return (fee === undefined ? p.fee : fee) / (p.fee * p.lift * (1 - p.cost));
  }
  // a contract's size range (Tenesice's the bigger)
  function scaleRange(id) { var p = MYWAY.partners[id]; return p && p.huge ? MYWAY.scale.huge : MYWAY.scale.range; }
  // A day's talk between MY WAY and a partner (`c`: its contract — `fee` at size 1, `base`, `scale` —; `t`: `share`,
  // what it earned on the characters beyond its fee last month against the fee; `pull` their pull now; `tie` the two
  // companies' ビジネス友好度; `range` its size's; `u` three chances of the day). What they agreed: the fee's and the
  // size's multipliers (1: nothing changed), and what was said.
  function mywayTalk(c, t) {
    var D = MYWAY.daily, T = MYWAY.talks, S = MYWAY.scale, r = t.range || S.range, u = t.u || [0.5, 0.5, 0.5];
    var res = { fee: 1, scale: 1, said: '' };
    if (u[0] >= D.odds) return res;
    var give = Math.max(0.2, Math.min(1, (t.tie === undefined ? 50 : t.tie) / 70)), size = c.scale || 1;
    var pick = function (a, k) { return a[0] + (a[1] - a[0]) * k; };
    if (t.share >= D.big && t.pull >= 1 && size * S.step <= r[1] + 1e-9 && u[1] < 0.5) { res.scale = S.step; res.said = '契約規模の拡大で合意（売れ行き好調）'; }
    else if (t.share >= D.rich && t.pull >= 0.9) {
      var up = pick(D.up, u[2]) * give;
      if (c.fee * (1 + up) <= c.base * T.cap) { res.fee = 1 + up; res.said = '契約料の引き上げで合意（パートナーの利益が大きい）'; }
    } else if (t.share < D.poor) {
      if (size / S.step >= r[0] - 1e-9 && u[1] < 0.4) { res.scale = 1 / S.step; res.said = '契約規模の縮小で合意（採算の改善）'; }
      else {
        var down = pick(D.down, u[2]) * (1.2 - give * 0.5);
        if (c.fee * (1 - down) >= c.base * T.floor) { res.fee = 1 - down; res.said = '契約料の引き下げで合意（パートナーの採算割れ）'; }
      }
    }
    return res;
  }

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
      // (its price cut to $120M: MAGITA bears it — its materials as they were —, the dealer's $10M as it was)
      'mercedes-amg-one-white': { maker: 'magita', cost: 120000000, buy: 108000000, excl: 2000000, npc: 30 },
      // MY WAY's collaboration cars (from `from`: 2026-11-03): sold at Car Owner at a loss to the dealer (its 専売費 and
      // 仕入れ価格 above the price: 販売店側純利益 −$6M, −$5M, −$7M), the maker's profit on each (仕入れ価格 + 専売費 −
      // 原価) shared with MY WAY (`collab.share` MY WAY's: MAGITA 4:6)
      'magita-speed-r-feat': { maker: 'magita', cost: 2500000, buy: 15500000, excl: 8000000, npc: 160, from: [2026, 11, 3], collab: { with: 'myway', share: 0.6 } },
      'magita-k120-feat': { maker: 'magita', cost: 3800000, buy: 32000000, excl: 8000000, npc: 80, from: [2026, 11, 3], collab: { with: 'myway', share: 0.6 } },
      'magita-dr1-feat': { maker: 'magita', cost: 8000000, buy: 53000000, excl: 10000000, npc: 40, from: [2026, 11, 3], collab: { with: 'myway', share: 0.6 } },
      'lamborghini-revuelto': { maker: 'magita', cost: 10000000, buy: 60000000, excl: 3000000, npc: 110 },
      'nissan-gt-r': { maker: 'magita', cost: 9000000, buy: 30000000, excl: 2000000, npc: 260 },
      'lamborghini-kuia-spyder': { maker: 'magita', cost: 5000000, buy: 17000000, excl: 13000000, npc: 90 },
      'lamborghini-urus': { maker: 'magita', cost: 6000000, buy: 29000000, excl: 11000000, npc: 110 },
      'lamborghini-aventador': { maker: 'magita', cost: 4000000, buy: 70000000, excl: 6000000, npc: 70 },
      'mercedes-benz-one': { maker: 'magita', cost: 10000000, buy: 42000000, excl: 1000000, npc: 140 },
      'ferrari-325': { maker: 'magita', cost: 3500000, buy: 30000000, excl: 2000000, npc: 90 },
      // (made from scrapped cars: MAGITA loses on each one, and lets the dealer earn well on it, on purpose)
      onvoro: { maker: 'magita', cost: 500000, buy: 200000, excl: 0, npc: 2800 },
      'blue-lightning': { maker: 'magita', cost: 3000000, buy: 30000000, excl: 3000000, npc: 100 },
      // YOSIDA's: cheap, wanted by many, no 専売特別費用 (販売店側純利益 = price − 仕入れ価格)
      'yoshida-zx4': { maker: 'yosida', cost: 2800000, buy: 4000000, excl: 0, npc: 900 },
      'yoshida-p100w': { maker: 'yosida', cost: 2100000, buy: 4000000, excl: 0, npc: 1400 },
      'yoshida-h9c': { maker: 'yosida', cost: 4300000, buy: 7500000, excl: 0, npc: 500 },
      'yoshida-s5': { maker: 'yosida', cost: 1500000, buy: 2500000, excl: 0, npc: 2600 },
      'yoshida-s6': { maker: 'yosida', cost: 1000000, buy: 1600000, excl: 0, npc: 3200 },
      'yoshida-k10e': { maker: 'yosida', cost: 3000000, buy: 4500000, excl: 0, npc: 1200 },
      // (YOSHIDA S6 WAY, in the S6's place: YOSIDA's profit on it 3:7 with MY WAY; the dealer's $1.5M)
      'yoshida-s6-way': { maker: 'yosida', cost: 3800000, buy: 6000000, excl: 0, npc: 2400, from: [2026, 11, 3], collab: { with: 'myway', share: 0.7 } },
      // MIZUKAWA's (CORP.mizukawa): its own, sold at MIZUKAWA GARAGE alone (`seller`), as many as `limit` in all, from
      // `from`. The ones on sale at its founding with their `cost` and `research` a unit as given (River W: $25M less
      // $3M, $10M and its $100K fee leaves it $11.9M; River W Feat. $33.9M, half of it MY WAY's), the ones to come with
      // their `base` cost and research `rate`, worked out the day they come out (server/core/corp-mizukawa.js release)
      'mizukawa-river-w': { maker: 'mizukawa', seller: 'mizukawa', cost: 3000000, research: 10000000, limit: 20000, npc: 800, from: [2026, 11, 5] },
      'mizukawa-river-w-feat': { maker: 'mizukawa', seller: 'mizukawa', cost: 3000000, research: 1000000, limit: 1000, npc: 260, from: [2026, 11, 5], collab: { with: 'myway', share: 0.5 } },
      'mizukawa-river-w2': { maker: 'mizukawa', seller: 'mizukawa', base: 3200000, rate: 0.2, limit: 30000, npc: 1000, from: [2026, 11, 10] },
      // (庶民的: its margin the lowest)
      'mizukawa-super-u': { maker: 'mizukawa', seller: 'mizukawa', base: 3000000, rate: 0.5, limit: 10000, npc: 1800, from: [2026, 11, 30] },
      // (大型車・キャンプ向け; and its SUPER, 炎神II inside, the very richest's favourite)
      'mizukawa-h1': { maker: 'mizukawa', seller: 'mizukawa', base: 6500000, rate: 0.35, limit: 50000, npc: 700, from: [2026, 11, 30] },
      'mizukawa-h1-super': { maker: 'mizukawa', seller: 'mizukawa', base: 9000000, rate: 0.18, limit: 3000, npc: 120, from: [2026, 11, 30] },
      // (性能を大きく伸ばして万人向け、いちばんの人気; then Nature 1, cheap enough for those in the middle, and River W
      // III: its engine far beyond its price)
      'mizukawa-super-u2': { maker: 'mizukawa', seller: 'mizukawa', base: 3300000, rate: 0.4, limit: 40000, npc: 3000, from: [2027, 2, 3] },
      'mizukawa-nature-1': { maker: 'mizukawa', seller: 'mizukawa', base: 2400000, rate: 0.3, limit: 30000, npc: 2600, from: [2027, 3, 4] },
      'mizukawa-river-w3': { maker: 'mizukawa', seller: 'mizukawa', base: 3400000, rate: 0.22, limit: 5000, npc: 450, from: [2027, 3, 4] }
    },
    items: {
      omamori: { maker: 'jinx', cost: 1000, npc: 50000 },
      'repair-kit': { maker: 'magita', cost: 10000, buy: 390000, excl: 10000, npc: 4000 },
      'car-oil-medium': { maker: 'magita', cost: 210000, buy: 400000, excl: 50000, npc: 3000 },
      'gasoline-full': { maker: 'magita', cost: 20000, buy: 24000, excl: 0, npc: 60000 },
      'engine-v1': { maker: 'magita', cost: 400000, buy: 2000000, excl: 400000, npc: 600 },
      'engine-v2': { maker: 'magita', cost: 600000, buy: 4500000, excl: 100000, npc: 300 },
      'engine-v3': { maker: 'magita', cost: 800000, buy: 7500000, excl: 400000, npc: 150 },
      // YOSIDA's 高効率エンジン series
      'yoshida-er10': { maker: 'yosida', cost: 1100000, buy: 1400000, excl: 0, npc: 2500 },
      'yoshida-er20': { maker: 'yosida', cost: 3200000, buy: 4000000, excl: 0, npc: 700 },
      // MIZUKAWA's 炎神 series and FLOW (MIZUKAWA GARAGE's: SUPER 炎神 II $12M less $2.5M and $7M leaves $2.5M)
      'mizukawa-enjin2': { maker: 'mizukawa', seller: 'mizukawa', cost: 2500000, research: 7000000, limit: 20000, npc: 900, from: [2026, 11, 5] },
      'mizukawa-enjin3': { maker: 'mizukawa', seller: 'mizukawa', base: 3000000, rate: 0.45, limit: 10000, npc: 1200, from: [2027, 3, 1] },
      'mizukawa-flow': { maker: 'mizukawa', seller: 'mizukawa', base: 2200000, rate: 0.55, limit: 20000, npc: 900, from: [2027, 9, 1] }
    }
  };

  // The carmakers: how their cars sell with the economy (`beta`: MAGITA's dear cars when people are rich, YOSHIDA's
  // cheap ones when they are not), and Car Owner's stock of each car (for the people and the players alike): a lot of
  // `lotMonths` of a model's usual customers at the start (MAGITA few, YOSHIDA many); sold out, Car Owner orders a
  // bigger lot (×`grow`, at most `maxGrow` times the first) and pays for it, and it arrives `lead` days later (MAGITA
  // by its special contract the next day, YOSHIDA in five).
  var MAKERS = {
    magita: { name: 'MAGITA', beta: 1.4, lead: 1, lotMonths: 0.5, grow: 1.25, maxGrow: 4 },
    yosida: { name: 'YOSHIDA', beta: -0.6, lead: 5, lotMonths: 1.5, grow: 2, maxGrow: 32 }
  };
  // a car's first lot at Car Owner (`scale`: the country's size against 50,000)
  function firstLot(id, scale) {
    var pr = PRODUCTS.cars[id], m = pr && MAKERS[pr.maker];
    if (!pr || !m) return 1;
    return Math.max(1, Math.round(pr.npc / 12 * m.lotMonths * (scale || 1)));
  }

  /* --------------------------------------------------------------- the ties --- */
  // ビジネス友好度 (0〜100): how well two companies get on, where it starts and why. It moves with what passes between
  // them (trade, losses taken on the other's terms, support, loans paid back, a rival's gains) and drifts back to
  // where it began; and it changes the terms: MAGITA's rebates and how fast it wants paying, Ice Smoker's backing,
  // Tenesice's rate ('*': with every company).
  var TIES = [
    { a: 'magita', b: 'carowner', start: 35, why: 'MAGITAの独占供給・厳しい取引条件' },
    { a: 'magita', b: 'jinx', start: 50, why: 'CAR SHOPの車用品の供給' },
    { a: 'magita', b: 'yosida', start: 15, why: '自動車市場のライバル（高級車と大衆車）' },
    { a: 'yosida', b: 'carowner', start: 55, why: 'YOSHIDA車の供給（専売特別費用なし）' },
    { a: 'yosida', b: 'jinx', start: 55, why: 'YOSHIDAエンジンの供給' },
    { a: 'magita', b: 'wazima', start: 85, why: '完全子会社（MAGITA車の製造・共同開発・コスト削減研究）' },
    { a: 'yosida', b: 'wazima', start: 25, why: 'かつての世界2位と3位の自動車メーカー' },
    { a: 'yosida', b: 'daizin', start: 50, why: 'ガチャ景品のロイヤルコイン・VIP1週間券の買い付け（価格交渉）' },
    { a: 'ice', b: 'riru', start: 90, why: '共同開発・業務委託・資本提携' },
    { a: 'citywork', b: 'speedeed', start: 20, why: '求人市場で競合' },
    { a: 'daizin', b: 'carowner', start: 60, why: 'VIP顧客への高級車の販売' },
    { a: 'jinx', b: 'carowner', start: 55, why: '車用品と整備の連携' },
    { a: 'dtrade', b: 'riru', start: 65, why: '株式の売買・株主事務' },
    { a: 'dtrade', b: 'ice', start: 65, why: '株式の売買・株主事務' },
    { a: 'myway', b: 'jinx', start: 75, why: 'MY WAYのぬいぐるみ・限定グッズの製造販売（IP契約）' },
    { a: 'myway', b: 'magita', start: 60, why: 'MY WAYの特別仕様車・エンジンの共同開発（IP契約）' },
    { a: 'myway', b: 'carowner', start: 60, why: 'MY WAYのオリキャラデザイン車の販売（IP契約）' },
    { a: 'myway', b: 'ice', start: 70, why: 'MY WAYのIP使用権許諾・コラボ（世界1位のゲーム）' },
    { a: 'myway', b: 'riru', start: 65, why: 'MY WAYのIP使用権許諾・コラボ（新興ゲーム）' },
    { a: 'myway', b: 'dtrade', start: 65, why: 'カジノスロットの冬仕様外装・季節限定スキン（IP契約）' },
    { a: 'myway', b: 'hachi', start: 70, why: '定期検診の広告・知名度向上（キャラクター使用権：5年更新）' },
    { a: 'tenesice', b: 'hachi', start: 95, why: '非常に友好的な取引銀行（巨額の融資）' },
    { a: 'mizukawa', b: 'magita', start: 30, why: '製造ライン技術の提供（シェア70%）と高級車市場のライバル' },
    { a: 'mizukawa', b: 'wazima', start: 45, why: '製造ライン技術の二強（MIZUKAWA 70%・WAZIMA 30%）' },
    { a: 'mizukawa', b: 'yosida', start: 55, why: '車技術の提供' },
    { a: 'myway', b: 'mizukawa', start: 65, why: 'MIZUKAWA River W Feat.（初のコラボ特別仕様車：利益5:5）' },
    { a: 'tenesice', b: '*', start: 60, why: '取引銀行（預金・融資）' }
  ];

  // The players' money that comes to the companies (server/core/api.js: as it is spent): what kind, whose sale it
  // becomes. VIP is bought with ロイヤルコイン, each counted as `coin` $; the バイト's employers pay the job sites
  // `jobFee` of what the players are paid; the 投資's 1.8% fee is Dtrade's, and so is the casino's money (the bets the
  // players lose, the fee on a big bet's win, the monthly slot charge, the exchange fee: js/game/config.js casino).
  // What a spin wins beyond its bet is paid by the country's treasury (国庫), as are the quests' rewards (YOSIDA below).
  var PLAYERS = { coin: 100000, jobFee: 0.25 };

  // YOSIDA's monopolies in the game besides its cars (server/core/api.js, gacha.js and tree.js send their money;
  // server/core/corp-model.js books it). To the players they are what they always were; behind them:
  // - クエスト: every reward is paid out of the country's treasury (国庫支出金), and YOSIDA keeps `quest.base` of each
  //   (rounded down) as its fee. It sets the fee each month: while it does badly (its quarter short of 90% of its
  //   plan, or the month a loss) `quest.min`〜`quest.max`, the worse the higher; now and then (`quest.greed` of the
  //   months it does well), wanting more, `quest.min`〜`quest.greedMax` for `quest.months` months; else `quest.base`.
  // - ガチャ: `gacha.share` of what the players pay is its sale, the rest the country's treasury's. Each prize is
  //   provided by its company at its own cost (`gacha`, below): ロットコイン Dtrade's, ロイヤルコイン and VIP1週間券
  //   DAIZIN's, the 金の生る木 and リセットチケット YOSIDA's own, ガレージコイン MAGITA's; a car bought of its maker
  //   (YOSHIDA's: its own, made at its cost; MAGITA's: at its 仕入れ価格 and 専売特別費用, or, for a car it sells no
  //   more, `gacha.carShare` of its price). The players can sell some back (GACHA.sell).
  // - 金の生る木: its biotech, which no one else comes near — seeds made for `seeds.cost` each, `seeds.month` of them
  //   shipped to the market abroad each month at `seeds.price` on average, but no more than `seeds.cap` a year of
  //   them (more as it grows and its technology improves); a tree won at the players' auction is its sale too (made
  //   for `tree`); and the fertilizer is its own: `fertilizer` of the money given to a tree.
  var YOSIDA = {
    quest: { base: 0.1, min: 0.11, max: 0.21, greed: 0.15, greedMax: 0.15, months: 3 },
    // the gacha: `share` of what the players pay for it YOSIDA's (it runs it), the rest the country's treasury's; its
    // prizes each provided by its company at its own cost — the lot coins Dtrade's (its tokens at their $), the
    // ロイヤルコイン DAIZIN's (nothing until it buys one back), a VIP1週間券 DAIZIN's (`vipWeek`), a money tree's seed
    // and a grown one YOSIDA's (`seed`, `grown`; one that has no room — the player's trees all there — paid to the
    // player instead, `treePay`), a reset ticket YOSIDA's (`reset`), a garage coin MAGITA's (`garage`); the cars bought of
    // their makers by YOSIDA (`carShare`: of a list price, a car only the gacha gives worth `worth`)
    gacha: { share: 0.8, vipWeek: 50000, seed: 4000000, grown: 5500000, treePay: 3000000, reset: 1000000, garage: 1000000, carShare: 0.8,
      // (a car only the gacha gives: what it is worth)
      worth: { 'porsche-kuia-spyder': 24000000 } },
    tree: 1000000,
    // (at most `cap` of them a year in all, more as the company grows and its technology with it: × its people against
    // its size at the start, × what its development work has won it)
    seeds: { month: [5000, 10000], price: [10000000, 12000000], cost: 1000000, cap: 21000000000 },
    fertilizer: 0.4
  };
  // the fee YOSIDA keeps of a quest's reward of `dollars` at the rate `rate`
  function questFee(dollars, rate) { return Math.max(0, Math.floor(dollars * (rate === undefined ? YOSIDA.quest.base : rate))); }

  // WAZIMA's research for its parent: each cuts what MAGITA spends besides its materials — its factories' and lines'
  // upkeep (place), its research (rd), its other costs (other) — by `cut` of what is left of it; the four of the
  // list begin on the day WAZIMA joins, and after them one more at a time (`next`: `months`, `chance`, `cut`), none
  // taking a cost below `floor` of what it was. `codev`: the share of MAGITA's research paid to WAZIMA for the joint
  // development.
  var WAZIMA = {
    research: [
      { id: 'W-LINE', name: '省人化ライン・自動化技術「W-LINE」', months: 10, chance: 0.85, of: ['place'], cut: 0.12 },
      { id: 'W-DEV', name: '開発プロセス効率化「W-DEV」', months: 14, chance: 0.75, of: ['rd'], cut: 0.1 },
      { id: 'W-CARE', name: '設備保全AI・設備の長寿命化「W-CARE」', months: 18, chance: 0.8, of: ['place'], cut: 0.08 },
      { id: 'W-OPS', name: '間接業務・調達事務の削減「W-OPS」', months: 8, chance: 0.9, of: ['other'], cut: 0.1 }
    ],
    next: { months: [9, 15], chance: 0.6, cut: [0.02, 0.05], floor: 0.55,
      names: ['生産ラインの再設計', '工場エネルギーの削減', '試作工程のデジタル化', '物流・搬送の自動化', '検査工程のAI化', '共通部品の設計手法', '保全計画の最適化', '事務処理の自動化'] },
    of: { place: '製造経費（工場・ライン維持費）', rd: '研究開発費', other: 'その他の経費' },
    codev: 0.25
  };

  // MAGITA's research, begun on the companies' first day: each takes `months` (fewer once RIMU TAG is done: `speed`
  // off what is left of the others and of anything begun later), succeeds with `chance`, and cuts the materials of
  // everything MAGITA makes by `cut` (each on what the others left). And while it is struggling (a quarter's
  // operating profit below `on` of what its plan expected, or a loss) it adds `amount` to the 仕入れ価格 of every car
  // but those `except` (Car Owner passes it on: the cars cost the players as much more), until a quarter is back at
  // `off` of its plan.
  var MAGITA = {
    research: [
      { id: 'A1', name: '部品コスト削減技術「A1」', months: 12, chance: 1, cut: 0.2 },
      { id: 'T1', name: '製造・生産工程の効率化技術「T1」', months: 9, chance: 0.7, cut: 0.1 },
      { id: 'MOL1', name: '部品の統合・モジュール化「MOL1」', months: 42, chance: 1, cut: 0.2 },
      { id: 'RIMU', name: 'AIによる研究加速計画「RIMU TAG」', months: 24, chance: 1, speed: 0.35 }
    ],
    surcharge: { amount: 3000000, except: ['onvoro'], on: 0.5, off: 0.9 },
    // MAGITA Garage: every month each player pays `base` for each place of their garage (taken from the $ in hand,
    // whatever is there). MAGITA sets the next month's fee at each month's end: while it does badly (its last
    // quarter's operating profit short of its plan, or the month's a loss) it raises it to `min`〜`max` (the worse,
    // the higher), back to `base` when it is well again. Renting a car out is its business too: `rentFee` each time a
    // car is put out to rent (paid from the $ in hand), and `rentCut` of what the renting earned when it is collected.
    garage: { base: 100000, min: 110000, max: 200000, rentCut: 0.15, rentFee: 70000 }
  };

  // Every company's people and research (技術開発): at each quarter's results a company that did badly (its operating
  // profit under `cutBelow` of what its plan expected, or a loss) lets `cut` of its people go (the worse, the more;
  // `severance` months of pay each), one that did well (over `growAbove`) raises its hiring plan by `grow`. And each
  // runs one development at a time (`months`); it succeeds the likelier, and lifts its trade the more, the more people
  // it has (against its size at the start) and the better their mood: `chance` at the start's size, `edge` its lift.
  var STAFFING = { cutBelow: 0.5, cut: [0.03, 0.1], severance: 3, growAbove: 1.25, grow: [0.02, 0.05] };
  var TECH = {
    months: [5, 11], chance: 0.45, edge: [0.01, 0.05], maxEdge: 1.35,
    names: ['次世代', '新型', '高効率', 'AI活用', '省エネ', '統合', '自動化', '次期主力'],
    kinds: { maker: '製品・製造技術', dealer: '販売システム', retail: '流通・PB商品', service: 'サービス基盤', bank: '金融システム', studio: 'ゲームエンジン' }
  };

  var GENRES = ['RPG', 'アクション', 'アクションRPG', 'シューター', 'アドベンチャー', 'ストラテジー', 'レース', 'スポーツ', '格闘', 'パズル', 'シミュレーション', 'ホラー', 'オープンワールド'];
  // a new game's name: one of each (a sequel of a hit keeps its name and a number)
  var NAMES = {
    jp: [['蒼穹', '紅蓮', '星海', '幻影', '鋼鉄', '黎明', '深淵', '白銀', '雷鳴', '夜想', '天空', '翠玉', '月影', '焔'],
      ['のアルカナ', 'クロニクル', 'レクイエム', 'ラビリンス', 'フロンティア', 'オデッセイ', 'サーガ', 'リバース', 'ブレイカー', 'エンブレム', 'の守護者', 'の旅路']],
    en: [['NEON', 'ECHO', 'ASTRA', 'IRON', 'VOID', 'NOVA', 'CRIMSON', 'SILENT', 'ROGUE', 'ZERO', 'HOLLOW', 'SOLAR'],
      ['DRIFT', 'PROTOCOL', 'HORIZON', 'LEGION', 'SIGNAL', 'REQUIEM', 'FRONTIER', 'RIFT', 'CROWN', 'TIDE', 'ORBIT', 'SHIFT']]
  };

  /* ------------------------------------------------------------- the lending --- */
  // Ranks: who lends at what. Tenesice is S (the bank itself); every company here starts at A, and borrows from it at
  // 0.8〜1.2% a year (the healthier its books, the lower); one whose books weaken falls to B (3〜6%: `below` its
  // health) and to C (10%), as Tenesice's lending desk reads them (server/core/npc-org.js). (MY WAY pays its own
  // 15% whatever its rank: MYWAY.loanRate.) Money kept at the bank earns `deposit` a year, bonds `bonds`. A company
  // keeps `months` of its costs at hand: more goes into bonds, under `floor` months it sells bonds, then borrows (in
  // `unit`s, for `years`).
  var RANKS = { S: { name: 'S' }, A: { name: 'A', rate: [0.008, 0.012] }, B: { name: 'B', rate: [0.03, 0.06], below: 0.45 }, C: { name: 'C', rate: [0.1, 0.1], below: 0.2 } };
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
    'c:materials': ['材料費（アルタスの資源）', 'c'], 'c:factory': ['製造労務費', 'c'], 'c:plant': ['製造経費', 'c'], 'c:rebate': ['販売奨励金', 'c'],
    sSalary: ['給料手当', 's'], sBonus: ['賞与', 's'], sWelfare: ['法定福利費・福利厚生費', 's'], sPlace: ['地代家賃・施設維持費', 's'],
    sRd: ['研究開発費', 's'], sAds: ['広告宣伝費', 's'], sSelling: ['販売費', 's'], sPartner: ['開発援助・業務委託費', 's'], sCredit: ['与信関係費用', 's'], sDepr: ['減価償却費', 's'], sOther: ['その他', 's'],
    nInterest: ['受取利息', 'ni'], nDividend: ['受取配当金', 'ni'], nSupport: ['受取援助金', 'ni'], nEquity: ['持分法による投資利益', 'ni'], nOther: ['雑収入', 'ni'],
    eInterest: ['支払利息', 'ne'], eEquity: ['持分法による投資損失', 'ne'], eOther: ['雑損失', 'ne'],
    xGain: ['固定資産売却益', 'xi'], xImpair: ['コンテンツ評価損', 'xl'], xCancel: ['開発中止損失', 'xl'],
    tax: ['法人税、住民税及び事業税', 't'],
    // once the country of people lives (js/game/npc.js): what it pays the companies, and what they pay for it
    'r:public': ['官公庁・公共事業売上', 'r'], 'r:ventures': ['新規事業売上', 'r'], 'r:mobile': ['通信事業収入（テネシス・モバイル）', 'r'], 'r:facility': ['設備・施設サービス売上', 'r'],
    'r:it': ['ITサービス・データセンター売上', 'r'], 'r:platform': ['ゲーム販売手数料', 'r'], 'r:placement': ['人材紹介手数料', 'r'], 'r:nii': ['資金利益', 'r'], 'r:fees': ['役務取引等利益', 'r'],
    'r:garage': ['MAGITA Garage', 'r'], 'r:used': ['中古車販売', 'r'], 'c:used': ['中古車販売の原価', 'c'],
    'c:funding': ['資金調達費用（預金利息）', 'c'], 'c:payout': ['払い出し（市民の勝ち越し分）', 'c'],
    sRecruit: ['採用費', 's'], sSeverance: ['退職給付費用', 's'], sVenture: ['新規事業費用', 's'],
    // DAIZIN's buying back of the players' coins; a parent's part of its child's month (WAZIMA's, MAGITA's)
    'c:coinbuy': ['ロイヤルコインの買い取り', 'c'],
    nSubsidiary: ['子会社からの受取配当金（WAZIMAの利益）', 'ni'], eSubsidiary: ['子会社の損失負担（WAZIMA）', 'ne'],
    // MY WAY: a partner's fee and what it sells of the characters; MY WAY's measures, its ideas' rewards, its failure
    sLicense: ['IP契約料（MY WAYへの支払ロイヤリティ）', 's'], 'r:myway': ['MY WAYコラボ売上', 'r'], 'c:myway': ['MY WAYコラボ商品の原価', 'c'],
    sMeasure: ['ブランド・IP対策費（新キャラクター・法的措置・PR）', 's'], sIdea: ['成果報酬（企画採用1件$500K）', 's'],
    xBankrupt: ['倒産に伴う資産の評価損', 'xl'], xRelief: ['債務免除益（倒産・清算）', 'xi'],
    // (a customer's or a debtor's failure: what it never paid; the trustee's business carried on; a business sold;
    // a business bought: のれん, written off over its years)
    'r:asuka': ['アスカ国の支店の売上', 'r'], 'r:asukaB2B': ['アスカ国の支店向けの卸売', 'r'], 'c:asuka': ['アスカ国で売った品物の仕入れ', 'c'],
    sAsuka: ['アスカ国の支店の人件費・地代・手数料', 's'], tAsuka: ['アスカ国の法人税・源泉税', 't'],
    // (the 医療税 on its month's profit: js/game/npc.js medicalTax)
    tMedical: ['医療税（企業利益）', 't'],
    // (what a carmaker pays MIZUKAWA for its production lines' or its cars' technology)
    sTech: ['技術提供料（MIZUKAWAの製造ライン・車技術）', 's'],
    // (a child company sold: MAGITA's WAZIMA to MIZUKAWA)
    xSubsidiary: ['子会社株式の売却益（WAZIMA）', 'xi'],
    // (アルタス: every company's resources bought of it — its goods' and parts' raw materials and food, its plants' and
    // buildings' energy and materials, its research's —, at its prices: server/core/corp-model.js costOf, running)
    'c:altas': ['資源の仕入れ（アルタス）', 'c'], 'c:asukaAltas': ['アスカ国で売った品物の資源の仕入れ（アルタス）', 'c'],
    sAltas: ['資源・エネルギーの購入（アルタス）', 's'],
    // (the gacha's prizes each company provides at its own cost; what the players sold back to it of them)
    sGacha: ['ガチャ景品の提供（自社負担）', 's'], 'c:rebuy': ['プレイヤーからの買い取り（VIP券・チケット・ガレージコイン）', 'c'],
    // (MY WAY's support of the local companies of its economy: their funding)
    sSupport: ['MY WAY経済圏の企業への支援', 's'],
    // (MY WAY grows: what it puts into those about it, its research and its people beyond its equity's aim; its gift to
    // 株式会社YAMATO; the advertising its shares' rise paid for)
    sGrow: ['成長投資（周辺企業・研究・社員への投資）', 's'], sYamato: ['株式会社YAMATOへの資金援助', 's'],
    xBad: ['貸倒損失（取引先の破産）', 'xl'], xEstate: ['破産管財人による事業継続の収入', 'xi'], xSale: ['事業譲渡益（破産管財人）', 'xi'],
    goodwill: ['のれん（事業の譲受け）', 'a'], sGoodwill: ['のれん償却', 's'], xCourt: ['破産手続の予納金', 'xl']
  };
  // an account's name and kind for a company (its own sales and costs by its streams; its place and research by their names)
  function account(code, c) {
    // (a business carried on for another company: r:op:<feature>)
    var o = /^([rc]):op:(.+)$/.exec(code);
    if (o) { var ft = FEATURES.filter(function (x) { return x.id === o[2]; })[0]; return [(ft ? '運営を引き継いだ事業（' + ft.name + '）' : code) + (o[1] === 'c' ? 'の原価' : ''), o[1]]; }
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
    { id: 'fixed', name: '固定資産', side: 'a', accounts: ['lent', 'ppe', 'content', 'bonds', 'affil', 'goodwill'] },
    { id: 'currentL', name: '流動負債', side: 'l', accounts: ['deposits', 'ap', 'accrued', 'bonus', 'taxdue'] },
    { id: 'fixedL', name: '固定負債', side: 'l', accounts: ['loan'] },
    { id: 'equity', name: '純資産', side: 'e', accounts: ['capital', 'reserve', 'othercap', 'legal', 'retained', 'treasury'] }
  ];
  // the キャッシュ・フロー計算書 (直接法): where each movement of cash goes
  var CF = [
    { id: 'op', name: '営業活動によるキャッシュ・フロー', lines: [['receipts', '営業収入'], ['purchases', '仕入れによる支出'], ['payroll', '人件費の支出'],
      ['expenses', 'その他の営業支出'], ['support', '援助金の受取額'], ['interestIn', '利息及び配当金の受取額'], ['interestOut', '利息の支払額'], ['taxes', '法人税等の支払額']] },
    { id: 'inv', name: '投資活動によるキャッシュ・フロー', lines: [['capex', '有形固定資産の取得による支出'], ['bondsBuy', '投資有価証券の取得による支出'],
      ['bondsSell', '投資有価証券の売却による収入'], ['lending', '貸出金の増減'], ['acquire', '事業の譲受けによる支出'], ['divest', '事業の譲渡・資産の売却による収入']] },
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
  // $ in M or B only (millions, billions): $45.00B, $235.0M, $123.4B (from $100B one decimal), $3,500.0B, and below a
  // million still in M ($0.04M); a loss with a minus. (moneyFine: with `digits` decimals, for the day's running figures)
  function dec(x, k) { var t = x.toFixed(k).split('.'); return t[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (t[1] ? '.' + t[1] : ''); }
  function money(n) { return moneyFine(n); }
  function moneyFine(n, digits) {
    var a = Math.abs(n || 0), s = n < 0 ? '−$' : '$';
    if (a >= 1e9) { var b = a / 1e9; return s + dec(b, digits !== undefined ? digits : b >= 100 ? 1 : 2) + 'B'; }
    var m = a / 1e6;
    return s + dec(m, digits !== undefined ? digits : m >= 1 ? 1 : 2) + 'M';
  }
  // a statement's figure the same way, without the $ (a loss with △ as Japanese statements write it)
  function mil(n) { var t = money(n).replace('−', '').replace('$', ''); return (n < 0 && t !== '0.00M' ? '△' : '') + t; }
  function pct(x, digits) { return (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(digits === undefined ? 1 : digits) + '%'; }

  BR.CORP = {
    DAY_MS: DAY_MS,
    companies: COMPANIES, company: company, listed: function () { return COMPANIES.filter(function (c) { return c.listed; }); },
    players: PLAYERS, features: FEATURES, feature: function (id) { return FEATURES.filter(function (x) { return x.id === id; })[0] || null; }, bankruptcy: BANKRUPTCY, magita: MAGITA, yosida: YOSIDA, questFee: questFee, wazima: WAZIMA, myway: MYWAY, hachi: HACHI, wardName: wardName, mizukawa: MIZUKAWA, mizukawaOut: mizukawaOut, breakeven: breakeven, scaleRange: scaleRange, mywayTalk: mywayTalk, makers: MAKERS, firstLot: firstLot, staffing: STAFFING, tech: TECH, products: PRODUCTS, ties: TIES, genres: GENRES, names: NAMES, economy: ECONOMY, seasons: SEASONS,
    ranks: RANKS, money: MONEY, tax: TAX,
    accounts: ACCOUNTS, account: account, pl: PL, bs: BS, cf: CF, plOf: plOf,
    // the 決算発表: this many days after a quarter's end, at 15:00 Japan time (6:00 UTC)
    announce: { days: 14, hour: 6 },
    dayOf: dayOf, ymd: ymd, dayAt: dayAt, fyOf: fyOf, fyStart: fyStart, fyEnd: fyEnd, quarterOf: quarterOf,
    quarterStart: quarterStart, quarterEnd: quarterEnd, monthStart: monthStart, monthEnd: monthEnd,
    isMonthEnd: isMonthEnd, isQuarterEnd: isQuarterEnd, isFyEnd: isFyEnd,
    monthKey: monthKey, quarterKey: quarterKey, fyKey: fyKey, monthLabel: monthLabel, quarterLabel: quarterLabel, fyLabel: fyLabel, dateLabel: dateLabel,
    fmt: { money: money, moneyFine: moneyFine, mil: mil, pct: pct, group: group }
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
