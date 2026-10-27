import { ConversionError } from './types'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}
/** Browsers cap canvas size (~16k px side / ~268M px area); stay well inside that. */
const MAX_PIXELS = 100_000_000

export interface ImageOptions {
  quality?: number
  background?: string
  maxWidth?: number
  maxHeight?: number
  rotate?: string | number
  grayscale?: boolean
}

export interface Dimensions {
  width: number
  height: number
}

/** Fits (w,h) inside the max box without ever enlarging. 0 means "no limit". */
export function fitWithin(
  w: number,
  h: number,
  maxWidth = 0,
  maxHeight = 0
): Dimensions {
  let scale = 1
  if (maxWidth > 0) scale = Math.min(scale, maxWidth / w)
  if (maxHeight > 0) scale = Math.min(scale, maxHeight / h)
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ConversionError(
      'This image could not be decoded. It may be corrupted, or your browser may not support its format.'
    )
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h })
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mime: string,
  quality?: number
): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b
            ? resolve(b)
            : reject(
                new ConversionError('The browser could not encode the image.')
              ),
        mime,
        quality
      )
    )
  }
  return canvas.convertToBlob({ type: mime, quality })
}

/** Decodes, transforms and re-encodes an image entirely in the browser. */
export async function convertImage(
  file: Blob,
  targetFormat: 'png' | 'jpeg' | 'webp',
  options: ImageOptions = {}
): Promise<Blob> {
  const mime = MIME[targetFormat]
  const bitmap = await decode(file)
  try {
    const rotation = Number(options.rotate ?? 0)
    const sideways = rotation === 90 || rotation === 270
    const srcW = sideways ? bitmap.height : bitmap.width
    const srcH = sideways ? bitmap.width : bitmap.height
    const { width, height } = fitWithin(
      srcW,
      srcH,
      options.maxWidth,
      options.maxHeight
    )
    if (width * height > MAX_PIXELS) {
      throw new ConversionError(
        'The image is too large to convert in the browser.'
      )
    }
    const canvas = makeCanvas(width, height)
    const ctx = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx)
      throw new ConversionError(
        'Your browser could not create a drawing surface for this image.'
      )

    if (targetFormat === 'jpeg') {
      ctx.fillStyle = options.background ?? '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.save()
    ctx.translate(width / 2, height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    const drawW = sideways ? height : width
    const drawH = sideways ? width : height
    ctx.drawImage(bitmap, -drawW / 2, -drawH / 2, drawW, drawH)
    ctx.restore()

    if (options.grayscale) {
      const data = ctx.getImageData(0, 0, width, height)
      const px = data.data
      for (let i = 0; i < px.length; i += 4) {
        const y = Math.round(
          0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
        )
        px[i] = px[i + 1] = px[i + 2] = y
      }
      ctx.putImageData(data, 0, 0)
    }

    const quality =
      targetFormat === 'png' ? undefined : (options.quality ?? 85) / 100
    const blob = await canvasToBlob(canvas, mime, quality)
    // Browsers silently fall back to PNG for formats they cannot encode; never pass that off as WebP.
    if (blob.type !== mime) {
      throw new ConversionError(
        `Your browser cannot encode ${targetFormat.toUpperCase()} images. Try a different browser or output format.`
      )
    }
    return blob
  } finally {
    bitmap.close()
  }
}
