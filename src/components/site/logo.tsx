import { Link } from '@tanstack/react-router'

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      to='/'
      className={`inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${className ?? ''}`}
      aria-label='ihatefile home'
    >
      <svg viewBox='0 0 64 64' className='size-7' aria-hidden>
        <rect width='64' height='64' rx='14' fill='var(--brand)' />
        <path
          d='M20 14h17l9 9v27a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V16a2 2 0 0 1 2-2z'
          fill='var(--background)'
        />
        <path
          d='M24 37h16m-6-5 6 5-6 5'
          fill='none'
          stroke='var(--brand)'
          strokeWidth='3.2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
      <span className='text-lg font-semibold tracking-tight'>
        ihate<span className='text-brand'>file</span>
      </span>
    </Link>
  )
}
