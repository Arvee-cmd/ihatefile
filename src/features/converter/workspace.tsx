import { useEffect, useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { CloudOff, Download, Trash2, Wifi } from 'lucide-react'
import { createZip } from '@/lib/convert/archive'
import { downloadBlob } from '@/lib/download'
import {
  acceptExtensions,
  formatLabel,
  choicesFor,
  getTask,
  getTool,
  taskInputs,
  type ConvertSearch,
} from '@/lib/registry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CombinePanel } from './combine-panel'
import { ConsentDialog } from './consent-dialog'
import { Dropzone } from './dropzone'
import { FileRow } from './file-row'
import { useConverter } from './store'
import { useServerStatus } from './use-server-status'

export function ServerStatusPill() {
  const { status, checking } = useServerStatus()
  if (checking) return <Badge variant='outline'>Checking server…</Badge>
  return status.online ? (
    <Badge
      variant='outline'
      className='gap-1.5 text-success'
      data-testid='server-status'
      data-online='true'
    >
      <Wifi className='size-3.5' aria-hidden /> Server online
    </Badge>
  ) : (
    <Badge
      variant='outline'
      className='gap-1.5'
      data-testid='server-status'
      data-online='false'
      title='Browser-side conversions still work. Server-only conversions are disabled.'
    >
      <CloudOff className='size-3.5' aria-hidden /> Server offline — browser
      tools only
    </Badge>
  )
}

export function Workspace({
  search,
  taskSlug,
}: {
  search: ConvertSearch
  taskSlug?: string
}) {
  const {
    items,
    addFiles,
    clear,
    convertItems,
    setPreselect,
    applyChoiceToAll,
  } = useConverter()
  const { status } = useServerStatus()

  const task = taskSlug ? getTask(taskSlug) : undefined
  const taskTool = task ? getTool(task.tool) : undefined
  const allowed = task ? taskInputs(task) : undefined
  const combineTask = !!taskTool?.combine
  const accept = allowed?.length
    ? acceptExtensions([{ ...taskTool!, inputs: allowed }]).join(',')
    : undefined
  const effTool = task?.tool ?? search.tool
  const effTarget = task?.target ?? search.target
  const effFrom = task ? task.from?.[0] : search.from

  useEffect(() => {
    setPreselect({ tool: effTool, target: effTarget, from: effFrom })
  }, [effTool, effTarget, effFrom, setPreselect])

  const preTool = !task && search.tool ? getTool(search.tool) : undefined
  const preTarget = preTool?.targets.find((t) => t.id === search.target)

  const valid = items.filter((i) => i.format && i.status !== 'invalid')
  const common = useMemo(() => {
    if (valid.length < 2) return []
    const lists = valid.map((i) => choicesFor(i.format!))
    return lists[0].filter((c) =>
      lists.every((l) => l.some((x) => x.target.id === c.target.id))
    )
  }, [valid])
  const ready = items
    .filter(
      (i) =>
        i.status === 'ready' ||
        i.status === 'failed' ||
        i.status === 'cancelled'
    )
    .map((i) => i.id)
  const done = items.filter((i) => i.status === 'completed').length
  const downloadAll = async () => {
    const files = items
      .filter((i) => i.result)
      .map((i) => new File([i.result!.blob], i.result!.filename))
    downloadBlob(await createZip(files), 'ihatefile-converted.zip')
  }
  const busy = items.some((i) => i.status === 'processing')

  return (
    <div className='container py-8 sm:py-12'>
      <div className='mb-6 flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight sm:text-3xl'>
            {task ? task.title : 'Convert files'}
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            {task
              ? task.description
              : 'Add files, pick an output format for each, then convert. Nothing starts automatically.'}
          </p>
        </div>
        <ServerStatusPill />
      </div>

      {preTool && preTarget && (
        <p
          className='mb-4 rounded-lg bg-accent px-4 py-3 text-sm'
          data-testid='preselect'
        >
          Selected:{' '}
          <strong>
            {search.from ? `${formatLabel(search.from)} → ` : ''}
            {preTarget.label}
          </strong>{' '}
          ({preTool.name},{' '}
          {preTool.mode === 'browser'
            ? 'runs in your browser'
            : 'uses the server'}
          ). Add a file to start.{' '}
          <Link to='/convert' className='underline'>
            Clear selection
          </Link>
        </p>
      )}

      <Dropzone
        onFiles={(f) => addFiles(f, status, allowed)}
        accept={accept}
        compact={items.length > 0}
      />

      {items.length > 0 && (
        <div className='mt-8 space-y-4'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <h2 className='text-lg font-semibold'>
              Queue{' '}
              <span className='text-muted-foreground'>({items.length})</span>
            </h2>
            <div className='flex flex-wrap items-center gap-2'>
              {!task && common.length > 0 && (
                <Select onValueChange={applyChoiceToAll}>
                  <SelectTrigger
                    className='w-52'
                    aria-label='Convert all files to'
                  >
                    <SelectValue placeholder='Set all to…' />
                  </SelectTrigger>
                  <SelectContent>
                    {common.map((c) => (
                      <SelectItem key={c.key} value={c.key}>
                        {c.target.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!combineTask && (
                <Button
                  onClick={() => convertItems(ready, status)}
                  disabled={!ready.length || busy}
                  data-testid='convert-all'
                >
                  Convert {ready.length > 1 ? `all (${ready.length})` : ''}
                </Button>
              )}
              {done > 1 && (
                <Button
                  variant='outline'
                  onClick={downloadAll}
                  data-testid='download-all'
                >
                  <Download /> Download all as ZIP
                </Button>
              )}
              <Button variant='outline' onClick={clear}>
                <Trash2 /> Clear queue
              </Button>
            </div>
          </div>
          <ul className='space-y-3' aria-label='File queue'>
            {items.map((item, index) => (
              <FileRow
                key={item.id}
                item={item}
                status={status}
                locked={!!task}
                combineOnly={combineTask}
                position={{ index, count: items.length }}
                onConvert={(id) => convertItems([id], status)}
              />
            ))}
          </ul>
          <CombinePanel onlyTool={task ? task.tool : undefined} />
          <p className='sr-only' aria-live='polite'>
            {done} of {items.length} files converted.
          </p>
        </div>
      )}
      <ConsentDialog status={status} />
    </div>
  )
}
