"""The 3D renders (tools/3d/render-art.mjs) made into the game's art:

    python3 tools/art/art_3d.py <renders folder>

- tools/art/source/ui/{chip,coin,dollar,garage,chip-pile,app-seven}.webp:
  the sources of the wallet icons, the garage coin, the chip pile and the
  app's 7 (then tools/art/ui_images.py and tools/art/icons.py make the game's
  files)
- img/ui/combo.webp, combo-rainbow.webp: COMBO in 3D lettering. The models
  spell COMB: their own O follows the B (cut out of the render by its round
  shape, behind the B as the letters overlap)
- img/ui/fever.webp, fever-banner.webp: the rainbow FEVER (the sign, the banner)
- img/ui/fire.webp: the fire's 24 frames in a 4 x 6 sheet (js/render/fire3d.js):
  the model's row of flames, set moving (waves rising through it, its tongues
  stretching and shrinking) in a loop
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

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


# the fire's frames: FRAMES of FW x FH, COLS to a row
FRAMES, COLS, FW, FH = 24, 4, 480, 172


def fire(render):
    im = trim(Image.open(render).convert('RGBA'))
    W, H = FW * 2, FH * 2
    a = np.asarray(im.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
    rgb, al = a[..., :3], a[..., 3:]
    # the white the model was cut from shows grey at the tips: warmed into the flame
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    pale = np.clip((0.16 - (rgb.max(-1) - rgb.min(-1))) / 0.16, 0, 1)[..., None]
    warm = np.stack([np.minimum(1, lum * 1.12 + 0.05), lum * 0.8, lum * 0.42], -1)
    rgb = rgb * (1 - pale) + warm * pale
    m = rgb.mean(-1, keepdims=True)
    rgb = np.clip(m + (rgb - m) * 1.2, 0, 1)
    pm = np.concatenate([rgb * al, al], -1)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    u, v = xx / W, yy / H
    h = 1 - v
    P = 2 * np.pi
    sheet = Image.new('RGBA', (COLS * FW, FRAMES // COLS * FH), (0, 0, 0, 0))
    for k in range(FRAMES):
        f = P * k / FRAMES
        # waves rising through it (more towards the tips), the tongues stretching and shrinking
        dx = W * h ** 1.4 * (0.011 * np.sin(P * 3.1 * u + P * 2 * v + f) + 0.006 * np.sin(P * 7.3 * u + P * 3 * v + 2 * f + 1.1) +
                             0.0035 * np.sin(P * 13 * u + P * 5 * v + 3 * f + 2.3))
        dy = H * h ** 1.2 * (0.035 * np.sin(P * 4.3 * u + 2 * f) + 0.02 * np.sin(P * 9.7 * u + 3 * f + 1.3))
        out = np.stack([ndi.map_coordinates(pm[..., c], [yy + dy, xx + dx], order=1, mode='constant') for c in range(4)], -1)
        out[..., :3] *= (1 + 0.07 * np.sin(P * 2.2 * u + f) * h)[..., None]
        al = np.clip(out[..., 3:], 0, 1)
        fr = np.concatenate([np.clip(out[..., :3] / np.maximum(al, 1e-4), 0, 1), al], -1)
        frame = Image.fromarray((fr * 255 + 0.5).astype(np.uint8), 'RGBA').resize((FW, FH), Image.LANCZOS)
        sheet.paste(frame, ((k % COLS) * FW, (k // COLS) * FH))
    return sheet


def main():
    src = sys.argv[1]
    for n in ('chip', 'coin', 'dollar', 'garage', 'chip-pile', 'app-seven'):
        im = trim(Image.open(os.path.join(src, f'ui-{n}.png')).convert('RGBA'))
        im.save(os.path.join(SRC, n + '.webp'), 'WEBP', lossless=True, exact=True)
        print('wrote', os.path.relpath(os.path.join(SRC, n + '.webp'), ROOT))
    save(height(combo(os.path.join(src, 'combo-front.png'), 480), 150), os.path.join(UI, 'combo.webp'))
    save(height(combo(os.path.join(src, 'combo-rainbow-front.png'), 500), 150), os.path.join(UI, 'combo-rainbow.webp'))
    save(height(trim(Image.open(os.path.join(src, 'fever-word.png')).convert('RGBA')), 220), os.path.join(UI, 'fever.webp'))
    save(height(trim(Image.open(os.path.join(src, 'fever-banner.png')).convert('RGBA')), 240), os.path.join(UI, 'fever-banner.webp'))
    save(fire(os.path.join(src, 'fire.png')), os.path.join(UI, 'fire.webp'), 72, 75)


if __name__ == '__main__':
    main()
