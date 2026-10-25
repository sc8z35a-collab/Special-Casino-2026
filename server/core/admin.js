// Operator commands, shared by the Node CLI (server/node/admin-cli.js) and the
// POST /api/admin endpoint (Cloudflare has no shell). Balances can be raised
// or lowered by hand but never below zero, and nothing here wipes accounts.
import { statements, TABLES, SCHEMA_VERSION } from './db.js';
import { createOpsLog } from './opslog.js';
import { cleanName, nameKey, newRecoveryCode, normalizeRecoveryCode, sha256, cleanPassword, hashPassword } from './auth.js';
import { utcDay } from './rules.js';
import { createStaffPins } from './staffpin.js';
import { forgetExtension } from './ext.js';

const CURRENCIES = ['tokens', 'dollars', 'coins'];
const REDACTED = '（このメッセージは削除されました）';

export class AdminError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminError';
  }
}

// `seal(code)`: the 引き継ぎコード sealed for the operator site (server/core/api.js);
// `onBan(user, on)`: in the server, a ban reaches the player at once and the
// official bot tells them (lifting it too: then it is what lifts it);
// `isDeveloper(user)`: the developer's account, which no ban reaches
// `unlockLogins(name)`: the operator site's login waits cleared (one name's, or all), by the server that holds them
export function createAdmin(db, { seal = () => '', onBan = null, isDeveloper = () => false, unlockLogins = () => 0 } = {}) {
  const q = statements(db);
  const tx = (fn) => db.tx(fn);
  // what the commands change goes to the operators' log (server/core/opslog.js)
  const log = createOpsLog({ q });
  const pins = createStaffPins({ q });

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

    // 永久BAN (until unban); the operator site also has the week and 30-day ones
    ban(ref, on = true) {
      const u = find(ref);
      if (on && isDeveloper(u)) throw new AdminError('開発者のアカウントは処分できません');
      if (u.ban_kind === 'deleted') throw new AdminError('削除されたアカウントです（取り消せません）');
      if (on) {
        q("UPDATE users SET banned = 1, ban_kind = 'perma', ban_until = 0, ban_at = ? WHERE id = ?").run(Date.now(), u.id);
        if (onBan) onBan(u, true);
      } else if (onBan) onBan(u, false);
      else q("UPDATE users SET banned = 0, ban_kind = '', ban_until = 0 WHERE id = ?").run(u.id);
      return { id: u.id, name: u.name, banned: !!on };
    },

    // A new password for a player who forgot theirs (check who is asking first!)
    async password(ref, pw) {
      const u = find(ref);
      const clean = cleanPassword(pw);
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(clean), u.id);
      return { id: u.id, name: u.name, password: clean };
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
      q('UPDATE users SET recovery_hash = ?, recovery_enc = ? WHERE id = ?').run(sha256(normalizeRecoveryCode(code)), seal(code), u.id);
      return { id: u.id, name: u.name, recoveryCode: code };
    },

    // Signs the player out everywhere.
    logout(ref) {
      const u = find(ref);
      const r = q('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      return { id: u.id, name: u.name, sessions: Number(r.changes) };
    },

    // the staff rights of a name are bound to this account (after the first one went), or let go
    staffPin(ref) {
      const u = find(ref);
      pins.bind(u, 'admin command');
      return { id: u.id, name: u.name };
    },
    staffUnpin(ref) {
      const key = nameKey(String(ref ?? '').replace(/^#/, ''));
      const s = String(ref ?? '').trim();
      const u = /^#?\d+$/.test(s) ? q('SELECT name_key, name FROM users WHERE id = ?').get(Number(s.replace('#', ''))) : null;
      const name = u ? u.name_key : key;
      if (!name) throw new AdminError('名前（または ID）を指定してください');
      return { name: u ? u.name : s, removed: pins.forget(name) };
    },

    // the operator site's login waits cleared by hand: a name's (when someone shut an account out), or all of them
    loginUnlock(name) {
      const given = String(name ?? '').trim();
      return { name: given, cleared: unlockLogins(given) };
    },

    // an added part that guarded the uploads is gone on purpose: the uploads open again
    extForget(id) {
      const name = String(id ?? '').trim();
      if (!name) throw new AdminError('部品の名前を指定してください');
      return { id: name, removed: forgetExtension(q, name) };
    },

    messages({ limit = 30, ref = null } = {}) {
      if (ref) {
        const u = find(ref);
        return q(`SELECT m.id, m.channel, m.kind, m.body, m.amount, m.currency, m.created_at, s.name AS sender
                  FROM messages m LEFT JOIN users s ON s.id = m.sender_id WHERE m.sender_id = ? ORDER BY m.id DESC LIMIT ?`).all(u.id, limit);
      }
      return q(`SELECT m.id, m.channel, m.kind, m.body, m.amount, m.currency, m.created_at, s.name AS sender
                FROM messages m LEFT JOIN users s ON s.id = m.sender_id ORDER BY m.id DESC LIMIT ?`).all(limit);
    },

    // Blanks a chat message (direct or in a group); transfer and gift records stay as they are.
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
          // the operators' log is never deleted: every row of the backup is kept
          if (t === 'ops_log') {
            const r = log.keep(data.tables[t] || [], { why: 'バックアップからの復元', actorName: '管理コマンド' });
            counts[t] = r.added + r.kept;
            continue;
          }
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

  // What a command changed, in the operators' log (passwords and codes left out).
  const LOGGED = {
    ban: (r) => `${r.name}さんを永久BAN`,
    unban: (r) => `${r.name}さんのBANを解除`,
    grant: (r) => `${r.name}さんの${{ tokens: 'トークン', dollars: 'ドル', coins: 'ロイヤルコイン' }[r.currency]}を ${r.before.toLocaleString('en-US')} → ${r.after.toLocaleString('en-US')} に変更`,
    rename: (r) => `${r.before}さんの名前を「${r.after}」に変更`,
    recovery: (r) => `${r.name}さんの引き継ぎコードを再発行`,
    password: (r) => `${r.name}さんのパスワードを再設定`,
    logout: (r) => `${r.name}さんのログインを ${r.sessions}件解除`,
    'staff-pin': (r) => `運営の名前「${r.name}」の権限を、このアカウントに固定`,
    'ext-forget': (r) => `追加部品「${r.id}」が外れていても構わないことにした（${r.removed ? '記録を消した' : 'もともと記録なし'}）`,
    'staff-unpin': (r) => `運営の名前「${r.name}」の固定を解除（${r.removed ? '解除した' : 'もともと固定なし'}）`,
    'login-unlock': (r) => `運営サイトのログインの待ち時間を解除（${r.name ? `「${r.name}」` : 'すべて'}・${r.cleared}件）`,
    redact: (r) => `メッセージ #${r.id} を削除済みにした`,
    export: () => '全データのバックアップを書き出した',
    import: (r) => `バックアップから復元（${Object.entries(r).map(([t, n]) => `${t} ${n}`).join(', ')}）`
  };
  function logged(cmd, args, r, req) {
    if (!LOGGED[cmd]) return r;
    const target = r && r.id && cmd !== 'redact' ? q('SELECT id, name FROM users WHERE id = ?').get(r.id) : null;
    const safeArgs = cmd === 'password' ? [args[0], '（非表示）'] : cmd === 'import' ? ['（バックアップのデータ）', !!args[1]] : args;
    const result = r && typeof r === 'object' && !Array.isArray(r) && cmd !== 'export'
      ? { ...r, password: r.password ? '（非表示）' : undefined, recoveryCode: r.recoveryCode ? r.recoveryCode.slice(0, 4) + '…' : undefined } : null;
    log.add({ actorName: '管理コマンド', action: 'admin:' + cmd, target, summary: `管理コマンド：${LOGGED[cmd](r)}`, detail: { command: cmd, args: safeArgs, result }, req });
    return r;
  }

  // Dispatch used by POST /api/admin: { cmd, args: [...] } (req: who sent it, for the log)
  admin.command = async (cmd, args, req = null) => logged(cmd, args, await run(cmd, args), req);
  // the operators' log as it is now, and rows to keep after the database went back in time
  admin.logRows = () => log.all();
  admin.keepLog = (rows, info = {}, req = null) => {
    const r = tx(() => log.keep(rows, { why: `${info.restoredTo || ''} の時点への巻き戻し`, actorName: '管理コマンド' }));
    log.add({
      actorName: '管理コマンド', action: 'admin:restore-time', req,
      summary: `管理コマンド：データベースを ${info.restoredTo || '?'} の時点に巻き戻した（運営ログは ${r.added + r.kept}件をそのまま保持）`,
      detail: { ...info, logRowsAdded: r.added, logRowsKeptInside: r.kept }
    });
    return r;
  };
  function run(cmd, args) {
    switch (cmd) {
      case 'stats': return admin.stats();
      case 'users': return admin.users({ query: args[0] || '' });
      case 'show': return admin.show(args[0]);
      case 'ban': return admin.ban(args[0], true);
      case 'unban': return admin.ban(args[0], false);
      case 'grant': return admin.grant(args[0], args[1], args[2]);
      case 'rename': return admin.rename(args[0], args[1]);
      case 'recovery': return admin.recovery(args[0]);
      case 'password': return admin.password(args[0], args[1]);
      case 'logout': return admin.logout(args[0]);
      case 'staff-pin': return admin.staffPin(args[0]);
      case 'staff-unpin': return admin.staffUnpin(args[0]);
      case 'ext-forget': return admin.extForget(args[0]);
      case 'login-unlock': return admin.loginUnlock(args[0]);
      case 'messages': return admin.messages({ ref: args[0] || null });
      case 'redact': return admin.redact(args[0]);
      case 'export': return admin.export();
      case 'import': return admin.import(args[0], { replace: !!args[1] });
      default: throw new AdminError(`不明なコマンド: ${cmd}`);
    }
  }

  return admin;
}
