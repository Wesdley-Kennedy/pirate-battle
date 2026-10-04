import { wrapAngle } from '../core/angles'
import type { Vec2 } from '../entities/player'

/**
 * Shared ship kinematics (player and enemies). Same angular convention
 * everywhere: rotation 0 = facing up (-y), positive = clockwise,
 * forward = (sin r, -cos r). Pure math on fixed-step deltas — no AI,
 * no Pixi, no Clock.
 */

/** Heading from one point toward another, in the simulation convention. */
export function headingBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, -(to.y - from.y))
}

/** Advances a position along its heading. Mutates in place. */
export function moveForward(position: Vec2, rotation: number, speed: number, deltaSeconds: number): void {
  const distance = speed * deltaSeconds
  position.x += Math.sin(rotation) * distance
  position.y -= Math.cos(rotation) * distance
}

/**
 * Rotates toward a target heading along the SHORTEST arc, clamped to
 * rotationSpeed × dt (never overshoots: snaps exactly onto the target on
 * the final step). Result stays normalized to [-PI, PI). Deterministic,
 * including the ±PI tie, which wrapAngle maps consistently to -PI.
 */
export function rotateTowardHeading(
  current: number,
  target: number,
  rotationSpeed: number,
  deltaSeconds: number,
): number {
  const difference = wrapAngle(target - current)
  const maxStep = rotationSpeed * deltaSeconds
  if (Math.abs(difference) <= maxStep) return wrapAngle(target)
  return wrapAngle(current + Math.sign(difference) * maxStep)
}
