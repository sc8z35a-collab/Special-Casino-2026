"""Import October UI attachments and compress runtime pictures for their display sizes.

Usage: python tools/art/import_refresh.py /path/to/attachments
Preserves transparency; does not recolour the supplied artwork.
"""
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import label

ROOT = Path(__file__).resolve().parents[2]
ASSETS = {
    '名称未設定のデザイン (3)(3).png': ('home', (960, 540)),
    '名称未設定のデザイン (9)(2).png': ('background', (960, 540)),
    '名称未設定のデザイン (20)(1).png': ('info', (192, 192)),
    '名称未設定のデザイン (6)(3).png': ('token', (192, 192)),
    '名称未設定のデザイン (7)(3).png': ('plus', (128, 128)),
    '名称未設定のデザイン (8)(1).png': ('minus', (128, 128)),
    '名称未設定のデザイン(6).png': ('car', (192, 192)),
    '名称未設定のデザイン (22)(1).png': ('guide', (192, 192)),
    '名称未設定のデザイン (13)(1).png': ('feedback', (192, 192)),
    '名称未設定のデザイン (31).png': ('vip', (256, 112)),
    '名称未設定のデザイン (12).png': ('investment', (192, 192)),
    '名称未設定のデザイン (15)(2).png': ('diary', (192, 192)),
    '名称未設定のデザイン (11)(1).png': ('dev', (144, 72)),
    'ローポリアイコン (4)(1).png': ('charm', (128, 160)),
    'ただいまメンテナンス中です画面.png': ('maintenance', (960, 540)),
}


def encode(im, path, quality=66):
    options = []
    for lossless in (False, True):
        out = io.BytesIO()
        im.save(out, 'WEBP', quality=quality, lossless=lossless, method=6,
                alpha_quality=95, exact=True)
        options.append(out.getvalue())
    data = min(options, key=len)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return len(data)


def icon(im, size):
    im = im.convert('RGBA')
    im = im.crop(im.getchannel('A').getbbox())
    im.thumbnail((round(size[0] * .96), round(size[1] * .96)), Image.Resampling.LANCZOS)
    out = Image.new('RGBA', size)
    out.alpha_composite(im, ((size[0] - im.width) // 2, (size[1] - im.height) // 2))
    return out


def warp(im):
    # Match every supplied divider to the game's existing 5x3 reel geometry.
    xs, tx = [0, 134, 274, 419, 560, 706, 855, 960], [0, 79, 282, 485, 688, 891, 1085, 1164]
    ys, ty = [0, 91, 212, 337, 454, 540], [0, 73, 259, 445, 627, 700]
    out = Image.new('RGBA', (1164, 700))
    for x in range(len(xs) - 1):
        for y in range(len(ys) - 1):
            tile = im.crop((xs[x], ys[y], xs[x+1], ys[y+1]))
            tile = tile.resize((tx[x+1] - tx[x], ty[y+1] - ty[y]), Image.Resampling.LANCZOS)
            out.paste(tile, (tx[x], ty[y]))
    return out


def main():
    source = Path(sys.argv[1])
    report = []
    for name, (key, size) in ASSETS.items():
        file = source / name
        im = Image.open(file).convert('RGBA')
        if key in ('home', 'background', 'maintenance'):
            im = im.convert('RGB').resize(size, Image.Resampling.LANCZOS)
        else:
            im = icon(im, size)
        path = ROOT / ('img/ui/refresh/' + key + '.webp')
        n = encode(im, path, 72 if key == 'maintenance' else 66)
        report.append(dict(path=str(path.relative_to(ROOT)), before=file.stat().st_size, after=n))

    frame = Image.open(source / '名称未設定のデザイン (5)(2).png').convert('RGBA')
    # Cream cells are behind the reel symbols; only their wooden borders go in front.
    rgb = np.asarray(frame).copy()
    panels = (rgb[:, :, 0] > 150) & (rgb[:, :, 1] > 145) & (rgb[:, :, 2] > 140)
    panels &= np.max(rgb[:, :, :3], axis=2).astype(int) - np.min(rgb[:, :, :3], axis=2) < 38
    regions, _ = label(panels)
    ids = [regions[y, x] for y in (145, 265, 390) for x in (200, 350, 490, 635, 780)]
    rgb[np.isin(regions, [i for i in ids if i]), 3] = 0
    front = warp(Image.fromarray(rgb))
    back = warp(frame).crop((79, 73, 1085, 627))
    encode(front, ROOT / 'img/ui/refresh/reel-frame.webp', 72)
    encode(back, ROOT / 'img/ui/refresh/reel-back.webp', 64)

    # Keep the payout/save id 'statue'; replace only its visible artwork.
    coin = Image.open(source / '名称未設定のデザイン (4)(3).png').convert('RGBA')
    coin = coin.crop(coin.getchannel('A').getbbox())
    coin.thumbnail((264, 264), Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (384, 364))
    cell.alpha_composite(coin, ((384 - coin.width) // 2, (364 - coin.height) // 2))
    encode(cell, ROOT / 'img/symbols/lowpoly/statue.webp', 68)

    # Compress shipped runtime pictures, including all home buttons and avatars.
    for folder, limit in [('img/symbols/lowpoly', (288, 273)), ('img/avatars', (160, 160)),
                          ('img/ui/lowpoly', (256, 256)), ('img/items/lowpoly', (192, 192)),
                          ('img/ui/quest-tiers', (384, 160)), ('img/vip', (384, 160)),
                          ('img/cars', (640, 400))]:
        for path in sorted((ROOT / folder).glob('*.webp')):
            if path.stem in ('title', 'bg'):
                continue
            before = path.read_bytes()
            im = Image.open(io.BytesIO(before)).convert('RGBA')
            im.thumbnail(limit, Image.Resampling.LANCZOS)
            n = encode(im, path, 52 if folder == 'img/symbols/lowpoly' else 64)
            if n >= len(before):
                path.write_bytes(before)
                continue
            report.append(dict(path=str(path.relative_to(ROOT)), before=len(before), after=n))
    # Wallet pictures and shared home artwork are outside lowpoly/.
    for rel, limit in [('img/ui/chip.webp', (128, 128)),
                       ('img/ui/coin.webp', (128, 128)),
                       ('img/ui/dollar.webp', (128, 128)),
                       ('img/ui/chip-pile.webp', (480, 262)),
                       ('img/ui/frame.webp', (160, 160)),
                       ('img/ui/garage.webp', (128, 128)),
                       ('img/ui/login-bonus.webp', (960, 318))]:
        path = ROOT / rel
        before = path.read_bytes()
        im = Image.open(io.BytesIO(before)).convert('RGBA')
        im.thumbnail(limit, Image.Resampling.LANCZOS)
        n = encode(im, path, 64)
        if n >= len(before):
            path.write_bytes(before)
            continue
        report.append(dict(path=rel, before=len(before), after=n))
    dst = ROOT / 'docs/ui-refresh-compression.json'
    dst.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'files': len(report), 'before': sum(x['before'] for x in report),
                      'after': sum(x['after'] for x in report)}))


if __name__ == '__main__':
    main()
