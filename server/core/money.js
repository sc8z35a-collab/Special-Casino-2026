// The players' side of the money ledger (server/core/npc-model.js ledgerDay counts the country's): all the players'
// money, and what of it is theirs but held for a while. Its change from one close to the next is what crossed between
// them and the country (`W.sum.toPlayers - W.sum.fromPlayers`: what the treasury, the companies and the local
// businesses paid them, less what they paid them) — money moved between players moves nothing; anything else is money
// made or lost, and is told.
// - `held`: their $ and their spin tokens (at their price)
// - `orders`: the $ held for their waiting buy orders (server/core/stocks.js)
// - `dividends`: the dividends paid to them and not yet taken (stock_accounts.pending)
// - `bets`: the stakes of their open 観戦ベット (paid back, paid out or lost to the casino when it ends)
// - `sent`: money one player sent another that waits to be taken (a transfer, a present, a car's price): the sender's
//   until then — it goes back if it is never taken (server/core/api.js lapse)
export function playersMoney(q, tokenPrice) {
  const one = (sql, ...a) => Number((q(sql).get(...a) || {}).n || 0);
  const parts = {
    held: one("SELECT COALESCE(SUM(dollars), 0) + ? * COALESCE(SUM(tokens), 0) AS n FROM users WHERE npc = ''", tokenPrice),
    orders: one("SELECT COALESCE(SUM(o.reserved), 0) AS n FROM stock_orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'open' AND u.npc = ''"),
    dividends: one("SELECT COALESCE(SUM(a.pending), 0) AS n FROM stock_accounts a JOIN users u ON u.id = a.user_id WHERE u.npc = ''"),
    bets: one("SELECT ? * COALESCE(SUM(stake), 0) AS n FROM watch_bets WHERE state = 'open'", tokenPrice),
    sent: one(`SELECT COALESCE(SUM(CASE WHEN m.currency = 'tokens' THEN m.amount * ? ELSE m.amount END), 0) AS n
               FROM messages m JOIN users s ON s.id = m.sender_id
               WHERE m.claimed_at = 0 AND m.state NOT IN ('returned', 'expired', 'void', 'canceled', 'lapsed') AND s.npc = ''
                 AND ((m.kind = 'transfer' AND m.pending = 1 AND m.currency IN ('tokens', 'dollars')) OR m.kind IN ('present', 'car_sold'))`, tokenPrice)
  };
  return { total: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

// The players' day on the ledger: their money against what crossed (`crossed`: the country's count of it, to the
// players less from them), from the first day it was counted. A drift beyond a dollar is told (`tell`).
export function playersLedgerDay(L, day, money, crossed, tell = null) {
  const now = money.total - crossed;
  const P = L.players || (L.players = { base: now, drift: 0, worst: 0, days: [] });
  const drift = now - P.base, moved = drift - (P.drift || 0);
  P.drift = drift;
  P.days.push({ day, money: money.total, crossed, drift, moved, parts: money.parts });
  if (P.days.length > 60) P.days.shift();
  if (Math.abs(moved) > Math.abs(P.worst || 0)) P.worst = moved;
  if (Math.abs(moved) > 1 && tell) tell(day, moved, drift, money);
  return P;
}
