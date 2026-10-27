"""Removes everything from an Office file that could make LibreOffice read a file or fetch a URL.

LibreOffice follows *linked* images, templates and OLE objects while loading a document. Without this step a crafted
DOCX/PPTX/ODT can make the server send HTTP requests (to an internal network or a cloud metadata service) or read
local image files, and render the result into the PDF it hands back. The document is rewritten before LibreOffice sees it:

* OOXML (docx/xlsx/pptx): every relationship that points outside the package is dropped, except plain web/mail hyperlinks
  (links in a PDF are annotations; nothing is fetched).
* ODF (odt/ods/odp): every ``xlink:href`` that is not an in-package path is dropped, except hyperlinks on ``text:a``/``draw:a``
  with a web/mail scheme.
* The archive is read with entry-count and expanded-size limits (zip-bomb protection), XML containing a DTD/entity
  declaration is refused (neither format uses them), and parsing never resolves entities or touches the network.
"""
from __future__ import annotations

import re
import zipfile
from pathlib import Path, PurePosixPath

from ..errors import ConversionError

_SCHEME = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")
_SAFE_LINK_SCHEMES = ("http:", "https:", "mailto:", "tel:")
_XLINK_HREF = "{http://www.w3.org/1999/xlink}href"
_ODF_LINK_TAGS = {
    "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}a",
    "{urn:oasis:names:tc:opendocument:xmlns:drawing:1.0}a",
}
_MAX_XML_PART = 64 * 1024 * 1024
_ODF = {"odt", "ods", "odp"}
_OOXML = {"docx", "xlsx", "pptx"}


def _is_safe_link(value: str) -> bool:
    return value.strip().lower().startswith(_SAFE_LINK_SCHEMES)


def _is_internal_path(value: str) -> bool:
    """A package-internal reference: no scheme, not absolute, no parent-directory hops, no UNC/backslash tricks."""
    v = value.strip()
    return bool(v) and not _SCHEME.match(v) and not v.startswith(("/", "\\")) and ".." not in v and "\\" not in v


def _parse(data: bytes, name: str):
    from lxml import etree

    head = data[:4096].lower()
    if b"<!doctype" in head or b"<!entity" in data[:65536].lower():
        raise ConversionError("The document contains constructs that are not allowed (DTD or entity declarations).", "invalid_file")
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, dtd_validation=False,
                             huge_tree=False, remove_pis=False)
    try:
        return etree.fromstring(data, parser)
    except etree.XMLSyntaxError as exc:
        raise ConversionError(f"The document is corrupted ({name} is not valid XML).", "invalid_file") from exc


def _serialise(root) -> bytes:
    from lxml import etree

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def clean_rels(data: bytes, name: str) -> tuple[bytes, int]:
    """Drops external (or scheme-carrying) relationships from an OOXML ``.rels`` part. Returns (xml, removed)."""
    root = _parse(data, name)
    removed = 0
    for rel in list(root):
        if not isinstance(rel.tag, str) or not rel.tag.endswith("}Relationship") and rel.tag != "Relationship":
            continue
        target = rel.get("Target", "")
        external = rel.get("TargetMode", "").lower() == "external"
        rel_type = rel.get("Type", "")
        if rel_type.endswith("/hyperlink"):
            ok = _is_safe_link(target) or (not external and not _SCHEME.match(target.strip()))
        else:
            ok = not external and not _SCHEME.match(target.strip()) and not target.strip().startswith(("\\\\", "//"))
        if not ok:
            root.remove(rel)
            removed += 1
    return (_serialise(root) if removed else data), removed


def clean_odf_xml(data: bytes, name: str) -> tuple[bytes, int]:
    """Drops xlink:href attributes that are not in-package paths (or safe hyperlinks). Returns (xml, removed)."""
    if b"xlink:href" not in data and b"xlink:" not in data:
        return data, 0
    root = _parse(data, name)
    removed = 0
    for el in root.iter():
        if not isinstance(el.tag, str):
            continue
        value = el.get(_XLINK_HREF)
        if value is None:
            continue
        keep = _is_safe_link(value) if el.tag in _ODF_LINK_TAGS else _is_internal_path(value)
        if el.tag in _ODF_LINK_TAGS and not keep:
            keep = value.startswith("#") or _is_internal_path(value)
        if not keep:
            del el.attrib[_XLINK_HREF]
            removed += 1
    return (_serialise(root) if removed else data), removed


def sanitize_office(path: Path, fmt: str, *, max_entries: int, max_expanded_bytes: int) -> int:
    """Rewrites the Office file at ``path`` in place. Returns how many external references were removed."""
    if fmt not in _ODF | _OOXML:
        return 0
    total = 0
    removed = 0
    parts: list[tuple[zipfile.ZipInfo, bytes]] = []
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            if len(infos) > max_entries:
                raise ConversionError("The document contains too many parts.", "archive_too_large")
            for info in infos:
                name = info.filename
                pure = PurePosixPath(name)
                if name.startswith(("/", "\\")) or ".." in pure.parts or "\\" in name or info.flag_bits & 0x1:
                    raise ConversionError("The document is corrupted or encrypted.", "invalid_file")
                if info.is_dir():
                    continue
                with zf.open(info) as fh:  # real decompressed size, not the (forgeable) header value
                    data = fh.read(max_expanded_bytes - total + 1)
                total += len(data)
                if total > max_expanded_bytes:
                    raise ConversionError("The document expands to more data than is allowed.", "archive_too_large", 413)
                lower = name.lower()
                if fmt in _OOXML and lower.endswith(".rels"):
                    if len(data) > _MAX_XML_PART:
                        raise ConversionError("The document has an oversized relationship part.", "invalid_file")
                    data, n = clean_rels(data, name)
                    removed += n
                elif fmt in _ODF and lower.endswith(".xml") and not lower.startswith("meta-inf/"):
                    if len(data) > _MAX_XML_PART:
                        if b"xlink:" in data[:_MAX_XML_PART] or b"xlink:" in data[_MAX_XML_PART:]:
                            raise ConversionError("A part of the document is too large to check safely.", "too_complex")
                    else:
                        data, n = clean_odf_xml(data, name)
                        removed += n
                parts.append((info, data))
    except zipfile.BadZipFile as exc:
        raise ConversionError("The file is corrupted or is not a valid document.", "invalid_file") from exc
    except (OSError, EOFError, zipfile.LargeZipFile, NotImplementedError, RuntimeError) as exc:
        raise ConversionError("The file is corrupted or is not a valid document.", "invalid_file") from exc

    tmp = path.with_suffix(path.suffix + ".clean")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as out:
        for info, data in parts:
            new = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            stored = info.filename == "mimetype"  # ODF requires an uncompressed, first "mimetype" entry
            new.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            out.writestr(new, data)
    tmp.replace(path)
    return removed
