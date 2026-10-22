"""Builds the UI images in img/ui/ from the supplied artwork in tools/art/source/ui/.

    python3 tools/art/ui_images.py

- chip / coin / dollar: wallet and HUD icons; garage: the garage coin (a
  garage place bought)
- spin.webp + spin-arrows.webp: the SPIN button face with the arrows lifted
  onto their own layer (they turn while the reels spin)
- pill-get / pill-max: the two left HUD buttons as supplied; pill.webp is the
  same pill with its label painted out, for the buttons that carry live text
- chip-pile.webp: token shop decoration
- bg.webp + frame.webp: the screen background with its gold frame painted
  out, and the frame alone as a 9-slice image (the stage aspect varies by
  device, so the pattern is cover-scaled and the frame is stretched)
"""
import os

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = os.path.join(HERE, 'source', 'ui')
OUT = os.path.join(ROOT, 'img', 'ui')

# background frame geometry (source pixels, measured on background.webp)
FRAME_EDGE = {'top': 16, 'bottom': 16, 'left': 18, 'right': 18}
FRAME_BEVEL = 70        # corner ornaments: x + y <= FRAME_BEVEL from each corner
FRAME_SLICE = 72        # 9-slice corner size
FRAME_SAMPLE = 16       # length of the edge pieces in frame.webp


def load(name):
    return Image.open(os.path.join(SRC, name)).convert('RGBA')


def trim(img):
    return img.crop(img.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox())


def square(img):
    s = max(img.size)
    out = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    out.paste(img, ((s - img.width) // 2, (s - img.height) // 2))
    return out


def fit(img, w=None, h=None):
    k = w / img.width if w else h / img.height
    return img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)


def save(img, name, quality=88):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    lossless = img.mode == 'RGBA' and quality >= 100
    img.save(path, 'WEBP', quality=min(quality, 100), method=6, lossless=lossless, exact=img.mode == 'RGBA')
    print('wrote %s %dx%d (%d KiB)' % (os.path.relpath(path, ROOT), img.width, img.height, os.path.getsize(path) // 1024))


def lum(rgb):
    return rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)


def inpaint(rgb, mask, radius=9):
    """Paint `mask` out of an RGB float image (OpenCV Telea)."""
    src = np.clip(rgb, 0, 255).astype(np.uint8)
    out = cv2.inpaint(src[..., ::-1].copy(), mask.astype(np.uint8) * 255, radius, cv2.INPAINT_TELEA)
    return out[..., ::-1].astype(np.float32)


def lift(rgb, base, core):
    """Separate dark ink from a known backdrop: alpha and colour of the ink.

    rgb = alpha * ink + (1 - alpha) * base, where the ink colour of an edge
    pixel is taken from the nearest fully covered (core) pixel."""
    _, (iy, ix) = ndi.distance_transform_edt(~core, return_indices=True)
    ink = rgb[iy, ix]
    d = ink - base
    alpha = np.sum((rgb - base) * d, axis=-1) / np.maximum(np.sum(d * d, axis=-1), 1e-3)
    alpha = np.clip(alpha, 0, 1)
    alpha[core] = 1
    return ink, alpha


def icons():
    for name, size in (('chip', 160), ('coin', 160), ('dollar', 160), ('garage', 160)):
        save(square(trim(load(name + '.webp'))).resize((size, size), Image.LANCZOS), name + '.webp', 90)


def spin_button():
    img = trim(load('spin.webp'))
    a = np.asarray(img).astype(np.float32)
    rgb, al = a[..., :3], a[..., 3]
    dark = (lum(rgb) < 140) & (al > 200)
    lab, n = ndi.label(dark)
    sizes = ndi.sum(dark, lab, range(1, n + 1))
    h, w = dark.shape
    arrows = np.zeros_like(dark)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if sizes[i - 1] < 50000:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        # the two arrows: big, wide shapes above / below the label (not the rim rings)
        if (x1 - x0) < w * 0.8 and (y1 - y0) < h * 0.45:
            arrows |= lab == i
    region = ndi.binary_dilation(arrows, iterations=7)
    base = inpaint(rgb, region, 15)
    core = ndi.binary_erosion(arrows, iterations=2)
    ink, alpha = lift(rgb, base, core)
    alpha[~region] = 0
    face = np.dstack([base, al])
    layer = np.dstack([ink, alpha * al])
    size = 420
    save(Image.fromarray(face.astype(np.uint8), 'RGBA').resize((size, size), Image.LANCZOS), 'spin.webp', 90)
    save(Image.fromarray(np.clip(layer, 0, 255).astype(np.uint8), 'RGBA').resize((size, size), Image.LANCZOS), 'spin-arrows.webp', 90)


def pills():
    for name in ('pill-get', 'pill-max'):
        save(fit(trim(load(name + '.webp')), h=200), name + '.webp', 90)
    # label-free pill: paint the dark lettering out of the face
    img = trim(load('pill-max.webp'))
    a = np.asarray(img).astype(np.float32)
    rgb, al = a[..., :3], a[..., 3]
    h, w = al.shape
    yy, xx = np.mgrid[0:h, 0:w]
    inner = (np.abs(xx - w / 2) < w * 0.36) & (np.abs(yy - h / 2) < h * 0.3)
    ink = (lum(rgb) < 150) & inner
    ink = ndi.binary_dilation(ink, iterations=6)
    clean = inpaint(rgb, ink, 12)
    save(fit(Image.fromarray(np.dstack([clean, al]).astype(np.uint8), 'RGBA'), h=200), 'pill.webp', 90)


def chip_pile():
    save(fit(trim(load('chip-pile.webp')), w=720), 'chip-pile.webp', 88)


def background():
    img = Image.open(os.path.join(SRC, 'background.webp')).convert('RGB')  # source alpha ~0.9: use the colours as drawn
    rgb = np.asarray(img).astype(np.float32)
    h, w, _ = rgb.shape
    yy, xx = np.mgrid[0:h, 0:w]
    e, b = FRAME_EDGE, FRAME_BEVEL
    frame = ((yy < e['top']) | (yy >= h - e['bottom']) | (xx < e['left']) | (xx >= w - e['right'])
             | (xx + yy <= b) | ((w - 1 - xx) + yy <= b) | (xx + (h - 1 - yy) <= b) | ((w - 1 - xx) + (h - 1 - yy) <= b))
    # plus any gold close to the border (the inner line kinks where it meets the corner ornaments)
    near = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy)) < 40
    goldish = (rgb[..., 0] > 130) & (rgb[..., 1] > 80) & (rgb[..., 0] - rgb[..., 2] > 60)
    frame |= ndi.binary_dilation(goldish & near, iterations=1) & near
    # the pattern without the frame (cover-scaled behind the frame overlay)
    pattern = inpaint(rgb, ndi.binary_dilation(frame, iterations=2), 6)
    save(Image.fromarray(pattern.astype(np.uint8), 'RGB'), 'bg.webp', 84)
    # the frame alone, soft-edged, packed as a 9-slice image
    soft = ndi.gaussian_filter(frame.astype(np.float32), 0.7)
    alpha = np.clip(np.where(frame, 1.0, soft * 1.6), 0, 1) * 255
    rgba = np.dstack([rgb, alpha]).astype(np.uint8)
    c, s = FRAME_SLICE, FRAME_SAMPLE
    n = 2 * c + s
    sheet = np.zeros((n, n, 4), np.uint8)
    mx, my = w // 2, h // 2
    sheet[:c, :c] = rgba[:c, :c]
    sheet[:c, -c:] = rgba[:c, -c:]
    sheet[-c:, :c] = rgba[-c:, :c]
    sheet[-c:, -c:] = rgba[-c:, -c:]
    sheet[:c, c:c + s] = rgba[:c, mx:mx + s]
    sheet[-c:, c:c + s] = rgba[-c:, mx:mx + s]
    sheet[c:c + s, :c] = rgba[my:my + s, :c]
    sheet[c:c + s, -c:] = rgba[my:my + s, -c:]
    save(Image.fromarray(sheet, 'RGBA'), 'frame.webp', 100)
    print('frame: source %dx%d, slice %d' % (w, h, c))


def main():
    icons()
    spin_button()
    pills()
    chip_pile()
    background()


if __name__ == '__main__':
    main()
