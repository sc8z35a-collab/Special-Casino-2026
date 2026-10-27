const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
for (const name of fs.readdirSync(path.join(__dirname, '../.github/workflows')).filter(n => /\.ya?ml$/.test(n))) {
  const text = fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8');
  for (const match of text.matchAll(/\buses:\s*([^\s#]+)/g)) {
    const ref = match[1];
    assert.ok(ref.startsWith('./') || /^[^@]+@[a-f0-9]{40}$/.test(ref) || /^docker:\/\/[^@]+@sha256:[a-f0-9]{64}$/.test(ref), `${name}: pin ${ref} to its full SHA`);
  }
}
const tests = fs.readFileSync(path.join(__dirname, '../.github/workflows/tests.yml'), 'utf8');
assert.match(tests, /shard: \['1\/4', '2\/4', '3\/4', '4\/4'\]/);
assert.match(tests, /--test-shard=\$\{\{ matrix.shard \}\}/);
assert.match(tests, /needs: \[static-checks, server-test-shards\]/);
assert.match(tests, /if: always\(\)/);
console.log('PASS workflow SHA pins, complete four-way test sharding and required-status aggregation');
