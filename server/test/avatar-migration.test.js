import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, SCHEMA_VERSION, migrate } from '../core/db.js';

test('portrait migration resets every legacy player once, keeps NPCs and preserves money and later purchases', () => {
  const raw = new DatabaseSync(':memory:');
  try {
    const version = MIGRATIONS.findIndex(batch => batch.some(sql => sql.includes("avatar = 'traveler-green'")));
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    for (const sql of MIGRATIONS.slice(0, version).flat()) raw.exec(sql);
    raw.prepare("INSERT INTO meta VALUES ('schema', ?)").run(String(version));
    const insert = raw.prepare(`INSERT INTO users
      (name, name_key, recovery_hash, avatar, avatars, npc, tokens, dollars, coins, rev, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, 123456, 9876543, 74, 12, 1, 1)`);
    const retired = ['bald', 'beard', 'curly', 'blond', 'witch', 'cap', 'catcap', 'pumpkin', 'red', 'vampire'];
    for (const id of retired) insert.run(id, id, 'recovery-' + id, id, 'pumpkin,red,vampire', '');
    for (const id of ['peter', 'johnson', 'official']) insert.run(id, id, 'recovery-' + id, id, '', id);
    const db = { exec: sql => raw.exec(sql), prepare: sql => raw.prepare(sql), tx: fn => fn() };
    migrate(db);
    for (const row of raw.prepare('SELECT * FROM users').all()) {
      assert.deepEqual([row.tokens, row.dollars, row.coins], [123456, 9876543, 74]);
      assert.equal(row.recovery_hash, 'recovery-' + row.name_key);
      assert.equal(row.avatar, row.npc || 'traveler-green');
      assert.equal(row.avatars, '');
      assert.equal(row.rev, row.npc ? 12 : 13);
    }
    assert.equal(raw.prepare("SELECT value FROM meta WHERE key = 'schema'").get().value, String(SCHEMA_VERSION));
    raw.prepare("UPDATE users SET avatar = 'adam-secret', avatars = 'adventurer-blue,adam-secret', dollars = 777777, rev = 14 WHERE name_key = 'bald'").run();
    migrate(db);
    const kept = raw.prepare("SELECT avatar, avatars, dollars, rev FROM users WHERE name_key = 'bald'").get();
    assert.deepEqual({ ...kept }, { avatar: 'adam-secret', avatars: 'adventurer-blue,adam-secret', dollars: 777777, rev: 14 });
  } finally {
    raw.close();
  }
});
