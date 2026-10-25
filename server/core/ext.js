// Extensions: parts a deployment may add to the server without the game
// knowing what they do. They are listed in server/ext/index.js (empty here).
// An extension is an object:
//   id, version                what it is called, and which build of it
//   guards: ['upload']         the uploads it stands at the gate of (see below)
//   migrations: [[sql…], …]    tables of its own, applied once each, in order
//   routes(ctx)                { 'POST /api/ops/x/…': (req, user) => … }: only under
//                              /api/ops/x/ (so the passkey and the staff checks of the
//                              operator site apply, and the tests that every staff
//                              route refuses strangers cover them)
//   hooks: { create(info, ctx), finish(info, ctx), inline(info, ctx) }
//                              asked before a vault file is made, before it is
//                              whole, and for a small file that comes in one piece (the
//                              diary's picture); they throw an ApiError to refuse
//   assets: { name: { type, body, kind: 'script' | 'worker', headers } } and
//   boot(user, ctx) → [names]  the files the operator site gets for this person: each
//                              comes by a ticket good for two minutes, from /api/ext/asset
// `ctx` is what the extension may use of the server: q, tx, exec, config, opsLog,
// getUser, isDeveloper, ops, secret, clock, notice, ApiError, keyFrom.
// An extension that guards uploads and was there before but is not now (a deploy
// that left it out) shuts the uploads rather than let them through unchecked; the
// developer says it is meant with `ext-forget <id>` (server/core/admin.js).
import crypto from 'node:crypto';
import { ApiError } from './errors.js';
import { keyFrom } from './auth.js';
import { Raw } from './raw.js';

const TICKET_MS = 120000;
const SEEN = 'ext_seen';
const ROUTE = /^(?:GET|POST) \/api\/ops\/x\//;

const readSeen = (q) => {
  try { const r = q('SELECT value FROM meta WHERE key = ?').get(SEEN); return r ? JSON.parse(r.value) : {}; } catch { return {}; }
};
const writeSeen = (q, seen) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(SEEN, JSON.stringify(seen));

// the developer says an extension that is gone is meant to be
export function forgetExtension(q, id) {
  const seen = readSeen(q);
  const had = Object.prototype.hasOwnProperty.call(seen, id);
  delete seen[id];
  writeSeen(q, seen);
  return had;
}

export function createExtensions({ list = [], ctx, secret, clock = Date.now }) {
  const { q } = ctx;
  const key = keyFrom(secret, 'ext-asset');
  const active = list.filter((e) => e && typeof e.id === 'string' && e.id);
  const ids = new Set(active.map((e) => e.id));
  if (ids.size !== active.length) throw new Error('two extensions have the same id');

  // their tables: each group of statements once, in order
  for (const e of active) {
    const meta = `ext_schema:${e.id}`;
    const row = q('SELECT value FROM meta WHERE key = ?').get(meta);
    const done = row ? Number(row.value) : 0;
    for (let v = done; v < (e.migrations || []).length; v++) {
      ctx.tx(() => {
        for (const sql of e.migrations[v]) ctx.exec(sql);
        q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(meta, String(v + 1));
      });
    }
  }

  // which guarding extensions were here before and are not now
  const seen = readSeen(q);
  const gone = () => Object.entries(seen).filter(([id, s]) => !ids.has(id) && s && Array.isArray(s.g) && s.g.length).map(([id]) => id);
  const missing = gone();
  for (const e of active) seen[e.id] = { v: String(e.version || ''), g: Array.isArray(e.guards) ? e.guards : [] };
  writeSeen(q, seen);
  const shut = () => new ApiError(503, 'unavailable', 'サーバーの構成が変わっているため、いまはアップロードできません。開発者に連絡してください');

  const guarding = (name) => active.filter((e) => e.hooks && typeof e.hooks[name] === 'function');
  const ask = (name) => (info) => {
    if (missing.length) throw shut();
    for (const e of guarding(name)) e.hooks[name](info, ctx);
  };
  // what the vault and the diary ask before taking a file in
  const gate = { create: ask('create'), finish: ask('finish'), inline: ask('inline'), restart: ask('restart') };

  const routes = {};
  for (const e of active) {
    for (const [k, fn] of Object.entries(e.routes ? e.routes(ctx) : {})) {
      if (!ROUTE.test(k)) throw new Error(`extension ${e.id}: ${k} is not under /api/ops/x/`);
      if (routes[k]) throw new Error(`extension ${e.id}: ${k} is already taken`);
      // (staff only, whatever the route itself checks)
      routes[k] = (req, u) => { ctx.ops.need(u); return fn(req, u); };
    }
  }

  const sign = (name, userId, exp) => crypto.createHmac('sha256', key).update(`${name}|${userId}|${exp}`).digest('base64url');
  const namesFor = (e, u) => (e.boot ? e.boot(u, ctx) : []).filter((n) => e.assets && e.assets[n]);
  // the files the operator site gets for this person, each with a ticket
  function boot(u) {
    const out = [];
    const exp = clock() + TICKET_MS;
    for (const e of active) {
      for (const name of namesFor(e, u)) {
        const t = `${u.id}.${exp}.${sign(name, u.id, exp)}`;
        out.push({ name, kind: e.assets[name].kind || 'script', url: `/api/ext/asset?n=${encodeURIComponent(name)}&t=${t}` });
      }
    }
    return { assets: out, missing: missing.length > 0, now: clock() };
  }
  const nothing = () => new ApiError(404, 'not_found', 'APIが見つかりません');
  function serve(req) {
    const name = String(req.query.get('n') || '');
    const m = /^(\d{1,15})\.(\d{13})\.([\w-]{43})$/.exec(String(req.query.get('t') || ''));
    if (!m || Number(m[2]) < clock()) throw nothing();
    const want = Buffer.from(sign(name, m[1], m[2])), got = Buffer.from(m[3]);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) throw nothing();
    const u = ctx.getUser(Number(m[1]));
    if (!u) throw nothing();
    for (const e of active) {
      if (!namesFor(e, u).includes(name)) continue;
      const a = e.assets[name];
      return new Raw(a.body, { type: a.type || 'text/javascript; charset=utf-8', headers: { 'Cache-Control': 'no-store', ...(a.headers || {}) } });
    }
    throw nothing();
  }
  routes['GET /api/ops/ext'] = (req, u) => { ctx.ops.see(u); return boot(u); };
  routes['GET /api/ext/asset'] = (req) => serve(req);

  return {
    ids: [...ids], routes, gate, boot,
    // open to anyone who holds a ticket
    publicKeys: ['GET /api/ext/asset'],
    missing: () => missing.slice(),
    // the version of each, for the server tab
    versions: () => active.map((e) => ({ id: e.id, version: String(e.version || '') }))
  };
}
