"""Import the supplied low-poly UI and reel artwork without changing its design.

    python3 tools/art/import_supplied.py /path/to/attachments

Transparent margins are trimmed, icons are fitted without stretching, and reel
art keeps the existing 192x182 cell coordinates. Export at up to 3x display
resolution. Pick the smallest WebP whose decoded image meets the display-size
SSIM / PSNR limits, or use lossless WebP when that is smaller.
"""
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[2]
# source filename, output, canvas size, maximum display size for compression QA
ASSETS = [
    ('名称未設定のデザイン (32).png', 'img/vip/vip-0.webp', (512, 200), (280, 108)),
    ('名称未設定のデザイン (1)(2).png', 'img/vip/vip-1.webp', (512, 200), (280, 108)),
    ('名称未設定のデザイン (27).png', 'img/vip/vip-2.webp', (512, 200), (280, 108)),
    ('名称未設定のデザイン (29).png', 'img/vip/vip-3.webp', (512, 200), (280, 108)),
    ('名称未設定のデザイン (28)(1).png', 'img/vip/vip-3.1.webp', (512, 200), (280, 108)),
    ('名称未設定のデザイン (26).png', 'img/vip/vip-4.webp', (512, 200), (280, 108)),
    ('名称未設定のデザイン (34).png', 'img/ui/lowpoly/menu.webp', (384, 384), (208, 208)),
    ('名称未設定のデザイン (29)(1).png', 'img/ui/lowpoly/quest.webp', (384, 384), (208, 208)),
    ('名称未設定のデザイン (45).png', 'img/ui/lowpoly/money-tree.webp', (384, 384), (208, 208)),
    ('名称未設定のデザイン(4).png', 'img/ui/lowpoly/messages.webp', (256, 256), (128, 128)),
    ('名称未設定のデザイン (16).png', 'img/ui/lowpoly/jobs.webp', (256, 256), (128, 128)),
    ('名称未設定のデザイン (9)(1).png', 'img/ui/lowpoly/friends.webp', (256, 256), (128, 128)),
    ('名称未設定のデザイン (22).png', 'img/symbols/lowpoly/seven.webp', (576, 546), (384, 364)),
    ('名称未設定のデザイン (21).png', 'img/symbols/lowpoly/star.webp', (576, 546), (384, 364)),
    ('名称未設定のデザイン (19).png', 'img/symbols/lowpoly/gold.webp', (576, 546), (384, 364)),
    ('名称未設定のデザイン (2).png', 'img/symbols/lowpoly/bar.webp', (576, 546), (384, 364)),
    ('名称未設定のデザイン (3)(1).png', 'img/symbols/lowpoly/diamond.webp', (576, 546), (384, 364)),
    ('名称未設定のデザイン (21)(1).png', 'img/symbols/lowpoly/revolver.webp', (576, 546), (384, 364)),
    ('名称未設定のデザイン (33)(1).png', 'img/ui/lowpoly/exit.webp', (192, 192), (88, 84)),
    ('名称未設定のデザイン (19)(1).png', 'img/ui/lowpoly/bg.webp', None, (960, 540)),
    ('名称未設定のデザイン (2)(1).png', 'img/ui/lowpoly/title.webp', None, (1440, 810)),
    ('名称未設定のデザイン (32)(1).png', 'img/ui/lowpoly/shop.webp', (256, 256), (100, 100)),
    ('スピン.png', 'img/ui/lowpoly/spin.webp', (640, 640), (388, 388)),
]
# Keep the same symbol ids / cell centres: save data and payouts use these ids.
BOXES = {
    'revolver': (96.5, 91.5, 116, 124),
    'gold': (96.5, 89.5, 114, 92),
    'diamond': (95, 90.75, 124, 140),
    'star': (97, 90, 131, 121),
    'bar': (94.5, 90.5, 146, 122),
    'seven': (96.5, 91.5, 132, 132),
}


def prepare(im, output, canvas):
    if canvas is None:
        return im.convert('RGB')
    # Keep anti-aliased edges and all visible pixels; discard transparent padding.
    crop = im.crop(im.getchannel('A').getbbox())
    if output.startswith('img/symbols/'):
        cx, cy, width, height = BOXES[Path(output).stem]
        scale = min(width / crop.width, height / crop.height) * 3
        size = (round(crop.width * scale), round(crop.height * scale))
        pos = (round(cx * 3 - size[0] / 2), round(cy * 3 - size[1] / 2))
    else:
        scale = min(canvas[0] / crop.width, canvas[1] / crop.height) * .96
        size = (round(crop.width * scale), round(crop.height * scale))
        pos = ((canvas[0] - size[0]) // 2, (canvas[1] - size[1]) // 2)
    result = Image.new('RGBA', canvas, (0, 0, 0, 0))
    result.alpha_composite(crop.resize(size, Image.Resampling.LANCZOS), pos)
    return result


def displayed(im, size):
    im = im.convert('RGBA').resize(size, Image.Resampling.LANCZOS)
    bg = Image.new('RGBA', size, (225, 215, 194, 255))
    return np.asarray(Image.alpha_composite(bg, im).convert('RGB'), dtype=np.float64)


def similarity(a, b):
    mse = np.mean((a - b) ** 2)
    psnr = 100 if mse == 0 else 10 * math.log10(255 ** 2 / mse)
    # Local structural similarity of luminance (11px Gaussian window).
    a = a @ np.array([.299, .587, .114])
    b = b @ np.array([.299, .587, .114])
    u, v = gaussian_filter(a, 1.5), gaussian_filter(b, 1.5)
    va, vb = gaussian_filter(a * a, 1.5) - u * u, gaussian_filter(b * b, 1.5) - v * v
    cov = gaussian_filter(a * b, 1.5) - u * v
    ssim = np.mean(((2 * u * v + 6.5025) * (2 * cov + 58.5225)) /
                   ((u * u + v * v + 6.5025) * (va + vb + 58.5225)))
    return float(ssim), float(psnr)


def export(im, display_size, output):
    reference = displayed(im, display_size)
    options = []
    # Flat alpha artwork needs clean small details. Scenic dithering can be
    # compressed more, while the title's lettering keeps a quality floor.
    min_ssim, min_psnr, floor = (.975, 35, 90) if output.endswith('/title.webp') else ((.985, 38, 76) if output.endswith('/bg.webp') else (.995, 36, 76))
    for quality in [76, 82, 86, 90, 94, 98, 100]:
        if quality < floor:
            continue
        out = io.BytesIO()
        im.save(out, 'WEBP', quality=quality, method=6, lossless=quality == 100,
                alpha_quality=100, exact=True)
        data = out.getvalue()
        decoded = Image.open(io.BytesIO(data))
        ssim, psnr = similarity(reference, displayed(decoded, display_size))
        if quality == 100 or ssim >= min_ssim and psnr >= min_psnr:
            options.append((data, quality, ssim, psnr))
            break
    # Lossless can be smaller for simple flat icons.
    if options[0][1] != 100:
        out = io.BytesIO()
        im.save(out, 'WEBP', lossless=True, method=6, exact=True)
        options.append((out.getvalue(), 100, 1.0, 100.0))
    return min(options, key=lambda option: len(option[0]))


def main():
    source = Path(sys.argv[1])
    report = []
    for name, output, canvas, display in ASSETS:
        file = source / name
        im = prepare(Image.open(file).convert('RGBA'), output, canvas)
        data, quality, ssim, psnr = export(im, display, output)
        path = ROOT / output
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        row = {'path': output, 'original': file.stat().st_size, 'bytes': len(data),
               'size': im.size, 'quality': quality, 'ssim': round(ssim, 5), 'psnr': round(psnr, 2)}
        report.append(row)
        print(json.dumps(row))
    original = sum(row['original'] for row in report)
    total = sum(row['bytes'] for row in report)
    print(json.dumps({'files': len(report), 'original': original, 'bytes': total,
                      'reductionPercent': round(100 * (1 - total / original), 1)}))


if __name__ == '__main__':
    main()
