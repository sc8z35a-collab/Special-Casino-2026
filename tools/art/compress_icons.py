"""Compress UI icons from a fixed git source, never from a previous lossy run.

Usage: python3 tools/art/compress_icons.py --ref <source-commit>
Requires Pillow. Wallpaper originals, backgrounds, animation sheets and frames are excluded.
Native/PWA PNG icon dimensions remain exactly those declared by their manifests.
"""
import argparse
import io
import json
import subprocess
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
EXCLUDE = {'bg', 'home', 'background', 'maintenance', 'title', 'reel-frame', 'reel-back',
           'frame', 'fire', 'fever', 'fever-banner', 'combo', 'combo-rainbow'}

def paths():
    files = set()
    for name in ('img/ui', 'img/avatars', 'img/items', 'img/vip', 'img/symbols/lowpoly'):
        files.update(p for p in (ROOT / name).rglob('*.webp')
                     if p.stem not in EXCLUDE and 'quest-tiers' not in p.parts)
    files.update(p for p in (ROOT / 'ops/assets').glob('*.webp') if not p.stem.startswith('wallpaper'))
    files.add(ROOT / 'img/tree/seed.webp')
    files.update((ROOT / 'icons').glob('*.png'))
    files.update((ROOT / 'ops/assets').glob('site-*.png'))
    files.update((ROOT / 'app/android/app/src/main/res').rglob('*.png'))
    return sorted(files)

def limit(path, size):
    if path.startswith('img/avatars/'): return 112
    if path.startswith('img/symbols/'): return 192
    if path.startswith('img/vip/'): return 256
    if path.startswith('ops/assets/'): return 128
    if size[1] <= 48: return max(size)  # keep the tiny PRO/ULTRA lettering intact
    return 96 if max(size) <= 128 else 128 if max(size) <= 192 else 160

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', required=True)
    args = parser.parse_args()
    rows = []
    for path in paths():
        relative = path.relative_to(ROOT).as_posix()
        original = subprocess.check_output(['git', 'show', args.ref + ':' + relative], cwd=ROOT)
        image = Image.open(io.BytesIO(original)).convert('RGBA')
        before_size = image.size
        encoded = io.BytesIO()
        if path.suffix == '.png':
            image.quantize(colors=64, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(encoded, 'PNG', optimize=True)
        else:
            side = limit(relative, image.size)
            image.thumbnail((side, side), Image.Resampling.LANCZOS)
            image.save(encoded, 'WEBP', quality=45, alpha_quality=70, method=6)
        data = encoded.getvalue()
        if len(data) >= len(original) * .98:
            data = original
        with Image.open(io.BytesIO(data)) as check:
            check.load()
            after_size = check.size
            if path.suffix == '.png' and check.size != before_size:
                raise ValueError('Native icon dimensions changed: ' + relative)
        temporary = path.with_suffix(path.suffix + '.tmp')
        temporary.write_bytes(data)
        temporary.replace(path)
        rows.append({'path': relative, 'beforeBytes': len(original), 'afterBytes': len(data),
                     'beforeSize': list(before_size), 'afterSize': list(after_size)})
    before = sum(r['beforeBytes'] for r in rows)
    after = sum(r['afterBytes'] for r in rows)
    report = {'baselineCommit': args.ref, 'files': len(rows), 'beforeBytes': before, 'afterBytes': after,
              'reductionPercent': round((1 - after / before) * 100, 2), 'images': rows}
    (ROOT / 'docs/icons-compression.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'images'}))

if __name__ == '__main__':
    main()
