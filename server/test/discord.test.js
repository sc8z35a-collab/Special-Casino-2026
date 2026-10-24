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
  assert.match(msg.content, /🚨 【危険】サーバーを緊急停止/);
  assert.match(msg.content, /🚩 @everyone \\\*さん\\\*を通報/);
  assert.doesNotMatch(msg.content, /運営サイトを開いた/);
  assert.match(msg.content, /<https:\/\/blockbuster-reels\.example\.workers\.dev\/ops\/>/);
  // a danger in the batch: security HOME is linked as well
  assert.match(msg.content, /<https:\/\/blockbuster-reels\.example\.workers\.dev\/sec\/>/);
  assert.deepEqual(msg.allowed_mentions, { parse: [] });
  for (let i = 0; i < 25; i++) d.say('🛡️', `ブロック ${i}`);
  await d.flush();
  assert.match(sent[1].body.content, /ほかに/);
  assert.equal((sent[1].body.content.match(/🛡️/g) || []).length, 18, 'two of the minute went out before');
});

test('Discord danger reports: the situation in detail and both the operator site and security HOME', async () => {
  const sent = [];
  const d = createDiscord({ url: HOOK, jst, publicUrl: 'https://blockbuster-reels.example.workers.dev', fetcher: async (url, o) => { sent.push(JSON.parse(o.body)); return { ok: true }; } });
  // the emergency stop: what was over, how far, and the busiest address / API
  d.log({
    action: 'emergency_stop', summary: '異常な使用量を検知したため、サーバーを緊急停止', at: Date.now(),
    detail: { over: [{ what: '送信量', value: 734003200, times: 14.2 }], busiest: { addresses: [{ key: '203.0.113.9', n: 912 }], apis: [{ key: '/api/spin', n: 4410 }] } }
  });
  assert.equal(await d.flush(), true);
  const a = sent[0].content;
  assert.match(a, /🚨 【危険】異常な使用量を検知/);
  assert.match(a, /送信量：734,003,200／分（ふだんの14\.2倍）/);
  assert.match(a, /多いアドレス：203\.0\.113\.9（912）/);
  assert.match(a, /多いAPI：\/api\/spin（4410）/);
  assert.match(a, /運営サイト <https:\/\/blockbuster-reels\.example\.workers\.dev\/ops\/>/);
  assert.match(a, /セキュリティHOME <https:\/\/blockbuster-reels\.example\.workers\.dev\/sec\/>/);

  // a lockdown after a breach: the reason and the kind; a log tamper warning
  d.log({ action: 'lockdown', summary: '防御の突破を検知し、ロックダウンを発動', at: Date.now(), detail: { why: 'breach', reason: '多数のアドレスから同時攻撃', logIntegrity: { ok: false }, usage: { busiest: { addresses: [{ key: '198.51.100.4', n: 77 }] } } } });
  await d.flush();
  const b = sent[1].content;
  assert.match(b, /🔒 【危険】防御の突破/);
  assert.match(b, /理由：多数のアドレスから同時攻撃/);
  assert.match(b, /種別：防御の突破/);
  assert.match(b, /多いアドレス：198\.51\.100\.4（77）/);
  assert.match(b, /運営ログに改ざんの疑い/);
  assert.match(b, /\/sec\/>/);

  // the shield blocking an address, and a lockdown with the shield's own picture
  d.log({ action: 'shield_auto_block', summary: 'アドレス 203.0.113.50 を自動でブロック（SQLインジェクション・60分）', at: Date.now(), detail: { scope: 'ip', target: '203.0.113.50', reason: 'SQLインジェクション', at: 1000, until: 1000 + 60 * 60000 } });
  d.log({
    action: 'lockdown', summary: '防御の突破を検知し、ロックダウンを発動', at: Date.now(),
    detail: { why: 'breach', reason: '多数のアドレスから同時攻撃', shield: { pressure: { attackers: 9, criticals: 2 }, topAttackers: [{ ip: '198.51.100.7', score: 88, hits: 410, flags: ['scan', 'sqli'] }], totals: { attacks: 120, floods: 33 } } }
  });
  await d.flush();
  const sb = sent[2].content;
  assert.match(sb, /🧱 【危険】アドレス 203\.0\.113\.50 を自動でブロック/);
  assert.match(sb, /ブロックしたアドレス：203\.0\.113\.50/);
  assert.match(sb, /ブロックの長さ：60分/);
  assert.match(sb, /同時に攻撃しているアドレス：9・鍵への総当たり：2回/);
  assert.match(sb, /攻撃元の上位：198\.51\.100\.7（スコア88・410回・scan\/sqli）/);
  assert.match(sb, /遮断の合計：attacks 120・floods 33/);

  // an ordinary notice alone: only the operator site, no 【危険】
  d.log({ action: 'player_report', summary: '通報が届きました', at: Date.now() });
  await d.flush();
  assert.doesNotMatch(sent[3].content, /【危険】|\/sec\//);
  assert.match(sent[3].content, /\/ops\/>/);

  // a danger raised directly (not from the log), with its own lines
  d.danger('🚨', '画面を見る機能を緊急事案で強制終了', ['・対象：3件の閲覧', '・理由：ロックダウン']);
  await d.flush();
  assert.match(sent[4].content, /【危険】画面を見る機能を緊急事案で強制終了（[^）]+）\n・対象：3件の閲覧\n・理由：ロックダウン/);
  assert.match(sent[4].content, /\/sec\/>/);
  // nobody is pinged in any of them
  for (const m of sent) assert.deepEqual(m.allowed_mentions, { parse: [] });
});
