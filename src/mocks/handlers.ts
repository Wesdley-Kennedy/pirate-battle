import { delay, http, HttpResponse } from 'msw'
import type { MatchRecord } from '../api/types'
import {
  buildHistory,
  buildRanking,
  getMockScenario,
  loadMockMatches,
  paginate,
  saveMockMatches,
  upsertMatch,
} from './mockDb'

/**
 * MSW handlers for the ranking/history API, shared by development, the
 * published build and the Playwright tests. The active scenario comes
 * from localStorage (set via the Main Menu selector or directly in
 * tests):
 *   success — real mock data        · empty — lists come back empty
 *   error   — every call fails 503  · slow  — success after ~1.5 s
 */
const SLOW_DELAY_MS = 1500

async function applyScenario(): Promise<Response | null> {
  const scenario = getMockScenario()
  if (scenario === 'slow') await delay(SLOW_DELAY_MS)
  if (scenario === 'error') {
    return HttpResponse.json({ message: 'Mock scenario: service unavailable' }, { status: 503 })
  }
  return null
}

export const handlers = [
  http.get('/api/ranking', async ({ request }) => {
    const failure = await applyScenario()
    if (failure) return failure
    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '1')
    const fingerprint = url.searchParams.get('fingerprint') ?? ''
    if (getMockScenario() === 'empty') return HttpResponse.json(paginate([], page))
    return HttpResponse.json(paginate(buildRanking(loadMockMatches(), fingerprint), page))
  }),

  http.get('/api/history', async ({ request }) => {
    const failure = await applyScenario()
    if (failure) return failure
    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '1')
    const playerId = url.searchParams.get('playerId') ?? ''
    if (getMockScenario() === 'empty') return HttpResponse.json(paginate([], page))
    return HttpResponse.json(paginate(buildHistory(loadMockMatches(), playerId), page))
  }),

  http.post('/api/matches', async ({ request }) => {
    const failure = await applyScenario()
    if (failure) return failure
    const record = (await request.json()) as MatchRecord
    if (typeof record?.matchId !== 'string' || record.matchId.length === 0) {
      return HttpResponse.json({ message: 'matchId is required' }, { status: 400 })
    }
    const result = upsertMatch(loadMockMatches(), record)
    if (result.created) saveMockMatches(result.matches)
    return HttpResponse.json(result.record, { status: result.created ? 201 : 200 })
  }),
]
