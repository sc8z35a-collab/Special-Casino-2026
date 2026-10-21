// The developer's Discord notices (server/core/discord.js): only the chosen
// log entries, one message for lines close together, nobody pinged, a cap a
// minute. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscord } from '../core/discord.js';
import { jst } from '../core/opslog.js';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789';

test('Discord notices: chosen entries, one message, no pings, a cap a minute', async () => {
  assert.equal(createDiscord({ url: 'https://example.com/hook', jst }).on, false, 'only a Discord webhook');
  const sent = [];
  const d = createDiscord({ url: HOOK, jst, fetcher: async (url, o) => { sent.push({ url, body: JSON.parse(o.body) }); return { ok: true }; } });
  d.host('blockbuster-reels.example.workers.dev');
  d.log({ action: 'open', summary: 'TAKUが運営サイトを開いた', at: Date.now() });
  d.log({ action: 'emergency_stop', summary: 'サーバーを緊急停止', at: Date.now() });
  d.log({ action: 'player_report', summary: '@everyone *さん*を通報', at: Date.now() });
  assert.equal(await d.flush(), true);
  assert.equal(sent.length, 1);
  const msg = sent[0].body;
  assert.match(msg.content, /🚨 サーバーを緊急停止/);
  assert.match(msg.content, /🚩 @everyone \\\*さん\\\*を通報/);
  assert.doesNotMatch(msg.content, /運営サイトを開いた/);
  assert.match(msg.content, /<https:\/\/blockbuster-reels\.example\.workers\.dev\/ops\/>/);
  assert.deepEqual(msg.allowed_mentions, { parse: [] });
  for (let i = 0; i < 25; i++) d.say('🛡️', `ブロック ${i}`);
  await d.flush();
  assert.match(sent[1].body.content, /ほかに/);
  assert.equal((sent[1].body.content.match(/🛡️/g) || []).length, 18, 'two of the minute went out before');
});
