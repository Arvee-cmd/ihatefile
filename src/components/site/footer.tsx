import { Link } from '@tanstack/react-router'
import { Logo } from './logo'

const support = import.meta.env.VITE_SUPPORT_URL

export function SiteFooter() {
  return (
    <footer className='mt-20 border-t'>
      <div className='container grid gap-8 py-10 sm:grid-cols-[1.5fr_1fr_1fr]'>
        <div className='space-y-3'>
          <Logo />
          <p className='max-w-xs text-sm text-muted-foreground'>
            Files in. Formats out. A free converter with no sign-up. Most
            conversions never leave your browser.
          </p>
        </div>
        <nav aria-label='Footer' className='flex flex-col gap-2 text-sm'>
          <Link to='/about' className='hover:underline'>
            About
          </Link>
          <Link to='/privacy' className='hover:underline'>
            Privacy
          </Link>
          <Link to='/terms' className='hover:underline'>
            Terms
          </Link>
          <Link to='/formats' className='hover:underline'>
            Supported formats
          </Link>
        </nav>
        <div className='flex flex-col gap-2 text-sm'>
          {support ? (
            <a
              href={support}
              className='hover:underline'
              rel='noopener noreferrer'
            >
              Support &amp; feedback
            </a>
          ) : (
            <Link to='/about' hash='support' className='hover:underline'>
              Support &amp; feedback
            </Link>
          )}
          <p className='text-muted-foreground'>
            Open source (MIT). Built on the{' '}
            <span className='whitespace-nowrap'>shadcn-admin</span> starter by
            Sat Naing.
          </p>
        </div>
      </div>
    </footer>
  )
}
