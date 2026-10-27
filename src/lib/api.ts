/** Client for the optional FastAPI conversion server. Everything here is only used for server-mode tools. */
import type { OptionValue } from '@/lib/registry'

export const API_BASE: string = (
  import.meta.env.VITE_API_BASE_URL ?? ''
).replace(/\/$/, '')

export interface ServerToolStatus {
  id: string
  enabled: boolean
  reason: string | null
  disabledTargets: Record<string, string>
  /** Option values this server can actually honour (e.g. installed OCR languages). */
  optionChoices?: Record<string, string[]>
  maxFileMB: number
}

export interface ServerStatus {
  online: boolean
  tools: Record<string, ServerToolStatus>
  limits?: { maxUploadMB: number; jobTtlSeconds: number }
  error?: string
}

export class ServerError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ServerError'
    this.status = status
    this.code = code
  }
}

export type Availability = { ok: true } | { ok: false; reason: string }

/** Is this server-side conversion usable right now, and if not, why? */
export function serverAvailability(
  status: ServerStatus | undefined,
  toolId: string,
  targetId?: string
): Availability {
  if (!status || !status.online) {
    return {
      ok: false,
      reason:
        'The conversion server is not reachable, so this server-side conversion is unavailable.',
    }
  }
  const tool = status.tools[toolId]
  if (!tool)
    return { ok: false, reason: 'This server does not offer this conversion.' }
  if (!tool.enabled)
    return { ok: false, reason: tool.reason ?? 'Unavailable on this server.' }
  const targetReason = targetId ? tool.disabledTargets[targetId] : undefined
  if (targetReason) return { ok: false, reason: targetReason }
  return { ok: true }
}

export const OFFLINE: ServerStatus = { online: false, tools: {} }

export async function fetchServerStatus(
  signal?: AbortSignal
): Promise<ServerStatus> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/formats`, {
      signal: signal ?? AbortSignal.timeout(6000),
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!data || !Array.isArray(data.tools))
      throw new Error('Unexpected response')
    return {
      online: true,
      limits: data.limits,
      tools: Object.fromEntries(
        (data.tools as ServerToolStatus[]).map((t) => [t.id, t])
      ),
    }
  } catch (e) {
    return { ...OFFLINE, error: e instanceof Error ? e.message : 'unreachable' }
  }
}

export type ServerPhase = 'uploading' | 'processing' | 'downloading'

export interface ServerConvertArgs {
  file: File
  tool: string
  target: string
  options: Record<string, OptionValue>
  signal: AbortSignal
  onPhase: (phase: ServerPhase, progress?: number) => void
}

export interface ServerResult {
  blob: Blob
  filename: string
}

function errorFrom(xhrStatus: number, body: string): ServerError {
  try {
    const parsed = JSON.parse(body)
    const e = parsed?.error
    if (e?.message)
      return new ServerError(xhrStatus, e.code ?? 'error', e.message)
  } catch {
    /* fall through */
  }
  return new ServerError(
    xhrStatus,
    'error',
    xhrStatus === 0
      ? 'The conversion server could not be reached.'
      : `The server returned an error (${xhrStatus}).`
  )
}

/**
 * Uploads one file (real upload progress), waits for the conversion, downloads the result
 * into browser memory and asks the server to delete its copy immediately.
 */
export async function convertOnServer(
  args: ServerConvertArgs
): Promise<ServerResult> {
  const { file, tool, target, options, signal, onPhase } = args
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('tool', tool)
  form.append('target', target)
  form.append('options', JSON.stringify(options))

  const job = await new Promise<{
    jobId: string
    filename: string
    downloadUrl: string
  }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/v1/convert`)
    xhr.responseType = 'text'
    onPhase('uploading', 0)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPhase('uploading', e.loaded / e.total)
    }
    xhr.upload.onload = () => onPhase('processing')
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch {
          reject(
            new ServerError(
              xhr.status,
              'bad_response',
              'The server sent an unreadable response.'
            )
          )
        }
      } else reject(errorFrom(xhr.status, xhr.responseText))
    }
    xhr.onerror = () => reject(errorFrom(0, ''))
    xhr.ontimeout = () =>
      reject(
        new ServerError(0, 'timeout', 'The server took too long to respond.')
      )
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'))
    xhr.timeout = 10 * 60 * 1000
    if (signal.aborted)
      return reject(new DOMException('Cancelled', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })

  try {
    onPhase('downloading')
    const res = await fetch(`${API_BASE}${job.downloadUrl}`, { signal })
    if (!res.ok) throw errorFrom(res.status, await res.text())
    return { blob: await res.blob(), filename: job.filename }
  } finally {
    // Best effort: remove the server copy right away instead of waiting for the retention timeout.
    fetch(`${API_BASE}/api/v1/jobs/${job.jobId}`, {
      method: 'DELETE',
      keepalive: true,
    }).catch(() => undefined)
  }
}
