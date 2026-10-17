// SQLite storage (node:sqlite, no npm dependency).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = [
  // v1
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     name          TEXT    NOT NULL,
     name_key      TEXT    NOT NULL UNIQUE,
     recovery_hash TEXT    NOT NULL UNIQUE,
     tokens        INTEGER NOT NULL,
     dollars       INTEGER NOT NULL,
     coins         INTEGER NOT NULL,
     rev           INTEGER NOT NULL DEFAULT 1,
     total_won     INTEGER NOT NULL DEFAULT 0,
     total_bet     INTEGER NOT NULL DEFAULT 0,
     biggest_win   INTEGER NOT NULL DEFAULT 0,
     spins         INTEGER NOT NULL DEFAULT 0,
     won_day       TEXT    NOT NULL DEFAULT '',
     day_won       INTEGER NOT NULL DEFAULT 0,
     bought_day    TEXT    NOT NULL DEFAULT '',
     bought_today  INTEGER NOT NULL DEFAULT 0,
     free_day      TEXT    NOT NULL DEFAULT '',
     banned        INTEGER NOT NULL DEFAULT 0,
     created_ip    TEXT    NOT NULL DEFAULT '',
     created_at    INTEGER NOT NULL,
     last_seen     INTEGER NOT NULL
   );
   CREATE INDEX users_total   ON users(total_won DESC, id);
   CREATE INDEX users_biggest ON users(biggest_win DESC, id);
   CREATE INDEX users_day     ON users(won_day, day_won DESC, id);
   CREATE INDEX users_ip      ON users(created_ip, created_at);

   CREATE TABLE sessions (
     token_hash TEXT    PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     last_used  INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);

   CREATE TABLE messages (
     id           INTEGER PRIMARY KEY,
     channel      TEXT    NOT NULL,
     sender_id    INTEGER NOT NULL,
     recipient_id INTEGER,
     kind         TEXT    NOT NULL,
     body         TEXT    NOT NULL DEFAULT '',
     amount       INTEGER,
     currency     TEXT,
     created_at   INTEGER NOT NULL
   );
   CREATE INDEX messages_channel ON messages(channel, id);

   CREATE TABLE conversations (
     user_id    INTEGER NOT NULL,
     other_id   INTEGER NOT NULL,
     last_id    INTEGER NOT NULL,
     unread     INTEGER NOT NULL DEFAULT 0,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, other_id)
   );
   CREATE INDEX conversations_recent ON conversations(user_id, updated_at DESC);

   CREATE TABLE transfers (
     id         INTEGER PRIMARY KEY,
     from_id    INTEGER NOT NULL,
     to_id      INTEGER NOT NULL,
     currency   TEXT    NOT NULL,
     amount     INTEGER NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX transfers_from ON transfers(from_id, created_at);

   CREATE TABLE blocks (
     user_id    INTEGER NOT NULL,
     blocked_id INTEGER NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, blocked_id)
   );

   CREATE TABLE spins (
     id         INTEGER PRIMARY KEY,
     user_id    INTEGER NOT NULL,
     bet        INTEGER NOT NULL,
     payout     INTEGER NOT NULL,
     line       TEXT    NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX spins_user ON spins(user_id, id);`
];

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'blockbuster.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < SCHEMA.length; v++) {
    tx(db, () => {
      db.exec(SCHEMA[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// Runs fn inside an IMMEDIATE transaction (the write lock is taken up front).
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  }
}

// Prepared statement cache.
export function statements(db) {
  const cache = new Map();
  return (sql) => {
    let st = cache.get(sql);
    if (!st) { st = db.prepare(sql); cache.set(sql, st); }
    return st;
  };
}
