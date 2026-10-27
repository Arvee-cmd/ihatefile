"""Detects which conversion engines/codecs this server really has, so /formats never over-promises."""
from __future__ import annotations

import shutil
import subprocess
from typing import Any

from .converters.common import find_soffice, find_tesseract
from .registry import Registry

# target id -> FFmpeg encoders that must exist
_AUDIO_ENCODERS = {"mp3": ["libmp3lame"], "wav": ["pcm_s16le"], "flac": ["flac"], "ogg": ["libvorbis"], "m4a": ["aac"]}
_VIDEO_ENCODERS = {"mp4": ["libx264", "aac"], "webm": ["libvpx-vp9", "libopus"], "gif": ["gif"], "mp3": ["libmp3lame"]}


def _ffmpeg_encoders() -> set[str] | None:
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        return None
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, timeout=15, check=False).stdout.decode(errors="replace")
    except (OSError, subprocess.TimeoutExpired):
        return None
    names = set()
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and len(parts[0]) == 6:
            names.add(parts[1])
    return names


def _module_ok(name: str) -> bool:
    try:
        __import__(name)
        return True
    except Exception:  # noqa: BLE001
        return False


def detect(registry: Registry) -> dict[str, Any]:
    """Returns {tool_id: {"enabled": bool, "reason": str|None, "disabledTargets": {target: reason}}}."""
    encoders = _ffmpeg_encoders()
    soffice = find_soffice() is not None
    pandoc = bool(shutil.which("pandoc"))
    result: dict[str, Any] = {}
    for tool in registry.server_tools():
        cap = tool.get("serverCapability")
        enabled, reason, disabled = True, None, {}
        option_choices: dict[str, list[str]] = {}
        if cap == "libreoffice" and not soffice:
            enabled, reason = False, "LibreOffice is not installed on this server."
        elif cap == "pandoc" and not pandoc:
            enabled, reason = False, "Pandoc is not installed on this server."
        elif cap == "ffmpeg":
            if encoders is None:
                enabled, reason = False, "FFmpeg is not installed on this server."
            else:
                need = _AUDIO_ENCODERS if tool["id"] == "audio-convert" else _VIDEO_ENCODERS
                for target in tool["targets"]:
                    missing = [e for e in need.get(target["id"], []) if e not in encoders]
                    if missing:
                        disabled[target["id"]] = f"FFmpeg on this server lacks the {', '.join(missing)} encoder."
        elif cap == "pillow":
            if not _module_ok("PIL"):
                enabled, reason = False, "Pillow is not installed."
            else:
                from PIL import features

                if not features.check("webp"):
                    disabled["webp"] = "This Pillow build has no WebP support."
        elif cap == "tesseract":
            if find_tesseract() is None:
                enabled, reason = False, "Tesseract is not installed on this server."
            else:
                from .converters.ocr import installed_languages

                have = installed_languages()
                langs = [c["value"] for c in registry.option_defs["ocrLang"]["choices"] if c["value"] in have]
                if langs:
                    option_choices["ocrLang"] = langs
                else:
                    enabled, reason = False, "No supported OCR language pack is installed on this server."
        elif cap == "pdf":
            if not all(_module_ok(m) for m in ("pdfplumber", "pypdfium2", "pypdf", "PIL")):
                enabled, reason = False, "PDF libraries are not installed."
        if enabled and len(disabled) == len(tool["targets"]):
            enabled, reason = False, "No target of this tool is available on this server."
        result[tool["id"]] = {"enabled": enabled, "reason": reason, "disabledTargets": disabled, "optionChoices": option_choices}
    return result
