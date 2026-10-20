// DEV7 on the server: an adopted 意見案 pays $100,000, bans told by the
// official bot (and a banned login kept for the locked title screen), the
// developer taking an operator's rights away. npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, PASSWORD } from './helpers.js';

let s, call, register, setUser;
let taku, sub;

before(async () => {
  s = await startServer({ operators: ['taku', 'sub'], limits: { spin: [100000, 1000], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000], dm: [100000, 1000] } });
  ({ call, register, setUser } = s);
  taku = await register('TAKU');
  sub = await register('Sub');
});
after(() => s.stop());

const ops = (method, url, body, who = taku) => call(method, url, { token: who.token, body });
const dollars = (id) => s.app.db.prepare('SELECT dollars FROM users WHERE id = ?').get(id).dollars;
async function fromBot(p) {
  const bot = (await call('GET', '/api/me', { token: p.token })).official;
  const id = bot ? bot.id : s.app.db.prepare("SELECT id FROM users WHERE npc = 'official'").get().id;
  return (await call('GET', `/api/messages?with=${id}`, { token: p.token })).messages.filter((m) => m.from && m.from.id === id);
}

test('an adopted 意見案: $100,000 from the official bot with its thanks, once', async () => {
  const p = await register('Idea1');
  await call('POST', '/api/official/feedback', { token: p.token, body: { kind: 'idea', text: 'ガチャを追加してほしい' } });
  await call('POST', '/api/official/feedback', { token: p.token, body: { kind: 'bug', text: '表示がずれる' } });
  const list = (await ops('GET', '/api/ops/feedback')).feedback;
  const idea = list.find((f) => f.kind === 'idea' && f.user.id === p.me.id), bug = list.find((f) => f.kind === 'bug' && f.user.id === p.me.id);
  const before = dollars(p.me.id);
  assert.equal((await ops('POST', '/api/ops/feedback/adopt', { id: idea.id })).reward, 100000);
  assert.equal(dollars(p.me.id), before + 100000);
  const said = await fromBot(p);
  assert.ok(said.some((m) => m.kind === 'transfer' && m.amount === 100000));
  assert.match(said[said.length - 1].text, /意見案（「ガチャを追加してほしい」）を採用/);
  assert.equal((await ops('POST', '/api/ops/feedback/adopt', { id: idea.id })).status, 409);
  assert.equal((await ops('POST', '/api/ops/feedback/adopt', { id: bug.id })).status, 404);
  const after = (await ops('GET', '/api/ops/feedback')).feedback.find((f) => f.id === idea.id);
  assert.ok(after.adoptedAt && after.handledAt);
  assert.equal(dollars(p.me.id), before + 100000);
  assert.ok((await ops('GET', '/api/ops/log')).entries.some((e) => e.action === 'idea_adopt'));
});

test('bans: the official bot says when (and when it ends); the login stays for the locked title screen', async () => {
  const p = await register('Ban7');
  await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'suspend' });
  let r = await call('GET', '/api/ban', { token: p.token });
  assert.deepEqual([r.ban.code, r.ban.kind], ['banned', 'suspend']);
  assert.match(r.ban.notice, /^あなたは\d{4}\/\d\d\/\d\d \d\d:\d\dに公式よりアクセス禁止されました。$/);
  // lifted by the operators: the game opens again, the bot says so
  await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'none' });
  assert.equal((await call('GET', '/api/ban', { token: p.token })).ban, null);
  let said = (await fromBot(p)).map((m) => m.text);
  assert.match(said[0], /【アクセス禁止のお知らせ】[\s\S]*公式よりアクセス禁止されました。\n期間：.* まで/);
  assert.match(said[1], /【アクセス禁止解除のお知らせ】[\s\S]*公式により解除されました/);
  // run out: lifted when next looked at, with the bot's word
  await ops('POST', '/api/ops/ban', { id: p.me.id, kind: 'ban' });
  setUser(p.me.id, { ban_until: Date.now() - 1000 });
  assert.equal((await call('GET', '/api/ban', { token: p.token })).ban, null);
  said = (await fromBot(p)).map((m) => m.text);
  assert.match(said[said.length - 1], /【BAN解除のお知らせ】[\s\S]*期間が終わり、解除されました/);
  assert.equal(said.length, 4);
});

test('the developer alone takes an operator\'s rights away: logged out everywhere, kept out of the site', async () => {
  assert.equal((await ops('GET', '/api/ops/me')).developer, true);
  assert.equal((await ops('GET', '/api/ops/me', undefined, sub)).developer, false);
  assert.equal((await ops('POST', '/api/ops/operator', { name: 'taku', action: 'revoke' }, sub)).error.code, 'not_developer');
  assert.equal((await ops('POST', '/api/ops/operator', { name: 'taku', action: 'revoke' })).error.code, 'developer');
  const r = await ops('POST', '/api/ops/operator', { name: 'Sub', action: 'revoke' });
  assert.ok(r.operators.find((o) => o.key === 'sub').revoked);
  // every login of theirs ends, saying why (once)
  const gone = await call('GET', '/api/me', { token: sub.token });
  assert.deepEqual([gone.status, gone.error.code], [401, 'ended']);
  assert.match(gone.error.message, /運営権が剥奪/);
  assert.equal((await call('GET', '/api/me', { token: sub.token })).error.code, 'auth');
  // the game as a player, the operator site no more
  const again = await call('POST', '/api/login', { body: { name: 'Sub', password: PASSWORD } });
  assert.equal(again.me.operator, false);
  const site = await call('GET', '/api/ops/me', { token: again.token });
  assert.deepEqual([site.status, site.error.code], [403, 'not_operator']);
  assert.match(site.error.message, /運営権が剥奪/);
  // given back
  await ops('POST', '/api/ops/operator', { name: 'Sub', action: 'restore' });
  assert.equal((await call('GET', '/api/ops/me', { token: again.token })).name, 'Sub');
  const log = (await ops('GET', '/api/ops/log')).entries.map((e) => e.action);
  assert.ok(log.includes('ops_revoke') && log.includes('ops_restore'));
});
