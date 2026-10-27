"""Build LINE's JPEG originals (same dimensions) and small previews from the wallpaper app.

Run after editing ops/assets/wallpapers.json: python3 tools/build_line_wallpapers.py
Requires Pillow. No conversion or image download happens during delivery.
"""
import hashlib
import io
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
assets = ROOT / "ops/assets"
out = assets / "line-wallpapers"
out.mkdir(exist_ok=True)
sources = ["wallpaper-desktop.webp", "wallpaper-reserve.webp"]
sources += ["wallpapers/" + x["file"] for x in json.loads((assets / "wallpapers.json").read_text())]
rows = []
seen = set()
encoded = {}

def jpeg(image, quality):
    stream = io.BytesIO()
    image.save(stream, format='JPEG', quality=quality, subsampling=2, optimize=True, progressive=True)
    return stream.getvalue()

def publish(data, suffix):
    # The public filename identifies the encoded bytes, so recompression never reuses an immutable URL.
    name = hashlib.sha256(data).hexdigest()[:24] + suffix + '.jpg'
    path = out / name
    if not path.exists():
        temporary = path.with_suffix('.jpg.tmp')
        temporary.write_bytes(data)
        temporary.replace(path)
    return '/ops/assets/line-wallpapers/' + name

for source in sources:
    raw = (assets / source).read_bytes()
    with Image.open(assets / source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        # Identical pixels, even in differently encoded files, count as one photo.
        identity = hashlib.sha256(str(image.size).encode() + image.tobytes()).hexdigest()
        if identity not in seen:
            original = publish(jpeg(image, 78), '')
            small = image.copy()
            small.thumbnail((320, 320))
            preview = publish(jpeg(small, 65), '-preview')
            encoded[identity] = (original, preview)
        original, preview = encoded[identity]
        rows.append({"source": source, "sha256": hashlib.sha256(raw).hexdigest(), "id": identity,
                     "width": image.width, "height": image.height,
                     "original": original, "preview": preview})
        seen.add(identity)
(ROOT / "server/core/line-wallpapers.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
keep = {Path(r[k]).name for r in rows for k in ("original", "preview")}
for file in list(out.glob("*.jpg")):
    if file.name not in keep:
        file.unlink()
print(f"{len(rows)} wallpaper entries, {len(seen)} distinct photos; original dimensions preserved")
