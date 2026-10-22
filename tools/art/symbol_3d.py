"""The reel symbols from their 3D models (img/symbols/*.webp and the turns
img/symbols/turn/*.webp), from renders made by tools/3d/render-art.mjs:

    python3 tools/art/symbol_3d.py <renders folder>

The folder holds, for each symbol, <id>-base.png (1024 px, the reel's view:
turned 22 degrees, seen a little from above) and <id>-turn00.png ..
<id>-turn23.png (512 px, the same camera, a full turn in 15-degree steps;
turn00 is the reel's view). Every frame of a symbol has the one camera, so the
symbol keeps its size as it turns.

- img/symbols/<id>.webp: the still, placed in the reel cell like the 2D art
  was (tools/art/symbol_images.py: BOXES, SCALE)
- img/symbols/turn/<id>.webp: the turn, 24 frames in a 6 x 4 sheet; each frame
  is a cell TURN_PAD times the reel cell (the turned symbol may reach past
  it), at TURN_SCALE, the symbol placed exactly as in the still
"""
import os
import sys

from PIL import Image

from symbol_images import BOXES, CELL_W, CELL_H, SCALE, OUT, ROOT

FRAMES, COLS = 24, 6
TURN_SCALE = 1.25
TURN_PAD = 1.4


def alpha_box(im):
    return im.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()


def build(src, name, box):
    base = Image.open(os.path.join(src, name + '-base.png')).convert('RGBA')
    bx = alpha_box(base)
    cx, cy, bw, bh = box
    # the still: as the 2D art was placed (its visible part fitted in the box)
    k = min(bw / (bx[2] - bx[0]), bh / (bx[3] - bx[1]))   # design px per base px
    crop = base.crop(bx)
    w, h = round(crop.width * k * SCALE), round(crop.height * k * SCALE)
    cell = Image.new('RGBA', (round(CELL_W * SCALE), round(CELL_H * SCALE)), (0, 0, 0, 0))
    cell.alpha_composite(crop.resize((w, h), Image.LANCZOS), (round(cx * SCALE - w / 2), round(cy * SCALE - h / 2)))
    path = os.path.join(OUT, name + '.webp')
    cell.save(path, 'WEBP', quality=90, method=6, alpha_quality=100)

    # the turn: every frame with the still's own placement (the base is twice the frames' size)
    fw, fh = round(CELL_W * TURN_PAD * TURN_SCALE), round(CELL_H * TURN_PAD * TURN_SCALE)
    sheet = Image.new('RGBA', (fw * COLS, fh * (FRAMES // COLS)), (0, 0, 0, 0))
    kk = k * TURN_SCALE * base.width / 512
    # where the base image's middle lands in a frame (design px of the cell, then the padded frame)
    mid_x = cx + ((base.width / 2) - (bx[0] + bx[2]) / 2) * k
    mid_y = cy + ((base.height / 2) - (bx[1] + bx[3]) / 2) * k
    pad_x, pad_y = CELL_W * (TURN_PAD - 1) / 2, CELL_H * (TURN_PAD - 1) / 2
    for i in range(FRAMES):
        fr = Image.open(os.path.join(src, f'{name}-turn{i:02d}.png')).convert('RGBA')
        s = round(fr.width * kk)
        fr = fr.resize((s, s), Image.LANCZOS)
        one = Image.new('RGBA', (fw, fh), (0, 0, 0, 0))
        one.alpha_composite(fr, (round((mid_x + pad_x) * TURN_SCALE - s / 2), round((mid_y + pad_y) * TURN_SCALE - s / 2)))
        sheet.paste(one, ((i % COLS) * fw, (i // COLS) * fh))
    os.makedirs(os.path.join(OUT, 'turn'), exist_ok=True)
    tpath = os.path.join(OUT, 'turn', name + '.webp')
    sheet.save(tpath, 'WEBP', quality=82, method=6, alpha_quality=90)
    print(f'{name:9s} {w / SCALE:6.1f} x {h / SCALE:6.1f} design px -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path) // 1024} KiB), '
          f'turn {sheet.width}x{sheet.height} ({os.path.getsize(tpath) // 1024} KiB)')


def main():
    src = sys.argv[1]
    for name, box in BOXES.items():
        build(src, name, box)


if __name__ == '__main__':
    main()
