import type { EndReason, GameSession, GameSessionState } from '../game/core/gameSession'

/**
 * Discrete game → React bridge. `update(session)` runs every rendered
 * frame but a new snapshot (and therefore a React render via
 * useSyncExternalStore) is only emitted when a DISPLAYED value actually
 * changes: whole remaining seconds, health, score, lifecycle, end
 * reason. React never renders per fixed step. Not a generic event bus.
 */
export interface HudSnapshot {
  lifecycle: GameSessionState
  /** Whole seconds, ceiling — changes at most once per second. */
  remainingSeconds: number
  health: number
  maxHealth: number
  score: number
  endReason: EndReason | null
}

export interface HudStore {
  update(session: GameSession): void
  reset(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): HudSnapshot | null
}

export function createHudStore(): HudStore {
  let current: HudSnapshot | null = null
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  return {
    update(session) {
      const next: HudSnapshot = {
        lifecycle: session.state,
        remainingSeconds: Math.ceil(session.remainingSeconds),
        health: session.player.health,
        maxHealth: session.config.player.maxHealth,
        score: session.score,
        endReason: session.endReason,
      }
      if (
        current &&
        current.lifecycle === next.lifecycle &&
        current.remainingSeconds === next.remainingSeconds &&
        current.health === next.health &&
        current.maxHealth === next.maxHealth &&
        current.score === next.score &&
        current.endReason === next.endReason
      ) {
        return
      }
      current = next
      emit()
    },
    reset() {
      if (current === null) return
      current = null
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return current
    },
  }
}
