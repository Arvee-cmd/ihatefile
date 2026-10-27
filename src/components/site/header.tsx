import { Link } from '@tanstack/react-router'
import { ChevronDown, Menu } from 'lucide-react'
import { categories } from '@/lib/registry'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { ThemeSwitch } from '@/components/theme-switch'
import { Logo } from './logo'
import { ToolSearchDialog } from './tool-search'

const linkClass =
  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground [&.active]:text-foreground'

export function SiteHeader() {
  return (
    <header className='sticky top-0 z-30 border-b bg-background/90 backdrop-blur'>
      <div className='container flex h-14 items-center gap-2'>
        <Logo className='me-2' />
        <nav aria-label='Main' className='hidden items-center md:flex'>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='text-muted-foreground'
              >
                Tools <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              {categories.map((c) => (
                <DropdownMenuItem key={c.id} asChild>
                  <Link to='/tools/$category' params={{ category: c.id }}>
                    {c.name}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link to='/convert' className={linkClass}>
            Convert
          </Link>
          <Link to='/formats' className={linkClass}>
            Formats
          </Link>
          <Link to='/privacy' className={linkClass}>
            Privacy
          </Link>
        </nav>
        <div className='ms-auto flex items-center gap-2'>
          <ToolSearchDialog />
          <ThemeSwitch />
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='md:hidden'
                aria-label='Open menu'
              >
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side='right' className='w-72'>
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav aria-label='Mobile' className='flex flex-col gap-1 px-4'>
                <Link to='/convert' className={linkClass}>
                  Convert
                </Link>
                {categories.map((c) => (
                  <Link
                    key={c.id}
                    to='/tools/$category'
                    params={{ category: c.id }}
                    className={linkClass}
                  >
                    {c.name}
                  </Link>
                ))}
                <Link to='/formats' className={linkClass}>
                  Formats
                </Link>
                <Link to='/privacy' className={linkClass}>
                  Privacy
                </Link>
                <Link to='/terms' className={linkClass}>
                  Terms
                </Link>
                <Link to='/about' className={linkClass}>
                  About
                </Link>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
