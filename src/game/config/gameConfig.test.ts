import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GAME_CONFIG,
  ENEMY_SPAWN_INTERVAL_LIMITS,
  SESSION_DURATION_LIMITS,
  snapshotGameConfig,
  validateEnemySpawnInterval,
  validateGameConfig,
  validateSessionDuration,
  type GameConfig,
} from './gameConfig'

function cloneDefaultConfig(): GameConfig {
  return structuredClone(DEFAULT_GAME_CONFIG)
}

describe('validateGameConfig', () => {
  it('accepts the default config', () => {
    expect(validateGameConfig(DEFAULT_GAME_CONFIG)).toEqual([])
  })

  it('rejects session durations outside the 60–180s challenge bounds', () => {
    expect(validateSessionDuration(SESSION_DURATION_LIMITS.min)).toBeNull()
    expect(validateSessionDuration(SESSION_DURATION_LIMITS.max)).toBeNull()
    for (const invalid of [59, 181, 0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateSessionDuration(invalid)).not.toBeNull()
    }

    const config = cloneDefaultConfig()
    config.match.sessionDurationSeconds = 59
    expect(validateGameConfig(config)).toContainEqual(
      expect.objectContaining({ field: 'sessionDurationSeconds' }),
    )
  })

  it('rejects spawn intervals outside the documented bounds', () => {
    expect(validateEnemySpawnInterval(ENEMY_SPAWN_INTERVAL_LIMITS.min)).toBeNull()
    expect(validateEnemySpawnInterval(ENEMY_SPAWN_INTERVAL_LIMITS.max)).toBeNull()
    for (const invalid of [0, -5, ENEMY_SPAWN_INTERVAL_LIMITS.max + 1, Number.NaN]) {
      expect(validateEnemySpawnInterval(invalid)).not.toBeNull()
    }

    const config = cloneDefaultConfig()
    config.match.enemySpawnIntervalSeconds = 0
    expect(validateGameConfig(config)).toContainEqual(
      expect.objectContaining({ field: 'enemySpawnIntervalSeconds' }),
    )
  })

  it('rejects unusable enemy distributions', () => {
    const config = cloneDefaultConfig()
    config.match.enemyDistribution = { chaserWeight: 0, shooterWeight: 0 }
    expect(validateGameConfig(config)).toContainEqual(
      expect.objectContaining({ field: 'enemyDistribution' }),
    )
  })
})

describe('snapshotGameConfig', () => {
  it('throws on invalid config', () => {
    const config = cloneDefaultConfig()
    config.match.sessionDurationSeconds = 999
    expect(() => snapshotGameConfig(config)).toThrow(/Session duration/)
  })

  it('is immune to later mutation of the source config, including nested objects', () => {
    const config = cloneDefaultConfig()
    const snapshot = snapshotGameConfig(config)

    config.match.sessionDurationSeconds = 60
    config.player.maxHealth = 1
    config.enemies.shooter.attackRange = 9999
    config.match.enemyDistribution.chaserWeight = 42

    expect(snapshot.match.sessionDurationSeconds).toBe(120)
    expect(snapshot.player.maxHealth).toBe(100)
    expect(snapshot.enemies.shooter.attackRange).toBe(320)
    expect(snapshot.match.enemyDistribution.chaserWeight).toBe(1)
  })

  it('is deep-frozen: snapshot mutation attempts throw', () => {
    const snapshot = snapshotGameConfig(cloneDefaultConfig())
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.player)).toBe(true)
    expect(Object.isFrozen(snapshot.match.enemyDistribution)).toBe(true)
    expect(() => {
      ;(snapshot.player as { maxHealth: number }).maxHealth = 1
    }).toThrow(TypeError)
  })
})
