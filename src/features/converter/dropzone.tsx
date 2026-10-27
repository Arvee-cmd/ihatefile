import { useId, useRef, useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  accept?: string
  compact?: boolean
  disabled?: boolean
  hint?: string
  className?: string
}

export function Dropzone({
  onFiles,
  accept,
  compact,
  disabled,
  hint,
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const hintId = useId()
  const open = () => !disabled && inputRef.current?.click()

  return (
    <div
      data-testid='dropzone'
      data-dragging={dragging}
      onClick={open}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (disabled) return
        const files = Array.from(e.dataTransfer.files)
        if (files.length) onFiles(files)
      }}
      className={cn(
        'flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed bg-card px-4 text-center transition-colors',
        dragging
          ? 'border-brand bg-accent'
          : 'border-input hover:border-brand/60',
        compact ? 'py-6' : 'py-12 sm:py-16',
        disabled && 'pointer-events-none opacity-60',
        className
      )}
    >
      <UploadCloud
        className={cn('text-brand', compact ? 'size-6' : 'size-10')}
        aria-hidden
      />
      <div className='space-y-1'>
        <p className={cn('font-medium', compact ? 'text-sm' : 'text-lg')}>
          {dragging ? 'Drop to add' : 'Drop files here'}
        </p>
        <p id={hintId} className='text-sm text-muted-foreground'>
          {hint ??
            'Files are checked on your device first. Nothing is uploaded until you choose a server conversion and confirm.'}
        </p>
      </div>
      <Button
        type='button'
        aria-describedby={hintId}
        size={compact ? 'sm' : 'lg'}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          open()
        }}
      >
        Browse files
      </Button>
      <input
        ref={inputRef}
        type='file'
        multiple
        accept={accept}
        className='sr-only'
        tabIndex={-1}
        aria-label='Choose files'
        data-testid='file-input'
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = '' // allow re-selecting the same file
        }}
      />
    </div>
  )
}
