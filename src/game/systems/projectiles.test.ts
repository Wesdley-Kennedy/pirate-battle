import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from '../config/gameConfig'
import { ManualClock } from '../core/clock'
import { FIXED_STEP_SECONDS, GameSession } from '../core/gameSession'
import type { Projectile } from '../entities/projectile'
import { updateProjectiles } from './projectiles'

const STEP = 1 / 60
const ARENA = { width: 1600, height: 900 }
const NO_IMPACT = () => {
  throw new Error('unexpected impact')
}

function makeProjectile(overrides: Partial<Projectile> = {}): Projectile {
  return {
    id: 1,
    owner: 'player',
    position: { x: 800, y: 450 },
    direction: { x: 0, y: -1 },
    speed: 420,
    damage: 10,
    radius: 5,
    lifetimeRemaining: 1.2,
    ...overrides,
  }
}

function createSession(options: { playerStart?: { x: number; y: number } } = {}) {
  const clock = new ManualClock()
  const session = new GameSession({
    config: DEFAULT_GAME_CONFIG,
    clock,
    seed: 1,
    playerStart: options.playerStart,
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

const FIRE_FRONT = { fireFront: true, fireLeft: false, fireRight: false }
const FIRE_NONE = { fireFront: false, fireLeft: false, fireRight: false }

describe('updateProjectiles (pure)', () => {
  it('moves along a fixed direction at speed × delta and never bends', () => {
    const projectile = makeProjectile()
    const list = [projectile]
    for (let i = 0; i < 60; i += 1) {
      updateProjectiles(list, STEP, [], ARENA.width, ARENA.height, NO_IMPACT)
    }
    expect(projectile.direction).toEqual({ x: 0, y: -1 })
    expect(projectile.position.x).toBeCloseTo(800, 9)
    expect(projectile.position.y).toBeCloseTo(450 - 420, 6)
  })

  it('expires when lifetime runs out (step-quantized)', () => {
    // 9.5 steps of lifetime: alive through step 9, gone at step 10 — the
    // half-step offset keeps float residue away from the boundary.
    const list = [makeProjectile({ lifetimeRemaining: 9.5 * STEP })]
    for (let i = 0; i < 9; i += 1) {
      updateProjectiles(list, STEP, [], ARENA.width, ARENA.height, NO_IMPACT)
    }
    expect(list).toHaveLength(1)
    updateProjectiles(list, STEP, [], ARENA.width, ARENA.height, NO_IMPACT)
    expect(list).toHaveLength(0)
  })

  it('is removed silently when it leaves the arena', () => {
    const list = [makeProjectile({ position: { x: 20, y: 450 }, direction: { x: -1, y: 0 } })]
    let steps = 0
    while (list.length > 0 && steps < 30) {
      updateProjectiles(list, STEP, [], ARENA.width, ARENA.height, NO_IMPACT)
      steps += 1
    }
    expect(list).toHaveLength(0)
    expect(steps).toBeLessThan(10) // removed by bounds, long before lifetime
  })

  it('hits an island exactly once and is removed immediately', () => {
    const island = { x: 800, y: 200, radius: 88 }
    const list = [makeProjectile()]
    let impacts = 0
    for (let i = 0; i < 120; i += 1) {
      updateProjectiles(list, STEP, [island], ARENA.width, ARENA.height, () => {
        impacts += 1
      })
    }
    expect(impacts).toBe(1)
    expect(list).toHaveLength(0)
  })

  it('cannot tunnel through an island at the configured speed', () => {
    const { speed, collisionRadius, lifetimeSeconds } = DEFAULT_GAME_CONFIG.projectiles
    const island = { x: 800, y: 200, radius: 88 }
    // Guard against config drift: one step of travel must stay well below
    // the combined collision diameter, otherwise swept checks are needed.
    expect(speed * FIXED_STEP_SECONDS).toBeLessThan((collisionRadius + island.radius) / 2)

    const list = [
      makeProjectile({ speed, radius: collisionRadius, lifetimeRemaining: lifetimeSeconds }),
    ]
    let impacts = 0
    while (list.length > 0) {
      updateProjectiles(list, STEP, [island], ARENA.width, ARENA.height, () => {
        impacts += 1
      })
      const projectile = list[0]
      if (projectile) {
        // Never alive on the far side of the island.
        expect(projectile.position.y).toBeGreaterThan(island.y - island.radius - projectile.radius)
      }
    }
    expect(impacts).toBe(1)
  })
})

describe('GameSession weapons integration', () => {
  it('front fire creates exactly 1 projectile; broadsides create exactly 3', () => {
    const { session, clock } = createSession()
    session.setWeaponIntent(FIRE_FRONT)
    runSteps(session, clock, 1)
    expect(session.projectiles).toHaveLength(1)
    expect(session.projectiles[0]!.id).toBe(1)
    expect(session.projectiles[0]!.owner).toBe('player')

    const left = createSession()
    left.session.setWeaponIntent({ ...FIRE_NONE, fireLeft: true })
    runSteps(left.session, left.clock, 1)
    expect(left.session.projectiles).toHaveLength(3)

    const right = createSession()
    right.session.setWeaponIntent({ ...FIRE_NONE, fireRight: true })
    runSteps(right.session, right.clock, 1)
    expect(right.session.projectiles).toHaveLength(3)
  })

  it('cooldown blocks early shots and allows firing right after expiry', () => {
    const { session, clock } = createSession()
    session.setWeaponIntent(FIRE_FRONT)
    runSteps(session, clock, 1) // fires immediately
    expect(session.projectiles).toHaveLength(1)
    runSteps(session, clock, 24) // 0.4s of the 0.5s cooldown: still blocked
    expect(session.projectiles).toHaveLength(1)
    runSteps(session, clock, 12) // comfortably past the cooldown (±1 step float residue)
    expect(session.projectiles).toHaveLength(2)
    expect(session.projectiles[1]!.id).toBe(2)
  })

  it('holding the key respects the cooldown cadence over time', () => {
    const { session, clock } = createSession()
    session.setWeaponIntent(FIRE_FRONT)
    // 2s held with 0.5s cooldown → shots ~t=0, 0.5, 1.0, 1.5 (each ±1 step).
    // The 2.0s shot cannot land within 120 steps even with residue drift.
    runSteps(session, clock, 120)
    const ids = session.projectiles.map((p) => p.id) // older ones already expired
    expect(Math.max(...ids)).toBe(4)
  })

  it('movement and firing work simultaneously', () => {
    const { session, clock } = createSession({ playerStart: { x: 800, y: 450 } })
    session.setPlayerIntent({ forward: true, turnLeft: false, turnRight: true })
    session.setWeaponIntent(FIRE_FRONT)
    runSteps(session, clock, 30)
    expect(session.projectiles.length).toBeGreaterThan(0)
    expect(session.player.position.y).not.toBe(450)
    expect(session.player.rotation).toBeGreaterThan(0)
  })

  it('player rotation changes the shot direction accordingly', () => {
    const { session, clock } = createSession({ playerStart: { x: 800, y: 450 } })
    session.player.rotation = Math.PI / 2 // facing +x
    session.setWeaponIntent(FIRE_FRONT)
    runSteps(session, clock, 1)
    const projectile = session.projectiles[0]!
    expect(projectile.direction.x).toBeCloseTo(1, 9)
    expect(projectile.direction.y).toBeCloseTo(0, 9)
    expect(projectile.position.x).toBeGreaterThan(800)
  })

  it('pause freezes projectiles and cooldowns; resume continues without a burst', () => {
    const { session, clock } = createSession({ playerStart: { x: 800, y: 450 } })
    session.setWeaponIntent(FIRE_FRONT)
    runSteps(session, clock, 6) // fires at step 1, cooldown counting down
    const frozen = session.projectiles[0]!
    const positionAtPause = { ...frozen.position }
    const lifetimeAtPause = frozen.lifetimeRemaining
    const cooldownAtPause = session.weaponCooldowns.front

    session.pause() // PHASE 12: pausing clears held intents
    clock.advance(30) // long pause
    session.tick()
    expect(frozen.position).toEqual(positionAtPause)
    expect(frozen.lifetimeRemaining).toBe(lifetimeAtPause)
    expect(session.weaponCooldowns.front).toBe(cooldownAtPause)
    expect(session.projectiles).toHaveLength(1)

    session.resume()
    session.setWeaponIntent(FIRE_FRONT) // the player presses again after resume
    runSteps(session, clock, 18) // 0.1 + 0.3s total elapsed < 0.5s cooldown
    expect(session.projectiles).toHaveLength(1) // no burst, cooldown respected
    runSteps(session, clock, 12) // crosses the 0.5s boundary
    expect(session.projectiles).toHaveLength(2)
  })

  it('destroy clears projectiles and a new session starts from zero with reset ids', () => {
    const { session, clock } = createSession()
    session.setWeaponIntent({ fireFront: true, fireLeft: true, fireRight: true })
    runSteps(session, clock, 1)
    expect(session.projectiles.length).toBe(7)
    session.destroy()
    expect(session.projectiles).toHaveLength(0)

    const fresh = createSession()
    expect(fresh.session.projectiles).toHaveLength(0)
    expect(fresh.session.weaponCooldowns).toEqual({ front: 0, left: 0, right: 0 })
    fresh.session.setWeaponIntent(FIRE_FRONT)
    runSteps(fresh.session, fresh.clock, 1)
    expect(fresh.session.projectiles[0]!.id).toBe(1)
  })

  it('different frame cadences produce the same projectile state', () => {
    const results = [180, 67].map((frames) => {
      const { session, clock } = createSession({ playerStart: { x: 300, y: 450 } })
      session.setPlayerIntent({ forward: true, turnLeft: false, turnRight: false })
      session.setWeaponIntent(FIRE_FRONT)
      const slice = 1.0 / frames
      for (let i = 0; i < frames; i += 1) {
        clock.advance(slice)
        session.tick()
      }
      return session
    })
    const [a, b] = results
    expect(Math.abs(a!.projectiles.length - b!.projectiles.length)).toBeLessThanOrEqual(1)
    const common = Math.min(a!.projectiles.length, b!.projectiles.length)
    for (let i = 0; i < common; i += 1) {
      const pa = a!.projectiles[i]!
      const pb = b!.projectiles[i]!
      expect(pa.id).toBe(pb.id)
      // Step-quantized: at most one fixed step of travel apart.
      expect(Math.abs(pa.position.y - pb.position.y)).toBeLessThanOrEqual(420 * STEP + 1e-6)
    }
  })
})
