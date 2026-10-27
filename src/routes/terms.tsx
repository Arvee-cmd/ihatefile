import { createFileRoute } from '@tanstack/react-router'
import { TermsPage } from '@/features/pages/static'

export const Route = createFileRoute('/terms')({ component: TermsPage })
