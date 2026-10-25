// The operators' log keeps a running account of itself (server/core/opslog.js: how many rows of each kind, how big, the newest lines of each
// kind) so that the pages that ask every few seconds do not read the whole, ever-growing table each time. The account must always equal
// what reading every row says: after adds, after restores, after a transaction that was rolled back, and the lists it gives must be the
// lists the table gives. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../node/sqlite.js';
import { statements } from '../core/db.js';
import { createOpsLog, kindOf, LOG_KINDS, ACTIVITY } from '../core/opslog.js';

function world(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oplog-'));
  const db = openDb(dir);
  const q = statements(db);
  const log = createOpsLog({ q });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { db, q, log };
}
// an action of every kind there is (and the kinds of name that sit beside the edges)
const ACTIONS = ['player_login', 'player_register', 'login_fail', 'open', 'vault_open', 'vault_pull', 'shield_auto_block', 'ops_grant', 'bot_message', 'money', 'ban:suspend', 'ban:none', 'pk_fail',
  'sec_message', 'emergency_stop', 'emergency_release', 'lockdown', 'lockdown_release', 'filter_block', 'account_delete', 'password', 'device_ok', 'pay_order', 'admin:ban', 'watch_start', 'backup_run',
  'emergency', 'emergencyx', 'lockdowns', 'lockdow', 'filter_blocks', 'banned', 'vault'];
const KINDS = [...Object.keys(LOG_KINDS), 'activity'];

function same(log) {
  const a = log.scan();
  assert.deepEqual(log.counts(), a.counts, 'the counts equal what reading every row says');
  assert.deepEqual(log.size(), { rows: a.rows, bytes: a.bytes }, 'and so do the number of rows and their size');
}
test('the account equals reading every row, as rows are added in any order of kinds', (t) => {
  const { log } = world(t);
  same(log);   // (an empty log)
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 40; i++) log.add({ actorName: 't', action: ACTIONS[(i * 7 + round * 3) % ACTIONS.length], summary: `行 ${round}-${i} 😀`, detail: { i, mark: '日本語'.repeat(i % 5) } });
    same(log);
    log.list({ kind: KINDS[round % KINDS.length], limit: 20 });   // (a list built in between: it must keep up as well)
  }
});

test('what the account lists is what the table says, for every kind, and it keeps up with new lines', (t) => {
  const { db, log } = world(t);
  const table = (kind, limit) => {
    // the table read the way it was before the account: by the kind's own condition in SQL, newest first
    const rows = db.prepare('SELECT id, action FROM ops_log ORDER BY id DESC').all().filter((r) => (kind === '' ? true : kind === 'activity' ? ACTIVITY.includes(r.action) || r.action.startsWith('ban:') : kindOf(r.action) === kind));
    return rows.slice(0, limit).map((r) => r.id);
  };
  for (let i = 0; i < 300; i++) log.add({ actorName: 't', action: ACTIONS[(i * 5) % ACTIONS.length], summary: `行 ${i}`, detail: {} });
  for (const k of ['', ...KINDS]) assert.deepEqual(log.list({ kind: k, limit: 60 }).map((e) => e.id), table(k, 60), `first look at ${k || 'all'}`);
  for (let i = 0; i < 120; i++) log.add({ actorName: 't', action: ACTIONS[(i * 11 + 3) % ACTIONS.length], summary: `さらに ${i}`, detail: {} });
  for (const k of ['', ...KINDS]) assert.deepEqual(log.list({ kind: k, limit: 200 }).map((e) => e.id), table(k, 200), `after more lines: ${k || 'all'}`);
  // a page further back, and a search, read the table as before
  const older = log.list({ before: 50, limit: 10 }).map((e) => e.id);
  assert.deepEqual(older, [49, 48, 47, 46, 45, 44, 43, 42, 41, 40]);
  assert.ok(log.list({ find: '行 7', limit: 20 }).every((e) => /行 7/.test(e.summary)));
  same(log);
});

test('a transaction that was rolled back leaves no line in the account, even when the same number is used again', (t) => {
  const { db, log } = world(t);
  for (let i = 0; i < 30; i++) log.add({ actorName: 't', action: ACTIONS[i % ACTIONS.length], summary: `a${i}`, detail: {} });
  same(log);
  log.list({ kind: 'security', limit: 20 });
  db.exec('BEGIN');
  log.add({ actorName: 't', action: 'login_fail', summary: 'phantom', detail: {} });
  assert.equal(log.counts().security, log.scan().counts.security, 'inside the transaction it is there');
  db.exec('ROLLBACK');
  same(log);
  assert.ok(!log.list({ kind: 'security', limit: 20 }).some((e) => e.summary === 'phantom'));
  // the same number again, for another line
  db.exec('BEGIN');
  log.add({ actorName: 't', action: 'login_fail', summary: 'phantom', detail: {} });
  log.counts();
  db.exec('ROLLBACK');
  log.add({ actorName: 't', action: 'vault_open', summary: 'real', detail: {} });
  same(log);
  assert.equal(log.list({ kind: '', limit: 1 })[0].summary, 'real');
  assert.ok(!log.list({ kind: 'security', limit: 40 }).some((e) => e.summary === 'phantom'));
});

test('rows restored from elsewhere (keep) and a second instance on the same table are seen by the account', (t) => {
  const { q, db, log } = world(t);
  for (let i = 0; i < 25; i++) log.add({ actorName: 't', action: ACTIONS[i % ACTIONS.length], summary: `a${i}`, detail: {} });
  same(log);
  log.list({ kind: 'emergency', limit: 10 });
  // another instance (the admin command's) writes
  const other = createOpsLog({ q });
  other.add({ actorName: 't', action: 'lockdown', summary: 'from the other', detail: {} });
  other.add({ actorName: 't', action: 'player_login', summary: 'from the other 2', detail: {} });
  same(log);
  assert.equal(log.list({ kind: 'emergency', limit: 1 })[0].summary, 'from the other');
  // a restore: rows that continue the log are added; the others are kept whole inside a new line
  const rows = db.prepare('SELECT * FROM ops_log ORDER BY id').all().map((r) => ({ ...r }));
  const fresh = world(t);
  fresh.log.keep(rows.slice(0, 10), { why: 'test' });
  same(fresh.log);
  fresh.log.keep(rows.slice(15), { why: 'test' });
  same(fresh.log);
  assert.ok(fresh.log.counts().security >= 1, 'the kept rows are counted (the line that holds them is a security line)');
});

test('the emergency kind as a range of names is the same set as by the first letters', (t) => {
  const { db } = world(t);
  const names = ['emergency_stop', 'emergency_', 'emergency', 'emergencyx', 'emergency`', 'emergency^', 'lockdown', 'lockdown_release', 'lockdowns', 'lockdowo', 'lockdow', 'filter_block', 'filter_blocks', 'x', 'Emergency_stop', 'LOCKDOWN', ''];
  db.exec('CREATE TEMP TABLE sample (action TEXT)');
  for (const n of names) db.prepare('INSERT INTO sample (action) VALUES (?)').run(n);
  const range = "(action >= 'emergency_' AND action < 'emergency`') OR (action >= 'lockdown' AND action < 'lockdowo') OR action = 'filter_block'";
  const first = "substr(action, 1, 10) = 'emergency_' OR substr(action, 1, 8) = 'lockdown' OR action = 'filter_block'";
  const a = db.prepare(`SELECT action FROM sample WHERE ${range} ORDER BY action`).all().map((r) => r.action);
  const b = db.prepare(`SELECT action FROM sample WHERE ${first} ORDER BY action`).all().map((r) => r.action);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((n) => kindOf(n)), a.map(() => 'emergency'), 'and JavaScript says the same of each');
  assert.ok(names.filter((n) => !a.includes(n)).every((n) => kindOf(n) !== 'emergency'));
});
