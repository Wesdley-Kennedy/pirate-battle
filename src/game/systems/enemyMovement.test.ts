import { describe, expect, it } from 'vitest'
import { DEFAULT_ISLANDS } from '../config/arenaLayout'
import { DEFAULT_GAME_CONFIG } from '../config/gameConfig'
import { ManualClock } from '../core/clock'
import { GameSession } from '../core/gameSession'

const STEP = 1 / 60
const OPEN_WATER = { x: 800, y: 450 }

function createSession(config = DEFAULT_GAME_CONFIG) {
  const clock = new ManualClock()
  const session = new GameSession({ config, clock, seed: 1 })
  session.start()
  return { session, clock }
}

function runSteps(session: GameSession, clock: ManualClock, steps: number): void {
  for (let i = 0; i < steps; i += 1) {
    clock.advance(STEP)
    session.tick()
  }
}

describe('GameSession enemies', () => {
  it('spawns chaser and shooter with correct types, deterministic ids and preserved positions', () => {
    const { session } = createSession()
    const chaser = session.spawnEnemy('chaser', { x: 600, y: 450 }, 0.5)
    const shooter = session.spawnEnemy('shooter', OPEN_WATER, -1)

    expect(chaser.type).toBe('chaser')
    expect(shooter.type).toBe('shooter')
    expect(chaser.id).toBe(1)
    expect(shooter.id).toBe(2)
    expect(chaser.position).toEqual({ x: 600, y: 450 })
    expect(chaser.rotation).toBe(0.5)
    expect(session.enemies).toHaveLength(2)
  })

  it('rejects spawns outside the arena, inside islands or on top of the player', () => {
    const { session } = createSession()
    expect(() => session.spawnEnemy('chaser', { x: 10, y: 450 })).toThrow(/outside the arena/)
    const island = DEFAULT_ISLANDS[0]!
    expect(() => session.spawnEnemy('shooter', { x: island.x, y: island.y })).toThrow(/intersects/)
    expect(() =>
      session.spawnEnemy('chaser', { x: session.player.position.x + 10, y: session.player.position.y }),
    ).toThrow(/overlaps the player/)
    expect(session.enemies).toHaveLength(0)
  })

  it('manual drive moves a shooter at its configured speed (config snapshot stays authoritative)', () => {
    // Chaser speed is covered by the chaserAi pursuit tests — manual
    // drives on chasers are forbidden since PHASE 8.
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.enemies.shooter.moveSpeed = 30
    const { session, clock } = createSession(config)
    config.enemies.shooter.moveSpeed = 9999 // later mutation must not leak in

    const shooter = session.spawnEnemy('shooter', { x: 700, y: 450 })
    session.setEnemyDrive(shooter.id, { targetHeading: null, forward: true })
    runSteps(session, clock, 60)

    expect(shooter.position.y).toBeCloseTo(450 - 30, 3)
    expect(shooter.position.x).toBeCloseTo(700, 6)
  })

  it('rejects manual drives on chasers (AI-controlled in production)', () => {
    const { session } = createSession()
    const chaser = session.spawnEnemy('chaser', { x: 600, y: 450 })
    expect(() =>
      session.setEnemyDrive(chaser.id, { targetHeading: null, forward: true }),
    ).toThrow(/AI-controlled/)
  })

  it('rotates toward the drive heading at the configured rotation speed, without overshoot', () => {
    const { session, clock } = createSession()
    const enemy = session.spawnEnemy('shooter', OPEN_WATER)
    session.setEnemyDrive(enemy.id, { targetHeading: Math.PI / 2, forward: false })

    runSteps(session, clock, 30) // 0.5s × 0.6π rad/s = 0.3π < π/2: still turning
    // Step-quantized (±1 fixed step of rotation).
    const expected = DEFAULT_GAME_CONFIG.enemies.shooter.rotationSpeed * 0.5
    const rotationPerStep = DEFAULT_GAME_CONFIG.enemies.shooter.rotationSpeed * STEP
    expect(Math.abs(enemy.rotation - expected)).toBeLessThanOrEqual(rotationPerStep + 1e-9)
    runSteps(session, clock, 60) // plenty: must have snapped exactly, no overshoot
    expect(enemy.rotation).toBe(Math.PI / 2)
    expect(enemy.position).toEqual(OPEN_WATER) // rotation alone never moves
  })

  it('never leaves the arena and never penetrates islands, sliding instead', () => {
    const { session, clock } = createSession()
    const wallProbe = session.spawnEnemy('shooter', { x: 200, y: 450 }, -Math.PI / 2)
    session.setEnemyDrive(wallProbe.id, { targetHeading: null, forward: true })
    runSteps(session, clock, 180) // 3s straight into the left wall
    expect(wallProbe.position.x).toBeCloseTo(DEFAULT_GAME_CONFIG.enemies.shooter.collisionRadius, 6)

    const island = DEFAULT_ISLANDS[2]! // island-south (800, 650)
    const islandProbe = session.spawnEnemy('shooter', { x: island.x, y: island.y + 200 }, 0)
    session.setEnemyDrive(islandProbe.id, { targetHeading: null, forward: true })
    const combined =
      island.radius + DEFAULT_GAME_CONFIG.enemies.shooter.collisionRadius
    for (let i = 0; i < 300; i += 1) {
      runSteps(session, clock, 1)
      expect(
        Math.hypot(islandProbe.position.x - island.x, islandProbe.position.y - island.y),
      ).toBeGreaterThanOrEqual(combined - 1e-6)
    }

    // Oblique heading: slides along the island instead of sticking.
    const slider = session.spawnEnemy('shooter', { x: island.x - combined - 2, y: island.y + 100 }, 0)
    session.setEnemyDrive(slider.id, { targetHeading: null, forward: true })
    const startY = slider.position.y
    runSteps(session, clock, 60)
    expect(startY - slider.position.y).toBeGreaterThan(60) // 100 px/s shooter, minus radial loss
  })

  it('produces equivalent results across different frame cadences', () => {
    const outcomes = [300, 113].map((frames) => {
      const { session, clock } = createSession()
      const enemy = session.spawnEnemy('shooter', { x: 400, y: 700 }, 0)
      session.setEnemyDrive(enemy.id, { targetHeading: Math.PI / 4, forward: true })
      const slice = 5 / frames
      for (let i = 0; i < frames; i += 1) {
        clock.advance(slice)
        session.tick()
      }
      return enemy
    })
    const [a, b] = outcomes
    const maxStepTravel = DEFAULT_GAME_CONFIG.enemies.shooter.moveSpeed * STEP + 1e-6
    expect(Math.hypot(a!.position.x - b!.position.x, a!.position.y - b!.position.y)).toBeLessThanOrEqual(
      maxStepTravel,
    )
    expect(a!.rotation).toBeCloseTo(b!.rotation, 6)
  })

  it('removeEnemy removes from the simulation; destroy and new sessions start clean', () => {
    const { session } = createSession()
    const first = session.spawnEnemy('chaser', { x: 600, y: 450 })
    const second = session.spawnEnemy('shooter', OPEN_WATER)
    expect(session.removeEnemy(first.id)).toBe(true)
    expect(session.removeEnemy(first.id)).toBe(false) // already gone
    expect(session.enemies.map((enemy) => enemy.id)).toEqual([second.id])

    session.destroy()
    expect(session.enemies).toHaveLength(0)

    const fresh = createSession()
    expect(fresh.session.enemies).toHaveLength(0)
    expect(fresh.session.spawnEnemy('chaser', { x: 600, y: 450 }).id).toBe(1) // ids reset
  })
})
