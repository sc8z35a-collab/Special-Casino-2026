// Every optional check must have an explicit CI tier; new checks cannot silently stay local.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const checks = require('./checks.json');
const files = fs.readdirSync(__dirname).filter((name) => /^check_.*\.cjs$/.test(name)).sort();
assert.deepEqual(Object.keys(checks).sort(), files, 'register every tools/check_*.cjs in tools/checks.json');
for (const [file, rule] of Object.entries(checks)) {
  assert.ok(['node', 'browser', 'worker', 'fixture'].includes(rule.runner), file);
  assert.ok(['pr', 'nightly'].includes(rule.tier), file);
  assert.ok(fs.statSync(path.join(__dirname, file)).isFile());
}
if (process.argv.includes('--browser')) {
  const rule = checks[process.argv[process.argv.indexOf('--browser') + 1]];
  assert.ok(rule); console.log(rule.runner === 'browser' || rule.browser === true ? 'true' : 'false');
} else if (process.argv.includes('--matrix')) {
  const all = process.argv.includes('--all');
  console.log(JSON.stringify(Object.entries(checks).filter(([, rule]) => rule.runner !== 'node' && (all || rule.tier === 'pr')).map(([file]) => file)));
} else console.log('PASS ' + files.length + ' checks assigned to CI');
