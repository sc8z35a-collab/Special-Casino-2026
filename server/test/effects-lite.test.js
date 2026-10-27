import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(saved = {}) {
  let now = 0; const storage = new Map(Object.entries(saved)), frames = [];
  const ctx = vm.createContext({ console, document: { documentElement: { classList: { toggle() {} } } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    requestAnimationFrame: f => frames.push(f), setTimeout: () => 1, clearTimeout() {} });
  ctx.window = ctx; ctx.globalThis = ctx;
  for (const file of ['js/core/util.js', 'js/game/config.js', 'js/game/engine.js', 'js/core/effects.js', 'js/render/reels.js', 'js/render/fx.js'])
    vm.runInContext(fs.readFileSync(new URL('../../' + file, import.meta.url), 'utf8'), ctx);
  ctx.BR.util.now = () => now;
  return { BR: ctx.BR, storage, time: n => { now = n; }, frames };
}

test('light effects persist independently of all-off and individual effect choices', () => {
  const s = setup();
  s.BR.fx.set('shake', false); s.BR.fx.setLite(true);
  assert.equal(s.BR.fx.on('bigwin'), true); assert.equal(s.BR.fx.on('shake'), false);
  const restored = setup(Object.fromEntries(s.storage)).BR.fx;
  assert.equal(restored.lite(), true); assert.equal(restored.on('shake'), false);
  restored.setSimple(true); assert.equal(restored.on('bigwin'), false);
  restored.setSimple(false); assert.equal(restored.lite(), true); assert.equal(restored.on('bigwin'), true);
  restored.reset(); assert.equal(restored.lite(), false);
});

test('light mode reduces pixel/particle budgets and throttles drawing without dropping reel updates or a final frame', async () => {
  const { BR, time } = setup(); BR.fx.setLite(true);
  const reels = new BR.Reels({ getContext: () => ({}) });
  for (const name of ['Back', 'Front', 'Glow', 'Rays', 'Streaks', 'Flare']) reels['render' + name] = () => ({});
  BR.assets = { backImage: () => null, buildSymbols: () => Promise.resolve({}) };
  reels.invalidate = () => {};
  await reels.resize(2); assert.equal(reels.canvas.width, Math.round(1006 * 0.8));
  let updates = 0, draws = 0;
  reels.reels = Array.from({ length: 5 }, () => ({ update: () => { updates++; return true; }, flash: 0 }));
  reels.draw = () => draws++; reels.dirty = false;
  for (let i = 0; i < 60; i++) { time(i * 1000 / 60); reels.frame(); }
  assert.equal(updates, 300); assert.ok(draws >= 20 && draws <= 30, String(draws));
  reels.reels.forEach(reel => { reel.update = () => false; });
  reels.dirty = true; time(1000); const before = draws; reels.frame();
  assert.equal(draws, before + 1); assert.equal(reels.running, false);
  const fx = Object.create(BR.FX.prototype);
  Object.assign(fx, { active: { sparks: [] }, back: {}, front: {}, W: 2000, H: 924, sprites: {} });
  fx.resize(2000, 924, 2); assert.equal(fx.front.width, 1500);
  fx.burstSparks(0, 0, 100, 100, 0); assert.equal(fx.active.sparks.length, 25);
  BR.fx.setLite(false); fx.active.sparks = [];
  fx.burstSparks(0, 0, 100, 100, 0); assert.equal(fx.active.sparks.length, 100);
  await reels.resize(2); assert.equal(reels.canvas.width, 2012);
});
