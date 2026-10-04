import type { Vec2 } from './player'

/**
 * Pure simulation state for a cannon ball. No Pixi, no React.
 * `direction` is a unit vector fixed at spawn; `owner` decides which team
 * the projectile can damage once enemies exist (PHASE 10 contract).
 * A projectile applies at most one impact: any hit removes it immediately.
 */
export type ProjectileOwner = 'player' | 'enemy'

export interface Projectile {
  /** Deterministic per-session id (incremental, starts at 1). */
  id: number
  owner: ProjectileOwner
  position: Vec2
  direction: Vec2
  speed: number
  damage: number
  radius: number
  lifetimeRemaining: number
}
