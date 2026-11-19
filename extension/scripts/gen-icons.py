# 扩展图标生成(ADR 0009):墨黑圆角方块 + 白色书桌线稿,与 DESIGN.md 的墨黑主按钮同源。
# 16/32/48/128 四档;线稿按 128 稿画完等比缩到小尺寸(supersample 保边缘)。
from PIL import Image, ImageDraw
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "static" / "icons"
root.mkdir(parents=True, exist_ok=True)

S = 4  # supersample 倍数
BASE = 128 * S

def draw_icon():
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 圆角方块(墨黑,与主按钮一致)
    radius = 28 * S
    d.rounded_rectangle([0, 0, BASE - 1, BASE - 1], radius=radius, fill=(23, 24, 28, 255))
    # 书桌线稿(白):桌面横线 + 两条桌腿 + 桌上一张纸
    w = int(9 * S / 2)  # 线宽
    white = (255, 255, 255, 255)
    left, right, desk_y = 22 * S, 106 * S, 64 * S
    d.line([(left, desk_y), (right, desk_y)], fill=white, width=w)
    d.line([(left, desk_y), (left, 98 * S)], fill=white, width=w)
    d.line([(right, desk_y), (right, 98 * S)], fill=white, width=w)
    # 纸(斜放在桌上):一条起笔到桌面的竖线加一顶小斜杠,示意「写稿」
    d.line([(64 * S, desk_y), (64 * S, 38 * S)], fill=white, width=w)
    pen = [(64 * S, 38 * S), (80 * S, 26 * S)]
    d.line(pen, fill=white, width=w)
    d.ellipse([76 * S, 22 * S, 84 * S, 30 * S], fill=white)
    return img.resize((128, 128), Image.LANCZOS)

base = draw_icon()
for size in (16, 32, 48, 128):
    base.resize((size, size), Image.LANCZOS).save(root / f"icon{size}.png")
print("icons written to", root)
