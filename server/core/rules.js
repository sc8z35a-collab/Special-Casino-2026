// The game rules and spin engine are the browser files themselves, so the
// server and the client can never disagree on symbols, odds, pays or prices.
import '../../js/core/util.js';
import '../../js/game/config.js';
import '../../js/game/engine.js';
import '../../js/game/sale.js';

const BR = globalThis.BR;
if (!BR || !BR.CONFIG || !BR.engine || !BR.sale) throw new Error('could not load the game rules from js/');

export const RULES = BR.CONFIG;
export const AVATARS = new Map(RULES.avatars.map((a) => [a.id, a]));
export const CARS = new Map(RULES.cars.map((c) => [c.id, c]));

export function spin(bet) { return BR.engine.spin(bet); }
export function evaluate(line, bet) { return BR.engine.evaluate(line, bet); }
// today's price of a paid icon and its discount in percent
export function iconSale(avatar, day) { return { price: BR.sale.price(avatar, day), pct: BR.sale.pct(avatar.id, day) }; }
export function utcDay(date) {
  const d = date || new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate();
}
export function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export function fmt(n) { return BR.util.fmt(n); }
