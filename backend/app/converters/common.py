"""Helpers shared by the converter implementations."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from ..errors import ConversionError


def run_tool(args: list[str], *, cwd: Path, timeout: int, env_extra: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    """Run an external engine with an argument list (never a shell), minimal environment, no stdin."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(cwd),
        "TMPDIR": str(cwd),
        "LANG": "C.UTF-8",
    }
    if os.name == "nt":  # Windows programs need these to start; user-profile dirs point at the job dir
        for key in ("SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT"):
            if key in os.environ:
                env[key] = os.environ[key]
        env.update({"USERPROFILE": str(cwd), "APPDATA": str(cwd), "LOCALAPPDATA": str(cwd), "TEMP": str(cwd), "TMP": str(cwd)})
    if env_extra:
        env.update(env_extra)
    try:
        return subprocess.run(
            args,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ConversionError("The conversion took too long and was stopped.", "timeout", 504) from exc
    except FileNotFoundError as exc:
        raise ConversionError(f"The conversion engine {args[0]!r} is not installed on this server.", "engine_missing", 503) from exc


def output_dir(workdir: str) -> Path:
    p = Path(workdir) / "out"
    p.mkdir(exist_ok=True)
    return p


def find_soffice() -> str | None:
    """LibreOffice binary: on PATH, or in the usual Windows install folders."""
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        if base:
            candidate = Path(base) / "LibreOffice" / "program" / "soffice.exe"
            if candidate.exists():
                return str(candidate)
    return None


def find_tesseract() -> str | None:
    """Tesseract binary: on PATH, or in the usual Windows install folders."""
    found = shutil.which("tesseract")
    if found:
        return found
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
        if base:
            candidate = Path(base) / "Tesseract-OCR" / "tesseract.exe"
            if candidate.exists():
                return str(candidate)
    return None
