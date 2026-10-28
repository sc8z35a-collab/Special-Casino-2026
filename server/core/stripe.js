// Stripe (https://stripe.com), the payment company behind 開発者支援
// (server/core/pay.js): its hosted payment page (Checkout) for PayPay and
// konbini, what it says about a payment when asked, and the signed notices
// (webhooks) it sends when one is done. Players pay on Stripe's own page:
// PayPay logins and the like never reach this server, and nothing here takes
// a payment's word from the browser. Only fetch() and node:crypto, so it runs
// the same on Node and on Cloudflare Workers.
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

// the API version the requests are written for (PayPay needs this one or later)
export const API_VERSION = '2025-09-30.clover';
// a signed notice is good for 5 minutes (replays of old ones are refused)
const TOLERANCE_S = 300;
const TIMEOUT_MS = 15000;

// What Stripe's key looks like: secret (sk_) or restricted (rk_), live or test.
export const KEY_RE = /^(?:sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/;
export const WEBHOOK_SECRET_RE = /^whsec_[A-Za-z0-9+/=]{16,}$/;
// ids Stripe gives: what may be put into a request path
const ID_RE = /^(?:cs|pi|ch|evt|re)_[A-Za-z0-9_]{8,250}$/;

export class StripeError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.name = 'StripeError';
    this.status = status;
    this.code = code;
  }
}

// Parameters the way Stripe reads them: a[b][0][c]=v
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === 'object') flatten(x, `${key}[${i}]`, out);
        else out.push([`${key}[${i}]`, String(x)]);
      });
    } else if (typeof v === 'object') {
      flatten(v, key, out);
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

// `secretKey`: STRIPE_SECRET_KEY; `webhookSecrets`: the endpoint's signing
// secrets (more than one while it is being replaced); `api`: Stripe's address
// (another one only in tests, and then only on this machine).
export function createStripe({ secretKey, webhookSecrets, api = '', apiVersion = '' }) {
  const base = api || 'https://api.stripe.com';
  const version = apiVersion || API_VERSION;
  const live = (KEY_RE.exec(secretKey) || [])[1] === 'live';

  async function call(method, path, params, idempotencyKey) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const headers = { Authorization: `Bearer ${secretKey}`, 'Stripe-Version': version };
      let url = base + path, body;
      const pairs = params ? flatten(params) : [];
      if (method === 'GET') {
        if (pairs.length) url += '?' + new URLSearchParams(pairs).toString();
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(pairs).toString();
      }
      // the same order asked twice (a retry): Stripe answers with the same page
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      let res;
      try {
        // (Stripe's API never redirects: a redirect is not followed and counts as a failure)
        res = await fetch(url, { method, headers, body, signal: ctl.signal, redirect: 'manual' });
      } catch (e) {
        throw new StripeError(ctl.signal.aborted ? 'Stripe did not answer in time' : 'Stripe could not be reached', 0, 'network');
      }
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || typeof json !== 'object') {
        const err = (json && json.error) || {};
        // (what Stripe said goes to the server's log, never to the player)
        throw new StripeError(`Stripe ${res.status}: ${String(err.message || 'no answer').slice(0, 300)}`, res.status, String(err.code || err.type || ''));
      }
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
  function id(v) {
    if (!ID_RE.test(String(v || ''))) throw new StripeError('not a Stripe id', 0, 'bad_id');
    return String(v);
  }

  return {
    live,
    // the hosted payment page for an order (Stripe makes it once per order id)
    createSession: (params, orderId) => call('POST', '/v1/checkout/sessions', params, `two-state-order-${orderId}`),
    // a payment page as Stripe knows it now, with its payment
    session: (sessionId) => call('GET', `/v1/checkout/sessions/${id(sessionId)}`, { expand: ['payment_intent.latest_charge'] }),
    // closes a payment page nobody paid on (it can no longer be paid)
    expireSession: (sessionId) => call('POST', `/v1/checkout/sessions/${id(sessionId)}/expire`),
    // a payment as Stripe knows it now, with its charge (refunds)
    intent: (intentId) => call('GET', `/v1/payment_intents/${id(intentId)}`, { expand: ['latest_charge'] }),

    // A notice is Stripe's only if one of its v1 signatures is the HMAC-SHA256
    // of "<t>.<the body as sent>" with one of the endpoint's secrets (compared
    // in constant time) and <t> is within 5 minutes of now. Returns the event,
    // or null for anything else.
    verify(raw, header, now = Date.now()) {
      if (!webhookSecrets.length) return null;
      let t = 0;
      const sigs = [];
      for (const part of String(header || '').split(',')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
        if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
        else if (k === 'v1' && /^[0-9a-f]{64}$/.test(v)) sigs.push(Buffer.from(v, 'hex'));
      }
      if (!t || !sigs.length || sigs.length > 8) return null;
      if (Math.abs(now / 1000 - t) > TOLERANCE_S) return null;
      const signed = Buffer.concat([Buffer.from(`${t}.`, 'utf8'), Buffer.from(raw)]);
      let ok = false;
      for (const secret of webhookSecrets) {
        const want = crypto.createHmac('sha256', secret).update(signed).digest();
        for (const got of sigs) if (crypto.timingSafeEqual(got, want)) ok = true;
      }
      if (!ok) return null;
      try {
        const ev = JSON.parse(Buffer.from(raw).toString('utf8'));
        return ev && typeof ev === 'object' && typeof ev.id === 'string' && typeof ev.type === 'string' && ev.data && typeof ev.data.object === 'object' ? ev : null;
      } catch {
        return null;
      }
    }
  };
}
