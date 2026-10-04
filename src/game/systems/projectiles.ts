import type { EnemyState } from '../entities/enemy'
import type { Projectile } from '../entities/projectile'
import type { CircleObstacle } from './collision'

/**
 * Moves projectiles one fixed step, expires them, removes the ones that
 * left the arena and resolves island hits. Removal uses in-place
 * compaction (write-index), so iteration stays safe and allocation-free.
 *
 * Tunneling: a projectile travels speed × FIXED_STEP per step
 * (420/60 = 7 px by default) while the smallest hit target is
 * projectileRadius + playerRadius = 35 px (islands: 93 px) — discrete
 * detection cannot skip either unless a single step exceeded the
 * combined diameter. Unit tests guard this budget against config drift.
 */
export function updateProjectiles(
  projectiles: Projectile[],
  deltaSeconds: number,
  islands: readonly CircleObstacle[],
  arenaWidth: number,
  arenaHeight: number,
  onImpact: (x: number, y: number) => void,
  /** Enemy-owned projectiles test against this circle (the player). */
  playerTarget?: CircleObstacle,
  onPlayerHit?: (projectile: Projectile) => void,
  /**
   * Player-owned projectiles test against these (live array is fine: the
   * hit callback may remove the struck enemy, and iteration breaks right
   * after — no piercing, one enemy per ball, first in list order wins).
   */
  enemyTargets?: readonly EnemyState[],
  enemyRadiusFor?: (enemy: EnemyState) => number,
  onEnemyHit?: (projectile: Projectile, enemy: EnemyState) => void,
): void {
  let write = 0
  for (let i = 0; i < projectiles.length; i += 1) {
    const projectile = projectiles[i]!
    projectile.position.x += projectile.direction.x * projectile.speed * deltaSeconds
    projectile.position.y += projectile.direction.y * projectile.speed * deltaSeconds
    projectile.lifetimeRemaining -= deltaSeconds

    let alive = projectile.lifetimeRemaining > 0

    if (alive) {
      const { x, y } = projectile.position
      const margin = projectile.radius
      if (x < -margin || x > arenaWidth + margin || y < -margin || y > arenaHeight + margin) {
        alive = false // left the arena: silently removed, no impact
      }
    }

    // Target checks run before islands (documented priority): in the rare
    // frame where a ball overlaps both, the gameplay hit wins. A ball can
    // never cross an island to reach a target behind it anyway — the
    // island overlap happens many 7 px steps earlier.
    if (alive && enemyTargets && enemyRadiusFor && projectile.owner === 'player') {
      for (const enemy of enemyTargets) {
        const dx = projectile.position.x - enemy.position.x
        const dy = projectile.position.y - enemy.position.y
        const minDistance = projectile.radius + enemyRadiusFor(enemy)
        if (dx * dx + dy * dy < minDistance * minDistance) {
          alive = false
          onEnemyHit?.(projectile, enemy)
          break // one enemy per ball, no piercing
        }
      }
    }

    if (alive && playerTarget && projectile.owner === 'enemy') {
      const dx = projectile.position.x - playerTarget.x
      const dy = projectile.position.y - playerTarget.y
      const minDistance = projectile.radius + playerTarget.radius
      if (dx * dx + dy * dy < minDistance * minDistance) {
        alive = false
        onPlayerHit?.(projectile)
      }
    }

    if (alive) {
      for (const island of islands) {
        const dx = projectile.position.x - island.x
        const dy = projectile.position.y - island.y
        const minDistance = projectile.radius + island.radius
        if (dx * dx + dy * dy < minDistance * minDistance) {
          alive = false
          onImpact(projectile.position.x, projectile.position.y)
          break // exactly one impact, then gone
        }
      }
    }

    if (alive) {
      projectiles[write] = projectile
      write += 1
    }
  }
  projectiles.length = write
}
