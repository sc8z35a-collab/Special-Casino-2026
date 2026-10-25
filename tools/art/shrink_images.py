"""Makes the game's pictures (img/**/*.webp, icons/*.png) smaller still, in place.

    python3 tools/art/shrink_images.py

Each WebP is saved again at a lower quality only when the picture stays close to
what it was (PSNR 36 dB or better) and the file gets at least 8% smaller. The two
sprite sheets that are drawn far smaller than they are (the flames and the 3D turn
of each symbol; their frames are measured from the picture's own size) are scaled
to three quarters. PNGs are only optimised, without losing anything. Run it once:
every run takes a little more quality away. Then `node tools/stamp.mjs`.
"""
import glob, io, math, os
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SHEETS = {'img/ui/fire.webp': (1440, 774), }
for n in ('bar', 'diamond', 'gold', 'revolver', 'seven', 'star', 'statue'):
    SHEETS['img/symbols/turn/%s.webp' % n] = (1512, 952)


def psnr(a, b):
    a = np.asarray(a.convert('RGBA'), dtype=np.float64)
    b = np.asarray(b.convert('RGBA'), dtype=np.float64)
    w = (a[..., 3:4] + b[..., 3:4]) / 510.0
    m = (((a - b) ** 2) * w).sum() / max(1.0, w.sum() * 4)
    return 99 if m == 0 else 10 * math.log10(255 * 255 / m)


def save(im, q):
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=q, method=6, alpha_quality=min(100, q + 15))
    return buf.getvalue()


before = after = 0
for path in sorted(glob.glob(os.path.join(ROOT, 'img/**/*.webp'), recursive=True)):
    rel = os.path.relpath(path, ROOT)
    raw = open(path, 'rb').read()
    im = Image.open(io.BytesIO(raw))
    if getattr(im, 'is_animated', False):
        continue
    im = im.convert('RGBA')
    best = None
    if rel in SHEETS:
        small = im.resize(SHEETS[rel], Image.LANCZOS)
        best = save(small, 60)
    else:
        for q in (60, 68, 75):
            data = save(im, q)
            if len(data) < len(raw) * 0.92 and psnr(im, Image.open(io.BytesIO(data))) >= 36:
                best = data
                break
    before += len(raw)
    if best and len(best) < len(raw):
        open(path, 'wb').write(best)
        after += len(best)
    else:
        after += len(raw)

png_before = png_after = 0
for path in sorted(glob.glob(os.path.join(ROOT, 'icons/*.png'))):
    raw = open(path, 'rb').read()
    im = Image.open(io.BytesIO(raw))
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    png_before += len(raw)
    if len(buf.getvalue()) < len(raw):
        open(path, 'wb').write(buf.getvalue())
        png_after += len(buf.getvalue())
    else:
        png_after += len(raw)
print('webp %d -> %d bytes, png %d -> %d bytes' % (before, after, png_before, png_after))
