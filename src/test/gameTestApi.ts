import type { GameSession, GameSessionState } from '../game/core/gameSession'

/**
 * Minimal read-only instrumentation for Playwright. Installed only in dev
 * builds (`import.meta.env.DEV`). Exposes plain-value snapshots — never
 * Pixi objects or mutable simulation internals, and no way to teleport the
 * player: tests must drive the real controls.
 */
export interface GameTestSnapshot {
  lifecycle: GameSessionState
  activeElapsedSeconds: number
  arena: { width: number; height: number }
  player: {
    x: number
    y: number
    rotation: number
    collisionRadius: number
    health: number
    maxHealth: number
    alive: boolean
  }
  islands: { id: string; x: number; y: number; radius: number }[]
  score: number
  endReason: string | null
  remainingSeconds: number
  projectiles: {
    id: number
    owner: string
    x: number
    y: number
    directionX: number
    directionY: number
    lifetimeRemaining: number
  }[]
  weaponCooldowns: { front: number; left: number; right: number }
  totalShotsFired: number
  totalIslandImpacts: number
  totalChaserImpacts: number
  totalEnemyProjectileHits: number
  totalAutomaticSpawns: number
  totalSpawnFailures: number
  spawnCooldownSeconds: number
  seed: number
  enemies: {
    id: number
    type: string
    x: number
    y: number
    rotation: number
    health: number
    maxHealth: number
  }[]
}

export interface GameTestApi {
  snapshot(): GameTestSnapshot
  /**
   * Lifecycle-only controls (no state teleporting): they invoke the real
   * session transitions so Playwright can exercise pause behavior before
   * the pause UI exists. Guarded to avoid invalid-transition throws.
   */
  pause(): void
  resume(): void
  /**
   * Deterministic enemy controls for PHASE 7+ tests: they call the real
   * session APIs, so spawn validation and collision are never bypassed.
   * The periodic production spawner arrives in PHASE 11.
   */
  spawnEnemy(type: 'chaser' | 'shooter', x: number, y: number, rotation?: number): number
  removeEnemy(id: number): boolean
  setEnemyDrive(id: number, targetHeading: number | null, forward: boolean): void
  /**
   * Fast-forwards a RUNNING match through REAL simulation (fixed steps,
   * spawns, AI, clamp all execute normally) — lets E2E finish a genuine
   * 60–180 s match in moments without faking any rule.
   */
  advanceTime(seconds: number): void
  /** Restarts after the match ended; optional seed for replay tests. */
  restart(seed?: number): void
}

export interface GameTestControls {
  advanceTime(seconds: number): void
  restart(seed?: number): void
}

declare global {
  interface Window {
    __gameTest?: GameTestApi
  }
}

export function installGameTestApi(session: GameSession, controls: GameTestControls): () => void {
  if (!import.meta.env.DEV) return () => {}

  const api: GameTestApi = {
    snapshot: () => ({
      lifecycle: session.state,
      activeElapsedSeconds: session.activeElapsedSeconds,
      arena: {
        width: session.config.arena.width,
        height: session.config.arena.height,
      },
      player: {
        x: session.player.position.x,
        y: session.player.position.y,
        rotation: session.player.rotation,
        collisionRadius: session.config.player.collisionRadius,
        health: session.player.health,
        maxHealth: session.config.player.maxHealth,
        alive: session.player.health > 0,
      },
      islands: session.islands.map((island) => ({ ...island })),
      score: session.score,
      endReason: session.endReason,
      remainingSeconds: session.remainingSeconds,
      projectiles: session.projectiles.map((projectile) => ({
        id: projectile.id,
        owner: projectile.owner,
        x: projectile.position.x,
        y: projectile.position.y,
        directionX: projectile.direction.x,
        directionY: projectile.direction.y,
        lifetimeRemaining: projectile.lifetimeRemaining,
      })),
      weaponCooldowns: session.weaponCooldowns,
      totalShotsFired: session.totalShotsFired,
      totalIslandImpacts: session.totalIslandImpacts,
      totalChaserImpacts: session.totalChaserImpacts,
      totalEnemyProjectileHits: session.totalEnemyProjectileHits,
      totalAutomaticSpawns: session.totalAutomaticSpawns,
      totalSpawnFailures: session.totalSpawnFailures,
      spawnCooldownSeconds: session.spawnCooldownSeconds,
      seed: session.seed,
      enemies: session.enemies.map((enemy) => ({
        id: enemy.id,
        type: enemy.type,
        x: enemy.position.x,
        y: enemy.position.y,
        rotation: enemy.rotation,
        health: enemy.health,
        maxHealth: session.config.enemies[enemy.type].maxHealth,
      })),
    }),
    pause: () => {
      if (session.state === 'running') session.pause()
    },
    resume: () => {
      if (session.state === 'paused') session.resume()
    },
    spawnEnemy: (type, x, y, rotation = 0) => session.spawnEnemy(type, { x, y }, rotation).id,
    removeEnemy: (id) => session.removeEnemy(id),
    setEnemyDrive: (id, targetHeading, forward) =>
      session.setEnemyDrive(id, { targetHeading, forward }),
    advanceTime: (seconds) => controls.advanceTime(seconds),
    restart: (seed) => controls.restart(seed),
  }
  window.__gameTest = api

  return () => {
    if (window.__gameTest === api) delete window.__gameTest
  }
}
