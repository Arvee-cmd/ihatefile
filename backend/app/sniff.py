"""Content-signature checks. The extension and claimed MIME type are never trusted on their own."""
from __future__ import annotations

import zipfile
from pathlib import Path

_OOXML_MARKERS = {
    "docx": "word/document.xml",
    "xlsx": "xl/workbook.xml",
    "pptx": "ppt/presentation.xml",
}
_ODF_MIME = {
    "odt": b"application/vnd.oasis.opendocument.text",
    "ods": b"application/vnd.oasis.opendocument.spreadsheet",
    "odp": b"application/vnd.oasis.opendocument.presentation",
}
_TEXT_FORMATS = {"txt", "md", "html", "json", "csv", "xml"}


def _head(path: Path, n: int = 4096) -> bytes:
    with open(path, "rb") as fh:
        return fh.read(n)


def _is_text(head: bytes) -> bool:
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError as exc:
        # A multi-byte character cut by the read window is fine.
        if exc.start < len(head) - 4:
            return False
    return True


_CONTROL = set(range(0, 32)) - {9, 10, 12, 13}


def _is_legacy_text(head: bytes) -> bool:
    return not any(b in _CONTROL for b in head)


def matches_signature(path: Path, fmt: str) -> bool:
    head = _head(path)
    if fmt == "png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if fmt == "jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if fmt == "gif":
        return head[:6] in (b"GIF87a", b"GIF89a")
    if fmt == "webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if fmt == "bmp":
        return head[:2] == b"BM"
    if fmt == "tiff":
        return head[:4] in (b"II*\x00", b"MM\x00*")
    if fmt == "ico":
        return head[:4] == b"\x00\x00\x01\x00"
    if fmt == "pdf":
        return b"%PDF-" in head[:1024]
    if fmt == "rtf":
        return head.lstrip().startswith(b"{\\rtf")
    if fmt == "mp3":
        return head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
    if fmt == "wav":
        return head[:4] == b"RIFF" and head[8:12] == b"WAVE"
    if fmt == "flac":
        return head.startswith(b"fLaC")
    if fmt == "ogg":
        return head.startswith(b"OggS")
    if fmt in ("m4a", "mp4", "mov"):
        return head[4:8] == b"ftyp" or (fmt == "mov" and head[4:8] in (b"moov", b"mdat", b"wide", b"free"))
    if fmt in ("webm", "mkv"):
        return head.startswith(b"\x1a\x45\xdf\xa3")
    if fmt == "targz":
        return head.startswith(b"\x1f\x8b")
    if fmt in _OOXML_MARKERS or fmt in _ODF_MIME or fmt == "zip":
        if not head.startswith(b"PK"):
            return False
        try:
            with zipfile.ZipFile(path) as zf:
                names = set(zf.namelist())
                if fmt == "zip":
                    return True
                if fmt in _OOXML_MARKERS:
                    return "[Content_Types].xml" in names and _OOXML_MARKERS[fmt] in names
                return zf.read("mimetype").strip() == _ODF_MIME[fmt] if "mimetype" in names else False
        except (zipfile.BadZipFile, OSError, KeyError):
            return False
    if fmt == "html":  # legacy pages are often Windows-1252 / Latin-1: accept any control-character-free text
        return _is_text(head) or _is_legacy_text(head)
    if fmt in _TEXT_FORMATS:
        return _is_text(head)
    return False
