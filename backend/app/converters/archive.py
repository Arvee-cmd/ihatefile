"""ZIP <-> TAR.GZ re-packing with archive-bomb and path-traversal protection.

Nothing is ever extracted to disk under an archive-supplied path: entries are streamed
from one archive straight into the other, and only validated names are written.
"""
from __future__ import annotations

import io
import posixpath
import shutil
import stat
import tarfile
import time
import zipfile
from pathlib import Path

from ..errors import ConversionError
from .common import output_dir

_CHUNK = 64 * 1024


def safe_name(raw: str) -> str:
    """Return a normalised relative POSIX path or raise ConversionError."""
    if not raw or "\x00" in raw or "\\" in raw:
        raise ConversionError("The archive contains an invalid file name.", "unsafe_archive")
    if raw.startswith("/") or (len(raw) > 1 and raw[1] == ":"):
        raise ConversionError("The archive contains an absolute path and was rejected.", "unsafe_archive")
    parts = raw.split("/")
    if any(p == ".." for p in parts):
        raise ConversionError("The archive contains a path-traversal entry and was rejected.", "unsafe_archive")
    name = posixpath.normpath(raw)
    if name in (".", "") or name.startswith("../") or name.startswith("/"):
        raise ConversionError("The archive contains an invalid file name.", "unsafe_archive")
    if len(name) > 255 * 4:
        raise ConversionError("The archive contains an over-long file name.", "unsafe_archive")
    return name


class _Budget:
    def __init__(self, max_entries: int, max_bytes: int):
        self.max_entries, self.max_bytes = max_entries, max_bytes
        self.entries = 0
        self.bytes = 0

    def add_entry(self) -> None:
        self.entries += 1
        if self.entries > self.max_entries:
            raise ConversionError(f"The archive has more than {self.max_entries} entries and was rejected.", "archive_too_large")

    def add_bytes(self, n: int) -> None:
        self.bytes += n
        if self.bytes > self.max_bytes:
            raise ConversionError("The archive expands to more data than allowed and was rejected.", "archive_too_large")


def _copy(src, dst, budget: _Budget) -> None:
    while True:
        chunk = src.read(_CHUNK)
        if not chunk:
            return
        budget.add_bytes(len(chunk))  # counts real bytes, never the (forgeable) header size
        dst.write(chunk)


def _zip_to_targz(job, budget: _Budget) -> Path:
    out = output_dir(job.workdir) / "result.tar.gz"
    seen: set[str] = set()
    try:
        with zipfile.ZipFile(job.input_path) as zf, tarfile.open(out, "w:gz") as tf:
            infos = zf.infolist()
            if len(infos) > budget.max_entries:
                raise ConversionError(f"The archive has more than {budget.max_entries} entries and was rejected.", "archive_too_large")
            if sum(i.file_size for i in infos) > budget.max_bytes:
                raise ConversionError("The archive expands to more data than allowed and was rejected.", "archive_too_large")
            for info in infos:
                budget.add_entry()
                name = safe_name(info.filename.rstrip("/") if info.is_dir() else info.filename)
                if info.flag_bits & 0x1:
                    raise ConversionError("Encrypted ZIP entries are not supported.", "encrypted_archive")
                mode = (info.external_attr >> 16) & 0xFFFF
                if mode and (stat.S_ISLNK(mode) or stat.S_ISCHR(mode) or stat.S_ISBLK(mode) or stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
                    raise ConversionError("The archive contains links or special files and was rejected.", "unsafe_archive")
                if name in seen:
                    raise ConversionError("The archive contains duplicate entries and was rejected.", "unsafe_archive")
                seen.add(name)
                ti = tarfile.TarInfo(name)
                ti.mtime = time.mktime(info.date_time + (0, 0, -1)) if info.date_time[0] >= 1980 else 0
                ti.uid = ti.gid = 0
                ti.uname = ti.gname = ""
                if info.is_dir():
                    ti.type, ti.mode = tarfile.DIRTYPE, 0o755
                    tf.addfile(ti)
                    continue
                ti.mode = 0o644
                ti.size = info.file_size
                with zf.open(info) as src:
                    buf = io.BytesIO() if info.file_size <= 8 * 1024 * 1024 else None
                    if buf is not None:
                        _copy(src, buf, budget)
                        ti.size = buf.tell()
                        buf.seek(0)
                        tf.addfile(ti, buf)
                    else:
                        # Large entry: spool to disk first so the tar header carries the true size.
                        tmp = Path(job.workdir) / "spool.bin"
                        with open(tmp, "wb") as spool:
                            _copy(src, spool, budget)
                        ti.size = tmp.stat().st_size
                        with open(tmp, "rb") as spool:
                            tf.addfile(ti, spool)
                        tmp.unlink()
    except zipfile.BadZipFile as exc:
        raise ConversionError("The ZIP file is corrupted.", "invalid_file") from exc
    except (RuntimeError, NotImplementedError) as exc:  # encrypted / unsupported compression
        raise ConversionError("This ZIP uses encryption or a compression method that is not supported.", "unsupported_archive") from exc
    return out


def _targz_to_zip(job, budget: _Budget) -> Path:
    out = output_dir(job.workdir) / "result.zip"
    seen: set[str] = set()
    try:
        with tarfile.open(job.input_path, "r:gz") as tf, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
            for member in tf:  # streaming iteration; never getmembers() on untrusted input
                budget.add_entry()
                if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                    raise ConversionError("The archive contains links or special files and was rejected.", "unsafe_archive")
                if not (member.isreg() or member.isdir()):
                    raise ConversionError("The archive contains an unsupported entry type and was rejected.", "unsafe_archive")
                name = safe_name(member.name.rstrip("/") if member.isdir() else member.name)
                if name in seen:
                    raise ConversionError("The archive contains duplicate entries and was rejected.", "unsafe_archive")
                seen.add(name)
                if member.isdir():
                    zf.writestr(zipfile.ZipInfo(name + "/", date_time=(1980, 1, 1, 0, 0, 0)), b"")
                    continue
                zi = zipfile.ZipInfo(name, date_time=time.gmtime(max(member.mtime, 315532800))[:6])
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o644 << 16
                src = tf.extractfile(member)
                if src is None:
                    raise ConversionError("The archive could not be read.", "invalid_file")
                with src, zf.open(zi, "w", force_zip64=True) as dst:
                    _copy(src, dst, budget)
    except (tarfile.TarError, EOFError, OSError) as exc:
        if isinstance(exc, ConversionError):
            raise
        raise ConversionError("The TAR.GZ file is corrupted.", "invalid_file") from exc
    return out


def convert(job) -> Path:
    budget = _Budget(job.limits["max_archive_entries"], job.limits["max_expanded_mb"] * 1024 * 1024)
    try:
        if job.input_format == "zip":
            return _zip_to_targz(job, budget)
        return _targz_to_zip(job, budget)
    except ConversionError:
        shutil.rmtree(Path(job.workdir) / "out", ignore_errors=True)
        raise
