/**
 * Minimal damage helpers shared by the player and enemy pipelines.
 * Damage values come validated from the config snapshot; the clamp here
 * only guarantees no observable negative health.
 */
export function applyDamage(currentHealth: number, damage: number): number {
  return Math.max(0, currentHealth - damage)
}

/**
 * Discrete visual deterioration tier derived from the health ratio.
 * Purely cosmetic — collision geometry never changes with the texture.
 * 0 = intact (> 2/3), 1 = damaged (> 1/3), 2 = heavily damaged (> 0).
 */
export function damageTierFor(health: number, maxHealth: number): 0 | 1 | 2 {
  const ratio = health / maxHealth
  if (ratio > 2 / 3) return 0
  if (ratio > 1 / 3) return 1
  return 2
}
