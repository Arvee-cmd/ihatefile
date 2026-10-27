import { formatFromFilename, formatLabel, formats } from '@/lib/registry'

const TEXT_FORMATS = new Set(['txt', 'md', 'html', 'json', 'csv', 'xml'])
const ZIP_BASED = new Set(['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'])

const ascii = (b: Uint8Array, start: number, text: string) =>
  [...text].every((c, i) => b[start + i] === c.charCodeAt(0))
const bytesAre = (b: Uint8Array, start: number, values: number[]) =>
  values.every((v, i) => b[start + i] === v)

/** Does the start of the file look like `format`? Mirrors backend/app/sniff.py. */
export function matchesSignature(head: Uint8Array, format: string): boolean {
  switch (format) {
    case 'png':
      return bytesAre(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'jpeg':
      return bytesAre(head, 0, [0xff, 0xd8, 0xff])
    case 'gif':
      return ascii(head, 0, 'GIF87a') || ascii(head, 0, 'GIF89a')
    case 'webp':
      return ascii(head, 0, 'RIFF') && ascii(head, 8, 'WEBP')
    case 'bmp':
      return ascii(head, 0, 'BM')
    case 'tiff':
      return (
        bytesAre(head, 0, [0x49, 0x49, 0x2a, 0x00]) ||
        bytesAre(head, 0, [0x4d, 0x4d, 0x00, 0x2a])
      )
    case 'ico':
      return bytesAre(head, 0, [0, 0, 1, 0])
    case 'pdf': {
      const text = new TextDecoder('latin1').decode(head.subarray(0, 1024))
      return text.includes('%PDF-')
    }
    case 'rtf':
      return new TextDecoder('latin1')
        .decode(head.subarray(0, 64))
        .trimStart()
        .startsWith('{\\rtf')
    case 'mp3':
      return (
        ascii(head, 0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
      )
    case 'wav':
      return ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE')
    case 'flac':
      return ascii(head, 0, 'fLaC')
    case 'ogg':
      return ascii(head, 0, 'OggS')
    case 'm4a':
    case 'mp4':
      return ascii(head, 4, 'ftyp')
    case 'mov':
      return (
        ascii(head, 4, 'ftyp') ||
        ['moov', 'mdat', 'wide', 'free'].some((t) => ascii(head, 4, t))
      )
    case 'webm':
    case 'mkv':
      return bytesAre(head, 0, [0x1a, 0x45, 0xdf, 0xa3])
    case 'targz':
      return bytesAre(head, 0, [0x1f, 0x8b])
    default:
      if (ZIP_BASED.has(format)) return ascii(head, 0, 'PK')
      if (TEXT_FORMATS.has(format)) return looksLikeText(head)
      return false
  }
}

function looksLikeText(head: Uint8Array): boolean {
  if (head.includes(0)) return false
  try {
    // A multi-byte character may be cut by the 4 KB window; trim up to 3 trailing bytes.
    for (let cut = 0; cut <= 3; cut++) {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(
          head.subarray(0, head.length - cut)
        )
        return true
      } catch {
        /* try a shorter slice */
      }
    }
    return false
  } catch {
    return false
  }
}

/** Formats we can identify from content alone when the extension is missing/unknown. */
const SNIFFABLE = [
  'png',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tiff',
  'ico',
  'pdf',
  'flac',
  'ogg',
  'wav',
  'targz',
]

export interface Detection {
  format: string | null
  error?: string
  note?: string
}

export async function detectFile(file: File): Promise<Detection> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer())
  if (file.size === 0) return { format: null, error: 'The file is empty.' }
  const byName = formatFromFilename(file.name)
  if (byName) {
    if (!matchesSignature(head, byName)) {
      return {
        format: null,
        error: `The content doesn't look like a valid ${formatLabel(byName)} file, even though the name ends in .${formats[byName].extensions[0]}.`,
      }
    }
    return { format: byName }
  }
  const sniffed = SNIFFABLE.find((f) => matchesSignature(head, f))
  if (sniffed) {
    return {
      format: sniffed,
      note: `Detected as ${formatLabel(sniffed)} from its content (the file name has no matching extension).`,
    }
  }
  return { format: null, error: 'This file type is not supported.' }
}
