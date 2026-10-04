import type { EnemyDrive, EnemyState } from '../entities/enemy'
import type { Vec2 } from '../entities/player'
import { headingBetween } from './kinematics'

/**
 * Chaser AI: stateless direct pursuit. It only decides INTENT — the drive
 * is executed by enemyMovement (rotation via shortest arc, forward motion,
 * collision resolution). No Pixi, no timers, no position writes.
 *
 * Heading convention as everywhere: rotation 0 = up (-y), clockwise
 * positive, forward = (sin r, -cos r) → aim angle = atan2(dx, -dy).
 * Targets the player's CURRENT position each step (no prediction).
 */
export function computeChaserDrive(chaser: EnemyState, playerPosition: Vec2): EnemyDrive {
  const dx = playerPosition.x - chaser.position.x
  const dy = playerPosition.y - chaser.position.y
  if (dx === 0 && dy === 0) {
    // Degenerate exact overlap: hold course deterministically (impact
    // detection consumes this situation anyway). Never NaN.
    return { targetHeading: null, forward: false }
  }
  return { targetHeading: headingBetween(chaser.position, playerPosition), forward: true }
}
