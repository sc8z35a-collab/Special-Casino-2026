// DEV10 on the server: the security shield (it turns away attacks and blocks
// the attacker, while players behind the loopback/proxy are never touched; the
// operators block and unblock by hand), the lockdown (a breach shuts everyone
// out but the security base, cuts outbound, writes a 緊急 entry, and an
// operator lifts it), and the security base (/sec/) — its realtime status, its
// read of the log, and its sealed channel. Cyber-attack tests are intended.
// npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const LIMITS = { general: [100000, 1000], login: [100000, 1000], spin: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000] };
const CODE = '987654321098';

// a request from an address out on the internet (behind the proxy): the game
// sends the real client address in X-Forwarded-For, which the shield watches
const from = (ip, extra) => ({ 'X-Forwarded-For': ip, ...(extra || {}) });

async function operator(s, name) {
  const u = await s.register(name);
  return u;
}

test('the shield turns away attacks and blocks the attacker; players on the proxy are untouched; operators block and unblock by hand', async () => {
  const s = await startServer({ operators: ['taku'], trustProxy: true, limits: LIMITS });
  try {
    const taku = await operator(s, 'TAKU');

    // a scanner tool is refused at once, and its address is then blocked
    const scan = await s.call('GET', '/api/health', { headers: from('203.0.113.5', { 'User-Agent': 'sqlmap/1.6-dev' }) });
    assert.equal(scan.status, 403, JSON.stringify(scan));
    const after = await s.call('GET', '/api/health', { headers: from('203.0.113.5') });
    assert.equal(after.status, 429, 'the attacker address is now blocked');
    assert.equal(after.error.code, 'blocked');

    // an injection in the query is refused too (a different address)
    const inj = await s.call('GET', "/api/user?id=1%20union%20select%20password%20from%20users", { headers: from('198.51.100.9') });
    assert.equal(inj.status, 403, JSON.stringify(inj));

    // a path-traversal probe
    const trav = await s.call('GET', '/api/..%2f..%2fetc/passwd', { headers: from('198.51.100.20') });
    assert.ok(trav.status === 403 || trav.status === 404, 'traversal refused');

    // a player behind the loopback/proxy (no forwarded address) is never blocked,
    // however much they do
    for (let i = 0; i < 40; i++) assert.equal((await s.call('GET', '/api/me', { token: taku.token })).status, 200);

    // the operator site's セキュリティ tab sees the attacks and the blocks
    const sec = await s.call('GET', '/api/ops/security', { token: taku.token });
    assert.equal(sec.status, 200);
    assert.ok(sec.shield.totals.attacks >= 2, 'attacks counted');
    const keys = sec.shield.blocks.map((b) => b.key);
    assert.ok(keys.includes('ip:203.0.113.5') && keys.includes('ip:198.51.100.9'), JSON.stringify(keys));

    // the security log has the shield's automatic blocks
    const log = (await s.call('GET', '/api/ops/log?kind=security', { token: taku.token })).entries.map((e) => e.action);
    assert.ok(log.includes('shield_auto_block'), JSON.stringify(log));

    // the operator lifts a block by hand, and that address can play again
    const un = await s.call('POST', '/api/ops/security/unblock', { token: taku.token, body: { key: 'ip:203.0.113.5' } });
    assert.equal(un.ok, true);
    assert.equal((await s.call('GET', '/api/health', { headers: from('203.0.113.5') })).status, 200, 'unblocked');

    // and blocks one by hand
    await s.call('POST', '/api/ops/security/block', { token: taku.token, body: { scope: 'ip', target: '203.0.113.77', reason: 'test' } });
    assert.equal((await s.call('GET', '/api/health', { headers: from('203.0.113.77') })).status, 429);
    const log2 = (await s.call('GET', '/api/ops/log?kind=security', { token: taku.token })).entries.map((e) => e.action);
    assert.ok(log2.includes('shield_block') && log2.includes('shield_unblock'));
  } finally {
    await s.stop();
  }
});

test('a flood from one address is shed', async () => {
  const s = await startServer({ trustProxy: true, shieldConfig: { perIpPerMinute: 20 }, limits: LIMITS });
  try {
    let ok = 0, blocked = 0;
    for (let i = 0; i < 26; i++) {
      const r = await s.call('GET', '/api/health', { headers: from('203.0.113.90') });
      if (r.status === 200) ok++; else if (r.status === 429) blocked++;
    }
    assert.ok(ok >= 15 && ok <= 21, 'served up to the ceiling: ' + ok);
    assert.ok(blocked >= 3, 'then shed: ' + blocked);
    // another address is unaffected
    assert.equal((await s.call('GET', '/api/health', { headers: from('203.0.113.91') })).status, 200);
  } finally {
    await s.stop();
  }
});

test('a breach triggers the lockdown: everyone is shut out but the security base; an operator lifts it', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'], trustProxy: true, shieldConfig: { breachAttackers: 3, breachWindowMs: 120000 }, limits: LIMITS });
  try {
    const taku = await operator(s, 'TAKU');
    const mod = await operator(s, 'Mod1');
    const player = await s.register('Player1');

    // three different addresses attack within the window → a breach → lockdown
    for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      const r = await s.call('GET', '/api/health', { headers: from(ip, { 'User-Agent': 'nikto/2.1' }) });
      assert.equal(r.status, 403);
    }

    // the player sees 緊急メンテナンス (loopback/proxy addresses are not blocked,
    // so this is the lockdown talking, not the shield)
    const me = await s.call('GET', '/api/me', { token: player.token });
    assert.equal(me.status, 503);
    assert.equal(me.error.lockdown, true, JSON.stringify(me.error));
    assert.equal(me.error.emergency, true);

    // the operator site is shut too
    assert.equal((await s.call('GET', '/api/ops/players', { token: taku.token })).status, 503);

    // the security base keeps working for an operator
    const status = await s.call('GET', '/api/sec/status', { token: taku.token });
    assert.equal(status.status, 200, JSON.stringify(status));
    assert.equal(status.emergency.level, 'lockdown');
    assert.equal(status.health.outbound, false, 'outbound is cut during a lockdown');
    assert.ok(status.shield.blocks.length >= 3);

    // a normal player cannot use the security base
    assert.equal((await s.call('GET', '/api/sec/status', { token: player.token })).status, 403);

    // the lockdown is in the 緊急 log
    const elog = (await s.call('GET', '/api/sec/log?kind=emergency', { token: mod.token })).entries.map((e) => e.action);
    assert.ok(elog.includes('lockdown'), JSON.stringify(elog));

    // the sealed channel: a message goes in and comes back, stored encrypted
    const sent = await s.call('POST', '/api/sec/messages', { token: taku.token, body: { text: '攻撃を確認、監視中' } });
    assert.equal(sent.status, 200);
    const msgs = await s.call('GET', '/api/sec/messages', { token: mod.token });
    assert.ok(msgs.messages.some((m) => m.text === '攻撃を確認、監視中'), 'the channel shows it');
    const stored = s.app.db.prepare('SELECT body FROM sec_messages ORDER BY id DESC LIMIT 1').get().body;
    assert.ok(stored.indexOf('攻撃') < 0, 'stored sealed, not in the clear');

    // an operator lifts the lockdown by hand (any operator, any time)
    const rel = await s.call('POST', '/api/sec/release', { token: mod.token });
    assert.equal(rel.status, 200);
    assert.equal(rel.locked, false);

    // the game is back
    assert.equal((await s.call('GET', '/api/me', { token: player.token })).status, 200);
    const back = await s.call('GET', '/api/sec/status', { token: taku.token });
    assert.equal(back.emergency.level, '');
    assert.equal(back.health.outbound, true);

    // both the lockdown and its release are in the 緊急 log
    const elog2 = (await s.call('GET', '/api/ops/log?kind=emergency', { token: taku.token })).entries.map((e) => e.action);
    assert.ok(elog2.includes('lockdown') && elog2.includes('lockdown_release'));
  } finally {
    await s.stop();
  }
});

test('an operator can raise the lockdown by hand from the security base, and it holds through a restart', async () => {
  const dataDir = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'br-lock-'));
  try {
    const s1 = await startServer({ operators: ['taku'], limits: LIMITS, dataDir });
    const taku = await operator(s1, 'TAKU');
    const raise = await s1.call('POST', '/api/sec/lockdown', { token: taku.token, body: { reason: '点検' } });
    assert.equal(raise.locked, true);
    assert.equal((await s1.call('GET', '/api/me', { token: taku.token })).status, 503);
    await s1.stop();

    // a fresh server on the same data: still locked down. The operator reaches
    // the security base through the operator login (the one login that works
    // during a lockdown), as the /sec/ site does — the game login is shut.
    const s2 = await startServer({ operators: ['taku'], limits: LIMITS, dataDir });
    try {
      assert.equal((await s2.call('POST', '/api/login', { body: { name: 'TAKU', password: 'pass1234' } })).status, 503, 'the game login is shut during a lockdown');
      const login = await s2.call('POST', '/api/ops/login', { body: { name: 'TAKU', password: 'pass1234' }, headers: { 'X-Ops-Device': 'browser-aaaaaaaaaaaaaaaa' } });
      assert.ok(login.token, JSON.stringify(login));
      assert.equal((await s2.call('GET', '/api/sec/status', { token: login.token })).emergency.level, 'lockdown', 'held through the restart');
      // lifted
      assert.equal((await s2.call('POST', '/api/sec/release', { token: login.token })).locked, false);
      assert.equal((await s2.call('GET', '/api/me', { token: login.token })).status, 200);
    } finally {
      await s2.stop();
    }
  } finally {
    (await import('node:fs')).rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the security base site is served, apart from the game and the operator site', async () => {
  const s = await startServer({ operators: ['taku'], limits: LIMITS });
  try {
    const page = await fetch(s.base + '/sec/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type') || '', /text\/html/);
    const html = await page.text();
    assert.ok(html.indexOf('security HOME') >= 0);
    assert.equal((await fetch(s.base + '/sec/sec.js')).status, 200);
    assert.equal((await fetch(s.base + '/sec/sec.css')).status, 200);
  } finally {
    await s.stop();
  }
});
