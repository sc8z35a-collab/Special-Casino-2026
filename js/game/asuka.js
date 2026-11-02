/* アスカ国: the country beside ヴェルノア, made real in place of the vague 「海外」 (docs/asuka-plan.md, V2). Founded once
   with `founding.total` dollars printed that day and never again — given out to its people, its treasury, ATSUKA Vision
   (the state's own enterprise, its biggest employer and what it earns abroad with), its national bank's own money, the
   fund that draws ヴェルノア's companies to it, its pensions and its local trade —; after that every $ goes from someone
   to someone, between the two countries too. It has no companies of its own: ヴェルノア's companies open branches there
   as far as it pays them (`cats`), and its people work for the state, its local trade, or those branches.

   Its people are lighter than ヴェルノア's: a day at a time (no minutes, moods, friends or politics), in typed arrays
   (server/core/asuka.js), `population` of them in a full world (a smaller one by ヴェルノア's size).

   - `founding`: the parts of the founding money (of `total`).
   - `jobs`: the posts of the state (ATSUKA Vision) and of the local trade in a full country; `pay` a year's pay of each,
     and of a branch's people.
   - `tax`: income (of pay), consumption (on top of what is bought), corporate (of a branch's profit, credited in
     ヴェルノア: no tax twice), withholding (on a branch's profit sent home), rent (the land a branch stands on: of its
     sales, to the commerce zone).
   - `spend`: a person's year of spending — `wealth` of what they hold and `income` of what they earn —, `living` of it
     to the local trade (food, rent, the rest), the rest to `cats` as their tastes go.
   - `cats`: what ヴェルノア's companies sell there. `co` the company (or companies by share), `share` of the people's
     spending beyond living, `cap` a branch's sales a year at most, `staff` its people, `open` what a new one costs
     (built by ATSUKA Vision's zone), `rent` a branch's fixed rent a year, `cogs` where what it sold came from (its
     makers in ヴェルノア, `@sector` ヴェルノア's local trade) as parts of the sale, `digital`: sold without branches
     (ATSUKA Vision's store takes `platform` of it).
   - `atsuka`: its divisions (their part of its people, what each earns from ヴェルノア), `procure` what it buys of
     ヴェルノア's makers a year (of its fund) and `procureRevenue` (of what it earns), `hireFee` of a new hire's year to
     the job sites with a branch there.
   - `boost`: what the drawing fund pays a company of a new branch's cost (`share`, for `years` from the founding).
   - `bank`: the national bank's rate on what it lends; `quickCap` what a person may borrow at most (of their pay).
   - `tourism`: the part of ヴェルノア's people's outings that are trips to アスカ・リゾート. */
(function (BR) {
  'use strict';

  var DISTRICTS = [
    { id: 'haruka', name: 'ハルカ区', what: '首都・官庁街（ATSUKA Visionの本部）' },
    { id: 'minato', name: 'ミナト区', what: '国際港・物流ハブ' },
    { id: 'zone', name: 'フリーコマースゾーン', what: '世界最大級の商業区・社会実験特区（ヴェルノア企業の支店）' },
    { id: 'akatsuki', name: 'アカツキ区', what: '素材・エネルギー公社の工業地帯' },
    { id: 'sora', name: 'ソラ区', what: '住宅地・アスカ・リゾート' }
  ];

  var ATSUKA = {
    name: 'ATSUKA Vision',
    divisions: [
      { id: 'altas', name: 'アルタス（国営資源事業）', part: 0.6, what: 'レアメタル・金属・鉱石・素材・燃料・食料の採掘と集荷：ヴェルノア45社とアスカの商売の材料のもと（独占）' },
      { id: 'port', name: 'アスカ国際港・物流ハブ', part: 0.08, what: '両国の間の品物の港湾・通関の手数料' },
      { id: 'digital', name: 'アスカ・デジタル', part: 0.06, what: 'ゲームの配信手数料・ヴェルノア企業のサーバー' },
      { id: 'resort', name: 'アスカ・リゾート', part: 0.12, what: 'ヴェルノア市民の旅行' },
      { id: 'zone', name: 'フリーコマースゾーン・社会実験特区', part: 0.14, what: '支店の地代・建設' }
    ],
    // (of the trade between the two countries: the port's fee, paid by the one who pays)
    port: 0.01,
    procure: 0.04, procureRevenue: 0.2, hireFee: 0.02
  };

  // アルタス: ATSUKA Vision's state resource enterprise, the world's largest by its people (`part` of the state's posts),
  // and the only one: every company's raw materials, metals, ores, fuel and food are bought of it, at its prices — sold
  // only as much as is bought (never a fixed sale). Who buys of it and how much of what they spend — on their books
  // a line of its own (資源の仕入れ・材料費・資源・エネルギーの購入（アルタス）):
  // - the makers' materials (what they make for the others, for abroad and of their own), all of it
  // - `cogs`: of the cost of what each of ヴェルノア's thirteen sells (its streams' costs: the goods' and parts' raw
  //   materials, the food), and of what its branches in アスカ sell; the rest the local businesses that supply it
  // - `route`: of their running costs by kind (their buildings' energy and materials — a maker's plants' `plant` —,
  //   their research's, the rest, what selling cost: packing and fuel, their equipment's raw materials)
  // - `local`: of each local company's costs by its economy (or its own `imports`, if more)
  // - `shops`: of what ヴェルノア's people pay the small shops (their goods and food); `trade`: of what アスカ's people pay its
  //   local trade
  // Its prices (`price`: an index, 1 at the founding) it sets each month as a monopoly does, for as much as it can
  // take: up a step while what was bought of it held up and its customers (the thirteen) made money, down a step when
  // they lost it; within `min` and `max`. What they pay above the founding's prices is their cost (they pass it on in
  // their own prices as their plans are reviewed). Half its profit each month (`dividend`) is the treasury's, for the
  // country's own projects.
  var ALTAS = {
    name: 'アルタス', full: 'アルタス（ATSUKA Visionの国営資源事業）',
    cogs: { magita: 0.6, yosida: 0.6, wazima: 0.6, jinx: 0.45, carowner: 0.35, daizin: 0.4, myway: 0.35, dtrade: 0.1, speedeed: 0.1, citywork: 0.05, tenesice: 0, ice: 0, riru: 0 },
    route: { place: 0.1, plant: 0.3, rd: 0.05, other: 0.05, selling: 0.1, capex: 0.15 },
    local: { bank: 0.02, magita: 0.5, wazima: 0.35, yosida: 0.3, retail: 0.3, myway: 0.25, dtrade: 0.1, daizin: 0.5, games: 0.2, life: 0.45 },
    shops: 0.1, trade: 0.25,
    price: { min: 0.8, max: 2.5, up: 0.03, down: 0.03, margin: 0.45 },
    dividend: 0.5
  };

  var CATS = [
    { id: 'cars', name: '車（ディーラー・整備）', co: 'carowner', share: 0.3, cap: 3500000000, staff: 40, open: 1000000000, rent: 60000000, cogs: { magita: 0.4, yosida: 0.32, wazima: 0.1 } },
    { id: 'goods', name: '日用品・アイテム・ゲームソフト', co: 'jinx', share: 0.25, cap: 800000000, staff: 20, open: 250000000, rent: 20000000, cogs: { '@sector': 0.55 } },
    { id: 'casino', name: 'カジノリゾート', co: 'dtrade', share: 0.12, cap: 20000000000, staff: 300, open: 6000000000, rent: 300000000, cogs: {} },
    { id: 'vip', name: 'VIPラウンジ', co: 'daizin', share: 0.06, cap: 4000000000, staff: 30, open: 1200000000, rent: 50000000, cogs: { '@sector': 0.2 } },
    { id: 'games', name: 'ゲーム（配信）', co: { ice: 0.88, riru: 0.12 }, share: 0.12, digital: true, platform: 0.3 },
    { id: 'museum', name: 'ミュージアム・キャラクターグッズ', co: 'myway', share: 0.05, cap: 6000000000, staff: 60, open: 2000000000, rent: 100000000, cogs: { '@sector': 0.3 } },
    { id: 'bank', name: '銀行の窓口・決済', co: 'tenesice', share: 0.1, cap: 3000000000, staff: 25, open: 600000000, rent: 30000000, cogs: {} }
  ];

  var RULES = {
    population: 150000,
    founding: { total: 13000000000000, people: 0.6, atsuka: 0.15, treasury: 0.1, bank: 0.07, boost: 0.04, pension: 0.02, trade: 0.02 },
    jobs: { atsuka: 60000, trade: 45000 },
    pay: { atsuka: 2400000, trade: 2000000, branch: 2800000 },
    pension: 1500000,
    tax: { income: 0.12, consumption: 0.1, corporate: 0.2, withhold: 0.05, rent: 0.05 },
    spend: { wealth: 0.045, income: 0.85, living: 0.55 },
    boost: { share: 0.3, years: 3 },
    bank: { rate: 0.04, quickCap: 0.5 },
    tourism: 0.08,
    // (a year's chance of dying by age: Gompertz, as ヴェルノア's)
    mortality: { a: 0.00002, b: 0.095 },
    // (the trade's cushion: what it keeps of a month's takings before paying its owners)
    tradeKeep: 0.15,
    // its balance with ヴェルノア kept: `months` running of more going out than coming in (or the other way) move the
    // branches' land rent and the withholding on their profit by `step` (within `max`, back towards where they began);
    // its prices follow its people's money (the square root of it a head against the founding's), and ヴェルノア's
    // people travel there the more the cheaper it is; what the treasury has beyond `fund` times its founding part, a
    // tenth of it a month into ヴェルノア's government bonds at `bondRate` a year (its 政府系ファンド)
    policy: { months: 3, step: { rent: 0.005, withhold: 0.01 }, max: { rent: 0.1, withhold: 0.15 }, fund: 1.5, bondRate: 0.01 }
  };

  var byCat = {};
  CATS.forEach(function (c) { byCat[c.id] = c; });
  // the companies a category's sales go to, by share
  function companiesOf(cat) { return typeof cat.co === 'string' ? [[cat.co, 1]] : Object.keys(cat.co).map(function (k) { return [k, cat.co[k]]; }); }

  BR.ASUKA = { name: 'アスカ国', districts: DISTRICTS, atsuka: ATSUKA, altas: ALTAS, cats: CATS, cat: function (id) { return byCat[id] || null; }, companiesOf: companiesOf, rules: RULES };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
