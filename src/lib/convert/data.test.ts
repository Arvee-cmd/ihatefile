import { describe, expect, it } from 'vitest'
import {
  csvToJson,
  detectDelimiter,
  encodingTool,
  jsonToCsv,
  jsonTool,
  parseCsv,
  readText,
  xmlToJson,
} from './data'
import { ConversionError } from './types'

describe('JSON tools', () => {
  it('pretty-prints with chosen indent, minifies, validates', () => {
    expect(jsonTool('{"a":[1,2]}', 'pretty', '2')).toBe(
      '{\n  "a": [\n    1,\n    2\n  ]\n}\n'
    )
    expect(jsonTool('{"a":1}', 'pretty', 'tab')).toBe('{\n\t"a": 1\n}\n')
    expect(jsonTool('{\n "a": 1,\n "b": [ 1, 2 ]\n}', 'minify')).toBe(
      '{"a":1,"b":[1,2]}'
    )
    expect(jsonTool('[1,2,3]', 'validate')).toMatch(
      /Valid JSON[\s\S]*array with 3 item/
    )
  })
  it('reports malformed JSON instead of producing output', () => {
    for (const action of ['pretty', 'minify', 'validate'] as const) {
      expect(() => jsonTool('{"a":', action)).toThrow(ConversionError)
    }
    expect(() => jsonTool("{'a':1}", 'pretty')).toThrow(/Invalid JSON/)
  })
})

describe('CSV parsing', () => {
  it('handles quotes, escaped quotes, embedded newlines/delimiters and CRLF', () => {
    const rows = parseCsv(
      'a,b\r\n"x,1","he said ""hi"""\r\n"multi\nline",z\r\n',
      ','
    )
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['multi\nline', 'z'],
    ])
  })
  it('detects delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectDelimiter('"a;b",c\n')).toBe(',')
  })
  it('rejects malformed quoting', () => {
    expect(() => parseCsv('a,"b\n', ',')).toThrow(/never closed/)
    expect(() => parseCsv('a,b"c"\n', ',')).toThrow(/stray quote/)
    expect(() => parseCsv('a,"b"x\n', ',')).toThrow(/closing quote/)
  })
})

describe('CSV to JSON', () => {
  it('produces an array of objects with string values', () => {
    expect(JSON.parse(csvToJson('id,name\n1,Ann\n2,"Bob, Jr."\n'))).toEqual([
      { id: '1', name: 'Ann' },
      { id: '2', name: 'Bob, Jr.' },
    ])
  })
  it('keeps empty cells as empty strings and skips blank lines', () => {
    expect(JSON.parse(csvToJson('a,b\n\n1,\n'))).toEqual([{ a: '1', b: '' }])
  })
  it('honours an explicit delimiter', () => {
    expect(JSON.parse(csvToJson('a|b\n1|2', '|'))).toEqual([{ a: '1', b: '2' }])
  })
  it('fails loudly on ragged rows, duplicate/empty headers and empty input', () => {
    expect(() => csvToJson('a,b\n1\n')).toThrow(/Row 2 has 1 column/)
    expect(() => csvToJson('a,a\n1,2\n')).toThrow(/Duplicate column name "a"/)
    expect(() => csvToJson('a,\n1,2\n')).toThrow(/empty column name/)
    expect(() => csvToJson('')).toThrow(/empty/)
  })
})

describe('JSON to CSV', () => {
  it('writes a header from the union of keys and escapes values', () => {
    const out = jsonToCsv(
      '[{"a":1,"b":"x,y"},{"a":2,"c":"say \\"hi\\"","b":null}]'
    )
    expect(out).toBe('a,b,c\r\n1,"x,y",\r\n2,,"say ""hi"""\r\n')
  })
  it('round-trips through CSV to JSON (as strings)', () => {
    const csv = jsonToCsv('[{"n":"a\\nb","m":true}]')
    expect(JSON.parse(csvToJson(csv))).toEqual([{ n: 'a\nb', m: 'true' }])
  })
  it('rejects nested values with their location instead of dropping them', () => {
    expect(() => jsonToCsv('[{"a":{"b":1}}]')).toThrow(
      /\[0\]\.a is a nested object/
    )
    expect(() => jsonToCsv('[{"a":1},{"t":[1]}]')).toThrow(
      /\[1\]\.t is a nested array/
    )
  })
  it('rejects unsupported shapes', () => {
    expect(() => jsonToCsv('{"a":1}')).toThrow(/top-level array/)
    expect(() => jsonToCsv('[1,2]')).toThrow(/not an object/)
    expect(() => jsonToCsv('[]')).toThrow(/empty/)
    expect(() => jsonToCsv('[{')).toThrow(/Invalid JSON/)
  })
})

describe('XML to JSON', () => {
  it('maps attributes, text, repeated elements and nesting', () => {
    const json = JSON.parse(
      xmlToJson(
        '<lib name="x"><book id="1">A</book><book id="2">B</book><note>hi</note><empty/></lib>'
      )
    )
    expect(json).toEqual({
      lib: {
        '@name': 'x',
        book: [
          { '@id': '1', '#text': 'A' },
          { '@id': '2', '#text': 'B' },
        ],
        note: 'hi',
        empty: '',
      },
    })
  })
  it('handles CDATA and ignores comments', () => {
    expect(JSON.parse(xmlToJson('<a><!-- c --><![CDATA[<raw>]]></a>'))).toEqual(
      { a: '<raw>' }
    )
  })
  it('rejects malformed XML', () => {
    expect(() => xmlToJson('<a><b></a>')).toThrow(/Invalid XML/)
    expect(() => xmlToJson('not xml')).toThrow(ConversionError)
  })
})

describe('Base64 and URL encoding', () => {
  it('round-trips Unicode', () => {
    const text = 'héllo wörld ✓ 日本語'
    const enc = encodingTool(text, 'base64-encode')
    expect(enc.trim()).toBe('aMOpbGxvIHfDtnJsZCDinJMg5pel5pys6Kqe')
    expect(encodingTool(enc, 'base64-decode')).toBe(text)
  })
  it('decodes unpadded and wrapped Base64, rejects garbage and non-text', () => {
    expect(encodingTool('aGk', 'base64-decode')).toBe('hi')
    expect(encodingTool('aGVs\nbG8=', 'base64-decode')).toBe('hello')
    expect(() => encodingTool('***', 'base64-decode')).toThrow(
      /not valid Base64/
    )
    expect(() => encodingTool('/w==', 'base64-decode')).toThrow(/UTF-8/)
    expect(() => encodingTool('  ', 'base64-decode')).toThrow(/empty/)
  })
  it('URL encodes and decodes, rejecting malformed sequences', () => {
    expect(encodingTool('a b&c=d/é', 'url-encode').trim()).toBe(
      'a%20b%26c%3Dd%2F%C3%A9'
    )
    expect(encodingTool('a%20b%C3%A9', 'url-decode')).toBe('a bé')
    expect(() => encodingTool('100%', 'url-decode')).toThrow(/Malformed/)
  })
})

describe('readText', () => {
  it('strips a BOM and rejects invalid UTF-8', async () => {
    expect(
      await readText(new Blob([new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])]))
    ).toBe('hi')
    await expect(
      readText(new Blob([new Uint8Array([0xff, 0xfe, 0x00])]))
    ).rejects.toThrow(/UTF-8/)
  })
})
