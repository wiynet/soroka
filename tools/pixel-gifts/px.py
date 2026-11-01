# Пиксельные подарки Mestario: спрайты 16x16, роли цветов -> палитры моделей
SPR = {}
# Роли: O контур, 1/2/3 основной (тёмный/средний/светлый), H блик, A/B/C отделка (тёмн/сред/светл), K тёмная деталь, S искра(редкие модели)
SPR['chest'] = [
"................",
"................",
"...OOOOOOOOOO...",
"..OB33333333BO..",
".OB3H22222222BO.",
".OB2222222222BO.",
".OCCCCCCCCCCCCO.",
".OAAAAOKKOAAAAO.",
".OB22OCCCCO22BO.",
".OB22OCKKCO22BO.",
".OB222OCCO222BO.",
".OB2221111222BO.",
".OB1111111111BO.",
".OAAAAAAAAAAAAO.",
"..OOOOOOOOOOOO..",
"................",
]
SPR['sword'] = [
"............OOO.",
"...........OH3O.",
"..........OH32O.",
".........OH32O..",
"........OH32O...",
".......OH32O....",
"......OH32O.....",
"..OO.OH32O......",
"..OCO332O.......",
"...OCC2O........",
"...OKCCO........",
"..OKOOCCO.......",
".OBKO..OCO......",
"OBBO....OO......",
"OAO.............",
".O..............",
]
SPR['crystal'] = [
"................",
"......OOOO......",
".....OH33CO.....",
"....OH3332CO....",
"...OH33322CCO...",
"..OH3332222CCO..",
"..O33332222CCO..",
"..O3333222CCCO..",
"..O1333222CCAO..",
"..O1133222CAAO..",
"...O113222AAO...",
"....O11222AO....",
".....O1122O.....",
"......O12O......",
".......OO.......",
"................",
]
SPR['potion'] = [
"......KKKK......",
".....KBBBBK.....",
"......OOOO......",
"......OHCO......",
"......OCCO......",
".....OCCCCO.....",
"....OCCCCCCO....",
"...OCH3333CCO...",
"..OH333323333O..",
".O3332333H3333O.",
".O222222333222O.",
".O222H22222222O.",
"..O2222222221O..",
"...O11222211O...",
"....OOOOOOOO....",
"................",
]
SPR['mushroom'] = [
"................",
".....OOOOOO.....",
"...OO3H3333OO...",
"..O33CC33CC33O..",
".O3CC333333CC3O.",
".O33333CC33333O.",
"O3CC333CC333CC3O",
"O22222222222222O",
".OO2222222222OO.",
"...OOBBBBBBOO...",
"....OBCCCCBO....",
"....OBCHCCBO....",
"....OBCCCCBO....",
"....OBBCCBBO....",
".....OOOOOO.....",
"................",
]
for k, rows in SPR.items():
    assert len(rows) == 16, (k, len(rows))
    for i, r in enumerate(rows):
        assert len(r) == 16, (k, i, len(r), r)

def svg(rows, pal, sparkles=()):
    out = []
    for y, row in enumerate(rows):
        x = 0
        while x < 16:
            ch = row[x]
            if ch == '.' or ch not in pal:
                x += 1; continue
            x2 = x
            while x2 < 16 and row[x2] == ch: x2 += 1
            out.append(f'<rect x="{x}" y="{y}" width="{x2-x}" height="1" fill="{pal[ch]}"/>')
            x = x2
    for (sx, sy, col) in sparkles:
        out.append(f'<rect x="{sx}" y="{sy-1}" width="1" height="3" fill="{col}"/><rect x="{sx-1}" y="{sy}" width="3" height="1" fill="{col}"/>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 18 18" shape-rendering="crispEdges">' + "".join(out) + '</svg>')
