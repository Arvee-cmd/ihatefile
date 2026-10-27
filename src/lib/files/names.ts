const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Makes a user-supplied name safe to offer as a download name. Never used as a path. */
export function safeFilename(name: string, fallback = 'file'): string {
  // eslint-disable-next-line no-control-regex
  let n = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim()
  n = n.replace(/^\.+/, '').replace(/[. ]+$/, '')
  if (!n) n = fallback
  const dot = n.lastIndexOf('.')
  const stem = dot > 0 ? n.slice(0, dot) : n
  if (RESERVED.test(stem)) n = '_' + n
  if (n.length > 120) {
    const ext = dot > 0 ? n.slice(dot) : ''
    n = n.slice(0, 120 - ext.length) + ext
  }
  return n
}

export function stemOf(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.tar.gz')) return filename.slice(0, -7)
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

/** photo.png -> photo.jpg; adds "-suffix" when requested (e.g. page images). */
export function outputName(
  inputName: string,
  ext: string,
  suffix = ''
): string {
  return safeFilename(
    `${stemOf(inputName)}${suffix}.${ext}`,
    `converted.${ext}`
  )
}

/** Returns a name unused in `taken`, appending " (2)", " (3)"... before the extension. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const lower = name.toLowerCase()
  const split = lower.endsWith('.tar.gz')
    ? name.length - 7
    : name.lastIndexOf('.') > 0
      ? name.lastIndexOf('.')
      : name.length
  const base = name.slice(0, split)
  const ext = name.slice(split)
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}
