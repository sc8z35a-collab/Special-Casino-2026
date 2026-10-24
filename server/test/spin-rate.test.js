// The server caps spins at one per second (server/core/api.js: LIMITS.spin
// = [60, 1]). The token bucket refills one token a second and stores at most
// one, so a second spin in the same second is turned away and a spin a second
// later goes through. The default is enforced on the server regardless of
// what the client sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

test('spin: at most one per second (the second is turned away, a second later is allowed)', async () => {
  // the real default rate (the shared helper otherwise loosens it for other tests)
  const s = await startServer({ limits: { spin: [60, 1], shop: [100000, 1000], general: [100000, 1000], login: [100000, 1000], friend: [100000, 1000], transfer: [100000, 1000] } });
  try {
    const a = await s.register('スピン太郎');
    // enough tokens to try several spins
    s.setUser(a.me.id, { tokens: 1000000 });
    const bet = 100;

    const first = await s.call('POST', '/api/spin', { token: a.token, body: { bet } });
    assert.equal(first.status, 200, JSON.stringify(first));

    // a second spin right away: too fast
    const second = await s.call('POST', '/api/spin', { token: a.token, body: { bet } });
    assert.equal(second.status, 429, JSON.stringify(second));
    assert.equal(second.error.code, 'rate_limited', JSON.stringify(second));

    // a full second later: the bucket has refilled one token
    await new Promise((r) => setTimeout(r, 1050));
    const third = await s.call('POST', '/api/spin', { token: a.token, body: { bet } });
    assert.equal(third.status, 200, JSON.stringify(third));

    // and immediately after, too fast again
    const fourth = await s.call('POST', '/api/spin', { token: a.token, body: { bet } });
    assert.equal(fourth.status, 429, JSON.stringify(fourth));
  } finally {
    await s.stop();
  }
});
