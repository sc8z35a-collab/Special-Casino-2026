// Discord: what the developer should know at once goes to a channel of their
// Discord server through a webhook (DISCORD_WEBHOOK_URL, a secret in the
// host's settings, never in the repository): the emergency stop and the
// lockdown, the shield blocking an attacker, the automatic filter stopping a
// chat, 通報, 報告 / 意見案, payments, a wrong developer code, operator rights,
// a failed backup, and every new version of the server going live. Only the one-line summary the operators' log has
// anyway, and a link to the operator site (no message text). Lines close
// together go out as one message; past PER_MINUTE a minute the rest are only
// counted (the log has them all). Nobody can be pinged (a player's name is
// never a mention) and links are not previewed.

// the operators' log actions that go out, and their mark
export const NOTIFY = {
  emergency_stop: '🚨', emergency_release: '✅', lockdown: '🔒', lockdown_release: '🔓', shield_auto_block: '🧱', filter_block: '🛡️',
  player_report: '🚩', player_feedback: '📝',
  pay_paid: '💰', pay_refund: '↩️', pay_review: '⚠️', pay_unknown: '⚠️', pay_bad_signature: '⚠️',
  dev_code_fail: '🔐', ops_grant: '👤', ops_revoke: '👤', backup_failed: '⚠️'
};
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
  let lines = [], waiting = null, minute = -1, count = 0, dropped = 0;
  let site = '';
  try { if (publicUrl) site = new URL(publicUrl).host; } catch { /* left to the requests */ }

  async function flush() {
    waiting = null;
    const take = lines;
    let more = dropped;
    lines = [];
    dropped = 0;
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
    if (site) text += `\n<https://${site}/ops/>`;
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
  function push(mark, text, at) {
    if (!on) return false;
    const m = Math.floor(clock() / 60000);
    if (m !== minute) { minute = m; count = 0; }
    if (count >= PER_MINUTE) { dropped++; return false; }
    count++;
    lines.push(`${mark} ${plain(clip(text, 300))}（${jst(at).slice(5, 16)}）`);
    if (!waiting) {
      waiting = new Promise((resolve) => setTimeout(() => flush().then(resolve, resolve), WAIT_MS));
      if (defer) defer(waiting);
    }
    return true;
  }

  return {
    on,
    // an entry of the operators' log (only the actions in NOTIFY go out)
    log(row) { if (row && NOTIFY[row.action]) push(NOTIFY[row.action], row.summary, row.at); },
    // anything else
    say(mark, text) { return push(mark, text, clock()); },
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
