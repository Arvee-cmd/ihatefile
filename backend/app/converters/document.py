"""Document conversion: LibreOffice (office -> PDF) and Pandoc (text documents)."""
from __future__ import annotations

import html as html_lib
import re
import shutil
import zipfile
from html.parser import HTMLParser
from pathlib import Path

from ..errors import ConversionError
from .common import find_soffice, output_dir, run_tool
from .sanitize import sanitize_office

_PANDOC_READER = {"md": "markdown", "html": "html", "docx": "docx", "odt": "odt"}
_FILTER = Path(__file__).with_name("strip_media.lua")
_PANDOC_WRITER = {"html": "html5", "docx": "docx", "md": "gfm", "txt": "plain"}


def _soffice_binary() -> str:
    found = find_soffice()
    if not found:
        raise ConversionError("LibreOffice is not installed on this server.", "engine_missing", 503)
    return found


def libreoffice(job) -> Path:
    work = Path(job.workdir)
    src = work / f"input.{job.input_format}"
    if Path(job.input_path) != src:
        shutil.move(job.input_path, src)
    out_dir = output_dir(job.workdir)
    # Strip linked images/templates/OLE first: LibreOffice would otherwise fetch URLs named inside the document.
    sanitize_office(
        src, job.input_format,
        max_entries=int(job.limits["max_archive_entries"]),
        max_expanded_bytes=int(job.limits["max_expanded_mb"]) * 1024 * 1024,
    )
    profile = work / "lo-profile"  # throw-away profile: no state shared between users/jobs
    proc = run_tool(
        [
            _soffice_binary(),
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless", "--invisible", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
            "--convert-to", "pdf:writer_pdf_Export" if job.input_format in ("docx", "odt", "rtf") else "pdf",
            "--outdir", str(out_dir),
            str(src),
        ],
        cwd=work,
        timeout=job.timeout,
    )
    result = out_dir / "input.pdf"
    if proc.returncode != 0 or not result.exists() or result.stat().st_size == 0:
        raise ConversionError("LibreOffice could not convert this document. It may be corrupted or use unsupported features.", "invalid_file")
    final = out_dir / "result.pdf"
    result.rename(final)
    _validate_pdf(final)
    shutil.rmtree(profile, ignore_errors=True)
    return final


def _validate_pdf(path: Path) -> None:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        if len(PdfReader(str(path)).pages) < 1:
            raise ConversionError("The converted PDF is empty.", "invalid_output", 500)
    except PyPdfError as exc:
        raise ConversionError("The converted PDF failed validation.", "invalid_output", 500) from exc


def pandoc(job) -> Path:
    work = Path(job.workdir)
    target = job.target["id"]
    src = work / f"input.{job.input_format}"
    if Path(job.input_path) != src:
        shutil.move(job.input_path, src)
    out = output_dir(job.workdir) / f"result.{ {'md': 'md', 'txt': 'txt', 'html': 'html', 'docx': 'docx'}[target] }"
    reader = _PANDOC_READER[job.input_format]
    if reader == "markdown":
        reader += "-yaml_metadata_block-pandoc_title_block"  # metadata blocks can reference files
    args = ["pandoc", "-f", reader, "-t", _PANDOC_WRITER[target], "-o", str(out), str(src)]
    if target == "docx":
        # The DOCX writer needs Pandoc's bundled reference document, which --sandbox forbids reading.
        # Instead, strip everything that could read a local file or fetch a URL (see strip_media.lua).
        args[1:1] = ["--lua-filter", str(_FILTER)]
    else:
        args[1:1] = ["--sandbox"]  # no file reads/writes beyond the given paths, no network
    if target == "html":
        args[1:1] = ["-s", "--metadata", "pagetitle=Converted document"]
    if target in ("md", "txt"):
        args[1:1] = ["--wrap=none"]
    proc = run_tool(args, cwd=work, timeout=job.timeout)
    if proc.returncode != 0 or not out.exists():
        raise ConversionError("Pandoc could not convert this document. It may be corrupted or malformed.", "invalid_file")
    if target == "docx":
        try:
            with zipfile.ZipFile(out) as zf:
                zf.getinfo("word/document.xml")
        except (zipfile.BadZipFile, KeyError) as exc:
            raise ConversionError("The converted DOCX failed validation.", "invalid_output", 500) from exc
    else:
        try:
            out.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise ConversionError("The converted text failed validation.", "invalid_output", 500) from exc
    return out


# ------------------------------------------------------------------ PDF -> DOCX
def _soffice_run(job, src: Path, convert_to: str, out_name: str, infilter: str | None = None) -> Path:
    work = Path(job.workdir)
    out_dir = output_dir(job.workdir)
    profile = work / "lo-profile"
    cmd = [
        _soffice_binary(),
        f"-env:UserInstallation={profile.as_uri()}",
        "--headless", "--invisible", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
    ]
    if infilter:
        cmd.append(f"--infilter={infilter}")
    cmd += ["--convert-to", convert_to, "--outdir", str(out_dir), str(src)]
    proc = run_tool(cmd, cwd=work, timeout=job.timeout)
    shutil.rmtree(profile, ignore_errors=True)
    produced = out_dir / f"{src.stem}.{out_name}"
    if proc.returncode != 0 or not produced.exists() or produced.stat().st_size == 0:
        raise ConversionError("LibreOffice could not convert this file. It may be corrupted or use unsupported features.", "invalid_file")
    return produced


def pdf_to_docx(job) -> Path:
    """PDF -> DOCX with LibreOffice's PDF importer. Text stays real text, but sits in positioned frames."""
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    try:
        reader = PdfReader(job.input_path)
        if reader.is_encrypted:
            raise ConversionError("The PDF is password-protected.", "encrypted_pdf")
        pages = len(reader.pages)
    except ConversionError:
        raise
    except (PyPdfError, ValueError, KeyError, OSError, RecursionError) as exc:
        raise ConversionError("The PDF is corrupted or could not be read.", "invalid_file") from exc
    limit = job.limits["max_pdf_pages"]
    if pages == 0:
        raise ConversionError("The PDF has no pages.", "invalid_file")
    if pages > limit:
        raise ConversionError(f"PDF to Word is limited to PDFs with at most {limit} pages (this one has {pages}).", "too_many_pages")
    work = Path(job.workdir)
    src = work / "input.pdf"
    if Path(job.input_path) != src:
        shutil.move(job.input_path, src)
    produced = _soffice_run(job, src, "docx:MS Word 2007 XML", "docx", infilter="writer_pdf_import")
    try:
        with zipfile.ZipFile(produced) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ConversionError("The converted DOCX failed validation.", "invalid_output", 500) from exc
    if not re.search(r"<w:t[ >][^<]*\S", xml):
        raise ConversionError(
            "This PDF has no text layer (it is probably a scan), so there is nothing to put in a Word file. Run it through OCR first.",
            "no_text",
        )
    final = output_dir(job.workdir) / "result.docx"
    produced.rename(final)
    return final


# ------------------------------------------------------------------ HTML -> PDF
_ALLOWED_TAGS = {
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr", "div", "span", "a",
    "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup",
    "col", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "small", "big", "code", "pre", "kbd", "samp",
    "blockquote", "q", "cite", "abbr", "address", "center", "font", "img", "figure", "figcaption", "section",
    "article", "header", "footer", "nav", "main", "aside", "mark", "del", "ins", "style", "var", "dfn", "time",
}
_VOID_TAGS = {"br", "hr", "img", "col"}
# Elements whose whole content is dropped (never rendered, never fetched).
_DROP_CONTENT = {"script", "iframe", "object", "embed", "noscript", "template", "svg", "math", "applet", "audio", "video",
                 "canvas", "select", "textarea", "frameset", "frame", "title"}
_ALLOWED_ATTRS = {
    "title", "lang", "dir", "align", "valign", "width", "height", "colspan", "rowspan", "border", "cellpadding",
    "cellspacing", "bgcolor", "color", "face", "size", "style", "start", "alt", "nowrap", "span", "datetime",
}
_SAFE_HREF = re.compile(r"^(https?:|mailto:|tel:|#)", re.I)
_SAFE_IMG = re.compile(r"^data:image/(png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=\s]+$", re.I)
_MAX_INLINE_IMAGE = 4 * 1024 * 1024
_DANGEROUS_CSS = re.compile(r"url\s*\(|@import|expression\s*\(|behaviou?r\s*:|-moz-binding|javascript:|image-set\s*\(|src\s*:", re.I)


def _clean_css_declarations(css: str) -> str:
    """Drops every declaration that could load something (url(), @import, ...). Keeps the rest."""
    kept = [d for d in css.split(";") if d.strip() and not _DANGEROUS_CSS.search(d)]
    return ";".join(kept)


def _clean_stylesheet(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"@(import|font-face|namespace|charset)[^;{]*(;|\{[^}]*\})", "", css, flags=re.I)
    out = []
    for rule in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        selector, body = rule
        if selector.strip().startswith("@"):
            continue
        out.append(f"{selector.strip()}{{{_clean_css_declarations(body)}}}")
    return "\n".join(out)


class _Sanitizer(HTMLParser):
    """Rebuilds the document from an allow-list so nothing in it can make LibreOffice read a file or fetch a URL."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._skip = 0
        self._skip_tag: str | None = None
        self._in_style = False
        self._style: list[str] = []
        self._image_bytes = 0

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if self._skip:
            if tag == self._skip_tag:
                self._skip += 1
            return
        if tag in _DROP_CONTENT:
            self._skip, self._skip_tag = 1, tag
            return
        if tag == "style":
            self._in_style, self._style = True, []
            return
        if tag not in _ALLOWED_TAGS:
            return  # unknown/unsafe wrapper (link, meta, base, form, input, ...): drop the tag, keep its text
        kept: list[str] = []
        for name, value in attrs:
            name, value = name.lower(), value or ""
            if name.startswith("on") or value.strip().lower().startswith("javascript:"):
                continue
            if name == "style":
                value = _clean_css_declarations(value)
                if value:
                    kept.append(f'style="{html_lib.escape(value, quote=True)}"')
            elif name == "href" and tag == "a":
                if _SAFE_HREF.match(value.strip()):
                    kept.append(f'href="{html_lib.escape(value.strip(), quote=True)}"')
            elif name == "src" and tag == "img":
                v = value.strip()
                if _SAFE_IMG.match(v):
                    self._image_bytes += len(v)
                    if self._image_bytes <= _MAX_INLINE_IMAGE:
                        kept.append(f'src="{html_lib.escape(v, quote=True)}"')
            elif name in _ALLOWED_ATTRS:
                kept.append(f'{name}="{html_lib.escape(value, quote=True)}"')
        if tag == "img" and not any(a.startswith("src=") for a in kept):
            alt = dict(attrs).get("alt")
            if alt:
                self.out.append(html_lib.escape(alt))
            return  # no usable image: show its alt text instead
        self.out.append(f"<{tag}{' ' + ' '.join(kept) if kept else ''}>")

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in _VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self._skip:
            if tag == self._skip_tag:
                self._skip -= 1
            return
        if tag == "style" and self._in_style:
            self._in_style = False
            css = _clean_stylesheet("".join(self._style))
            if css:
                self.out.append(f"<style>{css}</style>")
            return
        if tag in _ALLOWED_TAGS and tag not in _VOID_TAGS and tag != "style":
            self.out.append(f"</{tag}>")

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        if self._in_style:
            self._style.append(data)
        else:
            self.out.append(html_lib.escape(data, quote=False))


def sanitize_html(raw: bytes) -> str:
    """Returns a self-contained, script-free, network-free HTML document built from `raw`."""
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover - cp1252 leaves a few bytes undefined
        text = raw.decode("latin-1")
    parser = _Sanitizer()
    parser.feed(text)
    parser.close()
    body = "".join(parser.out)
    return f'<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Document</title></head><body>{body}</body></html>\n'


def html_to_pdf(job) -> Path:
    """HTML -> PDF. The HTML is sanitised first; LibreOffice Writer/Web renders it (no JavaScript, limited CSS)."""
    work = Path(job.workdir)
    src = work / "page.html"
    src.write_text(sanitize_html(Path(job.input_path).read_bytes()), encoding="utf-8")
    Path(job.input_path).unlink(missing_ok=True)
    produced = _soffice_run(job, src, "pdf:writer_web_pdf_Export", "pdf")
    final = output_dir(job.workdir) / "result.pdf"
    produced.rename(final)
    _validate_pdf(final)
    return final
