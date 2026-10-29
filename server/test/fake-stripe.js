// Local payment provider for disposable tests; never contacts Stripe.
import http from 'node:http';
import crypto from 'node:crypto';

// Stripe's API as far as the game uses it: payment pages, payments, expiry
export function fakeStripe(secretKey) {
  const sessions = new Map(), intents = new Map(), keys = new Map(), seen = [];
  let n = 0;
  function view(s, expand) {
    const out = { ...s };
    if (s.payment_intent && expand) out.payment_intent = intents.get(s.payment_intent);
    return out;
  }
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== `Bearer ${secretKey}`) return send(401, { error: { message: 'Invalid API Key provided' } });
      const f = new URLSearchParams(body);
      seen.push({ method: req.method, path: url.pathname, form: f, version: req.headers['stripe-version'], idem: req.headers['idempotency-key'] });
      let m;
      if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
        const key = req.headers['idempotency-key'];
        if (key && keys.has(key)) return send(200, view(sessions.get(keys.get(key))));
        const id = `cs_test_${++n}${crypto.randomBytes(8).toString('hex')}`;
        const s = {
          id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, client_reference_id: f.get('client_reference_id'),
          metadata: { order: f.get('metadata[order]'), user: f.get('metadata[user]') }, mode: f.get('mode'), currency: f.get('line_items[0][price_data][currency]'),
          amount_total: Number(f.get('line_items[0][price_data][unit_amount]')) * Number(f.get('line_items[0][quantity]')),
          livemode: false, status: 'open', payment_status: 'unpaid', payment_intent: null
        };
        sessions.set(id, s);
        if (key) keys.set(key, id);
        return send(200, view(s));
      }
      if (req.method === 'GET' && (m = /^\/v1\/checkout\/sessions\/(cs_\w+)$/.exec(url.pathname))) {
        const s = sessions.get(m[1]);
        return s ? send(200, view(s, /^payment_intent(?:\.latest_charge)?$/.test(url.searchParams.get('expand[0]') || ''))) : send(404, { error: { message: 'No such checkout.session' } });
      }
      if (req.method === 'POST' && (m = /^\/v1\/checkout\/sessions\/(cs_\w+)\/expire$/.exec(url.pathname))) {
        const s = sessions.get(m[1]);
        if (!s || s.status !== 'open') return send(400, { error: { message: 'not open' } });
        s.status = 'expired';
        return send(200, view(s));
      }
      if (req.method === 'GET' && (m = /^\/v1\/payment_intents\/(pi_\w+)$/.exec(url.pathname))) {
        const pi = intents.get(m[1]);
        return pi ? send(200, pi) : send(404, { error: { message: 'No such payment_intent' } });
      }
      send(404, { error: { message: 'Unrecognized request URL' } });
    });
  });
  function intent(s, status, extra = {}) {
    const id = `pi_test_${s.id.slice(8)}`;
    intents.set(id, { id, object: 'payment_intent', amount: s.amount_total, currency: 'jpy', livemode: false, status, metadata: { order: s.client_reference_id, user: s.metadata.user },
      latest_charge: { id: `ch_test_${s.id.slice(8)}`, object: 'charge', payment_intent: id, amount: s.amount_total, currency: 'jpy', livemode: false, amount_refunded: 0 }, ...extra });
    s.payment_intent = id;
    return intents.get(id);
  }
  return {
    server, sessions, intents, seen,
    pay(id) { const s = sessions.get(id); s.status = 'complete'; s.payment_status = 'paid'; intent(s, 'succeeded'); return s; },
    slip(id) {
      const s = sessions.get(id);
      s.status = 'complete';
      intent(s, 'requires_action', { next_action: { type: 'konbini_display_details', konbini_display_details: { hosted_voucher_url: 'https://payments.stripe.com/konbini/voucher/test_abc123', expires_at: Math.floor(Date.now() / 1000) + 3 * 86400 } } });
      return s;
    },
    cash(id) { const s = sessions.get(id); s.payment_status = 'paid'; intents.get(s.payment_intent).status = 'succeeded'; return s; },
    refund(id) { const s = sessions.get(id); intents.get(s.payment_intent).latest_charge.amount_refunded = s.amount_total; return s; }
  };
}
