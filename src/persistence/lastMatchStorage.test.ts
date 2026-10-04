import { afterEach, describe, expect, it } from 'vitest'
import { snapshotGameConfig, DEFAULT_GAME_CONFIG } from '../game/config/gameConfig'
import type { MatchResult } from '../game/core/gameSession'
import {
  LAST_MATCH_STORAGE_KEY,
  loadLastMatchResult,
  saveLastMatchResult,
} from './lastMatchStorage'

function sampleResult(): MatchResult {
  return {
    score: 7,
    durationPlayedSeconds: 60,
    endReason: 'time-expired',
    config: snapshotGameConfig(structuredClone(DEFAULT_GAME_CONFIG)),
  }
}

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

describe('lastMatchStorage', () => {
  it('saves and loads the last completed result with a timestamp', () => {
    const data = installFakeStorage()
    saveLastMatchResult(sampleResult())
    expect(data.has(LAST_MATCH_STORAGE_KEY)).toBe(true)

    const loaded = loadLastMatchResult()!
    expect(loaded.score).toBe(7)
    expect(loaded.endReason).toBe('time-expired')
    expect(loaded.durationPlayedSeconds).toBe(60)
    expect(typeof loaded.completedAt).toBe('string')
    expect(Number.isNaN(Date.parse(loaded.completedAt))).toBe(false)
  })

  it('returns null for missing or corrupted entries', () => {
    const data = installFakeStorage()
    expect(loadLastMatchResult()).toBeNull()
    data.set(LAST_MATCH_STORAGE_KEY, '{not json')
    expect(loadLastMatchResult()).toBeNull()
    data.set(LAST_MATCH_STORAGE_KEY, JSON.stringify({ foo: 1 }))
    expect(loadLastMatchResult()).toBeNull()
  })

  it('never throws when storage is blocked — gameplay must survive', () => {
    installFakeStorage('throws')
    expect(() => saveLastMatchResult(sampleResult())).not.toThrow()
    expect(loadLastMatchResult()).toBeNull()
  })
})
