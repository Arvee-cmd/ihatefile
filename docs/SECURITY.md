# Security and privacy design

## Pre-deployment review (2026-10-27): what was found and fixed
Scope: the whole shipped ZIP (files, secrets, dependencies, backend, frontend, Docker/CI/hosting config). Each fix has a regression
test; the Office fixes were also checked by removing the fix and confirming the test fails.

| # | Severity | Finding | Fix | Test |
|---|---|---|---|---|
| 1 | **High** | **SSRF / local file read via Office files.** A DOCX, PPTX or ODT with a *linked* image made LibreOffice send an HTTP request from the server (reproduced against a local listener) and a `file://` link embedded a local image file into the returned PDF. | `converters/sanitize.py` rewrites the document before LibreOffice sees it: drops every external/scheme-carrying relationship (OOXML) and every non-package `xlink:href` (ODF), refuses DTD/entity declarations. | `test_office_ssrf.py` |
| 2 | Medium | **Zip bombs reached LibreOffice** (Office files were only signature-checked). | The same step reads the archive with entry-count and *real* expanded-size limits, rejects traversal/encrypted entries. | `test_sanitise_enforces_zip_limits_*` |
| 3 | **Medium** | **Rate-limit and one-job-per-client bypass.** With `IHATEFILE_TRUST_PROXY_HEADERS=true` the *left-most* `X-Forwarded-For` entry (client-controlled) was used. | `client_ip()` reads the entry appended by your proxy (`IHATEFILE_TRUSTED_PROXY_HOPS` from the right), validates it as an IP, falls back to the socket peer. | `test_security.py` |
| 4 | Medium | **Dependencies:** `pnpm audit` reported 57 advisories (5 critical, 30 high), mostly dev tooling, none in the shipped bundle, but 17 packages were unused template leftovers. | Removed the unused packages and files, updated within semver ranges: `pnpm audit` and `pip-audit` now report **0**. Backend lower bounds raised to the tested versions. CI runs both audits. | CI `audit` job |
| 5 | Medium | No Content-Security-Policy or security headers on the static site. | Build emits a CSP `<meta>` (works on any host) and a `_headers` file (Cloudflare Pages/Netlify) with CSP incl. `frame-ancestors 'none'`, nosniff, no-referrer, COOP, Permissions-Policy. `VITE_API_BASE_URL` must be https (or localhost) and is the only extra `connect-src`. | e2e "strict CSP" test runs real conversions under the policy with zero violations |
| 6 | Low | Swagger UI and OpenAPI schema exposed by default. | Off unless `IHATEFILE_ENABLE_DOCS=true`. | `test_api_docs_are_off_by_default_*` |
| 7 | Low | API responses lacked `X-Frame-Options`/CSP; a converted HTML result opened in a tab would run in the API origin. | `CSP: default-src 'none'; sandbox`, `X-Frame-Options: DENY`, attachment disposition. | `test_responses_carry_hardening_headers_*` |
| 8 | Low | `IHATEFILE_CORS_ORIGINS=*` was accepted. | Startup refuses wildcards. | `test_wildcard_cors_is_refused` |
| 9 | Low | Docker/compose/CI: API published on all interfaces, no capability drop, no healthcheck, unpinned base tag, CI token with default permissions, a leftover scheduled "stale issues" workflow from the template. | Bound to 127.0.0.1, `cap_drop: ALL`, pids/memory limits, `HEALTHCHECK`, `--no-server-header`, `python:3.12-slim-bookworm`, `permissions: contents: read`, stale workflow removed. | not executed (no Docker here) |
| 10 | Info | Leftover test artefacts (`.vitest-attachments/`) and 18 unused UI/hook files in the ZIP. | Removed. No secrets, keys or `.env` files were found anywhere in the ZIP. | n/a |

**Residual risks you should know about**
* Child processes are **not** blocked from the network at OS level. The sanitisers above close the known ways documents can trigger a request
  (HTML, OOXML, ODF), but a future LibreOffice/Pandoc/FFmpeg bug could still reach out. Run the API where outbound traffic to private
  ranges and `169.254.169.254` is blocked (host firewall, platform egress rules, or a Docker network without that route).
* RTF and legacy formats are passed to LibreOffice unchanged (no external fetch was observed in testing, but they are not rewritten).
* Rate limiting is per process and per IP; there is no authentication, so a distributed attacker can still use up capacity.
* GitHub Pages cannot send HTTP headers: the CSP `<meta>` still applies, but `frame-ancestors`/`X-Frame-Options` do not.
* Not a penetration test: this was a code-and-config review plus targeted exploit reproduction, not an external assessment.

Scope: the backend in `backend/` and the browser engines in `src/lib/convert/`. Every item below is
implemented; the test that covers it is named in brackets. "Not covered" items are listed at the end.

## Threat model
Anonymous users upload arbitrary, possibly malicious files to a public API that runs powerful parsers
(Pillow, pdfplumber, LibreOffice, Pandoc, FFmpeg). Goals: no access to other users' data or the host,
no resource exhaustion, no data retention beyond what is needed.

## Upload handling
| Control | Where | Test |
|---|---|---|
| Size limit enforced **while streaming** (ASGI guard counts bytes; also checks `Content-Length`), plus per-tool limit | `main.py` `GuardMiddleware` | `test_upload_size_limit_*`, `test_per_tool_size_limit` |
| Extension must map to a registry format; **content signature** must match (ZIP-based formats inspected for their marker parts) | `registry.py`, `sniff.py` | `test_signature_mismatch_rejected`, `test_unknown_extension_rejected` |
| Pair + options validated against the registry (unknown/out-of-range options rejected) | `registry.py` | `test_unsupported_pair_rejected`, `test_invalid_options_rejected` |
| Client file name is never a path: stored as `input.<ext>` in `<tmp>/jobs/<random>/`; output name is sanitised | `main.py` | `test_filename_cannot_escape_or_inject` |
| 256-bit random job ids; format-checked; temp root created `0700` | `jobs.py` | `test_job_ids_are_unguessable_and_validated` |

## Execution isolation
Each conversion runs in a freshly spawned child process (`worker.py`): own process group, wall-clock timeout
with `killpg` (kills LibreOffice/FFmpeg children too), `RLIMIT_CPU`, `RLIMIT_FSIZE` (output size), `RLIMIT_NOFILE`,
no core dumps, `RLIMIT_AS` for in-process/Python and Pandoc work (not LibreOffice/FFmpeg, which map large virtual
ranges). External engines are called with **argument arrays** (never a shell), a minimal environment, `stdin` closed,
a private `HOME`/`TMPDIR`. FFmpeg uses `-protocol_whitelist file`. LibreOffice gets a throw-away profile per job and
never runs macros in headless convert mode. Pandoc uses `--sandbox` (no file reads / network); for DOCX output, where the sandbox
cannot be used, a Lua filter strips images and raw content and YAML metadata blocks are disabled in Markdown input.
[`test_timeout_kills_engine_and_cleans_up`, `test_pandoc_*`]

**Not enforced by the code:** network egress of child processes and filesystem visibility are not sandboxed at the OS level.
For stronger isolation run the container with no outbound network, a read-only root filesystem, no capabilities
(see `docker-compose.yml`) and, ideally, a seccomp/gVisor runtime.

## HTML to PDF, OCR and PDF tools added later
* **HTML to PDF** never gives LibreOffice the uploaded HTML. `sanitize_html` (`converters/document.py`) re-builds the document from
  an allow-list: scripts, frames, objects, forms, SVG, `<link>`, `<meta>`, `<base>`, event handlers, `javascript:`/`file:` links,
  remote and local images, and every CSS declaration containing `url()`, `@import`, `expression()` or similar are removed; only
  PNG/JPEG/GIF `data:` images survive. A local HTTP listener in the tests proves that a hostile page causes **zero** requests
  [`test_html_to_pdf_never_fetches_anything_or_runs_scripts`, `test_sanitiser_*`]. Network egress is still not blocked at OS level (see above).
* **OCR** runs `tesseract` with an argument array, one thread, a private `HOME`, a page cap (`IHATEFILE_MAX_OCR_PAGES`, default 20),
  a per-page pixel cap and the job's overall wall-clock deadline. The language is validated against the registry and against the
  packs actually installed.
* **Compress PDF / PDF to Word** reject encrypted and corrupt PDFs, cap page counts, and run under the memory limit (`RLIMIT_AS`) for
  compression. Images with transparency are never touched.
* Rotate, split and watermark PDF run entirely in the browser; nothing is uploaded.

## Archive and media bombs
Entry-count and expanded-size limits count **real decompressed bytes** (header sizes can lie —
`test_zip_with_forged_header_size_is_still_limited`); absolute/`..`/backslash/drive paths, symlinks, hard links, devices,
duplicates and encrypted entries are rejected; nothing is extracted under archive-supplied paths (entries are streamed
archive → archive). Images: 50 MP cap (`test_decompression_bomb_image_is_rejected`). PDFs: page limits. Media: duration and
resolution limits checked with `ffprobe` before encoding.

## Abuse controls
Per-IP rate limit (429 + `Retry-After`), one active conversion per client, global concurrency cap (503 when busy),
conversion timeout (504). Client IP comes from `X-Forwarded-For` only if `IHATEFILE_TRUST_PROXY_HEADERS=true`, and then from the entry
your proxy appended (`IHATEFILE_TRUSTED_PROXY_HOPS` from the right), never the client-written left side.

## Data lifecycle
Upload deleted immediately after conversion or failure; result kept in memory-mapped temp storage only until the
client downloads it and sends `DELETE` or the TTL (default 600 s) expires; a sweeper removes expired jobs and orphaned
directories; the temp root is wiped at start-up and shutdown. No database, no history. Logs contain tool id, formats,
sizes, duration — never file names or contents. [`test_results_expire_and_are_deleted`, `test_sweeper_*`,
`test_failed_conversion_leaves_nothing_behind`, `test_input_file_is_removed_after_success`]

## Web layer
Strict CORS allow-list (`IHATEFILE_CORS_ORIGINS`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
`Cache-Control: no-store`, `Content-Disposition: attachment`, `Content-Security-Policy: sandbox` and `X-Frame-Options: DENY` on API responses. Terminate HTTPS at your host/proxy.
No secrets exist in the frontend; API URL is public configuration.

## Frontend
Browser conversions never use the network (verified in `e2e/convert.spec.ts`: no `/api/v1/convert` request).
The upload consent dialog appears before the first server upload (verified). Output type is checked (a browser that
silently falls back from WebP to PNG produces an error, not a mislabeled file). Download object-URLs are revoked.
XML is parsed with `DOMParser` (no DTD/entity loading from the network). Fonts are self-hosted/system: no third-party requests.

## Not covered / known gaps
* No authentication; a determined attacker with many IPs can still consume capacity.
* In-memory rate limiter is per process.
* OS-level sandboxing (seccomp, network namespaces) is left to the deployment.
* Dependency scans were clean on 2026-10-27; new advisories appear constantly. CI runs `pnpm audit` and `pip-audit`: re-run before every deployment.
* A malicious DOCX/ODT/PDF could exploit a vulnerability in LibreOffice/Pandoc/FFmpeg: keep these updated.
