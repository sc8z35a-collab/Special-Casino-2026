import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, migrate } from '../core/db.js';

const HOUR = 3600000, BLOCK = 5 * HOUR;
const readCar = (s, id) => s.app.db.prepare('SELECT * FROM cars WHERE id = ?').get(id);

test('upgrading existing rentals clamps each old balance and preserves the intent of scheduled returns', () => {
  const raw = new DatabaseSync(':memory:');
  try {
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    const rentalMigration = MIGRATIONS.findIndex(batch => batch.some(sql => sql.includes('ADD COLUMN rent_paused')));
    for (const sql of MIGRATIONS.slice(0, rentalMigration).flat()) raw.exec(sql);
    raw.prepare("INSERT INTO meta VALUES ('schema', ?)").run(String(rentalMigration));
    const insert = raw.prepare("INSERT INTO cars (owner_id, model, created_at, acquired_at, rent_start, rent_until, rent_earned) VALUES (1, 'two-state-sedan', 1, 1, 1, ?, ?)");
    insert.run(0, 9000000); insert.run(10, 4500000); insert.run(0, 1000000);
    migrate({ exec: sql => raw.exec(sql), prepare: sql => raw.prepare(sql), tx: fn => fn() });
    assert.deepEqual(raw.prepare('SELECT rent_start, rent_until, rent_earned, rent_paused FROM cars ORDER BY id').all().map(x => Object.values(x)),
      [[0, 0, 4500000, 1], [0, 0, 4500000, 0], [1, 0, 1000000, 0]]);
  } finally { raw.close(); }
});

test('each rental stops at 4.5M offline; collection restarts a fresh block without releasing overflow', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('RentalWait');
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const ids = [1, 2].map(() => Number(s.app.db.prepare(`INSERT INTO cars (owner_id, model, created_at, acquired_at, rent_start, rent_earned)
    VALUES (?, 'two-state-sedan', ?, ?, ?, ?)`).run(a.me.id, now, now, now - 10000 * BLOCK, 4499999).lastInsertRowid));
  const garage = await s.call('GET', '/api/cars', { token: a.token });
  assert.equal(garage.status, 200);
  for (const id of ids) {
    let car = readCar(s, id);
    assert.deepEqual([car.rent_earned, car.rent_start, car.rent_paused], [4500000, 0, 1]);
    const dto = garage.cars.find(c => c.id === id);
    assert.equal(dto.waiting, true); assert.equal(dto.rent.paused, true);
  }
  now += 1000 * BLOCK;
  const premature = await s.call('POST', '/api/cars/rent', { token: a.token, body: { car: ids[0], action: 'start' } });
  assert.equal(premature.error.code, 'collect_first');
  const collected = await s.call('POST', '/api/cars/collect', { token: a.token, body: {} });
  assert.equal(collected.paid, 9000000, 'cap applies separately to each car');
  for (const id of ids) {
    const c = readCar(s, id);
    assert.deepEqual([c.rent_start, c.rent_earned, c.rent_blocks, c.rent_paused], [now, 0, 0, 0]);
  }
  assert.equal((await s.call('POST', '/api/cars/collect', { token: a.token, body: {} })).error.code, 'nothing');
  now += BLOCK - 1;
  await s.call('GET', '/api/cars', { token: a.token });
  assert.equal(readCar(s, ids[0]).rent_earned, 0);
  now++;
  const next = await s.call('POST', '/api/cars/collect', { token: a.token, body: {} });
  assert.ok(next.paid >= 20000 && next.paid <= 1500000, 'only the new block earns');
});

test('explicitly stopping a waiting car or scheduling its return prevents automatic resumption on collection', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('RentalStop');
  const now = Date.now(); t.mock.method(Date, 'now', () => now);
  const add = until => Number(s.app.db.prepare(`INSERT INTO cars
    (owner_id, model, created_at, acquired_at, rent_start, rent_until, rent_earned)
    VALUES (?, 'two-state-sedan', ?, ?, ?, ?, 4499999)`).run(a.me.id, now, now, now - BLOCK, until).lastInsertRowid);
  const paused = add(0), scheduled = add(now);
  await s.call('GET', '/api/cars', { token: a.token });
  assert.equal(readCar(s, paused).rent_paused, 1);
  assert.equal(readCar(s, scheduled).rent_paused, 0);
  assert.equal((await s.call('POST', '/api/cars/rent', { token: a.token, body: { car: paused, action: 'stop' } })).status, 200);
  const result = await s.call('POST', '/api/cars/collect', { token: a.token, body: {} });
  assert.equal(result.paid, 9000000);
  for (const id of [paused, scheduled]) assert.deepEqual([readCar(s, id).rent_start, readCar(s, id).rent_paused], [0, 0]);
});

test('a full job reports collection waiting, pays at most 6M and resumes from the collection time', async t => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await s.register('JobWaiting');
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  s.setUser(a.me.id, { jobs: JSON.stringify([{ id: 'garage', since: now - 10000 * HOUR }]) });
  const jobs = await s.call('GET', '/api/jobs', { token: a.token });
  assert.equal(jobs.working[0].paused, true);
  assert.equal((await s.call('GET', '/api/me', { token: a.token })).me.jobs[0].paused, true);
  now += 10000 * HOUR;
  const result = await s.call('POST', '/api/jobs/collect', { token: a.token });
  assert.equal(result.paid, 6000000); assert.equal(result.working[0].paused, false);
  assert.equal(result.working[0].since, now);
  assert.equal((await s.call('POST', '/api/jobs/collect', { token: a.token })).paid, 0);
  now += HOUR;
  assert.equal((await s.call('POST', '/api/jobs/collect', { token: a.token })).paid, RULES.jobs.find(j => j.id === 'garage').wage);
});
