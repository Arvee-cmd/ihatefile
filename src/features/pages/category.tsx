import { Link, notFound, useNavigate } from '@tanstack/react-router'
import {
  getCategory,
  tasks,
  formatLabel,
  sourcesOf,
  toolsInCategory,
  type ToolDef,
} from '@/lib/registry'
import { Badge } from '@/components/ui/badge'
import { TaskTile } from '@/components/site/task-tile'
import { availabilityOf } from '@/features/converter/availability'
import { Dropzone } from '@/features/converter/dropzone'
import { useConverter } from '@/features/converter/store'
import { useServerStatus } from '@/features/converter/use-server-status'

function ToolCard({ tool }: { tool: ToolDef }) {
  const { status } = useServerStatus()
  return (
    <article className='rounded-xl border bg-card p-5' data-testid='tool-card'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='font-medium'>{tool.name}</h3>
        <Badge variant='outline'>
          {tool.mode === 'browser' ? 'In your browser' : 'Server upload'}
        </Badge>
        <span className='text-xs text-muted-foreground'>{tool.engine}</span>
      </div>
      <ul className='mt-4 space-y-2'>
        {tool.targets.map((t) => {
          const sources = tool.inputs.includes('*') ? ['*'] : sourcesOf(tool, t)
          const a = availabilityOf({ key: '', tool, target: t }, status)
          return (
            <li
              key={t.id}
              className='flex flex-wrap items-baseline justify-between gap-2 text-sm'
            >
              <span>
                <span className='text-muted-foreground'>
                  {sources
                    .map((s) => (s === '*' ? 'Any files' : formatLabel(s)))
                    .join(', ')}
                </span>{' '}
                → <strong>{t.label}</strong>
              </span>
              {a.available ? (
                <Link
                  to='/convert'
                  search={{ tool: tool.id, target: t.id }}
                  className='text-brand underline-offset-4 hover:underline'
                >
                  Use
                </Link>
              ) : (
                <span className='text-xs text-muted-foreground'>
                  Unavailable: server offline or lacks the engine
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {tool.notes.length > 0 && (
        <details className='mt-4 text-sm'>
          <summary className='cursor-pointer text-muted-foreground'>
            Limitations
          </summary>
          <ul className='mt-2 list-disc space-y-1 ps-5 text-muted-foreground'>
            {tool.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}

export function CategoryPage({ id }: { id: string }) {
  const category = getCategory(id)
  if (!category) throw notFound()
  const list = toolsInCategory(id)
  const { status } = useServerStatus()
  const addFiles = useConverter((s) => s.addFiles)
  const navigate = useNavigate()
  return (
    <div className='container py-10'>
      <h1 className='text-3xl font-semibold tracking-tight'>{category.name}</h1>
      <p className='mt-2 max-w-2xl text-muted-foreground'>
        {category.description}
      </p>
      <div className='mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
        {tasks
          .filter((t) => t.category === id)
          .map((t) => (
            <TaskTile key={t.slug} task={t} />
          ))}
      </div>
      <h2 className='mt-10 text-xl font-semibold'>Details and limitations</h2>
      <div className='mt-4'>
        <Dropzone
          compact
          onFiles={async (f) => {
            await addFiles(f, status)
            void navigate({ to: '/convert' })
          }}
        />
      </div>
      <div className='mt-8 grid gap-4 lg:grid-cols-2'>
        {list.map((t) => (
          <ToolCard key={t.id} tool={t} />
        ))}
      </div>
    </div>
  )
}
