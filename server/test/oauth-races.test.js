import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function scene() {
  const storage = new Map(), polls = [], starts = [], links = [], calls = [], timers = new Map(); let next = 0;
  const ctx = { Promise, Date, location: { search: '', pathname: '/' }, document: { hidden: false },
    setTimeout: f => { timers.set(++next, f); return next; }, clearTimeout: n => timers.delete(n),
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } };
  ctx.window = ctx;
  ctx.BR = { platform: { app: true }, util: {}, kit: { sfx() {}, toast: t => calls.push(['toast', t]) },
    account: { oauthWait: x => calls.push(['wait', x]), signedIn: x => calls.push(['login', x.token]), isOpen: () => false },
    api: { online: true, oauthStart: () => new Promise(resolve => starts.push(resolve)), oauthLinkStart: () => new Promise(resolve => starts.push(resolve)),
      oauthPoll: flow => new Promise(resolve => polls.push({ flow, resolve })), oauthLink: () => new Promise(resolve => links.push(resolve)) } };
  vm.runInNewContext(fs.readFileSync(new URL('../../js/ui/oauth.js', import.meta.url), 'utf8'), ctx);
  ctx.BR.oauth.go = url => calls.push(['go', url]);
  return { BR: ctx.BR, polls, starts, links, calls, timers };
}

test('cancelled OAuth start and poll responses cannot navigate or sign in', async () => {
  const s = scene(); s.BR.oauth.begin('google', 'login'); s.BR.oauth.clear();
  s.starts[0]({ flow: 'cancelled-start', url: 'https://example.invalid' }); await flush();
  assert.deepEqual(s.calls, []); assert.equal(s.polls.length, 0);
  s.BR.oauth.begin('google', 'login'); s.starts[1]({ flow: 'cancelled-poll', url: 'https://example.invalid' }); await flush();
  s.BR.oauth.clear(); s.polls[0].resolve({ step: 'login', token: 'old-token' }); await flush();
  assert.equal(s.calls.some(c => c[0] === 'login'), false); assert.equal(s.timers.size, 0);
});

test('an old OAuth poll or link result cannot clear or replace the new flow', async () => {
  const s = scene(); s.BR.oauth.begin('google', 'link'); s.starts[0]({ flow: 'old', url: 'https://example.invalid' }); await flush();
  s.polls[0].resolve({ step: 'ready' }); await flush(); assert.equal(s.links.length, 1);
  s.BR.oauth.clear(); s.BR.oauth.begin('discord', 'login'); s.starts[1]({ flow: 'new', url: 'https://example.invalid' }); await flush();
  s.links[0]({ provider: 'google' }); await flush();
  assert.equal(s.calls.some(c => c[0] === 'toast' && c[1].includes('連携しました')), false);
  s.polls[1].resolve({ step: 'login', token: 'new-token' }); await flush();
  assert.deepEqual(s.calls.filter(c => c[0] === 'login'), [['login', 'new-token']]);
});
