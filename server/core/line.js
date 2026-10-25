// LINE: the same notices as Discord's (server/core/notify.js) go to the
// developer's LINE through the Messaging API, and the bot gives today's
// passkey (server/core/pk.js) to the staff, in a talk of its own with the bot.
//
// Settings (the host's secrets, never the repository): LINE_CHANNEL_SECRET
// (checks that a call really comes from LINE), LINE_CHANNEL_ACCESS_TOKEN (the
// long-lived token of the channel), LINE_NOTIFY_TO (who the notices go to: the
// first of LINE_STAFF_USER_IDS if not said), LINE_STAFF_USER_IDS (who may ask
// for the passkey) and LINE_MONTHLY_LIMIT (messages a month: 200 on the free
// plan).
//
// A push message counts against the month's allowance for each person it goes
// to (a reply does not count at all), and past the allowance LINE refuses
// them. So the notices are spent carefully:
//   - a danger goes out at once (lines close together as one message), with the
//     ones waiting, until the allowance is used;
//   - the others wait a few minutes and go together as one message (or with
//     the next danger), and only while less than 60% of the allowance is used;
//   - what was not sent for that is counted and said in the next message.
// The count is kept in the database (a restart does not forget it) and starts
// again each month (Japan time).
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';
import { Limiter } from './ratelimit.js';
import { describe } from './notify.js';

export const API = 'https://api.line.me';
export const ID_RE = /^[UCR][0-9a-f]{32}$/;
const WAIT_MS = 2000;
const DIGEST_MS = 10 * 60000;
const DIGEST_LINES = 15;
const DIGEST_KEEP = 40;
const SPARE = 0.6;
// a text message is 5000 characters at most, a request 5 messages
const TEXT_MAX = 4500;
const MESSAGES_MAX = 5;
const JST = 9 * 3600000;
const clip = (s, n) => { const a = Array.from(String(s || '')); return a.length > n ? a.slice(0, n).join('') + '…' : a.join(''); };
const month = (ms) => new Date(ms + JST).toISOString().slice(0, 7);
// a text in pieces LINE takes (cut at a line break where there is one)
function pieces(text) {
  const out = [];
  let rest = String(text);
  while (Array.from(rest).length > TEXT_MAX && out.length < MESSAGES_MAX - 1) {
    const head = Array.from(rest).slice(0, TEXT_MAX).join('');
    const cut = head.lastIndexOf('\n') > TEXT_MAX / 2 ? head.lastIndexOf('\n') : head.length;
    out.push(head.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  out.push(clip(rest, TEXT_MAX));
  return out;
}

// token: the channel access token; to: who the notices go to; kv: { get, set }
// (the database) for the month's count and the notices waiting; defer(promise):
// the host keeps running until it settles; jst(ms): the time as the log writes
// it; onTrouble(text): something the developer should hear elsewhere (the
// allowance used up)
export function createLine({ token = '', to = [], limit = 200, kv = null, defer = null, jst, publicUrl = '', api = API, fetcher = (...a) => globalThis.fetch(...a), clock = Date.now, onTrouble = () => {} }) {
  const dest = to.filter((id) => ID_RE.test(String(id)));
  const canSend = String(token).length >= 20;
  const on = canSend && dest.length > 0;
  let urgent = [], timer = null, due = 0, site = '';
  try { if (publicUrl) site = new URL(publicUrl).host; } catch { /* left to the requests */ }

  /* ---------------------------------------------------- the month's count --- */
  const mem = { used: null, digest: [] };
  function usage() {
    const now = clock();
    let u = kv ? kv.get('line_usage') : mem.used;
    if (!u || u.month !== month(now)) u = { month: month(now), used: 0, exhausted: false, dropped: 0, toldSpare: false, toldAll: false };
    return u;
  }
  function saveUsage(u) { if (kv) kv.set('line_usage', u); else mem.used = u; }
  const digestList = () => (kv ? kv.get('line_digest') : mem.digest) || [];
  function saveDigest(list) { if (kv) kv.set('line_digest', list); else mem.digest = list; }

  /* ----------------------------------------------------------------- the API --- */
  async function call(path, body, extra = {}) {
    const res = await fetcher(api + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extra },
      body: JSON.stringify(body)
    });
    return res;
  }
  // one text to one place; true: LINE took it
  async function sendTo(id, text, retryKey) {
    try {
      const res = await call('/v2/bot/message/push', { to: id, messages: pieces(text).map((t) => ({ type: 'text', text: t })) }, { 'X-Line-Retry-Key': retryKey });
      // (a retry of the same key that LINE has already taken: it went)
      if (res.ok || res.status === 409) return true;
      let said = '';
      try { said = String((await res.json()).message || ''); } catch { /* no body */ }
      if (res.status === 429 && /monthly limit/i.test(said)) {
        const u = usage();
        u.exhausted = true;
        saveUsage(u);
      } else {
        console.error('line push', res.status, said.slice(0, 120));
      }
      return false;
    } catch (e) {
      console.error('line push failed', e && e.message);
      return false;
    }
  }
  // a reply to someone who wrote to the bot: free, and does not count
  async function reply(replyToken, text) {
    if (!canSend || !replyToken) return false;
    try {
      const res = await call('/v2/bot/message/reply', { replyToken, messages: pieces(text).map((t) => ({ type: 'text', text: t })) });
      if (!res.ok) console.error('line reply', res.status);
      return res.ok;
    } catch (e) {
      console.error('line reply failed', e && e.message);
      return false;
    }
  }

  /* ------------------------------------------------------------------ sending --- */
  // What is waiting goes out now (the dangers, and the others with them). null:
  // nothing to send, or not set up.
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; due = 0; }
    if (!on) return null;
    const take = urgent;
    urgent = [];
    const others = digestList();
    if (others.length) saveDigest([]);
    const lines = take.concat(others.map((x) => x.s));
    if (!lines.length) return null;
    const danger = take.length > 0;
    const u = usage();
    // the others only while less than 60% of the allowance is used; a danger until it is all used
    const room = (danger ? limit : Math.floor(limit * SPARE)) - u.used;
    if (u.exhausted || room < dest.length) {
      u.dropped += lines.length;
      // (said once each month on Discord: the 60% kept for the dangers, and all of it used up)
      const all = u.exhausted || danger;
      if (!u[all ? 'toldAll' : 'toldSpare']) {
        u[all ? 'toldAll' : 'toldSpare'] = true;
        onTrouble(all
          ? `LINE の今月の送信枠（${limit}通）を使い切りました。今月はこれ以上 LINE に通知できません（運営サイトのログには、すべて残っています）`
          : `LINE の今月の送信枠（${limit}通）の6割を使いました。ふつうの通知は LINE に送らず、危険な知らせだけを送ります（運営サイトのログには、すべて残っています）`);
      }
      saveUsage(u);
      return false;
    }
    let text = lines.join('\n');
    if (u.dropped) { text += `\n（ほかに${u.dropped}件。LINE の送信枠のため送っていません。運営サイトのログで見られます）`; u.dropped = 0; }
    if (site) text += danger ? `\n運営サイト https://${site}/ops/\nセキュリティHOME https://${site}/sec/` : `\nhttps://${site}/ops/`;
    const key = crypto.randomUUID();
    let ok = true;
    for (const id of dest) {
      if (await sendTo(id, text, key)) u.used += 1; else ok = false;
    }
    // (the count may have been marked used up while sending: keep that)
    const now = usage();
    saveUsage({ ...u, exhausted: u.exhausted || now.exhausted });
    return ok;
  }
  // (the soonest wins: a danger does not wait for the others' few minutes)
  function schedule(ms) {
    const at = clock() + ms;
    if (timer && due <= at) return;
    if (timer) clearTimeout(timer);
    due = at;
    const waiting = new Promise((resolve) => {
      timer = setTimeout(() => { timer = null; due = 0; flush().then(resolve, resolve); }, ms);
      if (timer.unref) timer.unref();
    });
    if (defer && ms <= WAIT_MS) defer(waiting);
  }
  function push(mark, text, at, extra = [], isDanger = false) {
    if (!on) return false;
    const head = `${mark} ${isDanger ? '【危険】' : ''}${clip(text, isDanger ? 600 : 300)}（${jst(at).slice(5, 16)}）`;
    const more = extra.filter(Boolean).map((x) => clip(x, 200));
    const entry = more.length ? `${head}\n${more.join('\n')}` : head;
    if (isDanger) {
      urgent.push(entry);
      schedule(WAIT_MS);
    } else {
      const list = digestList().concat({ t: clock(), s: entry }).slice(-DIGEST_KEEP);
      saveDigest(list);
      // a few minutes for the others to come together (or sooner: enough of them, or a danger)
      if (list.length >= DIGEST_LINES) schedule(WAIT_MS); else schedule(DIGEST_MS);
    }
    return true;
  }

  return {
    name: 'line',
    on,
    canSend,
    log(row) {
      const n = describe(row);
      if (n) push(n.mark, n.text, n.at, n.extra, n.danger);
    },
    say(mark, text) { return push(mark, text, clock()); },
    danger(mark, text, extra = []) { return push(mark, text, clock(), extra, true); },
    host(h) {
      if (site) return;
      const v = String(h || '').trim().toLowerCase();
      if (/^[a-z0-9.-]{1,200}(?::\d{1,5})?$/.test(v)) site = v;
    },
    flush,
    // from the housekeeping: the others that have waited long enough go
    tick() {
      const list = digestList();
      return list.length && clock() - list[0].t >= DIGEST_MS ? flush() : null;
    },
    reply,
    // the month's count, for the operator site
    status() {
      const u = usage();
      return { on, bot: canSend, to: dest.length, month: u.month, used: u.used, limit, exhausted: u.exhausted, dropped: u.dropped };
    }
  };
}

// The bot: LINE calls POST /api/line/webhook with what happened in its talks
// (a message, a friend added), signed with the channel secret — the only way
// to know the call is LINE's, as its addresses are not published. A person
// the staff list names, writing "パスキー" in their own talk with the bot,
// is told today's passkey (a reply, which is free); "ID" tells anyone their
// own user ID, which is how the lists are filled in. Nothing else is done.
export function createLineBot({ config, line, pk, opsLog, defer = null, clock = Date.now }) {
  const secret = String(config.lineChannelSecret || '');
  const staff = new Set(config.lineStaffUserIds || []);
  const asked = new Limiter(6, 6);
  const seen = new Map();
  const logged = new Map();
  const HELP = '「パスキー」と送ると今日のパスキーを、「ID」と送るとあなたのIDを返します。';

  function signed(req, bytes) {
    const given = String(req.header('x-line-signature') || '');
    if (!secret || !given) return false;
    const want = crypto.createHmac('sha256', secret).update(bytes).digest();
    const got = Buffer.from(given, 'base64');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  function passkey(src) {
    // (in a talk of two only: others in a group or room would read it)
    if (src.type !== 'user') return 'パスキーは、ボットとの1対1のトークで送ってください（グループでは表示できません）。';
    if (!staff.has(String(src.userId || ''))) return 'このボットを使えるのは、運営の方だけです。';
    if (!asked.take(String(src.userId))) return '少し待ってから、もう一度お試しください。';
    if (!pk.active()) return 'パスキー認証は、まだサーバーで設定されていません。';
    const now = clock();
    const t = pk.today(now);
    const who = String(src.userId).slice(0, 7);
    if (!(logged.get(who) > now - 600000)) {
      logged.set(who, now);
      if (logged.size > 200) for (const [k, at] of logged) if (at <= now - 600000) logged.delete(k);
      try { opsLog.add({ actorName: `LINE:${who}`, action: 'pk_issue', summary: `LINE（${who}…）が今日のパスキーを取得した`, detail: { line: who, day: t.day } }); } catch (e) { console.error('pk_issue log failed', e); }
    }
    return `今日（${t.day.replace(/-/g, '/')}）のパスキー：${t.code}\n有効：今日の 23:59（日本時間）まで。運営サイト・security HOME の「今日のパスキー」の画面に入力します。\n※ 間違えると、そのアカウントは1時間入力できません。\n※ このトークの履歴には残ります。毎日変わるので、古いものは使えません。`;
  }
  function ids(src) {
    const lines = [];
    if (src.groupId) lines.push(`このグループのID：${src.groupId}`);
    if (src.roomId) lines.push(`このルームのID：${src.roomId}`);
    lines.push(`あなたのID：${src.userId || '（わかりません）'}`);
    return lines.join('\n');
  }

  // what to say to one event, or '' (nothing)
  function answer(e) {
    const src = e.source || {};
    if (e.type === 'follow') return `友だち追加ありがとうございます。${HELP}`;
    if (e.type !== 'message' || !e.message || e.message.type !== 'text') return '';
    const text = String(e.message.text || '').normalize('NFKC').trim().toLowerCase();
    if (/^\/?(?:passkey|パスキー|ぱすきー)$/.test(text)) return passkey(src);
    if (/^\/?id$/.test(text)) return asked.take(`id:${src.userId || src.groupId || '-'}`) ? ids(src) : '';
    // (in a group or room it keeps quiet about everything else)
    return src.type === 'user' ? HELP : '';
  }

  async function onEvent(e) {
    if (!e || typeof e !== 'object') return;
    const id = String(e.webhookEventId || '');
    if (id) {
      // (LINE may send an event again: it is answered once)
      if (seen.has(id)) return;
      seen.set(id, clock());
      if (seen.size > 300) for (const [k, at] of seen) if (at <= clock() - 3600000) seen.delete(k);
    }
    const text = answer(e);
    if (text) await line.reply(e.replyToken, text);
  }

  const routes = {
    'POST /api/line/webhook': async (req) => {
      const bytes = await req.bytes(256 * 1024);
      if (!signed(req, bytes)) throw new ApiError(401, 'bad_signature', 'invalid signature');
      let body;
      try { body = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new ApiError(400, 'bad_json', 'bad request'); }
      // (LINE's own check of the address sends none: 200 is all it wants)
      const events = body && Array.isArray(body.events) ? body.events.slice(0, 50) : [];
      const work = Promise.all(events.map((e) => onEvent(e).catch((err) => console.error('line event failed', err && err.message))));
      if (defer) defer(work); else await work;
      return {};
    }
  };

  return { routes, public: ['POST /api/line/webhook'], on: () => !!secret };
}
