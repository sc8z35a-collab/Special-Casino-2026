"""Builds the app icons (icons/icon-*.png) from the supplied 7 artwork.

    python3 tools/art/icons.py

icon-180/192/512: the 7 on the casino red with a gold rim (iOS / browsers);
icon-maskable-512: no rim and a smaller 7 inside the safe zone, for Android
launchers that crop icons to their own shape.
"""
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
S = 1024  # master size


def background():
    y, x = np.mgrid[0:S, 0:S] / S
    r = np.clip(np.hypot(x - 0.5, (y - 0.42) * 1.05) / 0.72, 0, 1)
    inner, mid, outer = np.array([122, 12, 24]), np.array([74, 5, 13]), np.array([42, 2, 6])
    t = r[..., None]
    rgb = np.where(t < 0.6, inner + (mid - inner) * (t / 0.6), mid + (outer - mid) * ((t - 0.6) / 0.4))
    return Image.fromarray(rgb.astype('uint8'), 'RGB').convert('RGBA')


def gold_frame(img):
    d = ImageDraw.Draw(img)
    for i, col in enumerate([(122, 82, 22), (233, 185, 86), (255, 240, 181), (214, 160, 66), (168, 114, 42)]):
        inset = 52 + i * 5
        d.rounded_rectangle([inset, inset, S - inset, S - inset], radius=128 - i * 4, outline=col, width=6)
    d.rounded_rectangle([92, 92, S - 92, S - 92], radius=96, outline=(243, 207, 125, 170), width=4)


def place_seven(icon, height):
    seven = Image.open(os.path.join(HERE, 'source', 'ui', 'app-seven.webp')).convert('RGBA')
    seven = seven.crop(seven.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())
    k = height / seven.height
    seven = seven.resize((round(seven.width * k), round(seven.height * k)), Image.LANCZOS)
    pos = ((S - seven.width) // 2 + 6, (S - seven.height) // 2 + 4)
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    shadow.paste((20, 0, 2, 170), (pos[0] + 8, pos[1] + 16), seven.getchannel('A'))
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(16)))
    icon.alpha_composite(seven, pos)
    return icon


def main():
    out = os.path.join(ROOT, 'icons')
    os.makedirs(out, exist_ok=True)
    icon = background()
    gold_frame(icon)
    place_seven(icon, 640)
    for size in (512, 192, 180):
        icon.convert('RGB').resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon-{size}.png'), optimize=True)
        print(f'wrote icons/icon-{size}.png')
    maskable = place_seven(background(), 500)
    maskable.convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon-maskable-512.png'), optimize=True)
    print('wrote icons/icon-maskable-512.png')


if __name__ == '__main__':
    main()
