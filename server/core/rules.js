// The game rules and spin engine are the browser files themselves, so the
// server and the client can never disagree on symbols, odds, pays or prices.
import '../../js/core/util.js';
import '../../js/game/config.js';
import '../../js/game/engine.js';
import '../../js/game/sale.js';
import '../../js/game/quests.js';
import '../../js/game/news.js';
import '../../js/game/tree.js';

const BR = globalThis.BR;
if (!BR || !BR.CONFIG || !BR.engine || !BR.sale || !BR.QUESTS || !BR.LEVEL || !BR.RELEASE || !BR.TREE) throw new Error('could not load the game rules from js/');

export const RULES = BR.CONFIG;
export const QUESTS = BR.QUESTS;
export const LEVEL = BR.LEVEL;
export const TREE = BR.TREE;
// the newest Dev News entry: players on an older game are asked to update
export const RELEASE = BR.RELEASE;
export const JOBS = new Map(RULES.jobs.map((j) => [j.id, j]));
export const AVATARS = new Map(RULES.avatars.map((a) => [a.id, a]));
export const CARS = new Map(RULES.cars.map((c) => [c.id, c]));
export const SHOP = new Map(RULES.shop.map((i) => [i.id, i]));
export const FRUITS = new Map(RULES.fruits.map((f) => [f.id, f]));

// `weights`: other odds than the usual ones (a hub's, RULES.hub.weights)
export function spin(bet, weights) { return BR.engine.spin(bet, weights); }
export function evaluate(line, bet) { return BR.engine.evaluate(line, bet); }
// today's price of a paid icon and its discount in percent
export function iconSale(avatar, day) { return { price: BR.sale.price(avatar, day), pct: BR.sale.pct(avatar.id, day) }; }
// Shop items are on sale the same way
export const itemSale = iconSale;
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
