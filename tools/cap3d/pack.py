# Собирает кадры моделей в анимированные WebP (gifts/m/cap/cap_<id>.webp, 200×200) и статичную картинку для узора (-s.png).
# python3 pack.py <папка с кадрами> <папка вывода> <fps>
import glob, os, sys
from multiprocessing import Pool
from PIL import Image
SRC, OUT, FPS = sys.argv[1], sys.argv[2], float(sys.argv[3])

def one(k):
    fs = sorted(glob.glob(f"{SRC}/{k}/*.png"))
    fr = [Image.open(f).convert("RGBA").resize((200, 200), Image.LANCZOS) for f in fs]
    out = f"{OUT}/cap_{k}.webp"
    fr[0].save(out, save_all=True, append_images=fr[1:], duration=round(1000 / FPS), loop=0, quality=64, alpha_quality=45, method=4)
    st = Image.open(fs[0]).convert("RGBA"); st.thumbnail((72, 72), Image.LANCZOS); st.save(f"{OUT}/cap_{k}-s.png", optimize=True)
    return f"cap_{k} {len(fr)} {os.path.getsize(out) // 1024} KB"

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    with Pool(4) as p:
        for line in p.imap_unordered(one, sorted(os.listdir(SRC))): print(line)
