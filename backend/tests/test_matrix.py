"""Converts a real sample for EVERY (tool, input, target) pair the registry advertises for the server,
using the real engines, and validates the output bytes. Pairs whose engine is missing are skipped,
never silently passed."""
from __future__ import annotations

import io
import json
import subprocess
import tarfile
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from conftest import HAVE_FFMPEG, HAVE_PANDOC, HAVE_SOFFICE, MARKER, post
from app.config import Settings
from app.registry import load_registry

REG = load_registry(Settings().registry_path)

# These need purpose-built inputs (scans, image-heavy PDFs, hostile HTML), so test_new_tools.py covers every pair.
COVERED_IN_NEW_TOOLS = {"pdf-compress", "pdf-to-word", "ocr", "html-to-pdf"}

PAIRS = []
for tool in REG.server_tools():
    if tool["id"] in COVERED_IN_NEW_TOOLS:
        continue
    for target in tool["targets"]:
        for fmt in target.get("from", tool["inputs"]):
            if fmt == target["format"] and not tool.get("allowSameFormat"):
                continue
            PAIRS.append(pytest.param(tool["id"], fmt, target["id"], id=f"{tool['id']}:{fmt}->{target['id']}"))

NEEDS = {"office-to-pdf": HAVE_SOFFICE, "text-documents": HAVE_PANDOC, "audio-convert": HAVE_FFMPEG, "video-convert": HAVE_FFMPEG}
PIL_NAMES = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP", "gif": "GIF", "bmp": "BMP", "tiff": "TIFF", "ico": "ICO"}
FFPROBE_NAMES = {"mp3": "mp3", "wav": "wav", "flac": "flac", "ogg": "ogg", "m4a": "mov,mp4", "mp4": "mov,mp4", "webm": "matroska,webm", "gif": "gif_pipe"}


def probe(data: bytes, tmp: Path) -> dict:
    p = tmp / "probe.bin"
    p.write_bytes(data)
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=format_name:stream=codec_type,codec_name", "-of", "json", str(p)],
                         capture_output=True, check=True).stdout
    return json.loads(out)


def pdf_text(data: bytes) -> str:
    import pdfplumber

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join((pg.extract_text() or "") for pg in pdf.pages)


def validate(fmt: str, data: bytes, tmp: Path, *, source_fmt: str, tool: str, target: str) -> None:
    if fmt in PIL_NAMES:
        with Image.open(io.BytesIO(data)) as im:
            assert im.format == PIL_NAMES[fmt]
            im.load()
            assert im.size[0] > 0
    elif fmt == "pdf":
        from pypdf import PdfReader

        assert len(PdfReader(io.BytesIO(data)).pages) >= 1
        if tool == "office-to-pdf" and source_fmt in ("docx", "odt", "rtf", "xlsx", "ods", "pptx", "odp"):
            assert MARKER in pdf_text(data)  # the document's real text made it into the PDF
    elif fmt == "docx":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            assert MARKER in zf.read("word/document.xml").decode()
    elif fmt in ("html", "md", "txt"):
        text = data.decode("utf-8")
        assert MARKER in text, text[:200]
        if fmt == "html":
            assert "<" in text
    elif fmt == "zip":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            assert zf.testzip() is None
            names = zf.namelist()
            if target == "png-zip":
                assert names == ["page-001.png", "page-002.png"]
                Image.open(io.BytesIO(zf.read(names[0]))).verify()
            else:
                assert sorted(names) == ["a.txt", "dir/b.txt"]
                assert zf.read("dir/b.txt") == b"bravo"
    elif fmt == "targz":
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tf:
            assert sorted(m.name for m in tf.getmembers() if m.isfile()) == ["a.txt", "dir/b.txt"]
            assert tf.extractfile("dir/b.txt").read() == b"bravo"
    else:
        info = probe(data, tmp)
        names = FFPROBE_NAMES[fmt]
        assert names in info["format"]["format_name"], info
        kinds = {s["codec_type"] for s in info["streams"]}
        assert ("video" if fmt in ("mp4", "webm", "gif") else "audio") in kinds


@pytest.mark.parametrize("tool,fmt,target", PAIRS)
def test_every_advertised_pair(client, samples, tmp_path, tool, fmt, target):
    if not NEEDS.get(tool, True):
        pytest.skip(f"engine for {tool} not installed")
    if fmt not in samples:
        pytest.skip(f"no sample for {fmt} (engine missing)")
    src = samples[fmt]
    r = post(client, src.name, src.read_bytes(), tool, target)
    assert r.status_code == 201, r.text
    job = r.json()
    out_fmt = next(t["format"] for t in REG.tool(tool)["targets"] if t["id"] == target)
    assert job["filename"].endswith("." + REG.formats[out_fmt]["extensions"][0])
    data = client.get(job["downloadUrl"]).content
    assert len(data) == job["size"] > 0
    validate(out_fmt, data, tmp_path, source_fmt=fmt, tool=tool, target=target)
    client.delete(f"/api/v1/jobs/{job['jobId']}")
