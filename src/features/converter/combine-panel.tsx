import { Download, Layers, Loader2 } from 'lucide-react'
import { downloadBlob } from '@/lib/download'
import { formatBytes } from '@/lib/files/names'
import { combineChoices, defaultOptions, formatLabel } from '@/lib/registry'
import { Button } from '@/components/ui/button'
import { useConverter } from './store'

/** Tools that turn the whole queue into ONE output (merge PDFs, create ZIP). */
export function CombinePanel({ onlyTool }: { onlyTool?: string }) {
  const { items, combo, runCombine, clearCombo } = useConverter()
  const valid = items.filter((i) => i.format && i.status !== 'invalid')
  const choices = combineChoices(valid.map((i) => i.format!))
    .filter((c) => !onlyTool || c.tool.id === onlyTool)
    .filter((c) =>
      c.tool.id === 'pdf-merge' ? valid.length >= 2 : valid.length >= 1
    )
  if (!valid.length || !choices.length) return null
  return (
    <section
      aria-labelledby='combine-h'
      className='rounded-xl border bg-card p-4'
      data-testid='combine-panel'
    >
      <h2
        id='combine-h'
        className='flex items-center gap-2 text-sm font-semibold'
      >
        <Layers className='size-4 text-brand' aria-hidden /> Combine all{' '}
        {valid.length} file{valid.length === 1 ? '' : 's'}
      </h2>
      <p className='mt-1 text-sm text-muted-foreground'>
        Runs in your browser. Files are combined in queue order.
      </p>
      <div className='mt-3 space-y-3'>
        {choices.map((c) => {
          const state = combo[c.key]
          const values = defaultOptions(c.target)
          return (
            <div key={c.key} className='space-y-2'>
              <div className='flex flex-wrap items-center gap-3'>
                <Button
                  variant='outline'
                  disabled={state?.status === 'processing'}
                  onClick={() => runCombine(c.key, values)}
                  data-testid={`combine-${c.tool.id}`}
                >
                  {state?.status === 'processing' && (
                    <Loader2 className='animate-spin' />
                  )}
                  {c.tool.id === 'pdf-merge'
                    ? `Merge ${valid.length} PDFs into one`
                    : `Create ZIP of ${valid.length} file${valid.length === 1 ? '' : 's'}`}
                </Button>
                <span className='text-xs text-muted-foreground'>
                  {c.tool.name} · {formatLabel(c.target.format)}
                </span>
              </div>
              {state?.status === 'failed' && (
                <p role='alert' className='text-sm text-destructive'>
                  {state.message}
                </p>
              )}
              {state?.status === 'completed' && state.result && (
                <div
                  className='flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent p-3'
                  data-testid='combined-result'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium'>
                      {state.result.filename}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {formatBytes(state.result.blob.size)}
                    </p>
                  </div>
                  <div className='flex gap-2'>
                    <Button
                      onClick={() =>
                        downloadBlob(state.result!.blob, state.result!.filename)
                      }
                    >
                      <Download /> Download
                    </Button>
                    <Button variant='ghost' onClick={() => clearCombo(c.key)}>
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
