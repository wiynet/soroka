import os
from px import SPR, svg
from models import TYPES, MODELS, W
os.makedirs("out", exist_ok=True)
cells = []
for t, info in TYPES.items():
    rows = SPR[t]
    # картинка самого подарка (до улучшения) — первая модель без искр
    base = MODELS[t][0][3]
    open(f"out/{t}.svg", "w").write(svg(rows, base))
    row = [f'<div class="c"><img src="out/{t}.svg"><b>{info["name"]}</b><i>{info["price"]} Mest · {info["supply"]} шт</i></div>']
    for i, (mid, nm, em, pal, sp) in enumerate(MODELS[t]):
        open(f"out/{t}-{mid}.svg", "w").write(svg(rows, pal, sp))
        row.append(f'<div class="c"><img src="out/{t}-{mid}.svg"><b>{nm}</b><i>{W[i]}%</i></div>')
    cells.append('<div class="r">' + "".join(row) + '</div>')
html = ('<!doctype html><meta charset=utf-8><style>body{margin:0;background:#141c26;color:#cfe;font:11px sans-serif;padding:10px}'
        '.r{display:flex;gap:8px;margin-bottom:10px}.c{width:96px;display:grid;justify-items:center;gap:2px;background:linear-gradient(160deg,#1f2a36,#141c26);border-radius:12px;padding:6px}'
        'img{width:80px;height:80px}b{font-size:11px}i{color:#8ab;font-style:normal}</style>' + "".join(cells))
open("sheet.html", "w").write(html)
print("built", len(os.listdir("out")), "svgs")
