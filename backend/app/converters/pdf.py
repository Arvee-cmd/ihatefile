"""Server-side PDF utilities: text extraction (pdfplumber) and page rendering (pypdfium2)."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from ..errors import ConversionError
from .common import output_dir


def _extract_text(job) -> Path:
    import pdfplumber
    from pdfminer.pdfdocument import PDFPasswordIncorrect

    max_pages = job.limits["max_pdf_pages"] * 4  # text extraction is cheaper than rendering
    chunks: list[str] = []
    try:
        with pdfplumber.open(job.input_path) as pdf:
            if len(pdf.pages) > max_pages:
                raise ConversionError(f"PDFs with more than {max_pages} pages are not supported.", "too_many_pages")
            for number, page in enumerate(pdf.pages, start=1):
                chunks.append(f"--- Page {number} ---\n{page.extract_text() or ''}")
    except ConversionError:
        raise
    except Exception as exc:  # noqa: BLE001 - pdfminer wraps most parse failures in PdfminerException
        inner = exc.args[0] if exc.args else exc
        if isinstance(exc, PDFPasswordIncorrect) or isinstance(inner, PDFPasswordIncorrect):
            raise ConversionError("The PDF is password-protected.", "encrypted_pdf") from exc
        raise ConversionError("The PDF is corrupted or could not be read.", "invalid_file") from exc
    if not any(c.split("\n", 1)[1].strip() for c in chunks):
        raise ConversionError(
            "No text could be extracted. The PDF probably contains scanned images; use the OCR tool for those.",
            "no_text",
        )
    out = output_dir(job.workdir) / "result.txt"
    out.write_text("\n\n".join(chunks) + "\n", encoding="utf-8")
    return out


def _render_pages(job) -> Path:
    import pypdfium2 as pdfium

    dpi = int(job.options["dpi"])
    try:
        pdf = pdfium.PdfDocument(job.input_path)
    except pdfium.PdfiumError as exc:
        message = str(exc).lower()
        if "password" in message:
            raise ConversionError("The PDF is password-protected.", "encrypted_pdf") from exc
        raise ConversionError("The PDF is corrupted or could not be read.", "invalid_file") from exc
    try:
        count = len(pdf)
        if count == 0:
            raise ConversionError("The PDF has no pages.", "invalid_file")
        limit = job.limits["max_pdf_pages"]
        if count > limit:
            raise ConversionError(f"Page rendering is limited to PDFs with at most {limit} pages (this one has {count}).", "too_many_pages")
        out = output_dir(job.workdir) / "result.zip"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:  # PNGs are already compressed
            for index in range(count):
                page = pdf[index]
                width, height = page.get_size()
                scale = dpi / 72
                if width * scale * height * scale > 40_000_000:
                    raise ConversionError("A page is too large to render at this resolution.", "image_too_large")
                bitmap = page.render(scale=scale)
                buf = io.BytesIO()
                bitmap.to_pil().save(buf, format="PNG")
                zf.writestr(f"page-{index + 1:03d}.png", buf.getvalue())
        return out
    finally:
        pdf.close()


def convert(job) -> Path:
    return _extract_text(job) if job.target["id"] == "txt" else _render_pages(job)


# ------------------------------------------------------------------ compression
# level -> (JPEG quality, longest image side in px or None to keep the size)
_COMPRESS_LEVELS = {"low": (85, None), "recommended": (65, 2000), "strong": (45, 1400)}
_MIN_IMAGE_SAVING = 0.9  # an image is only replaced when the new data is at least 10 % smaller


def _recompress_images(page, quality: int, max_side: int | None) -> None:
    from PIL import Image

    try:
        images = list(page.images)
    except Exception:  # noqa: BLE001 - a page whose resources cannot be parsed is left untouched
        return
    for img in images:
        try:
            xobj = img.indirect_reference.get_object()
            if "/SMask" in xobj or "/Mask" in xobj or xobj.get("/ImageMask"):
                continue  # keep transparency exactly as it is
            original_size = len(xobj._data) if hasattr(xobj, "_data") else 0
            pil = img.image
            if pil.width * pil.height > Image.MAX_IMAGE_PIXELS:
                continue
            if pil.mode not in ("RGB", "L"):
                pil = pil.convert("RGB")
            if max_side and max(pil.size) > max_side:
                pil = pil.copy()
                pil.thumbnail((max_side, max_side), Image.LANCZOS)
            trial = io.BytesIO()
            pil.save(trial, "JPEG", quality=quality, optimize=True)
            if original_size and trial.tell() >= original_size * _MIN_IMAGE_SAVING:
                continue
            img.replace(pil, quality=quality, optimize=True)
        except Exception:  # noqa: BLE001 - unusual image encodings are skipped, not fatal
            continue


def compress(job) -> Path:
    """Re-compresses embedded images and content streams, and removes duplicate objects."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.errors import PyPdfError

    quality, max_side = _COMPRESS_LEVELS[job.options["compressLevel"]]
    limit = job.limits["max_pdf_pages"] * 4
    try:
        reader = PdfReader(job.input_path)
        if reader.is_encrypted:
            raise ConversionError("The PDF is password-protected.", "encrypted_pdf")
        if len(reader.pages) == 0:
            raise ConversionError("The PDF has no pages.", "invalid_file")
        if len(reader.pages) > limit:
            raise ConversionError(f"PDFs with more than {limit} pages are not supported.", "too_many_pages")
        writer = PdfWriter(clone_from=reader)
        for page in writer.pages:
            _recompress_images(page, quality, max_side)
            page.compress_content_streams()
        writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
        out = output_dir(job.workdir) / "result.pdf"
        with open(out, "wb") as fh:
            writer.write(fh)
    except ConversionError:
        raise
    except (PyPdfError, ValueError, KeyError, OSError, RecursionError) as exc:
        raise ConversionError("The PDF is corrupted or could not be read.", "invalid_file") from exc
    before = Path(job.input_path).stat().st_size
    after = out.stat().st_size
    if after >= before:
        out.unlink()
        raise ConversionError(
            "This PDF is already well compressed: no smaller version could be made. Try the Strong level.",
            "no_gain",
            422,
        )
    return out
