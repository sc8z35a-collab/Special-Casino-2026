"""Builds the player icons, the chain lock and the car pictures.

    python3 tools/art/social_images.py

source/social/avatar-*.webp -> img/avatars/*.webp  (square, face centred)
source/social/chain.webp    -> img/ui/chain.webp   (lock overlay for the paid icons)
source/social/sale.webp     -> img/ui/sale.webp    (badge on paid icons the player does not own)
source/social/car-*.webp    -> img/cars/*.webp
"""
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, 'source', 'social')

# Keep head and collar. The first three portraits are 1230x1278 (face around
# x 615), the later ones 1254x1254 (face around x 627).
FIRST = (115, 40, 1115, 1040)
LATER = (127, 40, 1127, 1040)
AVATARS = {
    'bald': ('avatar-bald.webp', FIRST),
    'beard': ('avatar-beard.webp', FIRST),
    'red': ('avatar-red.webp', FIRST),
    'curly': ('avatar-curly.webp', LATER),
    'blond': ('avatar-blond.webp', LATER),
    'witch': ('avatar-witch.webp', LATER),
    'pumpkin': ('avatar-pumpkin.webp', LATER),
    'vampire': ('avatar-vampire.webp', LATER),
}
CARS = {'two-state-sedan': 'car-two-state.webp'}


def save(img, rel, quality=86):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, 'WEBP', quality=quality, method=6)
    print('wrote %s %dx%d (%d KiB)' % (rel, img.width, img.height, os.path.getsize(path) // 1024))


def trim(img):
    return img.crop(img.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())


def sale_badge(width=560):
    """The supplied cut-out has a ragged, holey white edge: rebuild the sticker
    from the red lettering (solid white rim, thin grey edge, soft shadow)."""
    src = Image.open(os.path.join(SRC, 'sale.webp')).convert('RGBA')
    a = np.asarray(src).astype(np.int16)
    red = (a[..., 3] > 128) & (a[..., 0] > 150) & (a[..., 1] < 90) & (a[..., 2] < 90)
    red = ndimage.binary_opening(red, iterations=1)
    yy, xx = np.nonzero(red)
    pad = 90
    box = (max(0, xx.min() - pad), max(0, yy.min() - pad), min(src.width, xx.max() + pad), min(src.height, yy.max() + pad))
    red = red[box[1]:box[3], box[0]:box[2]]
    disk = lambda r: (np.add.outer(np.arange(-r, r + 1) ** 2, np.arange(-r, r + 1) ** 2) <= r * r)
    rim = ndimage.binary_fill_holes(ndimage.binary_dilation(red, structure=disk(34)))
    edge = ndimage.binary_dilation(rim, structure=disk(4))
    h, w = red.shape
    out = np.zeros((h, w, 4), np.uint8)
    out[edge] = (200, 200, 205, 255)
    out[rim] = (255, 255, 255, 255)
    out[red] = (236, 6, 10, 255)
    sticker = Image.fromarray(out, 'RGBA').filter(ImageFilter.SMOOTH_MORE)
    shadow = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    shadow.putalpha(Image.fromarray((edge * 150).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14)))
    canvas = Image.new('RGBA', (w + 40, h + 40), (0, 0, 0, 0))
    canvas.alpha_composite(shadow, (20, 30))
    canvas.alpha_composite(sticker, (20, 20))
    canvas = trim(canvas)
    k = width / canvas.width
    return canvas.resize((width, round(canvas.height * k)), Image.LANCZOS)


def main():
    for key, (name, box) in AVATARS.items():
        img = Image.open(os.path.join(SRC, name)).convert('RGB').crop(box)
        save(img.resize((360, 360), Image.LANCZOS), 'img/avatars/%s.webp' % key)
    save(sale_badge(), 'img/ui/sale.webp', 90)
    chain = trim(Image.open(os.path.join(SRC, 'chain.webp')).convert('RGBA'))
    k = 760 / max(chain.size)
    save(chain.resize((round(chain.width * k), round(chain.height * k)), Image.LANCZOS), 'img/ui/chain.webp', 88)
    for key, name in CARS.items():
        car = trim(Image.open(os.path.join(SRC, name)).convert('RGBA'))
        k = 1200 / car.width
        save(car.resize((1200, round(car.height * k)), Image.LANCZOS), 'img/cars/%s.webp' % key, 86)


if __name__ == '__main__':
    main()
