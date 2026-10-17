"""Reel symbol artwork (SVG), recreated from the reference screenshots.

Every symbol is drawn on a 192x182 canvas (one reel cell of the reference
screen) so coordinates can be read straight off the screenshots.

Run `python3 tools/art/build.py` to regenerate js/art/symbols.js.
"""
import math
from geom import (Defs, sample, inset, poly_d, smooth_d, star_points, scale_pts,
                  centroid, path, fmt, rot, ellipse_pts)
from glyphs import GLYPHS

GOLD_RIM = [(0, '#fff7d6'), (0.18, '#f8d987'), (0.42, '#d39a39'), (0.6, '#f5d27c'), (0.82, '#b57a24'), (1, '#e9bd62')]
GOLD_BODY = [(0, '#fff2c0'), (0.35, '#f1c766'), (0.7, '#c98f32'), (1, '#9a6219')]


def shadow(D, d, dx=1.2, dy=3.0, sd=2.4, op=0.38, color='#3a1c06'):
    return f'<path d="{d}" fill="{color}" opacity="{op}" transform="translate({dx},{dy})" filter="{D.blur(sd)}"/>'


# ---------------------------------------------------------------- SEVEN ----
SEVEN_D = ('M33,26.5 L47.5,26 C51.5,26.3 54.5,28.8 56.8,30.6 C59.5,29.8 62,27.6 66,27.2 '
           'C80,25.6 100,26.6 117,29.6 C127,31.4 135,34.6 142.5,33.6 C149,32.8 154,29.6 158.5,30.4 '
           'C162.5,31.2 163.5,35.6 161.6,40 C152,56 139,78 131.5,96 C125,113 121.3,134 120.2,154.5 '
           'Q120,157.5 117,157.5 L54.5,157.5 Q51,157.5 50.8,154.5 C49.8,137 53.5,121 62,107 '
           'C70,94.5 84,86.5 98.5,75.5 C102.5,72.5 105.8,67.8 107.2,63.6 C97.5,59.6 85,56.3 72.5,56.4 '
           'C63.5,56.5 58.6,62 56.6,70 L55.6,75 Q55,78.2 51.8,78.2 L35.2,78.2 Q31.8,78.2 31.7,74.8 '
           'L31.4,30.4 Q31.4,26.6 33,26.5 Z')


def seven():
    D = Defs('s7')
    sil = sample(SEVEN_D, 900)
    d0 = poly_d(sil)
    d1 = poly_d(inset(sil, 0.9))
    d2 = poly_d(inset(sil, 2.3))
    d3 = poly_d(inset(sil, 3.6))
    d4 = poly_d(inset(sil, 4.7))
    d5pts = inset(sil, 5.5)
    d5 = poly_d(d5pts)
    gold = D.lin(GOLD_RIM, 0.1, 0, 0.9, 1)
    gold_hi = D.lin([(0, '#fffbe6'), (0.5, '#f9df95'), (1, '#d9a84a')], 0, 0, 0.3, 1)
    gold_lo = D.lin([(0, '#c48a2e'), (1, '#7c4d12')], 0, 0, 0, 1)
    red = D.lin([(0, '#f23a3c'), (0.35, '#dc1f27'), (0.75, '#b8121b'), (1, '#8c0911')], 0.2, 0, 0.6, 1)
    clip = D.clip(d5)
    soft = D.blur(1.6)
    soft2 = D.blur(3.2)
    b = [shadow(D, d0, 1.5, 3.4, 2.6, 0.42)]
    b.append(path(d0, '#5a2508'))
    b.append(path(d1, gold))
    b.append(path(d2, gold_hi))
    b.append(path(d3, gold_lo))
    b.append(path(d4, '#5c050a'))
    b.append(path(d5, red))
    g = [f'<g clip-path="{clip}">']
    # darker underside of the top bar + inner shadow along the rim
    g.append(f'<path d="M30,62 C60,48 95,50 130,60 L160,40 L170,80 L30,90Z" fill="#7c060d" opacity="0.35" filter="{soft2}"/>')
    # ribbon highlight across the bar (follows the flag wave)
    g.append(f'<path d="M36,44 C55,36 80,33 104,37 C122,40 136,46 156,36" fill="none" stroke="#ff8a7f" stroke-width="7" stroke-linecap="round" opacity="0.62" filter="{soft}"/>')
    g.append('<path d="M40,41 C60,35 82,33 104,36.5 C121,39.5 137,44 152,37" fill="none" stroke="#ffd2c8" stroke-width="1.6" stroke-linecap="round" opacity="0.75"/>')
    # slab highlight
    g.append(f'<path d="M38,34 L39,72" stroke="#ff9b90" stroke-width="5" opacity="0.5" filter="{soft}"/>')
    # stem: shading towards the right + pinstripe grooves
    g.append(f'<path d="M120,60 C130,70 140,80 132,100 C126,118 124,140 124,160 L170,160 L170,40Z" fill="#6d040b" opacity="0.45" filter="{soft2}"/>')
    g.append(f'<path d="M100,72 C80,90 64,104 57,130 L56,158" fill="none" stroke="#ff6d64" stroke-width="6" opacity="0.45" filter="{soft}"/>')
    L = [(104, 68), (84, 86), (64, 105), (55.5, 128), (53, 154)]
    R = [(157, 43), (143.5, 69), (131, 96), (124.5, 124), (121.5, 154)]
    for f in (0.3, 0.5, 0.7):
        pts = [(l[0] + f * (r[0] - l[0]), l[1] + f * (r[1] - l[1])) for l, r in zip(L, R)]
        pts = pts[1:]
        dd = smooth_d(pts, closed=False)
        g.append(f'<path d="{dd}" fill="none" stroke="#6a0309" stroke-width="1.5" opacity="0.55" transform="translate(1.4,0.4)"/>')
        g.append(f'<path d="{dd}" fill="none" stroke="#ff9d93" stroke-width="1.15" opacity="0.8"/>')
    # specular pin-points
    g.append('<ellipse cx="47" cy="37" rx="6" ry="2.2" fill="#fff" opacity="0.35" transform="rotate(-8 47 37)"/>')
    g.append('</g>')
    b += g
    # bright glint on the gold rim (top right)
    b.append('<path d="M146,33.5 C151,31 155,30 158,30.6" stroke="#fffbe8" stroke-width="1.2" fill="none" opacity="0.9"/>')
    return D.svg(''.join(b))


# ----------------------------------------------------------------- STAR ----
def fat_star(cx, cy, r_out, ratio, sy=1.0, rot0=-90):
    pts = []
    for i in range(10):
        r = r_out if i % 2 == 0 else r_out * ratio
        a = math.radians(rot0 + i * 36)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a) * sy))
    return pts


def star():
    D = Defs('st')
    cx, cy = 97, 97.5
    outline = fat_star(cx, cy, 68.5, 0.5, 0.985)
    sil = inset(inset(outline, -1.2, 0), 1.2, 0)
    d0 = poly_d(sil)
    green = D.lin([(0, '#33c165'), (0.4, '#169042'), (0.75, '#0d6a30'), (1, '#0a5226')], 0.25, 0, 0.6, 1)
    gold = D.lin(GOLD_RIM, 0, 0, 1, 1)
    body = D.lin([(0, '#fff6d2'), (0.22, '#f7dc8e'), (0.5, '#e2b052'), (0.78, '#c4892f'), (1, '#a5681f')], 0.42, 0, 0.58, 1)
    b = [shadow(D, d0, 1.2, 3.2, 2.6, 0.4)]
    b.append(path(d0, '#7a4f12'))
    b.append(path(poly_d(inset(sil, 0.7)), gold))
    gpts = inset(sil, 1.8)
    b.append(path(poly_d(gpts), green))
    clipg = D.clip(poly_d(gpts))
    b.append(f'<g clip-path="{clipg}">')
    b.append(f'<path d="{poly_d(inset(sil, 3.6))}" fill="none" stroke="#6af09a" stroke-width="1.6" opacity="0.45" filter="{D.blur(0.7)}"/>')
    b.append(f'<path d="M20,55 L105,15 L105,85Z" fill="#8dffb5" opacity="0.14" filter="{D.blur(4)}"/>')
    b.append('</g>')
    rim = inset(sil, 6.6)
    b.append(path(poly_d(rim), D.lin([(0, '#fff3c2'), (0.5, '#e6b858'), (1, '#9c6a1c')], 0, 0, 0.5, 1)))
    inner = inset(sil, 7.6)
    b.append(path(poly_d(inner), body))
    # bevel facets (soft) on the gold body
    light = (-0.5, -0.86)
    facets = []
    pts = scale_pts(outline, 0.86, (cx, cy))
    for i in range(10):
        p1 = pts[i]; p2 = pts[(i + 1) % 10]
        mx, my = (p1[0] + p2[0]) / 2 - cx, (p1[1] + p2[1]) / 2 - cy
        ln = math.hypot(mx, my) or 1
        shade = (mx * light[0] + my * light[1]) / ln
        col = '#fff7da' if shade > 0 else '#6e3f0c'
        op = min(0.32, abs(shade) * 0.34)
        facets.append(f'<path d="{poly_d([(cx, cy), p1, p2])}" fill="{col}" opacity="{op:.2f}"/>')
    clipb = D.clip(poly_d(inner))
    b.append(f'<g clip-path="{clipb}">' + ''.join(facets) +
             f'<ellipse cx="82" cy="66" rx="26" ry="14" fill="#fffbe8" opacity="0.4" filter="{D.blur(5)}"/>'
             f'<path d="{poly_d(inset(sil, 9.2))}" fill="none" stroke="#fff3c6" stroke-width="1" opacity="0.55"/></g>')
    # centre gem star
    gc = (97.3, 96.5)
    gout = fat_star(gc[0], gc[1], 22.5, 0.52)
    b.append(path(poly_d(inset(gout, -2.0, 0)), '#7a4c10', opacity=0.85))
    b.append(path(poly_d(inset(gout, -1.2, 0)), D.lin([(0, '#fff3c0'), (1, '#c08a2e')], 0, 0, 0, 1)))
    b.append(path(poly_d(gout), '#0b6a2c'))
    gem = []
    cols = ['#6ff59c', '#0e7a34', '#3fd473', '#0a6229', '#36c96a', '#0a5d27', '#28b45b', '#0c6a2d', '#4fe385', '#0e7330']
    for i in range(10):
        p1 = gout[i]; p2 = gout[(i + 1) % 10]
        gem.append(f'<path d="{poly_d([gc, p1, p2])}" fill="{cols[i]}"/>')
    b.append(''.join(gem))
    b.append(f'<path d="{poly_d(fat_star(gc[0], gc[1], 10, 0.55))}" fill="#9bffc0" opacity="0.4"/>')
    for (x, y, s) in [(91, 86, 2.6), (103, 104, 1.8)]:
        b.append(f'<path d="M{x},{y - s}Q{x},{y} {x + s},{y}Q{x},{y} {x},{y + s}Q{x},{y} {x - s},{y}Q{x},{y} {x},{y - s}Z" fill="#f2fff6" opacity="0.9"/>')
    return D.svg(''.join(b))


# -------------------------------------------------------------- DIAMOND ----
def diamond():
    D = Defs('dm')
    A0, A2, A4 = (62, 47.5), (95.5, 47.5), (130, 47.5)
    B0, B1, B2, B3, B4, B5, B6 = (38, 75.5), (52, 78), (65, 80), (96, 82.5), (126, 80), (140, 78), (155, 75.5)
    P = (95.5, 137)
    sil = [A0, A4, B6, P, B0]
    b = [shadow(D, poly_d(sil), 1, 3.5, 3, 0.36, '#2a1040')]

    def facet(pts, stops, x1=0, y1=0, x2=0, y2=1):
        return path(poly_d(pts), D.lin(stops, x1, y1, x2, y2))

    # pavilion (lower half)
    b.append(facet([B0, B1, P], [(0, '#5a24a6'), (0.5, '#3c1384'), (1, '#250a5a')], 0, 0, 1, 1))
    b.append(facet([B1, B2, P], [(0, '#7a3fd0'), (1, '#3a1282')], 0, 0, 1, 1))
    b.append(facet([B2, B3, P], [(0, '#6d36c6'), (0.55, '#5223a8'), (1, '#33107a')], 0, 0, 0, 1))
    b.append(facet([B3, B4, P], [(0, '#8d55e6'), (0.45, '#6e36d2'), (1, '#43169a')], 0, 0, 0, 1))
    b.append(facet([B4, B5, P], [(0, '#5a28b0'), (1, '#330f78')], 1, 0, 0, 1))
    b.append(facet([B5, B6, P], [(0, '#4a1a96'), (1, '#22075a')], 1, 0, 0, 1))
    # crown (upper half)
    b.append(facet([A0, B0, B1, B2], [(0, '#7444c8'), (0.6, '#4d1f9c'), (1, '#3a1484')], 0, 0, 1, 1))
    b.append(facet([A0, A2, B2], [(0, '#d9c4ff'), (0.4, '#a77ce8'), (1, '#7445c6')], 0, 0, 0.5, 1))
    b.append(facet([A2, B2, B3, B4], [(0, '#2f0d78'), (0.5, '#4a1ca2'), (1, '#6a35c4')], 0, 0, 0, 1))
    b.append(facet([A2, A4, B4], [(0, '#fbf7ff'), (0.45, '#e2d2ff'), (1, '#9f72e6')], 0.3, 0, 0.55, 1))
    b.append(facet([A4, B4, B5, B6], [(0, '#9467e0'), (0.6, '#6233b8'), (1, '#45178f')], 1, 0, 0, 1))
    # internal reflections / caustics (soft)
    bl = D.blur(1.3)
    for pts, col, op in [
        ([(66, 52), (86, 49.5), (71, 74)], '#ffffff', 0.5),
        ([(112, 50), (128, 49), (121, 73)], '#ffffff', 0.55),
        ([(90, 56), (97, 50), (99, 64), (95, 79)], '#a679ff', 0.6),
        ([(93, 70), (100, 70), (97, 81)], '#ffffff', 0.85),
        ([(46, 77), (57, 79), (80, 118)], '#c27cf0', 0.45),
        ([(60, 81), (70, 82), (90, 126)], '#d79cff', 0.35),
        ([(99, 86), (110, 85), (98, 128)], '#c5a0ff', 0.6),
        ([(128, 82), (140, 80), (104, 124)], '#9a5df0', 0.4),
        ([(42, 74), (60, 52), (64, 58), (50, 76)], '#b78cff', 0.35),
    ]:
        b.append(f'<path d="{poly_d(pts)}" fill="{col}" opacity="{op}" filter="{bl}"/>')
    b.append(f'<path d="M58,92 Q72,104 84,124" stroke="#f0b4ff" stroke-width="1.2" fill="none" opacity="0.6" filter="{D.blur(0.5)}"/>')
    # facet edges
    edges = [(A0, B2), (A2, B2), (A2, B4), (A4, B4), (B1, P), (B2, P), (B3, P), (B4, P), (B5, P), (A0, B1), (A4, B5)]
    e = ''.join(f'M{fmt(p[0])},{fmt(p[1])}L{fmt(q[0])},{fmt(q[1])}' for p, q in edges)
    b.append(f'<path d="{e}" stroke="#eadcff" stroke-width="0.75" opacity="0.6" fill="none"/>')
    girdle = smooth_d([B0, B1, B2, B3, B4, B5, B6], closed=False, tension=0.3)
    b.append(f'<path d="{girdle}" stroke="#f3e9ff" stroke-width="1.4" opacity="0.75" fill="none"/>')
    b.append(f'<path d="M{fmt(A0[0])},{fmt(A0[1])}L{fmt(A4[0])},{fmt(A4[1])}" stroke="#efe4ff" stroke-width="1.1" opacity="0.8"/>')
    b.append(path(poly_d(sil), 'none', '#24074e', 1.1, 0.95, 'stroke-linejoin="round"'))
    for (x, y, s) in [(122, 56, 4.5), (97.5, 77, 3.4), (70, 58, 2.6)]:
        b.append(f'<path d="M{x},{y - s}Q{x},{y} {x + s},{y}Q{x},{y} {x},{y + s}Q{x},{y} {x - s},{y}Q{x},{y} {x},{y - s}Z" fill="#fff" opacity="0.92"/>')
    return D.svg(''.join(b))


# ------------------------------------------------------------------ BAR ----
def notched_rect(x0, y0, x1, y1, r):
    """Rectangle with concave (inward) quarter-circle corners."""
    return (f'M{x0 + r},{y0} L{x1 - r},{y0} A{r},{r} 0 0 0 {x1},{y0 + r} L{x1},{y1 - r} '
            f'A{r},{r} 0 0 0 {x1 - r},{y1} L{x0 + r},{y1} A{r},{r} 0 0 0 {x0},{y1 - r} '
            f'L{x0},{y0 + r} A{r},{r} 0 0 0 {x0 + r},{y0} Z')


def bar_text(D, cx, cy, cap, sx=0.8, wght=700, spacing=-36):
    letters = ['B', 'A', 'R']
    s = cap / 700.0
    xs = []
    x = 0
    for ch in letters:
        d, adv, bb = GLYPHS[f'{ch}{wght}']
        xs.append(x)
        x += adv + spacing
    total = x - spacing
    out = []
    for ch, x in zip(letters, xs):
        d, adv, bb = GLYPHS[f'{ch}{wght}']
        out.append(f'<path d="{d}" transform="translate({fmt(x)},0)"/>')
    w = total * s * sx
    tx = cx - w / 2
    ty = cy + cap / 2
    return f'translate({fmt(tx)},{fmt(ty)}) scale({s * sx:.5f},{s:.5f})', ''.join(out)


def bar():
    D = Defs('br')
    x0, y0, x1, y1 = 24, 30.5, 168.5, 150.5
    sil = sample(notched_rect(x0, y0, x1, y1, 7), 700)
    d0 = poly_d(sil)
    b = [shadow(D, d0, 1.2, 3.2, 2.6, 0.42)]
    b.append(path(d0, '#5e3d0c'))
    b.append(path(poly_d(inset(sil, 0.8)), D.lin(GOLD_RIM, 0, 0, 1, 1)))
    b.append(path(poly_d(inset(sil, 2.4)), D.lin([(0, '#fff3c2'), (0.5, '#e9bb5a'), (1, '#b07b22')], 0, 0, 0.4, 1)))
    b.append(path(poly_d(inset(sil, 3.7)), '#3e2a08'))
    panel = inset(sil, 4.4)
    b.append(path(poly_d(panel), D.rad([(0, '#2aa560'), (0.45, '#16773d'), (0.85, '#0b4d25'), (1, '#073b1b')], 0.5, 0.48, 0.62)))
    clip = D.clip(poly_d(panel))
    g = [f'<g clip-path="{clip}">']
    # brushed sheen rays from the centre
    cx, cy = 96, 90
    for i, (a, w, op) in enumerate([(-35, 9, 0.10), (-12, 6, 0.08), (20, 10, 0.1), (48, 6, 0.08), (160, 8, 0.08), (195, 7, 0.07), (215, 9, 0.09)]):
        ra = math.radians(a)
        rw = math.radians(w)
        p1 = (cx + 120 * math.cos(ra - rw), cy + 120 * math.sin(ra - rw))
        p2 = (cx + 120 * math.cos(ra + rw), cy + 120 * math.sin(ra + rw))
        g.append(f'<path d="{poly_d([(cx, cy), p1, p2])}" fill="#b6ffd0" opacity="{op}"/>')
    g.append(f'<ellipse cx="96" cy="88" rx="38" ry="26" fill="#62e398" opacity="0.28" filter="{D.blur(9)}"/>')
    g.append('</g>')
    b += g
    # inner thin gold line
    b.append(path(poly_d(inset(sil, 8.6)), 'none', D.lin([(0, '#fbe7a8'), (1, '#c0902f')], 0, 0, 0, 1), 1.25, 0.95))
    # BAR lettering
    tf, glyphs = bar_text(D, 96.5, 91.5, 48)
    tgrad = D.lin([(0, '#fffbe0'), (0.22, '#f8e08f'), (0.5, '#e7b545'), (0.62, '#c9902c'), (0.8, '#f1c868'), (1, '#9c661c')], 0, 0, 0, 1)
    b.append(f'<g transform="{tf}">')
    b.append(f'<g fill="#03200d" opacity="0.65" transform="translate(30,60)" filter="{D.blur(28)}">{glyphs}</g>')
    b.append(f'<g fill="none" stroke="#3b2605" stroke-width="44" stroke-linejoin="round">{glyphs}</g>')
    b.append(f'<g fill="{tgrad}" stroke="#f3cf73" stroke-width="10">{glyphs}</g>')
    b.append(f'<g fill="{tgrad}">{glyphs}</g>')
    b.append('</g>')
    return D.svg(''.join(b))


# ----------------------------------------------------------- GOLD BARS ----
def gold():
    D = Defs('gb')
    ex = (0.70, -0.71)   # along the ingot (towards the back/right)
    ey = (0.95, 0.31)    # across the ingot (towards the viewer/right)
    ez = (0.0, -1.0)     # up
    L, W, H, T = 57.0, 33.0, 15.5, 3.6

    def P(x, y, z, o):
        return (o[0] + x * ex[0] + y * ey[0] + z * ez[0], o[1] + x * ex[1] + y * ey[1] + z * ez[1])

    def ingot(ox, oy, oz):
        o = P(ox, oy, oz, (0, 0))
        bot = [P(0, 0, 0, o), P(L, 0, 0, o), P(L, W, 0, o), P(0, W, 0, o)]
        top = [P(T, T, H, o), P(L - T, T, H, o), P(L - T, W - T, H, o), P(T, W - T, H, o)]
        return bot, top

    bars = [ingot(0, 0, 0), ingot(0, W + 3, 0), ingot(-1.5, (W + 3) / 2, H)]
    allp = [p for bt in bars for part in bt for p in part]
    minx = min(p[0] for p in allp); maxx = max(p[0] for p in allp)
    miny = min(p[1] for p in allp); maxy = max(p[1] for p in allp)
    s = min((153 - 40) / (maxx - minx), (135 - 44) / (maxy - miny))
    offx = 40 + ((153 - 40) - (maxx - minx) * s) / 2 - minx * s
    offy = 44 + ((135 - 44) - (maxy - miny) * s) / 2 - miny * s

    def tr(p):
        return (offx + p[0] * s, offy + p[1] * s)

    top_g = D.lin([(0, '#fff3c0'), (0.3, '#f7d886'), (0.65, '#e3ab45'), (1, '#c58428')], 0, 1, 1, 0)
    end_g = D.lin([(0, '#f6cf6c'), (0.5, '#dca13c'), (1, '#a9691c')], 0, 0, 0.3, 1)
    side_g = D.lin([(0, '#e6aa45'), (0.3, '#c8862a'), (0.7, '#975a14'), (1, '#b97f2c')], 0, 0, 0, 1)
    sil_pts = []
    faces = []
    for bot, top in bars:
        bot = [tr(p) for p in bot]
        top = [tr(p) for p in top]
        endf = [bot[0], bot[3], top[3], top[0]]
        side = [bot[3], bot[2], top[2], top[3]]
        faces.append((top, endf, side))
        sil_pts += bot + top
    from shapely.geometry import MultiPoint
    hull = list(MultiPoint(sil_pts).convex_hull.exterior.coords)[:-1]
    b = [shadow(D, poly_d(hull), 1.5, 3.5, 3.2, 0.42)]
    for top, endf, side in faces:
        b.append(path(poly_d(endf), end_g, '#6e420c', 0.6, None, 'stroke-linejoin="round"'))
        b.append(path(poly_d(side), side_g, '#6e420c', 0.6, None, 'stroke-linejoin="round"'))
        b.append(path(poly_d(top), top_g, '#9a6418', 0.5, None, 'stroke-linejoin="round"'))
        t0, t1, t2, t3 = top
        b.append(f'<path d="M{fmt(t3[0])},{fmt(t3[1])}L{fmt(t0[0])},{fmt(t0[1])}L{fmt(t1[0])},{fmt(t1[1])}" stroke="#fffbe6" stroke-width="0.9" fill="none" opacity="0.9"/>')
        b.append(f'<path d="M{fmt(t3[0])},{fmt(t3[1])}L{fmt(t2[0])},{fmt(t2[1])}" stroke="#fff1b8" stroke-width="0.9" fill="none" opacity="0.75"/>')
        # glossy streak along the long side + bevel shade near the bottom
        sa = (side[3][0] + (side[0][0] - side[3][0]) * 0.28, side[3][1] + (side[0][1] - side[3][1]) * 0.28)
        sc = (side[2][0] + (side[1][0] - side[2][0]) * 0.28, side[2][1] + (side[1][1] - side[2][1]) * 0.28)
        b.append(f'<path d="M{fmt(sa[0])},{fmt(sa[1])}L{fmt(sc[0])},{fmt(sc[1])}" stroke="#ffe7a6" stroke-width="2.2" opacity="0.5" filter="{D.blur(0.8)}"/>')
        ea = (endf[3][0] * 0.5 + endf[0][0] * 0.5, endf[3][1] * 0.5 + endf[0][1] * 0.5)
        b.append(f'<circle cx="{fmt(ea[0])}" cy="{fmt(ea[1] + 3)}" r="5" fill="#fff4c8" opacity="0.35" filter="{D.blur(2)}"/>')
        cxp = sum(p[0] for p in top) / 4
        cyp = sum(p[1] for p in top) / 4
        b.append(f'<ellipse cx="{fmt(cxp - 5)}" cy="{fmt(cyp + 2)}" rx="10" ry="3.6" transform="rotate(-45 {fmt(cxp)} {fmt(cyp)})" fill="#fffef4" opacity="0.5" filter="{D.blur(2)}"/>')
    return D.svg(''.join(b))


# ------------------------------------------------------------- REVOLVER ----
def revolver():
    """Shapes follow the traced silhouette of the reference (barrel up-right ~23deg)."""
    D = Defs('rv')

    def across(stops, a, b):
        return D.lin(stops, a[0], a[1], b[0], b[1], user=True)
    gold_frame = across([(0, '#fff2c2'), (0.25, '#f2c968'), (0.6, '#d49d3b'), (1, '#9a6418')], (66, 58), (80, 100))
    gold_cyl = across([(0, '#a8742a'), (0.12, '#e6bb5a'), (0.3, '#fffbe8'), (0.42, '#fbe8aa'), (0.56, '#d8a344'),
                       (0.72, '#8e5a14'), (0.88, '#6a400c'), (1, '#b88a3e')], (75.6, 61.4), (82.4, 85.6))
    black = across([(0, '#8c8c8c'), (0.22, '#3c3c3c'), (0.5, '#161616'), (1, '#050505')], (120, 42), (124.4, 52.4))
    grip_g = D.lin([(0, '#484848'), (0.3, '#1e1e1e'), (1, '#070707')], 0, 0, 1, 0.2)
    barrel = ('M97.6,53.2 L141.2,34.4 L143.4,30.8 L147.6,29.6 L151.4,30.6 L154.4,34.8 L155.2,38 '
              'Q154.8,39.6 152,40.6 L132,48.8 L128.6,52 L127.6,55.8 L104.2,65.4 L102.6,65 L102.4,60.6 L100.6,57.6Z')
    frame = ('M89.6,54.4 L99.8,57 L102.2,64.8 L101.8,67.4 L102.8,72.4 L104.4,78.8 L105.2,83.4 L103.2,85.8 '
             'L99.6,87.6 L95.6,92.6 L91.2,91.8 L85.4,92.6 L83.4,95 L78.2,98.4 L72,101.4 L61.6,101.8 '
             'L54.6,99.4 L47.6,100 L42.4,102.2 L40.8,98.6 L41.2,95.6 L47,91 L48.8,87 L51.4,83.4 L51.6,77.6 '
             'L52.8,74.8 L55.6,72 L55.6,67.8 L57,65.8 L61,64 L70.2,62.4 L73.6,60.4Z')
    topstrap = 'M57,65.8 L61,64 L70.2,62.4 L73.6,60.4 L89.6,54.4 L94,55.4 L60.6,68.6 Q57.2,69.4 57,65.8Z'
    cyl = ('M63.4,70 Q62.6,67.2 65.4,66 L88.8,56.8 Q92.2,55.8 93.2,58.8 L98.6,77.4 Q99.4,80.4 96.6,81.4 '
           'L71.2,88.8 Q68,89.6 67.2,86.6Z')
    hammer = 'M57.4,66.4 Q50.6,67.2 44.6,69.6 Q42.8,70.6 43.8,71.8 Q49.8,70.8 56.2,71.4Z'
    grip = ('M44.2,100.4 L48.6,98.6 L53.8,98.3 L55,101.4 L56.6,103.8 L59,106.8 L61.8,110.8 L60.8,118.8 '
            'L62.6,127.6 L62.2,132.4 L65.4,139.2 L68.2,141.8 Q69,143.6 66.6,145.4 L48.6,153.6 Q44.6,154.6 43,151.4 '
            'L41.2,145 L40.8,128 L40.8,119.8 L41.2,113 L41.6,107.6 L42.8,102.8Z')
    medal = 'M50.2,123.4 L53.8,129.6 L51,136 L47,130.6 L47.2,127Z'
    guard = (86.2, 96.8, 9.4)
    trig = 'M80.4,92.6 Q79.6,98 82.6,102.6 Q83.8,103.6 83.8,102 Q82.4,97.8 83.6,92.6Z'
    b = []
    sil = ''.join(path(x, '#000') for x in [barrel, frame, hammer, grip])
    sil += f'<circle cx="{guard[0]}" cy="{guard[1]}" r="{guard[2]}" fill="none" stroke="#000" stroke-width="2.4"/>'
    b.append(f'<g opacity="0.32" transform="translate(2,3)" filter="{D.blur(2.4)}">{sil}</g>')
    # trigger guard ring + trigger (behind frame)
    b.append(f'<circle cx="{guard[0]}" cy="{guard[1]}" r="{guard[2]}" fill="none" stroke="#7d6036" stroke-width="2.4"/>')
    b.append(f'<circle cx="{guard[0]}" cy="{guard[1]}" r="{guard[2]}" fill="none" stroke="{D.lin([(0, "#f6e6bf"), (0.5, "#cdb07c"), (1, "#8d7048")], 0, 0, 1, 1)}" stroke-width="1.3"/>')
    b.append(path(trig, gold_frame, '#6e4a12', 0.45))
    # grip
    b.append(path(grip, grip_g, '#000', 0.8))
    gclip = D.clip(grip)
    hatch = ''.join(f'M{20 + i * 2.4},96l26,62' for i in range(26)) + ''.join(f'M{20 + i * 2.4},158l26,-62' for i in range(26))
    b.append(f'<g clip-path="{gclip}"><path d="{hatch}" stroke="#5c5c5c" stroke-width="0.4" opacity="0.3"/>'
             f'<path d="M44.6,104 Q42.6,124 45,147" stroke="#a5a5a5" stroke-width="2.4" fill="none" opacity="0.4" filter="{D.blur(1.1)}"/>'
             f'<path d="M57,104 Q61,112 59.6,122 Q60.6,134 66,141" stroke="#000" stroke-width="3" fill="none" opacity="0.5" filter="{D.blur(1.2)}"/></g>')
    b.append(path(medal, D.lin([(0, '#fff3c0'), (0.5, '#e2b14f'), (1, '#9d6a1c')], 0, 0, 1, 1), '#5a3a0c', 0.45))
    b.append('<path d="M50.4,126.4 L52.2,129.7 L50.6,133.2 L48.8,129.8Z" fill="#c4122a"/>')
    b.append('<path d="M50.4,127.2 L51.3,129 L49.6,129Z" fill="#ff98a3" opacity="0.85"/>')
    # barrel
    b.append(path(barrel, black, '#000', 0.5))
    b.append('<path d="M101.6,55.6 L150.6,34.6" stroke="#b8b8b8" stroke-width="1.4" opacity="0.55"/>')
    b.append('<path d="M102.4,57.8 L151.6,36.8" stroke="#e2e2e2" stroke-width="0.5" opacity="0.35"/>')
    b.append('<path d="M106,62.8 L127.4,54" stroke="#5e5e5e" stroke-width="0.8" opacity="0.6"/>')
    b.append('<path d="M152.6,31.6 L154.8,37.6" stroke="#4a4a4a" stroke-width="1.3"/>')
    # frame, hammer, cylinder
    b.append(path(hammer, D.lin([(0, '#fff6d4'), (1, '#c99a48')], 0, 0, 0, 1), '#6e4510', 0.5))
    b.append(path(frame, gold_frame, '#6e4510', 0.6))
    b.append(path(topstrap, D.lin([(0, '#fff8d8'), (1, '#e3b04c')], 0, 0, 0, 1)))
    b.append(f'<path d="M66,89 L99,79 L103.6,84 L82,93Z" fill="#7a4a10" opacity="0.4" filter="{D.blur(1.2)}"/>')
    b.append(path(cyl, 'none', '#4a2a06', 1.2, 0.5))
    b.append(path(cyl, gold_cyl, '#6e4510', 0.55))
    b.append('<path d="M93.2,59 L98.6,77.4" stroke="#7a4c12" stroke-width="1" opacity="0.7"/>')
    b.append('<path d="M66.4,71 L89,61.8" stroke="#ffffff" stroke-width="1.1" opacity="0.6"/>')
    b.append('<path d="M57.6,65.6 L89.4,54.8" stroke="#fffbe8" stroke-width="0.8" opacity="0.9"/>')
    b.append('<circle cx="53.6" cy="88.6" r="1.1" fill="#7a5014" opacity="0.6"/>')
    b.append('<circle cx="101.4" cy="79" r="0.9" fill="#7a5014" opacity="0.6"/>')
    return D.svg(''.join(b))


# --------------------------------------------------------------- STATUE ----
FIGURE_PTS = [
    (91, 38), (89.5, 41.5), (85, 43.6), (80.5, 44.6), (78, 47), (76.8, 51), (75.3, 59), (74.6, 66),
    (74.6, 70.5), (76, 72.6), (79.4, 72.5), (82.4, 70.4), (85.6, 69.2), (88.5, 66.4), (90.6, 66.4),
    (86.4, 72), (83.2, 77), (81.2, 82.8), (80.2, 89), (80.8, 100), (83.4, 108), (84.8, 113.5),
    (85.4, 120), (84.8, 126), (85.4, 133), (86.8, 140), (88, 145), (88.4, 149.5), (87.6, 153),
    (86, 155.2), (104, 155.2), (102.2, 153.2), (100.6, 149.8), (100.6, 144.6), (102.4, 137),
    (103.8, 128), (103.6, 120), (104.4, 113.5), (106.6, 106), (108.2, 97), (108.6, 89), (108, 83),
    (106.2, 78), (103.6, 73.6), (102, 71.2), (103.6, 70.6), (108.8, 71.8), (112.6, 73.4),
    (114.8, 71.4), (115, 67), (113.8, 61), (113, 56), (111.6, 50), (110, 46), (107.6, 44.2),
    (103, 43.2), (100.2, 41.4), (99, 38),
]
HEAD_PTS = [(85.2, 30.4), (84.5, 26), (85.8, 21.6), (89.6, 18.9), (94.8, 18.1), (100, 18.9), (103.6, 21.6),
            (104.8, 26), (104.2, 30.2), (102.4, 32.2), (99.2, 35.6), (94.8, 37.2), (90.6, 35.6), (87.2, 32.2)]


def curtain_folds(D, side):
    """Velvet curtain: dark base, light ridges and dark valleys sweeping outward at the bottom."""
    out = []
    widths = [1.0, 0.75, 1.2, 0.9, 1.1, 0.8, 1.25, 0.95, 1.05]
    n = len(widths)
    tot = sum(widths)
    soft = D.blur(1.3)
    soft2 = D.blur(2.6)
    acc = 0
    curves = []
    for i in range(n + 1):
        t = acc / tot
        if i < n:
            acc += widths[i]
        xt = 32 + t * 56
        xb = 4 + t * 60
        if side > 0:
            xt, xb = 190 - xt, 190 - xb
        curves.append(((xt, 14), (xt, 118), (xb, 172)))
    first, last = curves[0], curves[-1]
    region = (f'M{fmt(first[0][0])},14 Q{fmt(first[1][0])},118 {fmt(first[2][0])},172 '
              f'L{fmt(last[2][0])},172 Q{fmt(last[1][0])},118 {fmt(last[0][0])},14Z')
    out.append(path(region, D.lin([(0, '#a8101b'), (0.55, '#8c0c16'), (1, '#4a0308')], 0, 0, 0, 1)))
    for i in range(n):
        a, c = curves[i], curves[i + 1]
        mid = tuple(((a[k][0] * 0.45 + c[k][0] * 0.55), a[k][1]) for k in range(3))
        dmid = f'M{fmt(mid[0][0])},{mid[0][1]} Q{fmt(mid[1][0])},{mid[1][1]} {fmt(mid[2][0])},{mid[2][1]}'
        dval = f'M{fmt(a[0][0])},{a[0][1]} Q{fmt(a[1][0])},{a[1][1]} {fmt(a[2][0])},{a[2][1]}'
        w = abs(c[0][0] - a[0][0])
        out.append(f'<path d="{dval}" stroke="#2c0004" stroke-width="{fmt(w * 0.5)}" fill="none" opacity="0.9" filter="{soft2}"/>')
        out.append(f'<path d="{dmid}" stroke="#e62a36" stroke-width="{fmt(w * 0.5)}" fill="none" opacity="0.85" filter="{soft}"/>')
        out.append(f'<path d="{dmid}" stroke="#ff6b72" stroke-width="{fmt(max(0.8, w * 0.12))}" fill="none" opacity="0.6" transform="translate({-0.5 * side},0)" filter="{D.blur(0.4)}"/>')
    return out


def statue():
    D = Defs('sa')
    cx, cy, R = 95, 90.5, 74
    b = []
    circ = poly_d(ellipse_pts(cx, cy, R, R, 120))
    b.append(shadow(D, circ, 1, 3, 2.8, 0.4))
    b.append(f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="#5e3a0c"/>')
    b.append(f'<circle cx="{cx}" cy="{cy}" r="{R - 0.8}" fill="{D.lin(GOLD_RIM, 0.15, 0, 0.85, 1)}"/>')
    b.append(f'<circle cx="{cx}" cy="{cy}" r="{R - 2.4}" fill="{D.lin([(0, "#b9842f"), (0.45, "#fff1bc"), (1, "#a8732a")], 1, 0, 0, 1)}"/>')
    b.append(f'<circle cx="{cx}" cy="{cy}" r="{R - 3.9}" fill="#4a3008"/>')
    inner_r = R - 4.5
    clip = D.clip(poly_d(ellipse_pts(cx, cy, inner_r, inner_r, 120)))
    b.append(f'<g clip-path="{clip}">')
    b.append(f'<circle cx="{cx}" cy="{cy}" r="{inner_r}" fill="{D.rad([(0, "#6a0910"), (0.7, "#3a0307"), (1, "#1e0103")], 0.5, 0.4, 0.62)}"/>')
    b += curtain_folds(D, -1)
    b += curtain_folds(D, 1)
    # dark gap behind the statue and vignette
    b.append(f'<path d="M82,14 Q76,92 72,172 L118,172 Q114,92 108,14Z" fill="#300205" opacity="0.8" filter="{D.blur(6)}"/>')
    b.append(f'<circle cx="{cx}" cy="{cy}" r="{inner_r}" fill="{D.rad([(0, "#000", 0), (0.55, "#000", 0), (1, "#000", 0.7)], 0.5, 0.42, 0.56)}"/>')
    b.append(f'<path d="M18,118 Q95,146 172,118 L172,172 L18,172Z" fill="#140002" opacity="0.6" filter="{D.blur(9)}"/>')
    b.append('</g>')
    b.append(f'<path d="M40,47 A{R - 1.5},{R - 1.5} 0 0 1 82,18" stroke="#fffbe6" stroke-width="1.5" fill="none" opacity="0.85" filter="{D.blur(0.5)}"/>')
    b.append(f'<path d="M150,136 A{R - 1.5},{R - 1.5} 0 0 1 118,160" stroke="#fff3c8" stroke-width="1.2" fill="none" opacity="0.6" filter="{D.blur(0.5)}"/>')
    b.append(statue_figure(D))
    return D.svg(''.join(b))


def statue_figure(D):
    cyl = [(0, '#fffbe6'), (0.12, '#ffe7a2'), (0.3, '#eab95a'), (0.55, '#b37625'), (0.8, '#653b08'), (1, '#8f5c1e')]

    def part(pts, tension=0.5, stops=cyl, x1=0, y1=0, x2=1, y2=0, stroke='#5a3608', sw=0.3):
        d = smooth_d(pts, tension=tension)
        return d, path(d, D.lin(stops, x1, y1, x2, y2), stroke, sw)

    torso_pts = [(84, 43.8), (80.6, 45.4), (80.2, 49), (81.8, 56), (83.4, 66), (84.8, 74), (82.4, 82), (80.6, 90),
                 (82, 97), (88, 100.4), (94.8, 101.4), (101.6, 100.4), (107.6, 97), (108.8, 90), (107.2, 82),
                 (104.8, 74), (106.2, 66), (107.8, 56), (109.4, 49), (109, 45.4), (105.6, 43.8), (100, 41.4), (89.6, 41.4)]
    legl = [(81, 91), (80.6, 100), (82.6, 108), (84.6, 114), (85.4, 120), (84.8, 127), (85.4, 134), (87, 141),
            (88, 147), (88.4, 151), (87.2, 154.8), (94.4, 155), (94.6, 150), (94.4, 140), (94.8, 128), (94.8, 115),
            (95, 100), (94.8, 95), (88, 92)]
    legr = [(108.6, 91), (108.4, 100), (106.6, 107.4), (104.8, 113.8), (104, 120), (104.2, 128), (103, 136), (101, 144),
            (100.6, 150), (101.8, 154.8), (95.2, 155), (95.2, 150), (95.2, 140), (95, 128), (95, 115), (94.8, 100),
            (95, 95), (101.6, 92)]
    arml = [(80.6, 44.2), (77.4, 47.6), (75.8, 56), (74.8, 65), (75, 70.6), (77.2, 72.8), (80.4, 71.4), (81.4, 64),
            (82.2, 55), (84.4, 47.4)]
    armr = [(109, 44.2), (112.2, 47.6), (113.8, 56), (114.8, 65), (114.6, 70.6), (112.4, 72.8), (109.2, 71.4),
            (108.2, 64), (107.4, 55), (105.2, 47.4)]
    forel = [(75.6, 70), (78, 73.2), (83, 71), (88.8, 67.6), (92.8, 66.8), (93.8, 62.8), (90.4, 61.8), (84.6, 64.6),
             (79.6, 66.8), (76.4, 68)]
    forer = [(114, 70), (111.6, 73.2), (106.6, 71), (100.8, 67.6), (96.8, 66.8), (95.8, 62.8), (99.2, 61.8),
             (105, 64.6), (110, 66.8), (113.2, 68)]
    neck = [(91.4, 33.6), (98.2, 33.6), (99.6, 42.8), (95, 44), (90, 42.8)]
    head = [(88.2, 26.6), (88.8, 21.4), (91.6, 19), (94.8, 18.4), (98, 19), (100.8, 21.4), (101.4, 26.6), (100.8, 31),
            (98.6, 34.8), (94.8, 36.6), (91, 34.8), (88.8, 31)]
    hair = [(87.2, 29.6), (86.6, 24.4), (88.2, 20), (91.4, 17.8), (94.8, 17.2), (98.2, 17.8), (101.4, 20), (103, 24.4),
            (102.4, 29.6), (101, 26), (99.2, 23.4), (94.8, 22), (90.4, 23.4), (88.6, 26)]
    base = ('M86,153.6 L104,153.6 Q106,153.6 106.4,156 L107,157.4 L111.5,158.2 Q113.5,158.8 113.5,160.8 '
            'L113.5,162.2 Q113.5,164 111,164 L79,164 Q76.5,164 76.5,162.2 L76.5,160.8 Q76.5,158.8 78.5,158.2 '
            'L83,157.4 L83.6,156 Q84,153.6 86,153.6Z')
    sil = ''.join(f'<path d="{smooth_d(p)}"/>' for p in [torso_pts, legl, legr, arml, armr, head, hair])
    out = [f'<g fill="#140001" opacity="0.55" transform="translate(1.8,1.6)" filter="{D.blur(1.7)}">{sil}</g>']
    out.append(path(base, D.lin([(0, '#ffeeb0'), (0.5, '#dcaa4c'), (1, '#93601a')], 0, 0, 0, 1), '#5e3a0c', 0.5))
    out.append('<path d="M78,158.8 L112,158.8" stroke="#fff3c4" stroke-width="0.8" opacity="0.85"/>')
    out.append('<path d="M85,154.4 L105,154.4" stroke="#fff3c4" stroke-width="0.6" opacity="0.7"/>')
    for pts in (legl, legr):
        out.append(part(pts)[1])
    td, tp = part(torso_pts, stops=[(0, '#fff8de'), (0.12, '#fbe19a'), (0.36, '#e3ae4e'), (0.66, '#a56b1f'), (0.88, '#5e3606'), (1, '#7c4e14')])
    out.append(tp)
    tclip = D.clip(td)
    out.append(f'<g clip-path="{tclip}">'
               f'<ellipse cx="89.4" cy="55.6" rx="4.6" ry="4.2" fill="{D.rad([(0, "#fff6d2"), (0.5, "#e8b752"), (1, "#a8701f")], 0.35, 0.3, 0.7)}" stroke="#6b4510" stroke-width="0.4"/>'
               f'<ellipse cx="100.2" cy="55.6" rx="4.6" ry="4.2" fill="{D.rad([(0, "#f6d884"), (0.5, "#c88f34"), (1, "#7e4e12")], 0.35, 0.3, 0.7)}" stroke="#6b4510" stroke-width="0.4"/>'
               '<path d="M86.6,88 Q90.4,93 94.8,97 Q99.2,93 103,88" stroke="#6b4510" stroke-width="0.6" fill="none" opacity="0.45"/>'
               '<path d="M85,79 Q94.8,82.6 104.6,79" stroke="#7a4c12" stroke-width="0.7" fill="none" opacity="0.45"/>'
               '<circle cx="94.8" cy="80.6" r="0.7" fill="#6b4510" opacity="0.7"/></g>')
    out.append(f'<path d="M94.8,97 L94.8,153" stroke="#3a1e02" stroke-width="1.6" opacity="0.8" filter="{D.blur(0.5)}"/>')
    for pts in (arml, armr):
        out.append(part(pts, stroke='#3d2204', sw=0.6)[1])
    out.append(part(neck)[1])
    out.append(part(forel, stops=cyl, x1=0, y1=0, x2=0.3, y2=1, stroke='#3d2204', sw=0.6)[1])
    out.append(part(forer, stops=cyl, x1=0, y1=0, x2=0.3, y2=1, stroke='#3d2204', sw=0.6)[1])
    # sword held vertically (handle up to the chin, blade down to the hips)
    out.append(path('M94,35.6 L95.6,35.6 L95.9,59 L96.8,60.6 L94.8,96 L92.8,60.6 L93.7,59Z',
                    D.lin([(0, '#fff3c6'), (0.5, '#d6a046'), (1, '#8a5a17')], 0, 0, 1, 0), '#4e2e06', 0.4))
    out.append(f'<ellipse cx="94.8" cy="63.6" rx="4.4" ry="3.8" fill="{D.rad([(0, "#fff6d2"), (0.6, "#dca64a"), (1, "#8a5a17")], 0.35, 0.35, 0.7)}" stroke="#4e2e06" stroke-width="0.45"/>')
    out.append('<path d="M91,62.6 Q94.8,60.8 98.6,62.6 M91,64.8 Q94.8,63 98.6,64.8" stroke="#6b4510" stroke-width="0.55" fill="none"/>')
    out.append(part(head, stops=[(0, '#fff6d2'), (0.3, '#f4d27c'), (0.7, '#c08530'), (1, '#865617')])[1])
    out.append(part(hair, stops=[(0, '#fff3c4'), (0.5, '#e6b552'), (1, '#9a6418')], x1=0, y1=0, x2=1, y2=1)[1])
    out.append('<path d="M89.4,21.6 Q91.6,20.2 93.6,21.8 M96,21.8 Q98.4,20.2 100.4,21.6" stroke="#7a4c12" stroke-width="0.55" fill="none" opacity="0.85"/>')
    out.append('<path d="M91.6,27.8 L93.6,27.6 M96.2,27.6 L98.2,27.8" stroke="#5e3a0c" stroke-width="0.75"/>')
    out.append('<path d="M94.9,28.2 L94.5,31.4 L95.6,31.6" stroke="#7a4c12" stroke-width="0.5" fill="none"/>')
    out.append('<path d="M93.4,33.6 Q94.9,34.4 96.4,33.6" stroke="#6b4510" stroke-width="0.6" fill="none"/>')
    out.append(f'<ellipse cx="90.8" cy="27.4" rx="1.5" ry="3.2" fill="#fffbe8" opacity="0.65" filter="{D.blur(0.6)}"/>')
    # specular highlights on the left (light from upper left)
    hl = D.blur(0.7)
    for d in ['M77.4,49 Q76.4,58 76.6,66', 'M83.4,108 Q85.6,114 86.6,120', 'M82.6,95 Q82.2,102 83.8,107',
              'M86.2,128 Q86.6,136 88.4,143', 'M82.6,58 Q84.6,66 84.8,74', 'M97.4,108 Q98.4,113 97.8,118',
              'M97,128 Q97.6,136 97,143']:
        out.append(f'<path d="{d}" stroke="#fffbe8" stroke-width="1.5" fill="none" opacity="0.75" filter="{hl}"/>')
    return ''.join(out)


SYMBOLS = {
    'revolver': revolver,
    'gold': gold,
    'diamond': diamond,
    'star': star,
    'bar': bar,
    'seven': seven,
    'statue': statue,
}
