// The game's JSON API, independent of the host. Every balance change happens
// inside one SQLite transaction and bumps the player's `rev`, so clients can
// drop stale balance updates. Nothing here ever resets a balance.
//
//   const api = createApi({ db, live, config, secret, hostAdmin })
//   await api.handle(req)  // req: { method, path, query, header(name), ip, json(limit) }
//                          // -> { status, body }
//
// `live` pushes events to connected players: send(userId, event, data),
// broadcast(event, data, filter), isOnline(userId), onlineCount().
// `hostAdmin(cmd, args)` may answer operator commands only one host has
// (it returns undefined for the rest). `blobs`, when the host has a bucket,
// keeps the developer's vault's files (server/core/vault.js). `host` tells
// the operator site's サーバー tab about the machine (server/core/stats.js),
// and the host reports the bytes of each answer it sends: api.sent(bytes).
import { ApiError, posInt } from './errors.js';
import { statements } from './db.js';
import {
  newToken, sha256, newRecoveryCode, normalizeRecoveryCode, nameKey, cleanName, cleanText,
  cleanPassword, hashPassword, verifyPassword, signTicket, verifyTicket, sealText, openText, keyFrom
} from './auth.js';
import { Limiter } from './ratelimit.js';
import {
  RULES, AVATARS, CARS, SHOP, FRUITS, JOBS, QUESTS, LEVEL, RELEASE, VIP, RECEIPTS,
  spin as spinReels, evaluate as evaluateLine, shopSale, carSale, carPrice, carBuyback, carDisposal, utcDay, nextUtcMidnight, loginDay, nextLoginReset, fmt
} from './rules.js';
import { createAdmin } from './admin.js';
import { createPeter, reservedName } from './peter.js';
import { createJohnson } from './johnson.js';
import { createOfficial } from './official.js';
import { createOpsLog, jst } from './opslog.js';
import { createPush } from './push.js';
import { screen as filterText } from './filter.js';
import { createQuota, isQuotaError, maintenanceBody } from './quota.js';
import { readQuests, stepQuests, claimQuests, questsReady, questView, questTickets, grantLevelTickets, resetQuestPeriod, questBonuses } from './quests.js';
import { createOps, DELETED, ARCHIVE_DAYS } from './ops.js';
import { createOpsLogin } from './opslogin.js';
import { createOpsEntry } from './opsentry.js';
import { createEmergency } from './emergency.js';
import { createShield } from './shield.js';
import { createSec } from './sec.js';
import { createBackup } from './backup.js';
import { createTrees } from './tree.js';
import { createDevCode } from './devcode.js';
import { createPay } from './pay.js';
import { createTeam } from './team.js';
import { createStats } from './stats.js';
import { createVault, VAULT_BULK } from './vault.js';
import { REASONS as FILTERED } from './attach.js';
import { createDiscord } from './discord.js';

const PAGE = 50;
const CURRENCIES = ['tokens', 'dollars'];
const PLAYER_TRANSFER_DAILY_DOLLARS = 5000000;
// voice: the home call (a player and everyone watching them)
const CALL_TYPES = new Set(['home', 'hub']);
// the push services browsers subscribe with (Chrome / Android, Firefox, Safari / iPhone, Edge)
const PUSH_HOSTS = /^(?:fcm\.googleapis\.com|android\.googleapis\.com|(?:[\w-]+\.)*push\.services\.mozilla\.com|(?:[\w-]+\.)*push\.apple\.com|(?:[\w-]+\.)*notify\.windows\.com)$/;
const MAX_PENDING_REQUESTS = 50;
const CHARM = RULES.charm;
// group chats: members (with the one who made it) and the length of a name
const GROUP_MAX = 20;
const GROUP_NAME_MAX = 20;
// the beginner guide is for players who have played less than this
const GUIDE_MS = 30 * 60000;
// two requests further apart than this are two sessions (the gap is not play time)
const SESSION_GAP = 5 * 60000;
// feedback: ratings 0-5 (0 = not rated) of these, and a comment of any length
const FEEDBACK_KEYS = ['slot', 'features', 'clarity', 'controls', 'looks', 'polish'];
const FEEDBACK_MAX = 100000;
// home chat: the latest lines kept for people who come in (not stored)
const HOME_CHAT_KEEP = 30;
// 運営へのメッセージ・報告・意見案・通報・プレイヤー間のメッセージ: RULES.sendMax
// (the game stops bigger ones before they are sent; a request this big holds any it lets through)
const TOO_BIG = '送信できません。大きすぎます。';
const SEND_BYTES = 64 * 1024;
// 送信の取り消し: a player's own words, within the hour (RULES.retract)
const RETRACT_MS = RULES.retract.minutes * 60000;
// 通報 of one message: so many a day (days from 6:00 Japan time), so many characters
const MESSAGE_REPORT = RULES.messageReport;
// the chat stopped by the automatic filter (server/core/attach.js)
const CHAT_BANNED = '自動フィルタリングシステムがテキスト以外の送信を止めたため、運営が確認するまでチャットは使えません（Ice Smoker公式へのメッセージは送れます）';

function randomInt(lo, hi) {
  const r = new Uint32Array(1);
  globalThis.crypto.getRandomValues(r);
  return lo + (r[0] % (hi - lo + 1));
}

export function createApi({ db, live: hostLive, config, secret, hostAdmin = null, defer = null, blobs = null, host = null, questRewardRoll, questTicketRoll }) {
  const q = statements(db);
  const tx = (fn) => db.tx(fn);
  const quota = createQuota(db, { requests: config.dailyRequestLimit, megabytes: config.dailyMbLimit });
  const stats = createStats({ db, q, config, host: host || {}, defer });
  // live pushes: counted for the サーバー tab, and towards the bytes sent when a cap is set
  const live = {
    send(userId, event, data) {
      stats.wsOut();
      if (quota.on) quota.sent(JSON.stringify(data).length + 32);
      return hostLive.send(userId, event, data);
    },
    broadcast(event, data, filter) {
      stats.wsOut(hostLive.onlineCount());
      if (quota.on) quota.sent((JSON.stringify(data).length + 32) * hostLive.onlineCount());
      return hostLive.broadcast(event, data, filter);
    },
    isOnline: (id) => hostLive.isOnline(id),
    onlineCount: () => hostLive.onlineCount(),
    // the operator site's own live connection (the 運営チャット's call, the developer called)
    sendOps(userId, event, data) {
      stats.wsOut();
      return hostLive.sendOps ? hostLive.sendOps(userId, event, data) : undefined;
    },
    opsOnline: (id) => !!(hostLive.opsOnline && hostLive.opsOnline(id))
  };
  const start = {
    tokens: config.startTokens ?? RULES.start.tokens,
    dollars: config.startDollars ?? RULES.start.dollars,
    coins: config.startCoins ?? RULES.start.coins
  };
  // [refills per minute, burst]
  const LIMITS = {
    register: [config.registerPerMinute, Math.max(1, Math.ceil(config.registerPerMinute / 2))],
    login: [10, 5],
    nameCheck: [60, 20],
    spin: [120, 6],
    shop: [60, 10],
    typing: [120, 20],
    dm: [40, 8],
    transfer: [10, 5],
    friend: [30, 10],
    call: [600, 120],
    tip: [240, 40],
    read: [240, 30],
    general: [600, 60],
    ...config.limits
  };
  const limit = {};
  for (const [k, [perMinute, burst]] of Object.entries(LIMITS)) limit[k] = new Limiter(perMinute, burst);

  /* ---------------------------------------------------------------- helpers */

  const getUser = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
  const findByName = (raw) => q('SELECT * FROM users WHERE name_key = ?').get(nameKey(raw));
  const dmChannel = (a, b) => `dm:${Math.min(a, b)}:${Math.max(a, b)}`;
  const isBlocked = (userId, otherId) => !!q('SELECT 1 AS x FROM blocks WHERE user_id = ? AND blocked_id = ?').get(userId, otherId);
  const areFriends = (a, b) => !!q('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?').get(a, b);
  const hasRequest = (from, to) => !!q('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?').get(from, to);
  const ownedAvatars = (u) => (u.avatars ? u.avatars.split(',') : []);
  const carCount = (id) => q('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?').get(id).n;
  // how many cars a garage holds: two, and one more for every place bought
  const garageSize = (u) => RULES.garage.slots + (u.garage_extra || 0);
  // what one more place costs (VIP: RULES.vip.garageOff % off)
  const slotPrice = (u) => (vipOn(u) ? Math.round(RULES.garage.slotPrice * (100 - RULES.vip.garageOff) / 10000) * 100 : RULES.garage.slotPrice);

  // Renting cars out (RULES.carRental): for every 5-hour block a car is out,
  // customers come (each of them with a chance of its own) and pay by how
  // dear the car is, now and then one pays $150,000; it waits to be
  // collected. Stopped, a car comes back at the end of its block (5 hours at
  // the least). Counted when someone looks (and by the housekeeping).
  const RENT = RULES.carRental, BLOCK = RENT.hours * 3600000;
  function customer(model) {
    if (randomInt(1, 10000) <= RENT.vip.chance * 10000) return { pay: RENT.vip.pay, vip: true };
    // $1M cars and less: 10k-30k; $20M and more: 40k-60k
    const t = Math.max(0, Math.min(1, Math.log((model ? model.price : 1e6) / 1e6) / Math.log(20)));
    const lo = RENT.min + (RENT.max - RENT.spread - RENT.min) * t;
    return { pay: Math.round(lo / 1000) * 1000 + randomInt(0, RENT.spread / 1000) * 1000, vip: false };
  }
  function settleRental(c, now = Date.now()) {
    if (!c.rent_start) return false;
    const back = c.rent_until > 0 && c.rent_until <= now;
    const blocks = Math.floor(((back ? c.rent_until : now) - c.rent_start) / BLOCK);
    if (blocks <= c.rent_blocks && !back && c.rent_earned < RENT.maxPay) return false;
    const model = CARS.get(c.model);
    let earned = 0, last = null;
    for (let b = c.rent_blocks; b < blocks && c.rent_earned + earned < RENT.maxPay; b++) {
      let n = 0, sum = 0, vip = 0;
      for (const chance of RENT.customers) {
        if (randomInt(1, 10000) > chance * 10000) continue;
        const x = customer(model);
        n++;
        sum += x.pay;
        if (x.vip) vip++;
      }
      sum = Math.min(sum, RENT.maxPay - c.rent_earned - earned);
      earned += sum;
      last = { n, sum, vip, at: c.rent_start + (b + 1) * BLOCK };
    }
    // (counted once: another request that got here first wins)
    const full = c.rent_earned + earned >= RENT.maxPay, stopped = back || full;
    return Number(q(`UPDATE cars SET rent_blocks = ?, rent_earned = MIN(?, rent_earned + ?), rent_last = ?, rent_start = ?, rent_until = ?, rent_paused = ?
                     WHERE id = ? AND rent_start = ? AND rent_blocks = ?`)
      .run(stopped ? 0 : blocks, RENT.maxPay, earned, last ? JSON.stringify(last) : c.rent_last,
        stopped ? 0 : c.rent_start, stopped ? 0 : c.rent_until, full && !c.rent_until ? 1 : 0, c.id, c.rent_start, c.rent_blocks).changes) > 0;
  }
  function settleRentals(userId) {
    for (const c of q('SELECT * FROM cars WHERE owner_id = ? AND rent_start > 0').all(userId)) tx(() => settleRental(c));
  }
  function carDto(r) {
    let last = null;
    try { last = r.rent_last ? JSON.parse(r.rent_last) : null; } catch { last = null; }
    return {
      id: r.id, model: r.model, acquiredAt: r.acquired_at, from: r.from_id ? { id: r.from_id, name: r.from_name } : null,
      rent: r.rent_paused ? { paused: true, start: 0, until: 0, next: 0 }
        : r.rent_start ? { start: r.rent_start, until: r.rent_until, next: r.rent_start + (r.rent_blocks + 1) * BLOCK } : null,
      earned: Math.min(RENT.maxPay, r.rent_earned), waiting: r.rent_earned >= RENT.maxPay, last,
      paid: carPaid(r), used: !!r.used, offer: r.offer_id || 0, via: r.via || (r.from_id ? 'gift' : ''),
      engine: r.engine || null, buyback: ownedCarBuyback(r)
    };
  }
  function ownedCarBuyback(c) {
    const model = CARS.get(c.model);
    if (!model) return null;
    const price = carBuyback(model), engine = SHOP.get(c.engine);
    return { ...price, price: price.price + (engine && engine.kind === 'engine' ? Math.floor(engine.price * 0.9) : 0) };
  }
  // what the owner paid for a car (cars from before this was kept: its list price)
  const carPaid = (c) => c.paid || (CARS.get(c.model) ? CARS.get(c.model).price : 0);
  // what a car can be sold for to a friend: RULES.carResale % of that
  function resaleRange(c) {
    const R = RULES.carResale, base = carPaid(c);
    return { base, min: Math.ceil(base * R.min / 100), max: Math.floor(base * R.max / 100) };
  }
  const itemCount = (userId, item) => { const r = q('SELECT count FROM items WHERE user_id = ? AND item = ?').get(userId, item); return r ? r.count : 0; };
  function addItems(userId, item, n) {
    q(`INSERT INTO items (user_id, item, count) VALUES (?, ?, ?)
       ON CONFLICT(user_id, item) DO UPDATE SET count = items.count + excluded.count`).run(userId, item, n);
    q('DELETE FROM items WHERE user_id = ? AND count <= 0').run(userId);
  }
  function itemsOf(userId) {
    const out = {};
    for (const r of q('SELECT item, count FROM items WHERE user_id = ?').all(userId)) out[r.item] = r.count;
    return out;
  }
  // the watchers of `hostId` (everyone in their home)
  const watcherIds = (hostId) => q('SELECT watcher_id FROM watchers WHERE target_id = ?').all(hostId).map((r) => r.watcher_id);
  const watching = (userId) => { const r = q('SELECT target_id FROM watchers WHERE watcher_id = ?').get(userId); return r ? r.target_id : 0; };

  /* ----- devices and bans ----- */
  // The game sends X-Device: "<device id>~<fingerprint>" (js/net/device.js): a
  // random id kept in every storage the page has, and a hash of what the phone
  // and its browser are like. An account is on a device when it was made or
  // used with that id, or with that fingerprint from the same address.
  function deviceOf(req) {
    const m = /^([0-9a-f]{32})(?:~([0-9a-f]{16,64}))?$/.exec(String(req.header('x-device') || ''));
    return { id: m ? m[1] : '', fp: m && m[2] ? m[2] : '' };
  }
  function deviceKeys(dev, ip) {
    const keys = [];
    if (dev.id) keys.push('id:' + dev.id);
    if (dev.fp && ip) keys.push('fp:' + dev.fp + '@' + ip);
    return keys;
  }
  // the account was used on this device (written at most once an hour)
  function seenOn(userId, req) {
    const now = Date.now();
    for (const k of deviceKeys(deviceOf(req), req.ip)) {
      q(`INSERT INTO devices (user_id, device, first_at, last_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, device) DO UPDATE SET last_at = excluded.last_at WHERE devices.last_at < excluded.last_at - 3600000`).run(userId, k, now, now);
    }
  }
  // the accounts made on this device (the fingerprint only counts from the same address, for 30 days)
  function madeOn(dev, ip) {
    const ids = new Set();
    if (dev.id) for (const r of q('SELECT id FROM users WHERE created_device = ?').all(dev.id)) ids.add(r.id);
    if (dev.fp && ip) {
      for (const r of q('SELECT id FROM users WHERE created_fp = ? AND created_ip = ? AND created_at > ?').all(dev.fp, ip, Date.now() - 30 * 86400000)) ids.add(r.id);
    }
    return ids;
  }
  // may this device make an account? '' yes, 'full' (log in to one of its own), 'banned'
  const DEVICE_BANNED_NEW = 'この端末のアカウントが利用停止（アクセス禁止・BAN）中のため、新しいアカウントは作れません';
  const deviceFull = () => `この端末で作れるアカウントは${config.accountsPerDevice}つまでです。前のアカウントの引き継ぎコードでログインしてください`;
  function deviceRoom(req) {
    const dev = deviceOf(req);
    if (!dev.id) return '';
    // (no new account to play on while one of the device's is banned)
    if (devicesBanned(deviceKeys(dev, req.ip), true)) return 'banned';
    if (config.accountsPerDevice > 0 && madeOn(dev, req.ip).size >= config.accountsPerDevice) return 'full';
    return '';
  }
  // Bans: アクセス禁止 (a week), BAN (30 days), 永久BAN (until an operator lifts it).
  // A ban that has run out is lifted when it is next looked at (or by the
  // housekeeping). The banned player's game goes back to the title screen and
  // stays there until the ban ends (its login is kept for GET /api/ban); the
  // official bot tells them when they were banned, and again when it ends.
  const BAN_DAYS = { suspend: 7, ban: 30, perma: 0 };
  const BAN_NAME = { suspend: 'アクセス禁止', ban: 'BAN', perma: '永久BAN' };
  // the developer (config.developer, one of config.operators): never shut out
  // by any ban, and never loses the operator rights (server/core/ops.js)
  const devKey = config.operators.some((n) => nameKey(n) === nameKey(config.developer || '')) ? nameKey(config.developer) : '';
  const isDeveloper = (u) => !!u && !!devKey && !u.npc && u.name_key === devKey;
  const DEVICE_BANNED = 'この端末のほかのアカウントがBANされているため、このアカウントも利用できません';
  const when = (ms) => jst(ms).slice(0, 16);   // 2026/10/20 12:34 (Japan time)
  // a letter from the official bot: 【件名】, 〇〇様, the matter, Ice Smoker公式より
  const letter = (u, subject, text) => `【${subject}】\n\n${u.name}様\n\n${text}\n\nIce Smoker公式より`;
  function banNotice(u) {
    return `あなたは${when(u.ban_at || Date.now())}に公式より${BAN_NAME[u.ban_kind] || '利用停止'}されました。`;
  }
  function tellBanned(u) {
    const name = BAN_NAME[u.ban_kind] || '利用停止';
    official.say(u.id, letter(u, `${name}のお知らせ`, `${banNotice(u)}\n期間：${u.ban_until ? when(u.ban_until) + ' まで' : '解除されるまで'}\nその間は遊べません。`));
  }
  // The ban ends: lifted by the operators ('lifted') or its time is up
  // ('expired'). False when there was none to end.
  function liftBan(u, how) {
    const now = Date.now();
    const r = how === 'expired'
      ? q("UPDATE users SET banned = 0, ban_kind = '', ban_until = 0 WHERE id = ? AND banned = 1 AND ban_until > 0 AND ban_until <= ?").run(u.id, now)
      : q("UPDATE users SET banned = 0, ban_kind = '', ban_until = 0 WHERE id = ? AND banned = 1 AND ban_kind != 'deleted'").run(u.id);
    if (!Number(r.changes)) return false;
    // (a 永久BAN lifted: back from the プレイヤーアーカイブ)
    q("UPDATE users SET archived_at = 0, archive_reason = '', purge_at = 0, archive_with = 0 WHERE id = ? AND archive_reason = 'perma'").run(u.id);
    const name = BAN_NAME[u.ban_kind] || '利用停止';
    official.say(u.id, letter(u, `${name}解除のお知らせ`,
      `あなたの${name}は${when(now)}に${how === 'expired' ? '期間が終わり、' : '公式により'}解除されました。\nルールを守って、また TWO STATE をお楽しみください。`));
    return true;
  }
  function liftExpired(u) {
    if (!u || !u.banned || !u.ban_until || u.ban_until > Date.now()) return u;
    liftBan(u, 'expired');
    return getUser(u.id);
  }
  // what a banned player's title screen shows (null: free to play)
  function banState(u) {
    if (isDeveloper(u)) return null;
    if (u.banned) return { code: 'banned', kind: u.ban_kind || 'perma', at: u.ban_at || 0, until: u.ban_until || 0, message: banMessage(u), notice: banNotice(u) };
    if (deviceBanOf(u)) return { code: 'device_banned', message: DEVICE_BANNED };
    return null;
  }
  function banMessage(u) {
    if (u.ban_kind === 'deleted') return DELETED;
    const name = BAN_NAME[u.ban_kind] || '利用停止';
    if (!u.ban_until) return `このアカウントは${name}されています`;
    const d = new Date(u.ban_until + 9 * 3600000);
    return `このアカウントは${name}中です（${d.getUTCMonth() + 1}/${d.getUTCDate()} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')} まで）`;
  }
  const BANNED_NOW = "o.banned = 1 AND o.ban_kind IN ('ban', 'perma') AND (o.ban_until = 0 OR o.ban_until > ?)";
  // another account on one of this account's devices is under a BAN or a
  // 永久BAN placed after an operator last let this account play
  function deviceBanOf(u) {
    if (isDeveloper(u)) return null;
    return q(`SELECT o.id FROM devices d JOIN devices e ON e.device = d.device AND e.user_id != d.user_id
              JOIN users o ON o.id = e.user_id
              WHERE d.user_id = ? AND ${BANNED_NOW} AND o.ban_at > ? LIMIT 1`).get(u.id, Date.now(), u.device_ok_at) || null;
  }
  // the same for every account at once (the operator site's list): by account,
  // the newest such BAN on one of its devices (blocked when after device_ok_at)
  function deviceBans() {
    const m = new Map();
    for (const r of q(`SELECT d.user_id AS id, MAX(o.ban_at) AS at FROM devices d JOIN devices e ON e.device = d.device AND e.user_id != d.user_id
                       JOIN users o ON o.id = e.user_id WHERE ${BANNED_NOW} GROUP BY d.user_id`).all(Date.now())) m.set(r.id, r.at);
    return m;
  }
  // an account on these devices is under a BAN or a 永久BAN (or, `any`, an アクセス禁止 too)
  function devicesBanned(keys, any = false) {
    if (!keys.length) return false;
    const banned = any ? 'o.banned = 1 AND (o.ban_until = 0 OR o.ban_until > ?)' : BANNED_NOW;
    return !!q(`SELECT 1 AS x FROM devices d JOIN users o ON o.id = d.user_id
                WHERE d.device IN (${keys.map(() => '?').join(', ')}) AND ${banned} LIMIT 1`).get(...keys, Date.now());
  }
  // May this account play now? Throws why not.
  function allowed(u) {
    if (isDeveloper(u)) return u;
    u = liftExpired(u);
    if (u.banned) throw new ApiError(403, 'banned', banMessage(u), { kind: u.ban_kind, until: u.ban_until, ban: banState(u) });
    if (deviceBanOf(u)) throw new ApiError(403, 'device_banned', DEVICE_BANNED, { ban: banState(u) });
    return u;
  }
  // 引き継ぎコード: kept as a hash to log in with, and sealed for the operator site
  const CODE_KEY = keyFrom(secret, 'recovery-codes');
  function setRecovery(userId) {
    const code = newRecoveryCode();
    q('UPDATE users SET recovery_hash = ?, recovery_enc = ? WHERE id = ?').run(sha256(normalizeRecoveryCode(code)), sealText(CODE_KEY, code), userId);
    return code;
  }

  const peter = createPeter({
    q, tx, getUser, insertMessage, msgDto, touchConversations, unreadTotal, live, balanceChanged, dmChannel,
    onBorrow: (userId) => track(userId, [['borrow', 1]])
  });
  peter.id();
  // ジョンソン, a friend: money for the 金の生る木 every 2 days, one rescue
  const johnson = createJohnson({ q, tx, getUser, insertMessage, msgDto, touchConversations, unreadTotal, live, balanceChanged, dmChannel });
  johnson.id();
  // the operators' account in everyone's messages, and the operators' log
  const official = createOfficial({ q, tx, getUser, insertMessage, msgDto, touchConversations, unreadTotal, live, balanceChanged, dmChannel,
    onDelivered: (userId, dto) => phone(userId, dmNote(dto)) });
  official.id();
  // notices for the developer in a Discord channel (server/core/discord.js), from the log's entries
  const discord = createDiscord({ url: config.discordWebhook, defer, jst, publicUrl: config.publicUrl });
  // the address players use, for the link in the notices: only where the host
  // vouches for it (Cloudflare routes by it; elsewhere PUBLIC_URL)
  const noteHost = (req) => { if (host && host.name === 'cloudflare') discord.host(req.header('host')); };
  // (the host keeps the newest entry's hash where SQL cannot reach: server/core/opslog.js)
  const opsLog = createOpsLog({ q, anchor: host && host.anchor ? host.anchor : null, onAdd: (row) => discord.log(row) });
  // a new DEV going live is the first entry of its own
  {
    const seen = q("SELECT value FROM meta WHERE key = 'ops_log_release'").get();
    if (!seen || Number(seen.value) !== RELEASE) {
      opsLog.add({ action: 'release', summary: `DEV${RELEASE} を本番に反映（サーバーが起動）`, detail: { release: RELEASE, previous: seen ? Number(seen.value) : null, host: config.host || '' } });
      q("INSERT INTO meta (key, value) VALUES ('ops_log_release', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(RELEASE));
    }
  }
  // every new version of the server going live (the host says which), once
  // each, to Discord: the first request after a deploy wakes the server
  if (host && host.version && host.version.id) {
    const was = q("SELECT value FROM meta WHERE key = 'live_version'").get();
    if (!was || was.value !== host.version.id) {
      q("INSERT INTO meta (key, value) VALUES ('live_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(host.version.id);
      if (was) discord.say('🚀', `本番に新しい版を反映しました（DEV${RELEASE}・バージョン ${host.version.id.slice(0, 8)}）`);
    }
  }

  // When each DEV went live here ({ 6: ms, … }): the operators' log has an
  // entry for every release the server started with (Dev News shows the time).
  function releasedAt() {
    const out = {};
    for (const r of q("SELECT at, detail FROM ops_log WHERE action = 'release' ORDER BY id").all()) {
      let d = {};
      try { d = JSON.parse(r.detail); } catch { d = {}; }
      const n = Number(d.release);
      if (n > 0 && !out[n]) out[n] = r.at;
    }
    return out;
  }

  /* ----- phone notifications (server/core/push.js) ----- */
  const push = createPush({
    q,
    meta: {
      get: (k) => { const r = q('SELECT value FROM meta WHERE key = ?').get(k); return r ? r.value : null; },
      set: (k, v) => q('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(k, v)
    },
    contact: config.pushContact || '',
    defer: defer || undefined
  });
  // Whether a player's game is in sight: the beats (sent only by a page in
  // sight) say so, and the page tells when it goes out of sight. Memory only:
  // after a restart everyone counts as away until their next beat.
  const sight = new Map();
  const SIGHT_MS = 90000;
  const inSight = (id) => live.isOnline(id) && Date.now() - (sight.get(id) || 0) < SIGHT_MS;
  function seeing(u, body) {
    if (body && body.on) sight.set(u.id, Date.now()); else sight.delete(u.id);
    return { ok: true };
  }
  // a message, a call or an invitation for a player whose game is out of
  // sight goes to their phone; `gap`: the same one at most that often
  const pushedAt = new Map();
  function phone(userId, n, gap = 0) {
    if (!n || inSight(userId)) return;
    // outbound calls (the push services) are cut during a lockdown
    if (emergency.locked && emergency.locked()) return;
    if (gap) {
      const k = `${userId}:${n.tag}`;
      if (Date.now() - (pushedAt.get(k) || 0) < gap) return;
      pushedAt.set(k, Date.now());
    }
    push.notify(userId, n).catch(() => {});
  }
  // the text of a message, a 報告, an 意見案 or a 通報 (RULES.sendMax.chars at most)
  function sendText(raw) {
    if (Array.from(String(raw ?? '')).length > RULES.sendMax.chars) throw new ApiError(413, 'too_large', TOO_BIG);
    return cleanText(raw, RULES.sendMax.chars);
  }
  const clip = (t, n) => { const a = Array.from(String(t || '')); return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
  // what a direct message says on the phone
  function dmNote(dto) {
    if (!dto || !dto.from || dto.kind === 'system' || dto.kind === 'offer') return null;
    const cur = dto.currency === 'tokens' ? 'トークン' : 'ドル';
    const present = dto.kind === 'present' ? RULES.presents.find((p) => p.id === dto.text) : null;
    const tap = dto.pending ? '。タップして受け取ろう' : '';
    const body = dto.kind === 'transfer' ? `${Number(dto.amount).toLocaleString('en-US')} ${cur}が届きました${tap}`
      : dto.kind === 'present' ? `${present ? present.name : 'プレゼント'}のプレゼントが届きました。タップして受け取ろう`
        : dto.kind === 'gift' ? `車のプレゼントが届きました${tap}`
          : dto.kind === 'item' ? `アイテムが届きました${tap}`
            : dto.kind === 'car_offer' ? `車の販売：$${Number(dto.amount).toLocaleString('en-US')}`
              : dto.kind === 'car_sold' ? `車が売れました（$${Number(dto.amount).toLocaleString('en-US')}）。タップして受け取ろう`
                : clip(dto.text, 140);
    return { kind: 'msg', title: dto.from.name || 'メッセージ', body, tag: `dm:${dto.from.id}`, open: `dm:${dto.from.id}` };
  }

  // What the chat filter found in a player's words (server/core/filter.js): the
  // operators see the original, the other player only the *** version.
  function detected(u, f, { to = 0, group = 0, place, original, messageId = 0 }) {
    if (!f.words.length) return;
    q(`INSERT INTO detections (sender_id, recipient_id, group_id, place, original, masked, words, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(u.id, to, group, place, original, f.masked, JSON.stringify(f.words), messageId, Date.now());
  }

  /* ----- quests (js/game/quests.js), XP, バイト ----- */

  // Quest progress inside the caller's transaction (`cur`: the player's row as
  // it is now); the caller saves `json`. Finished quests wait to be received.
  function questStep(cur, events, boost = null, xpGain = 0) {
    const state = readQuests(cur.quests);
    const r = config.quests ? stepQuests(state, events, Date.now(), boost, questRewardRoll) : { changed: false, done: [] };
    const ticketGain = grantLevelTickets(state, cur.xp, cur.xp + xpGain, questTicketRoll);
    return { ...r, changed: r.changed || ticketGain['5h'] > 0 || ticketGain.day > 0, json: JSON.stringify(state), ready: questsReady(state),
      tickets: questTickets(state), bonuses: questBonuses(state), ticketGain };
  }
  // Tells the player what was finished (and how many wait to be received);
  // with VIP on, each one is VIP EXP.
  function questNotice(userId, r) {
    if (!r || (!r.done.length && !r.ticketGain['5h'] && !r.ticketGain.day)) return;
    live.send(userId, 'quest', { done: r.done.map((x) => x.id), ready: r.ready, tickets: r.tickets, bonuses: r.bonuses, xp: getUser(userId).xp });
    if (r.done.length && vipOn(getUser(userId))) tx(() => addVipExp(getUser(userId), r.done.length * VIP_RULES.exp.quest));
  }
  // Progress from one of the player's actions, saved in a transaction of its own.
  function track(userId, events, reconcile = true) {
    const boost = questBoost(userId);
    const r = tx(() => {
      const cur = getUser(userId);
      if (!cur || cur.npc) return null;
      const st = questStep(cur, events, boost);
      if (!st.changed) return null;
      q('UPDATE users SET quests = ? WHERE id = ?').run(st.json, cur.id);
      return st;
    });
    questNotice(userId, r);
    if (reconcile && r?.done.length) syncMilestones(userId);
    return r;
  }
  // Absolute milestones also recognise existing players. Lifetime casino
  // income is reconciled only into 特別, never into today's fresh counters.
  function syncMilestones(userId) {
    if (!config.quests) return;
    for (let pass = 0; pass < 16; pass++) {
      const cur = getUser(userId);
      if (!cur || cur.npc) return;
      const state = readQuests(cur.quests);
      const earned = state.special?.m?.earn || 0;
      const r = track(userId, [['level', LEVEL.of(cur.xp)], ['vipLevel', VIP.level(cur.vip_exp)],
        ['vipUse', cur.vip_until > 0 || cur.vip_trial_until > 0 ? 1 : 0],
        ['earn', Math.max(0, cur.total_won * RULES.tokenPrice - earned), 'special']], false);
      // A completion can award VIP EXP and cross another milestone.
      if (!r || !r.done.length) break;
    }
  }
  // After the player spent money (or came back): 「無一文になってしまう」, ジョンソン's
  // gift or rescue (first: a friend helps before the lender offers a loan) and
  // マイクソン's offers.
  function afterSpend(userId) {
    const u = getUser(userId);
    if (u && !u.npc && u.dollars + u.tokens * RULES.tokenPrice < QUESTS.brokeBelow) track(userId, [['broke', 1]]);
    if (config.npcGifts !== false) johnson.check(userId);
    peter.check(userId);
  }

  // The バイト being worked: [{ id, since, boost }] (since = paid up to then;
  // boost: ms worked with a hub's benefits on, not paid yet).
  function readJobs(json) {
    try {
      const a = JSON.parse(json || '[]');
      return Array.isArray(a) ? a.filter((j) => j && JOBS.has(j.id) && Number.isFinite(j.since)) : [];
    } catch {
      return [];
    }
  }
  // Wages up to `now` for every job (the fraction of a $ carries over): from
  // VIP1, the time VIP is on at VIP.wage times (jobs are paid up whenever VIP
  // starts, so it is on from `since` until it ends); for the time worked with
  // a hub's benefits on (RULES.hub.wage: x1.5) the extra half of the wage.
  function settleJobs(cur, now) {
    const jobs = readJobs(cur.jobs);
    // (during the free trial, the trial's level's wage)
    const mult = VIP.wage(VIP.level(cur.vip_exp)), trialMult = VIP.wage(VIP_RULES.trial.level);
    const rate = VIP.wage(vipLevel(cur, now));
    let pay = 0;
    for (const j of jobs) {
      const wage = JOBS.get(j.id).wage;
      const value = VIP.earned(wage, j.since, now, cur.vip_until, mult, cur.vip_trial_until, trialMult, cur.vip_permanent_at);
      const p = Math.floor(value);
      const extra = wage * (RULES.hub.wage - 1);
      const b = j.boost > 0 && extra > 0 ? Math.floor(j.boost * extra / 3600000) : 0;
      // Cap each job's combined base/VIP/hub wages, including offline time.
      // A collection starts fresh: excess time cannot be collected again.
      if (p + b >= RULES.jobMaxPay) {
        pay += RULES.jobMaxPay;
        j.since = now;
        j.boost = 0;
        continue;
      }
      if (p > 0) {
        pay += p;
        j.since = now - Math.floor((value - p) * 3600000 / (wage * rate));
      }
      if (b > 0) {
        pay += b;
        j.boost = Math.max(0, j.boost - Math.floor(b * 3600000 / extra));
      }
    }
    return { jobs, pay };
  }
  // jobs at once: one more every RULES.jobSlotEvery levels (LEVEL.jobSlots)
  function jobsDto(u) {
    const level = LEVEL.of(u.xp);
    const now = Date.now();
    return { level, slots: LEVEL.jobSlots(level), every: RULES.jobSlotEvery,
      working: readJobs(u.jobs).map(j => ({ ...j, paused: jobPending(u, j, now) >= RULES.jobMaxPay })), now };
  }
  function jobPending(cur, j, now = Date.now()) {
    const wage = JOBS.get(j.id).wage;
    return Math.floor(VIP.earned(wage, j.since, now, cur.vip_until, VIP.wage(VIP.level(cur.vip_exp)),
      cur.vip_trial_until, VIP.wage(VIP_RULES.trial.level), cur.vip_permanent_at))
      + Math.floor((j.boost || 0) * wage * (RULES.hub.wage - 1) / 3600000);
  }
  // A hub's benefits were on for `ms` of play: the best paid job being worked
  // earns x RULES.hub.wage for that time (inside the caller's transaction).
  function boostJobs(cur, ms) {
    const jobs = readJobs(cur.jobs);
    if (!jobs.length || ms <= 0) return null;
    const available = jobs.filter(j => jobPending(cur, j) < RULES.jobMaxPay);
    if (!available.length) return null;
    let best = available[0];
    for (const j of available) if (JOBS.get(j.id).wage > JOBS.get(best.id).wage) best = j;
    best.boost = (best.boost || 0) + ms;
    return JSON.stringify(jobs);
  }
  function saveJobs(userId, jobs, pay) {
    q('UPDATE users SET jobs = ?, dollars = dollars + ?, rev = rev + ? WHERE id = ?').run(JSON.stringify(jobs), pay, pay > 0 ? 1 : 0, userId);
  }
  function jobsPaid(userId, pay) {
    if (!pay) return;
    balanceChanged(userId, true);
    track(userId, [['jobpay', pay]]);
  }

  function balance(u) { return { tokens: u.tokens, dollars: u.dollars, coins: u.coins, rev: u.rev }; }
  // `vip`: the VIP level of someone whose VIP is on (the badge others see)
  function mini(u) {
    const v = vipLevel(u);
    return v === null ? { id: u.id, name: u.name, avatar: u.avatar } : { id: u.id, name: u.name, avatar: u.avatar, vip: v, vipBadge: vipBadgeLevel(u) };
  }

  /* ----- VIP (js/game/vip.js) ----- */
  const VIP_RULES = RULES.vip;
  const vipOn = (u, now = Date.now()) => !!u && !u.npc && VIP.current(u.vip_until, u.vip_exp, u.vip_trial_until || 0, now) !== null;
  // Effective benefits: a paid/trial level, or permanent VIP2 after VIP4.
  const vipLevel = (u, now = Date.now()) => (vipOn(u, now) ? VIP.current(u.vip_until, u.vip_exp, u.vip_trial_until || 0, now) : null);
  const vipBadgeLevel = (u, now = Date.now()) => u && !u.npc ? VIP.badge({ until: u.vip_until, exp: u.vip_exp, trialUntil: u.vip_trial_until || 0 }, now) : null;
  // the free trial: for one who never had VIP, once
  const canTrial = (u) => !!u && !u.npc && !(u.vip_until > 0) && !(u.vip_trial_until > 0);
  // (`level`: the EXP's; `trialUntil`: when the free trial ends or ended, 0 never had it; `trial`: it may be had)
  function vipDto(u, now = Date.now()) {
    const i = VIP.info(u.vip_exp);
    return {
      on: vipOn(u, now), paid: u.vip_until > now, permanent: VIP.permanent(u.vip_exp), permanentAt: u.vip_permanent_at,
      until: u.vip_until, exp: Math.round(i.exp * 1000) / 1000, level: i.level, from: i.from, next: i.next,
      trialUntil: u.vip_trial_until || 0, trial: canTrial(u), mode: u.vip_until > now ? VIP.modeAt(u.vip_modes, now) : 'normal',
      modes: VIP.intervals(u.vip_modes).filter(p => p.end > now),
      earlyAccess: VIP.earlyAccess(vipLevel(u, now)),
      exclusive31: { unlocked: vipLevel(u, now) >= 4, configured: RULES.cars.some(car => car.vip === 4) },
      specialLogin: { eligible: vipLevel(u, now) >= VIP_RULES.specialLogin.from, days: VIP_RULES.specialLogin.days, configured: VIP_RULES.specialLogin.rewards.length > 0 }
    };
  }
  // VIP EXP, inside the caller's transaction (`cur`: the row as it is now).
  // Reaching VIP${VIP_RULES.refund.from} while days are paid ahead gives back their coins at once.
  function addVipExp(cur, gain, now = Date.now()) {
    if (!cur || cur.npc || !(gain > 0)) return;
    const multiplier = cur.vip_until > now ? VIP.multiplier(cur.vip_modes, now) : 1;
    const exp = Math.round((cur.vip_exp + gain * multiplier) * 1000) / 1000;
    const from = VIP_RULES.refund.from;
    // (the days bought, not the free trial's)
    const back = VIP.level(cur.vip_exp) < from && VIP.level(exp) >= from && cur.vip_until > now
      ? VIP_RULES.refund.coins * Math.max(0, Math.floor((cur.vip_until - Math.max(now, cur.vip_trial_until || 0)) / VIP.day)) : 0;
    const permanentAt = cur.vip_permanent_at || (VIP.permanent(exp) ? now : 0);
    q('UPDATE users SET vip_exp = ?, vip_permanent_at = ?, coins = coins + ?, rev = rev + ? WHERE id = ?').run(exp, permanentAt, back, back ? 1 : 0, cur.id);
    cur.vip_exp = exp;
    cur.vip_permanent_at = permanentAt;
  }

  function meDto(u) {
    const today = utcDay();
    const quests = readQuests(u.quests);
    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      avatars: AVATARS.size ? [...AVATARS.values()].filter((a) => a.price === 0 || ownedAvatars(u).includes(a.id)).map((a) => a.id) : [],
      ...balance(u),
      totalWon: u.total_won,
      totalBet: u.total_bet,
      biggestWin: u.biggest_win,
      spins: u.spins,
      dayWon: u.won_day === today ? u.day_won : 0,
      boughtToday: u.bought_day === today ? u.bought_today : 0,
      dailyReady: u.free_day !== today,
      hasPassword: !!u.password_hash,
      cars: carCount(u.id),
      garage: garageSize(u),
      items: itemsOf(u.id),
      charm: u.charm > 0,
      debt: peter.owed(u.id),
      xp: u.xp,
      jobs: jobsDto(u).working,
      questsReady: questsReady(quests),
      questTickets: questTickets(quests),
      questBonuses: questBonuses(quests),
      // the newest release: a browser running an older game asks the player to update
      release: RELEASE,
      // the beginner guide: everyone under 30 minutes of play until they finish it
      guide: !u.guide_done && u.play_ms < GUIDE_MS,
      feedback: feedbackState(u),
      // the group whose 協力スロット table the player sits at (0: none)
      coop: u.coop_group || 0,
      // may open the operator site (/ops/); or only look at it (閲覧者)
      operator: isOperatorName(u),
      viewer: ops.isViewer(u),
      // 18歳以上？ (null: not answered yet)
      age: u.age_ok === null || u.age_ok === undefined ? null : !!u.age_ok,
      vip: vipDto(u),
      // the chat stopped by the automatic filter (null: not): since when, and why
      chatBan: u.chat_ban ? { at: u.chat_ban, why: u.chat_ban_why } : null,
      createdAt: u.created_at
    };
  }

  // Being logged in for any moment of a day (6:00 to 6:00 Japan time) counts
  // as a login day; the first one of each day pays that day's bonus in spin
  // tokens (1st..4th day, then over again). Returns what was paid, once a day.
  function loginBonus(userId) {
    countDay(userId);
    if (!config.loginBonus) return null;
    const day = loginDay();
    const days = RULES.loginBonus.days;
    const paid = tx(() => {
      const cur = getUser(userId);
      if (!cur || cur.npc || cur.login_day === day) return null;
      const n = cur.login_days + 1;
      const step = (n - 1) % days.length;
      q('UPDATE users SET login_day = ?, login_days = ?, tokens = tokens + ?, rev = rev + 1 WHERE id = ?').run(day, n, days[step], cur.id);
      return { day: step + 1, amount: days[step], days, loginDays: n, next: nextLoginReset() };
    });
    if (paid) balanceChanged(userId);
    return paid;
  }

  // アクセス日数 (login days, all told): at 5, 10 … 35 Ice Smoker公式
  // sends $250,000 by itself, with its congratulations (one reached before is
  // paid at the next visit; a 永久BAN account gets none).
  function accessDayGifts(userId) {
    const A = RULES.accessDays;
    const cur = getUser(userId);
    if (!cur || cur.npc || (cur.banned && cur.ban_kind === 'perma')) return;
    for (const d of A.at) {
      if (d > cur.login_days || d <= cur.days_paid) continue;
      // (claimed first: two connections at once pay once)
      if (!Number(q('UPDATE users SET days_paid = ? WHERE id = ? AND days_paid < ?').run(d, userId, d).changes)) continue;
      official.say(userId, `【自動送信】\nおめでとうございます！アクセス日数${d}日を達成しました！！記念して250Kを送金します！今後ともTwo stateをよろしくお願いいたします！`);
      official.pay(userId, A.amount);
    }
  }

  // something done once on this server, ever (claimed first: two at once do it once)
  const onceOnly = (key) => Number(q('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(key, String(Date.now())).changes) > 0;
  const everyone = () => q("SELECT id, name FROM users WHERE npc = '' AND archived_at = 0 ORDER BY id").all();

  // 登録者数の記念 (RULES.milestones): when the accounts registered reach 10,
  // 20 and 50, everyone then gets $100K, $200K and $500K from Ice Smoker公式,
  // once each (one already reached when this came out: at once).
  function milestones() {
    if (config.milestones === false) return;
    const n = q("SELECT COUNT(*) AS n FROM users WHERE npc = ''").get().n;
    for (const m of RULES.milestones) {
      if (n < m.players || !onceOnly(`milestone_${m.players}`)) continue;
      const all = everyone();
      for (const p of all) {
        official.say(p.id, `【自動送信】\nおめでとうございます！Two stateの登録者数が${m.players}人を突破しました！！記念して全員に${m.dollars / 1000}Kを送金します！今後ともTwo stateをよろしくお願いいたします！`);
        official.pay(p.id, m.dollars);
      }
      opsLog.add({
        actorName: 'システム', action: 'milestone',
        summary: `登録者数${m.players}人突破の記念に全員（${all.length}人）へ $${m.dollars.toLocaleString('en-US')}`,
        detail: { players: m.players, registered: n, dollars: m.dollars, to: all.length }
      });
    }
  }
  // 今だけ: everyone's calls above VIP3 (BR.CONFIG.vip.voiceAll): every player
  // then is told once, by Ice Smoker公式
  function voiceNotice() {
    const tier = RULES.vip.voiceAll || 0;
    if (!tier || !onceOnly(`voice_all_${tier}`)) return;
    const kbps = RULES.vip.voice[Math.min(tier, RULES.vip.voice.length - 1)];
    const all = everyone();
    for (const p of all) {
      official.say(p.id, letter(p, '通話品質アップのお知らせ',
        `サーバーの有料枠に大きな余裕があるため、今だけ、全プレイヤーのボイス通話を VIP3 より高い音質（${kbps}kbps）にしました。\nVIPでなくても、フレンド・グループ・友達と稼ぐ・ホームのすべての通話が自動で高音質になります（最新版に更新すると有効になります）。\nあわせて、通話中の音量ボタンから「ボイス」と「効果音」の音量を別々に調整できるようになりました。`));
    }
    opsLog.add({ actorName: 'システム', action: 'voice_notice', summary: `全員（${all.length}人）に通話品質アップ（${kbps}kbps）のお知らせ`, detail: { tier, kbps, to: all.length } });
  }

  // Login days in a row (6:00 to 6:00 Japan time) and the longest run (the operator site).
  function countDay(userId) {
    const day = loginDay();
    const cur = getUser(userId);
    if (!cur || cur.npc || cur.streak_day === day) return;
    const run = cur.streak_day === loginDay(Date.now() - 86400000) ? cur.day_streak + 1 : 1;
    q('UPDATE users SET streak_day = ?, day_streak = ?, day_best = MAX(day_best, ?) WHERE id = ?').run(day, run, run, cur.id);
  }

  // The Shop's prices now: on sale 5 hours a day (js/game/sale.js).
  function itemShop() {
    const now = Date.now();
    return {
      now,
      items: [...SHOP.values()].map((i) => {
        const s = shopSale(i, now);
        return { id: i.id, price: i.price, salePrice: s.price, pct: s.pct, max: i.max, on: s.on, start: s.start, end: s.end, next: s.next };
      })
    };
  }

  // Fixed prices; the server validates the amount shown before charging it.
  function iconShop() {
    return {
      items: [...AVATARS.values()].filter((a) => a.price > 0)
        .map((a) => ({ id: a.id, price: a.price, rarity: a.rarity }))
    };
  }

  function friendship(me, otherId) {
    if (me === otherId) return 'self';
    if (areFriends(me, otherId)) return 'friends';
    if (hasRequest(me, otherId)) return 'outgoing';
    if (hasRequest(otherId, me)) return 'incoming';
    return 'none';
  }

  function publicDto(u, viewerId) {
    const today = utcDay();
    return {
      id: u.id,
      name: u.name,
      avatar: u.avatar,
      npc: u.npc || null,
      totalWon: u.total_won,
      biggestWin: u.biggest_win,
      spins: u.spins,
      dayWon: u.won_day === today ? u.day_won : 0,
      createdAt: u.created_at,
      online: isOnline(u),
      lastSeen: u.npc ? null : u.last_seen,
      cars: carCount(u.id),
      level: LEVEL.of(u.xp),
      vip: vipLevel(u), vipBadge: vipBadgeLevel(u),
      friendship: friendship(viewerId, u.id)
    };
  }

  // Peter is always there
  function isOnline(u) { return u.npc ? true : live.isOnline(u.id); }

  function msgDto(m) {
    const gone = !!m.retracted_at;
    return {
      id: m.id,
      channel: m.channel,
      kind: m.kind,
      from: m.sender_id ? { id: m.sender_id, name: m.sender_name ?? null, avatar: m.sender_avatar ?? null } : null,
      to: m.recipient_id ?? null,
      // taken back by its sender: nothing of it is left for the players (the operators still see it)
      text: gone ? '' : m.body,
      amount: m.amount ?? null,
      currency: m.currency ?? null,
      // money, a car or an item that arrives with the recipient's tap
      pending: m.pending ? true : undefined,
      claimed: m.kind === 'present' || m.kind === 'car_sold' || m.pending ? !!m.claimed_at : undefined,
      // back to its sender: the account it was for was deleted (server/core/purge.js)
      returned: m.pending && m.state === 'returned' ? true : undefined,
      expiresAt: RECEIPTS.deadline(m) || undefined,
      expired: RECEIPTS.expired(m) || undefined,
      retracted: gone ? m.retracted_at : undefined,
      state: m.kind === 'car_offer' ? m.state || 'open' : undefined,
      at: m.created_at
    };
  }

  // `held`: the recipient blocked the sender; it reaches them once they unblock.
  // `pending`: money, a car or an item waiting for the recipient's tap (POST /api/messages/claim).
  function insertMessage({ channel, sender, recipient = null, kind, body = '', amount = null, currency = null, held = false, pending = false, at = Date.now() }) {
    const now = at;
    const r = q('INSERT INTO messages (channel, sender_id, recipient_id, kind, body, amount, currency, held, pending, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(channel, sender ? sender.id : 0, recipient, kind, body, amount, currency, held ? 1 : 0, pending ? 1 : 0, now);
    return {
      id: Number(r.lastInsertRowid), channel, sender_id: sender ? sender.id : 0, sender_name: sender ? sender.name : null,
      sender_avatar: sender ? sender.avatar : null, recipient_id: recipient, kind, body, amount, currency, claimed_at: 0, held: held ? 1 : 0,
      pending: pending ? 1 : 0, retracted_at: 0, state: '', created_at: now
    };
  }

  // A message in the conversation of a and b; `unreadFor` gets the unread mark.
  function touchConversations(a, b, msgId, unreadFor = b) {
    const now = Date.now();
    const up = q(`INSERT INTO conversations (user_id, other_id, last_id, unread, updated_at) VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, other_id) DO UPDATE SET last_id = excluded.last_id,
                  unread = conversations.unread + excluded.unread, updated_at = excluded.updated_at`);
    up.run(a, b, msgId, unreadFor === a ? 1 : 0, now);
    up.run(b, a, msgId, unreadFor === b ? 1 : 0, now);
  }
  // only the sender's side (a message kept back by the other's block)
  function touchOwn(a, b, msgId) {
    q(`INSERT INTO conversations (user_id, other_id, last_id, unread, updated_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id, other_id) DO UPDATE SET last_id = excluded.last_id, updated_at = excluded.updated_at`).run(a, b, msgId, Date.now());
  }
  function sendOwn(m, from) {
    const dto = msgDto(m);
    live.send(from, 'msg', dto);
    return dto;
  }
  // Unblocking: what was kept back arrives now, as it would have (money too).
  function releaseHeld(userId, otherId) {
    const channel = dmChannel(userId, otherId);
    const rows = q('SELECT * FROM messages WHERE channel = ? AND held = 1 AND recipient_id = ? ORDER BY id').all(channel, userId);
    if (!rows.length) return 0;
    tx(() => {
      q('UPDATE messages SET held = 0 WHERE channel = ? AND held = 1 AND recipient_id = ?').run(channel, userId);
      for (const m of rows) {
        // (money sent since DEV9 waits for the tap: only what left before that is paid here)
        if (m.kind !== 'transfer' || m.pending || !CURRENCIES.includes(m.currency) || !(m.amount > 0)) continue;
        q(`UPDATE users SET ${m.currency} = ${m.currency} + ?, rev = rev + 1 WHERE id = ?`).run(m.amount, userId);
        q('INSERT INTO transfers (from_id, to_id, currency, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(otherId, userId, m.currency, m.amount, Date.now());
      }
      const last = rows[rows.length - 1].id;
      q(`INSERT INTO conversations (user_id, other_id, last_id, unread, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, other_id) DO UPDATE SET last_id = MAX(conversations.last_id, excluded.last_id),
         unread = conversations.unread + excluded.unread, updated_at = excluded.updated_at`).run(userId, otherId, last, rows.length, Date.now());
    });
    if (rows.some((m) => m.kind === 'transfer' && !m.pending)) balanceChanged(userId);
    return rows.length;
  }

  function unreadTotal(userId) {
    return q('SELECT COALESCE(SUM(unread), 0) AS n FROM conversations WHERE user_id = ?').get(userId).n
      + q('SELECT COALESCE(SUM(unread), 0) AS n FROM chat_members WHERE user_id = ?').get(userId).n;
  }

  /* ----- group chats ----- */
  const groupChannel = (id) => `group:${id}`;
  const memberIds = (groupId) => q('SELECT user_id FROM chat_members WHERE group_id = ? ORDER BY joined_at, user_id').all(groupId).map((r) => r.user_id);
  // the group, if `userId` is in it
  function myGroup(userId, groupId) {
    const g = q('SELECT * FROM chat_groups WHERE id = ?').get(groupId);
    if (!g || !q('SELECT 1 AS x FROM chat_members WHERE group_id = ? AND user_id = ?').get(groupId, userId)) {
      throw new ApiError(404, 'no_group', 'このグループには参加していません');
    }
    return g;
  }
  function groupDto(g, viewerId) {
    const members = q(`SELECT o.id, o.name, o.avatar FROM chat_members m JOIN users o ON o.id = m.user_id
                       WHERE m.group_id = ? ORDER BY m.joined_at, o.id`).all(g.id);
    const mine = q('SELECT unread FROM chat_members WHERE group_id = ? AND user_id = ?').get(g.id, viewerId);
    const last = g.last_id ? q(`SELECT m.kind, m.body, m.sender_id, m.retracted_at, s.name AS sender_name FROM messages m LEFT JOIN users s ON s.id = m.sender_id
                                WHERE m.id = ?`).get(g.last_id) : null;
    return {
      id: g.id,
      name: g.name,
      members: members.map((r) => ({ ...r, online: live.isOnline(r.id) })),
      unread: mine ? mine.unread : 0,
      coop: { gauge: g.coop, goal: CO.goal },
      at: g.updated_at,
      last: last ? { kind: last.kind, text: last.retracted_at ? '' : last.body, retracted: !!last.retracted_at, mine: last.sender_id === viewerId, from: last.sender_name || null } : null
    };
  }
  // A message in a group: everyone else has one more unread, everyone hears it.
  function postToGroup(g, sender, kind, body) {
    const row = tx(() => {
      const m = insertMessage({ channel: groupChannel(g.id), sender, kind, body });
      q('UPDATE chat_groups SET last_id = ?, updated_at = ? WHERE id = ?').run(m.id, m.created_at, g.id);
      q('UPDATE chat_members SET unread = unread + 1 WHERE group_id = ? AND user_id != ?').run(g.id, sender ? sender.id : 0);
      if (sender) q('UPDATE chat_members SET read_id = ? WHERE group_id = ? AND user_id = ?').run(m.id, g.id, sender.id);
      return m;
    });
    const dto = { ...msgDto(row), group: g.id };
    for (const id of memberIds(g.id)) live.send(id, 'msg', sender && id === sender.id ? dto : { ...dto, unread: unreadTotal(id) });
    if (sender && kind === 'text') {
      for (const id of memberIds(g.id)) {
        if (id !== sender.id) phone(id, { kind: 'msg', title: g.name, body: `${sender.name}: ${clip(body, 120)}`, tag: `group:${g.id}`, open: `group:${g.id}` });
      }
    }
    return dto;
  }
  function pendingRequests(userId) {
    return q('SELECT COUNT(*) AS n FROM friend_requests WHERE to_id = ?').get(userId).n;
  }

  // Delivers a direct-message row to both players (with the receiver's unread count).
  function deliverDm(m, from, to) {
    const dto = msgDto(m);
    live.send(to, 'msg', { ...dto, unread: unreadTotal(to) });
    live.send(from, 'msg', dto);
    phone(to, dmNote(dto));
    return dto;
  }

  // a card in a chat changed (a car sold or taken off sale, money taken): both ends see it
  function cardChanged(m, change) {
    for (const id of [m.sender_id, m.recipient_id]) if (id) live.send(id, 'card', { id: m.id, kind: m.kind, ...change });
  }

  function rate(limiter, key, message) {
    if (!limiter.take(String(key))) throw new ApiError(429, 'rate_limited', message || '操作が速すぎます。少し待ってください');
  }

  // the automatic filter stopped this player's chat until an operator lets it go again
  function chatAllowed(u) {
    if (u.chat_ban) throw new ApiError(403, 'chat_banned', CHAT_BANNED);
  }

  function requireFriend(u, otherId, what) {
    if (!areFriends(u.id, otherId)) throw new ApiError(403, 'not_friends', `フレンドになると${what || '利用'}できます`);
  }

  function liveTarget(id) {
    const t = getUser(id);
    if (!t || t.banned) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
    return t;
  }

  // The other people in `hostId`'s home hear about a watcher coming or going.
  function homeChanged(hostId, who, on) {
    live.send(hostId, 'watch', { type: 'watched', by: who, on });
    for (const id of watcherIds(hostId)) if (id !== who.id) live.send(id, 'watch', { type: 'member', user: hostId, by: who, on });
  }

  // Players watching `targetId`'s screen.
  function notifyWatchers(targetId, payload) {
    for (const w of q('SELECT watcher_id FROM watchers WHERE target_id = ?').all(targetId)) live.send(w.watcher_id, 'watch', payload);
  }

  /* ----- the voice and the chat of a home ----- */
  // Nobody talks at first: the watched player picks the watchers they talk
  // with (watchers.voice). The voice of a home is them and those watchers.
  const voiceIds = (hostId) => q('SELECT watcher_id FROM watchers WHERE target_id = ? AND voice = 1').all(hostId).map((r) => r.watcher_id);
  const inVoice = (id, room) => id === room || !!q('SELECT 1 AS x FROM watchers WHERE watcher_id = ? AND target_id = ? AND voice = 1').get(id, room);
  // a watcher whose connection dropped keeps their voice for a while (memory only)
  const voiceKept = new Map();
  function voiceChanged(hostId, who, on) {
    const data = { type: 'voice', user: hostId, by: mini(who), on, voice: voiceIds(hostId) };
    live.send(hostId, 'watch', data);
    for (const id of watcherIds(hostId)) live.send(id, 'watch', data);
  }
  // the people watching a player, and whether they may talk
  function homeMembers(hostId) {
    return q('SELECT o.id, o.name, o.avatar, o.vip_until, o.vip_exp, o.vip_trial_until, w.voice FROM watchers w JOIN users o ON o.id = w.watcher_id WHERE w.target_id = ?').all(hostId)
      .map((r) => ({ id: r.id, name: r.name, avatar: r.avatar, vip: vipLevel(r), vipBadge: vipBadgeLevel(r), voice: !!r.voice }));
  }
  // The chat of a home (the watched player and their watchers) is live only;
  // its last lines are kept in memory for people who come in.
  const homeChats = new Map();
  let homeChatSeq = 0;
  const homeChatOf = (room) => homeChats.get(room) || [];
  // the chats the game shows only while they happen, written down for good
  // (`original`: what was typed, when the filter masked some of it)
  const keepLive = (place, room, from, to, text, raw, at) =>
    q('INSERT INTO live_chats (place, room, sender_id, recipient_id, body, original, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(place, room, from, to, text, raw === text ? '' : raw, at);

  /* ----- 観戦ベット ----- */
  const WB = RULES.watchBet;
  const openBet = (watcherId) => q("SELECT * FROM watch_bets WHERE watcher_id = ? AND state = 'open'").get(watcherId);
  function betDto(b) {
    return b ? { id: b.id, host: b.host_id, side: b.side, stake: b.stake, left: b.left_n, spins: WB.spins, state: b.state, paid: b.paid } : null;
  }
  // After each spin of `hostId`: the bets on them count down; a BIG WIN (or
  // better) decides them at once, otherwise their last spin does.
  function settleBets(hostId, tier) {
    const bets = q("SELECT * FROM watch_bets WHERE host_id = ? AND state = 'open'").all(hostId);
    if (!bets.length) return;
    const host = getUser(hostId);
    const now = Date.now();
    for (const b of bets) {
      const left = Math.max(0, b.left_n - 1);
      const state = tier >= 2 ? (b.side === 'hit' ? 'won' : 'lost') : left === 0 ? (b.side === 'miss' ? 'won' : 'lost') : 'open';
      const paid = state === 'won' ? Math.floor(b.stake * (b.side === 'hit' ? WB.hit : WB.miss)) : 0;
      tx(() => {
        q('UPDATE watch_bets SET left_n = ?, state = ?, paid = ?, ended_at = ? WHERE id = ?').run(left, state, paid, state === 'open' ? 0 : now, b.id);
        if (paid) q('UPDATE users SET tokens = tokens + ?, rev = rev + 1 WHERE id = ?').run(paid, b.watcher_id);
      });
      const dto = betDto({ ...b, left_n: left, state, paid });
      live.send(b.watcher_id, 'watch', { type: 'bet', user: hostId, host: host ? mini(host) : null, bet: dto });
      if (paid) balanceChanged(b.watcher_id);
      const w = state !== 'open' ? getUser(b.watcher_id) : null;
      if (w) live.send(hostId, 'watch', { type: 'betEnd', by: mini(w), bet: dto });
    }
  }

  /* ----- フレンド対決 ----- */
  const BT = RULES.battle;
  const battleById = (id) => q('SELECT * FROM battles WHERE id = ?').get(id);
  const openBattleOf = (userId) => q("SELECT * FROM battles WHERE (a_id = ? OR b_id = ?) AND state IN ('invite', 'live') ORDER BY id DESC LIMIT 1").get(userId, userId);
  function battleDto(b, viewerId) {
    const mine = viewerId === b.b_id ? 'b' : 'a', theirs = mine === 'a' ? 'b' : 'a';
    const side = (k) => {
      const p = getUser(b[k + '_id']);
      return { id: b[k + '_id'], name: p ? p.name : '?', avatar: p ? p.avatar : null, n: b[k + '_n'], won: b[k + '_won'] };
    };
    return {
      id: b.id, spins: b.spins, bet: b.bet, state: b.state, from: b.a_id, me: side(mine), other: side(theirs),
      winner: b.state === 'done' ? b.winner : null, quit: b.quit || 0,
      until: b.state === 'invite' ? b.created_at + BT.inviteMs : b.state === 'live' ? b.started_at + BT.maxMs : 0
    };
  }
  // The end of a battle: the larger total win wins (unless someone quit); both
  // are told, and it goes into their conversation.
  function finishBattle(b, quitter = 0) {
    const winner = quitter ? (quitter === b.a_id ? b.b_id : b.a_id) : b.a_won === b.b_won ? 0 : b.a_won > b.b_won ? b.a_id : b.b_id;
    const a = getUser(b.a_id), c = getUser(b.b_id);
    const an = a ? a.name : '?', cn = c ? c.name : '?';
    const head = `フレンド対決（${b.spins}回・ベット${fmt(b.bet)}）`;
    const score = `${an}さん ${fmt(b.a_won)} ／ ${cn}さん ${fmt(b.b_won)}`;
    const result = quitter ? `${quitter === b.a_id ? an : cn}さんがやめたので、${winner === b.a_id ? an : cn}さんの勝ち！`
      : winner ? `${winner === b.a_id ? an : cn}さんの勝ち！` : '引き分け！';
    const row = tx(() => {
      const r = q("UPDATE battles SET state = 'done', winner = ?, quit = ?, ended_at = ? WHERE id = ? AND state = 'live'").run(winner, quitter, Date.now(), b.id);
      if (!Number(r.changes)) return null;
      q('UPDATE users SET battle_id = 0 WHERE id IN (?, ?) AND battle_id = ?').run(b.a_id, b.b_id, b.id);
      const m = insertMessage({ channel: dmChannel(b.a_id, b.b_id), sender: null, kind: 'system', body: `${head}\n${score}\n${result}` });
      touchConversations(b.a_id, b.b_id, m.id, 0);
      return m;
    });
    if (!row) return;
    const done = battleById(b.id);
    const dto = msgDto(row);
    for (const [me, other] of [[b.a_id, b.b_id], [b.b_id, b.a_id]]) {
      live.send(me, 'battle', { type: 'done', battle: battleDto(done, me) });
      live.send(me, 'msg', { ...dto, to: me, peer: other, unread: unreadTotal(me) });
    }
  }
  // an invitation nobody answered, a battle past its time: over
  function battleOver(b, now = Date.now()) {
    if (b.state === 'invite' && now > b.created_at + BT.inviteMs) {
      q("UPDATE battles SET state = 'expired', ended_at = ? WHERE id = ? AND state = 'invite'").run(now, b.id);
      return true;
    }
    if (b.state === 'live' && now > b.started_at + BT.maxMs) {
      finishBattle(b);
      return true;
    }
    return false;
  }
  function currentBattle(userId) {
    for (let i = 0; i < 3; i++) {
      const b = openBattleOf(userId);
      if (!b || !battleOver(b)) return b || null;
    }
    return null;
  }
  // after a spin that counted: both see the score, and the last spin ends it
  function battleStep(id) {
    const b = battleById(id);
    if (!b || b.state !== 'live') return;
    if (b.a_n >= b.spins && b.b_n >= b.spins) { finishBattle(b); return; }
    for (const uid of [b.a_id, b.b_id]) live.send(uid, 'battle', { type: 'step', battle: battleDto(b, uid) });
  }

  /* ----- 協力スロット ----- */
  const CO = RULES.coop;
  // the players at a group's table, with what they bet in this round
  function coopPlayers(groupId) {
    return q(`SELECT o.id, o.name, o.avatar, m.coop_bet AS bet FROM chat_members m JOIN users o ON o.id = m.user_id
              WHERE m.group_id = ? AND o.coop_group = ? ORDER BY m.joined_at, o.id`).all(groupId, groupId)
      .map((r) => ({ ...r, online: live.isOnline(r.id) }));
  }
  function coopDto(g) { return { group: g.id, name: g.name, gauge: g.coop, goal: CO.goal, players: coopPlayers(g.id) }; }
  function coopSend(groupId, data) { for (const p of coopPlayers(groupId)) live.send(p.id, 'coop', data); }
  // After a spin at the table: everyone there sees it; a full gauge pays
  // everyone who bet in the round and goes into the group's chat.
  function coopAfterSpin(c, u, out) {
    const g = q('SELECT * FROM chat_groups WHERE id = ?').get(c.group);
    if (!g) return;
    coopSend(g.id, { type: 'spin', group: g.id, by: mini(u), bet: out.bet, win: out.total, tier: out.tier, gauge: c.gauge, goal: CO.goal });
    if (!c.paid.length) return;
    const paid = c.paid.map((p) => ({ ...p, name: (getUser(p.id) || {}).name || '?' }));
    postToGroup(g, null, 'system', `協力スロットのゲージが満タン！ボーナス: ${paid.map((p) => `${p.name}さん +${fmt(p.amount)}トークン`).join('、')}`);
    coopSend(g.id, { type: 'bonus', group: g.id, paid, gauge: 0, goal: CO.goal });
    for (const p of paid) if (p.id !== u.id) balanceChanged(p.id);
  }

  /* ----- 友達と稼ぐ (hubs) ----- */
  // Friends invited from the friend list play together in a hub of up to
  // HUB.max players, each on their own reels. Joining always goes through the
  // hub tables in one transaction, so two players accepting at once or
  // invitations that cross end up in one hub. Nobody leaves unless they say
  // so (the small 抜ける button), a hub with one player left closes (an
  // invitation starts a new one). Its benefits (RULES.hub: the odds, the
  // shared combo, 777, XP, the 5時間 booster and the 週間協力 quests) are on
  // while two or more of its players are active: something done (a tap, a
  // key, a voice) within QUESTS.idleMs.
  const HUB = RULES.hub;
  const hubRow = (id) => q('SELECT * FROM hubs WHERE id = ?').get(id);
  const memberRow = (userId) => q('SELECT * FROM hub_members WHERE user_id = ?').get(userId);
  const hubMemberRows = (hubId) => q('SELECT * FROM hub_members WHERE hub_id = ? ORDER BY joined_at, user_id').all(hubId);
  // a win that makes the combo `n` pays x1.1 for every win before it in the run
  const comboMult = (n) => (n > 1 ? Math.round(Math.pow(HUB.comboStep, n - 1) * 10000) / 10000 : 1);
  // 5時間 quests: x2 with two active players, x1.1 more for each one after
  const boosterFor = (n) => (n >= 2 ? Math.round(HUB.booster * Math.pow(HUB.boosterStep, n - 2) * 1000) / 1000 : 1);
  const isActive = (activeAt, now = Date.now()) => now - (activeAt || 0) < QUESTS.idleMs;
  // the players of a hub who are active now
  function activeIn(hubId, now = Date.now()) {
    return q('SELECT o.id, o.active_at FROM hub_members m JOIN users o ON o.id = m.user_id WHERE m.hub_id = ?').all(hubId)
      .filter((r) => isActive(r.active_at, now)).map((r) => r.id);
  }
  function hubPeople(hubId, now = Date.now()) {
    return q(`SELECT o.id, o.name, o.avatar, o.active_at, o.vip_until, o.vip_exp, o.vip_trial_until FROM hub_members m JOIN users o ON o.id = m.user_id
              WHERE m.hub_id = ? ORDER BY m.joined_at, o.id`).all(hubId)
      .map((r) => ({ id: r.id, name: r.name, avatar: r.avatar, vip: vipLevel(r, now), vipBadge: vipBadgeLevel(r, now), online: live.isOnline(r.id), idle: Math.min(86400000, Math.max(0, now - (r.active_at || 0))) }));
  }
  function hubDto(h) {
    if (!h) return null;
    const now = Date.now();
    const members = hubPeople(h.id, now);
    const active = members.filter((m) => m.idle < QUESTS.idleMs).length;
    return {
      id: h.id, combo: h.combo, misses: h.misses, won: h.won, seq: h.spins, max: HUB.max, next: comboMult(h.combo + 1),
      members, active, on: active >= 2, booster: boosterFor(active), idleMs: QUESTS.idleMs
    };
  }
  function hubSend(hubId, data, except = 0) {
    for (const m of hubMemberRows(hubId)) if (m.user_id !== except) live.send(m.user_id, 'hub', data);
  }
  // invitations to a player that are still open
  function hubInvites(userId) {
    const since = Date.now() - HUB.inviteMs;
    return q(`SELECT i.created_at, o.id, o.name, o.avatar FROM hub_invites i JOIN users o ON o.id = i.from_id
              WHERE i.to_id = ? AND i.created_at > ? ORDER BY i.created_at DESC`).all(userId, since)
      .map((r) => ({ from: { id: r.id, name: r.name, avatar: r.avatar }, until: r.created_at + HUB.inviteMs }));
  }
  // The hub, or null when there is none (any more): with one player left it closes.
  function settleHub(hubId) {
    const out = tx(() => {
      if (!hubRow(hubId)) return { hub: null, alone: [] };
      const left = hubMemberRows(hubId);
      if (left.length >= 2) return { hub: hubRow(hubId), alone: [] };
      q('DELETE FROM hub_members WHERE hub_id = ?').run(hubId);
      q('DELETE FROM hubs WHERE id = ?').run(hubId);
      return { hub: null, alone: left.map((m) => m.user_id) };
    });
    for (const id of out.alone) live.send(id, 'hub', { type: 'closed', why: 'alone' });
    return out.hub;
  }
  // the hub a player is in, or null
  function playingHub(userId) {
    const m = memberRow(userId);
    return m ? settleHub(m.hub_id) : null;
  }
  // (noVoice: the ones in it I blocked, whom my side does not call; a block
  // on me stays unseen: my call just never reaches the one who blocked me)
  function myHub(userId) {
    const h = playingHub(userId);
    return h ? { ...hubDto(h), noVoice: noVoiceIn(h.id, userId) } : null;
  }
  function noVoiceIn(hubId, userId) {
    return q(`SELECT m.user_id AS id FROM hub_members m WHERE m.hub_id = ? AND m.user_id != ? AND
                EXISTS (SELECT 1 FROM blocks b WHERE b.user_id = ? AND b.blocked_id = m.user_id)`).all(hubId, userId, userId).map((r) => r.id);
  }
  // a player leaves their hub (pressing 抜ける, or banned)
  function dropFromHub(userId) {
    const m = memberRow(userId);
    if (!m) return;
    q('DELETE FROM hub_members WHERE user_id = ?').run(userId);
    const h = settleHub(m.hub_id);
    const u = getUser(userId);
    if (h && u) hubSend(m.hub_id, { type: 'leave', user: mini(u), hub: hubDto(h) });
  }
  // The player did something at `at`. In a hub the others hear it (a minute
  // apart at most, from the beats), so everyone sees who is active.
  function touchActive(userId, at, tell = true) {
    const u = q('SELECT active_at FROM users WHERE id = ?').get(userId);
    if (!u || at <= u.active_at) return;
    q('UPDATE users SET active_at = ? WHERE id = ?').run(at, userId);
    if (!tell && isActive(u.active_at)) return;
    const m = memberRow(userId);
    if (m) hubSend(m.hub_id, { type: 'activity', user: userId, idle: Math.max(0, Date.now() - at) }, userId);
  }
  // A player's hub benefits on now: { hub, active (ids), booster } or null
  function hubOn(userId) {
    const m = memberRow(userId);
    if (!m) return null;
    const hub = hubRow(m.hub_id);
    if (!hub) return null;
    const active = activeIn(hub.id);
    if (active.length < 2 || !active.includes(userId)) return null;
    return { hub, active, booster: boosterFor(active.length) };
  }
  // the 5時間 booster of a player's quests, or null
  function questBoost(userId) {
    const on = hubOn(userId);
    return on ? { '5h': on.booster } : null;
  }
  // A SUPER BIG WIN: every friend of the player who is online hears it
  // (shown at the top of their screen), unless one of them blocked the other
  function superWin(u, out) {
    for (const r of q('SELECT friend_id FROM friends WHERE user_id = ?').all(u.id)) {
      const id = r.friend_id;
      if (!live.isOnline(id) || isBlocked(id, u.id) || isBlocked(u.id, id)) continue;
      live.send(id, 'bigwin', { user: mini(u), win: out.total, tier: out.tier });
    }
  }

  // A spin in a hub with its benefits on (inside the spin's transaction):
  // HUB.diamonds of them land five diamonds, 777 pays HUB.sevens times, and
  // the shared combo: a win adds one to it and pays comboMult(combo),
  // HUB.misses misses in a row end it. Changes `r` (what it pays, and the
  // tier the win is shown as) and the hub; returns what the spin got.
  function hubSpin(r, hub, bet) {
    const got = { combo: hub.combo, misses: hub.misses, mult: 1, sevens: false, diamonds: false };
    if (randomInt(1, 10000) <= HUB.diamonds * 10000) {
      for (const col of r.grid) col[1] = 'diamond';
      r.line = r.grid.map((col) => col[1]);
      Object.assign(r, evaluateLine(r.line, bet));
      got.diamonds = true;
    }
    const sevens = r.wins.find((w) => w.symbol === 'seven' && w.count >= 3);
    if (sevens) {
      const extra = Math.floor(sevens.amount * (HUB.sevens - 1));
      sevens.amount += extra;
      r.total += extra;
      got.sevens = true;
    }
    if (r.total > 0) {
      got.combo = hub.combo + 1;
      got.misses = 0;
      got.mult = comboMult(got.combo);
      r.total = Math.floor(r.total * got.mult);
    } else {
      got.misses = hub.misses + 1;
      if (got.misses >= HUB.misses) { got.combo = 0; got.misses = 0; }
    }
    q('UPDATE hubs SET combo = ?, misses = ?, won = won + ?, spins = spins + 1 WHERE id = ?').run(got.combo, got.misses, r.total, hub.id);
    got.seq = hub.spins + 1;
    if (r.total > 0) {
      const m = r.total / bet;
      r.tier = m >= RULES.tiers.superBig ? 3 : m >= RULES.tiers.big ? 2 : 1;
    }
    got.next = comboMult(got.combo + 1);
    return got;
  }

  /* ----- activity: the time quests ----- */
  // Every open game says once a minute how long ago its player last did
  // something (a tap, a key, a voice). The time since the last beat counts
  // while that was within QUESTS.idleMs: as time online, in a hub with its
  // benefits on, and talking with friends (a voice connected, in a hub or a
  // home call). Beats more than BEAT_GAP apart count nothing in between.
  const BEAT_GAP = 100000;
  function talkingAtHome(userId) {
    const w = q('SELECT target_id FROM watchers WHERE watcher_id = ? AND voice = 1').get(userId);
    if (w) return live.isOnline(w.target_id);
    return voiceIds(userId).some((id) => live.isOnline(id));
  }
  function beat(u, body) {
    if (u.npc) return { counted: 0 };
    const now = Date.now();
    sight.set(u.id, now);
    const idle = Math.max(0, Number(body && body.idle) || 0);
    touchActive(u.id, now - idle, true);
    const dt = now - (u.beat_at || 0);
    const ms = dt > 0 && dt <= BEAT_GAP ? Math.min(dt, Math.max(0, QUESTS.idleMs - idle + dt)) : 0;
    const sec = Math.floor(ms / 1000);
    const events = [];
    let boost = null;
    if (sec > 0) {
      events.push(['online', sec]);
      const m = memberRow(u.id);
      const on = m ? hubOn(u.id) : null;
      if (on) {
        events.push(['hubSec', sec]);
        boost = { '5h': on.booster };
      }
      const friends = !!m && hubPeople(m.hub_id).some((p) => p.id !== u.id && p.online);
      if (body && body.voice && (friends || talkingAtHome(u.id))) events.push(['talkSec', sec]);
    }
    const st = tx(() => {
      const cur = getUser(u.id);
      const r = events.length ? questStep(cur, events, boost) : null;
      // the part of a second not counted waits for the next beat
      const at = sec > 0 ? now - (ms - sec * 1000) : now;
      if (r && r.changed) q('UPDATE users SET beat_at = ?, quests = ? WHERE id = ?').run(at, r.json, cur.id);
      else q('UPDATE users SET beat_at = ? WHERE id = ?').run(at, cur.id);
      // in a hub with its benefits on: the best paid バイト earns x1.5 for the time
      const jobs = boost ? boostJobs(cur, sec * 1000) : null;
      if (jobs) q('UPDATE users SET jobs = ? WHERE id = ?').run(jobs, cur.id);
      return r;
    });
    questNotice(u.id, st);
    syncMilestones(u.id);
    return { counted: sec };
  }

  /* ----- 運営へのフィードバック ----- */
  // (read on the operator site; the operators are not asked for any)
  // (the operators named in config.operators, less those whose rights were taken away: server/core/ops.js)
  const isOperatorName = (u) => ops.isOperator(u);
  const feedbackCount = () => q('SELECT COUNT(*) AS n FROM feedback').get().n;
  // 'ask' for players who have played a while (and everyone from before it
  // existed) once the beginner guide is behind them; 'sent' once they did
  function feedbackState(u) {
    if (u.feedback === 2) return 'sent';
    if (u.npc || isOperatorName(u)) return null;
    const guide = !u.guide_done && u.play_ms < GUIDE_MS;
    return !guide && (u.feedback === 1 || u.play_ms >= GUIDE_MS) ? 'ask' : null;
  }
  function readRatings(json) {
    let r;
    try { r = JSON.parse(json); } catch { r = {}; }
    const out = {};
    for (const k of FEEDBACK_KEYS) out[k] = Number(r && r[k]) || 0;
    return out;
  }

  // After any balance change: the player's other devices and their spectators
  // follow. `quiet`: no sound, no shaking wallet (wages).
  function balanceChanged(userId, quiet = false) {
    const u = getUser(userId);
    live.send(userId, 'balance', quiet ? { ...balance(u), quiet: true } : balance(u));
    notifyWatchers(userId, { type: 'balance', user: userId, balance: balance(u) });
    return u;
  }

  /* ---------------------------------------------------------------- auth */

  function authUser(req) {
    const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(String(req.header('authorization') || ''));
    if (!m) throw new ApiError(401, 'auth', 'ログインが必要です');
    const u = userForToken(m[1]);
    u.tokenHash = sha256(m[1]);
    return u;
  }

  // Also used by the live connection.
  function userForToken(token) {
    const h = sha256(token);
    const s = q('SELECT user_id, last_used, ended, scope FROM sessions WHERE token_hash = ?').get(h);
    if (!s) throw new ApiError(401, 'auth', 'ログインの有効期限が切れました');
    // ended by the server (an operator's rights taken away): why, once, then it is gone
    if (s.ended) {
      q('DELETE FROM sessions WHERE token_hash = ?').run(h);
      throw new ApiError(401, 'ended', s.ended);
    }
    let u = getUser(s.user_id);
    if (!u) throw new ApiError(401, 'auth', 'アカウントが見つかりません');
    // the security shield has blocked this account (an operator, or by itself)
    if (!isDeveloper(u) && shield.accountBlocked(u.id)) throw new ApiError(403, 'blocked', 'このアカウントは一時的に制限されています。しばらく待ってからお試しください');
    u = allowed(u);
    const now = Date.now();
    if (VIP.permanent(u.vip_exp) && !u.vip_permanent_at) {
      q('UPDATE users SET vip_permanent_at = ? WHERE id = ?').run(now, u.id);
      u.vip_permanent_at = now;
    }
    // once a minute at most: the time since the last request is play time,
    // unless the player was away (then a new session starts)
    if (now - u.last_seen > 60000) {
      const played = now - u.last_seen < SESSION_GAP ? now - u.last_seen : 0;
      q('UPDATE users SET last_seen = ?, play_ms = play_ms + ? WHERE id = ?').run(now, played, u.id);
    }
    if (now - s.last_used > 3600000) q('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(now, h);
    // ('view': a 閲覧者's operator site session, good for nothing but looking)
    u.scope = s.scope || '';
    return u;
  }

  function createSession(userId, scope = '') {
    const token = newToken();
    const now = Date.now();
    q('INSERT INTO sessions (token_hash, user_id, created_at, last_used, scope) VALUES (?, ?, ?, ?, ?)').run(sha256(token), userId, now, now, scope);
    return token;
  }

  function nameProblem(raw) {
    let key;
    try { ({ key } = cleanName(raw)); } catch (e) { return e.message; }
    if (reservedName(key)) return 'この名前は使えません';
    if (q('SELECT 1 AS x FROM users WHERE name_key = ?').get(key)) return 'このユーザー名はすでに使われています';
    return null;
  }

  /* ---------------------------------------------------------------- ICE (voice chat) */

  let iceCache = null;
  async function iceServers() {
    const servers = [];
    if (config.stunUrls.length) servers.push({ urls: config.stunUrls });
    if (config.turnUrls.length) servers.push({ urls: config.turnUrls, username: config.turnUsername, credential: config.turnCredential });
    // outbound calls are cut during a lockdown
    if (config.cfTurnKeyId && config.cfTurnToken && emergency.outboundAllowed()) {
      if (iceCache && iceCache.until > Date.now()) return [...servers, ...iceCache.servers];
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${config.cfTurnKeyId}/credentials/generate-ice-servers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.cfTurnToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl: 86400 })
        });
        const j = await r.json();
        const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
        iceCache = { until: Date.now() + 3600000, servers: list };
        return [...servers, ...list];
      } catch (e) {
        console.error('TURN credentials failed', e);
      }
    }
    return servers;
  }

  /* ---------------------------------------------------------------- routes */

  const routes = {
    'GET /api/health': () => ({ ok: true, online: live.onlineCount() }),

    // (device: whether this device may make an account, before the name and icon are picked)
    'GET /api/name-check': (req) => {
      rate(limit.nameCheck, req.ip);
      const problem = nameProblem(req.query.get('name'));
      return { available: !problem, problem, device: deviceRoom(req) };
    },

    'POST /api/register': async (req) => {
      if (config.registration !== 'open') throw new ApiError(403, 'closed', '現在、新規登録は受け付けていません');
      rate(limit.register, req.ip, '登録の試行が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      const { name, key } = cleanName(body.name);
      const password = cleanPassword(body.password);
      const avatar = String(body.avatar || RULES.defaultAvatar);
      const choice = AVATARS.get(avatar);
      if (!choice) throw new ApiError(400, 'bad_avatar', 'アイコンを選んでください');
      if (choice.price > 0) throw new ApiError(403, 'locked', 'このアイコンは登録後に購入できます');
      if (config.registrationsPerIp > 0) {
        const n = q('SELECT COUNT(*) AS n FROM users WHERE created_ip = ? AND created_at > ?').get(req.ip, Date.now() - 86400000).n;
        if (n >= config.registrationsPerIp) throw new ApiError(429, 'too_many_accounts', 'この接続からはこれ以上アカウントを作成できません');
      }
      if (reservedName(key)) throw new ApiError(409, 'name_taken', 'この名前は使えません');
      if (q('SELECT 1 AS x FROM users WHERE name_key = ?').get(key)) throw new ApiError(409, 'name_taken', 'このユーザー名はすでに使われています');
      // two accounts a device at most (then: log in to one of them), none on a device with a BAN
      const dev = deviceOf(req);
      if (!dev.id) throw new ApiError(400, 'update', 'アプリを最新にしてからもう一度お試しください');
      const room = deviceRoom(req);
      if (room === 'banned') throw new ApiError(403, 'device_banned', DEVICE_BANNED_NEW);
      if (room === 'full') throw new ApiError(403, 'device_limit', deviceFull());
      const passwordHash = await hashPassword(password);
      const code = newRecoveryCode();
      let token, user;
      try {
        ({ token, user } = tx(() => {
          const now = Date.now();
          // a new player starts on the newest release: nothing to be thanked for yet
          const r = q(`INSERT INTO users (name, name_key, recovery_hash, recovery_enc, password_hash, avatar, tokens, dollars, coins, created_ip, created_device, created_fp,
                         created_at, last_seen, release_seen)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(name, key, sha256(normalizeRecoveryCode(code)), sealText(CODE_KEY, code), passwordHash, avatar, start.tokens, start.dollars, start.coins,
              req.ip, dev.id, dev.fp, now, now, RELEASE);
          const id = Number(r.lastInsertRowid);
          seenOn(id, req);
          return { token: createSession(id), user: getUser(id) };
        }));
      } catch (e) {
        if (/UNIQUE/i.test(String(e && e.message))) throw new ApiError(409, 'name_taken', 'このユーザー名はすでに使われています');
        throw e;
      }
      opsLog.add({ actor: user, action: 'player_register', req, summary: `${user.name}さんが登録`, detail: { avatar } });
      // (the 10th, 20th or 50th: everyone's 登録者数の記念, the newcomer too)
      milestones();
      return { token, recoveryCode: code, me: meDto(user) };
    },

    // name + password, or the recovery code
    'POST /api/login': async (req) => {
      rate(limit.login, req.ip, '試行回数が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      let u;
      if (body.code !== undefined) {
        const code = normalizeRecoveryCode(body.code);
        if (code.length !== 16) throw new ApiError(400, 'bad_code', '引き継ぎコードは16文字です');
        u = q('SELECT * FROM users WHERE recovery_hash = ?').get(sha256(code));
        if (!u) throw new ApiError(404, 'bad_code', '引き継ぎコードが正しくありません');
      } else {
        u = findByName(body.name);
        const ok = u && u.password_hash && await verifyPassword(body.password, u.password_hash);
        if (!ok) {
          if (u && !u.password_hash) throw new ApiError(401, 'no_password', 'このアカウントはパスワードが未設定です。引き継ぎコードでログインしてください');
          throw new ApiError(401, 'bad_login', 'ユーザー名かパスワードが違います');
        }
      }
      // a deleted account never comes back
      if (u.ban_kind === 'deleted') throw new ApiError(403, 'deleted', DELETED);
      // banned (or another account on this device is): logged in all the same,
      // for the title screen that stays locked until the ban ends (GET /api/ban);
      // nothing else accepts the login meanwhile
      u = liftExpired(u);
      const ban = banState(u);
      opsLog.add({ actor: u, action: 'player_login', req, summary: `${u.name}さんがログイン（${body.code !== undefined ? '引き継ぎコード' : 'パスワード'}${ban ? '・処分中' : ''}）`, detail: { by: body.code !== undefined ? 'code' : 'password', banned: !!ban } });
      if (ban) return { token: createSession(u.id), ban };
      seenOn(u.id, req);
      return { token: createSession(u.id), me: meDto(u) };
    },

    // Still banned? The question of a banned player's title screen: their
    // login answers it (and nothing else) while the ban lasts.
    'GET /api/ban': (req) => {
      const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(String(req.header('authorization') || ''));
      const s = m ? q('SELECT user_id, ended FROM sessions WHERE token_hash = ?').get(sha256(m[1])) : null;
      if (!s || s.ended) throw new ApiError(401, 'auth', 'ログインの有効期限が切れました');
      rate(limit.general, s.user_id);
      const u = getUser(s.user_id);
      if (!u) throw new ApiError(401, 'auth', 'アカウントが見つかりません');
      return { ban: banState(liftExpired(u)) };
    },

    'POST /api/logout': (req, u) => {
      q('DELETE FROM sessions WHERE token_hash = ?').run(u.tokenHash);
      return { ok: true };
    },

    'POST /api/recovery': (req, u) => {
      const code = setRecovery(u.id);
      opsLog.add({ actor: u, action: 'player_recovery', req, summary: `${u.name}さんが引き継ぎコードを再発行` });
      return { recoveryCode: code };
    },

    'POST /api/password': async (req, u) => {
      rate(limit.login, req.ip, '試行回数が多すぎます。しばらく待ってからお試しください');
      const body = await req.json();
      const password = cleanPassword(body.password);
      if (u.password_hash && !(await verifyPassword(body.current, u.password_hash))) {
        throw new ApiError(403, 'bad_password', '今のパスワードが違います');
      }
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), u.id);
      opsLog.add({ actor: u, action: 'player_password', req, summary: `${u.name}さんがパスワードを${u.password_hash ? '変更' : '設定'}` });
      return { me: meDto(getUser(u.id)) };
    },

    'GET /api/me': (req, u) => {
      syncMilestones(u.id);
      return {
        loginBonus: loginBonus(u.id),
        loginReset: nextLoginReset(),
        me: meDto(getUser(u.id)),
        unread: unreadTotal(u.id),
        friendRequests: pendingRequests(u.id),
        iconShop: iconShop(),
        itemShop: itemShop(),
        peter: peter.me(),
        johnson: johnson.me(),
        official: official.me(),
        online: live.onlineCount(),
        now: Date.now(),
        nextReset: nextUtcMidnight(),
        rules: {
          bets: RULES.bets, tokenPrice: RULES.tokenPrice, dailyLimit: RULES.dailyLimit, dailyFree: RULES.dailyFree,
          maxTransfer: { tokens: config.maxTransferTokens, dollars: config.maxTransferDollars }
        }
      };
    },

    'POST /api/spin': async (req, u) => {
      const body = await req.json();
      const bet = Number(body.bet);
      if (!RULES.bets.includes(bet)) throw new ApiError(400, 'bad_bet', 'ベット額が正しくありません');
      rate(limit.spin, u.id, 'スピンが速すぎます');
      const today = utcDay();
      // 友達と稼ぐ: the hub's benefits, on while two or more of its players are
      // active. The game says how long ago its player last did something
      // (AUTO spins by itself, so a spin alone is not that).
      const idle = Number(body.idle);
      touchActive(u.id, Date.now() - (Number.isFinite(idle) ? Math.min(86400000, Math.max(0, idle)) : 0), false);
      const on = hubOn(u.id);
      let quests = null, fight = 0, coop = null, boost = null, earned = 0;
      const result = tx(() => {
        const cur = getUser(u.id);
        if (cur.tokens < bet) throw new ApiError(409, 'insufficient', 'スピントークンが不足しています');
        const hm = on ? memberRow(cur.id) : null;
        const hub = hm && hm.hub_id === on.hub.id ? hubRow(on.hub.id) : null;
        const r = spinReels(bet, hub ? HUB.weights : undefined);
        if (hub) boost = hubSpin(r, hub, bet);
        const vip = vipLevel(cur);
        // 77777: ULTRA BIG WIN (from VIP1, VIP.ultra times)
        const ultra = r.wins.some((w) => w.symbol === 'seven' && w.count >= 5);
        if (ultra && VIP.ultra(vip) > 1) {
          r.total = Math.round(r.total * VIP.ultra(vip));
          r.vip = true;
        }
        // the combo this win makes (one's own wins in a row, or in a hub the
        // one everyone shares): from RULES.comboDouble on, the win pays double
        r.combo = r.total > 0 ? (hub ? boost.combo : cur.streak + 1) : 0;
        if (r.combo >= RULES.comboDouble) {
          r.total *= 2;
          r.double = true;
          const m = r.total / bet;
          r.tier = m >= RULES.tiers.superBig ? 3 : m >= RULES.tiers.big ? 2 : 1;
        }
        // an お守り加護 that is on softens the first losing spin, then it is used up
        // (友達と稼ぐ: up to CHARM.hub.max %, 大吉 twice as often)
        if (cur.charm > 0 && r.total < bet) {
          const c = hub ? { ...CHARM, ...CHARM.hub } : CHARM;
          const pct = randomInt(1, 10000) <= c.fullChance * 10000 ? 100 : randomInt(c.min, c.max);
          r.charm = { pct, back: Math.floor((bet - r.total) * pct / 100), hub: !!hub };
        }
        const back = r.charm ? r.charm.back : 0;
        // フレンド対決: spins at the battle's bet count, up to its number
        if (cur.battle_id) {
          const b = battleById(cur.battle_id);
          const k = b && b.state === 'live' && b.bet === bet ? (b.a_id === cur.id ? 'a' : 'b') : null;
          if (k && b[k + '_n'] < b.spins) {
            q(`UPDATE battles SET ${k}_n = ${k}_n + 1, ${k}_won = ${k}_won + ? WHERE id = ?`).run(r.total, b.id);
            fight = b.id;
          }
        }
        // 協力スロット: the bet fills the group's gauge; a full one pays everyone who bet
        if (cur.coop_group) {
          const m = q('SELECT coop_bet FROM chat_members WHERE group_id = ? AND user_id = ?').get(cur.coop_group, cur.id);
          if (!m) {
            q('UPDATE users SET coop_group = 0 WHERE id = ?').run(cur.id);
          } else {
            q('UPDATE chat_members SET coop_bet = coop_bet + ? WHERE group_id = ? AND user_id = ?').run(bet, cur.coop_group, cur.id);
            q('UPDATE chat_groups SET coop = coop + ? WHERE id = ?').run(bet, cur.coop_group);
            const g = q('SELECT id, coop FROM chat_groups WHERE id = ?').get(cur.coop_group);
            coop = { group: g.id, gauge: g.coop, paid: [] };
            if (g.coop >= CO.goal) {
              for (const p of q('SELECT user_id, coop_bet FROM chat_members WHERE group_id = ? AND coop_bet > 0').all(g.id)) {
                const amount = Math.max(1, Math.floor(p.coop_bet * CO.bonus));
                q('UPDATE users SET tokens = tokens + ?, rev = rev + 1 WHERE id = ?').run(amount, p.user_id);
                coop.paid.push({ id: p.user_id, amount });
              }
              q('UPDATE chat_members SET coop_bet = 0 WHERE group_id = ?').run(g.id);
              q('UPDATE chat_groups SET coop = 0 WHERE id = ?').run(g.id);
              coop.gauge = 0;
            }
          }
        }
        const dayWon = (cur.won_day === today ? cur.day_won : 0) + r.total;
        const last = JSON.stringify({ grid: r.grid, total: r.total, tier: r.tier, bet, at: Date.now() });
        // XP, x1.2 in a hub (with VIP on, x1.5 of that): the fraction adds up over the spins there
        let xp = LEVEL.spinXp;
        if (hub) {
          const k = Math.round((HUB.xp * (vip === null ? 1 : VIP_RULES.hubXp) - 1) * 1000);
          xp += Math.floor((hm.spins + 1) * LEVEL.spinXp * k / 1000) - Math.floor(hm.spins * LEVEL.spinXp * k / 1000);
          q('UPDATE hub_members SET spins = spins + 1 WHERE user_id = ?').run(cur.id);
          boost.xp = xp;
        }
        // wins in a row: one's own, or in a hub the combo everyone shares
        const streak = hub ? cur.streak : r.total > 0 ? cur.streak + 1 : 0;
        const combo = r.total > 0 ? (hub ? boost.combo : streak) : 0;
        earned = r.total * RULES.tokenPrice;
        // Count paying symbol combinations once per spin, after any hub reel
        // replacement; the gun quest needs all five centre reels, not four.
        // Quests also count the spin, payout in $, bet, combo and hub earnings
        // in the same row write.
        quests = questStep(cur, [['spin', 1], ['win', r.total > 0 ? 1 : 0], ['earn', earned], ['bet', bet], ['combo', combo],
          ['casinoSpend', bet * RULES.tokenPrice],
          ['barWin', r.wins.some((w) => w.symbol === 'bar') ? 1 : 0],
          ['revolver5', r.wins.some((w) => w.symbol === 'revolver' && w.count === 5) ? 1 : 0],
          ['coopEarn', hub ? earned : 0]], hub ? { '5h': on.booster } : null, xp);
        if (boost) boost.booster = on.booster;
        q(`UPDATE users SET tokens = tokens - ? + ?, total_bet = total_bet + ?, total_won = total_won + ?,
           biggest_win = MAX(biggest_win, ?), spins = spins + 1, won_day = ?, day_won = ?, last_spin = ?, charm = ?,
           quests = ?, xp = xp + ?, streak = ?, rev = rev + 1 WHERE id = ?`)
          .run(bet, r.total + back, bet, r.total, r.total, today, dayWon, last, r.charm ? 0 : cur.charm,
            quests.json, xp, streak, cur.id);
        if (config.logSpins) {
          q('INSERT INTO spins (user_id, bet, payout, line, created_at) VALUES (?, ?, ?, ?, ?)').run(cur.id, bet, r.total + back, r.line.join(','), Date.now());
        }
        if (vip !== null) addVipExp(cur, (r.total > 0 ? VIP_RULES.exp.win : 0) + (ultra ? VIP_RULES.exp.ultra : 0));
        return r;
      });
      questNotice(u.id, quests);
      syncMilestones(u.id);
      const after = getUser(u.id);
      const out = { grid: result.grid, line: result.line, wins: result.wins, total: result.total, tier: result.tier, mult: result.mult, bet, charm: result.charm || null, hub: boost,
        combo: result.combo, double: !!result.double, vip: !!result.vip };
      notifyWatchers(u.id, { type: 'spin', user: u.id, result: out, balance: balance(after) });
      if (boost && on) {
        // the others in the hub: the combo they share, and what everyone won
        // together (週間協力 counts it for the ones who are active)
        hubSend(on.hub.id, { type: 'spin', user: mini(u), win: out.total, tier: out.tier, combo: boost.combo, misses: boost.misses, next: boost.next,
          seq: boost.seq, sevens: boost.sevens, diamonds: boost.diamonds }, u.id);
        if (earned > 0) for (const id of on.active) if (id !== u.id) track(id, [['coopEarn', earned]]);
      }
      // a SUPER BIG WIN: every friend who is online hears it
      if (result.tier >= 3) superWin(u, out);
      settleBets(u.id, result.tier);
      if (fight) battleStep(fight);
      if (coop) coopAfterSpin(coop, u, out);
      afterSpend(u.id);
      return {
        result: out,
        balance: balance(after),
        charm: after.charm > 0,
        xp: after.xp,
        questTickets: questTickets(readQuests(after.quests)),
        questBonuses: questBonuses(readQuests(after.quests)),
        vip: vipDto(after),
        stats: { totalWon: after.total_won, biggestWin: after.biggest_win, spins: after.spins }
      };
    },

    'POST /api/buy': async (req, u) => {
      const body = await req.json();
      const amount = posInt(body.amount, '購入数');
      rate(limit.shop, u.id);
      const today = utcDay();
      tx(() => {
        const cur = getUser(u.id);
        const bought = cur.bought_day === today ? cur.bought_today : 0;
        const max = Math.min(Math.floor(cur.dollars / RULES.tokenPrice), RULES.dailyLimit - bought);
        if (amount > max) {
          throw new ApiError(409, 'limit', bought + amount > RULES.dailyLimit ? '本日の購入上限を超えています' : '$が足りません');
        }
        q('UPDATE users SET dollars = dollars - ?, tokens = tokens + ?, bought_day = ?, bought_today = ?, rev = rev + 1 WHERE id = ?')
          .run(amount * RULES.tokenPrice, amount, today, bought + amount, cur.id);
      });
      return { me: meDto(balanceChanged(u.id)) };
    },

    'POST /api/sell': async (req, u) => {
      const body = await req.json();
      const amount = posInt(body.amount, '交換数');
      rate(limit.shop, u.id);
      tx(() => {
        const cur = getUser(u.id);
        if (amount > cur.tokens) throw new ApiError(409, 'insufficient', 'スピントークンが足りません');
        q('UPDATE users SET tokens = tokens - ?, dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(amount, amount * RULES.tokenPrice, cur.id);
      });
      return { me: meDto(balanceChanged(u.id)) };
    },

    'POST /api/daily': (req, u) => {
      rate(limit.shop, u.id);
      const today = utcDay();
      tx(() => {
        const cur = getUser(u.id);
        if (cur.free_day === today) throw new ApiError(409, 'claimed', '今日の無料トークンは受け取り済みです');
        q('UPDATE users SET tokens = tokens + ?, free_day = ?, rev = rev + 1 WHERE id = ?').run(RULES.dailyFree, today, cur.id);
      });
      return { me: meDto(balanceChanged(u.id)), amount: RULES.dailyFree, nextReset: nextUtcMidnight() };
    },

    // by id, or by exact name (names are unique)
    'GET /api/user': (req, u) => {
      let t;
      if (req.query.get('name') !== null) {
        t = findByName(req.query.get('name'));
        if (!t || t.banned) throw new ApiError(404, 'not_found', 'その名前のプレイヤーは見つかりません');
      } else {
        t = liveTarget(posInt(req.query.get('id'), 'ユーザーID'));
      }
      return { user: publicDto(t, u.id), blocked: isBlocked(u.id, t.id), self: t.id === u.id };
    },

    /* ----- friends ----- */

    'GET /api/friends': (req, u) => {
      const friends = q(`SELECT o.id, o.name, o.avatar, o.npc, o.vip_until, o.vip_exp, o.vip_trial_until, o.last_seen AS lastSeen, f.created_at AS since FROM friends f JOIN users o ON o.id = f.friend_id
                         WHERE f.user_id = ? AND o.banned = 0 ORDER BY o.name_key`).all(u.id)
        .map(({ npc, vip_until: until, vip_exp: exp, vip_trial_until: trial, ...r }) => ({ ...r, vip: vipLevel({ npc, vip_until: until, vip_exp: exp, vip_trial_until: trial }), vipBadge: vipBadgeLevel({ npc, vip_until: until, vip_exp: exp, vip_trial_until: trial }) }));
      const incoming = q(`SELECT o.id, o.name, o.avatar, r.created_at AS at FROM friend_requests r JOIN users o ON o.id = r.from_id
                          WHERE r.to_id = ? AND o.banned = 0 ORDER BY r.created_at DESC`).all(u.id);
      const outgoing = q(`SELECT o.id, o.name, o.avatar, r.created_at AS at FROM friend_requests r JOIN users o ON o.id = r.to_id
                          WHERE r.from_id = ? AND o.banned = 0 ORDER BY r.created_at DESC`).all(u.id);
      const on = (r) => ({ ...r, online: live.isOnline(r.id) });
      return { friends: friends.map(on), incoming: incoming.map(on), outgoing: outgoing.map(on) };
    },

    'POST /api/friends/request': async (req, u) => {
      const body = await req.json();
      rate(limit.friend, u.id);
      const t = body.user !== undefined ? liveTarget(posInt(body.user, 'ユーザーID')) : findByName(body.name);
      if (!t || t.banned) throw new ApiError(404, 'not_found', 'その名前のプレイヤーは見つかりません');
      if (t.id === u.id) throw new ApiError(400, 'self', '自分には申請できません');
      if (t.npc) throw new ApiError(403, 'npc', `${t.name}にはフレンド申請できません`);
      if (areFriends(u.id, t.id)) throw new ApiError(409, 'already', 'すでにフレンドです');
      if (isBlocked(u.id, t.id)) throw new ApiError(403, 'blocked', 'ブロック中のプレイヤーには申請できません');
      if (isBlocked(t.id, u.id)) return { friendship: 'outgoing', user: mini(t) };
      // they already asked us: that makes us friends
      if (hasRequest(t.id, u.id)) return { friendship: 'friends', user: mini(t), ...makeFriends(t, u) };
      if (hasRequest(u.id, t.id)) throw new ApiError(409, 'pending', 'すでに申請しています');
      if (q('SELECT COUNT(*) AS n FROM friend_requests WHERE from_id = ?').get(u.id).n >= MAX_PENDING_REQUESTS) {
        throw new ApiError(429, 'too_many', '承認待ちの申請が多すぎます');
      }
      q('INSERT INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)').run(u.id, t.id, Date.now());
      live.send(t.id, 'friend', { type: 'request', user: mini(u), pending: pendingRequests(t.id) });
      return { friendship: 'outgoing', user: mini(t) };
    },

    'POST /api/friends/respond': async (req, u) => {
      const body = await req.json();
      rate(limit.friend, u.id);
      const t = liveTarget(posInt(body.user, 'ユーザーID'));
      if (!hasRequest(t.id, u.id)) throw new ApiError(404, 'no_request', 'フレンド申請が見つかりません');
      if (body.accept) return { friendship: 'friends', user: mini(t), ...makeFriends(t, u) };
      q('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(t.id, u.id);
      live.send(t.id, 'friend', { type: 'declined', user: mini(u) });
      return { friendship: 'none', user: mini(t), pending: pendingRequests(u.id) };
    },

    'POST /api/friends/cancel': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      q('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(u.id, id);
      live.send(id, 'friend', { type: 'cancelled', user: mini(u), pending: pendingRequests(id) });
      return { friendship: 'none' };
    },

    'POST /api/friends/remove': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      unfriend(u.id, id);
      live.send(id, 'friend', { type: 'removed', user: mini(u) });
      return { friendship: 'none' };
    },

    /* ----- chat ----- */

    'GET /api/conversations': (req, u) => {
      const rows = q(`SELECT c.other_id AS id, c.unread, c.updated_at, o.name, o.avatar, o.banned, o.npc, o.last_seen, o.vip_until, o.vip_exp, o.vip_trial_until, m.kind, m.body, m.amount, m.currency, m.sender_id, m.retracted_at
                      FROM conversations c JOIN users o ON o.id = c.other_id JOIN messages m ON m.id = c.last_id
                      WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 100`).all(u.id);
      const groups = q(`SELECT g.* FROM chat_members m JOIN chat_groups g ON g.id = m.group_id
                        WHERE m.user_id = ? ORDER BY g.updated_at DESC LIMIT 50`).all(u.id);
      return {
        conversations: rows.filter((r) => !r.banned).map((r) => ({
          user: { id: r.id, name: r.name, avatar: r.avatar, online: isOnline(r), npc: r.npc || null, lastSeen: r.npc ? null : r.last_seen, vip: vipLevel(r), vipBadge: vipBadgeLevel(r) },
          friend: areFriends(u.id, r.id),
          unread: r.unread,
          at: r.updated_at,
          last: { kind: r.kind, text: r.retracted_at ? '' : r.body, retracted: !!r.retracted_at, amount: r.amount, currency: r.currency, mine: r.sender_id === u.id }
        })),
        groups: groups.map((g) => groupDto(g, u.id)),
        unread: unreadTotal(u.id)
      };
    },

    // a conversation (with=<player>) or a group (group=<id>), newest page
    // first; `before` pages back. Also how far the others have read (既読).
    'GET /api/messages': (req, u) => {
      const withId = req.query.get('with'), groupId = req.query.get('group');
      let channel, extra;
      if (groupId) {
        const g = myGroup(u.id, posInt(groupId, 'グループ'));
        channel = groupChannel(g.id);
        const reads = q('SELECT user_id AS id, read_id AS upto FROM chat_members WHERE group_id = ? AND user_id != ?').all(g.id, u.id);
        extra = { group: groupDto(g, u.id), reads };
      } else if (withId) {
        const other = posInt(withId, 'ユーザーID');
        channel = dmChannel(u.id, other);
        const c = q('SELECT read_id FROM conversations WHERE user_id = ? AND other_id = ?').get(other, u.id);
        extra = { readUpTo: c ? c.read_id : 0 };
      } else {
        throw new ApiError(400, 'bad_chat', '相手かグループを指定してください');
      }
      const beforeRaw = Number(req.query.get('before'));
      const before = Number.isSafeInteger(beforeRaw) && beforeRaw > 0 ? beforeRaw : Number.MAX_SAFE_INTEGER;
      const rows = q(`SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar FROM messages m LEFT JOIN users s ON s.id = m.sender_id
                      WHERE m.channel = ? AND m.id < ? AND NOT (m.held = 1 AND m.recipient_id = ?) ORDER BY m.id DESC LIMIT ?`).all(channel, before, u.id, PAGE);
      return { channel, messages: rows.reverse().map(msgDto), hasMore: rows.length === PAGE, ...extra };
    },

    'POST /api/messages': async (req, u) => {
      const body = await req.json(SEND_BYTES);
      const text = sendText(body.text);
      if (body.group !== undefined) {
        const g = myGroup(u.id, posInt(body.group, 'グループ'));
        chatAllowed(u);
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        const f = filterText(text);
        const message = postToGroup(g, u, 'text', f.masked);
        detected(u, f, { group: g.id, place: 'group:' + g.name, original: text, messageId: message.id });
        track(u.id, [['chat', 1]]);
        return { message };
      }
      const to = posInt(body.to, '宛先');
      if (to === u.id) throw new ApiError(400, 'self', '自分にはメッセージを送れません');
      // to the operators (any length: a 報告 or an 意見案 can be long)
      if (official.is(to)) {
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        return { message: official.fromPlayer(u, text) };
      }
      if (peter.is(to)) {
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        return peter.chat(u, text);
      }
      if (johnson.is(to)) {
        rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
        return johnson.chat(u, text);
      }
      liveTarget(to);
      requireFriend(u, to, 'メッセージを送れるように');
      chatAllowed(u);
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      // the filter: the other player gets *** for what it found
      const f = filterText(text);
      // blocked by them: sent as far as the sender can tell, kept back from them
      const held = isBlocked(to, u.id);
      const m = tx(() => {
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'text', body: f.masked, held });
        if (held) touchOwn(u.id, to, row.id);
        else touchConversations(u.id, to, row.id);
        return row;
      });
      detected(u, f, { to, place: 'dm', original: text, messageId: m.id });
      const message = held ? sendOwn(m, u.id) : deliverDm(m, u.id, to);
      track(u.id, [['chat', 1]]);
      return { message };
    },

    // 送信の取り消し (the ⋯ under one's own message): words only, within the
    // hour, as often as one likes; money, cars, items and presents never come
    // back. The operators still see what it said, and the log keeps it.
    'POST /api/messages/retract': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.message, 'メッセージ');
      rate(limit.read, u.id);
      const m = q('SELECT * FROM messages WHERE id = ?').get(id);
      if (!m || m.sender_id !== u.id) throw new ApiError(404, 'not_found', 'このメッセージは取り消せません');
      if (m.kind !== 'text') throw new ApiError(409, 'not_text', 'お金・車・アイテム・プレゼントの送信は取り消せません');
      if (m.retracted_at) throw new ApiError(409, 'retracted', 'このメッセージはもう取り消しています');
      const now = Date.now();
      if (now - m.created_at > RETRACT_MS) throw new ApiError(409, 'too_late', '送ってから1時間を過ぎたメッセージは取り消せません');
      q('UPDATE messages SET retracted_at = ? WHERE id = ? AND retracted_at = 0').run(now, m.id);
      const group = m.channel.startsWith('group:') ? Number(m.channel.slice(6)) : 0;
      // everyone in the conversation sees it go (not one who blocked the sender: they never had it)
      const ids = group ? memberIds(group) : [u.id, m.held ? 0 : m.recipient_id];
      for (const x of ids) if (x) live.send(x, 'retract', { id: m.id, channel: m.channel, group: group || undefined, at: now });
      const t = group ? null : getUser(m.recipient_id);
      const g = group ? q('SELECT name FROM chat_groups WHERE id = ?').get(group) : null;
      opsLog.add({
        actor: u, action: 'player_retract', target: t, req,
        summary: `${u.name}さんが${group ? `グループ「${g ? g.name : '?'}」の` : `${t ? t.name : '?'}さんへの`}メッセージを取り消した`,
        detail: { messageId: m.id, channel: m.channel, group, text: m.body, sentAt: m.created_at }
      });
      return { id: m.id, retracted: now };
    },

    // Read up to the newest message: the other side (everyone in a group) sees 既読.
    'POST /api/read': async (req, u) => {
      const body = await req.json();
      rate(limit.read, u.id);
      if (body.group !== undefined) {
        const g = myGroup(u.id, posInt(body.group, 'グループ'));
        const before = q('SELECT read_id FROM chat_members WHERE group_id = ? AND user_id = ?').get(g.id, u.id).read_id;
        q('UPDATE chat_members SET unread = 0, read_id = ? WHERE group_id = ? AND user_id = ?').run(g.last_id, g.id, u.id);
        if (g.last_id > before) {
          for (const id of memberIds(g.id)) if (id !== u.id) live.send(id, 'read', { group: g.id, by: u.id, upto: g.last_id });
        }
        return { unread: unreadTotal(u.id) };
      }
      const other = posInt(body.with, 'ユーザーID');
      const c = q('SELECT last_id, read_id FROM conversations WHERE user_id = ? AND other_id = ?').get(u.id, other);
      q('UPDATE conversations SET unread = 0, read_id = last_id WHERE user_id = ? AND other_id = ?').run(u.id, other);
      if (c && c.last_id > c.read_id) live.send(other, 'read', { dm: u.id, upto: c.last_id });
      return { unread: unreadTotal(u.id) };
    },

    // 入力中: the others in the conversation see it for a few seconds
    'POST /api/typing': async (req, u) => {
      relayTyping(u, await req.json());
      return { ok: true };
    },

    /* ----- group chats ----- */

    // A group of friends: the one who makes it picks them.
    'POST /api/groups': async (req, u) => {
      const body = await req.json();
      const name = cleanText(body.name);
      if (Array.from(name).length > GROUP_NAME_MAX) throw new ApiError(400, 'bad_name', `グループ名は${GROUP_NAME_MAX}文字までです`);
      const ids = [...new Set((Array.isArray(body.members) ? body.members : []).map((v) => posInt(v, 'メンバー')))].filter((id) => id !== u.id);
      if (!ids.length) throw new ApiError(400, 'no_members', 'メンバーを選んでください');
      if (ids.length + 1 > GROUP_MAX) throw new ApiError(400, 'too_many', `グループは${GROUP_MAX}人までです`);
      for (const id of ids) {
        if (!areFriends(u.id, id)) throw new ApiError(403, 'not_friends', 'フレンドだけをグループに入れられます');
      }
      rate(limit.friend, u.id);
      const g = tx(() => {
        const now = Date.now();
        const id = Number(q('INSERT INTO chat_groups (name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, u.id, now, now).lastInsertRowid);
        for (const m of [u.id, ...ids]) q('INSERT INTO chat_members (group_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, m, now);
        return q('SELECT * FROM chat_groups WHERE id = ?').get(id);
      });
      postToGroup(g, null, 'system', `${u.name}さんがグループ「${name}」を作りました`);
      return { group: groupDto(q('SELECT * FROM chat_groups WHERE id = ?').get(g.id), u.id) };
    },

    'POST /api/groups/leave': async (req, u) => {
      const body = await req.json();
      const g = myGroup(u.id, posInt(body.group, 'グループ'));
      q('DELETE FROM chat_members WHERE group_id = ? AND user_id = ?').run(g.id, u.id);
      q('UPDATE users SET coop_group = 0 WHERE id = ? AND coop_group = ?').run(u.id, g.id);
      // (the last one out: the group and what was said in it stay, kept for good)
      if (memberIds(g.id).length) postToGroup(g, null, 'system', `${u.name}さんがグループを抜けました`);
      return { left: g.id, unread: unreadTotal(u.id) };
    },

    /* ----- money and gifts between friends ----- */

    'POST /api/transfer': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const currency = String(body.currency || '');
      if (!CURRENCIES.includes(currency)) throw new ApiError(400, 'bad_currency', '送金する通貨が正しくありません');
      const amount = posInt(body.amount, '送金額');
      const max = currency === 'tokens' ? config.maxTransferTokens : config.maxTransferDollars;
      if (amount > max) throw new ApiError(400, 'too_much', `1回に送れるのは ${fmt(max)} ${currency === 'tokens' ? 'トークン' : '$'} までです`);
      if (to === u.id) throw new ApiError(400, 'self', '自分には送金できません');
      const target = liveTarget(to);
      if (target.npc) throw new ApiError(403, 'npc', `${target.name}には送金できません`);
      requireFriend(u, to, '送金');
      rate(limit.transfer, u.id, '送金が続いています。少し待ってからお試しください');
      // the money leaves now and arrives when they tap it (POST /api/messages/claim);
      // blocked by them: they see it once they unblock
      const held = isBlocked(to, u.id);
      const m = tx(() => {
        const cur = getUser(u.id);
        if (cur[currency] < amount) {
          throw new ApiError(409, 'insufficient', currency === 'tokens' ? 'スピントークンが足りません' : '$が足りません');
        }
        // Per sender, across all recipients and both currencies; midnight in Japan.
        // The counter records sending, including pending/held/expired receipts.
        const now = Date.now();
        const day = Math.floor((now + 9 * 3600000) / 86400000);
        const start = day * 86400000 - 9 * 3600000;
        const dollars = currency === 'tokens' ? amount * RULES.tokenPrice : amount;
        // Seed existing accounts from today's messages when the counter is first used.
        q(`INSERT OR IGNORE INTO player_transfer_days (user_id, day, dollars)
           SELECT ?, ?, COALESCE(SUM(CASE WHEN currency = 'tokens' THEN amount * ? ELSE amount END), 0)
           FROM messages WHERE sender_id = ? AND kind = 'transfer' AND created_at >= ? AND created_at < ?`)
          .run(u.id, day, RULES.tokenPrice, u.id, start, start + 86400000);
        const used = q('SELECT dollars FROM player_transfer_days WHERE user_id = ? AND day = ?').get(u.id, day).dollars;
        if (used + dollars > PLAYER_TRANSFER_DAILY_DOLLARS) throw new ApiError(409, 'transfer_daily_limit', '本日はこれ以上送金できません');
        q('UPDATE player_transfer_days SET dollars = dollars + ? WHERE user_id = ? AND day = ?').run(dollars, u.id, day);
        // `currency` is one of CURRENCIES, so it is safe as a column name
        q(`UPDATE users SET ${currency} = ${currency} - ?, rev = rev + 1 WHERE id = ?`).run(amount, u.id);
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'transfer', amount, currency, held, pending: true, at: now });
        if (held) touchOwn(u.id, to, row.id);
        else touchConversations(u.id, to, row.id);
        return row;
      });
      // 送金 quests count it in $ (spin tokens at their price)
      track(u.id, [['sent', currency === 'tokens' ? amount * RULES.tokenPrice : amount]]);
      balanceChanged(u.id);
      const dto = held ? sendOwn(m, u.id) : deliverDm(m, u.id, to);
      afterSpend(u.id);
      const t = getUser(to);
      opsLog.add({
        actor: u, action: 'player_transfer', target: t, req,
        summary: `${u.name}さんが${t ? t.name : '?'}さんへ ${currency === 'tokens' ? fmt(amount) + ' トークン' : '$' + fmt(amount)} を送金${held ? '（ブロック中のため保留）' : ''}`,
        detail: { currency, amount, held, pending: true, messageId: m.id }
      });
      return { balance: balance(getUser(u.id)), message: dto };
    },

    // 受け取る: money, a car or an item sent in a chat (by a friend, Ice
    // Smoker公式 or an NPC) arrives with the tap, and only then
    'POST /api/messages/claim': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.message, 'メッセージ');
      rate(limit.read, u.id);
      const now = Date.now();
      const m = tx(() => {
        const row = q('SELECT * FROM messages WHERE id = ?').get(id);
        if (!row || !row.pending || row.recipient_id !== u.id || row.held) throw new ApiError(404, 'not_found', 'これは受け取れません');
        if (row.claimed_at) throw new ApiError(409, 'claimed', 'もう受け取りました');
        if (RECEIPTS.expired(row, now)) throw new ApiError(410, 'expired', '受け取り期限が過ぎています');
        if (row.kind === 'transfer' && CURRENCIES.includes(row.currency)) {
          q(`UPDATE users SET ${row.currency} = ${row.currency} + ?, rev = rev + 1 WHERE id = ?`).run(row.amount, u.id);
          const from = getUser(row.sender_id);
          if (from && !from.npc) q('INSERT INTO transfers (from_id, to_id, currency, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(row.sender_id, u.id, row.currency, row.amount, now);
        } else if (row.kind === 'gift') {
          const car = q('SELECT * FROM cars WHERE id = ? AND owner_id = 0').get(row.amount);
          if (!car) throw new ApiError(409, 'gone', 'この車はもうありません');
          const cur = getUser(u.id);
          if (carCount(u.id) >= garageSize(cur)) throw new ApiError(409, 'garage_full', `ガレージがいっぱいです（${garageSize(cur)}台）。空きを作ってから受け取ってください`);
          q('UPDATE cars SET owner_id = ?, acquired_at = ? WHERE id = ?').run(u.id, now, car.id);
        } else if (row.kind === 'item' && SHOP.has(row.body)) {
          const item = SHOP.get(row.body);
          const have = itemCount(u.id, item.id);
          if (have + row.amount > item.max) throw new ApiError(409, 'item_max', `${item.name}は${item.max}個までしか持てません（今${have}個）。使ってから受け取ってください`);
          addItems(u.id, item.id, row.amount);
        } else {
          throw new ApiError(400, 'bad_kind', 'これは受け取れません');
        }
        q('UPDATE messages SET claimed_at = ? WHERE id = ?').run(now, row.id);
        return row;
      });
      // both ends see it was received (on every device)
      cardChanged(m, { claimed: true });
      const from = getUser(m.sender_id);
      const what = m.kind === 'transfer' ? (m.currency === 'tokens' ? `${fmt(m.amount)} トークン` : `$${fmt(m.amount)}`)
        : m.kind === 'gift' ? `車（${CARS.get(m.body) ? CARS.get(m.body).name : m.body}）` : `${SHOP.get(m.body).name} ×${m.amount}`;
      opsLog.add({
        actor: u, action: 'player_claim', target: from, req, summary: `${u.name}さんが${from ? from.name : '?'}さんからの${what}を受け取った`,
        detail: { messageId: m.id, kind: m.kind, amount: m.amount, currency: m.currency, what: m.body, sentAt: m.created_at }
      });
      if (m.kind === 'item') live.send(u.id, 'items', { items: itemsOf(u.id) });
      return { id: m.id, kind: m.kind, amount: m.amount, currency: m.currency, me: meDto(m.kind === 'transfer' ? balanceChanged(u.id) : getUser(u.id)) };
    },

    /* ----- icons ----- */

    'POST /api/avatar': async (req, u) => {
      const body = await req.json();
      const a = AVATARS.get(String(body.id || ''));
      if (!a) throw new ApiError(400, 'bad_avatar', 'アイコンが見つかりません');
      if (a.price > 0 && !ownedAvatars(u).includes(a.id)) throw new ApiError(403, 'locked', 'このアイコンはまだ持っていません');
      q('UPDATE users SET avatar = ? WHERE id = ?').run(a.id, u.id);
      return { me: meDto(getUser(u.id)) };
    },

    // Prices do not depend on the date; unowned icons require a purchase.
    'POST /api/avatar/buy': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const a = AVATARS.get(String(body.id || ''));
      if (!a || !(a.price > 0)) throw new ApiError(400, 'bad_avatar', 'このアイコンは購入できません');
      if (body.price !== undefined && Number(body.price) !== a.price) {
        throw new ApiError(409, 'price_changed', `価格を確認してください（$${fmt(a.price)}）`, { iconShop: iconShop() });
      }
      tx(() => {
        const cur = getUser(u.id);
        const owned = ownedAvatars(cur);
        if (owned.includes(a.id)) throw new ApiError(409, 'owned', 'すでに持っています');
        if (cur.dollars < a.price) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, avatars = ?, avatar = ?, rev = rev + 1 WHERE id = ?')
          .run(a.price, [...owned, a.id].join(','), a.id, cur.id);
      });
      const me = meDto(balanceChanged(u.id));
      afterSpend(u.id);
      return { me, paid: a.price };
    },

    /* ----- cars ----- */

    // the cars one owns (and how their renting goes), the garage's size, the
    // Car Owner sale and the 大廃棄セール on now (if any), the buy-back prices
    'GET /api/cars': (req, u) => {
      settleRentals(u.id);
      const rows = q(`SELECT c.*, f.name AS from_name FROM cars c LEFT JOIN users f ON f.id = c.from_id
                      WHERE c.owner_id = ? ORDER BY c.acquired_at DESC, c.id DESC`).all(u.id);
      const now = Date.now();
      return {
        catalog: RULES.cars,
        cars: rows.map(carDto),
        capacity: garageSize(u),
        slotPrice: slotPrice(u),
        vip: vipLevel(u), vipBadge: vipBadgeLevel(u),
        sale: carSale(now),
        disposal: carDisposal(now),
        buyback: Object.fromEntries(RULES.cars.map((c) => [c.id, carBuyback(c, now)])),
        rental: { hours: RENT.hours },
        now
      };
    },

    // the buy-back: the car goes, its price now arrives (`price`: the one shown;
    // a rented car cannot go; what its renting earned comes along)
    'POST /api/cars/sell': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const id = posInt(body.car, '車');
      settleRentals(u.id);
      const r = tx(() => {
        const c = q('SELECT * FROM cars WHERE id = ? AND owner_id = ?').get(id, u.id);
        if (!c) throw new ApiError(404, 'no_car', 'この車は持っていません');
        if (c.rent_start || c.rent_paused) throw new ApiError(409, 'rented', '貸し出し中の車は売れません');
        if (c.offer_id) throw new ApiError(409, 'on_offer', '販売中の車です');
        const model = CARS.get(c.model);
        if (!model) throw new ApiError(400, 'bad_model', 'この車は買い取れません');
        const b = ownedCarBuyback(c);
        if (body.price !== undefined && Number(body.price) !== b.price) {
          throw new ApiError(409, 'price_changed', `買取価格が変わりました（今は $${fmt(b.price)}）`, { buyback: b });
        }
        q('DELETE FROM cars WHERE id = ?').run(c.id);
        q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(b.price + c.rent_earned, u.id);
        return { paid: b.price, earned: c.rent_earned, pct: b.pct, disposal: b.disposal };
      });
      return { ...r, me: meDto(balanceChanged(u.id)) };
    },

    // Atomic inventory/car exchange; a repeated equip cannot duplicate or consume an engine.
    'POST /api/cars/engine': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const id = posInt(body.car, '車');
      const engineId = body.engine === null ? '' : String(body.engine || '');
      const engine = SHOP.get(engineId);
      if (body.engine !== null && (!engine || engine.kind !== 'engine')) throw new ApiError(400, 'bad_engine', 'このエンジンは装着できません');
      tx(() => {
        const car = q('SELECT * FROM cars WHERE id = ? AND owner_id = ?').get(id, u.id);
        if (!car) throw new ApiError(404, 'no_car', 'この車は持っていません');
        if (car.rent_start || car.rent_paused) throw new ApiError(409, 'rented', '貸し出し中の車には装着できません');
        if (car.offer_id) throw new ApiError(409, 'on_offer', '販売中の車には装着できません');
        if ((car.engine || '') === engineId) return;
        if (engine && itemCount(u.id, engineId) < 1) throw new ApiError(409, 'insufficient', 'このエンジンを持っていません');
        const previous = SHOP.get(car.engine);
        if (previous && itemCount(u.id, previous.id) >= previous.max) throw new ApiError(409, 'max', '取り外すエンジンの所持数が上限です');
        if (engine) addItems(u.id, engineId, -1);
        if (previous && previous.kind === 'engine') addItems(u.id, previous.id, 1);
        q('UPDATE cars SET engine = ? WHERE id = ?').run(engineId, id);
        q('UPDATE users SET rev = rev + 1 WHERE id = ?').run(u.id);
      });
      return { car: carDto(q('SELECT * FROM cars WHERE id = ?').get(id)), me: meDto(balanceChanged(u.id)) };
    },

    // renting a car out ('start'), or asking it back ('stop': at the end of its block)
    'POST /api/cars/rent': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.car, '車');
      settleRentals(u.id);
      const now = Date.now();
      tx(() => {
        const c = q('SELECT * FROM cars WHERE id = ? AND owner_id = ?').get(id, u.id);
        if (!c) throw new ApiError(404, 'no_car', 'この車は持っていません');
        if (body.action === 'start') {
          if (c.rent_paused || c.rent_earned >= RENT.maxPay) throw new ApiError(409, 'collect_first', '先に売上を受け取ってください');
          if (c.rent_start) throw new ApiError(409, 'rented', 'この車はもう貸し出し中です');
          if (c.offer_id) throw new ApiError(409, 'on_offer', '販売中の車です');
          q('UPDATE cars SET rent_start = ?, rent_until = 0, rent_blocks = 0 WHERE id = ?').run(now, c.id);
        } else if (body.action === 'stop') {
          if (c.rent_paused) {
            q('UPDATE cars SET rent_paused = 0 WHERE id = ?').run(c.id);
            return;
          }
          if (!c.rent_start) throw new ApiError(409, 'not_rented', 'この車は貸し出していません');
          if (!c.rent_until) q('UPDATE cars SET rent_until = ? WHERE id = ?').run(c.rent_start + Math.max(1, Math.ceil((now - c.rent_start) / BLOCK)) * BLOCK, c.id);
        } else {
          throw new ApiError(400, 'bad_action', '処理を選んでください');
        }
      });
      const row = q('SELECT c.*, f.name AS from_name FROM cars c LEFT JOIN users f ON f.id = c.from_id WHERE c.id = ?').get(id);
      return { car: carDto(row) };
    },

    // what the customers paid, all of it
    'POST /api/cars/collect': async (req, u) => {
      await req.json();
      settleRentals(u.id);
      const paid = tx(() => {
        const n = q('SELECT COALESCE(SUM(MIN(rent_earned, ?)), 0) AS n FROM cars WHERE owner_id = ?').get(RENT.maxPay, u.id).n;
        if (!n) return 0;
        q(`UPDATE cars SET rent_earned = 0,
          rent_start = CASE WHEN rent_paused = 1 THEN ? ELSE rent_start END,
          rent_until = CASE WHEN rent_paused = 1 THEN 0 ELSE rent_until END,
          rent_blocks = CASE WHEN rent_paused = 1 THEN 0 ELSE rent_blocks END,
          rent_paused = 0 WHERE owner_id = ?`).run(Date.now(), u.id);
        q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(n, u.id);
        return n;
      });
      if (!paid) throw new ApiError(409, 'nothing', 'まだ受け取れる売上はありません');
      return { paid, me: meDto(balanceChanged(u.id)) };
    },

    // at the price of the moment (`price`: the one shown; a sale may have begun or ended)
    'POST /api/cars/buy': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const car = CARS.get(String(body.model || ''));
      if (!car) throw new ApiError(400, 'bad_model', 'この車は販売していません');
      const vip = vipLevel(u);
      if (!VIP.carOpen(car, vip)) throw new ApiError(403, 'vip_only', `VIP${VIP.label(car.vip)}限定車です`);
      const cost = carPrice(car, carSale(), VIP.carDiscount(vip)).price;
      if (body.price !== undefined && Number(body.price) !== cost) {
        throw new ApiError(409, 'price_changed', `価格が変わりました（今は $${fmt(cost)}）`, { sale: carSale() });
      }
      const id = tx(() => {
        const cur = getUser(u.id);
        if (carCount(cur.id) >= garageSize(cur)) throw new ApiError(409, 'garage_full', `ガレージがいっぱいです（${garageSize(cur)}台）`);
        if (cur.dollars < cost) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(cost, cur.id);
        addVipExp(cur, VIP_RULES.exp.car);
        const now = Date.now();
        return Number(q('INSERT INTO cars (owner_id, model, from_id, created_at, acquired_at, paid) VALUES (?, ?, 0, ?, ?, ?)').run(cur.id, car.id, now, now, cost).lastInsertRowid);
      });
      track(u.id, [['carBuy', 1]]);
      syncMilestones(u.id);
      const me = meDto(balanceChanged(u.id));
      afterSpend(u.id);
      return { me, paid: cost, car: { id, model: car.id, acquiredAt: Date.now(), from: null, paid: cost, used: false, offer: 0 } };
    },

    // one more place in the garage, for good ($1,000,000, VIP's off; any number of times)
    'POST /api/garage/expand': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const price = slotPrice(u);
      if (body.price !== undefined && Number(body.price) !== price) throw new ApiError(409, 'price_changed', `価格が変わりました（今は $${fmt(price)}）`);
      tx(() => {
        const cur = getUser(u.id);
        if (cur.dollars < price) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, garage_extra = garage_extra + 1, rev = rev + 1 WHERE id = ?').run(price, cur.id);
      });
      const after = balanceChanged(u.id);
      afterSpend(u.id);
      return { me: meDto(after), capacity: garageSize(after) };
    },

    'POST /api/cars/gift': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const carId = posInt(body.car, '車');
      if (to === u.id) throw new ApiError(400, 'self', '自分にはあげられません');
      const target = liveTarget(to);
      if (target.npc) throw new ApiError(403, 'npc', `${target.name}には車をあげられません`);
      requireFriend(u, to, '車をあげる');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーにはあげられません');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      settleRentals(u.id);
      const m = tx(() => {
        const car = q('SELECT * FROM cars WHERE id = ? AND owner_id = ?').get(carId, u.id);
        if (!car) throw new ApiError(404, 'no_car', 'この車は持っていません');
        if (car.rent_start || car.rent_paused) throw new ApiError(409, 'rented', '貸し出し中の車はあげられません');
        if (car.offer_id) throw new ApiError(409, 'on_offer', '販売中の車です');
        // what its renting earned stays with the giver
        if (car.rent_earned) q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(car.rent_earned, u.id);
        const them = getUser(to);
        if (carCount(to) >= garageSize(them)) throw new ApiError(409, 'their_garage_full', `${them.name}さんのガレージがいっぱいです`);
        // nobody's until they tap it (POST /api/messages/claim)
        q("UPDATE cars SET owner_id = 0, from_id = ?, acquired_at = ?, via = 'gift', rent_earned = 0, rent_last = '' WHERE id = ?").run(u.id, Date.now(), car.id);
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'gift', body: car.model, amount: car.id, pending: true });
        touchConversations(u.id, to, row.id);
        return row;
      });
      return { message: deliverDm(m, u.id, to) };
    },

    // 車を売る: an offer in the chat with a friend (not Ice Smoker公式 or the
    // NPCs), at RULES.carResale % of what the seller paid for the car. The car
    // stays the seller's until the friend buys it (or the seller takes it back).
    'POST /api/cars/offer': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const carId = posInt(body.car, '車');
      const price = posInt(body.price, '金額');
      if (to === u.id) throw new ApiError(400, 'self', '自分には売れません');
      const t = liveTarget(to);
      if (t.npc) throw new ApiError(403, 'npc', `${t.name}には売れません`);
      requireFriend(u, to, '販売');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには売れません');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      settleRentals(u.id);
      const m = tx(() => {
        const car = q('SELECT * FROM cars WHERE id = ? AND owner_id = ?').get(carId, u.id);
        if (!car) throw new ApiError(404, 'no_car', 'この車は持っていません');
        if (car.rent_start || car.rent_paused) throw new ApiError(409, 'rented', '貸し出し中の車は売れません');
        if (car.offer_id) throw new ApiError(409, 'on_offer', 'この車はもう販売中です');
        const r = resaleRange(car);
        if (price < r.min || price > r.max) throw new ApiError(400, 'bad_price', `価格は $${fmt(r.min)}〜$${fmt(r.max)} です`);
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'car_offer', amount: price, currency: 'dollars',
          body: JSON.stringify({ car: car.id, model: car.model, used: !!car.used }) });
        q('UPDATE cars SET offer_id = ? WHERE id = ?').run(row.id, car.id);
        touchConversations(u.id, to, row.id);
        return row;
      });
      return { message: deliverDm(m, u.id, to) };
    },

    // the seller takes the car back off sale
    'POST /api/cars/offer/cancel': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.id, '販売');
      const m = tx(() => {
        const row = q("SELECT * FROM messages WHERE id = ? AND kind = 'car_offer' AND sender_id = ?").get(id, u.id);
        if (!row) throw new ApiError(404, 'not_found', 'この販売は見つかりません');
        if (row.state) throw new ApiError(409, 'done', row.state === 'sold' ? 'この車はもう売れました' : 'この販売はもう取り消しました');
        q("UPDATE messages SET state = 'canceled' WHERE id = ? AND state = ''").run(id);
        q('UPDATE cars SET offer_id = 0 WHERE offer_id = ?').run(id);
        return row;
      });
      cardChanged(m, { state: 'canceled' });
      return { ok: true, state: 'canceled' };
    },

    // the friend buys it: the car moves to them (a 中古車 now, bought at this
    // price), the seller gets a card in the chat to take the money from
    'POST /api/cars/offer/buy': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.id, '販売');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      const r = tx(() => {
        const row = q("SELECT * FROM messages WHERE id = ? AND kind = 'car_offer' AND recipient_id = ?").get(id, u.id);
        if (!row) throw new ApiError(404, 'not_found', 'この販売は見つかりません');
        if (row.state) throw new ApiError(409, 'done', row.state === 'sold' ? 'この車はもう売れました' : 'この販売は取り消されました');
        const car = q('SELECT * FROM cars WHERE offer_id = ? AND owner_id = ?').get(id, row.sender_id);
        if (!car) throw new ApiError(409, 'gone', 'この車はもう販売されていません');
        requireFriend(u, row.sender_id, '購入');
        const cur = getUser(u.id);
        if (carCount(cur.id) >= garageSize(cur)) throw new ApiError(409, 'garage_full', `ガレージがいっぱいです（${garageSize(cur)}台）`);
        if (cur.dollars < row.amount) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(row.amount, cur.id);
        // what its renting earned stays with the seller
        if (car.rent_earned) q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(car.rent_earned, row.sender_id);
        q(`UPDATE cars SET owner_id = ?, from_id = ?, acquired_at = ?, paid = ?, used = 1, via = 'friend', offer_id = 0, rent_earned = 0, rent_last = '' WHERE id = ?`)
          .run(cur.id, row.sender_id, Date.now(), row.amount, car.id);
        q("UPDATE messages SET state = 'sold' WHERE id = ?").run(id);
        const sold = insertMessage({ channel: row.channel, sender: cur, recipient: row.sender_id, kind: 'car_sold', amount: row.amount, currency: 'dollars',
          body: JSON.stringify({ car: car.id, model: car.model, offer: id }) });
        touchConversations(cur.id, row.sender_id, sold.id, row.sender_id);
        return { row, sold, carId: car.id, earned: car.rent_earned };
      });
      cardChanged(r.row, { state: 'sold' });
      deliverDm(r.sold, u.id, r.row.sender_id);
      if (r.earned) balanceChanged(r.row.sender_id);
      track(u.id, [['carBuy', 1]]);
      syncMilestones(u.id);
      const me = meDto(balanceChanged(u.id));
      afterSpend(u.id);
      return { state: 'sold', car: r.carId, me };
    },

    // the seller taps the 売れました card: the money arrives
    'POST /api/cars/sold/claim': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.id, 'メッセージ');
      const m = tx(() => {
        const row = q("SELECT * FROM messages WHERE id = ? AND kind = 'car_sold' AND recipient_id = ?").get(id, u.id);
        if (!row) throw new ApiError(404, 'not_found', 'この売上は見つかりません');
        if (RECEIPTS.expired(row)) throw new ApiError(410, 'expired', '売上金の受け取り期限が過ぎています');
        if (!Number(q('UPDATE messages SET claimed_at = ? WHERE id = ? AND claimed_at = 0').run(Date.now(), id).changes)) {
          throw new ApiError(409, 'claimed', 'この売上はもう受け取りました');
        }
        q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(row.amount, u.id);
        q('INSERT INTO transfers (from_id, to_id, currency, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(row.sender_id, u.id, 'dollars', row.amount, Date.now());
        return row;
      });
      cardChanged(m, { claimed: true });
      return { paid: m.amount, balance: balance(balanceChanged(u.id)) };
    },

    /* ----- blocking ----- */

    'GET /api/blocks': (req, u) => ({
      blocks: q('SELECT b.blocked_id AS id, o.name, o.avatar FROM blocks b JOIN users o ON o.id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC').all(u.id)
    }),

    'POST /api/block': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      if (id === u.id) throw new ApiError(400, 'self', '自分はブロックできません');
      const target = getUser(id);
      if (!target) throw new ApiError(404, 'not_found', 'ユーザーが見つかりません');
      if (target.npc) throw new ApiError(400, 'npc', `${target.name}はブロックできません`);
      // A silent block: the other player is not told and can go on as before
      // (messages, money, presents, calls, invitations all seem to go out),
      // but nothing reaches the one who blocked; what was sent meanwhile
      // arrives when they unblock.
      let released = 0;
      if (body.blocked) {
        q('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(u.id, id, Date.now());
        q('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(id, u.id);
        q('DELETE FROM hub_invites WHERE from_id = ? AND to_id = ?').run(id, u.id);
      } else {
        q('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(u.id, id);
        released = releaseHeld(u.id, id);
      }
      return { blocked: !!body.blocked, released, unread: unreadTotal(u.id) };
    },

    /* ----- voice chat signalling (the home call) ----- */

    'GET /api/call/ice': async () => ({ iceServers: await iceServers() }),

    'POST /api/call': async (req, u) => {
      relayCall(u, await req.json(32 * 1024));
      return { ok: true };
    },

    /* ----- watching a friend's screen ----- */

    // 稼ぎに参加: watching a friend's screen puts one in their home (and its voice call)
    'POST /api/watch': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      if (!body.on) {
        const host = watching(u.id);
        q('DELETE FROM watchers WHERE watcher_id = ?').run(u.id);
        if (host) homeChanged(host, mini(u), false);
        return { on: false };
      }
      const t = liveTarget(id);
      if (id === u.id) throw new ApiError(400, 'self', '自分の画面は見られません');
      requireFriend(u, id, '稼ぎに参加');
      const prev = watching(u.id);
      const others = watcherIds(id).filter((w) => w !== u.id);
      if (others.length >= RULES.maxWatchers) throw new ApiError(409, 'full', `${t.name}さんのホームは満員です（最大${RULES.maxWatchers}人）`);
      if (prev && prev !== id) {
        q('DELETE FROM watchers WHERE watcher_id = ?').run(u.id);
        homeChanged(prev, mini(u), false);
      }
      // back after a dropped connection: the voice the player gave stays
      const kept = voiceKept.get(`${id}:${u.id}`);
      const voice = kept && kept > Date.now() ? 1 : 0;
      voiceKept.delete(`${id}:${u.id}`);
      q(`INSERT INTO watchers (watcher_id, target_id, since, voice) VALUES (?, ?, ?, ?)
         ON CONFLICT(watcher_id) DO UPDATE SET target_id = excluded.target_id, since = excluded.since,
         voice = CASE WHEN watchers.target_id = excluded.target_id THEN MAX(watchers.voice, excluded.voice) ELSE excluded.voice END`).run(u.id, id, Date.now(), voice);
      if (prev !== id) {
        homeChanged(id, mini(u), true);
        track(u.id, [['watch', 1]]);
        if (voice) voiceChanged(id, u, true);
      }
      let last = null;
      try { last = t.last_spin ? JSON.parse(t.last_spin) : null; } catch { last = null; }
      const all = homeMembers(id);
      return {
        on: true, user: { ...mini(t), online: live.isOnline(id) }, balance: balance(t), last, charm: t.charm > 0,
        members: all.filter((m) => m.id !== u.id),
        voice: all.some((m) => m.id === u.id && m.voice),
        chat: homeChatOf(id),
        bet: betDto(openBet(u.id))
      };
    },

    // who is watching me (shown as a small eye on my screen), whether I talk with them, the home chat
    'GET /api/watchers': (req, u) => ({ watchers: homeMembers(u.id), chat: homeChatOf(u.id) }),

    // The watched player picks who they talk with; a watcher can only stop talking.
    'POST /api/watch/voice': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.user, 'ユーザーID');
      const on = !!body.on;
      const host = id === u.id ? watching(u.id) : u.id;
      if (!host || watching(id) !== host) throw new ApiError(404, 'not_watching', 'このプレイヤーは観戦していません');
      if (id === u.id && on) throw new ApiError(403, 'host_only', '話す相手は観戦されている人が選びます');
      rate(limit.friend, u.id);
      q('UPDATE watchers SET voice = ? WHERE watcher_id = ?').run(on ? 1 : 0, id);
      voiceChanged(host, id === u.id ? u : getUser(id), on);
      return { voice: voiceIds(host) };
    },

    // the chat of a home: the watched player and everyone watching them
    'POST /api/home/chat': async (req, u) => {
      const body = await req.json();
      const room = posInt(body.room, 'ホーム');
      if (room !== u.id && watching(u.id) !== room) throw new ApiError(409, 'not_home', 'ホームにいません');
      chatAllowed(u);
      const raw = cleanText(body.text, 200);
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      const f = filterText(raw);
      const text = f.masked;
      detected(u, f, { to: room, place: room === u.id ? 'home' : 'home:' + room, original: raw });
      const message = { id: `${Date.now().toString(36)}-${++homeChatSeq}`, room, from: mini(u), text, at: Date.now() };
      homeChats.set(room, homeChatOf(room).concat(message).slice(-HOME_CHAT_KEEP));
      // written down for good (the home shows only its last ones, while it is open)
      keepLive('home', room, u.id, 0, text, raw, message.at);
      live.send(room, 'homechat', message);
      for (const id of watcherIds(room)) live.send(id, 'homechat', message);
      track(u.id, [['chat', 1]]);
      return { message };
    },

    // 観戦ベット: will the player I watch get a BIG WIN within their next spins?
    'POST /api/watch/bet': async (req, u) => {
      const body = await req.json();
      const side = body.side === 'hit' || body.side === 'miss' ? body.side : null;
      if (!side) throw new ApiError(400, 'bad_side', '「出る」か「出ない」を選んでください');
      const stake = Number(body.stake);
      if (!WB.stakes.includes(stake)) throw new ApiError(400, 'bad_stake', '賭ける額が正しくありません');
      const hostId = watching(u.id);
      if (!hostId) throw new ApiError(409, 'not_watching', '観戦中だけ賭けられます');
      rate(limit.shop, u.id);
      const bet = tx(() => {
        if (openBet(u.id)) throw new ApiError(409, 'bet_open', '前の観戦ベットの結果が出てから賭けられます');
        const cur = getUser(u.id);
        if (cur.tokens < stake) throw new ApiError(409, 'insufficient', 'スピントークンが足りません');
        q('UPDATE users SET tokens = tokens - ?, rev = rev + 1 WHERE id = ?').run(stake, u.id);
        const id = Number(q('INSERT INTO watch_bets (watcher_id, host_id, side, stake, left_n, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(u.id, hostId, side, stake, WB.spins, Date.now()).lastInsertRowid);
        return q('SELECT * FROM watch_bets WHERE id = ?').get(id);
      });
      const me = balanceChanged(u.id);
      const dto = betDto(bet);
      live.send(hostId, 'watch', { type: 'betOn', by: mini(u), bet: dto });
      track(u.id, [['wbet', 1]]);
      return { bet: dto, balance: balance(me) };
    },

    /* ----- Shop, 所有 (what one owns) and the お守り加護 ----- */

    'GET /api/items': (req, u) => ({ items: itemsOf(u.id), charm: u.charm > 0, shop: itemShop() }),

    // Charged at the price of the moment (`price` per piece, as shown).
    'POST /api/shop/buy': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const item = SHOP.get(String(body.id || ''));
      if (!item) throw new ApiError(400, 'bad_item', 'この商品は販売していません');
      const count = body.count === undefined ? 1 : posInt(body.count, '個数');
      const sale = shopSale(item);
      if (body.price !== undefined && Number(body.price) !== sale.price) {
        throw new ApiError(409, 'price_changed', `価格が変わりました（今は $${fmt(sale.price)}）`, { itemShop: itemShop() });
      }
      tx(() => {
        const cur = getUser(u.id);
        const have = itemCount(cur.id, item.id);
        if (have + count > item.max) {
          throw new ApiError(409, 'max', have >= item.max ? `${item.name}は一人${item.max}個までです` : `${item.name}は一人${item.max}個まで（あと${item.max - have}個買えます）`);
        }
        const cost = sale.price * count;
        if (cur.dollars < cost) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(cost, cur.id);
        addItems(cur.id, item.id, count);
      });
      const me = meDto(balanceChanged(u.id));
      afterSpend(u.id);
      return { me, paid: sale.price * count, pct: sale.pct };
    },

    // Everything from the Shop can be given to a friend.
    'POST /api/items/give': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const item = SHOP.get(String(body.id || ''));
      if (!item) throw new ApiError(400, 'bad_item', 'このアイテムは譲れません');
      const count = body.count === undefined ? 1 : posInt(body.count, '個数');
      if (to === u.id) throw new ApiError(400, 'self', '自分には譲れません');
      const t = liveTarget(to);
      if (t.npc) throw new ApiError(403, 'npc', `${t.name}には譲れません`);
      requireFriend(u, to, 'アイテムを譲る');
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには譲れません');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      const m = tx(() => {
        const have = itemCount(u.id, item.id);
        if (have < count) throw new ApiError(409, 'insufficient', `${item.name}が足りません（${have}個）`);
        // (what already waits for their tap counts too)
        const theirs = itemCount(to, item.id) + q(`SELECT COALESCE(SUM(amount), 0) AS n FROM messages
          WHERE recipient_id = ? AND pending = 1 AND claimed_at = 0 AND kind = 'item' AND body = ? AND created_at > ?`).get(to, item.id, Date.now() - RULES.receiveDays.item * 86400000).n;
        if (theirs + count > item.max) {
          throw new ApiError(409, 'their_max', theirs >= item.max
            ? `${t.name}さんは${item.name}を上限（${item.max}個）まで持っています`
            : `${t.name}さんに譲れるのはあと${item.max - theirs}個までです`);
        }
        addItems(u.id, item.id, -count);
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'item', body: item.id, amount: count, pending: true });
        touchConversations(u.id, to, row.id);
        return row;
      });
      return { me: meDto(getUser(u.id)), message: deliverDm(m, u.id, to) };
    },

    // One tap on the slot screen, before spinning: the お守り加護 is on until a spin is lost.
    'POST /api/charm': (req, u) => {
      rate(limit.shop, u.id);
      tx(() => {
        const cur = getUser(u.id);
        if (cur.charm > 0) throw new ApiError(409, 'active', 'お守り加護はもう発動中です');
        if (itemCount(cur.id, CHARM.item) < 1) throw new ApiError(409, 'none', 'お守り加護を持っていません（Shop で買えます）');
        addItems(cur.id, CHARM.item, -1);
        q('UPDATE users SET charm = 1 WHERE id = ?').run(cur.id);
      });
      notifyWatchers(u.id, { type: 'charm', user: u.id, on: true });
      return { me: meDto(getUser(u.id)) };
    },

    /* ----- fruits for the friend one is watching ----- */

    'POST /api/tip': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      if (watching(u.id) !== to) throw new ApiError(409, 'not_watching', '観戦中の友達にだけ送れます');
      const t = liveTarget(to);
      if (t.npc) throw new ApiError(403, 'npc', `${t.name}には送れません`);
      if (isBlocked(to, u.id)) throw new ApiError(403, 'blocked', 'このユーザーには送れません');
      const fruits = {};
      let count = 0, amount = 0;
      for (const [id, n] of Object.entries(body.fruits || {})) {
        const f = FRUITS.get(id);
        if (!f) throw new ApiError(400, 'bad_fruit', 'このフルーツは送れません');
        if (n === 0) continue;
        const k = posInt(n, '個数');
        fruits[id] = k;
        count += k;
        amount += k * f.tokens;
      }
      if (!count) throw new ApiError(400, 'bad_amount', '送るフルーツを選んでください');
      if (count > 200) throw new ApiError(400, 'too_many', '一度に送れるのは200個までです');
      rate(limit.tip, u.id, 'フルーツが速すぎます。少し待ってください');
      tx(() => {
        const cur = getUser(u.id);
        if (cur.tokens < amount) throw new ApiError(409, 'insufficient', 'スピントークンが足りません');
        q('UPDATE users SET tokens = tokens - ?, rev = rev + 1 WHERE id = ?').run(amount, u.id);
        q('UPDATE users SET tokens = tokens + ?, rev = rev + 1 WHERE id = ?').run(amount, to);
        q('INSERT INTO transfers (from_id, to_id, currency, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(u.id, to, 'tokens', amount, Date.now());
      });
      const tip = { from: mini(u), fruits, amount };
      live.send(to, 'tip', tip);
      // everyone in the home sees the fruit fly
      notifyWatchers(to, { type: 'tip', user: to, ...tip });
      balanceChanged(to);
      track(u.id, Object.entries(fruits));
      balanceChanged(u.id);
      afterSpend(u.id);
      return { balance: balance(getUser(u.id)), amount, to: t.id };
    },

    /* ----- マイクソン (the lender) and ジョンソン (a friend) ----- */

    'GET /api/peter': (req, u) => peter.state(u.id),

    // his chat was opened: a gift that is due comes now
    'GET /api/johnson': (req, u) => {
      johnson.check(u.id);
      return johnson.state(u.id);
    },

    'POST /api/peter/borrow': async (req, u) => {
      const body = await req.json();
      const n = Number(body.offer);
      if (!(n === 1 || n === 2)) throw new ApiError(400, 'bad_offer', '話が見つかりません');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      return { ...peter.takeOffer(u, n), me: meDto(getUser(u.id)) };
    },

    'POST /api/peter/repay': async (req, u) => {
      const body = await req.json();
      const amount = posInt(body.amount, '返済額');
      rate(limit.transfer, u.id, '少し待ってからお試しください');
      return { ...peter.repay(u, amount), me: meDto(getUser(u.id)) };
    },

    // still playing when the day turns (6:00 Japan time): that day counts too
    'POST /api/login-bonus': (req, u) => ({ loginBonus: loginBonus(u.id), next: nextLoginReset(), me: meDto(getUser(u.id)) }),

    /* ----- quests and XP ----- */

    'GET /api/quests': (req, u) => {
      syncMilestones(u.id);
      const cur = getUser(u.id);
      const state = readQuests(cur.quests);
      return { periods: questView(state), ready: questsReady(state), tickets: questTickets(state), bonuses: questBonuses(state), xp: cur.xp, now: Date.now() };
    },

    // 受け取る: the finished quests in `ids`, or all of them (一括受け取り)
    'POST /api/quests/claim': async (req, u) => {
      const body = await req.json();
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 100) : null;
      rate(limit.shop, u.id);
      const r = tx(() => {
        const cur = getUser(u.id);
        const state = readQuests(cur.quests);
        const c = claimQuests(state, ids, Date.now());
        if (!c.claimed.length) return { ...c, state };
        // XP, x1.2 in a hub with its benefits on (and VIP's x1.5 there)
        const boost = hubOn(cur.id) ? HUB.xp * (vipOn(cur) ? VIP_RULES.hubXp : 1) : 1;
        const xp = Math.floor(c.claimed.length * LEVEL.questXp * boost + 1e-9);
        grantLevelTickets(state, cur.xp, cur.xp + xp, questTicketRoll);
        q('UPDATE users SET quests = ?, dollars = dollars + ?, coins = coins + ?, xp = xp + ?, rev = rev + 1 WHERE id = ?')
          .run(JSON.stringify(state), c.dollars, c.coins, xp, cur.id);
        return { ...c, state };
      });
      if (r.claimed.length) balanceChanged(u.id);
      syncMilestones(u.id);
      const after = getUser(u.id);
      const state = readQuests(after.quests);
      if (r.claimed.length) live.send(u.id, 'quest', { changed: true, ready: questsReady(state), tickets: questTickets(state), bonuses: questBonuses(state), xp: after.xp });
      return {
        claimed: r.claimed.map((x) => x.id), dollars: r.dollars, coins: r.coins, rewards: r.rewards, tokens: 0,
        periods: questView(state), ready: questsReady(state), tickets: questTickets(state), bonuses: questBonuses(state), xp: after.xp, balance: balance(after)
      };
    },

    'POST /api/quests/reset': async (req, u) => {
      const body = await req.json();
      rate(limit.shop, u.id);
      const state = tx(() => {
        const cur = getUser(u.id);
        const state = readQuests(cur.quests);
        resetQuestPeriod(state, body.period, { start: body.start, version: body.version });
        q('UPDATE users SET quests = ?, rev = rev + 1 WHERE id = ?').run(JSON.stringify(state), u.id);
        return state;
      });
      const after = getUser(u.id);
      live.send(u.id, 'quest', { changed: true, ready: questsReady(state), tickets: questTickets(state), bonuses: questBonuses(state), xp: after.xp });
      return { periods: questView(state), ready: questsReady(state), tickets: questTickets(state), bonuses: questBonuses(state), xp: after.xp, now: Date.now(), balance: balance(after) };
    },

    // the beginner guide is finished
    'POST /api/guide': (req, u) => {
      q('UPDATE users SET guide_done = 1 WHERE id = ?').run(u.id);
      return { me: meDto(getUser(u.id)) };
    },

    // 友達のチャットを覗く: the player opened a friend's chat
    'POST /api/quests/peek': async (req, u) => {
      const body = await req.json();
      const other = posInt(body.with, 'ユーザーID');
      rate(limit.read, u.id);
      if (!areFriends(u.id, other)) return { ok: false };
      track(u.id, [['peek', 1]]);
      return { ok: true };
    },

    /* ----- バイト ----- */

    'GET /api/jobs': (req, u) => jobsDto(getUser(u.id)),

    // With every slot taken, a new job takes the place of the oldest (paid up).
    'POST /api/jobs/start': async (req, u) => {
      const body = await req.json();
      const job = JOBS.get(String(body.id || ''));
      if (!job) throw new ApiError(400, 'bad_job', 'このバイトはありません');
      rate(limit.shop, u.id);
      const paid = tx(() => {
        const cur = getUser(u.id);
        if (LEVEL.of(cur.xp) < job.level) throw new ApiError(403, 'locked', `このバイトはLv.${job.level}から働けます`);
        const now = Date.now();
        const s = settleJobs(cur, now);
        if (s.jobs.some((j) => j.id === job.id)) throw new ApiError(409, 'working', 'このバイトはもう始めています');
        while (s.jobs.length >= LEVEL.jobSlots(LEVEL.of(cur.xp))) s.jobs.shift();
        s.jobs.push({ id: job.id, since: now });
        saveJobs(cur.id, s.jobs, s.pay);
        return s.pay;
      });
      jobsPaid(u.id, paid);
      const after = getUser(u.id);
      return { paid, balance: balance(after), ...jobsDto(after) };
    },

    'POST /api/jobs/stop': async (req, u) => {
      const body = await req.json();
      const id = String(body.id || '');
      rate(limit.shop, u.id);
      const paid = tx(() => {
        const cur = getUser(u.id);
        const s = settleJobs(cur, Date.now());
        if (!s.jobs.some((j) => j.id === id)) throw new ApiError(409, 'not_working', 'このバイトはしていません');
        saveJobs(cur.id, s.jobs.filter((j) => j.id !== id), s.pay);
        return s.pay;
      });
      jobsPaid(u.id, paid);
      const after = getUser(u.id);
      return { paid, balance: balance(after), ...jobsDto(after) };
    },

    // the wages so far, the work goes on
    'POST /api/jobs/collect': (req, u) => {
      rate(limit.shop, u.id);
      const paid = tx(() => {
        const cur = getUser(u.id);
        const s = settleJobs(cur, Date.now());
        if (s.pay > 0) saveJobs(cur.id, s.jobs, s.pay);
        return s.pay;
      });
      jobsPaid(u.id, paid);
      const after = getUser(u.id);
      return { paid, balance: balance(after), ...jobsDto(after) };
    },

    /* ----- VIP ----- */

    // `days` more days of VIP for ロイヤルコイン (from VIP1 some come back at
    // once), each 24 hours from the end of those already bought (or from now);
    // or a まとめ買い pack (`pack`: its days, paid for, and its free days on
    // top). The バイト are paid up first, so VIP's wage counts from now.
    'POST /api/vip/extend': async (req, u) => {
      const body = await req.json();
      const mode = body.mode === undefined ? 'normal' : body.mode;
      if (typeof mode !== 'string' || !VIP.mode(mode)) throw new ApiError(400, 'vip_mode', '通常・PRO・ULTRAから選んでください');
      if (body.packs !== undefined && (body.pack !== undefined || body.days !== undefined)) throw new ApiError(400, 'vip_cart', '購入するプランを確認してください');
      const pack = body.pack !== undefined ? VIP.pack(Number(body.pack)) : null;
      if (body.pack !== undefined && !pack) throw new ApiError(409, 'no_pack', 'このまとめ買いは今はありません');
      const cart = body.packs !== undefined ? VIP.cart(body.packs, 0) : pack ? VIP.cart([{ days: pack.days, qty: 1 }], 0) : null;
      if (body.packs !== undefined && !cart) throw new ApiError(400, 'vip_cart', 'カートのプランと数量を確認してください');
      const bought = cart ? cart.bought : posInt(body.days, '日数');
      const bonus = cart ? cart.bonus : 0, days = bought + bonus;
      const resetTickets = cart ? cart.resetTickets : 0;
      rate(limit.shop, u.id);
      const now = Date.now();
      const r = tx(() => {
        const cur = getUser(u.id);
        const start = Math.max(now, cur.vip_until), until = start + days * VIP.day;
        if (until > now + VIP_RULES.maxDays * VIP.day) throw new ApiError(409, 'too_long', `VIPは${VIP_RULES.maxDays}日先までです`);
        const c = VIP.cost(bought, VIP.level(cur.vip_exp), mode);
        if (cur.coins < c.coins) throw new ApiError(409, 'insufficient', 'ロイヤルコインが足りません');
        const s = settleJobs(cur, now);
        saveJobs(cur.id, s.jobs, s.pay);
        let quests = cur.quests;
        if (resetTickets) {
          const state = readQuests(quests), tickets = questTickets(state);
          state.tickets = { '5h': tickets['5h'] + resetTickets, day: tickets.day };
          quests = JSON.stringify(state);
        }
        const modes = VIP.intervals(cur.vip_modes).filter(p => p.end > now);
        if (mode !== 'normal') modes.push({ start, end: until, mode });
        q('UPDATE users SET coins = coins - ? + ?, vip_until = ?, vip_modes = ?, quests = ?, rev = rev + 1 WHERE id = ?').run(c.coins, c.back, until, JSON.stringify(modes), quests, cur.id);
        return { ...c, paid: s.pay, start, until };
      });
      if (r.paid) track(u.id, [['jobpay', r.paid]]);
      syncMilestones(u.id);
      const me = meDto(balanceChanged(u.id));
      if (resetTickets) live.send(u.id, 'quest', { changed: true, ready: me.questsReady, tickets: me.questTickets, bonuses: me.questBonuses, xp: me.xp });
      return { days, bonus, coins: r.coins, back: r.back, resetTickets, packs: cart ? cart.packs : [], paid: r.paid, mode, startsAt: r.start, endsAt: r.until, me };
    },

    // VIP's free trial: VIP${trial level} for its days, once in a life, for
    // one who never had VIP. Days bought during it come after it, at the
    // player's own level (VIP0 at first); none bought, VIP simply ends.
    'POST /api/vip/trial': async (req, u) => {
      rate(limit.shop, u.id);
      const now = Date.now();
      const r = tx(() => {
        const cur = getUser(u.id);
        if (!canTrial(cur)) throw new ApiError(409, 'trial_used', 'VIPの無料お試しは、VIPを一度も使ったことがない人が1回だけ使えます');
        const until = now + VIP_RULES.trial.days * VIP.day;
        const s = settleJobs(cur, now);
        saveJobs(cur.id, s.jobs, s.pay);
        q('UPDATE users SET vip_until = ?, vip_trial_until = ?, rev = rev + 1 WHERE id = ?').run(until, until, cur.id);
        return { until, paid: s.pay };
      });
      if (r.paid) track(u.id, [['jobpay', r.paid]]);
      syncMilestones(u.id);
      return { until: r.until, paid: r.paid, me: meDto(balanceChanged(u.id)) };
    },

    /* ----- updates ----- */

    // The game in the browser says which release it is (js/game/news.js). An
    // older one is asked to update; the first time a player runs a new release
    // they are owed the thank-you money once for every release since the last
    // one they were thanked for: two updates at once pay twice (`updates`).
    // It arrives with the tap on the thanks (POST /api/release/claim). New
    // players start on the newest release.
    'POST /api/release': async (req, u) => {
      const body = await req.json();
      const theirs = Number(body.release) || 0;
      // (what the player's game runs, for the operator site)
      if (theirs > 0 && theirs < 1e6) {
        const build = /^[0-9a-f]{6,40}$/.test(String(body.build || '')) ? String(body.build) : '';
        q('UPDATE users SET client_release = ?, client_build = ?, client_at = ?, client_agent = ? WHERE id = ?')
          .run(theirs, build, Date.now(), String(req.header('user-agent') || '').slice(0, 300), u.id);
      }
      if (theirs < RELEASE) return { release: RELEASE, outdated: true, bonus: 0, updates: 0, released: releasedAt() };
      tx(() => {
        const cur = getUser(u.id);
        const n = RELEASE - cur.release_seen;
        if (n > 0) q('UPDATE users SET release_seen = ?, release_bonus = release_bonus + ? WHERE id = ?').run(RELEASE, n * RULES.updateBonus, cur.id);
      });
      // (still there after a reload, until it is tapped)
      const me = getUser(u.id);
      const bonus = me.release_bonus;
      return { release: RELEASE, outdated: false, bonus, updates: Math.round(bonus / RULES.updateBonus), me: meDto(me), released: releasedAt() };
    },

    // the tap on the thanks: the update money arrives
    'POST /api/release/claim': async (req, u) => {
      await req.json();
      const paid = tx(() => {
        const cur = getUser(u.id);
        if (!(cur.release_bonus > 0)) return 0;
        q('UPDATE users SET dollars = dollars + ?, release_bonus = 0, rev = rev + 1 WHERE id = ?').run(cur.release_bonus, cur.id);
        return cur.release_bonus;
      });
      return { paid, me: meDto(paid ? balanceChanged(u.id) : getUser(u.id)) };
    },

    /* ----- フレンド対決 ----- */

    'GET /api/battle': (req, u) => {
      const b = currentBattle(u.id);
      return { battle: b ? battleDto(b, u.id) : null };
    },

    // to a friend who is online: the same number of spins at one bet
    'POST /api/battle': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '相手');
      const spins = Number(body.spins), bet = Number(body.bet);
      if (!BT.spins.includes(spins)) throw new ApiError(400, 'bad_spins', '回数が正しくありません');
      if (!RULES.bets.includes(bet)) throw new ApiError(400, 'bad_bet', 'ベット額が正しくありません');
      const t = liveTarget(to);
      if (to === u.id || t.npc) throw new ApiError(400, 'bad_target', 'この相手とは対決できません');
      requireFriend(u, to, 'フレンド対決');
      if (!live.isOnline(to)) throw new ApiError(409, 'offline', `${t.name}さんは今オフラインです`);
      rate(limit.friend, u.id);
      if (currentBattle(u.id)) throw new ApiError(409, 'busy', '対決が終わってから申し込んでください');
      if (currentBattle(to)) throw new ApiError(409, 'busy_other', `${t.name}さんはほかの人と対決中です`);
      const id = Number(q('INSERT INTO battles (a_id, b_id, spins, bet, state, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(u.id, to, spins, bet, 'invite', Date.now()).lastInsertRowid);
      const b = battleById(id);
      live.send(to, 'battle', { type: 'invite', battle: battleDto(b, to) });
      return { battle: battleDto(b, u.id) };
    },

    'POST /api/battle/respond': async (req, u) => {
      const body = await req.json();
      const b = battleById(posInt(body.id, '対決'));
      if (!b || b.b_id !== u.id || b.state !== 'invite' || battleOver(b)) throw new ApiError(404, 'no_battle', 'この対決の申し込みはもうありません');
      if (!body.accept) {
        q("UPDATE battles SET state = 'declined', ended_at = ? WHERE id = ?").run(Date.now(), b.id);
        live.send(b.a_id, 'battle', { type: 'declined', battle: battleDto(battleById(b.id), b.a_id) });
        return { battle: null };
      }
      tx(() => {
        q("UPDATE battles SET state = 'live', started_at = ? WHERE id = ?").run(Date.now(), b.id);
        q('UPDATE users SET battle_id = ? WHERE id IN (?, ?)').run(b.id, b.a_id, b.b_id);
      });
      const started = battleById(b.id);
      live.send(b.a_id, 'battle', { type: 'start', battle: battleDto(started, b.a_id) });
      return { battle: battleDto(started, u.id) };
    },

    // taking an invitation back, saying no, or giving up (the friend wins)
    'POST /api/battle/quit': async (req, u) => {
      const body = await req.json();
      const b = battleById(posInt(body.id, '対決'));
      if (!b || (b.a_id !== u.id && b.b_id !== u.id)) throw new ApiError(404, 'no_battle', '対決が見つかりません');
      const other = b.a_id === u.id ? b.b_id : b.a_id;
      if (b.state === 'invite') {
        const state = u.id === b.a_id ? 'cancelled' : 'declined';
        q('UPDATE battles SET state = ?, ended_at = ? WHERE id = ?').run(state, Date.now(), b.id);
        live.send(other, 'battle', { type: state, battle: battleDto(battleById(b.id), other) });
      } else if (b.state === 'live') {
        finishBattle(b, u.id);
      }
      return { battle: null };
    },

    /* ----- 協力スロット ----- */

    'GET /api/coop': (req, u) => {
      const g = myGroup(u.id, posInt(req.query.get('group'), 'グループ'));
      return { coop: coopDto(g), seated: u.coop_group === g.id };
    },

    // sitting down at a group's table (one at a time), or getting up
    'POST /api/coop': async (req, u) => {
      const body = await req.json();
      const was = u.coop_group;
      if (!body.on) {
        q('UPDATE users SET coop_group = 0 WHERE id = ?').run(u.id);
        if (was) coopSend(was, { type: 'seat', group: was, user: mini(u), on: false });
        return { coop: null };
      }
      const g = myGroup(u.id, posInt(body.group, 'グループ'));
      q('UPDATE users SET coop_group = ? WHERE id = ?').run(g.id, u.id);
      if (was && was !== g.id) coopSend(was, { type: 'seat', group: was, user: mini(u), on: false });
      if (was !== g.id) {
        for (const p of coopPlayers(g.id)) if (p.id !== u.id) live.send(p.id, 'coop', { type: 'seat', group: g.id, user: mini(u), on: true });
      }
      return { coop: coopDto(g) };
    },

    /* ----- 友達と稼ぐ (hubs) ----- */

    // my hub (null: none) and the invitations waiting for me
    'GET /api/hub': (req, u) => ({ hub: myHub(u.id), invites: hubInvites(u.id) }),

    // to a friend who is online: they can join from the notice or the friend list
    'POST /api/hub/invite': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '相手');
      const t = liveTarget(to);
      if (to === u.id || t.npc) throw new ApiError(400, 'bad_target', 'この相手は招待できません');
      requireFriend(u, to, '友達と稼ぐ');
      touchActive(u.id, Date.now(), false);
      if (!live.isOnline(to)) throw new ApiError(409, 'offline', `${t.name}さんは今オフラインです`);
      rate(limit.friend, u.id);
      const h = playingHub(u.id);
      if (h) {
        const theirs = memberRow(to);
        if (theirs && theirs.hub_id === h.id) throw new ApiError(409, 'same', `${t.name}さんはもう一緒に稼いでいます`);
        if (hubMemberRows(h.id).length >= HUB.max) throw new ApiError(409, 'full', `ハブは満員です（最大${HUB.max}人）`);
      }
      const now = Date.now();
      if (isBlocked(to, u.id)) return { ok: true, until: now + HUB.inviteMs };
      q(`INSERT INTO hub_invites (from_id, to_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(from_id, to_id) DO UPDATE SET created_at = excluded.created_at`).run(u.id, to, now);
      live.send(to, 'hub', { type: 'invite', from: mini(u), size: h ? hubMemberRows(h.id).length : 1, until: now + HUB.inviteMs });
      phone(to, { kind: 'invite', title: '「一緒に稼ぐ」の招待', body: `${u.name}さんから「一緒に稼ぐ」の招待が届きました。10分以内に参加しよう！`, tag: `invite:${u.id}`, open: 'friends' });
      return { ok: true, until: now + HUB.inviteMs };
    },

    // accepting `from`'s invitation: into their hub, or a new one for the two
    // (one transaction: crossing invitations and players joining at once end up together)
    'POST /api/hub/join': async (req, u) => {
      const body = await req.json();
      const fromId = posInt(body.from, '招待');
      rate(limit.friend, u.id);
      touchActive(u.id, Date.now(), false);
      const t = liveTarget(fromId);
      const theirsNow = memberRow(fromId);
      if (theirsNow) settleHub(theirsNow.hub_id);
      const r = tx(() => {
        const inv = q('SELECT created_at FROM hub_invites WHERE from_id = ? AND to_id = ?').get(fromId, u.id);
        if (!inv || Date.now() - inv.created_at > HUB.inviteMs) throw new ApiError(404, 'no_invite', 'この招待はもう終わっています');
        if (!areFriends(u.id, fromId)) throw new ApiError(403, 'not_friends', 'フレンドの招待だけ受けられます');
        if (!live.isOnline(fromId)) throw new ApiError(409, 'offline', `${t.name}さんは今オフラインです`);
        q('DELETE FROM hub_invites WHERE from_id = ? AND to_id = ?').run(fromId, u.id);
        const mine = memberRow(u.id), theirs = memberRow(fromId);
        if (mine && theirs && mine.hub_id === theirs.hub_id) return { hubId: mine.hub_id, prev: 0, formed: false, same: true };
        let hubId = theirs ? theirs.hub_id : 0;
        if (hubId && hubMemberRows(hubId).length >= HUB.max) throw new ApiError(409, 'full', `${t.name}さんのハブは満員です（最大${HUB.max}人）`);
        const now = Date.now();
        const formed = !hubId;
        if (formed) {
          hubId = Number(q('INSERT INTO hubs (created_at) VALUES (?)').run(now).lastInsertRowid);
          q('INSERT INTO hub_members (user_id, hub_id, joined_at) VALUES (?, ?, ?)').run(fromId, hubId, now);
        }
        const prev = mine ? mine.hub_id : 0;
        if (prev) q('DELETE FROM hub_members WHERE user_id = ?').run(u.id);
        q('INSERT INTO hub_members (user_id, hub_id, joined_at) VALUES (?, ?, ?)').run(u.id, hubId, now + 1);
        return { hubId, prev, formed, same: false };
      });
      if (r.prev) {
        hubSend(r.prev, { type: 'leave', user: mini(u), why: 'moved' });
        settleHub(r.prev);
      }
      const dto = hubDto(hubRow(r.hubId));
      if (!r.same) {
        hubSend(r.hubId, { type: 'join', user: mini(u), hub: dto }, u.id);
        track(u.id, [['hub', 1]]);
        if (r.formed) track(fromId, [['hub', 1]]);
      }
      return { hub: { ...dto, noVoice: noVoiceIn(r.hubId, u.id) } };
    },

    // saying no to an invitation (its sender hears it)
    'POST /api/hub/decline': async (req, u) => {
      const body = await req.json();
      const fromId = posInt(body.from, '招待');
      const r = q('DELETE FROM hub_invites WHERE from_id = ? AND to_id = ?').run(fromId, u.id);
      if (Number(r.changes) > 0) live.send(fromId, 'hub', { type: 'declined', by: mini(u) });
      return { invites: hubInvites(u.id) };
    },

    // leaving (the small 抜ける button): the others play on (a hub with one player left closes)
    'POST /api/hub/leave': (req, u) => {
      dropFromHub(u.id);
      return { hub: null };
    },

    // 即席チャット: a line to someone in my hub (from their icon); the game
    // keeps it only on the screen, the server's record keeps it for good
    'POST /api/hub/say': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const text = cleanText(body.text, 200);
      const a = memberRow(u.id), b = memberRow(to);
      if (!a || !b || a.hub_id !== b.hub_id || to === u.id) throw new ApiError(409, 'not_hub', '同じ「友達と稼ぐ」にいる人にだけ送れます');
      chatAllowed(u);
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      touchActive(u.id, Date.now(), false);
      const f = filterText(text);
      detected(u, f, { to, place: 'hub', original: text });
      const line = { from: mini(u), to, text: f.masked, at: Date.now() };
      keepLive('hub', a.hub_id, u.id, to, line.text, text, line.at);
      if (!isBlocked(to, u.id) && !isBlocked(u.id, to)) live.send(to, 'hub', { type: 'say', ...line });
      track(u.id, [['chat', 1]]);
      return { line };
    },

    // the activity beat (time quests), when there is no WebSocket to send it on
    'POST /api/beat': async (req, u) => beat(u, await req.json()),

    /* ----- 運営へのフィードバック ----- */

    // stars (any of them may be left out) and a comment of any length
    'POST /api/feedback': async (req, u) => {
      const body = await req.json(1024 * 1024);
      const raw = body.ratings && typeof body.ratings === 'object' ? body.ratings : {};
      const ratings = {};
      for (const k of FEEDBACK_KEYS) {
        const v = Number(raw[k] || 0);
        if (!Number.isInteger(v) || v < 0 || v > 5) throw new ApiError(400, 'bad_rating', '評価は星1〜5で選んでください');
        ratings[k] = v;
      }
      const comment = String(body.comment ?? '').trim() ? cleanText(body.comment, FEEDBACK_MAX) : '';
      if (!comment && !Object.values(ratings).some((v) => v > 0)) throw new ApiError(400, 'empty', '星をつけるか、コメントを書いてください');
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      tx(() => {
        q('INSERT INTO feedback (user_id, ratings, comment, created_at) VALUES (?, ?, ?, ?)').run(u.id, JSON.stringify(ratings), comment, Date.now());
        q('UPDATE users SET feedback = 2 WHERE id = ?').run(u.id);
      });
      // (read on the operator site now, not by an account in the game)
      return { me: meDto(getUser(u.id)) };
    },

    // the answers (the operator site shows them now: GET /api/ops/feedback)
    'GET /api/feedback': (req, u) => {
      if (!ops.isOperator(u)) throw new ApiError(403, 'forbidden', 'このページは見られません');
      const rows = q(`SELECT f.id, f.ratings, f.comment, f.created_at, o.id AS uid, o.name, o.avatar FROM feedback f
                      LEFT JOIN users o ON o.id = f.user_id ORDER BY f.id DESC LIMIT 500`).all();
      const list = rows.map((r) => ({ id: r.id, user: { id: r.uid, name: r.name, avatar: r.avatar }, ratings: readRatings(r.ratings), comment: r.comment, at: r.created_at }));
      const average = {};
      for (const k of FEEDBACK_KEYS) {
        const v = list.map((f) => f.ratings[k]).filter((x) => x > 0);
        average[k] = v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
      }
      return { feedback: list, count: feedbackCount(), average };
    },

    /* ----- the age check, presents, 通報, 報告 / 意見案 ----- */

    // 18歳以上？ answered once (nothing is limited by it for now)
    'POST /api/age': async (req, u) => {
      const body = await req.json();
      if (typeof body.adult !== 'boolean') throw new ApiError(400, 'bad_answer', '「はい」か「いいえ」を選んでください');
      q('UPDATE users SET age_ok = ?, age_at = ? WHERE id = ? AND age_ok IS NULL').run(body.adult ? 1 : 0, Date.now(), u.id);
      return { me: meDto(getUser(u.id)) };
    },

    // a present in the chat: paid now, worth its price to the friend who taps it
    'POST /api/present': async (req, u) => {
      const body = await req.json();
      const to = posInt(body.to, '宛先');
      const p = RULES.presents.find((x) => x.id === String(body.id || ''));
      if (!p) throw new ApiError(400, 'bad_present', 'プレゼントを選んでください');
      if (to === u.id) throw new ApiError(400, 'self', '自分には贈れません');
      const t = liveTarget(to);
      if (t.npc) throw new ApiError(400, 'npc', `${t.name}には贈れません`);
      requireFriend(u, to, 'プレゼントを贈れるように');
      rate(limit.transfer, u.id, '続けて贈れません。少し待ってください');
      const held = isBlocked(to, u.id);
      const m = tx(() => {
        const cur = getUser(u.id);
        if (cur.dollars < p.price) throw new ApiError(409, 'insufficient', '$が足りません');
        q('UPDATE users SET dollars = dollars - ?, rev = rev + 1 WHERE id = ?').run(p.price, u.id);
        const row = insertMessage({ channel: dmChannel(u.id, to), sender: u, recipient: to, kind: 'present', body: p.id, amount: p.price, currency: 'dollars', held });
        if (held) touchOwn(u.id, to, row.id);
        else touchConversations(u.id, to, row.id);
        return row;
      });
      track(u.id, [['sent', p.price], ['snowman', p.id === 'snowman' ? 1 : 0]]);
      balanceChanged(u.id);
      const message = held ? sendOwn(m, u.id) : deliverDm(m, u.id, to);
      afterSpend(u.id);
      return { balance: balance(getUser(u.id)), message };
    },

    // the friend taps the present: once, its price comes in
    'POST /api/present/claim': async (req, u) => {
      const body = await req.json();
      const id = posInt(body.message, 'プレゼント');
      const r = tx(() => {
        const m = q('SELECT * FROM messages WHERE id = ?').get(id);
        if (!m || m.kind !== 'present' || m.recipient_id !== u.id || m.held) throw new ApiError(404, 'no_present', 'このプレゼントは受け取れません');
        if (m.claimed_at) throw new ApiError(409, 'claimed', 'このプレゼントはもう受け取りました');
        if (RECEIPTS.expired(m)) throw new ApiError(410, 'expired', 'プレゼントの受け取り期限が過ぎています');
        q('UPDATE messages SET claimed_at = ? WHERE id = ? AND claimed_at = 0').run(Date.now(), m.id);
        q('UPDATE users SET dollars = dollars + ?, rev = rev + 1 WHERE id = ?').run(m.amount, u.id);
        q('INSERT INTO transfers (from_id, to_id, currency, amount, created_at) VALUES (?, ?, ?, ?, ?)').run(m.sender_id, u.id, 'dollars', m.amount, Date.now());
        return q('SELECT m.*, s.name AS sender_name, s.avatar AS sender_avatar FROM messages m LEFT JOIN users s ON s.id = m.sender_id WHERE m.id = ?').get(m.id);
      });
      balanceChanged(u.id);
      const dto = msgDto(r);
      // both ends see it was received (on every device)
      live.send(r.sender_id, 'present', { id: r.id, claimed: true, by: u.id });
      live.send(u.id, 'present', { id: r.id, claimed: true, by: u.id });
      return { paid: r.amount, balance: balance(getUser(u.id)), message: dto };
    },

    // 通報: friends or not (from a profile, a hub, the search); everything
    // the operators need goes with it
    'POST /api/report': async (req, u) => {
      const body = await req.json(SEND_BYTES);
      const id = posInt(body.user, 'プレイヤー');
      if (id === u.id) throw new ApiError(400, 'self', '自分は通報できません');
      const t = getUser(id);
      if (!t) throw new ApiError(404, 'not_found', 'プレイヤーが見つかりません');
      if (t.npc) throw new ApiError(400, 'npc', `${t.name}は通報できません`);
      const kind = RULES.reportKinds.find((k) => k.id === String(body.kind || ''));
      if (!kind) throw new ApiError(400, 'bad_kind', '通報の種類を選んでください');
      const text = String(body.text ?? '').trim() ? sendText(body.text) : '';
      if (!text) throw new ApiError(400, 'empty', 'どのようなトラブルがあったか書いてください');
      rate(limit.friend, u.id, '通報が続いています。少し待ってからお試しください');
      const R = RULES.report;
      if (q('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?').get(u.id, Date.now() - 3600000).n >= R.perHour) {
        throw new ApiError(429, 'report_limit', `通報は1時間に${R.perHour}件までです`);
      }
      const place = ['profile', 'hub', 'search', 'chat'].includes(body.place) ? body.place : 'profile';
      const ma = memberRow(u.id), mb = memberRow(t.id);
      const recent = q(`SELECT m.*, s.name AS sender_name FROM messages m LEFT JOIN users s ON s.id = m.sender_id WHERE m.channel = ?
                        ORDER BY m.id DESC LIMIT 30`).all(dmChannel(u.id, t.id)).reverse()
        .map((m) => ({ id: m.id, from: m.sender_name, kind: m.kind, text: m.body, amount: m.amount, at: m.created_at }));
      const context = {
        target: {
          id: t.id, name: t.name, level: LEVEL.of(t.xp), dollars: t.dollars, tokens: t.tokens, createdAt: t.created_at, lastSeen: t.last_seen,
          online: live.isOnline(t.id), banned: !!t.banned, age: t.age_ok === null ? null : !!t.age_ok
        },
        friends: areFriends(u.id, t.id),
        sameHub: !!(ma && mb && ma.hub_id === mb.hub_id),
        hub: mb ? mb.hub_id : 0,
        messages: recent,
        detections: q('SELECT original, place, created_at FROM detections WHERE sender_id = ? ORDER BY id DESC LIMIT 10').all(t.id),
        request: { ip: req.ip || '', userAgent: String(req.header('user-agent') || '').slice(0, 300) }
      };
      q(`INSERT INTO reports (reporter_id, target_id, kind, body, place, context, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(u.id, t.id, kind.id, text, place, JSON.stringify(context), Date.now());
      official.pay(u.id, R.reward);
      opsLog.add({ actor: u, action: 'player_report', target: t, req, summary: `${u.name}さんが${t.name}さんを通報（${kind.name}）`, detail: { kind: kind.id, place, text } });
      return { ok: true, reward: R.reward, message: '今後このようなトラブルがないよう気を付けます。' };
    },

    // 通報 of one message (the ⋯ under someone else's message): what it said
    // and the conversation around it go to the operators (MESSAGE_REPORT: so
    // many a day from 6:00 Japan time, so many characters). Paid by the
    // operators if they accept it (POST /api/ops/report), not at once.
    'POST /api/report/message': async (req, u) => {
      const body = await req.json(SEND_BYTES);
      const m = q('SELECT * FROM messages WHERE id = ?').get(posInt(body.message, 'メッセージ'));
      const group = m && m.channel.startsWith('group:') ? Number(m.channel.slice(6)) : 0;
      // one sent to this player (or to a group they are in), not their own
      const theirs = m && m.sender_id && m.sender_id !== u.id && (group
        ? !!q('SELECT 1 AS x FROM chat_members WHERE group_id = ? AND user_id = ?').get(group, u.id)
        : m.recipient_id === u.id && !m.held);
      const t = theirs ? getUser(m.sender_id) : null;
      if (!t || t.npc) throw new ApiError(404, 'not_found', 'このメッセージは通報できません');
      const kind = RULES.reportKinds.find((k) => k.id === String(body.kind || ''));
      if (!kind) throw new ApiError(400, 'bad_kind', '通報の種類を選んでください');
      const raw = String(body.text ?? '');
      if (Array.from(raw).length > MESSAGE_REPORT.chars) throw new ApiError(413, 'too_large', `通報の内容は${MESSAGE_REPORT.chars}文字までです`);
      const text = raw.trim() ? cleanText(raw, MESSAGE_REPORT.chars) : '';
      rate(limit.friend, u.id, '通報が続いています。少し待ってからお試しください');
      if (q('SELECT 1 AS x FROM reports WHERE reporter_id = ? AND message_id = ?').get(u.id, m.id)) throw new ApiError(409, 'reported', 'このメッセージはもう通報しました');
      const today = q('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND message_id > 0 AND created_at >= ?').get(u.id, nextLoginReset() - 86400000).n;
      if (today >= MESSAGE_REPORT.perDay) throw new ApiError(429, 'report_limit', `メッセージの通報は1日${MESSAGE_REPORT.perDay}件までです（毎朝6:00にリセット）`);
      // the conversation around it, 10 before and 10 after (what was taken back too, with what it said)
      const sel = 'SELECT m.*, s.name AS sender_name FROM messages m LEFT JOIN users s ON s.id = m.sender_id WHERE m.channel = ?';
      const around = [
        ...q(`${sel} AND m.id < ? ORDER BY m.id DESC LIMIT 10`).all(m.channel, m.id).reverse(),
        { ...m, sender_name: t.name },
        ...q(`${sel} AND m.id > ? ORDER BY m.id LIMIT 10`).all(m.channel, m.id)
      ].map((r) => ({
        id: r.id, from: r.sender_id ? { id: r.sender_id, name: r.sender_name } : null, kind: r.kind, text: r.body, amount: r.amount, currency: r.currency,
        retracted: r.retracted_at || 0, at: r.created_at, reported: r.id === m.id
      }));
      const g = group ? q('SELECT id, name FROM chat_groups WHERE id = ?').get(group) : null;
      const context = {
        message: { id: m.id, text: m.body, retracted: m.retracted_at || 0, at: m.created_at, channel: m.channel },
        around,
        group: g ? { id: g.id, name: g.name, members: memberIds(g.id).length } : null,
        target: {
          id: t.id, name: t.name, level: LEVEL.of(t.xp), dollars: t.dollars, tokens: t.tokens, createdAt: t.created_at, lastSeen: t.last_seen,
          online: live.isOnline(t.id), banned: !!t.banned, chatBan: !!t.chat_ban, age: t.age_ok === null ? null : !!t.age_ok
        },
        friends: areFriends(u.id, t.id),
        detections: q('SELECT original, place, created_at FROM detections WHERE sender_id = ? ORDER BY id DESC LIMIT 10').all(t.id),
        request: { ip: req.ip || '', userAgent: String(req.header('user-agent') || '').slice(0, 300) }
      };
      q('INSERT INTO reports (reporter_id, target_id, kind, body, place, context, created_at, message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(u.id, t.id, kind.id, text, 'message', JSON.stringify(context), Date.now(), m.id);
      opsLog.add({
        actor: u, action: 'player_report', target: t, req, summary: `${u.name}さんが${t.name}さんのメッセージを通報（${kind.name}）`,
        detail: { kind: kind.id, place: 'message', messageId: m.id, message: m.body, text }
      });
      return { ok: true, left: MESSAGE_REPORT.perDay - today - 1, message: '通報を受け付けました。運営が前後の会話も含めて確認します。' };
    },

    // 報告 (a bug, an error, something odd) and 意見案 (an idea): to the
    // operators, of any length, shown in the chat with the official bot too
    'POST /api/official/feedback': async (req, u) => {
      const body = await req.json(SEND_BYTES);
      const kind = body.kind === 'idea' ? 'idea' : body.kind === 'bug' ? 'bug' : '';
      if (!kind) throw new ApiError(400, 'bad_kind', '報告か意見案を選んでください');
      const text = String(body.text ?? '').trim() ? sendText(body.text) : '';
      if (!text) throw new ApiError(400, 'empty', '内容を書いてください');
      rate(limit.dm, u.id, '連続して送信できません。少し待ってください');
      const I = RULES.idea;
      if (kind === 'idea' && q("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND kind = 'idea' AND created_at >= ?").get(u.id, nextUtcMidnight() - 86400000).n >= I.perDay) {
        throw new ApiError(429, 'idea_limit', `意見案は1日${I.perDay}件までです`);
      }
      q("INSERT INTO feedback (user_id, ratings, comment, kind, created_at) VALUES (?, '{}', ?, ?, ?)").run(u.id, text, kind, Date.now());
      opsLog.add({ actor: u, action: 'player_feedback', req, summary: `${u.name}さんから${kind === 'bug' ? '報告' : '意見案'}`, detail: { kind, text } });
      return { message: official.fromPlayer(u, `【${kind === 'bug' ? '報告' : '意見案'}】\n${text}`) };
    },

    /* ----- phone notifications ----- */

    'GET /api/push/key': async (req, u) => ({ key: await push.publicKey(), on: push.has(u.id) }),
    // a browser's subscription (PushSubscription.toJSON()); only the push services' own addresses
    'POST /api/push/subscribe': async (req, u) => {
      const body = await req.json(8192);
      const endpoint = String(body.endpoint || '');
      const keys = body.keys && typeof body.keys === 'object' ? body.keys : {};
      let host = '';
      try { const e = new URL(endpoint); host = e.protocol === 'https:' ? e.hostname : ''; } catch { host = ''; }
      if (!PUSH_HOSTS.test(host) || endpoint.length > 2000 || !/^[\w-]{40,200}$/.test(String(keys.p256dh || '')) || !/^[\w-]{10,64}$/.test(String(keys.auth || ''))) {
        throw new ApiError(400, 'bad_subscription', 'この端末では通知を登録できませんでした');
      }
      push.subscribe(u.id, { endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth) }, String(req.header('origin') || ''));
      // a few devices a player: the oldest go
      const extra = q('SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 8').all(u.id);
      for (const r of extra) q('DELETE FROM push_subs WHERE endpoint = ?').run(r.endpoint);
      return { ok: true };
    },
    'POST /api/push/unsubscribe': async (req, u) => {
      const body = await req.json(8192);
      push.unsubscribe(u.id, String(body.endpoint || ''));
      return { ok: true, on: push.has(u.id) };
    },
    // the game went out of sight (or came back)
    'POST /api/sight': async (req, u) => seeing(u, await req.json()),

    // (each connection also notes the device the account is used on)
    'POST /api/stream-ticket': (req, u) => {
      seenOn(u.id, req);
      return { ticket: signTicket(secret, u.id) };
    }
  };

  // Voice signalling of the home call: a player and the watchers they talk
  // with (type "home"; everyone in that voice can reach everyone else), and of
  // a hub (type "hub": everyone in it). Used by POST /api/call and by the
  // WebSocket.
  function relayCall(u, body) {
    const type = String(body.type || '');
    if (!CALL_TYPES.has(type)) throw new ApiError(400, 'bad_type', '通話の操作が正しくありません');
    const callId = String(body.callId || '');
    if (!/^[\w-]{6,64}$/.test(callId)) throw new ApiError(400, 'bad_call', '通話IDが正しくありません');
    const to = posInt(body.to, '宛先');
    liveTarget(to);
    rate(limit.call, u.id);
    const room = Number(body.data && body.data.room);
    if (type === 'hub') {
      const a = memberRow(u.id), b = memberRow(to);
      if (!room || !a || !b || a.hub_id !== room || b.hub_id !== room) throw new ApiError(409, 'not_hub', 'ハブで話せる相手ではありません');
      // a block cuts the voice both ways (they stay in the hub), without a word
      // to the one who was blocked: their call just never connects
      if (isBlocked(to, u.id) || isBlocked(u.id, to)) return;
    } else if (!room || !inVoice(u.id, room) || !inVoice(to, room)) {
      throw new ApiError(409, 'not_home', 'ホームで話せる相手ではありません');
    }
    live.send(to, 'call', { type, callId, from: mini(u), data: body.data ?? null });
    // someone calling a player whose game is out of sight: their phone rings (once in two minutes)
    if (body.data && body.data.op === 'hello' && !body.data.reply) {
      phone(to, { kind: 'call', title: `${u.name}さんから通話`, body: type === 'hub' ? '「一緒に稼ぐ」の通話であなたを呼んでいます' : 'ホームの通話であなたを呼んでいます', tag: `call:${u.id}`, open: 'slot' }, 120000);
    }
    // quests: 友達に電話をかけてみる (calling into the home or the hub), 友達と
    // 話す（通話） (two people in a home or a hub whose voices are connecting)
    const op = body.data && body.data.op;
    if (op === 'hello' && !body.data.reply) track(u.id, [['call', 1]]);
    else if (op === 'hello') {
      track(u.id, [['talk', 1]]);
      track(to, [['talk', 1]]);
    }
  }

  // 入力中 (typing): to the friend of a conversation, or everyone else in a group.
  function relayTyping(u, body) {
    rate(limit.typing, u.id);
    if (body.group !== undefined && body.group !== null) {
      const g = myGroup(u.id, posInt(body.group, 'グループ'));
      for (const id of memberIds(g.id)) if (id !== u.id) live.send(id, 'typing', { group: g.id, from: mini(u) });
      return;
    }
    const to = posInt(body.to, '宛先');
    if (areFriends(u.id, to)) live.send(to, 'typing', { from: mini(u) });
  }

  // Signalling and typing over the WebSocket (no HTTP request per message): errors are dropped.
  function fromSocket(fn) {
    return (userId, body) => {
      stats.wsIn();
      emergency.wsIn();
      try {
        const u = getUser(userId);
        if (u && !u.banned) fn(allowed(u), body);
      } catch (e) {
        if (!(e instanceof ApiError)) console.error(e);
      }
    };
  }
  const socketCall = fromSocket(relayCall);
  const socketTyping = fromSocket(relayTyping);
  const socketBeat = fromSocket(beat);
  const socketSight = fromSocket(seeing);

  // Friendship both ways, the request(s) gone, a note in their conversation.
  function makeFriends(requester, accepter) {
    const m = tx(() => {
      const now = Date.now();
      q('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(requester.id, accepter.id, accepter.id, requester.id);
      q('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(requester.id, accepter.id, now);
      q('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(accepter.id, requester.id, now);
      const row = insertMessage({ channel: dmChannel(requester.id, accepter.id), sender: null, kind: 'system', body: 'フレンドになりました！' });
      touchConversations(requester.id, accepter.id, row.id, requester.id);
      return row;
    });
    live.send(requester.id, 'friend', { type: 'accepted', user: mini(accepter) });
    live.send(accepter.id, 'friend', { type: 'added', user: mini(requester), pending: pendingRequests(accepter.id) });
    const dto = msgDto(m);
    live.send(requester.id, 'msg', { ...dto, to: requester.id, peer: accepter.id, unread: unreadTotal(requester.id) });
    live.send(accepter.id, 'msg', { ...dto, to: accepter.id, peer: requester.id });
    // quests: 友達を追加する (both of them)
    track(requester.id, [['friend', 1]]);
    track(accepter.id, [['friend', 1]]);
    return { pending: pendingRequests(accepter.id) };
  }

  // Returns true when there was a friendship to end.
  function unfriend(a, b) {
    return tx(() => {
      const r = q('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').run(a, b, b, a);
      q('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(a, b, b, a);
      q('DELETE FROM watchers WHERE (watcher_id = ? AND target_id = ?) OR (watcher_id = ? AND target_id = ?)').run(a, b, b, a);
      return Number(r.changes) > 0;
    });
  }

  // the operator site (/ops/); the developer code is checked in one place
  // (its wrong tries are counted together for the site and the vault)
  const devCode = createDevCode({ q, opsLog });
  // the security shield (server/core/shield.js), the emergency stop and the
  // lockdown (server/core/emergency.js). The shield can call for the lockdown,
  // which needs the shield's forensics and a protective backup, so the three
  // know one another through late-bound references.
  let emergencyRef = null, backupRef = null;
  const shield = createShield({
    q, config, opsLog, clock: config.clock || Date.now,
    onBreach: (info) => { if (emergencyRef) emergencyRef.breach(info); },
    // a vault's pieces: many a second at full speed, under their own limit (each operator, signed in)
    bulk: (req) => VAULT_BULK.has(`${req.method} ${req.path}`) && /^Bearer /.test(String(req.header('authorization') || ''))
  });
  const emergency = createEmergency({
    q, config, opsLog, devCode, isDeveloper, getUser, clock: config.clock || Date.now,
    shield, verifyLog: () => opsLog.verify(), protect: () => (backupRef ? backupRef.lockdownBackup() : null), defer: defer || ((p) => p),
    host: { dbBytes: host && host.dbBytes ? host.dbBytes : null, stop: () => { if (host && host.stop) host.stop(); } }
  });
  emergencyRef = emergency;
  Object.assign(routes, emergency.routes);
  // when each operator last used the site (who is on it now, and 最終オンライン:
  // kept in the database at most once a minute)
  const seenAt = new Map();
  try {
    const row = q("SELECT value FROM meta WHERE key = 'ops_seen'").get();
    for (const [id, at] of Object.entries(row ? JSON.parse(row.value) : {})) seenAt.set(Number(id), Number(at));
  } catch { /* from now on */ }
  let seenSaved = 0;
  const opsSeen = {
    get: (id) => seenAt.get(id),
    set(id, at) {
      seenAt.set(id, at);
      if (at - seenSaved < 60000) return;
      seenSaved = at;
      q("INSERT INTO meta (key, value) VALUES ('ops_seen', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(Object.fromEntries(seenAt)));
    }
  };
  const ops = createOps({
    q, tx, live, config, getUser, mini, openCode: (s) => openText(CODE_KEY, s), setRecovery, banMessage, BAN_DAYS, deviceBanOf, deviceBans, dropFromHub,
    official, opsLog, balance, banState, tellBanned, liftBan, DEVICE_BANNED, isDeveloper, devCode, seen: opsSeen
  });
  Object.assign(routes, ops.routes);
  // the operator site's ログインログ (the day's ログイン button; the developer's alone to read)
  const opsEntry = createOpsEntry({ q, getUser, see: ops.see, isOperator: ops.isOperator, isDeveloper });
  Object.assign(routes, opsEntry.routes);
  const opsMe = routes['GET /api/ops/me'];
  routes['GET /api/ops/me'] = (req, u) => ({ ...opsMe(req, u), ...opsEntry.state(u) });
  // the operator site's own login (two wrong tries: a wait that doubles); while stopped, the developer's only
  const opsLogin = createOpsLogin({
    q, findByName, isOperator: ops.isOperator, isViewer: ops.isViewer, createSession, seenOn, entered: opsEntry.record,
    rate: (req) => rate(limit.login, req.ip, '試行回数が多すぎます。しばらく待ってからお試しください'),
    // during a lockdown the operators still come in to reach the security base;
    // during a plain emergency stop, only the developer
    allow: (u) => emergency.locked() || !emergency.stopped() || isDeveloper(u), stoppedBody: () => emergency.body()
  });
  Object.assign(routes, opsLogin.routes);
  // 運営チャット
  // @開発者 in the 運営チャット: the developer hears of it at once — on the
  // operator site (its live connection), on their phone (unless the game is
  // in sight) and on Discord
  function callDeveloper(u, m, to) {
    const dev = findByName(config.developer);
    if (!dev) return;
    const text = String(m.text).replace(/@\[(p|log):\d+\]/g, '…').replace(/@\[dev\]/g, '@開発者').slice(0, 140);
    live.sendOps(dev.id, 'opsping', { from: mini(u), to, text, id: m.id });
    phone(dev.id, { kind: 'ops', title: `${u.name}さんが運営チャットで開発者を呼んでいます`, body: text, tag: `opsping:${u.id}`, open: 'ops' }, 30000);
    discord.say('📣', `${u.name}が運営チャット（${to ? '個人チャット' : '全体チャット'}）で開発者を呼んでいます：${text}`);
  }
  const team = createTeam({ q, getUser, live, ops, seen: opsSeen, isDeveloper, callDeveloper, ice: () => iceServers() });
  Object.assign(routes, team.routes);
  // the operator site's live connection: a ticket of its own (an operator's)
  routes['POST /api/ops/live-ticket'] = (req, u) => {
    ops.need(u);
    return { ticket: signTicket(opsSecret, u.id) };
  };
  // 金の生る木
  const trees = createTrees({ q, tx, getUser, balance, balanceChanged });
  Object.assign(routes, trees.routes);
  // 開発者支援 (real money for ロイヤルコイン), the developer's vault and the ones operators share
  const pay = createPay({ q, tx, live, config, getUser, balanceChanged, official, opsLog, isDeveloper });
  Object.assign(routes, pay.routes);
  // (the bucket's operations counted: R2 bills writes and lists, and reads)
  const bucket = blobs && {
    put: (...a) => { stats.r2('a'); return blobs.put(...a); },
    get: (...a) => { stats.r2('b'); return blobs.get(...a); },
    list: (...a) => { stats.r2('a'); return blobs.list(...a); },
    del: (...a) => blobs.del(...a)
  };
  const vault = createVault({ q, tx, config, secret, opsLog, isDeveloper, devCode, ops, getUser, blobs: bucket, onDb: (n) => emergency.vaultDb(n) });
  Object.assign(routes, vault.routes);
  // the developer's backups of everything but the vault
  const backup = createBackup({
    q, tx, opsLog, devCode, isDeveloper, exportAll: () => admin.export(), blobs: bucket, secret,
    // (a new schedule: the host's housekeeping comes sooner if need be)
    onChange: () => { if (host && host.reschedule) host.reschedule(nextHousekeeping()); }
  });
  Object.assign(routes, backup.routes);
  backupRef = backup;
  const operatorsOnlineNow = () => { const now = Date.now(); return ops.operatorList().filter((o) => o.operator && o.id && now - (opsSeen.get(o.id) || 0) < 40000).length; };
  // the operator site's サーバー tab (every operator)
  routes['GET /api/ops/server'] = (req, u) => {
    ops.see(u);
    return { ...stats.snapshot({ online: live.onlineCount(), operatorsOnline: operatorsOnlineNow(), vault: vault.summary() }), discord: { on: discord.on } };
  };
  // the developer tries the Discord notices: one goes out at once
  routes['POST /api/ops/discord/test'] = async (req, u) => {
    ops.need(u);
    if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', 'この操作は開発者だけができます');
    await req.json();
    if (!discord.on) throw new ApiError(409, 'not_set', 'Discord の Webhook（DISCORD_WEBHOOK_URL）が設定されていないか、形が正しくありません');
    noteHost(req);
    discord.say('🔔', `テスト通知です（運営サイトから ${u.name} が送信）`);
    const ok = await discord.flush();
    opsLog.add({ actor: u, action: 'discord_test', req, summary: `${u.name}が Discord 通知をテスト送信（${ok ? '届いた' : '送れなかった'}）` });
    if (!ok) throw new ApiError(502, 'discord_failed', 'Discord に送れませんでした。Webhook の URL が正しいか、Discord 側で消されていないか確かめてください');
    return { ok: true };
  };
  // the operator site's セキュリティ tab (every operator): the shield and the
  // emergency/lockdown state; and the operators' actions on attacks that did
  // not reach the lockdown — blocking an address, account or device, or
  // lifting one (manual blocks are logged)
  routes['GET /api/ops/security'] = (req, u) => {
    ops.see(u);
    return { shield: shield.snapshot(), emergency: emergency.info(), now: Date.now() };
  };
  routes['POST /api/ops/security/block'] = async (req, u) => {
    ops.need(u);
    const b = await req.json();
    const row = shield.block(String(b.scope || ''), b.target, b.reason, u, req);
    return { ok: true, block: { ...row, manual: !!row.manual } };
  };
  routes['POST /api/ops/security/unblock'] = async (req, u) => {
    ops.need(u);
    const b = await req.json();
    return { ok: shield.unblock(String(b.key || ''), u, req) };
  };
  // the security base (/sec/): the operators' final safety base
  const health = () => ({
    online: live.onlineCount(), operatorsOnline: operatorsOnlineNow(),
    sockets: host && host.sockets ? host.sockets() : null, dbBytes: host && host.dbBytes ? host.dbBytes() : null,
    quota: quota.on ? quota.state() : null, outbound: emergency.outboundAllowed(), startedAt: stats.startedAt || 0, host: (host && host.name) || 'node'
  });
  const sec = createSec({ q, getUser, ops, emergency, shield, opsLog, health, secret, isDeveloper, live, seen: opsSeen });
  Object.assign(routes, sec.routes);

  const PUBLIC = new Set(['GET /api/health', 'GET /api/name-check', 'POST /api/register', 'POST /api/login', 'GET /api/ban', 'POST /api/ops/login', ...pay.public, ...vault.public]);

  /* ---------------------------------------------------------------- live connection hooks */

  // First payload of a live connection.
  function hello(userId) {
    const bonus = loginBonus(userId);
    try { accessDayGifts(userId); } catch (e) { console.error('access days', e); }
    syncMilestones(userId);
    const u = getUser(userId);
    return {
      loginBonus: bonus,
      loginReset: nextLoginReset(),
      me: meDto(u), unread: unreadTotal(userId), friendRequests: pendingRequests(userId), iconShop: iconShop(), itemShop: itemShop(),
      peter: peter.me(), johnson: johnson.me(), official: official.me(), online: live.onlineCount(),
      hub: myHub(userId), hubInvites: hubInvites(userId)
    };
  }

  function presence(userId, online) {
    live.broadcast('presence', { id: userId, online, count: live.onlineCount() });
    // in a hub the others see who is connected (nobody leaves by going away)
    const hm = memberRow(userId);
    if (hm) {
      const me = getUser(userId);
      if (me) hubSend(hm.hub_id, { type: online ? 'back' : 'away', user: mini(me) }, userId);
    }
    if (online) {
      // back: ジョンソン's gift may be due; nearly broke, the NPCs have something to say
      try { afterSpend(userId); } catch (e) { console.error('npc', e); }
      return;
    }
    // 最終オンライン: the moment they left (the time since their last request was play)
    const now = Date.now();
    const me = getUser(userId);
    if (me && now - me.last_seen > 5000) {
      q('UPDATE users SET last_seen = ?, play_ms = play_ms + ? WHERE id = ?').run(now, now - me.last_seen < SESSION_GAP ? now - me.last_seen : 0, userId);
    }
    // a player who left stops watching, and the rest of that home is told
    // (their voice is kept for a while in case the connection just dropped)
    const row = q('SELECT target_id, voice FROM watchers WHERE watcher_id = ?').get(userId);
    if (row) {
      if (row.voice) voiceKept.set(`${row.target_id}:${userId}`, now + 10 * 60000);
      q('DELETE FROM watchers WHERE watcher_id = ?').run(userId);
      if (me) homeChanged(row.target_id, mini(me), false);
    }
    // their own home closes
    notifyWatchers(userId, { type: 'offline', user: userId });
    q('DELETE FROM watchers WHERE target_id = ?').run(userId);
    homeChats.delete(userId);
  }

  // Periodic clean-up: old spin records, stale sessions and watchers.
  function housekeeping() {
    // the lockdown lifts itself after a month; during one the server does no
    // clean-up and no outbound work — it protects the data and stays still
    emergency.tick();
    if (emergency.locked()) return Promise.resolve();
    try {
      q('DELETE FROM spins WHERE created_at < ?').run(Date.now() - 30 * 86400000);
      shield.prune();
      q('DELETE FROM sessions WHERE last_used < ?').run(Date.now() - 365 * 86400000);
      q('DELETE FROM watchers WHERE since < ?').run(Date.now() - 12 * 3600000);
      // rented cars: their customers counted, the ones asked back home again
      for (const c of q('SELECT * FROM cars WHERE rent_start > 0').all()) tx(() => settleRental(c));
      // アクセス禁止 and BAN that have run out (the official bot tells the player)
      for (const b of q('SELECT * FROM users WHERE banned = 1 AND ban_until > 0 AND ban_until <= ?').all(Date.now())) liftBan(b, 'expired');
      // 観戦ベット whose player stopped spinning: the stake goes back
      for (const b of q("SELECT * FROM watch_bets WHERE state = 'open' AND created_at < ?").all(Date.now() - WB.refundMs)) {
        tx(() => {
          q("UPDATE watch_bets SET state = 'refunded', paid = stake, ended_at = ? WHERE id = ?").run(Date.now(), b.id);
          q('UPDATE users SET tokens = tokens + ?, rev = rev + 1 WHERE id = ?').run(b.stake, b.watcher_id);
        });
        balanceChanged(b.watcher_id);
      }
      for (const b of q("SELECT * FROM battles WHERE state IN ('invite', 'live')").all()) battleOver(b);
      // 友達と稼ぐ: old invitations, hubs of one
      q('DELETE FROM hub_invites WHERE created_at < ?').run(Date.now() - HUB.inviteMs);
      for (const h of q('SELECT id FROM hubs').all()) settleHub(h.id);
      for (const [k, until] of voiceKept) if (until < Date.now()) voiceKept.delete(k);
      // the official bot: two days without the operators' answer, it answers on its own
      for (const p of official.autoReplies()) {
        opsLog.add({ action: 'bot_auto_reply', target: p, summary: `${p.name}さんへ自動返信（2日以上未返信のため既読に）`, detail: { text: 'AUTO' } });
      }
      for (const l of Object.values(limit)) l.prune();
      opsLogin.prune();
      // 90 days in the プレイヤーアーカイブ: their data goes
      ops.purgeDue();
      milestones();
      quota.flush();
      stats.flush();
    } catch (e) {
      console.error('housekeeping failed', e);
    }
    // payments whose notice may have been lost are asked about at Stripe;
    // the developer's automatic backup when it is time
    return Promise.all([
      pay.sweep().catch((e) => console.error('pay sweep failed', e)),
      backup.due().catch((e) => console.error('backup failed', e))
    ]);
  }
  // when the host should run the housekeeping next: in 6 hours, or sooner for a backup
  function nextHousekeeping(now = Date.now()) {
    const b = backup.nextDue();
    return b ? Math.max(now + 60000, Math.min(now + 6 * 3600000, b)) : now + 6 * 3600000;
  }

  // Stream tickets are signed and expire within a minute; each opens one connection.
  const usedTickets = new Map();
  // the operator site's live connection (an operator's ticket, signed apart)
  const opsSecret = `${secret}:ops-live`;
  function consumeOpsTicket(ticket) {
    const userId = verifyTicket(opsSecret, ticket);
    if (!userId) return null;
    const now = Date.now();
    for (const [t, until] of usedTickets) if (until < now) usedTickets.delete(t);
    if (usedTickets.has(ticket)) return null;
    usedTickets.set(ticket, now + 70000);
    const u = getUser(userId);
    return u && ops.isOperator(u) ? userId : null;
  }
  function consumeTicket(ticket) {
    const userId = verifyTicket(secret, ticket);
    if (!userId) return null;
    const now = Date.now();
    for (const [t, until] of usedTickets) if (until < now) usedTickets.delete(t);
    if (usedTickets.has(ticket)) return null;
    usedTickets.set(ticket, now + 70000);
    const u = getUser(userId);
    if (!u) return null;
    try { allowed(u); } catch { return null; }
    return userId;
  }

  // (a ban or its lifting by command reaches the player like one from the operator site)
  const admin = createAdmin(db, {
    seal: (code) => sealText(CODE_KEY, code),
    isDeveloper,
    onBan: (u, on) => {
      if (!on) { liftBan(u, 'lifted'); return; }
      // (a 永久BAN: to the プレイヤーアーカイブ, like one from the operator site)
      const now = Date.now();
      q("UPDATE users SET archived_at = ?, archive_reason = 'perma', purge_at = ?, archive_with = 0 WHERE id = ?").run(now, now + ARCHIVE_DAYS * 86400000, u.id);
      const b = getUser(u.id);
      tellBanned(b);
      live.send(b.id, 'kick', { code: 'banned', message: banMessage(b), ban: banState(b) });
      dropFromHub(b.id);
    }
  });

  // The automatic filter (server/core/attach.js) stopped something a player
  // tried to send in a chat: the host never handed it on, only this note of
  // it. All that is known goes to the 緊急 log, and the player's chat stops
  // until an operator lets it go again (POST /api/ops/chat-ban; never the
  // developer's). Not signed in: nothing (the route would refuse it anyway).
  // One who keeps trying is written down a few times a minute, not each time.
  const filterNotes = new Limiter(3, 3);
  function filtered(req, note) {
    let u;
    try { u = authUser(req); } catch { return false; }
    if (emergency.stopped() && !isDeveloper(u)) return false;
    const route = String(note.route || '').slice(0, 60);
    emergency.request({ path: route.split(' ')[1] || '', ip: req.ip, userId: u.id, status: 400 });
    if (!filterNotes.take(String(u.id))) return false;
    const why = FILTERED[note.reason] || '不明';
    const stop = !isDeveloper(u), already = !!u.chat_ban;
    if (stop && !already) q('UPDATE users SET chat_ban = ?, chat_ban_why = ? WHERE id = ?').run(Date.now(), why, u.id);
    opsLog.add({
      actor: u, action: 'filter_block', target: u, req,
      summary: `自動フィルタリングシステムが${u.name}さんの送信をブロック（${why}）${!stop ? '・開発者のためチャットは止めない' : already ? '・チャット停止中' : '・チャットを停止'}`,
      detail: {
        route, reason: String(note.reason || '').slice(0, 40), why, keys: Array.isArray(note.keys) ? note.keys.slice(0, 30).map((k) => String(k).slice(0, 60)) : [],
        size: Number(note.size) || 0, contentType: String(note.contentType || '').slice(0, 100), sha256: String(note.sha256 || '').slice(0, 64), chatBan: stop, alreadyStopped: already
      }
    });
    if (stop && !already) live.send(u.id, 'chatban', { on: true, message: CHAT_BANNED, me: meDto(getUser(u.id)) });
    return true;
  }

  let announced = false;
  async function handle(req) {
    // (the address players use: the link in the Discord notices)
    noteHost(req);
    // (a minute over: the emergency stop looks at it before this answer)
    emergency.tick();
    const out = await answer(req);
    // (after a new version starts: its announcements, once)
    if (!announced && !emergency.locked()) {
      announced = true;
      try { voiceNotice(); milestones(); } catch (e) { console.error('announcements failed', e); }
    }
    stats.request();
    emergency.request({ path: req.path, ip: req.ip, userId: req.userId || 0, status: out.status });
    // the shield learns from the outcome (a failed login, a guess at the keys)
    shield.request({ path: req.path, ip: req.ip, userId: req.userId || 0, status: out.status, code: out.body && out.body.error ? out.body.error.code : '' });
    if (quota.on) quota.request(out.body ? JSON.stringify(out.body).length : 0);
    return out;
  }

  // All a 閲覧者's site session ('view') may ever reach: reads of what an
  // operator sees, minus the players' list, the archive, the vault, the chats,
  // the backups and the payments; and logging out. Anything else, game or
  // site, is refused before its route runs (and each of these checks for an
  // operator or a viewer on its own).
  const VIEW_ONLY = new Set([
    'GET /api/ops/me', 'POST /api/ops/enter', 'GET /api/ops/alive', 'GET /api/ops/counts', 'GET /api/ops/reports', 'GET /api/ops/detections', 'GET /api/ops/feedback',
    'GET /api/ops/log', 'GET /api/ops/log/verify', 'GET /api/ops/operators', 'GET /api/ops/server', 'GET /api/ops/security',
    'GET /api/sec/me', 'GET /api/sec/status', 'GET /api/sec/log', 'GET /api/sec/verify', 'POST /api/logout'
  ]);

  // what still comes in while the server is stopped for an emergency: the
  // developer's way back in
  const WHILE_STOPPED = new Set(['POST /api/ops/login', 'GET /api/ops/me', 'POST /api/ops/enter', 'GET /api/emergency', 'POST /api/emergency/release']);
  // what still comes in during a lockdown: the security base (/sec/) for the
  // operators, the operator login they reach it with (and the logout that
  // ends it, so 出る really signs out), and the developer's emergency page.
  // Everything else — players, the operator site, the developer's own tools —
  // is shut.
  const WHILE_LOCKED = new Set([
    'POST /api/ops/login', 'POST /api/logout', 'GET /api/sec/me', 'GET /api/sec/status', 'GET /api/sec/log', 'GET /api/sec/verify',
    'GET /api/sec/messages', 'POST /api/sec/messages', 'POST /api/sec/lockdown', 'POST /api/sec/release',
    'GET /api/emergency', 'POST /api/emergency/release'
  ]);

  async function answer(req) {
    const key = `${req.method} ${req.path}`;
    try {
      // the security shield first: an attack is turned away before anything else
      shield.inspect(req);
      if (key === 'POST /api/admin') return { status: 200, body: await adminCall(req) };
      // locked down: nobody but the operators' security base; or stopped for an
      // emergency: nobody but the developer
      if (emergency.locked()) { if (!WHILE_LOCKED.has(key)) return { status: 503, body: emergency.body() }; }
      else if (emergency.stopped() && !WHILE_STOPPED.has(key)) return { status: 503, body: emergency.body() };
      // a day's cap is reached: the same notice for everyone until 00:00 UTC
      if (quota.over()) return { status: 503, body: maintenanceBody() };
      const route = routes[key];
      if (!route) throw new ApiError(404, 'not_found', 'APIが見つかりません');
      let user = null;
      if (!PUBLIC.has(key)) {
        user = authUser(req);
        req.userId = user.id;
        // a viewer's look-only session: the allowlist, and only while they still are one
        if (user.scope === 'view') {
          if (!ops.isViewer(user)) throw new ApiError(401, 'ended', '閲覧者の権限がなくなったため、ログアウトされました');
          if (!VIEW_ONLY.has(key)) throw new ApiError(403, 'viewer', '閲覧者は見ることだけができます（この操作はできません）');
        }
        // during a plain emergency stop only the developer passes; during a
        // lockdown WHILE_LOCKED already allows only the security base, whose
        // routes check for an operator themselves
        if (emergency.stopped() && !emergency.locked() && !isDeveloper(user)) return { status: 503, body: emergency.body() };
        // (a vault's pieces: their own limit, in server/core/vault.js)
        if (!VAULT_BULK.has(key)) rate(limit.general, user.id);
      }
      return { status: 200, body: await route(req, user) };
    } catch (e) {
      if (e instanceof ApiError) return { status: e.status, body: { error: { code: e.code, message: e.message, ...(e.extra || {}) } } };
      // the host's daily quota ran out (e.g. database writes on the free plan)
      if (isQuotaError(e)) return { status: 503, body: maintenanceBody() };
      console.error(e);
      return { status: 500, body: { error: { code: 'internal', message: 'サーバーでエラーが発生しました。少し待ってからもう一度お試しください' } } };
    }
  }

  // Operator commands over HTTP (needed on Cloudflare, where there is no shell).
  async function adminCall(req) {
    const given = String(req.header('x-admin-token') || '');
    if (!config.adminToken || !given || sha256(given) !== sha256(config.adminToken)) {
      throw new ApiError(403, 'forbidden', 'ADMIN_TOKEN が必要です');
    }
    const body = await req.json(8 * 1024 * 1024);
    const cmd = String(body.cmd || '');
    const args = Array.isArray(body.args) ? body.args : [];
    try {
      if (cmd === 'quota') return { ok: true, result: quota.state() };
      // going back in time (Cloudflare): the CLI takes the operators' log first
      // and gives it back after, so none of it is lost (server/core/opslog.js)
      if (cmd === 'log-export') return { ok: true, result: { rows: admin.logRows() } };
      if (cmd === 'log-keep') return { ok: true, result: admin.keepLog(args[0], args[1] || {}, req) };
      const own = hostAdmin ? await hostAdmin(cmd, args) : undefined;
      return { ok: true, result: own !== undefined ? own : await admin.command(cmd, args, req) };
    } catch (e) {
      if (e && e.name === 'AdminError') throw new ApiError(400, 'admin', e.message);
      throw e;
    }
  }

  return {
    handle,
    filtered,
    hello,
    presence,
    housekeeping,
    userForToken,
    consumeTicket,
    consumeOpsTicket,
    // the operator site's live connection gone: out of the 全体チャット's call
    opsGone: (userId) => team.gone(userId),
    socketCall,
    socketTyping,
    socketBeat,
    socketSight,
    quota,
    // the bytes of an answer, as the host sent it (and the path it answered)
    sent: (bytes, path = '') => { stats.sent(bytes); emergency.sent(bytes, path); },
    // stopped for an emergency: the hosts take no live connections meanwhile
    stopped: () => emergency.stopped(),
    stoppedBody: () => emergency.body(),
    nextHousekeeping,
    backupDue: () => backup.due().catch((e) => console.error('backup failed', e)),
    close: () => { quota.flush(); stats.flush(); }
  };
}
