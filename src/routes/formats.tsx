import { createFileRoute } from '@tanstack/react-router'
import { FormatsPage } from '@/features/pages/formats'

export const Route = createFileRoute('/formats')({ component: FormatsPage })
