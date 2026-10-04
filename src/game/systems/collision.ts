import type { Vec2 } from '../entities/player'

/**
 * Circle-based collision for ships vs. arena bounds and island obstacles.
 * Pure math, mutates positions in place (no per-step allocation).
 *
 * Tunneling: the fastest ship moves moveSpeed × FIXED_STEP = 180/60 = 3 px
 * per fixed step — far below any collision radius (≥ 30 px) — so discrete
 * detection cannot tunnel and no swept test is needed.
 */

export interface CircleObstacle {
  x: number
  y: number
  radius: number
}

/** Keeps a circle fully inside the rect [0..width]×[0..height]. */
export function clampCircleToRect(
  position: Vec2,
  radius: number,
  width: number,
  height: number,
): boolean {
  const minX = radius
  const maxX = width - radius
  const minY = radius
  const maxY = height - radius
  let moved = false
  if (position.x < minX) {
    position.x = minX
    moved = true
  } else if (position.x > maxX) {
    position.x = maxX
    moved = true
  }
  if (position.y < minY) {
    position.y = minY
    moved = true
  } else if (position.y > maxY) {
    position.y = maxY
    moved = true
  }
  return moved
}

/**
 * Projects a penetrating circle back onto the obstacle surface along the
 * center-to-center normal. Removing only the radial component preserves
 * the tangential one, which yields natural sliding along obstacles.
 */
export function pushCircleOutOfCircle(
  position: Vec2,
  radius: number,
  obstacle: CircleObstacle,
): boolean {
  const dx = position.x - obstacle.x
  const dy = position.y - obstacle.y
  const minDistance = radius + obstacle.radius
  const distanceSq = dx * dx + dy * dy
  if (distanceSq >= minDistance * minDistance) return false

  const distance = Math.sqrt(distanceSq)
  if (distance > 1e-6) {
    const scale = minDistance / distance
    position.x = obstacle.x + dx * scale
    position.y = obstacle.y + dy * scale
  } else {
    // Degenerate: exactly centered on the obstacle — push up, deterministically.
    position.x = obstacle.x
    position.y = obstacle.y - minDistance
  }
  return true
}

/**
 * Resolves a ship position against all islands and the arena bounds.
 * The short relaxation loop handles rare chained corrections (e.g. an
 * island push nudging the ship into a wall); with the documented layout
 * margins it converges in one or two passes.
 */
export function resolveShipCollisions(
  position: Vec2,
  radius: number,
  islands: readonly CircleObstacle[],
  arenaWidth: number,
  arenaHeight: number,
): void {
  for (let pass = 0; pass < 3; pass += 1) {
    let moved = false
    for (const island of islands) {
      if (pushCircleOutOfCircle(position, radius, island)) moved = true
    }
    if (clampCircleToRect(position, radius, arenaWidth, arenaHeight)) moved = true
    if (!moved) break
  }
}
