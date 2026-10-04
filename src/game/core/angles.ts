/** Wraps an angle to [-PI, PI). Shared by player and enemy kinematics. */
export function wrapAngle(radians: number): number {
  // Fast path keeps already-normalized values bit-exact (the modulo
  // round-trip would otherwise introduce float noise on them).
  if (radians >= -Math.PI && radians < Math.PI) return radians
  const twoPi = Math.PI * 2
  return ((((radians + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI
}
