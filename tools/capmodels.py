# 20 моделей NFT-кепки Mestario (15 за улучшение + 5 только из крафта), у каждой своя анимация.
# Основа — фото кепки с присланной картинки (вырезка m_cap_cut.png). Запуск:
#   python3 tools/capmodels.py <папка с вырезками>   →  gifts/m/cap/<id>.svg
import math, os, random, sys
import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, os.path.dirname(__file__))
from mgifts_real import load, data_uri, atf, an, spin, kt_s, SHD  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "gifts", "m", "cap")
X, Y, W = 6, 10, 108          # где стоит фото в поле 120×120
BASE = load("m_cap")
K = W / BASE.size[0]
H = BASE.size[1] * K
LOGO_BOX = (113, 103, 201, 175)


def P(x, y):
    return X + x * K, Y + y * K


LX, LY = P((LOGO_BOX[0] + LOGO_BOX[2]) / 2, (LOGO_BOX[1] + LOGO_BOX[3]) / 2)   # центр логотипа


def logo_layer(im):
    """Только синий логотип (по цвету), с мягким краем."""
    a = np.asarray(im).astype(np.int32)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    m = ((b > r + 40) & (b > 95) & (al > 150)).astype(np.uint8) * 255
    mi = Image.fromarray(m).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = im.copy()
    out.putalpha(Image.fromarray((np.asarray(mi).astype(np.float32) * al / 255).astype(np.uint8)))
    return out


def no_logo(im):
    """Кепка без логотипа: синий участок закрашивается тканью вокруг (inpaint)."""
    import cv2
    a = np.asarray(im)
    rgb = np.ascontiguousarray(a[..., :3])
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    m = ((b > r + 25) & (b > 70)).astype(np.uint8) * 255
    m = cv2.dilate(m, np.ones((7, 7), np.uint8))
    fixed = cv2.inpaint(rgb, m, 9, cv2.INPAINT_TELEA)
    return Image.fromarray(np.dstack([fixed, a[..., 3]]), "RGBA")


LOGO = logo_layer(BASE)


def img_def(im, id_, q=84):
    return f'<image id="{id_}" href="{data_uri(im, 340, q)}" x="{X}" y="{Y}" width="{W:.2f}" height="{H:.2f}"/>'


COMMON_DEFS = (SHD + '<filter id="white" x="0" y="0" width="1" height="1"><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter>'
               '<mask id="cm" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><use href="#cap" filter="url(#white)"/></mask>')


def svg(body, defs="", base=None, logo=True):
    d = img_def(base or BASE, "cap") + (img_def(LOGO, "logo") if logo else "") + COMMON_DEFS + defs
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs>{d}</defs>{body}</svg>'


def shadow(rx=40, op=.32, inner=""):
    return f'<ellipse cx="60" cy="104" rx="{rx}" ry="6" fill="url(#shd)" opacity="{op}">{inner}</ellipse>'


def inside_points(n, seed, margin=6, region=None):
    """Случайные точки на самой кепке (в координатах 120×120)."""
    rnd = random.Random(seed)
    a = np.asarray(BASE.getchannel("A"))
    pts = []
    while len(pts) < n:
        x, y = rnd.randrange(a.shape[1]), rnd.randrange(a.shape[0])
        if a[y, x] > 220 and (region is None or region(x, y)):
            pts.append(P(x, y))
    return pts


def sweep(dur, op=.5, width=18, col="#fff", begin="0s", angle=20, kt=None, vals=None):
    """Блик, пробегающий по кепке."""
    vals = vals or ["-50 0", "140 0"]
    m = f'<animateTransform attributeName="transform" type="translate" values="{";".join(vals)}" dur="{dur}s" begin="{begin}" repeatCount="indefinite"' + (f' keyTimes="{kt_s(kt)}"' if kt else "") + "/>"
    return (f'<g mask="url(#cm)"><g>{m}<rect x="0" y="-10" width="{width}" height="140" fill="url(#sw)" opacity="{op}" transform="rotate({angle} 0 60)"/></g></g>',
            f'<linearGradient id="sw" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{col}" stop-opacity="0"/><stop offset=".5" stop-color="{col}" stop-opacity=".9"/><stop offset="1" stop-color="{col}" stop-opacity="0"/></linearGradient>')


def twinkles(pts, col, dur, size=2.6, seed=1):
    rnd = random.Random(seed)
    s = ""
    for (x, y) in pts:
        b = rnd.uniform(0, dur)
        star = f"M0 {-size}L{size * .25} {-size * .25}L{size} 0L{size * .25} {size * .25}L0 {size}L{-size * .25} {size * .25}L{-size} 0L{-size * .25} {-size * .25}Z"
        s += (f'<path d="{star}" transform="translate({x:.1f} {y:.1f})" fill="{col}" opacity="0">'
              f'<animate attributeName="opacity" values="0;1;0" keyTimes="0;.5;1" dur="{dur * .4:.2f}s" begin="{b:.2f}s" repeatCount="indefinite"/></path>')
    return s


# ─────────────── 15 моделей за улучшение ───────────────
def classic():
    # медленный «поворот на 360» (сжатие по ширине до ребра и разворот) + глянцевый блик по козырьку
    turn = atf("scale", ["1 1", "1 1", ".14 1", "-1 1", ".14 1", "1 1"], 9, [0, .3, .45, .6, .8, 1])
    sw, sd = sweep(4, .45, 14)
    body = shadow(inner=an("rx", [40, 40, 14, 40, 14, 40], 9, [0, .3, .45, .6, .8, 1]))
    body += f'<g transform="translate(60 0)"><g>{turn}<g transform="translate(-60 0)"><use href="#cap"/>{sw}</g></g></g>'
    return svg(body, sd)


def neon():
    pulse = an("opacity", [.25, 1, .45, .95, .25], 1.6, [0, .12, .3, .42, 1])
    defs = ('<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.2"/>'
            '<feGaussianBlur stdDeviation="2.4"/><feFlood flood-color="#3d8bff"/><feComposite operator="in" in2="SourceGraphic"/></filter>'
            '<filter id="glow2" x="-30%" y="-30%" width="160%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="1.2" result="d"/>'
            '<feGaussianBlur in="d" stdDeviation="2.4" result="b"/><feFlood flood-color="#4f9bff"/><feComposite operator="in" in2="b"/></filter>'
            '<filter id="lg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2"/><feColorMatrix values="0 0 0 0 .35 0 0 0 0 .65 0 0 0 0 1 0 0 0 1.6 0"/></filter>')
    body = shadow()
    body += f'<g opacity=".25">{pulse}<use href="#cap" filter="url(#glow2)"/></g><use href="#cap"/>'
    body += f'<g opacity=".25">{pulse}<use href="#logo" filter="url(#lg)"/><use href="#logo"/></g>'
    return svg(body, defs)


def carbon():
    defs = ('<pattern id="cf" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">'
            '<rect width="4" height="4" fill="#0b0c10"/><rect width="2" height="2" fill="#3a3f4a"/><rect x="2" y="2" width="2" height="2" fill="#3a3f4a"/>'
            '<rect width="2" height="1" fill="#5a606d"/><rect x="2" y="2" width="2" height="1" fill="#5a606d"/></pattern>')
    sh = an("opacity", [.28, .46, .28], 3)
    body = shadow() + '<use href="#cap"/>'
    body += f'<g mask="url(#cm)"><rect width="120" height="120" fill="url(#cf)" opacity=".34">{sh}</rect></g><use href="#logo"/>'
    sw, sd = sweep(3.2, .3, 22, "#9cc4ff")
    body += sw
    pts = inside_points(9, 3, region=lambda x, y: not (LOGO_BOX[0] - 6 < x < LOGO_BOX[2] + 6 and LOGO_BOX[1] - 6 < y < LOGO_BOX[3] + 6))
    body += twinkles(pts, "#7fb8ff", 2.4, 2.4, 5)
    return svg(body, defs + sd)


def cyber():
    defs = ('<linearGradient id="strap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a404d"/><stop offset="1" stop-color="#14161c"/></linearGradient>'
            '<linearGradient id="buckle" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2f6ff"/><stop offset=".5" stop-color="#8b94a6"/><stop offset="1" stop-color="#3b414d"/></linearGradient>'
            '<filter id="lg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.8"/><feColorMatrix values="0 0 0 0 .55 0 0 0 0 .85 0 0 0 0 1 0 0 0 2 0"/></filter>')
    body = shadow() + '<use href="#cap"/>'
    # ремешки поперёк купола и пряжки
    straps = [(P(238, 54), P(250, 212)), (P(298, 86), P(318, 204))]
    for (a, b) in straps:
        body += f'<path d="M{a[0]:.1f} {a[1]:.1f}Q{(a[0] + b[0]) / 2 - 6:.1f} {(a[1] + b[1]) / 2:.1f} {b[0]:.1f} {b[1]:.1f}" stroke="url(#strap)" stroke-width="4.2" fill="none" stroke-linecap="round"/>'
        body += f'<path d="M{a[0]:.1f} {a[1]:.1f}Q{(a[0] + b[0]) / 2 - 6:.1f} {(a[1] + b[1]) / 2:.1f} {b[0]:.1f} {b[1]:.1f}" stroke="#7fb5ff" stroke-width=".5" fill="none" stroke-dasharray="1.2 2" opacity=".8"/>'
        mx, my = (a[0] + b[0]) / 2 - 3, (a[1] + b[1]) / 2
        body += f'<rect x="{mx - 3.4:.1f}" y="{my - 2.6:.1f}" width="6.8" height="5.2" rx="1" fill="url(#buckle)" stroke="#0b0c10" stroke-width=".4"/><rect x="{mx - 1.6:.1f}" y="{my - 1:.1f}" width="3.2" height="2" fill="#0b0c10"/>'
        # искры тока
        rnd = random.Random(int(mx))
        for i in range(3):
            pts = [(mx + rnd.uniform(-2, 2), my)]
            for j in range(4):
                pts.append((pts[-1][0] + rnd.uniform(-4, 4), pts[-1][1] + rnd.uniform(-5, -2) * (1 if i % 2 else -1)))
            d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
            b0 = rnd.uniform(0, 1.2)
            body += (f'<path d="{d}" fill="none" stroke="#bfe0ff" stroke-width=".7" opacity="0"><animate attributeName="opacity" values="0;1;0;1;0" '
                     f'keyTimes="0;.05;.1;.15;.2" dur="1.4s" begin="{b0:.2f}s" repeatCount="indefinite"/></path>')
    blink = an("opacity", [0, 0, 1, 0, 1, 0, 0], 2.4, [0, .6, .63, .66, .7, .74, 1], "discrete")
    body += f'<use href="#logo"/><g opacity="0">{blink}<use href="#logo" filter="url(#lg)"/><use href="#logo" filter="url(#lg)"/></g>'
    return svg(body, defs)


def stealth():
    defs = ('<filter id="matte"><feColorMatrix type="saturate" values=".15"/><feComponentTransfer><feFuncR type="gamma" exponent="1.25" amplitude=".82"/>'
            '<feFuncG type="gamma" exponent="1.25" amplitude=".82"/><feFuncB type="gamma" exponent="1.25" amplitude=".86"/></feComponentTransfer></filter>'
            '<radialGradient id="dark"><stop offset="0" stop-color="#000" stop-opacity=".75"/><stop offset=".7" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'
            '<filter id="flare" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.6"/><feColorMatrix values="0 0 0 0 .7 0 0 0 0 .88 0 0 0 0 1 0 0 0 2.4 0"/></filter>')
    kt = [0, .5, .58, .7, 1]
    body = f'<circle cx="60" cy="62" r="58" fill="url(#dark)" opacity=".5">{an("opacity", [.45, .75, .9, .75, .45], 4, kt)}</circle>'
    body += shadow(op=.4) + '<use href="#cap" filter="url(#matte)"/><use href="#logo" opacity=".85"/>'
    body += f'<g opacity="0">{an("opacity", [0, 0, 1, .2, 0], 4, kt)}<use href="#logo" filter="url(#flare)"/><use href="#logo"/></g>'
    return svg(body, defs)


def gold():
    defs = ('<filter id="au"><feColorMatrix values="0 0 0 0 1  0 0 0 0 .78  0 0 0 0 .3  0 0 0 1 0"/></filter>'
            '<linearGradient id="aug" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".5" stop-color="#f4c542"/><stop offset="1" stop-color="#a86f12"/></linearGradient>'
            '<filter id="ag" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.6"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 .82 0 0 0 0 .35 0 0 0 1.4 0"/></filter>')
    kt = [0, .3, .5, .8, 1]
    body = shadow() + '<use href="#cap"/><use href="#logo"/>'
    lx0, ly0, lx1, ly1 = *P(LOGO_BOX[0], LOGO_BOX[1]), *P(LOGO_BOX[2], LOGO_BOX[3])
    body += (f'<g opacity="0">{an("opacity", [0, 0, 1, 1, 0], 5, kt)}<use href="#logo" filter="url(#ag)"/>'
             f'<g mask="url(#lm)"><rect x="{lx0 - 2:.1f}" y="{ly0 - 2:.1f}" width="{lx1 - lx0 + 4:.1f}" height="{ly1 - ly0 + 4:.1f}" fill="url(#aug)"/></g></g>')
    defs += '<mask id="lm" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><use href="#logo" filter="url(#white)"/></mask>'
    # золотые пылинки кружатся вокруг кепки
    rnd = random.Random(8)
    for i in range(14):
        rx, ry = rnd.uniform(40, 54), rnd.uniform(14, 24)
        cy = rnd.uniform(48, 74)
        d = f"M{60 - rx:.1f} {cy:.1f}A{rx:.1f} {ry:.1f} 0 1 0 {60 + rx:.1f} {cy:.1f}A{rx:.1f} {ry:.1f} 0 1 0 {60 - rx:.1f} {cy:.1f}"
        dur = rnd.uniform(4, 7)
        body += (f'<circle r="{rnd.uniform(.5, 1.2):.2f}" fill="#ffd866"><animateMotion path="{d}" dur="{dur:.2f}s" begin="{-rnd.uniform(0, dur):.2f}s" repeatCount="indefinite"/>'
                 f'<animate attributeName="opacity" values="0;1;.2;1;0" dur="{dur / 2:.2f}s" repeatCount="indefinite"/></circle>')
    return svg(body, defs)


def holo():
    # логотип плавно проходит цвета радуги (кибер-синий держится дольше) и рассыпается на пиксели
    cols = [("#4f8dff", "0 0 0 0 .31 0 0 0 0 .55 0 0 0 0 1"), ("#5ff2ff", "0 0 0 0 .37 0 0 0 0 .95 0 0 0 0 1"),
            ("#7dffcb", "0 0 0 0 .49 0 0 0 0 1 0 0 0 0 .8"), ("#b98cff", "0 0 0 0 .73 0 0 0 0 .55 0 0 0 0 1"), ("#ff9ef0", "0 0 0 0 1 0 0 0 0 .62 0 0 0 0 .94")]
    defs = ""
    for i, (_, m) in enumerate(cols):
        defs += f'<filter id="h{i}"><feColorMatrix in="SourceGraphic" values="{m} 0 0 0 1 0" result="c"/><feBlend in="c" in2="SourceGraphic" mode="screen"/></filter>'
    D, n = 5, len(cols)
    body = shadow() + '<use href="#cap"/><use href="#logo"/>'
    for i in range(n):
        c0 = i / n
        kt = [0, max(0, c0 - .06), c0 + .06, c0 + .16, min(1, c0 + .26), 1] if i else [0, .08, .18, .86, .94, 1]
        vals = [0, 0, .95, .95, 0, 0] if i else [.95, .95, .2, .2, .95, .95]
        kt = sorted(set(round(k, 3) for k in kt))
        if len(kt) != len(vals):
            vals = vals[:len(kt)]
        body += f'<use href="#logo" filter="url(#h{i})" opacity="0">{an("opacity", vals, D, kt)}</use>'
    sw, sd = sweep(2.2, .35, 10, "#c8f4ff")
    body += sw
    rnd = random.Random(4)
    cols = [c for c, _ in cols]
    for i in range(16):
        x0, y0 = LX + rnd.uniform(-10, 10), LY + rnd.uniform(-8, 8)
        dx, dy = rnd.uniform(-22, 22), rnd.uniform(-20, 10)
        b = rnd.uniform(0, 2.4)
        body += (f'<rect x="{x0:.1f}" y="{y0:.1f}" width="1.6" height="1.6" fill="{cols[i % 5]}" opacity="0">'
                 f'<animateTransform attributeName="transform" type="translate" values="0 0;{dx:.1f} {dy:.1f}" dur="1.6s" begin="{b:.2f}s" repeatCount="indefinite"/>'
                 f'<animate attributeName="opacity" values="0;1;0" dur="1.6s" begin="{b:.2f}s" repeatCount="indefinite"/></rect>')
    return svg(body, sd + defs)


def mesh():
    defs = ('<pattern id="mesh" width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            '<rect width="3.2" height="3.2" fill="#07080b"/><circle cx="1.6" cy="1.6" r="1.05" fill="#2c313b"/>'
            '<animateTransform attributeName="patternTransform" type="translate" additive="sum" values="0 0;0 1.6;0 0" dur="1.4s" repeatCount="indefinite"/></pattern>'
            '<clipPath id="back"><path d="' + "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in [P(262, 62), P(310, 80), P(340, 140), P(336, 215), P(282, 218), P(272, 140)]) + 'Z"/></clipPath>'
            '<linearGradient id="mf" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>')
    breeze = atf("skewX", ["0", "2", "-1", "0"], 2.8)
    body = shadow()
    body += f'<g transform="translate(60 98)"><g>{breeze}<g transform="translate(-60 -98)"><use href="#cap"/>'
    breathe = an("opacity", [.55, .85, .55], 1.4)
    body += f'<g clip-path="url(#back)" mask="url(#cm)"><rect width="120" height="120" fill="url(#mesh)" opacity=".7">{breathe}</rect><rect width="120" height="120" fill="url(#mf)"/></g>'
    body += "<use href=\"#logo\"/></g></g></g>"
    return svg(body, defs)


def rider():
    D = 3.2
    kt = [0, .25, .35, .55, .62, .7, 1]
    jump = atf("translate", ["0 0", "0 0", "0 -22", "0 -22", "0 0", "0 0", "0 0"], D, kt)
    flip = atf("rotate", ["0 60 62", "0 60 62", "0 60 62", "360 60 62", "360 60 62", "360 60 62", "360 60 62"], D, kt, add=True)
    kick = atf("scale", ["1 1", "1 1", "1 1", "-1 1", "1 1", "1 1", "1 1"], D, [0, .25, .35, .45, .55, .7, 1])
    land = atf("scale", ["1 1", "1 1", "1 1", "1 1", "1.06 .92", "1 1", "1 1"], D, kt, add=True)
    body = shadow(inner=an("rx", [40, 40, 24, 24, 44, 40, 40], D, kt))
    body += (f'<g>{jump}<g>{flip}<g transform="translate(60 98)"><g>{land}<g transform="translate(-60 -98)">'
             f'<g transform="translate(60 0)"><g>{kick}<g transform="translate(-60 0)"><use href="#cap"/></g></g></g></g></g></g></g></g>')
    # след «кикфлипа»
    body += (f'<path d="M30 40A30 22 0 0 1 90 40" fill="none" stroke="#7fb5ff" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="3 3" opacity="0">'
             f'{an("opacity", [0, 0, .8, 0, 0], D, [0, .35, .45, .58, 1])}</path>')
    return svg(body)


def velvet():
    defs = ('<filter id="vel"><feColorMatrix values="1.05 0 .08 0 .02  0 .95 .05 0 0  .12 0 1.1 0 .05  0 0 0 1 0"/><feGaussianBlur stdDeviation=".25"/></filter>'
            '<radialGradient id="sheen"><stop offset="0" stop-color="#d9c2ff" stop-opacity=".55"/><stop offset="1" stop-color="#d9c2ff" stop-opacity="0"/></radialGradient>')
    body = shadow() + '<use href="#cap" filter="url(#vel)"/>'
    for i, (dur, ry) in enumerate([(3.6, 16), (4.4, 12)]):
        body += (f'<g mask="url(#cm)"><ellipse cx="0" cy="{50 + i * 18}" rx="28" ry="{ry}" fill="url(#sheen)">'
                 f'<animate attributeName="cx" values="-10;130" dur="{dur}s" begin="{i * 1.4}s" repeatCount="indefinite"/></ellipse></g>')
    body += '<use href="#logo"/>'
    return svg(body, defs)


def acid():
    defs = ('<filter id="boil" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".09" numOctaves="2" seed="3" result="n">'
            '<animate attributeName="baseFrequency" values=".07;.12;.07" dur="2.4s" repeatCount="indefinite"/></feTurbulence>'
            '<feDisplacementMap in="SourceGraphic" in2="n" scale="3.4" xChannelSelector="R" yChannelSelector="G"/>'
            '<feColorMatrix values="0 0 0 0 .16  0 0 0 0 .93  0 0 0 0 1  0 0 0 1 0"/></filter>'
            '<filter id="ag" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2"/><feColorMatrix values="0 0 0 0 .1 0 0 0 0 .9 0 0 0 0 1 0 0 0 1.8 0"/></filter>'
            '<radialGradient id="core"><stop offset="0" stop-color="#e9ffff"/><stop offset="1" stop-color="#e9ffff" stop-opacity="0"/></radialGradient>')
    body = shadow() + '<use href="#cap"/>'
    body += f'<g>{an("opacity", [.7, 1, .7], 1.2)}<use href="#logo" filter="url(#ag)"/></g><use href="#logo" filter="url(#boil)"/>'
    # «кипение» изнутри наружу
    body += (f'<ellipse cx="{LX:.1f}" cy="{LY:.1f}" rx="2" ry="2" fill="url(#core)" mask="url(#lm)">'
             f'<animate attributeName="rx" values="1;14" dur="1.6s" repeatCount="indefinite"/><animate attributeName="ry" values="1;12" dur="1.6s" repeatCount="indefinite"/>'
             f'<animate attributeName="opacity" values=".9;0" dur="1.6s" repeatCount="indefinite"/></ellipse>')
    defs += '<mask id="lm" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><use href="#logo" filter="url(#white)"/></mask>'
    return svg(body, defs)


NOLOGO = None


def minimalist():
    global NOLOGO
    NOLOGO = NOLOGO or no_logo(BASE)
    D = 3.6
    floaty = atf("translate", ["0 1.5", "0 -3", "0 1.5"], D)
    defs = ('<radialGradient id="halo"><stop offset="0" stop-color="#4f8dff" stop-opacity=".45"/><stop offset="1" stop-color="#4f8dff" stop-opacity="0"/></radialGradient>'
            '<linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9bcbff"/><stop offset=".5" stop-color="#4f8dff"/><stop offset="1" stop-color="#2d58e8"/></linearGradient>')
    s = 7
    d = f"M{LX - s / 2:.2f} {LY + s * .43:.2f}V{LY - s * .43:.2f}L{LX:.2f} {LY + s * .06:.2f}L{LX + s / 2:.2f} {LY - s * .43:.2f}V{LY + s * .43:.2f}"
    body = f'<ellipse cx="60" cy="60" rx="50" ry="40" fill="url(#halo)">{an("opacity", [.6, 1, .6], D)}</ellipse>'
    body += shadow(inner=an("rx", [40, 32, 40], D))
    body += (f'<g>{floaty}<use href="#cap"/><g transform="rotate(-8 {LX:.1f} {LY:.1f})"><path d="{d}" fill="none" stroke="url(#mg)" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>'
             f'<path d="{d}" fill="none" stroke="#e6f1ff" stroke-opacity=".6" stroke-width=".5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-.35 -.35)"/></g></g>')
    return svg(body, defs, base=NOLOGO, logo=False)


def wash():
    defs = ('<filter id="den"><feColorMatrix values=".5 .1 .2 0 .06  .1 .55 .25 0 .1  .1 .2 .85 0 .18  0 0 0 1 0"/></filter>'
            '<filter id="blot" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency=".055 .11" numOctaves="3" seed="7">'
            '<animate attributeName="seed" values="7;8;9;10;11;12;7" dur="4.2s" calcMode="discrete" repeatCount="indefinite"/></feTurbulence>'
            '<feColorMatrix values="0 0 0 0 .92  0 0 0 0 .95  0 0 0 0 1  2.2 0 0 0 -1.15"/></filter>'
            '<linearGradient id="wave" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cfe2ff" stop-opacity="0"/><stop offset=".5" stop-color="#cfe2ff" stop-opacity=".55"/><stop offset="1" stop-color="#cfe2ff" stop-opacity="0"/></linearGradient>')
    body = shadow() + '<use href="#cap" filter="url(#den)"/>'
    body += '<g mask="url(#cm)"><rect width="120" height="120" filter="url(#blot)" opacity=".32"/>'
    for i in range(3):
        y = 40 + i * 16
        body += (f'<path d="M-40 {y}Q-30 {y - 4} -20 {y}T0 {y}T20 {y}T40 {y}T60 {y}T80 {y}T100 {y}T120 {y}T140 {y}" fill="none" stroke="url(#wave)" stroke-width="1.6" opacity=".7">'
                 f'<animateTransform attributeName="transform" type="translate" values="0 0;40 0" dur="{2.4 + i * .6:.1f}s" repeatCount="indefinite"/></path>')
    body += '</g><use href="#logo"/>'
    return svg(body, defs)


def titanium():
    defs = ('<linearGradient id="ti" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dee6"/><stop offset=".35" stop-color="#8a92a0"/><stop offset=".65" stop-color="#4a515d"/><stop offset="1" stop-color="#aab2be"/></linearGradient>')
    rock = atf("rotate", ["-4 60 98", "4 60 98", "-4 60 98"], 3.6)
    body = shadow()
    body += f'<g>{rock}<use href="#cap"/>'
    plates = [[P(246, 104), P(290, 94), P(300, 150), P(254, 160)], [P(258, 168), P(304, 158), P(316, 200), P(266, 210)]]
    for i, pl in enumerate(plates):
        d = "M" + " L".join(f"{x:.1f} {y:.1f}" for x, y in pl) + "Z"
        body += f'<path d="{d}" fill="url(#ti)" stroke="#2a2f38" stroke-width=".6" stroke-linejoin="round"/>'
        for (x, y) in pl:
            cx, cy = x + (sum(p[0] for p in pl) / 4 - x) * .18, y + (sum(p[1] for p in pl) / 4 - y) * .18
            body += f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r=".7" fill="#2a2f38"/><circle cx="{cx - .2:.1f}" cy="{cy - .2:.1f}" r=".3" fill="#fff"/>'
        body += (f'<clipPath id="pc{i}"><path d="{d}"/></clipPath><g clip-path="url(#pc{i})"><rect x="-30" y="0" width="8" height="120" fill="#fff" opacity=".8" transform="rotate(25 0 60)">'
                 f'<animate attributeName="x" values="-30;150" dur="2.4s" begin="{i * .3}s" repeatCount="indefinite"/></rect></g>')
        # холодные искры от пластины
        mx = sum(p[0] for p in pl) / 4
        my = min(p[1] for p in pl)
        for j in range(5):
            ang = math.radians(-90 + (j - 2) * 25)
            body += (f'<path d="M{mx:.1f} {my:.1f}l{math.cos(ang) * 3:.1f} {math.sin(ang) * 3:.1f}" stroke="#d6ecff" stroke-width=".7" stroke-linecap="round" opacity="0">'
                     f'<animateTransform attributeName="transform" type="translate" values="0 0;{math.cos(ang) * 9:.1f} {math.sin(ang) * 9:.1f}" dur="1.8s" begin="{i * .9:.1f}s" repeatCount="indefinite"/>'
                     f'<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;.08;.3;1" dur="1.8s" begin="{i * .9:.1f}s" repeatCount="indefinite"/></path>')
    body += '<use href="#logo"/></g>'
    return svg(body, defs)


def glitch():
    D = 2.6
    defs = ('<filter id="rch"><feColorMatrix values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .8 0"/></filter>'
            '<filter id="cch"><feColorMatrix values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .8 0"/></filter>')
    rnd = random.Random(21)
    bands = [(0, 30), (30, 46), (46, 58), (58, 70), (70, 84), (84, 120)]
    gk = [0, .5, .52, .55, .58, .62, .66, 1]
    body = shadow()
    for i, (a, b) in enumerate(bands):
        defs += f'<clipPath id="b{i}"><rect x="0" y="{a}" width="120" height="{b - a}"/></clipPath>'
        off = [0, 0] + [rnd.choice([-1, 1]) * rnd.uniform(2, 8) for _ in range(4)] + [0, 0]
        vals = [f"{o:.1f} 0" for o in off]
        body += f'<g clip-path="url(#b{i})"><g><animateTransform attributeName="transform" type="translate" values="{";".join(vals)}" keyTimes="{kt_s(gk)}" dur="{D}s" repeatCount="indefinite" calcMode="discrete"/><use href="#cap"/></g></g>'
    rg = an("opacity", [0, 0, .7, 0, .6, 0, 0, 0], D, gk, "discrete")
    body += f'<g opacity="0">{rg}<use href="#cap" filter="url(#rch)" transform="translate(-2.4 0)"/></g>'
    body += f'<g opacity="0">{rg}<use href="#cap" filter="url(#cch)" transform="translate(2.4 .6)"/></g>'
    body += '<use href="#logo"/>'
    # полосы помех
    for i in range(4):
        y = rnd.uniform(25, 95)
        body += (f'<rect x="{rnd.uniform(5, 40):.1f}" y="{y:.1f}" width="{rnd.uniform(30, 70):.1f}" height="{rnd.uniform(.8, 2.2):.1f}" fill="{["#5ff", "#f5f", "#fff", "#4f8dff"][i]}" opacity="0">'
                 f'{an("opacity", [0, 0, .8, 0, .7, 0, 0, 0], D, gk, "discrete")}</rect>')
    return svg(body, defs)


# ─────────────── 5 моделей только из крафта ───────────────
def winter():
    defs = ('<filter id="wool" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="4"/>'
            '<feColorMatrix values="0 0 0 0 .85  0 0 0 0 .88  0 0 0 0 .95  1.6 0 0 0 -.65"/></filter>')
    body = shadow() + '<use href="#cap"/><g mask="url(#cm)"><rect width="120" height="120" filter="url(#wool)" opacity=".28"/></g><use href="#logo"/>'
    rnd = random.Random(9)
    flake = '<path d="M0 -2.2V2.2M-1.9 -1.1L1.9 1.1M-1.9 1.1L1.9 -1.1" stroke="#fff" stroke-width=".55" stroke-linecap="round"/>'
    visor = [P(60, 238), P(100, 232), P(150, 236), P(200, 244)]
    for i in range(16):
        dur = rnd.uniform(3.2, 5.5)
        b = -rnd.uniform(0, dur)
        if i < 6:   # садятся на козырёк и тают
            tx, ty = visor[i % 4]
            tx += rnd.uniform(-6, 6)
            body += (f'<g opacity="0"><animateMotion path="M{tx + rnd.uniform(-10, 10):.1f} -4L{tx:.1f} {ty:.1f}" keyPoints="0;1;1" keyTimes="0;.7;1" calcMode="linear" dur="{dur:.2f}s" begin="{b:.2f}s" repeatCount="indefinite"/>'
                     f'<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.75;1" dur="{dur:.2f}s" begin="{b:.2f}s" repeatCount="indefinite"/>'
                     f'<g><animateTransform attributeName="transform" type="scale" values="1;1;.2" keyTimes="0;.72;1" dur="{dur:.2f}s" begin="{b:.2f}s" repeatCount="indefinite"/>{flake}</g></g>')
        else:
            x = rnd.uniform(4, 116)
            body += (f'<g opacity=".85"><animateMotion path="M{x:.1f} -4Q{x + rnd.uniform(-12, 12):.1f} 60 {x + rnd.uniform(-6, 6):.1f} 124" dur="{dur:.2f}s" begin="{b:.2f}s" repeatCount="indefinite"/>'
                     f'<g transform="scale({rnd.uniform(.6, 1.1):.2f})">{flake}</g></g>')
    return svg(body, defs)


def reflex():
    D = 3
    kt = [0, .55, .62, .72, 1]
    defs = ('<linearGradient id="rf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#cfe2ff"/><stop offset="1" stop-color="#7fb0ff"/></linearGradient>'
            '<filter id="spark" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2"/></filter>'
            '<filter id="refl"><feColorMatrix values=".9 .1 .2 0 .06  .1 .9 .2 0 .08  .1 .2 1 0 .12  0 0 0 1 0"/></filter>')
    body = shadow() + '<use href="#cap" filter="url(#refl)"/><use href="#logo"/>'
    body += f'<g mask="url(#cm)"><rect width="120" height="120" fill="url(#rf)" opacity="0">{an("opacity", [0, 0, .85, 0, 0], D, kt)}</rect></g>'
    sw, sd = sweep(D, .7, 26, "#eef5ff", vals=["-60 0", "-60 0", "150 0", "150 0"], kt=[0, .5, .75, 1])
    body += sw
    star = "M0 -9L1.4 -1.4L9 0L1.4 1.4L0 9L-1.4 1.4L-9 0L-1.4 -1.4Z"
    sx, sy = P(250, 110)
    body += f'<g transform="translate({sx:.1f} {sy:.1f})" opacity="0">{an("opacity", [0, 0, 1, 0, 0], D, kt)}<path d="{star}" fill="#fff" filter="url(#spark)"/><path d="{star}" fill="#fff" transform="scale(.6)"/></g>'
    return svg(body, sd + defs)


def crown():
    D = 4.4
    kt = [0, .25, .38, .7, .82, 1]
    defs = ('<linearGradient id="cr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".55" stop-color="#f2bd3c"/><stop offset="1" stop-color="#4f8dff"/></linearGradient>'
            '<filter id="cg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2"/></filter>'
            '<filter id="lg" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2"/><feColorMatrix values="0 0 0 0 .4 0 0 0 0 .7 0 0 0 0 1 0 0 0 1.5 0"/></filter>')
    c = "M-15 6L-17 -8L-8 -1L0 -12L8 -1L17 -8L15 6Z"
    body = shadow() + '<use href="#cap"/>'
    body += f'<g opacity=".7">{an("opacity", [.5, .9, .5], 2.2)}<use href="#logo" filter="url(#lg)"/></g><use href="#logo"/>'
    cx, cy = P(175, 20)
    body += (f'<g transform="translate({cx:.1f} {cy + 2:.1f})" opacity="0">{an("opacity", [0, 0, 1, 1, 0, 0], D, kt)}'
             f'<g>{atf("scale", [".4 .4", ".4 .4", "1 1", "1 1", "1.15 1.15", "1.15 1.15"], D, kt)}'
             f'<path d="{c}" fill="#ffd866" filter="url(#cg)" opacity=".6"/><path d="{c}" fill="url(#cr)" stroke="#fff6cc" stroke-width=".6" stroke-linejoin="round"/>'
             f'<path d="M-14 3.4H14" stroke="#4f8dff" stroke-width="1"/><circle cx="0" cy="-12" r="1.4" fill="#7fe9ff"/><circle cx="-17" cy="-8" r="1.1" fill="#7fe9ff"/><circle cx="17" cy="-8" r="1.1" fill="#7fe9ff"/>'
             f'<path d="M-15 6L-17 -8L-8 -1L0 -12L8 -1L17 -8L15 6" fill="none" stroke="#bfe6ff" stroke-width=".4" stroke-dasharray="1 1.2" opacity=".9"/></g></g>')
    return svg(body, defs)


def ocean():
    defs = ('<filter id="navy"><feColorMatrix values=".2 .05 .05 0 .01  .05 .3 .1 0 .04  .1 .15 .7 0 .14  0 0 0 1 0"/></filter>'
            '<radialGradient id="bub" cx="35%" cy="35%" r="65%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".3" stop-color="#bfe6ff" stop-opacity=".25"/><stop offset="1" stop-color="#7fb5ff" stop-opacity=".35"/></radialGradient>')
    sway = atf("translate", ["-1 0", "1 -1", "-1 0"], 4)
    body = shadow() + f'<g>{sway}<use href="#cap" filter="url(#navy)"/><use href="#logo"/></g>'
    rnd = random.Random(14)
    for i in range(13):
        x = rnd.uniform(8, 112)
        r = rnd.uniform(1, 2.8)
        dur = rnd.uniform(3, 6)
        b = -rnd.uniform(0, dur)
        body += (f'<circle r="{r:.2f}" fill="url(#bub)" stroke="#d9efff" stroke-opacity=".6" stroke-width=".35">'
                 f'<animateMotion path="M{x:.1f} 118Q{x + rnd.uniform(-8, 8):.1f} 70 {x + rnd.uniform(-5, 5):.1f} -4" dur="{dur:.2f}s" begin="{b:.2f}s" repeatCount="indefinite"/>'
                 f'<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.85;1" dur="{dur:.2f}s" begin="{b:.2f}s" repeatCount="indefinite"/></circle>')
    return svg(body, defs)


def founder():
    defs = ('<linearGradient id="pt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa6b8"/><stop offset=".45" stop-color="#ffffff"/><stop offset=".55" stop-color="#cfe9ff"/><stop offset="1" stop-color="#9aa6b8"/>'
            '<animateTransform attributeName="gradientTransform" type="translate" values="-1 0;1 0" dur="2.4s" repeatCount="indefinite"/></linearGradient>'
            '<filter id="pg" x="-30%" y="-30%" width="160%" height="160%"><feMorphology in="SourceAlpha" operator="dilate" radius="1" result="d"/><feGaussianBlur in="d" stdDeviation="2.2" result="b"/>'
            '<feFlood flood-color="#e6eeff"/><feComposite operator="in" in2="b"/></filter>'
            '<linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#bfe0ff" stop-opacity=".35"/><stop offset="1" stop-color="#bfe0ff" stop-opacity="0"/></linearGradient>'
            '<pattern id="scan" width="4" height="1.6" patternUnits="userSpaceOnUse"><rect width="4" height=".7" fill="#fff" opacity=".35"/></pattern>')
    body = f'<g opacity=".45">{an("opacity", [.3, .7, .3], 2.4)}<use href="#cap" filter="url(#pg)"/></g>'
    body += shadow() + '<use href="#cap"/><use href="#logo"/>'
    body += '<path d="M44 34L76 34L68 52L52 52Z" fill="url(#beam)"/>'
    flick = an("opacity", [.85, 1, .7, 1, .9], .5)
    body += (f'<g>{flick}<text x="60" y="16" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="13" letter-spacing="1.6" fill="url(#pt)">FOUNDER</text>'
             f'<text x="60" y="29" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="9" letter-spacing="3" fill="url(#pt)">2026</text>'
             f'<rect x="10" y="4" width="100" height="27" fill="url(#scan)" opacity=".35"><animate attributeName="y" values="4;5.6;4" dur=".4s" repeatCount="indefinite"/></rect></g>')
    return svg(body, defs)


MODELS = [
    # id, имя, редкость, вес, только крафт, функция
    ("cap_classic", "Classic Black", "common", 160, False, classic),
    ("cap_neon", "Neon Glow", "rare", 50, False, neon),
    ("cap_carbon", "Carbon Fiber", "epic", 14, False, carbon),
    ("cap_cyber", "Cyber Punk", "rare", 50, False, cyber),
    ("cap_stealth", "Stealth Ops", "common", 160, False, stealth),
    ("cap_gold", "Gold Edition", "legendary", 4, False, gold),
    ("cap_holo", "Holographic M", "epic", 14, False, holo),
    ("cap_mesh", "Mesh Summer", "common", 160, False, mesh),
    ("cap_rider", "Urban Rider", "rare", 50, False, rider),
    ("cap_velvet", "Velvet Night", "rare", 50, False, velvet),
    ("cap_acid", "Acid Blue", "rare", 50, False, acid),
    ("cap_mini", "Minimalist", "common", 160, False, minimalist),
    ("cap_wash", "Acid Wash", "rare", 50, False, wash),
    ("cap_titan", "Titanium Shield", "epic", 14, False, titanium),
    ("cap_glitch", "Glitch Art", "epic", 14, False, glitch),
    ("cap_winter", "Winter Wool", "common", 350, True, winter),
    ("cap_reflex", "Reflex 360", "rare", 220, True, reflex),
    ("cap_crown", "Crown M", "legendary", 40, True, crown),
    ("cap_ocean", "Deep Ocean", "common", 350, True, ocean),
    ("cap_founder", "Founder 2026", "legendary", 40, True, founder),
]

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for mid, name, rar, w, craft, fn in MODELS:
        s = fn()
        with open(os.path.join(OUT, mid + ".svg"), "w") as fh:
            fh.write(s)
        print(mid, len(s) // 1024, "KB")
