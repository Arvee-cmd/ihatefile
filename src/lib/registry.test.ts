import { describe, expect, it } from 'vitest'
import {
  acceptExtensions,
  choicesFor,
  combineChoices,
  defaultOptions,
  formatFromFilename,
  formats,
  optionDefs,
  searchEntries,
  sourcesOf,
  tasks,
  popularTasks,
  taskInputs,
  tools,
} from './registry'

const BROWSER_HANDLERS = [
  'image.canvas',
  'pdf.fromImage',
  'pdf.merge',
  'pdf.extractPages',
  'pdf.rotate',
  'pdf.split',
  'pdf.watermark',
  'archive.zipCreate',
  'data.json',
  'data.csvToJson',
  'data.jsonToCsv',
  'data.xmlToJson',
  'data.encoding',
]

describe('registry integrity', () => {
  it('has unique tool ids and only known formats', () => {
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length)
    for (const t of tools) {
      for (const f of t.inputs)
        if (f !== '*') expect(formats[f], `${t.id}: ${f}`).toBeDefined()
      for (const target of t.targets) {
        expect(formats[target.format], `${t.id}/${target.id}`).toBeDefined()
        for (const f of target.from ?? [])
          expect(t.inputs, `${t.id}/${target.id} from ${f}`).toContain(f)
        for (const o of target.options)
          expect(
            optionDefs[o],
            `${t.id}/${target.id} option ${o}`
          ).toBeDefined()
      }
    }
  })

  it('every browser tool has an implemented handler', () => {
    for (const t of tools.filter((x) => x.mode === 'browser'))
      expect(BROWSER_HANDLERS).toContain(t.handler)
  })

  it('server tools declare a capability and a size limit', () => {
    for (const t of tools.filter((x) => x.mode === 'server')) {
      expect(t.serverCapability).toBeTruthy()
      expect(t.maxFileMB).toBeGreaterThan(0)
    }
  })

  it('option defaults satisfy their own constraints', () => {
    for (const [name, d] of Object.entries(optionDefs)) {
      if (d.type === 'range' || d.type === 'number') {
        expect(d.default, name).toBeGreaterThanOrEqual(d.min)
        expect(d.default, name).toBeLessThanOrEqual(d.max)
      }
      if (d.type === 'select')
        expect(
          d.choices.map((c) => c.value),
          name
        ).toContain(d.default)
    }
  })
})

describe('format lookup', () => {
  it('maps extensions case-insensitively, including compound ones', () => {
    expect(formatFromFilename('Photo.JPG')).toBe('jpeg')
    expect(formatFromFilename('a.b.tar.gz')).toBe('targz')
    expect(formatFromFilename('a.tgz')).toBe('targz')
    expect(formatFromFilename('noext')).toBeNull()
    expect(formatFromFilename('virus.exe')).toBeNull()
  })
})

describe('choicesFor', () => {
  it('offers PNG to JPEG/WebP/PNG in the browser and never offers an unsupported pair', () => {
    const c = choicesFor('png')
    const png = c.filter((x) => x.target.id === 'jpeg')
    expect(png).toHaveLength(1)
    expect(png[0].tool.mode).toBe('browser') // browser wins over the server duplicate
    expect(c.map((x) => x.target.id)).toEqual(
      expect.arrayContaining([
        'png',
        'jpeg',
        'webp',
        'pdf',
        'gif',
        'bmp',
        'tiff',
        'ico',
      ])
    )
    expect(c.find((x) => x.target.id === 'gif')?.tool.mode).toBe('server')
  })

  it('excludes same-format targets unless the tool allows them', () => {
    expect(choicesFor('tiff').map((c) => c.target.id)).not.toContain('tiff')
    expect(choicesFor('png').map((c) => c.key)).toContain('image-raster:png') // re-encode allowed
  })

  it('respects per-target "from" lists', () => {
    expect(choicesFor('mp4').map((c) => c.target.id)).not.toContain('mp4')
    expect(choicesFor('md').map((c) => c.key)).toContain('text-documents:html')
    expect(choicesFor('html').map((c) => c.key)).not.toContain(
      'text-documents:html'
    )
  })

  it('returns nothing for formats with no conversion and hides combine tools', () => {
    expect(choicesFor('ico').map((c) => c.tool.id)).not.toContain('zip-create')
    expect(choicesFor('not-a-format')).toEqual([])
  })

  it('every concrete pair in the registry is reachable from choicesFor', () => {
    for (const t of tools.filter((x) => !x.combine)) {
      for (const target of t.targets) {
        for (const f of sourcesOf(t, target)) {
          expect(
            choicesFor(f).some(
              (c) =>
                c.target.id === target.id && c.target.format === target.format
            ),
            `${t.id}:${f}->${target.id}`
          ).toBe(true)
        }
      }
    }
  })
})

describe('combine tools', () => {
  it('offers PDF merge only when every file is a PDF; ZIP always', () => {
    expect(combineChoices(['pdf', 'pdf']).map((c) => c.tool.id)).toEqual(
      expect.arrayContaining(['pdf-merge', 'zip-create'])
    )
    expect(combineChoices(['pdf', 'png']).map((c) => c.tool.id)).toEqual([
      'zip-create',
    ])
  })
})

describe('helpers', () => {
  it('defaultOptions only includes options the target exposes', () => {
    const jpeg = tools
      .find((t) => t.id === 'image-raster')!
      .targets.find((t) => t.id === 'jpeg')!
    const png = tools
      .find((t) => t.id === 'image-raster')!
      .targets.find((t) => t.id === 'png')!
    expect(defaultOptions(jpeg)).toMatchObject({
      quality: 85,
      background: '#ffffff',
    })
    expect(defaultOptions(png)).not.toHaveProperty('quality')
  })

  it('search entries cover every tool and never mention unsupported pairs', () => {
    const entries = searchEntries()
    for (const t of tools)
      expect(entries.some((e) => e.tool.id === t.id)).toBe(true)
    expect(entries.some((e) => e.label === 'PNG to JPEG')).toBe(true)
    expect(entries.some((e) => /PDF to (DOCX|Word)/i.test(e.label))).toBe(true)
    expect(entries.some((e) => /PDF to (XLSX|PPTX|Excel)/i.test(e.label))).toBe(
      false
    )
  })

  it('accept list contains extensions', () => {
    expect(
      acceptExtensions(tools.filter((t) => t.category === 'pdf'))
    ).toContain('.pdf')
  })
})

describe('task pages', () => {
  it('have unique slugs and point at real tool targets', () => {
    expect(new Set(tasks.map((t) => t.slug)).size).toBe(tasks.length)
    for (const t of tasks) {
      const tool = tools.find((x) => x.id === t.tool)
      expect(tool, t.slug).toBeDefined()
      expect(
        tool!.targets.some((x) => x.id === t.target),
        `${t.slug} target`
      ).toBe(true)
    }
  })

  it('accept only formats the tool really converts, and are reachable via choicesFor', () => {
    for (const t of tasks) {
      const tool = tools.find((x) => x.id === t.tool)!
      const inputs = taskInputs(t)
      if (tool.inputs.includes('*')) continue
      expect(inputs.length, t.slug).toBeGreaterThan(0)
      for (const f of t.from ?? [])
        expect(inputs, `${t.slug} lists unsupported input ${f}`).toContain(f)
      if (tool.combine) continue
      for (const f of inputs)
        expect(
          choicesFor(f).some(
            (c) => c.tool.id === t.tool && c.target.id === t.target
          ),
          `${t.slug}: ${f}`
        ).toBe(true)
    }
  })

  it('popular shortcuts exist and every category has at least one task', () => {
    expect(popularTasks.length).toBeGreaterThan(5)
    for (const c of [
      'image',
      'document',
      'pdf',
      'audio',
      'video',
      'archive',
      'data',
      'developer',
    ])
      expect(
        tasks.some((t) => t.category === c),
        c
      ).toBe(true)
  })
})
