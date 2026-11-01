/* NPCの国: the country of 50,000 people behind the companies (server/core/npc.js keeps it; the players' 街ライブ,
   js/ui/town.js, only shows it, and the operator site's 街 app, ops/town.js, all of it). Who and where they are, when
   they are about, what the country takes and gives, what its council and its people may change (and how far), how
   each company is organised and what its people may try, and the names they go by. Money is whole $ as everywhere
   in the game (the people say 円). Every number here is where things start: from then on the people, the companies,
   the districts and the country move them by themselves. The players can look at all of it and touch none of it. */
(function (BR) {
  'use strict';

  var MIN = 60000, JST = 9 * 3600000, DAY_MS = 86400000;

  /* ------------------------------------------------------------ the country --- */
  var NATION = { name: 'ヴェルノア共和国', short: 'ヴェルノア', en: 'VERNOIR', population: 50000, districts: 5 };
  // The five districts (1万人ずつ): what they are like, the companies with their head office there (whose local
  // taxes they take), and their places on the map (x, y in 0..100; r: how far the people there spread).
  var DISTRICTS = [
    { id: 0, key: 'soleil', name: 'ソレイユ区', kana: 'それいゆく', look: 'オフィス街。共働きと単身が多い', hq: ['tenesice', 'dtrade', 'citywork', 'speedeed'], color: '#f2b84b',
      places: { home: [[18, 22, 12], [80, 76, 12], [22, 80, 10]], office: [[50, 40, 14]], bank: [[44, 58, 4]], store: [[66, 54, 5]], casino: [[60, 24, 6]], park: [[30, 52, 7]], station: [[50, 66, 4]], hall: [[74, 34, 4]], hospital: [[86, 54, 4]], square: [[40, 30, 5]], dealer: [[16, 56, 4]], lounge: [], studio: [], factory: [], school: [[84, 18, 4]] } },
    { id: 1, key: 'eisen', name: 'アイゼン区', kana: 'あいぜんく', look: 'MAGITAとWAZIMAの工場と社宅、港とカーオーナーの中古車置き場', hq: ['magita', 'carowner', 'wazima'], color: '#8fa3b8',
      places: { home: [[20, 70, 13], [76, 78, 11]], office: [[30, 26, 6]], factory: [[62, 30, 16]], dealer: [[22, 44, 7]], bank: [[48, 64, 4]], store: [[52, 80, 5]], park: [[86, 52, 6]], station: [[40, 54, 4]], hall: [[12, 30, 4]], hospital: [[70, 62, 4]], square: [[44, 42, 5]], casino: [], lounge: [], studio: [], school: [[88, 20, 4]] } },
    { id: 2, key: 'canaria', name: 'カナリア区', kana: 'かなりあく', look: '商店街・ジンクスの大型店・大学。若者と学生', hq: ['jinx'], color: '#ef7d9a',
      places: { home: [[18, 24, 11], [82, 30, 10], [70, 82, 11]], office: [[46, 30, 5]], store: [[50, 52, 12]], school: [[22, 72, 10]], casino: [[78, 56, 5]], bank: [[36, 42, 4]], park: [[34, 86, 6]], station: [[56, 36, 5]], hall: [[86, 70, 4]], hospital: [[14, 46, 4]], square: [[62, 66, 6]], dealer: [], lounge: [], studio: [], factory: [] } },
    { id: 3, key: 'aurora', name: 'オーロラ区', kana: 'おーろらく', look: 'RIRU・Ice Smokerのスタジオと丘の上の高級住宅地、DAIZINのVIPラウンジ', hq: ['riru', 'ice', 'daizin'], color: '#9a7cf2',
      places: { home: [[26, 20, 12], [78, 22, 12], [50, 84, 10]], studio: [[30, 54, 9], [70, 52, 9]], lounge: [[52, 32, 6]], office: [[50, 58, 4]], casino: [[86, 74, 4]], bank: [[16, 76, 4]], store: [[36, 72, 5]], park: [[62, 72, 7]], station: [[50, 46, 3]], hall: [[12, 40, 4]], hospital: [[88, 40, 4]], square: [[50, 64, 4]], dealer: [[84, 88, 4]], factory: [], school: [] } },
    { id: 4, key: 'riviere', name: 'リヴィエール区', kana: 'りゔぃえーるく', look: '川沿いの住宅地と旧市街、下流にYOSIDAの本社工場。家族とお年寄り', hq: ['yosida'], color: '#5cc3a8',
      places: { home: [[24, 26, 14], [76, 24, 13], [28, 76, 13], [74, 76, 12]], park: [[50, 50, 10]], store: [[50, 26, 5]], bank: [[50, 74, 4]], hospital: [[14, 50, 6]], hall: [[86, 50, 5]], station: [[50, 88, 3]], square: [[62, 50, 4]], office: [[38, 50, 3]], casino: [], dealer: [], lounge: [], studio: [], factory: [[88, 86, 8]], school: [[50, 12, 4]] } }
  ];
  // the places on the map, by what is done there (a dot's place: 5 bits)
  var PLACES = ['home', 'office', 'factory', 'store', 'dealer', 'casino', 'lounge', 'studio', 'bank', 'park', 'station', 'hall', 'hospital', 'square', 'school', 'street'];
  var PLACE_NAMES = { home: '自宅', office: 'オフィス', factory: '工場', store: '商業施設', dealer: 'カーオーナー', casino: 'カジノ', lounge: 'VIPラウンジ', studio: 'スタジオ', bank: 'テネシス', park: '公園', station: '駅', hall: '区役所', hospital: '病院', square: '広場', school: '大学', street: '路上' };

  // what a person is doing (a dot's colour on the 街ライブ), and where it is done
  var ACTS = [
    { id: 'sleep', name: '睡眠', place: 'home', color: '#56649a' },
    { id: 'home', name: '家', place: 'home', color: '#7d8fc4' },
    { id: 'move', name: '移動', place: 'street', color: '#9aa4b5' },
    { id: 'work', name: '仕事', place: 'work', color: '#3d8bfd' },
    { id: 'lunch', name: '食事', place: 'store', color: '#f6a04d' },
    { id: 'shop', name: '買い物', place: 'store', color: '#ffb84d' },
    { id: 'car', name: '車を見る', place: 'dealer', color: '#e0605a' },
    { id: 'casino', name: 'カジノ', place: 'casino', color: '#e8c547' },
    { id: 'game', name: 'ゲーム', place: 'home', color: '#9a7cf2' },
    { id: 'invest', name: '投資', place: 'home', color: '#5cc3a8' },
    { id: 'lounge', name: 'VIPラウンジ', place: 'lounge', color: '#d79cf2' },
    { id: 'friends', name: '友達と', place: 'park', color: '#7fd16b' },
    { id: 'jobhunt', name: '仕事探し', place: 'station', color: '#c0c7d2' },
    { id: 'politics', name: '政治活動', place: 'hall', color: '#ff7a59' },
    { id: 'hospital', name: '病院', place: 'hospital', color: '#f2f2f2' },
    { id: 'study', name: '勉強', place: 'school', color: '#7ab7ff' },
    { id: 'parttime', name: 'バイト', place: 'store', color: '#58a6a6' },
    { id: 'demo', name: 'デモ・スト', place: 'square', color: '#ff4040' },
    { id: 'venture', name: '新サービス', place: 'store', color: '#46d1c8' },
    { id: 'walk', name: '散歩', place: 'park', color: '#6bbf6b' },
    { id: 'homeless', name: '路上', place: 'street', color: '#7a6a5a' },
    { id: 'bank', name: '銀行', place: 'bank', color: '#4bb3f2' },
    { id: 'outing', name: 'お出かけ', place: 'park', color: '#a3d977' },
    { id: 'meeting', name: '会議', place: 'work', color: '#2f6fd6' }
  ];
  var ACT = {};
  ACTS.forEach(function (a, i) { ACT[a.id] = i; });

  /* ------------------------------------------------------- when they are about --- */
  // The people live in real time, Japan's. On the day the country began they are about all 24 hours; from the next
  // day on, from 9:00 to 22:00 on Saturdays, Sundays and holidays, and from 11:00 to 22:00 on other days. Outside
  // those hours the country rests (nobody moves, nothing is bought); the companies' days still close at 9:00.
  var HOURS = { holiday: [9 * 60, 22 * 60], weekday: [11 * 60, 22 * 60], first: [0, 24 * 60] };
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dkey(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function dow(y, m, d) { return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }
  function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function nthMonday(y, m, n) { var first = dow(y, m, 1); return 1 + ((8 - first) % 7) + (n - 1) * 7; }
  function equinox(y, spring) { return Math.floor((spring ? 20.8431 : 23.2488) + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }
  var holidayCache = {};
  // Japan's national holidays of a year (the law's rules from 2020 on: the substitute days and the days between two)
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    var h = {}, set = function (m, d, name) { h[dkey(y, m, d)] = name; };
    set(1, 1, '元日'); set(1, nthMonday(y, 1, 2), '成人の日'); set(2, 11, '建国記念の日'); set(2, 23, '天皇誕生日');
    set(3, equinox(y, true), '春分の日'); set(4, 29, '昭和の日'); set(5, 3, '憲法記念日'); set(5, 4, 'みどりの日'); set(5, 5, 'こどもの日');
    set(7, nthMonday(y, 7, 3), '海の日'); set(8, 11, '山の日'); set(9, nthMonday(y, 9, 3), '敬老の日'); set(9, equinox(y, false), '秋分の日');
    set(10, nthMonday(y, 10, 2), 'スポーツの日'); set(11, 3, '文化の日'); set(11, 23, '勤労感謝の日');
    for (var m = 1; m <= 12; m++) {
      for (var d = 2; d < dim(y, m); d++) {
        if (h[dkey(y, m, d)] || dow(y, m, d) === 0) continue;
        if (h[dkey(y, m, d - 1)] && h[dkey(y, m, d + 1)]) h[dkey(y, m, d)] = '国民の休日';
      }
    }
    Object.keys(h).sort().forEach(function (k) {
      var p = k.split('-').map(Number);
      if (dow(p[0], p[1], p[2]) !== 0 || h[k] === '振替休日') return;
      var d2 = p[2] + 1;
      while (h[dkey(y, p[1], d2)]) d2++;
      if (d2 <= dim(y, p[1])) h[dkey(y, p[1], d2)] = '振替休日';
    });
    holidayCache[y] = h;
    return h;
  }
  // a moment in Japan: its date, weekday, minute of the day, and whether it is a day off (土日祝・年末年始)
  function jst(ms) {
    var t = new Date(ms + JST), y = t.getUTCFullYear(), m = t.getUTCMonth() + 1, d = t.getUTCDate(), w = t.getUTCDay();
    var name = holidays(y)[dkey(y, m, d)] || '';
    var newYear = (m === 12 && d >= 30) || (m === 1 && d <= 3);
    return { y: y, m: m, d: d, w: w, min: t.getUTCHours() * 60 + t.getUTCMinutes(), date: Math.floor((ms + JST) / DAY_MS), off: w === 0 || w === 6 || !!name || newYear, holiday: name || (newYear ? '年末年始' : '') };
  }
  // the hours of the day of `ms` the people are about ([from, to) in minutes of the day; `first`: the first day's date)
  function hoursOf(ms, first) {
    var t = jst(ms);
    if (first !== undefined && first !== null && t.date === first) return HOURS.first;
    return t.off ? HOURS.holiday : HOURS.weekday;
  }
  function activeAt(ms, first) { var h = hoursOf(ms, first), t = jst(ms); return t.min >= h[0] && t.min < h[1]; }
  // the next minute (ms) from `ms` on when the people are about
  function nextActive(ms, first) {
    var at = Math.ceil(ms / MIN) * MIN;
    for (var i = 0; i < 4; i++) {
      var t = jst(at), h = hoursOf(at, first);
      if (t.min < h[0]) return at + (h[0] - t.min) * MIN;
      if (t.min < h[1]) return at;
      at += (24 * 60 - t.min) * MIN;
    }
    return at;
  }

  /* ------------------------------------------------------- what they do for a living --- */
  // employers: 0 none, 1..10 the first ten companies, then the country's own and the rest (11..17), then the companies
  // that came home later (YOSIDA, WAZIMA: from 18 on, so that the people kept from before keep what they were)
  var COMPANY_IDS = ['tenesice', 'magita', 'carowner', 'jinx', 'daizin', 'citywork', 'speedeed', 'dtrade', 'riru', 'ice', 'yosida', 'wazima'];
  var JOB = { none: 0, civil: 11, other: 12, self: 13, part: 14, student: 15, home: 16, retired: 17 };
  var LATER_JOBS = 18;
  var JOB_NAMES = ['無職', 'テネシス', 'MAGITA', 'カーオーナー', 'ジンクス', 'DAIZIN', 'シティーワーク', 'スピーディード', 'Dtrade', 'RIRU STUDIO', 'Ice Smoker', '公務員', 'その他の職場', '自営業', 'パート・バイト', '大学生', '家事中心', '年金生活',
    'YOSIDA', 'WAZIMA'];
  // a company's job code, the company of a code (null: not a company's), and whether a code is a company's
  function jobOf(id) { var k = COMPANY_IDS.indexOf(id); return k < 0 ? -1 : k < 10 ? k + 1 : LATER_JOBS + k - 10; }
  function companyOf(j) { return j >= 1 && j <= 10 ? COMPANY_IDS[j - 1] : j >= LATER_JOBS ? COMPANY_IDS[10 + j - LATER_JOBS] || null : null; }
  function isCompanyJob(j) { return !!companyOf(j); }
  // a job with a payslip: a company's, the country's or another workplace's (not one's own business, not a part time job)
  function employed(j) { return isCompanyJob(j) || j === JOB.civil; }
  // anything that is work (a company, the country, another workplace, one's own, a part time job)
  function working(j) { return isCompanyJob(j) || (j >= JOB.civil && j <= JOB.part); }
  // how each works ([start, end] in minutes of the day; shift: early and late; off: on days off too; days: days off a week)
  var SCHEDULES = {
    bank: { blocks: [[525, 1050]], off: false },
    office: { blocks: [[540, 1080]], off: false },
    retail: { shifts: [[600, 1140], [780, 1320]], off: true, days: 2 },
    factory: { shifts: [[360, 900], [840, 1380]], off: false },
    studio: { blocks: [[600, 1140]], off: false, flex: 60 },
    civil: { blocks: [[510, 1035]], off: false },
    other: { blocks: [[540, 1080]], off: false },
    self: { blocks: [[600, 1140]], off: true, days: 1, flex: 90 },
    part: { blocks: [[600, 840]], off: true, days: 3 },
    student: { blocks: [[540, 900]], off: false }
  };
  var COMPANY_SCHEDULE = { tenesice: 'bank', magita: 'factory', carowner: 'retail', jinx: 'retail', daizin: 'office', citywork: 'office', speedeed: 'office', dtrade: 'office', riru: 'studio', ice: 'studio',
    yosida: 'factory', wazima: 'factory' };
  // where each company's people work: its districts, and how many of them there
  var SITES = {
    tenesice: [[0, 0.5], [1, 0.12], [2, 0.14], [3, 0.12], [4, 0.12]], magita: [[1, 0.92], [0, 0.08]], carowner: [[1, 0.55], [0, 0.2], [3, 0.25]],
    jinx: [[2, 0.5], [0, 0.15], [1, 0.12], [3, 0.1], [4, 0.13]], daizin: [[3, 1]], citywork: [[0, 1]], speedeed: [[0, 1]], dtrade: [[0, 0.8], [2, 0.15], [3, 0.05]],
    riru: [[3, 1]], ice: [[3, 1]], yosida: [[4, 0.7], [1, 0.3]], wazima: [[1, 0.85], [4, 0.15]]
  };

  /* --------------------------------------------------------------- the country's books --- */
  // Taxes and contributions (as in Japan, the amounts by 0.85 for this world). Income tax by brackets of the taxable
  // income ([up to, rate]); the resident tax a share of it to the district; social insurance on pay, the company and
  // the person half and half (employment: 0.95% and 0.6%; care from 40); those not employed pay the 国民年金 and the
  // 国民健康保険. Consumption tax starts at 0 (the council and the people may raise it to 15%).
  var TAX = {
    income: [[1657500, 0.05], [2805000, 0.1], [5907500, 0.2], [7650000, 0.23], [15300000, 0.33], [34000000, 0.4], [Infinity, 0.45]],
    basic: 408000, employment: [0.3, 1650000], resident: 0.1, gains: 0.2,
    inheritance: { free: 30000000, perHeir: 6000000, rates: [[10000000, 0.1], [30000000, 0.15], [50000000, 0.2], [100000000, 0.3], [200000000, 0.4], [300000000, 0.45], [600000000, 0.5], [Infinity, 0.55]] },
    corporate: { nation: 0.7 } // of a company's taxes: the rest is its head office's district's (住民税・事業税)
  };
  var SOCIAL = {
    pension: 0.183, health: 0.1, employment: [0.0095, 0.006], care: 0.018, careFrom: 40,
    national: 14400, nhi: 0.1, nhiCap: 900000, employerShare: 0.1525
  };
  // the pension: from 18 to 59 paid in; from 60 paid out (by 10 years paid at least), a month later on 0.7% more each
  // (to 70); 国民年金 in full (504 months) and 厚生年金 by the pay and the months; paid every even month on the 15th
  var PENSION = {
    from: 18, until: 60, age: 60, defer: 70, deferUp: 0.007, minMonths: 120, fullMonths: 504, basic: 690000, rate: 0.005481,
    survivor: 0.75, workCap: 400000, payMonths: [2, 4, 6, 8, 10, 12], payDay: 15, slide: 0.009
  };
  var SAFETY = { living: 110000, medical: 0.3, medicalOld: 0.2, oldFrom: 70, medicalCap: 680000, jobless: [0.5, 0.8], joblessDays: [90, 330], burial: 300000 };
  var RETIRE = { at: 60, rehire: 65, severance: 2.2 }; // a year's pay for every... (severance: months of pay a year worked)
  // (`investDay`: what a person may buy of shares in a day, all together; `tradesDay`: the orders a person may make in a
  // day, buys and sales together — the players': js/game/stocks.js tradesPerDay)
  var LIFE = { adult: 18, mean: 80, gompertz: 0.085, phone: 100000, casinoMonthly: 1000000, investDay: 50000000, tradesDay: 15 };
  // the money troubles: a loan from Tenesice at a high rate first (its クイックローン), then a friend's or family's
  // home (居候), then the street; the 生活保護 picks those it reaches
  var TROUBLE = { quickRate: 0.178, quickMax: 30000000, quickBase: 3000000, stayDays: 120, homelessFloor: -50000000 };

  // What the council and the people may change, and how far (運営 may narrow, widen or lock each of them). `player`:
  // it reaches the players too (the fees they pay and MAGITA's surcharge): never lower than half of where it began.
  var KNOBS = [
    { id: 'incomeShift', group: '税', name: '所得税（全体の上げ下げ）', start: 0, min: -5, max: 5, step: 1, unit: 'pt' },
    { id: 'residentTax', group: '税', name: '住民税', start: 10, min: 6, max: 12, step: 1, unit: '%' },
    { id: 'consumptionTax', group: '税', name: '消費税', start: 0, min: 0, max: 15, step: 1, unit: '%' },
    { id: 'pensionRate', group: '年金', name: '厚生年金の保険料率', start: 18.3, min: 15, max: 22, step: 0.5, unit: '%' },
    { id: 'pensionAge', group: '年金', name: '年金を受け取る年齢', start: 60, min: 55, max: 65, step: 1, unit: '歳' },
    { id: 'pensionLevel', group: '年金', name: '年金額の見直し', start: 0, min: -10, max: 10, step: 1, unit: '%' },
    { id: 'minWage', group: '働く', name: '最低賃金（年）', start: 1800000, min: 1200000, max: 2400000, step: 100000, unit: '$' },
    { id: 'overtime', group: '働く', name: '残業の上限（月）', start: 45, min: 30, max: 80, step: 5, unit: '時間' },
    { id: 'jobless', group: '保障', name: '失業手当', start: 0, min: -30, max: 30, step: 5, unit: '%' },
    { id: 'welfare', group: '保障', name: '生活保護', start: 0, min: -30, max: 30, step: 5, unit: '%' },
    { id: 'medical', group: '保障', name: '医療の自己負担', start: 0, min: -30, max: 30, step: 5, unit: '%' },
    { id: 'publicWorks', group: '予算', name: '公共事業', start: 0, min: -40, max: 40, step: 10, unit: '%' },
    { id: 'grants', group: '予算', name: '地区への交付金', start: 0, min: -30, max: 30, step: 10, unit: '%' },
    { id: 'inflation', group: '経済', name: 'テネシスの物価目標', start: 2, min: 1, max: 3, step: 0.5, unit: '%' },
    { id: 'magitaSurcharge', group: '企業', name: 'MAGITAの値上げ（上限）', start: 3000000, min: 1500000, max: 3000000, step: 500000, unit: '$', player: true },
    { id: 'winFee', group: '企業', name: 'Dtradeの勝利金手数料', start: 6, min: 3, max: 6, step: 0.5, unit: '%', player: true },
    { id: 'exchangeFee', group: '企業', name: 'Dtradeの交換手数料', start: 40000, min: 20000, max: 40000, step: 5000, unit: '$', player: true },
    { id: 'tradeFee', group: '企業', name: 'Dtradeの株の手数料', start: 1.8, min: 0.9, max: 1.8, step: 0.1, unit: '%', player: true },
    { id: 'jobFee', group: '企業', name: '求人サイトの掲載料', start: 25, min: 12.5, max: 25, step: 2.5, unit: '%', player: true },
    // (what only 運営 sets: the council and the people never move these) the pay at each company and elsewhere, against
    // what it is (a change scales everyone's there at once, and the new hires' with it), the cost of living, the
    // rents, the phone bill, the quick loans' rate, how far Tenesice lends to the country (beyond it the country
    // cannot pay all it owes: 財政破綻), the people's own limit on the market a day
    { id: 'pay:tenesice', group: '給与', name: 'テネシスの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:magita', group: '給与', name: 'MAGITAの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:carowner', group: '給与', name: 'カーオーナーの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:jinx', group: '給与', name: 'ジンクスの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:daizin', group: '給与', name: 'DAIZINの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:citywork', group: '給与', name: 'シティーワークの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:speedeed', group: '給与', name: 'スピーディードの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:dtrade', group: '給与', name: 'Dtradeの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:riru', group: '給与', name: 'RIRU STUDIOの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:ice', group: '給与', name: 'Ice Smokerの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:civil', group: '給与', name: '公務員の給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'pay:local', group: '給与', name: '地元の店・自営業・パートの給与水準', start: 0, min: -50, max: 200, step: 5, unit: '%', ops: true },
    { id: 'livingCost', group: '暮らし', name: '日用品の物価', start: 0, min: -50, max: 300, step: 5, unit: '%', ops: true },
    { id: 'rentLevel', group: '暮らし', name: '家賃の水準', start: 0, min: -50, max: 300, step: 5, unit: '%', ops: true },
    { id: 'phoneBill', group: '暮らし', name: 'テネシス・モバイルの月額', start: 100000, min: 0, max: 1000000, step: 10000, unit: '$', ops: true },
    { id: 'quickRate', group: '金融', name: 'クイックローンの金利', start: 17.8, min: 1, max: 40, step: 0.1, unit: '%', ops: true },
    { id: 'debtCap', group: '金融', name: 'テネシスが国に貸す上限（最初の残高に対して）', start: 300, min: 100, max: 2000, step: 10, unit: '%', ops: true },
    { id: 'investDaily', group: '金融', name: '市民の株の購入上限（1日）', start: LIFE.investDay, min: 0, max: 1000000000, step: 1000000, unit: '$', ops: true }
  ];
  var KNOB = {};
  KNOBS.forEach(function (k) { KNOB[k.id] = k; });
  // a knob as it is now in a country (one added after the country began: where it starts)
  function knobOf(W, id) { var v = W && W.nation && W.nation.knobs ? W.nation.knobs[id] : undefined; return v === undefined || v === null ? KNOB[id].start : v; }
  // a knob changes from the 1st of the next month, once a quarter at most; a citizens' vote needs these
  var CHANGE = { quarterOnce: true };
  var VOTES = {
    national: { share: 0.1, days: 60, turnout: 0.4 },
    district: { share: 0.2, days: 60, turnout: 0.4 },
    recall: { share: 1 / 3, days: 60, turnout: 0.4 },
    // a mayor serves six months: elected in April and October, two weeks of campaign, the vote on a Sunday
    term: 6, months: [4, 10], campaign: 14
  };
  // what a candidate may promise (what it moves in the district: the budget's parts and the mood)
  var PLATFORMS = [
    { id: 'taxcut', name: '住民税の減税', fix: 'tax' }, { id: 'shops', name: '商店街の応援', fix: 'prices' }, { id: 'firms', name: '企業を呼ぶ', fix: 'wages' },
    { id: 'works', name: '公共事業', fix: 'wages' }, { id: 'welfare', name: 'お年寄りと失業者の福祉', fix: 'pension' }, { id: 'festival', name: 'お祭りとイベント', fix: 'mayor' },
    { id: 'safety', name: '治安と暮らしの安心', fix: 'mayor' }, { id: 'rent', name: '家賃の補助', fix: 'prices' }
  ];
  // what people grow discontented about (a byte each)
  var THEMES = [
    { id: 'tax', name: '税が高い' }, { id: 'pension', name: '年金が足りない' }, { id: 'prices', name: '物価が高い' }, { id: 'wages', name: '給料が安い' },
    { id: 'gap', name: '格差' }, { id: 'magita', name: 'MAGITAの値上げ' }, { id: 'dtrade', name: 'Dtradeの手数料' }, { id: 'mayor', name: '区長への不信' }
  ];
  // what a theme asks of the country when the people move on it (the knob, and which way)
  var DEMANDS = { tax: ['consumptionTax', -1], pension: ['pensionLevel', 1], prices: ['consumptionTax', -1], wages: ['minWage', 1], gap: ['incomeShift', 1], magita: ['magitaSurcharge', -1], dtrade: ['winFee', -1] };

  /* ---------------------------------------------------------------- the companies' people --- */
  // Every company's departments: `kind` says what the department does in the company's mind (server/core/npc-org.js),
  // `share` how many of its people work there, `roles`: the posts named in it besides its 部長 and 課長. Each has its
  // CEO and 社長 and a few 役員 in 経営陣, its 経理, 総務 and ストップ係 (who may stop any decision), and the rest of
  // its own trade. The people in these posts are citizens like any other.
  var ORG = {
    tenesice: [
      ['exec', '経営陣', 'exec', 0.002], ['lending', '融資本部', 'lend', 0.07, [['pick', '融資先選定担当'], ['rate', '金利決定担当'], ['amount', '融資額決定担当']]],
      ['branch', '支店営業部', 'branch', 0.42], ['mobile', '通信事業部（テネシス・モバイル）', 'mobile', 0.12], ['venture', '新事業開拓部', 'venture', 0.04, [['scout', '新事業企画担当']]],
      ['tech', 'システム技術部', 'tech', 0.13, [['cto', '技術責任者']]], ['market', '市場部', 'market', 0.05], ['plan', '経営企画部', 'plan', 0.03],
      ['acct', '経理部', 'acct', 0.05], ['admin', '総務部', 'admin', 0.06], ['stop', 'リスク管理室（ストップ係）', 'stop', 0.018, [['stopper', 'ストップ係']]]
    ],
    magita: [
      ['exec', '経営陣', 'exec', 0.003], ['factory', '製造本部', 'factory', 0.62], ['analysis', '競合他社分析室', 'analysis', 0.01, [['analyst', '主任アナリスト']]],
      ['nego', '交渉部', 'nego', 0.008, [['negotiator', '交渉係']]], ['product', '製品開発部', 'product', 0.06], ['rd', '研究開発本部', 'rdhub', 0.02],
      ['sales', '法人営業部', 'sales', 0.08], ['acct', '経理部', 'acct', 0.03], ['admin', '総務部', 'admin', 0.04], ['stop', '監査室（ストップ係）', 'stop', 0.01, [['stopper', 'ストップ係']]],
      ['plan', '経営企画部', 'plan', 0.01]
    ],
    carowner: [
      ['exec', '経営陣', 'exec', 0.003], ['store', '店舗営業部', 'store', 0.5, [['clerk', '店長']]], ['service', '整備部', 'service', 0.22],
      ['nego', '仕入れ交渉部', 'nego', 0.01, [['negotiator', '値段交渉係']]], ['advisor', 'ビジネスアドバイザー室', 'advisor', 0.006, [['advisor', 'ビジネスアドバイザー']]],
      ['plan', '経営計画室', 'plan', 0.01, [['planner', '計画立案者']]], ['venture', '新事業展開室', 'venture', 0.04, [['scout', '新事業企画担当']]],
      ['acct', '経理部', 'acct', 0.04], ['admin', '総務部', 'admin', 0.05], ['stop', '監査室（ストップ係）', 'stop', 0.01, [['stopper', 'ストップ係']]], ['used', '中古車部', 'used', 0.1]
    ],
    jinx: [
      ['exec', '経営陣', 'exec', 0.003], ['store', '店舗運営部', 'store', 0.62], ['trade', '取引部', 'trade', 0.05, [['buyer', '取引担当']]],
      ['partner', '連携推進部', 'partner', 0.02, [['liaison', '連携担当']]], ['logistics', '物流部', 'logistics', 0.15], ['venture', '新事業室', 'venture', 0.02, [['scout', '新事業企画担当']]],
      ['acct', '経理部', 'acct', 0.04], ['admin', '総務部', 'admin', 0.05], ['stop', '監査室（ストップ係）', 'stop', 0.01, [['stopper', 'ストップ係']]]
    ],
    daizin: [
      ['exec', '経営陣', 'exec', 0.01], ['concierge', 'VIPコンシェルジュ部', 'concierge', 0.4], ['lounge', 'ラウンジ運営部', 'lounge', 0.35],
      ['plan', '会員企画部', 'plan', 0.08, [['planner', '会員企画担当']]], ['acct', '経理部', 'acct', 0.06], ['admin', '総務部', 'admin', 0.07], ['stop', '監査室（ストップ係）', 'stop', 0.03, [['stopper', 'ストップ係']]]
    ],
    citywork: [
      ['exec', '経営陣', 'exec', 0.006], ['sales', '広告営業部', 'sales', 0.42], ['media', '求人メディア部', 'media', 0.22], ['tech', 'マッチング開発部', 'tech', 0.16, [['cto', '技術責任者']]],
      ['analysis', '市場調査室', 'analysis', 0.03, [['analyst', '主任アナリスト']]], ['acct', '経理部', 'acct', 0.05], ['admin', '総務部', 'admin', 0.07], ['stop', '監査室（ストップ係）', 'stop', 0.02, [['stopper', 'ストップ係']]]
    ],
    speedeed: [
      ['exec', '経営陣', 'exec', 0.01], ['tech', '検索エンジン開発部', 'tech', 0.4, [['cto', '技術責任者']]], ['sales', '広告営業部', 'sales', 0.3], ['growth', 'グロース部', 'plan', 0.1, [['planner', 'グロース担当']]],
      ['acct', '経理部', 'acct', 0.06], ['admin', '総務部', 'admin', 0.07], ['stop', '監査室（ストップ係）', 'stop', 0.02, [['stopper', 'ストップ係']]]
    ],
    dtrade: [
      ['exec', '経営陣', 'exec', 0.01], ['casino', 'カジノ運営部', 'casino', 0.35], ['market', '証券部', 'market', 0.2], ['asset', '資産運用部', 'asset', 0.1, [['manager', 'ファンドマネージャー']]],
      ['tech', 'システム技術部', 'tech', 0.15, [['cto', '技術責任者']]], ['acct', '経理部', 'acct', 0.06], ['admin', '総務部', 'admin', 0.06], ['stop', 'リスク管理室（ストップ係）', 'stop', 0.03, [['stopper', 'ストップ係']]]
    ],
    riru: [
      ['exec', '経営陣', 'exec', 0.01], ['dev', '開発部', 'dev', 0.75, [['director', 'ディレクター'], ['producer', 'プロデューサー']]], ['qa', '品質管理部', 'qa', 0.08],
      ['publish', '宣伝部', 'publish', 0.05], ['acct', '経理部', 'acct', 0.04], ['admin', '総務部', 'admin', 0.05], ['stop', '監査室（ストップ係）', 'stop', 0.02, [['stopper', 'ストップ係']]]
    ],
    ice: [
      ['exec', '経営陣', 'exec', 0.005], ['dev', '開発本部', 'dev', 0.55, [['director', 'ディレクター'], ['producer', 'プロデューサー']]], ['live', '運営型タイトル部', 'live', 0.18],
      ['qa', '品質管理部', 'qa', 0.07], ['publish', 'パブリッシング部', 'publish', 0.06], ['acct', '経理部', 'acct', 0.04], ['admin', '総務部', 'admin', 0.06], ['stop', '監査室（ストップ係）', 'stop', 0.02, [['stopper', 'ストップ係']]]
    ],
    yosida: [
      ['exec', '経営陣', 'exec', 0.003], ['factory', '自社一貫工場', 'factory', 0.6], ['analysis', '競合他社分析室', 'analysis', 0.01, [['analyst', '主任アナリスト']]],
      ['nego', '営業・交渉部', 'nego', 0.01, [['negotiator', '交渉係']]], ['product', '車両・エンジン開発部', 'product', 0.06], ['bio', 'バイオテクノロジー本部（金の生る木）', 'rd', 0.08],
      ['game', 'ゲーム事業部（クエスト・ガチャ）', 'plan', 0.05, [['planner', 'ゲーム事業企画担当']]], ['sales', '法人・海外営業部', 'sales', 0.08],
      ['acct', '経理部', 'acct', 0.03], ['admin', '総務部', 'admin', 0.04], ['stop', '監査室（ストップ係）', 'stop', 0.01, [['stopper', 'ストップ係']]]
    ],
    wazima: [
      ['exec', '経営陣', 'exec', 0.004], ['factory', '省人化工場', 'factory', 0.55], ['codev', 'MAGITA共同開発部', 'product', 0.12], ['cost', 'コスト削減研究所', 'rd', 0.12, [['cto', '研究所長']]],
      ['plan', '経営企画部', 'plan', 0.03], ['acct', '経理部', 'acct', 0.04], ['admin', '総務部', 'admin', 0.06], ['stop', '監査室（ストップ係）', 'stop', 0.015, [['stopper', 'ストップ係']]]
    ]
  };
  // the ranks (a person's post): 0 staff, 1 主任, 2 課長, 3 部長, 4 役員, 5 社長, 6 CEO; pay against the company's average
  var RANKS = [{ name: '社員', pay: 0.85 }, { name: '主任', pay: 1.05 }, { name: '課長', pay: 1.4 }, { name: '部長', pay: 1.9 }, { name: '役員', pay: 3.2 }, { name: '社長', pay: 6 }, { name: 'CEO', pay: 7.5 }];

  // MAGITA's research departments (研究開発本部): the four it has, and the themes a new one may take up
  var LABS = [
    { id: 'frontier', name: '先端部門', theme: 'RIMU', share: 0.25 }, { id: 'adv1', name: '高度I部門', theme: 'A1', share: 0.25 },
    { id: 'adv2', name: '高度II部門', theme: 'T1', share: 0.25 }, { id: 'adv3', name: '高度III部門', theme: 'MOL1', share: 0.25 }
  ];
  var LAB_THEMES = [
    { id: 'battery', name: '次世代バッテリー', months: 18, chance: 0.6, cut: 0.05, appeal: 0.06 },
    { id: 'light', name: '超軽量ボディ素材', months: 14, chance: 0.7, cut: 0.06, appeal: 0.03 },
    { id: 'drive', name: '自動運転支援', months: 24, chance: 0.5, cut: 0, appeal: 0.1 },
    { id: 'engine', name: '高効率エンジン', months: 12, chance: 0.75, cut: 0.04, appeal: 0.04 },
    { id: 'safety', name: '衝突安全', months: 10, chance: 0.8, cut: 0, appeal: 0.05 },
    { id: 'design', name: 'デザイン刷新', months: 8, chance: 0.85, cut: 0, appeal: 0.06 },
    { id: 'robot', name: '工場ロボット化', months: 20, chance: 0.6, cut: 0.08, appeal: 0 },
    { id: 'material', name: '素材の地産化', months: 16, chance: 0.65, cut: 0.07, appeal: 0 }
  ];

  // New businesses a company may start (新事業): what it sells to the people (`fee` a month, or `use` a time), for whom
  // (`fit`: the people it suits), what serving them costs (`cost` of the fee) and how many it takes to run (`staff` a
  // thousand customers). The ones that do well grow; the ones that do not are closed.
  var VENTURES = {
    tenesice: [
      { id: 'wealth', name: '資産運用アプリ「テネシス・ウェルス」', fee: 120000, cost: 0.35, staff: 6, fit: 'saver' },
      { id: 'black', name: 'プレミアムカード「テネシス・ブラック」', fee: 300000, cost: 0.3, staff: 4, fit: 'rich' },
      { id: 'life', name: '生命保険「テネシス生命」', fee: 60000, cost: 0.62, staff: 5, fit: 'family' },
      { id: 'home', name: '住宅ローン相談「マイホームプラン」', use: 400000, cost: 0.4, staff: 8, fit: 'family' },
      { id: 'pay', name: 'キャッシュレス決済「テネペイ」', fee: 15000, cost: 0.45, staff: 3, fit: 'young' },
      { id: 'startup', name: '起業支援ファンド', use: 2000000, cost: 0.5, staff: 10, fit: 'ambitious' }
    ],
    carowner: [
      { id: 'lease', name: 'カーリース「マイカーサブスク」', fee: 650000, cost: 0.72, staff: 8, fit: 'carless' },
      { id: 'coating', name: '洗車・コーティング専門店', use: 180000, cost: 0.45, staff: 12, fit: 'car' },
      { id: 'rental', name: 'レンタカー', use: 120000, cost: 0.55, staff: 10, fit: 'carless' },
      { id: 'school', name: 'ドライビングスクール', use: 900000, cost: 0.5, staff: 15, fit: 'young' },
      { id: 'auction', name: '中古車オークション', use: 350000, cost: 0.4, staff: 6, fit: 'car' }
    ],
    jinx: [
      { id: 'delivery', name: '即日宅配「ジンクス便」', fee: 9800, cost: 0.6, staff: 8, fit: 'busy' },
      { id: 'cafe', name: '店内カフェ', use: 1500, cost: 0.55, staff: 14, fit: 'social' },
      { id: 'pb', name: 'プライベートブランド家電', use: 250000, cost: 0.6, staff: 6, fit: 'family' }
    ],
    magita: [{ id: 'repair', name: '出張修理サービス', use: 260000, cost: 0.5, staff: 10, fit: 'car' }],
    daizin: [{ id: 'travel', name: 'VIP旅行', use: 3500000, cost: 0.6, staff: 6, fit: 'rich' }],
    dtrade: [{ id: 'robo', name: 'ロボアドバイザー', fee: 50000, cost: 0.3, staff: 3, fit: 'saver' }],
    citywork: [{ id: 'career', name: 'キャリア相談', use: 80000, cost: 0.45, staff: 10, fit: 'seeker' }],
    speedeed: [{ id: 'side', name: '副業マッチング', fee: 20000, cost: 0.3, staff: 3, fit: 'young' }],
    riru: [{ id: 'goods', name: 'グッズショップ', use: 12000, cost: 0.55, staff: 6, fit: 'gamer' }],
    ice: [{ id: 'esports', name: 'eスポーツリーグ', fee: 5000, cost: 0.5, staff: 8, fit: 'gamer' }]
  };

  // the people's names (made up from these at random: nobody real)
  var FAMILY = ('佐藤:さとう 鈴木:すずき 高橋:たかはし 田中:たなか 伊藤:いとう 渡辺:わたなべ 山本:やまもと 中村:なかむら 小林:こばやし 加藤:かとう 吉田:よしだ 山田:やまだ ' +
    '佐々木:ささき 山口:やまぐち 松本:まつもと 井上:いのうえ 木村:きむら 林:はやし 斎藤:さいとう 清水:しみず 山崎:やまざき 森:もり 池田:いけだ 橋本:はしもと 阿部:あべ ' +
    '石川:いしかわ 山下:やました 中島:なかじま 石井:いしい 小川:おがわ 前田:まえだ 岡田:おかだ 長谷川:はせがわ 藤田:ふじた 後藤:ごとう 近藤:こんどう 村上:むらかみ ' +
    '遠藤:えんどう 青木:あおき 坂本:さかもと 福田:ふくだ 太田:おおた 西村:にしむら 藤井:ふじい 金子:かねこ 岡本:おかもと 藤原:ふじわら 中野:なかの 三浦:みうら ' +
    '原田:はらだ 中川:なかがわ 松田:まつだ 竹内:たけうち 小野:おの 田村:たむら 中山:なかやま 和田:わだ 石田:いしだ 森田:もりた 上田:うえだ 原:はら 内田:うちだ ' +
    '柴田:しばた 酒井:さかい 宮崎:みやざき 横山:よこやま 高木:たかぎ 安藤:あんどう 宮本:みやもと 大野:おおの 小島:こじま 谷口:たにぐち 今井:いまい 工藤:くどう ' +
    '高田:たかだ 増田:ますだ 丸山:まるやま 杉山:すぎやま 村田:むらた 大塚:おおつか 小山:こやま 藤本:ふじもと 平野:ひらの 新井:あらい 河野:こうの 上野:うえの ' +
    '武田:たけだ 野口:のぐち 松井:まつい 千葉:ちば 岩崎:いわさき 菅原:すがわら 木下:きのした 久保:くぼ 佐野:さの 野村:のむら 松尾:まつお 市川:いちかわ 菊地:きくち ' +
    '杉本:すぎもと 古川:ふるかわ 大西:おおにし 島田:しまだ 水野:みずの 桜井:さくらい 高野:たかの 吉川:よしかわ 山内:やまうち 西田:にしだ 飯田:いいだ 菅野:すがの ' +
    '永井:ながい 久保田:くぼた 服部:はっとり 川口:かわぐち 星野:ほしの 白石:しらいし 黒田:くろだ 神崎:かんざき 朝倉:あさくら 柊:ひいらぎ 鷹野:たかの 九条:くじょう ' +
    '一条:いちじょう 天野:あまの 如月:きさらぎ 東雲:しののめ 早乙女:さおとめ 結城:ゆうき 氷室:ひむろ 霧島:きりしま 月島:つきしま 鳳:おおとり 桐生:きりゅう ' +
    '真壁:まかべ 榊:さかき 御堂:みどう 紫藤:しどう 鏑木:かぶらぎ').split(' ').map(function (x) { return x.split(':'); });
  var MALE = ('翔太:しょうた 大輝:だいき 蓮:れん 悠真:ゆうま 陽翔:はると 湊:みなと 蒼:あおい 樹:いつき 大和:やまと 颯太:そうた 健太:けんた 拓海:たくみ 優斗:ゆうと ' +
    '隼人:はやと 海斗:かいと 亮:りょう 誠:まこと 浩二:こうじ 和也:かずや 直樹:なおき 健一:けんいち 剛:つよし 修:おさむ 茂:しげる 博:ひろし 隆:たかし 清:きよし ' +
    '勇気:ゆうき 涼介:りょうすけ 恭平:きょうへい 慎也:しんや 雄大:ゆうだい 賢治:けんじ 達也:たつや 翼:つばさ 光:ひかる 律:りつ 朝陽:あさひ 奏太:かなた 陸:りく ' +
    '怜:れい 晴:はる 康介:こうすけ 圭:けい 秀樹:ひでき 正和:まさかず 智也:ともや 啓太:けいた 俊介:しゅんすけ 一輝:かずき 遼:りょう 響:ひびき 匠:たくみ 景:けい ' +
    '尚人:なおと 昌平:しょうへい 耕平:こうへい 栄一:えいいち 龍之介:りゅうのすけ 瑛太:えいた 悠人:ゆうと 大地:だいち 誠司:せいじ 雅人:まさと 拓真:たくま 優:ゆう ' +
    '新:あらた 透:とおる 武:たけし 稔:みのる 功:いさお 隆之:たかゆき 哲也:てつや 克也:かつや 浩之:ひろゆき 洋平:ようへい 航:わたる 迅:じん 煌:こう 凪:なぎ ' +
    '玲央:れお 柊真:とうま 蒼真:そうま 晃:あきら 史郎:しろう 慶:けい').split(' ').map(function (x) { return x.split(':'); });
  var FEMALE = ('陽菜:ひな 結衣:ゆい 美咲:みさき 葵:あおい 凛:りん さくら:さくら 芽依:めい 紬:つむぎ 莉子:りこ 美羽:みう 彩:あや 優花:ゆうか 七海:ななみ 真由:まゆ ' +
    '千尋:ちひろ 愛:あい 恵:めぐみ 裕子:ゆうこ 直美:なおみ 久美子:くみこ 由美:ゆみ 智子:ともこ 明美:あけみ 幸子:さちこ 和子:かずこ 洋子:ようこ 京子:きょうこ ' +
    '麻衣:まい 沙織:さおり 舞:まい 香織:かおり 綾香:あやか 瞳:ひとみ 遥:はるか 杏:あん 楓:かえで 澪:みお 詩織:しおり 琴音:ことね 栞:しおり 心春:こはる ' +
    '柚葉:ゆずは 美月:みづき 菜々子:ななこ 玲奈:れいな 理沙:りさ 由香:ゆか 早紀:さき 春香:はるか 朱里:あかり 結菜:ゆいな 咲良:さくら 日向:ひなた 雫:しずく ' +
    '茜:あかね 環:たまき 志保:しほ 美穂:みほ 夏美:なつみ 加奈:かな 真理子:まりこ 静香:しずか 千夏:ちなつ 亜美:あみ 奈央:なお 若菜:わかな 紗希:さき 灯:あかり ' +
    '美桜:みお 桃子:ももこ 文香:ふみか 涼子:りょうこ 敦子:あつこ 典子:のりこ 貴子:たかこ 弥生:やよい 小百合:さゆり 純子:じゅんこ 薫:かおる 光:ひかり 紫苑:しおん ' +
    '花音:かのん 凪咲:なぎさ 琥珀:こはく 椿:つばき 瑠璃:るり 透子:とうこ').split(' ').map(function (x) { return x.split(':'); });

  // the full name and its reading of a person (sex 0 male, 1 female)
  function nameOf(fam, given, sex) {
    var f = FAMILY[fam % FAMILY.length], g = (sex ? FEMALE : MALE)[given % (sex ? FEMALE : MALE).length];
    return { name: f[0] + ' ' + g[0], kana: f[1] + ' ' + g[1], family: f[0] };
  }
  function money(n) {
    var a = Math.abs(n), s = n < 0 ? '−$' : '$';
    if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + (a / 1e9).toFixed(a >= 1e11 ? 1 : 2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    return s + String(Math.round(a)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  // A 街ライブ frame: 5 bytes a person (where they are: district and place; what they do; their mood; marks: 1 working,
  // 2 rich, 4 homeless, 8 famous, 16 in a movement), base64 from the server
  var FRAME = { bytes: 5 };

  BR.NPC = {
    nation: NATION, districts: DISTRICTS, places: PLACES, placeNames: PLACE_NAMES, acts: ACTS, act: ACT, hours: HOURS,
    holidays: holidays, jst: jst, hoursOf: hoursOf, activeAt: activeAt, nextActive: nextActive,
    companies: COMPANY_IDS, job: JOB, jobNames: JOB_NAMES, jobOf: jobOf, companyOf: companyOf, isCompanyJob: isCompanyJob, employed: employed, working: working, schedules: SCHEDULES, companySchedule: COMPANY_SCHEDULE, sites: SITES,
    tax: TAX, social: SOCIAL, pension: PENSION, safety: SAFETY, retire: RETIRE, life: LIFE, trouble: TROUBLE,
    knobs: KNOBS, knob: KNOB, knobOf: knobOf, change: CHANGE, votes: VOTES, platforms: PLATFORMS, themes: THEMES, demands: DEMANDS,
    org: ORG, ranks: RANKS, labs: LABS, labThemes: LAB_THEMES, ventures: VENTURES,
    names: { family: FAMILY, male: MALE, female: FEMALE }, nameOf: nameOf, money: money, frame: FRAME, MIN: MIN
  };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
