// Real HTTP contract, shared by the Node regression and the isolated workerd run.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
exports.marketContract = async function (base, admin) {
  const { RULES } = await import('../server/core/rules.js');
  async function call(method, path, actor, body) {
    const headers = { 'Content-Type': 'application/json', 'X-Device': crypto.randomBytes(16).toString('hex') };
    if (actor) headers.Authorization = 'Bearer ' + actor.token;
    if (path === '/api/admin') headers['X-Admin-Token'] = admin;
    const res = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { ...await res.json(), status: res.status };
  }
  const register = name => call('POST', '/api/register', null, { name, password: 'pass1234', avatar: 'traveler-green' });
  const a = await register('MarketBuyer'), b = await register('MarketSeller');
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await call('POST', '/api/friends/request', a, { user: b.me.id })).status, 200);
  assert.equal((await call('POST', '/api/friends/respond', b, { user: a.me.id, accept: true })).status, 200);
  async function backup() {
    const r = await call('POST', '/api/admin', null, { cmd: 'export', args: [] }); assert.equal(r.status, 200); return r.result;
  }
  async function restore(data) {
    const r = await call('POST', '/api/admin', null, { cmd: 'import', args: [data, true] }); assert.equal(r.status, 200, JSON.stringify(r));
  }
  const initial = await backup(), now = Date.now();
  Object.assign(initial.tables.users.find(u => u.id === a.me.id), { dollars: Number.MAX_SAFE_INTEGER, quests: '{}',
    vip_exp: RULES.vip.levels[1] - RULES.vip.exp.quest, vip_until: now + 86400000,
    jobs: JSON.stringify([{ id: 'garage', since: now - 3600000 }]) });
  initial.tables.cars.push({ id: 1, owner_id: b.me.id, model: 'two-state-sedan', paid: 100, created_at: now, acquired_at: now });
  await restore(initial);
  const offer = await call('POST', '/api/cars/offer', b, { car: 1, to: a.me.id, price: 100 }); assert.equal(offer.status, 200, JSON.stringify(offer));
  const state = data => ({ users: data.tables.users.filter(u => u.id === a.me.id || u.id === b.me.id)
    .map(({ id, dollars, tokens, coins, rev, quests, jobs, vip_exp, vip_until }) => ({ id, dollars, tokens, coins, rev, quests, jobs, vip_exp, vip_until })),
    cars: data.tables.cars, offers: data.tables.messages.filter(m => m.kind === 'car_offer' || m.kind === 'car_sold') });
  const before = state(await backup()), trace = [];
  const rejected = await call('POST', '/api/cars/offer/buy', a, { id: offer.message.id });
  assert.deepEqual([rejected.status, rejected.error?.code], [409, 'balance_limit']);
  trace.push({ label: 'quest purchase rejects overflowing wage', status: rejected.status, error: rejected.error.code });
  const after = await backup(); assert.deepEqual(state(after), before);
  trace.push({ label: 'failed quest purchase preserves assets and offer', data: true });
  after.tables.users.find(u => u.id === a.me.id).dollars = 1000000; await restore(after);
  const retry = await call('POST', '/api/cars/offer/buy', a, { id: offer.message.id }); assert.equal(retry.status, 200, JSON.stringify(retry));
  const settled = state(await backup()); assert.equal(settled.cars[0].owner_id, a.me.id);
  assert.equal(settled.offers.filter(m => m.kind === 'car_sold').length, 1); assert.ok(retry.me.dollars > 999900);
  trace.push({ label: 'quest purchase retries and settles once', status: retry.status, data: true });
  const duplicate = await call('POST', '/api/cars/offer/buy', a, { id: offer.message.id });
  assert.deepEqual([duplicate.status, duplicate.error?.code], [409, 'done']); assert.deepEqual(state(await backup()), settled);
  trace.push({ label: 'settled quest purchase cannot double charge', status: duplicate.status, error: duplicate.error.code });
  return trace;
};
