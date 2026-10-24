// Discord: what the developer should know at once goes to a channel of their
// Discord server through a webhook (DISCORD_WEBHOOK_URL, a secret in the
// host's settings, never in the repository): the emergency stop and the
// lockdown, the shield blocking an attacker, the automatic filter stopping a
// chat, 通報, 報告 / 意見案, payments, a wrong developer code, operator rights,
// a failed backup, an operator asking for more room in the shared vaults (it
// waits for the developer's approval), and every new version of the server
// going live. Only the one-line summary the operators' log has
// anyway, and a link to the operator site (no message text). Lines close
// together go out as one message; past PER_MINUTE a minute the rest are only
// counted (the log has them all). Nobody can be pinged (a player's name is
// never a mention) and links are not previewed. When the game, the operator
// site or the server is in danger (DANGER below, or danger() directly) the
// line is marked 【危険】, carries the situation in as much detail as fits,
// and the message links security HOME (/sec/) as well as the operator site.

// the operators' log actions that go out, and their mark
export const NOTIFY = {
  emergency_stop: '🚨', emergency_release: '✅', lockdown: '🔒', lockdown_release: '🔓', shield_auto_block: '🧱', filter_block: '🛡️',
  player_report: '🚩', player_feedback: '📝',
  pay_paid: '💰', pay_refund: '↩️', pay_review: '⚠️', pay_unknown: '⚠️', pay_bad_signature: '⚠️',
  dev_code_fail: '🔐', ops_grant: '👤', ops_revoke: '👤', viewer_grant: '👀', viewer_revoke: '👀', backup_failed: '⚠️', vault_quota_request: '📦'
};
// the game / operator site / server in danger: these go out with as much of
// the situation as fits and with BOTH the operator site and the security HOME
// (/sec/) links, so the developer can act from either
const DANGER = new Set(['emergency_stop', 'lockdown', 'shield_auto_block']);
const HOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,30}\/[\w-]{20,200}$/;
const PER_MINUTE = 20;
const WAIT_MS = 2000;
const MAX = 1800;
const clip = (s, n) => { const a = Array.from(String(s || '')); return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
// Discord's formatting marks in a summary are shown as they are
const plain = (s) => String(s).replace(/([\\*_~`|])/g, '\\$1');

// url: the webhook; defer(promise): the host keeps running until it settles;
// jst(ms): the time as the operators' log writes it; publicUrl: the game's address, if set
export function createDiscord({ url = '', defer = null, jst, publicUrl = '', fetcher = (...a) => globalThis.fetch(...a), clock = Date.now }) {
  const on = HOOK.test(String(url || '').trim());
  let lines = [], waiting = null, minute = -1, count = 0, dropped = 0, danger = false;
  let site = '';
  try { if (publicUrl) site = new URL(publicUrl).host; } catch { /* left to the requests */ }

  // a few short lines of what is happening, pulled from an operators' log
  // entry's detail (shapes from server/core/emergency.js and shield.js); all
  // defensive, since detail is free-form
  function situation(action, detail) {
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

  async function flush() {
    waiting = null;
    const take = lines;
    let more = dropped;
    const wasDanger = danger;
    lines = [];
    dropped = 0;
    danger = false;
    let text = '';
    let i = 0;
    for (; i < take.length; i++) {
      const next = text ? `${text}\n${take[i]}` : take[i];
      if (next.length > MAX) break;
      text = next;
    }
    more += take.length - i;
    if (!text && !more) return null;
    if (more) text += `${text ? '\n' : ''}（ほかに${more}件。運営サイトのログで見られます）`;
    // a danger report carries the security HOME link as well as the operator site
    if (site) text += wasDanger ? `\n運営サイト <https://${site}/ops/>\nセキュリティHOME <https://${site}/sec/>` : `\n<https://${site}/ops/>`;
    try {
      const res = await fetcher(String(url).trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, allowed_mentions: { parse: [] }, flags: 4 })
      });
      if (!res.ok) console.error('discord webhook', res.status);
      return res.ok;
    } catch (e) {
      console.error('discord webhook failed', e && e.message);
      return false;
    }
  }
  // extra: more lines of the situation under the summary (a danger report);
  // isDanger: the message also links security HOME
  function push(mark, text, at, extra = [], isDanger = false) {
    if (!on) return false;
    const m = Math.floor(clock() / 60000);
    if (m !== minute) { minute = m; count = 0; }
    if (count >= PER_MINUTE) { dropped++; return false; }
    count++;
    if (isDanger) danger = true;
    const head = `${mark} ${isDanger ? '【危険】' : ''}${plain(clip(text, isDanger ? 600 : 300))}（${jst(at).slice(5, 16)}）`;
    const more = extra.filter(Boolean).map((x) => plain(clip(x, 200)));
    lines.push(more.length ? `${head}\n${more.join('\n')}` : head);
    if (!waiting) {
      waiting = new Promise((resolve) => setTimeout(() => flush().then(resolve, resolve), WAIT_MS));
      if (defer) defer(waiting);
    }
    return true;
  }

  return {
    on,
    // an entry of the operators' log (only the actions in NOTIFY go out)
    log(row) {
      if (!row || !NOTIFY[row.action]) return;
      if (DANGER.has(row.action)) push(NOTIFY[row.action], row.summary, row.at, situation(row.action, row.detail), true);
      else push(NOTIFY[row.action], row.summary, row.at);
    },
    // anything else
    say(mark, text) { return push(mark, text, clock()); },
    // the game, the operator site or the server in danger, not from the log:
    // the summary, lines of the situation, and both links
    danger(mark, text, extra = []) { return push(mark, text, clock(), extra, true); },
    // the address players use (from a request), for the link to the operator site
    host(h) {
      if (site) return;
      const v = String(h || '').trim().toLowerCase();
      if (/^[a-z0-9.-]{1,200}(?::\d{1,5})?$/.test(v)) site = v;
    },
    // what is waiting goes out now: true if Discord took it (null: nothing to send)
    flush
  };
}
