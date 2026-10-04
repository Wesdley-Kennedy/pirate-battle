import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG, type GameConfig } from '../config/gameConfig'
import { ManualClock } from '../core/clock'
import { GameSession } from '../core/gameSession'
import type { Projectile } from '../entities/projectile'
import { applyDamage, damageTierFor } from './damage'
import { updateProjectiles } from './projectiles'

const STEP = 1 / 60
const HOLD = { targetHeading: null, forward: false }
const FIRE_FRONT = { fireFront: true, fireLeft: false, fireRight: false }
const FIRE_NONE = { fireFront: false, fireLeft: false, fireRight: false }

function createSession(config: GameConfig = DEFAULT_GAME_CONFIG, playerStart = { x: 400, y: 700 }) {
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

/** Spawns a shooter held still by a manual drive: a stationary target. */
function spawnTargetShooter(session: GameSession, x: number, y: number) {
  const enemy = session.spawnEnemy('shooter', { x, y }, 0)
  session.setEnemyDrive(enemy.id, HOLD)
  return enemy
}

/** Fires exactly one front shot (intent held for a single step). */
function fireFrontOnce(session: GameSession, clock: ManualClock): void {
  session.setWeaponIntent(FIRE_FRONT)
  runSteps(session, clock, 1)
  session.setWeaponIntent(FIRE_NONE)
}

describe('damage helpers', () => {
  it('applyDamage clamps at zero', () => {
    expect(applyDamage(100, 30)).toBe(70)
    expect(applyDamage(10, 50)).toBe(0)
  })

  it('damageTierFor maps health ratios to the three visual tiers', () => {
    expect(damageTierFor(100, 100)).toBe(0)
    expect(damageTierFor(67, 100)).toBe(0)
    expect(damageTierFor(66, 100)).toBe(1)
    expect(damageTierFor(34, 100)).toBe(1)
    expect(damageTierFor(33, 100)).toBe(2)
    expect(damageTierFor(1, 100)).toBe(2)
  })
})

describe('health initialization', () => {
  it('player, chaser and shooter start at their config maximums', () => {
    const { session } = createSession()
    expect(session.player.health).toBe(DEFAULT_GAME_CONFIG.player.maxHealth)
    const chaser = session.spawnEnemy('chaser', { x: 1300, y: 800 })
    const shooter = spawnTargetShooter(session, 1000, 200)
    expect(chaser.health).toBe(DEFAULT_GAME_CONFIG.enemies.chaser.maxHealth)
    expect(shooter.health).toBe(DEFAULT_GAME_CONFIG.enemies.shooter.maxHealth)
  })
})

describe('player projectile → enemy', () => {
  it('reduces HP by the snapshot damage, removes the ball, and never hits twice', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.projectiles.frontDamage = 7
    const { session, clock } = createSession(config)
    config.projectiles.frontDamage = 999 // later mutation must not leak in

    const target = spawnTargetShooter(session, 400, 450) // straight ahead
    fireFrontOnce(session, clock)
    runSteps(session, clock, 30) // ball covers the gap and hits

    expect(target.health).toBe(50 - 7)
    expect(session.projectiles).toHaveLength(0) // removed on hit
    expect(session.enemies).toHaveLength(1) // non-lethal: still alive
    expect(session.score).toBe(0) // hits never score

    runSteps(session, clock, 60) // nothing else in flight
    expect(target.health).toBe(50 - 7) // exactly one application
  })

  it('lethal hit removes the enemy in the same step, scores +1 and explodes once', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.projectiles.frontDamage = 50 // one-shot the 50 HP shooter
    const { session, clock } = createSession(config)
    spawnTargetShooter(session, 400, 450)

    session.consumeVisualEvents() // drop spawn-phase noise
    fireFrontOnce(session, clock)
    let explosions = 0
    for (let i = 0; i < 40; i += 1) {
      runSteps(session, clock, 1)
      for (const event of session.consumeVisualEvents()) {
        if (event.type === 'explosion') explosions += 1
      }
    }
    expect(session.enemies).toHaveLength(0)
    expect(session.score).toBe(1)
    expect(explosions).toBe(1)
  })

  it('overkill kills once and scores once', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.projectiles.frontDamage = 5000
    const { session, clock } = createSession(config)
    spawnTargetShooter(session, 400, 450)
    fireFrontOnce(session, clock)
    runSteps(session, clock, 60)
    expect(session.enemies).toHaveLength(0)
    expect(session.score).toBe(1)
  })

  it('a chaser killed by a player ball scores +1', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.projectiles.frontDamage = 30 // chaser max HP
    // Corridor x = 1000 is island-free top to bottom.
    const { session, clock } = createSession(config, { x: 1000, y: 700 })
    // Head-on: the chaser charges straight down the firing line.
    session.spawnEnemy('chaser', { x: 1000, y: 200 }, Math.PI)
    session.setWeaponIntent(FIRE_FRONT) // keep firing while it approaches
    runSteps(session, clock, 60)
    expect(session.score).toBe(1)
    expect(session.enemies).toHaveLength(0)
    expect(session.totalChaserImpacts).toBe(0)
    expect(session.player.health).toBe(DEFAULT_GAME_CONFIG.player.maxHealth)
  })

  it('broadside hitting one enemy in the same steps kills once, scores once, no mutation crash', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.enemies.shooter.maxHealth = 30 // exactly 3 × broadsideDamage
    const { session, clock } = createSession(config)
    const target = spawnTargetShooter(session, 560, 700) // starboard side

    session.setWeaponIntent({ fireFront: false, fireLeft: false, fireRight: true })
    runSteps(session, clock, 1)
    session.setWeaponIntent(FIRE_NONE)
    expect(session.projectiles).toHaveLength(3)

    runSteps(session, clock, 60)
    expect(session.enemies).toHaveLength(0)
    expect(session.score).toBe(1)
    expect(session.projectiles).toHaveLength(0)
    expect(target.health).toBe(0)
  })

  it('an island still blocks a ball aimed at an enemy behind it (pure)', () => {
    const island = { x: 800, y: 300, radius: 88 }
    const enemyBehind = {
      id: 9,
      type: 'shooter' as const,
      position: { x: 800, y: 150 },
      rotation: 0,
      health: 50,
    }
    const ball: Projectile = {
      id: 1,
      owner: 'player',
      position: { x: 800, y: 520 },
      direction: { x: 0, y: -1 },
      speed: 420,
      damage: 10,
      radius: 5,
      lifetimeRemaining: 2,
    }
    const list = [ball]
    let islandHits = 0
    let enemyHits = 0
    for (let i = 0; i < 120; i += 1) {
      updateProjectiles(
        list,
        STEP,
        [island],
        1600,
        900,
        () => {
          islandHits += 1
        },
        undefined,
        undefined,
        [enemyBehind],
        () => 30,
        () => {
          enemyHits += 1
        },
      )
    }
    expect(islandHits).toBe(1)
    expect(enemyHits).toBe(0)
    expect(enemyBehind.health).toBe(50)
  })

  it('enemy-owned balls never hit enemies (pure)', () => {
    const bystander = {
      id: 9,
      type: 'shooter' as const,
      position: { x: 800, y: 300 },
      rotation: 0,
      health: 50,
    }
    const ball: Projectile = {
      id: 1,
      owner: 'enemy',
      position: { x: 800, y: 450 },
      direction: { x: 0, y: -1 },
      speed: 420,
      damage: 10,
      radius: 5,
      lifetimeRemaining: 1.2,
    }
    const list = [ball]
    let enemyHits = 0
    for (let i = 0; i < 60; i += 1) {
      updateProjectiles(list, STEP, [], 1600, 900, () => {}, undefined, undefined, [bystander], () => 30, () => {
        enemyHits += 1
      })
    }
    expect(enemyHits).toBe(0)
  })
})

describe('damage to the player', () => {
  it('enemy projectile reduces player HP inside the core, same step', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.projectiles.enemyDamage = 15
    const { session, clock } = createSession(config)
    session.spawnEnemy('shooter', { x: 400, y: 480 }, Math.PI) // AI: in range, aligned
    runSteps(session, clock, 30)
    expect(session.player.health).toBe(100 - 15)
    // Events are observational only: never consumed here, HP already fell.
  })

  it('chaser impact reduces player HP and never scores', () => {
    const { session, clock } = createSession()
    session.spawnEnemy('chaser', { x: 400, y: 850 }, 0)
    for (let i = 0; i < 300 && session.totalChaserImpacts === 0; i += 1) {
      runSteps(session, clock, 1)
    }
    expect(session.totalChaserImpacts).toBe(1)
    expect(session.player.health).toBe(100 - DEFAULT_GAME_CONFIG.enemies.chaser.collisionDamage)
    expect(session.score).toBe(0)
  })

  it('player HP clamps at 0 and massive damage ends the session with player-death', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.enemies.chaser.collisionDamage = 5000
    const { session, clock } = createSession(config)
    session.spawnEnemy('chaser', { x: 400, y: 850 }, 0)
    for (let i = 0; i < 300 && session.state === 'running'; i += 1) {
      runSteps(session, clock, 1)
    }
    expect(session.player.health).toBe(0)
    expect(session.state).toBe('ended')
    expect(session.endReason).toBe('player-death')
  })
})

describe('player death gameplay freeze', () => {
  function killPlayer() {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.enemies.chaser.collisionDamage = 150
    const created = createSession(config)
    created.session.spawnEnemy('chaser', { x: 400, y: 850 }, 0)
    for (let i = 0; i < 400 && created.session.state === 'running'; i += 1) {
      runSteps(created.session, created.clock, 1)
    }
    expect(created.session.state).toBe('ended')
    return created
  }

  it('a dead player cannot move or fire, and nothing drifts afterwards', () => {
    const { session, clock } = killPlayer()
    const position = { ...session.player.position }
    session.setPlayerIntent({ forward: true, turnLeft: false, turnRight: false })
    session.setWeaponIntent(FIRE_FRONT)
    runSteps(session, clock, 120)
    expect(session.player.position).toEqual(position)
    expect(session.projectiles).toHaveLength(0)
    expect(session.player.health).toBe(0)
    expect(session.endReason).toBe('player-death')
  })
})

describe('pause / restart semantics', () => {
  it('pause blocks damage; resume keeps health; a new session restores everything', () => {
    const { session, clock } = createSession()
    session.spawnEnemy('shooter', { x: 400, y: 480 }, Math.PI)
    runSteps(session, clock, 5) // shot in flight, not yet landed
    session.pause()
    clock.advance(10)
    session.tick()
    expect(session.player.health).toBe(100) // frozen mid-flight, no damage

    session.resume()
    runSteps(session, clock, 60)
    expect(session.player.health).toBe(90) // landed after resume, exactly once

    const fresh = createSession()
    expect(fresh.session.player.health).toBe(100)
    expect(fresh.session.score).toBe(0)
    expect(fresh.session.endReason).toBeNull()
  })

  it('manual removeEnemy never scores', () => {
    const { session } = createSession()
    const enemy = spawnTargetShooter(session, 1000, 200)
    session.removeEnemy(enemy.id)
    expect(session.score).toBe(0)
  })

  it('frame cadences produce the same health and score outcome', () => {
    const outcomes = [180, 67].map((frames) => {
      const config = structuredClone(DEFAULT_GAME_CONFIG)
      config.projectiles.frontDamage = 50
      const { session, clock } = createSession(config)
      spawnTargetShooter(session, 400, 450)
      session.setWeaponIntent(FIRE_FRONT)
      const slice = 3 / frames
      for (let i = 0; i < frames; i += 1) {
        clock.advance(slice)
        session.tick()
      }
      return session
    })
    expect(outcomes[0]!.score).toBe(outcomes[1]!.score)
    expect(outcomes[0]!.player.health).toBe(outcomes[1]!.player.health)
  })
})
