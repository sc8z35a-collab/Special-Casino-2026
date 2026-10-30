import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { RULES } from '../core/rules.js';
import { uiFixture, flush } from './ui-fixture.js';

function scene(file) {
  const ui = uiFixture(), versions = {}, registered = new Set(), listeners = [], cars = [], offers = [], presents = [], claims = [], effects = [], numpads = [];
  let me = { id: 1, name: 'Owner' };
  const deferred = (list, args) => new Promise((resolve, reject) => list.push({ args, resolve, reject }));
  const K = { el: ui.el, sfx() {}, toast: text => effects.push(['toast', text]), fail: error => effects.push(['error', error.message]), dragScroll() {},
    amountEl: (n) => ui.el('span', '', String(n)), receiptExpired: () => false, receiptHint() {},
    registerModal: id => registered.add(id), modalVersion: id => versions[id] || 0,
    showModal(id) { versions[id] = (versions[id] || 0) + 1; ui.node('#' + id).hidden = false; },
    closeModal(id) { versions[id] = (versions[id] || 0) + 1; const root = ui.node('#' + id); if (!root.hidden) { root.hidden = true; root.fire('closed'); } },
    closeModals() { registered.forEach(id => K.closeModal(id)); } };
  const BR = { CONFIG: RULES, kit: K, util: { $: ui.node, fmt: String }, store: { state: { dollars: 1000000000 } }, SOCIAL_IMG: { cars: {}, presents: {} },
    api: { hasToken: () => !!me, cars: () => deferred(cars), carOffer: (...args) => deferred(offers, args), present: (...args) => deferred(presents, args), presentClaim: (...args) => deferred(claims, args) },
    social: { me: () => me, onMe: fn => listeners.push(fn), onMsg: m => effects.push(['message', m]), refreshMsg: id => effects.push(['refresh', id]) },
    app: { serverBalance: balance => effects.push(['balance', balance]) }, cars: { changed: () => effects.push(['cars']) },
    screens: { numpad: opts => numpads.push(opts) } };
  ui.context.BR = BR; vm.runInNewContext(fs.readFileSync(new URL('../../js/ui/' + file + '.js', import.meta.url), 'utf8'), ui.context);
  (file === 'carsale' ? BR.carsaleDialog : BR.presents).init();
  const car = (id=1, paid=26500000) => ({ id, paid, model: 'two-state-sedan', rent: null, offer: 0 });
  return { ...ui, BR, K, cars, offers, presents, claims, effects, numpads, car,
    setMe(next) { me = next; listeners.forEach(fn => fn(next)); },
    async openCar(user={ id: 2, name: 'FriendA' }, owned=car()) { BR.carsaleDialog.open(user); cars.at(-1).resolve({ cars: [owned] }); await flush(); },
    choosePresent() { const tile = ui.node('#pr-grid').children[0]; ui.node('#pr-grid').fire('click', { target: { closest: () => tile } }); },
    sendPresent(user={ id: 2, name: 'FriendA' }) { BR.presents.open(user); this.choosePresent(); ui.node('#pr-go').fire('click'); } };
}

test('out-of-order car lists cannot replace the latest sale recipient', async () => {
  const s = scene('carsale'); s.BR.carsaleDialog.open({ id: 2, name: 'FriendA' }); s.BR.carsaleDialog.open({ id: 3, name: 'FriendB' });
  s.cars[1].resolve({ cars: [s.car(2)] }); await flush(); s.cars[0].resolve({ cars: [s.car(1)] }); await flush();
  assert.equal(s.node('#cs-name').textContent, 'FriendB');
});
test('closing modals retires a sale whose initial car list is still loading', async () => {
  const s = scene('carsale'); s.BR.carsaleDialog.open({ id: 2, name: 'FriendA' }); s.K.closeModals();
  s.cars[0].resolve({ cars: [s.car()] }); await flush(); assert.equal(s.node('#carsale').hidden, true);
});
test('an already-resolved car list cannot open after switching accounts', async () => {
  const s = scene('carsale'); s.BR.carsaleDialog.open({ id: 2, name: 'FriendA' }); s.cars[0].resolve({ cars: [s.car()] });
  s.setMe(null); s.setMe({ id: 9, name: 'Replacement' }); await flush(); assert.equal(s.node('#carsale').hidden, true);
});
test('closing a pending car offer releases its form and old success cannot close a replacement sale', async () => {
  const s = scene('carsale'); await s.openCar(); s.node('#cs-go').fire('click'); assert.equal(s.offers.length, 1); s.K.closeModal('carsale');
  s.BR.carsaleDialog.open({ id: 3, name: 'FriendB' }); assert.equal(s.cars.length, 2, 'closing must release the old busy form');
  s.cars[1].resolve({ cars: [s.car(2)] }); await flush(); s.offers[0].resolve({ message: { id: 1 } }); await flush();
  assert.equal(s.node('#carsale').hidden, false); assert.equal(s.node('#cs-name').textContent, 'FriendB'); assert.deepEqual(s.effects, []);
});
test('an obsolete failed car offer cannot display an error after its form closes', async () => {
  const s = scene('carsale'); await s.openCar(); s.node('#cs-go').fire('click'); s.K.closeModal('carsale'); s.offers[0].reject(new Error('old offer')); await flush(); assert.deepEqual(s.effects, []);
});
test('a retired sale number pad cannot change a newly selected car price', async () => {
  const s = scene('carsale'); await s.openCar(); s.node('#cs-amount').fire('click'); s.K.closeModal('carsale');
  await s.openCar({ id: 3, name: 'FriendB' }, s.car(2, 100000)); const before = s.node('#cs-value').textContent;
  s.numpads[0].onOk(0); assert.equal(s.node('#cs-value').textContent, before);
});
test('a current car offer still submits once and reports its actual recipient', async () => {
  const s = scene('carsale'); await s.openCar(); s.node('#cs-go').fire('click'); s.node('#cs-go').fire('click'); assert.equal(s.offers.length, 1);
  s.offers[0].resolve({ message: { id: 1 } }); await flush(); assert.equal(s.node('#carsale').hidden, true);
  assert.equal(s.effects.filter(x => x[0] === 'message').length, 1); assert.match(s.effects.find(x => x[0] === 'toast')[1], /FriendA/);
});
test('late price controls remain safe after the car sale has closed', async () => {
  const s = scene('carsale'); await s.openCar(); s.K.closeModal('carsale');
  for (const id of ['cs-up', 'cs-down', 'cs-amount']) assert.doesNotThrow(() => s.node('#' + id).fire('click'));
  assert.equal(s.offers.length, 0); assert.equal(s.node('#carsale').hidden, true);
});
test('old present success cannot close or relabel a newly opened recipient', async () => {
  const s = scene('presents'); s.sendPresent(); s.K.closeModal('present'); s.BR.presents.open({ id: 3, name: 'FriendB' });
  s.presents[0].resolve({ balance: { dollars: 12 }, message: { id: 1 } }); await flush();
  assert.equal(s.node('#present').hidden, false); assert.equal(s.node('#pr-name').textContent, 'FriendB'); assert.deepEqual(s.effects, []);
});
test('old present failure cannot unlock a newer pending send or submit it twice', async () => {
  const s = scene('presents'); s.sendPresent(); s.K.closeModal('present'); s.sendPresent({ id: 3, name: 'FriendB' });
  assert.equal(s.presents.length, 2); s.presents[0].reject(new Error('old present')); await flush();
  s.node('#pr-go').fire('click'); assert.equal(s.presents.length, 2); assert.deepEqual(s.effects, []);
});
test('a queued present result cannot update a replacement account wallet', async () => {
  const s = scene('presents'); s.sendPresent(); s.presents[0].resolve({ balance: { dollars: 12 }, message: { id: 1 } });
  s.setMe(null); s.setMe({ id: 9 }); await flush(); assert.deepEqual(s.effects, []);
});
test('a queued present claim cannot update or notify a replacement account', async () => {
  const s = scene('presents'), message = { id: 1, text: RULES.presents[0].id, amount: RULES.presents[0].price };
  const bubble = s.BR.presents.bubble(message, false); bubble.children[0].fire('click'); s.effects.length = 0;
  s.claims[0].resolve({ balance: { dollars: 12 }, paid: message.amount }); s.setMe(null); s.setMe({ id: 9 }); await flush();
  assert.deepEqual(s.effects, []); assert.notEqual(message.claimed, true);
});
test('a current present send survives a same-account profile refresh and keeps its original recipient', async () => {
  const s = scene('presents'); s.sendPresent(); s.setMe({ id: 1, name: 'Owner', rev: 2 }); s.presents[0].resolve({ balance: { dollars: 12 }, message: { id: 1 } }); await flush();
  assert.equal(s.node('#present').hidden, true); assert.equal(s.effects.filter(x => x[0] === 'message').length, 1); assert.match(s.effects.find(x => x[0] === 'toast')[1], /FriendA/);
});
