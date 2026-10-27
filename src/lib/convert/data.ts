import { ConversionError } from './types'

export async function readText(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } catch {
    throw new ConversionError('The file is not valid UTF-8 text.')
  }
}

// ------------------------------------------------------------------ JSON
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new ConversionError(
      `Invalid JSON: ${e instanceof Error ? e.message : 'could not parse'}`
    )
  }
}

export type JsonAction = 'pretty' | 'minify' | 'validate'

export function jsonTool(
  text: string,
  action: JsonAction,
  indent: string = '2'
): string {
  const value = parseJson(text)
  if (action === 'minify') return JSON.stringify(value)
  if (action === 'pretty') {
    return (
      JSON.stringify(value, null, indent === 'tab' ? '\t' : Number(indent)) +
      '\n'
    )
  }
  const kind = Array.isArray(value)
    ? `array with ${value.length} item(s)`
    : value === null
      ? 'null'
      : typeof value === 'object'
        ? `object with ${Object.keys(value).length} key(s)`
        : typeof value
  return `Valid JSON.\nTop-level value: ${kind}.\nSize: ${text.length} characters.\n`
}

// ------------------------------------------------------------------- CSV
const DELIMITERS = [',', ';', '\t', '|']

export function detectDelimiter(text: string): string {
  // Look at the first record only (quotes respected).
  const counts = new Map(DELIMITERS.map((d) => [d, 0]))
  let inQuotes = false
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break
    else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1)
  }
  let best = ','
  let max = 0
  for (const [d, n] of counts)
    if (n > max) {
      best = d
      max = n
    }
  return best
}

/** RFC 4180 parser: quoted fields, escaped quotes, embedded newlines, CRLF/LF/CR. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let wasQuoted = false
  let i = 0
  const endField = () => {
    row.push(field)
    field = ''
    wasQuoted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        const next = text[i]
        if (
          next !== undefined &&
          next !== delimiter &&
          next !== '\n' &&
          next !== '\r'
        ) {
          throw new ConversionError(
            `Malformed CSV: unexpected character after a closing quote (row ${rows.length + 1}).`
          )
        }
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      if (field !== '' || wasQuoted)
        throw new ConversionError(
          `Malformed CSV: stray quote in row ${rows.length + 1}.`
        )
      inQuotes = true
      wasQuoted = true
      i++
    } else if (ch === delimiter) {
      endField()
      i++
    } else if (ch === '\n' || ch === '\r') {
      endRow()
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += ch
      i++
    }
  }
  if (inQuotes)
    throw new ConversionError('Malformed CSV: a quoted field is never closed.')
  if (field !== '' || wasQuoted || row.length > 0) endRow()
  // Blank lines carry no data.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

export function csvToJson(
  text: string,
  delimiterOption = 'auto',
  indent = '2'
): string {
  const delimiter =
    delimiterOption === 'auto' ? detectDelimiter(text) : delimiterOption
  const rows = parseCsv(text, delimiter)
  if (rows.length === 0) throw new ConversionError('The CSV file is empty.')
  const header = rows[0]
  if (header.some((h) => h.trim() === ''))
    throw new ConversionError('The header row has an empty column name.')
  const dup = header.find((h, i) => header.indexOf(h) !== i)
  if (dup !== undefined)
    throw new ConversionError(
      `Duplicate column name "${dup}" in the header row.`
    )
  const records = rows.slice(1).map((r, idx) => {
    if (r.length !== header.length) {
      throw new ConversionError(
        `Row ${idx + 2} has ${r.length} column(s) but the header has ${header.length}.`
      )
    }
    return Object.fromEntries(header.map((h, c) => [h, r[c]]))
  })
  return (
    JSON.stringify(records, null, indent === 'tab' ? '\t' : Number(indent)) +
    '\n'
  )
}

function csvEscape(value: string, delimiter: string): string {
  return /["\r\n]/.test(value) ||
    value.includes(delimiter) ||
    /^\s|\s$/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value
}

export function jsonToCsv(text: string): string {
  const data = parseJson(text)
  if (!Array.isArray(data))
    throw new ConversionError('JSON to CSV needs a top-level array of objects.')
  if (data.length === 0)
    throw new ConversionError(
      'The JSON array is empty, so there are no columns to write.'
    )
  const columns: string[] = []
  data.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new ConversionError(
        `Item [${i}] is not an object. Only arrays of flat objects can be converted.`
      )
    }
    for (const [key, v] of Object.entries(item)) {
      if (v !== null && typeof v === 'object') {
        throw new ConversionError(
          `Value at [${i}].${key} is a nested ${Array.isArray(v) ? 'array' : 'object'}, which CSV cannot represent. Flatten the data first.`
        )
      }
      if (!columns.includes(key)) columns.push(key)
    }
  })
  const delimiter = ','
  const lines = [columns.map((c) => csvEscape(c, delimiter)).join(delimiter)]
  for (const item of data as Record<
    string,
    string | number | boolean | null
  >[]) {
    lines.push(
      columns
        .map((c) =>
          item[c] === undefined || item[c] === null
            ? ''
            : csvEscape(String(item[c]), delimiter)
        )
        .join(delimiter)
    )
  }
  return lines.join('\r\n') + '\r\n'
}

// ------------------------------------------------------------------- XML
type XmlValue = string | { [key: string]: XmlValue | XmlValue[] }

function elementToJson(el: Element): XmlValue {
  const obj: { [key: string]: XmlValue | XmlValue[] } = {}
  for (const attr of Array.from(el.attributes))
    obj['@' + attr.name] = attr.value
  let text = ''
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element
      const value = elementToJson(child)
      const existing = obj[child.tagName]
      if (existing === undefined) obj[child.tagName] = value
      else if (Array.isArray(existing)) existing.push(value)
      else obj[child.tagName] = [existing, value]
    } else if (
      node.nodeType === Node.TEXT_NODE ||
      node.nodeType === Node.CDATA_SECTION_NODE
    ) {
      text += node.nodeValue ?? ''
    }
  }
  const trimmed = text.trim()
  if (Object.keys(obj).length === 0) return trimmed
  if (trimmed) obj['#text'] = trimmed
  return obj
}

export function xmlToJson(text: string, indent = '2'): string {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err || !doc.documentElement) {
    const detail = (err?.textContent ?? '').split('\n')[0].trim()
    throw new ConversionError(`Invalid XML${detail ? `: ${detail}` : '.'}`)
  }
  const root = doc.documentElement
  return (
    JSON.stringify(
      { [root.tagName]: elementToJson(root) },
      null,
      indent === 'tab' ? '\t' : Number(indent)
    ) + '\n'
  )
}

// -------------------------------------------------------- Base64 / URL
export type EncodingAction =
  'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function encodingTool(text: string, action: EncodingAction): string {
  switch (action) {
    case 'base64-encode':
      return bytesToBase64(new TextEncoder().encode(text)) + '\n'
    case 'base64-decode': {
      const compact = text.replace(/\s+/g, '')
      if (!compact) throw new ConversionError('The file is empty.')
      if (
        !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) ||
        compact.replace(/=+$/, '').length % 4 === 1
      ) {
        throw new ConversionError('This is not valid Base64.')
      }
      try {
        const binary = atob(compact)
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        throw new ConversionError(
          'The Base64 data is invalid or does not decode to UTF-8 text.'
        )
      }
    }
    case 'url-encode':
      return encodeURIComponent(text) + '\n'
    case 'url-decode':
      try {
        return decodeURIComponent(text.trim())
      } catch {
        throw new ConversionError(
          'Malformed percent-encoding (for example a stray "%").'
        )
      }
  }
}
