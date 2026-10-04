import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../config/gameConfig'
import { ManualClock } from './clock'
import { GameSession } from './gameSession'

const STEP = 1 / 60
const FORWARD = { forward: true, turnLeft: false, turnRight: false }
const FIRE_FRONT = { fireFront: true, fireLeft: false, fireRight: false }

/**
 * 60 s duration (the validation minimum) and fast spawns. The default
 * huge HP keeps the idle player alive through full-length timer runs
 * (auto-spawned chasers would otherwise kill it long before 60 s);
 * death-focused tests override maxHealth explicitly.
 */
function matchConfig(mutate?: (config: GameConfig) => void): GameConfig {
  const config = structuredClone(DEFAULT_GAME_CONFIG)
  config.match.sessionDurationSeconds = 60
  config.match.enemySpawnIntervalSeconds = 2
  config.player.maxHealth = 1_000_000
  mutate?.(config)
  return config
}

function createSession(config = matchConfig(), playerStart = { x: 400, y: 700 }) {
  const clock = new ManualClock()
  const session = new GameSession({ config, clock, seed: 1, playerStart })
  session.start()
  return { session, clock }
}

function runSteps(session: GameSession, clock: ManualClock, steps: number): void {
  for (let i = 0; i < steps; i += 1) {
    clock.advance(STEP)
    session.tick()
  }
}

function runSeconds(session: GameSession, clock: ManualClock, seconds: number): void {
  runSteps(session, clock, Math.round(seconds / STEP))
}

describe('match timer', () => {
  it('remaining starts at the duration and only shrinks while running', () => {
    const { session, clock } = createSession()
    expect(session.remainingSeconds).toBe(60)

    runSeconds(session, clock, 1)
    expect(Math.abs(session.remainingSeconds - 59)).toBeLessThanOrEqual(STEP + 1e-9)

    session.pause()
    const frozen = session.remainingSeconds
    clock.advance(1000)
    session.tick()
    expect(session.remainingSeconds).toBe(frozen)

    session.resume()
    runSeconds(session, clock, 1)
    expect(Math.abs(session.remainingSeconds - 58)).toBeLessThanOrEqual(2 * STEP + 1e-9)
  })

  it('expires exactly at the duration: clamped to zero with time-expired', () => {
    const { session, clock } = createSession()
    runSeconds(session, clock, 61)
    expect(session.state).toBe('ended')
    expect(session.endReason).toBe('time-expired')
    expect(session.remainingSeconds).toBe(0)
    expect(session.activeElapsedSeconds).toBeLessThanOrEqual(60 + STEP)
  })

  it('on the boundary step, time beats death: no gameplay runs after expiry', () => {
    // An enemy ball one step away from the player when the timer expires
    // must NOT land: the expiring step runs no gameplay at all.
    const config = matchConfig((c) => {
      c.projectiles.enemyDamage = 5000
      // Keep every OTHER damage source silent: auto-spawns are harmless
      // chasers only, so the single manual shooter below is the only
      // thing that could ever touch the player's health.
      c.match.enemyDistribution = { chaserWeight: 1, shooterWeight: 0 }
      c.enemies.chaser.collisionDamage = 0
    })
    const { session, clock } = createSession(config)
    // Run until just before expiry, then place the lethal ball by hand
    // via a close shooter: simpler — drive time to 59.9 s first.
    runSeconds(session, clock, 59.9)
    expect(session.state).toBe('running')
    session.spawnEnemy('shooter', { x: 400, y: 480 }, Math.PI) // fires immediately next step
    runSeconds(session, clock, 0.5) // crosses 60 s while the ball is in flight
    expect(session.state).toBe('ended')
    expect(session.endReason).toBe('time-expired') // not player-death
    expect(session.player.health).toBe(session.config.player.maxHealth) // untouched
  })

  it('different frame cadences end at the same active time', () => {
    const endElapsed = (frames: number) => {
      const { session, clock } = createSession()
      const slice = 62 / frames
      for (let i = 0; i < frames && session.state === 'running'; i += 1) {
        clock.advance(slice)
        session.tick()
      }
      expect(session.endReason).toBe('time-expired')
      return session.activeElapsedSeconds
    }
    expect(Math.abs(endElapsed(3720) - endElapsed(1431))).toBeLessThanOrEqual(2 * STEP + 1e-9)
  })
})

describe('end freeze', () => {
  it('after time-expired, absolutely nothing changes anymore', () => {
    const { session, clock } = createSession()
    // A lively scene: enemies, projectiles in flight, held inputs.
    session.setPlayerIntent(FORWARD)
    session.setWeaponIntent(FIRE_FRONT)
    runSeconds(session, clock, 59.99)
    runSeconds(session, clock, 0.1) // expire
    expect(session.state).toBe('ended')

    const snapshot = JSON.stringify({
      player: session.player,
      enemies: session.enemies,
      projectiles: session.projectiles,
      score: session.score,
      spawns: session.totalAutomaticSpawns,
      cooldowns: session.weaponCooldowns,
      elapsed: session.activeElapsedSeconds,
      spawnCooldown: session.spawnCooldownSeconds,
    })

    session.setPlayerIntent(FORWARD)
    session.setWeaponIntent(FIRE_FRONT)
    runSeconds(session, clock, 5) // many ticks after the end

    const after = JSON.stringify({
      player: session.player,
      enemies: session.enemies,
      projectiles: session.projectiles,
      score: session.score,
      spawns: session.totalAutomaticSpawns,
      cooldowns: session.weaponCooldowns,
      elapsed: session.activeElapsedSeconds,
      spawnCooldown: session.spawnCooldownSeconds,
    })
    expect(after).toBe(snapshot)
  })
})

describe('match result', () => {
  it('is created exactly once, with score, effective duration, reason and the config snapshot', () => {
    const config = matchConfig((c) => {
      c.projectiles.frontDamage = 50 // one-shot a shooter for score
    })
    const { session, clock } = createSession(config)
    const target = session.spawnEnemy('shooter', { x: 400, y: 450 })
    session.setEnemyDrive(target.id, { targetHeading: null, forward: false })
    session.setWeaponIntent(FIRE_FRONT)
    runSeconds(session, clock, 1)
    session.setWeaponIntent({ fireFront: false, fireLeft: false, fireRight: false })
    expect(session.score).toBe(1)

    expect(session.matchResult).toBeNull() // not ended yet
    runSeconds(session, clock, 61)
    const result = session.matchResult!
    expect(result.score).toBe(1)
    expect(result.endReason).toBe('time-expired')
    expect(result.durationPlayedSeconds).toBe(60)
    expect(result.config).toBe(session.config) // the snapshot actually used
    expect(session.matchResult).toBe(result) // same object, never recreated
  })

  it('player death produces a result with the partial duration', () => {
    const config = matchConfig((c) => {
      c.player.maxHealth = 100
      c.enemies.chaser.collisionDamage = 5000
    })
    const { session, clock } = createSession(config)
    session.spawnEnemy('chaser', { x: 400, y: 850 }, 0)
    for (let i = 0; i < 600 && session.state === 'running'; i += 1) runSteps(session, clock, 1)
    const result = session.matchResult!
    expect(result.endReason).toBe('player-death')
    expect(result.durationPlayedSeconds).toBeGreaterThan(0)
    expect(result.durationPlayedSeconds).toBeLessThan(60)
  })

  it('abandonment (destroy without end) never produces a result', () => {
    const { session, clock } = createSession()
    runSeconds(session, clock, 5)
    session.destroy()
    expect(session.matchResult).toBeNull()
    expect(session.endReason).toBeNull()
  })

  it('a plain end() without reason (dev/test) produces no completed result', () => {
    const { session } = createSession()
    session.end()
    expect(session.matchResult).toBeNull()
  })
})

describe('pause semantics', () => {
  it('pausing clears held movement and weapon intents', () => {
    const { session, clock } = createSession()
    session.setPlayerIntent(FORWARD)
    session.setWeaponIntent(FIRE_FRONT)
    runSeconds(session, clock, 0.2)
    const positionAtPause = { ...session.player.position }
    const shotsAtPause = session.totalShotsFired

    session.pause()
    session.resume()
    runSeconds(session, clock, 1) // nobody pressed anything again

    expect(session.player.position).toEqual(positionAtPause)
    expect(session.totalShotsFired).toBe(shotsAtPause)
  })

  it('pause after ended is rejected coherently', () => {
    const { session, clock } = createSession()
    runSeconds(session, clock, 61)
    expect(session.state).toBe('ended')
    expect(() => session.pause()).toThrow(/Cannot pause/)
  })
})

describe('restart policy (new sessions)', () => {
  it('an omitted seed gives a brand-new random seed; an explicit seed reproduces', () => {
    const clock = new ManualClock()
    const a = new GameSession({ config: matchConfig(), clock })
    const b = new GameSession({ config: matchConfig(), clock })
    expect(a.seed).not.toBe(b.seed) // 1 in 2^32 flake odds: acceptable

    const replayA = new GameSession({ config: matchConfig(), clock, seed: 77 })
    const replayB = new GameSession({ config: matchConfig(), clock, seed: 77 })
    const sequenceA = Array.from({ length: 10 }, () => replayA.random.next())
    const sequenceB = Array.from({ length: 10 }, () => replayB.random.next())
    expect(sequenceA).toEqual(sequenceB)
  })
})
