"""Prepares the reel symbol images (img/symbols/*.webp) from tools/art/source/.

    python3 tools/art/symbol_images.py

Each source image is trimmed to its visible pixels and placed on a transparent
reel-cell canvas (192x182 design px, exported at SCALE x) so that it covers
the same area as the symbol in the reference screenshot.
"""
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, 'source')
OUT = os.path.join(ROOT, 'img', 'symbols')

CELL_W, CELL_H = 192, 182
SCALE = 2.5

# Footprint of every symbol inside a reel cell, measured on the reference
# screenshot: (centre x, centre y, max width, max height) in design px.
BOXES = {
    'revolver': (96.5, 91.5, 116, 124),
    'gold': (96.5, 89.5, 114, 92),
    'diamond': (95.0, 90.75, 115, 87),
    'star': (97.0, 90.0, 131, 121),
    'bar': (94.5, 90.5, 146, 122),
    'seven': (96.5, 91.5, 132, 132),
    'statue': (94.5, 91.0, 150, 147),
}


def build(name, box):
    im = Image.open(os.path.join(SRC, name + '.webp')).convert('RGBA')
    bbox = im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
    im = im.crop(bbox)
    cx, cy, bw, bh = box
    k = min(bw / im.width, bh / im.height) * SCALE
    w, h = max(1, round(im.width * k)), max(1, round(im.height * k))
    im = im.resize((w, h), Image.LANCZOS)
    cell = Image.new('RGBA', (round(CELL_W * SCALE), round(CELL_H * SCALE)), (0, 0, 0, 0))
    cell.alpha_composite(im, (round(cx * SCALE - w / 2), round(cy * SCALE - h / 2)))
    path = os.path.join(OUT, name + '.webp')
    cell.save(path, 'WEBP', quality=90, method=6, alpha_quality=100)
    print(f'{name:9s} {w / SCALE:6.1f} x {h / SCALE:6.1f} design px -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path) // 1024} KiB)')


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, box in BOXES.items():
        build(name, box)


if __name__ == '__main__':
    main()
