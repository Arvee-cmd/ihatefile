"""Security regressions: proxy-IP trust, exposed docs, response headers, CORS config."""
from __future__ import annotations

import pytest

from app.config import Settings
from app.main import client_ip
from conftest import _png_bytes, post

PEER = "10.0.0.9"


def _hdrs(*values: str) -> list[tuple[bytes, bytes]]:
    return [(b"x-forwarded-for", v.encode()) for v in values]


# ------------------------------------------------------------------ client_ip
def test_forwarded_header_is_ignored_unless_a_proxy_is_trusted():
    s = Settings()
    assert client_ip(_hdrs("1.2.3.4"), PEER, s) == PEER


def test_client_ip_uses_the_entry_the_trusted_proxy_appended_not_the_spoofable_left_side():
    s = Settings(trust_proxy_headers=True, trusted_proxy_hops=1)
    # the client sent "6.6.6.6"; the proxy appended the address it actually saw
    assert client_ip(_hdrs("6.6.6.6, 203.0.113.7"), PEER, s) == "203.0.113.7"
    assert client_ip(_hdrs("6.6.6.6", "203.0.113.7"), PEER, s) == "203.0.113.7"  # several header lines
    s2 = Settings(trust_proxy_headers=True, trusted_proxy_hops=2)
    assert client_ip(_hdrs("6.6.6.6, 203.0.113.7, 198.51.100.1"), PEER, s2) == "203.0.113.7"


def test_client_ip_falls_back_to_the_peer_on_missing_short_or_garbage_headers():
    s = Settings(trust_proxy_headers=True, trusted_proxy_hops=2)
    assert client_ip([], PEER, s) == PEER
    assert client_ip(_hdrs("203.0.113.7"), PEER, s) == PEER  # fewer entries than trusted hops
    assert client_ip(_hdrs("1.1.1.1, not-an-ip"), PEER, Settings(trust_proxy_headers=True)) == PEER
    assert client_ip(_hdrs("::1"), PEER, Settings(trust_proxy_headers=True)) == "::1"


def _burst(client, spoof_values, real="203.0.113.7"):
    codes = []
    for fake in spoof_values:
        r = client.post(
            "/api/v1/convert",
            files={"file": ("a.png", _png_bytes(), "image/png")},
            data={"tool": "image-server", "target": "bmp"},
            headers={"X-Forwarded-For": f"{fake}, {real}"},
        )
        codes.append(r.status_code)
    return codes


def test_rate_limit_cannot_be_dodged_by_spoofing_x_forwarded_for(make_client):
    c = make_client(trust_proxy_headers=True, rate_limit_per_minute=3)
    codes = _burst(c, [f"9.9.9.{i}" for i in range(6)])
    assert codes[:3] == [201, 201, 201]
    assert codes[3:] == [429, 429, 429]


def test_other_real_clients_are_not_affected_by_one_clients_limit(make_client):
    c = make_client(trust_proxy_headers=True, rate_limit_per_minute=2)
    assert _burst(c, ["1.1.1.1"] * 3, real="203.0.113.7")[2] == 429
    assert _burst(c, ["1.1.1.1"], real="203.0.113.8") == [201]


# ------------------------------------------------------------------ exposure
def test_api_docs_are_off_by_default_and_can_be_enabled(make_client):
    c = make_client()
    for path in ("/api/docs", "/api/openapi.json", "/api/redoc", "/docs", "/openapi.json"):
        assert c.get(path).status_code == 404, path
    assert make_client(enable_docs=True).get("/api/openapi.json").status_code == 200


def test_responses_carry_hardening_headers_and_downloads_are_attachments(client):
    r = post(client, "pic.png", _png_bytes(), "image-server", "bmp")
    d = client.get(r.json()["downloadUrl"])
    assert d.headers["x-content-type-options"] == "nosniff"
    assert d.headers["content-disposition"].startswith("attachment")
    assert "sandbox" in d.headers["content-security-policy"] and "default-src 'none'" in d.headers["content-security-policy"]
    assert d.headers["cache-control"] == "no-store"
    assert d.headers["x-frame-options"] == "DENY"
    assert client.get("/api/v1/health").headers["referrer-policy"] == "no-referrer"


def test_markdown_to_html_result_cannot_run_script_in_the_api_origin(client):
    pytest.importorskip("shutil")
    import shutil

    if not shutil.which("pandoc"):
        pytest.skip("Pandoc not installed")
    r = post(client, "x.md", b"# t\n\n<script>alert(1)</script>\n", "text-documents", "html")
    d = client.get(r.json()["downloadUrl"])
    assert d.headers["content-disposition"].startswith("attachment")
    assert "sandbox" in d.headers["content-security-policy"]


def test_wildcard_cors_is_refused(monkeypatch):
    monkeypatch.setenv("IHATEFILE_CORS_ORIGINS", "https://a.example,*")
    with pytest.raises(RuntimeError, match="exact origins"):
        Settings.from_env()


def test_cors_only_answers_for_listed_origins(make_client):
    c = make_client(cors_origins=("https://app.example",))
    ok = c.options("/api/v1/convert", headers={"Origin": "https://app.example", "Access-Control-Request-Method": "POST"})
    bad = c.options("/api/v1/convert", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "https://app.example"
    assert "access-control-allow-origin" not in bad.headers
