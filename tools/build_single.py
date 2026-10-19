"""Bundles the game into one self-contained HTML file (dist/blockbuster-reels.html).

    python3 tools/build_single.py

CSS, JavaScript, fonts, images, sounds, the (small) start video and the touch icon are
inlined, so the file can be opened directly, sent to a phone or hosted anywhere as a single
page. It plays offline: the online features (friends, chat, icons, cars) need the server.
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


MEDIA = {'webp': 'image/webp', 'png': 'image/png', 'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'mp4': 'video/mp4'}
# only used by the online features (or the full-size start video): left out of the offline file
ONLINE_ONLY = re.compile(r'^(img/avatars/|img/cars/|img/items/|img/fruits/|img/jobs/|img/tree/|img/ui/chain\.webp|img/ui/sale\.webp|img/ui/login-bonus\.webp|'
                         r'video/title\.mp4|video/studio\.mp4|video/intro\.mp4|sounds/peter-)')


def embed(m):
    path = m.group(1)
    if ONLINE_ONLY.match(path):
        return "''"
    return "'data:%s;base64,%s'" % (MEDIA[m.group(2)], b64(path))


def inline_js(match):
    js = read(match.group(1)).replace('</script', '<\\/script')
    # image, sound and video references inside scripts become data: URIs
    js = re.sub(r"'((?:img|sounds|video)/[A-Za-z0-9_/.-]+\.(webp|png|wav|mp3|mp4))'", embed, js)
    return '<script>\n' + js + '</script>'


def main():
    html = read('index.html')
    # plays offline: no server behind it
    html = html.replace('<meta name="br-mode" content="online" data-live="ws">', '<meta name="br-mode" content="local">')
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
    html = html.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
    for icon in ('icons/icon-192.png', 'icons/icon-180.png'):
        for attr in ('href', 'src'):
            html = html.replace('%s="%s"' % (attr, icon), '%s="data:image/png;base64,%s"' % (attr, b64(icon)))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(html)
    print('wrote %s (%d KiB)' % (os.path.relpath(OUT, ROOT), len(html.encode('utf-8')) // 1024))


if __name__ == '__main__':
    main()
