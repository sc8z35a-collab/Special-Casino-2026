import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

test('gacha artwork and every reward fallback resolve to bundled images; supplied UI assets stay below 100 KB', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const ctx = { window: { BR: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/art/gacha-images.js'), 'utf8'), ctx);
  const files = [];
  function walk(x) { for (const value of Object.values(x)) if (typeof value === 'string') files.push(value); else walk(value); }
  walk(ctx.window.BR.GACHA_ART);
  for (const file of files) {
    assert.ok(file.startsWith('img/'), file);
    const bytes = fs.readFileSync(path.join(root, file));
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', file);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', file);
  }
  const added = fs.readdirSync(path.join(root, 'img/gacha')).reduce((n, file) => n + fs.statSync(path.join(root, 'img/gacha', file)).size, 0);
  assert.ok(added < 100 * 1024, `${added} bytes`);
});
