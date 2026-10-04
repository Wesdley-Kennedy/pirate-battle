import type { StoredMatchResult } from '../persistence/lastMatchStorage'
import { LOCAL_PLAYER_ID, LOCAL_PLAYER_NAME, type MatchRecord } from './types'

/**
 * Builds the API record for a completed match from the locally persisted
 * result. Pure and deterministic: the same stored result always produces
 * the same matchId, which is what makes retries and double-fired
 * mutations idempotent end to end.
 */
export function buildMatchRecord(result: StoredMatchResult): MatchRecord {
  return {
    matchId: `${LOCAL_PLAYER_ID}-${result.completedAt}`,
    playerId: LOCAL_PLAYER_ID,
    playerName: LOCAL_PLAYER_NAME,
    completedAt: result.completedAt,
    score: result.score,
    durationPlayedSeconds: result.durationPlayedSeconds,
    endReason: result.endReason,
    config: {
      sessionDurationSeconds: result.config.match.sessionDurationSeconds,
      enemySpawnIntervalSeconds: result.config.match.enemySpawnIntervalSeconds,
    },
  }
}
