import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { runBrowserConversion } from '.'
import { createZip } from './archive'

describe('createZip', () => {
  it('stores every file with its content and de-duplicates names', async () => {
    const zip = await createZip([
      new File(['one'], 'a.txt'),
      new File(['two'], 'a.txt'),
      new File(['three'], '../evil.txt'),
    ])
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(
      ['_evil.txt', 'a (2).txt', 'a.txt'].sort()
    )
    expect(strFromU8(entries['a.txt'])).toBe('one')
    expect(strFromU8(entries['a (2).txt'])).toBe('two')
    expect(zip.type).toBe('application/zip')
  })
  it('refuses an empty selection', async () => {
    await expect(createZip([])).rejects.toThrow(/at least one/)
  })
  it('works through the dispatcher', async () => {
    const out = await runBrowserConversion('archive.zipCreate', {
      files: [new File(['x'], 'x.bin')],
      inputFormat: 'zip',
      target: {
        id: 'zip',
        format: 'zip',
        label: '',
        lossy: false,
        options: [],
      },
      options: {},
    })
    expect(out.filename).toBe('archive.zip')
  })
})
