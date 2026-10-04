import { wrapAngle } from '../core/angles'
import type { PlayerState } from '../entities/player'
import type { MovementIntent } from '../input/movementIntent'
import { moveForward } from './kinematics'

export interface PlayerMovementConfig {
  readonly moveSpeed: number
  readonly rotationSpeed: number
}

/**
 * Advances the player by one fixed simulation step. Mutates state in place
 * (no per-step allocation). Order within a step: rotate first, then move
 * along the updated heading — deterministic and documented.
 * Opposing turn inputs cancel each other out.
 */
export function updatePlayerMovement(
  player: PlayerState,
  intent: MovementIntent,
  config: PlayerMovementConfig,
  deltaSeconds: number,
): void {
  const turnDirection = (intent.turnRight ? 1 : 0) - (intent.turnLeft ? 1 : 0)
  if (turnDirection !== 0) {
    player.rotation = wrapAngle(player.rotation + turnDirection * config.rotationSpeed * deltaSeconds)
  }

  if (intent.forward) {
    moveForward(player.position, player.rotation, config.moveSpeed, deltaSeconds)
  }
}
