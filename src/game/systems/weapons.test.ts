import { describe, expect, it } from 'vitest'
import { createPlayerState } from '../entities/player'
import {
  BROADSIDE_SIDE_OFFSET,
  BROADSIDE_SPACING,
  broadsideShots,
  FRONT_MUZZLE_OFFSET,
  frontShot,
} from './weapons'

function forward(rotation: number) {
  return { x: Math.sin(rotation), y: -Math.cos(rotation) }
}

describe('weapon shot geometry', () => {
  it('front shot spawns ahead of the bow along the heading', () => {
    const player = createPlayerState({ x: 500, y: 400 })
    const shot = frontShot(player)
    expect(shot.direction).toEqual({ x: 0, y: -1 })
    expect(shot.origin.x).toBeCloseTo(500, 9)
    expect(shot.origin.y).toBeCloseTo(400 - FRONT_MUZZLE_OFFSET, 9)
  })

  it('broadsides produce 3 parallel shots with distinct origins along the hull', () => {
    const player = createPlayerState({ x: 500, y: 400 })
    for (const side of ['left', 'right'] as const) {
      const shots = broadsideShots(player, side)
      expect(shots).toHaveLength(3)
      const [a, b, c] = shots
      // Parallel: identical direction vectors, no angular spread.
      expect(b!.direction).toEqual(a!.direction)
      expect(c!.direction).toEqual(a!.direction)
      // Distinct origins spaced along the ship axis (vertical at rotation 0).
      const ys = shots.map((s) => s.origin.y).sort((p, q) => p - q)
      expect(ys[0]).toBeCloseTo(400 - BROADSIDE_SPACING, 9)
      expect(ys[1]).toBeCloseTo(400, 9)
      expect(ys[2]).toBeCloseTo(400 + BROADSIDE_SPACING, 9)
    }
  })

  it('left and right broadsides are mirrored', () => {
    const player = createPlayerState({ x: 500, y: 400 })
    player.rotation = 0.7
    const left = broadsideShots(player, 'left')
    const right = broadsideShots(player, 'right')
    expect(left[0]!.direction.x).toBeCloseTo(-right[0]!.direction.x, 12)
    expect(left[0]!.direction.y).toBeCloseTo(-right[0]!.direction.y, 12)
    // Origins mirror across the hull axis: midpoints are symmetric about the player.
    const midLeft = left[1]!.origin
    const midRight = right[1]!.origin
    expect(midLeft.x + midRight.x).toBeCloseTo(2 * 500, 9)
    expect(midLeft.y + midRight.y).toBeCloseTo(2 * 400, 9)
  })

  it('36 headings: front fires along forward, broadsides perpendicular and parallel', () => {
    for (let i = 0; i < 36; i += 1) {
      const rotation = (i / 36) * Math.PI * 2 - Math.PI
      const player = createPlayerState({ x: 800, y: 450 })
      player.rotation = rotation
      const fwd = forward(rotation)

      const front = frontShot(player)
      expect(front.direction.x).toBeCloseTo(fwd.x, 12)
      expect(front.direction.y).toBeCloseTo(fwd.y, 12)
      expect(front.origin.x).toBeCloseTo(800 + fwd.x * FRONT_MUZZLE_OFFSET, 9)
      expect(front.origin.y).toBeCloseTo(450 + fwd.y * FRONT_MUZZLE_OFFSET, 9)

      for (const side of ['left', 'right'] as const) {
        const shots = broadsideShots(player, side)
        const direction = shots[0]!.direction
        // Unit length and perpendicular to forward.
        expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 12)
        expect(direction.x * fwd.x + direction.y * fwd.y).toBeCloseTo(0, 12)
        for (const shot of shots) {
          expect(shot.direction).toEqual(direction)
          // Each origin sits exactly SIDE_OFFSET off the hull axis.
          const offsetX = shot.origin.x - 800
          const offsetY = shot.origin.y - 450
          const lateral = offsetX * direction.x + offsetY * direction.y
          expect(lateral).toBeCloseTo(BROADSIDE_SIDE_OFFSET, 9)
        }
        // Origins are three distinct points along the hull axis.
        const alongs = shots.map((s) => (s.origin.x - 800) * fwd.x + (s.origin.y - 450) * fwd.y)
        expect(new Set(alongs.map((a) => a.toFixed(6))).size).toBe(3)
      }
    }
  })
})
