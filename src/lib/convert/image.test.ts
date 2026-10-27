import { describe, expect, it } from 'vitest'
import { convertImage, fitWithin } from './image'
import { ConversionError } from './types'

async function makePng(
  w: number,
  h: number,
  paint: (c: OffscreenCanvasRenderingContext2D) => void
): Promise<Blob> {
  const c = new OffscreenCanvas(w, h)
  paint(c.getContext('2d')!)
  return c.convertToBlob({ type: 'image/png' })
}
async function pixel(blob: Blob, x: number, y: number) {
  const bmp = await createImageBitmap(blob)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const ctx = c.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  const d = ctx.getImageData(x, y, 1, 1).data
  const size = { width: bmp.width, height: bmp.height }
  bmp.close()
  return { rgba: [...d], ...size }
}
const red = (c: OffscreenCanvasRenderingContext2D) => {
  c.fillStyle = '#ff0000'
  c.fillRect(0, 0, 40, 20)
}
const clear = (c: OffscreenCanvasRenderingContext2D) => {
  c.clearRect(0, 0, 40, 20)
}
const magic = async (b: Blob) => [
  ...new Uint8Array(await b.slice(0, 12).arrayBuffer()),
]

describe('fitWithin', () => {
  it('scales down proportionally, never up', () => {
    expect(fitWithin(1000, 500, 500, 0)).toEqual({ width: 500, height: 250 })
    expect(fitWithin(1000, 500, 0, 100)).toEqual({ width: 200, height: 100 })
    expect(fitWithin(1000, 500, 300, 100)).toEqual({ width: 200, height: 100 })
    expect(fitWithin(100, 50, 500, 500)).toEqual({ width: 100, height: 50 })
    expect(fitWithin(100, 50)).toEqual({ width: 100, height: 50 })
  })
})

const GIF = () =>
  new Blob(
    [
      Uint8Array.from(
        atob('R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='),
        (c) => c.charCodeAt(0)
      ),
    ],
    { type: 'image/gif' }
  )
function bmp2x2(): Blob {
  // 2x2 24-bit BMP, all pixels blue (BGR 255,0,0); rows padded to 4 bytes.
  const row = [255, 0, 0, 255, 0, 0, 0, 0]
  const head = [
    0x42, 0x4d, 70, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 2, 0, 0, 0,
    2, 0, 0, 0, 1, 0, 24, 0, 0, 0, 0, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0,
  ]
  return new Blob([new Uint8Array([...head, ...row, ...row])], {
    type: 'image/bmp',
  })
}

describe('GIF and BMP inputs', () => {
  it('decode and convert to PNG, JPEG and WebP', async () => {
    for (const src of [GIF(), bmp2x2()]) {
      for (const fmt of ['png', 'jpeg', 'webp'] as const) {
        const out = await convertImage(src, fmt)
        expect(out.type).toBe(`image/${fmt}`)
        expect(await pixel(out, 0, 0)).toMatchObject({
          width: src.type === 'image/gif' ? 1 : 2,
        })
      }
    }
    const blue = await pixel(await convertImage(bmp2x2(), 'png'), 0, 0)
    expect(blue.rgba.slice(0, 3)).toEqual([0, 0, 255])
  })
})

describe('convertImage (real canvas encoders)', () => {
  it('PNG -> JPEG produces real JPEG bytes and keeps colours', async () => {
    const out = await convertImage(await makePng(40, 20, red), 'jpeg', {
      quality: 90,
    })
    expect(out.type).toBe('image/jpeg')
    expect((await magic(out)).slice(0, 3)).toEqual([0xff, 0xd8, 0xff])
    const p = await pixel(out, 5, 5)
    expect(p.rgba[0]).toBeGreaterThan(240)
    expect(p.rgba[1]).toBeLessThan(15)
    expect([p.width, p.height]).toEqual([40, 20])
  })

  it('flattens transparency onto the chosen JPEG background', async () => {
    const out = await convertImage(await makePng(40, 20, clear), 'jpeg', {
      background: '#0000ff',
    })
    const p = await pixel(out, 5, 5)
    expect(p.rgba[2]).toBeGreaterThan(240)
    expect(p.rgba[0]).toBeLessThan(15)
  })

  it('preserves transparency for PNG and WebP', async () => {
    const src = await makePng(40, 20, clear)
    for (const fmt of ['png', 'webp'] as const) {
      const out = await convertImage(src, fmt)
      expect(out.type).toBe(`image/${fmt}`)
      expect((await pixel(out, 5, 5)).rgba[3]).toBe(0)
    }
  })

  it('JPEG -> PNG -> WebP -> PNG chain yields the right container each time', async () => {
    const jpg = await convertImage(await makePng(40, 20, red), 'jpeg')
    const png = await convertImage(jpg, 'png')
    expect((await magic(png)).slice(1, 4)).toEqual([0x50, 0x4e, 0x47])
    const webp = await convertImage(png, 'webp', { quality: 70 })
    const m = await magic(webp)
    expect(String.fromCharCode(...m.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...m.slice(8, 12))).toBe('WEBP')
    expect((await magic(await convertImage(webp, 'png'))).slice(1, 4)).toEqual([
      0x50, 0x4e, 0x47,
    ])
  })

  it('lower quality gives a smaller JPEG', async () => {
    const noisy = await makePng(200, 200, (c) => {
      for (let i = 0; i < 2000; i++) {
        c.fillStyle = `hsl(${(i * 37) % 360} 80% 50%)`
        c.fillRect((i * 13) % 200, (i * 29) % 200, 8, 8)
      }
    })
    const hi = await convertImage(noisy, 'jpeg', { quality: 95 })
    const lo = await convertImage(noisy, 'jpeg', { quality: 10 })
    expect(lo.size).toBeLessThan(hi.size)
  })

  it('resizes within bounds and rotates', async () => {
    const src = await makePng(40, 20, red)
    expect(
      await pixel(await convertImage(src, 'png', { maxWidth: 20 }), 0, 0)
    ).toMatchObject({ width: 20, height: 10 })
    expect(
      await pixel(await convertImage(src, 'png', { rotate: '90' }), 0, 0)
    ).toMatchObject({ width: 20, height: 40 })
    expect(
      await pixel(await convertImage(src, 'png', { rotate: 180 }), 0, 0)
    ).toMatchObject({ width: 40, height: 20 })
    expect(
      await pixel(await convertImage(src, 'png', { maxWidth: 1000 }), 0, 0)
    ).toMatchObject({ width: 40, height: 20 })
  })

  it('rotation puts pixels in the right place', async () => {
    const src = await makePng(40, 20, (c) => {
      c.fillStyle = '#00ff00'
      c.fillRect(0, 0, 40, 20)
      c.fillStyle = '#ff0000'
      c.fillRect(0, 0, 10, 10)
    })
    const cw = await convertImage(src, 'png', { rotate: '90' }) // top-left goes to top-right
    expect((await pixel(cw, 15, 2)).rgba[0]).toBeGreaterThan(200)
    expect((await pixel(cw, 2, 2)).rgba[1]).toBeGreaterThan(200)
  })

  it('applies grayscale', async () => {
    const p = await pixel(
      await convertImage(await makePng(40, 20, red), 'png', {
        grayscale: true,
      }),
      5,
      5
    )
    expect(p.rgba[0]).toBe(p.rgba[1])
    expect(p.rgba[1]).toBe(p.rgba[2])
  })

  it('reports corrupt images with a ConversionError', async () => {
    await expect(
      convertImage(new Blob([new Uint8Array([1, 2, 3, 4])]), 'png')
    ).rejects.toBeInstanceOf(ConversionError)
  })
})
