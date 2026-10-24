// The month's usage in the red or nearly all used: told to Discord once for each step, with links. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUsageAlert } from '../core/usagealert.js';
import { createDiscord } from '../core/discord.js';
import { jst } from '../core/opslog.js';
import { startServer } from './helpers.js';

const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_0123456789';

function setup() {
  const meta = new Map();
  const q = (sql) => ({
    get: () => (meta.has('usage_alert') ? { value: meta.get('usage_alert') } : undefined),
    run: (v) => { meta.set('usage_alert', v); }
  });
  const sent = [];
  const discord = createDiscord({ url: HOOK, jst, publicUrl: 'https://game.example.test', fetcher: async (u, o) => { sent.push(JSON.parse(o.body).content); return { ok: true }; } });
  const now = { t: 1_000_000 };
  const state = { month: '2026-10', percent: 12, shares: [{ label: 'Workers のリクエスト', percent: 12 }], breakdown: { game: 5e6, video: 2e6, voice: 1e5 }, usd: 5, yen: 750 };
  const alert = createUsageAlert({ q, report: () => ({ ...state }), discord, clock: () => now.t, every: 60000 });
  return { alert, sent, now, state, discord, meta };
}

test('usage alert: once at 70%, once at 90%, again next month, with the situation and both links', async () => {
  const { alert, sent, now, state, discord } = setup();
  // quiet: nothing
  assert.equal(alert.check(), null);
  // looked at most once a minute
  state.percent = 71; state.shares = [{ label: 'Workers のリクエスト', percent: 71 }, { label: 'データベースへのリクエスト', percent: 40 }];
  assert.equal(alert.check(), null, 'not looked again within the minute');
  now.t += 61000;
  assert.equal(alert.check(), 70);
  await discord.flush();
  const text = sent[0];
  assert.match(text, /【危険】今月のサーバー使用量が込みの分の70%を超えました（いま 71\.0%）/);
  assert.match(text, /いちばん多い項目：Workers のリクエスト（71\.0%）/);
  assert.match(text, /次に多い項目：データベースへのリクエスト（40\.0%）/);
  assert.match(text, /映像通信 1\.9MB・プレイヤーの処理 4\.8MB・音声の合図 97\.7KB/);
  assert.match(text, /\$5\.00（約750円）/);
  assert.match(text, /運営サイト <https:\/\/game\.example\.test\/ops\/>/);
  assert.match(text, /セキュリティHOME <https:\/\/game\.example\.test\/sec\/>/);
  // still in the red: not told again
  now.t += 61000; state.percent = 80;
  assert.equal(alert.check(), null);
  // nearly all used
  now.t += 61000; state.percent = 91;
  assert.equal(alert.check(), 90);
  await discord.flush();
  assert.match(sent[1], /90%を超えました/);
  assert.match(sent[1], /新しく始められません/);
  // a new month starts again
  now.t += 61000; state.month = '2026-11'; state.percent = 75;
  assert.equal(alert.check(), 70);
});

test('usage alert: remembered through a restart (no second warning for the same step)', async () => {
  const a = setup();
  a.state.percent = 75;
  assert.equal(a.alert.check(), 70);
  // a new instance over the same stored value
  const again = createUsageAlert({ q: () => ({ get: () => ({ value: a.meta.get('usage_alert') }), run: () => {} }), report: () => ({ ...a.state }), discord: a.discord, clock: () => a.now.t + 120000 });
  assert.equal(again.check(), null);
});

test('usage alert: the server runs it (the report is the stats\' own)', async () => {
  const s = await startServer();
  try {
    const stats = s.app.api;
    assert.ok(stats, 'the app exposes its api');
    const taku = await s.register('TAKU');
    // a quiet server: nothing is stored
    assert.equal(s.app.db.prepare("SELECT value FROM meta WHERE key = 'usage_alert'").get(), undefined);
    assert.equal((await s.call('GET', '/api/ops/server', { token: taku.token })).status, 200);
  } finally {
    await s.stop();
  }
});
