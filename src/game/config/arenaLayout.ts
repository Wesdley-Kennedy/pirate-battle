import type { Vec2 } from '../entities/player'

/**
 * Deterministic map data for the default arena (1600×900 logical pixels).
 * This is layout, not balancing — it lives apart from GameConfig on purpose.
 *
 * Placement constraints (keep them when editing):
 * - every island stays ≥ islandRadius + 2×playerRadius + margin away from
 *   each arena wall, and island surface gaps are ≥ 140 px, so the
 *   iterative collision resolution always converges in one or two passes
 *   and every channel stays navigable;
 * - the spawn is in open water, respects the wall margin and starts far
 *   from every island.
 *
 * Collision geometry is pure simulation data (usable in Node without
 * loading any image). The renderer draws each island as a 3×3 tile patch
 * (192×192 px visual) around the same center; the 88 px collision radius
 * sits slightly inside the visual coastline for forgiving gameplay.
 */
export interface IslandObstacle {
  id: string
  x: number
  y: number
  radius: number
}

export const DEFAULT_ISLANDS: readonly IslandObstacle[] = [
  { id: 'island-west', x: 450, y: 270, radius: 88 },
  { id: 'island-east', x: 1180, y: 300, radius: 88 },
  { id: 'island-south', x: 800, y: 650, radius: 88 },
]

export const PLAYER_SPAWN: Readonly<Vec2> = { x: 240, y: 700 }
