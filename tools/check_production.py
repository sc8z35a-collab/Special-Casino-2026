"""Verify the deployed game's build, public API and representative new assets.

Run after a main-branch update; Cloudflare's connected build may need a few minutes.
No credentials or player mutations are used.
"""
import argparse
import json
import time
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


def check(base, expected):
    status, content_type, body = read(base, 'version.json', expected)
    if content_type != 'application/json' or json.loads(body).get('build') != expected:
        raise ValueError('live build has not reached ' + expected)
    status, content_type, body = read(base, 'api/health', expected)
    if status != 200 or content_type != 'application/json' or not json.loads(body).get('ok'):
        raise ValueError('public API health check failed')
    for path in ['img/avatars/traveler-green.webp', 'img/ui/quest-tiers/dark.webp',
                 'img/items/lowpoly/engine-v3.webp', 'img/cars/onvoro.webp']:
        _, content_type, body = read(base, path, expected)
        if content_type != 'image/webp' or body[:4] != b'RIFF' or body[8:12] != b'WEBP':
            raise ValueError('missing or invalid WebP: ' + path)
    _, _, body = read(base, 'img/3d/cars/onvoro.glb', expected, limit=12, byte_range='bytes=0-11')
    if body[:4] != b'glTF':
        raise ValueError('new car model is unavailable')
    _, content_type, body = read(base, 'video/studio-low.mp4', expected, limit=12, byte_range='bytes=0-11')
    if content_type != 'video/mp4' or body[4:8] != b'ftyp':
        raise ValueError('new studio movie is unavailable')


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
    for attempt in range(1, args.attempts + 1):
        try:
            check(base, expected)
            print('PASS live build ' + expected + ': API, four new images, car GLB and studio movie')
            return
        except Exception as error:
            print('Attempt %d/%d: %s' % (attempt, args.attempts, error), flush=True)
            if attempt == args.attempts:
                raise SystemExit('Production verification did not pass')
            time.sleep(args.delay)


if __name__ == '__main__':
    main()
