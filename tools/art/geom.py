"""Geometry helpers for the symbol/icon generators.

All art is authored in SVG user units.  Smooth outlines are written as SVG
path data, sampled into polygons and offset with shapely so bevels/rims are
true insets of the silhouette (SVG itself has no path-offset primitive).
"""
import math
import numpy as np
from shapely.geometry import Polygon
from svgpathtools import parse_path


def sample(d, n=480):
    """Sample an SVG path into a closed polygon (list of (x, y))."""
    p = parse_path(d)
    pts = [p.point(t) for t in np.linspace(0, 1, n, endpoint=False)]
    return [(z.real, z.imag) for z in pts]


def inset(pts, dist, simplify=0.12):
    """Offset a polygon inwards (dist > 0) or outwards (dist < 0)."""
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = poly.buffer(0)
    out = poly.buffer(-dist, join_style=1, quad_segs=10)
    if out.geom_type == 'MultiPolygon':
        out = max(out.geoms, key=lambda g: g.area)
    if simplify:
        out = out.simplify(simplify)
    return list(out.exterior.coords)[:-1]


def fmt(v):
    s = f'{v:.1f}'
    if s.endswith('.0'):
        s = s[:-2]
    if s == '-0':
        s = '0'
    return s


def poly_d(pts):
    return 'M' + 'L'.join(f'{fmt(x)},{fmt(y)}' for x, y in pts) + 'Z'


def smooth_d(pts, closed=True, tension=0.5):
    """Catmull-Rom spline through points -> cubic bezier path data."""
    n = len(pts)
    P = [np.array(p, float) for p in pts]
    d = f'M{fmt(P[0][0])},{fmt(P[0][1])}'
    rng = range(n if closed else n - 1)
    for i in rng:
        p0 = P[(i - 1) % n] if (closed or i > 0) else P[i]
        p1 = P[i]
        p2 = P[(i + 1) % n]
        p3 = P[(i + 2) % n] if (closed or i + 2 < n) else p2
        c1 = p1 + (p2 - p0) * tension / 3
        c2 = p2 - (p3 - p1) * tension / 3
        d += f'C{fmt(c1[0])},{fmt(c1[1])} {fmt(c2[0])},{fmt(c2[1])} {fmt(p2[0])},{fmt(p2[1])}'
    if closed:
        d += 'Z'
    return d


def line_intersect(p1, p2, p3, p4):
    x1, y1 = p1; x2, y2 = p2; x3, y3 = p3; x4, y4 = p4
    den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
    return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))


def star_points(tips):
    """Given 5 tips (clockwise from top) return the 10-point star outline."""
    T, R, BR, BL, L = tips
    i_tr = line_intersect(T, BR, L, R)
    i_r = line_intersect(R, BL, T, BR)
    i_b = line_intersect(BL, R, BR, L)
    i_l = line_intersect(L, BR, T, BL)
    i_tl = line_intersect(T, BL, L, R)
    return [T, i_tr, R, i_r, BR, i_b, BL, i_l, L, i_tl]


def scale_pts(pts, s, c):
    cx, cy = c
    return [(cx + (x - cx) * s, cy + (y - cy) * s) for x, y in pts]


def centroid(pts):
    return Polygon(pts).centroid.coords[0]


def rot(p, ang_deg, c=(0, 0)):
    a = math.radians(ang_deg)
    x, y = p[0] - c[0], p[1] - c[1]
    return (c[0] + x * math.cos(a) - y * math.sin(a), c[1] + x * math.sin(a) + y * math.cos(a))


def ellipse_pts(cx, cy, rx, ry, n=64, a0=0.0):
    return [(cx + rx * math.cos(a0 + 2 * math.pi * i / n), cy + ry * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


class Defs:
    """Collects <defs> entries with unique ids per symbol."""

    def __init__(self, prefix):
        self.prefix = prefix
        self.items = []
        self.n = 0

    def _id(self, kind):
        self.n += 1
        return f'{self.prefix}{kind}{self.n}'

    @staticmethod
    def _stops(stops):
        out = []
        for st in stops:
            if len(st) == 2:
                o, c = st
                out.append(f'<stop offset="{o}" stop-color="{c}"/>')
            else:
                o, c, a = st
                out.append(f'<stop offset="{o}" stop-color="{c}" stop-opacity="{a}"/>')
        return ''.join(out)

    def lin(self, stops, x1=0, y1=0, x2=0, y2=1, user=False):
        i = self._id('l')
        units = ' gradientUnits="userSpaceOnUse"' if user else ''
        self.items.append(f'<linearGradient id="{i}" x1="{fmt(x1)}" y1="{fmt(y1)}" x2="{fmt(x2)}" y2="{fmt(y2)}"{units}>{self._stops(stops)}</linearGradient>')
        return f'url(#{i})'

    def rad(self, stops, cx=0.5, cy=0.5, r=0.5, fx=None, fy=None, user=False, transform=None):
        i = self._id('r')
        units = ' gradientUnits="userSpaceOnUse"' if user else ''
        f = ''
        if fx is not None:
            f = f' fx="{fmt(fx)}" fy="{fmt(fy)}"'
        t = f' gradientTransform="{transform}"' if transform else ''
        self.items.append(f'<radialGradient id="{i}" cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}"{f}{units}{t}>{self._stops(stops)}</radialGradient>')
        return f'url(#{i})'

    def blur(self, sd):
        i = self._id('b')
        self.items.append(f'<filter id="{i}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="{sd}"/></filter>')
        return f'url(#{i})'

    def clip(self, d):
        i = self._id('c')
        self.items.append(f'<clipPath id="{i}"><path d="{d}"/></clipPath>')
        return f'url(#{i})'

    def svg(self, body, w=192, h=182):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
                f'<defs>{"".join(self.items)}</defs>{body}</svg>')


def path(d, fill='none', stroke=None, sw=None, opacity=None, extra=''):
    a = f'<path d="{d}" fill="{fill}"'
    if stroke:
        a += f' stroke="{stroke}"'
    if sw is not None:
        a += f' stroke-width="{fmt(sw)}"'
    if opacity is not None:
        a += f' opacity="{opacity}"'
    if extra:
        a += ' ' + extra
    return a + '/>'
