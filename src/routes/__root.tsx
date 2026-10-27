import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { SiteFooter } from '@/components/site/footer'
import { SiteHeader } from '@/components/site/header'
import { SkipToMain } from '@/components/skip-to-main'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: () => (
    <>
      <NavigationProgress />
      <SkipToMain />
      <SiteHeader />
      <main id='content' tabIndex={-1} className='outline-none'>
        <Outlet />
      </main>
      <SiteFooter />
      <Toaster duration={5000} />
    </>
  ),
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})
