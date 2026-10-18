// Schema and migrations, shared by both hosts. A host hands in a small
// adapter around its SQLite:
//   db.prepare(sql) -> { get(...args), all(...args), run(...args) -> { changes, lastInsertRowid } }
//   db.exec(sql)    -> runs one statement
//   db.tx(fn)       -> runs fn() in one transaction and returns its result

export const MIGRATIONS = [
  // v1: accounts, sessions, chat, transfers, blocks, spin log
  [
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
     )`,
    'CREATE INDEX users_total ON users(total_won DESC, id)',
    'CREATE INDEX users_biggest ON users(biggest_win DESC, id)',
    'CREATE INDEX users_day ON users(won_day, day_won DESC, id)',
    'CREATE INDEX users_ip ON users(created_ip, created_at)',
    `CREATE TABLE sessions (
       token_hash TEXT    PRIMARY KEY,
       user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       created_at INTEGER NOT NULL,
       last_used  INTEGER NOT NULL
     )`,
    'CREATE INDEX sessions_user ON sessions(user_id)',
    `CREATE TABLE messages (
       id           INTEGER PRIMARY KEY,
       channel      TEXT    NOT NULL,
       sender_id    INTEGER NOT NULL,
       recipient_id INTEGER,
       kind         TEXT    NOT NULL,
       body         TEXT    NOT NULL DEFAULT '',
       amount       INTEGER,
       currency     TEXT,
       created_at   INTEGER NOT NULL
     )`,
    'CREATE INDEX messages_channel ON messages(channel, id)',
    `CREATE TABLE conversations (
       user_id    INTEGER NOT NULL,
       other_id   INTEGER NOT NULL,
       last_id    INTEGER NOT NULL,
       unread     INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (user_id, other_id)
     )`,
    'CREATE INDEX conversations_recent ON conversations(user_id, updated_at DESC)',
    `CREATE TABLE transfers (
       id         INTEGER PRIMARY KEY,
       from_id    INTEGER NOT NULL,
       to_id      INTEGER NOT NULL,
       currency   TEXT    NOT NULL,
       amount     INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX transfers_from ON transfers(from_id, created_at)',
    `CREATE TABLE blocks (
       user_id    INTEGER NOT NULL,
       blocked_id INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (user_id, blocked_id)
     )`,
    `CREATE TABLE spins (
       id         INTEGER PRIMARY KEY,
       user_id    INTEGER NOT NULL,
       bet        INTEGER NOT NULL,
       payout     INTEGER NOT NULL,
       line       TEXT    NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX spins_user ON spins(user_id, id)'
  ],
  // v2: passwords, icons, friends, cars, spectators
  [
    "ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT 'bald'",
    "ALTER TABLE users ADD COLUMN avatars TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN last_spin TEXT NOT NULL DEFAULT ''",
    // rankings scan the table instead: a spin then writes one row, not four
    'DROP INDEX IF EXISTS users_total',
    'DROP INDEX IF EXISTS users_biggest',
    'DROP INDEX IF EXISTS users_day',
    `CREATE TABLE friends (
       user_id    INTEGER NOT NULL,
       friend_id  INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (user_id, friend_id)
     )`,
    `CREATE TABLE friend_requests (
       from_id    INTEGER NOT NULL,
       to_id      INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (from_id, to_id)
     )`,
    'CREATE INDEX friend_requests_to ON friend_requests(to_id)',
    `CREATE TABLE cars (
       id          INTEGER PRIMARY KEY,
       owner_id    INTEGER NOT NULL,
       model       TEXT    NOT NULL,
       from_id     INTEGER NOT NULL DEFAULT 0,
       created_at  INTEGER NOT NULL,
       acquired_at INTEGER NOT NULL
     )`,
    'CREATE INDEX cars_owner ON cars(owner_id, id)',
    `CREATE TABLE watchers (
       watcher_id INTEGER PRIMARY KEY,
       target_id  INTEGER NOT NULL,
       since      INTEGER NOT NULL
     )`,
    'CREATE INDEX watchers_target ON watchers(target_id)'
  ],
  // v3: Shop items and the お守り加護, Peter the money lender (an NPC account), login bonus
  [
    "ALTER TABLE users ADD COLUMN npc TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN charm INTEGER NOT NULL DEFAULT 0',
    // login bonus: the last login day (6:00 JST to 6:00) and how many days so far
    "ALTER TABLE users ADD COLUMN login_day TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN login_days INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE items (
       user_id INTEGER NOT NULL,
       item    TEXT    NOT NULL,
       count   INTEGER NOT NULL,
       PRIMARY KEY (user_id, item)
     )`,
    // what a player owes Peter: one row per player who ever borrowed or was offered money
    `CREATE TABLE debts (
       user_id    INTEGER PRIMARY KEY,
       principal  INTEGER NOT NULL DEFAULT 0,
       owed       INTEGER NOT NULL DEFAULT 0,
       stage      INTEGER NOT NULL DEFAULT 0,
       offer      INTEGER NOT NULL DEFAULT 0,
       chat       INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL
     )`
  ]
];

export const SCHEMA_VERSION = MIGRATIONS.length;
export const TABLES = ['users', 'sessions', 'messages', 'conversations', 'transfers', 'blocks', 'spins',
  'friends', 'friend_requests', 'cars', 'watchers', 'items', 'debts', 'meta'];

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get();
  let version = row ? Number(row.value) : 0;
  // databases from the first release kept their version in PRAGMA user_version
  if (!row && db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()) version = 1;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.tx(() => {
      for (const sql of MIGRATIONS[v]) db.exec(sql);
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(v + 1));
    });
  }
}

// Value kept in the meta table, created once (e.g. the ticket signing secret).
export function metaValue(db, key, make) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (row) return row.value;
  const value = make();
  db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').run(key, value);
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key).value;
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
