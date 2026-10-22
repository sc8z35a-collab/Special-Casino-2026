"""The reel window from its 3D model (スロットの枠): a render of it straight
on (tools/3d/render-art.mjs, 2400 x 1280, orthographic) becomes

- img/ui/reel-frame.webp: the gold frame and the gold bars between the reels,
  over the reels (the five panels cut out), for the 1044 x 586 window (#reels)
- img/ui/reel-back.webp: the cream panels behind the symbols, for the reel
  canvas inside it (1006 x 554 at 19, 16)

both at 2x. The model was made for this window: its panels fall on the reels
and its row seams on the rows (a few px off at most).

    python3 tools/art/reel_frame_3d.py <render.png>
"""
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'img', 'ui')
K = 2
WIN_W, WIN_H = 1044, 586
CANVAS = (19, 16, 1006, 554)


def runs(v, th):
    out, s = [], None
    for i, x in enumerate(v):
        if x > th and s is None:
            s = i
        if x <= th and s is not None:
            out.append((s, i - 1))
            s = None
    if s is not None:
        out.append((s, len(v) - 1))
    return out


def main():
    src = Image.open(sys.argv[1]).convert('RGBA')
    a = np.array(src).astype(int)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    # the panels: cream (bright, hardly any yellow), in five columns
    cream = (al > 200) & (r > 200) & (g > 200) & (b > 190) & ((r - b) < 40)
    cols = [c for c in runs(cream.mean(axis=0), 0.5) if c[1] - c[0] > src.width * 0.1]
    rows = [c for c in runs(cream.mean(axis=1), 0.3) if c[1] - c[0] > src.height * 0.5]
    assert len(cols) == 5 and len(rows) == 1, (cols, rows)
    W, H = WIN_W * K, WIN_H * K
    sx, sy = W / src.width, H / src.height
    big = src.resize((W, H), Image.LANCZOS)
    # the frame: the panels cut out (soft by a pixel)
    mask = Image.new('L', (W, H), 255)
    m = np.array(mask)
    y0, y1 = round(rows[0][0] * sy), round((rows[0][1] + 1) * sy)
    for c0, c1 in cols:
        m[y0:y1, round(c0 * sx):round((c1 + 1) * sx)] = 0
    mask = Image.fromarray(m).filter(ImageFilter.GaussianBlur(0.8))
    frame = big.copy()
    frame.putalpha(Image.fromarray(np.minimum(np.array(big.getchannel('A')), np.array(mask))))
    os.makedirs(OUT, exist_ok=True)
    frame.save(os.path.join(OUT, 'reel-frame.webp'), 'WEBP', quality=88, method=6, alpha_quality=100)
    # the panels behind the reels
    x, y, w, h = CANVAS
    back = big.crop((x * K, y * K, (x + w) * K, (y + h) * K)).convert('RGB')
    back.save(os.path.join(OUT, 'reel-back.webp'), 'WEBP', quality=88, method=6)
    for n in ('reel-frame.webp', 'reel-back.webp'):
        p = os.path.join(OUT, n)
        print('wrote %s (%d KiB)' % (os.path.relpath(p, ROOT), os.path.getsize(p) // 1024))
    print('panels (window px):', [(round(c0 * sx / K, 1), round((c1 + 1) * sx / K, 1)) for c0, c1 in cols], 'rows', round(y0 / K, 1), round(y1 / K, 1))


if __name__ == '__main__':
    main()
