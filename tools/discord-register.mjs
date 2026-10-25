// Registers the /passkey command on your Discord server (once). It is the only
// thing that needs the bot's token, and it runs on your own machine:
//
//   DISCORD_APP_ID=… DISCORD_GUILD_ID=… DISCORD_BOT_TOKEN=… node tools/discord-register.mjs
//
// (README「パスキー認証を始める」). The server itself never holds the token: Discord
// calls the game's address (/api/discord/interactions) and the server answers.
// `--print` shows what would be sent, without sending it.
import { pathToFileURL } from 'node:url';

export const API = 'https://discord.com/api/v10';

// the command: usable in a server only (not in a direct message); who may use it
// is decided by the game's server from the person's roles (DISCORD_STAFF_ROLE_IDS)
export function commandBody() {
  return [{
    name: 'passkey',
    type: 1,
    description: '今日のパスキーを、あなたにだけ見える形で表示します（運営・開発者・閲覧者）',
    dm_permission: false
  }];
}

export async function register({ appId, guildId, token, fetcher = globalThis.fetch }) {
  if (!/^\d{5,25}$/.test(String(appId || ''))) throw new Error('DISCORD_APP_ID (the application id) is needed');
  if (!/^\d{5,25}$/.test(String(guildId || ''))) throw new Error('DISCORD_GUILD_ID (the server id) is needed');
  if (!token) throw new Error('DISCORD_BOT_TOKEN (the bot token) is needed');
  // (the commands of that server, as a whole: what is not listed goes)
  const res = await fetcher(`${API}/applications/${appId}/guilds/${guildId}/commands`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commandBody())
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--print')) {
    console.log(JSON.stringify(commandBody(), null, 2));
  } else {
    register({ appId: process.env.DISCORD_APP_ID, guildId: process.env.DISCORD_GUILD_ID, token: process.env.DISCORD_BOT_TOKEN })
      .then((list) => console.log(`registered: ${list.map((c) => '/' + c.name).join(' ')}`))
      .catch((e) => { console.error(e.message); process.exit(1); });
  }
}
