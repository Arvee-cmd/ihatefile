# Supported conversions

> Generated from `shared/registry.json` by `pnpm docs:formats`. Do not edit by hand.
> Every row below is exercised by an automated test (see the *Tests* column). Anything not listed is **not supported**.

| Tool | Category | Where it runs | Engine | From | To | Max size | Tests |
|---|---|---|---|---|---|---|---|
| Image converter | Images | Browser (private) | Browser Canvas API | PNG, JPEG, WebP, GIF, BMP | PNG<br>JPEG<br>WebP | 50 MB | `src/lib/convert/image.test.ts`, `e2e/convert.spec.ts` |
| Image to PDF | PDF | Browser (private) | pdf-lib | PNG, JPEG, WebP, GIF, BMP | PDF | 50 MB | `src/lib/convert/pdf.test.ts` |
| Merge PDFs *(combines all files)* | PDF | Browser (private) | pdf-lib | PDF | One merged PDF | 50 MB | `src/lib/convert/pdf.test.ts` |
| Extract PDF pages | PDF | Browser (private) | pdf-lib | PDF | PDF with selected pages | 50 MB | `src/lib/convert/pdf.test.ts` |
| Create ZIP *(combines all files)* | Archives | Browser (private) | fflate | any file | ZIP archive | 100 MB | `src/lib/convert/archive.test.ts` |
| JSON formatter & validator | Data | Browser (private) | Browser JSON parser | JSON | Pretty-printed JSON<br>Minified JSON<br>Validation report (TXT) | 20 MB | `src/lib/convert/data.test.ts` |
| CSV to JSON | Data | Browser (private) | Built-in CSV parser (RFC 4180) | CSV | JSON array of objects | 20 MB | `src/lib/convert/data.test.ts` |
| JSON to CSV | Data | Browser (private) | Built-in CSV writer | JSON | CSV | 20 MB | `src/lib/convert/data.test.ts` |
| XML to JSON | Data | Browser (private) | Browser DOMParser | XML | JSON | 20 MB | `src/lib/convert/data.test.ts` |
| Base64 & URL encoding | Developer | Browser (private) | Browser TextEncoder / atob | TXT, JSON, CSV, XML, Markdown, HTML | Base64 encode (TXT)<br>Base64 decode (TXT)<br>URL encode (TXT)<br>URL decode (TXT) | 10 MB | `src/lib/convert/data.test.ts` |
| Image converter (server) | Images | **Server** (upload) | Pillow | PNG, JPEG, WebP, GIF, BMP, TIFF, ICO | PNG<br>JPEG<br>WebP<br>GIF<br>BMP<br>TIFF<br>ICO | 20 MB | `backend/tests/test_matrix.py`, `backend/tests/test_edge_cases.py` |
| Office document to PDF | Documents | **Server** (upload) | LibreOffice (headless) | DOCX, ODT, RTF, XLSX, ODS, PPTX, ODP | PDF | 20 MB | `backend/tests/test_matrix.py`, `backend/tests/test_edge_cases.py` |
| Text document converter | Documents | **Server** (upload) | Pandoc | Markdown, HTML, DOCX, ODT | HTML (from Markdown, DOCX, ODT)<br>DOCX (from Markdown, HTML)<br>Markdown (from HTML, DOCX, ODT)<br>Plain text (from Markdown, HTML, DOCX, ODT) | 20 MB | `backend/tests/test_matrix.py`, `backend/tests/test_edge_cases.py` |
| PDF text & page images | PDF | **Server** (upload) | pdfplumber / pypdfium2 | PDF | Extracted text (TXT)<br>Page images (PNG in a ZIP) | 20 MB | `backend/tests/test_matrix.py`, `backend/tests/test_edge_cases.py` |
| Audio converter | Audio | **Server** (upload) | FFmpeg | MP3, WAV, FLAC, OGG, M4A (AAC) | MP3<br>WAV<br>FLAC<br>OGG (Vorbis)<br>M4A (AAC) | 20 MB | `backend/tests/test_matrix.py`, `backend/tests/test_edge_cases.py` |
| Video converter | Video | **Server** (upload) | FFmpeg | MP4, WebM, MKV, MOV | MP4 (H.264 + AAC) (from WebM, MKV, MOV)<br>WebM (VP9 + Opus) (from MP4, MKV, MOV)<br>Animated GIF (first 15 s)<br>Audio only (MP3) | 20 MB | `backend/tests/test_matrix.py`, `backend/tests/test_edge_cases.py` |
| ZIP / TAR.GZ re-packer | Archives | **Server** (upload) | Python zipfile / tarfile | ZIP, TAR.GZ | TAR.GZ (from ZIP)<br>ZIP (from TAR.GZ) | 20 MB | `backend/tests/test_matrix.py`, `backend/tests/test_edge_cases.py` |
| Rotate PDF pages | PDF | Browser (private) | pdf-lib | PDF | Rotated PDF | 50 MB | `src/lib/convert/pdf.test.ts` |
| Split PDF | PDF | Browser (private) | pdf-lib | PDF | PDFs in a ZIP | 50 MB | `src/lib/convert/pdf.test.ts` |
| Watermark PDF | PDF | Browser (private) | pdf-lib | PDF | Watermarked PDF | 50 MB | `src/lib/convert/pdf.test.ts` |
| Compress PDF | PDF | **Server** (upload) | pypdf / Pillow | PDF | Smaller PDF | 20 MB | `backend/tests/test_new_tools.py` |
| PDF to Word | PDF | **Server** (upload) | LibreOffice (PDF import) | PDF | Word document (DOCX) | 20 MB | `backend/tests/test_new_tools.py` |
| OCR (scans to searchable PDF or text) | PDF | **Server** (upload) | Tesseract (+ pypdfium2) | PDF, PNG, JPEG, TIFF, BMP, WebP | Searchable PDF<br>Recognised text (TXT) | 20 MB | `backend/tests/test_new_tools.py` |
| HTML to PDF | Documents | **Server** (upload) | LibreOffice (Writer/Web) | HTML | PDF | 5 MB | `backend/tests/test_new_tools.py` |

## Limitations per tool

### Image converter

- Same-format conversion re-encodes the image, which is how you compress, resize or rotate without changing format.
- JPEG removes transparency (filled with the chosen background). Animated GIFs are converted using their first frame.
- Metadata such as EXIF is not preserved.
- Browser support for decoding BMP/GIF/WebP is required; encoding WebP is not supported by every browser (the app tells you if yours cannot).

### Image to PDF

- Each image becomes its own single-page PDF sized to the image. JPEG data is embedded unchanged; other formats are embedded as PNG.
- Use PDF merge afterwards to combine the results.

### Merge PDFs

- Combines all queued PDFs, in queue order, into one PDF. Needs at least two files.
- Encrypted or corrupted PDFs are rejected with an error.

### Extract PDF pages

- Keeps only the pages you list, in the order listed (for example 3,1,2). Page numbers start at 1.

### Create ZIP

- Packs every queued file into one ZIP. Duplicate names are renamed (name (2).ext).

### JSON formatter & validator

- Numbers beyond JavaScript's safe integer range lose precision when re-serialised. Duplicate object keys keep the last value.

### CSV to JSON

- The first row is used as the header. All values are kept as strings (no type guessing). Rows with a different column count than the header are rejected.
- Duplicate or empty header names are rejected. Blank lines are skipped.

### JSON to CSV

- Supported shape: an array of flat objects whose values are strings, numbers, booleans or null. Nested objects or arrays are rejected with the location of the offending value rather than silently dropped.

### XML to JSON

- Attributes become "@name" keys, text next to elements becomes "#text", repeated sibling elements become arrays. All values are strings.
- Comments and processing instructions are dropped. DTDs are not processed.

### Base64 & URL encoding

- Text files only (UTF-8). Base64 decode rejects input that is not valid Base64 or does not decode to UTF-8 text.

### Image converter (server)

- Only used when the browser tool cannot handle the pair (TIFF/ICO/GIF/BMP output, TIFF/ICO input).
- GIF output is limited to 256 colours and uses the first frame. ICO output is limited to 256×256 (larger images are scaled down). Only the first frame/page of multi-page files is converted.

### Office document to PDF

- Layout fidelity depends on LibreOffice's rendering: fonts missing on the server are substituted, and complex Word features (some macros, SmartArt, tracked-change views) may render differently.
- Macros are never executed. Conversions are slow on first use (LibreOffice start-up).

### Text document converter

- Pandoc converts structure, not page layout: styling, headers/footers and complex tables can be simplified. Images embedded in DOCX/ODT are dropped from TXT/Markdown output.
- Pandoc runs in sandbox mode: it cannot read other files or fetch remote resources, so remote images in HTML are not embedded.

### PDF text & page images

- Text extraction only works for PDFs with a text layer; for scans use the OCR tool. Reading order can differ from the visual layout.
- Page rendering is limited to the first 50 pages. Encrypted PDFs are rejected.
- For an editable Word file use PDF to Word.

### Audio converter

- Converting from a lossy format (MP3, OGG, M4A) to a lossless one does not restore quality. Metadata/cover art are not guaranteed to be preserved.
- Conversion time is capped; very long files may be rejected.

### Video converter

- Video is re-encoded, so quality is reduced and conversion is CPU-intensive; each request has a strict time limit and may be rejected for long or high-resolution input.
- Only the first video and audio stream are kept; subtitles and extra tracks are dropped.

### ZIP / TAR.GZ re-packer

- Archives are inspected before extraction: entry count, total expanded size and path safety are checked, and unsafe archives (path traversal, absolute paths, links, bombs) are rejected.
- Symbolic/hard links and device files are rejected. File permissions and timestamps may not be preserved.

### Rotate PDF pages

- Rotates all pages or the pages you list, clockwise. Text and images are not re-encoded; only the page rotation flag changes.
- Encrypted or corrupted PDFs are rejected.

### Split PDF

- Splits one PDF into several: every page, every N pages, or custom ranges such as 1-3;4-6;7-. Results are delivered in a ZIP.
- At most 500 output files. Form fields, bookmarks and links that point to other pages are not preserved in the pieces.

### Watermark PDF

- Stamps text on every page. Text-only (no image watermarks); limited to the characters of the built-in Helvetica font (Latin letters, digits, common punctuation).
- The stamp is drawn on top of the page content and is not removable by the page viewer, but anyone with a PDF editor can delete it: it is not a security feature.

### Compress PDF

- Re-encodes the images inside the PDF as JPEG (at the chosen quality, down-scaling very large ones) and compresses page content. Text, fonts and vector graphics are unchanged.
- Savings come almost entirely from images: a text-only PDF usually shrinks very little, and if no smaller file can be made the tool says so instead of returning the original.
- Images with transparency are left as they are. Encrypted PDFs are rejected. Not a replacement for Ghostscript-style optimisation of every PDF feature.

### PDF to Word

- Text stays real, selectable and editable text, and the page look is kept, but LibreOffice places it in positioned text boxes line by line rather than rebuilding flowing paragraphs, so editing a whole paragraph takes manual effort.
- Tables become lines of positioned text, not Word tables. Complex layouts, unusual fonts and multi-column pages can shift.
- PDFs without a text layer (scans) are rejected with a pointer to OCR. Limited to 50 pages; encrypted PDFs are rejected.

### OCR (scans to searchable PDF or text)

- Recognises text in scanned PDFs and in images. The searchable PDF contains each page as a picture with an invisible text layer, so it can be searched and copied from; the original vector text and fonts of a PDF are not preserved.
- Accuracy depends on scan quality; handwriting, very small print and complex layouts are poor. Only languages installed on the server are offered (English by default).
- Limited to 20 pages per file (IHATEFILE_MAX_OCR_PAGES) because recognition is slow on small free servers.

### HTML to PDF

- The HTML is sanitised first: scripts, frames, forms, external stylesheets, remote and local images and CSS that loads anything are removed, so the converter never fetches a URL or reads a file. Only images embedded as data: URIs (PNG, JPEG, GIF) are kept.
- Rendering is by LibreOffice Writer, not a web browser: no JavaScript, and modern CSS (flexbox, grid, variables, web fonts) is ignored. Simple documents, articles and tables work best.
- This converts an uploaded HTML file, not a live web page address.

## Explicitly not supported

- PDF to flowing, fully editable Word paragraphs and Word tables (PDF to Word keeps the look but uses positioned text boxes); PDF to Excel/PowerPoint
- HTML to PDF with JavaScript or modern CSS; converting a live web address
- Handwriting recognition; OCR in languages not installed on the server
- Redacting, signing, unlocking, protecting or repairing PDFs
- Legacy .doc/.xls/.ppt, Apple iWork formats
- HEIC/HEIF, AVIF, RAW, SVG image conversion
- ZIP extraction to separate files; RAR and 7z
- Password-protected / encrypted files
- Any conversion not in the table above (there is no "every format to every format")
