import {
  configFingerprint,
  type MatchRecord,
  type PaginatedResponse,
  type RankingEntry,
} from '../api/types'

/**
 * Data layer behind the MSW handlers. Confirmed records persist in
 * localStorage so they survive a refresh — in development, tests and the
 * published build alike. The list/sort/paginate helpers are pure and
 * unit-tested; only the load/save glue touches storage (guarded, like
 * every other adapter in the project).
 */
export const MOCK_MATCHES_KEY = 'pirate-battle:mock-matches'
export const MOCK_SCENARIO_KEY = 'pirate-battle:mock-scenario'
export const MOCK_PAGE_SIZE = 5

export type MockScenario = 'success' | 'empty' | 'error' | 'slow'

const DEFAULT_CONFIG = { sessionDurationSeconds: 120, enemySpawnIntervalSeconds: 5 }

/** Fictional opponents for the leaderboard, all on the default options
 * (120 s / 5 s). Scurvy Sam has two matches on purpose: the ranking must
 * keep only each player's best. */
export const MOCK_FIXTURES: readonly MatchRecord[] = [
  fixture('scurvy-sam', 'Scurvy Sam', 11, '2026-09-18T14:05:00.000Z', 120),
  fixture('scurvy-sam', 'Scurvy Sam', 7, '2026-09-15T10:30:00.000Z', 120),
  fixture('ironhook-ida', 'Ironhook Ida', 9, '2026-09-20T19:45:00.000Z', 120),
  fixture('salty-jack', 'Salty Jack', 8, '2026-09-12T08:20:00.000Z', 97, 'player-death'),
  fixture('stormy-finn', 'Stormy Finn', 8, '2026-09-19T21:10:00.000Z', 120),
  fixture('one-eye-olga', 'One-Eye Olga', 6, '2026-09-21T16:00:00.000Z', 120),
  fixture('barnacle-bart', 'Barnacle Bart', 4, '2026-09-14T12:40:00.000Z', 64, 'player-death'),
  fixture('powder-peg', 'Powder Peg', 2, '2026-09-17T09:15:00.000Z', 120),
]

function fixture(
  playerId: string,
  playerName: string,
  score: number,
  completedAt: string,
  durationPlayedSeconds: number,
  endReason: MatchRecord['endReason'] = 'time-expired',
): MatchRecord {
  return {
    matchId: `${playerId}-${completedAt}`,
    playerId,
    playerName,
    completedAt,
    score,
    durationPlayedSeconds,
    endReason,
    config: { ...DEFAULT_CONFIG },
  }
}

/* ---------- pure helpers ---------- */

/** Adds a record unless its matchId already exists; re-sends always
 * recover the existing record instead of duplicating it. */
export function upsertMatch(
  matches: readonly MatchRecord[],
  record: MatchRecord,
): { matches: MatchRecord[]; record: MatchRecord; created: boolean } {
  const existing = matches.find((entry) => entry.matchId === record.matchId)
  if (existing) return { matches: [...matches], record: existing, created: false }
  return { matches: [...matches, record], record, created: true }
}

/**
 * Leaderboard for one config fingerprint: each player's best match
 * (higher score wins; ties go to the earlier completion), then sorted by
 * score DESC with completedAt ASC / matchId as deterministic tiebreaks.
 */
export function buildRanking(
  matches: readonly MatchRecord[],
  fingerprint: string,
): RankingEntry[] {
  const bestByPlayer = new Map<string, MatchRecord>()
  for (const match of matches) {
    if (configFingerprint(match.config) !== fingerprint) continue
    const best = bestByPlayer.get(match.playerId)
    if (!best || beatsForRanking(match, best)) bestByPlayer.set(match.playerId, match)
  }
  return [...bestByPlayer.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.completedAt !== b.completedAt) return a.completedAt < b.completedAt ? -1 : 1
      return a.matchId < b.matchId ? -1 : 1
    })
    .map((match, index) => ({
      rank: index + 1,
      playerId: match.playerId,
      playerName: match.playerName,
      score: match.score,
      completedAt: match.completedAt,
    }))
}

function beatsForRanking(candidate: MatchRecord, best: MatchRecord): boolean {
  if (candidate.score !== best.score) return candidate.score > best.score
  return candidate.completedAt < best.completedAt
}

/** One player's matches, most recent first. */
export function buildHistory(
  matches: readonly MatchRecord[],
  playerId: string,
): MatchRecord[] {
  return matches
    .filter((match) => match.playerId === playerId)
    .sort((a, b) => (a.completedAt > b.completedAt ? -1 : a.completedAt < b.completedAt ? 1 : 0))
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number = MOCK_PAGE_SIZE,
): PaginatedResponse<T> {
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
  }
}

/* ---------- storage glue ---------- */

export function loadMockMatches(): MatchRecord[] {
  try {
    const raw = localStorage.getItem(MOCK_MATCHES_KEY)
    if (!raw) return [...MOCK_FIXTURES]
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...MOCK_FIXTURES]
    const valid = parsed.filter(
      (entry): entry is MatchRecord =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as MatchRecord).matchId === 'string' &&
        typeof (entry as MatchRecord).score === 'number' &&
        typeof (entry as MatchRecord).config === 'object',
    )
    return valid
  } catch {
    return [...MOCK_FIXTURES]
  }
}

export function saveMockMatches(matches: readonly MatchRecord[]): void {
  try {
    localStorage.setItem(MOCK_MATCHES_KEY, JSON.stringify(matches))
  } catch {
    // Storage unavailable: records just will not survive a refresh.
  }
}

export function getMockScenario(): MockScenario {
  try {
    const raw = localStorage.getItem(MOCK_SCENARIO_KEY)
    return raw === 'empty' || raw === 'error' || raw === 'slow' ? raw : 'success'
  } catch {
    return 'success'
  }
}

export function setMockScenario(scenario: MockScenario): void {
  try {
    localStorage.setItem(MOCK_SCENARIO_KEY, scenario)
  } catch {
    // Ignore: the selector simply will not persist.
  }
}

/** Back to the initial state: fixture data, success scenario. */
export function resetMockData(): void {
  try {
    localStorage.removeItem(MOCK_MATCHES_KEY)
    localStorage.removeItem(MOCK_SCENARIO_KEY)
  } catch {
    // Ignore.
  }
}
