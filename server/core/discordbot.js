// The Discord bot that gives today's passkey (server/core/pk.js) to the
// people who hold the staff role on the developer's Discord server.
//
// It is not a program that stays connected to Discord (a Cloudflare Worker
// cannot): Discord calls this address (the application's "Interactions
// Endpoint URL") whenever someone uses the slash command /passkey, with a
// signature only the application's own key makes. The answer is shown to the
// person who asked and nobody else (an "ephemeral" message), so the number
// never stays in a channel's history.
//
// The server checks it all itself, whatever the command's permissions in Discord
// say: the signature, that it came from the right server (guild) and that the
// person has one of the staff roles (DISCORD_STAFF_ROLE_IDS). It computes a
// number and answers; it reads and writes nothing else, so it also works
// during an emergency stop and a lockdown, when the security base is the
// only way back in.
import { Buffer } from 'node:buffer';
import { ApiError } from './errors.js';
import { Limiter } from './ratelimit.js';

const SKEW_S = 300;
const HEX128 = /^[0-9a-f]{128}$/;
const note = (content) => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

export function createDiscordBot({ config, pk, opsLog, clock = Date.now }) {
  const roles = new Set(config.discordStaffRoles || []);
  const on = () => !!(config.discordAppKey && config.discordGuild && roles.size);
  let keyReady = null;
  const publicKey = () => (keyReady ||= globalThis.crypto.subtle.importKey('raw', Buffer.from(config.discordAppKey, 'hex'), { name: 'Ed25519' }, false, ['verify']));
  const asked = new Limiter(6, 6);
  // one line in the log for each person every ten minutes, not one for every use
  const logged = new Map();

  async function signed(req, bytes) {
    const sig = String(req.header('x-signature-ed25519') || '').toLowerCase();
    const ts = String(req.header('x-signature-timestamp') || '');
    if (!config.discordAppKey || !HEX128.test(sig) || !/^\d{9,12}$/.test(ts)) return false;
    if (Math.abs(clock() / 1000 - Number(ts)) > SKEW_S) return false;
    try {
      return await globalThis.crypto.subtle.verify({ name: 'Ed25519' }, await publicKey(), Buffer.from(sig, 'hex'), Buffer.concat([Buffer.from(ts, 'utf8'), Buffer.from(bytes)]));
    } catch { return false; }
  }

  function passkey(i) {
    const member = i.member || {};
    const user = member.user || {};
    // (not from a direct message, nor another server)
    if (!on() || i.guild_id !== config.discordGuild || !Array.isArray(member.roles) || !member.roles.some((r) => roles.has(String(r)))) {
      return note('このコマンドを使えるのは、運営のロールを持つ人だけです。');
    }
    if (!asked.take(String(user.id || '-'))) return note('少し待ってから、もう一度お試しください。');
    if (!pk.active()) return note('パスキー認証は、まだサーバーで設定されていません。');
    const now = clock();
    const t = pk.today(now);
    const key = String(user.id || '-');
    if (!(logged.get(key) > now - 600000)) {
      logged.set(key, now);
      if (logged.size > 500) for (const [k, at] of logged) if (at <= now - 600000) logged.delete(k);
      try { opsLog.add({ actorName: `Discord:${String(user.global_name || user.username || user.id || '?').slice(0, 40)}`, action: 'pk_issue', summary: `Discord の ${String(user.global_name || user.username || '?').slice(0, 40)} が今日のパスキーを取得した`, detail: { discord: String(user.id || ''), day: t.day } }); } catch (e) { console.error('pk_issue log failed', e); }
    }
    return note(`今日（${t.day.replace(/-/g, '/')}）のパスキー：**${t.code}**\n有効：今日の 23:59（日本時間）まで。運営サイト・security HOME の「今日のパスキー」の画面に入力します。\n※ 間違えると、そのアカウントは1時間入力できません。`);
  }

  const routes = {
    // Discord's call: verified, then answered in a moment (it waits 3 seconds)
    'POST /api/discord/interactions': async (req) => {
      const bytes = await req.bytes(16 * 1024);
      if (!(await signed(req, bytes))) throw new ApiError(401, 'bad_signature', 'invalid request signature');
      let i;
      try { i = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new ApiError(400, 'bad_json', 'bad request'); }
      if (!i || typeof i !== 'object') throw new ApiError(400, 'bad_json', 'bad request');
      if (i.type === 1) return { type: 1 };
      if (i.type === 2 && i.data && i.data.name === 'passkey') return passkey(i);
      return note('このコマンドは使えません。');
    }
  };

  return { routes, public: ['POST /api/discord/interactions'], on };
}
