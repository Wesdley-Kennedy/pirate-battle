import { wrapAngle } from '../core/angles'
import type { EnemyDrive, EnemyState } from '../entities/enemy'
import type { Vec2 } from '../entities/player'
import { headingBetween } from './kinematics'

/**
 * Maximum angular error (radians) between the Shooter's bow and the line
 * to the player before it fires. ≈5.7°: at the 320 px attack range the
 * projectile line stays within ~32 px of the aim point — under the 35 px
 * combined hit radius — so a shot at max tolerance still hits a
 * stationary player. Visually the bow clearly points at the target.
 */
export const SHOOTER_AIM_TOLERANCE = 0.1

export interface ShooterDecision {
  drive: EnemyDrive
  wantsToFire: boolean
}

/**
 * Shooter AI: stateless. Approaches while beyond attackRange, holds
 * position inside it (no kiting), always turns toward the player's
 * CURRENT position, and wants to fire only when inside range AND aimed
 * within SHOOTER_AIM_TOLERANCE. Pure intent — movement, cooldown and the
 * actual shot are executed by the session systems.
 *
 * Range boundary note: with a stationary player the ship stops on the
 * first step inside the range and then holds still (forward just stays
 * false), so no hysteresis is needed — there is no oscillation to damp.
 */
export function computeShooterDecision(
  shooter: EnemyState,
  playerPosition: Vec2,
  attackRange: number,
): ShooterDecision {
  const dx = playerPosition.x - shooter.position.x
  const dy = playerPosition.y - shooter.position.y
  if (dx === 0 && dy === 0) {
    return { drive: { targetHeading: null, forward: false }, wantsToFire: false }
  }
  const targetHeading = headingBetween(shooter.position, playerPosition)
  const withinRange = Math.hypot(dx, dy) <= attackRange
  const aimError = Math.abs(wrapAngle(targetHeading - shooter.rotation))
  return {
    drive: { targetHeading, forward: !withinRange },
    wantsToFire: withinRange && aimError <= SHOOTER_AIM_TOLERANCE,
  }
}
