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

const CODE = '987654321098';   // (a test code: the real one is never written anywhere)

test('閲覧者: only the developer gives or takes rights; a viewer only looks (an allowlist), never acts, and is out at once when it goes', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'] });
  try {
    const taku = await s.register('TAKU');
    const dev = (method, url, body) => s.call(method, url, { token: taku.token, body });
    assert.equal((await dev('POST', '/api/ops/dev-code', { code: CODE })).devCodeSet, true);
    const mod = await s.register('Mod1');
    const watcher = await s.register('Watcher');
    await s.register('Other1');
    // rights: the developer only (an operator with the code too is refused)
    assert.equal((await s.call('POST', '/api/ops/viewer', { token: mod.token, body: { name: 'Watcher', action: 'grant', code: CODE } })).error.code, 'not_developer');
    assert.equal((await s.call('POST', '/api/ops/operator', { token: mod.token, body: { name: 'Other1', action: 'grant', code: CODE } })).error.code, 'not_developer');
    assert.equal((await dev('POST', '/api/ops/viewer', { name: 'Watcher', action: 'grant', code: '000000000000' })).error.code, 'dev_code');
    assert.equal((await dev('POST', '/api/ops/viewer', { name: 'Mod1', action: 'grant', code: CODE })).error.code, 'operator');
    const g = await dev('POST', '/api/ops/viewer', { name: 'Watcher', action: 'grant', code: CODE });
    assert.deepEqual(g.viewers.map((v) => v.name), ['Watcher']);
    // the badge: the game knows, the operators' list shows it
    assert.equal((await s.call('GET', '/api/me', { token: watcher.token })).me.viewer, true);
    assert.equal((await dev('GET', '/api/ops/players')).players.find((p) => p.name === 'Watcher').viewer, true);

    // the site's login gives a look-only session
    const login = await s.call('POST', '/api/ops/login', { body: { name: 'Watcher', password: 'pass1234' }, headers: { 'X-Ops-Device': 'browser-vvvvvvvvvvvvvvvv' } });
    assert.deepEqual([login.status, login.viewer], [200, true]);
    const v = (method, url, body) => s.call(method, url, { token: login.token, body });
    const me = await v('GET', '/api/ops/me');
    assert.deepEqual([me.viewer, me.developer, me.operators], [true, false, undefined]);
    for (const url of ['/api/ops/alive', '/api/ops/counts', '/api/ops/reports', '/api/ops/detections', '/api/ops/feedback', '/api/ops/log', '/api/ops/log/verify',
      '/api/ops/operators', '/api/ops/server', '/api/ops/security', '/api/sec/me', '/api/sec/status', '/api/sec/log', '/api/sec/verify']) {
      assert.equal((await v('GET', url)).status, 200, url);
    }
    // what they read leaves out the requests and the details
    const log = await v('GET', '/api/ops/log');
    assert.ok(log.entries.length > 0);
    assert.ok(log.entries.every((e) => e.detail === undefined && e.raw === undefined), 'no details');
    assert.equal((await v('GET', '/api/sec/me')).viewer, true);
    assert.ok((await v('GET', '/api/sec/status')).security.every((e) => e.detail === undefined));
    assert.equal((await v('GET', '/api/ops/operators')).operators.some((o) => 'changed' in o), false);
    // nothing else: no players' list, archive, vault, chats, backups, payments, actions, nor the game
    for (const [m, url, body] of [['GET', '/api/ops/players'], ['GET', '/api/ops/player?id=1'], ['GET', '/api/ops/archive'], ['GET', '/api/ops/team'],
      ['GET', '/api/ops/team/messages?with=0'], ['GET', '/api/ops/chat?id=1'], ['GET', '/api/vault/spaces'], ['GET', '/api/vault/files'], ['GET', '/api/backup'],
      ['GET', '/api/ops/pay'], ['GET', '/api/sec/messages'], ['POST', '/api/sec/messages', { text: 'x' }], ['POST', '/api/sec/lockdown', {}],
      ['POST', '/api/ops/ban', { id: 1, kind: 'suspend' }], ['POST', '/api/ops/security/block', { scope: 'ip', target: '203.0.113.9' }],
      ['POST', '/api/ops/report', { id: 1 }], ['POST', '/api/ops/team/messages', { to: 0, text: 'x' }], ['POST', '/api/emergency/stop', {}],
      ['POST', '/api/ops/viewer', { name: 'Other1', action: 'grant', code: CODE }], ['GET', '/api/me'], ['POST', '/api/spin', { bet: 100 }],
      ['POST', '/api/transfer', { to: 1, amount: 1, currency: 'dollars' }], ['POST', '/api/stream-ticket', {}]]) {
      const r = await v(m, url, body);
      assert.equal(r.status, 403, `${m} ${url}: ${JSON.stringify(r)}`);
      assert.equal(r.error.code, 'viewer', `${m} ${url}`);
    }
    // their game account plays on as before, and still cannot act on the site
    assert.equal((await s.call('GET', '/api/me', { token: watcher.token })).status, 200);
    assert.equal((await s.call('GET', '/api/ops/players', { token: watcher.token })).error.code, 'not_operator');

    // taken away: the site session ends at once (the game's does not), and no way back in
    const r = await dev('POST', '/api/ops/viewer', { name: 'Watcher', action: 'revoke', code: CODE });
    assert.deepEqual(r.viewers, []);
    const out = await v('GET', '/api/ops/alive');
    assert.deepEqual([out.status, out.error.code], [401, 'ended']);
    assert.equal((await v('GET', '/api/sec/status')).status, 401, 'security HOME too');
    assert.equal((await s.call('GET', '/api/me', { token: watcher.token })).me.viewer, false);
    assert.equal((await s.call('POST', '/api/ops/login', { body: { name: 'Watcher', password: 'pass1234' }, headers: { 'X-Ops-Device': 'browser-wwwwwwwwwwwwwwww' } })).status, 401);
    const logged = (await dev('GET', '/api/ops/log?kind=security')).entries.map((e) => e.action);
    assert.ok(logged.includes('viewer_grant') && logged.includes('viewer_revoke'));

    // a viewer made an operator: no longer a viewer, their look-only sessions end
    await dev('POST', '/api/ops/viewer', { name: 'Watcher', action: 'grant', code: CODE });
    const again = await s.call('POST', '/api/ops/login', { body: { name: 'Watcher', password: 'pass1234' }, headers: { 'X-Ops-Device': 'browser-vvvvvvvvvvvvvvvv' } });
    assert.equal(again.viewer, true);
    await dev('POST', '/api/ops/operator', { name: 'Watcher', action: 'grant', code: CODE });
    assert.equal((await s.call('GET', '/api/ops/alive', { token: again.token })).status, 401);
    const now = (await dev('GET', '/api/ops/operators'));
    assert.ok(now.operators.some((o) => o.name === 'Watcher' && o.operator));
    assert.deepEqual(now.viewers, []);
  } finally {
    await s.stop();
  }
});

test('プレイヤーアクティビティ: the log of what happened to players\' accounts, across the kinds', async () => {
  const s = await startServer({ operators: ['taku'] });
  try {
    const taku = await s.register('TAKU');
    const dev = (method, url, body) => s.call(method, url, { token: taku.token, body });
    const p = await s.register('Act1');
    await s.call('POST', '/api/ops/login', { body: { name: 'TAKU', password: 'pass1234' }, headers: { 'X-Ops-Device': 'browser-aaaaaaaaaaaaaaaa' } });
    await dev('POST', '/api/ops/ban', { id: p.me.id, kind: 'suspend' });
    await dev('POST', '/api/ops/ban', { id: p.me.id, kind: 'none' });
    const r = await dev('GET', '/api/ops/log?kind=activity');
    assert.deepEqual(r.entries.map((e) => e.action), ['ban:none', 'ban:suspend', 'player_register', 'player_register']);
    assert.equal(r.counts.activity, 4);
    assert.ok(!r.entries.some((e) => e.action === 'open' || e.action === 'player_login'));
  } finally {
    await s.stop();
  }
});

// the operator site's own live connection (server/node/live.js: attachOps)
async function opsListen(s, token) {
  const { ticket } = await s.call('POST', '/api/ops/live-ticket', { token });
  const events = [];
  let wake = null;
  const http = await import('node:http');
  const req = await new Promise((resolve, reject) => {
    const r = http.get(`${s.base}/api/stream?ops=${encodeURIComponent(ticket)}`, (res) => {
      if (res.statusCode !== 200) { reject(new Error('status ' + res.statusCode)); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block), data = /^data: (.+)$/m.exec(block);
          if (ev && data) { events.push({ name: ev[1], data: JSON.parse(data[1]) }); if (wake) wake(); }
        }
      });
      resolve(r);
    });
    r.on('error', reject);
  });
  function waitFor(name, pred = () => true, ms = 3000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { wake = null; reject(new Error('timeout waiting for ' + name)); }, ms);
      const check = () => {
        const hit = events.find((e) => !e.used && e.name === name && pred(e.data));
        if (hit) { hit.used = true; clearTimeout(t); wake = null; resolve(hit.data); } else wake = check;
      };
      check();
    });
  }
  return { events, waitFor, close: () => req.destroy() };
}

test('運営チャット: a player named (@), the developer called at once, a log line quoted; the 全体チャット call for every operator', async () => {
  const s = await startServer({ operators: ['taku', 'mod1', 'mod2'] });
  try {
    const taku = await s.register('TAKU'), m1 = await s.register('Mod1'), m2 = await s.register('Mod2');
    const p = await s.register('Quoted1');
    const as = (who) => (method, url, body) => s.call(method, url, { token: who.token, body });
    const dev = as(taku), a = as(m1), b = as(m2);
    const line = (await dev('GET', '/api/ops/log?kind=player')).entries[0];
    const devLive = await opsListen(s, taku.token);
    // a player, the developer and a log line, in the 全体チャット
    const sent = await a('POST', '/api/ops/team/messages', { to: 0, text: `@[p:${p.me.id}] の件です @[dev] 見てください @[log:${line.id}] @[p:999999] @[log:999999]` });
    const m = sent.message;
    assert.equal(m.text, `@[p:${p.me.id}] の件です @[dev] 見てください @[log:${line.id}] @? `.trim());
    assert.deepEqual([m.refs.dev, m.refs.players[p.me.id].name, m.refs.logs[line.id].summary], [true, 'Quoted1', line.summary]);
    const ping = await devLive.waitFor('opsping');
    assert.deepEqual([ping.from.name, ping.to], ['Mod1', 0]);
    assert.ok(ping.text.includes('@開発者'));
    // the others read it with what it names
    const read = (await b('GET', '/api/ops/team/messages?with=0')).messages.at(-1);
    assert.equal(read.refs.players[p.me.id].name, 'Quoted1');
    // "#id" finds one log line
    assert.deepEqual((await dev('GET', `/api/ops/log?q=%23${line.id}`)).entries.map((e) => e.id), [line.id]);

    // the call: only with the site's live connection; the others are told; signals go between two in it
    assert.equal((await a('POST', '/api/ops/call/join', {})).error.code, 'no_live');
    const aLive = await opsListen(s, m1.token), bLive = await opsListen(s, m2.token);
    const j1 = await a('POST', '/api/ops/call/join', {});
    assert.deepEqual([j1.others, j1.members.map((x) => x.name)], [[], ['Mod1']]);
    assert.ok(Array.isArray(j1.ice));
    const j2 = await b('POST', '/api/ops/call/join', {});
    assert.deepEqual(j2.others.map((x) => x.name), ['Mod1']);
    assert.equal((await aLive.waitFor('opscall', (e) => e.type === 'join')).user.name, 'Mod2');
    await b('POST', '/api/ops/call/signal', { to: m1.me.id, data: { sdp: 'offer' } });
    const sig = await aLive.waitFor('opscall', (e) => e.type === 'signal');
    assert.deepEqual([sig.from.name, sig.data.sdp], ['Mod2', 'offer']);
    assert.equal((await dev('POST', '/api/ops/call/signal', { to: m1.me.id, data: {} })).error.code, 'not_in_call');
    assert.deepEqual((await dev('GET', '/api/ops/team')).call.map((x) => x.name), ['Mod1', 'Mod2']);
    // the site closed: out of the call, the other one told
    bLive.close();
    assert.equal((await aLive.waitFor('opscall', (e) => e.type === 'leave')).user.name, 'Mod2');
    assert.deepEqual((await a('GET', '/api/ops/call')).members.map((x) => x.name), ['Mod1']);
    await a('POST', '/api/ops/call/leave', {});
    assert.deepEqual((await a('GET', '/api/ops/call')).members, []);
    // a player's own game connection never hears the operators' call
    aLive.close();
    devLive.close();
    assert.equal((await s.call('POST', '/api/ops/live-ticket', { token: p.token })).status, 403);
  } finally {
    await s.stop();
  }
});
