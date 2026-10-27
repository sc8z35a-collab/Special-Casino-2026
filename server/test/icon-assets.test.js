import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('compressed icons stay within budget and every native/PWA PNG keeps its canvas dimensions', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const report = JSON.parse(fs.readFileSync(path.join(root, 'docs/icons-compression.json')));
  let bytes = 0;
  for (const row of report.images) {
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
  assert.equal(bytes, report.afterBytes);
  assert.ok(bytes < report.beforeBytes * .45, `icon budget regressed: ${bytes}`);
});
