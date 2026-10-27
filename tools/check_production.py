"""Verify the deployed game's build, public API and representative new assets.

Run after a main-branch update; Cloudflare's connected build may need a few minutes.
No credentials or player mutations are used.
"""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(base, path, build, limit=100000, byte_range=None):
    headers = {'Cache-Control': 'no-cache', 'User-Agent': 'Special-Casino-production-check'}
    if byte_range:
        headers['Range'] = byte_range
    req = urllib.request.Request(base + '/' + path + '?release_check=' + build, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        return response.status, response.headers.get_content_type(), response.read(limit)


def check(base, expected, expected_commit=None):
    status, content_type, body = read(base, 'version.json', expected)
    version = json.loads(body) if content_type == 'application/json' else {}
    if version.get('sourceBuild', version.get('build')) != expected:
        raise ValueError('live build has not reached source ' + expected)
    if expected_commit and version.get('sourceCommit') and version['sourceCommit'] != expected_commit:
        raise ValueError('live source commit has not reached ' + expected_commit)
    status, content_type, body = read(base, 'api/health', expected)
    if status != 200 or content_type != 'application/json' or not json.loads(body).get('ok'):
        raise ValueError('public API health check failed')
    art = ['img/avatars/traveler-green.webp', 'img/ui/quest-tiers/dark.webp',
           'img/items/lowpoly/engine-v3.webp', 'img/cars/onvoro.webp']
    art += ['img/gacha/' + name + '.webp' for name in
            ['background', 'confirm', 'icon', 'rare', 'legendary', 'secret', 'odds',
             'pull-1', 'pull-3', 'pull-10', 'off-10', 'off-25']]
    for path in art:
        _, content_type, body = read(base, path, expected, limit=12, byte_range='bytes=0-11')
        if content_type != 'image/webp' or body[:4] != b'RIFF' or body[8:12] != b'WEBP':
            raise ValueError('missing or invalid WebP: ' + path)
    _, _, body = read(base, 'img/3d/cars/onvoro.glb', expected, limit=12, byte_range='bytes=0-11')
    if body[:4] != b'glTF':
        raise ValueError('new car model is unavailable')
    _, content_type, body = read(base, 'video/studio-low.mp4', expected, limit=12, byte_range='bytes=0-11')
    if content_type != 'video/mp4' or body[4:8] != b'ftyp':
        raise ValueError('new studio movie is unavailable')
    photo = json.loads((ROOT / 'server/core/line-wallpapers.json').read_text())[0]
    for path in [photo['original'], photo['preview']]:
        _, content_type, body = read(base, path.lstrip('/'), expected, limit=3, byte_range='bytes=0-2')
        if content_type != 'image/jpeg' or body != b'\xff\xd8\xff':
            raise ValueError('LINE wallpaper is unavailable: ' + path)
    # A look without a login must reach the new API and be refused, without buying anything.
    try:
        read(base, 'api/gacha', expected)
    except urllib.error.HTTPError as error:
        if error.code != 401 or json.loads(error.read()).get('error', {}).get('code') != 'auth':
            raise ValueError('gacha API is unavailable or does not require a login') from error
    else:
        raise ValueError('gacha API did not require a login')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url')
    parser.add_argument('--attempts', type=int, default=1)
    parser.add_argument('--delay', type=float, default=15)
    args = parser.parse_args()
    if args.attempts < 1 or args.delay < 0:
        parser.error('attempts must be positive and delay non-negative')
    configured = next(line.strip() for line in (ROOT / 'app/app-url.txt').read_text().splitlines()
                      if line.strip() and not line.lstrip().startswith('#'))
    base = (args.base_url or configured).rstrip('/')
    expected = json.loads((ROOT / 'version.json').read_text())['build']
    try:
        expected_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        expected_commit = None
    for attempt in range(1, args.attempts + 1):
        try:
            check(base, expected, expected_commit)
            print('PASS live build ' + expected + ': API, gacha authentication/art, LINE wallpapers, car GLB and studio movie')
            return
        except Exception as error:
            print('Attempt %d/%d: %s' % (attempt, args.attempts, error), flush=True)
            if attempt == args.attempts:
                raise SystemExit('Production verification did not pass')
            time.sleep(args.delay)


if __name__ == '__main__':
    main()
