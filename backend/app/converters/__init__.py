"""Handler table: registry `handler` ids -> implementations (executed inside worker processes)."""
from __future__ import annotations

from . import archive, document, image, media, ocr, pdf

HANDLERS = {
    "image.pillow": image.convert,
    "document.libreoffice": document.libreoffice,
    "document.pandoc": document.pandoc,
    "pdf.server": pdf.convert,
    "pdf.compress": pdf.compress,
    "document.pdf2docx": document.pdf_to_docx,
    "document.html2pdf": document.html_to_pdf,
    "ocr.tesseract": ocr.recognise,
    "media.audio": media.audio,
    "media.video": media.video,
    "archive.repack": archive.convert,
}
