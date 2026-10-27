# ihatefile — Files in. Formats out.

A free, privacy-focused file converter. No accounts, no subscriptions, no paid APIs.
**Browser-side processing is the default**; a small FastAPI backend handles the conversions that
need native engines (LibreOffice, Pandoc, FFmpeg, Pillow, pdfplumber) and always asks before uploading.

Built on the MIT-licensed [shadcn-admin](https://github.com/satnaing/shadcn-admin) starter by Sat Naing
(see [LICENSE](LICENSE)): React 19, Vite 8, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Router.

```
ihatefile/
├── shared/registry.json   ← single source of truth: formats, tools, targets, options, limits
├── src/                   ← frontend (React)
│   ├── lib/registry.ts        typed registry access, choice resolution, search entries
│   ├── lib/convert/           browser engines (image, pdf, zip, json/csv/xml, base64/url)
│   ├── lib/files/             signature detection, safe file names
│   ├── lib/api.ts             API client (upload progress, abort, availability)
│   └── features/              converter workspace, home, category/format/legal pages
├── backend/               ← FastAPI service (+ pytest suite, Dockerfile)
├── e2e/                   ← Playwright tests (real browser + real backend)
├── docs/                  ← FORMATS.md (generated), DEPLOYMENT.md, SECURITY.md
└── .github/workflows/     ← CI and GitHub Pages deploy
```

## How the site is organised

The home page is a grid of **task tiles** (Merge PDF, Word to PDF, JPG to PDF, PNG to JPG, Compress image, Video to GIF, CSV to JSON, ...). Each opens its own page at `/tool/<slug>` with a large file picker, only accepts the right file types, and has a fixed output. Merge PDF and Create ZIP let you reorder files before combining. `/convert` is the general converter for any supported pair. Tasks are defined in `shared/registry.json` (`tasks`).

PDF tools include merge, split, extract pages, rotate, watermark (all in your browser), compress, PDF to Word and OCR (on the server), plus HTML to PDF. Tools whose engine is missing on the server show as unavailable with the reason.

## What works (all tested)

See **[docs/FORMATS.md](docs/FORMATS.md)** for the complete, generated matrix with per-tool limitations.

| Where | Conversions |
|---|---|
| **Browser** (file never leaves the device) | PNG/JPEG/WebP/GIF/BMP → PNG/JPEG/WebP (quality, background colour, resize, rotate, grayscale); image → PDF; merge, split, extract pages, rotate and watermark PDFs; create ZIP; JSON pretty/minify/validate; CSV ↔ JSON; XML → JSON; Base64 and URL encode/decode |
| **Server** (uploaded, then deleted) | Images ↔ TIFF/ICO/GIF/BMP (Pillow); DOCX/ODT/RTF/XLSX/ODS/PPTX/ODP → PDF (LibreOffice); Markdown/HTML/DOCX/ODT ↔ HTML/DOCX/Markdown/TXT (Pandoc); PDF → TXT, PDF → PNG pages (ZIP); compress PDF (pypdf/Pillow); PDF → Word (LibreOffice); OCR of scans to searchable PDF or text (Tesseract); HTML → PDF (sanitised, LibreOffice); MP3/WAV/FLAC/OGG/M4A audio; MP4/WebM/MKV/MOV → MP4/WebM/GIF/MP3 (FFmpeg); ZIP ⇄ TAR.GZ |

**Not supported** (the UI never offers them): flowing/editable PDF → Word reconstruction (PDF → Word keeps the look but uses positioned text boxes), HTML → PDF with JavaScript or modern CSS, handwriting OCR, PDF redact/sign/unlock/protect, legacy `.doc/.xls/.ppt`,
HEIC/AVIF/RAW/SVG, ZIP extraction to separate files, RAR/7z, encrypted files. There is no "every format to every format".

Other behaviour: drag & drop, multi-file queue with per-file target and options, batch "convert all",
"Download all as ZIP", real upload progress (processing is shown as indeterminate, never a fake percentage),
cancel for server jobs, explicit upload consent dialog, server-offline mode (browser tools keep working,
server targets are disabled with the reason), light/dark theme, responsive 320 px → desktop.

## Quick start

Requirements: Node 22+, pnpm 10, Python 3.11+ (3.13 tested). Optional engines for server tools:
`ffmpeg`, `pandoc`, `libreoffice`, `tesseract` for OCR (Debian/Ubuntu: `sudo apt install ffmpeg pandoc tesseract-ocr libreoffice-writer libreoffice-calc libreoffice-impress`; on Windows install LibreOffice and [Tesseract](https://github.com/UB-Mannheim/tesseract/wiki), and make sure `ffmpeg`/`pandoc` are on PATH).
Missing engines never break the app: those tools report themselves unavailable.

```bash
# 1. frontend
pnpm install
pnpm dev                       # http://localhost:5173  (proxies /api → http://127.0.0.1:8000)

# 2. backend (second terminal)
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && uvicorn asgi:app --reload --port 8000
```

Without step 2 the site still works for every browser-side conversion. Copy `.env.example` /
`backend/.env.example` for configuration (API URL, base path, limits, CORS).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm preview` | dev server / typecheck + production build (`dist/`) / serve the build |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest in real headless Chromium (registry, validation, every browser engine) |
| `pnpm test:e2e` | Playwright: builds the app, starts the real API, drives a real browser |
| `pip install -r backend/requirements-dev.txt && pnpm test:backend` | pytest: API, security, every advertised server pair against real engines |
| `pnpm docs:formats` | regenerate `docs/FORMATS.md` from the registry |

Testing notes: `pnpm exec playwright install chromium` downloads the browser. If you already have a
Chromium, set `IHATEFILE_CHROMIUM_PATH=/path/to/chrome` (used by both Vitest and Playwright). Set
`IHATEFILE_PYTHON` to the Python that has the backend requirements for `pnpm test:e2e`.

## Architecture in one paragraph

`shared/registry.json` lists every tool, its input formats, targets, options, size limit, engine, whether it
runs in the `browser` or on the `server`, and which tests cover it. The frontend (`src/lib/registry.ts`)
derives the format picker, search, category pages and the formats table from it; the backend loads the same file
to validate every request and to decide which handler runs, so the two cannot drift. When a browser tool and a
server tool can both produce a target, the browser tool wins. `GET /api/v1/formats` reports which server tools
and targets this particular server can really do (it probes for LibreOffice, Pandoc and FFmpeg encoders at start-up).

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | liveness |
| `GET /api/v1/formats` | per-tool availability, reasons, effective size limits |
| `POST /api/v1/convert` | multipart: `file`, `tool`, `target`, `options` (JSON) → `201 {jobId, filename, size, downloadUrl, expiresAt}` |
| `GET /api/v1/jobs/{id}` · `GET …/download` · `DELETE /api/v1/jobs/{id}` | status / result / delete now (`410` once expired) |

Conversion is synchronous (one request), which fits free-host limits and avoids a queue. Interactive docs: `/api/docs`.
The web client downloads the result immediately and then calls `DELETE`, so the server copy is gone within seconds.

## Security and privacy (summary — details in [docs/SECURITY.md](docs/SECURITY.md))

Uploads are untrusted: size limits enforced while streaming, extension + content-signature + parser validation,
random 256-bit job ids, private temp dirs, filenames never used as paths, argument-array subprocesses with a
minimal environment, each conversion in a killable child process with timeout/CPU/memory/output limits,
archive-bomb and path-traversal protection, per-IP rate limit and one concurrent job per client, strict CORS,
automatic expiry and cleanup, no file content or file names in logs; Office/HTML inputs are sanitised so they cannot make the server fetch URLs or read files; a CSP and security headers ship with the build; dependency audits are clean (re-run before deploying). These are properties of the code; they are
not a promise about any specific hosting provider.

## Deploying for free

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. Short version: the frontend is a static site (Cloudflare Pages,
GitHub Pages, Netlify). Free hosting for the *backend* is the hard part — LibreOffice/FFmpeg need a container with
enough RAM, and free tiers sleep or change. The docs explain the options honestly, including running the API on your
own machine or leaving it out entirely (static, browser-only mode).

## Status and known limitations

* Everything in `docs/FORMATS.md` is covered by automated tests; results of the last full run are in
  [docs/TEST-REPORT.md](docs/TEST-REPORT.md).
* The **Dockerfile, `render.yaml`, `docker-compose.yml` and GitHub workflows were written but not executed** in the
  authoring environment (no Docker daemon, no GitHub). The backend itself was tested directly with real engines.
* Conversions are not bit-identical to the originals: see each tool's limitations (lossy codecs, layout differences for
  LibreOffice/Pandoc, first frame only for animated GIFs, no metadata preservation for images).
* Privacy and Terms pages are plain-language templates; review them before running a public instance.
* Rate limiting is in-memory and per process; run a single worker (or add a shared limiter) behind a proxy.
* Fonts are system fonts (no third-party font requests). No analytics are included.

## License

MIT. Original shadcn-admin © 2024 Sat Naing; ihatefile modifications © 2026 ihatefile contributors. See [LICENSE](LICENSE).
Third-party licences of runtime dependencies (React, pdf-lib MIT, fflate MIT, FastAPI MIT, Pillow HPND, pypdf BSD,
pdfplumber MIT, pypdfium2 Apache-2.0/BSD) are permissive; the external engines are invoked as separate programs:
LibreOffice (MPL-2.0), Pandoc (GPL-2.0-or-later), FFmpeg (LGPL/GPL depending on build — `libx264` builds are GPL).
Check these obligations if you redistribute a container image that bundles them.
