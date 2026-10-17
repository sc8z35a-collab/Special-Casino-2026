"""Art-deco background tile (capsule clusters + fans), vector version.

The structural lines come from tile_paths.json, which was traced from a
median-reconstructed tile of the reference background (see README in this
folder); the nested capsules are drawn as exact geometry.
"""
import json
import os

from geom import fmt, smooth_d

HERE = os.path.dirname(os.path.abspath(__file__))
P = 386.25                      # tile period (design px, square)
ORIGIN = (21.9, 156.9)          # tile origin on the 2000x924 reference screen
BOGUS = {1, 4, 5, 9, 10}        # horizontal seam artefacts of the reconstruction
THICK = {18, 19}                # the short heavy "spokes" beside each arch
RING = 11.5                     # capsule ring spacing


def capsule(cx, cy, hw, hh):
    r = hw
    return (f'M{fmt(cx - hw)},{fmt(cy - hh + r)} A{fmt(r)},{fmt(r)} 0 0 1 {fmt(cx + hw)},{fmt(cy - hh + r)} '
            f'L{fmt(cx + hw)},{fmt(cy + hh - r)} A{fmt(r)},{fmt(r)} 0 0 1 {fmt(cx - hw)},{fmt(cy + hh - r)}Z')


def capsule_group(cx, cy):
    out = []
    for k in range(4):
        out.append(capsule(cx, cy, 52.5 - k * RING, 90 - k * RING))
    out.append(capsule(cx, cy, 6.2, 44))
    return out


def tile_svg():
    paths = json.load(open(os.path.join(HERE, 'tile_paths.json')))
    thin, thick = [], []
    for i, pts in enumerate(paths):
        if i in BOGUS:
            continue
        d = smooth_d(pts, closed=False, tension=0.5) if len(pts) > 2 else \
            f'M{fmt(pts[0][0])},{fmt(pts[0][1])}L{fmt(pts[1][0])},{fmt(pts[1][1])}'
        (thick if i in THICK else thin).append(d)
    c = P / 2
    big = capsule_group(143.5, 200) + capsule_group(P - 143.5, 200)
    back = capsule_group(c, 140) + capsule_group(c, 259)
    # wrap copies so lines crossing the tile edge continue seamlessly
    offs = [(dx, dy) for dx in (-P, 0, P) for dy in (-P, 0, P)]
    lines = ''.join(f'<path d="{d}"/>' for d in thin)
    heavy = ''.join(f'<path d="{d}"/>' for d in thick)
    g = []
    g.append(f'<g id="bgl">{lines}</g><g id="bgh">{heavy}</g>')
    use_l = ''.join(f'<use href="#bgl" x="{fmt(dx)}" y="{fmt(dy)}"/>' for dx, dy in offs if (dx, dy) != (0, 0))
    use_h = ''.join(f'<use href="#bgh" x="{fmt(dx)}" y="{fmt(dy)}"/>' for dx, dy in offs if (dx, dy) != (0, 0))
    occl = capsule(143.5, 200, 54.5, 92) + capsule(P - 143.5, 200, 54.5, 92)
    tile = (
        '<defs>'
        f'<mask id="bgocc" maskUnits="userSpaceOnUse" x="0" y="0" width="{fmt(P)}" height="{fmt(P)}">'
        f'<rect width="{fmt(P)}" height="{fmt(P)}" fill="#fff"/><path d="{occl}" fill="#000"/></mask>'
        '</defs>'
        '<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
        f'<g stroke-width="3.3">{"".join(g)}{use_l}</g>'
        f'<g stroke-width="9.5">{use_h}</g>'
        f'<g stroke-width="3.2" mask="url(#bgocc)">' + ''.join(f'<path d="{d}"/>' for d in back) + '</g>'
        '<g stroke-width="3.2">' + ''.join(f'<path d="{d}"/>' for d in big) + '</g>'
        '</g>'
    )
    # move the heavy group definition to proper stroke width
    tile = tile.replace(f'<g id="bgh">{heavy}</g>', '')
    tile = tile.replace('<g stroke-width="9.5">', f'<g stroke-width="9.5"><g id="bgh">{heavy}</g>')
    return tile


def pattern_module():
    return {'P': P, 'origin': list(ORIGIN), 'tile': tile_svg()}
