import { useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Download,
  FileIcon,
  Loader2,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react'
import type { ServerStatus } from '@/lib/api'
import { downloadBlob } from '@/lib/download'
import { formatBytes } from '@/lib/files/names'
import { choiceByKey, choicesFor, formatLabel } from '@/lib/registry'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { availabilityOf } from './availability'
import { OptionsEditor } from './options-editor'
import { useConverter, type QueueItem } from './store'

const STATUS_LABEL: Record<QueueItem['status'], string> = {
  validating: 'Validating',
  invalid: 'Not supported',
  ready: 'Ready',
  processing: 'Processing',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function phaseText(item: QueueItem): string {
  if (item.phase === 'uploading')
    return item.progress != null
      ? `Uploading ${Math.round(item.progress * 100)}%`
      : 'Uploading'
  if (item.phase === 'processing') return 'Converting on server'
  if (item.phase === 'downloading') return 'Downloading result'
  return 'Converting in your browser'
}

export function FileRow({
  item,
  status,
  onConvert,
  locked,
  combineOnly,
  position,
}: {
  item: QueueItem
  status: ServerStatus
  onConvert: (id: string) => void
  /** Task pages fix the output format, so the picker is replaced by a label. */
  locked?: boolean
  /** Combine tasks (merge, ZIP) only list files; the action lives in the combine panel. */
  combineOnly?: boolean
  position?: { index: number; count: number }
}) {
  const { setChoice, setOption, removeItem, cancel, moveItem } = useConverter()
  const [open, setOpen] = useState(false)
  const choice = item.choiceKey ? choiceByKey(item.choiceKey) : undefined
  const choices = item.format ? choicesFor(item.format) : []
  const busy = item.status === 'processing' || item.status === 'validating'
  const serverMode = choice?.tool.mode === 'server'
  const avail = choice ? availabilityOf(choice, status) : { available: false }
  const canCancel = item.status === 'processing' && serverMode

  return (
    <li
      data-testid='queue-item'
      data-status={item.status}
      className='rounded-xl border bg-card p-4'
    >
      <div className='flex items-start gap-3'>
        <FileIcon
          className='mt-0.5 size-5 shrink-0 text-muted-foreground'
          aria-hidden
        />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
            <p
              className='max-w-full min-w-0 truncate font-medium'
              title={item.file.name}
            >
              {item.file.name}
            </p>
            <Badge variant='secondary'>
              {item.format ? formatLabel(item.format) : 'Unknown'}
            </Badge>
            <span className='text-sm text-muted-foreground'>
              {formatBytes(item.file.size)}
            </span>
          </div>
          <p
            className={cn(
              'mt-1 flex items-center gap-1.5 text-sm',
              item.status === 'failed' || item.status === 'invalid'
                ? 'text-destructive'
                : 'text-muted-foreground'
            )}
            role={item.status === 'failed' ? 'alert' : undefined}
          >
            {item.status === 'processing' && (
              <Loader2 className='size-3.5 animate-spin' aria-hidden />
            )}
            {item.status === 'completed' && (
              <CheckCircle2 className='size-3.5 text-success' aria-hidden />
            )}
            {(item.status === 'failed' || item.status === 'invalid') && (
              <AlertCircle className='size-3.5' aria-hidden />
            )}
            <span data-testid='status'>
              {item.status === 'processing'
                ? phaseText(item)
                : STATUS_LABEL[item.status]}
              {item.message && item.status !== 'processing'
                ? ` — ${item.message}`
                : ''}
            </span>
          </p>
          {item.status === 'processing' && (
            <div
              className='mt-2 h-1.5 overflow-hidden rounded-full bg-muted'
              role='progressbar'
              aria-label={phaseText(item)}
              {...(item.progress != null
                ? {
                    'aria-valuemin': 0,
                    'aria-valuemax': 100,
                    'aria-valuenow': Math.round(item.progress * 100),
                  }
                : {})}
            >
              <div
                className={cn(
                  'h-full rounded-full bg-brand',
                  item.progress == null && 'w-1/3 animate-pulse'
                )}
                style={
                  item.progress != null
                    ? { width: `${item.progress * 100}%` }
                    : undefined
                }
              />
            </div>
          )}
          {item.note && (
            <p className='mt-1 text-xs text-muted-foreground'>{item.note}</p>
          )}
        </div>
        {combineOnly && position && position.count > 1 && (
          <div className='flex'>
            <Button
              variant='ghost'
              size='icon'
              aria-label={`Move ${item.file.name} up`}
              disabled={position.index === 0}
              onClick={() => moveItem(item.id, -1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              aria-label={`Move ${item.file.name} down`}
              disabled={position.index === position.count - 1}
              onClick={() => moveItem(item.id, 1)}
            >
              <ArrowDown />
            </Button>
          </div>
        )}
        <Button
          variant='ghost'
          size='icon'
          aria-label={`Remove ${item.file.name}`}
          onClick={() => removeItem(item.id)}
        >
          <X />
        </Button>
      </div>

      {!combineOnly &&
        item.status !== 'invalid' &&
        item.status !== 'validating' &&
        choice && (
          <div className='mt-4 space-y-3'>
            <div className='flex flex-wrap items-end gap-3'>
              <div className='min-w-0 flex-1 basis-56 space-y-1.5'>
                <label
                  className='text-sm font-medium'
                  htmlFor={`target-${item.id}`}
                >
                  Convert to
                </label>
                {locked ? (
                  <p
                    id={`target-${item.id}`}
                    className='flex h-9 items-center text-sm'
                    data-testid='target-locked'
                  >
                    {choice.target.label}
                  </p>
                ) : (
                  <Select
                    value={item.choiceKey ?? undefined}
                    onValueChange={(v) => setChoice(item.id, v)}
                    disabled={busy}
                  >
                    <SelectTrigger
                      id={`target-${item.id}`}
                      className='w-full'
                      data-testid='target-select'
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {choices.map((c) => {
                        const a = availabilityOf(c, status)
                        return (
                          <SelectItem
                            key={c.key}
                            value={c.key}
                            disabled={!a.available}
                            data-testid={`target-${c.target.id}`}
                          >
                            {c.target.label}
                            {c.tool.mode === 'server' ? ' · server' : ''}
                            {!a.available ? ' — server unavailable' : ''}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Badge
                variant='outline'
                className={cn(
                  'h-9 gap-1.5 px-3',
                  serverMode ? 'border-brand/50 text-brand' : 'text-success'
                )}
                data-testid='mode-note'
              >
                {serverMode ? (
                  <Server className='size-3.5' aria-hidden />
                ) : (
                  <ShieldCheck className='size-3.5' aria-hidden />
                )}
                {serverMode
                  ? 'Uploaded to the conversion server'
                  : 'File never leaves your device'}
              </Badge>
              {canCancel ? (
                <Button variant='outline' onClick={() => cancel(item.id)}>
                  Cancel
                </Button>
              ) : (
                <Button
                  onClick={() => onConvert(item.id)}
                  disabled={busy || !avail.available}
                  data-testid='convert-button'
                >
                  {item.status === 'completed'
                    ? 'Convert again'
                    : item.status === 'failed' || item.status === 'cancelled'
                      ? 'Retry'
                      : 'Convert'}
                </Button>
              )}
            </div>

            {!avail.available && 'reason' in avail && avail.reason && (
              <p className='text-sm text-destructive' role='note'>
                {avail.reason}
              </p>
            )}
            {choice.target.lossy && (
              <p className='text-xs text-muted-foreground'>
                Lossy: {formatLabel(choice.target.format)} output may reduce
                quality or drop features such as transparency or layout.
              </p>
            )}
            {serverMode && (
              <p className='text-xs text-muted-foreground'>
                This file will be sent to the conversion server. It is deleted
                from the server as soon as your result is downloaded.
              </p>
            )}

            {choice.target.options.length > 0 && (
              <Collapsible open={open} onOpenChange={setOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant='ghost' size='sm' className='-ml-2'>
                    Options{' '}
                    <ChevronDown
                      className={cn(
                        'transition-transform',
                        open && 'rotate-180'
                      )}
                      aria-hidden
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className='pt-2'>
                  <OptionsEditor
                    target={choice.target}
                    values={item.options}
                    onChange={(n, v) => setOption(item.id, n, v)}
                    disabled={busy}
                    allowedChoices={status.tools[choice.tool.id]?.optionChoices}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}

      {item.status === 'completed' && item.result && (
        <div
          className='mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent p-3'
          data-testid='result'
        >
          <div className='min-w-0'>
            <p
              className='truncate text-sm font-medium'
              data-testid='result-name'
            >
              {item.result.filename}
            </p>
            <p className='text-xs text-muted-foreground'>
              {formatBytes(item.result.blob.size)}
            </p>
          </div>
          <Button
            onClick={() =>
              downloadBlob(item.result!.blob, item.result!.filename)
            }
            data-testid='download-button'
          >
            <Download /> Download
          </Button>
        </div>
      )}
    </li>
  )
}
