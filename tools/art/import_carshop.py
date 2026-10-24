"""Import supplied car-shop / quest artwork; usage matches import_supplied.py."""
import io
from PIL import Image
import import_supplied as art

art.ASSETS = [
    ('ローポリアイコン (4).png', 'img/items/lowpoly/omamori.webp', (384, 384), (200, 200)),
    ('ローポリアイコン (14)(1).png', 'img/items/lowpoly/repair-kit.webp', (384, 384), (200, 200)),
    ('ローポリアイコン (13)(1).png', 'img/items/lowpoly/car-oil-medium.webp', (384, 384), (200, 200)),
    ('ローポリアイコン (15)(1).png', 'img/items/lowpoly/gasoline-full.webp', (384, 384), (200, 200)),
    ('ローポリアイコン (10)(1).png', 'img/items/lowpoly/engine-v1.webp', (512, 512), (240, 240)),
    ('ローポリアイコン (11)(1).png', 'img/items/lowpoly/engine-v2.webp', (512, 512), (240, 240)),
    ('ローポリアイコン (9)(1).png', 'img/items/lowpoly/engine-v3.webp', (512, 512), (240, 240)),
    ('PRO(1).png', 'img/ui/lowpoly/quest-pro.webp', (96, 32), (48, 16)),
    ('ローポリアイコン (6)(1).png', 'img/ui/lowpoly/quest-ultra.webp', (128, 32), (64, 16)),
]

original_export = art.export

def export(im, display_size, output):
    if '/quest-' not in output:
        return original_export(im, display_size, output)
    out = io.BytesIO()
    im.save(out, 'WEBP', quality=72, alpha_quality=100, method=6, exact=True)
    data = out.getvalue()
    ssim, psnr = art.similarity(art.displayed(im, display_size), art.displayed(Image.open(io.BytesIO(data)), display_size))
    return data, 72, ssim, psnr

art.export = export

if __name__ == '__main__':
    art.main()
