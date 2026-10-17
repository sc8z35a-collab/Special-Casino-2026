"""Path helpers for the background pattern generator."""


def fmt(v):
    s = f'{v:.1f}'
    if s.endswith('.0'):
        s = s[:-2]
    if s == '-0':
        s = '0'
    return s


def smooth_d(pts, closed=True, tension=0.5):
    """Catmull-Rom spline through points -> cubic bezier path data."""
    n = len(pts)
    P = [(float(x), float(y)) for x, y in pts]
    d = f'M{fmt(P[0][0])},{fmt(P[0][1])}'
    for i in range(n if closed else n - 1):
        p0 = P[(i - 1) % n] if (closed or i > 0) else P[i]
        p1 = P[i]
        p2 = P[(i + 1) % n]
        p3 = P[(i + 2) % n] if (closed or i + 2 < n) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 3, p1[1] + (p2[1] - p0[1]) * tension / 3)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 3, p2[1] - (p3[1] - p1[1]) * tension / 3)
        d += f'C{fmt(c1[0])},{fmt(c1[1])} {fmt(c2[0])},{fmt(c2[1])} {fmt(p2[0])},{fmt(p2[1])}'
    if closed:
        d += 'Z'
    return d
