import { zipSync } from 'fflate'
import { safeFilename, uniqueName } from '@/lib/files/names'
import { ConversionError } from './types'

const MAX_TOTAL = 200 * 1024 * 1024

/** Builds a ZIP in memory. Entry names are sanitised and de-duplicated ("a (2).txt"). */
export async function createZip(files: File[]): Promise<Blob> {
  if (files.length === 0) throw new ConversionError('Add at least one file.')
  const total = files.reduce((n, f) => n + f.size, 0)
  if (total > MAX_TOTAL)
    throw new ConversionError(
      'The files are too large to zip in the browser (limit 200 MB in total).'
    )
  const taken = new Set<string>()
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) {
    const name = uniqueName(safeFilename(f.name), taken)
    taken.add(name)
    entries[name] = new Uint8Array(await f.arrayBuffer())
  }
  const zipped = zipSync(entries, { level: 6 })
  return new Blob([zipped.slice().buffer as ArrayBuffer], {
    type: 'application/zip',
  })
}
