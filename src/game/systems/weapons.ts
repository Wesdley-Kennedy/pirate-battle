import type { PlayerState, Vec2 } from '../entities/player'
import type { WeaponIntent } from '../input/weaponIntent'

/**
 * Player weapon logic. Cooldowns are pure simulation time: they advance
 * only inside fixed steps, so they freeze on pause and never catch up.
 *
 * Hardpoint offsets are derived from the ship artwork (66×113 px sprite,
 * 30 px collision circle). They shape where shots appear, not how strong
 * they are, so they live here as named constants instead of in the
 * balance config.
 */
export const FRONT_MUZZLE_OFFSET = 62
export const BROADSIDE_SIDE_OFFSET = 36
export const BROADSIDE_SPACING = 32

/** Remaining cooldown per weapon, in seconds. Left/right are independent. */
export interface WeaponsState {
  front: number
  left: number
  right: number
}

export function createWeaponsState(): WeaponsState {
  return { front: 0, left: 0, right: 0 }
}

export interface ShotSpawn {
  origin: Vec2
  direction: Vec2
}

export interface WeaponsProjectileConfig {
  readonly frontDamage: number
  readonly broadsideDamage: number
  readonly frontFireCooldownSeconds: number
  readonly broadsideFireCooldownSeconds: number
}

/** Angular convention (see entities/player.ts): forward = (sin r, -cos r). */
function forwardOf(rotation: number): Vec2 {
  return { x: Math.sin(rotation), y: -Math.cos(rotation) }
}

/** Starboard side: perpendicular clockwise from forward = (cos r, sin r). */
function rightOf(rotation: number): Vec2 {
  return { x: Math.cos(rotation), y: Math.sin(rotation) }
}

export function frontShot(player: PlayerState): ShotSpawn {
  const forward = forwardOf(player.rotation)
  return {
    origin: {
      x: player.position.x + forward.x * FRONT_MUZZLE_OFFSET,
      y: player.position.y + forward.y * FRONT_MUZZLE_OFFSET,
    },
    direction: forward,
  }
}

/**
 * Three PARALLEL shots: one shared direction (the side normal), three
 * origins spaced along the hull axis — explicitly not an angular spread.
 */
export function broadsideShots(player: PlayerState, side: 'left' | 'right'): ShotSpawn[] {
  const forward = forwardOf(player.rotation)
  const right = rightOf(player.rotation)
  const sign = side === 'right' ? 1 : -1
  const direction = { x: right.x * sign, y: right.y * sign }
  const shots: ShotSpawn[] = []
  for (const along of [-BROADSIDE_SPACING, 0, BROADSIDE_SPACING]) {
    shots.push({
      origin: {
        x: player.position.x + direction.x * BROADSIDE_SIDE_OFFSET + forward.x * along,
        y: player.position.y + direction.y * BROADSIDE_SIDE_OFFSET + forward.y * along,
      },
      direction: { ...direction },
    })
  }
  return shots
}

/**
 * Advances cooldowns by one fixed step and fires any weapon whose intent
 * is held and whose cooldown has expired. Firing left does not lock
 * right and vice versa; each weapon has its own timer.
 */
export function updatePlayerWeapons(
  weapons: WeaponsState,
  intent: WeaponIntent,
  player: PlayerState,
  config: WeaponsProjectileConfig,
  deltaSeconds: number,
  spawnProjectile: (spawn: ShotSpawn, damage: number) => void,
): void {
  weapons.front = Math.max(0, weapons.front - deltaSeconds)
  weapons.left = Math.max(0, weapons.left - deltaSeconds)
  weapons.right = Math.max(0, weapons.right - deltaSeconds)

  if (intent.fireFront && weapons.front <= 0) {
    spawnProjectile(frontShot(player), config.frontDamage)
    weapons.front = config.frontFireCooldownSeconds
  }
  if (intent.fireLeft && weapons.left <= 0) {
    for (const shot of broadsideShots(player, 'left')) {
      spawnProjectile(shot, config.broadsideDamage)
    }
    weapons.left = config.broadsideFireCooldownSeconds
  }
  if (intent.fireRight && weapons.right <= 0) {
    for (const shot of broadsideShots(player, 'right')) {
      spawnProjectile(shot, config.broadsideDamage)
    }
    weapons.right = config.broadsideFireCooldownSeconds
  }
}
