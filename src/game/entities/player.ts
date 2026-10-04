/**
 * Pure simulation state for the player ship. No Pixi, no React, no DOM.
 *
 * Units and conventions (used across the whole simulation):
 * - position: logical arena pixels; +x right, +y down (screen-like axes).
 *   Origin (0,0) is the player spawn point until PHASE 5 defines the arena.
 * - rotation: radians; 0 = ship facing up (-y), positive = clockwise.
 *   Forward vector: (sin r, -cos r).
 * - speeds come from the session's GameConfig snapshot
 *   (moveSpeed px/s, rotationSpeed rad/s); simulation delta is in seconds.
 */
export interface Vec2 {
  x: number
  y: number
}

export interface PlayerState {
  position: Vec2
  rotation: number
  /** Current hit points; the maximum lives in the config snapshot. */
  health: number
}

export function createPlayerState(start: Vec2 = { x: 0, y: 0 }, maxHealth = 1): PlayerState {
  return {
    position: { x: start.x, y: start.y },
    rotation: 0,
    health: maxHealth,
  }
}
