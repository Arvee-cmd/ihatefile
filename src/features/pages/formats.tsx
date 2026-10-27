import { formatLabel, getCategory, sourcesOf, tools } from '@/lib/registry'
import { Badge } from '@/components/ui/badge'
import { availabilityOf } from '@/features/converter/availability'
import { useServerStatus } from '@/features/converter/use-server-status'
import { ServerStatusPill } from '@/features/converter/workspace'

const UNSUPPORTED = [
  'PDF to flowing, fully editable Word paragraphs and Word tables (PDF to Word keeps the look but uses positioned text boxes); PDF to Excel/PowerPoint',
  'HTML to PDF with JavaScript or modern CSS, and converting a live web address',
  'Handwriting recognition and OCR in languages that are not installed on the server',
  'Redacting, signing, unlocking, protecting or repairing PDFs',
  'Legacy Office formats (DOC, XLS, PPT) and Apple iWork formats',
  'HEIC/HEIF, AVIF and SVG images, RAW camera formats',
  'RAR, 7z and archive extraction to individual files',
  'Password-protected PDFs and archives',
  'YAML, TOML, Excel-to-CSV and JSON-to-XML data conversions',
]

export function FormatsPage() {
  const { status } = useServerStatus()
  return (
    <div className='container py-10'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h1 className='text-3xl font-semibold tracking-tight'>
          Supported conversions
        </h1>
        <ServerStatusPill />
      </div>
      <p className='mt-2 max-w-2xl text-muted-foreground'>
        Generated from the same registry the converter and the server use, so
        this list is exactly what works. Server availability is checked live.
      </p>
      <div className='mt-8 overflow-x-auto rounded-xl border'>
        <table
          className='w-full min-w-[640px] text-sm'
          data-testid='formats-table'
        >
          <caption className='sr-only'>Supported conversions by tool</caption>
          <thead className='bg-muted text-left'>
            <tr>
              <th scope='col' className='p-3'>
                Tool
              </th>
              <th scope='col' className='p-3'>
                From
              </th>
              <th scope='col' className='p-3'>
                To
              </th>
              <th scope='col' className='p-3'>
                Runs
              </th>
              <th scope='col' className='p-3'>
                Max size
              </th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => {
              const ok = t.targets.some(
                (tg) =>
                  availabilityOf({ key: '', tool: t, target: tg }, status)
                    .available
              )
              const from = t.inputs.includes('*')
                ? 'Any file'
                : [...new Set(t.targets.flatMap((tg) => sourcesOf(t, tg)))]
                    .map(formatLabel)
                    .join(', ')
              return (
                <tr
                  key={t.id}
                  className='border-t align-top'
                  data-testid='format-row'
                >
                  <th scope='row' className='p-3 text-left font-medium'>
                    {t.name}
                    <div className='text-xs font-normal text-muted-foreground'>
                      {getCategory(t.category)?.short} · {t.engine}
                    </div>
                  </th>
                  <td className='p-3'>{from}</td>
                  <td className='p-3'>
                    {t.targets.map((tg) => tg.label).join(', ')}
                  </td>
                  <td className='p-3'>
                    <Badge variant='outline'>
                      {t.mode === 'browser' ? 'Browser' : 'Server'}
                    </Badge>
                    {!ok && (
                      <div className='mt-1 text-xs text-destructive'>
                        Unavailable now
                      </div>
                    )}
                  </td>
                  <td className='p-3 whitespace-nowrap'>{t.maxFileMB} MB</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h2 className='mt-10 text-xl font-semibold'>Limitations by tool</h2>
      <div className='mt-4 grid gap-4 md:grid-cols-2'>
        {tools.map((t) => (
          <div key={t.id} className='rounded-xl border p-4'>
            <h3 className='font-medium'>{t.name}</h3>
            <ul className='mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground'>
              {t.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <h2 className='mt-10 text-xl font-semibold'>Not supported</h2>
      <ul
        className='mt-3 list-disc space-y-1 ps-5 text-sm text-muted-foreground'
        data-testid='unsupported-list'
      >
        {UNSUPPORTED.map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
    </div>
  )
}
