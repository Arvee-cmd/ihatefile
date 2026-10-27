import { z } from 'zod'
import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '@/features/converter/workspace'

const searchSchema = z.object({
  tool: z.string().optional().catch(undefined),
  target: z.string().optional().catch(undefined),
  from: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/convert')({
  validateSearch: searchSchema,
  component: function ConvertPage() {
    const search = Route.useSearch()
    return <Workspace search={search} />
  },
})
