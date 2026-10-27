"""Image conversion with Pillow."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from ..errors import ConversionError
from .common import output_dir

Image.MAX_IMAGE_PIXELS = 50_000_000  # decompression-bomb guard; larger images raise

_PIL_FORMAT = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP", "gif": "GIF", "bmp": "BMP", "tiff": "TIFF", "ico": "ICO"}


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


def convert(job) -> Path:
    fmt = job.target["format"]
    opts = job.options
    try:
        img = Image.open(job.input_path)
        if img.size[0] * img.size[1] > Image.MAX_IMAGE_PIXELS:  # Pillow itself only warns below 2x the limit
            raise ConversionError("The image has too many pixels to convert safely.", "image_too_large")
        img.load()  # decodes the first frame; raises on truncated/corrupt data
    except Image.DecompressionBombError as exc:
        raise ConversionError("The image has too many pixels to convert safely.", "image_too_large") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ConversionError("The image is corrupted or not a valid image file.", "invalid_file") from exc

    img = ImageOps.exif_transpose(img)
    has_alpha = img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info)
    if has_alpha:
        img = img.convert("RGBA")

    save_kwargs: dict = {}
    if fmt in ("jpeg", "bmp"):
        # Neither format can store transparency: flatten onto the chosen background.
        if has_alpha:
            bg = Image.new("RGB", img.size, _hex_to_rgb(opts.get("background", "#ffffff")))
            bg.paste(img, mask=img.getchannel("A"))
            img = bg
        else:
            img = img.convert("RGB")
        if fmt == "jpeg":
            save_kwargs = {"quality": opts.get("quality", 85), "optimize": True}
    elif fmt == "webp":
        img = img.convert("RGBA" if has_alpha else "RGB")
        save_kwargs = {"quality": opts.get("quality", 85)}
    elif fmt == "gif":
        if has_alpha:
            alpha = img.getchannel("A")
            p = img.convert("RGB").convert("P", palette=Image.Palette.ADAPTIVE, colors=255)
            p.paste(255, alpha.point(lambda a: 255 if a < 128 else 0))
            p.info["transparency"] = 255
            img = p
            save_kwargs = {"transparency": 255}
        else:
            img = img.convert("RGB").convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
    elif fmt == "ico":
        img = img.convert("RGBA")
        img.thumbnail((256, 256))
    elif fmt in ("png", "tiff"):
        if img.mode not in ("RGB", "RGBA", "L"):
            img = img.convert("RGBA" if has_alpha else "RGB")

    out = output_dir(job.workdir) / f"result.{fmt}"
    try:
        img.save(out, format=_PIL_FORMAT[fmt], **save_kwargs)
    except (OSError, ValueError) as exc:
        raise ConversionError("This image could not be written in the requested format.", "encode_failed") from exc

    try:  # validate the output before it can be downloaded
        with Image.open(out) as check:
            check.verify()
    except Exception as exc:  # noqa: BLE001
        raise ConversionError("The converted image failed validation.", "invalid_output", 500) from exc
    return out
