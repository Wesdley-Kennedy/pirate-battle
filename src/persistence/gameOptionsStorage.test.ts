import { afterEach, describe, expect, it } from 'vitest'
import { buildGameConfigFromOptions, DEFAULT_GAME_CONFIG } from '../game/config/gameConfig'
import {
  defaultGameOptions,
  GAME_OPTIONS_STORAGE_KEY,
  loadGameOptions,
  saveGameOptions,
} from './gameOptionsStorage'

function installFakeStorage(behavior: 'ok' | 'throws' = 'ok'): Map<string, string> {
  const data = new Map<string, string>()
  const fake = {
    getItem: (key: string) => {
      if (behavior === 'throws') throw new Error('storage blocked')
      return data.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (behavior === 'throws') throw new Error('storage blocked')
      data.set(key, value)
    },
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true })
  return data
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('gameOptionsStorage', () => {
  it('returns defaults when nothing is stored', () => {
    installFakeStorage()
    expect(loadGameOptions()).toEqual({
      sessionDurationSeconds: 120,
      enemySpawnIntervalSeconds: 5,
    })
  })

  it('round-trips valid saved options', () => {
    installFakeStorage()
    saveGameOptions({ sessionDurationSeconds: 90, enemySpawnIntervalSeconds: 3 })
    expect(loadGameOptions()).toEqual({
      sessionDurationSeconds: 90,
      enemySpawnIntervalSeconds: 3,
    })
  })

  it('falls back safely on corrupt JSON, wrong version, missing or out-of-range fields', () => {
    const data = installFakeStorage()

    data.set(GAME_OPTIONS_STORAGE_KEY, '{broken')
    expect(loadGameOptions()).toEqual(defaultGameOptions())

    data.set(GAME_OPTIONS_STORAGE_KEY, JSON.stringify({ version: 99, sessionDurationSeconds: 90 }))
    expect(loadGameOptions()).toEqual(defaultGameOptions())

    // Field-by-field fallback: the valid field survives, the bad one resets.
    data.set(
      GAME_OPTIONS_STORAGE_KEY,
      JSON.stringify({ version: 1, sessionDurationSeconds: 90, enemySpawnIntervalSeconds: 999 }),
    )
    expect(loadGameOptions()).toEqual({
      sessionDurationSeconds: 90,
      enemySpawnIntervalSeconds: 5,
    })

    data.set(
      GAME_OPTIONS_STORAGE_KEY,
      JSON.stringify({ version: 1, sessionDurationSeconds: 30 }), // below 60 + missing spawn
    )
    expect(loadGameOptions()).toEqual(defaultGameOptions())
  })

  it('never throws when storage is blocked', () => {
    installFakeStorage('throws')
    expect(() => saveGameOptions(defaultGameOptions())).not.toThrow()
    expect(loadGameOptions()).toEqual(defaultGameOptions())
  })
})

describe('buildGameConfigFromOptions', () => {
  it('applies only the two exposed fields and preserves every internal value', () => {
    const config = buildGameConfigFromOptions({
      sessionDurationSeconds: 60,
      enemySpawnIntervalSeconds: 2,
    })
    expect(config.match.sessionDurationSeconds).toBe(60)
    expect(config.match.enemySpawnIntervalSeconds).toBe(2)

    // Everything else is byte-equal to the defaults.
    const defaults = structuredClone(DEFAULT_GAME_CONFIG)
    defaults.match.sessionDurationSeconds = 60
    defaults.match.enemySpawnIntervalSeconds = 2
    expect(config).toEqual(defaults)
    expect(config.player.maxHealth).toBe(DEFAULT_GAME_CONFIG.player.maxHealth)
    expect(config.match.enemyDistribution).toEqual(DEFAULT_GAME_CONFIG.match.enemyDistribution)
  })
})
