// Capsule gacha: the shared rules draw the rewards, this module settles them.
// Payment and every reward from a spin commit in the same SQLite transaction.
import { ApiError } from './errors.js';
import { RULES, GACHA, VIP } from './rules.js';
import { readQuests, questTickets } from './quests.js';
import { createSpinRequests } from './spin-requests.js';
import { ensureStarterTree } from './tree.js';
import { carGot, TICKET } from './medals.js';

const SEED = 'gacha-seed';
const VIP_WEEK = 'gacha-vip-week';
const GROWN = 'gacha-grown-tree';
const CAR = 'gacha-car:';
const PRICES = Object.fromEntries(GACHA.kinds.map((kind) => [kind.id, {
  single: GACHA.price(kind.id, 1), three: GACHA.price(kind.id, 3), ten: GACHA.price(kind.id, 10)
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

export function createGacha({ q, tx, getUser, meDto, addItems, itemsOf, balanceChanged, afterSpend,
  settleVip = () => 0, vipChanged = balanceChanged, onSpin = () => {}, now = Date.now, rand = secureRandom }) {
  const requests = createSpinRequests({ q, tx, clock: now, table: 'gacha_requests', code: 'gacha', label: 'ガチャ',
    fingerprint: body => JSON.stringify([String(body.kind || 'rare'), Number(body.count), body.price ?? null, !!body.ticket]),
    replay: (id, result) => ({ ...result, ...state(getUser(id)) }) });
  const carCount = (id) => q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(id).n;
  const treeCount = (id) => q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ?').get(id).n;
  const garageSize = (u) => RULES.garage.slots + (u.garage_extra || 0);
  const itemCount = (id, item) => (itemsOf(id)[item] || 0);

  function state(u) {
    const at = now();
    const events = GACHA.events(at);
    const me = meDto(u);
    const items = me.items || itemsOf(u.id);
    return {
      me,
      now: at,
      events,
      prices: PRICES,
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
      const paid = free ? 0 : GACHA.price(kind, count);
      if (free) {
        if (itemCount(cur.id, TICKET + kind) < count) throw new ApiError(409, 'no_ticket', '無料券が足りません');
        addItems(cur.id, TICKET + kind, -count);
      } else {
        if (body.price !== undefined && Number(body.price) !== paid) throw new ApiError(409, 'price_changed', '価格が更新されました。新しい価格を確認してください');
        if (cur.dollars < paid) throw new ApiError(409, 'insufficient', '$が足りません');
      }
      const pulls = GACHA.draw(kind, count, events.boost.on, events.sale.on, rand);
      const rewards = pulls.flatMap((p) => p.rewards);
      if (rewards.some(r => r.type === 'grown-tree')) ensureStarterTree(q, cur.id, at);
      const garageCoins = rewards.filter((r) => r.type === 'garage').reduce((n, r) => n + r.amount, 0);
      let carRoom = Math.max(0, garageSize(cur) + garageCoins - carCount(cur.id));
      let treeRoom = Math.max(0, RULES.tree.max - treeCount(cur.id));

      let tokens = 0, coins = 0, resets = 0;
      const quests = readQuests(cur.quests);
      for (const pull of pulls) coins += pull.bonus || 0;
      for (const r of rewards) {
        if (r.type === 'car') {
          if (carRoom <= 0) { addItems(cur.id, CAR + r.carId, 1); r.pending = true; continue; }
          carRoom--;
          carGot(q, cur.id, Number(q("INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at, paid, via) VALUES (?, ?, 0, ?, ?, 0, 'gacha')")
            .run(cur.id, r.carId, at, at).lastInsertRowid));
        } else if (r.type === 'lot') tokens += r.amount;
        else if (r.type === 'royal') coins += r.amount;
        else if (r.type === 'garage') { /* counted below */ }
        else if (r.type === 'reset') resets += r.amount;
        else if (r.type === 'seed') addItems(cur.id, SEED, 1);
        else if (r.type === 'vip-week') addItems(cur.id, VIP_WEEK, 1);
        else if (r.type === 'grown-tree') {
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
      q(`UPDATE users SET dollars = dollars - ?, tokens = tokens + ?, coins = coins + ?,
           garage_extra = garage_extra + ?, quests = ?, gacha_pulls = gacha_pulls + ?, rev = rev + 1 WHERE id = ?`)
        .run(paid, tokens, coins, garageCoins, JSON.stringify(quests), count, cur.id);
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

  return {
    routes: {
      'GET /api/gacha': (req, u) => state(getUser(u.id)),
      'POST /api/gacha/spin': async (req, u) => { const body = await req.json(); return requests.run(u.id, body, () => spin(body, u)); },
      'POST /api/gacha/use': async (req, u) => {
        const body = await req.json();
        return use(String(body.item || ''), u);
      }
    },
    prune: requests.prune
  };
}
