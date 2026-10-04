import { afterEach, describe, expect, it } from 'vitest'
import { configFingerprint, type MatchRecord } from '../api/types'
import {
  buildHistory,
  buildRanking,
  getMockScenario,
  loadMockMatches,
  MOCK_FIXTURES,
  MOCK_MATCHES_KEY,
  MOCK_SCENARIO_KEY,
  paginate,
  resetMockData,
  saveMockMatches,
  setMockScenario,
  upsertMatch,
} from './mockDb'

const DEFAULT_FINGERPRINT = configFingerprint({
  sessionDurationSeconds: 120,
  enemySpawnIntervalSeconds: 5,
})

function record(overrides: Partial<MatchRecord>): MatchRecord {
  return {
    matchId: 'local-player-2026-10-01T10:00:00.000Z',
    playerId: 'local-player',
    playerName: 'Player',
    completedAt: '2026-10-01T10:00:00.000Z',
    score: 5,
    durationPlayedSeconds: 120,
    endReason: 'time-expired',
    config: { sessionDurationSeconds: 120, enemySpawnIntervalSeconds: 5 },
    ...overrides,
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
    removeItem: (key: string) => {
      if (behavior === 'throws') throw new Error('storage blocked')
      data.delete(key)
    },
    clear: () => data.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true })
  return data
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('upsertMatch (idempotent registration)', () => {
  it('appends a new matchId and reports created', () => {
    const result = upsertMatch(MOCK_FIXTURES, record({}))
    expect(result.created).toBe(true)
    expect(result.matches).toHaveLength(MOCK_FIXTURES.length + 1)
    expect(result.record.matchId).toBe('local-player-2026-10-01T10:00:00.000Z')
  })

  it('re-sending the same matchId recovers the existing record without duplicating', () => {
    const first = upsertMatch(MOCK_FIXTURES, record({ score: 5 }))
    // Same id, different payload: the ORIGINAL record must win.
    const second = upsertMatch(first.matches, record({ score: 99 }))
    expect(second.created).toBe(false)
    expect(second.matches).toHaveLength(first.matches.length)
    expect(second.record.score).toBe(5)
  })
})

describe('buildRanking', () => {
  it('keeps only each player’s best match', () => {
    const ranking = buildRanking(MOCK_FIXTURES, DEFAULT_FINGERPRINT)
    const sams = ranking.filter((entry) => entry.playerId === 'scurvy-sam')
    expect(sams).toHaveLength(1)
    expect(sams[0]?.score).toBe(11) // not the second match with 7
  })

  it('sorts score DESC with completedAt ASC as the deterministic tiebreak', () => {
    const ranking = buildRanking(MOCK_FIXTURES, DEFAULT_FINGERPRINT)
    expect(ranking.map((entry) => entry.score)).toEqual([11, 9, 8, 8, 6, 4, 2])
    // Salty Jack (2026-09-12) finished before Stormy Finn (2026-09-19).
    const tied = ranking.filter((entry) => entry.score === 8)
    expect(tied.map((entry) => entry.playerId)).toEqual(['salty-jack', 'stormy-finn'])
    expect(ranking.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('only compares matches with the same config fingerprint', () => {
    const custom = record({
      matchId: 'local-player-custom',
      score: 999,
      config: { sessionDurationSeconds: 60, enemySpawnIntervalSeconds: 2 },
    })
    const ranking = buildRanking([...MOCK_FIXTURES, custom], DEFAULT_FINGERPRINT)
    expect(ranking.some((entry) => entry.score === 999)).toBe(false)
    const customRanking = buildRanking([...MOCK_FIXTURES, custom], configFingerprint(custom.config))
    expect(customRanking).toHaveLength(1)
    expect(customRanking[0]?.score).toBe(999)
  })
})

describe('buildHistory', () => {
  it('returns only the player’s matches, most recent first', () => {
    const history = buildHistory(MOCK_FIXTURES, 'scurvy-sam')
    expect(history.map((match) => match.completedAt)).toEqual([
      '2026-09-18T14:05:00.000Z',
      '2026-09-15T10:30:00.000Z',
    ])
  })
})

describe('paginate', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g']

  it('slices pages of 5 and reports totals', () => {
    const page1 = paginate(items, 1)
    expect(page1.items).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(page1.totalItems).toBe(7)
    expect(page1.totalPages).toBe(2)
    expect(paginate(items, 2).items).toEqual(['f', 'g'])
  })

  it('clamps out-of-range pages', () => {
    expect(paginate(items, 99).page).toBe(2)
    expect(paginate(items, 0).page).toBe(1)
    expect(paginate([], 3)).toEqual({
      items: [],
      page: 1,
      pageSize: 5,
      totalItems: 0,
      totalPages: 1,
    })
  })
})

describe('storage glue', () => {
  it('serves the fixtures until something is saved, then round-trips', () => {
    installFakeStorage()
    expect(loadMockMatches()).toEqual(MOCK_FIXTURES)
    const next = upsertMatch(loadMockMatches(), record({}))
    saveMockMatches(next.matches)
    expect(loadMockMatches()).toHaveLength(MOCK_FIXTURES.length + 1)
  })

  it('falls back to the fixtures on corrupt data and survives blocked storage', () => {
    const data = installFakeStorage()
    data.set(MOCK_MATCHES_KEY, '{nope')
    expect(loadMockMatches()).toEqual(MOCK_FIXTURES)
    installFakeStorage('throws')
    expect(loadMockMatches()).toEqual(MOCK_FIXTURES)
    expect(() => saveMockMatches([record({})])).not.toThrow()
    expect(getMockScenario()).toBe('success')
    expect(() => setMockScenario('error')).not.toThrow()
    expect(() => resetMockData()).not.toThrow()
  })

  it('scenario defaults to success, validates values and resets fully', () => {
    const data = installFakeStorage()
    expect(getMockScenario()).toBe('success')
    data.set(MOCK_SCENARIO_KEY, 'bogus')
    expect(getMockScenario()).toBe('success')
    setMockScenario('error')
    expect(getMockScenario()).toBe('error')
    saveMockMatches([record({})])
    resetMockData()
    expect(getMockScenario()).toBe('success')
    expect(loadMockMatches()).toEqual(MOCK_FIXTURES)
  })
})
