import { toast } from 'sonner'
import { create } from 'zustand'
import {
  ServerError,
  convertOnServer,
  type ServerPhase,
  type ServerStatus,
} from '@/lib/api'
import {
  runBrowserConversion,
  ConversionError,
  type ConversionOutput,
} from '@/lib/convert'
import { detectFile } from '@/lib/files/detect'
import {
  choiceByKey,
  choicesFor,
  defaultOptions,
  formatLabel,
  type Choice,
  type OptionValue,
} from '@/lib/registry'
import { availabilityOf, maxBytesFor, type Availability } from './availability'

export type ItemStatus =
  | 'validating'
  | 'invalid'
  | 'ready'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface QueueItem {
  id: string
  file: File
  format: string | null
  note?: string
  choiceKey: string | null
  options: Record<string, OptionValue>
  status: ItemStatus
  phase?: ServerPhase | 'converting'
  progress?: number // only set while real upload progress is known (0..1)
  message?: string
  result?: ConversionOutput
}

export interface ComboState {
  status: 'idle' | 'processing' | 'completed' | 'failed'
  message?: string
  result?: ConversionOutput
}

interface Preselect {
  tool?: string
  target?: string
  from?: string
}

interface State {
  items: QueueItem[]
  combo: Record<string, ComboState>
  preselect: Preselect
  serverConsent: boolean
  consentRequest: { ids: string[]; names: string[] } | null
  controllers: Record<string, AbortController>
  addFiles: (
    files: File[],
    status: ServerStatus,
    allowed?: string[]
  ) => Promise<void>
  removeItem: (id: string) => void
  moveItem: (id: string, delta: -1 | 1) => void
  clear: () => void
  setPreselect: (p: Preselect) => void
  setChoice: (id: string, key: string) => void
  setOption: (id: string, name: string, value: OptionValue) => void
  applyChoiceToAll: (key: string) => void
  convertItems: (ids: string[], status: ServerStatus) => Promise<void>
  resolveConsent: (accepted: boolean, status: ServerStatus) => void
  cancel: (id: string) => void
  runCombine: (
    key: string,
    options: Record<string, OptionValue>
  ) => Promise<void>
  clearCombo: (key: string) => void
}

let counter = 0
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`

export const MAX_QUEUE = 50

const patch = (id: string, p: Partial<QueueItem>) => (s: State) => ({
  items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)),
})

/** Picks the initial conversion for a file: the preselected one if it applies, else the first available. */
export function defaultChoiceFor(
  format: string,
  pre: Preselect,
  status: ServerStatus
): Choice | null {
  const all = choicesFor(format)
  const usable = all.filter((c) => availabilityOf(c, status).available)
  if (pre.tool && pre.target) {
    const hit = all.find(
      (c) => c.tool.id === pre.tool && c.target.id === pre.target
    )
    if (hit) return hit
    // A browser tool may have replaced the preselected server tool for the same output.
    const sameOutput = all.find((c) => c.target.id === pre.target)
    if (sameOutput) return sameOutput
  }
  return usable[0] ?? all[0] ?? null
}

function describeError(e: unknown): string {
  if (e instanceof ConversionError || e instanceof ServerError) return e.message
  if (e instanceof Error) return `Unexpected error: ${e.message}`
  return 'Unexpected error.'
}

export const useConverter = create<State>((set, get) => ({
  items: [],
  combo: {},
  preselect: {},
  serverConsent: (() => {
    try {
      return sessionStorage.getItem('ihatefile-server-consent') === '1'
    } catch {
      return false
    }
  })(),
  consentRequest: null,
  controllers: {},

  setPreselect: (p) => set({ preselect: p }),

  addFiles: async (files, status, allowed) => {
    const room = MAX_QUEUE - get().items.length
    if (room <= 0) {
      toast.error(`The queue is full (${MAX_QUEUE} files).`)
      return
    }
    const accepted: QueueItem[] = []
    for (const file of files.slice(0, room)) {
      const dup = get()
        .items.concat(accepted)
        .some(
          (i) =>
            i.file.name === file.name &&
            i.file.size === file.size &&
            i.file.lastModified === file.lastModified
        )
      if (dup) {
        toast.info(`"${file.name}" is already in the queue.`)
        continue
      }
      accepted.push({
        id: newId(),
        file,
        format: null,
        choiceKey: null,
        options: {},
        status: 'validating',
      })
    }
    if (files.length > room)
      toast.error(
        `Only ${room} more file(s) fit in the queue; the rest were skipped.`
      )
    if (!accepted.length) return
    set((s) => ({ items: [...s.items, ...accepted] }))

    for (const item of accepted) {
      const detection = await detectFile(item.file)
      // The item may have been removed while it was being inspected.
      if (!get().items.some((i) => i.id === item.id)) continue
      if (!detection.format) {
        set(patch(item.id, { status: 'invalid', message: detection.error }))
        continue
      }
      if (allowed && allowed.length && !allowed.includes(detection.format)) {
        set(
          patch(item.id, {
            status: 'invalid',
            format: detection.format,
            message: `This tool doesn't accept ${formatLabel(detection.format)} files. Accepted: ${allowed.map(formatLabel).join(', ')}.`,
          })
        )
        continue
      }
      const choice = defaultChoiceFor(detection.format, get().preselect, status)
      if (!choice) {
        set(
          patch(item.id, {
            status: 'invalid',
            format: detection.format,
            message: `No conversion is available for ${formatLabel(detection.format)} files.`,
          })
        )
        continue
      }
      set(
        patch(item.id, {
          status: 'ready',
          format: detection.format,
          note: detection.note,
          choiceKey: choice.key,
          options: defaultOptions(choice.target),
        })
      )
    }
  },

  removeItem: (id) => {
    get().controllers[id]?.abort()
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
  },

  moveItem: (id, delta) =>
    set((s) => {
      const i = s.items.findIndex((x) => x.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= s.items.length) return s
      const items = [...s.items]
      ;[items[i], items[j]] = [items[j], items[i]]
      return { items, combo: {} }
    }),

  clear: () => {
    Object.values(get().controllers).forEach((c) => c.abort())
    set({ items: [], combo: {}, controllers: {} })
  },

  setChoice: (id, key) => {
    const choice = choiceByKey(key)
    if (!choice) return
    set(
      patch(id, {
        choiceKey: key,
        options: defaultOptions(choice.target),
        status: 'ready',
        result: undefined,
        message: undefined,
      })
    )
  },

  setOption: (id, name, value) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.id === id
          ? {
              ...i,
              options: { ...i.options, [name]: value },
              ...(i.status === 'completed' || i.status === 'failed'
                ? {
                    status: 'ready' as const,
                    result: undefined,
                    message: undefined,
                  }
                : {}),
            }
          : i
      ),
    })),

  applyChoiceToAll: (key) => {
    const choice = choiceByKey(key)
    if (!choice) return
    set((s) => ({
      items: s.items.map((i) => {
        if (!i.format || i.status === 'processing' || i.status === 'invalid')
          return i
        const match = choicesFor(i.format).find(
          (c) => c.key === key || c.target.id === choice.target.id
        )
        return match
          ? {
              ...i,
              choiceKey: match.key,
              options: defaultOptions(match.target),
              status: 'ready' as const,
              result: undefined,
              message: undefined,
            }
          : i
      }),
    }))
  },

  cancel: (id) => get().controllers[id]?.abort(),

  resolveConsent: (accepted, status) => {
    const req = get().consentRequest
    set({ consentRequest: null })
    if (!accepted || !req) return
    try {
      sessionStorage.setItem('ihatefile-server-consent', '1')
    } catch {
      /* private mode: consent simply lasts for this page view */
    }
    set({ serverConsent: true })
    void get().convertItems(req.ids, status)
  },

  convertItems: async (ids, status) => {
    const targets = get().items.filter(
      (i) =>
        ids.includes(i.id) &&
        (i.status === 'ready' ||
          i.status === 'failed' ||
          i.status === 'cancelled') &&
        i.choiceKey
    )
    // Disclose before anything is uploaded.
    const needsServer = targets.filter(
      (i) => choiceByKey(i.choiceKey!)?.tool.mode === 'server'
    )
    if (needsServer.length && !get().serverConsent) {
      set({
        consentRequest: { ids, names: needsServer.map((i) => i.file.name) },
      })
      return
    }
    for (const queued of targets) {
      const item = get().items.find((i) => i.id === queued.id)
      if (!item || !item.choiceKey) continue
      const choice = choiceByKey(item.choiceKey)
      if (!choice) continue
      const avail = availabilityOf(choice, status)
      if (!avail.available) {
        set(patch(item.id, { status: 'failed', message: avail.reason }))
        continue
      }
      if (item.file.size > maxBytesFor(choice, status)) {
        set(
          patch(item.id, {
            status: 'failed',
            message: `This file is larger than the ${Math.round(maxBytesFor(choice, status) / 1048576)} MB limit for this conversion.`,
          })
        )
        continue
      }
      const controller = new AbortController()
      set((s) => ({ controllers: { ...s.controllers, [item.id]: controller } }))
      set(
        patch(item.id, {
          status: 'processing',
          phase: choice.tool.mode === 'server' ? 'uploading' : 'converting',
          progress: undefined,
          message: undefined,
          result: undefined,
        })
      )
      try {
        let result: ConversionOutput
        if (choice.tool.mode === 'server') {
          result = await convertOnServer({
            file: item.file,
            tool: choice.tool.id,
            target: choice.target.id,
            options: item.options,
            signal: controller.signal,
            onPhase: (phase, progress) =>
              set(
                patch(item.id, {
                  phase,
                  progress: phase === 'uploading' ? progress : undefined,
                })
              ),
          })
        } else {
          result = await runBrowserConversion(choice.tool.handler, {
            files: [item.file],
            inputFormat: item.format!,
            target: choice.target,
            options: item.options,
          })
        }
        if (controller.signal.aborted)
          throw new DOMException('Cancelled', 'AbortError')
        set(
          patch(item.id, {
            status: 'completed',
            result,
            phase: undefined,
            progress: undefined,
          })
        )
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          set(
            patch(item.id, {
              status: 'cancelled',
              phase: undefined,
              progress: undefined,
              message: 'Cancelled.',
            })
          )
        } else {
          set(
            patch(item.id, {
              status: 'failed',
              phase: undefined,
              progress: undefined,
              message: describeError(e),
            })
          )
        }
      } finally {
        set((s) => {
          const { [item.id]: _removed, ...rest } = s.controllers
          return { controllers: rest }
        })
      }
    }
  },

  runCombine: async (key, options) => {
    const choice = choiceByKey(key)
    if (!choice) return
    const files = get()
      .items.filter((i) => i.status !== 'invalid' && i.status !== 'validating')
      .map((i) => i.file)
    set({ combo: { [key]: { status: 'processing' } } })
    try {
      const result = await runBrowserConversion(choice.tool.handler, {
        files,
        inputFormat: files.length ? (get().items[0].format ?? '') : '',
        target: choice.target,
        options,
      })
      set({ combo: { [key]: { status: 'completed', result } } })
    } catch (e) {
      set({ combo: { [key]: { status: 'failed', message: describeError(e) } } })
    }
  },

  clearCombo: (key) =>
    set((s) => {
      const { [key]: _removed, ...rest } = s.combo
      return { combo: rest }
    }),
}))

export type { Availability }
