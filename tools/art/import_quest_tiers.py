"""Crop transparent padding and compress the nine supplied quest backgrounds.

    python3 tools/art/import_quest_tiers.py /path/to/attachments

Keep the full 960 px width, all visible pixels and the source aspect ratio.
Check similarity under a conservative 75% brightness shade and compare
lossless size too. Pixel dimensions and polygon edges remain intact.
"""
import json
import io
import sys
from pathlib import Path
from PIL import Image, ImageEnhance
import import_supplied as art

ASSETS = [
    ('名称未設定のデザイン(5).png', 'green'),
    ('名称未設定のデザイン (7)(2).png', 'blue'),
    ('名称未設定のデザイン (6)(2).png', 'purple'),
    ('名称未設定のデザイン (14).png', 'orange'),
    ('名称未設定のデザイン (10).png', 'gold'),
    ('名称未設定のデザイン (5)(1).png', 'red'),
    ('名称未設定のデザイン (11).png', 'red-gold'),
    ('名称未設定のデザイン (13).png', 'aqua-purple'),
    ('名称未設定のデザイン (15).png', 'dark'),
]

def export(im):
    def viewed(image):
        return art.displayed(ImageEnhance.Brightness(image.convert('RGBA')).enhance(.75), im.size)
    reference = viewed(im)
    options = []
    for quality in [76, 82, 86, 90, 94, 100]:
        out = io.BytesIO()
        im.save(out, 'WEBP', quality=quality, lossless=quality == 100,
                method=6, alpha_quality=100, exact=True)
        data = out.getvalue()
        ssim, psnr = art.similarity(reference, viewed(Image.open(io.BytesIO(data))))
        if quality == 100 or ssim >= .975 and psnr >= 40:
            options.append((data, quality, ssim, psnr))
            break
    if options[0][1] != 100:
        out = io.BytesIO()
        im.save(out, 'WEBP', lossless=True, method=6, exact=True)
        options.append((out.getvalue(), 100, 1.0, 100.0))
    return min(options, key=lambda result: len(result[0]))

def main():
    source = Path(sys.argv[1])
    rows = []
    for name, tier in ASSETS:
        file = source / name
        im = Image.open(file).convert('RGBA')
        im = im.crop(im.getchannel('A').getbbox())
        output = 'img/ui/quest-tiers/' + tier + '.webp'
        data, quality, ssim, psnr = export(im)
        path = art.ROOT / output
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        row = dict(path=output, original=file.stat().st_size, bytes=len(data),
                   size=im.size, quality=quality, ssim=round(ssim, 5), psnr=round(psnr, 2))
        rows.append(row)
        print(json.dumps(row))
    print(json.dumps(dict(files=len(rows), original=sum(r['original'] for r in rows),
                          bytes=sum(r['bytes'] for r in rows))))

if __name__ == '__main__':
    main()
