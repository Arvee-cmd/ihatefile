import { Link } from '@tanstack/react-router'
import {
  Archive,
  Braces,
  Code,
  FileText,
  Image,
  Merge,
  Minimize2,
  Music,
  Presentation,
  RotateCw,
  ScanText,
  Scissors,
  Server,
  Split,
  Stamp,
  ShieldCheck,
  Table,
  Terminal,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { getTool, type TaskDef } from '@/lib/registry'

const ICONS: Record<string, LucideIcon> = {
  merge: Merge,
  scissors: Scissors,
  image: Image,
  'file-text': FileText,
  table: Table,
  presentation: Presentation,
  code: Code,
  minimize: Minimize2,
  music: Music,
  video: Video,
  archive: Archive,
  braces: Braces,
  terminal: Terminal,
  rotate: RotateCw,
  split: Split,
  stamp: Stamp,
  scan: ScanText,
}

export function TaskTile({ task }: { task: TaskDef }) {
  const Icon = ICONS[task.icon] ?? FileText
  const mode = getTool(task.tool)?.mode
  return (
    <Link
      to='/tool/$slug'
      params={{ slug: task.slug }}
      data-testid='task-tile'
      className='group flex flex-col gap-2 rounded-xl border bg-card p-5 transition-colors outline-none hover:border-brand focus-visible:ring-[3px] focus-visible:ring-ring/50'
    >
      <span className='flex items-center justify-between'>
        <span className='flex size-10 items-center justify-center rounded-lg bg-accent text-brand'>
          <Icon className='size-5' aria-hidden />
        </span>
        <span
          className='flex items-center gap-1 text-xs text-muted-foreground'
          title={
            mode === 'browser'
              ? 'Runs in your browser'
              : 'Uploads to the conversion server'
          }
        >
          {mode === 'browser' ? (
            <ShieldCheck className='size-3.5 text-success' aria-hidden />
          ) : (
            <Server className='size-3.5' aria-hidden />
          )}
          {mode === 'browser' ? 'On your device' : 'Server'}
        </span>
      </span>
      <h3 className='font-medium group-hover:text-brand'>{task.title}</h3>
      <p className='text-sm text-muted-foreground'>{task.description}</p>
    </Link>
  )
}
