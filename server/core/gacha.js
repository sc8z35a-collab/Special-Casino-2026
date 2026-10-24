// Capsule gacha: the shared rules draw the rewards, this module settles them.
// Payment and every reward from a spin commit in the same SQLite transaction.
import { ApiError } from './errors.js';
import { RULES, GACHA, VIP } from './rules.js';
import { readQuests, questTickets } from './quests.js';

const SEED = 'gacha-seed';
const VIP_WEEK = 'gacha-vip-week';

function secureRandom() {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return r[0] / 4294967296;
}

export function createGacha({ q, tx, getUser, meDto, addItems, itemsOf, balanceChanged, afterSpend, now = Date.now, rand = secureRandom }) {
  const carCount = (id) => q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(id).n;
  const treeCount = (id) => q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ?').get(id).n;
  const garageSize = (u) => RULES.garage.slots + (u.garage_extra || 0);
  const itemCount = (id, item) => (itemsOf(id)[item] || 0);

  function state(u) {
    const at = now();
    const events = GACHA.events(at);
    return {
      now: at,
      events,
      prices: {
        normal: GACHA.price(1, events.sale.on),
        ten: GACHA.price(10, events.sale.on)
      },
      items: { seed: itemCount(u.id, SEED), vipWeek: itemCount(u.id, VIP_WEEK) },
      maxTrees: RULES.tree.max
    };
  }

  function spin(body, u) {
    const kind = String(body.kind || 'normal');
    const count = Number(body.count);
    if (kind !== 'normal' && kind !== 'rare') throw new ApiError(400, 'bad_gacha', 'ガチャの種類を選んでください');
    if (count !== 1 && count !== 10) throw new ApiError(400, 'bad_count', '回数は1回または10回です');

    const result = tx(() => {
      const cur = getUser(u.id);
      const at = now();
      const events = GACHA.events(at);
      const paid = GACHA.price(count, events.sale.on);
      if (cur.dollars < paid) throw new ApiError(409, 'insufficient', '$が足りません');
      const pulls = GACHA.draw(kind, count, events.boost.on, events.sale.on, rand);
      const rewards = pulls.flatMap((p) => p.rewards);
      const cars = rewards.filter((r) => r.type === 'car');
      const garageCoins = rewards.filter((r) => r.type === 'garage').length;
      const grownTrees = rewards.filter((r) => r.type === 'grown-tree').length;
      if (carCount(cur.id) + cars.length > garageSize(cur) + garageCoins) {
        throw new ApiError(409, 'garage_full', 'ガレージの空きが足りません。車を整理してから回してください');
      }
      if (treeCount(cur.id) + grownTrees > RULES.tree.max) {
        throw new ApiError(409, 'trees_full', `金の生る木は${RULES.tree.max}本までです。枠を空けてから回してください`);
      }

      let tokens = 0, coins = 0, resets = 0;
      const quests = readQuests(cur.quests);
      for (const pull of pulls) coins += pull.bonus || 0;
      for (const r of rewards) {
        if (r.type === 'car') {
          q("INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at, paid, via) VALUES (?, ?, 0, ?, ?, 0, 'gacha')")
            .run(cur.id, r.carId, at, at);
        } else if (r.type === 'lot') tokens += r.amount;
        else if (r.type === 'royal') coins += r.amount;
        else if (r.type === 'garage') { /* counted below */ }
        else if (r.type === 'reset') resets++;
        else if (r.type === 'seed') addItems(cur.id, SEED, 1);
        else if (r.type === 'vip-week') addItems(cur.id, VIP_WEEK, 1);
        else if (r.type === 'grown-tree') {
          q('INSERT INTO trees (user_id, name, super, given, price, created_at) VALUES (?, ?, 0, ?, 0, ?)')
            .run(cur.id, '金の生る木', GACHA.grownGiven, at);
        }
      }
      if (resets) {
        const tickets = questTickets(quests);
        quests.tickets = { '5h': tickets['5h'] + resets, day: tickets.day };
      }
      q(`UPDATE users SET dollars = dollars - ?, tokens = tokens + ?, coins = coins + ?,
           garage_extra = garage_extra + ?, quests = ?, rev = rev + 1 WHERE id = ?`)
        .run(paid, tokens, coins, garageCoins, JSON.stringify(quests), cur.id);
      return { pulls, paid, kind, count };
    });

    const after = balanceChanged(u.id);
    afterSpend(u.id);
    return { ...result, me: meDto(after), ...state(after) };
  }

  function use(item, u) {
    if (item !== 'seed' && item !== 'vip-week') throw new ApiError(400, 'bad_item', 'このアイテムは使えません');
    const key = item === 'seed' ? SEED : VIP_WEEK;
    const at = now();
    tx(() => {
      const cur = getUser(u.id);
      if (itemCount(cur.id, key) < 1) throw new ApiError(409, 'no_item', 'アイテムを持っていません');
      if (item === 'seed') {
        if (treeCount(cur.id) >= RULES.tree.max) throw new ApiError(409, 'trees_full', `金の生る木は${RULES.tree.max}本までです`);
        addItems(cur.id, key, -1);
        q("INSERT INTO trees (user_id, name, super, given, price, created_at) VALUES (?, '金の生る木', 0, 0, 0, ?)").run(cur.id, at);
      } else {
        const until = Math.max(at, cur.vip_until) + 7 * VIP.day;
        if (until > at + RULES.vip.maxDays * VIP.day) throw new ApiError(409, 'too_long', `VIPは${RULES.vip.maxDays}日先までです`);
        addItems(cur.id, key, -1);
        q('UPDATE users SET vip_until = ?, rev = rev + 1 WHERE id = ?').run(until, cur.id);
      }
    });
    const after = item === 'vip-week' ? balanceChanged(u.id) : getUser(u.id);
    return { ok: true, item, me: meDto(after), ...state(after) };
  }

  return {
    routes: {
      'GET /api/gacha': (req, u) => ({ ...state(u), me: meDto(getUser(u.id)) }),
      'POST /api/gacha/spin': async (req, u) => spin(await req.json(), u),
      'POST /api/gacha/use': async (req, u) => {
        const body = await req.json();
        return use(String(body.item || ''), u);
      }
    }
  };
}
