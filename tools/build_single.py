"""Bundles the game into one self-contained HTML file (dist/blockbuster-reels.html).

    python3 tools/build_single.py

CSS, JavaScript, fonts and the touch icon are inlined, so the file can be
opened directly, sent to a phone or hosted anywhere as a single page.
"""
import base64
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dist', 'blockbuster-reels.html')


def read(rel, mode='r'):
    kw = {} if 'b' in mode else {'encoding': 'utf-8'}
    with open(os.path.join(ROOT, rel), mode, **kw) as fh:
        return fh.read()


def b64(rel):
    return base64.b64encode(read(rel, 'rb')).decode('ascii')


def inline_css(match):
    href = match.group(1)
    css = read(href)
    base = os.path.dirname(href)

    def font(m):
        path = os.path.normpath(os.path.join(base, m.group(1)))
        return "url(data:font/woff2;base64,%s)" % b64(path)
    css = re.sub(r"url\('([^']+\.woff2)'\)", font, css)
    return '<style>\n' + css + '</style>'


def inline_js(match):
    js = read(match.group(1)).replace('</script', '<\\/script')
    # image references inside scripts (reel symbols) become data: URIs
    js = re.sub(r"'(img/[A-Za-z0-9_/.-]+\.webp)'", lambda m: "'data:image/webp;base64,%s'" % b64(m.group(1)), js)
    return '<script>\n' + js + '</script>'


def main():
    html = read('index.html')
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
    for icon in ('icons/icon-192.png', 'icons/icon-180.png'):
        html = html.replace('href="%s"' % icon, 'href="data:image/png;base64,%s"' % b64(icon))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print('wrote %s (%d KiB)' % (os.path.relpath(OUT, ROOT), len(html.encode('utf-8')) // 1024))


if __name__ == '__main__':
    main()
