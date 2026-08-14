#!/usr/bin/env python3
"""
Store assets, generated rather than kept as binaries.

Every icon, splash and graphic comes from one script, so there is no set of
stale PNGs drifting away from the brand. Drawn with Pillow directly: the
container has no SVG rasteriser, and depending on one would make asset
generation fail on a machine that happens to lack it.

Both stores reject icons with an alpha channel, so everything is composited
onto opaque black and saved as RGB.
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "resources")
os.makedirs(OUT, exist_ok=True)

TERRACOTTA = (232, 115, 74)
WHITE = (255, 255, 255)


def backdrop(size, warm=(44, 27, 20)):
    """Radial wash from a warm top-left to black — the site's ambient field."""
    w, h = size
    img = Image.new("RGB", size, (0, 0, 0))
    px = img.load()
    cx, cy = w * 0.30, h * 0.12
    maxd = math.hypot(max(cx, w - cx), max(cy, h - cy))
    for y in range(h):
        for x in range(w):
            t = min(1.0, math.hypot(x - cx, y - cy) / maxd)
            k = (1 - t) ** 2.2
            px[x, y] = (int(warm[0] * k), int(warm[1] * k), int(warm[2] * k))
    return img


def draw_mark(img, cx, cy, r, stroke):
    """The seal: a terracotta ring with a white check."""
    d = ImageDraw.Draw(img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=TERRACOTTA, width=stroke)
    p1 = (cx - r * 0.42, cy + r * 0.02)
    p2 = (cx - r * 0.14, cy + r * 0.33)
    p3 = (cx + r * 0.45, cy - r * 0.32)
    d.line([p1, p2, p3], fill=WHITE, width=stroke, joint="curve")
    for p in (p1, p2, p3):  # round the caps Pillow leaves square
        rr = stroke / 2
        d.ellipse([p[0] - rr, p[1] - rr, p[0] + rr, p[1] + rr], fill=WHITE)


def icon(size, pad_ratio=0.27, supersample=2):
    s = size * supersample
    img = backdrop((s, s))
    draw_mark(img, s / 2, s / 2, s * pad_ratio, max(2, int(s * 0.055)))
    return img.resize((size, size), Image.LANCZOS)


def font(sz, italic=False, bold=False):
    names = [
        "DejaVuSerif-Italic.ttf" if italic else ("DejaVuSerif-Bold.ttf" if bold else "DejaVuSerif.ttf"),
        "DejaVuSans.ttf",
    ]
    for n in names:
        for root in ("/usr/share/fonts/truetype/dejavu/", "/usr/share/fonts/truetype/"):
            p = os.path.join(root, n)
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, sz)
                except Exception:
                    pass
    return ImageFont.load_default()


# --- Capacitor asset inputs -------------------------------------------------
icon(1024).save(os.path.join(OUT, "icon.png"))

# Android adaptive icons get cropped to a circle/squircle by the launcher, so
# the foreground mark sits inside a generous safe zone.
icon(1024, pad_ratio=0.19).save(os.path.join(OUT, "icon-foreground.png"))
Image.new("RGB", (1024, 1024), (0, 0, 0)).save(os.path.join(OUT, "icon-background.png"))

# Web/apple-touch sizes. Safari ignores an SVG apple-touch-icon and falls back
# to a screenshot of the page, which looks broken on the home screen.
for sz in (180, 192, 512):
    icon(sz).save(os.path.join(OUT, f"icon-{sz}.png"))

# --- Splash -----------------------------------------------------------------
sp = Image.new("RGB", (2732, 2732), (0, 0, 0))
mark = icon(560, pad_ratio=0.27)
sp.paste(mark, (2732 // 2 - 280, 2732 // 2 - 280))
sp.save(os.path.join(OUT, "splash.png"))
sp.save(os.path.join(OUT, "splash-dark.png"))

# --- Play Store feature graphic (required; listing is rejected without it) ---
fg = backdrop((1024, 500), warm=(58, 33, 24))
d = ImageDraw.Draw(fg)
d.text((72, 150), "Money you are owed.", font=font(66, bold=True), fill=WHITE)
d.text((72, 232), "Found, sourced, dated.", font=font(66, italic=True), fill=(170, 170, 170))
d.text((72, 340), "3,900 programmes · 77 jurisdictions · works offline",
       font=font(26), fill=(130, 130, 130))
draw_mark(fg, 880, 250, 92, 10)
fg.save(os.path.join(OUT, "play-feature-graphic.png"))

print("written:", ", ".join(sorted(f for f in os.listdir(OUT) if f.endswith(".png"))))
