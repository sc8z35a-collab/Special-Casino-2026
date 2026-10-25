// The secure channel's client for the tests: the same code the browsers run (js/net/secchannel.js), talking to a test server for a login.
// secureClient(s, token) → { chan, call(method, path, body) } where call gives what s.call gives (`status` and the JSON, an error as
// { status, error: { code, message } }), after the channel has sealed the request and opened the answer.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// (a classic script for the page: it is run here in a context of its own that has the platform's crypto and the page's usual globals)
globalThis.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/net/secchannel.js'), 'utf8'));
export const SC = globalThis.BR.secChannel;

export function memoryPins() {
  let v = '';
  return { get: () => v, set: (x) => { v = x; } };
}

// extra: headers every request carries (the passkey gate's, when a test has one); sign(method, path) → headers, for a gate that signs each request
export function secureClient(s, token, { extra = {}, sign = null, env = null, pins = memoryPins(), uid = 0, origin = '' } = {}) {
  const url = new URL(s.base);
  const asked = [];
  const request = async (method, p, body, more = {}) => {
    const headers = { ...extra, ...more, ...(sign ? await sign(method, p.split('?')[0]) : {}) };
    // (a browser sends the page's own address with every POST)
    if (method !== 'GET') headers.Origin = origin || s.base;
    const r = await s.call(method, p, { token, body, headers });
    asked.push([method, p, r.status]);
    if (r.status >= 400) throw { status: r.status, code: r.error && r.error.code, message: r.error && r.error.message, ...(r.error || {}) };
    return r;
  };
  const chan = SC.create({ request, uid, pins, env: env || { protocol: 'http:', host: url.host, origin: s.base, secureContext: true, framed: false } });
  return {
    chan, asked, request,
    call: async (method, p, body) => {
      try { return { status: 200, ...(await chan.call(method, p, body)) }; } catch (e) { return { status: e.status, error: { code: e.code, message: e.message }, ...(e.extra || {}) }; }
    }
  };
}

// A stand-in for s.call on the base's routes (same arguments, same answers): each login gets a channel of its own the first time it
// is used, and keeps it. For the tests that only want what the base says, not how it is sealed. One per server.
const made = new WeakMap();
export function sealedCall(s, options = {}) {
  if (made.has(s)) return made.get(s);
  const clients = new Map();
  const f = async (method, url, { token, body } = {}) => {
    let c = clients.get(token);
    if (!c) { c = secureClient(s, token, options); clients.set(token, c); }
    return c.call(method, url, body);
  };
  made.set(s, f);
  return f;
}
