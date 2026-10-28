// The developer code: a number only the developer knows. With it, operators
// give operator rights to an account or take them away (server/core/ops.js).
// It is never written in the repository (which anyone can read): the
// developer's account registers it once on the operator site, and the server
// keeps only a one-way hash of it (PBKDF2, like the passwords). Wrong codes
// are counted hard: a few per address, and few in all, an hour.
import { ApiError } from './errors.js';
import { hashPassword, verifyPassword } from './auth.js';

const KEY = 'dev_code';
const HOUR = 3600000;
const PER_IP = 5;      // wrong codes an hour from one address
const IN_ALL = 30;     // and from everyone (kept in the database: a restart does not reset it)

export function createDevCode({ q, opsLog }) {
  const byIp = new Map();   // address -> times of wrong codes

  const stored = () => { const r = q('SELECT value FROM meta WHERE key = ?').get(KEY); return r ? r.value : ''; };
  const setMeta = (k, v) => q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
  function failsInAll(now) {
    const r = q("SELECT value FROM meta WHERE key = 'dev_code_fails'").get();
    let f = { since: now, n: 0 };
    try { if (r) f = JSON.parse(r.value); } catch { /* starts again */ }
    return now - f.since > HOUR ? { since: now, n: 0 } : f;
  }
  const clean = (code) => String(code ?? '').replace(/[\s-]/g, '');
  function attempts(req) {
    const now = Date.now(), ip = req?.ip || '';
    const mine = (byIp.get(ip) || []).filter(t => now - t < HOUR), all = failsInAll(now);
    if (mine.length >= PER_IP || all.n >= IN_ALL) throw new ApiError(429, 'dev_code_locked', '開発者コードの入力が多すぎます。1時間ほど待ってからお試しください');
    return { now, ip, mine, all };
  }

  // Throws unless `code` is the developer code (`who`: the account trying, for the log).
  async function check(code, req, who = null) {
    attempts(req);
    const h = stored();
    if (!h) throw new ApiError(409, 'dev_code_unset', '開発者コードがまだ登録されていません。開発者のアカウントで運営サイトから登録してください');
    const c = clean(code);
    const valid = /^\d{4,32}$/.test(c) && await verifyPassword(c, h);
    req?.revalidate?.();
    if (stored() !== h) throw new ApiError(409, 'dev_code_changed', '開発者コードが変更されました。もう一度入力してください');
    // Hashing yields. Read counters again so concurrent guesses cannot replace
    // each other's strikes with the same pre-hash count.
    const { now, ip, mine, all } = attempts(req);
    if (valid) return true;
    mine.push(now);
    byIp.set(ip, mine);
    // (addresses that have not tried for an hour are forgotten)
    if (byIp.size > 200) for (const [k, times] of byIp) if (now - times[times.length - 1] >= HOUR) byIp.delete(k);
    setMeta('dev_code_fails', JSON.stringify({ since: all.since, n: all.n + 1 }));
    opsLog.add({ actor: who, action: 'dev_code_fail', summary: `開発者コードの入力が違っていた${who ? `（${who.name}）` : ''}`, req, detail: { tries: { thisAddressThisHour: mine.length, everyoneThisHour: all.n + 1 } } });
    throw new ApiError(403, 'dev_code', '開発者コードが違います');
  }

  // The developer registers it (the first time), or changes it (with the old one).
  async function register(code, old, req, who) {
    const c = clean(code);
    if (!/^\d{8,32}$/.test(c)) throw new ApiError(400, 'bad_code', '開発者コードは8〜32桁の数字にしてください');
    const previous = stored(), had = !!previous;
    if (had) await check(old, req, who);
    const hash = await hashPassword(c);
    req?.revalidate?.();
    if (stored() !== previous) throw new ApiError(409, 'dev_code_changed', '開発者コードが変更されました。もう一度入力してください');
    setMeta(KEY, hash);
    opsLog.add({ actor: who, action: had ? 'dev_code_change' : 'dev_code_set', summary: had ? '開発者コードを変更' : '開発者コードを登録', req, detail: { digits: c.length } });
  }

  return { check, register, isSet: () => !!stored() };
}
