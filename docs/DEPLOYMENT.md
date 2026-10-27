# Deployment

ihatefile is two independently deployable pieces:

| Piece | What it is | Needs |
|---|---|---|
| **Frontend** | static files in `dist/` (`pnpm build`) | any static host |
| **Backend** (optional) | FastAPI app in `backend/` | Python 3.11+, and for the server tools the engines `ffmpeg`, `pandoc`, `libreoffice`, `tesseract` (for OCR) |

**Without the backend the site still works** for every browser-side conversion (images, PDF merge/extract/image→PDF, ZIP creation, JSON/CSV/XML, Base64/URL). Server-only conversions are shown as unavailable with an explanation. Deploy the frontend first; add the backend only if you can host it.

> Free-tier terms change. The facts below were checked against the providers' documentation on 2026-10-21; re-check before relying on them.

## 1. Frontend (static, free)

```bash
pnpm install --frozen-lockfile
VITE_API_BASE_URL=https://your-api.example.com pnpm build     # omit VITE_API_BASE_URL for browser-only mode
```

Environment variables are baked in at build time and are public (never put secrets in `VITE_*`).

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Origin of the backend, no trailing slash. Empty = same origin (`/api/...`) |
| `VITE_BASE` | Sub-path the site is served from, e.g. `/ihatefile/` (GitHub Pages project sites). Default `/` |
| `VITE_SUPPORT_URL` | Optional link for the footer's "Support & feedback" |

The build also writes a Content-Security-Policy `<meta>` into `index.html` and a `dist/_headers` file with the other security headers (used by Cloudflare Pages and Netlify; GitHub Pages ignores `_headers`). `VITE_API_BASE_URL` must be `https://…` (plain http only for localhost) and becomes the only extra `connect-src` origin.

Single-page-app routing needs a fallback so that deep links (`/convert`, `/formats`) work:

* **Cloudflare Pages / Netlify** – Netlify uses the included `netlify.toml` rewrite. Cloudflare Pages serves `index.html` for unknown paths when the project has no `404.html`. Build command `pnpm build`, output directory `dist`.
* **GitHub Pages** – run the included workflow `.github/workflows/pages.yml` (manual trigger). It copies `index.html` to `404.html`, which is GitHub's fallback mechanism. Set repository variables `VITE_BASE` (e.g. `/repo-name/`) and optionally `VITE_API_BASE_URL`.

Verified here: a production build with `VITE_BASE=/sub/` loads correctly from a sub-path in a real browser. The GitHub/Cloudflare/Netlify deployments themselves were **not** executed from this environment.

## 2. Backend

### Run it yourself (always works)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
sudo apt install ffmpeg pandoc tesseract-ocr libreoffice-writer libreoffice-calc libreoffice-impress   # optional engines (add tesseract-ocr-deu, -fra, ... for more OCR languages)
cd backend && uvicorn asgi:app --host 127.0.0.1 --port 8000
```

or with Docker: `docker compose up --build` (see `docker-compose.yml`; read-only root filesystem, tmpfs for `/tmp`). The Docker files were written but **not built or run** in the authoring environment (no Docker daemon).

Check `GET /api/v1/formats`: it reports which tools/targets this server can really do. Missing engines never break the app, they only disable those tools.

Production checklist:

* Serve over **HTTPS** (a reverse proxy or the host's TLS).
* Set `IHATEFILE_CORS_ORIGINS` to your exact frontend origin(s).
* Behind a trusted proxy that sets `X-Forwarded-For`, set `IHATEFILE_TRUST_PROXY_HEADERS=true` and `IHATEFILE_TRUSTED_PROXY_HOPS` to the number of proxies in front of the app (usually 1). Never enable it when the app is directly reachable, and never copy the left-most address: the client controls it.
* Block outbound traffic from the API host to private ranges and the cloud metadata address `169.254.169.254` (defence in depth; see `docs/SECURITY.md`).
* `/api/docs` is disabled; set `IHATEFILE_ENABLE_DOCS=true` only on a private instance.
* Before each deployment run `pnpm audit` and `pip-audit -r backend/requirements.txt` (CI does this).
* Run **one worker process** (rate limiting and job storage are in memory and per process).
* Keep `IHATEFILE_TMP_ROOT` on local disk outside any web root; it is wiped at start-up and swept continuously.
* Tune limits (`backend/.env.example`) to the host's CPU/RAM; video conversion is CPU-heavy.

### Free hosting options (honest assessment)

| Option | Fit | Notes |
|---|---|---|
| **Your own machine / home server / VPS you already pay for** | Best | Full engines, no cold starts. Expose via a tunnel or reverse proxy with HTTPS. |
| **Render free web service** (Docker, `render.yaml` included) | Possible, with caveats | Per Render's docs: spins down after 15 min without traffic (≈1 min to wake), filesystem is ephemeral, 750 free instance hours/month, may restart at any time. The docs page does not state the RAM/CPU of the free instance; LibreOffice and FFmpeg are memory-hungry, so test with your files and drop the LibreOffice lines in `backend/Dockerfile` if it does not fit. Not executed from here. |
| **Hugging Face Spaces** | Not free for this | Free CPU Spaces have 2 vCPU/16 GB, but per HF's docs *Docker* Spaces require a paid plan (PRO or Team/Enterprise); only Gradio/static SDKs are free. |
| **Serverless functions** (Cloudflare Workers, Vercel, Netlify functions) | No | They cannot run LibreOffice/FFmpeg/Pandoc binaries and have short time limits. |
| **Static host only** | Yes | Browser-only mode; deploy just the frontend. |

If the API is on a sleeping free tier, the first request after idle is slow and the UI will show "Server offline" until it wakes; browser tools are unaffected.

## 3. Same-origin alternative

Serve `dist/` and the API behind one reverse proxy (`/` → static files, `/api/` → uvicorn). Then leave `VITE_API_BASE_URL` empty and CORS is not needed.
