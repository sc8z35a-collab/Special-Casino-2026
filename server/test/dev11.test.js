// DEV11: 登録者数の記念 (10 / 20 / 50 players: everyone gets $100K / $200K /
// $500K from Ice Smoker公式, once each) and the notice of everyone's better
// calls. npm test (from the repository root)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { RULES } from '../core/rules.js';

const officialMessages = (s, id) => s.app.db.prepare(
  "SELECT m.kind, m.body, m.amount, m.pending FROM messages m JOIN users b ON b.id = m.sender_id AND b.npc = 'official' WHERE m.recipient_id = ? ORDER BY m.id"
).all(id).map((m) => ({ ...m }));

test('登録者数の記念: at 10 players everyone then gets $100K once (tapped to receive), not the archive; at 20 again', async () => {
  const s = await startServer({ milestones: true });
  try {
    assert.deepEqual(RULES.milestones.map((m) => [m.players, m.dollars]), [[10, 100000], [20, 200000], [50, 500000]]);
    const ps = [];
    for (let i = 0; i < 9; i++) ps.push(await s.register('Kinen' + i));
    // one of them in the archive (a 永久BAN): no present
    s.app.db.prepare("UPDATE users SET archived_at = ?, archive_reason = 'perma', purge_at = ? WHERE id = ?").run(Date.now(), Date.now() + 86400000, ps[8].me.id);
    assert.equal(officialMessages(s, ps[0].me.id).filter((m) => m.kind === 'transfer').length, 0, 'not yet at 9');
    ps.push(await s.register('Kinen9'));
    for (const p of ps.slice(0, 8).concat(ps[9])) {
      const got = officialMessages(s, p.me.id);
      assert.ok(got.some((m) => m.kind === 'text' && m.body.includes('登録者数が10人を突破') && m.body.includes('100K')), p.me.name);
      assert.deepEqual(got.filter((m) => m.kind === 'transfer').map((m) => [m.amount, m.pending]), [[100000, 1]]);
    }
    assert.equal(officialMessages(s, ps[8].me.id).filter((m) => m.kind === 'transfer').length, 0, 'not the archive');
    // received with the tap
    const card = s.app.db.prepare("SELECT id FROM messages WHERE recipient_id = ? AND kind = 'transfer'").get(ps[0].me.id);
    const before = (await s.call('GET', '/api/me', { token: ps[0].token })).me.dollars;
    const r = await s.call('POST', '/api/messages/claim', { token: ps[0].token, body: { message: card.id } });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await s.call('GET', '/api/me', { token: ps[0].token })).me.dollars, before + 100000);
    // once: the 11th player and the housekeeping pay nothing more
    ps.push(await s.register('Kinen10'));
    await s.app.api.housekeeping();
    assert.equal(officialMessages(s, ps[1].me.id).filter((m) => m.kind === 'transfer').length, 1);
    assert.equal(officialMessages(s, ps[10].me.id).filter((m) => m.kind === 'transfer').length, 0, 'came after it');
    // 20 players: $200K, the newcomers too
    for (let i = 11; i < 20; i++) ps.push(await s.register('Kinen' + i));
    assert.deepEqual(officialMessages(s, ps[0].me.id).filter((m) => m.kind === 'transfer').map((m) => m.amount), [100000, 200000]);
    assert.deepEqual(officialMessages(s, ps[19].me.id).filter((m) => m.kind === 'transfer').map((m) => m.amount), [200000]);
    const log = s.app.db.prepare("SELECT summary FROM ops_log WHERE action = 'milestone' ORDER BY id").all().map((x) => x.summary);
    assert.deepEqual(log, ['登録者数10人突破の記念に全員（9人）へ $100,000', '登録者数20人突破の記念に全員（19人）へ $200,000']);
  } finally {
    await s.stop();
  }
});

test('a server that starts with players already past a milestone pays it at once; the better calls are told to everyone once', async () => {
  const s = await startServer({ milestones: true }, { warm: false });
  try {
    // players from before this version (written straight in, before any request)
    const add = s.app.db.prepare("INSERT INTO users (name, name_key, recovery_hash, tokens, dollars, coins, created_at, last_seen) VALUES (?, ?, ?, 0, 0, 0, ?, ?)");
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push(Number(add.run('Mae' + i, 'mae' + i, 'r' + i, Date.now(), Date.now()).lastInsertRowid));
    assert.equal((await s.call('GET', '/api/health')).status, 200);
    for (const id of ids) {
      const got = officialMessages(s, id);
      assert.ok(got.some((m) => m.kind === 'text' && m.body.includes('通話品質アップのお知らせ') && m.body.includes('VIP3 より高い音質（96kbps）')), 'told');
      assert.deepEqual(got.filter((m) => m.kind === 'transfer').map((m) => m.amount), [100000], 'the 10 already passed');
    }
    // once only
    await s.call('GET', '/api/health');
    await s.app.api.housekeeping();
    assert.equal(officialMessages(s, ids[0]).filter((m) => m.body.includes('通話品質アップ')).length, 1);
    assert.equal(s.app.db.prepare("SELECT COUNT(*) AS n FROM ops_log WHERE action = 'voice_notice'").get().n, 1);
  } finally {
    await s.stop();
  }
});
