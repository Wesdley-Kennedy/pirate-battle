import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchHistory, fetchRanking, registerMatch } from './client'

/**
 * TanStack Query layer for the two menu tabs and match registration.
 * Pagination keeps the previous page on screen while the next one loads;
 * a successful registration invalidates both tabs so they refetch the
 * fresh data the next time they are shown.
 */
export function useRankingQuery(fingerprint: string, page: number) {
  return useQuery({
    queryKey: ['ranking', fingerprint, page],
    queryFn: () => fetchRanking(page, fingerprint),
    placeholderData: keepPreviousData,
  })
}

export function useHistoryQuery(playerId: string, page: number) {
  return useQuery({
    queryKey: ['history', playerId, page],
    queryFn: () => fetchHistory(page, playerId),
    placeholderData: keepPreviousData,
  })
}

export function useRegisterMatchMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: registerMatch,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ranking'] })
      void queryClient.invalidateQueries({ queryKey: ['history'] })
    },
  })
}
