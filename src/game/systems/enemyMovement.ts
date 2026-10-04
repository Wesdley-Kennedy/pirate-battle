import type { EnemyDrive, EnemyState } from '../entities/enemy'
import { resolveShipCollisions, type CircleObstacle } from './collision'
import { moveForward, rotateTowardHeading } from './kinematics'

export interface EnemyKinematicsConfig {
  readonly moveSpeed: number
  readonly rotationSpeed: number
  readonly collisionRadius: number
}

/**
 * Executes one fixed step of base enemy movement from a drive command.
 * Knows nothing about AI (PHASES 8–9 produce the drives) and reuses the
 * exact same collision resolution as the player, so enemies respect the
 * arena bounds and islands with identical sliding behavior.
 */
export function updateEnemyMovement(
  enemy: EnemyState,
  drive: EnemyDrive,
  config: EnemyKinematicsConfig,
  deltaSeconds: number,
  islands: readonly CircleObstacle[],
  arenaWidth: number,
  arenaHeight: number,
): void {
  if (drive.targetHeading !== null) {
    enemy.rotation = rotateTowardHeading(
      enemy.rotation,
      drive.targetHeading,
      config.rotationSpeed,
      deltaSeconds,
    )
  }
  if (drive.forward) {
    moveForward(enemy.position, enemy.rotation, config.moveSpeed, deltaSeconds)
  }
  resolveShipCollisions(enemy.position, config.collisionRadius, islands, arenaWidth, arenaHeight)
}
