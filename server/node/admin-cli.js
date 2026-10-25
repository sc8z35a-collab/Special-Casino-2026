// Operator commands.
//
//   Local database (Node host):
//     node --disable-warning=ExperimentalWarning server/node/admin-cli.js <command> [args]
//   Deployed server (Cloudflare or Node), using its ADMIN_TOKEN:
//     ADMIN_TOKEN=... node server/node/admin-cli.js --remote https://your-game.workers.dev <command> [args]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createAdmin, AdminError } from '../core/admin.js';
import { metaValue } from '../core/db.js';
import { sealText, keyFrom, nameKey } from '../core/auth.js';
import { fmt } from '../core/rules.js';
import { rowHash, GENESIS_HASH } from '../core/opslog.js';

const HELP = `BLOCKBUSTER REELS 管理コマンド

  stats                              全体の数字
  users [検索語]                     プレイヤー一覧（最近ログイン順）
  show <ユーザー>                    1人の詳細
  ban <ユーザー> / unban <ユーザー>  利用停止 / 解除
  grant <ユーザー> <tokens|dollars|coins> <金額>   残高を増減（マイナスで減らす）
  rename <ユーザー> <新しい名前>     名前の変更
  recovery <ユーザー>                新しい引き継ぎコードを発行（本人確認のうえで）
  password <ユーザー> <新しいパスワード>  パスワードを設定し直す（本人確認のうえで）
  logout <ユーザー>                  全端末からログアウトさせる
  staff-pin <ユーザー>               運営の名前の権限を、そのアカウントに固定する（元のアカウントが消えたあと、別の人が同じ名前を使っているとき）
  staff-unpin <名前>                 運営の名前の固定を解除する（その名前をもう一度登録できるようになる）
  ext-forget <部品の名前>            外れてアップロードを止めている追加部品を、外したままでよいことにする
  login-unlock [名前]                運営サイトのログインの待ち時間を解除する（名前を省くとすべて）
  stele [check|restore [--trust-unsigned]]  運営ログの石碑（外の控え）の状態 / いま刻んで全部確かめる / 失われた行を控えから戻す
  log-save <ファイル>                運営ログの全部を、1行1件のファイルに書き出す（つながりを確かめてから。上書きはしません）
  messages [ユーザー]                ロビーの最新メッセージ（ユーザー指定でその人の発言）
  redact <メッセージID>              メッセージを削除済みにする
  backup <ファイル>                  全データをファイルに保存（.json）
  restore <ファイル> [--replace]     backup で作ったファイルから戻す
  restore-time <日時>                Cloudflare 版のみ: データベースを過去の時点に戻す
                                     （例: 2026-10-17T12:00:00Z。30 日前まで。結果に取り消し用の値が出ます）
  quota                              --remote のみ: 今日のリクエスト数と送信量（DAILY_REQUEST_LIMIT / DAILY_MB_LIMIT）

  --remote <URL>   公開中のサーバーに対して実行（環境変数 ADMIN_TOKEN が必要）

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

// `call(cmd, args)` runs a command locally or remotely and returns its result.
export async function run(argv, call, print = console.log) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'stats': {
      const s = await call('stats', []);
      print(Object.entries(s).map(([k, v]) => `${k.padEnd(12)} ${fmt(v)}`).join('\n'));
      break;
    }
    case 'users':
      print(table(await call('users', [args.join(' ')]), [
        ['id'], ['name'], ['tokens', fmt], ['dollars', fmt], ['total_won', fmt], ['spins', fmt],
        ['banned', (v) => (v ? 'BAN' : '')], ['last_seen', time]
      ]));
      break;
    case 'show': {
      const u = await call('show', [args.join(' ')]);
      for (const k of ['created_at', 'last_seen']) u[k] = time(u[k]);
      print(Object.entries(u).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k.padEnd(18)} ${v}`).join('\n'));
      break;
    }
    case 'ban':
    case 'unban': {
      const r = await call(cmd, [args.join(' ')]);
      print(`${r.name} (#${r.id}) を${r.banned ? '利用停止にしました' : '利用停止から戻しました'}`);
      break;
    }
    case 'grant': {
      const r = await call('grant', args.slice(0, 3));
      print(`${r.name} (#${r.id}) ${r.currency}: ${fmt(r.before)} → ${fmt(r.after)}`);
      break;
    }
    case 'rename': {
      const [ref, ...name] = args;
      const r = await call('rename', [ref, name.join(' ')]);
      print(`#${r.id}: ${r.before} → ${r.after}`);
      break;
    }
    case 'recovery': {
      const r = await call('recovery', [args.join(' ')]);
      print(`${r.name} (#${r.id}) の新しい引き継ぎコード: ${r.recoveryCode}`);
      break;
    }
    case 'password': {
      const [ref, ...pw] = args;
      const r = await call('password', [ref, pw.join(' ')]);
      print(`${r.name} (#${r.id}) のパスワードを「${r.password}」にしました`);
      break;
    }
    case 'logout': {
      const r = await call('logout', [args.join(' ')]);
      print(`${r.name} (#${r.id}) のログインを ${r.sessions} 件解除しました`);
      break;
    }
    case 'staff-pin': {
      const r = await call('staff-pin', [args.join(' ')]);
      print(`${r.name} (#${r.id}) を、この名前の運営権の持ち主にしました`);
      break;
    }
    case 'ext-forget': {
      const r = await call('ext-forget', [args.join(' ')]);
      print(r.removed ? `「${r.id}」を、外したままでよいことにしました` : `「${r.id}」はもともと記録にありません`);
      break;
    }
    case 'stele': {
      const mode = ['check', 'restore'].includes(args[0]) ? args[0] : 'status';
      const r = await call('stele', [mode, args.includes('--trust-unsigned')]);
      print(`刻んだ範囲: #1〜#${r.sealed}（${r.segs}か所）／まだ刻んでいない記録: ${r.pending}件／最後に刻んだ時刻: ${time(r.at)}`);
      print(`保管先: ${r.on ? 'あり' : 'なし（外の控えがありません）'}／前回の確認: ${r.check ? `${time(r.check.at)} ${r.check.ok ? '異常なし' : `要確認 ${r.check.problems.length}件`}` : 'まだ'}${r.failSince ? `／刻めていない（${r.failText}）` : ''}`);
      if (r.diverged) print(`！ #${r.diverged.id} が、刻んだものと違います`);
      for (const p of (r.check && r.check.problems) || []) print(`  - ${p.text}`);
      print(`データベース: ${r.capacity.dbBytes ? `${(r.capacity.dbBytes / 1048576).toFixed(1)}MB（上限の${(r.capacity.ratio * 100).toFixed(1)}%）` : '大きさ不明'}／運営ログ ${r.capacity.rows}件`);
      if (r.restore) print(r.restore.blocked ? `戻せませんでした：${r.restore.blocked}` : `戻した行: ${r.restore.restored}件${r.restore.unsigned ? '（署名は確かめられていません）' : ''}`);
      break;
    }
    case 'log-save': {
      if (!args[0]) throw new AdminError('書き出すファイルの名前を指定してください');
      const { rows } = await call('log-export', []);
      let prev = GENESIS_HASH;
      for (const r of rows) {
        if (r.prev_hash !== prev || rowHash(r) !== r.hash) throw new AdminError(`運営ログの #${r.id} がつながっていません。書き出しません（石碑から確かめてください：stele check）`);
        prev = r.hash;
      }
      const out = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n${JSON.stringify({ end: true, count: rows.length, head: rows.length ? { id: rows[rows.length - 1].id, hash: prev } : null })}\n`;
      fs.writeFileSync(path.resolve(args[0]), out, { flag: 'wx' });
      print(`運営ログ ${rows.length}件を ${args[0]} に書き出しました（先頭から最後までのつながりを確かめ済み。最後のハッシュ ${prev.slice(0, 16)}…）`);
      break;
    }
    case 'login-unlock': {
      const r = await call('login-unlock', [args.join(' ')]);
      print(`${r.name ? `「${r.name}」の` : 'すべての'}待ち時間を解除しました（${r.cleared}件）`);
      break;
    }
    case 'staff-unpin': {
      const r = await call('staff-unpin', [args.join(' ')]);
      print(r.removed ? `「${r.name}」の固定を解除しました` : `「${r.name}」はもともと固定されていません`);
      break;
    }
    case 'messages':
      print(table((await call('messages', [args.join(' ')])).reverse(), [
        ['id'], ['created_at', time], ['channel'], ['sender', (v) => v ?? '(system)'],
        ['body', (v, r) => (r.kind === 'transfer' ? `[送金 ${fmt(r.amount)} ${r.currency}]` : String(v).replace(/\s+/g, ' ').slice(0, 60))]
      ]));
      break;
    case 'redact':
      await call('redact', [args[0]]);
      print(`メッセージ ${args[0]} を削除済みにしました`);
      break;
    case 'backup': {
      if (!args[0]) throw new AdminError('保存先のファイル名を指定してください');
      const out = path.resolve(args[0]);
      if (fs.existsSync(out)) throw new AdminError(`すでに存在します: ${out}`);
      const data = await call('export', []);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(data));
      print(`バックアップを作成しました: ${out}（プレイヤー ${data.tables.users.length} 人）`);
      break;
    }
    case 'restore': {
      if (!args[0]) throw new AdminError('バックアップファイルを指定してください');
      const data = JSON.parse(fs.readFileSync(path.resolve(args[0]), 'utf8'));
      const counts = await call('import', [data, args.includes('--replace')]);
      print(`復元しました: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
      break;
    }
    case 'restore-time': {
      if (!args[0]) throw new AdminError('戻したい日時を指定してください（例: 2026-10-17T12:00:00Z）');
      // the operators' log never goes back: taken now, given back after the restart
      const log = await call('log-export', []);
      const r = await call('restore-time', [args[0]]);
      let kept = null;
      for (let i = 0; i < 10 && !kept; i++) {
        await new Promise((ok) => setTimeout(ok, 1500));
        kept = await call('log-keep', [log.rows, { restoredTo: r.restoredTo, undoBookmark: r.undoBookmark }]).catch(() => null);
      }
      print(`${r.restoredTo} の状態に戻しました。取り消す場合の値: ${r.undoBookmark}`);
      print(kept ? `運営ログはそのまま残しました（${log.rows.length}件）` : '運営ログを戻せませんでした。もう一度 restore-time と同じ日時で実行せず、運営サイトのログを確認してください');
      break;
    }
    case 'quota': {
      const r = await call('quota', []);
      print(`${r.day}: ${r.requests} リクエスト / ${r.megabytes} MB（上限 ${r.limits.requests || 'なし'} / ${r.limits.megabytes ? r.limits.megabytes + ' MB' : 'なし'}、リセット ${r.resetsAt}）`);
      break;
    }
    default:
      print(HELP);
      return cmd === undefined || cmd === 'help' || cmd === '--help' ? 0 : 1;
  }
  return 0;
}

function remoteCaller(base, token) {
  if (!token) throw new AdminError('環境変数 ADMIN_TOKEN を設定してください');
  return async (cmd, args) => {
    const res = await fetch(new URL('/api/admin', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
      body: JSON.stringify({ cmd, args })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new AdminError((json.error && json.error.message) || `HTTP ${res.status}`);
    return json.result;
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let argv = process.argv.slice(2);
  let db = null;
  let call;
  const at = argv.indexOf('--remote');
  try {
    if (at >= 0) {
      call = remoteCaller(argv[at + 1], process.env.ADMIN_TOKEN);
      argv = argv.filter((_, i) => i !== at && i !== at + 1);
    } else {
      // the local database (node:sqlite) is only loaded when it is used
      const [{ loadConfig }, { openDb }] = await Promise.all([import('./config.js'), import('./sqlite.js')]);
      db = openDb(loadConfig().dataDir);
      // codes issued here can be read on the operator site too (same key as the server)
      const key = keyFrom(metaValue(db, 'ticket_secret', () => crypto.randomBytes(32).toString('base64url')), 'recovery-codes');
      // (the developer's account: no ban, as on the server)
      const cfg = loadConfig();
      const dev = cfg.operators.some((n) => nameKey(n) === nameKey(cfg.developer || '')) ? nameKey(cfg.developer) : '';
      const admin = createAdmin(db, { seal: (code) => sealText(key, code), isDeveloper: (u) => !!dev && u.name_key === dev });
      const secret = metaValue(db, 'ticket_secret', () => crypto.randomBytes(32).toString('base64url'));
      // (the 石碑 and the whole log, here too: the same files and the same key as the server's)
      let stele = null;
      const localStele = async () => {
        if (stele) return stele;
        const [{ statements }, { createOpsLog }, { createStele }, { fileStele }] = await Promise.all([import('../core/db.js'), import('../core/opslog.js'), import('../core/stele.js'), import('./stele-files.js')]);
        const q = statements(db);
        stele = createStele({ q, opsLog: createOpsLog({ q }), store: fileStele(path.join(cfg.dataDir, 'stele')), secret });
        return stele;
      };
      call = async (cmd, args) => {
        if (cmd === 'log-export') return { rows: admin.logRows() };
        if (cmd === 'stele') {
          const s = await localStele();
          if (args[0] === 'check') { const r = await s.tick({ deep: true }); return { ...s.status(), ran: r }; }
          if (args[0] === 'restore') { const r = await s.recover({ force: args[1] === true }); await s.seal(); return { ...s.status(), restore: r }; }
          return s.status();
        }
        return admin.command(cmd, args);
      };
    }
    process.exitCode = await run(argv, call);
  } catch (e) {
    console.error(e instanceof AdminError || e?.code ? (e.message || String(e)) : e);
    process.exitCode = 1;
  } finally {
    if (db) db.close();
  }
}
