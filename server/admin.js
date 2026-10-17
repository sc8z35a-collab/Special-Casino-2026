// Operator commands for the BLOCKBUSTER REELS database.
//
//   node --disable-warning=ExperimentalWarning server/admin.js <command> [args]
//   (in Docker: docker compose exec app node server/admin.js <command> [args])
//
// Safe to run while the server is up (SQLite WAL). Balance changes reach the
// player on their next action or reconnect.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb, tx, statements } from './db.js';
import { cleanName, newRecoveryCode, normalizeRecoveryCode, sha256 } from './auth.js';
import { fmt, utcDay } from './rules.js';

const CURRENCIES = ['tokens', 'dollars', 'coins'];
const REDACTED = '（このメッセージは削除されました）';

export class AdminError extends Error {}

export function createAdmin(db) {
  const q = statements(db);

  // "#12" or "12" = user id, anything else = user name (case-insensitive)
  function find(ref) {
    const s = String(ref ?? '').trim();
    if (!s) throw new AdminError('ユーザーを指定してください（ID または名前）');
    const id = /^#?\d+$/.test(s) ? Number(s.replace('#', '')) : null;
    const u = id !== null
      ? q('SELECT * FROM users WHERE id = ?').get(id)
      : q('SELECT * FROM users WHERE name_key = ?').get(s.normalize('NFKC').toLowerCase());
    if (!u) throw new AdminError(`ユーザーが見つかりません: ${s}`);
    return u;
  }

  return {
    find,

    users({ query = '', limit = 50 } = {}) {
      const like = `%${String(query).normalize('NFKC').toLowerCase()}%`;
      return q(`SELECT id, name, tokens, dollars, coins, total_won, spins, banned, last_seen FROM users
                WHERE name_key LIKE ? ORDER BY last_seen DESC LIMIT ?`).all(like, limit);
    },

    show(ref) {
      const u = find(ref);
      const sessions = q('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(u.id).n;
      const sent = q('SELECT COUNT(*) AS n FROM transfers WHERE from_id = ?').get(u.id).n;
      const received = q('SELECT COUNT(*) AS n FROM transfers WHERE to_id = ?').get(u.id).n;
      return { ...u, recovery_hash: undefined, sessions, transfersSent: sent, transfersReceived: received };
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
      return tx(db, () => {
        const u = find(ref);
        if (u[currency] + n < 0) throw new AdminError(`残高が足りません（現在 ${fmt(u[currency])}）`);
        // `currency` is one of CURRENCIES, so it is safe as a column name
        q(`UPDATE users SET ${currency} = ${currency} + ?, rev = rev + 1 WHERE id = ?`).run(n, u.id);
        return { id: u.id, name: u.name, currency, before: u[currency], after: u[currency] + n };
      });
    },

    rename(ref, newName) {
      const { name, key } = cleanName(newName);
      return tx(db, () => {
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

    // Blanks a chat message (lobby or direct); transfer records stay as they are.
    redact(id) {
      const m = q('SELECT id, kind FROM messages WHERE id = ?').get(Number(id));
      if (!m) throw new AdminError(`メッセージが見つかりません: ${id}`);
      if (m.kind === 'transfer') throw new AdminError('送金の記録は消せません');
      q('UPDATE messages SET body = ? WHERE id = ?').run(REDACTED, m.id);
      return { id: m.id };
    },

    stats() {
      const today = utcDay();
      const one = (sql, ...a) => q(sql).get(...a);
      return {
        players: one('SELECT COUNT(*) AS n FROM users').n,
        banned: one('SELECT COUNT(*) AS n FROM users WHERE banned = 1').n,
        activeToday: one('SELECT COUNT(*) AS n FROM users WHERE last_seen > ?', Date.now() - 86400000).n,
        tokens: one('SELECT COALESCE(SUM(tokens), 0) AS n FROM users').n,
        dollars: one('SELECT COALESCE(SUM(dollars), 0) AS n FROM users').n,
        spins: one('SELECT COALESCE(SUM(spins), 0) AS n FROM users').n,
        wonToday: one('SELECT COALESCE(SUM(day_won), 0) AS n FROM users WHERE won_day = ?', today).n,
        messages: one('SELECT COUNT(*) AS n FROM messages').n,
        transfers: one('SELECT COUNT(*) AS n FROM transfers').n
      };
    },

    // Consistent copy of the live database.
    backup(file) {
      if (!file) throw new AdminError('保存先のファイル名を指定してください');
      const out = path.resolve(file);
      if (fs.existsSync(out)) throw new AdminError(`すでに存在します: ${out}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      db.prepare('VACUUM INTO ?').run(out);
      return { file: out, bytes: fs.statSync(out).size };
    }
  };
}

/* ------------------------------------------------------------------ CLI */

const HELP = `BLOCKBUSTER REELS 管理コマンド

  stats                              全体の数字
  users [検索語]                     プレイヤー一覧（最近ログイン順）
  show <ユーザー>                    1人の詳細
  ban <ユーザー> / unban <ユーザー>  利用停止 / 解除
  grant <ユーザー> <tokens|dollars|coins> <金額>   残高を増減（マイナスで減らす）
  rename <ユーザー> <新しい名前>     名前の変更
  recovery <ユーザー>                新しい引き継ぎコードを発行（本人確認のうえで）
  logout <ユーザー>                  全端末からログアウトさせる
  messages [ユーザー]                ロビーの最新メッセージ（ユーザー指定でその人の発言）
  redact <メッセージID>              メッセージを削除済みにする
  backup <ファイル>                  データベースのバックアップを作成

<ユーザー> は ID（例: 12 / #12）か名前です。`;

function table(rows, cols) {
  if (!rows.length) return '（なし）';
  const cells = rows.map((r) => cols.map(([k, f]) => String(f ? f(r[k], r) : r[k] ?? '')));
  const head = cols.map(([k]) => k);
  const width = (s) => Array.from(s).reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);
  const w = head.map((h, i) => Math.max(width(h), ...cells.map((c) => width(c[i]))));
  const line = (c) => c.map((s, i) => s + ' '.repeat(w[i] - width(s))).join('  ');
  return [line(head), line(w.map((n) => '-'.repeat(n))), ...cells.map(line)].join('\n');
}
const time = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '-');

export function run(argv, db, print = console.log) {
  const admin = createAdmin(db);
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'stats': {
      const s = admin.stats();
      print(Object.entries(s).map(([k, v]) => `${k.padEnd(12)} ${fmt(v)}`).join('\n'));
      break;
    }
    case 'users':
      print(table(admin.users({ query: args.join(' ') }), [
        ['id'], ['name'], ['tokens', fmt], ['dollars', fmt], ['total_won', fmt], ['spins', fmt],
        ['banned', (v) => (v ? 'BAN' : '')], ['last_seen', time]
      ]));
      break;
    case 'show': {
      const u = admin.show(args.join(' '));
      for (const k of ['created_at', 'last_seen']) u[k] = time(u[k]);
      print(Object.entries(u).filter(([, v]) => v !== undefined).map(([k, v]) => `${k.padEnd(18)} ${v}`).join('\n'));
      break;
    }
    case 'ban':
    case 'unban': {
      const r = admin.ban(args.join(' '), cmd === 'ban');
      print(`${r.name} (#${r.id}) を${r.banned ? '利用停止にしました' : '利用停止から戻しました'}`);
      break;
    }
    case 'grant': {
      const [ref, currency, amount] = args;
      const r = admin.grant(ref, currency, amount);
      print(`${r.name} (#${r.id}) ${r.currency}: ${fmt(r.before)} → ${fmt(r.after)}`);
      break;
    }
    case 'rename': {
      const [ref, ...name] = args;
      const r = admin.rename(ref, name.join(' '));
      print(`#${r.id}: ${r.before} → ${r.after}`);
      break;
    }
    case 'recovery': {
      const r = admin.recovery(args.join(' '));
      print(`${r.name} (#${r.id}) の新しい引き継ぎコード: ${r.recoveryCode}`);
      break;
    }
    case 'logout': {
      const r = admin.logout(args.join(' '));
      print(`${r.name} (#${r.id}) のログインを ${r.sessions} 件解除しました`);
      break;
    }
    case 'messages':
      print(table(admin.messages({ ref: args.length ? args.join(' ') : null }).reverse(), [
        ['id'], ['created_at', time], ['channel'], ['sender', (v) => v ?? '(system)'],
        ['body', (v, r) => (r.kind === 'transfer' ? `[送金 ${fmt(r.amount)} ${r.currency}]` : String(v).replace(/\s+/g, ' ').slice(0, 60))]
      ]));
      break;
    case 'redact':
      admin.redact(args[0]);
      print(`メッセージ ${args[0]} を削除済みにしました`);
      break;
    case 'backup': {
      const r = admin.backup(args[0]);
      print(`バックアップを作成しました: ${r.file} (${fmt(r.bytes)} bytes)`);
      break;
    }
    default:
      print(HELP);
      return cmd === undefined || cmd === 'help' || cmd === '--help' ? 0 : 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = openDb(loadConfig().dataDir);
  let code = 0;
  try {
    code = run(process.argv.slice(2), db);
  } catch (e) {
    console.error(e instanceof AdminError || e?.code ? (e.message || String(e)) : e);
    code = 1;
  } finally {
    db.close();
  }
  process.exit(code);
}
