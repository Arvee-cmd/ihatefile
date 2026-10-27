"""Runs a converter in a separate, resource-limited, killable process.

Every conversion happens in a freshly spawned child that becomes its own process
group leader. If it exceeds the wall-clock timeout, the whole group (including
LibreOffice / FFmpeg / Pandoc children) is killed. Inside the child we apply
CPU-time, output-size, file-descriptor and (where the engine tolerates it)
address-space limits.
"""
from __future__ import annotations

import multiprocessing as mp
import os
import signal
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .errors import ConversionError

try:  # POSIX only: on Windows the limits below are skipped (the wall-clock timeout still applies)
    import resource
except ImportError:  # pragma: no cover
    resource = None  # type: ignore[assignment]


@dataclass
class Job:
    handler: str
    input_path: str
    workdir: str
    input_format: str
    target: dict
    options: dict[str, Any]
    limits: dict[str, Any]  # settings subset the handlers need
    timeout: int


# Address-space limits (MiB). LibreOffice and FFmpeg map large virtual regions, so
# they rely on CPU/time/output-size limits instead.
_AS_LIMIT_MB = {"image.pillow": 3072, "pdf.server": 3072, "archive.repack": 2048, "document.pandoc": 4096, "pdf.compress": 3072, "ocr.tesseract": 4096}


def _apply_limits(job: Job) -> None:
    if hasattr(os, "setsid"):
        os.setsid()
    if resource is None:
        return
    cpu = job.timeout + 10
    resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    out = int(job.limits["max_output_mb"]) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_FSIZE, (out, out))
    resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    as_mb = _AS_LIMIT_MB.get(job.handler)
    if as_mb:
        resource.setrlimit(resource.RLIMIT_AS, (as_mb * 1024 * 1024, as_mb * 1024 * 1024))


def _child(conn, payload: dict) -> None:
    job = Job(**payload)
    try:
        _apply_limits(job)
        from .converters import HANDLERS  # imported lazily in the child

        result = HANDLERS[job.handler](job)
        conn.send({"ok": True, "path": str(result)})
    except ConversionError as exc:
        conn.send({"ok": False, "status": exc.status, "code": exc.code, "message": exc.message})
    except MemoryError:
        conn.send({"ok": False, "status": 422, "code": "too_complex", "message": "The file needs more memory than is allowed to convert."})
    except Exception:  # noqa: BLE001 - never leak internals to the client
        conn.send({"ok": False, "status": 500, "code": "internal_error", "message": "The conversion failed unexpectedly."})
    finally:
        conn.close()


def run_job(job: Job) -> Path:
    ctx = mp.get_context("spawn")
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_child, args=(child, asdict(job)), daemon=True)
    proc.start()
    child.close()
    proc.join(job.timeout)
    timed_out = proc.is_alive()
    if timed_out:
        _kill_group(proc.pid)
        proc.join(5)
    message = None
    try:
        if parent.poll(0.2):
            message = parent.recv()
    except (EOFError, OSError):
        message = None
    finally:
        parent.close()
    _kill_group(proc.pid)  # reap any stragglers left by external engines
    if timed_out:
        raise ConversionError("The conversion took too long and was stopped.", "timeout", 504)
    if message is None:
        raise ConversionError(
            "The conversion was stopped because it exceeded the server's resource limits.", "resource_limit", 422
        )
    if not message["ok"]:
        raise ConversionError(message["message"], message["code"], message["status"])
    return Path(message["path"])


def _kill_group(pid: int | None) -> None:
    """Kill the worker and everything it started (LibreOffice, FFmpeg, ...)."""
    if not pid:
        return
    if hasattr(os, "killpg"):
        try:
            os.killpg(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    else:  # Windows: terminate the whole process tree
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True, check=False)
