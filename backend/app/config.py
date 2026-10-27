"""Runtime configuration, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:  # fail fast on misconfiguration
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from exc


def _default_registry() -> Path:
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / "shared" / "registry.json",  # repo checkout
        here.parents[1] / "shared" / "registry.json",  # container image (backend/shared)
    ]
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]


@dataclass(frozen=True)
class Settings:
    max_upload_mb: int = 20
    job_ttl_seconds: int = 600
    convert_timeout_seconds: int = 120
    max_concurrent_jobs: int = 2
    rate_limit_per_minute: int = 20
    max_archive_entries: int = 1000
    max_expanded_mb: int = 200
    max_output_mb: int = 200
    max_audio_seconds: int = 1800
    max_video_seconds: int = 600
    max_pdf_pages: int = 50
    max_ocr_pages: int = 20
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://localhost:4173")
    trust_proxy_headers: bool = False
    trusted_proxy_hops: int = 1
    enable_docs: bool = False
    tmp_root: Path = field(default_factory=lambda: Path(tempfile.gettempdir()) / "ihatefile")
    registry_path: Path = field(default_factory=_default_registry)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.environ.get("IHATEFILE_CORS_ORIGINS")
        kwargs: dict = {}
        if origins is not None:
            kwargs["cors_origins"] = tuple(o.strip() for o in origins.split(",") if o.strip())
            if any("*" in o for o in kwargs["cors_origins"]):
                raise RuntimeError("IHATEFILE_CORS_ORIGINS must list exact origins; wildcards are not allowed.")
        if os.environ.get("IHATEFILE_TMP_ROOT"):
            kwargs["tmp_root"] = Path(os.environ["IHATEFILE_TMP_ROOT"])
        if os.environ.get("IHATEFILE_REGISTRY_PATH"):
            kwargs["registry_path"] = Path(os.environ["IHATEFILE_REGISTRY_PATH"])
        return cls(
            max_upload_mb=_int("IHATEFILE_MAX_UPLOAD_MB", 20),
            job_ttl_seconds=_int("IHATEFILE_JOB_TTL_SECONDS", 600),
            convert_timeout_seconds=_int("IHATEFILE_CONVERT_TIMEOUT_SECONDS", 120),
            max_concurrent_jobs=_int("IHATEFILE_MAX_CONCURRENT_JOBS", 2),
            rate_limit_per_minute=_int("IHATEFILE_RATE_LIMIT_PER_MINUTE", 20),
            max_archive_entries=_int("IHATEFILE_MAX_ARCHIVE_ENTRIES", 1000),
            max_expanded_mb=_int("IHATEFILE_MAX_EXPANDED_MB", 200),
            max_output_mb=_int("IHATEFILE_MAX_OUTPUT_MB", 200),
            max_audio_seconds=_int("IHATEFILE_MAX_AUDIO_SECONDS", 1800),
            max_video_seconds=_int("IHATEFILE_MAX_VIDEO_SECONDS", 600),
            max_pdf_pages=_int("IHATEFILE_MAX_PDF_PAGES", 50),
            max_ocr_pages=_int("IHATEFILE_MAX_OCR_PAGES", 20),
            trust_proxy_headers=os.environ.get("IHATEFILE_TRUST_PROXY_HEADERS", "").lower() in {"1", "true", "yes"},
            trusted_proxy_hops=max(1, _int("IHATEFILE_TRUSTED_PROXY_HOPS", 1)),
            enable_docs=os.environ.get("IHATEFILE_ENABLE_DOCS", "").lower() in {"1", "true", "yes"},
            **kwargs,
        )
