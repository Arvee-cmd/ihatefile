# Test report

Last full run: 2026-10-22, Linux container, Node 22.22, pnpm 10.28, Python 3.13, Chromium (Playwright 1.59),
FFmpeg, Pandoc 3.1.3, LibreOffice 24.2, Tesseract 5 (English pack only) installed. All commands were actually executed; results below are from that run.

| Command | Result |
|---|---|
| `pnpm lint` | passed (0 errors, 0 warnings) |
| `pnpm build` (`tsc -b && vite build`) | passed |
| `pnpm audit` / `pip-audit -r backend/requirements.txt` | 0 known vulnerabilities (2026-10-27) |
| `pnpm test` (Vitest, real headless Chromium) | **89 tests in 8 files passed** |
| `pnpm test:e2e` (Playwright: production build + real FastAPI backend + real LibreOffice) | **32 tests passed** (includes every task page: Merge PDF reorder+download, Image to PDF, Word to PDF, Rotate, Split, Watermark, Compress PDF, PDF to Word, scanned-PDF rejection, OCR to text and to searchable PDF, HTML to PDF) |
| `pnpm test:backend` (pytest) | **215 tests passed** (`test_security.py` and `test_office_ssrf.py` are the pre-deployment security regressions) |

## What the tests cover

* **Registry integrity** – shared registry vs frontend resolution, backend handlers, doc sync, referenced test files exist.
* **Every server conversion pair** (`backend/tests/test_matrix.py`) – each (tool, input, target) the registry advertises is run with a real sample through the real engine and the output bytes are validated (opened with Pillow/pypdf/ffprobe/zipfile/tarfile; document text must survive).
* **Browser engines** – image (formats, resize, rotate, grayscale, background, WebP encode check), PDF (image→PDF, merge, page ranges, encrypted/corrupt), ZIP, JSON/CSV/XML/Base64/URL including malformed input.
* **New PDF/OCR tools** (`backend/tests/test_new_tools.py`, `src/lib/convert/pdf.test.ts`) – Compress PDF shrinks an image-heavy PDF, levels are ordered, reports when nothing can be saved; PDF to Word keeps the text, rejects scans/encrypted/corrupt; OCR reads text from every advertised input format into TXT and searchable PDF (text extracted back with pdfplumber); HTML to PDF with a local listener proving no network request is made; sanitiser unit tests; rotate/split/watermark including pages that carry a rotation flag (placement maths verified for 0/90/180/270 and checked by rendering the output).
* **Security / failure cases** – oversize uploads (declared and streamed), signature mismatch, unsupported pairs, invalid options, rate limit, one-job-per-client, server busy, CORS, zip/tar path traversal, links, bombs (including forged header sizes), image decompression bomb, encrypted/corrupt PDFs, Pandoc local-file/SSRF attempts, FFmpeg timeout kills the engine, cleanup on success/failure/expiry, unguessable job ids.
* **End to end** – upload → consent dialog → real server conversion → download; declining keeps files local; no network call for browser conversions; backend offline; invalid files; category/popular links; keyboard (skip link, browse button); no horizontal overflow at 320, 390 and 768 px.

## Not tested / not verified

* OCR was only tested in English: other language packs were not installed here. OCR accuracy on real-world scans, handwriting and non-Latin scripts was not measured.
* PDF to Word was checked on text PDFs (text and page count survive; the file converts back to a matching PDF). Tables, multi-column layouts and unusual fonts were not evaluated, and the DOCX was not opened in Microsoft Word.
* Compress PDF savings were measured only on synthetic image-heavy PDFs, not on a corpus of real documents.
* HTML to PDF rendering fidelity (LibreOffice, not a browser) was only checked on simple pages.

* Docker image build, `docker-compose`, Render blueprint and the GitHub Actions workflows were written but **never executed** here.
* Only Chromium was tested (no Firefox/Safari). WebP *encoding* is browser-dependent; the app reports it clearly when unsupported.
* Large-file behaviour near the 20 MB limits and real-world load/concurrency were not load-tested.
* Screen-reader testing was not performed; keyboard and structure basics were checked.
* Layout fidelity of LibreOffice/Pandoc output was checked for text presence, not visual equivalence.
* In this environment the shipped Chromium build differed from Playwright's pinned version, so tests were run with `IHATEFILE_CHROMIUM_PATH` pointing at it (see README). A normal `pnpm test:browser:install` setup does not need this.
