import { describe, expect, it } from 'vitest'
import { detectFile, matchesSignature } from './detect'
import {
  formatBytes,
  outputName,
  safeFilename,
  stemOf,
  uniqueName,
} from './names'

const file = (bytes: number[] | string, name: string) =>
  new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name)
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]

describe('safeFilename', () => {
  it('strips path separators, control chars and reserved names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(safeFilename('a<b>:c"d|e?f*.txt')).toBe('a_b__c_d_e_f_.txt')
    expect(safeFilename('CON.txt')).toBe('_CON.txt')
    expect(safeFilename('...')).toBe('file')
    expect(safeFilename('x'.repeat(300) + '.png').length).toBeLessThanOrEqual(
      120
    )
    expect(safeFilename('x'.repeat(300) + '.png').endsWith('.png')).toBe(true)
  })
})

describe('names', () => {
  it('stem, output name and uniqueness', () => {
    expect(stemOf('a.b.tar.gz')).toBe('a.b')
    expect(outputName('photo.png', 'jpg')).toBe('photo.jpg')
    expect(outputName('doc.pdf', 'pdf', '-pages')).toBe('doc-pages.pdf')
    expect(uniqueName('a.txt', new Set(['a.txt', 'a (2).txt']))).toBe(
      'a (3).txt'
    )
    expect(uniqueName('a.tar.gz', new Set(['a.tar.gz']))).toBe('a (2).tar.gz')
    expect(uniqueName('b.txt', new Set())).toBe('b.txt')
  })
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('detectFile', () => {
  it('accepts a PNG whose content matches its extension', async () => {
    expect(await detectFile(file(PNG, 'a.png'))).toEqual({ format: 'png' })
  })
  it('rejects a file whose content contradicts its extension', async () => {
    const d = await detectFile(file('%PDF-1.4 hello', 'fake.png'))
    expect(d.format).toBeNull()
    expect(d.error).toMatch(/doesn't look like a valid PNG/)
  })
  it('sniffs an extensionless PNG', async () => {
    const d = await detectFile(file(PNG, 'mystery'))
    expect(d.format).toBe('png')
    expect(d.note).toMatch(/Detected as PNG/)
  })
  it('rejects empty and unsupported files', async () => {
    expect((await detectFile(file('', 'a.png'))).error).toMatch(/empty/)
    expect((await detectFile(file('MZ binary', 'a.exe'))).error).toMatch(
      /not supported/
    )
  })
  it('validates text formats: UTF-8 yes, binary no', async () => {
    expect((await detectFile(file('{"a":1}', 'a.json'))).format).toBe('json')
    expect(
      (await detectFile(file([0x7b, 0x00, 0x01, 0x02], 'a.json'))).format
    ).toBeNull()
    expect(
      (
        await detectFile(
          file([0xff, 0xfe, 0xfd, 0x41, 0x42, 0x43, 0x44, 0x45], 'a.csv')
        )
      ).format
    ).toBeNull()
  })
  it('requires a ZIP signature for office files', () => {
    expect(matchesSignature(new Uint8Array([0x50, 0x4b, 3, 4]), 'docx')).toBe(
      true
    )
    expect(matchesSignature(new Uint8Array([1, 2, 3, 4]), 'docx')).toBe(false)
  })
})
