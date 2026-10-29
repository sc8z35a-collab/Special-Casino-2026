// 開発者支援: players support the developer with real money (yen) and get
// ロイヤルコイン, the coins in the wallet (js/game/config.js `support`). The
// coins only make days of VIP (js/game/vip.js): they are never bet, exchanged
// for tokens or $, sent to anyone or paid out.
//
// How a payment goes, and what keeps it safe:
// - the player picks a plan, how many (1-100) and PayPay or konbini; the
//   server alone works out the price (the browser's numbers are never used)
//   and checks the player (logged in, not banned, 18 or over, what they paid
//   in the last 24 hours, a few orders waiting at most) before an order with
//   a random id is made;
// - Stripe (server/core/stripe.js) makes its payment page for that order
//   (once per order id, however often it is asked) and the player pays on
//   Stripe's page: PayPay logins and the like never reach this server;
// - coins are given only for what Stripe itself says when asked: its signed
//   notice (HMAC-SHA256 over the body as sent, at most 5 minutes old) only
//   tells that something happened; the server then fetches the payment page
//   from Stripe and checks that it is this order's (its id twice, the
//   amount, yen, live or test) before giving anything, once (one UPDATE that
//   only an unpaid order passes, in the same transaction as the coins). An
//   answer that does not match is never paid out and waits for the developer;
// - a late or lost notice: the order is checked with Stripe when the player
//   looks at it, and by the housekeeping;
// - a refund takes the order's coins back (as many as are left);
// - every step goes into the operators' log (server/core/opslog.js), which
//   can only grow.
// The meters on the purchase screen fill with every yen paid: 開発費回収
// (once), then 来月の開発費確保 (every month, Japan time). Each player who paid
// waits in the operator site's 課金 tab (the developer's own) until the
// developer answers them through the official bot; then they leave the list.
import crypto from 'node:crypto';
import { ApiError, posInt } from './errors.js';
import { cleanText } from './auth.js';
import { RULES } from './rules.js';
import { Limiter } from './ratelimit.js';
import { createStripe, KEY_RE, WEBHOOK_SECRET_RE } from './stripe.js';

const SUPPORT = RULES.support;
const PLANS = new Map(SUPPORT.plans.map((p) => [p.id, p]));
const JST = 9 * 3600000;
const DAY = 86400000;
// a payment page stays open this long (Stripe's least is 30 minutes)
const PAGE_MS = 31 * 60000;
// one order is asked about at Stripe at most this often (a player waiting)
const RECHECK_MS = 10000;
// konbini payment slips waiting at once, and payment pages open at once, per player
const SLIPS_MAX = 3;
const PAGES_MAX = 5;
const ID_RE = /^[0-9a-f]{32}$/;
// what Stripe sends that the server listens to (set these on the webhook)
export const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded'];
const STATUS_NAMES = {
  new: '準備中', open: '支払い待ち', pending: 'コンビニでの支払い待ち', paid: '購入完了', failed: '支払われませんでした', expired: '期限切れ',
  canceled: '中止', refunded: '返金済み', error: 'エラー', review: '確認中'
};
// an order may become paid from these (money that came is always honoured)
const UNPAID = "('new', 'open', 'pending', 'failed', 'expired', 'canceled', 'error')";

const yen = (n) => `${Number(n).toLocaleString('en-US')}円`;
const planOf = (id) => PLANS.get(id) || { id, name: id, price: 0, coins: 0, bonus: 0 };

// 0:00 (Japan time) of the month `ms` is in, and of the next one
function monthOf(ms) {
  const d = new Date(ms + JST);
  return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - JST, until: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - JST };
}

export function createPay({ q, tx, live, config, getUser, balanceChanged, official, opsLog, isDeveloper }) {
  const dailyMax = config.payDailyLimit ?? SUPPORT.dailyMax;
  const secrets = String(config.stripeWebhookSecret || '').split(',').map((s) => s.trim()).filter(Boolean);
  const methods = SUPPORT.methods.filter((m) => config.payMethods.includes(m.id));
  // why payments are off (none: on); shown to the developer in the 課金 tab
  const problems = [];
  if (!config.stripeSecretKey) problems.push('STRIPE_SECRET_KEY が設定されていません');
  else if (!KEY_RE.test(config.stripeSecretKey)) problems.push('STRIPE_SECRET_KEY の形式が正しくありません（sk_live_… か rk_live_…）');
  if (!secrets.length) problems.push('STRIPE_WEBHOOK_SECRET が設定されていません');
  else if (!secrets.every((s) => WEBHOOK_SECRET_RE.test(s))) problems.push('STRIPE_WEBHOOK_SECRET の形式が正しくありません（whsec_…）');
  if (!config.publicUrl) problems.push('PUBLIC_URL（ゲームの公開 URL）が設定されていません');
  else if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(config.publicUrl) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(config.publicUrl)) {
    problems.push('PUBLIC_URL は https:// から始まるゲームのアドレス（最後の / なし）にしてください');
  }
  if (config.stripeApi && !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.stripeApi)) problems.push('STRIPE_API はテスト専用です（本番では設定しないでください）');
  if (!methods.length) problems.push('PAY_METHODS に使える支払い方法がありません（paypay, konbini）');
  const on = problems.length === 0;
  const stripe = on ? createStripe({ secretKey: config.stripeSecretKey, webhookSecrets: secrets, api: config.stripeApi, apiVersion: config.stripeApiVersion }) : null;
  const mode = !on ? 'off' : stripe.live ? 'live' : 'test';

  // [a minute, burst]: payment pages (a player, an address), looking (the
  // screen, an order, cancelling), Stripe's notices and the 特定商取引法 page (an address)
  const L = { payCheckout: [6, 3], payCheckoutIp: [20, 10], payLook: [90, 30], payHook: [600, 200], paySeller: [60, 30], ...config.limits };
  const limits = {
    checkout: new Limiter(...L.payCheckout),
    checkoutIp: new Limiter(...L.payCheckoutIp),
    look: new Limiter(...L.payLook),
    hook: new Limiter(...L.payHook),
    seller: new Limiter(...L.paySeller)
  };
  function rate(l, key) {
    if (!l.take(String(key))) throw new ApiError(429, 'rate_limited', '操作が速すぎます。少し待ってください');
  }

  const getOrder = (id) => q('SELECT * FROM pay_orders WHERE id = ?').get(id);
  function dto(o) {
    const p = planOf(o.plan);
    const m = SUPPORT.methods.find((x) => x.id === o.method);
    return {
      id: o.id, plan: o.plan, name: p.name, qty: o.qty, coins: o.coins, bonus: o.bonus, amount: o.amount,
      method: o.method, methodName: m ? m.name : o.method, status: o.status, statusName: o.status === 'paid' && o.refunded_amount ? '一部返金済み' : STATUS_NAMES[o.status] || o.status,
      refundedAmount: o.refunded_amount, coinsRevoked: o.coins_revoked,
      createdAt: o.created_at, paidAt: o.paid_at, refundedAt: o.refunded_at,
      voucher: o.status === 'pending' && o.voucher_url ? { url: o.voucher_url, until: o.voucher_until } : null
    };
  }
  const brief = (u) => (u ? { id: u.id, name: u.name, avatar: u.avatar, online: live.isOnline(u.id) } : null);

  // the yen a player paid or may still pay (orders of the last 24 hours; a
  // payment page only while it can be paid on)
  function spent(userId, now) {
    return q(`SELECT COALESCE(SUM(amount), 0) AS yen FROM pay_orders WHERE user_id = ? AND created_at > ?
              AND (status IN ('pending', 'paid') OR (status IN ('new', 'open') AND created_at > ?))`)
      .get(userId, now - DAY, now - PAGE_MS - 300000).yen;
  }

  // 開発費回収: every yen until `recover`; 来月の開発費確保: what came this
  // month (Japan time) after that, until `monthly`
  function meters(now = Date.now()) {
    const G = SUPPORT.goals, m = monthOf(now);
    let run = 0, month = 0;
    for (const r of q("SELECT amount - refunded_amount AS amount, paid_at FROM pay_orders WHERE status = 'paid' ORDER BY paid_at, id").all()) {
      const over = Math.max(0, run - G.recover);
      run += r.amount;
      if (r.paid_at >= m.from && r.paid_at < m.until) month += Math.max(0, run - G.recover) - over;
    }
    return {
      recover: { have: Math.min(run, G.recover), goal: G.recover },
      monthly: { have: Math.min(month, G.monthly), goal: G.monthly, open: run >= G.recover, from: m.from, until: m.until }
    };
  }
  function totals(now = Date.now()) {
    const m = monthOf(now);
    const all = q("SELECT COUNT(*) AS n, COALESCE(SUM(amount - refunded_amount), 0) AS yen, COALESCE(SUM(coins - coins_revoked), 0) AS coins, COUNT(DISTINCT user_id) AS payers FROM pay_orders WHERE status = 'paid'").get();
    const month = q("SELECT COUNT(*) AS n, COALESCE(SUM(amount - refunded_amount), 0) AS yen FROM pay_orders WHERE status = 'paid' AND paid_at >= ? AND paid_at < ?").get(m.from, m.until);
    const back = q('SELECT COUNT(*) AS n, COALESCE(SUM(refunded_amount), 0) AS yen FROM pay_orders WHERE refunded_amount > 0').get();
    const slips = q("SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS yen FROM pay_orders WHERE status = 'pending'").get();
    const review = q("SELECT COUNT(*) AS n FROM pay_orders WHERE status = 'review'").get().n;
    return { orders: all.n, yen: all.yen, coins: all.coins, payers: all.payers, monthOrders: month.n, monthYen: month.yen, refunds: back.n, refundYen: back.yen, slips: slips.n, slipYen: slips.yen, review };
  }

  /* ---------------------------------------------------------------- what Stripe says */

  // an order's state changed: the player's game hears it
  const tell = (o) => live.send(o.user_id, 'pay', { order: dto(o) });

  // Asks Stripe about an order's payment page and brings the order in line
  // with what it says (the only way coins are ever given).
  async function sync(o, hint = '', req = null) {
    q('UPDATE pay_orders SET checked_at = ? WHERE id = ?').run(Date.now(), o.id);
    const s = await stripe.session(o.session_id);
    if (s?.payment_status === 'paid' && typeof s.payment_intent === 'string') s.payment_intent = await stripe.intent(s.payment_intent);
    return tx(() => apply(getOrder(o.id), s, hint, req));
  }

  function apply(o, s, hint, req) {
    const pi = s && s.payment_intent && typeof s.payment_intent === 'object' ? s.payment_intent : null;
    const wrong = [];
    if (!s || s.object !== 'checkout.session') wrong.push('object');
    else {
      if (s.id !== o.session_id) wrong.push('session');
      if (s.client_reference_id !== o.id || !s.metadata || s.metadata.order !== o.id) wrong.push('order');
      if (!s.metadata || String(s.metadata.user) !== String(o.user_id)) wrong.push('user');
      if (s.mode !== 'payment') wrong.push('mode');
      if (String(s.currency || '').toLowerCase() !== 'jpy') wrong.push('currency');
      if (Number(s.amount_total) !== o.amount) wrong.push('amount');
      if (!!s.livemode !== stripe.live) wrong.push('livemode');
      if (pi && (Number(pi.amount) !== o.amount || String(pi.currency || '').toLowerCase() !== 'jpy')) wrong.push('payment');
    }
    if (wrong.length) return review(o, wrong, s, req);
    if (s.payment_status === 'paid') {
      const ch = pi?.latest_charge;
      if (!pi || pi.object !== 'payment_intent' || pi.status !== 'succeeded' || pi.metadata?.order !== o.id || String(pi.metadata?.user) !== String(o.user_id) || !!pi.livemode !== stripe.live)
        return review(o, ['payment_identity'], s, req);
      if (!ch || typeof ch !== 'object') throw new Error('paid charge not expanded');
      if (ch.object !== 'charge' || ch.payment_intent !== pi.id || Number(ch.amount) !== o.amount || String(ch.currency || '').toLowerCase() !== 'jpy' || !!ch.livemode !== stripe.live || !Number.isSafeInteger(ch.amount_refunded) || ch.amount_refunded < 0 || ch.amount_refunded > o.amount)
        return review(o, ['charge'], s, req);
      // Both the payment and its cumulative refunds are settled together. A
      // refund notice may precede a paid notice; neither can overwrite the other.
      const paid = fulfill(o, s, pi, req, ch.amount_refunded);
      return refunded(paid, ch.amount_refunded, req);
    }
    if (s.status === 'expired') return settle(o, 'expired', req);
    if (s.status === 'complete') {
      // konbini: the payment slip is out; the cash has not come (or never will)
      const gone = hint === 'checkout.session.async_payment_failed' || (pi && (pi.status === 'requires_payment_method' || pi.status === 'canceled'));
      if (gone) return settle(o, 'failed', req);
      return slip(o, pi, req);
    }
    return o;
  }

  // Paid: the coins, once (the UPDATE lets only an unpaid order through).
  function fulfill(o, s, pi, req, refundedAmount = 0) {
    const now = Date.now();
    const intent = pi ? pi.id : typeof s.payment_intent === 'string' ? s.payment_intent : '';
    const revoked = Math.floor(o.coins * refundedAmount / o.amount), granted = o.coins - revoked;
    const done = tx(() => {
      const r = q(`UPDATE pay_orders SET status = ?, paid_at = ?, intent_id = ?, voucher_url = '', updated_at = ?, refunded_amount = ?, coins_revoked = ?, refunded_at = ? WHERE id = ? AND status IN ${UNPAID}`)
        .run(refundedAmount === o.amount ? 'refunded' : 'paid', now, String(intent).slice(0, 255), now, refundedAmount, revoked, refundedAmount ? now : 0, o.id);
      if (!Number(r.changes)) return false;
      q('UPDATE users SET coins = coins + ?, rev = rev + 1 WHERE id = ?').run(granted, o.user_id);
      return true;
    });
    const after = getOrder(o.id);
    if (!done) return after;
    const p = getUser(o.user_id);
    balanceChanged(o.user_id);
    tell(after);
    live.broadcast('support', { meters: meters() });
    if (p && granted) {
      const plan = planOf(o.plan);
      official.say(p.id, `【ご支援ありがとうございます】\n\n${p.name}様\n\nこのたびは「${plan.name}」を${o.qty}口（${yen(o.amount)}）ご購入いただき、誠にありがとうございます！\n` +
        `ロイヤルコイン ${granted}枚${refundedAmount ? `（${yen(refundedAmount)}返金分を除く）` : o.bonus ? `（感謝料 ${o.bonus}枚を含む）` : ''}をお届けしました。\n\n` +
        'いただいたお金は Two state の開発費にのみ使います。\n開発者からのメッセージをお待ちください。\n\nIce Smoker公式より');
    }
    opsLog.add({
      actorName: 'Stripe', action: 'pay_paid', target: p, req,
      summary: `${p ? p.name : '?'}さんが${planOf(o.plan).name}を${o.qty}口購入（${yen(o.amount)}・${dto(o).methodName}）：ロイヤルコイン${granted}枚を付与${refundedAmount ? `（返金${yen(refundedAmount)}）` : ''}`,
      detail: { order: o.id, plan: o.plan, qty: o.qty, amount: o.amount, coins: granted, refunded: refundedAmount, coinsWithheld: revoked, bonus: o.bonus, method: o.method, session: s.id, intent, livemode: !!s.livemode, coinsAfter: p ? p.coins : null }
    });
    return after;
  }

  // konbini: the slip (its page on Stripe and until when it can be paid)
  function slip(o, pi, req) {
    const v = pi && pi.next_action && pi.next_action.konbini_display_details;
    const url = v && /^https:\/\/payments\.stripe\.com\/[\w/?=&.-]+$/.test(String(v.hosted_voucher_url || '')) ? String(v.hosted_voucher_url) : '';
    const until = v && Number(v.expires_at) > 0 ? Number(v.expires_at) * 1000 : 0;
    const r = q("UPDATE pay_orders SET status = 'pending', intent_id = ?, voucher_url = ?, voucher_until = ?, updated_at = ? WHERE id = ? AND status IN ('new', 'open', 'pending', 'error')")
      .run(pi ? String(pi.id).slice(0, 255) : '', url, until, Date.now(), o.id);
    const after = getOrder(o.id);
    if (Number(r.changes) && o.status !== 'pending') {
      tell(after);
      const p = getUser(o.user_id);
      opsLog.add({ actorName: 'Stripe', action: 'pay_slip', target: p, req, summary: `${p ? p.name : '?'}さんがコンビニ払いの支払い番号を発行（${planOf(o.plan).name}×${o.qty}・${yen(o.amount)}）`, detail: { order: o.id, until } });
    }
    return after;
  }

  // not paid: the page expired, or the konbini slip ran out
  function settle(o, status, req) {
    const r = q(`UPDATE pay_orders SET status = ?, voucher_url = '', updated_at = ? WHERE id = ? AND status IN ('new', 'open', 'pending', 'error')`).run(status, Date.now(), o.id);
    const after = getOrder(o.id);
    if (Number(r.changes)) {
      tell(after);
      if (o.status === 'pending') {
        const p = getUser(o.user_id);
        opsLog.add({ actorName: 'Stripe', action: 'pay_unpaid', target: p, req, summary: `${p ? p.name : '?'}さんのコンビニ払い（${yen(o.amount)}）は期限までに支払われなかった`, detail: { order: o.id, status } });
      }
    }
    return after;
  }

  // Stripe's answer does not match the order: nothing is given; the developer looks
  function review(o, wrong, s, req) {
    const r = q("UPDATE pay_orders SET status = 'review', updated_at = ? WHERE id = ? AND status NOT IN ('paid', 'refunded', 'review')").run(Date.now(), o.id);
    console.error('pay: Stripe answer does not match order', o.id, wrong.join(','));
    if (Number(r.changes)) {
      const p = getUser(o.user_id);
      opsLog.add({
        actorName: 'システム', action: 'pay_review', target: p, req,
        summary: `注文 ${o.id.slice(0, 8)}…（${p ? p.name : '?'}さん）は Stripe の内容が注文と一致しないため保留（ロイヤルコインは付与していません）`,
        detail: {
          order: o.id, wrong, expected: { amount: o.amount, currency: 'jpy', session: o.session_id, livemode: stripe.live },
          stripe: s && typeof s === 'object' ? { id: s.id, object: s.object, amount_total: s.amount_total, currency: s.currency, client_reference_id: s.client_reference_id, livemode: s.livemode, payment_status: s.payment_status, status: s.status } : null
        }
      });
    }
    return getOrder(o.id);
  }

  // Cumulative proportional entitlement, rounded down once over the total.
  // Separate it from coins actually recovered so retries never collect twice.
  function refunded(o, amount, req) {
    const now = Date.now();
    let back = 0;
    const done = tx(() => {
      const u = getUser(o.user_id);
      const cur = getOrder(o.id);
      if (!['paid', 'refunded'].includes(cur.status) || amount <= cur.refunded_amount) return false;
      const revoked = Math.floor(cur.coins * amount / cur.amount);
      back = Math.min(Math.max(0, revoked - cur.coins_revoked), u ? u.coins : 0);
      const r = q("UPDATE pay_orders SET status = ?, refunded_at = ?, refunded_amount = ?, coins_revoked = ?, coins_back = coins_back + ?, updated_at = ? WHERE id = ? AND status IN ('paid', 'refunded') AND refunded_amount < ?")
        .run(amount === cur.amount ? 'refunded' : 'paid', now, amount, revoked, back, now, o.id, amount);
      if (!Number(r.changes)) return false;
      if (back > 0) q('UPDATE users SET coins = coins - ?, rev = rev + 1 WHERE id = ?').run(back, o.user_id);
      return true;
    });
    const after = getOrder(o.id);
    if (!done) return after;
    const p = getUser(o.user_id);
    balanceChanged(o.user_id);
    tell(after);
    live.broadcast('support', { meters: meters() });
    opsLog.add({
      actorName: 'Stripe', action: 'pay_refund', target: p, req,
      summary: `${p ? p.name : '?'}さんの${planOf(o.plan).name}×${o.qty}の返金は累計${yen(amount)}：ロイヤルコイン${back}枚を回収`,
      detail: { order: o.id, refunded: amount, amount: o.amount, coins: o.coins, coinsBack: back }
    });
    return after;
  }

  // the order a payment page belongs to (also one whose page Stripe made
  // though its answer never came back here: the page tells its order)
  function orderFor(s) {
    const bySession = q('SELECT * FROM pay_orders WHERE session_id = ?').get(String(s.id || ''));
    if (bySession) return bySession;
    const ref = String(s.client_reference_id || '');
    if (!ID_RE.test(ref) || !/^cs_\w{8,250}$/.test(String(s.id || ''))) return null;
    const o = getOrder(ref);
    if (!o || o.session_id) return null;
    q("UPDATE pay_orders SET session_id = ? WHERE id = ? AND session_id = ''").run(s.id, o.id);
    return getOrder(o.id);
  }

  async function onEvent(ev, req) {
    const obj = ev.data.object;
    if (ev.type.startsWith('checkout.session.')) {
      if (!EVENTS.includes(ev.type) || obj.object !== 'checkout.session') return '';
      const o = orderFor(obj);
      if (!o) {
        opsLog.add({ actorName: 'Stripe', action: 'pay_unknown', req, summary: `Stripe から注文の見つからない通知（${ev.type}）`, detail: { event: ev.id, type: ev.type, session: String(obj.id || '').slice(0, 255) } });
        return '';
      }
      await sync(o, ev.type, req);
      return o.id;
    }
    if (ev.type === 'charge.refunded' && obj.object === 'charge') {
      const intent = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent && obj.payment_intent.id;
      if (!intent) return '';
      const pi = await stripe.intent(intent);
      const o = q('SELECT * FROM pay_orders WHERE intent_id = ?').get(String(intent)) || (ID_RE.test(String(pi?.metadata?.order || '')) ? getOrder(pi.metadata.order) : null);
      if (o) {
        if (!o.session_id) throw new Error('checkout session not yet recorded');
        await sync(o, ev.type, req);
      }
      return o ? o.id : '';
    }
    return '';
  }

  // wrong signatures: one entry in 10 minutes at most, however many came (the
  // operators' log can never be cleaned, so nobody can fill it from outside)
  const bad = { at: 0, count: 0 };
  function badSignature(req) {
    bad.count++;
    if (Date.now() - bad.at < 600000) return;
    opsLog.add({ actorName: 'システム', action: 'pay_bad_signature', req, summary: `署名の正しくない決済通知を拒否しました（Stripe からではない可能性・前回の記録から${bad.count}件）`, detail: { refused: bad.count } });
    bad.at = Date.now();
    bad.count = 0;
  }

  // the player's own order (anything else: not found)
  function mine(u, id) {
    const o = ID_RE.test(String(id || '')) ? getOrder(String(id)) : null;
    if (!o || o.user_id !== u.id) throw new ApiError(404, 'no_order', '注文が見つかりません');
    return o;
  }

  function sessionParams(o, plan, method, u) {
    const p = {
      mode: 'payment',
      client_reference_id: o.id,
      metadata: { order: o.id, user: String(u.id) },
      payment_method_types: [method.id],
      line_items: [{
        quantity: o.qty,
        price_data: {
          currency: 'jpy',
          unit_amount: plan.price,
          product_data: {
            name: `${plan.name}（ロイヤルコイン${plan.coins}枚${plan.bonus ? `＋感謝料${plan.bonus}枚` : ''}）`,
            description: 'Two state Casino RP の開発者への支援です（開発費にのみ使用）。ロイヤルコインはVIP用のコインで、賭け・交換・換金はできません。',
            images: [`${config.publicUrl}/icons/icon-512.png`]
          }
        }
      }],
      payment_intent_data: { description: `Two state 開発者支援 ${o.id}`, metadata: { order: o.id, user: String(u.id) } },
      success_url: `${config.publicUrl}/?pay=done&order=${o.id}`,
      cancel_url: `${config.publicUrl}/?pay=cancel&order=${o.id}`,
      expires_at: Math.floor((Date.now() + PAGE_MS) / 1000),
      locale: 'ja'
    };
    if (method.id === 'konbini') p.payment_method_options = { konbini: { expires_after_days: SUPPORT.konbiniDays } };
    return p;
  }

  function needDeveloper(u) {
    if (!isDeveloper(u)) throw new ApiError(403, 'not_developer', '課金の画面は開発者のアカウントだけが使えます');
  }

  const routes = {
    // the purchase screen: plans, ways to pay, the meters, the player's orders
    'GET /api/pay/info': (req, u) => {
      rate(limits.look, u.id);
      const now = Date.now();
      return {
        on, test: mode === 'test',
        plans: SUPPORT.plans, maxQty: SUPPORT.maxQty, konbiniDays: SUPPORT.konbiniDays,
        methods: methods.map((m) => ({ id: m.id, name: m.name, min: m.min, max: m.max })),
        dailyMax, dailyLeft: Math.max(0, dailyMax - spent(u.id, now)),
        adult: u.age_ok === 1, ageAsked: u.age_ok === 0 || u.age_ok === 1,
        meters: meters(now),
        orders: q('SELECT * FROM pay_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').all(u.id).map(dto),
        now
      };
    },

    // An order and Stripe's payment page for it: { order, url } (the game goes to `url`).
    'POST /api/pay/checkout': async (req, u) => {
      rate(limits.checkout, u.id);
      rate(limits.checkoutIp, req.ip || '-');
      if (!on) throw new ApiError(503, 'pay_off', '開発者支援はただいま準備中です');
      if (u.npc) throw new ApiError(403, 'forbidden', 'このアカウントでは購入できません');
      const body = await req.json();
      if (u.age_ok !== 1) throw new ApiError(403, 'age', '購入は18歳以上の方に限ります');
      const plan = PLANS.get(String(body.plan || ''));
      if (!plan) throw new ApiError(400, 'bad_plan', 'プランを選んでください');
      const qty = Number(body.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > SUPPORT.maxQty) throw new ApiError(400, 'bad_qty', `口数は1〜${SUPPORT.maxQty}口で選んでください`);
      const method = methods.find((m) => m.id === String(body.method || ''));
      if (!method) throw new ApiError(400, 'bad_method', '支払い方法を選んでください');
      const amount = plan.price * qty;
      if (amount < method.min) throw new ApiError(400, 'too_small', `${method.name}は合計${yen(method.min)}からです（いまの合計は${yen(amount)}）`);
      if (amount > method.max) throw new ApiError(400, 'too_large', `${method.name}は合計${yen(method.max)}までです`);
      const now = Date.now();
      const id = crypto.randomBytes(16).toString('hex');
      // the checks and the order together (two taps at once make one order)
      tx(() => {
        const w = q(`SELECT SUM(CASE WHEN status = 'pending' AND (voucher_until = 0 OR voucher_until > ?) THEN 1 ELSE 0 END) AS slips,
                            SUM(CASE WHEN status IN ('new', 'open') AND created_at > ? THEN 1 ELSE 0 END) AS pages
                     FROM pay_orders WHERE user_id = ? AND created_at > ?`).get(now, now - PAGE_MS - 300000, u.id, now - 60 * DAY);
        if ((w.slips || 0) >= SLIPS_MAX) throw new ApiError(429, 'slips', `コンビニ払い待ちの注文が${SLIPS_MAX}件あります。お支払い後か期限が過ぎてからお試しください`);
        if ((w.pages || 0) >= PAGES_MAX) throw new ApiError(429, 'pages', '開いたままの支払いページが多すぎます（30分で自動的に取り消されます）。しばらくしてからお試しください');
        if (spent(u.id, now) + amount > dailyMax) throw new ApiError(429, 'daily_max', `購入は24時間で${yen(dailyMax)}までです`);
        q(`INSERT INTO pay_orders (id, user_id, plan, qty, coins, bonus, amount, method, status, livemode, ip, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`)
          .run(id, u.id, plan.id, qty, (plan.coins + plan.bonus) * qty, plan.bonus * qty, amount, method.id, stripe.live ? 1 : 0, String(req.ip || '').slice(0, 64), now, now);
      });
      const o = getOrder(id);
      let s;
      try {
        s = await stripe.createSession(sessionParams(o, plan, method, u), id);
        if (!s || !/^cs_\w{8,250}$/.test(String(s.id || '')) || s.client_reference_id !== id || !/^https:\/\/checkout\.stripe\.com\/\S+$/.test(String(s.url || ''))) {
          throw new Error('unexpected answer from Stripe');
        }
      } catch (e) {
        q("UPDATE pay_orders SET status = 'error', updated_at = ? WHERE id = ? AND status = 'new'").run(Date.now(), id);
        console.error('pay: no payment page', id, e && e.message);
        opsLog.add({ actor: u, action: 'pay_error', target: u, req, summary: `${u.name}さんの支払いページを用意できなかった（Stripe）`, detail: { order: id, error: String((e && e.message) || '').slice(0, 300), code: (e && e.code) || '' } });
        throw new ApiError(502, 'pay_provider', '決済ページを用意できませんでした。少し待ってからもう一度お試しください');
      }
      try {
        req.revalidate?.();
        if (getUser(u.id)?.age_ok !== 1) throw new ApiError(403, 'age', '購入は18歳以上の方に限ります');
        tx(() => {
          mine(u, id);
          q("UPDATE pay_orders SET status = 'open', session_id = ?, updated_at = ? WHERE id = ? AND status = 'new'").run(s.id, Date.now(), id);
          opsLog.add({
            actor: u, action: 'pay_order', target: u, req,
            summary: `${u.name}さんが${plan.name}×${qty}（${yen(amount)}・${method.name}）の支払いページを開いた`,
            detail: { order: id, plan: plan.id, qty, amount, method: method.id, session: s.id, livemode: stripe.live }
          });
        });
      } catch (e) {
        // Never hand out an unrecorded page or one authorized by an ended
        // session. Keep its identity so a payment already made is honoured.
        try { await stripe.expireSession(s.id); } catch { /* may already be paid */ }
        q("UPDATE pay_orders SET session_id = CASE WHEN session_id = '' THEN ? ELSE session_id END, status = CASE WHEN status = 'new' THEN 'error' ELSE status END, updated_at = ? WHERE id = ?")
          .run(s.id, Date.now(), id);
        throw e;
      }
      return { order: dto(getOrder(id)), url: s.url };
    },

    // one of the player's orders (asked at Stripe when it may have changed)
    'GET /api/pay/order': async (req, u) => {
      rate(limits.look, u.id);
      const o = mine(u, req.query.get('id'));
      if (on && o.session_id && ['new', 'open', 'pending', 'error'].includes(o.status) && Date.now() - o.checked_at > RECHECK_MS) {
        try { await sync(o, '', req); } catch (e) { console.error('pay: check failed', o.id, e && e.message); }
      }
      req.revalidate?.();
      return { order: dto(mine(u, o.id)), meters: meters() };
    },

    // back from the payment page without paying: the page is closed at Stripe
    'POST /api/pay/cancel': async (req, u) => {
      rate(limits.look, u.id);
      const body = await req.json();
      const o = mine(u, body.order);
      if (on && o.status === 'open' && o.session_id) {
        try { await stripe.expireSession(o.session_id); } catch { /* paid meanwhile, or already closed: asked below */ }
        try { await sync(o, '', req); } catch (e) { console.error('pay: check failed', o.id, e && e.message); }
        q("UPDATE pay_orders SET status = 'canceled', updated_at = ? WHERE id = ? AND status IN ('open', 'expired')").run(Date.now(), o.id);
      }
      req.revalidate?.();
      return { order: dto(mine(u, o.id)) };
    },

    // Stripe's notices (no login: the signature proves who sent it)
    'POST /api/pay/webhook': async (req) => {
      rate(limits.hook, req.ip || '-');
      const raw = await req.bytes(256 * 1024);
      if (!on) throw new ApiError(503, 'pay_off', 'payments are off');
      const ev = stripe.verify(raw, req.header('stripe-signature'));
      if (!ev) {
        badSignature(req);
        throw new ApiError(400, 'signature', 'invalid signature');
      }
      if (!!ev.livemode !== stripe.live) return { received: true };
      if (q('SELECT 1 AS x FROM pay_events WHERE id = ?').get(String(ev.id))) return { received: true };
      let orderId = '';
      try {
        orderId = await onEvent(ev, req);
      } catch (e) {
        // Stripe tries again later
        console.error('pay: notice not handled', ev.id, ev.type, e && e.message);
        throw new ApiError(503, 'retry', 'try again later');
      }
      q('INSERT OR IGNORE INTO pay_events (id, type, order_id, at) VALUES (?, ?, ?, ?)').run(String(ev.id).slice(0, 255), String(ev.type).slice(0, 100), orderId || '', Date.now());
      return { received: true };
    },

    // 特定商取引法に基づく表記 (law.html; no login)
    'GET /api/pay/seller': (req) => {
      rate(limits.seller, req.ip || '-');
      const s = config.seller;
      return {
        seller: { name: s.name, head: s.head, address: s.address, phone: s.phone, email: s.email, hours: s.hours },
        plans: SUPPORT.plans, maxQty: SUPPORT.maxQty, konbiniDays: SUPPORT.konbiniDays, dailyMax,
        methods: methods.map((m) => ({ id: m.id, name: m.name, min: m.min, max: m.max })),
        on, test: mode === 'test'
      };
    },

    /* ----- the operator site's 課金 tab (the developer's own) ----- */

    // the players waiting for the developer's words (first paid first), and every order
    'GET /api/ops/pay': (req, u) => {
      needDeveloper(u);
      const now = Date.now();
      const by = new Map();
      for (const o of q("SELECT * FROM pay_orders WHERE status = 'paid' AND replied_at = 0 ORDER BY paid_at, id").all()) {
        let w = by.get(o.user_id);
        if (!w) {
          const p = getUser(o.user_id);
          w = { player: brief(p) || { id: o.user_id, name: '?', avatar: '', online: false }, items: {}, coins: 0, amount: 0, orders: 0, first: o.paid_at, last: 0 };
          by.set(o.user_id, w);
        }
        const it = w.items[o.plan] || (w.items[o.plan] = { plan: o.plan, name: planOf(o.plan).name, qty: 0, amount: 0, coins: 0 });
        it.qty += o.qty;
        it.amount += o.amount - o.refunded_amount;
        it.coins += o.coins - o.coins_revoked;
        w.coins += o.coins - o.coins_revoked;
        w.amount += o.amount - o.refunded_amount;
        w.orders++;
        w.last = Math.max(w.last, o.paid_at);
      }
      const order = SUPPORT.plans.map((p) => p.id);
      const waiting = [...by.values()].map((w) => ({ ...w, items: Object.values(w.items).sort((a, b) => order.indexOf(a.plan) - order.indexOf(b.plan)) }));
      const orders = q('SELECT * FROM pay_orders ORDER BY created_at DESC LIMIT 300').all().map((o) => ({
        ...dto(o), player: brief(getUser(o.user_id)), repliedAt: o.replied_at, reply: o.reply, coinsBack: o.coins_back
      }));
      return {
        setup: {
          on, mode, problems, methods: methods.map((m) => m.name), dailyMax, events: EVENTS,
          webhook: config.publicUrl ? `${config.publicUrl}/api/pay/webhook` : '', seller: !!config.seller.name
        },
        meters: meters(now), totals: totals(now), waiting, orders, now
      };
    },

    // The developer's words to a player who paid (through the official bot);
    // their purchases up to `upto` leave the waiting list.
    'POST /api/ops/pay/reply': async (req, u) => {
      needDeveloper(u);
      const body = await req.json(64 * 1024);
      const p = getUser(posInt(body.id, 'プレイヤー'));
      if (!p || p.npc) throw new ApiError(404, 'not_found', 'プレイヤーが見つかりません');
      const text = cleanText(body.text, 5000);
      const upto = Number.isSafeInteger(Number(body.upto)) && Number(body.upto) > 0 ? Number(body.upto) : Date.now();
      const rows = q("SELECT * FROM pay_orders WHERE user_id = ? AND status = 'paid' AND replied_at = 0 AND paid_at <= ?").all(p.id, upto);
      if (!rows.length) throw new ApiError(409, 'done', `${p.name}さんへの返信はもう済んでいます`);
      return tx(() => {
        const full = `【開発者からのメッセージ】\n\n${p.name}様\n\n${text}\n\nTwo state 開発者 ${u.name}`;
        const message = official.say(p.id, full);
        const now = Date.now();
        q("UPDATE pay_orders SET replied_at = ?, replied_by = ?, reply = ? WHERE user_id = ? AND status = 'paid' AND replied_at = 0 AND paid_at <= ?").run(now, u.id, text, p.id, upto);
        const amount = rows.reduce((s, o) => s + o.amount - o.refunded_amount, 0);
        opsLog.add({
          actor: u, action: 'pay_reply', target: p, req,
          summary: `${p.name}さんの開発者支援（${rows.length}件・${yen(amount)}）に開発者が返信`,
          detail: { orders: rows.map((o) => o.id), amount, text, sent: full, messageId: message.id }
        });
        return { ok: true, replied: rows.length };
      });
    }
  };

  // Orders whose notice may have been lost: payment pages past their time,
  // konbini slips past theirs, are asked about at Stripe (a few each time).
  async function sweep() {
    if (!on) return;
    const now = Date.now();
    q("UPDATE pay_orders SET status = 'error', updated_at = ? WHERE status = 'new' AND session_id = '' AND created_at < ?").run(now, now - PAGE_MS - 60000);
    const due = q(`SELECT * FROM pay_orders WHERE session_id != '' AND created_at > ? AND (
                     (status IN ('new', 'open', 'error') AND created_at < ? AND checked_at < ?)
                     OR (status = 'pending' AND checked_at < ? AND ((voucher_until > 0 AND voucher_until < ?) OR (voucher_until = 0 AND created_at < ?))))
                   ORDER BY created_at LIMIT 20`)
      .all(now - 60 * DAY, now - PAGE_MS - 60000, now - 3600000, now - 6 * 3600000, now - 3600000, now - (SUPPORT.konbiniDays + 2) * DAY);
    for (const o of due) {
      try { await sync(o); } catch (e) { console.error('pay: sweep', o.id, e && e.message); }
    }
  }

  // how many players wait for the developer's words (the tab's number; the operator site's poll asks for no more than this unless the tab is open)
  const waitingCount = () => q("SELECT COUNT(DISTINCT user_id) AS n FROM pay_orders WHERE status = 'paid' AND replied_at = 0").get().n;

  return { routes, public: ['POST /api/pay/webhook', 'GET /api/pay/seller'], sweep, meters, on, mode, waitingCount };
}
