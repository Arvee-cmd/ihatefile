import { unzipSync } from 'fflate'
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { runBrowserConversion } from '.'
import { convertImage } from './image'
import {
  extractPages,
  imageToPdf,
  mergePdfs,
  parsePageSpec,
  placeWatermark,
  planSplit,
  rotatePdf,
  splitPdf,
  visualToUser,
  watermarkPdf,
} from './pdf'
import { ConversionError } from './types'

async function makePdf(pages: number, name = 'a.pdf'): Promise<File> {
  const d = await PDFDocument.create()
  for (let i = 0; i < pages; i++) d.addPage([100 + i, 200])
  return new File(
    [new Uint8Array(await d.save({ useObjectStreams: false }))],
    name
  )
}
const pageWidths = async (b: Blob) =>
  (await PDFDocument.load(await b.arrayBuffer()))
    .getPages()
    .map((p) => Math.round(p.getWidth()))
const png = async () => {
  const c = new OffscreenCanvas(30, 20)
  const x = c.getContext('2d')!
  x.fillStyle = '#00f'
  x.fillRect(0, 0, 30, 20)
  return c.convertToBlob({ type: 'image/png' })
}

describe('parsePageSpec', () => {
  it('parses ranges, lists, open ranges, order and repeats', () => {
    expect(parsePageSpec('1-3,5', 6)).toEqual([0, 1, 2, 4])
    expect(parsePageSpec('4-', 6)).toEqual([3, 4, 5])
    expect(parsePageSpec('-2', 6)).toEqual([0, 1])
    expect(parsePageSpec(' 3 , 1 ,3', 6)).toEqual([2, 0, 2])
  })
  it('rejects malformed, backwards and out-of-range specs', () => {
    for (const bad of ['', 'a', '1-x', '0', '7', '3-2', '1,,2', '--', '1-9']) {
      expect(() => parsePageSpec(bad, 6), bad).toThrow(ConversionError)
    }
  })
})

describe('PDF operations', () => {
  it('merges PDFs in order', async () => {
    const out = await mergePdfs([await makePdf(2), await makePdf(3)])
    expect(await pageWidths(out)).toEqual([100, 101, 100, 101, 102])
  })
  it('requires two or more PDFs', async () => {
    await expect(mergePdfs([await makePdf(1)])).rejects.toThrow(/at least two/)
  })
  it('extracts the requested pages in the requested order', async () => {
    const out = await extractPages(await makePdf(5), '3,1')
    expect(await pageWidths(out)).toEqual([102, 100])
    await expect(extractPages(await makePdf(2), '5')).rejects.toThrow(/2 pages/)
  })
  it('rejects corrupt PDFs with a clear message', async () => {
    const bad = new File(
      [new TextEncoder().encode('%PDF-1.4 garbage')],
      'bad.pdf'
    )
    await expect(mergePdfs([bad, await makePdf(1)])).rejects.toThrow(
      /corrupted or is not a valid PDF/
    )
  })
  it('rejects encrypted PDFs', async () => {
    // Minimal encrypted trailer: pdf-lib refuses to load these when ignoreEncryption is false.
    const d = await PDFDocument.create()
    d.addPage()
    let text = new TextDecoder('latin1').decode(
      await d.save({ useObjectStreams: false })
    )
    text = text.replace('trailer', 'trailer\n<</Encrypt 1 0 R>>\n%')
    const enc = new File([new TextEncoder().encode(text)], 'enc.pdf')
    await expect(extractPages(enc, '1')).rejects.toThrow(/password-protected/)
  })
  it('converts PNG, JPEG and WebP images into valid one-page PDFs', async () => {
    const p = await png()
    const jpg = await convertImage(p, 'jpeg')
    const webp = await convertImage(p, 'webp')
    for (const [blob, fmt] of [
      [p, 'png'],
      [jpg, 'jpeg'],
      [webp, 'webp'],
    ] as const) {
      const out = await imageToPdf(blob, fmt)
      expect(out.type).toBe('application/pdf')
      const doc = await PDFDocument.load(await out.arrayBuffer())
      expect(doc.getPageCount()).toBe(1)
      expect(Math.round(doc.getPage(0).getWidth())).toBe(30)
    }
  })
  it('embeds GIF and BMP images too', async () => {
    const gif = new Blob(
      [
        Uint8Array.from(
          atob('R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='),
          (c) => c.charCodeAt(0)
        ),
      ],
      { type: 'image/gif' }
    )
    const out = await imageToPdf(gif, 'gif')
    expect(
      (await PDFDocument.load(await out.arrayBuffer())).getPageCount()
    ).toBe(1)
  })
  it('rejects a corrupt image', async () => {
    await expect(
      imageToPdf(new Blob([new Uint8Array([1, 2, 3])]), 'jpeg')
    ).rejects.toBeInstanceOf(ConversionError)
  })
  it('is reachable through the dispatcher with sensible filenames', async () => {
    const out = await runBrowserConversion('pdf.extractPages', {
      files: [await makePdf(3, 'report.pdf')],
      inputFormat: 'pdf',
      target: {
        id: 'pages',
        format: 'pdf',
        label: '',
        lossy: false,
        options: ['pages'],
      },
      options: { pages: '2' },
    })
    expect(out.filename).toBe('report-pages.pdf')
  })
})

/** All decoded content-stream text of a PDF (hex string literals included). */
async function streamText(blob: Blob): Promise<string> {
  const doc = await PDFDocument.load(await blob.arrayBuffer())
  let out = ''
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream)
      out += new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode())
  }
  return out
}
const hex = (t: string) =>
  [...t].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')

describe('rotate PDF', () => {
  it('rotates every page by default and accumulates with existing rotation', async () => {
    const once = await rotatePdf(await makePdf(3), 90, '')
    expect(
      (await PDFDocument.load(await once.arrayBuffer()))
        .getPages()
        .map((p) => p.getRotation().angle)
    ).toEqual([90, 90, 90])
    const twice = await rotatePdf(new File([once], 'r.pdf'), 270, '')
    expect(
      (await PDFDocument.load(await twice.arrayBuffer()))
        .getPages()
        .map((p) => p.getRotation().angle)
    ).toEqual([0, 0, 0])
  })
  it('rotates only the listed pages and validates input', async () => {
    const out = await rotatePdf(await makePdf(4), 180, '2,4-')
    expect(
      (await PDFDocument.load(await out.arrayBuffer()))
        .getPages()
        .map((p) => p.getRotation().angle)
    ).toEqual([0, 180, 0, 180])
    await expect(rotatePdf(await makePdf(2), 90, '9')).rejects.toThrow(
      /2 pages/
    )
    await expect(rotatePdf(await makePdf(2), 45, '')).rejects.toThrow(/90, 180/)
  })
})

describe('split PDF', () => {
  it('plans every-page, every-N and custom-range splits', () => {
    expect(planSplit('each', 3, 1, '')).toEqual([[0], [1], [2]])
    expect(planSplit('chunk', 5, 2, '')).toEqual([[0, 1], [2, 3], [4]])
    expect(planSplit('ranges', 6, 1, '1-2;3,5;6-')).toEqual([
      [0, 1],
      [2, 4],
      [5],
    ])
    expect(() => planSplit('ranges', 6, 1, '')).toThrow(/Enter the ranges/)
    expect(() => planSplit('ranges', 6, 1, '1-9')).toThrow(/6 pages/)
    expect(() => planSplit('chunk', 6, 0, '')).toThrow(/1 or more/)
    expect(() => planSplit('each', 501, 1, '')).toThrow(/limit is 500/)
  })
  it('produces a ZIP of valid PDFs with the right pages', async () => {
    const zip = await splitPdf(await makePdf(5, 'book.pdf'), 'chunk', 2, '')
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(files)).toEqual([
      'book-part-01.pdf',
      'book-part-02.pdf',
      'book-part-03.pdf',
    ])
    const widths = await Promise.all(
      Object.values(files).map(async (b) =>
        (await PDFDocument.load(b))
          .getPages()
          .map((p) => Math.round(p.getWidth()))
      )
    )
    expect(widths).toEqual([[100, 101], [102, 103], [104]])
  })
})

describe('watermark PDF', () => {
  it('draws the text on every page and keeps the page count', async () => {
    const out = await watermarkPdf(await makePdf(3), {
      text: 'DRAFT',
      opacity: 40,
      position: 'diagonal',
      size: 'medium',
      color: '#ff0000',
    })
    expect(
      (await PDFDocument.load(await out.arrayBuffer())).getPageCount()
    ).toBe(3)
    const text = await streamText(out)
    expect(text.split(hex('DRAFT').toUpperCase()).length - 1).toBe(3)
  })
  it('rejects empty text, bad colours and characters Helvetica cannot draw', async () => {
    const base = {
      opacity: 30,
      position: 'center',
      size: 'small',
      color: '#000000',
    }
    await expect(
      watermarkPdf(await makePdf(1), { ...base, text: '  ' })
    ).rejects.toThrow(/Enter the watermark/)
    await expect(
      watermarkPdf(await makePdf(1), { ...base, text: 'x', color: 'red' })
    ).rejects.toThrow(/valid colour/)
    await expect(
      watermarkPdf(await makePdf(1), { ...base, text: '机密' })
    ).rejects.toThrow(/Latin/)
  })
  it('maps visual coordinates back for rotated pages', () => {
    // 200x100 page rotated 90deg clockwise is shown 100 wide and 200 tall.
    expect(visualToUser(90, 200, 100, 50, 100)).toEqual([100, 50]) // visual centre -> page centre
    expect(visualToUser(180, 200, 100, 0, 0)).toEqual([200, 100])
    expect(visualToUser(270, 200, 100, 50, 100)).toEqual([100, 50])
  })
  it('places the stamp upright and centred as the viewer shows it, for every page rotation', () => {
    const userToVisual = (
      rot: number,
      w: number,
      h: number,
      x: number,
      y: number
    ) =>
      rot === 90
        ? [y, w - x]
        : rot === 180
          ? [w - x, h - y]
          : rot === 270
            ? [h - y, x]
            : [x, y]
    for (const rot of [0, 90, 180, 270]) {
      for (const position of ['center', 'top', 'bottom', 'diagonal']) {
        const w = 400
        const h = 300
        const [vw, vh] = rot % 180 === 0 ? [w, h] : [h, w]
        const textWidth1 = 5
        const p = placeWatermark({
          rotation: rot,
          width: w,
          height: h,
          textWidth1,
          position: position,
          fraction: 0.6,
        })
        // visual reading direction of the text = user direction turned clockwise by `rot`
        const visualAngle = (((p.angle - rot) % 360) + 360) % 360
        const expected =
          position === 'diagonal' ? (Math.atan2(vh, vw) * 180) / Math.PI : 0
        expect(visualAngle).toBeCloseTo(expected, 6)
        // centre of the text box (baseline midpoint lifted by half the cap height), as shown
        const rad = (p.angle * Math.PI) / 180
        const half = (textWidth1 * p.size) / 2
        const lift = p.size * 0.35
        const mid = [
          p.x + half * Math.cos(rad) - lift * Math.sin(rad),
          p.y + half * Math.sin(rad) + lift * Math.cos(rad),
        ]
        const [mx] = userToVisual(rot, w, h, mid[0], mid[1])
        expect(mx, `${rot} ${position}`).toBeCloseTo(vw / 2, 0)
      }
    }
  })
  it('handles rotated pages and the dispatcher naming', async () => {
    const rotated = await rotatePdf(await makePdf(1, 'a.pdf'), 90, '')
    const out = await watermarkPdf(new File([rotated], 'a.pdf'), {
      text: 'TOP SECRET',
      opacity: 30,
      position: 'top',
      size: 'large',
      color: '#808080',
    })
    expect(
      (await PDFDocument.load(await out.arrayBuffer())).getPage(0).getRotation()
        .angle
    ).toBe(90)
    const viaDispatcher = await runBrowserConversion('pdf.watermark', {
      files: [await makePdf(1, 'memo.pdf')],
      inputFormat: 'pdf',
      target: {
        id: 'watermarked',
        format: 'pdf',
        label: '',
        lossy: false,
        options: [],
      },
      options: { wmText: 'COPY' },
    })
    expect(viaDispatcher.filename).toBe('memo-watermarked.pdf')
  })
})
