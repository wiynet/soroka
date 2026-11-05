# Коллекция подарков Mestario: анимированные SVG (SMIL работает и внутри <img>).
# Запуск: python3 tools/mgifts.py  →  gifts/m/<id>.svg
import math, os, random

OUT = os.path.join(os.path.dirname(__file__), "..", "gifts", "m")
os.makedirs(OUT, exist_ok=True)

EASE = ".45 0 .55 1"


def anim_tf(kind, values, dur, key_times=None, splines=True, additive=False, begin="0s"):
    n = len(values)
    kt = key_times or [i / (n - 1) for i in range(n)]
    s = f'<animateTransform attributeName="transform" type="{kind}" dur="{dur}s" begin="{begin}" repeatCount="indefinite" values="{";".join(values)}" keyTimes="{";".join(f"{k:.4f}" for k in kt)}"'
    if splines:
        s += f' calcMode="spline" keySplines="{";".join([EASE] * (n - 1))}"'
    if additive:
        s += ' additive="sum"'
    return s + "/>"


def anim(attr, values, dur, key_times=None, splines=False, begin="0s"):
    n = len(values)
    kt = key_times or [i / (n - 1) for i in range(n)]
    s = f'<animate attributeName="{attr}" dur="{dur}s" begin="{begin}" repeatCount="indefinite" values="{";".join(str(v) for v in values)}" keyTimes="{";".join(f"{k:.4f}" for k in kt)}"'
    if splines:
        s += f' calcMode="spline" keySplines="{";".join([EASE] * (n - 1))}"'
    return s + "/>"


def spin(cx, cy, dur, rev=False):
    a, b = (360, 0) if rev else (0, 360)
    return f'<animateTransform attributeName="transform" type="rotate" from="{a} {cx} {cy}" to="{b} {cx} {cy}" dur="{dur}s" repeatCount="indefinite"/>'


BLUE = '<linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9bcbff"/><stop offset=".45" stop-color="#4f8dff"/><stop offset="1" stop-color="#2d58e8"/></linearGradient>'
BLUE_V = '<linearGradient id="bl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fb5ff"/><stop offset="1" stop-color="#2f5fea"/></linearGradient>'


def black(id_, x1=0, y1=0, x2=0, y2=1, a="#4b5262", b="#1b1e26", c="#0b0c10"):
    return f'<linearGradient id="{id_}" x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{a}"/><stop offset=".5" stop-color="{b}"/><stop offset="1" stop-color="{c}"/></linearGradient>'


def shine(id_):
    return f'<linearGradient id="{id_}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>'


def mlogo(cx, cy, s, sw=None, tf="", glow=True, op=1):
    """Логотип Mestario: две колонны и «V» посередине, скруглённые штрихи, синий градиент."""
    sw = sw or s * 0.3
    w, h = s, s * 0.86
    d = f"M{cx - w / 2:.2f} {cy + h / 2:.2f}V{cy - h / 2:.2f}L{cx:.2f} {cy + h * 0.12:.2f}L{cx + w / 2:.2f} {cy - h / 2:.2f}V{cy + h / 2:.2f}"
    g = f'<g transform="{tf}" opacity="{op}" fill="none" stroke-linecap="round" stroke-linejoin="round">'
    if glow:
        g += f'<path d="{d}" stroke="#3d7bff" stroke-opacity=".32" stroke-width="{sw * 1.9:.2f}"/>'
    g += f'<path d="{d}" stroke="url(#mg)" stroke-width="{sw:.2f}"/>'
    g += f'<path d="{d}" stroke="#e6f1ff" stroke-opacity=".55" stroke-width="{sw * 0.22:.2f}" transform="translate({-sw * 0.16:.2f} {-sw * 0.16:.2f})"/>'
    return g + "</g>"


def svg(defs, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs>{BLUE}{BLUE_V}{defs}</defs>{body}</svg>'


def shadow(cx, cy, rx, ry, extra=""):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#000" opacity=".28">{extra}</ellipse>'


# ───────────── Кепка: качается ─────────────
def cap():
    defs = black("cr", .2, 0, .8, 1, "#5a6172", "#22262f", "#0c0d11") + black("br", 0, 0, 0, 1, "#2c313c", "#14161c", "#08090c") + shine("sh") + \
        '<radialGradient id="hl" cx="38%" cy="25%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    rock = anim_tf("rotate", ["-9 60 98", "9 60 98", "-9 60 98"], 2.6)
    body = shadow(60, 108, 34, 6, anim("rx", [30, 36, 30], 2.6, splines=True))
    body += f'<g>{rock}'
    # купол
    body += '<path d="M24 80C22 48 42 27 64 27C88 27 102 47 99 76C88 86 40 89 24 80Z" fill="url(#cr)"/>'
    body += '<path d="M24 80C22 48 42 27 64 27C88 27 102 47 99 76C88 86 40 89 24 80Z" fill="url(#hl)"/>'
    # швы панелей
    body += '<g fill="none" stroke-linecap="round"><path d="M64 28C54 40 47 60 46 84" stroke="#000" stroke-opacity=".45" stroke-width="1.2"/><path d="M64 28C76 40 82 58 83 82" stroke="#000" stroke-opacity=".45" stroke-width="1.2"/>' \
            '<path d="M62.6 29C52.6 41 45.6 61 44.6 84" stroke="#fff" stroke-opacity=".1" stroke-width=".8" stroke-dasharray="1.6 1.6"/><path d="M65.4 29C77.4 41 83.4 58 84.4 82" stroke="#fff" stroke-opacity=".1" stroke-width=".8" stroke-dasharray="1.6 1.6"/></g>'
    # вентиляционные люверсы
    body += '<circle cx="36" cy="54" r="1.6" fill="#07080a" stroke="#3a404c" stroke-width=".6"/><circle cx="90" cy="52" r="1.6" fill="#07080a" stroke="#3a404c" stroke-width=".6"/>'
    # пуговица
    body += '<ellipse cx="64" cy="28" rx="5" ry="2.6" fill="#2a2f39"/><ellipse cx="63.4" cy="27.2" rx="3" ry="1.2" fill="#6b7384" opacity=".6"/>'
    # логотип на передней панели
    body += mlogo(64, 57, 23, 6.6, tf="skewX(-4) translate(4 0)")
    # козырёк
    body += '<path d="M22 77C13 86 12 99 30 103C52 108 84 99 98 79C86 89 40 92 22 77Z" fill="url(#br)"/>'
    body += '<path d="M22 77C13 86 12 99 30 103C52 108 84 99 98 79" fill="none" stroke="#3b4150" stroke-width="1"/>'
    body += '<path d="M25 82C30 90 60 92 90 84" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1" stroke-dasharray="2 2"/>'
    body += '<path d="M30 99C50 102 74 97 90 86" fill="none" stroke="url(#mg)" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>'
    body += "</g>"
    return svg(defs, body)


# ───────────── Худи: рукава двигаются ─────────────
def hoodie():
    defs = black("hb", .3, 0, .7, 1, "#4c5363", "#1e2129", "#0b0c10") + black("hs", 0, 0, 1, 1, "#3e4452", "#191c23", "#0a0b0e") + \
        '<radialGradient id="hl" cx="40%" cy="20%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    D = 3.2
    kt = [0, .18, .32, .46, .6, .74, 1]
    left = anim_tf("rotate", [f"{a} 40 46" for a in [0, 0, 34, 18, 34, 0, 0]], D, kt)
    right = anim_tf("rotate", [f"{a} 80 46" for a in [0, 0, -18, -34, -18, 0, 0]], D, kt)
    bob = anim_tf("translate", ["0 0", "0 0", "0 -2", "0 0", "0 -2", "0 0", "0 0"], D, kt)
    body = shadow(60, 110, 30, 5)
    body += f'<g transform="translate(6 5) scale(.9)"><g>{bob}'
    # рукава (за туловищем)
    sl = '<path d="M41 42C29 44 23 54 19 72L15 92C19 96 27 96 29 92L35 70Z" fill="url(#hs)"/><path d="M14.6 90.5C18.6 95.5 26.6 95.5 29.4 91" fill="none" stroke="#3a404d" stroke-width="3.2" stroke-linecap="round"/><path d="M22 60C24 54 28 50 34 48" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>'
    body += f"<g>{left}{sl}</g>"
    body += f'<g transform="translate(120 0) scale(-1 1)"><g>{right.replace("80 46", "40 46").replace("-", "")}{sl}</g></g>'
    # капюшон
    body += '<path d="M40 44C37 20 83 20 80 44Z" fill="#14161c"/><path d="M45 42C45 28 75 28 75 42C70 38 50 38 45 42Z" fill="#050608"/>'
    # туловище
    body += '<path d="M38 40C46 37 52 44 60 44C68 44 74 37 82 40L86 98C86 103 82 105 78 105L42 105C38 105 34 103 34 98Z" fill="url(#hb)"/>'
    body += '<path d="M38 40C46 37 52 44 60 44C68 44 74 37 82 40L86 98C86 103 82 105 78 105L42 105C38 105 34 103 34 98Z" fill="url(#hl)"/>'
    body += '<path d="M34.6 99H85.4" stroke="#323743" stroke-width="5"/><path d="M35 97.6H85" stroke="#fff" stroke-opacity=".07" stroke-width=".8"/>'
    # карман-кенгуру
    body += '<path d="M44 80H76L80 96H40Z" fill="#000" opacity=".22"/><path d="M44 80H76L80 96H40Z" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width=".8" stroke-dasharray="1.6 1.6"/>'
    # шнурки капюшона
    sway = anim_tf("rotate", ["-6 0 0", "6 0 0", "-6 0 0"], 1.6, additive=True)
    for x in (55, 65):
        body += f'<g transform="translate({x} 44)"><g>{sway}<path d="M0 0V17" stroke="#c9d6ee" stroke-width="1.3" stroke-linecap="round"/><rect x="-1.1" y="15.5" width="2.2" height="4" rx="1" fill="url(#bl)"/></g></g>'
    body += mlogo(60, 66, 18, 5.4)
    body += "</g></g>"
    return svg(defs, body)


# ───────────── Сумка: открывается, деньги вылетают ─────────────
def duffle():
    D = 4.6
    defs = black("db", 0, 0, 0, 1, "#4b5160", "#1c1f27", "#090a0d") + black("de", 0, 0, 1, 1, "#3a404d", "#16181e", "#08090c") + \
        black("dl", 0, 0, 0, 1, "#5a6172", "#262a33", "#14161b") + \
        '<linearGradient id="bill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b9f2c6"/><stop offset=".5" stop-color="#5fcf86"/><stop offset="1" stop-color="#2f9a5e"/></linearGradient>' \
        '<radialGradient id="hl" cx="35%" cy="25%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    kt = [0, .12, .22, .78, .9, 1]
    jump = anim_tf("translate", ["0 0", "0 0", "0 -3", "0 0", "0 0", "0 0"], D, [0, .12, .17, .24, .9, 1])
    squash = anim_tf("scale", ["1 1", "1 1", "1.04 .95", "1 1", "1 1"], D, [0, .2, .25, .32, 1], additive=True)
    body = shadow(60, 108, 42, 6)
    body += f'<g>{jump}<g transform="translate(60 104)"><g>{squash}<g transform="translate(-60 -104)">'
    # ручки
    body += '<path d="M42 54C42 28 78 28 78 54" fill="none" stroke="#0f1115" stroke-width="6" stroke-linecap="round"/><path d="M43 50C44 32 76 32 77 50" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/>'
    # тело-цилиндр
    body += '<path d="M24 50H94C101 50 106 60 106 76C106 92 101 103 94 103H26C19 103 14 92 14 76C14 60 19 50 24 50Z" fill="url(#db)"/>'
    body += '<path d="M24 50H94C101 50 106 60 106 76C106 92 101 103 94 103H26C19 103 14 92 14 76C14 60 19 50 24 50Z" fill="url(#hl)"/>'
    body += '<ellipse cx="95" cy="76.5" rx="10" ry="26" fill="url(#de)" stroke="#3a404c" stroke-width="1"/><ellipse cx="95" cy="76.5" rx="6" ry="19" fill="none" stroke="url(#mg)" stroke-width="1.6" opacity=".8"/>'
    # ремни вокруг тела
    body += '<path d="M38 51C34 66 34 88 38 103M80 51C84 66 84 88 80 103" fill="none" stroke="#0b0c10" stroke-width="5"/><path d="M38 51C34 66 34 88 38 103M80 51C84 66 84 88 80 103" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="1" transform="translate(-1.6 0)"/>'
    body += mlogo(58, 77, 20, 6)
    # открытый клапан встаёт за проёмом, закрытый исчезает
    rise = anim_tf("scale", ["1 0", "1 0", "1 1", "1 1", "1 0", "1 0"], D, kt)
    body += f'<g transform="translate(0 51)"><g>{rise}<g transform="translate(0 -51)"><path d="M22 51C26 30 92 30 96 51Z" fill="url(#dl)"/><path d="M25 50C30 33.6 88 33.6 93 50" fill="none" stroke="#9aa4b8" stroke-width="1" stroke-dasharray="1.2 1"/><path d="M30 46C36 38 50 35 62 35" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="1.6" stroke-linecap="round"/></g></g></g>'
    op = anim("opacity", [0, 0, 1, 1, 0, 0], D, kt)
    body += f'<g opacity="0">{op}<path d="M22 52C40 43 80 43 96 52C80 61 40 61 22 52Z" fill="#050608"/><path d="M22 52C40 61 80 61 96 52" fill="none" stroke="url(#mg)" stroke-width="1.6"/><path d="M34 52C46 48 70 48 84 52C70 56 46 56 34 52Z" fill="#163a8f" opacity=".5"/></g>'
    cl = anim("opacity", [1, 1, 0, 0, 1, 1], D, kt)
    body += f'<g>{cl}<path d="M22 50C40 43 80 43 96 50C80 56 40 56 22 50Z" fill="url(#dl)"/><path d="M26 50.2C44 46.5 76 46.5 92 50.2" fill="none" stroke="#9aa4b8" stroke-width="1" stroke-dasharray="1.2 1"/><rect x="86" y="47" width="5" height="6" rx="1.2" fill="url(#bl)"/></g>'
    body += "</g></g></g></g>"
    # купюры: вылетают вверх, кувыркаются (переворот по оси — объём) и падают вниз
    rnd = random.Random(7)
    bills = ""
    for i in range(11):
        s = .23 + i * .035
        e = s + .36 + rnd.uniform(-.03, .05)
        side = -1 if i % 2 else 1
        top = rnd.uniform(-8, 10)
        x2 = 60 + side * rnd.uniform(10, 50)
        path = f"M60 52Q{60 + side * rnd.uniform(4, 20):.1f} {top:.1f} {x2:.1f} 132"
        kts = f"0;{s:.3f};{e:.3f};1"
        mot = f'<animateMotion dur="{D}s" repeatCount="indefinite" path="{path}" keyPoints="0;0;1;1" keyTimes="{kts}" calcMode="linear"/>'
        opa = f'<animate attributeName="opacity" dur="{D}s" repeatCount="indefinite" values="0;0;1;1;0" keyTimes="0;{s:.3f};{s + .02:.3f};{e - .02:.3f};{e:.3f}" calcMode="discrete"/>'
        rd = rnd.uniform(.7, 1.3)
        rot = spin(0, 0, round(rd, 2), rev=bool(i % 3 == 0))
        fl = f'<animateTransform attributeName="transform" type="scale" values="1 1;-1 1;1 1" dur="{rnd.uniform(.45, .7):.2f}s" repeatCount="indefinite"/>'
        bills += f'<g opacity="0">{mot}{opa}<g>{rot}<g>{fl}<rect x="-11" y="-6" width="22" height="12" rx="1.6" fill="url(#bill)" stroke="#1f7a46" stroke-width=".7"/><rect x="-8.6" y="-3.8" width="17.2" height="7.6" rx="1" fill="none" stroke="#e9fff0" stroke-opacity=".7" stroke-width=".5"/><circle r="2.8" fill="#2f9a5e" stroke="#e9fff0" stroke-width=".5"/></g></g></g>'
    return svg(defs, body + bills)


# ───────────── Кроссовки: подпрыгивают и приземляются ─────────────
def sneakers():
    D = 2.2
    defs = black("su", .2, 0, .8, 1, "#535a6a", "#20232b", "#0b0c10") + \
        '<linearGradient id="ss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d1df"/></linearGradient>' \
        '<radialGradient id="hl" cx="30%" cy="30%" r="60%"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    kt = [0, .2, .45, .62, .7, .78, 1]
    hop = anim_tf("translate", ["0 0", "0 0", "0 -16", "0 0", "0 0", "0 0", "0 0"], D, kt)
    tilt = anim_tf("rotate", ["0 60 96", "3 60 96", "-8 60 96", "0 60 96", "0 60 96", "0 60 96", "0 60 96"], D, kt, additive=True)
    sq = anim_tf("scale", ["1 1", "1.03 .95", "1 1", "1 1", "1.04 .93", "1 1", "1 1"], D, kt, additive=True)
    sh = anim("rx", [42, 44, 30, 42, 46, 42, 42], D, kt, splines=True)
    body = shadow(60, 104, 42, 5, sh)
    body += f'<g>{hop}<g>{tilt}<g transform="translate(60 98)"><g>{sq}<g transform="translate(-60 -98)">'
    # язычок (за верхом)
    body += '<path d="M68 52C67 42 75 38 80 42L82 52Z" fill="#2a2f3a"/><path d="M70 46C71 42 75 40 78 42" fill="none" stroke="#fff" stroke-opacity=".15" stroke-width="1"/>'
    # подошва
    body += '<path d="M10 88C10 84 13 82 18 82H102C107 82 110 85 110 89V92C110 95 108 97 105 97H16C12 97 10 95 10 92Z" fill="url(#ss)"/>'
    body += '<path d="M10.4 93H109.6C109.4 95.6 107.6 97.6 105 97.6H16C13 97.6 10.8 95.8 10.4 93Z" fill="url(#bl)"/>'
    body += '<path d="M14 88.4H106" stroke="#aab4c6" stroke-width=".7" stroke-dasharray="2 1.6"/>'
    # верх
    up = "M12 84C12 76 18 72 28 70L44 66C50 64 54 60 58 56L64 51C68 48 74 48 78 50C84 53 88 50 92 47C97 44 104 48 106 56L108 84Z"
    body += f'<path d="{up}" fill="url(#su)"/><path d="{up}" fill="url(#hl)"/>'
    body += '<path d="M12 84C12 76 18 72 28 70C30.4 75 30.4 80 28.6 84Z" fill="#000" opacity=".28"/><path d="M13.4 82C14 76 20 72.6 27.4 71.4" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".8" stroke-dasharray="1.4 1.4"/>'
    body += '<path d="M14 80.6C40 79 80 79 107 80.6" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width=".8" stroke-dasharray="1.6 1.6"/>'
    body += '<path d="M101 49C104.6 51 106.4 56 107 62L108 84H100C101 72 101.6 60 101 49Z" fill="url(#bl)"/>'
    body += '<path d="M78 50C84 53 88 50 92 47C95.4 45.6 98.6 46.6 100 48.6C95 54 85 56.4 78 50Z" fill="#050608"/>'
    # шнурки
    wig = anim_tf("rotate", ["-5 0 0", "5 0 0", "-5 0 0"], .55, additive=True)
    for x, y in [(57, 59), (62, 55), (67, 52), (72, 50)]:
        body += f'<path d="M{x - 3} {y + 3}L{x + 4} {y - 2}M{x - 3} {y - 2}L{x + 4} {y + 3}" stroke="#d6deec" stroke-width="1.3" stroke-linecap="round"/>'
    body += f'<g transform="translate(76 49)"><g>{wig}<path d="M0 0C-2 6-6 9-9 12M0 0C2 6 1 10 -1 14" fill="none" stroke="#d6deec" stroke-width="1.1" stroke-linecap="round"/></g></g>'
    body += mlogo(64, 70, 15, 4.6, tf="skewX(-8) translate(10 0)")
    body += "</g></g></g></g></g>"
    return svg(defs, body)


# ───────────── Дрон: летит ─────────────
def drone():
    D = 3
    defs = black("dbd", .3, 0, .7, 1, "#5a6172", "#22262f", "#0c0d11") + \
        '<radialGradient id="lens" cx="40%" cy="35%" r="60%"><stop offset="0" stop-color="#cfe4ff"/><stop offset=".4" stop-color="#3d7bff"/><stop offset="1" stop-color="#0a1640"/></radialGradient>'
    fly = anim_tf("translate", ["-5 2", "0 -6", "5 2", "0 -2", "-5 2"], D * 2)
    tilt = anim_tf("rotate", ["4 60 60", "0 60 60", "-4 60 60", "0 60 60", "4 60 60"], D * 2, additive=True)
    sh = anim("rx", [30, 24, 30, 27, 30], D * 2, splines=True)
    body = shadow(60, 110, 30, 4, sh)
    body += f"<g>{fly}<g>{tilt}"
    motors = [(22, 36), (98, 36), (26, 86), (94, 86)]
    # лучи
    for x, y in motors:
        body += f'<path d="M60 62L{x} {y}" stroke="#0f1116" stroke-width="7" stroke-linecap="round"/><path d="M60 61L{x} {y - 1}" stroke="#fff" stroke-opacity=".1" stroke-width="1.6" stroke-linecap="round"/>'
    # корпус
    body += '<path d="M50 40C50 34 70 34 70 40L73 76C73 84 47 84 47 76Z" fill="url(#dbd)" stroke="#2f3440" stroke-width="1"/>'
    body += '<path d="M52 42C54 38 66 38 68 42" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="1.4" stroke-linecap="round"/>'
    body += mlogo(60, 54, 12, 3.8)
    body += '<circle cx="60" cy="76" r="5" fill="#0b0c10" stroke="#3a404c" stroke-width="1"/><circle cx="60" cy="76" r="3.4" fill="url(#lens)"/><circle cx="58.8" cy="74.8" r=".9" fill="#fff" opacity=".8"/>'
    # огоньки
    blink = anim("opacity", [1, .25, 1], .9)
    body += f'<circle cx="52" cy="70" r="1.3" fill="#7fb5ff">{blink}</circle><circle cx="68" cy="70" r="1.3" fill="#7fb5ff">{blink}</circle>'
    # моторы и винты (вращаются, лопасти в перспективе)
    for i, (x, y) in enumerate(motors):
        body += f'<ellipse cx="{x}" cy="{y + 1}" rx="5.2" ry="4" fill="#0c0d11"/><ellipse cx="{x}" cy="{y}" rx="4.2" ry="3.2" fill="#2a2f3a"/><ellipse cx="{x}" cy="{y - .6}" rx="2" ry="1.2" fill="url(#bl)"/>'
        body += f'<ellipse cx="{x}" cy="{y - 2}" rx="17" ry="5.6" fill="#cfe0ff" opacity=".12"/>'
        r = spin(0, 0, .22, rev=bool(i % 2))
        body += f'<g transform="translate({x} {y - 2}) scale(1 .33)"><g>{r}<rect x="-16" y="-2.4" width="32" height="4.8" rx="2.4" fill="#1a1d24" opacity=".85"/><rect x="-2.4" y="-16" width="4.8" height="32" rx="2.4" fill="#1a1d24" opacity=".55"/></g></g>'
    body += "</g></g>"
    return svg(defs, body)


# ───────────── Гиперкар: едет ─────────────
def hypercar():
    defs = black("cb", 0, 0, 0, 1, "#5d6577", "#20242d", "#0a0b0f") + \
        '<linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fc6ff"/><stop offset=".4" stop-color="#1d2c55"/><stop offset="1" stop-color="#05070d"/></linearGradient>' \
        '<radialGradient id="rim" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#8a93a6"/><stop offset="1" stop-color="#262a33"/></radialGradient>'
    body = ""
    # дорога и разметка (едут назад)
    body += '<rect x="0" y="98" width="120" height="1.4" fill="#3a404c" opacity=".7"/>'
    road = f'<animateTransform attributeName="transform" type="translate" from="0 0" to="-40 0" dur=".42s" repeatCount="indefinite"/>'
    body += f'<g><g>{road}' + "".join(f'<rect x="{x}" y="105" width="18" height="2.4" rx="1.2" fill="#4a5162"/>' for x in range(0, 200, 40)) + "</g></g>"
    # полосы скорости
    for i, (y, w, d) in enumerate([(56, 22, .5), (66, 30, .38), (76, 18, .62), (88, 26, .44)]):
        mv = f'<animateTransform attributeName="transform" type="translate" from="30 0" to="-40 0" dur="{d}s" repeatCount="indefinite"/>'
        body += f'<g><g>{mv}<rect x="0" y="{y}" width="{w}" height="1.6" rx=".8" fill="#7fb5ff" opacity=".45"/></g></g>'
    bounce = anim_tf("translate", ["0 0", "0 -.9", "0 0", "0 -.5", "0 0"], .5, splines=True)
    body += shadow(62, 99, 52, 3.2)
    body += f"<g>{bounce}"
    # антикрыло
    body += '<path d="M14 66L15 58" stroke="#0e1015" stroke-width="2.4"/><rect x="5" y="55" width="22" height="3.6" rx="1.4" fill="#14161c"/><rect x="5" y="55" width="22" height="1.2" rx=".6" fill="url(#mg)"/>'
    # кузов
    car = "M6 80V72C6 68 9 66 14 66L28 64C38 57 48 53 60 52C70 52 78 55 86 59.6L108 66.4C113 67.8 116 71 116 75V80C116 84 113 86 109 86H11C8 86 6 84 6 80Z"
    body += f'<path d="{car}" fill="url(#cb)"/>'
    body += '<path d="M36 63C45 58 52 55.4 60 55.4C68 55.4 74 57 80 60.6Z" fill="url(#gl)" stroke="#0a0c12" stroke-width="1"/>'
    body += '<path d="M46 59C51 56.6 56 56 61 56" stroke="#fff" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round"/>'
    # неоновая линия, воздухозаборник, фары
    body += '<path d="M10 74C40 71 84 71 113 71.6" fill="none" stroke="#3d7bff" stroke-opacity=".35" stroke-width="4"/><path d="M10 74C40 71 84 71 113 71.6" fill="none" stroke="#8ec0ff" stroke-width="1.1"/>'
    body += '<path d="M34 67L48 65.4L44 75L34 75Z" fill="#06070a"/>'
    body += '<path d="M104 67.6L115 71.4L113 73.4L102 70.4Z" fill="#e8f2ff"/><path d="M104 67.6L115 71.4L113 73.4L102 70.4Z" fill="#7fb5ff" opacity=".5"><animate attributeName="opacity" values=".5;.15;.5" dur="1.2s" repeatCount="indefinite"/></path>'
    body += '<path d="M6 70H11V73H6Z" fill="#4f8dff"/>'
    body += mlogo(66, 77, 10, 3.2)
    # колёса
    for cx in (31, 93):
        r = spin(cx, 87, .32)
        body += f'<circle cx="{cx}" cy="86" r="13.5" fill="#050608"/><circle cx="{cx}" cy="87" r="11.5" fill="#101217"/><circle cx="{cx}" cy="87" r="8" fill="url(#rim)"/><circle cx="{cx}" cy="87" r="8" fill="none" stroke="url(#mg)" stroke-width="1.3"/>'
        spokes = "".join(f'<rect x="{cx - 1}" y="{87 - 7.4}" width="2" height="7" rx="1" fill="#14161c" transform="rotate({a} {cx} 87)"/>' for a in range(0, 360, 72))
        body += f'<g>{r}{spokes}</g><circle cx="{cx}" cy="87" r="2" fill="#4f8dff"/>'
    body += "</g>"
    return svg(defs, body)


# ───────────── Маска для сна: глаза открываются, резинка спадает ─────────────
def mask():
    D = 5
    defs = black("mk", .2, 0, .8, 1, "#565d6e", "#1f2229", "#0a0b0f") + \
        '<radialGradient id="hl" cx="35%" cy="30%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>'
    # резинка: сначала дугой сверху (на голове), потом спадает вниз и пружинит
    up = "M16 58C10 14 110 14 104 58"
    ys = [114, 98, 109, 101, 106, 103.5]
    downs = [f"M16 60C8 {y} 112 {y} 104 60" for y in ys]
    vals = [up, up] + downs + [downs[-1], up]
    kts = [0, .3, .38, .44, .5, .55, .6, .64, .9, 1]
    strap = f'<path d="{up}" fill="none" stroke="url(#bl)" stroke-width="5" stroke-linecap="round"><animate attributeName="d" dur="{D}s" repeatCount="indefinite" values="{";".join(vals)}" keyTimes="{";".join(map(str, kts))}"/></path>'
    strap2 = f'<path d="{up}" fill="none" stroke="#d4e6ff" stroke-opacity=".5" stroke-width="1" stroke-linecap="round" transform="translate(0 -1.4)"><animate attributeName="d" dur="{D}s" repeatCount="indefinite" values="{";".join(vals)}" keyTimes="{";".join(map(str, kts))}"/></path>'
    wob = anim_tf("rotate", ["0 60 60", "0 60 60", "-4 60 60", "3 60 60", "-1.5 60 60", "0 60 60", "0 60 60"], D, [0, .36, .42, .5, .58, .66, 1])
    body = shadow(60, 110, 30, 4)
    body += f"<g>{wob}{strap}{strap2}"
    shape = "M14 60C14 44 30 38 46 42C54 44 57 48 60 48C63 48 66 44 74 42C90 38 106 44 106 60C106 76 92 84 76 80C68 78 64 72 60 72C56 72 52 78 44 80C28 84 14 76 14 60Z"
    body += f'<path d="{shape}" fill="url(#mk)"/><path d="{shape}" fill="url(#hl)"/><path d="{shape}" fill="none" stroke="url(#mg)" stroke-width="2"/>'
    body += '<path d="M24 50C32 44 42 44 48 47" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2" stroke-linecap="round"/>'
    # глаза: закрытые (ресницы) → открытые
    ekt = [0, .12, .18, .9, .96, 1]
    closed_op = anim("opacity", [1, 1, 0, 0, 1, 1], D, ekt)
    open_sc = [anim_tf("scale", ["1 .05", "1 .05", "1 1", "1 1", "1 .05", "1 .05"], D, ekt, additive=True)]
    for ex in (35, 85):
        body += f'<g>{closed_op}<path d="M{ex - 8} 59Q{ex} 65 {ex + 8} 59" fill="none" stroke="#9fc6ff" stroke-width="1.8" stroke-linecap="round"/>' \
                f'<path d="M{ex - 5} 62.6L{ex - 7} 66M{ex} 63.6V67.4M{ex + 5} 62.6L{ex + 7} 66" stroke="#9fc6ff" stroke-width="1.4" stroke-linecap="round"/></g>'
        body += f'<g transform="translate({ex} 60)"><g>{open_sc[0]}<ellipse rx="8.5" ry="6.2" fill="#f2f7ff"/><circle r="4" fill="url(#bl)"/><circle r="1.8" fill="#0a1230"/><circle cx="-1.4" cy="-1.6" r="1.1" fill="#fff"/>' \
                f'<animate attributeName="opacity" dur="{D}s" repeatCount="indefinite" values="0;0;1;1;0;0" keyTimes="{";".join(map(str, ekt))}"/></g></g>'
    body += mlogo(60, 58.5, 11, 3.4)
    body += "</g>"
    return svg(defs, body)


# ───────────── Наушники: надеваются, вибрируют, звучат ─────────────
def phones():
    D = 4.4
    defs = black("hp", .2, 0, .8, 1, "#535a6b", "#1e2129", "#0a0b0f") + black("hc", 0, 0, 0, 1, "#2a2f3a", "#121419", "#060709")
    # 0–.28 опускаются и сжимаются; .3–.9 вибрируют и играют; .92–1 поднимаются обратно
    kt = [0, .06, .24, .3, .9, .97, 1]
    drop = anim_tf("translate", ["0 -24", "0 -24", "0 2", "0 0", "0 0", "0 -24", "0 -24"], D, kt)
    lo = anim_tf("translate", ["-9 0", "-9 0", "-9 0", "1 0", "0 0", "-9 0", "-9 0"], D, [0, .06, .24, .3, .33, .97, 1], additive=True)
    ro = anim_tf("translate", ["9 0", "9 0", "9 0", "-1 0", "0 0", "9 0", "9 0"], D, [0, .06, .24, .3, .33, .97, 1], additive=True)
    # дрожь в такт музыке
    rnd = random.Random(3)
    jv, jk = [], []
    t = 0.0
    while t <= 1.0001:
        on = .34 <= t <= .88
        jv.append(f"{rnd.uniform(-1, 1) * 1.1:.2f} {rnd.uniform(-1, 1) * .8:.2f}" if on else "0 0")
        jk.append(t)
        t += .01
    jk[-1] = 1
    jit = f'<animateTransform attributeName="transform" type="translate" dur="{D}s" repeatCount="indefinite" additive="sum" values="{";".join(jv)}" keyTimes="{";".join(f"{k:.3f}" for k in jk)}"/>'
    body = shadow(60, 110, 32, 4)
    # звуковые волны и ноты (только пока играют)
    waves = ""
    for side in (-1, 1):
        for i in range(3):
            st = .34 + i * .06
            pulses, kk = [], []
            for p in range(5):
                a = st + p * .1
                if a + .08 > .9:
                    break
                kk += [a, a + .04, a + .08]
                pulses += [0, .9, 0]
            kk = [0] + kk + [1]
            pulses = [0] + pulses + [0]
            x = 60 + side * (44 + i * 5)
            d = f"M{x} 66Q{x + side * 5} 80 {x} 94"
            waves += f'<path d="{d}" fill="none" stroke="#7fb5ff" stroke-width="2" stroke-linecap="round" opacity="0"><animate attributeName="opacity" dur="{D}s" repeatCount="indefinite" values="{";".join(map(str, pulses))}" keyTimes="{";".join(f"{k:.3f}" for k in kk)}"/></path>'
    notes = ""
    for i, (x0, dx, st) in enumerate([(40, -10, .36), (80, 10, .5), (56, -6, .66)]):
        en = st + .22
        mot = f'<animateMotion dur="{D}s" repeatCount="indefinite" path="M{x0} 60Q{x0 + dx} 40 {x0 + dx * .6:.1f} 14" keyPoints="0;0;1;1" keyTimes="0;{st:.2f};{en:.2f};1" calcMode="linear"/>'
        op = f'<animate attributeName="opacity" dur="{D}s" repeatCount="indefinite" values="0;0;1;0;0" keyTimes="0;{st:.2f};{st + .05:.2f};{en:.2f};1"/>'
        notes += f'<g opacity="0">{mot}{op}<path d="M0 0V-9L6 -11V-2" fill="none" stroke="url(#mg)" stroke-width="1.6" stroke-linejoin="round"/><ellipse cx="-1.8" cy="0" rx="2.4" ry="1.8" fill="#6aa3ff"/><ellipse cx="4.2" cy="-2" rx="2.4" ry="1.8" fill="#6aa3ff"/></g>'
    body += waves + notes
    body += f"<g>{drop}<g>{jit}"
    # оголовье
    body += '<path d="M27 70C25 24 95 24 93 70" fill="none" stroke="#0e1015" stroke-width="8" stroke-linecap="round"/><path d="M29 66C28 30 92 30 91 66" fill="none" stroke="url(#mg)" stroke-width="1.6" stroke-linecap="round" opacity=".9"/><path d="M33 44C40 32 60 28 74 32" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2" stroke-linecap="round"/>'
    cup = '<rect x="-12" y="-19" width="24" height="38" rx="11" fill="url(#hp)"/><rect x="-12" y="-19" width="24" height="38" rx="11" fill="none" stroke="#3a404c" stroke-width=".8"/><path d="M-7 -14C-3 -17 3 -17 6 -15" stroke="#fff" stroke-opacity=".22" stroke-width="1.6" stroke-linecap="round" fill="none"/>' \
          '<rect x="-3.4" y="-26" width="6.8" height="9" rx="2" fill="url(#bl)"/>'
    body += f'<g><g>{lo}<g transform="translate(26 82)">{cup}<path d="M12 -15V15" stroke="url(#hc)" stroke-width="6" stroke-linecap="round"/>{mlogo(0, 0, 9, 2.8, glow=False, op=.75)}</g></g></g>'
    body += f'<g><g>{ro}<g transform="translate(94 82)">{cup}<path d="M-12 -15V15" stroke="url(#hc)" stroke-width="6" stroke-linecap="round"/>{mlogo(0, 0, 9, 2.8, glow=False, op=.75)}</g></g></g>'
    body += "</g></g>"
    return svg(defs, body)


GIFTS = {"m_cap": cap, "m_hoodie": hoodie, "m_duffle": duffle, "m_sneakers": sneakers,
         "m_drone": drone, "m_hypercar": hypercar, "m_mask": mask, "m_phones": phones}

if __name__ == "__main__":
    for k, f in GIFTS.items():
        with open(os.path.join(OUT, k + ".svg"), "w") as fh:
            fh.write(f())
    print("ok", len(GIFTS))
