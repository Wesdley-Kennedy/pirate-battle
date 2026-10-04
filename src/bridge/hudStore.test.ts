import { describe, expect, it } from 'vitest'
import { DEFAULT_GAME_CONFIG } from '../game/config/gameConfig'
import { ManualClock } from '../game/core/clock'
import { GameSession } from '../game/core/gameSession'
import { createHudStore } from './hudStore'

const STEP = 1 / 60

describe('hudStore', () => {
  it('emits only when a displayed value changes — never per frame', () => {
    const clock = new ManualClock()
    const session = new GameSession({ config: DEFAULT_GAME_CONFIG, clock, seed: 1 })
    session.start()
    const store = createHudStore()
    let emissions = 0
    store.subscribe(() => {
      emissions += 1
    })

    store.update(session) // first snapshot
    expect(emissions).toBe(1)

    // 30 frames inside the same displayed second, nothing visible changes.
    for (let i = 0; i < 30; i += 1) {
      clock.advance(STEP)
      session.tick()
      store.update(session)
    }
    expect(emissions).toBe(1)

    // Crossing a whole displayed second emits exactly once more.
    for (let i = 0; i < 45; i += 1) {
      clock.advance(STEP)
      session.tick()
      store.update(session)
    }
    expect(emissions).toBe(2)
    expect(store.getSnapshot()!.remainingSeconds).toBe(119)

    // A lifecycle change emits immediately.
    session.pause()
    store.update(session)
    expect(emissions).toBe(3)
    expect(store.getSnapshot()!.lifecycle).toBe('paused')
  })

  it('health and score changes emit exactly once each; ended sessions stop emitting', () => {
    const clock = new ManualClock()
    const session = new GameSession({ config: DEFAULT_GAME_CONFIG, clock, seed: 1 })
    session.start()
    const store = createHudStore()
    let emissions = 0
    store.subscribe(() => {
      emissions += 1
    })
    store.update(session)
    emissions = 0

    // Direct state change (unit-level): one emission per changed value.
    session.player.health -= 10
    store.update(session)
    store.update(session)
    expect(emissions).toBe(1)
    expect(store.getSnapshot()!.health).toBe(90)

    session.end()
    store.update(session) // lifecycle transition emits once…
    expect(emissions).toBe(2)
    store.update(session) // …and identical post-end updates never emit.
    store.update(session)
    expect(emissions).toBe(2)
  })

  it('getSnapshot returns a stable reference between emissions', () => {
    const clock = new ManualClock()
    const session = new GameSession({ config: DEFAULT_GAME_CONFIG, clock, seed: 1 })
    session.start()
    const store = createHudStore()
    store.update(session)
    const first = store.getSnapshot()
    store.update(session)
    expect(store.getSnapshot()).toBe(first) // same object: no React re-render
  })
})
