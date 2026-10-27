import { zipSync } from 'fflate'
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import { safeFilename, stemOf } from '@/lib/files/names'
import { convertImage } from './image'
import { ConversionError } from './types'

async function loadPdf(file: Blob, name: string): Promise<PDFDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: false })
    doc.getPageCount() // pdf-lib parses leniently; this throws when the page tree is missing
    return doc
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/encrypt/i.test(msg)) {
      throw new ConversionError(
        `"${name}" is password-protected. Remove the password first.`
      )
    }
    throw new ConversionError(`"${name}" is corrupted or is not a valid PDF.`)
  }
}

/** One image -> one single-page PDF sized to the image. JPEGs are embedded as-is. */
export async function imageToPdf(file: Blob, format: string): Promise<Blob> {
  const doc = await PDFDocument.create()
  let width: number
  let height: number
  try {
    if (format === 'jpeg') {
      const img = await doc.embedJpg(new Uint8Array(await file.arrayBuffer()))
      ;({ width, height } = img.scale(1))
      doc.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height })
    } else {
      // PNG is embedded directly; every other format is re-encoded to PNG first (lossless).
      const png = format === 'png' ? file : await convertImage(file, 'png')
      const img = await doc.embedPng(new Uint8Array(await png.arrayBuffer()))
      ;({ width, height } = img.scale(1))
      doc.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height })
    }
  } catch (e) {
    if (e instanceof ConversionError) throw e
    throw new ConversionError(
      'This image could not be embedded in a PDF. It may be corrupted or use an unsupported variant.'
    )
  }
  return new Blob(
    [await doc.save().then((b) => b.slice().buffer as ArrayBuffer)],
    { type: 'application/pdf' }
  )
}

export async function mergePdfs(files: File[]): Promise<Blob> {
  if (files.length < 2)
    throw new ConversionError('Add at least two PDFs to merge.')
  const out = await PDFDocument.create()
  for (const f of files) {
    const src = await loadPdf(f, f.name)
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((p) => out.addPage(p))
  }
  return new Blob([(await out.save()).slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  })
}

/**
 * Parses "1-3,5,8-" into zero-based page indices (order and repeats preserved).
 * Throws ConversionError for malformed input or pages outside 1..pageCount.
 */
export function parsePageSpec(spec: string, pageCount: number): number[] {
  const cleaned = spec.replace(/\s+/g, '')
  if (!cleaned)
    throw new ConversionError('Enter the pages to keep, for example 1-3,5.')
  const result: number[] = []
  for (const part of cleaned.split(',')) {
    const m = /^(\d+)?(-)?(\d+)?$/.exec(part)
    if (!part || !m || (!m[1] && !m[3]))
      throw new ConversionError(`"${part}" is not a valid page or range.`)
    let start: number
    let end: number
    if (!m[2]) {
      start = end = Number(m[1])
    } else {
      start = m[1] ? Number(m[1]) : 1
      end = m[3] ? Number(m[3]) : pageCount
    }
    if (start < 1 || end < 1)
      throw new ConversionError('Page numbers start at 1.')
    if (start > pageCount || end > pageCount) {
      throw new ConversionError(
        `This PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}; "${part}" is out of range.`
      )
    }
    if (start > end)
      throw new ConversionError(`"${part}" is a backwards range.`)
    for (let p = start; p <= end; p++) result.push(p - 1)
    if (result.length > 10_000)
      throw new ConversionError('Too many pages selected.')
  }
  return result
}

export async function extractPages(file: File, spec: string): Promise<Blob> {
  const src = await loadPdf(file, file.name)
  const indices = parsePageSpec(spec, src.getPageCount())
  const out = await PDFDocument.create()
  const pages = await out.copyPages(src, indices)
  pages.forEach((p) => out.addPage(p))
  return new Blob([(await out.save()).slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  })
}

const pdfBlob = async (doc: PDFDocument) =>
  new Blob([(await doc.save()).slice().buffer as ArrayBuffer], {
    type: 'application/pdf',
  })

/** Rotates the chosen pages (all pages when `spec` is blank) clockwise by 90/180/270 degrees. */
export async function rotatePdf(
  file: File,
  angle: number,
  spec: string
): Promise<Blob> {
  if (![90, 180, 270].includes(angle))
    throw new ConversionError('Choose a rotation of 90, 180 or 270 degrees.')
  const doc = await loadPdf(file, file.name)
  const count = doc.getPageCount()
  const indices = spec.trim()
    ? [...new Set(parsePageSpec(spec, count))]
    : doc.getPageIndices()
  for (const i of indices) {
    const page = doc.getPage(i)
    page.setRotation(degrees((page.getRotation().angle + angle) % 360))
  }
  return pdfBlob(doc)
}

export const MAX_SPLIT_PARTS = 500

/** Works out which zero-based pages go into each output file. */
export function planSplit(
  mode: string,
  pageCount: number,
  chunk: number,
  ranges: string
): number[][] {
  let parts: number[][]
  if (mode === 'each') {
    parts = Array.from({ length: pageCount }, (_, i) => [i])
  } else if (mode === 'chunk') {
    if (!Number.isInteger(chunk) || chunk < 1)
      throw new ConversionError('Pages per file must be 1 or more.')
    parts = []
    for (let i = 0; i < pageCount; i += chunk)
      parts.push(
        Array.from({ length: Math.min(chunk, pageCount - i) }, (_, k) => i + k)
      )
  } else if (mode === 'ranges') {
    if (!ranges.trim())
      throw new ConversionError(
        'Enter the ranges to split into, for example 1-3;4-6;7-.'
      )
    parts = ranges
      .split(';')
      .filter((r) => r.trim() !== '')
      .map((r) => parsePageSpec(r, pageCount))
  } else {
    throw new ConversionError('Choose how to split the PDF.')
  }
  if (parts.length === 0) throw new ConversionError('Nothing to split.')
  if (parts.length > MAX_SPLIT_PARTS)
    throw new ConversionError(
      `This would create ${parts.length} files; the limit is ${MAX_SPLIT_PARTS}.`
    )
  return parts
}

/** Splits one PDF into several PDFs and returns them in a ZIP. */
export async function splitPdf(
  file: File,
  mode: string,
  chunk: number,
  ranges: string
): Promise<Blob> {
  const src = await loadPdf(file, file.name)
  const parts = planSplit(mode, src.getPageCount(), chunk, ranges)
  const width = String(parts.length).length
  const stem = stemOf(file.name)
  const entries: Record<string, Uint8Array> = {}
  for (const [n, indices] of parts.entries()) {
    const out = await PDFDocument.create()
    const pages = await out.copyPages(src, indices)
    pages.forEach((p) => out.addPage(p))
    const name = safeFilename(
      `${stem}-part-${String(n + 1).padStart(Math.max(width, 2), '0')}.pdf`
    )
    entries[name] = await out.save()
  }
  const zipped = zipSync(entries, { level: 0 }) // PDFs are already compressed
  return new Blob([zipped.slice().buffer as ArrayBuffer], {
    type: 'application/zip',
  })
}

export interface WatermarkOptions {
  text: string
  /** 5-100 (percent) */
  opacity: number
  position: string
  size: string
  /** #rrggbb */
  color: string
}

const WM_SIZES: Record<string, number> = {
  small: 0.35,
  medium: 0.6,
  large: 0.85,
}

/** Maps a point in the visually displayed page to the page's own coordinates. */
export function visualToUser(
  rotation: number,
  w: number,
  h: number,
  vx: number,
  vy: number
): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [w - vy, vx]
    case 180:
      return [w - vx, h - vy]
    case 270:
      return [vy, h - vx]
    default:
      return [vx, vy]
  }
}

export interface Placement {
  x: number
  y: number
  size: number
  /** degrees, counter-clockwise, in the page's own (unrotated) coordinates */
  angle: number
}

/**
 * Where to draw the text so that it appears centred, upright (or rising diagonally) on the page
 * as a viewer shows it, even when the page carries a /Rotate flag.
 */
export function placeWatermark(a: {
  rotation: number
  width: number
  height: number
  textWidth1: number
  position: string
  fraction: number
}): Placement {
  const { rotation, width: w, height: h } = a
  const [vw, vh] = rotation % 180 === 0 ? [w, h] : [h, w]
  const diagonal = a.position === 'diagonal'
  const theta = diagonal ? (Math.atan2(vh, vw) * 180) / Math.PI : 0
  // The text may fill `fraction` of the available run, and never more than a third of the height.
  const run = diagonal ? Math.hypot(vw, vh) : vw
  const size = Math.max(6, Math.min((run * a.fraction) / a.textWidth1, vh / 3))
  const centreY =
    a.position === 'top' ? vh - size : a.position === 'bottom' ? size : vh / 2
  const [cx, cy] = visualToUser(rotation, w, h, vw / 2, centreY)
  // A page shown rotated clockwise by r turns user-space angles by -r, so add r back.
  const angle = theta + rotation
  const phi = (angle * Math.PI) / 180
  const tw = a.textWidth1 * size
  const th = size * 0.7
  return {
    x: cx - (tw / 2) * Math.cos(phi) + (th / 2) * Math.sin(phi),
    y: cy - (tw / 2) * Math.sin(phi) - (th / 2) * Math.cos(phi),
    size,
    angle,
  }
}

/** Stamps text on every page. Text is limited to what the built-in Helvetica font can draw. */
export async function watermarkPdf(
  file: File,
  opts: WatermarkOptions
): Promise<Blob> {
  const text = opts.text.trim()
  if (!text) throw new ConversionError('Enter the watermark text.')
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(opts.color)
  if (!m) throw new ConversionError('Choose a valid colour.')
  const color = rgb(
    parseInt(m[1], 16) / 255,
    parseInt(m[2], 16) / 255,
    parseInt(m[3], 16) / 255
  )
  const doc = await loadPdf(file, file.name)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  let textWidth1: number
  try {
    textWidth1 = font.widthOfTextAtSize(text, 1)
  } catch {
    throw new ConversionError(
      'The watermark can only use Latin letters, digits and common punctuation.'
    )
  }
  const fraction = WM_SIZES[opts.size] ?? WM_SIZES.medium
  const opacity = Math.min(1, Math.max(0.05, opts.opacity / 100))
  for (const page of doc.getPages()) {
    const box = page.getMediaBox()
    const at = placeWatermark({
      rotation: page.getRotation().angle,
      width: box.width,
      height: box.height,
      textWidth1,
      position: opts.position,
      fraction,
    })
    page.drawText(text, {
      x: box.x + at.x,
      y: box.y + at.y,
      size: at.size,
      font,
      color,
      opacity,
      rotate: degrees(at.angle),
    })
  }
  return pdfBlob(doc)
}
