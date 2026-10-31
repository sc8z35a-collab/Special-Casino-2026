// The game rules and spin engine are the browser files themselves, so the
// server and the client can never disagree on symbols, odds, pays or prices.
import '../../js/core/util.js';
import '../../js/game/config.js';
import '../../js/game/engine.js';
import '../../js/game/sale.js';
import '../../js/game/quests.js';
import '../../js/game/news.js';
import '../../js/game/tree.js';
import '../../js/game/vip.js';
import '../../js/game/receipts.js';
import '../../js/game/gacha.js';
import '../../js/game/stocks.js';
import '../../js/game/corp.js';
import '../../js/game/npc.js';

const BR = globalThis.BR;
if (!BR || !BR.CONFIG || !BR.engine || !BR.sale || !BR.QUESTS || !BR.LEVEL || !BR.RELEASE || !BR.TREE || !BR.VIP || !BR.GACHA || !BR.STOCKS || !BR.CORP || !BR.NPC) throw new Error('could not load the game rules from js/');

export const RULES = BR.CONFIG;
export const QUESTS = BR.QUESTS;
export const LEVEL = BR.LEVEL;
export const TREE = BR.TREE;
export const VIP = BR.VIP;
export const RECEIPTS = BR.receipts;
export const GACHA = BR.GACHA;
export const STOCKS = BR.STOCKS;
export const CORP = BR.CORP;
export const NPC = BR.NPC;
// the newest Dev News entry: players on an older game are asked to update
export const RELEASE = BR.RELEASE;
export const JOBS = new Map(RULES.jobs.map((j) => [j.id, j]));
export const AVATARS = new Map(RULES.avatars.map((a) => [a.id, a]));
// Pending models stay in the display catalog; existing server actions only
// accept cars with a settled price (including the purchase API's bad_model guard).
export const CARS = new Map(RULES.cars.filter(carPriced).map((c) => [c.id, c]));
export const SHOP = new Map(RULES.shop.map((i) => [i.id, i]));
export const FRUITS = new Map(RULES.fruits.map((f) => [f.id, f]));

// `weights`: other odds than the usual ones (a hub's, RULES.hub.weights)
export function spin(bet, weights) { return BR.engine.spin(bet, weights); }
export function evaluate(line, bet) { return BR.engine.evaluate(line, bet); }
export function packGrid(grid) { return BR.engine.pack(grid); }
// a Shop item at `now` (on sale 5 hours a day: { price, pct, on, start, end, next })
export function shopSale(item, now = Date.now()) { return BR.sale.shop(item, now); }
// the Car Owner sale on at `now` (or null), and a car's price with it
export function carSale(now = Date.now()) { return BR.sale.cars(now, RULES.cars); }
// `off`: VIP's % off on top of the sale
export function carPrice(car, sale, off = 0, extra = 0) { return BR.sale.carPrice(car, sale, off, extra); }
export function carPriced(car) { return BR.sale.carPriced(car); }
export function carSold(car) { return BR.sale.carSold(car); }
// what the buy-back pays for a car at `now` (and the 大廃棄セール on then)
export function carBuyback(car, now = Date.now()) { return BR.sale.buyback(car, now, BR.sale.cars(now, RULES.cars)); }
export function carDisposal(now = Date.now()) { return BR.sale.disposal(now); }
export function utcDay(date) {
  const d = date || new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}
export function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export function fmt(n) { return BR.util.fmt(n); }

// The login bonus day (6:00 to 6:00 Japan time, UTC+9), as a date key.
const LOGIN_SHIFT = (9 - RULES.loginBonus.dayStartsJst) * 3600000;
export function loginDay(now = Date.now()) { return utcDay(new Date(now + LOGIN_SHIFT)); }
export function nextLoginReset(now = Date.now()) { return nextUtcMidnight(now + LOGIN_SHIFT) - LOGIN_SHIFT; }
