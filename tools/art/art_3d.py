"""The 3D renders (tools/3d/render-art.mjs) made into the game's art:

    python3 tools/art/art_3d.py <renders folder>

- tools/art/source/ui/{chip,coin,dollar,chip-pile,app-seven}.webp: the
  sources of the wallet icons, the chip pile and the app's 7 (then
  tools/art/ui_images.py and tools/art/icons.py make the game's files)
- img/ui/combo.webp, combo-rainbow.webp: COMBO in 3D lettering. The models
  spell COMB: their own O follows the B (cut out of the render by its round
  shape, behind the B as the letters overlap)
- img/ui/fever.webp, fever-banner.webp: FEVER and FEVER!! in 3D lettering
- img/ui/fire.webp: the fire's 24 frames in a 4 x 6 sheet (js/render/fire3d.js)
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
UI = os.path.join(ROOT, 'img', 'ui')
SRC = os.path.join(HERE, 'source', 'ui')


def trim(im):
    return im.crop(im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())


def save(im, path, quality=88, alpha=95):
    im.save(path, 'WEBP', quality=quality, method=6, alpha_quality=alpha)
    print('wrote %s %dx%d (%d KiB)' % (os.path.relpath(path, ROOT), im.width, im.height, os.path.getsize(path) // 1024))


def height(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


# the O between the C and the M (columns c0..c1), after the B
def combo(render, c0, c1=978):
    im = Image.open(render).convert('RGBA')
    a = np.array(im.getchannel('A')) > 8
    ys = np.where(a[:, 600:900].any(axis=1))[0]
    top, bot = ys[0], ys[-1]
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).ellipse((c0 - 6, top - 4, c1 + 6, bot + 4), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(2))
    o = im.copy()
    o.putalpha(Image.fromarray(np.minimum(np.array(im.getchannel('A')), np.array(m))))
    o = o.crop((c0 - 8, 0, c1 + 8, im.height))
    right = np.where(a.any(axis=0))[0][-1]
    out = Image.new('RGBA', (right + o.width + 20, im.height), (0, 0, 0, 0))
    out.alpha_composite(o, (right - 34, 0))
    out.alpha_composite(im.crop((0, 0, right + 1, im.height)), (0, 0))
    return trim(out)


def main():
    src = sys.argv[1]
    for n in ('chip', 'coin', 'dollar', 'chip-pile', 'app-seven'):
        im = trim(Image.open(os.path.join(src, f'ui-{n}.png')).convert('RGBA'))
        im.save(os.path.join(SRC, n + '.webp'), 'WEBP', lossless=True, exact=True)
        print('wrote', os.path.relpath(os.path.join(SRC, n + '.webp'), ROOT))
    save(height(combo(os.path.join(src, 'combo-front.png'), 480), 150), os.path.join(UI, 'combo.webp'))
    save(height(combo(os.path.join(src, 'combo-rainbow-front.png'), 500), 150), os.path.join(UI, 'combo-rainbow.webp'))
    save(height(trim(Image.open(os.path.join(src, 'fever-word.png')).convert('RGBA')), 220), os.path.join(UI, 'fever.webp'))
    save(height(trim(Image.open(os.path.join(src, 'fever-banner.png')).convert('RGBA')), 240), os.path.join(UI, 'fever-banner.webp'))
    cols, w, h = 4, 384, 192
    sheet = Image.new('RGBA', (cols * w, 6 * h), (0, 0, 0, 0))
    for i in range(24):
        f = Image.open(os.path.join(src, 'fire', f'f{i:02d}.png')).convert('RGBA').resize((w, h), Image.LANCZOS)
        sheet.paste(f, ((i % cols) * w, (i // cols) * h))
    save(sheet, os.path.join(UI, 'fire.webp'), 72, 75)


if __name__ == '__main__':
    main()
