"""Export the supplied square game icon for the web and Android launchers.

    python tools/art/import_app_icon.py /path/to/supplied-icon.png

The original artwork is retained. Adaptive launchers receive a padded foreground
and matching purple background so the coin stays inside the circular safe zone.
"""
import sys
import io
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parents[2]


def save_png(image, path):
    output = io.BytesIO()
    image.save(output, format='PNG', optimize=True)
    data = output.getvalue()
    Image.open(io.BytesIO(data)).verify()
    path.write_bytes(data)


def main():
    art = Image.open(sys.argv[1]).convert('RGB')
    if art.width != art.height:
        raise ValueError('The supplied app icon must be square')
    icons = ROOT / 'icons'
    for size in (180, 192, 512):
        save_png(art.resize((size, size), Image.Resampling.LANCZOS), icons / f'icon-{size}.png')

    # The supplied red/gold coin and green leaves are distinct from the purple
    # background. Reuse their original pixels for an adaptive foreground, with
    # no rectangular inset around the artwork.
    r, g, b = art.split()
    colour = ImageChops.lighter(ImageChops.subtract(r, b), ImageChops.subtract(g, b)).point(lambda value: 255 if value > 25 else 0)
    bright = ImageChops.darker(ImageChops.darker(r, g), b).point(lambda value: 255 if value > 165 else 0)
    silhouette = ImageChops.lighter(colour, bright)
    ImageDraw.floodfill(silhouette, (0, 0), 128)
    silhouette = silhouette.point(lambda value: 0 if value == 128 else 255)
    silhouette = silhouette.filter(ImageFilter.GaussianBlur(.45))
    foreground_art = art.convert('RGBA')
    foreground_art.putalpha(silhouette)
    foreground_art = foreground_art.crop(silhouette.getbbox())
    cx, cy = foreground_art.width / 2, foreground_art.height / 2
    alpha = foreground_art.getchannel('A').load()
    radius = max(((x - cx) ** 2 + (y - cy) ** 2) ** .5
                 for y in range(foreground_art.height) for x in range(foreground_art.width) if alpha[x, y] > 16)
    purple = art.getpixel((0, 0))

    def foreground(size, safe_radius):
        scale = safe_radius / radius
        face = foreground_art.resize((round(foreground_art.width * scale), round(foreground_art.height * scale)), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (size, size))
        canvas.alpha_composite(face, ((size - face.width) // 2, (size - face.height) // 2))
        return canvas

    background = Image.new('RGB', (512, 512), purple)
    maskable = background.convert('RGBA')
    maskable.alpha_composite(foreground(512, 512 * .395))
    save_png(maskable.convert('RGB'), icons / 'icon-maskable-512.png')

    # Android's 108dp layer is masked to a 72dp viewport. Put the supplied
    # square in the central 56dp so no part of the artwork is lost.
    for name, density in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
        dest = ROOT / 'app/android/app/src/main/res' / ('mipmap-' + name)
        size = round(108 * density)
        save_png(art.resize((round(48 * density),) * 2, Image.Resampling.LANCZOS), dest / 'ic_launcher.png')
        save_png(background.resize((size, size), Image.Resampling.LANCZOS), dest / 'ic_launcher_background.png')
        save_png(foreground(size, size * .26), dest / 'ic_launcher_foreground.png')
        # A themed icon uses the coin/leaf silhouette, excluding the purple sky.
        mono = foreground(size, size * .26)
        mono.paste((255, 255, 255), (0, 0, size, size), mono.getchannel('A'))
        save_png(mono, dest / 'ic_launcher_monochrome.png')
    print('Updated 4 web icons and all 5 Android launcher densities')


if __name__ == '__main__':
    main()
