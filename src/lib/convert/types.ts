import type { OptionValue, TargetDef } from '@/lib/registry'

export interface ConversionOutput {
  blob: Blob
  filename: string
}

export interface BrowserJob {
  files: File[]
  inputFormat: string
  target: TargetDef
  options: Record<string, OptionValue>
}

/** An error whose message is safe and useful to show to the user. */
export class ConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversionError'
  }
}
