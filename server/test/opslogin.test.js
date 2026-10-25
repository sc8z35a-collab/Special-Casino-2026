// The operator site's login: what a wrong try leaves in the operators' log, and how much of it
// (the waits themselves are in security.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const login = (s, name, password, device, extra = {}) => s.call('POST', '/api/ops/login', { body: { name, password, ...extra }, headers: { 'X-Ops-Device': device } });
const lines = (s) => s.app.db.prepare("SELECT * FROM ops_log WHERE action LIKE 'login_%' ORDER BY id").all().map((r) => ({ ...r, detail: JSON.parse(r.detail) }));

test('a wrong login is written to the log with all that is known of where it came from, and never the password', async () => {
  const s = await startServer({ operators: ['taku', 'mod1'] });
  try {
    await s.register('Mod1');
    const client = {
      page: 'ops', tz: 'Asia/Tokyo', screen: { w: 390, h: 844, dpr: 3 }, webdriver: true, cores: 6, evil: 'x'.repeat(5000), password: 'nope',
      uaData: { platform: 'Android', model: 'Pixel 8', brands: [{ brand: 'Chromium', version: '125' }] }, gpu: 'Adreno (TM) 740'
    };
    await login(s, 'Mod1', 'my-wrong-password-9', 'phone-browser-000000001', { client });
    const a = lines(s)[0];
    assert.equal(a.action, 'login_fail');
    assert.equal(a.target_name, 'Mod1');
    const d = a.detail.login;
    assert.deepEqual([d.reason, d.account.role, d.account.exists], ['bad_password', 'operator', true]);
    assert.ok(d.net.ip && typeof d.net.headers === 'object', 'the connection and the browser\'s headers');
    assert.ok(d.net.socket && d.net.socket.http, 'what the host knows of the connection');
    assert.equal(d.browserTag.length, 12);
    // what the page reported is kept apart, cleaned, and cannot add names of its own
    assert.deepEqual([d.reported.uaData.model, d.reported.webdriver, d.reported.screen.w, d.reported.gpu], ['Pixel 8', true, 390, 'Adreno (TM) 740']);
    assert.equal(d.reported.evil, undefined);
    assert.equal(d.reported.password, undefined);
    assert.ok(!JSON.stringify(a).includes('my-wrong-password-9'), 'not the password');
    assert.equal(lines(s).length, 1, 'only wrong tries are written');

    // a name nobody has: a part of it only (a password typed where the name goes must not land in a log that cannot be cleaned)
    await login(s, 'Hunter2-secret-name', 'x', 'phone-browser-000000001');
    const b = lines(s)[1];
    assert.equal(b.detail.login.account.exists, false);
    assert.equal(b.detail.login.reason, 'no_account');
    assert.ok(!JSON.stringify(b).includes('Hunter2-secret-name'));
    assert.match(b.summary, /先頭「Hu」・19文字/);

    // the second wrong try on the account starts its wait: one line for it, with the wait's size
    await login(s, 'Mod1', 'wrong again', 'phone-browser-000000002');
    const c = lines(s)[2];
    assert.equal(c.action, 'login_lock');
    assert.match(c.summary, /「Mod1」（運営者）.*このアカウントを5分間ロックしました/);
    assert.equal(c.detail.login.tries.account.waitMs, 300000);
    // a try during the wait is written too (the wait is told); the page's question for a name nobody tried says the same as for one nobody got wrong
    await login(s, 'Mod1', 'pass1234', 'phone-browser-000000003');
    const e = lines(s)[3];
    assert.equal(e.detail.login.reason, 'locked');
    assert.equal(e.detail.login.wait.scope, 'account');
    const ask = (n) => s.call('POST', '/api/ops/login-wait', { body: { name: n }, headers: { 'X-Ops-Device': 'phone-browser-000000009' } });
    const [x, y] = [await ask('Nobody'), await ask('Taku')];
    assert.deepEqual([x.left, x.scope, y.left, y.scope], [0, '', 0, '']);
    // they are in the log's security kind, which the developer reads
    const taku = await s.register('TAKU');
    const seen = (await s.call('GET', '/api/ops/log?kind=security', { token: taku.token })).entries.filter((l) => l.action.startsWith('login_'));
    assert.equal(seen.length, 4);
  } finally {
    await s.stop();
  }
});

test('a flood of wrong tries takes only so much of a log that cannot be cleaned: a few lines an hour from one address, one line to say so, the count in the next hour', async () => {
  const s = await startServer({ operators: ['taku'] });
  try {
    await s.register('TAKU');
    for (let i = 1; i <= 30; i++) await login(s, `ghost${i}`, 'x', `flood-browser-${String(i).padStart(8, '0')}`);
    const first = lines(s);
    assert.equal(first.length, 8, 'eight lines from one address in the hour');
    assert.equal(first.filter((l) => l.action === 'login_burst').length, 1, 'the last of them says the rest are only counted');
    // the next hour: the first line says how many the last one left out
    s.app.db.prepare("UPDATE ops_locks SET until = ? WHERE key LIKE 'logw:%' OR key LIKE 'ip:%' OR key LIKE 'dev:%' OR key LIKE 'acct:%'").run(Date.now() - 1000);
    await login(s, 'ghost-again', 'x', 'flood-browser-99999999');
    const last = lines(s).pop();
    assert.equal(last.detail.login.droppedBefore, 22);
  } finally {
    await s.stop();
  }
});
