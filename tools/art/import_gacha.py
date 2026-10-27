"""Compress supplied gacha artwork at display sizes, retaining transparent edges.
Usage: python3 tools/art/import_gacha.py /path/to/uploads
"""
import argparse
import io
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
target = root / 'img/gacha'
target.mkdir(exist_ok=True)
files = {
    'background': ('名称未設定のデザイン.jpg', (1600, 900)),
    'confirm': ('名称未設定のデザイン (15)(6).png', (960, 540)),
    'rare': ('名称未設定のデザイン (14)(4).png', (640, 360)),
    'legendary': ('名称未設定のデザイン (3)(5).png', (640, 360)),
    'secret': ('名称未設定のデザイン (4)(4).png', (640, 360)),
    'pull-1': ('名称未設定のデザイン (7)(6).png', (320, 180)),
    'pull-3': ('名称未設定のデザイン (6)(6).png', (320, 180)),
    'pull-10': ('名称未設定のデザイン (8)(3).png', (320, 180)),
    'off-10': ('名称未設定のデザイン (9)(3).png', (216, 122)),
    'off-25': ('名称未設定のデザイン (11)(7).png', (216, 122)),
    'odds': ('名称未設定のデザイン (13)(5).png', (224, 126)),
    'icon': ('新しいガチャアイコン.png', (224, 224))
}
for name, (source, size) in files.items():
    with Image.open(args.source / source) as opened:
        image = opened.convert('RGBA')
        image.thumbnail(size, Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        quality = 76 if name == 'background' else 82 if name == 'confirm' else 62
        image.save(encoded, format='WEBP', quality=quality,
                   method=6, alpha_quality=100 if name in ('background', 'confirm') else 75)
        data = encoded.getvalue()
        if not data.startswith(b'RIFF') or data[8:12] != b'WEBP':
            raise ValueError(f'Could not encode {source}')
        temporary = target / (name + '.webp.tmp')
        temporary.write_bytes(data)
        temporary.replace(target / (name + '.webp'))
print(f'{len(files)} assets, {sum(p.stat().st_size for p in target.glob("*.webp")):,} bytes')
