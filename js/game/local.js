/* 地元の企業: the 32 unlisted local companies of ヴェルノア in its ten economies (docs/local-companies.md, the spec;
   the corrections to it in docs/handbook/40.md). Smaller than the thirteen, each lives on part of what they and the
   people spend in the country: the thirteen's running costs (施設・研究開発・その他・販売・設備) are in part these
   companies' sales — 業務委託, 共同研究費, ラインやスタジオの賃借, 技術料 — so the thirteen spend what they always did, to
   someone now; the people's lunches, rent, bills and outings the same. Their people are the country's (the local jobs,
   P.firm), paid by them; their profit taxed and kept (非上場: no dividends).

   Each: `staff` its people for the full country (by its size in a smaller one), `pay` an employee's year (`unit` all it
   costs the company), `ceo` its 社長's and CEO's pay, `sales`/`op` a year as planned, `capital`/`retained` at the start,
   `hq` its district, `from` what it lives on ([source, part of its sales, what it is]): 'co:<company>:<cost>' a top
   company's running cost ('*' any of them), 'people:<what>' the people's spending; `costs` where its own costs go
   beyond its people (`to`: other local companies, `imports`: bought abroad; the rest to the country's small shops). */
(function (BR) {
  'use strict';

  var SPHERES = [
    { id: 'bank', name: 'テネシスを取り巻く小銀行群' },
    { id: 'magita', name: 'MAGITA傘下・MAGITA経済圏' },
    { id: 'wazima', name: 'WAZIMA技術屋企業群' },
    { id: 'yosida', name: 'YOSIDA経済圏' },
    { id: 'retail', name: 'カーオーナー・ジンクス系の車・小物・雑貨' },
    { id: 'myway', name: 'MY WAYミュージアム＆関連の経済圏' },
    { id: 'dtrade', name: 'Dtradeで潤う経済圏' },
    { id: 'daizin', name: 'DAIZIN経済圏' },
    { id: 'games', name: 'RIRU・ICE SMOKERの製品を販売する経済圏' },
    { id: 'life', name: '食料品店・電気・ガス・水道の重要インフラ' }
  ];
  var M = 1000000;
  function f(no, id, sphere, name, role, hq, staff, pay, unit, ceo, sales, op, capital, retained, from, costs) {
    return { no: no, id: id, sphere: sphere, name: name, role: role, hq: hq, staff: staff, pay: pay * M, unit: unit * M, ceo: [ceo[0] * M, ceo[1] * M],
      sales: sales * M, op: op * M, capital: capital * M, retained: retained * M, from: from, costs: costs || {} };
  }
  // (the districts: NPC.districts by name)
  var S = 'ソレイユ区', E = 'アイゼン区', K = 'カナリア区', A = 'オーロラ区', V = 'リヴィエール区';
  var FIRMS = [
    f(1, 'chiikibank', 'bank', '第一地域銀行', '最大の地方銀行。テネシスと提携し、地元企業の運転資金や設備の融資を担う', S, 225, 4.2, 6.51, [40, 30], 4070, 810, 500, 6330,
      [['co:tenesice:other', 0.55, 'テネシスの代理店・窓口業務の受託'], ['people:rent', 0.25, '住宅ローンの取次ぎ'], ['co:*:other', 0.2, '地元企業との決済・取引手数料']]),
    f(2, 'central', 'bank', 'セントラル信用金庫', '商店街や町工場、ベンチャーの開業資金を審査・融資する地域の金庫番', S, 140, 3.6, 5.58, [36, 26], 2120, 390, 400, 3470,
      [['co:tenesice:other', 0.5, '小口融資の審査代行（テネシスからの委託）'], ['co:*:other', 0.1, '町工場との決済手数料'], ['people:rent', 0.4, '開業・住宅資金の融資']]),
    f(3, 'autolife', 'bank', 'テネシス・オート＆ライフ信販', 'カーオーナーの車両ローンやジンクスの分割払いを引き受ける信販会社', S, 100, 3.5, 5.42, [35, 25], 1690, 340, 300, 2820,
      [['co:carowner:selling', 0.5, '車両ローンの取次ぎ手数料'], ['co:jinx:selling', 0.3, '分割払いの取次ぎ手数料'], ['co:tenesice:other', 0.2, '信販業務の受託']]),
    f(4, 'mgmaterial', 'magita', 'MAGITAマテリアル', 'MAGITAの完全子会社。ボディ用の高張力鋼板や産業機械の特殊鋼を製造', E, 200, 3.4, 5.2, [32, 24], 6420, 640, 200, 5880,
      [['co:magita:place', 0.55, '製造ライン用の特殊鋼・高張力鋼板'], ['co:magita:capex', 0.3, '設備用の鋼材'], ['co:wazima:place', 0.15, 'WAZIMAのライン用の鋼材']], { imports: 0.55 }),
    f(5, 'mglogi', 'magita', 'MAGITAロジスティクス', '完成車をカーオーナー全店へ、重工パーツを港や工場へ運ぶ陸送会社', E, 160, 3.1, 4.74, [28, 20], 2110, 210, 150, 1880,
      [['co:magita:place', 0.35, '完成車・部品の陸送'], ['co:carowner:selling', 0.45, '全店への車両輸送'], ['co:yosida:place', 0.2, 'YOSIDAの部品輸送']]),
    f(6, 'mgtown', 'magita', 'マギタタウン開発', 'MAGITA工場周辺の社宅街・ショッピングモール・娯楽施設を運営', E, 110, 2.9, 4.5, [26, 18], 1970, 200, 120, 1740,
      [['co:magita:other', 0.35, '社宅街・福利厚生施設の運営委託'], ['people:rent', 0.45, '社宅・住宅の賃料'], ['people:leisure', 0.2, 'モール・娯楽施設']]),
    f(7, 'jukofood', 'magita', '重工フードサービス', 'MAGITA・WAZIMAの社員食堂と工場周辺の飲食店チェーン', E, 90, 2.8, 4.34, [22, 16], 1240, 120, 80, 1120,
      [['co:magita:other', 0.3, '社員食堂の運営委託'], ['co:wazima:other', 0.2, 'WAZIMAの社員食堂の運営委託'], ['people:food', 0.5, '工場周辺の飲食店']], { to: [['greenfoods', 0.3]] }),
    f(8, 'kyokuto', 'wazima', '極東精機ラボ', 'WAZIMA製エンジンの心臓部、ミクロン単位の精密ギア・バルブ加工', E, 65, 3.2, 4.96, [22, 15], 940, 140, 70, 840,
      [['co:wazima:rd', 0.55, '精密ギア・バルブの共同研究・加工委託'], ['co:magita:rd', 0.45, 'エンジン部品の精密加工委託']]),
    f(9, 'chroma', 'wazima', 'クロマ・ケミカル', 'MY WAY特別仕様エンジンの耐熱塗装やカーボン素材の共同開発', E, 40, 2.9, 4.5, [18, 12], 700, 100, 50, 600,
      [['co:myway:rd', 0.45, '特別仕様エンジンの耐熱塗装の共同開発'], ['co:wazima:rd', 0.3, '耐熱材の共同研究'], ['co:magita:rd', 0.25, '特殊塗装の開発委託']]),
    f(10, 'meister', 'wazima', 'マイスター試作工房', '新型車・特別仕様車の試作金型を数日で削り出す職人集団', E, 25, 2.6, 4.03, [15, 10], 260, 40, 30, 260,
      [['co:magita:rd', 0.5, '試作金型・ワンオフ部品'], ['co:yosida:rd', 0.3, '新型車の試作金型'], ['co:myway:rd', 0.2, '特別仕様車の試作']]),
    f(11, 'ydpress', 'yosida', 'ヨシダ車体プレス工業', 'YOSIDAの大衆車向けに、コストを削ったドアや外装パネルを大量生産', V, 125, 2.2, 3.52, [15, 10], 2080, 80, 60, 830,
      [['co:yosida:place', 0.7, 'ドア・外装パネルのプレス委託'], ['co:yosida:capex', 0.3, 'プレス金型・設備']], { imports: 0.3 }),
    f(12, 'sanwa', 'yosida', '三和シート＆インテリア', 'YOSIDA車専用のシートやプラスチック内装パネルを安価に納入', V, 80, 2.0, 3.2, [12, 8], 1210, 50, 40, 470,
      [['co:yosida:place', 0.85, 'シート・内装パネルの納入'], ['co:yosida:other', 0.15, '内装の補修部品']], { imports: 0.3 }),
    f(13, 'taiyo', 'yosida', 'タイヨー電装ハーネス', 'ライト・ワイパー・配線をYOSIDA工場へ毎日納入', V, 60, 1.9, 3.04, [10, 7], 750, 20, 30, 270,
      [['co:yosida:place', 0.65, 'ライト・ワイパー・配線の納入'], ['co:yosida:rd', 0.35, '電装品の開発委託']], { imports: 0.3 }),
    f(14, 'autoparts', 'retail', 'オートパーツ・ガレージ', 'カーオーナーの隣でタイヤ・オイル交換やカスタムパーツを販売', K, 100, 2.4, 3.79, [18, 12], 2220, 110, 50, 1110,
      [['co:carowner:selling', 0.5, '納車整備・オイル交換の委託'], ['people:living', 0.25, 'タイヤ・カー用品'], ['people:leisure', 0.25, 'カスタムパーツ']], { imports: 0.4 }),
    f(15, 'nextused', 'retail', 'ネクスト・ユーズドカー', '下取りの中古車を整備し、安価に再販する認定中古車店', K, 65, 2.2, 3.48, [15, 10], 1990, 100, 35, 910,
      [['co:carowner:other', 0.4, '下取り車の整備・再販の委託'], ['co:magita:other', 0.3, 'MAGITA Robertの中古車の整備委託'], ['people:living', 0.3, '認定中古車の販売']]),
    f(16, 'palette', 'retail', 'パレット・バラエティ', 'ジンクスの卸しで、駅ナカや住宅街に文房具・スマホケース・小物の店', K, 45, 2.0, 3.2, [12, 8], 1010, 50, 25, 510,
      [['people:living', 0.6, '文房具・スマホケース・小物'], ['people:leisure', 0.2, '雑貨'], ['co:jinx:selling', 0.2, '駅ナカ販売の受託']], { imports: 0.3 }),
    f(17, 'museum', 'myway', 'MY WAYミュージアム＆リゾート運営', '歴代キャラや限定車を展示する巨大ミュージアムと隣接テーマホテル', A, 110, 3.8, 6.0, [30, 20], 2060, 410, 100, 1800,
      [['people:leisure', 0.6, '入館料・テーマホテル'], ['co:myway:place', 0.4, '展示・アーカイブ管理の委託']]),
    f(18, 'plush', 'myway', 'ロイヤル・プラッシュ', 'MY WAYの品質基準をクリアした最高級ぬいぐるみ・限定衣装の縫製工場', A, 80, 3.2, 5.06, [26, 18], 1410, 250, 60, 1190,
      [['co:jinx:other', 0.55, 'ジンクスのMY WAYコラボぬいぐるみの製造委託'], ['co:myway:rd', 0.3, '限定衣装・ぬいぐるみの試作'], ['people:leisure', 0.15, '限定品の直販']], { imports: 0.2 }),
    f(19, 'diner', 'myway', 'ドリーム・ダイナー', 'ミュージアム周辺でコラボカフェやファンイベントを開く飲食・興行企業', A, 45, 3.0, 4.8, [22, 15], 760, 150, 30, 650,
      [['people:food', 0.5, 'コラボカフェ'], ['people:leisure', 0.3, 'ファンイベント'], ['co:myway:other', 0.2, '公式イベントの運営委託']], { to: [['greenfoods', 0.2]] }),
    f(20, 'crown', 'myway', 'クラウン鑑定・アーカイブス', '絶版のMY WAY限定グッズやコラボパーツの真贋鑑定と売買の仲介', A, 20, 3.5, 5.6, [20, 14], 310, 60, 20, 250,
      [['people:leisure', 0.7, '鑑定・売買の仲介手数料'], ['co:myway:other', 0.3, '偽物の鑑定・取り締まりの協力']]),
    f(21, 'goldhotel', 'dtrade', 'ゴールド・カジノホテル＆ラウンジ', 'Dtradeのカジノ客や大口投資家が泊まる直結の高級ホテル', S, 50, 3.4, 5.37, [28, 20], 1030, 270, 60, 940,
      [['people:leisure', 0.6, '宿泊・ラウンジ'], ['co:dtrade:other', 0.4, '大口客の接待・宿泊']], { to: [['greenfoods', 0.1]] }),
    f(22, 'alpha', 'dtrade', 'アルファ・リサーチ', '上場各社の業績予想やMY WAYコラボ予測を配信する投資情報サロン', S, 15, 4.0, 6.2, [24, 16], 230, 60, 20, 190,
      [['co:dtrade:rd', 0.5, '投資情報・業績予想データの提供'], ['people:leisure', 0.5, '個人投資家の会費']]),
    f(23, 'aegis', 'daizin', 'イージス・プライベート警備＆送迎', 'DAIZIN会員や大企業トップの身辺警護、防弾リムジン・ヘリでの送迎', A, 45, 3.4, 5.3, [24, 17], 510, 110, 50, 450,
      [['co:daizin:place', 0.55, 'VIPラウンジの警備'], ['co:tenesice:other', 0.25, '現金輸送・役員警護'], ['co:myway:other', 0.2, '役員の送迎']]),
    f(24, 'luxe', 'daizin', 'メゾン・ド・リュクス', 'VIPラウンジへ最高級シャンパン・三つ星食材・特注時計を納入', A, 20, 3.6, 5.62, [20, 14], 1170, 230, 25, 940,
      [['co:daizin:place', 0.7, 'シャンパン・食材の納入'], ['co:daizin:other', 0.3, '特注時計・宝飾の手配']], { imports: 0.6 }),
    f(25, 'gamesark', 'games', 'ゲームズ・アーク', 'ICE・RIRUの新作ソフトや限定版BOX、ゲーム機本体を店頭販売するチェーン', K, 70, 2.5, 3.95, [18, 12], 3160, 400, 50, 2050,
      [['people:leisure', 0.5, 'ゲーム機・限定版の店頭販売'], ['co:ice:other', 0.35, 'ICE SMOKERの販促・店頭販売の委託'], ['co:riru:other', 0.15, 'RIRUの店頭販売の委託']], { imports: 0.5 }),
    f(26, 'neogear', 'games', 'ネオ・ギア', 'ICE SMOKER公認コントローラーやMY WAYコラボヘッドセットの製造', K, 40, 2.8, 4.4, [16, 11], 800, 100, 30, 540,
      [['co:ice:rd', 0.6, '公認コントローラーの共同開発'], ['co:myway:rd', 0.15, 'コラボヘッドセットの製造'], ['people:leisure', 0.25, 'ゲーミングデバイスの直販']], { imports: 0.3 }),
    f(27, 'cyberarena', 'games', 'サイバー・アリーナ', 'ゲーム大会の運営、実況配信スタジオ、デバッグ業務の請負', A, 20, 2.3, 3.61, [12, 8], 160, 20, 15, 130,
      [['co:ice:place', 0.5, 'デバッグ・配信スタジオの賃借'], ['co:riru:place', 0.5, 'デバッグ・大会運営の委託']]),
    f(28, 'power', 'life', 'ナショナル・パワー電力', '家庭からMAGITAの工場、Dtradeのサーバーまで全電力を供給', E, 300, 3.5, 5.5, [35, 25], 14950, 1200, 500, 17930,
      [['co:*:place', 0.7, '工場・データセンター・店舗の電力'], ['people:utilities', 0.25, '家庭の電気代'], ['people:rent', 0.05, '集合住宅の共用電力']], { imports: 0.5 }),
    f(29, 'gas', 'life', 'メトロ都市ガス', '工業地帯の熱源と全世帯の都市ガスを供給', E, 210, 3.3, 5.21, [30, 22], 9890, 770, 350, 12080,
      [['co:*:place', 0.7, '工業地帯の熱源'], ['people:utilities', 0.3, '家庭の都市ガス']], { imports: 0.6 }),
    f(30, 'aqua', 'life', 'アクア・ライフ水道公社', '飲料水と工場の冷却水・排水処理を担う水インフラ', V, 175, 3.1, 4.9, [25, 18], 3720, 290, 300, 4790,
      [['co:*:place', 0.6, '工場の冷却水・排水処理'], ['people:utilities', 0.35, '家庭の水道代'], ['people:rent', 0.05, '集合住宅の上下水道']]),
    f(31, 'freshmart', 'life', 'フレッシュ・マート', '雑貨のジンクスと棲み分け、生鮮食品・精肉・日配品を全市民へ', K, 190, 2.2, 3.52, [20, 14], 5420, 270, 120, 3200,
      [['people:living', 0.7, '生鮮食品・日配品'], ['people:food', 0.3, '惣菜・弁当']], { to: [['greenfoods', 0.35]], imports: 0.3 }),
    f(32, 'greenfoods', 'life', 'グリーン・フーズ', 'フレッシュ・マートや各社の社員食堂へパン・弁当・乳製品を製造・卸', V, 100, 2.2, 3.52, [15, 10], 1850, 90, 80, 1390,
      [['people:food', 0.4, '弁当・パン'], ['co:*:other', 0.1, '各社の社員食堂への卸']], { imports: 0.3 })
  ];
  // what every one of them pays for its electricity, gas and water, of its costs beyond its people
  var UTILITIES = { share: 0.08, to: [['power', 0.5], ['gas', 0.25], ['aqua', 0.25]] };
  // the corporate taxes (法人税等) of a month's profit; its bonus: of a month's profit beyond its plan, this much to its
  // people (決算賞与: the parent's good month is theirs too); what an overdrawn one pays its bank a year
  var RULES = { tax: 0.3, bonus: 0.25, overdraft: 0.03, bank: 'chiikibank' };
  // what a top company's running cost is, to the one paid for it
  var KINDS = { place: '施設・ラインの賃借・維持の委託', rd: '共同研究費・開発委託', other: '業務委託', selling: '販売・物流の委託', capex: '設備・部品の発注' };

  var byId = {};
  FIRMS.forEach(function (x) { byId[x.id] = x; });
  BR.LOCAL = { spheres: SPHERES, firms: FIRMS, firm: function (id) { return byId[id] || null; }, utilities: UTILITIES, rules: RULES, kinds: KINDS };
})(globalThis.BR = globalThis.BR || {}); // shared with the server, hence globalThis
