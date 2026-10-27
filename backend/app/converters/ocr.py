"""OCR with Tesseract: scanned PDFs and images -> searchable PDF or plain text."""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

from ..errors import ConversionError
from .common import find_tesseract, output_dir, run_tool

_MAX_PIXELS_PER_PAGE = 60_000_000


def installed_languages() -> set[str]:
    """Language packs this server's Tesseract has (used by capability detection and validation)."""
    binary = find_tesseract()
    if not binary:
        return set()
    try:
        out = subprocess.run([binary, "--list-langs"], capture_output=True, timeout=15, check=False).stdout.decode(errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return set()
    return {line.strip() for line in out.splitlines()[1:] if line.strip() and line.strip() != "osd"}


def _pages_from_pdf(job, dpi: int, pages_dir: Path) -> list[Path]:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(job.input_path)
    except pdfium.PdfiumError as exc:
        if "password" in str(exc).lower():
            raise ConversionError("The PDF is password-protected.", "encrypted_pdf") from exc
        raise ConversionError("The PDF is corrupted or could not be read.", "invalid_file") from exc
    try:
        count = len(pdf)
        limit = job.limits["max_ocr_pages"]
        if count == 0:
            raise ConversionError("The PDF has no pages.", "invalid_file")
        if count > limit:
            raise ConversionError(f"OCR is limited to {limit} pages per file (this PDF has {count}). Split it first.", "too_many_pages")
        paths = []
        for index in range(count):
            page = pdf[index]
            width, height = page.get_size()
            scale = dpi / 72
            if width * scale * height * scale > _MAX_PIXELS_PER_PAGE:
                raise ConversionError("A page is too large to scan at this resolution.", "image_too_large")
            image = page.render(scale=scale).to_pil().convert("L")
            path = pages_dir / f"page-{index + 1:03d}.png"
            image.save(path, "PNG", dpi=(dpi, dpi))
            paths.append(path)
        return paths
    finally:
        pdf.close()


def _pages_from_image(job, pages_dir: Path) -> list[Path]:
    from PIL import Image, ImageSequence, UnidentifiedImageError

    try:
        with Image.open(job.input_path) as im:
            frames = []
            limit = job.limits["max_ocr_pages"]
            for n, frame in enumerate(ImageSequence.Iterator(im)):
                if n >= limit:
                    raise ConversionError(f"OCR is limited to {limit} pages per file.", "too_many_pages")
                if frame.width * frame.height > min(Image.MAX_IMAGE_PIXELS or _MAX_PIXELS_PER_PAGE, _MAX_PIXELS_PER_PAGE):
                    raise ConversionError("The image is too large to scan.", "image_too_large")
                dpi = frame.info.get("dpi") or im.info.get("dpi") or (200, 200)
                dpi = tuple(int(max(70, min(600, d))) for d in dpi[:2])
                path = pages_dir / f"page-{n + 1:03d}.png"
                frame.convert("L").save(path, "PNG", dpi=dpi)
                frames.append(path)
            return frames
    except ConversionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ConversionError("The image is corrupted or could not be read.", "invalid_file") from exc


def recognise(job) -> Path:
    binary = find_tesseract()
    if not binary:
        raise ConversionError("Tesseract is not installed on this server.", "engine_missing", 503)
    lang = job.options["ocrLang"]
    if lang not in installed_languages():
        raise ConversionError(f"The OCR language pack {lang!r} is not installed on this server.", "engine_missing", 503)
    dpi = int(job.options["ocrDpi"])
    work = Path(job.workdir)
    pages_dir = work / "pages"
    pages_dir.mkdir()
    pages = _pages_from_pdf(job, dpi, pages_dir) if job.input_format == "pdf" else _pages_from_image(job, pages_dir)

    want_pdf = job.target["id"] == "searchable-pdf"
    deadline = time.monotonic() + job.timeout - 3
    texts: list[str] = []
    page_pdfs: list[Path] = []
    for page in pages:
        remaining = int(deadline - time.monotonic())
        if remaining <= 0:
            raise ConversionError("The conversion took too long and was stopped.", "timeout", 504)
        base = page.with_suffix("")
        proc = run_tool(
            [binary, str(page), str(base), "-l", lang, "--psm", "3", "pdf" if want_pdf else "txt"],
            cwd=work,
            timeout=remaining,
            env_extra={"OMP_THREAD_LIMIT": "1", **({"TESSDATA_PREFIX": os.environ["TESSDATA_PREFIX"]} if "TESSDATA_PREFIX" in os.environ else {})},
        )
        produced = base.with_suffix(".pdf" if want_pdf else ".txt")
        if proc.returncode != 0 or not produced.exists():
            raise ConversionError("Text recognition failed for this file.", "invalid_file")
        if want_pdf:
            page_pdfs.append(produced)
        else:
            texts.append(produced.read_text(encoding="utf-8", errors="replace").strip())
        page.unlink(missing_ok=True)

    out_dir = output_dir(job.workdir)
    if want_pdf:
        from pypdf import PdfWriter

        writer = PdfWriter()
        for part in page_pdfs:
            writer.append(str(part))
        out = out_dir / "result.pdf"
        with open(out, "wb") as fh:
            writer.write(fh)
        return out
    if not any(texts):
        raise ConversionError("No text was recognised. The image may be blank, too small, or in another language.", "no_text")
    if len(texts) == 1:
        body = texts[0]
    else:
        body = "\n\n".join(f"--- Page {n} ---\n{t}" for n, t in enumerate(texts, start=1))
    out = out_dir / "result.txt"
    out.write_text(body + "\n", encoding="utf-8")
    return out
