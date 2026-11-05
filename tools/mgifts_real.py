# Коллекция Mestario в реалистичном виде: вырезанные из присланной картинки фото предметов + анимация SMIL.
# Вход: папка с вырезками <id>_cut.png (фон убран нейросетью ISNet). Запуск:
#   python3 tools/mgifts_real.py <папка с вырезками>   →  gifts/m/<id>.svg
import base64, io, os, random, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = os.path.join(os.path.dirname(__file__), "..", "gifts", "m")
EASE = ".45 0 .55 1"


def kt_s(k):
    return ";".join(f"{x:.4f}" for x in k)


def atf(kind, values, dur, kt=None, add=False, spline=True):
    n = len(values)
    kt = kt or [i / (n - 1) for i in range(n)]
    s = f'<animateTransform attributeName="transform" type="{kind}" dur="{dur}s" repeatCount="indefinite" values="{";".join(values)}" keyTimes="{kt_s(kt)}"'
    if spline:
        s += f' calcMode="spline" keySplines="{";".join([EASE] * (n - 1))}"'
    return s + (' additive="sum"' if add else "") + "/>"


def an(attr, values, dur, kt=None, mode=None):
    n = len(values)
    kt = kt or [i / (n - 1) for i in range(n)]
    return f'<animate attributeName="{attr}" dur="{dur}s" repeatCount="indefinite" values="{";".join(map(str, values))}" keyTimes="{kt_s(kt)}"' + (f' calcMode="{mode}"' if mode else "") + "/>"


def spin(dur, rev=False):
    a, b = (360, 0) if rev else (0, 360)
    return f'<animateTransform attributeName="transform" type="rotate" from="{a}" to="{b}" dur="{dur}s" repeatCount="indefinite"/>'


def load(name):
    """Вырезка + очистка краёв: убираем белый ореол фона из полупрозрачных пикселей."""
    im = Image.open(os.path.join(SRC, name + "_cut.png")).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    al = a[..., 3:4] / 255.0
    rgb = a[..., :3]
    safe = np.maximum(al, 0.05)
    fg = np.clip((rgb - (1 - al) * 255.0) / safe, 0, 255)
    # почти белые и почти прозрачные пиксели — остатки фона
    light = rgb.mean(axis=2, keepdims=True)
    haze = (light > 200) & (al < 0.6)
    al2 = np.where(haze, al * 0.25, al)
    al2 = np.where(al2 < 0.04, 0, al2)
    out = np.concatenate([np.where(al > 0.98, rgb, fg), al2 * 255], axis=2).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def data_uri(im, maxside=320, q=84):
    im = im.copy()
    im.thumbnail((maxside, maxside), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, "WEBP", quality=q, method=6)
    return "data:image/webp;base64," + base64.b64encode(b.getvalue()).decode()


def image(im, x, y, w, maxside=320):
    """Картинка в координатах 120×120: левый верх (x, y), ширина w."""
    h = w * im.size[1] / im.size[0]
    return f'<image href="{data_uri(im, maxside)}" x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}"/>', w / im.size[0]


def svg(body, defs=""):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs>{defs}</defs>{body}</svg>'


def shadow(cx, cy, rx, ry, op=.32, inner=""):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#shd)" opacity="{op}">{inner}</ellipse>'


SHD = '<radialGradient id="shd"><stop offset="0" stop-color="#000" stop-opacity=".9"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>'


def poly_mask(size, pts, feather=2):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.filter(ImageFilter.GaussianBlur(feather)) if feather else m


def masked(im, m):
    out = im.copy()
    a = np.asarray(im.getchannel("A")).astype(np.float32) * (np.asarray(m).astype(np.float32) / 255.0)
    out.putalpha(Image.fromarray(a.astype(np.uint8)))
    return out


# ───────── Кепка: качается ─────────
def cap():
    im = load("m_cap")
    img, k = image(im, 6, 8, 108)
    rock = atf("rotate", ["-8 60 98", "8 60 98", "-8 60 98"], 2.6)
    body = shadow(60, 106, 40, 7, inner=an("rx", [34, 42, 34], 2.6))
    return svg(body + f"<g>{rock}{img}</g>", SHD)


# ───────── Худи: рукава двигаются ─────────
def hoodie():
    im = load("m_hoodie")
    W, H = im.size
    torso = masked(im, poly_mask(im.size, [(92, 0), (268, 0), (288, 90), (292, H), (68, H), (72, 90)], 1.5))
    left = masked(im, poly_mask(im.size, [(100, 40), (70, 60), (20, 95), (8, H), (92, H), (92, 90)], 1.5))
    right = masked(im, poly_mask(im.size, [(260, 40), (290, 60), (340, 95), (352, H), (268, H), (268, 90)], 1.5))
    X, Y, Wd = 12, 6, 96
    k = Wd / W
    t, _ = image(torso, X, Y, Wd, 340)
    l, _ = image(left, X, Y, Wd, 340)
    r, _ = image(right, X, Y, Wd, 340)
    D = 3.2
    kt = [0, .16, .3, .44, .58, .72, 1]
    lp = f"{X + 82 * k:.2f} {Y + 80 * k:.2f}"
    rp = f"{X + 278 * k:.2f} {Y + 80 * k:.2f}"
    la = atf("rotate", [f"{a} {lp}" for a in [0, 0, 11, 3, 11, 0, 0]], D, kt)
    ra = atf("rotate", [f"{a} {rp}" for a in [0, 0, -3, -11, -3, 0, 0]], D, kt)
    bob = atf("translate", ["0 0", "0 0", "0 -1.5", "0 0", "0 -1.5", "0 0", "0 0"], D, kt)
    body = shadow(60, 108, 34, 5)
    body += f'<g mask="url(#fade)"><g>{bob}<g>{la}{l}</g><g>{ra}{r}</g>{t}</g></g>'
    fade = ('<linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset=".72" stop-color="#fff"/><stop offset=".95" stop-color="#fff" stop-opacity="0"/></linearGradient>'
            '<mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><rect width="120" height="112" fill="url(#fg)"/></mask>')
    return svg(body, SHD + fade)


# ───────── Сумка: открывается, вылетают деньги ─────────
BILL = ('<linearGradient id="bill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9f3dc"/><stop offset=".45" stop-color="#9fd9a8"/>'
        '<stop offset="1" stop-color="#5fae72"/></linearGradient><linearGradient id="billS" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>')


def bill():
    return ('<rect x="-12" y="-6.5" width="24" height="13" rx="1.2" fill="url(#bill)" stroke="#3f8a52" stroke-width=".5"/>'
            '<rect x="-10.2" y="-4.8" width="20.4" height="9.6" rx=".8" fill="none" stroke="#2f6e40" stroke-opacity=".55" stroke-width=".45"/>'
            '<ellipse cx="0" cy="0" rx="3.4" ry="3.9" fill="#bfe6c5" stroke="#2f6e40" stroke-opacity=".6" stroke-width=".45"/>'
            '<path d="M-1.5 1.6V-1.6L0 .2L1.5 -1.6V1.6" fill="none" stroke="#2f6e40" stroke-width=".6" stroke-linecap="round" stroke-linejoin="round"/>'
            '<circle cx="-7.4" cy="0" r="1.4" fill="none" stroke="#2f6e40" stroke-opacity=".5" stroke-width=".4"/><circle cx="7.4" cy="0" r="1.4" fill="none" stroke="#2f6e40" stroke-opacity=".5" stroke-width=".4"/>'
            '<rect x="-12" y="-6.5" width="24" height="13" rx="1.2" fill="url(#billS)"/>')


def duffle():
    im = load("m_duffle")
    X, Y, Wd = 6, 14, 108
    img, k = image(im, X, Y, Wd, 340)
    P = lambda x, y: (X + x * k, Y + y * k)
    D = 4.6
    kt = [0, .12, .22, .78, .9, 1]
    jump = atf("translate", ["0 0", "0 0", "0 -3", "0 0", "0 0"], D, [0, .12, .17, .25, 1])
    sq = atf("scale", ["1 1", "1 1", "1.03 .96", "1 1", "1 1"], D, [0, .2, .25, .32, 1], add=True)
    (ax, ay), (bx, by), (cx, cy) = P(70, 116), P(312, 104), P(190, 106)
    mouth = f"M{ax:.1f} {ay:.1f}Q{cx:.1f} {cy - 9:.1f} {bx:.1f} {by:.1f}Q{cx:.1f} {cy + 8:.1f} {ax:.1f} {ay:.1f}Z"
    lip = f"M{ax:.1f} {ay:.1f}Q{cx:.1f} {cy + 8:.1f} {bx:.1f} {by:.1f}"
    op = an("opacity", [0, 0, 1, 1, 0, 0], D, kt)
    ms = atf("scale", ["1 0", "1 0", "1 1", "1 1", "1 0", "1 0"], D, kt)
    body = shadow(60, 106, 48, 6)
    body += f'<g>{jump}<g transform="translate(60 104)"><g>{sq}<g transform="translate(-60 -104)">{img}'
    body += (f'<g opacity="0">{op}<g transform="translate({cx:.1f} {cy:.1f})"><g>{ms}<g transform="translate({-cx:.1f} {-cy:.1f})">'
             f'<path d="{mouth}" fill="#050608"/><path d="{lip}" fill="none" stroke="#3a7bff" stroke-opacity=".7" stroke-width=".8"/>'
             f'<path d="{mouth}" fill="none" stroke="#2a2e36" stroke-width=".9"/></g></g></g></g>')
    body += "</g></g></g></g>"
    rnd = random.Random(11)
    bills = ""
    for i in range(12):
        s = .23 + i * .032
        e = s + .34 + rnd.uniform(-.02, .06)
        side = -1 if i % 2 else 1
        x0 = cx + rnd.uniform(-18, 18)
        path = f"M{x0:.1f} {cy:.1f}Q{x0 + side * rnd.uniform(4, 22):.1f} {rnd.uniform(-10, 8):.1f} {60 + side * rnd.uniform(8, 52):.1f} 134"
        mot = f'<animateMotion dur="{D}s" repeatCount="indefinite" path="{path}" keyPoints="0;0;1;1" keyTimes="0;{s:.3f};{e:.3f};1" calcMode="linear"/>'
        opa = f'<animate attributeName="opacity" dur="{D}s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;{s:.3f};{s + .015:.3f};{e - .02:.3f};{e:.3f}" calcMode="discrete"/>'
        rot = spin(round(rnd.uniform(.8, 1.5), 2), rev=i % 3 == 0)
        flip = f'<animateTransform attributeName="transform" type="scale" values="1 1;-1 .85;1 1" dur="{rnd.uniform(.5, .8):.2f}s" repeatCount="indefinite"/>'
        bills += f'<g opacity="0">{mot}{opa}<g>{rot}<g>{flip}{bill()}</g></g></g>'
    return svg(body + bills, SHD + BILL)


# ───────── Кроссовки: подпрыгивают ─────────
def sneakers():
    im = load("m_sneakers")
    img, k = image(im, 4, 6, 112)
    D = 2.2
    kt = [0, .2, .45, .62, .7, .78, 1]
    hop = atf("translate", ["0 0", "0 0", "0 -15", "0 0", "0 0", "0 0", "0 0"], D, kt)
    tilt = atf("rotate", ["0 60 92", "3 60 92", "-9 60 92", "0 60 92", "0 60 92", "0 60 92", "0 60 92"], D, kt, add=True)
    sq = atf("scale", ["1 1", "1.03 .95", "1 1", "1 1", "1.04 .93", "1 1", "1 1"], D, kt, add=True)
    sh = an("rx", [46, 48, 32, 46, 50, 46, 46], D, kt)
    body = shadow(60, 100, 46, 5, inner=sh)
    body += f'<g>{hop}<g>{tilt}<g transform="translate(60 92)"><g>{sq}<g transform="translate(-60 -92)">{img}</g></g></g></g></g>'
    return svg(body, SHD)


# ───────── Дрон: летит, винты крутятся ─────────
def drone():
    im = load("m_drone")
    hubs = [((60, 85), (140, 128)), ((300, 85), (218, 128)), ((58, 265), (140, 228)), ((298, 265), (218, 228))]
    A = np.asarray(im).astype(np.float32)
    yy, xx = np.mgrid[0:im.size[1], 0:im.size[0]]
    keep = np.ones(xx.shape, bool)
    for (hx, hy), (bx, by) in hubs:
        d = np.hypot(xx - hx, yy - hy)
        vx, vy = bx - hx, by - hy
        t = np.clip(((xx - hx) * vx + (yy - hy) * vy) / (vx * vx + vy * vy), 0, 1)
        darm = np.hypot(xx - (hx + t * vx), yy - (hy + t * vy))
        keep &= ~((d < 76) & (d > 13) & (darm > 9))
    A[..., 3] *= keep
    # убираем оставшиеся крошки от винтов: всё, что не связано с самим дроном
    import cv2
    n, lab, st, _ = cv2.connectedComponentsWithStats((A[..., 3] > 20).astype(np.uint8), 8)
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    near = cv2.dilate((lab == big).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    A[..., 3] *= near
    im = Image.fromarray(A.astype(np.uint8), "RGBA")
    X, Y, Wd = 6, 4, 108
    img, k = image(im, X, Y, Wd, 340)
    P = lambda x, y: (X + x * k, Y + y * k)
    D = 6
    fly = atf("translate", ["-4 3", "0 -5", "4 3", "0 -1", "-4 3"], D)
    tilt = atf("rotate", ["3 60 60", "0 60 60", "-3 60 60", "0 60 60", "3 60 60"], D, add=True)
    body = shadow(60, 112, 34, 4, op=.26, inner=an("rx", [34, 26, 34, 30, 34], D))
    defs = SHD + ('<radialGradient id="disc"><stop offset="0" stop-color="#9aa6ba" stop-opacity=".05"/><stop offset=".55" stop-color="#9aa6ba" stop-opacity=".2"/>'
                  '<stop offset=".92" stop-color="#c9d3e4" stop-opacity=".28"/><stop offset="1" stop-color="#c9d3e4" stop-opacity="0"/></radialGradient>'
                  '<linearGradient id="blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a2f38" stop-opacity="0"/><stop offset=".25" stop-color="#2a2f38" stop-opacity=".55"/>'
                  '<stop offset=".75" stop-color="#2a2f38" stop-opacity=".55"/><stop offset="1" stop-color="#2a2f38" stop-opacity="0"/></linearGradient>')
    rot = ""
    for i, ((x, y), _) in enumerate(hubs):
        cx, cy = P(x, y)
        r = spin(.16, rev=i % 2 == 1)
        R = 58 * k
        rot += (f'<g transform="translate({cx:.1f} {cy:.1f}) scale(1 .86)"><circle r="{R:.1f}" fill="url(#disc)"/>'
                f'<g>{r}<rect x="{-R:.1f}" y="-1.6" width="{2 * R:.1f}" height="3.2" rx="1.6" fill="url(#blade)"/>'
                f'<rect x="{-R:.1f}" y="-1.6" width="{2 * R:.1f}" height="3.2" rx="1.6" fill="url(#blade)" opacity=".5" transform="rotate(60)"/>'
                f'<rect x="{-R:.1f}" y="-1.6" width="{2 * R:.1f}" height="3.2" rx="1.6" fill="url(#blade)" opacity=".3" transform="rotate(120)"/></g>'
                f'<circle r="2.2" fill="#15181e"/><circle r="1" fill="#4f8dff"/></g>')
    blink = an("opacity", [1, .2, 1], .9)
    gx, gy = P(180, 152)
    body += f"<g>{fly}<g>{tilt}{img}{rot}"
    body += f'<circle cx="{gx:.1f}" cy="{gy:.1f}" r="3.6" fill="#4f8dff" opacity=".35">{blink}</circle>'
    body += "</g></g>"
    return svg(body, defs)


# ───────── Гиперкар: едет на нас ─────────
def hypercar():
    im = load("m_hypercar")
    X, Y, Wd = 6, 12, 108
    img, k = image(im, X, Y, Wd, 340)
    P = lambda x, y: (X + x * k, Y + y * k)
    defs = SHD + ('<radialGradient id="hl"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="#bcd8ff" stop-opacity=".9"/>'
                  '<stop offset="1" stop-color="#4f8dff" stop-opacity="0"/></radialGradient>'
                  '<linearGradient id="road" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f28" stop-opacity="0"/><stop offset="1" stop-color="#1b1f28" stop-opacity=".55"/></linearGradient>')
    body = '<path d="M46 92L74 92L120 120L0 120Z" fill="url(#road)"/>'
    # разметка бежит к нам (из-под машины вниз и вширь)
    for i in range(3):
        b = f"{i * .2:.2f}s"
        body += (f'<path d="M58.6 96H61.4L62 100H58Z" fill="#cfd8e8" opacity="0"><animateTransform attributeName="transform" type="translate" values="0 0;0 22" dur=".6s" begin="{b}" repeatCount="indefinite"/>'
                 f'<animate attributeName="opacity" values="0;.8;0" dur=".6s" begin="{b}" repeatCount="indefinite"/></path>')
    # полосы ветра по краям — летят мимо
    for i, (y, side, d) in enumerate([(40, -1, .55), (62, 1, .48), (78, -1, .62), (30, 1, .7), (86, 1, .52), (54, -1, .44)]):
        x0 = 60 + side * 40
        body += (f'<path d="M{x0} {y}h{side * 10}" stroke="#9fc6ff" stroke-width="1" stroke-linecap="round" opacity="0">'
                 f'<animateTransform attributeName="transform" type="translate" values="0 0;{side * 26} {(y - 60) * .4:.1f}" dur="{d}s" begin="{i * .13:.2f}s" repeatCount="indefinite"/>'
                 f'<animate attributeName="opacity" values="0;.7;0" dur="{d}s" begin="{i * .13:.2f}s" repeatCount="indefinite"/></path>')
    shake = atf("translate", ["0 0", ".3 -.6", "-.3 0", ".2 -.4", "0 0"], .42, spline=False)
    near = atf("scale", ["1 1", "1.035 1.035", "1 1"], 3, add=True)
    body += shadow(60, 96, 56, 5, op=.4)
    body += f'<g>{shake}<g transform="translate(60 92)"><g>{near}<g transform="translate(-60 -92)">{img}'
    for x, y in [(62, 186), (298, 186)]:
        hx, hy = P(x, y)
        body += f'<ellipse cx="{hx:.1f}" cy="{hy:.1f}" rx="9" ry="4.5" fill="url(#hl)" opacity=".8">{an("opacity", [.85, .35, .85], 1.4)}</ellipse>'
    body += "</g></g></g></g>"
    return svg(body, defs)


# ───────── Маска: раскрывается, потом резинка спадает и пружинит ─────────
def mask():
    im = load("m_mask")
    X, Y, Wd = 8, 16, 104
    img, k = image(im, X, Y, Wd, 340)
    P = lambda x, y: (X + x * k, Y + y * k)
    D = 5
    (lx, ly), (rx, ry) = P(30, 168), P(340, 162)
    up = f"M{lx:.1f} {ly:.1f}C{lx - 8:.1f} 4 {rx + 8:.1f} 4 {rx:.1f} {ry:.1f}"
    downs = [f"M{lx:.1f} {ly:.1f}C{lx - 10:.1f} {y} {rx + 10:.1f} {y} {rx:.1f} {ry:.1f}" for y in (124, 98, 114, 103, 109, 106)]
    vals = [up, up] + downs + [downs[-1], up]
    kts = [0, .32, .4, .46, .52, .57, .62, .66, .9, 1]
    strap = lambda w, col, dy: (f'<path d="{up}" fill="none" stroke="{col}" stroke-width="{w}" stroke-linecap="round" transform="translate(0 {dy})">'
                                f'<animate attributeName="d" dur="{D}s" repeatCount="indefinite" values="{";".join(vals)}" keyTimes="{kt_s(kts)}"/></path>')
    defs = SHD + '<linearGradient id="band" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a82f0"/><stop offset="1" stop-color="#1c46c4"/></linearGradient>'
    # раскрытие: маска «разворачивается» по вертикали в начале цикла и сворачивается в конце
    kto = [0, .06, .2, .9, .98, 1]
    unfold = atf("scale", ["1 .12", "1 .12", "1 1", "1 1", "1 .12", "1 .12"], D, kto)
    wob = atf("rotate", ["0 60 60", "0 60 60", "-4 60 60", "3 60 60", "-1.5 60 60", "0 60 60", "0 60 60"], D, [0, .38, .44, .51, .58, .66, 1], add=True)
    body = shadow(60, 108, 40, 5)
    body += (f'<g transform="translate(60 {Y + 168 * k:.1f})"><g>{unfold}<g transform="translate(-60 {-(Y + 168 * k):.1f})"><g>{wob}'
             f'{strap(4, "url(#band)", 0)}{strap(.8, "#cfe0ff", -1.1).replace("<path", "<path stroke-opacity=\".5\"")}{img}</g></g></g></g>')
    return svg(body, defs)


# ───────── Наушники: надеваются, вибрируют, звучат ─────────
def phones():
    im = load("m_phones")
    X, Y, Wd = 8, 8, 104
    img, k = image(im, X, Y, Wd, 340)
    D = 4.4
    kt = [0, .06, .24, .3, .34, .9, .97, 1]
    drop = atf("translate", ["0 -26", "0 -26", "0 2", "0 0", "0 0", "0 0", "0 -26", "0 -26"], D, kt)
    clamp = atf("scale", ["1.1 1", "1.1 1", "1.1 1", ".94 1", "1 1", "1 1", "1.1 1", "1.1 1"], D, kt, add=True)
    rnd = random.Random(3)
    jv, jk, t = [], [], 0.0
    while t <= 1.0001:
        on = .36 <= t <= .88
        jv.append(f"{rnd.uniform(-1, 1) * 1.1:.2f} {rnd.uniform(-1, 1) * .7:.2f}" if on else "0 0")
        jk.append(min(t, 1))
        t += .01
    jk[-1] = 1
    jit = f'<animateTransform attributeName="transform" type="translate" dur="{D}s" repeatCount="indefinite" additive="sum" values="{";".join(jv)}" keyTimes="{kt_s(jk)}"/>'
    waves = ""
    for side in (-1, 1):
        for i in range(3):
            pv, pk = [0], [0]
            for p in range(5):
                a = .36 + i * .06 + p * .1
                if a + .08 > .9:
                    break
                pk += [a, a + .04, a + .08]
                pv += [0, .9, 0]
            pk.append(1); pv.append(0)
            x = 60 + side * (47 + i * 4.5)
            waves += (f'<path d="M{x} 64Q{x + side * 5} 78 {x} 92" fill="none" stroke="#6aa3ff" stroke-width="1.8" stroke-linecap="round" opacity="0">'
                      f'<animate attributeName="opacity" dur="{D}s" repeatCount="indefinite" values="{";".join(map(str, pv))}" keyTimes="{kt_s(pk)}"/></path>')
    notes = ""
    for x0, dx, st in [(36, -10, .38), (84, 10, .52), (60, -6, .68)]:
        en = st + .2
        notes += (f'<g opacity="0"><animateMotion dur="{D}s" repeatCount="indefinite" path="M{x0} 50Q{x0 + dx} 32 {x0 + dx * .6:.1f} 8" keyPoints="0;0;1;1" keyTimes="0;{st:.2f};{en:.2f};1" calcMode="linear"/>'
                  f'<animate attributeName="opacity" dur="{D}s" repeatCount="indefinite" values="0;0;1;0;0" keyTimes="0;{st:.2f};{st + .05:.2f};{en:.2f};1"/>'
                  '<path d="M0 0V-9L6 -11V-2" fill="none" stroke="#6aa3ff" stroke-width="1.6" stroke-linejoin="round"/><ellipse cx="-1.8" cy="0" rx="2.4" ry="1.8" fill="#4f8dff"/><ellipse cx="4.2" cy="-2" rx="2.4" ry="1.8" fill="#4f8dff"/></g>')
    body = shadow(60, 110, 36, 5) + waves + notes
    body += f'<g>{drop}<g>{jit}<g transform="translate(60 60)"><g>{clamp}<g transform="translate(-60 -60)">{img}</g></g></g></g></g>'
    return svg(body, SHD)


GIFTS = {"m_cap": cap, "m_hoodie": hoodie, "m_duffle": duffle, "m_sneakers": sneakers,
         "m_drone": drone, "m_hypercar": hypercar, "m_mask": mask, "m_phones": phones}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for n, f in GIFTS.items():
        s = f()
        with open(os.path.join(OUT, n + ".svg"), "w") as fh:
            fh.write(s)
        print(n, len(s) // 1024, "KB")
