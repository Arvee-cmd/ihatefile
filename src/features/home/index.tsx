import { Link } from '@tanstack/react-router'
import { Server, ShieldCheck } from 'lucide-react'
import { categories, formats, popularTasks, tasks, tools } from '@/lib/registry'
import { TaskTile } from '@/components/site/task-tile'
import { ToolSearchInline } from '@/components/site/tool-search'

export function Home() {
  const browserTools = tools.filter((t) => t.mode === 'browser')
  const serverTools = tools.filter((t) => t.mode === 'server')

  return (
    <>
      <section className='container pt-12 pb-6 sm:pt-16'>
        <div className='mx-auto max-w-3xl text-center'>
          <h1 className='text-4xl font-semibold tracking-tight text-balance sm:text-6xl'>
            Files in. <span className='text-brand'>Formats out.</span>
          </h1>
          <p className='mx-auto mt-4 max-w-xl text-lg text-balance text-muted-foreground'>
            Every tool you need to convert and manage files, free and with no
            sign-up. Most run right in your browser; heavier jobs use a server,
            and we always tell you first.
          </p>
        </div>
        <div className='mx-auto mt-8 max-w-2xl space-y-4'>
          <ToolSearchInline />
          <div
            className='flex flex-wrap items-center justify-center gap-2'
            aria-label='Popular conversions'
          >
            <span className='text-sm text-muted-foreground'>Popular:</span>
            {popularTasks.map((t) => (
              <Link
                key={t.slug}
                to='/tool/$slug'
                params={{ slug: t.slug }}
                className='rounded-full border px-3 py-1 text-sm hover:border-brand hover:text-brand'
              >
                {t.title}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className='container py-8' aria-labelledby='cats-h'>
        <h2 id='cats-h' className='sr-only'>
          Browse by category
        </h2>
        <nav
          aria-label='Categories'
          className='flex flex-wrap justify-center gap-2'
        >
          {categories.map((c) => (
            <Link
              key={c.id}
              to='/tools/$category'
              params={{ category: c.id }}
              className='rounded-full bg-secondary px-4 py-1.5 text-sm font-medium hover:bg-accent hover:text-brand'
            >
              {c.short}
            </Link>
          ))}
        </nav>
      </section>

      <section className='container pb-6' aria-labelledby='tools-h'>
        <h2 id='tools-h' className='mb-6 text-2xl font-semibold tracking-tight'>
          All tools
        </h2>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {tasks.map((t) => (
            <TaskTile key={t.slug} task={t} />
          ))}
        </div>
        <p className='mt-4 text-sm text-muted-foreground'>
          Need something else? The{' '}
          <Link to='/convert' className='underline'>
            general converter
          </Link>{' '}
          lets you drop any supported files and choose the output per file.
        </p>
      </section>

      <section className='container py-10' aria-labelledby='how-h'>
        <h2 id='how-h' className='mb-6 text-2xl font-semibold tracking-tight'>
          How it works
        </h2>
        <ol className='grid gap-4 sm:grid-cols-3'>
          {[
            [
              '1',
              'Add files',
              'Drop them in or browse. We check the type on your device first.',
            ],
            [
              '2',
              'Choose a format',
              'Only conversions that really exist are offered, each marked as browser or server.',
            ],
            [
              '3',
              'Convert and download',
              'You see real progress and get the actual converted file.',
            ],
          ].map(([n, t, d]) => (
            <li key={n} className='rounded-xl border bg-card p-5'>
              <span className='flex size-8 items-center justify-center rounded-full bg-accent font-semibold text-brand'>
                {n}
              </span>
              <h3 className='mt-3 font-medium'>{t}</h3>
              <p className='mt-1 text-sm text-muted-foreground'>{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className='container py-10' aria-labelledby='priv-h'>
        <h2 id='priv-h' className='mb-6 text-2xl font-semibold tracking-tight'>
          Where your files go
        </h2>
        <div className='grid gap-4 md:grid-cols-2'>
          <div className='rounded-xl border bg-card p-5'>
            <h3 className='flex items-center gap-2 font-medium'>
              <ShieldCheck className='size-5 text-success' aria-hidden /> In
              your browser — not uploaded
            </h3>
            <p className='mt-2 text-sm text-muted-foreground'>
              These run entirely on your device. You can verify it: they keep
              working with the network off.
            </p>
            <ul className='mt-3 list-disc space-y-1 ps-5 text-sm'>
              {browserTools.map((t) => (
                <li key={t.id}>{t.name}</li>
              ))}
            </ul>
          </div>
          <div className='rounded-xl border bg-card p-5'>
            <h3 className='flex items-center gap-2 font-medium'>
              <Server className='size-5 text-brand' aria-hidden /> On the server
              — uploaded
            </h3>
            <p className='mt-2 text-sm text-muted-foreground'>
              These need engines like LibreOffice or FFmpeg. We ask before
              uploading, delete the upload once converted, and delete the result
              when you download it (or within minutes).
            </p>
            <ul className='mt-3 list-disc space-y-1 ps-5 text-sm'>
              {serverTools.map((t) => (
                <li key={t.id}>{t.name}</li>
              ))}
            </ul>
          </div>
        </div>
        <p className='mt-4 text-sm text-muted-foreground'>
          Details on the{' '}
          <Link to='/privacy' className='underline'>
            privacy page
          </Link>
          .
        </p>
      </section>

      <section className='container py-10' aria-labelledby='fmt-h'>
        <h2 id='fmt-h' className='mb-2 text-2xl font-semibold tracking-tight'>
          Supported formats
        </h2>
        <p className='mb-6 text-sm text-muted-foreground'>
          Not every format converts to every other; see the{' '}
          <Link to='/formats' className='underline'>
            full matrix
          </Link>{' '}
          for exact pairs and limitations.
        </p>
        <div className='flex flex-wrap gap-2'>
          {Object.entries(formats).map(([id, f]) => (
            <span key={id} className='rounded-md border px-2 py-1 text-sm'>
              {f.label}
            </span>
          ))}
        </div>
      </section>
    </>
  )
}
