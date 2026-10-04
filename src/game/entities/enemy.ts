import type { Vec2 } from './player'

/**
 * Pure simulation state shared by both enemy kinds. No Pixi, no React.
 * The discriminant selects per-type config (speed, radius, ...) and, from
 * PHASE 8/9 on, the AI system that drives it. Health arrives in PHASE 10.
 */
export type EnemyType = 'chaser' | 'shooter'

export interface EnemyState {
  /** Deterministic per-session id (incremental, starts at 1). */
  id: number
  type: EnemyType
  position: Vec2
  rotation: number
  /** Current hit points; the per-type maximum lives in the config snapshot. */
  health: number
}

/**
 * Base movement command executed by the enemy movement system. Today it
 * is fed by the dev/test API; the Chaser/Shooter AIs of PHASES 8–9 become
 * the production producers of these commands.
 */
export interface EnemyDrive {
  /** Heading to rotate toward (shortest arc), or null to hold course. */
  targetHeading: number | null
  forward: boolean
}
