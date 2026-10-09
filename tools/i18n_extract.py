import re, json, html
src=open("/home/claude/soroka/index.html",encoding="utf-8").read()
CYR=re.compile(r"[А-Яа-яЁё]")
# разбираем на куски: script / style / html
parts=re.split(r"(<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>)", src, flags=re.S)
js=[]; htm=[]
for p in parts:
    if p.startswith("<script"): js.append(p)
    elif p.startswith("<style"): pass
    else: htm.append(p)
# --- JS: строковые литералы (без комментариев)
def strip_comments_keep(code):
    return code
LIT=re.compile(r'''"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`''')
jsl={}
for block in js:
    # убираем комментарии // и /* */ грубо, но не внутри строк: идём токенами
    i=0; n=len(block)
    while i<n:
        c=block[i]
        if block.startswith("//",i) and (i==0 or block[i-1]!=":"):
            j=block.find("\n",i); i = n if j<0 else j; continue
        if block.startswith("/*",i):
            j=block.find("*/",i); i = n if j<0 else j+2; continue
        if c in "\"'`":
            m=LIT.match(block,i)
            if m:
                lit=m.group(0)
                if CYR.search(lit): jsl[lit]=jsl.get(lit,0)+1
                i=m.end(); continue
        i+=1
# --- HTML: текстовые узлы и атрибуты
texts={}
for p in htm:
    for m in re.finditer(r">([^<>]+)<", p):
        t=html.unescape(m.group(1)).strip()
        t=re.sub(r"\s+"," ",t)
        if CYR.search(t): texts[t]=texts.get(t,0)+1
    for m in re.finditer(r'\b(title|placeholder|aria-label|alt)="([^"]*)"', p):
        t=html.unescape(m.group(2)).strip()
        if CYR.search(t): texts[t]=texts.get(t,0)+1
json.dump(sorted(jsl), open("i18n/js_literals.json","w",encoding="utf-8"), ensure_ascii=False, indent=0)
json.dump(sorted(texts), open("i18n/html_texts.json","w",encoding="utf-8"), ensure_ascii=False, indent=0)
print("js literals:", len(jsl), "html texts:", len(texts))
tmpl=[l for l in jsl if l.startswith("`")]; sq=[l for l in jsl if l.startswith("'")]
print("template:", len(tmpl), "single:", len(sq))
for l in tmpl+sq: print("  ", l[:150])
