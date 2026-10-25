// What the developer is told at once, and to whom: one list for every place
// the notices go (Discord: server/core/discord.js, LINE: server/core/line.js),
// so the same entries go out everywhere and say the same.
//
// The operators' log has every entry; only the actions in NOTIFY go out, as the
// one-line summary the log has anyway (never the text of a chat). When the
// game, the operator site or the server is in danger (DANGER, or danger()
// directly) the line is marked 【危険】, carries the situation in as much detail
// as fits, and the message links security HOME (/sec/) as well as the operator
// site.

// the operators' log actions that go out, and their mark
export const NOTIFY = {
  emergency_stop: '🚨', emergency_release: '✅', staff_name_reused: '🪪', lockdown: '🔒', lockdown_release: '🔓', shield_auto_block: '🧱', filter_block: '🛡️',
  player_report: '🚩', player_feedback: '📝',
  pay_paid: '💰', pay_refund: '↩️', pay_review: '⚠️', pay_unknown: '⚠️', pay_bad_signature: '⚠️',
  dev_code_fail: '🔐', pk_fail: '🔑', pk_breakglass: '🆘', ops_grant: '👤', ops_revoke: '👤', viewer_grant: '👀', viewer_revoke: '👀', backup_failed: '⚠️', vault_quota_request: '📦'
};
// the game / operator site / server in danger: these go out with as much of
// the situation as fits and with BOTH the operator site and the security HOME
// (/sec/) links, so the developer can act from either
export const DANGER = new Set(['emergency_stop', 'lockdown', 'shield_auto_block', 'pk_fail', 'pk_breakglass', 'staff_name_reused']);

// a few short lines of what is happening, pulled from an operators' log
// entry's detail (shapes from server/core/emergency.js and shield.js); all
// defensive, since detail is free-form
export function situation(action, detail) {
  const out = [];
  try {
    const d = detail || {};
    const u = d.usage || d; // lockdown wraps the usage report under .usage
    if (Array.isArray(u.over) && u.over.length) {
      for (const o of u.over.slice(0, 4)) out.push(`・${o.what}：${Math.round(o.value).toLocaleString('en-US')}／分${o.times ? `（ふだんの${o.times}倍）` : ''}`);
    }
    if (d.reason) out.push(`・理由：${d.reason}`);
    if (d.why && d.why !== 'manual') out.push(`・種別：${d.why === 'breach' ? '防御の突破' : d.why}`);
    // the shield blocking one address / account / device
    if (action === 'shield_auto_block' && d.target) {
      const what = { ip: 'アドレス', account: 'アカウント', fp: '端末' }[d.scope] || d.scope || '';
      out.push(`・ブロックした${what}：${d.target}`);
      if (d.until && d.at) out.push(`・ブロックの長さ：${Math.round((d.until - d.at) / 60000)}分`);
    }
    // the busiest addresses and APIs (an emergency stop) or the shield's own picture (a lockdown)
    const busy = (u.busiest || (d.shield && d.shield.busiest) || {});
    const addr = (busy.addresses || [])[0];
    if (addr) out.push(`・多いアドレス：${addr.key}（${addr.n}）`);
    const api = (busy.apis || [])[0];
    if (api) out.push(`・多いAPI：${api.key}（${api.n}）`);
    const sh = d.shield;
    if (sh) {
      if (sh.pressure) out.push(`・同時に攻撃しているアドレス：${sh.pressure.attackers}・鍵への総当たり：${sh.pressure.criticals}回`);
      const top = (sh.topAttackers || [])[0];
      if (top) out.push(`・攻撃元の上位：${top.ip}（スコア${top.score}・${top.hits}回${top.flags && top.flags.length ? '・' + top.flags.slice(0, 3).join('/') : ''}）`);
      if (sh.totals) out.push(`・遮断の合計：${Object.entries(sh.totals).slice(0, 4).map(([k, v]) => `${k} ${v}`).join('・')}`);
    }
    if (d.logIntegrity && d.logIntegrity.ok === false) out.push('・運営ログに改ざんの疑い');
  } catch { /* detail was not what we expected */ }
  return out.slice(0, 9);
}

// An entry of the operators' log as a notice, or null (not one that goes out):
// { mark, text, at, extra (the situation, for a danger), danger }
export function describe(row) {
  if (!row || !NOTIFY[row.action]) return null;
  const danger = DANGER.has(row.action);
  return { mark: NOTIFY[row.action], text: row.summary, at: row.at, extra: danger ? situation(row.action, row.detail) : [], danger };
}

// The places the notices go, as one: the same call goes to each (a place that
// is not set up takes it and does nothing). `channels`: objects with on, log,
// say, danger, host and flush, as Discord's and LINE's.
export function createNotifier(channels) {
  const list = channels.filter(Boolean);
  const each = (fn) => list.map(fn);
  // true: all that are on delivered; false: one that is on did not; null: none is on
  const verdict = (results) => {
    const done = results.filter((r) => r !== null && r !== undefined);
    return done.length ? done.every(Boolean) : null;
  };
  return {
    get on() { return list.some((c) => c.on); },
    log(row) { each((c) => c.log(row)); },
    say(mark, text) { return each((c) => c.say(mark, text)).some(Boolean); },
    danger(mark, text, extra = []) { return each((c) => c.danger(mark, text, extra)).some(Boolean); },
    host(h) { each((c) => c.host(h)); },
    // what is waiting goes out now
    async flush() { return verdict(await Promise.all(each((c) => c.flush()))); },
    // …and what each place said (null: not set up)
    async flushEach() {
      const out = {};
      await Promise.all(list.map(async (c, i) => { out[c.name || String(i)] = await c.flush(); }));
      return out;
    }
  };
}
