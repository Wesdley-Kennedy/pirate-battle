import type { IslandObstacle } from '../config/arenaLayout'
import type { RandomSource } from '../core/random'
import type { EnemyState, EnemyType } from '../entities/enemy'
import type { Vec2 } from '../entities/player'

/**
 * Periodic enemy spawning: pure helpers consumed by GameSession inside
 * the fixed step. All randomness flows through the session's seeded
 * RandomSource with a FIXED consumption order (1. type unless forced,
 * 2. x/y per placement attempt), so a seed fully reproduces spawn
 * types, positions, timings and ids.
 */

/** Finite sampling budget: a failed interval skips its spawn, never hangs. */
export const MAX_SPAWN_ATTEMPTS = 40

/**
 * Minimum spawn distance from the player, derived from the live config:
 * - a Shooter must never be born already inside its attackRange
 *   (instant aimed fire would be unavoidable damage);
 * - a Chaser must give the player ~2 s of reaction time at its speed.
 * The larger threat wins, plus ~one ship length of breathing room.
 */
export function computeSafeSpawnDistance(config: {
  readonly enemies: {
    readonly chaser: { readonly moveSpeed: number }
    readonly shooter: { readonly attackRange: number }
  }
}): number {
  const REACTION_SECONDS = 2
  const SPAWN_MARGIN = 60
  const chaserThreat = config.enemies.chaser.moveSpeed * REACTION_SECONDS
  const shooterThreat = config.enemies.shooter.attackRange
  return Math.max(chaserThreat, shooterThreat) + SPAWN_MARGIN
}

/**
 * Weighted type pick over the configured weights (no need to sum to 1).
 * A zero weight disables that type entirely.
 */
export function pickEnemyType(
  random: RandomSource,
  chaserWeight: number,
  shooterWeight: number,
): EnemyType {
  const total = chaserWeight + shooterWeight
  return random.next() * total < chaserWeight ? 'chaser' : 'shooter'
}

export interface SpawnPlacementArgs {
  random: RandomSource
  arenaWidth: number
  arenaHeight: number
  enemyRadius: number
  islands: readonly IslandObstacle[]
  playerPosition: Readonly<Vec2>
  safeDistanceFromPlayer: number
  enemies: readonly EnemyState[]
  enemyRadiusFor: (enemy: EnemyState) => number
}

/**
 * Rejection-samples a valid spawn position: inside the walls with the
 * full hull margin, outside every island, at least safeDistance from the
 * player and not overlapping any existing enemy. Returns null when the
 * attempt budget is exhausted (caller skips this interval's spawn).
 */
export function tryFindSpawnPosition(args: SpawnPlacementArgs): Vec2 | null {
  const {
    random,
    arenaWidth,
    arenaHeight,
    enemyRadius,
    islands,
    playerPosition,
    safeDistanceFromPlayer,
    enemies,
    enemyRadiusFor,
  } = args

  attempts: for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt += 1) {
    const x = enemyRadius + random.next() * (arenaWidth - 2 * enemyRadius)
    const y = enemyRadius + random.next() * (arenaHeight - 2 * enemyRadius)

    if (Math.hypot(x - playerPosition.x, y - playerPosition.y) < safeDistanceFromPlayer) {
      continue
    }
    for (const island of islands) {
      if (Math.hypot(x - island.x, y - island.y) < enemyRadius + island.radius) {
        continue attempts
      }
    }
    for (const other of enemies) {
      const minDistance = enemyRadius + enemyRadiusFor(other)
      if (Math.hypot(x - other.position.x, y - other.position.y) < minDistance) {
        continue attempts
      }
    }
    return { x, y }
  }
  return null
}
