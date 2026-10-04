import { describe, expect, it } from 'vitest'
import { DEFAULT_ISLANDS } from '../config/arenaLayout'
import { DEFAULT_GAME_CONFIG } from '../config/gameConfig'
import { wrapAngle } from '../core/angles'
import { ManualClock } from '../core/clock'
import { GameSession } from '../core/gameSession'
import { createPlayerState } from '../entities/player'
import { computeChaserDrive } from './chaserAi'

const STEP = 1 / 60

function chaserAt(x: number, y: number) {
  return { id: 1, type: 'chaser' as const, position: { x, y }, rotation: 0, health: 30 }
}

function createSession(config = DEFAULT_GAME_CONFIG, playerStart = { x: 800, y: 450 }) {
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

describe('computeChaserDrive (pure)', () => {
  it('aims at the player on all four axes', () => {
    const chaser = chaserAt(500, 500)
    expect(computeChaserDrive(chaser, { x: 500, y: 400 }).targetHeading).toBeCloseTo(0, 12) // above
    expect(computeChaserDrive(chaser, { x: 500, y: 600 }).targetHeading).toBeCloseTo(Math.PI, 12) // below
    expect(computeChaserDrive(chaser, { x: 600, y: 500 }).targetHeading).toBeCloseTo(Math.PI / 2, 12) // right
    expect(computeChaserDrive(chaser, { x: 400, y: 500 }).targetHeading).toBeCloseTo(-Math.PI / 2, 12) // left
  })

  it('aims correctly into all four quadrants and always wants to advance', () => {
    const chaser = chaserAt(500, 500)
    const cases: [number, number, number][] = [
      [600, 400, Math.PI / 4], // NE
      [600, 600, (3 * Math.PI) / 4], // SE
      [400, 600, (-3 * Math.PI) / 4], // SW
      [400, 400, -Math.PI / 4], // NW
    ]
    for (const [x, y, expected] of cases) {
      const drive = computeChaserDrive(chaser, { x, y })
      expect(drive.targetHeading).toBeCloseTo(expected, 12)
      expect(drive.forward).toBe(true)
    }
  })

  it('is deterministic and NaN-free at zero distance', () => {
    const drive = computeChaserDrive(chaserAt(500, 500), { x: 500, y: 500 })
    expect(drive.targetHeading).toBeNull()
    expect(drive.forward).toBe(false)
  })

  it('never alters positions itself', () => {
    const chaser = chaserAt(500, 500)
    const player = createPlayerState({ x: 300, y: 300 })
    computeChaserDrive(chaser, player.position)
    expect(chaser.position).toEqual({ x: 500, y: 500 })
    expect(player.position).toEqual({ x: 300, y: 300 })
  })
})

describe('GameSession chaser pursuit', () => {
  it('chases automatically; a manually driven shooter is fully test-controlled', () => {
    const { session, clock } = createSession()
    const chaser = session.spawnEnemy('chaser', { x: 800, y: 800 })
    const shooter = session.spawnEnemy('shooter', { x: 1300, y: 450 })
    // Manual drive replaces the Shooter AI entirely (hold position).
    session.setEnemyDrive(shooter.id, { targetHeading: null, forward: false })
    runSteps(session, clock, 60)

    expect(Math.hypot(chaser.position.x - 800, chaser.position.y - 450)).toBeLessThan(350)
    expect(chaser.position.y).toBeLessThan(800) // moved toward the player
    expect(shooter.position).toEqual({ x: 1300, y: 450 }) // held still
    expect(shooter.rotation).toBe(0)
  })

  it('turns with its configured rotation speed along the shortest arc', () => {
    const { session, clock } = createSession()
    // Player is straight above; chaser starts facing down (π): worst case.
    const chaser = session.spawnEnemy('chaser', { x: 800, y: 800 }, Math.PI - 0.01)
    runSteps(session, clock, 30) // 0.5s × 0.75π rad/s
    const turned = Math.abs(wrapAngle(chaser.rotation - (Math.PI - 0.01)))
    const expected = DEFAULT_GAME_CONFIG.enemies.chaser.rotationSpeed * 0.5
    expect(Math.abs(turned - expected)).toBeLessThanOrEqual(
      DEFAULT_GAME_CONFIG.enemies.chaser.rotationSpeed * STEP + 1e-9,
    )
    // Shortest arc from π-0.01 toward 0 is counter-clockwise (decreasing).
    expect(wrapAngle(chaser.rotation)).toBeLessThan(Math.PI - 0.01)
  })

  it('closes in at its configured moveSpeed once aligned, with monotonic distance', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.enemies.chaser.moveSpeed = 90
    // Island-free corridor: x = 400 avoids island-south's center line.
    const { session, clock } = createSession(config, { x: 400, y: 450 })
    config.enemies.chaser.moveSpeed = 1 // snapshot authority

    const chaser = session.spawnEnemy('chaser', { x: 400, y: 850 }, 0)
    runSteps(session, clock, 30) // let it align (player straight above)
    const distances: number[] = []
    for (let i = 0; i < 60; i += 1) {
      runSteps(session, clock, 1)
      distances.push(Math.hypot(chaser.position.x - 400, chaser.position.y - 450))
    }
    // Non-increasing per tick (a tick may execute 0 steps due to float
    // residue), with real total progress at the configured speed.
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]!).toBeLessThanOrEqual(distances[i - 1]! + 1e-9)
    }
    const closed = distances[0]! - distances[distances.length - 1]!
    expect(Math.abs(closed - 90 * (59 / 60))).toBeLessThanOrEqual(2 * 90 * STEP + 1e-6)
  })

  it('re-aims at the player’s current position while the player moves', () => {
    const { session, clock } = createSession()
    const chaser = session.spawnEnemy('chaser', { x: 800, y: 850 })
    runSteps(session, clock, 90) // aligned on the stationary player (heading ≈ 0)
    const headingBefore = chaser.rotation

    // Teleport-free player movement: drive the real input eastwards.
    session.player.rotation = Math.PI / 2
    session.setPlayerIntent({ forward: true, turnLeft: false, turnRight: false })
    runSteps(session, clock, 120)
    expect(chaser.rotation).not.toBeCloseTo(headingBefore, 2)
    expect(chaser.rotation).toBeGreaterThan(0.2) // now pointing east-ish too
  })

  it('impacts the player exactly once, self-destructs in the same step and preserves config damage', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.enemies.chaser.collisionDamage = 77
    // Island-free corridor at x = 400.
    const { session, clock } = createSession(config, { x: 400, y: 450 })
    const chaser = session.spawnEnemy('chaser', { x: 400, y: 850 }, 0)

    // 400 px gap, 60 px combined radius, 140 px/s → impact well under 4 s.
    let impactStep = -1
    for (let i = 0; i < 300 && impactStep === -1; i += 1) {
      runSteps(session, clock, 1)
      if (session.totalChaserImpacts === 1) impactStep = i
    }
    expect(impactStep).toBeGreaterThan(0)
    expect(session.enemies).toHaveLength(0) // removed in the same observed step

    const events = session.consumeCombatEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'chaserImpact', enemyId: chaser.id, damage: 77 })
    expect(session.consumeCombatEvents()).toHaveLength(0) // consumable exactly once

    runSteps(session, clock, 120) // removed chaser can never impact again
    expect(session.totalChaserImpacts).toBe(1)
    // No health yet (PHASE 10) and no score system exists to increment.
  })

  it('respects islands and arena while pursuing a hidden player: no penetration, no NaN', () => {
    const island = DEFAULT_ISLANDS[2]! // island-south (800, 650)
    // Player hides exactly north of the island; chaser starts south of it.
    const { session, clock } = createSession(DEFAULT_GAME_CONFIG, { x: island.x, y: island.y - 180 })
    const chaser = session.spawnEnemy('chaser', { x: island.x, y: island.y + 180 }, Math.PI)
    const combined = island.radius + DEFAULT_GAME_CONFIG.enemies.chaser.collisionRadius

    for (let i = 0; i < 600; i += 1) {
      runSteps(session, clock, 1)
      const distance = Math.hypot(chaser.position.x - island.x, chaser.position.y - island.y)
      expect(distance).toBeGreaterThanOrEqual(combined - 1e-6)
      expect(Number.isFinite(chaser.position.x)).toBe(true)
      expect(Number.isFinite(chaser.position.y)).toBe(true)
      expect(chaser.position.x).toBeGreaterThanOrEqual(30 - 1e-9)
      expect(chaser.position.x).toBeLessThanOrEqual(1570 + 1e-9)
      expect(chaser.position.y).toBeGreaterThanOrEqual(30 - 1e-9)
      expect(chaser.position.y).toBeLessThanOrEqual(870 + 1e-9)
    }
  })

  it('pause freezes pursuit; resume continues without a jump', () => {
    const { session, clock } = createSession()
    const chaser = session.spawnEnemy('chaser', { x: 800, y: 850 })
    runSteps(session, clock, 60)
    const frozen = { ...chaser.position, rotation: chaser.rotation }

    session.pause()
    clock.advance(30)
    session.tick()
    expect(chaser.position.x).toBe(frozen.x)
    expect(chaser.position.y).toBe(frozen.y)
    expect(chaser.rotation).toBe(frozen.rotation)

    session.resume()
    session.tick() // immediately after resume: no catch-up jump
    expect(Math.hypot(chaser.position.x - frozen.x, chaser.position.y - frozen.y)).toBeLessThan(
      DEFAULT_GAME_CONFIG.enemies.chaser.moveSpeed * STEP + 1e-6,
    )
  })

  it('different frame cadences produce equivalent pursuit outcomes', () => {
    const outcomes = [120, 47].map((frames) => {
      const { session, clock } = createSession()
      const chaser = session.spawnEnemy('chaser', { x: 1300, y: 800 }, Math.PI / 3)
      const slice = 2 / frames
      for (let i = 0; i < frames; i += 1) {
        clock.advance(slice)
        session.tick()
      }
      return chaser
    })
    const [a, b] = outcomes
    const tolerance = DEFAULT_GAME_CONFIG.enemies.chaser.moveSpeed * STEP + 1e-6
    expect(Math.hypot(a!.position.x - b!.position.x, a!.position.y - b!.position.y)).toBeLessThanOrEqual(
      tolerance,
    )
  })

  it('a new session starts with zero impacts and no stale combat events', () => {
    const { session } = createSession()
    expect(session.totalChaserImpacts).toBe(0)
    expect(session.consumeCombatEvents()).toHaveLength(0)
  })
})
