import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../js/ui/kit.js', import.meta.url), 'utf8');
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function scene() {
  const nodes = new Map(), notices = []; let ready = false, resolve, reject;
  const gate = new Promise((yes, no) => { resolve = yes; reject = no; });
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, Object.assign(new EventTarget(), { hidden: true, textContent: '', dataset: {}, closest: () => null }));
    return nodes.get(id);
  };
  const BR = { util: { $: selector => node(selector.slice(1)) }, sfx: { play() {} }, app: { toast: message => notices.push(message) },
    resources: { ready: () => ready, load: () => gate, wait: job => job } };
  vm.runInNewContext(source, { window: { BR, addEventListener() {} }, document: { getElementById: node }, Promise, Event });
  BR.kit.init();
  return { K: BR.kit, node, notices, resolve() { ready = true; resolve(); }, reject };
}

test('closing a confirmation during its first stylesheet load settles the action as canceled', async () => {
  const s = scene(); let result = 'pending';
  const job = s.K.confirmBox(p => { p.textContent = 'spend'; }).then(v => { result = v; });
  s.K.closeModals(); await flush(); assert.equal(result, false);
  s.resolve(); await job; await flush(); assert.equal(s.node('confirm').hidden, true);
});

test('replacing a pending confirmation cancels the previous action and confirms only the latest', async () => {
  const s = scene(); let first = 'pending', second = 'pending';
  s.K.confirmBox(() => {}).then(v => { first = v; });
  const job = s.K.confirmBox(() => {}).then(v => { second = v; });
  await flush(); assert.equal(first, false); assert.equal(second, 'pending');
  s.resolve(); await flush(); assert.equal(s.node('confirm').hidden, false);
  s.node('confirm-yes').dispatchEvent(new Event('click')); await job;
  assert.equal(first, false); assert.equal(second, true);
});

test('a failed confirmation load releases the pending action and allows a later retry', async () => {
  const s = scene(); let result = 'pending';
  s.K.confirmBox(() => {}).then(v => { result = v; });
  s.reject(new Error('offline')); await flush();
  assert.equal(result, false); assert.equal(s.notices.length, 1);
  s.resolve(); const retry = s.K.confirmBox(() => {});
  s.node('confirm-yes').dispatchEvent(new Event('click')); assert.equal(await retry, true);
});

test('an obsolete failed load cannot show an error after the confirmation was canceled', async () => {
  const s = scene(); let result;
  s.K.confirmBox(() => {}).then(v => { result = v; }); s.K.closeModals();
  s.reject(new Error('offline')); await flush();
  assert.equal(result, false); assert.deepEqual(s.notices, []);
});

test('Escape cancels a confirmation even while its first stylesheet is pending', async () => {
  const s = scene(); let result = 'pending';
  s.K.confirmBox(() => {}).then(v => { result = v; });
  assert.equal(s.K.escape(), true); await flush(); assert.equal(result, false);
  s.resolve(); await flush(); assert.equal(s.node('confirm').hidden, true);
});
