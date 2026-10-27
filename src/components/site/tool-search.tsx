import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import {
  categories,
  convertSearchFor,
  searchEntries,
  type SearchEntry,
} from '@/lib/registry'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

function useEntries() {
  return useMemo(() => {
    // Collapse "same label" duplicates (e.g. browser + server variants of PNG to JPEG).
    const seen = new Set<string>()
    return [...searchEntries()]
      .sort(
        (a, b) => Number(b.mode === 'browser') - Number(a.mode === 'browser')
      )
      .filter((e) => {
        const dup = seen.has(e.label)
        seen.add(e.label)
        return !dup
      })
  }, [])
}

function Results({ onPick }: { onPick: (e: SearchEntry) => void }) {
  const entries = useEntries()
  return (
    <CommandList>
      <CommandEmpty>
        No matching conversion. Try a format name such as "pdf" or "mp3".
      </CommandEmpty>
      {categories.map((c) => {
        const list = entries.filter((e) => e.category === c.id)
        if (!list.length) return null
        return (
          <CommandGroup key={c.id} heading={c.short}>
            {list.map((e) => (
              <CommandItem
                key={e.id}
                value={`${e.label} ${e.keywords.join(' ')}`}
                onSelect={() => onPick(e)}
              >
                <span className='flex-1 truncate'>{e.label}</span>
                <span className='text-xs text-muted-foreground'>
                  {e.mode === 'browser' ? 'In browser' : 'Server'}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )
      })}
    </CommandList>
  )
}

function usePick() {
  const navigate = useNavigate()
  return (e: SearchEntry) => {
    void navigate({ to: '/convert', search: convertSearchFor(e) })
  }
}

/** Ctrl/⌘+K palette, opened from the header. */
export function ToolSearchDialog() {
  const [open, setOpen] = useState(false)
  const pick = usePick()
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])
  return (
    <>
      <Button
        variant='outline'
        size='sm'
        className='gap-2 text-muted-foreground'
        onClick={() => setOpen(true)}
        aria-label='Search conversions'
      >
        <Search aria-hidden />{' '}
        <span className='hidden sm:inline'>Search tools</span>
        <kbd className='hidden rounded border px-1.5 text-[10px] sm:inline'>
          Ctrl K
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title='Search conversions'
        description='Find a conversion by format or tool name'
      >
        <CommandInput placeholder='Search conversions, e.g. png to webp' />
        <Results
          onPick={(e) => {
            setOpen(false)
            pick(e)
          }}
        />
      </CommandDialog>
    </>
  )
}

/** Visible search field for the home page. */
export function ToolSearchInline() {
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')
  const pick = usePick()
  const show = focused || query.length > 0
  return (
    <Command
      className='relative overflow-visible rounded-lg border bg-card'
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setFocused(false)
      }}
      data-testid='tool-search'
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder='Search conversions, e.g. docx to pdf'
        aria-label='Search conversions'
      />
      {show && (
        <div className='absolute inset-x-0 top-full z-20 mt-1 rounded-lg border bg-popover shadow-md'>
          <Results
            onPick={(e) => {
              setQuery('')
              setFocused(false)
              pick(e)
            }}
          />
        </div>
      )}
    </Command>
  )
}
