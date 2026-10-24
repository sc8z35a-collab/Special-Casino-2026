import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { TABLES } from '../core/db.js';

test('DEV UNIT restricts membership, persists text, pages history and keeps read cursors per account', async () => {
  const s = await startServer({ operators: ['taku', 'Mod'] });
  try {
    const dev = await s.register('taku'), mod = await s.register('Mod'), player = await s.register('Player');
    const call = (u, method, path, body) => s.call(method, '/api/ops/devunit/' + path, { token: u.token, body });
    assert.equal((await call(player, 'GET', 'comments')).status, 403);
    assert.equal((await call(player, 'POST', 'comments', { text: 'no' })).status, 403);
    assert.equal((await call(mod, 'POST', 'comments', { text: '  ' })).status, 400);
    assert.equal((await call(mod, 'POST', 'comments', { text: 'あ'.repeat(2001) })).status, 400);
    assert.equal((await call(mod, 'POST', 'comments', { text: {} })).status, 400);
    const text = '<img src=x onerror=alert(1)>\n開発資料について';
    const posted = await call(mod, 'POST', 'comments', { text });
    assert.equal(posted.status, 200); assert.equal(posted.comment.text, text);
    assert.equal(posted.comment.from.name, 'Mod'); assert.equal(posted.comment.from.developer, false);
    assert.equal((await call(mod, 'GET', 'counts')).unread, 0);
    assert.equal((await call(dev, 'GET', 'counts')).unread, 1);
    assert.equal((await call(dev, 'POST', 'read', { id: posted.comment.id })).status, 200);
    await call(dev, 'POST', 'read', { id: 0 });
    assert.equal((await call(dev, 'GET', 'counts')).unread, 0, 'older read does not move cursor back');
    assert.equal((await call(dev, 'GET', 'comments?before=-1')).status, 400);
    const add = s.app.db.prepare('INSERT INTO devunit_comments (user_id, body, created_at) VALUES (?, ?, ?)');
    for (let i = 0; i < 105; i++) add.run(mod.me.id, 'comment ' + i, Date.now());
    const page = await call(dev, 'GET', 'comments');
    assert.equal(page.comments.length, 100); assert.equal(page.more, true);
    const older = await call(dev, 'GET', 'comments?before=' + page.comments[0].id);
    assert.equal(older.comments.length, 6); assert.equal(older.more, false);
    assert.equal(older.comments[0].text, text);
    await call(dev, 'POST', 'read', { id: Number.MAX_SAFE_INTEGER });
    assert.equal((await call(dev, 'GET', 'counts')).unread, 0);
    await call(mod, 'POST', 'comments', { text: 'later' });
    assert.equal((await call(dev, 'GET', 'counts')).unread, 1, 'future cursor is clamped to existing comments');
    assert.equal((await call(dev, 'GET', 'comments')).comments.at(-1).text, 'later');
    assert.ok(TABLES.includes('devunit_comments') && TABLES.includes('devunit_reads'), 'included in backups');
    // Revocation is evaluated for every operation, rather than trusting the UI.
    s.app.db.prepare('INSERT INTO ops_access (name_key, granted, at, by_id) VALUES (?, 0, ?, ?)').run('mod', Date.now(), dev.me.id);
    assert.equal((await call(mod, 'GET', 'counts')).status, 403);
    assert.equal((await call(mod, 'POST', 'read', { id: 1 })).status, 403);
    const sec = await fetch(s.base + '/sec/'), ops = await fetch(s.base + '/ops/');
    assert.match(sec.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.match(ops.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally { await s.stop(); }
});
