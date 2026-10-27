import { useEffect, useId } from 'react'
import { optionDefs, type OptionValue, type TargetDef } from '@/lib/registry'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

interface Props {
  target: TargetDef
  values: Record<string, OptionValue>
  onChange: (name: string, value: OptionValue) => void
  disabled?: boolean
  /** Restricts select options to the values the server reports it supports. */
  allowedChoices?: Record<string, string[]>
}

function Field({
  name,
  values,
  onChange,
  disabled,
  allowedChoices,
}: Omit<Props, 'target'> & { name: string }) {
  const def = optionDefs[name]
  const id = useId()
  const value = values[name] ?? def.default
  const allowed = allowedChoices?.[name]
  const help = def.help ? (
    <p className='text-xs text-muted-foreground'>{def.help}</p>
  ) : null
  switch (def.type) {
    case 'range':
      return (
        <div className='space-y-1.5'>
          <Label htmlFor={id}>
            {def.label}: <span className='tabular-nums'>{String(value)}</span>
          </Label>
          <input
            id={id}
            type='range'
            min={def.min}
            max={def.max}
            step={def.step ?? 1}
            value={Number(value)}
            disabled={disabled}
            onChange={(e) => onChange(name, Number(e.target.value))}
            className='w-full accent-[var(--brand)]'
          />
          {help}
        </div>
      )
    case 'number':
      return (
        <div className='space-y-1.5'>
          <Label htmlFor={id}>{def.label}</Label>
          <Input
            id={id}
            type='number'
            inputMode='numeric'
            min={def.min}
            max={def.max}
            value={Number(value)}
            disabled={disabled}
            onChange={(e) => {
              const n = Math.max(
                def.min,
                Math.min(def.max, Math.floor(Number(e.target.value) || 0))
              )
              onChange(name, n)
            }}
          />
          {help}
        </div>
      )
    case 'select':
      return (
        <div className='space-y-1.5'>
          <Label htmlFor={id}>{def.label}</Label>
          <Select
            value={String(value)}
            onValueChange={(v) => onChange(name, v)}
            disabled={disabled}
          >
            <SelectTrigger id={id} className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {def.choices
                .filter((c) => !allowed || allowed.includes(c.value))
                .map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {help}
        </div>
      )
    case 'boolean':
      return (
        <div className='flex items-center justify-between gap-3 pt-5'>
          <Label htmlFor={id}>{def.label}</Label>
          <Switch
            id={id}
            checked={Boolean(value)}
            onCheckedChange={(v) => onChange(name, v)}
            disabled={disabled}
          />
        </div>
      )
    case 'color':
      return (
        <div className='space-y-1.5'>
          <Label htmlFor={id}>{def.label}</Label>
          <input
            id={id}
            type='color'
            value={String(value)}
            disabled={disabled}
            onChange={(e) => onChange(name, e.target.value)}
            className='block h-9 w-16 cursor-pointer rounded-md border bg-transparent p-1'
          />
          {help}
        </div>
      )
    case 'text':
      return (
        <div className='space-y-1.5'>
          <Label htmlFor={id}>{def.label}</Label>
          <Input
            id={id}
            value={String(value)}
            placeholder={def.placeholder}
            maxLength={200}
            disabled={disabled}
            onChange={(e) => onChange(name, e.target.value)}
          />
          {help}
        </div>
      )
  }
}

export function OptionsEditor({
  target,
  values,
  onChange,
  disabled,
  allowedChoices,
}: Props) {
  // If the server cannot honour the current value (e.g. a language pack is not installed), pick one it can.
  useEffect(() => {
    for (const name of target.options) {
      const allowed = allowedChoices?.[name]
      const current = String(values[name] ?? optionDefs[name].default)
      if (allowed?.length && !allowed.includes(current))
        onChange(name, allowed[0])
    }
  }, [allowedChoices, target, values, onChange])
  if (!target.options.length) return null
  return (
    <div className='grid gap-4 sm:grid-cols-2' data-testid='options'>
      {target.options.map((name) => (
        <Field
          key={name}
          name={name}
          values={values}
          onChange={onChange}
          disabled={disabled}
          allowedChoices={allowedChoices}
        />
      ))}
    </div>
  )
}
