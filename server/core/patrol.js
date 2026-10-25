// The patrol: the server looks over itself now and then (with the housekeeping,
// every six hours; at once from the operator site) and tells the operators when
// something is wrong, with no traffic at all when it is not.
//
// What it looks for is what an intruder who got past the doors would leave:
//   - the operators' log: every row still joins the one before it, nothing was cut off
//     the end, the triggers that refuse changes are still there
//   - rights and settings that came from nowhere: an operator, a viewer or an extra login
//     the operators' log never heard of; a developer code that changed unseen; an account
//     made to look like one of the game's own characters; a login for the operator site
//     that belongs to someone who is not staff
//   - the server's own settings: a secret that was there and is gone (the passkey's
//     key, the notices), the admin token that appeared, the operators' names that changed
// What it finds is written to the operators' log (and so to Discord / LINE) once, and
// again when it has gone. Rights and settings that were already so when the patrol
// first looked are taken as they are (they may be older than the log); only a change is news.
import { sha256 } from './auth.js';

const KEY = 'patrol';
const NPCS = ['peter', 'johnson', 'official'];
const SESSIONS_MAX = 8;
const OPEN_MAX = 40;
const DAY_MS = 86400000;
// what a change of is always news (the admin token appearing, who the operators are), and how settings are named
const WATCHED = new Set(['adminToken', 'developer', 'operators']);
const NAMES = { gateKey: 'パスキーの鍵', discordBot: 'Discordボット', discord: 'Discord通知', line: 'LINE通知', adminToken: '管理用トークン', stripe: '決済の鍵', requireDevMfa: '開発者の追加認証の必須', developer: '開発者の名前', operators: '運営の名前の一覧' };

// `more`: checks that other parts bring ({ id, label, fn(s, now) → findings }), run after these
export function createPatrol({ q, opsLog, config, isStaff, settings, extMissing = () => [], more = [], clock = Date.now }) {
  const load = () => {
    try { const r = q('SELECT value FROM meta WHERE key = ?').get(KEY); return r ? JSON.parse(r.value) : {}; } catch { return {}; }
  };
  const save = (s) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(KEY, JSON.stringify(s));
  const fingerprint = (v) => sha256(String(v ?? '')).slice(0, 16);

  // each check returns findings: [{ id, level: 'high' | 'low', text }]
  const checks = [];
  const check = (id, label, fn) => checks.push({ id, label, fn });

  check('log', '運営ログの鎖', async (s, now) => {
    const out = [];
    const triggers = q("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('ops_log_no_delete', 'ops_log_no_update')").all().map((r) => r.name);
    for (const name of ['ops_log_no_delete', 'ops_log_no_update']) {
      if (triggers.includes(name)) continue;
      // put back at once: the log refuses changes again
      try {
        q(name === 'ops_log_no_delete'
          ? "CREATE TRIGGER ops_log_no_delete BEFORE DELETE ON ops_log BEGIN SELECT RAISE(ABORT, 'the operators log cannot be deleted'); END"
          : "CREATE TRIGGER ops_log_no_update BEFORE UPDATE ON ops_log BEGIN SELECT RAISE(ABORT, 'the operators log cannot be changed'); END").run();
      } catch { /* reported below all the same */ }
      out.push({ id: `trigger:${name}`, level: 'high', text: `運営ログの書き換えを止める仕組み（${name}）が外されていました。付け直しました。誰かがデータベースを直接操作した可能性があります` });
    }
    // a full look once a day, the rows since the last look in between
    const full = now - (s.logFullAt || 0) > DAY_MS;
    const r = await opsLog.verify(full ? null : s.logCheck || null);
    if (!r.ok) out.push({ id: 'log-chain', level: 'high', text: `運営ログが壊れています（${r.brokenAt}番付近：${r.reason}）` });
    else {
      s.logCheck = r.last || s.logCheck || null;
      if (full) s.logFullAt = now;
    }
    return out;
  });

  check('rights', '運営権・閲覧者・追加認証と記録の突き合わせ', (s, now) => {
    const out = [];
    const seen = (action, field, key, from, to) => !!q(`SELECT 1 AS x FROM ops_log WHERE action = ? AND json_extract(detail, '$.${field}') = ? AND at BETWEEN ? AND ? LIMIT 1`).get(action, key, from, to);
    for (const r of q('SELECT * FROM ops_access').all()) {
      if (!seen(r.granted ? 'ops_grant' : 'ops_revoke', 'name', r.name_key, r.at - 5000, r.at + 120000)) {
        out.push({ id: `ops_access:${r.name_key}:${r.granted}:${r.at}`, level: 'high', text: `運営権の${r.granted ? '付与' : '剥奪'}（${r.name_key}）が、運営ログに残っていません`, legacy: true });
      }
    }
    for (const r of q('SELECT * FROM ops_viewers').all()) {
      if (!seen(r.granted ? 'viewer_grant' : 'viewer_revoke', 'user', r.user_id, r.at - 5000, r.at + 120000)) {
        out.push({ id: `ops_viewers:${r.user_id}:${r.granted}:${r.at}`, level: 'high', text: `閲覧者の権限の${r.granted ? '付与' : '剥奪'}（アカウント#${r.user_id}）が、運営ログに残っていません`, legacy: true });
      }
    }
    for (const r of q('SELECT user_id, version FROM ops_mfa WHERE mode > 0').all()) {
      if (!q("SELECT 1 AS x FROM ops_log WHERE action = 'ops_mfa_enable' AND actor_id = ? LIMIT 1").get(r.user_id)) {
        out.push({ id: `ops_mfa:${r.user_id}:${r.version}`, level: 'high', text: `追加認証（アカウント#${r.user_id}）が、運営ログに残らないまま有効になっています`, legacy: true });
      }
    }
    // the developer code: changed, with no word of it in the log since the last look
    const code = q("SELECT value FROM meta WHERE key = 'dev_code'").get();
    const fp = code ? fingerprint(code.value) : '';
    const lastId = q('SELECT COALESCE(MAX(id), 0) AS n FROM ops_log').get().n;
    if (s.devFp !== undefined && s.devFp !== fp) {
      const told = q("SELECT 1 AS x FROM ops_log WHERE id > ? AND action IN ('dev_code_set', 'dev_code_change') LIMIT 1").get(s.devLogId || 0);
      if (!told) out.push({ id: `dev_code:${fp}`, level: 'high', text: '開発者コードが、運営ログに残らないまま変わっています' });
    }
    s.devFp = fp;
    s.devLogId = lastId;
    return out;
  });

  check('accounts', 'ゲームの登場人物・運営サイトのログイン', (s, now) => {
    const out = [];
    const npcs = q("SELECT npc, COUNT(*) AS n FROM users WHERE npc != '' GROUP BY npc").all();
    for (const r of npcs) {
      if (!NPCS.includes(r.npc)) out.push({ id: `npc:${r.npc}`, level: 'high', text: `ゲームの登場人物（npc）に見せかけたアカウントがあります（種類「${r.npc}」）` });
      else if (r.n > 1) out.push({ id: `npc-many:${r.npc}`, level: 'high', text: `ゲームの登場人物「${r.npc}」のアカウントが${r.n}件あります` });
    }
    const users = q("SELECT user_id, COUNT(*) AS n FROM sessions WHERE (ops = 1 OR scope = 'view') AND ended = '' GROUP BY user_id").all();
    let ended = 0;
    for (const r of users) {
      const u = q('SELECT * FROM users WHERE id = ?').get(r.user_id);
      if (!u || !isStaff(u)) {
        ended += Number(q("UPDATE sessions SET ended = ? WHERE user_id = ? AND (ops = 1 OR scope = 'view')").run('運営サイトを使う権限がないため、ログアウトされました', r.user_id).changes);
        out.push({ id: `staff-session:${r.user_id}`, level: 'high', text: `運営サイトのログインが、運営でも閲覧者でもないアカウント#${r.user_id}にありました（${ended}件を終了）` });
      } else if (r.n > SESSIONS_MAX) {
        out.push({ id: `sessions-many:${r.user_id}`, level: 'low', text: `${u.name}さんの運営サイトのログインが${r.n}件あります（ふだんは数件）` });
      }
    }
    return out;
  });

  check('settings', 'サーバーの設定', (s, now) => {
    const out = [];
    const cur = settings();
    const was = s.settings;
    if (was) {
      // a secret that was there and is gone, or who the operators are, or the admin token: news worth waking up for
      const high = [], low = [];
      for (const k of Object.keys({ ...was, ...cur })) {
        if (was[k] === cur[k]) continue;
        (WATCHED.has(k) || (was[k] === true && cur[k] === false) ? high : low).push(NAMES[k] || k);
      }
      const stamp = fingerprint(JSON.stringify(cur));
      if (high.length) out.push({ id: `settings-high:${stamp}`, level: 'high', text: `サーバーの設定が変わりました（${high.join('、')}）。心当たりがなければ、Cloudflare の変数とシークレットを確かめてください` });
      if (low.length) out.push({ id: `settings-low:${stamp}`, level: 'low', text: `サーバーの設定が変わりました（${low.join('、')}）` });
    }
    s.settings = cur;
    return out;
  });

  check('parts', '追加部品', () => {
    const gone = extMissing();
    return gone.length ? [{ id: `parts:${gone.join(',')}`, level: 'high', text: 'サーバーに付けていた追加部品が外れています（その間、アップロードは止めています）。意図したものでなければ、デプロイを確かめてください' }] : [];
  });

  const lastResult = () => load().last || null;

  // look over everything now; what is news goes to the operators' log
  for (const m of more) check(m.id, m.label, m.fn);

  async function run({ by = null } = {}) {
    const s = load();
    const now = clock();
    const t0 = performance.now();
    const found = [], done = [];
    for (const c of checks) {
      try {
        const fs = await c.fn(s, now);
        done.push({ id: c.id, label: c.label, found: fs });
        found.push(...fs);
      } catch (e) {
        const f = { id: `error:${c.id}`, level: 'low', text: `点検「${c.label}」を実行できませんでした：${String((e && e.message) || e).slice(0, 120)}` };
        done.push({ id: c.id, label: c.label, found: [f] });
        found.push(f);
      }
    }
    // what was already so when the patrol first looked is taken as it is (it may be older than the log)
    if (!s.baseline) { s.baseline = found.filter((f) => f.legacy).map((f) => f.id); }
    const isNews = (f) => !(f.legacy && s.baseline.includes(f.id));
    const news = found.filter(isNews);
    for (const d of done) { d.ok = !d.found.some(isNews); delete d.found; }
    const open = s.open || {};
    const nowOpen = {};
    let told = 0;
    for (const f of news) {
      nowOpen[f.id] = open[f.id] || { first: now, level: f.level, text: f.text };
      if (!open[f.id] && told < OPEN_MAX) {
        told++;
        opsLog.add({ actorName: 'セキュリティ', action: f.level === 'high' ? 'patrol_alert' : 'patrol_notice', summary: `自動点検：${f.text}`, detail: { id: f.id, level: f.level, by: by ? by.name : 'patrol' } });
      }
    }
    for (const [id, f] of Object.entries(open)) {
      if (!nowOpen[id]) opsLog.add({ actorName: 'セキュリティ', action: 'patrol_clear', summary: `自動点検：解消しました（${f.text}）`, detail: { id } });
    }
    s.open = nowOpen;
    const result = { at: now, ms: Math.round((performance.now() - t0) * 10) / 10, checks: done, findings: news.map((f) => ({ id: f.id, level: f.level, text: f.text, since: nowOpen[f.id].first })), by: by ? by.name : '' };
    s.last = result;
    save(s);
    return result;
  }

  return { run, last: lastResult, due: (every) => clock() - ((lastResult() || {}).at || 0) >= every };
}
