import { createFileRoute } from '@tanstack/react-router'
import { CategoryPage } from '@/features/pages/category'

export const Route = createFileRoute('/tools/$category')({
  component: function Page() {
    const { category } = Route.useParams()
    return <CategoryPage id={category} />
  },
})
