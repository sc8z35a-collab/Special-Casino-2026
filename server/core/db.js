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
  ],
  // v4: quests, player level, バイト, the update bonus; Peter counts every loan ever made
  [
    // XP for the player level
    'ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0',
    // quest progress as JSON (server/core/quests.js): no extra rows per spin
    "ALTER TABLE users ADD COLUMN quests TEXT NOT NULL DEFAULT ''",
    // the バイト being worked, as JSON: [{ "id": "garage", "since": <ms> }]
    "ALTER TABLE users ADD COLUMN jobs TEXT NOT NULL DEFAULT ''",
    // the last release (js/game/news.js) the player has been thanked for
    'ALTER TABLE users ADD COLUMN release_seen INTEGER NOT NULL DEFAULT 0',
    // all the money Peter ever lent the player (his limit never comes back)
    'ALTER TABLE debts ADD COLUMN lent INTEGER NOT NULL DEFAULT 0',
    'UPDATE debts SET lent = principal'
  ],
  // v5: group chats (with the 協力スロット gauge), read receipts, play time and the
  // beginner guide, feedback, フレンド対決, 観戦ベット; no lobby and no ranking any more
  [
    // how far each player has read a conversation (既読 for the other one)
    'ALTER TABLE conversations ADD COLUMN read_id INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE chat_groups (
       id         INTEGER PRIMARY KEY,
       name       TEXT    NOT NULL,
       owner_id   INTEGER NOT NULL,
       last_id    INTEGER NOT NULL DEFAULT 0,
       coop       INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE chat_members (
       group_id  INTEGER NOT NULL,
       user_id   INTEGER NOT NULL,
       joined_at INTEGER NOT NULL,
       read_id   INTEGER NOT NULL DEFAULT 0,
       unread    INTEGER NOT NULL DEFAULT 0,
       coop_bet  INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (group_id, user_id)
     )`,
    'CREATE INDEX chat_members_user ON chat_members(user_id)',
    // time spent playing; the guide is for those under 30 minutes who have not finished it
    'ALTER TABLE users ADD COLUMN play_ms INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN guide_done INTEGER NOT NULL DEFAULT 0',
    // nothing was measured before: about 5 seconds a spin
    'UPDATE users SET play_ms = MIN(spins * 5000, 3600000)',
    "DELETE FROM messages WHERE channel = 'lobby'",
    // feedback to the operator: 1 = asked (everyone who played before), 2 = sent
    'ALTER TABLE users ADD COLUMN feedback INTEGER NOT NULL DEFAULT 0',
    'UPDATE users SET feedback = 1',
    `CREATE TABLE feedback (
       id         INTEGER PRIMARY KEY,
       user_id    INTEGER NOT NULL,
       ratings    TEXT    NOT NULL,
       comment    TEXT    NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    // the voice of a home: the watched player picks who they talk with
    'ALTER TABLE watchers ADD COLUMN voice INTEGER NOT NULL DEFAULT 0',
    // 協力スロット: the group whose gauge the player's spins fill
    'ALTER TABLE users ADD COLUMN coop_group INTEGER NOT NULL DEFAULT 0',
    // フレンド対決 between two friends: the same number of spins at one bet
    'ALTER TABLE users ADD COLUMN battle_id INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE battles (
       id         INTEGER PRIMARY KEY,
       a_id       INTEGER NOT NULL,
       b_id       INTEGER NOT NULL,
       spins      INTEGER NOT NULL,
       bet        INTEGER NOT NULL,
       state      TEXT    NOT NULL,
       a_n        INTEGER NOT NULL DEFAULT 0,
       b_n        INTEGER NOT NULL DEFAULT 0,
       a_won      INTEGER NOT NULL DEFAULT 0,
       b_won      INTEGER NOT NULL DEFAULT 0,
       winner     INTEGER NOT NULL DEFAULT 0,
       quit       INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       started_at INTEGER NOT NULL DEFAULT 0,
       ended_at   INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX battles_a ON battles(a_id, state)',
    'CREATE INDEX battles_b ON battles(b_id, state)',
    // 観戦ベット: a watcher's stake on the next spins of the player they watch
    `CREATE TABLE watch_bets (
       id         INTEGER PRIMARY KEY,
       watcher_id INTEGER NOT NULL,
       host_id    INTEGER NOT NULL,
       side       TEXT    NOT NULL,
       stake      INTEGER NOT NULL,
       left_n     INTEGER NOT NULL,
       state      TEXT    NOT NULL DEFAULT 'open',
       paid       INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       ended_at   INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX watch_bets_host ON watch_bets(host_id, state)',
    'CREATE INDEX watch_bets_watcher ON watch_bets(watcher_id, state)'
  ],
  // v6: 友達と稼ぐ (hubs of friends), wins in a row, activity for the time quests
  [
    // a hub: its shared combo (wins in a row, ended by `misses` misses in a row),
    // what it won and its spins so far (updates are told in that order)
    `CREATE TABLE hubs (
       id         INTEGER PRIMARY KEY,
       combo      INTEGER NOT NULL DEFAULT 0,
       misses     INTEGER NOT NULL DEFAULT 0,
       won        INTEGER NOT NULL DEFAULT 0,
       spins      INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )`,
    // one hub per player; away_at: when their connection went (0: connected)
    `CREATE TABLE hub_members (
       user_id   INTEGER PRIMARY KEY,
       hub_id    INTEGER NOT NULL,
       joined_at INTEGER NOT NULL,
       away_at   INTEGER NOT NULL DEFAULT 0,
       spins     INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX hub_members_hub ON hub_members(hub_id)',
    `CREATE TABLE hub_invites (
       from_id    INTEGER NOT NULL,
       to_id      INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (from_id, to_id)
     )`,
    'CREATE INDEX hub_invites_to ON hub_invites(to_id)',
    // wins in a row on one's own (quests: カジノで2コンボする)
    'ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0',
    // the last activity beat (time quests count the time between beats)
    'ALTER TABLE users ADD COLUMN beat_at INTEGER NOT NULL DEFAULT 0'
  ],
  // v7: who is active (last tap, key or voice), bans that end, the devices
  // players use (two accounts a device), the operator site
  [
    // the player's last tap / key / voice: time quests and the hub's active members
    'ALTER TABLE users ADD COLUMN active_at INTEGER NOT NULL DEFAULT 0',
    // a ban: 'suspend' (access ban, 1 week), 'ban' (30 days) or 'perma'; until when
    // (0: no end) and since when. device_ok_at: an operator let this account play
    // past the bans of other accounts on its devices (bans after that count again)
    "ALTER TABLE users ADD COLUMN ban_kind TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN ban_until INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN ban_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN device_ok_at INTEGER NOT NULL DEFAULT 0',
    "UPDATE users SET ban_kind = 'perma', ban_at = created_at WHERE banned = 1",
    // the device an account was made on: its id, and its fingerprint (with created_ip)
    "ALTER TABLE users ADD COLUMN created_device TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN created_fp TEXT NOT NULL DEFAULT ''",
    'CREATE INDEX users_created_device ON users(created_device)',
    'CREATE INDEX users_created_fp ON users(created_fp)',
    // the 引き継ぎコード, readable by the operators (sealed with the server's key)
    "ALTER TABLE users ADD COLUMN recovery_enc TEXT NOT NULL DEFAULT ''",
    // login days in a row (6:00 to 6:00 Japan time): the last one counted, the run, the longest run
    "ALTER TABLE users ADD COLUMN streak_day TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN day_streak INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN day_best INTEGER NOT NULL DEFAULT 0',
    // every device an account was used on: "id:<device id>" or "fp:<fingerprint>@<address>"
    `CREATE TABLE devices (
       user_id  INTEGER NOT NULL,
       device   TEXT    NOT NULL,
       first_at INTEGER NOT NULL,
       last_at  INTEGER NOT NULL,
       PRIMARY KEY (user_id, device)
     )`,
    'CREATE INDEX devices_device ON devices(device)'
  ],
  // v8: 金の生る木: the trees (what was given, the harvest cycle running, the
  // money grown in it so far) and the auctions for more trees
  [
    `CREATE TABLE trees (
       id         INTEGER PRIMARY KEY,
       user_id    INTEGER NOT NULL,
       name       TEXT    NOT NULL,
       super      INTEGER NOT NULL DEFAULT 0,
       given      INTEGER NOT NULL DEFAULT 0,
       cycle      TEXT    NOT NULL DEFAULT '',
       cycle_at   INTEGER NOT NULL DEFAULT 0,
       cycle_end  INTEGER NOT NULL DEFAULT 0,
       grown      REAL    NOT NULL DEFAULT 0,
       grown_at   INTEGER NOT NULL DEFAULT 0,
       harvested  INTEGER NOT NULL DEFAULT 0,
       price      INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX trees_user ON trees(user_id)',
    `CREATE TABLE tree_auctions (
       id         INTEGER PRIMARY KEY,
       user_id    INTEGER NOT NULL,
       market     TEXT    NOT NULL,
       state      TEXT    NOT NULL,
       status     TEXT    NOT NULL DEFAULT 'live',
       price      INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       ended_at   INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX tree_auctions_user ON tree_auctions(user_id, status)'
  ],
  // v9: NPC friends (ジョンソン): when they last sent money, how much in all,
  // and their one rescue
  [
    `CREATE TABLE npc_friends (
       user_id    INTEGER NOT NULL,
       npc        TEXT    NOT NULL,
       gift_at    INTEGER NOT NULL DEFAULT 0,
       gifts      INTEGER NOT NULL DEFAULT 0,
       given      INTEGER NOT NULL DEFAULT 0,
       rescued_at INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (user_id, npc)
     )`
  ],
  // v10: the age check, presents in the chat (when one was received), what a
  // silent block holds back, the official bot's conversations, reports
  // (通報), what the chat filter found, the operators' log (append-only and
  // chained: rows can be neither changed nor deleted) and push subscriptions
  [
    // 18歳以上？ NULL: not answered yet, 1: yes, 0: no
    'ALTER TABLE users ADD COLUMN age_ok INTEGER',
    'ALTER TABLE users ADD COLUMN age_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN claimed_at INTEGER NOT NULL DEFAULT 0',
    // sent to someone who blocked the sender: shown to them once they unblock
    'ALTER TABLE messages ADD COLUMN held INTEGER NOT NULL DEFAULT 0',
    // 報告 (bug) / 意見案 (idea) / '' (the old ratings); when the operators handled it
    "ALTER TABLE feedback ADD COLUMN kind TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE feedback ADD COLUMN handled_at INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE reports (
       id          INTEGER PRIMARY KEY,
       reporter_id INTEGER NOT NULL,
       target_id   INTEGER NOT NULL,
       kind        TEXT    NOT NULL,
       body        TEXT    NOT NULL,
       place       TEXT    NOT NULL DEFAULT '',
       context     TEXT    NOT NULL DEFAULT '{}',
       status      TEXT    NOT NULL DEFAULT 'open',
       reward      INTEGER NOT NULL DEFAULT 0,
       handled_by  INTEGER NOT NULL DEFAULT 0,
       handled_at  INTEGER NOT NULL DEFAULT 0,
       created_at  INTEGER NOT NULL
     )`,
    'CREATE INDEX reports_status ON reports(status, id)',
    `CREATE TABLE detections (
       id           INTEGER PRIMARY KEY,
       sender_id    INTEGER NOT NULL,
       recipient_id INTEGER NOT NULL DEFAULT 0,
       group_id     INTEGER NOT NULL DEFAULT 0,
       place        TEXT    NOT NULL,
       original     TEXT    NOT NULL,
       masked       TEXT    NOT NULL,
       words        TEXT    NOT NULL,
       message_id   INTEGER NOT NULL DEFAULT 0,
       reviewed_at  INTEGER NOT NULL DEFAULT 0,
       created_at   INTEGER NOT NULL
     )`,
    'CREATE INDEX detections_sender ON detections(sender_id, reviewed_at)',
    // a player's conversation with the official bot: waiting for an answer since
    // (0: answered), when the operators last wrote, the automatic answer
    `CREATE TABLE bot_threads (
       user_id       INTEGER PRIMARY KEY,
       waiting_since INTEGER NOT NULL DEFAULT 0,
       ops_at        INTEGER NOT NULL DEFAULT 0,
       auto_at       INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE ops_log (
       id          INTEGER PRIMARY KEY,
       at          INTEGER NOT NULL,
       actor_id    INTEGER NOT NULL DEFAULT 0,
       actor_name  TEXT    NOT NULL DEFAULT '',
       action      TEXT    NOT NULL,
       target_id   INTEGER NOT NULL DEFAULT 0,
       target_name TEXT    NOT NULL DEFAULT '',
       summary     TEXT    NOT NULL,
       detail      TEXT    NOT NULL DEFAULT '{}',
       prev_hash   TEXT    NOT NULL,
       hash        TEXT    NOT NULL
     )`,
    `CREATE TRIGGER ops_log_no_delete BEFORE DELETE ON ops_log
     BEGIN SELECT RAISE(ABORT, 'the operators log cannot be deleted'); END`,
    `CREATE TRIGGER ops_log_no_update BEFORE UPDATE ON ops_log
     BEGIN SELECT RAISE(ABORT, 'the operators log cannot be changed'); END`,
    `CREATE TABLE push_subs (
       endpoint   TEXT    PRIMARY KEY,
       user_id    INTEGER NOT NULL,
       p256dh     TEXT    NOT NULL,
       auth       TEXT    NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX push_subs_user ON push_subs(user_id)'
  ],
  // DEV7: 意見案 the operators adopted (with $100,000 from the official bot),
  // operator rights given or taken away with the developer code, the access
  // days the official bot has celebrated, and garage space
  [
    'ALTER TABLE feedback ADD COLUMN adopted_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE feedback ADD COLUMN adopted_by INTEGER NOT NULL DEFAULT 0',
    // a session the server ended (why, said once at its next use)
    "ALTER TABLE sessions ADD COLUMN ended TEXT NOT NULL DEFAULT ''",
    // granted 1: an operator (besides config.operators), 0: rights taken away
    `CREATE TABLE ops_access (
       name_key TEXT    PRIMARY KEY,
       granted  INTEGER NOT NULL,
       at       INTEGER NOT NULL,
       by_id    INTEGER NOT NULL DEFAULT 0
     )`,
    // the highest access-day milestone paid (5, 10 … 35)
    'ALTER TABLE users ADD COLUMN days_paid INTEGER NOT NULL DEFAULT 0',
    // garage places bought on top of the two everyone has
    'ALTER TABLE users ADD COLUMN garage_extra INTEGER NOT NULL DEFAULT 0'
  ]
];

export const SCHEMA_VERSION = MIGRATIONS.length;
export const TABLES = ['users', 'sessions', 'messages', 'conversations', 'transfers', 'blocks', 'spins',
  'friends', 'friend_requests', 'cars', 'watchers', 'items', 'debts', 'chat_groups', 'chat_members', 'feedback',
  'battles', 'watch_bets', 'hubs', 'hub_members', 'hub_invites', 'devices', 'trees', 'tree_auctions', 'npc_friends', 'reports', 'detections', 'bot_threads', 'ops_log', 'push_subs', 'ops_access', 'meta'];

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
