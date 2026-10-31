import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { purgePlayer } from '../core/purge.js';

test('a late stop for an old host cannot remove a watch of another host', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const watcher = await s.register('LateWatcher'), a = await s.register('OldHost'), b = await s.register('NewHost');
  await s.befriend(watcher, a); await s.befriend(watcher, b);
  const watch = (id, on) => s.call('POST', '/api/watch', { token: watcher.token, body: { user: id, on } });
  assert.equal((await watch(a.me.id, true)).status, 200); assert.equal((await watch(b.me.id, true)).status, 200);
  assert.equal((await watch(a.me.id, false)).status, 200);
  assert.equal(s.app.db.prepare('SELECT target_id FROM watchers WHERE watcher_id=?').get(watcher.me.id)?.target_id, b.me.id);
  assert.equal((await watch(b.me.id, false)).status, 200);
  assert.equal(s.app.db.prepare('SELECT target_id FROM watchers WHERE watcher_id=?').get(watcher.me.id), undefined);
});

test('a delayed voice grant cannot authorize a replacement membership of the same watcher', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const host = await s.register('LeaseHost'), peer = await s.register('LeasePeer'); await s.befriend(host, peer);
  const watch = on => s.call('POST', '/api/watch', { token: peer.token, body: { user: host.me.id, on } });
  await watch(true);
  const before = s.app.db.prepare('SELECT since FROM watchers WHERE watcher_id=?').get(peer.me.id).since;
  let enter, release; const ready = new Promise(resolve => { enter = resolve; });
  const pending = s.app.api.handle({ method: 'POST', path: '/api/watch/voice', query: new URLSearchParams(), ip: '127.0.0.1',
    header: name => name.toLowerCase() === 'authorization' ? `Bearer ${host.token}` : '',
    json: () => { enter(); return new Promise(resolve => { release = () => resolve({ user: peer.me.id, on: true, since: before }); }); } });
  await ready; t.after(() => release()); await watch(false); await watch(true);
  const latest = s.app.db.prepare('SELECT since FROM watchers WHERE watcher_id=?').get(peer.me.id).since;
  assert.notEqual(latest, before); release();
  const reply = await pending; assert.equal(reply.status, 409); assert.equal(reply.body.error.code, 'watch_changed');
  assert.equal(s.app.db.prepare('SELECT voice FROM watchers WHERE watcher_id=?').get(peer.me.id).voice, 0);
  assert.equal((await s.call('POST', '/api/watch/voice', { token: host.token, body: { user: peer.me.id, on: true, since: latest } })).status, 200);
});

test('an explicit watch exit clears voice consent cached during a dropped connection', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const host = await s.register('CacheHost'), peer = await s.register('CachePeer'); await s.befriend(host, peer);
  const watch = on => s.call('POST', '/api/watch', { token: peer.token, body: { user: host.me.id, on } });
  await watch(true); await s.call('POST', '/api/watch/voice', { token: host.token, body: { user: peer.me.id, on: true } });
  s.app.api.presence(peer.me.id, false); await watch(false);
  assert.equal((await watch(true)).voice, false);
});

test('repeating the same active watch preserves its membership and allowed voice control', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const host = await s.register('StableHost'), peer = await s.register('StablePeer'); await s.befriend(host, peer);
  const watch = () => s.call('POST', '/api/watch', { token: peer.token, body: { user: host.me.id, on: true } });
  const first = await watch(), again = await watch(); assert.ok(Number.isSafeInteger(first.since)); assert.equal(again.since, first.since);
  const home = await s.call('GET', '/api/watchers', { token: host.token }); assert.equal(home.watchers[0].since, first.since);
  assert.equal((await s.call('POST', '/api/watch/voice', { token: host.token, body: { user: peer.me.id, on: true, since: first.since } })).status, 200);
  assert.equal((await watch()).voice, true);
});

test('purging the recipient of a car offer releases the surviving seller car', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const seller = await s.register('PurgeSeller'), recipient = await s.register('PurgeBuyer'), other = await s.register('OtherBuyer');
  await s.befriend(seller, recipient); await s.befriend(seller, other); s.setUser(seller.me.id, { dollars: 100000000 });
  const bought = await s.call('POST', '/api/cars/buy', { token: seller.token, body: { model: 'ferrari-325' } }); assert.equal(bought.status, 200);
  const offer = to => s.call('POST', '/api/cars/offer', { token: seller.token, body: { car: bought.car.id, to, price: bought.car.paid } });
  const listed = await offer(recipient.me.id); assert.equal(listed.status, 200);
  const q = sql => s.app.db.prepare(sql); purgePlayer(q, fn => s.app.db.tx(fn), recipient.me.id);
  const car = q('SELECT owner_id,offer_id FROM cars WHERE id=?').get(bought.car.id);
  assert.equal(car.owner_id, seller.me.id); assert.equal(car.offer_id, 0);
  assert.equal(q('SELECT state FROM message_history WHERE id=?').get(listed.message.id).state, 'canceled');
  assert.equal((await offer(other.me.id)).status, 200);
});

test('opening the garage repairs a previously canceled offer lock without releasing an active offer', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const seller = await s.register('LegacySeller'), a = await s.register('GoneBuyer'), b = await s.register('LiveBuyer');
  await s.befriend(seller, a); await s.befriend(seller, b); s.setUser(seller.me.id, { dollars: 100000000 });
  const cars = [];
  for (const target of [a, b]) {
    const bought = await s.call('POST', '/api/cars/buy', { token: seller.token, body: { model: 'ferrari-325' } });
    assert.equal(bought.status, 200);
    const listed = await s.call('POST', '/api/cars/offer', { token: seller.token, body: { car: bought.car.id, to: target.me.id, price: bought.car.paid } });
    assert.equal(listed.status, 200); cars.push({ ...bought.car, offer: listed.message.id });
  }
  // The old purge canceled this message but left cars.offer_id behind.
  s.app.db.prepare("UPDATE messages SET state='canceled' WHERE id=?").run(cars[0].offer);
  const garage = await s.call('GET', '/api/cars', { token: seller.token }); assert.equal(garage.status, 200);
  assert.equal(garage.cars.find(c => c.id === cars[0].id).offer, 0);
  assert.equal(garage.cars.find(c => c.id === cars[1].id).offer, cars[1].offer);
  assert.equal((await s.call('POST', '/api/cars/offer', { token: seller.token, body: { car: cars[0].id, to: b.me.id, price: cars[0].paid } })).status, 200);
});
