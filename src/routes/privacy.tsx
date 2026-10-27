import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPage } from '@/features/pages/static'

export const Route = createFileRoute('/privacy')({ component: PrivacyPage })
