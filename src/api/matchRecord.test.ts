import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG, snapshotGameConfig } from '../game/config/gameConfig'
import type { StoredMatchResult } from '../persistence/lastMatchStorage'
import { buildMatchRecord } from './matchRecord'
import { configFingerprint } from './types'

const STORED: StoredMatchResult = {
  score: 4,
  durationPlayedSeconds: 97.5,
  endReason: 'player-death',
  config: snapshotGameConfig(DEFAULT_GAME_CONFIG),
  completedAt: '2026-10-02T18:30:12.345Z',
}

describe('buildMatchRecord', () => {
  it('derives a deterministic matchId from the completion instant', () => {
    const first = buildMatchRecord(STORED)
    const second = buildMatchRecord(STORED)
    expect(first.matchId).toBe('local-player-2026-10-02T18:30:12.345Z')
    expect(second).toEqual(first)
  })

  it('carries the result fields and summarizes the config to the two exposed options', () => {
    const record = buildMatchRecord(STORED)
    expect(record.playerId).toBe('local-player')
    expect(record.playerName).toBe('Player')
    expect(record.score).toBe(4)
    expect(record.durationPlayedSeconds).toBe(97.5)
    expect(record.endReason).toBe('player-death')
    expect(record.config).toEqual({
      sessionDurationSeconds: 120,
      enemySpawnIntervalSeconds: 5,
    })
    expect(configFingerprint(record.config)).toBe('120s-5s')
  })
})
