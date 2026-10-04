import { describe, expect, it } from 'vitest'
import { createPlayerState } from '../entities/player'
import { createEmptyMovementIntent, type MovementIntent } from '../input/movementIntent'
import { updatePlayerMovement, type PlayerMovementConfig } from './playerMovement'

const CONFIG: PlayerMovementConfig = { moveSpeed: 180, rotationSpeed: Math.PI }
const STEP = 1 / 60

function intentOf(partial: Partial<MovementIntent>): MovementIntent {
  return { ...createEmptyMovementIntent(), ...partial }
}

/** Runs whole-second simulations as 60 fixed steps per second. */
function simulate(intent: MovementIntent, seconds: number, config = CONFIG) {
  const player = createPlayerState()
  const steps = Math.round(seconds / STEP)
  for (let i = 0; i < steps; i += 1) {
    updatePlayerMovement(player, intent, config, STEP)
  }
  return player
}

describe('updatePlayerMovement', () => {
  it('does nothing without input', () => {
    const player = simulate(createEmptyMovementIntent(), 1)
    expect(player.position).toEqual({ x: 0, y: 0 })
    expect(player.rotation).toBe(0)
  })

  it('moves forward by moveSpeed pixels after one second (facing up)', () => {
    const player = simulate(intentOf({ forward: true }), 1)
    expect(player.position.x).toBeCloseTo(0, 6)
    expect(player.position.y).toBeCloseTo(-CONFIG.moveSpeed, 6)
    expect(player.rotation).toBe(0)
  })

  it('turns left by rotationSpeed radians per second (negative = counter-clockwise)', () => {
    const player = simulate(intentOf({ turnLeft: true }), 0.5)
    expect(player.rotation).toBeCloseTo(-CONFIG.rotationSpeed * 0.5, 6)
    expect(player.position).toEqual({ x: 0, y: 0 })
  })

  it('turns right by rotationSpeed radians per second (positive = clockwise)', () => {
    const player = simulate(intentOf({ turnRight: true }), 0.5)
    expect(player.rotation).toBeCloseTo(CONFIG.rotationSpeed * 0.5, 6)
  })

  it('moves and turns simultaneously (curved path)', () => {
    const player = simulate(intentOf({ forward: true, turnRight: true }), 0.5)
    expect(player.rotation).toBeCloseTo(Math.PI / 2, 6)
    // Turning clockwise from "up" towards "right": ends in the upper-right quadrant.
    expect(player.position.x).toBeGreaterThan(0)
    expect(player.position.y).toBeLessThan(0)
    // Still travelled a curved path of total length speed × time.
    const distance = Math.hypot(player.position.x, player.position.y)
    expect(distance).toBeGreaterThan(0)
    expect(distance).toBeLessThan(CONFIG.moveSpeed * 0.5)
  })

  it('cancels opposing turn inputs deterministically', () => {
    const player = simulate(intentOf({ forward: true, turnLeft: true, turnRight: true }), 1)
    expect(player.rotation).toBe(0)
    expect(player.position.x).toBeCloseTo(0, 6)
    expect(player.position.y).toBeCloseTo(-CONFIG.moveSpeed, 6)
  })
})
