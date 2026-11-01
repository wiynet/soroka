# Выгружает спрайты и палитры в index.html (между метками PX-DATA), чтобы приложение собирало живые сцены
import json, re, os
from px import SPR
from models import TYPES, MODELS
data = {"rows": {t: SPR[t] for t in TYPES},
        "models": {t: [{"id": mid, "pal": pal, "sp": [list(x) for x in sp]} for (mid, nm, em, pal, sp) in MODELS[t]] for t in TYPES}}
js = "const PX = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
p = os.path.join(os.path.dirname(__file__), "..", "..", "index.html")
s = open(p, encoding="utf-8").read()
s2, n = re.subn(r"/\* PX-DATA \*/.*?/\* /PX-DATA \*/", lambda m: "/* PX-DATA */" + js + "/* /PX-DATA */", s, flags=re.S)
assert n == 1, "метка PX-DATA не найдена"
open(p, "w", encoding="utf-8").write(s2)
print("PX data:", len(js), "bytes")
