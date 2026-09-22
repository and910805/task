"""Render the existing brand-logo.svg design as the raster PWA icon set.

The logo is intentionally reproduced from its source SVG geometry so this script
does not fetch or generate any new artwork. Run from frontend/ with Python +
Pillow available when the raster icons need to be refreshed.
"""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE_LOGO = ROOT / "public" / "brand-logo.svg"
OUTPUT_DIR = ROOT / "public" / "icons"


def _gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        blend = y / max(size - 1, 1)
        color = tuple(round(start[index] * (1 - blend) + end[index] * blend) for index in range(3))
        for x in range(size):
            pixels[x, y] = color
    return image


def _diagonal_gradient(size: int, start: tuple[int, int, int], end: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            blend = (x + y) / max(2 * (size - 1), 1)
            pixels[x, y] = tuple(round(start[index] * (1 - blend) + end[index] * blend) for index in range(3))
    return image


def render_icon(size: int) -> Image.Image:
    # Render at 4x, then downsample for clean edges like the source SVG.
    scale = size * 4 / 128
    canvas_size = size * 4
    background = _gradient(canvas_size, (31, 41, 55), (15, 23, 42))
    mask = Image.new("L", (canvas_size, canvas_size), 0)
    draw_mask = ImageDraw.Draw(mask)
    draw_mask.rounded_rectangle((4 * scale, 4 * scale, 124 * scale, 124 * scale), radius=28 * scale, fill=255)
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    image.paste(background, mask=mask)
    bolt = [(74.5, 24), (38, 76), (62, 76), (52.5, 104), (89.5, 52), (65.5, 52)]
    bolt_mask = Image.new("L", (canvas_size, canvas_size), 0)
    ImageDraw.Draw(bolt_mask).polygon([(x * scale, y * scale) for x, y in bolt], fill=255)
    image.paste(_diagonal_gradient(canvas_size, (249, 115, 22), (194, 65, 12)), mask=bolt_mask)
    draw = ImageDraw.Draw(image, "RGBA")
    draw.ellipse((36 * scale, 34 * scale, 56 * scale, 54 * scale), fill=(253, 230, 138, 204))
    draw.arc((33 * scale, 76 * scale, 95 * scale, 124 * scale), start=22, end=158, fill=(251, 191, 36, 140), width=round(6 * scale))

    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    source = SOURCE_LOGO.read_text(encoding="utf-8")
    if "立翔水電行標誌" not in source or "M74.5 24L38 76" not in source:
        raise RuntimeError("brand-logo.svg no longer matches the expected source artwork; update this renderer first.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for filename, size in (("icon-192.png", 192), ("icon-512.png", 512), ("apple-touch-icon.png", 180)):
        render_icon(size).save(OUTPUT_DIR / filename, "PNG", optimize=True)


if __name__ == "__main__":
    main()
