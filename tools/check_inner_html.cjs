/* Guard the eight reviewed DOM sinks without changing application code.
   node tools/check_inner_html.cjs [--self-test]
   Uses Node built-ins only, like the other tools/check_*.cjs checks. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.html', '.htm', '.svg']);

// Exact snippets and one occurrence each: a file-wide exception or a count
// alone could silently allow a new sink. Source expressions must be reviewed.
const ALLOWED = [
  { file: 'js/render/fx.js', code: "this.sun.innerHTML = '';", reason: 'Clear a static sprite container' },
  { file: 'js/render/fx.js', code: "bm.innerHTML = '';", reason: 'Clear a static beam container' },
  { file: 'js/render/fx.js', code: "slot.innerHTML = '';", reason: 'Clear a static title container' },
  { file: 'js/main.js', code: 'frameImg.onerror = function () { rf.innerHTML = BR.UISVG.reelFrame(); };',
    reason: 'Locally generated reel-frame SVG (js/art/ui-svg.js)' },
  { file: 'js/main.js', code: `box.innerHTML = '<span id="win-value" class="win-text"></span>';`,
    reason: 'Static WIN markup' },
  { file: 'js/main.js', code: `box.innerHTML = '<span id="win-value" class="win-amount"><i class="ic ic-chip"></i><span class="win-num"></span></span>';`,
    reason: 'Static WIN amount markup; numbers later use textContent' },
  { file: 'js/ui/screens.js', code: `card.innerHTML =
          '<div class="pc-img"><img alt="" src="' + BR.SYMBOL_IMG[sym] + '"></div>' + hubTag +
          '<div class="pc-prob">確率: <b>' + prob + '%</b></div>' +
          '<div class="pc-counts">' + counts.map(function (c) { return '<div>' + c + '/5</div>'; }).join('') + '</div>' +
          '<div class="pc-div"></div>' +
          '<div class="pc-mults">' + counts.map(function (c) {
            return '<div><i class="ic ic-chip"></i>x' + U.fmtMult(pays[c]) + '</div>';
          }).join('') + '</div>';`,
    reason: 'Bundled symbol artwork and local numeric rules, never player data' },
  { file: 'js/ui/feedback.js', code: 'offer.innerHTML = OFFER_SVG;', reason: 'Locally defined static SVG constant' }
];

function sources(root) {
  const out = new Map();
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = dir + '/' + entry.name;
      if (entry.isDirectory()) walk(rel);
      else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        assert.ok(entry.isFile(), `Source must be a regular file: ${rel}`);
        out.set(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
      }
    }
  }
  walk('js'); walk('ops');
  return out;
}

function check(files) {
  const errors = [], spans = new Map();
  for (const entry of ALLOWED) {
    const source = files.get(entry.file) || '', at = source.indexOf(entry.code);
    if (at < 0 || source.indexOf(entry.code, at + 1) >= 0) {
      errors.push(`${entry.file}: reviewed snippet is missing, changed or duplicated (${entry.reason})`);
      continue;
    }
    if (!spans.has(entry.file)) spans.set(entry.file, []);
    spans.get(entry.file).push([at, at + entry.code.length]);
  }
  let count = 0;
  for (const [file, source] of files) {
    // Deliberately conservative: also finds bracket notation and literal
    // mentions in source comments/strings. No vendor-directory exemptions.
    for (const match of source.matchAll(/\binnerHTML\b/g)) {
      count++;
      const allowed = (spans.get(file) || []).some(([a, b]) => match.index >= a && match.index + match[0].length <= b);
      if (!allowed) errors.push(`${file}:${source.slice(0, match.index).split('\n').length}: unreviewed innerHTML; use textContent`);
    }
  }
  if (count !== ALLOWED.length) errors.push(`Expected ${ALLOWED.length} reviewed occurrences, found ${count}`);
  return errors;
}

function selfTest(files) {
  const reject = (file, code) => {
    const changed = new Map(files);
    changed.set(file, (changed.get(file) || '') + '\n' + code);
    assert.ok(check(changed).length, `Must reject ${file}: ${code}`);
  };
  reject('js/new-feature.js', 'node.innerHTML = user.name;');
  reject('ops/new-feature.html', '<script>node["innerHTML"] = message;</script>');
  reject('js/vendor/new-vendor.js', 'node.innerHTML = data;');
  reject('js/main.js', "box.innerHTML = '<span id=\"win-value\" class=\"win-text\"></span>';");
  const changed = new Map(files);
  changed.set('js/main.js', changed.get('js/main.js').replace('rf.innerHTML = BR.UISVG.reelFrame()', 'rf.innerHTML = player.name'));
  assert.ok(check(changed).length, 'An existing reviewed expression cannot become user data');
  const safe = new Map(files);
  safe.set('ops/new-feature.js', 'node.textContent = user.name;');
  assert.deepEqual(check(safe), [], 'Safe text rendering must remain allowed');
  safe.set('js/main.js', '\n\n' + safe.get('js/main.js'));
  assert.deepEqual(check(safe), [], 'Unrelated line shifts must not invalidate the allowlist');
  console.log('PASS 7 guard self-checks (new sinks, bracket syntax, vendor files, duplicate/mutated exceptions, safe text, line shifts)');
}

if (require.main === module) {
  const files = sources(ROOT), errors = check(files);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else {
    console.log(`PASS ${ALLOWED.length} reviewed DOM sinks across ${files.size} source files`);
    if (process.argv.includes('--self-test')) selfTest(files);
  }
}
module.exports = { ALLOWED, check, sources };
