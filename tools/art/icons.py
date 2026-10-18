"""Builds the app icons (icons/icon-*.png) from the supplied 7 artwork.

    python3 tools/art/icons.py

The 7 fills the icon. icon-180/192/512 (iOS / browsers): the 7 almost edge
to edge on the casino red; icon-maskable-512 and the Android app's adaptive
icon: as big as the launcher's safe circle allows (the 7 is placed by its
smallest enclosing circle, so no launcher shape cuts into it);
app/android/.../mipmap-*: legacy square, adaptive background / foreground
and the monochrome layer for themed icons.
"""
import os

import cv2
import numpy as np
from PIL import Image, ImageFilter

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


def load_seven():
    seven = Image.open(os.path.join(HERE, 'source', 'ui', 'app-seven.webp')).convert('RGBA')
    return seven.crop(seven.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())


def enclosing(seven):
    """Centre and radius of the smallest circle around the 7 (source px)."""
    mask = (np.asarray(seven.getchannel('A')) > 40).astype(np.uint8)
    pts = cv2.findNonZero(mask)
    (cx, cy), r = cv2.minEnclosingCircle(pts)
    return cx, cy, r


def sized_seven(height=None, circle=None):
    """The 7 scaled to a height, or so that its enclosing circle has the given
    diameter; returns it with the offset of its anchor point."""
    seven = load_seven()
    if circle:
        cx, cy, r = enclosing(seven)
        k = circle / (2 * r)
    else:
        k = height / seven.height
        cx, cy = seven.width / 2, seven.height / 2
    img = seven.resize((round(seven.width * k), round(seven.height * k)), Image.LANCZOS)
    return img, (cx * k, cy * k)


def place_seven(icon, height=None, circle=None, shadow=True):
    seven, (ax, ay) = sized_seven(height, circle)
    pos = (round(S / 2 - ax), round(S / 2 - ay))
    if shadow:
        sh = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        sh.paste((20, 0, 2, 170), (pos[0] + 8, pos[1] + 14), seven.getchannel('A'))
        icon.alpha_composite(sh.filter(ImageFilter.GaussianBlur(14)))
    icon.alpha_composite(seven, pos)
    return icon


# Android density buckets: legacy icon 48dp, adaptive layers 108dp
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
ANDROID_RES = os.path.join(ROOT, 'app', 'android', 'app', 'src', 'main', 'res')
# adaptive icons: every launcher shape shows at least the middle 66dp circle of 108dp
ADAPTIVE_SAFE = S * 66 / 108


def android_icons(legacy):
    bg = background()
    fg = place_seven(Image.new('RGBA', (S, S), (0, 0, 0, 0)), circle=ADAPTIVE_SAFE)
    seven, (ax, ay) = sized_seven(circle=ADAPTIVE_SAFE)
    mono = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    mono.paste((255, 255, 255, 255), (round(S / 2 - ax), round(S / 2 - ay)), seven.getchannel('A'))
    for name, f in DENSITIES.items():
        d = os.path.join(ANDROID_RES, 'mipmap-' + name)
        os.makedirs(d, exist_ok=True)
        legacy.convert('RGB').resize((round(48 * f), round(48 * f)), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'), optimize=True)
        n = round(108 * f)
        bg.convert('RGB').resize((n, n), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_background.png'), optimize=True)
        fg.resize((n, n), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'), optimize=True)
        mono.resize((n, n), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_monochrome.png'), optimize=True)
    print('wrote app/android/app/src/main/res/mipmap-*/ic_launcher*.png')


def main():
    out = os.path.join(ROOT, 'icons')
    os.makedirs(out, exist_ok=True)
    # iOS rounds the corners itself: the 7 almost touches the edges
    icon = place_seven(background(), height=S * 0.82)
    for size in (512, 192, 180):
        icon.convert('RGB').resize((size, size), Image.LANCZOS).save(os.path.join(out, f'icon-{size}.png'), optimize=True)
        print(f'wrote icons/icon-{size}.png')
    # maskable: safe zone is the middle circle of 80 %
    maskable = place_seven(background(), circle=S * 0.8)
    maskable.convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(out, 'icon-maskable-512.png'), optimize=True)
    print('wrote icons/icon-maskable-512.png')
    android_icons(icon)


if __name__ == '__main__':
    main()
