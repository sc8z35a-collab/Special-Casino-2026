import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from './helpers.js';
import { TABLES, migrate } from '../core/db.js';
import { DIARY_TTL } from '../core/diary.js';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jc1kAAAAASUVORK5CYII=';
const create = (s, dev, fields = {}) => s.call('POST', '/api/ops/diary', { token: dev.token, body: { title: '開発者日記', text: '更新内容です。', reward: 10000, ...fields } });

test('diary enforces developer-only publishing and private comments with the shared filters', async () => {
  const s = await startServer({ operators: ['taku', 'Mod'] });
  try {
    const dev = await s.register('taku'), mod = await s.register('Mod'), a = await s.register('Alice'), b = await s.register('Bob');
    assert.equal((await s.call('GET', '/api/diary')).status, 401);
    for (const u of [mod, a]) {
      for (const path of ['/api/ops/diary', '/api/ops/diary/comments?post=1', '/api/ops/diary/image?post=1']) assert.equal((await s.call('GET', path, { token: u.token })).status, 403);
      for (const path of ['/api/ops/diary', '/api/ops/diary/visibility', '/api/ops/diary/delete']) assert.equal((await s.call('POST', path, { token: u.token, body: { post: 1, title: 'no', text: 'no', hidden: true, confirm: true } })).status, 403);
    }
    const { id } = await create(s, dev, { image: png });
    assert.ok(id);
    assert.equal((await s.call('GET', '/api/diary/image?post=' + id, { token: a.token })).image, png);
    const comment = await s.call('POST', '/api/diary/comments', { token: a.token, body: { post: id, text: '死ね' } });
    assert.equal(comment.status, 200); assert.equal(comment.comment.text, '***');
    const own = await s.call('GET', '/api/diary/comments?post=' + id, { token: a.token });
    assert.equal(own.comments.length, 1); assert.equal(own.comments[0].text, '***'); assert.equal(own.comments[0].original, undefined);
    assert.deepEqual((await s.call('GET', '/api/diary/comments?post=' + id, { token: b.token })).comments, []);
    const privateComments = await s.call('GET', '/api/ops/diary/comments?post=' + id, { token: dev.token });
    assert.equal(privateComments.comments[0].original, '死ね'); assert.equal(privateComments.comments[0].from.name, 'Alice'); assert.equal(privateComments.comments[0].from.avatar, 'traveler-green');
    assert.deepEqual(privateComments.comments[0].words, ['死ね']);
    assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM detections').get().n, 0, 'private diary content must not leak into operator detections');
    assert.equal((await s.call('POST', '/api/diary/comments', { token: a.token, body: { post: id, text: 'a'.repeat(2001) } })).status, 400);
    const rejected = await s.call('POST', '/api/diary/comments', { token: b.token, body: { post: id, text: 'hello', file: 'not allowed' } });
    assert.equal(rejected.error.code, 'filtered');
    assert.ok(s.app.db.prepare('SELECT chat_ban FROM users WHERE id = ?').get(b.me.id).chat_ban);
    assert.equal((await s.call('POST', '/api/diary/comments', { token: b.token, body: { post: id, text: 'hello' } })).error.code, 'chat_banned');
  } finally { await s.stop(); }
});

test('diary rewards are transactional, once per player, and expire exactly 30 days from publication', async () => {
  const s = await startServer();
  try {
    const dev = await s.register('taku'), a = await s.register('Alice'), b = await s.register('Bob');
    for (const reward of [1, 9999, 15000, 250001, '10000']) assert.equal((await create(s, dev, { reward })).status, 400);
    const { id } = await create(s, dev, { reward: 250000 });
    const p = s.app.db.prepare('SELECT * FROM diary_posts WHERE id = ?').get(id);
    assert.equal(p.expires_at - p.created_at, DIARY_TTL);
    const results = await Promise.all(Array.from({ length: 8 }, () => s.call('POST', '/api/diary/claim', { token: a.token, body: { post: id, amount: 99999999 } })));
    assert.ok(results.every(r => r.status === 200)); assert.equal(results.reduce((n, r) => n + r.paid, 0), 250000);
    assert.equal((await s.call('GET', '/api/me', { token: a.token })).me.dollars, a.me.dollars + 250000);
    assert.equal((await s.call('POST', '/api/diary/claim', { token: b.token, body: { post: id } })).paid, 250000);
    const state = await s.call('GET', '/api/diary', { token: a.token }); assert.equal(state.posts[0].claimed, true); assert.equal(state.posts[0].claimable, false);
    s.app.db.prepare('UPDATE diary_posts SET expires_at = ? WHERE id = ?').run(Date.now(), id);
    assert.equal((await s.call('POST', '/api/diary/claim', { token: dev.token, body: { post: id } })).error.code, 'expired');
    const noGift = await create(s, dev, { reward: 0 });
    assert.equal((await s.call('POST', '/api/diary/claim', { token: a.token, body: { post: noGift.id } })).status, 409);
  } finally { await s.stop(); }
});

test('diary toggles, bookmarks, hidden posts and irreversible deletion preserve reward boundaries', async () => {
  const s = await startServer();
  try {
    const dev = await s.register('taku'), a = await s.register('Alice');
    const { id } = await create(s, dev, { image: png });
    const call = (method, path, body) => s.call(method, path, { token: a.token, body });
    for (let i = 0; i < 2; i++) {
      assert.equal((await call('POST', '/api/diary/react', { post: id, kind: 'liked', on: true })).status, 200);
      await call('POST', '/api/diary/react', { post: id, kind: 'bookmarked', on: true });
      await call('POST', '/api/diary/read', { post: id });
    }
    const list = await call('GET', '/api/diary?bookmarks=1'); assert.equal(list.posts.length, 1); assert.equal(list.posts[0].likes, 1); assert.equal(list.posts[0].hasImage, true); assert.equal(list.posts[0].image, undefined);
    assert.equal((await call('POST', '/api/diary/react', { post: id, kind: 'hidden', on: true })).status, 400);
    await call('POST', '/api/diary/claim', { post: id });
    await s.call('POST', '/api/ops/diary/visibility', { token: dev.token, body: { post: id, hidden: true } });
    assert.deepEqual((await call('GET', '/api/diary?bookmarks=1')).posts, []);
    assert.equal((await call('GET', '/api/diary/image?post=' + id)).status, 404);
    assert.equal((await call('GET', '/api/diary/comments?post=' + id)).status, 404);
    for (const [path, body] of [['read', {}], ['comments', { text: 'hello' }], ['react', { kind: 'liked', on: false }], ['claim', {}]]) assert.equal((await call('POST', '/api/diary/' + path, { post: id, ...body })).status, 404);
    assert.equal((await s.call('GET', '/api/ops/diary', { token: dev.token })).posts[0].hidden, true);
    await s.call('POST', '/api/ops/diary/visibility', { token: dev.token, body: { post: id, hidden: false } });
    assert.equal((await call('POST', '/api/diary/claim', { post: id })).paid, 0);
    await call('POST', '/api/diary/react', { post: id, kind: 'bookmarked', on: false });
    assert.equal((await call('GET', '/api/diary?bookmarks=1')).posts.length, 0);
    assert.equal((await s.call('POST', '/api/ops/diary/delete', { token: dev.token, body: { post: id } })).status, 400);
    await s.call('POST', '/api/ops/diary/delete', { token: dev.token, body: { post: id, confirm: true } });
    assert.equal((await call('POST', '/api/diary/claim', { post: id })).status, 404);
    for (const table of ['diary_posts', 'diary_reactions', 'diary_reads', 'diary_comments', 'diary_claims']) assert.equal(s.app.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n, 0);
    assert.ok((await create(s, dev)).id > id, 'deleted identifiers never recur');
  } finally { await s.stop(); }
});

test('diary publishes live events, validates images and pages posts and developer comments', async () => {
  const s = await startServer(); let live;
  try {
    const dev = await s.register('taku'), a = await s.register('Alice'); live = await s.listen(a);
    const { id } = await create(s, dev);
    assert.deepEqual(await live.waitFor('diary'), { id });
    for (const image of ['https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,SGVsbG8=', 'x'.repeat(710001)]) assert.equal((await create(s, dev, { image })).status, 400);
    for (let i = 0; i < 12; i++) await create(s, dev, { title: '投稿' + i });
    const first = await s.call('GET', '/api/diary', { token: a.token }); assert.equal(first.posts.length, 10); assert.equal(first.more, true);
    const next = await s.call('GET', '/api/diary?before=' + first.posts.at(-1).id, { token: a.token }); assert.equal(next.posts.length, 3); assert.equal(next.more, false);
    const add = s.app.db.prepare('INSERT INTO diary_comments (post_id,user_id,body,original,words,created_at) VALUES (?,?,?,?,?,?)');
    for (let i = 0; i < 53; i++) add.run(id, a.me.id, 'comment ' + i, 'comment ' + i, '[]', Date.now());
    const comments = await s.call('GET', '/api/ops/diary/comments?post=' + id, { token: dev.token }); assert.equal(comments.comments.length, 50); assert.equal(comments.more, true);
    const older = await s.call('GET', '/api/ops/diary/comments?post=' + id + '&before=' + comments.comments.at(-1).id, { token: dev.token }); assert.equal(older.comments.length, 3);
    assert.equal((await s.call('GET', '/api/diary?before=-1', { token: a.token })).status, 400);
    migrate(s.app.db); // repeated migration keeps posts and player balances intact
    for (const t of ['diary_posts', 'diary_reads', 'diary_reactions', 'diary_comments', 'diary_claims', 'ops_mfa']) assert.ok(TABLES.includes(t));
    const source = fs.readFileSync(new URL('../../README_DEV_NEWS.md', import.meta.url), 'utf8');
    assert.equal(await (await fetch(s.base + '/ops/assets/readme-dev-news.txt')).text(), source);
    // (the developer's copy of the README, in the operator site: node tools/sync_devunit_readme.cjs)
    const readme = fs.readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    assert.equal(await (await fetch(s.base + '/ops/assets/readme-dev.txt')).text(), readme, 'readme-dev.txt is out of step with README.md');
  } finally { if (live) live.close(); await s.stop(); }
});
