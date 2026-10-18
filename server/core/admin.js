// Operator commands, shared by the Node CLI (server/node/admin-cli.js) and the
// POST /api/admin endpoint (Cloudflare has no shell). Balances can be raised
// or lowered by hand but never below zero, and nothing here wipes accounts.
import { statements, TABLES, SCHEMA_VERSION } from './db.js';
import { cleanName, nameKey, newRecoveryCode, normalizeRecoveryCode, sha256 } from './auth.js';
import { utcDay } from './rules.js';

const CURRENCIES = ['tokens', 'dollars', 'coins'];
const REDACTED = '（このメッセージは削除されました）';

export class AdminError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminError';
  }
}

export function createAdmin(db) {
  const q = statements(db);
  const tx = (fn) => db.tx(fn);

  // "#12" or "12" = user id, anything else = user name (case-insensitive)
  function find(ref) {
    const s = String(ref ?? '').trim();
    if (!s) throw new AdminError('ユーザーを指定してください（ID または名前）');
    const id = /^#?\d+$/.test(s) ? Number(s.replace('#', '')) : null;
    const u = id !== null
      ? q('SELECT * FROM users WHERE id = ?').get(id)
      : q('SELECT * FROM users WHERE name_key = ?').get(nameKey(s));
    if (!u) throw new AdminError(`ユーザーが見つかりません: ${s}`);
    return u;
  }

  const admin = {
    find,

    users({ query = '', limit = 50 } = {}) {
      const like = `%${nameKey(query)}%`;
      return q(`SELECT id, name, tokens, dollars, coins, total_won, spins, banned, last_seen FROM users
                WHERE name_key LIKE ? ORDER BY last_seen DESC LIMIT ?`).all(like, limit);
    },

    show(ref) {
      const u = find(ref);
      const one = (sql) => q(sql).get(u.id).n;
      return {
        ...u,
        recovery_hash: undefined,
        password_hash: u.password_hash ? '(set)' : '(none)',
        last_spin: undefined,
        sessions: one('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?'),
        friends: one('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?'),
        cars: one('SELECT COUNT(*) AS n FROM cars WHERE owner_id = ?'),
        transfersSent: one('SELECT COUNT(*) AS n FROM transfers WHERE from_id = ?'),
        transfersReceived: one('SELECT COUNT(*) AS n FROM transfers WHERE to_id = ?')
      };
    },

    ban(ref, on = true) {
      const u = find(ref);
      q('UPDATE users SET banned = ? WHERE id = ?').run(on ? 1 : 0, u.id);
      return { id: u.id, name: u.name, banned: !!on };
    },

    // amount may be negative; balances never go below zero
    grant(ref, currency, amount) {
      if (!CURRENCIES.includes(currency)) throw new AdminError(`通貨は ${CURRENCIES.join(' / ')} のどれかです`);
      const n = Number(amount);
      if (!Number.isSafeInteger(n) || n === 0) throw new AdminError('金額は 0 以外の整数で指定してください');
      return tx(() => {
        const u = find(ref);
        if (u[currency] + n < 0) throw new AdminError(`残高が足りません（現在 ${u[currency]}）`);
        // `currency` is one of CURRENCIES, so it is safe as a column name
        q(`UPDATE users SET ${currency} = ${currency} + ?, rev = rev + 1 WHERE id = ?`).run(n, u.id);
        return { id: u.id, name: u.name, currency, before: u[currency], after: u[currency] + n };
      });
    },

    rename(ref, newName) {
      const { name, key } = cleanName(newName);
      return tx(() => {
        const u = find(ref);
        const other = q('SELECT id FROM users WHERE name_key = ?').get(key);
        if (other && other.id !== u.id) throw new AdminError(`この名前はすでに使われています: ${name}`);
        q('UPDATE users SET name = ?, name_key = ? WHERE id = ?').run(name, key, u.id);
        return { id: u.id, before: u.name, after: name };
      });
    },

    // New recovery code for a player who lost theirs (check who is asking first!)
    recovery(ref) {
      const u = find(ref);
      const code = newRecoveryCode();
      q('UPDATE users SET recovery_hash = ? WHERE id = ?').run(sha256(normalizeRecoveryCode(code)), u.id);
      return { id: u.id, name: u.name, recoveryCode: code };
    },

    // Signs the player out everywhere.
    logout(ref) {
      const u = find(ref);
      const r = q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      return { id: u.id, name: u.name, sessions: Number(r.changes) };
    },

    messages({ limit = 30, ref = null } = {}) {
      if (ref) {
        const u = find(ref);
        return q(`SELECT m.id, m.channel, m.kind, m.body, m.amount, m.currency, m.created_at, s.name AS sender
                  FROM messages m LEFT JOIN users s ON s.id = m.sender_id WHERE m.sender_id = ? ORDER BY m.id DESC LIMIT ?`).all(u.id, limit);
      }
      return q(`SELECT m.id, m.channel, m.kind, m.body, m.amount, m.currency, m.created_at, s.name AS sender
                FROM messages m LEFT JOIN users s ON s.id = m.sender_id WHERE m.channel = 'lobby' ORDER BY m.id DESC LIMIT ?`).all(limit);
    },

    // Blanks a chat message (lobby or direct); transfer and gift records stay as they are.
    redact(id) {
      const m = q('SELECT id, kind FROM messages WHERE id = ?').get(Number(id));
      if (!m) throw new AdminError(`メッセージが見つかりません: ${id}`);
      if (m.kind === 'transfer' || m.kind === 'gift') throw new AdminError('送金・プレゼントの記録は消せません');
      q('UPDATE messages SET body = ? WHERE id = ?').run(REDACTED, m.id);
      return { id: m.id };
    },

    stats() {
      const today = utcDay();
      const one = (sql, ...a) => q(sql).get(...a).n;
      return {
        players: one('SELECT COUNT(*) AS n FROM users'),
        banned: one('SELECT COUNT(*) AS n FROM users WHERE banned = 1'),
        activeToday: one('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?', Date.now() - 86400000),
        tokens: one('SELECT COALESCE(SUM(tokens), 0) AS n FROM users'),
        dollars: one('SELECT COALESCE(SUM(dollars), 0) AS n FROM users'),
        spins: one('SELECT COALESCE(SUM(spins), 0) AS n FROM users'),
        wonToday: one('SELECT COALESCE(SUM(day_won), 0) AS n FROM users WHERE won_day = ?', today),
        friendships: one('SELECT COUNT(*) AS n FROM friends') / 2,
        cars: one('SELECT COUNT(*) AS n FROM cars'),
        messages: one('SELECT COUNT(*) AS n FROM messages'),
        transfers: one('SELECT COUNT(*) AS n FROM transfers')
      };
    },

    // Every table as JSON: a complete backup that import() can restore.
    export() {
      const tables = {};
      for (const t of TABLES) tables[t] = q(`SELECT * FROM ${t}`).all();
      return { format: 'two-state-casino', schema: SCHEMA_VERSION, exportedAt: Date.now(), tables };
    },

    // Restores an export. Refuses to overwrite a database that already has
    // players unless `replace` is set, so a mistaken import cannot wipe money.
    import(data, { replace = false } = {}) {
      if (!data || data.format !== 'two-state-casino' || !data.tables) throw new AdminError('バックアップの形式が正しくありません');
      if (Number(data.schema) !== SCHEMA_VERSION) throw new AdminError(`バックアップのスキーマ（${data.schema}）が現在（${SCHEMA_VERSION}）と違います`);
      const players = q('SELECT COUNT(*) AS n FROM users').get().n;
      if (players > 0 && !replace) throw new AdminError(`すでに ${players} 人のプレイヤーがいます。上書きするには replace を指定してください`);
      return tx(() => {
        const counts = {};
        for (const t of TABLES) {
          if (t === 'meta') continue;
          q(`DELETE FROM ${t}`).run();
          const rows = data.tables[t] || [];
          for (const row of rows) {
            const cols = Object.keys(row);
            if (!cols.every((c) => /^[a-z_]+$/.test(c))) throw new AdminError(`列名が正しくありません: ${t}`);
            q(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c) => row[c]));
          }
          counts[t] = rows.length;
        }
        return counts;
      });
    }
  };

  // Dispatch used by POST /api/admin: { cmd, args: [...] }
  admin.command = (cmd, args) => {
    switch (cmd) {
      case 'stats': return admin.stats();
      case 'users': return admin.users({ query: args[0] || '' });
      case 'show': return admin.show(args[0]);
      case 'ban': return admin.ban(args[0], true);
      case 'unban': return admin.ban(args[0], false);
      case 'grant': return admin.grant(args[0], args[1], args[2]);
      case 'rename': return admin.rename(args[0], args[1]);
      case 'recovery': return admin.recovery(args[0]);
      case 'logout': return admin.logout(args[0]);
      case 'messages': return admin.messages({ ref: args[0] || null });
      case 'redact': return admin.redact(args[0]);
      case 'export': return admin.export();
      case 'import': return admin.import(args[0], { replace: !!args[1] });
      default: throw new AdminError(`不明なコマンド: ${cmd}`);
    }
  };

  return admin;
}
