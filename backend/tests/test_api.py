import io
import json
import os
import time

import pytest

from conftest import _png_bytes, post


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"


def test_formats_lists_server_tools_with_capabilities(client):
    data = client.get("/api/v1/formats").json()
    ids = {t["id"] for t in data["tools"]}
    assert {"image-server", "office-to-pdf", "audio-convert", "archive-repack"} <= ids
    assert "image-raster" not in ids  # browser-only tools are not served here
    assert data["limits"]["maxUploadMB"] == 20
    for t in data["tools"]:
        assert isinstance(t["enabled"], bool)


def test_registry_is_single_source_of_truth(client):
    """Every server tool in the shared registry has a handler implemented by the backend."""
    from app.converters import HANDLERS

    for t in client.app.state.registry.server_tools():
        assert t["handler"] in HANDLERS, t["id"]


def test_convert_png_to_tiff_and_download_then_delete(client):
    r = post(client, "photo.png", _png_bytes(), "image-server", "tiff")
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["filename"] == "photo.tiff" and job["size"] > 0 and job["status"] == "completed"
    d = client.get(job["downloadUrl"])
    assert d.status_code == 200
    assert d.content[:4] in (b"II*\x00", b"MM\x00*")
    assert "attachment" in d.headers["content-disposition"] and "photo.tiff" in d.headers["content-disposition"]
    assert client.get(f"/api/v1/jobs/{job['jobId']}").json()["status"] == "completed"
    deleted = client.delete(f"/api/v1/jobs/{job['jobId']}")
    assert deleted.status_code == 204 and deleted.content == b""  # a 204 must not carry a body
    assert client.get(job["downloadUrl"]).status_code == 404
    assert not (client.app.state.store.root / job["jobId"]).exists()


def test_input_file_is_removed_after_success(client):
    r = post(client, "photo.png", _png_bytes(), "image-server", "bmp").json()
    files = {p.name for p in (client.app.state.store.root / r["jobId"]).rglob("*") if p.is_file()}
    assert not any(n.startswith("input.") for n in files)
    assert "result.bmp" in files


def test_failed_conversion_leaves_nothing_behind(client):
    corrupt = b"\x89PNG\r\n\x1a\n" + b"not really a png"
    r = post(client, "bad.png", corrupt, "image-server", "jpeg")
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_file"
    assert list(client.app.state.store.root.iterdir()) == []


def test_signature_mismatch_rejected(client):
    r = post(client, "fake.png", b"%PDF-1.4 definitely not a png", "image-server", "jpeg")
    assert r.status_code == 415 and r.json()["error"]["code"] == "signature_mismatch"


def test_unknown_extension_rejected(client):
    r = post(client, "thing.exe", b"MZ...", "image-server", "jpeg")
    assert r.status_code == 415


def test_unsupported_pair_rejected(client):
    # PDF is not an input of the image tool; TIFF is not a target of the audio tool.
    assert post(client, "a.png", _png_bytes(), "audio-convert", "mp3").status_code == 415
    assert post(client, "a.png", _png_bytes(), "image-server", "nonexistent").status_code == 400
    assert post(client, "a.png", _png_bytes(), "no-such-tool", "png").status_code == 400
    assert post(client, "a.png", _png_bytes(), "image-raster", "jpeg").status_code == 400  # browser-only tool


def test_same_format_rejected_for_server_tool(client):
    r = post(client, "a.png", _png_bytes(), "image-server", "png")
    assert r.status_code == 400 and r.json()["error"]["code"] == "same_format"


def test_invalid_options_rejected(client):
    assert post(client, "a.png", _png_bytes(), "image-server", "jpeg", {"quality": 500}).status_code == 400
    assert post(client, "a.png", _png_bytes(), "image-server", "jpeg", {"evil": 1}).status_code == 400
    assert post(client, "a.png", _png_bytes(), "image-server", "jpeg", {"background": "red"}).status_code == 400
    r = client.post("/api/v1/convert", files={"file": ("a.png", _png_bytes())}, data={"tool": "image-server", "target": "jpeg", "options": "[1]"})
    assert r.status_code == 400


def test_empty_file_rejected(client):
    assert post(client, "a.png", b"", "image-server", "jpeg").status_code == 400


def test_upload_size_limit_enforced_via_content_length(make_client):
    c = make_client(max_upload_mb=1)
    r = post(c, "big.png", b"\x89PNG\r\n\x1a\n" + b"0" * (2 * 1024 * 1024), "image-server", "jpeg")
    assert r.status_code == 413 and r.json()["error"]["code"] == "file_too_large"
    assert list(c.app.state.store.root.iterdir()) == []


def test_upload_size_limit_enforced_without_content_length(make_client):
    c = make_client(max_upload_mb=1)

    def body():
        yield b"--b\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.png\"\r\n\r\n"
        for _ in range(40):
            yield b"0" * 65536
        yield b"\r\n--b--\r\n"

    r = c.post("/api/v1/convert", content=body(), headers={"Content-Type": "multipart/form-data; boundary=b"})
    assert r.status_code == 413


def test_per_tool_size_limit(make_client, monkeypatch):
    c = make_client()
    for t in c.app.state.registry.tools:
        if t["id"] == "image-server":
            t["maxFileMB"] = 0  # force any non-empty file over the per-tool limit
    r = post(c, "a.png", _png_bytes(), "image-server", "jpeg")
    assert r.status_code == 413


def test_filename_cannot_escape_or_inject(client):
    r = post(client, "../../../etc/pass wd<script>.png", _png_bytes(), "image-server", "jpeg")
    assert r.status_code == 201
    name = r.json()["filename"]
    assert "/" not in name and "<" not in name and name.endswith(".jpg")
    job_dir = client.app.state.store.root / r.json()["jobId"]
    assert job_dir.is_dir()
    assert all(job_dir in p.parents for p in job_dir.rglob("*"))


def test_job_ids_are_unguessable_and_validated(client):
    assert client.get("/api/v1/jobs/123").status_code == 404
    assert client.get("/api/v1/jobs/" + "A" * 43).status_code == 404
    assert client.get("/api/v1/jobs/..%2f..%2fetc%2fpasswd/download").status_code == 404
    a = post(client, "a.png", _png_bytes(), "image-server", "bmp").json()["jobId"]
    b = post(client, "a.png", _png_bytes(), "image-server", "bmp").json()["jobId"]
    assert a != b and len(a) == 43


def test_results_expire_and_are_deleted(make_client):
    c = make_client(job_ttl_seconds=1)
    job = post(c, "a.png", _png_bytes(), "image-server", "bmp").json()
    d = c.app.state.store.root / job["jobId"]
    assert d.exists()
    time.sleep(1.3)
    r = c.get(job["downloadUrl"])
    assert r.status_code == 410 and r.json()["error"]["code"] == "expired"
    assert not d.exists()


def test_sweeper_removes_expired_and_orphaned(make_client):
    c = make_client(job_ttl_seconds=1)
    job = post(c, "a.png", _png_bytes(), "image-server", "bmp").json()
    orphan = c.app.state.store.root / "orphan"
    orphan.mkdir()
    os.utime(orphan, (0, 0))
    time.sleep(1.2)
    assert c.app.state.store.sweep() >= 1
    assert not (c.app.state.store.root / job["jobId"]).exists()
    assert not orphan.exists()


def test_rate_limit(make_client):
    c = make_client(rate_limit_per_minute=3)
    codes = [post(c, "a.png", _png_bytes(), "image-server", "bmp").status_code for _ in range(5)]
    assert codes[:3] == [201, 201, 201] and codes[3:] == [429, 429]
    r = post(c, "a.png", _png_bytes(), "image-server", "bmp")
    assert "retry-after" in r.headers


def test_one_conversion_at_a_time_per_client(client):
    client.app.state.limiter.acquire("testclient")
    r = post(client, "a.png", _png_bytes(), "image-server", "bmp")
    assert r.status_code == 429 and r.json()["error"]["code"] == "busy"
    client.app.state.limiter.release("testclient")
    assert post(client, "a.png", _png_bytes(), "image-server", "bmp").status_code == 201


def test_server_busy_when_all_slots_used(make_client):
    c = make_client(max_concurrent_jobs=1)
    assert c.app.state.slots.acquire(blocking=False)
    r = post(c, "a.png", _png_bytes(), "image-server", "bmp")
    assert r.status_code == 503 and r.json()["error"]["code"] == "server_busy"
    c.app.state.slots.release()
    assert post(c, "a.png", _png_bytes(), "image-server", "bmp").status_code == 201


def test_cors_allows_only_configured_origins(make_client):
    c = make_client(cors_origins=("https://ihatefile.example",))
    ok = c.get("/api/v1/health", headers={"Origin": "https://ihatefile.example"})
    bad = c.get("/api/v1/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "https://ihatefile.example"
    assert "access-control-allow-origin" not in bad.headers


def test_tool_disabled_when_engine_missing(make_client):
    c = make_client()
    c.app.state.capabilities["office-to-pdf"] = {"enabled": False, "reason": "LibreOffice is not installed on this server.", "disabledTargets": {}}
    r = post(c, "a.docx", b"PK\x03\x04", "office-to-pdf", "pdf")
    assert r.status_code == 503 and r.json()["error"]["code"] == "tool_unavailable"
    listed = {t["id"]: t for t in c.get("/api/v1/formats").json()["tools"]}
    assert listed["office-to-pdf"]["enabled"] is False
