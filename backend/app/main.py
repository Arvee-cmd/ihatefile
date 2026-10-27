"""ihatefile conversion API (FastAPI)."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import re
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .capabilities import detect
from .config import Settings
from .errors import ApiError, ConversionError, bad_request
from .jobs import JobStore
from .ratelimit import RateLimiter
from .registry import Registry, load_registry
from .sniff import matches_signature
from .worker import Job, run_job

log = logging.getLogger("ihatefile")
_JOB_ID = re.compile(r"^[A-Za-z0-9_-]{43}$")
_MULTIPART_OVERHEAD = 256 * 1024


def client_ip(headers: list[tuple[bytes, bytes]], peer: str, settings: Settings) -> str:
    """The address used for rate limiting.

    Only trusts X-Forwarded-For when the operator says a proxy sets it, and then reads the entry *that proxy appended*
    (counting ``trusted_proxy_hops`` from the right). The left-most entries are written by the client and can be anything.
    """
    if not settings.trust_proxy_headers:
        return peer
    values = [v.decode("latin-1") for k, v in headers if k == b"x-forwarded-for"]
    parts = [p.strip() for chunk in values for p in chunk.split(",") if p.strip()]
    if len(parts) < settings.trusted_proxy_hops:
        return peer
    candidate = parts[-settings.trusted_proxy_hops]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return peer


def _error_response(status: int, code: str, message: str, headers: dict[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


class GuardMiddleware:
    """Rate limit and upload-size limit for POST /api/v1/convert, applied before the body is parsed."""

    def __init__(self, app: ASGIApp, settings: Settings, limiter: RateLimiter):
        self.app, self.settings, self.limiter = app, settings, limiter

    def client_id(self, scope: Scope) -> str:
        client = scope.get("client")
        return client_ip(scope["headers"], client[0] if client else "unknown", self.settings)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != "/api/v1/convert":
            await self.app(scope, receive, send)
            return
        wait = self.limiter.check(self.client_id(scope))
        if wait is not None:
            resp = _error_response(429, "rate_limited", "Too many requests. Please wait a moment and try again.", {"Retry-After": str(int(wait) + 1)})
            await resp(scope, receive, send)
            return
        limit = self.settings.max_upload_bytes + _MULTIPART_OVERHEAD
        declared = next((v for k, v in scope["headers"] if k == b"content-length"), None)
        if declared is not None and declared.isdigit() and int(declared) > limit:
            resp = _error_response(413, "file_too_large", f"The file is larger than the {self.settings.max_upload_mb} MB limit.")
            await resp(scope, receive, send)
            return
        received = 0
        exceeded = False
        replaced = False
        too_large = _error_response(413, "file_too_large", f"The file is larger than the {self.settings.max_upload_mb} MB limit.")

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:  # chunked or lying clients: stop reading as soon as the limit is passed
                    exceeded = True
                    raise ApiError(413, "file_too_large", "upload too large")
            return message

        async def guarded_send(message: Message) -> None:
            # The multipart parser turns a failed read into a generic 400; report the real cause instead.
            nonlocal replaced
            if exceeded:
                if not replaced:
                    replaced = True
                    await too_large(scope, receive, send)
                return
            await send(message)

        await self.app(scope, limited_receive, guarded_send)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    registry: Registry = load_registry(settings.registry_path)
    store = JobStore(settings.tmp_root, settings.job_ttl_seconds)
    limiter = RateLimiter(settings.rate_limit_per_minute)
    slots = threading.BoundedSemaphore(settings.max_concurrent_jobs)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.capabilities = detect(registry)
        store.reset()

        async def sweeper() -> None:
            interval = max(1.0, min(30.0, settings.job_ttl_seconds / 2))
            while True:
                await asyncio.sleep(interval)
                try:
                    store.sweep()
                except Exception:  # noqa: BLE001
                    log.exception("sweep failed")

        task = asyncio.create_task(sweeper())
        try:
            yield
        finally:
            task.cancel()
            store.reset()

    app = FastAPI(title="ihatefile API", version=__version__, lifespan=lifespan,
                  docs_url="/api/docs" if settings.enable_docs else None,
                  redoc_url=None,
                  openapi_url="/api/openapi.json" if settings.enable_docs else None)
    app.state.settings, app.state.store, app.state.registry, app.state.limiter = settings, store, registry, limiter
    app.state.slots = slots
    app.state.capabilities = detect(registry)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_methods=["GET", "POST", "DELETE"],
            allow_headers=["Content-Type"],
            expose_headers=["Content-Disposition"],
            max_age=600,
        )
    app.add_middleware(GuardMiddleware, settings=settings, limiter=limiter)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        # Results are files for download, never pages: even if one is opened in a tab it runs with no privileges.
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; sandbox"
        response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
        response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError):
        return _error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_: Request, exc: StarletteHTTPException):
        return _error_response(exc.status_code, "http_error", str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        return _error_response(500, "internal_error", "Something went wrong on the server.")

    # ---------------------------------------------------------------- routes
    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "version": __version__, "time": int(time.time())}

    @app.get("/api/v1/formats")
    def formats() -> dict[str, Any]:
        caps = app.state.capabilities
        tools = []
        for tool in registry.server_tools():
            c = caps[tool["id"]]
            tools.append({
                "id": tool["id"],
                "enabled": c["enabled"],
                "reason": c["reason"],
                "disabledTargets": c["disabledTargets"],
                "optionChoices": c.get("optionChoices", {}),
                "maxFileMB": min(tool["maxFileMB"], settings.max_upload_mb),
            })
        return {
            "registryVersion": registry.raw["version"],
            "apiVersion": __version__,
            "limits": {"maxUploadMB": settings.max_upload_mb, "jobTtlSeconds": settings.job_ttl_seconds},
            "tools": tools,
        }

    @app.post("/api/v1/convert", status_code=201)
    async def convert(
        request: Request,
        file: UploadFile = File(...),
        tool: str = Form(...),
        target: str = Form(...),
        options: str = Form("{}"),
    ) -> dict[str, Any]:
        peer = request.scope["client"][0] if request.scope.get("client") else "unknown"
        client = client_ip(request.scope["headers"], peer, settings)
        original_name = Path((file.filename or "").replace("\\", "/")).name
        input_format = registry.format_from_filename(original_name)
        if input_format is None:
            raise ApiError(415, "unsupported_type", "This file type is not supported.")
        tool_def, target_def = registry.resolve(tool, target, input_format)
        cap = app.state.capabilities[tool_def["id"]]
        if not cap["enabled"]:
            raise ApiError(503, "tool_unavailable", cap["reason"] or "This conversion is unavailable on this server.")
        if target_def["id"] in cap["disabledTargets"]:
            raise ApiError(503, "tool_unavailable", cap["disabledTargets"][target_def["id"]])
        try:
            raw_options = json.loads(options or "{}")
            if not isinstance(raw_options, dict):
                raise ValueError
        except ValueError:
            raise bad_request("options must be a JSON object", "bad_option") from None
        opts = registry.validate_options(target_def, raw_options)

        max_bytes = min(tool_def["maxFileMB"], settings.max_upload_mb) * 1024 * 1024
        if not limiter.acquire(client):
            raise ApiError(429, "busy", "You already have a conversion running. Please wait for it to finish.")
        if not slots.acquire(blocking=False):
            limiter.release(client)
            raise ApiError(503, "server_busy", "The server is busy converting other files. Please try again shortly.")
        job_id, workdir = store.new_workdir()
        committed = False
        started = time.monotonic()
        try:
            ext = registry.formats[input_format]["extensions"][0]
            src = workdir / f"input.{ext}"
            size = 0
            with open(src, "wb") as fh:
                while chunk := await file.read(64 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise ApiError(413, "file_too_large", f"The file is larger than the {max_bytes // (1024 * 1024)} MB limit for this conversion.")
                    fh.write(chunk)
            if size == 0:
                raise bad_request("The file is empty.", "empty_file")
            if not matches_signature(src, input_format):
                raise ApiError(415, "signature_mismatch", f"The file content does not look like a valid {registry.formats[input_format]['label']} file.")

            job = Job(
                handler=tool_def["handler"], input_path=str(src), workdir=str(workdir), input_format=input_format,
                target=target_def, options=opts,
                limits={
                    "max_output_mb": settings.max_output_mb, "max_archive_entries": settings.max_archive_entries,
                    "max_expanded_mb": settings.max_expanded_mb, "max_audio_seconds": settings.max_audio_seconds,
                    "max_video_seconds": settings.max_video_seconds, "max_pdf_pages": settings.max_pdf_pages,
                    "max_ocr_pages": settings.max_ocr_pages,
                },
                timeout=settings.convert_timeout_seconds,
            )
            output = await asyncio.to_thread(run_job, job)
            if not output.exists() or output.stat().st_size == 0:
                raise ConversionError("The conversion produced no output.", "invalid_output", 500)
            src.unlink(missing_ok=True)  # the upload is deleted as soon as it has been converted

            out_fmt = registry.formats[target_def["format"]]
            stem = re.sub(r"[^A-Za-z0-9._ -]", "_", original_name.rsplit(".", 1)[0] if "." in original_name else original_name).strip(" .") or "converted"
            stem = stem[:100]
            stem += {"png-zip": "-pages", "compressed": "-compressed", "searchable-pdf": "-ocr", "ocr-txt": "-ocr"}.get(target_def["id"], "")
            filename = f"{stem}.{out_fmt['extensions'][0]}"
            stored = store.commit(job_id, workdir, output, filename, out_fmt["mime"])
            committed = True
            log.info("converted tool=%s %s->%s in=%dB out=%dB %.1fs", tool_def["id"], input_format, target_def["id"], size, stored.size, time.monotonic() - started)
            return {
                "jobId": job_id, "status": "completed", "filename": filename, "size": stored.size,
                "mediaType": out_fmt["mime"], "expiresAt": int(stored.expires),
                "downloadUrl": f"/api/v1/jobs/{job_id}/download",
            }
        finally:
            if not committed:
                store.discard_workdir(workdir)
            slots.release()
            limiter.release(client)
            await file.close()

    def _job_or_404(job_id: str):
        if not _JOB_ID.match(job_id):
            raise ApiError(404, "not_found", "Job not found.")
        job = store.get(job_id)
        if job is None:
            if store.was_expired(job_id):
                raise ApiError(410, "expired", "This result has expired and was deleted.")
            raise ApiError(404, "not_found", "Job not found.")
        return job

    @app.get("/api/v1/jobs/{job_id}")
    def job_status(job_id: str) -> dict[str, Any]:
        job = _job_or_404(job_id)
        return {"jobId": job.id, "status": "completed", "filename": job.filename, "size": job.size,
                "mediaType": job.media_type, "expiresAt": int(job.expires)}

    @app.get("/api/v1/jobs/{job_id}/download")
    def job_download(job_id: str):
        job = _job_or_404(job_id)
        return FileResponse(job.output, media_type=job.media_type, filename=job.filename)

    @app.delete("/api/v1/jobs/{job_id}", status_code=204)
    def job_delete(job_id: str):
        if not _JOB_ID.match(job_id):
            raise ApiError(404, "not_found", "Job not found.")
        store.delete(job_id)
        return Response(status_code=204)

    return app
