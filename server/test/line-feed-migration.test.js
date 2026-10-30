import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../core/db.js';

test('upgrading the existing casino to the LINE feed preserves accounts, balances, sessions and metadata', () => {
  const raw = new DatabaseSync(':memory:');
  try {
    const version = MIGRATIONS.findIndex((batch) => batch.some((sql) => sql.includes('CREATE TABLE line_feed_targets')));
    assert.ok(version > 0);
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const sql of MIGRATIONS.slice(0, version).flat()) raw.exec(sql);
    raw.prepare("INSERT INTO meta VALUES ('schema', ?)").run(String(version));
    raw.prepare("INSERT INTO meta VALUES ('ticket_secret', 'existing-login-secret')").run();
    raw.prepare(`INSERT INTO users (id, name, name_key, recovery_hash, tokens, dollars, coins, created_at, last_seen)
      VALUES (123, 'Existing', 'existing', 'recovery', 123456, 987654321, 42, 1, 2)`).run();
    raw.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used) VALUES ('session', 123, 1, 2)").run();
    const user = raw.prepare('SELECT * FROM users WHERE id = 123').get();
    const session = raw.prepare("SELECT * FROM sessions WHERE token_hash = 'session'").get();
    const db = { prepare: (sql) => raw.prepare(sql), exec: (sql) => raw.exec(sql), tx(fn) {
      raw.exec('BEGIN');
      try { const out = fn(); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    } };
    migrate(db);
    raw.prepare("INSERT INTO line_feed_targets VALUES ('C' || ?, 1, 100)").run('a'.repeat(32));
    migrate(db);
    // (later migrations may add columns, with their defaults: every value the account had stays as it was)
    const after = raw.prepare('SELECT * FROM users WHERE id = 123').get();
    assert.deepEqual(Object.fromEntries(Object.keys(user).map((k) => [k, after[k]])), { ...user });
    assert.deepEqual(raw.prepare("SELECT * FROM sessions WHERE token_hash = 'session'").get(), session);
    assert.equal(raw.prepare("SELECT value FROM meta WHERE key = 'ticket_secret'").get().value, 'existing-login-secret');
    assert.equal(Number(raw.prepare("SELECT value FROM meta WHERE key = 'schema'").get().value), SCHEMA_VERSION);
    assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM line_feed_targets').get().n, 1);
    assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { raw.close(); }
});
