import { useQuery } from '@tanstack/react-query'
import { OFFLINE, fetchServerStatus, type ServerStatus } from '@/lib/api'

export function useServerStatus(): { status: ServerStatus; checking: boolean } {
  const q = useQuery({
    queryKey: ['server-status'],
    queryFn: ({ signal }) => fetchServerStatus(signal),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  return { status: q.data ?? OFFLINE, checking: q.isPending }
}
