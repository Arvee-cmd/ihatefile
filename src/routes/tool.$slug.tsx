import { createFileRoute, notFound } from '@tanstack/react-router'
import { getTask } from '@/lib/registry'
import { Workspace } from '@/features/converter/workspace'

export const Route = createFileRoute('/tool/$slug')({
  beforeLoad: ({ params }) => {
    if (!getTask(params.slug)) throw notFound()
  },
  component: function ToolPage() {
    const { slug } = Route.useParams()
    return <Workspace key={slug} search={{}} taskSlug={slug} />
  },
})
