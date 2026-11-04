// Capsule gacha: the shared rules draw the rewards, this module settles them.
// Payment and every reward from a spin commit in the same SQLite transaction.
import { ApiError } from './errors.js';
import { RULES, GACHA, VIP, CORP } from './rules.js';
import { readQuests, questTickets } from './quests.js';
import { createSpinRequests } from './spin-requests.js';
import { ensureStarterTree } from './tree.js';
import { carGot, TICKET } from './medals.js';

const SEED = 'gacha-seed';
const VIP_WEEK = 'gacha-vip-week';
const GROWN = 'gacha-grown-tree';
const CAR = 'gacha-car:';
const pricesOf = (sale) => Object.fromEntries(GACHA.kinds.map((kind) => [kind.id, {
  single: GACHA.price(kind.id, 1, sale), three: GACHA.price(kind.id, 3, sale), ten: GACHA.price(kind.id, 10, sale)
}]));
// Independent cryptographic samples, filled in one call instead of one allocation/native call per reward.
const randomWords = new Uint32Array(128);
let randomAt = randomWords.length;

function secureRandom() {
  if (randomAt === randomWords.length) {
    globalThis.crypto.getRandomValues(randomWords);
    randomAt = 0;
  }
  return randomWords[randomAt++] / 4294967296;
}

// The gacha is YOSIDA's (js/game/corp.js CORP.yosida): of what a pull costs, its share is its sale and the rest the
// country's treasury's; each prize is provided by its company at its own cost (server/core/corp-model.js prizes) —
// a money tree that has no room (the player's trees all there) paid to the player instead. The players can sell
// some of them back (GACHA.sell: POST /api/gacha/sell). (`corp`: server/core/corp.js, or none in tests.)
export function createGacha({ q, tx, getUser, meDto, addItems, itemsOf, balanceChanged, afterSpend,
  settleVip = () => 0, vipChanged = balanceChanged, onSpin = () => {}, now = Date.now, rand = secureRandom, corp = null }) {
  const requests = createSpinRequests({ q, tx, clock: now, table: 'gacha_requests', code: 'gacha', label: 'ガチャ',
    fingerprint: body => JSON.stringify([String(body.kind || 'rare'), Number(body.count), body.price ?? null, !!body.ticket]),
    replay: (id, result) => ({ ...result, ...state(getUser(id)) }) });
  const carCount = (id) => q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(id).n;
  const treeCount = (id) => q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ?').get(id).n;
  const garageSize = (u) => RULES.garage.slots + (u.garage_extra || 0);
  const itemCount = (id, item) => (itemsOf(id)[item] || 0);
  // リリース記念セール (GACHA.releaseSale): from the first time the server ran with it, for its hours
  q("INSERT OR IGNORE INTO meta (key, value) VALUES ('gacha_release_sale', ?)").run(String(now()));
  const saleStart = Number(q("SELECT value FROM meta WHERE key = 'gacha_release_sale'").get().value);
  const saleEnd = saleStart + GACHA.releaseSale.hours * 3600000;
  const saleOn = (at) => at >= saleStart && at < saleEnd;

  function state(u) {
    const at = now();
    const events = GACHA.events(at);
    const me = meDto(u);
    const items = me.items || itemsOf(u.id);
    return {
      me,
      now: at,
      events,
      prices: pricesOf(saleOn(at)),
      ...(saleOn(at) ? { releaseSale: { kind: GACHA.releaseSale.kind, end: saleEnd } } : {}),
      // (what can be sold back: the VIP1週間券, the reset tickets, the garage's empty places that are coins)
      sell: GACHA.sell, resets: questTickets(readQuests(u.quests)), garageFree: Math.max(0, Math.min(u.garage_extra || 0, garageSize(u) - carCount(u.id))),
      items: { seed: items[SEED] || 0, vipWeek: items[VIP_WEEK] || 0,
        // the free tickets (功績's rewards, server/core/medals.js): one pull each
        tickets: Object.fromEntries(GACHA.kinds.map((k) => [k.id, items[TICKET + k.id] || 0])),
        waiting: [
          ...(items[GROWN] ? [{ key: GROWN, type: 'grown-tree', name: '成長済みの金の生る木', count: items[GROWN] }] : []),
          ...GACHA.cars.filter(c => items[CAR + c.id]).map(c => ({ key: CAR + c.id, type: 'car', carId: c.id, name: c.name, count: items[CAR + c.id] }))
        ] },
      maxTrees: RULES.tree.max
    };
  }

  function spin(body, u) {
    const kind = String(body.kind || 'rare');
    const count = Number(body.count);
    // free: one ticket of this kind for each pull, instead of $
    const free = !!body.ticket;
    if (!GACHA.kinds.some((k) => k.id === kind)) throw new ApiError(400, 'bad_gacha', 'ガチャの種類を選んでください');
    if (count !== 1 && count !== 3 && count !== 10) throw new ApiError(400, 'bad_count', '回数は1回・3回・10回です');

    const result = tx(() => {
      const cur = getUser(u.id);
      const at = now();
      const events = GACHA.events(at);
      const paid = free ? 0 : GACHA.price(kind, count, saleOn(at));
      if (free) {
        if (itemCount(cur.id, TICKET + kind) < count) throw new ApiError(409, 'no_ticket', '無料券が足りません');
        addItems(cur.id, TICKET + kind, -count);
      } else {
        if (body.price !== undefined && Number(body.price) !== paid) throw new ApiError(409, 'price_changed', '価格が更新されました。新しい価格を確認してください');
        if (cur.dollars < paid) throw new ApiError(409, 'insufficient', '$が足りません');
      }
      const pulls = GACHA.draw(kind, count, events.boost.on, events.sale.on, rand);
      const rewards = pulls.flatMap((p) => p.rewards);
      if (rewards.some(r => r.type === 'grown-tree' || r.type === 'seed')) ensureStarterTree(q, cur.id, at);
      const garageCoins = rewards.filter((r) => r.type === 'garage').reduce((n, r) => n + r.amount, 0);
      let carRoom = Math.max(0, garageSize(cur) + garageCoins - carCount(cur.id));
      let treeRoom = Math.max(0, RULES.tree.max - treeCount(cur.id));
      // (the trees the player has and is waiting to plant: all there, a tree's money instead — YOSIDA's)
      let treesHeld = treeCount(cur.id) + itemCount(cur.id, SEED) + itemCount(cur.id, GROWN);
      const G = CORP.yosida.gacha;

      let tokens = 0, coins = 0, resets = 0, lot = 0, seeds = 0, grown = 0, treePay = 0;
      const quests = readQuests(cur.quests);
      for (const pull of pulls) coins += pull.bonus || 0;
      for (const r of rewards) {
        if (r.type === 'car') {
          if (carRoom <= 0) { addItems(cur.id, CAR + r.carId, 1); r.pending = true; continue; }
          carRoom--;
          carGot(q, cur.id, Number(q("INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at, paid, via) VALUES (?, ?, 0, ?, ?, 0, 'gacha')")
            .run(cur.id, r.carId, at, at).lastInsertRowid));
        } else if (r.type === 'lot') { tokens += r.amount; lot += r.amount; }
        else if (r.type === 'royal') coins += r.amount;
        else if (r.type === 'garage') { /* counted below */ }
        else if (r.type === 'reset') resets += r.amount;
        else if ((r.type === 'seed' || r.type === 'grown-tree') && treesHeld >= RULES.tree.max) { treePay++; r.paid = G.treePay; }
        else if (r.type === 'seed') { addItems(cur.id, SEED, 1); seeds++; treesHeld++; }
        else if (r.type === 'vip-week') addItems(cur.id, VIP_WEEK, 1);
        else if (r.type === 'grown-tree') {
          grown++; treesHeld++;
          if (treeRoom <= 0) { addItems(cur.id, GROWN, 1); r.pending = true; continue; }
          treeRoom--;
          q('INSERT INTO trees (user_id, name, super, given, price, created_at) VALUES (?, ?, 0, ?, 0, ?)')
            .run(cur.id, '金の生る木', GACHA.grownGiven, at);
        }
      }
      if (resets) {
        const tickets = questTickets(quests);
        quests.tickets = { '5h': tickets['5h'] + resets, day: tickets.day };
      }
      // (the pulls, free ones too: counted for the 功績, server/core/medals.js)
      q(`UPDATE users SET dollars = dollars - ? + ?, tokens = tokens + ?, coins = coins + ?,
           garage_extra = garage_extra + ?, quests = ?, gacha_pulls = gacha_pulls + ?, rev = rev + 1 WHERE id = ?`)
        .run(paid, treePay * G.treePay, tokens, coins, garageCoins, JSON.stringify(quests), count, cur.id);
      // the books: the pull's price YOSIDA's sale and the treasury's share; the prizes, each its provider's
      if (corp) {
        const mine = Math.round(paid * G.share);
        corp.flow('yosida', 'gacha', mine);
        corp.flow('@stateIn', 'gacha', paid - mine);
        const cars = {};
        for (const r of rewards) if (r.type === 'car') cars[r.carId] = (cars[r.carId] || 0) + 1;
        corp.prize({ lot, royal: coins, garage: garageCoins, vip: rewards.filter((r) => r.type === 'vip-week').length,
          seed: seeds, grown, treePay, reset: resets, cars });
      }
      return { pulls, paid, kind, count, ...(free ? { free: true } : {}) };
    });

    balanceChanged(u.id, true);
    afterSpend(u.id);
    onSpin(u.id);
    return { ...result, ...state(getUser(u.id)) };
  }

  function use(item, u) {
    const car = GACHA.cars.find(c => item === CAR + c.id);
    if (item !== 'seed' && item !== 'vip-week' && item !== GROWN && !car) throw new ApiError(400, 'bad_item', 'このアイテムは使えません');
    const key = item === 'seed' ? SEED : item === 'vip-week' ? VIP_WEEK : item;
    const at = now();
    let vipPay = 0;
    tx(() => {
      const cur = getUser(u.id);
      if (itemCount(cur.id, key) < 1) throw new ApiError(409, 'no_item', 'アイテムを持っていません');
      if (car) {
        if (carCount(cur.id) >= garageSize(cur)) throw new ApiError(409, 'garage_full', 'ガレージの空きを作ってから受け取ってください');
        addItems(cur.id, key, -1);
        carGot(q, cur.id, Number(q("INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at, paid, via) VALUES (?, ?, 0, ?, ?, 0, 'gacha')").run(cur.id, car.id, at, at).lastInsertRowid));
      } else if (item === 'seed' || item === GROWN) {
        ensureStarterTree(q, cur.id, at);
        if (treeCount(cur.id) >= RULES.tree.max) throw new ApiError(409, 'trees_full', `金の生る木は${RULES.tree.max}本までです`);
        addItems(cur.id, key, -1);
        q("INSERT INTO trees (user_id, name, super, given, price, created_at) VALUES (?, '金の生る木', 0, ?, 0, ?)").run(cur.id, item === GROWN ? GACHA.grownGiven : 0, at);
      } else {
        const until = Math.max(at, cur.vip_until) + 7 * VIP.day;
        if (until > at + RULES.vip.maxDays * VIP.day) throw new ApiError(409, 'too_long', `VIPは${RULES.vip.maxDays}日先までです`);
        vipPay = settleVip(cur, at);
        addItems(cur.id, key, -1);
        q('UPDATE users SET vip_until = ?, rev = rev + 1 WHERE id = ?').run(until, cur.id);
      }
    });
    const after = item === 'vip-week' ? vipChanged(u.id, vipPay) : getUser(u.id);
    if (car) onSpin(u.id);
    return { ok: true, item, ...state(after) };
  }

  // What the gacha gave that the player sells back (GACHA.sell, a piece): a VIP1週間券 to DAIZIN, reset tickets (5時間・
  // 24時間) to YOSIDA, a garage coin — an empty extra place of their garage — to MAGITA, a money tree's seed to YOSIDA
  // (what it pays one whose trees are all there); paid in $ at once, the company's purchase (server/core/corp-model.js
  // rebought). Several at once (the gacha's 売却所: { item: count }), all or none.
  const SOLD_TO = { 'vip-week': ['daizin', 'vip'], 'reset-5h': ['yosida', 'reset'], 'reset-day': ['yosida', 'reset'], garage: ['magita', 'garage'], seed: ['yosida', 'seed'] };
  const NAMES = { 'vip-week': 'VIP1週間券', 'reset-5h': 'リセットチケット（5時間）', 'reset-day': 'リセットチケット（24時間）', garage: '売れるガレージコイン（空いているガレージ）', seed: '金の生る木の種' };
  function sellAll(list, u) {
    const items = Object.entries(list || {}).filter(([, n]) => n !== 0);
    if (!items.length) throw new ApiError(400, 'bad_count', '売る数を選んでください');
    for (const [item, count] of items) {
      if (!SOLD_TO[item] || !GACHA.sell[item]) throw new ApiError(400, 'bad_item', 'このアイテムは売れません');
      if (!Number.isInteger(count) || count < 1 || count > 1000) throw new ApiError(400, 'bad_count', '売る数を選んでください');
    }
    let paid = 0;
    const sold = {};
    tx(() => {
      const cur = getUser(u.id);
      const quests = readQuests(cur.quests), t = { ...questTickets(quests) };
      let garage = 0;
      for (const [item, count] of items) {
        const each = GACHA.sell[item] * count;
        if (item === 'vip-week' || item === 'seed') {
          const key = item === 'seed' ? SEED : VIP_WEEK;
          if (itemCount(cur.id, key) < count) throw new ApiError(409, 'no_item', NAMES[item] + 'が足りません');
          addItems(cur.id, key, -count);
        } else if (item === 'garage') {
          const free = Math.min(cur.garage_extra || 0, garageSize(cur) - carCount(cur.id));
          if (free < count) throw new ApiError(409, 'no_item', NAMES[item] + 'が足りません');
          garage = count;
        } else {
          const k = item === 'reset-5h' ? '5h' : 'day';
          if ((t[k] || 0) < count) throw new ApiError(409, 'no_item', NAMES[item] + 'が足りません');
          t[k] -= count;
        }
        paid += each;
        sold[item] = { count, paid: each };
      }
      if (sold['reset-5h'] || sold['reset-day']) { quests.tickets = t; q('UPDATE users SET quests = ? WHERE id = ?').run(JSON.stringify(quests), cur.id); }
      q('UPDATE users SET garage_extra = garage_extra - ?, dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(garage, paid, cur.id);
      if (corp) for (const [item, x] of Object.entries(sold)) corp.rebuy(SOLD_TO[item][0], SOLD_TO[item][1], x.count, x.paid);
    });
    balanceChanged(u.id, true);
    return { ok: true, sold, paid, ...state(getUser(u.id)) };
  }
  function sell(item, count, u) {
    if (!SOLD_TO[item] || !GACHA.sell[item]) throw new ApiError(400, 'bad_item', 'このアイテムは売れません');
    const r = sellAll({ [item]: count }, u);
    return { ...r, item, count };
  }

  return {
    routes: {
      'GET /api/gacha': (req, u) => state(getUser(u.id)),
      'POST /api/gacha/sell': async (req, u) => {
        const body = await req.json();
        if (body.items && typeof body.items === 'object') return sellAll(Object.fromEntries(Object.entries(body.items).map(([k, v]) => [String(k), Number(v)])), u);
        return sell(String(body.item || ''), Number(body.count === undefined ? 1 : body.count), u);
      },
      'POST /api/gacha/spin': async (req, u) => { const body = await req.json(); return requests.run(u.id, body, () => spin(body, u)); },
      'POST /api/gacha/use': async (req, u) => {
        const body = await req.json();
        return use(String(body.item || ''), u);
      }
    },
    prune: requests.prune
  };
}
