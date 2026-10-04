import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from '../config/gameConfig'
import { ManualClock } from '../core/clock'
import { GameSession } from '../core/gameSession'
import type { Projectile } from '../entities/projectile'
import { updateProjectiles } from './projectiles'
import { computeShooterDecision, SHOOTER_AIM_TOLERANCE } from './shooterAi'

const STEP = 1 / 60
const RANGE = DEFAULT_GAME_CONFIG.enemies.shooter.attackRange

function shooterAt(x: number, y: number, rotation = 0) {
  return { id: 1, type: 'shooter' as const, position: { x, y }, rotation, health: 50 }
}

function createSession(config = DEFAULT_GAME_CONFIG, playerStart = { x: 400, y: 450 }) {
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

function enemyProjectiles(session: GameSession): readonly Readonly<Projectile>[] {
  return session.projectiles.filter((projectile) => projectile.owner === 'enemy')
}

describe('computeShooterDecision (pure)', () => {
  it('always aims at the player; approaches outside range, holds inside', () => {
    const far = computeShooterDecision(shooterAt(400, 850), { x: 400, y: 450 }, RANGE)
    expect(far.drive.targetHeading).toBeCloseTo(0, 12)
    expect(far.drive.forward).toBe(true) // 400 px away > 320 range
    expect(far.wantsToFire).toBe(false)

    const near = computeShooterDecision(shooterAt(400, 650), { x: 400, y: 450 }, RANGE)
    expect(near.drive.forward).toBe(false) // 200 px away: hold position
    expect(near.drive.targetHeading).toBeCloseTo(0, 12)
    expect(near.wantsToFire).toBe(true) // aligned (rotation 0) and in range
  })

  it('refuses to fire when misaligned beyond the aim tolerance', () => {
    const misaligned = computeShooterDecision(
      shooterAt(400, 650, SHOOTER_AIM_TOLERANCE + 0.05),
      { x: 400, y: 450 },
      RANGE,
    )
    expect(misaligned.wantsToFire).toBe(false)

    const aligned = computeShooterDecision(
      shooterAt(400, 650, SHOOTER_AIM_TOLERANCE - 0.01),
      { x: 400, y: 450 },
      RANGE,
    )
    expect(aligned.wantsToFire).toBe(true)
  })

  it('is deterministic and NaN-free at zero distance', () => {
    const decision = computeShooterDecision(shooterAt(500, 500), { x: 500, y: 500 }, RANGE)
    expect(decision.drive.targetHeading).toBeNull()
    expect(decision.drive.forward).toBe(false)
    expect(decision.wantsToFire).toBe(false)
  })
})

describe('GameSession shooter behavior', () => {
  it('approaches on its own, stops inside the range and holds steady (no boundary jitter)', () => {
    const { session, clock } = createSession()
    const shooter = session.spawnEnemy('shooter', { x: 400, y: 850 }, 0) // 400 px away, aligned
    runSteps(session, clock, 60 * 5)

    const distance = Math.hypot(shooter.position.x - 400, shooter.position.y - 450)
    expect(distance).toBeLessThanOrEqual(RANGE)
    expect(distance).toBeGreaterThan(RANGE - 5) // stopped right inside, no deep push

    const before = { ...shooter.position }
    runSteps(session, clock, 60)
    // Holds perfectly still against a stationary player: zero oscillation,
    // which is why no hysteresis is needed.
    expect(shooter.position).toEqual(before)
  })

  it('fires only inside the range, with its own cadence, and rotates with its config speed', () => {
    const { session, clock } = createSession()
    session.spawnEnemy('shooter', { x: 400, y: 850 }, 0)

    // While approaching (distance > range) it must never fire.
    // 80 px to cover at 100 px/s ≈ 0.8 s.
    for (let i = 0; i < 46; i += 1) {
      runSteps(session, clock, 1)
      expect(enemyProjectiles(session)).toHaveLength(0)
    }

    // Each ball hits the player ~0.53 s after its shot, so the cumulative
    // hit counter is the reliable cadence observable: consecutive hits
    // must be separated by exactly the 1.6 s cooldown (± a step or two,
    // both shots share the same flight time).
    let firstHitStep = -1
    let secondHitStep = -1
    for (let i = 0; i < 400 && secondHitStep === -1; i += 1) {
      runSteps(session, clock, 1)
      if (firstHitStep === -1 && session.totalEnemyProjectileHits === 1) firstHitStep = i
      if (session.totalEnemyProjectileHits === 2) secondHitStep = i
    }
    expect(firstHitStep).toBeGreaterThan(0)
    expect(secondHitStep).toBeGreaterThan(firstHitStep)
    const gapSeconds = (secondHitStep - firstHitStep) * STEP
    expect(gapSeconds).toBeGreaterThan(1.55)
    expect(gapSeconds).toBeLessThan(1.7)
  })

  it('requires aim before the first shot when spawned pointing away', () => {
    const { session, clock } = createSession()
    // In range (200 px) but facing 90° off.
    const shooter = session.spawnEnemy('shooter', { x: 400, y: 650 }, Math.PI / 2)
    let fired = false
    for (let i = 0; i < 120; i += 1) {
      runSteps(session, clock, 1)
      if (enemyProjectiles(session).length > 0 && !fired) {
        fired = true
        // At the moment of the first shot the bow is within tolerance.
        expect(Math.abs(shooter.rotation)).toBeLessThanOrEqual(SHOOTER_AIM_TOLERANCE + 1e-9)
      }
    }
    expect(fired).toBe(true)
  })

  it('spawns the projectile at the bow with the ship facing as direction, owner enemy', () => {
    const { session, clock } = createSession()
    const shooter = session.spawnEnemy('shooter', { x: 400, y: 650 }, 0)
    runSteps(session, clock, 1)
    const projectile = enemyProjectiles(session)[0]!
    expect(projectile.owner).toBe('enemy')
    expect(projectile.direction.x).toBeCloseTo(Math.sin(shooter.rotation), 9)
    expect(projectile.direction.y).toBeCloseTo(-Math.cos(shooter.rotation), 9)
    // Origin = bow offset (62) + one step of flight (7 px) along -y.
    expect(projectile.position.x).toBeCloseTo(400, 9)
    expect(projectile.position.y).toBeCloseTo(650 - 62 - 420 * STEP, 6)
    expect(projectile.damage).toBe(DEFAULT_GAME_CONFIG.projectiles.enemyDamage)
  })

  it('two shooters own independent cooldowns and unique projectile ids', () => {
    const { session, clock } = createSession()
    // S1 in range and aligned; S2 still approaching (fires later).
    const s1 = session.spawnEnemy('shooter', { x: 400, y: 650 }, 0)
    const s2 = session.spawnEnemy('shooter', { x: 400, y: 820 }, 0)
    runSteps(session, clock, 1)
    expect(enemyProjectiles(session)).toHaveLength(1) // only S1
    const firstBallId = enemyProjectiles(session)[0]!.id

    // S1's ball hits the player ~0.25 s in; S2 enters range ~0.5 s in and
    // fires while S1's own cooldown (1.6 s) is still far from over —
    // which proves the timers are independent.
    runSteps(session, clock, 40)
    expect(session.totalEnemyProjectileHits).toBe(1) // S1's ball landed
    const live = enemyProjectiles(session)
    expect(live).toHaveLength(1) // S2's ball in flight
    expect(live[0]!.id).not.toBe(firstBallId)
    expect(s1.id).not.toBe(s2.id)
  })

  it('hits the player exactly once per ball: domain event with snapshot damage, no HP change', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.projectiles.enemyDamage = 33
    const { session, clock } = createSession(config)
    config.projectiles.enemyDamage = 1 // snapshot authority

    session.spawnEnemy('shooter', { x: 400, y: 650 }, 0)
    const playerBefore = { ...session.player.position }
    runSteps(session, clock, 30) // shot travels 138-35 px gap in ~0.25 s

    expect(session.totalEnemyProjectileHits).toBe(1)
    expect(enemyProjectiles(session)).toHaveLength(0) // removed on hit
    const events = session.consumeCombatEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'enemyProjectileHit', damage: 33 })
    expect(session.consumeCombatEvents()).toHaveLength(0) // once only
    expect(session.player.position).toEqual(playerBefore) // no knockback, no HP concept yet
  })

  it('enemy projectiles respect islands, arena bounds and cannot tunnel the player', () => {
    const { speed, collisionRadius } = DEFAULT_GAME_CONFIG.projectiles
    const playerRadius = DEFAULT_GAME_CONFIG.player.collisionRadius
    // Tunneling budget guard for the player target.
    expect(speed * STEP).toBeLessThan((collisionRadius + playerRadius) / 2)

    const makeBall = (overrides: Partial<Projectile>): Projectile => ({
      id: 1,
      owner: 'enemy',
      position: { x: 800, y: 450 },
      direction: { x: 0, y: -1 },
      speed,
      damage: 10,
      radius: collisionRadius,
      lifetimeRemaining: 1.2,
      ...overrides,
    })

    // Island blocks enemy balls exactly like player balls.
    const island = { x: 800, y: 200, radius: 88 }
    let islandHits = 0
    const list = [makeBall({})]
    for (let i = 0; i < 120; i += 1) {
      updateProjectiles(list, STEP, [island], 1600, 900, () => {
        islandHits += 1
      })
    }
    expect(islandHits).toBe(1)
    expect(list).toHaveLength(0)

    // Player hit beats everything and triggers exactly once.
    let playerHits = 0
    const target = { x: 800, y: 300, radius: playerRadius }
    const list2 = [makeBall({})]
    for (let i = 0; i < 120; i += 1) {
      updateProjectiles(list2, STEP, [], 1600, 900, () => {}, target, () => {
        playerHits += 1
      })
    }
    expect(playerHits).toBe(1)
    expect(list2).toHaveLength(0)

    // A PLAYER-owned ball must never collide with the player target.
    let selfHits = 0
    const list3 = [makeBall({ owner: 'player' })]
    for (let i = 0; i < 120; i += 1) {
      updateProjectiles(list3, STEP, [], 1600, 900, () => {}, target, () => {
        selfHits += 1
      })
    }
    expect(selfHits).toBe(0)

    // Arena exit still removes silently.
    const list4 = [makeBall({ position: { x: 20, y: 450 }, direction: { x: -1, y: 0 } })]
    for (let i = 0; i < 30; i += 1) {
      updateProjectiles(list4, STEP, [], 1600, 900, () => {
        throw new Error('no impact expected')
      })
    }
    expect(list4).toHaveLength(0)
  })

  it('pause freezes movement, cooldown and projectiles; resume fires on schedule without a burst', () => {
    const { session, clock } = createSession()
    session.spawnEnemy('shooter', { x: 400, y: 650 }, 0)
    runSteps(session, clock, 1) // first shot out, cooldown 1.6 s running
    const ball = enemyProjectiles(session)[0]!
    runSteps(session, clock, 29) // 0.5s elapsed total
    const frozenBall = { ...ball.position }

    session.pause()
    clock.advance(60) // long pause with everything held
    session.tick()
    expect(ball.position).toEqual(frozenBall)

    session.resume()
    // 0.5s elapsed before pause; cooldown needs 1.6s: after 0.9s more
    // (1.4s total) still exactly one shot ever fired…
    runSteps(session, clock, 54)
    expect(session.projectiles.every((p) => p.id === ball.id || p.owner !== 'enemy')).toBe(true)
    expect(session.totalEnemyProjectileHits + enemyProjectiles(session).length).toBeLessThanOrEqual(1)
    // …and after crossing 1.6s the second (single) shot arrives: no burst.
    runSteps(session, clock, 20)
    const enemyBallsNow = enemyProjectiles(session)
    expect(enemyBallsNow.length).toBeLessThanOrEqual(1)
  })

  it('removing a shooter cleans its cooldown and leaves in-flight projectiles alive', () => {
    const { session, clock } = createSession()
    const shooter = session.spawnEnemy('shooter', { x: 400, y: 750 }, 0) // 300 px: in range, aligned
    runSteps(session, clock, 1)
    const ball = enemyProjectiles(session)[0]!
    const ballYAtRemoval = ball.position.y

    expect(session.removeEnemy(shooter.id)).toBe(true)
    runSteps(session, clock, 10)
    expect(ball.position.y).toBeLessThan(ballYAtRemoval) // still flying
    // The ball still hits the player even though its shooter is gone.
    runSteps(session, clock, 40)
    expect(session.totalEnemyProjectileHits).toBe(1)
  })

  it('different frame cadences produce equivalent shooter outcomes', () => {
    const outcomes = [180, 71].map((frames) => {
      const { session, clock } = createSession()
      const shooter = session.spawnEnemy('shooter', { x: 400, y: 850 }, 0.4)
      const slice = 3 / frames
      for (let i = 0; i < frames; i += 1) {
        clock.advance(slice)
        session.tick()
      }
      return { shooter, session }
    })
    const [a, b] = outcomes
    const tolerance = DEFAULT_GAME_CONFIG.enemies.shooter.moveSpeed * STEP + 1e-6
    expect(
      Math.hypot(
        a!.shooter.position.x - b!.shooter.position.x,
        a!.shooter.position.y - b!.shooter.position.y,
      ),
    ).toBeLessThanOrEqual(tolerance)
    expect(
      Math.abs(a!.session.totalEnemyProjectileHits - b!.session.totalEnemyProjectileHits),
    ).toBeLessThanOrEqual(1)
  })

  it('a new session starts with clean cooldowns, counters and events', () => {
    const { session } = createSession()
    expect(session.totalEnemyProjectileHits).toBe(0)
    expect(session.consumeCombatEvents()).toHaveLength(0)
    expect(session.projectiles).toHaveLength(0)
  })
})
