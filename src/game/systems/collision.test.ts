import { describe, expect, it } from 'vitest'
import { DEFAULT_ISLANDS, PLAYER_SPAWN } from '../config/arenaLayout'
import { DEFAULT_GAME_CONFIG } from '../config/gameConfig'
import { ManualClock } from '../core/clock'
import { GameSession } from '../core/gameSession'
import {
  clampCircleToRect,
  pushCircleOutOfCircle,
  resolveShipCollisions,
} from './collision'
import { updatePlayerMovement } from './playerMovement'
import { createPlayerState } from '../entities/player'

const ARENA = { width: 1600, height: 900 }
const RADIUS = 30
const STEP = 1 / 60
const MOVE = { moveSpeed: 180, rotationSpeed: Math.PI }
const FORWARD = { forward: true, turnLeft: false, turnRight: false }

describe('clampCircleToRect', () => {
  it('keeps the circle inside all four walls, accounting for the radius', () => {
    for (const [start, expected] of [
      [{ x: -50, y: 450 }, { x: RADIUS, y: 450 }], // left
      [{ x: 1700, y: 450 }, { x: ARENA.width - RADIUS, y: 450 }], // right
      [{ x: 800, y: 5 }, { x: 800, y: RADIUS }], // top
      [{ x: 800, y: 899 }, { x: 800, y: ARENA.height - RADIUS }], // bottom
    ] as const) {
      const position = { ...start }
      clampCircleToRect(position, RADIUS, ARENA.width, ARENA.height)
      expect(position).toEqual(expected)
    }
  })

  it('leaves valid positions untouched and reports no movement', () => {
    const position = { x: 400, y: 400 }
    expect(clampCircleToRect(position, RADIUS, ARENA.width, ARENA.height)).toBe(false)
    expect(position).toEqual({ x: 400, y: 400 })
  })
})

describe('pushCircleOutOfCircle', () => {
  const island = { x: 500, y: 500, radius: 88 }

  it('separates a penetrating circle to exactly the combined radius', () => {
    const position = { x: 500 + 60, y: 500 }
    pushCircleOutOfCircle(position, RADIUS, island)
    expect(Math.hypot(position.x - island.x, position.y - island.y)).toBeCloseTo(118, 9)
    expect(position.y).toBe(500) // pushed along the contact normal only
  })

  it('handles the degenerate centered case deterministically', () => {
    const position = { x: 500, y: 500 }
    pushCircleOutOfCircle(position, RADIUS, island)
    expect(position).toEqual({ x: 500, y: 500 - 118 })
  })

  it('property: approaches from 72 headings never end inside the island', () => {
    for (let i = 0; i < 72; i += 1) {
      const heading = (i / 72) * Math.PI * 2
      // Start outside on the opposite side and drive straight at the center.
      const player = createPlayerState({
        x: island.x - Math.sin(heading) * 300,
        y: island.y + Math.cos(heading) * 300,
      })
      player.rotation = heading
      for (let step = 0; step < 240; step += 1) {
        updatePlayerMovement(player, FORWARD, MOVE, STEP)
        resolveShipCollisions(player.position, RADIUS, [island], ARENA.width, ARENA.height)
      }
      const distance = Math.hypot(player.position.x - island.x, player.position.y - island.y)
      expect(distance).toBeGreaterThanOrEqual(118 - 1e-6)
      expect(Number.isFinite(player.position.x)).toBe(true)
      expect(Number.isFinite(player.position.y)).toBe(true)
    }
  })

  it('pressing into the island converges without growing jitter', () => {
    // Start below the island facing up: presses straight into it.
    const player = createPlayerState({ x: island.x, y: island.y + 300 })
    player.rotation = 0
    const samples: { x: number; y: number }[] = []
    for (let step = 0; step < 360; step += 1) {
      updatePlayerMovement(player, FORWARD, MOVE, STEP)
      resolveShipCollisions(player.position, RADIUS, [island], ARENA.width, ARENA.height)
      if (step >= 300) samples.push({ ...player.position })
    }
    // Settled: the last second of pressing moves the ship less than 0.01 px.
    const first = samples[0]!
    for (const sample of samples) {
      expect(Math.hypot(sample.x - first.x, sample.y - first.y)).toBeLessThan(0.01)
    }
    expect(Math.hypot(player.position.x - island.x, player.position.y - island.y)).toBeCloseTo(
      118,
      6,
    )
  })

  it('tangential movement slides along the island instead of sticking', () => {
    // Touching the island on its left side, heading up (tangential).
    const player = createPlayerState({ x: island.x - 118, y: island.y })
    player.rotation = 0
    const startY = player.position.y
    for (let step = 0; step < 60; step += 1) {
      updatePlayerMovement(player, FORWARD, MOVE, STEP)
      resolveShipCollisions(player.position, RADIUS, [island], ARENA.width, ARENA.height)
    }
    expect(startY - player.position.y).toBeGreaterThan(100) // real progress
    expect(
      Math.hypot(player.position.x - island.x, player.position.y - island.y),
    ).toBeGreaterThanOrEqual(118 - 1e-6)
  })

  it('moving away from the island frees the ship', () => {
    const player = createPlayerState({ x: island.x, y: island.y + 118 }) // touching below
    player.rotation = Math.PI // facing down, away from the island
    for (let step = 0; step < 60; step += 1) {
      updatePlayerMovement(player, FORWARD, MOVE, STEP)
      resolveShipCollisions(player.position, RADIUS, [island], ARENA.width, ARENA.height)
    }
    expect(Math.hypot(player.position.x - island.x, player.position.y - island.y)).toBeGreaterThan(
      280,
    )
  })
})

describe('GameSession arena integration', () => {
  it('spawns at a valid position (water, inside bounds, outside islands)', () => {
    const session = new GameSession({
      config: DEFAULT_GAME_CONFIG,
      clock: new ManualClock(),
      seed: 1,
    })
    const { x, y } = session.player.position
    expect(x).toBe(PLAYER_SPAWN.x)
    expect(y).toBe(PLAYER_SPAWN.y)
    const radius = session.config.player.collisionRadius
    expect(x).toBeGreaterThanOrEqual(radius)
    expect(y).toBeLessThanOrEqual(session.config.arena.height - radius)
    for (const island of DEFAULT_ISLANDS) {
      expect(Math.hypot(x - island.x, y - island.y)).toBeGreaterThanOrEqual(
        radius + island.radius,
      )
    }
  })

  it('rejects an invalid spawn at construction', () => {
    const island = DEFAULT_ISLANDS[0]!
    expect(
      () =>
        new GameSession({
          config: DEFAULT_GAME_CONFIG,
          clock: new ManualClock(),
          playerStart: { x: island.x, y: island.y },
        }),
    ).toThrow(/intersects/)
    expect(
      () =>
        new GameSession({
          config: DEFAULT_GAME_CONFIG,
          clock: new ManualClock(),
          playerStart: { x: 5, y: 450 },
        }),
    ).toThrow(/outside the arena/)
  })

  it('the player can never leave the arena, whatever the heading', () => {
    const clock = new ManualClock()
    const session = new GameSession({ config: DEFAULT_GAME_CONFIG, clock, seed: 1, islands: [] })
    session.start()
    session.setPlayerIntent(FORWARD)
    const radius = session.config.player.collisionRadius
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, 2.5, -2.2]) {
      session.player.rotation = heading
      for (let i = 0; i < 600; i += 1) {
        clock.advance(STEP)
        session.tick()
        const { x, y } = session.player.position
        expect(x).toBeGreaterThanOrEqual(radius - 1e-9)
        expect(x).toBeLessThanOrEqual(session.config.arena.width - radius + 1e-9)
        expect(y).toBeGreaterThanOrEqual(radius - 1e-9)
        expect(y).toBeLessThanOrEqual(session.config.arena.height - radius + 1e-9)
      }
    }
  })

  it('different frame cadences produce the same collision outcome', () => {
    const outcomes = [600, 237].map((frames) => {
      const clock = new ManualClock()
      const session = new GameSession({ config: DEFAULT_GAME_CONFIG, clock, seed: 1 })
      session.start()
      // Drive diagonally into island-south until settled against it.
      session.player.rotation = Math.atan2(800 - 240, -(650 - 700))
      session.setPlayerIntent(FORWARD)
      const slice = 10 / frames
      for (let i = 0; i < frames; i += 1) {
        clock.advance(slice)
        session.tick()
      }
      return session.player.position
    })
    const [a, b] = outcomes
    // Step-quantized: at most one fixed step of travel apart.
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeLessThanOrEqual(180 * STEP + 1e-6)
  })

  it('rotating while pressed against an island still works', () => {
    const island = DEFAULT_ISLANDS[2]! // island-south at (800, 650)
    const clock = new ManualClock()
    const session = new GameSession({
      config: DEFAULT_GAME_CONFIG,
      clock,
      seed: 1,
      playerStart: { x: island.x, y: island.y + island.radius + 30 },
    })
    session.start()
    session.setPlayerIntent({ forward: true, turnLeft: true, turnRight: false })
    const rotationBefore = session.player.rotation
    for (let i = 0; i < 30; i += 1) {
      clock.advance(STEP)
      session.tick()
    }
    expect(session.player.rotation).not.toBe(rotationBefore)
    expect(
      Math.hypot(session.player.position.x - island.x, session.player.position.y - island.y),
    ).toBeGreaterThanOrEqual(island.radius + 30 - 1e-6)
  })
})
