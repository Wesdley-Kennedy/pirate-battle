import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from '../config/gameConfig'
import { ManualClock } from './clock'
import {
  FIXED_STEP_SECONDS,
  GameSession,
  MAX_FRAME_DELTA_SECONDS,
} from './gameSession'

function createSession(clock = new ManualClock()): { session: GameSession; clock: ManualClock } {
  const session = new GameSession({ config: DEFAULT_GAME_CONFIG, clock, seed: 1 })
  return { session, clock }
}

/** Advances the clock in `frames` equal slices, ticking after each slice. */
function run(session: GameSession, clock: ManualClock, totalSeconds: number, frames: number): void {
  const slice = totalSeconds / frames
  for (let i = 0; i < frames; i += 1) {
    clock.advance(slice)
    session.tick()
  }
}

describe('GameSession time', () => {
  it('advances active time while running (quantized to the fixed step)', () => {
    const { session, clock } = createSession()
    session.start()
    run(session, clock, 0.5, 30)
    // Fixed-step simulation: active time tracks wall time within one step;
    // any sub-step remainder stays in the accumulator for the next tick.
    expect(Math.abs(session.activeElapsedSeconds - 0.5)).toBeLessThanOrEqual(
      FIXED_STEP_SECONDS + 1e-9,
    )
    expect([29, 30]).toContain(session.stepsSimulated)
  })

  it('freezes active time while paused', () => {
    const { session, clock } = createSession()
    session.start()
    run(session, clock, 1, 60)
    session.pause()

    clock.advance(5)
    session.tick()
    expect(session.activeElapsedSeconds).toBeCloseTo(1, 6)
    expect(session.state).toBe('paused')
  })

  it('does not replay paused wall time on resume', () => {
    const { session, clock } = createSession()
    session.start()
    run(session, clock, 1, 60)

    session.pause()
    clock.advance(30) // long pause
    session.resume()

    session.tick() // immediately after resume: no wall gap to consume
    expect(session.activeElapsedSeconds).toBeCloseTo(1, 6)

    run(session, clock, 0.1, 6)
    expect(Math.abs(session.activeElapsedSeconds - 1.1)).toBeLessThanOrEqual(
      FIXED_STEP_SECONDS + 1e-9,
    )
  })

  it('freezes the clock after end()', () => {
    const { session, clock } = createSession()
    session.start()
    run(session, clock, 1, 60)
    session.end()

    clock.advance(10)
    session.tick()
    expect(session.activeElapsedSeconds).toBeCloseTo(1, 6)
    expect(session.state).toBe('ended')
  })

  it('never advances after destroy()', () => {
    const { session, clock } = createSession()
    session.start()
    session.destroy()

    clock.advance(10)
    session.tick()
    expect(session.activeElapsedSeconds).toBe(0)
    expect(session.state).toBe('destroyed')
  })

  it('clamps a giant frame delta to MAX_FRAME_DELTA_SECONDS', () => {
    const { session, clock } = createSession()
    session.start()

    clock.advance(10) // e.g. a breakpoint or frozen tab, without pause
    session.tick()
    expect(session.activeElapsedSeconds).toBeLessThanOrEqual(MAX_FRAME_DELTA_SECONDS + 1e-9)
    expect(session.stepsSimulated).toBe(Math.floor(MAX_FRAME_DELTA_SECONDS / FIXED_STEP_SECONDS))
  })

  it('is frame-rate independent: different frame splits of 10s produce the same result', () => {
    const at60fps = createSession()
    at60fps.session.start()
    run(at60fps.session, at60fps.clock, 10, 600)

    const at30fps = createSession()
    at30fps.session.start()
    run(at30fps.session, at30fps.clock, 10, 300)

    const uneven = createSession()
    uneven.session.start()
    // Irregular cadence: mixed frame durations covering the same 10 seconds.
    run(uneven.session, uneven.clock, 4, 97)
    run(uneven.session, uneven.clock, 6, 451)

    const expectedSteps = Math.round(10 / FIXED_STEP_SECONDS) // 600 fixed steps
    for (const { session } of [at60fps, at30fps, uneven]) {
      expect(Math.abs(session.stepsSimulated - expectedSteps)).toBeLessThanOrEqual(1)
      expect(session.activeElapsedSeconds).toBeCloseTo(10, 1)
    }
  })
})

describe('GameSession player movement', () => {
  const FORWARD = { forward: true, turnLeft: false, turnRight: false }

  it('moves the player using the config snapshot of the session', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.player.moveSpeed = 50
    const clock = new ManualClock()
    const start = { x: 800, y: 450 } // open water, far from every island
    const session = new GameSession({ config, clock, seed: 1, playerStart: start })

    config.player.moveSpeed = 9999 // mutation after start must not leak in
    session.start()
    session.setPlayerIntent(FORWARD)
    run(session, clock, 1, 60)

    expect(session.player.position.y).toBeCloseTo(start.y - 50, 3)
    expect(session.player.position.x).toBeCloseTo(start.x, 6)
  })

  it('does not move the player while paused, even with intent held', () => {
    const { session, clock } = createSession()
    session.start()
    session.setPlayerIntent(FORWARD)
    run(session, clock, 0.5, 30)
    const yBeforePause = session.player.position.y

    session.pause()
    clock.advance(5)
    session.tick()
    expect(session.player.position.y).toBe(yBeforePause)

    session.resume()
    session.tick() // immediately after resume: no jump
    expect(session.player.position.y).toBe(yBeforePause)
  })

  it('reaches the same player state for different frame cadences', () => {
    const results = [600, 240, 97].map((frames) => {
      const { session, clock } = createSession()
      session.start()
      session.setPlayerIntent({ forward: true, turnLeft: false, turnRight: true })
      run(session, clock, 10, frames)
      return session
    })

    // Step-quantized: positions may differ by at most one fixed step of travel.
    const maxStepTravel =
      DEFAULT_GAME_CONFIG.player.moveSpeed * FIXED_STEP_SECONDS + 1e-6
    const [a, b, c] = results
    for (const other of [b, c]) {
      expect(Math.abs(a!.player.position.x - other!.player.position.x)).toBeLessThanOrEqual(
        maxStepTravel,
      )
      expect(Math.abs(a!.player.position.y - other!.player.position.y)).toBeLessThanOrEqual(
        maxStepTravel,
      )
    }
  })

  it('player movement is unaffected by the RNG seed', () => {
    const finalStates = [1, 987654321].map((seed) => {
      const clock = new ManualClock()
      const session = new GameSession({ config: DEFAULT_GAME_CONFIG, clock, seed })
      session.start()
      session.setPlayerIntent({ forward: true, turnLeft: true, turnRight: false })
      run(session, clock, 3, 180)
      return session.player
    })

    expect(finalStates[0]!.position.x).toBe(finalStates[1]!.position.x)
    expect(finalStates[0]!.position.y).toBe(finalStates[1]!.position.y)
    expect(finalStates[0]!.rotation).toBe(finalStates[1]!.rotation)
  })
})

describe('GameSession lifecycle', () => {
  it('follows ready → running → paused → running → ended', () => {
    const { session } = createSession()
    expect(session.state).toBe('ready')
    session.start()
    expect(session.state).toBe('running')
    session.pause()
    expect(session.state).toBe('paused')
    session.resume()
    expect(session.state).toBe('running')
    session.end()
    expect(session.state).toBe('ended')
  })

  it('allows ending from paused and destroying from any state', () => {
    const { session } = createSession()
    session.start()
    session.pause()
    session.end()
    expect(session.state).toBe('ended')
    session.destroy()
    expect(session.state).toBe('destroyed')
    session.destroy() // idempotent
    expect(session.state).toBe('destroyed')
  })

  it('rejects invalid transitions', () => {
    const { session } = createSession()
    expect(() => session.pause()).toThrow(/Cannot pause/)
    expect(() => session.resume()).toThrow(/Cannot resume/)
    expect(() => session.end()).toThrow(/Cannot end/)

    session.start()
    expect(() => session.start()).toThrow(/Cannot start/)

    session.pause()
    expect(() => session.pause()).toThrow(/Cannot pause/)

    session.resume()
    expect(() => session.resume()).toThrow(/Cannot resume/)

    session.destroy()
    expect(() => session.start()).toThrow(/Cannot start/)
    expect(() => session.resume()).toThrow(/Cannot resume/)
    expect(() => session.end()).toThrow(/Cannot end/)
  })

  it('exposes an immutable config snapshot and a reproducible seed', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    const session = new GameSession({ config, clock: new ManualClock(), seed: 7 })

    config.player.maxHealth = 1
    expect(session.config.player.maxHealth).toBe(100)

    const twin = new GameSession({
      config: DEFAULT_GAME_CONFIG,
      clock: new ManualClock(),
      seed: 7,
    })
    const values = Array.from({ length: 10 }, () => session.random.next())
    const twinValues = Array.from({ length: 10 }, () => twin.random.next())
    expect(values).toEqual(twinValues)
  })

  it('rejects an invalid config at construction', () => {
    const config = structuredClone(DEFAULT_GAME_CONFIG)
    config.match.enemySpawnIntervalSeconds = -1
    expect(() => new GameSession({ config, clock: new ManualClock() })).toThrow(
      /spawn interval/i,
    )
  })
})
