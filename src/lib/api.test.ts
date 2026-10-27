import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchServerStatus, serverAvailability, type ServerStatus } from './api'

const online: ServerStatus = {
  online: true,
  tools: {
    'office-to-pdf': {
      id: 'office-to-pdf',
      enabled: false,
      reason: 'LibreOffice is not installed on this server.',
      disabledTargets: {},
      maxFileMB: 20,
    },
    'audio-convert': {
      id: 'audio-convert',
      enabled: true,
      reason: null,
      disabledTargets: { flac: 'no flac encoder' },
      maxFileMB: 20,
    },
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('serverAvailability', () => {
  it('explains why a server conversion is unavailable', () => {
    expect(serverAvailability(undefined, 'x', 'y')).toMatchObject({ ok: false })
    expect(
      serverAvailability({ online: false, tools: {} }, 'audio-convert', 'mp3')
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/not reachable/),
    })
    expect(serverAvailability(online, 'nope', 'x')).toMatchObject({ ok: false })
    expect(serverAvailability(online, 'office-to-pdf', 'pdf')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/LibreOffice/),
    })
    expect(serverAvailability(online, 'audio-convert', 'flac')).toMatchObject({
      ok: false,
      reason: 'no flac encoder',
    })
    expect(serverAvailability(online, 'audio-convert', 'mp3')).toEqual({
      ok: true,
    })
  })
})

describe('fetchServerStatus', () => {
  it('reports offline instead of throwing when the server is unreachable', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new TypeError('Failed to fetch'))
    )
    expect(await fetchServerStatus()).toMatchObject({
      online: false,
      tools: {},
    })
  })
  it('reports offline for HTTP errors and malformed bodies', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('nope', { status: 502 }))
    )
    expect((await fetchServerStatus()).online).toBe(false)
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('{"hello":1}', { status: 200 }))
    )
    expect((await fetchServerStatus()).online).toBe(false)
  })
  it('indexes tools by id when online', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            tools: [
              {
                id: 'a',
                enabled: true,
                reason: null,
                disabledTargets: {},
                maxFileMB: 5,
              },
            ],
            limits: { maxUploadMB: 5, jobTtlSeconds: 60 },
          })
        )
      )
    )
    const s = await fetchServerStatus()
    expect(s.online).toBe(true)
    expect(s.tools.a.maxFileMB).toBe(5)
  })
})
