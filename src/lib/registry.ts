/**
 * Typed access to shared/registry.json - the single source of truth for supported
 * conversions. The Python backend loads the very same file, so the two cannot drift.
 */
import raw from '@shared/registry.json'

export type CategoryId =
  | 'image'
  | 'document'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'archive'
  | 'data'
  | 'developer'

export type ProcessingMode = 'browser' | 'server'
export type OptionValue = string | number | boolean

export interface FormatDef {
  label: string
  mime: string
  extensions: string[]
}

export type OptionDef =
  | {
      type: 'range' | 'number'
      label: string
      min: number
      max: number
      step?: number
      default: number
      help?: string
    }
  | {
      type: 'select'
      label: string
      default: string
      choices: { value: string; label: string }[]
      help?: string
    }
  | { type: 'boolean'; label: string; default: boolean; help?: string }
  | { type: 'color'; label: string; default: string; help?: string }
  | {
      type: 'text'
      label: string
      default: string
      placeholder?: string
      help?: string
    }

export interface TargetDef {
  id: string
  format: string
  label: string
  lossy: boolean
  from?: string[]
  options: string[]
}

export interface ToolDef {
  id: string
  name: string
  category: CategoryId
  mode: ProcessingMode
  engine: string
  handler: string
  combine?: boolean
  inputs: string[]
  targets: TargetDef[]
  allowSameFormat: boolean
  maxFileMB: number
  serverCapability: string | null
  notes: string[]
  tests: string[]
}

export interface CategoryDef {
  id: CategoryId
  name: string
  short: string
  icon: string
  description: string
}

/** A user-facing job ("Merge PDF", "Word to PDF"): one tool + one target, optionally limited to some input formats. */
export interface TaskDef {
  slug: string
  title: string
  description: string
  category: CategoryId
  icon: string
  tool: string
  target: string
  from?: string[]
}

interface RegistryJson {
  version: number
  categories: CategoryDef[]
  formats: Record<string, FormatDef>
  optionDefs: Record<string, OptionDef>
  tools: ToolDef[]
  tasks: TaskDef[]
  popular: { slug: string }[]
}

const registry = raw as unknown as RegistryJson

export const REGISTRY_VERSION = registry.version
export const categories = registry.categories
export const formats = registry.formats
export const optionDefs = registry.optionDefs
export const tools = registry.tools
export const tasks = registry.tasks
export const popularTasks = registry.popular
  .map((p) => registry.tasks.find((t) => t.slug === p.slug))
  .filter((t): t is TaskDef => !!t)

export function getTask(slug: string): TaskDef | undefined {
  return tasks.find((t) => t.slug === slug)
}

/** Input formats a task accepts. */
export function taskInputs(task: TaskDef): string[] {
  const tool = registry.tools.find((t) => t.id === task.tool)!
  const target = tool.targets.find((t) => t.id === task.target)!
  const all = tool.inputs.includes('*') ? [] : sourcesOf(tool, target)
  return task.from ? all.filter((f) => task.from!.includes(f)) : all
}

export function formatLabel(id: string): string {
  return formats[id]?.label ?? id.toUpperCase()
}

export function getTool(id: string): ToolDef | undefined {
  return tools.find((t) => t.id === id)
}

export function getCategory(id: string): CategoryDef | undefined {
  return categories.find((c) => c.id === id)
}

/** Formats accepted by a given target of a tool. */
export function sourcesOf(tool: ToolDef, target: TargetDef): string[] {
  return (target.from ?? tool.inputs).filter(
    (f) => tool.allowSameFormat || f !== target.format
  )
}

/** Resolves the format id for a filename (handles the compound .tar.gz extension). */
export function formatFromFilename(name: string): string | null {
  const lower = name.toLowerCase()
  for (const [id, def] of Object.entries(formats)) {
    for (const ext of def.extensions) {
      if (lower.endsWith('.' + ext)) return id
    }
  }
  return null
}

export function extensionOf(format: string): string {
  return formats[format]?.extensions[0] ?? format
}

/** A selectable conversion for a file: one target of one tool. */
export interface Choice {
  key: string // `${toolId}:${targetId}`
  tool: ToolDef
  target: TargetDef
}

export const choiceKey = (tool: ToolDef, target: TargetDef) =>
  `${tool.id}:${target.id}`

/**
 * Conversions offered for a single input format. When a browser tool and a server tool
 * produce the same target, the browser tool wins: it is private and needs no upload.
 * Combine-tools (merge, ZIP) are handled separately by `combineChoices`.
 */
export function choicesFor(inputFormat: string): Choice[] {
  const seen = new Map<string, Choice>()
  const ordered = [...tools].sort(
    (a, b) => Number(b.mode === 'browser') - Number(a.mode === 'browser')
  )
  for (const tool of ordered) {
    if (tool.combine) continue
    for (const target of tool.targets) {
      if (!sourcesOf(tool, target).includes(inputFormat)) continue
      const dedupe = `${target.id}:${target.format}`
      if (seen.has(dedupe)) continue
      seen.set(dedupe, { key: choiceKey(tool, target), tool, target })
    }
  }
  return [...seen.values()]
}

/** Tools that merge several queued files into one output. */
export function combineChoices(inputFormats: string[]): Choice[] {
  const out: Choice[] = []
  for (const tool of tools) {
    if (!tool.combine) continue
    const ok = inputFormats.every(
      (f) => tool.inputs.includes('*') || tool.inputs.includes(f)
    )
    if (!ok) continue
    for (const target of tool.targets) {
      out.push({ key: choiceKey(tool, target), tool, target })
    }
  }
  return out
}

export function choiceByKey(key: string): Choice | undefined {
  const [toolId, targetId] = key.split(':')
  const tool = getTool(toolId)
  const target = tool?.targets.find((t) => t.id === targetId)
  return tool && target ? { key, tool, target } : undefined
}

/** Default values for the options a target exposes. */
export function defaultOptions(target: TargetDef): Record<string, OptionValue> {
  return Object.fromEntries(
    target.options.map((name) => [name, optionDefs[name].default])
  )
}

export interface SearchEntry {
  id: string
  label: string
  toolName: string
  category: CategoryId
  mode: ProcessingMode
  from: string
  target: TargetDef
  tool: ToolDef
  keywords: string[]
}

/** Every concrete conversion, used by the search box and popular shortcuts. */
export function searchEntries(): SearchEntry[] {
  const entries: SearchEntry[] = []
  for (const tool of tools) {
    for (const target of tool.targets) {
      const sources = tool.inputs.includes('*')
        ? ['*']
        : sourcesOf(tool, target)
      for (const from of sources) {
        const fromLabel = from === '*' ? 'Files' : formatLabel(from)
        entries.push({
          id: `${tool.id}:${target.id}:${from}`,
          label:
            tool.targets.length > 1 && target.format === from
              ? target.label
              : `${fromLabel} to ${target.label}`,
          toolName: tool.name,
          category: tool.category,
          mode: tool.mode,
          from,
          target,
          tool,
          keywords: [
            tool.name,
            tool.category,
            tool.engine,
            from,
            target.id,
            target.format,
          ],
        })
      }
    }
  }
  return entries
}

export interface ConvertSearch {
  tool?: string
  target?: string
  from?: string
}

export function convertSearchFor(e: {
  tool: ToolDef
  target: TargetDef
  from: string
}): ConvertSearch {
  return {
    tool: e.tool.id,
    target: e.target.id,
    ...(e.from === '*' ? {} : { from: e.from }),
  }
}

export function toolsInCategory(category: string): ToolDef[] {
  return tools.filter((t) => t.category === category)
}

/** Accept-attribute list (extensions) for a set of tools. */
export function acceptExtensions(toolList: ToolDef[]): string[] {
  const ids = new Set<string>()
  for (const t of toolList) {
    if (t.inputs.includes('*')) continue
    t.inputs.forEach((f) => ids.add(f))
  }
  return [...ids].flatMap((f) => formats[f].extensions.map((e) => '.' + e))
}
