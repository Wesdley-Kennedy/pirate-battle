import axios from 'axios'
import type { MatchRecord, PaginatedResponse, RankingEntry } from './types'

/**
 * Small Axios client for the ranking/history REST API. Every request is
 * intercepted by MSW (development, tests and the published build alike);
 * no real backend exists.
 */
const api = axios.create({
  baseURL: '/api',
  timeout: 10_000,
})

/**
 * Shape guard: if mocking is unavailable the request can fall through to
 * the SPA server, which answers 200 with HTML. That must surface as a
 * query ERROR (boards show their error state), never as a crash.
 */
function assertPaginated<T>(data: unknown): PaginatedResponse<T> {
  const candidate = data as PaginatedResponse<T> | null
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    !Array.isArray(candidate.items) ||
    typeof candidate.page !== 'number' ||
    typeof candidate.totalPages !== 'number'
  ) {
    throw new Error('Unexpected API response shape')
  }
  return candidate
}

export async function fetchRanking(
  page: number,
  fingerprint: string,
): Promise<PaginatedResponse<RankingEntry>> {
  const response = await api.get<unknown>('/ranking', {
    params: { page, fingerprint },
  })
  return assertPaginated<RankingEntry>(response.data)
}

export async function fetchHistory(
  page: number,
  playerId: string,
): Promise<PaginatedResponse<MatchRecord>> {
  const response = await api.get<unknown>('/history', {
    params: { page, playerId },
  })
  return assertPaginated<MatchRecord>(response.data)
}

export async function registerMatch(record: MatchRecord): Promise<MatchRecord> {
  const response = await api.post<MatchRecord>('/matches', record)
  return response.data
}
