import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../ops/glass.js', import.meta.url), 'utf8');
function scene(canLens = true) {
  const classes = new Set(), observed = new Set(), mutations = [], media = [];
  const panes = [];
  let queries = 0, resizeObservers = 0;
  const context = {
    navigator: { userAgent: 'Chrome/130', deviceMemory: 8, hardwareConcurrency: 4 },
    CSS: { supports: () => canLens },
    document: { body: { classList: { contains: (c) => classes.has(c) } },
      querySelectorAll() { queries++; return panes.filter((p) => p.isConnected); }, addEventListener() {} },
    MutationObserver: class { constructor(callback) { mutations.push(callback); } observe() {} },
    ResizeObserver: class { constructor() { resizeObservers++; } observe(node) { observed.add(node); } unobserve(node) { observed.delete(node); } },
    setTimeout, clearTimeout,
    matchMedia() { const value = { matches: false, addEventListener(event, callback) { value.change = callback; } }; media.push(value); return value; }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { api: context.OpsGlass, classes, observed, panes, media, changed: () => mutations[0]([]),
    queries: () => queries, resizeObservers: () => resizeObservers };
}

test('glass releases removed panes even when they were hidden before a resize observer could build a filter', () => {
  const s = scene();
  for (let i = 0; i < 100; i++) {
    const node = { isConnected: true }; s.panes.push(node); s.api.scan();
    assert.ok(s.observed.has(node));
    node.isConnected = false; s.api.scan();
    assert.equal(s.observed.size, 0);
  }
  const node = s.panes[0]; node.isConnected = true; s.api.scan();
  assert.ok(s.observed.has(node), 'a reinserted pane is observed again');
  const queries = s.queries(); s.api.release(node);
  assert.equal(s.observed.size, 0); assert.equal(s.queries(), queries, 'a removed widget can release its observer without rescanning the desktop');
});

test('unrelated desktop classes do not rescan glass panes; changing glass mode or the phone breakpoint still does', () => {
  const s = scene(), first = s.queries();
  for (let i = 0; i < 100; i++) { s.classes.add('mac-dock-revealed'); s.changed(); s.classes.delete('mac-dock-revealed'); s.changed(); }
  assert.equal(s.queries(), first);
  s.classes.add('mac-flat'); s.changed(); assert.equal(s.api.lens(), false);
  assert.equal(s.queries(), first + 1);
  s.classes.delete('mac-flat'); s.changed(); assert.equal(s.api.lens(), true);
  s.media[0].matches = true; s.media[0].change();
  assert.equal(s.queries(), first + 3);
});

test('a browser using CSS glass fallback starts no resize observer or pane scan for unsupported SVG lenses', () => {
  const s = scene(false);
  s.panes.push({ isConnected: true });
  for (let i = 0; i < 20; i++) s.api.scan();
  assert.equal(s.api.lens(), false); assert.equal(s.resizeObservers(), 0); assert.equal(s.queries(), 0);
});
