// 全停止 (HALT=on: wrangler.jsonc vars): nothing of the game runs on Cloudflare. The Worker answers the API itself
// (server/cloudflare/worker.js) without waking the Durable Object; the object, woken one last time by the alarm it had,
// deletes that alarm and does nothing more (server/cloudflare/casino.js): no housekeeping, no backups, no NPCの国, no
// Workers AI, no 投資, no notices. Its data stays as it is. HALT=off and a deploy start it all again.
export const isHalted = (env) => /^(1|on|true|yes)$/i.test(String((env && env.HALT) || '').trim());

// what the game is told (js/net/api.js: shown as 緊急メンテナンス; the page tries again a day later)
export function haltBody(now = Date.now()) {
  return { error: { code: 'maintenance', message: 'サーバーは停止中です。', lockdown: true, until: now + 24 * 3600000 } };
}
