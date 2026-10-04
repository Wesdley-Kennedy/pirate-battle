import type { EndReason } from '../game/core/gameSession'

/**
 * Typed contracts shared by the HTTP client, the TanStack Query hooks
 * and the MSW handlers (single source of truth for all three).
 *
 * There is no authentication in this challenge: the local player is a
 * fixed, documented identity. Everyone else in the ranking comes from
 * fixtures.
 */
export const LOCAL_PLAYER_ID = 'local-player'
export const LOCAL_PLAYER_NAME = 'Player'

/** Results are only comparable between matches played under the same
 * exposed options; this is the two-field fingerprint used for that. */
export interface MatchConfigSummary {
  sessionDurationSeconds: number
  enemySpawnIntervalSeconds: number
}

export function configFingerprint(config: MatchConfigSummary): string {
  return `${config.sessionDurationSeconds}s-${config.enemySpawnIntervalSeconds}s`
}

export interface MatchRecord {
  /** Deterministic per completed match (player id + completion instant),
   * so re-sending the same completion can never create a duplicate. */
  matchId: string
  playerId: string
  playerName: string
  completedAt: string
  score: number
  durationPlayedSeconds: number
  endReason: EndReason
  config: MatchConfigSummary
}

export interface RankingEntry {
  rank: number
  playerId: string
  playerName: string
  score: number
  completedAt: string
}

export interface PaginatedResponse<T> {
  items: T[]
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
}
