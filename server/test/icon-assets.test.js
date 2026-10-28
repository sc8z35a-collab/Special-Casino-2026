import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

test('compressed icons stay within budget and every native/PWA PNG keeps its canvas dimensions', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const report = JSON.parse(fs.readFileSync(path.join(root, 'docs/icons-compression.json')));
  let bytes = 0;
  const illustrations = report.images.filter(row => row.path === 'img/ui/login-bonus.webp');
  for (const row of report.images) {
    // The user restored this full-width board for readable reward text. It
    // is an illustration, excluded from the icon compressor from now on.
    if (row.path === 'img/ui/login-bonus.webp') continue;
    const data = fs.readFileSync(path.join(root, row.path)); bytes += data.length;
    assert.equal(data.length, row.afterBytes, row.path);
    if (row.path.endsWith('.png')) {
      assert.equal(data.toString('hex', 0, 8), '89504e470d0a1a0a', row.path);
      assert.deepEqual([data.readUInt32BE(16), data.readUInt32BE(20)], row.beforeSize, row.path);
    } else {
      assert.equal(data.toString('ascii', 0, 4), 'RIFF', row.path);
      assert.equal(data.toString('ascii', 8, 12), 'WEBP', row.path);
    }
  }
  assert.equal(bytes, report.afterBytes - illustrations.reduce((n, row) => n + row.afterBytes, 0));
  assert.ok(bytes < (report.beforeBytes - illustrations.reduce((n, row) => n + row.beforeBytes, 0)) * .45, `icon budget regressed: ${bytes}`);
});

test('the full-width login bonus board retains readable source resolution and is excluded from icon resizing', async () => {
  const root = path.resolve(import.meta.dirname, '../..'), image = sharp(path.join(root, 'img/ui/login-bonus.webp'));
  const metadata = await image.metadata(); assert.ok(metadata.width >= 1400 && metadata.height >= 460);
  await image.raw().toBuffer();
  assert.match(fs.readFileSync(path.join(root, 'tools/art/compress_icons.py'), 'utf8'), /EXCLUDE\s*=\s*\{[^}]*'login-bonus'/s);
});
