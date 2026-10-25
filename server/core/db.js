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
    'ALTER TABLE users ADD COLUMN garage_extra INTEGER NOT NULL DEFAULT 0',
    // a car rented out: since when (0: at home), when it comes back (0: not
    // asked), the 5-hour blocks paid for, $ waiting, the last block's customers
    'ALTER TABLE cars ADD COLUMN rent_start INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE cars ADD COLUMN rent_until INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE cars ADD COLUMN rent_blocks INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE cars ADD COLUMN rent_earned INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE cars ADD COLUMN rent_last TEXT NOT NULL DEFAULT ''"
  ],
  // DEV8: 開発者支援 (server/core/pay.js): the orders, with what the payment
  // company said about them and the developer's answer, and its notices
  // already handled; the developer's vault (server/core/vault.js): files kept
  // in pieces, and the time-limited links to fetch one
  [
    // status: new (asking Stripe) → open (its payment page is up) → pending
    // (a konbini payment slip waits for the cash) → paid; or failed, expired,
    // canceled, refunded, error (no payment page), review (Stripe's answer
    // did not match the order: nothing given, for the developer to look at)
    `CREATE TABLE pay_orders (
       id            TEXT    PRIMARY KEY,
       user_id       INTEGER NOT NULL,
       plan          TEXT    NOT NULL,
       qty           INTEGER NOT NULL,
       coins         INTEGER NOT NULL,
       bonus         INTEGER NOT NULL DEFAULT 0,
       amount        INTEGER NOT NULL,
       method        TEXT    NOT NULL,
       status        TEXT    NOT NULL,
       session_id    TEXT    NOT NULL DEFAULT '',
       intent_id     TEXT    NOT NULL DEFAULT '',
       voucher_url   TEXT    NOT NULL DEFAULT '',
       voucher_until INTEGER NOT NULL DEFAULT 0,
       livemode      INTEGER NOT NULL DEFAULT 0,
       ip            TEXT    NOT NULL DEFAULT '',
       created_at    INTEGER NOT NULL,
       updated_at    INTEGER NOT NULL,
       paid_at       INTEGER NOT NULL DEFAULT 0,
       checked_at    INTEGER NOT NULL DEFAULT 0,
       refunded_at   INTEGER NOT NULL DEFAULT 0,
       coins_back    INTEGER NOT NULL DEFAULT 0,
       replied_at    INTEGER NOT NULL DEFAULT 0,
       replied_by    INTEGER NOT NULL DEFAULT 0,
       reply         TEXT    NOT NULL DEFAULT ''
     )`,
    'CREATE INDEX pay_orders_user ON pay_orders(user_id, created_at)',
    'CREATE INDEX pay_orders_paid ON pay_orders(status, paid_at)',
    "CREATE UNIQUE INDEX pay_orders_session ON pay_orders(session_id) WHERE session_id != ''",
    "CREATE INDEX pay_orders_intent ON pay_orders(intent_id) WHERE intent_id != ''",
    `CREATE TABLE pay_events (
       id       TEXT    PRIMARY KEY,
       type     TEXT    NOT NULL,
       order_id TEXT    NOT NULL DEFAULT '',
       at       INTEGER NOT NULL
     )`,
    // a file: its pieces (1 MiB each, base64) and the SHA-256 of each, and of
    // the list of them all once every piece is in; for a 3D model, a small
    // picture of it and what is in it, and its light copy (a file whose
    // `parent` is the model)
    `CREATE TABLE vault_files (
       id         TEXT    PRIMARY KEY,
       name       TEXT    NOT NULL,
       type       TEXT    NOT NULL DEFAULT '',
       note       TEXT    NOT NULL DEFAULT '',
       size       INTEGER NOT NULL,
       chunks     INTEGER NOT NULL,
       received   INTEGER NOT NULL DEFAULT 0,
       sha256     TEXT    NOT NULL DEFAULT '',
       created_by INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       done_at    INTEGER NOT NULL DEFAULT 0,
       parent     TEXT    NOT NULL DEFAULT '',
       preview    TEXT    NOT NULL DEFAULT '',
       info       TEXT    NOT NULL DEFAULT ''
     )`,
    'CREATE INDEX vault_files_parent ON vault_files(parent)',
    `CREATE TABLE vault_chunks (
       file_id TEXT    NOT NULL,
       n       INTEGER NOT NULL,
       sha256  TEXT    NOT NULL,
       data    TEXT    NOT NULL,
       PRIMARY KEY (file_id, n)
     )`,
    // only the hash of a link's secret is kept; file_id '*': the whole vault
    `CREATE TABLE vault_links (
       token_hash TEXT    PRIMARY KEY,
       file_id    TEXT    NOT NULL,
       until      INTEGER NOT NULL,
       uses       INTEGER NOT NULL DEFAULT 0,
       revoked    INTEGER NOT NULL DEFAULT 0,
       created_by INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX vault_links_file ON vault_links(file_id)',
    // VIP: until when it is on (0: never), its EXP
    'ALTER TABLE users ADD COLUMN vip_until INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN vip_exp REAL NOT NULL DEFAULT 0',
    // a car: what its owner paid for it (0: its list price), sold between
    // players once (中古車), the chat offer it is in (a message)
    'ALTER TABLE cars ADD COLUMN paid INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE cars ADD COLUMN used INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE cars ADD COLUMN offer_id INTEGER NOT NULL DEFAULT 0',
    // how it came: '' from Car Owner, 'gift', 'friend' (bought from one)
    "ALTER TABLE cars ADD COLUMN via TEXT NOT NULL DEFAULT ''",
    // a car offer in a chat: '' open, 'sold', 'canceled'
    "ALTER TABLE messages ADD COLUMN state TEXT NOT NULL DEFAULT ''"
  ],
  // DEV9: the vault's folders (folders in folders too), the folder of each
  // file ('' the top), and the size of a file's pieces (bigger with a bucket)
  [
    `CREATE TABLE vault_folders (
       id         TEXT    PRIMARY KEY,
       name       TEXT    NOT NULL,
       parent     TEXT    NOT NULL DEFAULT '',
       created_by INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX vault_folders_parent ON vault_folders(parent)',
    "ALTER TABLE vault_files ADD COLUMN folder TEXT NOT NULL DEFAULT ''",
    'CREATE INDEX vault_files_folder ON vault_files(folder)',
    'ALTER TABLE vault_files ADD COLUMN piece INTEGER NOT NULL DEFAULT 1048576',
    // what an AI did with a file (JSON: [{ at, kind, text }]), and when an AI
    // put it in the game (実装済み: out of the links, kept in the vault); a
    // link made for an AI (it labels what it takes and what it put in the game)
    "ALTER TABLE vault_files ADD COLUMN labels TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE vault_files ADD COLUMN implemented_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE vault_links ADD COLUMN ai INTEGER NOT NULL DEFAULT 0',
    // 運営チャット: the operators to one another (to_id) or to all of them (0),
    // and how far each has read each conversation (peer 0: the one with all)
    `CREATE TABLE ops_messages (
       id         INTEGER PRIMARY KEY,
       from_id    INTEGER NOT NULL,
       to_id      INTEGER NOT NULL DEFAULT 0,
       body       TEXT    NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    'CREATE INDEX ops_messages_to ON ops_messages(to_id, from_id, id)',
    `CREATE TABLE ops_reads (
       user_id INTEGER NOT NULL,
       peer_id INTEGER NOT NULL,
       read_id INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (user_id, peer_id)
     )`
  ],
  // the operator site's login waits (server/core/opslogin.js); the
  // プレイヤーアーカイブ (a 永久BAN or a deleted account: when, why, when all
  // of it goes, and the account it went with), the 永久BAN ones already there
  // starting their 90 days now; the release the player's game last said it
  // runs, and on what; the developer's backups (server/core/backup.js); the
  // log's kinds looked up by action; the vault's short messages on a file
  [
    `CREATE TABLE ops_locks (
       key   TEXT    PRIMARY KEY,
       fails INTEGER NOT NULL DEFAULT 0,
       step  INTEGER NOT NULL DEFAULT 0,
       until INTEGER NOT NULL DEFAULT 0,
       at    INTEGER NOT NULL DEFAULT 0
     )`,
    'ALTER TABLE users ADD COLUMN archived_at INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN archive_reason TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN purge_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN archive_with INTEGER NOT NULL DEFAULT 0',
    'CREATE INDEX users_archive ON users(archived_at)',
    'CREATE INDEX users_purge ON users(purge_at)',
    `UPDATE users SET archived_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, archive_reason = 'perma',
       purge_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 90 * 86400000 WHERE banned = 1 AND ban_kind = 'perma'`,
    'ALTER TABLE users ADD COLUMN client_release INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN client_build TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE users ADD COLUMN client_at INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN client_agent TEXT NOT NULL DEFAULT ''",
    `CREATE TABLE backups (
       id       TEXT    PRIMARY KEY,
       at       INTEGER NOT NULL,
       kind     TEXT    NOT NULL,
       size     INTEGER NOT NULL,
       sealed   INTEGER NOT NULL,
       sha256   TEXT    NOT NULL,
       store    TEXT    NOT NULL,
       parts    INTEGER NOT NULL DEFAULT 0,
       envelope TEXT    NOT NULL,
       counts   TEXT    NOT NULL DEFAULT '{}'
     )`,
    `CREATE TABLE backup_parts (
       backup_id TEXT    NOT NULL,
       n         INTEGER NOT NULL,
       data      TEXT    NOT NULL,
       PRIMARY KEY (backup_id, n)
     )`,
    'CREATE INDEX ops_log_action ON ops_log(action)',
    `CREATE TABLE vault_notes (
       id         INTEGER PRIMARY KEY,
       file_id    TEXT    NOT NULL,
       by_id      INTEGER NOT NULL,
       body       TEXT    NOT NULL,
       created_at INTEGER NOT NULL,
       until      INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX vault_notes_file ON vault_notes(file_id, id)'
  ],
  // DEV9: money, cars and items sent wait for the other to tap them (pending);
  // a message taken back by its sender within the hour (what it said stays
  // for the operators); the chat stopped by the automatic filter until an
  // operator lets it go again (when, and why); the message a report is about;
  // the update thank-you money waiting for the tap on the thanks
  [
    'ALTER TABLE messages ADD COLUMN pending INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE messages ADD COLUMN retracted_at INTEGER NOT NULL DEFAULT 0',
    'CREATE INDEX messages_pending ON messages(recipient_id, pending)',
    'ALTER TABLE users ADD COLUMN chat_ban INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE users ADD COLUMN chat_ban_why TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE reports ADD COLUMN message_id INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN release_bonus INTEGER NOT NULL DEFAULT 0'
  ],
  // DEV10: the security shield (server/core/shield.js) — the addresses,
  // accounts and devices it has blocked (attacks, floods, scanners), kept so
  // a restart does not forget them; and the security base (/sec/) operators'
  // channel, its messages sealed at rest so a copy of the database alone
  // cannot read them. The lockdown's state lives in meta ('emergency', with a
  // level), alongside the emergency stop it grew out of.
  [
    `CREATE TABLE security_blocks (
       key      TEXT    PRIMARY KEY,
       scope    TEXT    NOT NULL,
       target   TEXT    NOT NULL DEFAULT '',
       reason   TEXT    NOT NULL DEFAULT '',
       score    INTEGER NOT NULL DEFAULT 0,
       hits     INTEGER NOT NULL DEFAULT 0,
       first_at INTEGER NOT NULL,
       at       INTEGER NOT NULL,
       until    INTEGER NOT NULL DEFAULT 0,
       step     INTEGER NOT NULL DEFAULT 0,
       by_id    INTEGER NOT NULL DEFAULT 0,
       manual   INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX security_blocks_until ON security_blocks(until)',
    `CREATE TABLE sec_messages (
       id         INTEGER PRIMARY KEY,
       from_id    INTEGER NOT NULL,
       from_name  TEXT    NOT NULL DEFAULT '',
       body       TEXT    NOT NULL,
       created_at INTEGER NOT NULL
     )`
  ],
  // 保管庫のアップデート: the vault two operators share (server/core/vault.js).
  // A file's or a folder's vault ('' the developer's own, 'p:<a>:<b>' the one
  // the operators with ids a < b share); what one operator may keep in the
  // shared vaults when the developer approved more than 1GB (always a limit),
  // and their requests for it.
  [
    "ALTER TABLE vault_files ADD COLUMN space TEXT NOT NULL DEFAULT ''",
    'CREATE INDEX vault_files_space ON vault_files(space, folder)',
    'CREATE INDEX vault_files_by ON vault_files(created_by, space)',
    "ALTER TABLE vault_folders ADD COLUMN space TEXT NOT NULL DEFAULT ''",
    'CREATE INDEX vault_folders_space ON vault_folders(space, parent)',
    `CREATE TABLE vault_quotas (
       user_id INTEGER PRIMARY KEY,
       bytes   INTEGER NOT NULL,
       by_id   INTEGER NOT NULL,
       at      INTEGER NOT NULL
     )`,
    // status: open → approved (limit_bytes: the limit the developer set), declined or canceled
    `CREATE TABLE vault_requests (
       id          INTEGER PRIMARY KEY,
       user_id     INTEGER NOT NULL,
       bytes       INTEGER NOT NULL,
       reason      TEXT    NOT NULL DEFAULT '',
       status      TEXT    NOT NULL DEFAULT 'open',
       created_at  INTEGER NOT NULL,
       handled_by  INTEGER NOT NULL DEFAULT 0,
       handled_at  INTEGER NOT NULL DEFAULT 0,
       limit_bytes INTEGER NOT NULL DEFAULT 0
     )`,
    'CREATE INDEX vault_requests_user ON vault_requests(user_id, id)',
    'CREATE INDEX vault_requests_status ON vault_requests(status, id)'
  ],
  // DEV11: what was said is kept for good — an account 90 days in the archive
  // keeps only its name on it (purged_at: when the rest went), and the chats
  // once only in memory are written down too: a home's chat (place 'home',
  // room: the host) and 友達と稼ぐ's 即席チャット ('hub', room: the hub).
  // The vault's backups and personal vaults (below).
  [
    'ALTER TABLE users ADD COLUMN purged_at INTEGER NOT NULL DEFAULT 0',
    `CREATE TABLE live_chats (
       id           INTEGER PRIMARY KEY,
       place        TEXT    NOT NULL,
       room         INTEGER NOT NULL,
       sender_id    INTEGER NOT NULL,
       recipient_id INTEGER NOT NULL DEFAULT 0,
       body         TEXT    NOT NULL,
       original     TEXT    NOT NULL DEFAULT '',
       created_at   INTEGER NOT NULL
     )`,
    'CREATE INDEX live_chats_room ON live_chats(place, room, id)',
    'CREATE INDEX live_chats_sender ON live_chats(sender_id, id)',
    // the vault: the developer's backups of any file (backup_at: since when;
    // one deleted from its vault then waits in the backups, `from_*` saying
    // where it was), and each operator's own vault ('u:<id>', a new space)
    'ALTER TABLE vault_files ADD COLUMN backup_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE vault_files ADD COLUMN backup_by INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE vault_files ADD COLUMN removed_at INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE vault_files ADD COLUMN removed_by INTEGER NOT NULL DEFAULT 0',
    "ALTER TABLE vault_files ADD COLUMN from_space TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE vault_files ADD COLUMN from_folder TEXT NOT NULL DEFAULT ''",
    'CREATE INDEX vault_files_backup ON vault_files(backup_at)',
    // 閲覧者: players the developer lets look at the operator site (granted 1;
    // 0 once taken away), and the sessions of that look (scope 'view': they
    // can do nothing but look, not even play)
    `CREATE TABLE ops_viewers (
       user_id INTEGER PRIMARY KEY,
       granted INTEGER NOT NULL DEFAULT 1,
       at      INTEGER NOT NULL,
       by_id   INTEGER NOT NULL
     )`,
    "ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT ''",
    // the operators' group call of the 全体チャット: who is in it (kept here so
    // the server going to sleep does not forget; one whose site connection
    // is gone is not counted)
    `CREATE TABLE ops_call (
       user_id INTEGER PRIMARY KEY,
       at      INTEGER NOT NULL
     )`
  ],
  // DEV11 (2): the operator site's ログインログ — the first time each day
  // (Japan time) an operator, the developer or a 閲覧者 comes into the site
  // (how: 'button', the day's ログイン button; 'password', a login with the
  // password), seen by the developer only — and VIP's free trial (VIP3 for
  // 3 days, once in a player's life: vip_trial_until, when it ends; 0: never)
  [
    `CREATE TABLE ops_entries (
       id      INTEGER PRIMARY KEY,
       user_id INTEGER NOT NULL,
       role    TEXT    NOT NULL,
       day     TEXT    NOT NULL,
       at      INTEGER NOT NULL,
       how     TEXT    NOT NULL,
       agent   TEXT    NOT NULL DEFAULT ''
     )`,
    'CREATE UNIQUE INDEX ops_entries_day ON ops_entries(user_id, day)',
    'ALTER TABLE users ADD COLUMN vip_trial_until INTEGER NOT NULL DEFAULT 0'
  ],
  // DEV12: files inside a file in the vault (inside: the file it is in; ''
  // none). Such a file keeps its container's vault and folder, so it moves
  // with it.
  [
    "ALTER TABLE vault_files ADD COLUMN inside TEXT NOT NULL DEFAULT ''",
    'CREATE INDEX vault_files_inside ON vault_files(inside)'
  ],
  // VIP extension schedules and permanent VIP2 benefits after earning VIP4.
  [
    "ALTER TABLE users ADD COLUMN vip_modes TEXT NOT NULL DEFAULT '[]'",
    'ALTER TABLE users ADD COLUMN vip_permanent_at INTEGER NOT NULL DEFAULT 0'
  ],
  // A full rental waits for collection; its next block starts when collected.
  [
    'ALTER TABLE cars ADD COLUMN rent_paused INTEGER NOT NULL DEFAULT 0',
    `UPDATE cars SET rent_paused = CASE WHEN rent_start > 0 AND rent_until = 0 THEN 1 ELSE 0 END,
       rent_start = 0, rent_until = 0, rent_blocks = 0, rent_earned = 4500000 WHERE rent_earned >= 4500000`
  ],
  // An installed engine belongs to its car and travels with a transferred car.
  ["ALTER TABLE cars ADD COLUMN engine TEXT NOT NULL DEFAULT ''"],
  // Durable sending totals, independent of message receipt/expiry/deletion.
  [`CREATE TABLE player_transfer_days (
      user_id INTEGER NOT NULL,
      day INTEGER NOT NULL,
      dollars INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    )`,
    'CREATE INDEX messages_sender_time ON messages(sender_id, created_at)'],
  // Replace the retired player catalog once. NPC portraits remain their own;
  // later restarts must keep purchased portraits and the player's selection.
  [
    "UPDATE users SET avatar = 'traveler-green', avatars = '', rev = rev + 1 WHERE npc = ''"
  ],
  // DEV UNIT: durable discussion and per-account unread cursors.
  [
    `CREATE TABLE devunit_comments (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE TABLE devunit_reads (user_id INTEGER PRIMARY KEY, last_id INTEGER NOT NULL DEFAULT 0)`
  ],
  // Live developer diary and private feedback. AUTOINCREMENT prevents deleted
  // post identifiers from becoming another post (and another reward).
  [
    `CREATE TABLE diary_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL, image TEXT NOT NULL DEFAULT '', reward INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE diary_reads (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(post_id, user_id))`,
    `CREATE TABLE diary_reactions (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, liked INTEGER NOT NULL DEFAULT 0, bookmarked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(post_id, user_id))`,
    `CREATE TABLE diary_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT NOT NULL, original TEXT NOT NULL, words TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    'CREATE INDEX diary_comments_post ON diary_comments(post_id, id)',
    'CREATE INDEX diary_comments_author ON diary_comments(post_id, user_id, id)',
    `CREATE TABLE diary_claims (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(post_id, user_id))`
  ],
  [
    `CREATE TABLE ops_mfa (user_id INTEGER PRIMARY KEY, mode INTEGER NOT NULL DEFAULT 0, secret TEXT NOT NULL DEFAULT '', phrase_hash TEXT NOT NULL DEFAULT '', recovery TEXT NOT NULL DEFAULT '[]', last_step INTEGER NOT NULL DEFAULT -1, version INTEGER NOT NULL DEFAULT 0, pending_secret TEXT NOT NULL DEFAULT '', pending_until INTEGER NOT NULL DEFAULT 0)`,
    'ALTER TABLE sessions ADD COLUMN ops_mfa_version INTEGER NOT NULL DEFAULT 0'
  ],
  // The operator screen view (server/core/opswatch.js): an operator may mark a
  // player a favourite (ops_favorites), and every watch is written down when
  // it ends — who watched whom, for how long and how many bytes it cost
  // (ops_watch_log) — with each operator's running total kept for the サーバー
  // tab (ops_watch_usage). The watch sessions themselves are live only (memory).
  [
    `CREATE TABLE ops_favorites (
       op_id      INTEGER NOT NULL,
       player_id  INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (op_id, player_id)
     )`,
    'CREATE INDEX ops_favorites_player ON ops_favorites(player_id)',
    `CREATE TABLE ops_watch_log (
       id         INTEGER PRIMARY KEY,
       op_id      INTEGER NOT NULL,
       player_id  INTEGER NOT NULL,
       started_at INTEGER NOT NULL,
       ended_at   INTEGER NOT NULL,
       ms         INTEGER NOT NULL,
       bytes      INTEGER NOT NULL,
       frames     INTEGER NOT NULL DEFAULT 0,
       quality    TEXT    NOT NULL DEFAULT '',
       reason     TEXT    NOT NULL DEFAULT ''
     )`,
    'CREATE INDEX ops_watch_log_op ON ops_watch_log(op_id, id)',
    'CREATE INDEX ops_watch_log_player ON ops_watch_log(player_id, id)',
    `CREATE TABLE ops_watch_usage (
       op_id   INTEGER PRIMARY KEY,
       bytes   INTEGER NOT NULL DEFAULT 0,
       ms      INTEGER NOT NULL DEFAULT 0,
       watches INTEGER NOT NULL DEFAULT 0
     )`
  ]
];

MIGRATIONS.push(["ALTER TABLE vault_files ADD COLUMN thumbnail TEXT NOT NULL DEFAULT ''"]);

export const SCHEMA_VERSION = MIGRATIONS.length;
// what a backup holds (not the vault's files: they are big, and the developer
// has them; nor what goes with them, the operators' limits and requests)
export const TABLES = ['users', 'sessions', 'messages', 'conversations', 'transfers', 'player_transfer_days', 'blocks', 'spins',
  'friends', 'friend_requests', 'cars', 'watchers', 'items', 'debts', 'chat_groups', 'chat_members', 'feedback',
  'battles', 'watch_bets', 'hubs', 'hub_members', 'hub_invites', 'devices', 'trees', 'tree_auctions', 'npc_friends', 'reports', 'detections', 'bot_threads', 'ops_log', 'push_subs', 'ops_access', 'live_chats', 'ops_viewers', 'ops_entries',
  'pay_orders', 'pay_events', 'ops_messages', 'ops_reads', 'security_blocks', 'sec_messages', 'devunit_comments', 'devunit_reads',
  'diary_posts', 'diary_reads', 'diary_reactions', 'diary_comments', 'diary_claims', 'ops_mfa',
  'ops_favorites', 'ops_watch_log', 'ops_watch_usage', 'meta'];

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
