"""Compress PDF, PDF to Word, OCR and HTML to PDF: real files through the real API and engines."""
from __future__ import annotations

import io
import random
import shutil
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter

from app.converters.document import sanitize_html

from conftest import needs_soffice, post

HAVE_TESSERACT = bool(shutil.which("tesseract"))
needs_tesseract = pytest.mark.skipif(not HAVE_TESSERACT, reason="Tesseract not installed")


# ------------------------------------------------------------------ fixtures
def _noisy_image(size=(1600, 1200)) -> Image.Image:
    """Photo-like picture: smooth colour fields plus fine grain. Large as lossless data, small as JPEG."""
    rnd = random.Random(7)
    small = Image.new("RGB", (40, 30))
    small.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(40 * 30)])
    im = small.resize(size, Image.BICUBIC)
    grain = Image.effect_noise(size, 6).convert("RGB")
    return Image.blend(im, grain, 0.06)


def _image_pdf(pages=2) -> bytes:
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    img = ImageReader(_noisy_image())
    for n in range(pages):
        c.drawImage(img, 20, 100, width=555, height=416)
        c.drawString(40, 800, f"Image page {n + 1}")
        c.showPage()
    c.save()
    return buf.getvalue()


def _text_pdf(text="Quarterly Report", pages=2) -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, 842))
    for n in range(pages):
        c.setFont("Helvetica-Bold", 20)
        c.drawString(72, 780, text)
        c.setFont("Helvetica", 11)
        for i in range(10):
            c.drawString(72, 740 - 16 * i, f"Page {n + 1} line {i + 1}: the quick brown fox jumps over the lazy dog.")
        c.showPage()
    c.save()
    return buf.getvalue()


def _scan_image(text="HELLO IHATEFILE OCR 2026") -> Image.Image:
    im = Image.new("RGB", (1500, 300), "white")
    ImageDraw.Draw(im).text((60, 90), text, fill="black", font=ImageFont.load_default(size=80))
    return im


def _png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", dpi=(200, 200))
    return buf.getvalue()


def _scan_pdf(pages=1) -> bytes:
    buf = io.BytesIO()
    first, *rest = [_scan_image(f"PAGE {n + 1} HELLO IHATEFILE") for n in range(pages)]
    first.save(buf, "PDF", save_all=True, append_images=rest, resolution=200)
    return buf.getvalue()


def _download(client, response) -> bytes:
    assert response.status_code == 201, response.text
    r = client.get(response.json()["downloadUrl"])
    assert r.status_code == 200
    return r.content


def _pdf_text(data: bytes) -> str:
    import pdfplumber

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join(p.extract_text() or "" for p in pdf.pages)


# ------------------------------------------------------------------ compress
def test_compress_shrinks_an_image_heavy_pdf_and_keeps_pages_and_text(client):
    src = _image_pdf(2)
    out = _download(client, post(client, "scan.pdf", src, "pdf-compress", "compressed", {"compressLevel": "recommended"}))
    assert len(out) < len(src) * 0.5
    reader = PdfReader(io.BytesIO(out))
    assert len(reader.pages) == 2
    assert "Image page 1" in _pdf_text(out)
    assert len(list(reader.pages[0].images)) == 1


def test_compress_levels_are_ordered_and_response_is_named(client):
    src = _image_pdf(1)
    sizes = {}
    for level in ("low", "recommended", "strong"):
        r = post(client, "doc.pdf", src, "pdf-compress", "compressed", {"compressLevel": level})
        assert r.json()["filename"] == "doc-compressed.pdf"
        sizes[level] = len(_download(client, r))
    assert sizes["strong"] < sizes["recommended"] < sizes["low"] < len(src)


def test_compress_reports_when_nothing_can_be_saved(client):
    once = _download(client, post(client, "a.pdf", _image_pdf(1), "pdf-compress", "compressed", {"compressLevel": "strong"}))
    r = post(client, "a.pdf", once, "pdf-compress", "compressed", {"compressLevel": "strong"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_gain"


def test_compress_rejects_encrypted_corrupt_and_bad_options(client):
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(_text_pdf())))
    writer.encrypt("secret")
    buf = io.BytesIO()
    writer.write(buf)
    r = post(client, "e.pdf", buf.getvalue(), "pdf-compress", "compressed")
    assert r.status_code == 422 and r.json()["error"]["code"] == "encrypted_pdf"
    r = post(client, "bad.pdf", b"%PDF-1.4 this is not a pdf", "pdf-compress", "compressed")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_file"
    r = post(client, "a.pdf", _text_pdf(), "pdf-compress", "compressed", {"compressLevel": "maximum"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_option"


# ------------------------------------------------------------------ PDF -> Word
@needs_soffice
def test_pdf_to_word_keeps_text_and_pages(client):
    data = _download(client, post(client, "report.pdf", _text_pdf(), "pdf-to-word", "pdf-docx"))
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml = zf.read("word/document.xml").decode()
    assert "Quarterly Report" in xml and "Page 2 line 3" in xml
    assert data[:2] == b"PK"


@needs_soffice
def test_pdf_to_word_filename_and_media_type(client):
    r = post(client, "My Report.pdf", _text_pdf(), "pdf-to-word", "pdf-docx")
    assert r.status_code == 201
    assert r.json()["filename"] == "My Report.docx"
    assert r.json()["mediaType"].endswith("wordprocessingml.document")


@needs_soffice
def test_pdf_to_word_rejects_scans_encrypted_corrupt_and_long_pdfs(client, make_client):
    r = post(client, "scan.pdf", _scan_pdf(), "pdf-to-word", "pdf-docx")
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_text"
    assert "OCR" in r.json()["error"]["message"]
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(_text_pdf())))
    writer.encrypt("pw")
    buf = io.BytesIO()
    writer.write(buf)
    assert post(client, "e.pdf", buf.getvalue(), "pdf-to-word", "pdf-docx").json()["error"]["code"] == "encrypted_pdf"
    assert post(client, "x.pdf", b"%PDF-1.7 broken", "pdf-to-word", "pdf-docx").json()["error"]["code"] == "invalid_file"
    short = make_client(max_pdf_pages=1)
    r = post(short, "two.pdf", _text_pdf(pages=2), "pdf-to-word", "pdf-docx")
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_pages"


# ------------------------------------------------------------------ OCR
@needs_tesseract
def test_ocr_image_to_text(client):
    out = _download(client, post(client, "scan.png", _png(_scan_image()), "ocr", "ocr-txt")).decode()
    assert "IHATEFILE" in out.upper()
    assert "2026" in out


@needs_tesseract
@pytest.mark.parametrize("fmt", ["png", "jpeg", "tiff", "bmp", "webp"])
@pytest.mark.parametrize("target", ["ocr-txt", "searchable-pdf"])
def test_ocr_every_advertised_input_format(client, fmt, target):
    buf = io.BytesIO()
    _scan_image().save(buf, {"jpeg": "JPEG", "tiff": "TIFF", "bmp": "BMP", "webp": "WEBP", "png": "PNG"}[fmt])
    ext = {"jpeg": "jpg", "tiff": "tif"}.get(fmt, fmt)
    out = _download(client, post(client, f"scan.{ext}", buf.getvalue(), "ocr", target))
    text = out.decode() if target == "ocr-txt" else _pdf_text(out)
    assert "IHATEFILE" in text.upper()


def test_every_new_tool_pair_is_exercised_here():
    from app.registry import load_registry
    from app.config import Settings

    reg = load_registry(Settings().registry_path)
    advertised = {(t["id"], f, tg["id"]) for t in reg.server_tools() if t["id"] in {"pdf-compress", "pdf-to-word", "ocr", "html-to-pdf"}
                  for tg in t["targets"] for f in tg.get("from", t["inputs"])}
    assert advertised == {
        ("pdf-compress", "pdf", "compressed"), ("pdf-to-word", "pdf", "pdf-docx"), ("html-to-pdf", "html", "html-pdf"),
        *{("ocr", f, t) for f in ("pdf", "png", "jpeg", "tiff", "bmp", "webp") for t in ("searchable-pdf", "ocr-txt")},
    }


@needs_tesseract
def test_ocr_scanned_pdf_to_searchable_pdf(client):
    src = _scan_pdf(2)
    assert _pdf_text(src).strip() == ""  # really a scan: no text layer before OCR
    r = post(client, "scan.pdf", src, "ocr", "searchable-pdf", {"ocrLang": "eng", "ocrDpi": "200"})
    assert r.json()["filename"] == "scan-ocr.pdf"
    out = _download(client, r)
    assert len(PdfReader(io.BytesIO(out)).pages) == 2
    text = _pdf_text(out).upper()
    assert "PAGE 1" in text and "PAGE 2" in text and "IHATEFILE" in text


@needs_tesseract
def test_ocr_scanned_pdf_to_text_has_page_markers(client):
    out = _download(client, post(client, "scan.pdf", _scan_pdf(2), "ocr", "ocr-txt")).decode().upper()
    assert "--- PAGE 1 ---" in out and "--- PAGE 2 ---" in out and "IHATEFILE" in out


@needs_tesseract
def test_ocr_blank_image_is_reported_and_limits_apply(client, make_client):
    blank = _png(Image.new("RGB", (800, 400), "white"))
    r = post(client, "blank.png", blank, "ocr", "ocr-txt")
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_text"
    limited = make_client(max_ocr_pages=1)
    r = post(limited, "two.pdf", _scan_pdf(2), "ocr", "searchable-pdf")
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_pages"
    r = post(client, "broken.png", b"\x89PNG\r\n\x1a\n" + b"junk" * 50, "ocr", "ocr-txt")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_file"


@needs_tesseract
def test_ocr_rejects_unavailable_language_and_bad_options(client):
    assert post(client, "a.png", _png(_scan_image()), "ocr", "ocr-txt", {"ocrLang": "klingon"}).json()["error"]["code"] == "bad_option"
    assert post(client, "a.png", _png(_scan_image()), "ocr", "ocr-txt", {"ocrDpi": "9999"}).json()["error"]["code"] == "bad_option"
    langs = client.get("/api/v1/formats").json()
    ocr = next(t for t in langs["tools"] if t["id"] == "ocr")
    assert ocr["enabled"] and "eng" in ocr["optionChoices"]["ocrLang"]
    if "fra" not in ocr["optionChoices"]["ocrLang"]:  # not installed here: a clear 503, not a crash
        r = post(client, "a.png", _png(_scan_image()), "ocr", "ocr-txt", {"ocrLang": "fra"})
        assert r.status_code == 503 and r.json()["error"]["code"] == "engine_missing"


# ------------------------------------------------------------------ HTML -> PDF
class _Counter(BaseHTTPRequestHandler):
    hits: list[str] = []

    def do_GET(self):  # noqa: N802
        type(self).hits.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "text/css")
        self.end_headers()
        self.wfile.write(b"body{color:red}")

    def log_message(self, *a):  # silence
        pass


@pytest.fixture()
def local_server():
    _Counter.hits = []
    srv = HTTPServer(("127.0.0.1", 0), _Counter)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_port}", _Counter.hits
    srv.shutdown()


@needs_soffice
def test_html_to_pdf_renders_text_tables_and_inline_images(client):
    px = io.BytesIO()
    Image.new("RGB", (40, 20), "blue").save(px, "PNG")
    import base64

    uri = "data:image/png;base64," + base64.b64encode(px.getvalue()).decode()
    page = f"""<!doctype html><html><head><title>t</title><style>h1{{color:#c00}}</style></head><body>
    <h1>Invoice 42</h1><p>Hello <b>wörld</b> – café</p>
    <table border=1><tr><th>Item</th><th>Price</th></tr><tr><td>Widget</td><td>9.99</td></tr></table>
    <img src="{uri}"></body></html>""".encode()
    r = post(client, "page.html", page, "html-to-pdf", "html-pdf")
    out = _download(client, r)
    assert r.json()["filename"] == "page.pdf"
    text = _pdf_text(out)
    assert "Invoice 42" in text and "Widget" in text and "9.99" in text and "café" in text
    assert len(list(PdfReader(io.BytesIO(out)).pages[0].images)) == 1


@needs_soffice
def test_html_to_pdf_never_fetches_anything_or_runs_scripts(client, local_server):
    base, hits = local_server
    page = f"""<html><head>
    <link rel="stylesheet" href="{base}/link.css">
    <style>@import url({base}/import.css); body{{background:url({base}/bg.png)}} p{{color:green}}</style>
    <script>document.write('SCRIPT-RAN'); fetch('{base}/fetch')</script></head>
    <body background="{base}/bodybg.png" onload="fetch('{base}/onload')">
    <p style="background:url({base}/inline.png)">Visible text</p>
    <img src="{base}/img.png" alt="remote image"><img src="file:///etc/passwd" alt="local image">
    <iframe src="{base}/frame.html">frame fallback</iframe><object data="{base}/obj"></object>
    <embed src="{base}/embed"><a href="{base}/click">a link</a>
    <svg><image href="{base}/svg.png"/></svg></body></html>""".encode()
    out = _download(client, post(client, "evil.html", page, "html-to-pdf", "html-pdf"))
    assert hits == [], f"converter made network requests: {hits}"
    text = _pdf_text(out)
    assert "Visible text" in text and "SCRIPT-RAN" not in text
    assert "root:" not in text  # /etc/passwd was never read


@needs_soffice
def test_html_to_pdf_handles_odd_input(client):
    assert post(client, "e.html", b"", "html-to-pdf", "html-pdf").status_code == 400
    r = post(client, "latin.html", "<p>caf\xe9 na\xefve</p>".encode("cp1252"), "html-to-pdf", "html-pdf")
    assert "café" in _pdf_text(_download(client, r))
    r = post(client, "frag.html", b"just text, no tags", "html-to-pdf", "html-pdf")
    assert "just text" in _pdf_text(_download(client, r))
    assert post(client, "x.html", b"\x89PNG\r\n\x1a\n\x00\x00\x00", "html-to-pdf", "html-pdf").status_code == 415  # binary is not HTML


# ------------------------------------------------------------------ sanitiser (no engines needed)
def test_sanitiser_removes_everything_that_can_load_or_run():
    out = sanitize_html(
        b"""<html><head><link rel=stylesheet href="http://x/a.css"><meta http-equiv=refresh content="0;url=http://x">
        <base href="http://x/"><style>@import url(http://x/y.css);@font-face{src:url(http://x/f.woff)}
        h1{color:red;background:url(http://x/b.png)} p{margin:0}</style><script>alert(1)</script></head>
        <body onload="x()" background="http://x/bg.png"><h1 style="color:blue;background:url(x);width:1px">Hi &amp; bye</h1>
        <img src="http://x/i.png" alt="logo"><img src="//x/i.png"><img src="data:image/svg+xml;base64,AAAA">
        <a href="javascript:alert(1)">bad</a><a href="https://ok.test/">ok</a><a href="file:///etc/passwd">f</a>
        <iframe src="x">frame text</iframe><form action="http://x"><input value=v>typed</form>
        <svg><script>1</script>svg text</svg><object data=x>obj</object></body></html>"""
    )
    low = out.lower()
    for bad in ("http://x", "script", "alert", "onload", "javascript", "file:", "iframe", "<link", "<meta http", "<base",
                "url(", "@import", "@font-face", "<svg", "<object", "<form", "background="):
        assert bad not in low, bad
    assert "color:red" in low and "color:blue" in low and "width:1px" in low  # harmless CSS survives
    assert 'href="https://ok.test/"' in low and "hi &amp; bye" in low and "logo" in low and "typed" in low
    assert "frame text" not in low and "svg text" not in low  # dropped elements take their content with them


def test_sanitiser_keeps_only_png_jpeg_gif_data_images():
    ok = sanitize_html(b'<img src="data:image/png;base64,iVBORw0KGgo=">')
    assert "data:image/png;base64" in ok
    assert "data:image/svg" not in sanitize_html(b'<img src="data:image/svg+xml;base64,PHN2Zz4=">')
    assert "<img" not in sanitize_html(b'<img src="data:text/html;base64,PHNjcmlwdD4=">')


# ------------------------------------------------------------------ registry / capabilities
def test_new_tools_are_registered_and_reported(client):
    data = client.get("/api/v1/formats").json()
    ids = {t["id"]: t for t in data["tools"]}
    for tool_id in ("pdf-compress", "pdf-to-word", "ocr", "html-to-pdf"):
        assert tool_id in ids
    assert ids["pdf-compress"]["enabled"]


def test_wrong_input_types_are_refused(client):
    png = _png(_scan_image())
    assert post(client, "a.png", png, "pdf-compress", "compressed").status_code == 415
    assert post(client, "a.png", png, "pdf-to-word", "pdf-docx").status_code == 415
    assert post(client, "a.pdf", _text_pdf(), "html-to-pdf", "html-pdf").status_code == 415
    assert post(client, "a.docx", b"PK\x03\x04", "ocr", "ocr-txt").status_code == 415
