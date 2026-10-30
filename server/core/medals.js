// 功績 (メダル) on the server: what a player has done, kept as medals. A medal
// is earned once, when a count the server keeps reaches its goal (or a moment
// comes: the 周年 days), and its reward is received with a tap (POST
// /api/medals/claim): $, ロイヤルコイン, ガレージコイン, free gacha tickets (items
// the gacha takes instead of $: server/core/gacha.js), シークレットアイコン (icons
// that are never sold: js/game/config.js, `given`), another medal, or an effect
// for good (the login bonus +25%, the シークレットオーラ around the icon). Everything about the medals lives
// here: the game is told of the open ones, and of the hidden (裏) ones only
// those the player has — nobody hears a word of the others, not even that
// they exist (their pictures have names that say nothing).
//
// Ranks, low to high: green, blue, purple (the normal medals), gold, red,
// secret (the rare ones); `glow`: a special one, drawn shining.
//
// The counts: the users row keeps those nothing kept before (wins, ULTRA BIG
// WINs, the best combo, $ lost at the casino, cars owned in all, harvests,
// gacha pulls, ロイヤルコイン spent, $ given to players), each written with
// the change it counts; quests cleared are in the quests' JSON (`cleared`),
// the investing gains in the holdings (`gains`, and the dividends). A player
// from before the medals is counted once from what was kept (`medal_init`):
// 特別's counts (its wins stop at 500, its clears at 200), what the casino
// took in all, the cars and trees they have, what they sent — every medal
// already reached is theirs at the next visit.
import crypto from 'node:crypto';
import { ApiError } from './errors.js';
import { RULES } from './rules.js';
import { readQuests } from './quests.js';
import { keyFrom } from './auth.js';

const M = 1000000;
const JST = 9 * 3600000;
// the start of a day in Japan time
const jstDay = (y, m, d) => Date.UTC(y, m - 1, d) - JST;
// 先駆者: registered within a month of the release (2026/10/18), through 11/18
export const PIONEER_UNTIL = jstDay(2026, 11, 19);
// the 周年 medals: theirs from the start of that day, for whoever registered by its end
const ANNIVERSARIES = [['0.5', [2027, 4, 18], 'cbb347370802'], ['1', [2027, 10, 18], '9a50b262a8b6'], ['1.5', [2028, 4, 18], 'db6bee90271c'],
  ['2.0', [2028, 10, 18], '64daac9042b4'], ['3', [2029, 10, 18], '32f4ce956de2']];
// the one-time count of what a player did before the medals (raise it to count everyone again)
const INIT = 1;
// the free gacha tickets: items of these names (+ the gacha's kind)
export const TICKET = 'gacha-ticket:';
export const TICKET_KINDS = ['rare', 'legendary', 'secret'];

export const RANKS = ['green', 'blue', 'purple', 'gold', 'red', 'secret'];
const ticket = (kind, n) => ({ tickets: { [kind]: n } });

// `stat` and `goal`: earned when that count reaches the goal. `test`: earned
// when it says so (at any visit); `once`: looked at once, the first time the
// player is counted (a draw, a number). `img`: the picture (img/medals/<img>.webp;
// '' none yet: the game draws one), the id when not given.
export const MEDALS = [
  // ノーマル
  { id: 'first', name: 'ファーストインプレッション', rank: 'green', test: () => true, text: '初めてログインする', reward: { dollars: 100000 } },
  { id: 'many-friends', name: 'メニーフレンズ', rank: 'green', stat: 'friends', goal: 5, text: 'フレンドを5人つくる（運営・NPCを除く）', reward: { coins: 8 } },
  { id: 'rookie-hunter', name: 'ルーキートレジャーハンター', rank: 'blue', stat: 'login', goal: 10, text: 'ログイン日数が累計10日になる', reward: { dollars: 500000 } },
  { id: 'tycoon', name: '富豪', rank: 'blue', stat: 'casinoEarned', goal: 500 * M, text: 'カジノで累計$500M稼ぐ', reward: { coins: 20 } },
  { id: 'normal-win', name: 'ノーマルウィン', rank: 'blue', stat: 'wins', goal: 500, text: 'カジノで累計500回当たる', reward: ticket('rare', 1) },
  { id: 'small-rich', name: '小金持ち', rank: 'blue', stat: 'casinoEarned', goal: 100 * M, text: 'カジノで累計$100M稼ぐ', reward: { coins: 8 } },
  { id: 'pioneer', name: '先駆者', rank: 'purple', glow: true, img: '', until: PIONEER_UNTIL, test: (c) => c.u.created_at < PIONEER_UNTIL,
    text: 'リリースから1か月以内（2026/11/18まで）に登録する', reward: {} },
  { id: 'car-owner-1', name: 'カーオーナーI', rank: 'purple', stat: 'cars', goal: 5, text: '車を5台同時に所有する', reward: { garage: 1 } },
  { id: 'rookie-guild', name: 'ルーキーギルドマスター', rank: 'purple', stat: 'clears', goal: 600, text: 'クエストを累計600回クリアする', reward: ticket('rare', 2) },
  { id: 'consumer', name: '消費者', rank: 'purple', stat: 'coinsSpent', goal: 100, text: 'ロイヤルコインを累計100枚使う', reward: { coins: 12 } },
  // レア
  { id: 'car-owner-2', name: 'カーオーナーII', rank: 'gold', stat: 'carsGot', goal: 10, text: '車を累計10台所有する', reward: { garage: 3 } },
  { id: 'millionaire', name: '大富豪', rank: 'gold', stat: 'casinoEarned', goal: 1200 * M, text: 'カジノで累計$1200M稼ぐ', reward: ticket('secret', 1) },
  { id: 'guild-master', name: 'ギルドマスター', rank: 'gold', stat: 'clears', goal: 1000, text: 'クエストを累計1000回クリアする', reward: { coins: 120 } },
  { id: 'master-spirit', name: '達人精神', rank: 'gold', stat: 'harvests', goal: 6, text: '金の生る木を累計6回収穫する', reward: { coins: 40 } },
  { id: 'basic-income', name: 'ベーシックインカム', rank: 'gold', stat: 'given', goal: 500 * M, text: 'プレイヤーに累計$500M送る', reward: { coins: 150 } },
  { id: 'loser', name: '負け犬', rank: 'gold', img: '', stat: 'casinoLost', goal: 900 * M, text: 'カジノで累計$900M失う', reward: { coins: 24 } },
  { id: 'super-win', name: 'スーパーウィン', rank: 'red', stat: 'wins', goal: 1800, text: 'カジノで累計1800回当たる', reward: { coins: 140 } },
  { id: 'treasure-hunter', name: 'トレジャーハンター', rank: 'red', stat: 'ultra', goal: 5, text: 'ULTRA BIG WINを累計5回出す', reward: ticket('secret', 1) },
  { id: 'super-guild', name: 'スーパーギルドマスター', rank: 'red', stat: 'clears', goal: 3500, text: 'クエストを累計3500回クリアする', reward: ticket('secret', 1) },
  { id: 'special-user', name: 'スペシャルユーザー', rank: 'red', stat: 'login', goal: 150, text: 'ログイン日数が累計150日になる', reward: ticket('rare', 10) },
  { id: 'invest-talent', name: '投資の才能', rank: 'red', img: '', stat: 'invest', goal: 1000 * M, text: '投資で累計$1000M儲ける', reward: { coins: 80 } },
  { id: 'vital-hunter', name: 'バイタルトレジャーハンター', rank: 'red', stat: 'login', goal: 200, text: 'ログイン日数が累計200日になる', reward: { login: 25 } },
  { id: 'cosmic', name: 'コズミック', rank: 'secret', stat: 'combo', goal: 8, text: 'カジノで8コンボする', reward: ticket('secret', 1) },
  { id: 'super-hunter', name: 'スーパートレジャーハンター', rank: 'secret', stat: 'ultra', goal: 10, text: 'ULTRA BIG WINを累計10回出す', reward: ticket('secret', 1) },
  { id: 'excellent', name: 'エクセレントワーク', rank: 'secret', all: true, text: 'このメダル以外のメダルをすべて集める', reward: { coins: 400, tickets: { legendary: 3 } } },
  // 裏メダル (hidden)
  { id: 'minor-booster', name: 'マイナーブースター', rank: 'gold', hidden: true, img: '1ea10f762f33', once: (c) => c.draw('minor') < 0.001,
    text: '登録したユーザーの0.1%だけが手にするメダル', reward: { coins: 40 } },
  { id: 'user-30', name: '30人目のユーザー', rank: 'gold', hidden: true, img: 'f25e040bdb88', once: (c) => c.number() === 30,
    text: '30人目に登録したユーザー', reward: { coins: 30 } },
  { id: 'many-many-hunter', name: 'メニメニトレジャーハンター', rank: 'red', hidden: true, img: '7616c1a3e471', stat: 'pulls', goal: 35,
    text: 'ガチャを累計35回まわす', reward: { coins: 88 } },
  { id: 'user-100', name: '100人目のユーザー', rank: 'red', hidden: true, img: 'ec9db464ecad', once: (c) => c.number() === 100,
    text: '100人目に登録したユーザー', reward: { coins: 90 } },
  ...ANNIVERSARIES.map(([n, day, img]) => ({ id: 'anniv-' + n, name: `リリース${n}周年記念メダル`, rank: 'red', hidden: true, img,
    at: jstDay(...day), test: (c, m) => c.now >= m.at && c.u.created_at < m.at + 86400000, text: `リリース${n}周年までに登録したユーザー`, reward: {} })),
  { id: 'ultra-minor-booster', name: 'ULTRAマイナーブースター', rank: 'secret', hidden: true, img: 'c3b3407e47ba', once: (c) => c.draw('ultra-minor') < 0.0001,
    text: '登録したユーザーの0.01%だけが手にするメダル', reward: { coins: 80, tickets: { rare: 10 } } },
  { id: 'user-200', name: '200人目のユーザー', rank: 'secret', hidden: true, img: 'dad61c1454c6', once: (c) => c.number() === 200,
    text: '200人目に登録したユーザー', reward: { coins: 120, tickets: { rare: 3 } } },
  { id: 'developer', name: '開発者', rank: 'secret', hidden: true, glow: true, img: 'b130ea087094', test: (c) => c.isDeveloper(c.u),
    text: 'Two stateの開発者', reward: {} },
  { id: 'top-trader', name: '最強トレーダー', rank: 'secret', hidden: true, glow: true, img: '9f30ad6f6116', stat: 'invest', goal: 8500 * M,
    text: '投資で累計$8500M稼ぐ', reward: { icons: 3, aura: true, tickets: { secret: 2 }, medal: 'certified' } },
  { id: 'certified', name: '公認メダル', rank: 'secret', hidden: true, glow: true, img: '8fa7020aa920', given: true,
    text: '最強トレーダーだけが手にするメダル', reward: {} }
];
export const BY_ID = new Map(MEDALS.map((m) => [m.id, m]));
const ORDER = new Map([...MEDALS].sort((a, b) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)).map((m, i) => [m.id, i]));
const OPEN = MEDALS.filter((m) => !m.hidden);
// the シークレットアイコン a reward picks from (those the player does not have yet)
const SECRET_ICONS = RULES.avatars.filter((a) => a.given).map((a) => a.id);
// the counts the spin changes (looked at after every spin, server/core/api.js)
const SPIN_STATS = ['wins', 'ultra', 'combo', 'casinoEarned', 'casinoLost'];
// the counts that are $ (the game shows them so)
const MONEY = new Set(['casinoEarned', 'casinoLost', 'given', 'invest']);

// The quests cleared in all: the quests' own count (from the medals on), or
// 特別's (it stops at 200), whichever is more.
export function questClears(state) {
  return Math.max(Number(state.cleared) || 0, Number(state.special && state.special.m && state.special.m.clear) || 0);
}

// A car comes to a player (bought, drawn, given, bought from a friend): one
// more in カーオーナーII's count, unless the car was theirs once before (a
// car handed back and forth counts once). Inside the caller's transaction.
export function carGot(q, userId, carId) {
  const n = Number(q("UPDATE cars SET owners = CASE WHEN owners = '' THEN ',' ELSE owners END || ? || ',' WHERE id = ? AND instr(owners, ?) = 0")
    .run(String(userId), carId, ',' + userId + ',').changes);
  if (n) q('UPDATE users SET cars_got = cars_got + 1 WHERE id = ?').run(userId);
}

// What a reward is, as the game shows it: [{ type, n, kind?, name? }]
function rewardList(r) {
  const out = [];
  if (r.dollars) out.push({ type: 'dollars', n: r.dollars });
  if (r.coins) out.push({ type: 'coins', n: r.coins });
  if (r.garage) out.push({ type: 'garage', n: r.garage });
  for (const kind of TICKET_KINDS) if (r.tickets && r.tickets[kind]) out.push({ type: 'ticket', kind, n: r.tickets[kind] });
  if (r.icons) out.push({ type: 'icons', n: r.icons });
  if (r.aura) out.push({ type: 'aura', name: 'シークレットオーラ' });
  if (r.login) out.push({ type: 'login', n: r.login });
  if (r.medal) out.push({ type: 'medal', name: BY_ID.get(r.medal).name });
  return out;
}

export function createMedals({ q, tx, getUser, live, secret, addItems, itemsOf, balanceChanged, meDto, isDeveloper = () => false, isOperator = () => false,
  clock = Date.now, enabled = true }) {
  const key = keyFrom(secret, 'medals');
  const LOGIN = MEDALS.filter((m) => m.reward.login);

  const rows = (userId) => new Map(q('SELECT medal, earned_at, claimed_at FROM medals WHERE user_id = ?').all(userId).map((r) => [r.medal, r]));
  const ready = (userId) => q('SELECT COUNT(*) AS n FROM medals WHERE user_id = ? AND claimed_at = 0').get(userId).n;
  const carCount = (userId) => q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(userId).n;
  // friends who are players (not an operator: NPCs are never friends, server/core/api.js)
  const friendCount = (userId) => q(`SELECT o.* FROM friends f JOIN users o ON o.id = f.friend_id WHERE f.user_id = ? AND o.npc = ''`).all(userId)
    .filter((o) => !isOperator(o)).length;
  const investGain = (userId) => q('SELECT COALESCE(SUM(gains + dividends), 0) AS n FROM stock_holdings WHERE user_id = ?').get(userId).n;

  const STATS = {
    login: (u) => u.login_days,
    casinoEarned: (u) => u.total_won * RULES.tokenPrice,
    casinoLost: (u) => u.casino_lost,
    wins: (u) => u.wins,
    ultra: (u) => u.ultra_wins,
    combo: (u) => u.best_combo,
    clears: (u) => questClears(readQuests(u.quests)),
    friends: (u) => friendCount(u.id),
    cars: (u) => carCount(u.id),
    carsGot: (u) => u.cars_got,
    harvests: (u) => u.harvests,
    given: (u) => u.given,
    coinsSpent: (u) => u.coins_spent,
    pulls: (u) => u.gacha_pulls,
    invest: (u) => investGain(u.id)
  };
  // The player's counts, each looked up when something asks for it.
  function counts(u) {
    const seen = {};
    return (stat) => (stat in seen ? seen[stat] : (seen[stat] = STATS[stat](u)));
  }
  // A number from 0 to 1 that is the player's for good: the same whenever it is drawn, nobody without the server's key can tell it.
  const draw = (userId, label) => crypto.createHmac('sha256', key).update(label + ':' + userId).digest().readUIntBE(0, 6) / 2 ** 48;

  // What a player did before the medals, counted once (the greatest of it and what was counted since).
  function init(u) {
    const quests = readQuests(u.quests), special = (quests.special && quests.special.m) || {};
    const combo = Math.max(0, ...Object.values(quests).map((p) => (p && p.m && Number(p.m.combo)) || 0));
    const sent = q(`SELECT COALESCE(SUM(CASE WHEN t.currency = 'tokens' THEN t.amount * ? ELSE t.amount END), 0) AS n
                    FROM transfer_history t JOIN users o ON o.id = t.to_id WHERE t.from_id = ? AND o.npc = ''`).get(RULES.tokenPrice, u.id).n;
    // (a car bought from a friend is paid as a transfer too: that is a purchase, not a gift)
    const sales = q("SELECT COALESCE(SUM(amount), 0) AS n FROM message_history WHERE kind = 'car_sold' AND sender_id = ? AND claimed_at > 0").get(u.id).n;
    const harvests = q('SELECT COUNT(*) AS n FROM trees WHERE user_id = ? AND harvested > 0').get(u.id).n;
    q(`UPDATE users SET wins = MAX(wins, ?), best_combo = MAX(best_combo, ?), casino_lost = MAX(casino_lost, ?), cars_got = MAX(cars_got, ?),
         harvests = MAX(harvests, ?), given = MAX(given, ?), medal_init = ? WHERE id = ?`)
      .run(Number(special.win) || 0, combo, Math.max(0, u.total_bet - u.total_won) * RULES.tokenPrice, Math.max(carCount(u.id), Number(special.carBuy) || 0),
        harvests, Math.max(0, sent - sales), INIT, u.id);
    return getUser(u.id);
  }

  // Every medal the player reached and does not have yet becomes theirs (the
  // game hears of it at once). Returns the ids earned now.
  function sync(userId) {
    if (!enabled) return [];
    let u = getUser(userId);
    if (!u || u.npc) return [];
    const now = clock();
    const got = tx(() => {
      const fresh = u.medal_init < INIT;
      if (fresh) u = init(u);
      const have = rows(userId);
      const c = {
        u, now, count: counts(u), isDeveloper,
        draw: (label) => draw(u.id, label),
        number: () => q("SELECT COUNT(*) AS n FROM users WHERE npc = '' AND id <= ?").get(u.id).n
      };
      const got = [];
      for (const m of MEDALS) {
        if (have.has(m.id) || m.given || m.all) continue;
        const reached = m.stat ? c.count(m.stat) >= m.goal : m.test ? m.test(c, m) : m.once ? fresh && m.once(c, m) : false;
        if (reached) got.push(m.id);
      }
      // エクセレントワーク: all the others (one whose time is over and was not theirs is not asked for)
      if (!have.has('excellent') && OPEN.every((m) => m.all || have.has(m.id) || got.includes(m.id) || (m.until && u.created_at >= m.until))) got.push('excellent');
      return got.filter((id) => Number(q('INSERT OR IGNORE INTO medals (user_id, medal, earned_at) VALUES (?, ?, ?)').run(userId, id, now).changes) > 0);
    });
    if (got.length) tell(userId, got, now);
    return got;
  }
  function tell(userId, ids, now) {
    live.send(userId, 'medal', { got: ids.map((id) => dto(BY_ID.get(id), { earned_at: now, claimed_at: 0 })), ready: ready(userId) });
  }

  // After a spin (`before`, `after`: its counts, server/core/api.js): looked into only when one of them went past a goal.
  function spun(userId, before, after) {
    for (const m of MEDALS) {
      if (m.stat && SPIN_STATS.includes(m.stat) && before[m.stat] < m.goal && after[m.stat] >= m.goal) return sync(userId);
    }
    return [];
  }
  // A count went from `before` to `after` (quests cleared): looked into only when it went past a goal.
  function passed(userId, stat, before, after) {
    return MEDALS.some((m) => m.stat === stat && before < m.goal && after >= m.goal) ? sync(userId) : [];
  }

  // The login bonus's extra, in % (バイタルトレジャーハンター, once received).
  function loginBoost(userId) {
    if (!enabled) return 0;
    return LOGIN.reduce((n, m) => n + (q('SELECT 1 AS x FROM medals WHERE user_id = ? AND medal = ? AND claimed_at > 0').get(userId, m.id) ? m.reward.login : 0), 0);
  }

  function dto(m, row, c = null) {
    const out = {
      id: m.id, name: m.name, rank: m.rank, img: m.img === undefined ? m.id : m.img, text: m.text, reward: rewardList(m.reward),
      earned: row ? row.earned_at : 0, claimed: row ? row.claimed_at : 0
    };
    if (m.glow) out.glow = true;
    if (m.hidden) out.hidden = true;
    if (!row && c) {
      if (m.stat) out.progress = { have: Math.min(m.goal, Math.max(0, c.count(m.stat))), goal: m.goal, ...(MONEY.has(m.stat) ? { money: true } : {}) };
      if (m.until && c.u.created_at >= m.until) out.closed = true;
    }
    return out;
  }
  // The medals the player may know of: the open ones and the hidden ones they have, rarest last.
  function list(userId) {
    const u = getUser(userId), have = rows(userId), c = { u, count: counts(u) };
    const medals = MEDALS.filter((m) => !m.hidden || have.has(m.id)).sort((a, b) => ORDER.get(a.id) - ORDER.get(b.id))
      .map((m) => dto(m, have.get(m.id), c));
    return { medals, ready: [...have.values()].filter((r) => !r.claimed_at).length, now: clock() };
  }

  // 受け取る: the medal's reward, once.
  function claim(u, id) {
    const m = BY_ID.get(id);
    const now = clock();
    const r = tx(() => {
      const row = m && q('SELECT * FROM medals WHERE user_id = ? AND medal = ?').get(u.id, id);
      if (!row) throw new ApiError(404, 'no_medal', 'このメダルはまだ持っていません');
      // (a retry of a claim whose answer was lost: nothing more)
      if (!Number(q('UPDATE medals SET claimed_at = ? WHERE user_id = ? AND medal = ? AND claimed_at = 0').run(now, u.id, id).changes)) return { again: true };
      const w = m.reward;
      if (w.dollars || w.coins || w.garage) {
        q('UPDATE users SET dollars = dollars + ?, coins = coins + ?, garage_extra = garage_extra + ?, rev = rev + 1 WHERE id = ?')
          .run(w.dollars || 0, w.coins || 0, w.garage || 0, u.id);
      }
      for (const kind of TICKET_KINDS) if (w.tickets && w.tickets[kind]) addItems(u.id, TICKET + kind, w.tickets[kind]);
      // シークレットアイコン: drawn from those the player does not have yet
      const icons = [];
      if (w.icons) {
        const owned = getUser(u.id).avatars.split(',').filter(Boolean), pool = SECRET_ICONS.filter((a) => !owned.includes(a));
        while (icons.length < w.icons && pool.length) icons.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
        if (icons.length) q('UPDATE users SET avatars = ? WHERE id = ?').run([...owned, ...icons].join(','), u.id);
      }
      if (w.aura) q('UPDATE users SET aura = 1 WHERE id = ?').run(u.id);
      const more = w.medal && Number(q('INSERT OR IGNORE INTO medals (user_id, medal, earned_at) VALUES (?, ?, ?)').run(u.id, w.medal, now).changes) > 0;
      return { more, icons };
    });
    const w = m.reward;
    if (!r.again) {
      if (w.dollars || w.coins || w.garage) balanceChanged(u.id);
      if (w.tickets) live.send(u.id, 'items', { items: itemsOf(u.id) });
      if (r.more) tell(u.id, [w.medal], now);
    }
    const row = q('SELECT * FROM medals WHERE user_id = ? AND medal = ?').get(u.id, id);
    return { medal: dto(m, row), reward: r.again ? [] : rewardList(w), ...(r.icons && r.icons.length ? { icons: r.icons } : {}),
      again: !!r.again, ready: ready(u.id), me: meDto(getUser(u.id)), now };
  }

  return {
    routes: {
      'GET /api/medals': (req, u) => {
        sync(u.id);
        return list(u.id);
      },
      'POST /api/medals/claim': async (req, u) => {
        const body = await req.json();
        if (!enabled) throw new ApiError(404, 'no_medal', 'このメダルはまだ持っていません');
        return claim(u, String(body.medal || ''));
      }
    },
    sync, spun, passed, loginBoost, ready, list,
    // the counts as the spin finds them in the row (`u`), for spun()
    spinCounts: (u) => ({ wins: u.wins, ultra: u.ultra_wins, combo: u.best_combo, casinoEarned: u.total_won * RULES.tokenPrice, casinoLost: u.casino_lost })
  };
}
