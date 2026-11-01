// The people's part of the 投資 market (server/core/npc-model.js): each investor's own view of the four listed
// companies (their news, their friends, the chart, what they paid), their orders (a buy at most NPC.life.investDay a day each, a
// sale only of what they hold, at most NPC.life.tradesDay orders a day each), and every minute the orders matched among themselves at the minute's price (板寄せ);
// what is left waits for the minute (a player's order trades against it first: server/core/corp.js), and the
// imbalance moves the price. The fee is Dtrade's, 1.8% each way as the players'.
import { NPC, STOCKS } from './rules.js';
import { T, NT, LISTED, remember } from './npc-pop.js';
import { toStream, nationIn } from './npc-econ.js';

export const LISTED_IDS = ['riru', 'ice', 'magita', 'tenesice'];
const tr = (P, i, k) => P.tr[i * NT + k] / 255;
const feeOf = (W, v) => Math.ceil(v * (W.nation.knobs.tradeFee || 1.8) / 100);

export function createMarket(W) {
  const m = W.marketState || (W.marketState = { book: {}, last: {}, hist: {}, nudges: [], volume: {}, cost: {} });
  for (const id of LISTED_IDS) {
    if (!m.book[id]) m.book[id] = { buy: [], sell: [] };
    if (!m.hist[id]) m.hist[id] = [];
  }
  return {
    // an investor at the screen: maybe an order
    think(W, i, day, r, ctx) {
      const P = W.P;
      // (15 orders a day each, buys and sales together)
      if (P.trades[i] >= NPC.life.tradesDay) return;
      const k = r.int(LISTED);
      const id = LISTED_IDS[k], price = ctx.stockPrice ? ctx.stockPrice(id) : 0;
      if (!price) return;
      const hist = m.hist[id], ref = hist.length ? hist[0] : price;
      // the view: their outlook (news and friends), the move of late (some follow it, some go against it), the price
      // against the company's worth as they read it
      const trend = (price - ref) / Math.max(1, ref);
      const follower = tr(P, i, T.impulse) > 0.5;
      const value = ctx.fair && ctx.fair[id] ? Math.log(ctx.fair[id] / price) : 0;
      let view = P.outlook[i * LISTED + k] / 127 + (follower ? 3 : -2) * trend + 0.8 * value * tr(P, i, T.news) + 0.3 * r.z();
      // fear and greed: a move of late beyond 8% carries the nervous and the impulsive along with it (a panic, a mania)
      const rush = Math.abs(trend) > 0.08 ? Math.sign(trend) * (Math.abs(trend) - 0.08) * 8 * (0.4 + tr(P, i, T.impulse) + 0.6 * tr(P, i, T.neuro)) : 0;
      view += rush;
      const held = P.sh[i * LISTED + k];
      const cost = (m.cost[id] && m.cost[id][i]) || price;
      // (a winner sold early, a loser held: the gain taken, the loss not)
      if (held > 0 && price > cost * 1.08) view -= 0.6;
      if (held > 0 && price < cost * 0.9) view += 0.3;
      const limit = Math.max(1, Math.round(price * (1 + (view > 0 ? 1 : -1) * (0.001 + 0.006 * r.u()))));
      if (view > 0.2) {
        const room = Math.max(0, NPC.knobOf(W, 'investDaily') - P.buyDay[i]);
        // (in a mania what was set aside for the market is not the limit: the greedy put in what they have)
        const money = Math.min(Math.max(Math.max(0, P.fund[i * 4 + 3]) * (0.3 + 0.5 * r.u()), rush > 0 ? Math.max(0, P.cash[i]) * Math.min(0.5, rush * 0.2) : 0), Math.max(0, P.cash[i]) * 0.5, room);
        const shares = Math.floor(money / (limit * 1.02));
        if (shares > 0) { m.book[id].buy.push([i, shares, limit]); P.buyDay[i] += shares * limit; P.fund[i * 4 + 3] -= shares * limit; P.trades[i]++; }
      } else if (view < -0.2 && held > 0) {
        // (in a panic, more of it, up to all)
        const shares = Math.max(1, Math.floor(held * Math.min(1, 0.2 + 0.6 * r.u() + (rush < 0 ? -rush * 0.5 : 0))));
        m.book[id].sell.push([i, Math.min(held, shares), limit]);
        P.trades[i]++;
      }
    },
    // the minute's matching at the price: the buys at or above it with the sales at or below, pro rata on the larger side
    auction(W, minute, ctx) {
      const P = W.P;
      for (let k = 0; k < LISTED; k++) {
        const id = LISTED_IDS[k], b = m.book[id], price = ctx.stockPrice ? ctx.stockPrice(id) : 0;
        if (!price) { b.buy = []; b.sell = []; continue; }
        for (const o of b.buy) o[1] = Math.min(o[1], Math.floor(Math.max(0, P.cash[o[0]]) / (price * 1.02)));
        for (const o of b.sell) o[1] = Math.min(o[1], P.sh[o[0] * LISTED + k]);
        const buys = b.buy.filter((o) => o[2] >= price && o[1] > 0), sells = b.sell.filter((o) => o[2] <= price && o[1] > 0);
        let want = 0, have = 0;
        for (const o of buys) want += o[1];
        for (const o of sells) have += o[1];
        const done = Math.min(want, have);
        if (done > 0) {
          // each side's share of what traded, by what it asked for (the remainders to the largest), never beyond it
          const fb = alloc(buys, done), fs = alloc(sells, done);
          buys.forEach((o, x) => { if (fb[x] > 0) { settle(W, k, o[0], fb[x], price, 'buy'); o[1] -= fb[x]; } });
          sells.forEach((o, x) => { if (fs[x] > 0) { settle(W, k, o[0], fs[x], price, 'sell'); o[1] -= fs[x]; } });
        }
        // what was left of each side waits through the minute for the players; its imbalance moves the price
        const net = (want - done) - (have - done);
        if (done || net) m.nudges.push({ company: id, at: minute, shares: done, value: net * price });
        b.buy = b.buy.filter((o) => o[1] > 0 && o[2] >= price * 0.995).slice(-200);
        b.sell = b.sell.filter((o) => o[1] > 0 && o[2] <= price * 1.005).slice(-200);
        b.at = minute;
        m.volume[id] = (m.volume[id] || 0) + done;
        // (the price as the people last saw it, for the move of late: every half hour of it)
        if (minute % 30 === 0) { m.hist[id].push(price); if (m.hist[id].length > 16) m.hist[id].shift(); }
        // (how far the market has moved of late: the people look at their shares more when it moves a lot)
        const h0 = m.hist[id][0];
        if (k === 0) m.move = 0;
        if (h0) m.move = Math.max(m.move || 0, Math.abs(price / h0 - 1));
        m.last[id] = price;
      }
    },
    // a player's order at `price`: what the people's waiting orders on the other side take of it (the rest is the
    // company's: new shares or its own bought back). Their side settles now; returns [shares, fills].
    cross(W, id, side, shares, price) {
      const k = LISTED_IDS.indexOf(id);
      if (k < 0) return [0, []];
      const P = W.P, b = m.book[id];
      const list = side === 'buy' ? b.sell.filter((o) => o[2] <= price) : b.buy.filter((o) => o[2] >= price);
      let left = shares;
      const fills = [];
      for (const o of list) {
        if (left <= 0) break;
        const can = side === 'buy' ? Math.min(o[1], P.sh[o[0] * LISTED + k]) : Math.min(o[1], Math.floor(Math.max(0, P.cash[o[0]]) / (price * 1.02)));
        const n = Math.min(left, can);
        if (n <= 0) { o[1] = 0; continue; }
        settle(W, k, o[0], n, price, side === 'buy' ? 'sell' : 'buy', true);
        o[1] -= n;
        left -= n;
        fills.push([o[0], n]);
      }
      b.sell = b.sell.filter((o) => o[1] > 0);
      b.buy = b.buy.filter((o) => o[1] > 0);
      return [shares - left, fills];
    }
  };

  // `n` shared out over orders by what each asked (whole shares: the remainders to the largest), never beyond an order
  function alloc(list, n) {
    const total = list.reduce((a, o) => a + o[1], 0);
    const out = list.map((o) => Math.floor(o[1] * n / total));
    let left = n - out.reduce((a, b) => a + b, 0);
    const order = list.map((o, x) => [x, o[1] * n / total - out[x]]).sort((a, b) => b[1] - a[1]);
    for (const [x] of order) { if (left <= 0) break; if (out[x] < list[x][1]) { out[x]++; left--; } }
    return out;
  }
  // one investor's side of a trade: the shares and the money, the fee to Dtrade (`player`: the other side a player's,
  // whose money comes from the players' side of the game)
  function settle(W, k, i, n, price, side, player = false) {
    const P = W.P, id = LISTED_IDS[k], v = n * price, fee = feeOf(W, v);
    const day = Math.floor(W.minute / 1440);
    if (side === 'buy') {
      P.cash[i] -= v + fee;
      P.sh[i * LISTED + k] += n;
      const c = m.cost[id] || (m.cost[id] = {});
      const was = P.sh[i * LISTED + k] - n;
      c[i] = Math.round(((c[i] || price) * was + price * n) / Math.max(1, was + n));
      if (player) W.sum.fromPlayers -= v;
    } else {
      // (what they paid a share, read before a holding sold out is forgotten)
      const c = (m.cost[id] && m.cost[id][i]) || price;
      P.cash[i] += v - fee;
      P.sh[i * LISTED + k] -= n;
      if (P.sh[i * LISTED + k] <= 0 && m.cost[id]) delete m.cost[id][i];
      if (player) W.sum.fromPlayers += v;
      if (price > c * 1.2) remember(P, i, day, 13, 120);
      else if (price < c * 0.8) remember(P, i, day, 14, 120);
      // the gains tax: 20% of what was made on a sale (the country's)
      const gain = (price - c) * n;
      if (gain > 0) { const tax = Math.round(gain * NPC.tax.gains); P.cash[i] -= tax; nationIn(W, 'gains', tax); }
    }
    toStream(W, day, 'dtrade', 'commission', fee);
    W.sum.traded += v;
  }
}
