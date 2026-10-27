import { outputName } from '@/lib/files/names'
import { extensionOf, formats, type OptionValue } from '@/lib/registry'
import { createZip } from './archive'
import {
  csvToJson,
  encodingTool,
  jsonToCsv,
  jsonTool,
  readText,
  xmlToJson,
  type EncodingAction,
  type JsonAction,
} from './data'
import { convertImage, type ImageOptions } from './image'
import {
  extractPages,
  imageToPdf,
  mergePdfs,
  rotatePdf,
  splitPdf,
  watermarkPdf,
} from './pdf'
import {
  ConversionError,
  type BrowserJob,
  type ConversionOutput,
} from './types'

export { ConversionError } from './types'
export type { BrowserJob, ConversionOutput } from './types'

const textBlob = (text: string, format: string) =>
  new Blob([text], { type: `${formats[format].mime};charset=utf-8` })

/** Runs a browser-side conversion. Nothing here touches the network. */
export async function runBrowserConversion(
  handler: string,
  job: BrowserJob
): Promise<ConversionOutput> {
  const { files, target, options } = job
  const first = files[0]
  const ext = extensionOf(target.format)
  const opt = (name: string): OptionValue | undefined => options[name]
  const name = (suffix = '') => outputName(first.name, ext, suffix)

  switch (handler) {
    case 'image.canvas': {
      const blob = await convertImage(
        first,
        target.format as 'png' | 'jpeg' | 'webp',
        {
          quality: opt('quality') as number | undefined,
          background: opt('background') as string | undefined,
          maxWidth: opt('maxWidth') as number | undefined,
          maxHeight: opt('maxHeight') as number | undefined,
          rotate: opt('rotate') as string | undefined,
          grayscale: opt('grayscale') as boolean | undefined,
        } satisfies ImageOptions
      )
      return { blob, filename: name() }
    }
    case 'pdf.fromImage':
      return {
        blob: await imageToPdf(first, job.inputFormat),
        filename: name(),
      }
    case 'pdf.merge':
      return { blob: await mergePdfs(files), filename: 'merged.pdf' }
    case 'pdf.extractPages':
      return {
        blob: await extractPages(first, String(opt('pages') ?? '')),
        filename: name('-pages'),
      }
    case 'pdf.rotate':
      return {
        blob: await rotatePdf(
          first,
          Number(opt('rotateAngle') ?? 90),
          String(opt('rotatePages') ?? '')
        ),
        filename: name('-rotated'),
      }
    case 'pdf.split':
      return {
        blob: await splitPdf(
          first,
          String(opt('splitMode') ?? 'each'),
          Number(opt('splitChunk') ?? 2),
          String(opt('splitRanges') ?? '')
        ),
        filename: outputName(first.name, 'zip', '-split'),
      }
    case 'pdf.watermark':
      return {
        blob: await watermarkPdf(first, {
          text: String(opt('wmText') ?? ''),
          opacity: Number(opt('wmOpacity') ?? 30),
          position: String(opt('wmPosition') ?? 'diagonal'),
          size: String(opt('wmSize') ?? 'medium'),
          color: String(opt('wmColor') ?? '#808080'),
        }),
        filename: name('-watermarked'),
      }
    case 'archive.zipCreate':
      return { blob: await createZip(files), filename: 'archive.zip' }
    case 'data.json':
      return {
        blob: textBlob(
          jsonTool(
            await readText(first),
            target.id as JsonAction,
            String(opt('indent') ?? '2')
          ),
          target.format
        ),
        filename: name(
          target.id === 'minify'
            ? '.min'
            : target.id === 'validate'
              ? '-validation'
              : ''
        ),
      }
    case 'data.csvToJson':
      return {
        blob: textBlob(
          csvToJson(await readText(first), String(opt('delimiter') ?? 'auto')),
          'json'
        ),
        filename: name(),
      }
    case 'data.jsonToCsv':
      return {
        blob: textBlob(jsonToCsv(await readText(first)), 'csv'),
        filename: name(),
      }
    case 'data.xmlToJson':
      return {
        blob: textBlob(
          xmlToJson(await readText(first), String(opt('indent') ?? '2')),
          'json'
        ),
        filename: name(),
      }
    case 'data.encoding': {
      const suffix = target.id.replace('-', '.')
      return {
        blob: textBlob(
          encodingTool(await readText(first), target.id as EncodingAction),
          'txt'
        ),
        filename: outputName(first.name, 'txt', '.' + suffix),
      }
    }
    default:
      throw new ConversionError(
        `No browser engine is implemented for "${handler}".`
      )
  }
}
