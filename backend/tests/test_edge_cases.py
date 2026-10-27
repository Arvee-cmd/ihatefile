"""Invalid input, hostile input and resource-limit behaviour for each engine."""
from __future__ import annotations

import io
import os
import stat
import subprocess
import tarfile
import time
import zipfile

import pytest
from PIL import Image

from conftest import HAVE_FFMPEG, HAVE_PANDOC, HAVE_SOFFICE, MARKER, _ffmpeg, _png_bytes, needs_ffmpeg, needs_pandoc, needs_soffice, post


# --------------------------------------------------------------------- images
def test_transparent_png_to_jpeg_uses_background_colour(client):
    buf = io.BytesIO()
    Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(buf, "PNG")
    job = post(client, "t.png", buf.getvalue(), "image-server", "jpeg", {"background": "#ff0000"}).json()
    img = Image.open(io.BytesIO(client.get(job["downloadUrl"]).content)).convert("RGB")
    r, g, b = img.getpixel((5, 5))
    assert r > 240 and g < 20 and b < 20


def test_png_alpha_preserved_when_converting_to_webp_and_gif(client):
    buf = io.BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 0)).save(buf, "PNG")
    webp = Image.open(io.BytesIO(client.get(post(client, "t.png", buf.getvalue(), "image-server", "webp").json()["downloadUrl"]).content))
    assert webp.convert("RGBA").getpixel((5, 5))[3] == 0
    gif = Image.open(io.BytesIO(client.get(post(client, "t.png", buf.getvalue(), "image-server", "gif").json()["downloadUrl"]).content))
    assert gif.convert("RGBA").getpixel((5, 5))[3] == 0


def test_ico_is_capped_at_256(client):
    buf = io.BytesIO()
    Image.new("RGB", (1000, 600), "blue").save(buf, "PNG")
    ico = Image.open(io.BytesIO(client.get(post(client, "big.png", buf.getvalue(), "image-server", "ico").json()["downloadUrl"]).content))
    assert max(ico.size) <= 256


def test_truncated_image_is_rejected(client):
    r = post(client, "t.png", _png_bytes((400, 400))[:200], "image-server", "jpeg")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_file"


def test_decompression_bomb_image_is_rejected(client):
    buf = io.BytesIO()
    Image.new("1", (9000, 9000), 1).save(buf, "PNG")  # 81M pixels, tiny file
    assert len(buf.getvalue()) < 1_000_000
    r = post(client, "bomb.png", buf.getvalue(), "image-server", "jpeg")
    assert r.status_code == 422 and r.json()["error"]["code"] == "image_too_large"


# ------------------------------------------------------------------- archives
def _zip(entries: dict[str, bytes], symlink: str | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, body in entries.items():
            zf.writestr(name, body)
        if symlink:
            zi = zipfile.ZipInfo(symlink)
            zi.create_system = 3
            zi.external_attr = (stat.S_IFLNK | 0o777) << 16
            zf.writestr(zi, "/etc/passwd")
    return buf.getvalue()


@pytest.mark.parametrize("name", ["../evil.txt", "a/../../evil.txt", "/abs/evil.txt", "C:/evil.txt", "a\\..\\evil.txt"])
def test_zip_path_traversal_rejected(client, name):
    r = post(client, "x.zip", _zip({name: b"x"}), "archive-repack", "targz")
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsafe_archive", r.text


def test_zip_symlink_rejected(client):
    r = post(client, "x.zip", _zip({"ok.txt": b"x"}, symlink="link"), "archive-repack", "targz")
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsafe_archive"


def test_zip_too_many_entries_rejected(make_client):
    c = make_client(max_archive_entries=5)
    r = post(c, "x.zip", _zip({f"f{i}.txt": b"x" for i in range(6)}), "archive-repack", "targz")
    assert r.status_code == 422 and r.json()["error"]["code"] == "archive_too_large"


def test_zip_bomb_rejected(make_client):
    c = make_client(max_expanded_mb=10)
    data = _zip({"zeros.bin": b"\0" * (50 * 1024 * 1024)})
    assert len(data) < 200_000  # ~50 MB expands from a tiny file
    r = post(c, "bomb.zip", data, "archive-repack", "targz")
    assert r.status_code == 422 and r.json()["error"]["code"] == "archive_too_large"
    assert list(c.app.state.store.root.iterdir()) == []


def test_zip_with_forged_header_size_is_still_limited(make_client):
    """Header sizes can lie; the bytes actually produced are counted."""
    c = make_client(max_expanded_mb=1)
    data = bytearray(_zip({"zeros.bin": b"\0" * (5 * 1024 * 1024)}))
    # zero the declared uncompressed size in both the local and the central header
    import struct
    for sig, off in ((b"PK\x03\x04", 22), (b"PK\x01\x02", 24)):
        i = data.index(sig)
        data[i + off:i + off + 4] = struct.pack("<I", 100)
    r = post(c, "forged.zip", bytes(data), "archive-repack", "targz")
    assert r.status_code == 422


def test_corrupt_zip_rejected(client):
    r = post(client, "x.zip", b"PK\x03\x04" + b"garbage" * 20, "archive-repack", "targz")
    assert r.status_code == 415 or r.json()["error"]["code"] == "invalid_file"


def _tar(members) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for ti, body in members:
            tf.addfile(ti, io.BytesIO(body) if body is not None else None)
    return buf.getvalue()


def _ti(name, body=b"x", type=tarfile.REGTYPE, linkname=""):
    ti = tarfile.TarInfo(name)
    ti.type, ti.linkname = type, linkname
    ti.size = len(body) if type == tarfile.REGTYPE else 0
    return ti, (body if type == tarfile.REGTYPE else None)


@pytest.mark.parametrize("member", [
    _ti("../evil.txt"), _ti("/etc/evil.txt"), _ti("link", type=tarfile.SYMTYPE, linkname="/etc/passwd"),
    _ti("hard", type=tarfile.LNKTYPE, linkname="a.txt"), _ti("dev", type=tarfile.CHRTYPE),
])
def test_targz_hostile_members_rejected(client, member):
    r = post(client, "x.tar.gz", _tar([_ti("a.txt"), member]), "archive-repack", "zip")
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsafe_archive", r.text


def test_targz_bomb_rejected(make_client):
    c = make_client(max_expanded_mb=10)
    data = _tar([_ti("zeros.bin", b"\0" * (40 * 1024 * 1024))])
    r = post(c, "bomb.tar.gz", data, "archive-repack", "zip")
    assert r.status_code == 422 and r.json()["error"]["code"] == "archive_too_large"


def test_targz_roundtrip_preserves_contents(client, samples):
    z = post(client, "s.zip", samples["zip"].read_bytes(), "archive-repack", "targz").json()
    tgz = client.get(z["downloadUrl"]).content
    back = post(client, "s.tar.gz", tgz, "archive-repack", "zip").json()
    with zipfile.ZipFile(io.BytesIO(client.get(back["downloadUrl"]).content)) as zf:
        assert zf.read("a.txt") == b"alpha" and zf.read("dir/b.txt") == b"bravo"


# ------------------------------------------------------------------------ pdf
def test_pdf_without_text_layer_reports_no_text(client, tmp_path):
    from reportlab.pdfgen import canvas

    p = tmp_path / "blank.pdf"
    c = canvas.Canvas(str(p)); c.rect(10, 10, 50, 50, fill=1); c.save()
    r = post(client, "blank.pdf", p.read_bytes(), "pdf-server", "txt")
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_text"


def test_encrypted_pdf_rejected(client, tmp_path):
    from pypdf import PdfReader, PdfWriter

    from reportlab.pdfgen import canvas

    p = tmp_path / "plain.pdf"
    c = canvas.Canvas(str(p)); c.drawString(10, 10, "secret"); c.save()
    w = PdfWriter(); [w.add_page(pg) for pg in PdfReader(str(p)).pages]; w.encrypt("pw")
    buf = io.BytesIO(); w.write(buf)
    for target in ("txt", "png-zip"):
        r = post(client, "enc.pdf", buf.getvalue(), "pdf-server", target)
        assert r.status_code == 422 and r.json()["error"]["code"] == "encrypted_pdf", (target, r.text)


def test_corrupt_pdf_rejected(client):
    r = post(client, "bad.pdf", b"%PDF-1.4\nthis is not a pdf at all", "pdf-server", "txt")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_file"


def test_pdf_page_limit_for_rendering(make_client, tmp_path):
    from reportlab.pdfgen import canvas

    c = make_client(max_pdf_pages=2)
    p = tmp_path / "3p.pdf"
    cv = canvas.Canvas(str(p))
    for _ in range(3):
        cv.drawString(10, 10, "x"); cv.showPage()
    cv.save()
    r = post(c, "3p.pdf", p.read_bytes(), "pdf-server", "png-zip")
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_many_pages"


# ------------------------------------------------------------------ documents
@needs_pandoc
def test_pandoc_cannot_embed_local_files_into_docx(client):
    md = "![x](/etc/passwd)\n\n![y](http://169.254.169.254/latest/meta-data/)\n\n" + MARKER + "\n"
    r = post(client, "evil.md", md.encode(), "text-documents", "docx")
    assert r.status_code == 201, r.text
    with zipfile.ZipFile(io.BytesIO(client.get(r.json()["downloadUrl"]).content)) as zf:
        assert not [n for n in zf.namelist() if n.startswith("word/media")]
        assert b"root:" not in b"".join(zf.read(n) for n in zf.namelist())


@needs_pandoc
def test_pandoc_sandbox_blocks_html_includes(client):
    html = '<html><body><img src="file:///etc/passwd"><p>' + MARKER + "</p></body></html>"
    r = post(client, "evil.html", html.encode(), "text-documents", "md")
    assert r.status_code == 201
    assert "root:" not in client.get(r.json()["downloadUrl"]).text


@needs_pandoc
def test_markdown_yaml_metadata_cannot_name_files(client):
    md = "---\nreference-doc: /etc/passwd\ntemplate: /etc/passwd\n---\n\n" + MARKER + "\n"
    r = post(client, "meta.md", md.encode(), "text-documents", "docx")
    assert r.status_code == 201


@needs_pandoc
def test_corrupt_docx_rejected(client):
    r = post(client, "bad.docx", b"PK\x03\x04" + b"\0" * 50, "text-documents", "md")
    assert r.status_code == 415  # fails the content-signature check


@needs_pandoc
def test_non_utf8_markdown_is_rejected(client):
    r = post(client, "latin.md", b"caf\xe9 " * 100, "text-documents", "html")
    assert r.status_code == 415


@needs_soffice
def test_corrupt_office_file_is_rejected_cleanly(client):
    import zipfile as z

    buf = io.BytesIO()
    with z.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<broken")
        zf.writestr("word/document.xml", "<broken")
    r = post(client, "bad.docx", buf.getvalue(), "office-to-pdf", "pdf")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_file"
    assert list(client.app.state.store.root.iterdir()) == []


# ----------------------------------------------------------------------- media
@needs_ffmpeg
def test_corrupt_media_rejected(client):
    r = post(client, "bad.mp3", b"ID3" + os.urandom(2000), "audio-convert", "wav")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_file"


@needs_ffmpeg
def test_audio_file_has_no_video_stream_for_gif(client, samples):
    r = post(client, "a.mp4", samples["wav"].read_bytes(), "video-convert", "gif")
    assert r.status_code == 415  # a WAV disguised as .mp4 fails the signature check


@needs_ffmpeg
def test_video_without_audio_converts_to_mp4(client, tmp_path):
    p = tmp_path / "silent.webm"
    _ffmpeg(p, "-f", "lavfi", "-i", "testsrc=size=64x64:rate=5:duration=1", "-c:v", "libvpx")
    r = post(client, "silent.webm", p.read_bytes(), "video-convert", "mp4")
    assert r.status_code == 201, r.text
    r = post(client, "silent.webm", p.read_bytes(), "video-convert", "mp3")
    assert r.status_code == 422 and r.json()["error"]["code"] == "no_audio"


@needs_ffmpeg
def test_media_duration_limit(make_client, samples):
    c = make_client(max_audio_seconds=0)
    r = post(c, "a.wav", samples["wav"].read_bytes(), "audio-convert", "mp3")
    assert r.status_code == 422 and r.json()["error"]["code"] == "too_long"


@needs_ffmpeg
def test_gif_options_applied(client, samples):
    r = post(client, "v.mp4", samples["mp4"].read_bytes(), "video-convert", "gif", {"gifWidth": "320", "gifFps": "5"})
    assert r.status_code == 201
    gif = Image.open(io.BytesIO(client.get(r.json()["downloadUrl"]).content))
    assert gif.size[0] <= 160  # never upscaled beyond the source width (160 px)


@needs_ffmpeg
def test_timeout_kills_engine_and_cleans_up(make_client, tmp_path):
    c = make_client(convert_timeout_seconds=2)
    p = tmp_path / "big.mkv"
    _ffmpeg(p, "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=30", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "42", "-pix_fmt", "yuv420p")
    assert p.stat().st_size < 15 * 1024 * 1024
    start = time.time()
    r = post(c, "big.mkv", p.read_bytes(), "video-convert", "webm")
    assert r.status_code == 504 and r.json()["error"]["code"] == "timeout"
    assert time.time() - start < 15
    assert list(c.app.state.store.root.iterdir()) == []
    time.sleep(0.5)
    leftovers = subprocess.run(["pgrep", "-f", f"{c.app.state.store.root}"], capture_output=True).stdout.strip()
    assert leftovers == b"", "ffmpeg left running"
