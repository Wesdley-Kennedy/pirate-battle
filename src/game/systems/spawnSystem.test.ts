import { describe, expect, it } from 'vitest'
import { DEFAULT_ISLANDS } from '../config/arenaLayout'
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../config/gameConfig'
import { ManualClock } from '../core/clock'
import { GameSession } from '../core/gameSession'
import type { EnemyType } from '../entities/enemy'
import { createSeededRandom } from '../core/random'
import { computeSafeSpawnDistance, pickEnemyType } from './spawnSystem'

const STEP = 1 / 60

/** Fast-spawning config so tests stay short: 2 s interval. */
function fastConfig(mutate?: (config: GameConfig) => void): GameConfig {
  const config = structuredClone(DEFAULT_GAME_CONFIG)
  config.match.enemySpawnIntervalSeconds = 2
  mutate?.(config)
  return config
}

function createSession(
  config: GameConfig = fastConfig(),
  options: { seed?: number; playerStart?: { x: number; y: number }; islands?: typeof DEFAULT_ISLANDS } = {},
) {
  const clock = new ManualClock()
  const session = new GameSession({
    config,
    clock,
    seed: options.seed ?? 1,
    playerStart: options.playerStart,
    islands: options.islands,
  })
  session.start()
  return { session, clock }
}

function runSteps(session: GameSession, clock: ManualClock, steps: number): void {
  for (let i = 0; i < steps; i += 1) {
    clock.advance(STEP)
    session.tick()
  }
}

interface SpawnRecord {
  id: number
  type: EnemyType
  x: number
  y: number
  step: number
}

/** Runs the session capturing every automatic spawn at its birth step. */
function captureSpawns(
  session: GameSession,
  clock: ManualClock,
  steps: number,
  onSpawn?: (record: SpawnRecord, session: GameSession) => void,
): SpawnRecord[] {
  const records: SpawnRecord[] = []
  let seenSpawns = session.totalAutomaticSpawns
  for (let i = 0; i < steps; i += 1) {
    runSteps(session, clock, 1)
    if (session.totalAutomaticSpawns > seenSpawns) {
      seenSpawns = session.totalAutomaticSpawns
      const newest = session.enemies[session.enemies.length - 1]!
      const record: SpawnRecord = {
        id: newest.id,
        type: newest.type,
        x: newest.position.x,
        y: newest.position.y,
        step: i,
      }
      records.push(record)
      onSpawn?.(record, session)
    }
  }
  return records
}

describe('spawn timing', () => {
  it('never spawns before the interval; first spawn lands right after one full interval', () => {
    const { session, clock } = createSession()
    runSteps(session, clock, 119) // 1.983 s of the 2 s interval
    expect(session.totalAutomaticSpawns).toBe(0)
    expect(session.enemies).toHaveLength(0)
    runSteps(session, clock, 3) // crosses 2.0 s (±1 step float residue)
    expect(session.totalAutomaticSpawns).toBe(1)
  })

  it('pause freezes the timer and resume continues without catch-up', () => {
    const { session, clock } = createSession()
    runSteps(session, clock, 60) // 1 s consumed
    const frozen = session.spawnCooldownSeconds
    session.pause()
    clock.advance(500) // very long pause
    session.tick()
    expect(session.spawnCooldownSeconds).toBe(frozen)
    expect(session.totalAutomaticSpawns).toBe(0)

    session.resume()
    runSteps(session, clock, 55) // 0.916 s: still short of the remaining 1 s
    expect(session.totalAutomaticSpawns).toBe(0)
    runSteps(session, clock, 8)
    expect(session.totalAutomaticSpawns).toBe(1) // exactly one, no burst
  })

  it('a huge frame delta cannot burst multiple spawns (0.25 s clamp)', () => {
    const { session, clock } = createSession()
    clock.advance(30)
    session.tick()
    expect(session.activeElapsedSeconds).toBeLessThanOrEqual(0.25 + 1e-9)
    expect(session.totalAutomaticSpawns).toBe(0)
  })

  it('ended, destroyed and player death all stop future spawns', () => {
    const ended = createSession()
    runSteps(ended.session, ended.clock, 30)
    ended.session.end()
    ended.clock.advance(100)
    ended.session.tick()
    expect(ended.session.totalAutomaticSpawns).toBe(0)

    const destroyed = createSession()
    destroyed.session.destroy()
    destroyed.clock.advance(100)
    destroyed.session.tick()
    expect(destroyed.session.totalAutomaticSpawns).toBe(0)

    const death = createSession(
      fastConfig((config) => {
        config.enemies.chaser.collisionDamage = 5000
      }),
    )
    death.session.spawnEnemy('chaser', { x: 400, y: 850 }, 0) // manual, close by
    for (let i = 0; i < 400 && death.session.state === 'running'; i += 1) {
      runSteps(death.session, death.clock, 1)
    }
    expect(death.session.state).toBe('ended')
    const spawnsAtDeath = death.session.totalAutomaticSpawns
    death.clock.advance(100)
    death.session.tick()
    expect(death.session.totalAutomaticSpawns).toBe(spawnsAtDeath)
  })

  it('cooldown resets after each spawn and multiple intervals keep spawning', () => {
    const { session, clock } = createSession()
    const records = captureSpawns(session, clock, 60 * 13) // 13 s → 6 spawns
    expect(records.length).toBeGreaterThanOrEqual(5)
    expect(session.spawnCooldownSeconds).toBeGreaterThan(0)
    expect(session.spawnCooldownSeconds).toBeLessThanOrEqual(2)
    // Spawns are ~2 s apart (step-quantized).
    for (let i = 1; i < records.length; i += 1) {
      expect(Math.abs((records[i]!.step - records[i - 1]!.step) * STEP - 2)).toBeLessThanOrEqual(0.05)
    }
  })
})

describe('placement validity (property test over many spawns and seeds)', () => {
  it('every automatic spawn respects walls, islands, safe distance, enemies, full HP, no score', () => {
    const safeDistance = computeSafeSpawnDistance(DEFAULT_GAME_CONFIG)
    expect(safeDistance).toBe(380) // max(140×2, 320) + 60 — documented derivation

    // Huge player HP: the idle player must survive the whole 21 s soak
    // (chaser impacts would otherwise end the session mid-test).
    const soakConfig = fastConfig((c) => {
      c.player.maxHealth = 1_000_000
    })
    for (const seed of [1, 7, 123456]) {
      const { session, clock } = createSession(soakConfig, { seed })
      const scoreBefore = session.score
      captureSpawns(session, clock, 60 * 21, (record, current) => {
        const radius =
          record.type === 'chaser'
            ? DEFAULT_GAME_CONFIG.enemies.chaser.collisionRadius
            : DEFAULT_GAME_CONFIG.enemies.shooter.collisionRadius
        // Inside the walls with the full hull margin.
        expect(record.x).toBeGreaterThanOrEqual(radius)
        expect(record.x).toBeLessThanOrEqual(1600 - radius)
        expect(record.y).toBeGreaterThanOrEqual(radius)
        expect(record.y).toBeLessThanOrEqual(900 - radius)
        // Clear of every island.
        for (const island of DEFAULT_ISLANDS) {
          expect(Math.hypot(record.x - island.x, record.y - island.y)).toBeGreaterThanOrEqual(
            radius + island.radius,
          )
        }
        // Safe distance from the player at birth.
        expect(
          Math.hypot(record.x - current.player.position.x, record.y - current.player.position.y),
        ).toBeGreaterThanOrEqual(safeDistance)
        // No overlap with any other enemy at birth.
        for (const other of current.enemies) {
          if (other.id === record.id) continue
          const otherRadius =
            other.type === 'chaser'
              ? DEFAULT_GAME_CONFIG.enemies.chaser.collisionRadius
              : DEFAULT_GAME_CONFIG.enemies.shooter.collisionRadius
          expect(
            Math.hypot(record.x - other.position.x, record.y - other.position.y),
          ).toBeGreaterThanOrEqual(radius + otherRadius)
        }
        // Born at full HP.
        const newest = current.enemies[current.enemies.length - 1]!
        expect(newest.health).toBe(
          record.type === 'chaser'
            ? DEFAULT_GAME_CONFIG.enemies.chaser.maxHealth
            : DEFAULT_GAME_CONFIG.enemies.shooter.maxHealth,
        )
      })
      expect(session.score).toBe(scoreBefore) // spawning never scores
      expect(session.totalAutomaticSpawns).toBeGreaterThanOrEqual(8)
    }
  })

  it('an unplaceable arena skips spawns gracefully: failures counted, no hang, no invalid enemy', () => {
    // 700×700 arena, player at the center, big islands sealing every
    // corner pocket beyond the 380 px safe ring: no valid spot exists.
    const config = fastConfig((c) => {
      c.arena = { width: 700, height: 700 }
    })
    const islands = [
      { id: 'c1', x: 100, y: 100, radius: 150 },
      { id: 'c2', x: 600, y: 100, radius: 150 },
      { id: 'c3', x: 100, y: 600, radius: 150 },
      { id: 'c4', x: 600, y: 600, radius: 150 },
    ]
    const { session, clock } = createSession(config, {
      playerStart: { x: 350, y: 350 },
      islands,
    })
    runSteps(session, clock, 60 * 7) // 3 intervals
    expect(session.totalAutomaticSpawns).toBe(0)
    expect(session.totalSpawnFailures).toBe(3)
    expect(session.state).toBe('running')
    expect(session.enemies).toHaveLength(0)
  })
})

describe('distribution and determinism', () => {
  it('same seed reproduces identical spawn types, positions, steps and ids', () => {
    const run = () => {
      const { session, clock } = createSession(fastConfig(), { seed: 42 })
      return captureSpawns(session, clock, 60 * 15)
    }
    expect(run()).toEqual(run())
  })

  it('a different seed produces a different sequence', () => {
    const run = (seed: number) => {
      const { session, clock } = createSession(fastConfig(), { seed })
      return captureSpawns(session, clock, 60 * 15).map((r) => `${r.type}@${r.x.toFixed(2)},${r.y.toFixed(2)}`)
    }
    expect(run(1)).not.toEqual(run(999))
  })

  it('different frame cadences produce the same spawn sequence', () => {
    const run = (frames: number) => {
      const { session, clock } = createSession(fastConfig(), { seed: 5 })
      const slice = 10.1 / frames
      const records: { type: string; x: number; y: number }[] = []
      let seen = 0
      for (let i = 0; i < frames; i += 1) {
        clock.advance(slice)
        session.tick()
        while (seen < session.totalAutomaticSpawns) {
          seen += 1
          const newest = session.enemies[session.enemies.length - 1]!
          records.push({ type: newest.type, x: newest.position.x, y: newest.position.y })
        }
      }
      return records
    }
    const a = run(606)
    const b = run(239)
    // Birth decisions are identical (same RNG order); the sampler just
    // reads positions AFTER the tick, and a low-cadence tick runs 2–3
    // steps, so the newborn may have moved a step or two before sampling.
    expect(a.length).toBe(b.length)
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]!.type).toBe(b[i]!.type)
      expect(Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y)).toBeLessThan(10)
    }
  })

  it('zero weight disables a type completely — the both-types guarantee never overrides it', () => {
    const chaserOnly = fastConfig((c) => {
      c.match.enemyDistribution = { chaserWeight: 3, shooterWeight: 0 }
    })
    const a = createSession(chaserOnly, { seed: 9 })
    const recordsA = captureSpawns(a.session, a.clock, 60 * 11)
    expect(recordsA.length).toBeGreaterThanOrEqual(4)
    expect(recordsA.every((r) => r.type === 'chaser')).toBe(true)

    const shooterOnly = fastConfig((c) => {
      c.match.enemyDistribution = { chaserWeight: 0, shooterWeight: 0.25 } // weights need not sum to 1
    })
    const b = createSession(shooterOnly, { seed: 9 })
    const recordsB = captureSpawns(b.session, b.clock, 60 * 11)
    expect(recordsB.length).toBeGreaterThanOrEqual(4)
    expect(recordsB.every((r) => r.type === 'shooter')).toBe(true)
  })

  it('with both weights positive, the first two automatic spawns cover both types (standard match guarantee)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { session, clock } = createSession(fastConfig(), { seed })
      const records = captureSpawns(session, clock, 60 * 5)
      expect(records).toHaveLength(2)
      expect(new Set(records.map((r) => r.type)).size).toBe(2)
    }
  })

  it('pickEnemyType honors extreme and unnormalized weights deterministically', () => {
    const random = createSeededRandom(1)
    for (let i = 0; i < 50; i += 1) {
      expect(pickEnemyType(random, 1, 0)).toBe('chaser')
      expect(pickEnemyType(random, 0, 7)).toBe('shooter')
    }
  })
})

describe('fairness at birth', () => {
  it('a newborn shooter cannot fire instantly (born beyond its attack range)', () => {
    const shooterOnly = fastConfig((c) => {
      c.match.enemyDistribution = { chaserWeight: 0, shooterWeight: 1 }
    })
    const { session, clock } = createSession(shooterOnly, { seed: 3 })
    captureSpawns(session, clock, 60 * 9, (record, current) => {
      // Born ≥ 380 px away > 320 px attack range…
      const distance = Math.hypot(
        record.x - current.player.position.x,
        record.y - current.player.position.y,
      )
      expect(distance).toBeGreaterThan(DEFAULT_GAME_CONFIG.enemies.shooter.attackRange)
      // …and no enemy ball exists in the birth step itself.
      expect(current.projectiles.filter((p) => p.owner === 'enemy')).toHaveLength(0)
    })
    expect(session.totalAutomaticSpawns).toBeGreaterThanOrEqual(3)
  })

  it('a newborn chaser cannot impact instantly: first impact takes seconds of travel', () => {
    const chaserOnly = fastConfig((c) => {
      c.match.enemyDistribution = { chaserWeight: 1, shooterWeight: 0 }
    })
    const { session, clock } = createSession(chaserOnly, { seed: 3 })
    let firstSpawnStep = -1
    let firstImpactStep = -1
    for (let i = 0; i < 60 * 10; i += 1) {
      runSteps(session, clock, 1)
      if (firstSpawnStep === -1 && session.totalAutomaticSpawns === 1) firstSpawnStep = i
      if (firstImpactStep === -1 && session.totalChaserImpacts === 1) {
        firstImpactStep = i
        break
      }
    }
    expect(firstSpawnStep).toBeGreaterThan(0)
    expect(firstImpactStep).toBeGreaterThan(firstSpawnStep)
    // 380 px at 140 px/s ≈ 2.7 s minimum travel (turning adds more).
    expect((firstImpactStep - firstSpawnStep) * STEP).toBeGreaterThan(1.5)
  })
})

describe('session isolation', () => {
  it('manual spawns never touch the automatic counters or timer', () => {
    const { session, clock } = createSession()
    runSteps(session, clock, 30)
    const cooldownBefore = session.spawnCooldownSeconds
    session.spawnEnemy('shooter', { x: 1000, y: 200 })
    expect(session.totalAutomaticSpawns).toBe(0)
    expect(session.spawnCooldownSeconds).toBe(cooldownBefore)
    runSteps(session, clock, 1)
    expect(session.totalAutomaticSpawns).toBe(0) // timer unaffected
  })

  it('a new session resets timer, counters and reproduces by seed', () => {
    const first = createSession(fastConfig(), { seed: 11 })
    captureSpawns(first.session, first.clock, 60 * 5)
    expect(first.session.totalAutomaticSpawns).toBe(2)

    const fresh = createSession(fastConfig(), { seed: 11 })
    expect(fresh.session.totalAutomaticSpawns).toBe(0)
    expect(fresh.session.totalSpawnFailures).toBe(0)
    expect(fresh.session.spawnCooldownSeconds).toBe(2)
    const records = captureSpawns(fresh.session, fresh.clock, 60 * 5)
    expect(fresh.session.totalAutomaticSpawns).toBe(2)
    expect(records[0]!.id).toBe(1) // enemy ids restart per session
  })
})
