import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

test('all configurable read pages reject unbounded/fractional limits and retain normal pagination', async t => {
  const s = await startServer({ developer: 'PageDev', operators: ['PageDev'] }); t.after(() => s.stop());
  const dev = await s.register('PageDev'), player = await s.register('PagePlayer');
  const paths = ['/api/diary', '/api/ops/diary', '/api/ops/team/messages?with=0', '/api/ops/log?q=test', '/api/ops/watch/log', '/api/ops/log/archive'];
  for (const path of paths) {
    const join = path.includes('?') ? '&' : '?';
    for (const limit of ['1.5', '-5', '0', 'NaN', 'Infinity', '9007199254740992']) {
      const r = await s.call('GET', path + join + 'limit=' + limit, { token: dev.token });
      assert.equal(r.status, 400, `${path}, limit=${limit}: ${JSON.stringify(r)}`); assert.equal(r.error.code, 'bad_limit');
    }
    for (const limit of ['', '1', '9999']) {
      const r = await s.call('GET', path + join + 'limit=' + limit, { token: dev.token });
      assert.equal(r.status, 200, `${path}, limit=${limit}: ${JSON.stringify(r)}`);
    }
  }
  const r = await s.call('GET', '/api/diary?limit=1.5', { token: player.token }); assert.equal(r.status, 400);
});
